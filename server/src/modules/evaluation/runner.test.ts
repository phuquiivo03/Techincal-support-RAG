import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatResponse, ChatRole, RetrievedChunk } from "@rag/shared";
import type { EvalDataset } from "./dataset.js";
import { runDataset, runItem } from "./runner.js";

function deps() {
  const calls = { ranked: [] as string[], answered: [] as { question: string; history: ChatRole[] }[] };
  const pipeline = {
    answerQuestion: async (question: string, history: ChatRole[] = []): Promise<ChatResponse> => {
      calls.answered.push({ question, history });
      return {
        answer: `answer to "${question}" [1]`,
        sufficient: true,
        behavior: "answer" as const,
        sources: [
          {
            index: 1,
            chunkId: "doc-a.md-0",
            documentId: "doc-a",
            documentTitle: "Doc A",
            documentFileName: "doc-a.md",
            score: 0.7,
            snippet: "snippet",
          },
        ],
        timings: { embedMs: 10, retrievalMs: 5, llmMs: 100, totalMs: 115 },
        model: "fake-model",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    },
    retrieveForRanking: async (question: string): Promise<RetrievedChunk[]> => {
      calls.ranked.push(question);
      return [
        {
          rank: 1,
          chunkId: "doc-a.md-0",
          documentId: "doc-a",
          documentTitle: "Doc A",
          documentFileName: "doc-a.md",
          chunkIndex: 0,
          score: 0.7,
          content: "content",
        },
      ];
    },
  };
  return { pipeline, calls };
}

const onTopic = {
  id: "fact-001",
  category: "factual" as const,
  question: "on topic question",
  expectedAnswer: "expected",
  history: [],
  expectedFileNames: ["doc-a.md"],
  expectedChunks: [],
  expectedKeywords: ["answer"],
  caveatKeywords: [],
  forbiddenKeywords: [],
};

const offTopic = {
  id: "off-001",
  category: "off_topic" as const,
  question: "off topic question",
  expectedAnswer: "expected abstention",
  history: [],
  expectedFileNames: [],
  expectedChunks: [],
  expectedKeywords: [],
  caveatKeywords: [],
  forbiddenKeywords: [],
};

describe("runItem", () => {
  it("runs the real pipeline functions and scores the outcome", async () => {
    const { pipeline } = deps();
    const result = await runItem(onTopic, pipeline);
    assert.equal(result.pass, true);
    assert.ok(result.generatedAnswer.includes("on topic question"));
    assert.equal(result.metrics.recallAt5, 1);
    assert.equal(result.observedBehavior, "answer");
  });

  it("passes the item's conversation history into the pipeline (clarification suite)", async () => {
    const { pipeline, calls } = deps();
    const withHistory = {
      ...onTopic,
      id: "ctx-001",
      history: [
        { role: "user" as const, content: "earlier turn" },
        { role: "assistant" as const, content: "earlier answer [1]" },
      ],
    };
    await runItem(withHistory, pipeline);
    assert.deepEqual(calls.answered[0]?.history, withHistory.history);
  });

  it("defaults to an empty history when the item has none", async () => {
    const { pipeline, calls } = deps();
    await runItem(onTopic, pipeline);
    assert.deepEqual(calls.answered[0]?.history, []);
  });

  it("skips the ranking retrieval for off-topic items (no labels to rank)", async () => {
    const { pipeline, calls } = deps();
    const result = await runItem(offTopic, pipeline);
    // the fake pipeline answers everything, so an off-topic item fails scoring
    assert.equal(result.pass, false);
    assert.match(result.failureReasons[0], /outside the knowledge base/);
    assert.deepEqual(calls.ranked, []);
  });
});

describe("runDataset", () => {
  it("runs items sequentially and reports progress in order", async () => {
    const { pipeline, calls } = deps();
    const dataset: EvalDataset = { version: "test", suite: "baseline", description: "", items: [onTopic, offTopic] };
    const progress: string[] = [];
    const results = await runDataset(dataset, pipeline, (_done, _total, item) => progress.push(item.id));

    assert.equal(results.length, 2);
    assert.deepEqual(progress, ["fact-001", "off-001"]);
    assert.deepEqual(calls.ranked, ["on topic question"]); // only the labeled item
    assert.equal(results[0].id, "fact-001");
    assert.equal(results[1].id, "off-001");
  });

  it("records a pipeline failure as a failed item instead of aborting the run", async () => {
    const { pipeline } = deps();
    pipeline.answerQuestion = async () => {
      throw new Error("Groq responded 429");
    };
    const dataset: EvalDataset = { version: "test", suite: "baseline", description: "", items: [onTopic, offTopic] };
    const results = await runDataset(dataset, pipeline);

    assert.equal(results.length, 2);
    for (const result of results) {
      assert.equal(result.pass, false);
      assert.match(result.failureReasons[0], /pipeline error: Groq responded 429/);
      assert.equal(result.model, "error");
      assert.equal(result.metrics.keywordCoverage, null);
    }
    // an errored off-topic item must NOT count as a successful abstention
    assert.equal(results[1].sufficient, true);
  });
});
