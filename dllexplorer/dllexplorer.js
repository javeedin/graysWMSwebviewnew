/* DLL Explorer — read any .dll / .exe and see what it can do (it is only read, never run).
   Host actions (classes/Form1_DllHandlers.cs): dllSuggest, dllPick, dllInspect, dllOutline, dllDecompile, dllFind,
   dllExplain (+ dllProgress messages), dllSaveAiKey, dllOpenFolder. The reader is classes/DllInspector.cs
   (System.Reflection.Metadata + ICSharpCode.Decompiler), the AI feature map classes/DllAnalystAgent.cs.
   Feature maps are saved in APEX: WMS_AI_DLL_MAPS (apex_sql/73_ai_dll_maps.sql — the page creates it),
   where the AI Digital Employee reads them too. */

var DX_APEX = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';
var DX_PIECE = 1300;

var X = {
    path: null, rep: null, internal: false, tab: 'overview',
    ns: null, typeId: null, tq: '', openNs: {},
    code: null, codeHist: [], map: null, maps: [], suggest: [], fq: '', hasKey: false,
    exQ: '', impOpen: {}
};

// ── helpers ────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function toast(t) { var el = $('toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { el.style.display = 'none'; }, 3800); }
function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
function fmtN(n) { return (n || 0).toLocaleString(); }
function hasHost() { return !!(window.chrome && window.chrome.webview); }
function baseName(p) { return String(p || '').split(/[\\/]/).pop(); }
function busy(msg) { $('busy').hidden = !msg; if (msg) $('busy').querySelector('span').textContent = msg; }
function appUserName() {
    try { return sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || localStorage.getItem('userName') || localStorage.getItem('username') || 'UNKNOWN'; }
    catch (e) { return 'UNKNOWN'; }
}
function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { toast('Copied'); });
    var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied'); } catch (e) { } ta.remove();
}
function mdHtml(md) {
    var h = window.marked ? marked.parse(md || '') : '<pre>' + esc(md) + '</pre>';
    return window.DOMPurify ? DOMPurify.sanitize(h) : h;
}

// ── host bridge ────────────────────────────────────────────────
var _pending = {}, _progress = {};
function host(action, payload, onProgress) {
    return new Promise(function (resolve, reject) {
        if (!hasHost()) { reject('Open this page inside the Gray\'s WMS app.'); return; }
        var id = 'dx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        _pending[id] = { resolve: resolve, reject: reject };
        if (onProgress) _progress[id] = onProgress;
        window.chrome.webview.postMessage(Object.assign({ action: action, requestId: id }, payload || {}));
    });
}
if (hasHost()) {
    window.chrome.webview.addEventListener('message', function (ev) {
        var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
        if (!r || !r.requestId) return;
        if (r.action === 'dllProgress') { if (_progress[r.requestId]) _progress[r.requestId](r.message); return; }
        if (!_pending[r.requestId]) return;
        var cb = _pending[r.requestId]; delete _pending[r.requestId]; delete _progress[r.requestId];
        if (r.action === 'error') cb.reject(r.message || 'Host error'); else cb.resolve(r.data == null ? {} : r.data);
    });
}
function dll(action, payload, onProgress) {
    return host(action, payload, onProgress).then(function (d) {
        if (d && d.ok === false && d.error) throw d.error;
        return d;
    });
}

// ── APEX (saved feature maps) ──────────────────────────────────
function apex(path, payload) {
    return host('executePost', { fullUrl: DX_APEX + path, body: JSON.stringify(Object.assign({ appUser: appUserName() }, payload)) }).then(function (data) {
        var d = data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { throw 'Unexpected response from the database API: ' + String(data).slice(0, 200); } }
        if (!d || d.success === false || d.ReturnStatus === 'Error') throw (d && (d.error || d.ErrorExplanation)) || 'Database API error';
        return d;
    });
}
function aRead(sql, maxRows) {
    return apex('/executequery', { sql: sql, maxRows: maxRows || 500 }).then(function (d) {
        var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
        return (d.rows || []).map(function (r) {
            if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; }
            var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x;
        });
    });
}
function aWrite(sql) { return apex('/executewrite', { sql: sql }); }
function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function v(s, max) { s = String(s == null ? '' : s).slice(0, max || 4000); return s ? lit(s) : 'NULL'; }
function clob(s) {
    s = String(s == null ? '' : s);
    if (!s) return 'EMPTY_CLOB()';
    var parts = [];
    for (var i = 0; i < s.length; i += DX_PIECE) parts.push('TO_CLOB(' + lit(s.slice(i, i + DX_PIECE)) + ')');
    return parts.join(' || ');
}
var DX_DDL = "CREATE TABLE wms_ai_dll_maps (map_id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, file_name VARCHAR2(260) NOT NULL, " +
    "file_path VARCHAR2(1000), sha256 VARCHAR2(64) NOT NULL, file_version VARCHAR2(100), kind VARCHAR2(20), machine VARCHAR2(40), company VARCHAR2(300), " +
    "description VARCHAR2(1000), summary VARCHAR2(4000), capabilities VARCHAR2(4000), feature_map CLOB, focus VARCHAR2(1000), created_by VARCHAR2(100), " +
    "created_date DATE DEFAULT SYSDATE, updated_by VARCHAR2(100), updated_date DATE DEFAULT SYSDATE, CONSTRAINT wms_ai_dll_maps_uk UNIQUE (sha256))";
