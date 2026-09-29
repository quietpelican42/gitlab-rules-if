"""Line-oriented bridge that lets the Ruby oracle use Google RE2 (google-re2 wheel).

Request:  {"p": pattern, "t": [text, ...]}
Response: {"ok": true, "g": capture_groups, "broken": bool?, "m": [bool, ...]}
       or {"ok": false, "err": message}
"""
import json
import sys

import re2

for line in sys.stdin:
    q = json.loads(line)
    try:
        rx = re2.compile(q["p"])
        res = {"ok": True, "g": rx.groups}
        if rx.groups == 0:
            try:
                re2.compile("(" + q["p"] + ")")
            except Exception:
                res["broken"] = True
        res["m"] = [rx.search(t) is not None for t in q.get("t", [])]
    except Exception as e:
        res = {"ok": False, "err": str(e)}
    sys.stdout.write(json.dumps(res) + "\n")
    sys.stdout.flush()
