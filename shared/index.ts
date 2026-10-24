/**
 * API contract shared between the Express server and the Next.js web app.
 * Server returns these shapes; web consumes them. Keep in sync with reality.
 */

export type SourceType = "pdf" | "md" | "txt";

export interface DocumentSummary {
  id: string;
  title: string;
  sourceType: SourceType;
  fileName: string;
  charCount: number;
  chunkCount: number;
  createdAt: string;
}

export interface KnowledgeBaseStats {
  documents: number;
  chunks: number;
  lastUpdated: string | null;
}

export interface ChatRole {
  role: "user" | "assistant";
  content: string;
}

export interface Citation {
  /** 1-based [n] marker the model used in the answer text */
  index: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  score: number;
  snippet: string;
}

export interface Timings {
  embedMs: number;
  retrievalMs: number;
  llmMs: number;
  totalMs: number;
}

export interface ChatResponse {
  answer: string;
  /** false when no chunk cleared the similarity threshold — no LLM was called */
  sufficient: boolean;
  sources: Citation[];
  timings: Timings;
  model: string;
}

export interface RetrievedChunk {
  rank: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  score: number;
  content: string;
}

export interface RetrieveRequest {
  query: string;
  topK?: number;
  threshold?: number;
}

export interface RetrieveResponse {
  query: string;
  topK: number;
  threshold: number;
  results: RetrievedChunk[];
  /** the exact numbered context block that would be handed to the LLM */
  contextPreview: string;
  timings: {
    embedMs: number;
    retrievalMs: number;
    totalMs: number;
  };
}

export interface HealthResponse {
  status: "ok" | "degraded";
  db: boolean;
  embeddings: boolean;
  llm: boolean;
  documents: number;
  chunks: number;
  time: string;
}

export interface ApiErrorBody {
  error: string;
  details?: string;
}
