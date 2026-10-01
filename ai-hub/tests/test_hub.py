"""AI Hub: gateway routing / fallback / budget / data policy, Claude providers (SDK stubbed), NVIDIA (HTTP mocked),
the LangChain adapter, the Pipeline Doctor graph (interrupts, restart, reject) and the API."""
import types

import httpx
import pytest
from fastapi.testclient import TestClient

from ai_hub import providers as P
from ai_hub import secrets
from ai_hub.agents.pipeline_doctor import Doctor
from ai_hub.api import create_api
from ai_hub.config import HubConfig
from ai_hub.gateway import ChatRequest, Gateway, GatewayError
from ai_hub.lc import GatewayChatModel
from ai_hub.usage import Usage

MSG = [{"role": "user", "content": "hello"}]


def fake_message(text="Hi from Claude", stop="end_turn", tin=12, tout=5):
    return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=text)], stop_reason=stop,
                                 usage=types.SimpleNamespace(input_tokens=tin, output_tokens=tout))


def bedrock_on(cfg, monkeypatch, reply=None):
    cfg.providers["bedrock"]["enabled"] = True
    secrets.set_secret("bedrock.aws_access_key", "AKIA_TEST")
    secrets.set_secret("bedrock.aws_secret_key", "secret")
    calls = []

    class FakeClient:
        class messages:  # noqa: N801
            @staticmethod
            def create(**kw):
                calls.append(kw)
                return reply(kw) if reply else fake_message()
    monkeypatch.setattr(P.BedrockProvider, "client", lambda self: FakeClient())
    return calls


def test_demo_route_and_skips():
    gw = Gateway(HubConfig(), Usage())
    r = gw.chat(ChatRequest(messages=MSG))
    assert r["provider"] == "demo" and r["text"].startswith("Demo answer")
    reasons = {s["provider"]: s["reason"] for s in r["skipped"]}
    assert reasons["bedrock"] == "switched off" and reasons["anthropic"] == "switched off"


def test_bedrock_claude_cost_and_ledger(monkeypatch):
    cfg = HubConfig()
    calls = bedrock_on(cfg, monkeypatch)
    u = Usage()
    r = Gateway(cfg, u).chat(ChatRequest(messages=MSG, system="Be short", task="pipeline_doctor"))
    assert r["provider"] == "bedrock" and r["model"] == "anthropic.claude-sonnet-5-5"
    assert calls[0]["model"] == "anthropic.claude-sonnet-5-5" and calls[0]["system"] == "Be short" and "temperature" not in calls[0]
    assert r["cost"] == pytest.approx(12 / 1e6 * 2 + 5 / 1e6 * 10)
    s = u.summary()
    assert s["by_model"][0]["model"] == "anthropic.claude-sonnet-5-5" and s["month_cost"] == pytest.approx(r["cost"])


def test_bedrock_client_is_mantle_with_keys(monkeypatch):
    cfg = HubConfig()
    cfg.providers["bedrock"].update(enabled=True, region="eu-central-1")
    secrets.set_secret("bedrock.aws_access_key", "AKIA_TEST")
    secrets.set_secret("bedrock.aws_secret_key", "secret")
    import anthropic
    c = P.make("bedrock", cfg.providers["bedrock"]).client()
    assert isinstance(c, anthropic.AnthropicBedrockMantle) and "bedrock-mantle.eu-central-1" in str(c.base_url)


def test_refusal_and_errors_fall_back(monkeypatch):
    cfg = HubConfig()
    bedrock_on(cfg, monkeypatch, reply=lambda kw: fake_message(stop="refusal", text=""))
    r = Gateway(cfg, Usage()).chat(ChatRequest(messages=MSG))
    assert r["provider"] == "demo" and r["fallback"] and r["attempts"][0]["ok"] is False and "declined" in r["attempts"][0]["error"]
    with pytest.raises(GatewayError):
        Gateway(cfg, Usage()).chat(ChatRequest(messages=MSG, provider="bedrock", model="anthropic.claude-opus-5-5", fallback=False))


def test_data_policy_and_budget(monkeypatch):
    cfg = HubConfig()
    bedrock_on(cfg, monkeypatch)
    cfg.providers["bedrock"]["data_classes"] = ["public"]                  # not allowed fusion data
    r = Gateway(cfg, Usage()).chat(ChatRequest(messages=MSG, task="fusion_sql"))
    assert r["provider"] == "demo" and any("fusion-data" in s["reason"] for s in r["skipped"])
    cfg.providers["bedrock"]["data_classes"] = ["public", "internal", "fusion-data"]
    u = Usage()
    u.add(task="x", provider="bedrock", model="anthropic.claude-opus-5-5", ok=True, cost=60.0)
    r = Gateway(cfg, u).chat(ChatRequest(messages=MSG))                    # $50 budget used → paid models skipped
    assert r["provider"] == "demo" and any("budget" in s["reason"] for s in r["skipped"])


