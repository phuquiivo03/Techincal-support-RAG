import type { ChatBehavior } from "@rag/shared";

/**
 * Machine-readable output contract for the chat pipeline (2026-10-25): the
 * model puts `BEHAVIOR: answer|clarify|partial_answer|abstain` alone on the
 * first non-empty line and the response body below it. One deterministic parse
 * here decides the behavior — no extra LLM call, no schema-mode dependency on
 * the provider.
 */

export const BEHAVIORS = [
  "answer",
  "clarify",
  "partial_answer",
  "abstain",
] as const satisfies readonly ChatBehavior[];

const BEHAVIOR_LINE_RE = /^\s*BEHAVIOR:\s*([a-zA-Z_]+)\s*$/i;

export interface ParsedModelOutput {
  behavior: ChatBehavior;
  /** response body with the directive line removed */
  answer: string;
}

function isBehavior(value: string): value is ChatBehavior {
  return (BEHAVIORS as readonly string[]).includes(value);
}

/**
 * Split a raw completion into behavior + body. Degradation rules:
 * - no directive (or malformed value): fall back to behavior "answer" with the
 *   full text as the answer — the legacy single-behavior pipeline — so an
 *   instruction slip can never blank out responses;
 * - a directive with an empty body is a generation failure: throw (the global
 *   error middleware turns it into a 502-style JSON response).
 */
export function parseModelOutput(raw: string): ParsedModelOutput {
  const text = raw.replace(/^\uFEFF/, "");
  const lines = text.split("\n");
  const firstNonEmpty = lines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmpty === -1) {
    throw new Error("model returned an empty completion");
  }

  const match = lines[firstNonEmpty]?.match(BEHAVIOR_LINE_RE);
  if (!match) {
    return { behavior: "answer", answer: text.trim() };
  }

  const value = match[1].toLowerCase();
  const body = lines.slice(firstNonEmpty + 1).join("\n").trim();
  if (!isBehavior(value)) {
    // directive present but the value is out of contract — keep the body, drop the line
    if (body.length === 0) throw new Error(`model returned an unparseable behavior directive: ${match[1]}`);
    return { behavior: "answer", answer: body };
  }
  if (body.length === 0) {
    throw new Error(`model declared BEHAVIOR: ${value} but returned no response body`);
  }
  return { behavior: value, answer: body };
}
