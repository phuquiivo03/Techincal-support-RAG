/** Dev helper: dump one item of a stored eval run (verifies JSONB round-trip). */
import { pool } from "../../server/src/db/pool.js";

async function main(): Promise<void> {
  const [runId, itemId] = process.argv.slice(2);
  if (!runId || !itemId) {
    console.error("usage: npx tsx dump-eval-item.ts <runId> <itemId>");
    process.exit(1);
  }
  const r = await pool.query(
    `SELECT result FROM eval_results WHERE run_id = $1 AND item_id = $2`,
    [runId, itemId],
  );
  if (r.rowCount === 0) {
    console.log("not found");
  } else {
    const item = r.rows[0].result;
    console.log(`id=${item.id} pass=${item.pass} sufficient=${item.sufficient} markers=${JSON.stringify(item.citationMarkers)}`);
    console.log(`failureReasons=${JSON.stringify(item.failureReasons)}`);
    console.log(`timings=${JSON.stringify(item.timings)} usage=${JSON.stringify(item.usage)}`);
    console.log("--- answer ---");
    console.log(item.generatedAnswer);
  }
  await pool.end();
}

void main();
