/* ═══════════════════════════════════════════════════════════════
   Fusion SQL — read-only SQL workbench for Oracle Fusion Cloud.
   All network, credential and file work happens in the C# host
   (classes/FusionSqlService.cs); this page only calls host actions.
   ═══════════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────────
var FS = {
    status: null,                 // host status (config, pod, credentials, ai…)
    editor: null,                 // CodeMirror instance (or null → textarea)
    running: null,                // requestId of the executing statement
    result: null,                 // { columns, rows, isNum, isId, filtered, page, sortCol, sortDir, search, ... }
    logs: [],
    currentQuery: null,           // saved query loaded in the editor
    queries: [],
    schema: { owner: 'FUSION', kind: 'TABLE', names: [], filtered: [], shown: 200, capped: false, at: null },
    hintTables: {},
    ai: { history: [], busy: false },
    chart: null,
    calls: [],
    selectedCall: -1
};
var PAGE_SIZE = 100;
var SCHEMA_PAGE = 5000;
var SCHEMA_CEILING = 200000;
var LIST_CHUNK = 200;
var DETAIL_KINDS = { 'TABLE': 1, 'VIEW': 1, 'MATERIALIZED VIEW': 1, 'SYNONYM': 1 };
var ARG_KINDS = { 'PROCEDURE': 1, 'FUNCTION': 1, 'PACKAGE': 1 };
var KIND_ICONS = {
    'TABLE': 'fa-table', 'VIEW': 'fa-eye', 'MATERIALIZED VIEW': 'fa-layer-group', 'SYNONYM': 'fa-link',
    'PROCEDURE': 'fa-gears', 'FUNCTION': 'fa-square-root-variable', 'PACKAGE': 'fa-box', 'TRIGGER': 'fa-bolt',
    'SEQUENCE': 'fa-arrow-down-1-9', 'TYPE': 'fa-shapes'
};

// ── Small utilities ────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}
function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
function nowStamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
}
function timeStr() { return new Date().toLocaleTimeString(); }
function fmtBytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B'; }
function fmtMs(ms) { return ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : ms + ' ms'; }

function toast(msg, kind) {
    var t = document.createElement('div');
    var icon = kind === 'err' ? 'fa-circle-exclamation' : kind === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-check';
    t.className = 'fs-toast ' + (kind || 'ok');
    t.innerHTML = '<i class="fa-solid ' + icon + '"></i><span>' + esc(msg) + '</span>';
    $('fs-toasts').appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, kind === 'err' ? 5000 : 2800);
    setTimeout(function () { t.remove(); }, kind === 'err' ? 5400 : 3200);
}

function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('Copied to clipboard'); }, function () { fallbackCopy(text); });
    } else fallbackCopy(text);
}
function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied to clipboard'); } catch (e) { toast('Copy failed', 'err'); }
    ta.remove();
}

function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

function currentInstance() {
    var v = null;
    try {
        v = sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || localStorage.getItem('instanceName');
    } catch (e) { }
    v = (v || 'PROD').toUpperCase();
    return v === 'TEST' ? 'TEST' : 'PROD';
}

// ── Host bridge ────────────────────────────────────────────────
var _fsPending = {};
function fsCall(action, payload, onRequestId) {
    return new Promise(function (resolve, reject) {
        var id = 'fsql_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        var msg = Object.assign({ action: action, requestId: id, instance: currentInstance() }, payload || {});
        if (!(window.chrome && window.chrome.webview)) {
            reject('Fusion SQL needs the Gray\'s WMS desktop app (WebView2 host not found).');
            return;
        }
        _fsPending[id] = { resolve: resolve, reject: reject };
        if (onRequestId) onRequestId(id);
        window.chrome.webview.postMessage(msg);
    });
}
if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', function (ev) {
        var resp = ev.data;
        if (typeof resp === 'string') { try { resp = JSON.parse(resp); } catch (e) { return; } }
        if (!resp || !resp.requestId || !_fsPending[resp.requestId]) return;
        var p = _fsPending[resp.requestId];
        delete _fsPending[resp.requestId];
        if (resp.action === 'error') p.reject(resp.message || 'Host error');
        else p.resolve(resp.data);
    });
}

/** Run SQL through the BIP runner; resolves the result or rejects with the error text. */
function fsql(sql, rowLimit) {
    return fsCall('fusionSqlExecute', { sql: sql, rowLimit: rowLimit }).then(function (r) {
        if (!r || !r.success) throw (r && r.error) || 'Query failed';
        return r;
    });
}

function cacheGet(key, pod) { return fsCall('fusionSqlCacheGet', { key: key, pod: pod }).then(function (r) { return r && r.value; }); }
function cacheSet(key, value, pod) { return fsCall('fusionSqlCacheSet', { key: key, value: value, pod: pod }); }

// ── Tabs ───────────────────────────────────────────────────────
function showTab(name) {
    document.querySelectorAll('.fs-tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    document.querySelectorAll('.fs-page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + name); });
    lsSet('fusionSql.tab', name);
    if (name === 'builder' && FS.editor) setTimeout(function () { FS.editor.refresh(); }, 0);
    if (name === 'tables') dbInfo();
    if (name === 'inspector') loadCalls();
    if (name === 'connection') renderConnection();
    if (name === 'queries') renderQueries();
}
function showSub(name) {
    document.querySelectorAll('.fs-subtab').forEach(function (b) { b.classList.toggle('active', b.dataset.sub === name); });
    document.querySelectorAll('.fs-sub').forEach(function (p) { p.classList.toggle('active', p.id === 'sub-' + name); });
    if (name === 'chart') drawChart();
}

// ── Status / header ────────────────────────────────────────────
function loadStatus() {
    return fsCall('fusionSqlConfig', {}).then(function (s) {
        FS.status = s;
        renderHeader();
        if (!$('fs-rowlimit').dataset.touched) $('fs-rowlimit').value = s.config.rowLimit;
        return s;
    }).catch(function (e) { setConn('err', 'Host unavailable'); toast(String(e), 'err'); });
}

function renderHeader() {
    var s = FS.status; if (!s) return;
    var inst = $('fs-instance');
    inst.textContent = s.config.baseUrl ? s.pod.split('.')[0].toUpperCase() : s.instance;
    inst.classList.toggle('test', !s.config.baseUrl && s.instance === 'TEST');
    inst.title = s.origin;
    var c = s.credentials;
    $('fs-user').textContent = c.source === 'custom' ? (c.customUsername || '(no custom user)') : (c.appUsername || localStorage.getItem('username') || 'app account');
}

function setConn(state, text) {
    $('fs-conn-dot').className = 'fs-dot ' + (state || '');
    $('fs-conn-text').textContent = text;
}

// ── Editor ─────────────────────────────────────────────────────
function initEditor() {
    var ta = $('fs-editor');
    ta.value = lsGet('fusionSql.editor', null) || ta.value;
    if (window.CodeMirror) {
        FS.editor = CodeMirror.fromTextArea(ta, {
            mode: 'text/x-plsql',
            lineNumbers: true,
            matchBrackets: true,
            styleActiveLine: true,
            indentUnit: 4,
            lineWrapping: false,
            extraKeys: {
                'Ctrl-Enter': runEditor, 'Cmd-Enter': runEditor,
                'Ctrl-S': function () { openSaveDialog(); }, 'Cmd-S': function () { openSaveDialog(); },
                'Ctrl-Space': 'autocomplete',
                'Shift-Alt-F': formatEditor, 'Ctrl-Shift-F': formatEditor
            },
            hintOptions: { tables: FS.hintTables, completeSingle: false }
        });
        FS.editor.on('change', onEditorChange);
        FS.editor.on('inputRead', function (cm, change) {
            if (change.text[0] === '.' ) cm.showHint({ completeSingle: false, tables: FS.hintTables });
        });
    } else {
        ta.addEventListener('input', onEditorChange);
        ta.addEventListener('keydown', function (e) {
            if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); runEditor(); }
            if (e.ctrlKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); openSaveDialog(); }
        });
    }
    onEditorChange();
}
function getSql() { return FS.editor ? FS.editor.getValue() : $('fs-editor').value; }
function setSql(sql) {
    if (FS.editor) { FS.editor.setValue(sql); FS.editor.focus(); FS.editor.setCursor(FS.editor.lineCount(), 0); }
    else $('fs-editor').value = sql;
    onEditorChange();
}
function getRunSql() {
    if (FS.editor) { var sel = FS.editor.getSelection(); if (sel && sel.trim()) return sel; }
    else { var ta = $('fs-editor'); if (ta.selectionEnd > ta.selectionStart) return ta.value.substring(ta.selectionStart, ta.selectionEnd); }
    return getSql();
}
function insertAtCursor(text) {
    if (FS.editor) { FS.editor.replaceSelection(text); FS.editor.focus(); }
    else {
        var ta = $('fs-editor'), s = ta.selectionStart;
        ta.value = ta.value.slice(0, s) + text + ta.value.slice(ta.selectionEnd);
        ta.selectionStart = ta.selectionEnd = s + text.length; ta.focus();
    }
    onEditorChange();
}
var _editorSaveT = null;
function onEditorChange() {
    var sql = getSql();
    clearTimeout(_editorSaveT);
    _editorSaveT = setTimeout(function () { lsSet('fusionSql.editor', sql); }, 400);
    var params = detectParams(sql);
    var chip = $('fs-param-chip');
    if (params.length) { chip.style.display = ''; chip.textContent = params.length + ' parameter' + (params.length > 1 ? 's' : '') + ': ' + params.join(', '); }
    else chip.style.display = 'none';
    // Base64 of the capped statement must fit 4,000 bytes on most pods (RD §10)
    var approx = Math.ceil((new Blob([sql]).size + 40) * 4 / 3);
    var len = $('fs-len-chip');
    len.textContent = sql.length.toLocaleString() + ' chars';
    len.className = 'fs-chip ' + (approx > 4000 ? 'warn' : 'muted');
    len.title = approx > 4000 ? 'Longer than ~2,900 characters: may exceed the 4,000-byte SQL limit of the runner.' : '';
}

