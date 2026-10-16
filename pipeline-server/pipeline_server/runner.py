"""Executes one pipeline run: tasks in order, page by page, with watermarks, cancel and continuous cycles.

Runs inside a worker process (worker_mode = process, the default - a stuck run can be killed) or a thread.
Progress and log lines go to the supervisor through `ctx.emit` (live console) and to WMS_PIPE_LOG / _RUNS /
_TASK_RUNS (the WMS app). The watermark is saved after every page that was written, so a run that stops
half-way continues from there next time.
"""
from __future__ import annotations

import os
import re
import time
import traceback
from dataclasses import dataclass, field
from typing import Callable

from . import secrets_store
from .config import ServerConfig
from .connectors import INTERNAL, WM, DbSource, DemoSource, FusionSource, LoadError, QuerySpec, open_db, open_target, plan_columns
from .db import OracleDb, OrdsGatewayDb
from .fusion import FusionRunner, columns_of
from .sqlutil import check_read_only, substitute_params


class Cancelled(Exception):
    pass


DATE_LIKE = re.compile(r"(DATE|TIME|STAMP|_ON$|_AT$|_DT$)", re.I)


@dataclass
class RunContext:
    cfg: ServerConfig
    store: object
    server_id: int
    emit: Callable[[dict], None] = lambda e: None
    cancel_requested: Callable[[], bool] = lambda: False
    _logs: list = field(default_factory=list)
    _last_flush: float = field(default_factory=time.monotonic)
    _cancel_checked: float = 0.0

    def log(self, run_id, tr_id, level, msg):
        self._logs.append((run_id, tr_id, level, msg, time.monotonic()))
        self.emit({"type": "log", "run_id": run_id, "task_run_id": tr_id, "level": level, "message": msg, "time": time.strftime("%H:%M:%S")})
        if level == "ERROR" or len(self._logs) >= 30 or time.monotonic() - self._last_flush > 3:
            self.flush()

    def flush(self):
        if not self._logs:
            return
        now = time.monotonic()
        batch, self._logs = self._logs, []
        try:
            self.store.add_logs([(r, t, l, m, now - at) for r, t, l, m, at in batch])
        except Exception as e:  # noqa: BLE001 - logging must never stop a load
            self.emit({"type": "log", "level": "WARN", "message": f"Could not write log lines to APEX: {e}"})
        self._last_flush = now

    def check_cancel(self, run_id, force=False):
        if self.cancel_requested():
            raise Cancelled()
        if force or time.monotonic() - self._cancel_checked > 5:
            self._cancel_checked = time.monotonic()
            try:
                if self.store.cancel_flags([run_id]).get(run_id):
                    raise Cancelled()
            except Cancelled:
                raise
            except Exception:  # noqa: BLE001 - a DB hiccup must not cancel the run
                pass


def fusion_runner(cfg: ServerConfig, pod: str) -> FusionRunner:
    pod = (pod or cfg.fusion.default_pod or "PROD").upper()
    origin = cfg.fusion.pods.get(pod)
    if not origin:
        raise LoadError(f"Unknown Fusion pod {pod!r} (server settings know: {', '.join(cfg.fusion.pods)})")
    return FusionRunner(origin, cfg.fusion.username, secrets_store.get_secret("fusion") or "", cfg.fusion.report_path,
                        cfg.fusion.report_service_path, cfg.fusion.timeout_s, cfg.fusion.retries)


def control_db(cfg: ServerConfig):
    c = cfg.control
    if c.driver == "oracle":
        return OracleDb(c.dsn, c.user, secrets_store.get_secret("control-db") or "", c.wallet_dir or None, secrets_store.get_secret("control-wallet"))
    return OrdsGatewayDb(c.ords_ai_base, c.app_user, c.timeout_s)


