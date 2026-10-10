"""Voice mode (TTS / STT) and phone calls (Twilio ConversationRelay) - no network: httpx is faked."""
import base64
import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from ai_hub import secrets
from ai_hub import voice as V
from ai_hub.agents import catalog as C
from ai_hub.agents.assistant import AgentService
from ai_hub.api import create_api
from ai_hub.config import HubConfig
from ai_hub.gateway import Gateway
from ai_hub.phone import PhoneError, PhoneManager, create_phone_app, pin_hash, twilio_signature
from ai_hub.usage import Usage


class FakeResp:
    def __init__(self, status=200, content=b"", js=None, headers=None):
        self.status_code, self.content, self._js = status, content, js
        self.headers = headers or {"content-type": "application/json"}
        self.text = json.dumps(js) if js is not None else content.decode(errors="ignore")

    def json(self):
        return self._js


def test_speakable_strips_markdown():
    t = V.speakable("## Trips\n**3** of [[ok:4]] printed. See [the report](https://x.y/z).\n| a | b |\n|---|---|\n```sql\nSELECT 1\n```\n- one")
    assert t == "Trips. 3 of 4 printed. See the report. one"


def test_tts_browser_and_elevenlabs(monkeypatch):
    cfg = HubConfig()
    assert V.tts(cfg, "Hello **there**")["text"] == "Hello there"
    with pytest.raises(V.VoiceError, match="No key"):
        V.tts(cfg, "Hi", provider="elevenlabs")
    secrets.set_secret("elevenlabs.api_key", "k")
    seen = {}

    def post(url, **kw):
        seen.update(url=url, **kw)
        return FakeResp(content=b"ID3mp3", headers={"content-type": "audio/mpeg"})
    monkeypatch.setattr(V.httpx, "post", post)
    r = V.tts(cfg, "Hi there", provider="elevenlabs", voice="v1")
    assert base64.b64decode(r["audio_b64"]) == b"ID3mp3" and r["mime"] == "audio/mpeg"
    assert seen["url"].endswith("/text-to-speech/v1") and seen["headers"]["xi-api-key"] == "k"


def test_stt_azure(monkeypatch):
    cfg = HubConfig()
    secrets.set_secret("azure_speech.key", "az")
    monkeypatch.setattr(V.httpx, "post", lambda url, **kw: FakeResp(js={"RecognitionStatus": "Success", "DisplayText": "Show trips today."}))
    r = V.stt(cfg, base64.b64encode(b"RIFFxxxx").decode(), provider="azure")
    assert r["text"] == "Show trips today."
    with pytest.raises(V.VoiceError):
        V.stt(cfg, "", provider="azure")


def test_phone_mode_tools_are_read_only():
    names = {t.name for t in C.tools_for(C.WO, [t.name for t in C.TOOLS if t.runs != "hub"], "phone")}
    assert {"end_call", "take_message"} <= names
    assert not names & {"mra_interface", "device", "db_write", "phone_call", "ask_user", "schedule_job", "fusion_sql_run"}
    assert "end_call" not in {t.name for t in C.tools_for(C.WO, None)}
    assert "phone_call" in {t.name for t in C.tools_for(C.WO, None)}


def _phone(tmp_path):
    cfg = HubConfig({"phone": {"enabled": True, "account_sid": "AC1", "from_number": "+23052000000", "public_url": "https://t.example",
                               "allowed_prefixes": ["+230"]}})
    secrets.set_secret("twilio.auth_token", "tok")
    svc = AgentService(Gateway(cfg, Usage()), tmp_path / "ag")
    return cfg, svc, PhoneManager(cfg, svc)


