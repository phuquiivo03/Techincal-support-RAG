import type { ChatResponse, ChatRole, Citation } from "@rag/shared";
import { env } from "../../config/env.js";
import { chatCompletion, type LlmMessage } from "../../providers/llm.js";
import { buildContext, retrieve } from "../retrieval/service.js";
import { buildUserMessage, INSUFFICIENT_ANSWER, SYSTEM_PROMPT } from "./prompt.js";

const HISTORY_TURNS = 6; // last N messages sent back for conversational context
const SNIPPET_LENGTH = 240;

function roundMs(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/**
 * RAG pipeline: retrieve → (threshold guard) → prompt → answer.
 * When nothing clears the similarity threshold we skip the LLM entirely and
 * return a distinct sufficient=false response.
 */
export async function answerQuestion(question: string, history: ChatRole[] = []): Promise<ChatResponse> {
  const t0 = performance.now();
  const retrieval = await retrieve(question);
  const timings = {
    embedMs: retrieval.timings.embedMs,
    retrievalMs: retrieval.timings.retrievalMs,
    llmMs: 0,
    totalMs: 0,
  };

  if (retrieval.results.length === 0) {
    return {
      answer: INSUFFICIENT_ANSWER,
      sufficient: false,
      sources: [],
      timings: { ...timings, totalMs: roundMs(performance.now() - t0) },
      model: "none (no relevant context found)",
    };
  }

  const context = buildContext(retrieval.results);
  const messages: LlmMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: buildUserMessage(question, context) },
  ];

  const t1 = performance.now();
  const answer = await chatCompletion(messages);
  timings.llmMs = roundMs(performance.now() - t1);
  timings.totalMs = roundMs(performance.now() - t0);

  const sources: Citation[] = retrieval.results.map((r) => ({
    index: r.rank,
    chunkId: r.chunkId,
    documentId: r.documentId,
    documentTitle: r.documentTitle,
    score: r.score,
    snippet:
      r.content.length > SNIPPET_LENGTH ? `${r.content.slice(0, SNIPPET_LENGTH)}…` : r.content,
  }));

  return { answer, sufficient: true, sources, timings, model: env.LLM_MODEL };
}
