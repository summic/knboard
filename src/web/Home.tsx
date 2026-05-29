import { useState, type CSSProperties } from "react";
import { FileText, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { api, type Project, type Category } from "./api";
import { Icon } from "./icons";
import { colColor } from "./columnColors";
import { Markdown } from "./Markdown";

type Props = {
  project: Project;
  onOpen: (dir: string) => void;
  onChange: () => void;
};

function CategoryCard({ cat, onOpen }: { cat: Category; onOpen: (dir: string) => void }) {
  const open = () => onOpen(cat.dir);
  return (
    <div className="tool-wrap">
      {/* title sits OUTSIDE / above the card */}
      <button className="tool-heading" onClick={open}>
        <span className="tool-icon">
          <Icon name={cat.icon} size={16} />
        </span>
        <span className="tool-name">{cat.name}</span>
      </button>

      <button className="tool" onClick={open}>
        {cat.type === "kanban" && cat.summary && "columns" in cat.summary ? (
          <div className="preview-board">
            {cat.summary.columns.map((col, i) => {
              const cc = colColor(col.id, i);
              return (
                <div
                  className="mini-col"
                  key={col.id}
                  style={{ "--c": cc.c, "--cbg": cc.bg } as CSSProperties}
                >
                  <span className="mini-col-count">({col.count ?? 0})</span>
                  <span className="mini-col-name">{col.name}</span>
                </div>
              );
            })}
          </div>
        ) : cat.summary && "recent" in cat.summary && cat.summary.recent.length ? (
          <ul className="preview-docs">
            {cat.summary.recent.map((d) => (
              <li key={d.id}>
                <FileText size={13} className="preview-doc-icon" aria-hidden />
                {d.title}
              </li>
            ))}
          </ul>
        ) : (
          <div className="preview-empty">还没有内容 — 点进去新建</div>
        )}
      </button>
    </div>
  );
}

export function Home({ project, onOpen, onChange }: Props) {
  const present = project.categories.filter((c) => c.present);
  const missing = project.categories.filter((c) => !c.present);

  const add = async (dir: string) => {
    await api.addCategory(dir);
    onChange();
  };

  return (
    <div className="home">
      <header className="home-head">
        <h1>{project.title}</h1>
        {project.description && <p className="home-desc">{project.description}</p>}
      </header>

      <div className="tools">
        {present.map((cat) => (
          <CategoryCard key={cat.dir} cat={cat} onOpen={onOpen} />
        ))}
      </div>

      {missing.length > 0 && (
        <div className="add-tools">
          <span className="add-tools-label">添加分类</span>
          {missing.map((cat) => (
            <button key={cat.dir} className="add-tool" onClick={() => add(cat.dir)}>
              <Plus size={14} aria-hidden />
              <Icon name={cat.icon} size={14} />
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {project.readme && <Readme md={project.readme} />}
    </div>
  );
}

// docs/README.md rendered on the home page — collapsed to ~a dozen lines with
// an expand toggle.
function Readme({ md }: { md: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`home-readme ${open ? "is-open" : "is-collapsed"}`}>
      <div className="home-readme-body">
        <Markdown>{md}</Markdown>
      </div>
      <button className="home-readme-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        {open ? "收起" : "展开全部"}
      </button>
    </section>
  );
}
