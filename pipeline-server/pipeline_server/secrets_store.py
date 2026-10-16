"""Passwords and the server's RSA key.

- Passwords (Fusion, control database, wallet) go to the Windows Credential Manager through `keyring`
  (DPAPI-protected, per Windows account) - never into config.json.
- The RSA key pair: the WMS app encrypts connection passwords with the PUBLIC key
  ('rsa-oaep-256:<base64>', RSA-OAEP / SHA-256, WebCrypto); only this server holds the PRIVATE key
  (<home>/keys/private.pem, itself encrypted with a passphrase kept in the Credential Manager).
- PIPELINE_SECRETS=file keeps secrets in <home>/secrets.json instead (tests / Linux without a keyring).
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from .config import home

SERVICE = "GraysPipelineServer"


def _file_mode() -> bool:
    return os.environ.get("PIPELINE_SECRETS", "").lower() == "file"


def _file() -> Path:
    return home() / "secrets.json"


def get_secret(name: str) -> str | None:
    if _file_mode():
        p = _file()
        return json.loads(p.read_text()).get(name) if p.exists() else None
    import keyring
    return keyring.get_password(SERVICE, name)


def set_secret(name: str, value: str) -> None:
    if _file_mode():
        p = _file()
        d = json.loads(p.read_text()) if p.exists() else {}
        d[name] = value
        p.write_text(json.dumps(d))
        return
    import keyring
    keyring.set_password(SERVICE, name, value)


# ── RSA key pair ─────────────────────────────────────────────
def _key_dir() -> Path:
    d = home() / "keys"
    d.mkdir(parents=True, exist_ok=True)
    return d


def ensure_keys() -> str:
    """Creates the key pair on first use; returns the public key (SPKI PEM)."""
    priv_p, pub_p = _key_dir() / "private.pem", _key_dir() / "public.pem"
    if priv_p.exists() and pub_p.exists():
        return pub_p.read_text()
    passphrase = get_secret("key-passphrase")
    if not passphrase:
        passphrase = secrets.token_urlsafe(32)
        set_secret("key-passphrase", passphrase)
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    priv_p.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                         serialization.BestAvailableEncryption(passphrase.encode())))
    pub = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    pub_p.write_text(pub)
    return pub


def public_key() -> str:
    return ensure_keys()


def fingerprint() -> str:
    """Same as the app (psFingerprint): first 12 bytes of SHA-256 over the DER key, hex with colons."""
    pem = public_key()
    der = base64.b64decode("".join(l for l in pem.splitlines() if "-----" not in l))
    return ":".join(f"{b:02X}" for b in hashlib.sha256(der).digest()[:12])


_private = None


def _private_key():
    global _private
    if _private is None:
        ensure_keys()
        passphrase = get_secret("key-passphrase")
        if not passphrase:
            raise RuntimeError("The key passphrase is missing from the secrets store - run `python -m pipeline_server init` again.")
        _private = serialization.load_pem_private_key((_key_dir() / "private.pem").read_bytes(), passphrase.encode())
    return _private


def decrypt(value: str | None) -> str | None:
    """'rsa-oaep-256:<base64>' → plain text. Anything else is returned unchanged (empty / not encrypted)."""
    if not value:
        return value
    if not value.startswith("rsa-oaep-256:"):
        return value
    ct = base64.b64decode(value.split(":", 1)[1])
    return _private_key().decrypt(ct, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None)).decode()


def encrypt_for_test(text: str) -> str:
    """What the WMS app does in the browser (used by tests and the console's connection editor)."""
    pub = serialization.load_pem_public_key(public_key().encode())
    ct = pub.encrypt(text.encode(), padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    return "rsa-oaep-256:" + base64.b64encode(ct).decode()
