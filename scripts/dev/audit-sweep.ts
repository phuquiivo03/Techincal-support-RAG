/**
 * Audit helper: threshold sweep over EVERY question in the v1+v2 datasets.
 * Retrieves unthresholded top-5 and reports the top-1 similarity per item so
 * the on-topic minimum and off-topic maximum are visible in one table.
 * Usage (cwd=server): npx tsx ../scripts/dev/audit-sweep.ts
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { retrieve } from "../../server/src/modules/retrieval/service.js";
import { pool } from "../../server/src/db/pool.js";

interface DatasetItem {
  id: string;
  category: string;
  question: string;
}

async function main(): Promise<void> {
  const dir = path.resolve(import.meta.dirname, "../../server/eval/datasets");
  const onTopic: { id: string; top1: number }[] = [];
  const offTopic: { id: string; top1: number }[] = [];

  for (const version of ["v1", "v2"]) {
    const dataset = JSON.parse(await readFile(path.join(dir, `${version}.json`), "utf-8")) as {
      items: DatasetItem[];
    };
    for (const item of dataset.items) {
      const res = await retrieve(item.question, { topK: 5, threshold: 0 });
      const top1 = res.results[0]?.score ?? 0;
      (item.category === "off_topic" ? offTopic : onTopic).push({ id: `${version}:${item.id}`, top1 });
      console.log(`${item.category === "off_topic" ? "OFF" : "ON "} ${top1.toFixed(3)}  ${version}:${item.id}`);
    }
  }

  const onMin = Math.min(...onTopic.map((i) => i.top1));
  const offMax = Math.max(...offTopic.map((i) => i.top1));
  console.log(`\non-topic  min top-1 = ${onMin.toFixed(3)} (${onTopic.find((i) => i.top1 === onMin)?.id})`);
  console.log(`off-topic max top-1 = ${offMax.toFixed(3)} (${offTopic.find((i) => i.top1 === offMax)?.id})`);
  console.log(
    `separation window: (${offMax.toFixed(3)}, ${onMin.toFixed(3)}) — any threshold inside rejects all off-topic with zero false abstentions`,
  );
  await pool.end();
}

void main();
