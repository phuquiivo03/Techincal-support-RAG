import Link from "next/link";
import { Reveal } from "@/components/reveal";
import { StatsStrip } from "@/components/stats-strip";
import { INCIDENT_PRESETS } from "@/lib/incidents";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const STEPS = [
  {
    tint: "bg-secondary",
    title: "Upload runbooks",
    body: "Drop PDFs, Markdown or TXT files. They're parsed, chunked (~900 chars with overlap) and embedded into pgvector.",
  },
  {
    tint: "bg-accent",
    title: "Ask about incidents",
    body: "Your question is embedded and matched against the knowledge base by cosine similarity — only relevant chunks proceed.",
  },
  {
    tint: "bg-primary/30",
    title: "Get cited answers",
    body: "The LLM answers strictly from the retrieved context and cites [1][2] chips you can inspect. No context, no answer.",
  },
];

const FAQS = [
  {
    q: "What happens when the knowledge base can't answer?",
    a: "If no chunk clears the similarity threshold, the assistant never calls the LLM. You get an explicit “insufficient information” card instead of a confident guess.",
  },
  {
    q: "How are citations produced?",
    a: "Retrieved chunks are numbered and injected into the prompt. The model must reference those numbers inline — each answer shows its source chips with document title, similarity score and the matched snippet.",
  },
  {
    q: "Where do my documents and API keys live?",
    a: "Documents are stored in your own Postgres (pgvector) database. AI keys live only in the Express backend's environment — the browser never sees them.",
  },
  {
    q: "How do I know retrieval is any good?",
    a: "The debugger shows every match with its cosine score and latency, and `npm run eval` scores retrieval (hit@1, hit@3, MRR, threshold sweep) against a golden question set. The baseline is committed at server/eval/RESULTS.md.",
  },
];

export default function Home() {
  return (
    <div className="pb-24">
      {/* ---- hero ---- */}
      <section className="relative mx-auto flex min-h-[70vh] w-full max-w-5xl flex-col items-center justify-center px-6 text-center">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute left-[8%] top-[12%] size-[55vmin] rounded-full bg-[#FFE4E1]/60 blur-3xl animate-float" />
          <div className="absolute right-[6%] top-[38%] size-[48vmin] rounded-full bg-[#E6E6FA]/60 blur-3xl animate-float-delayed" />
        </div>

        <Reveal>
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white/70 px-4 py-1.5 text-xs font-medium text-stone-600 backdrop-blur">
            <span className="size-1.5 rounded-full bg-primary" />
            RAG over your runbooks · Node.js · Postgres · Redis · Docker · Nginx · WebSockets
          </p>
        </Reveal>

        <Reveal delay={100}>
          <h1 className="max-w-3xl text-5xl font-medium leading-[1.05] tracking-[-0.025em] text-stone-900 sm:text-6xl md:text-7xl">
            Technical support,{" "}
            <span className="font-accent text-[1.15em] font-normal text-primary">softly</span>{" "}
            answered
          </h1>
        </Reveal>

        <Reveal delay={200}>
          <p className="mt-6 max-w-[500px] text-base leading-relaxed text-stone-500 sm:text-lg">
            An AI support assistant that reads your incident runbooks and answers with citations —
            and honestly says when it doesn't know.
          </p>
        </Reveal>

        <Reveal delay={300}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/chat"
              className="rounded-full bg-primary px-7 py-3 text-sm font-medium text-stone-900 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.08)] transition-transform duration-300 hover:scale-[1.02]"
            >
              Ask a question
            </Link>
            <Link
              href="/documents"
              className="rounded-full border border-stone-200 bg-white px-7 py-3 text-sm font-medium text-stone-700 transition-colors duration-300 hover:border-stone-300"
            >
              Upload documents
            </Link>
          </div>
        </Reveal>

        <Reveal delay={400}>
          <div className="mt-14">
            <StatsStrip />
          </div>
        </Reveal>
      </section>

      {/* ---- incident scenario scroll ---- */}
      <section className="mx-auto w-full max-w-6xl px-6 py-14">
        <Reveal>
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-medium tracking-tight text-stone-900 sm:text-3xl">
                Tonight's incidents
              </h2>
              <p className="mt-1 text-sm text-stone-500">
                Sample scenarios from the seeded knowledge base — tap one to ask.
              </p>
            </div>
          </div>
        </Reveal>

        <div className="scrollbar-none -mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 [mask-image:linear-gradient(to_right,transparent,black_2%,black_98%,transparent)]">
          {INCIDENT_PRESETS.map((incident, i) => (
            <Reveal key={incident.label} delay={i * 60} className="shrink-0 snap-start">
              <Link
                href={`/chat?q=${encodeURIComponent(incident.query)}`}
                className="flex h-40 w-72 flex-col justify-between rounded-3xl border border-stone-100 bg-white p-5 text-left shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)] transition-colors duration-300 hover:border-primary/50"
              >
                <span className="font-mono text-xs text-stone-400">{incident.time}</span>
                <span className="text-lg font-medium leading-snug text-stone-800 transition-colors duration-300 group-hover:text-primary">
                  {incident.label}
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---- how it works ---- */}
      <section className="bg-secondary/50 py-20">
        <div className="mx-auto w-full max-w-5xl px-6">
          <Reveal>
            <h2 className="text-center text-2xl font-medium tracking-tight text-stone-900 sm:text-3xl">
              How it <span className="font-accent text-[1.15em] font-normal text-primary">works</span>
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <Reveal key={step.title} delay={i * 100}>
                <div className="h-full rounded-4xl border border-stone-100 bg-white p-6 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]">
                  <div className={`mb-4 flex size-10 items-center justify-center rounded-2xl ${step.tint}`}>
                    <span className="text-sm font-semibold text-stone-800">{i + 1}</span>
                  </div>
                  <h3 className="text-lg font-medium tracking-tight text-stone-900">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-stone-500">{step.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---- FAQ ---- */}
      <section className="mx-auto w-full max-w-3xl px-6 py-20">
        <Reveal>
          <h2 className="mb-8 text-center text-2xl font-medium tracking-tight text-stone-900 sm:text-3xl">
            Frequently asked
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <Accordion type="single" collapsible className="rounded-3xl border border-stone-100 bg-white px-2 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.05)]">
            {FAQS.map((faq, i) => (
              <AccordionItem key={faq.q} value={`item-${i}`} className="border-stone-100">
                <AccordionTrigger className="rounded-2xl px-4 text-left text-[15px] font-medium text-stone-800 hover:no-underline">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 text-sm leading-relaxed text-stone-500">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </section>

      {/* ---- footer ---- */}
      <footer className="mx-auto w-full max-w-5xl px-6 text-center text-xs text-stone-400">
        <span className="font-accent text-base text-stone-500">ask softly, cite loudly</span>
        <p className="mt-2">
          Built with Next.js · Express · PostgreSQL + pgvector · Gemini embeddings · Groq LLM
        </p>
      </footer>
    </div>
  );
}