// ── SQL tokenizer: split code from literals/comments ──────────
function splitSql(sql) {
    var out = [], i = 0, start = 0, n = sql.length;
    function push(code, end) { if (end > start) out.push({ code: code, text: sql.slice(start, end) }); start = end; }
    while (i < n) {
        var c = sql[i], c2 = sql.substr(i, 2);
        if (c2 === '--') { push(true, i); var e = sql.indexOf('\n', i); e = e < 0 ? n : e; push(false, e); i = e; continue; }
        if (c2 === '/*') { push(true, i); var e2 = sql.indexOf('*/', i + 2); e2 = e2 < 0 ? n : e2 + 2; push(false, e2); i = e2; continue; }
        if ((c === 'q' || c === 'Q') && sql[i + 1] === "'" && i + 2 < n) {
            push(true, i);
            var open = sql[i + 2], close = { '[': ']', '{': '}', '(': ')', '<': '>' }[open] || open;
            var e3 = sql.indexOf(close + "'", i + 3); e3 = e3 < 0 ? n : e3 + 2;
            push(false, e3); i = e3; continue;
        }
        if (c === "'" || c === '"') {
            push(true, i);
            var j = i + 1;
            while (j < n) { if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } j++; break; } j++; }
            push(false, j); i = j; continue;
        }
        i++;
    }
    push(true, n);
    return out;
}
var RE_BRACE = /\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g;
var RE_BIND = /(^|[^:\w$#]):([A-Za-z_][\w$#]*)/g;
function detectParams(sql) {
    var seen = {}, list = [];
    splitSql(sql).forEach(function (seg) {
        if (!seg.code) return;
        var m;
        RE_BRACE.lastIndex = 0;
        while ((m = RE_BRACE.exec(seg.text))) if (!seen[m[1].toUpperCase()]) { seen[m[1].toUpperCase()] = 1; list.push(m[1]); }
        RE_BIND.lastIndex = 0;
        while ((m = RE_BIND.exec(seg.text))) if (!seen[m[2].toUpperCase()]) { seen[m[2].toUpperCase()] = 1; list.push(m[2]); }
    });
    return list;
}
function paramLiteral(v) {
    v = v == null ? '' : String(v);
    if (v.trim() === '') return 'NULL';
    if (/^-?\d+(\.\d+)?$/.test(v.trim())) return v.trim();
    return lit(v);
}
function substituteParams(sql, values) {
    var byUpper = {};
    Object.keys(values).forEach(function (k) { byUpper[k.toUpperCase()] = values[k]; });
    return splitSql(sql).map(function (seg) {
        if (!seg.code) return seg.text;
        return seg.text
            .replace(RE_BRACE, function (_, name) { return paramLiteral(byUpper[name.toUpperCase()]); })
            .replace(RE_BIND, function (_, pre, name) { return pre + paramLiteral(byUpper[name.toUpperCase()]); });
    }).join('');
}

function askParams(names) {
    return new Promise(function (resolve) {
        var saved = lsGet('fusionSql.params', {});
        var body = '<p class="fs-muted" style="margin-bottom:12px;">Blank = <code>NULL</code> (so <code>NVL(:P, col)</code> means "all"). Numbers are used as-is, anything else is quoted.</p>' +
            names.map(function (n, i) {
                return '<div class="fs-param-row"><code>' + esc(n) + '</code><input data-p="' + esc(n) + '" value="' + esc(saved[n.toUpperCase()] || '') + '"' + (i === 0 ? ' autofocus' : '') + '></div>';
            }).join('');
        openModal('Query parameters', body, [
            { label: 'Cancel', cls: 'ghost', onClick: function () { closeModal(); resolve(null); } },
            {
                label: '<i class="fa-solid fa-play"></i> Run', cls: 'primary', onClick: function () {
                    var vals = {};
                    document.querySelectorAll('#fs-modal-body input[data-p]').forEach(function (inp) {
                        vals[inp.dataset.p] = inp.value; saved[inp.dataset.p.toUpperCase()] = inp.value;
                    });
                    lsSet('fusionSql.params', saved);
                    closeModal(); resolve(vals);
                }
            }
        ]);
        var first = document.querySelector('#fs-modal-body input'); if (first) first.focus();
        $('fs-modal-body').onkeydown = function (e) { if (e.key === 'Enter') document.querySelector('#fs-modal-foot .primary').click(); };
    });
}

// ── Execute ────────────────────────────────────────────────────
function runEditor() {
    var sql = getRunSql();
    if (!sql.trim()) { toast('Nothing to run', 'warn'); return; }
    var params = detectParams(sql);
    var go = function (finalSql) { executeSql(finalSql, sql); };
    if (params.length) askParams(params).then(function (vals) { if (vals) go(substituteParams(sql, vals)); });
    else go(sql);
}

function executeSql(sql, original) {
    if (FS.running) { toast('A query is already running', 'warn'); return; }
    var limit = Math.max(1, Math.min(100000, parseInt($('fs-rowlimit').value, 10) || 100));
    $('fs-run-btn').disabled = true;
    $('fs-cancel-btn').style.display = '';
    setConn('busy', 'Running…');
    showSub('grid');
    var started = Date.now();
    $('fs-grid').innerHTML = '<div class="fs-empty"><div class="fs-running"><div class="fs-spinner"></div><h3>Running on ' + esc(FS.status ? FS.status.pod : 'Fusion') + '</h3><p id="fs-run-timer">0.0 s</p></div></div>';
    var timer = setInterval(function () { var t = $('fs-run-timer'); if (t) t.textContent = ((Date.now() - started) / 1000).toFixed(1) + ' s'; }, 100);
    $('fs-pager').innerHTML = '';
    addHistory(original || sql);

    fsCall('fusionSqlExecute', { sql: sql, rowLimit: limit }, function (id) { FS.running = id; })
        .then(function (r) {
            if (r && r.success) {
                setConn('ok', 'Connected · ' + fmtMs(r.elapsedMs));
                addLog(true, r.rowCount + ' row' + (r.rowCount === 1 ? '' : 's') + ' in ' + fmtMs(r.elapsedMs), sql);
                showResult(r, limit);
                if (r.warning) toast(r.warning, 'warn');
                if (FS.currentQuery) bumpRuns(FS.currentQuery.name);
            } else {
                var err = (r && r.error) || 'Unknown error';
                // An ORA- error means the pod answered: the connection is fine, the SQL is not
                var connBad = !/ORA-\d{5}/.test(err) && /\bHTTP \d{3}\b|Network error|Timed out|credentials/i.test(err);
                setConn(connBad ? 'err' : 'ok', connBad ? 'Connection problem' : 'Connected');
                addLog(false, 'ERROR: ' + err.split('\n')[0], sql);
                showError(err, r && (r.decoded ? 'Decoded report output:\n' + r.decoded : r.raw));
            }
        })
        .catch(function (e) { setConn('err', 'Error'); addLog(false, 'ERROR: ' + e, sql); showError(String(e)); })
        .then(function () {
            clearInterval(timer);
            FS.running = null;
            $('fs-run-btn').disabled = false;
            $('fs-cancel-btn').style.display = 'none';
            $('fs-calls-count').textContent = '…';
            fsCall('fusionSqlCalls', {}).then(function (c) { FS.calls = c.calls || []; $('fs-calls-count').textContent = FS.calls.length; }).catch(function () { });
        });
}

function cancelRun() {
    if (!FS.running) return;
    fsCall('fusionSqlCancel', { targetRequestId: FS.running }).then(function () { toast('Cancel requested', 'warn'); });
}

function showError(err, raw) {
    $('fs-result-count').textContent = '!';
    $('fs-result-meta').innerHTML = '<span class="fs-chip" style="background:#fee2e2;color:#b91c1c;">Error</span>';
    $('fs-grid').innerHTML = '<div class="fs-empty error"><i class="fa-solid fa-triangle-exclamation"></i><h3>The query failed</h3>' +
        '<div class="fs-error-box">' + esc(err) + '</div>' +
        (raw ? '<details style="max-width:820px;width:100%;text-align:left;margin-top:8px;"><summary class="fs-muted" style="cursor:pointer;">Raw response</summary><div class="fs-error-box" style="color:#57504b;background:#faf8f7;border-color:#e7e2de;">' + esc(raw) + '</div></details>' : '') +
        '<p class="fs-muted">Full request/response in the <a href="#" onclick="showTab(\'inspector\');return false;">API Inspector</a>.</p></div>';
}

// ── Results grid ───────────────────────────────────────────────
function isIdColumn(c) { return /(id|number)$/i.test(c); }

function showResult(r, limit) {
    var cols = r.columns || [];
    var isNum = {}, isId = {};
    cols.forEach(function (c) {
        isId[c] = isIdColumn(c);
        var any = false, all = true;
        for (var i = 0; i < r.rows.length && i < 500; i++) {
            var v = r.rows[i][c];
            if (v === '' || v == null) continue;
            any = true; if (typeof v !== 'number') { all = false; break; }
        }
        isNum[c] = any && all;
    });
    FS.result = { columns: cols, rows: r.rows, isNum: isNum, isId: isId, filtered: r.rows, page: 0, sortCol: null, sortDir: 1, search: '', capped: r.capped, elapsed: r.elapsedMs, decoded: r.decoded, limit: limit, sql: getRunSql() };
    $('fs-grid-search').value = '';
    $('fs-result-count').textContent = r.rowCount.toLocaleString();
    $('fs-result-meta').innerHTML =
        '<span class="fs-chip muted"><i class="fa-solid fa-table-columns"></i> ' + cols.length + ' cols</span>' +
        '<span class="fs-chip muted"><i class="fa-regular fa-clock"></i> ' + fmtMs(r.elapsedMs) + '</span>' +
        (r.capped ? '<span class="fs-chip warn" title="More rows may exist. Raise the row limit to see them."><i class="fa-solid fa-scissors"></i> capped at ' + limit.toLocaleString() + '</span>' : '');
    renderGrid();
    prepareChart();
}

function gridSearch(q) {
    var R = FS.result; if (!R) return;
    R.search = q.trim().toLowerCase();
    R.filtered = !R.search ? R.rows : R.rows.filter(function (row) {
        for (var i = 0; i < R.columns.length; i++) {
            var v = row[R.columns[i]];
            if (v !== undefined && String(v).toLowerCase().indexOf(R.search) >= 0) return true;
        }
        return false;
    });
    applySort();
    R.page = 0;
    renderGrid();
}

function sortBy(col) {
    var R = FS.result; if (!R) return;
    if (R.sortCol === col) R.sortDir = -R.sortDir; else { R.sortCol = col; R.sortDir = 1; }
    applySort(); renderGrid();
}
function applySort() {
    var R = FS.result; if (!R || !R.sortCol) return;
    var c = R.sortCol, d = R.sortDir, num = R.isNum[c];
    R.filtered = R.filtered.slice().sort(function (a, b) {
        var x = a[c], y = b[c];
        if (x === undefined || x === '') return 1; if (y === undefined || y === '') return -1;
        if (num) return (x - y) * d;
        return String(x).localeCompare(String(y), undefined, { numeric: true }) * d;
    });
}

function fmtCell(R, c, v) {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'number' && !R.isId[c]) return v.toLocaleString(undefined, { maximumFractionDigits: 10 });
    return String(v);
}
function hl(text, q) {
    var t = esc(text);
    if (!q) return t;
    var i = String(text).toLowerCase().indexOf(q);
    if (i < 0) return t;
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}

function renderGrid() {
    var R = FS.result, grid = $('fs-grid');
    if (!R) return;
    if (!R.columns.length || !R.rows.length) {
        grid.innerHTML = '<div class="fs-empty"><i class="fa-regular fa-folder-open"></i><h3>No rows</h3><p>The query ran successfully and returned nothing.</p>' +
            (R.decoded ? '<details style="max-width:820px;width:100%;text-align:left;"><summary class="fs-muted" style="cursor:pointer;">Runner output (check this if you expected rows)</summary><div class="fs-error-box" style="color:#57504b;background:#faf8f7;border-color:#e7e2de;">' + esc(R.decoded) + '</div></details>' : '') + '</div>';
        $('fs-pager').innerHTML = '';
        return;
    }
    var start = R.page * PAGE_SIZE, rows = R.filtered.slice(start, start + PAGE_SIZE);
    var h = ['<table><thead><tr><th class="rn">#</th>'];
    R.columns.forEach(function (c) {
        var s = R.sortCol === c ? '<i class="fa-solid fa-caret-' + (R.sortDir > 0 ? 'up' : 'down') + ' sort"></i>' : '';
        h.push('<th onclick="sortBy(\'' + esc(c) + '\')" title="' + (R.isNum[c] ? 'Number' : R.isId[c] ? 'Identifier' : 'Text') + ' — click to sort">' + esc(c) + s + '</th>');
    });
    h.push('</tr></thead><tbody>');
    rows.forEach(function (row, i) {
        h.push('<tr><td class="rn">' + (start + i + 1) + '</td>');
        R.columns.forEach(function (c) {
            var f = fmtCell(R, c, row[c]);
            if (f === null) h.push('<td class="null">∅</td>');
            else h.push('<td class="' + (R.isNum[c] && !R.isId[c] ? 'num' : '') + '" data-r="' + (start + i) + '" data-c="' + esc(c) + '">' + hl(f, R.search) + '</td>');
        });
        h.push('</tr>');
    });
    h.push('</tbody></table>');
    grid.innerHTML = h.join('');

    var pages = Math.max(1, Math.ceil(R.filtered.length / PAGE_SIZE));
    $('fs-pager').innerHTML =
        '<span>' + (R.search ? R.filtered.length.toLocaleString() + ' of ' + R.rows.length.toLocaleString() + ' rows match' : R.rows.length.toLocaleString() + ' rows') + '</span>' +
        '<button ' + (R.page === 0 ? 'disabled' : '') + ' onclick="gotoPage(0)"><i class="fa-solid fa-angles-left"></i></button>' +
        '<button ' + (R.page === 0 ? 'disabled' : '') + ' onclick="gotoPage(' + (R.page - 1) + ')"><i class="fa-solid fa-angle-left"></i></button>' +
        '<span>Page ' + (R.page + 1) + ' / ' + pages + '</span>' +
        '<button ' + (R.page >= pages - 1 ? 'disabled' : '') + ' onclick="gotoPage(' + (R.page + 1) + ')"><i class="fa-solid fa-angle-right"></i></button>' +
        '<button ' + (R.page >= pages - 1 ? 'disabled' : '') + ' onclick="gotoPage(' + (pages - 1) + ')"><i class="fa-solid fa-angles-right"></i></button>';
}
function gotoPage(p) { FS.result.page = p; renderGrid(); $('fs-grid').scrollTop = 0; }

// Double-click a cell to see its full value
document.addEventListener('dblclick', function (e) {
    var td = e.target.closest && e.target.closest('#fs-grid td[data-c]');
    if (!td) return;
    var v = FS.result.filtered[+td.dataset.r][td.dataset.c];
    openModal(td.dataset.c, '<div class="fs-cell-view">' + esc(v) + '</div>', [
        { label: '<i class="fa-solid fa-copy"></i> Copy', cls: '', onClick: function () { copyText(String(v)); } },
        { label: 'Close', cls: 'primary', onClick: closeModal }
    ]);
});

// ── Exports ────────────────────────────────────────────────────
function exportRows() { return FS.result ? FS.result.filtered : []; }
function exportName() {
    var base = FS.currentQuery ? FS.currentQuery.name : 'FusionSQL';
    return base.replace(/[^\w-]+/g, '_').slice(0, 60) + '_' + nowStamp();
}

function exportExcel() {
    var R = FS.result;
    if (!R || !R.rows.length) { toast('No results to export', 'warn'); return; }
    if (typeof ExcelJS === 'undefined') { exportCsv(); return; }
    var wb = new ExcelJS.Workbook();
    wb.creator = "Gray's WMS — Fusion SQL";
    var ws = wb.addWorksheet('Results', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = R.columns.map(function (c) {
        var max = c.length;
        exportRows().slice(0, 500).forEach(function (r) { var v = r[c]; if (v != null && String(v).length > max) max = String(v).length; });
        return { header: c, key: c, width: Math.max(12, Math.min(45, max + 2)) };
    });
    exportRows().forEach(function (r) {
        var o = {};
        R.columns.forEach(function (c) { var v = r[c]; o[c] = v === undefined ? null : (R.isId[c] && v !== '' ? String(v) : v); });
        ws.addRow(o);
    });
    var hdr = ws.getRow(1);
    hdr.eachCell(function (cell) {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC74634' } };
    });
    R.columns.forEach(function (c, i) { if (R.isNum[c] && !R.isId[c]) ws.getColumn(i + 1).numFmt = '#,##0.##########'; });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: R.columns.length } };
    var sh = wb.addWorksheet('SQL');
    sh.getCell('A1').value = R.sql;
    sh.getCell('A1').alignment = { wrapText: true, vertical: 'top' };
    sh.getColumn(1).width = 120;
    wb.xlsx.writeBuffer().then(function (buf) {
        downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), exportName() + '.xlsx');
        toast('Excel exported (' + exportRows().length.toLocaleString() + ' rows)');
    });
}
function exportCsv() {
    var R = FS.result;
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [R.columns.map(q).join(',')].concat(exportRows().map(function (r) { return R.columns.map(function (c) { return q(r[c]); }).join(','); }));
    downloadBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), exportName() + '.csv');
}
function exportPdf() {
    var R = FS.result;
    if (!R || !R.rows.length) { toast('No results to export', 'warn'); return; }
    if (!window.jspdf) { toast('PDF library not loaded (offline?)', 'err'); return; }
    var doc = new window.jspdf.jsPDF({ orientation: R.columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    doc.setFontSize(13); doc.setTextColor(49, 45, 42);
    doc.text(FS.currentQuery ? FS.currentQuery.name : 'Fusion SQL results', 40, 36);
    doc.setFontSize(8); doc.setTextColor(138, 129, 123);
    doc.text((FS.status ? FS.status.pod + ' · ' : '') + exportRows().length + ' rows · ' + new Date().toLocaleString(), 40, 50);
    doc.autoTable({
        startY: 60,
        head: [R.columns],
        body: exportRows().map(function (r) { return R.columns.map(function (c) { var f = fmtCell(R, c, r[c]); return f === null ? '' : f; }); }),
        styles: { fontSize: R.columns.length > 12 ? 5.5 : 7, cellPadding: 3, overflow: 'linebreak' },
        headStyles: { fillColor: [199, 70, 52], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [250, 248, 247] },
        margin: { left: 30, right: 30 }
    });
    doc.save(exportName() + '.pdf');
}
function copyGrid() {
    var R = FS.result; if (!R || !R.rows.length) { toast('No results to copy', 'warn'); return; }
    var lines = [R.columns.join('\t')].concat(exportRows().map(function (r) {
        return R.columns.map(function (c) { var v = r[c]; return v == null ? '' : String(v).replace(/[\t\n\r]+/g, ' '); }).join('\t');
    }));
    copyText(lines.join('\n'));
}

// ── Chart ──────────────────────────────────────────────────────
function prepareChart() {
    var R = FS.result; if (!R) return;
    var xs = $('fs-chart-x'), ys = $('fs-chart-y');
    var numCols = R.columns.filter(function (c) { return R.isNum[c] && !R.isId[c]; });
    var labelCols = R.columns.filter(function (c) { return !R.isNum[c] || R.isId[c]; });
    xs.innerHTML = (labelCols.length ? labelCols : R.columns).map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    ys.innerHTML = '<option value="__count">(count of rows)</option>' + numCols.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
    if (numCols.length) ys.value = numCols[0];
    if ($('sub-chart').classList.contains('active')) drawChart();
}
function drawChart() {
    var R = FS.result;
    if (!R || !R.rows.length || !window.Chart) { $('fs-chart-note').textContent = !window.Chart ? 'Chart library not loaded.' : 'Run a query first.'; return; }
    var x = $('fs-chart-x').value, y = $('fs-chart-y').value, type = $('fs-chart-type').value;
    var agg = {}, order = [];
    R.filtered.forEach(function (r) {
        var k = r[x] === undefined || r[x] === '' ? '(null)' : String(r[x]);
        if (!(k in agg)) { agg[k] = 0; order.push(k); }
        agg[k] += y === '__count' ? 1 : (typeof r[y] === 'number' ? r[y] : 0);
    });
    var top = order.sort(function (a, b) { return agg[b] - agg[a]; }).slice(0, 40);
    $('fs-chart-note').textContent = order.length > 40 ? 'Top 40 of ' + order.length + ' groups' : order.length + ' groups';
    var palette = ['#c74634', '#7c3aed', '#0f766e', '#d97706', '#2563eb', '#db2777', '#65a30d', '#0891b2', '#9333ea', '#ea580c'];
    if (FS.chart) FS.chart.destroy();
    FS.chart = new Chart($('fs-chart'), {
        type: type,
        data: {
            labels: top,
            datasets: [{
                label: y === '__count' ? 'Rows' : y,
                data: top.map(function (k) { return agg[k]; }),
                backgroundColor: type === 'doughnut' ? top.map(function (_, i) { return palette[i % palette.length]; }) : 'rgba(199,70,52,.75)',
                borderColor: type === 'line' ? '#c74634' : undefined,
                borderRadius: type === 'bar' ? 5 : undefined,
                tension: .3, fill: false
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: type === 'doughnut', position: 'right' } },
            scales: type === 'doughnut' ? {} : { y: { beginAtZero: true, grid: { color: '#f1edea' } }, x: { grid: { display: false } } }
        }
    });
}

// ── Logs & history ─────────────────────────────────────────────
function addLog(ok, msg, sql) {
    FS.logs.unshift({ t: timeStr(), ok: ok, msg: msg, sql: sql });
    if (FS.logs.length > 200) FS.logs.pop();
    $('fs-log-count').textContent = FS.logs.length;
    $('fs-logs').innerHTML = FS.logs.map(function (l, i) {
        return '<div class="fs-log ' + (l.ok ? 'ok' : 'err') + '"><span class="t">' + l.t + '</span><span class="m">' + esc(l.msg) + '</span>' +
            '<span class="s" title="Load into editor" onclick="setSql(FS.logs[' + i + '].sql)">— ' + esc(l.sql.replace(/\s+/g, ' ').slice(0, 220)) + '</span></div>';
    }).join('');
}
function addHistory(sql) {
    var h = lsGet('fusionSql.history', []), key = sql.trim();
    h = h.filter(function (x) { return x.sql.trim() !== key; });
    h.unshift({ sql: key, at: new Date().toISOString() });
    lsSet('fusionSql.history', h.slice(0, 30));
}
function toggleHistory(e) {
    e.stopPropagation();
    var m = $('fs-history-menu');
    if (m.classList.contains('open')) { m.classList.remove('open'); return; }
    var h = lsGet('fusionSql.history', []);
    m.innerHTML = h.length ? h.map(function (x, i) {
        return '<div class="fs-menu-item" onclick="pickHistory(' + i + ')">' + esc(x.sql.replace(/\s+/g, ' ').slice(0, 160)) +
            '<small>' + new Date(x.at).toLocaleString() + '</small></div>';
    }).join('') : '<div class="fs-muted" style="padding:10px;">No history yet — run a query.</div>';
    m.classList.add('open');
}
function pickHistory(i) { var h = lsGet('fusionSql.history', []); if (h[i]) setSql(h[i].sql); $('fs-history-menu').classList.remove('open'); }
document.addEventListener('click', function (e) { if (!e.target.closest('.fs-dropdown')) $('fs-history-menu').classList.remove('open'); });

// ── SQL formatter (light-touch, literal/comment safe) ─────────
var FMT_BREAK = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'UNION ALL', 'UNION', 'MINUS', 'INTERSECT',
    'LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 'FULL OUTER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'CROSS JOIN', 'JOIN', 'CONNECT BY', 'START WITH', 'FETCH FIRST'];
var FMT_KW = /\b(select|from|where|and|or|not|in|is|null|as|on|join|left|right|full|outer|inner|cross|group|by|order|having|union|all|minus|intersect|distinct|case|when|then|else|end|between|like|exists|with|asc|desc|nulls|first|last|over|partition|connect|start|prior|nvl|decode|to_char|to_date|trunc|sysdate|count|sum|min|max|avg|listagg|within|rownum|fetch|rows|only)\b/gi;
var FMT_BREAK_RE = new RegExp('\\s*\\b(' + FMT_BREAK.map(function (k) { return k.replace(/ /g, '\\s+'); }).join('|') + ')\\b', 'gi');
function formatSql(sql) {
    return splitSql(sql).map(function (seg) {
        if (!seg.code) return seg.text;
        var t = seg.text.replace(/[ \t]+/g, ' ').replace(FMT_KW, function (k) { return k.toUpperCase(); });
        t = t.replace(FMT_BREAK_RE, function (_, kw) { return '\n' + kw.replace(/\s+/g, ' '); });
        t = t.replace(/\s*\b(AND|OR)\b\s+/g, '\n    $1 ');
        t = t.replace(/,\s*(?![^(]*\))/g, ',\n       ');
        return t;
    }).join('').replace(/^\s*\n/, '').replace(/\n{3,}/g, '\n\n');
}
function formatEditor() { setSql(formatSql(getSql())); toast('Formatted'); }

// ── Saved queries ──────────────────────────────────────────────
function loadQueries() {
    return cacheGet('list', '__queries').then(function (list) {
        FS.queries = Array.isArray(list) ? list : [];
        updateQueryBadge();
        return FS.queries;
    }).catch(function () { FS.queries = []; });
}
function updateQueryBadge() {
    var b = $('fs-queries-count');
    b.textContent = FS.queries.length;
    b.classList.toggle('muted', !FS.queries.length);
}
function persistQueries() {
    updateQueryBadge();
    return cacheSet('list', FS.queries, '__queries');
}
function openSaveDialog() {
    var q = FS.currentQuery || {};
    openModal('Save query',
        '<div class="fs-form">' +
        '<label>Name <small>saving with an existing name updates it</small></label><input id="sq-name" value="' + esc(q.name || '') + '" placeholder="e.g. Open AP invoices by supplier">' +
        '<label>Tag</label><input id="sq-tag" value="' + esc(q.tag || '') + '" placeholder="AP, INV, GL…">' +
        '<label>Description</label><input id="sq-desc" value="' + esc(q.description || '') + '">' +
        '</div>',
        [{ label: 'Cancel', cls: 'ghost', onClick: closeModal },
        {
            label: '<i class="fa-solid fa-floppy-disk"></i> Save', cls: 'primary', onClick: function () {
                var name = $('sq-name').value.trim();
                if (!name) { toast('Give the query a name', 'warn'); return; }
                var existing = FS.queries.filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
                var rec = existing || { name: name, created: new Date().toISOString(), runs: 0 };
                rec.name = name; rec.sql = getSql(); rec.tag = $('sq-tag').value.trim(); rec.description = $('sq-desc').value.trim(); rec.updated = new Date().toISOString();
                if (!existing) FS.queries.unshift(rec);
                persistQueries().then(function () { toast(existing ? 'Query updated' : 'Query saved'); });
                setCurrentQuery(rec);
                closeModal();
            }
        }]);
    setTimeout(function () { $('sq-name').focus(); }, 30);
}
function setCurrentQuery(q) {
    FS.currentQuery = q;
    $('fs-current-query').innerHTML = q ? '<i class="fa-solid fa-bookmark" style="color:var(--fs-red)"></i> <b>' + esc(q.name) + '</b>' : '';
}
function newQuery() { setCurrentQuery(null); setSql(''); }
function bumpRuns(name) {
    var q = FS.queries.filter(function (x) { return x.name === name; })[0];
    if (q) { q.runs = (q.runs || 0) + 1; q.lastRun = new Date().toISOString(); persistQueries(); }
}
function renderQueries() {
    var term = ($('fs-q-search').value || '').toLowerCase();
    var list = FS.queries.filter(function (q) { return !term || (q.name + ' ' + (q.tag || '') + ' ' + (q.description || '') + ' ' + q.sql).toLowerCase().indexOf(term) >= 0; });
    var grid = $('fs-query-grid');
    if (!FS.queries.length) {
        grid.innerHTML = '<div class="fs-empty" style="grid-column:1/-1;"><i class="fa-regular fa-bookmark"></i><h3>No saved queries yet</h3><p>Write a query in the SQL Builder and press <kbd>Ctrl</kbd>+<kbd>S</kbd>.</p></div>';
        return;
    }
    grid.innerHTML = list.map(function (q) {
        var i = FS.queries.indexOf(q);
        return '<div class="fs-q"><div class="fs-q-head"><div class="fs-q-name">' + esc(q.name) + '</div>' + (q.tag ? '<span class="fs-q-tag">' + esc(q.tag) + '</span>' : '') + '</div>' +
            (q.description ? '<div class="fs-q-desc">' + esc(q.description) + '</div>' : '') +
            '<pre>' + esc(q.sql) + '</pre>' +
            '<div class="fs-q-foot"><span class="fs-muted">' + (q.runs || 0) + ' runs · ' + new Date(q.updated || q.created).toLocaleDateString() + '</span>' +
            '<button class="fs-btn sm primary" onclick="queryRun(' + i + ')"><i class="fa-solid fa-play"></i> Run</button>' +
            '<button class="fs-btn sm" onclick="queryEdit(' + i + ')"><i class="fa-solid fa-pen"></i> Edit</button>' +
            '<button class="fs-icon-btn" title="Duplicate" onclick="queryDup(' + i + ')"><i class="fa-regular fa-clone"></i></button>' +
            '<button class="fs-icon-btn" title="Delete" onclick="queryDelete(' + i + ')"><i class="fa-regular fa-trash-can"></i></button></div></div>';
    }).join('') || '<div class="fs-muted">No queries match.</div>';
}
function queryEdit(i) { setCurrentQuery(FS.queries[i]); setSql(FS.queries[i].sql); showTab('builder'); }
function queryRun(i) { queryEdit(i); setTimeout(runEditor, 50); }
function queryDup(i) {
    var q = JSON.parse(JSON.stringify(FS.queries[i]));
    var base = q.name + ' (copy)', name = base, n = 2;
    while (FS.queries.some(function (x) { return x.name === name; })) name = base + ' ' + n++;
    q.name = name; q.runs = 0; q.created = q.updated = new Date().toISOString();
    FS.queries.splice(i + 1, 0, q); persistQueries(); renderQueries();
}
function queryDelete(i) {
    var q = FS.queries[i];
    confirmModal('Delete "' + q.name + '"?', 'This removes the saved query from this PC.', function () {
        FS.queries.splice(i, 1);
        if (FS.currentQuery === q) setCurrentQuery(null);
        persistQueries(); renderQueries(); toast('Deleted');
    });
}
function exportQueries() {
    downloadBlob(new Blob([JSON.stringify(FS.queries, null, 2)], { type: 'application/json' }), 'fusion-sql-queries_' + nowStamp() + '.json');
}
function importQueries(input) {
    var f = input.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
        try {
            var list = JSON.parse(rd.result);
            if (!Array.isArray(list)) throw 'not a list';
            var added = 0, updated = 0;
            list.forEach(function (q) {
                if (!q || !q.name || !q.sql) return;
                var ex = FS.queries.filter(function (x) { return x.name.toLowerCase() === String(q.name).toLowerCase(); })[0];
                if (ex) { Object.assign(ex, q); updated++; } else { FS.queries.push(q); added++; }
            });
            persistQueries(); renderQueries(); toast(added + ' added, ' + updated + ' updated');
        } catch (e) { toast('Not a Fusion SQL query export', 'err'); }
        input.value = '';
    };
    rd.readAsText(f);
}

