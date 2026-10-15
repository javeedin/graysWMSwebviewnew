/* Sales Lens — Setup & data: Python (install / update / versions / self-test), Data (Fusion sync month by month, build & score,
 * demo data, the live job), Quality (data-quality rules, reconciliation with Fusion, quarantine), Settings (every threshold —
 * nothing hard-coded), Storage (the DuckDB file, the APEX copy WMS_SI_*, clearing). Host: classes/Form1_SalesLensHandlers.cs. */
(function () {
    'use strict';
    var SL = window.SL, esc = SL.esc;
    var el = null, poll = null, busy = '', last = null, sub = 'python', wasRunning = false, pushing = '';
    var SUBS = [['python', 'fab fa-python', 'Python'], ['data', 'fas fa-cloud-arrow-down', 'Data'], ['quality', 'fas fa-clipboard-check', 'Quality'], ['settings', 'fas fa-sliders', 'Settings'], ['storage', 'fas fa-database', 'Storage']];
    try { sub = localStorage.getItem('saleslens.setup.tab') || 'python'; } catch (e) { }
    var STATE = { ok: ['fa-circle-check', 'ok'], run: ['fa-spinner fa-spin', 'run'], wait: ['fa-circle', 'wait'], fail: ['fa-circle-xmark', 'fail'], warn: ['fa-triangle-exclamation', 'warn'], skip: ['fa-circle-minus', 'wait'] };

    function fact(k, v) { return '<div class="sl-fact"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>'; }
    function jobCard(job, title) {
        if (!job) return '';
        var steps = (job.steps || []).map(function (x) { var st = STATE[x.state] || STATE.wait; return '<div class="sl-step ' + st[1] + '"><i class="fas ' + st[0] + '"></i><b>' + esc(x.label) + '</b><span class="muted small">' + esc(x.detail || '') + '</span></div>'; }).join('');
        var head = job.running ? '<span class="pill now">running since ' + esc(job.started) + '</span>' : job.ok ? '<span class="pill good">finished</span>' : '<span class="pill bad">' + esc(job.error || 'stopped') + '</span>';
        return '<div class="card"><h2><i class="fas fa-gears"></i> ' + esc(title) + ' ' + head + (job.running && title !== 'Install' ? '<span class="sp"></span><button class="btn sm" data-a="cancel"><i class="fas fa-stop"></i> Stop</button>' : '') + '</h2><div class="sl-steps">' + steps + '</div>' +
            '<details class="sl-log"' + (job.running || !job.ok ? ' open' : '') + '><summary>Log (' + (job.lines || []).length + ' lines)</summary><pre class="sl-logp">' + esc((job.lines || []).join('\n')) + '</pre></details></div>';
    }

    // ── Python ────────────────────────────────────────────────────
    var USE = { numpy: 'numbers and arrays under everything', pandas: 'order lines, months, customers × items', statsmodels: 'statistics (baselines, tests)', 'scikit-learn': 'accuracy checks, logistic regression',
        lightgbm: 'predictions with the reasons behind each score', duckdb: 'the results file on this PC (same engine version as the app)', pyarrow: 'fast columnar data', joblib: 'saving models' };
    function pythonHtml(s) {
        var v = s && s.versions, job = s && s.job, running = job && job.running, installed = s && s.venv, test = s && s.selftest;
        var badge = !s ? '<span class="pill">checking…</span>' : running ? '<span class="pill now"><i class="fas fa-spinner fa-spin"></i> installing</span>' : !installed ? '<span class="pill bad">not installed</span>'
            : v && v.ok && test && test.ok ? '<span class="pill good"><i class="fas fa-check"></i> ready</span>' : v && v.ok ? '<span class="pill warn">installed · run the self-test</span>' : '<span class="pill warn">needs attention</span>';
        var dis = running || busy ? ' disabled' : '';
        var pk = !v ? '<p class="muted">Not checked yet.</p>' : '<table class="sl-tbl"><thead><tr><th>Package</th><th>Needs</th><th>Installed</th><th>Status</th><th>Used for</th></tr></thead><tbody>' + (v.packages || []).map(function (p) {
            return '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.required || 'any') + '</td><td>' + esc(p.installed || '—') + '</td><td>' + (p.ok ? '<span class="pill good">OK</span>' : !p.installed ? '<span class="pill bad">missing</span>' : p.error ? '<span class="pill bad">does not load</span>' : '<span class="pill warn">too old</span>') + (p.error ? '<div class="small r">' + esc(p.error) + '</div>' : '') + '</td><td class="small muted">' + esc(USE[p.name] || '') + '</td></tr>';
        }).join('') + '</tbody></table>';
        var tt = !test ? '<p class="muted">Not run yet — a small model on made-up data, no Fusion or APEX.</p>' : !test.steps ? '<p class="r">' + esc(test.error) + '</p>' : '<table class="sl-tbl"><tbody>' + test.steps.map(function (x) { return '<tr><td>' + (x.ok ? '<i class="fas fa-circle-check g"></i>' : '<i class="fas fa-circle-xmark r"></i>') + ' ' + esc(x.step) + '</td><td class="' + (x.ok ? '' : 'r') + '">' + esc(x.detail) + '</td><td class="num">' + esc(x.ms) + ' ms</td></tr>'; }).join('') + '</tbody></table>';
        return '<div class="card"><h2><i class="fab fa-python"></i> Python for Sales Lens ' + badge + '</h2>' +
            '<p class="muted">The baselines, models and simulations run in Python on this PC, in <code>' + esc((s && s.folder) || 'C:\\fusion\\saleslens') + '</code> — a private Python (no admin, nothing on PATH; the pipeline server\'s Python is reused when present).</p>' +
            '<div class="sl-facts">' + fact('Python', v && v.python ? v.python : installed ? 'installed' : '—') + fact('Environment', installed ? '<code>' + esc(s.python) + '</code>' : 'not created yet') +
            fact('Last check', esc((s && s.versionsAt) || '—')) + fact('Last self-test', s && s.selftestAt ? esc(s.selftestAt) + (test ? (test.ok ? ' · <b class="g">passed</b>' : ' · <b class="r">failed</b>') : '') : '—') + '</div>' +
            '<div class="sl-bar"><button class="btn pri" data-a="install"' + dis + '><i class="fas fa-download"></i> ' + (installed ? 'Repair / reinstall' : 'Install everything') + '</button>' +
            '<button class="btn" data-a="upgrade"' + (installed ? dis : ' disabled') + '><i class="fas fa-arrows-rotate"></i> Update packages</button>' +
            '<button class="btn" data-a="check"' + (installed ? dis : ' disabled') + '><i class="fas fa-list-check"></i> Check versions</button>' +
            '<button class="btn" data-a="selftest"' + (installed ? dis : ' disabled') + '><i class="fas fa-vial"></i> Run self-test</button>' +
            '<button class="btn ghost" data-a="folder"><i class="fas fa-folder-open"></i> Open folder</button>' + (busy ? '<span class="muted small"><i class="fas fa-spinner fa-spin"></i> ' + esc(busy) + '</span>' : '') + '</div>' +
            (s && s.ok === false ? '<p class="r">' + esc(s.error) + '</p>' : '') + '</div>' + jobCard(job, 'Install') +
            '<div class="card"><h2><i class="fas fa-cubes"></i> Packages ' + (v ? '<span class="muted small">Python ' + esc(v.python) + '</span>' : '') + '</h2>' + pk + '</div>' +
            '<div class="card"><h2><i class="fas fa-vial"></i> Self-test</h2>' + tt + '</div>';
    }

    // ── Data ──────────────────────────────────────────────────────
    function monthsAll(n) { var out = [], d = new Date(); for (var i = n - 1; i >= 0; i--) { var x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(x.getFullYear() * 100 + x.getMonth() + 1); } return out; }
    function dataHtml(s) {
        var d = (s && s.data) || {}, man = d.manifest || {}, mm = man.months || {}, have = {}, set = SL.settings || {};
        (d.months || []).forEach(function (m) { have[m] = 1; });
        var n = +set.monthsBack || 24, want = monthsAll(n), missing = want.filter(function (m) { return !have[m]; });
        var job = s && s.dataJob, running = job && job.running, py = s && s.venv, run = d.lastRun;
        var dis = running || !py ? ' disabled' : '';
        var demo = man.kind === 'demo';
        return '<div class="card"><h2><i class="fas fa-cloud-arrow-down"></i> Order history from Fusion ' + (demo ? '<span class="pill warn">demo data on this PC</span>' : (d.months || []).length ? '<span class="pill good">' + (d.months || []).length + ' month(s) on this PC</span>' : '<span class="pill">nothing yet</span>') + '</h2>' +
            '<p class="muted">Order lines are read month by month (latest change version of each order, keyset pages), with items, customers, item costs, exchange rates, units of measure, today\'s on-hand and the overdue balances. ' +
            'Each month is checked against Fusion\'s own count and total. The WMS out-of-stock cancellations come from APEX. Then the results are built in Python and kept in DuckDB on this PC; the ranked list, scores and feedback are copied to APEX.</p>' +
            (!py ? '<p class="r"><i class="fas fa-triangle-exclamation"></i> Install Python first (the Python tab).</p>' : '') +
            '<div class="sl-facts">' + fact('Fusion pod', esc(set.pod || 'PROD')) + fact('History', n + ' months · ' + missing.length + ' not on this PC') + fact('Last sync', esc(man.readAt || '—')) +
            fact('Last build', run ? esc(String(run.ended || '').replace('T', ' ')) + ' · <b>' + SL.n(run.opportunities) + '</b> opportunities' : '—') + fact('Nightly', (set.nightly || {}).on ? 'on at ' + esc((set.nightly || {}).at || '02:30') + (d.nightly ? ' · last ' + esc(d.nightly.day + ' ' + (d.nightly.state || '')) : '') : 'off (Settings)') + '</div>' +
            '<div class="sl-bar"><button class="btn pri" data-a="sync-missing"' + dis + '><i class="fas fa-cloud-arrow-down"></i> Sync ' + (missing.length ? missing.length + ' missing month(s)' : 'the recent months') + '</button>' +
            '<button class="btn" data-a="sync-recent"' + dis + ' title="Order statuses change: read the last 2 months again"><i class="fas fa-rotate"></i> Re-read last 2 months</button>' +
            '<button class="btn" data-a="sync-all"' + dis + '><i class="fas fa-arrows-rotate"></i> Re-read everything</button>' +
            '<button class="btn" data-a="build"' + dis + '><i class="fas fa-hammer"></i> Build &amp; score now</button>' +
            '<button class="btn ghost" data-a="demo"' + dis + '><i class="fas fa-flask"></i> Try with demo data</button></div>' +
            (pushing ? '<p class="small"><i class="fas fa-spinner fa-spin"></i> Copying to APEX · ' + esc(pushing) + '</p>' : '') + '</div>' +
            jobCard(job, 'Sync & build') +
            '<div class="card"><h2><i class="fas fa-calendar"></i> Months</h2><div class="months">' + want.map(function (m) {
                var e = mm[String(m)], st = !have[m] ? 'miss' : e && e.fusionRows != null && +e.fusionRows !== +e.rows ? 'diff' : 'ok';
                return '<div class="mo ' + st + '" title="' + esc(SL.month(m) + (e ? ' · ' + SL.n(e.rows) + ' lines · Fusion ' + (e.fusionRows == null ? '?' : SL.n(e.fusionRows)) + ' · read ' + e.readAt : ' · not on this PC')) + '"><b>' + esc(SL.month(m)) + '</b><span>' + (e ? SL.n(e.rows) : '—') + '</span></div>';
            }).join('') + '</div><p class="small muted"><span class="mo ok sw"></span> ties to Fusion · <span class="mo diff sw"></span> differs from Fusion\'s count (re-read it) · <span class="mo miss sw"></span> not on this PC</p></div>';
    }

    function oosPull() {
        var n = Math.max(3, +SL.settings.monthsBack || 24);
        return SL.apex.rows("SELECT item AS ITEM, TO_CHAR(logged_at, 'YYYY-MM-DD HH24:MI:SS') AS LOGGED_AT, result AS RESULT, message AS MESSAGE, order_number AS ORDER_NUMBER FROM wms_w2_cancel_log " +
            "WHERE result = 'DONE' AND item IS NOT NULL AND logged_at >= ADD_MONTHS(SYSDATE, -" + n + ") ORDER BY logged_at DESC", 1000, true)
            .then(function (rows) { return SL.call('salesLensPutRaw', { name: 'oos', rows: rows }); })
            .catch(function () { return null; });   // no cancellation log (an older WMS) — the Fusion cancel reasons still count
    }
    function sync(kind) {
        var n = +SL.settings.monthsBack || 24, have = {};
        ((last && last.data && last.data.months) || []).forEach(function (m) { have[m] = 1; });
        var all = monthsAll(n), months, refresh = false;
        if (kind === 'missing') { months = all.filter(function (m) { return !have[m]; }); if (!months.length) { months = all.slice(-2); refresh = true; } }
        else if (kind === 'recent') { months = all.slice(-2); refresh = true; }
        else { months = all; refresh = true; if (!window.confirm('Read all ' + n + ' months from Fusion again? It can take a while; the app stays usable.')) return; }
        busy = 'reading the WMS out-of-stock log from APEX'; paint();
        oosPull().then(function () {
            busy = '';
            return SL.call('salesLensSync', { months: months, refresh: refresh, pod: SL.settings.pod || '' });
        }).then(function (r) { SL.toast(r.message || 'Started'); refresh_(); }).catch(function (e) { busy = ''; SL.toast(e.message, 'err'); paint(); });
    }

    // ── Quality ───────────────────────────────────────────────────
    function qualityLoad(box) {
        SL.qs(['SELECT * FROM sl_dq', 'SELECT * FROM sl_recon ORDER BY month DESC', 'SELECT COUNT(*) AS n FROM sl_quarantine', 'SELECT * FROM sl_quarantine LIMIT 200']).then(function (d) {
            if (d.missing) { box.innerHTML = '<div class="card"><p class="muted">Nothing built yet.</p></div>'; return; }
            box.innerHTML = '<div class="card"><h2><i class="fas fa-clipboard-check"></i> Data-quality rules <span class="muted small">of the last build</span></h2><table class="sl-tbl"><thead><tr><th>Rule</th><th></th><th class="num">Rows</th><th>Detail</th></tr></thead><tbody>' +
                d[0].map(function (r) { return '<tr><td>' + esc(r.rule) + '</td><td><span class="pill ' + ({ OK: 'good', WARN: 'warn', INFO: '' }[r.severity] || '') + '">' + esc(r.severity) + '</span></td><td class="num">' + SL.n(r.rows) + '</td><td class="small muted">' + esc(r.detail || '') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
                '<div class="card"><h2><i class="fas fa-scale-balanced"></i> Reconciliation with Fusion <span class="muted small">lines and amount read vs Fusion\'s own COUNT / SUM for the month</span></h2><div id="q-rec"></div></div>' +
                '<div class="card"><h2><i class="fas fa-box-archive"></i> Quarantined rows <span class="pill">' + SL.n((d[2][0] || {}).n) + '</span></h2><div id="q-q"></div></div>';
            SL.grid(box.querySelector('#q-rec'), { name: 'sales-lens-reconciliation', rows: d[1], limit: 60, cols: [{ k: 'month', label: 'Month', text: function (r) { return SL.month(r.month); } }, { k: 'rows', label: 'Lines read', num: true }, { k: 'fusion_rows', label: 'Fusion count', num: true },
                { k: 'amount', label: 'Amount read', num: true, html: function (r) { return SL.money(r.amount, true); } }, { k: 'fusion_amount', label: 'Fusion amount', num: true, html: function (r) { return r.fusion_amount == null ? '' : SL.money(r.fusion_amount, true); } },
                { k: 'status', label: 'Status', html: function (r) { return '<span class="pill ' + (r.status === 'OK' ? 'good' : 'bad') + '">' + esc(r.status) + '</span>'; } }, { k: 'read_at', label: 'Read' }] });
            var q = d[3], cols = q.length ? Object.keys(q[0]).filter(function (k) { return ['reason', 'REASON', 'FULFILL_LINE_ID', 'ORDER_NUMBER', 'ORDERED_DATE', 'ACCOUNT_NUMBER', 'ITEM_NUMBER', 'ORDERED_QTY', 'STATUS'].indexOf(k) >= 0; }) : [];
            if (q.length) SL.grid(box.querySelector('#q-q'), { name: 'sales-lens-quarantine', rows: q, limit: 50, cols: cols.map(function (k) { return { k: k, label: k }; }) });
            else box.querySelector('#q-q').innerHTML = '<p class="muted">None.</p>';
        });
    }

    // ── Settings ──────────────────────────────────────────────────
    var FIELDS = [
        ['Data', [['pod', 'Fusion pod', 'select:PROD,TEST'], ['monthsBack', 'Months of history', 'num'], ['reportingCurrency', 'Reporting currency', 'text'], ['businessUnits', 'Business unit ids to keep (empty = all)', 'list'],
            ['excludeZeroPrice', 'Leave out zero-price lines (BOGO / free)', 'bool'], ['excludeItemPatterns', 'Leave out items whose number / name contains', 'list'], ['excludeOrderTypes', 'Leave out order type codes', 'list'],
            ['excludeLinePattern', 'Leave out line numbers matching (crate / consignment sub-lines)', 'text'], ['itemDff.profitCenter', 'Item DFF column: profit centre', 'text'], ['itemDff.supplier', 'Item DFF column: supplier', 'text']]],
        ['Missed opportunities', [['analysisMonths', 'Analysis window (last full months)', 'num'], ['minHistoryMonths', 'Months bought (of 12) before a baseline counts', 'num'], ['minGapValue', 'Smallest lost revenue that counts', 'num'],
            ['minDropPct', 'Smallest drop % vs expected', 'num'], ['zThreshold', 'Smallest gap in standard deviations', 'num'], ['marginFallbackPct', 'Margin % when an item has no cost', 'num'], ['includeCurrentMonth', 'Count the running month', 'bool']]],
        ['Cause evidence', [['lateDays', 'Late = days after the promise', 'num'], ['priceUpPct', 'Price increase from %', 'num'], ['discountDownPts', 'Discount cut from points', 'num'], ['returnRatePct', 'High returns from %', 'num'],
            ['partialRatePct', 'Partial deliveries from %', 'num'], ['itemDropPct', 'Item down for everybody from %', 'num'], ['stockoutCancelPct', 'Stock-out when cancelled for stock ≥ %', 'num']]],
        ['Scores and models', [['recoverability', 'Recoverable share per cause', 'json'], ['tierWeights', 'Weight per account tier', 'json'], ['defaultElasticity', 'Price response when it cannot be estimated', 'num'],
            ['churnHorizonMonths', 'Customer risk looks ahead (months)', 'num'], ['churnDropPct', 'Customer risk = spend falls by %', 'num']]],
        ['Schedule, APEX and access', [['nightly.on', 'Nightly sync + build (while the app is open)', 'bool'], ['nightly.at', 'Nightly at (HH:mm)', 'text'], ['nightly.refreshMonths', 'Nightly re-reads the last n months', 'num'],
            ['apexAuto', 'Copy every build to APEX', 'bool'], ['topToApex', 'Opportunities / scores copied per run', 'num'], ['apexBase', 'APEX for the WMS_SI_* copy (blank = the app\'s APEX)', 'text'], ['allowedBus', 'Business units per login, e.g. {"MARY": ["300000003234003"]}', 'json']]]
    ];
    var DEF = { pod: 'PROD', monthsBack: 24, reportingCurrency: 'MUR', businessUnits: [], excludeZeroPrice: true, excludeItemPatterns: ['CRATE', 'CONSIGN', 'EMPTY', 'DEPOSIT'], excludeOrderTypes: [], excludeLinePattern: '\\.\\d+$',
        itemDff: { profitCenter: 'ATTRIBUTE1', supplier: 'ATTRIBUTE2' }, analysisMonths: 3, minHistoryMonths: 4, minGapValue: 1000, minDropPct: 30, zThreshold: 1.2, marginFallbackPct: 25, includeCurrentMonth: false,
        lateDays: 2, priceUpPct: 3, discountDownPts: 2, returnRatePct: 10, partialRatePct: 15, itemDropPct: 40, stockoutCancelPct: 10,
        recoverability: { STOCKOUT: 0.65, PARTIAL: 0.6, LATE: 0.5, CANCEL: 0.55, PRICE_UP: 0.4, DISCOUNT_DOWN: 0.45, MARGIN_LEAK: 0.3, RETURNS: 0.35, PAYMENT: 0.3, CYCLE: 0.5, INACTIVE: 0.35, SEASONAL: 0.2, LIFECYCLE: 0.1, SUBSTITUTION: 0.25, UNKNOWN: 0.35 },
        tierWeights: { A: 1.25, B: 1.0, C: 0.8 }, defaultElasticity: -1.2, churnHorizonMonths: 3, churnDropPct: 50, nightly: { on: false, at: '02:30', refreshMonths: 2 }, apexAuto: true, topToApex: 2000, apexBase: '', allowedBus: {} };
    function getp(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? undefined : a[k]; }, o); }
    function setp(o, path, v) { var ks = path.split('.'), x = o; ks.slice(0, -1).forEach(function (k) { if (typeof x[k] !== 'object' || x[k] == null) x[k] = {}; x = x[k]; }); x[ks[ks.length - 1]] = v; }
    function settingsHtml() {
        var s = SL.settings || {};
        return '<div class="card"><h2><i class="fas fa-sliders"></i> Settings <span class="muted small">saved on this PC (data\\settings.json) and in APEX · AI admins only · take effect at the next build</span></h2>' +
            FIELDS.map(function (g) {
                return '<h3>' + esc(g[0]) + '</h3><div class="sform">' + g[1].map(function (f) {
                    var v = getp(s, f[0]); if (v === undefined) v = getp(DEF, f[0]);
                    var t = f[2], inp;
                    if (t === 'bool') inp = '<input type="checkbox" data-s="' + f[0] + '" data-t="bool"' + (v ? ' checked' : '') + '>';
                    else if (t.indexOf('select:') === 0) inp = '<select data-s="' + f[0] + '" data-t="text">' + t.slice(7).split(',').map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>';
                    else if (t === 'json') inp = '<textarea data-s="' + f[0] + '" data-t="json" rows="3">' + esc(JSON.stringify(v == null ? {} : v)) + '</textarea>';
                    else if (t === 'list') inp = '<input data-s="' + f[0] + '" data-t="list" value="' + esc((v || []).join(', ')) + '">';
                    else inp = '<input data-s="' + f[0] + '" data-t="' + t + '" value="' + esc(v == null ? '' : v) + '">';
                    return '<label class="' + (t === 'json' ? 'wide' : '') + '"><span>' + esc(f[1]) + '</span>' + inp + '</label>';
                }).join('') + '</div>';
            }).join('') + '<div class="sl-bar"><button class="btn pri" data-a="save-settings"><i class="fas fa-floppy-disk"></i> Save settings</button><button class="btn ghost" data-a="defaults">Default values</button></div></div>';
    }
    function saveSettings() {
        var s = JSON.parse(JSON.stringify(SL.settings || {})), bad = null;
        el.querySelectorAll('[data-s]').forEach(function (i) {
            var t = i.dataset.t, v;
            if (t === 'bool') v = i.checked; else if (t === 'num') { v = i.value === '' ? null : +i.value; if (v != null && !isFinite(v)) bad = i.dataset.s; }
            else if (t === 'list') v = i.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
            else if (t === 'json') { try { v = JSON.parse(i.value || '{}'); } catch (e) { bad = i.dataset.s; } }
            else v = i.value.trim();
            setp(s, i.dataset.s, v);
        });
        if (bad) { SL.toast('Not valid: ' + bad, 'err'); return; }
        SL.call('salesLensSettings', { settings: s }).then(function (r) {
            SL.settings = r.settings || s; SL.ref = null; SL.toast('Settings saved on this PC');
            return SL.apex.saveSettings(SL.settings).then(function () { SL.toast('… and in APEX'); }).catch(function (e) { SL.toast('Not in APEX: ' + e.message, 'err'); });
        }).catch(function (e) { SL.toast(e.message, 'err'); });
    }

    // ── Storage ───────────────────────────────────────────────────
    function storageLoad(box, s) {
        var d = (s && s.data) || {};
        box.innerHTML = '<div class="card"><h2><i class="fas fa-database"></i> On this PC <span class="muted small">' + esc(d.folder || '') + '</span></h2><div class="sl-facts">' +
            fact('DuckDB file', d.db ? SL.n(d.db.size / 1048576, 1) + ' MB · ' + esc(d.db.modified) : 'not built yet') + fact('Months of raw extracts', SL.n((d.months || []).length)) + fact('Feedback rows', SL.n(d.feedback || 0)) + '</div>' +
            '<div id="st-tables" class="small muted">Reading the tables…</div>' +
            '<div class="sl-bar"><button class="btn ghost" data-a="folder"><i class="fas fa-folder-open"></i> Open folder</button><button class="btn" data-a="clear-results"><i class="fas fa-eraser"></i> Clear results</button>' +
            '<button class="btn" data-a="clear-raw"><i class="fas fa-eraser"></i> Clear Fusion extracts</button><button class="btn" data-a="clear-all"><i class="fas fa-trash"></i> Clear everything</button></div></div>' +
            '<div class="card"><h2><i class="fas fa-cloud"></i> APEX copy (WMS_SI_*) <span class="muted small">' + esc(SL.apex.where()) + '</span></h2><div id="st-apex" class="muted small">Reading APEX…</div>' +
            '<div class="sl-bar"><button class="btn" data-a="push"><i class="fas fa-cloud-arrow-up"></i> Copy the latest build to APEX</button><button class="btn ghost" data-a="apex-tables"><i class="fas fa-table"></i> Create the tables</button></div></div>';
        SL.q("SELECT table_name, estimated_size FROM duckdb_tables() WHERE database_name = 'sl' ORDER BY table_name").then(function (r) {
            box.querySelector('#st-tables').innerHTML = '<table class="sl-tbl"><tbody>' + r.map(function (t) { return '<tr><td><code>' + esc(t.table_name) + '</code></td><td class="num">' + SL.n(t.estimated_size) + ' rows</td></tr>'; }).join('') + '</tbody></table>';
        }).catch(function (e) { box.querySelector('#st-tables').textContent = e.message; });
        SL.apex.status().then(function (r) {
            var x = r[0] || {};
            box.querySelector('#st-apex').innerHTML = '<div class="sl-facts">' + fact('Runs', SL.n(x.RUNS)) + fact('Last run copied', esc(x.LAST_RUN || '—')) + fact('Opportunities', SL.n(x.OPPS)) + fact('Feedback', SL.n(x.FEEDBACK)) + fact('Scenarios', SL.n(x.SIMS)) + '</div>';
        }).catch(function (e) { box.querySelector('#st-apex').innerHTML = /ORA-00942|does not exist/i.test(e.message) ? 'The tables are not there yet — they are created with the first copy.' : '<span class="r">' + esc(e.message) + '</span>'; });
    }
    function push() {
        pushing = 'starting'; paint();
        return SL.apex.pushRun(function (st) { pushing = st; var p = el && el.querySelector('.push-st'); if (p) p.textContent = st; }).then(function (r) {
            pushing = '';
            SL.toast(r.already ? 'This build is already in APEX' : 'Copied to APEX: ' + r.opps + ' opportunities, ' + r.customers + ' customer scores, ' + r.risk + ' order lines');
            paint();
        }).catch(function (e) { pushing = ''; SL.toast('APEX: ' + e.message, 'err'); paint(); });
    }

    // ── paint / actions ──────────────────────────────────────────
    function paint() {
        if (!el) return;
        var logs = el.querySelectorAll('.sl-logp'), stick = [].map.call(logs, function (l) { return l.scrollTop + l.clientHeight >= l.scrollHeight - 8; });
        var nav = '<div class="subtabs">' + SUBS.map(function (x) { return '<button data-sub="' + x[0] + '" class="' + (sub === x[0] ? 'on' : '') + '"><i class="' + x[1] + '"></i> ' + x[2] + '</button>'; }).join('') + '</div>';
        var body = sub === 'python' ? pythonHtml(last) : sub === 'data' ? dataHtml(last) : sub === 'settings' ? settingsHtml() : '<div id="sub-box"><div class="card muted">Reading…</div></div>';
        el.innerHTML = nav + '<div class="sl-grid">' + body + '</div>';
        if (sub === 'quality') qualityLoad(el.querySelector('#sub-box'));
        if (sub === 'storage') storageLoad(el.querySelector('#sub-box'), last);
        el.querySelectorAll('.sl-logp').forEach(function (l, i) { if (stick[i] !== false || (last && ((last.job || {}).running || (last.dataJob || {}).running))) l.scrollTop = l.scrollHeight; });
    }
    function refresh_() {
        return SL.host('salesLensStatus', {}, 30000).then(function (s) {
            last = s;
            var dj = s.dataJob, running = (s.job && s.job.running) || (dj && dj.running);
            if (wasRunning && dj && !dj.running && dj.ok) {
                SL.ref = null;
                SL.toast('Build finished — the screens read the new results');
                if (SL.settings.apexAuto !== false) push();
            }
            wasRunning = !!(dj && dj.running);
            if (el && !(sub === 'settings' && document.activeElement && el.contains(document.activeElement))) paint();
            clearTimeout(poll);
            if (running && el) poll = setTimeout(refresh_, 1500);
        }).catch(function (e) { last = { ok: false, error: e.message }; paint(); });
    }
    function act(a) {
        if (a === 'folder') { SL.host('salesLensOpenFolder').catch(function (e) { SL.toast(e.message, 'err'); }); return; }
        if (a === 'install' || a === 'upgrade') {
            if (!window.confirm(a === 'upgrade' ? 'Update every Sales Lens package to the newest allowed version?' : 'Install Python and the Sales Lens packages on this PC?\n\nAbout 250 MB is downloaded the first time.')) return;
            SL.call('salesLensInstall', { upgrade: a === 'upgrade' }).then(function (r) { SL.toast(r.message || 'Started'); refresh_(); }).catch(function (e) { SL.toast(e.message, 'err'); });
            return;
        }
        if (a === 'check' || a === 'selftest') {
            busy = a === 'check' ? 'checking the versions…' : 'running the self-test…'; paint();
            SL.host(a === 'check' ? 'salesLensCheck' : 'salesLensSelfTest', {}, a === 'check' ? 150000 : 330000).then(function (r) {
                busy = ''; SL.toast(r.ok ? (a === 'check' ? 'Every package is installed and loads.' : 'Self-test passed.') : (r.error || (a === 'check' ? 'A package needs attention.' : 'The self-test failed.')), r.ok ? '' : 'err'); return refresh_();
            }).catch(function (e) { busy = ''; SL.toast(e.message, 'err'); paint(); });
            return;
        }
        if (a === 'sync-missing') return sync('missing');
        if (a === 'sync-recent') return sync('recent');
        if (a === 'sync-all') return sync('all');
        if (a === 'build' || a === 'demo') {
            if (a === 'demo' && !window.confirm('Make a made-up wholesaler (30 months, 60 customers, 60 items, problems planted) on this PC and build it?\n\nNothing goes to Fusion. Clear it later in Storage.')) return;
            SL.call(a === 'demo' ? 'salesLensDemo' : 'salesLensBuild', {}).then(function (r) { SL.toast(r.message || 'Started'); wasRunning = true; refresh_(); }).catch(function (e) { SL.toast(e.message, 'err'); });
            return;
        }
        if (a === 'cancel') { SL.host('salesLensCancel').then(function () { SL.toast('Stopping after the page in hand…'); }); return; }
        if (a === 'save-settings') return saveSettings();
        if (a === 'defaults') { if (window.confirm('Put every field back to its default (not saved until you press Save)?')) { var keep = SL.settings; SL.settings = JSON.parse(JSON.stringify(DEF)); paint(); SL.settings = keep; } return; }
        if (a === 'push') return push();
        if (a === 'apex-tables') { SL.apex.ensure().then(function (m) { SL.toast(m.length ? 'Created ' + m.join(', ') : 'Every table is there'); paint(); }).catch(function (e) { SL.toast(e.message, 'err'); }); return; }
        if (a.indexOf('clear-') === 0) {
            var what = a.slice(6);
            if (!window.confirm({ results: 'Remove the built results from this PC? (the extracts stay; Build makes them again)', raw: 'Remove the Fusion extracts from this PC? (Sync reads them again)', all: 'Remove EVERYTHING Sales Lens keeps on this PC (extracts, results, scenarios, feedback)? APEX keeps its copy.' }[what])) return;
            SL.call('salesLensClear', { what: what }).then(function (r) { SL.ref = null; SL.toast('Removed ' + r.removed + ' item(s)'); refresh_(); }).catch(function (e) { SL.toast(e.message, 'err'); });
        }
    }

    window.SalesLensSetup = {
        render: function (main) {
            el = main; paint();
            el.onclick = function (e) {
                var s2 = e.target.closest('button[data-sub]');
                if (s2) { sub = s2.dataset.sub; try { localStorage.setItem('saleslens.setup.tab', sub); } catch (x) { } paint(); return; }
                var b = e.target.closest('button[data-a]'); if (b && !b.disabled) act(b.dataset.a);
            };
            SL.loadRef().catch(function () { }).then(function () { refresh_(); });
        },
        leave: function () { clearTimeout(poll); if (el) el.onclick = null; el = null; },
        refresh: refresh_,
        state: function () { return last; },
        sub: function (x) { sub = x; paint(); }
    };
    SL.views.setup = { demo: function () { sub = 'data'; paint(); act('demo'); } };
})();
