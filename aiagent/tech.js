/* AI Agent — "Track tech": which technology answered a prompt, layer by layer.
   With the switch on, the hub emits `trace` events (LangGraph node, router decision, model + SDK, tokens, timings) and
   the page times every tool it runs; each answer gets a layers icon that opens the trace. Traces are kept in the
   conversation, so an old answer still shows its trace. */

var TECH = window.TECH = { on: false, calls: {}, stack: null };

(function () { try { TECH.on = localStorage.getItem('ag.trackTech') === '1'; } catch (e) { /* private mode */ } })();
TECH.setOn = function (on) {
    TECH.on = !!on;
    try { localStorage.setItem('ag.trackTech', on ? '1' : '0'); } catch (e) { /* private mode */ }
    document.body.classList.toggle('tech-on', TECH.on);
    var hb = document.getElementById('btn-tech'); if (hb) hb.classList.toggle('on', TECH.on);
    toast(on ? 'Tracking tech — every answer gets a layers icon' : 'Tech tracking off', 'ok');
};
/** Top-bar button: turns tracking on, and opens the trace of the latest answer. */
TECH.headerClick = function () {
    if (!TECH.on) { TECH.setOn(true); var cb = document.getElementById('tech-on'); if (cb) cb.checked = true; }
    var last = Array.prototype.slice.call(document.querySelectorAll('.msg[data-seq] .fb')).pop();
    if (!last || !AG.tid) { toast('Tracking is on — ask something, then click the layers icon on the answer (or this button)', 'ok'); return; }
    TECH.show(+last.closest('.msg').dataset.seq);
};
TECH.beginTurn = function () { TECH.turnStart = Date.now(); };

