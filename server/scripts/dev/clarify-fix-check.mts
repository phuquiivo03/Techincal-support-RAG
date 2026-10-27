// Diagnostic: push the 4 previously-failing clarification cases through the REAL
// pipeline (answerQuestion) and print the parsed behavior — cheap (≈8k tokens)
// evidence of whether the decision-procedure prompt fixes the false answers,
// before committing to a full stored eval run.
import { answerQuestion } from "../../src/modules/chat/service.js";
import type { ChatRole } from "@rag/shared";

const ctx002History: ChatRole[] = [
  {
    role: "user",
    content:
      "Nginx returns 502 Bad Gateway intermittently. The error log shows 'upstream prematurely closed connection' while reading the response.",
  },
  {
    role: "assistant",
    content:
      "That signature means the upstream closed the connection mid-response — classically an app restart or an idle-keepalive mismatch between Nginx and the app, not a slow endpoint [1].",
  },
];

const cases: Array<{ id: string; expect: string; question: string; history?: ChatRole[] }> = [
  { id: "cl-amb-002", expect: "clarify", question: "Redis is struggling in production. Which settings should we change?" },
  { id: "cl-amb-003", expect: "clarify", question: "Nginx is returning 502 for some requests. What should I change in the config?" },
  { id: "cl-conflict-001", expect: "clarify", question: "What value should we set statement_timeout to on the cluster?" },
  { id: "cl-ctx-002", expect: "answer", question: "Which Nginx directive should I change first to fix these 502s, and what does it do?", history: ctx002History },
];

for (const c of cases) {
  const t0 = Date.now();
  try {
    const res = await answerQuestion(c.question, c.history ?? []);
    const mark = (res.behavior ?? "answer") === c.expect ? "OK" : "MISMATCH";
    console.log(`\n=== ${c.id} expect=${c.expect} observed=${res.behavior} [${mark}] (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    console.log(res.answer.split("\n").slice(0, 5).join("\n").slice(0, 600));
  } catch (err) {
    console.log(`\n=== ${c.id} FAILED: ${err instanceof Error ? err.message : err}`);
  }
}
process.exit(0);
