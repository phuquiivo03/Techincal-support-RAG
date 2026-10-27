# Eval failure analysis — dataset v1 (2026-10-24)

**Baseline analyzed:** run `8b8506a2-a76b-4d35-8958-48f6ef76c4ae` — "baseline v1 (citation-bracket
diagnostics)", 2026-10-24T14:12:55Z, **12/23 passed (52.2%)**, config topK=5 · threshold=0.50 ·
`openai/gpt-oss-120b` · `gemini-embedding-001` (768d). Previous run `3eafe34c` (10/23) was
inspected for stability. Every failed item was read in full (question, expected answer, generated
answer, retrieved chunks with scores, citation markers, keyword hits, evaluator reasons) from the
stored JSONB in `eval_results`.

## TL;DR

| Class | Count | Items |
| --- | --- | --- |
| Retrieval failure | **0** | — (recall@5 = 1.0 and MRR = 1.0 on every labeled item) |
| Generation — answer content | **0** | keyword coverage = 1.0 on every labeled item |
| Citation — non-ASCII bracket format | **8** | err-001, err-002, fact-003, fact-005, multi-002, para-002, para-003, para-004 |
| Citation — annotated variant `【n†Lx-Ly】` + **eval misdetection** | **1** | err-005 |
| Abstention — threshold marginality | **2** | off-003 (0.506), off-005 (0.512) |
| Eval-logic false negative (correct answer marked FAIL) | **0** | — but one *misdiagnosed* failure (err-005) and two measurement blind spots, see §3 |

All 11 failures are **citation formatting** (9) or **threshold marginality** (2). The model's
answers were substantively correct with correct document attribution in every case; retrieval is
not implicated in any failure.

## 1. Per-item diagnosis

### 1.1 Variant-bracket citation failures (8 items)

gpt-oss-120b emitted citations as `【n】` (CJK lenticular brackets) instead of `[n]` in 9 of 18
answered items. The evaluator (correctly, per the UI contract — `AnswerBody` only links ASCII
`[n]`) fails these with "citations use non-standard 【n】 brackets".

| Item | Retrieval | Keywords | Variant markers | Markers resolve to |
| --- | --- | --- | --- | --- |
| err-001 | recall 1.0, MRR 1.0 | 1.0 (40P01, order, retry) | 5, 3, 4 | postgres-deadlock.md (expected) |
| err-002 | recall 1.0, MRR 1.0 | 1.0 (pg_stat_activity, pool, release) | 2, 3, 5 | postgres-pool-exhaustion.md (expected) |
| fact-003 | recall 1.0, MRR 1.0 | 1.0 (max-old-space-size, 384, heap) | 2, 1 | docker-container-oom.md (expected) |
| fact-005 | recall 1.0, MRR 1.0 | 1.0 (lock, NX, TTL) | 1, 5 | redis-oom-eviction.md (expected) |
| multi-002 | recall 1.0, MRR 1.0 | 1.0 (event loop, worker_threads, proxy_read_timeout) | 5, 2, 4, 3 | nodejs-event-loop-blocking.md + nginx-502-upstream.md (both expected) |
| para-002 | recall 1.0, MRR 1.0 | 1.0 (deadlock, order, retry) | 1, 5, 4 | postgres-deadlock.md (expected) |
| para-003 | recall 1.0, MRR 1.0 | 1.0 (evict, maxmemory, TTL) | 1, 2, 3, 5 | redis-oom-eviction.md (expected) |
| para-004 | recall 1.0, MRR 1.0 | 1.0 (OOM, max-old-space-size, cgroup) | 1, 5, 3 | docker-container-oom.md (expected) |

Spot-checks confirm the cited chunks actually support the adjacent claims (e.g. err-001 `【5】`
follows the circular-wait explanation and rank 5 is the "Root cause" chunk; fact-003 `【2】`
follows the 60–75 % rule and rank 2 is the "Fix" chunk containing that rule). **All 21 variant
markers in the run resolve to expected documents — zero wrong-document citations.** The failures
are purely glyph format.

Classification: **generation (citation format)**. Root cause: model-side; nothing in the prompt
forbids the variant form, and the choice varies per completion (the same items passed with `[n]`
in other runs — run `3eafe34c` failed a *different* 7 items the same way, confirming
nondeterministic bracket choice, not item-specific behavior).

### 1.2 err-005 — annotated citations + evaluator misdetection

Answer contains `【1†L9-L12】【4†L2-L4】【2†L2-L4】…` — a third citation style: lenticular bracket
**plus an invented line-range annotation**. `VARIANT_MARKER_RE = /【(\d{1,2})】/g` requires `】`
immediately after the digits, so **none of these match**: the item was recorded as *"answer
contains no [n] citations"* (citation silence) when the model in fact cited sources 1, 2 and 4 —
all in nginx-502-upstream.md, the expected doc.

Two findings:
1. **Eval-logic bug (confirmed):** the variant regex misses annotated markers, so citation
   presence/format is misdiagnosed. The item still fails, but for a factually wrong reason, and
   the variant-marker count is under-reported.
