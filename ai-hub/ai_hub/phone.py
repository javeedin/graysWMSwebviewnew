"""Phone calls for the AI Agent through Twilio ConversationRelay.

Twilio does the telephony, speech recognition and the natural voice (ElevenLabs / Google / Amazon); this module talks
to it over one WebSocket per call with plain text: Twilio sends what the person said ({"type":"prompt"}), we answer
with what the agent says ({"type":"text"}). The agent is the normal AI Agent graph in phone mode (voice.PHONE_STYLE,
only read tools, end_call / take_message).

Safety
  * Outbound calls only through the phone_call tool / Calls dialog AFTER the user's confirm card (policy phone_call),
    only to allowed number prefixes, with a time limit; the agent always says it is an AI and the call is transcribed.
  * Inbound: off | known | everyone. Data is shared only with a KNOWN number that typed its PIN (caller ID can be
    faked, the PIN cannot); everyone else can only leave a message. Outbound calls get no data tools - the facts the
    user put in the goal are all the agent may share.
  * Nothing that changes data runs on a call (phone mode offers no act / ask tools).
  * Twilio requests are checked with X-Twilio-Signature (HMAC-SHA1 with the auth token); each call's WebSocket URL
    carries a random key. The phone server listens on its own port (default 8101) with only these routes - point a
    tunnel (cloudflared / ngrok) at it, never at the main hub port.
  * Read tools during a call are run by an open AI Agent page of the same app user (GET /voice/calls/pending); if
    none answers within ~25 s the agent says it cannot look it up now.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import re
import secrets as pysecrets
import threading
import time
import uuid
from urllib.parse import parse_qsl, urlencode
from xml.sax.saxutils import quoteattr

import httpx
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect

from . import secrets
from .agents import catalog as C
from .config import HubConfig
from .voice import speakable

TWILIO_API = "https://api.twilio.com/2010-04-01"
E164 = re.compile(r"^\+[1-9]\d{6,14}$")
# tools a PIN-verified caller's conversation may use (read-only, run by the app)
PHONE_CAPS = [t.name for t in C.TOOLS if t.runs != "hub" and t.risk in ("read", "auto")]
TOOL_WAIT_S = 25


def pin_hash(number: str, pin: str) -> str:
    return hashlib.sha256(f"{number}|{pin}".encode()).hexdigest()


def twilio_signature(auth_token: str, url: str, params: dict) -> str:
    data = url + "".join(k + str(params[k]) for k in sorted(params))
    return base64.b64encode(hmac.new(auth_token.encode(), data.encode("utf-8"), hashlib.sha1).digest()).decode()


class PhoneError(Exception):
    pass


class PhoneManager:
    def __init__(self, cfg: HubConfig, svc):
        self.cfg, self.svc, self.store = cfg, svc, svc.store
        self.end_requested: set[str] = set()
        self._lock = threading.Lock()
        svc.phone = self

    # ── settings ──
    @property
    def p(self) -> dict:
        return self.cfg.phone

    def ready(self) -> tuple[bool, str]:
        p = self.p
        if not p.get("enabled"):
            return False, "Phone calls are switched off (Calls › Settings)."
        if not p.get("account_sid") or not secrets.has_secret("twilio.auth_token"):
            return False, "Twilio account SID / auth token missing."
        if not E164.match(p.get("from_number") or ""):
            return False, "Twilio phone number (from) missing."
        if not re.match(r"^https://", p.get("public_url") or ""):
            return False, "Public https address of the phone server missing (a tunnel to port %s)." % p.get("port", 8101)
        return True, ""

    def status(self) -> dict:
        ok, why = self.ready()
        p = dict(self.p)
        p["known"] = {n: {"user": v.get("user"), "pin": bool(v.get("pin_sha256"))} for n, v in (p.get("known") or {}).items()}
        active = self.store.all("SELECT id, direction, number, name, status, started FROM calls WHERE status IN ('ringing','queued','in-progress','initiated') "
                                "AND started > ?", (time.time() - 3 * 3600,))
        return {"ready": ok, "why": why, "settings": p, "auth_token": secrets.has_secret("twilio.auth_token"),
                "voice_url": (p.get("public_url") or "").rstrip("/") + "/twilio/voice", "active": active}

    def base(self) -> str:
        return (self.p.get("public_url") or "").rstrip("/")

    def _auth(self) -> tuple[str, str]:
        tok = secrets.get_secret("twilio.auth_token")
        if not tok:
            raise PhoneError("Twilio auth token missing.")
        return self.p["account_sid"], tok

    def set_known(self, number: str, user: str | None, pin: str | None) -> dict:
        if not E164.match(number or ""):
            raise PhoneError("Number must be international format, e.g. +2305xxxxxxx")
        known = dict(self.p.get("known") or {})
        if not user:
            known.pop(number, None)
        else:
            if pin is not None and not re.fullmatch(r"\d{4,8}", pin):
                raise PhoneError("PIN: 4-8 digits")
            e = dict(known.get(number) or {})
            e["user"] = user
            if pin:
                e["pin_sha256"] = pin_hash(number, pin)
            known[number] = e
        self.p["known"] = known
        self.cfg.save()
        return {"ok": True}

    # ── Twilio REST ──
    def _twiml(self, cid: str, k: str, greeting: str, language: str | None = None) -> str:
        p = self.p
        url = self.base().replace("https://", "wss://", 1) + "/twilio/relay?" + urlencode({"call": cid, "k": k})
        attrs = {"url": url, "welcomeGreeting": greeting, "language": language or p.get("language") or "en-US",
                 "ttsProvider": p.get("tts_provider") or "ElevenLabs", "interruptible": "any", "dtmfDetection": "true"}
        if p.get("voice"):
            attrs["voice"] = p["voice"]
        a = " ".join(f"{k_}={quoteattr(str(v))}" for k_, v in attrs.items())
        return f'<?xml version="1.0" encoding="UTF-8"?><Response><Connect><ConversationRelay {a} /></Connect></Response>'

    def place_call(self, to: str, goal: str, name: str | None, app_user: str | None, language: str | None = None,
                   origin_thread: str | None = None) -> dict:
        ok, why = self.ready()
        if not ok:
            raise PhoneError(why)
        to = re.sub(r"[\s\-()]", "", to or "")
        if not E164.match(to):
            raise PhoneError("Number must be international format, e.g. +2305xxxxxxx")
        if not any(to.startswith(x) for x in (self.p.get("allowed_prefixes") or [])):
            raise PhoneError(f"Calls to {to} are not allowed (allowed prefixes: {', '.join(self.p.get('allowed_prefixes') or []) or 'none'}).")
        if not (goal or "").strip():
            raise PhoneError("Say what the call is for (goal).")
        cid, k = "call_" + uuid.uuid4().hex[:12], pysecrets.token_urlsafe(24)
        company = self.p.get("company") or "Gray's"
        greeting = (f"Hello{(' ' + name) if name else ''}, this is the {company} AI assistant calling"
                    f"{(' on behalf of ' + app_user.title()) if app_user else ''}. Just so you know, I'm an AI and this call is transcribed. "
                    "Is now a good moment?")
        now = time.time()
        self.store.run("INSERT INTO calls (id, direction, number, name, app_user, status, goal, thread_id, k, verified, started, origin_thread) "
                       "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (cid, "outbound", to, name, app_user, "queued", goal.strip()[:2000],
                                                            "ag_" + uuid.uuid4().hex[:16], k, 0, now, origin_thread))
        self._append(cid, "agent", greeting)
        sid, tok = self._auth()
        try:
            r = httpx.post(f"{TWILIO_API}/Accounts/{sid}/Calls.json", auth=(sid, tok), timeout=30, data={
                "To": to, "From": self.p["from_number"], "Twiml": self._twiml(cid, k, greeting, language),
                "StatusCallback": self.base() + "/twilio/status?" + urlencode({"call": cid, "k": k}),
                "StatusCallbackEvent": ["initiated", "ringing", "answered", "completed"],
                "TimeLimit": str(int(self.p.get("max_minutes") or 10) * 60)})
        except httpx.HTTPError as e:
            self._set(cid, status="failed", error=str(e))
            raise PhoneError(f"Twilio could not be reached: {e}") from e
        if r.status_code >= 400:
            msg = (r.json() if r.headers.get("content-type", "").startswith("application/json") else {}).get("message") or r.text[:200]
            self._set(cid, status="failed", error=msg)
            raise PhoneError(f"Twilio refused the call: {msg}")
        self._set(cid, twilio_sid=r.json().get("sid"), status="initiated")
        return {"ok": True, "call_id": cid, "to": to}

    def connect_number(self) -> dict:
        """Points the Twilio number's 'A call comes in' webhook at this phone server."""
        sid, tok = self._auth()
        r = httpx.get(f"{TWILIO_API}/Accounts/{sid}/IncomingPhoneNumbers.json", params={"PhoneNumber": self.p["from_number"]}, auth=(sid, tok), timeout=30)
        nums = r.json().get("incoming_phone_numbers", []) if r.status_code < 400 else []
        if not nums:
            raise PhoneError(f"{self.p['from_number']} is not a number of this Twilio account.")
        url = self.base() + "/twilio/voice"
        r = httpx.post(f"{TWILIO_API}/Accounts/{sid}/IncomingPhoneNumbers/{nums[0]['sid']}.json", auth=(sid, tok), timeout=30,
                       data={"VoiceUrl": url, "VoiceMethod": "POST"})
        if r.status_code >= 400:
            raise PhoneError("Twilio: " + r.text[:200])
        return {"ok": True, "voice_url": url}

    def hangup(self, cid: str) -> dict:
        row = self.get(cid)
        if row.get("twilio_sid"):
            sid, tok = self._auth()
            httpx.post(f"{TWILIO_API}/Accounts/{sid}/Calls/{row['twilio_sid']}.json", auth=(sid, tok), data={"Status": "completed"}, timeout=30)
        self.end_requested.add(cid)
        return {"ok": True}

    # ── calls table ──
    def get(self, cid: str) -> dict:
        r = self.store.one("SELECT * FROM calls WHERE id = ?", (cid,))
        if not r:
            raise KeyError(cid)
        r["transcript"] = json.loads(r.get("transcript") or "[]")
        return r

    def list(self, user: str | None, limit: int = 50) -> list[dict]:
        rows = self.store.all("SELECT id, direction, number, name, app_user, status, goal, started, answered, ended, summary, message, verified, error, thread_id "
                              "FROM calls ORDER BY started DESC LIMIT ?", (limit,))
        # a user sees their own calls and inbound calls (messages for the team)
        return [r for r in rows if not user or r["app_user"] in (user, None) or r["direction"] == "inbound"]

    def _set(self, cid: str, **kw) -> None:
        if kw:
            self.store.run("UPDATE calls SET " + ", ".join(f"{k} = ?" for k in kw) + " WHERE id = ?", (*kw.values(), cid))

    def _append(self, cid: str, who: str, text: str) -> None:
        with self._lock:
            r = self.store.one("SELECT transcript FROM calls WHERE id = ?", (cid,))
            t = json.loads((r or {}).get("transcript") or "[]")
            t.append({"who": who, "text": text, "ts": time.time()})
            self.store.run("UPDATE calls SET transcript = ? WHERE id = ?", (json.dumps(t), cid))

    # ── agent tools (hub) ──
    def hub_tool(self, name: str, args: dict, s: dict, tid: str) -> tuple[str, bool, dict]:
        call = s.get("call") or {}
        if name == "end_call":
            if call.get("id"):
                self.end_requested.add(call["id"])
            return "The call ends after your goodbye.", False, {}
        if name == "take_message":
            if not call.get("id"):
                return "Not on a call.", True, {}
            msg = {k: str(args.get(k) or "")[:500] for k in ("name", "company", "callback", "message")}
            self._set(call["id"], message=json.dumps(msg))
            return "Message saved for the team.", False, {}
        if name == "phone_call":
            try:
                r = self.place_call(args.get("to"), args.get("goal"), args.get("name"), s.get("app_user"), args.get("language"), origin_thread=tid)
            except PhoneError as e:
                return f"Call not placed: {e}", True, {}
            self.svc.emit(tid, "call_placed", {"call_id": r["call_id"], "to": r["to"]})
            return (f"Calling {r['to']} now (call {r['call_id']}). The transcript and summary appear in AI Agent › Calls; "
                    "tell the user you'll report back when it ends."), False, {}
        return f"Unknown phone tool {name}", True, {}

    def pending(self, user: str | None) -> list[dict]:
        """Phone conversations waiting for read tools the AI Agent page of this app user can run now."""
        rows = self.store.all("SELECT c.thread_id, c.app_user FROM calls c JOIN threads t ON t.id = c.thread_id "
                              "WHERE t.status = 'waiting' AND c.status = 'in-progress'")
        out = []
        for r in rows:
            if user and r["app_user"] != user:
                continue
            snap = self.svc.snapshot(r["thread_id"])
            calls = (snap.get("waiting") or {}).get("calls") or []
            if calls and all(c.get("risk") in ("read", "auto") for c in calls):
                out.append(snap)
        return out

    # ── one conversational turn ──
    def ctx(self, row: dict) -> dict:
        return {"id": row["id"], "verified": bool(row.get("verified")), "user": row.get("app_user"),
                "goal": row.get("goal") if row["direction"] == "outbound" else None, "company": self.p.get("company")}

    def run_turn(self, cid: str, text: str) -> None:
        row = self.get(cid)
        tid = row["thread_id"]
        verified = bool(row.get("verified"))
        user = row.get("app_user") if (verified or row["direction"] == "outbound") else f"PHONE:{row['number']}"
        caps = PHONE_CAPS if verified and row["direction"] == "inbound" else []
        exists = self.store.one("SELECT 1 AS x FROM threads WHERE id = ?", (tid,))
        if not exists:
            label = f"📞 {row.get('name') or row['number']}: "
            r = self.svc.start(text, app_user=user, caps=caps, voice="phone", call=self.ctx(row), thread_id=tid, pod="PROD")
            self.store.run("UPDATE threads SET title = ? WHERE id = ?", ((label + (row.get("goal") or text))[:90], tid))
        else:
            r = self.svc.send(tid, text, app_user=user, caps=caps, voice="phone", call=self.ctx(row))
        deadline = time.time() + TOOL_WAIT_S
        while r.get("status") in ("waiting", "running") or r.get("busy"):
            if r.get("status") == "waiting" and time.time() > deadline:
                calls = (r.get("waiting") or {}).get("calls") or []
                res = {c["id"]: {"ok": False, "content": "Could not look this up during the call (no AI Agent page answered). "
                                                         "Offer that someone calls back, and take_message."} for c in calls}
                r = self.svc.resume(tid, {"results": res})
                deadline = time.time() + 5
                continue
            time.sleep(0.4)
            r = self.svc.snapshot(tid)

    def last_seq(self, tid: str) -> int:
        r = self.store.one("SELECT MAX(seq) AS m FROM events WHERE thread_id = ?", (tid,))
        return int((r or {}).get("m") or 0)

    def finish(self, cid: str, status: str = "completed") -> None:
        row = self.get(cid)
        if row.get("ended"):
            return
        self._set(cid, status=status, ended=time.time())
        threading.Thread(target=self._summarize, args=(cid,), daemon=True).start()

    def _summarize(self, cid: str) -> None:
        try:
            row = self.get(cid)
            lines = "\n".join(f"{x['who']}: {x['text']}" for x in row["transcript"])
            if len(row["transcript"]) < 2:
                return
            from .gateway import ChatRequest
            res = self.svc.gateway.chat(ChatRequest(messages=[{"role": "user", "content": "Summarise this phone call for the team in 2-4 short lines: "
                                                               "outcome, anything promised, follow-ups. Plain text.\n\n" + lines[:20000]}],
                                                    task="cheap", max_tokens=300, app_user=row.get("app_user")))
            summary = res.get("text") if isinstance(res, dict) else getattr(res, "text", "")
            self._set(cid, summary=(summary or "")[:2000])
            if row.get("origin_thread"):
                self.svc.emit(row["origin_thread"], "call_done", {"call_id": cid, "to": row["number"], "status": row["status"], "summary": summary})
        except Exception as e:  # noqa: BLE001 - a missing summary must not break anything
            self._set(cid, error=f"summary: {e}")

    # ── Twilio inbound webhook ──
    def inbound(self, params: dict) -> str:
        p = self.p
        mode = p.get("inbound") or "off"
        number = params.get("From") or ""
        company = p.get("company") or "Gray's"
        if not p.get("enabled") or mode == "off":
            return f'<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you for calling {company}. Nobody can take your call right now. Goodbye.</Say><Hangup/></Response>'
        known = (p.get("known") or {}).get(number) if mode == "known" else None
        cid, k = "call_" + uuid.uuid4().hex[:12], pysecrets.token_urlsafe(24)
        greeting = (f"Hello, you've reached the {company} AI assistant. I'm an AI and this call is transcribed. "
                    + ("If you have a PIN, type it now followed by the hash key. " if known and known.get("pin_sha256") else "")
                    + "How can I help?")
        self.store.run("INSERT INTO calls (id, direction, number, app_user, status, thread_id, k, verified, started, twilio_sid) "
                       "VALUES (?,?,?,?,?,?,?,?,?,?)", (cid, "inbound", number, (known or {}).get("user"), "ringing",
                                                        "ag_" + uuid.uuid4().hex[:16], k, 0, time.time(), params.get("CallSid")))
        self._append(cid, "agent", greeting)
        return self._twiml(cid, k, greeting)

    def check_pin(self, cid: str, pin: str) -> bool:
        row = self.get(cid)
        known = (self.p.get("known") or {}).get(row["number"]) or {}
        ok = bool(known.get("pin_sha256")) and hmac.compare_digest(known["pin_sha256"], pin_hash(row["number"], pin))
        if ok:
            self._set(cid, verified=1, app_user=known.get("user"))
        return ok

    # ── WebSocket: one live call ──
    async def relay(self, ws: WebSocket, cid: str, k: str) -> None:
        row = self.store.one("SELECT id, k, thread_id FROM calls WHERE id = ?", (cid,))
        if not row or not k or not hmac.compare_digest(row["k"] or "", k):
            await ws.close(code=1008)
            return
        await ws.accept()
        pin = ""
        try:
            while True:
                msg = json.loads(await ws.receive_text())
                t = msg.get("type")
                if t == "setup":
                    self._set(cid, status="in-progress", answered=time.time(), twilio_sid=msg.get("callSid") or None)
                elif t == "dtmf":
                    d = str(msg.get("digit") or "")
                    if d == "#":
                        ok = self.check_pin(cid, pin)
                        pin = ""
                        await self._say(ws, cid, "Thank you, you're verified. What can I do for you?" if ok else "Sorry, that PIN didn't match. You can still leave a message.")
                    elif d.isdigit() and len(pin) < 8:
                        pin += d
                elif t == "prompt":
                    if msg.get("last") is False:
                        continue
                    text = (msg.get("voicePrompt") or "").strip()
                    if not text:
                        continue
                    self._append(cid, "caller", text)
                    await self._turn(ws, cid, row["thread_id"], text)
                    if cid in self.end_requested:
                        await asyncio.sleep(4)
                        await ws.send_text(json.dumps({"type": "end", "handoffData": json.dumps({"reason": "agent ended the call"})}))
                        break
                elif t == "interrupt":
                    self._append(cid, "note", "(caller interrupted)")
                elif t == "error":
                    self._set(cid, error=str(msg.get("description") or msg)[:500])
        except WebSocketDisconnect:
            pass
        finally:
            self.end_requested.discard(cid)
            self.finish(cid)

    async def _say(self, ws: WebSocket, cid: str, text: str) -> None:
        self._append(cid, "agent", text)
        await ws.send_text(json.dumps({"type": "text", "token": text, "last": True}))

    async def _turn(self, ws: WebSocket, cid: str, tid: str, text: str) -> None:
        seq = self.last_seq(tid)
        task = asyncio.create_task(asyncio.to_thread(self.run_turn, cid, text))
        t0, said, filler = time.time(), False, False
        while True:
            done = task.done()
            for e in self.store.all("SELECT seq, kind, data FROM events WHERE thread_id = ? AND seq > ? ORDER BY seq", (tid, seq)):
                seq = e["seq"]
                if e["kind"] == "say":
                    words = speakable(json.loads(e["data"]).get("text") or "")
                    if words:
                        await self._say(ws, cid, words)
                        said = True
            if done:
                break
            if not said and not filler and time.time() - t0 > 2.5:
                await ws.send_text(json.dumps({"type": "text", "token": "One moment.", "last": True}))
                filler = True
            await asyncio.sleep(0.3)
        exc = task.exception()
        if exc or not said:
            sorry = "Sorry, I'm having a problem on my side. Could you try again in a moment?" if exc else "Sorry, I didn't quite get that. Could you say it again?"
            await self._say(ws, cid, sorry)


