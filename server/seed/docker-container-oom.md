# Docker container OOM-killed Node.js process

## Incident summary

A Node.js container restarts with exit code 137 (128 + 9 = SIGKILL) every few days. Kubernetes reports `Reason: OOMKilled`; `docker inspect` shows `OOMKilled: true`. The app logs show nothing unusual before death — the kernel killed it, not Node.

```bash
docker inspect --format '{{.State.OOMKilled}} {{.State.ExitCode}}' myapp
# true 137
```

## Root cause

The kernel's cgroup memory limit for the container is lower than what the Node.js heap wants to use. Node sizes its **old-space heap** from the *host's* total memory by default (up to ~4 GB on 64-bit), not the container limit. Sequence of events:

1. Container memory limit: e.g. 512 MB (cgroup `memory.max`).
2. Traffic spike → V8 old space grows past `limit − (heap overhead + buffers + native memory)`.
3. V8 hasn't hit *its* GC trigger yet, so it keeps allocating instead of collecting.
4. The cgroup ceiling arrives first → kernel OOM killer sends SIGKILL (no stack trace, no graceful shutdown).

Extra native memory (Buffers, thread stacks for worker_threads) makes the collision happen even earlier.

## Diagnosis

Compare what the container allows vs what Node believes:

```bash
docker stats --no-stream myapp            # MEM USAGE / LIMIT
cat /sys/fs/cgroup/memory.max 2>/dev/null # container limit (cgroup v2)
node -e 'console.log(v8.getHeapStatistics().heap_size_limit / 1024**3, "GB heap limit")'
```

If the heap limit (from Node) is larger than the container limit, this incident is armed. Inside the app, watch `process.memoryUsage()` — when `heapUsed` climbs toward the container limit minutes before a restart, it confirms heap growth, not a leak in native code.

## Fix

1. **Cap the V8 heap explicitly below the container limit**, leaving room for non-heap memory (a common rule: heap ≈ 60–75% of the container limit):

   ```dockerfile
   FROM node:22-slim
   ENV NODE_OPTIONS=--max-old-space-size=384
   # container limit: 512m
   ```

   Or set it in the run command: `docker run -m 512m -e NODE_OPTIONS=--max-old-space-size=384 myapp`.
2. **Give the container headroom.** `-m 512m` with an app that genuinely needs 700 MB just changes the crash cadence — size the limit from measured usage at peak (plus ~30%).
3. **Catch heap-growth regressions in code**: stream large files instead of buffering, avoid `Buffer.concat` on unbounded inputs, cap pagination, and set request body limits.
4. **Make restarts graceful and visible**: a liveness probe plus `restart: unless-stopped` (or Kubernetes deployment) keeps service up while you fix sizing; alert on OOMKilled events so it isn't silently absorbed.
5. **Verify the flag is active** after deploy:

   ```bash
   docker exec myapp node -e 'console.log(v8.getHeapStatistics().heap_size_limit/1024**2 + " MB")'
   # should print ~384 MB, not GBs
   ```

## Verification

Exit 137 disappears from `docker events`; `heap_size_limit` inside the container matches the configured cap; `docker stats` shows memory plateauing below the limit with GC cycles instead of a monotonic climb.
