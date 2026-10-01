"""The live console (NiceGUI) at /ui: watch and control the pipeline server from any browser.

Overview     engine mode + controls, what runs right now (task steps, rows, rows/s, watermark), activity feed,
             server health, throughput chart
Pipelines    every pipeline with its schedule, next / last run, Run now, tasks and watermarks (reset)
Runs         history; a run opens with its task steps, live log, Cancel / Kill / Retry from the failed task
Connections  test each connection from this server
Settings     Fusion user + password (Credential Manager), pods, API token, encryption key
Sign-in: the API token.
"""
from __future__ import annotations

import collections
import time

import inspect

from nicegui import app, background_tasks, run, ui

from . import VERSION, secrets_store

ACCENT = "#c74634"
MODE_COLOR = {"RUNNING": "positive", "PAUSED": "warning", "DRAINING": "warning", "STOPPED": "negative"}
STATUS_COLOR = {"SUCCESS": "positive", "FAILED": "negative", "CANCELLED": "grey-7", "RUNNING": "primary", "QUEUED": "info",
                "CANCELLING": "warning", "WAITING": "grey-5", "SKIPPED": "grey-5"}
STATUS_ICON = {"SUCCESS": "check_circle", "FAILED": "error", "CANCELLED": "block", "RUNNING": "sync", "QUEUED": "hourglass_top",
               "CANCELLING": "hourglass_bottom", "WAITING": "radio_button_unchecked", "SKIPPED": "skip_next"}


def fmt_secs(s) -> str:
    if s is None:
        return "—"
    s = int(s)
    if s < 0:
        return "due"
    if s < 60:
        return f"{s}s"
    if s < 3600:
        return f"{s // 60}m {s % 60:02d}s"
    if s < 86400:
        return f"{s // 3600}h {s % 3600 // 60:02d}m"
    return f"{s // 86400}d {s % 86400 // 3600}h"


def sched_text(p: dict) -> str:
    s = p.get("schedule")
    if s == "INTERVAL":
        return "every " + fmt_secs(p.get("interval") or 0)
    if s == "CRON":
        return "cron " + (p.get("cron") or "")
    if s == "CONTINUOUS":
        return "continuous" + (f" · {fmt_secs(p.get('interval'))} pause" if p.get("interval") else "")
    return "manual"


