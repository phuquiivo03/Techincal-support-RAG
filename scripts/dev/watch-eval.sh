#!/bin/bash
# Watcher: exits when the robustness rerun lands in the DB, or when the eval
# process dies without storing anything. Max wait passed as $1 (seconds).
MAX=${1:-2700}
DB=/home/quivo/porfolio/RAGTechSupport/server
for ((i=0; i<MAX; i+=60)); do
  sleep 60
  if ! pgrep -f "scripts/eval-suite" > /dev/null; then
    echo "EVAL_PROCESS_GONE at ${i}s"
    exit 0
  fi
  cd "$DB" && timeout 30 npx tsx ../scripts/dev/eval-history-check.ts w$$ 2>/dev/null | grep -q "robustness-baseline-2026-10-25-rerun" && {
    echo "RUN_STORED at ${i}s"
    exit 0
  }
done
echo "WATCH_TIMEOUT after ${MAX}s (still running)"
