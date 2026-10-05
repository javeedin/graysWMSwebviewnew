/* Finance Lens — planning & budgeting engine (FPLAN). Pure: runs in the page and in node (tests).

   A plan version = { id, name, kind: BUDGET | FORECAST | SCENARIO, year (fiscal year), ledger, currency, companies, grain: 'account' |
     'cc' (company × cost centre × account), periods: [{ period_seq, period_name, fiscal_year, period_num, quarter }],
     actualThrough: period_seq | null (rolling forecast: months up to it are actuals), drivers: [{ id, name, unit, values: [n per month] }],
     lines: [{ company, cc, account, m: [n per month — NATURAL sign, debit − credit, like fin_balances], rule: { method, … }, adj, note }],
     status: DRAFT | SUBMITTED | APPROVED | REJECTED, rev }
   Rules work in the DISPLAY sign (revenue and costs positive) and are stored back in the natural sign:
     manual  — the months as typed
     py      — the same month last year × (1 + pct %)
     runrate — the average of the last n actual months × (1 + pct %), every month
     annual  — an annual amount spread evenly or like last year's months (spread: even | season)
     growth  — a start amount growing pct % a month
     driver  — a driver's monthly values × rate (or × a second driver)
     pctof   — pct % of other lines of the same company: of = 'type:R' | 'class:<name>' | an account code
     trend   — Holt-Winters / linear trend of the actual months (FINE.forecast)
     zero
   adj multiplies whatever the rule gives (goal seek writes it). Months up to actualThrough are always the actuals.
   hist = { 'company|cc|account': { period_seq: natural net } } — the actuals the rules read (cc '' when the grain has none). */
