const VALID_VISIBILITIES = new Set(["public", "private"]);

export function ensureContentVisibilityTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_visibility (
      user_id INTEGER NOT NULL,
      path TEXT NOT NULL,
      visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, path),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

export function normalizeContentVisibility(value, fallback = "private") {
  const visibility = String(value || "").trim().toLowerCase();
  if (VALID_VISIBILITIES.has(visibility)) return visibility;
  return fallback;
}

export function contentVisibilityMap({ db, userId, paths }) {
  const uniquePaths = [...new Set((Array.isArray(paths) ? paths : []).map((path) => String(path || "")).filter(Boolean))];
  const result = new Map(uniquePaths.map((path) => [path, "private"]));
  if (!uniquePaths.length) return result;

  const placeholders = uniquePaths.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT path, visibility
       FROM content_visibility
       WHERE user_id = ? AND path IN (${placeholders})`
    )
    .all(userId, ...uniquePaths);
  for (const row of rows) result.set(row.path, normalizeContentVisibility(row.visibility));
  return result;
}

export function setContentVisibility({ db, userId, path, visibility }) {
  const nextVisibility = normalizeContentVisibility(visibility);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO content_visibility (user_id, path, visibility, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, path)
     DO UPDATE SET visibility = excluded.visibility, updated_at = excluded.updated_at`
  ).run(userId, path, nextVisibility, now);
  return nextVisibility;
}

export function deleteContentVisibility({ db, userId, paths }) {
  const uniquePaths = [...new Set((Array.isArray(paths) ? paths : []).map((path) => String(path || "")).filter(Boolean))];
  if (!uniquePaths.length) return 0;
  const placeholders = uniquePaths.map(() => "?").join(",");
  return db
    .prepare(`DELETE FROM content_visibility WHERE user_id = ? AND path IN (${placeholders})`)
    .run(userId, ...uniquePaths).changes;
}
