import type { Metadata } from "next";
import { DocumentsClient } from "@/components/documents/documents-client";

export const metadata: Metadata = {
  title: "Documents",
};

export default function DocumentsPage() {
  return (
    <div className="px-4 pb-16 sm:px-6">
      <div className="mx-auto mb-8 w-full max-w-4xl">
        <h1 className="text-3xl font-medium tracking-tight text-stone-900">
          Knowledge base{" "}
          <span className="font-accent text-4xl font-normal text-primary">docs</span>
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Everything here gets chunked, embedded and becomes citable context for answers.
        </p>
      </div>
      <DocumentsClient />
    </div>
  );
}
