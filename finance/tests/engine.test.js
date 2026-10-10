/* node finance/tests/engine.test.js — the Finance Lens engine on a test fixture (finance/tests/fixture-gl.json: two
   companies, 24 months of generated balances; fixture-templates.js: statements on its account ranges) and on hand-made facts.
   The app itself only loads Oracle Fusion data. */
'use strict';
var assert = require('assert'), path = require('path'), fs = require('fs');
var FINE = require('../fin-engine.js');
global.window = global; global.FINE = FINE; require('../fin-seed.js');
var SEED = global.FIN_SEED, T = {}; require('./fixture-templates.js').forEach(function (t) { T[t.id] = t; });
var n = 0, fail = 0;
function test(name, fn) { n++; try { fn(); console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); } }
var near = function (a, b, tol, msg) { assert.ok(Math.abs(a - b) <= (tol || 0.01), (msg || '') + ' ' + a + ' vs ' + b); };

var raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-gl.json'), 'utf8'));
var data = { accounts: raw.accounts, periods: raw.periods, facts: FINE.factsFrom(raw.facts) };
var last = data.periods[data.periods.length - 1].period_seq;     // 202612

test('formula parser: precedence, functions, comparisons', function () {
    var v = function (s, env) { return FINE.evalAst(FINE.parse(s), function (k) { return (env || {})[k]; }); };
    assert.strictEqual(v('1 + 2 * 3'), 7); assert.strictEqual(v('(1 + 2) * 3'), 9); assert.strictEqual(v('-2 ^ 2'), 4);   // like Excel: negation first
    assert.strictEqual(v('2 ^ 3 ^ 2'), 512); assert.strictEqual(v('PCT(A, B)', { A: 25, B: 200 }), 12.5);
    assert.strictEqual(v('IF(A > B, 1, 2)', { A: 3, B: 2 }), 1); assert.strictEqual(v('DIV(1, 0)'), 0); assert.strictEqual(v('A / 0', { A: 1 }), 0);
    assert.strictEqual(v('MAX(1, 5, 3) - MIN(4, 2)'), 3); assert.strictEqual(v('PL.REV@YTD', { 'PL.REV@YTD': 9 }), 9);
    assert.throws(function () { FINE.parse('1 +'); }); assert.throws(function () { FINE.parse('FOO(1)'); }); assert.throws(function () { FINE.parse('1 $ 2'); });
});

test('account matching: ranges, wildcards, exclusions, attributes', function () {
    var acc = ['1000', '1100', '4000', '4010', '4100', '5000', '5200'].map(function (c) { return { code: c, account_type: c[0] === '4' ? 'R' : c[0] === '5' ? 'E' : 'A', class: c[0] === '4' ? 'Revenue' : 'x' }; });
    assert.deepStrictEqual(FINE.matchAccounts('4000-4099', acc), ['4000', '4010']);
    assert.deepStrictEqual(FINE.matchAccounts('4*, !4100', acc), ['4000', '4010']);
    assert.deepStrictEqual(FINE.matchAccounts('1000; 5200', acc), ['1000', '5200']);
    assert.deepStrictEqual(FINE.matchAccounts({ type: 'E' }, acc), ['5000', '5200']);
    assert.deepStrictEqual(FINE.matchAccounts({ class: 'Revenue' }, acc), ['4000', '4010', '4100']);
});

test('windows: MTD / QTD / YTD / LTM / PY / PYE / OPEN', function () {
    var pi = FINE.periodIndex(data.periods), at = function (c) { var w = FINE.windowOf(c, pi, 202608); return w && [pi.list[Math.max(0, w.from)].period_seq, pi.list[w.to].period_seq, w.end]; };
    assert.deepStrictEqual(at({ range: 'MTD' }).slice(0, 2), [202608, 202608]);
    assert.deepStrictEqual(at({ range: 'QTD' }).slice(0, 2), [202607, 202608]);
    assert.deepStrictEqual(at({ range: 'YTD' }).slice(0, 2), [202601, 202608]);
    assert.deepStrictEqual(at({ range: 'LTM' }).slice(0, 2), [202509, 202608]);
    assert.deepStrictEqual(at({ range: 'YTD', at: 'PY' }).slice(0, 2), [202501, 202508]);
    assert.strictEqual(pi.list[FINE.windowOf({ range: 'BAL', at: 'PYE' }, pi, 202608).end].period_seq, 202512);
    assert.strictEqual(FINE.windowOf({ range: 'MTD', at: 'PY' }, pi, 202503), null);
});

test('trial balance: every period and every scenario sums to zero', function () {
    data.periods.forEach(function (p) {
        var s = 0; Object.keys(data.facts.ACTUAL).forEach(function (a) { var x = data.facts.ACTUAL[a][p.period_seq]; if (x) s += x[1]; });
        near(s, 0, 0.05, p.period_name);
    });
});

test('income statement: margins, totals and variance signs', function () {
    var st = FINE.compute(T.PL, data, { period: last, scale: 1 });
    var row = function (id) { return st.rows.filter(function (r) { return r.id === id; })[0]; }, col = function (id) { return st.columns.map(function (c) { return c.id; }).indexOf(id); };
    var y = col('y_act');
    near(row('GP').values[y], row('REV').values[y] - row('COGS').values[y]);
    near(row('NP').values[y], row('PBT').values[y] - row('TAX').values[y]);
    near(row('GM').values[y], row('GP').values[y] / row('REV').values[y] * 100);
    assert.ok(row('REV').values[y] > 0, 'revenue shows positive');
    assert.ok(row('COGS').values[y] > 0, 'costs show positive');
    // net profit = −(sum of all income statement movements) over the year
    var np = 0; data.accounts.forEach(function (a) { if (FINE.isPl(a)) data.periods.forEach(function (p) { if (p.fiscal_year === 2026) { var x = (data.facts.ACTUAL[a.code] || {})[p.period_seq]; if (x) np -= x[0]; } }); });
    near(row('NP').values[y], np, 0.5);
    // a cost above budget is an unfavourable (negative) variance
    var v = col('y_var'), opex = row('OPEX');
    near(opex.values[v], -(opex.values[y] - opex.values[col('y_bud')]));
    assert.strictEqual(st.errors.length, 0, st.errors.join('; '));
});

test('balance sheet balances (check row) and holds the year-to-date profit', function () {
    data.periods.forEach(function (p) {
        var st = FINE.compute(T.BS, data, { period: p.period_seq, scale: 1 });
        var chk = st.rows.filter(function (r) { return r.id === 'CHK'; })[0];
        assert.ok(chk.ok, p.period_name + ' BS check ' + chk.raw);
    });
    var pl = FINE.compute(T.PL, data, { period: last, scale: 1, columns: [{ id: 'y', range: 'YTD' }] });
    var bs = FINE.compute(T.BS, data, { period: last, scale: 1 });
    near(bs.rows.filter(function (r) { return r.id === 'CYE'; })[0].values[0], pl.rows.filter(function (r) { return r.id === 'NP'; })[0].values[0], 0.5);
});

test('cash flow ties to the bank balance in every period and window', function () {
    data.periods.forEach(function (p) {
        var st = FINE.compute(T.CF, data, { period: p.period_seq, scale: 1 });
        var chk = st.rows.filter(function (r) { return r.id === 'CHK'; })[0];
        assert.ok(chk.ok, p.period_name + ' CF check ' + chk.raw.join(','));
    });
});

test('KPIs: values, references to other KPIs, budget windows, trend', function () {
    var k = FINE.kpis(SEED.config.kpis, T, data, last);
    Object.keys(k).forEach(function (id) { assert.ok(!k[id].error, id + ': ' + k[id].error); });
    near(k.ccc.value, k.dso.value + k.dio.value - k.dpo.value, 1e-6);
    assert.ok(k.gm.value > 30 && k.gm.value < 50, 'gross margin ' + k.gm.value);
    assert.ok(k.dso.value > 20 && k.dso.value < 80, 'dso ' + k.dso.value);
    assert.ok(k.cr.value > 0.5 && k.cr.value < 5, 'current ratio ' + k.cr.value);
    assert.ok(k.rev_bud.value > 80 && k.rev_bud.value < 110, 'revenue vs budget ' + k.rev_bud.value);
    near(k.susp.value, 237450, 0.01);
    var tr = FINE.kpiTrend([SEED.config.kpis[0]], T, data, last, 12);
    assert.strictEqual(tr.rev.length, 12);
});

