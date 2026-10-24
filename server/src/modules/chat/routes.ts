import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/errors.js";
import { answerQuestion } from "./service.js";

const bodySchema = z.object({
  question: z.string().trim().min(3, "Question must be at least 3 characters").max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .max(12)
    .optional()
    .default([]),
});

export const chatRouter = Router();

chatRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { question, history } = bodySchema.parse(req.body);
    res.json(await answerQuestion(question, history));
  }),
);
