"""Sources (where rows come from) and targets (where they go).

Sources : FUSION (BI Publisher runner), APEX (the control database), CONNECTION (Oracle / APEX gateway / DuckDB).
Targets : Oracle (direct), APEX through the gateway (literal SQL), DuckDB file, APEX REST endpoint (POST JSON).

Every source reads in pages, ordered so paging is stable:
  incremental  ORDER BY the watermark column (then the keys); "__WM" = the watermark as text, exact to the microsecond
  with keys    ORDER BY the keys
  otherwise    one read capped at full_load_cap rows
"""
from __future__ import annotations

import datetime as dt
import decimal
import json
import random
import re
from dataclasses import dataclass, field
from typing import Iterator

import httpx

from . import secrets_store
from .db import DbError, DuckDb, OracleDb, OrdsGatewayDb
from .sqlutil import ident, lit, table_name

WM = "__WM"
INTERNAL = {WM, "__RN"}


class LoadError(Exception):
    pass


# ── values & types ───────────────────────────────────────────
_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?(Z|[+-]\d{2}:?\d{2})?$")
_DMON = re.compile(r"^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})(?:[ .](\d{1,2})[.:](\d{2})[.:](\d{2})(?:[.,](\d{1,9}))?)?(?:\s*([AP]M))?$")
_NUM = re.compile(r"^-?(\d+)(\.\d+)?$")
MONTHS = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}


def parse_ts(v) -> dt.datetime | None:
    if isinstance(v, dt.datetime):
        return v.replace(tzinfo=None) if v.tzinfo is None else v.astimezone(dt.timezone.utc).replace(tzinfo=None)
    if isinstance(v, dt.date):
        return dt.datetime(v.year, v.month, v.day)
    s = str(v).strip()
    if m := _ISO.match(s):
        frac = int((m[7] or "0")[:6].ljust(6, "0"))
        t = dt.datetime(int(m[1]), int(m[2]), int(m[3]), int(m[4] or 0), int(m[5] or 0), int(m[6] or 0), frac)
        if m[8] and m[8] != "Z":
            sign = 1 if m[8][0] == "+" else -1
            hh, mm = int(m[8][1:3]), int(m[8][-2:])
            t = t - sign * dt.timedelta(hours=hh, minutes=mm)        # to UTC
        return t
    if (m := _DMON.match(s)) and m[2].upper() in MONTHS:
        y = int(m[3]) + (2000 if len(m[3]) == 2 else 0)
        h = int(m[4] or 0)
        if m[8]:
            h = h % 12 + (12 if m[8].upper() == "PM" else 0)
        return dt.datetime(y, MONTHS[m[2].upper()], int(m[1]), h, int(m[5] or 0), int(m[6] or 0), int((m[7] or "0")[:6].ljust(6, "0")))
    return None


def infer_type(values: list) -> str:
    """NUMBER | INTEGER | TIMESTAMP | TEXT:<len> from the non-empty values of a column."""
    vals = [v for v in values if v is not None and v != ""]
    if not vals:
        return "TEXT:4000"
    if all(isinstance(v, bool) for v in vals):
        return "TEXT:1"
    if all(isinstance(v, (int, float, decimal.Decimal)) and not isinstance(v, bool) for v in vals):
        return "INTEGER" if all(isinstance(v, int) or (isinstance(v, decimal.Decimal) and v == v.to_integral_value()) for v in vals) else "NUMBER"
    if all(isinstance(v, (dt.date, dt.datetime)) for v in vals):
        return "TIMESTAMP"
    strs = [str(v).strip() for v in vals]
    if all(_NUM.match(s) and len(s) <= 38 and not (len(s) > 1 and s.lstrip("-").startswith("0") and not s.lstrip("-").startswith("0.")) for s in strs):
        return "INTEGER" if all("." not in s for s in strs) else "NUMBER"
    if all(parse_ts(s) for s in strs):
        return "TIMESTAMP"
    longest = max(len(s.encode("utf-8")) for s in strs)
    return "TEXT:CLOB" if longest > 4000 else "TEXT:4000"


