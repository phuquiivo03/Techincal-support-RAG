import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { asyncHandler, HttpError } from "../../lib/errors.js";
import { VERSION_PATTERN } from "./dataset.js";
import { deleteRun, getRun, listDatasets, listRuns, runEvaluation } from "./service.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const runBodySchema = z.object({
  datasetVersion: z.string().regex(VERSION_PATTERN, "Unknown dataset version"),
  label: z.string().trim().max(120).optional(),
});

/** Starting a run makes ~20 real LLM calls — keep it tightly rate limited. */
const runLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many evaluation runs this hour — each one spends real LLM quota" },
});

export const evaluationRouter = Router();

evaluationRouter.get(
  "/datasets",
  asyncHandler(async (_req, res) => {
    res.json({ datasets: await listDatasets() });
  }),
);

evaluationRouter.post(
  "/runs",
  runLimiter,
  asyncHandler(async (req, res) => {
    const { datasetVersion, label } = runBodySchema.parse(req.body);
    // Long-running: one run at a time per server process (service also guards)
    res.json(await runEvaluation({ datasetVersion, label }));
  }),
);

evaluationRouter.get(
  "/runs",
  asyncHandler(async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(100).catch(20).parse(req.query.limit ?? 20);
    const suite = z
      .union([z.enum(["baseline", "robustness", "clarification"]), z.literal("all")])
      .catch("all")
      .parse(req.query.suite ?? "all");
    res.json({ runs: await listRuns(limit, suite === "all" ? undefined : suite) });
  }),
);

evaluationRouter.get(
  "/runs/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw new HttpError(400, "Invalid run id");
    const run = await getRun(id);
    if (!run) throw new HttpError(404, "Evaluation run not found");
    res.json(run);
  }),
);

evaluationRouter.delete(
  "/runs/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw new HttpError(400, "Invalid run id");
    if (!(await deleteRun(id))) throw new HttpError(404, "Evaluation run not found");
    res.json({ deleted: true });
  }),
);
