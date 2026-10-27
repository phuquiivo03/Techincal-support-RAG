#!/bin/bash
# Audit helper: live security probes against the API (localhost:4000).
set -u
echo "== 1) /api/chat rate limit (aiLimiter: 20/min) — 21 rapid abstaining questions =="
for i in $(seq 1 21); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4000/api/chat \
    -H "content-type: application/json" \
    -d '{"question":"What is the best recipe for neapolitan pizza dough?"}' &
done | sort | uniq -c
wait

echo "== 2) CORS with disallowed origin =="
curl -s -D - -o /dev/null -X POST http://localhost:4000/api/chat \
  -H "Origin: https://evil.example" -H "content-type: application/json" \
  -d '{"question":"What is the best recipe for neapolitan pizza dough?"}' \
  | grep -iE "^HTTP/|access-control" || echo "(no ACAO header returned)"

echo "== 3) Anonymous access to sensitive endpoints =="
curl -s -o /dev/null -w "GET  /api/documents        -> %{http_code}\n" http://localhost:4000/api/documents
curl -s -o /dev/null -w "GET  /api/eval/runs        -> %{http_code}\n" http://localhost:4000/api/eval/runs
curl -s -o /dev/null -w "GET  /api/eval/datasets    -> %{http_code}\n" http://localhost:4000/api/eval/datasets
curl -s -o /dev/null -w "DELETE /api/documents/:bad -> %{http_code}\n" -X DELETE http://localhost:4000/api/documents/not-a-uuid
