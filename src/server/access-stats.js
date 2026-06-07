import path from "node:path";

const CONTENT_EXTENSIONS = new Map([
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".mdx", "markdown"],
  [".html", "web"],
  [".htm", "web"],
]);

export function ensureAccessStatsTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_access_stats (
      owner_user_id INTEGER NOT NULL,
      storage_name TEXT NOT NULL,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      view_count INTEGER NOT NULL DEFAULT 0,
      last_viewed_at TEXT NOT NULL,
      PRIMARY KEY (owner_user_id, path),
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS file_access_daily (
      owner_user_id INTEGER NOT NULL,
      storage_name TEXT NOT NULL,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      day TEXT NOT NULL,
      view_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (owner_user_id, path, day),
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS file_access_stats_views_idx
    ON file_access_stats (view_count DESC, last_viewed_at DESC);

    CREATE INDEX IF NOT EXISTS file_access_daily_day_idx
    ON file_access_daily (day DESC, view_count DESC);
  `);
}

export function publicContentKind(filePath) {
  return CONTENT_EXTENSIONS.get(path.extname(String(filePath || "")).toLowerCase()) || null;
}

export function recordFileAccess({ db, user, storageName, filePath, kind, now = new Date() }) {
  if (!user?.id || !filePath || !kind) return false;
  const normalizedPath = String(filePath).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedPath) return false;
  const viewedAt = now.toISOString();
  const day = viewedAt.slice(0, 10);
  const ownerUserId = Number(user.id);
  const ownerStorageName = String(storageName || user.username || "").trim();

  db.prepare(`
    INSERT INTO file_access_stats (owner_user_id, storage_name, path, kind, view_count, last_viewed_at)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(owner_user_id, path) DO UPDATE SET
      storage_name = excluded.storage_name,
      kind = excluded.kind,
      view_count = file_access_stats.view_count + 1,
      last_viewed_at = excluded.last_viewed_at
  `).run(ownerUserId, ownerStorageName, normalizedPath, kind, viewedAt);

  db.prepare(`
    INSERT INTO file_access_daily (owner_user_id, storage_name, path, kind, day, view_count)
    VALUES (?, ?, ?, ?, ?, 1)
    ON CONFLICT(owner_user_id, path, day) DO UPDATE SET
      storage_name = excluded.storage_name,
      kind = excluded.kind,
      view_count = file_access_daily.view_count + 1
  `).run(ownerUserId, ownerStorageName, normalizedPath, kind, day);

  return true;
}

export function getAdminAccessStats({ db, limit = 20 } = {}) {
  const topLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const people = db.prepare(`
    SELECT
      u.id,
      u.username,
      u.role,
      u.email,
      u.display_name,
      u.avatar_url,
      COALESCE(SUM(s.view_count), 0) AS view_count,
      COUNT(s.path) AS content_count,
      MAX(s.last_viewed_at) AS last_viewed_at
    FROM users u
    LEFT JOIN file_access_stats s ON s.owner_user_id = u.id
    GROUP BY u.id
    ORDER BY view_count DESC, last_viewed_at DESC, u.created_at DESC, u.id DESC
  `).all().map((row) => ({
    user: publicStatsUser(row),
    viewCount: Number(row.view_count) || 0,
    contentCount: Number(row.content_count) || 0,
    lastViewedAt: row.last_viewed_at || null,
  }));

  const contents = db.prepare(`
    SELECT
      s.owner_user_id,
      s.storage_name,
      s.path,
      s.kind,
      s.view_count,
      s.last_viewed_at,
      u.username,
      u.role,
      u.email,
      u.display_name,
      u.avatar_url
    FROM file_access_stats s
    JOIN users u ON u.id = s.owner_user_id
    ORDER BY s.view_count DESC, s.last_viewed_at DESC, s.path ASC
    LIMIT ?
  `).all(topLimit).map((row) => ({
    owner: publicStatsUser({
      id: row.owner_user_id,
      username: row.username,
      role: row.role,
      email: row.email,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
    }),
    storageName: row.storage_name,
    path: row.path,
    name: path.basename(row.path),
    kind: row.kind,
    viewCount: Number(row.view_count) || 0,
    lastViewedAt: row.last_viewed_at || null,
    url: `/u/${encodeURIComponent(row.storage_name)}/${row.path.split("/").map(encodeURIComponent).join("/")}`,
  }));

  return { people, contents };
}

function publicStatsUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    role: row.role,
    email: row.email || null,
    name: row.display_name || null,
    avatarUrl: row.avatar_url || null,
  };
}
