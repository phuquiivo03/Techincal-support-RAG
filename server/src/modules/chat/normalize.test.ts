import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeCitationMarkers } from "./normalize.js";

/** Regression tests for the 2026-10-24 failure analysis (docs/EVAL_FAILURE_ANALYSIS.md):
 *  gpt-oss emitted 【n】 and 【n†Lx-Ly】 citations the UI cannot link. */
describe("normalizeCitationMarkers", () => {
  it("rewrites plain lenticular markers to ASCII", () => {
    assert.equal(normalizeCitationMarkers("surfaces as a 500 response【5】."), "surfaces as a 500 response[5].");
  });

  it("rewrites annotated lenticular markers, dropping the invented line range", () => {
    assert.equal(
      normalizeCitationMarkers("closed early (crash, pool exhaustion)【1†L9-L12】【4†L2-L4】."),
      "closed early (crash, pool exhaustion)[1][4].",
    );
  });

  it("rewrites annotated ASCII markers with the dagger form", () => {
    assert.equal(normalizeCitationMarkers("see block【2†L1-L4】 and [3†L2-L5]."), "see block[2] and [3].");
  });

  it("keeps multiple adjacent markers and their order", () => {
    assert.equal(normalizeCitationMarkers("claim【1】【2】 tail【1】"), "claim[1][2] tail[1]");
  });

  it("leaves code spans and fenced blocks untouched", () => {
    const answer = "set `lock:key【0】` first, then:\n\n```js\nconst a = ids[1]; // 【2】\n```\nfinally【2】.";
    const normalized = normalizeCitationMarkers(answer);
    assert.ok(normalized.includes("`lock:key【0】`"));
    assert.ok(normalized.includes("const a = ids[1]; // 【2】"));
    assert.ok(normalized.endsWith("finally[2]."));
  });

  it("leaves prose without citation-like tokens unchanged", () => {
    const plain = "Set proxy_read_timeout above p99. No markers here 【just words】.";
    assert.equal(normalizeCitationMarkers(plain), plain);
  });
});
