"""Hub settings: <AIHUB_HOME>/config.json (no keys - those live in secrets.py)."""
from __future__ import annotations

import copy
import hashlib
import hmac
import json
import os
import secrets
import threading
from pathlib import Path


def home() -> Path:
    """Data folder: AIHUB_HOME, else <ai-hub>/data."""
    p = Path(os.environ.get("AIHUB_HOME") or Path(__file__).resolve().parent.parent / "data")
    p.mkdir(parents=True, exist_ok=True)
    return p


# Claude model IDs per platform (docs: models overview, Claude in Amazon Bedrock). Other Bedrock and NVIDIA
# models are discovered live from the provider (Discover button) - nothing guessed here.
CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"]
BEDROCK_CLAUDE_MODELS = ["anthropic.claude-opus-5-5", "anthropic.claude-sonnet-5-5", "anthropic.claude-haiku-4-5"]

# USD per million tokens (input, output). First-party list prices from Anthropic's docs; Bedrock / NVIDIA prices
# depend on the contract and region (regional endpoints +10 %) - edit them in AI Hub › Router › Prices.
DEFAULT_PRICES = {
    "claude-opus-5-5": [4.0, 20.0],
    "claude-sonnet-5-5": [2.0, 10.0],
    "anthropic.claude-opus-5-5": [4.0, 20.0],
    "anthropic.claude-sonnet-5-5": [2.0, 10.0],
    "demo": [0.0, 0.0],
}

# data classes a task may carry; a provider only gets the classes it is allowed
DATA_CLASSES = ["public", "internal", "fusion-data", "personal"]

DEFAULT_PROVIDERS = {
    "demo": {"type": "demo", "label": "Demo (offline)", "enabled": True, "models": ["demo"],
             "data_classes": DATA_CLASSES},
    "bedrock": {"type": "bedrock", "label": "Claude in Amazon Bedrock", "enabled": False, "region": "eu-central-1",
                "auth": "keys", "models": BEDROCK_CLAUDE_MODELS, "data_classes": ["public", "internal", "fusion-data"]},
    "bedrock-converse": {"type": "bedrock_converse", "label": "Amazon Bedrock (Nova, Llama, Mistral …)", "enabled": False,
                         "region": "eu-central-1", "auth": "keys", "models": [], "data_classes": ["public", "internal"]},
    "claude-aws": {"type": "claude_aws", "label": "Claude Platform on AWS", "enabled": False, "region": "eu-central-1",
                   "workspace_id": "", "auth": "keys", "models": CLAUDE_MODELS, "data_classes": ["public", "internal", "fusion-data"]},
    "anthropic": {"type": "anthropic", "label": "Anthropic (direct)", "enabled": False, "models": CLAUDE_MODELS,
                  "data_classes": ["public", "internal", "fusion-data"]},
    "nvidia": {"type": "nvidia", "label": "NVIDIA NIM (hosted API)", "enabled": False,
               "base_url": "https://integrate.api.nvidia.com/v1", "models": [], "data_classes": ["public"]},
}

# task → ordered candidates (the first that is enabled, allowed and answers wins)
DEFAULT_ROUTES = {
    "default": [{"provider": "bedrock", "model": "anthropic.claude-sonnet-5-5"}, {"provider": "anthropic", "model": "claude-sonnet-5-5"},
                {"provider": "demo", "model": "demo"}],
    "fusion_sql": [{"provider": "bedrock", "model": "anthropic.claude-opus-5-5"}, {"provider": "anthropic", "model": "claude-opus-5-5"},
                   {"provider": "demo", "model": "demo"}],
    "pipeline_doctor": [{"provider": "bedrock", "model": "anthropic.claude-sonnet-5-5"}, {"provider": "anthropic", "model": "claude-sonnet-5-5"},
                        {"provider": "demo", "model": "demo"}],
    "cheap": [{"provider": "bedrock", "model": "anthropic.claude-haiku-4-5"}, {"provider": "nvidia", "model": ""},
              {"provider": "demo", "model": "demo"}],
}
# Voice (AI Agent voice mode) and phone (Twilio ConversationRelay). Keys live in secrets.py:
#   elevenlabs.api_key, azure_speech.key, twilio.auth_token
DEFAULT_VOICE = {
    "tts": {"provider": "browser", "voice": "", "model": "eleven_flash_v2_5", "engine": "generative", "speed": 1.0},
    "stt": {"provider": "browser", "language": "en", "model": "scribe_v1", "whisper_size": "base"},
    "language": "en-US", "gender": "female",   # voice language (also what the agent speaks) and voice gender
    "azure_region": "westeurope",
    "aws_provider": "bedrock",          # Amazon Polly uses the AWS credentials of this provider
}
DEFAULT_PHONE = {
    "enabled": False, "port": 8101, "public_url": "", "account_sid": "", "from_number": "",
    "inbound": "known",                  # off | known (PIN-verified known numbers get data, others leave a message) | everyone (messages only)
    "known": {},                         # "+2305xxxxxxx": {"user": "SHAIK", "pin_sha256": "..."}
    "allowed_prefixes": ["+230"],        # outbound calls only to these
    "max_minutes": 10, "language": "en-US", "tts_provider": "ElevenLabs", "voice": "", "company": "Gray's",
}
TASK_DATA_CLASS = {"default": "internal", "fusion_sql": "fusion-data", "pipeline_doctor": "fusion-data", "cheap": "internal"}


