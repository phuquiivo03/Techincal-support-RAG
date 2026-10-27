# Enabling the PostgreSQL slow query log

## What this covers

How to turn on and shape PostgreSQL's native slow query logging: logging
collector settings, the `log_min_duration_statement` threshold, and how to read
the resulting log lines. It does **not** cover `pg_stat_statements` setup or how
to interpret its aggregates — that is a separate tool with its own runbook.

## Enabling the logging collector

Slow-query output goes through the logging collector, which must be on (it is on
by default in most managed providers):

```sql
SHOW logging_collector; -- must be 'on'
ALTER SYSTEM SET logging_collector = on; -- self-managed only; needs a restart
```

## Setting the duration threshold

`log_min_duration_statement` logs every statement that runs at least this long.
`0` logs every statement; `-1` disables duration logging:

```sql
ALTER SYSTEM SET log_min_duration_statement = '500ms';
SELECT pg_reload_conf();
```

Useful related settings:

```sql
ALTER SYSTEM SET log_line_prefix = '%m [%p] %u@%d ';
ALTER SYSTEM SET log_statement = 'none'; -- avoid double-logging everything
```

## Reading the output

Statements that exceed the threshold appear in the server log as:

```log
2026-10-24 09:14:02.118 UTC [4821] app@billing LOG:  duration: 1830.524 ms
  statement: SELECT l.id, l.amount FROM ledger_entries l WHERE l.tenant_id = $1
```

- `duration:` is total statement time including planning.
- `[4821]` is the backend PID — cross-reference with `pg_stat_activity` to find
  the session that issued it.
- To find *which* queries are slow over time, grep the log by `statement:` and
  aggregate, or export the log to your log pipeline.

## Caveats

- The slow log samples reality, it does not count: a 490 ms query run 10,000
  times a day never appears at a 500 ms threshold. For aggregate frequency and
  total-time rankings you need `pg_stat_statements`, which is out of scope here.
- Logging every statement (`0`) at high QPS produces gigabytes per day — start
  at 500 ms and tighten only after reviewing volume.
