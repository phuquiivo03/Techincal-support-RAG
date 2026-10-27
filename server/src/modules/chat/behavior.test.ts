import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseModelOutput } from "./behavior.js";

/**
 * Output-contract parser tests (2026-10-25): the model must put
 * `BEHAVIOR: <one of four>` on the first non-empty line. Malformed output
 * degrades to the legacy "answer" pipeline instead of failing the request;
 * an empty completion throws so the error middleware can report it.
 */

describe("parseModelOutput", () => {
  it("parses every valid behavior and strips the directive line", () => {
    for (const behavior of ["answer", "clarify", "partial_answer", "abstain"] as const) {
      const parsed = parseModelOutput(`BEHAVIOR: ${behavior}\n\nBody text [1].\nMore.`);
      assert.equal(parsed.behavior, behavior);
      assert.equal(parsed.answer, "Body text [1].\nMore.");
    }
  });

  it("tolerates no space after the colon, casing and surrounding whitespace", () => {
    const parsed = parseModelOutput("\n\n  behavior:CLARIFY  \n\nWhich component is slow?");
    assert.equal(parsed.behavior, "clarify");
    assert.equal(parsed.answer, "Which component is slow?");
  });

  it("falls back to behavior=answer when the directive is missing entirely", () => {
    const parsed = parseModelOutput("Set statement_timeout = '30s' [1].");
    assert.equal(parsed.behavior, "answer");
    assert.equal(parsed.answer, "Set statement_timeout = '30s' [1].");
  });

  it("falls back to behavior=answer when the directive value is out of contract", () => {
    const parsed = parseModelOutput("BEHAVIOR: maybe\n\nHere is the fix [1].");
    assert.equal(parsed.behavior, "answer");
    assert.equal(parsed.answer, "Here is the fix [1].");
  });

  it("ignores a BEHAVIOR-looking line that is not the first non-empty line", () => {
    const parsed = parseModelOutput("Here is the fix:\nBEHAVIOR: clarify\nRun the command [1].");
    assert.equal(parsed.behavior, "answer");
    assert.ok(parsed.answer.includes("BEHAVIOR: clarify"));
  });

  it("keeps the body intact when the body itself contains a code fence with BEHAVIOR:", () => {
    const body = 'BEHAVIOR: answer\n\n```bash\n# not a directive\necho "BEHAVIOR: clarify"\n```';
    const parsed = parseModelOutput(body);
    assert.equal(parsed.behavior, "answer");
    assert.ok(parsed.answer.includes('echo "BEHAVIOR: clarify"'));
  });

  it("throws on a completely empty completion (generation failure)", () => {
    assert.throws(() => parseModelOutput("\n  \n"), /empty completion/);
  });

  it("throws when a directive declares a behavior but the body is empty", () => {
    assert.throws(() => parseModelOutput("BEHAVIOR: clarify\n\n  "), /no response body/);
    assert.throws(() => parseModelOutput("BEHAVIOR: maybe"), /unparseable behavior directive/);
  });
});
