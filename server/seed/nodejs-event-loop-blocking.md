# Node.js event loop blocking

## Incident summary

A Node.js API suddenly becomes unresponsive: health checks time out, latency spikes from ~20 ms to tens of seconds, yet CPU on one core sits at 100% while other cores are idle. No errors are logged because the process is too busy to flush them.

## Symptoms

- p99 latency spikes while p50 stays normal or degrades later.
- One CPU core pinned at 100%, other cores idle (single-threaded event loop).
- Liveness probes (`/health`) start timing out, orchestrator restarts the pod.
- Logs arrive in bursts after seconds of silence, or not at all.
- GC pauses may compound the problem: `process.memoryUsage()` shows growing `heapUsed`.

## Diagnosis

Measure event loop lag:

```js
// el.js — event loop lag probe
const NS_PER_MS = 1e6;
let last = process.hrtime.bigint();
setInterval(() => {
  const now = process.hrtime.bigint();
  const lagMs = Number(now - last) / NS_PER_MS - 1000; // interval is 1000 ms
  console.log(`event loop lag: ${Math.max(0, lagMs).toFixed(1)} ms`);
  last = now;
}, 1000);
```

Sustained lag above ~100 ms means something is monopolizing the loop. Profile with `node --prof app.js` then `node --prof-process isolate-*.log`, or run under the inspector (`node --inspect`) and capture a CPU profile. Typical culprits found in profiles:

- `JSON.parse`/`JSON.stringify` on multi-MB payloads (e.g. unpaginated API responses).
- Synchronous crypto (`crypto.pbkdf2Sync`), `zlib.inflateSync`, or large `Buffer.toString("base64")`.
- Big in-process sorts/reduces over database result sets.
- A regex with catastrophic backtracking running on user input.

## Fix

1. **Move CPU-bound work off the event loop.**
   - `worker_threads` for pure computation (parsing, hashing, image work):

   ```js
   const { Worker } = require("node:worker_threads');
   // in request handler:
   const worker = new Worker('./heavy-task.js', { workerData: payload });
   ```

   - Replace sync calls with async equivalents: `crypto.pbkdf2` instead of `pbkdf2Sync`, `zlib.gunzip` instead of `gunzipSync`.
2. **Bound the work.** Paginate queries, cap payload size (`express.json({ limit: '1mb' })`), stream large responses instead of buffering.
3. **Yield in long loops** so I/O can drain between iterations:

   ```js
   const setImmediate = require('node:timers').setImmediate;
   for (const item of hugeList) {
     processItem(item);
     if (++i % 1000 === 0) await new Promise(r => setImmediate(r));
   }
   ```

4. **Alert on event loop lag** (the probe above exported as a Prometheus gauge `nodejs_eventloop_lag`) with a warning at 100 ms and a critical alert at 1 s, so the next regression is caught before the health checks fail.

## Verification

After deploying the fix, event loop lag should stay under ~50 ms at peak traffic, p99 latency returns to baseline, and CPU spreads across cores when worker threads are used.
