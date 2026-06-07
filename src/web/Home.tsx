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
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { api, type FileEntry, type FileListing, type FileSection, type HomepageFont, type HomepageTheme, type User } from "./api";
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
  listFiles?: (dir: string, type: FileSection) => Promise<FileListing>;
  readOnly?: boolean;
  titleOverride?: string;
  description?: string;
};

type ViewMode = "list" | "grid";
type ContentViewMode = "list" | "cards";

const FILE_VIEW_KEY = "knbox.fileView";
const CONTENT_VIEW_KEY = "knbox.contentView";
const HOMEPAGE_THEMES: Array<{ value: HomepageTheme; label: string; color: string }> = [
  { value: "theme-1", label: "青绿", color: "oklch(0.9802 0.0074 151.89)" },
  { value: "theme-2", label: "淡紫", color: "oklch(0.9822 0.0118 313.22)" },
  { value: "theme-3", label: "米白", color: "oklch(0.9856 0.0084 56.32)" },
  { value: "theme-4", label: "浅蓝", color: "oklch(0.9808 0.0091 258.34)" },
  { value: "theme-5", label: "暖粉", color: "oklch(0.9727 0.0119 17.36)" },
  { value: "theme-6", label: "中性", color: "oklch(0.9731 0 0)" },
];
const HOMEPAGE_FONTS: Array<{ value: HomepageFont; label: string; stack: string }> = [
  { value: "songti", label: "宋体", stack: `"Songti SC","Noto Serif SC","SimSun",Georgia,serif` },
  { value: "georgia", label: "Georgia", stack: `Georgia,"Songti SC","Noto Serif SC",serif` },
  { value: "palatino", label: "旧体", stack: `"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua","Songti SC",serif` },
  { value: "kai", label: "楷体", stack: `Georgia,"Kaiti SC","STKaiti",KaiTi,"Songti SC",serif` },
];
const SECTION_META: Record<FileSection, { title: string; empty: string }> = {
  all: { title: "文件夹", empty: "这里还没有任何内容。" },
  web: { title: "网页", empty: "还没有网页。" },
  markdown: { title: "文档", empty: "还没有 Markdown 文档。" },
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

function readStoredContentView(): ContentViewMode {
  try {
    const value = window.localStorage.getItem(CONTENT_VIEW_KEY);
    if (value === "list" || value === "cards") return value;
  } catch {
    /* ignore unavailable localStorage */
  }
  return "cards";
}

export function ContentHome({
  user,
  query,
  refreshKey,
  onPreviewOpen,
}: {
  user: User;
  query: string;
  refreshKey: number;
  onPreviewOpen?: () => void;
}) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [preview, setPreview] = useState<FileEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [visibilityBusyPath, setVisibilityBusyPath] = useState<string | null>(null);
  const [contentView, setContentView] = useState<ContentViewMode>(() => readStoredContentView());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsName, setSettingsName] = useState(user.name || user.username);
  const [settingsDescription, setSettingsDescription] = useState("");
  const [settingsTheme, setSettingsTheme] = useState<HomepageTheme>("theme-6");
  const [settingsFont, setSettingsFont] = useState<HomepageFont>("songti");
  const [settingsShowHomeLink, setSettingsShowHomeLink] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    api
      .listContent(200)
      .then((res) => {
        if (!canceled) setEntries(res.items);
      })
      .catch((err: unknown) => {
        if (!canceled) setError(err instanceof Error ? err.message : "内容列表加载失败");
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    let canceled = false;
    api
      .homepageSettings()
      .then((res) => {
        if (canceled) return;
        setSettingsName(res.settings.displayName);
        setSettingsDescription(res.settings.description);
        setSettingsTheme(res.settings.style);
        setSettingsFont(res.settings.titleFont);
        setSettingsShowHomeLink(res.settings.showHomeLink);
      })
      .catch((err: unknown) => {
        if (!canceled) setSettingsError(err instanceof Error ? err.message : "主页设置加载失败");
      });
    return () => {
      canceled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? entries.filter((item) => `${item.name} ${item.webTitle || ""} ${item.path}`.toLowerCase().includes(q))
      : entries;
  }, [entries, query]);

  const grouped = useMemo(() => groupContentByDate(filtered), [filtered]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CONTENT_VIEW_KEY, contentView);
    } catch {
      /* ignore unavailable localStorage */
    }
  }, [contentView]);

  const openEntry = (entry: FileEntry) => {
    onPreviewOpen?.();
    setPreview(entry);
  };

  const setEntryVisibility = async (entry: FileEntry, visibility: "public" | "private") => {
    setVisibilityBusyPath(entry.path);
    setError(null);
    try {
      const result = await api.setVisibility(entry.path, visibility);
      setEntries((current) => current.map((item) => (item.path === result.item.path ? result.item : item)));
      setPreview((current) => (current?.path === result.item.path ? result.item : current));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "发布状态更新失败");
    } finally {
      setVisibilityBusyPath(null);
    }
  };

  const saveHomepageSettings = async () => {
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsMessage(null);
    try {
      const result = await api.updateHomepageSettings({
        displayName: settingsName,
        description: settingsDescription,
        style: settingsTheme,
        titleFont: settingsFont,
        showHomeLink: settingsShowHomeLink,
      });
      setSettingsName(result.settings.displayName);
      setSettingsDescription(result.settings.description);
      setSettingsTheme(result.settings.style);
      setSettingsFont(result.settings.titleFont);
      setSettingsShowHomeLink(result.settings.showHomeLink);
      setSettingsOpen(false);
    } catch (err: unknown) {
      setSettingsError(err instanceof Error ? err.message : "主页设置保存失败");
    } finally {
      setSettingsSaving(false);
    }
  };

  const saveHomepageTheme = async (theme: HomepageTheme) => {
    setSettingsTheme(theme);
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsMessage(null);
    try {
      const result = await api.updateHomepageSettings({
        displayName: settingsName,
        description: settingsDescription,
        style: theme,
        titleFont: settingsFont,
        showHomeLink: settingsShowHomeLink,
      });
      setSettingsName(result.settings.displayName);
      setSettingsDescription(result.settings.description);
      setSettingsTheme(result.settings.style);
      setSettingsFont(result.settings.titleFont);
      setSettingsShowHomeLink(result.settings.showHomeLink);
      setSettingsMessage("主题已保存");
    } catch (err: unknown) {
      setSettingsError(err instanceof Error ? err.message : "主题保存失败");
    } finally {
      setSettingsSaving(false);
    }
  };

  return (
    <div className={`fm-shell ${preview ? "has-preview" : ""}`}>
      <section className="fm content-home">
        <div className="fm-head">
          <div className="fm-head-main">
            <h1 className="fm-title">全部内容</h1>
            <p className="fm-desc">按最近更新排列的文档和网页。</p>
          </div>
          <div className="content-home-actions">
            <a className="content-home-link" href={`/u/${encodeURIComponent(user.username)}`} target="_blank" rel="noreferrer">
              个人主页
            </a>
            <button className="content-home-settings" type="button" title="主页设置" aria-label="主页设置" onClick={() => setSettingsOpen(true)}>
              <Settings size={16} aria-hidden />
            </button>
          </div>
        </div>

        <div className="fm-toolbar">
          <span className="fm-count">{filtered.length} 篇内容</span>
          <div className="fm-view content-view-toggle" aria-label="显示方式">
            <button
              className={`fm-view-btn ${contentView === "cards" ? "is-active" : ""}`}
              onClick={() => setContentView("cards")}
              title="卡片模式"
            >
              <LayoutGrid size={16} aria-hidden />
            </button>
            <button
              className={`fm-view-btn ${contentView === "list" ? "is-active" : ""}`}
              onClick={() => setContentView("list")}
              title="列表模式"
            >
              <List size={16} aria-hidden />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="fm-empty">
            <File size={28} aria-hidden />
            <p>正在加载内容...</p>
          </div>
        ) : error ? (
          <div className="fm-empty">
            <File size={28} aria-hidden />
            <p>{error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className={`fm-empty ${!query.trim() ? "has-guide" : ""}`}>
            <FileText size={28} aria-hidden />
            <p>{query.trim() ? `没有匹配「${query.trim()}」的内容。` : "这里还没有发布内容。"}</p>
            {!query.trim() && <EmptyGuide />}
          </div>
        ) : (
          <div className={`content-sections is-${contentView}`}>
            {grouped.map((group) => (
              <section className="content-section" key={group.key}>
                <SectionDivider label={group.label} />
                <div className={contentView === "cards" ? "content-card-grid" : "content-list"}>
                  {group.items.map((entry) => contentView === "cards" ? (
                    <ContentCard
                      key={entry.path}
                      entry={entry}
                      busy={visibilityBusyPath === entry.path}
                      onOpen={() => openEntry(entry)}
                      onVisibilityChange={(visibility) => void setEntryVisibility(entry, visibility)}
                    />
                  ) : (
                    <ContentEntry
                      key={entry.path}
                      entry={entry}
                      busy={visibilityBusyPath === entry.path}
                      onOpen={() => openEntry(entry)}
                      onVisibilityChange={(visibility) => void setEntryVisibility(entry, visibility)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      {preview && <PreviewPanel entry={preview} onClose={() => setPreview(null)} />}
      {settingsOpen && (
        <div className="fm-dialog-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <form
            className="fm-dialog homepage-settings-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void saveHomepageSettings();
            }}
          >
            <h2>主页设置</h2>
            <label className="fm-dialog-field">
              <span>主页名称</span>
              <input value={settingsName} maxLength={80} onChange={(event) => setSettingsName(event.target.value)} />
            </label>
            <label className="fm-dialog-field">
              <span>简介（选填，留空则不显示）</span>
              <textarea
                className="homepage-description-input"
                value={settingsDescription}
                maxLength={280}
                rows={3}
                placeholder="一句话介绍你自己，或这个主页分享的是什么。"
                onChange={(event) => setSettingsDescription(event.target.value)}
              />
            </label>
            <div className="fm-dialog-field">
              <span>标题字体</span>
              <div className="homepage-font-grid">
                {HOMEPAGE_FONTS.map((font) => (
                  <button
                    key={font.value}
                    className={`homepage-font-choice ${settingsFont === font.value ? "is-active" : ""}`}
                    type="button"
                    disabled={settingsSaving}
                    onClick={() => setSettingsFont(font.value)}
                  >
                    <span className="homepage-font-sample" style={{ fontFamily: font.stack }} aria-hidden>
                      永 Aa
                    </span>
                    <span className="homepage-font-label">{font.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="fm-dialog-field">
              <span>主题</span>
              <div className="homepage-theme-grid">
                {HOMEPAGE_THEMES.map((theme) => (
                  <button
                    key={theme.value}
                    className={`homepage-theme-choice ${settingsTheme === theme.value ? "is-active" : ""}`}
                    type="button"
                    disabled={settingsSaving}
                    onClick={() => void saveHomepageTheme(theme.value)}
                  >
                    <span className="homepage-theme-swatch" style={{ backgroundColor: theme.color }} aria-hidden />
                    <span>{theme.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <label className="homepage-toggle">
              <input
                type="checkbox"
                checked={settingsShowHomeLink}
                disabled={settingsSaving}
                onChange={(event) => setSettingsShowHomeLink(event.target.checked)}
              />
              <span>
                <strong>显示文章左下角的首页链接</strong>
                <em>公开 Markdown 和网页会显示头像与 Home，点击回到个人主页。</em>
              </span>
            </label>
            {settingsError && <div className="fm-dialog-error">{settingsError}</div>}
            {settingsMessage && <div className="fm-dialog-message">{settingsMessage}</div>}
            <div className="fm-dialog-actions">
              <button type="button" onClick={() => setSettingsOpen(false)} disabled={settingsSaving}>
                取消
              </button>
              <button className="is-primary" type="submit" disabled={settingsSaving}>
                {settingsSaving ? "保存中" : "保存"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function Home({
  section,
  dir,
  onDirChange,
  query,
  refreshKey,
  previewPath,
  onPreviewConsumed,
  onFilesChanged,
  onPreviewOpen,
  listFiles = api.listFiles,
  readOnly = false,
  titleOverride,
  description,
}: Props) {
  const [view, setView] = useState<ViewMode>(() => readStoredView());
  const [listing, setListing] = useState<FileListing | null>(null);
  const [checkedPaths, setCheckedPaths] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<FileEntry | null>(null);
  const [pendingPreviewPath, setPendingPreviewPath] = useState<string | null>(null);
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
    setCheckedPaths(new Set());
    setPreview(null);
    setPendingPreviewPath(null);
  }, [section, dir]);

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
    listFiles(dir, section)
      .then((res) => {
        if (!canceled) setListing(res);
      })
      .catch((err: unknown) => {
        if (!canceled) setError(err instanceof Error ? err.message : "文件列表加载失败");
      });
    return () => {
      canceled = true;
    };
  }, [dir, section, refreshKey, localRefreshKey, listFiles]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPendingPreviewPath(null);
        setPreview(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const entries = useMemo(() => {
    const items = listing?.items ?? [];
    const q = query.trim().toLowerCase();
    return q
      ? items.filter((item) => `${item.name} ${item.webTitle || ""} ${item.path}`.toLowerCase().includes(q))
      : items;
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
  const pageTitle = currentDirParts.length ? currentDirParts[currentDirParts.length - 1] : titleOverride || meta.title;

  const enterDirectory = (path: string) => {
    onDirChange(path);
    setPendingPreviewPath(null);
    setPreview(null);
  };

  const openEntry = (entry: FileEntry) => {
    if (entry.kind === "directory") {
      enterDirectory(entry.path);
      return;
    }
    onPreviewOpen?.();
    setPreview(entry);
  };

  const closePreview = () => {
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
          {!readOnly && <div className="fm-new-folder">
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
          </div>}
        </div>
        {description && <p className="fm-desc">{description}</p>}

        <div className="fm-toolbar">
          {currentDir && (
            <button className="fm-action" onClick={() => enterDirectory(parent ?? "")}>
              <ArrowLeft size={15} aria-hidden />
              返回上级
            </button>
          )}
          <span className="fm-count">{entries.length} 个项目</span>
          {!readOnly && checkedCount > 0 && (
            <button className="fm-delete-action" onClick={deleteChecked}>
              <Trash2 size={15} aria-hidden />
              {checkedCount === 1 ? "删除" : `删除 ${checkedCount} 个项目`}
            </button>
          )}
          {section !== "web" && section !== "markdown" && <div className="fm-view">
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
          </div>}
        </div>

        {error ? (
          <div className="fm-empty">
            <File size={28} aria-hidden />
            <p>{error}</p>
          </div>
        ) : entries.length === 0 ? (
          <div className={`fm-empty ${!readOnly && section === "all" && !currentDir && !query.trim() ? "has-guide" : ""}`}>
            <Folder size={28} aria-hidden />
            <p>{query.trim() ? `没有匹配「${query.trim()}」的项目。` : meta.empty}</p>
            {!readOnly && section === "all" && !currentDir && !query.trim() && <EmptyGuide />}
          </div>
        ) : section === "markdown" ? (
          <div className="fm-doc-list">
            {entries.map((entry) => (
              <DocumentEntry
                key={entry.path}
                entry={entry}
                checked={!readOnly && checkedPaths.has(entry.path)}
                selectable={!readOnly}
                onToggleChecked={() => toggleChecked(entry)}
                onOpen={() => openEntry(entry)}
              />
            ))}
          </div>
        ) : section === "web" ? (
          <div className="fm-web-grid">
            {entries.map((entry) => (
              <WebEntryCard
                key={entry.path}
                entry={entry}
                checked={!readOnly && checkedPaths.has(entry.path)}
                selectable={!readOnly}
                onToggleChecked={() => toggleChecked(entry)}
                onOpen={() => openEntry(entry)}
              />
            ))}
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
                checked={!readOnly && checkedPaths.has(entry.path)}
                selectable={!readOnly}
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
                checked={!readOnly && checkedPaths.has(entry.path)}
                selectable={!readOnly}
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
  selectable = true,
  onToggleChecked,
  onOpen,
}: {
  entry: FileEntry;
  checked: boolean;
  selectable?: boolean;
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
      {selectable && (
        <label className="fm-entry-check" onClick={(event) => event.stopPropagation()}>
          <input type="checkbox" checked={checked} onChange={onToggleChecked} aria-label={`选择 ${entry.name}`} />
        </label>
      )}
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
  selectable = true,
  onToggleChecked,
  onOpen,
}: {
  entry: FileEntry;
  checked: boolean;
  selectable?: boolean;
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
      {selectable && (
        <label className="fm-entry-check" onClick={(event) => event.stopPropagation()}>
          <input type="checkbox" checked={checked} onChange={onToggleChecked} aria-label={`选择 ${entry.name}`} />
        </label>
      )}
      <EntryIcon entry={entry} size={34} />
      <span className="fm-card-name" title={entry.name}>
        {entry.name}
      </span>
      <span className="fm-card-sub">{kindLabel(entry)}</span>
    </div>
  );
}

function DocumentEntry({
  entry,
  checked,
  selectable = true,
  onToggleChecked,
  onOpen,
}: {
  entry: FileEntry;
  checked: boolean;
  selectable?: boolean;
  onToggleChecked: () => void;
  onOpen: () => void;
}) {
  return (
    <article
      className={`fm-doc-item ${checked ? "is-checked" : ""}`}
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
      {selectable && (
        <label className="fm-entry-check" onClick={(event) => event.stopPropagation()}>
          <input type="checkbox" checked={checked} onChange={onToggleChecked} aria-label={`选择 ${entry.name}`} />
        </label>
      )}
      <EntryIcon entry={entry} size={22} compact />
      <div className="fm-doc-main">
        <h2>{entry.name}</h2>
        <p>/{entry.path}</p>
      </div>
      <div className="fm-doc-meta">
        <span>{kindLabel(entry)}</span>
        <span>{entry.kind === "directory" ? "" : fmtBytes(entry.size ?? 0)}</span>
        <span>{fmtDate(entry.updatedAt)}</span>
      </div>
    </article>
  );
}

function WebEntryCard({
  entry,
  checked,
  selectable = true,
  onToggleChecked,
  onOpen,
}: {
  entry: FileEntry;
  checked: boolean;
  selectable?: boolean;
  onToggleChecked: () => void;
  onOpen: () => void;
}) {
  const thumbUrl = entry.thumbnailStatus === "ready" && entry.thumbnailUrl ? absoluteUrl(entry.thumbnailUrl) : "";
  const hostLabel = entry.url ? new URL(absoluteUrl(entry.url) || "http://localhost").pathname : `/${entry.path}`;
  const title = entry.webTitle || entry.name;
  return (
    <article
      className={`fm-web-card ${checked ? "is-checked" : ""}`}
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
      {selectable && (
        <label className="fm-entry-check" onClick={(event) => event.stopPropagation()}>
          <input type="checkbox" checked={checked} onChange={onToggleChecked} aria-label={`选择 ${title}`} />
        </label>
      )}
      <div className="fm-browser">
        <div className="fm-browser-bar">
          <span />
          <span />
          <span />
          <em>{hostLabel}</em>
        </div>
        <div className="fm-browser-shot">
          {entry.kind === "directory" ? (
            <div className="fm-browser-placeholder">
              <FolderOpen size={32} aria-hidden />
              <span>网页目录</span>
            </div>
          ) : thumbUrl ? (
            <img src={thumbUrl} alt="" loading="lazy" />
          ) : (
            <div className="fm-browser-placeholder">
              <Globe size={32} aria-hidden />
              <span>{entry.thumbnailStatus === "pending" ? "缩略图生成中" : "暂无缩略图"}</span>
            </div>
          )}
        </div>
      </div>
      <div className="fm-web-info">
        <h2 title={title}>{title}</h2>
        <p>/{entry.path}</p>
      </div>
    </article>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="content-section-divider">
      <span>{label}</span>
    </div>
  );
}

function ContentCard({
  entry,
  busy,
  onOpen,
  onVisibilityChange,
}: {
  entry: FileEntry;
  busy: boolean;
  onOpen: () => void;
  onVisibilityChange: (visibility: "public" | "private") => void;
}) {
  const thumbUrl = entry.thumbnailStatus === "ready" && entry.thumbnailUrl ? absoluteUrl(entry.thumbnailUrl) : "";
  const title = entry.webTitle || entry.name;
  const visibility = entry.visibility === "public" ? "public" : "private";
  return (
    <article
      className={`content-card is-${entry.kind}`}
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
      <div className="content-card-shot" aria-hidden>
        {thumbUrl ? (
          <img src={thumbUrl} alt="" loading="lazy" />
        ) : (
          <div className="content-card-placeholder">
            <EntryIcon entry={entry} size={34} />
            <span>{entry.thumbnailStatus === "pending" ? "缩略图生成中" : kindLabel(entry)}</span>
          </div>
        )}
      </div>
      <div className="content-card-body">
        <div className="content-title-row">
          <h2 title={title}>{title}</h2>
          <span className={`content-kind is-${entry.kind}`}>{kindLabel(entry)}</span>
        </div>
        <p>/{entry.path}</p>
        <div className="content-card-foot">
          <span className={`content-visibility is-${visibility}`}>{visibility === "public" ? "已发布" : "私密"}</span>
          <span>{fmtDate(entry.updatedAt)}</span>
          <span>{fmtBytes(entry.size ?? 0)}</span>
        </div>
      </div>
      <button
        className="content-publish-btn content-card-action"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onVisibilityChange(visibility === "public" ? "private" : "public");
        }}
      >
        {busy ? "更新中" : visibility === "public" ? "设为私密" : "发布"}
      </button>
    </article>
  );
}

function ContentEntry({
  entry,
  busy,
  onOpen,
  onVisibilityChange,
}: {
  entry: FileEntry;
  busy: boolean;
  onOpen: () => void;
  onVisibilityChange: (visibility: "public" | "private") => void;
}) {
  const title = entry.webTitle || entry.name;
  const visibility = entry.visibility === "public" ? "public" : "private";
  const date = monthDayParts(entry.updatedAt);
  return (
    <article
      className="content-row"
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
      {date ? (
        <time className="content-row-date" dateTime={date.iso}>
          <span className="content-row-month">{date.month}</span>
          <span className="content-row-day">{date.day}</span>
        </time>
      ) : (
        <span className="content-row-date" aria-hidden />
      )}
      <span className="content-row-title" title={title}>{title}</span>
      <span className={`content-visibility is-${visibility}`}>{visibility === "public" ? "已发布" : "私密"}</span>
      <button
        className="content-publish-btn"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          onVisibilityChange(visibility === "public" ? "private" : "public");
        }}
      >
        {busy ? "更新中" : visibility === "public" ? "设为私密" : "发布"}
      </button>
    </article>
  );
}

function groupContentByDate(items: FileEntry[]): Array<{ key: string; label: string; items: FileEntry[] }> {
  const now = new Date();
  const nowTime = now.getTime();
  const currentYear = now.getFullYear();
  const recentDays = 7;
  const monthAfterRecentDays = 37;
  const groups: Array<{ key: string; label: string; items: FileEntry[] }> = [];
  for (const item of items) {
    const date = new Date(item.updatedAt);
    const time = date.getTime();
    const ageDays = Number.isFinite(time) ? Math.max(0, Math.floor((nowTime - time) / 86400000)) : Infinity;
    let key = "older";
    let label = "更早";
    if (ageDays < recentDays) {
      key = "recent";
      label = "最近文章";
    } else if (ageDays < monthAfterRecentDays) {
      key = "week";
      label = "一周前";
    } else if (Number.isFinite(time) && date.getFullYear() !== currentYear) {
      key = `year-${date.getFullYear()}`;
      label = String(date.getFullYear());
    }
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, label, items: [item] });
    }
  }
  return groups;
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
  if (entry.kind === "markdown") return "文档";
  if (entry.kind === "web") return "网页";
  return "其他";
}

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthDayParts(value: string): { month: string; day: string; iso: string } | null {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  return { month: MONTH_ABBR[date.getMonth()], day: String(date.getDate()), iso: date.toISOString().slice(0, 10) };
}

function fmtDate(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}
