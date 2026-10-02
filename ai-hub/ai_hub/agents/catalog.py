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
    only: str | None = None       # "phone" = offered only on a phone call

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
    Tool("run_code", "Run code on this PC: python (pandas, matplotlib; add pip packages), csharp (.NET 8 top-level statements; NuGet "
         "packages), javascript (Node.js) or powershell. Use it for calculations, data conversion, reconciliation, file work or anything "
         "no other tool does. The code runs in its own folder: result_id gives it that result as input.csv; print what matters (you get "
         "the output), write output.csv for a table (it appears in the results panel) and *.png for a chart (you see it). The user always "
         "sees the full code on a confirm card first; keep it short and readable, explain in one line what it does. install=true downloads "
         "a missing language first. Only AI admins can run code. For saved code: saved_code op get, then run its code.",
         _obj({"language": {"type": "string", "enum": ["python", "csharp", "javascript", "powershell"]}, "code": S,
               "purpose": s("One line for the confirm card"), "result_id": s("A result to give the code as input.csv"),
               "packages": SA, "stdin": S, "timeout_s": i("5-600, default 60"), "install": {"type": "boolean"}}, ["language", "code"]),
         runs="host", risk="act", policy="run_code"),
    Tool("saved_code", "The team's saved code (AI Agent › Code tab): op list = names, languages, descriptions; op get (name) = the code.",
         _obj({"op": {"type": "string", "enum": ["list", "get"]}, "name": S})),
    Tool("camera", "Open the laptop / USB camera in the chat with a live preview; the USER takes the picture(s) (you never do) and "
         "they come back to you as images. Use it when the user wants to show you something: a delivery note, invoice, label, "
         "shelf, damaged goods, a handwritten list, a screen. Then read it and turn it into text, a table (render / format_result), "
         "or match it to orders and trips. Ask for several pages with pages > 1.",
         _obj({"title": s("Card title, e.g. 'Delivery note'"), "reason": s("What to photograph and why, shown to the user"),
               "pages": i("How many photos you expect (1-6)")}, ["reason"]), risk="ask"),
    Tool("vision", "Computer vision on pictures of THIS conversation (attachments, camera photos, earlier vision outputs) with OpenCV "
         "and YOLO on this PC: op document = find the page and flatten / clean it (then read it better); barcodes = read every "
         "barcode / QR (Code 128, EAN, DataMatrix …) exactly; count = count objects (boxes, bottles, tops; method circles for "
         "round things); detect = YOLO object detection with names (person, truck, bottle … or the team's own model, params.model) "
         "with counts per class (to count people use classes 'person', chickens / any birds 'bird', vehicles 'car, truck'); "
         "similar = count everything like ONE example (params.box = x, y, w, h of it in the picture's pixels, "
         "e.g. one key of a remote, one carton) by colour, size, shape and look; compare = what changed between two photos (before / after: damage, missing items); find = "
         "where a thing (2nd image) appears in a scene (1st); enhance / info (blurry? too dark?) / edges / resize. images = names "
         "of pictures, 'last' (default) or 'last2'. Prefer it over guessing for codes and counts; the annotated picture comes back.",
         _obj({"op": {"type": "string", "enum": ["document", "barcodes", "count", "similar", "detect", "compare", "find", "enhance", "info", "edges", "resize"]},
               "images": {"type": "array", "items": S, "description": "Picture names, 'last' or 'last2'"},
               "params": {"type": "object", "description": "document: mode color|gray|bw · count: method auto|contours|circles · detect: model "
                          "(yolo11n, yolo11n-seg, yolo11n-pose, or a custom name), conf, classes 'person, truck' · compare: threshold · "
                          "resize: max_side · similar: box {x,y,w,h} + tolerance 0-100"}},
              ["op"])),
    Tool("phone_call", "Place a real phone call (Twilio) where you talk with the person yourself to reach a goal - e.g. confirm a delivery "
         "slot with a customer, ask a driver for an ETA, remind about an overdue payment. Give the number in international format "
         "(+230…), who it is and the goal. You introduce yourself as an AI assistant; nothing is changed on the call; the "
         "transcript and summary come back to this conversation (calls dialog). The user confirms.",
         _obj({"to": s("+<country><number>"), "name": s("Who you are calling"), "goal": s("What the call must achieve, with the facts you may share"),
               "language": s("e.g. en-US, fr-FR")}, ["to", "goal"]), runs="hub", risk="act", policy="phone_call"),
    Tool("end_call", "Hang up this phone call after your goodbye.", _obj({"reason": S}), runs="hub", only="phone"),
    Tool("take_message", "Record a message from the caller for the team (shown in the AI Agent calls list).",
         _obj({"name": S, "company": S, "callback": s("Number to call back"), "message": s("What they want")}, ["message"]),
         runs="hub", risk="auto", only="phone"),
    Tool("jobs_list", "The scheduled agent jobs of this user with their last run.", _obj({}), runs="hub", specialists=[RP, FA, WO]),
]


