# PostgreSQL deadlocks on concurrent updates

## Incident summary

Under concurrent traffic, PostgreSQL reports `ERROR: deadlock detected (SQLSTATE 40P01)` and some transactions roll back. Users see intermittent 500s on write endpoints while most requests succeed.

Example from the log:

```
ERROR:  deadlock detected
DETAIL:  Process 12345 waits for ShareLock on transaction 98765, blocked by process 12346.
         Process 12346 waits for ShareLock on transaction 87654, blocked by process 12345.
HINT:  See server log for query details.
```

## Root cause

Two transactions take row locks on the same set of rows in **different orders**. Transaction A locks row 1 then wants row 2; transaction B locks row 2 then wants row 1. Neither can proceed, so Postgres detects the cycle after `deadlock_timeout` (default 1 s) and kills one transaction.

Typical triggers:

- Batch updates that iterate rows in arbitrary order (`UPDATE ... WHERE id = ANY($1)` with different array orders).
- An `UPDATE` that cascades into triggers touching another table, combined with updates on that other table.
- ORM code that saves related entities in whatever order the object graph happens to be in.

## Diagnosis

Enable lock dependency logging:

```sql
ALTER SYSTEM SET log_lock_waits = on;
SELECT pg_reload_conf();
```

Then inspect `pg_stat_activity` during an incident:

```sql
SELECT pid, state, wait_event_type, wait_event, query, query_start
FROM pg_stat_activity
WHERE wait_event_type = 'Lock';
```

The deadlock victim and blocker appear in the server log with both queries — compare the row order each one touches.

## Fix

1. **Impose a global lock order.** Always update rows in a consistent order, e.g. sort ids before touching them:

   ```js
   await tx('UPDATE accounts SET balance = balance - $1 WHERE id = ANY($2)', [amount, ids.sort()]);
   ```

2. **Keep transactions short.** Never do network calls or heavy computation inside a transaction; open it as late as possible and commit as early as possible.
3. **Acquire locks explicitly when ordering cannot be fixed.** `SELECT ... FOR UPDATE` the rows in sorted order first, then update:

   ```sql
   BEGIN;
   SELECT id FROM accounts WHERE id = ANY($1) ORDER BY id FOR UPDATE;
   -- now safe: every session follows the same order
   UPDATE accounts SET balance = balance - $2 WHERE id = ANY($1);
   COMMIT;
   ```

4. **Retry on 40P01 in application code** — deadlocks can always happen transiently even after ordering fixes. Retry the whole transaction up to 3 times with jittered backoff; surface an error only if all attempts fail.
5. Optionally raise `deadlock_timeout` if logs are noisy, but treat it as a symptom meter, not a cure — the cure is lock ordering.

## Verification

`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database();` should stop climbing after deploy, and the 40P01 error rate should drop to zero or near-zero with retry absorbing rare stragglers.
