"""Cloud keys in the Windows Credential Manager (keyring, DPAPI per Windows account) - never in config.json.
AIHUB_SECRETS=file keeps them in <home>/secrets.json instead (tests / Linux without a keyring)."""
from __future__ import annotations

import json
import os

from .config import home

SERVICE = "GraysAiHub"


def _file_mode() -> bool:
    return os.environ.get("AIHUB_SECRETS", "").lower() == "file"


def get_secret(name: str) -> str | None:
    if _file_mode():
        p = home() / "secrets.json"
        return json.loads(p.read_text()).get(name) if p.exists() else None
    import keyring
    return keyring.get_password(SERVICE, name)


def set_secret(name: str, value: str | None) -> None:
    if _file_mode():
        p = home() / "secrets.json"
        d = json.loads(p.read_text()) if p.exists() else {}
        if value:
            d[name] = value
        else:
            d.pop(name, None)
        p.write_text(json.dumps(d))
        return
    import keyring
    if value:
        keyring.set_password(SERVICE, name, value)
    else:
        try:
            keyring.delete_password(SERVICE, name)
        except Exception:  # noqa: BLE001 (not there)
            pass


def has_secret(name: str) -> bool:
    try:
        return bool(get_secret(name))
    except Exception:  # noqa: BLE001
        return False
