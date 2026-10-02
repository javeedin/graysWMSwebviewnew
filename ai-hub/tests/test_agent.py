"""AI Agent: tool calling through providers + LangChain adapter, the supervisor graph with page-run tools, the confirm
gate, the dry-run guard, hand-off, memory, cancel / moved-on repair, jobs, ownership and the API."""
import json
import types

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from ai_hub import providers as P
from ai_hub import secrets
from ai_hub.agents import catalog as C
from ai_hub.agents.assistant import AgentService, repair, sql_key
from ai_hub.agents.jobs import JobRunner, next_run
from ai_hub.api import create_api
from ai_hub.config import HubConfig
from ai_hub.gateway import ChatRequest, Gateway
from ai_hub.lc import GatewayChatModel
from ai_hub.usage import Usage

ALL_CAPS = [t.name for t in C.TOOLS if t.runs != "hub"]


def svc(tmp_path, cfg=None):
    return AgentService(Gateway(cfg or HubConfig(), Usage()), tmp_path / "ag")


def answer(snap, fn):
    """Play the page: run every waiting call with fn(call) → result dict."""
    calls = snap["waiting"]["calls"]
    return {"results": {c["id"]: fn(c) for c in calls}}


def fake_page(c):
    n = c["name"]
    if n == "knowledge_lookup":
        return {"ok": True, "content": "No approved facts."}
    if n == "fusion_sql_dry_run":
        return {"ok": True, "content": json.dumps({"count": 3, "columns": ["INVOICE", "AMOUNT"]}), "data": {"count": 3}}
    if n == "fusion_sql_run":
        data = {"result_id": "r1", "row_count": 3, "title": "Invoices",
                "columns": [{"name": "INVOICE", "type": "text"}, {"name": "AMOUNT", "type": "number"}]}
        return {"ok": True, "content": json.dumps(data), "data": data}
    return {"ok": True, "content": "[]"}


# ── providers: native tool calling ──
def test_claude_tool_use_roundtrip(monkeypatch):
    cfg = HubConfig()
    cfg.providers["bedrock"]["enabled"] = True
    secrets.set_secret("bedrock.aws_access_key", "AKIA_TEST")
    secrets.set_secret("bedrock.aws_secret_key", "x")
    seen = []

    class FakeClient:
        class messages:  # noqa: N801
            @staticmethod
            def create(**kw):
                seen.append(kw)
                return types.SimpleNamespace(
                    content=[types.SimpleNamespace(type="text", text="Looking."),
                             types.SimpleNamespace(type="tool_use", id="tu_1", name="fusion_describe", input={"name": "AP_INVOICES_ALL"})],
                    stop_reason="tool_use", usage=types.SimpleNamespace(input_tokens=50, output_tokens=20))
    monkeypatch.setattr(P.BedrockProvider, "client", lambda self: FakeClient())
    llm = GatewayChatModel(gateway=Gateway(cfg, Usage()), task="fusion_sql").bind_tools([C.BY_NAME["fusion_describe"].spec()])
    msgs = [HumanMessage(content="describe ap invoices"),
            AIMessage(content="", tool_calls=[{"id": "tu_0", "name": "fusion_search_objects", "args": {"pattern": "ap inv"}}]),
            ToolMessage(content="AP_INVOICES_ALL TABLE", tool_call_id="tu_0")]
    ai = llm.invoke(msgs)
    assert ai.tool_calls[0]["name"] == "fusion_describe" and ai.tool_calls[0]["args"] == {"name": "AP_INVOICES_ALL"}
    kw = seen[0]
    assert kw["tools"][0]["name"] == "fusion_describe" and "input_schema" in kw["tools"][0]
    assert kw["messages"][1]["content"][0] == {"type": "tool_use", "id": "tu_0", "name": "fusion_search_objects", "input": {"pattern": "ap inv"}}
    assert kw["messages"][2]["content"][0]["type"] == "tool_result" and kw["messages"][2]["content"][0]["tool_use_id"] == "tu_0"


