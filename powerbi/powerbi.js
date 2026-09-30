/* Power BI module — reports embedded in the app, dataset designer, setup.
   Host actions (classes/Form1_PowerBiHandlers.cs): pbiStatus, pbiSaveConfig, pbiSignIn, pbiSignOut, pbiWorkspaces,
   pbiReports, pbiDatasets, pbiEmbedInfo, pbiDetectColumns, pbiPublish, pbiRefresh (+ pbiProgress).
   Dataset definitions live in APEX WMS_PBI_DATASETS (apex_sql/76_powerbi.sql, created by the host); the page
   reads and saves them through ai/executequery + ai/executewrite. Embedding uses powerbi-client (lib/). */

var PB_APEX = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';
var TYPES = ['String', 'Int64', 'Double', 'DateTime', 'Boolean'];
var S = {
    tab: 'reports', status: null, reports: [], datasets: [], rq: '', cur: null, embed: null, editing: false, filters: [],
    defs: [], def: null, defRow: null, dirty: false, tokenTimer: null, pbiDatasets: []
};
var pbi = window['powerbi-client'];
var models = pbi && pbi.models;
var service = pbi && new pbi.service.Service(pbi.factories.hpmFactory, pbi.factories.wpmpFactory, pbi.factories.routerFactory);

// ── helpers ────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function toast(t) { var el = $('toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { el.style.display = 'none'; }, 4200); }
function busy(msg) { $('busy').hidden = !msg; if (msg) $('busy').querySelector('span').textContent = msg; }
function hasHost() { return !!(window.chrome && window.chrome.webview); }
// served from https://grays-wms.example/ (see index.html): the login and the way home come in the URL
(function () {
    var q = new URLSearchParams(location.search);
    try { if (q.get('u')) sessionStorage.setItem('loggedInUser', q.get('u')); if (q.get('home')) sessionStorage.setItem('pbiHome', q.get('home')); } catch (e) { }
})();
function appUser() { try { return sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || ''; } catch (e) { return ''; } }
function goHome(ev) {
    if (location.protocol === 'file:') return;          // the normal link works
    var home = ''; try { home = sessionStorage.getItem('pbiHome') || ''; } catch (e) { }
    if (!/^file:/i.test(home)) return;
    ev.preventDefault();
    pb('pbiNavigate', { url: home + 'Home/index.html' }).catch(function () { history.back(); });
}
function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function v(s, max) { s = String(s == null ? '' : s).slice(0, max || 4000); return s ? lit(s) : 'NULL'; }
function clob(s) { s = String(s || ''); if (!s) return 'EMPTY_CLOB()'; var p = []; for (var i = 0; i < s.length; i += 1000) p.push('TO_CLOB(' + lit(s.slice(i, i + 1000)) + ')'); return p.join(' || '); }
function ago(s) { if (!s) return 'never'; var d = new Date(String(s).replace(' ', 'T')); if (isNaN(d)) return s; var m = Math.round((Date.now() - d) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; }

// ── bridge ─────────────────────────────────────────────────────
var _pending = {}, _progress = {};
function host(action, payload, onProgress, raw) {
    return new Promise(function (resolve, reject) {
        if (!hasHost()) { reject('Open this page inside the Gray\'s WMS app.'); return; }
        var id = 'pb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        _pending[id] = { resolve: resolve, reject: reject, raw: !!raw };
        if (onProgress) _progress[id] = onProgress;
        window.chrome.webview.postMessage(Object.assign({ action: action, requestId: id, appUser: appUser() }, payload || {}));
    });
}
if (hasHost()) window.chrome.webview.addEventListener('message', function (ev) {
    var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
    if (r && r.action === 'pbiSignInClosed') { if (typeof onSignInClosed === 'function') onSignInClosed(); return; }
    if (!r || !r.requestId) return;
    if (r.action === 'pbiProgress') { if (_progress[r.requestId]) _progress[r.requestId](r.message); return; }
    var cb = _pending[r.requestId]; if (!cb) return;
    delete _pending[r.requestId]; delete _progress[r.requestId];
    if (r.action === 'error') cb.reject(r.message || (r.data && r.data.message) || 'Host error'); else cb.resolve(cb.raw ? r : r.data == null ? {} : r.data);
});
/** The whole reply (statusCode, success, data) - for the REST relays. */
function hostRaw(action, payload) { return host(action, payload, null, true); }
function pb(action, payload, onProgress) {
    return host(action, payload, onProgress).then(function (d) { if (d && d.ok === false) throw d.error || 'failed'; return d; });
}
function apex(path, payload) {
    return host('executePost', { fullUrl: PB_APEX + path, body: JSON.stringify(Object.assign({ appUser: appUser() }, payload)) }).then(function (data) {
        var d = data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { throw 'Unexpected database response'; } }
        if (!d || d.success === false) throw (d && d.error) || 'Database API error';
        return d;
    });
}
function rows(sql, max) {
    return apex('/executequery', { sql: sql, maxRows: max || 500 }).then(function (d) {
        var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
        return (d.rows || []).map(function (r) {
            if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; }
            var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x;
        });
    });
}
function write(sql) { return apex('/executewrite', { sql: sql }); }

// ── status / account ───────────────────────────────────────────
function loadStatus() {
    return pb('pbiStatus').then(function (st) { S.status = st; renderAcct(); return st; })
        .catch(function (e) { S.status = { configured: false, error: String(e) }; renderAcct(); });
}
function renderAcct() {
    var st = S.status || {};
    $('acct').innerHTML = !st.configured ? '<span class="pill dim" title="Report links and Power BI Desktop work without an app registration. Publishing from the app needs one (Setup)."><i class="fa-solid fa-link"></i> Links &amp; Desktop mode</span>'
        : st.signedIn ? '<span class="pill ok" title="' + esc(st.mode === 'APP' ? 'App (service principal) mode' : 'Signed in') + '"><i class="fa-solid fa-circle-check"></i> ' + esc(st.account || 'signed in') + '</span>'
        : '<button class="btn sm light" data-act="signin"><i class="fa-brands fa-microsoft"></i> Sign in</button>';
}

// ── tabs ───────────────────────────────────────────────────────
function showTab(t) {
    S.tab = t;
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === t); });
    ['reports', 'datasets', 'setup'].forEach(function (p) { $('page-' + p).hidden = p !== t; });
    if (t === 'reports') loadReports();
    if (t === 'datasets') loadDefs();
    if (t === 'setup') renderSetup();
}

