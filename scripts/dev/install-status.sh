#!/bin/bash
# Status of the detached npm install: process alive? log tail? node_modules size?
N=$(pgrep -fc "npm install" 2>/dev/null || true)
echo "npm_processes=$N"
if [ -d /home/quivo/porfolio/RAGTechSupport/node_modules ]; then
  echo "node_modules_entries=$(ls /home/quivo/porfolio/RAGTechSupport/node_modules | wc -l)"
fi
echo "--- last log lines ---"
tail -5 /tmp/ragts-install.log 2>/dev/null
