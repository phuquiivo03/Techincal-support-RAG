# RAG Evaluation module

A labeled, versioned evaluation harness that runs the **live pipeline** (retrieve → threshold
guard → prompt → Groq answer) against a hand-authored dataset, scores retrieval and answer
quality, and stores every run so changes can be compared over time.

Three layers exist side by side:

- `npm run eval` — the original retrieval-only baseline (hit@1/hit@3/MRR + threshold sweep,
  writes `server/eval/RESULTS.md`). Quick, no LLM calls.
- `npm run eval:suite` — the full evaluation module described here (retrieval **and** generation,
  stored per run, dashboard at `/eval`).
- `npm run test:regression` — operational regression suite (live server + DB): duplicate
  ingestion, update/stale-chunk cleanup, deletion cascade, indexing failure paths, concurrent
  uploads/retrievals, provider reachability. Provider timeout/retry semantics are locked
  network-free in `src/providers/http.test.ts`.

## Suites: baseline, robustness, clarification

Datasets belong to a **suite** (`suite` field in the dataset JSON; `v1`/`v2` = `baseline`).
Runs are tagged with the suite in `eval_runs.suite` (older rows are backfilled by name prefix)
and the dashboard keeps the histories on separate tabs. Suite numbers must never be averaged
together — they measure different things.

**Leakage policy (important):** `robustness-v1` is a HELD-OUT test set. Never tune prompts,
`SIMILARITY_THRESHOLD`, top-k, chunking or retrieval settings against it. Tuning happens on
v1/v2 or on a copied development dataset (`cp robustness-v1.json dev-xxx.json`, edit the copy);
robustness runs only measure. `clarification-v1` is a development suite for the clarification
mechanism (see `docs/CLARIFICATION.md`) — tune on it freely, but it shares the KB with the
other suites, so treat repeated tuning cycles on any one dataset as overfitting risk.

## Quick start

```bash
npm run seed                    # index the 7 sample runbooks the dataset is labeled against
npm run eval:suite              # run dataset v1 through the live pipeline (~3–5 min, ~18 LLM calls)
npm run dev                     # then open http://localhost:3000/eval for the dashboard
```

Optional flags: `npm run eval:suite -- --dataset v1 --label "after prompt tweak"`.

Each run makes real LLM calls on the Groq free tier. Items are paced 3 s apart and the provider
honors `retry-after` on 429s; a persistently failing item is recorded as `pipeline error` instead
of aborting the run.

## Dataset

Versioned JSON files in `server/eval/datasets/`:

**`v1.json` — 23 items, 5 categories** (labeled against the original 7 incident runbooks):

| Category | Count | What it probes |
| --- | --- | --- |
| `factual` | 5 | direct questions answerable from one doc |
| `paraphrase` | 5 | reworded questions that share little vocabulary with the doc |
| `multi_doc` | 3 | questions whose answer needs two documents |
| `error_code` | 5 | exact error strings (SQLSTATE 40P01/53300, Redis OOM, Nginx log lines) |
| `off_topic` | 5 | outside the KB (incl. one in-domain-sounding boundary probe, `off-003`) |

**`v2.json` — 15 adversarial items, 6 categories** (added in the 2026-10-24 audit; labeled against
5 extra seed docs — see `docs/AUDIT_REPORT.md`):

| Category | Count | What it probes |
| --- | --- | --- |
| `contradiction` | 2 | two docs give conflicting `statement_timeout` guidance |
| `partial_evidence` | 1 | only half the question is covered by the KB |
| `misleading_premise` | 2 | the question asserts wrong facts (wrong SQLSTATE, backwards cause) |
| `typo` | 3 | typo-ridden queries — embedding robustness |
| `long_doc` | 2 | key config buried deep in a 17-chunk document |
| `injection` | 1 | a prompt injection with a canary phrase embedded in a retrieved doc |