def convert(v, typ: str, col: str):
    if v is None or v == "":
        return None
    if typ in ("NUMBER", "INTEGER"):
        if isinstance(v, (int, float, decimal.Decimal)):
            return v
        s = str(v).strip().replace(",", "")
        try:
            d = decimal.Decimal(s)
        except decimal.InvalidOperation:
            raise LoadError(f"Column {col} is a number in the target, but a row has {str(v)[:40]!r}. Set the column type in the task's column map "
                            f'(e.g. {{"{col}": "{col}:TEXT"}}) or drop the target table so it is created again.')
        return int(d) if typ == "INTEGER" and d == d.to_integral_value() else d
    if typ == "TIMESTAMP":
        t = parse_ts(v)
        if t is None:
            raise LoadError(f"Column {col} is a date in the target, but a row has {str(v)[:40]!r}.")
        return t
    return v if isinstance(v, str) else (v.isoformat() if isinstance(v, (dt.date, dt.datetime)) else str(v))


@dataclass
class ColumnPlan:
    source: str
    target: str
    type: str            # NUMBER | INTEGER | TIMESTAMP | TEXT:4000 | TEXT:CLOB | TEXT:<n>


def plan_columns(rows: list, source_cols: list, column_map: dict) -> list[ColumnPlan]:
    """Target names and types. column_map: {"SRC": "TARGET"} or {"SRC": "TARGET:TYPE"} (TYPE = TEXT, NUMBER, INTEGER, DATE, TIMESTAMP)."""
    cmap = {str(k).upper(): v for k, v in (column_map or {}).items()}
    plans = []
    for c in source_cols:
        if c in INTERNAL:
            continue
        m = cmap.get(c.upper())
        tgt, typ = ident(c), None
        if isinstance(m, str) and m.strip():
            if m.strip().upper() in ("-", "SKIP", "IGNORE"):
                continue
            name, _, t = m.partition(":")
            tgt = ident(name or c)
            if t:
                t = t.strip().upper()
                typ = {"DATE": "TIMESTAMP", "TEXT": "TEXT:4000", "VARCHAR2": "TEXT:4000", "CLOB": "TEXT:CLOB"}.get(t, t)
        plans.append(ColumnPlan(c, tgt, typ or infer_type([r.get(c) for r in rows])))
    return plans


def oracle_type(t: str) -> str:
    return {"NUMBER": "NUMBER", "INTEGER": "NUMBER", "TIMESTAMP": "TIMESTAMP", "TEXT:CLOB": "CLOB"}.get(t, "VARCHAR2(4000)")


def duck_type(t: str) -> str:
    return {"NUMBER": "DOUBLE", "INTEGER": "DECIMAL(38,0)", "TIMESTAMP": "TIMESTAMP"}.get(t, "VARCHAR")


def from_target_type(dtype: str) -> str:
    d = (dtype or "").upper()
    if d.startswith(("NUMBER", "FLOAT", "DOUBLE", "DECIMAL", "INTEGER", "BIGINT", "INT", "SMALLINT", "HUGEINT", "REAL", "BINARY_")):
        return "INTEGER" if d.startswith(("BIGINT", "INT", "SMALLINT", "HUGEINT", "INTEGER")) or "(38,0)" in d else "NUMBER"
    if d.startswith(("DATE", "TIMESTAMP")):
        return "TIMESTAMP"
    if d.startswith(("CLOB", "NCLOB")):
        return "TEXT:CLOB"
    return "TEXT:4000"


# ── query specs ──────────────────────────────────────────────
@dataclass
class QuerySpec:
    sql: str                      # parameters already substituted, {{WATERMARK}} still present when used
    wm_col: str = ""
    wm_type: str = "DATE"         # DATE | NUMBER
    wm_value: str = ""            # last watermark ('' = first run → everything)
    wm_op: str = ">"              # '>' strict (append) or '>=' with overlap (merge)
    overlap_s: int = 0
    keys: list = field(default_factory=list)
    page: int = 5000
    cap: int | None = None        # row_limit of the task


