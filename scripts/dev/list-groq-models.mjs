// List available Groq models using the key from server/.env (avoids shell quoting issues)
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../../server/.env", import.meta.url), "utf-8");
const key = env.match(/^GROQ_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("GROQ_API_KEY not found in server/.env");

const res = await fetch("https://api.groq.com/openai/v1/models", {
  headers: { authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(30_000),
});
const json = await res.json();
if (!res.ok) {
  console.log(`ERROR ${res.status}:`, JSON.stringify(json).slice(0, 300));
  process.exit(1);
}
for (const m of json.data) console.log(m.id, m.owned_by ?? "");