var _ensured = null;
function ensureTable() {
    if (_ensured) return _ensured;
    _ensured = aRead("SELECT table_name FROM user_tables WHERE table_name = 'WMS_AI_DLL_MAPS'", 1).then(function (r) {
        if (r.length) return;
        toast('Creating WMS_AI_DLL_MAPS in APEX…');
        return aWrite(DX_DDL);
    }).catch(function (e) { _ensured = null; throw e; });
    return _ensured;
}
function loadMaps() {
    $('maps').innerHTML = '<div class="muted sm">Loading…</div>';
    return ensureTable().then(function () {
        return aRead("SELECT map_id, file_name, file_version, sha256, kind, NVL(LENGTH(feature_map), 0) AS len, TO_CHAR(updated_date, 'YYYY-MM-DD HH24:MI') AS upd, updated_by " +
            "FROM wms_ai_dll_maps ORDER BY updated_date DESC", 300);
    }).then(function (r) { X.maps = r; renderMaps(); if (X.rep) renderHero(); })
      .catch(function (e) { $('maps').innerHTML = '<div class="muted sm" title="' + esc(e) + '"><i class="fa-solid fa-triangle-exclamation"></i> APEX not reachable</div>'; });
}
function readMap(id, len) {
    var offs = [];
    for (var o = 1; o <= len; o += DX_PIECE * 10) offs.push(o);
    var out = '';
    return offs.reduce(function (p, o) {
        return p.then(function () {
            var sel = [];
            for (var i = 0; i < 10; i++) sel.push('TO_CHAR(SUBSTR(feature_map, ' + (o + i * DX_PIECE) + ', ' + DX_PIECE + ')) AS p' + i);
            return aRead('SELECT ' + sel.join(', ') + ' FROM wms_ai_dll_maps WHERE map_id = ' + (+id), 1).then(function (r) {
                if (r.length) for (var i = 0; i < 10; i++) out += r[0]['P' + i] || '';
            });
        });
    }, Promise.resolve()).then(function () { return out; });
}
function mapFor(rep) { for (var i = 0; i < X.maps.length; i++) if (X.maps[i].SHA256 === rep.sha256) return X.maps[i]; return null; }
function mapsByName(rep) { return X.maps.filter(function (m) { return String(m.FILE_NAME).toLowerCase() === rep.fileName.toLowerCase() && m.SHA256 !== rep.sha256; }); }
function saveMap() {
    var R = X.rep, M = X.map;
    if (!R || !M || !M.markdown) return;
    var summary = (/##\s*Summary\s*\n([\s\S]*?)(\n##|$)/i.exec(M.markdown) || [])[1] || '';
    var caps = (R.capabilities || []).map(function (c) { return c.name; }).join(', ');
    var ver = R.version || {};
    var user = appUserName();
    busy('Saving the feature map to APEX…');
    ensureTable().then(function () {
        return aRead("SELECT map_id FROM wms_ai_dll_maps WHERE sha256 = " + lit(R.sha256), 1);
    }).then(function (r) {
        var cols = {
            file_name: v(R.fileName, 260), file_path: v(R.file, 1000), file_version: v(ver.FileVersion || ver['FileVersion#'] || (R.assembly && R.assembly.version), 100),
            kind: v(R.kind, 20), machine: v(R.machine, 40), company: v(ver.CompanyName, 300), description: v(ver.FileDescription || (R.assembly && R.assembly.attributes && R.assembly.attributes.Description), 1000),
            summary: v(summary.trim(), 3900), capabilities: v(caps, 3900), feature_map: clob(M.markdown), focus: v(M.focus, 1000)
        };
        if (r.length) {
            var set = Object.keys(cols).map(function (k) { return k + ' = ' + cols[k]; }).join(', ');
            return aWrite('UPDATE wms_ai_dll_maps SET ' + set + ', updated_by = ' + v(user, 100) + ', updated_date = SYSDATE WHERE map_id = ' + (+r[0].MAP_ID));
        }
        return aWrite('INSERT INTO wms_ai_dll_maps (sha256, ' + Object.keys(cols).join(', ') + ', created_by, updated_by) VALUES (' + lit(R.sha256) + ', ' +
            Object.keys(cols).map(function (k) { return cols[k]; }).join(', ') + ', ' + v(user, 100) + ', ' + v(user, 100) + ')');
    }).then(function () {
        M.saved = true; toast('Saved — the AI Digital Employee can now answer from this map');
        return loadMaps();
    }).catch(function (e) { toast('Save failed: ' + e); })
      .then(function () { busy(null); renderTab(); });
}

// ── sidebar ────────────────────────────────────────────────────
function recent() { return lsGet('dx_recent', []); }
function addRecent(R) {
    var list = recent().filter(function (x) { return x.path.toLowerCase() !== R.file.toLowerCase(); });
    list.unshift({ path: R.file, name: R.fileName, kind: R.kind, desc: (R.version || {}).FileDescription || '' });
    lsSet('dx_recent', list.slice(0, 12));
    renderRecent();
}
function kindIcon(k) { return k === 'native' ? 'fa-microchip' : k === 'mixed' ? 'fa-layer-group' : 'fa-cube'; }
function fileRow(f, extra) {
    return '<button class="frow' + (X.path && f.path && X.path.toLowerCase() === f.path.toLowerCase() ? ' on' : '') + '" data-open="' + esc(f.path) + '" title="' + esc(f.path) + '">' +
        '<i class="fa-solid ' + kindIcon(f.kind) + ' k-' + esc(f.kind || 'x') + '"></i><span><b>' + esc(f.name || baseName(f.path)) + '</b>' +
        (extra ? '<small>' + extra + '</small>' : '') + '</span></button>';
}
function renderRecent() {
    var r = recent();
    $('recent').innerHTML = r.length ? r.map(function (f) { return fileRow(f, esc(f.desc || f.kind || '')); }).join('') : '<div class="muted sm">Nothing opened yet.</div>';
}
function renderMaps() {
    $('maps').innerHTML = X.maps.length ? X.maps.map(function (m) {
        return '<button class="frow" data-map="' + m.MAP_ID + '" title="Saved ' + esc(m.UPD) + ' by ' + esc(m.UPDATED_BY || '') + '"><i class="fa-solid fa-map k-' + esc(m.KIND) + '"></i>' +
            '<span><b>' + esc(m.FILE_NAME) + '</b><small>' + esc(m.FILE_VERSION || '') + ' · ' + esc(m.UPD) + '</small></span></button>';
    }).join('') : '<div class="muted sm">None yet — open a DLL and use <b>Explain with AI</b>.</div>';
}
function renderSuggest() {
    var q = X.fq.toLowerCase(), groups = {};
    X.suggest.forEach(function (f) {
        if (q && f.name.toLowerCase().indexOf(q) < 0) return;
        (groups[f.group] = groups[f.group] || []).push(f);
    });
    var h = '';
    Object.keys(groups).forEach(function (g) {
        h += '<div class="fgrp">' + esc(g) + ' <small>' + groups[g].length + '</small></div>' +
            groups[g].map(function (f) { return fileRow({ path: f.path, name: f.name, kind: '' }, fmtSize(f.size)); }).join('');
    });
    $('suggest').innerHTML = h || '<div class="muted sm">' + (X.suggest.length ? 'No match.' : 'Drop DLLs into C:\\fusion\\dll to list them here.') + '</div>';
}
function loadSuggest() {
    return dll('dllSuggest').then(function (d) {
        X.suggest = d.files || []; X.hasKey = !!d.hasAiKey;
        $('b-key').classList.toggle('ok', X.hasKey);
        $('b-key').querySelector('span').textContent = X.hasKey ? 'AI key ✓' : 'AI key';
        renderSuggest();
    }).catch(function (e) { $('suggest').innerHTML = '<div class="muted sm">' + esc(e) + '</div>'; });
}

// ── open / inspect ─────────────────────────────────────────────
function openDll(path, keepTab) {
    if (!path) return;
    busy('Reading ' + baseName(path) + '…');
    return dll('dllInspect', { path: path, includeInternal: X.internal }).then(function (d) {
        var R = d.report;
        var same = X.rep && X.rep.sha256 === R.sha256;
        X.rep = R; X.path = R.file;
        if (!same) { X.ns = null; X.typeId = null; X.tq = ''; X.code = null; X.map = null; X.exQ = ''; X.impOpen = {}; if (!keepTab) X.tab = 'overview'; }
        $('path').value = R.file;
        addRecent(R);
        $('empty').hidden = true; $('view').hidden = false;
        render();
        renderSuggest();
    }).catch(function (e) { toast('Cannot read it: ' + e); })
      .then(function () { busy(null); });
}
function pickDll() {
    dll('dllPick', { current: X.path || '' }).then(function (d) { if (d.ok && d.path) openDll(d.path); });
}

// ── render ─────────────────────────────────────────────────────
function allTypes() { var a = []; (X.rep.namespaces || []).forEach(function (n) { n.types.forEach(function (t) { a.push({ ns: n.name, t: t }); }); }); return a; }
function stringsCount() { var n = 0, s = X.rep.strings || {}; Object.keys(s).forEach(function (k) { n += s[k].length; }); return n; }
function importsCount() { var n = 0; (X.rep.imports || []).forEach(function (i) { n += i.functions.length; }); return n; }

function render() { renderHero(); renderTab(); }

function renderHero() {
    var R = X.rep, ver = R.version || {}, A = R.assembly || {};
    var title = ver.FileDescription && ver.FileDescription !== R.fileName.replace(/\.(dll|exe|winmd)$/i, '') ? ver.FileDescription : (A.attributes && (A.attributes.Description || A.attributes.Title)) || '';
    var saved = mapFor(R), older = mapsByName(R);
    var kindLabel = R.kind === 'managed' ? '.NET' : R.kind === 'mixed' ? '.NET + native' : 'Native';
    var h = '<div class="hero k-' + R.kind + '"><div class="hero-ic"><i class="fa-solid ' + kindIcon(R.kind) + '"></i></div>' +
        '<div class="hero-t"><h2>' + esc(R.fileName) + '</h2><p>' + esc(title || (R.kind === 'native' ? 'Native Windows library' : 'Library')) + (ver.CompanyName ? ' · <b>' + esc(ver.CompanyName) + '</b>' : '') + '</p>' +
        '<div class="chips"><span class="chip k">' + kindLabel + '</span><span class="chip">' + esc(R.machine) + '</span>' +
        (ver.FileVersion || ver['FileVersion#'] ? '<span class="chip">v' + esc(ver.FileVersion || ver['FileVersion#']) + '</span>' : '') +
        (A.targetFramework ? '<span class="chip">' + esc(A.targetFramework) + '</span>' : '') +
        '<span class="chip">' + fmtSize(R.size) + '</span>' + (R.isExe ? '<span class="chip">EXE</span>' : '') +
        (R.hasXmlDocs ? '<span class="chip ok" title="An .xml documentation file sits next to it — member summaries are shown"><i class="fa-solid fa-book"></i> docs</span>' : '') +
        (saved ? '<span class="chip map" title="A feature map for this exact file is saved in APEX"><i class="fa-solid fa-map"></i> map saved</span>' : older.length ? '<span class="chip warn" title="Maps exist for other versions of this file"><i class="fa-solid fa-map"></i> map of another version</span>' : '') +
        '</div><div class="path muted" title="' + esc(R.file) + '"><i class="fa-regular fa-folder"></i> ' + esc(R.file) + '</div></div>' +
        '<div class="hero-act">' +
        '<button class="btn ai" data-act="explain"><i class="fa-solid fa-wand-magic-sparkles"></i> Explain with AI</button>' +
        '<div class="row"><button class="btn sm" data-act="compare" title="Compare the public API with another version of this DLL"><i class="fa-solid fa-code-compare"></i> Compare</button>' +
        '<button class="btn sm" data-act="folder" title="Open the folder"><i class="fa-regular fa-folder-open"></i></button>' +
        '<button class="btn sm" data-act="reload" title="Read it again"><i class="fa-solid fa-rotate"></i></button></div>' +
        (R.kind !== 'native' ? '<label class="sw" title="Also list internal/private types and members — where most application logic lives"><input type="checkbox" id="x-internal"' + (X.internal ? ' checked' : '') + '> Include internal</label>' : '') +
        '</div></div>';
    if ((R.warnings || []).length) h += '<div class="warns">' + R.warnings.map(function (w) { return '<div><i class="fa-solid fa-circle-info"></i> ' + esc(w) + '</div>'; }).join('') + '</div>';
    var tabs = [['overview', 'fa-gauge-high', 'Overview'], ['types', 'fa-sitemap', 'Classes', R.kind === 'native' ? null : R.stats.publicTypes + (X.internal ? R.stats.types - R.stats.publicTypes : 0)],
        ['integrations', 'fa-plug', 'Integrations', (R.imports || []).length + (R.exports || []).length + stringsCount()], ['code', 'fa-code', 'Code'], ['map', 'fa-robot', 'Feature map']];
    h += '<nav class="vtabs">' + tabs.filter(function (t) { return !(t[0] === 'types' && R.kind === 'native') && !(t[0] === 'code' && R.kind === 'native'); }).map(function (t) {
        return '<button class="vtab' + (X.tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '"><i class="fa-solid ' + t[1] + '"></i> ' + t[2] + (t[3] != null ? ' <b>' + fmtN(t[3]) + '</b>' : '') + '</button>';
    }).join('') + '</nav><div id="tab"></div>';
    $('view').innerHTML = h;
    var ic = $('x-internal');
    if (ic) ic.addEventListener('change', function () { X.internal = ic.checked; openDll(X.path, true); });
}

function renderTab() {
    var el = $('tab'); if (!el) return;
    Array.prototype.forEach.call(document.querySelectorAll('.vtab'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === X.tab); });
    if (X.tab === 'types') return renderTypes(el);
    if (X.tab === 'integrations') return renderIntegrations(el);
    if (X.tab === 'code') return renderCode(el);
    if (X.tab === 'map') return renderMap(el);
    return renderOverview(el);
}

// ── Overview ───────────────────────────────────────────────────
function renderOverview(el) {
    var R = X.rep, S = R.stats || {}, h = '<div class="stats">';
    var tiles = R.kind === 'native'
        ? [['fa-right-from-bracket', 'Exported functions', R.exportsTotal, 'integrations'], ['fa-right-to-bracket', 'Windows functions used', importsCount(), 'integrations'],
           ['fa-cubes', 'Windows DLLs used', (R.imports || []).length, 'integrations'], ['fa-quote-left', 'Hard-coded strings', stringsCount(), 'integrations']]
        : [['fa-cube', 'Public classes', S.publicTypes, 'types'], ['fa-bolt', 'Methods', S.methods, 'types'], ['fa-sliders', 'Properties', S.properties, 'types'],
           ['fa-link', 'References', (R.references || []).length, null], ['fa-microchip', 'Windows API calls', S.pInvokes, 'integrations'], ['fa-quote-left', 'Hard-coded strings', stringsCount(), 'integrations']];
    tiles.forEach(function (t) { h += '<button class="stat"' + (t[3] ? ' data-tab="' + t[3] + '"' : '') + '><i class="fa-solid ' + t[0] + '"></i><b>' + fmtN(t[2]) + '</b><span>' + t[1] + '</span></button>'; });
    h += '</div>';

    h += '<div class="sec"><h3><i class="fa-solid fa-fingerprint"></i> Capability fingerprint <small>what it can do, from the APIs it uses</small></h3>';
    if ((R.capabilities || []).length) {
        h += '<div class="caps">' + R.capabilities.map(function (c) {
            return '<div class="cap"><i class="fa-solid ' + esc(c.icon || 'fa-circle') + '"></i><div><b>' + esc(c.name) + '</b><ul>' +
                c.evidence.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div></div>';
        }).join('') + '</div>';
    } else h += '<p class="muted">No recognisable capabilities — a pure calculation / model library, or its code calls everything through other DLLs.</p>';
    h += '</div>';

    if ((R.aiActions || []).length) {
        h += '<div class="sec"><h3><i class="fa-solid fa-robot"></i> [AiAction] methods <small>marked by the developer as runnable from the chat</small></h3><table class="tbl"><tr><th>Method</th><th>Description</th><th>Approval</th></tr>' +
            R.aiActions.map(function (a) { return '<tr><td class="mono">' + esc(a.type + '.' + a.signature) + '</td><td>' + esc(a.description || '') + '</td><td>' + (a.requiresApproval ? 'card' : 'no') + '</td></tr>'; }).join('') + '</table></div>';
    }

    var ns = (R.namespaces || []).map(function (n) { return { name: n.name, n: n.types.length, m: n.types.reduce(function (s, t) { return s + t.members.length; }, 0) }; })
        .sort(function (a, b) { return b.m - a.m; });
    if (ns.length) {
        var max = Math.max.apply(null, ns.map(function (x) { return x.m || 1; }));
        h += '<div class="sec"><h3><i class="fa-solid fa-diagram-project"></i> Architecture <small>namespaces by size — click to browse</small></h3><div class="nsbars">' +
            ns.slice(0, 40).map(function (x) {
                return '<button class="nsbar" data-ns="' + esc(x.name) + '"><span class="nm">' + esc(x.name) + '</span><span class="bar"><i style="width:' + Math.max(2, Math.round(100 * x.m / max)) + '%"></i></span>' +
                    '<span class="ct">' + x.n + ' types · ' + fmtN(x.m) + ' members</span></button>';
            }).join('') + (ns.length > 40 ? '<div class="muted sm">… ' + (ns.length - 40) + ' more namespaces</div>' : '') + '</div></div>';
    }

    if ((R.references || []).length || Object.keys(R.forwards || {}).length) {
        h += '<div class="sec"><h3><i class="fa-solid fa-link"></i> Depends on</h3><div class="pills">' +
            (R.references || []).map(function (r) { var p = r.split(' '); return '<span class="pill" title="' + esc(r) + '">' + esc(p[0]) + ' <small>' + esc(p[1] || '') + '</small></span>'; }).join('') + '</div>';
        Object.keys(R.forwards || {}).forEach(function (k) { h += '<p class="muted sm">Forwards ' + R.forwards[k].length + ' types to <b>' + esc(k) + '</b></p>'; });
        h += '</div>';
    }
    var ver = R.version || {}, keys = Object.keys(ver).filter(function (k) { return k !== 'FileVersion#'; });
    var A = R.assembly;
    if (keys.length || A) {
        h += '<div class="sec"><h3><i class="fa-solid fa-id-card"></i> Identity</h3><table class="kv">' +
            keys.map(function (k) { return '<tr><th>' + esc(k.replace(/([a-z])([A-Z])/g, '$1 $2')) + '</th><td>' + esc(ver[k]) + '</td></tr>'; }).join('') +
            (A ? '<tr><th>Assembly</th><td class="mono">' + esc(A.name + ', Version=' + A.version + (A.publicKeyToken ? ', PublicKeyToken=' + A.publicKeyToken : '')) + '</td></tr>' : '') +
            '<tr><th>SHA-256</th><td class="mono sm">' + esc(R.sha256) + '</td></tr><tr><th>Modified</th><td>' + esc(String(R.modified).replace('T', ' ').slice(0, 19)) + '</td></tr></table></div>';
    }
    el.innerHTML = h;
}

// ── Classes ────────────────────────────────────────────────────
var KIND_IC = { 'class': 'fa-cube', 'static class': 'fa-cubes-stacked', 'abstract class': 'fa-cube', 'interface': 'fa-plug', 'struct': 'fa-square', 'enum': 'fa-list-ol', 'delegate': 'fa-arrow-right-arrow-left',
    ctor: 'fa-hammer', method: 'fa-bolt', property: 'fa-sliders', event: 'fa-bell', field: 'fa-tag', value: 'fa-hashtag', operator: 'fa-plus-minus' };
var MEMBER_GROUPS = [['ctor', 'Constructors'], ['property', 'Properties'], ['method', 'Methods'], ['operator', 'Operators'], ['event', 'Events'], ['field', 'Fields'], ['value', 'Values']];

function typeMatches(t, words) {
    if (!words.length) return { type: true, members: null };
    var hay = (t.id + ' ' + (t.summary || '')).toLowerCase();
    var typeHit = words.every(function (w) { return hay.indexOf(w) >= 0; });
    var mem = t.members.filter(function (m) { var s = (m.name + ' ' + m.signature + ' ' + (m.summary || '')).toLowerCase(); return words.every(function (w) { return s.indexOf(w) >= 0; }); });
    return typeHit || mem.length ? { type: typeHit, members: typeHit ? null : mem } : null;
}
function renderTypes(el) {
    var R = X.rep, words = X.tq.toLowerCase().split(/\s+/).filter(Boolean);
    var h = '<div class="split"><div class="tree"><div class="tq"><i class="fa-solid fa-magnifying-glass"></i><input id="tq" type="search" placeholder="Search classes, methods, docs…" value="' + esc(X.tq) + '"></div><div class="tlist" id="tlist">';
    var shown = 0, firstId = null;
    (R.namespaces || []).forEach(function (n) {
        var rows = '';
        n.types.forEach(function (t) {
            var m = typeMatches(t, words); if (!m) return;
            shown++; if (!firstId) firstId = t.id;
            rows += '<button class="trow' + (t.id === X.typeId ? ' on' : '') + '" data-type="' + esc(t.id) + '"><i class="fa-solid ' + (KIND_IC[t.kind] || 'fa-cube') + ' kc-' + t.kind.replace(' ', '-') + '"></i>' +
                '<span>' + esc(t.name) + '</span>' + (t.access !== 'public' ? '<em>int</em>' : '') + (m.members ? '<small>' + m.members.length + '</small>' : '') + '</button>';
        });
        if (!rows) return;
        var open = words.length || X.openNs[n.name] || X.ns === n.name || (R.namespaces.length === 1);
        h += '<div class="tns' + (open ? ' open' : '') + '"><button class="tnsh" data-ns-toggle="' + esc(n.name) + '"><i class="fa-solid fa-chevron-right"></i> ' + esc(n.name) + ' <small>' + n.types.length + '</small></button><div class="tnsb">' + rows + '</div></div>';
    });
    if (!shown) h += '<div class="muted sm pad">' + (words.length ? 'No match.' : R.stats.types ? 'No public classes — tick “Include internal”.' : 'No classes.') + '</div>';
    h += '</div></div><div class="tdetail" id="tdetail"></div></div>';
    el.innerHTML = h;
    if (!X.typeId && firstId && !words.length) X.typeId = null;
    renderTypeDetail();
    var q = $('tq');
    q.addEventListener('input', function () {
        clearTimeout(q.t); q.t = setTimeout(function () { X.tq = q.value; var pos = q.selectionStart; renderTypes(el); var nq = $('tq'); nq.focus(); try { nq.setSelectionRange(pos, pos); } catch (e) { } }, 180);
    });
    if (X.ns) { var sec = el.querySelector('[data-ns-toggle="' + CSS.escape(X.ns) + '"]'); if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: 'start' }); }
    var on = el.querySelector('.trow.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
}
function findType(id) { var r = null; (X.rep.namespaces || []).some(function (n) { return n.types.some(function (t) { if (t.id === id) { r = t; return true; } }); }); return r; }
function sigHtml(sig) {
    return esc(sig).replace(/\b(public|static|async|void|string|int|long|bool|object|double|decimal|float|byte|char|short|const|readonly|ref|out|in|event|get|set|private|delegate)\b/g, '<span class="kw">$1</span>')
        .replace(/(\[[A-Za-z, ]+\])$/, '<span class="at">$1</span>');
}
function renderTypeDetail() {
    var el = $('tdetail'); if (!el) return;
    var t = X.typeId && findType(X.typeId);
    if (!t) {
        el.innerHTML = '<div class="tempty"><i class="fa-solid fa-hand-pointer"></i><p>Pick a class on the left.</p><p class="muted sm">Tip: search looks inside member names and documentation too — try “print”, “http”, “save”.</p></div>';
        return;
    }
    var words = X.tq.toLowerCase().split(/\s+/).filter(Boolean), mt = typeMatches(t, words) || {};
    var h = '<div class="thead"><i class="fa-solid ' + (KIND_IC[t.kind] || 'fa-cube') + ' kc-' + t.kind.replace(' ', '-') + '"></i><div><div class="tkind">' + esc(t.access + ' ' + t.kind) + '</div><h3>' + esc(t.name) + '</h3>' +
        '<div class="muted sm mono">' + esc(t.id) + '</div>' +
        (t.base || (t.interfaces || []).length ? '<div class="inh">: ' + esc([t.base].concat(t.interfaces || []).filter(Boolean).join(', ')) + '</div>' : '') +
        ((t.attributes || []).length ? '<div class="pills">' + t.attributes.map(function (a) { return '<span class="pill at">[' + esc(a) + ']</span>'; }).join('') + '</div>' : '') + '</div>' +
        (X.rep.kind !== 'native' ? '<button class="btn sm" data-dec="' + esc(t.id) + '"><i class="fa-solid fa-code"></i> Decompile class</button>' : '') + '</div>';
    if (t.summary) h += '<div class="tsum"><i class="fa-solid fa-book"></i> ' + esc(t.summary) + '</div>';
    var list = mt.members || t.members;
    if (mt.members) h += '<div class="muted sm pad">' + mt.members.length + ' of ' + t.members.length + ' members match “' + esc(X.tq) + '”</div>';
    MEMBER_GROUPS.forEach(function (g) {
        var ms = list.filter(function (m) { return m.kind === g[0]; });
        if (!ms.length) return;
        h += '<div class="mgrp"><div class="mgh">' + g[1] + ' <small>' + ms.length + '</small></div>' + ms.map(function (m) {
            var canDec = X.rep.kind !== 'native' && (m.kind === 'method' || m.kind === 'ctor' || m.kind === 'property' || m.kind === 'operator');
            return '<div class="mrow"><i class="fa-solid ' + (KIND_IC[m.kind] || 'fa-circle') + ' mk-' + m.kind + '"></i><div class="msig"><code>' + (m.access !== 'public' ? '<span class="acc">' + m.access + '</span> ' : '') +
                (m.static ? '<span class="kw">static</span> ' : '') + (m.async ? '<span class="kw">async</span> ' : '') + sigHtml(m.signature) + '</code>' +
                (m.summary ? '<div class="mdoc">' + esc(m.summary) + '</div>' : '') + '</div>' +
                (canDec ? '<button class="ib" title="Decompile" data-dec="' + esc(t.id + '::' + (m.kind === 'ctor' ? '.ctor' : m.name)) + '"><i class="fa-solid fa-code"></i></button>' : '') + '</div>';
        }).join('') + '</div>';
    });
    if (!t.members.length) h += '<p class="muted pad">No ' + (X.internal ? '' : 'public ') + 'members.</p>';
    el.innerHTML = h;
    el.scrollTop = 0;
}

