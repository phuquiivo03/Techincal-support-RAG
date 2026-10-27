// One-off: send a Groq chat request at eval-item size (~2.5k prompt tokens) and
// print status, rate-limit headers and any error body — decides whether big
// requests 429 while tiny probes pass.
import { readFileSync } from "node:fs";

const key = readFileSync(new URL("../../.env", import.meta.url), "utf-8")
  .match(/^GROQ_API_KEY=(.+)$/m)?.[1]?.trim();

const filler = "Context block: the PostgreSQL connection pool exhausted incident. ".repeat(45); // ~2.5k chars ≈ 700 tok ×3
const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: "openai/gpt-oss-120b",
    messages: [
      { role: "system", content: "You answer strictly from the context. Cite blocks as [n]." },
      { role: "user", content: `${filler}\n\nQuestion: summarize the fix in one sentence.` },
    ],
    temperature: 0.6,
    max_completion_tokens: 2048,
    reasoning_effort: "low",
  }),
});
console.log("status:", res.status);
for (const [name, value] of res.headers) {
  if (name.startsWith("x-ratelimit") || name === "retry-after") console.log(`${name}: ${value}`);
}
const json = await res.json();
if (json.error) console.log("error:", json.error.message?.slice(0, 300));
else console.log("ok:", json.choices?.[0]?.message?.content?.slice(0, 80));
