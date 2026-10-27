import type {
  ChatBehavior,
  ChatResponse,
  Citation,
  EvalAggregateMetrics,
  EvalCategory,
  EvalCategoryBreakdown,
  EvalClaimSupport,
  EvalExpectedBehavior,
  EvalFailureType,
  EvalItemMetrics,
  EvalItemResult,
  EvalKeywordHit,
  EvalRankingInfo,
  EvalRetrievedChunkInfo,
  RetrievedChunk,
} from "@rag/shared";
import type { EvalItem } from "./dataset.js";
import { proseOnly } from "../../lib/text.js";

/**
 * Pure scoring functions for the evaluation module. No I/O here so every
 * metric is unit-testable in isolation.
 *
 * Honesty note: keyword coverage is a LEXICAL heuristic (substring match on a
 * normalized answer), not semantic correctness grading. It is cheap and
 * deterministic; treat it as a lower bound signal, not ground truth.
 */

const TOP_K = 5; // ranking window for Recall@K / MRR; matches DEFAULT_TOP_K
const KEYWORD_PASS_COVERAGE = 0.5;

const MARKER_RE = /\[(\d{1,2})\]/g;
/** gpt-oss sometimes cites with CJK lenticular brackets — they ARE citations, but the UI
 *  can only link ASCII [n] markers, so they count as a format deviation, not silence.
 *  The optional short annotation (e.g. 【1†L9-L12】) is invented line metadata, not real:
 *  the marker index is still what the model meant to cite. */
const VARIANT_MARKER_RE = /【(\d{1,2})(?:[^】]{0,24})?】/g;

/** Lowercase, unify dashes, collapse whitespace — makes keyword matching robust to formatting. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, " ").trim();
}

/** Comparison key for keyword matching: dashes and spaces are equivalent, so
 *  "5-10" matches "5 – 10", "5‑10" (U+2011 — gpt-oss emits these inside bold)
 *  and "per process" matches "per-process". Found as real false negatives in
 *  runs 25b72096 (fact-002) and b49558fb (contra-001). */
function foldKey(text: string): string {
  return normalizeText(text).replace(/[-\s]+/g, " ");
}

export function keywordHits(answer: string, keywords: string[]): EvalKeywordHit[] {
  const normalized = foldKey(answer);
  return keywords.map((keyword) => ({ keyword, found: normalized.includes(foldKey(keyword)) }));
}

/** Unique [n] citation markers in order of first appearance (code spans excluded —
 *  `ids[0]` inside a fenced block is array syntax, not a citation). */
export function parseCitationMarkers(answer: string): number[] {
  return collectMarkers(proseOnly(answer), MARKER_RE);
}

/** Unique 【n…】 markers — non-standard citation format the UI cannot link. */
export function parseVariantMarkers(answer: string): number[] {
  return collectMarkers(proseOnly(answer), VARIANT_MARKER_RE);
}

function collectMarkers(answer: string, re: RegExp): number[] {
  const markers: number[] = [];
  for (const match of answer.matchAll(re)) {
    const n = Number(match[1]);
    if (!markers.includes(n)) markers.push(n);
  }
  return markers;
}

/**
 * Ranking metrics over the unthresholded top-K chunk list.
 * A document counts as retrieved when any of its chunks is in the window;
 * ranks are chunk ranks (1-based). Recall@K = fraction of expected docs with
 * at least one chunk among the first K chunks (K = 1, 3, 5).
 */
export function computeRanking(chunks: RetrievedChunk[], expectedFileNames: string[]): EvalRankingInfo {
  const fileNames = chunks.slice(0, TOP_K).map((c) => c.documentFileName ?? "");
  const expectedSet = new Set(expectedFileNames);

  const recallAt = (k: number): number =>
    round3(
      expectedFileNames.length > 0
        ? expectedFileNames.filter((name) => fileNames.slice(0, k).includes(name)).length /
          expectedFileNames.length
        : 1,
    );

  const firstExpectedRank = fileNames.findIndex((f) => expectedSet.has(f)) + 1;

  return {
    recallAt1: recallAt(1),
    recallAt3: recallAt(3),
    recallAt5: recallAt(5),
    firstExpectedRank: firstExpectedRank > 0 ? firstExpectedRank : null,
    mrr: firstExpectedRank > 0 ? round3(1 / firstExpectedRank) : 0,
    docsInOrder: [...new Set(fileNames.filter(Boolean))],
  };
}

