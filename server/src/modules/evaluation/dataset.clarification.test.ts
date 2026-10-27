import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listDatasets, loadDataset } from "./dataset.js";

/**
 * clarification-v1 dataset tests (2026-10-25). Guards the new suite's structure
 * (ambiguity expectations, history usage, missing-detail caveat labels) and the
 * immutability contract: v1/v2/robustness-v1 are never rewritten in place.
 */

describe("clarification-v1 dataset", () => {
  it("loads, declares the clarification suite and covers all required case types", async () => {
    const dataset = await loadDataset("clarification-v1");
    assert.equal(dataset.version, "clarification-v1");
    assert.equal(dataset.suite, "clarification");
    assert.ok(dataset.items.length >= 12, `expected >= 12 items, got ${dataset.items.length}`);

    const categories = new Set(dataset.items.map((i) => i.category));
    for (const required of ["ambiguous", "contextual", "underspecified", "unanswerable", "off_topic", "partial_evidence"] as const) {
      assert.ok(categories.has(required), `dataset must cover ${required}`);
    }
  });

  it("every item declares an expected behavior consistent with its category", async () => {
    const dataset = await loadDataset("clarification-v1");
    const behaviors = new Set(dataset.items.map((i) => i.expectedBehavior));
    // the suite must exercise both sides: when to ask, and when NOT to ask
    for (const behavior of ["clarify", "answer", "partial", "abstain"] as const) {
      assert.ok(behaviors.has(behavior), `dataset must contain ${behavior} items`);
    }
    for (const item of dataset.items) {
      assert.ok(item.expectedBehavior, `${item.id} must declare expectedBehavior`);
      if (item.category === "ambiguous") {
        assert.equal(item.expectedBehavior, "clarify", `${item.id}: ambiguous → clarify`);
      }
      if (item.category === "contextual") {
        assert.equal(item.expectedBehavior, "answer", `${item.id}: contextual → answer`);
        assert.ok(item.history.length > 0, `${item.id}: contextual items need history`);
      }
    }
  });

  it("clarify items label the MISSING DETAIL via caveatKeywords (not generic filler)", async () => {
    const dataset = await loadDataset("clarification-v1");
    const clarify = dataset.items.filter((i) => i.expectedBehavior === "clarify");
    assert.ok(clarify.length >= 4, `expected >= 4 clarify items, got ${clarify.length}`);
    for (const item of clarify) {
      assert.ok(item.caveatKeywords.length >= 2, `${item.id}: clarify items must label the missing detail`);
      // generic words like "question mark" tell nothing — each label must name a
      // detail dimension (which/component/version/workload/...) or a candidate value
      const generic = item.caveatKeywords.filter((k) => ["could you", "please", "tell me"].includes(k));
      assert.deepEqual(generic, [], `${item.id}: caveatKeywords must not be generic politeness fillers`);
    }
  });

  it("exactly one clarify item combines ambiguity with conflicting KB documents", async () => {
    const dataset = await loadDataset("clarification-v1");
    const conflict = dataset.items.filter((i) => i.id === "cl-conflict-001");
    assert.equal(conflict.length, 1);
    assert.equal(conflict[0].expectedBehavior, "clarify");
    assert.match(conflict[0].expectedAnswer, /CONFLICTING|conflict/i);
  });

  it("labels reference real KB file names", async () => {
    const dataset = await loadDataset("clarification-v1");
    const kb = new Set([
      "postgres-deadlock.md",
      "nginx-502-upstream.md",
      "postgres-slow-query-log.md",
      "redis-oom-eviction.md",
      "nodejs-graceful-shutdown.md",
      "postgres-statement-timeout-incident.md",
      "nginx-rate-limiting.md",
      "postgres-pool-exhaustion.md",
      "websocket-drops.md",
      "nodejs-event-loop-blocking.md",
      "postgres-statement-timeout-runbook.md",
      "docker-container-oom.md",
    ]);
    for (const item of dataset.items) {
      for (const file of item.expectedFileNames) {
        assert.ok(kb.has(file), `${item.id} labels unknown doc ${file}`);
      }
    }
  });

  it("history messages alternate sensibly and end before the question", async () => {
    const dataset = await loadDataset("clarification-v1");
    for (const item of dataset.items) {
      for (const message of item.history) {
        assert.ok(["user", "assistant"].includes(message.role));
        assert.ok(message.content.length >= 1);
      }
      // history never ends with the question itself (the runner appends it)
      const last = item.history.at(-1);
      assert.ok(!last || last.role !== "user" || last.content !== item.question, `${item.id}: history must not duplicate the question`);
    }
  });
});

describe("published datasets stay immutable", () => {
  it("v1, v2 and robustness-v1 are untouched by the clarification suite", async () => {
    const v1 = await loadDataset("v1");
    assert.equal(v1.items.length, 23);
    assert.equal(v1.suite, "baseline");
    assert.ok(v1.items.every((i) => i.history.length === 0), "v1 must not gain history");

    const v2 = await loadDataset("v2");
    assert.equal(v2.items.length, 15);
    assert.equal(v2.suite, "baseline");

    const rb = await loadDataset("robustness-v1");
    assert.equal(rb.items.length, 29);
    assert.equal(rb.suite, "robustness");
    assert.ok(rb.items.every((i) => i.history.length === 0), "robustness-v1 must not gain history");
  });

  it("clarification-v1 keeps its original 14 items and caveat labels", async () => {
    const dataset = await loadDataset("clarification-v1");
    assert.equal(dataset.items.length, 14);
    const conflict = dataset.items.find((i) => i.id === "cl-conflict-001");
    assert.deepEqual(conflict?.caveatKeywords, ["workload", "which", "oltp", "reporting"]);
  });

  it("clarification-v2 is structurally identical to v1 except widened caveat labels", async () => {
    const v1 = await loadDataset("clarification-v1");
    const v2 = await loadDataset("clarification-v2");
    assert.equal(v2.suite, "clarification");
    assert.equal(v2.items.length, v1.items.length);
    for (const [i, item] of v2.items.entries()) {
      const old = v1.items[i];
      assert.equal(item.id, old.id);
      assert.equal(item.question, old.question);
      assert.equal(item.expectedBehavior, old.expectedBehavior);
      assert.deepEqual(item.history, old.history);
      assert.deepEqual(item.expectedFileNames, old.expectedFileNames);
      assert.deepEqual(item.expectedKeywords, old.expectedKeywords);
      // widened labels are a SUPERSET: nothing was dropped, only phrasing-robust
      // discriminators of the same missing detail were added
      for (const keyword of old.caveatKeywords) {
        assert.ok(item.caveatKeywords.includes(keyword), `${item.id} dropped label "${keyword}"`);
      }
    }
    // exactly two items were widened
    const widened = v2.items.filter((item, i) => item.caveatKeywords.length > v1.items[i].caveatKeywords.length);
    assert.equal(widened.length, 2);
  });

  it("listDatasets reports all three suites", async () => {
    const datasets = await listDatasets();
    const clarification = datasets.find((d) => d.version === "clarification-v1");
    assert.ok(clarification, "clarification-v1 should be listed");
    assert.equal(clarification!.suite, "clarification");
    for (const [version, suite] of [["v1", "baseline"], ["v2", "baseline"], ["robustness-v1", "robustness"]] as const) {
      assert.equal(datasets.find((d) => d.version === version)?.suite, suite);
    }
  });
});
