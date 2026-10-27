import type { ChatResponse, ChatRole, EvalItemResult, RetrievedChunk } from "@rag/shared";
import type { EvalDataset, EvalItem } from "./dataset.js";
import { scoreEvalItem } from "./metrics.js";

/**
 * Pipeline surface the runner depends on. Injectable so tests can run the
 * full scoring path against fakes without network, env or DB.
 */
export interface EvalPipelineDeps {
  /** The real chat pipeline: retrieve -> threshold guard -> prompt -> answer.
   *  History carries the item's prior conversation turns (clarification suite). */
  answerQuestion: (question: string, history?: ChatRole[]) => Promise<ChatResponse>;
  /** Unthresholded top-K retrieval, used only for Recall@K / MRR ranking metrics. */
  retrieveForRanking: (question: string) => Promise<RetrievedChunk[]>;
}

export type ProgressFn = (done: number, total: number, item: EvalItem) => void;

/** A pipeline failure (e.g. persistent 429) must fail that item, not abort the run. */
function erroredItem(item: EvalItem, err: unknown): EvalItemResult {
  return {
    id: item.id,
    category: item.category,
    question: item.question,
    expectedAnswer: item.expectedAnswer,
    expectedFileNames: item.expectedFileNames,
    expectedBehavior: item.expectedBehavior,
    pass: false,
    failureReasons: [`pipeline error: ${err instanceof Error ? err.message : String(err)}`],
    failureTypes: ["pipeline_error"],
    // sufficient=true keeps abstention math honest: an errored item is NOT a successful abstention
    sufficient: true,
    generatedAnswer: "",
    model: "error",
    retrieved: [],
    ranking: null,
    citationMarkers: [],
    variantCitationMarkers: [],
    invalidMarkers: [],
    keywordHits: item.expectedKeywords.map((keyword) => ({ keyword, found: false })),
    metrics: {
      recallAt5: null,
      mrr: null,
      firstExpectedRank: null,
      chunkRecallAt5: null,
      keywordCoverage: null,
      citationPrecision: null,
      variantCitationPrecision: null,
      citationRecall: null,
    },
    timings: { embedMs: 0, retrievalMs: 0, llmMs: 0, totalMs: 0 },
    usage: null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run one dataset item through the pipeline and score it. */
export async function runItem(item: EvalItem, deps: EvalPipelineDeps): Promise<EvalItemResult> {
  const chat = await deps.answerQuestion(item.question, item.history);
  // Off-topic items carry no labels — no ranking call (and no extra embedding) needed.
  const rankingChunks =
    item.expectedFileNames.length > 0 ? await deps.retrieveForRanking(item.question) : null;
  return scoreEvalItem({ item, chat, rankingChunks });
}

/**
 * Run every item sequentially (keeps latency measurements honest, respects
 * rate limits). `delayMs` paces LLM calls so free-tier rate limits survive a
 * whole run; per-item pipeline errors are recorded as failed items.
 */
export async function runDataset(
  dataset: EvalDataset,
  deps: EvalPipelineDeps,
  onProgress?: ProgressFn,
  delayMs = 0,
): Promise<EvalItemResult[]> {
  const results: EvalItemResult[] = [];
  for (const [index, item] of dataset.items.entries()) {
    try {
      results.push(await runItem(item, deps));
    } catch (err) {
      results.push(erroredItem(item, err));
    }
    onProgress?.(index + 1, dataset.items.length, item);
    if (delayMs > 0 && index < dataset.items.length - 1) await sleep(delayMs);
  }
  return results;
}
