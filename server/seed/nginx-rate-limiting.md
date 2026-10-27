# Nginx request rate limiting for public endpoints

## Overview

`ngx_http_limit_req_module` applies per-client token-bucket rate limiting at the
edge. It is the first line of defense against credential stuffing, scraper
farms, and accidental retry storms before traffic ever reaches the application.
This page collects the configuration patterns we run in production, from basic
single-zone setups to per-endpoint classes with monitoring.

## How the token bucket works

Each request removes a token from the client's bucket; tokens refill at the
configured `rate`. A request arriving on an empty bucket is rejected (or
delayed, see burst below). Because the refill is continuous, `rate=10r/s` does
not mean "10 requests in each wall-clock second" — a client that saved up
tokens can briefly exceed 10 r/s and still be served, which is usually the
desired behavior for humans clicking quickly.

Key facts that surprise people:

- The bucket key is arbitrary — usually `$binary_remote_addr` (4 bytes for
  IPv4), but it can be a header, a JWT claim mapped to a variable, or
  `$server_name` for a global cap.
- The zone is shared memory: every worker process enforces the same counters.
  There is no per-worker drift.
- Rate limiting happens at the `PREACCESS` phase — after `rewrite`, before the
  upstream is chosen.

## Zone sizing

`limit_req_zone` allocates a shared-memory zone holding one bucket state per
key. Size it for your active client count:

```nginx
# ~160 bytes per state; 10m ≈ 65k IPv4 clients (a bit fewer with IPv6 keys)
limit_req_zone $binary_remote_addr zone=perip:10m rate=10r/s;
```

If the zone fills, the least recently used states are evicted — an attacker
with many spoofed keys can evict legitimate buckets, so oversize the zone on
public endpoints. Monitor `Zone` usage via the stub_status endpoint (see
Monitoring below).

## Basic configuration

The minimal setup for a whole site:

```nginx
http {
  limit_req_zone $binary_remote_addr zone=perip:10m rate=10r/s;

  server {
    listen 443 ssl;
    server_name api.example.com;

    limit_req zone=perip;          # applies to every location
    limit_req_status 429;          # default is 503 — clients retry 503 harder
  }
}
```

## Why 429 beats the default 503

The module's default rejection status is 503. Well-behaved HTTP clients and
load balancers treat 503 as "the service is broken" and may retry aggressively
or circuit-break; 429 carries `Retry-After` semantics and tells clients the
limit is theirs. Always set `limit_req_status 429` unless a legacy client
requires otherwise.

## Advanced keying: per-tenant and authenticated limits

For multi-tenant APIs, rate limit by tenant, not IP — offices behind NAT share
one IPv4 address and would otherwise share one bucket:

```nginx
# map JWT sub claim (extracted by auth_request/js) to a key
map $jwt_sub $limit_key {
  default $binary_remote_addr;   # anonymous: fall back to IP
  ""      $binary_remote_addr;
  ~.+     "tenant:$jwt_sub";
}

limit_req_zone $limit_key zone=perclient:20m rate=20r/s;
```

## Allowing bursts: burst= and nodelay

This is the part most configurations get wrong. Without a burst allowance the
limit is strict: the second concurrent request from a browser that fetches a
page plus its assets at once can be rejected, because the bucket only refills
at `rate`. Real clients are bursty; the fix is to declare how much burst to
admit:

```nginx
location /login {
    limit_req zone=perip burst=20 nodelay;
    proxy_pass http://app_upstream;
}
```

- `burst=20` queues up to 20 excess requests in the bucket (they consume
  future tokens).
- Without `nodelay`, queued requests are DELAYED — each waits until a token
  refills, so a burst of 20 at `rate=10r/s` trickles through over ~2 s. Login
  POSTs do not care, but interactive endpoints feel sluggish.
- With `nodelay`, burst requests are served immediately (up to burst) and the
  bucket is left negative — the client then waits until tokens refill before
  the next request. For human-facing endpoints, `burst=20 nodelay` at 10 r/s
  is our default: instant first burst, throttled sustained rate.

Rule of thumb: `burst` ≈ the number of sub-resources a page load triggers
(10–30), `nodelay` on whenever latency matters more than smoothness.

## Per-endpoint limit classes

Expensive endpoints deserve tighter zones than static content:

```nginx
limit_req_zone $binary_remote_addr zone=login:10m   rate=1r/s;   # brute force
limit_req_zone $binary_remote_addr zone=search:10m  rate=5r/s;   # expensive
limit_req_zone $binary_remote_addr zone=general:10m rate=30r/s;  # default

server {
  location = /login   { limit_req zone=login  burst=5  nodelay; proxy_pass http://app; }
  location ^~ /search { limit_req zone=search burst=10 nodelay; proxy_pass http://app; }
  location /          { limit_req zone=general burst=30 nodelay; proxy_pass http://app; }
}
```

Only one `limit_req` applies per request (the most specific location wins);
declare several if you need additive limits.

## Logging rejections

Rejections log at `error` level with the zone name, client, and server:

```log
2026/10/24 09:14:02 [error] 4821#4821: *9317 limiting requests, excess: 20.432
  by zone "perip", client: 203.0.113.7, server: api.example.com,
  request: "POST /login HTTP/1.1", host: "api.example.com"
```

Add a `$limit_req_status` (empty on pass, rejection phase on block) column to
your access log format to measure the blocked share per endpoint:

```nginx
log_format lim '$remote_addr [$time_local] "$request" $status '
               'limit=$limit_req_status upstream=$upstream_response_time';
```

## Monitoring

- `stub_status` exposes `Zone` shared-memory usage for capacity planning.
- Alert on the rejected-request rate per zone (from the log format above); a
  sudden rise usually means a scraper or a broken retry loop, not more humans.
- Correlate 429 spikes with deploy markers: a new client version that retries
  on 429 without honoring `Retry-After` shows up here first.

## Tuning checklist

1. Start from measured p99 request rates per endpoint, not guesses.
2. Set `rate` ≈ 2× the legitimate sustained rate, `burst` ≈ one page load.
3. `nodelay` for interactive, delay-mode only for strict fairness needs.
4. `limit_req_status 429` everywhere.
5. Oversize zones on public endpoints (eviction = free pass).
6. Log `$limit_req_status` before you need it.

## FAQ

**Does rate limiting apply to websocket upgrades?** Yes — the initial GET is
limit-checked; once upgraded, frames are not counted.

**What about internal proxies?** Key on the real client IP from
`X-Forwarded-For` only if you trust the hop; otherwise you rate limit your own
CDN.

**Why did limits reset after reload?** Zones survive `nginx -s reload`; they
reset only on a full restart or when the zone definition changes.

**Can I exempt health checks?** Put them in a location without `limit_req`, or
key on `$request_uri` map that returns empty (empty key = never limited) for
known probe paths.
