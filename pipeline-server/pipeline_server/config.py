"""Server settings: <PIPELINE_HOME>/config.json (no passwords - those live in secrets_store)."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
from dataclasses import asdict, dataclass, field
from pathlib import Path

DEFAULT_ORDS_AI = "https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai"
DEFAULT_PODS = {
    "PROD": "https://efmh.fa.em3.oraclecloud.com",
    "TEST": "https://efmh-test.fa.em3.oraclecloud.com",
}


def home() -> Path:
    """Data folder: PIPELINE_HOME, else <pipeline-server>/data."""
    p = Path(os.environ.get("PIPELINE_HOME") or Path(__file__).resolve().parent.parent / "data")
    p.mkdir(parents=True, exist_ok=True)
    return p


@dataclass
class ControlConfig:
    # ords   = the WMS app's APEX gateway (ai/executequery + ai/executewrite) - nothing to install
    # oracle = direct connection to the APEX database (python-oracledb; password in the secrets store)
    # memory = demo / tests: in-memory tables seeded with sample pipelines
    driver: str = "ords"
    ords_ai_base: str = DEFAULT_ORDS_AI
    app_user: str = "PIPELINE_SERVER"
    dsn: str = ""                 # oracle: host:port/service, TNS descriptor or alias
    user: str = ""
    wallet_dir: str = ""
    timeout_s: int = 120


@dataclass
class FusionConfig:
    pods: dict = field(default_factory=lambda: dict(DEFAULT_PODS))
    default_pod: str = "PROD"
    username: str = ""            # password in the secrets store ("fusion")
    report_path: str = "/Custom/GraysWMS/QueryRunner.xdo"
    report_service_path: str = "/xmlpserver/services/v2/ReportService"
    timeout_s: int = 300
    retries: int = 2


@dataclass
class ServerConfig:
    server_name: str = "PIPELINE-SERVER"
    host: str = "0.0.0.0"
    port: int = 8000
    timezone: str = "Indian/Mauritius"
    api_user: str = "pipeline"
    api_token_sha256: str = ""    # the token itself is shown once by `init` / `new-token`
    poll_seconds: int = 30
    max_parallel: int = 4
    worker_mode: str = "process"  # process (each run in its own process - can be killed) | thread
    page_size: int = 5000
    full_load_cap: int = 200000   # rows read without an order key in one go
    control: ControlConfig = field(default_factory=ControlConfig)
    fusion: FusionConfig = field(default_factory=FusionConfig)

    # ── persistence ──
    @staticmethod
    def path() -> Path:
        return home() / "config.json"

    @classmethod
    def load(cls) -> "ServerConfig":
        p = cls.path()
        if not p.exists():
            return cls()
        raw = json.loads(p.read_text(encoding="utf-8"))
        cfg = cls(**{k: v for k, v in raw.items() if k not in ("control", "fusion") and k in cls.__dataclass_fields__})
        cfg.control = ControlConfig(**{k: v for k, v in raw.get("control", {}).items() if k in ControlConfig.__dataclass_fields__})
        cfg.fusion = FusionConfig(**{k: v for k, v in raw.get("fusion", {}).items() if k in FusionConfig.__dataclass_fields__})
        return cfg

    def save(self) -> None:
        self.path().write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")

    # ── API token ──
    def new_token(self) -> str:
        token = secrets.token_urlsafe(24)
        self.api_token_sha256 = hashlib.sha256(token.encode()).hexdigest()
        return token

    def check_token(self, user: str, token: str) -> bool:
        if not self.api_token_sha256:
            return False
        ok_user = hmac.compare_digest((user or "").encode(), (self.api_user or "").encode())
        ok_tok = hmac.compare_digest(hashlib.sha256((token or "").encode()).hexdigest(), self.api_token_sha256)
        return ok_user and ok_tok
