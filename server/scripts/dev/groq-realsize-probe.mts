// Real-sized Groq probe: the ACTUAL system prompt + a realistic context payload
// (~2.5k tokens), mirroring one eval item. 200 = the TPM window has drained.
import { readFileSync } from "node:fs";
import { SYSTEM_PROMPT } from "../../src/modules/chat/prompt.js";

const key = readFileSync(new URL("../../.env", import.meta.url), "utf-8")
  .match(/^GROQ_API_KEY=(.+)$/m)?.[1]?.trim();

const block = (n) =>
  `[${n}] (postgres-pool-exhaustion.md, score 0.79)\nERROR: too many clients already (SQLSTATE 53300). The application's connection pool is exhausted — every connection is checked out and held, so new queries queue forever. Pool size larger than the server can serve; connection leaks where a code path takes a client from the pool and never releases it; forked processes each open their own pool. Size pools realistically: for a small managed instance a pool max of 5-10 per process is usually plenty. Always release clients with a helper that guarantees release. Forked processes each open their own pool (PM2 cluster mode with 8 workers x pool of 20 = 160 connections).`;

const context = Array.from({ length: 5 }, (_, i) => block(i + 1)).join("\n\n");
const userMsg = `Context blocks from the knowledge base:\n\n<context>\n${context}\n</context>\n\nQuestion: Our API throws too many clients already. How do we fix it?\n\nFirst run the DECISION PROCEDURE from your instructions against this question and the blocks above, then reply starting with the BEHAVIOR line.`;

const t0 = Date.now();
const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: "openai/gpt-oss-120b",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ],
    temperature: 0.6,
    max_completion_tokens: 2048,
    reasoning_effort: "low",
  }),
});
console.log(`status: ${res.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const json = await res.json();
if (json.error) {
  console.log("error:", json.error.message?.slice(0, 300));
  console.log("error code:", json.error.code);
} else {
  const content = json.choices?.[0]?.message?.content ?? "";
  console.log("usage:", JSON.stringify(json.usage));
  console.log("first line:", content.split("\n")[0]);
}