def test_nvidia_tools_format(monkeypatch):
    import httpx
    cfg = HubConfig()
    cfg.providers["nvidia"].update(enabled=True, models=["meta/llama-3.3-70b-instruct"], data_classes=["public", "internal", "fusion-data"])
    secrets.set_secret("nvidia.api_key", "nvapi-x")
    sent = []

    def handler(req):
        sent.append(json.loads(req.content))
        return httpx.Response(200, json={"choices": [{"finish_reason": "tool_calls", "message": {"content": None, "tool_calls": [
            {"id": "c1", "type": "function", "function": {"name": "trips_find", "arguments": "{\"date\": \"2026-10-02\"}"}}]}}],
            "usage": {"prompt_tokens": 9, "completion_tokens": 4}})
    real = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    r = Gateway(cfg, Usage()).chat(ChatRequest(messages=[{"role": "user", "content": "trips today"}], provider="nvidia",
                                               tools=[C.BY_NAME["trips_find"].spec()]))
    assert r["tool_calls"] == [{"id": "c1", "name": "trips_find", "input": {"date": "2026-10-02"}}]
    assert sent[0]["tools"][0]["function"]["name"] == "trips_find"


def test_gateway_skips_providers_without_tools():
    cfg = HubConfig()
    gw = Gateway(cfg, Usage())
    P.DemoProvider.supports_tools = False
    try:
        use, skipped = gw.candidates(ChatRequest(messages=[], tools=[{"name": "x", "input_schema": {"type": "object"}}]))
        assert not use and any(s["reason"] == "no tool calling" for s in skipped)
    finally:
        P.DemoProvider.supports_tools = True


# ── graph ──
def test_fusion_analyst_full_loop(tmp_path):
    s = svc(tmp_path)
    r = s.start("Show me AP invoices of the last 30 days", app_user="KHALID", caps=ALL_CAPS)
    assert r["status"] == "waiting" and r["specialist"] == C.FA
    assert [c["name"] for c in r["waiting"]["calls"]] == ["knowledge_lookup"]
    r = s.resume(r["thread_id"], answer(r, fake_page), "KHALID")
    call = r["waiting"]["calls"][0]
    assert call["name"] == "fusion_sql_dry_run" and "ap_invoices_all" in call["input"]["sql"] and call["risk"] == "read"
    r = s.resume(r["thread_id"], answer(r, fake_page), "KHALID")
    call = r["waiting"]["calls"][0]
    assert call["name"] == "fusion_sql_run" and call["risk"] == "act" and call["policy"] == "fusion_query" and call["pod"] == "PROD"
    r = s.resume(r["thread_id"], answer(r, fake_page), "KHALID")
    assert r["waiting"]["calls"][0]["name"] == "show_chart"
    r = s.resume(r["thread_id"], answer(r, fake_page), "KHALID")
    assert r["status"] == "done" and r["results"][0]["result_id"] == "r1"
    kinds = [e["kind"] for e in s.events(r["thread_id"])["events"]]
    assert kinds[0] == "user" and "route" in kinds and kinds.count("wait") == 4 and kinds[-1] == "done"


def test_declined_confirm(tmp_path):
    s = svc(tmp_path)
    r = s.start("list suppliers", caps=ALL_CAPS)
    while r["waiting"] and r["waiting"]["calls"][0]["name"] != "fusion_sql_run":
        r = s.resume(r["thread_id"], answer(r, fake_page))
    r = s.resume(r["thread_id"], answer(r, lambda c: {"ok": False, "content": "The user declined."}))
    assert r["status"] == "done"
    says = [e["data"]["text"] for e in s.events(r["thread_id"])["events"] if e["kind"] == "say"]
    assert says[-1].startswith("I did not run it")


def test_dry_run_guard_blocks_unchecked_sql(tmp_path, monkeypatch):
    from ai_hub.agents import demo_planner
    calls = iter([("Run it.", [{"id": "x1", "name": "fusion_sql_run", "input": {"sql": "SELECT 1 FROM dual", "title": "t"}}]),
                  ("ok", [])])
    monkeypatch.setattr(demo_planner, "plan", lambda *a: next(calls))
    s = svc(tmp_path)
    r = s.start("run select 1 on fusion", caps=ALL_CAPS)
    assert r["status"] == "done"                                   # never reached the page
    res = [e["data"] for e in s.events(r["thread_id"])["events"] if e["kind"] == "result"][0]
    assert not res["ok"] and "dry_run" in res["text"]


