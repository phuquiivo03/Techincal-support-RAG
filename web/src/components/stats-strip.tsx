"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { KnowledgeBaseStats } from "@rag/shared";

export function StatsStrip() {
  const [stats, setStats] = useState<KnowledgeBaseStats | null>(null);

  useEffect(() => {
    api
      .stats()
      .then(setStats)
      .catch(() => setStats(null)); // server down → show dashes, not an error
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
      <Stat value={stats ? String(stats.documents) : "—"} label="documents indexed" />
      <span aria-hidden className="hidden h-8 w-px bg-stone-200 sm:block" />
      <Stat value={stats ? String(stats.chunks) : "—"} label="vector chunks" />
      <span aria-hidden className="hidden h-8 w-px bg-stone-200 sm:block" />
      <Stat value="768d" label="gemini embeddings" />
      <span aria-hidden className="hidden h-8 w-px bg-stone-200 sm:block" />
      <Stat value="[n]" label="cited answers" />
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-2xl font-medium tracking-tight text-stone-900 tabular-nums">{value}</span>
      <span className="text-sm text-stone-500">{label}</span>
    </div>
  );
}