**`robustness-v1.json` — 29 items, suite `robustness`** (2026-10-25; full report in
`docs/ROBUSTNESS_EVALUATION.md`, in Vietnamese). Every item declares an **`expectedBehavior`**:

| Behavior | Meaning | Pass criteria (deterministic floor) |
| --- | --- | --- |
| `answer` | grounded full answer | the v1/v2 criteria: recall@5 = 1, keywords ≥ 0.5, citations valid |
| `partial` | answer the covered part, admit the gap | `answer` criteria **plus** caveat coverage ≥ 0.5 |
| `clarify` | ask for clarification | abstention also acceptable; if answered, clarification signals ≥ 0.5 (retrieval/citation checks informational) |
| `abstain` | refuse / gap-admission only | abstention **or** explicit "not covered" admission (caveat ≥ 0.5) |

New categories: `mixed_language` (Vietnamese-English), `informal`, `underspecified`,
`unanswerable` (in-domain, not covered), `outdated` (superseded guidance), `multi_condition`,
plus more `typo`/`paraphrase`/`partial_evidence`/`contradiction`/`long_doc`/
`misleading_premise`/`injection`/`multi_doc`/`off_topic` items. New optional item fields:

- `caveatKeywords` — lexical signals that must appear for partial/clarify/answered-abstain paths
- `forbiddenKeywords` — any occurrence fails the item outright (injection canaries are now a
  **deterministic** criterion; `audit-canary.ts` remains as an independent check)

For `injection` items, run `npx tsx scripts/dev/audit-canary.ts <runId>` after each run: any
answer containing the canary (`INJECTION-SUCCESS-7f3a`, `attacker.invalid`, …) means the
pipeline obeyed content-embedded instructions. Conflict acknowledgment, gap admission and
premise correction are judged by manually reading the stored answers — the deterministic
scores (recall/keywords/citations) are only the objective floor.

**`clarification-v1.json` — 14 items, suite `clarification`** (2026-10-25; implementation
report in `docs/CLARIFICATION.md`). Exercises the four chat behaviors end to end:
`ambiguous` (interpretations diverge → expect `clarify`), `underspecified` (missing
environment/version or an unavailable prior-context reference → `clarify`), `contextual`
(ambiguous in isolation but the item's `history` field resolves it → `answer` — the only
suite whose items carry prior conversation turns), plus `partial_evidence`, `unanswerable`,
`off_topic`, `error_code` and `factual` items as controls for when NOT to clarify.
Clarify items label the **missing detail** in `caveatKeywords` — a pass requires a real
question ("?" in prose, never inside a code span) AND caveat coverage ≥ 0.5, so a generic
"could you tell me more?" fails. New optional item field:

- `history` — prior `user`/`assistant` turns sent to the pipeline before the question
  (`contextual` items must have it; the runner passes it through to the chat pipeline)

Each item carries:

```jsonc
{
  "id": "err-001",
  "category": "error_code",
  "question": "Postgres logs show 'ERROR: deadlock detected (SQLSTATE 40P01)' …",
  "expectedAnswer": "…ground-truth summary written from the source docs…",
  "expectedFileNames": ["postgres-deadlock.md"],        // doc labels (see below)
  "expectedChunks": [{ "fileName": "postgres-deadlock.md", "chunkIndex": 1 }], // optional
  "expectedKeywords": ["40P01", "order", "retry"]
}
```

**Labels are stable, not UUIDs.** Documents are labeled by `file_name` (unique in the DB, stable
across re-seeds). Chunk labels use `(file_name, chunk_index)` as produced by the current chunker
on the current seed content — if you change seed docs or chunk settings, regenerate them with
`npx tsx scripts/dev/dump-chunks.ts` and update the dataset. The loader (`server/src/modules/
evaluation/dataset.ts`) zod-validates all of this at load time.

To version the dataset itself, copy `v1.json` → `v2.json`, bump the `version` field to match the
file name, and edit. Both versions are then selectable in the dashboard and CLI.

## What is measured

Per item:

