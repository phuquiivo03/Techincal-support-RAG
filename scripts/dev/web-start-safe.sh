#!/bin/bash
# Start next dev detached WITHOUT pkill — web-test.sh's pkill would also kill
# next servers of OTHER projects (e.g. devlife on :4317). Only clean up our own.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

for pid in $(pgrep -f "next-server"); do
  if readlink "/proc/$pid/cwd" 2>/dev/null | grep -q "porfolio/RAGTechSupport"; then
    kill "$pid" 2>/dev/null || true
  fi
done

nohup setsid bash -c "cd '$ROOT/web' && exec npx next dev" > /tmp/ragts-web.log 2>&1 < /dev/null &
sleep 14
echo "===PORT==="
ss -ltnp | grep :3000 || echo "NOT LISTENING on :3000"
echo "===PAGES==="
for p in / /chat /documents /debugger /eval; do
  code=$(curl -s -m 55 -o /dev/null -w '%{http_code}' "http://localhost:3000$p")
  echo "page $p -> $code"
done
echo "WEB_SAFE_DONE"