def make_source(cfg: ServerConfig, store, task: dict, params: dict):
    st = task["source_type"]
    if cfg.control.driver == "memory" and st in ("FUSION", "APEX"):
        return DemoSource(seed=task["id"])
    if st == "FUSION":
        return FusionSource(fusion_runner(cfg, params.get("FUSION_POD") or params.get("P_FUSION_POD") or ""))
    if st == "APEX":
        return DbSource(control_db(cfg))
    conn = store.connection(task["source_conn_id"]) if task.get("source_conn_id") else None
    if not conn:
        raise LoadError(f"Task {task['name']}: the source connection #{task.get('source_conn_id')} was not found.")
    db = open_db(conn, cfg.control.app_user)
    if db is None:
        raise LoadError(f"Connection {conn['name']} is a REST endpoint - it can only be a target.")
    return DbSource(db)


def _wm_type(task: dict, params: dict) -> str:
    t = str(params.get("WM_TYPE") or "").upper()
    if t in ("DATE", "NUMBER"):
        return t
    if task.get("watermark") and re.fullmatch(r"-?\d+(\.\d+)?", task["watermark"]):
        return "NUMBER"
    return "DATE" if DATE_LIKE.search(task.get("wm_col") or "") else "NUMBER"


def run_task(ctx: RunContext, run: dict, task: dict, params: dict, cycle: int) -> tuple[int, int]:
    store, cfg, run_id = ctx.store, ctx.cfg, run["id"]
    mode = task["mode"]
    keys = task.get("keys") or []
    incremental = mode == "INCREMENTAL"
    problem = ("An INCREMENTAL task needs its watermark column (e.g. LAST_UPDATE_DATE)." if incremental and not task.get("wm_col")
               else "A MERGE task needs its key columns." if mode == "MERGE" and not keys else None)
    if problem is None:
        problem = check_read_only(substitute_params(task["sql"], params))
    if problem:                                   # recorded against the task so the app shows where it failed
        tr_id = store.create_task_run(run_id, task["id"], cycle, None)
        store.set_task_run(tr_id, status="FAILED", ended=True, error=problem)
        ctx.log(run_id, tr_id, "ERROR", f"Task {task['name']} failed: {problem}")
        raise LoadError(problem)
    write_mode = "MERGE" if (mode == "MERGE" or (incremental and keys)) else ("TRUNCATE_INSERT" if mode == "TRUNCATE_INSERT" else "APPEND")

    sql = substitute_params(task["sql"], params)
    wm_type = _wm_type(task, params)
    overlap = 0
    if incremental and keys and wm_type == "DATE":
        overlap = int(float(params.get("WM_OVERLAP_MIN", 5)) * 60)
    spec = QuerySpec(sql=sql, wm_col=task["wm_col"] if incremental else "", wm_type=wm_type, wm_value=task.get("watermark") if incremental else "",
                     wm_op=">=" if (incremental and keys) else ">", overlap_s=overlap, keys=keys,
                     page=int(task.get("batch") or cfg.page_size), cap=task.get("row_limit"))
    tr_id = store.create_task_run(run_id, task["id"], cycle, task.get("watermark") if incremental else None)
    tlog = lambda lvl, m: ctx.log(run_id, tr_id, lvl, m)  # noqa: E731
    tlog("INFO", f"Task {task['name']}: {mode}" + (f" by {task['wm_col']} from {task.get('watermark') or 'the beginning'}" if incremental else "") +
         f" → {task['target']} (page {spec.page:,})")

    conn = store.connection(task["target_conn_id"]) if task.get("target_conn_id") else None
    if not conn:
        raise LoadError(f"Task {task['name']}: the target connection #{task.get('target_conn_id')} was not found.")
    source = make_source(cfg, store, task, params)
    target = open_target(conn, cfg.control.app_user)
    t0, read, written, wm, pages, prepared = time.monotonic(), 0, 0, task.get("watermark") or "", 0, False
    try:
        for rows in source.pages(spec, cfg.full_load_cap):
            ctx.check_cancel(run_id)
            pages += 1
            if not rows:
                break
            if not prepared:
                cols = [c for c in columns_of(rows) if c not in INTERNAL]
                plan = plan_columns(rows, cols, task.get("column_map") or {})
                target.prepare(task["target"], plan, keys, write_mode, task.get("create_target", True), tlog)
                prepared = True
            n = target.write(rows, write_mode)
            read += len(rows)
            written += n
            if incremental and rows[-1].get(WM):
                wm = str(rows[-1][WM])
                store.set_watermark(task["id"], wm)
            store.set_task_run(tr_id, rows_read=read, rows_written=written, wm_to=wm if incremental else None)
            rate = read / max(0.001, time.monotonic() - t0)
            ctx.emit({"type": "progress", "run_id": run_id, "task_run_id": tr_id, "task": task["name"], "rows_read": read, "rows_written": written,
                      "pages": pages, "rate": rate, "watermark": wm})
            tlog("INFO", f"Page {pages}: {len(rows):,} rows read, {n:,} written ({rate:,.0f} rows/s)" + (f", watermark {wm}" if incremental else ""))
            if time.monotonic() - t0 > int(task.get("timeout") or 900):
                raise LoadError(f"Task timed out after {int(task.get('timeout') or 900)} s ({read:,} rows loaded - an incremental task continues from here next run).")
        if not prepared:
            tlog("INFO", "No new rows" if incremental else "The source returned no rows - the target was left unchanged")
        elif not spec.wm_col and not keys and not spec.cap and read >= cfg.full_load_cap:
            tlog("WARN", f"Read stopped at {cfg.full_load_cap:,} rows: add key columns to the task so the load can page through everything.")
        store.set_task_run(tr_id, status="SUCCESS", rows_read=read, rows_written=written, wm_to=wm if incremental else None, ended=True)
        tlog("INFO", f"Task {task['name']} done: {read:,} read, {written:,} written in {time.monotonic() - t0:,.1f} s")
        return read, written
    except Cancelled:
        store.set_task_run(tr_id, status="CANCELLED", rows_read=read, rows_written=written, ended=True, error="Cancelled")
        tlog("WARN", f"Task {task['name']} cancelled after {read:,} rows")
        raise
    except Exception as e:
        msg = str(e) or e.__class__.__name__
        store.set_task_run(tr_id, status="FAILED", rows_read=read, rows_written=written, ended=True, error=msg[:3900])
        tlog("ERROR", f"Task {task['name']} failed: {msg}")
        raise
    finally:
        for c in (source, target):
            try:
                c.close()
            except Exception:  # noqa: BLE001
                pass


