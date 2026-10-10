"""HTTP API (what the WMS app calls). HTTP Basic auth: API user + API token (Fusion SQL › Setups › Data pipeline setups).

GET  /health                          status, version, time, running, queued, engine mode
GET  /public-key                      RSA public key (SPKI PEM) the app encrypts connection passwords with
POST /connections/test   {conn_id}    tries the connection from this server
POST /pipelines/{id}/run {params, requested_by}  → {run_id, status}
POST /pipelines/{id}/preview {task_id, limit}    → first rows of the task's source SQL
POST /runs/{id}/cancel                cancel at the next page
POST /runs/{id}/kill                  stop the worker process now
GET  /runs?limit=&pipeline_id=        recent runs
GET  /runs/{id}                       run + task runs + live progress + last log lines
POST /reload                          re-read definitions now
GET  /engine                          the live snapshot (what the console shows)
POST /engine/{action}                 pause | resume | drain | stop | start
"""
from __future__ import annotations

import base64
import time

from fastapi import Body, Depends, FastAPI, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from . import VERSION, secrets_store
from .connectors import QuerySpec, test_connection
from .runner import make_source
from .sqlutil import check_read_only, substitute_params

security = HTTPBasic(auto_error=False)


def create_api(sup, cfg) -> FastAPI:
    app = FastAPI(title="Gray's WMS pipeline server", version=VERSION, docs_url="/docs", redoc_url=None)

    def auth(request: Request, creds: HTTPBasicCredentials | None = Depends(security)):
        if creds and cfg.check_token(creds.username, creds.password):
            return creds.username
        bearer = request.headers.get("authorization", "")
        if bearer.lower().startswith("bearer ") and cfg.check_token(cfg.api_user, bearer[7:].strip()):
            return cfg.api_user
        raise HTTPException(status_code=401, detail="API user / token not accepted", headers={"WWW-Authenticate": "Basic"})

    @app.get("/", include_in_schema=False)
    def root():
        return RedirectResponse("/ui/")

    @app.get("/health")
    def health(user: str = Depends(auth)):
        return {"status": "ok", "version": VERSION, "time": time.strftime("%Y-%m-%dT%H:%M:%S"), "timezone": sup.server.get("timezone") or cfg.timezone,
                "server": cfg.server_name, "server_id": sup.server.get("id"), "engine": sup.mode, "running": len(sup.workers),
                "control": cfg.control.driver, "last_error": sup.last_error}

    @app.get("/public-key")
    def public_key(user: str = Depends(auth)):
        return {"public_key": secrets_store.public_key(), "fingerprint": secrets_store.fingerprint(), "algorithm": "RSA-OAEP SHA-256"}

    @app.post("/connections/test")
    def conn_test(body: dict = Body(default={}), user: str = Depends(auth)):
        conn = sup.store.connection(int(body.get("conn_id") or 0))
        if not conn:
            raise HTTPException(404, "Connection not found")
        t0 = time.monotonic()
        ok, msg = test_connection(conn, cfg.control.app_user)
        try:
            sup.store.set_connection_test(conn["id"], ok, msg)
        except Exception:  # noqa: BLE001
            pass
        return {"ok": ok, "message": msg, "latency_ms": int((time.monotonic() - t0) * 1000)}

    @app.post("/pipelines/{pid}/run")
    def run(pid: int, body: dict = Body(default={}), user: str = Depends(auth)):
        if not sup.store.pipeline(pid):
            raise HTTPException(404, "Pipeline not found")
        rid = sup.run_now(pid, body.get("params") or {}, body.get("requested_by") or user, "MANUAL")
        return {"run_id": rid, "status": "QUEUED", "engine": sup.mode,
                "note": None if sup.mode == "RUNNING" else f"The engine is {sup.mode.lower()} - the run starts when it runs again"}

    @app.post("/pipelines/{pid}/preview")
    def preview(pid: int, body: dict = Body(default={}), user: str = Depends(auth)):
        tasks = {t["id"]: t for t in sup.store.tasks(pid)}
        task = tasks.get(int(body.get("task_id") or 0)) or next(iter(tasks.values()), None)
        if not task:
            raise HTTPException(404, "Task not found")
        pipe = sup.store.pipeline(pid) or {}
        params = dict(pipe.get("params") or {}, **(body.get("params") or {}))
        sql = substitute_params(task["sql"], params)
        err = check_read_only(sql)
        if err:
            raise HTTPException(400, err)
        src = make_source(cfg, sup.store, task, params)
        try:
            limit = max(1, min(int(body.get("limit") or 20), 200))
            rows = next(src.pages(QuerySpec(sql=sql, page=limit, cap=limit, keys=task.get("keys") or []), limit), [])
        finally:
            src.close()
        cols = list(rows[0].keys()) if rows else []
        return {"columns": cols, "rows": rows[:limit]}

    @app.post("/runs/{rid}/cancel")
    def cancel(rid: int, user: str = Depends(auth)):
        sup.cancel(rid, user)
        return {"ok": True, "status": "CANCEL_REQUESTED"}

    @app.post("/runs/{rid}/kill")
    def kill(rid: int, user: str = Depends(auth)):
        return {"ok": sup.kill(rid, user)}

    @app.get("/runs")
    def runs(limit: int = 50, pipeline_id: int | None = None, user: str = Depends(auth)):
        return {"runs": sup.store.recent_runs(min(limit, 500), pipeline_id)}

    @app.get("/runs/{rid}")
    def run_detail(rid: int, user: str = Depends(auth)):
        r = sup.store.run(rid)
        if not r:
            raise HTTPException(404, "Run not found")
        w = sup.workers.get(rid)
        return {"run": r, "tasks": sup.store.task_runs(rid), "live": w.view() if w else None, "log": sup.store.logs(rid, 0, 200)}

    @app.post("/reload")
    def reload(user: str = Depends(auth)):
        sup.kick()
        return {"ok": True}

    @app.get("/engine")
    def engine(user: str = Depends(auth)):
        return sup.snapshot()

    @app.post("/engine/{action}")
    def engine_action(action: str, user: str = Depends(auth)):
        m = {"pause": "PAUSED", "resume": "RUNNING", "start": "RUNNING", "drain": "DRAIN", "stop": "STOP_NOW"}.get(action.lower())
        if not m:
            raise HTTPException(400, "action must be pause, resume, start, drain or stop")
        sup.set_mode(m, user)
        return {"ok": True, "engine": sup.mode}

    _ = base64
    return app
