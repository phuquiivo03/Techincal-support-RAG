import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchWithRetry } from "./http.js";

/**
 * Upstream-resilience regression tests (2026-10-25). The provider retry core
 * was extracted from llm.ts / embeddings.ts so timeout, 429 retry-after,
 * 5xx backoff and fail-fast semantics are locked by tests WITHOUT network,
 * env vars or API keys — fetch is injected.
 *
 * Waits are real but tiny (1–5 ms backoffs, 10–30 ms timeouts): these tests
 * verify ORDER and COUNT of attempts, not production wait durations.
 */

function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response("{}", { status, headers });
}

function opts(overrides: Partial<Parameters<typeof fetchWithRetry>[0]> = {}) {
  return {
    url: "https://upstream.test/api",
    headers: {},
    body: {},
    timeoutMs: 250,
    retries: 3,
    backoffMs: () => 1,
    fetchImpl: undefined,
    ...overrides,
  };
}

describe("fetchWithRetry", () => {
  it("returns the response on the first attempt when the upstream is healthy", async () => {
    const calls: number[] = [];
    const out = await fetchWithRetry(
      opts({
        fetchImpl: (async (_url: unknown, init?: RequestInit) => {
          calls.push((init?.signal as AbortSignal).aborted ? -1 : 1);
          return res(200);
        }) as typeof fetch,
      }),
    );
    assert.equal(out.status, 200);
    assert.deepEqual(calls, [1]);
  });

  it("retries 429s and honors retry-after over the exponential backoff", async () => {
    const waited: number[] = [];
    const statuses = [429, 429, 200];
    let call = 0;
    const out = await fetchWithRetry(
      opts({
        backoffMs: (attempt) => {
          waited.push(attempt);
          return 1;
        },
        retryAfterMs: (r) => (r.status === 429 ? 2 : null),
        fetchImpl: (async () => res(statuses[call++])) as typeof fetch,
      }),
    );
    assert.equal(out.status, 200);
    assert.equal(call, 3); // two 429s then success
    assert.deepEqual(waited, [0, 1]); // backoff consulted per retry (override took precedence)
  });

  it("retries 5xx with exponential backoff and succeeds on a transient blip", async () => {
    const statuses = [503, 500, 200];
    let call = 0;
    const out = await fetchWithRetry(
      opts({
        backoffMs: () => 1,
        fetchImpl: (async () => res(statuses[call++])) as typeof fetch,
      }),
    );
    assert.equal(out.status, 200);
    assert.equal(call, 3);
  });

  it("times out on a hung upstream, retries, and reports the timeout as the final error", async () => {
    let call = 0;
    await assert.rejects(
      fetchWithRetry(
        opts({
          timeoutMs: 20,
          retries: 2,
          backoffMs: () => 1,
          fetchImpl: (async () => {
            call += 1;
            await new Promise((r) => setTimeout(r, 500)); // longer than the timeout
            return res(200);
          }) as typeof fetch,
        }),
      ),
      /upstream fetch failed after 2 attempts: .*[Tt]imeout/,
    );
    assert.equal(call, 2, "a timed-out request must be retried, not fail fast");
  });

  it("fails fast on non-retryable statuses (4xx other than 429) without consuming retries", async () => {
    let call = 0;
    const out = await fetchWithRetry(
      opts({
        fetchImpl: (async () => {
          call += 1;
          return res(401);
        }) as typeof fetch,
      }),
    );
    assert.equal(out.status, 401);
    assert.equal(call, 1, "401 is the caller's business (fatal), not retryable");
  });

  it("gives up after `retries` transient failures and names the last status", async () => {
    let call = 0;
    await assert.rejects(
      fetchWithRetry(
        opts({
          retries: 3,
          backoffMs: () => 1,
          fetchImpl: (async () => {
            call += 1;
            return res(502);
          }) as typeof fetch,
        }),
      ),
      /failed after 3 attempts: upstream responded 502/,
    );
    assert.equal(call, 3);
  });

  it("uses the provider label in the final error message", async () => {
    await assert.rejects(
      fetchWithRetry(
        opts({
          retries: 2,
          backoffMs: () => 1,
          label: "Groq chat",
          fetchImpl: (async () => res(500)) as typeof fetch,
        }),
      ),
      /Groq chat failed after 2 attempts/,
    );
  });

  it("sends the body as JSON with the given headers and a POST by default", async () => {
    let seen: { body?: string; method?: string; headers?: Record<string, string> } | null = null;
    await fetchWithRetry(
      opts({
        headers: { authorization: "Bearer x" },
        body: { model: "m" },
        fetchImpl: (async (_url: unknown, init?: RequestInit) => {
          seen = { body: String(init?.body), method: init?.method, headers: init?.headers as Record<string, string> };
          return res(200);
        }) as typeof fetch,
      }),
    );
    assert.equal(seen!.method, "POST");
    assert.equal(seen!.body, '{"model":"m"}');
    assert.deepEqual(Object.keys(seen!.headers as Record<string, string>), ["authorization"]);
  });
});
