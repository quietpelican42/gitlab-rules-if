"""Runs a regex corpus through Google's RE2 (the `google-re2` wheel) and prints results.

Usage: python scripts/run-re2.py corpus.json > results.json
Each result is {"ok": bool, "m": [bool, ...]} where m[i] is whether the pattern
matches anywhere in text i. Errors are reported as {"ok": false}.
"""
import json
import sys

import re2

rows = json.load(open(sys.argv[1], encoding="utf-8"))
out = []
for row in rows:
    try:
        rx = re2.compile(row["p"])
        out.append({"ok": True, "m": [rx.search(t) is not None for t in row["t"]]})
    except Exception:
        out.append({"ok": False})
json.dump(out, sys.stdout, ensure_ascii=False)
