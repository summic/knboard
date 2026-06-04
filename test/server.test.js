import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "node:test";
import { runCli } from "../src/cli/index.js";
import { createServerApp } from "../src/server/index.js";

async function withServer(t, options = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "knbox-test-"));
  const created = await createServerApp({
    dataDir,
    publicUrl: "https://box.beforeve.com",
    filesPublicUrl: options.filesPublicUrl || "",
    serveWeb: false,
  });
  const server = createServer(created.app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    created.auth.db.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return { ...created, baseUrl, dataDir };
}

function createUserAndToken(auth, username = "allen") {
  const user = auth.upsertExternalUser({
    provider: "kylith",
    subject: `subject-${username}`,
    username,
    email: `${username}@example.com`,
    name: username,
  });
  const { token } = auth.createCliToken(user.id, "test token");
  return { user, token };
}

async function readJson(res) {
  const body = await res.json().catch(() => ({}));
  return body;
}

async function request(baseUrl, targetPath, { method = "GET", headers = {}, body } = {}) {
  const url = new URL(targetPath, baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        text += chunk;
      });
      res.on("end", () => resolve({ res, body: text }));
    });
    req.on("error", reject);
    if (body) req.end(body);
    else req.end();
  });
}

async function runCliJson(argv, token) {
  const originalLog = console.log;
  const originalToken = process.env.KNBOX_TOKEN;
  const lines = [];
  console.log = (value = "") => lines.push(String(value));
  process.env.KNBOX_TOKEN = token;
  try {
    await runCli([...argv, "--json", "--quiet"]);
  } finally {
    console.log = originalLog;
    if (originalToken === undefined) delete process.env.KNBOX_TOKEN;
    else process.env.KNBOX_TOKEN = originalToken;
  }
  return JSON.parse(lines.join("\n") || "null");
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

test("password login endpoint is removed and no default admin is seeded", async (t) => {
  const { auth, baseUrl } = await withServer(t);
  assert.equal(auth.listUsers().length, 0);

  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  assert.equal(res.status, 404);
});

test("protected APIs require authentication", async (t) => {
  const { baseUrl } = await withServer(t);
  const checks = [
    fetch(`${baseUrl}/api/auth/me`),
    fetch(`${baseUrl}/api/files`),
    fetch(`${baseUrl}/api/files/search?q=a`),
    fetch(`${baseUrl}/api/files/entry?path=a.md`),
    fetch(`${baseUrl}/api/storage`),
    fetch(`${baseUrl}/api/trash`),
    fetch(`${baseUrl}/api/files`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: ["a.md"], confirmName: "a.md" }),
    }),
    fetch(`${baseUrl}/api/trash`, { method: "DELETE" }),
  ];
  for (const response of await Promise.all(checks)) {
    assert.equal(response.status, 401);
  }
});

test("admin APIs require admin role and are scoped by explicit admin route", async (t) => {
  const { auth, baseUrl } = await withServer(t);
  const normal = createUserAndToken(auth, "normal");
  const admin = createUserAndToken(auth, "admin");
  auth.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.user.id);

  const normalUsersRes = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Authorization: `Bearer ${normal.token}` },
  });
  assert.equal(normalUsersRes.status, 403);

  const adminUsersRes = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(adminUsersRes.status, 200);
  assert.equal((await readJson(adminUsersRes)).items.length, 2);

  const normalDir = auth.userUploadsDir(normal.user);
  await fs.mkdir(normalDir, { recursive: true });
  await fs.writeFile(path.join(normalDir, "visible.md"), "# Visible");
  const adminFilesRes = await fetch(`${baseUrl}/api/admin/users/${normal.user.id}/files`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(adminFilesRes.status, 200);
  assert.deepEqual((await readJson(adminFilesRes)).items.map((item) => item.name), ["visible.md"]);

  const missingUserRes = await fetch(`${baseUrl}/api/admin/users/999/files`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(missingUserRes.status, 404);
});

