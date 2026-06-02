import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  File,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  Image,
  LayoutGrid,
  List,
  Trash2,
  X,
} from "lucide-react";
import { api, type FileEntry, type FileListing, type FileSection } from "./api";
import { absoluteUrl } from "./url";

type Props = {
  section: FileSection;
  dir: string;
  onDirChange: (dir: string) => void;
  query: string;
  refreshKey: number;
  previewPath?: string | null;
  onPreviewConsumed?: () => void;
  onFilesChanged?: () => void;
  onPreviewOpen?: () => void;
};

type ViewMode = "list" | "grid";

const FILE_VIEW_KEY = "knbox.fileView";
const FILE_STATE_KEY = "knbox.fileState";
const SECTION_META: Record<FileSection, { title: string; empty: string }> = {
  all: { title: "首页", empty: "这里还没有任何内容。" },
  web: { title: "网页", empty: "还没有网页或 Markdown 文件。" },
  images: { title: "图片", empty: "还没有图片。" },
  other: { title: "其他", empty: "还没有其他文件。" },
};

function readStoredView(): ViewMode {
  try {
    const value = window.localStorage.getItem(FILE_VIEW_KEY);
    if (value === "list" || value === "grid") return value;
  } catch {
    /* ignore unavailable localStorage */
  }
  return "grid";
}

function readStoredFileState(section: FileSection): { previewPath: string | null } {
  try {
    const value = JSON.parse(window.localStorage.getItem(FILE_STATE_KEY) || "{}");
    const state = value?.[section];
    return {
      previewPath: typeof state?.previewPath === "string" ? state.previewPath : null,
    };
  } catch {
    return { previewPath: null };
  }
}

function writeStoredFileState(section: FileSection, patch: Partial<{ previewPath: string | null }>) {
  try {
    const value = JSON.parse(window.localStorage.getItem(FILE_STATE_KEY) || "{}");
    value[section] = { ...(value[section] || {}), ...patch };
    window.localStorage.setItem(FILE_STATE_KEY, JSON.stringify(value));
  } catch {
    /* ignore unavailable localStorage */
  }
}