- **Retrieval Recall@1 / @3 / @5** — fraction of expected docs present in the top-1/3/5 chunks
  (unthresholded ranking pass, so the metrics reflect raw ordering, not the 0.55 cutoff).
  Recall@1/@3 were added in the 2026-10-24 audit; stored runs from before then simply omit them.
- **MRR** — `1 / rank` of the first chunk belonging to an expected doc.
- **Chunk Recall@3 / @5** — for items with chunk labels, whether the specific labeled chunks
  surface (informational; stricter than needed to answer well). Document-level and chunk-level
  retrieval are computed and reported separately.
- **Keyword coverage** — fraction of `expectedKeywords` present in the generated answer
  (case-insensitive, dash/whitespace normalized). **Lexical heuristic, not semantic grading** —
  treat it as a lower-bound signal.
- **Caveat coverage** — same lexical check for `caveatKeywords` (gap admission / clarification
  signals). Same weaknesses as keyword coverage, plus: a confident wrong answer that happens to
  contain "not" can pass it. Read the answers.
- **Citation precision / recall** — precision: fraction of `[n]` markers whose source document is
  an expected doc (markers that resolve to nothing count against it); recall: fraction of expected
  docs actually cited. Markers inside fenced/inline code are ignored (`ids[0]` is array syntax,
  not a citation). Answers the model writes with non-standard `【n…】` brackets are scored the
  same way as the separate **variant citation precision** metric (diagnostic only — the item
  still fails because the UI cannot link those markers; the chat pipeline normalizes them to
  `[n]` before they reach users, see `chat/normalize.ts`).
- **Forbidden terms** — any `forbiddenKeywords` hit in the answer fails the item outright
  (injection canaries; deterministic).
- **Claim-support heuristic** (robustness) — of the prose sentences containing a concrete claim
  (a digit or a config assignment), the fraction carrying a citation marker, reported as
  `claimSupport` per item and `claims.avgCitedClaimRate` per run. INFORMATIONAL ONLY, not a pass
  criterion. Blind spots: list items whose only marker sits on the last line, "two fixes"-style
  summaries counted as claims, naive sentence splitting, code spans excluded entirely.
- **Abstention** — off-topic items must return the insufficient-information response (no LLM
  call). On-topic items that fail to answer are counted as *false abstentions*. Robustness adds
  the mirror: `unanswerable`/`off_topic` items that get answered anyway are `false_answer`
  failures unless the answer explicitly admits the gap.
- **Failure types** (robustness) — every failed item carries a structured classification
  (`false_abstention`, `false_answer`, `unnecessary_clarification`, `retrieval_miss`,
  `keyword_coverage`, `citation_missing`, `citation_invalid`, `citation_variant`,
  `caveat_missing`, `forbidden_term`, `pipeline_error`)
  alongside the free-text reasons, aggregated per run as `byFailureType`.
