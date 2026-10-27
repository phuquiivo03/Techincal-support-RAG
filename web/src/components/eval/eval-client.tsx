"use client";

import { useCallback, useEffect, useState } from "react";
import type { EvalDatasetInfo, EvalRunDetail, EvalRunSummary, EvalSuite } from "@rag/shared";
import { ComparePanel } from "@/components/eval/compare-panel";
import { RunDetail } from "@/components/eval/run-detail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { api } from "@/lib/api";

function RunListItem({
  run,
  selected,
  onSelect,
}: {
  run: EvalRunSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-3xl border p-4 text-left transition-colors duration-300 ${
        selected ? "border-primary bg-secondary" : "border-stone-100 bg-white hover:border-stone-200"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-stone-800">{run.datasetVersion}</span>
        {run.label ? <span className="truncate text-xs text-stone-400">· {run.label}</span> : null}
        <span className="ml-auto text-[11px] text-stone-400">
          {new Date(run.createdAt).toLocaleDateString()}{" "}
          {new Date(run.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-stone-500">
        <span>
          <strong className={run.metrics.passRate >= 0.8 ? "text-emerald-600" : "text-amber-600"}>
            {Math.round(run.metrics.passRate * 100)}%
          </strong>{" "}
          pass
        </span>
        <span>recall@5 {run.metrics.retrieval.recallAt5 !== null ? Math.round(run.metrics.retrieval.recallAt5 * 100) + "%" : "—"}</span>
        <span>MRR {run.metrics.retrieval.mrr ?? "—"}</span>
        <span>abstain {run.metrics.abstention.abstentionRate !== null ? Math.round(run.metrics.abstention.abstentionRate * 100) + "%" : "—"}</span>
      </div>
    </button>
  );
}

export function EvalClient() {
  const [datasets, setDatasets] = useState<EvalDatasetInfo[] | null>(null);
  const [runs, setRuns] = useState<EvalRunSummary[] | null>(null);
  const [detail, setDetail] = useState<EvalRunDetail | null>(null);
  const [suite, setSuite] = useState<EvalSuite>("baseline");
  const [view, setView] = useState<"run" | "compare">("run");
  const [compareIds, setCompareIds] = useState<[string, string]>(["", ""]);
  const [version, setVersion] = useState("");
  const [label, setLabel] = useState("");
  const [starting, setStarting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (activeSuite: EvalSuite, selectLatest = true) => {
    try {
      const [ds, rs] = await Promise.all([api.evalDatasets(), api.evalRuns(activeSuite)]);
      setDatasets(ds.datasets);
      setRuns(rs.runs);
      setLoadError(null);
      const suiteDatasets = ds.datasets.filter((d) => (d.suite ?? "baseline") === activeSuite);
      setVersion((v) => (suiteDatasets.some((d) => d.version === v) ? v : suiteDatasets[0]?.version ?? ""));
      setCompareIds(([a, b]) =>
        rs.runs.some((r) => r.id === a) && rs.runs.some((r) => r.id === b)
          ? [a, b]
          : [rs.runs[1]?.id ?? rs.runs[0]?.id ?? "", rs.runs[0]?.id ?? ""],
      );
      if (selectLatest && rs.runs.length > 0) {
        setDetail(await api.evalRun(rs.runs[0].id));
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load evaluation data");
    }
  }, []);

  useEffect(() => {
    void load(suite);
  }, [load, suite]);

  const start = async () => {
    if (!version || starting) return;
    setStarting(true);
    toast.info("Evaluation started — it runs every question through the live pipeline. This takes a few minutes.");
    try {
      const run = await api.startEvalRun(version, label.trim() || undefined);
      setDetail(run);
      setView("run");
      await load(suite, false);
      toast.success(`Run complete: ${run.metrics.passed}/${run.metrics.items} items passed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Evaluation run failed");
    } finally {
      setStarting(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteEvalRun(id);
      setDetail(null);
      await load(suite);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const select = async (id: string) => {
    try {
      setDetail(await api.evalRun(id));
      setView("run");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load run");
    }
  };

  const switchSuite = (next: EvalSuite) => {
    setSuite(next);
    setDetail(null);
    setView("run");
  };

  const suiteDatasets = (datasets ?? []).filter((d) => (d.suite ?? "baseline") === suite);
  const dataset = suiteDatasets.find((d) => d.version === version);
  const compareA = runs?.find((r) => r.id === compareIds[0]) ?? null;
  const compareB = runs?.find((r) => r.id === compareIds[1]) ?? null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {(["baseline", "robustness", "clarification"] as const).map((s) => (
          <button
            key={s}
            onClick={() => switchSuite(s)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium capitalize transition-colors duration-300 ${
              suite === s
                ? "border-primary bg-secondary text-stone-900"
                : "border-stone-200 bg-white text-stone-600 hover:border-primary"
            }`}
          >
            {s} suite
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setView(view === "run" ? "compare" : "run")}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors duration-300 ${
              view === "compare"
                ? "border-primary bg-secondary text-stone-900"
                : "border-stone-200 bg-white text-stone-600 hover:border-primary"
            }`}
          >
            {view === "compare" ? "Back to run detail" : "Compare runs"}
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <div className="space-y-3 rounded-4xl border border-stone-100 bg-white p-5 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]">
            <div className="space-y-1">
              <p className="text-sm font-medium text-stone-800">New run</p>
              <p className="text-xs leading-relaxed text-stone-400">
                Runs the whole dataset through the live retrieve → answer pipeline (~20 real LLM
                calls) and stores the result for comparison.
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="eval-dataset" className="text-xs font-medium text-stone-600">
                Dataset version
              </label>
              <select
                id="eval-dataset"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="h-10 w-full rounded-full border border-stone-200 bg-stone-50 px-4 text-sm text-stone-800"
              >
                {suiteDatasets.map((d) => (
                  <option key={d.version} value={d.version}>
                    {d.version} — {d.itemCount} items
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="eval-label" className="text-xs font-medium text-stone-600">
                Label (optional)
              </label>
              <Input
                id="eval-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. after prompt tweak"
                className="h-10 rounded-full border-stone-200 bg-stone-50 px-4 text-sm"
              />
            </div>
            <Button
              onClick={() => void start()}
              disabled={starting || !version}
              className="h-10 w-full rounded-full bg-stone-900 px-6 text-sm font-medium text-[#FDFCF8] transition-transform duration-300 hover:scale-[1.01] disabled:opacity-40"
            >
              {starting ? "Running… (takes minutes)" : "Run evaluation"}
            </Button>
            {dataset ? (
              <p className="text-[11px] leading-relaxed text-stone-400">
                {Object.entries(dataset.categories)
                  .map(([k, v]) => `${v} ${k.replace("_", " ")}`)
                  .join(" · ")}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
              Stored {suite} runs
            </p>
            {loadError ? (
              <p className="rounded-3xl border border-rose-100 bg-rose-50 p-4 text-xs text-rose-600">{loadError}</p>
            ) : null}
            {runs === null && !loadError ? (
              <div className="space-y-2">
                <Skeleton className="h-20 w-full rounded-3xl" />
                <Skeleton className="h-20 w-full rounded-3xl" />
              </div>
            ) : null}
            {runs !== null && runs.length === 0 ? (
              <p className="rounded-3xl border border-stone-100 bg-white p-4 text-xs text-stone-400">
                No {suite} runs yet — start one above or run{" "}
                <code className="font-mono">npm run eval:suite</code>.
              </p>
            ) : null}
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {(runs ?? []).map((run) => (
                <RunListItem
                  key={run.id}
                  run={run}
                  selected={view === "run" && detail?.id === run.id}
                  onSelect={() => void select(run.id)}
                />
              ))}
            </div>
          </div>
        </div>

        <div>
          {view === "compare" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3 rounded-4xl border border-stone-100 bg-white p-4 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]">
                {(["Run A", "Run B"] as const).map((slot, i) => (
                  <div key={slot} className="min-w-48 flex-1 space-y-1">
                    <label htmlFor={`compare-${i}`} className="text-xs font-medium text-stone-600">
                      {slot}
                    </label>
                    <select
                      id={`compare-${i}`}
                      value={compareIds[i]}
                      onChange={(e) =>
                        setCompareIds((prev) =>
                          i === 0 ? [e.target.value, prev[1]] : [prev[0], e.target.value],
                        )
                      }
                      className="h-10 w-full rounded-full border border-stone-200 bg-stone-50 px-4 text-sm text-stone-800"
                    >
                      {(runs ?? []).map((run) => (
                        <option key={run.id} value={run.id}>
                          {run.datasetVersion}
                          {run.label ? ` · ${run.label}` : ""} —{" "}
                          {new Date(run.createdAt).toLocaleDateString()}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <ComparePanel runA={compareA} runB={compareB} />
            </div>
          ) : detail ? (
            <RunDetail run={detail} onDelete={(id) => void remove(id)} />
          ) : (
            <div className="flex h-full min-h-64 items-center justify-center rounded-4xl border border-stone-100 bg-white p-10 text-center shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]">
              {detail === null && runs !== null ? (
                <p className="text-sm text-stone-500">
                  Select a stored run to inspect its metrics, per-question results and failures.
                </p>
              ) : (
                <Skeleton className="h-40 w-full rounded-4xl" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