// ── Integrations ───────────────────────────────────────────────
var WIN_DLL = {
    'kernel32.dll': 'Core Windows — files, memory, processes, threads', 'user32.dll': 'Windows UI — windows, messages, keyboard and mouse', 'gdi32.dll': 'Drawing — fonts, bitmaps, printing surfaces',
    'advapi32.dll': 'Registry, services, security and event log', 'shell32.dll': 'Shell — folders, file associations, icons', 'shlwapi.dll': 'Shell helpers — paths, strings, URLs',
    'ole32.dll': 'COM objects', 'oleaut32.dll': 'COM automation (VARIANT, BSTR)', 'combase.dll': 'COM runtime', 'ws2_32.dll': 'Network sockets (TCP/UDP)', 'winhttp.dll': 'HTTP client',
    'wininet.dll': 'Internet (HTTP/FTP) client', 'urlmon.dll': 'URL downloads', 'crypt32.dll': 'Certificates and data protection', 'bcrypt.dll': 'Cryptography (hash, encrypt)', 'ncrypt.dll': 'Key storage',
    'winspool.drv': 'Printers and print jobs', 'comdlg32.dll': 'Open/Save/Print dialogs', 'comctl32.dll': 'Common controls', 'ntdll.dll': 'Native Windows API (low level)', 'version.dll': 'File version information',
    'dwmapi.dll': 'Desktop window effects', 'uxtheme.dll': 'Visual styles', 'setupapi.dll': 'Hardware devices', 'iphlpapi.dll': 'Network configuration', 'secur32.dll': 'Authentication (SSPI)',
    'sspicli.dll': 'Authentication (SSPI)', 'netapi32.dll': 'Network, domain and user accounts', 'psapi.dll': 'Process information', 'dbghelp.dll': 'Debugging / crash dumps', 'mscoree.dll': '.NET runtime loader',
    'webview2loader.dll': 'Microsoft Edge WebView2 loader', 'd3d11.dll': 'Direct3D 11 graphics', 'd3d9.dll': 'Direct3D 9 graphics', 'dxgi.dll': 'DirectX graphics devices', 'winmm.dll': 'Multimedia — sound, timers',
    'userenv.dll': 'User profiles', 'wtsapi32.dll': 'Remote Desktop sessions', 'rpcrt4.dll': 'Remote procedure calls', 'imm32.dll': 'Input methods (Asian languages)', 'odbc32.dll': 'ODBC databases',
    'gdiplus.dll': 'GDI+ imaging', 'windowscodecs.dll': 'Image codecs (WIC)', 'd2d1.dll': 'Direct2D drawing', 'dwrite.dll': 'DirectWrite text', 'hid.dll': 'USB HID devices (scanners, keyboards)',
    'winusb.dll': 'USB devices', 'mpr.dll': 'Network drives', 'wldap32.dll': 'LDAP directory', 'dnsapi.dll': 'DNS lookups', 'msi.dll': 'Windows Installer', 'wintrust.dll': 'Signature verification',
    'propsys.dll': 'Property system', 'powrprof.dll': 'Power management', 'cfgmgr32.dll': 'Device configuration'
};
function dllDesc(n) {
    var l = String(n).toLowerCase();
    if (WIN_DLL[l]) return WIN_DLL[l];
    if (/^api-ms-win-crt-/.test(l) || /^(ucrtbase|msvcrt)/.test(l)) return 'C runtime library';
    if (/^(vcruntime|msvcp)/.test(l)) return 'Visual C++ runtime';
    if (/^api-ms-win-/.test(l)) return 'Windows API set';
    return '';
}
function renderIntegrations(el) {
    var R = X.rep, h = '';
    var imps = R.imports || [];
    if (imps.length) {
        h += '<div class="sec"><h3><i class="fa-solid fa-right-to-bracket"></i> ' + (R.kind === 'native' ? 'Windows functions it imports' : 'Windows APIs it calls directly (P/Invoke)') + ' <small>' + imps.length + ' DLLs · ' + importsCount() + ' functions</small></h3><div class="imps">';
        imps.forEach(function (im, i) {
            var open = X.impOpen[i], fns = open ? im.functions : im.functions.slice(0, 24);
            h += '<div class="imp"><div class="imph"><i class="fa-solid fa-cubes"></i><b>' + esc(im.dll) + '</b>' + (im.via === 'delay' ? '<span class="chip">delay-load</span>' : im.via === 'pinvoke' ? '<span class="chip">P/Invoke</span>' : '') +
                '<span class="muted sm">' + esc(dllDesc(im.dll)) + '</span><span class="ct">' + im.functions.length + '</span></div><div class="fns">' +
                fns.map(function (f) { return '<span class="fn">' + esc(f) + '</span>'; }).join('') +
                (im.functions.length > 24 ? '<button class="lnk" data-imp="' + i + '">' + (open ? 'less' : '+' + (im.functions.length - 24) + ' more') + '</button>' : '') + '</div></div>';
        });
        h += '</div></div>';
    }
    if ((R.exports || []).length || R.exportsTotal) {
        var q = X.exQ.toLowerCase(), ex = (R.exports || []).filter(function (e) { return !q || e.name.toLowerCase().indexOf(q) >= 0; });
        h += '<div class="sec"><h3><i class="fa-solid fa-right-from-bracket"></i> Functions it exports <small>' + (R.exports || []).length + ' named of ' + R.exportsTotal + ' — what other programs can call</small></h3>' +
            '<div class="tq sm"><i class="fa-solid fa-magnifying-glass"></i><input id="exq" type="search" placeholder="Filter exports…" value="' + esc(X.exQ) + '"></div><div class="exps">' +
            ex.slice(0, 1500).map(function (e) { return '<span class="fn" title="Ordinal ' + e.ordinal + (e.forward ? ' → ' + esc(e.forward) : '') + '">' + esc(e.name) + (e.forward ? ' <small>→ ' + esc(e.forward) + '</small>' : '') + '</span>'; }).join('') +
            (ex.length > 1500 ? '<span class="muted sm">… ' + (ex.length - 1500) + ' more — filter to narrow</span>' : '') + '</div></div>';
    }
    var S = R.strings || {}, kinds = Object.keys(S);
    var KI = { URL: 'fa-globe', SQL: 'fa-database', Endpoint: 'fa-route', Path: 'fa-folder', Registry: 'fa-sitemap' };
    if (kinds.length) {
        h += '<div class="sec"><h3><i class="fa-solid fa-quote-left"></i> Hard-coded values <small>URLs, SQL, paths and registry keys written into the code — secrets masked</small></h3>';
        kinds.forEach(function (k) {
            h += '<div class="strs"><div class="strh"><i class="fa-solid ' + (KI[k] || 'fa-quote-left') + '"></i> ' + esc(k) + ' <small>' + S[k].length + '</small></div>' +
                S[k].map(function (s) { return '<div class="str' + (k === 'SQL' ? ' sql' : '') + '"><code>' + esc(s) + '</code><button class="ib" data-copy="' + esc(s) + '" title="Copy"><i class="fa-regular fa-copy"></i></button></div>'; }).join('') + '</div>';
        });
        h += '</div>';
    }
    if (!h) h = '<p class="muted pad">No imports, exports or hard-coded values found.</p>';
    el.innerHTML = h;
    var eq = $('exq');
    if (eq) eq.addEventListener('input', function () { clearTimeout(eq.t); eq.t = setTimeout(function () { X.exQ = eq.value; var p = eq.selectionStart; renderIntegrations(el); var n = $('exq'); n.focus(); try { n.setSelectionRange(p, p); } catch (e) { } }, 200); });
}

