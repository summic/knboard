import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  assertPathPolicy,
  configuredUserQuotaBytes,
  MAX_DIRECTORY_CHILDREN,
  MAX_PATH_DEPTH,
  MAX_USER_FILE_ITEMS,
  MAX_WALK_ITEMS,
  statusError,
} from "./storage-policy.js";
import {
  isWebPagePath,
  removeWebThumbnail,
  webThumbnailInfo,
} from "./web-thumbnails.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".ico", ".bmp"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);
const WEB_EXTENSIONS = new Set([".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".json", ".webmanifest"]);
const TRASH_DIR = ".knbox-trash";
const TRASH_ITEMS_DIR = "items";
const TRASH_MANIFEST = "manifest.json";
const DELETE_CONFIRM_TEXT = "confirm";
const HTML_TITLE_ENTITY_RE = /&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi;

export async function listUserFiles({
  filesDir,
  publicBasePath,
  thumbnailBasePath,
  onWebThumbnailNeeded,
  visibilityForPaths,
  dir = "",
  type = "all",
}) {
  const root = path.resolve(filesDir);
  const relDir = safeUserRelativePath(dir, { allowEmpty: true });
  const currentDir = relDir ? path.resolve(root, relDir) : root;
  assertInside(root, currentDir);

  const stat = await fs.stat(currentDir).catch(() => null);
  if (stat && !stat.isDirectory()) throw new Error("Path is not a directory.");

  await fs.mkdir(root, { recursive: true });
  const entries = stat ? await fs.readdir(currentDir, { withFileTypes: true }) : [];
  if (entries.filter((entry) => !entry.name.startsWith(".")).length > MAX_DIRECTORY_CHILDREN) {
    throw statusError(`目录项目过多，请拆分后再浏览。`, 413);
  }
  const items = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
    const abs = path.join(currentDir, entry.name);
    const childStat = await fs.stat(abs).catch(() => null);
    if (!childStat) continue;

    if (entry.isDirectory()) {
      if (type !== "all") {
        const contains = await directoryContainsType(abs, type);
        if (!contains) continue;
      }
      items.push(await fileItem({
        name: entry.name,
        rel: childRel,
        stat: childStat,
        kind: "directory",
        publicBasePath,
        thumbnailBasePath,
        onWebThumbnailNeeded,
        fileCount: await directoryFileCount(abs),
      }));
      continue;
    }

    if (!entry.isFile()) continue;
    const kind = fileKind(entry.name);
    if (!matchesType(kind, type)) continue;
    items.push(await fileItem({
      name: entry.name,
      rel: childRel,
      stat: childStat,
      kind,
      filesDir: root,
      publicBasePath,
      thumbnailBasePath,
      onWebThumbnailNeeded,
    }));
  }

  items.sort((a, b) => {
    if (a.kind === "directory" && b.kind !== "directory") return -1;
    if (a.kind !== "directory" && b.kind === "directory") return 1;
    return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
  });

  await applyContentVisibility(items, { visibilityForPaths });

  return {
    dir: relDir,
    parent: parentPath(relDir),
    items,
  };
}

export async function getUserFileEntry({ filesDir, publicBasePath, thumbnailBasePath, onWebThumbnailNeeded, visibilityForPaths, target = "" }) {
  const root = path.resolve(filesDir);
  const rel = safeUserRelativePath(target, { allowEmpty: true });
  const abs = rel ? path.resolve(root, rel) : root;
  assertInside(root, abs);
  await fs.mkdir(root, { recursive: true });

  const stat = await fs.stat(abs).catch(() => null);
  if (!stat) return null;
  if (stat.isDirectory()) {
    const item = await fileItem({
      name: rel ? path.basename(rel) : "",
      rel,
      stat,
      kind: "directory",
      publicBasePath,
      fileCount: await directoryFileCount(abs),
    });
    await applyContentVisibility([item], { visibilityForPaths });
    return item;
  }
  if (!stat.isFile()) return null;
  const item = await fileItem({
    name: path.basename(rel),
    rel,
    stat,
    kind: fileKind(rel),
    filesDir: root,
    publicBasePath,
    thumbnailBasePath,
    onWebThumbnailNeeded,
  });
  await applyContentVisibility([item], { visibilityForPaths });
  return item;
}

export async function deleteUserFiles({ filesDir, paths, confirmName }) {
  const root = path.resolve(filesDir);
  const requestedRels = (Array.isArray(paths) ? paths : []).map((value) => safeUserRelativePath(value));
  const rels = uniqueTopLevelPaths(requestedRels);
  if (!rels.length) return { deleted: 0 };
  if (String(confirmName || "") !== DELETE_CONFIRM_TEXT) {
    const error = new Error("请输入 confirm 确认删除。");
    error.status = 400;
    throw error;
  }

  await fs.mkdir(root, { recursive: true });
  const trashRoot = path.join(root, TRASH_DIR);
  const trashItemsDir = path.join(trashRoot, TRASH_ITEMS_DIR);
  await fs.mkdir(trashItemsDir, { recursive: true });
  const manifest = await readTrashManifest(trashRoot);
  let deleted = 0;

  for (const rel of rels) {
    const target = path.resolve(root, rel);
    assertInside(root, target);
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) continue;
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
    const name = path.basename(rel);
    const trashRel = `${TRASH_ITEMS_DIR}/${id}/${name}`;
    const trashTarget = path.join(trashRoot, trashRel);
    await fs.mkdir(path.dirname(trashTarget), { recursive: true });
    const size = stat.isDirectory() ? await directorySize(target) : stat.size;
    const fileCount = stat.isDirectory() ? await directoryFileCount(target) : undefined;
    await movePath(target, trashTarget);
    if (stat.isFile()) await removeWebThumbnail({ filesDir: root, rel }).catch(() => {});
    manifest.items.unshift({
      id,
      name,
      originalPath: rel,
      trashPath: trashRel,
      kind: stat.isDirectory() ? "directory" : fileKind(name),
      size: stat.isDirectory() ? null : stat.size,
      totalSize: size,
      fileCount,
      deletedAt: new Date().toISOString(),
    });
    deleted += 1;
  }

  await writeTrashManifest(trashRoot, manifest);
  return { deleted };
}

