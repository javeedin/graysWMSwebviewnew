/* Data Loading › Setup Projects › "Setup data" view — what setup really exists in Fusion.
   FSM task status only says what people marked; the setup itself is in the FSM CSV file package:
   one CSV per setup business object (plus ASM_SETUP_CSV_METADATA.xml). This view
     1. starts an export through the FSM REST API (setupOfferingCSVExports for an offering or a
        functional area, setupTaskCSVExports for one task), polls ProcessCompletedFlag, and downloads
        …/enclosure/FileContent through the host (dataLoadFsmDownload — Fusion credentials stay in C#),
        or analyses a ZIP exported by hand from FSM;
     2. counts rows per business object → configured vs empty, per area;
     3. matches objects to the tracked FSM tasks and flags "completed but empty" / "data but not started";
     4. compares two exports (e.g. TEST vs PROD, last month vs today).
   Stored in APEX: WMS_FSM_EXPORTS + WMS_FSM_EXPORT_OBJECTS (apex_sql/71_fsm_tracking.sql). */

var FX = { list: [], sel: null, objs: [], zips: {}, poll: {}, q: '', filter: 'all', cmp: null, cmpObjs: null, preview: null, form: false };
var FX_REST = '/fscmRestApi/resources/11.13.18.05/';
var FX_BASE = { PROD: 'https://efmh.fa.em3.oraclecloud.com', TEST: 'https://efmh-test.fa.em3.oraclecloud.com' };
var FX_AREAS = {
    GL: 'General Ledger', AP: 'Payables', AR: 'Receivables', CE: 'Cash Management', FA: 'Assets', XLE: 'Legal Entities', FUN: 'Financials Common', ZX: 'Tax',
    IBY: 'Payments', XLA: 'Subledger Accounting', XCC: 'Budgetary Control', GCS: 'Consolidation', INV: 'Inventory', EGP: 'Items', EGO: 'Items', PO: 'Purchasing', POZ: 'Suppliers',
    PON: 'Sourcing', POR: 'Requisitions', CST: 'Costing', CMR: 'Receipt Accounting', DOO: 'Order Management', WSH: 'Shipping', RCV: 'Receiving', HZ: 'Trading Community',
    PJF: 'Projects', PJC: 'Project Costing', PJB: 'Project Billing', PER: 'HCM', HR: 'HCM', PAY: 'Payroll', FND: 'Common', ASM: 'Setup Manager', ASE: 'Security', GL_: 'General Ledger'
};
FM_DDL.WMS_FSM_EXPORTS = 'CREATE TABLE wms_fsm_exports (export_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, instance VARCHAR2(10), scope VARCHAR2(20), offering_code VARCHAR2(200), ' +
    'area_code VARCHAR2(200), task_code VARCHAR2(200), process_id VARCHAR2(40), status VARCHAR2(20), file_name VARCHAR2(300), file_path VARCHAR2(500), file_bytes NUMBER, objects NUMBER, ' +
    'objects_with_data NUMBER, total_rows NUMBER, note VARCHAR2(1000), requested_by VARCHAR2(120), requested_date DATE DEFAULT SYSDATE, completed_date DATE)';
FM_DDL.WMS_FSM_EXPORT_OBJECTS = 'CREATE TABLE wms_fsm_export_objects (export_id NUMBER NOT NULL, csv_name VARCHAR2(200) NOT NULL, object_name VARCHAR2(300), description VARCHAR2(1000), ' +
    'area VARCHAR2(60), row_count NUMBER, col_count NUMBER, header VARCHAR2(4000), CONSTRAINT wms_fsm_export_objects_pk PRIMARY KEY (export_id, csv_name))';

function fxBase() { var v = lsGet('fx_base_' + fmInst(), null); return v || FX_BASE[fmInst()] || FX_BASE.PROD; }
function fxRestJson(method, url, body) {
    var action = method === 'POST' ? 'executeOracleFusionPost' : 'executeOracleFusionGet';
    var payload = { fullUrl: url, instance: fmInst() };
    if (body) payload.body = JSON.stringify(body);
    return host(action, payload).then(function (d) {
        var x = d; if (typeof x === 'string') { try { x = JSON.parse(x); } catch (e) { throw 'Fusion replied: ' + String(d).slice(0, 300); } }
        if (x && (x.ReturnStatus === 'Error' || x.status >= 400 || x.title && x['o:errorDetails'])) throw (x.ErrorExplanation || x.title || x.detail || JSON.stringify(x).slice(0, 300));
        return x;
    });
}
/** Find a key anywhere in a REST reply (ProcessId sits in a child collection). */
function fxFind(o, key) {
    if (!o || typeof o !== 'object') return undefined;
    if (key in o && o[key] != null && typeof o[key] !== 'object') return o[key];
    for (var k in o) { var v = fxFind(o[k], key); if (v !== undefined) return v; }
    return undefined;
}