def test_place_call_rules_and_twiml(tmp_path, monkeypatch):
    cfg, svc, ph = _phone(tmp_path)
    with pytest.raises(PhoneError, match="not allowed"):
        ph.place_call("+33612345678", "x", None, "SHAIK")
    with pytest.raises(PhoneError, match="international"):
        ph.place_call("52000000", "x", None, "SHAIK")
    sent = {}

    def post(url, **kw):
        sent.update(url=url, **kw)
        return FakeResp(js={"sid": "CA9"})
    monkeypatch.setattr("ai_hub.phone.httpx.post", post)
    r = ph.place_call("+230 5200 0001", "Confirm delivery slot tomorrow 10:00", "Mr Lee", "SHAIK")
    tw = sent["data"]["Twiml"]
    assert sent["url"].endswith("/Accounts/AC1/Calls.json") and sent["data"]["To"] == "+23052000001"
    assert "ConversationRelay" in tw and "wss://t.example/twilio/relay?call=" in tw and "I'm an AI" in tw and "&amp;k=" in tw
    row = ph.get(r["call_id"])
    assert row["status"] == "initiated" and row["twilio_sid"] == "CA9" and row["transcript"][0]["who"] == "agent"


def test_twilio_webhook_signature_and_inbound(tmp_path):
    cfg, svc, ph = _phone(tmp_path)
    ph.set_known("+23057000000", "SHAIK", "4321")
    c = TestClient(create_phone_app(ph))
    form = {"From": "+23057000000", "To": "+23052000000", "CallSid": "CA1"}
    assert c.post("/twilio/voice", data=form, headers={"X-Twilio-Signature": "bad"}).status_code == 403
    sig = twilio_signature("tok", "https://t.example/twilio/voice", form)
    r = c.post("/twilio/voice", data=form, headers={"X-Twilio-Signature": sig})
    assert r.status_code == 200 and "ConversationRelay" in r.text and "PIN" in r.text
    row = svc.store.one("SELECT * FROM calls WHERE direction = 'inbound'")
    assert row["app_user"] == "SHAIK" and row["verified"] == 0
    assert not ph.check_pin(row["id"], "1111") and ph.check_pin(row["id"], "4321")
    assert ph.get(row["id"])["verified"] == 1
    assert cfg.phone["known"]["+23057000000"]["pin_sha256"] == pin_hash("+23057000000", "4321")


def test_live_call_turn_over_websocket(tmp_path, monkeypatch):
    cfg, svc, ph = _phone(tmp_path)
    form = {"From": "+23059999999", "To": "+23052000000", "CallSid": "CA2"}
    c = TestClient(create_phone_app(ph))
    c.post("/twilio/voice", data=form, headers={"X-Twilio-Signature": twilio_signature("tok", "https://t.example/twilio/voice", form)})
    row = svc.store.one("SELECT * FROM calls WHERE direction = 'inbound'")
    with pytest.raises(WebSocketDisconnect):
        with c.websocket_connect(f"/twilio/relay?call={row['id']}&k=wrong") as ws:
            ws.receive_text()
    with c.websocket_connect(f"/twilio/relay?call={row['id']}&k={row['k']}") as ws:
        ws.send_text(json.dumps({"type": "setup", "callSid": "CA2", "from": form["From"]}))
        ws.send_text(json.dumps({"type": "prompt", "voicePrompt": "Hi, I'd like to leave a message for the warehouse.", "last": True}))
        msg = json.loads(ws.receive_text())
        assert msg["type"] == "text" and msg["token"]
    got = ph.get(row["id"])
    assert got["status"] == "completed" and any(x["who"] == "caller" for x in got["transcript"])
    st = svc.graph.get_state(svc._cfg(got["thread_id"])).values
    assert st["voice"] == "phone" and st["caps"] == [] and st["app_user"] == "PHONE:+23059999999"
    assert "NOT verified" in svc.system_prompt(C.SPECIALISTS[C.WO], st)


