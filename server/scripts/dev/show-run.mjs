// Dev helper: print generated answers for the failing items of a stored eval run.
// Usage: node scripts/dev/show-run.mjs <runId> [all]
const runId = process.argv[2];
const showAll = process.argv[3] === "all";
if (!runId) {
  console.error("usage: node scripts/dev/show-run.mjs <runId> [all]");
  process.exit(1);
}

const res = await fetch(`http://127.0.0.1:4000/api/eval/runs/${runId}`);
if (!res.ok) {
  console.error(`API ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const run = await res.json();
for (const item of run.items) {
  if (!showAll && item.pass) continue;
  console.log(`===== ${item.id} [${item.category}] exp=${item.expectedBehavior ?? "-"} obs=${item.observedBehavior ?? "-"} pass=${item.pass}`);
  if (item.failureReasons.length > 0) for (const r of item.failureReasons) console.log(`  ↳ ${r}`);
  console.log(item.generatedAnswer.slice(0, 1200));
  console.log();
}
