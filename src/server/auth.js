import Database from "better-sqlite3";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const SESSION_COOKIE = "knbox_sid";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const LEGACY_DEV_SESSION_SECRET = "dev-session-secret-change-me";

export function createAuth({ dataDir }) {
  const root = path.resolve(dataDir);
  const dbPath = path.join(root, "knbox.sqlite");
  return fs.mkdir(root, { recursive: true }).then(async () => {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS cli_tokens (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        name TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used_at TEXT,
        expires_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    const sessionSecret = getSessionSecret(db);
    const legacySessionSecrets = sessionSecret === LEGACY_DEV_SESSION_SECRET ? [] : [LEGACY_DEV_SESSION_SECRET];
    ensureUserColumn(db, "provider", "TEXT");
    ensureUserColumn(db, "provider_subject", "TEXT");
    ensureUserColumn(db, "email", "TEXT");
    ensureUserColumn(db, "display_name", "TEXT");
    ensureUserColumn(db, "title", "TEXT");
    ensureUserColumn(db, "avatar_url", "TEXT");
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_provider_subject_unique
      ON users (provider, provider_subject)
      WHERE provider IS NOT NULL AND provider_subject IS NOT NULL;
    `);

    const auth = {
      dataDir: root,
      db,
      sessionSecret,

      upsertExternalUser({ provider, subject, username, email, name, title, avatarUrl }) {
        const normalizedProvider = String(provider || "").trim();
        const normalizedSubject = String(subject || "").trim();
        if (!normalizedProvider || !normalizedSubject) throw new Error("External user is missing provider or subject.");

        const existing = db
          .prepare("SELECT * FROM users WHERE provider = ? AND provider_subject = ?")
          .get(normalizedProvider, normalizedSubject);
        if (existing) {
          db.prepare("UPDATE users SET email = ?, display_name = ?, title = ?, avatar_url = ? WHERE id = ?").run(
            clean(email),
            clean(name),
            clean(title),
            clean(avatarUrl),
            existing.id
          );
          return publicUser(findUserById(db, existing.id));
        }

        const nextUsername = slugUsername(username || email || `${normalizedProvider}-${normalizedSubject}`);
        const conflictingUser = findUserByStorageName(db, nextUsername);
        if (conflictingUser) {
          const error = new Error(`Username "${nextUsername}" already exists.`);
          error.status = 409;
          throw error;
        }
        const result = db
          .prepare(
            `INSERT INTO users (username, password_hash, role, provider, provider_subject, email, display_name, title, avatar_url)
             VALUES (?, '', 'user', ?, ?, ?, ?, ?, ?)`
          )
          .run(nextUsername, normalizedProvider, normalizedSubject, clean(email), clean(name), clean(title), clean(avatarUrl));
        return publicUser(findUserById(db, result.lastInsertRowid));
      },

      createSession(userId) {
        const id = crypto.randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
        db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(id, userId, expiresAt);
        return signSessionId(id, sessionSecret);
      },

      createCliToken(userId, name = "KN Box CLI") {
        const id = crypto.randomBytes(12).toString("base64url");
        const secret = crypto.randomBytes(32).toString("base64url");
        const token = `knbox_${id}.${secret}`;
        db.prepare("DELETE FROM cli_tokens WHERE user_id = ?").run(userId);
        db.prepare(
          `INSERT INTO cli_tokens (id, user_id, token_hash, name)
           VALUES (?, ?, ?, ?)`
        ).run(id, userId, hashToken(token), clean(name));
        return { id, token };
      },

      listCliTokens(userId) {
        return db
          .prepare(
            `SELECT id, name, created_at, last_used_at, expires_at
             FROM cli_tokens
             WHERE user_id = ?
             ORDER BY created_at DESC`
          )
          .all(userId)
          .map(publicCliToken);
      },

      revokeCliToken(userId, id) {
        const result = db.prepare("DELETE FROM cli_tokens WHERE user_id = ? AND id = ?").run(userId, String(id || ""));
        return result.changes > 0;
      },

      revokeCurrentCliToken(req) {
        if (!req.cliTokenId) return false;
        const result = db.prepare("DELETE FROM cli_tokens WHERE id = ?").run(req.cliTokenId);
        return result.changes > 0;
      },

      destroySession(req, res) {
        const sessionId = readSignedSessionId(req, sessionSecret, legacySessionSecrets)?.id;
        if (sessionId) db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
        clearSessionCookie(res);
      },

      loadUser(req, res, next) {
        const bearerUser = readBearerUser(db, req);
        if (bearerUser) {
          req.user = publicUser(bearerUser.user);
          req.cliTokenId = bearerUser.tokenId;
          return next();
        }

        const signedSession = readSignedSessionId(req, sessionSecret, legacySessionSecrets);
        if (!signedSession) return next();
        const sessionId = signedSession.id;

        const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
        if (!session || Date.parse(session.expires_at) <= Date.now()) {
          if (session) db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
          clearSessionCookie(res);
          return next();
        }

        const user = findUserById(db, session.user_id);
        if (user) {
          req.user = publicUser(user);
          if (signedSession.legacy) setSessionCookie(req, res, signSessionId(sessionId, sessionSecret));
        }
        return next();
      },

      requireUser(req, res, next) {
        if (req.user) return next();
        return res.status(401).json({ error: "Authentication required." });
      },

      requireAdmin(req, res, next) {
        if (!req.user) return res.status(401).json({ error: "Authentication required." });
        if (!isAdminRole(req.user.role)) return res.status(403).json({ error: "Admin access required." });
        return next();
      },

      requireSuperAdmin(req, res, next) {
        if (!req.user) return res.status(401).json({ error: "Authentication required." });
        if (req.user.role !== "super_admin") return res.status(403).json({ error: "Super admin access required." });
        return next();
      },

      listUsers() {
        return db
          .prepare("SELECT * FROM users ORDER BY created_at DESC, id DESC")
          .all()
          .map(publicUser);
      },

      getUser(id) {
        const user = findUserById(db, Number(id));
        return user ? publicUser(user) : null;
      },

      getUserByStorageName(storageName) {
        const user = findUserByStorageName(db, String(storageName || ""));
        return user ? publicUser(user) : null;
      },

      makeUserAdmin(id) {
        const userId = Number(id);
        if (!Number.isInteger(userId) || userId <= 0) return null;
        const existing = findUserById(db, userId);
        if (!existing) return null;
        if (existing.role === "user") db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(userId);
        const user = findUserById(db, userId);
        return publicUser(user);
      },

      revokeUserAdmin(id) {
        const userId = Number(id);
        if (!Number.isInteger(userId) || userId <= 0) return null;
        const existing = findUserById(db, userId);
        if (!existing) return null;
        if (existing.role === "admin") db.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(userId);
        const user = findUserById(db, userId);
        return publicUser(user);
      },

      userUploadsDir(user) {
        return path.join(root, "users", userStorageName(user));
      },

      userStorageName,

      publicUploadsDir(storageName) {
        return path.join(root, "users", safeStorageName(storageName));
      },
    };

    await migrateLegacyUserStorageDirs({ db, root });

    return auth;
  });
}

export function setSessionCookie(req, res, signedSessionId) {
  res.cookie(SESSION_COOKIE, signedSessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

function ensureUserColumn(db, name, definition) {
  const columns = db.prepare("PRAGMA table_info(users)").all().map((col) => col.name);
  if (!columns.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
}

function getSessionSecret(db) {
  if (process.env.KNBOX_SESSION_SECRET) return process.env.KNBOX_SESSION_SECRET;

  const existing = db.prepare("SELECT value FROM app_settings WHERE key = 'session_secret'").get();
  if (existing?.value) return existing.value;

  const secret = crypto.randomBytes(48).toString("base64url");
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('session_secret', ?, CURRENT_TIMESTAMP)`
  ).run(secret);
  return secret;
}

function findUserById(db, id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function findUserByStorageName(db, storageName) {
  return db
    .prepare("SELECT * FROM users")
    .all()
    .find((user) => userStorageName(user) === storageName);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    email: user.email || null,
    name: user.display_name || null,
    title: user.title || null,
    avatarUrl: user.avatar_url || null,
    provider: user.provider || "local",
  };
}

function isAdminRole(role) {
  return role === "admin" || role === "super_admin";
}

function publicCliToken(row) {
  return {
    id: row.id,
    name: row.name || "KN Box CLI",
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
    expiresAt: row.expires_at || null,
  };
}

function userStorageName(user) {
  return safeStorageName(user?.username);
}

function safeStorageName(value) {
  const storageName = slugUsername(value, { fallback: false });
  if (!storageName) throw new Error("Invalid user storage name.");
  return storageName;
}

function slugUsername(value, { fallback = true } = {}) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/@.+$/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 48);
  return raw || (fallback ? `user-${crypto.randomBytes(4).toString("hex")}` : "");
}

