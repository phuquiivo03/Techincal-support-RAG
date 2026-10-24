#!/bin/bash
# Full live API test: restart server, health, on-topic chat, off-topic chat, retrieve.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

pkill -f "tsx src/index.ts" 2>/dev/null || true
sleep 1
nohup setsid bash -c "cd '$ROOT/server' && exec npx tsx src/index.ts" > /tmp/ragts-server.log 2>&1 < /dev/null &
sleep 15

echo "=== HEALTH ==="
curl -s -m 90 http://localhost:4000/api/health
echo; echo

echo "=== CHAT (on-topic: expect citations + sufficient true) ==="
curl -s -m 120 http://localhost:4000/api/chat \
  -H 'content-type: application/json' \
  -d '{"question":"Our Node.js container keeps getting OOMKilled with exit code 137. How do I fix it?"}' \
  | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const r=JSON.parse(s);
      console.log("sufficient:", r.sufficient);
      console.log("model:", r.model);
      console.log("timings:", JSON.stringify(r.timings));
      console.log("sources:", r.sources.map(x=>`[${x.index}] ${x.documentTitle} (${x.score})`).join(" | "));
      console.log("answer (first 500 chars):"); console.log(r.answer.slice(0,500));
    });'
echo

echo "=== CHAT (off-topic: expect sufficient false, no LLM) ==="
curl -s -m 60 http://localhost:4000/api/chat \
  -H 'content-type: application/json' \
  -d '{"question":"What is the best recipe for neapolitan pizza dough?"}' \
  | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const r=JSON.parse(s);
      console.log("sufficient:", r.sufficient);
      console.log("model:", r.model);
      console.log("answer (first 160 chars):", r.answer.slice(0,160));
    });'
echo

echo "=== RETRIEVE (debugger endpoint) ==="
curl -s -m 60 http://localhost:4000/api/retrieve \
  -H 'content-type: application/json' \
  -d '{"query":"nginx upstream prematurely closed connection keepalive","topK":3,"threshold":0.5}' \
  | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const r=JSON.parse(s);
      console.log("results:", r.results.length, "· topK:", r.topK, "· threshold:", r.threshold);
      for (const c of r.results) console.log(`  #${c.rank} ${c.score} ${c.documentTitle} chunk${c.chunkIndex}`);
      console.log("timings:", JSON.stringify(r.timings));
    });'
echo "API_TEST_DONE"
