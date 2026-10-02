"""Offline tool planner for the demo provider: a deterministic stand-in for a model so the whole AI Agent (routing,
tools, confirm cards, results panel, jobs) works and is tested without any cloud key. Real answers need a real model.

It reads the hub-shaped conversation, finds what has been called since the last user text and picks the next step.
"""
from __future__ import annotations

import json
import re

DEMO_SQL = [
    (r"invoice|payables|\bap\b", "SELECT invoice_num AS invoice, invoice_date, invoice_amount AS amount, invoice_currency_code AS currency "
     "FROM ap_invoices_all WHERE invoice_date >= TRUNC(SYSDATE) - 30 ORDER BY invoice_date DESC"),
    (r"receivable|\bar\b|customer.*(balance|due)|aging", "SELECT trx_number, trx_date, invoice_currency_code AS currency "
     "FROM ra_customer_trx_all WHERE trx_date >= TRUNC(SYSDATE) - 30"),
    (r"supplier", "SELECT segment1 AS supplier_number, vendor_name FROM poz_suppliers_v ORDER BY vendor_name"),
    (r"journal|\bgl\b|ledger", "SELECT je_source, je_category, COUNT(*) AS journals FROM gl_je_headers "
     "WHERE default_effective_date >= TRUNC(SYSDATE) - 30 GROUP BY je_source, je_category"),
    (r"on.?hand|inventory|stock", "SELECT inventory_item_id, subinventory_code, SUM(transaction_quantity) AS qty "
     "FROM inv_onhand_quantities_detail GROUP BY inventory_item_id, subinventory_code"),
]
# specialist → [(words, tool, input builder)] read tools tried in order
GENERIC = {
    "wms_operator": [(r"trip", "trips_find", lambda q: {"status": "not printed" if re.search(r"not printed|unprinted", q, re.I) else ""}),
                     (r"print|printer", "print_jobs", lambda q: {}), (r"mra|fiscal", "mra_status", lambda q: {}),
                     (r"", "trips_find", lambda q: {})],
    "order_desk": [(r"", "om_orders_find", lambda q: {"words": _words(q)})],
    "data_loader": [(r"", "fbdi_templates_find", lambda q: {"words": _words(q)})],
    "reporter": [(r"schedule|every|daily|morning", "jobs_list", lambda q: {}), (r"", "model_reports", lambda q: {})],
}


def _words(q: str) -> str:
    w = [x for x in re.findall(r"[A-Za-z0-9]+", q.lower()) if len(x) > 3 and x not in {"show", "find", "list", "what", "which", "with", "from", "that", "this", "please"}]
    return " ".join(w[:4])


def _text(content) -> str:
    if isinstance(content, str):
        return content
    return "\n".join(b.get("text", "") if b.get("type") == "text" else str(b.get("content", "")) for b in content if isinstance(b, dict))


def _trail(messages: list[dict]) -> tuple[str, list[tuple[str, dict, str, bool]]]:
    """→ (last user text, [(tool, input, result text, is_error)] since then)."""
    question, calls, names = "", [], {}
    for m in messages:
        c = m.get("content")
        if m.get("role") == "user":
            if isinstance(c, str) or not any(isinstance(b, dict) and b.get("type") == "tool_result" for b in c):
                question, calls, names = _text(c), [], {}
                continue
            for b in c:
                if b.get("type") == "tool_result":
                    nm, inp = names.get(b.get("tool_use_id"), ("?", {}))
                    calls.append((nm, inp, _text(b.get("content") if isinstance(b.get("content"), list) else [{"type": "text", "text": str(b.get("content", ""))}]),
                                  bool(b.get("is_error"))))
        elif isinstance(c, list):
            for b in c:
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    names[b["id"]] = (b["name"], b.get("input") or {})
    return question, calls


def _call(name: str, inp: dict, n: int) -> dict:
    return {"id": f"demo_{name}_{n}", "name": name, "input": inp}


def plan(system: str, messages: list[dict], tools: list[dict]) -> tuple[str, list[dict]]:
    names = {t["name"] for t in tools}
    q, done = _trail(messages)
    called = [d[0] for d in done]
    n = len(called)
    spec = (re.search(r"SPECIALIST: (\w+)", system or "") or [None, "fusion_analyst"])[1]
    if spec == "fusion_analyst":
        return _fusion(q, done, called, names, n)
    for pat, tool, build in GENERIC.get(spec, []):
        if tool in names and tool not in called and re.search(pat, q, re.I):
            if called:
                break
            return f"Let me look that up ({tool.replace('_', ' ')}).", [_call(tool, build(q), n)]
    if done:
        last = done[-1]
        return f"Demo answer from {last[0].replace('_', ' ')}: " + (last[2][:600] or "(nothing found)"), []
    return "Demo mode: connect a model in AI Hub › Providers for real answers. I understood: " + q[:300], []


def _fusion(q: str, done, called, names, n) -> tuple[str, list[dict]]:
    if "knowledge_lookup" in names and "knowledge_lookup" not in called:
        return "I'll check the team's Fusion knowledge first.", [_call("knowledge_lookup", {"question": q}, n)]
    tries = [d for d in done if d[0] == "fusion_sql_dry_run"]
    if "fusion_sql_dry_run" in names and (not tries or (tries[-1][3] and len(tries) < 2)):
        sql = None
        kb = next((d for d in done if d[0] == "knowledge_lookup"), None)
        if kb:
            m = re.search(r"```sql\s*(.*?)```", kb[2], re.S)
            sql = m.group(1).strip() if m else None
        if not sql:
            sql = next((s for pat, s in DEMO_SQL if re.search(pat, q, re.I)), "SELECT SYSDATE AS server_time, USER AS fusion_user FROM dual")
        if tries:
            sql = "SELECT SYSDATE AS server_time FROM dual"
        return "Checking the query on Fusion (dry run).", [_call("fusion_sql_dry_run", {"sql": sql, "purpose": q[:120]}, n)]
    if tries and tries[-1][3]:
        return "The dry run failed twice: " + tries[-1][2][:400], []
    if tries and "fusion_sql_run" in names and "fusion_sql_run" not in called:
        return "The query works. Please confirm to run it.", [_call("fusion_sql_run", {"sql": tries[-1][1]["sql"], "title": (q or "Fusion data")[:60],
                                                                                       "why": "Answers: " + q[:100]}, n)]
    run = next((d for d in done if d[0] == "fusion_sql_run"), None)
    if run and not run[3]:
        rid = (re.search(r'"result_id":\s*"([^"]+)"', run[2]) or [None, None])[1]
        if rid and "show_chart" in names and "show_chart" not in called:
            try:
                info = json.loads(run[2])
                cols = info.get("columns") or []
                num = [c["name"] for c in cols if c.get("type") == "number"]
                cat = [c["name"] for c in cols if c.get("type") != "number"]
                if num and cat:
                    return "Here is a chart of it.", [_call("show_chart", {"result_id": rid, "type": "bar", "x": cat[0], "y": num[:1], "title": "By " + cat[0]}, n)]
            except ValueError:
                pass
        return "Done - the result is in the panel. " + (run[2][:300] if not rid else ""), []
    if run:
        return "I did not run it: " + run[2][:300], []
    return "Done.", []
