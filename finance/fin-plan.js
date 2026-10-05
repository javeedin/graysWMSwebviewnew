/* Finance Lens — Planning & budgeting (tab `plan`, FL.plan = PL; engine finance/fin-plan-engine.js FPLAN).
   Versions (budget / forecast / scenario) of the income statement per company (× cost centre) × account × month. Each line has a
   rule (last year + %, run-rate, annual amount spread, start + growth, driver × rate, % of another line, trend, typed in, zero) and the
   months follow it; typing a month makes the line "typed in". Saved in TWO places: APEX (WMS_FIN_PLAN_VERSIONS / _LINES / _EVENTS —
   shared by every PC, FL.apexStore.plan*) and this PC's DuckDB file (fin_plan_versions / _lines / _amounts — host finPlanSave), rev
   tells which copy is newer. A version chosen as budget (config.json plan.budget) replaces the BUDGET scenario in every statement,
   KPI and variance (FL.data). Workflow Draft → Submitted → Approved (an AI admin who did not submit it) / Sent back; approved
   versions are read-only until reopened. Nothing goes to Oracle Fusion. */
(function () {
    'use strict';
    var P = window.FPLAN; if (!P) return;
    var S = FL.apexStore, esc = window.esc;
    var PL = FL.plan = { list: [], v: null, ctx: null, st: FL.ls('plan', {}), dirty: false, open: {} };
    var keep = function () { FL.lsSet('plan', PL.st); };
    var money = function (v) { return v == null || isNaN(v) ? '' : FL.num(v); };
    var pctTxt = function (v) { return v == null || !isFinite(v) ? '' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; };
    var who = function () { return FL.who || {}; };
    var sumOf = function (a) { var s = 0; (a || []).forEach(function (x) { s += +x || 0; }); return s; };
    var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
    var KIND = { BUDGET: 'Budget', FORECAST: 'Forecast', SCENARIO: 'Scenario' };
    var ST_TAG = { DRAFT: '', SUBMITTED: 'warn', APPROVED: 'good', REJECTED: 'bad', BASELINED: 'good' };
    var dp = function () { return FL.filter.scale >= 1000000 ? 1 : 0; };
    var parseNum = function (s) { s = String(s == null ? '' : s).trim().replace(/[,\s]/g, ''); var neg = /^\(.*\)$/.test(s) || /^-/.test(s); s = s.replace(/[()\-]/g, ''); var n = parseFloat(s); return isNaN(n) ? null : (neg ? -n : n); };

    // ═════ the version chosen as budget replaces scenario BUDGET everywhere (statements, KPIs, variance, board pack) ═════
    var data0 = FL.data;
    FL.data = function (extraWhere, key) {
        var bid = FL.config && FL.config.plan && FL.config.plan.budget;
        if (!bid) return data0.apply(this, arguments);
        var w = FL.where('').concat(extraWhere || []), k = 'plan:' + bid + '|' + (key || w.join(' AND '));
        if (FL.cache[k]) return Promise.resolve(FL.cache[k]);
        return data0.apply(this, arguments).then(function (d) {
            return FL.sql('SELECT account, period_seq, fiscal_year, SUM(amount) AS net FROM fin_plan_amounts WHERE version_id = ' + FL.q(bid) + (w.length ? ' AND ' + w.join(' AND ') : '') +
                ' GROUP BY ALL ORDER BY account, period_seq', 500000).then(function (r) {
                var out = Object.assign({}, d, { facts: Object.assign({}, d.facts), budgetFrom: 'plan' }), b = out.facts.BUDGET = {}, run = {}, yr = {};
                r.rows.forEach(function (x) {
                    var a = String(x[0]), seq = +x[1];
                    if (yr[a] !== +x[2]) { yr[a] = +x[2]; run[a] = 0; }
                    run[a] += +x[3] || 0;
                    (b[a] = b[a] || {})[seq] = [+x[3] || 0, run[a]];
                });
                FL.cache[k] = out; return out;
            }).catch(function () { return d; });     // no plan table on this PC yet: the Fusion budget stays
        });
    };

    // ═════ list: APEX (shared) + this PC ═════
    PL.loadList = function () {
        var apex = S.planList().then(function (r) { return { rows: r }; }).catch(function (e) { return { err: String(e && e.message || e) }; });
        var pc = FL.call('finPlanList').then(function (r) { return r.versions || []; }).catch(function () { return []; });
        return Promise.all([apex, pc]).then(function (res) {
            var by = {};
            (res[0].rows || []).forEach(function (x) { by[x.id] = Object.assign({}, x, { apexRev: x.rev }); });
            res[1].forEach(function (x) { var o = by[x.id]; if (!o) o = by[x.id] = Object.assign({}, x); o.pcRev = x.rev; });
            PL.apexErr = res[0].err || null;
            PL.list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return (b.year - a.year) || String(a.name).localeCompare(String(b.name)); });
            return PL.list;
        });
    };
    PL.item = function (id) { return PL.list.filter(function (x) { return x.id === id; })[0]; };

    /** One version from this PC's DuckDB file */
    PL.loadPc = function (id) {
        return Promise.all([
            FL.rows('SELECT meta_json, periods_json, rev, status FROM fin_plan_versions WHERE version_id = ' + FL.q(id), 1),
            FL.rows('SELECT company, cost_centre, account, rule_json, adj, note, amounts_json FROM fin_plan_lines WHERE version_id = ' + FL.q(id), 200000)
        ]).then(function (r) {
            if (!r[0].length) return null;
            var v = JSON.parse(r[0][0].meta_json || '{}'); v.periods = JSON.parse(r[0][0].periods_json || '[]'); v.rev = +r[0][0].rev || 0;
            v.lines = r[1].map(function (l) {
                var rule = null; try { rule = l.rule_json ? JSON.parse(l.rule_json) : null; } catch (e) { rule = null; }
                return { company: l.company || '', cc: l.cost_centre || '', account: l.account, rule: rule || { method: 'manual' }, adj: l.adj == null ? 1 : +l.adj, note: l.note || '', m: JSON.parse(l.amounts_json || '[]') };
            });
            return v;
        });
    };
    PL.norm = function (v) {
        v.lines = v.lines || []; v.drivers = v.drivers || []; v.companies = v.companies || []; v.grain = v.grain || 'account'; v.status = v.status || 'DRAFT';
        v.lines.forEach(function (l) { l.m = v.periods.map(function (_, i) { return +((l.m || [])[i]) || 0; }); l.rule = l.rule || { method: 'manual' }; if (l.adj == null) l.adj = 1; l.cc = l.cc || ''; l.company = l.company || ''; });
        return v;
    };

    /** Opens a version: the newer copy wins (APEX or this PC); the other is brought up to date */
    PL.openVersion = function (id) {
        var it = PL.item(id); if (!it) return Promise.resolve();
        var apexNewer = it.apexRev != null && (it.pcRev == null || it.apexRev >= it.pcRev);
        var p = apexNewer ? S.planLoad(id).catch(function (e) { if (it.pcRev != null) return PL.loadPc(id); throw e; }) : PL.loadPc(id);
        return p.then(function (v) {
            if (!v) throw new Error('Version not found');
            PL.v = PL.norm(v); PL.v.id = id; PL.baseRev = v.rev || 0; PL.dirty = false; PL.st.open = id; keep();
            PL.needApex = it.apexRev == null || (it.pcRev != null && it.pcRev > it.apexRev);
            return PL.prepare().then(function () {
                if (apexNewer && it.pcRev !== it.apexRev) return PL.savePc(PL.v, null).then(function () { it.pcRev = it.apexRev; }).catch(function (e) { console.warn('[Plan] PC copy not updated', e); });
            });
        });
    };

    // ═════ actuals the rules read (fin_balances, income statement accounts, 3 years before the plan → its end) ═════
    PL.prepare = function () {
        var v = PL.v, first = v.periods[0].period_seq, last = v.periods[v.periods.length - 1].period_seq;
        var acc = {}; FL.dims.accounts.forEach(function (a) { acc[a.code] = a; });
        // income statement accounts by the types the page knows (Fusion's, else worked out from the name — FINE.guessType):
        // fin_accounts.account_type in DuckDB is often empty for synced trial balances, so it is not used as a filter
        var isPl = function (c) { var a = acc[c]; return a && (a.account_type === 'R' || a.account_type === 'E'); };
        // company codes may have lost their leading zeros on one side ("1" vs "01"): matched without them
        var nz = function (c) { return String(c == null ? '' : c).replace(/^0+/, '') || '0'; }, coBack = {};
        v.companies.forEach(function (c) { coBack[nz(c)] = c; });
        var w = ["b.scenario = 'ACTUAL'", 'b.period_seq >= ' + (first - 300), 'b.period_seq <= ' + last];
        if (v.ledger && FL.status.hasLedgers) w.push('b.ledger = ' + FL.q(v.ledger));
        if (v.companies.length) w.push("COALESCE(NULLIF(ltrim(CAST(b.company AS VARCHAR), '0'), ''), '0') IN (" + v.companies.map(function (c) { return FL.q(nz(c)); }).join(', ') + ')');
        return FL.rows('SELECT b.company, ' + (v.grain === 'cc' ? 'b.cost_centre' : "''") + ' AS cc, b.account, b.period_seq AS seq, SUM(b.period_net) AS net FROM fin_balances b WHERE ' +
            w.join(' AND ') + ' GROUP BY ALL', 500000).then(function (rows) {
            var pl = rows.filter(function (r) { return isPl(String(r.account)); });
            pl.forEach(function (r) { r.company = coBack[nz(r.company)] || r.company; r.account = String(r.account); });
            PL.ctx = { accounts: acc, hist: P.histFrom(pl, v.grain) };
            PL.ctx.lastActual = P.lastActual(PL.ctx.hist);
            PL.ctx.read = { rows: rows.length, plRows: pl.length, accounts: Object.keys(rows.reduce(function (o, r) { o[r.account] = 1; return o; }, {})).length, lines: Object.keys(PL.ctx.hist).length };
            PL.tpl = PL.pickTpl();
        });
    };
    /** Why a plan has no lines: what DuckDB holds for its ledger / companies / years, step by step */
    PL.diag = function () {
        var v = PL.v, first = v.periods[0].period_seq, last = v.periods[v.periods.length - 1].period_seq, nz = function (c) { return String(c).replace(/^0+/, '') || '0'; };
        var base = "FROM fin_balances b WHERE b.scenario = 'ACTUAL'", led = v.ledger && FL.status.hasLedgers ? ' AND b.ledger = ' + FL.q(v.ledger) : '';
        var cos = v.companies.length ? " AND COALESCE(NULLIF(ltrim(CAST(b.company AS VARCHAR), '0'), ''), '0') IN (" + v.companies.map(function (c) { return FL.q(nz(c)); }).join(', ') + ')' : '';
        var yrs = ' AND b.period_seq >= ' + (first - 300) + ' AND b.period_seq <= ' + last;
        return FL.call('finQueries', { queries: [
            'SELECT COUNT(*), MIN(period_seq), MAX(period_seq) ' + base,
            'SELECT COUNT(*) ' + base + led,
            'SELECT COUNT(*) ' + base + led + cos,
            'SELECT COUNT(*), MIN(period_seq), MAX(period_seq) ' + base + led + cos + yrs,
            'SELECT DISTINCT b.ledger, b.company ' + base + ' ORDER BY 1, 2 LIMIT 40'
        ] }).then(function (r) {
            var x = function (i, j) { var q = r.results[i]; return q && q.rows && q.rows[0] ? q.rows[0][j || 0] : null; };
            return { all: x(0), from: x(0, 1), to: x(0, 2), ledger: x(1), companies: x(2), years: x(3), yFrom: x(3, 1), yTo: x(3, 2),
                pairs: (r.results[4].rows || []).map(function (q) { return (q[0] || '') + ' · ' + q[1]; }), read: PL.ctx.read || {} };
        });
    };
    PL.diagHtml = function (d) {
        var v = PL.v, step = function (ok, txt) { return '<li class="' + (ok ? 'pos' : 'neg') + '">' + (ok ? '✓ ' : '✗ ') + txt + '</li>'; }, n = function (x) { return (+x || 0).toLocaleString(); };
        var led = (FL.dims.ledgers.filter(function (l) { return l.code === v.ledger; })[0] || {}).name || v.ledger;
        return '<div class="callout warn"><b>No plan lines — this is what the DuckDB file on this PC holds:</b><ul class="sm" style="margin:6px 0">' +
            step(d.all > 0, 'actual balances: ' + n(d.all) + (d.all ? ' (' + FL.periodName(d.from) + ' – ' + FL.periodName(d.to) + ')' : ' — sync trial balances first (Data › Trial balance sync)')) +
            (v.ledger ? step(d.ledger > 0, 'of ledger ' + esc(led) + ': ' + n(d.ledger)) : '') +
            step(d.companies > 0, 'of companies ' + esc(v.companies.join(', ')) + ': ' + n(d.companies)) +
            step(d.years > 0, 'in the 3 years before the plan up to ' + esc(v.periods[v.periods.length - 1].period_name) + ': ' + n(d.years) + (d.years ? ' (' + FL.periodName(d.yFrom) + ' – ' + FL.periodName(d.yTo) + ')' : '')) +
            step(d.read.plRows > 0, 'on income statement accounts (revenue / expense): ' + n(d.read.plRows) + ' of ' + n(d.read.rows) + ' rows, ' + n(d.read.lines) + ' account line(s)') +
            '</ul>' + (d.pairs.length ? '<div class="sm muted">Ledger · company pairs in the file: ' + esc(d.pairs.join(', ')) + '</div>' : '') +
            (P.can(v, 'edit', who()) && d.read.lines ? '<div class="row" style="margin-top:6px"><button class="btn primary sm" id="pd-fill"><i class="fa-solid fa-wand-magic"></i> Fill the plan from these actuals (last year + 0 %)</button></div>' :
                '<div class="sm" style="margin-top:6px">Fix the step marked ✗ — e.g. make a new plan for the ledger / companies that have data, or sync their trial balances — then <a id="pd-again">check again</a>.</div>') + '</div>';
    };
    PL.pickTpl = function () {
        var want = (FL.config.plan || {}).tpl, list = FL.templates.filter(function (t) { return FINE.tplKind(t) === 'PL'; });
        return list.filter(function (t) { return t.id === want; })[0] || list.filter(function (t) { return t.simple; })[0] || list[0] || null;
    };
    PL.lineKey = function (l) { return P.key(l); };
    PL.shown = function (l) { return (!PL.st.co || l.company === PL.st.co) && (!PL.st.cc || l.cc === PL.st.cc); };

    /** FINE data: last year's months (actuals) + the plan months, for the company / cost centre on screen */
    PL.data = function () {
        var v = PL.v, dims = {}; FL.dims.periods.forEach(function (p) { dims[p.period_seq] = p; });
        var py = v.periods.map(function (p) { var d = dims[p.period_seq - 100]; return { period_seq: p.period_seq - 100, period_name: d ? d.period_name : 'LY ' + p.period_name, fiscal_year: p.fiscal_year - 1, period_num: p.period_num, quarter: p.quarter }; });
        var facts = P.facts(v, 'PLAN', PL.shown), act = facts.ACTUAL = {};
        Object.keys(PL.ctx.hist).forEach(function (k) {
            var p = k.split('|'); if ((PL.st.co && p[0] !== PL.st.co) || (PL.st.cc && p[1] !== PL.st.cc)) return;
            var h = PL.ctx.hist[k], a = act[p[2]] = act[p[2]] || {};
            py.concat(v.periods).forEach(function (q) { var x = a[q.period_seq] = a[q.period_seq] || [0, 0]; x[0] += h[q.period_seq] || 0; });
        });
        Object.keys(act).forEach(function (a) { var run = 0, yr = null; py.concat(v.periods).forEach(function (q) { if (q.fiscal_year !== yr) { yr = q.fiscal_year; run = 0; } var x = act[a][q.period_seq]; run += x[0]; x[1] = run; }); });
        return { accounts: FL.dims.accounts, periods: py.concat(v.periods), facts: facts };
    };
    /** The statement of the plan: one column per month, the year, last year, change */
    PL.stmt = function () {
        var v = PL.v, n = v.periods.length;
        if (!PL.tpl) return null;
        var cols = v.periods.map(function (p, i) { return { id: 'm' + i, scenario: 'PLAN', range: 'MTD', at: i === n - 1 ? 'CUR' : 'M-' + (n - 1 - i) }; })
            .concat([{ id: 'fy', scenario: 'PLAN', range: 'YTD' }, { id: 'py', scenario: 'ACTUAL', range: 'YTD', at: 'PY' }, { id: 'd', kind: 'var', a: 'fy', b: 'py', mode: 'pct' }]);
        return FINE.compute(PL.tpl, PL.data(), { period: v.periods[n - 1].period_seq, scale: 1, columns: cols });
    };
    PL.totals = function () { return P.totals(PL.v, PL.ctx); };

    // ═════ saving: this PC (DuckDB) first, then APEX ═════
    PL.savePc = function (v, ev) { return FL.call('finPlanSave', { version: Object.assign({}, v, { lines: undefined }), lines: v.lines, event: ev || '' }, 300000); };
    PL.save = function (ev, note, extra) {
        var v = PL.v; if (!v) return Promise.resolve();
        var from = PL.statusBefore || v.status;
        v.rev = (v.rev || 0) + 1; v.changedAt = new Date().toISOString(); v.changedBy = who().user || '';
        var t = PL.totals(), btn = $('pl-save');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving…'; }
        return PL.savePc(v, ev || 'saved').then(function () {
            PL.dirty = false;
            return S.planRev(v.id).catch(function () { return -1; }).then(function (apexRev) {
                if (apexRev > PL.baseRev && !confirm('Someone saved this version in APEX after you opened it (rev ' + apexRev + ', yours ' + PL.baseRev + ').\n\nOK = overwrite it with yours · Cancel = keep theirs in APEX (yours stays on this PC)')) {
                    PL.needApex = true; throw new Error('Not saved in APEX — a newer copy is there');
                }
                return S.planSave(v, { revenue: t.sum.rev, profit: t.sum.np }, function (d, n) { if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> APEX ' + d + '/' + n; })
                    .then(function () { return S.planEvent(v.id, Object.assign({ event: ev || 'saved', from: from, to: v.status, rev: v.rev, note: note || '' }, extra || {})).catch(function () { /* trail only */ }); })
                    .then(function () { PL.needApex = false; PL.baseRev = v.rev; FL.toast('Saved — APEX and this PC (rev ' + v.rev + ')', 'ok'); });
            }).catch(function (e) { PL.needApex = true; FL.toast('Saved on this PC. APEX: ' + (e && e.message || e), 'err'); });
        }).catch(function (e) { FL.toast('Not saved: ' + (e && e.message || e), 'err'); v.rev--; throw e; }).then(function () {
            FL.cache = {}; PL.statusBefore = null;
            return PL.loadList();
        }).then(function () { PL.paint(); });
    };

    // ═════ the page ═════
    FL.TABS.plan = {
        render: function (el) {
            el.innerHTML = '<div class="pl-wrap"><div class="pl-head row"><h2 style="margin:0"><i class="fa-solid fa-bullseye"></i> Planning &amp; budgets</h2><span class="sm muted">Budgets, forecasts and what-if versions of the income statement — kept in APEX (shared) and on this PC</span><span class="grow"></span>' +
                '<button class="btn primary" id="pl-new"><i class="fa-solid fa-plus"></i> New plan</button></div>' +
                '<div class="pl-grid"><div id="pl-list" class="pl-list"><div class="muted sm"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading versions…</div></div><div id="pl-main"></div></div></div>';
            $('pl-new').onclick = PL.newDialog;
            return PL.loadList().then(function () {
                var id = PL.st.open && PL.item(PL.st.open) ? PL.st.open : null;
                if (PL.v && PL.dirty && PL.v.id === id) { PL.paint(); return; }
                return (id ? PL.openVersion(id).catch(function (e) { FL.toast(String(e && e.message || e), 'err'); PL.v = null; }) : Promise.resolve()).then(PL.paint);
            });
        }
    };
    PL.paint = function () { PL.paintList(); PL.paintMain(); };
    PL.paintList = function () {
        var el = $('pl-list'); if (!el) return;
        var bud = (FL.config.plan || {}).budget, yrs = {};
        PL.list.forEach(function (x) { (yrs[x.year] = yrs[x.year] || []).push(x); });
        el.innerHTML = (PL.apexErr ? '<div class="callout warn sm">APEX not reachable — showing the versions on this PC. ' + esc(PL.apexErr.slice(0, 140)) + '</div>' : '') +
            (PL.list.length ? Object.keys(yrs).sort(function (a, b) { return b - a; }).map(function (y) {
                return '<div class="pl-yr">' + esc(y) + '</div>' + yrs[y].map(function (x) {
                    var where = x.apexRev != null && x.pcRev != null ? (x.apexRev === x.pcRev ? 'APEX · this PC' : x.apexRev > x.pcRev ? 'APEX newer' : 'this PC newer') : x.apexRev != null ? 'APEX' : 'this PC only';
                    return '<div class="pl-item' + (PL.v && PL.v.id === x.id ? ' on' : '') + '" data-id="' + esc(x.id) + '"><div class="row"><b>' + esc(x.name) + '</b><span class="grow"></span>' + (bud === x.id ? '<span class="tag good" title="Used as the budget in every statement">★ budget</span>' : '') + '</div>' +
                        '<div class="sm muted row"><span class="tag">' + esc(KIND[x.kind] || x.kind) + '</span><span class="tag ' + (ST_TAG[x.status] || '') + '">' + esc(P.STATUS[x.status] || x.status) + '</span>' +
                        (x.profit || x.revenue ? '<span>NP ' + money(x.profit) + '</span>' : '') + '<span class="grow"></span><span title="Where it is saved · rev">' + esc(where) + '</span></div></div>';
                }).join('');
            }).join('') : '<div class="card sm"><b>No plans yet.</b><br>Start one with <b>New plan</b>: pick the year, the companies and how the lines start (last year + %, run-rate, trend …).</div>');
        el.querySelectorAll('.pl-item').forEach(function (d) {
            d.onclick = function () {
                if (PL.dirty && !confirm('Leave this version without saving?')) return;
                $('pl-main').innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Opening…</div>';
                PL.openVersion(d.dataset.id).then(PL.paint).catch(function (e) { FL.toast(String(e && e.message || e), 'err'); });
            };
        });
    };

    PL.VIEWS = [['grid', 'fa-table-cells', 'Plan'], ['drivers', 'fa-sliders', 'Drivers'], ['targets', 'fa-crosshairs', 'Targets & goal seek'], ['actual', 'fa-scale-balanced', 'Plan vs actual'],
        ['checks', 'fa-list-check', 'Checks'], ['ai', 'fa-wand-magic-sparkles', 'AI'], ['trail', 'fa-clock-rotate-left', 'History']];
    PL.paintMain = function () {
        var el = $('pl-main'); if (!el) return;
        var v = PL.v;
        if (!v) { el.innerHTML = '<div class="card"><h3><i class="fa-solid fa-bullseye"></i> How planning works</h3><ol class="sm"><li><b>New plan</b> — a budget for next year, a forecast for this year or a what-if scenario; pick the companies</li>' +
            '<li>Every income statement account with actuals gets a line; each line follows a <b>rule</b> (last year + %, run-rate, annual amount, driver × rate, % of revenue, trend) — or type the months</li>' +
            '<li><b>Targets & goal seek</b> — set revenue growth and gross margin, or a profit target, and let the plan follow</li><li><b>Submit</b> → an admin <b>approves</b> → <b>Use as budget</b>: every statement, KPI and variance in Finance Lens then compares with it</li>' +
            '<li>During the year: <b>Plan vs actual</b> and a <b>rolling forecast</b> (actual months + the rest)</li></ol><p class="sm muted">Saved in APEX for everyone and in the DuckDB file on this PC (tables fin_plan_versions, fin_plan_lines, fin_plan_amounts — the Copilot and the SQL explorer can read them). Nothing goes to Oracle Fusion.</p></div>'; return; }
        var can = function (a) { return P.can(v, a, who()); }, bud = (FL.config.plan || {}).budget === v.id, chk = P.checks(v, PL.ctx);
        var t = PL.totals(), view = PL.st.view || 'grid';
        var tile = function (lbl, val, py, good) {
            var d = py ? (val - py) / Math.abs(py) * 100 : null, up = good === 'down' ? d < 0 : d > 0;
            return '<div class="kpi"><div class="k-l">' + lbl + '</div><div class="k-v">' + money(val) + '</div><div class="k-d ' + (d == null ? 'muted' : up ? 'pos' : 'neg') + '">' + (d == null ? 'no last year' : pctTxt(d) + ' vs last year (' + money(py) + ')') + '</div></div>';
        };
        var gm = t.sum.rev ? (t.sum.rev - t.sum.cos) / t.sum.rev * 100 : null, nm = t.sum.rev ? t.sum.np / t.sum.rev * 100 : null, pnm = t.sum.pyRev ? t.sum.pyNp / t.sum.pyRev * 100 : null;
        el.innerHTML = '<div class="card pl-top"><div class="row" style="flex-wrap:wrap;gap:8px">' +
            '<input id="pl-name" class="pl-name" value="' + esc(v.name) + '"' + (can('edit') ? '' : ' disabled') + '>' +
            '<span class="tag">' + esc(KIND[v.kind] || v.kind) + ' ' + esc(v.year) + '</span><span class="tag ' + (ST_TAG[v.status] || '') + '">' + esc(P.STATUS[v.status] || v.status) + '</span>' +
            (v.actualThrough ? '<span class="tag" title="Months up to here are the actuals">actuals to ' + esc((v.periods.filter(function (p) { return p.period_seq === v.actualThrough; })[0] || {}).period_name) + '</span>' : '') +
            (bud ? '<span class="tag good">★ budget in every statement</span>' : '') +
            '<span class="sm muted">' + esc(v.currency || '') + ' · ' + v.lines.length + ' lines · rev ' + (v.rev || 0) + (PL.needApex ? ' · <b class="neg">not in APEX yet</b>' : '') + '</span><span class="grow"></span>' +
            (can('edit') ? '<button class="btn' + (PL.dirty ? ' primary' : '') + '" id="pl-save"><i class="fa-solid fa-floppy-disk"></i> Save' + (PL.dirty ? ' *' : '') + '</button>' : (PL.needApex ? '<button class="btn" id="pl-save"><i class="fa-solid fa-cloud-arrow-up"></i> Save to APEX</button>' : '')) +
            (can('refill') ? '<button class="btn" id="pl-refill" title="Fill the lines again from the actuals in DuckDB — as often as you like until you baseline the plan"><i class="fa-solid fa-rotate"></i> Refill from actuals</button>' : '') +
            (can('submit') ? '<button class="btn" id="pl-submit" title="Send for approval"><i class="fa-solid fa-paper-plane"></i> Submit</button>' : '') +
            (can('approve') ? '<button class="btn primary" id="pl-approve"><i class="fa-solid fa-check"></i> Approve</button>' : '') +
            (can('reject') ? '<button class="btn" id="pl-reject"><i class="fa-solid fa-rotate-left"></i> Send back</button>' : '') +
            (can('baseline') ? '<button class="btn" id="pl-base" title="Final version: lock it (no more refills or edits) — an AI admin can reopen it"><i class="fa-solid fa-lock"></i> Baseline</button>' : '') +
            (can('reopen') ? '<button class="btn" id="pl-reopen"><i class="fa-solid fa-lock-open"></i> Reopen</button>' : '') +
            '<button class="btn" id="pl-bud" title="' + (bud ? 'Stop using it as the budget (statements fall back to the Fusion budget)' : 'Every statement, KPI and variance in Finance Lens compares with this version') + '"><i class="fa-solid fa-star"></i> ' + (bud ? 'Budget ✓' : 'Use as budget') + '</button>' +
            '<span class="pl-more"><button class="btn" id="pl-more"><i class="fa-solid fa-ellipsis"></i></button><div class="pl-menu" id="pl-menu">' +
            '<a data-a="xlsx"><i class="fa-solid fa-file-excel"></i> Download Excel</a>' + (can('edit') ? '<a data-a="upload"><i class="fa-solid fa-file-arrow-up"></i> Upload Excel</a>' : '') +
            '<a data-a="copy"><i class="fa-regular fa-copy"></i> Copy as a new version</a><a data-a="rolling"><i class="fa-solid fa-forward"></i> Rolling forecast</a>' +
            (can('edit') ? '<a data-a="recalc"><i class="fa-solid fa-calculator"></i> Recalculate every rule</a>' : '') + '<a data-a="reload"><i class="fa-solid fa-rotate"></i> Reload from APEX</a>' +
            '<a data-a="delete" class="neg"><i class="fa-solid fa-trash"></i> Delete</a></div></span></div>' +
            (v.status === 'BASELINED' ? '<div class="sm muted" style="margin-top:4px"><i class="fa-solid fa-lock"></i> Baselined by ' + esc(v.baselinedBy || '') + ' ' + esc(String(v.baselinedAt || '').replace('T', ' ').slice(0, 16)) + ' — the final version; refills and edits are closed until an admin reopens it.</div>' :
                v.status === 'APPROVED' ? '<div class="sm muted" style="margin-top:4px"><i class="fa-solid fa-lock"></i> Approved by ' + esc(v.approvedBy || '') + ' ' + esc(String(v.approvedAt || '').replace('T', ' ').slice(0, 16)) + ' — read-only until an admin reopens it.</div>' :
                v.status === 'SUBMITTED' ? '<div class="sm muted" style="margin-top:4px"><i class="fa-solid fa-hourglass-half"></i> Submitted by ' + esc(v.submittedBy || '') + ' — waiting for an admin who did not submit it.</div>' :
                v.status === 'REJECTED' ? '<div class="callout warn sm">Sent back: ' + esc(v.rejectNote || '') + '</div>' : '') +
            '<div class="kpis pl-kpis" style="margin-top:10px">' + tile('Revenue', t.sum.rev, t.sum.pyRev) + tile('Gross profit' + (gm != null ? ' · ' + gm.toFixed(1) + '%' : ''), t.sum.rev - t.sum.cos, t.sum.pyRev - (PL.pyCos(t))) +
            tile('Expenses', t.sum.exp, t.sum.pyExp, 'down') + tile('Net profit' + (nm != null ? ' · ' + nm.toFixed(1) + '%' : ''), t.sum.np, t.sum.pyNp) +
            '<div class="kpi" id="pl-kchk"><div class="k-l">Checks</div><div class="k-v">' + chk.length + '</div><div class="k-d muted">' + (chk.length ? chk.filter(function (c) { return c.level !== 'info'; }).length + ' to look at' : 'nothing to look at') + (pnm != null && nm != null ? ' · margin ' + (nm - pnm >= 0 ? '+' : '') + (nm - pnm).toFixed(1) + ' pts' : '') + '</div></div></div></div>' +
            '<div class="pl-tabs">' + PL.VIEWS.map(function (x) { return '<button data-v="' + x[0] + '" class="' + (view === x[0] ? 'on' : '') + '"><i class="fa-solid ' + x[1] + '"></i> ' + x[2] + (x[0] === 'checks' && chk.length ? ' <span class="tag warn">' + chk.length + '</span>' : '') + '</button>'; }).join('') + '</div>' +
            '<div id="pl-view"></div>';
        el.querySelectorAll('.pl-tabs button').forEach(function (b) { b.onclick = function () { PL.st.view = b.dataset.v; keep(); PL.paintMain(); }; });
        if ($('pl-name')) $('pl-name').onchange = function () { v.name = this.value.trim() || v.name; PL.touch(); };
        if ($('pl-save')) $('pl-save').onclick = function () { PL.save('saved'); };
        if ($('pl-submit')) $('pl-submit').onclick = function () { PL.statusBefore = v.status; v.status = 'SUBMITTED'; v.submittedBy = who().user || ''; v.submittedAt = new Date().toISOString(); PL.save('submitted'); };
        if ($('pl-approve')) $('pl-approve').onclick = function () {
            var bad = chk.filter(function (c) { return c.level === 'bad'; });
            if (bad.length && !confirm(bad.length + ' check(s) fail:\n' + bad.map(function (c) { return '• ' + c.text; }).join('\n') + '\n\nApprove anyway?')) return;
            PL.statusBefore = v.status; v.status = 'APPROVED'; v.approvedBy = who().user || ''; v.approvedAt = new Date().toISOString(); PL.save('approved');
        };
        if ($('pl-reject')) $('pl-reject').onclick = function () { var why = prompt('Why is it sent back? (the preparer sees this)'); if (!why) return; PL.statusBefore = v.status; v.status = 'REJECTED'; v.rejectNote = why; PL.save('rejected', why); };
        if ($('pl-reopen')) $('pl-reopen').onclick = function () { var why = prompt('Why reopen the ' + (v.status === 'BASELINED' ? 'baselined' : 'approved') + ' version?'); if (!why) return; PL.statusBefore = v.status; v.status = 'DRAFT'; v.approvedBy = null; v.approvedAt = null; v.baselinedBy = null; v.baselinedAt = null; PL.save('reopened', why); };
        if ($('pl-refill')) $('pl-refill').onclick = PL.refillDialog;
        if ($('pl-base')) $('pl-base').onclick = function () {
            var bad = chk.filter(function (c) { return c.level === 'bad'; });
            if (!confirm('Baseline “' + v.name + '”?\n\nIt becomes the final version: no more refills or edits (an AI admin can reopen it).' + (bad.length ? '\n\n' + bad.length + ' check(s) fail:\n' + bad.map(function (c) { return '• ' + c.text; }).join('\n') : ''))) return;
            PL.statusBefore = v.status; v.status = 'BASELINED'; v.baselinedBy = who().user || ''; v.baselinedAt = new Date().toISOString(); PL.save('baselined');
        };
        $('pl-bud').onclick = PL.toggleBudget;
        $('pl-kchk').onclick = function () { PL.st.view = 'checks'; keep(); PL.paintMain(); };
        $('pl-more').onclick = function (e) { e.stopPropagation(); $('pl-menu').classList.toggle('open'); };
        document.addEventListener('click', function () { if ($('pl-menu')) $('pl-menu').classList.remove('open'); }, { once: true });
        $('pl-menu').querySelectorAll('a').forEach(function (a) { a.onclick = function () { $('pl-menu').classList.remove('open'); PL.menu(a.dataset.a); }; });
        var V = { grid: PL.viewGrid, drivers: PL.viewDrivers, targets: PL.viewTargets, actual: PL.viewActual, checks: PL.viewChecks, ai: PL.viewAi, trail: PL.viewTrail }[view] || PL.viewGrid;
        V($('pl-view'));
    };
    PL.pyCos = function (t) { var s = 0; Object.keys(t.byClass).forEach(function (c) { if (/cost of sales/i.test(c)) s += sumOf(t.byClass[c].py); }); return s; };
    PL.touch = function () { PL.dirty = true; var b = $('pl-save'); if (b) { b.classList.add('primary'); b.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save *'; } };
    /** After a change: rules again, numbers in place (the grid keeps focus and scroll) */
    PL.changed = function (full) {
        P.compute(PL.v, PL.ctx); PL.touch();
        if (full || (PL.st.view || 'grid') !== 'grid') { var sc = window.scrollY; PL.paintMain(); window.scrollTo(0, sc); return; }
        PL.refreshGrid();
    };

    // ═════ Plan grid: the statement lines × months; ▸ opens a line into its plan lines (editable) ═════
    PL.ruleText = function (l) {
        var r = l.rule || {}, d = (PL.v.drivers || []).filter(function (x) { return x.id === r.driver; })[0], ofTxt = function (o) { return !o ? '?' : /^type:R/.test(o) ? 'revenue' : /^type:E/.test(o) ? 'expenses' : /^class:/.test(o) ? o.slice(6) : (PL.ctx.accounts[o] || {}).name || o; };
        var txt = { py: 'LY ' + pctTxt(+r.pct || 0).replace('+0.0%', '±0%'), runrate: 'Run-rate ' + (r.n || 3) + 'm' + (+r.pct ? ' ' + pctTxt(+r.pct) : ''), annual: 'Annual · ' + (r.spread === 'season' ? 'season' : 'even'),
            growth: 'Start ' + (+r.pct ? pctTxt(+r.pct) + '/m' : ''), driver: (d ? d.name : 'driver') + ' × ' + (r.driver2 ? 'driver' : FINE.fmt(+r.rate || 0, 'num', { decimals: 2 })), pctof: (+r.pct || 0) + '% of ' + ofTxt(r.of),
            trend: 'Trend', zero: 'Zero', manual: 'Typed' }[r.method || 'manual'] || r.method;
        return txt + (l.adj != null && Math.abs(l.adj - 1) > 1e-9 && r.method !== 'manual' ? ' ×' + (+l.adj).toFixed(3) : '');
    };
    PL.viewGrid = function (box) {
        var v = PL.v, st = PL.stmt(), co = {}, ccs = {};
        v.lines.forEach(function (l) { co[l.company] = 1; if (l.cc) ccs[l.cc] = 1; });
        var coName = function (c) { return ((FL.dims.companies.filter(function (x) { return x.code === c; })[0] || {}).name) || c; };
        box.innerHTML = '<div class="card"><div class="row pl-bar" style="flex-wrap:wrap;gap:8px">' +
            '<label class="sm">Company <select id="pg-co"><option value="">All (' + Object.keys(co).length + ')</option>' + Object.keys(co).sort().map(function (c) { return '<option value="' + esc(c) + '"' + (PL.st.co === c ? ' selected' : '') + '>' + esc(c + ' ' + (coName(c) !== c ? coName(c) : '')) + '</option>'; }).join('') + '</select></label>' +
            (v.grain === 'cc' ? '<label class="sm">Cost centre <select id="pg-cc"><option value="">All</option>' + Object.keys(ccs).sort().map(function (c) { return '<option' + (PL.st.cc === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' : '') +
            '<a class="sm" id="pg-exp">' + (PL.st.expandAll ? 'Close every line' : 'Open every line') + '</a><span class="grow"></span>' +
            '<span class="sm muted">Amounts in ' + esc(FL.scaleLabel()) + ' (main toolbar) · ▸ opens a line · type a month or the year total · paste from Excel · the chip is the line\'s rule</span></div>' +
            (st ? '' : '<div class="callout warn">No income statement template — make one in the Statement builder.</div>') +
            '<div class="scroll pl-gridwrap"><table class="t pl-t"><thead><tr><th class="pl-lbl">Line</th><th>Rule</th>' + v.periods.map(function (p) { return '<th class="n">' + esc(p.period_name) + '</th>'; }).join('') +
            '<th class="n">Year</th><th class="n">Last year</th><th class="n">Δ %</th></tr></thead><tbody id="pg-body"></tbody></table></div></div>';
        if (!v.lines.length) {
            box.insertAdjacentHTML('afterbegin', '<div id="pd-box"><div class="sm muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Checking the DuckDB file…</div></div>');
            PL.diag().then(function (d) {
                if (!$('pd-box')) return;
                $('pd-box').innerHTML = PL.diagHtml(d);
                if ($('pd-fill')) $('pd-fill').onclick = function () { P.refill(v, PL.ctx, { how: { method: 'py', pct: 0 }, addMissing: true }); PL.changed(true); FL.toast(v.lines.length + ' line(s) from the actuals — save to keep them', 'ok'); };
                if ($('pd-again')) $('pd-again').onclick = function () { PL.prepare().then(function () { PL.paintMain(); }); };
            }).catch(function (e) { if ($('pd-box')) $('pd-box').innerHTML = '<div class="callout bad">' + esc(String(e && e.message || e)) + '</div>'; });
        }
        $('pg-co').onchange = function () { PL.st.co = this.value; keep(); PL.viewGrid(box); };
        if ($('pg-cc')) $('pg-cc').onchange = function () { PL.st.cc = this.value; keep(); PL.viewGrid(box); };
        $('pg-exp').onclick = function () { PL.st.expandAll = !PL.st.expandAll; PL.open = {}; keep(); PL.viewGrid(box); };
        PL.paintBody(st);
    };
    PL.paintBody = function (st) {
        var v = PL.v, body = $('pg-body'); if (!body) return;
        var editable = P.can(v, 'edit', who()), n = v.periods.length, inStmt = {};
        var lineRows = function (codes, rowId) {
            var set = {}; codes.forEach(function (c) { set[c] = 1; inStmt[c] = 1; });
            return v.lines.filter(function (l) { return set[l.account] && PL.shown(l); }).map(function (l) { return PL.lineRow(l, rowId, editable); }).join('');
        };
        var h = '';
        if (st) st.rows.forEach(function (r) {
            if (r.hidden || r.type === 'blank' || r.type === 'text') return;
            if (r.type === 'header') { h += '<tr class="pl-hd"><td colspan="' + (n + 5) + '">' + esc(r.label) + '</td></tr>'; return; }
            var codes = r.type === 'accounts' ? r.accounts || [] : [], has = codes.length && v.lines.some(function (l) { return codes.indexOf(l.account) >= 0 && PL.shown(l); });
            var open = has && (PL.st.expandAll || PL.open[r.id]), isPct = r.format === 'pct' || r.format === 'ratio';
            h += '<tr class="pl-sr ' + (r.type !== 'accounts' ? 'pl-tot' : '') + '" data-r="' + esc(r.id) + '"><td class="pl-lbl" style="padding-left:' + (6 + (r.level || 0) * 12) + 'px">' + (has ? '<a class="pl-tg" data-r="' + esc(r.id) + '">' + (open ? '▾' : '▸') + '</a> ' : '') + esc(r.label) + '</td><td></td>' +
                r.values.slice(0, n + 2).map(function (x, i) { return '<td class="n" data-c="' + i + '">' + (isPct ? (x == null ? '' : FINE.fmt(x, r.format)) : money(x)) + '</td>'; }).join('') +
                '<td class="n ' + (r.values[n + 2] == null ? '' : r.values[n + 2] >= 0 ? 'pos' : 'neg') + '" data-c="' + (n + 2) + '">' + (isPct ? '' : pctTxt(r.values[n + 2])) + '</td></tr>';
            if (open) h += lineRows(codes, r.id);
            else codes.forEach(function (c) { inStmt[c] = 1; });
        });
        var rest = v.lines.filter(function (l) { return !inStmt[l.account] && PL.shown(l); });
        if (rest.length) h += '<tr class="pl-hd"><td colspan="' + (n + 5) + '">Not on a line of ' + esc(PL.tpl ? PL.tpl.name : 'the statement') + ' (' + rest.length + ') — map them in the Statement builder</td></tr>' + rest.map(function (l) { return PL.lineRow(l, '', editable); }).join('');
        body.innerHTML = h;
        body.querySelectorAll('.pl-tg').forEach(function (a) { a.onclick = function () { PL.open[a.dataset.r] = !(PL.st.expandAll || PL.open[a.dataset.r]); if (PL.st.expandAll) { PL.st.expandAll = false; keep(); } PL.paintBody(PL.stmt()); }; });
        body.querySelectorAll('.pl-rule').forEach(function (b) { b.onclick = function () { PL.ruleDialog(b.dataset.k); }; });
        body.querySelectorAll('.pl-ln-name').forEach(function (b) { b.onclick = function () { PL.lineInfo(b.dataset.k); }; });
        body.querySelectorAll('input.pl-in').forEach(function (inp) {
            inp.onfocus = function () { var x = parseNum(inp.value); inp.dataset.was = inp.value; inp.select(); if (x == null) return; };
            inp.onkeydown = function (e) {
                if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault(); inp.blur();
                    var all = Array.prototype.slice.call(body.querySelectorAll('input.pl-in[data-i="' + inp.dataset.i + '"]')), at = all.indexOf(inp), nx = all[at + (e.key === 'ArrowUp' ? -1 : 1)];
                    if (e.key === 'Enter' && !e.shiftKey) { var row = Array.prototype.slice.call(inp.closest('tr').querySelectorAll('input.pl-in')), j = row.indexOf(inp); nx = row[j + 1] || nx; }
                    if (nx) setTimeout(function () { nx.focus(); }, 0);
                } else if (e.key === 'Escape') { inp.value = inp.dataset.was || ''; inp.blur(); }
            };
            inp.onchange = function () { PL.cellSet(inp.dataset.k, inp.dataset.i, inp.value); };
            inp.onpaste = function (e) {
                var txt = (e.clipboardData || window.clipboardData).getData('text'); if (!/[\t\n]/.test(txt)) return;
                e.preventDefault(); PL.pasteAt(inp.dataset.k, +inp.dataset.i, txt);
            };
        });
    };
    PL.lineRow = function (l, rowId, editable) {
        var v = PL.v, a = PL.ctx.accounts[l.account] || {}, s = P.sign(a), k = P.key(l), h = PL.ctx.hist[k] || {}, n = v.periods.length;
        var tot = sumOf(l.m) * s, py = sumOf(v.periods.map(function (p) { return (h[p.period_seq - 100] || 0) * s; })), d = py ? (tot - py) / Math.abs(py) * 100 : null;
        var fav = a.account_type === 'E' ? -1 : 1, sc = FL.filter.scale || 1, locked = function (i) { return v.actualThrough && v.periods[i].period_seq <= v.actualThrough; };
        var cell = function (val, i) {
            if (!editable || (i < n && locked(i))) return '<td class="n' + (i < n && locked(i) ? ' pl-act' : '') + '" data-k="' + esc(k) + '" data-i="' + i + '">' + money(val) + '</td>';
            return '<td class="n"><input class="pl-in" data-k="' + esc(k) + '" data-i="' + i + '" value="' + esc(FINE.fmt(val / sc, 'num', { decimals: dp(), zero: '', paren: false })) + '"></td>';
        };
        return '<tr class="pl-ln" data-k="' + esc(k) + '"><td class="pl-lbl" style="padding-left:30px"><a class="pl-ln-name" data-k="' + esc(k) + '" title="' + esc(l.note || 'Details, note, history') + '">' + esc(l.account) + ' ' + esc(a.name && a.name !== l.account ? a.name : '') + '</a>' +
            (PL.st.co ? '' : ' <span class="tag">' + esc(l.company) + '</span>') + (l.cc && !PL.st.cc ? ' <span class="tag">' + esc(l.cc) + '</span>' : '') + (l.note ? ' <i class="fa-regular fa-note-sticky muted" title="' + esc(l.note) + '"></i>' : '') + '</td>' +
            '<td><button class="pl-rule' + ((l.rule || {}).method === 'manual' ? ' man' : '') + '" data-k="' + esc(k) + '"' + (editable ? '' : ' disabled') + ' title="' + esc(P.methodName((l.rule || {}).method)) + ' — click to change">' + esc(PL.ruleText(l)) + '</button></td>' +
            l.m.map(function (x, i) { return cell(x * s, i); }).join('') + cell(tot, n) +
            '<td class="n muted" data-k="' + esc(k) + '" data-i="py">' + money(py) + '</td><td class="n ' + (d == null ? '' : d * fav >= 0 ? 'pos' : 'neg') + '" data-k="' + esc(k) + '" data-i="d">' + pctTxt(d) + '</td></tr>';
    };
    PL.byKey = function (k) { return PL.v.lines.filter(function (l) { return P.key(l) === k; })[0]; };
    /** A typed month (or the year total → spread like last year) */
    PL.cellSet = function (k, i, txt) {
        var v = PL.v, l = PL.byKey(k); if (!l) return;
        var a = PL.ctx.accounts[l.account] || {}, s = P.sign(a), x = parseNum(txt), sc = FL.filter.scale || 1, n = v.periods.length;
        if (x == null) x = 0;
        x *= sc;
        if (+i === n) { l.rule = { method: 'annual', amount: x, spread: 'season' }; l.adj = 1; }
        else { l.rule = { method: 'manual' }; l.adj = 1; l.m[+i] = Math.round(x * s * 100) / 100; }
        PL.changed();
    };
    /** Excel paste: tabs = months to the right, new lines = the next lines below */
    PL.pasteAt = function (k, i0, txt) {
        var rows = txt.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(function (r) { return r.split('\t'); });
        var trs = Array.prototype.slice.call(document.querySelectorAll('#pg-body tr.pl-ln')).map(function (tr) { return tr.dataset.k; }), at = trs.indexOf(k), n = PL.v.periods.length, sc = FL.filter.scale || 1, cnt = 0;
        rows.forEach(function (r, ri) {
            var l = PL.byKey(trs[at + ri]); if (!l) return;
            var s = P.sign(PL.ctx.accounts[l.account]); l.rule = { method: 'manual' }; l.adj = 1;
            r.forEach(function (c, ci) { var j = i0 + ci, x = parseNum(c); if (j < n && x != null) { l.m[j] = Math.round(x * sc * s * 100) / 100; cnt++; } });
        });
        PL.changed(); FL.toast(cnt + ' cell(s) pasted', 'ok');
    };
    /** Numbers in place after a change */
    PL.refreshGrid = function () {
        var st = PL.stmt(), v = PL.v, n = v.periods.length, body = $('pg-body'); if (!body) return;
        if (st) st.rows.forEach(function (r) {
            var tr = body.querySelector('tr.pl-sr[data-r="' + CSS.escape(r.id || '') + '"]'); if (!tr) return;
            var isPct = r.format === 'pct' || r.format === 'ratio';
            tr.querySelectorAll('td[data-c]').forEach(function (td) { var i = +td.dataset.c, x = r.values[i]; td.textContent = i === n + 2 ? (isPct ? '' : pctTxt(x)) : isPct ? (x == null ? '' : FINE.fmt(x, r.format)) : money(x); if (i === n + 2) td.className = 'n ' + (x == null ? '' : x >= 0 ? 'pos' : 'neg'); });
        });
        var active = document.activeElement;
        body.querySelectorAll('tr.pl-ln').forEach(function (tr) {
            var l = PL.byKey(tr.dataset.k); if (!l) return;
            var fresh = document.createElement('tbody'); fresh.innerHTML = PL.lineRow(l, '', P.can(v, 'edit', who()));
            var nt = fresh.firstChild;
            // keep the cell being typed in; swap the rest
            Array.prototype.forEach.call(tr.children, function (td, j) {
                var inp = td.querySelector('input'); if (inp && inp === active) return;
                var src = nt.children[j]; if (!src) return;
                if (inp && src.querySelector('input')) inp.value = src.querySelector('input').value; else { td.innerHTML = src.innerHTML; td.className = src.className; }
            });
            var rb = tr.querySelector('.pl-rule'); if (rb) { rb.onclick = function () { PL.ruleDialog(rb.dataset.k); }; rb.className = nt.querySelector('.pl-rule').className; }
        });
        var t = PL.totals(); document.querySelectorAll('.pl-kpis .kpi .k-v')[0].textContent = money(t.sum.rev); document.querySelectorAll('.pl-kpis .kpi .k-v')[3].textContent = money(t.sum.np);
    };

    // ═════ rule dialog: method + parameters, live preview against last year, apply to one line / the statement line / the account ═════
    PL.ruleDialog = function (k) {
        var v = PL.v, l = PL.byKey(k); if (!l || !P.can(v, 'edit', who())) return;
        var a = PL.ctx.accounts[l.account] || {}, s = P.sign(a), h = PL.ctx.hist[k] || {}, sc = FL.filter.scale || 1, n = v.periods.length;
        var r = clone(l.rule || { method: 'manual' }), adj = l.adj == null ? 1 : l.adj;
        var stmtLine = PL.tpl ? (FINE.accountLines([PL.tpl], FL.dims.accounts)[l.account] || [])[0] : null;
        var classes = {}; Object.keys(PL.ctx.accounts).forEach(function (c) { var x = PL.ctx.accounts[c]; if (x.class) classes[x.account_type + '|' + x.class] = 1; });
        var ofOpts = [['type:R', 'Revenue (all)'], ['type:E', 'Expenses (all)']].concat(Object.keys(classes).sort().map(function (c) { return ['class:' + c.split('|')[1], c.split('|')[1]]; }));
        var fld = function (id, lbl, val, extra) { return '<label class="field">' + lbl + '<input id="' + id + '" value="' + esc(val == null ? '' : val) + '"' + (extra || '') + '></label>'; };
        var form = function () {
            var m = r.method || 'manual';
            if (m === 'py' || m === 'runrate' || m === 'growth') return (m === 'runrate' ? '<label class="field">Months to average<select id="rd-n">' + [1, 3, 6, 12].map(function (x) { return '<option' + ((+r.n || 3) === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label>' : '') +
                (m === 'growth' ? fld('rd-start', 'First month (' + FL.scaleLabel() + ')', r.start != null ? Math.round(r.start / sc * 100) / 100 : '') : '') + fld('rd-pct', m === 'growth' ? 'Growth % a month' : 'Change %', r.pct || 0, ' type="number" step="0.1"');
            if (m === 'annual') return fld('rd-amt', 'Year amount (' + FL.scaleLabel() + ')', r.amount != null ? Math.round(r.amount / sc * 100) / 100 : '') + '<label class="field">Spread<select id="rd-spread"><option value="season"' + (r.spread === 'season' ? ' selected' : '') + '>like last year\'s months</option><option value="even"' + (r.spread !== 'season' ? ' selected' : '') + '>evenly</option></select></label>';
            if (m === 'driver') {
                if (!v.drivers.length) return '<div class="callout warn sm">No drivers yet — add one under <b>Drivers</b> (headcount, volume, m² …).</div>';
                var dsel = function (id, val, none) { return '<select id="' + id + '">' + (none ? '<option value="">— a fixed rate —</option>' : '') + v.drivers.map(function (d) { return '<option value="' + esc(d.id) + '"' + (val === d.id ? ' selected' : '') + '>' + esc(d.name + (d.unit ? ' (' + d.unit + ')' : '')) + '</option>'; }).join('') + '</select>'; };
                return '<label class="field">Driver' + dsel('rd-drv', r.driver || v.drivers[0].id) + '</label><label class="field">× second driver' + dsel('rd-drv2', r.driver2 || '', true) + '</label>' + fld('rd-rate', 'Rate (full units, e.g. salary per head)', r.rate == null ? '' : r.rate, ' type="number" step="any"') + fld('rd-pct', 'Rate growth % a month', r.pct || 0, ' type="number" step="0.1"');
            }
            if (m === 'pctof') return '<label class="field">Of<select id="rd-of">' + ofOpts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (r.of === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>' + fld('rd-pct', '%', r.pct || 0, ' type="number" step="0.01"') +
                '<div class="sm muted">Of the same company' + (v.grain === 'cc' ? ' and cost centre' : '') + '. Last year it was <b id="rd-was"></b>.</div>';
            if (m === 'trend') return '<div class="sm muted">Seasonal trend (Holt-Winters) with 24+ months of actuals, else a straight-line trend.</div>';
            if (m === 'manual') return '<div class="sm muted">Keeps the months as they are — type them in the grid.</div>';
            return '';
        };
        var read = function () {
            var g = function (id) { return $(id) ? $(id).value : null; };
            if (g('rd-pct') != null) r.pct = +g('rd-pct') || 0;
            if (g('rd-n') != null) r.n = +g('rd-n');
            if (g('rd-start') != null) r.start = (parseNum(g('rd-start')) || 0) * sc;
            if (g('rd-amt') != null) r.amount = (parseNum(g('rd-amt')) || 0) * sc;
            if (g('rd-spread') != null) r.spread = g('rd-spread');
            if (g('rd-drv') != null) { r.driver = g('rd-drv'); r.driver2 = g('rd-drv2') || null; r.rate = g('rd-rate') === '' ? null : +g('rd-rate'); }
            if (g('rd-of') != null) r.of = g('rd-of');
            adj = $('rd-adj') && $('rd-adj').checked ? adj : 1;
        };
        var preview = function () {
            read();
            var computed = {}; v.lines.forEach(function (x) { var ss = P.sign(PL.ctx.accounts[x.account]); computed[P.key(x)] = x.m.map(function (q) { return q * ss; }); });
            var tmp = Object.assign({}, l, { rule: r }), vals = r.method === 'manual' ? l.m.map(function (q) { return q * s; }) : P.ruleValues(tmp, v, PL.ctx, computed).map(function (q) { return q * adj; });
            var py = v.periods.map(function (p) { return (h[p.period_seq - 100] || 0) * s; });
            $('rd-prev').innerHTML = '<table class="t sm"><thead><tr><th></th>' + v.periods.map(function (p) { return '<th class="n">' + esc(p.period_name) + '</th>'; }).join('') + '<th class="n">Year</th></tr></thead><tbody>' +
                '<tr><td>Last year</td>' + py.map(function (q) { return '<td class="n muted">' + money(q) + '</td>'; }).join('') + '<td class="n muted">' + money(sumOf(py)) + '</td></tr>' +
                '<tr><td><b>This rule</b></td>' + vals.map(function (q) { return '<td class="n"><b>' + money(q) + '</b></td>'; }).join('') + '<td class="n"><b>' + money(sumOf(vals)) + '</b></td></tr>' +
                '<tr><td>Now</td>' + l.m.map(function (q) { return '<td class="n muted">' + money(q * s) + '</td>'; }).join('') + '<td class="n muted">' + money(sumOf(l.m) * s) + '</td></tr></tbody></table>' +
                '<div class="sm">' + (sumOf(py) ? 'Against last year: <b>' + pctTxt((sumOf(vals) - sumOf(py)) / Math.abs(sumOf(py)) * 100) + '</b>' : 'No actuals last year') + '</div>';
            if ($('rd-was') && r.method === 'pctof') {
                var base = P.baseOf(r.of, l, v, { accounts: PL.ctx.accounts }, {}), pyBase = 0;
                v.lines.forEach(function (x) { var aa = PL.ctx.accounts[x.account] || {}, of = r.of || ''; var hit = /^type:/.test(of) ? aa.account_type === of.slice(5) : /^class:/.test(of) ? aa.class === of.slice(6) : x.account === of; if (hit && x !== l && x.company === l.company) { var hh = PL.ctx.hist[P.key(x)] || {}; v.periods.forEach(function (p) { pyBase += (hh[p.period_seq - 100] || 0) * P.sign(aa); }); } });
                $('rd-was').textContent = pyBase ? (sumOf(py) / pyBase * 100).toFixed(2) + ' %' : '—';
                void base;
            }
        };
        var paint = function () {
            $('rd-form').innerHTML = form();
            $('rd-form').querySelectorAll('input,select').forEach(function (x) { x.oninput = preview; x.onchange = preview; });
            document.querySelectorAll('#rd-m .rd-meth').forEach(function (b) { b.classList.toggle('on', b.dataset.m === (r.method || 'manual')); });
            preview();
        };
        FL.modal('<i class="fa-solid fa-sliders"></i> ' + esc(l.account + ' ' + (a.name || '')) + ' <small class="muted">' + esc(l.company + (l.cc ? ' · ' + l.cc : '')) + '</small>',
            '<div class="rd-meths" id="rd-m">' + P.METHODS.map(function (m) { return '<button class="rd-meth" data-m="' + m.id + '" title="' + esc(m.help) + '"><b>' + esc(m.name) + '</b><span>' + esc(m.help) + '</span></button>'; }).join('') + '</div>' +
            '<div class="row" id="rd-form" style="flex-wrap:wrap;gap:10px;margin:10px 0"></div>' +
            (Math.abs(adj - 1) > 1e-9 ? '<label class="sm"><input type="checkbox" id="rd-adj" checked> keep the goal-seek factor ×' + adj.toFixed(3) + '</label>' : '') +
            '<div id="rd-prev" class="scroll"></div>' +
            '<label class="field" style="margin-top:8px">Note (why this assumption)<input id="rd-note" value="' + esc(l.note || '') + '" placeholder="e.g. new price list from April, 2 more drivers"></label>' +
            '<div class="row" style="margin-top:10px;gap:10px"><label class="sm">Apply to <select id="rd-to"><option value="one">this line</option>' +
            (stmtLine ? '<option value="row">every line of “' + esc(stmtLine.label) + '”' + (PL.st.co ? ' (' + esc(PL.st.co) + ')' : '') + '</option>' : '') +
            '<option value="acct">account ' + esc(l.account) + ' in every company</option></select></label><span class="grow"></span><button class="btn primary" id="rd-ok"><i class="fa-solid fa-check"></i> Apply</button></div>');
        document.querySelectorAll('#rd-m .rd-meth').forEach(function (b) { b.onclick = function () { read(); r = Object.assign({}, r, { method: b.dataset.m }); if (b.dataset.m === 'annual' && r.amount == null) r.amount = sumOf(l.m) * s; if (b.dataset.m === 'growth' && r.start == null) r.start = (l.m[0] || 0) * s; paint(); }; });
        paint();
        $('rd-ok').onclick = function () {
            read();
            var to = $('rd-to').value, rows = stmtLine ? FINE.matchAccounts((PL.tpl.rows.filter(function (x) { return x.id === stmtLine.row; })[0] || {}).accounts, FL.dims.accounts) : [];
            var targets = to === 'one' ? [l] : to === 'acct' ? v.lines.filter(function (x) { return x.account === l.account; }) : v.lines.filter(function (x) { return rows.indexOf(x.account) >= 0 && PL.shown(x); });
            targets.forEach(function (x) {
                if (r.method === 'manual' && x !== l) return;
                var rr = clone(r);
                // an annual amount / first month typed for one line is not copied to the others: they keep their own size (last year)
                if (x !== l && rr.method === 'annual') { var hh = PL.ctx.hist[P.key(x)] || {}, ss = P.sign(PL.ctx.accounts[x.account]); rr.amount = sumOf(v.periods.map(function (p) { return (hh[p.period_seq - 100] || 0) * ss; })); }
                if (x !== l && rr.method === 'growth') rr.start = (x.m[0] || 0) * P.sign(PL.ctx.accounts[x.account]);
                x.rule = rr; x.adj = x === l ? adj : 1;
            });
            l.note = $('rd-note').value.trim();
            FL.closeModal(); PL.changed();
            if (targets.length > 1) FL.toast('Rule applied to ' + targets.length + ' lines', 'ok');
        };
    };
    /** One line: actuals of the last 3 years by month, note */
    PL.lineInfo = function (k) {
        var v = PL.v, l = PL.byKey(k), a = PL.ctx.accounts[l.account] || {}, s = P.sign(a), h = PL.ctx.hist[k] || {};
        var yrs = [3, 2, 1].map(function (b) { return v.periods.map(function (p) { return (h[p.period_seq - 100 * b] || 0) * s; }); });
        FL.modal(esc(l.account + ' ' + (a.name || '')) + ' <small class="muted">' + esc(l.company + (l.cc ? ' · ' + l.cc : '')) + ' · ' + esc(a.class || '') + '</small>',
            '<div style="height:220px"><canvas id="li-ch"></canvas></div><div class="scroll"><table class="t sm"><thead><tr><th></th>' + v.periods.map(function (p) { return '<th class="n">' + esc(p.period_name) + '</th>'; }).join('') + '<th class="n">Year</th></tr></thead><tbody>' +
            yrs.map(function (y, i) { return '<tr><td class="muted">' + (v.year - 3 + i) + ' actual</td>' + y.map(function (q) { return '<td class="n muted">' + money(q) + '</td>'; }).join('') + '<td class="n">' + money(sumOf(y)) + '</td></tr>'; }).join('') +
            '<tr><td><b>' + v.year + ' plan</b></td>' + l.m.map(function (q) { return '<td class="n"><b>' + money(q * s) + '</b></td>'; }).join('') + '<td class="n"><b>' + money(sumOf(l.m) * s) + '</b></td></tr></tbody></table></div>' +
            '<p class="sm">Rule: <b>' + esc(PL.ruleText(l)) + '</b>' + (l.note ? ' · ' + esc(l.note) : '') + '</p>' +
            (P.can(v, 'edit', who()) ? '<div class="row"><button class="btn" id="li-rule"><i class="fa-solid fa-sliders"></i> Change the rule</button><button class="btn" id="li-del"><i class="fa-solid fa-trash"></i> Remove the line</button></div>' : ''));
        FL.chart('li-ch', { type: 'line', data: { labels: v.periods.map(function (p) { return p.period_name.replace(/[-\s]?\d+$/, ''); }), datasets: yrs.map(function (y, i) { return { label: String(v.year - 3 + i), data: y, borderColor: ['#cbd5e1', '#94a3b8', FL.PAL.py][i], borderWidth: 1.5, pointRadius: 0, tension: 0.25 }; })
            .concat([{ label: v.year + ' plan', data: l.m.map(function (q) { return q * s; }), borderColor: FL.PAL.act, borderWidth: 2.5, pointRadius: 2, tension: 0.25 }]) }, options: { maintainAspectRatio: false, scales: { y: FL.moneyAxis() } } });
        if ($('li-rule')) $('li-rule').onclick = function () { FL.closeModal(); PL.ruleDialog(k); };
        if ($('li-del')) $('li-del').onclick = function () { if (!confirm('Remove this line from the plan?')) return; v.lines = v.lines.filter(function (x) { return x !== l; }); FL.closeModal(); PL.changed(true); };
    };

    // ═════ drivers ═════
    PL.viewDrivers = function (box) {
        var v = PL.v, ed = P.can(v, 'edit', who()), used = {};
        v.lines.forEach(function (l) { var r = l.rule || {}; if (r.method === 'driver') { used[r.driver] = (used[r.driver] || 0) + 1; if (r.driver2) used[r.driver2] = (used[r.driver2] || 0) + 1; } });
        box.innerHTML = '<div class="card"><h3><i class="fa-solid fa-sliders"></i> Drivers <small>quantities the plan is built on — headcount, volumes, m², vehicles … in full units; a line with the rule <b>Driver × rate</b> multiplies them</small><span class="grow"></span>' +
            (ed ? '<button class="btn sm" id="dr-add"><i class="fa-solid fa-plus"></i> Add driver</button>' : '') + '</h3>' +
            (v.drivers.length ? '<div class="scroll"><table class="t pl-t"><thead><tr><th>Driver</th><th>Unit</th>' + v.periods.map(function (p) { return '<th class="n">' + esc(p.period_name) + '</th>'; }).join('') + '<th class="n">Average</th><th>Used by</th><th></th></tr></thead><tbody>' +
                v.drivers.map(function (d, di) {
                    return '<tr><td><input class="dr-f" data-d="' + di + '" data-f="name" value="' + esc(d.name) + '"' + (ed ? '' : ' disabled') + '></td><td><input class="dr-f" style="width:70px" data-d="' + di + '" data-f="unit" value="' + esc(d.unit || '') + '"' + (ed ? '' : ' disabled') + '></td>' +
                        v.periods.map(function (_, i) { return '<td class="n"><input class="pl-in dr-v" data-d="' + di + '" data-i="' + i + '" value="' + esc(d.values[i] == null ? '' : d.values[i]) + '"' + (ed ? '' : ' disabled') + '></td>'; }).join('') +
                        '<td class="n">' + FINE.fmt(sumOf(d.values) / (v.periods.length || 1), 'num', { decimals: 1 }) + '</td><td class="sm">' + (used[d.id] || 0) + ' line(s)</td>' +
                        '<td>' + (ed ? '<a class="dr-fill" data-d="' + di + '" title="Fill: a value and a monthly change"><i class="fa-solid fa-fill-drip"></i></a> <a class="dr-del" data-d="' + di + '"><i class="fa-solid fa-trash"></i></a>' : '') + '</td></tr>';
                }).join('') + '</tbody></table></div>' : '<p class="sm muted">No drivers yet. Examples: <b>Headcount</b> × salary per head for staff costs, <b>Cases sold</b> × price for revenue, <b>Vehicles</b> × fuel per vehicle, <b>m²</b> × rent per m².</p>') + '</div>';
        if (!ed) return;
        if ($('dr-add')) $('dr-add').onclick = function () { var nm = prompt('Driver name (e.g. Headcount)'); if (!nm) return; v.drivers.push({ id: P.uid('d'), name: nm, unit: '', values: v.periods.map(function () { return 0; }) }); PL.touch(); PL.viewDrivers(box); };
        box.querySelectorAll('.dr-f').forEach(function (x) { x.onchange = function () { v.drivers[+x.dataset.d][x.dataset.f] = x.value; PL.touch(); }; });
        box.querySelectorAll('.dr-v').forEach(function (x) {
            x.onchange = function () { v.drivers[+x.dataset.d].values[+x.dataset.i] = parseNum(x.value) || 0; PL.changed(); PL.viewDrivers(box); };
            x.onpaste = function (e) { var t = (e.clipboardData || window.clipboardData).getData('text'); if (!/\t/.test(t)) return; e.preventDefault(); var d = v.drivers[+x.dataset.d]; t.split(/\t/).forEach(function (c, j) { var i = +x.dataset.i + j, n = parseNum(c); if (i < v.periods.length && n != null) d.values[i] = n; }); PL.changed(); PL.viewDrivers(box); };
        });
        box.querySelectorAll('.dr-fill').forEach(function (x) { x.onclick = function () { var d = v.drivers[+x.dataset.d], a = parseNum(prompt('First month value', d.values[0] || 0)); if (a == null) return; var g = parseNum(prompt('Change each month (%)', 0)) || 0; d.values = v.periods.map(function (_, i) { return Math.round(a * Math.pow(1 + g / 100, i) * 100) / 100; }); PL.changed(); PL.viewDrivers(box); }; });
        box.querySelectorAll('.dr-del').forEach(function (x) { x.onclick = function () { var d = v.drivers[+x.dataset.d]; if (used[d.id] && !confirm(used[d.id] + ' line(s) use it — they will plan zero. Remove?')) return; v.drivers.splice(+x.dataset.d, 1); PL.changed(); PL.viewDrivers(box); }; });
    };

    // ═════ targets & goal seek ═════
    PL.viewTargets = function (box) {
        var v = PL.v, ed = P.can(v, 'edit', who()), t = PL.totals(), sc = FL.filter.scale || 1, tg = v.targets || {};
        var expCls = Object.keys(t.byClass).filter(function (c) { return t.byClass[c].type === 'E' && !/cost of sales/i.test(c); }).sort();
        box.innerHTML = '<div class="pl-2"><div class="card"><h3><i class="fa-solid fa-crosshairs"></i> Targets <small>top-down: set the headline numbers, every line follows</small></h3>' +
            '<div class="row" style="flex-wrap:wrap;gap:10px"><label class="field">Revenue growth %<input id="tg-rev" type="number" step="0.1" value="' + esc(tg.revGrowth == null ? '' : tg.revGrowth) + '" placeholder="e.g. 8"></label>' +
            '<label class="field">Gross margin %<input id="tg-gm" type="number" step="0.1" value="' + esc(tg.grossMargin == null ? '' : tg.grossMargin) + '" placeholder="last year ' + (t.sum.pyRev ? ((t.sum.pyRev - PL.pyCos(t)) / t.sum.pyRev * 100).toFixed(1) : '?') + '"></label>' +
            '<label class="field">Other costs growth %<input id="tg-cost" type="number" step="0.1" value="' + esc(tg.costGrowth == null ? '' : tg.costGrowth) + '" placeholder="e.g. 4"></label></div>' +
            (expCls.length ? '<details' + (Object.keys(tg.classes || {}).length ? ' open' : '') + '><summary class="sm">Growth by cost class (overrides the line above)</summary><table class="t sm"><tbody>' + expCls.map(function (c) {
                var b = t.byClass[c], py = sumOf(b.py);
                return '<tr><td>' + esc(c) + '</td><td class="n muted">last year ' + money(py) + '</td><td><input class="tg-cls" data-c="' + esc(c) + '" type="number" step="0.1" style="width:80px" value="' + esc((tg.classes || {})[c] == null ? '' : tg.classes[c]) + '"> %</td></tr>';
            }).join('') + '</tbody></table></details>' : '') +
            (ed ? '<div class="row" style="margin-top:8px"><span class="sm muted">Replaces the rules of revenue, cost of sales and the cost lines you set.</span><span class="grow"></span><button class="btn primary" id="tg-go"><i class="fa-solid fa-wand-magic"></i> Apply targets</button></div>' : '') + '</div>' +
            '<div class="card"><h3><i class="fa-solid fa-bullseye"></i> Goal seek <small>what it takes to reach a profit</small></h3>' +
            '<p class="sm">Net profit now <b>' + money(t.sum.np) + '</b> · last year ' + money(t.sum.pyNp) + ' (' + esc(FL.scaleLabel()) + ')</p>' +
            '<div class="row" style="flex-wrap:wrap;gap:10px"><label class="field">Net profit target (' + esc(FL.scaleLabel()) + ')<input id="gs-t" value="' + esc(FINE.fmt(t.sum.np / sc, 'num', { decimals: dp(), paren: false })) + '"></label>' +
            '<label class="field">By changing<select id="gs-s"><option value="opex">operating costs (not cost of sales)</option><option value="exp">every cost</option><option value="cos">cost of sales</option><option value="rev">revenue</option></select></label></div>' +
            '<div class="row" style="margin-top:8px"><span class="sm muted" id="gs-out">Each line in scope gets the same factor (shown on its rule chip); typed lines are scaled.</span><span class="grow"></span>' + (ed ? '<button class="btn primary" id="gs-go"><i class="fa-solid fa-play"></i> Seek</button>' : '') + '</div></div></div>' +
            '<div class="pl-2" style="margin-top:12px"><div class="card"><h3>Plan against last year by class</h3><div style="height:300px"><canvas id="tg-ch1"></canvas></div></div><div class="card"><h3>Month by month</h3><div style="height:300px"><canvas id="tg-ch2"></canvas></div></div></div>';
        var cls = Object.keys(t.byClass).sort(function (a, b) { return Math.abs(sumOf(t.byClass[b].plan)) - Math.abs(sumOf(t.byClass[a].plan)); }).slice(0, 14);
        FL.chart('tg-ch1', { type: 'bar', data: { labels: cls, datasets: [{ label: 'Last year', data: cls.map(function (c) { return sumOf(t.byClass[c].py); }), backgroundColor: FL.PAL.bud }, { label: 'Plan', data: cls.map(function (c) { return sumOf(t.byClass[c].plan); }), backgroundColor: FL.PAL.act }] },
            options: { indexAxis: 'y', maintainAspectRatio: false, scales: { x: FL.moneyAxis() } } });
        FL.chart('tg-ch2', { type: 'line', data: { labels: v.periods.map(function (p) { return p.period_name; }), datasets: [
            { label: 'Revenue plan', data: t.rev, borderColor: FL.PAL.act, borderWidth: 2, pointRadius: 0 }, { label: 'Revenue last year', data: t.pyRev, borderColor: FL.PAL.act, borderDash: [4, 4], borderWidth: 1.2, pointRadius: 0 },
            { label: 'Profit plan', data: t.np, borderColor: FL.PAL.good, borderWidth: 2, pointRadius: 0 }, { label: 'Profit last year', data: t.pyNp, borderColor: FL.PAL.good, borderDash: [4, 4], borderWidth: 1.2, pointRadius: 0 }] }, options: { maintainAspectRatio: false, scales: { y: FL.moneyAxis() } } });
        if (!ed) return;
        $('tg-go').onclick = function () {
            var n = function (id) { var x = $(id).value; return x === '' ? null : +x; }, cl = {};
            box.querySelectorAll('.tg-cls').forEach(function (x) { if (x.value !== '') cl[x.dataset.c] = +x.value; });
            v.targets = { revGrowth: n('tg-rev'), grossMargin: n('tg-gm'), costGrowth: n('tg-cost'), classes: cl };
            if (!confirm('Set the rules of the lines from these targets? Lines you typed in keep their numbers unless a target covers them.')) return;
            P.applyTargets(v, PL.ctx, v.targets); PL.changed(true); FL.toast('Targets applied', 'ok');
        };
        $('gs-go').onclick = function () {
            var target = (parseNum($('gs-t').value) || 0) * sc, r = P.goalSeek(v, PL.ctx, target, $('gs-s').value);
            if (r.error) { $('gs-out').innerHTML = '<span class="neg">' + esc(r.error) + '</span>'; return; }
            (v.notes = v.notes || []).push('Goal seek ' + new Date().toISOString().slice(0, 10) + ': profit ' + Math.round(r.before) + ' → ' + Math.round(r.after) + ' (' + $('gs-s').value + ' ×' + r.factor.toFixed(4) + ')');
            PL.changed(true); FL.toast('Done: ' + $('gs-s').selectedOptions[0].text + ' × ' + r.factor.toFixed(3), 'ok');
        };
    };

    // ═════ plan vs actual + rolling forecast ═════
    PL.viewActual = function (box) {
        var v = PL.v, va = P.variance(v, PL.ctx);
        if (!va.months) { box.innerHTML = '<div class="card"><p>No actuals yet for the months of this plan (' + esc(v.periods[0].period_name) + ' – ' + esc(v.periods[v.periods.length - 1].period_name) + '). Once Trial balance sync brings them in, this view compares month by month — and you can roll the plan into a forecast.</p></div>'; return; }
        var tot = { R: [0, 0], E: [0, 0] };
        va.rows.forEach(function (r) { var t = r.account.account_type; if (tot[t]) { tot[t][0] += r.plan; tot[t][1] += r.actual; } });
        var np = [tot.R[0] - tot.E[0], tot.R[1] - tot.E[1]], thr = (v.periods.filter(function (p) { return p.period_seq === va.through; })[0] || {}).period_name;
        var cum = function (fn) { var run = 0; return v.periods.map(function (p, i) { if (p.period_seq > va.through) return null; run += fn(i); return run; }); };
        var t = PL.totals(), actNp = v.periods.map(function (p) { var s = 0; v.lines.forEach(function (l) { var a = PL.ctx.accounts[l.account] || {}, h = PL.ctx.hist[P.key(l)] || {}; if (a.account_type === 'R' || a.account_type === 'E') s += -(h[p.period_seq] || 0); }); return s; });
        box.innerHTML = '<div class="card"><div class="row"><h3 style="margin:0">Plan against actual · ' + va.months + ' month(s) to ' + esc(thr) + '</h3><span class="grow"></span>' +
            '<label class="sm">Rest of the year <select id="ra-rest"><option value="plan">keep the plan</option><option value="runrate">run-rate of the last 3 months</option><option value="trend">trend</option><option value="py">last year + 0 %</option></select></label>' +
            '<button class="btn primary" id="ra-go"><i class="fa-solid fa-forward"></i> Make a rolling forecast</button></div>' +
            '<div class="kpis" style="margin-top:10px">' + [['Revenue', tot.R, 1], ['Expenses', tot.E, -1], ['Net profit', np, 1]].map(function (x) {
                var d = x[1][1] - x[1][0], f = d * x[2];
                return '<div class="kpi"><div class="k-l">' + x[0] + ' to ' + esc(thr) + '</div><div class="k-v">' + money(x[1][1]) + '</div><div class="k-d ' + (f >= 0 ? 'pos' : 'neg') + '">plan ' + money(x[1][0]) + ' · ' + (d >= 0 ? '+' : '') + money(d) + (x[1][0] ? ' (' + pctTxt(d / Math.abs(x[1][0]) * 100) + ')' : '') + '</div></div>';
            }).join('') + '</div><div style="height:260px;margin-top:10px"><canvas id="ra-ch"></canvas></div></div>' +
            '<div class="card" style="margin-top:12px"><h3>By line <small>variance + = favourable (more revenue, less cost)</small></h3><div id="ra-g"></div></div>';
        FL.chart('ra-ch', { type: 'line', data: { labels: v.periods.map(function (p) { return p.period_name; }), datasets: [
            { label: 'Profit plan (cumulative)', data: (function () { var run = 0; return t.np.map(function (x) { run += x; return run; }); })(), borderColor: FL.PAL.bud, borderWidth: 2, pointRadius: 0 },
            { label: 'Profit actual (cumulative)', data: cum(function (i) { return actNp[i]; }), borderColor: FL.PAL.act, borderWidth: 2.5, pointRadius: 2 }] }, options: { maintainAspectRatio: false, scales: { y: FL.moneyAxis() } } });
        FL.grid($('ra-g'), [{ label: 'Account', get: function (r) { return r.line.account; } }, { label: 'Name', get: function (r) { return r.account.name || ''; } }, { label: 'Company', get: function (r) { return r.line.company + (r.line.cc ? ' · ' + r.line.cc : ''); } },
            { label: 'Plan', n: 1, money: 1, val: function (r) { return r.plan; }, get: function (r) { return money(r.plan); } }, { label: 'Actual', n: 1, money: 1, val: function (r) { return r.actual; }, get: function (r) { return money(r.actual); } },
            { label: 'Variance', n: 1, money: 1, html: 1, val: function (r) { return r.variance; }, get: function (r) { return '<span class="' + (r.variance >= 0 ? 'pos' : 'neg') + '">' + money(r.variance) + '</span>'; } },
            { label: 'Var %', n: 1, html: 1, val: function (r) { return r.pct; }, get: function (r) { return r.pct == null ? '' : '<span class="' + (r.pct >= 0 ? 'pos' : 'neg') + '">' + pctTxt(r.pct) + '</span>'; } }],
            va.rows.filter(function (r) { return Math.abs(r.plan) >= 0.5 || Math.abs(r.actual) >= 0.5; }).sort(function (a, b) { return Math.abs(b.variance) - Math.abs(a.variance); }), { id: 'pl-var', csv: 'plan-vs-actual.csv', height: '520px', click: function (r) { PL.lineInfo(P.key(r.line)); } });
        $('ra-go').onclick = function () {
            var rest = $('ra-rest').value, rule = rest === 'plan' ? 'plan' : rest === 'runrate' ? { method: 'runrate', n: 3 } : rest === 'trend' ? { method: 'trend' } : { method: 'py', pct: 0 };
            var f = P.rolling(v, PL.ctx, va.through, rule); f.owner = who().user || ''; f.created = new Date().toISOString();
            PL.v = f; PL.baseRev = 0; PL.st.open = f.id; PL.st.view = 'grid'; keep();
            FL.toast('Forecast made — saving…', 'ok'); PL.save('created', 'Rolling forecast from ' + v.name);
        };
    };

    // ═════ checks ═════
    PL.viewChecks = function (box) {
        var v = PL.v, chk = P.checks(v, PL.ctx), ed = P.can(v, 'edit', who()), miss = chk.filter(function (c) { return c.missing; });
        var ic = { bad: 'fa-circle-xmark neg', warn: 'fa-triangle-exclamation', info: 'fa-circle-info muted' };
        box.innerHTML = '<div class="card"><h3><i class="fa-solid fa-list-check"></i> Checks <small>what a reviewer would ask about</small><span class="grow"></span>' + (ed && miss.length ? '<button class="btn sm primary" id="ck-add"><i class="fa-solid fa-plus"></i> Add the ' + miss.length + ' missing account(s) as last year</button>' : '') + '</h3>' +
            (chk.length ? '<table class="t"><tbody>' + chk.map(function (c, i) { return '<tr class="click" data-i="' + i + '"><td style="width:24px"><i class="fa-solid ' + ic[c.level] + '"></i></td><td>' + esc(c.text) + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="callout good">Nothing to look at: every line has a plan, no month below zero, no line far from last year.</div>') + '</div>';
        box.querySelectorAll('tr[data-i]').forEach(function (tr) { tr.onclick = function () { var c = chk[+tr.dataset.i]; if (c.key && PL.byKey(c.key)) PL.lineInfo(c.key); }; });
        if ($('ck-add')) $('ck-add').onclick = function () {
            miss.forEach(function (c) { var p = c.key.split('|'); v.lines.push({ company: p[0], cc: p[1], account: p[2], m: v.periods.map(function () { return 0; }), rule: { method: 'py', pct: 0 }, adj: 1 }); });
            PL.changed(true); FL.toast(miss.length + ' line(s) added', 'ok');
        };
    };

    // ═════ AI: review the plan, or turn assumptions in plain words into rules ═════
    PL.GUIDE = 'To change the plan answer with ONE ```plan block: a JSON array of changes, each {"match": "<account code> | type:R | type:E | class:<class name> | all", "company": "<code, optional>", ' +
        '"rule": {"method": "py|runrate|annual|growth|driver|pctof|trend|manual|zero", "pct": number, "n": months, "amount": year amount in full units, "spread": "even|season", "start": first month, "driver": id, "rate": number, "of": "type:R|class:<name>|<account>"}, "note": "why"}. ' +
        'Later changes win over earlier ones. Optionally {"driver": {"name": "Headcount", "unit": "people", "values": [12 numbers]}} adds a driver (refer to it by name in rule.driver). Amounts are in full units, revenue and costs positive.';
    PL.context = function () {
        var v = PL.v, t = PL.totals();
        return { page: 'Planning', version: { name: v.name, kind: v.kind, year: v.year, status: v.status, companies: v.companies, grain: v.grain, currency: v.currency, periods: v.periods.map(function (p) { return p.period_name; }), actualThrough: v.actualThrough },
            totals: { revenue: Math.round(t.sum.rev), costOfSales: Math.round(t.sum.cos), expenses: Math.round(t.sum.exp), netProfit: Math.round(t.sum.np), lastYear: { revenue: Math.round(t.sum.pyRev), expenses: Math.round(t.sum.pyExp), netProfit: Math.round(t.sum.pyNp) } },
            byClass: Object.keys(t.byClass).map(function (c) { return { class: c, type: t.byClass[c].type, plan: Math.round(sumOf(t.byClass[c].plan)), lastYear: Math.round(sumOf(t.byClass[c].py)) }; }),
            lines: v.lines.slice(0, 250).map(function (l) { var a = PL.ctx.accounts[l.account] || {}; return [l.company, l.cc || '', l.account, a.name || '', a.class || '', PL.ruleText(l), Math.round(sumOf(l.m) * P.sign(a)), l.note || '']; }),
            linesColumns: ['company', 'cost centre', 'account', 'name', 'class', 'rule', 'plan year (display sign)', 'note'],
            drivers: v.drivers.map(function (d) { return { id: d.id, name: d.name, unit: d.unit, values: d.values }; }),
            checks: P.checks(v, PL.ctx).map(function (c) { return c.level + ': ' + c.text; }),
            duckdb: 'This PC: fin_plan_amounts (version_id, ledger, company, cost_centre, account, period_seq, amount = debit − credit) for version_id ' + JSON.stringify(v.id) + '; actuals in fin_balances (scenario ACTUAL).' };
    };
    PL.viewAi = function (box) {
        var v = PL.v, ed = P.can(v, 'edit', who()), hist = PL.st.aiLast && PL.st.aiLast.id === v.id ? PL.st.aiLast : null;
        box.innerHTML = '<div class="pl-2"><div class="card"><h3><i class="fa-solid fa-wand-magic-sparkles"></i> Plan in plain words</h3><p class="sm muted">Write the assumptions as you would to a colleague — the Copilot turns them into rules you can preview before anything changes.</p>' +
            '<textarea id="ai-in" rows="6" style="width:100%" placeholder="Revenue +8% with the new price list from April; salaries +5% from July; rent fixed at 40,000 a month; cut travel by 20%; marketing 2% of revenue; cost of sales 61% of revenue">' + esc(PL.st.aiText || '') + '</textarea>' +
            '<div class="row" style="margin-top:6px"><span class="grow"></span>' + (ed ? '<button class="btn primary" id="ai-draft"><i class="fa-solid fa-wand-magic-sparkles"></i> Turn into rules</button>' : '<span class="sm muted">Read-only version</span>') + '</div></div>' +
            '<div class="card"><h3><i class="fa-solid fa-user-tie"></i> AI review</h3><p class="sm muted">A CFO\'s challenge of this plan: assumptions that look too optimistic or too cautious, lines far from the trend, what is missing, risks and questions for the owners.</p>' +
            '<div class="row"><button class="btn" id="ai-rev"><i class="fa-solid fa-magnifying-glass-chart"></i> Review the plan</button><button class="btn" id="ai-cop"><i class="fa-solid fa-comments"></i> Ask in the Copilot</button></div></div></div>' +
            '<div id="ai-out" style="margin-top:12px">' + (hist ? '<div class="card"><div class="sm muted">Last answer · ' + esc(hist.at) + '</div><div class="cop-md">' + FL.copilot.md(hist.md, 900) + '</div></div>' : '') + '</div>';
        $('ai-cop').onclick = function () { FL.askCopilot('Review the plan "' + v.name + '": which assumptions are the riskiest, and what would you change?'); };
        $('ai-rev').onclick = function () {
            PL.ask('Review this ' + (KIND[v.kind] || 'plan').toLowerCase() + ' as a CFO would before approving it. Use run_sql on DuckDB to compare with the actual trend (fin_balances) where useful. Give: 1) verdict (approve / approve with changes / send back); 2) the 5 riskiest assumptions with the number at stake; ' +
                '3) lines far from the trend or from last year without a note; 4) what is missing; 5) questions to ask the owners. Be concise, use tables.', false);
        };
        if ($('ai-draft')) $('ai-draft').onclick = function () {
            var txt = $('ai-in').value.trim(); if (!txt) return; PL.st.aiText = txt; keep();
            PL.ask('Turn these planning assumptions into changes to the plan:\n"' + txt + '"\n\nRead the plan lines in the context (accounts, classes, last year). Match each assumption to the right accounts (prefer class: or type: matches; use account codes when the assumption names one line). ' +
                'For "from <month>" changes use method manual is NOT possible — instead use py with the yearly effect averaged, and say so in the note. Explain each change in one line, then give the ```plan block.\n\n' + PL.GUIDE, true);
        };
    };
    PL.ask = function (q, wantPlan) {
        var box = $('ai-out'), v = PL.v;
        box.innerHTML = '<div class="card"><div class="sm" id="ai-st"><i class="fa-solid fa-circle-notch fa-spin"></i> Thinking… <a id="ai-stop">stop</a></div><div id="ai-md"></div><div id="ai-prev"></div></div>';
        $('ai-stop').onclick = function () { FL.call('finAskCancel', {}).catch(function () { /* ended */ }); };
        FL.call('finAsk', { question: q, history: [], context: JSON.stringify(PL.context()) }, 11 * 60000, function (m) { if ($('ai-st') && m) $('ai-st').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> ' + esc(m); }).then(function (r) {
            var md = r.answer || '(no answer)';
            $('ai-st').innerHTML = '<span class="muted">' + (r.costUsd != null ? '$' + (+r.costUsd).toFixed(3) : '') + '</span>';
            $('ai-md').innerHTML = '<div class="cop-md">' + FL.copilot.md(md.replace(/```plan[\s\S]*?```/g, ''), 900) + '</div>';
            PL.st.aiLast = { id: v.id, at: new Date().toLocaleString(), md: md.replace(/```plan[\s\S]*?```/g, '') }; keep();
            if (wantPlan) PL.aiPreview(md);
        }).catch(function (e) { $('ai-st').innerHTML = '<span class="neg">' + esc(String(e && e.message || e)) + '</span>'; });
    };
    PL.aiParse = function (md) {
        var m = /```plan\s*([\s\S]*?)```/.exec(md || ''); if (!m) return null;
        try { var x = JSON.parse(m[1]); return Array.isArray(x) ? x : x.changes || null; } catch (e) { return null; }
    };
    /** Applies AI changes to a copy and shows what moves; Apply keeps it */
    PL.aiPreview = function (md) {
        var ch = PL.aiParse(md), box = $('ai-prev'); if (!box) return;
        if (!ch) { box.innerHTML = '<div class="callout warn sm">No ```plan block in the answer — nothing to apply.</div>'; return; }
        var v = PL.v, copy = clone(v), t0 = P.totals(v, PL.ctx), hit = 0, log = [];
        ch.forEach(function (c) {
            if (c.driver && c.driver.name) { var ex = copy.drivers.filter(function (d) { return d.name === c.driver.name; })[0]; if (ex) ex.values = c.driver.values || ex.values; else copy.drivers.push({ id: P.uid('d'), name: c.driver.name, unit: c.driver.unit || '', values: (c.driver.values || []).slice(0, copy.periods.length) }); return; }
            if (!c.rule || !c.match) return;
            var rule = clone(c.rule); if (rule.driver) { var d = copy.drivers.filter(function (x) { return x.id === rule.driver || x.name === rule.driver; })[0]; if (d) rule.driver = d.id; }
            var n = 0;
            copy.lines.forEach(function (l) {
                var a = PL.ctx.accounts[l.account] || {}, mt = c.match;
                var ok = mt === 'all' ? (a.account_type === 'R' || a.account_type === 'E') : /^type:/.test(mt) ? a.account_type === mt.slice(5) : /^class:/.test(mt) ? (a.class || '').toLowerCase() === mt.slice(6).toLowerCase() : l.account === mt;
                if (!ok || (c.company && l.company !== c.company)) return;
                var rr = clone(rule);
                if (rr.method === 'annual' && /^(type|class|all)/.test(mt)) { rr.method = 'py'; }      // a year amount for a group of lines: spread by last year's share is not given — keep last year
                l.rule = rr; l.adj = 1; if (c.note) l.note = c.note; n++;
            });
            hit += n; log.push((c.note || c.match) + ' → ' + n + ' line(s)');
        });
        P.compute(copy, PL.ctx);
        var t1 = P.totals(copy, PL.ctx), d = function (a, b) { return money(b) + ' <span class="' + (b - a >= 0 ? 'pos' : 'neg') + ' sm">(' + (b - a >= 0 ? '+' : '') + money(b - a) + ')</span>'; };
        box.innerHTML = '<div class="callout"><b>Preview — nothing changed yet.</b> ' + hit + ' line change(s).<ul class="sm">' + log.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
            '<table class="t sm"><tbody><tr><td>Revenue</td><td class="n">' + d(t0.sum.rev, t1.sum.rev) + '</td></tr><tr><td>Expenses</td><td class="n">' + d(t0.sum.exp, t1.sum.exp) + '</td></tr><tr><td><b>Net profit</b></td><td class="n"><b>' + d(t0.sum.np, t1.sum.np) + '</b></td></tr></tbody></table>' +
            '<div class="row" style="margin-top:6px"><button class="btn primary" id="ai-apply"><i class="fa-solid fa-check"></i> Apply to the plan</button><button class="btn" id="ai-no">Discard</button></div></div>';
        $('ai-apply').onclick = function () { PL.v.lines = copy.lines; PL.v.drivers = copy.drivers; PL.changed(true); FL.toast('Applied — save to keep it', 'ok'); };
        $('ai-no').onclick = function () { box.innerHTML = ''; };
    };


    // ═════ refill from actuals: as often as wanted until the plan is baselined ═════
    PL.refillDialog = function () {
        var v = PL.v; if (!P.can(v, 'refill', who())) return;
        FL.modal('<i class="fa-solid fa-rotate"></i> Refill from actuals', '<div class="sm muted" id="rf-read"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading the actuals from DuckDB again…</div>' +
            '<div class="field">Start the lines from<div class="rd-meths" id="rf-how">' + [['py', 'Last year + %', 'Same month last year — keeps the seasons'], ['runrate', 'Run-rate', 'Average of the last months'], ['trend', 'Trend', 'Seasonal trend of the actuals'], ['zero', 'Empty', 'Zero — to type or upload']]
                .map(function (x, i) { return '<button class="rd-meth' + (i === 0 ? ' on' : '') + '" data-h="' + x[0] + '"><b>' + x[1] + '</b><span>' + x[2] + '</span></button>'; }).join('') + '</div></div>' +
            '<div class="row" id="rf-x" style="gap:10px;flex-wrap:wrap;margin-top:8px"></div>' +
            '<div class="row" style="gap:14px;flex-wrap:wrap;margin-top:8px"><label class="field">Which lines<select id="rf-which"><option value="all">every line</option>' +
            (PL.st.co ? '<option value="co">company ' + esc(PL.st.co) + ' only</option>' : '') + '<option value="R">revenue lines</option><option value="E">cost lines</option></select></label>' +
            '<label class="sm"><input type="checkbox" id="rf-keep" checked> keep the lines I typed in</label><label class="sm"><input type="checkbox" id="rf-add" checked> add accounts with actuals that have no line</label>' +
            '<label class="sm"><input type="checkbox" id="rf-drop"> remove lines with no actuals and nothing planned</label></div>' +
            '<div id="rf-prev" style="margin-top:10px"></div><div class="row" style="margin-top:10px"><span class="sm muted">Nothing is saved until you press Save. Drivers, notes and the other versions stay as they are.</span><span class="grow"></span><button class="btn primary" id="rf-go" disabled><i class="fa-solid fa-check"></i> Refill</button></div>');
        var how = 'py';
        var opts = function () {
            var w = $('rf-which').value, a = function (l) { return (PL.ctx.accounts[l.account] || {}).account_type; };
            return { how: how === 'py' ? { method: 'py', pct: +(($('rf-pct') || {}).value || 0) } : how === 'runrate' ? { method: 'runrate', n: +(($('rf-n') || {}).value || 3) } : how === 'trend' ? { method: 'trend' } : { method: 'zero' },
                only: w === 'co' ? function (l) { return l.company === PL.st.co; } : w === 'R' || w === 'E' ? function (l) { return a(l) === w; } : null,
                keepTyped: $('rf-keep').checked, addMissing: $('rf-add').checked, dropEmpty: $('rf-drop').checked };
        };
        var extra = function () {
            $('rf-x').innerHTML = how === 'py' ? '<label class="field">Change %<input id="rf-pct" type="number" step="0.1" value="0"></label>' : how === 'runrate' ? '<label class="field">Months<select id="rf-n"><option>1</option><option selected>3</option><option>6</option><option>12</option></select></label>' : '';
            $('rf-x').querySelectorAll('input,select').forEach(function (x) { x.oninput = prev; x.onchange = prev; });
        };
        var prev = function () {
            var copy = clone(PL.v), t0 = P.totals(PL.v, PL.ctx), r = P.refill(copy, PL.ctx, opts()), t1 = P.totals(copy, PL.ctx);
            var row = function (lbl, a, b) { var d = b - a; return '<tr><td>' + lbl + '</td><td class="n">' + money(a) + '</td><td class="n"><b>' + money(b) + '</b></td><td class="n ' + (d >= 0 ? 'pos' : 'neg') + '">' + (d >= 0 ? '+' : '') + money(d) + '</td></tr>'; };
            $('rf-prev').innerHTML = '<div class="sm">' + r.refilled + ' line(s) refilled · ' + r.kept + ' typed line(s) kept · ' + r.added + ' added' + (r.dropped ? ' · ' + r.dropped + ' removed' : '') + '</div>' +
                '<table class="t sm" style="margin-top:6px"><thead><tr><th></th><th class="n">Now</th><th class="n">After refill</th><th class="n">Change</th></tr></thead><tbody>' +
                row('Revenue', t0.sum.rev, t1.sum.rev) + row('Expenses', t0.sum.exp, t1.sum.exp) + row('Net profit', t0.sum.np, t1.sum.np) + '</tbody></table>';
            PL.rfCopy = copy; PL.rfRes = r;
        };
        PL.prepare().then(function () {
            var la = PL.ctx.lastActual;
            $('rf-read').innerHTML = 'Actuals read from DuckDB again: ' + (PL.ctx.read || {}).plRows + ' income statement rows' + (la ? ', up to ' + esc(FL.periodName(la)) : '') + '.';
            $('rf-go').disabled = false; extra(); prev();
        }).catch(function (e) { $('rf-read').innerHTML = '<span class="neg">' + esc(String(e && e.message || e)) + '</span>'; });
        document.querySelectorAll('#rf-how .rd-meth').forEach(function (b) { b.onclick = function () { how = b.dataset.h; document.querySelectorAll('#rf-how .rd-meth').forEach(function (x) { x.classList.toggle('on', x === b); }); extra(); if (PL.ctx) prev(); }; });
        ['rf-which', 'rf-keep', 'rf-add', 'rf-drop'].forEach(function (id) { $(id).onchange = function () { if (PL.ctx) prev(); }; });
        $('rf-go').onclick = function () {
            if (!PL.rfCopy) return;
            PL.v.lines = PL.rfCopy.lines; (PL.v.notes = PL.v.notes || []).push('Refilled ' + new Date().toISOString().slice(0, 10) + ' from actuals (' + how + '): ' + PL.rfRes.refilled + ' refilled, ' + PL.rfRes.kept + ' kept, ' + PL.rfRes.added + ' added' + (PL.rfRes.dropped ? ', ' + PL.rfRes.dropped + ' removed' : ''));
            FL.closeModal(); PL.changed(true); FL.toast('Refilled — press Save to keep it', 'ok');
        };
    };

    // ═════ history ═════
    PL.viewTrail = function (box) {
        var v = PL.v;
        box.innerHTML = '<div class="card"><h3><i class="fa-solid fa-clock-rotate-left"></i> History <small>from APEX</small></h3><div id="tr-l" class="sm muted">Loading…</div>' +
            ((v.notes || []).length ? '<h3 style="margin-top:12px">Notes</h3><ul class="sm">' + v.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
        S.planEvents(v.id).then(function (ev) {
            $('tr-l').innerHTML = ev.length ? '<table class="t sm"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Status</th><th>Rev</th><th>Note</th></tr></thead><tbody>' + ev.map(function (e) {
                return '<tr><td>' + esc(e.at) + '</td><td>' + esc(e.by) + '</td><td>' + esc(e.event) + '</td><td>' + esc((P.STATUS[e.from] || e.from || '') + (e.to && e.to !== e.from ? ' → ' + (P.STATUS[e.to] || e.to) : '')) + '</td><td>' + esc(e.rev) + '</td><td>' + esc(e.note || '') + '</td></tr>';
            }).join('') + '</tbody></table>' : 'Nothing recorded yet.';
        }).catch(function (e) { $('tr-l').innerHTML = '<span class="neg">APEX: ' + esc(String(e && e.message || e)) + '</span>'; });
    };

    // ═════ menu: Excel, copy, rolling forecast, recalculate, reload, delete; budget ═════
    PL.toggleBudget = function () {
        var v = PL.v, cfg = FL.config.plan = FL.config.plan || {}, on = cfg.budget === v.id;
        if (!on && v.status !== 'APPROVED' && !confirm('This version is not approved yet. Use it as the budget in every statement anyway?')) return;
        if (!on && PL.dirty) { FL.toast('Save first — the statements read the saved version', 'err'); return; }
        cfg.budget = on ? null : v.id;
        FL.saveConfig().then(function () {
            FL.cache = {}; FL.toast(on ? 'Statements use the Fusion budget again' : '“' + v.name + '” is now the budget in every statement, KPI and variance', 'ok');
            S.planEvent(v.id, { event: on ? 'budget off' : 'budget', from: v.status, to: v.status, rev: v.rev }).catch(function () { /* trail only */ });
            PL.paint();
        }).catch(function (e) { FL.toast(String(e), 'err'); });
    };
    PL.menu = function (a) {
        var v = PL.v;
        if (a === 'xlsx') return PL.excel();
        if (a === 'upload') return PL.upload();
        if (a === 'recalc') { P.compute(v, PL.ctx); PL.changed(true); return FL.toast('Every rule recalculated', 'ok'); }
        if (a === 'rolling') { PL.st.view = 'actual'; keep(); return PL.paintMain(); }
        if (a === 'reload') return PL.loadList().then(function () { var it = PL.item(v.id); if (it) { it.pcRev = -1; } return PL.openVersion(v.id); }).then(PL.paint).catch(function (e) { FL.toast(String(e), 'err'); });
        if (a === 'copy') {
            var nm = prompt('Name of the copy', v.name + ' (copy)'); if (!nm) return;
            var c = clone(v); c.id = P.uid('p'); c.name = nm; c.status = 'DRAFT'; c.rev = 0; c.submittedBy = c.submittedAt = c.approvedBy = c.approvedAt = null; c.owner = who().user || ''; c.created = new Date().toISOString();
            if (v.kind === 'BUDGET' && confirm('Make the copy a what-if scenario? (Cancel keeps it a budget)')) c.kind = 'SCENARIO';
            PL.v = c; PL.baseRev = 0; PL.st.open = c.id; keep(); return PL.save('created', 'Copy of ' + v.name);
        }
        if (a === 'delete') {
            if (!confirm('Delete “' + v.name + '” from APEX and this PC? This cannot be undone.')) return;
            var bud = (FL.config.plan || {}).budget === v.id;
            return Promise.all([S.planDelete(v.id).catch(function (e) { FL.toast('APEX: ' + e, 'err'); }), FL.call('finPlanDelete', { id: v.id })]).then(function () {
                if (bud) { FL.config.plan.budget = null; FL.saveConfig(); FL.cache = {}; }
                PL.v = null; PL.st.open = null; keep(); FL.toast('Deleted', 'ok'); return PL.loadList();
            }).then(PL.paint);
        }
    };
    PL.excel = function () {
        if (!window.ExcelJS) { FL.toast('Excel library did not load (internet?)', 'err'); return; }
        var v = PL.v, sh = P.toSheet(v, PL.ctx), wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Plan'), n = v.periods.length;
        ws.addRow([v.name + ' · ' + (KIND[v.kind] || v.kind) + ' ' + v.year + ' · ' + (v.currency || '') + ' · full units, revenue and costs positive']).font = { bold: true };
        ws.addRow(['Change the month columns and upload the file again (Planning › ⋯ › Upload Excel). New rows need Company and Account.']).font = { italic: true, color: { argb: 'FF64748B' } };
        var h = ws.addRow(sh.head); h.font = { bold: true }; h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        sh.rows.forEach(function (r, i) { var row = ws.addRow(r); var rn = row.number; row.getCell(6 + n).value = { formula: 'SUM(' + ws.getColumn(6).letter + rn + ':' + ws.getColumn(5 + n).letter + rn + ')', result: r[5 + n] }; void i; });
        for (var c = 6; c <= 6 + n; c++) ws.getColumn(c).numFmt = '#,##0;(#,##0);"-"';
        ws.getColumn(4).width = 34; ws.views = [{ state: 'frozen', xSplit: 5, ySplit: 3 }];
        var d = wb.addWorksheet('Drivers'); d.addRow(['Driver', 'Unit'].concat(v.periods.map(function (p) { return p.period_name; }))).font = { bold: true };
        v.drivers.forEach(function (x) { d.addRow([x.name, x.unit || ''].concat(x.values)); });
        wb.xlsx.writeBuffer().then(function (buf) { FL.download(v.name.replace(/[^\w\- ]+/g, '') + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); });
    };
    PL.upload = function () {
        var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx';
        inp.onchange = function () {
            var f = inp.files[0]; if (!f || !window.ExcelJS) return;
            f.arrayBuffer().then(function (buf) { var wb = new ExcelJS.Workbook(); return wb.xlsx.load(buf).then(function () { return wb; }); }).then(function (wb) {
                var ws = wb.getWorksheet('Plan') || wb.worksheets[0], rows = [];
                ws.eachRow({ includeEmpty: false }, function (row) { rows.push(row.values.slice(1).map(function (c) { return c && typeof c === 'object' ? (c.result != null ? c.result : c.text != null ? c.text : '') : c; })); });
                var hi = rows.findIndex(function (r) { return r.some(function (c) { return String(c).trim().toLowerCase() === 'account'; }); });
                if (hi < 0) throw new Error('No header row with an Account column');
                var res = P.fromSheet(PL.v, PL.ctx, rows[hi], rows.slice(hi + 1));
                if (res.error) throw new Error(res.error);
                PL.changed(true);
                FL.toast(res.changed + ' line(s) changed, ' + res.added + ' added' + (res.unknown.length ? ' · ' + res.unknown.length + ' row(s) skipped' : '') + ' — save to keep it', res.unknown.length ? 'err' : 'ok');
                if (res.unknown.length) console.warn('[Plan] skipped', res.unknown);
            }).catch(function (e) { FL.toast('Upload: ' + (e && e.message || e), 'err'); });
        };
        inp.click();
    };

    // ═════ new version ═════
    PL.newDialog = function () {
        var years = {}; FL.dims.periods.forEach(function (p) { years[p.fiscal_year] = 1; });
        var ys = Object.keys(years).map(Number).sort(), last = ys.length ? ys[ys.length - 1] : new Date().getFullYear(), opts = [last - 1, last, last + 1, last + 2].filter(function (y) { return y >= (ys[0] || y); });
        var leds = FL.dims.ledgers || [], led0 = FL.filter.ledger || (leds[0] || {}).code || '';
        var cosOf = function (led) { var lc = (FL.dims.ledgerCompanies || []).filter(function (x) { return !led || x.ledger === led; }).map(function (x) { return x.company; }); return lc.length ? lc : FL.dims.companies.map(function (c) { return c.code; }); };
        var realCc = (FL.dims.ccs || []).some(function (c) { return c.code && !/^[-\s0]*$/.test(c.code); });
        FL.modal('<i class="fa-solid fa-plus"></i> New plan', '<div class="row" style="flex-wrap:wrap;gap:10px">' +
            '<label class="field">Kind<select id="nv-k"><option value="BUDGET">Budget — the target for a year</option><option value="FORECAST">Forecast — where this year will land</option><option value="SCENARIO">Scenario — what if …</option></select></label>' +
            '<label class="field">Fiscal year<select id="nv-y">' + opts.map(function (y) { return '<option' + (y === last + 1 ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select></label>' +
            '<label class="field" style="flex:1;min-width:220px">Name<input id="nv-n" value="Budget ' + (last + 1) + '"></label></div>' +
            (leds.length ? '<label class="field">Ledger<select id="nv-l">' + leds.map(function (l) { return '<option value="' + esc(l.code) + '"' + (l.code === led0 ? ' selected' : '') + '>' + esc(l.name + ' (' + (l.currency || '') + ')') + '</option>'; }).join('') + '</select></label>' : '') +
            '<div class="field">Companies <span class="sm muted">(<a id="nv-all">all</a> · <a id="nv-none">none</a>)</span><div id="nv-cos" class="pl-chips"></div></div>' +
            '<label class="field">Plan by<select id="nv-g"><option value="account">company × account</option>' + (realCc ? '<option value="cc">company × cost centre × account</option>' : '') + '</select></label>' +
            '<div class="field">Start every line from<div class="rd-meths" id="nv-how">' + [['py', 'Last year + %', 'Same month last year, grown — keeps the seasons'], ['runrate', 'Run-rate', 'Average of the last 3 months'], ['trend', 'Trend', 'Seasonal trend of the actuals'],
                ['zero', 'Empty', 'Every line at zero — type or upload it'], ['copy', 'Another version', 'Copy the lines and rules of a saved plan']].map(function (x, i) { return '<button class="rd-meth' + (i === 0 ? ' on' : '') + '" data-h="' + x[0] + '"><b>' + x[1] + '</b><span>' + x[2] + '</span></button>'; }).join('') + '</div></div>' +
            '<div class="row" id="nv-extra" style="gap:10px"></div>' +
            '<div class="row" style="margin-top:12px"><span class="sm muted">Lines: every income statement account with actuals in the last 24 months.</span><span class="grow"></span><button class="btn primary" id="nv-go"><i class="fa-solid fa-check"></i> Create</button></div>');
        var how = 'py';
        var paintCos = function () {
            var led = $('nv-l') ? $('nv-l').value : '', list = cosOf(led), def = FL.filter.company && list.indexOf(FL.filter.company) >= 0 ? [FL.filter.company] : list;
            $('nv-cos').innerHTML = list.map(function (c) { var nm = (FL.dims.companies.filter(function (x) { return x.code === c; })[0] || {}).name; return '<label class="pl-chip"><input type="checkbox" value="' + esc(c) + '"' + (def.indexOf(c) >= 0 ? ' checked' : '') + '> ' + esc(c + (nm && nm !== c ? ' ' + nm : '')) + '</label>'; }).join('');
        };
        var paintExtra = function () {
            $('nv-extra').innerHTML = how === 'py' ? '<label class="field">Change %<input id="nv-pct" type="number" step="0.1" value="0"></label>' : how === 'copy' ? '<label class="field">Version<select id="nv-src">' + PL.list.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name + ' (' + x.year + ')') + '</option>'; }).join('') + '</select></label><label class="field">Change every line %<input id="nv-pct" type="number" step="0.1" value="0"></label>' : '';
        };
        paintCos(); paintExtra();
        if ($('nv-l')) $('nv-l').onchange = paintCos;
        $('nv-all').onclick = function () { $('nv-cos').querySelectorAll('input').forEach(function (x) { x.checked = true; }); };
        $('nv-none').onclick = function () { $('nv-cos').querySelectorAll('input').forEach(function (x) { x.checked = false; }); };
        var autoName = function () { var k = $('nv-k').value, y = $('nv-y').value; if (/^(Budget|Forecast|Scenario) \d{4}$/.test($('nv-n').value)) $('nv-n').value = (KIND[k] || k) + ' ' + y; };
        $('nv-k').onchange = autoName; $('nv-y').onchange = autoName;
        document.querySelectorAll('#nv-how .rd-meth').forEach(function (b) { b.onclick = function () { how = b.dataset.h; document.querySelectorAll('#nv-how .rd-meth').forEach(function (x) { x.classList.toggle('on', x === b); }); paintExtra(); }; });
        $('nv-go').onclick = function () {
            var cos = Array.prototype.slice.call($('nv-cos').querySelectorAll('input:checked')).map(function (x) { return x.value; });
            if (!cos.length) { FL.toast('Pick at least one company', 'err'); return; }
            var y = +$('nv-y').value, led = $('nv-l') ? $('nv-l').value : '', L = leds.filter(function (l) { return l.code === led; })[0] || {};
            var v = { id: P.uid('p'), name: $('nv-n').value.trim() || 'Plan ' + y, kind: $('nv-k').value, year: y, ledger: led, currency: L.currency || ((FL.dims.companies.filter(function (c) { return c.code === cos[0]; })[0] || {}).currency) || '',
                companies: cos, grain: $('nv-g').value, periods: P.periodsFor(y, FL.dims.periods), drivers: [], lines: [], status: 'DRAFT', rev: 0, owner: who().user || '', created: new Date().toISOString() };
            var pct = $('nv-pct') ? +$('nv-pct').value || 0 : 0;
            $('nv-go').disabled = true; $('nv-go').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Building…';
            var src = how === 'copy' ? $('nv-src').value : null;
            PL.v = v;
            PL.prepare().then(function () {
                if (src) {
                    var it = PL.item(src);
                    return (it && it.apexRev != null ? S.planLoad(src) : PL.loadPc(src)).then(function (o) {
                        PL.norm(o);
                        v.drivers = clone(o.drivers || []);
                        // lines by account (and company / cost centre); months matched by period number (a different year keeps the shape)
                        o.lines.forEach(function (l) {
                            if (cos.indexOf(l.company) < 0) return;
                            var nl = { company: l.company, cc: v.grain === 'cc' ? l.cc : '', account: l.account, rule: clone(l.rule), adj: l.adj, note: l.note, m: v.periods.map(function (p) { var j = o.periods.map(function (q) { return q.period_num; }).indexOf(p.period_num); return j >= 0 ? (l.m[j] || 0) * (1 + pct / 100) : 0; }) };
                            if (pct && nl.rule.method !== 'manual') nl.rule.pct = ((+nl.rule.pct || 0) + pct);
                            v.lines.push(nl);
                        });
                        P.compute(v, PL.ctx);
                    });
                }
                P.seed(v, PL.ctx, how === 'py' ? { method: 'py', pct: pct } : how === 'runrate' ? { method: 'runrate', n: 3 } : how === 'trend' ? { method: 'trend' } : { method: 'zero' });
            }).then(function () {
                if (!v.lines.length) FL.toast('No actuals found for these companies — the Plan tab shows what the DuckDB file holds', 'err');
                FL.closeModal(); PL.baseRev = 0; PL.st.open = v.id; PL.st.view = 'grid'; PL.st.co = cos.length === 1 ? cos[0] : ''; PL.st.cc = ''; keep();
                return PL.save('created', 'New ' + (KIND[v.kind] || v.kind).toLowerCase() + ', ' + v.lines.length + ' lines, start: ' + how);
            }).catch(function (e) { FL.toast(String(e && e.message || e), 'err'); $('nv-go').disabled = false; $('nv-go').textContent = 'Create'; });
        };
    };
})();