// ── list ───────────────────────────────────────────────────────
function fxLoad() {
    return fmEnsure().then(function () {
        return prRead("SELECT export_id, scope, offering_code, area_code, task_code, process_id, status, file_name, file_path, file_bytes, objects, objects_with_data, total_rows, note, requested_by, " +
            "TO_CHAR(requested_date, 'YYYY-MM-DD HH24:MI') AS requested, TO_CHAR(completed_date, 'YYYY-MM-DD HH24:MI') AS completed FROM wms_fsm_exports WHERE instance = " + prLit(fmInst()) + ' ORDER BY export_id DESC', 300);
    }).then(function (r) {
        FX.list = r.map(function (x) {
            return { id: +x.EXPORT_ID, scope: x.SCOPE, offering: x.OFFERING_CODE || '', area: x.AREA_CODE || '', task: x.TASK_CODE || '', pid: x.PROCESS_ID || '', status: x.STATUS, file: x.FILE_NAME || '',
                path: x.FILE_PATH || '', bytes: +x.FILE_BYTES || 0, objects: +x.OBJECTS || 0, withData: +x.OBJECTS_WITH_DATA || 0, rows: +x.TOTAL_ROWS || 0, note: x.NOTE || '', by: x.REQUESTED_BY, at: x.REQUESTED, done: x.COMPLETED };
        });
        if (FX.sel && !FX.list.some(function (e) { return e.id === FX.sel; })) FX.sel = null;
        if (!FX.sel && !FX.form && FX.list.length) FX.sel = FX.list[0].id;
        if (!FX.list.length) FX.form = true;
        FX.list.forEach(function (e) { if (e.status === 'RUNNING' && e.pid && !FX.poll[e.id]) fxPoll(e); });
        return FX.sel ? fxLoadObjects(FX.sel) : null;
    });
}
function fxLabel(e) { return e.scope === 'UPLOAD' ? (e.file || 'Uploaded ZIP') : e.scope === 'TASK' ? e.task : e.area ? e.offering + ' › ' + e.area : e.offering; }
function fxRenderList() {
    var el = $('fm-list');
    if (!FX.list.length) { el.innerHTML = '<div class="empty">No setup exports yet.<br><small>Start one on the right, or analyse a ZIP from FSM.</small></div>'; return; }
    el.innerHTML = FX.list.map(function (e) {
        var pct = e.objects ? Math.round(e.withData * 100 / e.objects) : 0;
        return '<div class="it fm-it' + (e.id === FX.sel && !FX.form ? ' sel' : '') + '" data-fxid="' + e.id + '"><div class="fm-ring" style="--p:' + pct + '"><span>' + (e.status === 'RUNNING' ? '<i class="fa-solid fa-circle-notch spin"></i>' : pct + '%') + '</span></div>' +
            '<div class="tx"><div class="nm">' + esc(fxLabel(e)) + '</div><div class="fl">' + esc(e.scope) + ' · ' + esc(e.at || '') + '</div>' +
            '<div class="pr-meta">' + (e.status === 'ANALYSED' ? '<span class="chip ok">' + e.withData + '/' + e.objects + ' with data</span>' : e.status === 'RUNNING' ? '<span class="chip gen">exporting…</span>' : '<span class="chip err">' + esc(e.status || '') + '</span>') + '</div></div></div>';
    }).join('');
}
function fxLoadObjects(id) {
    return prRead('SELECT csv_name, object_name, description, area, row_count, col_count, header FROM wms_fsm_export_objects WHERE export_id = ' + prN(id) + ' ORDER BY csv_name', 1000).then(function (r) {
        var o = r.map(function (x) { return { csv: x.CSV_NAME, name: x.OBJECT_NAME || x.CSV_NAME, desc: x.DESCRIPTION || '', area: x.AREA || 'Other', rows: +x.ROW_COUNT || 0, cols: +x.COL_COUNT || 0, header: x.HEADER || '' }; });
        if (id === FX.sel) FX.objs = o;
        return o;
    });
}