export async function listTrashEntries({ filesDir }) {
  const root = path.resolve(filesDir);
  const trashRoot = path.join(root, TRASH_DIR);
  const manifest = await readTrashManifest(trashRoot);
  const items = [];

  for (const item of manifest.items) {
    const trashTarget = path.resolve(trashRoot, item.trashPath || "");
    assertInside(trashRoot, trashTarget);
    const stat = await fs.stat(trashTarget).catch(() => null);
    if (!stat) continue;
    items.push({
      id: item.id,
      name: item.name,
      originalPath: item.originalPath,
      kind: item.kind,
      size: item.size ?? null,
      totalSize: item.totalSize ?? (stat.isDirectory() ? await directorySize(trashTarget) : stat.size),
      fileCount: item.fileCount,
      deletedAt: item.deletedAt,
    });
  }

  items.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
  return { items };
}

export async function emptyTrash({ filesDir }) {
  const root = path.resolve(filesDir);
  const trashRoot = path.join(root, TRASH_DIR);
  assertInside(root, trashRoot);
  const manifest = await readTrashManifest(trashRoot);
  await fs.rm(trashRoot, { recursive: true, force: true });
  return { deleted: manifest.items.length };
}

export async function restoreTrashEntry({ filesDir, id }) {
  const root = path.resolve(filesDir);
  const trashRoot = path.join(root, TRASH_DIR);
  const manifest = await readTrashManifest(trashRoot);
  const itemIndex = manifest.items.findIndex((item) => item.id === String(id || ""));
  if (itemIndex < 0) {
    const error = new Error("回收站项目不存在。");
    error.status = 404;
    throw error;
  }

  const item = manifest.items[itemIndex];
  const originalRel = safeUserRelativePath(item.originalPath);
  const target = path.resolve(root, originalRel);
  const trashTarget = path.resolve(trashRoot, item.trashPath || "");
  assertInside(root, target);
  assertInside(trashRoot, trashTarget);

  const trashStat = await fs.stat(trashTarget).catch(() => null);
  if (!trashStat) {
    manifest.items.splice(itemIndex, 1);
    await writeTrashManifest(trashRoot, manifest);
    const error = new Error("回收站文件已经不存在。");
    error.status = 404;
    throw error;
  }

  const existing = await fs.stat(target).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing) {
    const error = new Error("原位置已经存在同名文件或目录，无法恢复。");
    error.status = 409;
    throw error;
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await movePath(trashTarget, target);
  manifest.items.splice(itemIndex, 1);
  await writeTrashManifest(trashRoot, manifest);
  await fs.rm(path.dirname(trashTarget), { recursive: true, force: true }).catch(() => {});
  return {
    restored: true,
    item: {
      id: item.id,
      name: item.name,
      originalPath: originalRel,
      kind: item.kind,
    },
  };
}

