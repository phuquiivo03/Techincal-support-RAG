// Dump the 4 failing clarification items (question + history + generated answer)
// from one or two stored runs, for side-by-side prompt-version comparison.
// Usage: node scripts/dev/dump-clar-fails.mjs <runIdV1> <runIdV2>
const ids = ["cl-amb-002", "cl-amb-003", "cl-conflict-001", "cl-ctx-002"];
const runs = process.argv.slice(2);
if (runs.length === 0) {
  console.error("usage: node scripts/dev/dump-clar-fails.mjs <runId> [<runId2>]");
  process.exit(1);
}

const data = {};
for (const runId of runs) {
  const res = await fetch(`http://127.0.0.1:4000/api/eval/runs/${runId}`);
  if (!res.ok) {
    console.error(`run ${runId}: API ${res.status}`);
    process.exit(1);
  }
  const run = await res.json();
  console.log(`\n########## RUN ${runId} · ${run.label} · ${run.datasetVersion} ##########`);
  for (const id of ids) {
    const item = run.items.find((i) => i.id === id);
    if (!item) {
      console.log(`\n===== ${id}: NOT IN RUN`);
      continue;
    }
    console.log(`\n===== ${id} [${item.category}] expected=${item.expectedBehavior} observed=${item.observedBehavior} pass=${item.pass}`);
    if (item.failureReasons.length > 0) for (const r of item.failureReasons) console.log(`  ↳ ${r}`);
    console.log("---- generated answer (directive line already stripped by the server) ----");
    console.log(item.generatedAnswer.slice(0, 2200));
  }
}
