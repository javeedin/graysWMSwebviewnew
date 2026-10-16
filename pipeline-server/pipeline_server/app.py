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


class _Tee:
    """Writes to the console (when there is one) and to data\\logs\\server.log - so the WMS app shows the log whether
    the server runs in a window, hidden, as a scheduled task or as a service."""

    def __init__(self, stream, f):
        self.stream, self.f = stream, f

    def write(self, s):
        try:
            if self.stream:
                self.stream.write(s)
        except Exception:  # noqa: BLE001  (a closed / missing console must not stop the server)
            pass
        try:
            self.f.write(s)
            self.f.flush()
        except Exception:  # noqa: BLE001
            pass
        return len(s)

    def flush(self):
        for x in (self.stream, self.f):
            try:
                x and x.flush()
            except Exception:  # noqa: BLE001
                pass

    def isatty(self):
        return False

    def __getattr__(self, name):
        return getattr(self.stream or self.f, name)


def start_log(max_bytes: int = 5 * 1024 * 1024) -> Path:
    import sys
    from .config import home
    d = home() / "logs"
    d.mkdir(parents=True, exist_ok=True)
    p = d / "server.log"
    try:
        if p.exists() and p.stat().st_size > max_bytes:
            old = d / "server.log.1"
            if old.exists():
                old.unlink()
            p.rename(old)
    except OSError:
        pass
    f = open(p, "a", encoding="utf-8", errors="replace")
    f.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} pipeline server starting (pid {os.getpid()}) =====\n")
    f.flush()
    sys.stdout = _Tee(sys.stdout, f)
    sys.stderr = _Tee(sys.stderr, f)
    return p


def console_code_file() -> Path:
    from .config import home
    return home() / "console.code"


def take_console_code(code: str, max_age_s: int = 120) -> bool:
    """One-time sign-in code for the console, written by the WMS app on this PC (only someone who can write the data
    folder can make one). Used once, valid for 2 minutes."""
    f = console_code_file()
    try:
        if not code or not f.exists() or time.time() - f.stat().st_mtime > max_age_s:
            return False
        import hmac
        ok = hmac.compare_digest(f.read_text(encoding="ascii").strip(), code.strip())
        if ok:
            f.unlink()
        return ok
    except (OSError, ValueError):
        return False


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
