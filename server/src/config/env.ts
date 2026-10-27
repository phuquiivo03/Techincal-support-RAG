import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required — set it in server/.env (Supabase session pooler URI)"),

  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required — get one at https://aistudio.google.com/apikey"),
  GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY is required — get one at https://console.groq.com/keys"),

  EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(768),
  LLM_MODEL: z.string().default("openai/gpt-oss-120b"),

  DEFAULT_TOP_K: z.coerce.number().int().min(1).max(10).default(5),
  // 0.55, not 0.50: the eval suite's harder off-topic probes score up to 0.512
  // (K8s RBAC 0.506, salary 0.512) while the weakest on-topic item scores 0.745
  // — see docs/EVAL_FAILURE_ANALYSIS.md and eval/RESULTS.md threshold sweep.
  SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.55),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  console.error(`Invalid or missing environment variables:\n${issues}\n\nCopy server/.env.example to server/.env and fill it in.`);
  process.exit(1);
}

export const env = parsed.data;
