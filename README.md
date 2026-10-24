# RAG Tech Support — softly answered

An AI technical support assistant with retrieval-augmented generation over your own runbooks.
Upload PDF/Markdown/TXT documents, ask about incidents, and get answers with **inline citations** —
plus a **retrieval debugger** and a **measurable eval harness** (hit@k / MRR / threshold sweep).

Stack: **Next.js (App Router) + shadcn/ui · Express + TypeScript · PostgreSQL + pgvector (Supabase) ·
Gemini embeddings (free tier) · Groq LLM — `openai/gpt-oss-120b` (free tier)**.

## Features

- **Document ingestion** — PDF / Markdown / TXT upload → parse → heading-aware chunking (~900 chars,
  150 overlap) → Gemini embeddings (768-d) → pgvector (HNSW, cosine).
- **Cited chat** — retrieval → numbered context prompt → Groq LLM. Every answer carries `[n]`
  citation chips with document title, similarity score and matched snippet.
- **Honesty guard** — when nothing clears the similarity threshold, no LLM call happens; the UI
  shows an explicit "insufficient information" card.
- **Retrieval debugger** (`/debugger`) — matched chunks with cosine scores, top-k & threshold
  sliders, the exact context block sent to the LLM, and per-stage latency (embed / pgvector).
- **Sample incidents** — 7 seeded runbooks covering Node.js, PostgreSQL, Redis, Docker, Nginx and
  WebSockets, plus one-click incident cards in the UI.
- **Eval harness** — `npm run eval` scores retrieval on a golden question set and writes a baseline
  to `server/eval/RESULTS.md`.

## Setup

Requirements: Node 20+, npm, WSL or Linux/macOS. Database: a free [Supabase](https://supabase.com)
project (Postgres + pgvector). Keys: free [Google AI Studio](https://aistudio.google.com/apikey)
(embeddings) and [Groq](https://console.groq.com/keys) (LLM) keys.

```bash
npm install                     # install all workspaces

cp server/.env.example server/.env
# fill in: DATABASE_URL (Supabase session pooler URI), GEMINI_API_KEY, GROQ_API_KEY

npm run seed                    # migrate + index the 7 sample incident runbooks
npm run eval                    # retrieval quality baseline (server/eval/RESULTS.md)
npm run dev                     # API on :4000, web on :3000
```

## Repository layout

```
shared/    API contract types (used by both apps)
server/    Express API: ingestion, retrieval, chat, seed & eval scripts
web/       Next.js app: landing, /chat, /documents, /debugger
docs/      DESIGN_GUIDE.md — the "Softly" design system
```

## API

| Route | Description |
| --- | --- |
| `POST /api/documents` | multipart upload (pdf/md/txt, ≤10 MB) → chunked + embedded |
| `GET /api/documents` | list indexed documents |
| `DELETE /api/documents/:id` | delete a document and its chunks |
| `GET /api/documents/stats` | document/chunk counts |
| `POST /api/chat` | `{question, history?}` → answer, citations, timings, `sufficient` |
| `POST /api/retrieve` | `{query, topK?, threshold?}` → chunks + scores + context (no LLM) |
| `GET /api/health` | DB + embedding + LLM status |

API keys live **only** in `server/.env`; the browser talks exclusively to the Express API.

## Tuning retrieval

- `SIMILARITY_THRESHOLD` (default 0.50) — chunks below this cosine similarity are dropped; if none
  survive, the assistant declines to answer. Tuned from the eval sweep: 0.50 keeps 100% on-topic
  coverage while rejecting 100% of off-topic questions (Gemini scores cluster high; unrelated text
  still reaches ~0.45). Re-tune with `npm run eval` after changing chunking or models.
- `DEFAULT_TOP_K` (default 5), chunk size/overlap in `server/src/modules/documents/chunker.ts`.
- After any change: `npm run seed && npm run eval` and compare against `server/eval/RESULTS.md`.

## Security notes

- Supabase tables have RLS enabled (the service-role connection string bypasses it; the anon-key
  REST API cannot read your documents).
- Uploads are limited to 10 MB and whitelisted extensions; all request bodies are zod-validated;
  AI endpoints are rate-limited.
