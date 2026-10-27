/** Audit helper: print stored run configs + server process info. */
import { pool } from "../../server/src/db/pool.js";

async function main(): Promise<void> {
  const r = await pool.query(
    "SELECT id, config, metrics->'abstention' AS abst, created_at FROM eval_runs ORDER BY created_at",
  );
  for (const row of r.rows) {
    console.log(
      row.created_at.toISOString(),
      row.id.slice(0, 8),
      JSON.stringify(row.config),
      "abst=" + JSON.stringify(row.abst),
    );
  }
  await pool.end();
}

void main();
