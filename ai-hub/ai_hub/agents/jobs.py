"""Scheduled agent jobs: a prompt that runs by itself (every N minutes or daily at HH:MM) as a new conversation.

The runner starts the conversation in the hub; tools that run in the WMS app wait until an AI Agent page is open on
some PC: the page picks up waiting job conversations (`/agent/jobs/pending`), runs their read-only tools at once and
leaves anything that needs a confirm for a person ("Needs you"). Nothing that changes data ever runs unattended.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timedelta


def next_run(every_min: int | None, daily_at: str | None, now: float) -> float:
    if every_min:
        return now + max(15, int(every_min)) * 60
    hh, mm = (int(x) for x in (daily_at or "07:00").split(":"))
    base = datetime.fromtimestamp(now)
    dt = base.replace(hour=hh % 24, minute=mm % 60, second=0, microsecond=0)
    if dt.timestamp() <= now:
        dt += timedelta(days=1)
    return dt.timestamp()


class JobRunner:
    def __init__(self, svc, tick: float = 30.0):
        self.svc, self.tick = svc, tick
        self._stop = threading.Event()
        self._t: threading.Thread | None = None

    def start(self) -> None:
        if self._t is None:
            self._t = threading.Thread(target=self._loop, name="agent-jobs", daemon=True)
            self._t.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.wait(self.tick):
            try:
                self.run_due()
            except Exception as e:  # noqa: BLE001 - one bad job must not stop the others
                print(f"[agent-jobs] {e}", flush=True)

    def run_due(self, now: float | None = None) -> list[str]:
        now = now or time.time()
        started = []
        for j in self.svc.store.all("SELECT * FROM jobs WHERE enabled = 1 AND next_run <= ?", (now,)):
            # claim first (next_run moves on) so a slow run is never started twice
            self.svc.store.run("UPDATE jobs SET next_run = ?, last_run = ? WHERE id = ?", (next_run(j["every_min"], j["daily_at"], now), now, j["id"]))
            try:
                r = self.svc.start(f"[Scheduled job: {j['name']}] {j['prompt']}", app_user=j["app_user"], specialist=j["specialist"],
                                   pod=j["pod"] or "PROD", caps=None, job_id=j["id"])
                status, tid = r.get("status"), r.get("thread_id")
            except Exception as e:  # noqa: BLE001
                status, tid = f"error: {e}", None
            self.svc.store.run("UPDATE jobs SET last_thread = ?, last_status = ? WHERE id = ?", (tid, status, j["id"]))
            started.append(j["id"])
        return started
