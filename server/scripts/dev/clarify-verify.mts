// Run selected dataset items through the REAL pipeline (question + history from
// the dataset JSON — no hardcoded wording) and report observed vs expected
// behavior. Usage: npx tsx scripts/dev/clarify-verify.mts <itemIds...>
import { readFileSync } from "node:fs";
import { answerQuestion } from "../../src/modules/chat/service.js";
import type { ChatRole } from "@rag/shared";

const dataset = JSON.parse(
  readFileSync(new URL("../../eval/datasets/clarification-v1.json", import.meta.url), "utf-8"),
);
const byId = new Map(dataset.items.map((i: { id: string }) => [i.id, i]));
const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error("usage: npx tsx scripts/dev/clarify-verify.mts <itemIds...>");
  process.exit(1);
}

for (const id of ids) {
  const item = byId.get(id);
  if (!item) {
    console.log(`\n=== ${id}: no such item`);
    continue;
  }
  const t0 = Date.now();
  try {
    const res = await answerQuestion(item.question, (item.history ?? []) as ChatRole[]);
    const ok = (res.behavior ?? "answer") === item.expectedBehavior ||
      (item.expectedBehavior === "partial" && res.behavior === "partial_answer");
    console.log(`\n=== ${id} expected=${item.expectedBehavior} observed=${res.behavior} [${ok ? "OK" : "MISMATCH"}] (${((Date.now() - t0) / 1000).toFixed(0)}s, completionTok=${res.usage?.completionTokens ?? "-"}))`);
    console.log(res.answer.split("\n").slice(0, 4).join("\n").slice(0, 450));
  } catch (err) {
    console.log(`\n=== ${id} FAILED: ${err instanceof Error ? err.message : err}`);
  }
}
process.exit(0);
