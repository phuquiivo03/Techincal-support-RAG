import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatClient } from "@/components/chat/chat-client";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Chat",
};

export default function ChatPage() {
  return (
    <div className="px-4 pb-8 sm:px-6">
      <Suspense
        fallback={
          <div className="mx-auto flex h-[calc(100dvh-9rem)] w-full max-w-3xl flex-col justify-end gap-4">
            <Skeleton className="h-full w-full rounded-4xl" />
          </div>
        }
      >
        <ChatClient />
      </Suspense>
    </div>
  );
}