test('monitors flag the planted problems', function () {
    var k = FINE.kpis(SEED.config.kpis, T, data, last), m = FINE.monitor(SEED.config.monitors, k);
    var s = {}; m.forEach(function (x) { s[x.rule.id] = x.status; });
    assert.strictEqual(s.m10, 'breach', 'suspense'); assert.strictEqual(s.m11, 'ok', 'balance sheet');
});

test('explain: the accounts behind a cell add up to it', function () {
    var opts = { period: last, scale: 1 }, st = FINE.compute(T.PL, data, opts);
    var opex = st.rows.filter(function (r) { return r.id === 'OPEX'; })[0], ix = st.columns.map(function (c) { return c.id; }).indexOf('y_act');
    var parts = FINE.explain(T.PL, data, opts, 'OPEX', 'y_act');
    near(parts.reduce(function (s, x) { return s + x.amount; }, 0), opex.values[ix], 0.5);
    assert.ok(parts.length > 5);
});

test('analytics: anomalies find the freight spike, movers, bridge, forecast, Benford, scenario', function () {
    var an = FINE.anomalies(data, 202608, { z: 3 });
    assert.ok(an.some(function (a) { return a.code === '6200'; }), 'freight spike: ' + an.map(function (a) { return a.code; }).join(','));
    var mv = FINE.movers(data, last, { range: 'YTD' }, { range: 'YTD', at: 'PY' }, FINE.isPl);
    assert.ok(mv.length > 5 && Math.abs(mv[0].diff) >= Math.abs(mv[1].diff));
    var st = FINE.compute(T.PL, data, { period: last, scale: 1 });
    var br = FINE.bridge(st, 'y_py', 'y_act', 'NP', 'NP', [{ id: 'REV' }, { id: 'COGS', sign: -1 }, { id: 'OPEX', sign: -1 }, { id: 'OI' }, { id: 'DA', sign: -1 }, { id: 'FIN', sign: -1 }, { id: 'TAX', sign: -1 }]);
    var sum = br.filter(function (b) { return b.kind !== 'end'; }).reduce(function (s, b) { return s + b.value; }, 0);
    near(sum, br[br.length - 1].value, 1, 'bridge closes');
    var y = []; for (var i = 0; i < 36; i++) y.push(100 + i * 2 + (i % 12 === 11 ? 30 : 0));
    var fc = FINE.forecast(y, 6); assert.strictEqual(fc.forecast.length, 6); assert.ok(fc.forecast[5] > 150, 'trend continues ' + fc.forecast[5]);
    var lin = FINE.forecast([1, 2, 3, 4], 2); near(lin.forecast[0], 5); near(lin.forecast[1], 6);
    var ben = []; for (var j = 1; j < 5000; j++) ben.push(Math.exp(j * 0.0137) * 13);
    assert.notStrictEqual(FINE.benford(ben).verdict, 'nonconformity');
    assert.strictEqual(FINE.benford([500000, 500000, 500000].concat(new Array(200).fill(500000))).verdict, 'nonconformity');
    var sc = FINE.scenario(data, { revenuePct: 10 }, 202601);
    var a = FINE.compute(T.PL, sc, { period: last, scale: 1, columns: [{ id: 'y', range: 'YTD', scenario: 'SCENARIO' }, { id: 'b', range: 'YTD' }] });
    var rev = a.rows.filter(function (r) { return r.id === 'REV'; })[0]; near(rev.values[0] / rev.values[1], 1.1, 1e-6);
});

test('narrative and formatting', function () {
    var st = FINE.compute(T.PL, data, { period: last, scale: 1 });
    var nar = FINE.narrative(st, 'y_act', 'y_bud', { keyRows: ['REV', 'NP'] });
    assert.ok(nar.length >= 3 && /Net revenue/.test(nar[0].text));
    assert.strictEqual(FINE.fmt(-1234.4), '(1,234)'); assert.strictEqual(FINE.fmt(12.345, 'pct'), '12.3%'); assert.strictEqual(FINE.fmt(0), '–');
});

test('templates: errors are reported, not thrown (unknown row, cycle)', function () {
    var t = { id: 'X', rows: [{ id: 'A', type: 'formula', formula: 'B + 1' }, { id: 'B', type: 'formula', formula: 'A + 1' }, { id: 'C', type: 'formula', formula: 'ZZZ' }, { id: 'D', type: 'formula', formula: '1 +' }] };
    var st = FINE.compute(t, data, { period: last });
    assert.ok(st.errors.some(function (e) { return /circular/.test(e); }));
    assert.ok(st.errors.some(function (e) { return /unknown row ZZZ/.test(e); }));
    assert.ok(st.errors.some(function (e) { return /^D:/.test(e); }));
});

test('Fusion charts: accounts classified by name, auto templates balance, tie and keep every KPI working', function () {
    // the sample chart as it would arrive from Fusion: no classes
    var accs = data.accounts.map(function (a) { return { code: a.code, name: a.name, account_type: a.account_type }; });
    accs.forEach(function (a) { a.class = FINE.classify(a); });
    var by = {}; accs.forEach(function (a) { by[a.code] = a.class; });
    assert.strictEqual(by['1000'], 'Cash'); assert.strictEqual(by['1150'], 'Receivables'); assert.strictEqual(by['1650'], 'Accumulated depreciation');
    assert.strictEqual(by['1800'], 'Intangibles'); assert.strictEqual(by['2400'], 'Tax liabilities'); assert.strictEqual(by['2700'], 'Long-term borrowings');
    assert.strictEqual(by['2600'], 'Borrowings'); assert.strictEqual(by['2800'], 'Leases'); assert.strictEqual(by['3100'], 'Retained earnings');
    assert.strictEqual(by['4200'], 'Other income'); assert.strictEqual(by['5100'], 'Cost of sales'); assert.strictEqual(by['6200'], 'Distribution');
    assert.strictEqual(by['6010'], 'Staff costs'); assert.strictEqual(by['6900'], 'Depreciation & amortisation'); assert.strictEqual(by['7200'], 'Finance costs');
    assert.strictEqual(by['8000'], 'Tax'); assert.strictEqual(by['9999'], 'Suspense'); assert.strictEqual(by['6800'], 'Selling');
    var tpls = FINE.autoTemplates(), AT = {}; tpls.forEach(function (t) { AT[t.id] = t; });
    var d2 = { accounts: accs, periods: data.periods, facts: data.facts };
    // every account is in exactly one line of the income statement or the balance sheet
    var lines = FINE.accountLines([AT.PL, AT.BS], accs);
    accs.forEach(function (a) {
        var own = lines[a.code].filter(function (l) { return !(l.tpl === 'BS' && l.row === 'CYE'); });
        assert.strictEqual(own.length, 1, a.code + ' ' + a.name + ' is in ' + own.length + ' lines');
    });
    d2.periods.forEach(function (p) {
        var bs = FINE.compute(AT.BS, d2, { period: p.period_seq, scale: 1 }), cf = FINE.compute(AT.CF, d2, { period: p.period_seq, scale: 1 });
        assert.ok(bs.rows.filter(function (r) { return r.id === 'CHK'; })[0].ok, p.period_name + ' BS');
        assert.ok(cf.rows.filter(function (r) { return r.id === 'CHK'; })[0].ok, p.period_name + ' CF ' + cf.rows.filter(function (r) { return r.id === 'CHK'; })[0].raw);
        assert.strictEqual(bs.errors.length + cf.errors.length, 0);
    });
    // same net profit as the hand-made starter, and the starter KPIs evaluate on the auto templates
    var np = function (t) { return FINE.compute(t, d2, { period: last, scale: 1, columns: [{ id: 'y', range: 'YTD' }] }).rows.filter(function (r) { return r.id === 'NP'; })[0].values[0]; };
    near(np(AT.PL), np(T.PL), 0.5, 'net profit');
    var k = FINE.kpis(SEED.config.kpis, AT, d2, last), k0 = FINE.kpis(SEED.config.kpis, T, data, last);
    Object.keys(k).forEach(function (id) { assert.ok(!k[id].error, id + ': ' + k[id].error); });
    near(k.gm.value, k0.gm.value, 0.3, 'gross margin'); near(k.np.value, k0.np.value, 1, 'np'); near(k.cash.value, k0.cash.value, 1, 'cash');
});

