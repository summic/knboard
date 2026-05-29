import { useEffect, useState, useCallback } from "react";
import { LayoutGrid } from "lucide-react";
import { api, subscribeToChanges, type Project, type Category } from "./api";
import { Home } from "./Home";
import { DocsView } from "./DocsView";
import { Board } from "./Board";
import { PageSheet } from "./PageSheet";

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null); // category dir, or null = home
  const [refreshTick, setRefreshTick] = useState(0); // bumps on disk change → views refetch

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

  // Live refresh: on a server-pushed .md change, refetch the home summary and
  // signal the active view to refetch (partial — no full page reload).
  useEffect(() => {
    return subscribeToChanges(() => {
      load();
      setRefreshTick((t) => t + 1);
    });
  }, [load]);

  if (error) return <div className="screen error-screen">⚠️ {error}</div>;
  if (!project) return <div className="screen">Loading…</div>;

  const category: Category | undefined = active
    ? project.categories.find((c) => c.dir === active)
    : undefined;

  return (
    <div className="page">
      <div className="topbar">
        <button className="brand" onClick={() => setActive(null)}>
          <LayoutGrid className="brand-mark" size={18} aria-hidden />
          <span className="brand-name">{project.title}</span>
        </button>
      </div>

      <PageSheet
        open={!!category}
        onDismiss={() => setActive(null)}
        wide={category?.type === "kanban"}
        sheet={
          !category ? null : category.type === "kanban" ? (
            <Board
              dir={category.dir}
              projectTitle={project.title}
              onHome={() => setActive(null)}
              refreshTick={refreshTick}
            />
          ) : (
            <DocsView
              category={category}
              projectTitle={project.title}
              onHome={() => setActive(null)}
              onChange={load}
              refreshTick={refreshTick}
            />
          )
        }
      >
        <div className="sheet">
          <Home project={project} onOpen={(dir) => setActive(dir)} onChange={load} />
        </div>
      </PageSheet>
    </div>
  );
}