// ════════════════════════════════ REPORTS ════════════════════════════════
function apiReady() { var st = S.status || {}; return !!(st.configured && st.signedIn && st.workspaceId); }
function loadReports() {
    $('rlist').innerHTML = '<div class="muted pad"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading…</div>';
    $('b-new').hidden = !apiReady();
    var api = apiReady() ? Promise.all([pb('pbiReports'), pb('pbiDatasets')]).catch(function (e) { S.apiError = String(e); return [{ items: [] }, { items: [] }]; })
        : Promise.resolve([{ items: [] }, { items: [] }]);
    return Promise.all([loadLinks(), api]).then(function (all) {
        var r = all[1];
        S.reports = (r[0].items || []).sort(function (a, b) { return String(a.name).localeCompare(b.name); });
        S.pbiDatasets = r[1].items || [];
        renderReportList();
        var q = new URLSearchParams(location.search);
        if (q.get('link') && !S.cur) {     // ?link=<id or name>&filter=Table.Column:value
            var ln = S.links.find(function (x) { return String(x.LINK_ID) === q.get('link') || x.NAME === q.get('link'); });
            var qf = q.get('filter');
            if (ln) openLink(ln, qf && /^[^.]+\.[^:]+:.+$/.test(qf) ? [{ table: qf.split('.')[0], column: qf.split(':')[0].split('.')[1], value: qf.split(':').slice(1).join(':'), numeric: /^-?\d+$/.test(qf.split(':').slice(1).join(':')) }] : undefined);
        }
        if (q.get('report') && !S.cur) {
            var rep = S.reports.find(function (x) { return x.id === q.get('report') || x.name === q.get('report'); });
            if (rep) {
                var f = q.get('filter');       // Table.Column:value
                if (f && /^[^.]+\.[^:]+:.+$/.test(f)) S.filters = [{ table: f.split('.')[0], column: f.split(':')[0].split('.')[1], value: f.split(':').slice(1).join(':') }];
                openReport(rep);
            }
        }
    }).catch(function (e) { $('rlist').innerHTML = '<div class="err pad">' + esc(e) + '</div>'; });
}
function renderReportList() {
    var q = S.rq.toLowerCase();
    var hit = function (n) { return !q || String(n).toLowerCase().indexOf(q) >= 0; };
    var links = (S.links || []).filter(function (l) { return hit(l.NAME) || hit(l.FOLDER || ''); });
    var list = S.reports.filter(function (r) { return hit(r.name); });
    var dsName = {}; S.pbiDatasets.forEach(function (d) { dsName[d.id] = d.name; });
    var h = '', folder = null;
    links.forEach(function (l) {
        if ((l.FOLDER || '') !== folder) { folder = l.FOLDER || ''; if (folder || links.some(function (x) { return x.FOLDER; })) h += '<div class="rgroup">' + esc(folder || 'Reports') + '</div>'; }
        h += '<button class="ritem' + (S.cur && S.cur.id === 'L' + l.LINK_ID ? ' on' : '') + '" data-link="' + esc(l.LINK_ID) + '"><i class="fa-solid ' + (l.IS_PUBLIC === 'Y' ? 'fa-globe' : 'fa-chart-pie') + '"></i>' +
            '<span><b>' + esc(l.NAME) + '</b><small>' + esc(l.DESCRIPTION || (l.IS_PUBLIC === 'Y' ? 'public link' : 'Power BI link')) + '</small></span></button>';
    });
    if (list.length) {
        h += '<div class="rgroup">Workspace (app registration)</div>' + list.map(function (r) {
            return '<button class="ritem' + (S.cur && S.cur.id === r.id ? ' on' : '') + '" data-rep="' + esc(r.id) + '"><i class="fa-solid ' + (r.reportType === 'PaginatedReport' ? 'fa-file-lines' : 'fa-chart-column') + '"></i>' +
                '<span><b>' + esc(r.name) + '</b><small>' + esc(dsName[r.datasetId] || '') + '</small></span></button>';
        }).join('');
    }
    $('rlist').innerHTML = h || '<div class="muted pad">' + ((S.links || []).length || S.reports.length ? 'No match.' :
        'No reports yet. Click <b>Add report</b> and paste a Power BI report link — no app registration needed.' + (S.linkError ? '<br><span class="err">' + esc(S.linkError) + '</span>' : '')) + '</div>';
}

function embedConfig(info, extra) {
    return Object.assign({
        type: 'report', tokenType: info.tokenType === 'Embed' ? models.TokenType.Embed : models.TokenType.Aad, accessToken: info.token,
        settings: { panes: { filters: { visible: true, expanded: false }, pageNavigation: { visible: true } }, background: models.BackgroundType.Transparent }
    }, extra);
}
function scheduleToken(info, getInfo) {
    clearTimeout(S.tokenTimer);
    var ms = Math.max(60000, (info.expiresOn || Date.now() + 3600000) - Date.now() - 5 * 60000);
    S.tokenTimer = setTimeout(function () {
        getInfo().then(function (ni) { if (S.embed) S.embed.setAccessToken(ni.token); scheduleToken(ni, getInfo); }).catch(function () { });
    }, ms);
}
function resetEmbed() {
    if (S.embed) { try { service.reset($('embed')); } catch (e) { } S.embed = null; }
    clearTimeout(S.tokenTimer);
}

function openReport(rep) {
    if (!service) { toast('The Power BI library did not load'); return; }
    S.cur = rep; rep.kind = 'api'; S.editing = false;
    renderReportList();
    resetEmbed();
    $('rbar').hidden = false; $('rtitle').textContent = rep.name;
    $('b-save').hidden = true; $('b-edit').hidden = false; $('b-link').hidden = true; $('b-deffilters').hidden = true;
    document.querySelector('[data-act="print"]').hidden = false; document.querySelector('[data-act="addfilter"]').hidden = false;
    renderFilters();
    var getInfo = function () { return pb('pbiEmbedInfo', { reportId: rep.id, datasetId: rep.datasetId, allowEdit: true }); };
    busy('Opening ' + rep.name + '…');
    getInfo().then(function (info) {
        busy(null);
        var el = $('embed'); el.innerHTML = '';
        S.embed = service.embed(el, embedConfig(info, { id: rep.id, embedUrl: rep.embedUrl, permissions: models.Permissions.All, viewMode: models.ViewMode.View }));
        S.embed.on('loaded', function () { applyFilters(); });
        S.embed.on('error', function (ev) { var d = ev && ev.detail; if (d && d.level !== 3) toast('Power BI: ' + (d.message || d.detailedMessage || 'error')); });
        S.embed.on('saved', function () { toast('Saved in Power BI'); loadReports(); });
        scheduleToken(info, getInfo);
    }).catch(function (e) { busy(null); toast(String(e)); });
}