export async function createUserFolder({ filesDir, dir = "", name }) {
  const root = path.resolve(filesDir);
  const relDir = safeUserRelativePath(dir, { allowEmpty: true });
  const folderName = safeFolderName(name);
  const rel = relDir ? `${relDir}/${folderName}` : folderName;
  const target = path.resolve(root, rel);
  const parent = relDir ? path.resolve(root, relDir) : root;
  assertInside(root, parent);
  assertInside(root, target);
  await fs.mkdir(root, { recursive: true });
  const parentStat = await fs.stat(parent).catch((err) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (!parentStat?.isDirectory()) throw new Error("Parent folder does not exist.");
  const children = await fs.readdir(parent, { withFileTypes: true }).catch(() => []);
  if (children.filter((entry) => !entry.name.startsWith(".")).length >= MAX_DIRECTORY_CHILDREN) {
    throw statusError(`父目录项目过多，不能继续创建文件夹。`, 413);
  }
  const itemCount = await directoryItemCount(root);
  if (itemCount >= MAX_USER_FILE_ITEMS) {
    throw statusError(`用户文件数量已达到上限 ${MAX_USER_FILE_ITEMS}。`, 413);
  }

  const stat = await fs.stat(target).catch((err) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (stat) {
    const error = new Error("A folder or file with this name already exists.");
    error.status = 409;
    throw error;
  }

  await fs.mkdir(target);
  return { path: rel, name: folderName };
}

export async function getUserStorageUsage({ filesDir, quotaBytes }) {
  const root = path.resolve(filesDir);
  await fs.mkdir(root, { recursive: true });
  const usedBytes = await directorySize(root);
  return {
    usedBytes,
    quotaBytes: Number.isFinite(quotaBytes) && quotaBytes > 0 ? quotaBytes : configuredUserQuotaBytes(),
  };
}

export async function searchUserFiles({ filesDir, publicBasePath, thumbnailBasePath, onWebThumbnailNeeded, visibilityForPaths, query, limit = 10 }) {
  const root = path.resolve(filesDir);
  await fs.mkdir(root, { recursive: true });
  const q = String(query || "").trim().toLowerCase();
  if (!q) return { items: [] };

  const items = [];
  await collectSearchItems({
    root,
    dir: root,
    relDir: "",
    publicBasePath,
    thumbnailBasePath,
    onWebThumbnailNeeded,
    q,
    items,
    budget: walkBudget(),
  });
  items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  await applyContentVisibility(items, { visibilityForPaths });
  return { items: items.slice(0, Math.max(1, Math.min(Number(limit) || 10, 20))) };
}

export async function listPublishedContent({
  filesDir,
  publicBasePath,
  thumbnailBasePath,
  onWebThumbnailNeeded,
  visibilityForPaths,
  includePrivate = true,
  limit = 100,
}) {
  const root = path.resolve(filesDir);
  await fs.mkdir(root, { recursive: true });

  const items = [];
  await collectPublishedItems({
    root,
    dir: root,
    relDir: "",
    publicBasePath,
    thumbnailBasePath,
    onWebThumbnailNeeded,
    items,
    budget: walkBudget(),
  });

  items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  await applyContentVisibility(items, { visibilityForPaths });
  const visibleItems = includePrivate ? items : items.filter((item) => item.visibility === "public");
  return { items: visibleItems.slice(0, Math.max(1, Math.min(Number(limit) || 100, 200))) };
}

export function safeUserRelativePath(value, { allowEmpty = false } = {}) {
  const raw = String(value || "").replace(/\\/g, "/");
  if (path.isAbsolute(raw) || raw.includes("\0")) throw new Error("Invalid file path.");
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length) {
    if (allowEmpty) return "";
    throw new Error("Invalid file path.");
  }
  if (parts.some((part) => part === "." || part === ".." || part.startsWith(".") || /[\x00-\x1f]/.test(part))) {
    throw new Error("Invalid file path.");
  }
  assertPathPolicy(parts, "file path");
  return parts.join("/");
}

function safeFolderName(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.includes("/") || raw.includes("\\") || raw.includes("\0")) throw new Error("Invalid folder name.");
  if (raw === "." || raw === ".." || raw.startsWith(".") || /[\x00-\x1f]/.test(raw)) {
    throw new Error("Invalid folder name.");
  }
  assertPathPolicy([raw], "folder name");
  return raw;
}

