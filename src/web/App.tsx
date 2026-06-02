import { useEffect, useRef, useState } from "react";
import {
  Box,
  Home as HomeIcon,
  Globe,
  Image,
  Files,
  Search,
  Upload,
  LogOut,
  PanelLeft,
  ChevronDown,
  Trash2,
  CircleHelp,
  File as FileIcon,
  Folder as FolderIcon,
  RotateCcw,
  Copy,
  Check,
} from "lucide-react";
import { api, AuthRequiredError, type AuthConfig, type FileEntry, type FileSection, type StorageUsage, type TrashEntry, type User } from "./api";
import { Home } from "./Home";
import { Help } from "./Help";
import { useUploads, UploadManager } from "./UploadManager";

type AppView = "files" | "trash" | "help";
type Route = { view: AppView; section: FileSection; dir: string };

const SECTIONS: Record<string, FileSection> = {
  "~web": "web",
  "~images": "images",
  "~other": "other",
};

function parsePath(pathname: string): Route {
  const raw = decodeURIComponent(pathname.replace(/^\/+/, "")).replace(/\/$/, "");
  if (!raw) return { view: "files", section: "all", dir: "" };
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "~trash") return { view: "trash", section: "all", dir: "" };
  if (parts[0] === "~help" || parts[0] === "~cli" || parts[0] === "~skills") return { view: "help", section: "all", dir: "" };
  const section = SECTIONS[parts[0]] ?? "all";
  const dirParts = section === "all" ? parts : parts.slice(1);
  return { view: "files", section, dir: normalizeRouteDir(dirParts.join("/")) };
}

const NAV_ITEMS: { id: FileSection; label: string; icon: typeof HomeIcon }[] = [
  { id: "all", label: "首页", icon: HomeIcon },
  { id: "web", label: "网页", icon: Globe },
  { id: "images", label: "图片", icon: Image },
  { id: "other", label: "其他", icon: Files },
];

const ROUTE_FOR: Record<FileSection, string> = {
  all: "",
  web: "~web",
  images: "~images",
  other: "~other",
};

