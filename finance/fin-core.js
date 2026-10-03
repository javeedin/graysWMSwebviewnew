/* Finance Lens — core: host bridge (fin* actions, classes/Form1_FinanceHandlers.cs), state, filters, data, documents,
   UI helpers, charts and the drill path statement cell → accounts → company / cost centre / period → journal lines. */
var FL = window.FL = {
    TABS: {}, tab: 'overview', who: { admin: false }, status: null,
    dims: { companies: [], ccs: [], accounts: [], periods: [], ledgers: [], ledgerCompanies: [] },
    templates: [], config: null, filter: { company: '', cc: '', ledger: '', period: null, scale: 1000 },
    cache: {}, charts: {}
};
FL.PAL = { act: '#1d4ed8', bud: '#94a3b8', py: '#f59e0b', good: '#16a34a', bad: '#dc2626', series: ['#1d4ed8', '#0d9488', '#f59e0b', '#7c3aed', '#dc2626', '#0891b2', '#65a30d', '#db2777'] };

// ── helpers ──
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function hasHost() { return !!(window.chrome && window.chrome.webview); }
function appUser() { try { return sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || ''; } catch (e) { return ''; } }
FL.toast = function (msg, kind) {
    var d = document.createElement('div'); d.className = 'toast ' + (kind || ''); d.textContent = msg; $('toasts').appendChild(d);
    setTimeout(function () { d.remove(); }, kind === 'err' ? 7000 : 3500);
};
FL.ls = function (k, d) { try { var v = localStorage.getItem('finlens.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
FL.lsSet = function (k, v) { try { localStorage.setItem('finlens.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
FL.q = function (s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; };
FL.compact = function (v) {
    if (v == null || isNaN(v)) return '—';
    var a = Math.abs(v), s = a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : a.toFixed(0);
    return (v < 0 ? '−' : '') + s;
};
FL.kfmt = function (v, f) {
    if (v == null || isNaN(v)) return '—';
    if (f === 'money') return FL.compact(v);
    return FINE.fmt(v, f === 'num' ? 'num' : f, { paren: false });
};
/** A KPI change: points for %, × for ratios */
FL.kdelta = function (d, f) {
    if (d == null || isNaN(d)) return '';
    var a = Math.abs(d);
    return (d >= 0 ? '▲ ' : '▼ ') + (f === 'pct' ? a.toFixed(1) + ' pts' : f === 'ratio' ? a.toFixed(2) + '×' : f === 'days' ? Math.round(a) + ' d' : FL.compact(a));
};
FL.num = function (v, d) { return FINE.fmt(v / (FL.filter.scale || 1), 'num', { decimals: d }); };
FL.scaleLabel = function () { return { 1: 'units', 1000: 'thousands', 1000000: 'millions' }[FL.filter.scale] || ''; };

// ── host bridge ──
var _pending = {};
/** onProgress(message) receives the host's finProgress lines for this request (Fusion sync, Copilot). */
FL.host = function (action, payload, ms, onProgress) {
    return new Promise(function (resolve, reject) {
        if (!hasHost()) { reject('Open Finance Lens inside the Gray\'s WMS app.'); return; }
        var id = 'fl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        _pending[id] = { resolve: resolve, reject: reject, progress: onProgress };
        setTimeout(function () { if (_pending[id]) { delete _pending[id]; reject('The app did not answer (' + action + ').'); } }, ms || 120000);
        window.chrome.webview.postMessage(Object.assign({ action: action, requestId: id, appUser: appUser() }, payload || {}));
    });
};
if (hasHost()) window.chrome.webview.addEventListener('message', function (ev) {
    var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
    if (!r || !r.requestId || !_pending[r.requestId]) return;
    if (r.action === 'finProgress') { var p = _pending[r.requestId].progress; if (p) { try { p(r.message); } catch (e) { /* view gone */ } } return; }
    var cb = _pending[r.requestId]; delete _pending[r.requestId];
    if (r.action === 'error') cb.reject(r.message || 'Host error'); else cb.resolve(r.data == null ? r : r.data);
});
FL.call = function (action, payload, ms, onProgress) { return FL.host(action, payload, ms, onProgress).then(function (d) { if (d && d.ok === false) throw d.error || 'failed'; return d; }); };
/** One read-only query → {columns, rows} */
FL.sql = function (sql, max) { return FL.call('finQuery', { sql: sql, maxRows: max || 50000 }); };
/** Rows as objects keyed by column name */
FL.rows = function (sql, max) { return FL.sql(sql, max).then(function (d) { return d.rows.map(function (r) { var o = {}; d.columns.forEach(function (c, i) { o[c] = r[i]; }); return o; }); }); };

// ── filters → SQL ──
FL.where = function (alias, opts) {
    opts = opts || {};
    var p = alias ? alias + '.' : '', w = [];
    if (FL.filter.ledger && !opts.noLedger) w.push(p + 'ledger = ' + FL.q(FL.filter.ledger));
    if (FL.filter.company && !opts.noCompany) w.push(p + 'company = ' + FL.q(FL.filter.company));
    if (FL.filter.cc && !opts.noCc) w.push(p + 'cost_centre = ' + FL.q(FL.filter.cc));
    return w;
};
FL.filterText = function () {
    var led = FL.filter.ledger ? (FL.dims.ledgers.filter(function (l) { return l.code === FL.filter.ledger; })[0] || {}) : null;
    var co = FL.filter.company ? (FL.dims.companies.filter(function (c) { return c.code === FL.filter.company; })[0] || {}).name || FL.filter.company
        : (led ? led.name + ' (' + led.currency + ')' : FL.dims.ledgers.length > 1 ? 'All ledgers' : 'All companies (consolidated)');
    var cc = FL.filter.cc ? ' · cost centre ' + FL.filter.cc + ' ' + ((FL.dims.ccs.filter(function (c) { return c.code === FL.filter.cc; })[0] || {}).name || '') : '';
    return co + cc;
};
FL.periodName = function (seq) { var p = FL.dims.periods.filter(function (x) { return x.period_seq === +seq; })[0]; return p ? p.period_name : seq; };

/** FINE data for the current filter (cached): {accounts, periods, facts} */
FL.data = function (extraWhere, key) {
    var w = FL.where('').concat(extraWhere || []);
    var k = key || w.join(' AND ');
    if (FL.cache[k]) return Promise.resolve(FL.cache[k]);
    return FL.sql('SELECT scenario, account, period_seq, SUM(period_net) AS net, SUM(end_bal) AS end_bal FROM fin_balances' + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' GROUP BY ALL', 500000).then(function (d) {
        var data = { accounts: FL.dims.accounts, periods: FL.dims.periods, facts: FINE.factsFrom(d.rows) };
        FL.cache[k] = data;
        return data;
    });
};
FL.tpl = function (id) { return FL.templates.filter(function (t) { return t.id === id; })[0]; };
FL.tplMap = function () { var m = {}; FL.templates.forEach(function (t) { m[t.id] = t; }); return m; };

// ── documents ──
FL.loadDocs = function () {
    return Promise.all([FL.call('finDocGet', { name: 'templates' }), FL.call('finDocGet', { name: 'config' })]).then(function (r) {
        var t = null, c = null;
        try { t = r[0].json ? JSON.parse(r[0].json) : null; } catch (e) { FL.toast('templates.json is not valid JSON — using the starters', 'err'); }
        try { c = r[1].json ? JSON.parse(r[1].json) : null; } catch (e) { FL.toast('config.json is not valid JSON — using the starters', 'err'); }
        FL.templatesSaved = !!(t && t.templates && t.templates.length);
        FL.templates = (FL.templatesSaved ? t.templates : JSON.parse(JSON.stringify(FIN_SEED.templates)));
        FL.config = Object.assign(JSON.parse(JSON.stringify(FIN_SEED.config)), c || {});
    });
};
FL.saveTemplates = function () { return FL.call('finDocSave', { name: 'templates', json: JSON.stringify({ version: 1, templates: FL.templates }, null, 1) }); };
/** Accounts without a class (Fusion loads) get one from their type and name; your choices (config.accountClass) win.
    The classes are written back to fin_accounts so SQL, the journal tests and the Copilot see them too. */
FL.classifyAccounts = function () {
    var over = (FL.config && FL.config.accountClass) || {}, changed = {}, n = 0;
    FL.dims.accounts.forEach(function (a) {
        var want = over[a.code] || a.class || FINE.classify(a);
        if (over[a.code] && a.class !== over[a.code]) want = over[a.code];
        if (want !== a.class) { a.class = want; changed[a.code] = want; n++; }
    });
    if (n) FL.call('finSetClasses', { classes: changed, source: 'AUTO' }, 120000).then(function () { FL.cache = {}; }).catch(function (e) { console.warn('[Finance] classes not saved', e); });
    return n;
};
FL.saveConfig = function () { return FL.call('finDocSave', { name: 'config', json: JSON.stringify(FL.config, null, 1) }); };

// ── start ──
FL.init = function () {
    document.querySelectorAll('#tabs button[data-tab]').forEach(function (b) { b.onclick = function () { FL.show(b.dataset.tab); }; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') FL.closeModal(); });
    $('b-pack').onclick = function () { FL.packDialog(); };
    $('b-ask').onclick = function () { FL.copilot.toggle(); };
    if (!hasHost()) { $('main').innerHTML = '<div class="empty"><i class="fa-solid fa-plug-circle-xmark"></i>Open Finance Lens inside the Gray\'s WMS app.</div>'; return; }
    FL.call('finWho').then(function (w) { FL.who = w; }).catch(function () { /* older host */ });
    FL.refresh();
};
FL.refresh = function () {
    FL.cache = {};
    return FL.call('finStatus').then(function (st) {
        FL.status = st;
        if (!st.loaded) { FL.dataChip(); return FL.loadDocs().catch(function () { /* first run */ }).then(function () { if (FL.tab === 'data') FL.render(); else FL.welcome(); }); }
        return Promise.all([
            FL.rows('SELECT code, name, currency FROM fin_companies ORDER BY code'),
            FL.rows('SELECT code, name FROM fin_cost_centres ORDER BY code'),
            FL.rows('SELECT code, name, account_type, class FROM fin_accounts ORDER BY code', 100000),
            FL.rows('SELECT period_name, period_seq, fiscal_year, period_num, quarter FROM fin_periods ORDER BY period_seq'),
            FL.loadDocs(),
            st.hasLedgers ? FL.rows('SELECT code, name, currency, coa_id, company_segment, cost_centre_segment, account_segment, category FROM fin_ledgers ORDER BY code') : Promise.resolve([]),
            st.hasLedgers ? FL.rows('SELECT DISTINCT ledger, company FROM fin_balances') : Promise.resolve([])
        ]).then(function (r) {
            FL.dims = { companies: r[0], ccs: r[1], accounts: r[2], periods: r[3], ledgers: r[5], ledgerCompanies: r[6] };
            FL.classifyAccounts();
            if (!FL.templatesSaved) FL.toast('Statements built from your chart of accounts by account class — adjust in Data › Account mapping or the Template designer.', 'ok');
            FL.fillFilters();
            FL.dataChip();
            FL.show(FL.ls('tab', 'overview'));
            if (FL.fusion && FL.fusion.pullMapping && (st.meta || {}).source === 'FUSION') FL.fusion.pullMapping();
        });
    }).catch(function (e) { $('main').innerHTML = '<div class="callout bad">' + esc(e) + '</div>'; });
};
FL.dataChip = function () {
    var s = FL.status || {}, m = s.meta || {}, c = s.counts || {};
    $('datachip').innerHTML = s.loaded ? '<i class="fa-solid fa-database"></i> ' + esc(m.source || '?') + ' · ' + (c.journals || 0).toLocaleString() + ' journal lines · ' + esc(c.first_period || '') + ' – ' + esc(c.last_period || '')
        : '<i class="fa-solid fa-triangle-exclamation"></i> no data loaded';
};
FL.fillFilters = function () {
    var f = FL.filter, saved = FL.ls('filter', {});
    var per = FL.dims.periods.slice().reverse();
    $('f-period').innerHTML = per.map(function (p) { return '<option value="' + p.period_seq + '">' + esc(p.period_name) + '</option>'; }).join('');
    $('f-company').innerHTML = '<option value="">All (consolidated)</option>' + FL.dims.companies.map(function (c) { return '<option value="' + esc(c.code) + '">' + esc(c.code + ' ' + c.name) + '</option>'; }).join('');
    var leds = FL.dims.ledgers || [];
    $('l-ledger').style.display = leds.length > 1 ? '' : 'none';
    $('f-ledger').innerHTML = '<option value="">All ledgers</option>' + leds.map(function (l) { return '<option value="' + esc(l.code) + '">' + esc(l.name + ' · ' + l.currency) + '</option>'; }).join('');
    $('f-cc').innerHTML = '<option value="">All cost centres</option>' + FL.dims.ccs.map(function (c) { return '<option value="' + esc(c.code) + '">' + esc(c.code + ' ' + c.name) + '</option>'; }).join('');
    f.period = per.some(function (p) { return p.period_seq === saved.period; }) ? saved.period : (per[0] || {}).period_seq;
    f.company = FL.dims.companies.some(function (c) { return c.code === saved.company; }) ? saved.company : '';
    f.cc = FL.dims.ccs.some(function (c) { return c.code === saved.cc; }) ? saved.cc : '';
    f.scale = saved.scale || 1000;
    var ccys = {}; leds.forEach(function (l) { ccys[l.currency] = 1; });
    FL.mixedCurrency = Object.keys(ccys).length > 1;
    f.ledger = leds.some(function (l) { return l.code === saved.ledger; }) ? saved.ledger : (FL.mixedCurrency ? leds[0].code : '');   // never add up different currencies by default
    var coOptions = function () {
        var allow = null;
        if (f.ledger) { allow = {}; (FL.dims.ledgerCompanies || []).forEach(function (x) { if (x.ledger === f.ledger) allow[x.company] = 1; }); }
        $('f-company').innerHTML = '<option value="">' + (f.ledger ? 'All companies of the ledger' : 'All (consolidated)') + '</option>' +
            FL.dims.companies.filter(function (c) { return !allow || allow[c.code]; }).map(function (c) { return '<option value="' + esc(c.code) + '">' + esc(c.code + ' ' + c.name) + '</option>'; }).join('');
        if (allow && f.company && !allow[f.company]) f.company = '';
        $('f-company').value = f.company;
    };
    coOptions();
    $('f-period').value = f.period; $('f-ledger').value = f.ledger; $('f-cc').value = f.cc; $('f-scale').value = f.scale;
    var on = function (e) {
        f.period = +$('f-period').value; f.ledger = $('f-ledger').value; f.company = $('f-company').value; f.cc = $('f-cc').value; f.scale = +$('f-scale').value;
        if (e && e.target && e.target.id === 'f-ledger') coOptions();
        FL.lsSet('filter', f); FL.cache = {}; FL.render();
    };
    ['f-period', 'f-ledger', 'f-company', 'f-cc', 'f-scale'].forEach(function (id) { $(id).onchange = on; });
};
FL.show = function (tab) {
    if (!FL.TABS[tab]) tab = 'overview';
    FL.tab = tab; FL.lsSet('tab', tab);
    document.querySelectorAll('#tabs button[data-tab]').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    FL.render();
};
FL.render = function () {
    if (!FL.status || !FL.status.loaded) { if (FL.tab === 'data' && FL.TABS.data) FL.TABS.data.render($('main')); else FL.welcome(); return; }
    Object.keys(FL.charts).forEach(function (k) { try { FL.charts[k].destroy(); } catch (e) { /* gone */ } });
    FL.charts = {};
    var t = FL.TABS[FL.tab], el = $('main');
    el.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Working…</div>';
    Promise.resolve().then(function () { return t.render(el); }).then(function () {
        if (FL.mixedCurrency && !FL.filter.ledger && !FL.filter.company && FL.tab !== 'data')
            el.insertAdjacentHTML('afterbegin', '<div class="callout warn"><i class="fa-solid fa-coins"></i> The ledgers have different currencies — these totals add them up as if they were one. Pick a ledger in the header.</div>');
    }).catch(function (e) { console.error(e); el.innerHTML = '<div class="callout bad"><b>Could not show this view.</b><br>' + esc(e && e.message || e) + '</div>'; });
};
FL.welcome = function () {
    var admin = FL.who && FL.who.admin, old = FL.status && FL.status.oldSample;
    $('main').innerHTML = '<div class="hero"><div><h2>Finance Lens</h2><div>Financial statements, KPIs, monitoring, analytics and board packs — built on your Oracle Fusion general ledger balances (ledger × company × cost centre × account × period), stored in a fast DuckDB file on this PC.</div>' +
        '<ul><li>Ledgers, chart of accounts segments (balancing, natural account, cost centre) and account types found for you</li><li>Income statement, balance sheet, cash flow and trial balance — every number drills to accounts, cost centres and journal lines</li>' +
        '<li>40 KPIs and ratios with trends, covenant monitors, anomaly detection, Benford and journal-risk tests, close checks</li><li>Month-by-month sync status against Fusion, one-click board pack, CFO Copilot</li></ul></div>' +
        '<div class="card" style="color:var(--ink)"><h3><i class="fa-solid fa-cloud-arrow-down"></i> Connect your Oracle Fusion general ledger</h3>' +
        '<p class="sm">Discover finds the ledgers, the chart of accounts segments and the account types; then load the GL balances and journals — month by month through Fusion SQL, or everything at once from BICC extracts.</p>' +
        (old ? '<div class="callout warn sm">This PC still holds the old built-in sample data — it is not shown.' + (admin ? ' <a onclick="FL.clearData()">Remove it</a>' : '') + '</div>' : '') +
        (admin ? '<button class="btn primary" onclick="FL.dataTab && (FL.dataTab.view = \'setup\'); FL.show(\'data\')"><i class="fa-solid fa-plug"></i> Connect to Fusion</button>'
            : '<div class="callout warn">An AI admin connects Finance Lens to Fusion on this PC.</div>') + '</div></div>';
};
/** Removes the finance data file (setup, templates and mapping stay) */
FL.clearData = function () {
    if (!confirm('Remove the finance data on this PC? Your Fusion setup, statement templates and account mapping stay; load again from Fusion afterwards.')) return;
    FL.call('finClearData').then(function () { FL.toast('Finance data removed', 'ok'); FL.lsSet('filter', {}); FL.lsSet('fusion.check', null); if (FL.dataTab) FL.dataTab.check = null; return FL.refresh(); })
        .catch(function (e) { FL.toast(String(e), 'err'); });
};

// ── modal ──
FL.modal = function (title, html, acts) { $('m-title').innerHTML = title; $('m-body').innerHTML = html; $('m-acts').innerHTML = acts || ''; $('modal').classList.add('open'); };
FL.closeModal = function () { $('modal').classList.remove('open'); if (FL.charts.drill) { FL.charts.drill.destroy(); delete FL.charts.drill; } };

// ── tables / csv ──
FL.table = function (cols, rows, opts) {
    opts = opts || {};
    return '<table class="t"><thead><tr>' + cols.map(function (c) { return '<th class="' + (c.n ? 'n' : '') + '">' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (r, i) {
            return '<tr' + (opts.click ? ' class="click" data-i="' + i + '"' : '') + '>' + cols.map(function (c) { var v = c.get ? c.get(r) : r[c.key]; return '<td class="' + (c.n ? 'n' : '') + '">' + (c.html ? v : esc(v)) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
};
FL.wireRows = function (el, rows, fn) { el.querySelectorAll('tr.click').forEach(function (tr) { tr.onclick = function () { fn(rows[+tr.dataset.i]); }; }); };
FL.csv = function (name, cols, rows) {
    var cell = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var text = [cols.map(cell).join(',')].concat(rows.map(function (r) { return r.map(cell).join(','); })).join('\r\n');
    FL.download(name, new Blob(['﻿' + text], { type: 'text/csv' }));
};
FL.download = function (name, blob) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};

// ── charts (Chart.js) ──
FL.chart = function (id, cfg) {
    var cv = $(id); if (!cv || !window.Chart) return null;
    if (FL.charts[id]) FL.charts[id].destroy();
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: { duration: 250 }, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } } }, cfg.options || {});
    FL.charts[id] = new Chart(cv, cfg);
    return FL.charts[id];
};
FL.moneyAxis = function () { return { ticks: { callback: function (v) { return FL.compact(v); }, font: { size: 10 } }, grid: { color: '#f1f5f9' } }; };
FL.spark = function (id, values, color) {
    return FL.chart(id, { type: 'line', data: { labels: values.map(function (_, i) { return i; }), datasets: [{ data: values, borderColor: color || FL.PAL.act, borderWidth: 1.6, pointRadius: 0, fill: { target: 'origin', above: 'rgba(29,78,216,.07)' }, tension: 0.3 }] },
        options: { plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, animation: false, interaction: { mode: null } } });
};
/** Waterfall as a floating bar chart: steps [{label, value, kind start|step|end}] */
FL.waterfall = function (id, steps) {
    var run = 0, bars = [], cols = [];
    steps.forEach(function (s) {
        if (s.kind === 'start' || s.kind === 'end') { bars.push([0, s.value]); run = s.value; cols.push(FL.PAL.act); }
        else { bars.push([run, run + s.value]); run += s.value; cols.push(s.value >= 0 ? FL.PAL.good : FL.PAL.bad); }
    });
    // zoom the axis to where the steps happen (the start and end bars are cut, as in a printed bridge)
    var lo = Infinity, hi = -Infinity;
    bars.forEach(function (b, i) { if (steps[i].kind === 'step') { lo = Math.min(lo, b[0], b[1]); hi = Math.max(hi, b[0], b[1]); } else { lo = Math.min(lo, b[1]); hi = Math.max(hi, b[1]); } });
    var pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1, y = FL.moneyAxis();
    if (lo > 0 && lo - pad > 0) y.min = lo - pad;
    return FL.chart(id, { type: 'bar', data: { labels: steps.map(function (s) { return s.label; }), datasets: [{ data: bars, backgroundColor: cols, borderRadius: 3 }] },
        options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { var s = steps[c.dataIndex]; return (s.kind === 'step' && s.value > 0 ? '+' : '') + FL.compact(s.value); } } } }, scales: { y: y, x: { ticks: { font: { size: 10 } } } } } });
};

// ═════ drill: cell → accounts → company / cost centre / period → journal lines ═════
FL.drillCell = function (tpl, opts, rowId, colId) {
    var col = (opts.columns || tpl.columns || []).filter(function (c) { return c.id === colId; })[0];
    var row = tpl.rows.filter(function (r) { return r.id === rowId; })[0];
    if (!col || !row || col.kind) return;
    return FL.data().then(function (data) {
        var parts = FINE.explain(tpl, data, opts, rowId, colId), seqs = FINE.windowSeqs(col, data, opts.period);
        var total = parts.reduce(function (s, x) { return s + x.amount; }, 0);
        var ctx = { tpl: tpl, row: row, col: col, seqs: seqs, label: row.label + ' · ' + FINE.colLabel(col, data._pi, opts.period) };
        FL.drillCtx = ctx; FL.drillOpts = opts;
        var html = '<div class="crumbs">' + esc(tpl.name) + ' › <b>' + esc(ctx.label) + '</b> · ' + esc(FL.filterText()) + '</div>' +
            '<p class="sm muted">' + parts.length + ' account(s), total ' + FL.num(total) + ' (' + FL.scaleLabel() + '). Click an account for companies, cost centres, months and journal lines.</p>' +
            FL.table([{ label: 'Account', key: 'code' }, { label: 'Name', key: 'name' }, { label: 'Amount', n: 1, get: function (r) { return FL.num(r.amount); } },
                { label: 'Share', n: 1, get: function (r) { return total ? (r.amount / total * 100).toFixed(1) + '%' : ''; } }], parts, { click: true });
        FL.modal('<i class="fa-solid fa-magnifying-glass-chart"></i> Drill-down', html,
            '<button class="btn sm" onclick="FL.csv(\'drill-accounts.csv\', [\'account\',\'name\',\'amount\'], FL.drillParts.map(function(p){return [p.code,p.name,p.amount.toFixed(2)];}))"><i class="fa-solid fa-file-csv"></i> CSV</button>');
        FL.drillParts = parts;
        FL.wireRows($('m-body'), parts, function (p) { FL.drillAccount(p.code, ctx); });
    }).catch(function (e) { FL.toast(String(e), 'err'); });
};
FL.drillAccount = function (code, ctx) {
    var acc = FL.dims.accounts.filter(function (a) { return a.code === code; })[0] || { name: code };
    var w = FL.where('b').concat(['b.account = ' + FL.q(code), 'b.scenario = ' + FL.q(ctx.col.scenario || 'ACTUAL'), 'b.period_seq IN (' + (ctx.seqs.length ? ctx.seqs.join(',') : '0') + ')']);
    FL.rows('SELECT b.company, b.cost_centre, b.period_name, b.period_seq, SUM(b.period_dr) AS dr, SUM(b.period_cr) AS cr, SUM(b.period_net) AS net, SUM(b.end_bal) AS end_bal FROM fin_balances b WHERE ' + w.join(' AND ') + ' GROUP BY ALL ORDER BY b.period_seq, b.company, b.cost_centre').then(function (rows) {
        var html = '<div class="crumbs"><a onclick="FL.drillCell(FL.drillCtx.tpl, FL.drillOpts, FL.drillCtx.row.id, FL.drillCtx.col.id)">' + esc(ctx.label) + '</a> › <b>' + esc(code + ' ' + acc.name) + '</b></div>' +
            '<div class="row" style="margin:8px 0"><span class="sm muted">' + esc(ctx.col.scenario || 'ACTUAL') + ' · movements and closing balances in ' + FL.scaleLabel() + '</span><span class="grow"></span>' +
            ((ctx.col.scenario || 'ACTUAL') === 'ACTUAL' ? '<button class="btn sm primary" id="dj"><i class="fa-solid fa-list"></i> Journal lines</button>' : '') + '</div>' +
            '<div class="chartbox short"><canvas id="drillc"></canvas></div>' +
            '<div class="scroll">' + FL.table([{ label: 'Period', key: 'period_name' }, { label: 'Company', key: 'company' }, { label: 'Cost centre', key: 'cost_centre' },
                { label: 'Debit', n: 1, get: function (r) { return FL.num(r.dr); } }, { label: 'Credit', n: 1, get: function (r) { return FL.num(r.cr); } },
                { label: 'Net movement', n: 1, get: function (r) { return FL.num(r.net); } }, { label: 'Closing balance', n: 1, get: function (r) { return FL.num(r.end_bal); } }], rows, { click: true }) + '</div>';
        FL.modal('<i class="fa-solid fa-magnifying-glass-chart"></i> ' + esc(code + ' ' + acc.name), html);
        var byP = {}; rows.forEach(function (r) { byP[r.period_name] = (byP[r.period_name] || 0) + r.net; });
        FL.chart('drillc', { type: 'bar', data: { labels: Object.keys(byP), datasets: [{ label: 'Net movement', data: Object.keys(byP).map(function (k) { return byP[k]; }), backgroundColor: FL.PAL.act, borderRadius: 3 }] }, options: { scales: { y: FL.moneyAxis() } } });
        FL.charts.drill = FL.charts.drillc;
        if ($('dj')) $('dj').onclick = function () { FL.drillJournals({ account: code, seqs: ctx.seqs, title: code + ' ' + acc.name, back: ctx }); };
        FL.wireRows($('m-body'), rows, function (r) { FL.drillJournals({ account: code, seqs: [r.period_seq], company: r.company, cc: r.cost_centre, title: code + ' ' + acc.name + ' · ' + r.period_name + ' · ' + r.company + '/' + r.cost_centre, back: ctx }); });
    }).catch(function (e) { FL.toast(String(e), 'err'); });
};
/** Journal lines: {account, seqs, company, cc, where (extra SQL), title} */
FL.drillJournals = function (o) {
    var w = o.where ? [o.where] : FL.where('j').concat(['j.account = ' + FL.q(o.account), 'j.period_seq IN (' + (o.seqs && o.seqs.length ? o.seqs.join(',') : '0') + ')']);
    if (o.company) w.push('j.company = ' + FL.q(o.company));
    if (o.cc) w.push('j.cost_centre = ' + FL.q(o.cc));
    FL.rows('SELECT j.je_id, j.je_line, CAST(j.accounting_date AS VARCHAR) AS acc_date, j.period_name, j.je_source, j.je_category, j.je_name, j.company, j.cost_centre, j.account, j.dr, j.cr, j.description, j.created_by, ' +
            "strftime(j.posted_at, '%Y-%m-%d %H:%M') AS posted FROM fin_journals j WHERE " + w.join(' AND ') + ' ORDER BY j.accounting_date, j.je_id, j.je_line LIMIT 3000', 3000).then(function (rows) {
        var dr = 0, cr = 0; rows.forEach(function (r) { dr += r.dr; cr += r.cr; });
        var cols = [{ label: 'Date', key: 'acc_date' }, { label: 'Journal', key: 'je_name' }, { label: 'Source', key: 'je_source' }, { label: 'Category', key: 'je_category' },
            { label: 'Co', key: 'company' }, { label: 'CC', key: 'cost_centre' }, { label: 'Account', key: 'account' }, { label: 'Debit', n: 1, get: function (r) { return r.dr ? FINE.fmt(r.dr, 'num', { decimals: 2 }) : ''; } },
            { label: 'Credit', n: 1, get: function (r) { return r.cr ? FINE.fmt(r.cr, 'num', { decimals: 2 }) : ''; } }, { label: 'Description', key: 'description' }, { label: 'By', key: 'created_by' }, { label: 'Posted', key: 'posted' }];
        FL.jrRows = rows;
        FL.jrBack = o.back;
        var html = (o.back ? '<div class="crumbs"><a onclick="FL.drillAccount(' + esc(JSON.stringify(o.account)) + ', FL.jrBack)">' + esc(o.back.label) + ' › ' + esc(o.account) + '</a> › <b>journal lines</b></div>' : '') +
            '<p class="sm muted">' + rows.length + ' line(s)' + (rows.length >= 3000 ? ' (first 3,000)' : '') + ' · debits ' + FINE.fmt(dr, 'num', { decimals: 2 }) + ' · credits ' + FINE.fmt(cr, 'num', { decimals: 2 }) + ' · click a line for the whole journal</p>' +
            '<div class="scroll" style="max-height:62vh">' + FL.table(cols, rows, { click: true }) + '</div>';
        FL.modal('<i class="fa-solid fa-list"></i> ' + esc(o.title || 'Journal lines'), html,
            '<button class="btn sm" onclick="FL.csv(\'journal-lines.csv\', Object.keys(FL.jrRows[0]||{}), FL.jrRows.map(function(r){return Object.keys(r).map(function(k){return r[k];});}))"><i class="fa-solid fa-file-csv"></i> CSV</button>');
        FL.wireRows($('m-body'), rows, function (r) { FL.journal(r.je_id, o); });
    }).catch(function (e) { FL.toast(String(e), 'err'); });
};
FL.journal = function (id, back) {
    FL.rows('SELECT je_line, je_name, je_source, je_category, CAST(accounting_date AS VARCHAR) AS acc_date, company, cost_centre, account, dr, cr, description, created_by, strftime(posted_at, \'%Y-%m-%d %H:%M\') AS posted FROM fin_journals WHERE je_id = ' + (+id) + ' ORDER BY je_line').then(function (rows) {
        var h = rows[0] || {}, names = {}; FL.dims.accounts.forEach(function (a) { names[a.code] = a.name; });
        FL.modal('<i class="fa-solid fa-receipt"></i> Journal ' + esc(h.je_name || id),
            (back ? '<div class="crumbs"><a id="jb">‹ back to the lines</a></div>' : '') +
            '<div class="row sm" style="margin:6px 0 10px"><span class="tag">' + esc(h.je_source) + '</span><span class="tag">' + esc(h.je_category) + '</span><span>Date ' + esc(h.acc_date) + '</span><span>Posted ' + esc(h.posted) + ' by <b>' + esc(h.created_by) + '</b></span></div>' +
            FL.table([{ label: '#', key: 'je_line' }, { label: 'Co', key: 'company' }, { label: 'CC', key: 'cost_centre' }, { label: 'Account', get: function (r) { return r.account + ' ' + (names[r.account] || ''); } },
                { label: 'Debit', n: 1, get: function (r) { return r.dr ? FINE.fmt(r.dr, 'num', { decimals: 2 }) : ''; } }, { label: 'Credit', n: 1, get: function (r) { return r.cr ? FINE.fmt(r.cr, 'num', { decimals: 2 }) : ''; } },
                { label: 'Description', key: 'description' }], rows));
        if ($('jb')) $('jb').onclick = function () { FL.drillJournals(back); };
    });
};

document.addEventListener('DOMContentLoaded', function () { FL.init(); });
