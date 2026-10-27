/** Dev helper: print aggregate metrics side by side for two stored runs. */
import { pool } from "../../server/src/db/pool.js";

async function main(): Promise<void> {
  const [a, b] = process.argv.slice(2);
  const r = await pool.query(
    `SELECT id, label, metrics FROM eval_runs WHERE id = ANY($1)`,
    [[a, b]],
  );
  const pick = (m: Record<string, never>) => ({
    passRate: m.passRate,
    recallAt5: m.retrieval?.recallAt5,
    mrr: m.retrieval?.mrr,
    chunkRecallAt5: m.retrieval?.chunkRecallAt5,
    keywordCoverage: m.answers?.keywordCoverage,
    citationPrecision: m.answers?.citationPrecision,
    variantCitationPrecision: m.answers?.variantCitationPrecision ?? "(field absent)",
    citationRecall: m.answers?.citationRecall,
    falseAbstentions: m.answers?.falseAbstentions,
    abstentionRate: m.abstention?.abstentionRate,
    totalTokens: m.tokens?.totalTokens,
  });
  for (const row of r.rows.reverse()) {
    console.log(`${row.id} · ${row.label ?? "(no label)"}`);
    console.log(JSON.stringify(pick(row.metrics), null, 1));
  }
  await pool.end();
}

void main();
