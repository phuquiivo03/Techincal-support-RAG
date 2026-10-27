import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EvalExpectedBehavior } from "@rag/shared";
import { listDatasets, loadDataset } from "./dataset.js";

/**
 * robustness-v1 dataset tests (2026-10-25). Also asserts the immutability
 * contract: v1/v2 keep their item counts, categories and baseline suite —
 * the robustness suite must extend, never rewrite, the baseline sets.
 */

const ROBUSTNESS_CATEGORIES = [
  "mixed_language",
  "informal",
  "underspecified",
  "unanswerable",
  "outdated",
  "multi_condition",
] as const;

describe("robustness-v1 dataset", () => {
  it("loads, declares the robustness suite and covers all robustness categories", async () => {
    const dataset = await loadDataset("robustness-v1");
    assert.equal(dataset.version, "robustness-v1");
    assert.equal(dataset.suite, "robustness");
    assert.ok(dataset.items.length >= 20, `expected >= 20 items, got ${dataset.items.length}`);

    const categories = new Set(dataset.items.map((i) => i.category));
    for (const category of ROBUSTNESS_CATEGORIES) {
      assert.ok(categories.has(category), `dataset must cover ${category}`);
    }
    // and the robustness spin on baseline categories
    for (const required of ["typo", "paraphrase", "partial_evidence", "contradiction", "long_doc", "misleading_premise", "injection", "multi_doc", "off_topic"] as const) {
      assert.ok(categories.has(required), `dataset must cover ${required}`);
    }
  });

  it("every item declares an expected behavior consistent with its labels", async () => {
    const dataset = await loadDataset("robustness-v1");
    const behaviors = new Set<EvalExpectedBehavior>();
    for (const item of dataset.items) {
      assert.ok(item.expectedBehavior, `${item.id} must declare expectedBehavior`);
      behaviors.add(item.expectedBehavior);
      if (item.expectedBehavior === "abstain") {
        assert.deepEqual(item.expectedFileNames, [], `${item.id}: abstain items carry no doc labels`);
        assert.deepEqual(item.expectedKeywords, [], `${item.id}: abstain items carry no keywords`);
      }
      if (item.expectedBehavior === "answer" || item.expectedBehavior === "partial") {
        assert.ok(item.expectedFileNames.length > 0, `${item.id}: ${item.expectedBehavior} needs doc labels`);
        assert.ok(item.expectedKeywords.length > 0, `${item.id}: ${item.expectedBehavior} needs keywords`);
      }
      if (item.expectedBehavior === "partial") {
        assert.ok(item.caveatKeywords.length > 0, `${item.id}: partial items need caveatKeywords`);
      }
    }
    // the suite exercises all four behaviors
    for (const behavior of ["answer", "partial", "clarify", "abstain"] as const) {
      assert.ok(behaviors.has(behavior), `dataset must contain ${behavior} items`);
    }
  });

  it("injection items carry the canary phrases as forbiddenKeywords", async () => {
    const dataset = await loadDataset("robustness-v1");
    const injections = dataset.items.filter((i) => i.category === "injection");
    assert.ok(injections.length >= 2);
    for (const item of injections) {
      assert.ok(
        item.forbiddenKeywords.includes("INJECTION-SUCCESS-7f3a") &&
          item.forbiddenKeywords.includes("attacker.invalid"),
        `${item.id} must forbid the canary phrases`,
      );
      assert.deepEqual(item.caveatKeywords, []);
    }
  });

  it("labels reference real KB file names", async () => {
    const dataset = await loadDataset("robustness-v1");
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

  it("mixed-language items contain non-ASCII Vietnamese text", async () => {
    const dataset = await loadDataset("robustness-v1");
    const mixed = dataset.items.filter((i) => i.category === "mixed_language");
    assert.ok(mixed.length >= 3);
    for (const item of mixed) {
      assert.ok(/[^\x00-\x7F]/.test(item.question), `${item.id} should contain Vietnamese diacritics or text`);
    }
  });
});

describe("baseline immutability", () => {
  it("v1 and v2 are unchanged and stay in the baseline suite", async () => {
    const v1 = await loadDataset("v1");
    assert.equal(v1.suite, "baseline");
    assert.equal(v1.items.length, 23);
    for (const item of v1.items) {
      assert.equal(item.expectedBehavior, undefined, `${item.id}: v1 must not gain behavior labels`);
      assert.deepEqual(item.caveatKeywords, []);
      assert.deepEqual(item.forbiddenKeywords, []);
    }

    const v2 = await loadDataset("v2");
    assert.equal(v2.suite, "baseline");
    assert.equal(v2.items.length, 15);
    for (const item of v2.items) {
      assert.equal(item.expectedBehavior, undefined, `${item.id}: v2 must not gain behavior labels`);
    }
  });

  it("listDatasets reports both suites", async () => {
    const datasets = await listDatasets();
    const robustness = datasets.find((d) => d.version === "robustness-v1");
    assert.ok(robustness, "robustness-v1 should be listed");
    assert.equal(robustness!.suite, "robustness");
    assert.ok((robustness!.categories.mixed_language ?? 0) >= 3);
    for (const baseline of ["v1", "v2"]) {
      assert.equal(datasets.find((d) => d.version === baseline)?.suite, "baseline");
    }
  });
});
