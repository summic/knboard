import { useEffect, useState, useCallback } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { Home } from "lucide-react";
import { api, type Board as BoardData, type Card } from "./api";
import { CardEditor } from "./CardEditor";
import { useSheetChrome } from "./PageSheet";
import { colColor } from "./columnColors";

type Props = { dir: string; projectTitle: string; onHome: () => void; refreshTick?: number };

export function Board({ dir, onHome, refreshTick }: Props) {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [editing, setEditing] = useState<Card | null>(null);

  const load = useCallback(() => {
    api.getBoard(dir).then(setBoard);
  }, [dir]);

  useEffect(() => {
    load();
  }, [load, refreshTick]); // refetch on mount and on disk change

  useSheetChrome(
    {
      crumbs: [{ label: "", icon: <Home size={15} aria-hidden />, title: "首页", onClick: onHome }],
      title: board?.name ?? "",
    },
    [board?.dir, board?.name]
  );

  if (!board) return <div className="empty">加载中…</div>;

  const cardsByStatus = (status: string) =>
    board.cards.filter((c) => c.status === status).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const onDragEnd = async (result: DropResult) => {
    const { destination, draggableId } = result;
    if (!destination) return;
    const card = board.cards.find((c) => c.id === draggableId);
    if (!card) return;
    const destStatus = destination.droppableId;
    const order = destination.index * 10;
    if (card.status === destStatus && card.order === order) return;
    await api.updateCard(dir, card.id, { status: destStatus, order });
    load();
  };

  const addCard = async (status: string) => {
    const title = prompt("卡片标题");
    if (!title) return;
    await api.createCard(dir, { title, status });
    load();
  };

  return (
    <div className="section">
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="columns">
          {board.columns.map((col, idx) => {
            const cards = cardsByStatus(col.id);
            const cc = colColor(idx);
            return (
              <Droppable droppableId={col.id} key={col.id}>
                {(provided, snapshot) => (
                  <div
                    className={`column ${snapshot.isDraggingOver ? "is-over" : ""}`}
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    style={{ "--c": cc.c, "--cbg": cc.bg } as React.CSSProperties}
                  >
                    <div className="column-head">
                      <span className="column-name">{col.name}</span>
                      <span className="column-count">{cards.length}</span>
                    </div>
                    <div className="column-body">
                      {cards.map((card, i) => (
                        <Draggable draggableId={card.id} index={i} key={card.id}>
                          {(p, snap) => (
                            <article
                              className={`card ${snap.isDragging ? "is-dragging" : ""}`}
                              ref={p.innerRef}
                              {...p.draggableProps}
                              {...p.dragHandleProps}
                              onClick={() => setEditing(card)}
                            >
                              {card.priority && (
                                <span className={`pri pri-${card.priority}`}>{card.priority}</span>
                              )}
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
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                    <button className="add-card" onClick={() => addCard(col.id)}>
                      + Add
                    </button>
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>

      {editing && (
        <CardEditor
          card={editing}
          columns={board.columns}
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
