import { pool } from "../src/db/pool.js";

/**
 * Operational regression suite (2026-10-25) — runs against the LIVE server
 * (default http://localhost:4000, start with scripts/dev/start-server.sh) and
 * the live database, then cleans up after itself. Covers the ingestion and
 * serving behaviors the robustness report relies on:
 *
 *   1. duplicate ingestion (same file_name twice → exactly one doc)
 *   2. update with FEWER chunks (stale-chunk cleanup)
 *   3. deletion cascade (no orphan chunks)
 *   4. indexing failure paths (whitespace-only, fake .pdf, bad extension)
 *   5. concurrent uploads of the same file_name (upsert race — known: loser
 *      may 500 with 23505, integrity must hold) + concurrent retrievals
 *   6. provider reachability via /api/health (upstream timeout/retry SEMANTICS
 *      are locked network-free in src/providers/http.test.ts — this check only
 *      proves the live providers answer)
 *
 * Usage: npm run test:regression   (from repo root; server must be running)
 */
const API = process.env.API_URL ?? "http://localhost:4000";
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function upload(name: string, content: string): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([content]), name);
  return fetch(`${API}/api/documents`, { method: "POST", body: form });
}

interface Doc {
  id: string;
  fileName: string;
  chunkCount: number;
}

async function listDocs(): Promise<Doc[]> {
  const res = await fetch(`${API}/api/documents`);
  return ((await res.json()) as { documents: Doc[] }).documents;
}

async function docsNamed(name: string): Promise<Doc[]> {
  return (await listDocs()).filter((d) => d.fileName === name);
}

async function chunkCount(docId: string): Promise<number> {
  const res = await pool.query("SELECT count(*)::int AS n FROM chunks WHERE document_id = $1", [docId]);
  return res.rows[0].n;
}

async function orphanChunks(): Promise<number> {
  const res = await pool.query(
    "SELECT count(*)::int AS n FROM chunks c LEFT JOIN documents d ON d.id = c.document_id WHERE d.id IS NULL",
  );
  return res.rows[0].n;
}

async function deleteAll(prefix: string): Promise<void> {
  for (const doc of await listDocs()) {
    if (doc.fileName.startsWith(prefix)) {
      await fetch(`${API}/api/documents/${doc.id}`, { method: "DELETE" });
    }
  }
}

const LONG = `# Regression doc — long version\n\n${Array.from({ length: 28 }, (_, i) => `Section ${i}: original long content about topic-${i} with enough words to spread across several chunks. `.repeat(3)).join("\n\n")}`;
const SHORT = "# Regression doc — short version\n\nReplacement content about the unicorn deploy marker only. Quick fix notes.";

