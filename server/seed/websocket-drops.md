# WebSocket connections dropping behind a proxy

## Incident summary

WebSocket clients reconnect every 30–120 seconds in a loop. The app sees normal `connection`/`close` churn; Nginx access logs show the upgrade succeeded (HTTP 101). Nothing crashed — connections are silently reaped between messages.

Browser symptom:

```
WebSocket connection to 'wss://app.example.com/socket' failed: 
WebSocket is closed before the connection is established.
```

## Root cause

Idle WebSocket connections are killed by a timeout in the chain — most often the proxy's `proxy_read_timeout` (default 60 s), sometimes a corporate/load-balancer idle timeout (ALB default 60 s, some clouds 350 s). WebSockets have no built-in keepalive: if neither side sends a frame for longer than the smallest timeout on the path, something cuts the TCP stream. A second common cause is the upgrade handshake missing required headers, which fails fast instead of dropping later.

## Diagnosis

- Measure time-between-connect and close in app logs: a suspiciously constant interval (~60 s) = a timeout, not a crash.
- `proxy_read_timeout` in nginx (default 60 s) is the usual reaper for quiet sockets.
- Check handshake config if connections die instantly: the proxy must pass `Upgrade` and `Connection` headers, or the 101 never completes.

## Fix

**1. Heartbeat (the real fix — keep frames flowing below every timeout):**

Client and server ping/pong every 25–30 s. Browsers can't send pings, so the *server* sends pings; browsers answer with pong frames automatically:

```js
// server (ws)
const interval = setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) { client.terminate(); continue; }
    client.isAlive = false;
    client.ping();
  }
}, 30_000);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});
```

On the Node client side (`ws` package), respond to server pings (automatic) and optionally send app-level heartbeats; on reconnect use exponential backoff with jitter (e.g. 1 s → 2 s → 4 s … cap 30 s) to avoid thundering reconnect herds after a deploy.

**2. Nginx location for WebSockets:**

```nginx
location /socket {
    proxy_pass http://app;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    proxy_read_timeout 300s;   # above heartbeat interval ×2; heartbeats keep it from ever firing
    proxy_send_timeout 300s;
}
```

`proxy_buffering off` for this location avoids delayed frames to slow clients.

**3. State recovery after reconnect.** A reconnecting client must resubscribe and re-sync missed events: version the last-seen event id (`?since=<id>`) and replay or snapshot on connect — otherwise users see silently stale dashboards even after the reconnect loop is fixed.

**4. Scaling note.** With multiple app instances behind the proxy, publish events to Redis pub/sub (or similar) and fan out per instance — otherwise events emitted on instance A never reach sockets pinned to instance B.

## Verification

Connection lifetime in logs stretches to hours instead of minutes, pongs appear in `wss.clients` telemetry every 30 s, and after killing an instance, clients reconnect within one backoff step and resync state via the `since` cursor.