async function fileItem({
  name,
  rel,
  stat,
  kind,
  filesDir,
  publicBasePath,
  thumbnailBasePath,
  onWebThumbnailNeeded,
  fileCount,
}) {
  const encoded = rel.split("/").map(encodeURIComponent).join("/");
  const item = {
    name,
    path: rel,
    kind,
    size: stat.isDirectory() ? null : stat.size,
    fileCount: stat.isDirectory() ? fileCount ?? 0 : undefined,
    updatedAt: stat.mtime.toISOString(),
    url: kind === "directory" ? null : `${publicBasePath}/${encoded}`,
  };
  if (filesDir && kind === "web" && isWebPagePath(rel)) {
    const webTitle = await readWebPageTitle({ filesDir, rel });
    if (webTitle) item.webTitle = webTitle;
  }
  const thumbnail = filesDir && (kind === "web" || kind === "markdown")
    ? await webThumbnailInfo({ filesDir, rel, sourceStat: stat, thumbnailBasePath })
    : null;
  if (thumbnail) {
    item.thumbnailUrl = thumbnail.url;
    item.thumbnailStatus = thumbnail.status;
    item.thumbnailUpdatedAt = thumbnail.updatedAt;
    if (thumbnail.status !== "ready" && typeof onWebThumbnailNeeded === "function" && isWebPagePath(rel)) {
      onWebThumbnailNeeded(rel, item.url);
    }
  }
  return item;
}

async function applyContentVisibility(items, { visibilityForPaths } = {}) {
  const contentItems = items.filter((item) => item.kind === "markdown" || (item.kind === "web" && isWebPagePath(item.path)));
  if (!contentItems.length) return;
  const paths = contentItems.map((item) => item.path);
  const map = typeof visibilityForPaths === "function" ? await visibilityForPaths(paths) : new Map();
  for (const item of contentItems) {
    item.visibility = map.get(item.path) || "private";
  }
}

async function readWebPageTitle({ filesDir, rel }) {
  const root = path.resolve(filesDir);
  const abs = path.resolve(root, rel);
  assertInside(root, abs);
  const html = await fs.readFile(abs, "utf8").catch(() => "");
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const title = decodeHtmlTitle(match[1]).replace(/\s+/g, " ").trim();
  return title || null;
}

function decodeHtmlTitle(value) {
  return String(value || "").replace(HTML_TITLE_ENTITY_RE, (entity, body) => {
    const key = String(body).toLowerCase();
    if (key === "amp") return "&";
    if (key === "lt") return "<";
    if (key === "gt") return ">";
    if (key === "quot") return "\"";
    if (key === "apos") return "'";
    if (key === "nbsp") return " ";
    if (key.startsWith("#x")) return decodeCodePoint(Number.parseInt(key.slice(2), 16), entity);
    if (key.startsWith("#")) return decodeCodePoint(Number.parseInt(key.slice(1), 10), entity);
    return entity;
  });
}

function decodeCodePoint(codePoint, fallback) {
  if (!Number.isFinite(codePoint)) return fallback;
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return fallback;
  }
}

function fileKind(name) {
  const ext = path.extname(name).toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (WEB_EXTENSIONS.has(ext)) return "web";
  return "other";
}

function matchesType(kind, type) {
  if (type === "all") return true;
  if (type === "web") return kind === "web";
  if (type === "markdown") return kind === "markdown";
  if (type === "images") return kind === "image";
  if (type === "other") return kind === "other";
  return true;
}

async function directoryContainsType(dir, type, depth = 0, budget = walkBudget()) {
  tickWalk(budget);
  if (depth > MAX_PATH_DEPTH) throw statusError(`目录层级超过上限 ${MAX_PATH_DEPTH}。`, 413);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (await directoryContainsType(abs, type, depth + 1, budget)) return true;
    } else if (entry.isFile() && matchesType(fileKind(entry.name), type)) {
      return true;
    }
  }
  return false;
}

async function directorySize(dir, depth = 0, budget = walkBudget()) {
  tickWalk(budget);
  if (depth > MAX_PATH_DEPTH) throw statusError(`目录层级超过上限 ${MAX_PATH_DEPTH}。`, 413);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(abs, depth + 1, budget);
    else if (entry.isFile()) {
      const stat = await fs.stat(abs).catch(() => null);
      if (stat?.isFile()) total += stat.size;
    }
  }
  return total;
}