// ── Code ───────────────────────────────────────────────────────
var CS_KW = 'abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach get goto if implicit in init int interface internal is lock long namespace new null object operator out override params private protected public readonly record ref return sbyte sealed set short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile when where while yield nameof value'.split(' ');
var CS_KW_SET = {}; CS_KW.forEach(function (k) { CS_KW_SET[k] = 1; });
function hlCs(code) {
    var out = '', i = 0, n = code.length;
    var rx = /(\/\/\/?[^\n]*)|(\/\*[\s\S]*?\*\/)|(@"(?:[^"]|"")*"|\$?"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\b\d+(?:\.\d+)?[fFdDmMlLuU]?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|(\[[A-Z][A-Za-z]*(?:\([^\]\n]*\))?\])/g, m, last = 0;
    while ((m = rx.exec(code))) {
        out += esc(code.slice(last, m.index));
        if (m[1] || m[2]) out += '<span class="c">' + esc(m[0]) + '</span>';
        else if (m[3]) out += '<span class="s">' + esc(m[0]) + '</span>';
        else if (m[4]) out += '<span class="n">' + esc(m[0]) + '</span>';
        else if (m[5]) out += CS_KW_SET[m[0]] ? '<span class="k">' + m[0] + '</span>' : /^[A-Z]/.test(m[0]) ? '<span class="t">' + m[0] + '</span>' : esc(m[0]);
        else out += '<span class="a">' + esc(m[0]) + '</span>';
        last = rx.lastIndex;
    }
    return out + esc(code.slice(last));
}
function decompile(target) {
    if (!target) return;
    X.tab = 'code';
    busy('Decompiling ' + target + '…');
    return dll('dllDecompile', { path: X.path, target: target }).then(function (d) {
        X.code = { target: target, text: d.code, ms: d.ms };
        X.codeHist = [target].concat(X.codeHist.filter(function (t) { return t !== target; })).slice(0, 12);
    }).catch(function (e) { X.code = { target: target, error: String(e) }; })
      .then(function () { busy(null); renderTab(); });
}
function renderCode(el) {
    var C = X.code;
    var h = '<div class="codebar"><div class="tq grow"><i class="fa-solid fa-code"></i><input id="ctarget" list="chist" placeholder="Ns.Type  or  Ns.Type::Method" value="' + esc(C ? C.target : '') + '" spellcheck="false"></div>' +
        '<datalist id="chist">' + X.codeHist.map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist>' +
        '<button class="btn primary" data-act="decompile"><i class="fa-solid fa-play"></i> Decompile</button>' +
        (C && C.text ? '<button class="btn" data-act="copycode"><i class="fa-regular fa-copy"></i> Copy</button>' : '') + '</div>';
    if (!C) h += '<div class="tempty"><i class="fa-solid fa-code"></i><p>Decompile a class or method to read its code.</p><p class="muted sm">Use the <i class="fa-solid fa-code"></i> buttons in <b>Classes</b>, or type a name above. Passwords and keys are masked.</p></div>';
    else if (C.error) h += '<div class="err"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(C.error) + '</div>';
    else {
        var lines = C.text.split('\n');
        h += '<div class="muted sm pad">' + esc(C.target) + ' · ' + lines.length + ' lines · ' + C.ms + ' ms</div><div class="code"><pre class="ln">' +
            lines.map(function (_, i) { return i + 1; }).join('\n') + '</pre><pre class="src">' + hlCs(C.text) + '</pre></div>';
    }
    el.innerHTML = h;
    var ct = $('ctarget');
    ct.addEventListener('keydown', function (e) { if (e.key === 'Enter') decompile(ct.value.trim()); });
}

