"""The control tables in APEX (apex_sql/69_fusion_pipelines.sql): what the server reads and writes.

OracleControlStore talks Oracle SQL through OrdsGatewayDb (default) or OracleDb. Rules for the gateway:
literal SQL only, one statement per call, reads never contain the words UPDATE / DELETE, CLOBs are read in
pieces. Times written by the server use the database clock (SYSTIMESTAMP); schedule times are stored as
"now + n seconds" so the server's and the database's time zones never have to agree.

MemoryStore implements the same methods in memory (demo mode and tests).
"""
from __future__ import annotations

import copy
import datetime as dt
import json
import secrets
import threading

from .sqlutil import clob_pieces, join_pieces, lit, vlit

PIPE_DDL = {
    "WMS_PIPE_SERVERS": """CREATE TABLE wms_pipe_servers (server_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, server_name VARCHAR2(100) NOT NULL,
        protocol VARCHAR2(5) DEFAULT 'http' NOT NULL, host VARCHAR2(255) NOT NULL, port NUMBER(5) DEFAULT 8000 NOT NULL, base_path VARCHAR2(200) DEFAULT '/',
        api_user VARCHAR2(100), api_token VARCHAR2(400), public_key VARCHAR2(4000), key_fingerprint VARCHAR2(100), timezone VARCHAR2(60) DEFAULT 'UTC',
        poll_seconds NUMBER DEFAULT 30, max_parallel NUMBER DEFAULT 4, is_default VARCHAR2(1) DEFAULT 'N' CHECK (is_default IN ('Y','N')),
        active VARCHAR2(1) DEFAULT 'Y' CHECK (active IN ('Y','N')), status VARCHAR2(20), server_version VARCHAR2(60), last_heartbeat TIMESTAMP,
        last_test_date DATE, last_test_msg VARCHAR2(4000), notes VARCHAR2(2000), created_by VARCHAR2(120), created_date DATE DEFAULT SYSDATE,
        updated_by VARCHAR2(120), updated_date DATE)""",
    "WMS_PIPE_CONNECTIONS": """CREATE TABLE wms_pipe_connections (conn_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, conn_name VARCHAR2(100) NOT NULL,
        conn_type VARCHAR2(20) NOT NULL, server_id NUMBER, host VARCHAR2(255), port NUMBER(5), service_name VARCHAR2(200), database_name VARCHAR2(200),
        tns_alias VARCHAR2(200), tns_descriptor VARCHAR2(4000), wallet_path VARCHAR2(500), rest_url VARCHAR2(1000), auth_type VARCHAR2(20),
        username VARCHAR2(200), password_enc VARCHAR2(4000), default_schema VARCHAR2(128), options_json VARCHAR2(4000),
        active VARCHAR2(1) DEFAULT 'Y' CHECK (active IN ('Y','N')), last_test_status VARCHAR2(20), last_test_date DATE, last_test_msg VARCHAR2(4000),
        notes VARCHAR2(2000), created_by VARCHAR2(120), created_date DATE DEFAULT SYSDATE, updated_by VARCHAR2(120), updated_date DATE,
        CONSTRAINT wms_pipe_conn_type_ck2 CHECK (conn_type IN ('ORACLE_EZ','ORACLE_TNS','ORACLE_WALLET','APEX_REST','MSSQL','MYSQL','POSTGRES','DUCKDB')))""",
    "WMS_PIPELINES": """CREATE TABLE wms_pipelines (pipeline_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, pipeline_name VARCHAR2(200) NOT NULL,
        description VARCHAR2(2000), server_id NUMBER, schedule_type VARCHAR2(20) DEFAULT 'MANUAL' NOT NULL, interval_seconds NUMBER, cron_expr VARCHAR2(100),
        timezone VARCHAR2(60), start_date DATE, end_date DATE, enabled VARCHAR2(1) DEFAULT 'N' CHECK (enabled IN ('Y','N')), params_json VARCHAR2(4000),
        on_error VARCHAR2(10) DEFAULT 'STOP', notify_email VARCHAR2(400), state VARCHAR2(20) DEFAULT 'IDLE', next_run_date TIMESTAMP, last_run_id NUMBER,
        last_run_status VARCHAR2(20), last_run_date TIMESTAMP, created_by VARCHAR2(120), created_date DATE DEFAULT SYSDATE, updated_by VARCHAR2(120),
        updated_date DATE, CONSTRAINT wms_pipelines_sched_ck CHECK (schedule_type IN ('MANUAL','INTERVAL','CRON','CONTINUOUS')))""",
    "WMS_PIPE_TASKS": """CREATE TABLE wms_pipe_tasks (task_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, pipeline_id NUMBER NOT NULL, seq NUMBER NOT NULL,
        task_name VARCHAR2(200) NOT NULL, source_type VARCHAR2(20) DEFAULT 'FUSION' NOT NULL, source_conn_id NUMBER, source_sql CLOB NOT NULL,
        target_conn_id NUMBER NOT NULL, target_object VARCHAR2(400) NOT NULL, load_mode VARCHAR2(20) DEFAULT 'APPEND' NOT NULL, key_columns VARCHAR2(1000),
        column_map_json VARCHAR2(4000), create_target VARCHAR2(1) DEFAULT 'Y' CHECK (create_target IN ('Y','N')), watermark_column VARCHAR2(128),
        last_watermark VARCHAR2(100), batch_size NUMBER DEFAULT 5000, row_limit NUMBER, timeout_seconds NUMBER DEFAULT 900, depends_on VARCHAR2(400),
        active VARCHAR2(1) DEFAULT 'Y' CHECK (active IN ('Y','N')), created_by VARCHAR2(120), created_date DATE DEFAULT SYSDATE, updated_by VARCHAR2(120),
        updated_date DATE, CONSTRAINT wms_pipe_tasks_src_ck CHECK (source_type IN ('FUSION','APEX','CONNECTION')),
        CONSTRAINT wms_pipe_tasks_mode_ck CHECK (load_mode IN ('APPEND','TRUNCATE_INSERT','MERGE','INCREMENTAL')))""",
    "WMS_PIPE_RUNS": """CREATE TABLE wms_pipe_runs (run_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, pipeline_id NUMBER NOT NULL, server_id NUMBER,
        trigger_type VARCHAR2(20), requested_by VARCHAR2(120), requested_date TIMESTAMP DEFAULT SYSTIMESTAMP, status VARCHAR2(20) DEFAULT 'QUEUED',
        cancel_requested VARCHAR2(1) DEFAULT 'N' CHECK (cancel_requested IN ('Y','N')), cycle_no NUMBER DEFAULT 1, params_json VARCHAR2(4000),
        started_date TIMESTAMP, ended_date TIMESTAMP, rows_read NUMBER DEFAULT 0, rows_written NUMBER DEFAULT 0, error_text VARCHAR2(4000))""",
    "WMS_PIPE_TASK_RUNS": """CREATE TABLE wms_pipe_task_runs (task_run_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_id NUMBER NOT NULL,
        task_id NUMBER NOT NULL, cycle_no NUMBER DEFAULT 1, status VARCHAR2(20), started_date TIMESTAMP, ended_date TIMESTAMP, rows_read NUMBER,
        rows_written NUMBER, watermark_from VARCHAR2(100), watermark_to VARCHAR2(100), error_text VARCHAR2(4000))""",
    "WMS_PIPE_LOG": """CREATE TABLE wms_pipe_log (log_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_id NUMBER, task_run_id NUMBER,
        log_time TIMESTAMP DEFAULT SYSTIMESTAMP, log_level VARCHAR2(10), message VARCHAR2(4000))""",
}


