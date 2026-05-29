import { useEffect, useRef, useState, useCallback } from "react";
import { Home } from "lucide-react";
import { api, type Category, type Doc } from "./api";
import { Markdown } from "./Markdown";
import { MarkdownEditor } from "./MarkdownEditor";
import { Breadcrumb } from "./Breadcrumb";
import { Icon } from "./icons";

type Props = {
  category: Category;
  docId: string | null; // from the URL — null = list view
  onHome: () => void;
  onOpenDoc: (id: string) => void; // navigates (changes URL)
  onBackToList: () => void;
  onChange: () => void;
  refreshTick?: number;
};

// Group docs by sub-folder, preserving the server's order (most-recently
// modified first) — so groups appear by their newest doc, and rows within a
// group stay newest-first.
function groupByFolder(docs: Doc[]): [string, Doc[]][] {
  const map = new Map<string, Doc[]>();
  for (const d of docs) {
    const f = d.folder || "";
    (map.get(f) ?? map.set(f, []).get(f)!).push(d);
  }
  return [...map.entries()];
}

const homeCrumb = (onHome: () => void) => ({
  label: "",
  icon: <Home size={15} aria-hidden />,
  title: "首页",
  onClick: onHome,
});

export function DocsView({ category, docId, onHome, onOpenDoc, onBackToList, onChange, refreshTick }: Props) {
  const dir = category.dir;
  const [docs, setDocs] = useState<Doc[]>([]);

  const load = useCallback(async () => {
    setDocs(await api.listDocs(dir));
    onChange();
  }, [dir, onChange]);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  const create = async () => {
    const title = prompt("文档标题");
    if (!title) return;
    const doc = await api.createDoc(dir, { title });
    await load();
    onOpenDoc(doc.id); // navigate to the new doc
  };

  if (docId) {
    return (
      <DocPage
        dir={dir}
        id={docId}
        category={category}
        onHome={onHome}
        onBackToList={onBackToList}
        onChanged={load}
        refreshTick={refreshTick}
      />
    );
  }

  return (
    <div className="section">
      <div className="page-head">
        <Breadcrumb
          items={[homeCrumb(onHome), { label: category.name, icon: <Icon name={category.icon} size={14} /> }]}
        />
        <div className="page-actions">
          <button className="btn-primary" onClick={create}>
            + 新建文档
          </button>
        </div>
      </div>

      {docs.length === 0 ? (
        <div className="empty">还没有文档。点「新建文档」开始。</div>
      ) : (
        groupByFolder(docs).map(([folder, items]) => (
          <div className="doc-group" key={folder || "/"}>
            {folder && <div className="doc-group-head">{folder.replace(/\//g, " / ")}</div>}
            <ul className="doc-list">
              {items.map((d) => (
                <li key={d.id} className="doc-row" onClick={() => onOpenDoc(d.id)}>
                  <span className="doc-title">{d.title}</span>
                  <span className="doc-meta">
                    {d.updated ? new Date(d.updated).toLocaleDateString() : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}

// ── single document: read (rendered) ↔ edit ─────────────────────────────
function DocPage({
  dir,
  id,
  category,
  onHome,
  onBackToList,
  onChanged,
  refreshTick,
}: {
  dir: string;
  id: string;
  category: Category;
  onHome: () => void;
  onBackToList: () => void;
  onChanged: () => void;
  refreshTick?: number;
}) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(() => {
    api.readDoc(dir, id).then((d) => {
      setDoc(d);
      setTitle(d.title);
      setBody(d.body);
    });
  }, [dir, id]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Live refresh on disk change — but never clobber the editor mid-edit.
  const firstTick = useRef(true);
  useEffect(() => {
    if (firstTick.current) {
      firstTick.current = false;
      return;
    }
    if (!editing) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateDoc(dir, id, { title, body });
      await reload();
      setEditing(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setTitle(doc?.title ?? "");
    setBody(doc?.body ?? "");
    setEditing(false);
  };

  const del = async () => {
    if (!confirm(`删除「${doc?.title}」？`)) return;
    await api.deleteDoc(dir, id);
    onChanged();
    onBackToList();
  };

  return (
    <div className="section">
      <div className="page-head">
        <Breadcrumb
          items={[
            homeCrumb(onHome),
            { label: category.name, icon: <Icon name={category.icon} size={14} />, onClick: onBackToList },
            { label: `${id}.md` },
          ]}
        />
        <div className="page-actions">
          {editing ? (
            <>
              <button onClick={cancelEdit}>取消</button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </button>
            </>
          ) : (
            <button className="edit-btn" onClick={() => setEditing(true)}>
              编辑
            </button>
          )}
        </div>
      </div>

      {!doc ? (
        <div className="empty">加载中…</div>
      ) : !editing ? (
        <article className="doc-read">
          <Markdown>{doc.body}</Markdown>
        </article>
      ) : (
        <>
          <input
            className="editor-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题"
          />
          <MarkdownEditor value={body} onChange={setBody} placeholder="在此撰写 Markdown…" />
          <div className="section-foot">
            <button className="btn-danger" onClick={del}>
              删除
            </button>
          </div>
        </>
      )}
    </div>
  );
}
