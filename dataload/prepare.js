/* Data Loading — "Prepare & Load" tab.
   A load = one FBDI template filled from real data: Source → Map → Check → Generate (+ History).
   Everything is stored in APEX (apex_sql/70_fbdi_loads.sql — the page creates the tables):
     WMS_FBDI_LOADS (definition), WMS_FBDI_LOAD_MAPS (column mappings), WMS_FBDI_LOAD_ROWS (staged
     file/paste rows), WMS_FBDI_LOAD_RUNS (each check / generate), WMS_FBDI_RUN_FILES (the CSVs of
     every ZIP, so any ZIP can be rebuilt later).
   Transport: ai/executequery + ai/executewrite through the host's executePost relay (one statement
   per call); live Fusion checks through the Fusion SQL runner (fusionSqlExecute, read-only). */

var PR_APEX = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';
var PR_PIECE = 1300, PR_BATCH_CHARS = 140000, PR_PREVIEW = 200, PR_FILE_CHUNK = 90000;

var P = {
    state: 'idle', error: null, list: [], q: '', selId: null, load: null, src: null, srcDirty: false, dirty: false,
    step: 'source', mapCsv: null, mapFilter: 'req', mapQ: '', wb: null, check: null, runs: null, busy: null, focusInput: null
};

// ── APEX + Fusion transport ────────────────────────────────────
function prApex(path, payload) {
    return host('executePost', { fullUrl: PR_APEX + path, body: JSON.stringify(Object.assign({ appUser: appUserName() }, payload)) }).then(function (data) {
        var d = data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { throw 'Unexpected response from the database API: ' + String(data).slice(0, 200); } }
        if (!d || d.success === false || d.ReturnStatus === 'Error') throw (d && (d.error || d.ErrorExplanation)) || 'Database API error';
        return d;
    });
}
function prRead(sql, maxRows) {
    return prApex('/executequery', { sql: sql, maxRows: Math.min(maxRows || 500, 1000) }).then(function (d) {
        var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
        return (d.rows || []).map(function (r) {
            if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; }
            var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x;
        });
    });
}
function prWrite(sql) { return prApex('/executewrite', { sql: sql }); }
function prSeq(list, fn) { return list.reduce(function (p, x, i) { return p.then(function () { return fn(x, i); }); }, Promise.resolve()); }
function prLit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function prV(s, max) { s = String(s == null ? '' : s).slice(0, max || 4000); return s ? prLit(s) : 'NULL'; }
function prN(n) { return n == null || n === '' || isNaN(n) ? 'NULL' : String(+n); }
function prClob(s) {
    s = String(s == null ? '' : s);
    if (!s) return 'EMPTY_CLOB()';
    var parts = [];
    for (var i = 0; i < s.length; i += PR_PIECE) parts.push('TO_CLOB(' + prLit(s.slice(i, i + PR_PIECE)) + ')');
    return parts.join(' || ');
}
/** Select list that reads a CLOB in n pieces: col_0 … col_n-1. (No DBMS_LOB — the APEX gateways refuse DBMS_/UTL_.) */
function prPieces(col, n, from) {
    var a = [];
    for (var i = 0; i < n; i++) a.push('TO_CHAR(SUBSTR(' + col + ', ' + ((from || 1) + i * PR_PIECE) + ', ' + PR_PIECE + ')) AS ' + col + '_' + i);
    return a.join(', ');
}
function prJoin(row, col, n) { var s = ''; for (var i = 0; i < n; i++) s += row[(col + '_' + i).toUpperCase()] || ''; return s; }
/** Read one CLOB fully (loops 12 pieces at a time). */
function prReadClob(table, col, where) {
    return prRead('SELECT NVL(LENGTH(' + col + '), 0) AS len FROM ' + table + ' WHERE ' + where, 1).then(function (r) {
        var len = r.length ? +r[0].LEN : 0, out = '', offs = [];
        for (var o = 1; o <= len; o += PR_PIECE * 12) offs.push(o);
        return prSeq(offs, function (o) {
            return prRead('SELECT ' + prPieces(col, 12, o) + ' FROM ' + table + ' WHERE ' + where, 1).then(function (x) { out += prJoin(x[0] || {}, col, 12); });
        }).then(function () { return out; });
    });
}
function prFusion(sql, rowLimit) {
    return host('fusionSqlExecute', { sql: sql, rowLimit: rowLimit || 20000 }).then(function (r) {
        if (!r || !r.success) throw (r && r.error) || 'Query failed';
        return r;
    });
}

var PR_DDL = {
    WMS_FBDI_LOADS: "CREATE TABLE wms_fbdi_loads (load_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, load_name VARCHAR2(200) NOT NULL, template_file VARCHAR2(100) NOT NULL, " +
        "description VARCHAR2(1000), source_type VARCHAR2(20) DEFAULT 'FILE', source_sql CLOB, source_note VARCHAR2(400), source_cols CLOB, options_json CLOB, " +
        "instance VARCHAR2(10) DEFAULT 'PROD', status VARCHAR2(20) DEFAULT 'DRAFT', row_count NUMBER, last_run_id NUMBER, last_run_status VARCHAR2(20), last_run_date DATE, " +
        'created_by VARCHAR2(120), created_date DATE DEFAULT SYSDATE, updated_by VARCHAR2(120), updated_date DATE DEFAULT SYSDATE)',
    WMS_FBDI_LOAD_MAPS: 'CREATE TABLE wms_fbdi_load_maps (load_id NUMBER NOT NULL, sheet_csv VARCHAR2(60) NOT NULL, col_pos NUMBER NOT NULL, col_label VARCHAR2(200), ' +
        'db_column VARCHAR2(60), map_expr VARCHAR2(4000), updated_date DATE DEFAULT SYSDATE, CONSTRAINT wms_fbdi_load_maps_pk PRIMARY KEY (load_id, sheet_csv, col_pos))',
    WMS_FBDI_LOAD_ROWS: 'CREATE TABLE wms_fbdi_load_rows (load_id NUMBER NOT NULL, row_no NUMBER NOT NULL, row_data CLOB, CONSTRAINT wms_fbdi_load_rows_pk PRIMARY KEY (load_id, row_no))',
    WMS_FBDI_LOAD_RUNS: 'CREATE TABLE wms_fbdi_load_runs (run_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, load_id NUMBER NOT NULL, template_file VARCHAR2(100), release VARCHAR2(5), ' +
        'run_type VARCHAR2(20), status VARCHAR2(20), source_rows NUMBER, output_rows NUMBER, error_count NUMBER, warning_count NUMBER, zip_name VARCHAR2(200), zip_bytes NUMBER, ' +
        'summary_json CLOB, fusion_request_id NUMBER, fusion_status VARCHAR2(30), run_by VARCHAR2(120), run_date DATE DEFAULT SYSDATE)',
    WMS_FBDI_RUN_FILES: 'CREATE TABLE wms_fbdi_run_files (run_id NUMBER NOT NULL, csv_name VARCHAR2(100) NOT NULL, row_count NUMBER, byte_count NUMBER, content CLOB, ' +
        'CONSTRAINT wms_fbdi_run_files_pk PRIMARY KEY (run_id, csv_name))'
};
var _prEnsured = null;
function prEnsureTables() {
    if (_prEnsured) return _prEnsured;
    _prEnsured = prRead("SELECT table_name FROM user_tables WHERE table_name LIKE 'WMS\\_FBDI%' ESCAPE '\\'", 20).then(function (r) {
        var have = {}; r.forEach(function (x) { have[x.TABLE_NAME] = 1; });
        var todo = Object.keys(PR_DDL).filter(function (t) { return !have[t]; });
        if (todo.length) toast('Creating the data loading tables in APEX…');
        return prSeq(todo, function (t) { return prWrite(PR_DDL[t]); });
    }).catch(function (e) { _prEnsured = null; throw e; });
    return _prEnsured;
}

