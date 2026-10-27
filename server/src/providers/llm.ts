import type { TokenUsage } from "@rag/shared";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";
import { fetchWithRetry } from "./http.js";

const API_URL = "https://api.groq.com/openai/v1/chat/completions";
const RETRIES = 5;

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionResult {
  content: string;
  usage: TokenUsage | null;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message: string };
}

/** Chat completion via Groq's OpenAI-compatible endpoint. */
export async function chatCompletion(messages: LlmMessage[]): Promise<string> {
  return (await chatCompletionDetailed(messages)).content;
}

/** Same call, but also returns token usage (used by chat responses and the eval module). */
export async function chatCompletionDetailed(messages: LlmMessage[]): Promise<ChatCompletionResult> {
  // gpt-oss reasoning models: "low" emits ~20 reasoning tokens — enough to draft an
  // answer, NOT enough to run the chat pipeline's INTERNAL DECISION CHECK (the
  // clarification eval proved flat prompt rules are read but never executed at
  // low effort: recall stuck at 0.33 across v1/v2 prompts while the successful
  // clarify items coincided with heterogeneous multi-doc retrieval). "medium"
  // gives the decision procedure compute. Reasoning tokens share the completion
  // budget, so the ceiling rises too (a declared BEHAVIOR with a truncated body
  // is worse than a longer answer).
  const body: Record<string, unknown> = {
    model: env.LLM_MODEL,
    messages,
    temperature: 0.6,
    max_completion_tokens: 3072,
  };
  if (env.LLM_MODEL.startsWith("openai/")) body.reasoning_effort = "medium";

  const res = await fetchWithRetry({
    url: API_URL,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body,
    timeoutMs: 60_000,
    retries: RETRIES,
    backoffMs: (attempt) => 800 * 2 ** attempt,
    // Free-tier 429s carry a retry-after — honor it instead of hammering
    retryAfterMs: (res) => {
      if (res.status !== 429) return null;
      const retryAfterSec = Number(res.headers.get("retry-after"));
      return Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.min((retryAfterSec + 0.5) * 1000, 90_000)
        : null;
    },
    label: "Groq chat",
  });

  const json = (await res.json()) as ChatCompletionResponse;
  if (!res.ok) {
    throw new Error(`Groq error (${res.status}): ${json.error?.message ?? "unknown"}`);
  }
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned an empty completion");
  const u = json.usage;
  return {
    content,
    usage:
      u && typeof u.total_tokens === "number"
        ? {
            promptTokens: u.prompt_tokens ?? 0,
            completionTokens: u.completion_tokens ?? 0,
            totalTokens: u.total_tokens,
          }
        : null,
  };
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