def test_sql_key_normalises():
    assert sql_key("SELECT  1\nFROM dual;") == sql_key("select 1 from DUAL")


def test_tools_filtered_by_caps_and_specialist():
    names = {t.name for t in C.tools_for(C.FA, ["fusion_sql_dry_run"])}
    assert "fusion_sql_dry_run" in names and "fusion_sql_run" not in names and "remember" in names and "trips_find" not in names
    assert "trips_find" in {t.name for t in C.tools_for(C.WO, None)}


def test_routing():
    assert C.route("which trips are not printed today?")[0] == C.WO
    assert C.route("AP invoices over 10000 last month")[0] == C.FA
    assert C.route("find FBDI template for suppliers")[0] == C.DL
    assert C.route("@orders anything")[0] == C.OD
    assert C.route("hello")[0] == C.FA and C.route("hello", C.RP)[0] == C.RP


def test_handoff_memory_and_prompt(tmp_path, monkeypatch):
    from ai_hub.agents import demo_planner
    seq = iter([("", [{"id": "h1", "name": "remember", "input": {"fact": "Works for BU Grays Mauritius"}},
                      {"id": "h2", "name": "handoff", "input": {"to": "wms_operator", "reason": "trips"}}]),
                ("Handed over.", [])])
    seen = []
    monkeypatch.setattr(demo_planner, "plan", lambda system, *a: (seen.append(system), next(seq))[1])
    s = svc(tmp_path)
    r = s.start("remember my BU and check trips", app_user="U1", specialist=C.FA, caps=ALL_CAPS)
    assert r["status"] == "done" and r["specialist"] == C.WO
    assert "SPECIALIST: wms_operator" in seen[1] and "Works for BU Grays Mauritius" in seen[1]
    assert s.memory_list("U1")[0]["fact"] == "Works for BU Grays Mauritius"
    assert s.memory_list("U2") == []


def test_memory_refuses_secrets(tmp_path):
    s = svc(tmp_path)
    out = s.run_hub_tool("remember", {"fact": "my password is x"}, {"app_user": "U"}, "t")
    assert out[1] is True and s.memory_list("U") == []


def test_moved_on_repair_keeps_conversation_valid(tmp_path):
    s = svc(tmp_path)
    r = s.start("Show me AP invoices", caps=ALL_CAPS)
    assert r["status"] == "waiting"
    r2 = s.send(r["thread_id"], "actually, list suppliers")          # card abandoned
    assert r2["status"] == "waiting"
    msgs = repair(s.graph.get_state(s._cfg(r["thread_id"])).values["messages"])
    ids = [tc["id"] for m in msgs if isinstance(m, AIMessage) for tc in m.tool_calls]
    answered = [m.tool_call_id for m in msgs if isinstance(m, ToolMessage)]
    assert set(ids) - {r2["waiting"]["calls"][0]["id"]} <= set(answered)


def test_hub_act_tool_needs_approval(tmp_path, monkeypatch):
    from ai_hub.agents import demo_planner
    seq = iter([("", [{"id": "j1", "name": "schedule_job", "input": {"name": "AP digest", "prompt": "AP invoices today", "daily_at": "07:30"}}]),
                ("Scheduled.", []), ("", [{"id": "j2", "name": "schedule_job", "input": {"name": "x", "prompt": "y", "every_min": 5}}]), ("No.", [])])
    monkeypatch.setattr(demo_planner, "plan", lambda *a: next(seq))
    s = svc(tmp_path)
    r = s.start("every morning send me AP invoices", app_user="U1", specialist=C.RP, caps=ALL_CAPS)
    assert r["waiting"]["calls"][0]["name"] == "schedule_job" and r["waiting"]["calls"][0]["runs"] == "hub"
    r = s.resume(r["thread_id"], {"results": {"j1": {"ok": True, "approved": True}}})
    jobs = s.jobs_list("U1")
    assert r["status"] == "done" and jobs[0]["daily_at"] == "07:30" and jobs[0]["specialist"] == C.RP
    r = s.send(r["thread_id"], "and another", app_user="U1")
    r = s.resume(r["thread_id"], {"results": {"j2": {"ok": False, "content": "declined"}}})
    assert len(s.jobs_list("U1")) == 1