// ── helpers ────────────────────────────────────────────────────
function prSpec(tpl) { return window.FBDI_SPECS && FBDI_SPECS[tpl]; }
function prRules(tpl) { return typeof fbdiRules === 'function' ? fbdiRules(tpl) : (window.FBDI_RULES && FBDI_RULES[tpl]) || {}; }
function prTplName(tpl) { var t = tplByFile(tpl); return t ? t.n : tpl; }
function prNorm(s) { return String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); }
function prAgo(s) {
    if (!s) return '';
    var d = new Date(String(s).replace(' ', 'T')); if (isNaN(d)) return s;
    var m = Math.round((Date.now() - d) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
}
function prStatusChip(st) {
    var m = { DRAFT: ['draft', 'Draft'], CHECKED: ['ok', 'Checked'], GENERATED: ['gen', 'ZIP ready'], PASSED: ['ok', 'Passed'], WARNINGS: ['warn', 'Warnings'], FAILED: ['err', 'Errors'] }[st] || ['draft', st || 'Draft'];
    return '<span class="chip ' + m[0] + '">' + esc(m[1]) + '</span>';
}
function prSetBusy(msg) { P.busy = msg; var b = $('pr-busy'); if (b) { b.hidden = !msg; b.querySelector('span').textContent = msg || ''; } }
function prSig() {       // what the last check was run on — anything changed makes it stale
    var L = P.load; if (!L || !P.src) return '';
    return JSON.stringify([L.maps, L.options.docKey, L.options.sheets, P.src.rows.length, P.src.cols, P.srcVer || 0]);
}
function prDefaultOptions(tpl) {
    var R = prRules(tpl), sheets = {};
    (prSpec(tpl).sheets || []).forEach(function (s) {
        var d = (R.sheets || {})[s.csv] || {};
        sheets[s.csv] = { include: d.include !== false, mode: d.mode || 'row' };
    });
    return { docKey: '', sheets: sheets, dateOrder: 'dmy', live: true };
}
/** Saved options on top of the template defaults — per sheet, and only the sheets this template has. */
function prMergeOptions(tpl, json) {
    var def = prDefaultOptions(tpl), saved = {};
    try { saved = JSON.parse(json || '{}') || {}; } catch (e) { }
    var out = Object.assign({}, def, saved);
    out.sheets = {};
    Object.keys(def.sheets).forEach(function (csv) { out.sheets[csv] = Object.assign({}, def.sheets[csv], (saved.sheets || {})[csv] || {}); });
    return out;
}
function prSheetOpt(csv) { var o = P.load.options.sheets; return (o[csv] = o[csv] || { include: true, mode: 'row' }); }
function prDefaultMaps(tpl) {
    var spec = prSpec(tpl), pre = prRules(tpl).presets || {}, maps = {};
    spec.sheets.forEach(function (s) {
        maps[s.csv] = {};
        Object.keys(pre[s.csv] || {}).forEach(function (k) {
            var i = FE.colIndex(s, k); if (i >= 0) maps[s.csv][i + 1] = pre[s.csv][k];
        });
    });
    return maps;
}

// ── list ───────────────────────────────────────────────────────
function prOpenTab() {
    if (P.state === 'idle') prLoadList();
    else { prRenderList(); prRenderMain(); }
}
function prLoadList(selectId) {
    if (!hasHost()) { P.state = 'offline'; P.error = 'Open this page inside the Gray\'s WMS app — loads are stored in APEX.'; prRenderList(); prRenderMain(); return Promise.resolve(); }
    P.state = P.state === 'ready' ? 'ready' : 'loading'; prRenderList();
    return prEnsureTables().then(function () {
        return prRead("SELECT load_id, load_name, template_file, source_type, status, row_count, last_run_status, TO_CHAR(last_run_date, 'YYYY-MM-DD HH24:MI') AS last_run, " +
            "updated_by, TO_CHAR(updated_date, 'YYYY-MM-DD HH24:MI') AS updated FROM wms_fbdi_loads ORDER BY updated_date DESC", 500);
    }).then(function (rows) {
        P.state = 'ready'; P.error = null;
        P.list = rows.map(function (r) {
            return { id: +r.LOAD_ID, name: r.LOAD_NAME, tpl: r.TEMPLATE_FILE, srcType: r.SOURCE_TYPE, status: r.STATUS, rows: r.ROW_COUNT, lastStatus: r.LAST_RUN_STATUS, lastRun: r.LAST_RUN, by: r.UPDATED_BY, updated: r.UPDATED };
        });
        prRenderList();
        var want = selectId || P.selId || lsGet('pr_sel', null);
        if (want && P.list.some(function (l) { return l.id === +want; })) { if (!P.load || P.load.id !== +want) return prSelect(+want); prRenderMain(); }
        else prRenderMain();
    }).catch(function (e) { P.state = 'offline'; P.error = String(e); prRenderList(); prRenderMain(); });
}
function prRefresh() {
    var b = $('pr-refresh'); if (b) b.classList.add('spinning');
    var keep = P.selId;
    return prLoadList().then(function () {
        if (b) b.classList.remove('spinning');
        if (keep && !(P.dirty || P.srcDirty) && P.list.some(function (l) { return l.id === keep; })) { P.selId = null; return prSelect(keep); }
    });
}
function prRenderList() {
    var el = $('pr-list'); if (!el) return;
    if (P.state === 'loading') { el.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch spin"></i> Loading…</div>'; return; }
    if (P.state === 'offline') { el.innerHTML = '<div class="empty">Loads are unavailable.<br><small>' + esc(P.error || '') + '</small></div>'; return; }
    var q = P.q.toLowerCase();
    var vis = P.list.filter(function (l) { return !q || (l.name + ' ' + prTplName(l.tpl)).toLowerCase().indexOf(q) >= 0; });
    if (!vis.length) { el.innerHTML = '<div class="empty">' + (P.list.length ? 'No load matches.' : 'No loads yet.<br><small>Click <b>New load</b> to fill a template with real data.</small>') + '</div>'; return; }
    el.innerHTML = vis.map(function (l) {
        var R = prRules(l.tpl);
        return '<div class="it pr-it' + (l.id === P.selId ? ' sel' : '') + '" data-id="' + l.id + '"><i class="fa-solid ' + (R.icon || 'fa-file-excel') + ' pr-ic"></i>' +
            '<div class="tx"><div class="nm">' + esc(l.name) + '</div><div class="fl">' + esc(prTplName(l.tpl)) + (l.rows != null ? ' · ' + l.rows + ' rows' : '') + '</div>' +
            '<div class="pr-meta">' + prStatusChip(l.lastStatus || l.status) + '<span>' + esc(prAgo(l.lastRun || l.updated)) + '</span>' + (l.by ? '<span>· ' + esc(l.by) + '</span>' : '') + '</div></div>' +
            '<button class="pr-del" data-del="' + l.id + '" title="Delete this load from APEX"><i class="fa-regular fa-trash-can"></i></button></div>';
    }).join('');
}

// ── new / open / save ──────────────────────────────────────────
/** Every FBDI template, grouped by area and searchable (names, sheets, columns). Templates whose Oracle macro
    builds something other than one CSV per sheet are listed with the reason and cannot be picked. */
function prSupported() { return FBDI_TEMPLATES.filter(function (t) { return fbdiSupported(t.f); }).map(function (t) { return t.f; }); }
function prTplPicker(name, sel) {
    var areas = {}, order = [];
    FBDI_AREAS.forEach(function (a) { areas[a[0]] = { name: a[1], color: a[2], list: [] }; order.push(a[0]); });
    FBDI_TEMPLATES.forEach(function (t) {
        if (!areas[t.a]) { areas[t.a] = { name: t.a, color: '#64748b', list: [] }; order.push(t.a); }
        areas[t.a].list.push(t);
    });
    var nOk = prSupported().length, nFull = Object.keys(FBDI_RULES).length;
    var h = '<div class="tp-top"><div class="pr-search tp-q"><i class="fa-solid fa-magnifying-glass"></i><input type="search" data-tpq="' + name + '" placeholder="Search ' + FBDI_TEMPLATES.length + ' templates, sheets or columns…  e.g. supplier, PO_LINES, Item Number" autocomplete="off"></div>' +
        '<small class="muted">' + nOk + ' ready · ' + nFull + ' with Fusion checks · ' + (FBDI_TEMPLATES.length - nOk) + ' not yet</small></div><div class="tp-list" data-tplist="' + name + '">';
    order.forEach(function (k) {
        var A = areas[k]; if (!A.list.length) return;
        h += '<div class="tp-area" style="--ac:' + A.color + '"><div class="tp-ah">' + esc(A.name) + ' <small>' + A.list.length + '</small></div>';
        A.list.forEach(function (t) {
            var ix = FBDI_SPEC_INDEX[t.f] || { ok: 0, why: 'not in this version of the app' }, full = !!FBDI_RULES[t.f], R = prRules(t.f);
            var words = (t.n + ' ' + t.f + ' ' + (t.d || '') + ' ' + (t.t || []).map(function (x) { return x.n + ' ' + (x.c || []).join(' '); }).join(' ')).toLowerCase();
            h += '<label class="tp-row' + (ix.ok ? '' : ' no') + (t.f === sel ? ' on' : '') + '" data-words="' + esc(words) + '"' + (ix.ok ? '' : ' title="' + esc(ix.why) + '"') + '>' +
                '<input type="radio" name="' + name + '" value="' + t.f + '"' + (t.f === sel ? ' checked' : '') + (ix.ok ? '' : ' disabled') + '>' +
                '<i class="fa-solid ' + (R.icon || 'fa-file-excel') + '"></i><span class="tp-n"><b>' + esc(t.n) + '</b><small>' + esc(t.d || '') + '</small></span>' +
                (ix.ok ? '<span class="tp-m">' + ix.sheets + ' sheet' + (ix.sheets === 1 ? '' : 's') + ' · ' + ix.cols + ' cols</span>' +
                    (full ? '<span class="tp-b full" title="Hand-written rules: auto-map synonyms, balancing and totals, live lookups in Fusion">Fusion checks</span>'
                          : '<span class="tp-b" title="Required, type and length checks from the template; sheet links worked out from the key columns the sheets share">Template checks</span>')
                    : '<span class="tp-b no"><i class="fa-solid fa-ban"></i> Not yet — ' + esc(ix.why) + '</span>') + '</label>';
        });
        h += '</div>';
    });
    return h + '<div class="tp-none muted" hidden>No template matches.</div></div>';
}
function prTplPickerWire(name, onPick) {
    var box = $('pr-modal-box'), q = box.querySelector('[data-tpq="' + name + '"]'), list = box.querySelector('[data-tplist="' + name + '"]');
    q.addEventListener('input', function () {
        var w = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean), any = false;
        Array.prototype.forEach.call(list.querySelectorAll('.tp-area'), function (a) {
            var vis = 0;
            Array.prototype.forEach.call(a.querySelectorAll('.tp-row'), function (r) {
                var ok = w.every(function (x) { return r.getAttribute('data-words').indexOf(x) >= 0; });
                r.hidden = !ok; if (ok) vis++;
            });
            a.hidden = !vis; if (vis) any = true;
        });
        list.querySelector('.tp-none').hidden = any;
    });
    Array.prototype.forEach.call(list.querySelectorAll('input[name=' + name + ']'), function (r) {
        r.addEventListener('change', function () {
            Array.prototype.forEach.call(list.querySelectorAll('.tp-row'), function (c) { c.classList.toggle('on', c.querySelector('input').checked); });
            if (onPick) onPick(r.value);
        });
    });
    var on = list.querySelector('.tp-row.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'center' });
    return q;
}
function prNewLoad(tpl) {
    if ((P.dirty || P.srcDirty) && P.load && !confirm('Discard the unsaved changes of "' + P.load.name + '"?')) return;
    var supported = prSupported();
    tpl = tpl && supported.indexOf(tpl) >= 0 ? tpl : P.load && supported.indexOf(P.load.tpl) >= 0 ? P.load.tpl : supported[0];
    var h = '<h2><i class="fa-solid fa-wand-magic-sparkles"></i> New load</h2><p class="muted">Pick the Oracle FBDI template to fill — all ' + FBDI_TEMPLATES.length + ' standard templates are listed; search finds sheets and columns too.</p>' +
        prTplPicker('pr-tpl', tpl) +
        '<div class="row-f"><label class="fld grow"><span>Load name</span><input id="pr-f-name" maxlength="200" placeholder="e.g. Month-end accruals Sep-26"></label>' +
        '<label class="fld grow"><span>Description <em>(optional)</em></span><input id="pr-f-desc" maxlength="1000"></label></div>' +
        '<div class="modal-f"><button class="btn" data-mact="close">Cancel</button><button class="btn primary" data-mact="create"><i class="fa-solid fa-check"></i> Create load</button></div>';
    prModal(h);
    $('pr-modal-box').classList.add('wide');
    var setName = function () { var f = document.querySelector('input[name=pr-tpl]:checked'); if (f && !$('pr-f-name').dataset.touched) $('pr-f-name').value = prDefaultName(f.value); };
    setName();
    $('pr-f-name').addEventListener('input', function () { if (this.value.trim()) this.dataset.touched = '1'; else delete this.dataset.touched; });
    prTplPickerWire('pr-tpl', setName).focus();
}
function prChangeTemplate() {
    var L = P.load; if (!L) return;
    prModal('<h2><i class="fa-solid fa-right-left"></i> Change template</h2><p class="muted">The mapping is reset to the new template\'s defaults. Your source data stays.</p>' +
        prTplPicker('pr-chtpl', L.tpl) +
        '<label class="sw"><input type="checkbox" id="pr-chname" checked> Rename the load to match</label>' +
        '<div class="modal-f"><button class="btn" data-mact="close">Cancel</button><button class="btn primary" data-mact="chtpl"><i class="fa-solid fa-check"></i> Change</button></div>');
    $('pr-modal-box').classList.add('wide');
    prTplPickerWire('pr-chtpl').focus();
}
function prApplyTemplate() {
    var pick = document.querySelector('input[name=pr-chtpl]:checked'); if (!pick) return;
    var L = P.load, tpl = pick.value, rename = $('pr-chname').checked;
    prModal(null);
    if (!L || tpl === L.tpl) return;
    var oldName = prTplName(L.tpl);
    prSetBusy('Switching to ' + prTplName(tpl) + '…');
    var newName = prTplName(tpl);
    var name = !rename || L.name.indexOf(newName) === 0 ? L.name : L.name.indexOf(oldName) === 0 ? newName + L.name.slice(oldName.length) : prDefaultName(tpl);
    fbdiSpec(tpl).then(function () { return prWrite('UPDATE wms_fbdi_loads SET template_file = ' + prV(tpl, 100) + ', load_name = ' + prV(name, 200) + ", status = 'DRAFT', updated_by = " + prV(appUserName(), 120) +
        ', updated_date = SYSDATE WHERE load_id = ' + prN(L.id)); }).then(function () {
        L.tpl = tpl; L.name = name;
        var keepDate = L.options && L.options.dateOrder;
        L.options = prDefaultOptions(tpl); if (keepDate) L.options.dateOrder = keepDate;
        L.maps = prDefaultMaps(tpl); P.mapCsv = prSpec(tpl).sheets[0].csv; P.check = null; P.runs = null;
        prAutoMap(true);
        return prSave(true);
    }).then(function () {
        prSetBusy(null); toast('Now a ' + prTplName(tpl) + ' load');
        var li = P.list.filter(function (x) { return x.id === L.id; })[0]; if (li) { li.tpl = tpl; li.name = name; }
        prRenderList(); prRenderMain();
    }).catch(function (e) { prSetBusy(null); toast('Could not change the template: ' + e); });
}
function prDefaultName(tpl) { return prTplName(tpl) + ' — ' + new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }); }
function prCreate() {
    var pick = document.querySelector('input[name=pr-tpl]:checked'); if (!pick) { toast('Pick a template first'); return; }
    var tpl = pick.value, desc = $('pr-f-desc').value.trim();
    var name = $('pr-f-name').dataset.touched ? $('pr-f-name').value.trim() : prDefaultName(tpl);
    if (!name) { $('pr-f-name').focus(); return; }
    var opts, user = appUserName();
    prModal(null);
    P.dirty = P.srcDirty = false;
    prSetBusy('Creating the load…');
    Promise.all([fbdiSpec(tpl), prEnsureTables()]).then(function () {
        opts = prDefaultOptions(tpl);
        return prWrite('INSERT INTO wms_fbdi_loads (load_name, template_file, description, source_type, options_json, instance, status, created_by, updated_by) VALUES (' +
            prV(name, 200) + ', ' + prV(tpl, 100) + ', ' + prV(desc, 1000) + ", 'FILE', " + prClob(JSON.stringify(opts)) + ', ' + prV(currentInstance(), 10) + ", 'DRAFT', " + prV(user, 120) + ', ' + prV(user, 120) + ')');
    }).then(function () {
        return prRead('SELECT MAX(load_id) AS id FROM wms_fbdi_loads WHERE template_file = ' + prV(tpl, 100) + ' AND created_by = ' + prV(user, 120), 1);
    }).then(function (r) {
        var id = r.length ? +r[0].ID : null;
        var maps = prDefaultMaps(tpl);
        return prSaveMaps(id, tpl, maps).then(function () { prSetBusy(null); P.step = 'template'; return prLoadList(id); });
    }).catch(function (e) { prSetBusy(null); toast('Could not create the load: ' + e); });
}

