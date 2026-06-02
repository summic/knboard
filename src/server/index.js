import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { createAuth, setSessionCookie } from "./auth.js";
import { createKylithSso, safeReturnTo } from "./kylith-sso.js";
import {
  createFileUploadMiddleware,
  removeUpload,
  resolveUserFileConflicts,
  storeUserFile,
} from "./uploads.js";
import { renderForbiddenDocument, renderMarkdownDocument, renderNotFoundDocument } from "./markdown-renderer.js";
import {
  configuredUserQuotaBytes,
  MAX_UPLOAD_BATCH_BYTES,
  MAX_UPLOAD_FILES_PER_BATCH,
  statusError,
} from "./storage-policy.js";
import {
  createUserFolder,
  deleteUserFiles,
  emptyTrash,
  getUserFileEntry,
  getUserStorageUsage,
  listTrashEntries,
  listUserFiles,
  restoreTrashEntry,
  searchUserFiles,
} from "./user-files.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, "../../dist/web");

function asyncRoute(fn) {
  return (req, res, next) =>
    fn(req, res, next).catch((err) => {
      console.error(err);
      res.status(err.status || 400).json({ error: err.message });
    });
}

export function createApi({ auth }) {
  const api = express.Router();
  api.use(express.json({ limit: "4mb" }));
  api.use(auth.requireUser);

  api.get("/project", asyncRoute(async (req, res) => {
    res.json({ title: "KN Box", description: "Upload and browse files.", categories: [], readme: null });
  }));

  return api;
}

// Listen on `startPort`, falling back to the next free port if it's taken,
// so a busy port never crashes the CLI with an unhandled EADDRINUSE.
function listen(app, startPort, maxTries = 20) {
  const tryPort = (p, triesLeft) =>
    new Promise((resolve, reject) => {
      const server = app.listen(p);
      server.once("listening", () => resolve(p));
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE" && triesLeft > 0) {
          resolve(tryPort(p + 1, triesLeft - 1));
        } else {
          reject(err);
        }
      });
    });
  return tryPort(startPort, maxTries);
}

