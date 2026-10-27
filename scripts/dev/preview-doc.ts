/** Dev helper: preview chunks of one document in the knowledge base. */
import { pool } from "../../server/src/db/pool.js";

async function main(): Promise<void> {
  const fileName = process.argv[2];
  if (!fileName) {
    console.error("usage: npx tsx preview-doc.ts <file_name>");
    process.exit(1);
  }
  const r = await pool.query(
    `SELECT c.chunk_index, left(c.content, 220) AS preview
     FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE d.file_name = $1 ORDER BY c.chunk_index LIMIT 6`,
    [fileName],
  );
  for (const row of r.rows) {
    console.log(`[${row.chunk_index}] ${String(row.preview).replace(/\n/g, " | ")}`);
  }
  await pool.end();
}

void main();
