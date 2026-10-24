#!/bin/bash
# Detached next build for web/ — writes /tmp/ragts-build.log
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG=/tmp/ragts-build.log
cd "$ROOT/web" || exit 1
nohup setsid npx next build > "$LOG" 2>&1 < /dev/null &
echo "RUNNING pid=$!"
