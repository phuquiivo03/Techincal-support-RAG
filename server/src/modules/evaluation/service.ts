import type { EvalRunConfig, EvalRunDetail, EvalRunSummary, EvalSuite } from "@rag/shared";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { HttpError } from "../../lib/errors.js";
import { log } from "../../lib/logger.js";
import { answerQuestion } from "../chat/service.js";
import { retrieve } from "../retrieval/service.js";
import { listDatasets, loadDataset } from "./dataset.js";
import { aggregateEvalItems } from "./metrics.js";
import { runDataset, type EvalPipelineDeps } from "./runner.js";

/**
 * Evaluation orchestration: wires the REAL chat + retrieval services into the
 * runner, persists runs, and reads them back for the dashboard.
 */

function realPipeline(): EvalPipelineDeps {
  return {
    answerQuestion: (question, history) => answerQuestion(question, history ?? []),
    // threshold 0 so ranking metrics see the raw ordering even below the cutoff
    retrieveForRanking: async (question) =>
      (await retrieve(question, { topK: env.DEFAULT_TOP_K, threshold: 0 })).results,
  };
}

// Groq free tier rate-limits burst traffic — pace the run so it survives.
// gpt-oss-120b free tier is capped at ~8000 tokens/minute and an eval item
// spends ~2.5k prompt tokens: at 3–20 s spacing the run 429-storms and
// fetchWithRetry's backoffs (retry-after up to 90 s) make items take MINUTES —
// slower than honest pacing. 30 s keeps a rolling minute at ~5k tokens.
const ITEM_DELAY_MS = 30_000;

// One eval run at a time per process — each run makes ~20 real LLM calls.
let inFlight: Promise<EvalRunDetail> | null = null;

export interface RunEvaluationOptions {
  datasetVersion: string;
  label?: string;
}

export async function runEvaluation(options: RunEvaluationOptions): Promise<EvalRunDetail> {
  if (inFlight) {
    throw new HttpError(409, "An evaluation run is already in progress — wait for it to finish");
  }
  const job = runEvaluationInner(options).finally(() => {
    inFlight = null;
  });
  inFlight = job;
  return job;
}

async function runEvaluationInner(options: RunEvaluationOptions): Promise<EvalRunDetail> {
  const dataset = await loadDataset(options.datasetVersion);
  const label = options.label?.trim() || null;
  if (label && label.length > 120) {
    throw new HttpError(400, "Label must be at most 120 characters");
  }

  const config: EvalRunConfig = {
    topK: env.DEFAULT_TOP_K,
    threshold: env.SIMILARITY_THRESHOLD,
    llmModel: env.LLM_MODEL,
    embeddingModel: env.EMBEDDING_MODEL,
    embeddingDim: env.EMBEDDING_DIM,
  };

  log.info(`eval run starting: dataset=${dataset.version} items=${dataset.items.length} label=${label ?? "-"}`);
  const items = await runDataset(
    dataset,
    realPipeline(),
    (done, total, item) => {
      log.info(`eval ${done}/${total}: ${item.id} (${item.category})`);
    },
    ITEM_DELAY_MS,
  );
  const metrics = aggregateEvalItems(items);

  const runRow = await pool.query<{ id: string; created_at: Date }>(
    `INSERT INTO eval_runs (dataset_version, suite, label, config, metrics, item_count, passed_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, created_at`,
    [
      dataset.version,
      dataset.suite,
      label,
      JSON.stringify(config),
      JSON.stringify(metrics),
      metrics.items,
      metrics.passed,
    ],
  );
  const runId = runRow.rows[0].id;

  const values: unknown[] = [];
  const tuples = items.map((item, i) => {
    const base = i * 9;
    values.push(
      runId,
      item.id,
      item.category,
      item.question,
      item.expectedAnswer,
      item.expectedFileNames,
      item.pass,
      item.failureReasons,
      JSON.stringify(item),
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::text[], $${base + 7}, $${base + 8}::text[], $${base + 9})`;
  });
  await pool.query(
    `INSERT INTO eval_results
       (run_id, item_id, category, question, expected_answer, expected_file_names, pass, failure_reasons, result)
     VALUES ${tuples.join(", ")}`,
    values,
  );

  log.info(
    `eval run complete: ${metrics.passed}/${metrics.items} passed · recall@5=${metrics.retrieval.recallAt5} · mrr=${metrics.retrieval.mrr} · abstention=${metrics.abstention.abstentionRate ?? "n/a"}`,
  );

  return {
    id: runId,
    datasetVersion: dataset.version,
    label,
    createdAt: runRow.rows[0].created_at.toISOString(),
    config,
    metrics,
    items,
  };
}

export { listDatasets };

interface RunRow {
  id: string;
  dataset_version: string;
  suite: string;
  label: string | null;
  config: EvalRunConfig;
  metrics: EvalRunSummary["metrics"];
  created_at: Date;
}

function toSummary(row: RunRow): EvalRunSummary {
  return {
    id: row.id,
    datasetVersion: row.dataset_version,
    // legacy rows predate the suite column and read back as "baseline"
    suite: isEvalSuite(row.suite) ? row.suite : "baseline",
    label: row.label,
    createdAt: row.created_at.toISOString(),
    config: row.config,
    metrics: row.metrics,
  };
}

const EVAL_SUITE_VALUES: readonly EvalSuite[] = ["baseline", "robustness", "clarification"];

function isEvalSuite(value: string): value is EvalSuite {
  return (EVAL_SUITE_VALUES as readonly string[]).includes(value);
}

export async function listRuns(limit = 20, suite?: string): Promise<EvalRunSummary[]> {
  const suiteFilter = isEvalSuite(suite ?? "") ? (suite as EvalSuite) : null;
  const res = await pool.query<RunRow>(
    `SELECT id, dataset_version, suite, label, config, metrics, created_at
     FROM eval_runs
     ${suiteFilter ? "WHERE suite = $2" : ""}
     ORDER BY created_at DESC
     LIMIT $1`,
    suiteFilter ? [Math.min(Math.max(limit, 1), 100), suiteFilter] : [Math.min(Math.max(limit, 1), 100)],
  );
  return res.rows.map(toSummary);
}

export async function getRun(id: string): Promise<EvalRunDetail | null> {
  const runRes = await pool.query<RunRow>(
    `SELECT id, dataset_version, suite, label, config, metrics, created_at
     FROM eval_runs WHERE id = $1`,
    [id],
  );
  if (runRes.rowCount === 0) return null;

  const itemsRes = await pool.query<{ result: EvalRunDetail["items"][number] }>(
    `SELECT result FROM eval_results WHERE run_id = $1 ORDER BY created_at ASC, item_id ASC`,
    [id],
  );

  return { ...toSummary(runRes.rows[0]), items: itemsRes.rows.map((r) => r.result) };
}

export async function deleteRun(id: string): Promise<boolean> {
  const res = await pool.query("DELETE FROM eval_runs WHERE id = $1", [id]);
  return res.rowCount !== null && res.rowCount > 0;
}

export async function isRunInFlight(): Promise<boolean> {
  return inFlight !== null;
}
