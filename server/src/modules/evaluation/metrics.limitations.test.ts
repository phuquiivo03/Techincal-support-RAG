import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatResponse, RetrievedChunk } from "@rag/shared";
import type { EvalItem } from "./dataset.js";
import { scoreEvalItem } from "./metrics.js";

/**
 * AUDIT EVIDENCE — documented blind spots of the deterministic scorer.
 *
 * These tests intentionally feed the scorer WRONG or adversarial answers that
 * the current pass criteria nonetheless accept (or correct answers it rejects).
 * Each test names a real failure mode observed during the 2026-10-24 audit:
 *
 *   FP-1  keyword coverage is lexical — a factually wrong sentence that merely
 *         contains the expected keywords passes (run d67f66c1: every PASS is
 *         only guaranteed to this strength, no semantic grading exists).
 *   FP-2  citation precision is document-level — a marker pointing at the right
 *         document but the wrong chunk (claim not in that chunk) still passes.
 *   FP-3  unsupported extra claims are invisible — a hallucinated
 *         recommendation appended to a correct answer changes nothing.
 *   FP-4  citation recall is not a pass criterion — citing 1 of 2 expected
 *         docs passes (metrics record it, pass criteria ignore it).
 *   FN-1  expectedFileNames is a closed world — a marker citing a retrieved
 *         document that genuinely supports the claim FAILS when that document
 *         is not in the label set (observed: run 98870c91 fact-004, where
 *         proxy_read_timeout legitimately lives in nginx-502-upstream.md but
 *         only websocket-drops.md was labeled).
 *
 * If one of these tests starts failing, the scorer got STRICTER — update this
 * file only after confirming the new behavior is intended, not accidental.
 */

function chunk(file: string, chunkIndex: number, rank: number, content: string): RetrievedChunk {
  return {
    rank,
    chunkId: `${file}-${chunkIndex}`,
    documentId: `doc-${file}`,
    documentTitle: file,
    documentFileName: file,
    chunkIndex,
    score: 0.7,
    content,
  };
}

function item(overrides: Partial<EvalItem> = {}): EvalItem {
  return {
    id: "fact-002",
    category: "factual",
    question: "What pool size should I configure per app process?",
    expectedAnswer: "Pool max of 5-10 per process, under the provider connection cap.",
    history: [],
    expectedFileNames: ["pool-doc.md"],
    expectedChunks: [],
    expectedKeywords: ["pool", "5-10", "per process"],
    caveatKeywords: [],
    forbiddenKeywords: [],
    ...overrides,
  };
}

function chat(overrides: Partial<ChatResponse> = {}): ChatResponse {
  return {
    answer: "",
    sufficient: true,
    sources: [
      {
        index: 1,
        chunkId: "pool-doc.md-1",
        documentId: "doc-pool",
        documentTitle: "Pool doc",
        documentFileName: "pool-doc.md",
        score: 0.7,
        snippet: "s",
      },
      {
        index: 2,
        chunkId: "pool-doc.md-4",
        documentId: "doc-pool",
        documentTitle: "Pool doc",
        documentFileName: "pool-doc.md",
        score: 0.66,
        snippet: "s",
      },
      {
        index: 3,
        chunkId: "nginx-doc.md-2",
        documentId: "doc-nginx",
        documentTitle: "Nginx doc",
        documentFileName: "nginx-doc.md",
        score: 0.62,
        snippet: "s",
      },
    ],
    timings: { embedMs: 300, retrievalMs: 50, llmMs: 900, totalMs: 1250 },
    model: "test-model",
    usage: { promptTokens: 900, completionTokens: 100, totalTokens: 1000 },
    ...overrides,
  };
}

const rankingChunks = [
  chunk("pool-doc.md", 1, 1, "pool max 5-10 per process"),
  chunk("other-doc.md", 0, 2, "unrelated"),
  chunk("nginx-doc.md", 2, 3, "proxy_read_timeout default 60s"),
  chunk("pool-doc.md", 4, 4, "release clients in finally"),
  chunk("deadlock-doc.md", 0, 5, "sort ids before updating rows"),
];

describe("audit: scorer blind spots (false positives)", () => {
  it("FP-1: a factually WRONG answer containing the keywords passes", () => {
    const result = scoreEvalItem({
      item: item(),
      chat: chat({
        answer: "Set the pool to 9999 connections per process — never use 5-10; the cap does not matter [1].",
      }),
      rankingChunks,
    });
    // The answer contradicts the expected answer (5-10, stay under the cap) yet
    // keyword coverage = 1.0 and the marker resolves to the expected doc.
    assert.equal(result.metrics.keywordCoverage, 1);
    assert.equal(result.pass, true);
  });

  it("FP-2: a marker pointing at the right doc but an unrelated chunk still scores precision 1", () => {
    // The claim is about pool sizing (chunk 1); [2] is the "release clients"
    // chunk — same expected document, does not contain the claim. Doc-level
    // precision cannot see this.
    const result = scoreEvalItem({
      item: item(),
      chat: chat({ answer: "Use a pool max of 5-10 per process [2]." }),
      rankingChunks,
    });
    assert.equal(result.metrics.citationPrecision, 1);
    assert.equal(result.pass, true);
  });

  it("FP-3: a hallucinated recommendation appended to a correct answer still passes", () => {
    const result = scoreEvalItem({
      item: item(),
      chat: chat({
        answer:
          "Use a pool max of 5-10 per process [1]. Also always disable SSL and set max_connections=100000 on the provider [1].",
      }),
      rankingChunks,
    });
    assert.equal(result.pass, true);
  });

  it("FP-4: citing only 1 of 2 expected docs passes — citation recall is recorded, not enforced", () => {
    const result = scoreEvalItem({
      item: item({ expectedFileNames: ["pool-doc.md", "deadlock-doc.md"] }),
      chat: chat({ answer: "Pool max 5-10 per process [1]." }),
      rankingChunks,
    });
    assert.equal(result.metrics.citationRecall, 0.5);
    assert.equal(result.pass, true);
  });
});

describe("audit: scorer blind spots (false negatives)", () => {
  it("FN-1: a correct citation to a legitimately supporting but unlabeled doc FAILS (fact-004 mode)", () => {
    // Question also covers proxy_read_timeout, which lives in nginx-doc.md;
    // the model cites it correctly but the label set is a closed world.
    const result = scoreEvalItem({
      item: item({
        question: "How do I size the pool and set proxy_read_timeout?",
      }),
      chat: chat({
        answer: "Pool max of 5-10 per process [1]; raise proxy_read_timeout above your p99 [3].",
      }),
      rankingChunks,
    });
    assert.equal(result.metrics.citationPrecision, 0.5);
    assert.equal(result.pass, false);
    assert.match(result.failureReasons.join(" "), /\[3\]/);
  });
});
