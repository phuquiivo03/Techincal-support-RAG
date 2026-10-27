/**
 * Audit helper: dump stored eval runs for manual inspection.
 * 1. `runs`                      — list all runs with pass rates
 * 2. `items <runId>`             — per-item scores, citations, timings, usage
 * 3. `labels <runId>`            — verify v1 expectedChunks labels against live
 *                                  chunk content in the DB (prints excerpts)
 * 4. `latency <runId>`           — P50/P95/P99 latency + token stats
 * Usage (cwd=server): npx tsx ../scripts/dev/audit-dump.ts <cmd> [args]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { EvalItemResult } from "@rag/shared";
import { pool } from "../../server/src/db/pool.js";

interface RunRow {
  id: string;
  dataset_version: string;
  label: string | null;
  item_count: number;
  passed_count: number;
  created_at: Date;
}

async function getItems(runId: string): Promise<EvalItemResult[]> {
  const res = await pool.query<{ result: EvalItemResult }>(
    "SELECT result FROM eval_results WHERE run_id = $1 ORDER BY created_at ASC, item_id ASC",
    [runId],
  );
  return res.rows.map((r) => r.result);
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.ceil((p / 100) * sorted.length) - 1, sorted.length - 1);
  return sorted[Math.max(idx, 0)];
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  const runsRes = await pool.query<RunRow>(
    "SELECT id, dataset_version, label, item_count, passed_count, created_at FROM eval_runs ORDER BY created_at",
  );

  if (!cmd || cmd === "runs") {
    for (const r of runsRes.rows) {
      console.log(
        `${r.created_at.toISOString()}  ${r.id}  v=${r.dataset_version}  ${r.passed_count}/${r.item_count}  label=${r.label ?? "-"}`,
      );
    }
    await pool.end();
    return;
  }

  const runId =
    runsRes.rows.find((r) => r.id.startsWith(arg ?? ""))?.id ?? (arg as string);
  const run = runsRes.rows.find((r) => r.id === runId);
  const items = cmd === "items" || cmd === "latency" ? await getItems(runId) : [];
  console.log(`# run ${runId} (${run?.dataset_version}) label="${run?.label}" ${run?.passed_count}/${run?.item_count}\n`);

  if (cmd === "items") {
    for (const it of items) {
      const cited = it.citationMarkers
        .map((n) => {
          const src = it.retrieved.find((r) => r.rank === n);
          return `[${n}]${src ? src.documentFileName.replace(/\.md$/, "") + "#" + src.chunkIndex : "?"}`;
        })
        .join(" ");
      console.log(
        `${it.pass ? "PASS" : "FAIL"}  ${it.id.padEnd(9)} ${it.category.padEnd(10)} kw=${it.metrics.keywordCoverage ?? "-"} citeP=${it.metrics.citationPrecision ?? "-"} citeR=${it.metrics.citationRecall ?? "-"} total=${it.timings.totalMs}ms llm=${it.timings.llmMs}ms tok=${it.usage?.totalTokens ?? "-"}`,
      );
      console.log(`      markers: ${cited || "(none)"}`);
      if (it.failureReasons.length > 0) console.log(`      reasons: ${it.failureReasons.join(" | ")}`);
    }
  } else if (cmd === "labels") {
    // Verify dataset v1 chunk labels against live chunk content
    const datasetPath = path.resolve(import.meta.dirname, "../../server/eval/datasets/v1.json");
    const dataset = JSON.parse(await readFile(datasetPath, "utf-8")) as {
      items: {
        id: string;
        question: string;
        expectedChunks: { fileName: string; chunkIndex: number }[];
      }[];
    };
    for (const item of dataset.items) {
      if ((item.expectedChunks?.length ?? 0) === 0) continue;
      console.log(`\n== ${item.id}: ${item.question}`);
      for (const label of item.expectedChunks) {
        const res = await pool.query<{ content: string }>(
          `SELECT c.content FROM chunks c JOIN documents d ON d.id = c.document_id
           WHERE d.file_name = $1 AND c.chunk_index = $2`,
          [label.fileName, label.chunkIndex],
        );
        if (res.rowCount === 0) {
          console.log(`  ${label.fileName}#${label.chunkIndex}: MISSING IN DB`);
        } else {
          console.log(`  ${label.fileName}#${label.chunkIndex}: ${res.rows[0].content.slice(0, 200).replace(/\n/g, " | ")}`);
        }
      }
    }
  } else if (cmd === "latency") {
    const answered = items.filter((i) => i.sufficient && i.usage);
    const totals = items.map((i) => i.timings.totalMs).sort((a, b) => a - b);
    const embeds = items.map((i) => i.timings.embedMs).sort((a, b) => a - b);
    const retrieves = items.map((i) => i.timings.retrievalMs).sort((a, b) => a - b);
    const llms = answered.map((i) => i.timings.llmMs).sort((a, b) => a - b);
    const fmt = (name: string, arr: number[]): string =>
      `p50=${pct(arr, 50)}ms p95=${pct(arr, 95)}ms max=${arr[arr.length - 1] ?? 0}ms`;
    console.log(`total    (n=${totals.length}): ${fmt("total", totals)}`);
    console.log(`embed    (n=${embeds.length}): ${fmt("embed", embeds)}`);
    console.log(`retrieve (n=${retrieves.length}): ${fmt("retrieve", retrieves)}`);
    console.log(`llm      (n=${llms.length}): ${fmt("llm", llms)}`);
    const prompt = answered.reduce((a, i) => a + (i.usage?.promptTokens ?? 0), 0);
    const completion = answered.reduce((a, i) => a + (i.usage?.completionTokens ?? 0), 0);
    console.log(
      `\ntokens over ${answered.length} answered: prompt=${prompt} completion=${completion} total=${prompt + completion}`,
    );
    console.log(
      `per answered query: prompt avg=${Math.round(prompt / answered.length)} completion avg=${Math.round(completion / answered.length)}`,
    );
  } else {
    console.error("unknown command");
  }
  await pool.end();
}

void main();
