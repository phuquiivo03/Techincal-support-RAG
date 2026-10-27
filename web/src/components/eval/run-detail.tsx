"use client";

import { useState } from "react";
import type {
  ChatBehavior,
  EvalExpectedBehavior,
  EvalFailureType,
  EvalItemResult,
  EvalRunDetail,
} from "@rag/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const CATEGORY_LABELS: Record<string, string> = {
  factual: "factual",
  paraphrase: "paraphrase",
  multi_doc: "multi-doc",
  error_code: "error code",
  off_topic: "off-topic",
  contradiction: "contradiction",
  partial_evidence: "partial evidence",
  misleading_premise: "misleading premise",
  typo: "typo",
  long_doc: "long doc",
  injection: "injection",
  mixed_language: "VI-EN mixed",
  informal: "informal",
  underspecified: "underspecified",
  unanswerable: "unanswerable",
  outdated: "outdated",
  multi_condition: "multi-condition",
  ambiguous: "ambiguous",
  contextual: "contextual (history)",
};

const BEHAVIOR_LABELS: Record<EvalExpectedBehavior, string> = {
  answer: "expects answer",
  partial: "expects partial",
  clarify: "expects clarification",
  abstain: "expects abstention",
};

const OBSERVED_BEHAVIOR_LABELS: Record<ChatBehavior, string> = {
  answer: "answered",
  partial_answer: "partial answer",
  clarify: "asked clarification",
  abstain: "abstained",
};

const FAILURE_LABELS: Record<EvalFailureType, string> = {
  false_abstention: "false abstention",
  false_answer: "false answer",
  unnecessary_clarification: "unnecessary clarification",
  retrieval_miss: "retrieval miss",
  keyword_coverage: "keyword coverage",
  citation_missing: "no citations",
  citation_invalid: "wrong-doc citation",
  citation_variant: "【n】 citation format",
  caveat_missing: "missing gap admission",
  forbidden_term: "forbidden term",
  pipeline_error: "pipeline error",
};

/** Observed chat behaviors use the partial_answer name; eval expectations use "partial". */
function toExpectedSpace(behavior: ChatBehavior): EvalExpectedBehavior {
  return behavior === "partial_answer" ? "partial" : behavior;
}

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function num(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, ".0");
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-3xl border border-stone-100 bg-white p-4 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]">
      <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{label}</p>
      <p className="mt-1 text-2xl font-medium tabular-nums tracking-tight text-stone-900">{value}</p>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-stone-400">{hint}</p> : null}
    </div>
  );
}

function StatusPill({ item }: { item: EvalItemResult }) {
  if (item.pass) {
    return <span className="text-xs font-semibold uppercase tracking-wide text-emerald-600">pass</span>;
  }
  if (item.model === "error") {
    return <span className="text-xs font-semibold uppercase tracking-wide text-amber-600">error</span>;
  }
  return <span className="text-xs font-semibold uppercase tracking-wide text-rose-500">fail</span>;
}