def _wm_literal(spec: QuerySpec, dialect: str) -> str:
    if spec.wm_type == "NUMBER":
        return spec.wm_value or "-1e30"
    v = spec.wm_value or "1900-01-01 00:00:00.000000"
    if dialect == "duckdb":
        base = f"TIMESTAMP '{v}'"
        return f"({base} - INTERVAL {int(spec.overlap_s)} SECOND)" if spec.overlap_s else base
    base = f"TO_TIMESTAMP('{v}', 'YYYY-MM-DD HH24:MI:SS.FF6')"
    return f"({base} - NUMTODSINTERVAL({int(spec.overlap_s)}, 'SECOND'))" if spec.overlap_s else base


def build_query(spec: QuerySpec, dialect: str) -> tuple[str, bool]:
    """The ordered query (no paging). Returns (sql, ordered)."""
    sql = spec.sql
    if "{{WATERMARK}}" in sql.upper().replace(" ", ""):
        sql = re.sub(r"\{\{\s*WATERMARK\s*\}\}", _wm_literal(spec, dialect), sql, flags=re.I)
        tokenised = True
    else:
        tokenised = False
    keys = [ident(k) for k in spec.keys]
    if spec.wm_col:
        w = ident(spec.wm_col)
        if spec.wm_type == "NUMBER":
            wm_expr = f"s.{w}"
            wm_txt = f"TO_CHAR(s.{w})" if dialect == "oracle" else f"CAST(s.{w} AS VARCHAR)"
        elif dialect == "duckdb":
            wm_expr = f"CAST(s.{w} AS TIMESTAMP)"
            wm_txt = f"strftime(CAST(s.{w} AS TIMESTAMP), '%Y-%m-%d %H:%M:%S.%f')"
        else:
            wm_expr = f"CAST(s.{w} AS TIMESTAMP)"
            wm_txt = f"TO_CHAR(CAST(s.{w} AS TIMESTAMP), 'YYYY-MM-DD HH24:MI:SS.FF6')"
        where = "" if tokenised or not spec.wm_value else f" WHERE {wm_expr} {spec.wm_op} {_wm_literal(spec, dialect)}"
        order = ", ".join([wm_expr] + [f"s.{k}" for k in keys])
        return f'SELECT s.*, {wm_txt} AS "{WM}" FROM (\n{sql}\n) s{where} ORDER BY {order}', True
    if keys:
        return f"SELECT s.* FROM (\n{sql}\n) s ORDER BY " + ", ".join(f"s.{k}" for k in keys), True
    return sql, False


def page_sql(q: str, dialect: str, offset: int, n: int) -> str:
    if dialect == "duckdb":
        return f"{q}\nLIMIT {int(n)} OFFSET {int(offset)}"
    return f"{q}\nOFFSET {int(offset)} ROWS FETCH NEXT {int(n)} ROWS ONLY"


class Source:
    dialect = "oracle"
    max_page = 100000

    def run_sql(self, sql: str, n: int) -> list[dict]:
        raise NotImplementedError

    def pages(self, spec: QuerySpec, full_cap: int = 200000) -> Iterator[list[dict]]:
        q, ordered = build_query(spec, self.dialect)
        page = max(1, min(spec.page or 5000, self.max_page))
        cap = spec.cap
        if not ordered:
            n = min(cap or full_cap, full_cap)
            yield self.run_sql(q, n)
            return
        offset, total = 0, 0
        while True:
            n = page if not cap else min(page, cap - total)
            if n <= 0:
                return
            rows = self.run_sql(page_sql(q, self.dialect, offset, n), n)
            yield rows
            total += len(rows)
            offset += len(rows)
            if len(rows) < n:
                return

    def close(self):
        pass


