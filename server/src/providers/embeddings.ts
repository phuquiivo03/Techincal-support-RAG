import { env } from "../config/env.js";
import { log } from "../lib/logger.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

const MAX_BATCH = 50; // texts per batchEmbedContents call
const RETRIES = 3;

interface EmbedResponse {
  embeddings?: { values: number[] }[];
  error?: { message: string; status: string };
}

async function postJson(url: string, body: unknown, apiKey: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      // Retry transient failures only
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`Gemini API responded ${res.status}`);
        await sleep(500 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw new Error(`Gemini embeddings failed after ${RETRIES} attempts: ${String(lastErr)}`);
}

/**
 * Embed texts with Gemini (gemini-embedding-001, outputDimensionality = env.EMBEDDING_DIM).
 * Returns one vector per input text, in order.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const body = {
      requests: batch.map((text) => ({
        model: `models/${env.EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: env.EMBEDDING_DIM,
      })),
    };

    const res = await postJson(`${API_BASE}/models/${env.EMBEDDING_MODEL}:batchEmbedContents`, body, env.GEMINI_API_KEY);
    const json = (await res.json()) as EmbedResponse;

    if (!res.ok || !json.embeddings) {
      throw new Error(`Gemini embeddings error (${res.status}): ${json.error?.message ?? "unknown"}`);
    }
    if (json.embeddings.length !== batch.length) {
      throw new Error(`Gemini returned ${json.embeddings.length} embeddings for ${batch.length} texts`);
    }
    for (const e of json.embeddings) out.push(e.values);
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Cheap connectivity + auth check used by /api/health. */
export async function checkEmbeddings(): Promise<boolean> {
  try {
    const [vec] = await embedTexts(["health check"]);
    return vec.length === env.EMBEDDING_DIM;
  } catch (err) {
    log.warn("embeddings health check failed", err instanceof Error ? err.message : err);
    return false;
  }
}
