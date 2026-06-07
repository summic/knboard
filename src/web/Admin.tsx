import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, ExternalLink, FileText, Home as HomeIcon, ShieldCheck, Users, User as UserIcon } from "lucide-react";
import { api, type AccessStats, type AccessStatsContent, type AccessStatsPerson, type User } from "./api";
import { Home } from "./Home";

export function AdminPage({
  currentUser,
  selectedUserId,
  dir,
  onHome,
  onSelectUser,
  onUserDirChange,
  onPreviewOpen,
}: {
  currentUser: User;
  selectedUserId?: number | null;
  dir: string;
  onHome: () => void;
  onSelectUser: (userId: number) => void;
  onUserDirChange: (userId: number, dir: string) => void;
  onPreviewOpen?: () => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<AccessStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsView, setStatsView] = useState<"people" | "content">("people");
  const [promotingId, setPromotingId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const canPromote = currentUser.role === "super_admin";

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    api
      .adminUsers()
      .then((result) => {
        if (!canceled) setUsers(result.items);
      })
      .catch((err: unknown) => {
        if (!canceled) setError(err instanceof Error ? err.message : "用户列表加载失败");
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
    setStatsLoading(true);
    setStatsError(null);
    api
      .adminAccessStats()
      .then((result) => {
        if (!canceled) setStats(result);
      })
      .catch((err: unknown) => {
        if (!canceled) setStatsError(err instanceof Error ? err.message : "访问统计加载失败");
      })
      .finally(() => {
        if (!canceled) setStatsLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [refreshKey]);

  const selectedUser = useMemo(
    () => users.find((item) => item.id === selectedUserId) ?? null,
    [users, selectedUserId]
  );

  const promote = async (target: User) => {
    if (!canPromote || target.role !== "user" || promotingId) return;
    setPromotingId(target.id);
    setError(null);
    try {
      const result = await api.makeUserAdmin(target.id);
      setUsers((current) => current.map((item) => (item.id === target.id ? result.user : item)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "设置管理员失败");
    } finally {
      setPromotingId(null);
    }
  };

  const revokeAdmin = async (target: User) => {
    if (!canPromote || target.role !== "admin" || promotingId) return;
    setPromotingId(target.id);
    setError(null);
    try {
      const result = await api.revokeUserAdmin(target.id);
      setUsers((current) => current.map((item) => (item.id === target.id ? result.user : item)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "取消管理员失败");
    } finally {
      setPromotingId(null);
    }
  };

  const listSelectedFiles = useCallback(
    (nextDir: string) => {
      if (!selectedUser) return Promise.resolve({ dir: "", parent: null, items: [] });
      return api.adminUserFiles(selectedUser.id, nextDir, "all");
    },
    [selectedUser]
  );

  return (
    <section className="admin-page">
      <aside className="admin-menu" aria-label="管理菜单">
        <div className="admin-head">
          <h1>管理</h1>
          <span>{users.length} 个用户</span>
        </div>
        <nav className="admin-menu-nav">
          <button className={`admin-menu-item ${!selectedUser ? "is-active" : ""}`} onClick={onHome}>
            <HomeIcon size={17} aria-hidden />
            <span>首页</span>
          </button>
        </nav>
        <div className="admin-menu-section">
          <Users size={14} aria-hidden />
          <span>用户</span>
        </div>
        {error && <div className="admin-error">{error}</div>}
        {loading ? (
          <div className="admin-empty">加载中…</div>
        ) : users.length ? (
          <div className="admin-user-list">
            {users.map((item) => (
              <div className={`admin-user-row ${item.id === selectedUserId ? "is-active" : ""}`} key={item.id}>
                <button type="button" className="admin-user-select" onClick={() => onSelectUser(item.id)}>
                  <span className="admin-user-avatar" aria-hidden>
                    {item.avatarUrl ? (
                      <img src={item.avatarUrl} alt="" referrerPolicy="no-referrer" />
                    ) : (
                      (item.name || item.username).slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <span className="admin-user-main">
                    <strong>{item.name || item.username}</strong>
                    <span>{item.email || item.username}</span>
                  </span>
                </button>
                {item.role === "super_admin" ? (
                  <span className="admin-role is-super">
                    <ShieldCheck size={13} aria-hidden />
                    超级管理员
                  </span>
                ) : item.role === "admin" ? (
                  canPromote ? (
                    <button
                      type="button"
                      className="admin-promote is-revoke"
                      onClick={() => void revokeAdmin(item)}
                      disabled={promotingId === item.id}
                    >
                      {promotingId === item.id ? "取消中" : "取消管理员"}
                    </button>
                  ) : (
                    <span className="admin-role">
                      <ShieldCheck size={13} aria-hidden />
                      管理员
                    </span>
                  )
                ) : !canPromote ? (
                  <span className="admin-role is-user">用户</span>
                ) : (
                  <button
                    type="button"
                    className="admin-promote"
                    onClick={() => void promote(item)}
                    disabled={promotingId === item.id}
                  >
                    {promotingId === item.id ? "设置中" : "设为管理员"}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-empty">还没有用户。</div>
        )}
      </aside>

      <div className="admin-main">
        {selectedUser ? (
          <Home
            section="all"
            dir={dir}
            onDirChange={(nextDir) => onUserDirChange(selectedUser.id, nextDir)}
            query=""
            refreshKey={refreshKey}
            listFiles={listSelectedFiles}
            readOnly
            titleOverride={selectedUser.name || selectedUser.username}
            description={`${selectedUser.email || selectedUser.username} 的文件，只读浏览。`}
            onPreviewOpen={onPreviewOpen}
          />
        ) : (
          <AdminStatsHome
            stats={stats}
            loading={statsLoading}
            error={statsError}
            view={statsView}
            onViewChange={setStatsView}
            onSelectUser={onSelectUser}
          />
        )}
      </div>
    </section>
  );
}

function AdminStatsHome({
  stats,
  loading,
  error,
  view,
  onViewChange,
  onSelectUser,
}: {
  stats: AccessStats | null;
  loading: boolean;
  error: string | null;
  view: "people" | "content";
  onViewChange: (view: "people" | "content") => void;
  onSelectUser: (userId: number) => void;
}) {
  const people = stats?.people ?? [];
  const contents = stats?.contents ?? [];
  const totalViews = people.reduce((sum, item) => sum + item.viewCount, 0);
  const activePeople = people.filter((item) => item.viewCount > 0).length;
  const trackedContent = contents.length;

  return (
    <section className="admin-stats">
      <header className="admin-stats-head">
        <div>
          <h1>首页</h1>
          <p>公开文章和网页的访问统计。</p>
        </div>
        <div className="admin-stat-summary" aria-label="统计概览">
          <span>
            <strong>{totalViews}</strong>
            总访问
          </span>
          <span>
            <strong>{activePeople}</strong>
            有访问用户
          </span>
          <span>
            <strong>{trackedContent}</strong>
            热门内容
          </span>
        </div>
      </header>

      <div className="admin-tabs" role="tablist" aria-label="访问统计维度">
        <button className={view === "people" ? "is-active" : ""} onClick={() => onViewChange("people")}>
          <BarChart3 size={16} aria-hidden />
          按人统计
        </button>
        <button className={view === "content" ? "is-active" : ""} onClick={() => onViewChange("content")}>
          <FileText size={16} aria-hidden />
          热门内容
        </button>
      </div>

      {error ? (
        <div className="admin-placeholder">
          <BarChart3 size={30} aria-hidden />
          <h2>统计加载失败</h2>
          <p>{error}</p>
        </div>
      ) : loading ? (
        <div className="admin-placeholder">
          <BarChart3 size={30} aria-hidden />
          <h2>加载中</h2>
          <p>正在读取访问统计。</p>
        </div>
      ) : view === "people" ? (
        <PeopleStatsTable items={people} onSelectUser={onSelectUser} />
      ) : (
        <ContentStatsTable items={contents} />
      )}
    </section>
  );
}

function PeopleStatsTable({ items, onSelectUser }: { items: AccessStatsPerson[]; onSelectUser: (userId: number) => void }) {
  if (!items.length) {
    return (
      <div className="admin-placeholder">
        <UserIcon size={30} aria-hidden />
        <h2>暂无访问</h2>
        <p>有公开文章或网页被访问后，这里会按用户汇总。</p>
      </div>
    );
  }
  return (
    <div className="admin-stats-table is-people">
      <div className="admin-stats-row is-head">
        <span>用户</span>
        <span>访问量</span>
        <span>内容数</span>
        <span>最近访问</span>
      </div>
      {items.map((item) => (
        <button className="admin-stats-row" key={item.user.id} onClick={() => onSelectUser(item.user.id)}>
          <span className="admin-stats-user">
            <span className="admin-user-avatar" aria-hidden>
              {item.user.avatarUrl ? (
                <img src={item.user.avatarUrl} alt="" referrerPolicy="no-referrer" />
              ) : (
                (item.user.name || item.user.username).slice(0, 1).toUpperCase()
              )}
            </span>
            <span>
              <strong>{item.user.name || item.user.username}</strong>
              <em>{item.user.email || item.user.username}</em>
            </span>
          </span>
          <strong>{item.viewCount}</strong>
          <span>{item.contentCount}</span>
          <span>{formatStatsDate(item.lastViewedAt)}</span>
        </button>
      ))}
    </div>
  );
}

function ContentStatsTable({ items }: { items: AccessStatsContent[] }) {
  if (!items.length) {
    return (
      <div className="admin-placeholder">
        <FileText size={30} aria-hidden />
        <h2>暂无热门内容</h2>
        <p>Markdown 文章或 HTML 网页被访问后，这里会显示热门内容。</p>
      </div>
    );
  }
  return (
    <div className="admin-stats-table is-content">
      <div className="admin-stats-row is-head">
        <span>内容</span>
        <span>所属用户</span>
        <span>访问量</span>
        <span>最近访问</span>
        <span />
      </div>
      {items.map((item) => (
        <div className="admin-stats-row" key={`${item.owner.id}:${item.path}`}>
          <span className="admin-content-main">
            <strong>{item.name}</strong>
            <em>/{item.path}</em>
          </span>
          <span>{item.owner.name || item.owner.username}</span>
          <strong>{item.viewCount}</strong>
          <span>{formatStatsDate(item.lastViewedAt)}</span>
          <a href={item.url} target="_blank" rel="noreferrer" title="打开内容">
            <ExternalLink size={15} aria-hidden />
          </a>
        </div>
      ))}
    </div>
  );
}

function formatStatsDate(value: string | null) {
  if (!value) return "从未";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