class FusionSource(Source):
    dialect = "oracle"
    max_page = 20000

    def __init__(self, runner):
        self.runner = runner

    def run_sql(self, sql, n):
        return self.runner.run(sql, n).rows

    def close(self):
        self.runner.close()


class DbSource(Source):
    def __init__(self, db):
        self.db = db
        self.dialect = db.dialect
        self.max_page = 1000 if isinstance(db, OrdsGatewayDb) else 100000

    def run_sql(self, sql, n):
        return self.db.query(sql, n)

    def close(self):
        self.db.close()


class DemoSource(Source):
    """Demo mode: invents rows for any Fusion task so the whole flow can be tried without Fusion."""
    dialect = "oracle"

    def __init__(self, seed: int = 7):
        self.rnd = random.Random(seed)

    def pages(self, spec, full_cap=200000):
        now = dt.datetime.now().replace(microsecond=0)
        start = parse_ts(spec.wm_value) if spec.wm_value else now - dt.timedelta(days=30)
        n = self.rnd.randint(40, 160) if spec.wm_value else 1200
        rows = []
        for i in range(n):
            t = start + dt.timedelta(seconds=(now - start).total_seconds() * (i + 1) / n)
            rid = self.rnd.randint(1, 5000)
            r = {"ID": str(rid), "NAME": f"Record {rid}", "AMOUNT": f"{self.rnd.uniform(10, 9000):.2f}", "STATUS": self.rnd.choice(["OPEN", "CLOSED", "SHIPPED"]),
                 "LAST_UPDATE_DATE": t.strftime("%Y-%m-%dT%H:%M:%S.000+00:00")}
            for k in spec.keys:
                r[ident(k)] = str(rid)
            if spec.wm_col:
                r[ident(spec.wm_col)] = r["LAST_UPDATE_DATE"]
                r[WM] = t.strftime("%Y-%m-%d %H:%M:%S.%f")
            rows.append(r)
        page = max(1, spec.page or 500)
        for i in range(0, len(rows), page):
            yield rows[i:i + page]


# ── targets ──────────────────────────────────────────────────
class Target:
    def __init__(self):
        self.plan: list[ColumnPlan] = []
        self.keys: list[str] = []

    def prepare(self, table: str, plan: list[ColumnPlan], keys: list[str], mode: str, create: bool, log) -> list[ColumnPlan]:
        raise NotImplementedError

    def write(self, rows: list[dict], mode: str) -> int:
        raise NotImplementedError

    def close(self):
        pass


def _dedupe(rows: list[dict], keys: list[str], plan) -> list[dict]:
    """MERGE fails when one batch holds the same key twice: keep the last row per key."""
    if not keys:
        return rows
    src = {p.target: p.source for p in plan}
    seen = {}
    for r in rows:
        seen[tuple(r.get(src.get(k, k)) for k in keys)] = r
    return list(seen.values())


