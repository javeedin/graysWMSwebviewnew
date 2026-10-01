"""python -m pipeline_server <command>

  init                 first-time setup: server name, port, Fusion user + password, control database, API token, keys
  run                  start the server (API + console + engine)  - what the Windows service runs
  demo                 start with built-in sample pipelines, no database / Fusion needed (try the console)
  test                 check the control database, Fusion and the keys
  new-token            make a new API token (paste it into the WMS app)
  set-fusion-password  store the Fusion password in the Windows Credential Manager
  set-db-password      store the control database password (control driver = oracle)
  status               show the settings
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import sys


def main(argv=None):
    from .config import ServerConfig, home
    ap = argparse.ArgumentParser(prog="pipeline_server", description="Gray's WMS pipeline server")
    sub = ap.add_subparsers(dest="cmd")
    i = sub.add_parser("init")
    i.add_argument("--name")
    i.add_argument("--port", type=int)
    i.add_argument("--timezone")
    i.add_argument("--fusion-user")
    i.add_argument("--control", choices=["ords", "oracle", "memory"])
    i.add_argument("--ords-url")
    i.add_argument("--yes", action="store_true", help="no questions: take the defaults / flags")
    d = sub.add_parser("demo")
    d.add_argument("--port", type=int, default=8000)
    sub.add_parser("run")
    sub.add_parser("test")
    nt = sub.add_parser("new-token")
    nt.add_argument("--json", action="store_true", help="one JSON line (the WMS app's Connect this app)")
    sub.add_parser("set-fusion-password")
    sub.add_parser("set-db-password")
    sub.add_parser("status")
    a = ap.parse_args(argv)
    cmd = a.cmd or "run"
    cfg = ServerConfig.load()
    from . import secrets_store

    if cmd == "init":
        def ask(label, default):
            if a.yes:
                return default
            v = input(f"{label} [{default}]: ").strip()
            return v or default
        import socket
        cfg.server_name = a.name or ask("Server name (as the WMS app will show it)", cfg.server_name if ServerConfig.path().exists() else socket.gethostname().upper())
        cfg.port = a.port or int(ask("Port", cfg.port))
        cfg.timezone = a.timezone or ask("Time zone for schedules", cfg.timezone)
        cfg.control.driver = a.control or ask("Control tables through (ords = the app's APEX gateway, oracle = direct)", cfg.control.driver)
        if cfg.control.driver == "ords":
            cfg.control.ords_ai_base = a.ords_url or ask("APEX gateway URL (…/WAREHOUSEMANAGEMENT/ai)", cfg.control.ords_ai_base)
        elif cfg.control.driver == "oracle":
            cfg.control.dsn = ask("Database DSN (host:port/service or TNS alias)", cfg.control.dsn)
            cfg.control.user = ask("Database user", cfg.control.user)
            cfg.control.wallet_dir = ask("Wallet folder (Autonomous DB, blank if none)", cfg.control.wallet_dir)
            if not a.yes:
                secrets_store.set_secret("control-db", getpass.getpass("Database password: "))
        cfg.fusion.username = a.fusion_user or ask("Fusion user (the BI Publisher runner runs as this user)", cfg.fusion.username)
        if cfg.fusion.username and not a.yes:
            pw = getpass.getpass("Fusion password (stored in the Windows Credential Manager; Enter = keep): ")
            if pw:
                secrets_store.set_secret("fusion", pw)
        token = None
        if not cfg.api_token_sha256:
            token = cfg.new_token()
        cfg.save()
        secrets_store.ensure_keys()
        print(f"\nSaved {ServerConfig.path()}")
        print(f"Encryption key fingerprint: {secrets_store.fingerprint()}")
        if token:
            print("\n  API user : " + cfg.api_user + "\n  API token: " + token + "\n")
            print("Copy the token now - it is not shown again. In the WMS app: Fusion SQL › Setups › Data pipeline setups ›")
            print(f"add this server (host = this PC's name or IP, port {cfg.port}, API user '{cfg.api_user}', the token above), then Test.")
        print("\nStart it with:  start-server.bat   (or: python -m pipeline_server run)")
        return 0

    if cmd == "new-token":
        token = cfg.new_token()
        cfg.save()
        if a.json:
            print(json.dumps({"api_user": cfg.api_user, "api_token": token, "server_name": cfg.server_name, "port": cfg.port,
                              "timezone": cfg.timezone, "fingerprint": secrets_store.fingerprint()}))
            return 0
        print(f"API user : {cfg.api_user}\nAPI token: {token}\nPaste the token into the WMS app (Data pipeline setups › this server).")
        return 0
    if cmd == "set-fusion-password":
        if not cfg.fusion.username:
            cfg.fusion.username = input("Fusion user: ").strip()
            cfg.save()
        secrets_store.set_secret("fusion", getpass.getpass(f"Fusion password for {cfg.fusion.username}: "))
        print("Saved in the Windows Credential Manager.")
        return 0
    if cmd == "set-db-password":
        secrets_store.set_secret("control-db", getpass.getpass("Control database password: "))
        print("Saved.")
        return 0
    if cmd == "status":
        from dataclasses import asdict
        print(json.dumps(asdict(cfg), indent=2))
        print("Home:", home())
        print("Fusion password saved:", bool(secrets_store.get_secret("fusion")))
        return 0
    if cmd == "test":
        ok = True
        print("Encryption key:", secrets_store.fingerprint())
        try:
            from .factory import build_store
            s = build_store(cfg)
            print("Control tables:", s.prepare() or "ready")
            srv = s.register_server(cfg.server_name, "localhost", cfg.port, cfg.api_user, cfg.timezone, "test")
            print(f"Control database: OK (server #{srv['id']}, {len(s.pipelines(srv['id'], srv['is_default']))} pipelines)")
        except Exception as e:  # noqa: BLE001
            ok = False
            print("Control database: FAILED -", e)
        try:
            from .runner import fusion_runner
            r = fusion_runner(cfg, cfg.fusion.default_pod).run("SELECT 1 AS N FROM dual", 1)
            print(f"Fusion {cfg.fusion.default_pod}: OK ({r.elapsed_ms} ms, rows {r.rows})")
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"Fusion {cfg.fusion.default_pod}: FAILED -", e)
        return 0 if ok else 1

    if cmd == "demo":
        os.environ.setdefault("PIPELINE_SECRETS", os.environ.get("PIPELINE_SECRETS", ""))
        cfg.control.driver = "memory"
        cfg.worker_mode = "thread"
        cfg.port = a.port
        cfg.server_name = cfg.server_name or "DEMO"
        if not cfg.api_token_sha256:
            tok = cfg.new_token()
            print(f"Demo API token (console sign-in): {tok}")
        from .app import serve
        print(f"Console: http://localhost:{cfg.port}/ui/")
        serve(cfg)
        return 0

    if not cfg.api_token_sha256:
        print("Not set up yet - run:  python -m pipeline_server init")
        return 1
    from .app import serve
    print(f"Pipeline server {cfg.server_name} on http://{cfg.host}:{cfg.port}  (console: /ui/)")
    serve(cfg)
    return 0


if __name__ in ("__main__", "__mp_main__") and __name__ == "__main__":
    sys.exit(main())
