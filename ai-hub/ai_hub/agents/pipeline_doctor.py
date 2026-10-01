"""Pipeline Doctor - a LangGraph agent that diagnoses a failed pipeline run and proposes a fix a person approves.

    triage ─► diagnose ─┬─► verify ⏸ ─┬─► propose ─► approval ⏸ ─┬─► apply ⏸ ─► report ─► END
                        │             └─► diagnose (2nd try)    └─► report
                        └─► propose

triage    rules over the error + log (no model): category + signals
diagnose  the gateway (task pipeline_doctor) through GatewayChatModel; answer = JSON: cause, evidence, fix_kind,
          patch (fields of WMS_PIPE_TASKS to change), test_sql
verify  ⏸ interrupt: the WMS app runs test_sql on the task's source (Fusion runner / APEX, read-only) and resumes with
          the result; a failure goes back to diagnose once with the new error
approval⏸ interrupt: a person approves / rejects / edits the patch (never applied without this)
apply   ⏸ interrupt: the WMS app writes the patch to WMS_PIPE_TASKS (and queues a re-run if asked) and resumes
report    final summary

State lives in a SQLite checkpointer (<home>/agents.db): a thread waits at an interrupt for days and survives a
restart of the hub; every step is in `timeline`.
"""
from __future__ import annotations

import json
import operator
import re
import sqlite3
import threading
import time
import uuid
from typing import Annotated, Any, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from ..lc import GatewayChatModel

PATCHABLE = {"source_sql", "column_map_json", "batch_size", "key_columns", "watermark_column", "load_mode", "timeout_seconds", "target_object"}

SYSTEM = """PIPELINE_DOCTOR
You are the Pipeline Doctor of Gray's WMS. A data pipeline task failed. Tasks read rows with SQL from a source
(FUSION = Oracle Fusion through a BI Publisher runner, read-only Oracle SQL; APEX = the company's Oracle APEX database;
CONNECTION = another database) and write them to a target (Oracle / APEX gateway / DuckDB / REST) in pages, with
load mode APPEND / TRUNCATE_INSERT / MERGE (key columns) / INCREMENTAL (watermark column).

Find the root cause from the error, the log and the SQL. Be concrete; quote the evidence. Propose the smallest fix.
Only these task fields may be changed: source_sql, column_map_json (JSON {"SRC": "TGT:TYPE" | "SKIP"}), batch_size,
key_columns (comma list), watermark_column, load_mode, timeout_seconds, target_object.
If the fix is outside the task (a password, a missing grant, a server problem), say so with fix_kind CONNECTION or
NONE and an empty patch. If you change source_sql, give test_sql = a read-only query that proves the new SQL runs
(usually the new SQL itself).

Answer with one ```json block only:
{"category": "...", "cause": "...", "confidence": 0.0-1.0, "evidence": "...", "fix_kind": "SQL|COLUMN_MAP|SETTINGS|CONNECTION|NONE",
 "fix_summary": "...", "patch": {"field": "new value"}, "test_sql": "..."}"""

TRIAGE = [
    ("INVALID_COLUMN", r"ORA-00904|invalid identifier"),
    ("MISSING_OBJECT", r"ORA-00942|table or view does not exist"),
    ("TYPE_MISMATCH", r"ORA-01722|invalid number|could not convert|Conversion Error"),
    ("DATE_FORMAT", r"ORA-01843|ORA-01861|ORA-01830|not a valid month|literal does not match"),
    ("DUPLICATE_KEY", r"ORA-00001|unique constraint|Duplicate key|PRIMARY KEY"),
    ("VALUE_TOO_LARGE", r"ORA-12899|ORA-01438|value too large"),
    ("TIMEOUT", r"timed? ?out|timeout|ReadTimeout"),
    ("AUTH", r"\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid username|password"),
    ("NETWORK", r"connection refused|getaddrinfo|Name or service not known|unreachable|ECONN"),
    ("BIP_RUNNER", r"QueryRunner|xdo|runReport|BI Publisher|InvalidParametersException"),
    ("MERGE_KEYS", r"key columns"),
]


def _add(a: list, b: list) -> list:
    return (a or []) + (b or [])