async function migrateLegacyUserStorageDirs({ db, root }) {
  const usersRoot = path.join(root, "users");
  const users = db.prepare("SELECT id, username FROM users ORDER BY id").all();
  for (const user of users) {
    const id = Number(user.id);
    if (!Number.isInteger(id) || id <= 0) continue;

    const legacyDir = path.join(usersRoot, `user-${id}`);
    const targetDir = path.join(usersRoot, userStorageName(user));
    if (legacyDir === targetDir) continue;

    const legacyStat = await fs.stat(legacyDir).catch(() => null);
    if (!legacyStat?.isDirectory()) continue;

    const targetStat = await fs.stat(targetDir).catch(() => null);
    if (!targetStat) {
      await fs.mkdir(usersRoot, { recursive: true });
      await fs.rename(legacyDir, targetDir);
      continue;
    }

    if (!targetStat.isDirectory()) continue;
    await mergeDirectoryWithoutOverwrite(legacyDir, targetDir);
  }
}

async function mergeDirectoryWithoutOverwrite(sourceDir, targetDir) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    const targetExists = await fs.stat(target).catch(() => null);
    if (targetExists) continue;

    await fs.rename(source, target);
  }

  const remaining = await fs.readdir(sourceDir).catch(() => []);
  if (!remaining.length) await fs.rm(sourceDir, { recursive: true, force: true });
}