/** Create mode: the Power BI editor opens inside the app on one of the workspace datasets. */
function newReport() {
    var st = S.status || {};
    if (!st.signedIn) { toast('Sign in to Power BI first'); return; }
    var opts = S.pbiDatasets.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>'; }).join('');
    modal('<h2><i class="fa-solid fa-wand-magic-sparkles"></i> New report</h2><p class="muted">The Power BI editor opens here on the dataset you pick — drag fields onto the canvas, then <b>File › Save</b>. It is saved to the workspace for everyone with access.</p>' +
        (opts ? '<label class="fld"><span>Dataset</span><select id="nr-ds">' + opts + '</select></label>' : '<p class="err">No datasets in the workspace yet — publish one in <b>Datasets</b> first.</p>') +
        '<div class="modal-f"><button class="btn" data-mact="close">Cancel</button>' + (opts ? '<button class="btn primary" data-mact="create"><i class="fa-solid fa-check"></i> Open editor</button>' : '') + '</div>');
}
function createReport(datasetId) {
    modal(null);
    S.cur = null; S.editing = true;
    renderReportList();
    resetEmbed();
    $('rbar').hidden = false; $('rtitle').textContent = 'New report'; $('b-edit').hidden = true; $('b-save').hidden = true; $('b-link').hidden = true; $('b-deffilters').hidden = true;
    S.filters = []; renderFilters();
    var getInfo = function () { return pb('pbiEmbedInfo', { datasetId: datasetId, allowEdit: true }); };
    busy('Opening the Power BI editor…');
    getInfo().then(function (info) {
        busy(null);
        var el = $('embed'); el.innerHTML = '';
        S.embed = service.createReport(el, {
            type: 'report', tokenType: info.tokenType === 'Embed' ? models.TokenType.Embed : models.TokenType.Aad, accessToken: info.token,
            embedUrl: 'https://app.powerbi.com/reportEmbed?groupId=' + encodeURIComponent(info.workspaceId), datasetId: datasetId, groupId: info.workspaceId
        });
        S.embed.on('saved', function (ev) { toast('Report saved'); setTimeout(function () { loadReports().then(function () { var id = ev && ev.detail && ev.detail.reportObjectId; var r = S.reports.find(function (x) { return x.id === id; }); if (r) openReport(r); }); }, 1500); });
        S.embed.on('error', function (ev) { var d = ev && ev.detail; if (d && d.level !== 3) toast('Power BI: ' + (d.message || 'error')); });
        scheduleToken(info, getInfo);
    }).catch(function (e) { busy(null); toast(String(e)); });
}

// filters: Table · Column = value (any table/column of the report's dataset)
function renderFilters() {
    var link = S.cur && S.cur.kind === 'link';
    $('b-deffilters').hidden = !link || JSON.stringify(S.filters) === (S.cur.link.FILTERS_JSON || '[]');
    $('filters').innerHTML = S.filters.map(function (f, i) {
        return '<span class="chip">' + esc(f.table) + ' · ' + esc(f.column) + ' = <b>' + esc(f.value) + '</b><button data-rmf="' + i + '" title="Remove"><i class="fa-solid fa-xmark"></i></button></span>';
    }).join('');
}
function applyFilters() {
    if (S.cur && S.cur.kind === 'link') return loadLinkFrame();     // link reports: filters go into the URL
    if (!S.embed || !models) return;
    var fs = S.filters.map(function (f) {
        var vals = String(f.value).split(',').map(function (x) { x = x.trim(); return /^-?\d+(\.\d+)?$/.test(x) && f.numeric ? +x : x; });
        return { $schema: 'http://powerbi.com/product/schema#basic', target: { table: f.table, column: f.column }, operator: 'In', values: vals, filterType: models.FilterType.Basic };
    });
    var p = S.embed.updateFilters ? S.embed.updateFilters(models.FiltersOperations.Replace, fs) : S.embed.setFilters(fs);
    Promise.resolve(p).catch(function (e) { toast('Filter not applied: ' + (e && (e.message || e.detailedMessage) || e)); });
}
function addFilter() {
    var ds = S.cur && S.def && S.def.pbiDatasetId === S.cur.datasetId ? S.def : null;
    modal('<h2><i class="fa-solid fa-filter"></i> Filter the report</h2><p class="muted">Shows only the rows where the column has this value (several values: separate with commas). The same filter works on every page of the report.</p>' +
        '<div class="row"><label class="fld"><span>Table</span><input id="f-t" placeholder="e.g. TripOrders"></label><label class="fld"><span>Column</span><input id="f-c" placeholder="e.g. TripId"></label></div>' +
        '<label class="fld"><span>Value(s)</span><input id="f-v" placeholder="e.g. 8121"></label><label class="chk"><input type="checkbox" id="f-n"> The column is a number</label>' +
        (S.cur && S.cur.kind === 'link' ? '<p class="muted sm">Use the table and column names as they appear in the report’s Data pane.</p>' : '') +
        '<div class="modal-f"><button class="btn" data-mact="close">Cancel</button><button class="btn primary" data-mact="addf"><i class="fa-solid fa-check"></i> Apply</button></div>');
}

