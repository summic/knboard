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
const DEFAULT_CATEGORIES = [
  { dir: "requirements", name: "需求文档", type: "docs", icon: "ClipboardList" },
  { dir: "architecture", name: "技术架构文档", type: "docs", icon: "Network" },
  { dir: "design", name: "设计文档", type: "docs", icon: "Palette" },
  {
    dir: "project-management/board",
    name: "项目管理看板",
    type: "kanban",
    icon: "SquareKanban",
    columns: [
      { id: "inbox", name: "Inbox" },
      { id: "todo", name: "To do" },
      { id: "doing", name: "In progress" },
      { id: "done", name: "Done" },
    ],
  },
];

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
  async getConfig() {
    const p = path.join(this.root, CONFIG_FILE);
    let cfg = {};
    if (await exists(p)) {
      try {
        cfg = JSON.parse(await fs.readFile(p, "utf8"));
      } catch {
        cfg = {};
      }
    }
    const categories = cfg.categories || DEFAULT_CATEGORIES;
    return {
      // Explicit config wins; otherwise borrow the name from the parent
      // project (package.json / README.md); finally fall back.
      title: cfg.title || (await this.deriveTitle()) || "My Project",
      description: cfg.description || "",
      categories,
    };
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

  // Resolve a category definition by its directory (whitelist; dir may be nested).
  async getCategory(dir) {
    const norm = normDir(dir);
    const { categories } = await this.getConfig();
    const cat = categories.find((c) => normDir(c.dir) === norm);
    if (!cat) throw new Error(`Unknown category: ${dir}`);
    return cat;
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
    return { title, description, categories: cards };
  }

  async summarize(cat) {
    if (cat.type === "kanban") {
      const cards = await this.listCards(cat.dir);
      const columns = (cat.columns || []).map((col) => ({
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
  docPath(dir, id) {
    return path.join(dirAbs(this.root, dir), `${safeSegment(id)}.md`);
  }

  async listDocs(dir) {
    dir = normDir(dir);
    const abs = dirAbs(this.root, dir);
    if (!(await exists(abs))) return [];
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const docs = [];
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      docs.push(await this.readDoc(dir, e.name.replace(/\.md$/, "")));
    }
    docs.sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || (b.updated || "").localeCompare(a.updated || "")
    );
    return docs;
  }

  async readDoc(dir, id) {
    const parsed = matter(await fs.readFile(this.docPath(dir, id), "utf8"));
    const d = parsed.data || {};
    return {
      id: safeSegment(id),
      category: normDir(dir),
      title: d.title || id,
      order: d.order ?? 0,
      created: d.created || null,
      updated: d.updated || null,
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

  // -- kanban cards --------------------------------------------------------
  // A card is a *sub-directory* of the board dir; its metadata + description
  // live in `<card>/card.md` (frontmatter). The folder can also hold attachments.
  cardDir(dir, id) {
    return path.join(dirAbs(this.root, dir), safeSegment(id));
  }
  cardFile(dir, id) {
    return path.join(this.cardDir(dir, id), "card.md");
  }

  async listCards(dir) {
    const abs = dirAbs(this.root, dir);
    if (!(await exists(abs))) return [];
    const { columns } = await this.getCategory(dir).catch(() => ({ columns: [] }));
    const fallback = columns?.[0]?.id || "inbox";
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const cards = [];
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      cards.push(await this.readCard(dir, e.name, fallback));
    }
    cards.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return cards;
  }

  async getBoard(dir) {
    const cat = await this.getCategory(dir);
    if (cat.type !== "kanban") throw new Error(`${dir} is not a kanban`);
    return { ...cat, cards: await this.listCards(dir) };
  }

  async readCard(dir, id, fallbackStatus = "inbox") {
    const file = this.cardFile(dir, id);
    let d = {};
    let bodyContent = "";
    if (await exists(file)) {
      const parsed = matter(await fs.readFile(file, "utf8"));
      d = parsed.data || {};
      bodyContent = parsed.content.replace(/^\n+/, "");
    }
    return {
      id: safeSegment(id),
      category: normDir(dir),
      title: d.title || id,
      status: d.status || fallbackStatus,
      priority: d.priority || null,
      tags: Array.isArray(d.tags) ? d.tags : [],
      order: d.order ?? 0,
      created: d.created || null,
      updated: d.updated || null,
      body: bodyContent,
    };
  }

  async writeCard(dir, id, card) {
    const data = {
      title: card.title,
      status: card.status,
      priority: card.priority || undefined,
      tags: card.tags && card.tags.length ? card.tags : undefined,
      order: card.order ?? 0,
      created: card.created || nowISO(),
      updated: nowISO(),
    };
    Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
    await ensureDir(this.cardDir(dir, id));
    await fs.writeFile(this.cardFile(dir, id), matter.stringify(card.body ? `\n${card.body}\n` : "", data));
    return this.readCard(dir, id);
  }

  async createCard(dir, { title, status, body }) {
    const cat = await this.getCategory(dir);
    const base = slugify(title || "untitled");
    let id = base;
    let n = 1;
    while (await exists(this.cardDir(dir, id))) id = `${base}-${++n}`;
    return this.writeCard(dir, id, {
      title: title || "Untitled",
      status: status || cat.columns?.[0]?.id || "inbox",
      tags: [],
      order: Date.now(),
      body: body || "",
    });
  }

  async updateCard(dir, id, patch) {
    const cur = await this.readCard(dir, id);
    return this.writeCard(dir, id, { ...cur, ...patch });
  }

  async deleteCard(dir, id) {
    await fs.rm(this.cardDir(dir, id), { recursive: true, force: true });
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
        // No `title` here — knboard borrows the name from the parent project's
        // package.json / README.md. Set `title` to override.
        description: "A knboard project — browse and edit your requirements, architecture, design docs and kanban, all as Markdown on disk.",
        categories: DEFAULT_CATEGORIES,
      },
      null,
      2
    ) + "\n"
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
  const board = "project-management/board";
  await c.createCard(board, {
    title: "Welcome to knboard 🗂️",
    status: "done",
    body: "每张卡片是 `project-management/board/<卡片>/` 下的一个**文件夹**，元信息在 `card.md`。\n\n- 拖拽卡片切换列\n- 点开编辑\n- 一切写回磁盘\n- 文件夹里还能放附件/子文档",
  });
  await c.createCard(board, { title: "Try editing a card", status: "todo" });
  await c.createCard(board, { title: "Plan the next milestone", status: "inbox" });
  return true;
}
