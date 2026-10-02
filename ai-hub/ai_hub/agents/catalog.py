"""AI Agent catalog: the specialists and every tool they may call.

A tool runs in one of three places:
  hub   here, in Python (memory, hand-off, jobs) - never touches company data
  host  the WMS app's C# host (Fusion dictionary, the BI Publisher runner, the result cache, MRA, the AI inbox): the
        host checks the AI kill switch, the policy and - for "act" tools - the approval fingerprint it issued itself
  page  the AI Agent page (APEX reads, Fusion Model, deep links, charts) through the app's existing bridges

risk:
  read  runs at once
  auto  writes something harmless (a proposal, a note) - runs at once, logged
  ask   the user answers (ask_user)
  act   changes or spends something real: the page shows a confirm card first and the host refuses it without the
        card's approval (policy AUTO / ASK / DENY per `policy` key, AI Digital Employee › Policies)

The page tells the hub which tool names it can run (`caps`); a model only ever sees tools that exist in that app.
"""
from __future__ import annotations

from dataclasses import dataclass, field


def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or []}


S = {"type": "string"}
I = {"type": "integer"}
SA = {"type": "array", "items": {"type": "string"}}


def s(desc: str) -> dict:
    return {"type": "string", "description": desc}


def i(desc: str) -> dict:
    return {"type": "integer", "description": desc}


@dataclass
class Tool:
    name: str
    description: str
    schema: dict
    runs: str = "page"            # hub | host | page
    risk: str = "read"            # read | auto | ask | act
    policy: str | None = None     # policy key for act tools
    specialists: list[str] = field(default_factory=list)   # empty = everyone

    def spec(self) -> dict:
        return {"name": self.name, "description": self.description, "input_schema": self.schema}

    def public(self) -> dict:
        return {"name": self.name, "description": self.description, "runs": self.runs, "risk": self.risk,
                "policy": self.policy, "specialists": self.specialists, "input_schema": self.schema}


FA, WO, OD, DL, RP = "fusion_analyst", "wms_operator", "order_desk", "data_loader", "reporter"

