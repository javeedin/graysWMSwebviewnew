/* Fusion Model module — maintains the model (modules = DuckDB files, tables = SQL loads), runs refreshes on the
   refresher PC, and explores the published data. Host actions (classes/Form1_ModelHandlers.cs → engine/FusionModel):
   fmStatus, fmModelGet, fmModelSave, fmRefresh (+ fmProgress), fmCancel, fmQuery, fmSync, fmLog, fmSettingsSave. */

var S = { tab: 'modules', status: null, model: null, isAdmin: false, cur: null, dirty: false, schema: [], last: null, tq: '' };
var NAME_RE = /^[a-z][a-z0-9_]{0,59}$/;

// ── helpers ────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function toast(t) { var el = $('toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { el.style.display = 'none'; }, 4200); }
function busy(msg, cancellable) { $('busy').hidden = !msg; if (msg) { $('busy').querySelector('span').textContent = msg; $('b-cancel').hidden = !cancellable; } }
function hasHost() { return !!(window.chrome && window.chrome.webview); }
function appUser() { try { return sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || ''; } catch (e) { return ''; } }
function ago(iso) { if (!iso) return 'never'; var d = new Date(iso); if (isNaN(d)) return iso; var m = Math.round((Date.now() - d) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; }
function num(n) { return n == null ? '—' : (+n).toLocaleString(); }
function size(b) { return !b ? '—' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
function modal(html, cls) { if (html == null) { $('modal').hidden = true; return; } $('modal-box').className = 'modal-box' + (cls ? ' ' + cls : ''); $('modal-box').innerHTML = html; $('modal').hidden = false; }

// ── bridge ─────────────────────────────────────────────────────
var _pending = {}, _progress = {};
function host(action, payload, onProgress) {
    return new Promise(function (resolve, reject) {
        if (!hasHost()) { reject('Open this page inside the Gray\'s WMS app.'); return; }
        var id = 'fm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        _pending[id] = { resolve: resolve, reject: reject };
        if (onProgress) _progress[id] = onProgress;
        window.chrome.webview.postMessage(Object.assign({ action: action, requestId: id, appUser: appUser() }, payload || {}));
    });
}
if (hasHost()) window.chrome.webview.addEventListener('message', function (ev) {
    var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
    if (!r || !r.requestId) return;
    if (r.action === 'fmProgress') { if (_progress[r.requestId]) _progress[r.requestId](r.message); return; }
    var cb = _pending[r.requestId]; if (!cb) return;
    delete _pending[r.requestId]; delete _progress[r.requestId];
    if (r.action === 'error') cb.reject(r.message || 'Host error'); else cb.resolve(r.data == null ? {} : r.data);
});
function fm(action, payload, onProgress) {
    return host(action, payload, onProgress).then(function (d) { if (d && d.ok === false) throw d.error || 'failed'; return d; });
}

// ── load ───────────────────────────────────────────────────────
function loadAll() {
    return Promise.all([fm('fmStatus'), fm('fmModelGet').catch(function () { return { model: { version: 0, modules: [], tables: [] } }; })]).then(function (r) {
        S.status = r[0].status; S.isAdmin = !!r[0].isAdmin;
        if (!S.dirty) S.model = normModel(r[1].model);
        renderAcct();
        if (S.tab === 'modules') renderModules();
    }).catch(function (e) { $('acct').innerHTML = '<span class="pill warn">' + esc(e) + '</span>'; });
}
function normModel(m) {
    m = m || {}; m.modules = m.modules || []; m.tables = m.tables || [];
    m.tables.forEach(function (t) { t.source = t.source || { kind: 'apex', sql: '' }; t.key = t.key || []; t.strategy = (t.strategy || 'full').toLowerCase(); });
    m.modules.forEach(function (x) { x.schedule = x.schedule || { mode: 'MANUAL', time: '06:00' }; });
    return m;
}
function modStatus(name) { return ((S.status || {}).modules || []).find(function (m) { return m.name === name; }) || { tables: [] }; }
function tableStatus(mod, name) { return (modStatus(mod).tables || []).find(function (t) { return t.name === name; }) || {}; }

function renderAcct() {
    var st = S.status || {}, s = st.settings || {};
    $('acct').innerHTML = !st.sharedReachable
        ? '<span class="pill warn" title="' + esc(s.sharedRoot || '') + '"><i class="fa-solid fa-triangle-exclamation"></i> Shared folder not reachable</span>'
        : '<span class="pill ok" title="' + esc(s.sharedRoot) + '"><i class="fa-solid fa-' + (s.isRefresher ? 'server' : 'desktop') + '"></i> ' +
          (s.isRefresher ? 'Refresher · ' : '') + (s.readMode === 'DIRECT' ? 'direct' : 'cached') + '</span>';
}

function showTab(t) {
    S.tab = t;
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === t); });
    ['modules', 'explore', 'log', 'settings'].forEach(function (p) { $('page-' + p).hidden = p !== t; });
    if (t === 'modules') renderModules();
    if (t === 'explore' && !S.schema.length) loadSchema();
    if (t === 'log') loadLog();
    if (t === 'settings') renderSettings();
}