// What each tool really runs on (the chain behind it)
TECH.TOOL = {
    fusion_search_objects: 'C# FusionSqlAi → Oracle Fusion BI Publisher (SOAP, DBMS_XMLGEN runner report) → data dictionary',
    fusion_search_columns: 'C# FusionSqlAi → Oracle Fusion BI Publisher (SOAP) → ALL_TAB_COLUMNS',
    fusion_describe: 'C# FusionSqlAi → Oracle Fusion BI Publisher (SOAP) → dictionary', fusion_source: 'C# FusionSqlAi → BI Publisher (SOAP) → ALL_SOURCE',
    fusion_dependencies: 'C# FusionSqlAi → BI Publisher (SOAP) → ALL_DEPENDENCIES',
    fusion_sql_dry_run: 'C# FusionSqlService → Oracle Fusion BI Publisher (SOAP): COUNT(*) + 5 sample rows',
    fusion_sql_run: 'C# FusionSqlService → Oracle Fusion BI Publisher (SOAP, DBMS_XMLGEN) → result cache in the host',
    result_analyze: 'C# host result cache (LINQ group / aggregate) — or the page for page-held results',
    wms_sql: 'C# ClaudeCliService → Oracle APEX ORDS ai/executequery (guarded SQL gateway, Oracle DB)',
    fusion_call: 'C# → Oracle Fusion REST (fscmRestApi), app credentials stay in C#', ords_read: 'C# → Oracle APEX ORDS (whitelisted GETs)',
    device: 'C# LocalDeviceService / FusionPdfDownloader (Fusion SOAP) / PrinterService (Windows printing)',
    hardware: 'C# System.Management (WMI) · .NET NetworkInformation · netsh / wevtutil (fixed commands) · ms-settings: Windows panels',
    db_write: 'C# → Oracle APEX ORDS ai/executewrite (Oracle DB) after your confirm', wms_job: 'C# → Oracle APEX job tables (DB / LOCAL lane)',
    email: 'C# SmtpVault → SMTP (password DPAPI-encrypted)', save_report: 'C# → Oracle APEX (report definitions)',
    dll: 'C# DllInspector (System.Reflection.Metadata, no code run)', model_tool: 'C# Fusion Model engine → DuckDB (semantic model)',
    mra_interface: 'C# MRAProcessor → 3 BI Publisher reports + MRA gateway (REST)', inbox_list: 'C# AiControl → Oracle APEX WMS_AI_INBOX',
    inbox_request: 'C# AiControl → APEX WMS_AI_INBOX + Teams webhook / SMTP alert',
    knowledge_lookup: 'Page → APEX ORDS (WMS_FUSION_KNOWLEDGE) + KB_ENGINE word scoring (JavaScript)', knowledge_propose: 'Page → APEX ORDS (WMS_FUSION_KNOWLEDGE)',
    saved_queries_search: 'Page → APEX ORDS (WMS_FUSION_SQL_QUERIES)', saved_query_get: 'Page → APEX ORDS', save_query: 'Page → APEX ORDS (MERGE)',
    watchdogs_status: 'Page → APEX ORDS (WMS_FUSION_WATCHDOGS)', watchdog_create: 'Page → APEX ORDS', flows_list: 'Page → APEX ORDS', setups_status: 'Page → APEX ORDS',
    datasets_list: 'Page → APEX ORDS', model_search: 'C# Fusion Model catalog (BM25 + fuzzy + values, optional Voyage vectors)', model_evaluate: 'C# Fusion Model → DAX compiler → DuckDB',
    trips_find: 'Page → APEX ORDS REST (GETTRIPDETAILS) + wms_print_jobs', trip_orders: 'Page → APEX ORDS REST', print_jobs: 'Page → APEX ORDS REST (printjobs)',
    printers_status: 'Page → APEX ORDS REST', mra_status: 'Page → APEX ORDS + C# omBip (BI Publisher)',
    om_orders_find: 'Page → APEX ORDS (WMS_OM_ORDERS)', om_order_detail: 'Page → APEX ORDS', fusion_order_status: 'Page → C# dataLoadFusionRest → Fusion REST (salesOrdersForOrderHub)',
    om_prepare_order: 'Page → browser storage (Order Pad draft) — nothing sent to Fusion', fbdi_templates_find: 'Page → FBDI catalog (JavaScript, generated from Oracle .xlsm)',
    fbdi_loads: 'Page → APEX ORDS (WMS_FBDI_LOADS)', fusion_rest_describe: 'Page → C# dataLoadFusionRest → Fusion REST describe', fusion_rest_get: 'Page → C# dataLoadFusionRest → Fusion REST GET',
    model_reports: 'C# Fusion Model (reports.json / dashboards.json)', show_chart: 'Chart.js in the page', make_report: 'Page (results panel, HTML report)',
    format_result: 'Page format.js (formats, sanitizer)', render: 'Page format.js (Markdown → sanitized HTML)', open_url: 'C# Process.Start → your default browser',
    open_page: 'Page navigation (WebView2)', grid: 'Page card (your selection goes back to the model)', api_form: 'Page form → C# → APEX ORDS (WMS API catalog)',
    tasks_today: 'Page → APEX ORDS (wms_ai_tasks)', task_log: 'Page → APEX ORDS', ask_user: 'Page question card (you answer)',
    camera: 'WebView2 getUserMedia → canvas JPEG → image block for the model', remember: 'AI Hub (Python) → SQLite agent.db memory',
    handoff: 'AI Hub (Python) → LangGraph state (specialist)', schedule_job: 'AI Hub (Python) → SQLite agent.db jobs + JobRunner thread',
    jobs_list: 'AI Hub (Python) → SQLite agent.db', phone_call: 'AI Hub → Twilio REST (Calls) + ConversationRelay WebSocket',
    end_call: 'AI Hub phone server (Twilio WebSocket)', take_message: 'AI Hub → SQLite calls table'
};
TECH.RUNS = { hub: ['AI Hub', 'Python'], host: ['C# host', '.NET 8'], page: ['Page', 'JavaScript'] };

