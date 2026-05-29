import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

// ---------------------------------------------------------------------------
// knboard maps a single project directory. The project is divided into
// standard *categories*, each backed by a sub-directory:
//
//   <root>/
//     knboard.config.json     optional: { title, description, categories }
//     requirements/           type "docs"   → *.md documents
//     architecture/           type "docs"
//     design/                 type "docs"
//     kanban/                 type "kanban" → card *.md files
//
// A category card shows on the home page only when its directory exists.
// Missing standard categories can be created on demand ("add").
// ---------------------------------------------------------------------------

const CONFIG_FILE = "knboard.config.json";

// `icon` is a stable Lucide icon name, mapped to a component in the web app.
// Nice display labels + Lucide icons for well-known dir names (auto-discovery).
const NAME_LABELS = {
  adr: "ADR",
  architecture: "Architecture",
  contributing: "Contributing",
  design: "Design",
  handbook: "Handbook",
  legacy: "Legacy",
  product: "Product",
  "project-management": "Project Management",
  requirements: "Requirements",
  kanban: "Kanban",
};
const ICON_MAP = {
  adr: "Scale",
  architecture: "Network",
  contributing: "Users",
  design: "Palette",
  handbook: "BookOpen",
  legacy: "Archive",
  product: "Package",
  "project-management": "ClipboardList",
  requirements: "ClipboardList",
  kanban: "SquareKanban",
};

