/** Dev helper: on-topic top-1 similarity scores for a stored run (threshold headroom evidence). */
import { pool } from "../../server/src/db/pool.js";

async function main(): Promise<void> {
  const runId = process.argv[2];
  const r = await pool.query(
    `SELECT item_id, pass, (result->'retrieved'->0->>'score')::float AS top1
     FROM eval_results
     WHERE run_id = $1 AND result->>'category' <> 'off_topic'
     ORDER BY top1 NULLS LAST`,
    [runId],
  );
  for (const row of r.rows) {
    console.log(`${row.item_id}  top1=${row.top1 ?? "none"}  pass=${row.pass}`);
  }
  await pool.end();
}

void main();
