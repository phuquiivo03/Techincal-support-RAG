#!/usr/bin/env python3
"""Dump selected items of a stored eval run (answers, sufficiency, claims)."""
import json, sys, urllib.request

run_id, wanted = sys.argv[1], set(sys.argv[2].split(","))
with urllib.request.urlopen(f"http://localhost:4000/api/eval/runs/{run_id}") as r:
    run = json.load(r)

for it in run["items"]:
    if it["id"] in wanted:
        cs = it.get("claimSupport") or {}
        print("=" * 76)
        print(f"{it['id']} | sufficient={it['sufficient']} | claims={cs.get('claimSentences')}/{cs.get('citedClaimSentences')} cited (rate {cs.get('citedClaimRate')})")
        print("ANSWER:", (it["generatedAnswer"] or "(empty)")[:300].replace("\n", " ¶ "))
