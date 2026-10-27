import type { Metadata } from "next";
import { EvalClient } from "@/components/eval/eval-client";

export const metadata: Metadata = {
  title: "Evaluation dashboard",
};

export default function EvalPage() {
  return (
    <div className="px-4 pb-16 sm:px-6">
      <div className="mx-auto mb-8 w-full max-w-6xl">
        <h1 className="text-3xl font-medium tracking-tight text-stone-900">
          Evaluation{" "}
          <span className="font-accent text-4xl font-normal text-primary">dashboard</span>
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Run the labeled dataset through the live pipeline: retrieval Recall@5 and MRR, answer
          keywords, citation accuracy, abstention, latency and token usage — stored per run so
          changes can be compared.
        </p>
      </div>
      <EvalClient />
    </div>
  );
}