export async function startServer({ port = 6789, open = false } = {}) {
  const dataDir = path.resolve(process.env.KNBOX_DATA_DIR || path.join(process.cwd(), "data"));
  const auth = await createAuth({ dataDir });
  const publicUrl = process.env.KNBOX_PUBLIC_URL || `http://localhost:${port}`;
  const filesPublicUrl = cleanPublicUrl(process.env.KNBOX_FILES_PUBLIC_URL || "");
  const filesPublicHost = filesPublicUrl ? new URL(filesPublicUrl).host.toLowerCase() : null;
  const kylithSso = createKylithSso({ publicUrl, sessionSecret: auth.sessionSecret });
  const fileUpload = createFileUploadMiddleware({ dataDir });
  const app = express();
  app.use((req, res, next) => {
    if (!filesPublicHost) return next();
    if (requestHost(req) !== filesPublicHost) return next();
    if (req.path.startsWith("/u/")) return next();
    res.status(404).type("text").send("Not found");
  });
  app.use(auth.loadUser);

  app.get("/api/auth/config", (_req, res) => {
    res.json({
      kylithSso: {
        enabled: kylithSso.configured,
        issuer: kylithSso.configured ? kylithSso.issuer : null,
      },
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required." });
    return res.json({ user: req.user });
  });

  app.get("/api/cli/oauth/complete", auth.requireUser, (req, res) => {
    const callback = safeLoopbackCallback(req.query.callback);
    if (!callback) return res.status(400).json({ error: "Invalid CLI callback URL." });

    const { token } = auth.createCliToken(req.user.id, "KN Box CLI");
    callback.searchParams.set("token", token);
    callback.searchParams.set("server", publicUrl.replace(/\/$/, ""));
    callback.searchParams.set("username", req.user.username);
    if (req.query.state) callback.searchParams.set("state", String(req.query.state));
    return res.redirect(callback.toString());
  });

  app.post("/api/auth/login", express.json({ limit: "64kb" }), asyncRoute(async (req, res) => {
    const user = await auth.verifyLogin(req.body?.username, req.body?.password);
    if (!user) return res.status(401).json({ error: "Invalid username or password." });
    setSessionCookie(req, res, auth.createSession(user.id));
    return res.json({ user });
  }));

  app.get("/api/auth/kylith/start", asyncRoute(async (req, res) => {
    if (!kylithSso.configured) return res.status(503).json({ error: "KYLITH SSO is not configured." });
    const { url, stateCookie } = await kylithSso.authorizationUrl({ returnTo: req.query.returnTo });
    kylithSso.setStateCookie(req, res, stateCookie);
    return res.redirect(url);
  }));

  const handleKylithCallback = asyncRoute(async (req, res) => {
    const state = kylithSso.readStateCookie(req);
    kylithSso.clearStateCookie(res);
    const fail = (reason) => res.redirect(`/?auth_error=${encodeURIComponent(reason)}`);

    if (!kylithSso.configured) return fail("KYLITH SSO is not configured.");
    if (req.query.error) return fail(String(req.query.error_description || req.query.error));
    if (!state || state.state !== req.query.state) return fail("KYLITH SSO state verification failed.");

    try {
      const claims = await kylithSso.exchangeCode({ code: req.query.code, nonce: state.nonce });
      const user = auth.upsertExternalUser({
        provider: "kylith",
        subject: claims.sub,
        username: claims.preferred_username || claims.email || claims.name,
        email: claims.email,
        name: claims.name || claims.preferred_username,
        title: claims.title || claims.job_title || claims.jobTitle || null,
        avatarUrl: claims.picture || claims.avatar || null,
      });
      setSessionCookie(req, res, auth.createSession(user.id));
      return res.redirect(safeReturnTo(state.returnTo));
    } catch (error) {
      console.error(error);
      return fail(error.message || "KYLITH SSO login failed.");
    }
  });

  app.get("/auth/callback", handleKylithCallback);
  app.get("/callback", handleKylithCallback);
  app.get("/api/auth/kylith/callback", handleKylithCallback);

  app.post("/api/auth/logout", auth.requireUser, (req, res) => {
    auth.destroySession(req, res);
    res.json({ ok: true });
  });

  app.delete("/api/cli/token", auth.requireUser, (req, res) => {
    res.json({ ok: true, revoked: auth.revokeCurrentCliToken(req) });
  });

  app.get("/api/cli/tokens", auth.requireUser, (req, res) => {
    res.json({ items: auth.listCliTokens(req.user.id) });
  });

  app.post("/api/cli/tokens", auth.requireUser, express.json({ limit: "32kb" }), (req, res) => {
    const name = String(req.body?.name || "KN Box CLI").trim().slice(0, 80) || "KN Box CLI";
    const created = auth.createCliToken(req.user.id, name);
    const item = auth.listCliTokens(req.user.id).find((token) => token.id === created.id);
    res.json({ ok: true, token: created.token, item });
  });

  app.delete("/api/cli/tokens/:id", auth.requireUser, (req, res) => {
    res.json({ ok: true, revoked: auth.revokeCliToken(req.user.id, req.params.id) });
  });

  app.post("/api/uploads/conflicts", auth.requireUser, express.json({ limit: "256kb" }), asyncRoute(async (req, res) => {
    assertUploadBatch(req.body?.paths, req.body?.totalBytes);
    const result = await resolveUserFileConflicts({
      paths: req.body?.paths,
      baseDir: req.body?.baseDir,
      filesDir: auth.userUploadsDir(req.user),
    });
    return res.json(result);
  }));

  // General file upload — one file per request (client sends them individually
  // so each gets its own progress bar; relativePath preserves folder structure).
  app.post("/api/uploads/file", auth.requireUser, fileUpload.single("file"), asyncRoute(async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded." });
      const file = await storeUserFile({
        tmpPath: req.file.path,
        originalName: req.file.originalname,
        relativePath: req.body?.relativePath,
        targetRelativePath: req.body?.targetRelativePath,
        conflictMode: req.body?.conflictMode,
        filesDir: auth.userUploadsDir(req.user),
        publicBasePath: publicFileBasePath({ auth, user: req.user, filesPublicUrl }),
      });
      return res.json({ ok: true, file });
    } catch (error) {
      await removeUpload(req.file);
      throw error;
    }
  }));

  app.get("/api/files", auth.requireUser, asyncRoute(async (req, res) => {
    const listing = await listUserFiles({
      filesDir: auth.userUploadsDir(req.user),
      publicBasePath: publicFileBasePath({ auth, user: req.user, filesPublicUrl }),
      dir: req.query.dir,
      type: req.query.type || "all",
    });
    res.json(listing);
  }));

  app.get("/api/files/search", auth.requireUser, asyncRoute(async (req, res) => {
    const result = await searchUserFiles({
      filesDir: auth.userUploadsDir(req.user),
      publicBasePath: publicFileBasePath({ auth, user: req.user, filesPublicUrl }),
      query: req.query.q,
      limit: req.query.limit || 10,
    });
    res.json(result);
  }));

  app.get("/api/files/entry", auth.requireUser, asyncRoute(async (req, res) => {
    const entry = await getUserFileEntry({
      filesDir: auth.userUploadsDir(req.user),
      publicBasePath: publicFileBasePath({ auth, user: req.user, filesPublicUrl }),
      target: req.query.path,
    });
    if (!entry) return res.status(404).json({ error: "File not found." });
    return res.json({ item: entry });
  }));

  app.get("/api/storage", auth.requireUser, asyncRoute(async (req, res) => {
    const usage = await getUserStorageUsage({
      filesDir: auth.userUploadsDir(req.user),
      quotaBytes: configuredUserQuotaBytes(),
    });
    res.json(usage);
  }));

  app.get("/api/trash", auth.requireUser, asyncRoute(async (req, res) => {
    res.json(await listTrashEntries({ filesDir: auth.userUploadsDir(req.user) }));
  }));

  app.delete("/api/trash", auth.requireUser, asyncRoute(async (req, res) => {
    const result = await emptyTrash({ filesDir: auth.userUploadsDir(req.user) });
    res.json({ ok: true, ...result });
  }));

  app.post("/api/trash/:id/restore", auth.requireUser, asyncRoute(async (req, res) => {
    const result = await restoreTrashEntry({
      filesDir: auth.userUploadsDir(req.user),
      id: req.params.id,
    });
    res.json({ ok: true, ...result });
  }));

  app.delete("/api/files", auth.requireUser, express.json({ limit: "256kb" }), asyncRoute(async (req, res) => {
    const result = await deleteUserFiles({
      filesDir: auth.userUploadsDir(req.user),
      paths: req.body?.paths,
      confirmName: req.body?.confirmName,
    });
    res.json({ ok: true, ...result });
  }));

  app.post("/api/files/folders", auth.requireUser, express.json({ limit: "64kb" }), asyncRoute(async (req, res) => {
    const folder = await createUserFolder({
      filesDir: auth.userUploadsDir(req.user),
      dir: req.body?.dir,
      name: req.body?.name,
    });
    res.json({ ok: true, folder });
  }));

  app.use("/api", createApi({ auth }));
  app.use("/api", (err, _req, res, _next) => {
    console.error(err);
    const message = err.code === "LIMIT_FILE_SIZE" ? "单文件不能超过 10MB。" : err.message || "Request failed";
    res.status(err.status || 400).json({ error: message });
  });

  app.get("/u/:storageName/*", asyncRoute(async (req, res) => {
    const root = path.resolve(auth.publicUploadsDir(req.params.storageName));
    const rel = safePublicFilePath(req.params[0]);
    let file = path.resolve(root, rel);
    assertInside(root, file);

    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isDirectory()) {
      if (!req.path.endsWith("/")) return res.redirect(301, `${req.path}/`);
      const indexFile = await findDirectoryIndex(file);
      if (!indexFile) {
        return res.status(403).type("html").send(renderForbiddenDocument({
          path: req.path,
          message: "不允许浏览目录。请上传 index.html 或 index.htm 作为目录入口。",
        }));
      }
      file = indexFile;
    }

    const finalStat = await fs.stat(file).catch(() => null);
    if (!finalStat?.isFile()) {
      return res.status(404).type("html").send(renderNotFoundDocument({ path: req.path }));
    }

    if (isMarkdownFile(file)) {
      const markdown = await fs.readFile(file, "utf8");
      res.set("Cache-Control", "public, max-age=60");
      res.type("html").send(renderMarkdownDocument(markdown, { title: path.basename(file) }));
      return;
    }

    res.set("Cache-Control", "public, max-age=300");
    res.sendFile(file);
  }));

  app.use((req, res, next) => {
    if (filesPublicHost && requestHost(req) === filesPublicHost) {
      return res.status(404).type("text").send("Not found");
    }
    return next();
  });

  const dev = process.env.KNBOX_DEV === "1";
  if (!dev) {
    if (await fs.stat(WEB_DIST).catch(() => null)) {
      app.use(express.static(WEB_DIST));
      app.get("*", (_req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
    } else {
      app.get("*", (_req, res) =>
        res
          .status(503)
          .send("Web bundle not built. Run `npm run build` first (or `npm run dev` for development).")
      );
    }
  }

  const actualPort = await listen(app, port);
  if (actualPort !== port) {
    console.log(`\n  ⚠  port ${port} is in use — using ${actualPort} instead`);
    if (!process.env.KNBOX_PUBLIC_URL && kylithSso.configured) {
      console.log(`      KYLITH redirect URI is still ${kylithSso.redirectUri}; set KNBOX_PUBLIC_URL when using SSO.`);
    }
  }
  const url = `http://localhost:${actualPort}`;
  console.log(`\n  KN Box data dir ${dataDir}`);
  if (kylithSso.configured) console.log(`      KYLITH SSO redirect ${kylithSso.redirectUri}`);
  if (filesPublicUrl) console.log(`      public files ${filesPublicUrl}/u/<username>/...`);
  console.log(`      ${dev ? "API on" : "open"} ${url}\n`);

  if (open && !dev) {
    const opener =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    const { spawn } = await import("node:child_process");
    spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
  }

  return { app, auth, url };
}

function publicFileBasePath({ auth, user, filesPublicUrl }) {
  const base = `/u/${encodeURIComponent(auth.userStorageName(user))}`;
  return filesPublicUrl ? `${filesPublicUrl}${base}` : base;
}

function assertUploadBatch(paths, totalBytes) {
  const count = Array.isArray(paths) ? paths.length : 0;
  if (count > MAX_UPLOAD_FILES_PER_BATCH) {
    throw statusError(`一次最多上传 ${MAX_UPLOAD_FILES_PER_BATCH} 个文件。`, 413);
  }
  if (Number(totalBytes) > MAX_UPLOAD_BATCH_BYTES) {
    throw statusError(`一次上传总大小不能超过 200MB。`, 413);
  }
}

function cleanPublicUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("KNBOX_FILES_PUBLIC_URL must be an http(s) URL.");
  return url.toString().replace(/\/+$/, "");
}

function requestHost(req) {
  return String(req.headers.host || "").toLowerCase();
}

function safePublicFilePath(value) {
  const parts = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  if (!parts.length || parts.some((p) => p === "." || p === ".." || p.startsWith("."))) {
    throw new Error("Invalid file path.");
  }
  return parts.join("/");
}

function safeLoopbackCallback(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "http:") return null;
    if (!["127.0.0.1", "localhost", "::1"].includes(host)) return null;
    return url;
  } catch {
    return null;
  }
}

function isMarkdownFile(file) {
  return [".md", ".markdown", ".mdx"].includes(path.extname(file).toLowerCase());
}

async function findDirectoryIndex(dir) {
  for (const name of ["index.html", "index.htm"]) {
    const file = path.join(dir, name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isFile()) return file;
  }
  return null;
}

function assertInside(root, target) {
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Invalid file path.");
}
