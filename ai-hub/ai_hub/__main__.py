"""python -m ai_hub <command>

  init [--port N] [--token-stdin] [--json]   settings + API token (the WMS app passes its own token through stdin)
  run                                        start the hub (http://127.0.0.1:<port>)
  set-secret NAME --stdin                    store a key, e.g. bedrock.aws_secret_key or anthropic.api_key
  status                                     show the settings (no keys)
  eval-agent [--provider P --model M] [--all] [--min-pass N] [--json]
                                             run the AI Agent eval cases (demo planner by default; exit 1 below --min-pass)
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
    e = sub.add_parser("eval-agent")
    e.add_argument("--provider")
    e.add_argument("--model")
    e.add_argument("--all", action="store_true", help="also the model_only cases")
    e.add_argument("--min-pass", type=float, default=1.0, help="share of cases that must pass (0-1)")
    e.add_argument("--json", action="store_true")
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
    if cmd == "eval-agent":
        from .agents import evals as AE
        from .gateway import Gateway
        from .usage import Usage
        r = AE.run(Gateway(cfg, Usage()), a.provider, a.model, True if a.all else None)
        if a.json:
            print(json.dumps(r, indent=1))
        else:
            for c in r["cases"]:
                print(f"{'PASS' if c['pass'] else 'FAIL'}  {c['id']:<18} route={c['route']} called={' > '.join(c['called'])}"
                      + (f"  forbidden={c['forbidden']}" if c["forbidden"] else "") + (f"  refused={c['refused']}" if c["refused"] else "")
                      + (f"  error={c['error']}" if c["error"] else ""))
            print(f"{r['passed']}/{r['total']} passed · routing {r['route_acc']:.0%} · tools {r['trajectory_acc']:.0%} · "
                  f"safety {'ok' if r['safety_ok'] else 'FAILED'} · ${r['cost']:.4f}")
        return 0 if r["total"] and r["passed"] / r["total"] >= a.min_pass else 1
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
