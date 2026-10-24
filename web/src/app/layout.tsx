import type { Metadata } from "next";
import "@fontsource-variable/outfit";
import "@fontsource/reenie-beanie/400.css";
import { GrainOverlay } from "@/components/grain-overlay";
import { SiteNav } from "@/components/site-nav";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Softly Support — AI technical support assistant",
    template: "%s · Softly Support",
  },
  description:
    "RAG-powered technical support assistant with cited answers over your Node.js, PostgreSQL, Redis, Docker, Nginx and WebSocket runbooks.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <SiteNav />
        <main className="pt-24">{children}</main>
        <Toaster position="top-center" richColors />
        <GrainOverlay />
      </body>
    </html>
  );
}
