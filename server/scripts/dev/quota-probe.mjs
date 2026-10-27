// One-off Gemini embed quota probe: 200 = key valid + quota available; 429 = exhausted.
import { readFileSync } from "node:fs";

const envText = readFileSync(new URL("../../.env", import.meta.url), "utf-8");
const key = envText.match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) {
  console.error("no GEMINI_API_KEY in server/.env");
  process.exit(1);
}

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent`,
  {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text: "quota probe" }] },
      outputDimensionality: 768,
    }),
  },
);
console.log("status:", res.status);
if (res.status === 429) {
  const body = await res.text();
  console.error("QUOTA EXHAUSTED:", body.slice(0, 400));
} else {
  const json = await res.json();
  console.log("embedding dims:", json.embedding?.values?.length ?? "?", "— key OK, quota available");
}