def _j(s, default):
    if not s:
        return default
    try:
        return json.loads(s)
    except (TypeError, ValueError):
        return default


def _csv(s) -> list:
    return [x.strip() for x in str(s or "").split(",") if x.strip()]


def _int(v, default=None):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


class ControlStore:
    """Interface (documentation only)."""


class OracleControlStore(ControlStore):
    def __init__(self, db):
        self.db = db
        self._lock = threading.Lock()

    def q(self, sql: str, n: int = 1000) -> list[dict]:
        with self._lock:
            return self.db.query(sql, n)

    def x(self, sql: str):
        with self._lock:
            r = self.db.execute(sql)
            self.db.commit()
            return r

    # ── setup ──
    def prepare(self) -> list[str]:
        """Creates missing control tables and lets connections be DUCKDB. Returns what it did."""
        done = []
        have = {r["TABLE_NAME"] for r in self.q("SELECT table_name FROM user_tables WHERE table_name LIKE 'WMS\\_PIPE%' ESCAPE '\\' OR table_name = 'WMS_PIPELINES'")}
        for t, ddl in PIPE_DDL.items():
            if t not in have:
                self.x(ddl)
                done.append("created " + t)
        cons = {r["CONSTRAINT_NAME"] for r in self.q("SELECT constraint_name FROM user_constraints WHERE table_name = 'WMS_PIPE_CONNECTIONS' AND constraint_type = 'C'")}
        if "WMS_PIPE_CONN_TYPE_CK2" not in cons:
            if "WMS_PIPE_CONN_TYPE_CK" in cons:
                self.x("ALTER TABLE wms_pipe_connections DROP CONSTRAINT wms_pipe_conn_type_ck")
            self.x("ALTER TABLE wms_pipe_connections ADD CONSTRAINT wms_pipe_conn_type_ck2 CHECK (conn_type IN "
                   "('ORACLE_EZ','ORACLE_TNS','ORACLE_WALLET','APEX_REST','MSSQL','MYSQL','POSTGRES','DUCKDB'))")
            done.append("connections may be DUCKDB")
        return done

    def _insert_id(self, table: str, id_col: str, cols: list[str], vals: list[str]) -> int:
        """INSERT through the gateway and get the identity back: a one-off marker in error_text finds the row."""
        mark = "srv:" + secrets.token_hex(8)
        self.x(f"INSERT INTO {table} ({', '.join(cols + ['error_text'])}) VALUES ({', '.join(vals + [lit(mark)])})")
        r = self.q(f"SELECT {id_col} AS ID FROM {table} WHERE error_text = {lit(mark)}")
        if not r:
            raise RuntimeError(f"Inserted row not found in {table}")
        new_id = _int(r[0]["ID"])
        self.x(f"UPDATE {table} SET error_text = NULL WHERE {id_col} = {new_id}")
        return new_id

    # ── server ──
    def register_server(self, name: str, host: str, port: int, api_user: str, timezone: str, version: str) -> dict:
        rows = self.q("SELECT server_id, is_default, poll_seconds, max_parallel, timezone FROM wms_pipe_servers WHERE UPPER(server_name) = UPPER(" + lit(name) + ")")
        if not rows:
            first = not self.q("SELECT 1 AS X FROM wms_pipe_servers WHERE ROWNUM = 1")
            self.x("INSERT INTO wms_pipe_servers (server_name, protocol, host, port, base_path, api_user, timezone, is_default, status, server_version, notes, created_by) VALUES (" +
                   ", ".join([lit(name), "'http'", lit(host), str(int(port)), "'/'", lit(api_user), lit(timezone), lit("Y" if first else "N"), "'ONLINE'", lit(version),
                              lit("Registered by the pipeline server itself. Add its API token in Fusion SQL › Setups › Data pipeline setups."), "'PIPELINE_SERVER'"]) + ")")
            rows = self.q("SELECT server_id, is_default, poll_seconds, max_parallel, timezone FROM wms_pipe_servers WHERE UPPER(server_name) = UPPER(" + lit(name) + ")")
        r = rows[0]
        return {"id": _int(r["SERVER_ID"]), "is_default": r.get("IS_DEFAULT") == "Y", "poll_seconds": _int(r.get("POLL_SECONDS"), 30),
                "max_parallel": _int(r.get("MAX_PARALLEL"), 4), "timezone": r.get("TIMEZONE") or "UTC"}

    def server_settings(self, server_id: int) -> dict:
        r = self.q(f"SELECT is_default, poll_seconds, max_parallel, timezone, active FROM wms_pipe_servers WHERE server_id = {int(server_id)}")
        if not r:
            return {}
        r = r[0]
        return {"is_default": r.get("IS_DEFAULT") == "Y", "poll_seconds": _int(r.get("POLL_SECONDS"), 30), "max_parallel": _int(r.get("MAX_PARALLEL"), 4),
                "timezone": r.get("TIMEZONE") or "UTC", "active": r.get("ACTIVE") != "N"}

    def heartbeat(self, server_id: int, status: str, version: str, note: str, public_key: str | None = None, fingerprint: str | None = None):
        self.x("UPDATE wms_pipe_servers SET last_heartbeat = SYSTIMESTAMP, status = " + vlit(status, 20) + ", server_version = " + vlit(version, 60) +
               ", last_test_msg = " + vlit(note, 4000) +
               (", public_key = " + vlit(public_key, 4000) + ", key_fingerprint = " + vlit(fingerprint, 100) if public_key else "") +
               f" WHERE server_id = {int(server_id)}")

    # ── definitions ──
    _PCOLS = ("pipeline_id, pipeline_name, description, server_id, schedule_type, interval_seconds, cron_expr, timezone, enabled, params_json, on_error, "
              "notify_email, state, last_run_id, last_run_status, TO_CHAR(start_date, 'YYYY-MM-DD HH24:MI:SS') AS start_at, TO_CHAR(end_date, 'YYYY-MM-DD HH24:MI:SS') AS end_at, "
              "ROUND((CAST(SYSTIMESTAMP AS DATE) - CAST(last_run_date AS DATE)) * 86400) AS last_run_secs, "
              "ROUND((CAST(next_run_date AS DATE) - CAST(SYSTIMESTAMP AS DATE)) * 86400) AS next_run_secs")

    def _pipe(self, r: dict) -> dict:
        return {"id": _int(r["PIPELINE_ID"]), "name": r.get("PIPELINE_NAME"), "description": r.get("DESCRIPTION") or "", "server_id": _int(r.get("SERVER_ID")),
                "schedule": r.get("SCHEDULE_TYPE") or "MANUAL", "interval": _int(r.get("INTERVAL_SECONDS")), "cron": r.get("CRON_EXPR") or "",
                "timezone": r.get("TIMEZONE") or "", "enabled": r.get("ENABLED") == "Y", "params": _j(r.get("PARAMS_JSON"), {}), "on_error": r.get("ON_ERROR") or "STOP",
                "notify_email": r.get("NOTIFY_EMAIL") or "", "state": r.get("STATE") or "IDLE", "last_run_id": _int(r.get("LAST_RUN_ID")),
                "last_run_status": r.get("LAST_RUN_STATUS"), "last_run_secs": _int(r.get("LAST_RUN_SECS")), "next_run_secs": _int(r.get("NEXT_RUN_SECS")),
                "start_at": r.get("START_AT"), "end_at": r.get("END_AT")}

    def pipelines(self, server_id: int, is_default: bool) -> list[dict]:
        where = f"server_id = {int(server_id)}" + (" OR server_id IS NULL" if is_default else "")
        return [self._pipe(r) for r in self.q(f"SELECT {self._PCOLS} FROM wms_pipelines WHERE {where} ORDER BY pipeline_name")]

    def pipeline(self, pid: int) -> dict | None:
        r = self.q(f"SELECT {self._PCOLS} FROM wms_pipelines WHERE pipeline_id = {int(pid)}")
        return self._pipe(r[0]) if r else None

    def tasks(self, pid: int) -> list[dict]:
        rows = self.q("SELECT task_id, pipeline_id, seq, task_name, source_type, source_conn_id, target_conn_id, target_object, load_mode, key_columns, "
                      "column_map_json, create_target, watermark_column, last_watermark, batch_size, row_limit, timeout_seconds, depends_on, active, "
                      "NVL(LENGTH(source_sql), 0) AS sql_len, " + clob_pieces("source_sql") +
                      f" FROM wms_pipe_tasks WHERE pipeline_id = {int(pid)} ORDER BY seq, task_id")
        out = []
        for r in rows:
            out.append({"id": _int(r["TASK_ID"]), "pipeline_id": _int(r["PIPELINE_ID"]), "seq": _int(r.get("SEQ"), 0), "name": r.get("TASK_NAME"),
                        "source_type": r.get("SOURCE_TYPE") or "FUSION", "source_conn_id": _int(r.get("SOURCE_CONN_ID")), "sql": join_pieces(r),
                        "sql_len": _int(r.get("SQL_LEN"), 0), "target_conn_id": _int(r.get("TARGET_CONN_ID")), "target": r.get("TARGET_OBJECT") or "",
                        "mode": r.get("LOAD_MODE") or "APPEND", "keys": _csv(r.get("KEY_COLUMNS")), "column_map": _j(r.get("COLUMN_MAP_JSON"), {}),
                        "create_target": r.get("CREATE_TARGET") != "N", "wm_col": r.get("WATERMARK_COLUMN") or "", "watermark": r.get("LAST_WATERMARK") or "",
                        "batch": _int(r.get("BATCH_SIZE"), 5000), "row_limit": _int(r.get("ROW_LIMIT")), "timeout": _int(r.get("TIMEOUT_SECONDS"), 900),
                        "depends_on": [_int(x) for x in _csv(r.get("DEPENDS_ON")) if _int(x)], "active": r.get("ACTIVE") != "N"})
        return out

    def connection(self, cid: int) -> dict | None:
        r = self.q("SELECT conn_id, conn_name, conn_type, host, port, service_name, database_name, tns_alias, tns_descriptor, wallet_path, rest_url, auth_type, "
                   f"username, password_enc, default_schema, options_json, active FROM wms_pipe_connections WHERE conn_id = {int(cid)}")
        if not r:
            return None
        r = r[0]
        return {"id": _int(r["CONN_ID"]), "name": r.get("CONN_NAME"), "type": r.get("CONN_TYPE"), "host": r.get("HOST"), "port": _int(r.get("PORT")),
                "service_name": r.get("SERVICE_NAME"), "database_name": r.get("DATABASE_NAME"), "tns_alias": r.get("TNS_ALIAS"), "tns_descriptor": r.get("TNS_DESCRIPTOR"),
                "wallet_path": r.get("WALLET_PATH"), "rest_url": r.get("REST_URL"), "auth_type": r.get("AUTH_TYPE"), "username": r.get("USERNAME"),
                "password_enc": r.get("PASSWORD_ENC"), "default_schema": r.get("DEFAULT_SCHEMA"), "options": _j(r.get("OPTIONS_JSON"), {}), "active": r.get("ACTIVE") != "N"}

    def connections(self) -> list[dict]:
        return [{"id": _int(r["CONN_ID"]), "name": r.get("CONN_NAME"), "type": r.get("CONN_TYPE"), "status": r.get("LAST_TEST_STATUS"), "msg": r.get("LAST_TEST_MSG")}
                for r in self.q("SELECT conn_id, conn_name, conn_type, last_test_status, last_test_msg FROM wms_pipe_connections ORDER BY conn_name")]

    def set_connection_test(self, cid: int, ok: bool, msg: str):
        self.x(f"UPDATE wms_pipe_connections SET last_test_status = {lit('OK' if ok else 'ERROR')}, last_test_date = SYSDATE, last_test_msg = {vlit(msg, 4000)} WHERE conn_id = {int(cid)}")

    # ── runs ──
    _RCOLS = ("r.run_id, r.pipeline_id, p.pipeline_name, r.server_id, r.trigger_type, r.requested_by, r.status, r.cancel_requested, r.cycle_no, r.params_json, "
              "r.rows_read, r.rows_written, r.error_text, TO_CHAR(r.requested_date, 'YYYY-MM-DD HH24:MI:SS') AS requested_at, "
              "TO_CHAR(r.started_date, 'YYYY-MM-DD HH24:MI:SS') AS started_at, TO_CHAR(r.ended_date, 'YYYY-MM-DD HH24:MI:SS') AS ended_at, "
              "ROUND((CAST(NVL(r.ended_date, SYSTIMESTAMP) AS DATE) - CAST(r.started_date AS DATE)) * 86400) AS secs")

    def _run(self, r: dict) -> dict:
        return {"id": _int(r["RUN_ID"]), "pipeline_id": _int(r["PIPELINE_ID"]), "pipeline": r.get("PIPELINE_NAME") or "", "server_id": _int(r.get("SERVER_ID")),
                "trigger": r.get("TRIGGER_TYPE"), "by": r.get("REQUESTED_BY"), "status": r.get("STATUS"), "cancel": r.get("CANCEL_REQUESTED") == "Y",
                "cycle": _int(r.get("CYCLE_NO"), 1), "params": _j(r.get("PARAMS_JSON"), {}), "rows_read": _int(r.get("ROWS_READ"), 0),
                "rows_written": _int(r.get("ROWS_WRITTEN"), 0), "error": r.get("ERROR_TEXT") or "", "requested": r.get("REQUESTED_AT"),
                "started": r.get("STARTED_AT"), "ended": r.get("ENDED_AT"), "secs": _int(r.get("SECS"))}

    def queued_runs(self, pipeline_ids: list[int]) -> list[dict]:
        if not pipeline_ids:
            return []
        ids = ",".join(str(int(i)) for i in pipeline_ids)
        return [self._run(r) for r in self.q(f"SELECT {self._RCOLS} FROM wms_pipe_runs r JOIN wms_pipelines p ON p.pipeline_id = r.pipeline_id "
                                             f"WHERE r.status = 'QUEUED' AND r.pipeline_id IN ({ids}) ORDER BY r.run_id")]

    def create_run(self, pid: int, server_id: int, trigger: str, by: str, params: dict) -> int:
        return self._insert_id("wms_pipe_runs", "run_id", ["pipeline_id", "server_id", "trigger_type", "requested_by", "status", "params_json"],
                               [str(int(pid)), str(int(server_id)), lit(trigger), vlit(by, 120), "'QUEUED'", vlit(json.dumps(params or {}), 4000)])

    def claim_run(self, run_id: int, server_id: int) -> bool:
        self.x(f"UPDATE wms_pipe_runs SET status = 'RUNNING', server_id = {int(server_id)}, started_date = SYSTIMESTAMP WHERE run_id = {int(run_id)} AND status = 'QUEUED'")
        r = self.q(f"SELECT status, server_id FROM wms_pipe_runs WHERE run_id = {int(run_id)}")
        return bool(r) and r[0].get("STATUS") == "RUNNING" and _int(r[0].get("SERVER_ID")) == int(server_id)

    def run(self, run_id: int) -> dict | None:
        r = self.q(f"SELECT {self._RCOLS} FROM wms_pipe_runs r JOIN wms_pipelines p ON p.pipeline_id = r.pipeline_id WHERE r.run_id = {int(run_id)}")
        return self._run(r[0]) if r else None

    def cancel_flags(self, run_ids: list[int]) -> dict[int, bool]:
        if not run_ids:
            return {}
        rows = self.q(f"SELECT run_id, cancel_requested FROM wms_pipe_runs WHERE run_id IN ({','.join(str(int(i)) for i in run_ids)})")
        return {_int(r["RUN_ID"]): r.get("CANCEL_REQUESTED") == "Y" for r in rows}

    def request_cancel(self, run_id: int):
        self.x("UPDATE wms_pipe_runs SET cancel_requested = 'Y', status = CASE WHEN status = 'QUEUED' THEN 'CANCELLED' ELSE status END, "
               f"ended_date = CASE WHEN status = 'QUEUED' THEN SYSTIMESTAMP ELSE ended_date END WHERE run_id = {int(run_id)}")

    def set_run(self, run_id: int, status: str | None = None, ended: bool = False, rows_read: int | None = None, rows_written: int | None = None,
                error: str | None = None, cycle: int | None = None):
        sets = []
        if status:
            sets.append("status = " + lit(status))
        if ended:
            sets.append("ended_date = SYSTIMESTAMP")
        if rows_read is not None:
            sets.append(f"rows_read = {int(rows_read)}")
        if rows_written is not None:
            sets.append(f"rows_written = {int(rows_written)}")
        if error is not None:
            sets.append("error_text = " + vlit(error, 4000))
        if cycle is not None:
            sets.append(f"cycle_no = {int(cycle)}")
        if sets:
            self.x(f"UPDATE wms_pipe_runs SET {', '.join(sets)} WHERE run_id = {int(run_id)}")

    def requeue_interrupted(self, server_id: int) -> list[int]:
        rows = self.q(f"SELECT run_id FROM wms_pipe_runs WHERE status = 'RUNNING' AND server_id = {int(server_id)}")
        ids = [_int(r["RUN_ID"]) for r in rows]
        for i in ids:
            self.x(f"UPDATE wms_pipe_runs SET status = CASE WHEN cancel_requested = 'Y' THEN 'CANCELLED' ELSE 'QUEUED' END, "
                   f"ended_date = CASE WHEN cancel_requested = 'Y' THEN SYSTIMESTAMP ELSE NULL END WHERE run_id = {i}")
            self.x(f"UPDATE wms_pipe_task_runs SET status = 'CANCELLED', ended_date = SYSTIMESTAMP, error_text = 'Server restarted' WHERE run_id = {i} AND status = 'RUNNING'")
        return ids

    def recent_runs(self, limit: int = 50, pipeline_id: int | None = None) -> list[dict]:
        where = f"WHERE r.pipeline_id = {int(pipeline_id)}" if pipeline_id else ""
        return [self._run(r) for r in self.q(f"SELECT {self._RCOLS} FROM wms_pipe_runs r JOIN wms_pipelines p ON p.pipeline_id = r.pipeline_id {where} "
                                             f"ORDER BY r.run_id DESC FETCH FIRST {int(limit)} ROWS ONLY", limit)]

    # ── task runs, watermarks, logs ──
    def create_task_run(self, run_id: int, task_id: int, cycle: int, wm_from: str | None) -> int:
        return self._insert_id("wms_pipe_task_runs", "task_run_id", ["run_id", "task_id", "cycle_no", "status", "started_date", "watermark_from", "rows_read", "rows_written"],
                               [str(int(run_id)), str(int(task_id)), str(int(cycle)), "'RUNNING'", "SYSTIMESTAMP", vlit(wm_from, 100), "0", "0"])

    def set_task_run(self, tr_id: int, status: str | None = None, rows_read: int | None = None, rows_written: int | None = None,
                     wm_to: str | None = None, error: str | None = None, ended: bool = False):
        sets = []
        if status:
            sets.append("status = " + lit(status))
        if rows_read is not None:
            sets.append(f"rows_read = {int(rows_read)}")
        if rows_written is not None:
            sets.append(f"rows_written = {int(rows_written)}")
        if wm_to is not None:
            sets.append("watermark_to = " + vlit(wm_to, 100))
        if error is not None:
            sets.append("error_text = " + vlit(error, 4000))
        if ended:
            sets.append("ended_date = SYSTIMESTAMP")
        if sets:
            self.x(f"UPDATE wms_pipe_task_runs SET {', '.join(sets)} WHERE task_run_id = {int(tr_id)}")

    def task_runs(self, run_id: int) -> list[dict]:
        rows = self.q("SELECT tr.task_run_id, tr.task_id, t.task_name, tr.cycle_no, tr.status, tr.rows_read, tr.rows_written, tr.watermark_from, tr.watermark_to, tr.error_text, "
                      "ROUND((CAST(NVL(tr.ended_date, SYSTIMESTAMP) AS DATE) - CAST(tr.started_date AS DATE)) * 86400) AS secs "
                      f"FROM wms_pipe_task_runs tr LEFT JOIN wms_pipe_tasks t ON t.task_id = tr.task_id WHERE tr.run_id = {int(run_id)} ORDER BY tr.task_run_id")
        return [{"id": _int(r["TASK_RUN_ID"]), "task_id": _int(r["TASK_ID"]), "task": r.get("TASK_NAME") or "", "cycle": _int(r.get("CYCLE_NO"), 1),
                 "status": r.get("STATUS"), "rows_read": _int(r.get("ROWS_READ"), 0), "rows_written": _int(r.get("ROWS_WRITTEN"), 0),
                 "wm_from": r.get("WATERMARK_FROM"), "wm_to": r.get("WATERMARK_TO"), "error": r.get("ERROR_TEXT") or "", "secs": _int(r.get("SECS"))} for r in rows]

    def set_watermark(self, task_id: int, value: str | None):
        self.x(f"UPDATE wms_pipe_tasks SET last_watermark = {vlit(value, 100)} WHERE task_id = {int(task_id)}")

    def set_pipeline(self, pid: int, state: str | None = None, next_in_secs: int | None = None, clear_next: bool = False,
                     last_run_id: int | None = None, last_status: str | None = None):
        sets = []
        if state:
            sets.append("state = " + lit(state))
        if next_in_secs is not None:
            sets.append(f"next_run_date = SYSTIMESTAMP + NUMTODSINTERVAL({int(next_in_secs)}, 'SECOND')")
        elif clear_next:
            sets.append("next_run_date = NULL")
        if last_run_id is not None:
            sets.append(f"last_run_id = {int(last_run_id)}")
        if last_status:
            sets.append("last_run_status = " + lit(last_status) + ", last_run_date = SYSTIMESTAMP")
        if sets:
            self.x(f"UPDATE wms_pipelines SET {', '.join(sets)} WHERE pipeline_id = {int(pid)}")

    def add_logs(self, entries: list[tuple]):
        """entries: (run_id, task_run_id, level, message, age_seconds). One INSERT … SELECT … UNION ALL (identity-safe)."""
        for i in range(0, len(entries), 40):
            part = entries[i:i + 40]
            sel = " UNION ALL ".join(
                f"SELECT {int(e[0]) if e[0] else 'NULL'}, {int(e[1]) if e[1] else 'NULL'}, SYSTIMESTAMP - NUMTODSINTERVAL({max(0.0, float(e[4])):.3f}, 'SECOND'), "
                f"{lit(e[2])}, {vlit(e[3], 3900)} FROM dual" for e in part)
            self.x(f"INSERT INTO wms_pipe_log (run_id, task_run_id, log_time, log_level, message) {sel}")

    def logs(self, run_id: int, after_id: int = 0, limit: int = 500) -> list[dict]:
        rows = self.q("SELECT log_id, task_run_id, TO_CHAR(log_time, 'HH24:MI:SS') AS t, log_level, message FROM wms_pipe_log "
                      f"WHERE run_id = {int(run_id)} AND log_id > {int(after_id)} ORDER BY log_id FETCH FIRST {int(limit)} ROWS ONLY", limit)
        return [{"id": _int(r["LOG_ID"]), "task_run_id": _int(r.get("TASK_RUN_ID")), "time": r.get("T"), "level": r.get("LOG_LEVEL"), "message": r.get("MESSAGE")} for r in rows]


