"""HTTP API (Bearer token). The WMS app relays to it through the host action hubApi - the page never holds the token
or a cloud key; keys go in once (PUT …/secret) and stay in the Windows Credential Manager."""
from __future__ import annotations

import json
import time

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel

from . import VERSION, secrets
from . import voice as V
from .agents import catalog as AC
from .agents.assistant import AgentService
from .agents.jobs import JobRunner
from .agents.pipeline_doctor import Doctor
from .config import DATA_CLASSES, HubConfig, home
from .gateway import ChatRequest, Gateway, GatewayError
from .phone import PhoneError, PhoneManager
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


class AgentIn(BaseModel):
    text: str
    app_user: str | None = None
    specialist: str | None = None
    pod: str | None = None
    caps: list[str] | None = None
    model: dict | None = None
    thread_id: str | None = None
    attachments: list[dict] | None = None
    voice: str | None = None            # "app" = the answer is spoken (voice mode)
    trace: bool | None = None           # "Track tech": the hub reports what ran where


def create_api(cfg: HubConfig, usage: Usage | None = None, doctor_db: str | None = None, agent_home: str | None = None,
               run_jobs: bool = False) -> FastAPI:
    usage = usage or Usage()
    gw = Gateway(cfg, usage)
    doctor = Doctor(gw, doctor_db or str(home() / "agents.db"))
    agent = AgentService(gw, agent_home or str(home()))
    jobs = JobRunner(agent)
    if run_jobs:
        jobs.start()
    app = FastAPI(title="Gray's WMS AI Hub", version=VERSION)
    phone = PhoneManager(cfg, agent)
    app.state.gateway, app.state.doctor, app.state.cfg, app.state.agent, app.state.jobs = gw, doctor, cfg, agent, jobs
    app.state.phone = phone

    def auth(request: Request):
        h = request.headers.get("authorization", "")
        if not (h.lower().startswith("bearer ") and cfg.check_token(h[7:].strip())):
            raise HTTPException(401, "AI Hub token not accepted")

    A = [Depends(auth)]

    @app.get("/agent/tech", dependencies=A)
    def agent_tech():
        """The stack behind the AI Agent, with versions, for the Track tech popup."""
        import importlib.metadata as md
        import platform

        def ver(p):
            try:
                return md.version(p)
            except md.PackageNotFoundError:
                return None
        pkgs = ["langgraph", "langgraph-checkpoint-sqlite", "langchain-core", "anthropic", "boto3", "httpx", "fastapi", "uvicorn", "pydantic",
                "keyring", "faster-whisper", "piper-tts"]
        return {"hub": VERSION, "python": platform.python_version(), "packages": {p: ver(p) for p in pkgs},
                "providers": {k: {"type": v.get("type"), "enabled": v.get("enabled")} for k, v in cfg.providers.items()},
                "routes": {k: [c.get("provider") + "/" + (c.get("model") or "") for c in v] for k, v in cfg.routes.items()}}

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

    # ── AI Agent (LangGraph supervisor + specialists) ──
    # The relay sends the app login as X-App-User; a conversation is only visible to the user who started it.
    def who(request: Request, body_user: str | None = None) -> str | None:
        return request.headers.get("x-app-user") or body_user or None

    def guard(fn):
        try:
            return fn()
        except KeyError as e:
            raise HTTPException(404, "No such conversation") from e
        except PermissionError as e:
            raise HTTPException(403, str(e)) from e
        except ValueError as e:
            raise HTTPException(409, str(e)) from e

    @app.get("/agent/catalog", dependencies=A)
    def agent_catalog():
        return {"specialists": [{"id": x.id, "title": x.title, "icon": x.icon, "task": x.task} for x in AC.SPECIALISTS.values()],
                "tools": [t.public() for t in AC.TOOLS], "max_turns": AC.MAX_TURNS}

    @app.post("/agent/route-preview", dependencies=A)
    def agent_route(body: dict):
        sid, scores = AC.route(body.get("text") or "", body.get("current"))
        return {"specialist": sid, "scores": scores}

    @app.post("/agent/threads", dependencies=A)
    def agent_start(body: AgentIn, request: Request):
        return guard(lambda: agent.start(body.text, app_user=who(request, body.app_user), specialist=body.specialist,
                                         pod=body.pod or "PROD", caps=body.caps, model=body.model, thread_id=body.thread_id,
                                         attachments=body.attachments, voice="app" if body.voice == "app" else None,
                                         trace=bool(body.trace)))

    @app.get("/agent/threads", dependencies=A)
    def agent_list(request: Request, limit: int = 50):
        return agent.list(who(request), limit)

    @app.get("/agent/threads/{tid}", dependencies=A)
    def agent_get(tid: str, request: Request):
        return guard(lambda: agent.snapshot(tid, who(request)))

    @app.get("/agent/threads/{tid}/events", dependencies=A)
    def agent_events(tid: str, request: Request, after: int = 0):
        return guard(lambda: agent.events(tid, after, who(request)))

    @app.post("/agent/threads/{tid}/send", dependencies=A)
    def agent_send(tid: str, body: AgentIn, request: Request):
        return guard(lambda: agent.send(tid, body.text, who(request, body.app_user), body.specialist, body.caps, body.pod, body.model,
                                        body.attachments, voice="app" if body.voice == "app" else "" if body.voice == "off" else None,
                                        trace=body.trace))

    @app.post("/agent/threads/{tid}/resume", dependencies=A)
    def agent_resume(tid: str, body: dict, request: Request):
        return guard(lambda: agent.resume(tid, body.get("value"), who(request, body.get("app_user"))))

    @app.post("/agent/threads/{tid}/cancel", dependencies=A)
    def agent_cancel(tid: str, request: Request):
        return guard(lambda: agent.cancel(tid, who(request)))

    @app.post("/agent/threads/{tid}/delete", dependencies=A)
    def agent_delete(tid: str, request: Request):
        return guard(lambda: agent.delete(tid, who(request)))

    @app.post("/agent/threads/{tid}/feedback", dependencies=A)
    def agent_feedback(tid: str, body: dict, request: Request):
        return guard(lambda: agent.feedback(tid, int(body.get("seq") or 0), int(body.get("rating") or 0), body.get("note"), who(request)))

    @app.post("/agent/knowledge", dependencies=A)
    def agent_knowledge_set(body: dict):
        return agent.knowledge_set(body.get("text") or "", body.get("marker"))

    @app.get("/agent/knowledge", dependencies=A)
    def agent_knowledge_info():
        return agent.knowledge_info()

    @app.get("/agent/memory", dependencies=A)
    def agent_memory(request: Request):
        return agent.memory_list(who(request) or "")

    @app.post("/agent/memory/delete", dependencies=A)
    def agent_memory_delete(body: dict, request: Request):
        return agent.memory_delete(who(request) or "", int(body.get("id") or 0))

    @app.get("/agent/jobs", dependencies=A)
    def agent_jobs(request: Request):
        return agent.jobs_list(who(request))

    @app.put("/agent/jobs/{jid}", dependencies=A)
    def agent_job_put(jid: str, body: dict, request: Request):
        u = who(request)
        j = agent.store.one("SELECT * FROM jobs WHERE id = ?", (jid,))
        if not j or (u and j["app_user"] != u):
            raise HTTPException(404, "No such job")
        if "enabled" in body:
            agent.store.run("UPDATE jobs SET enabled = ? WHERE id = ?", (1 if body["enabled"] else 0, jid))
        if body.get("delete"):
            agent.store.run("DELETE FROM jobs WHERE id = ?", (jid,))
        if body.get("run_now"):
            agent.store.run("UPDATE jobs SET next_run = 0 WHERE id = ?", (jid,))
            jobs.run_due()
        return {"ok": True}

    @app.post("/agent/evals/run", dependencies=A)
    def agent_evals_run(body: dict, request: Request):
        from .agents import evals as AE
        r = AE.run(gw, body.get("provider") or None, body.get("model") or None, body.get("include_model_only"), body.get("only"))
        agent.store.run("INSERT INTO eval_runs (ts, app_user, provider, model, total, passed, route_acc, trajectory_acc, safety_ok, cost, ms, detail) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (time.time(), who(request, body.get("app_user")), r["provider"], r["model"], r["total"], r["passed"],
                                                         r["route_acc"], r["trajectory_acc"], 1 if r["safety_ok"] else 0, r["cost"], r["ms"], json.dumps(r["cases"])))
        return r

    @app.get("/agent/evals", dependencies=A)
    def agent_evals(limit: int = 20):
        return agent.store.all("SELECT id, ts, app_user, provider, model, total, passed, route_acc, trajectory_acc, safety_ok, cost, ms "
                               "FROM eval_runs ORDER BY id DESC LIMIT ?", (limit,))

    @app.get("/agent/evals/{rid}", dependencies=A)
    def agent_eval_get(rid: int):
        r = agent.store.one("SELECT * FROM eval_runs WHERE id = ?", (rid,))
        if not r:
            raise HTTPException(404, "No such eval run")
        r["cases"] = json.loads(r.pop("detail") or "[]")
        return r

    @app.get("/agent/jobs/pending", dependencies=A)
    def agent_jobs_pending(request: Request):
        """Job conversations waiting for the app (read tools the page can run unattended, or a person)."""
        u = who(request)
        rows = agent.store.all("SELECT id FROM threads WHERE status = 'waiting' AND job_id IS NOT NULL" +
                               (" AND app_user = ?" if u else "") + " ORDER BY updated LIMIT 20", (u,) if u else ())
        return [agent.snapshot(r["id"]) for r in rows]

    # ── voice (AI Agent voice mode) ──
    def vguard(fn):
        try:
            return fn()
        except (V.VoiceError, PhoneError) as e:
            raise HTTPException(400, str(e)) from e
        except KeyError as e:
            raise HTTPException(404, "Not found") from e
        except Exception as e:  # noqa: BLE001 - provider SDK errors → readable message
            raise HTTPException(502, f"{type(e).__name__}: {e}") from e

    @app.get("/voice/config", dependencies=A)
    def voice_config():
        return V.status(cfg)

    @app.put("/voice/config", dependencies=A)
    def voice_put(body: dict):
        v = body.get("voice") or {}
        for part in ("tts", "stt"):
            if isinstance(v.get(part), dict):
                cfg.voice[part].update({k: x for k, x in v[part].items() if k in ("provider", "voice", "model", "engine", "speed", "language", "whisper_size")})
        for k in ("azure_region", "aws_provider", "language", "gender"):
            if isinstance(v.get(k), str):
                cfg.voice[k] = v[k]
        if isinstance(v.get("tts"), dict) and "voice" in v["tts"]:
            cfg.voice["tts"]["voice_provider"] = cfg.voice["tts"].get("provider")   # an explicit voice belongs to its provider
        cfg.save()
        return V.status(cfg)

    @app.put("/voice/secret", dependencies=A)
    def voice_secret(body: dict):
        name = body.get("name")
        if name not in V.SECRET_NAMES:
            raise HTTPException(400, "Unknown key name")
        secrets.set_secret(name, body.get("value") or None)
        return {"ok": True, "set": bool(body.get("value"))}

    @app.get("/voice/voices", dependencies=A)
    def voice_voices(provider: str):
        return vguard(lambda: V.voices(cfg, provider))

    @app.post("/voice/tts", dependencies=A)
    def voice_tts(body: dict):
        return vguard(lambda: V.tts(cfg, body.get("text") or "", body.get("provider"), body.get("voice")))

    @app.post("/voice/piper/install", dependencies=A)
    def voice_piper_install():
        return V.piper_install(cfg)

    @app.get("/voice/piper", dependencies=A)
    def voice_piper():
        return V.piper_status(cfg)

    @app.get("/voice/whisper", dependencies=A)
    def voice_whisper():
        return V.whisper_status()

    @app.post("/voice/whisper/install", dependencies=A)
    def voice_whisper_install():
        return V.whisper_install(cfg)

    @app.post("/voice/stt", dependencies=A)
    def voice_stt(body: dict):
        return vguard(lambda: V.stt(cfg, body.get("audio_b64") or "", body.get("mime") or "audio/wav", body.get("language"), body.get("provider")))

    # ── phone (Twilio) ──
    @app.get("/voice/phone", dependencies=A)
    def phone_status():
        return phone.status()

    @app.put("/voice/phone", dependencies=A)
    def phone_put(body: dict):
        p = body.get("phone") or {}
        for k in ("enabled", "public_url", "account_sid", "from_number", "inbound", "allowed_prefixes", "max_minutes", "language",
                  "tts_provider", "voice", "company", "port"):
            if k in p:
                cfg.phone[k] = p[k]
        if cfg.phone.get("inbound") not in ("off", "known", "everyone"):
            cfg.phone["inbound"] = "known"
        cfg.save()
        return phone.status()

    @app.post("/voice/phone/known", dependencies=A)
    def phone_known(body: dict):
        return vguard(lambda: phone.set_known(body.get("number"), body.get("user"), body.get("pin")))

    @app.post("/voice/phone/connect-number", dependencies=A)
    def phone_connect():
        return vguard(phone.connect_number)

    @app.post("/voice/call", dependencies=A)
    def phone_call(body: dict, request: Request):
        return vguard(lambda: phone.place_call(body.get("to"), body.get("goal"), body.get("name"), who(request, body.get("app_user")),
                                               body.get("language")))

    @app.get("/voice/calls", dependencies=A)
    def phone_calls(request: Request, limit: int = 50):
        return phone.list(who(request), limit)

    @app.get("/voice/calls/pending", dependencies=A)
    def phone_pending(request: Request):
        return phone.pending(who(request))

    @app.get("/voice/calls/{cid}", dependencies=A)
    def phone_call_get(cid: str):
        return vguard(lambda: phone.get(cid) | {"k": None})

    @app.post("/voice/calls/{cid}/hangup", dependencies=A)
    def phone_hangup(cid: str):
        return vguard(lambda: phone.hangup(cid))

    return app