class OracleTarget(Target):
    """Oracle / APEX - direct (binds, executemany) or through the APEX gateway (literal SQL)."""

    def __init__(self, db):
        super().__init__()
        self.db = db
        self.literal = getattr(db, "literal_only", False)

    def _columns(self, table: str) -> dict:
        own, _, tab = table.rpartition(".")
        if own:
            rows = self.db.query(f"SELECT column_name, data_type FROM all_tab_columns WHERE owner = {lit(own)} AND table_name = {lit(tab)} ORDER BY column_id", 2000)
        else:
            rows = self.db.query(f"SELECT column_name, data_type FROM user_tab_columns WHERE table_name = {lit(tab)} ORDER BY column_id", 2000)
        return {r["COLUMN_NAME"]: r["DATA_TYPE"] for r in rows}

    def prepare(self, table, plan, keys, mode, create, log):
        self.table, self.keys = table_name(table), [ident(k) for k in keys]
        have = self._columns(self.table)
        if not have:
            if not create:
                raise LoadError(f"Target table {self.table} does not exist (and 'create table' is off).")
            cols = ", ".join(f"{p.target} {oracle_type(p.type)}" for p in plan)
            pk = ""
            if self.keys and mode in ("MERGE", "INCREMENTAL"):
                pk = f", CONSTRAINT {(self.table.split('.')[-1][:120] + '_PK')} PRIMARY KEY ({', '.join(self.keys)})"
            self.db.execute(f"CREATE TABLE {self.table} ({cols}{pk})")
            log("INFO", f"Created table {self.table} ({len(plan)} columns)")
            have = self._columns(self.table)
        else:
            for p in plan:
                if p.target in have:
                    p.type = from_target_type(have[p.target])        # the table decides the type
                else:
                    self.db.execute(f"ALTER TABLE {self.table} ADD ({p.target} {oracle_type(p.type)})")
                    log("WARN", f"New column {p.target} added to {self.table} (the source has it, the table did not)")
        self.plan = plan
        if mode == "TRUNCATE_INSERT":
            try:
                self.db.execute(f"TRUNCATE TABLE {self.table}")
            except Exception:
                self.db.execute(f"DELETE FROM {self.table}")
            self.db.commit()
            log("INFO", f"Emptied {self.table}")
        return plan

    def _lit(self, v, typ):
        if v is None:
            return {"NUMBER": "CAST(NULL AS NUMBER)", "INTEGER": "CAST(NULL AS NUMBER)", "TIMESTAMP": "CAST(NULL AS TIMESTAMP)", "TEXT:CLOB": "TO_CLOB(NULL)"}.get(typ, "CAST(NULL AS VARCHAR2(4000))")
        if typ in ("NUMBER", "INTEGER"):
            return str(v)
        if typ == "TEXT:CLOB":
            s = str(v)
            return " || ".join("TO_CLOB(" + lit(s[i:i + 3000]) + ")" for i in range(0, max(len(s), 1), 3000))
        return lit(v)

    def write(self, rows, mode):
        if not rows:
            return 0
        merge = mode in ("MERGE", "INCREMENTAL") and self.keys
        if merge:
            rows = _dedupe(rows, self.keys, self.plan)
        conv = [[convert(r.get(p.source), p.type, p.target) for p in self.plan] for r in rows]
        cols = [p.target for p in self.plan]
        if not self.literal:
            if merge:
                sel = ", ".join(f":{i + 1} AS {c}" for i, c in enumerate(cols))
                self.db.executemany(self._merge_sql(f"SELECT {sel} FROM dual"), conv)
            else:
                self.db.executemany(f"INSERT INTO {self.table} ({', '.join(cols)}) VALUES ({', '.join(':' + str(i + 1) for i in range(len(cols)))})", conv)
            self.db.commit()
            return len(rows)
        # gateway: literal SELECT … FROM dual UNION ALL … chunks of ~40 KB
        chunk, size, written = [], 0, 0
        for vals in conv:
            s = "SELECT " + ", ".join(f"{self._lit(v, p.type)} AS {p.target}" for v, p in zip(vals, self.plan)) + " FROM dual"
            if chunk and size + len(s) > 40000:
                written += self._flush(chunk, cols, merge)
                chunk, size = [], 0
            chunk.append(s)
            size += len(s)
        if chunk:
            written += self._flush(chunk, cols, merge)
        return written

    def _merge_sql(self, using: str) -> str:
        cols = [p.target for p in self.plan]
        others = [c for c in cols if c not in self.keys]
        on = " AND ".join(f"t.{k} = s.{k}" for k in self.keys)
        upd = (" WHEN MATCHED THEN UPDATE SET " + ", ".join(f"t.{c} = s.{c}" for c in others)) if others else ""
        return (f"MERGE INTO {self.table} t USING ({using}) s ON ({on}){upd} WHEN NOT MATCHED THEN INSERT ({', '.join(cols)}) "
                f"VALUES ({', '.join('s.' + c for c in cols)})")

    def _flush(self, selects: list[str], cols: list[str], merge: bool) -> int:
        body = " UNION ALL ".join(selects)
        if merge:
            self.db.execute(self._merge_sql(body))
        else:
            self.db.execute(f"INSERT INTO {self.table} ({', '.join(cols)}) {body}")
        return len(selects)

    def close(self):
        self.db.close()