def test_voice_api(tmp_path, monkeypatch):
    cfg = HubConfig()
    tok = cfg.new_token()
    c = TestClient(create_api(cfg, Usage(), str(tmp_path / "d.db"), str(tmp_path / "ag")))
    h = {"Authorization": "Bearer " + tok}
    assert c.get("/voice/config", headers=h).json()["keys"]["elevenlabs.api_key"] is False
    assert c.put("/voice/secret", json={"name": "elevenlabs.api_key", "value": "x"}, headers=h).json()["set"]
    assert c.put("/voice/secret", json={"name": "other", "value": "x"}, headers=h).status_code == 400
    v = c.put("/voice/config", json={"voice": {"tts": {"provider": "elevenlabs", "voice": "abc", "bad": 1}}}, headers=h).json()["voice"]
    assert v["tts"]["provider"] == "elevenlabs" and "bad" not in v["tts"]
    assert c.post("/voice/tts", json={"text": "Hi", "provider": "browser"}, headers=h).json()["text"] == "Hi"
    assert c.post("/voice/call", json={"to": "+23052000001", "goal": "x"}, headers=h).status_code == 400   # phone off
    p = c.get("/voice/phone", headers=h).json()
    assert p["ready"] is False and "switched off" in p["why"]
    # voice mode adds the spoken style to the system prompt
    r = c.post("/agent/threads", json={"text": "hello", "voice": "app", "caps": []}, headers=h).json()
    st = c.app.state.agent.graph.get_state(c.app.state.agent._cfg(r["thread_id"])).values
    assert st["voice"] == "app" and "VOICE MODE" in c.app.state.agent.system_prompt(C.SPECIALISTS[C.FA], st)


def test_camera_photos_reach_the_model_as_images(tmp_path, monkeypatch):
    script = tmp_path / "s.json"
    script.write_text(json.dumps([{"text": "Let me see it.", "calls": [{"name": "camera", "input": {"reason": "the delivery note", "pages": 2}}]},
                                  {"text": "Read it: 3 lines, total 1,200."}]))
    monkeypatch.setenv("AIHUB_DEMO_SCRIPT", str(script))
    import ai_hub.agents.demo_planner as dp
    dp._SCRIPT.update(path=None)
    svc = AgentService(Gateway(HubConfig(), Usage()), tmp_path / "ag")
    assert C.BY_NAME["camera"].risk == "ask" and C.BY_NAME["camera"].runs == "page"
    r = svc.start("read my delivery note", caps=["camera"])
    call = r["waiting"]["calls"][0]
    assert call["name"] == "camera"
    jpg = base64.b64encode(b"\xff\xd8\xff\xe0fakejpeg").decode()
    shot = lambda n: {"name": f"p{n}.jpg", "media_type": "image/jpeg", "data": jpg}  # noqa: E731
    r = svc.resume(r["thread_id"], {"results": {call["id"]: {"ok": True, "content": "2 photos", "attachment": shot(1), "attachments": [shot(2)]}}})
    assert r["status"] == "done"
    msgs = svc.graph.get_state(svc._cfg(r["thread_id"])).values["messages"]
    tool_msg = next(m for m in msgs if getattr(m, "tool_call_id", None) == call["id"])
    assert [b["type"] for b in tool_msg.content if b["type"] == "image"] == ["image", "image"]
    ev = svc.events(r["thread_id"])["events"]
    assert any(e["kind"] == "result" and e["data"].get("attachment") == "p1.jpg, p2.jpg" for e in ev)
    assert jpg not in json.dumps(ev)          # photos are never stored in the timeline


def test_whisper_status_in_voice_config():
    st = V.status(HubConfig())
    assert set(st["whisper"]) >= {"installed", "state"} and st["whisper"]["state"] in ("idle", "running", "done", "error")


def test_language_and_gender_pick_the_voice(tmp_path):
    cfg = HubConfig({"voice": {"language": "fr-FR", "gender": "male"}})
    assert V.pick_voice(cfg, "piper") == "fr_FR-tom-medium" and V.pick_voice(cfg, "azure") == "fr-FR-HenriNeural"
    assert V.pick_voice(cfg, "elevenlabs") == V.ELEVEN_STOCK["M"]
    cfg.voice["gender"] = "female"
    assert V.pick_voice(cfg, "polly") == "Lea"
    cfg.voice["tts"].update(voice="fr-FR-EloiseNeural", voice_provider="azure")       # an explicit voice wins for its provider only
    assert V.pick_voice(cfg, "azure") == "fr-FR-EloiseNeural" and V.pick_voice(cfg, "piper") == "fr_FR-siwis-medium"
    assert {"fr_FR-tom-medium", "en_US-amy-medium"} <= {x["id"] for x in V.voices(cfg, "piper")}
    st = V.status(cfg)
    assert st["language"] == "fr-FR" and "piper" in st and "Français" == st["languages"]["fr-FR"]["name"]
    # the agent answers in the voice language
    svc = AgentService(Gateway(cfg, Usage()), tmp_path / "ag")
    r = svc.start("bonjour", caps=[], voice="app")
    st2 = svc.graph.get_state(svc._cfg(r["thread_id"])).values
    assert "Speak Français" in svc.system_prompt(C.SPECIALISTS[C.FA], st2)
    with pytest.raises(V.VoiceError):
        V.piper_download("not-a-voice")


