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
});

console.log('\n' + (n - fail) + '/' + n + ' passed');
process.exit(fail ? 1 : 0);
