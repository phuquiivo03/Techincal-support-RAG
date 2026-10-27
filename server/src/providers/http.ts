/**
 * Shared fetch-with-retry core for the upstream providers (Groq, Gemini).
 * Extracted so timeout / backoff / retry-after semantics are unit-testable
 * without network or API keys (inject `fetchImpl`).
 *
 * Retry policy (preserves the behavior the providers had inline):
 * - transient statuses (429, 5xx by default) → retry, honoring `retryAfterMs`
 *   over the exponential backoff when the upstream supplies it
 * - network errors and timeouts (AbortSignal.timeout) → retry with backoff
 * - any other status → returned to the caller ONCE (no retry)
 */

import { log } from "../lib/logger.js";

export interface RetryFetchOptions {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  retries: number;
  /** wait before retry `attempt` (0-based) — typically 500–800 * 2^attempt */
  backoffMs: (attempt: number) => number;
  /** override backoff when the upstream says so (e.g. Groq 429 retry-after) */
  retryAfterMs?: (res: Response) => number | null;
  /** injectable for tests — defaults to global fetch */
  fetchImpl?: typeof fetch;
  /** error label, e.g. "Groq chat" → "Groq chat failed after 5 attempts: …" */
  label?: string;
}

export async function fetchWithRetry(options: RetryFetchOptions): Promise<Response> {
  const doFetch = options.fetchImpl ?? fetch;
  let lastErr: unknown;
  for (let attempt = 0; attempt < options.retries; attempt++) {
    try {
      const res = await doFetch(options.url, {
        method: options.method ?? "POST",
        headers: options.headers,
        body: JSON.stringify(options.body),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`upstream responded ${res.status}`);
        const override = options.retryAfterMs?.(res) ?? null;
        const waitMs = override !== null ? override : options.backoffMs(attempt);
        // silent retries made upstream trouble invisible (e.g. 8-min eval items) — log them
        log.warn(`${options.label ?? "upstream"} ${res.status} on attempt ${attempt + 1}/${options.retries} — retrying in ${Math.round(waitMs / 1000)}s`);
        await sleep(waitMs);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      log.warn(
        `${options.label ?? "upstream"} attempt ${attempt + 1}/${options.retries} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await sleep(options.backoffMs(attempt));
    }
  }
  throw new Error(`${options.label ?? "upstream"} fetch failed after ${options.retries} attempts: ${String(lastErr)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
