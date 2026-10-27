import { splitCodeSegments } from "../../lib/text.js";

/**
 * gpt-oss nondeterministically emits citations as 【n】 or 【1†L9-L12】 (CJK
 * lenticular brackets, sometimes with an invented line-range annotation)
 * instead of the [n] the prompt asks for. The UI can only link ASCII [n]
 * markers, so rewrite the glyph while preserving the referenced index — the
 * marker still points at the same source block. Code spans/fences are left
 * untouched: a [n]-shaped token there is syntax, not a citation.
 */
const LENTICULAR_MARKER_RE = /【(\d{1,2})(?:[^】]{0,24})?】/g;
/** Annotated ASCII form [2†L1-L4] — the † makes it unambiguous vs array syntax. */
const ANNOTATED_ASCII_MARKER_RE = /\[(\d{1,2})†[^\]\n]{0,24}\]/g;

export function normalizeCitationMarkers(answer: string): string {
  return splitCodeSegments(answer)
    .map((segment) =>
      segment.code
        ? segment.text
        : segment.text
            .replaceAll(LENTICULAR_MARKER_RE, "[$1]")
            .replaceAll(ANNOTATED_ASCII_MARKER_RE, "[$1]"),
    )
    .join("");
}
