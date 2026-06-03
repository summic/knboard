import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, User as UserIcon } from "lucide-react";
import { api, type User } from "./api";
import { Home } from "./Home";

export function AdminPage({
  currentUser,
  selectedUserId,
  dir,
  onSelectUser,
  onUserDirChange,
  onPreviewOpen,
}: {
  currentUser: User;
  selectedUserId?: number | null;
  dir: string;
  onSelectUser: (userId: number) => void;
  onUserDirChange: (userId: number, dir: string) => void;
  onPreviewOpen?: () => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      <aside className="admin-users" aria-label="用户列表">
        <div className="admin-head">
          <h1>管理</h1>
          <span>{users.length} 个用户</span>
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

      <div className="admin-files">
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
          <div className="admin-placeholder">
            <UserIcon size={30} aria-hidden />
            <h2>选择用户</h2>
            <p>点击左侧用户后，可以只读浏览该用户的所有文件。</p>
          </div>
        )}
      </div>
    </section>
  );
}
