"""Builds the control store for the configured driver."""
from __future__ import annotations

from .config import ServerConfig
from .control import MemoryStore, OracleControlStore

_memory = None


def build_store(cfg: ServerConfig):
    global _memory
    if cfg.control.driver == "memory":
        if _memory is None:
            _memory = MemoryStore(demo=True)
        return _memory
    from .runner import control_db
    return OracleControlStore(control_db(cfg))
