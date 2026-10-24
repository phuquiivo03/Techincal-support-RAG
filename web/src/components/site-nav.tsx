"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/chat", label: "Chat" },
  { href: "/documents", label: "Documents" },
  { href: "/debugger", label: "Debugger" },
];

/** Floating pill nav: 70% white, blur-20px, coral-dot logo (DESIGN_GUIDE §5). */
export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="fixed inset-x-3 top-3 z-40 flex justify-center sm:inset-x-6">
      <nav
        aria-label="Main navigation"
        className="flex w-full max-w-fit items-center gap-1 rounded-full border border-stone-200/80 bg-white/70 px-2 py-1.5 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)] backdrop-blur-[20px]"
      >
        <Link href="/" className="mx-2 flex items-center gap-2" aria-label="Softly Support home">
          <span className="relative flex size-5">
            <span className="absolute inset-0 rounded-full bg-primary" />
            <span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
          </span>
          <span className="text-sm font-medium tracking-tight text-stone-800">
            softly<span className="text-stone-400">·support</span>
          </span>
        </Link>

        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-300",
                active ? "bg-secondary text-stone-900" : "text-stone-600 hover:text-stone-900",
              )}
            >
              {link.label}
            </Link>
          );
        })}

        <Link
          href="/chat"
          className="ml-1 hidden rounded-full bg-stone-900 px-4 py-1.5 text-sm font-medium text-[#FDFCF8] transition-transform duration-300 hover:scale-[1.03] sm:block"
        >
          Ask a question
        </Link>
      </nav>
    </header>
  );
}
