/* Data Loading — Fusion FBDI Templates tab.
   Catalog: fbdi-catalog.js (generated from Oracle's official .xlsm files).
   Host actions (classes/Form1_DataLoadHandlers.cs): dataLoadInfo, dataLoadDownload
   (+ dataLoadProgress messages), dataLoadOpen, dataLoadOpenFolder, dataLoadCheckReleases. */

var FBDI_URL = 'https://www.oracle.com/webfolder/technetwork/docs/fbdi-{r}/fbdi/xlsm/{f}.xlsm';
var DL_RELEASES = ['26d', '26c', '26b', '26a', '25d', '25c', '25b', '25a', '24d', '24c', '24b', '24a', '23d', '23c', '23b', '23a'];

var DL = {
    release: null, area: null, q: '', sel: {}, cur: null,
    local: {}, folder: '', tbl: 0, colQ: '', reqOnly: false, busy: false
};
var AREA = {};
(window.FBDI_AREAS || []).forEach(function (a) { AREA[a[0]] = { code: a[0], name: a[1], color: a[2] }; });
var AREA_ICON = { GL: 'fa-book', AP: 'fa-file-invoice-dollar', AR: 'fa-hand-holding-dollar', CE: 'fa-building-columns', FA: 'fa-building',
    SUP: 'fa-truck-field', PO: 'fa-cart-shopping', INV: 'fa-boxes-stacked', OM: 'fa-clipboard-list', CST: 'fa-coins', SCP: 'fa-diagram-project', PRJ: 'fa-list-check' };

