"""The supervisor: schedules pipelines, claims queued runs, starts worker processes and keeps the live picture
the console and the API show.

Engine modes
  RUNNING   schedules fire, queued runs start
  PAUSED    nothing new starts; running runs finish
  DRAINING  like PAUSED, then STOPPED once nothing is running
  STOPPED   nothing runs (Start brings it back)
The supervisor itself stays up (Windows service / console); only the engine is started and stopped.
"""
from __future__ import annotations

import collections
import datetime as dt
import multiprocessing as mp
import queue
import threading
import time
from dataclasses import dataclass, field
from zoneinfo import ZoneInfo

from . import VERSION, secrets_store
from .config import ServerConfig
from .runner import RunContext, execute_run, worker_main


@dataclass
class Worker:
    run_id: int
    pipeline_id: int
    pipeline: str
    trigger: str
    started: float = field(default_factory=time.time)
    proc: object = None
    thread: object = None
    cancel: object = None
    status: str = "RUNNING"
    task: str = ""
    rows_read: int = 0
    rows_written: int = 0
    pages: int = 0
    rate: float = 0.0
    watermark: str = ""
    cycle: int = 1
    tasks: list = field(default_factory=list)
    task_state: dict = field(default_factory=dict)       # task name -> RUNNING / SUCCESS / FAILED / CANCELLED
    log: collections.deque = field(default_factory=lambda: collections.deque(maxlen=400))
    ended: float | None = None
    error: str | None = None

    def view(self) -> dict:
        return {"run_id": self.run_id, "pipeline_id": self.pipeline_id, "pipeline": self.pipeline, "trigger": self.trigger, "status": self.status,
                "task": self.task, "rows_read": self.rows_read, "rows_written": self.rows_written, "pages": self.pages, "rate": round(self.rate),
                "watermark": self.watermark, "cycle": self.cycle, "tasks": self.tasks, "task_state": dict(self.task_state),
                "elapsed": round((self.ended or time.time()) - self.started), "error": self.error,
                "pid": getattr(self.proc, "pid", None)}


