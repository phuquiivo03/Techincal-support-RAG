/**
 * API contract shared between the Express server and the Next.js web app.
 * Server returns these shapes; web consumes them. Keep in sync with reality.
 */

export type SourceType = "pdf" | "md" | "txt";

export interface DocumentSummary {
  id: string;
  title: string;
  sourceType: SourceType;
  fileName: string;
  charCount: number;
  chunkCount: number;
  createdAt: string;
}

export interface KnowledgeBaseStats {
  documents: number;
  chunks: number;
  lastUpdated: string | null;
}

export interface ChatRole {
  role: "user" | "assistant";
  content: string;
}

export interface Citation {
  /** 1-based [n] marker the model used in the answer text */
  index: number;
  /** 0-based chunk position within the document (display/debugging aid) */
  chunkIndex?: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentFileName?: string;
  score: number;
  snippet: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface Timings {
  embedMs: number;
  retrievalMs: number;
  llmMs: number;
  totalMs: number;
}

/**
 * What the assistant DID with a question (chat pipeline output, 2026-10-25):
 * - answer:         specific enough + grounded — full cited response
 * - clarify:        essential detail missing and interpretations diverge — asks
 *                   ONE targeted follow-up instead of guessing
 * - partial_answer: answers the covered part with citations and names the gap
 * - abstain:        no LLM call (retrieval gate) or explicit not-covered refusal
 * Legacy responses (pre-2026-10-25 stored runs) have no behavior field.
 */
export type ChatBehavior = "answer" | "clarify" | "partial_answer" | "abstain";

export interface ChatResponse {
  answer: string;
  /** false when no chunk cleared the similarity threshold — no LLM was called */
  sufficient: boolean;
  /** which behavior the pipeline decided on (added 2026-10-25; absent on stored legacy responses) */
  behavior?: ChatBehavior;
  sources: Citation[];
  timings: Timings;
  model: string;
  /** Groq token usage; null when no LLM call was made (insufficient context) */
  usage?: TokenUsage | null;
}

export interface RetrievedChunk {
  rank: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentFileName?: string;
  chunkIndex: number;
  score: number;
  content: string;
}

export interface RetrieveRequest {
  query: string;
  topK?: number;
  threshold?: number;
}

export interface RetrieveResponse {
  query: string;
  topK: number;
  threshold: number;
  results: RetrievedChunk[];
  /** the exact numbered context block that would be handed to the LLM */
  contextPreview: string;
  timings: {
    embedMs: number;
    retrievalMs: number;
    totalMs: number;
  };
}

export interface HealthResponse {
  status: "ok" | "degraded";
  db: boolean;
  embeddings: boolean;
  llm: boolean;
  documents: number;
  chunks: number;
  time: string;
}

export interface ApiErrorBody {
  error: string;
  details?: string;
}

// ---------------------------------------------------------------------------
// Evaluation module contract
// ---------------------------------------------------------------------------

// v1 categories: factual / paraphrase / multi_doc / error_code / off_topic.
// v2 adds adversarial categories (audit 2026-10-24): contradiction, partial_evidence,
// misleading_premise, typo, long_doc, injection.
// robustness-v1 adds (2026-10-25): mixed_language, informal, underspecified,
// unanswerable, outdated, multi_condition.
// clarification-v1 adds (2026-10-25): ambiguous (interpretations diverge — expect
// clarify), contextual (history resolves the ambiguity — expect answer).
export type EvalCategory =
  | "factual"
  | "paraphrase"
  | "multi_doc"
  | "error_code"
  | "off_topic"
  | "contradiction"
  | "partial_evidence"
  | "misleading_premise"
  | "typo"
  | "long_doc"
  | "injection"
  | "mixed_language"
  | "informal"
  | "underspecified"
  | "unanswerable"
  | "outdated"
  | "multi_condition"
  | "ambiguous"
  | "contextual";

/** Which suite a dataset belongs to — kept separate in the dashboard. */
export type EvalSuite = "baseline" | "robustness" | "clarification";

/**
 * What the pipeline is EXPECTED to do with an item (robustness suite):
 * - answer:  full grounded answer with citations
 * - partial: answer the covered part and explicitly admit the gap
 * - clarify: ask for clarification (abstention is also acceptable)
 * - abstain: refuse / gap-admission only — no substantive answer
 * Items without the field keep the legacy v1/v2 criteria.
 */
export type EvalExpectedBehavior = "answer" | "partial" | "clarify" | "abstain";

/** Structured failure classification (robustness suite; absent on older runs). */
export type EvalFailureType =
  | "false_abstention"
  | "false_answer"
  | "unnecessary_clarification"
  | "retrieval_miss"
  | "keyword_coverage"
  | "citation_missing"
  | "citation_invalid"
  | "citation_variant"
  | "caveat_missing"
  | "forbidden_term"
  | "pipeline_error";

export interface EvalDatasetInfo {
  version: string;
  /** baseline suites omit the field (added 2026-10-25) */
  suite?: EvalSuite;
  description: string;
  itemCount: number;
  categories: Partial<Record<EvalCategory, number>>;
}

export interface EvalRunConfig {
  topK: number;
  threshold: number;
  llmModel: string;
  embeddingModel: string;
  embeddingDim: number;
}

/** A retrieved chunk as recorded in an eval result (snippet only, not full content). */
export interface EvalRetrievedChunkInfo {
  rank: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentFileName: string;
  chunkIndex: number;
  score: number;
  snippet: string;
  /** true when this chunk belongs to one of the item's expected documents */
  expected: boolean;
}

/** Unthresholded ranking view used for Recall@K / MRR (labeled items only). */
export interface EvalRankingInfo {
  /** fraction of expected docs with a chunk in the top-1 (audit addition; absent on pre-v2 runs) */
  recallAt1?: number | null;
  /** fraction of expected docs with a chunk in the top-3 (audit addition; absent on pre-v2 runs) */
  recallAt3?: number | null;
  recallAt5: number;
  /** 1-based rank of the first chunk belonging to an expected doc; null = not in top-5 */
  firstExpectedRank: number | null;
  /** reciprocal rank of the first expected chunk (0 when absent) */
  mrr: number;
  /** distinct document file names in rank order */
  docsInOrder: string[];
}

export interface EvalKeywordHit {
  keyword: string;
  found: boolean;
}

/**
 * Sentence-level citation-support heuristic (robustness addition): of the prose
 * sentences that make a concrete claim (contain a digit or a config assignment),
 * how many carry a citation marker. INFORMATIONAL ONLY — not a pass criterion.
 * Naive by design; see docs/EVALUATION.md for the documented blind spots.
 */
export interface EvalClaimSupport {
  /** prose sentences containing a digit or config assignment */
  claimSentences: number;
  /** claim sentences carrying at least one [n] / 【n】 marker */
  citedClaimSentences: number;
  claimSentencesWithoutCitation: number;
  /** citedClaimSentences / claimSentences; null when no claim sentences found */
  citedClaimRate: number | null;
}

export interface EvalItemMetrics {
  recallAt1?: number | null;
  recallAt3?: number | null;
  recallAt5: number | null;
  mrr: number | null;
  firstExpectedRank: number | null;
  /** fraction of labeled expected chunks present in the pipeline's top-3 (robustness addition) */
  chunkRecallAt3?: number | null;
  /** fraction of labeled expected chunks present in the pipeline's top-5 (null when unlabeled) */
  chunkRecallAt5: number | null;
  /** fraction of expected keywords present in the generated answer (null for off-topic) */
  keywordCoverage: number | null;
  /** fraction of [n] citation markers that point at expected documents (null when no markers) */
  citationPrecision: number | null;
  /** same check for non-standard 【n】 markers (null when none) — diagnostic, not a pass criterion */
  variantCitationPrecision: number | null;
  /** fraction of expected documents actually cited (null for off-topic) */
  citationRecall: number | null;
  /** fraction of caveatKeywords present (gap admission / clarification signals; null when none labeled) */
  caveatCoverage?: number | null;
}

export interface EvalItemResult {
  id: string;
  category: EvalCategory;
  question: string;
  expectedAnswer: string;
  expectedFileNames: string[];
  /** expected pipeline behavior (robustness suite; absent on older runs) */
  expectedBehavior?: EvalExpectedBehavior;
  /** behavior the pipeline actually chose (2026-10-25; derived from ChatResponse.behavior,
   *  falling back to sufficient for legacy responses — omitted on pipeline errors) */
  observedBehavior?: ChatBehavior;
  pass: boolean;
  failureReasons: string[];
  /** structured failure classification, parallel to failureReasons (robustness addition) */
  failureTypes?: EvalFailureType[];
  /** pipeline outcome */
  sufficient: boolean;
  generatedAnswer: string;
  model: string;
  retrieved: EvalRetrievedChunkInfo[];
  ranking: EvalRankingInfo | null;
  citationMarkers: number[];
  /** citation markers the model wrote with non-standard 【n】 brackets (not linkable in the UI) */
  variantCitationMarkers: number[];
  /** citation markers that referenced a source outside the expected document set */
  invalidMarkers: number[];
  keywordHits: EvalKeywordHit[];
  /** keyword hits for caveatKeywords (gap admission / clarification signals) */
  caveatHits?: EvalKeywordHit[];
  /** forbiddenKeywords found in the answer — any hit is an automatic fail */
  forbiddenKeywordHits?: EvalKeywordHit[];
  metrics: EvalItemMetrics;
  /** sentence-level citation-support heuristic (informational) */
  claimSupport?: EvalClaimSupport;
  timings: Timings;
  usage: TokenUsage | null;
}

export interface EvalCategoryBreakdown {
  items: number;
  passed: number;
  passRate: number;
}

export interface EvalAggregateMetrics {
  items: number;
  passed: number;
  passRate: number;
  retrieval: {
    /** mean Recall@1 over labeled items (audit addition; null when dataset has no labels) */
    recallAt1?: number | null;
    /** mean Recall@3 over labeled items (audit addition; null when dataset has no labels) */
    recallAt3?: number | null;
    /** mean Recall@5 over labeled items (null when dataset has no labels) */
    recallAt5: number | null;
    mrr: number | null;
    chunkRecallAt5: number | null;
  };
  answers: {
    /** mean keyword coverage over answered on-topic items */
    keywordCoverage: number | null;
    citationPrecision: number | null;
    /** mean precision of non-standard 【n】 markers over items that used them (null when none did) */
    variantCitationPrecision: number | null;
    citationRecall: number | null;
    /** on-topic items the pipeline refused to answer (insufficient context) */
    falseAbstentions: number;
  };
  abstention: {
    offTopicItems: number;
    /** off-topic items correctly answered with the insufficient-info response */
    abstained: number;
    abstentionRate: number | null;
  };
  latency: {
    avgEmbedMs: number;
    avgRetrievalMs: number;
    avgLlmMs: number;
    avgTotalMs: number;
  };
  tokens: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    answeredItems: number;
  };
  byCategory: Partial<Record<EvalCategory, EvalCategoryBreakdown>>;
  /** pass rate grouped by expectedBehavior (robustness addition; absent on older runs) */
  byBehavior?: Partial<Record<EvalExpectedBehavior, EvalCategoryBreakdown>>;
  /** number of items exhibiting each failure type (robustness addition) */
  byFailureType?: Partial<Record<EvalFailureType, number>>;
  /**
   * Clarification decision quality across the four behaviors (2026-10-25,
   * present whenever items declare expectedBehavior). Observed vs expected
   * behavior confusion measures:
   * - clarificationPrecision: of the items where the pipeline ASKED, how many
   *   actually needed clarification (observed clarify on clarify-expected items)
   * - clarificationRecall: of the clarify-expected items, how many got asked
   * - unnecessaryClarifications: asked on items that expected answer/partial/abstain
   * - falseAnswersOnClarify: expected clarify but the pipeline declared a
   *   confident full "answer" (the dangerous guess-instead-of-ask failure)
   * - correctBehaviorRate: exact observed==expected match across all items
   */
  behaviorDecisions?: {
    /** items the decision metrics are computed over — pipeline errors (model == "error",
     *  e.g. persistent provider 429s) are excluded so infra failures never count as
     *  model-quality failures; every ratio below uses these denominators */
    eligibleItems: number;
    /** excluded items (provider/quota/infra failures recorded as pipeline_error) */
    pipelineErrors: number;
    clarifyExpected: number;
    clarifyObserved: number;
    clarifyCorrect: number;
    clarificationPrecision: number | null;
    clarificationRecall: number | null;
    unnecessaryClarifications: number;
    falseAnswersOnClarify: number;
    correctBehaviorRate: number;
  };
  /** aggregate of the sentence-level claim-support heuristic (informational) */
  claims?: {
    avgCitedClaimRate: number | null;
    itemsWithClaims: number;
  };
}

export interface EvalRunSummary {
  id: string;
  datasetVersion: string;
  /** baseline | robustness (column added 2026-10-25; older rows read back as "baseline") */
  suite?: EvalSuite;
  label: string | null;
  createdAt: string;
  config: EvalRunConfig;
  metrics: EvalAggregateMetrics;
}

export interface EvalRunDetail extends EvalRunSummary {
  items: EvalItemResult[];
}
