/* Finance Lens — Inter company engine (pure, no DOM; node-tested in finance/tests/engine.test.js).
   Works on the rows the Inter company page reads from DuckDB (rr_ic_v, rr_ic_bal_v):
     match()    receivables of the seller (AR) against payables of the buyer (AP): same pair of companies, then the document
                number / reference, else the amount — MATCHED, TIMING (counterpart in another month), DIFF (amounts differ),
                SELL_ONLY (no payable yet), BUY_ONLY (no receivable)
     funLinks() Intercompany module transactions against the AR / AP invoices they should have created
     recon()    GL balances of each pair of companies: A's balance with B + B's balance with A should net to nil
     matrix()   from × to totals for a heat table
     findings() plain-words list of what needs attention, worst first
   Amounts: from = the seller / provider / sender, to = the buyer / receiver; a receivable and its payable carry the same sign. */
(function (root) {
    'use strict';
    var FIC = {};
    /** "01" and "1" are the same company (codes may have lost their leading zeros) */
    FIC.ck = function (v) { v = String(v == null ? '' : v).trim(); return /^[0-9]+$/.test(v) ? (v.replace(/^0+/, '') || '0') : v.toUpperCase(); };
    /** A document number reduced to letters and digits (IC-AR 0001 = icar0001) */
    FIC.dk = function (v) { return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    /** The intercompany segment's "no counterparty" values: empty, all zeros, T, NONE … */
    FIC.isDefault = function (v) { var s = String(v == null ? '' : v).trim().toUpperCase(); return !s || /^0+$/.test(s) || ['T', 'NONE', 'NA', 'N/A', 'DEFAULT', '-'].indexOf(s) >= 0; };
    FIC.pair = function (a, b) { return FIC.ck(a) + '>' + FIC.ck(b); };
    var num = function (v) { var n = +v; return isFinite(n) ? n : 0; };
    var amt = function (r, other) { return r.currency && other && other.currency && r.currency === other.currency && r.amount_entered != null ? num(r.amount_entered) : num(r.amount != null ? r.amount : r.amount_entered); };
    var round2 = function (v) { return Math.round(v * 100) / 100; };

    /** sell = AR rows, buy = AP rows (any months — the counterpart may sit in the month before / after);
        opts = {tol (default 1), month (yyyymm: only rows of this month are reported; counterparts may be ±window), window (months, default 1)} */
    FIC.match = function (sell, buy, opts) {
        opts = opts || {}; var tol = opts.tol == null ? 1 : +opts.tol, m = opts.month ? +opts.month : null, w = opts.window == null ? 1 : +opts.window;
        var mi = function (x) { x = +x; return Math.floor(x / 100) * 12 + (x % 100); };
        var near = function (r) { return !m || Math.abs(mi(r.month) - mi(m)) <= w; };
        var inMonth = function (r) { return !m || +r.month === m; };
        var used = {}, byKey = {}, byPair = {};
        buy.forEach(function (b, i) {
            if (!near(b)) return;
            var p = FIC.pair(b.from_co, b.to_co);
            [b.doc_number, b.reference].forEach(function (d) { var k = FIC.dk(d); if (k) (byKey[p + '|' + k] = byKey[p + '|' + k] || []).push(i); });
            (byPair[p] = byPair[p] || []).push(i);
        });
        var out = [];
        sell.forEach(function (s) {
            if (!inMonth(s) && !(m && near(s))) return;
            var p = FIC.pair(s.from_co, s.to_co), hit = -1, how = '';
            [s.doc_number, s.reference].some(function (d) {
                var k = FIC.dk(d), c = k && byKey[p + '|' + k]; if (!c) return false;
                var f = c.filter(function (i) { return !used[i]; })[0]; if (f == null) return false; hit = f; how = 'document'; return true;
            });
            if (hit < 0) (byPair[p] || []).some(function (i) {
                if (used[i]) return false; var b = buy[i];
                if (Math.abs(amt(s, b) - amt(b, s)) <= tol) { hit = i; how = 'amount'; return true; } return false;
            });
            if (hit >= 0) {
                used[hit] = 1; var b = buy[hit], diff = round2(amt(s, b) - amt(b, s));
                if (!inMonth(s) && !inMonth(b)) return;
                var st = Math.abs(diff) > tol ? 'DIFF' : (+s.month !== +b.month ? 'TIMING' : 'MATCHED');
                out.push({ status: st, sell: s, buy: b, diff: diff, how: how, pair: p, amount: amt(s, b) });
            } else if (inMonth(s)) out.push({ status: 'SELL_ONLY', sell: s, buy: null, diff: round2(amt(s)), how: '', pair: p, amount: amt(s) });
        });
        buy.forEach(function (b, i) { if (!used[i] && inMonth(b)) out.push({ status: 'BUY_ONLY', sell: null, buy: b, diff: round2(-amt(b)), how: '', pair: FIC.pair(b.from_co, b.to_co), amount: amt(b) }); });
        var counts = { MATCHED: 0, TIMING: 0, DIFF: 0, SELL_ONLY: 0, BUY_ONLY: 0 }, totals = { MATCHED: 0, TIMING: 0, DIFF: 0, SELL_ONLY: 0, BUY_ONLY: 0 };
        out.forEach(function (r) { counts[r.status]++; totals[r.status] = round2(totals[r.status] + (r.status === 'DIFF' ? Math.abs(r.diff) : Math.abs(r.amount))); });
        return { rows: out, counts: counts, totals: totals, rate: out.length ? (counts.MATCHED + counts.TIMING) / out.length : 1 };
    };

    /** FUN transactions → the AR invoice (reference) and AP invoice (ref2) they should have produced */
    FIC.funLinks = function (fun, ar, ap) {
        var arK = {}, apK = {};
        ar.forEach(function (r) { arK[FIC.dk(r.doc_number)] = r; });
        ap.forEach(function (r) { apK[FIC.dk(r.doc_number)] = r; });
        return fun.map(function (f) {
            var a = f.reference ? arK[FIC.dk(f.reference)] : null, p = f.ref2 ? apK[FIC.dk(f.ref2)] : null;
            var st = !f.reference && !f.ref2 ? 'GL_ONLY' : a && p ? 'COMPLETE' : a ? 'NO_AP' : p ? 'NO_AR' : 'NOT_FOUND';
            return { status: st, fun: f, ar: a, ap: p };
        });
    };

    /** bal rows {company, ic_company, closing, currency}: one row per unordered pair; tol = allowed difference */
    FIC.recon = function (bal, opts) {
        opts = opts || {}; var tol = opts.tol == null ? 1 : +opts.tol;
        var cell = {}, cur = {}, none = {}, names = {};
        bal.forEach(function (r) {
            var a = FIC.ck(r.company), b = r.ic_company;
            names[a] = names[a] || r.company;
            if (FIC.isDefault(b)) { none[a] = round2((none[a] || 0) + num(r.closing)); return; }
            b = FIC.ck(b); names[b] = names[b] || r.ic_company;
            if (a === b) return;
            var k = a + '>' + b; cell[k] = round2((cell[k] || 0) + num(r.closing)); (cur[k] = cur[k] || {})[r.currency || '?'] = 1;
        });
        var seen = {}, out = [];
        Object.keys(cell).forEach(function (k) {
            var p = k.split('>'), a = p[0], b = p[1], u = a < b ? a + '|' + b : b + '|' + a; if (seen[u]) return; seen[u] = 1;
            var x = a < b ? a : b, y = a < b ? b : a, xy = cell[x + '>' + y], yx = cell[y + '>' + x];
            var curs = Object.keys(Object.assign({}, cur[x + '>' + y] || {}, cur[y + '>' + x] || {}));
            var diff = round2((xy || 0) + (yx || 0));
            var st = xy == null || yx == null ? 'ONE_SIDED' : curs.length > 1 ? 'CURRENCY' : Math.abs(diff) <= tol ? 'OK' : 'DIFF';
            out.push({ a: names[x], b: names[y], ab: xy == null ? null : xy, ba: yx == null ? null : yx, diff: diff, status: st, currencies: curs });
        });
        out.sort(function (p, q) { return Math.abs(q.diff) - Math.abs(p.diff); });
        var counts = { OK: 0, DIFF: 0, ONE_SIDED: 0, CURRENCY: 0 }; out.forEach(function (r) { counts[r.status]++; });
        return { pairs: out, counts: counts, noCounterparty: none, outOfBalance: round2(out.filter(function (r) { return r.status !== 'OK'; }).reduce(function (s, r) { return s + Math.abs(r.diff); }, 0)) };
    };

    /** from × to sums: {cos: [codes], v: {from: {to: value}}, rowTotal, colTotal} */
    FIC.matrix = function (rows, val) {
        val = val || function (r) { return num(r.amount); };
        var v = {}, cos = {}, rt = {}, ct = {};
        rows.forEach(function (r) {
            var a = r.from_co, b = r.to_co; if (a == null || b == null || a === b) return;
            cos[a] = 1; cos[b] = 1; v[a] = v[a] || {}; var x = val(r);
            v[a][b] = round2((v[a][b] || 0) + x); rt[a] = round2((rt[a] || 0) + x); ct[b] = round2((ct[b] || 0) + x);
        });
        return { cos: Object.keys(cos).sort(), v: v, rowTotal: rt, colTotal: ct };
    };

    /** What needs attention (worst first). ctx = {match, funLinks, recon, glNoParty: {n, amount}, invNoAr: {n, amount}, missing: [kinds not synced]} */
    FIC.findings = function (ctx) {
        var f = [], add = function (sev, text, n, amount, go) { if (n) f.push({ sev: sev, text: text, n: n, amount: round2(amount || 0), go: go }); };
        var mt = ctx.match;
        if (mt) {
            add('bad', 'invoices billed to another company that company has not booked as a payable', mt.counts.SELL_ONLY, mt.totals.SELL_ONLY, 'match:SELL_ONLY');
            add('bad', 'payables booked from another company with no receivable there', mt.counts.BUY_ONLY, mt.totals.BUY_ONLY, 'match:BUY_ONLY');
            add('warn', 'pairs of invoices whose amounts differ', mt.counts.DIFF, mt.totals.DIFF, 'match:DIFF');
            add('info', 'invoices booked in different months on each side (timing)', mt.counts.TIMING, mt.totals.TIMING, 'match:TIMING');
        }
        if (ctx.recon) {
            var rc = ctx.recon.pairs;
            var d = rc.filter(function (r) { return r.status === 'DIFF'; }), o = rc.filter(function (r) { return r.status === 'ONE_SIDED'; }), c = rc.filter(function (r) { return r.status === 'CURRENCY'; });
            add('bad', 'pairs of companies whose intercompany balances do not net to nil', d.length, d.reduce(function (s, r) { return s + Math.abs(r.diff); }, 0), 'recon:DIFF');
            add('warn', 'balances with another company that company does not show at all', o.length, o.reduce(function (s, r) { return s + Math.abs(r.diff); }, 0), 'recon:ONE_SIDED');
            add('info', 'pairs kept in different currencies — compare them after translation', c.length, 0, 'recon:CURRENCY');
        }
        if (ctx.funLinks) {
            var inc = ctx.funLinks.filter(function (x) { return x.status === 'NO_AP' || x.status === 'NO_AR' || x.status === 'NOT_FOUND'; });
            add('warn', 'Intercompany module transactions without their AR or AP invoice', inc.length, inc.reduce(function (s, x) { return s + Math.abs(num(x.fun.amount)); }, 0), 'fun');
        }
        if (ctx.glNoParty) add('warn', 'GL lines on intercompany accounts without a counterparty company', ctx.glNoParty.n, ctx.glNoParty.amount, 'trx:GL');
        if (ctx.invNoAr) add('info', 'pairs with inventory shipped but no intercompany invoice that month', ctx.invNoAr.n, ctx.invNoAr.amount, 'trx:INV');
        if (ctx.missing && ctx.missing.length) f.push({ sev: 'info', text: 'not synced for this month: ' + ctx.missing.join(', '), n: ctx.missing.length, amount: 0, go: 'sync' });
        var w = { bad: 0, warn: 1, info: 2 };
        return f.sort(function (a, b) { return w[a.sev] - w[b.sev] || Math.abs(b.amount) - Math.abs(a.amount); });
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = FIC; else root.FIC = FIC;
})(typeof window !== 'undefined' ? window : this);
