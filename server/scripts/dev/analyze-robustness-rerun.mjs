// Analyze the quota-poisoned robustness rerun: behaviorDecisions over eligible
// items + per-item detail for the clarify cases (rb-under-*).
const runs = await (await fetch("http://127.0.0.1:4000/api/eval/runs?suite=robustness")).json();
const run = runs.runs.find((r) => r.label?.includes("18 groq-429"));
if (!run) {
  console.error("run not found");
  process.exit(1);
}
const detail = await (await fetch(`http://127.0.0.1:4000/api/eval/runs/${run.id}`)).json();
const d = detail.metrics.behaviorDecisions;
console.log(`RUN ${run.id.slice(0, 8)} · pass ${detail.metrics.passed}/${detail.metrics.items}`);
console.log(`behaviorDecisions: eligible=${d?.eligibleItems} pipelineErrors=${d?.pipelineErrors} clarify P=${d?.clarificationPrecision} R=${d?.clarificationRecall} correct=${d?.correctBehaviorRate} unnecessary=${d?.unnecessaryClarifications}`);
console.log(`byFailureType: ${JSON.stringify(detail.metrics.byFailureType)}`);
for (const it of detail.items.filter((i) => i.id.startsWith("rb-under") || (i.expectedBehavior === "clarify" && i.model !== "error"))) {
  console.log(`\n${it.id} exp=${it.expectedBehavior} obs=${it.observedBehavior ?? "(error)"} pass=${it.pass} [${it.category}]`);
  if (it.model === "error") console.log("  PIPELINE ERROR (excluded from decisions)");
  else console.log("  " + (it.generatedAnswer || "").split("\n").slice(0, 3).join(" ").slice(0, 300));
}
// how many eligible items were non-error and their observed behaviors overall
const eligible = detail.items.filter((i) => i.model !== "error");
console.log(`\neligible ${eligible.length}: ${eligible.map((i) => `${i.id}=${i.observedBehavior ?? "?"}${i.pass ? "✓" : "✗"}`).join(" ")}`);
