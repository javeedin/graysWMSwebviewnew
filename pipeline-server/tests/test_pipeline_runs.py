"""End to end: MemoryStore control tables, a DuckDB file as the source (real SQL for paging / watermarks)
and another DuckDB file as the target."""
import datetime as dt
import threading
import time

import duckdb
import pytest
from fastapi.testclient import TestClient

from pipeline_server.config import ServerConfig
from pipeline_server.connectors import QuerySpec, build_query, infer_type, page_sql, parse_ts
from pipeline_server.control import MemoryStore
from pipeline_server.engine import Supervisor
from pipeline_server.runner import RunContext, execute_run


@pytest.fixture
def env(tmp_path):
    src_path, tgt_path = str(tmp_path / "src.duckdb"), str(tmp_path / "tgt.duckdb")
    con = duckdb.connect(src_path)
    con.execute("CREATE TABLE orders (order_id INTEGER, customer VARCHAR, amount DECIMAL(12,2), status VARCHAR, last_update_date TIMESTAMP)")
    base = dt.datetime(2026, 9, 1, 8, 0, 0)
    con.executemany("INSERT INTO orders VALUES (?, ?, ?, ?, ?)",
                    [(i, f"Cust {i % 7}", 10 * i + 0.5, "OPEN", base + dt.timedelta(minutes=i)) for i in range(1, 2501)])
    con.close()
    store = MemoryStore()
    src = store.add_connection(name="source", type="DUCKDB", database_name=src_path)
    tgt = store.add_connection(name="target", type="DUCKDB", database_name=tgt_path)
    cfg = ServerConfig()
    cfg.control.driver = "test"
    cfg.page_size = 500
    srv = store.register_server("T", "localhost", 8000, "pipeline", "UTC", "t")
    return {"store": store, "src": src, "tgt": tgt, "src_path": src_path, "tgt_path": tgt_path, "cfg": cfg, "server": srv}


def make_pipe(env, mode="INCREMENTAL", keys=("ORDER_ID",), wm="LAST_UPDATE_DATE", schedule="MANUAL", sql="SELECT * FROM orders", **kw):
    s = env["store"]
    pid = s.add_pipeline(name=f"p-{mode}", schedule=schedule, enabled=True, **kw)
    tid = s.add_task(pipeline_id=pid, name="orders", source_type="CONNECTION", source_conn_id=env["src"], sql=sql,
                     target_conn_id=env["tgt"], target="ORDERS_COPY", mode=mode, keys=list(keys), wm_col=wm, batch=500)
    return pid, tid


def run_once(env, pid, params=None, cancel=lambda: False):
    s = env["store"]
    rid = s.create_run(pid, env["server"]["id"], "MANUAL", "test", params or {})
    assert s.claim_run(rid, env["server"]["id"])
    events = []
    ctx = RunContext(env["cfg"], s, env["server"]["id"], emit=events.append, cancel_requested=cancel)
    status = execute_run(ctx, rid)
    return rid, status, events


def tgt_rows(env, sql="SELECT COUNT(*) FROM ORDERS_COPY"):
    con = duckdb.connect(env["tgt_path"], read_only=True)
    try:
        return con.execute(sql).fetchall()
    finally:
        con.close()


def test_incremental_merge_loads_only_changes(env):
    pid, tid = make_pipe(env)
    rid, status, events = run_once(env, pid)
    assert status == "SUCCESS", env["store"].runs[rid]["error"]
    assert tgt_rows(env) == [(2500,)]
    t = env["store"].tasks_[tid]
    assert t["watermark"].startswith("2026-09-03 01:40:00")        # last row: 1 Sep 08:00 + 2500 min
    assert sum(1 for e in events if e["type"] == "progress") == 5     # 5 pages of 500
    types = dict(tgt_rows(env, "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'ORDERS_COPY'"))
    assert types["LAST_UPDATE_DATE"] == "TIMESTAMP" and types["ORDER_ID"].startswith("DECIMAL") and types["CUSTOMER"] == "VARCHAR"

    # change 3 rows in the source, add 2 new ones
    con = duckdb.connect(env["src_path"])
    later = dt.datetime(2026, 9, 3, 9, 0, 0)
    con.execute("UPDATE orders SET status = 'CLOSED', last_update_date = ? WHERE order_id IN (5, 6, 7)", [later])
    con.executemany("INSERT INTO orders VALUES (?, 'New', 1, 'OPEN', ?)", [(9001, later), (9002, later)])
    con.close()
    rid2, status2, _ = run_once(env, pid)
    assert status2 == "SUCCESS"
    r2 = env["store"].runs[rid2]
    assert 5 <= r2["rows_read"] <= 12                                  # the 5 changes + the rows inside the 5-minute overlap
    assert tgt_rows(env) == [(2502,)]
    assert tgt_rows(env, "SELECT status FROM ORDERS_COPY WHERE order_id = 6") == [("CLOSED",)]
    # nothing new → nothing read, target untouched
    rid3, status3, _ = run_once(env, pid)
    assert status3 == "SUCCESS" and tgt_rows(env) == [(2502,)]


