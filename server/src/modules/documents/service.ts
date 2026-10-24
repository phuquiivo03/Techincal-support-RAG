import type { QueryResult } from "pg";
import type { DocumentSummary, KnowledgeBaseStats, SourceType } from "@rag/shared";
import { pool, withTransaction } from "../../db/pool.js";
import { embedTexts } from "../../providers/embeddings.js";
import { HttpError } from "../../lib/errors.js";
import { chunkText } from "./chunker.js";

interface DocumentRow {
  id: string;
  title: string;
  source_type: SourceType;
  file_name: string;
  char_count: number;
  chunk_count: number;
  created_at: Date;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSERT_BATCH = 500; // rows per multi-VALUES insert (pg param limit is 65535)

export interface IngestInput {
  title: string;
  fileName: string;
  sourceType: SourceType;
  content: string;
}

function toSummary(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    fileName: row.file_name,
    charCount: row.char_count,
    chunkCount: row.chunk_count,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Chunk → embed → store, replacing any existing document with the same file name
 * (upsert semantics, so re-uploading or reseeding is idempotent).
 */
export async function ingestDocument(input: IngestInput): Promise<DocumentSummary> {
  const chunks = chunkText(input.content);
  if (chunks.length === 0) {
    throw new HttpError(422, "No extractable text", `File "${input.fileName}" produced no text content`);
  }

  const vectors = await embedTexts(chunks.map((c) => c.content));

  return withTransaction(async (client) => {
    await client.query("DELETE FROM documents WHERE file_name = $1", [input.fileName]);

    const docRes: QueryResult<DocumentRow> = await client.query(
      `INSERT INTO documents (title, source_type, file_name, char_count, chunk_count)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.title, input.sourceType, input.fileName, input.content.length, chunks.length],
    );
    const doc = docRes.rows[0];

    for (let offset = 0; offset < chunks.length; offset += INSERT_BATCH) {
      const batch = chunks.slice(offset, offset + INSERT_BATCH);
      const params: unknown[] = [];
      const tuples = batch.map((chunk, i) => {
        const base = i * 5;
        params.push(doc.id, chunk.index, chunk.content, JSON.stringify(vectors[offset + i]), chunk.tokens);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::vector, $${base + 5})`;
      });
      await client.query(
        `INSERT INTO chunks (document_id, chunk_index, content, embedding, tokens)
         VALUES ${tuples.join(", ")}`,
        params,
      );
    }

    return toSummary(doc);
  });
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const res: QueryResult<DocumentRow> = await pool.query(
    "SELECT * FROM documents ORDER BY created_at DESC",
  );
  return res.rows.map(toSummary);
}

export async function deleteDocument(id: string): Promise<DocumentSummary> {
  if (!UUID_RE.test(id)) throw new HttpError(400, "Invalid document id");
  const res: QueryResult<DocumentRow> = await pool.query(
    "DELETE FROM documents WHERE id = $1 RETURNING *",
    [id],
  );
  if (res.rowCount === 0) throw new HttpError(404, "Document not found");
  return toSummary(res.rows[0]);
}

export async function getStats(): Promise<KnowledgeBaseStats> {
  const res = await pool.query<{
    documents: string;
    chunks: string;
    last_updated: Date | null;
  }>(
    `SELECT
       (SELECT count(*) FROM documents) AS documents,
       (SELECT count(*) FROM chunks) AS chunks,
       (SELECT max(created_at) FROM documents) AS last_updated`,
  );
  const row = res.rows[0];
  return {
    documents: Number(row.documents),
    chunks: Number(row.chunks),
    lastUpdated: row.last_updated ? new Date(row.last_updated).toISOString() : null,
  };
}