function prSelect(id) {
    if (P.dirty || P.srcDirty) { if (!confirm('Discard the unsaved changes of "' + P.load.name + '"?')) return Promise.resolve(); }
    P.selId = id; lsSet('pr_sel', id);
    P.load = null; P.src = null; P.check = null; P.runs = null; P.dirty = P.srcDirty = false; P.wb = null; P.openError = null; P.tplSheet = null; P.tplView = null;
    prRenderList(); prRenderMain();
    var L;
    return prRead("SELECT load_id, load_name, template_file, description, source_type, source_note, status, row_count, instance, TO_CHAR(updated_date, 'YYYY-MM-DD HH24:MI') AS updated, " +
        'NVL(LENGTH(source_sql), 0) AS sql_len, NVL(LENGTH(source_cols), 0) AS cols_len, NVL(LENGTH(options_json), 0) AS opt_len ' +
        'FROM wms_fbdi_loads WHERE load_id = ' + prN(id), 1).then(function (r) {
        if (!r.length) throw 'Load ' + id + ' was not found';
        var x = r[0];
        L = { id: +x.LOAD_ID, name: x.LOAD_NAME, tpl: x.TEMPLATE_FILE, description: x.DESCRIPTION || '', srcType: x.SOURCE_TYPE || 'FILE', srcNote: x.SOURCE_NOTE || '', status: x.STATUS, rowCount: x.ROW_COUNT, updated: x.UPDATED };
        var w = 'load_id = ' + prN(id);
        return Promise.all([
            fbdiSpec(L.tpl).catch(function (e) { throw 'This load uses ' + prTplName(L.tpl) + ' — ' + e; }),
            +x.SQL_LEN ? prReadClob('wms_fbdi_loads', 'source_sql', w) : '',
            +x.COLS_LEN ? prReadClob('wms_fbdi_loads', 'source_cols', w) : '',
            +x.OPT_LEN ? prReadClob('wms_fbdi_loads', 'options_json', w) : '',
            prRead('SELECT sheet_csv, col_pos, map_expr FROM wms_fbdi_load_maps WHERE ' + w, 5000)
        ]);
    }).then(function (res) {
        res.shift();                                     // the spec — now in FBDI_SPECS
        L.srcSql = res[0] || '';
        var cols = []; try { cols = JSON.parse(res[1] || '[]'); } catch (e) { }
        L.options = prMergeOptions(L.tpl, res[2]);
        L.maps = {}; prSpec(L.tpl).sheets.forEach(function (s) { L.maps[s.csv] = {}; });
        res[3].forEach(function (m) { if (L.maps[m.SHEET_CSV] && m.MAP_EXPR != null) L.maps[m.SHEET_CSV][+m.COL_POS] = m.MAP_EXPR; });
        if (P.selId !== L.id) return;                    // user clicked another load meanwhile
        P.load = L; P.mapCsv = prSpec(L.tpl).sheets[0].csv;
        prRenderMain();
        if (cols.length && (L.srcType === 'FILE' || L.srcType === 'PASTE')) return prLoadRows(L, cols);
        if (cols.length) P.src = { cols: cols, rows: [], note: 'Run the query to fetch the rows' };
        prRenderMain();
    }).catch(function (e) {
        if (P.selId !== id) return;
        P.load = null; P.openError = String(e && e.message || e);
        prRenderMain();
    });
}
function prLoadRows(L, cols) {
    prSetBusy('Loading the saved rows…');
    var rows = [], total = +L.rowCount || 0, pages = [];
    for (var a = 1; a <= Math.max(total, 1); a += 400) pages.push(a);
    return prSeq(pages, function (a) {
        return prRead('SELECT row_no, NVL(LENGTH(row_data), 0) AS len, ' + prPieces('row_data', 6) + ' FROM wms_fbdi_load_rows WHERE load_id = ' + prN(L.id) +
            ' AND row_no BETWEEN ' + a + ' AND ' + (a + 399) + ' ORDER BY row_no', 400).then(function (r) {
            return prSeq(r, function (x) {
                var s = prJoin(x, 'row_data', 6);
                var more = +x.LEN > s.length ? prReadClob('wms_fbdi_load_rows', 'row_data', 'load_id = ' + prN(L.id) + ' AND row_no = ' + prN(x.ROW_NO)) : Promise.resolve(s);
                return more.then(function (full) { try { rows[+x.ROW_NO - 1] = JSON.parse(full); } catch (e) { rows[+x.ROW_NO - 1] = []; } });
            });
        });
    }).then(function () {
        prSetBusy(null);
        if (P.load !== L) return;
        P.src = { cols: cols, rows: rows.filter(function (r) { return r; }) };
        prRenderMain();
    }).catch(function (e) { prSetBusy(null); toast('Could not load the rows: ' + e); });
}

function prSaveMaps(id, tpl, maps) {
    var spec = prSpec(tpl), sels = [];
    spec.sheets.forEach(function (s) {
        Object.keys(maps[s.csv] || {}).forEach(function (pos) {
            var e = maps[s.csv][pos]; if (e == null || e === '') return;
            var c = s.cols[pos - 1] || {};
            sels.push('SELECT ' + prN(id) + ', ' + prV(s.csv, 60) + ', ' + prN(pos) + ', ' + prV(c.n, 200) + ', ' + prV(c.c, 60) + ', ' + prV(e, 4000) + ' FROM dual');
        });
    });
    return prWrite('DELETE FROM wms_fbdi_load_maps WHERE load_id = ' + prN(id)).then(function () {
        return prSeq(prBatches(sels), function (b) {
            return prWrite('INSERT INTO wms_fbdi_load_maps (load_id, sheet_csv, col_pos, col_label, db_column, map_expr) ' + b.join(' UNION ALL '));
        });
    });
}
function prBatches(sels) {
    var out = [], cur = [], size = 0;
    sels.forEach(function (s) {
        if (cur.length && (cur.length >= 250 || size + s.length > PR_BATCH_CHARS)) { out.push(cur); cur = []; size = 0; }
        cur.push(s); size += s.length;
    });
    if (cur.length) out.push(cur);
    return out;
}
function prSave(quiet) {
    var L = P.load; if (!L) return Promise.resolve();
    var saveRows = P.src && (L.srcType === 'FILE' || L.srcType === 'PASTE') && P.srcDirty;
    prSetBusy('Saving to APEX…');
    return prWrite('UPDATE wms_fbdi_loads SET load_name = ' + prV(L.name, 200) + ', description = ' + prV(L.description, 1000) + ', source_type = ' + prV(L.srcType, 20) +
        ', source_sql = ' + (L.srcSql ? prClob(L.srcSql) : 'NULL') + ', source_note = ' + prV(L.srcNote, 400) + ', source_cols = ' + (P.src ? prClob(JSON.stringify(P.src.cols)) : 'NULL') +
        ', options_json = ' + prClob(JSON.stringify(L.options)) + ', row_count = ' + prN(P.src ? P.src.rows.length : null) +
        ', updated_by = ' + prV(appUserName(), 120) + ', updated_date = SYSDATE WHERE load_id = ' + prN(L.id))
        .then(function () { return prSaveMaps(L.id, L.tpl, L.maps); })
        .then(function () { if (saveRows) return prSaveRows(L, P.src); })
        .then(function () {
            prSetBusy(null); P.dirty = false; if (saveRows) P.srcDirty = false;
            L.rowCount = P.src ? P.src.rows.length : null;
            if (!quiet) toast('Saved to APEX' + (saveRows ? ' — ' + P.src.rows.length + ' rows' : ''));
            var li = P.list.filter(function (x) { return x.id === L.id; })[0];
            if (li) { li.name = L.name; li.rows = L.rowCount; li.updated = new Date().toISOString().slice(0, 16).replace('T', ' '); }
            prRenderList(); prRenderHead();
        }).catch(function (e) { prSetBusy(null); toast('Save failed: ' + e); throw e; });
}
function prSaveRows(L, src) {
    var sels = src.rows.map(function (r, i) {
        return 'SELECT ' + prN(L.id) + ', ' + (i + 1) + ', ' + prClob(JSON.stringify(r.map(function (v) { return v == null ? '' : v instanceof Date ? FE.fmtDate(v, true) : v; }))) + ' FROM dual';
    });
    var batches = prBatches(sels), done = 0;
    return prWrite('DELETE FROM wms_fbdi_load_rows WHERE load_id = ' + prN(L.id)).then(function () {
        return prSeq(batches, function (b) {
            return prWrite('INSERT INTO wms_fbdi_load_rows (load_id, row_no, row_data) ' + b.join(' UNION ALL ')).then(function () {
                done += b.length; prSetBusy('Saving rows to APEX… ' + done + ' / ' + sels.length);
            });
        });
    });
}
function prDelete(id) {
    var L = P.list.filter(function (x) { return x.id === (id || P.selId); })[0] || P.load; if (!L) return;
    if (!confirm('Delete the load "' + L.name + '" from APEX, with its mappings, saved rows and history?')) return;
    var w = ' WHERE load_id = ' + prN(L.id), current = L.id === P.selId;
    prSetBusy('Deleting…');
    prSeq(['DELETE FROM wms_fbdi_run_files WHERE run_id IN (SELECT run_id FROM wms_fbdi_load_runs' + w + ')', 'DELETE FROM wms_fbdi_load_runs' + w,
        'DELETE FROM wms_fbdi_load_rows' + w, 'DELETE FROM wms_fbdi_load_maps' + w, 'DELETE FROM wms_fbdi_loads' + w], prWrite)
        .then(function () {
            prSetBusy(null); toast('Load deleted');
            if (current) { P.dirty = P.srcDirty = false; P.load = null; P.selId = null; P.openError = null; lsSet('pr_sel', null); }
            prLoadList();
        })
        .catch(function (e) { prSetBusy(null); toast('Delete failed: ' + e); });
}

// ── main frame ─────────────────────────────────────────────────
var PR_STEPS = [['template', 'fa-table-cells', 'FBDI sheets'], ['source', 'fa-database', 'Source'], ['map', 'fa-shuffle', 'Map'], ['check', 'fa-list-check', 'Check'], ['generate', 'fa-file-zipper', 'Generate'], ['history', 'fa-clock-rotate-left', 'History']];
function prRenderMain() {
    var el = $('pr-main'); if (!el) return;
    if (P.state === 'offline') { el.innerHTML = '<div class="welcome"><h2>Prepare &amp; Load</h2><p>' + esc(P.error || '') + '</p></div>'; return; }
    if (!P.selId) { el.innerHTML = prWelcome(); return; }
    if (!P.load && P.openError) {
        el.innerHTML = '<div class="empty" style="padding:60px"><i class="fa-solid fa-triangle-exclamation" style="color:var(--err);font-size:1.4rem"></i><br><b>This load could not be opened</b><br>' +
            '<small>' + esc(P.openError) + '</small><br><br><button class="btn primary" data-pact="reopen"><i class="fa-solid fa-rotate"></i> Try again</button></div>';
        return;
    }
    if (!P.load) { el.innerHTML = '<div class="empty" style="padding:60px"><i class="fa-solid fa-circle-notch spin"></i> Opening the load…</div>'; return; }
    var L = P.load;
    el.innerHTML = '<div class="pr-head" id="pr-head"></div>' +
        '<div class="pr-steps">' + PR_STEPS.map(function (s, i) {
            return '<button class="pr-step' + (P.step === s[0] ? ' on' : '') + '" data-step="' + s[0] + '"><em>' + (i < 5 ? i + 1 : '') + '</em><i class="fa-solid ' + s[1] + '"></i> ' + s[2] + prStepBadge(s[0]) + '</button>';
        }).join('') + '</div>' +
        '<div class="pr-busy" id="pr-busy"' + (P.busy ? '' : ' hidden') + '><i class="fa-solid fa-circle-notch spin"></i> <span>' + esc(P.busy || '') + '</span></div>' +
        '<div class="pr-body" id="pr-body"></div>';
    prRenderHead();
    ({ template: prRenderTemplate, source: prRenderSource, map: prRenderMap, check: prRenderCheck, generate: prRenderGenerate, history: prRenderHistory })[P.step]();
}
function prStepBadge(step) {
    if (step === 'source' && P.src) return ' <b class="sb">' + P.src.rows.length + '</b>';
    if (step === 'map' && P.load) { var n = 0; Object.keys(P.load.maps).forEach(function (k) { n += Object.keys(P.load.maps[k]).filter(function (p) { return P.load.maps[k][p]; }).length; }); return ' <b class="sb">' + n + '</b>'; }
    if (step === 'check' && P.check) { var c = P.check; return c.sig !== prSig() ? ' <b class="sb stale" title="Data or mapping changed since the check">!</b>' : c.errors ? ' <b class="sb err">' + c.errors + '</b>' : ' <b class="sb ok"><i class="fa-solid fa-check"></i></b>'; }
    return '';
}
function prRenderHead() {
    var el = $('pr-head'), L = P.load; if (!el || !L) return;
    var t = tplByFile(L.tpl) || { n: L.tpl }, R = prRules(L.tpl);
    el.innerHTML = '<div class="d-ic" style="--c:#2a78d6"><i class="fa-solid ' + (R.icon || 'fa-file-excel') + '"></i></div>' +
        '<div class="grow"><input class="pr-name" id="pr-name" value="' + esc(L.name) + '" maxlength="200" title="Rename">' +
        '<div class="muted pr-sub">' + esc(t.n) + ' · <code>' + esc(L.tpl) + '.xlsm</code> <button class="link" data-pact="chtpl" title="Switch this load to another template">Change template</button>' + (L.description ? ' · ' + esc(L.description) : '') + '</div></div>' +
        (P.dirty || P.srcDirty ? '<span class="chip warn"><i class="fa-solid fa-pen"></i> Unsaved</span>' : '<span class="chip ok"><i class="fa-solid fa-cloud"></i> Saved in APEX</span>') +
        '<button class="btn primary" data-pact="save"' + (P.dirty || P.srcDirty ? '' : ' disabled') + '><i class="fa-solid fa-floppy-disk"></i> Save</button>' +
        '<button class="btn" data-pact="delete" title="Delete this load"><i class="fa-regular fa-trash-can"></i></button>';
}
function prWelcome() {
    var tpls = Object.keys(FBDI_RULES), nOk = prSupported().length;
    return '<div class="welcome"><h2>Prepare &amp; Load</h2><p>Fill an Oracle FBDI template with real data, check it against Fusion before anything is uploaded, and generate the exact ZIP Oracle\'s own workbook would produce — without Excel macros. Every load, mapping, check and ZIP is kept in APEX.</p>' +
        '<div class="flow4">' +
        '<div><i class="fa-solid fa-database"></i><b>1 · Source</b><span>Excel / CSV file, paste from Excel, or a SQL query on APEX or Fusion.</span></div>' +
        '<div><i class="fa-solid fa-shuffle"></i><b>2 · Map</b><span>Auto-map columns; use constants, <code>{Column|date}</code>, <code>{#sum:Amount}</code> and more.</span></div>' +
        '<div><i class="fa-solid fa-list-check"></i><b>3 · Check</b><span>Required, types and lengths from the template, balancing and totals, then live Fusion lookups.</span></div>' +
        '<div><i class="fa-solid fa-file-zipper"></i><b>4 · Generate</b><span>CSV files in Oracle\'s format zipped and stored — ready for UCM.</span></div></div>' +
        '<h3 style="margin-top:22px">' + nOk + ' of Oracle\'s ' + FBDI_TEMPLATES.length + ' FBDI templates ready <button class="btn sm primary" data-new="" style="margin-left:8px"><i class="fa-solid fa-table-list"></i> Browse all</button></h3>' +
        '<p class="muted">Every template gets the checks from Oracle\'s workbook (required, type, length) and sheet links worked out from its key columns. These also have hand-written rules — auto-map synonyms, balancing and live Fusion lookups:</p><div class="tpl-pick">' + tpls.map(function (f) {
            var t = tplByFile(f) || { n: f, d: '' }, R = prRules(f);
            return '<button class="tpl-card" data-new="' + f + '"><i class="fa-solid ' + (R.icon || 'fa-file-excel') + '"></i><b>' + esc(t.n) + '</b><small>' + esc(t.d) + '</small></button>';
        }).join('') + '</div></div>';
}

