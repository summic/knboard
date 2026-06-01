import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  Check,
  ChevronDown,
  ChevronUp,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  XCircle,
} from "lucide-react";
import { api, uploadFile, type UploadConflictMode } from "./api";

type UploadStatus = "uploading" | "done" | "error" | "canceled" | "ignored";

export type UploadItem = {
  id: string;
  name: string;
  ext: string;
  size: number;
  loaded: number;
  status: UploadStatus;
  relativePath?: string;
  targetRelativePath?: string;
  destinationDir?: string;
  conflictMode?: UploadConflictMode;
  url?: string;
  error?: string;
  abort?: () => void;
};

export type Uploads = ReturnType<typeof useUploads>;

const UPLOAD_STATE_KEY = "knbox.uploads";
const UPLOAD_DB_NAME = "knbox-upload-resume";
const UPLOAD_DB_VERSION = 1;
const UPLOAD_STORE = "files";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  "md",
  "markdown",
  "mdx",
  "html",
  "htm",
  "css",
  "js",
  "mjs",
  "cjs",
  "json",
  "webmanifest",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "avif",
  "ico",
  "bmp",
]);

// Owns the upload queue: each picked file is uploaded individually (its own
// XHR + progress), and the panel reflects per-file + total progress.
export function useUploads() {
  const restored = readStoredUploads();
  const [items, setItems] = useState<UploadItem[]>(() => restored.items);
  const [open, setOpen] = useState(() => restored.open);
  const [collapsed, setCollapsed] = useState(() => restored.collapsed);

  useEffect(() => {
    writeStoredUploads({ items, open, collapsed });
  }, [items, open, collapsed]);

  const patch = useCallback(
    (id: string, p: Partial<UploadItem> | ((it: UploadItem) => Partial<UploadItem>)) =>
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...(typeof p === "function" ? p(x) : p) } : x))),
    []
  );

  useEffect(() => {
    const resumeItems = restored.items.filter((item) => item.status === "uploading");
    if (!resumeItems.length) return;
    let canceled = false;
    resumeItems.forEach((item) => {
      void (async () => {
        const file = await getResumeFile(item.id);
        if (canceled) return;
        if (!file) {
          patch(item.id, {
            status: "error",
            loaded: 0,
            error: "页面刷新中断了上传，且浏览器没有保留原始文件。请重新选择后上传。",
            abort: undefined,
          });
          return;
        }
        const { promise, abort } = uploadFile(
          file,
          item.relativePath || item.name,
          { targetRelativePath: item.targetRelativePath, conflictMode: item.conflictMode },
          (loaded, total) => patch(item.id, { loaded, size: total || file.size })
        );
        patch(item.id, { abort, loaded: 0, size: file.size, error: undefined });
        promise
          .then((res) => {
            void deleteResumeFile(item.id);
            patch(item.id, (x) => ({ status: "done", loaded: x.size, url: res.url, abort: undefined }));
          })
          .catch((err: unknown) => {
            if (err instanceof DOMException && err.name === "AbortError") return;
            void deleteResumeFile(item.id);
            patch(item.id, { status: "error", error: err instanceof Error ? err.message : "上传失败", abort: undefined });
          });
      })();
    });
    return () => {
      canceled = true;
    };
  }, [patch]);

  const start = useCallback(
    (files: File[], baseDir = "") => {
      const list = files.filter(Boolean);
      if (!list.length) return;
      const destinationDir = normalizeUploadDir(baseDir);
      setOpen(true);
      setCollapsed(false);
      const picked = list.map((f, i) => {
        const relativePath = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        const uploadPath = joinUploadPath(baseDir, relativePath);
        const ignored = isIgnoredFolderEntry(f, relativePath);
        const error = ignored ? "已忽略" : validateUploadFile(f, uploadPath);
        const status: UploadStatus | undefined = ignored ? "ignored" : error ? "error" : undefined;
        return { file: f, relativePath: uploadPath, destinationDir, error, status, id: `${Date.now()}-${i}-${uploadPath}` };
      });
      const created: UploadItem[] = picked.map(({ file, relativePath, destinationDir, error, status, id }) => ({
        id,
        name: relativePath || file.name,
        ext: fileExt(relativePath || file.name).toUpperCase().slice(0, 5),
        size: file.size,
        loaded: 0,
        status: status ?? "uploading",
        relativePath,
        destinationDir,
        error,
      }));
      const uploadable = picked.filter((p) => !p.error && !p.status);
      setItems((prev) => [...prev, ...created]);
      if (!uploadable.length) return;

      void (async () => {
        await Promise.all(uploadable.map((p) => saveResumeFile(p.id, p.file)));
        let conflictMode: UploadConflictMode = "error";
        let renamedPaths: Record<string, string> = {};
        try {
          const result = await api.resolveUploadConflicts(
            uploadable.map((p) => p.relativePath),
            baseDir,
            uploadable.reduce((sum, p) => sum + p.file.size, 0)
          );
          if (result.conflicts.length) {
            const overwrite = window.confirm(
              `发现 ${result.conflicts.length} 个同名目录或文件。\n\n点击“确定”覆盖现有内容。\n点击“取消”重命名本次上传。`
            );
            conflictMode = overwrite ? "overwrite" : "rename";
            renamedPaths = result.renamedPaths;
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "上传前检查失败";
          uploadable.forEach((p) => {
            void deleteResumeFile(p.id);
            patch(p.id, { status: "error", error: message, abort: undefined });
          });
          return;
        }

        uploadable.forEach(({ file, relativePath, id }) => {
          const targetRelativePath = conflictMode === "rename" ? renamedPaths[relativePath] : undefined;
          patch(id, { targetRelativePath, conflictMode });
          void (async () => {
            const { promise, abort } = uploadFile(
              file,
              relativePath,
              { targetRelativePath, conflictMode },
              (loaded, total) => patch(id, { loaded, size: total || file.size })
            );
            patch(id, { abort });
            promise
              .then((res) => {
                void deleteResumeFile(id);
                patch(id, (x) => ({ status: "done", loaded: x.size, url: res.url, abort: undefined }));
              })
              .catch((err: unknown) => {
                if (err instanceof DOMException && err.name === "AbortError") return;
                void deleteResumeFile(id);
                patch(id, { status: "error", error: err instanceof Error ? err.message : "上传失败", abort: undefined });
              });
          })();
        });
      })();
    },
    [patch]
  );

  const cancel = useCallback(
    (id: string) =>
      setItems((prev) =>
        prev.map((x) => {
          if (x.id === id && x.status === "uploading") {
            x.abort?.();
            void deleteResumeFile(id);
            return { ...x, status: "canceled", abort: undefined };
          }
          return x;
        })
      ),
    []
  );

  const cancelAll = useCallback(
    () =>
      setItems((prev) =>
        prev.map((x) => {
          if (x.status === "uploading") {
            x.abort?.();
            void deleteResumeFile(x.id);
            return { ...x, status: "canceled", abort: undefined };
          }
          return x;
        })
      ),
    []
  );

  const close = useCallback(() => {
    items.forEach((item) => void deleteResumeFile(item.id));
    setOpen(false);
    setItems([]);
  }, [items]);

  return { items, open, collapsed, setCollapsed, start, cancel, cancelAll, close };
}