// ════════════════════════════════ MODULES ════════════════════════════════
function renderModules() {
    var m = S.model || { modules: [] };
    $('modlist').innerHTML = m.modules.length ? m.modules.map(function (x) {
        var st = modStatus(x.name), rows = (st.tables || []).reduce(function (a, t) { return a + (t.rows || 0); }, 0);
        var dot = st.version ? (st.cached || (S.status.settings || {}).readMode === 'DIRECT' ? 'ok' : 'run') : '';
        return '<button class="ritem' + (S.cur === x.name ? ' on' : '') + '" data-mod="' + esc(x.name) + '"><i class="fa-solid fa-database"></i><span><b>' + esc(x.title || x.name) + '</b>' +
            '<small>' + esc(x.name) + ' · ' + (st.version ? num(rows) + ' rows · ' + ago(st.publishedUtc) : 'not loaded yet') + '</small></span>' +
            (dot ? '<i class="dot ' + dot + '" title="' + (dot === 'ok' ? 'Published and available on this PC' : 'Published — this PC copies it at the next sync') + '"></i>' : '') + '</button>';
    }).join('') : '<div class="muted pad">No modules yet — add a starter below.</div>';
    if (S.cur && m.modules.some(function (x) { return x.name === S.cur; })) renderModule(); else if (!S.cur) $('modmain').scrollTop = 0;
}

