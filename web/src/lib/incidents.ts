export interface IncidentPreset {
  /** timestamp shown on the card, like an incident channel */
  time: string;
  label: string;
  /** question sent to the assistant */
  query: string;
}

export const INCIDENT_PRESETS: IncidentPreset[] = [
  {
    time: "02:14",
    label: "API latency spiked from 20 ms to 30 s, one core pegged",
    query:
      "Our Node.js API suddenly hangs, health checks time out and one CPU core is at 100% while the others are idle. How do I diagnose and fix it?",
  },
  {
    time: "09:41",
    label: "Postgres deadlock detected on the checkout flow",
    query:
      "Postgres logs show 'deadlock detected' errors and some write requests fail with 500. What causes this and how do I fix it?",
  },
  {
    time: "11:03",
    label: "too many clients already — pool exhausted",
    query:
      "We keep getting 'too many clients already' errors from PostgreSQL. How do I find out who is holding the connections?",
  },
  {
    time: "13:27",
    label: "Redis OOM: evicted_keys climbing fast",
    query:
      "Redis writes fail with 'OOM command not allowed when used memory > maxmemory' and sessions randomly log users out. What should I configure?",
  },
  {
    time: "15:52",
    label: "Container OOMKilled, exit code 137",
    query:
      "Our Docker container gets OOMKilled with exit code 137 even though the Node process looks fine. What's going on?",
  },
  {
    time: "17:09",
    label: "Nginx 502 Bad Gateway every rush hour",
    query:
      "Nginx intermittently returns 502 Bad Gateway with 'upstream timed out while reading response header' in the logs. How do I fix it?",
  },
  {
    time: "18:45",
    label: "WebSockets reconnect every 60 seconds",
    query:
      "WebSocket clients reconnect every 60 seconds behind Nginx. The upgrade returns 101 but connections keep dropping. What should I do?",
  },
  {
    time: "21:33",
    label: "Cache stampede hammering the database",
    query:
      "After a hot cache key expires, hundreds of requests hit Postgres at once and latency spikes. How do I prevent this cache stampede?",
  },
];
