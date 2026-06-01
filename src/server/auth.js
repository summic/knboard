import bcrypt from "bcryptjs";
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
  return fs.mkdir(root, { recursive: true }).then(() => {
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

    seedAdmin(db);

    const auth = {
      dataDir: root,
      db,
      sessionSecret,

      async verifyLogin(username, password) {
        const user = findUserByUsername(db, username);
        if (!user) return null;
        if (!user.password_hash) return null;
        const ok = await bcrypt.compare(password, user.password_hash);
        return ok ? publicUser(user) : null;
      },

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

        const nextUsername = uniqueUsername(db, username || email || `${normalizedProvider}-${normalizedSubject}`);
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

      userUploadsDir(user) {
        return path.join(root, "users", userStorageName(user));
      },

      userStorageName,

      publicUploadsDir(storageName) {
        return path.join(root, "users", safeStorageName(storageName));
      },
    };

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

function seedAdmin(db) {
  const count = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (count > 0) return;

  const username = process.env.KNBOX_ADMIN_USER || "admin";
  const password = process.env.KNBOX_ADMIN_PASSWORD || "admin123";
  const hash = bcrypt.hashSync(password, 12);
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username, hash);
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

function findUserByUsername(db, username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(String(username || "").trim());
}

function findUserById(db, id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
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
  const id = Number(user?.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid user id.");
  return `user-${id}`;
}

function safeStorageName(value) {
  const storageName = String(value || "").trim().toLowerCase();
  if (!/^user-[1-9][0-9]*$/.test(storageName)) throw new Error("Invalid user storage name.");
  return storageName;
}

function uniqueUsername(db, seed) {
  const base = slugUsername(seed);
  let candidate = base;
  let n = 1;
  while (findUserByUsername(db, candidate)) candidate = `${base}-${++n}`;
  return candidate;
}

function slugUsername(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/@.+$/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return raw || `user-${crypto.randomBytes(4).toString("hex")}`;
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