def mount_console(fastapi_app, sup, cfg):
    secret = secrets_store.get_secret("ui-secret")
    if not secret:
        import secrets as _s
        secret = _s.token_urlsafe(32)
        secrets_store.set_secret("ui-secret", secret)

    samples: collections.deque = collections.deque(maxlen=120)      # (time, total rows/s, running)

    def sample():
        rate = sum(w.rate for w in sup.workers.values())
        samples.append((time.strftime("%H:%M:%S"), round(rate), len(sup.workers)))

    app.timer(2.0, sample)

    @ui.page("/")
    def index(code: str = ""):
        ui.colors(primary="#2563eb", accent=ACCENT)
        ui.add_head_html("""<style>
            body{background:#f4f2f0}
            .card{background:#fff;border:1px solid #e7e2de;border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 4px 16px rgba(49,45,42,.05)}
            .kpi b{font-size:1.6rem;line-height:1.1;color:#1f1b19} .kpi span{font-size:.75rem;color:#8a817b}
            .muted{color:#8a817b} .mono{font-family:Consolas,'Cascadia Code',monospace}
            .step{display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:999px;font-size:.72rem;font-weight:600;border:1px solid #e7e2de;background:#faf8f7}
            .step.RUNNING{background:#dbeafe;border-color:#93c5fd;color:#1d4ed8} .step.SUCCESS{background:#dcfce7;border-color:#86efac;color:#15803d}
            .step.FAILED{background:#fee2e2;border-color:#fca5a5;color:#b91c1c} .step.CANCELLED{background:#f1f5f9;color:#475569}
            .feed div{font-size:.78rem;padding:3px 0;border-bottom:1px solid #f1edea}
            .lvl-ERROR{color:#b91c1c} .lvl-WARN{color:#b45309}
        </style>""")
        if code and not app.storage.user.get("ok"):
            from .app import take_console_code
            if take_console_code(code):
                app.storage.user["ok"] = True                         # opened from the WMS app on this PC
        if not app.storage.user.get("ok"):
            login()
            return
        console()

    def login():
        with ui.column().classes("absolute-center items-center gap-4"):
            ui.icon("lan", size="56px").style(f"color:{ACCENT}")
            ui.label("Gray's WMS — Pipeline Server").classes("text-2xl font-bold")
            ui.label(cfg.server_name).classes("muted")
            pw = ui.input("API token", password=True, password_toggle_button=True).classes("w-80").props("outlined")

            def go():
                if cfg.check_token(cfg.api_user, pw.value or ""):
                    app.storage.user["ok"] = True
                    ui.navigate.reload()
                else:
                    ui.notify("That token is not right", type="negative")
            pw.on("keydown.enter", go)
            ui.button("Sign in", on_click=go).props("unelevated color=accent").classes("w-80")
            ui.label("The token was shown when the server was set up (python -m pipeline_server new-token makes a new one).").classes("muted text-xs w-80 text-center")

    def console():
        # ── header ──
        with ui.header().classes("items-center gap-3 px-4").style("background:#1f1b19"):
            ui.icon("lan", size="28px").style(f"color:{ACCENT}")
            with ui.column().classes("gap-0"):
                ui.label("Pipeline Server").classes("text-lg font-bold text-white")
                ui.label(f"{cfg.server_name} · v{VERSION}").classes("text-xs").style("color:#bfb6b0")
            mode_badge = ui.badge("…").classes("text-sm px-3 py-1")
            info = ui.label().classes("text-xs").style("color:#bfb6b0")
            ui.space()
            b_pause = ui.button("Pause", icon="pause", on_click=lambda: sup.set_mode("PAUSED", "console")).props("flat color=white")
            b_resume = ui.button("Resume", icon="play_arrow", on_click=lambda: sup.set_mode("RUNNING", "console")).props("flat color=white")
            b_drain = ui.button("Drain", icon="hourglass_bottom", on_click=lambda: confirm("Drain the engine?", "Running runs finish, then the engine stops. Nothing new starts.",
                                                                                         lambda: sup.set_mode("DRAIN", "console"))).props("flat color=white")
            b_stop = ui.button("Stop now", icon="stop", on_click=lambda: confirm("Stop the engine now?", "Every running run is cancelled at its next page; incremental tasks continue from their watermark next time.",
                                                                                 lambda: sup.set_mode("STOP_NOW", "console"))).props("flat color=red-3")
            ui.button(icon="logout", on_click=lambda: (app.storage.user.clear(), ui.navigate.reload())).props("flat round color=white").tooltip("Sign out")

        def header_tick():
            s = sup.snapshot()["server"]
            mode_badge.text = s["mode"]
            mode_badge.props(f"color={MODE_COLOR.get(s['mode'], 'grey')}")
            info.text = (f"up {fmt_secs(s['uptime'])} · {s['workers']} · max {s['max_parallel']} parallel · control: {s['control']}"
                         + (f" · ⚠ {s['last_error'][:80]}" if s.get("last_error") else ""))
            running = s["mode"] == "RUNNING"
            b_pause.set_visibility(running)
            b_resume.set_visibility(not running)
            b_drain.set_visibility(s["mode"] in ("RUNNING", "PAUSED"))
            b_stop.set_visibility(s["mode"] != "STOPPED")
        ui.timer(1.0, header_tick)

        with ui.tabs().classes("w-full bg-white text-grey-9").props("align=left active-color=accent indicator-color=accent") as tabs:
            t_over = ui.tab("Overview", icon="monitor_heart")
            t_pipes = ui.tab("Pipelines", icon="account_tree")
            t_runs = ui.tab("Runs", icon="history")
            t_conn = ui.tab("Connections", icon="cable")
            t_set = ui.tab("Settings", icon="settings")
        with ui.tab_panels(tabs, value=t_over).classes("w-full bg-transparent"):
            with ui.tab_panel(t_over):
                overview()
            with ui.tab_panel(t_pipes):
                pipelines_tab()
            with ui.tab_panel(t_runs):
                runs_tab()
            with ui.tab_panel(t_conn):
                connections_tab()
            with ui.tab_panel(t_set):
                settings_tab()

    def confirm(title, text, action):
        with ui.dialog() as d, ui.card().classes("p-5 w-96"):
            ui.label(title).classes("text-lg font-bold")
            ui.label(text).classes("muted")
            with ui.row().classes("w-full justify-end"):
                ui.button("Cancel", on_click=d.close).props("flat")
                def yes():
                    d.close()
                    res = action()
                    if inspect.isawaitable(res):
                        background_tasks.create(res)
                ui.button("Yes", on_click=yes).props("unelevated color=accent")
        d.open()

    def overview():
        with ui.row().classes("w-full gap-3 no-wrap"):
            k_run = kpi("Running now", "sync")
            k_ok = kpi("Succeeded (recent)", "check_circle")
            k_fail = kpi("Failed (recent)", "error")
            k_rows = kpi("Rows written (recent)", "table_rows")
            k_cpu = kpi("CPU / memory", "memory")
        with ui.row().classes("w-full gap-3 items-start no-wrap"):
            with ui.column().classes("gap-3").style("flex:2;min-width:0"):
                ui.label("Running now").classes("text-base font-bold mt-2")
                running_area = ui.column().classes("w-full gap-3")
                ui.label("Throughput (rows/s, all runs)").classes("text-base font-bold mt-2")
                chart = ui.echart({"grid": {"left": 50, "right": 16, "top": 16, "bottom": 28}, "tooltip": {"trigger": "axis"},
                                   "xAxis": {"type": "category", "data": []}, "yAxis": {"type": "value"},
                                   "series": [{"type": "line", "smooth": True, "areaStyle": {"opacity": .12}, "data": [], "color": "#2563eb", "showSymbol": False}]}
                                  ).classes("w-full card").style("height:220px")
            with ui.column().classes("gap-3").style("flex:1;min-width:0"):
                ui.label("Activity").classes("text-base font-bold mt-2")
                feed = ui.column().classes("w-full card p-3 feed gap-0").style("max-height:560px;overflow:auto")

        last = {"running": None, "feed": None}

        def tick():
            s = sup.snapshot()
            fin = s["finished"]
            k_run.text = str(len(s["running"]))
            k_ok.text = str(sum(1 for w in fin if w["status"] == "SUCCESS"))
            k_fail.text = str(sum(1 for w in fin if w["status"] == "FAILED"))
            k_rows.text = f"{sum(w['rows_written'] for w in fin + s['running']):,}"
            k_cpu.text = f"{s['metrics']['cpu']:.0f}% / {s['metrics']['memory']:.0f}%"
            sig = repr([(w["run_id"], w["status"], w["task"], w["rows_read"], w["rows_written"], sorted(w["task_state"].items())) for w in s["running"]])
            if sig != last["running"]:
                last["running"] = sig
                running_area.clear()
                with running_area:
                    if not s["running"]:
                        with ui.row().classes("card p-5 w-full items-center gap-3"):
                            ui.icon("check", size="28px").classes("text-positive")
                            ui.label("Nothing is running. " + ("Queued runs start at the next check." if s["server"]["mode"] == "RUNNING"
                                                                else f"The engine is {s['server']['mode'].lower()}.")).classes("muted")
                    for w in s["running"]:
                        run_card(w)
            fsig = repr(s["events"][:1])
            if fsig != last["feed"]:
                last["feed"] = fsig
                feed.clear()
                with feed:
                    for e in s["events"][:120]:
                        ui.html(sanitize=False, content=f'<div class="lvl-{e["level"]}"><span class="muted mono">{e["time"]}</span> {_esc(e["message"])}</div>')
            chart.options["xAxis"]["data"] = [x[0] for x in samples]
            chart.options["series"][0]["data"] = [x[1] for x in samples]
            chart.update()
        ui.timer(1.0, tick)

    def kpi(label, icon):
        with ui.column().classes("card p-4 kpi gap-1").style("flex:1;min-width:150px"):
            with ui.row().classes("items-center gap-2"):
                ui.icon(icon, size="18px").classes("muted")
                ui.label(label).classes("text-xs muted")
            v = ui.label("—").classes("text-2xl font-bold")
        return v

    def run_card(w):
        with ui.column().classes("card p-4 w-full gap-2"):
            with ui.row().classes("w-full items-center gap-2"):
                ui.icon("sync", size="20px").classes("text-primary animate-spin" if w["status"] == "RUNNING" else "text-warning")
                ui.label(w["pipeline"]).classes("text-base font-bold")
                ui.badge(f"run #{w['run_id']}").props("outline color=grey-7")
                ui.badge(w["trigger"].lower()).props("outline color=grey-7")
                if w.get("cycle", 1) > 1:
                    ui.badge(f"cycle {w['cycle']}").props("outline color=primary")
                ui.space()
                ui.label(fmt_secs(w["elapsed"])).classes("muted mono")
                ui.button("Log", icon="article", on_click=lambda rid=w["run_id"]: open_run(rid)).props("flat dense")
                ui.button("Cancel", icon="cancel", on_click=lambda rid=w["run_id"]: sup.cancel(rid, "console")).props("flat dense color=warning")
                ui.button("Kill", icon="dangerous", on_click=lambda rid=w["run_id"]: confirm(f"Kill run #{rid}?", "The worker process is stopped right away. Use it only when a run is stuck.",
                                                                                             lambda: sup.kill(rid, "console"))).props("flat dense color=negative")
            if w["tasks"]:
                with ui.row().classes("gap-1"):
                    for n in w["tasks"]:
                        st = w["task_state"].get(n, "WAITING")
                        ui.html(sanitize=False, content=f'<span class="step {st}">{"⟳" if st == "RUNNING" else "✓" if st == "SUCCESS" else "✗" if st == "FAILED" else "•"} {_esc(n)}</span>')
            with ui.row().classes("w-full gap-6 text-sm"):
                ui.label(f"Task: {w['task'] or 'starting…'}")
                ui.label(f"Read {w['rows_read']:,}")
                ui.label(f"Written {w['rows_written']:,}")
                ui.label(f"{w['rate']:,} rows/s")
                ui.label(f"Pages {w['pages']}")
                if w["watermark"]:
                    ui.label(f"Watermark {w['watermark']}").classes("mono")
            ui.linear_progress(show_value=False).props("indeterminate color=primary" if w["status"] == "RUNNING" else "color=warning value=1")

    # ── pipelines ──
    def pipelines_tab():
        with ui.row().classes("w-full items-center"):
            ui.label("Pipelines this server runs").classes("text-base font-bold")
            ui.label("(defined in the WMS app: Fusion SQL › Pipelines)").classes("muted text-sm")
            ui.space()
            ui.button("Check now", icon="refresh", on_click=lambda: (sup.kick(), ui.notify("Re-reading definitions"))).props("flat")
        area = ui.column().classes("w-full gap-2")
        live = {"sig": None, "labels": {}}

        def draw():
            ps = sup.pipelines
            running = {w.pipeline_id: w for w in sup.workers.values()}
            sig = repr([(p["id"], p["name"], p["enabled"], p["schedule"], p.get("last_run_status"), p["id"] in running) for p in ps])
            if sig == live["sig"]:
                for p in ps:                                  # only the times move: update them in place
                    lb = live["labels"].get(p["id"])
                    if lb:
                        lb[0].text, lb[1].text = when_text(p, running.get(p["id"])), last_text(p)
                return
            live["sig"] = sig
            area.clear()
            with area:
                if not ps:
                    ui.label("No pipelines assigned to this server yet.").classes("muted")
                for p in ps:
                    w = running.get(p["id"])
                    st = "RUNNING" if w else (p.get("last_run_status") or "—")
                    with ui.expansion().classes("card w-full").props("dense") as ex:
                        with ex.add_slot("header"):
                            with ui.row().classes("w-full items-center gap-3 no-wrap"):
                                ui.icon(STATUS_ICON.get(st, "radio_button_unchecked"), size="20px").props(f"color={STATUS_COLOR.get(st, 'grey')}")
                                with ui.column().classes("gap-0"):
                                    ui.label(p["name"]).classes("font-bold")
                                    ui.label(p.get("description") or "").classes("text-xs muted")
                                ui.space()
                                ui.badge(sched_text(p)).props("outline color=grey-8")
                                ui.badge("on" if p["enabled"] else "off").props(f"color={'positive' if p['enabled'] else 'grey-5'}")
                                l_when = ui.label(when_text(p, w)).classes("text-xs muted w-28")
                                l_last = ui.label(last_text(p)).classes("text-xs muted w-40")
                                live["labels"][p["id"]] = (l_when, l_last)
                                ui.button("Run now", icon="play_arrow", on_click=lambda pid=p["id"]: run_now(pid)).props("unelevated dense color=accent").on("click.stop", lambda: None)
                        tasks_box = ui.column().classes("w-full")
                        ex.on_value_change(lambda e, pid=p["id"], box=tasks_box: e.value and show_tasks(pid, box))
        ui.timer(5.0, draw)
        draw()

    def when_text(p, w):
        if w:
            return "running now"
        return f"next {fmt_secs(p.get('next_run_secs'))}" if p["schedule"] != "MANUAL" and p["enabled"] else ""

    def last_text(p):
        st = (p.get("last_run_status") or "").lower()
        return f"last {st} {fmt_secs(p.get('last_run_secs'))} ago" if p.get("last_run_secs") is not None else "never ran"

    async def show_tasks(pid, box):
        box.clear()
        with box:
            ui.spinner()
        try:
            tasks = await run.io_bound(sup.store.tasks, pid)
        except Exception as e:  # noqa: BLE001
            box.clear()
            with box:
                ui.label(f"Could not read the tasks: {e}").classes("text-negative")
            return
        box.clear()
        with box:
            cols = [{"name": "seq", "label": "#", "field": "seq"}, {"name": "name", "label": "Task", "field": "name", "align": "left"},
                    {"name": "src", "label": "Source", "field": "src", "align": "left"}, {"name": "mode", "label": "Load", "field": "mode", "align": "left"},
                    {"name": "target", "label": "Target", "field": "target", "align": "left"}, {"name": "wm", "label": "Watermark", "field": "wm", "align": "left"}]
            rows = [{"id": t["id"], "seq": t["seq"], "name": t["name"] + ("" if t["active"] else " (off)"), "src": t["source_type"],
                     "mode": t["mode"] + (f" by {t['wm_col']}" if t["wm_col"] else "") + (f" · keys {', '.join(t['keys'])}" if t["keys"] else ""),
                     "target": t["target"], "wm": t["watermark"] or "—"} for t in tasks]
            tbl = ui.table(columns=cols, rows=rows, row_key="id").classes("w-full").props("flat dense")
            tbl.add_slot("body-cell-wm", r'''<q-td :props="props"><span class="mono">{{ props.value }}</span>
                <q-btn v-if="props.value !== '—'" flat dense size="sm" icon="restart_alt" color="warning" @click="$parent.$emit('reset', props.row)"><q-tooltip>Reset: the next run loads everything again</q-tooltip></q-btn></q-td>''')
            tbl.on("reset", lambda e: confirm(f"Reset the watermark of {e.args['name']}?", "The next run reloads all rows of this task.",
                                              lambda: (sup.store.set_watermark(e.args["id"], None), ui.notify("Watermark cleared"), show_tasks(pid, box))))

    def run_now(pid):
        try:
            rid = sup.run_now(pid, {}, "console")
            ui.notify(f"Run #{rid} queued", type="positive")
        except Exception as e:  # noqa: BLE001
            ui.notify(f"Could not queue: {e}", type="negative")

    # ── runs ──
    def runs_tab():
        cols = [{"name": "id", "label": "Run", "field": "id", "sortable": True}, {"name": "pipeline", "label": "Pipeline", "field": "pipeline", "align": "left"},
                {"name": "status", "label": "Status", "field": "status"}, {"name": "trigger", "label": "Trigger", "field": "trigger"},
                {"name": "started", "label": "Started", "field": "started"}, {"name": "secs", "label": "Took", "field": "took"},
                {"name": "read", "label": "Read", "field": "read"}, {"name": "written", "label": "Written", "field": "written"},
                {"name": "error", "label": "Error", "field": "error", "align": "left"}]
        with ui.row().classes("w-full items-center"):
            ui.label("Run history").classes("text-base font-bold")
            ui.space()
            flt = ui.select({"": "All", "FAILED": "Failed", "SUCCESS": "Succeeded", "RUNNING": "Running", "CANCELLED": "Cancelled"}, value="", label="Show").props("dense outlined").classes("w-40")
        tbl = ui.table(columns=cols, rows=[], row_key="id", pagination=20).classes("w-full card").props("flat")
        tbl.add_slot("body-cell-status", r'''<q-td :props="props"><q-badge :color="{SUCCESS:'positive',FAILED:'negative',RUNNING:'primary',QUEUED:'info',CANCELLED:'grey-7'}[props.value]||'grey'">{{ props.value }}</q-badge></q-td>''')
        tbl.on("rowClick", lambda e: open_run(e.args[1]["id"]))

        async def load():
            try:
                rs = await run.io_bound(sup.store.recent_runs, 200)
            except Exception as e:  # noqa: BLE001
                ui.notify(f"Could not read the runs: {e}", type="negative")
                return
            tbl.rows = [{"id": r["id"], "pipeline": r["pipeline"], "status": r["status"], "trigger": (r["trigger"] or "").lower(), "started": r["started"] or r["requested"],
                         "took": fmt_secs(r["secs"]), "read": f"{r['rows_read']:,}", "written": f"{r['rows_written']:,}", "error": (r["error"] or "")[:90]}
                        for r in rs if not flt.value or r["status"] == flt.value]
        flt.on_value_change(load)
        ui.timer(5.0, load)

    def open_run(rid):
        with ui.dialog().props("maximized=false") as d, ui.card().classes("w-[1000px] max-w-full p-4"):
            head = ui.row().classes("w-full items-center gap-2")
            steps = ui.column().classes("w-full")
            log = ui.log(max_lines=2000).classes("w-full mono text-xs").style("height:380px;background:#1f1b19;color:#e7e2de")
            with ui.row().classes("w-full justify-end gap-2"):
                b_cancel = ui.button("Cancel run", icon="cancel", on_click=lambda: sup.cancel(rid, "console")).props("flat color=warning")
                b_retry = ui.button("Retry from failed task", icon="replay", on_click=lambda: retry()).props("flat color=primary")
                ui.button("Close", on_click=d.close).props("unelevated")
            seen = {"log": 0, "live": 0}

            def retry():
                trs = sup.store.task_runs(rid)
                failed = next((t for t in trs if t["status"] in ("FAILED", "CANCELLED")), None)
                r = sup.store.run(rid)
                params = dict(r.get("params") or {})
                if failed:
                    params["_START_TASK"] = failed["task_id"]
                new = sup.run_now(r["pipeline_id"], params, "console (retry)")
                ui.notify(f"Run #{new} queued" + (f", starting at {failed['task']}" if failed else ""), type="positive")
                d.close()

            async def refresh():
                try:
                    r = await run.io_bound(sup.store.run, rid)
                    trs = await run.io_bound(sup.store.task_runs, rid)
                except Exception as e:  # noqa: BLE001
                    log.push(f"(could not read the run: {e})")
                    return
                if not r:
                    return
                head.clear()
                with head:
                    ui.label(f"Run #{rid} — {r['pipeline']}").classes("text-lg font-bold")
                    ui.badge(r["status"]).props(f"color={STATUS_COLOR.get(r['status'], 'grey')}")
                    ui.label(f"{(r['trigger'] or '').lower()} · by {r.get('by') or '?'} · started {r.get('started') or '—'} · took {fmt_secs(r.get('secs'))} · "
                             f"{r['rows_read']:,} read / {r['rows_written']:,} written").classes("muted text-sm")
                steps.clear()
                with steps:
                    with ui.row().classes("gap-2"):
                        for t in trs:
                            ui.html(sanitize=False, content=f'<span class="step {t["status"]}">{_esc(t["task"])} · {t["rows_written"]:,} rows · {fmt_secs(t["secs"])}'
                                    + (f' · wm {_esc(t["wm_to"])}' if t.get("wm_to") else "") + "</span>")
                    if r.get("error"):
                        ui.label(r["error"]).classes("text-negative text-sm")
                b_cancel.set_visibility(r["status"] in ("RUNNING", "QUEUED"))
                b_retry.set_visibility(r["status"] in ("FAILED", "CANCELLED"))
                w = sup.workers.get(rid)
                if w:                                   # live lines straight from the worker
                    lines = list(w.log)[seen["live"]:]
                    for l in lines:
                        log.push(f"{l['time']} {l['level']:<5} {l['message']}")
                    seen["live"] += len(lines)
                else:
                    try:
                        rows = await run.io_bound(sup.store.logs, rid, seen["log"], 500)
                    except Exception:  # noqa: BLE001
                        rows = []
                    if seen["live"] == 0:
                        for l in rows:
                            log.push(f"{l['time']} {l['level']:<5} {l['message']}")
                    if rows:
                        seen["log"] = rows[-1]["id"]
            t = ui.timer(1.5, refresh)
            d.on("hide", lambda: t.cancel())
        d.open()

    # ── connections ──
    def connections_tab():
        ui.label("Connections (edit them in the WMS app: Fusion SQL › Setups › Data pipeline setups)").classes("text-base font-bold")
        area = ui.column().classes("w-full gap-2")

        async def draw():
            try:
                cs = await run.io_bound(sup.store.connections)
            except Exception as e:  # noqa: BLE001
                area.clear()
                with area:
                    ui.label(f"Could not read the connections: {e}").classes("text-negative")
                return
            area.clear()
            with area:
                for c in cs:
                    with ui.row().classes("card p-3 w-full items-center gap-3"):
                        ui.icon({"DUCKDB": "storage", "APEX_REST": "api"}.get(c["type"], "dns"), size="22px").classes("muted")
                        ui.label(c["name"]).classes("font-bold")
                        ui.badge(c["type"]).props("outline color=grey-8")
                        res = ui.label(c.get("msg") or "").classes("text-sm " + ("text-positive" if c.get("status") == "OK" else "text-negative" if c.get("status") == "ERROR" else "muted"))
                        ui.space()

                        async def test(cid=c["id"], lbl=res):
                            from .connectors import test_connection
                            lbl.text = "testing…"
                            conn = await run.io_bound(sup.store.connection, cid)
                            ok, msg = await run.io_bound(test_connection, conn, cfg.control.app_user)
                            lbl.text = msg
                            lbl.classes(replace="text-sm " + ("text-positive" if ok else "text-negative"))
                            try:
                                await run.io_bound(sup.store.set_connection_test, cid, ok, msg)
                            except Exception:  # noqa: BLE001
                                pass
                        ui.button("Test", icon="bolt", on_click=test).props("flat")
        ui.button("Reload", icon="refresh", on_click=draw).props("flat")
        ui.timer(0.1, draw, once=True)

    # ── settings ──
    def settings_tab():
        with ui.row().classes("w-full gap-4 items-start"):
            with ui.column().classes("card p-4 gap-2").style("flex:1;min-width:320px"):
                ui.label("Fusion (BI Publisher runner)").classes("text-base font-bold")
                ui.label("The same runner report as the WMS app (Fusion SQL › Connection › Deploy runner report).").classes("muted text-sm")
                for k, v in cfg.fusion.pods.items():
                    ui.label(f"{k}: {v}" + ("  (default)" if k == cfg.fusion.default_pod else "")).classes("mono text-sm")
                ui.label(f"Report: {cfg.fusion.report_path}").classes("mono text-sm")
                user = ui.input("Fusion user", value=cfg.fusion.username).props("outlined dense")
                pw = ui.input("Fusion password", password=True, password_toggle_button=True,
                              placeholder="saved" if secrets_store.get_secret("fusion") else "not saved yet").props("outlined dense")

                def save_fusion():
                    cfg.fusion.username = (user.value or "").strip()
                    cfg.save()
                    if pw.value:
                        secrets_store.set_secret("fusion", pw.value)
                        pw.value = ""
                    ui.notify("Saved — the password is in the Windows Credential Manager", type="positive")
                ui.button("Save", icon="save", on_click=save_fusion).props("unelevated color=accent")
                ui.label("A pipeline uses PROD unless its parameters say FUSION_POD = TEST.").classes("muted text-xs")
            with ui.column().classes("card p-4 gap-2").style("flex:1;min-width:320px"):
                ui.label("This server").classes("text-base font-bold")
                for k, v in [("Name", cfg.server_name), ("Listening on", f"{cfg.host}:{cfg.port}"), ("Control tables", f"{cfg.control.driver} — {cfg.control.ords_ai_base if cfg.control.driver == 'ords' else cfg.control.dsn}"),
                             ("Workers", "processes (killable)" if not sup.thread_mode else "threads"), ("Page size", f"{cfg.page_size:,} rows"),
                             ("Time zone", sup.server.get("timezone") or cfg.timezone), ("API user", cfg.api_user)]:
                    with ui.row().classes("gap-2 text-sm"):
                        ui.label(k + ":").classes("muted w-28")
                        ui.label(str(v)).classes("mono")
                ui.separator()
                ui.label("Encryption key").classes("font-bold")
                ui.label("The WMS app encrypts connection passwords with this key; only this server can read them.").classes("muted text-sm")
                ui.label(secrets_store.fingerprint()).classes("mono text-sm")
                ui.separator()
                ui.label("API token").classes("font-bold")
                ui.label("The WMS app signs in with it (Setups › Data pipeline setups › API token). A new token stops the old one at once.").classes("muted text-sm")

                def new_token():
                    tok = cfg.new_token()
                    cfg.save()
                    with ui.dialog() as d, ui.card().classes("p-5"):
                        ui.label("New API token — copy it now, it is not shown again").classes("font-bold")
                        ui.input(value=tok).props("readonly outlined").classes("w-96 mono")
                        ui.label("Paste it into the WMS app (Data pipeline setups › this server › API token).").classes("muted text-sm")
                        ui.button("Done", on_click=d.close).props("unelevated color=accent")
                    d.open()
                ui.button("Make a new token", icon="key", on_click=lambda: confirm("Make a new API token?", "The WMS app stops reaching this server until you paste the new token there.", new_token)).props("flat color=warning")

    ui.run_with(fastapi_app, mount_path="/ui", storage_secret=secret, title="Pipeline Server", favicon="🔀", show_welcome_message=False)
    return sample


def _esc(s) -> str:
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
