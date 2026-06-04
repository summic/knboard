import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "node:test";
import { renderForbiddenDocument, renderMarkdownDocument, renderNotFoundDocument } from "../src/server/markdown-renderer.js";
import { safeReturnTo } from "../src/server/kylith-sso.js";
import {
  assertBatchLimits,
  assertPathPolicy,
  configuredUserQuotaBytes,
  DEFAULT_USER_QUOTA_BYTES,
  formatBytes,
  MAX_PATH_DEPTH,
  MAX_UPLOAD_BATCH_BYTES,
  MAX_UPLOAD_FILES_PER_BATCH,
  positiveInteger,
} from "../src/server/storage-policy.js";
import {
  createUserFolder,
  deleteUserFiles,
  emptyTrash,
  getUserFileEntry,
  getUserStorageUsage,
  listTrashEntries,
  listUserFiles,
  restoreTrashEntry,
  safeUserRelativePath,
  searchUserFiles,
} from "../src/server/user-files.js";
import {
  resolveUserFileConflicts,
  storeUserFile,
} from "../src/server/uploads.js";

async function withTempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "knbox-unit-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function writeFile(target, content = "content") {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function exists(target) {
  return fs.stat(target).then(() => true).catch((error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
}

function withEnv(t, key, value) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = String(value);
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

test("storage policy parses limits and reports status errors", (t) => {
  assert.equal(positiveInteger("42.9", 1), 42);
  assert.equal(positiveInteger("-1", 7), 7);
  assert.equal(formatBytes(999), "999B");
  assert.equal(formatBytes(2048), "2KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5MB");

  withEnv(t, "KNBOX_USER_QUOTA_BYTES", "1234");
  assert.equal(configuredUserQuotaBytes(), 1234);
  process.env.KNBOX_USER_QUOTA_BYTES = "not-a-number";
  assert.equal(configuredUserQuotaBytes(), DEFAULT_USER_QUOTA_BYTES);

  assert.doesNotThrow(() => assertBatchLimits(["a.md"], 10));
  assert.throws(() => assertBatchLimits(Array(MAX_UPLOAD_FILES_PER_BATCH + 1).fill("a.md")), { status: 413 });
  assert.throws(() => assertBatchLimits(["a.md"], MAX_UPLOAD_BATCH_BYTES + 1), { status: 413 });
  assert.doesNotThrow(() => assertPathPolicy(Array(MAX_PATH_DEPTH).fill("x"), "upload path"));
  assert.throws(() => assertPathPolicy(Array(MAX_PATH_DEPTH + 1).fill("x"), "upload path"), { status: 400 });
  assert.throws(() => assertPathPolicy(["x".repeat(121)], "upload path"), { status: 400 });
});

test("safe user paths reject traversal, hidden names, and absolute paths", () => {
  assert.equal(safeUserRelativePath("docs/guide.md"), "docs/guide.md");
  assert.equal(safeUserRelativePath("docs\\guide.md"), "docs/guide.md");
  assert.equal(safeUserRelativePath("", { allowEmpty: true }), "");
  assert.throws(() => safeUserRelativePath(""));
  assert.throws(() => safeUserRelativePath("../secret.md"));
  assert.throws(() => safeUserRelativePath("/secret.md"));
  assert.throws(() => safeUserRelativePath(".knbox-trash/item"));
  assert.throws(() => safeUserRelativePath("docs/\u0000bad.md"));
});

test("user files list, search, create, delete, restore, and empty trash", async (t) => {
  const root = await withTempDir(t);
  await writeFile(path.join(root, "docs", "guide.md"), "# Guide");
  await writeFile(path.join(root, "docs", "site.html"), "<h1>Site</h1>");
  await writeFile(path.join(root, "images", "logo.png"), "png");
  await writeFile(path.join(root, ".hidden.md"), "hidden");

  const created = await createUserFolder({ filesDir: root, dir: "docs", name: "drafts" });
  assert.deepEqual(created, { path: "docs/drafts", name: "drafts" });
  await assert.rejects(() => createUserFolder({ filesDir: root, dir: "docs", name: "../bad" }));

  const rootListing = await listUserFiles({ filesDir: root, publicBasePath: "/u/alice" });
  assert.deepEqual(rootListing.items.map((item) => item.name), ["docs", "images"]);
  const webListing = await listUserFiles({ filesDir: root, publicBasePath: "/u/alice", dir: "docs", type: "web" });
  assert.deepEqual(webListing.items.map((item) => item.name), ["guide.md", "site.html"]);

  const guide = await getUserFileEntry({ filesDir: root, publicBasePath: "/u/alice", target: "docs/guide.md" });
  assert.equal(guide.url, "/u/alice/docs/guide.md");
  assert.equal((await searchUserFiles({ filesDir: root, publicBasePath: "/u/alice", query: "guide" })).items.length, 1);
  assert.equal((await getUserStorageUsage({ filesDir: root, quotaBytes: 99 })).quotaBytes, 99);

  const deleted = await deleteUserFiles({ filesDir: root, paths: ["docs", "docs/guide.md"], confirmName: "docs" });
  assert.equal(deleted.deleted, 1);
  assert.equal(await exists(path.join(root, "docs")), false);
  const trash = await listTrashEntries({ filesDir: root });
  assert.equal(trash.items.length, 1);
  assert.equal(trash.items[0].originalPath, "docs");

  const restored = await restoreTrashEntry({ filesDir: root, id: trash.items[0].id });
  assert.equal(restored.restored, true);
  assert.equal(await exists(path.join(root, "docs", "guide.md")), true);

  await deleteUserFiles({ filesDir: root, paths: ["docs/site.html"], confirmName: "site.html" });
  assert.equal((await emptyTrash({ filesDir: root })).deleted, 1);
  assert.equal((await listTrashEntries({ filesDir: root })).items.length, 0);
});

test("upload storage rejects unsafe files and resolves conflicts", async (t) => {
  const root = await withTempDir(t);
  const publicBasePath = "/u/alice";
  await writeFile(path.join(root, "docs", "page.md"), "# Existing");
  await writeFile(path.join(root, "docs", "site", "index.html"), "<h1>Existing</h1>");

  await assert.rejects(() => storeUserFile({
    tmpPath: path.join(root, "missing.tmp"),
    originalName: "../bad.md",
    filesDir: root,
    publicBasePath,
  }));

  const hiddenTmp = path.join(root, "tmp-hidden");
  await writeFile(hiddenTmp, "hidden");
  await assert.rejects(() => storeUserFile({
    tmpPath: hiddenTmp,
    originalName: ".secret.md",
    filesDir: root,
    publicBasePath,
  }));

  const unsupportedTmp = path.join(root, "tmp-unsupported");
  await writeFile(unsupportedTmp, "bin");
  await assert.rejects(() => storeUserFile({
    tmpPath: unsupportedTmp,
    originalName: "file.exe",
    filesDir: root,
    publicBasePath,
  }));

  const renameTmp = path.join(root, "tmp-rename");
  await writeFile(renameTmp, "# New");
  const renamed = await storeUserFile({
    tmpPath: renameTmp,
    originalName: "page.md",
    targetRelativePath: "docs/page.md",
    conflictMode: "rename",
    filesDir: root,
    publicBasePath,
  });
  assert.equal(renamed.path, "docs/page (2).md");
  assert.equal(renamed.url, "/u/alice/docs/page%20(2).md");

  const overwriteTmp = path.join(root, "tmp-overwrite");
  await writeFile(overwriteTmp, "# Overwritten");
  const overwritten = await storeUserFile({
    tmpPath: overwriteTmp,
    originalName: "page.md",
    targetRelativePath: "docs/page.md",
    conflictMode: "overwrite",
    filesDir: root,
    publicBasePath,
  });
  assert.equal(overwritten.path, "docs/page.md");
  assert.equal(await fs.readFile(path.join(root, "docs", "page.md"), "utf8"), "# Overwritten");

  const conflicts = await resolveUserFileConflicts({
    filesDir: root,
    baseDir: "docs",
    paths: ["docs/site/index.html", "docs/page.md"],
  });
  assert.deepEqual(conflicts.conflicts, [
    { path: "docs/site/index.html", type: "file" },
    { path: "docs/site", type: "directory" },
    { path: "docs/page.md", type: "file" },
  ]);
  assert.equal(conflicts.renamedPaths["docs/site/index.html"], "docs/site (2)/index.html");
  assert.equal(conflicts.renamedPaths["docs/page.md"], "docs/page (3).md");
});

test("renderers and SSO helpers escape unsafe values", () => {
  assert.equal(safeReturnTo("/docs?a=1"), "/docs?a=1");
  assert.equal(safeReturnTo("https://evil.example"), "/");
  assert.equal(safeReturnTo("//evil.example"), "/");

  const markdown = renderMarkdownDocument("# Title <script>", { title: "<bad>" });
  assert.match(markdown, /&lt;bad&gt;/);
  assert.doesNotMatch(markdown, /<title><bad><\/title>/);

  const notFound = renderNotFoundDocument({ path: "/x?<script>" });
  assert.match(notFound, /\/x\?&lt;script&gt;/);
  const forbidden = renderForbiddenDocument({ message: "<script>alert(1)</script>" });
  assert.match(forbidden, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