TOOLS: list[Tool] = [
    # ── everyone ──
    Tool("ask_user", "Ask the user one short clarifying question when the request is ambiguous (which pod, which period, which "
         "business unit …). Offer 2-5 likely answers as options. Do not ask what you can find out with a read-only tool.",
         _obj({"question": s("The question"), "options": {"type": "array", "items": S, "description": "2-5 likely answers"}}, ["question"]),
         runs="page", risk="ask"),
    Tool("remember", "Save a lasting preference or fact about this user's work (e.g. 'works for BU Grays Mauritius', 'prefers "
         "amounts in MUR', 'month end = 25th'). Not for one-off details or anything secret.",
         _obj({"fact": s("One short sentence")}, ["fact"]), runs="hub", risk="auto"),
    Tool("handoff", "Hand the conversation to another specialist when the request is clearly theirs: fusion_analyst (Fusion data "
         "and SQL), wms_operator (trips, printing, MRA), order_desk (sales orders), data_loader (FBDI / REST loads), reporter "
         "(reports, dashboards, scheduled digests).",
         _obj({"to": {"type": "string", "enum": [FA, WO, OD, DL, RP]}, "reason": s("Why")}, ["to", "reason"]), runs="hub"),
    Tool("open_page", "Open a page of the WMS app for the user (and optionally pass it what to show). Pages: fusionsql, wms, om, "
         "dataload, fusionmodel, powerbi, aihub, aianalysis.",
         _obj({"page": s("Page key"), "params": {"type": "object", "description": "Optional, e.g. {\"sql\": \"…\"} for fusionsql"}}, ["page"])),

    # ── Fusion Analyst: dictionary (host, read-only, cached) ──
    Tool("fusion_search_objects", "Search the Fusion data dictionary (ALL_OBJECTS) by name words in order or a LIKE pattern "
         "(e.g. 'ar payment schedule'). Returns owner, name, type, status.",
         _obj({"pattern": s("Name words or LIKE pattern"), "object_types": {"type": "array", "items": S, "description": "Optional e.g. [\"TABLE\",\"VIEW\"]"},
               "owner": s("Optional owner")}, ["pattern"]), runs="host", specialists=[FA, RP, DL]),
    Tool("fusion_search_columns", "Find tables / views with a column whose name matches, optionally only in tables matching table_pattern.",
         _obj({"column_pattern": s("Column words or LIKE pattern"), "table_pattern": s("Optional table words"), "owner": s("Optional owner")},
              ["column_pattern"]), runs="host", specialists=[FA, RP, DL]),
    Tool("fusion_describe", "Describe a table / view (columns, types, comments, indexes), a synonym, or a package's procedures.",
         _obj({"name": s("Object name"), "owner": s("Optional owner")}, ["name"]), runs="host", specialists=[FA, RP, DL]),
    Tool("fusion_source", "Read PL/SQL source or a view's SQL (up to 400 lines per call; page with from_line / to_line).",
         _obj({"name": s("Object name"), "type": s("PACKAGE, PACKAGE BODY, VIEW …"), "owner": s("Optional owner"),
               "from_line": i("First line"), "to_line": i("Last line")}, ["name"]), runs="host", specialists=[FA]),
    Tool("fusion_dependencies", "What an object references and what references it; foreign keys for tables.",
         _obj({"name": s("Object name"), "owner": s("Optional owner")}, ["name"]), runs="host", specialists=[FA]),

    # ── Fusion Analyst: SQL ──
    Tool("fusion_sql_dry_run", "ALWAYS before fusion_sql_run: checks a read-only SELECT / WITH on Fusion without fetching it - "
         "returns the row count (COUNT(*) over the query), the columns and 5 sample rows, or the ORA- error to fix. Fix and "
         "dry-run again (at most 3 times) before giving up.",
         _obj({"sql": s("SELECT or WITH, no trailing semicolon, no bind variables"), "purpose": s("What it answers, one line")}, ["sql"]),
         runs="host", specialists=[FA, RP]),
    Tool("fusion_sql_run", "Run the dry-run-checked query on Fusion through the BI Publisher runner and show the result grid to the "
         "user. The user confirms first (the card shows the SQL, the pod and the row count). Returns a result_id, the columns, "
         "the first rows and column statistics - use result_analyze / show_chart on the result_id instead of running Fusion again.",
         _obj({"sql": s("Exactly the SQL that passed the dry run"), "title": s("Short title for the result"),
               "why": s("One line: what the user gets"), "row_limit": i("Rows to fetch (default 5000, max 50000)")}, ["sql", "title"]),
         runs="host", risk="act", policy="fusion_query", specialists=[FA, RP]),
    Tool("result_analyze", "Aggregate a result you already have (no new Fusion call): group by columns, sum / avg / min / max / count "
         "/ count_distinct of others, optional filter (column = value) and top N.",
         _obj({"result_id": s("From fusion_sql_run"), "group_by": SA, "measures": {"type": "array", "items": _obj(
             {"column": S, "agg": {"type": "string", "enum": ["sum", "avg", "min", "max", "count", "count_distinct"]}}, ["column", "agg"])},
             "filter": {"type": "object", "description": "column → value (equals)"}, "top": i("Keep the N largest by the first measure")},
             ["result_id"]), runs="host", specialists=[FA, RP]),
    Tool("show_chart", "Show a chart of a result in the results panel (bar, column, line, pie, kpi). x = category / date column, "
         "y = numeric columns (from the result or a result_analyze result_id).",
         _obj({"result_id": S, "type": {"type": "string", "enum": ["bar", "column", "line", "pie", "kpi"]}, "x": S, "y": SA, "title": S},
              ["result_id", "type"]), specialists=[FA, RP, WO, OD]),

    # ── Fusion Analyst: company knowledge + saved work (page → APEX) ──
    Tool("knowledge_lookup", "The team's approved Fusion knowledge for a question: what flexfields / ATTRIBUTEn columns hold, codes "
         "used, joins, business rules, terms and VERIFIED example questions with SQL. Call it first for any Fusion data question.",
         _obj({"question": s("The user's question")}, ["question"]), specialists=[FA, RP]),
    Tool("saved_queries_search", "Search the team's saved Fusion SQL queries (name, description, SQL words).",
         _obj({"words": s("Words to look for")}, ["words"]), specialists=[FA, RP]),
    Tool("saved_query_get", "Get one saved query with its SQL and parameters.", _obj({"id": i("Query id")}, ["id"]), specialists=[FA, RP]),
    Tool("save_query", "Save a query to the team's saved queries (Fusion SQL › Saved). The user confirms.",
         _obj({"name": S, "sql": S, "description": S, "category": S}, ["name", "sql"]), risk="act", policy="fusion_save", specialists=[FA, RP]),
    Tool("knowledge_propose", "Propose a non-obvious fact you verified (a column's meaning, a code, a join, a rule) for the "
         "Knowledge tab; a person approves it later.",
         _obj({"kind": {"type": "string", "enum": ["TABLE", "COLUMN", "VALUE", "JOIN", "RULE", "TERM"]}, "subject": s("TABLE or TABLE.COLUMN"),
               "fact": s("The fact, one or two sentences")}, ["kind", "subject", "fact"]), risk="auto", specialists=[FA]),
    Tool("watchdogs_status", "The Fusion SQL watchdogs: name, current value, state (OK / ALERT / LEARNING), last run.",
         _obj({"words": s("Optional filter")}), specialists=[FA, RP, WO]),
    Tool("watchdog_create", "Create a watchdog on a query (a number checked on a schedule; AUTO learns what is normal). The user confirms.",
         _obj({"name": S, "sql": s("Query; its row count or value_column is the number"), "value_column": S,
               "schedule_min": i("15, 30, 60, 240 or 1440"), "rule": {"type": "string", "enum": ["AUTO", "ABOVE", "BELOW", "CHANGE"]},
               "limit": {"type": "number"}, "direction": {"type": "string", "enum": ["up", "down", "both"]}}, ["name", "sql"]),
         risk="act", policy="fusion_watchdog", specialists=[FA, RP]),
    Tool("flows_list", "The process flows (Order to Cash, Procure to Pay …) defined in Fusion SQL › Flows, with their steps.",
         _obj({"words": s("Optional filter")}), specialists=[FA, RP]),
    Tool("setups_status", "Fusion setup checklist status per module (DONE / MISSING per task, last check).",
         _obj({"module": s("Optional module, e.g. GL, AP, INV")}), specialists=[FA, DL]),
    Tool("datasets_list", "Results saved to APEX (FSQ_ tables): name, rows, last refresh, source SQL.",
         _obj({"words": s("Optional filter")}), specialists=[FA, RP]),
    Tool("model_search", "Search the Fusion Model (DuckDB semantic model): measures, tables, columns, glossary terms, verified examples. "
         "Prefer a model measure over new SQL when one fits.",
         _obj({"question": S}, ["question"]), specialists=[FA, RP]),
    Tool("model_evaluate", "Evaluate measures in the Fusion Model: DEFINE / EVALUATE SUMMARIZECOLUMNS(…) text. Fast, no Fusion call.",
         _obj({"query": s("EVALUATE … text")}, ["query"]), specialists=[FA, RP]),

    # ── WMS Operator (page → APEX, host for MRA / inbox) ──
    Tool("trips_find", "Find trips (date, status, trip id / name words). Returns trip, date, driver, status, orders, printed.",
         _obj({"date": s("YYYY-MM-DD, default today"), "status": S, "words": S, "instance": s("PROD / TEST")}), specialists=[WO]),
    Tool("trip_orders", "Orders on one trip with print status, MRA status and customer.",
         _obj({"trip_id": S}, ["trip_id"]), specialists=[WO]),
    Tool("print_jobs", "Print jobs (queued / failed / printed) for a trip or the last hours.",
         _obj({"trip_id": S, "status": S, "hours": i("Look back, default 24")}), specialists=[WO]),
    Tool("printers_status", "Configured printers and their last job result.", _obj({}), specialists=[WO]),
    Tool("mra_status", "MRA interface switch per instance and the last MRA results for some orders.",
         _obj({"instance": S, "orders": SA}), specialists=[WO, OD]),
    Tool("mra_interface", "Send orders to the Mauritius Revenue Authority (fiscal invoices) through the app's MRA processor. The "
         "user confirms the list. Never resend an order MRA already accepted.",
         _obj({"orders": SA, "instance": s("PROD / TEST"), "trip_id": S}, ["orders"]), runs="host", risk="act", policy="mra_interface",
         specialists=[WO, OD]),
    Tool("inbox_list", "Open approval requests in the AI inbox (any PC).", _obj({"status": s("PENDING (default), APPROVED, REJECTED")}),
         runs="host", specialists=[WO, OD, RP]),
    Tool("inbox_request", "Ask a person (an approver) to approve something through the AI inbox (Teams / e-mail alert). Use when "
         "the current user may not do it themselves.",
         _obj({"title": S, "detail": S, "kind": s("e.g. cancel_lines, price_override")}, ["title", "detail"]), runs="host", risk="act",
         policy="inbox_request", specialists=[WO, OD]),

    # ── Order Desk ──
    Tool("om_orders_find", "Orders in the app's Order Management (customer, status, dates, order number words).",
         _obj({"words": S, "status": S, "from": s("YYYY-MM-DD"), "to": s("YYYY-MM-DD")}), specialists=[OD]),
    Tool("om_order_detail", "One order: header, lines, totals, checks verdict, Fusion number / status, timeline.",
         _obj({"id": S}, ["id"]), specialists=[OD]),
    Tool("fusion_order_status", "Live status of a Fusion sales order (salesOrdersForOrderHub): header status, lines, holds.",
         _obj({"order_number": S}, ["order_number"]), specialists=[OD]),
    Tool("om_prepare_order", "Prepare a sales order in the Order Pad for the user to review and save (nothing is sent to Fusion). "
         "The user confirms.",
         _obj({"customer": s("Customer number or name"), "lines": {"type": "array", "items": _obj({"item": S, "qty": {"type": "number"}}, ["item", "qty"])},
               "po": s("Customer PO"), "notes": S}, ["customer", "lines"]), risk="act", policy="om_prepare", specialists=[OD]),

    # ── Data Loader ──
    Tool("fbdi_templates_find", "Oracle FBDI templates matching words: file, interface sheets, required columns, import process.",
         _obj({"words": S}, ["words"]), specialists=[DL]),
    Tool("fbdi_loads", "The app's FBDI loads (Prepare & Load): name, template, rows, last check / generate.",
         _obj({"words": S}), specialists=[DL]),
    Tool("fusion_rest_describe", "Fields of a Fusion REST resource (types, required, child collections, actions).",
         _obj({"resource": s("e.g. invoices, suppliers, salesOrdersForOrderHub")}, ["resource"]), specialists=[DL, OD]),
    Tool("fusion_rest_get", "Read records from a Fusion REST resource (q= filter, fields, limit ≤ 50).",
         _obj({"resource": S, "q": s("REST q filter"), "fields": S, "limit": I}, ["resource"]), specialists=[DL, OD]),

    # ── Reporter ──
    Tool("model_reports", "Saved Fusion Model reports and dashboards.", _obj({"words": S}), specialists=[RP]),
    Tool("make_report", "Turn results into a formatted report in the results panel (title, summary, KPIs, chart, table) the user "
         "can print / save as PDF / copy to e-mail.",
         _obj({"title": S, "summary": s("2-5 sentences"), "result_ids": SA, "kpis": {"type": "array", "items": _obj({"label": S, "value": S})}},
              ["title", "result_ids"]), specialists=[RP, FA]),
    Tool("schedule_job", "Schedule this request to run again by itself (daily at a time, or every N minutes). Read-only steps run "
         "unattended; anything needing a confirm waits in the AI inbox. The user confirms.",
         _obj({"name": S, "prompt": s("What to do each time"), "every_min": i("Interval in minutes (≥ 15)"), "daily_at": s("HH:MM"),
               "specialist": S}, ["name", "prompt"]), runs="hub", risk="act", policy="agent_job", specialists=[RP, FA, WO]),
    Tool("jobs_list", "The scheduled agent jobs of this user with their last run.", _obj({}), runs="hub", specialists=[RP, FA, WO]),
]

