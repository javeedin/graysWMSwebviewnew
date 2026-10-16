"""Database drivers used for the control tables, APEX / connection sources and targets.

OrdsGatewayDb  the WMS app's own APEX gateway (POST ai/executequery, ai/executewrite) - one statement per call,
               literal SQL, reads must not contain UPDATE / DELETE words (the gateway rejects them).
OracleDb       python-oracledb thin mode (EZ connect, TNS descriptor / alias, Autonomous DB with wallet).
DuckDb         a DuckDB file on this server.
All return rows as dicts keyed by UPPER-case column names.
"""
from __future__ import annotations

import json
import threading
from typing import Any

import httpx


class DbError(Exception):
    pass


class OrdsGatewayDb:
    dialect = "oracle"
    literal_only = True            # no bind variables: statements are literal SQL

    def __init__(self, ai_base: str, app_user: str = "PIPELINE_SERVER", timeout_s: int = 120, auth: tuple | None = None, headers: dict | None = None):
        self.base = ai_base.rstrip("/")
        self.app_user = app_user
        self.client = httpx.Client(timeout=timeout_s, auth=auth, headers=headers)
        self._lock = threading.Lock()

    def _post(self, op: str, payload: dict) -> dict:
        body = dict(payload, appUser=self.app_user)
        try:
            r = self.client.post(f"{self.base}/{op}", json=body)
        except httpx.HTTPError as e:
            raise DbError(f"APEX gateway not reachable: {e}") from e
        try:
            d = r.json()
        except ValueError:
            raise DbError(f"APEX gateway answered HTTP {r.status_code}: {r.text[:300]}")
        if isinstance(d, str):
            d = json.loads(d)
        if not d or d.get("success") is False or d.get("ReturnStatus") == "Error":
            raise DbError(str((d or {}).get("error") or (d or {}).get("ErrorExplanation") or f"HTTP {r.status_code}"))
        return d

    def query(self, sql: str, max_rows: int = 1000) -> list[dict]:
        d = self._post("executequery", {"sql": sql, "maxRows": min(max_rows, 1000)})
        cols = [str(c.get("name") if isinstance(c, dict) else c).upper() for c in d.get("columns") or []]
        out = []
        for r in d.get("rows") or []:
            out.append({k.upper(): v for k, v in r.items()} if isinstance(r, dict) else dict(zip(cols, r)))
        return out

    def execute(self, sql: str) -> Any:
        return self._post("executewrite", {"sql": sql})

    def commit(self):
        pass

    def close(self):
        self.client.close()


class OracleDb:
    dialect = "oracle"
    literal_only = False

    def __init__(self, dsn: str, user: str, password: str, wallet_dir: str | None = None, wallet_password: str | None = None):
        import oracledb
        kw: dict = {"user": user, "password": password, "dsn": dsn}
        if wallet_dir:
            kw.update(config_dir=wallet_dir, wallet_location=wallet_dir)
            if wallet_password:
                kw["wallet_password"] = wallet_password
        try:
            self.con = oracledb.connect(**kw)
        except Exception as e:
            raise DbError(f"Oracle connection failed: {e}") from e

    def query(self, sql: str, max_rows: int = 100000, binds: dict | list | None = None) -> list[dict]:
        with self.con.cursor() as c:
            c.execute(sql, binds or {})
            cols = [d[0].upper() for d in c.description]
            rows = c.fetchmany(max_rows)
            return [dict(zip(cols, [_lob(v) for v in r])) for r in rows]

    def execute(self, sql: str, binds=None) -> Any:
        with self.con.cursor() as c:
            c.execute(sql, binds or {})
            return c.rowcount

    def executemany(self, sql: str, rows: list) -> None:
        with self.con.cursor() as c:
            c.executemany(sql, rows)

    def commit(self):
        self.con.commit()

    def close(self):
        try:
            self.con.close()
        except Exception:
            pass


def _lob(v):
    return v.read() if hasattr(v, "read") else v


class DuckDb:
    dialect = "duckdb"
    literal_only = False

    def __init__(self, path: str):
        import duckdb
        try:
            self.con = duckdb.connect(path)
        except Exception as e:
            raise DbError(f"DuckDB file could not be opened ({path}): {e}") from e

    def query(self, sql: str, max_rows: int = 100000, binds=None) -> list[dict]:
        cur = self.con.execute(sql, binds or [])
        cols = [d[0].upper() for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchmany(max_rows)]

    def execute(self, sql: str, binds=None) -> Any:
        self.con.execute(sql, binds or [])

    def executemany(self, sql: str, rows: list) -> None:
        self.con.executemany(sql, rows)

    def commit(self):
        pass

    def close(self):
        try:
            self.con.close()
        except Exception:
            pass