// ── 1 · Source ─────────────────────────────────────────────────
var PR_SRC_TYPES = [['FILE', 'fa-file-excel', 'Excel / CSV file'], ['PASTE', 'fa-paste', 'Paste from Excel'], ['APEX_SQL', 'fa-database', 'APEX SQL'], ['FUSION_SQL', 'fa-cloud', 'Fusion SQL']];
function prRenderSource() {
    var L = P.load, t = L.srcType, h = '<div class="seg">' + PR_SRC_TYPES.map(function (s) {
        return '<button class="' + (t === s[0] ? 'on' : '') + '" data-srctype="' + s[0] + '"><i class="fa-solid ' + s[1] + '"></i> ' + s[2] + '</button>';
    }).join('') + '</div>';
    if (t === 'FILE') {
        h += '<label class="drop" id="pr-drop"><input type="file" id="pr-file" accept=".xlsx,.xlsm,.xls,.csv,.txt" hidden>' +
            '<i class="fa-solid fa-cloud-arrow-up"></i><b>Drop an Excel or CSV file here</b><span>or click to choose · .xlsx .xls .csv</span>' +
            (L.srcNote ? '<small>Current: ' + esc(L.srcNote) + '</small>' : '') + '</label>' +
            '<div class="it-bar"><i class="fa-solid fa-lightbulb"></i><span><b>Easiest:</b> download an Excel with exactly the columns ' + esc(prTplName(L.tpl)) + ' needs, fill it, drop it here — it maps itself.</span>' +
            '<button class="btn" data-pact="inputtpl"><i class="fa-solid fa-file-arrow-down"></i> Download input template</button></div>';
        if (P.wb) {
            h += '<div class="row-f"><label>Sheet <select id="pr-wsheet">' + P.wb.SheetNames.map(function (n) { return '<option' + (n === P.wbSheet ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></label>' +
                '<label>Header row <input type="number" id="pr-hrow" min="1" max="50" value="' + (P.wbHeader || 1) + '" style="width:70px"></label>' +
                '<button class="btn" data-pact="usesheet"><i class="fa-solid fa-check"></i> Use this sheet</button></div>';
        }
    } else if (t === 'PASTE') {
        h += '<textarea id="pr-paste" class="code" rows="7" placeholder="Copy the cells in Excel (including the header row) and paste them here…"></textarea>' +
            '<div class="row-f"><button class="btn primary" data-pact="usepaste"><i class="fa-solid fa-check"></i> Use pasted data</button><span class="muted">First row = column names. Tabs separate columns.</span></div>';
    } else {
        var fus = t === 'FUSION_SQL';
        h += '<textarea id="pr-sql" class="code" rows="8" spellcheck="false" placeholder="' + (fus ? 'SELECT … FROM Fusion tables (read-only, runs through the Fusion SQL runner)' : 'SELECT … FROM your APEX tables, e.g. WMS trips, staging tables') + '">' + esc(L.srcSql || '') + '</textarea>' +
            '<div class="row-f">' + (fus ? '' : '<button class="btn" data-pact="browse"><i class="fa-solid fa-table-list"></i> Browse tables</button>') + '<button class="btn primary" data-pact="runsql"><i class="fa-solid fa-play"></i> Run query</button>' +
            '<label>Max rows <input type="number" id="pr-maxrows" min="1" max="50000" value="' + (L.options.maxRows || 5000) + '" style="width:90px"></label>' +
            '<span class="muted">' + (fus ? 'Runs read-only against Fusion — nothing is changed.' : 'Runs through the APEX query gateway.') + ' Re-run it any time to refresh the data.</span></div>';
    }
    h += '<div id="pr-srcgrid"></div>';
    $('pr-body').innerHTML = h;
    prRenderSrcGrid();
}
function prRenderSrcGrid() {
    var el = $('pr-srcgrid'); if (!el) return;
    var S = P.src;
    if (!S) { el.innerHTML = '<div class="empty">No data yet — choose a source above.</div>'; return; }
    var editable = P.load.srcType === 'FILE' || P.load.srcType === 'PASTE';
    var bad = P.check && P.check.sig === prSig() ? P.check.badSrc : null;
    var only = P.srcOnlyBad && bad;
    var idx = S.rows.map(function (_, i) { return i; }).filter(function (i) { return !only || bad[i]; });
    var shown = idx.slice(0, PR_PREVIEW);
    el.innerHTML = '<div class="grid-h"><b>' + S.rows.length.toLocaleString() + ' rows · ' + S.cols.length + ' columns</b>' +
        (S.note ? '<span class="muted">' + esc(S.note) + '</span>' : '') +
        (bad ? '<label class="muted"><input type="checkbox" id="pr-onlybad"' + (P.srcOnlyBad ? ' checked' : '') + '> Only rows with issues (' + Object.keys(bad).length + ')</label>' : '') +
        (editable ? '<span class="muted"><i class="fa-solid fa-pen"></i> Click a cell to fix it</span>' : '') +
        '<button class="btn primary pf-btn" data-pact="prepfbdi" title="Check every required value is there, then run the checks"><i class="fa-solid fa-wand-magic-sparkles"></i> Prepare FBDI</button>' +
        (idx.length > PR_PREVIEW ? '<span class="muted">showing first ' + PR_PREVIEW + '</span>' : '') + '</div>' +
        '<div class="grid-w"><table class="grid"><thead><tr><th>#</th>' + S.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        shown.map(function (i) {
            var r = S.rows[i];
            return '<tr' + (bad && bad[i] ? ' class="bad" title="' + esc(bad[i]) + '"' : '') + '><td class="rn">' + (i + 1) + '</td>' + S.cols.map(function (_, c) {
                return '<td' + (editable ? ' contenteditable="true" data-r="' + i + '" data-c="' + c + '"' : '') + '>' + esc(FE.str(r[c])) + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
}
function prSetSource(cols, rows, note) {
    cols = cols.map(function (c, i) { c = String(c == null ? '' : c).trim(); return c || 'Column ' + (i + 1); });
    var seen = {}; cols = cols.map(function (c) { var k = c.toUpperCase(), n = c; if (seen[k]) n = c + ' ' + (++seen[k]); else seen[k] = 1; return n; });
    rows = rows.filter(function (r) { return r && r.some(function (v) { return v !== '' && v != null; }); })
        .map(function (r) { var a = []; for (var i = 0; i < cols.length; i++) a.push(r[i] == null ? '' : r[i]); return a; });
    P.src = { cols: cols, rows: rows, note: note || '' };
    P.srcVer = (P.srcVer || 0) + 1;
    P.load.srcNote = note || P.load.srcNote;
    P.srcDirty = P.load.srcType === 'FILE' || P.load.srcType === 'PASTE';
    P.dirty = true;
    var auto = prAutoMap(true);
    prRenderMain();
    toast(rows.length + ' rows, ' + cols.length + ' columns' + (auto ? ' — auto-mapped ' + auto + ' columns' : ''));
}
function prReadFile(file) {
    if (!window.XLSX) { toast('The Excel reader (SheetJS) did not load — check the internet connection.'); return; }
    var fr = new FileReader();
    fr.onload = function () {
        try {
            var wb = XLSX.read(new Uint8Array(fr.result), { type: 'array', cellDates: true, raw: /\.csv$|\.txt$/i.test(file.name) });
            if (typeof itRecognise === 'function' && itRecognise(wb, file.name)) return;
            P.wb = wb; P.wbName = file.name; P.wbSheet = wb.SheetNames[0]; P.wbHeader = prGuessHeader(wb.Sheets[P.wbSheet]);
            if (wb.SheetNames.length === 1) prUseSheet(); else prRenderSource();
        } catch (e) { toast('Could not read ' + file.name + ': ' + e.message); }
    };
    fr.readAsArrayBuffer(file);
}
function prGuessHeader(ws) {
    var a = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: '' }).slice(0, 15), best = 0, bestN = 0;
    a.forEach(function (r, i) { var n = r.filter(function (v) { return typeof v === 'string' && v.trim(); }).length; if (n > bestN) { bestN = n; best = i; } });
    return best + 1;
}
function prUseSheet() {
    var sel = $('pr-wsheet'), hr = $('pr-hrow');
    if (sel) P.wbSheet = sel.value;
    if (hr) P.wbHeader = Math.max(1, +hr.value || 1);
    var ws = P.wb.Sheets[P.wbSheet];
    var a = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: '', raw: true });   // row numbers = Excel rows
    var h = P.wbHeader - 1;
    prSetSource(a[h] || [], a.slice(h + 1), P.wbName + (P.wb.SheetNames.length > 1 ? ' › ' + P.wbSheet : '') + ' (header row ' + P.wbHeader + ')');
}
function prUsePaste() {
    var t = ($('pr-paste').value || '').replace(/\r/g, '');
    if (!t.trim()) { toast('Paste some rows first.'); return; }
    var lines = t.split('\n').filter(function (l) { return l.trim(); }), sep = lines[0].indexOf('\t') >= 0 ? '\t' : lines[0].indexOf(';') >= 0 ? ';' : ',';
    var rows = lines.map(function (l) { return l.split(sep); });
    P.load.srcSql = '';
    prSetSource(rows[0], rows.slice(1), 'Pasted ' + new Date().toLocaleString());
}
function prRunSql() {
    var sql = ($('pr-sql').value || '').trim().replace(/;+\s*$/, '');
    if (!/^\s*(\/\*[\s\S]*?\*\/\s*|--[^\n]*\n\s*)*(\(\s*)*(SELECT|WITH)\b/i.test(sql)) { toast('Only SELECT / WITH queries.'); return; }
    var max = Math.max(1, Math.min(50000, +$('pr-maxrows').value || 5000)), fus = P.load.srcType === 'FUSION_SQL';
    P.load.srcSql = sql; P.load.options.maxRows = max;
    prSetBusy('Running the query' + (fus ? ' on Fusion' : ' on APEX') + '…');
    var job = fus ? prFusion(sql, max).then(function (r) { return { cols: r.columns || (r.rows[0] ? Object.keys(r.rows[0]) : []), rows: r.rows || [] }; })
        : prApexPaged(sql, max);
    job.then(function (x) {
        prSetBusy(null);
        var rows = x.rows.map(function (r) { return Array.isArray(r) ? r : x.cols.map(function (c) { return r[c] != null ? r[c] : r[String(c).toUpperCase()]; }); });
        prSetSource(x.cols, rows, (fus ? 'Fusion' : 'APEX') + ' query · ' + new Date().toLocaleString() + (rows.length >= max ? ' · limited to ' + max + ' rows' : ''));
    }).catch(function (e) { prSetBusy(null); toast('Query failed: ' + e); });
}

/** The APEX query gateway returns at most 1,000 rows per call — fetch larger results in ROWNUM pages. */
function prApexPaged(sql, max) {
    var PAGE = 1000, cols = null, rows = [];
    function page(from) {
        var q = max <= PAGE ? sql : 'SELECT * FROM (SELECT q__.*, ROWNUM AS rn__ FROM (' + sql + ') q__) WHERE rn__ BETWEEN ' + from + ' AND ' + Math.min(max, from + PAGE - 1);
        return prApex('/executequery', { sql: q, maxRows: PAGE }).then(function (d) {
            var c = (d.columns || []).map(function (x) { return String(x.name || x); }), rn = c.map(function (x) { return x.toUpperCase(); }).indexOf('RN__');
            var got = (d.rows || []).map(function (r) { return Array.isArray(r) ? r : c.map(function (k) { return r[k] != null ? r[k] : r[k.toUpperCase()]; }); });
            if (rn >= 0) { c.splice(rn, 1); got.forEach(function (r) { r.splice(rn, 1); }); }
            cols = cols || c; rows = rows.concat(got);
            if (max > PAGE && got.length === PAGE && rows.length < max) { prSetBusy('Running the query on APEX… ' + rows.length + ' rows'); return page(from + PAGE); }
        });
    }
    return page(1).then(function () { return { cols: cols || [], rows: rows.slice(0, max) }; });
}

// ── 2 · Map ────────────────────────────────────────────────────
/** Fill empty template columns whose name matches a source column. Returns how many were mapped. */
function prAutoMap(onlyEmpty) {
    var L = P.load; if (!L || !P.src) return 0;
    var spec = prSpec(L.tpl), syn = prRules(L.tpl).synonyms || {}, n = 0;
    var srcN = P.src.cols.map(prNorm);
    spec.sheets.forEach(function (s) {
        var so = L.options.sheets[s.csv] || {}; if (so.include === false) return;
        var m = L.maps[s.csv] = L.maps[s.csv] || {};
        s.cols.forEach(function (c, i) {
            if (m[i + 1] && onlyEmpty !== false) return;
            var names = [prNorm(c.n), prNorm(c.c)].concat((syn[c.c] || syn[(c.c || '').toUpperCase()] || syn[c.n] || syn[c.n.split(' ')[0]] || []).map(prNorm)).filter(Boolean);
            var hit = -1;
            for (var k = 0; k < names.length && hit < 0; k++) hit = srcN.indexOf(names[k]);
            if (hit < 0) return;
            var f = c.t === 'D' ? '|date' + (L.options.dateOrder === 'mdy' ? ':mdy' : '') : c.t === 'N' ? '|num' : '';
            m[i + 1] = '{' + P.src.cols[hit] + f + '}'; n++;
        });
    });
    if (n) P.dirty = true;
    return n;
}
function prRenderMap() {
    var L = P.load, spec = prSpec(L.tpl), R = prRules(L.tpl);
    if (!spec.sheets.some(function (s) { return s.csv === P.mapCsv; })) P.mapCsv = spec.sheets[0].csv;
    var sheet = spec.sheets.filter(function (s) { return s.csv === P.mapCsv; })[0];
    var docInfo = '';
    if (P.src && L.options.docKey) { try { docInfo = FE.build(spec, {}, P.src, { docKey: L.options.docKey, sheets: {} }).docCount + ' documents'; } catch (e) { docInfo = String(e); } }
    var h = '<div class="map-top"><label class="fld grow"><span>Document key ' + (R.docKeyRequired ? '<em class="req">required</em>' : '<em>optional</em>') + '</span>' +
        '<input id="pr-dockey" list="pr-srclist" value="' + esc(L.options.docKey || '') + '" placeholder="' + esc(R.docKeyHint || '') + '"></label>' +
        '<div class="doc-info">' + (docInfo ? '<b>' + esc(docInfo) + '</b>' : '') + '<small>' + esc(R.docKeyHint || '') + '</small></div>' +
        '<label class="fld"><span>Dates in the source</span><select id="pr-dorder"><option value="dmy"' + (L.options.dateOrder !== 'mdy' ? ' selected' : '') + '>31/12/2026 (day first)</option><option value="mdy"' + (L.options.dateOrder === 'mdy' ? ' selected' : '') + '>12/31/2026 (month first)</option></select></label></div>';
    h += prSheetCards(true);
    h += '<div class="map-bar"><b class="map-cur"><i class="fa-solid fa-table-list"></i> ' + esc(sheet.n) + ' <small>→ ' + esc(sheet.csv) + '.csv</small></b>' +
        '<span class="grow"></span>' +
        '<div class="seg sm">' + [['req', 'Required'], ['mapped', 'Mapped'], ['all', 'All ' + sheet.cols.length]].map(function (f) { return '<button class="' + (P.mapFilter === f[0] ? 'on' : '') + '" data-mfilter="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div>' +
        '<input type="search" id="pr-mapq" placeholder="Find column…" value="' + esc(P.mapQ) + '">' +
        '<button class="btn" data-pact="automap" title="Map empty columns whose names match source columns"><i class="fa-solid fa-wand-magic-sparkles"></i> Auto-map</button></div>';
    h += '<div class="map-wrap"><div class="map-tbl" id="pr-maptbl"></div><aside class="map-help">' + prSrcChips() + prFuncHelp() + '</aside></div>';
    h += '<datalist id="pr-srclist">' + (P.src ? P.src.cols.map(function (c) { return '<option value="{' + esc(c) + '}">'; }).join('') : '') + '</datalist>';
    $('pr-body').innerHTML = h;
    prRenderMapRows();
}
/** The template's sheets as linked cards: what each holds, rows per sheet, include, progress, and the link column. */
function prSheetCards(forMap) {
    var L = P.load, spec = prSpec(L.tpl), R = prRules(L.tpl), relax = {};
    (R.notRequired || []).forEach(function (k) { relax[k] = 1; });
    var multi = spec.sheets.length > 1, cur = forMap ? P.mapCsv : P.tplSheet;
    var needKey = spec.sheets.some(function (s) { var o = prSheetOpt(s.csv); return o.include !== false && o.mode === 'doc'; });
    var h = '<div class="sheets-how"><i class="fa-solid fa-circle-info"></i> <span>' + (multi
        ? 'This template has <b>' + spec.sheets.length + ' sheets</b>; each becomes one CSV in the ZIP. <b>One source feeds every sheet</b>: a sheet set to <i>one row per document</i> takes the first source row of each document (rows grouped by the <b>Document key</b>); a sheet set to <i>one row per source row</i> takes every row. ' +
          ((R.links || []).length ? 'Linked sheets must carry the <b>same value</b> in their link column (' + esc(R.links.map(function (l) { return l.label; }).join(', ')) + ') — map it to the same expression on both, e.g. <code>{#load}{#doc|pad:5}</code>.' : '')
        : 'This template has <b>one sheet</b> — every source row becomes one row of <code>' + esc(spec.sheets[0].csv) + '.csv</code>.') + '</span>' +
        (needKey && !L.options.docKey ? '<em class="warn-k"><i class="fa-solid fa-triangle-exclamation"></i> A sheet is set to one row per document — set the Document key in Map.</em>' : '') + '</div>';
    h += '<div class="sheet-cards">';
    spec.sheets.forEach(function (s, i) {
        var o = prSheetOpt(s.csv), m = L.maps[s.csv] || {}, def = (R.sheets || {})[s.csv] || {};
        var req = s.cols.filter(function (c) { return c.r && !relax[c.c]; });
        var reqDone = req.filter(function (c) { return m[s.cols.indexOf(c) + 1]; }).length;
        var mapped = Object.keys(m).filter(function (k) { return m[k]; }).length, off = o.include === false;
        var link = (R.links || []).filter(function (l) { return l.to === s.csv; })[0];
        if (i) h += '<div class="sheet-arrow' + (off ? ' off' : '') + '"><i class="fa-solid fa-arrow-right"></i>' + (link ? '<small>' + esc(link.label) + '</small>' : '') + '</div>';
        h += '<div class="sheet-card' + (s.csv === cur ? ' on' : '') + (off ? ' off' : '') + '" data-mapcsv="' + s.csv + '">' +
            '<div class="sc-h"><b>' + esc(s.n) + '</b><label class="sw" title="Put this sheet in the ZIP"><input type="checkbox" data-incl="' + s.csv + '"' + (off ? '' : ' checked') + '></label></div>' +
            '<small class="sc-role">' + esc(def.role || '') + '</small>' +
            '<select class="sc-mode" data-mode="' + s.csv + '"' + (off ? ' disabled' : '') + '><option value="row"' + (o.mode !== 'doc' ? ' selected' : '') + '>one row per source row</option><option value="doc"' + (o.mode === 'doc' ? ' selected' : '') + '>one row per document</option></select>' +
            '<div class="sc-prog" title="Required columns mapped"><i style="width:' + (req.length ? Math.round(reqDone * 100 / req.length) : 100) + '%"></i></div>' +
            '<small class="sc-meta">' + (off ? 'not in the ZIP' : reqDone + '/' + req.length + ' required · ' + mapped + ' mapped') + ' · <code>' + esc(s.csv) + '.csv</code></small></div>';
    });
    return h + '</div>';
}

// ── 0 · FBDI sheets — the workbook as Oracle ships it, or filled with this load's data ─
function prColLetter(i) { var s = ''; i++; while (i) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
function prRenderTemplate() {
    var L = P.load, spec = prSpec(L.tpl), t = tplByFile(L.tpl) || {};
    var sheets = spec.sheets, cur = P.tplSheet;
    if (cur !== '#ins' && !sheets.some(function (s) { return s.csv === cur; })) cur = P.tplSheet = sheets[0].csv;
    var view = P.tplView || (P.src && P.src.rows.length ? 'data' : 'oracle');
    if (view === 'data' && !(P.src && P.src.rows.length)) view = 'oracle';
    var built = null;
    if (view === 'data') { try { built = FE.build(spec, L.maps, { cols: P.src.cols, rows: P.src.rows.slice(0, 300) }, { docKey: L.options.docKey, sheets: L.options.sheets, loadId: L.id }); } catch (e) { built = null; } }
    var h = prSheetCards(false);
    h += '<div class="xl"><div class="xl-bar"><div class="xl-file"><i class="fa-solid fa-file-excel"></i> <b>' + esc(L.tpl) + '.xlsm</b> <span class="muted">Oracle ' + esc(t.n || '') + ' · release ' + relLabel(DL.release) + '</span></div>' +
        '<div class="seg sm"><button class="' + (view === 'oracle' ? 'on' : '') + '" data-tplview="oracle">Oracle example rows</button>' +
        '<button class="' + (view === 'data' ? 'on' : '') + '" data-tplview="data"' + (P.src && P.src.rows.length ? '' : ' disabled title="Load source data first"') + '>With this load\'s data</button></div>' +
        (cur !== '#ins' ? '<label class="sw"><input type="checkbox" id="pr-hideempty"' + (P.tplHideEmpty ? ' checked' : '') + '> Hide empty columns</label>' : '') + '</div>';
    if (cur === '#ins') {
        h += '<div class="xl-ins">' + (spec.ins || []).map(function (p, i) { return i < 2 ? '<h3>' + esc(p) + '</h3>' : '<p>' + esc(p) + '</p>'; }).join('') +
            '<h3>What the ZIP contains</h3><table class="grid"><thead><tr><th>Sheet (interface table)</th><th>CSV in the ZIP</th><th>Columns</th><th>Required</th></tr></thead><tbody>' +
            sheets.map(function (s) { return '<tr><td>' + esc(s.n) + '</td><td><code>' + esc(s.csv) + '.csv</code></td><td>' + s.cols.length + '</td><td>' + s.cols.filter(function (c) { return c.r; }).length + '</td></tr>'; }).join('') +
            '</tbody></table><p class="muted">Oracle\'s workbook turns every sheet into a CSV (no header row, an extra END column) and zips them — the Generate step does exactly the same.</p></div>';
    } else {
        var sh = sheets.filter(function (s) { return s.csv === cur; })[0], m = L.maps[sh.csv] || {};
        var relax = {}; (prRules(L.tpl).notRequired || []).forEach(function (k) { relax[k] = 1; });
        var isReq = function (c) { return c.r && !relax[c.c]; };
        var rows = view === 'data' ? (built && built.sheets.filter(function (x) { return x.csv === sh.csv; })[0] || { rows: [] }).rows.slice(0, 200) : (sh.ex || []);
        var cols = sh.cols.map(function (c, i) { return i; });
        if (P.tplHideEmpty) cols = cols.filter(function (i) { return isReq(sh.cols[i]) || m[i + 1] || rows.some(function (r) { return r[i] !== '' && r[i] != null; }); });   // required always stays
        h += '<div class="xl-grid"><table><thead><tr><th class="xl-c"></th>' + cols.map(function (i) { return '<th class="xl-c">' + prColLetter(i) + '</th>'; }).join('') + '</tr></thead><tbody>' +
            '<tr class="xl-title"><td class="xl-r">2</td><td colspan="' + cols.length + '">' + esc(sh.n) + '</td></tr>' +
            '<tr class="xl-req"><td class="xl-r">3</td><td colspan="' + cols.length + '"><span>*</span> Required</td></tr>' +
            '<tr class="xl-head"><td class="xl-r">4</td>' + cols.map(function (i) {
                var c = sh.cols[i], mapped = m[i + 1];
                return '<td class="' + (c.r ? 'r' : '') + (mapped ? ' m' : isReq(c) && view === 'data' ? ' miss' : '') + '" data-gocol="' + esc(sh.csv + '|' + c.n) + '" title="' + esc((c.c ? c.c + ' · ' : '') + (c.t === 'D' ? 'date' : c.t === 'N' ? 'number' : 'text') + (c.l ? '(' + c.l + ')' : '') + (c.h ? '\n\n' + c.h : '') + '\n\nMapping: ' + (mapped || '— none —') + '\nClick to map this column') + '">' +
                    (isReq(c) ? '*' : c.r ? '(*)' : '') + esc(c.n) + (mapped ? '<i class="fa-solid fa-link"></i>' : '') + '</td>';
            }).join('') + '</tr>' +
            (rows.length ? rows.map(function (r, ri) {
                return '<tr><td class="xl-r">' + (ri + 5) + '</td>' + cols.map(function (i) { return '<td>' + esc(r[i] == null ? '' : r[i]) + '</td>'; }).join('') + '</tr>';
            }).join('') : '<tr><td class="xl-r">5</td><td colspan="' + cols.length + '" class="muted" style="padding:14px">' + (view === 'data' ? (prSheetOpt(sh.csv).include === false ? 'This sheet is not included in the ZIP.' : 'No rows — map this sheet\'s columns in Map.') : 'Oracle ships no example rows for this sheet.') + '</td></tr>') +
            '</tbody></table></div>';
    }
    h += '<div class="xl-tabs"><button class="' + (cur === '#ins' ? 'on' : '') + '" data-tplsheet="#ins">Instructions and CSV Generation</button>' +
        sheets.map(function (s) {
            var off = prSheetOpt(s.csv).include === false, n = view === 'data' && built ? ((built.sheets.filter(function (x) { return x.csv === s.csv; })[0] || { rows: [] }).rows.length) : null;
            return '<button class="' + (s.csv === cur ? 'on' : '') + (off ? ' off' : '') + '" data-tplsheet="' + s.csv + '">' + esc(s.n) + (n != null ? ' <small>' + n + '</small>' : '') + '</button>';
        }).join('') + '</div></div>' +
        '<p class="muted xl-note"><i class="fa-solid fa-hand-pointer"></i> Click a column heading to map it. Hover it to see Oracle\'s description. <i class="fa-solid fa-link"></i> = already mapped.</p>';
    $('pr-body').innerHTML = h;
}

function prSrcChips() {
    if (!P.src) return '<div class="help-b"><b>Source columns</b><p class="muted">Load data in step 1 to see its columns here.</p></div>';
    return '<div class="help-b"><b>Source columns</b><p class="muted">Click to insert into the field you are editing.</p><div class="chips">' +
        P.src.cols.map(function (c) { return '<button class="chip-src" data-ins="{' + esc(c) + '}">' + esc(c) + '</button>'; }).join('') + '</div></div>';
}
function prFuncHelp() {
    return '<div class="help-b"><b>Values</b><div class="chips">' + Object.keys(FE.SPECIALS).map(function (k) {
        return '<button class="chip-fn" data-ins="{' + k + '}" title="' + esc(FE.SPECIALS[k]) + '">{' + esc(k) + '}</button>';
    }).join('') + '</div><b style="margin-top:10px">Functions</b><p class="muted">Add after a column with | — e.g. <code>{Date|date}</code> <code>{Amt|num|dr}</code></p><div class="fn-list">' +
        Object.keys(FE.FILTERS).map(function (k) { return '<div><code data-insf="|' + k + '">|' + k + '</code><span>' + esc(FE.FILTERS[k]) + '</span></div>'; }).join('') + '</div></div>';
}
function prRenderMapRows() {
    var el = $('pr-maptbl'); if (!el) return;
    var L = P.load, spec = prSpec(L.tpl), sheet = spec.sheets.filter(function (s) { return s.csv === P.mapCsv; })[0], m = L.maps[sheet.csv] || {};
    var relax = {}; (prRules(L.tpl).notRequired || []).forEach(function (k) { relax[k] = 1; });
    var prev = prPreview(sheet.csv), q = P.mapQ.toLowerCase();
    var rows = sheet.cols.map(function (c, i) { return { c: c, i: i, e: m[i + 1] || '' }; }).filter(function (x) {
        if (q && (x.c.n + ' ' + x.c.c).toLowerCase().indexOf(q) < 0) return false;
        if (P.mapFilter === 'req') return (x.c.r && !relax[x.c.c]) || x.e || relax[x.c.c];
        if (P.mapFilter === 'mapped') return !!x.e;
        return true;
    });
    el.innerHTML = '<table class="mt"><thead><tr><th>#</th><th>Template column</th><th>Mapping</th><th>Preview (first rows)</th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (x) {
            var c = x.c, p = prev[x.i] || {}, typ = c.t === 'D' ? 'date' : c.t === 'N' ? 'number' + (c.p ? ' (' + c.p + ')' : '') : 'text' + (c.l ? ' (' + c.l + ')' : '');
            var tip = (c.c ? c.c + ' · ' : '') + typ + (c.h ? '\n\n' + c.h : '') + (c.e ? '\n\nOracle example: ' + c.e : '');
            return '<tr class="' + (c.r && !relax[c.c] ? 'req' : '') + (x.e ? ' has' : '') + '"><td class="rn">' + (x.i + 1) + '</td>' +
                '<td class="tc" title="' + esc(tip) + '"><b>' + esc(c.n) + (c.r && !relax[c.c] ? ' <em>*</em>' : relax[c.c] ? ' <em title="one of these is required">(*)</em>' : '') + '</b><small>' + esc(typ) + (c.e ? ' · e.g. ' + esc(c.e) : '') + '</small></td>' +
                '<td class="me"><input data-map="' + (x.i + 1) + '" list="pr-srclist" value="' + esc(x.e) + '" placeholder="' + (c.e ? 'e.g. ' + esc(c.e) : '—') + '" spellcheck="false"></td>' +
                '<td class="pv">' + (p.err ? '<span class="pv-err"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(p.err) + '</span>' : esc((p.vals || []).join('  ·  '))) + '</td></tr>';
        }).join('') : '<tr><td colspan="4" class="empty">Nothing to show — switch the filter to <b>All</b>.</td></tr>') + '</tbody></table>';
}
/** Values of the first 3 output rows per column of one sheet (fast: builds on 12 source rows). */
function prPreview(csv) {
    var L = P.load, out = {};
    if (!P.src || !P.src.rows.length) return out;
    var spec = prSpec(L.tpl), sub = { cols: P.src.cols, rows: P.src.rows.slice(0, 12) };
    var b = FE.build(spec, L.maps, sub, { docKey: L.options.docKey, sheets: L.options.sheets, loadId: L.id });
    var s = b.sheets.filter(function (x) { return x.csv === csv; })[0]; if (!s) return out;
    s.rows.slice(0, 3).forEach(function (r) { r.forEach(function (v, i) { (out[i] = out[i] || { vals: [] }).vals.push(v === '' ? '∅' : v); }); });
    s.errs.forEach(function (e) { if (e.r < 3) (out[e.c] = out[e.c] || { vals: [] }).err = e.msg; });
    return out;
}

// ── 3 · Check ──────────────────────────────────────────────────
function prRunCheck(live) {
    var L = P.load, spec = prSpec(L.tpl), R = prRules(L.tpl);
    if (!P.src || !P.src.rows.length) { toast('Load source data first (step 1).'); return Promise.resolve(); }
    if (R.docKeyRequired && !L.options.docKey) { toast('Set the Document key in step 2 (Map) first.'); P.step = 'map'; prRenderMain(); return Promise.resolve(); }
    var t0 = Date.now();
    prSetBusy('Building ' + P.src.rows.length + ' rows…');
    var built = FE.build(spec, L.maps, P.src, { docKey: L.options.docKey, sheets: L.options.sheets, loadId: L.id });
    var issues = FE.checkBasic(built, R.notRequired).concat(R.checks ? R.checks(built) : []);
    var C = { sig: prSig(), built: built, issues: issues, fusion: [], live: !!live, at: new Date(), ms: 0 };
    P.check = C;
    var job = Promise.resolve();
    if (live && hasHost() && R.fusion && R.fusion.length) {
        C.fusion = R.fusion.map(function (f) { return { id: f.id, name: f.name, sev: f.sev, status: 'queued' }; });
        prRenderMain();
        job = frRunFusion(L.tpl, built, function (sql) { return prFusion(sql, 20000).then(function (r) { return r.rows || []; }); }, function (chk, st) {
            var x = C.fusion.filter(function (f) { return f.id === chk.id; })[0]; if (x) x.status = st;
            prSetBusy('Checking in Fusion: ' + chk.name + '…');
            if (P.step === 'check') prRenderCheckBody();
        }).then(function (res) {
            C.fusion = res;
            res.forEach(function (r) { C.issues = C.issues.concat(r.issues || []); });
        });
    }
    return job.then(function () {
        C.ms = Date.now() - t0;
        prSummarise(C);
        prSetBusy(null);
        prRenderMain();
        return prRecordRun('CHECK', C).catch(function (e) { console.log('[Prepare] run not recorded', e); });
    }).catch(function (e) { prSetBusy(null); toast('Check failed: ' + e); });
}
function prSummarise(C) {
    C.errors = C.issues.filter(function (i) { return i.sev === 'E'; }).length;
    C.warnings = C.issues.length - C.errors;
    C.outRows = C.built.sheets.reduce(function (a, s) { return a + s.rows.length; }, 0);
    C.status = C.errors ? 'FAILED' : C.warnings ? 'WARNINGS' : 'PASSED';
    // source rows with issues (for the Source grid filter)
    C.badSrc = {};
    C.issues.forEach(function (i) {
        var s = C.built.sheets.filter(function (x) { return x.csv === i.csv; })[0]; if (!s || s.src[i.r] == null) return;
        var k = s.src[i.r]; C.badSrc[k] = (C.badSrc[k] ? C.badSrc[k] + '\n' : '') + i.msg;
    });
    // group by check
    var by = {};
    C.issues.forEach(function (i) { var k = i.check; (by[k] = by[k] || { check: k, e: 0, w: 0, first: i.msg }); by[k][i.sev === 'E' ? 'e' : 'w']++; });
    C.byCheck = by;
}
var PR_CHECK_NAMES = { required: 'Required columns', type: 'Data types & dates', length: 'Lengths', map: 'Mapping expressions', balance: 'Journals balance', drcr: 'Debit / credit per line',
    status: 'Status & flags', supplier: 'Supplier given', dup: 'Duplicates', sign: 'Amount signs', orphan: 'Header / line links', nolines: 'Invoices have lines', total: 'Invoice = sum of lines',
    item: 'Item given', qty: 'Quantities', transfer: 'Transfer details' };
function prRenderCheck() {
    var L = P.load, R = prRules(L.tpl);
    var h = '<div class="row-f"><button class="btn primary" data-pact="check"><i class="fa-solid fa-list-check"></i> Run checks</button>' +
        '<label class="sw"><input type="checkbox" id="pr-live"' + (L.options.live !== false ? ' checked' : '') + '> Live Fusion checks (' + ((R.fusion || []).length) + ')</label>' +
        '<span class="muted">Template rules run in the page; live checks look values up in Fusion, read-only.</span></div><div id="pr-checkbody"></div>';
    $('pr-body').innerHTML = h;
    prRenderCheckBody();
}
function prRenderCheckBody() {
    var el = $('pr-checkbody'); if (!el) return;
    var C = P.check;
    if (!C) { el.innerHTML = '<div class="empty">Not checked yet.</div>'; return; }
    var stale = C.sig !== prSig();
    var h = stale ? '<div class="note warn"><i class="fa-solid fa-rotate"></i> The data or mapping changed since this check — run it again.</div>' : '';
    if (C.status) {
        h += '<div class="kpis sm">' +
            '<div class="kpi"><b>' + P.src.rows.length + '</b><span>source rows</span></div>' +
            '<div class="kpi"><b>' + C.outRows + '</b><span>template rows (' + C.built.sheets.map(function (s) { return s.rows.length; }).join(' + ') + ')</span></div>' +
            '<div class="kpi ' + (C.errors ? 'err' : 'ok') + '"><b>' + C.errors + '</b><span>errors</span></div>' +
            '<div class="kpi ' + (C.warnings ? 'warn' : '') + '"><b>' + C.warnings + '</b><span>warnings</span></div></div>';
    }
    // checklist
    var items = [];
    ['required', 'type', 'length', 'map'].concat(Object.keys(C.byCheck || {}).filter(function (k) { return !/^(required|type|length|map)$/.test(k) && k.indexOf('fusion:') !== 0; })).forEach(function (k) {
        var b = (C.byCheck || {})[k];
        items.push({ name: PR_CHECK_NAMES[k] || k, st: !C.status ? 'queued' : b ? (b.e ? 'fail' : 'warn') : 'pass', n: b ? b.e + b.w : 0, note: b ? b.first : '' });
    });
    h += '<div class="checks"><div class="ck-col"><h3>Template &amp; data rules</h3>' + items.map(prCheckRow).join('') + '</div>';
    h += '<div class="ck-col"><h3>Live in Fusion ' + (C.live ? '' : '<span class="muted">— off</span>') + '</h3>' + (C.fusion.length ? C.fusion.map(function (f) {
        return prCheckRow({ name: f.name, st: f.status === 'fail' && f.sev === 'W' ? 'warn' : f.status, n: f.count || 0, note: f.error ? 'Could not run: ' + f.error : f.note || (f.checked ? f.checked + ' values checked' : ''), sql: f.sql });
    }).join('') : '<div class="muted" style="padding:8px 0">' + (C.live ? 'This template has no live checks.' : 'Tick “Live Fusion checks” and run again to look values up in Fusion.') + '</div>') + '</div></div>';
    // issues
    if (C.issues.length) {
        var top = C.issues.slice().sort(function (a, b) { return (a.sev === b.sev ? 0 : a.sev === 'E' ? -1 : 1) || a.r - b.r; }).slice(0, 300);
        h += '<h3 style="margin-top:18px">Issues <span class="muted">— ' + C.issues.length + (C.issues.length > 300 ? ', first 300 shown' : '') + '. Fix them in the source (step 1) or the mapping (step 2).</span></h3>' +
            '<div class="grid-w"><table class="grid issues"><thead><tr><th></th><th>File</th><th>Row</th><th>Source row</th><th>Column</th><th>Problem</th></tr></thead><tbody>' +
            top.map(function (i) {
                var s = C.built.sheets.filter(function (x) { return x.csv === i.csv; })[0], col = s && i.c >= 0 ? s.spec.cols[i.c] : null;
                return '<tr><td>' + (i.sev === 'E' ? '<i class="fa-solid fa-circle-xmark e"></i>' : '<i class="fa-solid fa-triangle-exclamation w"></i>') + '</td><td>' + esc(i.csv) + '</td><td>' + (i.r + 1) + '</td>' +
                    '<td>' + (s && s.src[i.r] != null ? '<a href="#" data-gosrc="' + s.src[i.r] + '">' + (s.src[i.r] + 1) + '</a>' : '') + '</td><td>' + esc(col ? col.n : '') + '</td><td>' + esc(i.msg) + '</td></tr>';
            }).join('') + '</tbody></table></div>';
    } else if (C.status) h += '<div class="note ok"><i class="fa-solid fa-circle-check"></i> No issues found in ' + (C.ms / 1000).toFixed(1) + ' s — go to <b>Generate</b>.</div>';
    // output preview
    if (C.status) h += prOutPreview(C);
    el.innerHTML = h;
}
function prCheckRow(x) {
    var ic = { pass: 'fa-circle-check', fail: 'fa-circle-xmark', warn: 'fa-triangle-exclamation', error: 'fa-plug-circle-exclamation', skip: 'fa-circle-minus', running: 'fa-circle-notch spin', queued: 'fa-regular fa-circle' }[x.st] || 'fa-circle';
    return '<div class="ck ' + x.st + '"><i class="fa-solid ' + ic + '"></i><span class="grow"><b>' + esc(x.name) + '</b>' + (x.note ? '<small>' + esc(x.note) + '</small>' : '') + '</span>' +
        (x.n ? '<em>' + x.n + '</em>' : '') + (x.sql ? '<button class="link" data-showsql="' + esc(x.sql) + '" title="Show the query">SQL</button>' : '') + '</div>';
}
function prOutPreview(C) {
    var sheets = C.built.sheets, cur = sheets.filter(function (s) { return s.csv === P.outCsv; })[0] || sheets[0];
    if (!cur) return '';
    P.outCsv = cur.csv;
    var cols = cur.spec.cols.map(function (c, i) { return i; }).filter(function (i) { return cur.rows.some(function (r) { return r[i] !== ''; }); });
    var bad = {}; C.issues.forEach(function (i) { if (i.csv === cur.csv) { bad[i.r + ':' + i.c] = (bad[i.r + ':' + i.c] ? bad[i.r + ':' + i.c] + '\n' : '') + i.msg; bad[i.r] = 1; } });
    return '<h3 style="margin-top:18px">Output preview <span class="muted">— the CSV rows (only filled columns shown)</span></h3><div class="tbl-tabs">' + sheets.map(function (s) {
        return '<button class="tbl-tab' + (s === cur ? ' on' : '') + '" data-outcsv="' + s.csv + '">' + esc(s.csv) + '.csv <small>' + s.rows.length + '</small></button>';
    }).join('') + '</div><div class="grid-w"><table class="grid"><thead><tr><th>#</th>' + cols.map(function (i) { return '<th title="' + esc(cur.spec.cols[i].c || '') + '">' + esc(cur.spec.cols[i].n) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        cur.rows.slice(0, PR_PREVIEW).map(function (r, ri) {
            return '<tr' + (bad[ri] ? ' class="bad"' : '') + '><td class="rn">' + (ri + 1) + '</td>' + cols.map(function (i) {
                var b = bad[ri + ':' + i]; return '<td' + (b ? ' class="cell-bad" title="' + esc(b) + '"' : '') + '>' + esc(r[i]) + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
}

// ── 4 · Generate ───────────────────────────────────────────────
function prRenderGenerate() {
    var L = P.load, spec = prSpec(L.tpl), C = P.check, fresh = C && C.status && C.sig === prSig();
    var zipBase = spec.zip + '_' + L.id + '_' + prStamp();
    var h = '<div class="gen">';
    if (!fresh) h += '<div class="note warn"><i class="fa-solid fa-list-check"></i> ' + (C ? 'The data or mapping changed since the last check.' : 'Run the checks first.') + ' <button class="btn sm" data-pact="checkgo">Run checks now</button></div>';
    else if (C.errors) h += '<div class="note err"><i class="fa-solid fa-circle-xmark"></i> ' + C.errors + ' errors — Fusion would reject those rows. Fix them, or generate anyway to test.</div>';
    else h += '<div class="note ok"><i class="fa-solid fa-circle-check"></i> Checked ' + prAgo(C.at.toISOString()) + ': ' + C.outRows + ' rows, no errors' + (C.warnings ? ', ' + C.warnings + ' warnings' : '') + '.</div>';
    if (fresh) {
        h += '<div class="files">' + C.built.sheets.map(function (s) {
            var csv = FE.toCsv(s, spec.end);
            return '<div class="file"><i class="fa-solid fa-file-csv"></i><b>' + esc(s.csv) + '.csv</b><span>' + s.rows.length + ' rows · ' + fmtSize(FE.utf8Bytes(csv)) + '</span></div>';
        }).join('') + '</div>' +
            '<div class="row-f"><label class="fld"><span>ZIP name</span><input id="pr-zipname" value="' + esc(zipBase) + '" style="width:340px"></label>' +
            '<label class="fld"><span>Template release</span><b class="rel-b">' + relLabel(DL.release) + '</b></label>' +
            (C.errors ? '<label class="sw"><input type="checkbox" id="pr-force"> Generate with errors</label>' : '') +
            '<button class="btn primary big" data-pact="generate"' + (C.errors ? ' disabled' : '') + '><i class="fa-solid fa-file-zipper"></i> Generate ZIP</button></div>';
    }
    var t = tplByFile(L.tpl) || {};
    h += '<h3 style="margin-top:22px">Then, in Fusion</h3><ol class="next">' +
        '<li>Navigator › Tools › <b>File Import and Export</b> › upload the ZIP' + (t.u ? ' to account <code>' + esc(t.u) + '</code>' : '') + '.</li>' +
        '<li>Scheduled Processes › <b>Load Interface File for Import</b> › Import Process: <b>' + esc(t.j || 'the import job') + '</b>, Data File: the ZIP.</li>' +
        '<li>Run <b>' + esc(t.j || 'the import job') + '</b> if it does not start by itself, and review its output for rejected rows.</li></ol>' +
        '<p class="muted">Next phase: one button does all three through ErpIntegrationService and shows the rejected rows here.</p></div>';
    $('pr-body').innerHTML = h;
}
function prStamp() { var d = new Date(); return d.getFullYear() + FE.pad2(d.getMonth() + 1) + FE.pad2(d.getDate()) + '_' + FE.pad2(d.getHours()) + FE.pad2(d.getMinutes()); }
function prGenerate() {
    var L = P.load, C = P.check;
    if (!C || C.sig !== prSig()) { toast('Run the checks again first.'); return; }
    if (C.errors && !($('pr-force') && $('pr-force').checked)) { toast('Fix the errors or tick “Generate with errors”.'); return; }
    if (!window.JSZip) { toast('The ZIP library did not load — check the internet connection.'); return; }
    var name = ($('pr-zipname').value || 'fbdi').trim().replace(/[^\w.-]+/g, '_').replace(/\.zip$/i, '') + '.zip';
    var zip = new JSZip(), files = C.built.sheets.map(function (s) { var t = FE.toCsv(s, (prSpec(P.load.tpl) || {}).end); return { name: s.csv + '.csv', rows: s.rows.length, text: t, bytes: FE.utf8Bytes(t) }; });
    files.forEach(function (f) { zip.file(f.name, f.text); });
    prSetBusy('Building ' + name + '…');
    // the stored load must match the ZIP — save pending edits first
    (P.dirty || P.srcDirty ? prSave(true) : Promise.resolve()).then(function () {
        return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    }).then(function (blob) {
        prDownload(blob, name);
        C.zip = { name: name, bytes: blob.size, files: files };
        prSetBusy('Storing the files in APEX…');
        return prRecordRun('GENERATE', C);
    }).then(function (runId) {
        prSetBusy(null);
        toast(name + ' downloaded and stored in APEX' + (runId ? ' (run ' + runId + ')' : ''));
        P.runs = null;
    }).catch(function (e) { prSetBusy(null); toast('Generate failed: ' + e); });
}
function prDownload(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 1500);
}
/** Record a CHECK or GENERATE run (and the CSVs of a GENERATE) in APEX. Resolves the run id. */
function prRecordRun(type, C) {
    var L = P.load; if (!L) return Promise.resolve(null);
    var gen = type === 'GENERATE', status = gen ? 'GENERATED' : C.status;
    var summary = {
        sheets: C.built.sheets.map(function (s) { return { csv: s.csv, rows: s.rows.length }; }),
        checks: C.byCheck, fusion: (C.fusion || []).map(function (f) { return { id: f.id, name: f.name, status: f.status, count: f.count, error: f.error }; }),
        issues: C.issues.slice(0, 300).map(function (i) { return [i.csv, i.r + 1, i.sev, i.msg]; }), docKey: L.options.docKey, ms: C.ms
    };
    var user = appUserName(), runId;
    return prWrite('INSERT INTO wms_fbdi_load_runs (load_id, template_file, release, run_type, status, source_rows, output_rows, error_count, warning_count, zip_name, zip_bytes, summary_json, run_by) VALUES (' +
        prN(L.id) + ', ' + prV(L.tpl, 100) + ', ' + prV(relLabel(DL.release), 5) + ', ' + prV(type, 20) + ', ' + prV(status, 20) + ', ' + prN(P.src.rows.length) + ', ' + prN(C.outRows) + ', ' +
        prN(C.errors) + ', ' + prN(C.warnings) + ', ' + (gen ? prV(C.zip.name, 200) + ', ' + prN(C.zip.bytes) : 'NULL, NULL') + ', ' + prClob(JSON.stringify(summary)) + ', ' + prV(user, 120) + ')')
        .then(function () { return prRead('SELECT MAX(run_id) AS id FROM wms_fbdi_load_runs WHERE load_id = ' + prN(L.id) + ' AND run_type = ' + prV(type, 20), 1); })
        .then(function (r) {
            runId = r.length ? +r[0].ID : null;
            if (!gen || !runId) return;
            return prSeq(C.zip.files, function (f) {
                var chunks = []; for (var i = 0; i < f.text.length; i += PR_FILE_CHUNK) chunks.push(f.text.slice(i, i + PR_FILE_CHUNK));
                if (!chunks.length) chunks.push('');
                return prWrite('INSERT INTO wms_fbdi_run_files (run_id, csv_name, row_count, byte_count, content) VALUES (' + prN(runId) + ', ' + prV(f.name, 100) + ', ' + prN(f.rows) + ', ' + prN(f.bytes) + ', ' + prClob(chunks[0]) + ')')
                    .then(function () {
                        return prSeq(chunks.slice(1), function (ch) {
                            return prWrite('UPDATE wms_fbdi_run_files SET content = content || ' + prClob(ch) + ' WHERE run_id = ' + prN(runId) + ' AND csv_name = ' + prV(f.name, 100));
                        });
                    });
            });
        })
        .then(function () {
            return prWrite('UPDATE wms_fbdi_loads SET last_run_id = ' + prN(runId) + ', last_run_status = ' + prV(status, 20) + ', last_run_date = SYSDATE, status = ' +
                prV(gen ? 'GENERATED' : 'CHECKED', 20) + ' WHERE load_id = ' + prN(L.id));
        })
        .then(function () {
            var li = P.list.filter(function (x) { return x.id === L.id; })[0];
            if (li) { li.lastStatus = status; li.lastRun = new Date().toISOString().slice(0, 16).replace('T', ' '); }
            prRenderList();
            return runId;
        });
}

// ── History ────────────────────────────────────────────────────
function prRenderHistory() {
    var el = $('pr-body');
    if (!P.runs) {
        el.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch spin"></i> Loading history…</div>';
        prRead("SELECT run_id, run_type, status, release, source_rows, output_rows, error_count, warning_count, zip_name, zip_bytes, run_by, TO_CHAR(run_date, 'YYYY-MM-DD HH24:MI') AS run_date, " +
            '(SELECT COUNT(*) FROM wms_fbdi_run_files f WHERE f.run_id = r.run_id) AS files FROM wms_fbdi_load_runs r WHERE load_id = ' + prN(P.load.id) + ' ORDER BY run_id DESC', 200)
            .then(function (rows) { P.runs = rows; if (P.step === 'history') prRenderHistory(); })
            .catch(function (e) { el.innerHTML = '<div class="empty">' + esc(String(e)) + '</div>'; });
        return;
    }
    if (!P.runs.length) { el.innerHTML = '<div class="empty">No checks or ZIPs yet.</div>'; return; }
    el.innerHTML = '<div class="grid-w"><table class="grid hist"><thead><tr><th>Run</th><th>When</th><th>What</th><th>Result</th><th>Rows</th><th>Errors</th><th>Warnings</th><th>ZIP</th><th>By</th><th></th></tr></thead><tbody>' +
        P.runs.map(function (r) {
            return '<tr><td>' + r.RUN_ID + '</td><td>' + esc(r.RUN_DATE) + '</td><td>' + (r.RUN_TYPE === 'GENERATE' ? '<i class="fa-solid fa-file-zipper"></i> Generate' : '<i class="fa-solid fa-list-check"></i> Check') + '</td>' +
                '<td>' + prStatusChip(r.STATUS) + '</td><td>' + (r.SOURCE_ROWS || 0) + ' → ' + (r.OUTPUT_ROWS || 0) + '</td><td>' + (r.ERROR_COUNT || 0) + '</td><td>' + (r.WARNING_COUNT || 0) + '</td>' +
                '<td>' + (r.ZIP_NAME ? esc(r.ZIP_NAME) + ' <small class="muted">' + fmtSize(+r.ZIP_BYTES || 0) + ' · R' + esc(r.RELEASE || '') + '</small>' : '') + '</td><td>' + esc(r.RUN_BY || '') + '</td>' +
                '<td>' + (+r.FILES ? '<button class="btn sm" data-rezip="' + r.RUN_ID + '" data-zipname="' + esc(r.ZIP_NAME || '') + '"><i class="fa-solid fa-download"></i> ZIP</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="muted" style="margin-top:8px">A ZIP is rebuilt from the CSV files stored in APEX for that run.</p>';
}
function prRezip(runId, name) {
    if (!window.JSZip) { toast('The ZIP library did not load.'); return; }
    prSetBusy('Rebuilding ' + name + ' from APEX…');
    prRead('SELECT csv_name FROM wms_fbdi_run_files WHERE run_id = ' + prN(runId) + ' ORDER BY csv_name', 50).then(function (files) {
        var zip = new JSZip();
        return prSeq(files, function (f) {
            return prReadClob('wms_fbdi_run_files', 'content', 'run_id = ' + prN(runId) + ' AND csv_name = ' + prV(f.CSV_NAME, 100)).then(function (text) { zip.file(f.CSV_NAME, text); });
        }).then(function () { return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }); });
    }).then(function (blob) { prSetBusy(null); prDownload(blob, name || ('fbdi_run_' + runId + '.zip')); })
      .catch(function (e) { prSetBusy(null); toast('Could not rebuild the ZIP: ' + e); });
}

// ── modal + events ─────────────────────────────────────────────
function prModal(html) {
    var bg = $('pr-modal');
    if (!html) { bg.classList.remove('show'); return; }
    $('pr-modal-box').className = 'modal';
    $('pr-modal-box').innerHTML = html; bg.classList.add('show');
}
function prInsert(text) {
    var inp = P.focusInput && document.body.contains(P.focusInput) ? P.focusInput : null;
    if (!inp) { toast('Click a mapping field first, then the column.'); return; }
    var s = inp.selectionStart != null ? inp.selectionStart : inp.value.length, e = inp.selectionEnd != null ? inp.selectionEnd : s;
    if (text.charAt(0) === '|') {            // a function goes inside the {…} the caret is in (or the last one)
        var before = inp.value.slice(0, s), close = inp.value.indexOf('}', s), open = before.lastIndexOf('{');
        if (open >= 0 && close >= 0 && before.lastIndexOf('}') < open) s = e = close;
        else { var lc = inp.value.lastIndexOf('}'); if (lc >= 0) s = e = lc; else { toast('Add a {column} first.'); return; } }
    }
    inp.value = inp.value.slice(0, s) + text + inp.value.slice(e);
    inp.focus(); inp.selectionStart = inp.selectionEnd = s + text.length;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
}

(function prWire() {
    if (!$('page-prepare')) return;
    $('pr-new').addEventListener('click', function () { prNewLoad(); });
    $('pr-q').addEventListener('input', function () { P.q = this.value.trim(); prRenderList(); });
    $('pr-list').addEventListener('click', function (e) {
        var d = e.target.closest('[data-del]'); if (d) { e.stopPropagation(); prDelete(+d.getAttribute('data-del')); return; }
        var it = e.target.closest('.pr-it'); if (it) prSelect(+it.getAttribute('data-id'));
    });
    $('pr-refresh').addEventListener('click', function () { prRefresh(); });
    $('pr-modal').addEventListener('click', function (e) {
        if (e.target === this) prModal(null);
        var b = e.target.closest('[data-mact]'); if (!b) return;
        if (b.getAttribute('data-mact') === 'close') prModal(null);
        if (b.getAttribute('data-mact') === 'create') prCreate();
        if (b.getAttribute('data-mact') === 'chtpl') prApplyTemplate();
    });
    $('pr-modal').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'pr-f-name') prCreate(); if (e.key === 'Escape') prModal(null); });
    var main = $('pr-main'), mt;
    main.addEventListener('click', function (e) {
        var t = e.target, b;
        if ((b = t.closest('[data-new]'))) { prNewLoad(b.getAttribute('data-new')); return; }
        if ((b = t.closest('[data-step]'))) { P.step = b.getAttribute('data-step'); prRenderMain(); return; }
        if ((b = t.closest('[data-srctype]'))) { P.load.srcType = b.getAttribute('data-srctype'); P.dirty = true; P.wb = null; prRenderMain(); return; }
        if (t.closest('select, input, label.sw')) return;
        if ((b = t.closest('[data-tplsheet]'))) { P.tplSheet = b.getAttribute('data-tplsheet'); prRenderTemplate(); return; }
        if ((b = t.closest('[data-tplview]'))) { P.tplView = b.getAttribute('data-tplview'); prRenderTemplate(); return; }
        if ((b = t.closest('[data-gocol]'))) { var gc = b.getAttribute('data-gocol').split('|'); P.mapCsv = gc[0]; P.mapFilter = 'all'; P.mapQ = gc.slice(1).join('|'); P.step = 'map'; prRenderMain(); return; }
        if ((b = t.closest('[data-mapcsv]'))) { var csv = b.getAttribute('data-mapcsv'); if (P.step === 'template') { P.tplSheet = csv; prRenderTemplate(); } else { P.mapCsv = csv; prRenderMap(); } return; }
        if ((b = t.closest('[data-mfilter]'))) { P.mapFilter = b.getAttribute('data-mfilter'); prRenderMap(); return; }
        if ((b = t.closest('[data-outcsv]'))) { P.outCsv = b.getAttribute('data-outcsv'); prRenderCheckBody(); return; }
        if ((b = t.closest('[data-ins]'))) { prInsert(b.getAttribute('data-ins')); return; }
        if ((b = t.closest('[data-insf]'))) { prInsert(b.getAttribute('data-insf')); return; }
        if ((b = t.closest('[data-showsql]'))) { prModal('<h2>Check query</h2><pre class="code">' + esc(b.getAttribute('data-showsql')) + '</pre><div class="modal-f"><button class="btn" data-mact="close">Close</button></div>'); return; }
        if ((b = t.closest('[data-gosrc]'))) { e.preventDefault(); P.step = 'source'; P.srcOnlyBad = true; prRenderMain(); return; }
        if ((b = t.closest('[data-rezip]'))) { prRezip(+b.getAttribute('data-rezip'), b.getAttribute('data-zipname')); return; }
        if (!(b = t.closest('[data-pact]'))) return;
        var a = b.getAttribute('data-pact');
        if (a === 'chtpl') prChangeTemplate();
        else if (a === 'reopen') { var rid = P.selId; P.selId = null; prSelect(rid); }
        else if (a === 'save') prSave();
        else if (a === 'delete') prDelete();
        else if (a === 'usesheet') prUseSheet();
        else if (a === 'usepaste') prUsePaste();
        else if (a === 'runsql') prRunSql();
        else if (a === 'browse') paBrowseTables();
        else if (a === 'inputtpl') itDialog();
        else if (a === 'prepfbdi') pfStart();
        else if (a === 'automap') { var n = prAutoMap(true); toast(n ? 'Mapped ' + n + ' more columns' : 'Nothing new to map — names did not match'); prRenderMain(); }
        else if (a === 'check') prRunCheck($('pr-live') && $('pr-live').checked);
        else if (a === 'checkgo') { P.step = 'check'; prRenderMain(); prRunCheck(P.load.options.live !== false).then(function () { P.step = 'generate'; prRenderMain(); }); }
        else if (a === 'generate') prGenerate();
    });
    main.addEventListener('change', function (e) {
        var t = e.target, L = P.load; if (!L) return;
        if (t.id === 'pr-file' && t.files[0]) prReadFile(t.files[0]);
        else if (t.id === 'pr-force') { var g = document.querySelector('[data-pact="generate"]'); if (g) g.disabled = !t.checked; }
        else if (t.id === 'pr-wsheet') { P.wbSheet = t.value; P.wbHeader = prGuessHeader(P.wb.Sheets[t.value]); prRenderSource(); }
        else if (t.hasAttribute('data-incl')) { prSheetOpt(t.getAttribute('data-incl')).include = t.checked; P.dirty = true; prRenderMain(); }
        else if (t.hasAttribute('data-mode')) { prSheetOpt(t.getAttribute('data-mode')).mode = t.value; P.dirty = true; prRenderMain(); }
        else if (t.id === 'pr-hideempty') { P.tplHideEmpty = t.checked; prRenderTemplate(); }
        else if (t.id === 'pr-dorder') { L.options.dateOrder = t.value; P.dirty = true; prRenderHead(); }
        else if (t.id === 'pr-live') { L.options.live = t.checked; P.dirty = true; prRenderHead(); }
        else if (t.id === 'pr-onlybad') { P.srcOnlyBad = t.checked; prRenderSrcGrid(); }
        else if (t.id === 'pr-dockey') { prRenderMap(); }
    });
    main.addEventListener('input', function (e) {
        var t = e.target, L = P.load; if (!L) return;
        if (t.hasAttribute('data-map')) {
            var m = L.maps[P.mapCsv] = L.maps[P.mapCsv] || {};
            if (t.value.trim()) m[+t.getAttribute('data-map')] = t.value; else delete m[+t.getAttribute('data-map')];
            P.dirty = true; prRenderHead();
            clearTimeout(mt); mt = setTimeout(function () {
                var tr = t.closest('tr'), p = prPreview(P.mapCsv)[+t.getAttribute('data-map') - 1] || {};
                if (tr) { tr.classList.toggle('has', !!t.value.trim()); tr.querySelector('.pv').innerHTML = p.err ? '<span class="pv-err"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(p.err) + '</span>' : esc((p.vals || []).join('  ·  ')); }
            }, 250);
        } else if (t.id === 'pr-dockey') { L.options.docKey = t.value.trim(); P.dirty = true; prRenderHead(); }
        else if (t.id === 'pr-mapq') { P.mapQ = t.value.trim(); prRenderMapRows(); }
        else if (t.id === 'pr-name') { L.name = t.value.trim() || L.name; P.dirty = true; }
        else if (t.id === 'pr-sql') { L.srcSql = t.value; P.dirty = true; }
    });
    main.addEventListener('focusin', function (e) { if (e.target.hasAttribute('data-map') || e.target.id === 'pr-dockey') P.focusInput = e.target; });
    main.addEventListener('focusout', function (e) {
        var t = e.target;
        if (t.id === 'pr-name') prRenderHead();
        if (t.hasAttribute && t.hasAttribute('data-r')) {                  // edited a source cell
            var r = +t.getAttribute('data-r'), c = +t.getAttribute('data-c'), v = t.textContent;
            if (FE.str(P.src.rows[r][c]) !== v) { P.src.rows[r][c] = v; P.srcVer = (P.srcVer || 0) + 1; P.srcDirty = P.dirty = true; prRenderHead(); t.classList.add('edited'); }
        }
    });
    main.addEventListener('keydown', function (e) {
        if (e.target.hasAttribute && e.target.hasAttribute('data-r') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (P.dirty || P.srcDirty) prSave(); }
    });
    main.addEventListener('dragover', function (e) { var d = e.target.closest('#pr-drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
    main.addEventListener('dragleave', function (e) { var d = e.target.closest('#pr-drop'); if (d) d.classList.remove('over'); });
    main.addEventListener('drop', function (e) { var d = e.target.closest('#pr-drop'); if (d) { e.preventDefault(); d.classList.remove('over'); if (e.dataTransfer.files[0]) prReadFile(e.dataTransfer.files[0]); } });
    window.addEventListener('beforeunload', function (e) { if (P.dirty || P.srcDirty) { e.preventDefault(); e.returnValue = ''; } });
})();
