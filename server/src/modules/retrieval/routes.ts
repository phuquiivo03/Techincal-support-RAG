import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/errors.js";
import { buildContext, retrieve } from "./service.js";

const bodySchema = z.object({
  query: z.string().trim().min(3, "Query must be at least 3 characters").max(2000),
  topK: z.coerce.number().int().min(1).max(10).optional(),
  threshold: z.coerce.number().min(0).max(1).optional(),
});

export const retrievalRouter = Router();

retrievalRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { query, topK, threshold } = bodySchema.parse(req.body);
    const result = await retrieve(query, { topK, threshold });
    res.json({
      query,
      topK: result.topK,
      threshold: result.threshold,
      results: result.results,
      contextPreview: buildContext(result.results),
      timings: {
        embedMs: result.timings.embedMs,
        retrievalMs: result.timings.retrievalMs,
        totalMs: Math.round((result.timings.embedMs + result.timings.retrievalMs) * 10) / 10,
      },
    });
  }),
);
