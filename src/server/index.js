import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import {
  ensureAccessStatsTables,
  getAdminAccessStats,
  publicContentKind,
  recordFileAccess,
} from "./access-stats.js";
import {
  contentVisibilityMap,
  ensureContentVisibilityTables,
  normalizeContentVisibility,
  setContentVisibility,
} from "./content-visibility.js";
import {
  ensureHomepageSettingsTables,
  getHomepageSettings,
  updateHomepageSettings,
  homepageFontStack,
} from "./homepage-settings.js";
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
  listPublishedContent,
  listTrashEntries,
  listUserFiles,
  restoreTrashEntry,
  safeUserRelativePath,
  searchUserFiles,
} from "./user-files.js";
import {
  isWebPagePath,
  queueWebThumbnail,
  readWebThumbnail,
} from "./web-thumbnails.js";

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

export async function createServerApp({
  dataDir = path.resolve(process.env.KNBOX_DATA_DIR || path.join(process.cwd(), "data")),
  publicUrl = process.env.KNBOX_PUBLIC_URL || "http://localhost:6789",
  filesPublicUrl: rawFilesPublicUrl = process.env.KNBOX_FILES_PUBLIC_URL || "",
  serveWeb = false,
} = {}) {
  const auth = await createAuth({ dataDir });
  ensureAccessStatsTables(auth.db);
  ensureContentVisibilityTables(auth.db);
  ensureHomepageSettingsTables(auth.db);
  const filesPublicUrl = cleanPublicUrl(rawFilesPublicUrl);
  const filesPublicHost = filesPublicUrl ? new URL(filesPublicUrl).host.toLowerCase() : null;
  const kylithSso = createKylithSso({ publicUrl, sessionSecret: auth.sessionSecret });
  const fileUpload = createFileUploadMiddleware({ dataDir });
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders({ filesPublicHost, filesPublicUrl }));
  app.use((req, res, next) => {
    if (!filesPublicHost) return next();
    if (requestHost(req) !== filesPublicHost) return next();
    if (req.path.startsWith("/u/")) return next();
    res.status(404).type("text").send("Not found");
  });
  app.use(originGuard({ publicUrl }));
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

  app.all("/api/auth/login", (_req, res) => {
    res.status(404).json({ error: "Password login is not supported." });
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

  app.get("/api/admin/users", auth.requireAdmin, (_req, res) => {
    res.json({ items: auth.listUsers() });
  });

  app.post("/api/admin/users/:id/admin", auth.requireSuperAdmin, (req, res) => {
    const user = auth.makeUserAdmin(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found." });
    return res.json({ user });
  });

  app.delete("/api/admin/users/:id/admin", auth.requireSuperAdmin, (req, res) => {
    const user = auth.revokeUserAdmin(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found." });
    return res.json({ user });
  });

  app.get("/api/admin/users/:id/files", auth.requireAdmin, asyncRoute(async (req, res) => {
    const targetUser = auth.getUser(req.params.id);
    if (!targetUser) return res.status(404).json({ error: "User not found." });
    const listing = await listUserFiles({
      filesDir: auth.userUploadsDir(targetUser),
      publicBasePath: publicFileBasePath({ auth, user: targetUser, filesPublicUrl }),
      ...thumbnailOptions({
        auth,
        user: targetUser,
        publicUrl,
        filesPublicUrl,
        thumbnailBasePath: `/api/admin/users/${encodeURIComponent(String(targetUser.id))}/files/thumbnail`,
      }),
      ...visibilityOptions({ auth, user: targetUser }),
      dir: req.query.dir,
      type: req.query.type || "all",
    });
    return res.json(listing);
  }));

  app.get("/api/admin/users/:id/files/thumbnail", auth.requireAdmin, asyncRoute(async (req, res) => {
    const targetUser = auth.getUser(req.params.id);
    if (!targetUser) return res.status(404).json({ error: "User not found." });
    return sendWebThumbnail({
      auth,
      user: targetUser,
      publicUrl,
      filesPublicUrl,
      rel: req.query.path,
      res,
    });
  }));

  app.get("/api/admin/stats/access", auth.requireAdmin, (req, res) => {
    res.json(getAdminAccessStats({ db: auth.db, limit: req.query.limit || 20 }));
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
      if (publicContentKind(file.path)) {
        file.visibility = setContentVisibility({
          db: auth.db,
          userId: req.user.id,
          path: file.path,
          visibility: normalizeContentVisibility(req.body?.visibility, "private"),
        });
      }
      if (isWebPagePath(file.path)) {
        queueWebThumbnail(thumbnailJob({
          auth,
          user: req.user,
          publicUrl,
          filesPublicUrl,
          rel: file.path,
        }));
      }
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
      ...thumbnailOptions({
        auth,
        user: req.user,
        publicUrl,
        filesPublicUrl,
        thumbnailBasePath: "/api/files/thumbnail",
      }),
      ...visibilityOptions({ auth, user: req.user }),
      dir: req.query.dir,
      type: req.query.type || "all",
    });
    res.json(listing);
  }));

  app.get("/api/content", auth.requireUser, asyncRoute(async (req, res) => {
    const listing = await listPublishedContent({
      filesDir: auth.userUploadsDir(req.user),
      publicBasePath: publicFileBasePath({ auth, user: req.user, filesPublicUrl }),
      ...thumbnailOptions({
        auth,
        user: req.user,
        publicUrl,
        filesPublicUrl,
        thumbnailBasePath: "/api/files/thumbnail",
      }),
      ...visibilityOptions({ auth, user: req.user }),
      includePrivate: req.query.visibility !== "public",
      limit: req.query.limit || 100,
    });
    res.json(listing);
  }));

  app.get("/api/homepage/settings", auth.requireUser, (req, res) => {
    res.json({ settings: getHomepageSettings({ db: auth.db, user: req.user }) });
  });

  app.patch("/api/homepage/settings", auth.requireUser, express.json({ limit: "32kb" }), (req, res) => {
    const settings = updateHomepageSettings({
      db: auth.db,
      user: req.user,
      displayName: req.body?.displayName,
      description: req.body?.description,
      style: req.body?.style,
      titleFont: req.body?.titleFont,
      showHomeLink: req.body?.showHomeLink,
    });
    res.json({ ok: true, settings });
  });

  app.get("/api/files/search", auth.requireUser, asyncRoute(async (req, res) => {
    const result = await searchUserFiles({
      filesDir: auth.userUploadsDir(req.user),
      publicBasePath: publicFileBasePath({ auth, user: req.user, filesPublicUrl }),
      ...thumbnailOptions({
        auth,
        user: req.user,
        publicUrl,
        filesPublicUrl,
        thumbnailBasePath: "/api/files/thumbnail",
      }),
      ...visibilityOptions({ auth, user: req.user }),
      query: req.query.q,
      limit: req.query.limit || 10,
    });
    res.json(result);
  }));

  app.get("/api/files/entry", auth.requireUser, asyncRoute(async (req, res) => {
    const entry = await getUserFileEntry({
      filesDir: auth.userUploadsDir(req.user),
      publicBasePath: publicFileBasePath({ auth, user: req.user, filesPublicUrl }),
      ...thumbnailOptions({
        auth,
        user: req.user,
        publicUrl,
        filesPublicUrl,
        thumbnailBasePath: "/api/files/thumbnail",
      }),
      ...visibilityOptions({ auth, user: req.user }),
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

  app.get("/api/files/thumbnail", auth.requireUser, asyncRoute(async (req, res) => {
    return sendWebThumbnail({
      auth,
      user: req.user,
      publicUrl,
      filesPublicUrl,
      rel: req.query.path,
      res,
    });
  }));

  app.get("/api/public/users/:storageName/files/thumbnail", asyncRoute(async (req, res) => {
    const owner = auth.getUserByStorageName(req.params.storageName);
    if (!owner) return res.status(404).json({ error: "Thumbnail not found." });
    let rel;
    try {
      rel = safeUserRelativePath(req.query.path);
    } catch {
      return res.status(400).json({ error: "Invalid file path." });
    }
    if (!publicContentKind(rel)) return res.status(404).json({ error: "Thumbnail not found." });
    const visibility = contentVisibilityMap({ db: auth.db, userId: owner.id, paths: [rel] }).get(rel) || "private";
    if (visibility !== "public") return res.status(404).json({ error: "Thumbnail not found." });
    return sendWebThumbnail({
      auth,
      user: owner,
      publicUrl,
      filesPublicUrl,
      rel,
      res,
    });
  }));

  app.patch("/api/files/visibility", auth.requireUser, express.json({ limit: "64kb" }), asyncRoute(async (req, res) => {
    const rel = safeUserRelativePath(req.body?.path);
    if (!publicContentKind(rel)) return res.status(400).json({ error: "Only Markdown documents and HTML webpages can be published." });
    const visibility = normalizeContentVisibility(req.body?.visibility, null);
    if (!visibility) return res.status(400).json({ error: "Visibility must be public or private." });
    const existing = await getUserFileEntry({
      filesDir: auth.userUploadsDir(req.user),
      publicBasePath: publicFileBasePath({ auth, user: req.user, filesPublicUrl }),
      ...thumbnailOptions({
        auth,
        user: req.user,
        publicUrl,
        filesPublicUrl,
        thumbnailBasePath: "/api/files/thumbnail",
      }),
      ...visibilityOptions({ auth, user: req.user }),
      target: rel,
    });
    if (!existing || existing.kind === "directory") return res.status(404).json({ error: "File not found." });
    setContentVisibility({ db: auth.db, userId: req.user.id, path: rel, visibility });
    const item = await getUserFileEntry({
      filesDir: auth.userUploadsDir(req.user),
      publicBasePath: publicFileBasePath({ auth, user: req.user, filesPublicUrl }),
      ...thumbnailOptions({
        auth,
        user: req.user,
        publicUrl,
        filesPublicUrl,
        thumbnailBasePath: "/api/files/thumbnail",
      }),
      ...visibilityOptions({ auth, user: req.user }),
      target: rel,
    });
    return res.json({ ok: true, item });
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
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found." });
  });
  app.use("/api", (err, _req, res, _next) => {
    console.error(err);
    const message = err.code === "LIMIT_FILE_SIZE" ? "单文件不能超过 10MB。" : err.message || "Request failed";
    res.status(err.status || 400).json({ error: message });
  });

  app.get(["/u/:storageName", "/u/:storageName/"], asyncRoute(async (req, res) => {
    const owner = auth.getUserByStorageName(req.params.storageName);
    if (!owner) return res.status(404).type("html").send(renderNotFoundDocument({ path: req.path }));
    const settings = getHomepageSettings({ db: auth.db, user: owner });
    const listing = await listPublishedContent({
      filesDir: auth.userUploadsDir(owner),
      publicBasePath: publicFileBasePath({ auth, user: owner, filesPublicUrl }),
      ...thumbnailOptions({
        auth,
        user: owner,
        publicUrl,
        filesPublicUrl,
        thumbnailBasePath: `/api/public/users/${encodeURIComponent(auth.userStorageName(owner))}/files/thumbnail`,
      }),
      ...visibilityOptions({ auth, user: owner }),
      includePrivate: false,
      limit: 200,
    });
    res.set("Cache-Control", "public, max-age=60");
    return res.type("html").send(renderUserHomepage({
      user: owner,
      items: listing.items,
      settings,
    }));
  }));

  app.get("/u/:storageName/*", asyncRoute(async (req, res) => {
    const owner = auth.getUserByStorageName(req.params.storageName);
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

    const finalRel = path.relative(root, file).split(path.sep).join("/");
    const accessKind = publicContentKind(finalRel);
    if (owner && accessKind) {
      try {
        recordFileAccess({
          db: auth.db,
          user: owner,
          storageName: req.params.storageName,
          filePath: finalRel,
          kind: accessKind,
        });
      } catch (error) {
        console.warn("Failed to record file access", error?.message || error);
      }
    }

    if (isMarkdownFile(file)) {
      const markdown = await fs.readFile(file, "utf8");
      const settings = owner ? getHomepageSettings({ db: auth.db, user: owner }) : null;
      res.set("Cache-Control", "public, max-age=60");
      res.type("html").send(renderMarkdownDocument(markdown, {
        title: path.basename(file),
        theme: settings?.style,
      }));
      return;
    }

    if (isHtmlFile(file)) {
      const html = await fs.readFile(file, "utf8");
      res.set("Cache-Control", "public, max-age=60");
      res.type("html").send(html);
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

  if (serveWeb) {
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

  return { app, auth, publicUrl, filesPublicUrl, filesPublicHost, kylithSso, dataDir };
}

export async function startServer({ port = 6789, open = false } = {}) {
  const dataDir = path.resolve(process.env.KNBOX_DATA_DIR || path.join(process.cwd(), "data"));
  const publicUrl = process.env.KNBOX_PUBLIC_URL || `http://localhost:${port}`;
  const dev = process.env.KNBOX_DEV === "1";
  const { app, auth, kylithSso, filesPublicUrl } = await createServerApp({
    dataDir,
    publicUrl,
    filesPublicUrl: process.env.KNBOX_FILES_PUBLIC_URL || "",
    serveWeb: !dev,
  });
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

function thumbnailOptions({ auth, user, publicUrl, filesPublicUrl, thumbnailBasePath }) {
  return {
    thumbnailBasePath,
    onWebThumbnailNeeded: (rel) => queueWebThumbnail(thumbnailJob({
      auth,
      user,
      publicUrl,
      filesPublicUrl,
      rel,
    })),
  };
}

function visibilityOptions({ auth, user }) {
  return {
    visibilityForPaths: (paths) => contentVisibilityMap({ db: auth.db, userId: user.id, paths }),
  };
}

function thumbnailJob({ auth, user, publicUrl, filesPublicUrl, rel }) {
  const basePath = publicFileBasePath({ auth, user, filesPublicUrl });
  const encodedRel = String(rel || "").split("/").map(encodeURIComponent).join("/");
  const pageUrl = new URL(`${basePath.replace(/\/$/, "")}/${encodedRel}`, publicUrl).toString();
  const allowedPathPrefix = new URL(`${basePath.replace(/\/$/, "")}/`, publicUrl).pathname;
  return {
    filesDir: auth.userUploadsDir(user),
    rel,
    pageUrl,
    allowedPathPrefix,
  };
}

async function sendWebThumbnail({ auth, user, publicUrl, filesPublicUrl, rel, res }) {
  let safeRel;
  try {
    safeRel = safeUserRelativePath(rel);
  } catch {
    return res.status(400).json({ error: "Invalid file path." });
  }
  if (!isWebPagePath(safeRel)) return res.status(404).json({ error: "Thumbnail not found." });
  const filesDir = auth.userUploadsDir(user);
  const thumb = await readWebThumbnail({ filesDir, rel: safeRel });
  if (!thumb) {
    queueWebThumbnail(thumbnailJob({ auth, user, publicUrl, filesPublicUrl, rel: safeRel }));
    return res.status(404).json({ error: "Thumbnail not ready." });
  }
  res.set("Cache-Control", "private, max-age=60");
  res.type("png");
  return res.sendFile(thumb.path, { dotfiles: "allow" });
}

function renderUserHomepage({ user, items, settings }) {
  const homepageName = settings?.displayName || "Untitled";
  const style = settings?.style || "theme-6";
  const title = homepageName;
  const bioText = (settings?.description || "").trim();
  const fontStack = homepageFontStack(settings?.titleFont);
  const count = items.length;

  const groups = count ? groupContentByDate(items) : [];
  const rows = count
    ? groups.map((group, groupIndex) => `
      <section class="group">
        ${groupIndex === 0 ? "" : `<div class="group-divider"><span>${escapeHtml(group.label)}</span></div>`}
        <ul class="list">
          ${group.items.map((item) => {
            const itemTitle = escapeHtml(item.webTitle || item.name);
            const date = formatDateParts(item.updatedAt);
            const dateBlock = date
              ? `<time class="item-date" datetime="${escapeAttribute(date.iso)}"><span class="item-date-month">${escapeHtml(date.month)}</span><span class="item-date-day">${escapeHtml(date.day)}</span></time>`
              : `<span class="item-date" aria-hidden="true"></span>`;
            return `
              <li class="item">
                <a href="${escapeAttribute(item.url || "#")}">
                  ${dateBlock}
                  <span class="item-title">${itemTitle}</span>
                  <span class="item-arrow" aria-hidden="true">→</span>
                </a>
              </li>`;
          }).join("")}
        </ul>
      </section>`).join("")
    : `<div class="empty"><p>Nothing more — for now</p></div>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --oklch-theme-1: 0.9802 0.0074 151.89;
      --oklch-theme-2: 0.9822 0.0118 313.22;
      --oklch-theme-3: 0.9856 0.0084 56.32;
      --oklch-theme-4: 0.9808 0.0091 258.34;
      --oklch-theme-5: 0.9727 0.0119 17.36;
      --oklch-theme-6: 0.9731 0 0;
      --ink: #1b1a17;
      --ink-soft: #57534b;
      --muted: #8b867c;
      --line: rgba(28, 25, 20, 0.10);
      --line-strong: rgba(28, 25, 20, 0.16);
      --accent: #1f5fd1;
      --bg: oklch(var(--oklch-theme-6));
      --serif: ${fontStack};
      --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Roboto, sans-serif;
    }
    body.homepage-theme-1 { --bg: oklch(var(--oklch-theme-1)); }
    body.homepage-theme-2 { --bg: oklch(var(--oklch-theme-2)); }
    body.homepage-theme-3 { --bg: oklch(var(--oklch-theme-3)); }
    body.homepage-theme-4 { --bg: oklch(var(--oklch-theme-4)); }
    body.homepage-theme-5 { --bg: oklch(var(--oklch-theme-5)); }
    body.homepage-theme-6 { --bg: oklch(var(--oklch-theme-6)); }
    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.65 var(--sans); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
    main { width: min(720px, calc(100% - 40px)); margin: 0 auto; padding: 96px 0 56px; min-height: 100vh; display: flex; flex-direction: column; }
    .content { flex: 1; display: flex; flex-direction: column; min-height: 0; }

    header { margin-bottom: 60px; }
    h1 { margin: 0; font-family: var(--serif); font-size: clamp(40px, 7vw, 60px); font-weight: 600; line-height: 1.08; letter-spacing: -0.01em; color: var(--ink); }
    .bio { max-width: 34em; margin: 18px 0 0; font-family: var(--serif); font-style: italic; font-size: 19px; line-height: 1.7; color: var(--ink-soft); white-space: pre-line; }

    .group { margin-top: 48px; }
    .group:first-child { margin-top: 0; }
    .group-divider { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px; margin-bottom: 8px; }
    .group-divider::before, .group-divider::after { content: ""; height: 1px; background: var(--line-strong); }
    .group-divider span { font-size: 13px; font-weight: 700; letter-spacing: .04em; color: var(--muted); }
    .list { list-style: none; margin: 0; padding: 0; }
    .item + .item { border-top: 1px solid var(--line); }
    .item a {
      display: grid;
      grid-template-columns: 3.4em minmax(0, 1fr) auto;
      align-items: center;
      column-gap: 22px;
      padding: 20px 0;
      color: inherit;
      text-decoration: none;
      transition: padding-left .18s ease;
    }
    .item-date { display: flex; flex-direction: column; align-items: flex-start; line-height: 1; }
    .item-date-month { font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }
    .item-date-day { margin-top: 4px; font-family: var(--serif); font-size: 24px; font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
    .item-title { min-width: 0; font-family: var(--serif); font-size: 21px; font-weight: 600; line-height: 1.32; color: var(--ink); transition: color .15s ease; }
    .item-arrow { flex-shrink: 0; font-size: 20px; color: var(--muted); opacity: 0; transform: translateX(-6px); transition: opacity .18s ease, transform .18s ease; }
    .item a:hover .item-title { color: var(--accent); }
    .item a:hover .item-arrow { opacity: 1; transform: translateX(0); }
    .item a:hover { padding-left: 6px; }

    .empty { flex: 1; display: grid; place-items: center; min-height: 40vh; text-align: center; color: var(--muted); }
    .empty p { margin: 0; font-family: var(--serif); font-style: italic; font-size: 18px; }

    .end-note { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 20px; margin-top: 64px; }
    .end-note::before, .end-note::after { content: ""; height: 1px; }
    .end-note::before { background: linear-gradient(90deg, transparent, var(--line-strong)); }
    .end-note::after { background: linear-gradient(90deg, var(--line-strong), transparent); }
    .end-note span { font-family: var(--serif); font-style: italic; font-size: 16px; letter-spacing: .02em; color: var(--muted); }

    footer { margin-top: 40px; font-size: 13px; color: var(--muted); }
    footer a { color: var(--ink-soft); text-decoration: none; font-weight: 600; }
    footer a:hover { color: var(--accent); }

    @media (max-width: 560px) {
      main { padding: 56px 0 80px; }
      header { margin-bottom: 40px; }
      .item a { grid-template-columns: 2.8em minmax(0, 1fr); column-gap: 16px; padding: 16px 0; }
      .item-arrow { display: none; }
      .item-date-day { font-size: 21px; }
      .item-title { font-size: 19px; }
    }
  </style>
</head>
<body class="homepage-${escapeAttribute(style)}">
  <main>
    <header>
      <h1 id="homepage-title">${escapeHtml(title)}</h1>
      ${bioText ? `<p class="bio">${escapeHtml(bioText)}</p>` : ""}
    </header>
    <div class="content" aria-label="已发布内容">
      ${rows}
      ${count ? `<div class="end-note"><span>The end.</span></div>` : ""}
    </div>
    <footer>由 <a href="https://box.beforeve.com" target="_blank" rel="noreferrer noopener">knbox</a> 提供</footer>
  </main>
</body>
</html>`;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDateParts(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  return {
    month: MONTH_ABBR[date.getMonth()],
    day: String(date.getDate()),
    iso: date.toISOString().slice(0, 10),
  };
}

function groupContentByDate(items) {
  const now = new Date();
  const nowTime = now.getTime();
  const currentYear = now.getFullYear();
  const groups = [];
  for (const item of items) {
    const date = new Date(item.updatedAt);
    const time = date.getTime();
    const ageDays = Number.isFinite(time) ? Math.max(0, Math.floor((nowTime - time) / 86400000)) : Infinity;
    let key = "older";
    let label = "更早";
    if (ageDays < 7) {
      key = "recent";
      label = "最近文章";
    } else if (ageDays < 37) {
      key = "week";
      label = "一周前";
    } else if (Number.isFinite(time) && date.getFullYear() !== currentYear) {
      key = `year-${date.getFullYear()}`;
      label = String(date.getFullYear());
    }
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, label, items: [item] });
  }
  return groups;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
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

function securityHeaders({ filesPublicHost, filesPublicUrl }) {
  const frameSources = ["'self'"];
  if (filesPublicUrl) frameSources.push(new URL(filesPublicUrl).origin);
  return (req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.set("Cross-Origin-Opener-Policy", "same-origin");
    if (!req.path.startsWith("/u/") && (!filesPublicHost || requestHost(req) !== filesPublicHost)) {
      res.set(
        "Content-Security-Policy",
        [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' https: data: blob:",
          "font-src 'self' data:",
          "connect-src 'self'",
          `frame-src ${frameSources.join(" ")}`,
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; ")
      );
    }
    next();
  };
}

function originGuard({ publicUrl }) {
  const publicOrigin = new URL(publicUrl).origin;
  return (req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    if (/^Bearer\s+/i.test(String(req.headers.authorization || ""))) return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    const requestOrigin = `${req.headers["x-forwarded-proto"] || req.protocol}://${req.headers.host}`;
    if (origin === publicOrigin || origin === requestOrigin) return next();
    return res.status(403).json({ error: "Invalid request origin." });
  };
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

function isHtmlFile(file) {
  return [".html", ".htm"].includes(path.extname(file).toLowerCase());
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