// ════════════════════════════════ DATASETS ════════════════════════════════
function loadDefs() {
    $('dslist').innerHTML = '<div class="muted pad"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading…</div>';
    return rows("SELECT dataset_key, name, pbi_dataset_id, schedule_mode, schedule_time, last_status, last_rows, TO_CHAR(last_refresh, 'YYYY-MM-DD HH24:MI:SS') AS last_refresh, " +
        "NVL(LENGTH(definition_json), 0) AS len, last_error FROM wms_pbi_datasets ORDER BY name", 200).then(function (r) {
        S.defs = r; renderDefList();
    }).catch(function (e) { $('dslist').innerHTML = '<div class="err pad">' + esc(e) + '<br><small>Open Setup once so the app can create its tables.</small></div>'; });
}
function renderDefList() {
    $('dslist').innerHTML = S.defs.length ? S.defs.map(function (d) {
        var st = d.LAST_STATUS === 'OK' ? 'ok' : d.LAST_STATUS === 'FAILED' ? 'bad' : d.LAST_STATUS === 'RUNNING' ? 'run' : '';
        return '<button class="ritem' + (S.def && S.def.key === d.DATASET_KEY ? ' on' : '') + '" data-def="' + esc(d.DATASET_KEY) + '"><i class="fa-solid fa-database"></i><span><b>' + esc(d.NAME) + '</b>' +
            '<small>' + (d.PBI_DATASET_ID ? 'published' : 'not published') + ' · ' + esc(d.SCHEDULE_MODE === 'DAILY' ? 'daily ' + (d.SCHEDULE_TIME || '') : (d.SCHEDULE_MODE || 'manual').toLowerCase()) + '</small></span>' +
            (st ? '<i class="dot ' + st + '" title="Last refresh: ' + esc(d.LAST_STATUS) + ' ' + esc(d.LAST_REFRESH || '') + '"></i>' : '') + '</button>';
    }).join('') : '<div class="muted pad">No datasets yet — start with the <b>WMS Operations</b> starter.</div>';
}
function readDef(key, len) {
    var out = '', offs = [];
    for (var o = 1; o <= len; o += 1300 * 9) offs.push(o);
    return offs.reduce(function (p, o) {
        return p.then(function () {
            var c = []; for (var i = 0; i < 9; i++) c.push('TO_CHAR(SUBSTR(definition_json, ' + (o + i * 1300) + ', 1300)) AS p' + i);
            return rows('SELECT ' + c.join(', ') + ' FROM wms_pbi_datasets WHERE dataset_key = ' + lit(key), 1).then(function (r) { if (r.length) for (var i = 0; i < 9; i++) out += r[0]['P' + i] || ''; });
        });
    }, Promise.resolve()).then(function () { return JSON.parse(out); });
}
function openDef(key) {
    if (S.dirty && !confirm('Discard the unsaved changes?')) return;
    var row = S.defs.find(function (d) { return d.DATASET_KEY === key; }); if (!row) return;
    busy('Reading the definition…');
    readDef(key, +row.LEN).then(function (def) {
        busy(null);
        def.key = key; def.pbiDatasetId = row.PBI_DATASET_ID;
        def.schedule = def.schedule || { mode: row.SCHEDULE_MODE || 'MANUAL', time: row.SCHEDULE_TIME || '06:00' };
        S.def = def; S.defRow = row; S.dirty = false;
        renderDefList(); renderDef();
    }).catch(function (e) { busy(null); toast('Cannot read it: ' + e); });
}
function newDef(starter) {
    if (S.dirty && !confirm('Discard the unsaved changes?')) return;
    var d = starter ? JSON.parse(JSON.stringify(PBI_STARTER)) : { key: '', name: 'New dataset', schedule: { mode: 'MANUAL', time: '06:00' }, tables: [{ name: 'Table1', sql: 'SELECT … FROM …', maxRows: 100000, columns: [], measures: [] }], relationships: [] };
    if (!starter) d.key = 'ds_' + Date.now().toString(36);
    if (starter && S.defs.some(function (x) { return x.DATASET_KEY === d.key; })) d.key = d.key + '_' + Date.now().toString(36).slice(-4);
    S.def = d; S.defRow = null; S.dirty = true;
    renderDefList(); renderDef();
}