// ── Schema browser ─────────────────────────────────────────────
function schemaInit() {
    cacheGet('owners').then(function (owners) {
        if (Array.isArray(owners) && owners.length > 1) return owners;
        $('fs-schema-meta').innerHTML = '<span class="fs-spinner" style="width:12px;height:12px;border-width:2px;"></span> Loading owners…';
        return fsql('SELECT username FROM all_users ORDER BY username', 5000).then(function (r) {
            var list = r.rows.map(function (x) { return x.USERNAME; }).filter(Boolean);
            if (!list.length) throw runnerProblem('all_users returned no owners', r);
            if (list.indexOf('PUBLIC') < 0) list.push('PUBLIC');
            list.sort();
            cacheSet('owners', list);
            return list;
        });
    }).then(function (owners) {
        var sel = $('fs-owner'), keep = lsGet('fusionSql.owner', 'FUSION');
        sel.innerHTML = owners.map(function (o) { return '<option' + (o === keep ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
        if (owners.indexOf(keep) < 0 && owners.indexOf('FUSION') >= 0) sel.value = 'FUSION';
        $('fs-owner-list').innerHTML = owners.map(function (o) { return '<option value="' + esc(o) + '">'; }).join('');
        $('fs-kind').value = lsGet('fusionSql.kind', 'TABLE');
        schemaLoadObjects();
    }).catch(function (e) {
        $('fs-schema-meta').innerHTML = '<span style="color:#b91c1c;"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(String(e).split('\n')[0]) + '</span> <a onclick="schemaInit()">retry</a>';
        setConn('err', 'Not connected');
    });
}

function schemaKey() { return 'schema.' + FS.schema.owner + '.' + FS.schema.kind; }

function schemaLoadObjects(force) {
    FS.schema.owner = $('fs-owner').value;
    FS.schema.kind = $('fs-kind').value;
    lsSet('fusionSql.owner', FS.schema.owner); lsSet('fusionSql.kind', FS.schema.kind);
    var key = schemaKey(), owner = FS.schema.owner, kind = FS.schema.kind;
    $('fs-schema-list').innerHTML = '';
    (force ? Promise.resolve(null) : cacheGet(key)).then(function (cached) {
        if (cached && cached.names && cached.names.length) return cached;
        return fetchObjectNames(owner, kind, function (n) {
            $('fs-schema-meta').innerHTML = '<span class="fs-spinner" style="width:12px;height:12px;border-width:2px;"></span> Loading ' + esc(kind.toLowerCase()) + 's… ' + n.toLocaleString();
        }).then(function (res) {
            var val = { at: new Date().toISOString(), names: res.names, capped: res.capped };
            if (res.names.length) cacheSet(key, val);   // an empty list is re-queried next time
            return val;
        });
    }).then(function (val) {
        if (owner !== FS.schema.owner || kind !== FS.schema.kind) return;   // user switched meanwhile
        FS.schema.names = val.names; FS.schema.capped = val.capped; FS.schema.at = val.names.length ? val.at : null;
        registerHintNames(owner, kind, val.names);
        schemaFilter();
    }).catch(function (e) {
        $('fs-schema-meta').innerHTML = '<span style="color:#b91c1c;"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(String(e).split('\n')[0]) + '</span>';
    });
}

function runnerProblem(what, r) {
    return 'Runner output not understood (' + what + '). Redeploy the runner in Connection. ' + (r && r.decoded ? 'Output: ' + r.decoded.slice(0, 300) : '');
}

/** Pages through ALL_OBJECTS 5,000 names at a time (one after another) up to the safety ceiling. */
function fetchObjectNames(owner, kind, onProgress) {
    var names = [];
    function page(from) {
        var sql = 'SELECT object_name FROM (SELECT object_name, ROW_NUMBER() OVER (ORDER BY object_name) rn FROM all_objects WHERE owner = ' + lit(owner) +
            ' AND object_type = ' + lit(kind) + ') WHERE rn BETWEEN ' + from + ' AND ' + (from + SCHEMA_PAGE - 1);
        return fsql(sql, SCHEMA_PAGE).then(function (r) {
            if (r.rows.length && r.rows[0].OBJECT_NAME === undefined) throw runnerProblem('object list came back without OBJECT_NAME', r);
            r.rows.forEach(function (x) { if (x.OBJECT_NAME !== undefined) names.push(String(x.OBJECT_NAME)); });
            if (onProgress) onProgress(names.length);
            if (r.rows.length < SCHEMA_PAGE) return { names: names, capped: false };
            if (names.length >= SCHEMA_CEILING) return { names: names, capped: true };
            return page(from + SCHEMA_PAGE);
        });
    }
    return page(1);
}

function schemaRefresh() { schemaLoadObjects(true); }
function toggleSchema() { $('fs-builder').classList.toggle('schema-hidden'); setTimeout(function () { if (FS.editor) FS.editor.refresh(); }, 220); }

function schemaFilter() {
    var term = ($('fs-schema-filter').value || '').trim().toUpperCase();
    FS.schema.filtered = !term ? FS.schema.names : FS.schema.names.filter(function (n) { return n.indexOf(term) >= 0; });
    FS.schema.shown = LIST_CHUNK;
    var meta = FS.schema.filtered.length.toLocaleString() + ' of ' + FS.schema.names.length.toLocaleString() + ' ' + FS.schema.kind.toLowerCase() + 's' +
        (FS.schema.capped ? ' (capped)' : '') + (FS.schema.at ? ' · cached ' + new Date(FS.schema.at).toLocaleDateString() : '');
    if (term) meta += ' · <a onclick="schemaServerSearch()">search server</a>';
    $('fs-schema-meta').innerHTML = meta;
    renderSchemaList();
}

function renderSchemaList() {
    var list = FS.schema.filtered.slice(0, FS.schema.shown), kind = FS.schema.kind;
    var icon = KIND_ICONS[kind] || 'fa-cube', expandable = DETAIL_KINDS[kind] || ARG_KINDS[kind];
    var h = list.map(function (n) {
        return '<div class="fs-obj" data-name="' + esc(n) + '"><div class="fs-obj-row" onclick="' + (expandable ? 'toggleObj(this.parentNode)' : 'insertName(this.parentNode.dataset.name)') + '" ondblclick="insertName(this.parentNode.dataset.name)" title="Double-click to insert">' +
            '<i class="fa-solid fa-chevron-right caret"' + (expandable ? '' : ' style="visibility:hidden"') + '></i><i class="fa-solid ' + icon + ' ico"></i><span class="name">' + esc(n) + '</span>' +
            (DETAIL_KINDS[kind] ? '<span class="act" title="SELECT * FROM …" onclick="event.stopPropagation();selectStar(this.closest(\'.fs-obj\').dataset.name)">SELECT</span>' : '') +
            '</div><div class="fs-obj-detail"></div></div>';
    });
    if (FS.schema.filtered.length > FS.schema.shown)
        h.push('<button class="fs-btn sm fs-more" onclick="FS.schema.shown+=' + LIST_CHUNK + ';renderSchemaList()">Show ' + LIST_CHUNK + ' more (' + (FS.schema.filtered.length - FS.schema.shown).toLocaleString() + ' left)</button>');
    if (!list.length) h.push('<div class="fs-loading-line">Nothing here.' + ($('fs-schema-filter').value ? ' <a style="color:var(--fs-red);cursor:pointer;text-decoration:underline" onclick="schemaServerSearch()">Search the server</a>' : '') + '</div>');
    $('fs-schema-list').innerHTML = h.join('');
}

function schemaServerSearch() {
    var term = ($('fs-schema-filter').value || '').trim().toUpperCase();
    if (!term) return;
    $('fs-schema-meta').innerHTML = '<span class="fs-spinner" style="width:12px;height:12px;border-width:2px;"></span> Searching server…';
    var sql = 'SELECT object_name FROM all_objects WHERE owner = ' + lit(FS.schema.owner) + ' AND object_type = ' + lit(FS.schema.kind) +
        " AND UPPER(object_name) LIKE " + lit('%' + term.replace(/[%_\\]/g, '\\$&') + '%') + " ESCAPE '\\' ORDER BY object_name";
    fsql(sql, 2000).then(function (r) {
        var found = r.rows.map(function (x) { return String(x.OBJECT_NAME); });
        var set = {}; FS.schema.names.forEach(function (n) { set[n] = 1; });
        var added = found.filter(function (n) { return !set[n]; });
        FS.schema.filtered = found; FS.schema.shown = LIST_CHUNK;
        $('fs-schema-meta').innerHTML = found.length + ' server match' + (found.length === 1 ? '' : 'es') + (added.length ? ' · ' + added.length + ' new' : '');
        renderSchemaList();
    }).catch(function (e) { $('fs-schema-meta').textContent = String(e).split('\n')[0]; });
}

function qualified(name) { return FS.schema.owner === 'FUSION' || FS.schema.owner === 'PUBLIC' ? name : FS.schema.owner + '.' + name; }
function insertName(name) { insertAtCursor(qualified(name)); }
function selectStar(name) {
    setCurrentQuery(null);
    setSql('SELECT *\nFROM ' + qualified(name));
    runEditor();
}

function toggleObj(el) {
    el.classList.toggle('open');
    if (!el.classList.contains('open')) return;
    var detail = el.querySelector('.fs-obj-detail');
    if (detail.dataset.loaded) return;
    detail.dataset.loaded = '1';
    var kind = FS.schema.kind;
    var tabs = kind === 'TABLE' ? ['cols', 'idx', 'fk'] : ARG_KINDS[kind] ? ['args'] : ['cols'];
    var labels = { cols: 'Columns', idx: 'Indexes', fk: 'Foreign keys', args: 'Arguments' };
    detail.innerHTML = (tabs.length > 1 ? '<div class="fs-detail-tabs">' + tabs.map(function (t, i) {
        return '<button class="' + (i === 0 ? 'on' : '') + '" onclick="event.stopPropagation();objTab(this,\'' + t + '\')">' + labels[t] + '</button>';
    }).join('') + '</div>' : '') + '<div class="fs-detail-body"></div>';
    loadObjDetail(el, tabs[0]);
}
function objTab(btn, t) {
    btn.parentNode.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b === btn); });
    loadObjDetail(btn.closest('.fs-obj'), t);
}

