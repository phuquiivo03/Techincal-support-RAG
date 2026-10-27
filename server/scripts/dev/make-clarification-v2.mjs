// One-off: create clarification-v2 from clarification-v1 — label widening only
// (caveatKeywords on two clarify items), everything else byte-identical.
import { readFileSync, writeFileSync } from "node:fs";

const d = JSON.parse(readFileSync(new URL("../../eval/datasets/clarification-v1.json", import.meta.url), "utf8"));
d.version = "clarification-v2";
d.description =
  "Clarification decision suite, label-widening revision of clarification-v1 (2026-10-25). Items, questions, expected behaviors, histories, answer keywords and forbidden terms are IDENTICAL to v1 - only caveatKeywords on two clarify items were widened to phrasing-robust discriminators of the same missing detail (cl-conflict-001 also accepts the guidance/runbook/30s/300s vocabulary a correct follow-up naturally uses; cl-amb-002 also accepts the candidate-symptom vocabulary). Observed-behavior comparisons across v1/v2 datasets remain apples-to-apples.";
for (const it of d.items) {
  if (it.id === "cl-conflict-001") it.caveatKeywords = ["workload", "which", "oltp", "reporting", "guidance", "runbook", "30s", "300s"];
  if (it.id === "cl-amb-002") it.caveatKeywords = ["what", "which", "symptom", "problem", "warnings", "latency", "eviction", "maxmemory"];
}
writeFileSync(new URL("../../eval/datasets/clarification-v2.json", import.meta.url), JSON.stringify(d, null, 2) + "\n");
console.log("written", d.version, d.items.length, "items");
