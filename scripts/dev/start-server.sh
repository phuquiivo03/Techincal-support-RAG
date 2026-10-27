#!/bin/bash
# Start the Express API detached (port 4000). Log: /tmp/ragts-server.log
# NOTE: the bash -c exec wrapper is required — spawning `npx tsx` directly
# under setsid dies silently in this environment.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Matches both "tsx src/index.ts" and "tsx watch src/index.ts" — a stale
# non-watch instance once kept serving pre-fix code on :4000 unnoticed.
pkill -f "tsx( watch)? src/index\.ts" 2>/dev/null || true
sleep 1
nohup setsid bash -c "cd '$ROOT/server' && exec npx tsx src/index.ts" > /tmp/ragts-server.log 2>&1 < /dev/null &
echo "RUNNING pid=$!"
