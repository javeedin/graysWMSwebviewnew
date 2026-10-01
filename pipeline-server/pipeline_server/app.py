"""Builds the whole server: supervisor + API + console, then serves them with uvicorn."""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path

from .api import create_api
from .config import ServerConfig
from .engine import Supervisor
from .factory import build_store


def build(cfg: ServerConfig):
    store = build_store(cfg)
    sup = Supervisor(cfg, store)
    api = create_api(sup, cfg)
    from .console import mount_console
    mount_console(api, sup, cfg)

    @api.on_event("startup")
    def _start():
        threading.Thread(target=sup.start_service, name="startup", daemon=True).start()

    @api.on_event("shutdown")
    def _stop():
        sup.shutdown()
    return api, sup


def pid_file() -> Path:
    from .config import home
    return home() / "server.pid"


def stop_file() -> Path:
    from .config import home
    return home() / "stop.request"


def _watch_stop(server, sup: Supervisor, grace_s: int = 20):
    """The WMS app (or anyone on this PC) stops the server gracefully by creating data\\stop.request:
    running runs are cancelled at their next page (re-queued at the next start), then uvicorn exits."""
    f = stop_file()
    while not server.should_exit:
        if f.exists():
            try:
                f.unlink()
            except OSError:
                pass
            sup.note("INFO", "Stop requested on this PC (stop.request) - stopping")
            sup.set_mode("STOP_NOW", "local stop")
            deadline = time.time() + grace_s
            while sup.workers and time.time() < deadline:
                time.sleep(0.5)
            server.should_exit = True
            return
        time.sleep(1)


def serve(cfg: ServerConfig):
    import uvicorn
    api, sup = build(cfg)
    server = uvicorn.Server(uvicorn.Config(api, host=cfg.host, port=cfg.port, log_level="info", timeout_graceful_shutdown=10))
    try:
        stop_file().unlink()                                   # an old request must not stop this start
    except OSError:
        pass
    pid_file().write_text(f"{os.getpid()} {cfg.port}", encoding="ascii")
    threading.Thread(target=_watch_stop, args=(server, sup), name="stop-watch", daemon=True).start()
    try:
        server.run()
    finally:
        try:
            if pid_file().read_text(encoding="ascii").split()[0] == str(os.getpid()):
                pid_file().unlink()
        except (OSError, IndexError):
            pass
