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
FL.scaleLabel = function () { return { 1: 'units', 100: 'hundreds', 1000: 'thousands', 1000000: 'millions' }[FL.filter.scale] || ''; };

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
        FL.templates.forEach(function (x) { if (x.simple) { try { FINE.simpleTemplate(x); } catch (e) { console.warn('[Finance] template', x.id, e); } } });
        FL.config = Object.assign(JSON.parse(JSON.stringify(FIN_SEED.config)), c || {});
    });
};
FL.saveTemplates = function () { return FL.call('finDocSave', { name: 'templates', json: JSON.stringify({ version: 1, templates: FL.templates }, null, 1) }); };
/** Accounts without a class (Fusion loads) get one from their type and name; your choices (config.accountClass) win.
    The classes are written back to fin_accounts so SQL, the journal tests and the Copilot see them too. */
FL.classifyAccounts = function () {
    var over = (FL.config && FL.config.accountClass) || {}, changed = {}, n = 0;
    FL.dims.accounts.forEach(function (a) {
        // only your choices (config.accountClass, also those from APEX) stick: the rest is worked out again from the type and name
        // every time — a class saved while the name was still the bare code, or the type unknown, would otherwise stay wrong
        var fits = a.class && (FINE.CLASSES[a.account_type] || []).concat(a.account_type === 'E' ? ['Other expenses'] : []).indexOf(a.class) >= 0;
        var named = a.name && String(a.name).trim() !== String(a.code);
        var want = over[a.code] || (named || !fits ? FINE.classify(a) : a.class);
        if (over[a.code] && a.class !== over[a.code]) want = over[a.code];
        if (want !== a.class) { a.class = want; changed[a.code] = want; n++; }
    });
    if (n) FL.call('finSetClasses', { classes: changed, source: 'AUTO' }, 120000).then(function () { FL.cache = {}; }).catch(function (e) { console.warn('[Finance] classes not saved', e); });
    return n;
};
/** Income statement and balance sheet as simple templates (main groups → sections → accounts), mapped by default from the
    accounts' type and name. A class-built or range template that misses most accounts is replaced (kept as "… (previous)"). */
FL.ensureSimple = function () {
    var accs = FL.dims.accounts; if (!accs.length) return false;
    var changed = false;
    // the default mapping follows the account types, names and classes until someone changes it (simple.auto)
    FL.templates.forEach(function (t) {
        if (!t.simple || !t.simple.auto) return;
        var before = JSON.stringify(t.simple); t.simple = FINE.simpleDefault(t.simple.kind, accs);
        if (JSON.stringify(t.simple) !== before) { FINE.simpleTemplate(t); changed = true; }
    });
    ['PL', 'BS'].forEach(function (kind) {
        if (FL.templates.some(function (t) { return t.simple && t.simple.kind === kind; })) return;
        var mine = accs.filter(function (a) { return FINE.simpleKindOf(a) === kind; }); if (!mine.length) return;
        var old = FL.tpl(kind), fresh = FINE.simpleTemplate({ id: kind, name: kind === 'PL' ? 'Income statement' : 'Balance sheet', simple: FINE.simpleDefault(kind, accs),
            description: 'Default mapping from the account types and names — change it in the Statement builder.' });
        if (old) {
            var lines = FINE.accountLines([old], mine), hit = mine.filter(function (a) { return lines[a.code].length; }).length;
            if (!old.auto && hit >= mine.length * 0.6) { fresh.id = kind === 'PL' ? 'IS' : 'SFP'; while (FL.tpl(fresh.id)) fresh.id += '1'; FL.templates.push(fresh); changed = true; return; }
            if (!old.auto) { old.id = kind + '_PREV'; old.name = old.name + ' (previous)'; } else FL.templates = FL.templates.filter(function (t) { return t !== old; });
        }
        var at = FL.templates.map(function (t) { return t.type; }).indexOf(kind);
        FL.templates.splice(at < 0 ? 0 : at, 0, fresh); changed = true;
    });
    if (changed) FL.saveTemplates().then(function () { FL.templatesSaved = true; }).catch(function (e) { console.warn('[Finance] templates not saved', e); });
    return changed;
};
/** Changes the filter from anywhere (statement bar, links) and keeps the header selects in step */
FL.setFilter = function (patch) {
    Object.assign(FL.filter, patch);
    if ('ledger' in patch && FL.coOptions) FL.coOptions();
    [['f-period', 'period'], ['f-ledger', 'ledger'], ['f-company', 'company'], ['f-cc', 'cc'], ['f-scale', 'scale']].forEach(function (x) { if ($(x[0])) $(x[0]).value = FL.filter[x[1]] == null ? '' : FL.filter[x[1]]; });
    FL.lsSet('filter', FL.filter); FL.cache = {}; FL.render();
};
FL.saveConfig = function () { return FL.call('finDocSave', { name: 'config', json: JSON.stringify(FL.config, null, 1) }); };

