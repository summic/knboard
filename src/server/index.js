import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { Content } from "./content.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, "../../dist/web");

function asyncRoute(fn) {
  return (req, res) =>
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(err.status || 400).json({ error: err.message });
    });
}

export function createApi(content) {
  const api = express.Router();
  api.use(express.json({ limit: "4mb" }));

  // -- project home --------------------------------------------------------
  api.get("/project", asyncRoute(async (_req, res) => {
    res.json(await content.getProject());
  }));

  // Create (add) a missing standard category directory.
  api.post("/categories", asyncRoute(async (req, res) => {
    res.json(await content.addCategory(req.body.dir));
  }));

  // -- docs ----------------------------------------------------------------
  api.get("/docs/:dir", asyncRoute(async (req, res) => {
    res.json(await content.listDocs(req.params.dir));
  }));
  api.post("/docs/:dir", asyncRoute(async (req, res) => {
    res.json(await content.createDoc(req.params.dir, req.body));
  }));
  api.get("/docs/:dir/:id", asyncRoute(async (req, res) => {
    res.json(await content.readDoc(req.params.dir, req.params.id));
  }));
  api.patch("/docs/:dir/:id", asyncRoute(async (req, res) => {
    res.json(await content.updateDoc(req.params.dir, req.params.id, req.body));
  }));
  api.delete("/docs/:dir/:id", asyncRoute(async (req, res) => {
    await content.deleteDoc(req.params.dir, req.params.id);
    res.json({ ok: true });
  }));

  // -- kanban --------------------------------------------------------------
  api.get("/kanban/:dir", asyncRoute(async (req, res) => {
    res.json(await content.getBoard(req.params.dir));
  }));
  api.post("/kanban/:dir/cards", asyncRoute(async (req, res) => {
    res.json(await content.createCard(req.params.dir, req.body));
  }));
  api.patch("/kanban/:dir/cards/:id", asyncRoute(async (req, res) => {
    res.json(await content.updateCard(req.params.dir, req.params.id, req.body));
  }));
  api.delete("/kanban/:dir/cards/:id", asyncRoute(async (req, res) => {
    await content.deleteCard(req.params.dir, req.params.id);
    res.json({ ok: true });
  }));

  return api;
}

export async function startServer({ dir, port = 6789, open = false } = {}) {
  const root = path.resolve(dir);

  // Note: creating the docs dir is the CLI's job (it asks first). startServer
  // never creates content on its own — a missing dir just serves an empty home.
  const content = new Content(root);
  const app = express();

  // -- live refresh: SSE stream of .md changes --------------------------
  const clients = new Set();
  app.get("/api/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable proxy buffering (nginx / vite)
    });
    res.write("retry: 3000\n\n");
    clients.add(res);
    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        /* client gone */
      }
    }, 25000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
    });
  });

  app.use("/api", createApi(content));

  const dev = process.env.KNBOARD_DEV === "1";
  if (!dev) {
    if (await fs.stat(WEB_DIST).catch(() => null)) {
      app.use(express.static(WEB_DIST));
      app.get("*", (_req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
    } else {
      app.get("*", (_req, res) =>
        res
          .status(503)
          .send("Web bundle not built. Run `npm run build` first (or `npm run dev` for development).")
      );
    }
  }

  await new Promise((resolve) => app.listen(port, resolve));
  const url = `http://localhost:${port}`;
  console.log(`\n  🗂️  knboard is serving ${root}`);
  console.log(`      ${dev ? "API on" : "open"} ${url}\n`);

  // Push a change notification to every connected client when *.md files move.
  const { watchContent } = await import("./watch.js");
  watchContent(root, (paths) => {
    const data = JSON.stringify({ type: "change", paths, ts: Date.now() });
    for (const res of clients) {
      try {
        res.write(`data: ${data}\n\n`);
      } catch {
        /* client gone */
      }
    }
  });

  if (open && !dev) {
    const opener =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    const { spawn } = await import("node:child_process");
    spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
  }

  return { app, content, url };
}