def test_full_refresh_and_append(env):
    pid, _ = make_pipe(env, mode="TRUNCATE_INSERT", wm="")
    assert run_once(env, pid)[1] == "SUCCESS"
    assert run_once(env, pid)[1] == "SUCCESS"
    assert tgt_rows(env) == [(2500,)]                                  # emptied before the second load
    pid2, _ = make_pipe(env, mode="APPEND", keys=(), wm="", sql="SELECT order_id, amount FROM orders WHERE order_id <= 10")
    env["store"].tasks_[max(env["store"].tasks_)]["target"] = "SMALL"
    assert run_once(env, pid2)[1] == "SUCCESS"
    assert run_once(env, pid2)[1] == "SUCCESS"
    assert tgt_rows(env, "SELECT COUNT(*) FROM SMALL") == [(20,)]      # append adds again


def test_failure_skip_and_cancel(env):
    s = env["store"]
    pid, t1 = make_pipe(env, mode="MERGE", keys=(), wm="")             # MERGE without keys → fails
    t2 = s.add_task(pipeline_id=pid, seq=20, name="after", source_type="CONNECTION", source_conn_id=env["src"], sql="SELECT 1 AS x",
                    target_conn_id=env["tgt"], target="X", mode="APPEND", depends_on=[t1])
    rid, status, _ = run_once(env, pid)
    assert status == "FAILED" and "key columns" in s.runs[rid]["error"]
    s.pipes[pid]["on_error"] = "CONTINUE"
    rid, status, _ = run_once(env, pid)
    trs = s.task_runs(rid)
    assert status == "FAILED" and [t["status"] for t in trs] == ["FAILED"]   # the dependent task was skipped, not run
    assert any("skipped" in l["message"] for l in s.logs(rid))
    # cancel after the first page
    pid3, _ = make_pipe(env, mode="INCREMENTAL")
    calls = {"n": 0}

    def cancel():
        calls["n"] += 1
        return calls["n"] > 2
    rid, status, _ = run_once(env, pid3, cancel=cancel)
    assert status == "CANCELLED"
    assert 0 < s.runs[rid]["rows_read"] < 2500 or s.task_runs(rid)[0]["rows_read"] < 2500


def test_query_building_and_types():
    spec = QuerySpec(sql="SELECT * FROM t", wm_col="last_update_date", wm_value="2026-09-01 10:00:00.000000", wm_op=">=", overlap_s=300, keys=["id"])
    q, ordered = build_query(spec, "oracle")
    assert ordered and "CAST(s.LAST_UPDATE_DATE AS TIMESTAMP) >= (TO_TIMESTAMP('2026-09-01 10:00:00.000000', 'YYYY-MM-DD HH24:MI:SS.FF6') - NUMTODSINTERVAL(300, 'SECOND'))" in q
    assert q.endswith("ORDER BY CAST(s.LAST_UPDATE_DATE AS TIMESTAMP), s.ID")
    assert page_sql(q, "oracle", 1000, 500).endswith("OFFSET 1000 ROWS FETCH NEXT 500 ROWS ONLY")
    q2, _ = build_query(QuerySpec(sql="SELECT * FROM t WHERE x > {{WATERMARK}}", wm_col="ID", wm_type="NUMBER", wm_value="42"), "oracle")
    assert "x > 42" in q2 and " WHERE s." not in q2
    assert infer_type(["1", "22", ""]) == "INTEGER" and infer_type(["1.5", "2"]) == "NUMBER" and infer_type(["007", "8"]) == "TEXT:4000"
    assert infer_type(["2026-09-01T10:00:00.000+04:00", "01-SEP-26"]) == "TIMESTAMP"
    assert parse_ts("2026-09-01T10:00:00.000+04:00") == dt.datetime(2026, 9, 1, 6, 0)
    assert parse_ts("01-SEP-26 02.30.00.000000 PM") == dt.datetime(2026, 9, 1, 14, 30)


