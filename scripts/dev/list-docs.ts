/** Dev helper: list documents currently in the knowledge base. */
import { pool } from "../../server/src/db/pool.js";

async function main(): Promise<void> {
  const r = await pool.query(
    "SELECT file_name, title, chunk_count, char_count, created_at FROM documents ORDER BY created_at",
  );
  for (const row of r.rows) {
    console.log(
      `${String(row.chunk_count).padStart(3)} chunks  ${String(row.char_count).padStart(6)} chars  ${row.file_name}  (created ${row.created_at.toISOString()})`,
    );
  }
  await pool.end();
}

void main();