// time every tool the page runs (host / page tools)
(function () {
    var orig = AG.execute;
    AG.execute = function (c, approved) {
        var t0 = performance.now(), rec = TECH.calls[c.id] = { name: c.name, runs: c.runs, risk: c.risk, approved: !!approved };
        return Promise.resolve(orig(c, approved)).then(function (r) { rec.ms = Math.round(performance.now() - t0); rec.ok = !(r && r.ok === false); return r; },
            function (e) { rec.ms = Math.round(performance.now() - t0); rec.ok = false; throw e; });
    };
    var origRender = AG.renderEvent;
    AG.renderEvent = function (e) {
        var fresh = e && e.seq > AG.seq;
        origRender(e);
        if (!fresh || !e) return;
        if (e.kind === 'user') TECH.lastUserSeq = e.seq;
        if (e.kind === 'say' && e.data && e.data.final) TECH.addIcon(e.seq);
    };
})();

/** The layers icon on an answer (only for answers that have a trace, or while tracking is on). */
TECH.addIcon = function (seq) {
    var fb = document.querySelector('.msg[data-seq="' + seq + '"] .fb');
    if (!fb || fb.querySelector('.tech-ic')) return;
    var b = document.createElement('button'); b.className = 'tech-ic'; b.title = 'Which technology answered this (Track tech)';
    b.innerHTML = '<i class="fa-solid fa-layer-group"></i>';
    b.onclick = function () { TECH.show(seq); };
    fb.appendChild(b);
};

/** Collects the events of the turn that ended with the answer `seq` (from the user's message before it). */
TECH.turnEvents = function (seq) {
    return hub('GET', '/agent/threads/' + AG.tid + '/events?after=0').then(function (r) {
        var ev = r.events, end = ev.findIndex(function (e) { return e.seq === seq; });
        if (end < 0) end = ev.length - 1;
        var start = end; while (start > 0 && ev[start].kind !== 'user') start--;
        return ev.slice(start, end + 1);
    });
};
TECH.loadStack = function () {
    if (TECH.stack) return Promise.resolve(TECH.stack);
    return hub('GET', '/agent/tech').then(function (s) { TECH.stack = s; return s; }).catch(function () { return null; });
};

TECH.show = function (seq) {
    openModal('Tech behind this answer', '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading the trace…</div>');
    Promise.all([TECH.turnEvents(seq), TECH.loadStack()]).then(function (r) { $('modal-b').innerHTML = TECH.html(r[0], r[1]); })
        .catch(function (e) { $('modal-b').innerHTML = '<p class="sm" style="color:#b91c1c">' + esc(e) + '</p>'; });
};

