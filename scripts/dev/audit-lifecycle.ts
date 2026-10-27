/**
 * Audit helper: document lifecycle test against the LIVE API (localhost:4000).
 * Exercises duplicate import, update (re-upload same file_name), deletion,
 * failed indexing paths, stale-embedding cleanup and case-sensitivity of the
 * upsert key, verifying DB state directly after each step.
 * Usage (any cwd): npx tsx scripts/dev/audit-lifecycle.ts
 */
import { pool } from "../../server/src/db/pool.js";

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

async function listDocs(): Promise<{ id: string; fileName: string; chunkCount: number }[]> {
  const res = await fetch(`${API}/api/documents`);
  return (await res.json()).documents;
}

async function chunkIdsFor(docId: string): Promise<string[]> {
  const res = await pool.query("SELECT id FROM chunks WHERE document_id = $1", [docId]);
  return res.rows.map((r) => r.id);
}

async function orphanChunks(): Promise<number> {
  const res = await pool.query(
    "SELECT count(*)::int AS n FROM chunks c LEFT JOIN documents d ON d.id = c.document_id WHERE d.id IS NULL",
  );
  return res.rows[0].n;
}

async function main(): Promise<void> {
  const NAME = "audit-lifecycle-doc.md";
  const NAME_UPPER = "Audit-Lifecycle-Doc.md";
  const v1 = "# Lifecycle test v1\n\nOriginal content about zebra migration patterns in qa clusters.";
  const v2 = "# Lifecycle test v2\n\nREPLACED content about entirely different unicorn deploy markers.";

  // 1. duplicate import: same file_name uploaded twice → single doc, chunks replaced
  const up1 = await upload(NAME, v1);
  check("upload v1 returns 201", up1.status === 201);
  const doc1 = (await up1.json()).document;
  const up1b = await upload(NAME, v1);
  check("duplicate upload returns 201 (upsert)", up1b.status === 201);
  const doc1b = (await up1b.json()).document;
  const docs1 = (await listDocs()).filter((d) => d.fileName === NAME);
  check("duplicate import leaves exactly one document", docs1.length === 1, `found ${docs1.length}`);
  check("duplicate import replaces the doc row (new id)", doc1b.id !== doc1.id);
  const oldChunks = await chunkIdsFor(doc1.id);
  check("old version chunks are cleaned up (cascade)", oldChunks.length === 0, `${oldChunks.length} stale chunk(s)`);

  // 2. update: same file_name, different content → new chunks, no stale text
  const up2 = await upload(NAME, v2);
  const doc2 = (await up2.json()).document;
  check("update upload returns 201", up2.status === 201);
  const docs2 = (await listDocs()).filter((d) => d.fileName === NAME);
  check("update keeps exactly one document", docs2.length === 1);
  const chunkRows = await pool.query<{ content: string }>(
    "SELECT content FROM chunks WHERE document_id = $1",
    [doc2.id],
  );
  const hasOld = chunkRows.rows.some((r) => r.content.includes("zebra"));
  const hasNew = chunkRows.rows.some((r) => r.content.includes("unicorn"));
  check("updated doc indexes new content", hasNew);
  check("no stale chunks from previous version", !hasOld);
  const retrieve = await fetch(`${API}/api/retrieve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "unicorn deploy markers in the lifecycle doc", threshold: 0 }),
  });
  const retrieved = (await retrieve.json()).results as { content: string }[];
  check("retrieval finds the new content", retrieved.some((r) => r.content.includes("unicorn")));

  // 3. failed indexing paths leave no partial document
  const empty = await upload("audit-empty.txt", "   \n\n  \n");
  check("whitespace-only file rejected 422", empty.status === 422, `got ${empty.status}`);
  const emptyDocs = (await listDocs()).filter((d) => d.fileName === "audit-empty.txt");
  check("rejected file leaves no document row", emptyDocs.length === 0);

  const fakePdf = await upload("audit-fake.pdf", "this is not a pdf at all");
  check("non-PDF with .pdf extension rejected 422", fakePdf.status === 422, `got ${fakePdf.status}`);
  const pdfDocs = (await listDocs()).filter((d) => d.fileName === "audit-fake.pdf");
  check("fake pdf leaves no document row", pdfDocs.length === 0);

  const badExt = await upload("audit.exe", "binary-ish");
  check("unsupported extension rejected 415", badExt.status === 415, `got ${badExt.status}`);

  // 4. case-sensitivity of the upsert key
  const upUpper = await upload(NAME_UPPER, v2);
  check("case-variant upload accepted", upUpper.status === 201);
  const caseDocs = (await listDocs()).filter((d) => d.fileName.toLowerCase() === NAME.toLowerCase());
  check(
    "case-variant file_name creates a SEPARATE document (upsert key is case-sensitive)",
    caseDocs.length === 2,
    `found ${caseDocs.length}: ${caseDocs.map((d) => d.fileName).join(", ")}`,
  );

  // 5. deletion removes chunks
  const del = await fetch(`${API}/api/documents/${doc2.id}`, { method: "DELETE" });
  check("delete returns 200", del.status === 200);
  const delChunks = await chunkIdsFor(doc2.id);
  check("deleted document has zero chunks", delChunks.length === 0);

  // cleanup the case-variant + any leftovers
  for (const doc of await listDocs()) {
    if (doc.fileName.toLowerCase().startsWith("audit-lifecycle-doc")) {
      await fetch(`${API}/api/documents/${doc.id}`, { method: "DELETE" });
    }
  }
  const leftovers = (await listDocs()).filter((d) => d.fileName.toLowerCase().startsWith("audit"));
  check("cleanup removed all audit docs", leftovers.length === 0);
  check("no orphan chunks anywhere in the KB", (await orphanChunks()) === 0);

  console.log(failures === 0 ? "\nALL LIFECYCLE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

void main();
