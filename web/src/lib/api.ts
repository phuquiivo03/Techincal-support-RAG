import type {
  ChatResponse,
  ChatRole,
  DocumentSummary,
  HealthResponse,
  KnowledgeBaseStats,
  RetrieveRequest,
  RetrieveResponse,
} from "@rag/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(0, `Cannot reach the API server (${API_URL}) — start it with npm run dev:server`);
  }

  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body as { error?: string; details?: string };
    throw new ApiError(res.status, err.error ?? `Request failed (${res.status})`, err.details);
  }
  return body as T;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),

  stats: () => request<KnowledgeBaseStats>("/api/documents/stats"),

  documents: () =>
    request<{ documents: DocumentSummary[] }>("/api/documents").then((r) => r.documents),

  uploadDocument: async (file: File): Promise<DocumentSummary> => {
    const form = new FormData();
    form.append("file", file);
    let res: Response;
    try {
      res = await fetch(`${API_URL}/api/documents`, { method: "POST", body: form });
    } catch {
      throw new ApiError(0, `Cannot reach the API server (${API_URL})`);
    }
    const body: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = body as { error?: string; details?: string };
      throw new ApiError(res.status, err.error ?? "Upload failed", err.details);
    }
    return (body as { document: DocumentSummary }).document;
  },

  deleteDocument: (id: string) =>
    request<{ deleted: boolean; document: DocumentSummary }>(`/api/documents/${id}`, {
      method: "DELETE",
    }),

  chat: (question: string, history: ChatRole[]) =>
    request<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ question, history }),
    }),

  retrieve: (req: RetrieveRequest) =>
    request<RetrieveResponse>("/api/retrieve", {
      method: "POST",
      body: JSON.stringify(req),
    }),
};
