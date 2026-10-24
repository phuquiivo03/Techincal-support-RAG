import type { Metadata } from "next";
import { DebuggerClient } from "@/components/debugger/debugger-client";

export const metadata: Metadata = {
  title: "Retrieval debugger",
};

export default function DebuggerPage() {
  return (
    <div className="px-4 pb-16 sm:px-6">
      <div className="mx-auto mb-8 w-full max-w-4xl">
        <h1 className="text-3xl font-medium tracking-tight text-stone-900">
          Retrieval{" "}
          <span className="font-accent text-4xl font-normal text-primary">debugger</span>
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Inspect exactly what RAG sees: matched chunks, cosine similarity, the numbered context
          block, and where the milliseconds go.
        </p>
      </div>
      <DebuggerClient />
    </div>
  );
}