function readStoredUploads(): { items: UploadItem[]; open: boolean; collapsed: boolean } {
  try {
    const value = JSON.parse(window.localStorage.getItem(UPLOAD_STATE_KEY) || "{}");
    const items: UploadItem[] = Array.isArray(value.items)
      ? value.items
          .map((item: unknown) => sanitizeStoredUploadItem(item))
          .filter((item: UploadItem | null): item is UploadItem => Boolean(item))
      : [];
    return {
      items,
      open: Boolean(value.open && items.length),
      collapsed: Boolean(value.collapsed),
    };
  } catch {
    return { items: [], open: false, collapsed: false };
  }
}

function sanitizeStoredUploadItem(item: any): UploadItem | null {
  if (!item || typeof item.id !== "string" || typeof item.name !== "string") return null;
  const status: UploadStatus = item.status;
  if (!["uploading", "done", "error", "canceled", "ignored"].includes(status)) return null;
  return {
    id: item.id,
    name: item.name,
    ext: typeof item.ext === "string" ? item.ext : "",
    size: Number(item.size) || 0,
    loaded: status === "uploading" ? 0 : Number(item.loaded) || 0,
    status,
    relativePath: typeof item.relativePath === "string" ? item.relativePath : undefined,
    targetRelativePath: typeof item.targetRelativePath === "string" ? item.targetRelativePath : undefined,
    destinationDir: typeof item.destinationDir === "string" ? item.destinationDir : undefined,
    conflictMode:
      item.conflictMode === "rename" || item.conflictMode === "overwrite" || item.conflictMode === "error"
        ? item.conflictMode
        : undefined,
    url: typeof item.url === "string" ? item.url : undefined,
    error: typeof item.error === "string" && status !== "uploading" ? item.error : undefined,
  };
}

function writeStoredUploads({
  items,
  open,
  collapsed,
}: {
  items: UploadItem[];
  open: boolean;
  collapsed: boolean;
}) {
  try {
    if (!items.length && !open) {
      window.localStorage.removeItem(UPLOAD_STATE_KEY);
      return;
    }
    const serializable = items.map(({ abort, ...item }) => item);
    window.localStorage.setItem(UPLOAD_STATE_KEY, JSON.stringify({ items: serializable, open, collapsed }));
  } catch {
    /* ignore unavailable localStorage */
  }
}

function openUploadDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = window.indexedDB.open(UPLOAD_DB_NAME, UPLOAD_DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(UPLOAD_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
}

async function saveResumeFile(id: string, file: File): Promise<void> {
  try {
    const db = await openUploadDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(UPLOAD_STORE, "readwrite");
      tx.objectStore(UPLOAD_STORE).put(file, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
    });
    db.close();
  } catch {
    /* Upload can continue; this only disables refresh recovery for this file. */
  }
}

async function getResumeFile(id: string): Promise<File | null> {
  try {
    const db = await openUploadDb();
    const file = await new Promise<File | null>((resolve, reject) => {
      const tx = db.transaction(UPLOAD_STORE, "readonly");
      const request = tx.objectStore(UPLOAD_STORE).get(id);
      request.onsuccess = () => resolve(request.result instanceof File ? request.result : null);
      request.onerror = () => reject(request.error || new Error("IndexedDB read failed"));
    });
    db.close();
    return file;
  } catch {
    return null;
  }
}

async function deleteResumeFile(id: string): Promise<void> {
  try {
    const db = await openUploadDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(UPLOAD_STORE, "readwrite");
      tx.objectStore(UPLOAD_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"));
    });
    db.close();
  } catch {
    /* ignore cleanup failure */
  }
}

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function fileExt(path: string): string {
  const name = path.split(/[\\/]/).pop() || "";
  const index = name.lastIndexOf(".");
  return index > -1 ? name.slice(index + 1).toLowerCase() : "";
}

function joinUploadPath(baseDir: string, relativePath: string): string {
  const parts = `${normalizeUploadDir(baseDir)}/${relativePath || ""}`
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..");
  return parts.join("/");
}

