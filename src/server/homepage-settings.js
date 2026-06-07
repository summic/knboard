const VALID_STYLES = new Set(["theme-1", "theme-2", "theme-3", "theme-4", "theme-5", "theme-6"]);
const DEFAULT_STYLE = "theme-6";
const DEFAULT_FONT = "songti";
const MAX_DESCRIPTION_LENGTH = 280;

// Serif presets offered for the homepage title. Each value is a CSS font stack
// using only system-available fonts (the public homepage ships no web fonts).
export const HOMEPAGE_FONT_STACKS = {
  songti: `"Songti SC", "Noto Serif SC", "Noto Serif CJK SC", "SimSun", Georgia, "Times New Roman", serif`,
  georgia: `Georgia, "Songti SC", "Noto Serif SC", "Noto Serif CJK SC", "SimSun", serif`,
  palatino: `"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", "Songti SC", "Noto Serif SC", "Noto Serif CJK SC", serif`,
  kai: `Georgia, "Kaiti SC", "STKaiti", KaiTi, "Songti SC", "Noto Serif CJK SC", serif`,
};
const VALID_FONTS = new Set(Object.keys(HOMEPAGE_FONT_STACKS));

export function homepageFontStack(value) {
  return HOMEPAGE_FONT_STACKS[normalizeHomepageFont(value)];
}

export function ensureHomepageSettingsTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS homepage_settings (
      user_id INTEGER PRIMARY KEY,
      display_name TEXT,
      description TEXT,
      style TEXT NOT NULL DEFAULT 'theme-6' CHECK (style IN ('theme-1', 'theme-2', 'theme-3', 'theme-4', 'theme-5', 'theme-6')),
      title_font TEXT,
      show_home_link INTEGER NOT NULL DEFAULT 1 CHECK (show_home_link IN (0, 1)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  ensureHomepageSettingsColumn(db, "show_home_link", "INTEGER NOT NULL DEFAULT 1");
  ensureHomepageSettingsColumn(db, "description", "TEXT");
  ensureHomepageSettingsColumn(db, "title_font", "TEXT");
  migrateHomepageSettingsStyles(db);
}

export function getHomepageSettings({ db, user }) {
  const row = db
    .prepare("SELECT display_name, description, style, title_font, show_home_link FROM homepage_settings WHERE user_id = ?")
    .get(user.id);
  return normalizeHomepageSettings(row, user);
}

export function updateHomepageSettings({ db, user, displayName, description, style, titleFont, showHomeLink }) {
  const current = getHomepageSettings({ db, user });
  const next = {
    displayName: normalizeDisplayName(displayName, current.displayName),
    description: normalizeDescription(description, current.description),
    style: normalizeHomepageStyle(style, current.style),
    titleFont: normalizeHomepageFont(titleFont, current.titleFont),
    showHomeLink: normalizeBoolean(showHomeLink, current.showHomeLink),
  };
  db.prepare(
    `INSERT INTO homepage_settings (user_id, display_name, description, style, title_font, show_home_link, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id)
     DO UPDATE SET display_name = excluded.display_name,
       description = excluded.description,
       style = excluded.style,
       title_font = excluded.title_font,
       show_home_link = excluded.show_home_link,
       updated_at = excluded.updated_at`
  ).run(user.id, next.displayName, next.description, next.style, next.titleFont, next.showHomeLink ? 1 : 0, new Date().toISOString());
  return getHomepageSettings({ db, user });
}

export function normalizeHomepageSettings(row, user) {
  return {
    displayName: normalizeDisplayName(row?.display_name, "Untitled"),
    description: normalizeDescription(row?.description, ""),
    style: normalizeHomepageStyle(row?.style),
    titleFont: normalizeHomepageFont(row?.title_font),
    showHomeLink: normalizeBoolean(row?.show_home_link, true),
  };
}

export function normalizeHomepageFont(value, fallback = DEFAULT_FONT) {
  const font = String(value || "").trim().toLowerCase();
  if (VALID_FONTS.has(font)) return font;
  return VALID_FONTS.has(fallback) ? fallback : DEFAULT_FONT;
}

export function normalizeHomepageStyle(value, fallback = DEFAULT_STYLE) {
  const style = String(value || "").trim().toLowerCase();
  if (style === "simple") return "theme-6";
  if (style === "paper") return "theme-3";
  if (style === "dark") return "theme-4";
  if (VALID_STYLES.has(style)) return style;
  return fallback;
}

function normalizeDescription(value, fallback = "") {
  if (value === undefined || value === null) return String(fallback || "");
  return String(value).replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim().slice(0, MAX_DESCRIPTION_LENGTH);
}

function normalizeDisplayName(value, fallback) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  return text || String(fallback || "Untitled").trim().slice(0, 80) || "Untitled";
}

function normalizeBoolean(value, fallback) {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return Boolean(fallback);
}

function ensureHomepageSettingsColumn(db, name, definition) {
  const columns = db.prepare("PRAGMA table_info(homepage_settings)").all().map((column) => column.name);
  if (!columns.includes(name)) db.exec(`ALTER TABLE homepage_settings ADD COLUMN ${name} ${definition}`);
}

function migrateHomepageSettingsStyles(db) {
  const createSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'homepage_settings'").get()?.sql || "";
  if (createSql.includes("'theme-1'")) {
    db.prepare("UPDATE homepage_settings SET style = ? WHERE style NOT LIKE 'theme-%'").run(DEFAULT_STYLE);
    return;
  }

  db.exec(`
    CREATE TABLE homepage_settings_next (
      user_id INTEGER PRIMARY KEY,
      display_name TEXT,
      style TEXT NOT NULL DEFAULT 'theme-6' CHECK (style IN ('theme-1', 'theme-2', 'theme-3', 'theme-4', 'theme-5', 'theme-6')),
      show_home_link INTEGER NOT NULL DEFAULT 1 CHECK (show_home_link IN (0, 1)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  const rows = db.prepare("SELECT user_id, display_name, style, show_home_link, updated_at FROM homepage_settings").all();
  const insert = db.prepare(
    `INSERT INTO homepage_settings_next (user_id, display_name, style, show_home_link, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    for (const row of rows) {
      insert.run(row.user_id, row.display_name, normalizeHomepageStyle(row.style), normalizeBoolean(row.show_home_link, true) ? 1 : 0, row.updated_at);
    }
  });
  tx();
  db.exec(`
    DROP TABLE homepage_settings;
    ALTER TABLE homepage_settings_next RENAME TO homepage_settings;
  `);
}
