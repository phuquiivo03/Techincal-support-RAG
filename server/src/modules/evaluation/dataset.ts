import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { EvalCategory, EvalDatasetInfo, EvalExpectedBehavior, EvalSuite } from "@rag/shared";

export const EVAL_CATEGORIES = [
  "factual",
  "paraphrase",
  "multi_doc",
  "error_code",
  "off_topic",
  // adversarial categories added in dataset v2 (audit 2026-10-24)
  "contradiction",
  "partial_evidence",
  "misleading_premise",
  "typo",
  "long_doc",
  "injection",
  // robustness suite categories (2026-10-25)
  "mixed_language",
  "informal",
  "underspecified",
  "unanswerable",
  "outdated",
  "multi_condition",
  // clarification suite categories (2026-10-25)
  "ambiguous",
  "contextual",
] as const satisfies readonly EvalCategory[];

export const EVAL_BEHAVIORS = ["answer", "partial", "clarify", "abstain"] as const satisfies readonly EvalExpectedBehavior[];

export const EVAL_SUITES = ["baseline", "robustness", "clarification"] as const satisfies readonly EvalSuite[];

/** Dataset versions are file names — restrict to a safe charset (no traversal). */
export const VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/i;

const chunkLabelSchema = z.object({
  fileName: z.string().min(1),
  chunkIndex: z.number().int().min(0),
});

const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const itemSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(EVAL_CATEGORIES),
    question: z.string().trim().min(3).max(2000),
    expectedAnswer: z.string().min(1),
    /** what the pipeline should do — see EvalExpectedBehavior. Legacy datasets omit it. */
    expectedBehavior: z.enum(EVAL_BEHAVIORS).optional(),
    /** prior conversation turns sent to the pipeline BEFORE the question
     *  (clarification suite, 2026-10-25) — lets items test that history resolves
     *  apparent ambiguity instead of triggering a clarification */
    history: z.array(historyMessageSchema).max(8).default([]),
    expectedFileNames: z.array(z.string().min(1)).default([]),
    expectedChunks: z.array(chunkLabelSchema).default([]),
    expectedKeywords: z.array(z.string().min(1)).default([]),
    /** signals that must appear in the answer for partial/clarify/abstain-with-caveat items */
    caveatKeywords: z.array(z.string().min(1)).default([]),
    /** any occurrence in the answer is an automatic fail (injection canaries, adopted-wrong-premise markers) */
    forbiddenKeywords: z.array(z.string().min(1)).default([]),
  })
  .superRefine((item, ctx) => {
    // effective behavior: legacy items keep the v1/v2 semantics (answer, or abstain for off_topic)
    const behavior: EvalExpectedBehavior =
      item.expectedBehavior ?? (item.category === "off_topic" ? "abstain" : "answer");
    const labeled = item.expectedFileNames.length > 0 || item.expectedChunks.length > 0 || item.expectedKeywords.length > 0;

    if (behavior === "abstain" && labeled) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${item.id}: abstain items must not carry retrieval/answer labels` });
    }
    if (behavior === "abstain" && item.expectedFileNames.length === 0 && item.category !== "off_topic" && item.caveatKeywords.length === 0) {
      // in-domain unanswerable items answered by the LLM must have gap-admission signals to fall back on
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${item.id}: non-off_topic abstain items need caveatKeywords (gap-admission fallback when the threshold lets context through)` });
    }
    if (behavior === "answer" && item.expectedFileNames.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${item.id}: answer items need at least one expectedFileName` });
    }
    if ((behavior === "answer" || behavior === "partial") && item.expectedKeywords.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${item.id}: ${behavior} items need at least one expectedKeyword` });
    }
    if ((behavior === "partial" || behavior === "clarify") && item.caveatKeywords.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${item.id}: ${behavior} items need at least one caveatKeyword (gap admission / clarification signals)` });
    }
    if (item.category === "off_topic" && behavior !== "abstain") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${item.id}: off_topic items must expect abstain` });
    }
    if (item.category === "underspecified" && behavior !== "clarify") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${item.id}: underspecified items must expect clarify` });
    }
    if (item.category === "ambiguous" && behavior !== "clarify") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${item.id}: ambiguous items must expect clarify` });
    }
    if (item.category === "contextual" && behavior !== "answer") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${item.id}: contextual items must expect answer` });
    }
    if (item.category === "contextual" && item.history.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${item.id}: contextual items need history — the conversation context is what resolves the ambiguity` });
    }
    if (item.category === "unanswerable" && behavior !== "abstain" && behavior !== "partial") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${item.id}: unanswerable items must expect abstain or partial` });
    }
    for (const chunk of item.expectedChunks) {
      if (!item.expectedFileNames.includes(chunk.fileName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${item.id}: expectedChunks references ${chunk.fileName} which is not in expectedFileNames`,
        });
      }
    }
  });

const datasetSchema = z
  .object({
    version: z.string().regex(VERSION_PATTERN),
    /** baseline | robustness — dashboard separation; legacy datasets default to baseline */
    suite: z.enum(EVAL_SUITES).default("baseline"),
    description: z.string().default(""),
    items: z.array(itemSchema).min(1),
  })
  .superRefine((data, ctx) => {
    const ids = new Set<string>();
    for (const item of data.items) {
      if (ids.has(item.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate item id: ${item.id}` });
      }
      ids.add(item.id);
    }
  });

export type EvalItem = z.infer<typeof itemSchema>;
export interface EvalDataset {
  version: string;
  suite: EvalSuite;
  description: string;
  items: EvalItem[];
}

const DATASETS_DIR = path.resolve(import.meta.dirname, "../../../eval/datasets");

function parse(raw: string, source: string): EvalDataset {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Dataset ${source} is not valid JSON`);
  }
  const parsed = datasetSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.message}`).join("\n");
    throw new Error(`Dataset ${source} failed validation:\n${issues}`);
  }
  return parsed.data;
}

/** Load one dataset version (e.g. "v1") from server/eval/datasets/. */
export async function loadDataset(version: string): Promise<EvalDataset> {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid dataset version: ${version}`);
  }
  const filePath = path.join(DATASETS_DIR, `${version}.json`);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    throw new Error(`Dataset "${version}" not found (expected ${filePath})`);
  }
  const dataset = parse(raw, `${version}.json`);
  if (dataset.version !== version) {
    throw new Error(`Dataset file ${version}.json declares version "${dataset.version}" — they must match`);
  }
  return dataset;
}

/** List all dataset versions with their category breakdown. */
export async function listDatasets(): Promise<EvalDatasetInfo[]> {
  const files = (await readdir(DATASETS_DIR)).filter((f) => f.endsWith(".json")).sort().reverse();
  const out: EvalDatasetInfo[] = [];
  for (const file of files) {
    const version = file.replace(/\.json$/, "");
    if (!VERSION_PATTERN.test(version)) continue;
    const dataset = parse(await readFile(path.join(DATASETS_DIR, file), "utf-8"), file);
    const categories: Partial<Record<EvalCategory, number>> = {};
    for (const item of dataset.items) {
      categories[item.category] = (categories[item.category] ?? 0) + 1;
    }
    out.push({
      version: dataset.version,
      suite: dataset.suite,
      description: dataset.description,
      itemCount: dataset.items.length,
      categories,
    });
  }
  return out;
}