function loadObjDetail(el, what) {
    var owner = FS.schema.owner, kind = FS.schema.kind, name = el.dataset.name;
    var body = el.querySelector('.fs-detail-body');
    body.innerHTML = '<div class="fs-loading-line"><span class="fs-spinner" style="width:12px;height:12px;border-width:2px;"></span> Loading…</div>';
    var p;
    if (what === 'cols') p = objectColumns(owner, kind, name);
    else if (what === 'args') p = cachedQuery('detail.' + owner + '.' + kind + '.' + name,
        "SELECT NVL(argument_name,'(return)') AS column_name, data_type, in_out FROM all_arguments WHERE owner = " + lit(owner) + ' AND object_name = ' + lit(name) + ' AND argument_name IS NOT NULL ORDER BY position', 1000);
    else if (what === 'idx') p = cachedQuery('idx.' + owner + '.' + name, indexSql(owner, name), 500);
    else p = cachedQuery('fk.' + owner + '.' + name, fkSql(owner, name), 500);

    p.then(function (rows) {
        if (!rows.length) { body.innerHTML = '<div class="fs-loading-line">None.</div>'; return; }
        if (what === 'cols' || what === 'args') {
            body.innerHTML = (rows.synonymOf ? '<div class="fs-loading-line"><i class="fa-solid fa-link"></i> ' + esc(rows.synonymOf) + '</div>' : '') +
                rows.map(function (c) {
                    var t = c.DATA_TYPE + (c.DATA_LENGTH && /CHAR/.test(c.DATA_TYPE) ? '(' + c.DATA_LENGTH + ')' : '') + (c.IN_OUT ? ' ' + c.IN_OUT : '');
                    return '<div class="fs-col" title="Click to insert" onclick="event.stopPropagation();insertAtCursor(\'' + esc(c.COLUMN_NAME) + '\')"><span class="cn">' + esc(c.COLUMN_NAME) + '</span>' +
                        (c.NULLABLE === 'N' ? '<span class="nn">NN</span>' : '') + '<span class="ct">' + esc(t || '') + '</span></div>';
                }).join('');
        } else if (what === 'idx') {
            body.innerHTML = rows.map(function (r) {
                return '<div class="fs-idx"><b>' + esc(r.INDEX_NAME) + '</b>' + (r.UNIQUENESS === 'UNIQUE' ? '<span class="u">UNIQUE</span>' : '') + '<br>' + esc(r.COLUMNS) + '</div>';
            }).join('');
        } else {
            body.innerHTML = rows.map(function (r) {
                return '<div class="fs-idx"><b>' + esc(r.FK_NAME) + '</b><br>' + esc(r.FK_COLUMNS) + ' → ' + esc(r.REF_TABLE) + '</div>';
            }).join('');
        }
    }).catch(function (e) { body.innerHTML = '<div class="fs-loading-line" style="color:#b91c1c;">' + esc(String(e).split('\n')[0]) + '</div>'; });
}

