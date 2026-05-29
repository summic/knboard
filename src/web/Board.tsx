import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { Home } from "lucide-react";
import { api, type Board as BoardData, type Card, type Category } from "./api";
import { CardEditor } from "./CardEditor";
import { Breadcrumb } from "./Breadcrumb";
import { Icon } from "./icons";
import { colColor } from "./columnColors";

type Props = { dir: string; category: Category; onHome: () => void; refreshTick?: number };

// Terminal columns shown collapsed (vertical, count-only) at the right edge.
const COLLAPSIBLE = new Set(["completed", "complete", "cancelled", "canceled", "done"]);

// Read-only board. Status = the column folder a card's file lives in; moving
// cards is done by `git mv` outside knboard (no drag). Click a card to read/edit.
export function Board({ dir, category, onHome, refreshTick }: Props) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [editing, setEditing] = useState<Card | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const columnsRef = useRef<HTMLDivElement>(null);
  const cardRects = useRef<Map<string, DOMRect>>(new Map());

  const load = useCallback(() => {
    api.getBoard(dir).then(setBoard);
  }, [dir]);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  // FLIP: when the board reloads (e.g. a file was `git mv`-d to another column),
  // animate each card from where it used to be to its new spot. Keyed by the
  // card's filename (stable across column moves).
  useLayoutEffect(() => {
    const root = columnsRef.current;
    if (!root) return;
    const next = new Map<string, DOMRect>();
    root.querySelectorAll<HTMLElement>(".card[data-leaf]").forEach((el) => {
      const leaf = el.dataset.leaf!;
      const r = el.getBoundingClientRect();
      next.set(leaf, r);
      const prev = cardRects.current.get(leaf);
      if (prev) {
        const dx = prev.left - r.left;
        const dy = prev.top - r.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          el.style.transition = "none";
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          void el.offsetWidth; // commit the inverted start position
          el.style.transition = "transform 0.5s cubic-bezier(0.32, 0.72, 0, 1)";
          el.style.transform = "translate(0, 0)";
        }
      }
    });
    cardRects.current = next;
  }, [board]);

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const cardsByStatus = (status: string) =>
    (board?.cards ?? [])
      .filter((c) => c.status === status)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <div className="section">
      <div className="page-head">
        <Breadcrumb
          items={[
            { label: "", icon: <Home size={15} aria-hidden />, title: "首页", onClick: onHome },
            { label: category.name, icon: <Icon name={category.icon} size={14} /> },
          ]}
        />
      </div>

      {!board ? (
        <div className="empty">加载中…</div>
      ) : (
        <div className="columns" ref={columnsRef}>
          {board.columns.map((col, idx) => {
            const cards = cardsByStatus(col.id);
            const cc = colColor(col.id, idx);
            const style = { "--c": cc.c, "--cbg": cc.bg } as React.CSSProperties;
            const collapsible = COLLAPSIBLE.has(col.id);

            if (collapsible && !expanded.has(col.id)) {
              return (
                <button
                  className="column-collapsed"
                  key={col.id}
                  style={style}
                  onClick={() => toggle(col.id)}
                  title={`${col.name}（${cards.length}）— 点击展开`}
                >
                  <span className="column-collapsed-count">{cards.length}</span>
                  <span className="column-collapsed-name">{col.name}</span>
                </button>
              );
            }

            return (
              <div className="column" key={col.id} style={style}>
                <div
                  className={`column-head ${collapsible ? "is-clickable" : ""}`}
                  onClick={collapsible ? () => toggle(col.id) : undefined}
                  title={collapsible ? "点击收起" : undefined}
                >
                  <span className="column-name">{col.name}</span>
                  <span className="column-count">{cards.length}</span>
                </div>
                <div className="column-body">
                  {cards.map((card) => (
                    <article
                      className="card"
                      key={card.id}
                      data-leaf={card.id.split("/").pop()}
                      onClick={() => setEditing(card)}
                    >
                      {card.priority && <span className={`pri pri-${card.priority}`}>{card.priority}</span>}
                      <div className="card-title">{card.title}</div>
                      {card.tags.length > 0 && (
                        <div className="card-tags">
                          {card.tags.map((t) => (
                            <span className="tag" key={t}>
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <CardEditor
          card={editing}
          columns={board?.columns ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