function prettify(dir) {
  if (NAME_LABELS[dir]) return NAME_LABELS[dir];
  return dir
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// A dir is a kanban board if its leaf name is one of these.
const BOARD_DIR_NAMES = new Set(["kanban", "board"]);
const isBoardName = (n) => BOARD_DIR_NAMES.has(n);

// Preferred kanban column order (Linear five-state + simple defaults); unknown
// columns sort after these, alphabetically.
const COLUMN_ORDER = [
  "backlog",
  "inbox",
  "planned",
  "todo",
  "in-progress",
  "doing",
  "review",
  "approved",
  "completed",
  "done",
  "cancelled",
];

// Column folder name → display label (strip leading order prefix, title-case).
function prettifyColumn(name) {
  const stripped = name.replace(/^\d+[-_.]\s*/, "");
  return stripped
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function nowISO() {
  return new Date().toISOString();
}

function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9一-龥]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const ensureDir = (p) => fs.mkdir(p, { recursive: true });

// Guard against path traversal: a name must be a single, safe path segment.
function safeSegment(name) {
  const seg = path.basename(String(name));
  if (!seg || seg === "." || seg === ".." || seg.includes("/") || seg.includes("\\")) {
    throw new Error(`Invalid name: ${name}`);
  }
  return seg;
}

// A category dir may be nested (e.g. "project-management/board"). Validate each
// segment, reject traversal, return forward-slash-normalized relative path.
function normDir(rel) {
  const parts = String(rel)
    .split(/[\\/]+/)
    .filter(Boolean);
  if (!parts.length || parts.some((p) => p === "." || p === "..")) {
    throw new Error(`Invalid path: ${rel}`);
  }
  return parts.join("/");
}

// Absolute path for a (possibly nested) category dir.
const dirAbs = (root, dir) => path.join(root, ...normDir(dir).split("/"));

export class Content {
  constructor(root) {
    this.root = path.resolve(root);
  }

  // -- config & categories -------------------------------------------------
  async rawConfig() {
    const p = path.join(this.root, CONFIG_FILE);
    if (await exists(p)) {
      try {
        return JSON.parse(await fs.readFile(p, "utf8"));
      } catch {
        return {};
      }
    }
    return {};
  }

  async getConfig() {
    const cfg = await this.rawConfig();
    return {
      // Explicit config wins; otherwise borrow the name from the parent
      // project (package.json / README.md); finally fall back.
      title: cfg.title || (await this.deriveTitle()) || "My Project",
      description: cfg.description || "",
      categories: await this.resolveCategories(cfg),
    };
  }

  // Categories: use the explicit list from config if given, otherwise
  // auto-discover every top-level directory under docs/ (the `kanban` dir
  // becomes a board; everything else is a docs list).
  async resolveCategories(cfg) {
    cfg = cfg || (await this.rawConfig());
    if (Array.isArray(cfg.categories) && cfg.categories.length) return cfg.categories;
    return this.discoverCategories();
  }

  async discoverCategories() {
    if (!(await exists(this.root))) return [];
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const docs = [];
    const boards = [];
    const mkKanban = (dir) => ({ dir, name: "Kanban", type: "kanban", icon: "SquareKanban" });
    const mkDocs = (dir) => ({ dir, name: prettify(dir), type: "docs", icon: ICON_MAP[dir] || "Folder" });

    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
      const dir = e.name;
      if (isBoardName(dir)) {
        boards.push(mkKanban(dir));
        continue;
      }
      docs.push(mkDocs(dir));
      // also surface a board nested one level down, e.g. project-management/board
      const sub = await fs.readdir(path.join(this.root, dir), { withFileTypes: true }).catch(() => []);
      for (const s of sub) {
        if (s.isDirectory() && isBoardName(s.name)) boards.push(mkKanban(`${dir}/${s.name}`));
      }
    }
    docs.sort((a, b) => a.dir.localeCompare(b.dir));
    return [...boards, ...docs]; // kanban first, then docs
  }

  // Project overview rendered on the home page (docs/README.md), if present.
  async readReadme() {
    for (const name of ["README.md", "readme.md"]) {
      const p = path.join(this.root, name);
      if (await exists(p)) return fs.readFile(p, "utf8");
    }
    return null;
  }

  // Look one level up (the project that knboard lives inside) for a name.
  async deriveTitle() {
    const parent = path.dirname(this.root);
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(parent, "package.json"), "utf8"));
      if (typeof pkg.name === "string" && pkg.name.trim()) return pkg.name.trim();
    } catch {
      /* no package.json */
    }
    try {
      const readme = await fs.readFile(path.join(parent, "README.md"), "utf8");
      const m = readme.match(/^#\s+(.+?)\s*$/m);
      if (m) return m[1].trim();
    } catch {
      /* no README.md */
    }
    return null;
  }

  // Resolve a category definition by its directory (dir may be nested).
  async getCategory(dir) {
    const norm = normDir(dir);
    const cats = await this.resolveCategories();
    const cat = cats.find((c) => normDir(c.dir) === norm);
    if (cat) return cat;
    // Fallback for a dir that exists on disk but isn't in the resolved list.
    if (await exists(dirAbs(this.root, norm))) {
      const leaf = norm.split("/").pop();
      const isKanban = isBoardName(leaf);
      return {
        dir: norm,
        name: isKanban ? "Kanban" : prettify(leaf),
        type: isKanban ? "kanban" : "docs",
        icon: isKanban ? "SquareKanban" : ICON_MAP[leaf] || "Folder",
      };
    }
    throw new Error(`Unknown category: ${dir}`);
  }

  // -- project home --------------------------------------------------------
  // Read-only: never creates the docs dir (the CLI does that, after asking).
  async getProject() {
    const { title, description, categories } = await this.getConfig();
    const cards = [];
    for (const cat of categories) {
      const present = await exists(dirAbs(this.root, cat.dir));
      const summary = present ? await this.summarize(cat) : null;
      cards.push({ ...cat, present, summary });
    }
    return { title, description, categories: cards, readme: await this.readReadme() };
  }

  async summarize(cat) {
    if (cat.type === "kanban") {
      const [cols, cards] = await Promise.all([this.listColumns(cat.dir), this.listCards(cat.dir)]);
      const columns = cols.map((col) => ({
        ...col,
        count: cards.filter((c) => c.status === col.id).length,
      }));
      return { total: cards.length, columns };
    }
    // docs
    const docs = await this.listDocs(cat.dir);
    return { total: docs.length, recent: docs.slice(0, 5).map((d) => ({ id: d.id, title: d.title })) };
  }

  async addCategory(dir) {
    const cat = await this.getCategory(dir); // validates against whitelist
    await ensureDir(dirAbs(this.root, cat.dir));
    return this.getProject();
  }

  // -- docs ----------------------------------------------------------------
  // A doc id is a category-relative path (may be nested, e.g. "org/requirements").
  docPath(dir, id) {
    return path.join(dirAbs(this.root, dir), ...normDir(id).split("/")) + ".md";
  }

  // Recursively list every *.md under a category (so categories with module
  // sub-folders like product/<module>/*.md show up).
  async listDocs(dir) {
    dir = normDir(dir);
    const base = dirAbs(this.root, dir);
    if (!(await exists(base))) return [];
    const docs = [];
    const walk = async (rel) => {
      const absDir = rel ? path.join(base, ...rel.split("/")) : base;
      const entries = await fs.readdir(absDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(childRel);
        else if (e.isFile() && e.name.endsWith(".md")) docs.push(await this.readDoc(dir, childRel.replace(/\.md$/, "")));
      }
    };
    await walk("");
    docs.sort((a, b) => b.mtime - a.mtime); // most-recently-modified first
    return docs;
  }

  async readDoc(dir, id) {
    id = normDir(id);
    const file = this.docPath(dir, id);
    const [raw, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    const parsed = matter(raw);
    const d = parsed.data || {};
    const cut = id.lastIndexOf("/");
    const leaf = cut < 0 ? id : id.slice(cut + 1);
    return {
      id,
      category: normDir(dir),
      folder: cut < 0 ? "" : id.slice(0, cut), // sub-folder path (for grouping); "" = root
      title: d.title || leaf,
      order: d.order ?? 0,
      created: d.created || null,
      updated: d.updated || stat.mtime.toISOString(),
      mtime: stat.mtimeMs, // real file modified time, for sorting
      body: parsed.content.replace(/^\n+/, ""),
    };
  }

  async writeDoc(dir, id, { title, body, order, created }) {
    const data = { title, order: order ?? 0, created: created || nowISO(), updated: nowISO() };
    await ensureDir(path.dirname(this.docPath(dir, id)));
    await fs.writeFile(this.docPath(dir, id), matter.stringify(body ? `\n${body}\n` : "", data));
    return this.readDoc(dir, id);
  }

  async createDoc(dir, { title, body }) {
    dir = normDir(dir);
    const base = slugify(title || "untitled");
    let id = base;
    let n = 1;
    while (await exists(this.docPath(dir, id))) id = `${base}-${++n}`;
    return this.writeDoc(dir, id, { title: title || "Untitled", body: body || "", order: Date.now() });
  }

  async updateDoc(dir, id, patch) {
    const cur = await this.readDoc(dir, id);
    return this.writeDoc(dir, id, { ...cur, ...patch });
  }

  async deleteDoc(dir, id) {
    await fs.rm(this.docPath(dir, id));
  }

  // -- kanban: columns are folders, cards are *.md files inside them --------
  //
  //   <board>/
  //     backlog/      <slug>.md
  //     planned/      NNN-<slug>.md   (NNN = order)
  //     in-progress/  …
  //
  // A card's status IS the column folder it lives in; moving = renaming the
  // file into another column folder (a clean `git mv`, no content rewrite).
  // A card id is the board-relative path "<column>/<file.md>".

  // Columns = the board's sub-folders, ordered by a sensible Linear-ish
  // preference, then alphabetically for anything unrecognized.
  async listColumns(dir) {
    const abs = dirAbs(this.root, dir);
    if (!(await exists(abs))) return [];
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const cols = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
    cols.sort((a, b) => {
      const ia = COLUMN_ORDER.indexOf(a);
      const ib = COLUMN_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.localeCompare(b, undefined, { numeric: true });
    });
    return cols.map((id) => ({ id, name: prettifyColumn(id) }));
  }

  cardAbs(dir, colId, file) {
    return path.join(dirAbs(this.root, dir), safeSegment(colId), safeSegment(file));
  }

  // id = "<column>/<file.md>"
  parseCardId(id) {
    const norm = String(id).replace(/\\/g, "/");
    const slash = norm.lastIndexOf("/");
    if (slash < 0) throw new Error(`Invalid card id: ${id}`);
    return { colId: safeSegment(norm.slice(0, slash)), file: safeSegment(norm.slice(slash + 1)) };
  }

  async listCards(dir) {
    const cols = await this.listColumns(dir);
    const cards = [];
    for (const col of cols) {
      const colAbs = path.join(dirAbs(this.root, dir), col.id);
      const files = await fs.readdir(colAbs, { withFileTypes: true }).catch(() => []);
      for (const f of files) {
        if (!f.isFile() || !f.name.endsWith(".md") || f.name.startsWith(".")) continue;
        if (f.name.toLowerCase() === "readme.md") continue; // column docs, not a card
        cards.push(await this.readCard(dir, `${col.id}/${f.name}`));
      }
    }
    cards.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
    return cards;
  }

  async getBoard(dir) {
    const cat = await this.getCategory(dir);
    if (cat.type !== "kanban") throw new Error(`${dir} is not a kanban`);
    return { ...cat, columns: await this.listColumns(dir), cards: await this.listCards(dir) };
  }

  async readCard(dir, id) {
    const { colId, file } = this.parseCardId(id);
    const abs = this.cardAbs(dir, colId, file);
    let d = {};
    let bodyContent = "";
    if (await exists(abs)) {
      const parsed = matter(await fs.readFile(abs, "utf8"));
      d = parsed.data || {};
      bodyContent = parsed.content.replace(/^\n+/, "");
    }
    const base = file.replace(/\.md$/, "");
    const numPrefix = base.match(/^(\d+)[-_.]/);
    return {
      id: `${colId}/${file}`,
      category: normDir(dir),
      title: d.title || base.replace(/^\d+[-_.]\s*/, ""),
      status: colId,
      priority: d.priority || null,
      tags: Array.isArray(d.tags) ? d.tags : [],
      order: d.order ?? (numPrefix ? Number(numPrefix[1]) : 0),
      created: d.created || null,
      updated: d.updated || null,
      body: bodyContent,
    };
  }

  // Write a card's frontmatter+body to a given column (used by editor save).
  async writeCardFile(dir, colId, file, card) {
    const data = {
      title: card.title,
      priority: card.priority || undefined,
      tags: card.tags && card.tags.length ? card.tags : undefined,
      created: card.created || undefined,
      updated: nowISO(),
    };
    Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
    const abs = this.cardAbs(dir, colId, file);
    await ensureDir(path.dirname(abs));
    await fs.writeFile(abs, matter.stringify(card.body ? `\n${card.body}\n` : "", data));
  }

  async createCard(dir, { title, status, body }) {
    const cols = await this.listColumns(dir);
    const colId = status || cols[0]?.id || "backlog";
    const base = slugify(title || "untitled");
    let file = `${base}.md`;
    let n = 1;
    while (await exists(this.cardAbs(dir, colId, file))) file = `${base}-${++n}.md`;
    await this.writeCardFile(dir, colId, file, { title: title || "Untitled", body: body || "", created: nowISO() });
    return this.readCard(dir, `${colId}/${file}`);
  }

  async updateCard(dir, id, patch) {
    const { colId, file } = this.parseCardId(id);
    const targetCol = patch.status ? safeSegment(patch.status) : colId;
    const contentKeys = ["title", "body", "priority", "tags"];
    const hasContentEdit = contentKeys.some((k) => k in patch);

    if (!hasContentEdit && targetCol !== colId) {
      // pure drag → move the file between column folders, content untouched
      const src = this.cardAbs(dir, colId, file);
      const dest = this.cardAbs(dir, targetCol, file);
      await ensureDir(path.dirname(dest));
      await fs.rename(src, dest);
      return this.readCard(dir, `${targetCol}/${file}`);
    }

    // editor save (maybe also a column change): rewrite at target, drop old
    const cur = await this.readCard(dir, id);
    const next = { ...cur, ...patch };
    await this.writeCardFile(dir, targetCol, file, next);
    if (targetCol !== colId) await fs.rm(this.cardAbs(dir, colId, file), { force: true });
    return this.readCard(dir, `${targetCol}/${file}`);
  }

  async deleteCard(dir, id) {
    const { colId, file } = this.parseCardId(id);
    await fs.rm(this.cardAbs(dir, colId, file), { force: true });
  }
}