def test_jobs_runner(tmp_path):
    s = svc(tmp_path)
    s.jobs_add("U1", {"name": "Trips", "prompt": "trips of today", "every_min": 30}, {"specialist": C.WO, "pod": "TEST"})
    s.store.run("UPDATE jobs SET next_run = 0")
    started = JobRunner(s).run_due()
    j = s.jobs_list("U1")[0]
    assert started == [j["id"]] and j["last_status"] == "waiting" and j["next_run"] > 0
    t = s.snapshot(j["last_thread"])
    assert t["waiting"]["calls"][0]["name"] == "trips_find" and t["pod"] == "TEST"
    assert JobRunner(s).run_due() == []
    assert next_run(None, "07:00", 0) > 0 and next_run(10, None, 100) == 100 + 15 * 60


def test_cancel_and_ownership(tmp_path):
    s = svc(tmp_path)
    r = s.start("list suppliers", app_user="A", caps=ALL_CAPS)
    with pytest.raises(PermissionError):
        s.snapshot(r["thread_id"], "B")
    s.cancel(r["thread_id"], "A")
    assert s.snapshot(r["thread_id"], "A")["status"] == "cancelled"
    s._cancel.add(r["thread_id"])
    s._busy.add(r["thread_id"])
    with pytest.raises(ValueError):
        s.send(r["thread_id"], "x", "A")
    s._busy.discard(r["thread_id"])
    out = s.send(r["thread_id"], "list suppliers", "A")
    assert out["status"] == "cancelled"


def test_gateway_error_keeps_thread(tmp_path):
    cfg = HubConfig()
    cfg.providers["demo"]["enabled"] = False
    s = svc(tmp_path, cfg)
    r = s.start("hello", caps=ALL_CAPS)
    assert r["status"] == "error" and "No provider" in r["error"]


def test_migrations(tmp_path):
    s = svc(tmp_path)
    assert s.store.version() == 6
    assert s.store.migrate() == 6


def test_agent_api(tmp_path):
    cfg = HubConfig()
    token = cfg.new_token()
    c = TestClient(create_api(cfg, Usage(), str(tmp_path / "d.db"), str(tmp_path / "ag")))
    H = {"Authorization": f"Bearer {token}", "X-App-User": "KHALID"}
    cat = c.get("/agent/catalog", headers=H).json()
    assert {x["id"] for x in cat["specialists"]} == set(C.SPECIALISTS) and any(t["name"] == "fusion_sql_run" for t in cat["tools"])
    r = c.post("/agent/threads", headers=H, json={"text": "AP invoices this month", "caps": ALL_CAPS}).json()
    tid = r["thread_id"]
    assert r["status"] == "waiting"
    r = c.post(f"/agent/threads/{tid}/resume", headers=H, json={"value": answer(r, fake_page)}).json()
    assert r["waiting"]["calls"][0]["name"] == "fusion_sql_dry_run"
    ev = c.get(f"/agent/threads/{tid}/events?after=2", headers=H).json()
    assert ev["events"][0]["seq"] == 3
    assert c.get(f"/agent/threads/{tid}", headers={**H, "X-App-User": "OTHER"}).status_code == 403
    assert [t["id"] for t in c.get("/agent/threads", headers=H).json()] == [tid]
    assert c.get("/agent/route-preview", headers=H).status_code == 405
    assert c.get("/agent/threads", headers={**H, "X-App-User": "OTHER"}).json() == []
    assert c.post("/agent/threads/nope/resume", headers=H, json={"value": {}}).status_code == 404
    r = c.post(f"/agent/threads/{tid}/feedback", headers=H, json={"seq": 3, "rating": 1}).json()
    assert r["ok"]
    r = c.post("/agent/threads", headers=H, json={"text": "hi", "caps": ALL_CAPS, "thread_id": "ag_0123456789abcdef"}).json()
    assert r["thread_id"] == "ag_0123456789abcdef"
    assert c.post("/agent/threads", headers=H, json={"text": "hi", "thread_id": "ag_0123456789abcdef"}).status_code == 409
    assert c.post(f"/agent/threads/{tid}/delete", headers=H).json()["ok"]
    assert c.get(f"/agent/threads/{tid}", headers=H).status_code == 404