test("public files host cannot access app APIs", async (t) => {
  const { auth, baseUrl } = await withServer(t, { filesPublicUrl: "https://b.beforeve.com" });
  const { user } = createUserAndToken(auth);
  const uploadsDir = auth.userUploadsDir(user);
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.writeFile(path.join(uploadsDir, "index.html"), "<h1>ok</h1>");

  const { res: apiRes } = await request(baseUrl, "/api/auth/config", { headers: { Host: "b.beforeve.com" } });
  assert.equal(apiRes.statusCode, 404);

  const { res: fileRes, body } = await request(baseUrl, `/u/${user.username}/index.html`, {
    headers: { Host: "b.beforeve.com" },
  });
  assert.equal(fileRes.statusCode, 200);
  assert.match(body, /<h1>ok<\/h1>/);
});

test("public file routes serve markdown, directory indexes, and safe errors", async (t) => {
  const { auth, baseUrl } = await withServer(t);
  const { user } = createUserAndToken(auth, "publicuser");
  const uploadsDir = auth.userUploadsDir(user);
  await fs.mkdir(path.join(uploadsDir, "site"), { recursive: true });
  await fs.writeFile(path.join(uploadsDir, "readme.md"), "# Hello <script>");
  await fs.writeFile(path.join(uploadsDir, "site", "index.html"), "<h1>Site</h1>");
  await fs.mkdir(path.join(uploadsDir, "empty-dir"), { recursive: true });

  const markdownRes = await fetch(`${baseUrl}/u/${user.username}/readme.md`);
  assert.equal(markdownRes.status, 200);
  assert.match(markdownRes.headers.get("content-type") || "", /text\/html/);
  assert.match(await markdownRes.text(), /Hello/);

  const { res: redirectRes } = await request(baseUrl, `/u/${user.username}/site`);
  assert.equal(redirectRes.statusCode, 301);
  assert.equal(redirectRes.headers.location, `/u/${user.username}/site/`);

  const indexRes = await fetch(`${baseUrl}/u/${user.username}/site/`);
  assert.equal(indexRes.status, 200);
  assert.match(await indexRes.text(), /<h1>Site<\/h1>/);

  const forbiddenRes = await fetch(`${baseUrl}/u/${user.username}/empty-dir/`);
  assert.equal(forbiddenRes.status, 403);
  assert.match(await forbiddenRes.text(), /不允许浏览目录/);

  const missingRes = await fetch(`${baseUrl}/u/${user.username}/missing.md`);
  assert.equal(missingRes.status, 404);
  assert.match(await missingRes.text(), /页面不存在/);
});

test("authenticated upload rejects path traversal and accepts normal files", async (t) => {
  const { auth, baseUrl } = await withServer(t);
  const { token } = createUserAndToken(auth);
  const originalConsoleError = console.error;
  t.after(() => {
    console.error = originalConsoleError;
  });

  const badForm = new FormData();
  badForm.set("file", new Blob(["bad"], { type: "text/html" }), "bad.html");
  badForm.set("targetRelativePath", "../bad.html");
  console.error = () => {};
  const badRes = await fetch(`${baseUrl}/api/uploads/file`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: badForm,
  });
  console.error = originalConsoleError;
  assert.equal(badRes.status, 400);

  const okForm = new FormData();
  okForm.set("file", new Blob(["# Hello"], { type: "text/markdown" }), "hello.md");
  okForm.set("targetRelativePath", "docs/hello.md");
  const okRes = await fetch(`${baseUrl}/api/uploads/file`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: okForm,
  });
  assert.equal(okRes.status, 200);
  assert.equal((await readJson(okRes)).file.path, "docs/hello.md");
});