function cachedQuery(key, sql, limit) {
    return cacheGet(key).then(function (v) {
        if (Array.isArray(v)) return v;
        return fsql(sql, limit).then(function (r) { cacheSet(key, r.rows); return r.rows; });
    });
}
function columnsSql(owner, table) {
    return 'SELECT column_name, data_type, data_length, nullable FROM all_tab_columns WHERE owner = ' + lit(owner) + ' AND table_name = ' + lit(table) + ' ORDER BY column_id';
}
function objectColumns(owner, kind, name) {
    var key = 'detail.' + owner + '.' + kind + '.' + name;
    if (kind !== 'SYNONYM') return cachedQuery(key, columnsSql(owner, name), 1000).then(function (rows) { registerHintColumns(owner, name, rows); return rows; });
    // Synonym: resolve the target, then read its columns
    return cacheGet(key).then(function (v) {
        if (v && v.rows) { var r = v.rows; r.synonymOf = v.target; return r; }
        return fsql('SELECT table_owner, table_name FROM all_synonyms WHERE owner = ' + lit(owner) + ' AND synonym_name = ' + lit(name), 1).then(function (s) {
            if (!s.rows.length) return [];
            var t = s.rows[0];
            return fsql(columnsSql(t.TABLE_OWNER, t.TABLE_NAME), 1000).then(function (c) {
                var target = t.TABLE_OWNER + '.' + t.TABLE_NAME;
                cacheSet(key, { target: target, rows: c.rows });
                var rows = c.rows; rows.synonymOf = target; return rows;
            });
        });
    });
}
function indexSql(owner, table, from, to) {
    var inner = 'SELECT i.table_name, i.index_name, i.uniqueness, LISTAGG(c.column_name, \', \') WITHIN GROUP (ORDER BY c.column_position) AS columns' +
        (from ? ', ROW_NUMBER() OVER (ORDER BY i.table_name, i.index_name) rn' : '') +
        ' FROM all_indexes i JOIN all_ind_columns c ON c.index_owner = i.owner AND c.index_name = i.index_name' +
        ' WHERE i.owner = ' + lit(owner) + (table ? ' AND i.table_name = ' + lit(table) : '') +
        ' GROUP BY i.table_name, i.index_name, i.uniqueness';
    return from ? 'SELECT table_name, index_name, uniqueness, columns FROM (' + inner + ') WHERE rn BETWEEN ' + from + ' AND ' + to : inner + ' ORDER BY i.index_name';
}
function fkSql(owner, table, from, to) {
    var inner = 'SELECT c.table_name, c.constraint_name AS fk_name, LISTAGG(cc.column_name, \', \') WITHIN GROUP (ORDER BY cc.position) AS fk_columns, r.owner || \'.\' || r.table_name AS ref_table' +
        (from ? ', ROW_NUMBER() OVER (ORDER BY c.table_name, c.constraint_name) rn' : '') +
        ' FROM all_constraints c JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name' +
        ' LEFT JOIN all_constraints r ON r.owner = c.r_owner AND r.constraint_name = c.r_constraint_name' +
        ' WHERE c.owner = ' + lit(owner) + ' AND c.constraint_type = \'R\'' + (table ? ' AND c.table_name = ' + lit(table) : '') +
        ' GROUP BY c.table_name, c.constraint_name, r.owner, r.table_name';
    return from ? 'SELECT table_name, fk_name, fk_columns, ref_table FROM (' + inner + ') WHERE rn BETWEEN ' + from + ' AND ' + to : inner + ' ORDER BY c.constraint_name';
}

// Autocomplete registry for CodeMirror's sql-hint
function registerHintNames(owner, kind, names) {
    if (!DETAIL_KINDS[kind]) return;
    names.forEach(function (n) {
        var k = owner === 'FUSION' || owner === 'PUBLIC' ? n : owner + '.' + n;
        if (!FS.hintTables[k]) FS.hintTables[k] = [];
    });
}
function registerHintColumns(owner, name, rows) {
    var k = owner === 'FUSION' || owner === 'PUBLIC' ? name : owner + '.' + name;
    FS.hintTables[k] = rows.map(function (r) { return r.COLUMN_NAME; });
}

