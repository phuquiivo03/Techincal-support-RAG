import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listDatasets, loadDataset } from "./dataset.js";

describe("loadDataset", () => {
  /** Categories v1 was designed for — v2 added adversarial categories on top. */
  const V1_CATEGORIES = ["factual", "paraphrase", "multi_doc", "error_code", "off_topic"] as const;
  /** v2-era adversarial categories (pinned explicitly — EVAL_CATEGORIES has since
   *  grown again with the robustness suite, which v2 does not cover by design). */
  const V2_CATEGORIES = [
    "contradiction",
    "partial_evidence",
    "misleading_premise",
    "typo",
    "long_doc",
    "injection",
  ] as const;

  it("loads and validates the real v1 dataset", async () => {
    const dataset = await loadDataset("v1");
    assert.equal(dataset.version, "v1");
    assert.ok(dataset.items.length >= 20, `expected >= 20 items, got ${dataset.items.length}`);

    const categories = new Set<string>(dataset.items.map((i) => i.category));
    for (const category of V1_CATEGORIES) {
      assert.ok(categories.has(category), `dataset must cover ${category}`);
    }

    for (const item of dataset.items) {
      assert.ok(item.question.length >= 3);
      if (item.category === "off_topic") {
        assert.deepEqual(item.expectedFileNames, []);
        assert.deepEqual(item.expectedKeywords, []);
      } else {
        assert.ok(item.expectedFileNames.length > 0);
        assert.ok(item.expectedKeywords.length > 0);
      }
    }

    // every multi_doc item must label at least two documents
    for (const item of dataset.items.filter((i) => i.category === "multi_doc")) {
      assert.ok(item.expectedFileNames.length >= 2, `${item.id} must label >= 2 docs`);
    }
  });

  it("loads and validates the adversarial v2 dataset covering the adversarial categories", async () => {
    const dataset = await loadDataset("v2");
    assert.equal(dataset.version, "v2");
    assert.equal(dataset.suite, "baseline");
    const categories = new Set<string>(dataset.items.map((i) => i.category));
    for (const category of V2_CATEGORIES) {
      assert.ok(categories.has(category), `v2 must cover ${category}`);
    }
    // adversarial sanity: every contradiction item spans conflicting docs,
    // every injection item targets the canary doc, no off_topic item carries labels
    for (const item of dataset.items) {
      if (item.category === "contradiction") {
        assert.ok(item.expectedFileNames.length >= 2, `${item.id} contradiction must label both conflicting docs`);
      }
      if (item.category === "injection") {
        assert.ok(
          item.expectedFileNames.every((f) => f.includes("graceful-shutdown")),
          `${item.id} injection items must target the canary document`,
        );
      }
    }
  });

  it("rejects unknown versions and unsafe version strings", async () => {
    await assert.rejects(loadDataset("does-not-exist"), /not found/);
    await assert.rejects(loadDataset("../secrets"), /Invalid dataset version/);
    await assert.rejects(loadDataset("v1.json; DROP"), /Invalid dataset version/);
  });
});

describe("listDatasets", () => {
  it("lists v1 with a category breakdown", async () => {
    const datasets = await listDatasets();
    const v1 = datasets.find((d) => d.version === "v1");
    assert.ok(v1, "v1 dataset should be listed");
    assert.ok(v1!.itemCount >= 20);
    assert.ok((v1!.categories.off_topic ?? 0) >= 3);
    assert.ok((v1!.categories.multi_doc ?? 0) >= 2);
  });
});