# ── AI Digital Employee parity: its chat actions as tools, same fields (see its knowledge in the system prompt) ──
ALL = [FA, WO, OD, DL, RP]
OBJ = {"type": "object"}
TOOLS += [
    Tool("wms_sql", "Read SQL (Oracle SELECT / WITH) on the WMS / APEX schema described in the knowledge (schema catalog) through the guarded "
         "gateway: trips, orders, print jobs, agents, tasks, processes … Max 200 rows. = the AI Digital Employee's action sql.",
         _obj({"sql": s("One SELECT / WITH"), "reason": s("One line")}, ["sql"]), runs="host", specialists=ALL),
    Tool("fusion_call", "Oracle Fusion REST call (path starts /fscmRestApi/…, see the Fusion REST catalog in the knowledge). GET runs at once; "
         "POST / PATCH / DELETE change Fusion: the user confirms (policy fusion_write). = action fusion.",
         _obj({"method": {"type": "string", "enum": ["GET", "POST", "PATCH", "DELETE"]}, "path": S, "body": OBJ, "instance": s("PROD / TEST"),
               "reason": S}, ["method", "path"]), runs="host", risk="act", policy="fusion_write", specialists=[FA, WO, OD, DL]),
    Tool("ords_read", "GET a whitelisted helper endpoint of the app's ORDS (e.g. /ARMODULE/BOGO, /WAREHOUSEMANAGEMENT/ai/apicatalog). = action ords.",
         _obj({"path": S, "params": OBJ, "reason": S}, ["path"]), runs="host", specialists=[WO, OD]),
    Tool("device", "This PC: op list_printers | system_info | list_files (intake / download folder) | import_file (read a file from it - "
         "PDFs and images come back as content) | move_file (to a subfolder, e.g. processed) | download_orders (order PDFs from Fusion) | "
         "print_orders (download + print order PDFs, the user confirms) | print (print a result grid: give result_id, printer, title; "
         "the user confirms). = action device.",
         _obj({"op": {"type": "string", "enum": ["list_printers", "system_info", "list_files", "import_file", "move_file", "download_orders", "print_orders", "print"]},
               "orders": SA, "printer": S, "instance": S, "file": S, "dest": S, "title": S, "result_id": S, "reason": S}, ["op"]),
         runs="host", risk="act", policy="print", specialists=[WO, OD, RP]),
    Tool("hardware", "Everything about this PC's hardware and connections, read-only: op summary | network (adapters, IP, gateway, "
         "DNS, MAC) | wifi (connected Wi-Fi: SSID, signal, speed) | wifi_networks (visible networks) | cpu_memory (CPU, RAM, GPU, top "
         "processes) | disks | usb | devices (class=Printer|Camera|Image|Ports|Bluetooth|Monitor|HIDClass…, or problems=true for "
         "devices with errors) | printers (status, port, driver, offline) | print_queue (stuck jobs) | battery | displays | bios "
         "(make, model, serial) | os | software (name=filter) | processes (name=filter) | services (name, state) | events "
         "(log=System|Application|PrintService: recent errors) | ping (host) | port (host, port - e.g. 9100 for a network printer) | "
         "wmi (query = one WQL SELECT on Win32_/CIM_/MSFT_ classes, for anything else) | bluetooth (paired devices + adapter) | "
         "open_settings (page = add_device | bluetooth | connected_devices | project_display | display | sound | wifi | printers | "
         "camera_privacy | microphone_privacy | location_privacy | mobile_devices: opens that Windows panel on the user's screen - use it "
         "to PAIR / CONNECT a Bluetooth device, CAST / project to a TV or fix a privacy switch, then say exactly what to click; Windows "
         "asks for the pairing PIN itself). Controls, the user confirms: "
         "set_default_printer (printer), cancel_print_jobs (printer). Never just say you cannot connect a device - open the right panel. "
         "Use it whenever a question is about this PC, its network, "
         "devices or printers - never say you cannot see them before trying.",
         _obj({"op": {"type": "string", "enum": ["summary", "network", "wifi", "wifi_networks", "cpu_memory", "disks", "usb", "devices", "printers",
                                                 "print_queue", "battery", "displays", "bios", "os", "software", "processes", "services", "events",
                                                 "ping", "port", "wmi", "bluetooth", "open_settings", "set_default_printer", "cancel_print_jobs"]},
               "host": S, "port": I, "name": S, "state": S, "log": S, "count": I, "query": S, "printer": S, "problems": {"type": "boolean"},
               "class": S, "page": S, "reason": S}, ["op"]),
         runs="host", risk="act", policy="device_control", specialists=ALL),
    Tool("db_write", "DDL / DML on the WMS / APEX database (INSERT / UPDATE / DELETE / CREATE …) through ai/executewrite. The user confirms "
         "(policy db_write). = action db_write.", _obj({"sql": s("One statement"), "reason": S}, ["sql"]), runs="host", risk="act", policy="db_write", specialists=ALL),
    Tool("wms_job", "Schedule a background job exactly as described in the knowledge (lane DB = DBMS_SCHEDULER, lane LOCAL = this app runs "
         "its steps: query / rest / print / download_pdf / forEach / ipc). The user confirms (policy schedule_job). = action schedule_job.",
         {"type": "object", "properties": {"lane": {"type": "string", "enum": ["DB", "LOCAL"]}, "name": S, "description": S}, "required": ["lane", "name"],
          "additionalProperties": True}, runs="host", risk="act", policy="schedule_job", specialists=[WO, RP, FA]),
    Tool("email", "Send an e-mail from the app's mail account (HTML body). The user confirms (policy email). = action email.",
         _obj({"to": s("a@x.com;b@y.com"), "cc": S, "subject": S, "bodyHtml": S, "reason": S}, ["to", "subject", "bodyHtml"]), runs="host", risk="act",
         policy="email", specialists=ALL),
    Tool("save_report", "Save a report definition (title, SQL, chart …) as described in the knowledge. = action save_report.",
         {"type": "object", "properties": {"title": S, "sql": S}, "required": ["title"], "additionalProperties": True}, runs="host", risk="auto",
         specialists=[RP, FA, WO]),
    Tool("dll", "Read a .dll / .exe without running it: op list | inspect | find | decompile (path, query, target 'Ns.Type::Member'). = action dll.",
         _obj({"op": {"type": "string", "enum": ["list", "inspect", "find", "decompile"]}, "path": S, "query": S, "target": S, "namespace": S,
               "internal": {"type": "boolean"}}, ["op"]),
         runs="host", specialists=[FA, DL]),
    Tool("model_tool", "Fusion Model tools: op overview | search | describe | evaluate | values | sql | checks (query, name, column, search, sql, names). = action model.",
         _obj({"op": {"type": "string", "enum": ["overview", "search", "describe", "evaluate", "values", "sql", "checks"]}, "query": S, "name": S, "column": S,
               "search": S, "sql": S, "names": SA}, ["op"]), runs="host", specialists=[FA, RP]),
    Tool("grid", "Show rows as an interactive list the user can select from, with action buttons (e.g. 'Cancel selected', 'Print selected'); "
         "the user's choice comes back as their next message. Use for 'pick which ones' moments. = action grid.",
         _obj({"title": S, "markdown": s("Short text above the list"), "columns": SA, "rows": {"type": "array", "items": {"type": "array"}},
               "key": s("Column whose values identify a row"),
               "formats": {"type": "object", "description": "Optional column → format spec (same as format_result.columns), e.g. links to Fusion or badges"},
               "actions": {"type": "array", "items": _obj({"label": S, "prompt": s("What to do with the selected rows")}, ["label", "prompt"])}},
              ["columns", "rows"]), risk="ask", specialists=ALL),
    # ── rich output (everyone): links, formatted results, documents ──
    Tool("open_url", "Open a web page (http/https) in the user's own browser now - e.g. an Oracle doc, a Fusion page, a tracking "
         "link the user asked for. A clickable link is also shown in the chat. For links inside an answer just write Markdown "
         "links; use this only when the user wants the page opened.",
         _obj({"url": s("http(s) address"), "label": s("Short text for the link"), "open": {"type": "boolean", "description": "false = only show the link"}}, ["url"]),
         risk="auto", specialists=ALL),
    Tool("format_result", "Format a result in the results panel (any result_id: Fusion runs, WMS rows, analyses): per column a "
         "format - link (url template with {VALUE} or {OTHER_COLUMN}, label), email, number (decimals), money (currency e.g. MUR, "
         "decimals), percent (ratio=true when 0.25 means 25 %), date, datetime, badge (status colours, auto for OK/FAILED/PENDING… "
         "or colors {value: green|amber|red|blue|grey}), bar (in-cell data bar, of=number|money), bool, bytes, duration (unit "
         "s|ms|min), title (header text) and rules [{op: > >= < <= = != contains, value, color}]; row_rules colour whole rows; "
         "hide / order columns; sort {column, desc}; title and note (Markdown) above the grid. Copy formatted keeps the look "
         "for Outlook / Teams / Excel. Use it whenever a result would read better formatted - no new query is run.",
         _obj({"result_id": S, "columns": {"type": "object", "description": "COLUMN → {format, decimals, currency, url, label, colors, rules, title, ratio, of, max, unit}"},
               "hide": SA, "order": SA, "row_rules": {"type": "array", "items": _obj({"column": S, "op": S, "value": S, "color": S}, ["column", "op", "value"])},
               "sort": _obj({"column": S, "desc": {"type": "boolean"}}, ["column"]), "title": S, "note": s("Markdown above the grid"),
               "merge": {"type": "boolean", "description": "Keep earlier column formats"}}, ["result_id"]),
         specialists=ALL),
    Tool("render", "Show a nicely formatted document in the results panel (letter, e-mail draft, summary, checklist, comparison, "
         "procedure, KPI sheet) that the user can print / save as PDF / copy formatted into Outlook or Teams / save as .html. "
         "markdown supports everything the chat does (headings, tables, links, callouts, badges, ```chart); html (sanitized: "
         "no scripts, forms or external styles; inline style allowed) for custom layouts.",
         _obj({"title": S, "markdown": S, "html": S}, ["title"]), specialists=ALL),
    Tool("api_form", "Run a WMS write API from the app's API catalog through a form the user reviews, edits and submits (apiId + values, or a raw "
         "request {method, url, body}). = action api_form.",
         _obj({"apiId": S, "values": OBJ, "name": S, "note": S, "request": OBJ}), risk="act", policy="wms_api", specialists=[WO, OD]),
    Tool("tasks_today", "The Daily Tasks board (wms_ai_tasks): tasks for a day with status, priority, steps and the last events.",
         _obj({"date": s("YYYY-MM-DD, default today"), "status": S, "task_id": I}), specialists=ALL),
    Tool("task_log", "Record your work on a Daily Task for traceability: an event (PROGRESS / ISSUE / RESULT / NOTE) and optionally the new status "
         "(IN_PROGRESS / DONE / BLOCKED) with the result or issue text.",
         _obj({"task_id": I, "kind": {"type": "string", "enum": ["PROGRESS", "ISSUE", "RESULT", "NOTE"]}, "message": S,
               "status": {"type": "string", "enum": ["IN_PROGRESS", "DONE", "BLOCKED"]}}, ["task_id", "kind", "message"]), risk="auto", specialists=ALL),
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


AIDE_HEADER = """# Company knowledge (shared with the AI Digital Employee)
The text below was written for the AI Digital Employee, which replies with JSON actions. You have the same abilities as
tools with the same fields - do NOT reply with JSON objects, call the tools: action sql -> wms_sql, fusion -> fusion_call,
ords -> ords_read, device -> device, db_write -> db_write, schedule_job -> wms_job, email -> email, api_form -> api_form,
grid -> grid, save_report -> save_report, dll -> dll, model -> model_tool, mra_interface -> mra_interface. Its rules
(trained processes first, SQL rules, trip dates, cancelling lines with child lines, policies, formatting) apply to you.
Answers are rich Markdown (see FORMATTING) - never say you cannot format, link or open a page."""

COMMON = """You are part of Gray's WMS AI Agent - a team of specialists inside a warehouse / Oracle Fusion app used by
a distribution company (Mauritius and the region). Be brief and concrete. Use tools to find facts; never invent table
names, columns, codes, order numbers or results. Anything that changes data or runs a big query goes through a tool
the user confirms - say what you are about to do in one line before calling it. Answer in the user's language.
When a result is shown in the results panel, do not repeat the whole table: summarise what matters (totals, outliers,
what to check next) in a few lines.

FORMATTING - the chat renders rich Markdown, so make answers easy to scan:
- Headings (##), **bold**, *italic*, ==highlight==, ~~strike~~, numbered / bullet / task lists (- [ ] / - [x]), > quotes,
  tables (| a | b | with |---:| for right-aligned numbers), code fences with a Copy button, --- rules.
- Links are clickable: [text](https://…) and bare https:// addresses open in the user's browser; [text](ask:question)
  sends that question as the user's next message (offer follow-ups this way); [text](page:fusionsql|wms|om|dataload|
  fusionmodel|powerbi|aihub|fscm) opens an app page; [text](result:<result_id>) shows a result; mailto: works.
- Status badges inline: [[ok:Printed]] [[warn:Pending]] [[bad:Failed]] [[info:PROD]] [[muted:n/a]].
- Callouts: a quote starting with [!NOTE], [!TIP], [!WARNING] or [!DANGER].
- A small chart inside the answer: ```chart {"type":"bar|column|line|area|pie|donut","labels":[…],"datasets":[{"label":"…","data":[…]}],"title":"…"}```
- ```html blocks render sanitized HTML (inline styles ok; no scripts / forms).
Results: format_result (links per row, money / % / dates, badges, data bars, coloured rows, hidden columns) instead of
re-running a query; render for a document the user will print, e-mail or keep; open_url to open a page in the browser.
This PC (network, Wi-Fi, devices, USB, printers, disks, software, events …): the hardware tool - try it before saying
you cannot see something about the computer. To SEE something (a document, label, product): the camera tool - the
user takes the photo in the chat and you read it (text, tables, codes). Never say you cannot use the camera.
For exact barcodes, counts, object names, before / after changes or a skewed document photo, run the vision tool on the
picture (OpenCV / YOLO on this PC) instead of guessing - then answer from its numbers.
Keep it tidy: one heading level, short tables (≤ 15 rows in chat - the results panel holds the rest)."""

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
retry). When something must be approved by a person other than the user, use inbox_request.
Documents: order PDFs come from Fusion with the device tool - op download_orders (to the PC's download folder, no card)
or op print_orders (download + print, the user confirms; list_printers first for the exact printer name; at most 20
orders per call - split bigger trips). For a trip: trip_orders gives the order numbers. Never say you cannot download
or print - you can."""),
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

MAX_TURNS = 20


def tools_for(specialist: str, caps: list[str] | None, mode: str | None = None) -> list[Tool]:
    """The tools a specialist may use that this app can run (hub tools always). mode "phone" (a live call): only
    read / auto tools - nothing on a call needs a confirm card nobody can click - plus end_call / take_message."""
    capset = set(caps or [])
    out = []
    for t in TOOLS:
        if t.only and t.only != mode:
            continue
        if mode == "phone" and (t.risk in ("act", "ask") or t.name in ("handoff", "schedule_job", "remember")):
            continue
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