BY_NAME = {t.name: t for t in TOOLS}


@dataclass
class Specialist:
    id: str
    title: str
    icon: str
    task: str            # gateway task (route + data class)
    words: list[str]     # routing words
    prompt: str


COMMON = """You are part of Gray's WMS AI Agent - a team of specialists inside a warehouse / Oracle Fusion app used by
a distribution company (Mauritius and the region). Be brief and concrete. Use tools to find facts; never invent table
names, columns, codes, order numbers or results. Anything that changes data or runs a big query goes through a tool
the user confirms - say what you are about to do in one line before calling it. Answer in the user's language.
When a result is shown in the results panel, do not repeat the whole table: summarise what matters (totals, outliers,
what to check next) in a few lines."""

SPECIALISTS: dict[str, Specialist] = {s_.id: s_ for s_ in [
    Specialist(FA, "Fusion Analyst", "fa-database", "fusion_sql",
               ["!fusion", "!sql", "query", "invoice", "gl", "ledger", "journal", "payables", "receivables", "supplier",
                "receipt", "balance", "table", "column", "po", "purchase", "item", "onhand", "on-hand", "inventory", "customer",
                "flexfield", "attribute", "how many", "list", "show me", "total", "aging", "ap", "ar", "cost", "period", "watchdog", "setup"],
               """SPECIALIST: fusion_analyst
You answer questions with Oracle Fusion Cloud data (read-only SQL through BI Publisher).
Method: 1) knowledge_lookup (and model_search when a measure may exist) - use verified examples and approved facts;
2) explore only what you need (fusion_search_objects / fusion_search_columns / fusion_describe); 3) write ONE clear
SELECT (explicit columns with readable aliases, joins on keys, filters the user asked for, ORG / BU / ledger filters
when known, ROWNUM or FETCH FIRST only when the user wants a sample); 4) fusion_sql_dry_run - fix ORA- errors and
retry (max 3); 5) fusion_sql_run (the user confirms); 6) explain the result briefly, use result_analyze / show_chart
for totals and trends, and suggest one useful next step. Oracle SQL only: no semicolon, no bind variables, dates with
DATE 'YYYY-MM-DD' or TO_DATE. Prefer _VL / _TL views for names (LANGUAGE = USERENV('LANG')). Never DML.
If you learnt a non-obvious fact that was verified by data, knowledge_propose it."""),
    Specialist(WO, "WMS Operator", "fa-truck-fast", "default",
               ["!trip", "print", "printer", "printing", "printed", "pick", "picking", "ship", "shipping", "delivery",
                "driver", "route", "label", "!mra", "fiscal", "warehouse", "dispatch"],
               """SPECIALIST: wms_operator
You run the warehouse side: trips, orders on trips, print jobs and printers, MRA fiscal interfacing. Read first
(trips_find, trip_orders, print_jobs, mra_status), then propose the action. MRA: only orders not yet accepted, list
them, the user confirms; after two gateway problems in a row stop and report (orders marked NOT_SENT are safe to
retry). When something must be approved by a person other than the user, use inbox_request."""),
    Specialist(OD, "Order Desk", "fa-cart-shopping", "default",
               ["order", "!sales order", "quote", "backorder", "discount", "price", "pricing", "credit", "return",
                "customer po", "draft", "order pad"],
               """SPECIALIST: order_desk
You help with sales orders: find orders, explain an order's checks / discounts / totals, follow the Fusion status,
and prepare new orders in the Order Pad (om_prepare_order - the user reviews and saves it there; you never submit
to Fusion yourself)."""),
    Specialist(DL, "Data Loader", "fa-file-import", "default",
               ["!fbdi", "load", "loading", "upload", "import", "template", "csv", "excel", "rest", "api",
                "migration", "interface"],
               """SPECIALIST: data_loader
You help load data into Fusion: pick the right FBDI template (fbdi_templates_find), explain required columns and the
import process, check what loads exist (fbdi_loads), and explore REST resources (fusion_rest_describe /
fusion_rest_get). Loading itself happens in the Data Loading page (open_page dataload) where the user maps and checks."""),
    Specialist(RP, "Reporter", "fa-chart-line", "default",
               ["report", "!dashboard", "chart", "kpi", "trend", "summary", "digest", "pdf",
                "measure", "power bi", "schedule", "every day", "!every morning", "weekly"],
               """SPECIALIST: reporter
You turn data into reports: prefer Fusion Model measures (model_search / model_evaluate), else checked Fusion SQL.
Build with make_report (title, 2-5 sentence summary, KPIs, chart, table). For "every morning / weekly" requests offer
schedule_job (the user confirms)."""),
]}