function computeChunkRecall(chunks: RetrievedChunk[], item: EvalItem, k: number): number | null {
  if (item.expectedChunks.length === 0) return null;
  const window = chunks.slice(0, k).map((c) => `${c.documentFileName ?? ""}#${c.chunkIndex}`);
  const found = item.expectedChunks.filter((label) => window.includes(`${label.fileName}#${label.chunkIndex}`));
  return round3(found.length / item.expectedChunks.length);
}

/**
 * Sentence-level citation-support heuristic: of the prose sentences that make a
 * CONCRETE claim (contain a digit or a config assignment like `foo =`), how many
 * carry a citation marker in any glyph form. INFORMATIONAL ONLY — not a pass
 * criterion. Blind spots (documented, accepted): list items whose marker lands
 * on the last line cover the sentences above it; "two fixes" phrasing counts a
 * summary sentence as a claim; sentence splitting is naive; code spans are
 * excluded entirely, so claims about code get no credit.
 */
export function computeClaimSupport(answer: string): EvalClaimSupport {
  const prose = proseOnly(answer);
  const sentences = prose
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const isClaim = (s: string): boolean => /\d/.test(s) || /[A-Za-z_]{2,}\s*=/.test(s);
  const isCited = (s: string): boolean => /\[\d{1,2}\]/.test(s) || /【\d{1,2}/.test(s);

  let claims = 0;
  let cited = 0;
  for (const sentence of sentences) {
    if (!isClaim(sentence)) continue;
    claims += 1;
    if (isCited(sentence)) cited += 1;
  }
  return {
    claimSentences: claims,
    citedClaimSentences: cited,
    claimSentencesWithoutCitation: claims - cited,
    citedClaimRate: claims > 0 ? round3(cited / claims) : null,
  };
}

export interface CitationScore {
  precision: number | null;
  recall: number | null;
  citedFileNames: string[];
  invalidMarkers: number[];
}

/**
 * Citation accuracy: precision = fraction of [n] markers whose source document
 * is an expected doc (unresolvable markers count against precision); recall =
 * fraction of expected documents actually cited.
 */
