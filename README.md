# 🗂️ knboard

A **local, disk-based Markdown docs & kanban browser** for your projects — Basecamp-flavored.
Run it inside any project and it serves a friendly web UI over a `docs/` folder: requirements,
architecture, design docs, and a project-management kanban — all stored as plain `.md` files on
disk, so everything diffs cleanly in git. No database, no cloud.

## Install

knboard installs straight from GitHub — pick **global** (use it in any project) or **per-project**.

```bash
# Global — then run `knboard` in any project directory
npm install -g github:summic/knboard

# Per-project (dev dependency) — then run `npx knboard`
npm install -D github:summic/knboard
```

Or run it once with no install at all:

```bash
npx github:summic/knboard          # in your project root
```

> Installing from GitHub triggers a build (`prepare`), so the web UI bundle is ready to serve.

## Use

From your project directory:

```bash
knboard            # serves ./docs on http://localhost:6789
knboard --open     # …and opens the browser
knboard --port 8080
```

On startup knboard reads **`./docs`**:

- **If `docs/` exists** → it's used as-is (never re-created or overwritten).
- **If `docs/` is missing** → knboard asks before creating a starter project.
  Decline and it serves an empty home (add categories from the UI later). Pass `-y/--yes`
  to create without asking (handy in scripts / Docker). Or run `knboard init` to create explicitly.

## CLI

```
knboard [serve] [options]    Start the web UI (default)
knboard init   [options]     Create the docs/ project (no prompt)

  -p, --port <n>    Port (default 6789, or $PORT)
  -d, --dir <path>  Docs directory (default ./docs, or $KNBOARD_DIR)
  -o, --open        Open the browser
  -y, --yes         Create docs/ without asking
```

## Disk layout

knboard divides `docs/` into **categories**, each a sub-directory. A category shows on the
home page only when its directory exists; missing standard categories can be created from the
home page.

```
docs/
  knboard.config.json       # { title?, description?, categories: [{ dir, name, type, icon, columns? }] }
  requirements/             # type "docs"   — *.md documents
  architecture/             # type "docs"
  design/                   # type "docs"
  project-management/
    board/                  # type "kanban" — each card is a sub-folder:
      <card-slug>/
        card.md             #   frontmatter: { title, status, priority, tags, order } + body
```

- **Docs** categories list their `*.md` files; open one to read (rendered Markdown with syntax
  highlighting) or edit (raw Markdown with a formatting toolbar + live preview).
- **Kanban** cards are *sub-folders* of the board dir; status/order live in each `card.md`.
  Drag a card between columns and knboard rewrites its `card.md`. A folder with no `card.md`
  still appears (first column, titled by folder name).
- The **project title** is borrowed from the parent project's `package.json` `name` or
  `README.md` heading (override with `title` in `knboard.config.json`).
- knboard watches `*.md` and **live-refreshes** the page in place when files change on disk.

## Develop

```bash
git clone https://github.com/summic/knboard && cd knboard
npm install
npm run dev       # Vite on :5173 (proxies /api), Node API on :6789
npm run build     # bundle the web UI into dist/web
```

## License

MIT
