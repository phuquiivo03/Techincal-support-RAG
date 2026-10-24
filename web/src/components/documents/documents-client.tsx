"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import type { DocumentSummary } from "@rag/shared";
import { api } from "@/lib/api";
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
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

const ACCEPTED = [".pdf", ".md", ".txt"];
const MAX_BYTES = 10 * 1024 * 1024;

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function validateFile(file: File): string | null {
  const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  if (!ACCEPTED.includes(ext)) return `"${file.name}" is not a .pdf, .md or .txt file`;
  if (file.size > MAX_BYTES) return `"${file.name}" is larger than 10 MB`;
  return null;
}

export function DocumentsClient() {
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setDocuments(await api.documents());
    } catch (err) {
      setDocuments([]);
      toast.error(err instanceof Error ? err.message : "Failed to load documents");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const problem = validateFile(file);
        if (problem) {
          toast.error(problem);
          continue;
        }
        setUploading(file.name);
        try {
          const doc = await api.uploadDocument(file);
          toast.success(`Indexed "${doc.title}"`, {
            description: `${doc.chunkCount} chunks · ${doc.charCount.toLocaleString()} characters`,
          });
          await refresh();
        } catch (err) {
          toast.error(`Failed to index "${file.name}"`, {
            description: err instanceof Error ? err.message : undefined,
          });
        } finally {
          setUploading(null);
        }
      }
    },
    [refresh],
  );

  const onDelete = useCallback(
    async (doc: DocumentSummary) => {
      setDeleting(doc.id);
      try {
        await api.deleteDocument(doc.id);
        toast.success(`Removed "${doc.title}"`);
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed");
      } finally {
        setDeleting(null);
      }
    },
    [refresh],
  );

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) void upload(e.dataTransfer.files);
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload documents"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-4xl border-2 border-dashed px-6 py-12 text-center transition-colors duration-300 ${
          dragging ? "border-primary bg-secondary/60" : "border-stone-200 bg-white hover:border-stone-300"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.md,.txt"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void upload(e.target.files);
            e.target.value = "";
          }}
        />
        <span className="font-accent text-3xl text-stone-500">drop a runbook</span>
        <p className="text-sm text-stone-500">
          PDF, Markdown or TXT · up to 10 MB · parsed, chunked and embedded on upload
        </p>
        {uploading ? (
          <p className="mt-2 rounded-full bg-primary/40 px-4 py-1.5 text-sm font-medium text-stone-800">
            Indexing “{uploading}”…
          </p>
        ) : (
          <Button
            variant="outline"
            className="mt-2 rounded-full border-stone-200 bg-white"
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
          >
            Choose files
          </Button>
        )}
      </div>

      {documents === null ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-3xl" />
          <Skeleton className="h-16 w-full rounded-3xl" />
          <Skeleton className="h-16 w-full rounded-3xl" />
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-4xl border border-stone-100 bg-white p-10 text-center shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]">
          <p className="font-medium text-stone-800">No documents indexed yet</p>
          <p className="mt-1 text-sm text-stone-500">
            Upload a runbook above, or seed the 7 sample incidents with{" "}
            <code className="rounded-md bg-stone-100 px-1.5 py-0.5 font-mono text-xs">npm run seed</code>
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-4xl border border-stone-100 bg-white shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Document</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Chunks</TableHead>
                <TableHead className="text-right">Characters</TableHead>
                <TableHead>Indexed</TableHead>
                <TableHead className="pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id} className="group">
                  <TableCell className="max-w-64 pl-6">
                    <p className="truncate font-medium text-stone-800">{doc.title}</p>
                    <p className="truncate text-xs text-stone-400">{doc.fileName}</p>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="rounded-full border-stone-200 bg-stone-50 text-stone-600"
                    >
                      {doc.sourceType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-stone-600">{doc.chunkCount}</TableCell>
                  <TableCell className="text-right tabular-nums text-stone-600">
                    {doc.charCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-stone-500">{formatDate(doc.createdAt)}</TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full text-stone-400 opacity-0 transition-opacity duration-300 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                      disabled={deleting === doc.id}
                      onClick={() => void onDelete(doc)}
                      aria-label={`Delete ${doc.title}`}
                    >
                      {deleting === doc.id ? "Removing…" : "Delete"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
