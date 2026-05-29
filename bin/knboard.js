#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { startServer } from "../src/server/index.js";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" || a === "-p") args.port = Number(argv[++i]);
    else if (a === "--dir" || a === "-d") args.dir = argv[++i];
    else if (a === "--open" || a === "-o") args.open = true;
    else if (a === "--yes" || a === "-y") args.yes = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else args._.push(a);
  }
  return args;
}

const HELP = `
knboard — a local, disk-based Markdown docs & kanban browser

Usage:
  knboard [serve] [options]    Start the web UI (default command)
  knboard init [options]       Create the docs/ project (no prompt)

Options:
  -p, --port <n>    Port to listen on (default 6789, or $PORT)
  -d, --dir <path>  Docs directory (default ./docs, or $KNBOARD_DIR)
  -o, --open        Open the browser after starting
  -y, --yes         Create the docs dir without asking
  -h, --help        Show this help
`;

// Ask a yes/no question on the terminal. Returns false when not a TTY
// (non-interactive) so we never create files without explicit consent.
function confirm(question) {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(/^y(es)?$/i.test(a.trim()));
    })
  );
}

const exists = (p) => fs.stat(p).then(() => true).catch(() => false);

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] || "serve";

if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const dir = args.dir || process.env.KNBOARD_DIR || "docs";
const port = args.port || Number(process.env.PORT) || 6789;
const root = path.resolve(dir);

if (cmd === "init") {
  const { scaffold } = await import("../src/server/content.js");
  const created = await scaffold(root);
  console.log(created ? `Created docs project at ${dir}/` : `${dir}/ already exists — using it as-is.`);
  process.exit(0);
}

if (cmd !== "serve") {
  console.error(`Unknown command: ${cmd}`);
  console.log(HELP);
  process.exit(1);
}

// On startup we read ./docs. If it already exists, never re-create it — just
// use it. If it is missing, ask before creating (unless --yes).
if (!(await exists(root))) {
  const ok = args.yes || (await confirm(`No docs found at ${dir}/. Create a starter docs project here? (y/N) `));
  if (ok) {
    const { scaffold } = await import("../src/server/content.js");
    await scaffold(root);
    console.log(`Created ${dir}/`);
  } else {
    console.log(
      `Skipped creating ${dir}/. Starting empty — add categories from the web UI, ` +
        `or run \`knboard init\` later.`
    );
  }
}

await startServer({ dir: root, port, open: args.open });