def test_piper_not_installed_message(monkeypatch):
    import builtins
    real = builtins.__import__
    monkeypatch.setattr(builtins, "__import__", lambda n, *a, **k: (_ for _ in ()).throw(ImportError("x")) if n == "piper" else real(n, *a, **k))
    with pytest.raises(V.VoiceError, match="natural voice is not set up"):
        V.tts(HubConfig(), "Hello", provider="piper")


def test_agent_tech_endpoint(tmp_path):
    cfg = HubConfig()
    tok = cfg.new_token()
    c = TestClient(create_api(cfg, Usage(), str(tmp_path / "d.db"), str(tmp_path / "ag")))
    t = c.get("/agent/tech", headers={"Authorization": "Bearer " + tok}).json()
    assert t["packages"]["langgraph"] and t["packages"]["langchain-core"] and t["packages"]["fastapi"] and "demo" in t["providers"]


def test_whisper_gets_decoded_samples_not_a_file(monkeypatch):
    """faster-whisper's own decoder (PyAV) broke with PyAV 15+ ('metadata_errors'): the hub decodes the WAV itself."""
    import io
    import sys
    import types
    import wave

    import numpy as np
    seen = {}

    class FakeModel:
        def __init__(self, *a, **k):
            pass

        def transcribe(self, audio, **k):
            seen["audio"] = audio
            return [types.SimpleNamespace(text=" hello there ")], None
    monkeypatch.setitem(sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=FakeModel))
    monkeypatch.setattr(V, "_whisper", None)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x10" * 8000)
    r = V.stt(HubConfig(), base64.b64encode(buf.getvalue()).decode(), provider="whisper")
    assert r["text"] == "hello there"
    assert isinstance(seen["audio"], np.ndarray) and seen["audio"].dtype == np.float32 and seen["audio"].shape == (8000,)


# ── Dictate: Foundry Local's Whisper in the hub's own process (the SDK is faked - no download, no native runtime in CI) ──
def _wav(seconds=0.5):
    import io
    import wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x10" * int(16000 * seconds))
    return buf.getvalue()


