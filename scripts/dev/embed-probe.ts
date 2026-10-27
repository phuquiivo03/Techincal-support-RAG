import { embedTexts } from "../../server/src/providers/embeddings.js";
import { pool } from "../../server/src/db/pool.js";

async function main(): Promise<void> {
  try {
    const t0 = Date.now();
    const [vec] = await embedTexts(["embedding quota probe"]);
    console.log(`OK dim=${vec.length} in ${Date.now() - t0}ms`);
  } catch (err) {
    console.log("EMBED FAILED:", err instanceof Error ? err.message : err);
  }
  await pool.end();
}

void main();
