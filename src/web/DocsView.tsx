import { useEffect, useRef, useState, useCallback } from "react";
import { Home } from "lucide-react";
import { api, type Category, type Doc } from "./api";
import { Markdown } from "./Markdown";
import { MarkdownEditor } from "./MarkdownEditor";
import { useSheetChrome } from "./PageSheet";
import { Icon } from "./icons";

type Props = {
  category: Category;
  projectTitle: string;
  onHome: () => void;
  onChange: () => void; // refresh project home summary
  refreshTick?: number;
};

export function DocsView({ category, projectTitle, onHome, onChange, refreshTick }: Props) {
  const dir = category.dir;
  const [docs, setDocs] = useState<Doc[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setDocs(await api.listDocs(dir));
    onChange();
  }, [dir, onChange]);

  useEffect(() => {
    load();
  }, [load, refreshTick]); // refetch on mount and on disk change

  const create = async () => {
    const title = prompt("文档标题");
    if (!title) return;
    const doc = await api.createDoc(dir, { title });
    await load();
    setOpenId(doc.id);
  };

  if (openId) {
    return (
      <DocPage
        dir={dir}
        id={openId}
        category={category}
        onHome={onHome}
        onBackToList={() => setOpenId(null)}
        onChanged={() => load()}
        refreshTick={refreshTick}
      />
    );
  }

  return (
    <DocList
      category={category}
      docs={docs}
      onHome={onHome}
      onOpen={setOpenId}
      onCreate={create}
    />
  );
}

function homeCrumb(onHome: () => void, title: string) {
  return { label: "", icon: <Home size={15} aria-hidden />, title, onClick: onHome };
}

// ── docs list ──────────────────────────────────────────────────────────
function DocList({
  category,
  docs,
  onHome,
  onOpen,
  onCreate,
}: {
  category: Category;
  docs: Doc[];
  onHome: () => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  useSheetChrome(
    {
      crumbs: [homeCrumb(onHome, "首页")],
      title: category.name,
      actions: (
        <button className="btn-primary" onClick={onCreate}>
          + 新建文档
        </button>
      ),
    },
    [category.dir, docs.length]
  );

  if (docs.length === 0) {
    return <div className="empty">还没有文档。点「新建文档」开始。</div>;
  }
  return (
    <ul className="doc-list">
      {docs.map((d) => (
        <li key={d.id} className="doc-row" onClick={() => onOpen(d.id)}>
          <span className="doc-title">{d.title}</span>
          <span className="doc-meta">
            {d.updated ? new Date(d.updated).toLocaleDateString() : ""}
          </span>
        </li>
      ))}
    </ul>
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

  const crumbs = [homeCrumb(onHome, "首页"), { label: category.name, icon: <Icon name={category.icon} size={14} />, onClick: onBackToList }];

  useSheetChrome(
    {
      crumbs,
      title: `${id}.md`,
      actions: editing ? (
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
      ),
    },
    [id, category.dir, editing, saving]
  );

  if (!doc) return <div className="empty">加载中…</div>;

  if (!editing) {
    return (
      <article className="doc-read">
        <Markdown>{doc.body}</Markdown>
      </article>
    );
  }

  return (
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
  );
}
