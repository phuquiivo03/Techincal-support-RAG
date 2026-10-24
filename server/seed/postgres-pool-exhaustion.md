# PostgreSQL connection pool exhaustion

## Incident summary

The application starts failing with `ERROR: too many clients already (SQLSTATE 53300)` or every request hangs for exactly the pool acquisition timeout. This happens when the app's connection pool is exhausted — every connection is checked out and held, so new queries queue forever.

Related messages:

```
Error: timeout exceeded when trying to connect
Error: remaining connection slots are reserved for non-replication superuser connections
```

## Root cause

- Pool size larger than the server can serve (Supabase/managed Postgres caps total connections; small instances allow ~20–100).
- Connection leaks: a code path takes a client from the pool and never releases it (missing `finally { client.release() }`, or a transaction aborted before rollback).
- Forked processes each open their own pool (e.g. PM2 cluster mode with 8 workers × pool of 20 = 160 connections).
- Idle connections held during long-lived requests (streaming responses, slow clients).

## Diagnosis

On the server:

```sql
-- total connections and where they come from
SELECT count(*), state, application_name
FROM pg_stat_activity
GROUP BY 2, 3
ORDER BY 1 DESC;

-- longest-lived connections
SELECT pid, state, now() - state_change AS idle_for, query
FROM pg_stat_activity
WHERE state = 'idle'
ORDER BY idle_for DESC
LIMIT 20;
```

Hundreds of `idle` connections from one app name means the pool (or several pools) is oversized or leaking. Compare `count(*)` against the server's `max_connections` and the provider's connection cap.

## Fix

1. **Size pools realistically.** For a small managed instance: pool `max` of 5–10 per process is usually plenty (Postgres handles few concurrent active queries well — they're fast). Total across all processes must stay under the provider cap, leaving headroom for migrations and admin sessions.
2. **Always release clients** — use a helper that guarantees release:

   ```js
   const client = await pool.connect();
   try {
     await client.query('BEGIN');
     // ... queries
     await client.query('COMMIT');
   } catch (err) {
     await client.query('ROLLBACK').catch(() => {});
     throw err;
   } finally {
     client.release();
   }
   ```

3. **Add pool acquire timeouts and metrics** so exhaustion is visible before it becomes an outage:

   ```js
   new pg.Pool({ connectionString, max: 8, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
   ```

   Emit `pool.totalCount`, `pool.idleCount`, `pool.waitingCount` as metrics.
4. **Use a transaction-mode pooler for serverless/many processes.** Route high-fan-out, short queries through the provider's transaction pooler (e.g. Supabase Supavisor port 6543, PgBouncer) so many app processes share few server connections. Keep session-level features (LISTEN/NOTIFY, prepared statements across queries, advisory locks) on the direct/session connection.
5. **Fix leaks found by diagnosis**: any query in `pg_stat_activity` stuck `idle in transaction` for minutes points at the missing rollback path.

## Verification

`pg_stat_activity` count from the app stays ≤ pool size × processes, `waitingCount` returns to 0 after traffic bursts, and the 53300 / acquire-timeout errors disappear.