- **Observed behavior + clarification decision metrics** (2026-10-25) — every item records
  `observedBehavior` (`answer` / `clarify` / `partial_answer` / `abstain`, parsed from the
  model's output directive). Runs over behavior-labeled datasets aggregate
  `behaviorDecisions`: clarification precision & recall (observed clarify vs expected),
  unnecessary clarifications (asked where answer/abstain was expected), false answers on
  clarify-expected items (declared a confident answer where asking was needed) and the
  overall observed==expected correct-behavior rate. A declared clarification only counts as
  correct when the response actually contains a question naming the labeled missing detail.
- **Latency** — embed / pgvector / LLM / total, per item and averaged.
- **Token usage** — Groq `usage` per answer (prompt/completion/total), summed per run.

Pass criteria (deterministic, per behavior — see the table above; v1/v2 items keep the
legacy criteria exactly):

- `off_topic` / `abstain`: pass ⇔ pipeline abstained, or answered with an explicit gap admission.
  A declared clarification on an abstain item is an `unnecessary_clarification` failure.
- `answer` / labeled `partial`: pass ⇔ recall@5 = 1 **and** answered **and** keyword coverage
  ≥ 0.5 **and** every citation marker resolves to an expected doc (**and** for `partial`,
  caveat coverage ≥ 0.5). A declared clarification on these items is an
  `unnecessary_clarification` failure.
- `clarify`: pass ⇔ abstained, **or** the response is a declared clarification containing an
  actual question that names the labeled missing detail (caveat coverage ≥ 0.5), **or** an
  answer that explicitly states its assumptions (caveat coverage ≥ 0.5); retrieval/citations
  informational.

## Storage & comparison

Runs are persisted in `eval_runs` (config + aggregate metrics) and `eval_results` (one row per
item, full scored result as JSONB; chunk text is stored as 240-char snippets only — no full
document dumps). Both tables have RLS enabled. Old runs are never overwritten: label runs
meaningfully (e.g. "before prompt v2") and compare them side by side on `/eval`, or via:

```sql
SELECT dataset_version, label, created_at,
       metrics->'passRate' AS pass_rate,
       metrics->'retrieval'->>'recallAt5' AS recall_at_5
FROM eval_runs ORDER BY created_at DESC;
```

## API

| Route | Description |
| --- | --- |
| `GET /api/eval/datasets` | list dataset versions + suite + category counts |
| `POST /api/eval/runs` | `{datasetVersion, label?}` → runs the suite (rate-limited: 12/hour, one at a time) |
| `GET /api/eval/runs` | stored run summaries; `?suite=baseline\|robustness\|clarification` filters by suite |
| `GET /api/eval/runs/:id` | full run detail incl. per-item results |
| `DELETE /api/eval/runs/:id` | delete a run (cascades to its results) |

## Tests

```bash
npm test                # node:test via tsx — metrics math, behavior scoring, dataset
                        # validation (incl. baseline immutability), runner with faked
                        # pipeline, provider retry/timeout semantics (no network)
npm run test:regression # LIVE server + DB: lifecycle, races, failure paths, providers
```

`npm test` needs no network, DB or API keys. Run `npm run typecheck` alongside.

## Limitations (be honest when quoting numbers)

- The datasets are small (23 + 15 baseline, 29 robustness, 14 clarification) and hand-authored
  from the 12 seed runbooks. They measure this KB, not general RAG quality; scores are only
  comparable across runs on the same dataset version and KB content — the 2026-10-24 audit
  showed pass rates shift when the KB grows (see `docs/AUDIT_REPORT.md`). Do not claim
  generalization from them.
- Answer "correctness" is keyword coverage — a lexical heuristic. It can miss a correct
  paraphrase and pass a keyword-stuffed wrong answer. No LLM-as-judge (that would grade the model
  with itself).
- Caveat/clarification coverage is the same kind of lexical floor and WEAKER: "not" is a caveat
  keyword on gap-admission items, so a hallucinated answer containing "not" passes. The stored
  answers must be read before claiming gap-admission behavior.
- Citation precision assumes any citation of a non-expected doc is wrong — for multi-doc questions
  the model may legitimately cite an extra relevant doc; check `invalidMarkers` before trusting a
  failure. It is document-level matching, not claim-level support: a marker placed after the wrong
  claim still counts as precise when it points at an expected doc. Claim-level verification would
  need an NLI/LLM judge and is intentionally out of scope; the sentence-level `claimSupport`
  heuristic is a cheap proxy with its own blind spots (listed above).
- Forbidden-term scoring proves the canary string did not leak into the answer — not that the
  model "understood" the injection. Novel injection phrasings are untested.
- 2026-10-24 failure analysis and the fixes it justified (citation-glyph normalization, threshold
  0.50 → 0.55, variant-marker scoring) are documented in `docs/EVAL_FAILURE_ANALYSIS.md`.
- Chunk labels are tied to the current seed content + chunker settings.
- Retrieval runs are single-shot; free-tier latency and 429 retries add variance to timing
  metrics (median-ish behavior is more stable across a few runs).