// ── Tables List (SQLite) ───────────────────────────────────────
function pullLog(cls, text) {
    var d = document.createElement('div'); d.className = cls; d.textContent = text;
    $('fs-pull-log').appendChild(d); $('fs-pull-log').scrollTop = 1e9;
}
function pullPaged(builder, label, pct0, pct1) {
    var rows = [];
    function page(from) {
        return fsql(builder(from, from + SCHEMA_PAGE - 1), SCHEMA_PAGE).then(function (r) {
            rows = rows.concat(r.rows);
            pullLog('info', '  ' + label + ': ' + rows.length.toLocaleString());
            $('fs-pull-bar').style.width = Math.min(pct1, pct0 + (pct1 - pct0) * (1 - 1 / (1 + rows.length / 20000))) + '%';
            if (r.rows.length < SCHEMA_PAGE || rows.length >= SCHEMA_CEILING) return rows;
            return page(from + SCHEMA_PAGE);
        });
    }
    return page(1);
}
function pullSchema() {
    var owner = $('fs-pull-owner').value.trim().toUpperCase();
    if (!owner) { toast('Enter an owner', 'warn'); return; }
    var btn = $('fs-pull-btn'); btn.disabled = true;
    $('fs-pull-log').innerHTML = '';
    $('fs-pull-progress').classList.add('on'); $('fs-pull-bar').style.width = '2%';
    var t0 = Date.now(), tables, indexes;
    pullLog('info', '▶ Pulling ' + owner + ' from ' + (FS.status ? FS.status.pod : 'Fusion') + '…');
    pullPaged(function (a, b) {
        return 'SELECT object_name AS table_name FROM (SELECT object_name, ROW_NUMBER() OVER (ORDER BY object_name) rn FROM all_objects WHERE owner = ' + lit(owner) + " AND object_type = 'TABLE') WHERE rn BETWEEN " + a + ' AND ' + b;
    }, 'tables', 2, 35).then(function (t) {
        tables = t.map(function (r) { return String(r.TABLE_NAME); });
        pullLog('ok', '✓ ' + tables.length.toLocaleString() + ' tables');
        cacheSet('schema.' + owner + '.TABLE', { at: new Date().toISOString(), names: tables, capped: tables.length >= SCHEMA_CEILING });
        return pullPaged(function (a, b) { return indexSql(owner, null, a, b); }, 'indexes', 35, 70);
    }).then(function (ix) {
        indexes = ix; pullLog('ok', '✓ ' + ix.length.toLocaleString() + ' indexes');
        return pullPaged(function (a, b) { return fkSql(owner, null, a, b); }, 'foreign keys', 70, 95);
    }).then(function (fks) {
        pullLog('ok', '✓ ' + fks.length.toLocaleString() + ' foreign keys');
        return fsCall('fusionDbSave', { owner: owner, tables: tables, indexes: indexes, fks: fks });
    }).then(function (r) {
        if (!r || !r.ok) throw (r && r.error) || 'Save failed';
        $('fs-pull-bar').style.width = '100%';
        pullLog('ok', '✓ Saved to ' + r.path + ' in ' + fmtMs(Date.now() - t0));
        toast(owner + ' saved to the local schema DB');
        dbInfo();
    }).catch(function (e) {
        pullLog('err', '✗ ' + e);
        toast('Pull failed', 'err');
    }).then(function () {
        btn.disabled = false;
        setTimeout(function () { $('fs-pull-progress').classList.remove('on'); }, 1500);
    });
}
function dbInfo() {
    fsCall('fusionDbInfo', {}).then(function (i) {
        var el = $('fs-db-info');
        if (!i || !i.exists) {
            el.innerHTML = '<div class="fs-empty" style="min-height:120px;"><i class="fa-solid fa-hard-drive"></i><p>No local schema DB yet.<br>Pull an owner, or import a .db from a colleague.</p></div>';
            return;
        }
        el.innerHTML = '<div class="fs-kv"><span class="k">File</span><span class="v">' + esc(i.path) + '</span>' +
            '<span class="k">Size</span><span class="v">' + fmtBytes(i.sizeBytes) + ' · ' + esc(i.modified) + '</span>' +
            i.tables.map(function (t) { return '<span class="k">' + esc(t.name) + '</span><span class="v">' + t.rows.toLocaleString() + ' rows</span>'; }).join('') +
            '</div><div class="fs-owner-chips">' + i.owners.map(function (o) { return '<span>' + esc(o.owner) + ' · ' + o.tables.toLocaleString() + '</span>'; }).join('') + '</div>';
    }).catch(function (e) { $('fs-db-info').innerHTML = '<div class="fs-muted">' + esc(String(e)) + '</div>'; });
}
function dbExport() {
    fsCall('fusionDbExport', {}).then(function (r) { if (r.ok) toast('Exported to ' + r.path); else if (!r.cancelled) toast(r.error || 'Export failed', 'err'); });
}
function dbImport() {
    fsCall('fusionDbImport', {}).then(function (r) {
        if (r.ok && r.exists) { toast('Schema DB imported'); dbInfo(); }
        else if (!r.cancelled) toast(r.error || 'Import failed', 'err');
    });
}
function dbQuery(sql) {
    sql = sql || $('fs-db-sql').value;
    $('fs-db-meta').textContent = 'Running…';
    fsCall('fusionDbQuery', { sql: sql, rowLimit: 2000 }).then(function (r) {
        if (!r.ok) { $('fs-db-meta').textContent = ''; $('fs-db-grid').innerHTML = '<div class="fs-error-box" style="margin:10px;">' + esc(r.error) + '</div>'; return; }
        $('fs-db-meta').textContent = r.rowCount.toLocaleString() + ' rows';
        renderSimpleGrid($('fs-db-grid'), r.columns, r.rows, function (row) {
            if (row.table_name) showLocalTable(row.owner, row.table_name);
        });
    });
}
function dbFind() {
    var t = $('fs-db-find').value.trim().toUpperCase().replace(/'/g, "''");
    if (!t) return;
    var sql = 'SELECT t.owner, t.table_name,\n  (SELECT COUNT(*) FROM fusion_indexes i WHERE i.owner = t.owner AND i.table_name = t.table_name) AS indexes,\n' +
        '  (SELECT COUNT(*) FROM fusion_foreign_keys f WHERE f.owner = t.owner AND f.table_name = t.table_name) AS foreign_keys\n' +
        "FROM fusion_tables t\nWHERE t.table_name LIKE '%" + t + "%'\nORDER BY t.table_name";
    $('fs-db-sql').value = sql;
    dbQuery(sql);
}
function showLocalTable(owner, table) {
    var o = String(owner).replace(/'/g, "''"), t = String(table).replace(/'/g, "''");
    Promise.all([
        fsCall('fusionDbQuery', { sql: "SELECT index_name, uniqueness, columns FROM fusion_indexes WHERE owner='" + o + "' AND table_name='" + t + "' ORDER BY index_name", rowLimit: 500 }),
        fsCall('fusionDbQuery', { sql: "SELECT fk_name, fk_columns, ref_table FROM fusion_foreign_keys WHERE owner='" + o + "' AND table_name='" + t + "' ORDER BY fk_name", rowLimit: 500 })
    ]).then(function (res) {
        var ix = res[0].rows || [], fk = res[1].rows || [];
        openModal(owner + '.' + table,
            '<h4 style="margin-bottom:6px;">Indexes (' + ix.length + ')</h4>' + (ix.map(function (r) { return '<div class="fs-idx"><b>' + esc(r.index_name) + '</b>' + (r.uniqueness === 'UNIQUE' ? '<span class="u">UNIQUE</span>' : '') + '<br>' + esc(r.columns) + '</div>'; }).join('') || '<div class="fs-muted">None</div>') +
            '<h4 style="margin:14px 0 6px;">Foreign keys (' + fk.length + ')</h4>' + (fk.map(function (r) { return '<div class="fs-idx"><b>' + esc(r.fk_name) + '</b><br>' + esc(r.fk_columns) + ' → ' + esc(r.ref_table) + '</div>'; }).join('') || '<div class="fs-muted">None</div>'),
            [{ label: '<i class="fa-solid fa-code"></i> Query it', cls: '', onClick: function () { closeModal(); setCurrentQuery(null); setSql('SELECT *\nFROM ' + (owner === 'FUSION' ? '' : owner + '.') + table); showTab('builder'); } },
            { label: 'Close', cls: 'primary', onClick: closeModal }]);
    });
}
function renderSimpleGrid(el, cols, rows, onDbl) {
    if (!rows.length) { el.innerHTML = '<div class="fs-empty" style="min-height:100px;"><p>No rows.</p></div>'; return; }
    var h = ['<table><thead><tr><th class="rn">#</th>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>'];
    rows.forEach(function (r, i) {
        h.push('<tr data-i="' + i + '"><td class="rn">' + (i + 1) + '</td>' + cols.map(function (c) {
            var v = r[c]; return '<td class="' + (typeof v === 'number' ? 'num' : '') + '">' + esc(v) + '</td>';
        }).join('') + '</tr>');
    });
    el.innerHTML = h.join('') + '</tbody></table>';
    if (onDbl) el.ondblclick = function (e) { var tr = e.target.closest('tr[data-i]'); if (tr) onDbl(rows[+tr.dataset.i]); };
}

// ── Connection tab ─────────────────────────────────────────────
function renderConnection() {
    var s = FS.status;
    if (!s) { loadStatus().then(function (x) { if (x) renderConnection(); }); return; }
    var c = s.config;
    ['baseUrl', 'folderPath', 'dataModelPath', 'reportPath', 'dataSource', 'rowLimit'].forEach(function (k) { $('cfg-' + k).value = c[k] == null ? '' : c[k]; });
    $('cfg-baseUrl').placeholder = s.origin + '  (auto: ' + s.instance + ')';
    $('cfg-timeoutSec').value = Math.round(c.timeoutMs / 1000);
    $('cfg-aiModel').value = c.aiModel || 'claude-opus-5';
    document.querySelectorAll('input[name="cred-src"]').forEach(function (r) { r.checked = r.value === s.credentials.source; });
    $('fs-app-user').textContent = s.credentials.appUsername ? '(' + s.credentials.appUsername + ')' : s.credentials.appLoaded ? '' : '(not loaded yet)';
    $('cred-user').value = s.credentials.customUsername || '';
    $('cred-pass-hint').textContent = s.credentials.customHasPassword ? '• password saved' : '';
    $('ai-key-hint').textContent = s.ai.hasKey ? '• key saved' : '• not set';
    credSourceChanged(true);
    $('fs-runner-sql').textContent = s.runnerSql;
    $('fs-man-ds').textContent = c.dataSource; $('fs-man-dm').textContent = c.dataModelPath; $('fs-man-rep').textContent = c.reportPath;

    var dotOk = $('fs-conn-dot').classList.contains('ok');
    $('fs-status-strip').innerHTML =
        stat('fa-cloud', 'Pod', s.origin, '') +
        stat('fa-layer-group', 'Instance', c.baseUrl ? 'Custom URL' : s.instance + ' (from login)', '') +
        stat('fa-user-shield', 'Runs as', s.credentials.source === 'custom' ? (s.credentials.customUsername || 'not set') : (s.credentials.appUsername || 'application account'), s.credentials.source === 'custom' && !s.credentials.customHasPassword ? 'warn' : 'ok') +
        stat('fa-file-code', 'Runner report', c.reportPath, dotOk ? 'ok' : '') +
        stat('fa-wand-magic-sparkles', 'AI assistant', s.ai.hasKey ? (c.aiModel || 'claude-opus-5') : 'No API key', s.ai.hasKey ? 'ok' : 'warn');

    cacheGet(null).then(function (map) {
        var keys = map ? Object.keys(map) : [];
        var count = function (p) { return keys.filter(function (k) { return k.indexOf(p) === 0; }).length; };
        $('fs-cache-info').innerHTML =
            '<span class="k">Pod</span><span class="v">' + esc(s.pod) + '</span>' +
            '<span class="k">Owners</span><span class="v">' + (map && map.owners ? map.owners.length : 0) + '</span>' +
            '<span class="k">Object lists</span><span class="v">' + count('schema.') + '</span>' +
            '<span class="k">Column sets</span><span class="v">' + count('detail.') + '</span>' +
            '<span class="k">Index / FK sets</span><span class="v">' + (count('idx.') + count('fk.')) + '</span>' +
            '<span class="k">Folder</span><span class="v">' + esc(s.storagePath) + '</span>';
    }).catch(function () { });
}
function stat(icon, label, value, state) {
    return '<div class="fs-stat"><div class="ic ' + (state || '') + '"><i class="fa-solid ' + icon + '"></i></div><div><div class="lbl">' + esc(label) + '</div><div class="val">' + esc(value) + '</div></div></div>';
}
function credSourceChanged(silent) {
    var custom = (document.querySelector('input[name="cred-src"]:checked') || {}).value === 'custom';
    $('fs-custom-cred').style.opacity = custom ? '1' : '.45';
    $('fs-custom-cred').querySelectorAll('input').forEach(function (i) { i.disabled = !custom; });
    if (silent !== true && FS.status && custom !== (FS.status.config.useCustomCredentials === true)) {
        fsCall('fusionSqlConfig', { patch: { useCustomCredentials: custom } }).then(function (s) { FS.status = s; renderHeader(); toast(custom ? 'Using the dedicated BI account' : 'Using the application account'); });
    }
}
function saveConfig() {
    var patch = {
        baseUrl: $('cfg-baseUrl').value.trim(),
        folderPath: $('cfg-folderPath').value.trim(),
        dataModelPath: $('cfg-dataModelPath').value.trim(),
        reportPath: $('cfg-reportPath').value.trim(),
        dataSource: $('cfg-dataSource').value.trim(),
        rowLimit: parseInt($('cfg-rowLimit').value, 10) || 100,
        timeoutMs: (parseInt($('cfg-timeoutSec').value, 10) || 120) * 1000
    };
    fsCall('fusionSqlConfig', { patch: patch }).then(function (s) {
        if (!s.success) { toast(s.error || 'Save failed', 'err'); return; }
        FS.status = s; renderHeader(); renderConnection(); toast('Settings saved');
        $('fs-rowlimit').value = s.config.rowLimit;
    }).catch(function (e) { toast(String(e), 'err'); });
}
function saveCredentials() {
    fsCall('fusionSqlSaveCredentials', { username: $('cred-user').value.trim(), password: $('cred-pass').value }).then(function (s) {
        if (!s.success) { toast(s.error || 'Save failed', 'err'); return; }
        $('cred-pass').value = '';
        FS.status = s; renderHeader(); renderConnection(); toast('Credentials saved (encrypted)');
    });
}
function saveAi() {
    var key = $('ai-key').value.trim();
    var chain = key ? fsCall('fusionSqlSaveAiKey', { apiKey: key }) : Promise.resolve();
    chain.then(function () { return fsCall('fusionSqlConfig', { patch: { aiModel: $('cfg-aiModel').value } }); })
        .then(function (s) { $('ai-key').value = ''; FS.status = s; renderConnection(); toast('AI settings saved'); });
}
function removeAiKey() {
    confirmModal('Remove the Claude API key?', 'Ask AI will stop working until a new key is saved.', function () {
        fsCall('fusionSqlSaveAiKey', { apiKey: '' }).then(function (s) { FS.status = s; renderConnection(); toast('Key removed'); });
    });
}
function testConnection() {
    setConn('busy', 'Testing…');
    var t0 = Date.now();
    fsql('SELECT 1 AS n FROM dual', 1).then(function (r) {
        if (!(r.rowCount === 1 && String(r.rows[0].N) === '1')) throw runnerProblem('SELECT 1 FROM dual did not return N = 1', r);
        setConn('ok', 'Connected · ' + fmtMs(r.elapsedMs));
        toast('Connected to ' + FS.status.pod + ' in ' + fmtMs(Date.now() - t0));
        renderConnection();
    }).catch(function (e) {
        setConn('err', 'Connection failed');
        openModal('Connection test failed', '<div class="fs-error-box">' + esc(e) + '</div><p class="fs-muted" style="margin-top:10px;">If the report is missing, use <b>Deploy runner report</b>. Details are in the API Inspector.</p>',
            [{ label: 'Open API Inspector', cls: '', onClick: function () { closeModal(); showTab('inspector'); } }, { label: 'Close', cls: 'primary', onClick: closeModal }]);
    });
}
function deployRunner() {
    var btn = $('fs-deploy-btn'), log = $('fs-deploy-log');
    btn.disabled = true;
    log.innerHTML = '<div class="info"><span class="fs-spinner" style="display:inline-block;width:12px;height:12px;border-width:2px;vertical-align:middle;"></span> Deploying through CatalogService…</div>';
    fsCall('fusionSqlDeploy', {}).then(function (r) {
        log.innerHTML = (r.steps || []).map(function (s) { return '<div class="' + (s.indexOf('✗') === 0 ? 'err' : s.indexOf('✓') === 0 ? 'ok' : 'info') + '">' + esc(s) + '</div>'; }).join('') +
            (r.success ? '<div class="ok"><b>' + esc(r.message) + '</b></div>' : '<div class="err">' + esc(r.error || 'Deploy failed') + '</div>' + (r.raw ? '<details><summary class="fs-muted">Raw response</summary><pre class="fs-error-box">' + esc(r.raw) + '</pre></details>' : ''));
        if (r.success) { setConn('ok', 'Connected'); toast('Runner deployed'); schemaInit(); }
        else toast('Deploy failed — see the step log', 'err');
    }).catch(function (e) { log.innerHTML = '<div class="err">' + esc(e) + '</div>'; })
        .then(function () { btn.disabled = false; });
}
function exportCache() { fsCall('fusionSqlCacheExport', {}).then(function (r) { if (r.success) toast('Exported to ' + r.path); else if (!r.cancelled) toast(r.error, 'err'); }); }
function clearCache() {
    confirmModal('Clear the schema cache?', 'Owners, object lists and columns will be re-read from Fusion next time. Saved queries are kept.', function () {
        fsCall('fusionSqlCacheClear', {}).then(function () { Object.keys(FS.hintTables).forEach(function (k) { delete FS.hintTables[k]; }); toast('Cache cleared'); renderConnection(); schemaInit(); });
    });
}

// ── API Inspector ──────────────────────────────────────────────
function loadCalls(clear) {
    fsCall('fusionSqlCalls', { clear: !!clear }).then(function (r) {
        FS.calls = r.calls || [];
        $('fs-calls-count').textContent = FS.calls.length;
        var list = $('fs-call-list');
        if (!FS.calls.length) { list.innerHTML = '<div class="fs-empty" style="min-height:160px;"><i class="fa-solid fa-satellite-dish"></i><p>No calls yet.</p></div>'; $('fs-call-detail').innerHTML = ''; return; }
        list.innerHTML = FS.calls.map(function (c, i) {
            var ok = c.status >= 200 && c.status < 300 && !/faultstring/.test(c.response || '');
            return '<div class="fs-call" data-i="' + i + '" onclick="showCall(' + i + ')"><span class="k">' + esc(c.kind) + '</span>' +
                '<span class="fs-pill ' + (ok ? 'ok' : 'err') + '">' + (c.status || 'ERR') + '</span>' +
                '<span class="t">' + esc(c.at) + ' · ' + fmtMs(c.durationMs) + '</span><span class="t">' + fmtBytes((c.response || '').length) + '</span></div>';
        }).join('');
        showCall(0);
    });
}
function showCall(i) {
    var c = FS.calls[i]; if (!c) return;
    document.querySelectorAll('.fs-call').forEach(function (el) { el.classList.toggle('sel', +el.dataset.i === i); });
    FS.selectedCall = i;
    var block = function (title, text, id) {
        return '<h4>' + title + ' <button class="fs-icon-btn" onclick="copyText(FS.calls[' + i + '].' + id + ')" title="Copy"><i class="fa-solid fa-copy"></i></button></h4><pre>' + esc(text) + '</pre>';
    };
    $('fs-call-detail').innerHTML =
        '<div class="fs-kv"><span class="k">Operation</span><span class="v">' + esc(c.kind) + '</span><span class="k">URL</span><span class="v">' + esc(c.url) + '</span>' +
        '<span class="k">Status</span><span class="v">' + (c.status || 'no response') + ' · ' + fmtMs(c.durationMs) + '</span><span class="k">Protocol</span><span class="v">' + esc(c.protocol) + '</span></div>' +
        block('Headers', c.headers, 'headers') + block('Request', c.request, 'request') + block('Response', c.response, 'response') +
        (c.decoded ? block('Decoded report output (reportBytes)', c.decoded, 'decoded') : '');
}

// ── Ask AI ─────────────────────────────────────────────────────
var AI_SYNONYMS = {
    CUSTOMER: ['CUST', 'PARTY', 'HZ_'], CUSTOMERS: ['CUST', 'PARTY', 'HZ_'],
    SUPPLIER: ['VENDOR', 'POZ_', 'AP_SUPPLIER'], SUPPLIERS: ['VENDOR', 'POZ_', 'AP_SUPPLIER'], VENDOR: ['POZ_', 'AP_SUPPLIER'],
    INVOICE: ['RA_CUSTOMER_TRX', 'AP_INVOICES', 'TRX'], INVOICES: ['RA_CUSTOMER_TRX', 'AP_INVOICES', 'TRX'],
    PAYMENT: ['AP_PAYMENT', 'CHECKS', 'PAYMENT_SCHEDULES'], PAYMENTS: ['AP_PAYMENT', 'CHECKS', 'PAYMENT_SCHEDULES'],
    RECEIVABLE: ['AR_', 'RA_', 'PAYMENT_SCHEDULES'], RECEIVABLES: ['AR_', 'RA_', 'PAYMENT_SCHEDULES'], PAYABLE: ['AP_'], PAYABLES: ['AP_'],
    ACCOUNT: ['GL_CODE_COMBINATIONS'], ACCOUNTS: ['GL_CODE_COMBINATIONS'], JOURNAL: ['GL_JE'], JOURNALS: ['GL_JE'], LEDGER: ['GL_LEDGERS', 'GL_BALANCES'],
    TAX: ['ZX_'], BANK: ['CE_', 'IBY_'], ASSET: ['FA_'], ASSETS: ['FA_'],
    ITEM: ['EGP_SYSTEM_ITEMS', 'ITEM'], ITEMS: ['EGP_SYSTEM_ITEMS', 'ITEM'], ONHAND: ['INV_ONHAND', 'ONHAND'], INVENTORY: ['INV_'],
    SUBINVENTORY: ['INV_SECONDARY_INVENTORIES', 'SUBINV'], ORGANIZATION: ['INV_ORG_PARAMETERS', 'HR_ORGANIZATION'], LOT: ['INV_LOT'], LOTS: ['INV_LOT'],
    ORDER: ['DOO_HEADERS', 'DOO_LINES', 'DOO_'], ORDERS: ['DOO_HEADERS', 'DOO_LINES', 'DOO_'],
    SALE: ['DOO_HEADERS', 'DOO_LINES', 'DOO_FULFILL_LINES'], SALES: ['DOO_HEADERS', 'DOO_LINES', 'DOO_FULFILL_LINES'], PO: ['PO_HEADERS', 'PO_LINES'], PURCHASE: ['PO_'], REQUISITION: ['POR_'], RECEIPT: ['RCV_'], RECEIPTS: ['RCV_'],
    SHIPMENT: ['WSH_', 'DOO_FULFILL'], SHIPMENTS: ['WSH_', 'DOO_FULFILL'], TRANSACTION: ['INV_MATERIAL_TXNS', 'TRX'], TRANSACTIONS: ['INV_MATERIAL_TXNS', 'TRX'],
    EMPLOYEE: ['PER_', 'PER_ALL_PEOPLE'], EMPLOYEES: ['PER_', 'PER_ALL_PEOPLE'], PERSON: ['PER_'], PROJECT: ['PJF_', 'PJC_'], PROJECTS: ['PJF_', 'PJC_']
};
var AI_STOP = { THE: 1, AND: 1, FOR: 1, WITH: 1, FROM: 1, THAT: 1, SHOW: 1, LIST: 1, GIVE: 1, ALL: 1, ARE: 1, WHICH: 1, WHAT: 1, WHERE: 1, HAVE: 1, THAN: 1, OLDER: 1, LAST: 1, MONTH: 1, DAYS: 1, GIVEN: 1, ABOVE: 1, BELOW: 1, EACH: 1, PER: 1, INTO: 1, THEIR: 1, BY: 1, OPEN: 1, TOTAL: 1, TOTALS: 1, COUNT: 1, NUMBER: 1, NEED: 1, WANT: 1, QUERY: 1, GET: 1, FIND: 1, BETWEEN: 1, DATE: 1, DATES: 1, TRY: 1, AGAIN: 1, PLEASE: 1, SQL: 1, DATA: 1, REPORT: 1, FETCH: 1, WRITE: 1, TODAY: 1, YEAR: 1, WEEK: 1 };

function openAi() {
    $('fs-ai').classList.add('open'); $('fs-ai-backdrop').classList.add('open');
    if (FS.status && !FS.status.ai.hasKey) toggleAiSettings(true);
    else setTimeout(function () { $('fs-ai-q').focus(); }, 200);
}

// ── Ask AI settings (gear) ──
/** Key saved by the AI Digital Employee module (localStorage aiEngineSettings, base64). */
function appAiKey() {
    try {
        var s = JSON.parse(localStorage.getItem('aiEngineSettings') || 'null');
        return s && s.k ? atob(s.k) : null;
    } catch (e) { return null; }
}
function toggleAiSettings(show) {
    var panel = $('fs-ai-settings');
    show = show === undefined ? !panel.classList.contains('open') : show;
    panel.classList.toggle('open', show);
    $('fs-ai-gear').classList.toggle('on', show);
    if (!show) { $('fs-ai-key').value = ''; $('fs-ai-q').focus(); return; }
    var has = FS.status && FS.status.ai.hasKey;
    $('fs-ai-key-state').textContent = has ? '✓ key saved' : 'not set';
    $('fs-ai-key-state').className = 'fs-chip ' + (has ? '' : 'warn');
    $('fs-ai-key').placeholder = has ? 'Leave blank to keep the saved key' : 'sk-ant-…';
    $('fs-ai-model').value = (FS.status && FS.status.config.aiModel) || 'claude-opus-5';
    $('fs-ai-import').style.display = appAiKey() ? '' : 'none';
    setTimeout(function () { $('fs-ai-key').focus(); }, 50);
}
function importAppAiKey() {
    var k = appAiKey();
    if (!k) { toast('No key found in the AI Digital Employee settings', 'warn'); return; }
    $('fs-ai-key').value = k;
    saveAiSettings();
}
function saveAiSettings() {
    var key = $('fs-ai-key').value.trim();
    if (key && !/^sk-ant-/.test(key)) { toast('That does not look like a Claude API key (sk-ant-…)', 'warn'); return; }
    if (!key && !(FS.status && FS.status.ai.hasKey)) { toast('Paste your Claude API key first', 'warn'); $('fs-ai-key').focus(); return; }
    (key ? fsCall('fusionSqlSaveAiKey', { apiKey: key }) : Promise.resolve())
        .then(function () { return fsCall('fusionSqlConfig', { patch: { aiModel: $('fs-ai-model').value } }); })
        .then(function (s) {
            FS.status = s; renderHeader();
            toggleAiSettings(false);
            $('fs-ai-context').innerHTML = '<i class="fa-solid fa-circle-check" style="color:#15803d"></i> Claude is ready · ' + esc(s.config.aiModel);
            toast('Claude settings saved');
            // Retry the question that failed for lack of a key
            var last = FS.ai.pendingQuestion;
            if (last) { FS.ai.pendingQuestion = null; $('fs-ai-q').value = last; sendAi(); }
        })
        .catch(function (e) { toast(String(e), 'err'); });
}
function closeAi() { $('fs-ai').classList.remove('open'); $('fs-ai-backdrop').classList.remove('open'); }
function clearAi() { FS.ai.history = []; $('fs-ai-body').querySelectorAll('.fs-msg').forEach(function (m) { m.remove(); }); $('fs-ai-body').querySelector('.fs-ai-welcome').style.display = ''; }
function aiSuggest(btn) { $('fs-ai-q').value = btn.textContent; sendAi(); }

/** Weighted search terms: question words (weight 1) + Fusion table-prefix synonyms (weight 3). */
function aiKeywords(q) {
    var words = (q.toUpperCase().match(/[A-Z][A-Z0-9_]{2,}/g) || []).filter(function (w) { return !AI_STOP[w]; });
    var terms = [], seen = {};
    function add(t, w) { if (!seen[t] || seen[t].w < w) { if (!seen[t]) terms.push(seen[t] = { t: t, w: w }); else seen[t].w = w; } }
    words.forEach(function (w) {
        var stem = w.replace(/S$/, '');
        add(stem.length >= 3 ? stem : w, 1);
        (AI_SYNONYMS[w] || AI_SYNONYMS[stem] || []).forEach(function (syn) { add(syn, 3); });
    });
    return terms;
}

function scoreName(n, terms) {
    var s = 0;
    terms.forEach(function (t) { var i = n.indexOf(t.t); if (i === 0) s += 3 * t.w; else if (i > 0) s += t.w; });
    if (!s) return 0;
    return s - n.length / 100 - (/(_TL|_GT|_TMP|_INT|_BK|_BAK|_V\d*)$|^XX|_ARCH|_HIST|_STG|_INTERFACE/.test(n) ? 2 : 0);
}

/** Dictionary search in Fusion itself — used when the cached lists have (almost) no match. */
function liveCandidates(terms, owners) {
    var likes = terms.slice(0, 12).map(function (t) {
        var e = t.t.replace(/[\\%_]/g, '\\$&');
        return 'object_name LIKE ' + lit(/_$/.test(t.t) ? e + '%' : '%' + e + '%') + " ESCAPE '\\'";
    });
    if (!likes.length) return Promise.resolve([]);
    var sql = 'SELECT owner, object_name, object_type FROM all_objects WHERE owner IN (' + owners.map(lit).join(',') + ")" +
        " AND object_type IN ('TABLE','VIEW') AND (" + likes.join(' OR ') + ') ORDER BY LENGTH(object_name), object_name';
    return fsql(sql, 400).then(function (r) {
        return r.rows.map(function (x) { return { owner: String(x.OWNER), kind: String(x.OBJECT_TYPE), name: String(x.OBJECT_NAME) }; });
    }).catch(function () { return []; });
}

/** Builds "OWNER.TABLE: col, col…" lines for the tables that match the question (RD §7.4). */
function buildAiSchema(question) {
    var terms = aiKeywords(question);
    // A short follow-up ("try again", "add customer name") keeps the previous question's subject
    var prevUser = FS.ai.history.filter(function (h) { return h.role === 'user'; }).map(function (h) { return h.content; });
    if (prevUser.length) aiKeywords(prevUser[prevUser.length - 1]).forEach(function (t) {
        if (!terms.some(function (x) { return x.t === t.t; })) terms.push({ t: t.t, w: terms.length ? t.w * 0.5 : t.w });
    });
    var owners = [FS.schema.owner]; if (owners.indexOf('FUSION') < 0) owners.push('FUSION');
    var lists = [];
    owners.forEach(function (o) { ['TABLE', 'VIEW'].forEach(function (k) { lists.push({ owner: o, kind: k }); }); });
    var live = false;
    return Promise.all(lists.map(function (l) { return cacheGet('schema.' + l.owner + '.' + l.kind).then(function (v) { l.names = (v && v.names) || []; return l; }); }))
        .then(function (ls) {
            var scored = [], have = {};
            ls.forEach(function (l) {
                l.names.forEach(function (n) {
                    var sc = scoreName(n, terms);
                    if (sc > 0) { scored.push({ owner: l.owner, kind: l.kind, name: n, score: sc }); have[l.owner + '.' + n] = 1; }
                });
            });
            if (scored.length >= 8 || !terms.length) return scored;
            // Cache is empty or too thin: ask the data dictionary directly
            live = true;
            return liveCandidates(terms, owners).then(function (found) {
                found.forEach(function (f) {
                    if (have[f.owner + '.' + f.name]) return;
                    var sc = scoreName(f.name, terms);
                    if (sc > 0) scored.push({ owner: f.owner, kind: f.kind, name: f.name, score: sc });
                });
                return scored;
            });
        })
        .then(function (scored) {
            scored.sort(function (a, b) { return b.score - a.score; });
            var top = scored.slice(0, 40);
            return Promise.all(top.map(function (t) {
                return cacheGet('detail.' + t.owner + '.' + t.kind + '.' + t.name).then(function (v) { t.cols = Array.isArray(v) ? v : null; return t; });
            }));
        })
        .then(function (top) {
            // Fetch columns for up to 15 uncached candidates in ONE dictionary query
            var missing = top.filter(function (t) { return !t.cols; }).slice(0, 15);
            if (!missing.length) return top;
            var byOwner = {};
            missing.forEach(function (t) { (byOwner[t.owner] = byOwner[t.owner] || []).push(t.name); });
            var where = Object.keys(byOwner).map(function (o) { return '(owner = ' + lit(o) + ' AND table_name IN (' + byOwner[o].map(lit).join(',') + '))'; }).join(' OR ');
            return fsql('SELECT owner, table_name, column_name, data_type, data_length, nullable FROM all_tab_columns WHERE ' + where + ' ORDER BY owner, table_name, column_id', 5000)
                .then(function (r) {
                    var grouped = {};
                    r.rows.forEach(function (c) { var k = c.OWNER + '.' + c.TABLE_NAME; (grouped[k] = grouped[k] || []).push({ COLUMN_NAME: c.COLUMN_NAME, DATA_TYPE: c.DATA_TYPE, DATA_LENGTH: c.DATA_LENGTH, NULLABLE: c.NULLABLE }); });
                    missing.forEach(function (t) {
                        t.cols = grouped[t.owner + '.' + t.name] || [];
                        if (t.cols.length) { cacheSet('detail.' + t.owner + '.' + t.kind + '.' + t.name, t.cols); registerHintColumns(t.owner, t.name, t.cols); }
                    });
                    return top;
                }).catch(function () { return top; });
        })
        .then(function (top) {
            var withCols = top.filter(function (t) { return t.cols && t.cols.length; });
            return {
                live: live,
                count: withCols.length,
                names: withCols.map(function (t) { return t.name; }),
                text: withCols.map(function (t) {
                    return t.owner + '.' + t.name + (t.kind === 'VIEW' ? ' (view)' : '') + ': ' +
                        t.cols.slice(0, 120).map(function (c) { return c.COLUMN_NAME + ' ' + (c.DATA_TYPE || '').replace('VARCHAR2', 'VC'); }).join(', ');
                }).join('\n')
            };
        });
}

function sendAi() {
    var q = $('fs-ai-q').value.trim();
    if (!q || FS.ai.busy) return;
    FS.ai.busy = true; $('fs-ai-send').disabled = true;
    $('fs-ai-q').value = '';
    $('fs-ai-body').querySelector('.fs-ai-welcome').style.display = 'none';
    appendMsg('user', esc(q));
    var typing = appendMsg('bot', '<div class="fs-typing"><span></span><span></span><span></span></div>');
    $('fs-ai-context').innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Finding relevant tables…';
    buildAiSchema(q).then(function (ctx) {
        $('fs-ai-context').innerHTML = ctx.count
            ? '<i class="fa-solid fa-diagram-project"></i> Context' + (ctx.live ? ' (live lookup in Fusion)' : '') + ': ' + ctx.count + ' tables — ' + esc(ctx.names.slice(0, 6).join(', ')) + (ctx.count > 6 ? '…' : '')
            : '<i class="fa-solid fa-triangle-exclamation"></i> No matching tables found in Fusion — name the business object (e.g. sales order, supplier invoice, onhand).';
        return fsCall('fusionSqlAiSql', { question: q, schema: ctx.text, history: FS.ai.history.slice(-8) });
    }).then(function (r) {
        typing.remove();
        if (!r.success) {
            if (/API key/i.test(r.error || '')) {
                FS.ai.pendingQuestion = q;
                appendMsg('bot err', esc(r.error) + '<div style="margin-top:8px;"><button class="fs-btn sm ai" onclick="toggleAiSettings(true)"><i class="fa-solid fa-gear"></i> Add Claude API key</button></div>');
                toggleAiSettings(true);
            } else appendMsg('bot err', esc(r.error));
            return;
        }
        FS.ai.history.push({ role: 'user', content: q }, { role: 'assistant', content: r.response });
        appendMsg('bot', renderAiAnswer(r.response));
    }).catch(function (e) { typing.remove(); appendMsg('bot err', esc(e)); })
        .then(function () { FS.ai.busy = false; $('fs-ai-send').disabled = false; $('fs-ai-q').focus(); });
}
function appendMsg(cls, html) {
    var d = document.createElement('div');
    d.className = 'fs-msg ' + cls; d.innerHTML = html;
    $('fs-ai-body').appendChild(d); $('fs-ai-body').scrollTop = 1e9;
    return d;
}
var _aiBlocks = [];
function renderAiAnswer(text) {
    var parts = text.split(/```(?:sql)?\s*\n?([\s\S]*?)```/i), html = '';
    parts.forEach(function (p, i) {
        if (i % 2 === 1) {
            var idx = _aiBlocks.push(p.trim()) - 1;
            html += '<div class="fs-sqlblock"><pre>' + esc(p.trim()) + '</pre><div class="bar">' +
                '<button class="fs-btn sm primary" onclick="aiUse(' + idx + ', true)"><i class="fa-solid fa-play"></i> Insert &amp; run</button>' +
                '<button class="fs-btn sm" onclick="aiUse(' + idx + ')"><i class="fa-solid fa-arrow-left"></i> Insert</button>' +
                '<button class="fs-btn sm ghost" style="color:#f5e9e2" onclick="copyText(_aiBlocks[' + idx + '])"><i class="fa-solid fa-copy"></i></button></div></div>';
        } else if (p.trim()) {
            html += p.trim().split(/\n{2,}/).map(function (para) {
                if (/^\s*[-*•] /m.test(para)) return '<ul>' + para.split(/\n/).filter(function (l) { return l.trim(); }).map(function (l) { return '<li>' + mdInline(l.replace(/^\s*[-*•]\s*/, '')) + '</li>'; }).join('') + '</ul>';
                return '<p>' + mdInline(para).replace(/\n/g, '<br>') + '</p>';
            }).join('');
        }
    });
    return html;
}
function mdInline(s) { return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); }
function aiUse(i, run) {
    setCurrentQuery(null); setSql(_aiBlocks[i]); closeAi(); showTab('builder');
    if (run) setTimeout(runEditor, 60);
}

