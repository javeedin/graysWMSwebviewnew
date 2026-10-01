"""HTTP API (Bearer token). The WMS app relays to it through the host action hubApi - the page never holds the token
or a cloud key; keys go in once (PUT …/secret) and stay in the Windows Credential Manager."""
from __future__ import annotations

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel

from . import VERSION, secrets
from .agents.pipeline_doctor import Doctor
from .config import DATA_CLASSES, HubConfig, home
from .gateway import ChatRequest, Gateway, GatewayError
from .providers import ProviderError
from .usage import Usage

SECRET_NAMES = {"aws_access_key", "aws_secret_key", "api_key"}
PROVIDER_FIELDS = {"enabled", "region", "auth", "profile", "workspace_id", "models", "data_classes", "base_url", "label"}


class ChatIn(BaseModel):
    messages: list[dict]
    system: str = ""
    task: str = "default"
    provider: str | None = None
    model: str | None = None
    max_tokens: int = 2000
    data_class: str | None = None
    app_user: str | None = None
    fallback: bool = True


class CompareIn(ChatIn):
    targets: list[dict]


def create_api(cfg: HubConfig, usage: Usage | None = None, doctor_db: str | None = None) -> FastAPI:
    usage = usage or Usage()
    gw = Gateway(cfg, usage)
    doctor = Doctor(gw, doctor_db or str(home() / "agents.db"))
    app = FastAPI(title="Gray's WMS AI Hub", version=VERSION)
    app.state.gateway, app.state.doctor, app.state.cfg = gw, doctor, cfg

    def auth(request: Request):
        h = request.headers.get("authorization", "")
        if not (h.lower().startswith("bearer ") and cfg.check_token(h[7:].strip())):
            raise HTTPException(401, "AI Hub token not accepted")

    A = [Depends(auth)]

    @app.get("/health", dependencies=A)
    def health():
        return {"status": "ok", "version": VERSION, "month_cost": usage.month_cost(), "budget": cfg.budget_month_usd}

    @app.get("/config", dependencies=A)
    def get_config():
        return {**cfg.public(), "data_classes": DATA_CLASSES}

    @app.get("/providers", dependencies=A)
    def providers():
        out = gw.status()
        for p in out:
            p["secrets"] = {n: secrets.has_secret(f"{p['id']}.{n}") for n in SECRET_NAMES}
        return out

    @app.put("/providers/{pid}", dependencies=A)
    def put_provider(pid: str, body: dict):
        if pid not in cfg.providers:
            raise HTTPException(404, "No such provider")
        bad = set(body) - PROVIDER_FIELDS
        if bad:
            raise HTTPException(400, f"Unknown fields {sorted(bad)}")
        cfg.providers[pid].update(body)
        cfg.save()
        return {"ok": True, "provider": cfg.providers[pid]}

    @app.put("/providers/{pid}/secret", dependencies=A)
    def put_secret(pid: str, body: dict):
        if pid not in cfg.providers or body.get("name") not in SECRET_NAMES:
            raise HTTPException(400, "Unknown provider or secret name")
        secrets.set_secret(f"{pid}.{body['name']}", (body.get("value") or "").strip() or None)
        return {"ok": True, "saved": bool((body.get("value") or "").strip())}

    @app.post("/providers/{pid}/test", dependencies=A)
    def test_provider(pid: str):
        try:
            p = gw.provider(pid)
            ok, why = p.configured()
            if not ok:
                return {"ok": False, "error": why}
            return p.test()
        except ProviderError as e:
            return {"ok": False, "error": str(e)}
        except Exception as e:  # noqa: BLE001 - SDK / network errors go back to the page as text
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    @app.get("/providers/{pid}/models", dependencies=A)
    def discover(pid: str):
        try:
            return {"ok": True, "models": gw.provider(pid).list_models()}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    @app.put("/routes", dependencies=A)
    def put_routes(body: dict):
        if "routes" in body:
            cfg.routes = {k: [{"provider": c["provider"], "model": c.get("model", "")} for c in v] for k, v in body["routes"].items()}
        if "task_data_class" in body:
            cfg.task_data_class.update({k: v for k, v in body["task_data_class"].items() if v in DATA_CLASSES})
        if "prices" in body:
            cfg.prices = {k: [float(v[0]), float(v[1])] for k, v in body["prices"].items()}
        if "budget_month_usd" in body:
            cfg.budget_month_usd = float(body["budget_month_usd"])
        cfg.save()
        return {"ok": True, **cfg.public()}

    @app.post("/v1/chat", dependencies=A)
    def chat(body: ChatIn):
        try:
            return {"ok": True, **gw.chat(ChatRequest(**body.model_dump()))}
        except GatewayError as e:
            return {"ok": False, "error": str(e), "attempts": e.attempts}

    @app.post("/v1/route-preview", dependencies=A)
    def route_preview(body: ChatIn):
        use, skipped = gw.candidates(ChatRequest(**body.model_dump()))
        return {"use": use, "skipped": skipped}

    @app.post("/v1/compare", dependencies=A)
    def compare(body: CompareIn):
        d = body.model_dump()
        targets = d.pop("targets")[:6]
        return {"results": gw.compare(ChatRequest(**d), targets)}

    @app.get("/usage", dependencies=A)
    def get_usage(days: int = 30):
        return usage.summary(days)

    # ── Pipeline Doctor (LangGraph) ──
    @app.get("/agents/doctor/graph", dependencies=A)
    def doctor_graph():
        return doctor.graph_shape()

    @app.post("/agents/doctor/start", dependencies=A)
    def doctor_start(body: dict):
        try:
            return doctor.start(body.get("context") or {}, body.get("app_user"))
        except GatewayError as e:
            raise HTTPException(502, str(e)) from e

    @app.get("/agents/doctor/threads", dependencies=A)
    def doctor_threads(limit: int = 50):
        return doctor.list(limit)

    @app.get("/agents/doctor/{tid}", dependencies=A)
    def doctor_get(tid: str):
        try:
            return doctor.snapshot(tid)
        except KeyError as e:
            raise HTTPException(404, "No such thread") from e

    @app.post("/agents/doctor/{tid}/resume", dependencies=A)
    def doctor_resume(tid: str, body: dict):
        try:
            return doctor.resume(tid, body.get("value"))
        except KeyError as e:
            raise HTTPException(404, "No such thread") from e
        except ValueError as e:
            raise HTTPException(409, str(e)) from e
        except GatewayError as e:
            raise HTTPException(502, str(e)) from e

    return app
