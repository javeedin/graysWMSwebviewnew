"""Small SQLite store with versioned migrations (schema_version): the AI Agent's threads, events, memory and jobs.

Each migration runs once, in order, inside a transaction; the version is recorded with the time it was applied.
Add a migration by appending to MIGRATIONS - never edit one that shipped.
"""
from __future__ import annotations

import sqlite3
import threading
import time

MIGRATIONS: list[tuple[int, str, str]] = [
    (1, "agent threads, events, memory", """
        CREATE TABLE threads (id TEXT PRIMARY KEY, app_user TEXT, title TEXT, specialist TEXT, status TEXT,
            pod TEXT, created REAL, updated REAL, cost REAL DEFAULT 0, tokens_in INTEGER DEFAULT 0,
            tokens_out INTEGER DEFAULT 0, turns INTEGER DEFAULT 0, error TEXT, job_id TEXT);
        CREATE INDEX threads_user ON threads(app_user, updated);
        CREATE TABLE events (thread_id TEXT, seq INTEGER, ts REAL, kind TEXT, data TEXT, PRIMARY KEY (thread_id, seq));
        CREATE TABLE memory (id INTEGER PRIMARY KEY AUTOINCREMENT, app_user TEXT, fact TEXT, created REAL, used INTEGER DEFAULT 0);
        CREATE INDEX memory_user ON memory(app_user);
    """),
    (2, "scheduled agent jobs", """
        CREATE TABLE jobs (id TEXT PRIMARY KEY, app_user TEXT, name TEXT, prompt TEXT, specialist TEXT, pod TEXT,
            every_min INTEGER, daily_at TEXT, enabled INTEGER DEFAULT 1, next_run REAL, last_run REAL,
            last_thread TEXT, last_status TEXT, created REAL);
    """),
    (3, "feedback on answers", """
        CREATE TABLE feedback (thread_id TEXT, seq INTEGER, app_user TEXT, rating INTEGER, note TEXT, ts REAL,
            PRIMARY KEY (thread_id, seq));
    """),
    (4, "agent eval runs", """
        CREATE TABLE eval_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, app_user TEXT, provider TEXT, model TEXT,
            total INTEGER, passed INTEGER, route_acc REAL, trajectory_acc REAL, safety_ok INTEGER, cost REAL, ms INTEGER, detail TEXT);
    """),
    (5, "settings / knowledge store", """
        CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, updated REAL);
    """),
    (6, "phone calls", """
        CREATE TABLE calls (id TEXT PRIMARY KEY, direction TEXT, number TEXT, name TEXT, app_user TEXT, status TEXT,
            goal TEXT, thread_id TEXT, k TEXT, twilio_sid TEXT, verified INTEGER DEFAULT 0, started REAL, answered REAL,
            ended REAL, transcript TEXT DEFAULT '[]', summary TEXT, message TEXT, error TEXT, origin_thread TEXT);
        CREATE INDEX calls_started ON calls(started);
    """),
]


class Store:
    def __init__(self, path: str):
        self.path = path
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.migrate()

    def migrate(self) -> int:
        with self.lock:
            self.conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, name TEXT, applied REAL)")
            have = {r[0] for r in self.conn.execute("SELECT version FROM schema_version")}
            for v, name, sql in MIGRATIONS:
                if v in have:
                    continue
                self.conn.execute("BEGIN")
                try:
                    for stmt in [x.strip() for x in sql.split(";") if x.strip()]:
                        self.conn.execute(stmt)
                    self.conn.execute("INSERT INTO schema_version VALUES (?, ?, ?)", (v, name, time.time()))
                    self.conn.execute("COMMIT")
                except Exception:
                    self.conn.execute("ROLLBACK")
                    raise
            return self.version()

    def version(self) -> int:
        return self.conn.execute("SELECT COALESCE(MAX(version), 0) FROM schema_version").fetchone()[0]

    def all(self, sql: str, args: tuple = ()) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, args).fetchall()]

    def one(self, sql: str, args: tuple = ()) -> dict | None:
        r = self.all(sql, args)
        return r[0] if r else None

    def run(self, sql: str, args: tuple = ()) -> int:
        with self.lock:
            return self.conn.execute(sql, args).rowcount
