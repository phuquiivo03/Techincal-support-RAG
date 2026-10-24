"use client";

import { useState } from "react";
import Link from "next/link";
import type { RetrieveResponse } from "@rag/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

function scoreColor(score: number): string {
  if (score >= 0.5) return "bg-primary";
  if (score >= 0.4) return "bg-primary/60";
  return "bg-stone-300";
}

export function DebuggerClient() {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [threshold, setThreshold] = useState(0.5);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RetrieveResponse | null>(null);

  const run = async () => {
    if (query.trim().length < 3 || pending) return;
    setPending(true);
    setResult(null);
    try {
      setResult(await api.retrieve({ query: query.trim(), topK, threshold }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retrieval failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="space-y-4 rounded-4xl border border-stone-100 bg-white p-5 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)] sm:p-6">
        <div className="space-y-2">
          <Label htmlFor="debug-query" className="text-sm text-stone-600">
            Query to test against the vector store
          </Label>
          <div className="flex gap-2">
            <Input
              id="debug-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void run()}
              placeholder="e.g. why is my container killed with exit code 137"
              className="h-11 rounded-full border-stone-200 bg-stone-50 px-4 text-[15px]"
            />
            <Button
              onClick={() => void run()}
              disabled={pending || query.trim().length < 3}
              className="h-11 rounded-full bg-stone-900 px-6 text-sm font-medium text-[#FDFCF8] transition-transform duration-300 hover:scale-[1.02] disabled:opacity-40"
            >
              Run
            </Button>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <Label htmlFor="topk" className="text-stone-600">Top-K results</Label>
              <span className="tabular-nums text-stone-500">{topK}</span>
            </div>
            <Slider
              id="topk"
              min={1}
              max={10}
              step={1}
              value={[topK]}
              onValueChange={(v) => setTopK(v[0] ?? 5)}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <Label htmlFor="threshold" className="text-stone-600">Similarity threshold</Label>
              <span className="tabular-nums text-stone-500">{threshold.toFixed(2)}</span>
            </div>
            <Slider
              id="threshold"
              min={0}
              max={0.8}
              step={0.05}
              value={[threshold]}
              onValueChange={(v) => setThreshold(v[0] ?? 0.3)}
            />
          </div>
        </div>
      </div>

      {pending ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full rounded-3xl" />
          <Skeleton className="h-20 w-full rounded-3xl" />
          <Skeleton className="h-20 w-full rounded-3xl" />
        </div>
      ) : null}

      {result ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
            <span>
              <strong className="text-stone-800">{result.results.length}</strong> of top-
              {result.topK} cleared threshold {result.threshold.toFixed(2)}
            </span>
            <span>·</span>
            <span>embed {result.timings.embedMs.toFixed(0)}ms</span>
            <span>·</span>
            <span>pgvector {result.timings.retrievalMs.toFixed(0)}ms</span>
            <span>·</span>
            <span>total {result.timings.totalMs.toFixed(0)}ms</span>
            <Link
              href={`/chat?q=${encodeURIComponent(result.query)}`}
              className="ml-auto rounded-full border border-stone-200 bg-white px-3 py-1 font-medium text-stone-600 transition-colors duration-300 hover:border-primary hover:text-stone-900"
            >
              Ask the assistant this →
            </Link>
          </div>

          {result.results.length === 0 ? (
            <div className="rounded-4xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
              No chunks cleared the threshold — the assistant would answer with the
              “insufficient information” response for this query.
            </div>
          ) : (
            <div className="space-y-3">
              {result.results.map((chunk) => (
                <div
                  key={chunk.chunkId}
                  className="rounded-3xl border border-stone-100 bg-white p-4 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <span className="inline-flex size-6 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-stone-700">
                      {chunk.rank}
                    </span>
                    <span className="text-sm font-medium text-stone-800">{chunk.documentTitle}</span>
                    <span className="text-xs text-stone-400">chunk #{chunk.chunkIndex + 1}</span>
                    <div className="ml-auto flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-stone-100">
                        <div
                          className={`h-full rounded-full ${scoreColor(chunk.score)}`}
                          style={{ width: `${Math.min(chunk.score * 100, 100)}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-xs tabular-nums font-medium text-stone-600">
                        {chunk.score.toFixed(3)}
                      </span>
                    </div>
                  </div>
                  <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-xl bg-stone-50 p-3 font-mono text-[11px] leading-relaxed text-stone-600">
                    {chunk.content}
                  </p>
                </div>
              ))}
            </div>
          )}

          {result.results.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
                Context handed to the LLM (exact prompt input)
              </p>
              <pre className="max-h-72 overflow-auto rounded-4xl bg-stone-900 p-4 font-mono text-[11px] leading-relaxed text-stone-300">
                {result.contextPreview}
              </pre>
            </div>
          ) : null}
        </>
      ) : null}

      {!pending && !result ? (
        <div className="rounded-4xl border border-stone-100 bg-white p-10 text-center shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]">
          <p className="font-medium text-stone-800">Look inside the retrieval step</p>
          <p className="mt-1 text-sm text-stone-500">
            Run a query to see matched chunks, similarity scores, the assembled context and
            latency — no LLM involved.
          </p>
        </div>
      ) : null}
    </div>
  );
}