def test_supervisor_schedule_and_api(env):
    cfg = env["cfg"]
    cfg.worker_mode = "thread"
    cfg.server_name = "T"                                              # the server the fixture registered (default server)
    cfg.api_token_sha256 = ""
    token = cfg.new_token()
    s = env["store"]
    pid, _ = make_pipe(env, schedule="INTERVAL", interval=3600)
    sup = Supervisor(cfg, s)
    sup.thread_mode = True
    sup.start_service()
    try:
        deadline = time.time() + 20
        while time.time() < deadline and not any(r["status"] == "SUCCESS" for r in s.runs.values()):
            time.sleep(0.2)
        assert any(r["status"] == "SUCCESS" and r["trigger"] == "SCHEDULE" for r in s.runs.values()), [(r["status"], r["error"]) for r in s.runs.values()]
        assert s.pipes[pid]["last_run_status"] == "SUCCESS"
        from pipeline_server.api import create_api
        c = TestClient(create_api(sup, cfg))
        assert c.get("/health").status_code == 401
        h = c.get("/health", auth=("pipeline", token)).json()
        assert h["status"] == "ok" and h["engine"] == "RUNNING"
        assert "BEGIN PUBLIC KEY" in c.get("/public-key", auth=("pipeline", token)).json()["public_key"]
        assert c.post("/engine/pause", auth=("pipeline", token)).json()["engine"] == "PAUSED"
        rid = c.post(f"/pipelines/{pid}/run", json={"requested_by": "JAVEED"}, auth=("pipeline", token)).json()["run_id"]
        time.sleep(2)
        assert s.runs[rid]["status"] == "QUEUED"                         # paused: nothing new starts
        c.post("/engine/resume", auth=("pipeline", token))
        deadline = time.time() + 20
        while time.time() < deadline and s.runs[rid]["status"] != "SUCCESS":
            time.sleep(0.2)
        assert s.runs[rid]["status"] == "SUCCESS" and s.runs[rid]["by"] == "JAVEED"
        d = c.get(f"/runs/{rid}", auth=("pipeline", token)).json()
        assert d["tasks"][0]["status"] == "SUCCESS" and d["log"]
        assert c.post(f"/connections/test", json={"conn_id": env["tgt"]}, auth=("pipeline", token)).json()["ok"]
        prev = c.post(f"/pipelines/{pid}/preview", json={"limit": 3}, auth=("pipeline", token)).json()
        assert len(prev["rows"]) == 3
        snap = c.get("/engine", auth=("pipeline", token)).json()
        assert snap["server"]["mode"] == "RUNNING" and snap["finished"]
    finally:
        sup.shutdown()


def test_local_stop_request_and_token_reload(tmp_path, monkeypatch):
    """What the WMS app's Local server panel relies on: a token made while the server runs works at once,
    and data\\stop.request stops the server gracefully and removes the pid file."""
    monkeypatch.setenv("PIPELINE_HOME", str(tmp_path))
    monkeypatch.setenv("PIPELINE_SECRETS", "file")
    import json as _json
    import socket
    from pipeline_server import app as app_mod
    from pipeline_server.__main__ import main
    cfg = ServerConfig()
    cfg.control.driver = "memory"
    cfg.worker_mode = "thread"
    cfg.host = "127.0.0.1"
    with socket.socket() as so:
        so.bind(("127.0.0.1", 0))
        cfg.port = so.getsockname()[1]
    old = cfg.new_token()
    cfg.save()
    assert cfg.check_token("pipeline", old)
    import contextlib, io
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        assert main(["new-token", "--json"]) == 0
    new = _json.loads(buf.getvalue())["api_token"]
    assert cfg.check_token("pipeline", new) and not cfg.check_token("pipeline", old)
    t = threading.Thread(target=app_mod.serve, args=(cfg,), daemon=True)
    t.start()
    deadline = time.time() + 30
    while time.time() < deadline and not app_mod.pid_file().exists():
        time.sleep(0.2)
    assert app_mod.pid_file().read_text().split()[1] == str(cfg.port)
    app_mod.stop_file().write_text("app")
    t.join(40)
    assert not t.is_alive() and not app_mod.pid_file().exists() and not app_mod.stop_file().exists()