// ── render ─────────────────────────────────────────────────────
function fxRender() {
    fxRenderList();
    var main = $('fm-main');
    if (FX.form || !FX.sel) { main.innerHTML = fxFormHtml(); return; }
    var e = FX.list.filter(function (x) { return x.id === FX.sel; })[0]; if (!e) { main.innerHTML = fxFormHtml(); return; }
    if (e.status === 'RUNNING') {
        main.innerHTML = '<div class="welcome"><h2><i class="fa-solid fa-circle-notch spin"></i> Exporting ' + esc(fxLabel(e)) + '</h2><p>Fusion is building the CSV file package (process ' + esc(e.pid) + '). This page checks every 10 seconds and analyses it as soon as it is ready — you can keep working meanwhile.</p>' +
            '<p class="muted" id="fx-pollmsg">' + esc(FX.poll[e.id] && FX.poll[e.id].msg || '') + '</p><button class="btn" data-fx="checknow"><i class="fa-solid fa-rotate"></i> Check now</button></div>';
        return;
    }
    if (e.status !== 'ANALYSED') {
        main.innerHTML = '<div class="welcome"><h2>' + esc(fxLabel(e)) + '</h2><div class="note err"><i class="fa-solid fa-circle-xmark"></i> ' + esc(e.note || e.status) + '</div><p></p><button class="btn" data-fx="new">Start another export</button></div>';
        return;
    }
    main.innerHTML = fxDetailHtml(e);
    fxRenderObjects();
}
function fxFormHtml() {
    var sc = FX.scope || 'OFFERING';
    return '<div class="fm-set"><div class="fm-set-h"><h2><i class="fa-solid fa-box-archive"></i> What setup is really done?</h2>' + (FX.list.length ? '<button class="btn" data-fx="closeform"><i class="fa-solid fa-xmark"></i> Close</button>' : '') + '</div>' +
        '<p class="muted">An FSM task marked <i>Completed</i> only says someone ticked it. The setup itself is in FSM\'s <b>CSV file package</b>: one CSV per setup object (ledgers, journal sources, payment terms…). Export it here — the app counts the rows in each object, shows what is configured and what is empty, and flags tasks marked completed whose setup is empty.</p>' +
        '<div class="fm-role"><h3>1 · Export from Fusion (' + esc(fmInst()) + ')</h3>' +
        '<div class="seg">' + [['OFFERING', 'Whole offering'], ['AREA', 'Functional area'], ['TASK', 'One task']].map(function (s) { return '<button class="' + (sc === s[0] ? 'on' : '') + '" data-fxscope="' + s[0] + '">' + s[1] + '</button>'; }).join('') + '</div>' +
        '<div class="row-f">' + (sc !== 'TASK' ? '<label class="fld"><span>Offering code</span><input id="fx-off" list="fx-offs" value="' + esc(FX.off || '') + '" placeholder="e.g. the Financials offering code"></label>' : '') +
        (sc === 'AREA' ? '<label class="fld"><span>Functional area code</span><input id="fx-area" list="fx-areas" value="' + esc(FX.area || '') + '" placeholder="e.g. ORA_ASK_ORGANIZATION_STRUCTURE"></label>' : '') +
        (sc === 'TASK' ? '<label class="fld"><span>Task code</span><input id="fx-task" list="fx-tasks" value="' + esc(FX.task || '') + '" placeholder="e.g. PAY_MANAGE_FAST_FORMULA"></label>' : '') +
        '<button class="btn" data-fx="codes" title="Look the codes up in FSM\'s own tables through the runner"><i class="fa-solid fa-magnifying-glass"></i> Find codes</button></div>' +
        '<datalist id="fx-offs">' + (FX.codes && FX.codes.OFFERING || []).map(fxOpt).join('') + '</datalist><datalist id="fx-areas">' + (FX.codes && FX.codes.AREA || []).map(fxOpt).join('') + '</datalist>' +
        '<datalist id="fx-tasks">' + (FX.codes && FX.codes.TASK || []).map(fxOpt).join('') + '</datalist>' + (FX.codeNote ? '<p class="muted">' + esc(FX.codeNote) + '</p>' : '') +
        '<details><summary class="muted" style="cursor:pointer">Fusion address</summary><div class="row-f" style="margin-top:6px"><label class="fld grow"><span>Base URL for ' + esc(fmInst()) + '</span><input id="fx-base" value="' + esc(fxBase()) + '"></label></div></details>' +
        '<div class="row-f"><button class="btn primary big" data-fx="start"><i class="fa-solid fa-cloud-arrow-down"></i> Export and analyse</button><span class="muted">Uses the Fusion login already configured in the app; the ZIP is saved under C:\\fusion\\FSM\\' + esc(fmInst()) + '.</span></div></div>' +
        '<div class="fm-role"><h3>2 · Or analyse a ZIP you exported in FSM</h3><p class="muted">Setup and Maintenance › Actions › Export to CSV File, then drop the downloaded ZIP here.</p>' +
        '<label class="drop" id="fx-drop"><input type="file" id="fx-file" accept=".zip" hidden><i class="fa-solid fa-file-zipper"></i><b>Drop the FSM CSV export ZIP here</b><span>or click to choose</span></label></div></div>';
}
function fxOpt(c) { return '<option value="' + esc(c.code) + '">' + esc(c.name || '') + '</option>'; }

