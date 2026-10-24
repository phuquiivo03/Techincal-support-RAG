# Nginx 502 Bad Gateway from upstream timeouts

## Incident summary

Nginx returns `502 Bad Gateway` (sometimes `504 Gateway Time-out`) intermittently for an upstream Node.js/Express app. The error page appears within ~60 s; other requests in the same window succeed. The upstream process is running — it is just too slow to answer Nginx in time, or it drops the connection mid-response.

Nginx error log signatures:

```
upstream timed out (110: Connection timed out) while reading response header from upstream
connect() failed (111: Connection refused) while connecting to upstream
upstream prematurely closed connection
```

## Root cause

- `proxy_read_timeout` (default **60 s**) expires before the upstream answers a slow endpoint — Nginx returns 504; if the client already went away or the response line never arrives, it can surface as 502.
- Upstream queue overflow: Nginx passes a burst of connections to an app whose event loop is blocked or whose pool is exhausted, sockets get reset mid-handshake → 502.
- Keepalive mismatch: upstream closes idle keepalive connections sooner than Nginx reuses them (`upstream prematurely closed connection`), especially behind a pooler or an app restart.

## Diagnosis

Map the error class to the failing stage:

| Nginx log line | Stage | Meaning |
|---|---|---|
| `connect() failed (111: Connection refused)` | TCP connect | Upstream not listening / crashed / wrong port |
| `upstream timed out ... reading response header` | App processing | Endpoint slower than `proxy_read_timeout` |
| `upstream prematurely closed connection` | Mid-response | App crashed or closed keepalive early |

Correlate timestamps with upstream logs — a 50 s endpoint in the app paired with the 60 s timeout line confirms the slow-endpoint case.

## Fix

```nginx
upstream app {
    server app:3000;
    keepalive 32;
}

server {
    location / {
        proxy_pass http://app;

        # HTTP/1.1 + empty Connection header = keepalive to upstream works
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        # timeouts tuned to the slowest legitimate endpoint (not to hide slowness)
        proxy_connect_timeout 5s;
        proxy_send_timeout    30s;
        proxy_read_timeout    70s;   # must exceed the app's worst-case p99

        # retry idempotent requests on a dead upstream connection
        proxy_next_upstream error timeout http_502;
        proxy_next_upstream_tries 2;
    }
}
```

1. **Set `proxy_read_timeout` above the app's true worst-case p99** — and fix the slow endpoint (see the event-loop and pool-exhaustion incidents; they are usually why the upstream is slow).
2. **Enable upstream keepalive** with `proxy_http_version 1.1` and `proxy_set_header Connection ""` to stop `prematurely closed connection` churn.
3. **Surface upstream errors to the app**: make sure the app logs slow requests (`res.on('finish')` with duration) so 502 storms leave a trail.
4. **Protect the upstream** with rate limiting or buffering (`proxy_buffering on` is default) so slow clients don't pin app sockets.
5. **For SSE/WebSocket routes**, disable buffering and raise the read timeout specifically for those `location`s (see the WebSocket incident doc).

## Verification

502/504 rate drops to zero in `nginx` access logs, `upstream prematurely closed` disappears from error logs, and the slow endpoint's p99 shows up in app metrics instead of as gateway errors.