test('simple templates: default mapping from types + names, compile, KPIs, upload / download round trip', function () {
    var accs = raw.accounts.map(function (a) { return { code: a.code, name: a.name, account_type: a.account_type }; });
    accs.forEach(function (a) { a.class = FINE.classify(a); });
    var d2 = { accounts: accs, periods: data.periods, facts: data.facts };
    var PL = FINE.simpleTemplate({ id: 'PL', name: 'Income statement', simple: FINE.simpleDefault('PL', accs) });
    var BS = FINE.simpleTemplate({ id: 'BS', name: 'Balance sheet', simple: FINE.simpleDefault('BS', accs) });
    // every P&L account in exactly one section of PL, every balance sheet account in exactly one section of BS
    var cp = FINE.simpleCheck(PL.simple, accs), cb = FINE.simpleCheck(BS.simple, accs);
    assert.strictEqual(cp.unmapped.length + cp.twice.length + cb.unmapped.length + cb.twice.length, 0);
    assert.strictEqual(cp.mapped + cb.mapped, accs.length);
    // same net profit as the class-built statement; the balance sheet balances every month
    var AT = {}; FINE.autoTemplates().forEach(function (t) { AT[t.id] = t; });
    var val = function (t, id, cols) { var r = FINE.compute(t, d2, { period: last, scale: 1, columns: cols }).rows.filter(function (x) { return x.id === id; })[0]; return r.values[0]; };
    var Y = [{ id: 'y', range: 'YTD' }];
    near(val(PL, 'NP', Y), val(AT.PL, 'NP', Y), 0.5, 'np'); near(val(PL, 'REV', Y), val(AT.PL, 'REV', Y), 0.5, 'rev'); near(val(PL, 'GP', Y), val(AT.PL, 'GP', Y), 0.5, 'gp');
    near(val(BS, 'TA', [{ id: 'b', range: 'BAL' }]), val(AT.BS, 'TA', [{ id: 'b', range: 'BAL' }]), 0.5, 'total assets');
    data.periods.forEach(function (p) { var st = FINE.compute(BS, d2, { period: p.period_seq, scale: 1 }); assert.ok(st.rows.filter(function (r) { return r.id === 'CHK'; })[0].ok, p.period_name); assert.strictEqual(st.errors.length, 0); });
    var k = FINE.kpis(SEED.config.kpis, { PL: PL, BS: BS, CF: AT.CF, PLS: AT.PLS }, d2, last);
    Object.keys(k).forEach(function (id) { assert.ok(!k[id].error, id + ': ' + k[id].error); });
    // every column set computes
    ['PL', 'BS'].forEach(function (kind) { FINE.COLSETS[kind].forEach(function (c) { var t = JSON.parse(JSON.stringify(kind === 'PL' ? PL : BS)); t.colset = c.id; FINE.simpleTemplate(t); assert.strictEqual(FINE.compute(t, d2, { period: last, scale: 1 }).errors.length, 0, c.id); }); });
    // download → upload gives the same numbers
    var rows = FINE.simpleToRows(PL, accs).map(function (r) { return { Template: r.template, 'Main group': r.group, Nature: r.nature, Section: r.section, Account: r.account, 'Account name': r.name }; });
    var up = FINE.simpleFromRows(rows, accs);
    assert.strictEqual(up.templates.length, 1); assert.strictEqual(up.templates[0].simple.kind, 'PL');
    var U = FINE.simpleTemplate({ id: 'U', name: 'u', simple: up.templates[0].simple });
    var last2 = function (t) { var st = FINE.compute(t, d2, { period: last, scale: 1, columns: Y }); return st.rows.filter(function (r) { return r.type === 'formula' && !/_M$/.test(r.id); }).slice(-1)[0].values[0]; };
    near(last2(U), val(PL, 'NP', Y), 0.5, 'uploaded net profit');
    // a new account is placed next to accounts of its class; the type is guessed from the name when Fusion gave none
    assert.strictEqual(FINE.guessType({ code: '501100001', name: 'PL EXP - SALARIES AND WAGES' }), 'E');
    assert.strictEqual(FINE.guessType({ code: '101200004', name: 'PL- CREDIT & DEBIT TRANSFERS' }), 'E');
    assert.strictEqual(FINE.guessType({ code: '401000001', name: 'SALES - LOCAL' }), 'R');
    assert.strictEqual(FINE.guessType({ code: '210000001', name: 'TRADE PAYABLES' }), 'L');
    var nw = { code: '6011', name: 'Staff overtime', account_type: 'E' }; nw.class = FINE.classify(nw);
    var s2 = JSON.parse(JSON.stringify(PL.simple)); assert.strictEqual(FINE.simplePlace(s2, accs.concat([nw]), ['6011']), 1);
    assert.ok(s2.lines.filter(function (l) { return l.id === 'OPEX'; })[0].sections.filter(function (x) { return x.id === 'STAFF'; })[0].accounts.indexOf('6011') >= 0);
    assert.strictEqual(FINE.simpleId('Gross profit', {}), 'GROSS_PROFIT'); assert.strictEqual(FINE.simpleId('2025 sales', {}), 'L_2025_SALES'); assert.strictEqual(FINE.simpleId('Sum', {}), 'L_SUM');
});