def test_nvidia_over_http(monkeypatch):
    cfg = HubConfig()
    cfg.providers["nvidia"].update(enabled=True, models=["meta/llama-x"])
    secrets.set_secret("nvidia.api_key", "nvapi-test")
    seen = {}

    def handler(req: httpx.Request):
        if req.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "meta/llama-x", "owned_by": "meta"}]})
        seen["auth"], seen["body"] = req.headers["authorization"], req.read().decode()
        return httpx.Response(200, json={"choices": [{"message": {"content": "Bonjour"}, "finish_reason": "stop"}],
                                         "usage": {"prompt_tokens": 9, "completion_tokens": 2}})
    monkeypatch.setattr(P.NvidiaProvider, "_http", lambda self: httpx.Client(base_url="https://integrate.api.nvidia.com/v1",
                                                                              headers={"Authorization": "Bearer nvapi-test"}, transport=httpx.MockTransport(handler)))
    gw = Gateway(cfg, Usage())
    r = gw.chat(ChatRequest(messages=MSG, provider="nvidia", model="meta/llama-x", system="Translate", data_class="public"))
    assert r["text"] == "Bonjour" and r["tokens_in"] == 9 and seen["auth"] == "Bearer nvapi-test" and '"role":"system"' in seen["body"]
    assert gw.provider("nvidia").list_models()[0]["id"] == "meta/llama-x"
    res = gw.compare(ChatRequest(messages=MSG, data_class="public"), [{"provider": "nvidia", "model": "meta/llama-x"}, {"provider": "demo", "model": "demo"},
                                                 {"provider": "bedrock", "model": "anthropic.claude-opus-5-5"}])
    assert [x["ok"] for x in res] == [True, True, False]


def test_langchain_adapter(monkeypatch):
    from langchain_core.messages import HumanMessage, SystemMessage
    cfg = HubConfig()
    bedrock_on(cfg, monkeypatch)
    m = GatewayChatModel(gateway=Gateway(cfg, Usage()), task="default")
    out = m.invoke([SystemMessage("sys"), HumanMessage("hi")])
    assert out.content == "Hi from Claude" and out.response_metadata["provider"] == "bedrock" and out.usage_metadata["input_tokens"] == 12


CTX = {"pipeline": "AP invoices to DW", "pipeline_id": 4, "run_id": 77, "run_status": "FAILED", "pod": "PROD",
       "error": 'ORA-00904: "INVOICE_AMT": invalid identifier',
       "log": ["Task \"Load AP\" started", "page 1 read", 'ERROR ORA-00904: "INVOICE_AMT": invalid identifier'],
       "task": {"id": 11, "name": "Load AP", "source_type": "FUSION", "target_type": "DUCKDB", "target_object": "AP_INVOICES",
                "load_mode": "MERGE", "key_columns": "INVOICE_ID", "source_sql": "SELECT invoice_id, invoice_amt FROM ap_invoices_all"}}


def test_doctor_full_flow_survives_restart(tmp_path):
    gw = Gateway(HubConfig(), Usage())
    db = str(tmp_path / "agents.db")
    d = Doctor(gw, db)
    s = d.start(CTX, "JAVEED")
    assert s["status"] == "waiting_verify" and "NULL AS INVOICE_AMT" in s["waiting"]["sql"]
    assert [t["node"] for t in s["state"]["timeline"]] == ["start", "triage", "diagnose"]
    assert s["state"]["triage"]["category"] == "INVALID_COLUMN"
    s = d.resume(s["thread_id"], {"ok": True, "rows": 120, "ms": 900})
    assert s["status"] == "waiting_approval" and s["waiting"]["patch"]["source_sql"].startswith("SELECT invoice_id, NULL AS")
    tid = s["thread_id"]
    d2 = Doctor(Gateway(HubConfig(), Usage()), db)                      # the hub restarted
    s = d2.resume(tid, {"approved": True, "by": "JAVEED", "rerun": True})
    assert s["status"] == "waiting_apply" and s["waiting"]["task_id"] == 11 and s["waiting"]["rerun"] is True
    s = d2.resume(tid, {"ok": True, "rerun_run_id": 78})
    assert s["status"] == "fixed" and s["waiting"] is None and "Fix applied" in s["state"]["summary"]
    assert [t["node"] for t in s["state"]["timeline"]][-4:] == ["propose", "approval", "apply", "report"]
    assert d2.list()[0]["status"] == "fixed"
    with pytest.raises(ValueError):
        d2.resume(tid, {"approved": True})