# ═══════════════════════════════════════════════════════════════
class MemoryStore(ControlStore):
    """Same API, in memory. demo=True seeds sample pipelines (console tour without any database)."""

    def __init__(self, demo: bool = False):
        self._lock = threading.RLock()
        self.servers, self.pipes, self.tasks_, self.conns, self.runs, self.task_runs_, self.logs_ = {}, {}, {}, {}, {}, {}, []
        self._ids = {}
        self._clock = dt.datetime.now
        if demo:
            self.seed_demo()

    def _next(self, k):
        self._ids[k] = self._ids.get(k, 0) + 1
        return self._ids[k]

    def prepare(self):
        return []

    def register_server(self, name, host, port, api_user, timezone, version):
        with self._lock:
            for s in self.servers.values():
                if s["name"].upper() == name.upper():
                    return {"id": s["id"], "is_default": s["is_default"], "poll_seconds": s["poll"], "max_parallel": s["max_parallel"], "timezone": s["timezone"]}
            sid = self._next("server")
            self.servers[sid] = {"id": sid, "name": name, "is_default": not self.servers, "poll": 5, "max_parallel": 4, "timezone": timezone, "status": "ONLINE"}
            return self.register_server(name, host, port, api_user, timezone, version)

    def server_settings(self, server_id):
        s = self.servers.get(server_id) or {}
        return {"is_default": s.get("is_default", True), "poll_seconds": s.get("poll", 5), "max_parallel": s.get("max_parallel", 4), "timezone": s.get("timezone", "UTC"), "active": True}

    def heartbeat(self, server_id, status, version, note, public_key=None, fingerprint=None):
        with self._lock:
            s = self.servers.get(server_id)
            if s:
                s.update(status=status, version=version, note=note, heartbeat=self._clock())

    def add_pipeline(self, **p) -> int:
        with self._lock:
            pid = self._next("pipe")
            d = {"id": pid, "name": f"Pipeline {pid}", "description": "", "server_id": None, "schedule": "MANUAL", "interval": None, "cron": "", "timezone": "",
                 "enabled": False, "params": {}, "on_error": "STOP", "notify_email": "", "state": "IDLE", "last_run_id": None, "last_run_status": None,
                 "last_run_at": None, "next_run_at": None, "start_at": None, "end_at": None}
            d.update(p)
            self.pipes[pid] = d
            return pid

    def add_task(self, **t) -> int:
        with self._lock:
            tid = self._next("task")
            d = {"id": tid, "pipeline_id": None, "seq": 10, "name": f"Task {tid}", "source_type": "FUSION", "source_conn_id": None, "sql": "", "sql_len": 0,
                 "target_conn_id": None, "target": "", "mode": "APPEND", "keys": [], "column_map": {}, "create_target": True, "wm_col": "", "watermark": "",
                 "batch": 5000, "row_limit": None, "timeout": 900, "depends_on": [], "active": True}
            d.update(t)
            d["sql_len"] = len(d["sql"])
            self.tasks_[tid] = d
            return tid

    def add_connection(self, **c) -> int:
        with self._lock:
            cid = self._next("conn")
            d = {"id": cid, "name": f"Connection {cid}", "type": "DUCKDB", "options": {}, "active": True, "status": None, "msg": None}
            d.update(c)
            self.conns[cid] = d
            return cid

    def _view(self, p):
        now = self._clock()
        v = {k: v for k, v in p.items() if k not in ("last_run_at", "next_run_at")}
        v["last_run_secs"] = int((now - p["last_run_at"]).total_seconds()) if p.get("last_run_at") else None
        v["next_run_secs"] = int((p["next_run_at"] - now).total_seconds()) if p.get("next_run_at") else None
        return copy.deepcopy(v)

    def pipelines(self, server_id, is_default):
        return [self._view(p) for p in sorted(self.pipes.values(), key=lambda x: x["name"]) if p["server_id"] == server_id or (is_default and p["server_id"] is None)]

    def pipeline(self, pid):
        p = self.pipes.get(pid)
        return self._view(p) if p else None

    def tasks(self, pid):
        return [copy.deepcopy(t) for t in sorted(self.tasks_.values(), key=lambda t: (t["seq"], t["id"])) if t["pipeline_id"] == pid]

    def connection(self, cid):
        return copy.deepcopy(self.conns.get(cid))

    def connections(self):
        return [{"id": c["id"], "name": c["name"], "type": c["type"], "status": c.get("status"), "msg": c.get("msg")} for c in self.conns.values()]

    def set_connection_test(self, cid, ok, msg):
        if cid in self.conns:
            self.conns[cid].update(status="OK" if ok else "ERROR", msg=msg)

    def _runv(self, r):
        v = copy.deepcopy(r)
        v["pipeline"] = (self.pipes.get(r["pipeline_id"]) or {}).get("name", "")
        st = r.get("_started")
        v["secs"] = int(((r.get("_ended") or self._clock()) - st).total_seconds()) if st else None
        v["started"] = st.strftime("%Y-%m-%d %H:%M:%S") if st else None
        v["ended"] = r["_ended"].strftime("%Y-%m-%d %H:%M:%S") if r.get("_ended") else None
        for k in ("_started", "_ended", "_requested"):
            v.pop(k, None)
        return v

    def queued_runs(self, pipeline_ids):
        return [self._runv(r) for r in sorted(self.runs.values(), key=lambda r: r["id"]) if r["status"] == "QUEUED" and r["pipeline_id"] in pipeline_ids]

    def create_run(self, pid, server_id, trigger, by, params):
        with self._lock:
            rid = self._next("run")
            self.runs[rid] = {"id": rid, "pipeline_id": pid, "server_id": server_id, "trigger": trigger, "by": by, "status": "QUEUED", "cancel": False,
                              "cycle": 1, "params": params or {}, "rows_read": 0, "rows_written": 0, "error": "", "requested": self._clock().strftime("%Y-%m-%d %H:%M:%S"),
                              "_requested": self._clock(), "_started": None, "_ended": None}
            return rid

    def claim_run(self, run_id, server_id):
        with self._lock:
            r = self.runs.get(run_id)
            if not r or r["status"] != "QUEUED":
                return False
            r.update(status="RUNNING", server_id=server_id, _started=self._clock())
            return True

    def run(self, run_id):
        r = self.runs.get(run_id)
        return self._runv(r) if r else None

    def cancel_flags(self, run_ids):
        return {i: self.runs[i]["cancel"] for i in run_ids if i in self.runs}

    def request_cancel(self, run_id):
        with self._lock:
            r = self.runs.get(run_id)
            if r:
                r["cancel"] = True
                if r["status"] == "QUEUED":
                    r.update(status="CANCELLED", _ended=self._clock())

    def set_run(self, run_id, status=None, ended=False, rows_read=None, rows_written=None, error=None, cycle=None):
        with self._lock:
            r = self.runs[run_id]
            if status:
                r["status"] = status
            if ended:
                r["_ended"] = self._clock()
            if rows_read is not None:
                r["rows_read"] = rows_read
            if rows_written is not None:
                r["rows_written"] = rows_written
            if error is not None:
                r["error"] = error
            if cycle is not None:
                r["cycle"] = cycle

    def requeue_interrupted(self, server_id):
        ids = [r["id"] for r in self.runs.values() if r["status"] == "RUNNING" and r["server_id"] == server_id]
        for i in ids:
            self.runs[i]["status"] = "CANCELLED" if self.runs[i]["cancel"] else "QUEUED"
        return ids

    def recent_runs(self, limit=50, pipeline_id=None):
        rs = [r for r in self.runs.values() if not pipeline_id or r["pipeline_id"] == pipeline_id]
        return [self._runv(r) for r in sorted(rs, key=lambda r: -r["id"])[:limit]]

    def create_task_run(self, run_id, task_id, cycle, wm_from):
        with self._lock:
            i = self._next("tr")
            self.task_runs_[i] = {"id": i, "run_id": run_id, "task_id": task_id, "cycle": cycle, "status": "RUNNING", "rows_read": 0, "rows_written": 0,
                                  "wm_from": wm_from, "wm_to": None, "error": "", "_started": self._clock(), "_ended": None}
            return i

    def set_task_run(self, tr_id, status=None, rows_read=None, rows_written=None, wm_to=None, error=None, ended=False):
        with self._lock:
            t = self.task_runs_[tr_id]
            for k, v in (("status", status), ("rows_read", rows_read), ("rows_written", rows_written), ("wm_to", wm_to), ("error", error)):
                if v is not None:
                    t[k] = v
            if ended:
                t["_ended"] = self._clock()

    def task_runs(self, run_id):
        out = []
        for t in sorted(self.task_runs_.values(), key=lambda t: t["id"]):
            if t["run_id"] == run_id:
                v = {k: v for k, v in t.items() if not k.startswith("_")}
                v["task"] = (self.tasks_.get(t["task_id"]) or {}).get("name", "")
                v["secs"] = int(((t["_ended"] or self._clock()) - t["_started"]).total_seconds())
                out.append(v)
        return out

    def set_watermark(self, task_id, value):
        if task_id in self.tasks_:
            self.tasks_[task_id]["watermark"] = value or ""

    def set_pipeline(self, pid, state=None, next_in_secs=None, clear_next=False, last_run_id=None, last_status=None):
        with self._lock:
            p = self.pipes.get(pid)
            if not p:
                return
            if state:
                p["state"] = state
            if next_in_secs is not None:
                p["next_run_at"] = self._clock() + dt.timedelta(seconds=next_in_secs)
            elif clear_next:
                p["next_run_at"] = None
            if last_run_id is not None:
                p["last_run_id"] = last_run_id
            if last_status:
                p["last_run_status"] = last_status
                p["last_run_at"] = self._clock()

    def add_logs(self, entries):
        with self._lock:
            for e in entries:
                self.logs_.append({"id": self._next("log"), "run_id": e[0], "task_run_id": e[1], "level": e[2], "message": e[3],
                                   "time": (self._clock() - dt.timedelta(seconds=float(e[4]))).strftime("%H:%M:%S")})

    def logs(self, run_id, after_id=0, limit=500):
        return [dict(l) for l in self.logs_ if l["run_id"] == run_id and l["id"] > after_id][:limit]

    # ── demo data ──
    def seed_demo(self):
        """Sample definitions: Fusion source is replaced by generated rows in demo mode (see connectors.DemoSource)."""
        import os
        from .config import home
        duck = self.add_connection(name="Local DuckDB (demo)", type="DUCKDB", database_name=str(home() / "demo.duckdb"))
        p1 = self.add_pipeline(name="AR invoices → DuckDB (incremental)", description="Every 2 minutes, only invoices changed since the last run",
                               schedule="INTERVAL", interval=120, enabled=True)
        self.add_task(pipeline_id=p1, seq=10, name="RA_CUSTOMER_TRX_ALL", source_type="FUSION", target_conn_id=duck, target="AR_INVOICES",
                      mode="INCREMENTAL", keys=["CUSTOMER_TRX_ID"], wm_col="LAST_UPDATE_DATE",
                      sql="SELECT customer_trx_id, trx_number, trx_date, bill_to_customer_id, invoice_currency_code, last_update_date FROM ra_customer_trx_all")
        p2 = self.add_pipeline(name="Item master full refresh", description="Nightly full copy", schedule="CRON", cron="0 2 * * *", enabled=True)
        self.add_task(pipeline_id=p2, seq=10, name="EGP_SYSTEM_ITEMS_B", source_type="FUSION", target_conn_id=duck, target="ITEMS",
                      mode="TRUNCATE_INSERT", keys=["INVENTORY_ITEM_ID"], sql="SELECT inventory_item_id, item_number, description FROM egp_system_items_b")
        p3 = self.add_pipeline(name="Open orders - continuous", description="Keeps the open order lines fresh", schedule="CONTINUOUS", interval=30, enabled=False)
        self.add_task(pipeline_id=p3, seq=10, name="DOO lines", source_type="FUSION", target_conn_id=duck, target="OPEN_LINES", mode="MERGE",
                      keys=["FULFILL_LINE_ID"], sql="SELECT fulfill_line_id, status_code, ordered_qty FROM doo_fulfill_lines_all")
        _ = os
