"use client";

import type { EvalCategory, EvalFailureType, EvalRunSummary } from "@rag/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Side-by-side comparison of two runs (same suite): headline metric deltas,
 * per-category pass rates and failure-type counts. Works from run summaries
 * only — older baseline runs simply omit the robustness-only rows.
 */

const CATEGORY_LABELS: Partial<Record<EvalCategory, string>> = {
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
};

const FAILURE_LABELS: Partial<Record<EvalFailureType, string>> = {
  false_abstention: "false abstention (should answer)",
  false_answer: "false answer (should abstain/admit gap)",
  retrieval_miss: "retrieval miss",
  keyword_coverage: "keyword coverage",
  citation_missing: "no citations",
  citation_invalid: "citation to wrong doc",
  citation_variant: "non-linkable 【n】 citations",
  caveat_missing: "missing gap admission / clarification",
  forbidden_term: "forbidden term (injection canary)",
  pipeline_error: "pipeline error",
};

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function delta(a: number | null | undefined, b: number | null | undefined): string {
  if (a === null || a === undefined || b === null || b === undefined) return "—";
  const d = Math.round((b - a) * 100);
  if (d === 0) return "±0";
  return d > 0 ? `+${d}` : `${d}`;
}

function RunTag({ run, slot }: { run: EvalRunSummary | null; slot: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{slot}</p>
      <p className="truncate text-sm font-medium text-stone-800">
        {run ? `${run.datasetVersion}${run.label ? ` · ${run.label}` : ""}` : "—"}
      </p>
      {run ? (
        <p className="text-[11px] text-stone-400">{new Date(run.createdAt).toLocaleString()}</p>
      ) : null}
    </div>
  );
}

