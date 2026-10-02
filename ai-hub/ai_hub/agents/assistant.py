"""AI Agent: a LangGraph supervisor with specialists that call tools natively, with the user in the loop.

    START → route ─→ agent ⇄ tools ─→ END
             │         ↑      │ ⏸ interrupt {"type": "tools", calls}: the WMS page (or the C# host) runs page / host
             │         └──────┘   tools - "act" tools only after the user confirms a card the host issued - and resumes
             └ supervisor: rules pick the specialist (Fusion Analyst, WMS Operator, Order Desk, Data Loader, Reporter);
               a specialist can `handoff` to another one mid-conversation.

Guards the model cannot talk its way around (in the graph, not the prompt):
  * a tool is offered only if the specialist owns it AND this app can run it (`caps` from the page)
  * fusion_sql_run is refused unless exactly that SQL passed fusion_sql_dry_run in this thread
  * every model turn is counted; after MAX_TURNS the model must answer without tools
  * a thread that moved on (new message while a card was open) gets "not run" results for the open calls, so the
    conversation always stays valid for every provider

State is checkpointed in SQLite (`agent_state.db`): a thread waits at a confirm card for days and survives restarts.
Events (route, say, call, result, wait, done …) go to `agent.db` for the live timeline and replay; memory facts per
app user are added to every system prompt.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.types import Command, interrupt

from ..db import Store
from ..lc import GatewayChatModel
from ..voice import ACCESS_UNVERIFIED, ACCESS_VERIFIED, PHONE_STYLE, VOICE_STYLE
from . import catalog as C

RESULT_CHARS = 14000          # tool result text the model sees
CACHE_BREAK = "\n\n<<<CACHE_BREAK>>>\n\n"   # Claude providers cache the system prompt up to here (the big, stable knowledge)
ATTACH_TYPES = {"application/pdf": "document", "image/png": "image", "image/jpeg": "image", "image/gif": "image", "image/webp": "image"}
EVENT_BYTES = 400_000         # largest event payload kept for the timeline


class Cancelled(Exception):
    pass


class AgentState(TypedDict, total=False):
    messages: Annotated[list[BaseMessage], add_messages]
    specialist: str
    pinned: bool
    app_user: str
    pod: str
    caps: list
    dry_ok: list
    turns: int
    results: list
    model: dict
    voice: str          # "app" (spoken in the app) | "phone" (a live call) | ""
    call: dict          # phone: {id, verified, user, goal, company}


def sql_key(sql: str) -> str:
    """Whitespace / case / trailing-semicolon insensitive fingerprint of a query."""
    s_ = re.sub(r"\s+", " ", (sql or "").strip().rstrip(";")).strip().lower()
    return hashlib.sha256(s_.encode()).hexdigest()[:24]


def repair(messages: list[BaseMessage]) -> list[BaseMessage]:
    """Every AI tool call needs a tool result right after it (all providers reject anything else)."""
    out: list[BaseMessage] = []
    answered = {m.tool_call_id for m in messages if isinstance(m, ToolMessage)}
    for m in messages:
        out.append(m)
        if isinstance(m, AIMessage):
            for tc in m.tool_calls or []:
                if tc["id"] not in answered:
                    out.append(ToolMessage(content="Not run - the user moved on before this finished.", tool_call_id=tc["id"], status="error"))
    # ToolMessages whose call vanished would break the order too
    ids = {tc["id"] for m in out if isinstance(m, AIMessage) for tc in (m.tool_calls or [])}
    return [m for m in out if not isinstance(m, ToolMessage) or m.tool_call_id in ids]


def _last_human(messages: list[BaseMessage]) -> str:
    for m in reversed(messages):
        if isinstance(m, HumanMessage):
            if isinstance(m.content, str):
                return m.content
            return " ".join(b.get("text", "") for b in m.content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def attach_blocks(attachments: list | None) -> list[dict]:
    """[{name, media_type, data(base64) | text}] → content blocks (PDF = document, image = image, text inline)."""
    out = []
    for a in attachments or []:
        if not isinstance(a, dict):
            continue
        name, mt = str(a.get("name") or "file")[:120], str(a.get("media_type") or a.get("type") or "")
        if a.get("text") is not None:
            out.append({"type": "text", "text": f"Attached file {name}:\n" + str(a["text"])[:60000]})
        elif mt in ATTACH_TYPES and a.get("data"):
            out.append({"type": ATTACH_TYPES[mt], "source": {"type": "base64", "media_type": mt, "data": a["data"]}})
            out.append({"type": "text", "text": f"(above: {name})"})
    return out


def human(text: str, attachments: list | None) -> HumanMessage:
    blocks = attach_blocks(attachments)
    return HumanMessage(content=[{"type": "text", "text": text}] + blocks if blocks else text)


def build_graph(svc: "AgentService"):
    def route(s: AgentState, config):
        tid = config["configurable"]["thread_id"]
        text = _last_human(s["messages"])
        if s.get("pinned") and s.get("specialist"):
            sid, scores = s["specialist"], {}
        else:
            sid, scores = C.route(text, s.get("specialist"))
        if sid != s.get("specialist"):
            svc.emit(tid, "route", {"specialist": sid, "title": C.SPECIALISTS[sid].title, "scores": scores})
            svc.store.run("UPDATE threads SET specialist = ? WHERE id = ?", (sid, tid))
        return {"specialist": sid, "turns": 0}

    def agent(s: AgentState, config):
        tid = config["configurable"]["thread_id"]
        svc.check_cancel(tid)
        sp = C.SPECIALISTS[s.get("specialist") or C.FA]
        turns = (s.get("turns") or 0) + 1
        tools = C.tools_for(sp.id, s.get("caps"), "phone" if s.get("voice") == "phone" else None)
        sysmsg = svc.system_prompt(sp, s)
        if turns > C.MAX_TURNS:
            sysmsg += "\n\nYou have used all tool turns for this request: answer now with what you have, no more tools."
            tools = []
        m = s.get("model") or {}
        llm = GatewayChatModel(gateway=svc.gateway, task=sp.task, app_user=s.get("app_user"), max_tokens=4000,
                               provider=m.get("provider") or None, model_id=m.get("model") or None)
        if tools:
            llm = llm.bind_tools([t.spec() for t in tools])
        svc.emit(tid, "thinking", {"specialist": sp.id, "turn": turns})
        ai: AIMessage = llm.invoke([SystemMessage(content=sysmsg)] + repair(s["messages"]))
        meta = ai.response_metadata or {}
        svc.add_usage(tid, ai.usage_metadata or {}, meta)
        text = ai.content if isinstance(ai.content, str) else ""
        if text.strip():
            svc.emit(tid, "say", {"text": text, "specialist": sp.id, "model": meta.get("model"), "provider": meta.get("provider"),
                                  "final": not ai.tool_calls})
        for tc in ai.tool_calls or []:
            t = C.BY_NAME.get(tc["name"])
            svc.emit(tid, "call", {"id": tc["id"], "name": tc["name"], "input": tc.get("args") or {},
                                   "risk": t.risk if t else "read", "runs": t.runs if t else "?"})
        return {"messages": [ai], "turns": turns}

    def after_agent(s: AgentState):
        last = s["messages"][-1]
        return "tools" if isinstance(last, AIMessage) and last.tool_calls else END

    def tools(s: AgentState, config):
        tid = config["configurable"]["thread_id"]
        ai: AIMessage = s["messages"][-1]
        caps = set(s.get("caps") or [])
        dry_ok = list(s.get("dry_ok") or [])
        allowed = {t.name for t in C.tools_for(s.get("specialist") or C.FA, s.get("caps"), "phone" if s.get("voice") == "phone" else None)}
        immediate: dict[str, tuple[str, bool]] = {}
        outside: list[dict] = []
        for tc in ai.tool_calls:
            t, args = C.BY_NAME.get(tc["name"]), tc.get("args") or {}
            if not t or tc["name"] not in allowed or (t.runs != "hub" and s.get("caps") is not None and tc["name"] not in caps):
                immediate[tc["id"]] = (f"Tool {tc['name']} is not available here.", True)
            elif tc["name"] == "fusion_sql_run" and sql_key(args.get("sql", "")) not in dry_ok:
                immediate[tc["id"]] = ("Refused: run fusion_sql_dry_run with exactly this SQL first (it must pass).", True)
            elif t.runs == "hub" and t.risk != "act":
                pass                                              # handled after the interrupt (no side effects before it)
            else:
                outside.append({"id": tc["id"], "name": t.name, "input": args, "risk": t.risk, "runs": t.runs, "policy": t.policy,
                                "pod": s.get("pod") or "PROD"})
        results: dict = {}
        if outside:
            value = interrupt({"type": "tools", "specialist": s.get("specialist"), "calls": outside})
            results = (value or {}).get("results") or {} if isinstance(value, dict) else {}
        msgs, upd, res_list = [], {}, list(s.get("results") or [])
        for tc in ai.tool_calls:
            cid, name, args = tc["id"], tc["name"], tc.get("args") or {}
            t = C.BY_NAME.get(name)
            data, att = None, None
            if cid in immediate:
                content, err = immediate[cid]
            elif t and t.runs == "hub" and (t.risk != "act" or (results.get(cid) or {}).get("approved")):
                content, err, extra = svc.run_hub_tool(name, args, s, tid)
                upd.update(extra)
            else:
                r = results.get(cid)
                if r is None:
                    content, err = "Not run (no answer from the app).", True
                else:
                    err = not r.get("ok", False)
                    content = r.get("content")
                    if content is None:
                        content = json.dumps(r.get("data"), default=str) if r.get("data") is not None else ("OK" if not err else "Failed")
                    content = str(content)
                    data = r.get("data")
                    att = r.get("attachment")
                    if name == "fusion_sql_dry_run" and not err:
                        dry_ok.append(sql_key(args.get("sql", "")))
                    if isinstance(data, dict) and data.get("result_id"):
                        res_list.append({"result_id": data["result_id"], "title": data.get("title") or args.get("title") or name,
                                         "rows": data.get("row_count"), "tool": name})
            if len(content) > RESULT_CHARS:
                content = content[:RESULT_CHARS] + f"\n… (cut, {len(content)} characters)"
            # a tool may return files for the model to look at: attachment (one) + attachments (more pages, max 6)
            more = (results.get(cid) or {}).get("attachments") if cid not in immediate else None
            files = ([att] if isinstance(att, dict) else []) + [x for x in (more or [])[:5] if isinstance(x, dict)]
            blocks = attach_blocks(files)
            msgs.append(ToolMessage(content=[{"type": "text", "text": content}] + blocks if blocks else content, tool_call_id=cid,
                                    status="error" if err else "success"))
            svc.emit(tid, "result", {"id": cid, "name": name, "ok": not err, "text": content[:2000], "data": data,
                                     "attachment": ", ".join(str(f.get("name")) for f in files) if blocks else None})
        return {"messages": msgs, "dry_ok": dry_ok[-40:], "results": res_list[-30:], **upd}

    def after_tools(s: AgentState):
        return "agent"

    g = StateGraph(AgentState)
    g.add_node("route", route)
    g.add_node("agent", agent)
    g.add_node("tools", tools)
    g.add_edge(START, "route")
    g.add_edge("route", "agent")
    g.add_conditional_edges("agent", after_agent, {"tools": "tools", END: END})
    g.add_edge("tools", "agent")
    return g


class AgentService:
    def __init__(self, gateway, home: str | Path):
        home = Path(home)
        home.mkdir(parents=True, exist_ok=True)
        self.gateway = gateway
        self.store = Store(str(home / "agent.db"))
        self._ck = sqlite3.connect(str(home / "agent_state.db"), check_same_thread=False)
        self.graph = build_graph(self).compile(checkpointer=SqliteSaver(self._ck))
        self._cancel: set[str] = set()
        self._busy: set[str] = set()
        self._usage: dict[str, dict] = {}
        self._lock = threading.Lock()
        self.phone = None              # PhoneManager (ai_hub/phone.py) when the hub serves calls

    # ── events / usage ──
    def emit(self, tid: str, kind: str, data: dict) -> None:
        raw = json.dumps(data, default=str)
        if len(raw) > EVENT_BYTES:
            data = {k: v for k, v in data.items() if k != "data"}
            data["data_cut"] = True
            raw = json.dumps(data, default=str)
        with self.store.lock:
            n = self.store.one("SELECT COALESCE(MAX(seq), 0) AS n FROM events WHERE thread_id = ?", (tid,))["n"] + 1
            self.store.run("INSERT INTO events VALUES (?, ?, ?, ?, ?)", (tid, n, time.time(), kind, raw))

    def add_usage(self, tid: str, usage: dict, meta: dict) -> None:
        u = self._usage.setdefault(tid, {"tokens_in": 0, "tokens_out": 0, "cost": 0.0, "provider": None, "model": None})
        u["tokens_in"] += usage.get("input_tokens", 0)
        u["tokens_out"] += usage.get("output_tokens", 0)
        u["cost"] = round(u["cost"] + (meta.get("cost") or 0), 6)
        u["provider"], u["model"] = meta.get("provider"), meta.get("model")
        self.store.run("UPDATE threads SET cost = cost + ?, tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, turns = turns + 1 WHERE id = ?",
                       (meta.get("cost") or 0, usage.get("input_tokens", 0), usage.get("output_tokens", 0), tid))

    def check_cancel(self, tid: str) -> None:
        if tid in self._cancel:
            self._cancel.discard(tid)
            raise Cancelled()

    # ── prompt ──
    def system_prompt(self, sp: C.Specialist, s: AgentState) -> str:
        user = s.get("app_user") or ""
        facts = self.store.all("SELECT fact FROM memory WHERE app_user = ? ORDER BY id DESC LIMIT 25", (user,)) if user else []
        others = ", ".join(f"{x.id} ({x.title})" for x in C.SPECIALISTS.values() if x.id != sp.id)
        res = s.get("results") or []
        knowledge = self.knowledge_get()
        head = (C.AIDE_HEADER + "\n\n" + knowledge + CACHE_BREAK) if knowledge else ""
        parts = [C.COMMON, sp.prompt,
                 f"Context: today is {datetime.now():%A %d %B %Y %H:%M}; Fusion pod {s.get('pod') or 'PROD'}; app user {user or 'unknown'}.",
                 f"Other specialists you can hand off to: {others}."]
        if facts:
            parts.append("What you know about this user (from `remember`):\n" + "\n".join("- " + f["fact"] for f in reversed(facts)))
        if s.get("voice") in ("app", "phone"):
            parts.append(VOICE_STYLE)
        if s.get("voice") == "phone":
            call = s.get("call") or {}
            access = ACCESS_VERIFIED.format(user=call.get("user")) if call.get("verified") else ACCESS_UNVERIFIED
            goal = f"Goal of this call (you placed it): {call['goal']}\n" if call.get("goal") else "The caller phoned in - find out how you can help.\n"
            parts.append(PHONE_STYLE.format(company=call.get("company") or "Gray's", access=access, goal=goal))
        if res:
            parts.append("Results available in this conversation (use their result_id):\n" +
                         "\n".join(f"- {r['result_id']}: {r.get('title')} ({r.get('rows')} rows)" for r in res[-10:]))
        return head + "\n\n".join(parts)

    # ── knowledge (the AI Digital Employee's prompt, sent by the page) ──
    def knowledge_set(self, text: str, marker: str | None = None) -> dict:
        text = (text or "")[:400000]
        self.store.run("INSERT OR REPLACE INTO kv VALUES ('knowledge', ?, ?)", (text, time.time()))
        self.store.run("INSERT OR REPLACE INTO kv VALUES ('knowledge_marker', ?, ?)", (marker or "", time.time()))
        self._knowledge = text
        return {"ok": True, "chars": len(text), "marker": marker}

    def knowledge_get(self) -> str:
        if getattr(self, "_knowledge", None) is None:
            r = self.store.one("SELECT v FROM kv WHERE k = 'knowledge'")
            self._knowledge = r["v"] if r else ""
        return self._knowledge

    def knowledge_info(self) -> dict:
        r = self.store.one("SELECT v, updated FROM kv WHERE k = 'knowledge_marker'")
        return {"chars": len(self.knowledge_get()), "marker": r["v"] if r else None, "updated": r["updated"] if r else None}

    # ── hub tools ──
    def run_hub_tool(self, name: str, args: dict, s: AgentState, tid: str) -> tuple[str, bool, dict]:
        user = s.get("app_user") or ""
        if name == "remember":
            fact = (args.get("fact") or "").strip()[:300]
            if not fact:
                return "Nothing to remember.", True, {}
            if re.search(r"password|passwd|token|api[_ ]?key|secret", fact, re.I):
                return "Not saved: memory never holds credentials.", True, {}
            if not self.store.one("SELECT 1 AS x FROM memory WHERE app_user = ? AND LOWER(fact) = LOWER(?)", (user, fact)):
                self.store.run("INSERT INTO memory (app_user, fact, created) VALUES (?, ?, ?)", (user, fact, time.time()))
            self.emit(tid, "memory", {"fact": fact})
            return "Saved to memory.", False, {}
        if name == "handoff":
            to = args.get("to")
            if to not in C.SPECIALISTS:
                return f"No specialist {to}.", True, {}
            self.emit(tid, "route", {"specialist": to, "title": C.SPECIALISTS[to].title, "reason": args.get("reason"), "handoff": True})
            self.store.run("UPDATE threads SET specialist = ? WHERE id = ?", (to, tid))
            return f"Handed off to {C.SPECIALISTS[to].title}. Continue as that specialist.", False, {"specialist": to}
        if name == "schedule_job":
            return self.jobs_add(user, args, s), False, {}
        if name == "jobs_list":
            rows = self.jobs_list(user)
            return json.dumps(rows, default=str) if rows else "No scheduled jobs.", False, {}
        if name in ("end_call", "take_message", "phone_call"):
            if not self.phone:
                return "Phone calls are not set up on this AI Hub (AI Agent › Calls › Settings).", True, {}
            return self.phone.hub_tool(name, args, s, tid)
        return f"Unknown hub tool {name}", True, {}

    # ── threads ──
    def _cfg(self, tid: str) -> dict:
        return {"configurable": {"thread_id": tid}, "recursion_limit": 4 * C.MAX_TURNS + 10}

    def _own(self, tid: str, user: str | None) -> dict:
        t = self.store.one("SELECT * FROM threads WHERE id = ?", (tid,))
        if not t:
            raise KeyError(tid)
        if user and t.get("app_user") and t["app_user"] != user:
            raise PermissionError("This conversation belongs to another user.")
        return t

    def start(self, text: str, app_user: str | None = None, specialist: str | None = None, pod: str = "PROD",
              caps: list | None = None, model: dict | None = None, job_id: str | None = None, thread_id: str | None = None,
              attachments: list | None = None, voice: str | None = None, call: dict | None = None) -> dict:
        # the page may choose the id (ag_ + 16 hex) so it can follow the live events of the very first turn
        tid = thread_id if thread_id and re.fullmatch(r"ag_[0-9a-f]{16}", thread_id) else "ag_" + uuid.uuid4().hex[:16]
        if self.store.one("SELECT 1 AS x FROM threads WHERE id = ?", (tid,)):
            raise ValueError("A conversation with this id exists already.")
        now = time.time()
        title = re.sub(r"\s+", " ", text or "").strip()[:90] or "New conversation"
        self.store.run("INSERT INTO threads (id, app_user, title, specialist, status, pod, created, updated, job_id) VALUES (?,?,?,?,?,?,?,?,?)",
                       (tid, app_user, title, specialist, "running", pod, now, now, job_id))
        state = {"messages": [human(text, attachments)], "app_user": app_user or "", "pod": (pod or "PROD").upper(),
                 "caps": caps, "dry_ok": [], "results": [], "model": model or {}, "voice": voice or "", "call": call or {}}
        if specialist in C.SPECIALISTS:
            state.update(specialist=specialist, pinned=True)
        else:
            state.update(pinned=False)
        self.emit(tid, "user", {"text": text, "files": [str(a.get("name")) for a in attachments or [] if isinstance(a, dict)]})
        return self._run(tid, state)

    def send(self, tid: str, text: str, app_user: str | None = None, specialist: str | None = None,
             caps: list | None = None, pod: str | None = None, model: dict | None = None, attachments: list | None = None,
             voice: str | None = None, call: dict | None = None) -> dict:
        self._own(tid, app_user)
        upd: dict[str, Any] = {"messages": [human(text, attachments)]}
        if voice is not None:
            upd["voice"] = voice
        if call is not None:
            upd["call"] = call
        if caps is not None:
            upd["caps"] = caps
        if pod:
            upd["pod"] = pod.upper()
        if model is not None:
            upd["model"] = model
        if specialist in C.SPECIALISTS:
            upd.update(specialist=specialist, pinned=True)
        elif specialist == "auto":
            upd["pinned"] = False
        self.emit(tid, "user", {"text": text, "files": [str(a.get("name")) for a in attachments or [] if isinstance(a, dict)]})
        return self._run(tid, upd)

    def resume(self, tid: str, value: Any, app_user: str | None = None) -> dict:
        self._own(tid, app_user)
        snap = self.graph.get_state(self._cfg(tid))
        if not any(i for t in (snap.tasks or []) for i in (t.interrupts or [])):
            raise ValueError("This conversation is not waiting for anything.")
        return self._run(tid, Command(resume=value))

    def cancel(self, tid: str, app_user: str | None = None) -> dict:
        self._own(tid, app_user)
        if tid in self._busy:
            self._cancel.add(tid)
        else:
            self.store.run("UPDATE threads SET status = 'cancelled', updated = ? WHERE id = ?", (time.time(), tid))
            self.emit(tid, "cancelled", {})
        return {"ok": True}

    def _run(self, tid: str, payload) -> dict:
        with self._lock:
            if tid in self._busy:
                raise ValueError("This conversation is still working - wait for it or cancel it.")
            self._busy.add(tid)
        self._usage[tid] = {"tokens_in": 0, "tokens_out": 0, "cost": 0.0, "provider": None, "model": None}
        self.store.run("UPDATE threads SET status = 'running', updated = ?, error = NULL WHERE id = ?", (time.time(), tid))
        status, error = "done", None
        try:
            self.graph.invoke(payload, self._cfg(tid))
        except Cancelled:
            status = "cancelled"
            self.emit(tid, "cancelled", {})
        except Exception as e:  # noqa: BLE001 - gateway / provider errors end the turn, the thread stays usable
            status, error = "error", f"{type(e).__name__}: {e}"
            self.emit(tid, "error", {"text": error})
        finally:
            self._busy.discard(tid)
            self._cancel.discard(tid)
        snap = self.snapshot(tid)
        if status == "done" and snap["waiting"]:
            status = "waiting"
            self.emit(tid, "wait", snap["waiting"])
        elif status == "done":
            self.emit(tid, "done", {})
        self.store.run("UPDATE threads SET status = ?, error = ?, updated = ? WHERE id = ?", (status, error, time.time(), tid))
        snap["status"], snap["error"] = status, error
        u = self._usage.pop(tid, {})
        return {**snap, **u, "thread_id": tid}

    def snapshot(self, tid: str, app_user: str | None = None) -> dict:
        t = self._own(tid, app_user)
        st = self.graph.get_state(self._cfg(tid))
        ints = [i.value for x in (st.tasks or []) for i in (x.interrupts or [])]
        v = st.values or {}
        return {"thread_id": tid, "title": t["title"], "status": t["status"], "specialist": v.get("specialist") or t.get("specialist"),
                "pinned": bool(v.get("pinned")), "pod": v.get("pod") or t.get("pod"), "waiting": ints[0] if ints else None,
                "results": v.get("results") or [], "cost": t["cost"], "tokens_in": t["tokens_in"], "tokens_out": t["tokens_out"],
                "turns": t["turns"], "error": t.get("error"), "busy": tid in self._busy, "created": t["created"], "updated": t["updated"]}

    def list(self, app_user: str | None = None, limit: int = 50) -> list[dict]:
        if app_user:
            return self.store.all("SELECT id, title, specialist, status, pod, created, updated, cost, job_id FROM threads WHERE app_user = ? "
                                  "ORDER BY updated DESC LIMIT ?", (app_user, limit))
        return self.store.all("SELECT id, title, specialist, status, pod, created, updated, cost, job_id FROM threads ORDER BY updated DESC LIMIT ?", (limit,))

    def events(self, tid: str, after: int = 0, app_user: str | None = None) -> dict:
        t = self._own(tid, app_user)
        ev = self.store.all("SELECT seq, ts, kind, data FROM events WHERE thread_id = ? AND seq > ? ORDER BY seq", (tid, after))
        for e in ev:
            e["data"] = json.loads(e["data"])
        return {"events": ev, "status": t["status"], "busy": tid in self._busy}

    def delete(self, tid: str, app_user: str | None = None) -> dict:
        self._own(tid, app_user)
        self.store.run("DELETE FROM events WHERE thread_id = ?", (tid,))
        self.store.run("DELETE FROM threads WHERE id = ?", (tid,))
        self.store.run("DELETE FROM feedback WHERE thread_id = ?", (tid,))
        try:
            self.graph.checkpointer.delete_thread(tid)
        except Exception:  # noqa: BLE001 - older checkpointer without delete_thread: the state just stays orphaned
            pass
        return {"ok": True}

    def feedback(self, tid: str, seq: int, rating: int, note: str | None, app_user: str | None = None) -> dict:
        self._own(tid, app_user)
        self.store.run("INSERT OR REPLACE INTO feedback VALUES (?, ?, ?, ?, ?, ?)", (tid, seq, app_user, 1 if rating > 0 else -1, (note or "")[:500], time.time()))
        return {"ok": True}

    # ── memory ──
    def memory_list(self, app_user: str) -> list[dict]:
        return self.store.all("SELECT id, fact, created FROM memory WHERE app_user = ? ORDER BY id DESC", (app_user or "",))

    def memory_delete(self, app_user: str, mid: int) -> dict:
        n = self.store.run("DELETE FROM memory WHERE id = ? AND app_user = ?", (mid, app_user or ""))
        return {"ok": n > 0}

    # ── jobs (scheduled prompts; the runner lives in jobs.py) ──
    def jobs_add(self, user: str, args: dict, s: AgentState) -> str:
        every = args.get("every_min")
        daily = (args.get("daily_at") or "").strip()
        if not every and not re.fullmatch(r"\d{1,2}:\d{2}", daily or ""):
            return "Give every_min (≥ 15) or daily_at HH:MM."
        if every:
            every = max(15, int(every))
        jid = "job_" + uuid.uuid4().hex[:10]
        from .jobs import next_run
        nr = next_run(every, daily or None, time.time())
        spec = args.get("specialist") if args.get("specialist") in C.SPECIALISTS else s.get("specialist")
        self.store.run("INSERT INTO jobs (id, app_user, name, prompt, specialist, pod, every_min, daily_at, enabled, next_run, created) "
                       "VALUES (?,?,?,?,?,?,?,?,1,?,?)", (jid, user, (args.get("name") or "Job")[:80], (args.get("prompt") or "")[:2000],
                                                         spec, s.get("pod") or "PROD", every, daily or None, nr, time.time()))
        when = f"every {every} min" if every else f"daily at {daily}"
        return f"Scheduled '{args.get('name')}' {when}; first run {datetime.fromtimestamp(nr):%d %b %H:%M}. Job id {jid}."

    def jobs_list(self, user: str | None) -> list[dict]:
        q = "SELECT id, name, prompt, specialist, pod, every_min, daily_at, enabled, next_run, last_run, last_thread, last_status FROM jobs"
        return self.store.all(q + (" WHERE app_user = ?" if user else "") + " ORDER BY name", (user,) if user else ())
