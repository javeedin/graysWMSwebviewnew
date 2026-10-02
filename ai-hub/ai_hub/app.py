"""Serves the API with uvicorn: pid file (data\\server.pid = "pid port"), graceful stop through data\\stop.request
(written by the WMS app), and a log tee to data\\logs\\hub.log."""
from __future__ import annotations

import os
import sys
import threading
import time
from pathlib import Path

from .api import create_api
from .config import HubConfig, home


class _Tee:
    def __init__(self, stream, f):
        self.stream, self.f = stream, f

    def write(self, s):
        for x in (self.stream, self.f):
            try:
                if x:
                    x.write(s)
                    x.flush()
            except Exception:  # noqa: BLE001 - a closed console must not stop the hub
                pass
        return len(s)

    def flush(self):
        pass

    def isatty(self):
        return False

    def __getattr__(self, name):
        return getattr(self.stream or self.f, name)


def start_log(max_bytes: int = 5 * 1024 * 1024) -> Path:
    d = home() / "logs"
    d.mkdir(parents=True, exist_ok=True)
    p = d / "hub.log"
    try:
        if p.exists() and p.stat().st_size > max_bytes:
            old = d / "hub.log.1"
            if old.exists():
                old.unlink()
            p.rename(old)
    except OSError:
        pass
    f = open(p, "a", encoding="utf-8", errors="replace")
    f.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} AI Hub starting (pid {os.getpid()}) =====\n")
    sys.stdout, sys.stderr = _Tee(sys.stdout, f), _Tee(sys.stderr, f)
    return p


def pid_file() -> Path:
    return home() / "server.pid"


def stop_file() -> Path:
    return home() / "stop.request"


def serve(cfg: HubConfig):
    import uvicorn
    server = uvicorn.Server(uvicorn.Config(create_api(cfg, run_jobs=True), host=cfg.host, port=cfg.port, log_level="info"))
    try:
        stop_file().unlink()
    except OSError:
        pass

    def watch():
        while not server.should_exit:
            if stop_file().exists():
                try:
                    stop_file().unlink()
                except OSError:
                    pass
                print("Stop requested on this PC (stop.request) - stopping")
                server.should_exit = True
                return
            time.sleep(1)

    pid_file().write_text(f"{os.getpid()} {cfg.port}", encoding="ascii")
    threading.Thread(target=watch, daemon=True).start()
    try:
        server.run()
    finally:
        try:
            if pid_file().read_text(encoding="ascii").split()[0] == str(os.getpid()):
                pid_file().unlink()
        except (OSError, IndexError):
            pass
