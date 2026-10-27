#!/usr/bin/env python3
"""Print the aggregate metrics blob of a stored eval run."""
import json, sys, urllib.request

run_id = sys.argv[1]
with urllib.request.urlopen(f"http://localhost:4000/api/eval/runs/{run_id}") as r:
    run = json.load(r)

m = run["metrics"]
print(json.dumps({
    "suite": run.get("suite"),
    "items": m["items"], "passed": m["passed"], "passRate": m["passRate"],
    "retrieval": m["retrieval"],
    "answers": m["answers"],
    "abstention": m["abstention"],
    "byBehavior": m.get("byBehavior"),
    "byFailureType": m.get("byFailureType"),
    "claims": m.get("claims"),
    "byCategory": m["byCategory"],
}, indent=1, ensure_ascii=False))
