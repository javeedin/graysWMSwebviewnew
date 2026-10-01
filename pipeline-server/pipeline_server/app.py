"""Builds the whole server: supervisor + API + console, then serves them with uvicorn."""
from __future__ import annotations

import threading

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


def serve(cfg: ServerConfig):
    import uvicorn
    api, _ = build(cfg)
    uvicorn.run(api, host=cfg.host, port=cfg.port, log_level="info", timeout_graceful_shutdown=10)
