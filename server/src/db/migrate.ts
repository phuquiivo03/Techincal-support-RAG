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

    CREATE TABLE IF NOT EXISTS eval_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dataset_version TEXT NOT NULL,
      label TEXT,
      config JSONB NOT NULL,
      metrics JSONB NOT NULL,
      item_count INTEGER NOT NULL,
      passed_count INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS eval_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      category TEXT NOT NULL,
      question TEXT NOT NULL,
      expected_answer TEXT NOT NULL,
      expected_file_names TEXT[] NOT NULL,
      pass BOOLEAN NOT NULL,
      failure_reasons TEXT[] NOT NULL DEFAULT '{}',
      result JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS eval_results_run_idx ON eval_results (run_id);

    -- Robustness suite separation (2026-10-25): every run is tagged with its
    -- suite so the dashboard can keep baseline and robustness history apart.
    -- Existing rows are backfilled: dataset_version starting with "robustness"
    -- belongs to the robustness suite, everything else stays baseline.
    ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS suite TEXT NOT NULL DEFAULT 'baseline';
    UPDATE eval_runs SET suite = 'robustness'
     WHERE dataset_version LIKE 'robustness%' AND suite = 'baseline';

    -- Service role (postgres) bypasses RLS, but this blocks Supabase's
    -- anon-key REST API from reading our tables.
    ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE eval_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE eval_results ENABLE ROW LEVEL SECURITY;
  `;

  await pool.query(sql);
  log.info("database schema is up to date");
}