TECH.html = function (ev, stack) {
    var tr = ev.filter(function (e) { return e.kind === 'trace'; }).map(function (e) { return e.data; });
    var models = tr.filter(function (t) { return t.node === 'agent'; }), route = tr.filter(function (t) { return t.node === 'route'; })[0];
    var calls = ev.filter(function (e) { return e.kind === 'call'; }).map(function (e) { return e.data; });
    var results = {}; ev.filter(function (e) { return e.kind === 'result'; }).forEach(function (e) { results[e.data.id] = e.data; });
    var hubTools = {}; tr.filter(function (t) { return t.node === 'hub_tool'; }).forEach(function (t) { hubTools[t.name] = t; });
    var pauses = tr.filter(function (t) { return t.node === 'tools' && t.interrupt; }).length;
    var wall = ev.length > 1 ? (ev[ev.length - 1].ts - ev[0].ts) : 0;
    var modelMs = models.reduce(function (n, m) { return n + (m.model_ms || 0); }, 0);
    var tokIn = models.reduce(function (n, m) { return n + (m.tokens_in || 0); }, 0), tokOut = models.reduce(function (n, m) { return n + (m.tokens_out || 0); }, 0);
    var cost = models.reduce(function (n, m) { return n + (m.cost || 0); }, 0);
    var toolMs = calls.reduce(function (n, c) { var p = TECH.calls[c.id]; return n + (p && p.ms || 0); }, 0);
    var pk = (stack && stack.packages) || {}, v = function (p) { return pk[p] ? ' <span class="muted">' + esc(pk[p]) + '</span>' : ''; };
    var noTrace = !models.length;
    var sdks = models.map(function (m) { return m.sdk; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    var ms = function (x) { return x == null ? '—' : x >= 1000 ? (x / 1000).toFixed(1) + ' s' : x + ' ms'; };

    var kpis = '<div class="kpis"><div class="kpi"><b>' + (wall ? wall.toFixed(1) + ' s' : '—') + '</b><span>total</span></div>' +
        '<div class="kpi"><b>' + models.length + '</b><span>model calls · ' + ms(modelMs) + '</span></div>' +
        '<div class="kpi"><b>' + calls.length + '</b><span>tools · ' + ms(toolMs) + ' in the app</span></div>' +
        '<div class="kpi"><b>' + (tokIn + tokOut).toLocaleString() + '</b><span>tokens (' + tokIn.toLocaleString() + ' in / ' + tokOut.toLocaleString() + ' out)</span></div>' +
        '<div class="kpi"><b>$' + cost.toFixed(4) + '</b><span>cost</span></div></div>';

    var layer = function (icon, name, tech, detail) {
        return '<div class="tl-layer"><div class="tl-ic"><i class="fa-solid ' + icon + '"></i></div><div><b>' + name + '</b> <span class="tl-tech">' + tech + '</span>' + (detail ? '<div class="sm muted">' + detail + '</div>' : '') + '</div></div>';
    };
    var path = models.map(function (m, i) { return '<span class="chip">agent #' + (m.turn || i + 1) + '</span>'; });
    var nodes = '<span class="chip">route</span> → ' + path.join(pauses ? ' → <span class="chip">tools ⏸</span> → ' : ' → ') + ' → <span class="chip">END</span>';
    var layers = '<div class="tl">' +
        layer('fa-window-maximize', 'Page', 'WebView2 (Chromium) · vanilla JavaScript', 'aiagent/core.js sends your prompt; ' + (calls.filter(function (c) { return c.runs === 'page'; }).length) + ' tool(s) ran here') +
        layer('fa-microchip', 'C# host', '.NET 8 WinForms · WebView2 IPC (hubApi relay)', 'checks the AI kill switch, adds your app login, writes WMS_AI_AUDIT; ' + calls.filter(function (c) { return c.runs === 'host'; }).length + ' tool(s) ran here') +
        layer('fa-server', 'AI Hub', 'Python ' + esc((stack && stack.python) || '') + ' · FastAPI' + v('fastapi') + ' + uvicorn' + v('uvicorn'), '127.0.0.1, Bearer token; conversations and memory in SQLite (agent.db)') +
        layer('fa-diagram-project', 'LangGraph', 'StateGraph' + v('langgraph') + ' + SqliteSaver checkpointer' + v('langgraph-checkpoint-sqlite'),
            'nodes: ' + nodes + (pauses ? '<br>⏸ = interrupt(): the graph paused ' + pauses + '× for the app to run tools / show cards, then resumed from its checkpoint' : '') +
            (route ? '<br>routing: ' + esc(route.how) + ' → ' + esc(route.specialist) : '')) +
        layer('fa-link', 'LangChain', 'langchain-core' + v('langchain-core') + ' · GatewayChatModel (BaseChatModel) · bind_tools', models.length ? 'offered ' + models[0].tools_offered + ' tools, system prompt ' + (models[0].system_chars || 0).toLocaleString() + ' chars' + (models[0].cached_prefix ? ' (knowledge part cached by Claude prompt caching)' : '') : '') +
        layer('fa-route', 'AI Hub gateway', 'router task <b>' + esc((models[0] || {}).task || '—') + '</b> · fallback · budget · data class', models.some(function (m) { return m.fallback; }) ? 'a fallback provider answered' : 'first choice answered') +
        layer('fa-plug', 'Provider SDK', sdks.map(esc).join('<br>') || '—', '') +
        layer('fa-brain', 'Model', models.map(function (m) { return esc((m.provider || '') + ' / ' + (m.model || '')); }).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(', ') || '—', '') +
        '</div>';

    var mrows = models.map(function (m) {
        return '<tr><td>#' + m.turn + '</td><td>' + esc(m.specialist) + '</td><td>' + esc(m.provider) + ' / ' + esc(m.model) + '</td><td class="n">' + ms(m.model_ms) + '</td><td class="n">' + (m.tokens_in || 0).toLocaleString() + ' / ' + (m.tokens_out || 0).toLocaleString() +
            '</td><td class="n">$' + (m.cost || 0).toFixed(4) + '</td><td>' + esc(m.stop || '') + (m.tool_calls && m.tool_calls.length ? ' → ' + m.tool_calls.map(esc).join(', ') : '') + '</td></tr>';
    }).join('');
    var trows = calls.map(function (c) {
        var p = TECH.calls[c.id] || {}, h = hubTools[c.name] || {}, r = results[c.id] || {}, rr = TECH.RUNS[c.runs] || [c.runs, ''];
        return '<tr><td><b>' + esc(AG.label ? AG.label(c.name) : c.name) + '</b><div class="muted sm">' + esc(c.name) + '</div></td><td>' + esc(rr[0]) + ' <span class="muted">' + esc(rr[1]) + '</span></td><td class="sm">' + esc(TECH.TOOL[c.name] || (c.name.indexOf('plg_') === 0 ? 'Plugin' : rr[0])) +
            '</td><td class="n">' + ms(p.ms != null ? p.ms : h.ms) + '</td><td>' + (r.ok === false ? '<span class="tag b-bad">failed</span>' : r.ok ? '<span class="tag b-ok">ok</span>' : '<span class="tag b-muted">—</span>') +
            (c.risk === 'act' ? ' <span class="tag b-warn">confirm</span>' : '') + '</td></tr>';
    }).join('');

    return (noTrace ? '<div class="callout warn"><div class="co-t">No detailed trace for this answer</div>It was asked while “Track tech” was off. Tick <b>Track tech</b> (bottom right of the chat) and ask again to see the full trace.</div>' : '') +
        kpis + '<h4 class="tl-h">The path of this answer</h4>' + layers +
        (mrows ? '<h4 class="tl-h">Model calls</h4><div class="grid-wrap"><table class="t"><thead><tr><th>Step</th><th>Specialist</th><th>Provider / model</th><th class="n">Time</th><th class="n">Tokens in / out</th><th class="n">Cost</th><th>Then</th></tr></thead><tbody>' + mrows + '</tbody></table></div>' : '') +
        (trows ? '<h4 class="tl-h">Tools</h4><div class="grid-wrap"><table class="t"><thead><tr><th>Tool</th><th>Ran in</th><th>Technology</th><th class="n">Time</th><th></th></tr></thead><tbody>' + trows + '</tbody></table></div>' : '<p class="muted sm">No tools were needed for this answer.</p>') +
        (stack ? '<details class="vmore"><summary>Versions on this PC</summary><div class="sm">AI Hub ' + esc(stack.hub) + ' · Python ' + esc(stack.python) + '<br>' +
            Object.keys(pk).filter(function (k) { return pk[k]; }).map(function (k) { return esc(k) + ' ' + esc(pk[k]); }).join(' · ') + '</div></details>' : '');
};

document.addEventListener('DOMContentLoaded', function () { document.body.classList.toggle('tech-on', TECH.on); var hb = document.getElementById('btn-tech'); if (hb) hb.classList.toggle('on', TECH.on); });
document.body && document.body.classList.toggle('tech-on', TECH.on);
