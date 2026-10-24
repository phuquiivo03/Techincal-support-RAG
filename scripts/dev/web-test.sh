#!/bin/bash
# Start next dev (port 3000) detached and verify all pages return 200.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 1
nohup setsid bash -c "cd '$ROOT/web' && exec npx next dev" > /tmp/ragts-web.log 2>&1 < /dev/null &
sleep 12

for path in / /chat /documents /debugger; do
  code=$(curl -s -m 60 -o /dev/null -w '%{http_code}' "http://localhost:3000$path")
  echo "page $path -> $code"
done

# sanity: the landing page should contain our hero copy
curl -s -m 30 http://localhost:3000/ | grep -o "Technical support" | head -1
echo "WEB_TEST_DONE"