test("upload APIs report conflicts and enforce quota without storing rejected files", async (t) => {
  withEnv(t, "KNBOX_USER_QUOTA_BYTES", "4");
  const { auth, baseUrl } = await withServer(t);
  const { user, token } = createUserAndToken(auth, "quota");
  const uploadsDir = auth.userUploadsDir(user);
  await fs.mkdir(path.join(uploadsDir, "docs", "site"), { recursive: true });
  await fs.writeFile(path.join(uploadsDir, "docs", "site", "index.html"), "ok");
  await fs.writeFile(path.join(uploadsDir, "docs", "hello.md"), "ok");

  const conflictRes = await fetch(`${baseUrl}/api/uploads/conflicts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      baseDir: "docs",
      paths: ["docs/site/index.html", "docs/hello.md"],
      totalBytes: 3,
    }),
  });
  assert.equal(conflictRes.status, 200);
  const conflicts = await readJson(conflictRes);
  assert.deepEqual(conflicts.conflicts, [
    { path: "docs/site/index.html", type: "file" },
    { path: "docs/site", type: "directory" },
    { path: "docs/hello.md", type: "file" },
  ]);

  const originalConsoleError = console.error;
  t.after(() => {
    console.error = originalConsoleError;
  });
  const tooLargeForm = new FormData();
  tooLargeForm.set("file", new Blob(["12345"], { type: "text/markdown" }), "too-large.md");
  tooLargeForm.set("targetRelativePath", "too-large.md");
  console.error = () => {};
  const tooLargeRes = await fetch(`${baseUrl}/api/uploads/file`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: tooLargeForm,
  });
  console.error = originalConsoleError;
  assert.equal(tooLargeRes.status, 413);
  assert.equal(await exists(path.join(uploadsDir, "too-large.md")), false);
});

test("delete moves files to trash and restore returns them to original path", async (t) => {
  const { auth, baseUrl } = await withServer(t);
  const { token } = createUserAndToken(auth);
  const uploadsDir = auth.userUploadsDir({ username: "allen" });
  await fs.mkdir(path.join(uploadsDir, "docs"), { recursive: true });
  await fs.writeFile(path.join(uploadsDir, "docs", "note.md"), "# Note");

  const deleteRes = await fetch(`${baseUrl}/api/files`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ paths: ["docs/note.md"], confirmName: "note.md" }),
  });
  assert.equal(deleteRes.status, 200);
  assert.equal(await exists(path.join(uploadsDir, "docs", "note.md")), false);

  const trashRes = await fetch(`${baseUrl}/api/trash`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(trashRes.status, 200);
  const trash = await readJson(trashRes);
  assert.equal(trash.items.length, 1);

  const restoreRes = await fetch(`${baseUrl}/api/trash/${trash.items[0].id}/restore`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(restoreRes.status, 200);
  assert.equal(await fs.readFile(path.join(uploadsDir, "docs", "note.md"), "utf8"), "# Note");
});

test("delete API is scoped to the authenticated user's files", async (t) => {
  const { auth, baseUrl } = await withServer(t);
  const alice = createUserAndToken(auth, "alice");
  const bob = createUserAndToken(auth, "bob");
  const originalConsoleError = console.error;
  t.after(() => {
    console.error = originalConsoleError;
  });
  const aliceDir = auth.userUploadsDir(alice.user);
  const bobDir = auth.userUploadsDir(bob.user);
  await fs.mkdir(aliceDir, { recursive: true });
  await fs.mkdir(bobDir, { recursive: true });
  await fs.writeFile(path.join(aliceDir, "shared.md"), "# Alice");
  await fs.writeFile(path.join(bobDir, "shared.md"), "# Bob");
  await fs.writeFile(path.join(bobDir, "secret.md"), "# Bob secret");

  const deleteOwnRes = await fetch(`${baseUrl}/api/files`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${alice.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ paths: ["shared.md"], confirmName: "shared.md" }),
  });
  assert.equal(deleteOwnRes.status, 200);
  assert.equal(await exists(path.join(aliceDir, "shared.md")), false);
  assert.equal(await fs.readFile(path.join(bobDir, "shared.md"), "utf8"), "# Bob");

  console.error = () => {};
  const traversalRes = await fetch(`${baseUrl}/api/files`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${alice.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ paths: ["../bob/secret.md"], confirmName: "secret.md" }),
  });
  console.error = originalConsoleError;
  assert.equal(traversalRes.status, 400);
  assert.equal(await fs.readFile(path.join(bobDir, "secret.md"), "utf8"), "# Bob secret");

  const missingOwnRes = await fetch(`${baseUrl}/api/files`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${alice.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ paths: ["secret.md"], confirmName: "secret.md" }),
  });
  assert.equal(missingOwnRes.status, 200);
  assert.equal((await readJson(missingOwnRes)).deleted, 0);
  assert.equal(await fs.readFile(path.join(bobDir, "secret.md"), "utf8"), "# Bob secret");
});

test("empty trash API only clears the authenticated user's trash", async (t) => {
  const { auth, baseUrl } = await withServer(t);
  const alice = createUserAndToken(auth, "alice");
  const bob = createUserAndToken(auth, "bob");
  const aliceDir = auth.userUploadsDir(alice.user);
  const bobDir = auth.userUploadsDir(bob.user);
  await fs.mkdir(aliceDir, { recursive: true });
  await fs.mkdir(bobDir, { recursive: true });
  await fs.writeFile(path.join(aliceDir, "old.md"), "# Alice old");
  await fs.writeFile(path.join(bobDir, "old.md"), "# Bob old");

  for (const { token } of [alice, bob]) {
    const res = await fetch(`${baseUrl}/api/files`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ paths: ["old.md"], confirmName: "old.md" }),
    });
    assert.equal(res.status, 200);
  }

  const emptyAliceRes = await fetch(`${baseUrl}/api/trash`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${alice.token}` },
  });
  assert.equal(emptyAliceRes.status, 200);
  assert.equal((await readJson(emptyAliceRes)).deleted, 1);

  const aliceTrashRes = await fetch(`${baseUrl}/api/trash`, { headers: { Authorization: `Bearer ${alice.token}` } });
  const bobTrashRes = await fetch(`${baseUrl}/api/trash`, { headers: { Authorization: `Bearer ${bob.token}` } });
  assert.equal((await readJson(aliceTrashRes)).items.length, 0);
  assert.equal((await readJson(bobTrashRes)).items.length, 1);
});

