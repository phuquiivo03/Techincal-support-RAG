"use client";

import type { ChatBehavior, Citation, Timings } from "@rag/shared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { AnswerBody } from "./answer-body";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Citation[];
  sufficient?: boolean;
  /** which behavior the pipeline decided on (clarify renders its own card) */
  behavior?: ChatBehavior;
  timings?: Timings;
  model?: string;
}

function SourceChips({ sources }: { sources: Citation[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((s) => (
        <Popover key={s.chunkId}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="group inline-flex max-w-64 items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)] transition-colors duration-300 hover:border-primary hover:text-stone-900"
            >
              <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary/60 text-[10px] font-semibold text-stone-900">
                {s.index}
              </span>
              <span className="truncate">{s.documentTitle}</span>
              <span className="shrink-0 text-stone-400 group-hover:text-primary">
                {s.score.toFixed(2)}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-80 rounded-2xl border-stone-100 p-4 text-sm shadow-[0_4px_20px_-2px_rgba(0,0,0,0.08)]">
            <p className="mb-1 font-medium text-stone-900">{s.documentTitle}</p>
            <p className="mb-2 text-xs text-stone-500">
              chunk #{s.index} · similarity {s.score.toFixed(3)}
            </p>
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-stone-50 p-2.5 font-mono text-[11px] leading-relaxed text-stone-700">
              {s.snippet}
            </p>
          </PopoverContent>
        </Popover>
      ))}
    </div>
  );
}

function LatencyBadge({ timings, model }: { timings: Timings; model?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-400">
      <span title="total request duration">{(timings.totalMs / 1000).toFixed(2)}s total</span>
      <span>·</span>
      <span>embed {timings.embedMs.toFixed(0)}ms</span>
      <span>·</span>
      <span>retrieval {timings.retrievalMs.toFixed(0)}ms</span>
      <span>·</span>
      <span>llm {timings.llmMs.toFixed(0)}ms</span>
      {model ? (
        <>
          <span>·</span>
          <span className="truncate">{model}</span>
        </>
      ) : null}
    </div>
  );
}

export function ChatMessage({ message }: { message: UiMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-primary px-4 py-2.5 text-[15px] font-medium leading-relaxed text-stone-900 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)] sm:max-w-[70%]">
          {message.content}
        </div>
      </div>
    );
  }

  // Abstain: the retrieval gate found nothing above threshold, or the model
  // refused an uncovered question — amber "not in the knowledge base" card.
  if (message.sufficient === false || message.behavior === "abstain") {
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[92%] space-y-3 rounded-3xl rounded-bl-lg border border-amber-200 bg-amber-50 p-4 sm:max-w-[80%]">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-amber-300 bg-amber-100/60 text-amber-800">
              Not in the knowledge base
            </Badge>
          </div>
          <AnswerBody answer={message.content} />
          {message.timings ? (
            <LatencyBadge timings={message.timings} model={message.model} />
          ) : null}
        </div>
      </div>
    );
  }

  // Clarify: essential information is missing — the assistant asks one targeted
  // question instead of guessing. Distinct card so it never reads as an answer.
  if (message.behavior === "clarify") {
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[92%] space-y-3 rounded-3xl rounded-bl-lg border border-stone-200 bg-accent p-4 sm:max-w-[80%]">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-stone-300 bg-white/70 text-stone-700">
              Needs one more detail
            </Badge>
          </div>
          <AnswerBody answer={message.content} />
          {message.sources && message.sources.length > 0 ? (
            <div className="space-y-1.5 border-t border-stone-200/70 pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Found in the knowledge base</p>
              <SourceChips sources={message.sources} />
            </div>
          ) : null}
          {message.timings ? (
            <LatencyBadge timings={message.timings} model={message.model} />
          ) : null}
        </div>
      </div>
    );
  }

  // Answer (default) and partial_answer — partial adds a badge admitting the gap.
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[92%] space-y-3 rounded-3xl rounded-bl-lg border border-stone-100 bg-card p-4 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)] sm:max-w-[80%]">
        {message.behavior === "partial_answer" ? (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
              Partial answer — part is not covered
            </Badge>
          </div>
        ) : null}
        <AnswerBody answer={message.content} />
        {message.sources && message.sources.length > 0 ? (
          <div className="space-y-1.5 border-t border-stone-100 pt-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Sources</p>
            <SourceChips sources={message.sources} />
          </div>
        ) : null}
        {message.timings ? <LatencyBadge timings={message.timings} model={message.model} /> : null}
      </div>
    </div>
  );
}