function normalizeUploadDir(dir: string): string {
  return String(dir || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function parentDir(path: string): string {
  const parts = normalizeUploadDir(path).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function itemDestinationDir(item: UploadItem): string {
  return item.destinationDir ?? parentDir(item.targetRelativePath || item.relativePath || item.name);
}

function formatUploadPath(dir: string): string {
  return dir ? `/${dir}` : "/";
}

function validateUploadFile(file: File, path: string): string | undefined {
  if (file.size > MAX_UPLOAD_BYTES) return "单文件不能超过 10MB";
  if (!ALLOWED_EXTENSIONS.has(fileExt(path))) return "仅支持 Markdown、网页文件和图片";
  return undefined;
}

function isIgnoredFolderEntry(file: File, path: string): boolean {
  const webkitRelativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (!webkitRelativePath || webkitRelativePath === file.name) return false;
  return path.split(/[\\/]/).some((part) => part === ".DS_Store" || part.startsWith("."));
}

const FILTERS = [
  ["all", "所有上传项"],
  ["done", "已完成"],
  ["canceled", "已跳过"],
  ["error", "失败"],
] as const;
type FilterKey = (typeof FILTERS)[number][0];

export function UploadManager({
  uploads,
  onAddFiles,
  onAddFolder,
}: {
  uploads: Uploads;
  onAddFiles: () => void;
  onAddFolder: () => void;
}) {
  const { items, open, collapsed, setCollapsed, cancel, cancelAll, close } = uploads;
  const [filter, setFilter] = useState<FilterKey>("all");

  const uploading = items.filter((i) => i.status === "uploading");
  const isUploading = uploading.length > 0;
  const doneCount = items.filter((i) => i.status === "done").length;
  const errorCount = items.filter((i) => i.status === "error").length;
  const canceledCount = items.filter((i) => i.status === "canceled").length;
  const ignoredCount = items.filter((i) => i.status === "ignored").length;
  const hasErrors = errorCount > 0;
  const hasWarnings = canceledCount + ignoredCount > 0;

  if (!open) return null;
  const progressItems = items.filter((i) => i.status === "uploading" || i.status === "done");
  const totalBytes = progressItems.reduce((s, i) => s + i.size, 0);
  const loadedBytes = progressItems.reduce((s, i) => s + i.loaded, 0);
  const totalPct = totalBytes ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 0;

  const filtered = items.filter((i) =>
    filter === "all"
      ? true
      : filter === "done"
        ? i.status === "done"
        : filter === "canceled"
          ? i.status === "canceled" || i.status === "ignored"
          : i.status === "error"
  );

  return (
    <div className={`up-panel ${collapsed ? "is-collapsed" : ""}`} role="dialog" aria-label="上传项目">
      <header className="up-head">
        <span className="up-title">上传项目</span>
        <div className="up-head-actions">
          {isUploading && (
            <button className="up-cancelall" onClick={cancelAll}>
              全部取消
            </button>
          )}
          <button className="up-iconbtn" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "展开" : "收起"}>
            {collapsed ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
          </button>
          {!isUploading && (
            <button className="up-iconbtn" onClick={close} aria-label="关闭">
              <X size={18} aria-hidden />
            </button>
          )}
        </div>
      </header>

      <div className="up-body-shell" aria-hidden={collapsed}>
        <div className="up-body">
          <div className="up-filters">
            {FILTERS.map(([k, label]) => (
              <button key={k} className={`up-chip ${filter === k ? "is-active" : ""}`} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
          <ul className="up-list">
            {filtered.map((item) => (
              <UploadRow key={item.id} item={item} onCancel={() => cancel(item.id)} />
            ))}
            {!filtered.length && <li className="up-list-empty">没有项目</li>}
          </ul>
        </div>
      </div>

      <footer className={`up-foot ${isUploading ? "is-uploading" : hasErrors ? "is-issue" : hasWarnings ? "is-warning" : "is-done"}`}>
        <span className="up-foot-icon" aria-hidden>
          {isUploading ? (
            <Upload size={20} />
          ) : hasErrors || hasWarnings ? (
            <AlertCircle size={22} strokeWidth={2.5} />
          ) : (
            <Check size={22} className="up-foot-check" strokeWidth={3} />
          )}
        </span>
        <div className="up-foot-main">
          {isUploading ? (
            <>
              <div className="up-foot-text">
                正在上传 {uploading.length} 项，共 {items.length} 项
              </div>
              <div className="up-foot-progress">
                <div className="up-foot-bar" style={{ width: `${totalPct}%` }} />
              </div>
            </>
          ) : hasErrors || hasWarnings ? (
            <>
              <div className="up-foot-text up-foot-success">
                {errorCount ? "部分上传失败" : ignoredCount ? "已跳过部分文件" : "上传已取消"}
              </div>
              <div className="up-foot-sub">
                已上传 {doneCount} 个，失败 {errorCount} 个，已忽略 {ignoredCount} 个，取消 {canceledCount} 个
              </div>
            </>
          ) : (
            <>
              <div className="up-foot-text up-foot-success">上传成功！</div>
              <div className="up-foot-sub">
                已上传 {doneCount} 个文件（共 {items.length} 个文件）
              </div>
            </>
          )}
        </div>
        <AddButton onFiles={onAddFiles} onFolder={onAddFolder} />
      </footer>
    </div>
  );
}

function UploadRow({ item, onCancel }: { item: UploadItem; onCancel: () => void }) {
  const pct = item.size ? Math.min(100, Math.round((item.loaded / item.size) * 100)) : 0;
  const destination = formatUploadPath(itemDestinationDir(item));
  const copy = () => {
    if (item.url) navigator.clipboard?.writeText(window.location.origin + item.url);
  };
  return (
    <li className="up-item">
      <span className={`up-item-status up-status-${item.status}`} aria-hidden>
        {item.status === "uploading" ? (
          <Loader2 size={18} className="up-spin" />
        ) : item.status === "done" ? (
          <CheckCircle2 size={18} />
        ) : item.status === "error" ? (
          <AlertCircle size={18} />
        ) : (
          <XCircle size={18} />
        )}
      </span>
      <div className="up-item-main">
        <div className="up-item-name">{item.name}</div>
        {item.status === "uploading" ? (
          <>
            <div className="up-item-sub">
              {item.ext && <span className="up-ext">{item.ext}</span>}
              <span>
                正在上传 {fmtBytes(item.loaded)} / {fmtBytes(item.size)}
              </span>
            </div>
            <div className="up-item-progress">
              <div className="up-item-bar" style={{ width: `${pct}%` }} />
            </div>
          </>
        ) : (
          <div className="up-item-sub">
            {item.ext && <span className="up-ext">{item.ext}</span>}
            <span>
              {item.status === "done" ? (
                <>
                  已上传至 <span className="up-dest-name">{destination}</span>
                </>
              ) : item.status === "ignored" ? (
                "已忽略"
              ) : item.status === "canceled" ? (
                "已取消"
              ) : (
                item.error || "上传失败"
              )}
            </span>
          </div>
        )}
      </div>
      <div className="up-item-action">
        {item.status === "uploading" ? (
          <button className="up-rowbtn" onClick={onCancel}>
            取消
          </button>
        ) : item.status === "done" && item.url ? (
          <button className="up-rowbtn" onClick={copy}>
            复制链接
          </button>
        ) : null}
      </div>
    </li>
  );
}

function AddButton({ onFiles, onFolder }: { onFiles: () => void; onFolder: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className="up-add-wrap" ref={ref}>
      <button className="up-add" onClick={() => setOpen((o) => !o)}>
        添加 <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="up-add-menu">
          <button
            onClick={() => {
              setOpen(false);
              onFiles();
            }}
          >
            上传文件
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onFolder();
            }}
          >
            上传文件夹
          </button>
        </div>
      )}
    </div>
  );
}
