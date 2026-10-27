import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import type { HealthResponse } from "@rag/shared";
import { env } from "./config/env.js";
import { migrate } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { errorMiddleware } from "./lib/errors.js";
import { log } from "./lib/logger.js";
import { chatRouter } from "./modules/chat/routes.js";
import { documentsRouter } from "./modules/documents/routes.js";
import { evaluationRouter } from "./modules/evaluation/routes.js";
import { retrievalRouter } from "./modules/retrieval/routes.js";
import { checkEmbeddings } from "./providers/embeddings.js";
import { checkLlm } from "./providers/llm.js";

const app = express();

app.disable("x-powered-by");
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

const generalLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please slow down" },
});

const aiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many AI requests — please wait a moment" },
});

app.get("/api/health", async (_req, res) => {
  const [dbRes, embeddings, llm] = await Promise.all([
    pool.query("SELECT (SELECT count(*) FROM documents) AS documents, (SELECT count(*) FROM chunks) AS chunks"),
    checkEmbeddings(),
    checkLlm(),
  ]);
  const body: HealthResponse = {
    status: dbRes.rowCount !== null && embeddings && llm ? "ok" : "degraded",
    db: dbRes.rowCount !== null,
    embeddings,
    llm,
    documents: Number(dbRes.rows[0].documents),
    chunks: Number(dbRes.rows[0].chunks),
    time: new Date().toISOString(),
  };
  res.status(body.status === "ok" ? 200 : 503).json(body);
});

app.use("/api", generalLimiter);
app.use("/api/chat", aiLimiter, chatRouter);
app.use("/api/retrieve", aiLimiter, retrievalRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/eval", evaluationRouter); // POST /runs applies its own strict limiter

app.use(errorMiddleware);

async function main(): Promise<void> {
  await migrate(pool);
  const server = app.listen(env.PORT, () => {
    log.info(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
    log.info(
      `config: embedding=${env.EMBEDDING_MODEL}(${env.EMBEDDING_DIM}d) llm=${env.LLM_MODEL} topK=${env.DEFAULT_TOP_K} threshold=${env.SIMILARITY_THRESHOLD}`,
    );
  });

  const shutdown = async (signal: string) => {
    log.info(`${signal} received — shutting down`);
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("fatal startup error", err);
  process.exit(1);
});