async function collectSearchItems({
  root,
  dir,
  relDir,
  publicBasePath,
  thumbnailBasePath,
  onWebThumbnailNeeded,
  q,
  items,
  depth = 0,
  budget = walkBudget(),
}) {
  tickWalk(budget);
  if (depth > MAX_PATH_DEPTH) throw statusError(`目录层级超过上限 ${MAX_PATH_DEPTH}。`, 413);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) continue;

    if (entry.name.toLowerCase().includes(q) || rel.toLowerCase().includes(q)) {
      items.push(await fileItem({
        name: entry.name,
        rel,
        stat,
        kind: stat.isDirectory() ? "directory" : fileKind(entry.name),
        filesDir: root,
        publicBasePath,
        thumbnailBasePath,
        onWebThumbnailNeeded,
        fileCount: stat.isDirectory() ? await directoryFileCount(abs) : undefined,
      }));
    }

    if (entry.isDirectory()) {
      const target = path.resolve(root, rel);
      assertInside(root, target);
      await collectSearchItems({
        root,
        dir: abs,
        relDir: rel,
        publicBasePath,
        thumbnailBasePath,
        onWebThumbnailNeeded,
        q,
        items,
        depth: depth + 1,
        budget,
      });
    }
  }
}

async function collectPublishedItems({
  root,
  dir,
  relDir,
  publicBasePath,
  thumbnailBasePath,
  onWebThumbnailNeeded,
  items,
  depth = 0,
  budget = walkBudget(),
}) {
  tickWalk(budget);
  if (depth > MAX_PATH_DEPTH) throw statusError(`目录层级超过上限 ${MAX_PATH_DEPTH}。`, 413);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) continue;

    if (entry.isDirectory()) {
      const target = path.resolve(root, rel);
      assertInside(root, target);
      await collectPublishedItems({
        root,
        dir: abs,
        relDir: rel,
        publicBasePath,
        thumbnailBasePath,
        onWebThumbnailNeeded,
        items,
        depth: depth + 1,
        budget,
      });
      continue;
    }

    if (!entry.isFile()) continue;
    const kind = fileKind(entry.name);
    if (kind !== "markdown" && !isWebPagePath(rel)) continue;
    items.push(await fileItem({
      name: entry.name,
      rel,
      stat,
      kind,
      filesDir: root,
      publicBasePath,
      thumbnailBasePath,
      onWebThumbnailNeeded,
    }));
  }
}

async function directoryFileCount(dir, depth = 0, budget = walkBudget()) {
  tickWalk(budget);
  if (depth > MAX_PATH_DEPTH) throw statusError(`目录层级超过上限 ${MAX_PATH_DEPTH}。`, 413);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) count += await directoryFileCount(abs, depth + 1, budget);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

async function directoryItemCount(dir, depth = 0, budget = walkBudget()) {
  tickWalk(budget);
  if (depth > MAX_PATH_DEPTH) throw statusError(`目录层级超过上限 ${MAX_PATH_DEPTH}。`, 413);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) count += 1 + await directoryItemCount(abs, depth + 1, budget);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

function walkBudget() {
  return { items: 0 };
}

function tickWalk(budget) {
  budget.items += 1;
  if (budget.items > MAX_WALK_ITEMS) {
    throw statusError(`目录项目过多，操作已停止。`, 413);
  }
}

function parentPath(rel) {
  if (!rel) return null;
  const parts = rel.split("/");
  parts.pop();
  return parts.join("/");
}

function assertInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid file path.");
  }
}

function uniqueTopLevelPaths(rels) {
  const sorted = [...new Set(rels)].sort((a, b) => a.length - b.length);
  const result = [];
  for (const rel of sorted) {
    if (result.some((parent) => rel === parent || rel.startsWith(`${parent}/`))) continue;
    result.push(rel);
  }
  return result;
}

async function movePath(source, target) {
  try {
    await fs.rename(source, target);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    await fs.cp(source, target, { recursive: true, force: false, errorOnExist: true });
    await fs.rm(source, { recursive: true, force: true });
  }
}

async function readTrashManifest(trashRoot) {
  const file = path.join(trashRoot, TRASH_MANIFEST);
  const text = await fs.readFile(file, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!text) return { version: 1, items: [] };
  try {
    const parsed = JSON.parse(text);
    return { version: 1, items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch {
    return { version: 1, items: [] };
  }
}

async function writeTrashManifest(trashRoot, manifest) {
  await fs.mkdir(trashRoot, { recursive: true });
  const file = path.join(trashRoot, TRASH_MANIFEST);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify({ version: 1, items: manifest.items }, null, 2)}\n`);
  await fs.rename(tmp, file);
}
