# AGENTS.md — project rules for RAG Tech Support

AI technical support assistant: RAG over uploaded technical docs (PDF/Markdown/TXT) with cited answers and a retrieval debugger.

**Stack**: Next.js 15+ (App Router) + shadcn/ui · Express 5 + TypeScript · Supabase Postgres + pgvector · Groq LLM `openai/gpt-oss-120b` (free tier; llama-3.3-70b-versatile was decommissioned) + Gemini embeddings (768-dim, free tier).

## Repository layout

```
shared/    API contract types (imported as @rag/shared by server + web)
server/    Express API — ingestion, retrieval, chat, eval scripts
web/       Next.js frontend — landing, /chat, /documents, /debugger
docs/      DESIGN_GUIDE.md and other project docs
.zcode/    workspace skills (react-best-practices)
```

## Commands (run inside WSL, from repo root)

- `npm install` — install all workspaces
- `npm run dev` — server (tsx watch, :4000) + web (next dev, :3000)
- `npm run seed` — (re)index the 7 sample incident docs
- `npm run eval` — retrieval quality: hit@1/hit@3/MRR + threshold sweep
- `npm run typecheck` — tsc --noEmit for server and web

## Golden rules

1. **Secrets live only in `server/.env`** (`DATABASE_URL`, `GROQ_API_KEY`, `GEMINI_API_KEY`). Never in `web/`, never in client bundles, never committed. `web/` may only know `NEXT_PUBLIC_API_URL`.
2. **Every chat answer carries citations.** The LLM must cite context blocks inline as `[1]`, `[2]`; the API returns matching `sources` with scores. Never render an answer without its sources.
3. **Honesty guard**: when no chunk clears the similarity threshold, the API returns `sufficient: false` and the UI shows the amber "insufficient information" card. Do not call the LLM in that case.
4. **No agent frameworks, no autonomous loops.** Single retrieve → prompt → answer pipeline. Keep complexity out.
5. **Minimal dependencies.** Plain `fetch` for Groq/Gemini APIs. No SDK sprawl, no LangChain.

## Server conventions (`server/src`)

- Modules under `modules/<name>/` with `service.ts` (logic), `routes.ts` (Express router + zod validation). Shared plumbing in `db/`, `providers/`, `lib/`, `config/`.
- All env access goes through `config/env.ts` (zod-validated, fails fast at boot). No `process.env` elsewhere.
- Errors: throw `HttpError` from `lib/errors.ts`; the global error middleware maps it to JSON responses.
- DB: `pg` pool in `db/pool.ts`; schema lives in `db/migrate.ts` (idempotent, auto-runs at boot). Embeddings are `vector(768)` — must match `EMBEDDING_DIM` and the Gemini `outputDimensionality`.
- Retrieval: cosine distance (`<=>`), similarity = `1 - distance`, HNSW index. Default top-k 5, threshold 0.50 (tuned via `npm run eval` — see `eval/RESULTS.md`: 100% hit@1, 100% off-topic rejection at 0.50).
- Documents are replaced on re-upload of the same `file_name` (upsert semantics; seed script relies on it).

## Web conventions (`web/src`)

- Follow the `react-best-practices` skill and `docs/DESIGN_GUIDE.md` (the Softly theme). No ad-hoc colors — use the CSS variables/tokens.
- All API calls go through `lib/api.ts` (typed with `@rag/shared`). Client components only; don't fetch in server components.
- Pages: `/` landing, `/chat` (citations + latency badge + insufficient-info state), `/documents` (upload/list/delete), `/debugger` (chunks, scores, context preview, latency breakdown).

## Quality expectations

- After touching chunking, embeddings, prompts, or retrieval settings: run `npm run seed && npm run eval` and compare hit@3/MRR against `eval/RESULTS.md` before considering the work done.
- TypeScript strict, zero errors. UI states (loading/error/empty) are always handled.