function normalizeRouteDir(dir: string): string {
  return String(dir || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function routePath(section: FileSection, dir = ""): string {
  const prefix = ROUTE_FOR[section];
  const cleanDir = normalizeRouteDir(dir);
  return [prefix, cleanDir].filter(Boolean).join("/");
}

function parentDir(path: string): string {
  const parts = normalizeRouteDir(path).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function fileKindLabel(kind: FileEntry["kind"]): string {
  if (kind === "markdown") return "MD";
  if (kind === "image") return "IMG";
  if (kind === "web") return "WEB";
  return "FILE";
}

const SIDEBAR_COLLAPSED_KEY = "knbox.sidebarCollapsed";
const MOBILE_SIDEBAR_QUERY = "(max-width: 720px)";
const AGENT_SKILL_PROMPT = `帮我安装 KN Box Skills
npx skills add summic/knbox-skills`;

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    /* ignore unavailable localStorage */
  }
  return fallback;
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig>({ kylithSso: { enabled: false, issuer: null } });
  const [authChecked, setAuthChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState(() => window.location.pathname);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FileEntry[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => readStoredBoolean(SIDEBAR_COLLAPSED_KEY, false));
  const [isMobileLayout, setIsMobileLayout] = useState(() => window.matchMedia(MOBILE_SIDEBAR_QUERY).matches);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [filesRefreshKey, setFilesRefreshKey] = useState(0);
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const uploads = useUploads();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const lastUploadRefresh = useRef("");
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.authConfig()
      .then(setAuthConfig)
      .catch(() => undefined);
    api.me()
      .then(({ user }) => {
        setUser(user);
        setAuthChecked(true);
      })
      .catch((e) => {
        if (e instanceof AuthRequiredError) {
          setUser(null);
          setAuthChecked(true);
          return;
        }
        setError(e.message);
        setAuthChecked(true);
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    let canceled = false;
    api
      .storage()
      .then((usage) => {
        if (!canceled) setStorage(usage);
      })
      .catch(() => {
        if (!canceled) setStorage(null);
      });
    return () => {
      canceled = true;
    };
  }, [user, filesRefreshKey]);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_SIDEBAR_QUERY);
    const onChange = () => {
      setIsMobileLayout(media.matches);
      if (!media.matches) setMobileSidebarOpen(false);
    };
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileSidebarOpen]);

  useEffect(() => {
    const q = query.trim();
    if (!user || !q) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    let canceled = false;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      api
        .searchFiles(q, 10)
        .then((res) => {
          if (!canceled) {
            setSearchResults(res.items);
            setSearchActiveIndex(res.items.length ? 0 : -1);
          }
        })
        .catch(() => {
          if (!canceled) {
            setSearchResults([]);
            setSearchActiveIndex(-1);
          }
        })
        .finally(() => {
          if (!canceled) setSearchLoading(false);
        });
    }, 160);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [query, user, filesRefreshKey]);

  useEffect(() => {
    if (!query.trim()) setSearchActiveIndex(-1);
  }, [query]);

  useEffect(() => {
    if (!searchOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [searchOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      /* ignore unavailable localStorage */
    }
  }, [collapsed]);

  useEffect(() => {
    if (!uploads.items.length || uploads.items.some((item) => item.status === "uploading")) return;
    const signature = uploads.items.map((item) => `${item.id}:${item.status}`).join("|");
    if (signature === lastUploadRefresh.current) return;
    lastUploadRefresh.current = signature;
    if (uploads.items.some((item) => item.status === "done")) setFilesRefreshKey((key) => key + 1);
  }, [uploads.items]);

  const logout = async () => {
    await api.logout();
    setUser(null);
    window.history.pushState(null, "", "/");
    setPath(window.location.pathname);
  };

  // A folder pick needs the non-standard webkitdirectory attribute. Set it via a
  // callback ref so it's applied whenever the input mounts (not tied to a state
  // dependency that may have already fired before the input rendered).
  const setFolderRef = (el: HTMLInputElement | null) => {
    folderInput.current = el;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  };

  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    uploads.start(Array.from(e.target.files ?? []), route.view === "files" ? route.dir : "");
    e.target.value = "";
  };
  const pickFiles = () => fileInput.current?.click();
  const pickFolder = () => folderInput.current?.click();

  if (error) return <div className="kb-screen kb-screen-error">⚠️ {error}</div>;
  if (!authChecked) return <div className="kb-screen">Loading…</div>;
  if (!user) return <Login authConfig={authConfig} />;

  const route = parsePath(path);
  const nav = route.view === "files" ? route.section : route.view === "help" ? "help" : route.view;

  const go = (path: string) => {
    setMobileSidebarOpen(false);
    const encoded = path
      .split("/")
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join("/");
    const next = encoded ? `/${encoded}` : "/";
    if (window.location.pathname !== next) {
      window.history.pushState(null, "", next);
      setPath(window.location.pathname);
    }
  };
  const goHome = () => go("");
  const goSection = (s: FileSection) => go(routePath(s));
  const goTrash = () => go("~trash");
  const goHelp = () => go("~help");
  const goDir = (dir: string) => go(routePath(route.section, dir));
  const openSearchResult = (entry: FileEntry) => {
    setSearchOpen(false);
    setQuery("");
    setSearchActiveIndex(-1);
    if (entry.kind === "directory") {
      go(routePath("all", entry.path));
      return;
    }
    setPreviewPath(entry.path);
    go(routePath("all", parentDir(entry.path)));
  };
  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setSearchOpen(false);
      setSearchActiveIndex(-1);
      return;
    }
    if (!searchOpen || !searchResults.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchActiveIndex((index) => (index + 1) % searchResults.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchActiveIndex((index) => (index <= 0 ? searchResults.length - 1 : index - 1));
      return;
    }
    if (event.key === "Enter") {
      const entry = searchResults[searchActiveIndex >= 0 ? searchActiveIndex : 0];
      if (entry) {
        event.preventDefault();
        openSearchResult(entry);
      }
    }
  };

  return (
    <div className={`kb-app ${collapsed ? "is-collapsed" : ""} ${mobileSidebarOpen ? "is-mobile-sidebar-open" : ""}`}>
      <aside className="kb-sidebar" id="kb-sidebar">
        <div className="kb-sidebar-top">
          <button className="kb-brand" onClick={goHome} title="KN Box">
            <span className="kb-brand-mark">
              <Box size={32} strokeWidth={2.25} aria-hidden />
            </span>
            <span className="kb-brand-text">
              <span className="kb-brand-name">KN Box</span>
              <span className="kb-brand-sub">文档托管服务</span>
            </span>
          </button>
        </div>

        <nav className="kb-nav">
          <div className="kb-nav-group">
            <button
              className={`kb-nav-item ${nav === "all" ? "is-active" : ""}`}
              data-label="首页"
              onClick={() => goSection("all")}
            >
              <HomeIcon size={18} aria-hidden />
              <span>首页</span>
            </button>
          </div>
          <div className="kb-nav-group">
            <div className="kb-nav-section">文件类型</div>
            {NAV_ITEMS.filter((item) => item.id !== "all").map(({ id, label, icon: I }) => (
              <button
                key={id}
                className={`kb-nav-item ${nav === id ? "is-active" : ""}`}
                data-label={label}
                onClick={() => goSection(id)}
              >
                <I size={18} aria-hidden />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="kb-nav-group">
            <div className="kb-nav-section">回收站</div>
            <button
              className={`kb-nav-item ${nav === "trash" ? "is-active" : ""}`}
              data-label="回收站"
              onClick={goTrash}
            >
              <Trash2 size={18} aria-hidden />
              <span>回收站</span>
            </button>
          </div>
          <div className="kb-nav-group">
            <div className="kb-nav-section">帮助</div>
            <button
              className={`kb-nav-item kb-nav-help-item ${nav === "help" ? "is-active" : ""}`}
              data-label="使用说明"
              onClick={goHelp}
            >
              <CircleHelp size={18} aria-hidden />
              <span>使用说明</span>
            </button>
          </div>
        </nav>

        <div className="kb-sidebar-foot">
          <div className="kb-user-row">
            <div className="kb-user-hover">
              <StorageCard usage={storage} />
              <div className="kb-user">
                <span className="kb-avatar" aria-hidden>
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    (user.name || user.username).slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="kb-user-meta">
                  <span className="kb-user-name">{user.name || user.username}</span>
                  <span className="kb-user-title">{user.email || user.title || user.username}</span>
                </span>
              </div>
            </div>
            <button className="kb-icon-btn" onClick={logout} title="退出">
              <LogOut size={16} aria-hidden />
            </button>
          </div>
        </div>
      </aside>
      {mobileSidebarOpen && <button className="kb-sidebar-backdrop" aria-label="关闭侧边栏" onClick={() => setMobileSidebarOpen(false)} />}

      <div className="kb-main">
        <header className="kb-topbar">
          <button
            className="kb-collapse"
            onClick={(event) => {
              event.currentTarget.blur();
              if (isMobileLayout) {
                setMobileSidebarOpen((open) => !open);
                return;
              }
              setCollapsed((c) => !c);
            }}
            aria-controls="kb-sidebar"
            aria-expanded={isMobileLayout ? mobileSidebarOpen : !collapsed}
            aria-label={isMobileLayout ? "打开侧边栏" : collapsed ? "展开侧边栏" : "折叠侧边栏"}
          >
            <PanelLeft size={18} aria-hidden />
          </button>
          <div className="kb-search-wrap" ref={searchRef}>
            <div className="kb-search">
              <Search size={16} aria-hidden />
              <input
                type="search"
                placeholder="搜索"
                value={query}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={onSearchKeyDown}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchOpen(true);
                }}
              />
            </div>
            {searchOpen && query.trim() && (
              <div className="kb-search-menu">
                {searchLoading ? (
                  <div className="kb-search-empty">搜索中…</div>
                ) : searchResults.length ? (
                  searchResults.map((entry, index) => (
                    <button
                      key={entry.path}
                      className={`kb-search-option ${index === searchActiveIndex ? "is-active" : ""}`}
                      onMouseEnter={() => setSearchActiveIndex(index)}
                      onClick={() => openSearchResult(entry)}
                    >
                      <span className={`kb-search-kind is-${entry.kind}`}>{entry.kind === "directory" ? "DIR" : fileKindLabel(entry.kind)}</span>
                      <span className="kb-search-main">
                        <span className="kb-search-name">{entry.name}</span>
                        <span className="kb-search-path">/{entry.path}</span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="kb-search-empty">没有匹配文件</div>
                )}
              </div>
            )}
          </div>
          {route.view === "files" && (
            <div className="kb-new-wrap">
              <button className="kb-new" onClick={() => setUploadMenuOpen((o) => !o)}>
                <Upload size={16} aria-hidden />
                上传
                <ChevronDown size={15} aria-hidden />
              </button>
              {uploadMenuOpen && (
                <>
                  <div className="kb-menu-backdrop" onClick={() => setUploadMenuOpen(false)} />
                  <div className="kb-menu">
                    <button onClick={() => { setUploadMenuOpen(false); pickFiles(); }}>上传文件</button>
                    <button onClick={() => { setUploadMenuOpen(false); pickFolder(); }}>上传文件夹</button>
                  </div>
                </>
              )}
            </div>
          )}
        </header>

        <input ref={fileInput} className="kb-upload-input" type="file" multiple onChange={onPicked} />
        <input ref={setFolderRef} className="kb-upload-input" type="file" multiple onChange={onPicked} />

        <main className="kb-content">
          {route.view === "help" ? (
            <Help />
          ) : route.view === "trash" ? (
            <TrashPage onRestored={() => setFilesRefreshKey((key) => key + 1)} />
          ) : (
            <Home
              section={route.section}
              dir={route.dir}
              onDirChange={goDir}
              query={query}
              refreshKey={filesRefreshKey}
              previewPath={previewPath}
              onPreviewConsumed={() => setPreviewPath(null)}
              onFilesChanged={() => setFilesRefreshKey((key) => key + 1)}
              onPreviewOpen={() => {
                if (uploads.open && !uploads.collapsed) uploads.setCollapsed(true);
              }}
            />
          )}
        </main>
      </div>

      <UploadManager uploads={uploads} onAddFiles={pickFiles} onAddFolder={pickFolder} />

    </div>
  );
}

function StorageCard({ usage }: { usage: StorageUsage | null }) {
  const used = usage?.usedBytes ?? 0;
  const quota = usage?.quotaBytes ?? 1024 * 1024 * 1024;
  const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  return (
    <div className="kb-storage" title={`已使用 ${fmtBytes(used)}，共 ${fmtBytes(quota)}`}>
      <div className="kb-storage-row">
        <span>存储空间</span>
        <strong>{pct}%</strong>
      </div>
      <div className="kb-storage-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="kb-storage-sub">
        已使用 {fmtBytes(used)} / 共 {fmtBytes(quota)}
      </div>
    </div>
  );
}

function TrashPage({ onRestored }: { onRestored: () => void }) {
  const [items, setItems] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);

  const loadTrash = () => {
    setLoading(true);
    setError(null);
    return api
      .trash()
      .then((result) => {
        setItems(result.items);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "回收站加载失败");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    api
      .trash()
      .then((result) => {
        if (!canceled) setItems(result.items);
      })
      .catch((err: unknown) => {
        if (!canceled) setError(err instanceof Error ? err.message : "回收站加载失败");
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  const restoreItem = async (item: TrashEntry) => {
    if (emptying) return;
    setRestoringId(item.id);
    setActionError(null);
    try {
      await api.restoreTrash(item.id);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      onRestored();
      void loadTrash();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setRestoringId(null);
    }
  };

  const emptyTrash = async () => {
    if (!items.length || emptying) return;
    const confirmed = window.confirm("清空回收站会永久删除其中的所有项目和对应的磁盘文件，无法恢复。确定要清空吗？");
    if (!confirmed) return;
    setEmptying(true);
    setActionError(null);
    try {
      await api.emptyTrash();
      setItems([]);
      onRestored();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "清空回收站失败");
    } finally {
      setEmptying(false);
    }
  };

  return (
    <section className="trash-page">
      <header className="trash-head">
        <div>
          <h1>回收站</h1>
          <p>已删除的文件和目录会先保存在这里。</p>
        </div>
        <div className="trash-head-actions">
          <span>{items.length} 个项目</span>
          {!loading && !error && (
            <button className="trash-empty" onClick={() => void emptyTrash()} disabled={!items.length || emptying}>
              <Trash2 size={14} aria-hidden />
              {emptying ? "清空中" : "清空回收站"}
            </button>
          )}
        </div>
      </header>

      {loading ? (
        <div className="kb-placeholder">
          <div className="kb-placeholder-icon" aria-hidden>
            <Trash2 size={28} />
          </div>
          <p>正在加载回收站...</p>
        </div>
      ) : error ? (
        <div className="kb-placeholder">
          <div className="kb-placeholder-icon" aria-hidden>
            <Trash2 size={28} />
          </div>
          <p>{error}</p>
        </div>
      ) : items.length ? (
        <>
          {actionError && <div className="trash-error">{actionError}</div>}
          <div className="trash-list">
            {items.map((item) => (
              <div className="trash-row" key={item.id}>
                <span className={`trash-icon ${item.kind === "directory" ? "is-folder" : ""}`}>
                  {item.kind === "directory" ? <FolderIcon size={18} aria-hidden /> : <FileIcon size={18} aria-hidden />}
                </span>
                <span className="trash-main">
                  <strong>{item.name}</strong>
                  <span>原位置 /{item.originalPath}</span>
                </span>
                <span className="trash-meta">{item.kind === "directory" ? `${item.fileCount ?? 0} 个文件` : fmtBytes(item.size ?? 0)}</span>
                <span className="trash-meta">{formatDate(item.deletedAt)}</span>
                <button className="trash-restore" onClick={() => void restoreItem(item)} disabled={emptying || restoringId === item.id}>
                  <RotateCcw size={14} aria-hidden />
                  {restoringId === item.id ? "恢复中" : "恢复"}
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="kb-placeholder">
          <div className="kb-placeholder-icon" aria-hidden>
            <Trash2 size={28} />
          </div>
          <h1>回收站为空</h1>
          <p>删除后的文件和目录会显示在这里。</p>
        </div>
      )}
    </section>
  );
}

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

function Login({ authConfig }: { authConfig: AuthConfig }) {
  const [error, setError] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("auth_error");
  });
  const [copied, setCopied] = useState(false);

  const loginWithKylith = () => {
    if (!authConfig.kylithSso.enabled) {
      setError("KYLITH SSO 未配置，请先配置客户端凭证。");
      return;
    }
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/api/auth/kylith/start?returnTo=${encodeURIComponent(returnTo || "/")}`;
  };

  const copyAgentPrompt = async () => {
    await navigator.clipboard?.writeText(AGENT_SKILL_PROMPT);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <Box className="brand-mark" size={22} aria-hidden />
          <h1>KN Box</h1>
        </div>
        <p className="login-intro">
          KN Box 是为 AI Agent 设计的文件托管服务，也可以通过网页上传 Markdown、HTML 静态网页和图片，
          生成公司内网访问链接。
        </p>

        <section className="login-mode">
          <h2>给 AI Agent 使用</h2>
          <p>把下面两行复制发给 Codex、Claude 或 Open Code：</p>
          <div className="agent-prompt">
            <pre><code>{AGENT_SKILL_PROMPT}</code></pre>
            <button type="button" onClick={copyAgentPrompt} aria-label={copied ? "已复制" : "复制安装说明"}>
              {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
            </button>
          </div>
          <p>完成授权后，可以直接对 AI 助手说：“把 xxx 文件上传到 KN Box。”它会上传文件，并把访问链接发给你。</p>
        </section>

        <section className="login-mode">
          <h2>网页版</h2>
          <p>使用 Kylith 账号进入 KN Box，在网页中上传和管理文件。</p>
        </section>

        {error && <div className="login-error">{error}</div>}
        <button className="sso-button" type="button" onClick={loginWithKylith}>
          使用 Kylith 账号登录
        </button>
      </div>
    </div>
  );
}
