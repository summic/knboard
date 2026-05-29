import { useEffect, useRef, useState, useCallback } from "react";
import { LayoutGrid } from "lucide-react";
import { api, subscribeToChanges, type Project, type Category } from "./api";
import { Home } from "./Home";
import { DocsView } from "./DocsView";
import { Board } from "./Board";

// Hash-based routing (no server config needed; handles nested category dirs):
//   #/                       → home
//   #/<categoryDir>          → a category (dir may be nested, e.g. project-management/board)
//   #/<categoryDir>/<docId>  → a document inside a docs category
function parseHash(hash: string, categories: Category[]): { cat: string | null; doc: string | null } {
  const raw = decodeURIComponent(hash.replace(/^#\/?/, "")).replace(/\/$/, "");
  if (!raw) return { cat: null, doc: null };
  const dirs = categories.map((c) => c.dir).sort((a, b) => b.length - a.length); // longest prefix wins
  for (const dir of dirs) {
    if (raw === dir) return { cat: dir, doc: null };
    if (raw.startsWith(dir + "/")) return { cat: dir, doc: raw.slice(dir.length + 1) };
  }
  return { cat: raw, doc: null }; // unknown dir (will render as not-present)
}

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState(() => window.location.hash);
  const [refreshTick, setRefreshTick] = useState(0);
  const [toast, setToast] = useState<{ paths: string[]; id: number } | null>(null);
  const [toastLeaving, setToastLeaving] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout>>();
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async () => {
    try {
      setProject(await api.getProject());
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Live refresh: refetch home summary + signal views on disk change, and
  // pop a toast naming the changed file(s). Lingers ~8s, then fades out.
  useEffect(() => subscribeToChanges((paths) => {
    load();
    setRefreshTick((t) => t + 1);
    if (paths.length) {
      clearTimeout(dismissTimer.current);
      clearTimeout(leaveTimer.current);
      setToastLeaving(false);
      setToast({ paths, id: Date.now() });
      dismissTimer.current = setTimeout(() => {
        setToastLeaving(true);
        leaveTimer.current = setTimeout(() => {
          setToast(null);
          setToastLeaving(false);
        }, 450);
      }, 8000);
    }
  }), [load]);

  if (error) return <div className="screen error-screen">⚠️ {error}</div>;
  if (!project) return <div className="screen">Loading…</div>;

  const route = parseHash(hash, project.categories);
  const category = route.cat ? project.categories.find((c) => c.dir === route.cat) : undefined;

  const go = (path: string) => {
    window.location.hash = path ? `#/${path}` : "#/";
  };
  const goHome = () => go("");

  const dismissToast = () => {
    clearTimeout(dismissTimer.current);
    clearTimeout(leaveTimer.current);
    setToastLeaving(true);
    leaveTimer.current = setTimeout(() => {
      setToast(null);
      setToastLeaving(false);
    }, 450);
  };

  // Map a changed file path (docs-root-relative) to a route, so clicking the
  // toast jumps to that file: docs → the document; a board file → the board.
  const routeForPath = (p: string): string | null => {
    const cats = [...project.categories].sort((a, b) => b.dir.length - a.dir.length);
    for (const c of cats) {
      if (p === c.dir || p.startsWith(c.dir + "/")) {
        if (c.type === "kanban") return c.dir;
        return `${c.dir}/${p.slice(c.dir.length + 1).replace(/\.md$/, "")}`;
      }
    }
    return null;
  };

  return (
    <div className="page">
      <div className="topbar">
        <button className="brand" onClick={goHome}>
          <LayoutGrid className="brand-mark" size={18} aria-hidden />
          <span className="brand-name">{project.title}</span>
        </button>
      </div>

      <div className={`sheet ${category?.type === "kanban" ? "is-wide" : ""}`}>
        {!category ? (
          <Home project={project} onOpen={(dir) => go(dir)} onChange={load} />
        ) : category.type === "kanban" ? (
          <Board dir={category.dir} category={category} onHome={goHome} refreshTick={refreshTick} />
        ) : (
          <DocsView
            category={category}
            docId={route.doc}
            onHome={goHome}
            onOpenDoc={(id) => go(`${category.dir}/${id}`)}
            onBackToList={() => go(category.dir)}
            onChange={load}
            refreshTick={refreshTick}
          />
        )}
      </div>

      {toast && (
        <div
          className={`toast ${toastLeaving ? "is-leaving" : ""}`}
          role="status"
          title="点击查看该文件"
          onClick={() => {
            const r = routeForPath(toast.paths[0]);
            if (r !== null) go(r);
          }}
        >
          <span className="toast-dot" />
          <div className="toast-body">
            <div className="toast-title">
              文件已更新 <span className="toast-hint">点击查看 →</span>
            </div>
            <div className="toast-files">
              {toast.paths.slice(0, 3).map((p) => (
                <div key={p} className="toast-file">
                  {p}
                </div>
              ))}
              {toast.paths.length > 3 && <div className="toast-more">等 {toast.paths.length} 个文件</div>}
            </div>
          </div>
          <button
            className="toast-close"
            title="关闭"
            onClick={(e) => {
              e.stopPropagation();
              dismissToast();
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