2. **Generation finding:** the `†L9-L12` line references are fabricated — context blocks carry no
   line metadata. Harmless once normalized away, but worth noting the model invents citation
   apparatus under this failure mode.

Classification: **citation format (generation) + eval-logic (detection)**.

### 1.3 off-003 / off-005 — abstention threshold marginality

Unthresholded top-1 similarities (probe with `threshold=0`, reproduced identically to the stored
run — Gemini embeddings are deterministic here):

| Item | Question flavor | Top-1 score | vs 0.50 | Outcome |
| --- | --- | --- | --- | --- |
| off-001 | pizza dough | 0.471 | −0.029 | abstained ✓ PASS |
| off-002 | passport renewal | 0.440 | −0.060 | abstained ✓ PASS |
| off-003 | **Kubernetes RBAC** | **0.506** | **+0.006** | LLM called → FAIL |
| off-004 | guitar chords | 0.430 | −0.070 | abstained ✓ PASS |
| off-005 | **salary negotiation** | **0.512** | **+0.012** | LLM called → FAIL |

- **off-003** clears the threshold by 0.006 because the pool-exhaustion incident doc discusses
  multi-tenant/multi-process connection management — the closest in-domain neighbor to
  "multi-tenant cluster". The LLM, given irrelevant context, *correctly refused* ("the context
  blocks do not contain any information about configuring Kubernetes RBAC"). So the answer text
  was honest, but the pipeline contract ("no LLM call when nothing relevant clears the threshold")
  was violated: the user gets a refusal message instead of the amber insufficient-info card.
- **off-005** clears by 0.012 ("first software engineering job" embedding lands near generic
  engineering-ops content: websocket heartbeats, event loop, Docker, Redis). Same shape: honest
  LLM refusal, contract violation, FAIL.

Classification: **abstention (retrieval threshold marginality)** — not model misbehavior. Both
items failed identically in run `3eafe34c`, i.e. this is stable, deterministic behavior.

Decisive margin data: on-topic top-1 scores across the same run span **0.745–0.853** (min:
fact-004). The highest off-topic score is **0.512**. The separation window (0.512, 0.745) is wide;
0.50 sits below it. The retrieval-only sweep in `eval/RESULTS.md` (2 easier off-topic probes)
showed 100 % rejection from 0.50 — that golden set simply never probed the 0.50–0.52 band.

## 2. False negatives (correct answer, marked FAIL)

**None in the strict sense.** Every FAIL matches the documented pass criteria; no item failed on
retrieval, keywords, or false abstention, and no failure reason is *triggered* incorrectly for
items 1.1/1.3. However:

- **err-005 is a misdiagnosed failure** (right verdict — the UI cannot link `【1†…】` — wrong
  recorded reason: "no citations" instead of "variant format"). The evaluator's citation-presence
  signal is false for this item class.
- **The 8 variant-bracket items are correct answers with correct citations penalized only for the
  bracket glyph.** Per this project's own contract (citations must be linkable `[n]`) these are
  legitimate failures of the *generation contract*, so they are not evaluator false negatives —
  but the evaluator currently records *no citation-quality signal at all* for them
  (`citationPrecision = null`), which means run-level citation metrics are computed only over the
  ASCII-citing subset (a biased sample — see §3).
- Latent false-*positive* risk found while auditing: `MARKER_RE = /\[(\d{1,2})\]/g` also matches
  array indexing in fenced code (`ids[0]`, `arr[1]`) — an answer whose code block contains a
  small-index array literal would be failed with "markers [0] point outside the expected
  documents". No current item hits this (all `invalidMarkers` are empty), but it is one
  code-heavy answer away from a bogus failure.

## 3. Citation-metric audit — do they measure source support?

What `computeCitationScore` actually measures: for each ASCII `[n]` marker, does `sources[n]`
belong to an expected document (precision), and did any marker cover each expected doc (recall).
Verified properties:

- ✓ Index plumbing is consistent: `buildContext` numbers blocks by rank, `Citation.index = rank`,
  so `[3]` resolves to exactly the block the model saw as `[3]`.
- ✓ Unresolvable markers (n > sources) count against precision; markers pointing at a retrieved
  but non-expected doc are flagged in `invalidMarkers`.
- ✗ **Document-level only, not claim-level.** A `[3]` placed after a claim that actually came from
  block 1 still counts as precise whenever both are the expected doc. In this KB (one incident
  topic per doc) spot-checks show doc-level matching happens to coincide with claim support, but
  for multi-doc items the metric cannot tell which claim is backed by which doc. True claim-level
  support would need an NLI/LLM judge — out of scope for a deterministic harness; this limitation
  must stay documented.
- ✗ **Variant citations are invisible to the metrics** (`citationPrecision`/`citationRecall` null
  for all 9 variant items; aggregates exclude them via the `withMarkers`/`answered` filters). The
  run aggregate `citationPrecision` is therefore an average over a self-selected subset and
  overstates system-wide citation behavior when variant brackets appear.
- ✗ **Annotated variants are invisible even to the variant detector** (§1.2).
- ✗ **Off-topic answered items record `chunkIndex: 0`** for every retrieved chunk (the recovery
  path needs `rankingChunks`, which is null for unlabeled items) — dashboard shows wrong chunk
  numbers for exactly the items one wants to debug.

## 4. Recommended fixes (prioritized)

| # | Fix | Type | Impact | Risk |
| --- | --- | --- | --- | --- |
| 1 | **Normalize citation glyphs server-side**: rewrite `【n…】` (incl. annotated) and `[n†…]` to `[n]` in the chat answer before returning; skip fenced/inline code. | generation pipeline | Clears 9/11 failures at the root; citations become linkable in UI; deterministic. | Low — pure text transform, marker still points at the same source. |
| 2 | **Raise `SIMILARITY_THRESHOLD` 0.50 → 0.55** (`env.ts` default + `server/.env`). | retrieval setting | Rejects off-003 (0.506) and off-005 (0.512) with ≥ 0.038 margin; on-topic minimum is 0.745, so ≥ 0.195 headroom remains; `RESULTS.md` sweep already shows 0.55–0.65 fully green on the golden set. | Low-medium — real user queries phrased further off-distribution could false-abstain; 0.55 is the conservative end of the safe window (0.513–0.745). |
| 3 | **Broaden variant detection** to `【n…】` with short annotation; strip code spans/fences before marker parsing (also fixes the `ids[0]` false-positive risk). | eval logic | Correct failure reasons; citation presence no longer misreported. | Low. |
| 4 | **Score variant markers against sources** as `variantCitationPrecision` (per item + aggregate), keep pass criteria unchanged. | eval logic | Citation metrics stop being blind for variant answers; honest baseline for fix #1. | Low. |
| 5 | **Carry `chunkIndex` on `Citation`** from retrieval (drop the 0-placeholder). | eval reporting | Dashboard shows true chunk numbers for off-topic answered items. | Low — additive optional field. |
| 6 | Keep claim-level citation support and LLM-judge grading **out of scope** (documented limitation). | — | — | — |

Not changed, deliberately: prompts (normalization removes the need to beg the model for ASCII),
models, top-k, chunking, dataset labels, pass thresholds (keyword ≥ 0.5), and the off-topic pass
criterion (abstention contract stays strict — an honest LLM refusal is still a contract violation).

## 5. Verification protocol (this run's contract)

After implementing 1–5: `npm test`, `npm run typecheck`, then re-seed + retrieval baseline
(`npm run seed && npm run eval`) and a fresh `npm run eval:suite` on the **same dataset v1**,
compared against run `8b8506a2` (12/23). Expected: citation-format failures disappear (items pass
only if the model still cites + keywords hold), off-003/off-005 abstain, zero new failures.
Anything else is a regression, not progress.

## 6. Outcome (fixes applied 2026-10-24, rerun on the same dataset v1)

New run `d67f66c1-8a4b-4baf-bd59-7633df0baee7` — "post failure-analysis: citation normalization +
threshold 0.55", same dataset v1, same KB (re-seeded), same model/embeddings:

| Metric | Baseline `8b8506a2` | Post-fix `d67f66c1` | Note |
| --- | --- | --- | --- |
| Pass rate | 12/23 (52.2 %) | **23/23 (100 %)** | all 11 prior failures fixed, zero new failures |
| recall@5 / MRR / chunkRecall@5 | 1.0 / 1.0 / 0.889 | 1.0 / 1.0 / 0.889 | retrieval unchanged |
| keyword coverage | 0.926 | 0.889 | lexical sampling variance (5 items at 0.667, all ≥ 0.5 bar); fixes touch only citation glyphs |
| citation precision | 1.0 (over 9 ASCII-citing items only) | 1.0 (over all 18 answered) | metric now covers every answered item |
| off-topic abstention | 3/5 (60 %) | **5/5 (100 %)** | off-003 (0.506) and off-005 (0.512) now below the 0.55 cutoff |
| false abstentions | 0 | 0 | weakest on-topic item scores 0.745, well above 0.55 |
| total tokens | 28,546 | 25,987 | 2 fewer LLM calls (off-topic abstains skip the LLM) |

Verification detail: 18 answered items carry 49 ASCII `[n]` markers, 0 residual `【…】`
markers in any stored answer (normalizer active end-to-end; retrieval-only baseline re-run at
0.55 stayed 100 % hit@1 / MRR 1.0 — `eval/RESULTS.md` regenerated). Regression tests added:
annotated `【n†Lx-Ly】` detection, code-span exclusion for `[n]` parsing, variant-marker
precision scoring, `Citation.chunkIndex` propagation, and the citation normalizer itself
(`npm test` → 35/35).

Residual, honestly stated: single-run evidence; the model's bracket choice is nondeterministic,
so the pass rate should be confirmed stable over a few future runs (the normalizer makes the
outcome deterministic regardless — any `【n】` the model emits is rewritten before scoring and
before the UI sees it). Keyword coverage is still a lexical heuristic; claim-level citation
support remains unmeasured (documented limitation).