def _fake_foundry(monkeypatch, aliases=("phi-4-mini", "whisper-tiny", "whisper-base"), cached=()):
    """A stand-in for the foundry_local_sdk package: a catalog with Whisper models and an AudioSession that answers."""
    import os
    import sys
    import types
    seen = {"requests": [], "downloaded": [], "loaded": [], "config": None, "progress": []}

    class Info:
        def __init__(self, alias):
            self.task = "audio-transcription" if "whisper" in alias else "chat-completion"
            self.file_size_mb = {"whisper-tiny": 75, "whisper-base": 145}.get(alias, 2300)
            self.license = "MIT"

    class Model:
        def __init__(self, alias):
            self.alias, self.id, self.info = alias, alias + "-generic-cpu:1", Info(alias)
            self.is_cached, self.is_loaded = alias in cached, False
            self.input_modalities = "audio" if "whisper" in alias else "text"

        def download(self, progress_callback=None, cancel_event=None):
            for pc in (25.0, 100.0):
                if progress_callback:
                    progress_callback(pc)
                    seen["progress"].append(pc)
            self.is_cached = True
            seen["downloaded"].append(self.alias)

        def load(self):
            self.is_loaded = True
            seen["loaded"].append(self.alias)

    class Catalog:
        def __init__(self):
            self.models = [Model(a) for a in aliases]

        def list_models(self):
            return list(self.models)

        def get_cached_models(self):
            return [m for m in self.models if m.is_cached]

        def get_model(self, alias):
            return next((m for m in self.models if m.alias == alias), None)

    class Manager:
        instance = None

        def __init__(self, config):
            seen["config"] = config
            Manager.instance = self
            self.catalog = Catalog()

        @staticmethod
        def initialize(config):
            Manager(config)

        def get_catalog(self, *a, **k):
            return self.catalog

    class Configuration:
        def __init__(self, **kw):
            self.kw = kw

    class Item:
        def __init__(self, text=None, type=None):
            self.text = text

    class Request:
        def __init__(self):
            self.items = []

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def add_item(self, item, transfer_ownership=True):
            self.items.append(item)
            return self

    class Resp:
        def __init__(self, text):
            self._t = text

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get_item(self, i):
            return Item(self._t)

    class AudioSession:
        def __init__(self, model):
            self.model = model

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def process_request(self, request):
            req = json.loads(request.items[0].text)
            seen["requests"].append(req)
            assert os.path.exists(req["filename"]) and req["filename"].endswith(".wav")
            return Resp(json.dumps({"text": " show trips for tomorrow "}))

    pkg = types.ModuleType("foundry_local_sdk")
    pkg.Configuration, pkg.FoundryLocalManager = Configuration, Manager
    items = types.ModuleType("foundry_local_sdk.items")
    items.TextItem, items.TextItemType = Item, types.SimpleNamespace(OPENAI_JSON=1)
    request = types.ModuleType("foundry_local_sdk.request")
    request.Request = Request
    session = types.ModuleType("foundry_local_sdk.session")
    session.AudioSession = AudioSession
    for name, mod in (("foundry_local_sdk", pkg), ("foundry_local_sdk.items", items), ("foundry_local_sdk.request", request), ("foundry_local_sdk.session", session)):
        monkeypatch.setitem(sys.modules, name, mod)
    monkeypatch.setattr(V, "_foundry", {"mgr": None, "model": None, "alias": None})
    monkeypatch.setattr(V, "_fsetup", {"state": "idle", "log": "", "error": None, "model": None})
    return seen


def test_foundry_dictation_transcribes_on_this_pc(monkeypatch):
    import os
    seen = _fake_foundry(monkeypatch, cached=("whisper-base",))
    cfg = HubConfig()
    r = V.stt(cfg, base64.b64encode(_wav()).decode(), language="en", provider="foundry")
    assert r["text"] == "show trips for tomorrow" and r["provider"] == "foundry"
    req = seen["requests"][0]
    assert req["language"] == "en" and req["model"].startswith("whisper-base")     # default size 'base' → whisper-base, already cached
    assert seen["downloaded"] == [] and seen["loaded"] == ["whisper-base"]
    assert not os.path.exists(req["filename"])                                      # the temp recording is removed after the transcription
    assert str(seen["config"].kw["model_cache_dir"]).endswith(os.path.join("foundry", "models"))
    # the model is loaded once per hub process; the second call reuses it
    V.stt(cfg, base64.b64encode(_wav()).decode(), provider="foundry")
    assert seen["loaded"] == ["whisper-base"] and len(seen["requests"]) == 2
    st = V.foundry_status(cfg)
    assert st["installed"] and st["ready"] and st["model"] == "whisper-base"


