// Full forensic dump for selected items of a stored run: question + history,
// the EXACT context blocks the model saw (rank/title/score/snippet), the
// generated answer, observed behavior, failure reasons and token usage.
// Usage: node scripts/dev/dump-forensic.mjs <runId> <itemId> [<itemId>...]
const runId = process.argv[2];
const ids = process.argv.slice(3);
if (!runId || ids.length === 0) {
  console.error("usage: node scripts/dev/dump-forensic.mjs <runId> <itemId>...");
  process.exit(1);
}
const res = await fetch(`http://127.0.0.1:4000/api/eval/runs/${runId}`);
if (!res.ok) {
  console.error(`API ${res.status}`);
  process.exit(1);
}
const run = await res.json();
console.log(`RUN ${run.id} · ${run.label} · ${run.config.llmModel} · threshold ${run.config.threshold}`);
for (const id of ids) {
  const it = run.items.find((i) => i.id === id);
  if (!it) {
    console.log(`\n##### ${id}: not in run`);
    continue;
  }
  console.log(`\n##### ${it.id} [${it.category}] expected=${it.expectedBehavior} observed=${it.observedBehavior} pass=${it.pass}`);
  console.log(`QUESTION: ${it.question}`);
  console.log(`ANSWER:\n${it.generatedAnswer}`);
  if (it.failureReasons.length) console.log(`FAIL REASONS: ${it.failureReasons.join(" | ")}`);
  console.log(`USAGE: ${JSON.stringify(it.usage)} · llm ${it.timings.llmMs}ms`);
  console.log(`RETRIEVED TOP-${it.retrieved.length}:`);
  for (const c of it.retrieved) {
    console.log(`  #${c.rank} ${c.documentFileName}#${c.chunkIndex} score=${c.score.toFixed(3)} expected=${c.expected}`);
    console.log(`     ${c.snippet.replace(/\n/g, " ").slice(0, 180)}`);
  }
}
