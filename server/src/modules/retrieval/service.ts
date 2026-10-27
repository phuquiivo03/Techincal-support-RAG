import type { RetrievedChunk } from "@rag/shared";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { embedTexts } from "../../providers/embeddings.js";

export interface RetrievalOptions {
  topK?: number;
  threshold?: number;
}

export interface RetrievalResult {
  results: RetrievedChunk[];
  topK: number;
  threshold: number;
  timings: {
    embedMs: number;
    retrievalMs: number;
  };
}

interface RetrievalRow {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  document_title: string;
  file_name: string;
  similarity: number;
}

function roundMs(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/**
 * Embed the query and fetch the most similar chunks by cosine distance.
 * Similarity = 1 - cosine distance, in [0, 1] (higher is better).
 * We over-fetch (2x topK) then filter by threshold so HNSW ordering is preserved.
 */
export async function retrieve(query: string, options: RetrievalOptions = {}): Promise<RetrievalResult> {
  const topK = options.topK ?? env.DEFAULT_TOP_K;
  const threshold = options.threshold ?? env.SIMILARITY_THRESHOLD;

  const t0 = performance.now();
  const [queryVector] = await embedTexts([query]);
  const embedMs = roundMs(performance.now() - t0);

  const t1 = performance.now();
  const res = await pool.query<RetrievalRow>(
    `SELECT c.id AS chunk_id,
            c.document_id,
            c.chunk_index,
            c.content,
            d.title AS document_title,
            d.file_name,
            1 - (c.embedding <=> $1::vector) AS similarity
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     ORDER BY c.embedding <=> $1::vector
     LIMIT $2`,
    [JSON.stringify(queryVector), topK * 2],
  );
  const retrievalMs = roundMs(performance.now() - t1);

  const results: RetrievedChunk[] = res.rows
    .filter((row) => row.similarity >= threshold)
    .slice(0, topK)
    .map((row, i) => ({
      rank: i + 1,
      chunkId: row.chunk_id,
      documentId: row.document_id,
      documentTitle: row.document_title,
      documentFileName: row.file_name,
      chunkIndex: row.chunk_index,
      score: Math.round(row.similarity * 1000) / 1000,
      content: row.content,
    }));

  return { results, topK, threshold, timings: { embedMs, retrievalMs } };
}

/** The numbered context block handed to the LLM (also shown in the debugger). */
export function buildContext(results: RetrievedChunk[]): string {
  return results
    .map(
      (r) =>
        `[${r.rank}] Document: ${r.documentTitle} (chunk ${r.chunkIndex + 1}, similarity ${r.score.toFixed(2)})\n${r.content}`,
    )
    .join("\n\n---\n\n");
}