// ── Modal helpers ──────────────────────────────────────────────
function openModal(title, bodyHtml, buttons, wide) {
    $('fs-modal-title').textContent = title;
    $('fs-modal-body').innerHTML = bodyHtml;
    $('fs-modal-body').onkeydown = null;
    var foot = $('fs-modal-foot'); foot.innerHTML = '';
    (buttons || []).forEach(function (b) {
        var el = document.createElement('button');
        el.className = 'fs-btn ' + (b.cls || ''); el.innerHTML = b.label; el.onclick = b.onClick;
        foot.appendChild(el);
    });
    document.querySelector('.fs-modal-box').classList.toggle('wide', !!wide);
    $('fs-modal').classList.add('open');
}
function closeModal() { $('fs-modal').classList.remove('open'); }
function confirmModal(title, text, onYes) {
    openModal(title, '<p>' + esc(text) + '</p>', [
        { label: 'Cancel', cls: 'ghost', onClick: closeModal },
        { label: 'Confirm', cls: 'primary', onClick: function () { closeModal(); onYes(); } }
    ]);
}

// ── Resizer / keyboard / init ─────────────────────────────────
function initResizer() {
    var wrap = $('fs-editor-wrap'), rz = $('fs-resizer'), startY = 0, startH = 0;
    wrap.style.height = lsGet('fusionSql.editorH', 240) + 'px';
    rz.addEventListener('mousedown', function (e) {
        startY = e.clientY; startH = wrap.offsetHeight; document.body.style.userSelect = 'none';
        var move = function (ev) { wrap.style.height = Math.max(90, Math.min(window.innerHeight - 260, startH + ev.clientY - startY)) + 'px'; if (FS.editor) FS.editor.refresh(); };
        var up = function () { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.style.userSelect = ''; lsSet('fusionSql.editorH', wrap.offsetHeight); };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
}

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeModal(); closeAi(); }
});

(function init() {
    document.querySelectorAll('.fs-tab').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });
    $('fs-rowlimit').addEventListener('input', function () { this.dataset.touched = '1'; });
    $('fs-ai-q').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAi(); } });
    initEditor();
    initResizer();
    loadStatus().then(function (s) {
        if (!s) return;
        loadQueries();
        schemaInit();
        var tab = lsGet('fusionSql.tab', 'builder');
        if (tab !== 'builder') showTab(tab);
    });
})();
