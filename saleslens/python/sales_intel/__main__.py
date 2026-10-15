"""Command line used by the desktop host (one JSON line at the end; PROGRESS lines while it runs).

    python -m sales_intel build    --root C:\\fusion\\saleslens\\data
    python -m sales_intel simulate --root …  --scenario scenario.json   (or the JSON on stdin with --stdin)
    python -m sales_intel demo     --root …  [--months 30]
    python -m sales_intel info     --root …
"""
import argparse
import json
import os
import sys
import traceback

from . import VERSION


def main(argv=None):
    ap = argparse.ArgumentParser(prog="sales_intel")
    ap.add_argument("command", choices=["build", "simulate", "demo", "info"])
    ap.add_argument("--root", required=True)
    ap.add_argument("--scenario")
    ap.add_argument("--stdin", action="store_true")
    ap.add_argument("--months", type=int, default=30)
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    os.makedirs(a.root, exist_ok=True)
    try:
        if a.command == "build":
            from .build import run
            out = run(a.root, quiet=a.quiet)
        elif a.command == "demo":
            from .synth import generate
            out = {"ok": True, **generate(a.root, months=a.months)}
        elif a.command == "simulate":
            import time
            import uuid

            import duckdb

            from .simulate import run as sim
            from .util import now_iso, write_json
            sc = json.loads(sys.stdin.read()) if a.stdin else json.load(open(a.scenario, encoding="utf-8"))
            path = os.path.join(a.root, "saleslens.duckdb")
            if not os.path.exists(path):
                raise SystemExit(json.dumps({"ok": False, "error": "Build the results first (Setup & data › Build & score)."}))
            con = duckdb.connect(path, read_only=True)
            try:
                ver = con.execute("SELECT version FROM sl_runs ORDER BY built_at DESC LIMIT 1").fetchone()
                out = sim(con, sc, ver[0] if ver else VERSION)
            finally:
                con.close()
            sid = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]
            out.update({"ok": True, "sim_id": sid, "at": now_iso(), "by": sc.get("by", "")})
            if sc.get("save", True):
                write_json(os.path.join(a.root, "sims", sid + ".json"), out)
        else:
            out = {"ok": True, "version": VERSION, "python": sys.version.split()[0]}
    except SystemExit as e:
        print(e.code if isinstance(e.code, str) else json.dumps({"ok": False, "error": str(e.code)}))
        return 1
    except Exception as e:  # noqa: BLE001 — the host shows the message and the trace
        out = {"ok": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-3000:]}
    print(json.dumps(out, default=str))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
