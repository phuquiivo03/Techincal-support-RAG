import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../src/config/env.js";
import { migrate } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { retrieve } from "../src/modules/retrieval/service.js";

interface GoldenItem {
  question: string;
  expectedTitle: string | null;
}

const EVAL_DIR = path.resolve(import.meta.dirname, "..", "eval");
const THRESHOLDS = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65];

function pct(n: number, total: number): string {
  return `${Math.round((n / total) * 100)}%`;
}

async function main(): Promise<void> {
  await migrate(pool);

  const golden = JSON.parse(await readFile(path.join(EVAL_DIR, "golden.json"), "utf-8")) as GoldenItem[];
  const onTopic = golden.filter((g) => g.expectedTitle !== null);
  const offTopic = golden.filter((g) => g.expectedTitle === null);
  console.log(`Evaluating retrieval on ${onTopic.length} on-topic + ${offTopic.length} off-topic questions (topK=5)\n`);

  interface RunResult {
    question: string;
    expected: string | null;
    docRank: number; // rank of expected doc among distinct docs; 0 = not found
    scores: number[]; // similarity per returned chunk
    docOfChunk: string[];
    embedMs: number;
    retrievalMs: number;
  }

  const runs: RunResult[] = [];
  for (const item of golden) {
    const res = await retrieve(item.question, { topK: 5, threshold: 0 });
    // rank distinct documents by first appearance among the returned chunks
    const seen: string[] = [];
    for (const r of res.results) {
      if (!seen.includes(r.documentTitle)) seen.push(r.documentTitle);
    }
    runs.push({
      question: item.question,
      expected: item.expectedTitle,
      docRank: item.expectedTitle ? seen.indexOf(item.expectedTitle) + 1 : 0,
      scores: res.results.map((r) => r.score),
      docOfChunk: res.results.map((r) => r.documentTitle),
      embedMs: res.timings.embedMs,
      retrievalMs: res.timings.retrievalMs,
    });
    const tag = item.expectedTitle
      ? `rank ${runs[runs.length - 1].docRank || "-"}`
      : `top score ${res.results[0]?.score.toFixed(2) ?? "-"}`;
    console.log(`  [${item.expectedTitle ? "on " : "off"}] ${tag.padEnd(14)} ${item.question.slice(0, 64)}…`);
  }

  // ---- ranking metrics (threshold-independent) ----
  const onRuns = runs.filter((r) => r.expected !== null);
  const hit1 = onRuns.filter((r) => r.docRank === 1).length;
  const hit3 = onRuns.filter((r) => r.docRank >= 1 && r.docRank <= 3).length;
  const mrr = onRuns.reduce((acc, r) => acc + (r.docRank >= 1 ? 1 / r.docRank : 0), 0) / onRuns.length;
  const avgEmbed = runs.reduce((a, r) => a + r.embedMs, 0) / runs.length;
  const avgRetrieve = runs.reduce((a, r) => a + r.retrievalMs, 0) / runs.length;

  console.log(`\nRetrieval quality (ranking):`);
  console.log(`  hit@1 = ${hit1}/${onRuns.length} (${pct(hit1, onRuns.length)})`);
  console.log(`  hit@3 = ${hit3}/${onRuns.length} (${pct(hit3, onRuns.length)})`);
  console.log(`  MRR   = ${mrr.toFixed(3)}`);
  console.log(`  avg latency: embed ${avgEmbed.toFixed(0)} ms · pgvector ${avgRetrieve.toFixed(0)} ms`);

  // ---- threshold sweep: on-topic coverage vs off-topic rejection ----
  console.log(`\nThreshold sweep (on-topic: expected doc present above threshold · off-topic: no chunk above threshold):`);
  const sweepRows: { t: number; coverage: string; rejection: string }[] = [];
  for (const t of THRESHOLDS) {
    const covered = onRuns.filter(
      (r) => r.scores.some((s, i) => s >= t && r.docOfChunk[i] === r.expected),
    ).length;
    const rejected = runs.filter((r) => r.expected === null && !r.scores.some((s) => s >= t)).length;
    sweepRows.push({
      t,
      coverage: `${covered}/${onRuns.length} (${pct(covered, onRuns.length)})`,
      rejection: `${rejected}/${offTopic.length} (${pct(rejected, offTopic.length)})`,
    });
    console.log(`  t=${t.toFixed(2)}  on-topic coverage ${sweepRows.at(-1)!.coverage.padEnd(14)} off-topic rejection ${sweepRows.at(-1)!.rejection}`);
  }

  const current = sweepRows.find((r) => r.t === env.SIMILARITY_THRESHOLD);
  if (current) {
    console.log(`\nCurrent SIMILARITY_THRESHOLD=${env.SIMILARITY_THRESHOLD} → coverage ${current.coverage}, rejection ${current.rejection}`);
  }

  // ---- write baseline file ----
  const lines = [
    `# Retrieval eval baseline`,
    ``,
    `Run: ${new Date().toISOString()} · embedding=${env.EMBEDDING_MODEL}(${env.EMBEDDING_DIM}d) · topK=5`,
    ``,
    `| Metric | Value |`,
    `| --- | --- |`,
    `| hit@1 | ${pct(hit1, onRuns.length)} (${hit1}/${onRuns.length}) |`,
    `| hit@3 | ${pct(hit3, onRuns.length)} (${hit3}/${onRuns.length}) |`,
    `| MRR | ${mrr.toFixed(3)} |`,
    `| avg embed latency | ${avgEmbed.toFixed(0)} ms |`,
    `| avg pgvector latency | ${avgRetrieve.toFixed(0)} ms |`,
    ``,
    `| Threshold | On-topic coverage | Off-topic rejection |`,
    `| --- | --- | --- |`,
    ...sweepRows.map((r) => `| ${r.t.toFixed(2)} | ${r.coverage} | ${r.rejection} |`),
    ``,
  ];
  await writeFile(path.join(EVAL_DIR, "RESULTS.md"), lines.join("\n"), "utf-8");
  console.log(`\nBaseline written to server/eval/RESULTS.md`);

  await pool.end();
}

main().catch((err) => {
  console.error("eval failed:", err);
  process.exit(1);
});
