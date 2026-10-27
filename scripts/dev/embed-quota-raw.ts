import "dotenv/config";
import { readFileSync } from "node:fs";

// Print ONLY the upstream JSON error body (never the API key). Run from server/ cwd.
const envFile = readFileSync(".env", "utf-8");
const key = envFile.split("\n").find((l) => l.startsWith("GEMINI_API_KEY="))!.split("=")[1].trim();

async function main(): Promise<void> {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents",
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        requests: [
          {
            model: "models/gemini-embedding-001",
            content: { parts: [{ text: "quota probe" }] },
            outputDimensionality: 768,
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  console.log("status:", res.status);
  console.log("retry-after:", res.headers.get("retry-after"));
  console.log("body:", (await res.text()).slice(0, 400));
}

void main();
