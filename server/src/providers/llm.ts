import { env } from "../config/env.js";
import { log } from "../lib/logger.js";

const API_URL = "https://api.groq.com/openai/v1/chat/completions";
const RETRIES = 3;

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message: string };
}

/** Chat completion via Groq's OpenAI-compatible endpoint. */
export async function chatCompletion(messages: LlmMessage[]): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      // gpt-oss reasoning models: keep answers fast + within budget
      const body: Record<string, unknown> = {
        model: env.LLM_MODEL,
        messages,
        temperature: 0.6,
        max_completion_tokens: 2048,
      };
      if (env.LLM_MODEL.startsWith("openai/")) body.reasoning_effort = "low";

      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });

      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`Groq responded ${res.status}`);
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
        continue;
      }

      const json = (await res.json()) as ChatCompletionResponse;
      if (!res.ok) {
        throw new Error(`Groq error (${res.status}): ${json.error?.message ?? "unknown"}`);
      }
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error("Groq returned an empty completion");
      return content;
    } catch (err) {
      lastErr = err;
      if (err instanceof Error && err.message.startsWith("Groq error")) throw err; // non-retryable
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    }
  }
  throw new Error(`Groq chat failed after ${RETRIES} attempts: ${String(lastErr)}`);
}

/** Cheap connectivity + auth check used by /api/health. */
export async function checkLlm(): Promise<boolean> {
  try {
    const reply = await chatCompletion([{ role: "user", content: "Reply with the single word: ok" }]);
    return reply.trim().length > 0;
  } catch (err) {
    log.warn("llm health check failed", err instanceof Error ? err.message : err);
    return false;
  }
}
