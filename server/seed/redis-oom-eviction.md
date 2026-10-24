# Redis out-of-memory, eviction and cache stampede

## Incident summary

Two related incidents share one root: the Redis instance hitting `maxmemory`.

**1. Eviction storm / data loss.** Keys start evaporating, sessions randomly log users out, and `INFO` shows `evicted_keys` climbing fast.

```
redis-cli INFO memory | grep maxmemory
# maxmemory_human:512.00M
# used_memory_human:511.87M
redis-cli INFO stats | grep evicted
# evicted_keys:184403
```

**2. OOM command rejection.** With `maxmemory-policy allkeys-lru` unset and `noeviction` set, writes fail outright:

```
ERROR: OOM command not allowed when used memory > 'maxmemory' (EOF)
```

## Root cause

- Unbounded key growth: sessions, rate-limit counters, or cached entities written with TTLs that are too long (or no TTL at all).
- Large values caching whole API responses, each hundreds of KB.
- **Cache stampede after eviction or expiry**: hundreds of concurrent requests miss the same hot key, all hit the slow origin (Postgres) at once, and none of them repopulate the cache before the next wave arrives — origin CPU saturates, latency multiplies.

## Diagnosis

```bash
redis-cli INFO memory          # used_memory vs maxmemory
redis-cli INFO stats           # evicted_keys, keyspace hits/misses
redis-cli --bigkeys            # biggest keys by type
redis-cli --memkeys            # keys consuming most memory (Redis 6.6+/7)
redis-cli keyspace_misses      # rising fast ⇒ stampede or mass expiry
```

Correlate `evicted_keys` rate and keyspace miss ratio with origin latency graphs — a synchronized spike is the stampede signature.

## Fix

1. **Set an explicit policy and a sane budget.** For a pure cache, `maxmemory-policy allkeys-lru` (or `volatile-lru` if some keys must survive):

   ```
   CONFIG SET maxmemory 512mb
   CONFIG SET maxmemory-policy allkeys-lru
   ```

   Size `maxmemory` at ~70–80% of the instance's RAM to leave headroom for fragmentation and replication buffers.
2. **Every cache key gets a TTL.** No exceptions for a cache tier — `SET key value EX 300`. Sweep existing keys with `redis-cli --scan --pattern 'cache:*' | xargs -L100 redis-cli TTL` to find TTL -1 offenders.
3. **Shrink values.** Store projections, not whole responses; compress payloads over ~10 KB (`gzip` before SET); consider hash sharding for giant hashes.
4. **Prevent stampedes.** Short lock so one request rebuilds a hot key while others wait briefly:

   ```js
   const NX = await redis.set(`lock:${key}`, '1', 'EX', 5, 'NX');
   if (NX) {
     const fresh = await expensiveOriginQuery();
     await redis.set(key, JSON.stringify(fresh), 'EX', 300);
   } else {
     await sleep(50); // retry read; a few late misses are fine
   }
   ```

   Combine with slightly randomized TTLs (`EX 300 + rand(0..30)`) so cohorts don't expire together, and optional stale-while-revalidate (serve stale value, rebuild in background).
5. **Alert early**: `used_memory / maxmemory > 80%`, `evicted_keys` rate > 0, keyspace miss ratio jump — all three catch this incident before users do.

## Verification

`used_memory` plateaus below the budget, `evicted_keys` stops climbing, miss ratio returns to baseline, and origin latency no longer spikes after cache expiry waves.