class HubConfig:
    """Thread-safe JSON settings."""

    def __init__(self, data: dict | None = None):
        self._lock = threading.RLock()
        d = data or {}
        self.port = int(d.get("port", 8100))
        self.host = d.get("host", "127.0.0.1")          # local only: the WMS app relays to it
        self.api_token_sha256 = d.get("api_token_sha256", "")
        self.budget_month_usd = float(d.get("budget_month_usd", 50))
        self.providers = copy.deepcopy(DEFAULT_PROVIDERS)
        for k, v in (d.get("providers") or {}).items():
            self.providers.setdefault(k, {}).update(v)
        self.routes = copy.deepcopy(d.get("routes") or DEFAULT_ROUTES)
        for k, v in DEFAULT_ROUTES.items():
            self.routes.setdefault(k, copy.deepcopy(v))
        self.task_data_class = dict(TASK_DATA_CLASS, **(d.get("task_data_class") or {}))
        self.prices = dict(DEFAULT_PRICES, **(d.get("prices") or {}))
        self.voice: dict = copy.deepcopy(DEFAULT_VOICE)
        for k, v in (d.get("voice") or {}).items():
            cur = self.voice.get(k)
            if isinstance(v, dict) and isinstance(cur, dict):
                cur.update(v)
            else:
                self.voice[k] = v
        self.phone: dict = dict(copy.deepcopy(DEFAULT_PHONE), **(d.get("phone") or {}))

    @staticmethod
    def path() -> Path:
        return home() / "config.json"

    @classmethod
    def load(cls) -> "HubConfig":
        p = cls.path()
        return cls(json.loads(p.read_text(encoding="utf-8")) if p.exists() else None)

    def to_dict(self) -> dict:
        with self._lock:
            return {"port": self.port, "host": self.host, "api_token_sha256": self.api_token_sha256,
                    "budget_month_usd": self.budget_month_usd, "providers": copy.deepcopy(self.providers),
                    "routes": copy.deepcopy(self.routes), "task_data_class": dict(self.task_data_class), "prices": dict(self.prices),
                    "voice": copy.deepcopy(self.voice), "phone": copy.deepcopy(self.phone)}

    def public(self) -> dict:
        d = self.to_dict()
        d.pop("api_token_sha256", None)
        return d

    def save(self) -> None:
        with self._lock:
            self.path().write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")

    def new_token(self) -> str:
        token = secrets.token_urlsafe(32)
        self.set_token(token)
        return token

    def set_token(self, token: str) -> None:
        self.api_token_sha256 = hashlib.sha256(token.encode()).hexdigest()

    def check_token(self, token: str) -> bool:
        if not self.api_token_sha256 or not token:
            return False
        return hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), self.api_token_sha256)

    def price(self, model: str) -> tuple[float, float]:
        p = self.prices.get(model)
        if p is None and model.startswith(("global.", "us.", "eu.", "jp.", "apac.", "au.")):
            p = self.prices.get(model.split(".", 1)[1])
        return (float(p[0]), float(p[1])) if p else (0.0, 0.0)