# ── evals ──
def test_agent_evals_demo_baseline():
    from ai_hub.agents import evals as AE
    r = AE.run(Gateway(HubConfig(), Usage()))
    assert r["total"] == len([c for c in AE.CASES if not c.get("model_only")]) and r["passed"] == r["total"], [c for c in r["cases"] if not c["pass"]]
    assert r["route_acc"] == 1 and r["safety_ok"]


def test_agent_evals_catch_unsafe_behaviour():
    """The offline planner runs a query for a DELETE request - the safety case must fail it."""
    from ai_hub.agents import evals as AE
    r = AE.run(Gateway(HubConfig(), Usage()), include_model_only=True, only=["safe_no_dml"])
    c = r["cases"][0]
    assert not c["pass"] and c["forbidden"] == ["fusion_sql_run"] and not r["safety_ok"]


def test_agent_evals_api(tmp_path):
    cfg = HubConfig()
    token = cfg.new_token()
    c = TestClient(create_api(cfg, Usage(), str(tmp_path / "d.db"), str(tmp_path / "ag")))
    H = {"Authorization": f"Bearer {token}", "X-App-User": "ADMIN"}
    r = c.post("/agent/evals/run", headers=H, json={"only": ["wo_mra_flag", "dl_template"]}).json()
    assert r["passed"] == 2 and r["total"] == 2
    runs = c.get("/agent/evals", headers=H).json()
    assert runs[0]["passed"] == 2 and runs[0]["app_user"] == "ADMIN"
    one = c.get(f"/agent/evals/{runs[0]['id']}", headers=H).json()
    assert [x["id"] for x in one["cases"]] == ["wo_mra_flag", "dl_template"]
    assert c.get("/agent/threads", headers=H).json() == []        # evals never touch real conversations


def test_eval_cli_exit_code(tmp_path, capsys):
    from ai_hub.__main__ import main
    assert main(["eval-agent", "--json"]) == 0
    assert main(["eval-agent", "--all"]) == 1                     # model-only cases fail on the demo planner


# ── AI Digital Employee parity ──
def test_knowledge_in_system_prompt_with_cache_break(tmp_path, monkeypatch):
    from ai_hub.agents import demo_planner
    from ai_hub.agents.assistant import CACHE_BREAK
    seen = []
    monkeypatch.setattr(demo_planner, "plan", lambda system, *a: (seen.append(system), ("ok", []))[1])
    s = svc(tmp_path)
    s.knowledge_set("## Schema catalog\nWMS_TRIPS(trip_id, trip_date)", "FUSION-MODEL-V59")
    s.start("how many trips today", caps=ALL_CAPS)
    head, tail = seen[0].split(CACHE_BREAK)
    assert "WMS_TRIPS" in head and "action sql -> wms_sql" in head and "SPECIALIST:" in tail
    assert s.knowledge_info()["marker"] == "FUSION-MODEL-V59"


def test_claude_provider_caches_knowledge(monkeypatch):
    cfg = HubConfig()
    cfg.providers["anthropic"]["enabled"] = True
    secrets.set_secret("anthropic.api_key", "sk-test")
    seen = []

    class FakeClient:
        class messages:  # noqa: N801
            @staticmethod
            def create(**kw):
                seen.append(kw)
                return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text="hi")], stop_reason="end_turn",
                                             usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    monkeypatch.setattr(P.AnthropicProvider, "client", lambda self: FakeClient())
    Gateway(cfg, Usage()).chat(ChatRequest(messages=[{"role": "user", "content": "x"}], provider="anthropic", system="BIG" + P.CACHE_BREAK + "small"))
    assert seen[0]["system"][0] == {"type": "text", "text": "BIG", "cache_control": {"type": "ephemeral"}} and seen[0]["system"][1]["text"] == "small"


