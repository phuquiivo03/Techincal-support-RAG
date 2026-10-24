import type { Pool } from "pg";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";

/**
 * Idempotent schema migration. Runs at server boot (and from scripts).
 * Embedding dimension must match the provider's outputDimensionality (env.EMBEDDING_DIM).
 */
export async function migrate(pool: Pool): Promise<void> {
  const sql = `
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('pdf', 'md', 'txt')),
      file_name TEXT NOT NULL UNIQUE,
      char_count INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding VECTOR(${env.EMBEDDING_DIM}) NOT NULL,
      tokens INTEGER NOT NULL DEFAULT 0,
      UNIQUE (document_id, chunk_index)
    );

    CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
      ON chunks USING hnsw (embedding vector_cosine_ops);

    -- Service role (postgres) bypasses RLS, but this blocks Supabase's
    -- anon-key REST API from reading our tables.
    ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
  `;

  await pool.query(sql);
  log.info("database schema is up to date");
}
