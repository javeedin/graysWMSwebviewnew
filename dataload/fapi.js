/* Data Loading › Fusion API — load data through Oracle Fusion REST instead of (or next to) FBDI.
   Catalog (fapi-catalog.js) by module × Setup / Masters / Transactions / Integration; every resource is read
   live from the pod with /describe (fields, required, lengths, child collections, actions). The loader takes
   Excel / paste / APEX SQL / Fusion SQL rows, maps them with the same expressions as Prepare & Load
   ({Col|date|num…}), groups lines into a child collection when asked, validates against the describe, and
   POSTs (create) or PATCHes (update) record by record through the host action dataLoadFusionRest (Fusion
   credentials stay in C#). Mappings (jobs), runs and per-record results are kept in APEX
   (apex_sql/72_fusion_api_loads.sql, auto-created). */

var FA_REST_VER = '11.13.18.05';
var FA = { kind: 'ALL', area: 'ALL', q: '', sel: null, view: 'fields', pod: {}, desc: {}, src: null, cfg: null, run: null, runs: null, jobs: null, sample: null };
var FA_DDL = {
    WMS_FAPI_JOBS: 'CREATE TABLE wms_fapi_jobs (job_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, job_name VARCHAR2(200) NOT NULL, resource_name VARCHAR2(100) NOT NULL, ' +
        "api VARCHAR2(10) DEFAULT 'fscm', config_json CLOB, created_by VARCHAR2(120), created_date DATE DEFAULT SYSDATE, updated_by VARCHAR2(120), updated_date DATE DEFAULT SYSDATE)",
    WMS_FAPI_RUNS: 'CREATE TABLE wms_fapi_runs (run_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, job_id NUMBER, resource_name VARCHAR2(100) NOT NULL, api VARCHAR2(10), ' +
        "method VARCHAR2(10), instance VARCHAR2(10), status VARCHAR2(20), total_count NUMBER, ok_count NUMBER, error_count NUMBER, source_note VARCHAR2(400), config_json CLOB, " +
        'run_by VARCHAR2(120), started_date DATE DEFAULT SYSDATE, finished_date DATE, elapsed_ms NUMBER)',
    WMS_FAPI_RUN_ROWS: 'CREATE TABLE wms_fapi_run_rows (run_id NUMBER NOT NULL, rec_no NUMBER NOT NULL, source_rows VARCHAR2(400), status VARCHAR2(10), http_status NUMBER, ' +
        'result_key VARCHAR2(200), message VARCHAR2(4000), payload CLOB, CONSTRAINT wms_fapi_run_rows_pk PRIMARY KEY (run_id, rec_no))'
};
var _faEnsured = null;
function faEnsure() {
    if (_faEnsured) return _faEnsured;
    _faEnsured = prRead("SELECT table_name FROM user_tables WHERE table_name LIKE 'WMS\\_FAPI%' ESCAPE '\\'", 20).then(function (r) {
        var have = {}; r.forEach(function (x) { have[x.TABLE_NAME] = 1; });
        return prSeq(Object.keys(FA_DDL).filter(function (t) { return !have[t]; }), function (t) { return prWrite(FA_DDL[t]); });
    }).catch(function (e) { _faEnsured = null; throw e; });
    return _faEnsured;
}

// ── helpers ────────────────────────────────────────────────────
function faBase() { var b = window.FX_BASE || { PROD: 'https://efmh.fa.em3.oraclecloud.com', TEST: 'https://efmh-test.fa.em3.oraclecloud.com' }; return b[currentInstance()] || b.PROD; }
function faUrl(c, tail) { return faBase() + '/' + (c.api || 'fscm') + 'RestApi/resources/' + FA_REST_VER + '/' + c.r + (tail || ''); }
function faAreas() { return FBDI_AREAS.concat(FAPI_AREAS_EXTRA); }
function faArea(code) { for (var i = 0, a = faAreas(); i < a.length; i++) if (a[i][0] === code) return { code: a[i][0], name: a[i][1], color: a[i][2] }; return { code: code, name: code, color: '#64748b' }; }
function faKind(k) { for (var i = 0; i < FAPI_KINDS.length; i++) if (FAPI_KINDS[i][0] === k) return FAPI_KINDS[i]; return [k, k, '', 'fa-circle']; }
function faOps(ops) {
    return (ops || '').split('').map(function (o) { return '<span class="fap-op ' + o + '">' + ({ G: 'GET', P: 'POST', U: 'PATCH' }[o] || o) + '</span>'; }).join('');
}
/** One REST call → { status, json, text }. Throws on transport errors only; HTTP errors come back with their status. */
function faRest(method, url, body) {
    return host('dataLoadFusionRest', { method: method, url: url, body: body == null ? null : JSON.stringify(body), framework: '4' }).then(function (d) {
        if (!d || d.ok === false) throw (d && d.error) || 'No answer from the app';
        var j = null; try { j = d.body ? JSON.parse(d.body) : null; } catch (e) { }
        return { status: d.status, json: j, text: d.body || '', ms: d.ms };
    });
}
/** Fusion's error text, whichever shape it comes in (plain text, v4 JSON with o:errorDetails, ADF JSON). */
function faErr(r) {
    if (!r) return '';
    var j = r.json;
    if (j) {
        var det = j['o:errorDetails'] || j.errorDetails;
        if (det && det.length) return det.map(function (x) { return x.detail || x.title || JSON.stringify(x); }).join(' · ');
        if (j.detail || j.title) return (j.title || '') + (j.detail ? ': ' + j.detail : '');
    }
    return String(r.text || ('HTTP ' + r.status)).replace(/\s+/g, ' ').slice(0, 1500);
}
function faLs(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem('fa_' + k) || 'null'); localStorage.setItem('fa_' + k, JSON.stringify(v)); } catch (e) { return null; } }

// ── tab ────────────────────────────────────────────────────────
function faOpenTab() {
    FA.pod = faLs('pod_' + currentInstance()) || {};
    faRenderList();
    if (!FA.sel) faRenderMain();
}
function faFiltered() {
    var q = FA.q.toLowerCase();
    return FAPI_CATALOG.filter(function (c) {
        if (FA.kind !== 'ALL' && c.k !== FA.kind) return false;
        if (FA.area !== 'ALL' && c.a !== FA.area) return false;
        return !q || (c.n + ' ' + c.r + ' ' + c.d + ' ' + faArea(c.a).name + ' ' + (c.ch || []).join(' ')).toLowerCase().indexOf(q) >= 0;
    });
}
function faRenderList() {
    var el = $('fa-list'); if (!el) return;
    var kinds = '<div class="fap-kinds">' + [['ALL', 'All', '', 'fa-layer-group']].concat(FAPI_KINDS).map(function (k) {
        var n = k[0] === 'ALL' ? FAPI_CATALOG.length : FAPI_CATALOG.filter(function (c) { return c.k === k[0]; }).length;
        return '<button class="' + (FA.kind === k[0] ? 'on' : '') + '" data-fakind="' + k[0] + '" title="' + esc(k[2]) + '"><i class="fa-solid ' + k[3] + '"></i> ' + k[1] + ' <small>' + n + '</small></button>';
    }).join('') + '</div>';
    var list = faFiltered(), groups = {}, order = [];
    list.forEach(function (c) { if (!groups[c.a]) { groups[c.a] = []; order.push(c.a); } groups[c.a].push(c); });
    el.innerHTML = kinds + (list.length ? order.map(function (a) {
        var A = faArea(a);
        return '<div class="fap-grp" style="--ac:' + A.color + '"><div class="fap-gh">' + esc(A.name) + '</div>' + groups[a].map(function (c) {
            var p = FA.pod[c.r];
            return '<button class="fap-it' + (FA.sel && FA.sel.r === c.r ? ' sel' : '') + '" data-fares="' + esc(c.r) + '">' +
                '<span class="fap-kd ' + c.k + '">' + faKind(c.k)[1].slice(0, 1) + '</span><span class="tx"><b>' + esc(c.n) + '</b><small>' + esc(c.r) + '</small></span>' +
                (p ? '<i class="fa-solid ' + (p === 'ok' ? 'fa-circle-check ok' : p === 'no' ? 'fa-circle-xmark no' : 'fa-circle-question q') + '" title="' + ({ ok: 'Available on this pod', no: 'Not found on this pod', err: 'Could not check' }[p] || '') + '"></i>' : '') + '</button>';
        }).join('') + '</div>';
    }).join('') : '<div class="empty">No API matches.</div>');
}

