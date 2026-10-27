/**
 * Audit helper: two CONCURRENT uploads of the same file_name — exercises the
 * upsert race (embed phase runs before the transaction, so both transactions
 * start nearly simultaneously). Expect one winner; observe the loser's status.
 * Usage (any cwd): npx tsx scripts/dev/audit-race.ts
 */
const API = process.env.API_URL ?? "http://localhost:4000";
const NAME = "audit-race-doc.md";

async function upload(marker: string): Promise<{ status: number; body: string }> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([`# Race test\n\nContent marker ${marker} for concurrent upload semantics.`]),
    NAME,
  );
  const res = await fetch(`${API}/api/documents`, { method: "POST", body: form });
  return { status: res.status, body: JSON.stringify(await res.json()).slice(0, 200) };
}

async function main(): Promise<void> {
  // clean slate
  const list = await fetch(`${API}/api/documents`).then((r) => r.json());
  for (const doc of list.documents.filter((d: { fileName: string }) => d.fileName === NAME)) {
    await fetch(`${API}/api/documents/${doc.id}`, { method: "DELETE" });
  }

  const [a, b] = await Promise.all([upload("alpha"), upload("beta")]);
  console.log(`upload A: ${a.status} ${a.body}`);
  console.log(`upload B: ${b.status} ${b.body}`);

  const after = await fetch(`${API}/api/documents`).then((r) => r.json());
  const docs = after.documents.filter((d: { fileName: string }) => d.fileName === NAME);
  console.log(`documents named ${NAME}: ${docs.length} (ids: ${docs.map((d: { id: string }) => d.id).join(", ")})`);

  // cleanup
  for (const doc of docs) await fetch(`${API}/api/documents/${doc.id}`, { method: "DELETE" });
  console.log(docs.length === 1 ? "RESULT: exactly one winner — no duplicate rows" : "RESULT: ANOMALY");
}

void main();