function renderDef() {
    var d = S.def, row = S.defRow || {}, st = S.status || {};
    var tnames = d.tables.map(function (t) { return t.name; });
    function colOpts(table, cur) { var t = d.tables.find(function (x) { return x.name === table; }); return (t ? t.columns : []).map(function (c) { return '<option' + (c.name === cur ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join(''); }
    function tblOpts(cur) { return tnames.map(function (n) { return '<option' + (n === cur ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join(''); }
    var h = '<div class="dshead"><div class="grow"><input class="dsname" data-f="name" value="' + esc(d.name) + '" spellcheck="false">' +
        '<div class="muted sm">' + (d.pbiDatasetId ? '<i class="fa-solid fa-circle-check" style="color:#16a34a"></i> Published to Power BI · last refresh ' + esc(ago(row.LAST_REFRESH)) + (row.LAST_ROWS ? ' · ' + (+row.LAST_ROWS).toLocaleString() + ' rows' : '') : 'Not published yet') +
        (row.LAST_STATUS === 'FAILED' ? ' · <span class="err">last refresh failed: ' + esc(row.LAST_ERROR || '') + '</span>' : '') + '</div></div>' +
        '<div class="dsact"><button class="btn" data-act="dssave"><i class="fa-solid fa-floppy-disk"></i> Save</button>' +
        '<button class="btn' + (st.configured ? '' : ' primary') + '" data-act="kit" title="Power BI Desktop reads these tables from APEX — no app registration needed"><i class="fa-solid fa-desktop"></i> Power BI Desktop</button>' +
        (st.configured ? '<button class="btn primary" data-act="publish"' + (st.isAdmin ? '' : ' disabled title="AI admins only"') + '><i class="fa-solid fa-cloud-arrow-up"></i> Publish</button>' +
        '<button class="btn green" data-act="refresh"' + (d.pbiDatasetId ? '' : ' disabled title="Publish first"') + '><i class="fa-solid fa-rotate"></i> Refresh data</button>' : '') + '</div></div>';
    h += '<div class="card"><div class="row"><label class="fld"><span>Schedule</span><select data-f="schedMode">' +
        [['MANUAL', 'Manual only'], ['DAILY', 'Daily at'], ['HOURLY', 'Every hour']].map(function (o) { return '<option value="' + o[0] + '"' + (d.schedule.mode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
        '<label class="fld"' + (d.schedule.mode === 'DAILY' ? '' : ' hidden') + '><span>Time</span><input type="time" data-f="schedTime" value="' + esc(d.schedule.time || '06:00') + '"></label>' +
        '<p class="muted sm grow" style="align-self:end;">' + (st.configured ? 'Scheduled refreshes run from any PC where someone is signed in to Power BI with the app open — only one PC does each run.' : 'Used when the app pushes data itself (needs the app registration). With Power BI Desktop, the refresh schedule is set in the Power BI service.') + '</p></div></div>';
    d.tables.forEach(function (t, ti) {
        h += '<div class="card tbl"><div class="tblh"><i class="fa-solid fa-table"></i><input class="tname" data-t="' + ti + '" data-tf="name" value="' + esc(t.name) + '" spellcheck="false">' +
            '<label class="muted sm">max rows <input type="number" class="num" data-t="' + ti + '" data-tf="maxRows" value="' + (t.maxRows || 100000) + '"></label><span class="grow"></span>' +
            '<button class="btn sm" data-act="detect" data-t="' + ti + '"><i class="fa-solid fa-magnifying-glass-chart"></i> Detect columns</button>' +
            '<button class="btn sm" data-act="rmtable" data-t="' + ti + '" title="Remove table"><i class="fa-solid fa-trash"></i></button></div>' +
            '<textarea class="sql" data-t="' + ti + '" data-tf="sql" spellcheck="false" rows="' + Math.min(10, Math.max(3, String(t.sql).split('\n').length + 1)) + '">' + esc(t.sql) + '</textarea>' +
            '<div class="cols">' + (t.columns.length ? t.columns.map(function (c, ci) {
                return '<span class="colc"><b>' + esc(c.name) + '</b><select data-t="' + ti + '" data-c="' + ci + '">' + TYPES.map(function (x) { return '<option' + (x === c.dataType ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></span>';
            }).join('') : '<span class="muted sm">No columns yet — click <b>Detect columns</b> (runs the SQL for 200 rows).</span>') + '</div>' +
            '<div class="meas"><div class="mh"><b>Measures</b> <small class="muted">DAX — e.g. SUM(' + esc(t.name) + '[Qty])</small><button class="btn sm" data-act="addm" data-t="' + ti + '"><i class="fa-solid fa-plus"></i></button></div>' +
            t.measures.map(function (m, mi) {
                return '<div class="mrow"><input data-t="' + ti + '" data-m="' + mi + '" data-mf="name" value="' + esc(m.name) + '" placeholder="Name">' +
                    '<input class="mono grow" data-t="' + ti + '" data-m="' + mi + '" data-mf="expression" value="' + esc(m.expression) + '" placeholder="DAX expression" spellcheck="false">' +
                    '<input class="fmt" data-t="' + ti + '" data-m="' + mi + '" data-mf="formatString" value="' + esc(m.formatString || '') + '" placeholder="#,0">' +
                    '<button class="btn sm" data-act="rmm" data-t="' + ti + '" data-m="' + mi + '"><i class="fa-solid fa-xmark"></i></button></div>';
            }).join('') + '</div></div>';
    });
    h += '<button class="btn" data-act="addtable"><i class="fa-solid fa-plus"></i> Add table</button>';
    h += '<div class="card"><div class="mh"><b>Relationships</b> <small class="muted">many side (e.g. TripOrders.TripId) → one side with unique values (Trips.TripId). Changing them later means Recreate.</small><button class="btn sm" data-act="addrel"><i class="fa-solid fa-plus"></i></button></div>' +
        (d.relationships.length ? d.relationships.map(function (r, ri) {
            return '<div class="mrow"><select data-r="' + ri + '" data-rf="fromTable">' + tblOpts(r.fromTable) + '</select><select data-r="' + ri + '" data-rf="fromColumn">' + colOpts(r.fromTable, r.fromColumn) + '</select>' +
                '<i class="fa-solid fa-arrow-right muted"></i><select data-r="' + ri + '" data-rf="toTable">' + tblOpts(r.toTable) + '</select><select data-r="' + ri + '" data-rf="toColumn">' + colOpts(r.toTable, r.toColumn) + '</select>' +
                '<select data-r="' + ri + '" data-rf="crossFilteringBehavior"><option value="OneDirection"' + (r.crossFilteringBehavior !== 'BothDirections' ? ' selected' : '') + '>one direction</option><option value="BothDirections"' + (r.crossFilteringBehavior === 'BothDirections' ? ' selected' : '') + '>both directions</option></select>' +
                '<button class="btn sm" data-act="rmrel" data-r="' + ri + '"><i class="fa-solid fa-xmark"></i></button></div>';
        }).join('') : '<p class="muted sm">No relationships.</p>') + '</div>';
    h += '<div class="card" id="dslog"><b>Refresh history</b><div class="muted sm">Loading…</div></div>';
    $('dsmain').innerHTML = h;
    loadLog();
}
function loadLog() {
    var d = S.def; if (!d || !d.key || !$('dslog')) return;
    rows("SELECT TO_CHAR(started_at, 'YYYY-MM-DD HH24:MI') AS t, run_by, machine, trigger_type, status, total_rows, detail, error_text FROM wms_pbi_refresh_log WHERE dataset_key = " + lit(d.key) +
        ' ORDER BY log_id DESC FETCH FIRST 10 ROWS ONLY', 10).then(function (r) {
        $('dslog').innerHTML = '<b>Refresh history</b>' + (r.length ? '<table class="tbl-log"><tr><th>When</th><th>By</th><th>How</th><th>Status</th><th>Rows</th><th>Detail</th></tr>' + r.map(function (x) {
            return '<tr><td>' + esc(x.T) + '</td><td>' + esc(x.RUN_BY) + '<small class="muted"> ' + esc(x.MACHINE || '') + '</small></td><td>' + esc(x.TRIGGER_TYPE) + '</td><td><span class="st ' + esc(x.STATUS) + '">' + esc(x.STATUS) + '</span></td>' +
                '<td>' + (x.TOTAL_ROWS != null ? (+x.TOTAL_ROWS).toLocaleString() : '') + '</td><td>' + esc(x.ERROR_TEXT || x.DETAIL || '') + '</td></tr>';
        }).join('') + '</table>' : '<div class="muted sm">No refreshes yet.</div>');
    }).catch(function () { $('dslog').innerHTML = '<b>Refresh history</b><div class="muted sm">—</div>'; });
}
function markDirty() { S.dirty = true; }
function saveDef() {
    var d = S.def; if (!d) return Promise.resolve();
    if (!(S.status || {}).isAdmin) { toast('Only AI admins can save dataset definitions'); return Promise.reject('not admin'); }
    if (!d.key) d.key = 'ds_' + Date.now().toString(36);
    var body = JSON.stringify({ key: d.key, name: d.name, schedule: d.schedule, tables: d.tables, relationships: d.relationships });
    var sql = 'MERGE INTO wms_pbi_datasets t USING (SELECT ' + lit(d.key) + ' k FROM dual) s ON (t.dataset_key = s.k) ' +
        'WHEN MATCHED THEN UPDATE SET name = ' + v(d.name, 200) + ', definition_json = ' + clob(body) + ', schedule_mode = ' + v(d.schedule.mode, 20) + ', schedule_time = ' + v(d.schedule.time, 5) +
        ', updated_by = ' + v(appUser(), 100) + ', updated_date = SYSDATE ' +
        'WHEN NOT MATCHED THEN INSERT (dataset_key, name, definition_json, schedule_mode, schedule_time, created_by, updated_by) VALUES (s.k, ' + v(d.name, 200) + ', ' + clob(body) + ', ' +
        v(d.schedule.mode, 20) + ', ' + v(d.schedule.time, 5) + ', ' + v(appUser(), 100) + ', ' + v(appUser(), 100) + ')';
    busy('Saving…');
    return write(sql).then(function () { busy(null); S.dirty = false; toast('Saved'); return loadDefs(); })
        .then(function () { S.defRow = S.defs.find(function (x) { return x.DATASET_KEY === d.key; }) || S.defRow; })
        .catch(function (e) { busy(null); toast('Save failed: ' + e); throw e; });
}
function publish(recreate) {
    saveDef().then(function () {
        busy(recreate ? 'Recreating the dataset in Power BI…' : 'Publishing to Power BI…');
        return pb('pbiPublish', { key: S.def.key, recreate: !!recreate });
    }).then(function (r) {
        busy(null); if (!r) return;
        S.def.pbiDatasetId = r.datasetId; toast(r.note + ' — now click Refresh data');
        return loadDefs().then(function () { S.defRow = S.defs.find(function (x) { return x.DATASET_KEY === S.def.key; }); renderDef(); });
    }).catch(function (e) {
        busy(null);
        if (/Relationships changed/.test(String(e))) {
            if (confirm(String(e) + '\n\nRecreate the dataset now?')) publish(true);
        } else if (e !== 'not admin') toast('Publish failed: ' + e);
    });
}
function refreshData() {
    var d = S.def; if (!d || !d.pbiDatasetId) return;
    var go = S.dirty ? saveDef() : Promise.resolve();
    go.then(function () {
        busy('Refreshing…');
        return pb('pbiRefresh', { key: d.key }, function (msg) { busy(msg); });
    }).then(function (r) {
        busy(null); toast('Refreshed: ' + (+r.totalRows).toLocaleString() + ' rows');
        return loadDefs().then(function () { S.defRow = S.defs.find(function (x) { return x.DATASET_KEY === d.key; }); renderDef(); });
    }).catch(function (e) { busy(null); toast('Refresh failed: ' + e); loadDefs().then(function () { S.defRow = S.defs.find(function (x) { return x.DATASET_KEY === d.key; }); renderDef(); }); });
}
function detect(ti) {
    var t = S.def.tables[ti];
    busy('Running the query for 200 rows…');
    pb('pbiDetectColumns', { sql: t.sql }).then(function (r) {
        busy(null);
        var old = {}; t.columns.forEach(function (c) { old[c.name] = c.dataType; });
        t.columns = (r.columns || []).map(function (c) { return { name: c.name || c.Name, dataType: old[c.name || c.Name] || c.dataType || c.DataType || 'String' }; });
        markDirty(); renderDef();
        toast(t.columns.length + ' columns — check the types, then Save');
    }).catch(function (e) { busy(null); toast('Query failed: ' + e); });
}

// ════════════════════════════════ SETUP ════════════════════════════════
function renderSetup() {
    var st = S.status || {}, ro = st.isAdmin ? '' : ' disabled';
    if (!S.keysLoaded) { S.keysLoaded = true; loadKeys().then(function () { if (S.tab === 'setup') renderSetup(); }); }
    var h = renderDesktopSetup() + '<div class="card"><h3><i class="fa-solid fa-plug"></i> App registration <span class="tag grey">optional — needs your IT</span></h3>' +
        '<p class="muted sm">With an Entra ID app registration the app can also publish and refresh datasets itself and build reports inside the app. Everything else works without it.</p>' +
        '<div class="steps3"><div class="' + (st.configured ? 'done' : '') + '"><b>1</b> App registration<small>' + (st.configured ? 'set' : 'needed') + '</small></div>' +
        '<div class="' + (st.signedIn ? 'done' : '') + '"><b>2</b> Sign in<small>' + (st.signedIn ? esc(st.account || '') : 'not yet') + '</small></div>' +
        '<div class="' + (st.workspaceId ? 'done' : '') + '"><b>3</b> Workspace<small>' + (st.workspaceId ? 'chosen' : 'not chosen') + '</small></div></div>' +
        (st.isAdmin ? '' : '<p class="pill warn" style="display:inline-flex;">Only AI admins can change these settings.</p>') +
        '<div class="row"><label class="fld"><span>Tenant (directory) ID</span><input id="s-tenant" value="' + esc(st.tenantId || '') + '" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"' + ro + '></label>' +
        '<label class="fld"><span>Client (application) ID</span><input id="s-client" value="' + esc(st.clientId || '') + '" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"' + ro + '></label></div>' +
        '<div class="row"><label class="fld"><span>Who signs in</span><select id="s-mode"' + ro + '><option value="USER"' + (st.mode !== 'APP' ? ' selected' : '') + '>Each user, with their Microsoft account (Pro licences)</option>' +
        '<option value="APP"' + (st.mode === 'APP' ? ' selected' : '') + '>The app itself — service principal (needs Premium / Embedded / Fabric capacity)</option></select></label>' +
        '<label class="fld" id="s-secret-f"' + (st.mode === 'APP' ? '' : ' hidden') + '><span>Client secret <em>(kept on this PC only, encrypted)</em></span><input id="s-secret" type="password" placeholder="' + (st.hasSecret ? '•••••••• saved' : '') + '"' + ro + '></label></div>' +
        (st.isAdmin ? '<button class="btn primary" data-act="savecfg"><i class="fa-solid fa-floppy-disk"></i> Save</button> ' : '') +
        (st.configured ? (st.signedIn ? '<button class="btn" data-act="signout"><i class="fa-solid fa-right-from-bracket"></i> Sign out</button>' : '<button class="btn primary" data-act="signin"><i class="fa-brands fa-microsoft"></i> Sign in to Power BI</button>') : '') +
        (st.authError ? '<p class="err">' + esc(st.authError) + '</p>' : '') + '</div>';
    if (st.configured) h += '<div class="card"><h3><i class="fa-solid fa-folder-tree"></i> Workspace</h3><p class="muted sm">Reports and datasets of this workspace appear in the app; published datasets are created here.</p><div id="s-ws">' +
        (st.signedIn ? '<span class="muted sm"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading workspaces…</span>' : '<span class="muted sm">Sign in first.</span>') + '</div></div>';
    h += '<div class="card guide"><h3><i class="fa-solid fa-list-check"></i> For your IT / Power BI admin (one time)</h3><ol>' +
        '<li><b>Microsoft Entra ID › App registrations › New registration</b> — name e.g. <i>Gray\'s WMS Power BI</i>, single tenant.</li>' +
        '<li><b>Authentication › Add a platform › Mobile and desktop applications</b>, redirect URI <code>http://localhost</code>. Set <b>Allow public client flows = Yes</b>.</li>' +
        '<li><b>API permissions › Add › Power BI Service › Delegated</b>: <code>Dataset.ReadWrite.All</code>, <code>Report.ReadWrite.All</code>, <code>Workspace.Read.All</code>, <code>Content.Create</code> — then <b>Grant admin consent</b>.</li>' +
        '<li>Create a <b>workspace</b> (e.g. <i>Gray\'s WMS</i>) in app.powerbi.com. Give users <b>Viewer</b> (see reports) or <b>Contributor</b> (build reports, publish datasets).</li>' +
        '<li>Copy the <b>Directory (tenant) ID</b> and <b>Application (client) ID</b> into the fields above.</li>' +
        '<li><i>Only for "The app itself" mode:</i> create a client secret, enable <b>Service principals can use Power BI APIs</b> in the Power BI admin portal, add the app to the workspace as Member, and the workspace must be on Premium / Embedded / Fabric capacity.</li>' +
        '</ol><p class="muted sm">Everyone who views reports in "Each user" mode needs a Power BI Pro (or Premium Per User) licence. Sign-in tokens stay on each PC, encrypted.</p></div>';
    $('setup').innerHTML = h;
    $('s-mode') && ($('s-mode').onchange = function () { $('s-secret-f').hidden = this.value !== 'APP'; });
    if (st.signedIn) pb('pbiWorkspaces').then(function (r) {
        var items = r.items || [];
        $('s-ws').innerHTML = items.length ? '<div class="row"><label class="fld grow"><span>Workspace</span><select id="s-wsel"' + ro + '>' + (st.workspaceId ? '' : '<option value="">— choose —</option>') +
            items.map(function (w) { return '<option value="' + esc(w.id) + '"' + (w.id === st.workspaceId ? ' selected' : '') + '>' + esc(w.name) + (w.isOnDedicatedCapacity ? ' (capacity)' : '') + '</option>'; }).join('') + '</select></label>' +
            (st.isAdmin ? '<button class="btn primary" data-act="savews" style="align-self:end;"><i class="fa-solid fa-check"></i> Use this workspace</button>' : '') + '</div>'
            : '<p class="muted">No workspaces visible for this account — ask the admin to add you to the WMS workspace.</p>';
    }).catch(function (e) { $('s-ws').innerHTML = '<p class="err">' + esc(e) + '</p>'; });
}
function saveCfg() {
    var p = { tenantId: $('s-tenant').value.trim(), clientId: $('s-client').value.trim(), mode: $('s-mode').value };
    if ($('s-secret').value) p.appSecret = $('s-secret').value;
    busy('Saving…');
    pb('pbiSaveConfig', p).then(function () { busy(null); toast('Saved'); return loadStatus(); }).then(renderSetup).catch(function (e) { busy(null); toast(String(e)); });
}
function signIn() {
    busy('Complete the Microsoft sign-in in your browser…');
    pb('pbiSignIn').then(function (r) { busy(null); toast('Signed in as ' + (r.account || '')); return loadStatus(); })
        .then(function () { if (S.tab === 'setup') renderSetup(); else loadReports(); })
        .catch(function (e) { busy(null); toast('Sign-in: ' + e); });
}

// ── modal + events ─────────────────────────────────────────────
function modal(html, cls) { if (html == null) { $('modal').hidden = true; return; } $('modal-box').className = 'modal-box' + (cls ? ' ' + cls : ''); $('modal-box').innerHTML = html; $('modal').hidden = false; }

document.addEventListener('click', function (e) {
    if (e.target.closest('a.back')) return goHome(e);
    var b = e.target.closest('button, a[data-act], [data-rep], [data-def], [data-link]');
    if (!b) { if (e.target.id === 'modal') modal(null); return; }
    var d = b.dataset;
    if (b.tagName === 'A') e.preventDefault();
    if (d.tab) return showTab(d.tab);
    if (d.rep) { var r = S.reports.find(function (x) { return x.id === d.rep; }); if (r) openReport(r); return; }
    if (d.def) return openDef(d.def);
    if (d.link) { var ln = S.links.find(function (x) { return String(x.LINK_ID) === d.link; }); if (ln) openLink(ln); return; }
    if (d.copy) return copyFrom(d.copy);
    if (d.mact === 'savelink') return saveLink(d.id);
    if (d.mact === 'dellink') return deleteLink(S.linkEdit && S.linkEdit.link && S.linkEdit.link.LINK_ID);
    if (d.mact === 'clearlf') { if (S.linkEdit) S.linkEdit.filters = []; b.parentNode.remove(); return; }
    if (d.mact === 'newkey') return newKeyModal();
    if (d.mact === 'mkkey') return createKey();
    if (d.mact === 'testkey') return runKeyTest(S.lastKey, 'k-test');
    if (d.mact === 'kitdl') return downloadText(((S.def && S.def.key) || 'dataset') + '_power_bi_desktop.txt', S.kitText || '');
    if (d.rmf != null) { S.filters.splice(+d.rmf, 1); renderFilters(); applyFilters(); return; }
    if (d.mact === 'close') return modal(null);
    if (d.mact === 'create') return createReport($('nr-ds').value);
    if (d.mact === 'addf') {
        var f = { table: $('f-t').value.trim(), column: $('f-c').value.trim(), value: $('f-v').value.trim(), numeric: $('f-n').checked };
        if (!f.table || !f.column || !f.value) { toast('Table, column and value are needed'); return; }
        S.filters.push(f); modal(null); renderFilters(); applyFilters(); return;
    }
    var t = d.t != null ? +d.t : null;
    switch (d.act) {
        case 'signin': return signIn();
        case 'signout': return pb('pbiSignOut').then(loadStatus).then(renderSetup);
        case 'gosetup': return showTab('setup');
        case 'savecfg': return saveCfg();
        case 'savews': busy('Saving…'); return pb('pbiSaveConfig', { workspaceId: $('s-wsel').value }).then(function () { busy(null); toast('Workspace saved'); return loadStatus(); }).then(renderSetup).catch(function (x) { busy(null); toast(String(x)); });
        case 'addfilter': return addFilter();
        case 'edit': if (S.embed) { S.embed.switchMode('edit'); S.editing = true; $('b-edit').hidden = true; $('b-save').hidden = false; } return;
        case 'save': if (S.embed) S.embed.save(); return;
        case 'addlink': return linkModal(null);
        case 'editlink': return S.cur && S.cur.link && linkModal(S.cur.link);
        case 'window': return openInWindow();
        case 'signinonce': return signInOnce();
        case 'deffilters': saveLinkFilters(); $('b-deffilters').hidden = true; return;
        case 'hidehint': try { localStorage.setItem('pbiHintSeen', '1'); } catch (x) { } b.parentNode.remove(); return;
        case 'testfeed': return runKeyTest($('s-tkey').value.trim(), 's-tout');
        case 'newkey': return (S.defs.length ? Promise.resolve() : loadDefs()).then(newKeyModal);
        case 'revokekey': return revokeKey(d.id);
        case 'kit': return desktopKit();
        case 'refreshvis': if (S.cur && S.cur.kind === 'link') return loadLinkFrame();
            if (S.embed && S.embed.refresh) S.embed.refresh().catch(function () { S.embed.reload(); }); return;
        case 'print': if (S.embed) S.embed.print(); return;
        case 'full': if (S.cur && S.cur.kind === 'link') { var fr = $('embed').querySelector('iframe'); if (fr && fr.requestFullscreen) fr.requestFullscreen(); return; }
            if (S.embed) S.embed.fullscreen(); return;
        case 'open': if (S.cur && S.cur.kind === 'link') { window.chrome.webview.postMessage({ action: 'openExternalUrl', url: S.cur.link.SOURCE_URL && /^https:/.test(S.cur.link.SOURCE_URL) ? S.cur.link.SOURCE_URL : S.cur.link.URL }); return; }
            if (S.cur && S.cur.webUrl) window.chrome.webview.postMessage({ action: 'openExternalUrl', url: S.cur.webUrl }); // fire-and-forget: the host sends no reply return;
        case 'dssave': return saveDef().catch(function () { });
        case 'publish': return publish(false);
        case 'refresh': return refreshData();
        case 'detect': return detect(t);
        case 'addtable': S.def.tables.push({ name: 'Table' + (S.def.tables.length + 1), sql: 'SELECT … FROM …', maxRows: 100000, columns: [], measures: [] }); markDirty(); return renderDef();
        case 'rmtable': if (confirm('Remove table ' + S.def.tables[t].name + '?')) { S.def.tables.splice(t, 1); markDirty(); renderDef(); } return;
        case 'addm': S.def.tables[t].measures.push({ name: '', expression: '', formatString: '' }); markDirty(); return renderDef();
        case 'rmm': S.def.tables[t].measures.splice(+d.m, 1); markDirty(); return renderDef();
        case 'addrel': var ft = S.def.tables[0] || { name: '', columns: [] }; S.def.relationships.push({ fromTable: ft.name, fromColumn: (ft.columns[0] || {}).name, toTable: ft.name, toColumn: (ft.columns[0] || {}).name, crossFilteringBehavior: 'OneDirection' }); markDirty(); return renderDef();
        case 'rmrel': S.def.relationships.splice(+d.r, 1); markDirty(); return renderDef();
    }
    if (b.id === 'b-new') return newReport();
    if (b.id === 'b-reload') return loadReports();
    if (b.id === 'b-dsreload') return loadDefs();
    if (b.id === 'b-starter') return newDef(true);
    if (b.id === 'b-dsnew') return newDef(false);
});
document.addEventListener('input', function (e) {
    var x = e.target, d = x.dataset;
    if (x.id === 'rq') { S.rq = x.value; renderReportList(); return; }
    if (x.id === 'l-url') { checkLinkInput(); return; }
    if (!S.def) return;
    if (d.f === 'name') { S.def.name = x.value; markDirty(); }
    else if (d.tf != null) { var tb = S.def.tables[+d.t]; var old = tb.name; tb[d.tf] = d.tf === 'maxRows' ? +x.value : x.value; markDirty();
        if (d.tf === 'name') S.def.relationships.forEach(function (r) { if (r.fromTable === old) r.fromTable = x.value; if (r.toTable === old) r.toTable = x.value; }); }
    else if (d.mf != null) { S.def.tables[+d.t].measures[+d.m][d.mf] = x.value; markDirty(); }
});
document.addEventListener('change', function (e) {
    var x = e.target, d = x.dataset;
    if (!S.def) return;
    if (d.f === 'schedMode') { S.def.schedule.mode = x.value; markDirty(); renderDef(); }
    else if (d.f === 'schedTime') { S.def.schedule.time = x.value; markDirty(); }
    else if (d.c != null) { S.def.tables[+d.t].columns[+d.c].dataType = x.value; markDirty(); }
    else if (d.rf != null) { var r = S.def.relationships[+d.r]; r[d.rf] = x.value; markDirty(); if (d.rf === 'fromTable' || d.rf === 'toTable') renderDef(); }
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('modal').hidden) modal(null); });
window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ── start ──────────────────────────────────────────────────────
(function start() {
    if (!hasHost()) { $('rempty-text').textContent = 'Open this page inside the Gray\'s WMS app.'; return; }
    if (!service) { $('rempty-text').textContent = 'The Power BI library (lib/powerbi.min.js) did not load.'; }
    var q = new URLSearchParams(location.search);
    S.emptyEl = $('rempty');
    loadStatus().then(function () { showTab(q.get('tab') || 'reports'); });
})();
