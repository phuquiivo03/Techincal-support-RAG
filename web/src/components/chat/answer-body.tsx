"use client";

import { Fragment, type ReactNode } from "react";

/**
 * Minimal safe renderer for assistant answers: paragraphs, fenced code blocks,
 * inline code, and [n] citation markers. The answer is plain text from our own
 * LLM call — we never inject raw HTML.
 */

function renderText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // split into paragraphs and citation markers
  const parts = text.split(/(\[\d+\](?:\[\d+\])*)/g);
  let key = 0;
  for (const part of parts) {
    if (/^\[\d+\](\[\d+\])*$/.test(part)) {
      const nums = part.match(/\d+/g) ?? [];
      nodes.push(
        <sup key={`cite-${key++}`} className="mx-0.5 inline-flex gap-0.5 align-super">
          {nums.map((n) => (
            <span
              key={n}
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/60 px-1 text-[10px] font-semibold leading-none text-stone-900"
            >
              {n}
            </span>
          ))}
        </sup>,
      );
    } else if (part) {
      nodes.push(<Fragment key={`text-${key++}`}>{renderInline(part)}</Fragment>);
    }
  }
  return nodes;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const parts = text.split(/(`[^`]+`)/g);
  let key = 0;
  for (const part of parts) {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      nodes.push(
        <code
          key={`code-${key++}`}
          className="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-[0.85em] text-stone-800"
        >
          {part.slice(1, -1)}
        </code>,
      );
    } else if (part) {
      nodes.push(<Fragment key={`t-${key++}`}>{part}</Fragment>);
    }
  }
  return nodes;
}

export function AnswerBody({ answer }: { answer: string }) {
  const segments = answer.split(/```/);

  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-stone-800">
      {segments.map((segment, i) => {
        if (i % 2 === 1) {
          // fenced code block — first line may be a language tag
          const lines = segment.split("\n");
          const firstLine = lines[0]?.trim();
          const hasLang = firstLine !== undefined && firstLine.length > 0 && !firstLine.includes(" ");
          const code = hasLang ? lines.slice(1).join("\n") : segment;
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-2xl bg-stone-900 p-4 text-[13px] leading-relaxed text-stone-100"
            >
              <code>{code.replace(/\n$/, "")}</code>
            </pre>
          );
        }
        return segment
          .split(/\n{2,}/)
          .map((para) => para.trim())
          .filter(Boolean)
          .map((para, j) => <p key={`${i}-${j}`}>{renderText(para)}</p>);
      })}
    </div>
  );
}