(function (root) {
    'use strict';
    var P = {};
    var FINE = root.FINE || (typeof require === 'function' ? (function () { try { return require('./fin-engine.js'); } catch (e) { return null; } })() : null);
    var CREDIT = { R: 1, L: 1, O: 1 };

    P.METHODS = [
        { id: 'py', name: 'Last year + %', help: 'Same month last year, grown by a percentage — keeps the seasons' },
        { id: 'runrate', name: 'Run-rate', help: 'Average of the last months, every month' },
        { id: 'annual', name: 'Annual amount', help: 'One figure for the year, spread evenly or like last year' },
        { id: 'growth', name: 'Start + growth', help: 'A first month that grows each month' },
        { id: 'driver', name: 'Driver × rate', help: 'Quantity × price, headcount × salary …' },
        { id: 'pctof', name: '% of another line', help: 'Cost of sales = 62 % of revenue, commission = 3 % …' },
        { id: 'trend', name: 'Trend forecast', help: 'Seasonal trend of the actuals (Holt-Winters with 24+ months)' },
        { id: 'manual', name: 'Typed in', help: 'The months as you typed them' },
        { id: 'zero', name: 'Zero', help: 'Nothing planned' }
    ];
    P.methodName = function (id) { var m = P.METHODS.filter(function (x) { return x.id === id; })[0]; return m ? m.name : id || 'Typed in'; };
    P.uid = function (p) { return (p || 'v') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };
    P.sign = function (acc) { return acc && CREDIT[acc.account_type] ? -1 : 1; };
    P.key = function (l) { return (l.company || '') + '|' + (l.cc || '') + '|' + l.account; };
    var r2 = function (v) { return Math.round(v * 100) / 100; };
    var sum = function (a) { var s = 0; (a || []).forEach(function (v) { s += +v || 0; }); return s; };

    // ── periods ──
    var shiftName = function (name, k) {
        name = String(name || '');
        if (/\d{4}/.test(name)) return name.replace(/\d{4}/, function (y) { return String(+y + k); });
        return name.replace(/(\d{2})(?!.*\d)/, function (y) { return String((+y + k + 100) % 100).padStart(2, '0'); });
    };
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    /** The periods of a fiscal year: the loaded ones, else the latest complete loaded year moved forward, else a calendar year. */
    P.periodsFor = function (year, known) {
        var by = {};
        (known || []).forEach(function (p) { (by[p.fiscal_year] = by[p.fiscal_year] || []).push(p); });
        var pick = function (list) { return list.slice().sort(function (a, b) { return a.period_seq - b.period_seq; }); };
        if (by[year] && by[year].length >= 12) return pick(by[year]).map(function (p) { return { period_seq: +p.period_seq, period_name: p.period_name, fiscal_year: +p.fiscal_year, period_num: +p.period_num, quarter: +p.quarter || Math.ceil(p.period_num / 3) }; });
        var full = Object.keys(by).filter(function (y) { return by[y].length >= 12; }).map(Number).sort(function (a, b) { return b - a; })[0];
        if (full != null) {
            var k = year - full;
            return pick(by[full]).map(function (p) { return { period_seq: +p.period_seq + 100 * k, period_name: shiftName(p.period_name, k), fiscal_year: year, period_num: +p.period_num, quarter: +p.quarter || Math.ceil(p.period_num / 3) }; });
        }
        return MON.map(function (m, i) { return { period_seq: year * 100 + i + 1, period_name: m + '-' + String(year).slice(2), fiscal_year: year, period_num: i + 1, quarter: Math.floor(i / 3) + 1 }; });
    };

    // ── history helpers ──
    /** Actual months of one line (display sign), sorted: [{seq, v}] up to `upto` */
    P.series = function (hist, key, s, upto) {
        var h = hist[key] || {};
        return Object.keys(h).map(Number).filter(function (q) { return !upto || q <= upto; }).sort(function (a, b) { return a - b; }).map(function (q) { return { seq: q, v: h[q] * s }; });
    };
    // consecutive months: fills the gaps between the first and the last month with 0 (a month without postings is a 0, not missing)
    var monthsBetween = function (a, b) { var out = []; for (var q = a; q <= b && out.length < 600; q = q % 100 >= 12 ? (Math.floor(q / 100) + 1) * 100 + 1 : q + 1) out.push(q); return out; };
    var mi = function (q) { return Math.floor(q / 100) * 12 + (q % 100); };
    P.lastActual = function (hist) { var mx = 0; Object.keys(hist).forEach(function (k) { Object.keys(hist[k]).forEach(function (q) { if (+q > mx) mx = +q; }); }); return mx || null; };

    // ── rules ──
    /** Display values of one line for every plan month (before adj and actuals) */
    P.ruleValues = function (line, v, ctx, computed) {
        var acc = ctx.accounts[line.account] || {}, s = P.sign(acc), key = P.key(line), n = v.periods.length, rule = line.rule || { method: 'manual' };
        var hist = ctx.hist || {}, h = hist[key] || {}, out = [], i;
        // a rolling forecast reads the actuals up to its cut-off; a plan reads what is loaded (trend: up to the month before the plan)
        var first = v.periods[0].period_seq, cut = v.actualThrough || ctx.lastActual, upto = v.actualThrough || Math.min(ctx.lastActual || first - 1, first - 1);
        var pct = (+rule.pct || 0) / 100;
        switch (rule.method) {
            case 'py':
                for (i = 0; i < n; i++) out.push((h[v.periods[i].period_seq - 100] || 0) * s * (1 + pct));
                return out;
            case 'runrate': {
                var k = Math.max(1, +rule.n || 3), ser = P.series(hist, key, s, cut), last = ser.length ? ser[ser.length - 1].seq : null;
                var months = last ? monthsBetween(ser[0].seq, last).slice(-k) : [], avg = months.length ? sum(months.map(function (q) { return (h[q] || 0) * s; })) / months.length : 0;
                for (i = 0; i < n; i++) out.push(avg * (1 + pct));
                return out;
            }
            case 'annual': {
                var amt = +rule.amount || 0, w = [];
                if (rule.spread === 'season') {
                    w = v.periods.map(function (p) { return Math.abs((h[p.period_seq - 100] || 0)); });
                    if (!sum(w) && ctx.season) w = ctx.season.slice(0, n);
                }
                if (!sum(w)) w = v.periods.map(function () { return 1; });
                var tw = sum(w);
                for (i = 0; i < n; i++) out.push(amt * w[i] / tw);
                return out;
            }
            case 'growth':
                for (i = 0; i < n; i++) out.push((+rule.start || 0) * Math.pow(1 + pct, i));
                return out;
            case 'driver': {
                var d = (v.drivers || []).filter(function (x) { return x.id === rule.driver; })[0], d2 = rule.driver2 ? (v.drivers || []).filter(function (x) { return x.id === rule.driver2; })[0] : null;
                var rate = rule.rate == null || rule.rate === '' ? 1 : +rule.rate;
                for (i = 0; i < n; i++) out.push((d ? +d.values[i] || 0 : 0) * (d2 ? +d2.values[i] || 0 : rate) * Math.pow(1 + pct, i));
                return out;
            }
            case 'pctof': {
                var base = P.baseOf(rule.of, line, v, ctx, computed);
                for (i = 0; i < n; i++) out.push(base[i] * (+rule.pct || 0) / 100);
                return out;
            }
            case 'trend': {
                var sr = P.series(hist, key, s, upto), y = sr.length ? monthsBetween(sr[0].seq, sr[sr.length - 1].seq).slice(-36).map(function (q) { return (h[q] || 0) * s; }) : [];
                if (y.length < 3 || !FINE) { for (i = 0; i < n; i++) out.push(y.length ? sum(y) / y.length : 0); return out; }
                var lastSeq = sr[sr.length - 1].seq, gap = mi(first) - mi(lastSeq) - 1;         // months between the last actual and the plan's first (negative: inside the plan)
                var f = FINE.forecast(y, Math.max(0, gap) + n).forecast;
                if (gap >= 0) f = f.slice(gap); else f = new Array(-gap).fill(0).concat(f);
                for (i = 0; i < n; i++) out.push(f[i] || 0);
                return out;
            }
            case 'zero':
                for (i = 0; i < n; i++) out.push(0);
                return out;
            default:     // manual: the stored months
                for (i = 0; i < n; i++) out.push(((line.m || [])[i] || 0) * s);
                return out;
        }
    };
    /** Display totals per month of the lines a pctof rule refers to (same company, else every company) */
    P.baseOf = function (of, line, v, ctx, computed) {
        var n = v.periods.length, out = [], i;
        for (i = 0; i < n; i++) out.push(0);
        if (!of) return out;
        var match = function (l) {
            if (l === line) return false;
            var a = ctx.accounts[l.account] || {};
            if (/^type:/.test(of)) return a.account_type === of.slice(5);
            if (/^class:/.test(of)) return (a.class || '') === of.slice(6);
            return l.account === of;
        };
        var lines = v.lines.filter(function (l) { return match(l) && l.company === line.company && (!line.cc || !l.cc || l.cc === line.cc); });
        if (!lines.length) lines = v.lines.filter(match);
        lines.forEach(function (l) {
            var vals = computed[P.key(l)];
            var s = P.sign(ctx.accounts[l.account]);
            for (i = 0; i < n; i++) out[i] += vals ? vals[i] : ((l.m || [])[i] || 0) * s;
        });
        return out;
    };

    /** Recalculates every line from its rule (pctof after the others, so they see this round's values). Returns the version. */
    P.compute = function (v, ctx) {
        ctx = Object.assign({}, ctx); ctx.lastActual = ctx.lastActual || P.lastActual(ctx.hist || {});
        if (!ctx.season) ctx.season = P.season(v, ctx);
        var computed = {}, n = v.periods.length, through = v.actualThrough || 0;
        var finish = function (l, disp) {
            var acc = ctx.accounts[l.account] || {}, s = P.sign(acc), h = (ctx.hist || {})[P.key(l)] || {}, adj = l.adj == null ? 1 : +l.adj;
            var m = [];
            for (var i = 0; i < n; i++) {
                var seq = v.periods[i].period_seq;
                m.push(through && seq <= through ? r2(h[seq] || 0) : r2((disp[i] || 0) * (l.rule && l.rule.method !== 'manual' ? adj : 1) * s));
            }
            l.m = m; computed[P.key(l)] = m.map(function (x) { return x * s; });
        };
        var later = [];
        v.lines.forEach(function (l) { if (l.rule && l.rule.method === 'pctof') later.push(l); else finish(l, P.ruleValues(l, v, ctx, computed)); });
        // a % line may be based on another % line: a few rounds settle chains
        for (var round = 0; round < 4 && later.length; round++) later.forEach(function (l) { finish(l, P.ruleValues(l, v, ctx, computed)); });
        return v;
    };
    /** Last year's pattern of revenue (fallback for 'season' spreads of lines without history) */
    P.season = function (v, ctx) {
        var w = v.periods.map(function () { return 0; });
        Object.keys(ctx.hist || {}).forEach(function (k) {
            var acc = ctx.accounts[k.split('|')[2]]; if (!acc || acc.account_type !== 'R') return;
            v.periods.forEach(function (p, i) { w[i] += Math.abs(ctx.hist[k][p.period_seq - 100] || 0); });
        });
        return sum(w) ? w : null;
    };

    // ── a new version ──
    /** Lines for every income statement account with actuals in the last 24 months (per company, per cost centre when the grain says so).
        how = { method, pct, n, … } (the rule each line starts with) */
    P.seed = function (v, ctx, how) {
        var first = v.periods[0].period_seq, from = first - 200, cos = v.companies && v.companies.length ? v.companies : null, seen = {};
        Object.keys(ctx.hist || {}).forEach(function (k) {
            var p = k.split('|'), acc = ctx.accounts[p[2]];
            if (!acc || (acc.account_type !== 'R' && acc.account_type !== 'E')) return;
            if (cos && cos.indexOf(p[0]) < 0) return;
            var h = ctx.hist[k], any = Object.keys(h).some(function (q) { return +q >= from && +q < first && Math.abs(h[q]) >= 0.5; });
            if (!any) return;
            var line = { company: p[0], cc: v.grain === 'cc' ? p[1] : '', account: p[2], m: v.periods.map(function () { return 0; }), rule: Object.assign({}, how || { method: 'py', pct: 0 }) };
            var key = P.key(line); if (seen[key]) return; seen[key] = 1;
            v.lines.push(line);
        });
        v.lines.sort(function (a, b) { return a.company.localeCompare(b.company) || String(a.account).localeCompare(String(b.account), undefined, { numeric: true }) || String(a.cc).localeCompare(String(b.cc)); });
        return P.compute(v, ctx);
    };
    /** hist at the version's grain: rows [{company, cc, account, seq, net}] (cc folded away when the grain is 'account') */
    P.histFrom = function (rows, grain) {
        var h = {};
        rows.forEach(function (r) {
            var k = (r.company || '') + '|' + (grain === 'cc' ? r.cc || '' : '') + '|' + r.account;
            (h[k] = h[k] || {})[+r.seq] = ((h[k] || {})[+r.seq] || 0) + (+r.net || 0);
        });
        return h;
    };

    // ── totals, facts for statements ──
    /** Per month (display): revenue, expenses, profit, by class; plus the same for last year's actuals */
    P.totals = function (v, ctx) {
        var n = v.periods.length, z = function () { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; };
        var t = { rev: z(), exp: z(), cos: z(), np: z(), pyRev: z(), pyExp: z(), pyNp: z(), byClass: {} };
        v.lines.forEach(function (l) {
            var acc = ctx.accounts[l.account] || {}, s = P.sign(acc), h = (ctx.hist || {})[P.key(l)] || {};
            var cls = acc.class || (acc.account_type === 'R' ? 'Revenue' : 'Other expenses'), bc = t.byClass[cls] = t.byClass[cls] || { type: acc.account_type, plan: z(), py: z() };
            for (var i = 0; i < n; i++) {
                var x = (l.m[i] || 0) * s, y = (h[v.periods[i].period_seq - 100] || 0) * s;
                bc.plan[i] += x; bc.py[i] += y;
                if (acc.account_type === 'R') { t.rev[i] += x; t.pyRev[i] += y; } else if (acc.account_type === 'E') { t.exp[i] += x; t.pyExp[i] += y; if (/cost of sales/i.test(cls)) t.cos[i] += x; }
            }
        });
        for (var i = 0; i < n; i++) { t.np[i] = t.rev[i] - t.exp[i]; t.pyNp[i] = t.pyRev[i] - t.pyExp[i]; }
        t.sum = { rev: sum(t.rev), exp: sum(t.exp), cos: sum(t.cos), np: sum(t.np), pyRev: sum(t.pyRev), pyExp: sum(t.pyExp), pyNp: sum(t.pyNp) };
        return t;
    };
    /** FINE facts of the plan (scenario name) — net per month, end balance = year to date (income statement accounts restart each year) */
    P.facts = function (v, scenario, filter) {
        var f = {}, sc = f[scenario || 'PLAN'] = {};
        v.lines.forEach(function (l) {
            if (filter && !filter(l)) return;
            var a = sc[l.account] = sc[l.account] || {};
            v.periods.forEach(function (p, i) { var x = a[p.period_seq] = a[p.period_seq] || [0, 0]; x[0] += l.m[i] || 0; });
        });
        Object.keys(sc).forEach(function (acc) {
            var run = 0, yr = null;
            v.periods.forEach(function (p) { if (p.fiscal_year !== yr) { run = 0; yr = p.fiscal_year; } var x = sc[acc][p.period_seq]; run += x[0]; x[1] = run; });
        });
        return f;
    };

    // ── checks ──
    /** What looks wrong or worth a second look: [{level: bad|warn|info, text, key}] */
    P.checks = function (v, ctx) {
        var out = [], t = P.totals(v, ctx), mat = Math.max(1, Math.abs(t.sum.rev || t.sum.pyRev) * 0.01), have = {};
        if (!v.lines.length) out.push({ level: 'bad', text: 'The plan has no lines yet.' });
        if (Math.abs(t.sum.rev) < 0.5 && v.lines.length) out.push({ level: 'bad', text: 'No revenue is planned.' });
        v.lines.forEach(function (l) {
            have[P.key(l)] = 1;
            var acc = ctx.accounts[l.account] || {}, s = P.sign(acc), h = (ctx.hist || {})[P.key(l)] || {}, name = (acc.name || l.account) + (l.company ? ' · ' + l.company : '') + (l.cc ? ' · ' + l.cc : '');
            var plan = sum(l.m) * s, py = sum(v.periods.map(function (p) { return (h[p.period_seq - 100] || 0) * s; }));
            var neg = l.m.filter(function (x) { return x * s < -0.5; }).length;
            // a contra line (returns, discounts, FX gains) is negative by nature: only a line that was positive last year is flagged
            if (neg && py >= 0 && (acc.account_type === 'R' || acc.account_type === 'E')) out.push({ level: 'warn', key: P.key(l), text: name + ': ' + neg + ' month(s) below zero' });
            if (Math.abs(py) >= mat && Math.abs(plan - py) / Math.abs(py) > 0.5) out.push({ level: 'warn', key: P.key(l), text: name + ': ' + (plan > py ? '+' : '') + Math.round((plan - py) / Math.abs(py) * 100) + ' % against last year' });
            if (Math.abs(py) < 0.5 && Math.abs(plan) >= mat) out.push({ level: 'info', key: P.key(l), text: name + ': new — nothing last year' });
            if (Math.abs(py) >= mat && Math.abs(plan) < 0.5) out.push({ level: 'warn', key: P.key(l), text: name + ': nothing planned (last year ' + Math.round(py).toLocaleString('en-US') + ')' });
        });
        // accounts with real actuals last year that the plan does not have
        var first = v.periods[0].period_seq, cos = v.companies && v.companies.length ? v.companies : null;
        Object.keys(ctx.hist || {}).forEach(function (k) {
            var p = k.split('|'), acc = ctx.accounts[p[2]]; if (!acc || (acc.account_type !== 'R' && acc.account_type !== 'E')) return;
            if (cos && cos.indexOf(p[0]) < 0) return;
            var kk = p[0] + '|' + (v.grain === 'cc' ? p[1] : '') + '|' + p[2]; if (have[kk]) return;
            var py = 0; Object.keys(ctx.hist[k]).forEach(function (q) { if (+q >= first - 100 && +q < first) py += ctx.hist[k][q] * P.sign(acc); });
            if (Math.abs(py) >= mat) { have[kk] = 1; out.push({ level: 'warn', key: kk, missing: true, text: (acc.name || p[2]) + ' · ' + p[0] + ': had ' + Math.round(py).toLocaleString('en-US') + ' in the last 12 months but is not in the plan' }); }
        });
        if (t.sum.rev && t.sum.pyRev) {
            var m1 = t.sum.np / t.sum.rev * 100, m0 = t.sum.pyNp / t.sum.pyRev * 100;
            if (Math.abs(m1 - m0) > 5) out.push({ level: 'info', text: 'Net margin ' + m1.toFixed(1) + ' % against ' + m0.toFixed(1) + ' % last year (' + (m1 > m0 ? '+' : '') + (m1 - m0).toFixed(1) + ' pts) — explain it in the notes' });
        }
        return out;
    };

    // ── top-down: goal seek and targets ──
    /** Which lines a goal seek may change: 'opex' (expenses that are not cost of sales), 'cos', 'exp' (every expense), 'rev' */
    P.inScope = function (l, scope, ctx) {
        var a = ctx.accounts[l.account] || {}, cos = /cost of sales/i.test(a.class || '');
        return scope === 'rev' ? a.account_type === 'R' : scope === 'cos' ? a.account_type === 'E' && cos : scope === 'exp' ? a.account_type === 'E' : a.account_type === 'E' && !cos;
    };
    /** Profit for the year = target: the lines in scope get one factor (adj × f). Returns {factor, before, after} or {error}. */
    P.goalSeek = function (v, ctx, target, scope) {
        var t = P.totals(v, ctx), sel = 0;
        v.lines.forEach(function (l) { if (P.inScope(l, scope, ctx)) sel += sum(l.m) * P.sign(ctx.accounts[l.account]); });
        if (Math.abs(sel) < 0.5) return { error: 'Nothing planned on the lines it may change.' };
        // profit = rev − exp; changing the selected part by f: rev side adds (f−1)·sel, expense side takes it away
        var need = target - t.sum.np, f = scope === 'rev' ? 1 + need / sel : 1 - need / sel;
        if (f < 0) return { error: 'Out of reach: the lines would have to go below zero (factor ' + f.toFixed(2) + ').' };
        v.lines.forEach(function (l) {
            if (!P.inScope(l, scope, ctx)) return;
            if (!l.rule || l.rule.method === 'manual') { l.m = l.m.map(function (x) { return r2(x * f); }); return; }
            l.adj = (l.adj == null ? 1 : +l.adj) * f;
        });
        P.compute(v, ctx);
        return { factor: f, before: t.sum.np, after: P.totals(v, ctx).sum.np };
    };
    /** Targets for the whole plan: revenue growth, gross margin, cost growth by class → rules on every line */
    P.applyTargets = function (v, ctx, tg) {
        var classes = tg.classes || {};
        v.lines.forEach(function (l) {
            var a = ctx.accounts[l.account] || {}, cls = a.class || '';
            if (a.account_type === 'R' && tg.revGrowth != null && tg.revGrowth !== '') l.rule = { method: 'py', pct: +tg.revGrowth };
            else if (a.account_type === 'E' && /cost of sales/i.test(cls) && tg.grossMargin != null && tg.grossMargin !== '') l.rule = { method: 'py', pct: 0, _gm: 1 };
            else if (a.account_type === 'E' && classes[cls] != null && classes[cls] !== '') l.rule = { method: 'py', pct: +classes[cls] };
            else if (a.account_type === 'E' && tg.costGrowth != null && tg.costGrowth !== '' && !/cost of sales/i.test(cls)) l.rule = { method: 'py', pct: +tg.costGrowth };
            l.adj = 1;
        });
        P.compute(v, ctx);
        // gross margin: cost of sales lines become a % of revenue that keeps each line's share of last year's cost of sales
        if (tg.grossMargin != null && tg.grossMargin !== '') {
            var cosLines = v.lines.filter(function (l) { return l.rule && l.rule._gm; }), byCo = {};
            cosLines.forEach(function (l) { var s = P.sign(ctx.accounts[l.account]), h = (ctx.hist || {})[P.key(l)] || {}, py = sum(v.periods.map(function (p) { return (h[p.period_seq - 100] || 0) * s; })); (byCo[l.company] = byCo[l.company] || []).push({ l: l, py: Math.max(0, py) }); });
            Object.keys(byCo).forEach(function (co) {
                var list = byCo[co], tot = sum(list.map(function (x) { return x.py; })), share = 100 - (+tg.grossMargin);
                list.forEach(function (x) { x.l.rule = { method: 'pctof', of: 'type:R', pct: r2(share * (tot ? x.py / tot : 1 / list.length) * 10000) / 10000 }; });
            });
            P.compute(v, ctx);
        }
        return v;
    };

    // ── rolling forecast ──
    /** A forecast from a plan: actual months up to `through`, the rest by `rest` ('plan' keeps the plan's months, or a rule such as
        {method:'runrate', n:3}). Accounts with actuals that the plan lacks are added. */
    P.rolling = function (v, ctx, through, rest) {
        var f = JSON.parse(JSON.stringify(v)), have = {};
        f.id = P.uid('f'); f.kind = 'FORECAST'; f.status = 'DRAFT'; f.rev = 0; f.actualThrough = through; f.basedOn = v.id;
        f.name = (rest === 'plan' ? 'Forecast ' : 'Forecast (' + P.methodName(rest.method).toLowerCase() + ') ') + v.year + ' · actuals to ' + (v.periods.filter(function (p) { return p.period_seq === through; })[0] || {}).period_name;
        f.lines.forEach(function (l) {
            have[P.key(l)] = 1;
            if (rest !== 'plan') { l.rule = Object.assign({}, rest); l.adj = 1; } else { l.rule = { method: 'manual' }; }
        });
        var cos = f.companies && f.companies.length ? f.companies : null;
        Object.keys(ctx.hist || {}).forEach(function (k) {
            var p = k.split('|'), acc = ctx.accounts[p[2]]; if (!acc || (acc.account_type !== 'R' && acc.account_type !== 'E')) return;
            if (cos && cos.indexOf(p[0]) < 0) return;
            var kk = p[0] + '|' + (f.grain === 'cc' ? p[1] : '') + '|' + p[2]; if (have[kk]) return;
            var any = f.periods.some(function (q) { return q.period_seq <= through && Math.abs(ctx.hist[k][q.period_seq] || 0) >= 0.5; });
            if (any) { have[kk] = 1; f.lines.push({ company: p[0], cc: f.grain === 'cc' ? p[1] : '', account: p[2], m: f.periods.map(function () { return 0; }), rule: rest === 'plan' ? { method: 'zero' } : Object.assign({}, rest) }); }
        });
        return P.compute(f, ctx);
    };

    // ── plan vs actual ──
    /** Per line: plan, actual and variance for the months that have actuals (display sign, favourable +) */
    P.variance = function (v, ctx) {
        var la = ctx.lastActual || P.lastActual(ctx.hist || {}), idx = [];
        v.periods.forEach(function (p, i) { if (la && p.period_seq <= la) idx.push(i); });
        var rows = v.lines.map(function (l) {
            var acc = ctx.accounts[l.account] || {}, s = P.sign(acc), h = (ctx.hist || {})[P.key(l)] || {}, plan = 0, act = 0;
            idx.forEach(function (i) { plan += (l.m[i] || 0) * s; act += (h[v.periods[i].period_seq] || 0) * s; });
            var fav = acc.account_type === 'R' ? act - plan : plan - act;
            return { line: l, account: acc, plan: plan, actual: act, variance: fav, pct: plan ? fav / Math.abs(plan) * 100 : null };
        });
        return { months: idx.length, through: idx.length ? v.periods[idx[idx.length - 1]].period_seq : null, rows: rows };
    };

    // ── Excel / CSV round trip (display sign) ──
    P.SHEET_HEAD = ['Company', 'Cost centre', 'Account', 'Account name', 'Method'];
    P.toSheet = function (v, ctx) {
        var head = P.SHEET_HEAD.concat(v.periods.map(function (p) { return p.period_name; })).concat(['Total']);
        var rows = v.lines.map(function (l) {
            var a = ctx.accounts[l.account] || {}, s = P.sign(a), vals = l.m.map(function (x) { return r2(x * s); });
            return [l.company, l.cc || '', l.account, a.name || '', P.methodName((l.rule || {}).method)].concat(vals).concat([r2(sum(vals))]);
        });
        return { head: head, rows: rows };
    };
    /** Applies a filled sheet: lines found by company + cost centre + account; changed lines become 'Typed in'.
        Returns {changed, added, unknown: [text]} */
    P.fromSheet = function (v, ctx, head, rows) {
        var H = head.map(function (h) { return String(h == null ? '' : h).trim().toLowerCase(); }), col = function (n) { return H.indexOf(n.toLowerCase()); };
        var ic = col('Company'), icc = col('Cost centre'), ia = col('Account');
        if (ia < 0) return { error: 'The sheet needs an Account column.' };
        var pidx = v.periods.map(function (p) { return col(p.period_name); });
        if (pidx.every(function (x) { return x < 0; })) return { error: 'No month columns found (' + v.periods[0].period_name + ' …).' };
        var by = {}; v.lines.forEach(function (l) { by[P.key(l)] = l; });
        var res = { changed: 0, added: 0, unknown: [] };
        rows.forEach(function (r, ri) {
            var acct = String(r[ia] == null ? '' : r[ia]).trim(); if (!acct) return;
            var a = ctx.accounts[acct];
            if (!a) { res.unknown.push('row ' + (ri + 2) + ': account ' + acct + ' is not in the chart'); return; }
            var co = ic >= 0 ? String(r[ic] == null ? '' : r[ic]).trim() : (v.companies || [])[0] || '', cc = v.grain === 'cc' && icc >= 0 ? String(r[icc] == null ? '' : r[icc]).trim() : '';
            var key = co + '|' + cc + '|' + acct, l = by[key], s = P.sign(a);
            var m = pidx.map(function (x, i) { if (x < 0) return l ? l.m[i] : 0; var t = r[x], num = typeof t === 'number' ? t : parseFloat(String(t == null ? '' : t).replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1')); return isNaN(num) ? 0 : r2(num * s); });
            if (!l) { l = by[key] = { company: co, cc: cc, account: acct, m: m, rule: { method: 'manual' } }; v.lines.push(l); res.added++; return; }
            if (m.some(function (x, i) { return Math.abs(x - (l.m[i] || 0)) >= 0.005; })) { l.m = m; l.rule = { method: 'manual' }; l.adj = 1; res.changed++; }
        });
        return res;
    };

    // ── workflow ──
    P.STATUS = { DRAFT: 'Draft', SUBMITTED: 'Submitted', APPROVED: 'Approved', REJECTED: 'Sent back' };
    /** Whether `who` ({user, admin}) may do `act` (edit | submit | approve | reject | reopen) on the version */
    P.can = function (v, act, who) {
        who = who || {}; var st = v.status || 'DRAFT';
        if (act === 'edit') return st === 'DRAFT' || st === 'REJECTED';
        if (act === 'submit') return st === 'DRAFT' || st === 'REJECTED';
        if (act === 'approve' || act === 'reject') return st === 'SUBMITTED' && !!who.admin && (who.user || '') !== (v.submittedBy || '');
        if (act === 'reopen') return st === 'APPROVED' && !!who.admin;
        return false;
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = P; else root.FPLAN = P;
})(typeof window !== 'undefined' ? window : this);
