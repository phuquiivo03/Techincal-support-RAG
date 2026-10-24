export interface ChunkOptions {
  /** target chunk size in characters */
  maxSize: number;
  /** characters of tail overlap between consecutive chunks in the same section */
  overlap: number;
}

export interface TextChunk {
  content: string;
  index: number;
  /** rough token estimate (chars / 4) */
  tokens: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxSize: 900, overlap: 150 };

const HEADING_RE = /^#{1,6}\s+\S/;

/**
 * Split text into retrieval-friendly chunks.
 *
 * Strategy: split Markdown into heading-delimited sections; within each section
 * pack paragraphs greedily up to `maxSize`; consecutive chunks in the same
 * section share `overlap` characters of tail context; non-first chunks keep
 * their section heading as a context prefix. Oversized paragraphs are hard-split
 * on sentence, then word boundaries.
 */
export function chunkText(text: string, options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): TextChunk[] {
  const { maxSize, overlap } = options;
  const contents: string[] = [];

  for (const section of splitSections(text)) {
    const heading = section.match(HEADING_RE)?.[0] ?? null;
    const body = heading ? section.slice(heading.length) : section;
    const headingPrefix = heading ? `${heading}\n` : "";

    const pieces: string[] = [];
    for (const paragraph of body.split(/\n{2,}/)) {
      const p = paragraph.trim();
      if (!p) continue;
      if (p.length <= maxSize) {
        pieces.push(p);
      } else {
        pieces.push(...hardSplit(p, maxSize));
      }
    }

    let current = "";
    for (const piece of pieces) {
      const candidate = current ? `${current}\n\n${piece}` : `${headingPrefix}${piece}`.trim();
      if (candidate.length > maxSize && current) {
        contents.push(current);
        // carry overlap tail + heading context into the next chunk
        const tail = tailOf(current, overlap);
        current = [headingPrefix.trim(), tail, piece].filter(Boolean).join("\n\n");
      } else {
        current = candidate;
      }
    }
    if (current.trim()) contents.push(current.trim());
  }

  return contents.map((content, index) => ({
    content,
    index,
    tokens: Math.ceil(content.length / 4),
  }));
}

/** Split into heading-delimited sections (heading line included at section start). */
function splitSections(text: string): string[] {
  const lines = text.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (HEADING_RE.test(line.trim())) {
      if (current.some((l) => l.trim())) sections.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.some((l) => l.trim())) sections.push(current.join("\n"));

  return sections.length > 0 ? sections : [text].filter((t) => t.trim());
}

/** Split an oversized paragraph on sentence, then word boundaries. */
function hardSplit(text: string, maxSize: number): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [text];
  const out: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > maxSize) {
      // fall back to word-boundary split for giant sentences
      let words = sentence.split(/(\s+)/);
      for (const word of words) {
        if (current.length + word.length > maxSize && current.trim()) {
          out.push(current.trim());
          current = "";
        }
        current += word;
      }
    } else if (current.length + sentence.length > maxSize && current.trim()) {
      out.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Last up-to-`size` characters of text, cut to a word boundary. */
function tailOf(text: string, size: number): string {
  if (text.length <= size) return text;
  const tail = text.slice(-size);
  const firstSpace = tail.indexOf(" ");
  return firstSpace > 0 ? tail.slice(firstSpace + 1) : tail;
}