function fxDetailHtml(e) {
    var o = FX.objs, withData = o.filter(function (x) { return x.rows > 0; }), empty = o.length - withData.length;
    var areas = {}; o.forEach(function (x) { var a = areas[x.area] = areas[x.area] || { n: 0, d: 0, rows: 0 }; a.n++; if (x.rows) a.d++; a.rows += x.rows; });
    var match = fxMatchTasks(o), flags = o.filter(function (x) { return match[x.csv] && match[x.csv].flag; }).length;
    var h = '<div class="fm-head"><div class="fm-ring big" style="--p:' + (o.length ? Math.round(withData.length * 100 / o.length) : 0) + '"><span>' + (o.length ? Math.round(withData.length * 100 / o.length) : 0) + '%</span></div>' +
        '<div class="grow"><h2>' + esc(fxLabel(e)) + '</h2><div class="muted">' + esc(e.scope) + ' export · ' + esc(e.done || e.at || '') + ' · ' + esc(e.by || '') + (e.bytes ? ' · ' + fmtSize(e.bytes) : '') + (e.pid ? ' · process ' + esc(e.pid) : '') + '</div></div>' +
        (e.path ? '<button class="btn" data-fx="folder"><i class="fa-regular fa-folder-open"></i> ZIP</button>' : '') + '<button class="btn" data-fx="csv"><i class="fa-solid fa-file-csv"></i> Export</button><button class="btn" data-fx="new"><i class="fa-solid fa-plus"></i> New export</button></div>';
    h += '<div class="kpis fm-kpis"><div class="kpi"><b>' + o.length + '</b><span>setup objects</span></div><div class="kpi ok"><b>' + withData.length + '</b><span>configured (have rows)</span></div>' +
        '<div class="kpi"><b>' + empty + '</b><span>empty</span></div><div class="kpi"><b>' + o.reduce(function (a, x) { return a + x.rows; }, 0).toLocaleString() + '</b><span>setup rows</span></div>' +
        '<div class="kpi ' + (flags ? 'err' : '') + '"><b>' + flags + '</b><span>FSM status disagrees</span></div>' +
        '<div class="kpi"><b>' + Object.keys(areas).length + '</b><span>areas</span></div></div>';
    h += '<div class="fm-card"><h3><i class="fa-solid fa-layer-group"></i> By area <span class="muted">— objects with data / all</span></h3><div class="fx-areas">' +
        Object.keys(areas).sort(function (a, b) { return areas[b].n - areas[a].n; }).map(function (k) {
            var a = areas[k];
            return '<div class="fx-area" data-fxarea="' + esc(k) + '"><b>' + esc(k) + '</b><span class="fm-bar"><i class="ok" style="width:' + (a.d * 100 / a.n) + '%"></i></span><small>' + a.d + ' / ' + a.n + ' · ' + a.rows.toLocaleString() + ' rows</small></div>';
        }).join('') + '</div></div>';
    var others = FX.list.filter(function (x) { return x.id !== e.id && x.status === 'ANALYSED'; });
    h += '<div class="fm-filters"><input type="search" id="fx-q" placeholder="Find setup object…" value="' + esc(FX.q) + '">' +
        '<div class="seg sm">' + [['all', 'All'], ['data', 'Configured'], ['empty', 'Empty'], ['flag', 'Status disagrees']].map(function (f) { return '<button class="' + (FX.filter === f[0] ? 'on' : '') + '" data-fxfilter="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div>' +
        (FX.areaSel ? '<span class="chip gen" data-fxarea="' + esc(FX.areaSel) + '" title="Click to clear">' + esc(FX.areaSel) + ' ✕</span>' : '') +
        '<label>Compare with <select id="fx-cmp"><option value="">—</option>' + others.map(function (x) { return '<option value="' + x.id + '"' + (FX.cmp === x.id ? ' selected' : '') + '>' + esc(fxLabel(x) + ' · ' + (x.done || x.at)) + '</option>'; }).join('') + '</select></label></div>';
    h += '<div id="fx-objs"></div><div id="fx-preview"></div>';
    return h;
}
/** FSM tasks (from the Projects view) matched to setup objects by name words. */
function fxWords(s) {
    return String(s || '').toUpperCase().replace(/\.CSV$/, '').replace(/^ORA_/, '').split(/[^A-Z0-9]+/).filter(function (w) {
        return w.length > 2 && !/^(MANAGE|DEFINE|SPECIFY|CONFIGURE|SETUP|SETUPS|THE|AND|FOR|ORA|ASK|CSV|DATA|B|TL|VL)$/.test(w);
    }).map(function (w) { return w.replace(/IES$/, 'Y').replace(/S$/, ''); });
}
function fxMatchTasks(objs) {
    var tasks = (FM.tasks || []), out = {};
    if (!tasks.length) return out;
    var tw = tasks.map(function (t) { return { t: t, w: fxWords(t.name) }; });
    objs.forEach(function (o) {
        var ow = fxWords(o.name + ' ' + o.csv), best = null, bs = 0;
        tw.forEach(function (x) {
            if (!x.w.length) return;
            var hit = x.w.filter(function (w) { return ow.indexOf(w) >= 0; }).length, s = hit / x.w.length;
            if (hit && s > bs) { bs = s; best = x.t; }
        });
        if (best && bs >= 0.6) {
            var flag = /^Completed/.test(best.status) && !o.rows ? 'Marked completed in FSM, but no setup rows' : !o.rows ? '' : best.status === 'Not Started' ? 'Setup rows exist, but the FSM task is Not Started' : '';
            out[o.csv] = { task: best, flag: flag };
        }
    });
    return out;
}
function fxRenderObjects() {
    var el = $('fx-objs'); if (!el) return;
    var match = fxMatchTasks(FX.objs), q = FX.q.toLowerCase(), cmp = {};
    (FX.cmpObjs || []).forEach(function (x) { cmp[x.csv] = x; });
    var list = FX.objs.filter(function (o) {
        if (FX.areaSel && o.area !== FX.areaSel) return false;
        if (FX.filter === 'data' && !o.rows) return false;
        if (FX.filter === 'empty' && o.rows) return false;
        if (FX.filter === 'flag' && !(match[o.csv] && match[o.csv].flag)) return false;
        return !q || (o.name + ' ' + o.csv + ' ' + o.desc).toLowerCase().indexOf(q) >= 0;
    });
    var missing = FX.cmpObjs ? FX.cmpObjs.filter(function (x) { return !FX.objs.some(function (o) { return o.csv === x.csv; }); }) : [];
    el.innerHTML = '<div class="grid-w"><table class="grid fm-t"><thead><tr><th>Setup object</th><th>Area</th><th>Rows</th>' + (FX.cmpObjs ? '<th>Compared</th>' : '') + '<th>Columns</th><th>FSM task</th><th></th></tr></thead><tbody>' +
        list.map(function (o) {
            var m = match[o.csv], c = cmp[o.csv], d = c ? o.rows - c.rows : null;
            return '<tr class="' + (m && m.flag ? 'od' : '') + '"><td><b>' + esc(o.name) + '</b>' + (o.desc ? '<br><small class="muted">' + esc(o.desc) + '</small>' : '') + '<br><small class="muted mono">' + esc(o.csv) + '</small></td>' +
                '<td>' + esc(o.area) + '</td><td>' + (o.rows ? '<span class="fm-chip ok">' + o.rows.toLocaleString() + '</span>' : '<span class="fm-chip ns">empty</span>') + '</td>' +
                (FX.cmpObjs ? '<td>' + (!c ? '<span class="fm-chip ip">only here</span>' : d === 0 ? '<span class="muted">same</span>' : '<b style="color:' + (d > 0 ? 'var(--ok)' : 'var(--err)') + '">' + (d > 0 ? '+' : '') + d + '</b> <small class="muted">(' + c.rows + ')</small>') + '</td>' : '') +
                '<td>' + o.cols + '</td><td>' + (m ? esc(m.task.name) + ' ' + fmChip(m.task.status) + (m.flag ? '<br><em class="fm-late">' + esc(m.flag) + '</em>' : '') : '<span class="muted">—</span>') + '</td>' +
                '<td>' + (o.rows ? '<button class="btn sm" data-fxprev="' + esc(o.csv) + '">Rows</button>' : '') + '</td></tr>';
        }).join('') +
        missing.map(function (x) { return '<tr class="od"><td><b>' + esc(x.name) + '</b><br><small class="muted mono">' + esc(x.csv) + '</small></td><td>' + esc(x.area) + '</td><td><span class="fm-chip er">missing here</span></td><td>' + x.rows + ' in the other export</td><td></td><td></td><td></td></tr>'; }).join('') +
        '</tbody></table></div>' + (list.length ? '' : '<div class="empty">Nothing matches.</div>') +
        (!FM.tasks.length ? '<p class="muted" style="margin-top:6px"><i class="fa-solid fa-circle-info"></i> Read your implementation projects (Projects view) to match setup objects to FSM tasks.</p>' : '');
}

// ── export: start → poll → download → analyse ─────────────────
function fxStart() {
    var sc = FX.scope || 'OFFERING', off = ($('fx-off') || {}).value, area = ($('fx-area') || {}).value, task = ($('fx-task') || {}).value;
    off = (off || '').trim(); area = (area || '').trim(); task = (task || '').trim();
    if (sc !== 'TASK' && !off) { toast('Enter the offering code (use Find codes).'); return; }
    if (sc === 'AREA' && !area) { toast('Enter the functional area code.'); return; }
    if (sc === 'TASK' && !task) { toast('Enter the task code.'); return; }
    var base = (($('fx-base') || {}).value || fxBase()).trim().replace(/\/+$/, '');
    lsSet('fx_base_' + fmInst(), base);
    FX.off = off; FX.area = area; FX.task = task;
    var url = base + FX_REST + (sc === 'TASK' ? 'setupTaskCSVExports' : 'setupOfferingCSVExports');
    var body = sc === 'TASK' ? { TaskCode: task, SetupTaskCSVExportProcess: [{ TaskCode: task }] }
        : sc === 'AREA' ? { OfferingCode: off, FunctionalAreaCode: area, SetupOfferingCSVExportProcess: [{ OfferingCode: off, FunctionalAreaCode: area }] }
            : { OfferingCode: off, SetupOfferingCSVExportProcess: [{ OfferingCode: off }] };
    toast('Starting the export in Fusion…');
    var pid;
    fxRestJson('POST', url, body).then(function (r) {
        pid = fxFind(r, 'ProcessId');
        if (!pid) throw 'Fusion did not return a process id: ' + JSON.stringify(r).slice(0, 300);
        return prWrite('INSERT INTO wms_fsm_exports (instance, scope, offering_code, area_code, task_code, process_id, status, requested_by) VALUES (' + prLit(fmInst()) + ', ' + prV(sc, 20) + ', ' +
            prV(sc === 'TASK' ? '' : off, 200) + ', ' + prV(sc === 'AREA' ? area : '', 200) + ', ' + prV(sc === 'TASK' ? task : '', 200) + ', ' + prV(String(pid), 40) + ", 'RUNNING', " + prV(appUserName(), 120) + ')');
    }).then(function () {
        return prRead('SELECT MAX(export_id) AS id FROM wms_fsm_exports WHERE instance = ' + prLit(fmInst()) + ' AND process_id = ' + prV(String(pid), 40), 1);
    }).then(function (r) {
        FX.sel = +r[0].ID; FX.form = false;
        return fxLoad();
    }).then(function () { fxRender(); })
      .catch(function (e) { toast('Export could not start: ' + e); });
}
function fxUrls(e) {
    var base = fxBase() + FX_REST;
    var root = e.scope === 'TASK' ? base + 'setupTaskCSVExports/' + encodeURIComponent(e.task) + '/child/SetupTaskCSVExportProcess/' + e.pid
        : base + 'setupOfferingCSVExports/' + encodeURIComponent(e.offering) + '/child/SetupOfferingCSVExportProcess/' + e.pid;
    return { status: root, file: root + '/child/' + (e.scope === 'TASK' ? 'SetupTaskCSVExportProcessResult/' : 'SetupOfferingCSVExportProcessResult/') + e.pid + '/enclosure/FileContent' };
}
function fxPoll(e, now) {
    var P = FX.poll[e.id] = FX.poll[e.id] || { tries: 0, msg: '' };
    clearTimeout(P.t);
    P.t = setTimeout(function () {
        P.tries++;
        fxRestJson('GET', fxUrls(e).status).then(function (r) {
            var done = fxFind(r, 'ProcessCompletedFlag');
            P.msg = 'Checked ' + new Date().toLocaleTimeString() + ' — ' + (done === true || done === 'true' ? 'finished, downloading…' : 'still running (' + P.tries + ' checks)');
            var m = $('fx-pollmsg'); if (m) m.textContent = P.msg;
            if (done === true || done === 'true') return fxDownload(e);
            if (P.tries < 360) fxPoll(e);
            else fxFail(e, 'Still not finished after an hour — check the export in FSM.');
        }).catch(function (err) {
            P.msg = 'Status check failed: ' + err; var m = $('fx-pollmsg'); if (m) m.textContent = P.msg;
            if (P.tries < 360) fxPoll(e);
        });
    }, now ? 50 : 10000);
}
function fxDownload(e) {
    var name = (e.scope === 'TASK' ? e.task : e.offering + (e.area ? '_' + e.area : '')) + '_' + e.pid;
    return host('dataLoadFsmDownload', { url: fxUrls(e).file, instance: fmInst(), name: name }).then(function (d) {
        if (!d.ok) throw d.error || 'download failed';
        e.path = d.path; e.bytes = d.size; e.file = name + '.zip';
        return fxAnalyseZip(e.id, fxB64ToBytes(d.base64), e.file, d.path);
    }).catch(function (err) { fxFail(e, 'Download failed: ' + err); });
}
function fxFail(e, msg) {
    delete FX.poll[e.id];
    return prWrite("UPDATE wms_fsm_exports SET status = 'FAILED', note = " + prV(msg, 1000) + ', completed_date = SYSDATE WHERE export_id = ' + prN(e.id))
        .then(fxLoad).then(fxRenderIfShown).catch(function () { });
}
function fxRenderIfShown() { if (FM.view === 'exports' && !$('page-fsm').hidden) fxRender(); }
function fxB64ToBytes(b64) { var s = atob(b64), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }

/** Count records in CSV text (quotes may hold commas and line breaks). */
function fxCsv(text, maxRows) {
    var rows = [], row = [], f = '', q = false, i = 0, n = text.length, count = 0;
    if (text.charCodeAt(0) === 0xFEFF) i = 1;
    for (; i < n; i++) {
        var ch = text[i];
        if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
        if (ch === '"') { q = true; continue; }
        if (ch === ',') { row.push(f); f = ''; continue; }
        if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(f); f = '';
            if (row.length > 1 || row[0] !== '') { count++; if (rows.length < maxRows) rows.push(row); }
            row = []; continue;
        }
        f += ch;
    }
    if (f !== '' || row.length) { row.push(f); if (row.length > 1 || row[0] !== '') { count++; if (rows.length < maxRows) rows.push(row); } }
    return { count: count, rows: rows };
}
function fxArea(csv) {
    var t = String(csv).toUpperCase().replace(/\.CSV$/, '').split('_');
    var code = t[0] === 'ORA' ? t[1] : t[0];
    return FX_AREAS[code] || code || 'Other';
}
/** ASM_SETUP_CSV_METADATA.xml → { CSVBASE: { name, desc } } (structure varies — look for the CSV name and its siblings). */
function fxMeta(xmlText) {
    var out = {};
    try {
        var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
        var all = doc.getElementsByTagName('*');
        for (var i = 0; i < all.length; i++) {
            var el = all[i]; if (el.children.length) continue;
            var t = (el.textContent || '').trim(); if (!t || t.length > 200) continue;
            var base = t.replace(/\.csv$/i, '').toUpperCase();
            if (!/^[A-Z0-9_]{4,}$/.test(base)) continue;
            var p = el.parentNode, name = '', desc = '';
            for (var j = 0; j < p.children.length; j++) {
                var s = p.children[j], tag = s.tagName.replace(/^.*:/, ''), v = (s.textContent || '').trim();
                if (!v || s === el || s.children.length) continue;
                if (!name && /(^|_)(Name|DisplayName|ObjectName|BusinessObjectName)$/i.test(tag) && !/Short/i.test(tag)) name = v;
                if (!desc && /Description/i.test(tag)) desc = v;
            }
            if ((name || desc) && !out[base]) out[base] = { name: name, desc: desc };
        }
    } catch (e) { }
    return out;
}
/** Analyse a CSV file package and store it. id = existing export row, or null to create an UPLOAD row. */
function fxAnalyseZip(id, bytes, fileName, path) {
    if (!window.JSZip) { toast('The ZIP library did not load — check the internet connection.'); return Promise.resolve(); }
    var objs = [], zipObj;
    return JSZip.loadAsync(bytes).then(function (zip) {
        zipObj = zip;
        var names = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir; });
        var metaName = names.filter(function (n) { return /ASM_SETUP_CSV_METADATA\.xml$/i.test(n); })[0];
        var metaP = metaName ? zip.file(metaName).async('string').then(fxMeta) : Promise.resolve({});
        return metaP.then(function (meta) {
            var csvs = names.filter(function (n) { return /\.csv$/i.test(n); });
            if (!csvs.length) throw 'No CSV files in ' + fileName + ' — is it an FSM CSV export?';
            return prSeq(csvs, function (n) {
                return zip.file(n).async('string').then(function (text) {
                    var parsed = fxCsv(text, 1), base = n.replace(/^.*\//, '').replace(/\.csv$/i, ''), m = meta[base.toUpperCase()] || {};
                    var header = parsed.rows[0] || [];
                    objs.push({ csv: n.replace(/^.*\//, ''), name: m.name || fxPretty(base), desc: m.desc || '', area: fxArea(base), rows: Math.max(0, parsed.count - 1), cols: header.length, header: header.join(', ').slice(0, 3900) });
                });
            });
        });
    }).then(function () {
        if (id) return id;
        return prWrite("INSERT INTO wms_fsm_exports (instance, scope, status, file_name, requested_by) VALUES (" + prLit(fmInst()) + ", 'UPLOAD', 'RUNNING', " + prV(fileName, 300) + ', ' + prV(appUserName(), 120) + ')')
            .then(function () { return prRead("SELECT MAX(export_id) AS id FROM wms_fsm_exports WHERE instance = " + prLit(fmInst()) + " AND scope = 'UPLOAD'", 1); })
            .then(function (r) { return +r[0].ID; });
    }).then(function (eid) {
        id = eid; FX.zips[id] = zipObj;
        var sels = objs.map(function (o) {
            return 'SELECT ' + prN(id) + ', ' + prV(o.csv, 200) + ', ' + prV(o.name, 300) + ', ' + prV(o.desc, 1000) + ', ' + prV(o.area, 60) + ', ' + o.rows + ', ' + o.cols + ', ' + prV(o.header, 4000) + ' FROM dual';
        });
        return prWrite('DELETE FROM wms_fsm_export_objects WHERE export_id = ' + prN(id))
            .then(function () { return prSeq(prBatches(sels), function (b) { return prWrite('INSERT INTO wms_fsm_export_objects (export_id, csv_name, object_name, description, area, row_count, col_count, header) ' + b.join(' UNION ALL ')); }); })
            .then(function () {
                var wd = objs.filter(function (o) { return o.rows; }).length, tot = objs.reduce(function (a, o) { return a + o.rows; }, 0);
                return prWrite("UPDATE wms_fsm_exports SET status = 'ANALYSED', objects = " + objs.length + ', objects_with_data = ' + wd + ', total_rows = ' + tot + ', file_name = ' + prV(fileName, 300) +
                    ', file_path = ' + prV(path || '', 500) + ', file_bytes = ' + prN(bytes.length) + ', completed_date = SYSDATE WHERE export_id = ' + prN(id));
            });
    }).then(function () {
        delete FX.poll[id];
        FX.sel = id; FX.form = false; FX.cmp = null; FX.cmpObjs = null; FX.areaSel = null;
        toast(objs.length + ' setup objects analysed — ' + objs.filter(function (o) { return o.rows; }).length + ' have data');
        return fxLoad();
    }).then(fxRenderIfShown).catch(function (e) { toast('Could not analyse the ZIP: ' + e); });
}
function fxPretty(base) {
    return String(base).replace(/^ORA_/, '').split('_').filter(Boolean).map(function (w) { return FX_AREAS[w.toUpperCase()] ? w.toUpperCase() : w.charAt(0) + w.slice(1).toLowerCase(); }).join(' ');
}
function fxPreview(csv) {
    var box = $('fx-preview'), e = FX.list.filter(function (x) { return x.id === FX.sel; })[0];
    var getZip = FX.zips[FX.sel] ? Promise.resolve(FX.zips[FX.sel]) : e && e.path
        ? host('dataLoadFsmReadFile', { path: e.path }).then(function (d) { if (!d.ok) throw d.error; return JSZip.loadAsync(fxB64ToBytes(d.base64)); }).then(function (z) { FX.zips[FX.sel] = z; return z; })
        : Promise.reject('The ZIP of this export is not on this PC — analyse it again to see its rows.');
    box.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch spin"></i> Opening ' + esc(csv) + '…</div>';
    getZip.then(function (zip) {
        var f = Object.keys(zip.files).filter(function (n) { return n.replace(/^.*\//, '') === csv; })[0];
        if (!f) throw csv + ' is not in the ZIP';
        return zip.file(f).async('string');
    }).then(function (text) {
        var p = fxCsv(text, 51), head = p.rows[0] || [], rows = p.rows.slice(1);
        box.innerHTML = '<div class="fm-card" style="margin-top:12px"><h3><i class="fa-solid fa-table"></i> ' + esc(csv) + ' <span class="muted">— ' + (p.count - 1) + ' rows' + (p.count > 51 ? ', first 50 shown' : '') + '</span></h3>' +
            '<div class="grid-w"><table class="grid"><thead><tr>' + head.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
            rows.map(function (r) { return '<tr>' + head.map(function (_, i) { return '<td>' + esc(r[i] == null ? '' : r[i]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div></div>';
        box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }).catch(function (err) { box.innerHTML = '<div class="note warn"><i class="fa-solid fa-circle-info"></i> ' + esc(String(err)) + '</div>'; });
}
/** Offering / functional area / task codes from FSM's own tables (column names differ by release). */
function fxFindCodes() {
    var sc = FX.scope || 'OFFERING';
    var want = sc === 'TASK' ? { code: ['TASK_CODE', 'TASK_SHORT_NAME'], name: ['TASK_NAME', 'NAME'] }
        : { code: ['OFFERING_CODE', 'OFFERING_SHORT_NAME'], name: ['OFFERING_NAME', 'NAME'] };
    var areaWant = { code: ['FUNCTIONAL_AREA_CODE', 'BUSINESS_PROCESS_CODE', 'FUNC_AREA_CODE'], name: ['FUNCTIONAL_AREA_NAME', 'BUSINESS_PROCESS_NAME', 'NAME'] };
    FX.codeNote = 'Looking the codes up in FSM…'; fxRender();
    function lookup(w) {
        return prFusion("SELECT table_name, column_name FROM all_tab_columns WHERE table_name LIKE 'ASM\\_%' ESCAPE '\\' AND column_name IN (" + w.code.concat(w.name).map(prLit).join(',') + ')', 5000).then(function (r) {
            var by = {};
            (r.rows || []).forEach(function (x) { (by[x.TABLE_NAME] = by[x.TABLE_NAME] || []).push(x.COLUMN_NAME); });
            var cands = Object.keys(by).map(function (t) {
                var code = w.code.filter(function (c) { return by[t].indexOf(c) >= 0; })[0], name = w.name.filter(function (c) { return by[t].indexOf(c) >= 0; })[0];
                return { t: t, code: code, name: name, s: (code ? 2 : 0) + (name ? 1 : 0) + (/_VL$/.test(t) ? 1 : 0) - (/_TL$|_B$/.test(t) ? 0.5 : 0) };
            }).filter(function (x) { return x.code; }).sort(function (a, b) { return b.s - a.s; });
            if (!cands.length) return { list: [], from: null };
            var c = cands[0];
            return prFusion('SELECT DISTINCT ' + c.code + ' AS code' + (c.name ? ', ' + c.name + ' AS name' : '') + ' FROM ' + c.t + ' ORDER BY 1', 5000).then(function (x) {
                return { list: (x.rows || []).map(function (y) { return { code: y.CODE, name: y.NAME || '' }; }).filter(function (y) { return y.code; }), from: c.t };
            });
        });
    }
    var jobs = [lookup(want)]; if (sc === 'AREA') jobs.push(lookup(areaWant));
    Promise.all(jobs).then(function (res) {
        FX.codes = FX.codes || {};
        FX.codes[sc === 'TASK' ? 'TASK' : 'OFFERING'] = res[0].list;
        if (res[1]) FX.codes.AREA = res[1].list;
        FX.codeNote = res.map(function (x, i) { return x.from ? x.list.length + (i ? ' functional areas' : sc === 'TASK' ? ' tasks' : ' offerings') + ' from ' + x.from + ' — pick one in the field' : 'No code table found' + (i ? ' for functional areas' : '') + ' — type the code from FSM'; }).join(' · ');
        fxRender();
    }).catch(function (e) { FX.codeNote = 'Could not look codes up: ' + e; fxRender(); });
}
function fxExportCsv() {
    var e = FX.list.filter(function (x) { return x.id === FX.sel; })[0]; if (!e) return;
    var match = fxMatchTasks(FX.objs), rows = [['Setup object', 'CSV', 'Area', 'Rows', 'Columns', 'Status', 'FSM task', 'FSM status', 'Flag']];
    FX.objs.forEach(function (o) { var m = match[o.csv]; rows.push([o.name, o.csv, o.area, o.rows, o.cols, o.rows ? 'Configured' : 'Empty', m ? m.task.name : '', m ? m.task.status : '', m ? m.flag : '']); });
    var csv = '\ufeff' + rows.map(function (r) { return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
    prDownload(new Blob([csv], { type: 'text/csv' }), 'FSM_setup_' + fxLabel(e).replace(/[^\w]+/g, '_') + '_' + prStamp() + '.csv');
}

// ── events ─────────────────────────────────────────────────────
(function fxWire() {
    if (!$('page-fsm')) return;
    var main = $('fm-main');
    $('fm-list').addEventListener('click', function (e) {
        var it = e.target.closest('[data-fxid]'); if (!it) return;
        e.stopPropagation();
        FX.sel = +it.getAttribute('data-fxid'); FX.form = false; FX.cmp = null; FX.cmpObjs = null; FX.areaSel = null; FX.preview = null;
        fxLoadObjects(FX.sel).then(fxRender);
    }, true);
    main.addEventListener('click', function (e) {
        if (FM.view !== 'exports') return;
        var b;
        if ((b = e.target.closest('[data-fxscope]'))) { FX.scope = b.getAttribute('data-fxscope'); fxRender(); return; }
        if ((b = e.target.closest('[data-fxfilter]'))) { FX.filter = b.getAttribute('data-fxfilter'); fxRender(); return; }
        if ((b = e.target.closest('[data-fxarea]'))) { var a = b.getAttribute('data-fxarea'); FX.areaSel = FX.areaSel === a ? null : a; fxRender(); return; }
        if ((b = e.target.closest('[data-fxprev]'))) { fxPreview(b.getAttribute('data-fxprev')); return; }
        if (!(b = e.target.closest('[data-fx]'))) return;
        var act = b.getAttribute('data-fx'), cur = FX.list.filter(function (x) { return x.id === FX.sel; })[0];
        if (act === 'start') fxStart();
        else if (act === 'codes') fxFindCodes();
        else if (act === 'new') { FX.form = true; fxRender(); }
        else if (act === 'closeform') { FX.form = false; fxRender(); }
        else if (act === 'checknow' && cur) fxPoll(cur, true);
        else if (act === 'folder' && cur) host('dataLoadFsmOpenFolder', { path: cur.path, instance: fmInst() });
        else if (act === 'csv') fxExportCsv();
    });
    main.addEventListener('input', function (e) {
        if (FM.view !== 'exports') return;
        if (e.target.id === 'fx-q') { FX.q = e.target.value.trim(); fxRenderObjects(); }
        if (e.target.id === 'fx-off') FX.off = e.target.value;
        if (e.target.id === 'fx-area') FX.area = e.target.value;
        if (e.target.id === 'fx-task') FX.task = e.target.value;
    });
    main.addEventListener('change', function (e) {
        if (FM.view !== 'exports') return;
        var t = e.target;
        if (t.id === 'fx-file' && t.files[0]) { var f = t.files[0]; f.arrayBuffer().then(function (buf) { toast('Analysing ' + f.name + '…'); return fxAnalyseZip(null, new Uint8Array(buf), f.name, ''); }); }
        if (t.id === 'fx-cmp') {
            FX.cmp = t.value ? +t.value : null; FX.cmpObjs = null;
            if (FX.cmp) prRead('SELECT csv_name, object_name, area, row_count FROM wms_fsm_export_objects WHERE export_id = ' + prN(FX.cmp), 1000).then(function (r) {
                FX.cmpObjs = r.map(function (x) { return { csv: x.CSV_NAME, name: x.OBJECT_NAME || x.CSV_NAME, area: x.AREA || '', rows: +x.ROW_COUNT || 0 }; });
                fxRenderObjects();
            }); else fxRenderObjects();
        }
    });
    main.addEventListener('dragover', function (e) { var d = e.target.closest('#fx-drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
    main.addEventListener('dragleave', function (e) { var d = e.target.closest('#fx-drop'); if (d) d.classList.remove('over'); });
    main.addEventListener('drop', function (e) {
        var d = e.target.closest('#fx-drop'); if (!d) return;
        e.preventDefault(); d.classList.remove('over');
        var f = e.dataTransfer.files[0]; if (f) f.arrayBuffer().then(function (buf) { toast('Analysing ' + f.name + '…'); return fxAnalyseZip(null, new Uint8Array(buf), f.name, ''); });
    });
})();
