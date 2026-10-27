/** Dev helper: delete a document by file_name (chunks cascade). */
import { pool } from "../../server/src/db/pool.js";

async function main(): Promise<void> {
  const fileName = process.argv[2];
  if (!fileName) {
    console.error("usage: npx tsx delete-doc.ts <file_name>");
    process.exit(1);
  }
  const r = await pool.query("DELETE FROM documents WHERE file_name = $1 RETURNING title", [fileName]);
  console.log(r.rowCount && r.rowCount > 0 ? `deleted: ${fileName}` : `not found: ${fileName}`);
  await pool.end();
}

void main();
