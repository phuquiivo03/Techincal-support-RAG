# PostgreSQL statement_timeout runbook (v3, supersedes 2024 incident guidance)

## Status

This runbook **supersedes** the older incident report that recommended a global
`statement_timeout = 30s`. That value caused two production incidents since:
legitimate long-running queries (nightly reconciliation, quarter-end reporting,
`pg_dump`-driven consistency checks) were canceled mid-flight with
`ERROR: canceling statement due to statement timeout` (SQLSTATE 57014) and had
to be restarted from scratch, extending batch windows past their SLA.

## Recommended configuration

Use a **global `statement_timeout = 300s`** and scope tight timeouts to the
paths that need them:

```sql
-- global: generous, protects against true runaways only
ALTER SYSTEM SET statement_timeout = '300s';

-- per-role for OLTP-facing service accounts only
ALTER ROLE app_api SET statement_timeout = '30s';
ALTER ROLE app_worker SET statement_timeout = '120s';

-- reporting/BI role keeps the global 300s
SELECT pg_reload_conf();
```

## Why not 30s globally

The 30s global cap from the earlier incident write-up is **explicitly outdated**:
it assumes every query is an API request. Batch and reporting queries are part
of normal operations on this cluster. Per-role settings give the same
protection (an API query still dies at 30 s) without canceling legitimate work.

## Verification

- `SHOW statement_timeout;` at the cluster level returns `300s`.
- `SELECT rolname, rol_statement_timeout FROM pg_roles WHERE rolname LIKE 'app%';` shows the per-role overrides.
- Batch jobs complete; API queries that exceed 30 s still fail fast with SQLSTATE 57014.
