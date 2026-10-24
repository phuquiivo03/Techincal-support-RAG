"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ChatResponse } from "@rag/shared";
import { api } from "@/lib/api";
import { INCIDENT_PRESETS } from "@/lib/incidents";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ChatMessage, type UiMessage } from "./chat-message";

function newId(): string {
  return Math.random().toString(36).slice(2);
}

export function ChatClient() {
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoSentRef = useRef(false);

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (trimmed.length < 3 || pending) return;

      const userMessage: UiMessage = { id: newId(), role: "user", content: trimmed };
      const history = messages
        .filter((m) => m.sufficient !== undefined || m.role === "user")
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setPending(true);

      try {
        const res: ChatResponse = await api.chat(trimmed, history);
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "assistant",
            content: res.answer,
            sources: res.sources,
            sufficient: res.sufficient,
            timings: res.timings,
            model: res.model,
          },
        ]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong", {
          description: err instanceof Error && "details" in err
            ? String((err as { details?: string }).details)
            : undefined,
        });
      } finally {
        setPending(false);
      }
    },
    [messages, pending],
  );

  // ?q= prefill from landing incident cards / debugger
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !autoSentRef.current && messages.length === 0) {
      autoSentRef.current = true;
      void send(q);
    }
  }, [searchParams, messages.length, send]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  return (
    <div className="mx-auto flex h-[calc(100dvh-9rem)] w-full max-w-3xl flex-col gap-4">
      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
          <div className="space-y-2">
            <span className="font-accent text-3xl text-stone-500">hey, what broke?</span>
            <p className="mx-auto max-w-md text-sm text-stone-500">
              Ask about a technical incident — Node.js, PostgreSQL, Redis, Docker, Nginx,
              WebSockets. Every answer cites the runbooks it used.
            </p>
          </div>
          <div className="flex max-w-xl flex-wrap justify-center gap-2">
            {INCIDENT_PRESETS.slice(0, 5).map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => void send(preset.query)}
                className="rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-xs font-medium text-stone-600 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)] transition-colors duration-300 hover:border-primary hover:text-stone-900"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1 rounded-4xl">
          <div className="space-y-4 p-1">
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            {pending ? (
              <div className="flex justify-start">
                <div className="w-full max-w-[80%] space-y-2 rounded-3xl rounded-bl-lg border border-stone-100 bg-card p-4">
                  <p className="text-sm text-stone-500">Searching the knowledge base…</p>
                  <Skeleton className="h-3 w-3/4 rounded-full" />
                  <Skeleton className="h-3 w-1/2 rounded-full" />
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      )}

      <form
        className="rounded-4xl border border-stone-200 bg-white p-2 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            maxLength={2000}
            placeholder="Describe the incident — paste error messages for the best matches…"
            aria-label="Your question"
            className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-[15px] text-stone-800 outline-none placeholder:text-stone-400"
          />
          <Button
            type="submit"
            disabled={pending || input.trim().length < 3}
            className="h-10 rounded-full bg-stone-900 px-5 text-sm font-medium text-[#FDFCF8] transition-transform duration-300 hover:scale-[1.02] disabled:opacity-40"
          >
            Ask
          </Button>
        </div>
      </form>
    </div>
  );
}
