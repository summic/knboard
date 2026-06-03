export type User = {
  id: number;
  username: string;
  role: "super_admin" | "admin" | "user";
  email?: string | null;
  name?: string | null;
  title?: string | null;
  avatarUrl?: string | null;
  provider?: string;
};
export type AuthConfig = { kylithSso: { enabled: boolean; issuer: string | null } };

export type UploadedFile = { name: string; path: string; size: number; url: string };
export type FileSection = "all" | "web" | "images" | "other";
export type FileKind = "directory" | "web" | "markdown" | "image" | "other";
export type FileEntry = {
  name: string;
  path: string;
  kind: FileKind;
  size: number | null;
  fileCount?: number;
  updatedAt: string;
  url: string | null;
};
export type FileListing = { dir: string; parent: string | null; items: FileEntry[] };
export type FileSearchResult = { items: FileEntry[] };
export type StorageUsage = { usedBytes: number; quotaBytes: number };
export type TrashEntry = {
  id: string;
  name: string;
  originalPath: string;
  kind: FileKind;
  size: number | null;
  totalSize: number;
  fileCount?: number;
  deletedAt: string;
};
export type TrashListing = { items: TrashEntry[] };
export type CliToken = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};
export type CliTokenListing = { items: CliToken[] };
export type IssuedCliToken = { ok: true; token: string; item: CliToken };
export type UploadConflict = { path: string; type: "file" | "directory" };
export type UploadConflictResult = { conflicts: UploadConflict[]; renamedPaths: Record<string, string> };
export type UploadConflictMode = "error" | "rename" | "overwrite";

// Upload one file via XHR so we get real upload progress events. Returns the
// promise plus an abort() to cancel mid-flight. relativePath (from a folder
// pick's webkitRelativePath) lets the server recreate the folder structure.
export function uploadFile(
  file: File,
  relativePath: string,
  options: { targetRelativePath?: string; conflictMode?: UploadConflictMode },
  onProgress: (loaded: number, total: number) => void
): { promise: Promise<UploadedFile>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadedFile>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    if (relativePath) form.append("relativePath", relativePath);
    if (options.targetRelativePath) form.append("targetRelativePath", options.targetRelativePath);
    if (options.conflictMode) form.append("conflictMode", options.conflictMode);
    xhr.open("POST", "/api/uploads/file");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status === 401) return reject(new AuthRequiredError());
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText).file as UploadedFile);
        } catch {
          reject(new Error("上传响应解析失败"));
        }
        return;
      }
      let msg = "上传失败";
      try {
        msg = JSON.parse(xhr.responseText).error || msg;
      } catch {
        /* keep default */
      }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error("网络错误，上传中断"));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthRequiredError";
  }
}

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (res.status === 401) throw new AuthRequiredError();
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(msg.error || "Request failed");
  }
  return res.json();
}

const enc = encodeURIComponent;

export const api = {
  authConfig: () => req<AuthConfig>("/api/auth/config"),
  me: () => req<{ user: User }>("/api/auth/me"),
  login: (data: { username: string; password: string }) =>
    req<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify(data) }),
  logout: () => req<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  resolveUploadConflicts: (paths: string[], baseDir = "", totalBytes = 0) =>
    req<UploadConflictResult>("/api/uploads/conflicts", {
      method: "POST",
      body: JSON.stringify({ paths, baseDir, totalBytes }),
    }),

  listFiles: (dir = "", type: FileSection = "all") =>
    req<FileListing>(`/api/files?dir=${enc(dir)}&type=${enc(type)}`),
  searchFiles: (q: string, limit = 10) =>
    req<FileSearchResult>(`/api/files/search?q=${enc(q)}&limit=${enc(String(limit))}`),
  storage: () => req<StorageUsage>("/api/storage"),
  trash: () => req<TrashListing>("/api/trash"),
  emptyTrash: () => req<{ ok: true; deleted: number }>("/api/trash", { method: "DELETE" }),
  restoreTrash: (id: string) =>
    req<{ ok: true; restored: boolean; item: { id: string; name: string; originalPath: string; kind: FileKind } }>(
      `/api/trash/${enc(id)}/restore`,
      { method: "POST" }
    ),
  cliTokens: () => req<CliTokenListing>("/api/cli/tokens"),
  issueCliToken: (name = "KN Box CLI") =>
    req<IssuedCliToken>("/api/cli/tokens", { method: "POST", body: JSON.stringify({ name }) }),
  revokeCliToken: (id: string) =>
    req<{ ok: true; revoked: boolean }>(`/api/cli/tokens/${enc(id)}`, { method: "DELETE" }),
  createFolder: (dir: string, name: string) =>
    req<{ ok: true; folder: { path: string; name: string } }>("/api/files/folders", {
      method: "POST",
      body: JSON.stringify({ dir, name }),
    }),
  deleteFiles: (paths: string[], confirmName: string) =>
    req<{ ok: true; deleted: number }>("/api/files", { method: "DELETE", body: JSON.stringify({ paths, confirmName }) }),
  adminUsers: () => req<{ items: User[] }>("/api/admin/users"),
  makeUserAdmin: (id: number) =>
    req<{ user: User }>(`/api/admin/users/${enc(String(id))}/admin`, { method: "POST" }),
  revokeUserAdmin: (id: number) =>
    req<{ user: User }>(`/api/admin/users/${enc(String(id))}/admin`, { method: "DELETE" }),
  adminUserFiles: (id: number, dir = "", type: FileSection = "all") =>
    req<FileListing>(`/api/admin/users/${enc(String(id))}/files?dir=${enc(dir)}&type=${enc(type)}`),
};
