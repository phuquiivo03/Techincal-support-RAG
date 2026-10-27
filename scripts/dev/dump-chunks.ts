/**
 * Dev helper: print chunk index previews for each seed doc so dataset
 * chunk labels can be written against real chunker output.
 * Usage: npx tsx scripts/dev/dump-chunks.ts [substring]
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { chunkText } from "../../server/src/modules/documents/chunker.js";

const SEED_DIR = path.resolve(import.meta.dirname, "../../server/seed");

async function main(): Promise<void> {
  const needle = process.argv[2]?.toLowerCase();
  const files = (await readdir(SEED_DIR)).filter((f) => f.endsWith(".md")).sort();
  for (const file of files) {
    const text = await readFile(path.join(SEED_DIR, file), "utf-8");
    const chunks = chunkText(text);
    console.log(`=== ${file} (${chunks.length} chunks)`);
    chunks.forEach((c, i) => {
      if (!needle || c.content.toLowerCase().includes(needle)) {
        console.log(`  [${i}] ${c.content.slice(0, 130).replace(/\n/g, " | ")}`);
      }
    });
  }
}

void main();