// ── helpers ────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function rxEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function mark(text, q) {
    var h = esc(text);
    if (!q) return h;
    return h.replace(new RegExp('(' + rxEsc(esc(q)) + ')', 'ig'), '<mark>$1</mark>');
}
function toast(t) { var el = $('toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { el.style.display = 'none'; }, 3800); }
function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
function relLabel(r) { return r.toUpperCase(); }
function tplUrl(t, r) { return FBDI_URL.replace('{r}', (r || DL.release).toLowerCase()).replace('{f}', t.f); }
function tplByFile(f) { for (var i = 0; i < FBDI_TEMPLATES.length; i++) if (FBDI_TEMPLATES[i].f === f) return FBDI_TEMPLATES[i]; return null; }
function colName(c) { return c.charAt(0) === '*' ? c.slice(1) : c; }
function isReq(c) { return c.charAt(0) === '*'; }
function hasHost() { return !!(window.chrome && window.chrome.webview); }

// ── host bridge ────────────────────────────────────────────────
var _pending = {}, _progress = {};
function host(action, payload, onProgress) {
    return new Promise(function (resolve, reject) {
        if (!hasHost()) { reject('Open this page inside the Gray\'s WMS app.'); return; }
        var id = 'dl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        _pending[id] = resolve;
        if (onProgress) _progress[id] = onProgress;
        window.chrome.webview.postMessage(Object.assign({ action: action, requestId: id }, payload || {}));
    });
}
if (hasHost()) {
    window.chrome.webview.addEventListener('message', function (ev) {
        var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
        if (!r || !r.requestId) return;
        if (r.action === 'dataLoadProgress') { if (_progress[r.requestId]) _progress[r.requestId](r); return; }
        if (r.action !== 'dataLoadResponse' || !_pending[r.requestId]) return;
        var cb = _pending[r.requestId]; delete _pending[r.requestId]; delete _progress[r.requestId];
        cb(r.data || {});
    });
}

// ── search ─────────────────────────────────────────────────────
// Returns null (no match) or { score, hit } — hit says where a table/column matched.
function dlMatch(t, q) {
    if (!q) return { score: 0, hit: '' };
    var ql = q.toLowerCase(), a = AREA[t.a] || {};
    if (t.n.toLowerCase().indexOf(ql) >= 0) return { score: 3, hit: '' };
    if (t.f.toLowerCase().indexOf(ql) >= 0 || (a.name || '').toLowerCase().indexOf(ql) >= 0) return { score: 2, hit: '' };
    for (var i = 0; i < t.t.length; i++)
        if (t.t[i].n.toLowerCase().indexOf(ql) >= 0) return { score: 2, hit: 'table ' + t.t[i].n, tbl: i };
    if (t.d.toLowerCase().indexOf(ql) >= 0 || (t.j || '').toLowerCase().indexOf(ql) >= 0) return { score: 1, hit: '' };
    for (i = 0; i < t.t.length; i++)
        for (var j = 0; j < t.t[i].c.length; j++)
            if (colName(t.t[i].c[j]).toLowerCase().indexOf(ql) >= 0)
                return { score: 1, hit: 'column “' + colName(t.t[i].c[j]) + '” in ' + t.t[i].n, tbl: i, col: colName(t.t[i].c[j]) };
    return null;
}
function dlVisible() {
    var out = [];
    FBDI_TEMPLATES.forEach(function (t) {
        if (DL.area && t.a !== DL.area) return;
        var m = dlMatch(t, DL.q);
        if (m) out.push({ t: t, m: m });
    });
    return out;
}

// ── areas + list ───────────────────────────────────────────────
function dlRenderAreas() {
    var counts = {};
    FBDI_TEMPLATES.forEach(function (t) { if (dlMatch(t, DL.q)) counts[t.a] = (counts[t.a] || 0) + 1; });
    var total = 0; Object.keys(counts).forEach(function (k) { total += counts[k]; });
    var h = '<button class="area' + (DL.area ? '' : ' on') + '" data-area=""><i style="--c:#0f172a"></i>All <b>' + total + '</b></button>';
    FBDI_AREAS.forEach(function (a) {
        var n = counts[a[0]] || 0;
        if (!n && DL.area !== a[0]) return;
        h += '<button class="area' + (DL.area === a[0] ? ' on' : '') + '" data-area="' + a[0] + '" style="--c:' + a[2] + '"><i></i>' + esc(a[1]) + ' <b>' + n + '</b></button>';
    });
    $('areas').innerHTML = h;
}

function dlRenderList() {
    var vis = dlVisible(), h = '', last = null;
    var order = {}; FBDI_AREAS.forEach(function (a, i) { order[a[0]] = i; });
    vis.sort(function (x, y) { return (order[x.t.a] - order[y.t.a]) || (DL.q ? y.m.score - x.m.score : 0) || x.t.n.localeCompare(y.t.n); });
    vis.forEach(function (v) {
        var t = v.t, a = AREA[t.a] || {};
        if (t.a !== last) { h += '<div class="sec" style="--c:' + a.color + '"><i></i>' + esc(a.name) + '</div>'; last = t.a; }
        var loc = DL.local[t.f];
        h += '<div class="it' + (DL.cur === t.f ? ' sel' : '') + '" data-f="' + t.f + '">' +
            '<input type="checkbox" data-sel="' + t.f + '"' + (DL.sel[t.f] ? ' checked' : '') + ' title="Select for download">' +
            '<div class="tx"><div class="nm">' + mark(t.n, DL.q) + (loc ? ' <i class="fa-solid fa-circle-check dot-dl" title="Downloaded for ' + relLabel(DL.release) + '"></i>' : '') + '</div>' +
            '<div class="fl">' + mark(t.f, DL.q) + '.xlsm · ' + t.t.length + ' sheet' + (t.t.length > 1 ? 's' : '') + '</div>' +
            (v.m.hit ? '<div class="hit"><i class="fa-solid fa-arrow-turn-up fa-rotate-90"></i> ' + mark(v.m.hit, DL.q) + '</div>' : '') +
            '</div></div>';
    });
    $('list').innerHTML = h || '<div class="empty"><i class="fa-regular fa-face-meh"></i><br>No template matches “' + esc(DL.q) + '”.</div>';
    $('side-count').textContent = vis.length + ' template' + (vis.length === 1 ? '' : 's');
    var allSel = vis.length && vis.every(function (v) { return DL.sel[v.t.f]; });
    $('sel-all').checked = !!allSel;
    $('sel-all').indeterminate = !allSel && vis.some(function (v) { return DL.sel[v.t.f]; });
    var nLocal = Object.keys(DL.local).length;
    $('side-dl').textContent = nLocal ? nLocal + ' downloaded' : '';
    dlUpdateSel();
}
function dlUpdateSel() {
    var n = Object.keys(DL.sel).filter(function (k) { return DL.sel[k]; }).length;
    $('n-sel').textContent = n;
    $('b-dlsel').disabled = !n || DL.busy;
}

// ── detail ─────────────────────────────────────────────────────
function dlSelect(f, keepTbl) {
    DL.cur = f;
    if (!keepTbl) {
        var t = tplByFile(f), m = t && dlMatch(t, DL.q);
        DL.tbl = m && m.tbl != null ? m.tbl : 0;
        DL.colQ = m && m.col ? DL.q : '';
    }
    lsSet('dl_cur', f);
    Array.prototype.forEach.call(document.querySelectorAll('.it'), function (el) { el.classList.toggle('sel', el.getAttribute('data-f') === f); });
    dlRenderDetail();
}

function dlRenderWelcome() {
    var tables = 0, cols = 0, req = 0;
    FBDI_TEMPLATES.forEach(function (t) { t.t.forEach(function (s) { tables++; cols += s.c.length; s.c.forEach(function (c) { if (isReq(c)) req++; }); }); });
    $('main').innerHTML =
        '<div class="welcome"><h2>Oracle Fusion FBDI templates</h2>' +
        '<p>The official Oracle File-Based Data Import workbooks, with each template\'s interface tables and columns in load order. Pick one on the left to see what it needs, or tick several and download them together.</p>' +
        '<div class="kpis">' +
        '<div class="kpi"><b>' + FBDI_TEMPLATES.length + '</b><span>templates</span></div>' +
        '<div class="kpi"><b>' + FBDI_AREAS.length + '</b><span>areas</span></div>' +
        '<div class="kpi"><b>' + tables + '</b><span>interface sheets</span></div>' +
        '<div class="kpi"><b>' + cols.toLocaleString() + '</b><span>columns (' + req.toLocaleString() + ' required)</span></div></div>' +
        '<div class="tips">' +
        '<div><i class="fa-solid fa-magnifying-glass"></i><span>Search looks inside every template — type a column like <b>Supplier Number</b> or a table like <b>GL_INTERFACE</b> to find which template carries it.</span></div>' +
        '<div><i class="fa-solid fa-code-branch"></i><span>Templates change each quarterly release. Choose your pod\'s release at the top; downloads go to <b>' + esc(DL.folder || 'C:\\fusion\\FBDI\\' + relLabel(DL.release)) + '</b>.</span></div>' +
        '<div><i class="fa-solid fa-table-columns"></i><span>Column lists come from Oracle\'s 26C workbooks; <span style="color:var(--req);font-weight:600">orange</span> columns are required.</span></div>' +
        '</div></div>';
}

function dlRenderDetail() {
    var t = DL.cur && tplByFile(DL.cur);
    if (!t) { dlRenderWelcome(); return; }
    var a = AREA[t.a] || {}, loc = DL.local[t.f];
    var nCols = 0, nReq = 0;
    t.t.forEach(function (s) { nCols += s.c.length; s.c.forEach(function (c) { if (isReq(c)) nReq++; }); });
    if (DL.tbl >= t.t.length) DL.tbl = 0;

    var h = '<div class="d-head" style="--c:' + a.color + '"><div class="d-ic"><i class="fa-solid ' + (AREA_ICON[t.a] || 'fa-file-excel') + '"></i></div><div>' +
        '<span class="d-tag">' + esc(a.name) + '</span><h2>' + esc(t.n) + '</h2><p>' + esc(t.d) + '</p></div></div>';

    h += '<div class="d-actions">' +
        '<button class="btn ' + (loc ? 'ok' : 'primary') + '" data-act="download"><i class="fa-solid ' + (loc ? 'fa-rotate' : 'fa-download') + '"></i> ' + (loc ? 'Download again' : 'Download .xlsm') + '</button>' +
        (loc ? '<button class="btn" data-act="open"><i class="fa-regular fa-file-excel"></i> Open in Excel</button>' +
               '<button class="btn" data-act="folder"><i class="fa-regular fa-folder-open"></i> Show in folder</button>' : '') +
        '<button class="btn" data-act="browser" title="Download through your browser instead"><i class="fa-solid fa-arrow-up-right-from-square"></i> Browser</button>' +
        '<button class="btn" data-act="copylink"><i class="fa-regular fa-copy"></i> Copy link</button>' +
        '<span class="loc" title="' + esc(loc ? DL.folder + '\\' + t.f + '.xlsm' : tplUrl(t)) + '">' +
        (loc ? '<i class="fa-solid fa-circle-check" style="color:var(--ok)"></i> ' + esc(fmtSize(loc.size) + ' · ' + loc.modified) : esc(tplUrl(t).replace('https://www.oracle.com', ''))) + '</span></div>';

    h += '<div class="d-body"><div class="facts">' +
        '<div class="fact"><span>File</span><b class="mono">' + esc(t.f) + '.xlsm</b><small>Release ' + relLabel(DL.release) + '</small></div>' +
        '<div class="fact"><span>Interface sheets</span><b>' + t.t.length + '</b><small>' + esc(t.t.map(function (s) { return s.n; }).slice(0, 3).join(', ') + (t.t.length > 3 ? '…' : '')) + '</small></div>' +
        '<div class="fact"><span>Columns</span><b>' + nCols + '</b><small>' + nReq + ' required</small></div>' +
        '<div class="fact"><span>Import process</span><b title="' + esc(t.j) + '">' + esc(t.j || '—') + '</b>' +
        (t.jv ? '<small class="v"><i class="fa-solid fa-check"></i> named in the template</small>' : '<small class="u"><i class="fa-solid fa-circle-info"></i> confirm in Oracle\'s FBDI guide</small>') + '</div>' +
        '<div class="fact"><span>UCM account</span><b class="mono">' + esc(t.u || '—') + '</b><small>' + (t.u ? 'usual upload account' : 'see Oracle\'s FBDI guide') + '</small></div>' +
        '</div>';

    // load path
    var firstTbl = t.t[0] ? t.t[0].n : 'the interface table';
    h += '<div><h3><i class="fa-solid fa-route"></i> How this template loads <span class="muted">— steps 3–5 are what “Prepare &amp; Load” will automate next</span></h3><div class="path">' +
        '<div class="st"><b>Fill the workbook</b><small>' + t.t.length + ' sheet' + (t.t.length > 1 ? 's' : '') + ', columns in this order</small></div>' +
        '<div class="st"><b>Generate CSV</b><small>Instructions sheet › <i>Generate CSV File</i> → ZIP</small></div>' +
        '<div class="st us"><b>Upload to UCM</b><small>' + (t.u ? '<code>' + esc(t.u) + '</code>' : 'import account') + '</small></div>' +
        '<div class="st us"><b>Load Interface File</b><small>' + (t.ctl.length ? esc(t.ctl.length + ' control file' + (t.ctl.length > 1 ? 's' : '')) : 'into the interface tables') + '</small></div>' +
        '<div class="st us"><b>' + esc(t.j || 'Import job') + '</b><small>validates &amp; creates records</small></div>' +
        '<div class="st"><b>Review errors</b><small>rejects stay in <code>' + esc(firstTbl) + '</code></small></div>' +
        '</div><div class="path-note">Steps 3–5 are one call to <b>ErpIntegrationService.importBulkData</b> (UCM upload + Load Interface File for Import + ' + esc(t.j || 'the import job') + ').</div></div>';

    // tables
    h += '<div><h3><i class="fa-solid fa-table-columns"></i> Sheets &amp; columns <span class="muted">— in the exact order the CSV must follow</span></h3><div class="tbl-tabs">';
    t.t.forEach(function (s, i) {
        var r = s.c.filter(isReq).length;
        h += '<button class="tbl-tab' + (i === DL.tbl ? ' on' : '') + '" data-tbl="' + i + '">' + mark(s.n, DL.q) + ' <small>' + s.c.length + (r ? ' · ' + r + '*' : '') + '</small></button>';
    });
    h += '</div><div class="cf"><input type="search" id="colq" placeholder="Filter columns…" value="' + esc(DL.colQ) + '">' +
        '<label><input type="checkbox" id="reqonly"' + (DL.reqOnly ? ' checked' : '') + '> Required only</label>' +
        '<button class="btn sm" data-act="copycols" title="Tab-separated — paste into an Excel row"><i class="fa-regular fa-copy"></i> Copy column names</button>' +
        '<span class="muted" id="colcount"></span></div><div class="cols" id="cols"></div>' +
        '<div class="legend"><span><i></i>required</span><span>Numbers are the column position in the CSV.</span></div></div></div>';

    $('main').innerHTML = h;
    $('main').scrollTop = 0;
    dlRenderCols();
}

function dlRenderCols() {
    var t = tplByFile(DL.cur); if (!t || !t.t[DL.tbl]) { $('cols').innerHTML = ''; return; }
    var s = t.t[DL.tbl], q = (DL.colQ || '').toLowerCase(), shown = 0, h = '';
    s.c.forEach(function (c, i) {
        var n = colName(c), r = isReq(c);
        if (DL.reqOnly && !r) return;
        if (q && n.toLowerCase().indexOf(q) < 0) return;
        shown++;
        h += '<div class="col' + (r ? ' req' : '') + '" title="' + esc(n) + (r ? ' (required)' : '') + '"><span class="n">' + (i + 1) + '</span><span class="c">' + mark(n, DL.colQ) + '</span></div>';
    });
    $('cols').innerHTML = h || '<div class="empty">No column matches.</div>';
    $('colcount').textContent = shown === s.c.length ? s.c.length + ' columns' : shown + ' of ' + s.c.length + ' columns';
}

// ── downloads ──────────────────────────────────────────────────
function dlRefreshLocal() {
    if (!hasHost()) { DL.local = {}; return Promise.resolve(); }
    return host('dataLoadInfo', { release: DL.release }).then(function (d) {
        DL.local = {}; DL.folder = d.folder || '';
        (d.files || []).forEach(function (f) { DL.local[f.file] = f; });
    });
}

function dlDownload(files) {
    if (!files.length) return;
    if (!hasHost()) {
        files.forEach(function (f, i) { var t = tplByFile(f); setTimeout(function () { window.open(tplUrl(t), '_blank'); }, i * 400); });
        return;
    }
    if (DL.busy) { toast('A download is already running.'); return; }
    DL.busy = true; dlUpdateSel();
    var rows = {};
    $('tray').classList.add('show');
    $('tray-title').textContent = 'Downloading ' + files.length + ' template' + (files.length > 1 ? 's' : '') + ' · ' + relLabel(DL.release);
    $('tray-bar').style.width = '0';
    $('tray-rows').innerHTML = files.map(function (f) {
        var t = tplByFile(f);
        return '<div class="dl-row" id="dlr-' + f + '"><i class="fa-regular fa-file-excel" style="color:#15803d"></i><span class="f">' + esc(t ? t.n : f) + '</span><span class="s queued">queued</span></div>';
    }).join('');
    var done = 0;
    host('dataLoadDownload', { release: DL.release, files: files, overwrite: files.length === 1 && !!DL.local[files[0]] }, function (p) {
        var el = document.querySelector('#dlr-' + p.file + ' .s');
        if (el) {
            el.className = 's ' + p.status;
            el.innerHTML = p.status === 'downloading' ? '<i class="fa-solid fa-circle-notch spin"></i>' : p.status === 'cached' ? 'already here' : p.status;
        }
        if (p.status !== 'downloading') { done++; $('tray-bar').style.width = Math.round(done * 100 / files.length) + '%'; }
    }).then(function (d) {
        DL.busy = false;
        var ok = (d.results || []).filter(function (r) { return r.ok; }).length;
        var bad = (d.results || []).filter(function (r) { return !r.ok; });
        bad.forEach(function (r) { var el = document.querySelector('#dlr-' + r.file + ' .s'); if (el) { el.className = 's failed'; el.textContent = 'failed'; el.title = r.error || ''; } });
        $('tray-bar').style.width = '100%';
        $('tray-title').textContent = d.error ? d.error : ok + ' of ' + files.length + ' ready' + (bad.length ? ' · ' + bad.length + ' failed' : '');
        if (bad.length) toast(bad[0].file + ': ' + (bad[0].error || 'failed'));
        else if (files.length > 1) toast(ok + ' templates saved to ' + (d.folder || 'the FBDI folder'));
        if (ok) { DL.sel = {}; }
        return dlRefreshLocal();
    }).then(function () { dlRenderList(); dlRenderDetail(); })
      .catch(function (e) { DL.busy = false; dlUpdateSel(); toast(String(e)); });
}

// ── releases ───────────────────────────────────────────────────
function dlReleases() {
    var extra = lsGet('dl_extra_rel', []);
    return extra.concat(DL_RELEASES).filter(function (r, i, arr) { return arr.indexOf(r) === i; })
        .sort(function (a, b) { return b.localeCompare(a); });
}
function dlRenderReleases() {
    $('rel').innerHTML = dlReleases().map(function (r) {
        return '<option value="' + r + '"' + (r === DL.release ? ' selected' : '') + '>' + relLabel(r) + (r === dlReleases()[0] ? ' (latest)' : '') + '</option>';
    }).join('');
}
function dlNextReleases(from, n) {
    var y = parseInt(from.slice(0, 2), 10), q = 'abcd'.indexOf(from.charAt(2)), out = [];
    for (var i = 0; i < n; i++) { q++; if (q > 3) { q = 0; y++; } out.push(y + 'abcd'.charAt(q)); }
    return out;
}
function dlCheckNewer(quiet) {
    if (!hasHost()) { if (!quiet) toast('Open this page inside the Gray\'s WMS app to check Oracle.'); return; }
    var cand = dlNextReleases(dlReleases()[0], 4);
    var btn = $('b-check'); btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> Checking';
    host('dataLoadCheckReleases', { releases: cand }).then(function (d) {
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Check newer';
        lsSet('dl_rel_checked', Date.now());
        var found = (d.releases || []).filter(function (r) { return r.available; }).map(function (r) { return r.release; });
        if (found.length) {
            lsSet('dl_extra_rel', lsGet('dl_extra_rel', []).concat(found));
            dlRenderReleases();
            toast('Oracle has published ' + found.map(relLabel).join(', ') + ' — pick it in Release.');
        } else if (!quiet) toast('No newer release than ' + relLabel(dlReleases()[0]) + ' yet.');
    }).catch(function (e) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Check newer'; if (!quiet) toast(String(e)); });
}

// ── events ─────────────────────────────────────────────────────
function dlCopy(text, what) {
    var done = function () { toast(what + ' copied.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { dlCopyFallback(text); done(); });
    else { dlCopyFallback(text); done(); }
}
function dlCopyFallback(text) {
    var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { }
    ta.remove();
}

function dlWire() {
    var qt;
    $('q').addEventListener('input', function () {
        clearTimeout(qt);
        qt = setTimeout(function () {
            DL.q = $('q').value.trim();
            dlRenderAreas(); dlRenderList();
            var vis = dlVisible();
            if (DL.q && vis.length && !vis.some(function (v) { return v.t.f === DL.cur; })) dlSelect(vis[0].t.f);
            else if (DL.cur) dlSelect(DL.cur);
        }, 160);
    });
    $('areas').addEventListener('click', function (e) {
        var b = e.target.closest('.area'); if (!b) return;
        DL.area = b.getAttribute('data-area') || null;
        lsSet('dl_area', DL.area);
        dlRenderAreas(); dlRenderList();
    });
    $('list').addEventListener('click', function (e) {
        var cb = e.target.closest('input[data-sel]');
        if (cb) { DL.sel[cb.getAttribute('data-sel')] = cb.checked; dlRenderList(); return; }
        var it = e.target.closest('.it'); if (it) dlSelect(it.getAttribute('data-f'));
    });
    $('sel-all').addEventListener('change', function () {
        var on = this.checked;
        dlVisible().forEach(function (v) { DL.sel[v.t.f] = on; });
        dlRenderList();
    });
    $('b-dlsel').addEventListener('click', function () {
        dlDownload(Object.keys(DL.sel).filter(function (k) { return DL.sel[k]; }));
    });
    $('b-folder').addEventListener('click', function () {
        host('dataLoadOpenFolder', { release: DL.release }).catch(function (e) { toast(String(e)); });
    });
    $('b-check').addEventListener('click', function () { dlCheckNewer(false); });
    $('rel').addEventListener('change', function () {
        DL.release = this.value; lsSet('dl_release', DL.release);
        dlRefreshLocal().then(function () { dlRenderList(); dlRenderDetail(); });
    });
    $('tray-x').addEventListener('click', function () { $('tray').classList.remove('show'); });

    $('main').addEventListener('click', function (e) {
        var tb = e.target.closest('[data-tbl]');
        if (tb) { DL.tbl = +tb.getAttribute('data-tbl'); dlSelect(DL.cur, true); return; }
        var b = e.target.closest('[data-act]'); if (!b) return;
        var t = tplByFile(DL.cur); if (!t) return;
        var act = b.getAttribute('data-act');
        if (act === 'download') dlDownload([t.f]);
        else if (act === 'open') host('dataLoadOpen', { release: DL.release, file: t.f }).then(function (d) { if (!d.ok) toast(d.error || 'Could not open.'); }).catch(function (e) { toast(String(e)); });
        else if (act === 'folder') host('dataLoadOpenFolder', { release: DL.release, file: t.f }).catch(function (e) { toast(String(e)); });
        else if (act === 'browser') { if (hasHost()) window.chrome.webview.postMessage({ action: 'openExternalUrl', url: tplUrl(t) }); else window.open(tplUrl(t), '_blank'); }
        else if (act === 'copylink') dlCopy(tplUrl(t), 'Download link');
        else if (act === 'copycols') {
            var s = t.t[DL.tbl];
            dlCopy(s.c.filter(function (c) { return !DL.reqOnly || isReq(c); }).map(colName).join('\t'), s.n + ' column names');
        }
    });
    $('main').addEventListener('input', function (e) {
        if (e.target.id === 'colq') { DL.colQ = e.target.value.trim(); dlRenderCols(); }
    });
    $('main').addEventListener('change', function (e) {
        if (e.target.id === 'reqonly') { DL.reqOnly = e.target.checked; dlRenderCols(); }
    });
    // ↑/↓ walk the list when not typing
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target.tagName || '')) && e.target.id !== 'q') return;
        var items = Array.prototype.map.call(document.querySelectorAll('.it'), function (el) { return el.getAttribute('data-f'); });
        if (!items.length) return;
        var i = items.indexOf(DL.cur);
        i = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
        e.preventDefault();
        dlSelect(items[i]);
        var el = document.querySelector('.it.sel'); if (el) el.scrollIntoView({ block: 'nearest' });
    });
}

// ── start ──────────────────────────────────────────────────────
(function dlInit() {
    DL.release = lsGet('dl_release', null);
    if (dlReleases().indexOf(DL.release) < 0) DL.release = window.FBDI_RELEASE_BASE || DL_RELEASES[0];
    DL.area = lsGet('dl_area', null);
    if (DL.area && !AREA[DL.area]) DL.area = null;
    var cur = lsGet('dl_cur', null);
    DL.cur = cur && tplByFile(cur) ? cur : null;
    dlRenderReleases();
    dlWire();
    dlRenderAreas(); dlRenderList(); dlRenderDetail();
    dlRefreshLocal().then(function () { dlRenderList(); dlRenderDetail(); }).catch(function () { });
    // quietly look for a newer Oracle release once a week
    if (hasHost() && Date.now() - lsGet('dl_rel_checked', 0) > 7 * 864e5) setTimeout(function () { dlCheckNewer(true); }, 1500);
})();
