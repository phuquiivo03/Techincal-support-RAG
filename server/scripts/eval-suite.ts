import { env } from "../src/config/env.js";
import { migrate } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { loadDataset } from "../src/modules/evaluation/dataset.js";
import { runEvaluation } from "../src/modules/evaluation/service.js";

/**
 * Full evaluation suite: runs the versioned dataset through the real
 * retrieval + generation pipeline, prints per-item results and aggregate
 * metrics, and stores the run for the /eval dashboard.
 *
 * Usage:
 *   npm run eval:suite                              # dataset v1
 *   npm run eval:suite -- --dataset v1 --label "after prompt tweak"
 */

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const datasetVersion = arg("dataset") ?? "v1";
  const label = arg("label");

  await migrate(pool);
  // Fail fast with a clear message if the dataset itself is broken.
  const dataset = await loadDataset(datasetVersion);
  console.log(
    `Running evaluation suite "${dataset.version}" — ${dataset.items.length} items ` +
      `(${[...new Set(dataset.items.map((i) => i.category))].join("/")}) through the live pipeline`,
  );
  console.log(`config: topK=${env.DEFAULT_TOP_K} threshold=${env.SIMILARITY_THRESHOLD} llm=${env.LLM_MODEL}\n`);

  const run = await runEvaluation({ datasetVersion, label });

  for (const item of run.items) {
    const status = item.pass ? "PASS" : "FAIL";
    const bits: string[] = [status, item.id, `[${item.category}]`];
    if (item.expectedBehavior) bits.push(`exp=${item.expectedBehavior}`);
    if (item.observedBehavior) bits.push(`obs=${item.observedBehavior}`);
    if (item.expectedFileNames.length > 0) {
      bits.push(`recall@5=${item.metrics.recallAt5 ?? "-"}`, `mrr=${item.metrics.mrr ?? "-"}`);
    }
    if (item.sufficient) {
      bits.push(`kw=${item.metrics.keywordCoverage ?? "-"}`, `cite=${item.metrics.citationPrecision ?? "-"}`);
    } else {
      bits.push("abstained");
    }
    bits.push(`${item.timings.totalMs.toFixed(0)}ms`);
    console.log(`  ${bits.join("  ")}`);
    if (!item.pass) {
      for (const reason of item.failureReasons) console.log(`      ↳ ${reason}`);
    }
  }

  const m = run.metrics;
  console.log(`\nAggregate (dataset ${run.datasetVersion}, run ${run.id}):`);
  console.log(`  pass rate        ${m.passed}/${m.items} (${(m.passRate * 100).toFixed(1)}%)`);
  console.log(`  retrieval        recall@5=${m.retrieval.recallAt5 ?? "n/a"} · MRR=${m.retrieval.mrr ?? "n/a"} · chunkRecall@5=${m.retrieval.chunkRecallAt5 ?? "n/a"}`);
  console.log(`  answers          keywordCoverage=${m.answers.keywordCoverage ?? "n/a"} · citationPrecision=${m.answers.citationPrecision ?? "n/a"} · citationRecall=${m.answers.citationRecall ?? "n/a"}`);
  console.log(`  abstention       ${m.abstention.abstained}/${m.abstention.offTopicItems} off-topic rejected (${m.abstention.abstentionRate ?? "n/a"}) · false abstentions: ${m.answers.falseAbstentions}`);
  if (m.behaviorDecisions) {
    const d = m.behaviorDecisions;
    console.log(
      `  decisions        clarify precision=${d.clarificationPrecision ?? "n/a"} · recall=${d.clarificationRecall ?? "n/a"}` +
        ` (${d.clarifyCorrect}/${d.clarifyExpected} expected, ${d.clarifyObserved} asked)` +
        ` · correct behavior ${(d.correctBehaviorRate * 100).toFixed(1)}%` +
        ` · unnecessary clarifications: ${d.unnecessaryClarifications} · false answers on clarify: ${d.falseAnswersOnClarify}`,
    );
  }
  console.log(`  latency (avg)    embed ${m.latency.avgEmbedMs}ms · pgvector ${m.latency.avgRetrievalMs}ms · llm ${m.latency.avgLlmMs}ms · total ${m.latency.avgTotalMs}ms`);
  console.log(`  tokens           prompt ${m.tokens.promptTokens} · completion ${m.tokens.completionTokens} · total ${m.tokens.totalTokens} (${m.tokens.answeredItems} LLM answers)`);
  console.log(`\nStored. View it on the dashboard: http://localhost:3000/eval (run id ${run.id})`);

  await pool.end();
}

main().catch((err) => {
  console.error("eval suite failed:", err);
  process.exit(1);
});
