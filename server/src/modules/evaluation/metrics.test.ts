import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatResponse, RetrievedChunk } from "@rag/shared";
import type { EvalItem } from "./dataset.js";
import {
  aggregateEvalItems,
  computeCitationScore,
  computeRanking,
  keywordHits,
  normalizeText,
  parseCitationMarkers,
  parseVariantMarkers,
  scoreEvalItem,
} from "./metrics.js";

function chunk(file: string, chunkIndex: number, rank: number): RetrievedChunk {
  return {
    rank,
    chunkId: `${file}-${chunkIndex}`,
    documentId: `doc-${file}`,
    documentTitle: file,
    documentFileName: file,
    chunkIndex,
    score: 0.6,
    content: `content of ${file} chunk ${chunkIndex}`,
  };
}

function item(overrides: Partial<EvalItem> = {}): EvalItem {
  return {
    id: "fact-001",
    category: "factual",
    question: "a question",
    expectedAnswer: "the truth",
    history: [],
    expectedFileNames: ["doc-a.md"],
    expectedChunks: [],
    expectedKeywords: ["alpha", "beta"],
    caveatKeywords: [],
    forbiddenKeywords: [],
    ...overrides,
  };
}

function chat(overrides: Partial<ChatResponse> = {}): ChatResponse {
  return {
    answer: "Answer with [1] citation.",
    sufficient: true,
    sources: [
      {
        index: 1,
        chunkId: "doc-a.md-2",
        documentId: "doc-a",
        documentTitle: "Doc A",
        documentFileName: "doc-a.md",
        score: 0.7,
        snippet: "snippet",
      },
    ],
    timings: { embedMs: 100, retrievalMs: 50, llmMs: 900, totalMs: 1050 },
    model: "test-model",
    usage: { promptTokens: 500, completionTokens: 100, totalTokens: 600 },
    ...overrides,
  };
}

describe("normalizeText / keywordHits", () => {
  it("normalizes case, dashes and whitespace", () => {
    assert.equal(normalizeText("Foo  Bar–Baz — Qux"), "foo bar-baz - qux");
  });

  it("matches keywords case-insensitively across dash styles", () => {
    const hits = keywordHits("Pool max of 5–10 per process", ["5-10", "PER PROCESS", "missing"]);
    assert.deepEqual(hits.map((h) => h.found), [true, true, false]);
  });

  it("matches across U+2011 non-breaking hyphens and spaced dashes (gpt-oss bold output)", () => {
    // run 25b72096 fact-002: answer "5 – 10" / "5‑10" wrongly failed keyword "5-10"
    const hits = keywordHits("pool max = 5 – 10 connections, roughly **5\u201110** each", ["5-10"]);
    assert.equal(hits[0].found, true);
  });

  it("treats hyphens and spaces as equivalent in keyword matching", () => {
    // run b49558fb contra-001: answer "30-second" wrongly failed keyword "30s" —
    // foldKey cannot fix suffix forms, but hyphen/space swaps must match:
    const hits = keywordHits("per-process pool sizing", ["per process"]);
    assert.equal(hits[0].found, true);
  });
});

describe("parseCitationMarkers", () => {
  it("collects unique markers in order of first appearance", () => {
    assert.deepEqual(parseCitationMarkers("one [1] two [3] three [1] four [2]"), [1, 3, 2]);
  });

  it("ignores brackets that are not citations", () => {
    assert.deepEqual(parseCitationMarkers("[see appendix] and [12]"), [12]);
  });

  it("detects non-standard 【n】 variant markers separately from [n]", () => {
    const answer = "claim one【1】 and claim two【2】【1】 plus [3]";
    assert.deepEqual(parseVariantMarkers(answer), [1, 2]);
    assert.deepEqual(parseCitationMarkers(answer), [3]);
  });

  it("detects annotated variant markers 【n†Lx-Ly】 (err-005 regression: previously invisible)", () => {
    const answer = "closed early【1†L9-L12】 then【4†L2-L4】 and plain【2】";
    assert.deepEqual(parseVariantMarkers(answer), [1, 4, 2]);
    assert.deepEqual(parseCitationMarkers(answer), []);
  });

  it("ignores [n]-shaped array indexing inside code spans and fences", () => {
    const answer = "```js\nconst a = ids[0];\nconst b = arr[1];\n```\nplus `xs[2]` inline and a real [2] marker.";
    assert.deepEqual(parseCitationMarkers(answer), [2]);
  });
});

