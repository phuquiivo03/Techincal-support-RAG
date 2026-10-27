#!/bin/bash
# Detached launcher for the robustness eval run (survives wsl.exe exits).
# Log: /tmp/robustness-run.log
cd /home/quivo/porfolio/RAGTechSupport/server || exit 1
exec npx tsx scripts/eval-suite.ts --dataset=robustness-v1 --label=robustness-baseline-2026-10-25 > /tmp/robustness-run.log 2>&1