MAX_TURNS = 14


def tools_for(specialist: str, caps: list[str] | None) -> list[Tool]:
    """The tools a specialist may use that this app can run (hub tools always)."""
    capset = set(caps or [])
    out = []
    for t in TOOLS:
        if t.specialists and specialist not in t.specialists:
            continue
        if t.runs != "hub" and caps is not None and t.name not in capset:
            continue
        out.append(t)
    return out


def route(text: str, current: str | None = None) -> tuple[str, dict]:
    """Rules first (free, instant): score routing words; ties keep the current specialist, else the Fusion Analyst.
    '@wms' / '@orders' … pins a specialist."""
    t = " " + (text or "").lower() + " "
    pins = {"@fusion": FA, "@sql": FA, "@wms": WO, "@trip": WO, "@orders": OD, "@order": OD, "@load": DL, "@fbdi": DL, "@report": RP}
    for k, v in pins.items():
        if k in t:
            return v, {v: 99}
    scores = {}
    for sid, sp in SPECIALISTS.items():
        n = 0
        for w in sp.words:
            weight = 3 if w.startswith("!") else 2 if " " in w else 1
            w = w.lstrip("!")
            if any(f" {w}{end}" in t for end in (" ", "s ", "?", "s?", ",", "s,", ".", "s.")):
                n += weight
        scores[sid] = n
    best = max(scores.values())
    if best == 0:
        return (current or FA), scores
    top = [k for k, v in scores.items() if v == best]
    if current in top:
        return current, scores
    return top[0], scores