def test_foundry_model_choice_and_not_set_up(monkeypatch):
    # nothing cached yet → a transcription never starts a download: the page gets "not set up" and offers the setup
    _fake_foundry(monkeypatch)
    with pytest.raises(V.VoiceError, match="not set up"):
        V.stt(HubConfig(), base64.b64encode(_wav()).decode(), provider="foundry")
    # the size setting picks the model; an explicit alias wins; an unknown alias falls back to the size
    seen = _fake_foundry(monkeypatch, cached=("whisper-tiny", "whisper-base"))
    V.stt(HubConfig({"voice": {"stt": {"whisper_size": "tiny"}}}), base64.b64encode(_wav()).decode(), provider="foundry")
    assert seen["requests"][-1]["model"].startswith("whisper-tiny")
    seen = _fake_foundry(monkeypatch, cached=("whisper-tiny", "whisper-base"))
    V.stt(HubConfig({"voice": {"stt": {"whisper_size": "tiny", "foundry_model": "whisper-base"}}}), base64.b64encode(_wav()).decode(), provider="foundry")
    assert seen["requests"][-1]["model"].startswith("whisper-base")
    seen = _fake_foundry(monkeypatch, cached=("whisper-base",))
    V.stt(HubConfig({"voice": {"stt": {"whisper_size": "small", "foundry_model": "whisper-large-v3"}}}), base64.b64encode(_wav()).decode(), provider="foundry")
    assert seen["requests"][-1]["model"].startswith("whisper-base")                 # neither exists on this PC: the one that is cached
    # the SDK not installed at all → the same readable message (the setup dialog looks for "not set up")
    import sys
    for n in [k for k in sys.modules if k.startswith("foundry_local_sdk")]:
        monkeypatch.delitem(sys.modules, n)
    monkeypatch.setattr(V, "_foundry", {"mgr": None, "model": None, "alias": None})
    import builtins
    real = builtins.__import__
    monkeypatch.setattr(builtins, "__import__", lambda n, *a, **k: (_ for _ in ()).throw(ImportError("x")) if n.startswith("foundry_local_sdk") else real(n, *a, **k))
    with pytest.raises(V.VoiceError, match="not set up"):
        V.stt(HubConfig(), base64.b64encode(_wav()).decode(), provider="foundry")


def test_foundry_install_downloads_the_model_once(monkeypatch):
    seen = _fake_foundry(monkeypatch)
    pips = []
    monkeypatch.setattr(V, "_pip", lambda *pkgs: pips.append(pkgs) or "Successfully installed")
    cfg = HubConfig({"voice": {"stt": {"whisper_size": "tiny"}}})
    st = V.foundry_install(cfg)
    assert st["state"] == "running"
    V._fthread.join(10)
    st = V.foundry_status(cfg)
    assert st["state"] == "done" and st["model"] == "whisper-tiny" and st["ready"], st
    assert pips == [] and seen["downloaded"] == ["whisper-tiny"] and seen["loaded"] == ["whisper-tiny"]     # the fake package counts as installed: no pip
    assert "100%" in st["log"] and "Ready" in st["log"]
    assert cfg.voice["stt"]["provider"] == "browser"                                 # dictation only: the hands-free voice mode keeps its own setting
    # now the dictation works at once, without another download
    r = V.stt(cfg, base64.b64encode(_wav()).decode(), provider="foundry")
    assert r["text"] == "show trips for tomorrow" and seen["downloaded"] == ["whisper-tiny"]


def test_foundry_api_and_status(tmp_path):
    cfg = HubConfig()
    tok = cfg.new_token()
    c = TestClient(create_api(cfg, Usage(), str(tmp_path / "d.db"), str(tmp_path / "ag")))
    h = {"Authorization": "Bearer " + tok}
    st = c.get("/voice/foundry", headers=h).json()
    assert st["state"] == "idle" and "installed" in st and "ready" in st
    vc = c.get("/voice/config", headers=h).json()
    assert "foundry" in vc["stt_providers"] and "foundry" in vc and vc["voice"]["stt"]["foundry_model"] == ""
    v = c.put("/voice/config", json={"voice": {"stt": {"foundry_model": "whisper-small"}}}, headers=h).json()["voice"]
    assert v["stt"]["foundry_model"] == "whisper-small"
    if not V.foundry_installed():      # CI: the real SDK is absent → the readable 400 the setup dialog looks for
        r = c.post("/voice/stt", json={"audio_b64": base64.b64encode(_wav()).decode(), "provider": "foundry"}, headers=h)
        assert r.status_code == 400 and "not set up" in r.json()["detail"]