function ItemRow({ item }: { item: EvalItemResult }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow
        className="cursor-pointer"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <TableCell><StatusPill item={item} /></TableCell>
        <TableCell className="font-mono text-xs text-stone-500">{item.id}</TableCell>
        <TableCell>
          <div className="flex flex-col items-start gap-1">
            <Badge variant="outline" className="border-stone-200 bg-stone-50 text-stone-600">
              {CATEGORY_LABELS[item.category] ?? item.category}
            </Badge>
            {item.expectedBehavior ? (
              <span className="text-[10px] font-medium uppercase tracking-wide text-stone-400">
                {BEHAVIOR_LABELS[item.expectedBehavior]}
              </span>
            ) : null}
            {item.observedBehavior ? (
              <span
                className={`text-[10px] font-medium uppercase tracking-wide ${
                  item.expectedBehavior && toExpectedSpace(item.observedBehavior) !== item.expectedBehavior
                    ? "text-amber-600"
                    : "text-emerald-600"
                }`}
              >
                → {OBSERVED_BEHAVIOR_LABELS[item.observedBehavior]}
              </span>
            ) : null}
          </div>
        </TableCell>
        <TableCell className="max-w-md truncate text-sm text-stone-700">{item.question}</TableCell>
        <TableCell className="text-right text-xs tabular-nums text-stone-600">{pct(item.metrics.recallAt5)}</TableCell>
        <TableCell className="text-right text-xs tabular-nums text-stone-600">{num(item.metrics.mrr)}</TableCell>
        <TableCell className="text-right text-xs tabular-nums text-stone-600">{pct(item.metrics.keywordCoverage)}</TableCell>
        <TableCell className="text-right text-xs tabular-nums text-stone-600">{pct(item.metrics.citationPrecision)}</TableCell>
        <TableCell className="text-right text-xs tabular-nums text-stone-600">
          {item.sufficient ? `${Math.round(item.timings.totalMs)}ms` : "abstained"}
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow className="bg-stone-50/60 hover:bg-stone-50/60">
          <TableCell colSpan={9} className="p-0">
            <div className="space-y-4 p-5">
              {item.failureTypes && item.failureTypes.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {item.failureTypes.map((type) => (
                    <span
                      key={type}
                      className="rounded-full border border-rose-100 bg-rose-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-600"
                    >
                      {FAILURE_LABELS[type] ?? type}
                    </span>
                  ))}
                </div>
              ) : null}
              {item.failureReasons.length > 0 ? (
                <ul className="space-y-1">
                  {item.failureReasons.map((reason) => (
                    <li key={reason} className="rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      {reason}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">Expected answer (label)</p>
                  <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-white p-3 text-xs leading-relaxed text-stone-600 border border-stone-100">
                    {item.expectedAnswer}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">
                    Generated answer · {item.model} · citations {item.citationMarkers.length > 0 ? item.citationMarkers.map((m) => `[${m}]`).join(" ") : "none"}
                  </p>
                  <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-stone-900 p-3 font-mono text-[11px] leading-relaxed text-stone-300">
                    {item.generatedAnswer || "(empty)"}
                  </p>
                </div>
              </div>

              {item.expectedFileNames.length > 0 ? (
                <p className="text-xs text-stone-500">
                  Expected docs: <span className="font-mono">{item.expectedFileNames.join(", ")}</span>
                  {item.ranking?.firstExpectedRank ? ` · first expected chunk at rank ${item.ranking.firstExpectedRank}` : ""}
                </p>
              ) : null}

              {item.retrieved.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
                    Retrieved chunks (top-{item.retrieved.length} above threshold, snippets only)
                  </p>
                  {item.retrieved.map((chunk) => (
                    <div key={chunk.chunkId} className="rounded-2xl border border-stone-100 bg-white p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                        <span className="flex size-5 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-stone-700">
                          {chunk.rank}
                        </span>
                        <span className="font-medium text-stone-700">{chunk.documentTitle}</span>
                        <span className="text-stone-400">chunk #{chunk.chunkIndex + 1}</span>
                        <span className="tabular-nums text-stone-500">score {chunk.score.toFixed(3)}</span>
                        {chunk.expected ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                            expected doc
                          </span>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-stone-500 line-clamp-3">{chunk.snippet}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-stone-400">
                <span>embed {item.timings.embedMs}ms</span>
                <span>pgvector {item.timings.retrievalMs}ms</span>
                <span>llm {item.timings.llmMs}ms</span>
                <span>total {item.timings.totalMs}ms</span>
                {item.usage ? (
                  <span>
                    tokens {item.usage.promptTokens} in / {item.usage.completionTokens} out ({item.usage.totalTokens} total)
                  </span>
                ) : (
                  <span>no LLM call</span>
                )}
                {item.metrics.chunkRecallAt3 != null ? <span>chunk recall@3 {pct(item.metrics.chunkRecallAt3)}</span> : null}
                {item.metrics.chunkRecallAt5 !== null ? <span>chunk recall@5 {pct(item.metrics.chunkRecallAt5)}</span> : null}
                {item.metrics.citationRecall !== null ? <span>citation recall {pct(item.metrics.citationRecall)}</span> : null}
                {item.metrics.variantCitationPrecision !== null ? (
                  <span>【n】 markers {pct(item.metrics.variantCitationPrecision)} to expected docs</span>
                ) : null}
                {item.metrics.caveatCoverage != null ? (
                  <span>caveat coverage {pct(item.metrics.caveatCoverage)}</span>
                ) : null}
                {item.claimSupport && item.claimSupport.claimSentences > 0 ? (
                  <span>
                    cited claims {item.claimSupport.citedClaimSentences}/{item.claimSupport.claimSentences} (heuristic)
                  </span>
                ) : null}
                {item.forbiddenKeywordHits?.some((h) => h.found) ? (
                  <span className="font-semibold text-rose-500">
                    forbidden terms present: {item.forbiddenKeywordHits.filter((h) => h.found).map((h) => h.keyword).join(", ")}
                  </span>
                ) : null}
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

export function RunDetail({ run, onDelete }: { run: EvalRunDetail; onDelete: (id: string) => void }) {
  const [category, setCategory] = useState<string>("all");
  const [failedOnly, setFailedOnly] = useState(false);

  const items = run.items.filter(
    (item) => (category === "all" || item.category === category) && (!failedOnly || !item.pass),
  );
  const m = run.metrics;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-medium tracking-tight text-stone-900">
            Run {run.datasetVersion}
            {run.label ? <span className="text-stone-400"> · {run.label}</span> : null}
          </h2>
          <p className="text-xs text-stone-400">
            {new Date(run.createdAt).toLocaleString()} · {run.config.llmModel} · {run.config.embeddingModel} ({run.config.embeddingDim}d) · topK {run.config.topK} · threshold {run.config.threshold}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => onDelete(run.id)}
          className="h-9 rounded-full border-stone-200 text-xs text-stone-500 hover:text-rose-500"
        >
          Delete run
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Pass rate" value={pct(m.passRate)} hint={`${m.passed}/${m.items} items`} />
        <MetricCard label="Recall@5" value={pct(m.retrieval.recallAt5)} hint={`MRR ${num(m.retrieval.mrr)}`} />
        <MetricCard
          label="Keyword coverage"
          value={pct(m.answers.keywordCoverage)}
          hint="lexical heuristic, not semantic grading"
        />
        <MetricCard
          label="Citation precision"
          value={pct(m.answers.citationPrecision)}
          hint={
            m.answers.variantCitationPrecision !== null
              ? `recall ${pct(m.answers.citationRecall)} · 【n】 markers ${pct(m.answers.variantCitationPrecision)}`
              : `recall ${pct(m.answers.citationRecall)}`
          }
        />
        <MetricCard
          label="Off-topic abstention"
          value={pct(m.abstention.abstentionRate)}
          hint={`${m.abstention.abstained}/${m.abstention.offTopicItems} rejected`}
        />
        <MetricCard label="False abstentions" value={String(m.answers.falseAbstentions)} hint="on-topic, refused to answer" />
        {m.byBehavior ? (
          <MetricCard
            label="Behavior expectations"
            value={`${Object.values(m.byBehavior).reduce((acc, b) => acc + (b?.passed ?? 0), 0)}/${Object.values(m.byBehavior).reduce((acc, b) => acc + (b?.items ?? 0), 0)}`}
            hint={Object.entries(m.byBehavior)
              .map(([behavior, bucket]) => `${behavior} ${bucket?.passed ?? 0}/${bucket?.items ?? 0}`)
              .join(" · ")}
          />
        ) : null}
        {m.behaviorDecisions ? (
          <MetricCard
            label="Clarification decisions"
            value={pct(m.behaviorDecisions.correctBehaviorRate)}
            hint={`clarify P ${pct(m.behaviorDecisions.clarificationPrecision)} · R ${pct(m.behaviorDecisions.clarificationRecall)} · unnecessary ${m.behaviorDecisions.unnecessaryClarifications} · false answers ${m.behaviorDecisions.falseAnswersOnClarify}`}
          />
        ) : null}
        {m.claims ? (
          <MetricCard
            label="Cited claim rate"
            value={pct(m.claims.avgCitedClaimRate)}
            hint="sentence-level heuristic, informational"
          />
        ) : null}
        <MetricCard label="Avg total latency" value={`${Math.round(m.latency.avgTotalMs)}ms`} hint={`llm ${Math.round(m.latency.avgLlmMs)}ms`} />
        <MetricCard
          label="Tokens"
          value={m.tokens.totalTokens.toLocaleString()}
          hint={`${m.tokens.answeredItems} LLM answers`}
        />
      </div>

      {m.byFailureType && Object.keys(m.byFailureType).length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Failures by type:</span>
          {(Object.keys(m.byFailureType) as EvalFailureType[]).map((type) => (
            <span
              key={type}
              className="rounded-full border border-rose-100 bg-rose-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-600"
            >
              {FAILURE_LABELS[type] ?? type} × {m.byFailureType?.[type]}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(m.byCategory).map(([key, bucket]) => (
          <button
            key={key}
            onClick={() => setCategory(category === key ? "all" : key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-300 ${
              category === key
                ? "border-primary bg-secondary text-stone-900"
                : "border-stone-200 bg-white text-stone-600 hover:border-primary"
            }`}
          >
            {CATEGORY_LABELS[key] ?? key}: {bucket.passed}/{bucket.items}
          </button>
        ))}
        <button
          onClick={() => setFailedOnly((v) => !v)}
          className={`ml-auto rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-300 ${
            failedOnly
              ? "border-rose-200 bg-rose-50 text-rose-600"
              : "border-stone-200 bg-white text-stone-600 hover:border-rose-200"
          }`}
        >
          {failedOnly ? "Showing failures" : "Failures only"}
        </button>
      </div>

      <div className="overflow-hidden rounded-4xl border border-stone-100 bg-white shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-16">Status</TableHead>
              <TableHead className="w-24">ID</TableHead>
              <TableHead className="w-28">Category</TableHead>
              <TableHead>Question</TableHead>
              <TableHead className="text-right">Recall@5</TableHead>
              <TableHead className="text-right">MRR</TableHead>
              <TableHead className="text-right">Keywords</TableHead>
              <TableHead className="text-right">Citations</TableHead>
              <TableHead className="text-right">Latency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </TableBody>
        </Table>
        {items.length === 0 ? (
          <p className="p-6 text-center text-sm text-stone-400">No items match this filter.</p>
        ) : null}
      </div>
      <p className="text-[11px] leading-relaxed text-stone-400">
        Keyword coverage is a lexical heuristic (substring match against hand-written expected keywords), not
        semantic correctness grading. Click any row for expected vs generated answers, retrieved chunks,
        failure reasons, latency and token usage.
      </p>
    </div>
  );
}
