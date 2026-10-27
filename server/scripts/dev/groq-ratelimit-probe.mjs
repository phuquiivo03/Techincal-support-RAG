// Groq rate-limit probe: one tiny chat call, print the x-ratelimit-* headers.
import { readFileSync } from "node:fs";

const key = readFileSync(new URL("../../.env", import.meta.url), "utf-8")
  .match(/^GROQ_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) {
  console.error("no GROQ_API_KEY in server/.env");
  process.exit(1);
}

const t0 = Date.now();
const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: "openai/gpt-oss-120b",
    messages: [{ role: "user", content: "Reply with the single word: ok" }],
    max_completion_tokens: 16,
  }),
});
console.log("status:", res.status, `(${Date.now() - t0}ms)`);
for (const [name, value] of res.headers) {
  if (name.startsWith("x-ratelimit") || name === "retry-after") {
    console.log(`${name}: ${value}`);
  }
}
const json = await res.json();
if (json.error) console.log("error:", json.error.message?.slice(0, 200));
else console.log("completion ok:", json.choices?.[0]?.message?.content?.slice(0, 40));