class DuckTarget(Target):
    def __init__(self, db: DuckDb):
        super().__init__()
        self.db = db

    def prepare(self, table, plan, keys, mode, create, log):
        self.table, self.keys = table_name(table).replace(".", "_"), [ident(k) for k in keys]
        have = {r["COLUMN_NAME"].upper(): r["DATA_TYPE"] for r in self.db.query(
            "SELECT column_name, data_type FROM information_schema.columns WHERE upper(table_name) = ? ORDER BY ordinal_position", 5000, [self.table])}
        if not have:
            if not create:
                raise LoadError(f"Target table {self.table} does not exist (and 'create table' is off).")
            self.db.execute(f'CREATE TABLE "{self.table}" (' + ", ".join(f'"{p.target}" {duck_type(p.type)}' for p in plan) + ")")
            log("INFO", f"Created DuckDB table {self.table} ({len(plan)} columns)")
        else:
            for p in plan:
                if p.target in have:
                    p.type = from_target_type(have[p.target])
                else:
                    self.db.execute(f'ALTER TABLE "{self.table}" ADD COLUMN "{p.target}" {duck_type(p.type)}')
                    log("WARN", f"New column {p.target} added to {self.table}")
        self.plan = plan
        if mode == "TRUNCATE_INSERT":
            self.db.execute(f'DELETE FROM "{self.table}"')
            log("INFO", f"Emptied {self.table}")
        return plan

    def write(self, rows, mode):
        if not rows:
            return 0
        merge = mode in ("MERGE", "INCREMENTAL") and self.keys
        if merge:
            rows = _dedupe(rows, self.keys, self.plan)
        conv = [[convert(r.get(p.source), p.type, p.target) for p in self.plan] for r in rows]
        cols = ", ".join(f'"{p.target}"' for p in self.plan)
        marks = ", ".join("?" for _ in self.plan)
        con = self.db.con
        con.execute("BEGIN TRANSACTION")
        try:
            if merge:
                con.execute(f'CREATE OR REPLACE TEMP TABLE __stage AS SELECT {cols} FROM "{self.table}" LIMIT 0')
                con.executemany(f"INSERT INTO __stage ({cols}) VALUES ({marks})", conv)
                on = " AND ".join(f't."{k}" = s."{k}"' for k in self.keys)
                con.execute(f'DELETE FROM "{self.table}" t WHERE EXISTS (SELECT 1 FROM __stage s WHERE {on})')
                con.execute(f'INSERT INTO "{self.table}" ({cols}) SELECT {cols} FROM __stage')
                con.execute("DROP TABLE __stage")
            else:
                con.executemany(f'INSERT INTO "{self.table}" ({cols}) VALUES ({marks})', conv)
            con.execute("COMMIT")
        except Exception:
            con.execute("ROLLBACK")
            raise
        return len(rows)

    def close(self):
        self.db.close()


class RestTarget(Target):
    """APEX REST endpoint (not the gateway): POSTs {"rows":[…]} batches to rest_url/target."""

    def __init__(self, url: str, auth=None, headers=None):
        super().__init__()
        self.url, self.client = url.rstrip("/"), httpx.Client(timeout=120, auth=auth, headers=headers)

    def prepare(self, table, plan, keys, mode, create, log):
        if mode == "TRUNCATE_INSERT":
            raise LoadError("A REST endpoint target cannot be emptied first - use APPEND or MERGE (the endpoint decides).")
        self.endpoint, self.plan, self.keys = self.url + "/" + table.lstrip("/"), plan, keys
        return plan

    def write(self, rows, mode):
        payload = [{p.target: (v.isoformat() if isinstance(v, dt.datetime) else (str(v) if isinstance(v, decimal.Decimal) else v))
                    for p in self.plan for v in [convert(r.get(p.source), p.type, p.target)]} for r in rows]
        for i in range(0, len(payload), 500):
            r = self.client.post(self.endpoint, json={"rows": payload[i:i + 500], "mode": mode, "keys": self.keys})
            if r.status_code >= 300:
                raise LoadError(f"REST target answered HTTP {r.status_code}: {r.text[:300]}")
        return len(payload)

    def close(self):
        self.client.close()


