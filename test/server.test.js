import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { test } from "node:test";
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
