"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders assistant answers as real markdown (bold, lists, headings, tables,
 * fenced code) plus [n] citation markers styled as chips.
 *
 * Citation trick: `[1]` is rewritten to a pseudo-link `[1](#cite-1)` before
 * parsing — react-markdown then hands it to our `a` renderer, which turns
 * `#cite-*` back into a chip. `(?!\()` keeps real markdown links untouched.
 */
function preprocessCitations(text: string): string {
  return text.replace(/\[(\d{1,2})\](?!\()/g, (_m, n: string) => `[${n}](#cite-${n})`);
}

function CiteChip({ n }: { n: number }) {
  return (
    <span className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-0.5 items-center justify-center rounded-full bg-primary/60 px-1 text-[10px] font-semibold leading-none text-stone-900">
      {n}
    </span>
  );
}

const components: Components = {
  a: ({ href, children }) => {
    const cite = href?.match(/^#cite-(\d+)$/);
    if (cite) return <CiteChip n={Number(cite[1])} />;
    return (
      <a href={href} className="underline underline-offset-2 hover:text-stone-900">
        {children}
      </a>
    );
  },
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-2xl bg-stone-900 p-4 text-[13px] leading-relaxed text-stone-100">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const isBlock = Boolean(className?.includes("language-")) || String(children).includes("\n");
    if (isBlock) return <code className={`font-mono ${className ?? ""}`}>{children}</code>;
    return (
      <code className="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[0.85em] text-stone-800">
        {children}
      </code>
    );
  },
  p: ({ children }) => <p>{children}</p>,
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-stone-900">{children}</strong>,
  h2: ({ children }) => (
    <h2 className="text-base font-semibold tracking-tight text-stone-900">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-[15px] font-semibold tracking-tight text-stone-900">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-[15px] font-semibold text-stone-900">{children}</h4>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-stone-200 px-3 py-1.5 text-left font-medium text-stone-700">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-stone-100 px-3 py-1.5 align-top text-stone-600">{children}</td>
  ),
};

export function AnswerBody({ answer }: { answer: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-stone-800">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {preprocessCitations(answer)}
      </ReactMarkdown>
    </div>
  );
}