// ── Feature map (AI) ───────────────────────────────────────────
function renderMap(el) {
    var R = X.rep, M = X.map, saved = mapFor(R), older = mapsByName(R);
    var h = '<div class="aibar"><div class="tq grow"><i class="fa-solid fa-bullseye"></i><input id="focus" placeholder="Focus (optional) — e.g. how orders are sent to MRA, what it prints, which tables it writes" value="' + esc(M && M.focus || '') + '"></div>' +
        '<button class="btn ai" data-act="explain"' + (M && M.running ? ' disabled' : '') + '><i class="fa-solid fa-wand-magic-sparkles"></i> ' + (M && M.markdown || saved ? 'Explain again' : 'Explain with AI') + '</button></div>';
    if (!X.hasKey) h += '<div class="warns"><div><i class="fa-solid fa-key"></i> Add your Claude API key first (<b>AI key</b> at the top right) — it is the same key Fusion SQL › Ask AI uses, stored encrypted on this PC.</div></div>';
    if (M && M.running) {
        h += '<div class="run"><div class="run-h"><i class="fa-solid fa-circle-notch fa-spin"></i> Claude is exploring ' + esc(R.fileName) + '…</div><ol class="steps">' +
            M.steps.map(function (s, i) { return '<li' + (i === M.steps.length - 1 ? ' class="now"' : '') + '>' + esc(s) + '</li>'; }).join('') + '</ol></div>';
    } else if (M && M.error) {
        h += '<div class="err"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(M.error) + '</div>';
    }
    if (M && M.markdown) {
        h += '<div class="mapbar"><span class="muted sm">' + (M.fromSaved ? 'Saved map · ' + esc(M.fromSaved) : 'Written by Claude after ' + (M.steps || []).length + ' look-ups') + '</span>' +
            (!M.fromSaved ? '<button class="btn primary sm" data-act="savemap"' + (M.saved ? ' disabled' : '') + '><i class="fa-solid fa-cloud-arrow-up"></i> ' + (M.saved ? 'Saved' : 'Save to APEX') + '</button>' : '') +
            '<button class="btn sm" data-act="copymap"><i class="fa-regular fa-copy"></i> Copy</button><button class="btn sm" data-act="dlmap"><i class="fa-solid fa-download"></i> .md</button>' +
            '<button class="btn sm" data-act="askchat" title="Copy a question for the AI Digital Employee and open it"><i class="fa-solid fa-comments"></i> Ask the AI Employee</button></div>' +
            '<article class="md">' + mdHtml(M.markdown) + '</article>';
        if (!M.fromSaved && M.steps && M.steps.length) h += '<details class="how"><summary>How Claude researched it (' + M.steps.length + ' steps)</summary><ol>' + M.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></details>';
    } else if (!M || !M.running) {
        if (saved) h += '<div class="tempty"><i class="fa-solid fa-map"></i><p>A feature map for this exact file is saved.</p><button class="btn primary" data-act="loadmap" data-id="' + saved.MAP_ID + '" data-len="' + saved.LEN + '"><i class="fa-solid fa-book-open"></i> Show saved map</button></div>';
        else h += '<div class="tempty"><i class="fa-solid fa-robot"></i><p>Claude reads the outline, searches and decompiles the classes that matter, and writes a business-readable <b>feature map</b>:<br>summary · features with where they live · what it talks to · settings · risks · candidate chat actions.</p>' +
            (older.length ? '<p class="muted sm">Maps exist for other versions: ' + older.map(function (m) { return '<button class="lnk" data-act="loadmap" data-id="' + m.MAP_ID + '" data-len="' + m.LEN + '">' + esc(m.FILE_VERSION || m.UPD) + '</button>'; }).join(', ') + '</p>' : '') +
            '<p class="muted sm"><i class="fa-solid fa-shield-halved"></i> Only the outline and the code Claude asks for are sent; passwords and keys are masked. Nothing is run.</p></div>';
    }
    el.innerHTML = h;
}
function explain() {
    if (!X.rep) return;
    if (!X.hasKey) { keyDialog(); return; }
    var f = $('focus'), focus = f ? f.value.trim() : '';
    X.tab = 'map';
    X.map = { running: true, steps: [], focus: focus };
    renderHero(); renderTab();
    dll('dllExplain', { path: X.path, includeInternal: X.internal, focus: focus }, function (msg) {
        if (!X.map || !X.map.running) return;
        if (/^Claude is /.test(msg) && X.map.steps.length && /^Claude is /.test(X.map.steps[X.map.steps.length - 1])) X.map.steps[X.map.steps.length - 1] = msg;
        else X.map.steps.push(msg);
        if (X.tab === 'map') renderTab();
    }).then(function (d) {
        X.map = { markdown: d.markdown, steps: (d.steps || []), focus: focus };
    }).catch(function (e) {
        X.map = { error: String(e), steps: X.map ? X.map.steps : [], focus: focus };
    }).then(function () { if (X.tab === 'map') renderTab(); });
}
function loadSavedMap(id, len) {
    var m = X.maps.filter(function (x) { return String(x.MAP_ID) === String(id); })[0];
    busy('Reading the saved map…');
    return readMap(id, +len).then(function (md) {
        X.map = { markdown: md, fromSaved: (m ? m.FILE_NAME + ' ' + (m.FILE_VERSION || '') + ' · ' + m.UPD : ''), steps: [] };
        X.tab = 'map';
    }).catch(function (e) { toast('Cannot read the map: ' + e); })
      .then(function () { busy(null); if (X.rep) renderTab(); });
}
function openSavedMap(id) {
    var m = X.maps.filter(function (x) { return String(x.MAP_ID) === String(id); })[0];
    if (!m) return;
    // show the map; open the DLL too when this PC still has it
    busy('Reading the saved map…');
    readMap(m.MAP_ID, +m.LEN).then(function (md) {
        busy(null);
        if (X.rep && X.rep.sha256 === m.SHA256) { X.map = { markdown: md, fromSaved: m.UPD, steps: [] }; X.tab = 'map'; render(); return; }
        modal('<h2><i class="fa-solid fa-map"></i> ' + esc(m.FILE_NAME) + ' <small class="muted">' + esc(m.FILE_VERSION || '') + '</small></h2>' +
            '<p class="muted sm">Saved ' + esc(m.UPD) + ' by ' + esc(m.UPDATED_BY || '') + '</p><article class="md">' + mdHtml(md) + '</article>' +
            '<div class="modal-f"><button class="btn" data-mact="close">Close</button></div>');
    }).catch(function (e) { busy(null); toast('Cannot read the map: ' + e); });
}

