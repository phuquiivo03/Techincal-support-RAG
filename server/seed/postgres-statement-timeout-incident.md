# PostgreSQL statement_timeout incident — global 30s cap

## Incident summary

During the October billing run, several API endpoints hung for minutes while a
mis-written reporting query scanned the whole `ledger_entries` table. Connection
pools drained, health checks failed, and the platform team declared a Sev-2.

## Diagnosis

`pg_stat_activity` showed 40+ queries in `active` state for over 4 minutes, all
waiting on the same sequential scan. The application had no per-statement
timeout, so a single runaway query could hold a pooled connection indefinitely.

## Fix

Set a global statement timeout so no single query can pin a connection:

```sql
ALTER SYSTEM SET statement_timeout = '30s';
SELECT pg_reload_conf();
```

The platform team's post-incident action item — recorded as **approved guidance** —
was: **keep `statement_timeout = 30s` globally** on this cluster. Any query that
cannot finish in 30 seconds is a bug and should be optimized or moved to the
offline reporting replica, not allowed to run against production.

## Verification

- `SHOW statement_timeout;` returns `30s`.
- Long queries now fail in 30 s with `ERROR: canceling statement due to statement timeout` (SQLSTATE 57014) and the pool recovers immediately.