def test_doctor_failed_test_retries_then_reject(tmp_path):
    d = Doctor(Gateway(HubConfig(), Usage()), str(tmp_path / "a.db"))
    s = d.start(CTX)
    s = d.resume(s["thread_id"], {"ok": False, "error": "ORA-00942: table or view does not exist"})
    assert s["status"] == "waiting_verify" and s["state"]["attempts"] == 2          # diagnosed again with the new error
    s = d.resume(s["thread_id"], {"ok": False, "error": "still failing"})
    assert s["status"] == "waiting_approval"                                         # no third try: a person decides
    s = d.resume(s["thread_id"], {"approved": False, "by": "JAVEED", "note": "will fix by hand"})
    assert s["status"] == "rejected"
    g = d.graph_shape()
    assert {"triage", "diagnose", "verify", "approval", "apply", "report"} <= set(g["nodes"]) and "graph" in g["mermaid"]


def test_doctor_auth_problem_is_advice_only(tmp_path):
    d = Doctor(Gateway(HubConfig(), Usage()), str(tmp_path / "b.db"))
    ctx = dict(CTX, error="HTTP 401 Unauthorized from the target", task=dict(CTX["task"], source_type="CONNECTION"))
    s = d.start(ctx)
    assert s["status"] == "waiting_approval" and s["state"]["diagnosis"]["fix_kind"] == "CONNECTION" and s["waiting"]["patch"] == {}
    s = d.resume(s["thread_id"], {"approved": True})
    assert s["status"] == "advice"


def test_api(tmp_path, monkeypatch):
    cfg = HubConfig()
    tok = cfg.new_token()
    c = TestClient(create_api(cfg, Usage(), str(tmp_path / "api.db")))
    assert c.get("/health").status_code == 401
    H = {"Authorization": f"Bearer {tok}"}
    assert c.get("/health", headers=H).json()["status"] == "ok"
    assert c.put("/providers/bedrock", json={"enabled": True, "region": "us-east-1"}, headers=H).json()["ok"]
    assert c.put("/providers/bedrock", json={"evil": 1}, headers=H).status_code == 400
    assert c.put("/providers/bedrock/secret", json={"name": "aws_access_key", "value": "AKIA"}, headers=H).json()["saved"]
    p = {x["id"]: x for x in c.get("/providers", headers=H).json()}
    assert p["bedrock"]["secrets"]["aws_access_key"] and not p["bedrock"]["configured"] and "secret" in p["bedrock"]["missing"]
    assert "AKIA" not in c.get("/providers", headers=H).text and "AKIA" not in c.get("/config", headers=H).text
    r = c.post("/v1/chat", json={"messages": MSG}, headers=H).json()
    assert r["ok"] and r["provider"] == "demo"
    assert c.post("/v1/chat", json={"messages": MSG, "provider": "bedrock", "model": "x", "fallback": False}, headers=H).json()["ok"] is False
    assert len(c.post("/v1/compare", json={"messages": MSG, "targets": [{"provider": "demo", "model": "demo"}]}, headers=H).json()["results"]) == 1
    assert c.put("/routes", json={"budget_month_usd": 10, "prices": {"x": [1, 2]}}, headers=H).json()["budget_month_usd"] == 10
    assert c.get("/usage", headers=H).json()["by_model"]
    s = c.post("/agents/doctor/start", json={"context": CTX, "app_user": "JAVEED"}, headers=H).json()
    assert s["status"] == "waiting_verify"
    s = c.post(f"/agents/doctor/{s['thread_id']}/resume", json={"value": {"ok": True, "rows": 3}}, headers=H).json()
    assert s["status"] == "waiting_approval"
    assert c.get("/agents/doctor/threads", headers=H).json()[0]["thread_id"] == s["thread_id"]
    assert c.get("/agents/doctor/graph", headers=H).json()["interrupts"] == ["verify", "approval", "apply"]
    assert c.get("/agents/doctor/nope", headers=H).status_code == 404


def test_cli_init_with_token_from_app(monkeypatch, capsys):
    import io
    import json
    import sys
    from ai_hub.__main__ import main
    monkeypatch.setattr(sys, "stdin", io.StringIO("tok-from-app\n"))
    assert main(["init", "--port", "8123", "--token-stdin", "--json"]) == 0
    out = json.loads(capsys.readouterr().out.strip())
    assert out["port"] == 8123 and out["token"] is None and HubConfig.load().check_token("tok-from-app")
    monkeypatch.setattr(sys, "stdin", io.StringIO("sk-test\n"))
    assert main(["set-secret", "anthropic.api_key", "--stdin"]) == 0 and secrets.get_secret("anthropic.api_key") == "sk-test"