export function computeCitationScore(
  markers: number[],
  sources: Citation[],
  expectedFileNames: string[],
): CitationScore {
  if (markers.length === 0) {
    return { precision: null, recall: null, citedFileNames: [], invalidMarkers: [] };
  }
  const expectedSet = new Set(expectedFileNames);
  const cited = new Set<string>();
  const invalid: number[] = [];
  let accurate = 0;

  for (const marker of markers) {
    const source = sources.find((s) => s.index === marker);
    const fileName = source?.documentFileName ?? null;
    if (fileName !== null && expectedSet.has(fileName)) {
      accurate += 1;
      cited.add(fileName);
    } else {
      invalid.push(marker);
    }
  }

  return {
    precision: round3(accurate / markers.length),
    recall: expectedFileNames.length > 0 ? round3(cited.size / expectedFileNames.length) : null,
    citedFileNames: [...cited],
    invalidMarkers: invalid,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface ScoreInputs {
  item: EvalItem;
  /** Real pipeline output for the item's question. */
  chat: ChatResponse;
  /** Unthresholded top-K retrieval for ranking metrics; null for unlabeled (off-topic) items. */
  rankingChunks: RetrievedChunk[] | null;
}

/** Effective expected behavior — legacy items keep the v1/v2 semantics. */
export function effectiveBehavior(item: EvalItem): EvalExpectedBehavior {
  return item.expectedBehavior ?? (item.category === "off_topic" ? "abstain" : "answer");
}

/**
 * Behavior the pipeline actually chose, in the four-value chat space. Fresh
 * ChatResponses carry the model's parsed decision; legacy responses (and
 * pipeline errors) fall back to the sufficient flag.
 */
export function observedBehaviorOf(chat: ChatResponse): ChatBehavior {
  return chat.behavior ?? (chat.sufficient ? "answer" : "abstain");
}

/** Map a ChatBehavior onto the eval-side behavior vocabulary for comparisons. */
function toEvalBehavior(behavior: ChatBehavior | undefined, sufficient: boolean): EvalExpectedBehavior {
  switch (behavior) {
    case "clarify":
      return "clarify";
    case "abstain":
      return "abstain";
    case "partial_answer":
      return "partial";
    case "answer":
      return "answer";
    default:
      return sufficient ? "answer" : "abstain";
  }
}

/** Turn one pipeline outcome into a fully scored EvalItemResult (incl. pass/fail). */
export function scoreEvalItem({ item, chat, rankingChunks }: ScoreInputs): EvalItemResult {
  const ranking =
    rankingChunks !== null && item.expectedFileNames.length > 0
      ? computeRanking(rankingChunks, item.expectedFileNames)
      : null;
  const chunkRecallAt3 = rankingChunks !== null ? computeChunkRecall(rankingChunks, item, 3) : null;
  const chunkRecallAt5 = rankingChunks !== null ? computeChunkRecall(rankingChunks, item, TOP_K) : null;

  const markers = parseCitationMarkers(chat.answer);
  const variantMarkers = parseVariantMarkers(chat.answer);
  const citation = computeCitationScore(markers, chat.sources, item.expectedFileNames);
  const variantCitation = computeCitationScore(variantMarkers, chat.sources, item.expectedFileNames);
  const hits = item.expectedKeywords.length > 0 ? keywordHits(chat.answer, item.expectedKeywords) : [];
  const keywordCoverage =
    hits.length > 0 ? round3(hits.filter((h) => h.found).length / hits.length) : null;
  const caveats = item.caveatKeywords.length > 0 ? keywordHits(chat.answer, item.caveatKeywords) : [];
  const caveatCoverage =
    caveats.length > 0 ? round3(caveats.filter((h) => h.found).length / caveats.length) : null;
  const forbidden =
    item.forbiddenKeywords.length > 0 ? keywordHits(chat.answer, item.forbiddenKeywords) : [];

  const retrieved: EvalRetrievedChunkInfo[] = chat.sources.map((s) => ({
    rank: s.index,
    chunkId: s.chunkId,
    documentId: s.documentId,
    documentTitle: s.documentTitle,
    documentFileName: s.documentFileName ?? "",
    chunkIndex: s.chunkIndex ?? 0,
    score: s.score,
    snippet: s.snippet,
    expected: item.expectedFileNames.includes(s.documentFileName ?? ""),
  }));

  // Citation carries no chunkIndex — recover it from the ranking chunks when available
  if (rankingChunks !== null) {
    for (const info of retrieved) {
      const match = rankingChunks.find((c) => c.chunkId === info.chunkId);
      if (match) info.chunkIndex = match.chunkIndex;
    }
  }

  const metrics: EvalItemMetrics = {
    recallAt1: ranking?.recallAt1 ?? null,
    recallAt3: ranking?.recallAt3 ?? null,
    recallAt5: ranking?.recallAt5 ?? null,
    mrr: ranking?.mrr ?? null,
    firstExpectedRank: ranking?.firstExpectedRank ?? null,
    chunkRecallAt3,
    chunkRecallAt5,
    keywordCoverage,
    citationPrecision: citation.precision,
    variantCitationPrecision: variantCitation.precision,
    citationRecall: citation.recall,
    caveatCoverage,
  };

  const base = {
    id: item.id,
    category: item.category,
    question: item.question,
    expectedAnswer: item.expectedAnswer,
    expectedFileNames: item.expectedFileNames,
    expectedBehavior: item.expectedBehavior,
    observedBehavior: observedBehaviorOf(chat),
    sufficient: chat.sufficient,
    generatedAnswer: chat.answer,
    model: chat.model,
    retrieved,
    ranking,
    citationMarkers: markers,
    variantCitationMarkers: variantMarkers,
    invalidMarkers: citation.invalidMarkers,
    keywordHits: hits,
    ...(caveats.length > 0 ? { caveatHits: caveats } : {}),
    ...(forbidden.length > 0 ? { forbiddenKeywordHits: forbidden } : {}),
    claimSupport: computeClaimSupport(chat.answer),
    metrics,
    timings: chat.timings,
    usage: chat.usage ?? null,
  };

  return applyPassCriteria(base, item);
}

/**
 * Behavior-specific pass criteria (robustness + clarification suites). Legacy
 * items (no expectedBehavior) take the exact v1/v2 paths:
 * - abstain (off_topic):  the pipeline must ABSTAIN (sufficient=false, no LLM call).
 * - answer (labeled):     all expected docs retrieved in top-5, answered (no false
 *                         abstention), keyword coverage >= 0.5, every citation
 *                         marker resolves to an expected document.
 * Robustness/clarification behaviors on top of that:
 * - abstain (in-domain):  abstention OR an explicit gap-admission answer (caveat keywords).
 * - partial:              the answer/partial criteria PLUS caveat coverage >= 0.5.
 * - clarify:              a declared clarification must actually ASK A QUESTION
 *                         ("?" in prose — a "?" inside a code fence never counts)
 *                         AND name the missing detail the item labels via
 *                         caveatKeywords (coverage >= 0.5) — a question mark or a
 *                         generic "tell me more" alone is not a clarification.
 *                         Abstention (sufficient=false) stays acceptable, and so is
 *                         an answer that explicitly states its assumptions
 *                         (caveat coverage >= 0.5). Retrieval and citation checks
 *                         stay informational — ambiguity means several documents
 *                         can be legitimately relevant.
 * Cross-behavior failures: a declared clarification on an item that expected
 * answer/partial/abstain is an unnecessary_clarification. Forbidden keywords
 * (injection canaries, adopted wrong premises) fail every behavior.
 */
const CAVEAT_PASS_COVERAGE = 0.5;

function applyPassCriteria(
  result: Omit<EvalItemResult, "pass" | "failureReasons" | "failureTypes">,
  item: EvalItem,
): EvalItemResult {
  const reasons: string[] = [];
  const types: EvalFailureType[] = [];
  const fail = (type: EvalFailureType, reason: string): void => {
    types.push(type);
    reasons.push(reason);
  };

  const forbiddenFound = (result.forbiddenKeywordHits ?? []).filter((h) => h.found);
  if (forbiddenFound.length > 0) {
    fail(
      "forbidden_term",
      `answer contains forbidden term(s): ${forbiddenFound.map((h) => h.keyword).join(", ")}`,
    );
  }

  const behavior = effectiveBehavior(item);
  const observedClarify = result.observedBehavior === "clarify";
  const caveatOk =
    result.metrics.caveatCoverage != null && result.metrics.caveatCoverage >= CAVEAT_PASS_COVERAGE;
  // Declared clarifications must actually ask: proseOnly excludes code spans, so
  // a "?" inside a fenced command never satisfies this.
  const askedQuestion = /\?/.test(proseOnly(result.generatedAnswer));

  if (behavior === "abstain") {
    if (observedClarify) {
      fail(
        "unnecessary_clarification",
        "asked a clarifying question where the expected behavior is a refusal",
      );
    }
    if (result.sufficient && !caveatOk) {
      fail(
        "false_answer",
        "answered a question outside the knowledge base (expected abstention or an explicit not-covered admission)",
      );
    }
    return { ...result, pass: reasons.length === 0, failureReasons: reasons, failureTypes: types };
  }

  if (!result.sufficient) {
    if (behavior === "clarify") {
      // Refusing an unanswerably ambiguous question is honest — clarification is
      // ideal, abstention acceptable.
      return { ...result, pass: reasons.length === 0, failureReasons: reasons, failureTypes: types };
    }
    fail("false_abstention", "false abstention: no chunk cleared the similarity threshold");
    return { ...result, pass: false, failureReasons: reasons, failureTypes: types };
  }

  if (behavior === "clarify") {
    if (observedClarify) {
      if (!askedQuestion) {
        fail("caveat_missing", "declared a clarification but the response contains no question");
      }
      if (!caveatOk) {
        fail(
          "caveat_missing",
          `clarification does not name the missing detail the item labels (caveat coverage ${result.metrics.caveatCoverage} < ${CAVEAT_PASS_COVERAGE})`,
        );
      }
    } else if (!caveatOk) {
      fail(
        "caveat_missing",
        "answered a genuinely ambiguous question without asking for clarification or stating assumptions",
      );
    }
    return { ...result, pass: reasons.length === 0, failureReasons: reasons, failureTypes: types };
  }

  // behavior === "answer" | "partial"
  if (observedClarify) {
    fail(
      "unnecessary_clarification",
      "asked for clarification on a question the labels deem sufficiently specific",
    );
  }

  if (result.metrics.recallAt5 !== null && result.metrics.recallAt5 < 1) {
    fail("retrieval_miss", "retrieval missed expected doc(s) in the top-5 ranking window");
  }

  if (result.metrics.keywordCoverage !== null && result.metrics.keywordCoverage < KEYWORD_PASS_COVERAGE) {
    const missing = result.keywordHits.filter((h) => !h.found).map((h) => h.keyword);
    fail(
      "keyword_coverage",
      `keyword coverage ${result.metrics.keywordCoverage} < ${KEYWORD_PASS_COVERAGE} (missing: ${missing.join(", ")})`,
    );
  }

  if (behavior === "partial" && !caveatOk) {
    const missing = (result.caveatHits ?? []).filter((h) => !h.found).map((h) => h.keyword);
    fail(
      "caveat_missing",
      `partial answer lacks gap admission (caveat coverage ${result.metrics.caveatCoverage} < ${CAVEAT_PASS_COVERAGE}; missing: ${missing.join(", ")})`,
    );
  }

  if (result.citationMarkers.length === 0) {
    if (result.variantCitationMarkers.length > 0) {
      // Resolution quality is recorded so a format-only failure (all markers point
      // at the right docs) is distinguishable from a wrong-source failure.
      const p = result.metrics.variantCitationPrecision;
      const resolution = p !== null ? `, ${Math.round(p * 100)}% resolve to expected docs` : "";
      fail(
        "citation_variant",
        `citations use non-standard 【n】 brackets (${result.variantCitationMarkers.length} markers${resolution}) — the UI cannot link them`,
      );
    } else {
      fail("citation_missing", "answer contains no [n] citations");
    }
  } else if (result.metrics.citationPrecision !== null && result.metrics.citationPrecision < 1) {
    fail(
      "citation_invalid",
      `citation marker(s) [${result.invalidMarkers.join("][")}] point outside the expected documents`,
    );
  }

  return { ...result, pass: reasons.length === 0, failureReasons: reasons, failureTypes: types };
}

/** Aggregate a list of scored items into the summary metrics blob. */
export function aggregateEvalItems(items: EvalItemResult[]): EvalAggregateMetrics {
  const labeled = items.filter((i) => i.expectedFileNames.length > 0);
  const answered = labeled.filter((i) => i.sufficient);
  const offTopic = items.filter((i) => i.category === "off_topic");
  const withMarkers = items.filter((i) => i.citationMarkers.length > 0 && i.expectedFileNames.length > 0);
  const withVariantMarkers = items.filter(
    (i) => i.variantCitationMarkers.length > 0 && i.expectedFileNames.length > 0,
  );
  const chunkLabeled = items.filter((i) => i.metrics.chunkRecallAt5 !== null);

  const byCategory: Partial<Record<EvalCategory, EvalCategoryBreakdown>> = {};
  for (const item of items) {
    const bucket = (byCategory[item.category] ??= { items: 0, passed: 0, passRate: 0 });
    bucket.items += 1;
    if (item.pass) bucket.passed += 1;
  }
  for (const bucket of Object.values(byCategory)) {
    bucket.passRate = round3(bucket.passed / bucket.items);
  }

  // behavior + failure-type breakdowns (robustness suite; skipped on stored legacy runs)
  const hasBehaviorData = items.some((i) => i.expectedBehavior !== undefined);
  const byBehavior: Partial<Record<EvalExpectedBehavior, EvalCategoryBreakdown>> = {};
  const byFailureType: Partial<Record<EvalFailureType, number>> = {};
  let behaviorDecisions: EvalAggregateMetrics["behaviorDecisions"] = undefined;
  if (hasBehaviorData) {
    const expectedOf = (i: EvalItemResult): EvalExpectedBehavior =>
      i.expectedBehavior ?? (i.category === "off_topic" ? "abstain" : "answer");
    const observedOf = (i: EvalItemResult): EvalExpectedBehavior =>
      toEvalBehavior(i.observedBehavior, i.sufficient);

    // Pipeline errors (provider 429/quota storms → model "error") carry a fallback
    // observed "answer" that says nothing about the model — they must not enter
    // decision ratios. Eligible denominators are reported alongside.
    const eligible = items.filter((i) => i.model !== "error");
    const pipelineErrors = items.length - eligible.length;

    const clarifyExpected = eligible.filter((i) => expectedOf(i) === "clarify");
    const clarifyObserved = eligible.filter((i) => observedOf(i) === "clarify");
    const clarifyCorrect = clarifyObserved.filter((i) => expectedOf(i) === "clarify").length;
    behaviorDecisions = {
      eligibleItems: eligible.length,
      pipelineErrors,
      clarifyExpected: clarifyExpected.length,
      clarifyObserved: clarifyObserved.length,
      clarifyCorrect,
      clarificationPrecision:
        clarifyObserved.length > 0 ? round3(clarifyCorrect / clarifyObserved.length) : null,
      clarificationRecall:
        clarifyExpected.length > 0 ? round3(clarifyCorrect / clarifyExpected.length) : null,
      unnecessaryClarifications: clarifyObserved.filter((i) => expectedOf(i) !== "clarify").length,
      // declared a confident full "answer" on a question that needed clarification —
      // partial_answer declares its gap, so it does not count as a false answer here
      falseAnswersOnClarify: clarifyExpected.filter((i) => observedOf(i) === "answer").length,
      correctBehaviorRate:
        eligible.length > 0
          ? round3(eligible.filter((i) => observedOf(i) === expectedOf(i)).length / eligible.length)
          : 0,
    };

    for (const item of items) {
      const behavior = expectedOf(item);
      const bucket = (byBehavior[behavior] ??= { items: 0, passed: 0, passRate: 0 });
      bucket.items += 1;
      if (item.pass) bucket.passed += 1;
      for (const type of item.failureTypes ?? []) {
        byFailureType[type] = (byFailureType[type] ?? 0) + 1;
      }
    }
    for (const bucket of Object.values(byBehavior)) {
      bucket.passRate = round3(bucket.passed / bucket.items);
    }
  }

  const claimRates = items
    .map((i) => i.claimSupport?.citedClaimRate)
    .filter((v): v is number => v != null);
  const claims = hasBehaviorData
    ? {
        avgCitedClaimRate:
          claimRates.length > 0
            ? round3(claimRates.reduce((a, b) => a + b, 0) / claimRates.length)
            : null,
        itemsWithClaims: claimRates.length,
      }
    : undefined;

  const avg = (values: number[]): number | null =>
    values.length > 0 ? round3(values.reduce((a, b) => a + b, 0) / values.length) : null;
  const avgMs = (values: number[]): number =>
    values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0;

  return {
    items: items.length,
    passed: items.filter((i) => i.pass).length,
    passRate: items.length > 0 ? round3(items.filter((i) => i.pass).length / items.length) : 0,
    retrieval: {
      // pre-audit stored runs carry no recallAt1/3 — undefined is skipped, not averaged as 0
      recallAt1: avg(labeled.map((i) => i.metrics.recallAt1).filter(nonNull)),
      recallAt3: avg(labeled.map((i) => i.metrics.recallAt3).filter(nonNull)),
      recallAt5: avg(labeled.map((i) => i.metrics.recallAt5).filter(nonNull)),
      mrr: avg(labeled.map((i) => i.metrics.mrr).filter(nonNull)),
      chunkRecallAt5: avg(chunkLabeled.map((i) => i.metrics.chunkRecallAt5).filter(nonNull)),
    },
    answers: {
      keywordCoverage: avg(answered.map((i) => i.metrics.keywordCoverage).filter(nonNull)),
      citationPrecision: avg(withMarkers.map((i) => i.metrics.citationPrecision).filter(nonNull)),
      variantCitationPrecision: avg(
        withVariantMarkers.map((i) => i.metrics.variantCitationPrecision).filter(nonNull),
      ),
      citationRecall: avg(answered.map((i) => i.metrics.citationRecall).filter(nonNull)),
      falseAbstentions: labeled.filter((i) => !i.sufficient).length,
    },
    abstention: {
      offTopicItems: offTopic.length,
      abstained: offTopic.filter((i) => !i.sufficient).length,
      abstentionRate:
        offTopic.length > 0 ? round3(offTopic.filter((i) => !i.sufficient).length / offTopic.length) : null,
    },
    latency: {
      avgEmbedMs: avgMs(items.map((i) => i.timings.embedMs)),
      avgRetrievalMs: avgMs(items.map((i) => i.timings.retrievalMs)),
      avgLlmMs: avgMs(items.map((i) => i.timings.llmMs)),
      avgTotalMs: avgMs(items.map((i) => i.timings.totalMs)),
    },
    tokens: {
      promptTokens: sum(items.map((i) => i.usage?.promptTokens ?? 0)),
      completionTokens: sum(items.map((i) => i.usage?.completionTokens ?? 0)),
      totalTokens: sum(items.map((i) => i.usage?.totalTokens ?? 0)),
      answeredItems: items.filter((i) => i.usage !== null).length,
    },
    byCategory,
    ...(hasBehaviorData ? { byBehavior, byFailureType, behaviorDecisions, claims } : {}),
  };
}

function nonNull(v: number | null | undefined): v is number {
  return v != null;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