def execute_run(ctx: RunContext, run_id: int) -> str:
    store = ctx.store
    run = store.run(run_id)
    pipe = store.pipeline(run["pipeline_id"])
    tasks = [t for t in store.tasks(pipe["id"]) if t.get("active", True)]
    params = dict(pipe.get("params") or {})
    params.update(run.get("params") or {})
    start_at = params.pop("_START_TASK", None)
    log = lambda lvl, m: ctx.log(run_id, None, lvl, m)  # noqa: E731
    store.set_pipeline(pipe["id"], state="RUNNING", last_run_id=run_id)
    cycle = run.get("cycle") or 1
    total_read = total_written = 0
    status, error = "SUCCESS", None
    log("INFO", f"Run #{run_id} of '{pipe['name']}' started ({run.get('trigger') or 'MANUAL'}"
               f"{', by ' + run['by'] if run.get('by') else ''}) — {len(tasks)} task(s), server pid {os.getpid()}")
    ctx.emit({"type": "started", "run_id": run_id, "pipeline_id": pipe["id"], "pipeline": pipe["name"], "tasks": [t["name"] for t in tasks]})
    try:
        if not tasks:
            raise LoadError("The pipeline has no active tasks.")
        while True:
            done: dict[int, str] = {}
            skipping = bool(start_at)
            for t in tasks:
                if skipping:
                    if str(t["id"]) == str(start_at):
                        skipping = False
                    else:
                        done[t["id"]] = "SUCCESS"
                        continue
                ctx.check_cancel(run_id, force=True)
                waits = [d for d in t.get("depends_on") or [] if done.get(d) != "SUCCESS"]
                if waits:
                    done[t["id"]] = "SKIPPED"
                    log("WARN", f"Task {t['name']} skipped: it depends on task(s) {', '.join(map(str, waits))} which did not succeed")
                    continue
                try:
                    r, w = run_task(ctx, {"id": run_id}, t, params, cycle)
                    done[t["id"]] = "SUCCESS"
                    total_read += r
                    total_written += w
                    store.set_run(run_id, rows_read=total_read, rows_written=total_written)
                except Cancelled:
                    raise
                except Exception as e:  # noqa: BLE001 - one task's failure is reported, the pipeline decides
                    done[t["id"]] = "FAILED"
                    error = f"{t['name']}: {e}"
                    if pipe.get("on_error") != "CONTINUE":
                        raise
            if any(v == "FAILED" for v in done.values()):
                status = "FAILED"
            start_at = None
            if pipe.get("schedule") != "CONTINUOUS" or status == "FAILED":
                break
            pause = int(pipe.get("interval") or 60)
            log("INFO", f"Cycle {cycle} done — next cycle in {pause} s (continuous until cancelled)")
            ctx.emit({"type": "cycle", "run_id": run_id, "cycle": cycle, "pause": pause})
            ctx.flush()
            end = time.monotonic() + pause
            while time.monotonic() < end:
                ctx.check_cancel(run_id, force=True)
                time.sleep(min(2, max(0.1, end - time.monotonic())))
            cycle += 1
            store.set_run(run_id, cycle=cycle)
            pipe = store.pipeline(pipe["id"]) or pipe              # picks up edits / switch-off between cycles
            if not pipe.get("enabled", True) and pipe.get("schedule") == "CONTINUOUS":
                log("INFO", "The pipeline was switched off — stopping after this cycle")
                break
            tasks = [t for t in store.tasks(pipe["id"]) if t.get("active", True)]
    except Cancelled:
        status, error = "CANCELLED", "Cancelled"
        log("WARN", "Run cancelled")
    except Exception as e:  # noqa: BLE001
        status = "FAILED"
        error = error or str(e) or e.__class__.__name__
        log("ERROR", f"Run failed: {error}")
        if os.environ.get("PIPELINE_DEBUG"):
            log("ERROR", traceback.format_exc()[-3000:])
    store.set_run(run_id, status=status, ended=True, rows_read=total_read, rows_written=total_written, error=error if status != "SUCCESS" else None)
    store.set_pipeline(pipe["id"], state="IDLE", last_status=status, last_run_id=run_id)
    log("INFO" if status == "SUCCESS" else "WARN", f"Run #{run_id} {status.lower()} — {total_read:,} rows read, {total_written:,} written")
    ctx.flush()
    ctx.emit({"type": "done", "run_id": run_id, "status": status, "error": error, "rows_read": total_read, "rows_written": total_written})
    return status


# ── worker process entry (worker_mode = process) ─────────────
def worker_main(run_id: int, server_id: int, events, cancel_event):
    """Runs in a separate process (spawn on Windows): builds its own config / store / clients."""
    from .factory import build_store
    cfg = ServerConfig.load()
    store = build_store(cfg)

    def emit(e):
        try:
            events.put(e)
        except Exception:  # noqa: BLE001
            pass
    ctx = RunContext(cfg, store, server_id, emit=emit, cancel_requested=cancel_event.is_set)
    try:
        execute_run(ctx, run_id)
    except Exception as e:  # noqa: BLE001 - last resort: never leave a run RUNNING
        try:
            store.set_run(run_id, status="FAILED", ended=True, error=f"Worker crashed: {e}")
        except Exception:
            pass
        emit({"type": "done", "run_id": run_id, "status": "FAILED", "error": str(e)})
