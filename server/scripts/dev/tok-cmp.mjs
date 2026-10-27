// Compare per-item completion tokens (which include gpt-oss reasoning tokens)
// across expected/observed behaviors — evidence for the low-deliberation RCA.
const runId = process.argv[2] ?? "603826cb-6e81-4363-8062-9121181db50a";
const r = await (await fetch(`http://127.0.0.1:4000/api/eval/runs/${runId}`)).json();
for (const it of r.items) {
  if (it.expectedBehavior) {
    console.log(
      it.id.padEnd(15),
      it.expectedBehavior.padEnd(8),
      String(it.observedBehavior ?? "-").padEnd(14),
      ("pass=" + it.pass).padEnd(11),
      "completionTok=" + String(it.usage?.completionTokens ?? "-").padEnd(5),
      "llmMs=" + Math.round(it.timings.llmMs),
    );
  }
}
