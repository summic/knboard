import Database from "better-sqlite3";
import path from "node:path";

const email = String(process.argv[2] || "").trim().toLowerCase();
if (!email) {
  console.error("Usage: node scripts/set-super-admin.mjs <email>");
  process.exit(1);
}

const dataDir = path.resolve(process.env.KNBOX_DATA_DIR || path.join(process.cwd(), "data"));
const db = new Database(path.join(dataDir, "knbox.sqlite"));
const user = db.prepare("SELECT id, username, role, email FROM users WHERE lower(email) = ?").get(email);
if (!user) {
  console.error(`User with email ${email} not found. Let the user log in once, then run this script again.`);
  process.exit(1);
}

db.prepare("UPDATE users SET role = 'super_admin' WHERE id = ?").run(user.id);
const updated = db.prepare("SELECT id, username, role, email FROM users WHERE id = ?").get(user.id);
console.log(JSON.stringify({ user: updated }, null, 2));