// ── Compare two versions ───────────────────────────────────────
function apiSet(R) {
    var types = {}, mem = {};
    (R.namespaces || []).forEach(function (n) { n.types.forEach(function (t) { types[t.id] = t; t.members.forEach(function (m) { mem[t.id + '|' + m.kind + '|' + m.signature] = { t: t.id, m: m }; }); }); });
    (R.exports || []).forEach(function (e) { mem['export|' + e.name] = { t: '(exports)', m: { kind: 'export', signature: e.name } }; });
    return { types: types, mem: mem };
}
function compare() {
    dll('dllPick', { current: X.path }).then(function (d) {
        if (!d.ok || !d.path) return;
        busy('Reading ' + baseName(d.path) + '…');
        return dll('dllInspect', { path: d.path, includeInternal: X.internal }).then(function (r) {
            busy(null);
            showCompare(X.rep, r.report);
        });
    }).catch(function (e) { busy(null); toast(String(e)); });
}
function showCompare(A, B) {
    var a = apiSet(A), b = apiSet(B);
    var tAdd = Object.keys(b.types).filter(function (k) { return !a.types[k]; }), tDel = Object.keys(a.types).filter(function (k) { return !b.types[k]; });
    var mAdd = Object.keys(b.mem).filter(function (k) { return !a.mem[k] && !tAdd.some(function (t) { return b.mem[k].t === t; }); });
    var mDel = Object.keys(a.mem).filter(function (k) { return !b.mem[k] && !tDel.some(function (t) { return a.mem[k].t === t; }); });
    function ver(R) { var v = R.version || {}; return v.FileVersion || v['FileVersion#'] || (R.assembly && R.assembly.version) || ''; }
    function grp(keys, set) {
        var by = {};
        keys.forEach(function (k) { var x = set.mem[k]; (by[x.t] = by[x.t] || []).push(x.m); });
        return Object.keys(by).sort().map(function (t) { return '<div class="cmpt"><b class="mono">' + esc(t) + '</b>' + by[t].map(function (m) { return '<div class="mono sm">' + esc(m.signature) + '</div>'; }).join('') + '</div>'; }).join('');
    }
    var capA = (A.capabilities || []).map(function (c) { return c.name; }), capB = (B.capabilities || []).map(function (c) { return c.name; });
    var cAdd = capB.filter(function (c) { return capA.indexOf(c) < 0; }), cDel = capA.filter(function (c) { return capB.indexOf(c) < 0; });
    var same = A.sha256 === B.sha256;
    var h = '<h2><i class="fa-solid fa-code-compare"></i> Compare</h2><div class="cmphead"><div><b>' + esc(A.fileName) + '</b><small>' + esc(ver(A)) + ' · ' + fmtSize(A.size) + '</small><small class="mono">' + esc(A.file) + '</small></div>' +
        '<i class="fa-solid fa-arrow-right"></i><div><b>' + esc(B.fileName) + '</b><small>' + esc(ver(B)) + ' · ' + fmtSize(B.size) + '</small><small class="mono">' + esc(B.file) + '</small></div></div>';
    if (same) h += '<p class="ok-box"><i class="fa-solid fa-equals"></i> Identical files (same SHA-256).</p>';
    else {
        h += '<div class="stats sm">' + [['fa-plus', 'classes added', tAdd.length, 'add'], ['fa-minus', 'classes removed', tDel.length, 'del'], ['fa-plus', 'members added', mAdd.length, 'add'], ['fa-minus', 'members removed', mDel.length, 'del']]
            .map(function (t) { return '<div class="stat ' + t[3] + '"><i class="fa-solid ' + t[0] + '"></i><b>' + t[2] + '</b><span>' + t[1] + '</span></div>'; }).join('') + '</div>';
        if (cAdd.length || cDel.length) h += '<p>' + cAdd.map(function (c) { return '<span class="pill add">+ ' + esc(c) + '</span>'; }).join('') + cDel.map(function (c) { return '<span class="pill del">− ' + esc(c) + '</span>'; }).join('') + '</p>';
        var refA = (A.references || []).join('|'), refB = (B.references || []).join('|');
        if (refA !== refB) {
            var rA = A.references || [], rB = B.references || [];
            h += '<p class="sm"><b>References changed:</b> ' + rB.filter(function (r) { return rA.indexOf(r) < 0; }).map(function (r) { return '<span class="pill add">' + esc(r) + '</span>'; }).join('') +
                rA.filter(function (r) { return rB.indexOf(r) < 0; }).map(function (r) { return '<span class="pill del">' + esc(r) + '</span>'; }).join('') + '</p>';
        }
        h += '<div class="cmpgrid"><div><h4 class="add">Added</h4>' + (tAdd.length ? '<div class="cmpt"><b>Classes</b>' + tAdd.map(function (t) { return '<div class="mono sm">' + esc(t) + '</div>'; }).join('') + '</div>' : '') + grp(mAdd, b) + (!tAdd.length && !mAdd.length ? '<p class="muted sm">Nothing.</p>' : '') + '</div>' +
            '<div><h4 class="del">Removed</h4>' + (tDel.length ? '<div class="cmpt"><b>Classes</b>' + tDel.map(function (t) { return '<div class="mono sm">' + esc(t) + '</div>'; }).join('') + '</div>' : '') + grp(mDel, a) + (!tDel.length && !mDel.length ? '<p class="muted sm">Nothing.</p>' : '') + '</div></div>';
        if (!tAdd.length && !tDel.length && !mAdd.length && !mDel.length) h += '<p class="muted">The ' + (X.internal ? '' : 'public ') + 'API is the same — only the code inside changed. Decompile a method in both to see how.</p>';
    }
    h += '<div class="modal-f"><button class="btn" data-mact="close">Close</button></div>';
    modal(h, true);
}

