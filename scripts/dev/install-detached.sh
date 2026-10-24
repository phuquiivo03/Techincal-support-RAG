#!/bin/bash
# Detached npm install with retry loop.
#
# Why this exists: on this machine, npm's keep-alive connections to the npm
# registry (Cloudflare) sometimes stall forever — npm holds idle ESTABLISHED
# sockets and never times out. A low --fetch-timeout, limited --maxsockets and
# retries make progress each round (cache persists between attempts).
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG=/tmp/ragts-install.log

pkill -f "npm install" 2>/dev/null || true
sleep 1

mkdir -p /tmp/ragts-npm-cache
cd "$ROOT" || exit 1

nohup setsid bash -c '
  for i in 1 2 3 4 5 6 7 8; do
    echo "=== attempt $i $(date +%T) ==="
    npm install --no-audit --no-fund \
      --cache /tmp/ragts-npm-cache \
      --fetch-timeout 30000 --fetch-retries 5 --maxsockets 5 \
      --loglevel=warn && { echo "INSTALL_SUCCEEDED"; exit 0; }
    echo "attempt $i failed, retrying…"
    sleep 3
  done
  echo "INSTALL_FAILED_ALL_ATTEMPTS"
  exit 1
' > "$LOG" 2>&1 < /dev/null &
PID=$!
sleep 3
echo "RUNNING pid=$PID log=$LOG"
