"""Usage ledger: one row per model call (SQLite, <home>/usage.db) - cost, tokens, latency, outcome."""
from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path

from .config import home


class Usage:
    def __init__(self, path: Path | None = None):
        self.path = str(path or home() / "usage.db")
        self._lock = threading.Lock()
        with self._con() as c:
            c.execute("""CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY, ts REAL, day TEXT, month TEXT, task TEXT,
                provider TEXT, model TEXT, ok INTEGER, error TEXT, ms INTEGER, tokens_in INTEGER, tokens_out INTEGER,
                cost REAL, app_user TEXT, attempt INTEGER, fallback INTEGER)""")
            c.execute("CREATE INDEX IF NOT EXISTS calls_month ON calls(month)")

    def _con(self):
        return sqlite3.connect(self.path, timeout=10)

    def add(self, **r) -> None:
        t = time.time()
        lt = time.localtime(t)
        with self._lock, self._con() as c:
            c.execute("INSERT INTO calls (ts, day, month, task, provider, model, ok, error, ms, tokens_in, tokens_out, cost, app_user, attempt, fallback) "
                      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (t, time.strftime("%Y-%m-%d", lt), time.strftime("%Y-%m", lt), r.get("task"), r.get("provider"), r.get("model"),
                       1 if r.get("ok") else 0, (r.get("error") or "")[:500], r.get("ms", 0), r.get("tokens_in", 0), r.get("tokens_out", 0),
                       r.get("cost", 0.0), r.get("app_user"), r.get("attempt", 1), 1 if r.get("fallback") else 0))

    def month_cost(self, month: str | None = None) -> float:
        month = month or time.strftime("%Y-%m")
        with self._con() as c:
            return float(c.execute("SELECT COALESCE(SUM(cost),0) FROM calls WHERE month = ?", (month,)).fetchone()[0])

    def summary(self, days: int = 30) -> dict:
        since = time.time() - days * 86400
        with self._con() as c:
            c.row_factory = sqlite3.Row
            q = lambda sql: [dict(r) for r in c.execute(sql, (since,)).fetchall()]  # noqa: E731
            by_model = q("""SELECT provider, model, COUNT(*) calls, SUM(ok) ok, ROUND(AVG(CASE WHEN ok=1 THEN ms END)) avg_ms,
                SUM(tokens_in) tokens_in, SUM(tokens_out) tokens_out, ROUND(SUM(cost),4) cost, SUM(fallback) fallbacks
                FROM calls WHERE ts >= ? GROUP BY provider, model ORDER BY cost DESC, calls DESC""")
            by_day = q("SELECT day, provider, ROUND(SUM(cost),4) cost, COUNT(*) calls FROM calls WHERE ts >= ? GROUP BY day, provider ORDER BY day")
            by_task = q("SELECT task, COUNT(*) calls, ROUND(SUM(cost),4) cost, SUM(ok) ok FROM calls WHERE ts >= ? GROUP BY task ORDER BY calls DESC")
            recent = q("SELECT ts, task, provider, model, ok, error, ms, tokens_in, tokens_out, cost, app_user, fallback FROM calls WHERE ts >= ? ORDER BY id DESC LIMIT 60")
        return {"by_model": by_model, "by_day": by_day, "by_task": by_task, "recent": recent, "month_cost": self.month_cost()}
