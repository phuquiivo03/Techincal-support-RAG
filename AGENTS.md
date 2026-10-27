# AGENTS.md — project rules for RAG Tech Support

AI technical support assistant: RAG over uploaded technical docs (PDF/Markdown/TXT) with cited answers and a retrieval debugger.

**Stack**: Next.js 15+ (App Router) + shadcn/ui · Express 5 + TypeScript · Supabase Postgres + pgvector · Groq LLM `openai/gpt-oss-120b` (free tier; llama-3.3-70b-versatile was decommissioned) + Gemini embeddings (768-dim, free tier).

## Repository layout

```
shared/    API contract types (imported as @rag/shared by server + web)
server/    Express API — ingestion, retrieval, chat, eval scripts
web/       Next.js frontend — landing, /chat, /documents, /debugger, /eval
docs/      DESIGN_GUIDE.md and other project docs
.zcode/    workspace skills (react-best-practices)
```

## Commands (run inside WSL, from repo root)

- `npm install` — install all workspaces
- `npm run dev` — server (tsx watch, :4000) + web (next dev, :3000)
- `npm run seed` — (re)index the 7 sample incident docs
- `npm run eval` — retrieval-only baseline: hit@1/hit@3/MRR + threshold sweep → `eval/RESULTS.md`
- `npm run eval:suite` — full evaluation module: labeled dataset through the live pipeline, stored per run (dashboard `/eval`, see `docs/EVALUATION.md`). Datasets: `v1`/`v2` (baseline suite), `robustness-v1` (robustness suite, HELD-OUT), `clarification-v1` (clarification suite, `--dataset=clarification-v1`)
- `npm test` — unit tests (node:test via tsx; eval metrics/dataset/runner + provider retry/timeout — no network or keys needed)
- `npm run test:regression` — LIVE operational regression (server must run on :4000): duplicate ingestion, update/stale chunks, deletion cascade, indexing failures, concurrent uploads/retrievals, provider health
- `npm run typecheck` — tsc --noEmit for server and web

## Golden rules

1. **Secrets live only in `server/.env`** (`DATABASE_URL`, `GROQ_API_KEY`, `GEMINI_API_KEY`). Never in `web/`, never in client bundles, never committed. `web/` may only know `NEXT_PUBLIC_API_URL`.
2. **Every chat answer carries citations.** The LLM must cite context blocks inline as `[1]`, `[2]`; the API returns matching `sources` with scores. Never render an answer without its sources.
3. **Honesty guard**: when no chunk clears the similarity threshold, the API returns `sufficient: false`, `behavior: "abstain"` and the UI shows the amber "insufficient information" card. Do not call the LLM in that case. When the question is ambiguous and interpretations diverge, the LLM answers with `behavior: "clarify"` — one targeted follow-up question instead of guessing (see `docs/CLARIFICATION.md`).
4. **No agent frameworks, no autonomous loops.** Single retrieve → prompt → parse-behavior → answer pipeline (one LLM call; the behavior comes from a parsed directive, not a second call). Keep complexity out.
5. **Minimal dependencies.** Plain `fetch` for Groq/Gemini APIs. No SDK sprawl, no LangChain.

## Server conventions (`server/src`)

- Modules under `modules/<name>/` with `service.ts` (logic), `routes.ts` (Express router + zod validation). Shared plumbing in `db/`, `providers/`, `lib/`, `config/`.
- All env access goes through `config/env.ts` (zod-validated, fails fast at boot). No `process.env` elsewhere.
- Errors: throw `HttpError` from `lib/errors.ts`; the global error middleware maps it to JSON responses.
- DB: `pg` pool in `db/pool.ts`; schema lives in `db/migrate.ts` (idempotent, auto-runs at boot). Embeddings are `vector(768)` — must match `EMBEDDING_DIM` and the Gemini `outputDimensionality`.
- Retrieval: cosine distance (`<=>`), similarity = `1 - distance`, HNSW index. Default top-k 5, threshold 0.55 (0.50 let hard off-topic probes through at 0.506–0.512 while the weakest on-topic item scores 0.745 — see `docs/EVAL_FAILURE_ANALYSIS.md` and the sweep in `eval/RESULTS.md`).
- Documents are replaced on re-upload of the same `file_name` (upsert semantics; seed script relies on it).

## Web conventions (`web/src`)

- Follow the `react-best-practices` skill and `docs/DESIGN_GUIDE.md` (the Softly theme). No ad-hoc colors — use the CSS variables/tokens.
- All API calls go through `lib/api.ts` (typed with `@rag/shared`). Client components only; don't fetch in server components.
- Pages: `/` landing, `/chat` (citations + latency badge + insufficient-info state), `/documents` (upload/list/delete), `/debugger` (chunks, scores, context preview, latency breakdown), `/eval` (run history, aggregate + per-item metrics, failed cases).

## Quality expectations

- After touching chunking, embeddings, prompts, or retrieval settings: run `npm run seed && npm run eval` and compare hit@3/MRR against `eval/RESULTS.md` before considering the work done.
- After touching prompts or the chat pipeline, also run `npm run eval:suite` and compare against the latest stored run (citation behavior and abstention regressions only show up there).
- After touching the evaluation module (dataset, metrics, runner): `npm test` must pass; never edit a published dataset version in place — copy it to a new version file.
- **No tuning against `robustness-v1`** — it is a held-out test set (see `docs/EVALUATION.md` § Suites). Tune prompts/thresholds/retrieval on v1/v2 or a copied dev dataset only.
- Eval datasets label documents by `file_name` and chunks by `(file_name, chunk_index)`; regenerate chunk labels with `npx tsx scripts/dev/dump-chunks.ts` after changing seed content or chunk settings.
- Eval runs are tagged with their suite (`baseline` | `robustness`) and shown on separate dashboard tabs; never average numbers across suites.
- TypeScript strict, zero errors. UI states (loading/error/empty) are always handled.