// ---------------------------------------------------------------------------
// Sample scaffolding for `knboard init` / first run
// ---------------------------------------------------------------------------
export async function scaffold(root) {
  if (await exists(root)) return false;
  await ensureDir(root);
  await fs.writeFile(
    path.join(root, CONFIG_FILE),
    JSON.stringify(
      {
        // No `title` (borrowed from the parent project's package.json / README.md)
        // and no `categories` — knboard auto-discovers the top-level dirs below.
        // Add a `categories` array here to curate names / icons / kanban columns.
        description: "A knboard project — browse and edit your docs and kanban, all as Markdown on disk.",
      },
      null,
      2
    ) + "\n"
  );
  await fs.writeFile(
    path.join(root, "README.md"),
    "# Project docs\n\nThis folder is browsed by [knboard](https://github.com/summic/knboard).\n" +
      "Each sub-directory is a category; the `kanban/` folder is the board.\n"
  );
  const c = new Content(root);

  await c.createDoc("requirements", {
    title: "需求总览",
    body: [
      "# 需求总览",
      "",
      "这是一份 Markdown 需求文档，对应磁盘上的 `requirements/需求总览.md`。在网页里编辑、保存后写回磁盘，用编辑器或 `git` 也能查看。",
      "",
      "## 功能需求",
      "",
      "| 编号 | 功能 | 优先级 | 状态 |",
      "| --- | --- | :---: | --- |",
      "| F-1 | 首页按目录展示分类卡片 | 高 | ✅ 已完成 |",
      "| F-2 | 文档渲染浏览 / 编辑双模式 | 高 | ✅ 已完成 |",
      "| F-3 | 看板拖拽改状态 | 中 | ✅ 已完成 |",
      "| F-4 | 全文搜索 | 低 | ⏳ 计划中 |",
      "",
      "## 验收清单",
      "",
      "- [x] 目录存在才显示卡片",
      "- [x] Markdown 支持表格、代码块、任务列表",
      "- [ ] 支持图片附件",
      "",
      "## 接口示例",
      "",
      "```bash",
      "curl http://localhost:6789/api/docs/requirements",
      "```",
    ].join("\n"),
  });
  await c.createDoc("architecture", {
    title: "技术架构",
    body: [
      "# 技术架构",
      "",
      "knboard 是一个**单包、零数据库**的本地工具：Node 服务端读写磁盘 Markdown，React 前端提供浏览/编辑界面。",
      "",
      "| 层 | 技术 | 职责 |",
      "| --- | --- | --- |",
      "| 服务端 | Express | REST API + 静态托管 |",
      "| 内容层 | gray-matter | 解析/写回 frontmatter |",
      "| 前端 | React + Vite | 首页、文档、看板 |",
      "",
      "## 数据流",
      "",
      "```",
      "浏览器 ──fetch──▶ /api/* ──▶ Content 层 ──▶ *.md 文件",
      "```",
      "",
      "- [x] REST API 全链路读写",
      "- [ ] 文件变更监听 + 实时刷新",
    ].join("\n"),
  });
  await c.createDoc("design", {
    title: "设计说明",
    body: [
      "# 设计说明",
      "",
      "视觉风格参考 **Basecamp**：温暖、克制、留白充足。",
      "",
      "## 设计原则",
      "",
      "1. **内容优先** —— 文档默认进入渲染浏览，编辑是次要动作。",
      "2. **可被 git 读懂** —— 界面只是磁盘文件的镜像。",
      "",
      "## 配色",
      "",
      "| 角色 | 取值 |",
      "| --- | --- |",
      "| Page | `#eef1ec` |",
      "| Brick | `#b8432e` |",
      "| Accent | `#1a73c2` |",
      "",
      "> 💡 任务列表会渲染成可视的勾选框：",
      "",
      "- [x] 首页仪表盘",
      "- [ ] 暗色主题",
    ].join("\n"),
  });
  const board = "kanban";
  await c.createCard(board, {
    title: "Welcome to knboard 🗂️",
    status: "done",
    body: "每张卡片是 `kanban/<卡片>/` 下的一个**文件夹**，元信息在 `card.md`。\n\n- 拖拽卡片切换列\n- 点开编辑\n- 一切写回磁盘\n- 文件夹里还能放附件/子文档",
  });
  await c.createCard(board, { title: "Try editing a card", status: "todo" });
  await c.createCard(board, { title: "Plan the next milestone", status: "inbox" });
  return true;
}