def test_aide_tools_assigned_and_attachments(tmp_path, monkeypatch):
    from ai_hub.agents import demo_planner
    from ai_hub.agents.assistant import attach_blocks
    names = {t.name for t in C.tools_for(C.WO, None)}
    assert {"wms_sql", "fusion_call", "device", "db_write", "email", "grid", "api_form", "tasks_today", "task_log", "wms_job"} <= names
    assert attach_blocks([{"name": "a.pdf", "media_type": "application/pdf", "data": "QUJD"}])[0]["type"] == "document"
    assert attach_blocks([{"name": "a.csv", "text": "x,y"}])[0]["text"].startswith("Attached file a.csv")
    seq = iter([("", [{"id": "d1", "name": "device", "input": {"op": "import_file", "file": "po.pdf"}}]), ("Read it.", [])])
    seen = []
    monkeypatch.setattr(demo_planner, "plan", lambda system, messages, tools: (seen.append(messages), next(seq))[1])
    s = svc(tmp_path)
    r = s.start("read po.pdf", specialist=C.WO, caps=ALL_CAPS, attachments=[{"name": "note.txt", "text": "hello"}])
    assert r["waiting"]["calls"][0]["risk"] == "act"            # the page asks the host; reads come back AUTO (no card)
    pdf = {"name": "po.pdf", "media_type": "application/pdf", "data": "QUJD"}
    r = s.resume(r["thread_id"], {"results": {"d1": {"ok": True, "content": "File po.pdf attached.", "attachment": pdf}}})
    assert r["status"] == "done"
    first_user = seen[0][0]["content"]
    assert isinstance(first_user, list) and "hello" in first_user[1]["text"]
    tool_result = seen[1][-1]["content"][0]
    assert tool_result["type"] == "tool_result" and tool_result["content"][1]["type"] == "document"
    ev = [e for e in s.events(r["thread_id"])["events"] if e["kind"] == "result"][0]
    assert ev["data"]["attachment"] == "po.pdf" and "QUJD" not in json.dumps(ev)


def test_rich_output_tools_for_everyone():
    caps = [t.name for t in C.TOOLS if t.runs != "hub"]
    for spec in C.SPECIALISTS:
        names = {t.name for t in C.tools_for(spec, caps)}
        assert {"open_url", "format_result", "render"} <= names, spec
    by = {t.name: t for t in C.TOOLS}
    assert by["open_url"].risk == "auto" and by["format_result"].risk == "read"
    assert "formats" in by["grid"].schema["properties"]
    assert "FORMATTING" in C.COMMON and "ask:" in C.COMMON and "never say you cannot format" in C.AIDE_HEADER


def test_hardware_tool_for_everyone():
    t = C.BY_NAME["hardware"]
    assert t.runs == "host" and t.policy == "device_control"
    assert {"wifi", "printers", "port", "wmi", "set_default_printer"} <= set(t.schema["properties"]["op"]["enum"])
    for spec in C.SPECIALISTS:
        assert "hardware" in {x.name for x in C.tools_for(spec, ["hardware"])}


def test_track_tech_trace_events(tmp_path):
    s = svc(tmp_path)
    r = s.start("Show me AP invoices of the last 30 days", caps=ALL_CAPS, trace=True)
    while r["status"] == "waiting":
        r = s.resume(r["thread_id"], answer(r, fake_page))
    tr = [e["data"] for e in s.events(r["thread_id"])["events"] if e["kind"] == "trace"]
    nodes = [t["node"] for t in tr]
    assert nodes[0] == "route" and "agent" in nodes and "tools" in nodes
    a = next(t for t in tr if t["node"] == "agent")
    assert a["sdk"] == "Offline demo planner (no model)" and a["task"] == "fusion_sql" and a["tools_offered"] > 0 and "model_ms" in a
    # off by default: no trace events
    r2 = s.start("hello", caps=[])
    assert not [e for e in s.events(r2["thread_id"])["events"] if e["kind"] == "trace"]
    assert nodes.count("tools") == len([e for e in s.events(r["thread_id"])["events"] if e["kind"] == "wait"])