// ── dialogs ────────────────────────────────────────────────────
function modal(html, wide) {
    if (html == null) { $('modal').hidden = true; return; }
    $('modal-box').innerHTML = html;
    $('modal-box').classList.toggle('wide', !!wide);
    $('modal').hidden = false;
}
function keyDialog() {
    modal('<h2><i class="fa-solid fa-key"></i> Claude API key</h2><p class="muted">Used by <b>Explain with AI</b>. It is the same key Fusion SQL › Ask AI uses — stored encrypted (Windows DPAPI) on this PC and never sent to this page.</p>' +
        '<label class="fld"><span>API key' + (X.hasKey ? ' <em>(one is saved — paste a new one to replace it)</em>' : '') + '</span><input id="k-key" type="password" placeholder="sk-ant-…" autocomplete="off"></label>' +
        '<div class="modal-f"><button class="btn" data-mact="close">Cancel</button><button class="btn primary" data-mact="savekey"><i class="fa-solid fa-check"></i> Save</button></div>');
    setTimeout(function () { $('k-key').focus(); }, 30);
}
function askChat() {
    var R = X.rep;
    var q = 'What does ' + R.fileName + ' do? It is at ' + R.file + '. Check the saved feature map in wms_ai_dll_maps first, then read the DLL if you need more.';
    copyText(q);
    toast('Question copied — paste it into the AI Digital Employee');
    setTimeout(function () { location.href = '../aianalysis/index.html'; }, 900);
}
function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ── events ─────────────────────────────────────────────────────
document.addEventListener('click', function (e) {
    var b = e.target.closest('button, [data-open], [data-map]');
    if (!b) { if (e.target.id === 'modal') modal(null); return; }
    var d = b.dataset;
    if (d.open) return openDll(d.open);
    if (d.map) return openSavedMap(d.map);
    if (d.tab) { X.tab = d.tab; return renderTab(); }
    if (d.ns) { X.ns = d.ns; X.openNs[d.ns] = true; X.tab = 'types'; X.tq = ''; return renderTab(); }
    if (d.nsToggle != null) { var box = b.parentNode; box.classList.toggle('open'); X.openNs[d.nsToggle] = box.classList.contains('open'); return; }
    if (d.type) {
        X.typeId = d.type;
        Array.prototype.forEach.call(document.querySelectorAll('.trow'), function (r) { r.classList.toggle('on', r === b); });
        return renderTypeDetail();
    }
    if (d.dec) return decompile(d.dec);
    if (d.imp != null) { X.impOpen[d.imp] = !X.impOpen[d.imp]; return renderTab(); }
    if (d.copy != null) return copyText(d.copy);
    if (d.mact === 'close') return modal(null);
    if (d.mact === 'savekey') {
        var k = $('k-key').value.trim();
        if (!/^sk-/.test(k)) { toast('That does not look like a Claude API key'); return; }
        return dll('dllSaveAiKey', { apiKey: k }).then(function (r) { X.hasKey = !!r.hasAiKey; modal(null); toast('Key saved'); loadSuggest(); if (X.rep) renderTab(); }).catch(function (e2) { toast(String(e2)); });
    }
    switch (d.act) {
        case 'explain': return explain();
        case 'compare': return compare();
        case 'folder': return dll('dllOpenFolder', { folder: X.path });
        case 'reload': return openDll(X.path, true);
        case 'decompile': return decompile(($('ctarget').value || '').trim());
        case 'copycode': return X.code && copyText(X.code.text);
        case 'savemap': return saveMap();
        case 'copymap': return X.map && copyText(X.map.markdown);
        case 'dlmap': return X.map && download(X.rep.fileName.replace(/\.\w+$/, '') + '-feature-map.md', X.map.markdown);
        case 'loadmap': return loadSavedMap(d.id, d.len);
        case 'askchat': return askChat();
    }
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('modal').hidden) modal(null); });