// ── start ──
FL.init = function () {
    document.querySelectorAll('#tabs button[data-tab]').forEach(function (b) { b.onclick = function () { FL.show(b.dataset.tab); }; });
    // left menu: collapsible to icons (remembered per PC; collapsed by default on a narrow screen); labels become tooltips
    document.querySelectorAll('#tabs button[data-tab]').forEach(function (b) { b.title = b.textContent.trim(); });
    var navMin = FL.ls('nav.min', null); if (navMin === null) navMin = window.innerWidth < 900;
    var setNav = function (min) {
        document.body.classList.toggle('nav-min', !!min);
        var t = $('nav-tg'); if (t) { t.title = min ? 'Expand the menu' : 'Collapse the menu'; t.innerHTML = '<i class="fa-solid fa-angles-' + (min ? 'right' : 'left') + '"></i>' + (min ? 'Expand' : 'Collapse'); }
    };
    setNav(navMin);
    if ($('nav-tg')) $('nav-tg').onclick = function () { navMin = !document.body.classList.contains('nav-min'); FL.lsSet('nav.min', navMin); setNav(navMin); setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 200); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (FL.maxi.cur) FL.maxi.close(); else FL.closeModal(); } });
    FL.maxi.watch();
    $('b-pack').onclick = function () { FL.show('packs'); };
    $('b-ask').onclick = function () { FL.copilot.toggle(); };
    if (!hasHost()) { $('main').innerHTML = '<div class="empty"><i class="fa-solid fa-plug-circle-xmark"></i>Open Finance Lens inside the Gray\'s WMS app.</div>'; return; }
    FL.call('finWho').then(function (w) { FL.who = w; }).catch(function () { /* older host */ });
    FL.refresh();
};
FL.refresh = function () {
    FL.cache = {};
    return FL.call('finStatus').then(function (st) {
        FL.status = st;
        if (!st.loaded) { FL.dataChip(); return FL.loadDocs().catch(function () { /* first run */ }).then(function () { FL.show(FL.tab || FL.ls('tab', 'overview')); }); }
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
            // no type from Fusion yet: worked out from the name and code (the builder marks them), so statements are never empty
            FL.dims.accounts.forEach(function (a) { if (!/^[ALORE]$/.test(a.account_type || '')) { a.account_type = FINE.guessType(a); a.typeGuess = true; } });
            FL.classifyAccounts();
            FL.ensureSimple();
            if (!FL.templatesSaved) FL.toast('Statements built from your chart of accounts by account class — adjust them in the Statement builder.', 'ok');
            FL.fillFilters();
            FL.dataChip();
            FL.show(FL.ls('tab', 'overview'));
            if (FL.fusion && FL.fusion.pullMapping && /^FUSION/.test((st.meta || {}).source || '')) FL.fusion.pullMapping().then(function () { if (FL.ensureSimple() && /statements|builder/.test(FL.tab)) FL.render(); });
        });
    }).catch(function (e) { $('main').innerHTML = '<div class="callout bad">' + esc(e) + '</div>'; });
};
FL.dataChip = function () {
    var s = FL.status || {}, m = s.meta || {}, c = s.counts || {};
    $('datachip').innerHTML = s.loaded && m.source === 'FUSION_TB' ? '<i class="fa-solid fa-scale-balanced"></i> synced trial balances · ' + esc(c.first_period || '') + ' – ' + esc(c.last_period || '') + ' · ' + (FL.dims.periods || []).length + ' period(s)'
        : s.loaded ? '<i class="fa-solid fa-database"></i> ' + esc(m.source || '?') + ' · ' + (c.journals || 0).toLocaleString() + ' journal lines · ' + esc(c.first_period || '') + ' – ' + esc(c.last_period || '')
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
    FL.coOptions = coOptions;
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
    if (FL.copilot && FL.copilot.open && FL.copilot.paintSuggest) FL.copilot.paintSuggest();   // the drawer's prompts follow the page
    FL.render();
};
FL.render = function () {
    if (!FL.status || !FL.status.loaded) {
        // before any load: the Data workspace, and the trial balance live from Fusion under Statements
        if (FL.tab === 'data' && FL.TABS.data) FL.TABS.data.render($('main'));
        else if (FL.tab === 'statements' && FL.tb) FL.tb.empty($('main'));
        else if (FL.tab === 'packs' && FL.TABS.packs) return Promise.resolve(FL.TABS.packs.render($('main'))).catch(function (e) { $('main').innerHTML = '<div class="callout bad">' + esc(e && e.message || e) + '</div>'; });   // designs and e-mail setup work before any data
        else if (FL.tab === 'ic' && FL.TABS.ic) return Promise.resolve(FL.TABS.ic.render($('main'))).catch(function (e) { $('main').innerHTML = '<div class="callout bad">' + esc(e && e.message || e) + '</div>'; });   // intercompany needs no GL load
        else FL.welcome();
        return Promise.resolve();
    }
    Object.keys(FL.charts).forEach(function (k) { try { FL.charts[k].destroy(); } catch (e) { /* gone */ } });
    FL.charts = {};
    var t = FL.TABS[FL.tab], el = $('main');
    el.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Working…</div>';
    return Promise.resolve().then(function () { return t.render(el); }).then(function () {
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
        '<ol class="sm"><li><b>Fusion setup</b> — discover the ledgers and the chart of accounts once</li><li><b>Trial balance sync</b> — pick a ledger and the periods; Fusion groups the balances by company × account</li><li><b>Statements</b> — trial balance, income statement, balance sheet and cash flow of the synced periods</li></ol>' +
        (admin ? '<div class="row"><button class="btn primary" onclick="FL.dataTab.go(\'tbsync\'); FL.show(\'data\')"><i class="fa-solid fa-scale-balanced"></i> Trial balance sync</button>' +
            '<button class="btn" onclick="FL.dataTab.go(\'setup\'); FL.show(\'data\')"><i class="fa-solid fa-plug"></i> Fusion setup</button></div>'
            : '<div class="callout warn">An AI admin syncs the finance data on this PC.</div>') + '</div></div>';
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

// ── yellow "working" banner under the tabs: every sync shows here, wherever the user is on the page ──
FL.busy = {
    n: 0, items: {},
    box: function () {
        var b = $('fl-busy'); if (b) return b;
        b = document.createElement('div'); b.id = 'fl-busy'; b.className = 'fl-busy';
        var pane = $('pane'), tabs = $('tabs');
        if (pane) pane.insertBefore(b, pane.firstChild);   // above the page, beside the menu
        else if (tabs && tabs.parentNode) tabs.parentNode.insertBefore(b, tabs.nextSibling); else document.body.insertBefore(b, document.body.firstChild);
        return b;
    },
    /** Starts an item; returns its id. label = what is running ("Syncing debtors…") */
    /** stop (optional) = function that cancels the work — the banner then shows a Stop button */
    start: function (label, stop) { var id = 'b' + (++FL.busy.n); FL.busy.items[id] = { label: String(label || 'Working…').replace(/…$/, ''), line: '', t0: Date.now(), state: 'run', stop: stop || null }; FL.busy.paint(); FL.busy.tick(); return id; },
    stopping: function (id) { var it = FL.busy.items[id]; if (!it || it.state !== 'run') return; it.stopping = true; it.line = 'stopping — the reads already done are kept…'; FL.busy.paint(); },
    line: function (id, msg) { var it = FL.busy.items[id]; if (!it || !msg) return; it.line = String(msg).trim().slice(0, 220); clearTimeout(FL.busy.pt); FL.busy.pt = setTimeout(FL.busy.paint, 150); },
    end: function (id, err) {
        var it = FL.busy.items[id]; if (!it) return;
        it.state = err ? 'bad' : 'ok'; it.line = err ? String(err).slice(0, 300) : 'done in ' + FL.busy.secs(Date.now() - it.t0); it.t1 = Date.now();
        FL.busy.paint();
        if (!err) setTimeout(function () { delete FL.busy.items[id]; FL.busy.paint(); }, 5000);
    },
    secs: function (ms) { var s = Math.round(ms / 1000); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s'; },
    tick: function () {
        clearInterval(FL.busy.ti);
        FL.busy.ti = setInterval(function () {
            var run = Object.keys(FL.busy.items).some(function (k) { return FL.busy.items[k].state === 'run'; });
            if (!run) { clearInterval(FL.busy.ti); return; }
            document.querySelectorAll('#fl-busy [data-t0]').forEach(function (e) { e.textContent = FL.busy.secs(Date.now() - +e.dataset.t0); });
        }, 1000);
    },
    paint: function () {
        var b = FL.busy.box(), ids = Object.keys(FL.busy.items);
        b.style.display = ids.length ? '' : 'none';
        b.innerHTML = ids.map(function (id) {
            var it = FL.busy.items[id];
            return '<div class="fl-busy-i ' + it.state + '">' + (it.state === 'run' ? '<i class="fa-solid fa-circle-notch fa-spin"></i>' : it.state === 'ok' ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-solid fa-triangle-exclamation"></i>') +
                '<b>' + esc(it.label) + (it.state === 'run' ? ' — syncing' : it.state === 'ok' ? ' — done' : ' — stopped') + '</b>' +
                (it.state === 'run' ? '<span class="fl-busy-t" data-t0="' + it.t0 + '">' + FL.busy.secs(Date.now() - it.t0) + '</span>' : '') +
                '<span class="fl-busy-l">' + esc(it.line) + '</span>' +
                (it.state === 'run' && it.stop ? '<button class="btn sm fl-busy-stop" data-stop="' + id + '"' + (it.stopping ? ' disabled' : '') + ' title="Stop it — what was read so far stays on this PC"><i class="fa-solid fa-stop"></i> ' + (it.stopping ? 'Stopping…' : 'Stop') + '</button>' : '') + (it.state !== 'run' ? '<a class="fl-busy-x" data-x="' + id + '" title="Hide">×</a>' : '') + '</div>';
        }).join('');
        b.querySelectorAll('[data-stop]').forEach(function (a) { a.onclick = function () { var it = FL.busy.items[a.dataset.stop]; if (!it || !it.stop) return; it.stop(); FL.busy.stopping(a.dataset.stop); }; });
        b.querySelectorAll('[data-x]').forEach(function (a) { a.onclick = function () { delete FL.busy.items[a.dataset.x]; FL.busy.paint(); }; });
    }
};

// ── tables / csv ──
FL.table = function (cols, rows, opts) {
    opts = opts || {};
    return '<table class="t"><thead><tr>' + cols.map(function (c) { return '<th class="' + (c.n ? 'n' : '') + '">' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (r, i) {
            return '<tr' + (opts.click ? ' class="click" data-i="' + i + '"' : '') + '>' + cols.map(function (c) { var v = c.get ? c.get(r) : r[c.key]; return '<td class="' + (c.n ? 'n' : '') + '">' + (c.html ? v : esc(v)) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
};
/** A grid with a filter box under every column header and click-to-sort headers.
    cols: {label, key | get (display), val (raw value for filter / sort / CSV; default key or get), n (numeric), html}
    opts: {max (rows shown, default 500), click(row), csv (file name), id (keeps filters when re-rendered), empty}
    Filters: text = contains, "=x" exact, "!x" not; numbers also ">100", "<=5", "10..20", "=0". */
FL.gridState = FL.gridState || {};
FL.gridMatch = function (v, f, num) {
    f = String(f || '').trim(); if (!f) return true;
    var neg = false; if (f.charAt(0) === '!') { neg = true; f = f.slice(1).trim(); if (!f) return true; }
    var ok, m = /^(>=|<=|>|<|=)\s*(-?[\d.,]+)$/.exec(f), rng = /^(-?[\d.,]+)\s*\.\.\s*(-?[\d.,]+)$/.exec(f), nn = function (x) { return +String(x).replace(/,/g, ''); };
    if (num && (m || rng)) {
        var x = typeof v === 'number' ? v : nn(v);
        if (v == null || v === '' || isNaN(x)) ok = false;
        else if (rng) ok = x >= nn(rng[1]) && x <= nn(rng[2]);
        else { var y = nn(m[2]); ok = m[1] === '>' ? x > y : m[1] === '<' ? x < y : m[1] === '>=' ? x >= y : m[1] === '<=' ? x <= y : Math.abs(x - y) < 1e-9; }
    } else if (f.charAt(0) === '=') ok = String(v == null ? '' : v).toLowerCase() === f.slice(1).trim().toLowerCase();
    else ok = String(v == null ? '' : v).toLowerCase().indexOf(f.toLowerCase()) >= 0;
    return neg ? !ok : ok;
};
FL.grid = function (el, cols, rows, opts) {
    if (!el) return;
    opts = opts || {};
    var key = opts.id || cols.map(function (c) { return c.label; }).join('|');
    var st = FL.gridState[key] = FL.gridState[key] || { f: {}, sort: null, dir: 1 };
    if (opts.filters) Object.keys(opts.filters).forEach(function (k) { st.f[k] = opts.filters[k]; });
    var raw = function (c, r) { return c.val ? c.val(r) : c.key ? r[c.key] : c.get(r); };
    var shown = [];
    el.innerHTML = '<div class="fg-bar sm"><span class="fg-count"></span><span class="grow"></span><a class="fg-clear" style="display:none"><i class="fa-solid fa-filter-circle-xmark"></i> clear filters</a>' +
        (opts.csv ? ' <a class="fg-csv"><i class="fa-solid fa-file-csv"></i> CSV</a>' : '') + '</div>' +
        '<div class="scroll fg-wrap"' + (opts.height ? ' style="max-height:' + opts.height + '"' : '') + '><table class="t fg"><thead><tr>' + cols.map(function (c, i) {
            return '<th class="' + (c.n ? 'n' : '') + '" data-c="' + i + '" title="Sort">' + esc(c.label) + '<span class="fg-s"></span></th>'; }).join('') + '</tr><tr class="fg-f">' +
        cols.map(function (c, i) { return '<th><input data-c="' + i + '" placeholder="' + (c.n ? '>0, 1..9' : 'filter') + '" value="' + esc(st.f[c.label] || '') + '"></th>'; }).join('') +
        '</tr></thead><tbody></tbody><tfoot class="fg-tot"></tfoot></table></div>';
    // totals of the value columns over every row the filters keep (not only the rows shown); columns where a sum means
    // nothing (days, %, rates, prices, ages, ranks, ids) are left out — a column can say sum: true / false itself
    var NOSUM = /(^#$|%|\bdays?\b|\bage\b|oldest|rate|rank|price|unit cost|limit|\byear\b|\bid\b|seq|score|margin|ratio)/i;
    var sums = cols.map(function (c) { return c.n && (c.sum === true || (c.sum !== false && !NOSUM.test(c.label))); });
    var foot = function (list) {
        var tf = el.querySelector('tfoot.fg-tot'); if (!tf) return;
        if (opts.totals === false || !sums.some(Boolean) || list.length < 2) { tf.innerHTML = ''; return; }
        var lead = cols[0] && !sums[0];
        tf.innerHTML = '<tr>' + cols.map(function (c, i) {
            if (!sums[i]) return '<td' + (i === 0 && lead ? ' class="fg-tl"' : '') + '>' + (i === 0 && lead ? 'Total · ' + list.length.toLocaleString() : '') + '</td>';
            var t = 0, dp = 0, any = false;
            list.forEach(function (r) { var v = raw(c, r); if (v == null || v === '') return; var x = +v; if (isNaN(x)) return; any = true; t += x; var s0 = String(v), k = s0.indexOf('.'); if (k >= 0) dp = Math.max(dp, Math.min(2, s0.length - k - 1)); });
            return '<td class="n">' + (any ? (c.money ? FL.num(t) : FINE.fmt(t, 'num', { decimals: dp })) : '') + '</td>';   // money: raw value, shown in the Amounts scale
        }).join('') + '</tr>';
    };
    var body = function () {
        var list = rows.filter(function (r) { return cols.every(function (c) { return FL.gridMatch(raw(c, r), st.f[c.label], c.n); }); });
        if (st.sort != null && cols[st.sort]) {
            var c = cols[st.sort];
            list.sort(function (a, b) { var x = raw(c, a), y = raw(c, b); if (x == null || x === '') return 1; if (y == null || y === '') return -1; return (c.n ? (+x) - (+y) : String(x).localeCompare(String(y), undefined, { numeric: true })) * st.dir; });
        }
        shown = list;
        var max = opts.max || 500, part = list.slice(0, max);
        el.querySelector('tbody').innerHTML = part.length ? part.map(function (r, i) {
            return '<tr' + (opts.click ? ' class="click" data-i="' + i + '"' : '') + '>' + cols.map(function (c) { var v = c.get ? c.get(r) : r[c.key]; return '<td class="' + (c.n ? 'n' : '') + '">' + (c.html ? v : esc(v)) + '</td>'; }).join('') + '</tr>';
        }).join('') : '<tr><td colspan="' + cols.length + '" class="muted">' + esc(opts.empty || 'Nothing matches the filters') + '</td></tr>';
        var nf = Object.keys(st.f).filter(function (k) { return st.f[k]; }).length;
        el.querySelector('.fg-count').textContent = list.length.toLocaleString() + (list.length !== rows.length ? ' of ' + rows.length.toLocaleString() : '') + ' row(s)' + (list.length > max ? ' · first ' + max.toLocaleString() + ' shown' : '') + (nf ? ' · ' + nf + ' filter(s)' : '');
        el.querySelector('.fg-clear').style.display = nf ? '' : 'none';
        el.querySelectorAll('thead th[data-c]').forEach(function (th) { th.querySelector('.fg-s').textContent = st.sort === +th.dataset.c ? (st.dir > 0 ? ' ▲' : ' ▼') : ''; });
        if (opts.click) el.querySelectorAll('tbody tr.click').forEach(function (tr) { tr.onclick = function () { opts.click(part[+tr.dataset.i]); }; });
        foot(list);
        if (opts.onFilter) opts.onFilter(list);
    };
    var t;
    el.querySelectorAll('.fg-f input').forEach(function (inp) { inp.oninput = function () { st.f[cols[+inp.dataset.c].label] = inp.value; clearTimeout(t); t = setTimeout(body, 200); }; });
    el.querySelectorAll('thead th[data-c]').forEach(function (th) { th.onclick = function () { var i = +th.dataset.c; if (st.sort === i) st.dir = -st.dir; else { st.sort = i; st.dir = cols[i].n ? -1 : 1; } body(); }; });
    el.querySelector('.fg-clear').onclick = function () { st.f = {}; el.querySelectorAll('.fg-f input').forEach(function (i) { i.value = ''; }); body(); };
    if (opts.csv) el.querySelector('.fg-csv').onclick = function () { FL.csv(opts.csv, cols.map(function (c) { return c.label; }), shown.map(function (r) { return cols.map(function (c) { return raw(c, r); }); })); };
    body();
    return { rows: function () { return shown; }, refresh: body };
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
// ═════ full screen for any card with a chart or a grid: a ⤢ button in its corner, Esc or ✕ closes ═════
FL.maxi = {
    cur: null,
    scan: function (root) {
        // cards with a chart / grid / table, and big tables that sit in a plain scroll box outside any card (statements)
        var els = Array.prototype.slice.call((root || document).querySelectorAll('#main .card'))
            .concat(Array.prototype.filter.call((root || document).querySelectorAll('#main .scroll'), function (sc) { return !sc.closest('.card') && sc.querySelector('table.t'); }));
        els.forEach(function (card) {
            if (card.dataset.maxi || card.closest('.modal')) return;
            if (!card.querySelector('canvas, .fg-wrap, table.t')) return;
            if (!card.classList.contains('card') && card.querySelectorAll('tr').length < 6) return;
            var inner = card.querySelectorAll('.card'); if (inner.length && Array.prototype.some.call(inner, function (c) { return c.querySelector('canvas, .fg-wrap, table.t'); })) return;   // the inner cards get it
            card.dataset.maxi = '1'; card.classList.add('fl-has-max');
            var b = document.createElement('button'); b.className = 'fl-maxb'; b.type = 'button'; b.title = 'Full screen (Esc to close)'; b.innerHTML = '<i class="fa-solid fa-expand"></i>';
            b.onclick = function (e) { e.stopPropagation(); if (FL.maxi.cur === card) FL.maxi.close(); else FL.maxi.open(card); };
            card.appendChild(b);
        });
    },
    open: function (card) {
        if (FL.maxi.cur) FL.maxi.close();
        FL.maxi.cur = card; card.classList.add('fl-max'); document.body.classList.add('fl-maxed');
        var b = card.querySelector(':scope > .fl-maxb'); if (b) { b.innerHTML = '<i class="fa-solid fa-xmark"></i>'; b.title = 'Close full screen (Esc)'; }
        FL.maxi.resize(card);
    },
    close: function () {
        var card = FL.maxi.cur; FL.maxi.cur = null; document.body.classList.remove('fl-maxed'); if (!card) return;
        card.classList.remove('fl-max');
        var b = card.querySelector(':scope > .fl-maxb'); if (b) { b.innerHTML = '<i class="fa-solid fa-expand"></i>'; b.title = 'Full screen (Esc to close)'; }
        FL.maxi.resize(card);
    },
    resize: function (card) { setTimeout(function () { Object.keys(FL.charts).forEach(function (k) { var c = FL.charts[k]; if (c && c.canvas && card.contains(c.canvas)) try { c.resize(); } catch (e) { /* gone */ } }); }, 60); },
    /** New cards appear whenever a view paints — buttons are added as they come */
    watch: function () {
        var main = $('main'); if (!main || !window.MutationObserver) return;
        var t; new MutationObserver(function () { clearTimeout(t); t = setTimeout(function () { if (FL.maxi.cur && !document.body.contains(FL.maxi.cur)) FL.maxi.close(); FL.maxi.scan(main); }, 150); }).observe(main, { childList: true, subtree: true });
    }
};
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
FL.drillCell = function (tpl, opts, rowId, colId, view) {
    var col = (opts.columns || tpl.columns || []).filter(function (c) { return c.id === colId; })[0];
    var row = tpl.rows.filter(function (r) { return r.id === rowId; })[0];
    if (!col || !row || col.kind) return;
    return FL.data().then(function (data) {
        var hasAcc = row.type === 'accounts' || row.type === 'group';
        var parts = hasAcc ? FINE.explain(tpl, data, opts, rowId, colId) : [], seqs = FINE.windowSeqs(col, data, opts.period);
        var mx = FINE.explainMonths(tpl, data, Object.assign({}, opts, { scale: FL.filter.scale || 1 }), rowId, colId);
        var total = parts.reduce(function (s, x) { return s + x.amount; }, 0);
        var ctx = { tpl: tpl, row: row, col: col, seqs: seqs, label: row.label + ' · ' + FINE.colLabel(col, data._pi, opts.period) };
        FL.drillCtx = ctx; FL.drillOpts = opts; FL.drillParts = parts; FL.drillMx = mx;
        view = view || FL.drillView || 'months'; if (!hasAcc && view !== 'months') view = 'months';
        var f = function (v) { return v == null ? '' : FINE.fmt(v, row.format, { decimals: (FL.filter.scale || 1) >= 1000000 ? 1 : 0 }); };
        var tabs = '<div class="seg" style="margin:6px 0 10px">' + [['months', 'By month'], ['accounts', 'By account'], ['matrix', 'Accounts × months']].filter(function (x) { return hasAcc || x[0] === 'months'; })
            .map(function (x) { return '<button class="' + (view === x[0] ? 'on' : '') + '" data-dv="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
        var html = '<div class="crumbs">' + esc(tpl.name) + ' › <b>' + esc(ctx.label) + '</b> · ' + esc(FL.filterText()) + '</div>' + tabs, csv;
        if (view === 'months' && mx) {
            var ms = mx.months, n = ms.length, avg = n ? ms.reduce(function (a, m) { return a + m.value; }, 0) / n : 0, ytdOn = !mx.balance && ms.some(function (m) { return m.ytd != null; });
            var big = ms.reduce(function (b, m) { return Math.abs(m.value) > Math.abs(b.value) ? m : b; }, ms[0] || { value: 0 });
            var lastM = ms[n - 1] || {}, ytdEnd = ytdOn ? lastM.ytd : null;
            var what = mx.balance ? 'the month-end balance of each month' : mx.pct ? 'the value of each month on its own' :
                ytdOn ? 'PTD = the movement of each month; YTD = taken from each month\'s balance (opening of the year to date + PTD), not added up' : n + ' month(s) add up to this amount';
            html += '<p class="sm muted" style="margin:0 0 6px">' + esc(ctx.label) + ' = <b>' + f(mx.total) + '</b> (' + FL.scaleLabel() + ') — ' + what +
                (ytdOn && mx.additive && ytdEnd != null ? (Math.abs(ytdEnd - (mx.total || 0)) > 0.5 && /YTD|FY/.test(ctx.col.range || '') ? ' <span class="pm-st conflict">YTD of ' + esc(lastM.name) + ' is ' + f(ytdEnd) + '</span>' : '')
                    : mx.additive && Math.abs((mx.sum || 0) - (mx.total || 0)) > 0.5 ? ' <span class="pm-st conflict">months add up to ' + f(mx.sum) + '</span>' : mx.additive ? ' <span class="pm-st ok">✓ months add up</span>' : '') + '</p>' +
                '<div class="chartbox short"><canvas id="drillc"></canvas></div>' +
                '<div class="scroll"><table class="t"><thead><tr><th>Month</th><th class="n">' + (mx.balance ? 'Balance' : ytdOn ? 'PTD' : 'Month') + '</th>' + (ytdOn ? '<th class="n">YTD</th>' : '') + (mx.additive ? '<th class="n" title="PTD of the month ÷ YTD of ' + esc(lastM.name || '') + '">Share</th>' : '') +
                '<th class="n">' + (mx.balance ? 'Last year' : ytdOn ? 'PTD last year' : 'Month last year') + '</th>' + (ytdOn ? '<th class="n">YTD last year</th>' : '') + '<th class="n">' + (ytdOn ? 'Δ YTD vs last year' : 'Δ vs last year') + '</th>' +
                (mx.additive ? '<th class="n">vs month average</th>' : '') + '</tr></thead><tbody>' +
                ms.map(function (m, i) {
                    var cur = ytdOn ? m.ytd : m.value, ly = ytdOn ? m.pyYtd : m.py, noLy = ly == null || Math.abs(ly) < 0.005;
                    var d = noLy ? null : cur - ly, dp = noLy ? null : d / Math.abs(ly) * 100, va = avg ? (m.value - avg) / Math.abs(avg) * 100 : null;
                    var flag = mx.additive && n >= 3 && va != null && Math.abs(va) >= 40 ? ' <span class="pm-st ' + (va > 0 ? 'kind' : 'map') + '" title="far from the average month">' + (va > 0 ? '▲' : '▼') + ' ' + Math.round(Math.abs(va)) + '%</span>' : '';
                    var good = row.favourable === 'down' ? -1 : 1;
                    return '<tr class="' + (hasAcc ? 'click' : '') + '" data-i="' + i + '"' + (m === big && n > 1 ? ' style="background:#fefce8"' : '') + '><td>' + esc(m.name) + (m === big && n > 1 ? ' <span class="sm muted">largest</span>' : '') + '</td><td class="n"><b>' + f(m.value) + '</b></td>' +
                        (ytdOn ? '<td class="n">' + f(m.ytd) + '</td>' : '') + (mx.additive ? '<td class="n">' + ((ytdOn ? ytdEnd : mx.total) ? (m.value / (ytdOn ? ytdEnd : mx.total) * 100).toFixed(1) + '%' : '') + '</td>' : '') +
                        '<td class="n">' + f(m.py) + '</td>' + (ytdOn ? '<td class="n">' + f(m.pyYtd) + '</td>' : '') +
                        '<td class="n" style="color:' + (d == null || !d ? 'inherit' : d * good > 0 ? 'var(--good,#16a34a)' : 'var(--bad,#dc2626)') + '">' +
                        (d == null ? (ly == null && m.py == null ? '' : '<span class="sm muted" title="nothing for last year in the data">no LY data</span>') : (mx.pct ? (d >= 0 ? '+' : '') + d.toFixed(1) + ' pts' : f(d) + (dp != null ? ' · ' + (dp >= 0 ? '+' : '') + dp.toFixed(1) + '%' : ''))) + '</td>' +
                        (mx.additive ? '<td class="n">' + (va == null ? '' : (va >= 0 ? '+' : '') + va.toFixed(0) + '%') + flag + '</td>' : '') + '</tr>';
                }).join('') +
                (mx.additive && n ? (function () {
                    var ly = lastM.pyYtd, noLy = ly == null || Math.abs(ly) < 0.005, d = ytdOn && !noLy ? lastM.ytd - ly : null;
                    if (!ytdOn) return '<tr style="font-weight:700;border-top:2px solid var(--ink,#0f172a)"><td>Total</td><td class="n">' + f(mx.sum) + '</td><td class="n">100%</td><td class="n">' +
                        f(ms.reduce(function (a2, m) { return a2 + (m.py || 0); }, 0)) + '</td><td></td><td></td></tr>';
                    // the YTD of the last month as it stands in its balance — the months are not added up
                    return '<tr style="font-weight:700;border-top:2px solid var(--ink,#0f172a)"><td>YTD ' + esc(lastM.name) + '</td><td class="n muted" title="PTD of ' + esc(lastM.name) + '">' + f(lastM.value) + '</td><td class="n">' + f(lastM.ytd) + '</td><td></td><td class="n muted">' + f(lastM.py) + '</td><td class="n">' + f(ly) + '</td><td class="n">' +
                        (d == null ? '' : f(d) + ' · ' + (d / Math.abs(ly) * 100 >= 0 ? '+' : '') + (d / Math.abs(ly) * 100).toFixed(1) + '%') + '</td><td></td></tr>';
                })() : '') +
                '</tbody></table></div>' +
                (hasAcc ? '<p class="sm muted">PTD = that month alone; YTD = the year to date held in that month\'s balance (Fusion keeps opening + PTD per period), so months that are not synced do not change it. Click a month for its accounts → companies / cost centres → journal lines.</p>' : '');
            csv = function () { FL.csv('drill-months.csv', ['month', 'ptd', 'ytd', 'month_last_year', 'ytd_last_year'], ms.map(function (m) { return [m.name, m.value, m.ytd == null ? '' : m.ytd, m.py == null ? '' : m.py, m.pyYtd == null ? '' : m.pyYtd]; })); };
        } else if (view === 'matrix' && mx) {
            var mm = mx.months;
            html += '<p class="sm muted" style="margin:0 0 6px">Each account month by month (' + FL.scaleLabel() + ') — ' + mx.accounts.length + ' account(s). Click an account for companies, cost centres and journal lines.</p>' +
                '<div class="scroll" style="max-height:60vh"><table class="t"><thead><tr><th>Account</th><th>Name</th>' + mm.map(function (m) { return '<th class="n">' + esc(m.name) + '</th>'; }).join('') + '<th class="n">' + (mx.additive ? 'Total' : 'Last') + '</th></tr></thead><tbody>' +
                mx.accounts.map(function (a, i) { return '<tr class="click" data-i="' + i + '"><td class="mono">' + esc(a.code) + '</td><td>' + esc(a.name) + '</td>' + a.months.map(function (v) { return '<td class="n">' + (Math.abs(v) > 0.004 ? f(v) : '–') + '</td>'; }).join('') + '<td class="n"><b>' + f(a.total) + '</b></td></tr>'; }).join('') +
                '<tr style="font-weight:700;border-top:2px solid var(--ink,#0f172a)"><td colspan="2">' + esc(row.label) + '</td>' + mm.map(function (m) { return '<td class="n">' + f(m.value) + '</td>'; }).join('') + '<td class="n">' + f(mx.additive ? mx.sum : mx.total) + '</td></tr></tbody></table></div>';
            csv = function () { FL.csv('drill-accounts-by-month.csv', ['account', 'name'].concat(mm.map(function (m) { return m.name; })).concat(['total']), mx.accounts.map(function (a) { return [a.code, a.name].concat(a.months).concat([a.total]); })); };
        } else {
            html += '<p class="sm muted">' + parts.length + ' account(s), total ' + FL.num(total) + ' (' + FL.scaleLabel() + '). Click an account for companies, cost centres, months and journal lines.</p>' +
                FL.table([{ label: 'Account', key: 'code' }, { label: 'Name', key: 'name' }, { label: 'Amount', n: 1, get: function (r) { return FL.num(r.amount); } },
                    { label: 'Share', n: 1, get: function (r) { return total ? (r.amount / total * 100).toFixed(1) + '%' : ''; } }], parts, { click: true });
            csv = function () { FL.csv('drill-accounts.csv', ['account', 'name', 'amount'], parts.map(function (p) { return [p.code, p.name, p.amount.toFixed(2)]; })); };
        }
        FL.modal('<i class="fa-solid fa-magnifying-glass-chart"></i> Drill-down', html, '<button class="btn sm" id="dr-csv"><i class="fa-solid fa-file-csv"></i> CSV</button>');
        $('dr-csv').onclick = csv;
        document.querySelectorAll('#m-body [data-dv]').forEach(function (b) { b.onclick = function () { FL.drillView = b.dataset.dv; FL.drillCell(tpl, opts, rowId, colId, b.dataset.dv); }; });
        if (view === 'months' && mx) {
            var ds = [{ type: 'bar', label: FINE.colLabel(col, data._pi, opts.period), data: mx.months.map(function (m) { return m.value; }), backgroundColor: FL.PAL.act, borderRadius: 3, order: 2 },
                { type: 'line', label: 'Same month last year', data: mx.months.map(function (m) { return m.py; }), borderColor: FL.PAL.py, backgroundColor: FL.PAL.py, pointRadius: 3, order: 1 }];
            if (!mx.balance && !mx.pct && mx.months.some(function (m) { return m.ytd != null; })) {
                ds[0].label = 'PTD'; ds[1].label = 'PTD last year';
                ds.push({ type: 'line', label: 'YTD', data: mx.months.map(function (m) { return m.ytd; }), borderColor: '#7c3aed', backgroundColor: '#7c3aed', pointRadius: 2, yAxisID: 'y1', order: 0 },
                    { type: 'line', label: 'YTD last year', data: mx.months.map(function (m) { return m.pyYtd; }), borderColor: '#a78bfa', borderDash: [5, 4], pointRadius: 0, yAxisID: 'y1', order: 0 });
            }
            var sc = { y: FL.moneyAxis() }; if (ds.length > 2) sc.y1 = Object.assign(FL.moneyAxis(), { position: 'right', grid: { display: false } });
            FL.chart('drillc', { type: 'bar', data: { labels: mx.months.map(function (m) { return m.name; }), datasets: ds }, options: { scales: sc, plugins: { legend: { labels: { boxWidth: 10, font: { size: 10 } } } } } });
            FL.charts.drill = FL.charts.drillc;
            if (hasAcc) FL.wireRows($('m-body'), mx.months, function (m) { FL.drillMonth(m, ctx, data); });
        } else if (view === 'matrix' && mx) FL.wireRows($('m-body'), mx.accounts, function (a) { FL.drillAccount(a.code, ctx); });
        else FL.wireRows($('m-body'), parts, function (p) { FL.drillAccount(p.code, ctx); });
    }).catch(function (e) { FL.toast(String(e), 'err'); });
};
/** One month of a drilled cell: its accounts for that month → companies / cost centres → journal lines */
FL.drillMonth = function (m, ctx, data) {
    var mcol = { id: 'mm', scenario: ctx.col.scenario || 'ACTUAL', range: ctx.col.range === 'BAL' || ctx.col.range === 'OPEN' ? 'BAL' : 'MTD' };
    var parts = FINE.explain(ctx.tpl, data, Object.assign({}, FL.drillOpts, { period: m.seq, columns: [mcol] }), ctx.row.id, 'mm'), total = parts.reduce(function (s, x) { return s + x.amount; }, 0);
    var mctx = Object.assign({}, ctx, { seqs: [m.seq], label: ctx.row.label + ' · ' + m.name });
    var html = '<div class="crumbs"><a id="dm-back">' + esc(ctx.label) + '</a> › <b>' + esc(m.name) + '</b></div>' +
        '<p class="sm muted">' + parts.length + ' account(s) in ' + esc(m.name) + ', total ' + FL.num(total) + ' (' + FL.scaleLabel() + '). Click an account for companies, cost centres and journal lines.</p>' +
        FL.table([{ label: 'Account', key: 'code' }, { label: 'Name', key: 'name' }, { label: 'Amount', n: 1, get: function (r) { return FL.num(r.amount); } },
            { label: 'Share', n: 1, get: function (r) { return total ? (r.amount / total * 100).toFixed(1) + '%' : ''; } }], parts, { click: true });
    FL.modal('<i class="fa-solid fa-magnifying-glass-chart"></i> ' + esc(m.name), html);
    $('dm-back').onclick = function () { FL.drillCell(ctx.tpl, FL.drillOpts, ctx.row.id, ctx.col.id, 'months'); };
    FL.wireRows($('m-body'), parts, function (p) { FL.drillAccount(p.code, mctx); });
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
