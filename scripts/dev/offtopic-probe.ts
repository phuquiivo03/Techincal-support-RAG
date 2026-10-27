/** Dev helper: unthresholded top-3 retrieval scores for the off-topic probes.
 *  Read-only (embedding + pgvector query); no pipeline or settings are modified. */
import { pool } from "../../server/src/db/pool.js";
import { retrieve } from "../../server/src/modules/retrieval/service.js";

const OFF_TOPIC = [
  "What is the best recipe for neapolitan pizza dough?",
  "How do I renew my passport and what documents do I need to bring?",
  "How do I configure Kubernetes RBAC roles for a multi-tenant cluster?",
  "Which guitar chords should a beginner learn first?",
  "How should I prepare to negotiate a higher salary at my first software engineering job?",
];

async function main(): Promise<void> {
  for (const q of OFF_TOPIC) {
    const r = await retrieve(q, { topK: 3, threshold: 0 });
    console.log(
      JSON.stringify({
        question: q,
        top3: r.results.map((c) => ({
          score: c.score,
          doc: c.documentFileName,
          chunk: c.chunkIndex,
        })),
        wouldClear050: r.results[0] ? r.results[0].score >= 0.5 : false,
      }),
    );
  }
  await pool.end();
}

void main();
