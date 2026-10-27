/**
 * Text segmentation shared by the citation parser (evaluation) and the citation
 * normalizer (chat): fenced ``` blocks and `inline` spans are CODE — a [n]
 * inside them is array-index syntax, not a citation marker, and must never be
 * rewritten or counted.
 */

export interface TextSegment {
  text: string;
  code: boolean;
}

const FENCE_RE = /```[\s\S]*?(?:```|$)/g; // unterminated fence runs to the end
const INLINE_RE = /`[^`\n]*`/g;

/** Split text into code and prose segments, preserving order and full content. */
export function splitCodeSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];

  const pushProse = (part: string): void => {
    if (!part) return;
    let last = 0;
    for (const match of part.matchAll(INLINE_RE)) {
      if (match.index > last) segments.push({ text: part.slice(last, match.index), code: false });
      segments.push({ text: match[0], code: true });
      last = match.index + match[0].length;
    }
    if (last < part.length) segments.push({ text: part.slice(last), code: false });
  };

  let lastFence = 0;
  for (const match of text.matchAll(FENCE_RE)) {
    pushProse(text.slice(lastFence, match.index));
    segments.push({ text: match[0], code: true });
    lastFence = match.index + match[0].length;
  }
  pushProse(text.slice(lastFence));
  return segments;
}

/** Concatenated prose (non-code) segments — the region citation markers live in. */
export function proseOnly(text: string): string {
  return splitCodeSegments(text)
    .filter((s) => !s.code)
    .map((s) => s.text)
    .join(" ");
}