$('b-open').addEventListener('click', pickDll);
$('path').addEventListener('keydown', function (e) { if (e.key === 'Enter' && this.value.trim()) openDll(this.value.trim()); });
$('b-drop').addEventListener('click', function () { dll('dllOpenFolder', {}).then(function () { setTimeout(loadSuggest, 4000); }).catch(function (e) { toast(String(e)); }); });
$('b-clear-recent').addEventListener('click', function () { lsSet('dx_recent', []); renderRecent(); });
$('b-maps-refresh').addEventListener('click', loadMaps);
$('b-key').addEventListener('click', keyDialog);
$('fq').addEventListener('input', function () { X.fq = this.value; renderSuggest(); });
// drag a DLL onto the page: WebView2 exposes the path only through the host, so accept a pasted path instead
document.addEventListener('dragover', function (e) { e.preventDefault(); });
document.addEventListener('drop', function (e) { e.preventDefault(); toast('Use “Open a DLL…” or paste the full path — the browser cannot see where a dropped file lives.'); });

renderRecent();
if (hasHost()) {
    loadSuggest();
    loadMaps();
    var qp = new URLSearchParams(location.search).get('path');
    if (qp) openDll(qp);
} else {
    $('suggest').innerHTML = '<div class="muted sm">Open this page inside the Gray\'s WMS app.</div>';
    $('maps').innerHTML = '';
}
