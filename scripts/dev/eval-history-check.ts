/**
 * Snapshot the eval run history (id, dataset, label, pass metrics) so it can be
 * compared before/after the robustness-module work — proving historical runs
 * are preserved untouched. Usage: npx tsx scripts/dev/eval-history-check.ts <label>
 */
import { pool } from "../../server/src/db/pool.js";
import { createHash } from "node:crypto";
import writeFs from "node:fs";

async function main(): Promise<void> {
  const tag = process.argv[2] ?? "snapshot";
  const runs = await pool.query<{
    id: string;
    dataset_version: string;
    label: string | null;
    item_count: number;
    passed_count: number;
    created_at: Date;
  }>(
    "SELECT id, dataset_version, label, item_count, passed_count, created_at FROM eval_runs ORDER BY created_at ASC",
  );
  const results = await pool.query<{ run_id: string; n: string; hash: string }>(
    `SELECT run_id, count(*)::text AS n, md5(string_agg(id::text || result::text, '|' ORDER BY id)) AS hash
     FROM eval_results GROUP BY run_id`,
  );
  const resultIndex = new Map(results.rows.map((r) => [r.run_id, r]));
  const lines = runs.rows.map(
    (r) =>
      `${r.id} ${r.dataset_version} label=${r.label ?? "-"} ${r.item_count}/${r.passed_count} results=${resultIndex.get(r.id)?.n ?? 0} hash=${resultIndex.get(r.id)?.hash ?? "-"}`,
  );
  const out = `# eval history ${tag} @ ${new Date().toISOString()}\ntotal_runs=${runs.rows.length}\n${lines.join("\n")}\noverall_hash=${createHash("md5").update(lines.join("\n")).digest("hex")}\n`;
  writeFs.writeFileSync(`/tmp/eval-history-${tag}.txt`, out);
  console.log(out);
  await pool.end();
}

void main();
