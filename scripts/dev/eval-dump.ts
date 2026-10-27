/** Dev helper: dump eval runs and full detail of failed + off-topic items.
 *  Usage: npx tsx eval-dump.ts [runId] — writes JSON to stdout. */
import { pool } from "../../server/src/db/pool.js";

interface RunRow {
  id: string;
  dataset_version: string;
  label: string | null;
  created_at: Date;
  item_count: number;
  passed_count: number;
  metrics: { passRate?: number };
}

async function main(): Promise<void> {
  const runIdArg = process.argv[2];
  const runs = await pool.query<RunRow>(
    `SELECT id, dataset_version, label, created_at, item_count, passed_count, metrics
     FROM eval_runs ORDER BY created_at DESC LIMIT 25`,
  );

  const listing = runs.rows.map((r) => ({
    id: r.id,
    dataset: r.dataset_version,
    label: r.label,
    createdAt: r.created_at.toISOString(),
    passed: `${r.passed_count}/${r.item_count}`,
  }));

  const target = runIdArg ?? runs.rows[0]?.id;
  const items = target
    ? await pool.query(
        `SELECT item_id, pass, result FROM eval_results WHERE run_id = $1 ORDER BY item_id ASC`,
        [target],
      )
    : { rows: [] as unknown[] };

  const failed = items.rows
    .map((r: { item_id: string; pass: boolean; result: Record<string, unknown> }) => r.result)
    .filter((r: { pass: boolean }) => !r.pass);
  const offTopic = items.rows
    .map((r: { result: Record<string, unknown> }) => r.result)
    .filter((r: { category: string }) => r.category === "off_topic");

  console.log(JSON.stringify({ runs: listing, targetRun: target ?? null, failed, offTopic }, null, 2));
  await pool.end();
}

void main();
