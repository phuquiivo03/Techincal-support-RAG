import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { migrate } from "../src/db/migrate.js";
import { pool } from "../src/db/pool.js";
import { ingestDocument } from "../src/modules/documents/service.js";
import { getStats } from "../src/modules/documents/service.js";

const SEED_DIR = path.resolve(import.meta.dirname, "..", "seed");

async function main(): Promise<void> {
  await migrate(pool);

  const files = (await readdir(SEED_DIR)).filter((f) => f.endsWith(".md")).sort();
  if (files.length === 0) {
    console.error(`No seed documents found in ${SEED_DIR}`);
    process.exit(1);
  }

  console.log(`Indexing ${files.length} documents into the knowledge base…\n`);
  for (const file of files) {
    const content = await readFile(path.join(SEED_DIR, file), "utf-8");
    const title = content.match(/^#\s+(.+)\s*$/m)?.[1] ?? file;
    const summary = await ingestDocument({ title, fileName: file, sourceType: "md", content });
    console.log(`  ✓ ${file.padEnd(32)} ${String(summary.chunkCount).padStart(3)} chunks  ${summary.charCount} chars`);
  }

  const stats = await getStats();
  console.log(`\nKnowledge base: ${stats.documents} documents, ${stats.chunks} chunks (updated ${stats.lastUpdated ?? "n/a"})`);

  await pool.end();
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