class DoctorState(TypedDict, total=False):
    context: dict
    triage: dict
    diagnosis: dict
    attempts: int
    verify: dict
    decision: dict
    applied: dict
    model: dict
    status: str
    summary: str
    timeline: Annotated[list, _add]


def _step(node: str, text: str, **kw) -> list:
    return [{"node": node, "at": time.strftime("%Y-%m-%d %H:%M:%S"), "text": text, **kw}]


def parse_json_block(text: str) -> dict:
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text or "", re.S) or re.search(r"(\{.*\})", text or "", re.S)
    if not m:
        raise ValueError("no JSON in the answer")
    return json.loads(m.group(1))


def build_graph(gateway, app_user_of=lambda s: None):
    def triage(s: DoctorState):
        ctx = s.get("context") or {}
        hay = "\n".join([str(ctx.get("error") or "")] + [str(l) for l in (ctx.get("log") or [])][-40:])
        hits = [(cat, m.group(0)) for cat, pat in TRIAGE for m in [re.search(pat, hay, re.I)] if m]
        cat = hits[0][0] if hits else "UNKNOWN"
        t = {"category": cat, "signals": [f"{c}: {w}" for c, w in hits[:5]]}
        return {"triage": t, "attempts": 0, "status": "diagnosing",
                "timeline": _step("triage", f"Looks like {cat.replace('_', ' ').lower()}" + (f" ({hits[0][1]})" if hits else " — no known pattern"))}

    def diagnose(s: DoctorState):
        ctx, task = s.get("context") or {}, (s.get("context") or {}).get("task") or {}
        lines = [f"PIPELINE: {ctx.get('pipeline')}  RUN: #{ctx.get('run_id')}  STATUS: {ctx.get('run_status')}",
                 f"TASK: {task.get('name')}  source={task.get('source_type')} ({task.get('source_label') or ''})  target={task.get('target_type')}:{task.get('target_object')}",
                 f"load_mode={task.get('load_mode')} keys={task.get('key_columns') or '-'} watermark={task.get('watermark_column') or '-'} "
                 f"(value {task.get('watermark_value') or '-'}) batch={task.get('batch_size') or '-'} column_map={task.get('column_map_json') or '-'}",
                 "TASK_SQL:\n```sql\n" + str(task.get("source_sql") or "") + "\n```",
                 "ERROR: " + str(ctx.get("error") or "(none)"),
                 "LOG (last lines):\n" + "\n".join(str(l) for l in (ctx.get("log") or [])[-40:]),
                 "TRIAGE: " + json.dumps(s.get("triage") or {})]
        v = s.get("verify") or {}
        if v and not v.get("ok"):
            lines.append("YOUR PREVIOUS FIX WAS TESTED AND FAILED: " + str(v.get("error"))[:600] + "\nPrevious test_sql:\n" + str(v.get("sql"))[:2000])
        llm = GatewayChatModel(gateway=gateway, task="pipeline_doctor", max_tokens=3000, app_user=app_user_of(s))
        ans = llm.invoke([SystemMessage(SYSTEM), HumanMessage("\n".join(lines))])
        meta = ans.response_metadata or {}
        try:
            d = parse_json_block(str(ans.content))
        except (ValueError, json.JSONDecodeError):
            d = {"category": (s.get("triage") or {}).get("category", "UNKNOWN"), "cause": str(ans.content)[:1500], "confidence": 0.3,
                 "fix_kind": "NONE", "patch": {}, "test_sql": "", "fix_summary": "The model did not return JSON - read its text."}
        d["patch"] = {k: v for k, v in (d.get("patch") or {}).items() if k in PATCHABLE}
        n = (s.get("attempts") or 0) + 1
        model = {"provider": meta.get("provider"), "model": meta.get("model"), "cost": round((s.get("model") or {}).get("cost", 0) + (meta.get("cost") or 0), 6),
                 "fallback": meta.get("fallback")}
        return {"diagnosis": d, "attempts": n, "model": model, "verify": {},
                "timeline": _step("diagnose", f"{d.get('cause', '')[:300]}", model=f"{meta.get('provider')}/{meta.get('model')}", ms=meta.get("ms"), cost=meta.get("cost"))}

    def after_diagnose(s: DoctorState):
        d, task = s.get("diagnosis") or {}, (s.get("context") or {}).get("task") or {}
        if d.get("test_sql") and str(task.get("source_type", "")).upper() in ("FUSION", "APEX") and (s.get("attempts") or 0) <= 2:
            return "verify"
        return "propose"

    def verify(s: DoctorState):
        d, task = s.get("diagnosis") or {}, (s.get("context") or {}).get("task") or {}
        res = interrupt({"kind": "verify", "sql": d.get("test_sql"), "source_type": task.get("source_type"),
                         "pod": (s.get("context") or {}).get("pod"), "question": "Run this read-only SQL on the task's source and send back the result."})
        res = dict(res or {}, sql=d.get("test_sql"))
        ok = bool(res.get("ok"))
        return {"verify": res, "timeline": _step("verify", ("Test SQL ran: " + str(res.get("rows", "?")) + " rows" + (f" in {res.get('ms')} ms" if res.get("ms") else ""))
                                                 if ok else "Test SQL failed: " + str(res.get("error"))[:300], ok=ok)}

    def after_verify(s: DoctorState):
        if not (s.get("verify") or {}).get("ok") and (s.get("attempts") or 0) < 2:
            return "diagnose"
        return "propose"

    def propose(s: DoctorState):
        d, v = s.get("diagnosis") or {}, s.get("verify") or {}
        tested = " (tested ✓)" if v.get("ok") else " (test failed)" if v else ""
        txt = (d.get("fix_summary") or d.get("cause") or "")[:300] + (f" — changes {', '.join(d.get('patch', {}).keys())}" if d.get("patch") else " — nothing to change in the task") + tested
        return {"status": "waiting_approval", "timeline": _step("propose", txt)}

    def approval(s: DoctorState):
        d = s.get("diagnosis") or {}
        dec = interrupt({"kind": "approval", "diagnosis": d, "patch": d.get("patch") or {}, "verify": s.get("verify") or {},
                         "question": "Apply this fix to the task?"})
        dec = dict(dec or {})
        if dec.get("patch") is not None:
            dec["patch"] = {k: v for k, v in (dec.get("patch") or {}).items() if k in PATCHABLE}
        word = "approved" if dec.get("approved") else "rejected"
        return {"decision": dec, "timeline": _step("approval", f"{word} by {dec.get('by') or 'someone'}" + (f": {dec.get('note')}" if dec.get("note") else ""))}

    def after_approval(s: DoctorState):
        dec, d = s.get("decision") or {}, s.get("diagnosis") or {}
        patch = dec.get("patch") if dec.get("patch") is not None else d.get("patch")
        return "apply" if dec.get("approved") and patch else "report"

    def apply(s: DoctorState):
        dec, d = s.get("decision") or {}, s.get("diagnosis") or {}
        patch = dec.get("patch") if dec.get("patch") is not None else d.get("patch")
        task = (s.get("context") or {}).get("task") or {}
        res = interrupt({"kind": "apply", "task_id": task.get("id"), "pipeline_id": (s.get("context") or {}).get("pipeline_id"),
                         "patch": patch, "rerun": bool(dec.get("rerun")), "question": "Write the patch to WMS_PIPE_TASKS and confirm."})
        res = dict(res or {})
        return {"applied": dict(res, patch=patch),
                "timeline": _step("apply", ("Applied to task #" + str(task.get("id")) + (f", re-run #{res.get('rerun_run_id')} queued" if res.get("rerun_run_id") else ""))
                                  if res.get("ok") else "Not applied: " + str(res.get("error"))[:300], ok=bool(res.get("ok")))}

    def report(s: DoctorState):
        d, dec, ap = s.get("diagnosis") or {}, s.get("decision") or {}, s.get("applied") or {}
        if ap.get("ok"):
            status, head = "fixed", "Fix applied"
        elif dec and not dec.get("approved"):
            status, head = "rejected", "Fix rejected"
        elif dec and dec.get("approved") and not (d.get("patch") or dec.get("patch")):
            status, head = "advice", "Advice only"
        else:
            status, head = "not_applied" if ap else "advice", "Not applied" if ap else "Advice only"
        summary = f"**{head}** — {d.get('category', '')}: {d.get('cause', '')}\n\nFix: {d.get('fix_summary', '')}"
        return {"status": status, "summary": summary, "timeline": _step("report", head)}

    g = StateGraph(DoctorState)
    for name, fn in [("triage", triage), ("diagnose", diagnose), ("verify", verify), ("propose", propose),
                     ("approval", approval), ("apply", apply), ("report", report)]:
        g.add_node(name, fn)
    g.add_edge(START, "triage")
    g.add_edge("triage", "diagnose")
    g.add_conditional_edges("diagnose", after_diagnose, {"verify": "verify", "propose": "propose"})
    g.add_conditional_edges("verify", after_verify, {"diagnose": "diagnose", "propose": "propose"})
    g.add_edge("propose", "approval")
    g.add_conditional_edges("approval", after_approval, {"apply": "apply", "report": "report"})
    g.add_edge("apply", "report")
    g.add_edge("report", END)
    return g


