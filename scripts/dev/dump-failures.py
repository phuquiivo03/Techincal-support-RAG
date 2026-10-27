#!/usr/bin/env python3
"""Dump failed (non-error) items of an eval run in readable form."""
import json, sys, urllib.request

run_id = sys.argv[1]
with urllib.request.urlopen(f"http://localhost:4000/api/eval/runs/{run_id}") as r:
    run = json.load(r)

for it in run["items"]:
    if not it["pass"] and it["model"] != "error":
        print("=" * 78)
        print(f"{it['id']} [{it['category']}] behavior={it.get('expectedBehavior')} cite={it['metrics'].get('citationPrecision')}")
        print("Q:", it["question"][:120])
        print("FAIL:", it["failureReasons"])
        answer = (it["generatedAnswer"] or "").replace("\n", " ¶ ")
        print("ANSWER:", answer[:600])
        print("MARKERS:", it["citationMarkers"], "INVALID:", it["invalidMarkers"])
        caveats = it.get("caveatHits")
        if caveats:
            print("CAVEATS:", caveats)