function renderModule() {
    var m = S.model.modules.find(function (x) { return x.name === S.cur; }); if (!m) return;
    var st = modStatus(m.name), tables = S.model.tables.filter(function (t) { return t.module === m.name; });
    var dis = S.isAdmin ? '' : ' disabled title="AI admins only"';
    var h = '<div class="mhead"><div class="grow"><input class="mtitle" data-mf="title" value="' + esc(m.title || '') + '" placeholder="Module title" spellcheck="false">' +
        '<div class="stateline"><span><b>' + esc(m.name) + '</b>.duckdb</span>' +
        (st.version ? '<span>version <b>' + esc(st.version) + '</b></span><span>published <b>' + ago(st.publishedUtc) + '</b> by ' + esc(st.publishedBy || '') + '</span><span>' + size(st.bytes) + '</span>' +
            '<span>' + (st.cached ? '<i class="fa-solid fa-circle-check" style="color:#16a34a"></i> on this PC' : ((S.status.settings || {}).readMode === 'DIRECT' ? 'read from the shared folder' : 'not synced to this PC yet')) + '</span>'
            : '<span>not loaded yet</span>') + '</div></div>' +
        '<div class="dsact"><button class="btn" data-act="save"' + dis + '><i class="fa-solid fa-floppy-disk"></i> Save' + (S.dirty ? ' *' : '') + '</button>' +
        '<button class="btn primary" data-act="refresh"' + dis + ' title="Incremental tables load only changed rows"><i class="fa-solid fa-rotate"></i> Refresh</button>' +
        '<button class="btn" data-act="full"' + dis + ' title="Reload every table in full"><i class="fa-solid fa-arrows-rotate"></i> Full reload</button></div></div>';
    h += '<div class="card"><div class="row"><label class="fld grow"><span>Description</span><input data-mf="description" value="' + esc(m.description || '') + '"></label>' +
        '<label class="fld" style="max-width:190px"><span>Schedule</span><select data-mf="schedMode">' + [['MANUAL', 'Manual only'], ['HOURLY', 'Every hour'], ['DAILY', 'Daily at']].map(function (o) {
            return '<option value="' + o[0] + '"' + (m.schedule.mode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
        '<label class="fld" style="max-width:120px"' + (m.schedule.mode === 'DAILY' ? '' : ' hidden') + '><span>Time</span><input type="time" data-mf="schedTime" value="' + esc(m.schedule.time || '06:00') + '"></label></div>' +
        '<p class="muted sm">Scheduled refreshes run on the refresher PC (Settings) while the app is open there; one refresher at a time.</p></div>';
    var pl = (S.progressLog || {})[m.name];
    h += '<div id="progress" class="progress"' + (pl ? '' : ' hidden') + '>' + esc(pl || '') + '</div>';
    tables.forEach(function (t) {
        var i = S.model.tables.indexOf(t), ts = tableStatus(m.name, t.name), inc = t.strategy === 'incremental';
        h += '<div class="card tcard"><div class="tblh"><i class="fa-solid fa-table"></i><input class="tname" data-t="' + i + '" data-tf="name" value="' + esc(t.name) + '" spellcheck="false">' +
            '<span class="stateline">' + (ts.rows != null ? '<span><b>' + num(ts.rows) + '</b> rows</span><span>' + ts.columns + ' columns</span><span>loaded ' + ago(ts.loadedUtc) + '</span>' + (ts.watermark ? '<span>up to <b>' + esc(ts.watermark) + '</b></span>' : '') : '<span>not loaded</span>') + '</span>' +
            '<span class="grow"></span>' +
            '<button class="btn sm" data-act="rtable" data-t="' + i + '"' + dis + '><i class="fa-solid fa-rotate"></i> Refresh</button>' +
            (ts.rows != null ? '<button class="btn sm" data-act="explore" data-t="' + i + '"><i class="fa-solid fa-magnifying-glass-chart"></i></button>' : '') +
            '<button class="btn sm" data-act="rmtable" data-t="' + i + '"' + dis + ' title="Remove"><i class="fa-solid fa-trash"></i></button></div>' +
            '<input data-t="' + i + '" data-tf="description" value="' + esc(t.description || '') + '" placeholder="What this table holds (the AI reads this)" class="desc">' +
            '<div class="row"><label class="fld" style="max-width:190px"><span>Source</span><select data-t="' + i + '" data-tf="kind">' +
            [['apex', 'APEX (app database)'], ['fusion', 'Oracle Fusion'], ['file', 'File (CSV / Parquet / JSON)']].map(function (o) { return '<option value="' + o[0] + '"' + (t.source.kind === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
            '<label class="fld" style="max-width:200px"><span>Load</span><select data-t="' + i + '" data-tf="strategy">' +
                [['full', 'Full every time'], ['incremental', 'Only changed rows'], ['window', 'Last N months']].map(function (o) { return '<option value="' + o[0] + '"' + (t.strategy === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
            '<label class="fld"><span>Key column(s)</span><input data-t="' + i + '" data-tf="key" value="' + esc(t.key.join(', ')) + '" placeholder="e.g. INVOICE_ID"></label>' +
            '<label class="fld"' + (inc ? '' : ' hidden') + '><span>Changed-since column</span><input data-t="' + i + '" data-tf="incrementalColumn" value="' + esc(t.incrementalColumn || '') + '" placeholder="LAST_UPDATE_DATE"></label>' +
            (t.strategy === 'window' ? '<label class="fld"><span>Date column</span><input data-t="' + i + '" data-tf="windowColumn" value="' + esc(t.windowColumn || '') + '" placeholder="ACCOUNTING_DATE"></label>' +
                '<label class="fld" style="max-width:110px"><span>Months</span><input type="number" min="1" max="120" data-t="' + i + '" data-tf="windowMonths" value="' + (t.windowMonths || 3) + '"></label>' : '') +
            '<label class="fld" style="max-width:120px"><span>Rows per call</span><input type="number" data-t="' + i + '" data-tf="pageSize" value="' + (t.pageSize || '') + '" placeholder="' + (t.source.kind === 'fusion' ? '5000' : '1000') + '"></label>' +
            '<label class="fld" style="max-width:150px"><span>Paging</span><select data-t="' + i + '" data-tf="paging">' + [['auto', 'Auto'], ['keyset', 'By key (fast)'], ['rownum', 'Row numbers']].map(function (o) { return '<option value="' + o[0] + '"' + ((t.paging || 'auto') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
            '<label class="chk" style="align-self:end;padding-bottom:8px"><input type="checkbox" data-t="' + i + '" data-tf="countCheck"' + (t.countCheck ? ' checked' : '') + '> Check the row count</label></div>' +
            (t.source.kind === 'file' ? '<label class="fld"><span>File path (on the refresher PC)</span><input data-t="' + i + '" data-tf="path" value="' + esc(t.source.path || '') + '" placeholder="C:\\fusion\\model\\files\\budget.csv"></label>'
                : '<textarea class="sql" data-t="' + i + '" data-tf="sql" spellcheck="false" rows="' + Math.min(12, Math.max(3, String(t.source.sql || '').split('\n').length + 1)) + '" placeholder="SELECT … FROM …">' + esc(t.source.sql || '') + '</textarea>') +
            '</div>';
    });
    h += '<button class="btn" data-act="addtable"' + dis + '><i class="fa-solid fa-plus"></i> Add table</button>';
    h += '<div class="card"><div class="mh"><b>Danger zone</b></div><p class="muted sm">Removing the module deletes its definition; its published files stay until the clean-up removes old versions.</p><button class="btn sm" data-act="rmmodule"' + dis + ' style="color:#b91c1c;align-self:flex-start"><i class="fa-solid fa-trash"></i> Remove module ' + esc(m.name) + '</button></div>';
    $('modmain').innerHTML = h;
}

function markDirty() {
    S.dirty = true;
    var b = document.querySelector('[data-act="save"]'); if (b && b.innerHTML.indexOf('*') < 0) b.innerHTML = b.innerHTML.replace('Save', 'Save *');
}

function saveModel() {
    var bad = [];
    S.model.modules.forEach(function (m) { if (!NAME_RE.test(m.name)) bad.push('module ' + m.name); });
    S.model.tables.forEach(function (t) { if (!NAME_RE.test(t.name)) bad.push('table ' + t.name); });
    if (bad.length) { toast('Names must be lowercase letters, digits and _: ' + bad.join(', ')); return Promise.reject('names'); }
    busy('Saving the model…');
    return fm('fmModelSave', { model: S.model }).then(function () { busy(null); S.dirty = false; toast('Model saved'); return loadAll(); })
        .catch(function (e) { busy(null); toast('Not saved: ' + e); throw e; });
}

function refresh(module, tables, full) {
    var go = S.dirty ? saveModel() : Promise.resolve();
    go.then(function () {
        S.progressLog = S.progressLog || {}; S.progressLog[module] = '';
        var note = function (msg) {
            S.progressLog[module] += msg + '\n';
            var box = $('progress'); if (box && S.cur === module) { box.hidden = false; box.textContent = S.progressLog[module]; box.scrollTop = box.scrollHeight; }
        };
        var log = function (msg) { busy(msg, true); note(msg); };
        log((full ? 'Full reload of ' : 'Refreshing ') + module + (tables ? ' (' + tables.join(', ') + ')' : '') + '…');
        return fm('fmRefresh', { module: module, tables: tables, full: !!full }, log).then(function (d) {
            busy(null);
            var r = d.result || {};
            var summary = 'Published ' + module + ' ' + (r.version || '') + ' in ' + ((r.ms || 0) / 1000).toFixed(1) + ' s — ' + (r.tables || []).map(function (t) { return t.table + ' ' + num(t.rows) + (t.incremental ? ' (' + num(t.loaded) + ' changed)' : ''); }).join(', ');
            note(summary); toast(summary);
            S.schema = [];
            return loadAll().then(function () { if (S.tab === 'log') loadLog(); });
        });
    }).catch(function (e) {
        busy(null);
        if (e === 'names') return;
        toast('Refresh failed: ' + e);
        S.progressLog[module] = (S.progressLog[module] || '') + 'FAILED: ' + e + '\n';
        var box = $('progress'); if (box && S.cur === module) { box.hidden = false; box.textContent = S.progressLog[module]; }
    });
}

function addStarter(key) {
    var st = FM_STARTERS[key]; if (!st) return;
    if (S.model.modules.some(function (m) { return m.name === st.module.name; })) { S.cur = st.module.name; renderModules(); toast('Module ' + st.module.name + ' is already in the model'); return; }
    S.model.modules.push(JSON.parse(JSON.stringify(st.module)));
    st.tables.forEach(function (t) { var c = JSON.parse(JSON.stringify(t)); c.module = st.module.name; S.model.tables.push(c); });
    S.cur = st.module.name; S.dirty = true;
    if (S.isAdmin) saveModel().then(renderModules).catch(function () { renderModules(); }); else renderModules();
}

function newModuleModal() {
    modal('<h2><i class="fa-solid fa-plus"></i> New module</h2><p class="muted">A module is one DuckDB file, e.g. <b>gl</b>, <b>ap</b> or <b>inventory</b>. Tables of different modules can still be joined in queries.</p>' +
        '<div class="row"><label class="fld"><span>Name (file name)</span><input id="nm-name" placeholder="e.g. ap" spellcheck="false"></label><label class="fld"><span>Title</span><input id="nm-title" placeholder="e.g. Payables"></label></div>' +
        '<div class="modal-f"><button class="btn" data-mact="close">Cancel</button><button class="btn primary" data-mact="mkmod"><i class="fa-solid fa-check"></i> Create</button></div>');
}

// ════════════════════════════════ EXPLORE ════════════════════════════════
function loadSchema() {
    $('tree').innerHTML = '<div class="muted pad"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading…</div>';
    return fm('fmQuery', { sql: "SELECT table_catalog AS m, table_name AS t, column_name AS c, data_type AS ty FROM information_schema.columns WHERE table_schema = 'main' ORDER BY 1, 2, ordinal_position", maxRows: 50000 })
        .then(function (d) { S.schema = d.result.rows; renderTree(); })
        .catch(function (e) { $('tree').innerHTML = '<div class="err pad">' + esc(e) + '</div>'; });
}
function renderTree() {
    var q = S.tq.toLowerCase(), mods = {};
    S.schema.forEach(function (r) {
        var hit = !q || (r[0] + '.' + r[1]).toLowerCase().indexOf(q) >= 0 || String(r[2]).toLowerCase().indexOf(q) >= 0;
        if (!hit) return;
        mods[r[0]] = mods[r[0]] || {}; (mods[r[0]][r[1]] = mods[r[0]][r[1]] || []).push(r);
    });
    var names = Object.keys(mods);
    $('tree').innerHTML = names.length ? names.map(function (m) {
        return '<details class="tmod" open><summary><i class="fa-solid fa-database"></i> ' + esc(m) + '</summary>' + Object.keys(mods[m]).map(function (t) {
            return '<details class="ttab"' + (q ? ' open' : '') + '><summary><i class="fa-solid fa-table"></i> ' + esc(t) + ' <button class="btn sm" data-act="qtable" data-q="' + esc(m + '.' + t) + '" title="Query this table" style="margin-left:auto;padding:2px 6px"><i class="fa-solid fa-play"></i></button></summary>' +
                mods[m][t].map(function (r) { return '<div class="tcol" data-ins="' + esc(r[2]) + '"><span>' + esc(r[2]) + '</span><small>' + esc(r[3]) + '</small></div>'; }).join('') + '</details>';
        }).join('') + '</details>';
    }).join('') : '<div class="muted pad">' + (S.schema.length ? 'No match.' : 'Nothing loaded yet — refresh a module first.') + '</div>';
}
function insertAtCursor(text) {
    var ta = $('sql'), a = ta.selectionStart, b = ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b); ta.focus(); ta.selectionStart = ta.selectionEnd = a + text.length;
}
function runQuery() {
    var sql = $('sql').value.trim(); if (!sql) return;
    $('qinfo').textContent = 'running…';
    var t0 = Date.now();
    fm('fmQuery', { sql: sql, maxRows: +$('maxrows').value || 1000 }).then(function (d) {
        S.last = d.result; renderGrid(d.result);
        $('qinfo').textContent = num(d.result.rows.length) + ' rows' + (d.result.capped ? ' (more not shown)' : '') + ' · ' + d.result.ms + ' ms in DuckDB · ' + (Date.now() - t0) + ' ms total';
    }).catch(function (e) { $('qinfo').textContent = ''; $('grid').innerHTML = '<div class="err pad">' + esc(e) + '</div>'; });
}
function isNumType(t) { return /INT|DOUBLE|FLOAT|DECIMAL|NUMERIC|REAL/i.test(t || ''); }
function renderGrid(r) {
    if (!r.columns.length) { $('grid').innerHTML = '<div class="muted pad">No columns.</div>'; return; }
    var nums = r.columns.map(function (c) { return isNumType(c.type); });
    var h = '<table><thead><tr>' + r.columns.map(function (c) { return '<th>' + esc(c.name) + '<small>' + esc(c.type) + '</small></th>'; }).join('') + '</tr></thead><tbody>';
    var max = Math.min(r.rows.length, 5000);
    for (var i = 0; i < max; i++) {
        h += '<tr>' + r.rows[i].map(function (v, j) {
            return v == null ? '<td class="null">null</td>' : '<td' + (nums[j] ? ' class="n"' : '') + ' title="' + esc(v) + '">' + esc(nums[j] && typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 6 }) : v) + '</td>';
        }).join('') + '</tr>';
    }
    h += '</tbody></table>' + (r.rows.length > max ? '<div class="muted pad">Showing the first ' + num(max) + ' of ' + num(r.rows.length) + ' rows — download the CSV for all.</div>' : '');
    $('grid').innerHTML = h;
}
function downloadCsv() {
    var r = S.last; if (!r) { toast('Run a query first'); return; }
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var text = [r.columns.map(function (c) { return q(c.name); }).join(',')].concat(r.rows.map(function (row) { return row.map(q).join(','); })).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv' })); a.download = 'fusion_model_query.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ════════════════════════════════ REFRESH CENTER ════════════════════════════════
/** When the refresher runs this module next (same rules as the engine's scheduler). */
function nextRun(sched, lastIso) {
    var mode = (sched && sched.mode || 'MANUAL').toUpperCase(), last = lastIso ? new Date(lastIso) : null, now = new Date();
    if (mode === 'HOURLY') return last ? new Date(Math.max(now.getTime(), last.getTime() + 58 * 60000)) : now;
    if (mode !== 'DAILY') return null;
    var hm = String(sched.time || '06:00').split(':'), slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +hm[0] || 0, +hm[1] || 0);
    if (now < slot) slot.setDate(slot.getDate() - 1);
    return !last || last < slot ? now : new Date(slot.getTime() + 86400000);
}
function whenText(d) {
    if (!d) return 'manual only';
    var m = Math.round((d - Date.now()) / 60000);
    return m <= 0 ? 'due now' : m < 60 ? 'in ' + m + ' min' : m < 1440 ? 'at ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString();
}
function renderRefreshCenter() {
    var st = S.status || {}, s = st.settings || {}, mods = st.modules || [];
    var dis = S.isAdmin ? '' : ' disabled';
    $('rc-mods').innerHTML = '<div class="card rc-head"><div class="row">' +
        '<span><b>Refresher</b> ' + (s.isRefresher ? 'this PC (' + esc(st.machine) + ')' : 'another PC — this PC only reads') + '</span>' +
        '<span><b>Running now</b> ' + (st.lease ? esc(st.lease.machine) + ' since ' + new Date(st.lease.acquiredUtc).toLocaleTimeString() : st.building ? esc(st.building) : 'nothing') + '</span>' +
        '<span><b>Read mode</b> ' + (s.readMode === 'DIRECT' ? 'shared folder' : 'local copy') + '</span></div></div>' +
        (mods.length ? '<div class="rc-grid">' + mods.map(function (m) {
            var nr = nextRun(m.schedule, m.publishedUtc), rows = (m.tables || []).reduce(function (a, t) { return a + (t.rows || 0); }, 0);
            var failed = (m.tables || []).some(function (t) { return (t.drift || []).length; });
            return '<div class="card rc-mod"><div class="mh"><b>' + esc(m.title || m.name) + '</b><small class="muted">' + esc(m.name) + '</small></div>' +
                '<div class="kv"><b>Published</b><span>' + (m.version ? ago(m.publishedUtc) + ' · ' + esc(m.version) : 'never') + '</span>' +
                '<b>Rows</b><span>' + num(rows) + ' in ' + (m.tables || []).length + ' tables · ' + size(m.bytes) + '</span>' +
                '<b>Schedule</b><span>' + esc((m.schedule || {}).mode === 'DAILY' ? 'daily at ' + m.schedule.time : ((m.schedule || {}).mode || 'MANUAL').toLowerCase()) + '</span>' +
                '<b>Next run</b><span>' + (s.isRefresher || !nr ? whenText(nr) : whenText(nr) + ' (on the refresher PC)') + '</span></div>' +
                (failed ? '<p class="warn-t sm"><i class="fa-solid fa-triangle-exclamation"></i> Column changes in the last load — see Table health.</p>' : '') +
                '<div class="row"><button class="btn sm primary" data-act="rcrefresh" data-m="' + esc(m.name) + '"' + dis + '><i class="fa-solid fa-rotate"></i> Refresh</button>' +
                '<button class="btn sm" data-mod="' + esc(m.name) + '" data-act="open"><i class="fa-solid fa-pen"></i> Edit</button></div></div>';
        }).join('') + '</div>' : '<div class="muted pad">No modules yet.</div>');
    var rows = [];
    mods.forEach(function (m) { (m.tables || []).forEach(function (t) { rows.push({ m: m.name, t: t }); }); });
    $('rc-tables').innerHTML = rows.length ? '<table class="tbl-log"><tr><th>Table</th><th>Load</th><th>Paging</th><th>Rows</th><th>Last load</th><th>Loaded</th><th>Time</th><th>Rows/s</th><th>Count check</th><th>Column changes</th></tr>' + rows.map(function (x) {
        var t = x.t, cc = t.sourceCount == null ? (t.countCheck ? '<span class="muted">—</span>' : '<span class="muted">off</span>')
            : t.sourceCount === t.lastLoadedRows ? '<span class="st OK">' + num(t.sourceCount) + ' ✓</span>' : '<span class="st FAILED">source ' + num(t.sourceCount) + '</span>';
        return '<tr><td><b>' + esc(x.m) + '.' + esc(t.name) + '</b><br><small class="muted">' + esc(t.source || '') + '</small></td><td>' + esc((t.lastMode || '—')) + '<br><small class="muted">' + esc(String(t.strategy || '').toLowerCase()) + '</small></td>' +
            '<td>' + esc(t.paging || '') + '</td><td>' + num(t.rows) + '</td><td>' + ago(t.loadedUtc) + '</td><td>' + num(t.lastLoadedRows) + '</td>' +
            '<td>' + (t.lastMs != null ? (t.lastMs / 1000).toFixed(1) + ' s' : '—') + '</td><td>' + (t.rowsPerSecond != null ? num(Math.round(t.rowsPerSecond)) : '—') + '</td><td>' + cc + '</td>' +
            '<td>' + ((t.drift || []).length ? '<span class="warn-t">' + t.drift.map(esc).join('<br>') + '</span>' : '<span class="muted">none</span>') + '</td></tr>';
    }).join('') + '</table>' : '<div class="muted pad">Nothing loaded yet.</div>';
}

// ════════════════════════════════ LOG + SETTINGS ════════════════════════════════
function loadLog() {
    renderRefreshCenter();
    $('logbox').innerHTML = '<div class="muted pad"><i class="fa-solid fa-circle-notch fa-spin"></i></div>';
    fm('fmLog', { last: 200 }).then(function (d) {
        var e = d.entries || [];
        $('logbox').innerHTML = e.length ? '<table class="tbl-log"><tr><th>When</th><th>Module</th><th>Table</th><th>Status</th><th>Rows</th><th>Loaded</th><th>Time</th><th>By</th><th>Detail</th></tr>' + e.map(function (x) {
            return '<tr><td>' + esc(new Date(x.at).toLocaleString()) + '</td><td>' + esc(x.module || '') + '</td><td>' + esc(x.table || '') + '</td><td><span class="st ' + (x.status === 'FAILED' ? 'FAILED' : x.status === 'CANCELLED' ? 'RUNNING' : 'OK') + '">' + esc(x.status) + '</span></td>' +
                '<td>' + (x.rows != null ? num(x.rows) : '') + '</td><td>' + (x.loaded != null ? num(x.loaded) + (x.incremental ? ' changed' : '') : '') + '</td><td>' + (x.ms != null ? (x.ms / 1000).toFixed(1) + ' s' : '') + '</td>' +
                '<td>' + esc(x.by || '') + ' <small class="muted">' + esc(x.machine || '') + '</small></td><td>' + esc(x.error || x.version || '') + (x.mode ? ' <small class="muted">' + esc(x.mode) + '</small>' : '') +
                (x.notes ? '<br><small class="warn-t">' + x.notes.map(esc).join('<br>') + '</small>' : '') + (x.drift ? '<br><small class="warn-t">columns: ' + x.drift.map(esc).join('; ') + '</small>' : '') + '</td></tr>';
        }).join('') + '</table>' : '<div class="muted pad">No refreshes yet.</div>';
    }).catch(function (e) { $('logbox').innerHTML = '<div class="err pad">' + esc(e) + '</div>'; });
}

function renderSettings() {
    var st = S.status || {}, s = st.settings || {}, dis = S.isAdmin ? '' : ' disabled';
    $('setup').innerHTML = '<div class="card"><h3><i class="fa-solid fa-folder-tree"></i> Where the model lives</h3>' +
        '<p class="muted sm">Every PC points at the same shared folder. It holds <code>model.json</code> (the definitions), <code>manifest.json</code> (the current version of each module) and <code>modules\\*.duckdb</code>.</p>' +
        '<div class="row"><label class="fld grow"><span>Shared folder</span><input id="s-root" class="mono" value="' + esc(s.sharedRoot || '') + '" placeholder="\\\\server\\GraysData\\model"' + dis + '></label></div>' +
        '<div class="row"><label class="fld"><span>This PC reads</span><select id="s-mode"' + dis + '><option value="CACHE"' + (s.readMode !== 'DIRECT' ? ' selected' : '') + '>A local copy (fast; copied when a new version is published)</option><option value="DIRECT"' + (s.readMode === 'DIRECT' ? ' selected' : '') + '>Straight from the shared folder (no local disk)</option></select></label>' +
        '<label class="fld" style="max-width:160px"><span>Keep old versions (hours)</span><input id="s-retain" type="number" min="1" value="' + (s.retainHours || 6) + '"' + dis + '></label></div>' +
        '<label class="chk"><input type="checkbox" id="s-ref"' + (s.isRefresher ? ' checked' : '') + dis + '> <b>This PC is the refresher</b> — it runs the scheduled refreshes and publishes new versions (choose one always-on PC)</label>' +
        '<div class="kv"><b>Local copy folder</b><span class="mono">' + esc(s.cacheRoot || '') + '</span><b>This PC</b><span>' + esc(st.machine || '') + '</span>' +
        '<b>Shared folder</b><span>' + (st.sharedReachable ? '<span style="color:#15803d">reachable</span>' : '<span class="err">not reachable</span>') + '</span>' +
        '<b>Refresh running</b><span>' + (st.lease ? esc(st.lease.machine) + ' since ' + new Date(st.lease.acquiredUtc).toLocaleTimeString() : st.building ? esc(st.building) : 'no') + '</span></div>' +
        '<div class="row">' + (S.isAdmin ? '<button class="btn primary" data-act="savecfg"><i class="fa-solid fa-floppy-disk"></i> Save</button>' : '<span class="pill warn">Only AI admins can change these settings.</span>') +
        '<button class="btn" data-act="sync"><i class="fa-solid fa-download"></i> Copy the latest versions now</button></div></div>';
}
function saveSettings() {
    var s = Object.assign({}, (S.status || {}).settings || {}, {
        sharedRoot: $('s-root').value.trim(), readMode: $('s-mode').value, isRefresher: $('s-ref').checked, retainHours: +$('s-retain').value || 6
    });
    busy('Saving…');
    fm('fmSettingsSave', { settings: s }).then(function () { busy(null); toast('Settings saved'); S.schema = []; return loadAll(); }).then(renderSettings)
        .catch(function (e) { busy(null); toast(String(e)); });
}

// ════════════════════════════════ EVENTS ════════════════════════════════
document.addEventListener('click', function (e) {
    var b = e.target.closest('button, [data-mod], .tcol');
    if (!b) { if (e.target.id === 'modal') modal(null); return; }
    var d = b.dataset;
    if (d.tab) return showTab(d.tab);
    if (d.mod) { if (S.dirty && S.cur !== d.mod && !confirm('Discard unsaved changes?')) return; if (S.cur !== d.mod && S.dirty) { S.dirty = false; loadAll(); } S.cur = d.mod; if (S.tab !== 'modules') showTab('modules'); else renderModules(); return; }
    if (d.ins) return insertAtCursor(d.ins);
    if (d.mact === 'close') return modal(null);
    if (d.mact === 'mkmod') {
        var name = $('nm-name').value.trim().toLowerCase(), title = $('nm-title').value.trim();
        if (!NAME_RE.test(name)) { toast('Name: lowercase letters, digits and _ (start with a letter)'); return; }
        if (S.model.modules.some(function (m) { return m.name === name; })) { toast('That module exists'); return; }
        S.model.modules.push({ name: name, title: title || name, schedule: { mode: 'MANUAL', time: '06:00' } });
        S.cur = name; modal(null); markDirty(); renderModules(); return;
    }
    var t = d.t != null ? +d.t : null, m = S.model && S.model.modules.find(function (x) { return x.name === S.cur; });
    switch (d.act) {
        case 'reload': return loadAll();
        case 'starter': return addStarter(d.key);
        case 'addmodule': return newModuleModal();
        case 'save': return saveModel().catch(function () { });
        case 'refresh': return refresh(S.cur, null, false);
        case 'rcrefresh': return refresh(d.m, null, false);
        case 'full': return confirm('Reload every table of ' + S.cur + ' in full?') && refresh(S.cur, null, true);
        case 'rtable': return refresh(S.cur, [S.model.tables[t].name], false);
        case 'cancel': return host('fmCancel').catch(function () { });
        case 'explore': showTab('explore'); $('sql').value = 'SELECT * FROM ' + S.cur + '.' + S.model.tables[t].name + ' LIMIT 100'; return runQuery();
        case 'addtable':
            S.model.tables.push({ module: S.cur, name: 'table' + (S.model.tables.filter(function (x) { return x.module === S.cur; }).length + 1), description: '', source: { kind: 'apex', sql: '' }, strategy: 'full', key: [] });
            markDirty(); return renderModule();
        case 'rmtable': if (confirm('Remove table ' + S.model.tables[t].name + ' from the model?')) { S.model.tables.splice(t, 1); markDirty(); renderModule(); } return;
        case 'rmmodule':
            if (!confirm('Remove module ' + S.cur + ' and its table definitions?')) return;
            S.model.modules = S.model.modules.filter(function (x) { return x.name !== S.cur; });
            S.model.tables = S.model.tables.filter(function (x) { return x.module !== S.cur; });
            S.cur = null; markDirty(); saveModel().then(function () { $('modmain').innerHTML = ''; renderModules(); }).catch(function () { }); return;
        case 'schema': S.schema = []; return loadSchema();
        case 'qtable': e.preventDefault(); $('sql').value = 'SELECT * FROM ' + d.q + ' LIMIT 100'; return runQuery();
        case 'run': return runQuery();
        case 'csv': return downloadCsv();
        case 'log': return loadLog();
        case 'savecfg': return saveSettings();
        case 'sync': busy('Copying…'); return fm('fmSync').then(function (r) { busy(null); toast((r.copied || []).length ? 'Copied ' + r.copied.join(', ') : 'Already up to date'); S.schema = []; return loadAll(); }).then(renderSettings).catch(function (x) { busy(null); toast(String(x)); });
    }
});
document.addEventListener('input', function (e) {
    var x = e.target, d = x.dataset;
    if (x.id === 'tq') { S.tq = x.value; renderTree(); return; }
    if (!S.model) return;
    var m = S.model.modules.find(function (y) { return y.name === S.cur; });
    if (d.mf && m) {
        if (d.mf === 'title' || d.mf === 'description') m[d.mf] = x.value;
        else if (d.mf === 'schedTime') m.schedule.time = x.value;
        markDirty(); return;
    }
    if (d.tf != null && d.t != null) {
        var t = S.model.tables[+d.t];
        if (d.tf === 'sql' || d.tf === 'path') t.source[d.tf] = x.value;
        else if (d.tf === 'key') t.key = x.value.split(',').map(function (k) { return k.trim(); }).filter(Boolean);
        else if (d.tf === 'pageSize') t.pageSize = +x.value || 0;
        else if (d.tf === 'windowMonths') t.windowMonths = +x.value || 3;
        else if (d.tf === 'paging' || d.tf === 'countCheck') return;
        else if (d.tf === 'name') t.name = x.value.trim().toLowerCase();
        else if (d.tf !== 'kind' && d.tf !== 'strategy') t[d.tf] = x.value;
        markDirty();
    }
});
document.addEventListener('change', function (e) {
    var x = e.target, d = x.dataset;
    if (!S.model) return;
    var m = S.model.modules.find(function (y) { return y.name === S.cur; });
    if (d.mf === 'schedMode' && m) { m.schedule.mode = x.value; markDirty(); renderModule(); return; }
    if (d.t != null && (d.tf === 'kind' || d.tf === 'strategy')) {
        var t = S.model.tables[+d.t];
        if (d.tf === 'kind') t.source.kind = x.value; else t.strategy = x.value;
        markDirty(); renderModule();
    } else if (d.t != null && d.tf === 'paging') { S.model.tables[+d.t].paging = x.value; markDirty(); }
    else if (d.t != null && d.tf === 'countCheck') { S.model.tables[+d.t].countCheck = x.checked; markDirty(); }
});
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('modal').hidden) modal(null);
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.id === 'sql') { e.preventDefault(); runQuery(); }
});
window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

(function start() {
    if (!hasHost()) { $('modmain').innerHTML = '<div class="empty"><h2>Open this page inside the Gray\'s WMS app.</h2></div>'; return; }
    var q = new URLSearchParams(location.search);
    loadAll().then(function () {
        if (!(S.status || {}).sharedReachable) { showTab('settings'); toast('Set the shared folder first'); return; }
        if (q.get('module')) S.cur = q.get('module');
        showTab(q.get('tab') || 'modules');
        if (q.get('sql')) { showTab('explore'); $('sql').value = q.get('sql'); runQuery(); }
    });
})();