# ── factory ──────────────────────────────────────────────────
def _auth(conn: dict, password: str | None):
    a = (conn.get("auth_type") or "").upper()
    if a == "BASIC" and conn.get("username"):
        return (conn["username"], password or ""), None
    if a == "BEARER" and password:
        return None, {"Authorization": f"Bearer {password}"}
    return None, None


def open_db(conn: dict, app_user: str = "PIPELINE_SERVER"):
    """A database for a WMS_PIPE_CONNECTIONS row."""
    t = (conn.get("type") or "").upper()
    pw = secrets_store.decrypt(conn.get("password_enc"))
    opts = conn.get("options") or {}
    if t == "DUCKDB":
        path = conn.get("database_name") or conn.get("service_name")
        if not path:
            raise LoadError(f"Connection {conn.get('name')}: enter the DuckDB file path (Database) on the pipeline server.")
        return DuckDb(path)
    if t in ("ORACLE_EZ", "ORACLE_TNS", "ORACLE_WALLET"):
        if t == "ORACLE_EZ":
            dsn = f"{conn.get('host')}:{conn.get('port') or 1521}/{conn.get('service_name')}"
        elif t == "ORACLE_TNS":
            dsn = conn.get("tns_descriptor") or conn.get("tns_alias")
        else:
            dsn = conn.get("service_name")
        wpw = secrets_store.decrypt(opts.get("wallet_password_enc")) if opts.get("wallet_password_enc") else None
        return OracleDb(dsn, conn.get("username"), pw, conn.get("wallet_path") if t == "ORACLE_WALLET" else None, wpw)
    if t == "APEX_REST":
        url = (conn.get("rest_url") or "").rstrip("/")
        auth, headers = _auth(conn, pw)
        if url.lower().endswith("/ai"):
            return OrdsGatewayDb(url, app_user, auth=auth, headers=headers)
        return None                                 # plain REST endpoint: target only
    raise LoadError(f"Connection type {t} is not supported by this pipeline server version yet (Oracle, APEX, DuckDB are).")


def open_target(conn: dict, app_user: str) -> Target:
    db = open_db(conn, app_user)
    if db is None:
        auth, headers = _auth(conn, secrets_store.decrypt(conn.get("password_enc")))
        return RestTarget(conn["rest_url"], auth, headers)
    return DuckTarget(db) if isinstance(db, DuckDb) else OracleTarget(db)


def test_connection(conn: dict, app_user: str) -> tuple[bool, str]:
    try:
        db = open_db(conn, app_user)
        if db is None:
            r = httpx.get(conn["rest_url"], timeout=20)
            return r.status_code < 500, f"Endpoint answered HTTP {r.status_code}"
        try:
            if db.dialect == "duckdb":
                v = db.query("SELECT version() AS V")[0]["V"]
                return True, f"DuckDB {v} — {conn.get('database_name')}"
            v = db.query("SELECT banner AS V FROM v$version WHERE ROWNUM = 1")
            return True, "Connected — " + (v[0]["V"] if v else "Oracle")
        except DbError as e:
            if isinstance(db, OrdsGatewayDb):
                db.query("SELECT 1 AS X FROM dual")
                return True, "APEX gateway answered"
            raise e
        finally:
            db.close()
    except Exception as e:  # noqa: BLE001 - report every failure to the user
        return False, str(e)[:500]


def dumps(o) -> str:
    return json.dumps(o, default=str)