def create_phone_app(mgr: PhoneManager) -> FastAPI:
    """The public-facing phone server: ONLY the Twilio routes (point the tunnel here, not at the hub API)."""
    app = FastAPI(title="Gray's WMS AI Hub - phone", docs_url=None, redoc_url=None, openapi_url=None)

    async def checked(request: Request) -> dict:
        # Twilio posts application/x-www-form-urlencoded (parsed here - no python-multipart needed)
        form = dict(parse_qsl((await request.body()).decode("utf-8"), keep_blank_values=True))
        tok = secrets.get_secret("twilio.auth_token") or ""
        url = mgr.base() + request.url.path + (("?" + request.url.query) if request.url.query else "")
        sig = request.headers.get("X-Twilio-Signature", "")
        if not tok or not hmac.compare_digest(twilio_signature(tok, url, form), sig):
            raise PermissionError("bad signature")
        return form

    @app.post("/twilio/voice")
    async def voice(request: Request):
        try:
            form = await checked(request)
        except PermissionError:
            return Response(status_code=403)
        return Response(mgr.inbound(form), media_type="application/xml")

    @app.post("/twilio/status")
    async def status(request: Request, call: str = "", k: str = ""):
        try:
            form = await checked(request)
        except PermissionError:
            return Response(status_code=403)
        row = mgr.store.one("SELECT k FROM calls WHERE id = ?", (call,))
        if row and hmac.compare_digest(row["k"] or "", k):
            st = form.get("CallStatus") or ""
            if st in ("completed", "busy", "no-answer", "failed", "canceled"):
                mgr.finish(call, st)
            elif st:
                mgr._set(call, status=st)
        return Response("", media_type="text/plain")

    @app.websocket("/twilio/relay")
    async def relay(ws: WebSocket, call: str = "", k: str = ""):
        await mgr.relay(ws, call, k)

    return app