class Doctor:
    """Runs Pipeline Doctor threads with a SQLite checkpointer; one lock - the graph is cheap, models are the slow part."""

    def __init__(self, gateway, db_path: str):
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("""CREATE TABLE IF NOT EXISTS doctor_threads (thread_id TEXT PRIMARY KEY, run_id TEXT, pipeline TEXT, task TEXT,
            app_user TEXT, created REAL, updated REAL, status TEXT, category TEXT, cost REAL)""")
        self.conn.commit()
        self._users: dict[str, str] = {}
        self.graph = build_graph(gateway, lambda s: (s.get("context") or {}).get("app_user")).compile(checkpointer=SqliteSaver(self.conn))

    def _cfg(self, tid: str) -> dict:
        return {"configurable": {"thread_id": tid}}

    def start(self, context: dict, app_user: str | None = None) -> dict:
        tid = "doc-" + time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
        context = dict(context or {}, app_user=app_user)
        now = time.time()
        with self._lock:
            self.conn.execute("INSERT INTO doctor_threads VALUES (?,?,?,?,?,?,?,?,?,?)",
                              (tid, str(context.get("run_id") or ""), context.get("pipeline"), (context.get("task") or {}).get("name"),
                               app_user, now, now, "running", None, 0))
            self.conn.commit()
            self.graph.invoke({"context": context, "timeline": _step("start", f"Run #{context.get('run_id')} of {context.get('pipeline')} handed to the doctor")},
                              self._cfg(tid))
        return self.snapshot(tid)

    def resume(self, tid: str, value: Any) -> dict:
        with self._lock:
            if not self.snapshot(tid).get("waiting"):
                raise ValueError("This thread is not waiting for an answer.")
            self.graph.invoke(Command(resume=value), self._cfg(tid))
        return self.snapshot(tid)

    def snapshot(self, tid: str) -> dict:
        st = self.graph.get_state(self._cfg(tid))
        if not st or not st.values:
            raise KeyError(tid)
        ints = [i.value for t in (st.tasks or []) for i in (t.interrupts or [])]
        v = dict(st.values)
        waiting = ints[0] if ints else None
        status = ("waiting_" + waiting.get("kind", "input")) if waiting else (v.get("status") or "done")
        with self._lock:
            self.conn.execute("UPDATE doctor_threads SET updated = ?, status = ?, category = ?, cost = ? WHERE thread_id = ?",
                              (time.time(), status, (v.get("diagnosis") or v.get("triage") or {}).get("category"), (v.get("model") or {}).get("cost", 0), tid))
            self.conn.commit()
        return {"thread_id": tid, "status": status, "waiting": waiting, "next": list(st.next or []), "state": v}

    def list(self, limit: int = 50) -> list[dict]:
        cur = self.conn.execute("SELECT thread_id, run_id, pipeline, task, app_user, created, updated, status, category, cost FROM doctor_threads ORDER BY created DESC LIMIT ?", (limit,))
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    def graph_shape(self) -> dict:
        g = self.graph.get_graph()
        return {"nodes": [n for n in g.nodes], "edges": [{"from": e.source, "to": e.target, "conditional": bool(e.conditional)} for e in g.edges],
                "interrupts": ["verify", "approval", "apply"], "mermaid": g.draw_mermaid()}
