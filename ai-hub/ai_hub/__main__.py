"""python -m ai_hub <command>

  init [--port N] [--token-stdin] [--json]   settings + API token (the WMS app passes its own token through stdin)
  run                                        start the hub (http://127.0.0.1:<port>)
  set-secret NAME --stdin                    store a key, e.g. bedrock.aws_secret_key or anthropic.api_key
  status                                     show the settings (no keys)
"""
from __future__ import annotations

import argparse
import json
import sys


def main(argv=None):
    from . import secrets
    from .config import HubConfig, home
    ap = argparse.ArgumentParser(prog="ai_hub")
    sub = ap.add_subparsers(dest="cmd")
    i = sub.add_parser("init")
    i.add_argument("--port", type=int)
    i.add_argument("--token-stdin", action="store_true")
    i.add_argument("--json", action="store_true")
    sub.add_parser("run")
    s = sub.add_parser("set-secret")
    s.add_argument("name")
    s.add_argument("--stdin", action="store_true")
    sub.add_parser("status")
    a = ap.parse_args(argv)
    cfg = HubConfig.load()
    cmd = a.cmd or "run"
    if cmd == "init":
        if a.port:
            cfg.port = a.port
        token = None
        if a.token_stdin:
            cfg.set_token(sys.stdin.readline().strip())
        elif not cfg.api_token_sha256:
            token = cfg.new_token()
        cfg.save()
        out = {"saved": str(HubConfig.path()), "port": cfg.port, "token": token}
        print(json.dumps(out) if a.json else f"Saved {out['saved']} (port {cfg.port})" + (f"\nAPI token: {token}" if token else ""))
        return 0
    if cmd == "set-secret":
        v = sys.stdin.readline().rstrip("\r\n") if a.stdin else input(f"{a.name}: ")
        secrets.set_secret(a.name, v or None)
        print("Saved." if v else "Removed.")
        return 0
    if cmd == "status":
        print(json.dumps(cfg.public(), indent=2))
        print("Home:", home())
        return 0
    if not cfg.api_token_sha256:
        print("Not set up yet - run: python -m ai_hub init")
        return 1
    from .app import serve, start_log
    start_log()
    print(f"AI Hub on http://{cfg.host}:{cfg.port}")
    serve(cfg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