async function main(): Promise<void> {
  const NAME = "regression-doc.md";
  await deleteAll("regression-"); // clean slate

  // --- 1. duplicate ingestion -------------------------------------------------
  const first = await upload(NAME, LONG);
  check("upload accepted (201)", first.status === 201, `got ${first.status}`);
  const doc1 = ((await first.json()) as { document: Doc }).document;
  const dup = await upload(NAME, LONG);
  check("duplicate upload accepted (upsert, 201)", dup.status === 201, `got ${dup.status}`);
  const doc2 = ((await dup.json()) as { document: Doc }).document;
  const named = await docsNamed(NAME);
  check("duplicate ingestion leaves exactly one document", named.length === 1, `found ${named.length}`);
  check("upsert replaced the row (new id)", doc2.id !== doc1.id);
  check("old version's chunks are gone (cascade delete)", (await chunkCount(doc1.id)) === 0);
  const longChunks = doc2.chunkCount;
  check("long version indexed across many chunks", longChunks >= 8, `${longChunks} chunks`);

  // --- 2. update with FEWER chunks (stale-chunk regression) --------------------
  const update = await upload(NAME, SHORT);
  check("update upload accepted (201)", update.status === 201, `got ${update.status}`);
  const doc3 = ((await update.json()) as { document: Doc }).document;
  const afterUpdate = await docsNamed(NAME);
  check("update keeps exactly one document", afterUpdate.length === 1, `found ${afterUpdate.length}`);
  check(
    "re-index with fewer chunks leaves no stale chunks",
    (await chunkCount(doc3.id)) === afterUpdate[0].chunkCount && afterUpdate[0].chunkCount < longChunks,
    `now ${afterUpdate[0].chunkCount}, was ${longChunks}`,
  );
  const stale = await pool.query<{ content: string }>(
    "SELECT content FROM chunks WHERE document_id = $1 AND content LIKE '%topic-%'",
    [doc3.id],
  );
  check("no chunk contains text from the previous version", stale.rows.length === 0, `${stale.rows.length} stale`);
  const retrieve = await fetch(`${API}/api/retrieve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "unicorn deploy marker", threshold: 0 }),
  });
  const results = ((await retrieve.json()) as { results: { content: string }[] }).results;
  check("retrieval serves the NEW content", results.some((r) => r.content.includes("unicorn")));

  // --- 3. deletion cascade ------------------------------------------------------
  const del = await fetch(`${API}/api/documents/${doc3.id}`, { method: "DELETE" });
  check("delete returns 200", del.status === 200, `got ${del.status}`);
  check("deleted document has zero chunks", (await chunkCount(doc3.id)) === 0);
  check("no orphan chunks anywhere in the KB", (await orphanChunks()) === 0);

  // --- 4. indexing failure paths ------------------------------------------------
  const empty = await upload("regression-empty.txt", "   \n\n  \n");
  check("whitespace-only file rejected 422", empty.status === 422, `got ${empty.status}`);
  check("rejected file leaves no document row", (await docsNamed("regression-empty.txt")).length === 0);
  const fakePdf = await upload("regression-fake.pdf", "this is not a pdf at all");
  check("non-PDF with .pdf extension rejected 422", fakePdf.status === 422, `got ${fakePdf.status}`);
  check("fake pdf leaves no document row", (await docsNamed("regression-fake.pdf")).length === 0);
  const badExt = await upload("regression.exe", "binary-ish");
  check("unsupported extension rejected 415", badExt.status === 415, `got ${badExt.status}`);

  // --- 5. concurrency -------------------------------------------------------------
  // 5a. concurrent uploads of the same file_name: the embed phase runs before
  // the transaction, so both race on DELETE+INSERT. Known limitation: the loser
  // may observe 23505 (unique violation) → HTTP 500. What must hold: exactly one
  // doc row afterwards, zero orphans, retrieval works.
  const racer = "regression-race.md";
  const racers = await Promise.all([
    upload(racer, `# Race A\n\nAlpha marker content for the concurrent upsert race.`),
    upload(racer, `# Race B\n\nBeta marker content for the concurrent upsert race.`),
    upload(racer, `# Race C\n\nGamma marker content for the concurrent upsert race.`),
  ]);
  const statuses = racers.map((r) => r.status).sort();
  const raceDocs = await docsNamed(racer);
  const any500 = statuses.filter((s) => s >= 500).length;
  check(
    "concurrent same-name uploads: exactly one document survives",
    raceDocs.length === 1,
    `statuses [${statuses}] → ${raceDocs.length} doc(s)`,
  );
  if (any500 > 0) {
    console.log(`      note: ${any500} racer(s) hit the known 23505 race 500 — integrity is what matters here`);
  }
  check("no orphan chunks after the race", (await orphanChunks()) === 0);

  // 5b. concurrent retrievals: read path under parallel load stays consistent
  const reads = await Promise.all(
    Array.from({ length: 6 }, () =>
      fetch(`${API}/api/retrieve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "postgres deadlock 40P01", threshold: 0 }),
      }),
    ),
  );
  check(
    "6 parallel retrievals all return 200",
    reads.every((r) => r.status === 200),
    reads.map((r) => r.status).join(","),
  );

  // --- 6. providers reachable (timeout semantics live in http.test.ts) -----------
  const health = await fetch(`${API}/api/health`);
  const healthBody = (await health.json()) as { status: string; db: boolean; embeddings: boolean; llm: boolean };
  check("health endpoint reports ok", health.status === 200 && healthBody.status === "ok");
  check("database reachable", healthBody.db);
  check("embedding provider reachable", healthBody.embeddings);
  check("llm provider reachable", healthBody.llm);

  // --- cleanup ----------------------------------------------------------------------
  await deleteAll("regression-");
  const leftovers = (await listDocs()).filter((d) => d.fileName.startsWith("regression-"));
  check("cleanup removed all regression docs", leftovers.length === 0, `${leftovers.length} left`);
  check("final state: no orphan chunks", (await orphanChunks()) === 0);

  console.log(failures === 0 ? "\nALL REGRESSION CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

void main();
