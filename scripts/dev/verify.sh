#!/bin/bash
# Install any pending deps, then typecheck server and web.
# Detached so it survives the wsl.exe console (see install-detached.sh note).
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG=/tmp/ragts-verify.log

pkill -f "npm install" 2>/dev/null || true
sleep 1

nohup setsid bash -c '
  cd "'"$ROOT"'" || exit 1
  for i in 1 2 3 4 5; do
    npm install --no-audit --no-fund --cache /tmp/ragts-npm-cache \
      --fetch-timeout 30000 --fetch-retries 5 --maxsockets 5 --loglevel=error && break
    sleep 3
  done
  echo "=== server typecheck ==="
  (cd server && npx tsc --noEmit 2>&1); echo "server_tsc_exit=$?"
  echo "=== web typecheck ==="
  (cd web && npx tsc --noEmit 2>&1); echo "web_tsc_exit=$?"
  echo VERIFY_DONE
' > "$LOG" 2>&1 < /dev/null &
echo "RUNNING pid=$! log=$LOG"
