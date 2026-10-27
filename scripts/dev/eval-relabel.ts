/** Dev helper: set a label on a stored eval run + sanity-check stored answers. */
import { pool } from "../../server/src/db/pool.js";

async function main(): Promise<void> {
  const [runId, label] = process.argv.slice(2);
  if (runId && label) {
    const r = await pool.query(`UPDATE eval_runs SET label = $2 WHERE id = $1 RETURNING id, label`, [
      runId,
      label,
    ]);
    console.log("label set:", r.rows[0]?.label ?? "(run not found)");
  }
  const items = await pool.query(
    `SELECT item_id, result FROM eval_results WHERE run_id = $1 ORDER BY item_id ASC`,
    [runId],
  );
  let ascii = 0;
  let variant = 0;
  for (const row of items.rows) {
    const it = row.result;
    ascii += it.citationMarkers?.length ?? 0;
    variant += it.variantCitationMarkers?.length ?? 0;
    if (it.generatedAnswer?.includes("【")) {
      console.log(`RAW LENTICULAR STILL PRESENT in ${row.item_id}`);
    }
  }
  console.log(`stored answers: ${ascii} ASCII markers, ${variant} variant markers`);
  await pool.end();
}

void main();
