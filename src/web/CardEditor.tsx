import { useState } from "react";
import { api, type Card, type Column } from "./api";
import { Markdown } from "./Markdown";

type Props = {
  card: Card;
  columns: Column[];
  onClose: () => void;
  onSaved: () => void;
};

const PRIORITIES = ["", "low", "med", "high"];

export function CardEditor({ card, columns, onClose, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [status, setStatus] = useState(card.status);
  const [priority, setPriority] = useState(card.priority || "");
  const [tags, setTags] = useState(card.tags.join(", "));
  const [body, setBody] = useState(card.body);
  const [saving, setSaving] = useState(false);

  const statusName = columns.find((c) => c.id === card.status)?.name || card.status;

  const save = async () => {
    setSaving(true);
    try {
      await api.updateCard(card.category, card.id, {
        title,
        status,
        priority: priority || null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        body,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm(`删除「${card.title}」？`)) return;
    await api.deleteCard(card.category, card.id);
    onSaved();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {!editing ? (
          // -- read mode -----------------------------------------------
          <>
            <div className="modal-head">
              <h2 className="modal-title">{card.title}</h2>
              <button onClick={() => setEditing(true)}>编辑</button>
            </div>
            <div className="badges">
              <span className="badge">{statusName}</span>
              {card.priority && <span className={`pri pri-${card.priority}`}>{card.priority}</span>}
              {card.tags.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
            <article className="doc-read">
              <Markdown>{card.body}</Markdown>
            </article>
            <div className="editor-footer">
              <div className="spacer" />
              <code className="filehint">
                {card.category}/{card.id}/card.md
              </code>
              <button onClick={onClose}>关闭</button>
            </div>
          </>
        ) : (
          // -- edit mode -----------------------------------------------
          <>
            <input
              className="editor-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="标题"
            />
            <div className="editor-meta">
              <label>
                状态
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  {columns.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                优先级
                <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {PRIORITIES.map((p) => (
                    <option value={p} key={p || "none"}>
                      {p || "—"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grow">
                标签
                <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="逗号, 分隔" />
              </label>
            </div>
            <textarea
              className="editor-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="在此撰写 Markdown…"
            />
            <div className="editor-footer">
              <button className="btn-danger" onClick={del}>
                删除
              </button>
              <div className="spacer" />
              <button onClick={() => setEditing(false)}>取消</button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