export function ComparePanel({ runA, runB }: { runA: EvalRunSummary | null; runB: EvalRunSummary | null }) {
  if (!runA || !runB) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-4xl border border-stone-100 bg-white p-10 text-center shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]">
        <p className="max-w-sm text-sm text-stone-500">
          Select two stored runs of this suite to compare pass rate, retrieval, citation and
          failure-type deltas between them.
        </p>
      </div>
    );
  }

  const a = runA.metrics;
  const b = runB.metrics;

  const headline: { label: string; a: string; b: string; d: string; hint?: string }[] = [
    { label: "Pass rate", a: pct(a.passRate), b: pct(b.passRate), d: delta(a.passRate, b.passRate), hint: `${a.passed}/${a.items} → ${b.passed}/${b.items}` },
    { label: "Recall@5", a: pct(a.retrieval.recallAt5), b: pct(b.retrieval.recallAt5), d: delta(a.retrieval.recallAt5, b.retrieval.recallAt5) },
    { label: "Recall@3", a: pct(a.retrieval.recallAt3), b: pct(b.retrieval.recallAt3), d: delta(a.retrieval.recallAt3, b.retrieval.recallAt3) },
    { label: "MRR", a: a.retrieval.mrr?.toFixed(3) ?? "—", b: b.retrieval.mrr?.toFixed(3) ?? "—", d: delta(a.retrieval.mrr, b.retrieval.mrr) },
    { label: "Chunk recall@5", a: pct(a.retrieval.chunkRecallAt5), b: pct(b.retrieval.chunkRecallAt5), d: delta(a.retrieval.chunkRecallAt5, b.retrieval.chunkRecallAt5) },
    { label: "Keyword coverage", a: pct(a.answers.keywordCoverage), b: pct(b.answers.keywordCoverage), d: delta(a.answers.keywordCoverage, b.answers.keywordCoverage) },
    { label: "Citation precision", a: pct(a.answers.citationPrecision), b: pct(b.answers.citationPrecision), d: delta(a.answers.citationPrecision, b.answers.citationPrecision) },
    { label: "Citation recall", a: pct(a.answers.citationRecall), b: pct(b.answers.citationRecall), d: delta(a.answers.citationRecall, b.answers.citationRecall) },
    { label: "Off-topic abstention", a: pct(a.abstention.abstentionRate), b: pct(b.abstention.abstentionRate), d: delta(a.abstention.abstentionRate, b.abstention.abstentionRate) },
    { label: "False abstentions", a: String(a.answers.falseAbstentions), b: String(b.answers.falseAbstentions), d: delta(a.answers.falseAbstentions, b.answers.falseAbstentions) },
    {
      label: "Cited claim rate",
      a: pct(a.claims?.avgCitedClaimRate ?? null),
      b: pct(b.claims?.avgCitedClaimRate ?? null),
      d: delta(a.claims?.avgCitedClaimRate ?? null, b.claims?.avgCitedClaimRate ?? undefined),
      hint: "sentence-level heuristic",
    },
  ];

  const categories = [...new Set([...Object.keys(a.byCategory), ...Object.keys(b.byCategory)])] as EvalCategory[];
  const failureTypes = [
    ...new Set([...Object.keys(a.byFailureType ?? {}), ...Object.keys(b.byFailureType ?? {})]),
  ] as EvalFailureType[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-6 rounded-4xl border border-stone-100 bg-white p-5 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]">
        <RunTag run={runA} slot="Run A (earlier)" />
        <span className="text-stone-300">→</span>
        <RunTag run={runB} slot="Run B (later)" />
        <p className="ml-auto text-[11px] text-stone-400">
          Δ columns are percentage points (B − A); “—” means the metric is absent (older run).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {headline.map((m) => (
          <div key={m.label} className="rounded-3xl border border-stone-100 bg-white p-4 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{m.label}</p>
            <p className="mt-1 flex items-baseline gap-2 text-xl font-medium tabular-nums tracking-tight text-stone-900">
              {m.a} <span className="text-sm text-stone-300">→</span> {m.b}
              <span
                className={`ml-auto text-sm font-semibold ${
                  m.d === "—" || m.d === "±0" ? "text-stone-400" : Number(m.d.replace("+", "")) > 0 ? "text-emerald-600" : "text-rose-500"
                }`}
              >
                {m.d === "—" ? "" : m.d === "±0" ? "0" : `${m.d}pp`}
              </span>
            </p>
            {m.hint ? <p className="mt-1 text-[11px] leading-snug text-stone-400">{m.hint}</p> : null}
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="overflow-hidden rounded-4xl border border-stone-100 bg-white shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]">
          <p className="px-5 pt-4 text-[11px] font-medium uppercase tracking-wide text-stone-400">By test category</p>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Category</TableHead>
                <TableHead className="text-right">A</TableHead>
                <TableHead className="text-right">B</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((cat) => (
                <TableRow key={cat}>
                  <TableCell className="text-sm text-stone-700">{CATEGORY_LABELS[cat] ?? cat}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-stone-600">
                    {a.byCategory[cat] ? `${a.byCategory[cat]!.passed}/${a.byCategory[cat]!.items}` : "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-stone-600">
                    {b.byCategory[cat] ? `${b.byCategory[cat]!.passed}/${b.byCategory[cat]!.items}` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="overflow-hidden rounded-4xl border border-stone-100 bg-white shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]">
          <p className="px-5 pt-4 text-[11px] font-medium uppercase tracking-wide text-stone-400">By failure type</p>
          {failureTypes.length === 0 ? (
            <p className="p-5 text-xs text-stone-400">
              No structured failure types recorded (both runs predate the robustness module or had zero failures).
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Failure type</TableHead>
                  <TableHead className="text-right">A</TableHead>
                  <TableHead className="text-right">B</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failureTypes.map((type) => (
                  <TableRow key={type}>
                    <TableCell className="text-sm text-stone-700">{FAILURE_LABELS[type] ?? type}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-stone-600">
                      {a.byFailureType?.[type] ?? 0}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-stone-600">
                      {b.byFailureType?.[type] ?? 0}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