export function Home({ section, dir, onDirChange, query, refreshKey, previewPath, onPreviewConsumed, onFilesChanged, onPreviewOpen }: Props) {
  const [view, setView] = useState<ViewMode>(() => readStoredView());
  const [listing, setListing] = useState<FileListing | null>(null);
  const [checkedPaths, setCheckedPaths] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<FileEntry | null>(null);
  const [pendingPreviewPath, setPendingPreviewPath] = useState<string | null>(() => readStoredFileState(section).previewPath);
  const [error, setError] = useState<string | null>(null);
  const [folderPopoverOpen, setFolderPopoverOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const state = readStoredFileState(section);
    setCheckedPaths(new Set());
    setPreview(null);
    setPendingPreviewPath(state.previewPath);
  }, [section]);

  useEffect(() => {
    try {
      window.localStorage.setItem(FILE_VIEW_KEY, view);
    } catch {
      /* ignore unavailable localStorage */
    }
  }, [view]);

  useEffect(() => {
    let canceled = false;
    setError(null);
    api
      .listFiles(dir, section)
      .then((res) => {
        if (!canceled) setListing(res);
      })
      .catch((err: unknown) => {
        if (!canceled) setError(err instanceof Error ? err.message : "文件列表加载失败");
      });
    return () => {
      canceled = true;
    };
  }, [dir, section, refreshKey, localRefreshKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        writeStoredFileState(section, { previewPath: null });
        setPendingPreviewPath(null);
        setPreview(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [section]);

  const entries = useMemo(() => {
    const items = listing?.items ?? [];
    const q = query.trim().toLowerCase();
    return q ? items.filter((item) => item.name.toLowerCase().includes(q)) : items;
  }, [listing, query]);

  useEffect(() => {
    setCheckedPaths((prev) => {
      if (!prev.size) return prev;
      const available = new Set(entries.map((entry) => entry.path));
      const next = new Set([...prev].filter((path) => available.has(path)));
      return next.size === prev.size ? prev : next;
    });
  }, [entries]);

  useEffect(() => {
    if (!pendingPreviewPath) return;
    const entry = entries.find((item) => item.path === pendingPreviewPath && item.kind !== "directory");
    if (!entry) return;
    setPreview(entry);
    setPendingPreviewPath(null);
    onPreviewConsumed?.();
  }, [entries, pendingPreviewPath]);

  useEffect(() => {
    if (previewPath) setPendingPreviewPath(previewPath);
  }, [previewPath]);

  const meta = SECTION_META[section];
  const currentDir = listing?.dir ?? dir;
  const parent = listing?.parent ?? null;
  const currentDirParts = currentDir.split("/").filter(Boolean);
  const pageTitle = currentDirParts.length ? currentDirParts[currentDirParts.length - 1] : meta.title;

  const enterDirectory = (path: string) => {
    onDirChange(path);
    writeStoredFileState(section, { previewPath: null });
    setPendingPreviewPath(null);
    setPreview(null);
  };

  const openEntry = (entry: FileEntry) => {
    if (entry.kind === "directory") {
      enterDirectory(entry.path);
      return;
    }
    writeStoredFileState(section, { previewPath: entry.path });
    onPreviewOpen?.();
    setPreview(entry);
  };

  const closePreview = () => {
    writeStoredFileState(section, { previewPath: null });
    setPendingPreviewPath(null);
    setPreview(null);
  };
  const checkedCount = checkedPaths.size;
  const checkedEntries = useMemo(
    () => entries.filter((entry) => checkedPaths.has(entry.path)),
    [entries, checkedPaths]
  );
  const deleteConfirmName = checkedEntries[0]?.name ?? "";
  const deletingDirectory = checkedEntries.some((entry) => entry.kind === "directory");

  const toggleChecked = (entry: FileEntry) => {
    setCheckedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
  };

  const deleteChecked = async () => {
    if (!checkedEntries.length) return;
    setDeleteInput("");
    setDeleteError(null);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteChecked = async () => {
    if (!checkedEntries.length || deleteInput !== deleteConfirmName) return;
    const paths = checkedEntries.map((entry) => entry.path);
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await api.deleteFiles(paths, deleteConfirmName);
      setCheckedPaths(new Set());
      setPreview((current) => {
        if (!current || !paths.includes(current.path)) return current;
        writeStoredFileState(section, { previewPath: null });
        return null;
      });
      setDeleteDialogOpen(false);
      setDeleteInput("");
      setLocalRefreshKey((key) => key + 1);
      onFilesChanged?.();
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleteBusy(false);
    }
  };

  const createFolder = async () => {
    const name = folderName.trim();
    if (!name) {
      setFolderError("请输入文件夹名称");
      return;
    }
    setCreatingFolder(true);
    setFolderError(null);
    try {
      await api.createFolder(currentDir, name);
      setFolderName("");
      setFolderPopoverOpen(false);
      setLocalRefreshKey((key) => key + 1);
    } catch (err: unknown) {
      setFolderError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreatingFolder(false);
    }
  };

  return (
    <div className={`fm-shell ${preview ? "has-preview" : ""}`}>
      <section className="fm">
        <div className="fm-head">
          <div className="fm-head-main">
            <h1 className="fm-title">{pageTitle}</h1>
            <div className="fm-location">
              <Breadcrumb dir={currentDir} onRoot={() => enterDirectory("")} onJump={enterDirectory} />
            </div>
          </div>
          <div className="fm-new-folder">
            <button
              className="fm-new-folder-btn"
              title="新文件夹"
              aria-label="新文件夹"
              onClick={() => {
                setFolderPopoverOpen((open) => !open);
                setFolderError(null);
              }}
            >
              <FolderPlus size={14} aria-hidden />
              新文件夹
            </button>
            {folderPopoverOpen && (
              <form
                className="fm-folder-popover"
                autoComplete="off"
                data-1p-ignore="true"
                data-lpignore="true"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createFolder();
                }}
              >
                <input
                  autoFocus
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  name="knbox-folder-name"
                  inputMode="text"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                  placeholder="文件夹名称"
                />
                {folderError && <div className="fm-folder-error">{folderError}</div>}
                <div className="fm-folder-actions">
                  <button type="button" onClick={() => { setFolderPopoverOpen(false); setFolderName(""); setFolderError(null); }}>
                    取消
                  </button>
                  <button type="submit" disabled={creatingFolder}>
                    确定
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        <div className="fm-toolbar">
          {currentDir && (
            <button className="fm-action" onClick={() => enterDirectory(parent ?? "")}>
              <ArrowLeft size={15} aria-hidden />
              返回上级
            </button>
          )}
          <span className="fm-count">{entries.length} 个项目</span>
          {checkedCount > 0 && (
            <button className="fm-delete-action" onClick={deleteChecked}>
              <Trash2 size={15} aria-hidden />
              {checkedCount === 1 ? "删除" : `删除 ${checkedCount} 个项目`}
            </button>
          )}
          <div className="fm-view">
            <button
              className={`fm-view-btn ${view === "grid" ? "is-active" : ""}`}
              onClick={() => setView("grid")}
              title="网格视图"
            >
              <LayoutGrid size={16} aria-hidden />
            </button>
            <button
              className={`fm-view-btn ${view === "list" ? "is-active" : ""}`}
              onClick={() => setView("list")}
              title="列表视图"
            >
              <List size={16} aria-hidden />
            </button>
          </div>
        </div>

        {error ? (
          <div className="fm-empty">
            <File size={28} aria-hidden />
            <p>{error}</p>
          </div>
        ) : entries.length === 0 ? (
          <div className={`fm-empty ${section === "all" && !currentDir && !query.trim() ? "has-guide" : ""}`}>
            <Folder size={28} aria-hidden />
            <p>{query.trim() ? `没有匹配「${query.trim()}」的项目。` : meta.empty}</p>
            {section === "all" && !currentDir && !query.trim() && <EmptyGuide />}
          </div>
        ) : view === "list" ? (
          <div className="fm-list">
            <div className="fm-list-head">
              <span>名称</span>
              <span>类型</span>
              <span>大小</span>
            </div>
            {entries.map((entry) => (
              <EntryRow
                key={entry.path}
                entry={entry}
                checked={checkedPaths.has(entry.path)}
                onToggleChecked={() => toggleChecked(entry)}
                onOpen={() => openEntry(entry)}
              />
            ))}
          </div>
        ) : (
          <div className="fm-grid">
            {entries.map((entry) => (
              <EntryCard
                key={entry.path}
                entry={entry}
                checked={checkedPaths.has(entry.path)}
                onToggleChecked={() => toggleChecked(entry)}
                onOpen={() => openEntry(entry)}
              />
            ))}
          </div>
        )}
      </section>

      {preview && <PreviewPanel entry={preview} onClose={closePreview} />}
      {deleteDialogOpen && (
        <DeleteConfirmDialog
          count={checkedEntries.length}
          confirmName={deleteConfirmName}
          hasDirectory={deletingDirectory}
          value={deleteInput}
          busy={deleteBusy}
          error={deleteError}
          onChange={setDeleteInput}
          onCancel={() => {
            if (deleteBusy) return;
            setDeleteDialogOpen(false);
            setDeleteInput("");
            setDeleteError(null);
          }}
          onConfirm={confirmDeleteChecked}
        />
      )}
    </div>
  );
}

function EmptyGuide() {
  return (
    <div className="fm-empty-guide">
      <p>网页、Markdown 和图片上传后，会生成可以分享的预览链接。</p>
      <div className="fm-empty-links">
        <a href="/~help">
          <strong>使用说明</strong>
          <span>上传、预览、CLI、Token 和 AI 助手使用方式。</span>
        </a>
      </div>
    </div>
  );
}

function DeleteConfirmDialog({
  count,
  confirmName,
  hasDirectory,
  value,
  busy,
  error,
  onChange,
  onCancel,
  onConfirm,
}: {
  count: number;
  confirmName: string;
  hasDirectory: boolean;
  value: string;
  busy: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fm-dialog-backdrop" role="presentation">
      <dialog className="fm-dialog" open aria-modal="true" aria-labelledby="delete-title">
        <h2 id="delete-title">确认删除</h2>
        <p>
          将删除 {count} 个项目。删除后会移动到回收站。
        </p>
        {hasDirectory && (
          <p className="fm-dialog-warning">
            删除目录会递归删除该目录下的所有文件。
          </p>
        )}
        <label className="fm-dialog-field">
          <span>请输入 <strong>{confirmName}</strong> 确认删除</span>
          <input
            autoFocus
            value={value}
            disabled={busy}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancel();
              if (event.key === "Enter" && value === confirmName) onConfirm();
            }}
          />
        </label>
        {error && <div className="fm-dialog-error">{error}</div>}
        <div className="fm-dialog-actions">
          <button type="button" onClick={onCancel} disabled={busy}>取消</button>
          <button type="button" className="is-danger" onClick={onConfirm} disabled={busy || value !== confirmName}>
            {busy ? "删除中..." : "确认删除"}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function Breadcrumb({ dir, onRoot, onJump }: { dir: string; onRoot: () => void; onJump: (dir: string) => void }) {
  const parts = dir ? dir.split("/") : [];
  const atRoot = parts.length === 0;
  return (
    <div className="fm-crumbs" aria-label="当前位置">
      <button
        className={`fm-root-crumb ${atRoot ? "is-placeholder" : ""}`}
        onClick={onRoot}
        tabIndex={atRoot ? -1 : 0}
        aria-hidden={atRoot}
        aria-label="返回根目录"
      >
        /
      </button>
      {parts.map((part, index) => {
        const target = parts.slice(0, index + 1).join("/");
        return (
          <span key={target} className="fm-crumb-part">
            {index > 0 && <span>/</span>}
            <button onClick={() => onJump(target)}>{part}</button>
          </span>
        );
      })}
    </div>
  );
}

function EntryRow({
  entry,
  checked,
  onToggleChecked,
  onOpen,
}: {
  entry: FileEntry;
  checked: boolean;
  onToggleChecked: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className={`fm-row ${checked ? "is-checked" : ""}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <label className="fm-entry-check" onClick={(event) => event.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={onToggleChecked} aria-label={`选择 ${entry.name}`} />
      </label>
      <span className="fm-row-name">
        <EntryIcon entry={entry} size={18} compact />
        <span className="fm-row-title">{entry.name}</span>
      </span>
      <span className="fm-row-meta">{kindLabel(entry)}</span>
      <span className="fm-row-meta">{entry.kind === "directory" ? "-" : fmtBytes(entry.size ?? 0)}</span>
    </div>
  );
}

function EntryCard({
  entry,
  checked,
  onToggleChecked,
  onOpen,
}: {
  entry: FileEntry;
  checked: boolean;
  onToggleChecked: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className={`fm-card ${checked ? "is-checked" : ""}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <label className="fm-entry-check" onClick={(event) => event.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={onToggleChecked} aria-label={`选择 ${entry.name}`} />
      </label>
      <EntryIcon entry={entry} size={34} />
      <span className="fm-card-name" title={entry.name}>
        {entry.name}
      </span>
      <span className="fm-card-sub">{kindLabel(entry)}</span>
    </div>
  );
}

function EntryIcon({ entry, size, compact = false }: { entry: FileEntry; size: number; compact?: boolean }) {
  const className = compact ? `fm-ic ${iconClass(entry)}` : `fm-card-icon ${iconClass(entry)}`;
  const props = { size, "aria-hidden": true };
  const icon =
    entry.kind === "directory" ? (
      entry.fileCount ? <FolderOpen {...props} /> : <Folder {...props} />
    ) : entry.kind === "image" ? (
      <Image {...props} />
    ) : entry.kind === "markdown" ? (
      <FileText {...props} />
    ) : entry.kind === "web" ? (
      <Globe {...props} />
    ) : entry.name.endsWith(".json") || entry.name.endsWith(".js") ? (
      <FileCode2 {...props} />
    ) : (
      <File {...props} />
    );
  return <span className={className}>{icon}</span>;
}

function PreviewPanel({ entry, onClose }: { entry: FileEntry; onClose: () => void }) {
  const fullUrl = absoluteUrl(entry.url);
  const copy = () => {
    if (fullUrl) navigator.clipboard?.writeText(fullUrl);
  };

  return (
    <aside className="fm-preview" aria-label="文件预览">
      <header className="fm-preview-head">
        <div className="fm-preview-title">
          <EntryIcon entry={entry} size={18} compact />
          <span title={entry.name}>{entry.name}</span>
        </div>
        <div className="fm-preview-actions">
          <button onClick={copy}>
            <Copy size={15} aria-hidden />
            复制链接
          </button>
          <a href={fullUrl || "#"} target="_blank" rel="noreferrer">
            <ExternalLink size={15} aria-hidden />
            在新窗口打开
          </a>
          <button className="fm-preview-close" onClick={onClose} aria-label="关闭预览">
            <X size={16} aria-hidden />
          </button>
        </div>
      </header>
      <div className="fm-preview-url">
        <span>{fullUrl}</span>
        <button type="button" onClick={copy} aria-label="复制链接" title="复制链接">
          <Copy size={14} aria-hidden />
        </button>
      </div>
      <div className="fm-preview-body">
        {entry.kind === "image" ? (
          <img src={fullUrl} alt={entry.name} />
        ) : (
          <iframe title={entry.name} src={fullUrl || "about:blank"} sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox" />
        )}
      </div>
    </aside>
  );
}

function iconClass(entry: FileEntry) {
  if (entry.kind === "directory") return "is-folder";
  if (entry.kind === "image") return "is-image";
  if (entry.kind === "markdown") return "is-markdown";
  if (entry.kind === "web") return "is-web";
  return "is-other";
}

function kindLabel(entry: FileEntry) {
  if (entry.kind === "directory") return `${entry.fileCount ?? 0} 个文件`;
  if (entry.kind === "image") return "图片";
  if (entry.kind === "markdown") return "Markdown";
  if (entry.kind === "web") return "网页";
  return "其他";
}

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}