function clean(value) {
  const text = String(value || "").trim();
  return text || null;
}

function readBearerUser(db, req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const token = match[1].trim();
  if (!token.startsWith("knbox_") || token.length > 256) return null;

  const row = db
    .prepare(
      `SELECT cli_tokens.id AS token_id, cli_tokens.expires_at, users.*
       FROM cli_tokens
       JOIN users ON users.id = cli_tokens.user_id
       WHERE cli_tokens.token_hash = ?`
    )
    .get(hashToken(token));
  if (!row) return null;
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    db.prepare("DELETE FROM cli_tokens WHERE id = ?").run(row.token_id);
    return null;
  }
  db.prepare("UPDATE cli_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.token_id);
  return { tokenId: row.token_id, user: row };
}

function readSignedSessionId(req, secret, legacySecrets = []) {
  const raw = parseCookies(req.headers.cookie || "")[SESSION_COOKIE];
  if (!raw) return null;
  const [id, signature] = raw.split(".");
  if (!id || !signature) return null;
  if (signatureMatches(id, signature, secret)) return { id, legacy: false };
  for (const legacySecret of legacySecrets) {
    if (signatureMatches(id, signature, legacySecret)) return { id, legacy: true };
  }
  return null;
}

function signatureMatches(id, signature, secret) {
  const expected = hmac(id, secret);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function signSessionId(id, secret) {
  return `${id}.${hmac(id, secret)}`;
}

function hmac(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}
