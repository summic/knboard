export type Column = { id: string; name: string; count?: number };

export type Category = {
  dir: string;
  name: string;
  type: "docs" | "kanban";
  icon?: string;
  columns?: Column[];
  present: boolean;
  summary:
    | { total: number; recent: { id: string; title: string }[] } // docs
    | { total: number; columns: Column[] } // kanban
    | null;
};

export type Project = {
  title: string;
  description: string;
  categories: Category[];
  readme: string | null;
};

export type Doc = {
  id: string;
  category: string;
  folder: string; // sub-folder path within the category ("" = root)
  title: string;
  order: number;
  created: string | null;
  updated: string | null;
  mtime?: number;
  body: string;
};

export type Card = {
  id: string;
  category: string;
  title: string;
  status: string;
  priority: string | null;
  tags: string[];
  order: number;
  created: string | null;
  updated: string | null;
  body: string;
};

export type Board = { dir: string; name: string; icon?: string; columns: Column[]; cards: Card[] };

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(msg.error || "Request failed");
  }
  return res.json();
}

const enc = encodeURIComponent;

// Subscribe to server-pushed .md change events (live refresh). Returns an
// unsubscribe fn. EventSource reconnects automatically on drop.
export function subscribeToChanges(onChange: (paths: string[]) => void): () => void {
  const es = new EventSource("/api/events");
  es.onmessage = (e) => {
    let paths: string[] = [];
    try {
      paths = JSON.parse(e.data).paths ?? [];
    } catch {
      /* ignore */
    }
    onChange(paths);
  };
  return () => es.close();
}

export const api = {
  getProject: () => req<Project>("/api/project"),
  addCategory: (dir: string) =>
    req<Project>("/api/categories", { method: "POST", body: JSON.stringify({ dir }) }),

  listDocs: (dir: string) => req<Doc[]>(`/api/docs/${enc(dir)}`),
  readDoc: (dir: string, id: string) => req<Doc>(`/api/docs/${enc(dir)}/${enc(id)}`),
  createDoc: (dir: string, data: { title: string; body?: string }) =>
    req<Doc>(`/api/docs/${enc(dir)}`, { method: "POST", body: JSON.stringify(data) }),
  updateDoc: (dir: string, id: string, patch: Partial<Doc>) =>
    req<Doc>(`/api/docs/${enc(dir)}/${enc(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteDoc: (dir: string, id: string) =>
    req<{ ok: true }>(`/api/docs/${enc(dir)}/${enc(id)}`, { method: "DELETE" }),

  getBoard: (dir: string) => req<Board>(`/api/kanban/${enc(dir)}`),
  createCard: (dir: string, data: { title: string; status?: string; body?: string }) =>
    req<Card>(`/api/kanban/${enc(dir)}/cards`, { method: "POST", body: JSON.stringify(data) }),
  updateCard: (dir: string, id: string, patch: Partial<Card>) =>
    req<Card>(`/api/kanban/${enc(dir)}/cards/${enc(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteCard: (dir: string, id: string) =>
    req<{ ok: true }>(`/api/kanban/${enc(dir)}/cards/${enc(id)}`, { method: "DELETE" }),
};
