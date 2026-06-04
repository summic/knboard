#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { startServer } from "../src/server/index.js";
import { isClientCommand, runCli } from "../src/cli/index.js";

loadEnvFiles([".env", ".env.local"]);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" || a === "-p") args.port = Number(argv[++i]);
    else if (a === "--open" || a === "-o") args.open = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else args._.push(a);
  }
  return args;
}

const HELP = `
KN Box — upload and browse small static webpages

Usage:
  knbox [serve] [options]      Start the web UI (default command)
  knbox auth login             Sign in through browser OAuth
  knbox auth token             Print the current token for scripts
  knbox commands --json        Print the command catalog for agents
  knbox login [--server <url>] Sign in through browser OAuth
  knbox ls [path]              List remote files and directories
  knbox cd <path>              Change the saved remote directory
  knbox open [path]            Print a remote file URL or list a directory
  knbox upload <path>          Upload a local file or directory
  knbox rm <path> [path...]    Move remote files or directories to trash
  knbox trash empty --yes      Permanently empty your trash

Options:
  -p, --port <n>    Port to listen on (default 6789, or $PORT)
  -o, --open        Open the browser after starting
  -h, --help        Show this help

Environment:
  KNBOX_DATA_DIR          Data directory for SQLite and uploaded files
  KNBOX_SESSION_SECRET    Cookie signing secret
  KNBOX_PUBLIC_URL        Public origin used for SSO redirects
  KNBOX_FILES_PUBLIC_URL  Public origin for uploaded files
  KNBOX_USER_QUOTA_BYTES  Per-user storage quota (default 1GB)
  KNBOX_KYLITH_ISSUER     KYLITH OIDC issuer (default https://auth0.kylith.com)
  KNBOX_KYLITH_CREDENTIALS_FILE
                           Path to KYLITH web client credentials JSON
  KNBOX_URL                Default server URL for client commands
  KNBOX_TOKEN              Bearer token for non-interactive agent calls
`;

const argv = process.argv.slice(2);
const first = argv[0] && !argv[0].startsWith("-") ? argv[0] : "serve";

if (isClientCommand(first)) {
  try {
    await runCli(argv);
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
  process.exit(0);
}

const args = parseArgs(argv);
const cmd = args._[0] || "serve";

if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const port = args.port || Number(process.env.PORT) || 6789;

if (cmd !== "serve") {
  console.error(`Unknown command: ${cmd}`);
  console.log(HELP);
  process.exit(1);
}

await startServer({ port, open: args.open });

function loadEnvFiles(files) {
  for (const file of files) {
    const resolved = path.resolve(process.cwd(), file);
    if (!fs.existsSync(resolved)) continue;
    const lines = fs.readFileSync(resolved, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      const value = unquoteEnvValue(trimmed.slice(index + 1).trim());
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