class Supervisor:
    def __init__(self, cfg: ServerConfig, store):
        self.cfg, self.store = cfg, store
        self.mode = "STOPPED"
        self.server: dict = {}
        self.workers: dict[int, Worker] = {}
        self.finished: collections.deque = collections.deque(maxlen=30)
        self.events: collections.deque = collections.deque(maxlen=300)       # activity feed for the console
        self.pipelines: list[dict] = []
        self.next_fire: dict[int, float] = {}
        self.started_at = time.time()
        self.last_refresh = 0.0
        self.last_error: str | None = None
        self._kick = threading.Event()
        self._stop = threading.Event()
        self._lock = threading.RLock()
        self.thread_mode = cfg.worker_mode != "process" or cfg.control.driver == "memory"
        self._mp = mp.get_context("spawn")
        self.queue = queue.Queue() if self.thread_mode else self._mp.Queue()
        self.listeners: list = []                  # console callbacks on every event

    # ── lifecycle ──
    def start_service(self):
        """Called once when the server starts."""
        try:
            did = self.store.prepare()
            for d in did or []:
                self.note("INFO", f"Control tables: {d}")
        except Exception as e:  # noqa: BLE001
            self.note("ERROR", f"Could not prepare the control tables: {e}")
        self._register()
        try:
            for rid in self.store.requeue_interrupted(self.server["id"]):
                self.note("WARN", f"Run #{rid} was interrupted when the server stopped - queued again (it resumes from its last watermark)")
        except Exception as e:  # noqa: BLE001
            self.note("ERROR", f"Could not check interrupted runs: {e}")
        self.mode = "RUNNING"
        self.note("INFO", f"Pipeline server {self.cfg.server_name} v{VERSION} started ({'threads' if self.thread_mode else 'worker processes'})")
        threading.Thread(target=self._loop, name="scheduler", daemon=True).start()

    def _register(self):
        while not self._stop.is_set():
            try:
                import socket
                self.server = self.store.register_server(self.cfg.server_name, self.cfg.host if self.cfg.host != "0.0.0.0" else socket.gethostname(),
                                                         self.cfg.port, self.cfg.api_user, self.cfg.timezone, VERSION)
                self.note("INFO", f"Registered as server #{self.server['id']} in WMS_PIPE_SERVERS")
                try:
                    self.store.heartbeat(self.server["id"], "ONLINE", VERSION, "starting", secrets_store.public_key(), secrets_store.fingerprint())
                except Exception as e:  # noqa: BLE001
                    self.note("WARN", f"Could not publish the public key: {e}")
                return
            except Exception as e:  # noqa: BLE001 - keep trying: the database may come later
                self.last_error = str(e)
                self.note("ERROR", f"Cannot reach the control database ({e}) - retrying in 30 s")
                self._stop.wait(30)

    def shutdown(self):
        self._stop.set()
        try:
            self.store.heartbeat(self.server.get("id"), "OFFLINE", VERSION, "server stopped")
        except Exception:  # noqa: BLE001
            pass

    # ── engine controls ──
    def set_mode(self, mode: str, by: str = "console"):
        with self._lock:
            old = self.mode
            if mode == "STOP_NOW":
                self.mode = "STOPPED"
                for w in list(self.workers.values()):
                    self.cancel(w.run_id, by)
            elif mode == "DRAIN":
                self.mode = "DRAINING" if self.workers else "STOPPED"
            elif mode in ("RUNNING", "PAUSED", "STOPPED"):
                self.mode = mode
            self.note("INFO", f"Engine {old} → {self.mode} ({by})")
        self.kick()

    def kick(self):
        self._kick.set()

    def cancel(self, run_id: int, by: str = "console"):
        try:
            self.store.request_cancel(run_id)
        except Exception as e:  # noqa: BLE001
            self.note("ERROR", f"Could not flag run #{run_id} as cancelled: {e}")
        w = self.workers.get(run_id)
        if w and w.cancel is not None:
            w.cancel.set()
            w.status = "CANCELLING"
        self.note("WARN", f"Cancel requested for run #{run_id} by {by}")

    def kill(self, run_id: int, by: str = "console") -> bool:
        w = self.workers.get(run_id)
        if not w:
            return False
        if w.proc is not None:
            w.proc.terminate()
            w.proc.join(5)
            self._finish(w, "CANCELLED", f"Killed by {by}")
            try:
                self.store.set_run(run_id, status="CANCELLED", ended=True, error=f"Killed by {by}")
                self.store.set_pipeline(w.pipeline_id, state="IDLE", last_status="CANCELLED", last_run_id=run_id)
            except Exception:  # noqa: BLE001
                pass
            self.note("WARN", f"Run #{run_id} killed by {by}")
            return True
        self.cancel(run_id, by)          # threads cannot be killed - cancel at the next page
        return True

    def run_now(self, pipeline_id: int, params: dict | None = None, by: str = "console", trigger: str = "MANUAL") -> int:
        rid = self.store.create_run(pipeline_id, self.server["id"], trigger, by, params or {})
        self.note("INFO", f"Run #{rid} queued for pipeline #{pipeline_id} ({trigger.lower()}, {by})")
        self.kick()
        return rid

    # ── scheduler loop ──
    def _loop(self):
        while not self._stop.is_set():
            try:
                self._drain_events()
                self._reap()
                poll = max(5, int(self.server.get("poll_seconds") or self.cfg.poll_seconds or 30))
                if self._kick.is_set() or time.time() - self.last_refresh >= poll:
                    self._kick.clear()
                    self._refresh()
            except Exception as e:  # noqa: BLE001 - the loop must survive anything
                self.last_error = str(e)
                self.note("ERROR", f"Scheduler: {e}")
                time.sleep(5)
            self._kick.wait(1)

    def _refresh(self):
        self.last_refresh = time.time()
        sid = self.server["id"]
        st = self.store.server_settings(sid) or {}
        self.server.update({k: v for k, v in st.items() if v is not None})
        self.pipelines = self.store.pipelines(sid, bool(self.server.get("is_default")))
        active_pids = {w.pipeline_id for w in self.workers.values()}
        if self.mode == "RUNNING":
            self._schedule(active_pids)
        # cancel flags set by the app
        flags = self.store.cancel_flags(list(self.workers))
        for rid, f in flags.items():
            w = self.workers.get(rid)
            if f and w and w.cancel is not None and not w.cancel.is_set():
                w.cancel.set()
                w.status = "CANCELLING"
                self.note("WARN", f"Run #{rid} cancelled from the WMS app")
        if self.mode == "RUNNING":
            cap = int(self.server.get("max_parallel") or self.cfg.max_parallel or 4)
            queued = self.store.queued_runs([p["id"] for p in self.pipelines])
            for r in queued:
                if len(self.workers) >= cap:
                    break
                if r["pipeline_id"] in {w.pipeline_id for w in self.workers.values()}:
                    continue                                # one run per pipeline at a time
                if self.store.claim_run(r["id"], sid):
                    self._start(r)
        if self.mode == "DRAINING" and not self.workers:
            self.mode = "STOPPED"
            self.note("INFO", "Drained - engine stopped")
        status = {"RUNNING": "ONLINE", "PAUSED": "PAUSED", "DRAINING": "DRAINING", "STOPPED": "STOPPED"}[self.mode]
        self.store.heartbeat(sid, status, VERSION, f"engine {self.mode.lower()} · {len(self.workers)} running · max {self.server.get('max_parallel')}")
        self.last_error = None

    def _tz(self):
        try:
            return ZoneInfo(self.server.get("timezone") or self.cfg.timezone or "UTC")
        except Exception:  # noqa: BLE001
            return ZoneInfo("UTC")

    def _schedule(self, active_pids: set):
        from croniter import croniter
        now = time.time()
        for p in self.pipelines:
            pid, sched = p["id"], p["schedule"]
            if not p["enabled"] or sched == "MANUAL" or pid in active_pids or p.get("state") == "QUEUED":
                continue
            if p.get("end_at") and dt.datetime.now(self._tz()).strftime("%Y-%m-%d %H:%M:%S") > p["end_at"]:
                continue
            if p.get("start_at") and dt.datetime.now(self._tz()).strftime("%Y-%m-%d %H:%M:%S") < p["start_at"]:
                continue
            due_in = None
            if sched == "INTERVAL":
                iv = max(60, int(p.get("interval") or 3600))
                due_in = 0 if p.get("last_run_secs") is None else iv - p["last_run_secs"]
            elif sched == "CRON":
                if pid not in self.next_fire:
                    try:
                        self.next_fire[pid] = croniter(p["cron"], dt.datetime.now(self._tz())).get_next(dt.datetime).timestamp()
                    except Exception as e:  # noqa: BLE001
                        self.note("ERROR", f"Pipeline {p['name']}: bad cron '{p['cron']}' ({e})")
                        continue
                due_in = self.next_fire[pid] - now
            elif sched == "CONTINUOUS":
                if p.get("last_run_status") == "CANCELLED":
                    continue                                 # cancelled by a person: stays off until Run now
                due_in = 0 if p.get("last_run_status") != "FAILED" else max(0, 300 - (p.get("last_run_secs") or 0))
            if due_in is None:
                continue
            if due_in <= 0:
                if self._has_queued(pid):
                    continue
                self.run_now(pid, {}, "scheduler", "CONTINUOUS" if sched == "CONTINUOUS" else "SCHEDULE")
                if sched == "CRON":
                    self.next_fire[pid] = croniter(p["cron"], dt.datetime.now(self._tz())).get_next(dt.datetime).timestamp()
                    due_in = self.next_fire[pid] - now
                elif sched == "INTERVAL":
                    due_in = max(60, int(p.get("interval") or 3600))
                else:
                    continue
            if p.get("next_run_secs") is None or abs((p.get("next_run_secs") or 0) - due_in) > 60:
                self.store.set_pipeline(pid, next_in_secs=int(due_in))

    def _has_queued(self, pid: int) -> bool:
        try:
            return bool(self.store.queued_runs([pid]))
        except Exception:  # noqa: BLE001
            return True

    def _start(self, r: dict):
        w = Worker(run_id=r["id"], pipeline_id=r["pipeline_id"], pipeline=r.get("pipeline") or f"#{r['pipeline_id']}", trigger=r.get("trigger") or "MANUAL",
                   cycle=r.get("cycle") or 1)
        if self.thread_mode:
            w.cancel = threading.Event()
            ctx = RunContext(self.cfg, self.store, self.server["id"], emit=self.queue.put, cancel_requested=w.cancel.is_set)
            w.thread = threading.Thread(target=self._thread_run, args=(ctx, r["id"]), name=f"run-{r['id']}", daemon=True)
            w.thread.start()
        else:
            w.cancel = self._mp.Event()
            w.proc = self._mp.Process(target=worker_main, args=(r["id"], self.server["id"], self.queue, w.cancel), name=f"run-{r['id']}", daemon=True)
            w.proc.start()
        self.workers[r["id"]] = w
        self.note("INFO", f"Run #{r['id']} started: {w.pipeline}" + (f" (process {w.proc.pid})" if w.proc else ""))

    def _thread_run(self, ctx, run_id):
        try:
            execute_run(ctx, run_id)
        except Exception as e:  # noqa: BLE001
            self.queue.put({"type": "done", "run_id": run_id, "status": "FAILED", "error": str(e)})

    def _drain_events(self):
        for _ in range(2000):
            try:
                e = self.queue.get_nowait()
            except (queue.Empty, OSError, EOFError):
                break
            self._on_event(e)

    def _on_event(self, e: dict):
        w = self.workers.get(e.get("run_id"))
        t = e.get("type")
        if w:
            if t == "started":
                w.tasks = e.get("tasks") or []
                w.task_state = {n: "WAITING" for n in w.tasks}
            elif t == "progress":
                if w.task and w.task != e.get("task") and w.task_state.get(w.task) == "RUNNING":
                    w.task_state[w.task] = "SUCCESS"
                w.task = e.get("task") or w.task
                w.task_state[w.task] = "RUNNING"
                w.rows_read, w.rows_written, w.pages = e.get("rows_read", 0), e.get("rows_written", 0), e.get("pages", 0)
                w.rate, w.watermark = e.get("rate", 0), e.get("watermark") or ""
            elif t == "log":
                w.log.append({"time": e.get("time"), "level": e.get("level"), "message": e.get("message")})
                msg = e.get("message") or ""
                if msg.startswith("Task ") and ":" in msg:
                    name = msg[5:].split(":")[0]
                    if name in w.task_state:
                        if " done:" in msg:
                            w.task_state[name] = "SUCCESS"
                        elif " failed:" in msg:
                            w.task_state[name] = "FAILED"
                        elif " cancelled" in msg:
                            w.task_state[name] = "CANCELLED"
                        else:
                            w.task_state[name] = "RUNNING"
                            w.task = name
            elif t == "cycle":
                w.cycle = (e.get("cycle") or 1) + 1
                w.task_state = {n: "WAITING" for n in w.tasks}
            elif t == "done":
                self._finish(w, e.get("status") or "FAILED", e.get("error"))
                self.note("INFO" if e.get("status") == "SUCCESS" else "WARN",
                          f"Run #{w.run_id} {str(e.get('status')).lower()}: {w.pipeline} — {e.get('rows_read', 0):,} read, {e.get('rows_written', 0):,} written"
                          + (f" ({e.get('error')})" if e.get("error") and e.get("status") != "SUCCESS" else ""))
        elif t == "log" and e.get("level") in ("WARN", "ERROR"):
            self.note(e["level"], e.get("message") or "")
        for cb in list(self.listeners):
            try:
                cb(e)
            except Exception:  # noqa: BLE001
                self.listeners.remove(cb)

    def _finish(self, w: Worker, status: str, error: str | None):
        if w.run_id not in self.workers:
            return
        w.status, w.error, w.ended = status, error, time.time()
        for n, s in w.task_state.items():
            if s == "RUNNING":
                w.task_state[n] = "SUCCESS" if status == "SUCCESS" else status
        self.workers.pop(w.run_id, None)
        self.finished.appendleft(w)
        if w.proc is not None:
            w.proc.join(1)
        self.kick()

    def _reap(self):
        """A worker process that died without saying so (crash, killed from Task Manager)."""
        for w in list(self.workers.values()):
            if w.proc is not None and not w.proc.is_alive() and w.proc.exitcode is not None:
                self._drain_events()
                if w.run_id in self.workers:
                    err = f"Worker process exited (code {w.proc.exitcode})"
                    try:
                        self.store.set_run(w.run_id, status="FAILED", ended=True, error=err)
                        self.store.set_pipeline(w.pipeline_id, state="IDLE", last_status="FAILED", last_run_id=w.run_id)
                    except Exception:  # noqa: BLE001
                        pass
                    self._finish(w, "FAILED", err)
                    self.note("ERROR", f"Run #{w.run_id}: {err}")

    # ── views for the console / API ──
    def note(self, level: str, msg: str):
        self.events.appendleft({"time": time.strftime("%H:%M:%S"), "level": level, "message": msg})

    def snapshot(self) -> dict:
        import psutil
        p = psutil.Process()
        return {
            "server": {"name": self.cfg.server_name, "id": self.server.get("id"), "version": VERSION, "mode": self.mode,
                       "uptime": round(time.time() - self.started_at), "max_parallel": self.server.get("max_parallel"),
                       "timezone": self.server.get("timezone") or self.cfg.timezone, "is_default": self.server.get("is_default"),
                       "control": self.cfg.control.driver, "workers": "threads" if self.thread_mode else "processes", "last_error": self.last_error,
                       "last_refresh_ago": round(time.time() - self.last_refresh) if self.last_refresh else None},
            "metrics": {"cpu": psutil.cpu_percent(interval=None), "memory": psutil.virtual_memory().percent,
                        "server_mb": round(p.memory_info().rss / 1048576), "threads": p.num_threads()},
            "running": [w.view() for w in self.workers.values()],
            "finished": [w.view() for w in self.finished],
            "events": list(self.events)[:120],
            "pipelines": self.pipelines,
        }