test("CLI rm and trash empty use the authenticated user's API scope", async (t) => {
  const { auth, baseUrl } = await withServer(t);
  const { user, token } = createUserAndToken(auth, "cliuser");
  const uploadsDir = auth.userUploadsDir(user);
  await fs.mkdir(path.join(uploadsDir, "docs"), { recursive: true });
  await fs.writeFile(path.join(uploadsDir, "docs", "note.md"), "# CLI");

  const removed = await runCliJson(["rm", "/docs/note.md", "--server", baseUrl], token);
  assert.deepEqual(removed.paths, ["docs/note.md"]);
  assert.equal(removed.deleted, 1);
  assert.equal(await exists(path.join(uploadsDir, "docs", "note.md")), false);

  const trash = await runCliJson(["trash", "--server", baseUrl], token);
  assert.equal(trash.items.length, 1);
  assert.equal(trash.items[0].originalPath, "docs/note.md");

  const emptied = await runCliJson(["trash", "empty", "--yes", "--server", baseUrl], token);
  assert.equal(emptied.deleted, 1);
  assert.equal((await runCliJson(["trash", "--server", baseUrl], token)).items.length, 0);
});

test("app responses include security headers", async (t) => {
  const { baseUrl } = await withServer(t, { filesPublicUrl: "https://b.beforeve.com" });
  const { res } = await request(baseUrl, "/api/auth/config");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.match(res.headers["content-security-policy"] || "", /default-src 'self'/);
});

test("cookie-session write requests reject unexpected origins", async (t) => {
  const { baseUrl } = await withServer(t);
  const { res } = await request(baseUrl, "/api/auth/logout", {
    method: "POST",
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(res.statusCode, 403);
});

async function exists(target) {
  return fs.stat(target).then(() => true).catch((error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
}