// ── overview: module × category ─────────────────────────────────
function faRenderMain() {
    var el = $('fa-main'); if (!el) return;
    if (FA.sel) { faRenderResource(); return; }
    var areas = []; FAPI_CATALOG.forEach(function (c) { if (areas.indexOf(c.a) < 0) areas.push(c.a); });
    var h = '<div class="welcome fap-wel"><h2>Fusion API</h2><p>Load data straight through Oracle Fusion REST — one record at a time, with Fusion\'s answer (new id or the exact error) for every row. ' +
        'Use it for setups, masters and moderate volumes that must land now; use FBDI (Prepare &amp; Load) for thousands of rows. Every API is read live from your pod, so the fields and required columns are always the pod\'s own.</p>' +
        '<div class="fap-open"><select id="fa-any-api"><option value="fscm">fscmRestApi</option><option value="hcm">hcmRestApi</option><option value="crm">crmRestApi</option></select>' +
        '<input id="fa-any" placeholder="Any other resource, e.g. supplierSites, bankAccountsLOV…" autocomplete="off"><button class="btn" data-faact="any"><i class="fa-solid fa-magnifying-glass"></i> Open</button>' +
        '<button class="btn ghost" data-faact="checkall" title="Ask the pod which of these APIs it has"><i class="fa-solid fa-satellite-dish"></i> Check all on pod</button></div>' +
        '<table class="fap-matrix"><thead><tr><th>Module</th>' + FAPI_KINDS.map(function (k) { return '<th title="' + esc(k[2]) + '"><i class="fa-solid ' + k[3] + '"></i> ' + k[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
        areas.map(function (a) {
            var A = faArea(a);
            return '<tr style="--ac:' + A.color + '"><th>' + esc(A.name) + '</th>' + FAPI_KINDS.map(function (k) {
                return '<td>' + FAPI_CATALOG.filter(function (c) { return c.a === a && c.k === k[0]; }).map(function (c) {
                    var p = FA.pod[c.r];
                    return '<button class="fap-chip' + (p === 'no' ? ' no' : '') + '" data-fares="' + esc(c.r) + '" title="' + esc(c.d) + '">' + esc(c.n) + (c.ops.indexOf('P') >= 0 ? '' : ' <small>read</small>') + '</button>';
                }).join('') + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table>' +
        '<div class="fap-legend"><span><b>API or FBDI?</b></span><span><i class="fa-solid fa-bolt"></i> API: immediate result per record, ids back, fits setups, masters and up to a few hundred documents</span>' +
        '<span><i class="fa-solid fa-truck-ramp-box"></i> FBDI: bulk (thousands of rows), one import job, errors in the import report</span></div></div>';
    el.innerHTML = h;
}
function faCheckAll() {
    var list = FAPI_CATALOG.slice(), done = 0;
    toast('Checking ' + list.length + ' APIs on ' + currentInstance() + '…');
    return prSeq(list, function (c) {
        return faPodCheck(c).then(function () { done++; if (done % 6 === 0) { faRenderList(); if (!FA.sel) faRenderMain(); } });
    }).then(function () {
        faRenderList(); if (!FA.sel) faRenderMain();
        var ok = list.filter(function (c) { return FA.pod[c.r] === 'ok'; }).length;
        toast(ok + ' of ' + list.length + ' APIs are available on ' + currentInstance());
    });
}
function faPodCheck(c) {
    return faRest('GET', faUrl(c, '?limit=1&onlyData=true')).then(function (r) {
        FA.pod[c.r] = r.status >= 200 && r.status < 300 ? 'ok' : r.status === 404 ? 'no' : 'err';
    }).catch(function () { FA.pod[c.r] = 'err'; }).then(function () { faLs('pod_' + currentInstance(), FA.pod); });
}

// ── one resource ───────────────────────────────────────────────
function faSelect(r, custom) {
    var c = custom || FAPI_CATALOG.filter(function (x) { return x.r === r; })[0]; if (!c) return;
    FA.sel = c; FA.view = 'fields'; FA.jobId = null; FA.jobName = '';
    FA.cfg = faDefaultCfg(); FA.run = null; FA.runs = null; FA.jobs = null; FA.sample = null; FA.sample0 = null;
    faRenderList(); faRenderResource();
    faDescribe(c).then(function () { if (FA.sel === c) { faAutoMap(); faRenderResource(); } });
    if (!FA.pod[c.r]) faPodCheck(c).then(function () { faRenderList(); if (FA.sel === c) faRenderHead(); });
}
function faDefaultCfg() { return { method: 'POST', child: '', groupBy: '', keyExpr: '', map: {}, cmap: {}, par: 2, stopAfter: 20, dateOrder: 'dmy', srcType: 'PASTE', srcSql: '' }; }
function faDescribe(c) {
    var k = (c.api || 'fscm') + ':' + c.r;
    if (FA.desc[k]) return Promise.resolve(FA.desc[k]);
    FA.desc[k] = null;
    return faRest('GET', faUrl(c, '/describe')).then(function (r) {
        if (r.status >= 300 || !r.json) throw faErr(r) || 'HTTP ' + r.status;
        var res = r.json.Resources || r.json, obj = res[c.r] || res[Object.keys(res)[0]] || {};
        return (FA.desc[k] = faParseDesc(obj));
    }).catch(function (e) { FA.desc[k] = { error: String(e) }; return FA.desc[k]; });
}
function faParseDesc(obj) {
    function attrs(o) {
        return (o.attributes || []).map(function (a) {
            return { name: a.name, type: String(a.type || 'string').toLowerCase(), req: !!a.mandatory && a.updatable !== false, mand: !!a.mandatory, upd: a.updatable !== false,
                len: +a.maxLength || null, prec: a.precision, title: a.title || a.name, help: (a.annotations && a.annotations.description) || '', lov: !!(a.lov || a.hasLov) };
        });
    }
    var children = {};
    Object.keys(obj.children || {}).forEach(function (n) { children[n] = { attrs: attrs(obj.children[n]), children: Object.keys(obj.children[n].children || {}) }; });
    var actions = [];
    (function walk(o, d) { if (!o || typeof o !== 'object' || d > 3) return; if (Array.isArray(o.actions)) o.actions.forEach(function (x) { if (x && x.name && actions.indexOf(x.name) < 0) actions.push(x.name); }); ['item', 'collection'].forEach(function (k) { walk(o[k], d + 1); }); })(obj, 0);
    return { attrs: attrs(obj), children: children, actions: actions, title: obj.title || '' };
}
function faD() { var c = FA.sel; return c && FA.desc[(c.api || 'fscm') + ':' + c.r]; }
function faRenderHead() {
    var c = FA.sel, el = $('fap-head'); if (!c || !el) return;
    var A = faArea(c.a), K = faKind(c.k), p = FA.pod[c.r], t = c.f && tplByFile(c.f);
    el.innerHTML = '<div class="fap-ic" style="--ac:' + A.color + '"><i class="fa-solid ' + K[3] + '"></i></div><div class="grow"><h2>' + esc(c.n) + '</h2>' +
        '<div class="muted pr-sub"><code>/' + esc(c.api || 'fscm') + 'RestApi/resources/' + FA_REST_VER + '/' + esc(c.r) + '</code> · ' + esc(A.name) + ' · <span class="fap-kd ' + c.k + ' wide">' + K[1] + '</span> ' + faOps(c.ops) +
        (p ? ' · <span class="chip ' + (p === 'ok' ? 'ok' : p === 'no' ? 'err' : 'warn') + '">' + ({ ok: 'on this pod', no: 'not on this pod', err: 'not checked' }[p]) + '</span>' : '') + '</div>' +
        '<p class="fap-d">' + esc(c.d || '') + '</p></div>' +
        (t ? '<button class="btn" data-faact="fbdi" title="Load the same data in bulk with ' + esc(t.n) + '"><i class="fa-solid fa-truck-ramp-box"></i> Bulk? Use FBDI</button>' : '');
}
var FA_VIEWS = [['fields', 'fa-list', 'Fields'], ['sample', 'fa-table', 'Sample data'], ['query', 'fa-magnifying-glass', 'Query'], ['load', 'fa-upload', 'Load data'], ['runs', 'fa-clock-rotate-left', 'Runs']];
function faRenderResource() {
    var c = FA.sel, el = $('fa-main'); if (!c) return;
    var canLoad = /[PU]/.test(c.ops || 'GPU');
    el.innerHTML = '<div class="pr-head fap-head" id="fap-head"></div><nav class="pr-steps">' + FA_VIEWS.filter(function (v) { return v[0] !== 'load' || canLoad; }).map(function (v) {
        return '<button class="pr-step' + (FA.view === v[0] ? ' on' : '') + '" data-faview="' + v[0] + '"><i class="fa-solid ' + v[1] + '"></i> ' + v[2] + '</button>';
    }).join('') + '</nav><div id="fa-body" class="pr-body"></div>';
    faRenderHead();
    if (FA.view === 'load' && !canLoad) FA.view = 'fields';
    ({ fields: faRenderFields, sample: faRenderSample, query: faRenderQuery, load: faRenderLoad, runs: faRenderRuns })[FA.view]();
}

// ── Fields (live /describe) ────────────────────────────────────
function faRenderFields() {
    var d = faD(), el = $('fa-body');
    if (d === undefined || d === null) { el.innerHTML = '<div class="empty"><i class="fa-solid fa-spinner fa-spin"></i> Reading the fields from the pod…</div>'; return; }
    if (d.error) { el.innerHTML = '<div class="note err"><i class="fa-solid fa-circle-xmark"></i> Could not describe this API: ' + esc(d.error) + ' <button class="btn sm" data-faact="redescribe">Try again</button></div>'; return; }
    var q = (FA.fq || '').toLowerCase();
    var tbl = function (attrs) {
        var list = attrs.filter(function (a) { return !q || (a.name + ' ' + a.title + ' ' + a.help).toLowerCase().indexOf(q) >= 0; })
            .sort(function (a, b) { return (b.req - a.req); });
        return '<table class="grid fap-fields"><thead><tr><th>Field</th><th>Title</th><th>Type</th><th>Len</th><th>Req</th><th>Upd</th><th>Description</th></tr></thead><tbody>' +
            list.map(function (a) {
                return '<tr' + (a.req ? ' class="req"' : '') + '><td><code>' + esc(a.name) + '</code>' + (a.lov ? ' <small class="muted">LOV</small>' : '') + '</td><td>' + esc(a.title) + '</td><td>' + esc(a.type) + '</td><td>' + (a.len || '') + '</td>' +
                    '<td>' + (a.req ? '<b class="req">yes</b>' : a.mand ? '<small class="muted">system</small>' : '') + '</td><td>' + (a.upd ? '' : '<small class="muted">read-only</small>') + '</td><td class="fap-help">' + esc(a.help.slice(0, 220)) + '</td></tr>';
            }).join('') + '</tbody></table>';
    };
    var ch = Object.keys(d.children);
    el.innerHTML = '<div class="fap-fbar"><div class="pr-search"><i class="fa-solid fa-magnifying-glass"></i><input id="fa-fq" type="search" placeholder="Filter fields…" value="' + esc(FA.fq || '') + '"></div>' +
        '<span class="muted">' + d.attrs.length + ' fields · ' + d.attrs.filter(function (a) { return a.req; }).length + ' required' + (ch.length ? ' · ' + ch.length + ' child collections' : '') + (d.actions.length ? ' · actions: ' + esc(d.actions.slice(0, 8).join(', ')) : '') + '</span></div>' +
        tbl(d.attrs) + ch.map(function (n) { return '<h3 class="fap-h3"><i class="fa-solid fa-diagram-next"></i> child: ' + esc(n) + ' <small class="muted">' + d.children[n].attrs.length + ' fields</small></h3>' + tbl(d.children[n].attrs); }).join('');
}

// ── Sample data / Query (GET) and link drill-down ───────────────
/* Fusion returns every record with "links": self/canonical (the record), child (child collections such as
   invoiceLines), lov (the list of values behind a field) and enclosure (attachments / file content).
   faGrid shows them as chips; any chip opens in the drill dialog, which keeps a breadcrumb so you can go
   deeper (invoice → lines → distributions) and back. */
function faLinkChips(links, skipSelf) {
    return (links || []).filter(function (l) { return l && l.href && l.rel !== 'enclosure' && !(skipSelf && (l.rel === 'self' || l.rel === 'canonical')); })
        .filter(function (l, i, a) { return !(l.rel === 'canonical' && a.some(function (x) { return x.rel === 'self'; })); })
        .map(function (l) {
            var lab = l.rel === 'self' || l.rel === 'canonical' ? 'record' : (l.name || l.rel);
            return '<button class="fap-lk ' + esc(l.rel) + '" data-fadrill="' + esc(l.href) + '" data-fatitle="' + esc(lab) + '" title="' + esc(l.rel + ': ' + l.href) + '">' +
                '<i class="fa-solid ' + (l.rel === 'child' ? 'fa-diagram-next' : l.rel === 'lov' ? 'fa-list-ul' : 'fa-arrow-up-right-from-square') + '"></i> ' + esc(lab) + '</button>';
        }).join('');
}
function faCell(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return '<span class="muted">[' + v.length + ']</span>';
    if (typeof v === 'object') return '<span class="muted">{…}</span>';
    var s = String(v);
    if (/^https:\/\/[^\s]+\/(fscm|hcm|crm)RestApi\/resources\//.test(s)) return '<button class="fap-lk" data-fadrill="' + esc(s) + '" data-fatitle="link">' + esc(s.split('/').pop()) + '</button>';
    return esc(s);
}
/** Items → table: scalar columns, then the row's links as drill chips. */
function faGrid(items, opts) {
    opts = opts || {};
    var cols = [];
    items.forEach(function (it) { Object.keys(it).forEach(function (k) { if (k !== 'links' && cols.indexOf(k) < 0 && (it[k] == null || typeof it[k] !== 'object')) cols.push(k); }); });
    var hasLinks = items.some(function (it) { return (it.links || []).length; });
    return { cols: cols, html: '<div class="grid-w"><table class="grid fap-grid"><thead><tr>' + (hasLinks ? '<th>Drill</th>' : '') + cols.map(function (k) { return '<th>' + esc(k) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        items.map(function (it) { return '<tr>' + (hasLinks ? '<td class="fap-lks">' + faLinkChips(it.links) + '</td>' : '') + cols.map(function (k) { return '<td>' + faCell(it[k]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' };
}
function faGet(qs) {
    return faRest('GET', faUrl(FA.sel, qs)).then(function (r) {
        return r.status < 300 && r.json ? { items: r.json.items || [], hasMore: !!r.json.hasMore, ms: r.ms, count: r.json.count } : { error: faErr(r) };
    }).catch(function (e) { return { error: String(e) }; });
}
function faResultHtml(S, csvAct) {
    if (S.error) return '<div class="note err">' + esc(S.error) + '</div>';
    if (!S.items.length) return '<div class="empty">No records.</div>';
    var g = faGrid(S.items); S.cols = g.cols;
    return '<div class="grid-h"><b>' + S.items.length + ' row' + (S.items.length === 1 ? '' : 's') + '</b>' + (S.hasMore ? '<span class="muted">more on the pod</span>' : '') + '<span class="muted">' + S.ms + ' ms</span>' +
        '<span class="muted"><i class="fa-solid fa-diagram-next"></i> click a chip to drill into child records, lists of values or the record itself</span>' +
        '<button class="btn sm" data-faact="' + csvAct + '"><i class="fa-solid fa-file-csv"></i> CSV</button></div>' + g.html;
}
function faRenderSample() {
    var c = FA.sel, el = $('fa-body');
    if (!FA.sample0) {
        el.innerHTML = '<div class="empty"><i class="fa-solid fa-spinner fa-spin"></i> Reading 10 records from ' + currentInstance() + '…</div>';
        faGet('?limit=10').then(function (S) { if (FA.sel !== c) return; FA.sample0 = S; if (FA.view === 'sample') faRenderSample(); });
        return;
    }
    el.innerHTML = '<div class="row-f"><span class="muted">The first 10 records on ' + currentInstance() + ' — real values to copy the shape from before a load.</span><button class="btn sm ghost" data-faact="resample"><i class="fa-solid fa-rotate"></i> Refresh</button></div>' + faResultHtml(FA.sample0, 'scsv');
}
function faRenderQuery() {
    var S = FA.sample, el = $('fa-body');
    var h = '<div class="row-f fap-qbar"><label class="fld grow"><span>Filter <em>(q=, e.g. SupplierNumber=\'1001\' or InvoiceAmount&gt;1000)</em></span><input id="fa-qq" value="' + esc(FA.qq || '') + '"></label>' +
        '<label class="fld"><span>Fields <em>(optional)</em></span><input id="fa-qf" value="' + esc(FA.qf || '') + '" placeholder="Name,Id…"></label>' +
        '<label class="fld"><span>Rows</span><input id="fa-ql" type="number" min="1" max="500" value="' + (FA.ql || 25) + '" style="width:80px"></label>' +
        '<button class="btn primary" data-faact="query"><i class="fa-solid fa-play"></i> Run</button></div>';
    h += S ? faResultHtml(S, 'qcsv') : '<div class="empty">Read live records — handy to look up ids and codes before a load, and to confirm what a load created.</div>';
    el.innerHTML = h;
}
function faQuery() {
    var c = FA.sel; FA.qq = $('fa-qq').value.trim(); FA.qf = $('fa-qf').value.trim(); FA.ql = Math.max(1, Math.min(500, +$('fa-ql').value || 25));
    var qs = '?limit=' + FA.ql + (FA.qq ? '&q=' + encodeURIComponent(FA.qq) : '') + (FA.qf ? '&fields=' + encodeURIComponent(FA.qf) : '');
    $('fa-body').querySelector('[data-faact="query"]').disabled = true;
    return faGet(qs).then(function (S) { if (FA.sel !== c) return; FA.sample = S; faRenderQuery(); });
}
function faCsv(S, name) {
    prDownload(new Blob([[S.cols.join(',')].concat(S.items.map(function (it) { return S.cols.map(function (k) { return FE.csvField(it[k]); }).join(','); })).join('\r\n')], { type: 'text/csv' }), name + '.csv');
}
// drill dialog
function faDrill(url, title, reset) {
    if (reset || !FA.drill) FA.drill = [];
    FA.drill.push({ url: url, title: title || url.split('?')[0].split('/').pop() });
    faDrillLoad();
}
function faDrillLoad() {
    var top = FA.drill[FA.drill.length - 1], crumbs = FA.drill.map(function (d, i) {
        return i === FA.drill.length - 1 ? '<b>' + esc(d.title) + '</b>' : '<button class="link" data-fadback="' + i + '">' + esc(d.title) + '</button>';
    }).join(' <i class="fa-solid fa-chevron-right"></i> ');
    prModal('<h2><i class="fa-solid fa-diagram-project"></i> ' + esc(FA.sel ? FA.sel.n : 'Fusion') + '</h2><div class="fap-crumbs">' + crumbs + '</div>' +
        '<code class="fap-url">' + esc(top.url.replace(/^https:\/\/[^/]+/, '')) + '</code><div id="fap-drillbody"><div class="empty"><i class="fa-solid fa-spinner fa-spin"></i> Reading…</div></div>' +
        '<div class="modal-f"><button class="btn ghost" data-faact="dcsv" disabled><i class="fa-solid fa-file-csv"></i> CSV</button><button class="btn" data-mact="close">Close</button></div>');
    $('pr-modal-box').classList.add('wide');
    // a collection when the path ends on the resource or on child/<name> — read 50 rows of it
    var url = top.url, segs = ((url.split('?')[0].split('/resources/')[1] || '').split('/')).slice(1);
    var coll = segs.length === 1 || segs[segs.length - 2] === 'child';
    var get = coll && !/[?&]limit=/.test(url) ? url + (url.indexOf('?') < 0 ? '?' : '&') + 'limit=50' : url;
    faRest('GET', get).then(function (r) {
        if (FA.drill[FA.drill.length - 1] !== top) return;
        var box = $('fap-drillbody'); if (!box) return;
        if (r.status >= 300 || !r.json) { box.innerHTML = '<div class="note err">' + esc(faErr(r)) + '</div>'; return; }
        var j = r.json;
        if (Array.isArray(j.items)) {
            top.S = { items: j.items, hasMore: !!j.hasMore, ms: r.ms };
            box.innerHTML = faResultHtml(top.S, 'dcsv').replace(/<button class="btn sm" data-faact="dcsv">[\s\S]*?<\/button>/, '');
            var b = document.querySelector('#pr-modal-box [data-faact="dcsv"]'); if (b) b.disabled = !j.items.length;
        } else {
            // one record: its fields, then its links (children, LOVs)
            var keys = Object.keys(j).filter(function (k) { return k !== 'links'; });
            box.innerHTML = '<div class="fap-lks fap-reclinks">' + faLinkChips(j.links, true) + '</div><table class="grid fap-kv"><tbody>' + keys.map(function (k) {
                return '<tr><th>' + esc(k) + '</th><td>' + faCell(j[k]) + '</td></tr>';
            }).join('') + '</tbody></table>';
        }
    }).catch(function (e) { var box = $('fap-drillbody'); if (box) box.innerHTML = '<div class="note err">' + esc(String(e)) + '</div>'; });
}
document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-fadrill]');
    if (b) { e.preventDefault(); var inModal = !!b.closest('#pr-modal-box'); faDrill(b.getAttribute('data-fadrill'), b.getAttribute('data-fatitle'), !inModal); return; }
    if ((b = e.target.closest('#pr-modal-box [data-fadback]'))) { FA.drill = FA.drill.slice(0, +b.getAttribute('data-fadback') + 1); faDrillLoad(); return; }
    if ((b = e.target.closest('#pr-modal-box [data-faact="dcsv"]'))) { var top = FA.drill[FA.drill.length - 1]; if (top && top.S) faCsv(top.S, (FA.sel ? FA.sel.r + '_' : '') + top.title); }
});

// ── Load data ──────────────────────────────────────────────────
function faAttrs(child) { var d = faD(); if (!d || d.error) return []; return child ? ((d.children[child] || {}).attrs || []) : d.attrs; }
function faAutoMap() {
    var cfg = FA.cfg, S = FA.src; if (!S || !faD() || faD().error) return 0;
    var n = 0, norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }, src = S.cols.map(norm);
    [['map', ''], ['cmap', cfg.child]].forEach(function (p) {
        if (p[0] === 'cmap' && !p[1]) return;
        faAttrs(p[1]).forEach(function (a) {
            if (!a.upd || cfg[p[0]][a.name]) return;
            var i = src.indexOf(norm(a.name)); if (i < 0) i = src.indexOf(norm(a.title));
            if (i >= 0) { cfg[p[0]][a.name] = '{' + S.cols[i] + '}'; n++; }
        });
    });
    return n;
}
function faRenderLoad() {
    var c = FA.sel, cfg = FA.cfg, d = faD(), el = $('fa-body'), S = FA.src;
    if (!d) { el.innerHTML = '<div class="empty"><i class="fa-solid fa-spinner fa-spin"></i> Reading the fields from the pod…</div>'; return; }
    if (d.error) { faRenderFields(); return; }
    var ch = Object.keys(d.children);
    var h = '<div class="fap-steps">';
    // 1 source
    h += '<section class="fap-sec"><h3><span class="n">1</span> Data <small class="muted">' + (S ? S.rows.length + ' rows · ' + S.cols.length + ' columns' + (S.note ? ' · ' + esc(S.note) : '') : 'Excel, paste, APEX or Fusion SQL') + '</small>' +
        (S ? '<button class="link" data-faact="clearsrc">change</button>' : '') + '</h3>';
    if (!S) {
        h += '<div class="seg">' + [['PASTE', 'fa-paste', 'Paste'], ['FILE', 'fa-file-excel', 'Excel / CSV'], ['APEX_SQL', 'fa-database', 'APEX SQL'], ['FUSION_SQL', 'fa-cloud', 'Fusion SQL']].map(function (s) {
            return '<button class="' + (cfg.srcType === s[0] ? 'on' : '') + '" data-fasrc="' + s[0] + '"><i class="fa-solid ' + s[1] + '"></i> ' + s[2] + '</button>';
        }).join('') + '</div>';
        if (cfg.srcType === 'PASTE') h += '<textarea id="fa-paste" class="code" rows="5" placeholder="Copy the cells in Excel (with the header row) and paste here…"></textarea><div class="row-f"><button class="btn primary" data-faact="usepaste"><i class="fa-solid fa-check"></i> Use pasted data</button>' +
            '<button class="btn ghost" data-faact="tplcsv" title="An empty CSV with this API\'s fields as columns (required first)"><i class="fa-solid fa-file-arrow-down"></i> Column template</button></div>';
        else if (cfg.srcType === 'FILE') h += '<label class="drop"><input type="file" id="fa-file" accept=".xlsx,.xlsm,.xls,.csv,.txt" hidden><i class="fa-solid fa-cloud-arrow-up"></i><b>Choose an Excel or CSV file</b><span>first sheet, first row = column names</span></label>' +
            '<div class="row-f"><button class="btn ghost" data-faact="tplcsv"><i class="fa-solid fa-file-arrow-down"></i> Column template</button></div>';
        else h += '<textarea id="fa-sql" class="code" rows="5" spellcheck="false" placeholder="SELECT … (read-only)">' + esc(cfg.srcSql || '') + '</textarea><div class="row-f"><button class="btn primary" data-faact="runsql"><i class="fa-solid fa-play"></i> Run query</button><span class="muted">Column names = field names map themselves (alias them, e.g. <code>vendor_name AS "SupplierName"</code>).</span></div>';
    }
    h += '</section>';
    if (S) {
        // 2 how
        h += '<section class="fap-sec"><h3><span class="n">2</span> Operation</h3><div class="row-f">' +
            '<label class="fld"><span>Action</span><select id="fa-method">' + (/P/.test(c.ops) ? '<option value="POST"' + (cfg.method === 'POST' ? ' selected' : '') + '>Create (POST)</option>' : '') +
            (/U/.test(c.ops) ? '<option value="PATCH"' + (cfg.method === 'PATCH' ? ' selected' : '') + '>Update (PATCH)</option>' : '') + '</select></label>' +
            (cfg.method === 'PATCH' ? '<label class="fld"><span>Record key <em>(' + esc(c.key || 'the id in the URL') + ')</em></span><input id="fa-key" value="' + esc(cfg.keyExpr) + '" placeholder="{' + esc(c.key || 'Id') + '}" list="fa-cols"></label>' : '') +
            (ch.length ? '<label class="fld"><span>Lines as child <em>(optional)</em></span><select id="fa-child"><option value="">— one record per row —</option>' + ch.map(function (n) { return '<option' + (cfg.child === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></label>' : '') +
            (cfg.child ? '<label class="fld"><span>Group rows by <em>(one record per value)</em></span><input id="fa-group" value="' + esc(cfg.groupBy) + '" placeholder="{Invoice No}" list="fa-cols"></label>' : '') +
            '<label class="fld"><span>Dates</span><select id="fa-dorder"><option value="dmy"' + (cfg.dateOrder !== 'mdy' ? ' selected' : '') + '>DD/MM/YYYY</option><option value="mdy"' + (cfg.dateOrder === 'mdy' ? ' selected' : '') + '>MM/DD/YYYY</option></select></label></div></section>';
        h += '<datalist id="fa-cols">' + S.cols.map(function (x) { return '<option value="{' + esc(x) + '}">'; }).join('') + '</datalist>';
        // 3 map
        h += '<section class="fap-sec"><h3><span class="n">3</span> Map fields <small class="muted">expressions like Prepare &amp; Load: <code>{Column}</code>, constants, <code>{Col|upper}</code>, <code>{#line}</code></small>' +
            '<button class="link" data-faact="automap">auto-map</button></h3>' + faMapTable('map', '') + (cfg.child ? '<h4 class="fap-h4"><i class="fa-solid fa-diagram-next"></i> ' + esc(cfg.child) + ' (one per row)</h4>' + faMapTable('cmap', cfg.child) : '') + '</section>';
        h += '<section class="fap-sec" id="fa-sec4">' + faCheckHtml() + '</section>';
        if (FA.run) h += '<section class="fap-sec" id="fa-runbox">' + faRunHtml() + '</section>';
    }
    el.innerHTML = h + '</div>';
}
function faCheckHtml() {
    var c = FA.sel, cfg = FA.cfg, h;
    var B = faBuild(), bad = B.recs.filter(function (r) { return r.issues.length; }).length;
    h = '<h3><span class="n">4</span> Check &amp; send <small class="muted">' + B.recs.length + ' record' + (B.recs.length === 1 ? '' : 's') + (bad ? ' · <b class="err-t">' + bad + ' with problems</b>' : ' · ready') + '</small></h3>';
    if (bad) h += '<div class="fap-issues">' + B.recs.filter(function (r) { return r.issues.length; }).slice(0, 8).map(function (r) { return '<div><b>Record ' + (r.i + 1) + '</b> (rows ' + r.rows.join(', ') + '): ' + esc(r.issues.join(' · ')) + '</div>'; }).join('') + (bad > 8 ? '<div class="muted">… ' + (bad - 8) + ' more</div>' : '') + '</div>';
    if (c.f && B.recs.length > 500) h += '<div class="note warn"><i class="fa-solid fa-truck-ramp-box"></i> ' + B.recs.length + ' records — FBDI loads this much faster. <button class="btn sm" data-faact="fbdi">Use FBDI instead</button></div>';
    h += '<details class="fap-pv"><summary>Payload of record 1</summary><pre class="code">' + esc(B.recs[0] ? JSON.stringify(B.recs[0].body, null, 2) : '') + '</pre></details>' +
        '<div class="row-f"><label class="fld"><span>Parallel calls</span><select id="fa-par">' + [1, 2, 3, 4].map(function (n) { return '<option' + (cfg.par === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
        '<label class="fld"><span>Stop after errors</span><input id="fa-stop" type="number" min="0" value="' + cfg.stopAfter + '" style="width:80px"></label>' +
        '<button class="btn" data-faact="test" ' + (B.recs.length ? '' : 'disabled') + ' title="Send only the first record"><i class="fa-solid fa-vial"></i> Send record 1</button>' +
        '<button class="btn primary" data-faact="run" ' + (B.recs.length ? '' : 'disabled') + '><i class="fa-solid fa-paper-plane"></i> Send ' + (bad ? B.recs.length - bad + ' good' : 'all ' + B.recs.length) + ' to ' + currentInstance() + '</button>' +
        '<button class="btn ghost" data-faact="savejob"><i class="fa-solid fa-floppy-disk"></i> Save mapping</button><button class="btn ghost" data-faact="jobs"><i class="fa-solid fa-folder-open"></i> Saved</button></div>';
    return h;
}
function faRenderCheck() { var el = $('fa-sec4'); if (el) el.innerHTML = faCheckHtml(); }
function faMapTable(which, child) {
    var cfg = FA.cfg, attrs = faAttrs(child).filter(function (a) { return a.upd || which === 'map' && cfg.method === 'PATCH' && a.name === FA.sel.key; });
    var m = cfg[which], show = FA.mapAll ? attrs : attrs.filter(function (a) { return a.req || m[a.name]; });
    return '<table class="grid fap-map"><thead><tr><th>Field</th><th>Value</th><th>Type</th></tr></thead><tbody>' + show.map(function (a) {
        return '<tr' + (a.req ? ' class="req"' : '') + '><td><b>' + esc(a.title) + '</b>' + (a.req ? ' <em class="req">*</em>' : '') + '<br><code>' + esc(a.name) + '</code></td>' +
            '<td><input data-famap="' + which + '|' + esc(a.name) + '" value="' + esc(m[a.name] || '') + '" list="fa-cols" placeholder="' + (a.req ? 'required' : '') + '"></td><td class="muted">' + esc(a.type) + (a.len ? '(' + a.len + ')' : '') + '</td></tr>';
    }).join('') + '</tbody></table><button class="link" data-faact="mapall">' + (FA.mapAll ? 'Only required + mapped' : 'Show all ' + attrs.length + ' fields') + '</button>';
}
/** Rows → records ({ i, rows, body, key, issues }) with the describe's types and required checks. */
function faBuild() {
    var cfg = FA.cfg, S = FA.src, idx = FE.srcIndex(S.cols), recs = [], groups = [], byKey = {};
    S.rows.forEach(function (row, i) {
        var g = String(i);
        if (cfg.child && cfg.groupBy) { try { g = FE.evalExpr(cfg.groupBy, { row: row, idx: idx, rowNo: i + 1, doc: 0, line: 0 }); } catch (e) { g = '#' + i; } }
        if (!byKey[g]) { byKey[g] = { rows: [] }; groups.push(byKey[g]); }
        byKey[g].rows.push(i);
    });
    var pAttrs = {}, cAttrs = {};
    faAttrs('').forEach(function (a) { pAttrs[a.name] = a; });
    if (cfg.child) faAttrs(cfg.child).forEach(function (a) { cAttrs[a.name] = a; });
    function val(expr, a, ctx, issues) {
        var v; try { v = FE.evalExpr(expr, ctx); } catch (e) { issues.push(a.name + ': ' + e); return undefined; }
        if (v == null || v === '') return undefined;
        if (a.type === 'number' || a.type === 'integer') { var n = FE.toNum(v); if (isNaN(n)) { issues.push(a.name + ' is not a number ("' + v + '")'); return undefined; } return n; }
        if (a.type === 'date' || a.type === 'datetime') {
            var d = FE.toDate(v, cfg.dateOrder); if (!d) { issues.push(a.name + ' is not a date ("' + v + '")'); return undefined; }
            var s = d.getFullYear() + '-' + FE.pad2(d.getMonth() + 1) + '-' + FE.pad2(d.getDate());
            return a.type === 'datetime' ? s + 'T' + FE.pad2(d.getHours()) + ':' + FE.pad2(d.getMinutes()) + ':' + FE.pad2(d.getSeconds()) + '+00:00' : s;
        }
        if (a.type === 'boolean') return /^(y|yes|true|1)$/i.test(String(v));
        v = String(v); if (a.len && v.length > a.len) issues.push(a.name + ' longer than ' + a.len);
        return v;
    }
    groups.forEach(function (g, gi) {
        var issues = [], first = g.rows[0], ctx = { row: S.rows[first], idx: idx, rowNo: first + 1, doc: gi + 1, line: 1, docRows: g.rows.map(function (i) { return S.rows[i]; }) }, body = {};
        Object.keys(cfg.map).forEach(function (k) { if (!cfg.map[k] || !pAttrs[k]) return; var v = val(cfg.map[k], pAttrs[k], ctx, issues); if (v !== undefined) body[k] = v; });
        var key = '';
        if (cfg.method === 'PATCH') {
            try { key = cfg.keyExpr ? String(FE.evalExpr(cfg.keyExpr, ctx)) : String(body[FA.sel.key] || ''); } catch (e) { issues.push('key: ' + e); }
            if (!key) issues.push('no record key'); delete body[FA.sel.key];
        } else faAttrs('').forEach(function (a) { if (a.req && body[a.name] === undefined) issues.push(a.name + ' is required'); });
        if (cfg.child) {
            body[cfg.child] = g.rows.map(function (i, li) {
                var cx = { row: S.rows[i], idx: idx, rowNo: i + 1, doc: gi + 1, line: li + 1, docRows: ctx.docRows }, line = {};
                Object.keys(cfg.cmap).forEach(function (k) { if (!cfg.cmap[k] || !cAttrs[k]) return; var v = val(cfg.cmap[k], cAttrs[k], cx, issues); if (v !== undefined) line[k] = v; });
                if (cfg.method === 'POST') faAttrs(cfg.child).forEach(function (a) { if (a.req && line[a.name] === undefined && issues.indexOf('line ' + (li + 1) + ': ' + a.name + ' is required') < 0) issues.push('line ' + (li + 1) + ': ' + a.name + ' is required'); });
                return line;
            });
        }
        recs.push({ i: gi, rows: g.rows.map(function (i) { return i + 1; }), body: body, key: key, issues: issues });
    });
    return { recs: recs };
}
function faSetSrc(cols, rows, note) {
    cols = cols.map(function (c, i) { c = String(c == null ? '' : c).trim(); return c || 'Column ' + (i + 1); });
    rows = rows.filter(function (r) { return r && r.some(function (v) { return v !== '' && v != null; }); }).map(function (r) { var a = []; for (var i = 0; i < cols.length; i++) a.push(r[i] == null ? '' : r[i]); return a; });
    FA.src = { cols: cols, rows: rows, note: note };
    FA.run = null;
    var n = faAutoMap();
    faRenderLoad();
    toast(rows.length + ' rows' + (n ? ' — ' + n + ' fields mapped by name' : ''));
}
function faReadFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
        try {
            var wb = XLSX.read(new Uint8Array(fr.result), { type: 'array', cellDates: true, raw: /\.csv$|\.txt$/i.test(file.name) });
            var ws = wb.Sheets[wb.SheetNames.indexOf('Data') >= 0 ? 'Data' : wb.SheetNames[0]];
            var a = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '', raw: true });
            faSetSrc((a[0] || []).map(function (h) { return String(h).replace(/\s*\*\s*$/, ''); }), a.slice(1), file.name);
        } catch (e) { toast('Could not read ' + file.name + ': ' + e.message); }
    };
    fr.readAsArrayBuffer(file);
}
function faRunSql() {
    var sql = ($('fa-sql').value || '').trim().replace(/;+\s*$/, ''), fus = FA.cfg.srcType === 'FUSION_SQL';
    if (!/^\s*(SELECT|WITH)\b/i.test(sql)) { toast('Only SELECT / WITH queries.'); return; }
    FA.cfg.srcSql = sql;
    toast('Running the query…');
    (fus ? prFusion(sql, 5000).then(function (r) { var cols = r.columns || (r.rows[0] ? Object.keys(r.rows[0]) : []); return { cols: cols, rows: (r.rows || []).map(function (x) { return Array.isArray(x) ? x : cols.map(function (c) { return x[c]; }); }) }; })
        : prApexPaged(sql, 5000)).then(function (x) { faSetSrc(x.cols, x.rows, (fus ? 'Fusion' : 'APEX') + ' query'); })
        .catch(function (e) { toast('Query failed: ' + e); });
}
/** An empty CSV whose header = the API's fields (required first) — fill in Excel, then load it. */
function faTemplateCsv() {
    var attrs = faAttrs('').filter(function (a) { return a.upd; }).sort(function (a, b) { return b.req - a.req; }), cols = attrs.map(function (a) { return a.name; });
    if (FA.cfg.child) faAttrs(FA.cfg.child).filter(function (a) { return a.upd && cols.indexOf(a.name) < 0; }).forEach(function (a) { cols.push(a.name); });
    prDownload(new Blob([cols.join(',') + '\r\n'], { type: 'text/csv' }), FA.sel.r + '_template.csv');
}

// ── run ────────────────────────────────────────────────────────
function faRun(onlyFirst) {
    var c = FA.sel, cfg = FA.cfg, B = faBuild();
    var todo = B.recs.filter(function (r) { return !r.issues.length; });
    if (onlyFirst) todo = todo.slice(0, 1);
    if (!todo.length) { toast('No record is ready — fix the problems in step 4 first.'); return; }
    if (!onlyFirst && !confirm('Send ' + todo.length + ' record' + (todo.length === 1 ? '' : 's') + ' to ' + c.n + ' on ' + currentInstance() + '? Fusion creates / changes them immediately.')) return;
    var R = FA.run = { total: todo.length, done: 0, ok: 0, err: 0, results: [], stop: false, t0: Date.now(), method: cfg.method, first: !!onlyFirst };
    faRenderLoad();
    var queue = todo.slice(), active = 0;
    return new Promise(function (resolve) {
        function next() {
            if (R.stop || (cfg.stopAfter > 0 && R.err >= cfg.stopAfter)) { if (!active) resolve(); return; }
            var rec = queue.shift(); if (!rec) { if (!active) resolve(); return; }
            active++;
            var url = cfg.method === 'PATCH' ? faUrl(c, '/' + encodeURIComponent(rec.key)) : faUrl(c);
            faRest(cfg.method, url, rec.body).then(function (r) {
                var ok = r.status >= 200 && r.status < 300, j = r.json || {};
                var key = ok ? (j[c.key] != null ? j[c.key] : Object.keys(j).filter(function (k) { return /(Id|Number)$/.test(k) && j[k] != null && typeof j[k] !== 'object'; }).map(function (k) { return k + ' ' + j[k]; })[0] || '') : '';
                R.results.push({ rec: rec, ok: ok, http: r.status, key: String(key), msg: ok ? '' : faErr(r), ms: r.ms });
                if (ok) R.ok++; else R.err++;
            }).catch(function (e) { R.results.push({ rec: rec, ok: false, http: 0, key: '', msg: String(e) }); R.err++; })
                .then(function () { active--; R.done++; faRunUpdate(); next(); });
        }
        for (var i = 0; i < Math.max(1, cfg.par); i++) next();
    }).then(function () {
        R.ms = Date.now() - R.t0; R.finished = true; faRunUpdate();
        toast(R.ok + ' sent, ' + R.err + ' rejected');
        return faSaveRun(R).catch(function (e) { console.log('[FusionAPI] run not stored', e); toast('The run could not be stored in APEX: ' + e); });
    });
}
function faRunHtml() {
    var R = FA.run, pct = R.total ? Math.round(R.done * 100 / R.total) : 0;
    return '<h3><span class="n"><i class="fa-solid fa-paper-plane"></i></span> ' + (R.finished ? 'Finished' : 'Sending…') + ' <small class="muted">' + R.done + ' / ' + R.total + ' · <b class="ok-t">' + R.ok + ' ok</b> · <b class="err-t">' + R.err + ' rejected</b>' + (R.ms ? ' · ' + (R.ms / 1000).toFixed(1) + ' s' : '') + '</small>' +
        (R.finished ? (R.err ? '<button class="btn sm" data-faact="retry"><i class="fa-solid fa-rotate-right"></i> Retry rejected</button>' : '') + '<button class="btn sm ghost" data-faact="rescsv"><i class="fa-solid fa-file-csv"></i> Results CSV</button>' : '<button class="btn sm" data-faact="stop"><i class="fa-solid fa-stop"></i> Stop</button>') + '</h3>' +
        '<div class="dl-bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="grid-w"><table class="grid fap-res"><thead><tr><th>#</th><th>Rows</th><th>Result</th><th>HTTP</th><th>Key / message</th></tr></thead><tbody>' +
        R.results.slice().sort(function (a, b) { return a.ok - b.ok || a.rec.i - b.rec.i; }).slice(0, 300).map(function (x) {
            return '<tr class="' + (x.ok ? 'ok' : 'bad') + '"><td>' + (x.rec.i + 1) + '</td><td>' + esc(x.rec.rows.join(', ')) + '</td><td>' + (x.ok ? '<span class="chip ok">created</span>' : '<span class="chip err">rejected</span>') + '</td><td>' + (x.http || '') + '</td><td>' + esc(x.ok ? x.key : x.msg) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
}
function faRunUpdate() { var b = $('fa-runbox'); if (b) b.innerHTML = faRunHtml(); }
function faSaveRun(R) {
    var c = FA.sel, user = appUserName(), runId;
    return faEnsure().then(function () {
        return prWrite('INSERT INTO wms_fapi_runs (job_id, resource_name, api, method, instance, status, total_count, ok_count, error_count, source_note, config_json, run_by, finished_date, elapsed_ms) VALUES (' +
            prN(FA.jobId) + ', ' + prV(c.r, 100) + ', ' + prV(c.api || 'fscm', 10) + ', ' + prV(R.method, 10) + ', ' + prV(currentInstance(), 10) + ', ' + prV(R.err ? (R.ok ? 'PARTIAL' : 'FAILED') : 'OK', 20) + ', ' +
            prN(R.total) + ', ' + prN(R.ok) + ', ' + prN(R.err) + ', ' + prV(FA.src && FA.src.note, 400) + ', ' + prClob(JSON.stringify(FA.cfg)) + ', ' + prV(user, 120) + ', SYSDATE, ' + prN(R.ms) + ')');
    }).then(function () {
        return prRead('SELECT MAX(run_id) AS id FROM wms_fapi_runs WHERE resource_name = ' + prV(c.r, 100) + ' AND run_by = ' + prV(user, 120), 1);
    }).then(function (r) {
        runId = r.length ? +r[0].ID : null; if (!runId) return;
        var sels = R.results.map(function (x) {
            return 'SELECT ' + runId + ', ' + (x.rec.i + 1) + ', ' + prV(x.rec.rows.join(','), 400) + ', ' + prV(x.ok ? 'OK' : 'ERROR', 10) + ', ' + prN(x.http) + ', ' + prV(x.key, 200) + ', ' + prV(x.msg, 3900) + ', ' + prClob(JSON.stringify(x.rec.body)) + ' FROM dual';
        });
        return prSeq(prBatches(sels), function (b) { return prWrite('INSERT INTO wms_fapi_run_rows (run_id, rec_no, source_rows, status, http_status, result_key, message, payload) ' + b.join(' UNION ALL ')); });
    }).then(function () { FA.runs = null; });
}
function faResultsCsv() {
    var R = FA.run, lines = ['Record,Source rows,Result,HTTP,Key,Message'];
    R.results.forEach(function (x) { lines.push([x.rec.i + 1, x.rec.rows.join(' '), x.ok ? 'OK' : 'ERROR', x.http, x.key, x.msg].map(FE.csvField).join(',')); });
    prDownload(new Blob([lines.join('\r\n')], { type: 'text/csv' }), FA.sel.r + '_results.csv');
}
function faRetry() {
    var R = FA.run, bad = {}; R.results.forEach(function (x) { if (!x.ok) x.rec.rows.forEach(function (n) { bad[n - 1] = 1; }); });
    FA.src = { cols: FA.src.cols, rows: FA.src.rows.filter(function (_, i) { return bad[i]; }), note: 'rejected rows of the last run' };
    FA.run = null; faRenderLoad(); toast(FA.src.rows.length + ' rejected rows kept — fix the mapping or data, then send again');
}

// ── jobs (saved mappings) and runs ──────────────────────────────
function faSaveJob() {
    var name = prompt('Name for this mapping', FA.jobName || (FA.sel.n + ' — ' + new Date().toLocaleDateString())); if (!name) return;
    var c = FA.sel, user = appUserName(), cfg = JSON.stringify(FA.cfg);
    faEnsure().then(function () {
        return FA.jobId ? prWrite('UPDATE wms_fapi_jobs SET job_name = ' + prV(name, 200) + ', config_json = ' + prClob(cfg) + ', updated_by = ' + prV(user, 120) + ', updated_date = SYSDATE WHERE job_id = ' + prN(FA.jobId))
            : prWrite('INSERT INTO wms_fapi_jobs (job_name, resource_name, api, config_json, created_by, updated_by) VALUES (' + prV(name, 200) + ', ' + prV(c.r, 100) + ', ' + prV(c.api || 'fscm', 10) + ', ' + prClob(cfg) + ', ' + prV(user, 120) + ', ' + prV(user, 120) + ')')
                .then(function () { return prRead('SELECT MAX(job_id) AS id FROM wms_fapi_jobs WHERE resource_name = ' + prV(c.r, 100), 1); }).then(function (r) { FA.jobId = r.length ? +r[0].ID : null; });
    }).then(function () { FA.jobName = name; FA.jobs = null; toast('Mapping saved in APEX'); }).catch(function (e) { toast('Could not save: ' + e); });
}
function faJobs() {
    var c = FA.sel;
    faEnsure().then(function () {
        return prRead("SELECT job_id, job_name, updated_by, TO_CHAR(updated_date, 'YYYY-MM-DD HH24:MI') AS upd, NVL(LENGTH(config_json), 0) AS len FROM wms_fapi_jobs WHERE resource_name = " + prV(c.r, 100) + ' ORDER BY updated_date DESC', 100);
    }).then(function (r) {
        prModal('<h2><i class="fa-solid fa-folder-open"></i> Saved mappings — ' + esc(c.n) + '</h2>' + (r.length ? '<div class="fap-jobs">' + r.map(function (j) {
            return '<button class="fap-job" data-fajob="' + j.JOB_ID + '"><b>' + esc(j.JOB_NAME) + '</b><small>' + esc(j.UPD + ' · ' + (j.UPDATED_BY || '')) + '</small></button>';
        }).join('') + '</div>' : '<div class="empty">Nothing saved for this API yet.</div>') + '<div class="modal-f"><button class="btn" data-mact="close">Close</button></div>');
    }).catch(function (e) { toast('Could not read the saved mappings: ' + e); });
}
function faLoadJob(id) {
    prReadClob('wms_fapi_jobs', 'config_json', 'job_id = ' + prN(id)).then(function (s) {
        var cfg = JSON.parse(s || '{}'); FA.cfg = Object.assign(faDefaultCfg(), cfg); FA.jobId = id;
        return prRead('SELECT job_name FROM wms_fapi_jobs WHERE job_id = ' + prN(id), 1);
    }).then(function (r) { FA.jobName = r.length ? r[0].JOB_NAME : ''; prModal(null); FA.view = 'load'; faRenderResource(); toast('Loaded “' + FA.jobName + '” — now give it data'); })
        .catch(function (e) { toast('Could not load: ' + e); });
}
function faRenderRuns() {
    var c = FA.sel, el = $('fa-body');
    if (!FA.runs) {
        el.innerHTML = '<div class="empty"><i class="fa-solid fa-spinner fa-spin"></i> Reading the runs…</div>';
        faEnsure().then(function () {
            return prRead("SELECT run_id, method, instance, status, total_count, ok_count, error_count, source_note, run_by, TO_CHAR(started_date, 'YYYY-MM-DD HH24:MI') AS started, elapsed_ms FROM wms_fapi_runs WHERE resource_name = " + prV(c.r, 100) + ' ORDER BY run_id DESC', 200);
        }).then(function (r) { FA.runs = r; if (FA.sel === c && FA.view === 'runs') faRenderRuns(); })
            .catch(function (e) { el.innerHTML = '<div class="note err">' + esc(String(e)) + '</div>'; });
        return;
    }
    el.innerHTML = FA.runs.length ? '<table class="grid"><thead><tr><th>Run</th><th>When</th><th>Pod</th><th>Action</th><th>Records</th><th>OK</th><th>Rejected</th><th>Source</th><th>By</th><th></th></tr></thead><tbody>' + FA.runs.map(function (x) {
        return '<tr><td>' + x.RUN_ID + '</td><td>' + esc(x.STARTED) + '</td><td>' + esc(x.INSTANCE || '') + '</td><td>' + esc(x.METHOD || '') + '</td><td>' + (x.TOTAL_COUNT || 0) + '</td><td class="ok-t">' + (x.OK_COUNT || 0) + '</td><td class="err-t">' + (x.ERROR_COUNT || 0) + '</td>' +
            '<td>' + esc(x.SOURCE_NOTE || '') + '</td><td>' + esc(x.RUN_BY || '') + '</td><td><button class="link" data-farun="' + x.RUN_ID + '">details</button></td></tr>';
    }).join('') + '</tbody></table><div id="fa-rundet"></div>' : '<div class="empty">No runs for this API yet.</div>';
}
function faRunDetail(id) {
    prRead('SELECT rec_no, source_rows, status, http_status, result_key, message FROM wms_fapi_run_rows WHERE run_id = ' + prN(id) + ' ORDER BY rec_no', 1000).then(function (r) {
        $('fa-rundet').innerHTML = '<h3 class="fap-h3">Run ' + id + '</h3><div class="grid-w"><table class="grid fap-res"><thead><tr><th>#</th><th>Rows</th><th>Result</th><th>HTTP</th><th>Key / message</th></tr></thead><tbody>' + r.map(function (x) {
            return '<tr class="' + (x.STATUS === 'OK' ? 'ok' : 'bad') + '"><td>' + x.REC_NO + '</td><td>' + esc(x.SOURCE_ROWS || '') + '</td><td>' + esc(x.STATUS) + '</td><td>' + (x.HTTP_STATUS || '') + '</td><td>' + esc(x.STATUS === 'OK' ? x.RESULT_KEY || '' : x.MESSAGE || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (e) { toast(String(e)); });
}

// ── events ─────────────────────────────────────────────────────
(function () {
    function wire() {
        var list = $('fa-list'), main = $('fa-main'); if (!list || !main) return;
        $('fa-q').addEventListener('input', function () { FA.q = this.value.trim(); faRenderList(); });
        $('fa-area').innerHTML = '<option value="ALL">All modules</option>' + faAreas().filter(function (a) { return FAPI_CATALOG.some(function (c) { return c.a === a[0]; }); }).map(function (a) { return '<option value="' + a[0] + '">' + esc(a[1]) + '</option>'; }).join('');
        $('fa-area').addEventListener('change', function () { FA.area = this.value; faRenderList(); });
        $('fa-home').addEventListener('click', function () { FA.sel = null; faRenderList(); faRenderMain(); });
        list.addEventListener('click', function (e) {
            var b;
            if ((b = e.target.closest('[data-fakind]'))) { FA.kind = b.getAttribute('data-fakind'); faRenderList(); return; }
            if ((b = e.target.closest('[data-fares]'))) faSelect(b.getAttribute('data-fares'));
        });
        main.addEventListener('click', function (e) {
            var b, t = e.target;
            if ((b = t.closest('[data-fares]'))) { faSelect(b.getAttribute('data-fares')); return; }
            if ((b = t.closest('[data-faview]'))) { FA.view = b.getAttribute('data-faview'); faRenderResource(); return; }
            if ((b = t.closest('[data-fasrc]'))) { FA.cfg.srcType = b.getAttribute('data-fasrc'); faRenderLoad(); return; }
            if ((b = t.closest('[data-farun]'))) { faRunDetail(+b.getAttribute('data-farun')); return; }
            if (!(b = t.closest('[data-faact]'))) return;
            var a = b.getAttribute('data-faact');
            if (a === 'any') { var r = $('fa-any').value.trim().replace(/^\/+|\/+$/g, ''); if (!/^[A-Za-z][\w]*$/.test(r)) { toast('Type a resource name, e.g. supplierSites'); return; } faSelect(r, { r: r, api: $('fa-any-api').value, a: 'COM', k: 'MASTER', ops: 'GPU', n: r, d: 'Opened by name — fields come from the pod.' }); }
            else if (a === 'checkall') faCheckAll();
            else if (a === 'redescribe') { delete FA.desc[(FA.sel.api || 'fscm') + ':' + FA.sel.r]; faSelect(FA.sel.r, FA.sel); }
            else if (a === 'fbdi') { dlShowTab('prepare'); if (typeof prNewLoad === 'function') setTimeout(function () { prNewLoad(FA.sel.f); }, 300); }
            else if (a === 'query') faQuery();
            else if (a === 'qcsv' && FA.sample) faCsv(FA.sample, FA.sel.r);
            else if (a === 'scsv' && FA.sample0) faCsv(FA.sample0, FA.sel.r + '_sample');
            else if (a === 'resample') { FA.sample0 = null; faRenderSample(); }
            else if (a === 'usepaste') {
                var tx = ($('fa-paste').value || '').replace(/\r/g, ''); if (!tx.trim()) { toast('Paste some rows first.'); return; }
                var lines = tx.split('\n').filter(function (l) { return l.trim(); }), sep = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
                var rows = lines.map(function (l) { return l.split(sep); }); faSetSrc(rows[0], rows.slice(1), 'pasted');
            }
            else if (a === 'runsql') faRunSql();
            else if (a === 'tplcsv') faTemplateCsv();
            else if (a === 'clearsrc') { FA.src = null; FA.run = null; faRenderLoad(); }
            else if (a === 'automap') { var n = faAutoMap(); toast(n ? n + ' more fields mapped' : 'No more names match'); faRenderLoad(); }
            else if (a === 'mapall') { FA.mapAll = !FA.mapAll; faRenderLoad(); }
            else if (a === 'test') faRun(true);
            else if (a === 'run') faRun(false);
            else if (a === 'stop') { if (FA.run) FA.run.stop = true; }
            else if (a === 'retry') faRetry();
            else if (a === 'rescsv') faResultsCsv();
            else if (a === 'savejob') faSaveJob();
            else if (a === 'jobs') faJobs();
        });
        main.addEventListener('change', function (e) {
            var t = e.target, cfg = FA.cfg;
            if (t.id === 'fa-file' && t.files[0]) faReadFile(t.files[0]);
            else if (t.id === 'fa-method') { cfg.method = t.value; setTimeout(faRenderLoad, 0); }
            else if (t.id === 'fa-child') { cfg.child = t.value; cfg.cmap = {}; faAutoMap(); setTimeout(faRenderLoad, 0); }
            else if (t.id === 'fa-group') { cfg.groupBy = t.value.trim(); setTimeout(faRenderLoad, 0); }
            else if (t.id === 'fa-key') { cfg.keyExpr = t.value.trim(); setTimeout(faRenderLoad, 0); }
            else if (t.id === 'fa-dorder') { cfg.dateOrder = t.value; setTimeout(faRenderLoad, 0); }
            else if (t.id === 'fa-par') cfg.par = +t.value;
            else if (t.id === 'fa-stop') cfg.stopAfter = Math.max(0, +t.value || 0);
            else if (t.hasAttribute('data-famap')) { var p = t.getAttribute('data-famap').split('|'); if (t.value.trim()) cfg[p[0]][p[1]] = t.value.trim(); else delete cfg[p[0]][p[1]]; t.closest('tr').classList.toggle('has', !!t.value.trim()); setTimeout(faRenderCheck, 0); }
        });
        main.addEventListener('input', function (e) { if (e.target.id === 'fa-fq') { FA.fq = e.target.value; var pos = e.target.selectionStart; faRenderFields(); var f = $('fa-fq'); f.focus(); f.setSelectionRange(pos, pos); } });
        main.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'fa-any') main.querySelector('[data-faact="any"]').click(); if (e.key === 'Enter' && /^fa-q[qfl]$/.test(e.target.id)) faQuery(); });
        document.addEventListener('click', function (e) { var b = e.target.closest('#pr-modal-box [data-fajob]'); if (b) faLoadJob(+b.getAttribute('data-fajob')); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