describe("computeRanking", () => {
  it("computes recall, first rank, MRR and distinct doc order", () => {
    const chunks = [chunk("doc-a.md", 0, 1), chunk("doc-a.md", 1, 2), chunk("doc-b.md", 0, 3)];
    const ranking = computeRanking(chunks, ["doc-b.md"]);
    assert.equal(ranking.firstExpectedRank, 3);
    assert.equal(ranking.mrr, 0.333);
    assert.deepEqual(ranking.docsInOrder, ["doc-a.md", "doc-b.md"]);
  });

  it("computes recall@1/@3/@5 over progressively wider windows", () => {
    const chunks = [
      chunk("doc-a.md", 0, 1),
      chunk("doc-x.md", 0, 2),
      chunk("doc-b.md", 0, 3),
      chunk("doc-a.md", 1, 4),
    ];
    const ranking = computeRanking(chunks, ["doc-a.md", "doc-b.md"]);
    assert.equal(ranking.recallAt1, 0.5); // only doc-a within the top-1 chunk
    assert.equal(ranking.recallAt3, 1); // doc-b enters at rank 3
    assert.equal(ranking.recallAt5, 1);
  });

  it("recall@1 is 0 when the expected doc is not the top chunk", () => {
    const ranking = computeRanking([chunk("doc-x.md", 0, 1), chunk("doc-a.md", 0, 2)], ["doc-a.md"]);
    assert.equal(ranking.recallAt1, 0);
    assert.equal(ranking.recallAt3, 1);
  });

  it("reports recall 0.5 when one of two expected docs is missing", () => {
    const chunks = [chunk("doc-a.md", 0, 1), chunk("doc-c.md", 0, 2)];
    const ranking = computeRanking(chunks, ["doc-a.md", "doc-b.md"]);
    assert.equal(ranking.recallAt5, 0.5);
    assert.equal(ranking.mrr, 1);
  });

  it("reports rank null and mrr 0 when the expected doc is absent", () => {
    const ranking = computeRanking([chunk("doc-x.md", 0, 1)], ["doc-a.md"]);
    assert.equal(ranking.firstExpectedRank, null);
    assert.equal(ranking.mrr, 0);
  });
});

describe("computeCitationScore", () => {
  it("scores precision and recall of markers against expected docs", () => {
    const sources = [
      { index: 1, chunkId: "c1", documentId: "d1", documentTitle: "A", documentFileName: "doc-a.md", score: 0.7, snippet: "s" },
      { index: 2, chunkId: "c2", documentId: "d2", documentTitle: "B", documentFileName: "doc-b.md", score: 0.6, snippet: "s" },
    ];
    const score = computeCitationScore([1, 2, 3], sources, ["doc-a.md"]);
    assert.equal(score.precision, 0.333); // [2] cites a non-expected doc, [3] resolves to nothing
    assert.deepEqual(score.invalidMarkers, [2, 3]);
    assert.equal(score.recall, 1);
  });

  it("returns nulls when no markers are present", () => {
    const score = computeCitationScore([], [], ["doc-a.md"]);
    assert.equal(score.precision, null);
    assert.equal(score.recall, null);
  });
});