test('KPI explain, missing data and company health', function () {
    var tm = {}; Object.keys(T).forEach(function (k) { tm[k] = T[k]; });
    var defs = SEED.config.kpis, gm = defs.filter(function (d) { return d.id === 'gm'; })[0];
    var ex = FINE.kpiExplain(gm, defs, tm, data, last), kv = FINE.kpis(defs, tm, data, last);
    near(ex.value, kv.gm.value, 0.001, 'explained value = KPI value');
    assert.strictEqual(ex.inputs.length, 2);
    ex.inputs.forEach(function (i) { assert.ok(i.from && i.to && i.months >= 1, i.ref); assert.ok((i.accounts && i.accounts.length) || (i.parts && i.parts.length), i.ref + ' accounts / parts'); });
    var sumAcc = ex.inputs[1].accounts.reduce(function (a, x) { return a + x.amount; }, 0);
    near(sumAcc, ex.inputs[1].value, 0.5, 'accounts add up to the input');
    assert.ok(/^PCT\(/.test(ex.substituted) && ex.substituted.indexOf('PL.') < 0, ex.substituted);
    // without a budget, budget KPIs say so instead of 0 %; before the first year, growth vs last year has no data
    var nob = { accounts: data.accounts, periods: data.periods, facts: { ACTUAL: data.facts.ACTUAL } };
    var k2 = FINE.kpis(defs, tm, nob, last);
    assert.strictEqual(k2.rev_bud.value, null); assert.ok(k2.rev_bud.nodata[0].indexOf('budget') >= 0);
    var first12 = data.periods[11].period_seq, k3 = FINE.kpis(defs, tm, data, first12);
    assert.strictEqual(k3.rev_g.value, null); assert.ok(/last year/.test(k3.rev_g.nodata[0]));
    var h = FINE.health(kv, defs);
    assert.ok(h.score > 0 && h.score <= 100 && /Healthy|Watch|At risk/.test(h.grade), h.grade + ' ' + h.score);
    assert.strictEqual(h.coverage, 100);
    var h2 = FINE.health(k2, defs);
    assert.ok(h2.coverage < 100 && h2.gaps.some(function (g) { return /budget/.test(g); }));
    assert.strictEqual(FINE.band(FINE.HEALTH.bands.cr, 1.6), 'good'); assert.strictEqual(FINE.band(FINE.HEALTH.bands.cr, 1.2), 'watch'); assert.strictEqual(FINE.band(FINE.HEALTH.bands.dso, 453), 'poor');
    assert.strictEqual(FINE.band(FINE.HEALTH.bands.nd_ebitda, -18.9), 'poor');
});

test('statement vs trial balance: missing accounts, suggested line, moving accounts', function () {
    var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
    // builder template: take one revenue account out → it is reported with a suggestion, adding it closes the gap
    var pl = { id: 'PLX', type: 'PL', simple: FINE.simpleDefault('PL', data.accounts) }; FINE.simpleTemplate(pl);
    assert.strictEqual(FINE.tbGaps(pl, data, last).length, 0, 'default PL maps every P&L account');
    var rev = data.accounts.filter(function (a) { return a.account_type === 'R'; })[0], from = null;
    pl.simple.lines.forEach(function (l) { (l.sections || []).forEach(function (x) { var i = (x.accounts || []).indexOf(rev.code); if (i >= 0) { x.accounts.splice(i, 1); from = l.sections.length === 1 ? l.id : x.id; } }); });
    FINE.simpleTemplate(pl);
    var g = FINE.tbGaps(pl, data, last);
    assert.strictEqual(g.length, 1); assert.strictEqual(g[0].code, rev.code); assert.ok(Math.abs(g[0].amount) > 0);
    assert.ok(g[0].suggest && g[0].suggest.id === from, JSON.stringify(g[0].suggest) + ' vs ' + from);
    assert.strictEqual(FINE.moveAccounts(pl, [rev.code], g[0].suggest.id, data.accounts), 1);
    assert.strictEqual(FINE.tbGaps(pl, data, last).length, 0);
    // move it to another line: in exactly one line afterwards
    var other = FINE.tplTargets(pl).filter(function (t) { return t.id !== from; })[0].id;
    FINE.moveAccounts(pl, [rev.code], other, data.accounts);
    var lines = FINE.accountLines([pl], data.accounts)[rev.code];
    assert.deepStrictEqual(lines.map(function (l) { return l.row; }), [other]);
    // range template: exclusions / plain codes
    var t = { id: 'R', type: 'PL', rows: [{ id: 'A', type: 'accounts', label: 'A', accounts: '4000-4099' }, { id: 'B', type: 'accounts', label: 'B', accounts: ['4100'] }, { id: 'C', type: 'accounts', label: 'C', accounts: { type: 'E' } }] };
    var acc = ['4000', '4010', '4100', '4200', '5000'].map(function (c) { return { code: c, account_type: c[0] === '4' ? 'R' : 'E' }; });
    FINE.moveAccounts(t, ['4010'], 'B', acc);
    assert.deepStrictEqual(FINE.matchAccounts(t.rows[0].accounts, acc), ['4000']); assert.deepStrictEqual(FINE.matchAccounts(t.rows[1].accounts, acc), ['4010', '4100']);
    FINE.moveAccounts(t, ['5000'], 'A', acc);
    assert.deepStrictEqual(FINE.matchAccounts(t.rows[2].accounts, acc), []); assert.deepStrictEqual(FINE.matchAccounts(t.rows[0].accounts, acc), ['4000', '5000']);
    FINE.moveAccounts(t, ['4010'], 'A', acc);
    assert.deepStrictEqual(FINE.matchAccounts(t.rows[0].accounts, acc), ['4000', '4010', '5000']); assert.deepStrictEqual(FINE.matchAccounts(t.rows[1].accounts, acc), ['4100']);
    var s2 = FINE.suggestLine(t, { code: '4200', account_type: 'R' }, acc);
    assert.ok(s2 && (s2.id === 'A' || s2.id === 'B'), JSON.stringify(s2));
    // a non-builder fixture template with one account removed
    var fx = clone(T[Object.keys(T).filter(function (k) { return FINE.tplKind(T[k]) === 'PL'; })[0]]);
    assert.strictEqual(FINE.tbGaps(fx, data, last).length, 0, 'fixture PL covers the chart');
});

test('cost allocation: step-down, drivers, GL driver, ABC stages, every rule nets to zero', function () {
    var AL = require('../fin-alloc-engine.js');
    var accs = ['4000', '6000', '6100'].map(function (c) { return { code: c, account_type: c[0] === '4' ? 'R' : 'E' }; });
    var rows = [
        { company: '01', account: '6000', type: 'E', dims: { cc: '900' }, amount: 1000 },
        { company: '01', account: '6100', type: 'E', dims: { cc: '800' }, amount: 300 },
        { company: '01', account: '6000', type: 'E', dims: { cc: '100' }, amount: 200 },
        { company: '01', account: '4000', type: 'R', dims: { cc: '100' }, amount: -3000 },
        { company: '01', account: '4000', type: 'R', dims: { cc: '200' }, amount: -1000 }];
    var model = { drivers: [{ id: 'hc', field: 'cc', values: { 100: 3, 200: 1, 800: 1 } }], virtual: [{ id: 'activity', values: ['Order', 'Ship'] }], rules: [
        { id: 'r1', name: 'HQ by headcount', pool: { where: { cc: ['900'] } }, to: { field: 'cc', method: 'driver', driver: 'hc' } },
        { id: 'r2', name: 'IT by revenue', pool: { where: { cc: ['800'] } }, to: { field: 'cc', method: 'gl', gl: { accounts: '4*' } } },
        { id: 'r3', name: 'cc 100 to activities', pool: { accounts: '6*', where: { cc: ['100'] } }, to: { field: 'activity', method: 'fixed', targets: [{ value: 'Order', pct: 60 }, { value: 'Ship', pct: 40 }] } },
        { id: 'r4', name: 'back to HQ (step-down blocks it)', pool: { where: { cc: ['200'] } }, to: { field: 'cc', method: 'even', targets: ['900'] } }]};
    var r = AL.run(model, rows, accs);
    assert.ok(r.ok);
    near(r.steps[0].targets['100'], 600); near(r.steps[0].targets['800'], 200);           // headcount 3 : 1 : 1
    near(r.steps[1].pool, 500); near(r.steps[1].targets['100'], 375); near(r.steps[1].targets['200'], 125);   // IT incl. its HQ share, by revenue 3 : 1
    near(r.steps[2].targets.Order, 0.6 * 1175); near(r.steps[2].targets.Ship, 0.4 * 1175);
    assert.strictEqual(r.steps[3].allocated, 0); assert.ok(r.steps[3].warn.length, 'HQ was emptied by rule 1, so it receives nothing');
    var total = r.work.reduce(function (a, x) { return a + x.amount; }, 0); near(total, -2500, 0.001, 'profit unchanged');
    var cc = {}; AL.summary(r, 'cc').forEach(function (o) { cc[o.value] = o; });
    near(cc['900'].loaded, 0); near(cc['800'].loaded, 0); near(cc['200'].after, 1000 - 325); near(cc['100'].after, 3000 - 1175);
    var j = AL.journal(r, ['cc', 'activity']), dr = 0, cr = 0; j.forEach(function (o) { dr += o.dr; cr += o.cr; }); near(dr, cr, 0.05, 'journal balances');
    // fixed shares are scaled when they do not add to 100; an empty driver leaves the pool unallocated with a warning
    var r2 = AL.run({ rules: [{ id: 'a', pool: { where: { cc: ['900'] } }, to: { field: 'cc', method: 'fixed', targets: [{ value: '100', pct: 30 }, { value: '200', pct: 10 }] } },
        { id: 'b', pool: { where: { cc: ['800'] } }, to: { field: 'cc', method: 'driver', driver: 'none' } }] }, rows, accs);
    near(r2.steps[0].targets['100'], 750); near(r2.steps[1].unallocated, 300); assert.ok(r2.warnings.length === 1);
    // to companies: travel of company 01 shared over 01 and 02 by their sales
    var rows3 = [{ company: '01', account: '6100', type: 'E', dims: {}, amount: 1000 }, { company: '01', account: '4000', type: 'R', dims: {}, amount: -3000 }, { company: '02', account: '4000', type: 'R', dims: {}, amount: -1000 }];
    var r3 = AL.run({ rules: [{ id: 't', pool: { accounts: ['6100'] }, to: { field: 'company', method: 'gl', gl: { accounts: { type: 'R' } } } }] }, rows3, accs);
    var co = {}; AL.summary(r3, 'company').forEach(function (o) { co[o.value] = o; });
    near(co['01'].loaded, 750); near(co['02'].loaded, 250); near(co['02'].after, 750);
});

test('IFRS pack: statements balance, cash flow ties to cash, equity ties, both presentations, overrides', function () {
    var IFRS = require('../fin-ifrs-engine.js');
    ['function', 'nature'].forEach(function (pres) {
        var p = IFRS.build(data, last, { presentation: pres, taxRate: 15, shares: 1000 });
        near(p.sfp.assets[0], p.sfp.eqLiab[0], 1, 'SFP balances now'); near(p.sfp.assets[1], p.sfp.eqLiab[1], 1, 'SFP balances at the comparative');
        near(p.cf.values.cur.diff, 0, 1, 'cash flow ties to the change in cash');
        near(p.cf.values.cur.close - p.cf.values.cur.open, p.cf.values.cur.net, 1);
        var blk = p.soce.blocks[p.soce.blocks.length - 1], close = blk.rows[blk.rows.length - 1].v[3];
        near(close, p.sfp.equity[0], 1, 'changes in equity close to the balance sheet equity');
        near(p.pl.values.cur.PFY, blk.rows[1].v[2], 1, 'profit in equity = profit in P&L');
        var tcheck = p.checks.filter(function (c) { return /balances at|ties to|close to/.test(c.label); });
        assert.ok(tcheck.length >= 3 && tcheck.every(function (c) { return c.ok; }), JSON.stringify(tcheck));
        near(p.notes.tax.expected, p.notes.tax.pbt * 0.15, 0.5);
    });
    // the same profit whichever presentation
    near(IFRS.build(data, last, { presentation: 'function' }).pl.values.cur.PFY, IFRS.build(data, last, { presentation: 'nature' }).pl.values.cur.PFY, 0.5);
    // moving a cash account to other current assets: still balances and still ties (the cash line shrinks, the movement shows in working capital)
    var cashAcc = data.accounts.filter(function (a) { return IFRS.defaultMap(a).sfp === 'CASH'; })[0];
    var q = IFRS.build(data, last, { map: { sfp: (function () { var o = {}; o[cashAcc.code] = 'OCA'; return o; })() } });
    near(q.sfp.assets[0], q.sfp.eqLiab[0], 1); near(q.cf.values.cur.diff, 0, 1);
    assert.ok(q.map[cashAcc.code].overridden);
    // OCI: an income account moved to OCI leaves profit, enters total comprehensive income and reserves; everything still ties
    var oi = data.accounts.filter(function (a) { return a.account_type === 'R'; })[0], over = { fn: {} }; over.fn[oi.code] = 'OCI_R';
    var r = IFRS.build(data, last, { map: over }), base = IFRS.build(data, last, {});
    near(r.pl.values.cur.TCI, base.pl.values.cur.TCI, 1); assert.ok(Math.abs(r.pl.values.cur.OCI) > 0);
    near(r.sfp.assets[0], r.sfp.eqLiab[0], 1); near(r.cf.values.cur.diff, 0, 1);
    var rb = r.soce.blocks[r.soce.blocks.length - 1]; near(rb.rows[rb.rows.length - 1].v[3], r.sfp.equity[0], 1);
});

test('planning: periods, seeding last year + %, rules, % of revenue, checks, goal seek, rolling forecast, sheet round trip, workflow', function () {
    var PL = require('../fin-plan-engine.js'), accts = {}; data.accounts.forEach(function (a) { accts[a.code] = a; });
    var hist = PL.histFrom(raw.facts.filter(function (r) { return r[0] === 'ACTUAL'; }).map(function (r) { return { company: 'C1', account: r[1], seq: r[2], net: r[3] }; }), 'account');
    var ctx = { accounts: accts, hist: hist };
    // a year that is not loaded: the latest full year moved forward (names too)
    var per = PL.periodsFor(2027, data.periods);
    assert.strictEqual(per.length, 12); assert.strictEqual(per[0].period_seq, 202701); assert.strictEqual(per[11].period_name, 'Dec-27');
    assert.strictEqual(PL.periodsFor(2026, data.periods)[0].period_seq, 202601);
    var v = { id: 'v1', name: 'Budget 2027', kind: 'BUDGET', year: 2027, grain: 'account', companies: ['C1'], periods: per, drivers: [], lines: [] };
    PL.seed(v, ctx, { method: 'py', pct: 10 });
    assert.ok(v.lines.length >= 20 && v.lines.every(function (l) { var a = accts[l.account]; return a.account_type === 'R' || a.account_type === 'E'; }));
    // last year + 10 %, month by month, in the natural sign (revenue stays a credit)
    var rev = v.lines.filter(function (l) { return l.account === '4000'; })[0];
    near(rev.m[2], hist['C1||4000'][202603] * 1.1, 0.02); assert.ok(rev.m[2] < 0);
    var t = PL.totals(v, ctx); near(t.sum.rev, t.sum.pyRev * 1.1, 1); near(t.sum.np, t.sum.pyNp * 1.1, 1);
    // facts: monthly nets and the year-to-date end balance
    var f = PL.facts(v, 'BUDGET'); near(f.BUDGET['4000'][202712][1], rev.m.reduce(function (a, b) { return a + b; }, 0), 0.05);
    // cost of sales as 60 % of revenue of the same company
    var cos = v.lines.filter(function (l) { return l.account === '5000'; })[0]; cos.rule = { method: 'pctof', of: 'type:R', pct: 60 }; PL.compute(v, ctx);
    near(cos.m[0], t.rev[0] * 0.6, 0.05);
    // other rules: annual spread, growth, driver, run-rate, trend, zero
    var x = v.lines.filter(function (l) { return l.account === '6000'; })[0];
    x.rule = { method: 'annual', amount: 1200, spread: 'even' }; PL.compute(v, ctx); near(x.m[5], 100, 0.001);
    x.rule = { method: 'annual', amount: 1200, spread: 'season' }; PL.compute(v, ctx); near(x.m.reduce(function (a, b) { return a + b; }, 0), 1200, 0.05);
    x.rule = { method: 'growth', start: 100, pct: 1 }; PL.compute(v, ctx); near(x.m[11], 100 * Math.pow(1.01, 11), 0.01);
    v.drivers.push({ id: 'hc', name: 'Headcount', values: [10, 10, 10, 11, 11, 11, 12, 12, 12, 12, 12, 12] });
    x.rule = { method: 'driver', driver: 'hc', rate: 2500 }; PL.compute(v, ctx); near(x.m[3], 27500, 0.001);
    x.rule = { method: 'runrate', n: 3 }; PL.compute(v, ctx); var h = hist['C1||6000']; near(x.m[0], (h[202610] + h[202611] + h[202612]) / 3, 0.02);
    x.rule = { method: 'trend' }; PL.compute(v, ctx); assert.ok(x.m.every(function (q) { return isFinite(q); }));
    x.rule = { method: 'zero' }; PL.compute(v, ctx); assert.ok(x.m.every(function (q) { return q === 0; }));
    // checks: the zeroed line with real actuals last year is flagged
    var chk = PL.checks(v, ctx); assert.ok(chk.some(function (c) { return /nothing planned/.test(c.text); }));
    // goal seek: operating costs move so that profit hits the target
    x.rule = { method: 'py', pct: 0 }; PL.compute(v, ctx);
    var target = PL.totals(v, ctx).sum.np + 50000, g = PL.goalSeek(v, ctx, target, 'opex');
    assert.ok(!g.error, g.error); near(PL.totals(v, ctx).sum.np, target, 1); assert.ok(g.factor < 1);
    // targets: revenue +5 %, gross margin 40 %
    PL.applyTargets(v, ctx, { revGrowth: 5, grossMargin: 40 }); var t2 = PL.totals(v, ctx);
    near(t2.sum.rev, t2.sum.pyRev * 1.05, 1); near(t2.sum.cos, t2.sum.rev * 0.6, Math.abs(t2.sum.rev) * 1e-6);
    // rolling forecast on the loaded year: months to June are the actuals
    var b26 = { id: 'b26', name: 'Budget 2026', year: 2026, grain: 'account', companies: ['C1'], periods: PL.periodsFor(2026, data.periods), drivers: [], lines: [] };
    PL.seed(b26, ctx, { method: 'py', pct: 0 });
    var fc = PL.rolling(b26, ctx, 202606, { method: 'runrate', n: 3 }), fr = fc.lines.filter(function (l) { return l.account === '4000'; })[0];
    near(fr.m[3], hist['C1||4000'][202604], 0.01); near(fr.m[8], (hist['C1||4000'][202604] + hist['C1||4000'][202605] + hist['C1||4000'][202606]) / 3, 0.05);
    assert.strictEqual(fc.kind, 'FORECAST');
    var va = PL.variance(b26, ctx); assert.strictEqual(va.months, 12); assert.ok(va.rows.length === b26.lines.length);
    // sheet round trip: change one month, read it back
    var sh = PL.toSheet(v, ctx), i0 = sh.head.indexOf(per[0].period_name), row = sh.rows.filter(function (r) { return r[2] === '4000'; })[0];
    row[i0] = 123456; var res = PL.fromSheet(v, ctx, sh.head, sh.rows); assert.ok(!res.error); assert.strictEqual(res.changed, 1);
    near(v.lines.filter(function (l) { return l.account === '4000'; })[0].m[0], -123456, 0.001);
    // refill: again and again until baselined — typed lines kept when asked, missing accounts added, nothing duplicated
    var r0 = v.lines.length, typedL = v.lines.filter(function (l) { return l.account === '4000'; })[0];
    var rf = PL.refill(v, ctx, { how: { method: 'py', pct: 2 }, keepTyped: true, addMissing: true });
    assert.strictEqual(v.lines.length, r0); assert.strictEqual(rf.added, 0); assert.ok(rf.kept >= 1); near(typedL.m[0], -123456, 0.001);
    v.lines = v.lines.filter(function (l) { return l.account !== '6100'; });
    rf = PL.refill(v, ctx, { how: { method: 'py', pct: 0 }, keepTyped: false, addMissing: true });
    assert.strictEqual(rf.added, 1); assert.strictEqual(v.lines.length, r0); near(typedL.m[0], hist['C1||4000'][202601], 0.02);
    rf = PL.refill(v, ctx, { how: { method: 'zero' }, only: function (l) { return l.account === '6000'; } });
    assert.strictEqual(rf.refilled, 1);
    // workflow: the person who submitted cannot approve
    var w = { status: 'SUBMITTED', submittedBy: 'ann' };
    assert.ok(!PL.can(w, 'approve', { user: 'ann', admin: true })); assert.ok(PL.can(w, 'approve', { user: 'bob', admin: true })); assert.ok(!PL.can(w, 'edit', {}));
    var d = { status: 'DRAFT', owner: 'ann' }; assert.ok(PL.can(d, 'refill', {})); assert.ok(PL.can(d, 'baseline', { user: 'ann' })); assert.ok(!PL.can(d, 'baseline', { user: 'bob' }));
    var bl = { status: 'BASELINED', owner: 'ann' }; assert.ok(!PL.can(bl, 'refill', { admin: true })); assert.ok(!PL.can(bl, 'edit', { admin: true })); assert.ok(PL.can(bl, 'reopen', { admin: true })); assert.ok(!PL.can(bl, 'reopen', { user: 'ann' }));
});

test('inter company: AR vs AP matching, FUN links, pair reconciliation, findings', function () {
    var FIC = require('../fin-ic-engine.js');
    var r = function (o) { return Object.assign({ currency: 'MUR', month: 202603 }, o); };
    var ar = [r({ doc_number: 'IC-1', from_co: '01', to_co: '02', amount: 1000, amount_entered: 1000 }), r({ doc_number: 'IC-2', from_co: '01', to_co: '02', amount: 500, amount_entered: 500 }),
        r({ doc_number: 'IC-3', from_co: '01', to_co: '03', amount: 300, amount_entered: 300 }), r({ doc_number: 'X9', from_co: '01', to_co: '02', amount: 77, amount_entered: 77 }),
        r({ doc_number: 'IC-5', from_co: '1', to_co: '2', amount: 250, amount_entered: 250 })];
    var ap = [r({ doc_number: 'ic 1', from_co: '01', to_co: '02', amount: 1000, amount_entered: 1000 }), r({ doc_number: 'IC-2', from_co: '01', to_co: '02', amount: 450, amount_entered: 450 }),
        r({ doc_number: 'ZZ', reference: 'IC-3', from_co: '01', to_co: '03', amount: 300, amount_entered: 300, month: 202604 }), r({ doc_number: 'NEW', from_co: '02', to_co: '01', amount: 90, amount_entered: 90 }),
        r({ doc_number: 'whatever', from_co: '01', to_co: '02', amount: 250, amount_entered: 250 })];
    var m = FIC.match(ar, ap, { month: 202603, tol: 1 }), st = {};
    m.rows.forEach(function (x) { st[(x.sell || x.buy).doc_number] = x.status; });
    assert.strictEqual(st['IC-1'], 'MATCHED'); assert.strictEqual(st['IC-2'], 'DIFF'); assert.strictEqual(st['IC-3'], 'TIMING');
    assert.strictEqual(st.X9, 'SELL_ONLY'); assert.strictEqual(st.NEW, 'BUY_ONLY'); assert.strictEqual(st['IC-5'], 'MATCHED');   // by amount, codes without zeros
    assert.strictEqual(m.rows.filter(function (x) { return x.status === 'DIFF'; })[0].diff, 50);
    assert.deepStrictEqual(m.counts, { MATCHED: 2, TIMING: 1, DIFF: 1, SELL_ONLY: 1, BUY_ONLY: 1 });
    var fl = FIC.funLinks([{ reference: 'IC-1', ref2: 'IC 1', amount: 1000 }, { reference: 'IC-9', ref2: null, amount: 5 }, { amount: 3 }], ar, ap);
    assert.deepStrictEqual(fl.map(function (x) { return x.status; }), ['COMPLETE', 'NOT_FOUND', 'GL_ONLY']);
    var rc = FIC.recon([{ company: '01', ic_company: '02', closing: 6300, currency: 'MUR' }, { company: '02', ic_company: '01', closing: -6000, currency: 'MUR' },
        { company: '01', ic_company: '03', closing: 300, currency: 'MUR' }, { company: '03', ic_company: '01', closing: -300, currency: 'EUR' },
        { company: '01', ic_company: '04', closing: 10, currency: 'MUR' }, { company: '01', ic_company: '000', closing: 99, currency: 'MUR' }], { tol: 1 });
    var ps = {}; rc.pairs.forEach(function (p) { ps[p.a + '-' + p.b] = p; });
    assert.strictEqual(ps['01-02'].status, 'DIFF'); assert.strictEqual(ps['01-02'].diff, 300); assert.strictEqual(ps['01-03'].status, 'CURRENCY');
    assert.strictEqual(ps['01-04'].status, 'ONE_SIDED'); assert.strictEqual(rc.noCounterparty['1'], 99);
    var mx = FIC.matrix(ar.concat(ap)); assert.strictEqual(mx.v['01']['02'], 1000 + 500 + 77 + 1000 + 450 + 250); assert.strictEqual(mx.v['1']['2'], 250);
    var fd = FIC.findings({ match: m, recon: rc, funLinks: fl, glNoParty: { n: 2, amount: 40 } });
    assert.strictEqual(fd[0].sev, 'bad'); assert.ok(fd.some(function (x) { return x.go === 'recon:DIFF'; })); assert.ok(fd.some(function (x) { return x.go === 'trx:GL'; }));
    assert.ok(FIC.isDefault('000') && FIC.isDefault('T') && !FIC.isDefault('02'));
});

test('paste mapping: parse, validate, create missing groups, apply, build a new template', function () {
    var acc = [['04000', 'Sales', 'R'], ['04010', 'Export sales', 'R'], ['05000', 'Cost of sales', 'E'], ['06000', 'Rent', 'E'], ['06100', 'Electricity', 'E'], ['01000', 'Cash', 'A']]
        .map(function (a) { return { code: a[0], name: a[1], account_type: a[2] }; });
    var tpl = { id: 'P', type: 'PL', rows: [{ id: 'REV', type: 'accounts', label: 'Revenue', accounts: '04000-04099' }, { id: 'COGS', type: 'accounts', label: 'Cost of sales', accounts: ['05000'] },
        { id: 'H_OPEX', type: 'header', label: 'Operating expenses' }, { id: 'RENT', type: 'accounts', label: 'Rent', accounts: ['06000', '06100'], parent: 'OPEX', level: 1 }, { id: 'OPEX', type: 'group', label: 'Total operating expenses' },
        { id: 'NP', type: 'formula', label: 'Net profit', formula: 'REV - COGS - OPEX' }] };
    // header row, tab separated, codes without leading zeros, a typo account, a conflict
    var p = FINE.pasteParse('Account\tGroup\n4000\tRevenue\n4010\tExport revenue\n6100\tUtilities\n6000\tRENT\n9999\tRent\n5000\tCost of Sales\n6100\tRent');
    assert.ok(p.header); assert.strictEqual(p.rows.length, 7);
    var v = FINE.pasteValidate(tpl, p, acc);
    assert.strictEqual(v.rows[0].code, '04000', 'leading zeros tolerated');
    assert.strictEqual(v.rows.filter(function (r) { return r.status === 'unknown'; })[0].account, '9999');
    assert.strictEqual(v.rows.filter(function (r) { return r.status === 'conflict'; }).length, 2, 'same account in two groups');
    var by = {}; v.groups.forEach(function (g) { by[g.key] = g; });
    assert.strictEqual(by.revenue.match.id, 'REV'); assert.strictEqual(by.rent.match.id, 'RENT'); assert.strictEqual(by['cost of sales'].match.id, 'COGS');
    assert.ok(!by['export revenue'].match && !by.utilities.match);
    assert.strictEqual(by.utilities.parent, 'OPEX', 'new group goes where its accounts sit now');
    assert.strictEqual(by.utilities.nature, 'expense'); assert.strictEqual(by['export revenue'].nature, 'income');
    var res = FINE.pasteApply(tpl, v, {}, acc);
    assert.strictEqual(res.created.length, 2);
    var lines = FINE.accountLines([tpl], acc), row = function (c) { return lines[c].map(function (l) { return l.row; }); };
    assert.deepStrictEqual(row('04010'), ['EXPORT_REVENUE']); assert.deepStrictEqual(row('04000'), ['REV']);
    assert.deepStrictEqual(row('06100'), ['UTILITIES'], 'first pasted group wins a conflict, taken out of Rent');
    var u = tpl.rows.filter(function (r) { return r.id === 'UTILITIES'; })[0];
    assert.strictEqual(u.parent, 'OPEX'); assert.ok(tpl.rows.indexOf(u) < tpl.rows.map(function (r) { return r.id; }).indexOf('OPEX'), 'inside the group, above its total');
    // a new main group of expenses sits after Operating expenses and joins Net profit like it
    var v5 = FINE.pasteValidate(tpl, FINE.pasteParse('6000\tOffice rent\tOverheads'), acc);
    var r5 = FINE.pasteApply(tpl, v5, {}, acc);
    var ids = tpl.rows.map(function (r) { return r.id; });
    assert.strictEqual(ids.indexOf('H_OVERHEADS'), ids.indexOf('OPEX') + 1, ids.join(' '));
    assert.strictEqual(tpl.rows.filter(function (r) { return r.id === 'NP'; })[0].formula, 'REV + EXPORT_REVENUE - COGS - OPEX - OVERHEADS', 'new lines join the totals with the sign of their sibling');
    assert.deepStrictEqual(r5.unlinked, []);
    // builder template: a new main group from the third column
    var b = { id: 'B', type: 'PL', simple: FINE.simpleDefault('PL', acc) }; FINE.simpleTemplate(b);
    var v2 = FINE.pasteValidate(b, FINE.pasteParse('6100,Power,Utilities & energy\n6000,Premises,Utilities & energy'), acc);
    FINE.pasteApply(b, v2, {}, acc);
    var l2 = FINE.accountLines([b], acc);
    assert.strictEqual(l2['06100'].length, 1); assert.strictEqual(l2['06000'].length, 1);
    assert.ok(b.simple.lines.some(function (l) { return l.name === 'Utilities & energy' && l.sections.length === 2; }), 'new main group with two sections');
    // map to an existing line by hand + exact
    var v3 = FINE.pasteValidate(tpl, FINE.pasteParse('4010\tTurnover'), acc);
    FINE.pasteApply(tpl, v3, { turnover: { action: 'map', to: 'REV' } }, acc, { exact: true });
    assert.deepStrictEqual(FINE.matchAccounts(tpl.rows[0].accounts, acc), ['04010'], 'exact: the line keeps only the pasted accounts');
    // build a whole balance sheet from account + group
    var v4 = FINE.pasteValidate({ type: 'BS', rows: [] }, FINE.pasteParse('1000\tCash at bank\n4000\tRetained\n'), [acc[5], { code: '03000', name: 'Retained earnings', account_type: 'O' }].concat([{ code: '4000', name: 'x', account_type: 'O' }]), acc);
    var built = FINE.pasteBuild(v4, 'My BS', [acc[5], { code: '4000', name: 'x', account_type: 'O' }]);
    assert.strictEqual(built.tpl.type, 'BS'); assert.ok(built.tpl.rows.some(function (r) { return r.type === 'check'; }));
});

test('structure: main groups suggested, totals added, balance sheet lines split out, duplicates resolved', function () {
    var A = function (c, n, t, k) { return { code: c, name: n, account_type: t, class: k }; };
    var acc = [A('400', 'Sales', 'R', 'Revenue'), A('410', 'Interest income', 'R', 'Other income'), A('500', 'Cost of goods sold', 'E', 'Cost of sales'), A('600', 'Salaries', 'E', 'Staff costs'),
        A('650', 'Bank interest', 'E', 'Finance costs'), A('690', 'Income tax', 'E', 'Tax'), A('100', 'Plant', 'A', 'Fixed assets'), A('120', 'Debtors', 'A', 'Receivables'),
        A('130', 'Bank', 'A', 'Cash'), A('300', 'Share capital', 'O', 'Share capital'), A('210', 'Long term loan', 'L', 'Long-term borrowings'), A('200', 'Creditors', 'L', 'Payables')];
    var L = function (id, label, a) { return { id: id, type: 'accounts', label: label, accounts: a }; };
    // a flat "income statement" holding balance sheet lines too (as loaded from a paste), 600 in two lines
    var t = { id: 'G', name: 'Income statement — grays', type: 'PL', columns: [{ id: 'y', range: 'YTD' }], rows: [L('REVENUE', 'Revenue', ['400']), L('OTHER', 'Other income', ['410']), L('COS', 'Cost of sales', ['500']),
        L('STAFF', 'Staff', ['600']), L('ADMIN', 'Admin', ['600']), L('INT', 'Interest', ['650']), L('TAXL', 'Tax', ['690']), L('PPE', 'PLANT AND EQUIPMENT', ['100']), L('TR', 'TRADE RECEIVABLES', ['120']),
        L('CASH', 'CASH AND CASH EQUIVALENTS', ['130']), L('SC', 'STATED CAPITAL', ['300']), L('LTB', 'LONG TERM BORROWINGS', ['210']), L('TP', 'TRADE AND OTHER PAYABLES', ['200'])] };
    var sg = FINE.structureSuggest(t, acc), m = {}; sg.lines.forEach(function (l) { m[l.id] = l.main + '/' + l.kind; });
    assert.deepStrictEqual(m, { REVENUE: 'REV/PL', OTHER: 'OI/PL', COS: 'COGS/PL', STAFF: 'OPEX/PL', ADMIN: 'OPEX/PL', INT: 'FIN/PL', TAXL: 'TAX/PL', PPE: 'NCA/BS', TR: 'CA/BS', CASH: 'CA/BS', SC: 'EQ/BS', LTB: 'NCL/BS', TP: 'CL/BS' });
    assert.deepStrictEqual(sg.dup.map(function (d) { return d.code + ':' + d.rows.join('|'); }), ['600:STAFF|ADMIN']);
    assert.ok(!sg.hasCalc);
    var res = FINE.structureApply(t, sg, { split: true, keep: { 600: 'STAFF' } }, acc);
    var f = {}; t.rows.forEach(function (r) { if (r.type === 'formula') f[r.id] = r.formula; });
    assert.deepStrictEqual(f, { GP: 'REV - COGS', GP_M: 'PCT(GP, REV)', EBIT: 'GP + OI - OPEX', EBIT_M: 'PCT(EBIT, REV)', PBT: 'EBIT - FIN', NP: 'PBT - TAX', NP_M: 'PCT(NP, REV)' });
    assert.deepStrictEqual(FINE.accountLines([t], acc)['600'].map(function (x) { return x.row; }), ['STAFF'], 'the account stays in the chosen line only');
    assert.strictEqual(t.rows.filter(function (r) { return r.id === 'STAFF'; })[0].parent, 'OPEX');
    var bs = res.other; assert.strictEqual(bs.type, 'BS');
    var bf = {}; bs.rows.forEach(function (r) { if (r.type === 'formula' || r.type === 'check') bf[r.id] = r.formula; });
    assert.deepStrictEqual(bf, { TA: 'NCA + CA', TL: 'NCL + CL', TEL: 'EQ + TL', CHK: 'TA - TEL' });
    assert.ok(bs.rows.some(function (r) { return r.label === 'Profit for the year' && r.parent === 'EQ'; }), 'equity carries the profit for the year');
    // the result balances on real numbers: every account has a balance; assets = equity + liabilities + profit
    var data = { accounts: acc, periods: [{ period_seq: 202601, period_name: 'Jan-26', year: 2026, num: 1 }], facts: { ACTUAL: {} } };
    var bal = { 400: -1000, 410: -50, 500: 600, 600: 200, 650: 30, 690: 40, 100: 800, 120: 300, 130: 120, 300: -500, 210: -300, 200: -240 };
    Object.keys(bal).forEach(function (c) { data.facts.ACTUAL[c] = { 202601: [bal[c], bal[c]] }; });
    var st = FINE.compute(bs, data, { period: 202601, columns: [{ id: 'b', range: 'BAL' }] }), chk = st.rows.filter(function (r) { return r.type === 'check'; })[0];
    assert.ok(Math.abs(chk.values[0]) < 0.01, 'balance sheet checks to nil: ' + chk.values[0]);
    var pl = FINE.compute(t, data, { period: 202601, columns: [{ id: 'y', range: 'YTD' }] }), np = pl.rows.filter(function (r) { return r.id === 'NP'; })[0];
    assert.strictEqual(np.values[0], 180, 'net profit = 1050 − 600 − 200 − 30 − 40');
    // a pasted custom main group joins the totals like its anchor
    var t2 = { type: 'PL', rows: [L('S', 'Sales', ['400']), { id: 'H_OVH', type: 'header', label: 'Overheads' }, Object.assign(L('R', 'Rent', ['600']), { parent: 'OVH' }), { id: 'OVH', type: 'group', label: 'Total overheads' }] };
    var s2 = FINE.structureSuggest(t2, acc); FINE.structureApply(t2, s2, {}, acc);
    assert.strictEqual(t2.rows.filter(function (r) { return r.id === 'EBIT'; })[0].formula, 'REV - OVERHEADS');
});

test('paste mapping: a main group column puts existing lines under it', function () {
    var acc = [{ code: '100', name: 'Plant', account_type: 'A' }, { code: '110', name: 'Software', account_type: 'A' }, { code: '120', name: 'Debtors', account_type: 'A' }];
    var t = { type: 'BS', rows: [{ id: 'PPE', type: 'accounts', label: 'Plant and equipment', accounts: ['100'] }, { id: 'INT', type: 'accounts', label: 'Intangible assets', accounts: ['110'] }, { id: 'TR', type: 'accounts', label: 'Trade receivables', accounts: ['120'] }] };
    var v = FINE.pasteValidate(t, FINE.pasteParse('Account\tGroup\tMain group\n100\tPlant and equipment\tNon-current assets\n110\tIntangible assets\tNon-current assets\n120\tTrade receivables\tCurrent assets'), acc);
    var r = FINE.pasteApply(t, v, {}, acc);
    assert.deepStrictEqual(r.regrouped, ['PPE', 'INT', 'TR']);
    assert.deepStrictEqual(t.rows.map(function (x) { return x.id + (x.parent ? '<' + x.parent : ''); }), ['H_NON_CURRENT_ASSETS', 'PPE<NON_CURRENT_ASSETS', 'INT<NON_CURRENT_ASSETS', 'NON_CURRENT_ASSETS', 'H_CURRENT_ASSETS', 'TR<CURRENT_ASSETS', 'CURRENT_ASSETS']);
    // then main groups & totals: the pasted mains are kept and added up
    var sg = FINE.structureSuggest(t, acc); FINE.structureApply(t, sg, {}, acc);
    assert.deepStrictEqual(sg.lines.map(function (l) { return l.main; }), ['NCA', 'NCA', 'CA'], 'standard names are recognised');
    assert.strictEqual(t.rows.filter(function (x) { return x.id === 'TA'; })[0].formula, 'NCA + CA');
});

test('drill: the months behind a QTD / YTD / full-year cell add up to it', function () {
    var pl = FINE.autoTemplates()[0], rev = pl.rows.filter(function (r) { return r.type === 'accounts'; })[0], np = pl.rows.filter(function (r) { return r.type === 'formula'; }).slice(-1)[0];
    [{ id: 'q', range: 'QTD' }, { id: 'y', range: 'YTD' }, { id: 'f', range: 'FY', at: 'PY' }].forEach(function (c) {
        [rev, np].forEach(function (row) {
            var m = FINE.explainMonths(pl, data, { period: last, columns: [c] }, row.id, c.id);
            assert.ok(m.months.length >= 1, c.range);
            if (row.format && row.format !== 'num') return;
            assert.ok(Math.abs(m.sum - m.total) < 0.01, row.id + ' ' + c.range + ': months ' + m.sum + ' vs cell ' + m.total);
        });
    });
    var y = FINE.explainMonths(pl, data, { period: last, columns: [{ id: 'y', range: 'YTD' }] }, rev.id, 'y');
    var accSum = y.accounts.reduce(function (s, a) { return s + a.total; }, 0);
    assert.ok(Math.abs(accSum - y.total) < 0.01, 'accounts × months add up to the cell');
    y.months.forEach(function (m, k) {   // YTD column = the year-to-date of each month, i.e. the running total from the year start
        assert.ok(Math.abs(m.ytd - m.cum) < 0.01, 'YTD at ' + m.name + ' ' + m.ytd + ' vs running ' + m.cum);
        if (k === y.months.length - 1) assert.ok(Math.abs(m.ytd - y.total) < 0.01, 'last month YTD = the cell');
    });
    var fy = FINE.explainMonths(pl, data, { period: last, columns: [{ id: 'f', range: 'FY', at: 'PY' }] }, rev.id, 'f');
    assert.strictEqual(fy.months.length, 12, 'last full year = 12 months');
});

test('YTD of income statement lines comes from the period balance, not from adding up months', function () {
    // last year synced only from Jun-25: Jun-25's balance already holds Jan–Jun (opening 500 + PTD 100); this year Jan–Aug
    var per = function (y, m) { return { period_seq: y * 100 + m, period_name: m + '-' + y, fiscal_year: y, period_num: m, quarter: Math.ceil(m / 3) }; };
    var periods = [6, 7, 8].map(function (m) { return per(2025, m); }).concat([1, 2, 3, 4, 5, 6, 7, 8].map(function (m) { return per(2026, m); }));
    var raw = [['ACTUAL', '4000', 202506, -100, -600], ['ACTUAL', '4000', 202507, -100, -700], ['ACTUAL', '4000', 202508, -100, -800]];
    [1, 2, 3, 4, 5, 6, 7, 8].forEach(function (m) { raw.push(['ACTUAL', '4000', 202600 + m, -10, -10 * m]); });
    var d = { accounts: [{ code: '4000', name: 'Sales', account_type: 'R' }], periods: periods, facts: FINE.factsFrom(raw) };
    var tpl = { id: 'T', rows: [{ id: 'REV', type: 'accounts', accounts: '4000', sign: 'credit' }] };
    var v = function (col, p) { return FINE.compute(tpl, d, { period: p, scale: 1, columns: [col] }).rows[0].values[0]; };
    near(v({ id: 'y', range: 'YTD' }, 202608), 80, 1e-9, 'YTD Aug-26');
    near(v({ id: 'y', range: 'YTD', at: 'PY' }, 202608), 800, 1e-9, 'YTD Aug-25 from its balance, Jan–May-25 not synced');
    near(v({ id: 'm', range: 'MTD' }, 202608), 10, 1e-9, 'PTD');
    var m = FINE.explainMonths(tpl, d, { period: 202608, columns: [{ id: 'y', range: 'YTD' }] }, 'REV', 'y');
    near(m.months[5].pyYtd, 600, 1e-9, 'Jun-26 row: YTD last year = Jun-25 balance');
    near(m.months[7].ytd, 80, 1e-9, 'Aug-26 row: YTD');
});

test('labels: sentence / title case keep acronyms; standard styles', function () {
    var c = FINE.labelCase;
    assert.strictEqual(c('SALARIES AND WAGES', 'sentence'), 'Salaries and wages');
    assert.strictEqual(c('TRADE AND OTHER RECEIVABLES', 'title'), 'Trade and Other Receivables');
    assert.strictEqual(c('VAT PAYABLE', 'sentence'), 'VAT payable');
    assert.strictEqual(c('PROPERTY, PLANT AND EQUIPMENT (PPE)', 'sentence'), 'Property, plant and equipment (PPE)');
    assert.strictEqual(c('OTHER COST OF SALES (INC FOREX)', 'sentence'), 'Other cost of sales (inc forex)');
    assert.strictEqual(c('Bond to duty paid - ADD CHARGES(ICD IED LOC)', 'sentence'), 'Bond to duty paid - add charges(ICD IED LOC)');
    assert.strictEqual(c('ifrs 16 leases', 'sentence'), 'IFRS 16 leases');
    assert.strictEqual(c('eBay sales', 'sentence'), 'eBay sales');
    assert.strictEqual(c('Expenses', 'upper'), 'EXPENSES');
    var t = { type: 'PL', rows: [{ id: 'H_O', type: 'header', label: 'OPERATING EXPENSES' }, { id: 'S', type: 'accounts', label: 'STAFF WELFARE', parent: 'O', style: { bold: true } }, { id: 'O', type: 'group', label: 'Total operating expenses' },
        { id: 'NP', type: 'formula', label: 'NET PROFIT', formula: '-O' }, { id: 'NPM', type: 'formula', label: 'Net profit margin', formula: 'NP', format: 'pct' }] };
    var ch = FINE.standardize(t);
    assert.deepStrictEqual(ch.map(function (x) { return x.to; }), ['Operating expenses', 'Staff welfare', 'Net profit']);
    assert.deepStrictEqual(t.rows.map(function (r) { return JSON.stringify(r.style || {}); }), ['{"bold":true}', '{}', '{"bold":true,"topBorder":true}', '{"bold":true,"topBorder":true,"doubleBottom":true}', '{"italic":true}']);
    assert.strictEqual(t.rows[1].level, 1);
});

console.log('\n' + (n - fail) + '/' + n + ' passed');
process.exit(fail ? 1 : 0);
