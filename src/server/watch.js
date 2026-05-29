import fs from "node:fs";
import path from "node:path";

// Watch the content root for *.md changes and call onChange(paths) — debounced
// so a burst of edits (e.g. an agent rewriting a file repeatedly) collapses
// into a single notification instead of an event storm.
export function watchContent(root, onChange, { debounceMs = 200 } = {}) {
  let timer = null;
  const pending = new Set();

  const flush = () => {
    timer = null;
    const paths = [...pending];
    pending.clear();
    if (paths.length) onChange(paths);
  };

  let watcher;
  try {
    watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const f = filename.toString();
      if (!f.endsWith(".md")) return; // only Markdown
      if (f.includes("node_modules") || f.includes(`${path.sep}.`) || f.startsWith(".")) return;
      pending.add(f);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    });
    watcher.on("error", (e) => console.error("watch error:", e.message));
  } catch (e) {
    console.error("File watching unavailable (live refresh disabled):", e.message);
    return () => {};
  }

  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}
