import multer from "multer";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import {
  assertBatchLimits,
  assertPathPolicy,
  configuredUserQuotaBytes,
  formatBytes,
  MAX_DIRECTORY_CHILDREN,
  MAX_FILE_UPLOAD_BYTES,
  MAX_RENAME_ATTEMPTS,
  MAX_PATH_DEPTH,
  MAX_USER_FILE_ITEMS,
  MAX_WALK_ITEMS,
  statusError,
} from "./storage-policy.js";

const ALLOWED_FILE_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".mdx",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".webmanifest",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".ico",
  ".bmp",
]);

// General file uploads — one file per request so the
// client can track per-file progress and reconstruct folder structure.
export function createFileUploadMiddleware({ dataDir }) {
  const uploadDir = path.join(dataDir, "tmp", "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });
  return multer({
    dest: uploadDir,
    limits: {
      files: 1,
      fileSize: MAX_FILE_UPLOAD_BYTES,
    },
    fileFilter: (_req, file, cb) => {
      if (isIgnoredUploadPath(file.originalname)) {
        cb(new Error("已忽略"));
        return;
      }
      cb(null, true);
    },
  });
}

// Move an uploaded temp file into the user's files area, preserving a folder
// upload's relative path. Rejects path traversal and handles name conflicts
// according to conflictMode: "error", "rename", or "overwrite".
export async function storeUserFile({
  tmpPath,
  originalName,
  relativePath,
  targetRelativePath,
  conflictMode = "error",
  filesDir,
  publicBasePath,
}) {
  await fsp.mkdir(filesDir, { recursive: true });
  assertVisibleUploadPath(originalName);
  const rel = safeRelPath(targetRelativePath || relativePath || originalName);
  assertVisibleUploadPath(rel);
  assertAllowedUploadPath(rel);
  const root = path.resolve(filesDir);
  let target = path.resolve(root, rel);
  assertInside(root, target);
  await assertParentWithinLimits({ root, rel });
  const uploadStat = await fsp.stat(tmpPath);
  await assertQuotaAvailable({
    root,
    uploadBytes: uploadStat.size,
    replacing: conflictMode === "overwrite" ? target : null,
  });
  await assertUserItemLimit({ root, replacing: conflictMode === "overwrite" ? target : null });

  if (conflictMode === "rename") {
    target = await uniquePath(target);
  } else if (conflictMode === "overwrite") {
    await assertCanOverwrite(target);
  } else if (await pathExists(target)) {
    const error = new Error("A file or directory with this name already exists.");
    error.status = 409;
    error.code = "UPLOAD_CONFLICT";
    error.path = rel;
    throw error;
  }

  await fsp.mkdir(path.dirname(target), { recursive: true });
  if (conflictMode === "overwrite") await fsp.rm(target, { force: true });
  await moveFile(tmpPath, target);
  const stat = await fsp.stat(target);
  const relFinal = path.relative(root, target);
  const urlPath = relFinal.split(path.sep).map(encodeURIComponent).join("/");
  if (!publicBasePath) throw new Error("Missing public upload path.");
  const prefix = publicBasePath.replace(/\/$/, "");
  return { name: path.basename(target), path: relFinal, size: stat.size, url: `${prefix}/${urlPath}` };
}

export async function resolveUserFileConflicts({ paths, baseDir = "", filesDir }) {
  const root = path.resolve(filesDir);
  await fsp.mkdir(root, { recursive: true });
  const baseRel = safeOptionalRelPath(baseDir);
  const baseParts = baseRel ? baseRel.split("/") : [];
  const inputPaths = Array.isArray(paths) ? paths : [];
  assertBatchLimits(inputPaths);
  const rels = inputPaths.map((p) => {
    const rel = safeRelPath(p);
    assertVisibleUploadPath(rel);
    assertAllowedUploadPath(rel);
    return rel;
  });
  const conflicts = [];
  const rootConflicts = new Set();

  for (const rel of rels) {
    const target = path.resolve(root, rel);
    assertInside(root, target);
    if (await pathExists(target)) {
      const stat = await fsp.stat(target);
      conflicts.push({ path: rel, type: stat.isDirectory() ? "directory" : "file" });
    }

    const parts = rel.split("/");
    const uploadedRoot = parts[baseParts.length];
    if (uploadedRoot && parts.length > baseParts.length + 1 && hasPrefixParts(parts, baseParts)) {
      const uploadedRootRel = [...baseParts, uploadedRoot].join("/");
      if (!rootConflicts.has(uploadedRootRel)) {
        const top = path.resolve(root, uploadedRootRel);
        if ((await fsp.stat(top).catch(() => null))?.isDirectory()) {
          rootConflicts.add(uploadedRootRel);
          conflicts.push({ path: uploadedRootRel, type: "directory" });
        }
      }
    }
  }

  const rootRenameMap = new Map();
  for (const dir of rootConflicts) {
    const renamedRoot = await uniquePath(path.resolve(root, dir));
    rootRenameMap.set(dir, path.relative(root, renamedRoot).split(path.sep).join("/"));
  }

  const used = new Set();
  const renamedPaths = {};
  const rootRenameEntries = [...rootRenameMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const rel of rels) {
    let candidateRel = rel;
    const rootRename = rootRenameEntries.find(([from]) => rel === from || rel.startsWith(`${from}/`));
    if (rootRename) {
      const [from, to] = rootRename;
      candidateRel = `${to}${rel.slice(from.length)}`;
    }

    let target = path.resolve(root, candidateRel);
    assertInside(root, target);
    while (used.has(candidateRel) || (await pathExists(target))) {
      target = await uniquePath(target);
      candidateRel = path.relative(root, target).split(path.sep).join("/");
    }
    used.add(candidateRel);
    renamedPaths[rel] = candidateRel;
  }

  return { conflicts: dedupeConflicts(conflicts), renamedPaths };
}

function safeRelPath(name) {
  const value = String(name || "file").replace(/\\/g, "/");
  if (path.isAbsolute(value) || value.includes("\0")) throw new Error("Invalid upload path.");
  const parts = value.split("/").map((p) => p.trim()).filter(Boolean);
  if (!parts.length || parts.some((p) => p === "." || p === ".." || /[\x00-\x1f]/.test(p))) {
    throw new Error("Invalid upload path.");
  }
  assertPathPolicy(parts, "upload path");
  return parts.length ? parts.join("/") : "file";
}

function safeOptionalRelPath(name) {
  if (!String(name || "").trim()) return "";
  return safeRelPath(name);
}

function hasPrefixParts(parts, prefix) {
  return prefix.every((part, index) => parts[index] === part);
}

function assertAllowedUploadPath(name) {
  if (!isAllowedUploadPath(name)) {
    throw new Error("Only Markdown, webpage, and image files are supported.");
  }
}

function assertVisibleUploadPath(name) {
  if (isIgnoredUploadPath(name)) throw new Error("已忽略");
}

function isAllowedUploadPath(name) {
  return ALLOWED_FILE_EXTENSIONS.has(path.extname(String(name || "")).toLowerCase());
}

function isIgnoredUploadPath(name) {
  return String(name || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .some((part) => part === ".DS_Store" || part.startsWith("."));
}

async function assertCanOverwrite(target) {
  const stat = await fsp.stat(target).catch((err) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (stat?.isDirectory()) throw new Error("Cannot overwrite a directory with a file.");
}

async function uniquePath(target) {
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  let candidate = target;
  let n = 1;
  while (await fsp.stat(candidate).then(() => true).catch(() => false)) {
    if (n >= MAX_RENAME_ATTEMPTS) {
      throw statusError(`Too many conflicting names. Rename or remove files before uploading.`, 409, "TOO_MANY_CONFLICTS");
    }
    candidate = path.join(dir, `${base} (${++n})${ext}`);
  }
  return candidate;
}

async function assertParentWithinLimits({ root, rel }) {
  const parentRel = path.posix.dirname(rel);
  if (parentRel === ".") return;
  const parent = path.resolve(root, parentRel);
  assertInside(root, parent);
  const stat = await fsp.stat(parent).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (stat && !stat.isDirectory()) throw new Error("Upload parent path is not a directory.");
  if (!stat) return;
  const entries = await fsp.readdir(parent, { withFileTypes: true }).catch(() => []);
  if (entries.filter((entry) => !entry.name.startsWith(".")).length >= MAX_DIRECTORY_CHILDREN) {
    throw statusError(`目标目录文件过多，请拆分目录后再上传。`, 413);
  }
}

async function assertQuotaAvailable({ root, uploadBytes, replacing }) {
  const quotaBytes = configuredUserQuotaBytes();
  const usedBytes = await directorySize(root);
  const replacedBytes = replacing ? await fileSize(replacing) : 0;
  if (usedBytes - replacedBytes + uploadBytes > quotaBytes) {
    throw statusError(`用户容量配额不足，默认容量为 ${formatBytes(quotaBytes)}。`, 413, "QUOTA_EXCEEDED");
  }
}

async function assertUserItemLimit({ root, replacing }) {
  const replacingExists = replacing ? await pathExists(replacing) : false;
  if (replacingExists) return;
  const count = await directoryItemCount(root);
  if (count >= MAX_USER_FILE_ITEMS) {
    throw statusError(`用户文件数量已达到上限 ${MAX_USER_FILE_ITEMS}。`, 413, "TOO_MANY_FILES");
  }
}

async function directorySize(dir, depth = 0, budget = { items: 0 }) {
  budget.items += 1;
  if (budget.items > MAX_WALK_ITEMS) throw statusError(`目录项目过多，操作已停止。`, 413);
  if (depth > MAX_PATH_DEPTH) throw statusError(`目录层级超过上限 ${MAX_PATH_DEPTH}。`, 413);
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(abs, depth + 1, budget);
    else if (entry.isFile()) {
      const stat = await fsp.stat(abs).catch(() => null);
      if (stat?.isFile()) total += stat.size;
    }
  }
  return total;
}

async function directoryItemCount(dir, depth = 0, budget = { items: 0 }) {
  budget.items += 1;
  if (budget.items > MAX_WALK_ITEMS) throw statusError(`目录项目过多，操作已停止。`, 413);
  if (depth > MAX_PATH_DEPTH) throw statusError(`目录层级超过上限 ${MAX_PATH_DEPTH}。`, 413);
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) count += 1 + await directoryItemCount(abs, depth + 1, budget);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

async function fileSize(target) {
  const stat = await fsp.stat(target).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return 0;
  if (stat.isDirectory()) return directorySize(target);
  return stat.isFile() ? stat.size : 0;
}

async function pathExists(target) {
  return fsp.stat(target).then(() => true).catch((err) => {
    if (err.code === "ENOENT") return false;
    throw err;
  });
}

function dedupeConflicts(conflicts) {
  const seen = new Set();
  return conflicts.filter((conflict) => {
    const key = `${conflict.type}:${conflict.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function moveFile(from, to) {
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    await fsp.copyFile(from, to);
    await fsp.rm(from, { force: true });
  }
}

export async function removeUpload(file) {
  if (file?.path) await fsp.rm(file.path, { force: true }).catch(() => undefined);
}

function assertInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Upload path escapes the user files directory.");
  }
}