describe("scoreEvalItem", () => {
  it("passes a fully correct on-topic answer", () => {
    const result = scoreEvalItem({
      item: item(),
      chat: chat({ answer: "Use alpha and beta [1]." }),
      rankingChunks: [chunk("doc-a.md", 2, 1)],
    });
    assert.equal(result.pass, true);
    assert.deepEqual(result.failureReasons, []);
    assert.equal(result.metrics.recallAt5, 1);
    assert.equal(result.metrics.keywordCoverage, 1);
    assert.equal(result.metrics.citationPrecision, 1);
    assert.equal(result.retrieved[0].expected, true);
    assert.equal(result.retrieved[0].chunkIndex, 2);
  });

  it("fails with false abstention when nothing cleared the threshold", () => {
    const result = scoreEvalItem({
      item: item(),
      chat: chat({ sufficient: false, answer: "no info", sources: [], usage: null }),
      rankingChunks: [chunk("doc-a.md", 2, 1)],
    });
    assert.equal(result.pass, false);
    assert.match(result.failureReasons[0], /false abstention/);
  });

  it("fails when keyword coverage drops below 0.5", () => {
    const result = scoreEvalItem({
      item: item({ expectedKeywords: ["alpha", "beta", "gamma"] }),
      chat: chat({ answer: "Only alpha here [1]." }),
      rankingChunks: [chunk("doc-a.md", 2, 1)],
    });
    assert.equal(result.pass, false);
    assert.match(result.failureReasons.join(" "), /keyword coverage 0\.333/);
  });

  it("fails when a citation points outside the expected docs", () => {
    const outside = chat({
      answer: "Something [1] [2].",
      sources: [
        ...chat().sources,
        { index: 2, chunkId: "c2", documentId: "d2", documentTitle: "B", documentFileName: "doc-b.md", score: 0.6, snippet: "s" },
      ],
    });
    const result = scoreEvalItem({ item: item(), chat: outside, rankingChunks: [chunk("doc-a.md", 2, 1)] });
    assert.equal(result.pass, false);
    assert.match(result.failureReasons.join(" "), /\[2\]/);
  });

  it("passes an abstained off-topic question and fails an answered one", () => {
    const off = item({ id: "off-001", category: "off_topic", expectedFileNames: [], expectedKeywords: [], expectedChunks: [] });
    const abstained = scoreEvalItem({
      item: off,
      chat: chat({ sufficient: false, answer: "no info", sources: [], usage: null }),
      rankingChunks: null,
    });
    assert.equal(abstained.pass, true);

    const answered = scoreEvalItem({ item: off, chat: chat(), rankingChunks: null });
    assert.equal(answered.pass, false);
    assert.match(answered.failureReasons[0], /outside the knowledge base/);
  });

  it("fails with a distinct reason when citations use 【n】 brackets", () => {
    const result = scoreEvalItem({
      item: item(),
      chat: chat({ answer: "Use alpha and beta【1】【2】." }),
      rankingChunks: [chunk("doc-a.md", 2, 1)],
    });
    assert.equal(result.pass, false);
    assert.deepEqual(result.variantCitationMarkers, [1, 2]);
    // 【1】 resolves to the expected doc, 【2】 to nothing → variant precision 0.5
    assert.equal(result.metrics.variantCitationPrecision, 0.5);
    assert.equal(result.metrics.citationPrecision, null);
    assert.match(result.failureReasons[0], /non-standard 【n】 brackets \(2 markers, 50% resolve/);
  });

  it("scores annotated 【n†Lx-Ly】 markers like plain variant markers (err-005 regression)", () => {
    const result = scoreEvalItem({
      item: item(),
      chat: chat({ answer: "Alpha【1†L9-L12】 and beta【1†L2-L4】." }),
      rankingChunks: [chunk("doc-a.md", 2, 1)],
    });
    assert.deepEqual(result.variantCitationMarkers, [1]);
    assert.equal(result.metrics.variantCitationPrecision, 1);
    assert.match(result.failureReasons[0], /\(1 markers, 100% resolve/);
  });

  it("prefers the chunkIndex carried on Citation (off-topic items have no ranking pass)", () => {
    const result = scoreEvalItem({
      item: item(),
      chat: chat({
        sources: [
          {
            index: 1,
            chunkIndex: 7,
            chunkId: "doc-a.md-7",
            documentId: "doc-a",
            documentTitle: "Doc A",
            documentFileName: "doc-a.md",
            score: 0.7,
            snippet: "snippet",
          },
        ],
      }),
      rankingChunks: null,
    });
    assert.equal(result.retrieved[0].chunkIndex, 7);
  });

  it("scores chunk recall when chunk labels exist", () => {
    const withChunks = item({
      expectedChunks: [
        { fileName: "doc-a.md", chunkIndex: 2 },
        { fileName: "doc-a.md", chunkIndex: 9 },
      ],
    });
    const result = scoreEvalItem({
      item: withChunks,
      chat: chat(),
      rankingChunks: [chunk("doc-a.md", 2, 1), chunk("doc-a.md", 9, 5)],
    });
    assert.equal(result.metrics.chunkRecallAt5, 1);
  });
});

describe("aggregateEvalItems", () => {
  it("rolls up pass rates, abstention, latency and tokens", () => {
    const passing = scoreEvalItem({
      item: item(),
      chat: chat({ answer: "alpha beta [1]" }),
      rankingChunks: [chunk("doc-a.md", 2, 1)],
    });
    const off = item({ id: "off-001", category: "off_topic", expectedFileNames: [], expectedKeywords: [], expectedChunks: [] });
    const abstained = scoreEvalItem({
      item: off,
      chat: chat({ sufficient: false, answer: "", sources: [], usage: null }),
      rankingChunks: null,
    });
    const agg = aggregateEvalItems([passing, abstained]);

    assert.equal(agg.items, 2);
    assert.equal(agg.passed, 2);
    assert.equal(agg.passRate, 1);
    assert.equal(agg.retrieval.recallAt5, 1);
    assert.equal(agg.retrieval.recallAt1, 1);
    assert.equal(agg.retrieval.recallAt3, 1);
    assert.equal(agg.retrieval.mrr, 1);
    assert.equal(agg.answers.keywordCoverage, 1);
    assert.equal(agg.abstention.abstentionRate, 1);

    const variant = scoreEvalItem({
      item: item({ id: "fact-002" }),
      chat: chat({ answer: "alpha【1】 beta【1】" }),
      rankingChunks: [chunk("doc-a.md", 2, 1)],
    });
    const aggWithVariant = aggregateEvalItems([passing, variant]);
    assert.equal(aggWithVariant.answers.variantCitationPrecision, 1); // averaged over variant items only
    assert.equal(agg.answers.falseAbstentions, 0);
    assert.equal(agg.latency.avgTotalMs, 1050);
    assert.equal(agg.tokens.totalTokens, 600); // only the answered item used tokens
    assert.equal(agg.tokens.answeredItems, 1);
    assert.equal(agg.byCategory.factual?.passRate, 1);
    assert.equal(agg.byCategory.off_topic?.passRate, 1);
  });
});
