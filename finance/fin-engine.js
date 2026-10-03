/* Finance Lens — the statement engine (pure: no DOM, no host; runs in the page and in node for the tests).
   Data: accounts [{code, name, account_type A|L|O|R|E, class}], periods [{period_name, period_seq, fiscal_year, period_num}],
   facts = { SCENARIO: { account: { period_seq: [net, end] } } } for one filter (companies / cost centres).
   Templates: rows (header · accounts · group · formula · check · blank · text) with styles, and columns
   (scenario × range MTD / QTD / YTD / LTM / FY / BAL / OPEN × anchor CUR / PM / PY / PYE, variances, % of a row).
   Basis of an accounts row: activity (sum of movements) for income statement accounts, balance (closing) for balance sheet
   accounts, or change (closing − opening) / opening — that is what the cash flow statement is built on.
   Sign: credit rows show credits as positive (revenue, liabilities, equity), debit rows show debits as positive. */
(function (root) {
    'use strict';
    var FINE = {};

    // ── accounts ──
    var CREDIT_TYPES = { R: 1, L: 1, O: 1 };
    /** "4000-4099, 4100, 5*, !5200" | ["4000-4099"] | {type:'R'} | {class:'Revenue'} → matching account codes (sorted). */
    FINE.matchAccounts = function (spec, accounts) {
        if (!spec) return [];
        var out = [];
        if (typeof spec === 'object' && !Array.isArray(spec)) {
            accounts.forEach(function (a) {
                var ok = (!spec.type || String(spec.type).indexOf(a.account_type) >= 0) &&
                    (!spec.class || [].concat(spec.class).indexOf(a.class) >= 0) &&
                    (!spec.prefix || [].concat(spec.prefix).some(function (p) { return String(a.code).indexOf(p) === 0; }));
                if (ok) out.push(a.code);
            });
            return out.sort();
        }
        var parts = (Array.isArray(spec) ? spec : String(spec).split(/[,;\n]+/)).map(function (s) { return String(s).trim(); }).filter(Boolean);
        if (parts.every(function (p) { return !/[-*!]/.test(p); })) {                 // plain codes (simple templates): one set lookup per account
            var set = {}; parts.forEach(function (p) { set[p] = 1; });
            accounts.forEach(function (a) { if (set[String(a.code)]) out.push(String(a.code)); });
            return out.sort();
        }
        var inc = parts.filter(function (p) { return p[0] !== '!'; }), exc = parts.filter(function (p) { return p[0] === '!'; }).map(function (p) { return p.slice(1).trim(); });
        var hit = function (code, p) {
            if (p.indexOf('-') > 0) { var r = p.split('-'); return code >= r[0].trim() && code <= r[1].trim(); }
            if (p.slice(-1) === '*') return code.indexOf(p.slice(0, -1)) === 0;
            return code === p;
        };
        accounts.forEach(function (a) {
            var c = String(a.code);
            if (inc.some(function (p) { return hit(c, p); }) && !exc.some(function (p) { return hit(c, p); })) out.push(c);
        });
        return out.sort();
    };
    FINE.isCredit = function (a) { return !!CREDIT_TYPES[a.account_type]; };
    FINE.isPl = function (a) { return a.account_type === 'R' || a.account_type === 'E'; };

    // ── periods & windows ──
    FINE.periodIndex = function (periods) {
        var list = periods.slice().sort(function (a, b) { return a.period_seq - b.period_seq; });
        var bySeq = {}; list.forEach(function (p, i) { bySeq[p.period_seq] = i; });
        return { list: list, bySeq: bySeq };
    };
    /** Column window → {from, to} indexes in pi.list (inclusive; from may be -1 = before the data), or null when outside. */
    FINE.windowOf = function (col, pi, curSeq) {
        var L = pi.list, i = pi.bySeq[curSeq];
        if (i == null) return null;
        var at = col.at || 'CUR';
        if (at === 'PM') i -= 1;
        else if (at === 'PY') i -= 12;
        else if (at === 'PYE') { var y = L[i].fiscal_year; while (i >= 0 && L[i].fiscal_year >= y) i--; }
        else if (at === 'PQ') i -= 3;
        else if (/^M-\d+$/.test(at)) i -= +at.slice(2);                 // n months back (trend columns)
        if (i < 0) return null;
        var p = L[i], range = col.range || 'MTD', from = i;
        if (range === 'QTD') { while (from > 0 && L[from - 1].fiscal_year === p.fiscal_year && Math.floor((L[from - 1].period_num - 1) / 3) === Math.floor((p.period_num - 1) / 3)) from--; }
        else if (range === 'YTD') { while (from > 0 && L[from - 1].fiscal_year === p.fiscal_year) from--; }
        else if (range === 'LTM') from = Math.max(0, i - 11);
        else if (range === 'FY') { while (from > 0 && L[from - 1].fiscal_year === p.fiscal_year) from--; var to = i; while (to + 1 < L.length && L[to + 1].fiscal_year === p.fiscal_year) to++; return { from: from, to: to, end: to, partial: false }; }
        else if (range === 'OPEN') return { from: i, to: i, end: i - 1, open: true };
        return { from: from, to: i, end: i, partial: range === 'LTM' && i - 11 < 0 };
    };

    /** Raw (debit-positive) amount of one account for a basis in a window. f = facts[scenario][account]. */
    function amountOf(f, pi, w, basis) {
        if (!f || !w) return 0;
        var L = pi.list, endAt = function (ix) { if (ix < 0) return firstOpen(f, L); var x = f[L[ix].period_seq]; return x ? x[1] : 0; };
        if (basis === 'balance') return endAt(w.end);
        if (basis === 'opening') return endAt(w.from - 1);
        if (basis === 'change') return endAt(w.to) - endAt(w.from - 1);
        var s = 0;
        for (var k = w.from; k <= w.to; k++) { var x = f[L[k].period_seq]; if (x) s += x[0]; }
        return s;
    }
    // the balance before the first loaded period = first period's closing − its movement
    function firstOpen(f, L) { var x = f[L[0].period_seq]; return x ? x[1] - x[0] : 0; }

    // ── formulas: + - * / ^, comparisons, ( ), numbers, row ids (A.B@WIN for KPIs), functions ──
    var FUNCS = {
        ABS: function (a) { return Math.abs(a); }, MIN: function () { return Math.min.apply(null, arguments); }, MAX: function () { return Math.max.apply(null, arguments); },
        IF: function (c, a, b) { return c ? a : b; }, DIV: function (a, b) { return b ? a / b : 0; }, ROUND: function (a, n) { var k = Math.pow(10, n || 0); return Math.round(a * k) / k; },
        SUM: function () { var s = 0; for (var i = 0; i < arguments.length; i++) s += arguments[i]; return s; },
        AVG: function () { var s = 0; for (var i = 0; i < arguments.length; i++) s += arguments[i]; return arguments.length ? s / arguments.length : 0; },
        PCT: function (a, b) { return b ? a / b * 100 : 0; }, NEG: function (a) { return -a; }
    };
    FINE.FUNCTIONS = Object.keys(FUNCS);
    FINE.parse = function (text) {
        var s = String(text || ''), i = 0, toks = [];
        while (i < s.length) {
            var c = s[i];
            if (/\s/.test(c)) { i++; continue; }
            if (/[0-9.]/.test(c)) { var m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?/i.exec(s.slice(i)); if (!m) throw new Error('bad number at ' + i); toks.push({ t: 'n', v: parseFloat(m[0]) }); i += m[0].length; continue; }
            if (/[A-Za-z_]/.test(c)) { var m2 = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?(@[A-Za-z_]+)?/.exec(s.slice(i)); toks.push({ t: 'id', v: m2[0] }); i += m2[0].length; continue; }
            var two = s.substr(i, 2);
            if (two === '>=' || two === '<=' || two === '<>' || two === '==' || two === '!=') { toks.push({ t: 'op', v: two === '==' ? '=' : two === '!=' ? '<>' : two }); i += 2; continue; }
            if ('+-*/^(),<>='.indexOf(c) >= 0) { toks.push({ t: 'op', v: c }); i++; continue; }
            throw new Error('unexpected "' + c + '" at ' + (i + 1));
        }
        var p = 0;
        var peek = function () { return toks[p]; }, eat = function (v) { var t = toks[p]; if (!t || (v && t.v !== v)) throw new Error('expected ' + (v || 'more') + ' in "' + s + '"'); p++; return t; };
        var PREC = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '+': 2, '-': 2, '*': 3, '/': 3, '^': 4 };
        function primary() {
            var t = peek();
            if (!t) throw new Error('formula ends too early: "' + s + '"');
            if (t.t === 'op' && t.v === '-') { p++; return { k: 'neg', a: unary() }; }
            if (t.t === 'op' && t.v === '+') { p++; return unary(); }
            if (t.t === 'op' && t.v === '(') { p++; var e = expr(0); eat(')'); return e; }
            if (t.t === 'n') { p++; return { k: 'n', v: t.v }; }
            if (t.t === 'id') {
                p++;
                if (peek() && peek().v === '(') {
                    var fn = t.v.toUpperCase(); if (!FUNCS[fn]) throw new Error('unknown function ' + t.v);
                    p++; var args = [];
                    if (peek() && peek().v !== ')') { args.push(expr(0)); while (peek() && peek().v === ',') { p++; args.push(expr(0)); } }
                    eat(')'); return { k: 'f', f: fn, args: args };
                }
                return { k: 'id', v: t.v };
            }
            throw new Error('unexpected "' + t.v + '" in "' + s + '"');
        }
        function unary() { return primary(); }
        function expr(min) {
            var left = unary();
            for (;;) {
                var t = peek(); if (!t || t.t !== 'op' || !PREC[t.v] || PREC[t.v] < min) break;
                p++; var right = expr(t.v === '^' ? PREC[t.v] : PREC[t.v] + 1);
                left = { k: 'b', op: t.v, a: left, b: right };
            }
            return left;
        }
        var ast = expr(0);
        if (p < toks.length) throw new Error('unexpected "' + toks[p].v + '" in "' + s + '"');
        return ast;
    };
    FINE.refs = function (ast, out) {
        out = out || [];
        if (!ast) return out;
        if (ast.k === 'id') out.push(ast.v);
        if (ast.a) FINE.refs(ast.a, out); if (ast.b) FINE.refs(ast.b, out);
        (ast.args || []).forEach(function (x) { FINE.refs(x, out); });
        return out;
    };
    FINE.evalAst = function (ast, get) {
        switch (ast.k) {
            case 'n': return ast.v;
            case 'id': var v = get(ast.v); return v == null || isNaN(v) ? 0 : v;
            case 'neg': return -FINE.evalAst(ast.a, get);
            case 'f': return FUNCS[ast.f].apply(null, ast.args.map(function (x) { return FINE.evalAst(x, get); }));
            case 'b':
                var a = FINE.evalAst(ast.a, get), b = FINE.evalAst(ast.b, get);
                switch (ast.op) {
                    case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return b ? a / b : 0; case '^': return Math.pow(a, b);
                    case '=': return Math.abs(a - b) < 1e-9 ? 1 : 0; case '<>': return Math.abs(a - b) >= 1e-9 ? 1 : 0;
                    case '<': return a < b ? 1 : 0; case '>': return a > b ? 1 : 0; case '<=': return a <= b ? 1 : 0; case '>=': return a >= b ? 1 : 0;
                }
        }
        return 0;
    };

    // ── columns ──
    var RANGE_LABEL = { MTD: 'Month', QTD: 'QTD', YTD: 'YTD', LTM: 'Last 12m', FY: 'Full year', BAL: 'Balance', OPEN: 'Opening' };
    FINE.colLabel = function (col, pi, curSeq) {
        if (col.label) return col.label;
        if (col.kind === 'var') return (col.mode === 'pct' ? 'Var %' : 'Variance');
        if (col.kind === 'pctof') return '% of ' + (col.row || '');
        var w = FINE.windowOf(col, pi, curSeq), p = w && pi.list[Math.max(0, w.end)];
        var sc = col.scenario && col.scenario !== 'ACTUAL' ? ' ' + col.scenario.charAt(0) + col.scenario.slice(1).toLowerCase() : '';
        if (!p) return ({ PM: 'Last month', PQ: '3 months back', PY: 'Last year', PYE: 'Last year end' }[col.at] || (RANGE_LABEL[col.range] || col.range)) + sc;
        if (col.range === 'BAL' || col.range === 'OPEN' || col.plain) return p.period_name + sc;
        return (RANGE_LABEL[col.range || 'MTD'] || col.range) + ' ' + p.period_name + sc;
    };

    /** Resolves the row's accounts and basis once per template evaluation. */
    function prepRows(tpl, accounts) {
        var byCode = {}; accounts.forEach(function (a) { byCode[a.code] = a; });
        return (tpl.rows || []).map(function (r) {
            var x = Object.assign({}, r);
            if (r.type === 'accounts') {
                x._acc = FINE.matchAccounts(r.accounts, accounts);
                var objs = x._acc.map(function (c) { return byCode[c]; });
                x._basis = r.basis && r.basis !== 'auto' ? r.basis : (objs.length && objs.every(FINE.isPl) ? 'activity' : objs.length && objs.every(function (a) { return !FINE.isPl(a); }) ? 'balance' : 'activity');
                var sg = r.sign || 'auto';
                x._sign = sg === 'credit' ? -1 : sg === 'debit' ? 1 : (objs.length && objs.every(FINE.isCredit) ? -1 : 1);
            }
            if ((r.type === 'formula' || r.type === 'check') && r.formula) {
                try { x._ast = FINE.parse(r.formula); } catch (e) { x._err = e.message; }
            }
            return x;
        });
    }

    /**
     * Evaluates a template for one period. Returns {columns:[{id,label,kind}], rows:[{id,label,type,level,style,format,values:[],
     * accounts:[], error}], errors:[]}. opts: {period: period_seq, scale: 1|1000|1e6, columns: override, data: {accounts, periods, facts}}.
     */
    FINE.compute = function (tpl, data, opts) {
        opts = opts || {};
        var pi = data._pi || (data._pi = FINE.periodIndex(data.periods));
        var cur = opts.period || (pi.list.length ? pi.list[pi.list.length - 1].period_seq : null);
        var cols = (opts.columns || tpl.columns || [{ id: 'c1', scenario: 'ACTUAL', range: 'MTD' }]).map(function (c, i) { return Object.assign({ id: c.id || 'c' + (i + 1) }, c); });
        var rows = prepRows(tpl, data.accounts), byId = {}, errors = [];
        rows.forEach(function (r) { if (r.id) byId[r.id] = r; });
        var children = {}; rows.forEach(function (r) { if (r.parent) (children[r.parent] = children[r.parent] || []).push(r); });
        var scale = opts.scale || tpl.scale || 1;
        var valueCols = cols.filter(function (c) { return !c.kind; });
        var memo = {};                                    // colId|rowId → value (displayed sign, unscaled)
        var stack = {};
        function rowVal(r, col) {
            var key = col.id + '|' + r.id;
            if (r.id && memo[key] != null) return memo[key];
            if (r.id && stack[key]) { errors.push('circular reference at ' + r.id); return 0; }
            if (r.id) stack[key] = 1;
            var v = 0;
            if (r.type === 'accounts') {
                var w = FINE.windowOf(col, pi, cur), f = (data.facts[col.scenario || 'ACTUAL'] || {});
                if (w) r._acc.forEach(function (a) { v += amountOf(f[a], pi, w, r._basis); });
                v *= r._sign;
            } else if (r.type === 'group') {
                (children[r.id] || []).forEach(function (ch) { if (ch.type !== 'header' && ch.type !== 'blank' && ch.type !== 'text' && !ch.exclude) v += rowVal(ch, col) * (ch.negate ? -1 : 1); });
            } else if ((r.type === 'formula' || r.type === 'check') && r._ast) {
                v = FINE.evalAst(r._ast, function (id) {
                    var t = byId[id];
                    if (!t) { errors.push((r.id || r.label) + ': unknown row ' + id); return 0; }
                    return rowVal(t, col);
                });
            }
            if (r.id) { memo[key] = v; delete stack[key]; }
            return v;
        }
        var outRows = rows.map(function (r) {
            var vals = cols.map(function (col) {
                if (r.type === 'header' || r.type === 'blank' || r.type === 'text') return null;
                if (col.kind === 'var') {
                    var a = cols.filter(function (c) { return c.id === col.a; })[0], b = cols.filter(function (c) { return c.id === col.b; })[0];
                    if (!a || !b) return null;
                    if (!FINE.windowOf(a, pi, cur) || !FINE.windowOf(b, pi, cur)) return null;     // a side before the first period: no change to show
                    var va = rowVal(r, a), vb = rowVal(r, b), d = va - vb;
                    // a cost going up is unfavourable: flip so that + is always good when the row says so
                    if (r.favourable === 'down') d = -d;
                    if (col.mode === 'pct') return vb ? d / Math.abs(vb) * 100 : null;
                    return d;
                }
                if (col.kind === 'pctof') {
                    var base = byId[col.row], bc = cols.filter(function (c) { return c.id === col.of; })[0];
                    if (!base || !bc) return null;
                    var bv = rowVal(base, bc); return bv ? rowVal(r, bc) / bv * 100 : null;
                }
                return rowVal(r, col);
            });
            if (r._err) errors.push((r.id || r.label) + ': ' + r._err);
            return { id: r.id, label: r.label, type: r.type, level: r.level || 0, parent: r.parent, style: r.style || {}, format: r.format || 'num', note: r.note,
                accounts: r._acc || null, basis: r._basis, sign: r._sign, hidden: !!r.hidden, favourable: r.favourable, error: r._err,
                values: vals.map(function (v, i) {
                    var c = cols[i], unscaled = c.kind === 'pctof' || (c.kind === 'var' && c.mode === 'pct') || r.format === 'pct' || r.format === 'ratio' || r.format === 'days' || r.format === 'raw';
                    if (v == null) return null;
                    if (c.kind === 'var' && c.mode === 'pct' && r.format === 'pct') return null;          // % of a % says nothing: show the points only
                    return unscaled ? v : v / scale;
                }),
                raw: vals };
        });
        // a check row must be zero in every value column
        outRows.forEach(function (r) {
            if (r.type !== 'check') return;
            r.ok = r.raw.every(function (v, i) { return cols[i].kind || v == null || Math.abs(v) < (tplTolerance(tpl)); });
        });
        return { template: tpl.id, name: tpl.name, period: cur, periodName: (pi.list[pi.bySeq[cur]] || {}).period_name, scale: scale,
            columns: cols.map(function (c) { return { id: c.id, label: FINE.colLabel(c, pi, cur), kind: c.kind || 'value', scenario: c.scenario || 'ACTUAL', range: c.range, at: c.at, mode: c.mode }; }),
            rows: outRows, errors: errors.filter(function (e, i) { return errors.indexOf(e) === i; }), valueCols: valueCols.length };
    };
    function tplTolerance(tpl) { return tpl.tolerance != null ? tpl.tolerance : 1; }

    /** The accounts behind one cell: [{code, name, amount}] (displayed sign, unscaled), biggest first. */
    FINE.explain = function (tpl, data, opts, rowId, colId) {
        var pi = data._pi || (data._pi = FINE.periodIndex(data.periods));
        var cur = opts.period, rows = prepRows(tpl, data.accounts), r = rows.filter(function (x) { return x.id === rowId; })[0];
        var col = (opts.columns || tpl.columns || []).filter(function (c) { return c.id === colId; })[0];
        if (!r || !col || col.kind) return [];
        var names = {}; data.accounts.forEach(function (a) { names[a.code] = a.name; });
        var collect = function (row, mult, acc) {
            if (row.type === 'accounts') {
                var w = FINE.windowOf(col, pi, cur), f = data.facts[col.scenario || 'ACTUAL'] || {};
                row._acc.forEach(function (a) { var v = amountOf(f[a], pi, w, row._basis) * row._sign * mult; if (Math.abs(v) > 0.004) acc[a] = (acc[a] || 0) + v; });
            } else if (row.type === 'group') rows.forEach(function (ch) { if (ch.parent === row.id && !ch.exclude) collect(ch, mult * (ch.negate ? -1 : 1), acc); });
            return acc;
        };
        var acc = collect(r, 1, {});
        return Object.keys(acc).map(function (k) { return { code: k, name: names[k] || k, amount: acc[k] }; }).sort(function (a, b) { return Math.abs(b.amount) - Math.abs(a.amount); });
    };

    /** Period window (period_seq list) of a column — for drill-down SQL. */
    FINE.windowSeqs = function (col, data, cur) {
        var pi = data._pi || (data._pi = FINE.periodIndex(data.periods)), w = FINE.windowOf(col, pi, cur);
        if (!w) return [];
        var out = []; for (var k = Math.max(0, w.from); k <= w.to; k++) out.push(pi.list[k].period_seq);
        return out;
    };

    // ═════════ KPIs: formulas over template rows: PL.REV@YTD / BS.AR@BAL * 365 ═════════
    var WIN = {
        MTD: { range: 'MTD' }, QTD: { range: 'QTD' }, YTD: { range: 'YTD' }, LTM: { range: 'LTM' }, BAL: { range: 'BAL' }, OPEN: { range: 'OPEN' },
        PM: { range: 'MTD', at: 'PM' }, PMBAL: { range: 'BAL', at: 'PM' }, PY: { range: 'MTD', at: 'PY' }, PYYTD: { range: 'YTD', at: 'PY' }, PYLTM: { range: 'LTM', at: 'PY' },
        PYBAL: { range: 'BAL', at: 'PY' }, PYE: { range: 'BAL', at: 'PYE' },
        BUD: { range: 'MTD', scenario: 'BUDGET' }, BUDYTD: { range: 'YTD', scenario: 'BUDGET' }, BUDFY: { range: 'FY', scenario: 'BUDGET' }, FY: { range: 'FY' }
    };
    FINE.WINDOWS = Object.keys(WIN);
    /** Evaluates KPI definitions [{id, expr, win}] for one period → {id: value}. templates: {ID: template}. */
    FINE.kpis = function (defs, templates, data, period) {
        var need = {};                                  // tplId → {winKey: col}
        var parsed = defs.map(function (d) {
            try {
                var ast = FINE.parse(d.expr);
                FINE.refs(ast).forEach(function (ref) {
                    var m = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)(?:@([A-Za-z_]+))?$/.exec(ref);
                    if (!m) return;
                    var w = (m[3] || d.win || 'YTD').toUpperCase();
                    if (!WIN[w]) throw new Error('unknown window @' + m[3]);
                    (need[m[1]] = need[m[1]] || {})[w] = Object.assign({ id: w, scenario: 'ACTUAL' }, WIN[w]);
                });
                return { d: d, ast: ast };
            } catch (e) { return { d: d, err: e.message }; }
        });
        var vals = {}, nodata = {}, pi = data._pi || (data._pi = FINE.periodIndex(data.periods));
        Object.keys(need).forEach(function (t) {
            var tpl = templates[t]; if (!tpl) return;
            var res = FINE.compute(tpl, data, { period: period, columns: Object.keys(need[t]).map(function (k) { return need[t][k]; }), scale: 1 });
            res.rows.forEach(function (r) { if (!r.id) return; res.columns.forEach(function (c, i) { vals[t + '.' + r.id + '@' + c.id] = r.raw[i]; }); });
            Object.keys(need[t]).forEach(function (w) { var why = FINE.windowGap(need[t][w], data, period, pi); if (why) nodata[t + '@' + w] = why; });
        });
        var out = {};
        parsed.forEach(function (x) {
            if (x.err) { out[x.d.id] = { value: null, error: x.err }; return; }
            var missing = [], gaps = [];
            var v = FINE.evalAst(x.ast, function (ref) {
                var m = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)(?:@([A-Za-z_]+))?$/.exec(ref);
                if (!m) {                                                                     // an earlier KPI
                    if (out[ref] && out[ref].value != null) return out[ref].value;
                    if (out[ref] && out[ref].nodata) { gaps = gaps.concat(out[ref].nodata); return 0; }
                    missing.push(ref); return 0;
                }
                var w = (m[3] || x.d.win || 'YTD').toUpperCase(), k = m[1] + '.' + m[2] + '@' + w;
                if (!(k in vals)) { missing.push(ref); return 0; }
                if (nodata[m[1] + '@' + w]) gaps.push(nodata[m[1] + '@' + w]);
                return vals[k];
            });
            gaps = gaps.filter(function (g, i) { return gaps.indexOf(g) === i; });
            out[x.d.id] = missing.length ? { value: null, error: 'unknown ' + missing.join(', ') }
                : gaps.length ? { value: null, nodata: gaps }                               // not 0 %: the data for it is not there
                : { value: isFinite(v) ? v : null };
        });
        return out;
    };
    /** Why a window has no data: before the first synced period, or no budget loaded (null = it has data). Partial last-12-month
        windows still compute — FINE.kpiExplain says so. */
    FINE.windowGap = function (col, data, period, pi) {
        pi = pi || data._pi || (data._pi = FINE.periodIndex(data.periods));
        var w = FINE.windowOf(col, pi, period), sc = col.scenario || 'ACTUAL';
        if (sc !== 'ACTUAL' && !Object.keys(data.facts[sc] || {}).length) return 'no ' + sc.toLowerCase() + ' loaded';
        if (!w) return { PY: 'last year not synced', PYE: 'last year end not synced', PM: 'previous month not synced', PQ: 'the quarter before not synced' }[col.at] || 'period not synced';
        return null;
    };
    var WIN_TEXT = { MTD: 'the month', QTD: 'quarter to date', YTD: 'year to date', LTM: 'last 12 months', BAL: 'closing balance', OPEN: 'opening balance', PM: 'previous month', PMBAL: 'balance at the end of the previous month',
        PY: 'same month last year', PYYTD: 'year to date last year', PYLTM: 'the 12 months before', PYBAL: 'balance a year ago', PYE: 'balance at the last year end', BUD: 'budget for the month', BUDYTD: 'budget year to date', BUDFY: 'budget for the full year', FY: 'full year' };
    /** How a KPI is worked out for one period: every input (template line × window) with its value, the periods it covers, the
        accounts behind it and what is missing; the formula with the numbers in it. → {value, error, nodata, inputs, substituted, notes} */
    FINE.kpiExplain = function (def, defs, templates, data, period) {
        var pi = data._pi || (data._pi = FINE.periodIndex(data.periods));
        var all = FINE.kpis(defs.filter(function (d) { return d.id !== def.id; }).concat([def]), templates, data, period), res = all[def.id] || {};
        var ast; try { ast = FINE.parse(def.expr); } catch (e) { return { error: e.message, inputs: [] }; }
        var refs = FINE.refs(ast).filter(function (r, i, a) { return a.indexOf(r) === i; }), notes = [];
        var inputs = refs.map(function (ref) {
            var m = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)(?:@([A-Za-z_]+))?$/.exec(ref);
            if (!m) { var k = all[ref] || {}, d = defs.filter(function (x) { return x.id === ref; })[0] || {}; return { ref: ref, kind: 'kpi', label: d.label || ref, expr: d.expr, value: k.value, nodata: k.nodata, fmt: d.fmt }; }
            var w = (m[3] || def.win || 'YTD').toUpperCase(), tpl = templates[m[1]], col = Object.assign({ id: 'x', scenario: 'ACTUAL' }, WIN[w] || {});
            var row = tpl && (tpl.rows || []).filter(function (r) { return r.id === m[2]; })[0];
            var out = { ref: ref, kind: 'row', tpl: m[1], tplName: tpl ? tpl.name : '?', row: m[2], label: row ? row.label : m[2], rowType: row ? row.type : '', formula: row && row.formula, window: w, windowText: WIN_TEXT[w] || w, scenario: col.scenario };
            if (!tpl || !row) { out.error = !tpl ? 'no template ' + m[1] : 'no line ' + m[2] + ' in ' + m[1]; return out; }
            var win = FINE.windowOf(col, pi, period);
            out.nodata = FINE.windowGap(col, data, period, pi);
            if (win) { out.from = pi.list[Math.max(0, win.from)].period_name; out.to = pi.list[win.to].period_name; out.months = win.to - Math.max(0, win.from) + 1; if (win.partial) { out.partial = true; notes.push(ref + ': only ' + out.months + ' of 12 months are synced — sync the earlier months for a true last-12-month figure'); } }
            var st = FINE.compute(tpl, data, { period: period, columns: [col], scale: 1 }), r = st.rows.filter(function (x) { return x.id === m[2]; })[0];
            out.value = r ? r.raw[0] : null;
            if (row.type === 'accounts' || row.type === 'group') {
                var acc = FINE.explain(tpl, data, { period: period, columns: [col] }, m[2], 'x');
                out.accounts = acc; out.accountCount = acc.length;
                if (row.type === 'accounts' && !FINE.matchAccounts(row.accounts, data.accounts).length) notes.push(ref + ': no accounts are mapped to "' + row.label + '" — map them in the Statement builder');
            }
            if (row.type === 'formula' && row.formula) {
                // a formula line (Gross profit = REV - COGS): its parts in the same window, each with its accounts
                try {
                    out.parts = FINE.refs(FINE.parse(row.formula)).filter(function (r, i, a) { return a.indexOf(r) === i; }).map(function (pid) {
                        var pr = (tpl.rows || []).filter(function (z) { return z.id === pid; })[0], sr = st.rows.filter(function (z) { return z.id === pid; })[0];
                        var acc = pr && (pr.type === 'accounts' || pr.type === 'group') ? FINE.explain(tpl, data, { period: period, columns: [col] }, pid, 'x') : null;
                        return { row: pid, label: pr ? pr.label : pid, type: pr ? pr.type : '?', formula: pr && pr.formula, value: sr ? sr.raw[0] : null, accounts: acc };
                    });
                } catch (e) { /* shown as the formula text */ }
            }
            if (out.nodata) notes.push(ref + ': ' + out.nodata);
            return out;
        });
        var substituted = def.expr;
        refs.slice().sort(function (a, b) { return b.length - a.length; }).forEach(function (ref) {
            var x = inputs.filter(function (i) { return i.ref === ref; })[0], v = x && x.value;
            var txt = v == null ? '?' : Math.abs(v) >= 1000 ? FINE.fmt(v, 'num', { decimals: 0, paren: false }) : String(Math.round(v * 100) / 100);
            substituted = substituted.split(ref).join(txt);
        });
        return { value: res.value, error: res.error, nodata: res.nodata, inputs: inputs, substituted: substituted, notes: notes.filter(function (n, i, a) { return a.indexOf(n) === i; }) };
    };

    // ═════════ company health: KPIs scored against bands, grouped in pillars ═════════
    /** Bands per KPI: good / poor limits (dir up: higher is better). Typical mid-size trading / distribution company —
        change them in config.health (same shape) for your business. */
    FINE.HEALTH = {
        pillars: [
            { id: 'profit', name: 'Profitability', kpis: ['gm', 'ebitda_m', 'npm', 'roe'], weight: 25 },
            { id: 'growth', name: 'Growth & plan', kpis: ['rev_g', 'rev_bud'], weight: 10 },
            { id: 'liquid', name: 'Liquidity', kpis: ['cr', 'qr'], weight: 20 },
            { id: 'wc', name: 'Working capital', kpis: ['dso', 'dio', 'ccc'], weight: 15 },
            { id: 'solv', name: 'Debt & solvency', kpis: ['de', 'nd_ebitda', 'icr'], weight: 20 },
            { id: 'cash', name: 'Cash generation', kpis: ['cconv'], weight: 5 },
            { id: 'books', name: 'Books in order', kpis: ['bs_chk', 'susp'], weight: 5 }],
        bands: {
            gm: { dir: 'up', good: 30, poor: 15 }, ebitda_m: { dir: 'up', good: 12, poor: 5 }, npm: { dir: 'up', good: 8, poor: 2 }, roe: { dir: 'up', good: 12, poor: 0 },
            rev_g: { dir: 'up', good: 5, poor: 0 }, rev_bud: { dir: 'up', good: 97, poor: 90 },
            cr: { dir: 'up', good: 1.5, poor: 1 }, qr: { dir: 'up', good: 1, poor: 0.7 },
            dso: { dir: 'down', good: 45, poor: 75 }, dio: { dir: 'down', good: 60, poor: 120 }, ccc: { dir: 'down', good: 60, poor: 120 },
            de: { dir: 'down', good: 1, poor: 2 }, nd_ebitda: { dir: 'down', good: 2, poor: 3.5, negBad: true }, icr: { dir: 'up', good: 4, poor: 1.5, negBad: true },
            cconv: { dir: 'up', good: 80, poor: 50 }, bs_chk: { dir: 'zero', tol: 1 }, susp: { dir: 'zero', tol: 1, watchOnly: true } }
    };
    /** One KPI value against its band → 'good' | 'watch' | 'poor' | 'nodata' */
    FINE.band = function (b, v) {
        if (v == null || !isFinite(v) || !b) return 'nodata';
        if (b.dir === 'zero') return Math.abs(v) <= (b.tol || 0.5) ? 'good' : b.watchOnly ? 'watch' : 'poor';
        if (b.negBad && v < 0) return 'poor';                       // a negative EBITDA / EBIT makes the ratio meaningless — and bad
        if (b.dir === 'down') return v <= b.good ? 'good' : v > b.poor ? 'poor' : 'watch';
        return v >= b.good ? 'good' : v < b.poor ? 'poor' : 'watch';
    };
    /** Health from KPI values: {score 0-100 | null, grade, coverage, pillars: [{id, name, score, items: [{id, label, value, fmt, band, nodata}]}], gaps: [reasons]} */
    FINE.health = function (kpiVals, defs, cfg) {
        cfg = cfg || FINE.HEALTH;
        var bands = Object.assign({}, FINE.HEALTH.bands, cfg.bands || {}), pts = { good: 100, watch: 60, poor: 20 }, byId = {};
        (defs || []).forEach(function (d) { byId[d.id] = d; });
        var gaps = [], tot = 0, wsum = 0, have = 0, all = 0;
        var pillars = (cfg.pillars || FINE.HEALTH.pillars).map(function (p) {
            var items = p.kpis.filter(function (id) { return byId[id]; }).map(function (id) {
                var k = kpiVals[id] || {}, b = bands[id], st = k.error ? 'nodata' : FINE.band(b, k.value);
                all++; if (st !== 'nodata') have++;
                (k.nodata || []).forEach(function (g) { if (gaps.indexOf(g) < 0) gaps.push(g); });
                return { id: id, label: byId[id].label, value: k.value, fmt: byId[id].fmt, band: st, nodata: k.nodata, error: k.error, limits: b };
            });
            var scored = items.filter(function (i) { return i.band !== 'nodata'; });
            var sc = scored.length ? Math.round(scored.reduce(function (a, i) { return a + pts[i.band]; }, 0) / scored.length) : null;
            if (sc != null) { tot += sc * (p.weight || 1); wsum += p.weight || 1; }
            return { id: p.id, name: p.name, score: sc, items: items };
        });
        var score = wsum ? Math.round(tot / wsum) : null;
        return { score: score, grade: score == null ? 'Not enough data' : score >= 75 ? 'Healthy' : score >= 55 ? 'Watch' : 'At risk',
            coverage: all ? Math.round(have / all * 100) : 0, pillars: pillars, gaps: gaps };
    };

    /** KPI values over the last n periods (oldest first) → {id: [{period, name, value}]} */
    FINE.kpiTrend = function (defs, templates, data, period, n) {
        var pi = data._pi || (data._pi = FINE.periodIndex(data.periods)), i = pi.bySeq[period], out = {};
        defs.forEach(function (d) { out[d.id] = []; });
        for (var k = Math.max(0, i - (n || 12) + 1); k <= i; k++) {
            var p = pi.list[k], v = FINE.kpis(defs, templates, data, p.period_seq);
            defs.forEach(function (d) { out[d.id].push({ period: p.period_seq, name: p.period_name, value: v[d.id].value }); });
        }
        return out;
    };
    /** Monitor rules [{id, kpi, op, value, severity}] against KPI values → [{rule, status ok|breach|na, value}] */
    FINE.monitor = function (rules, kpiVals) {
        return (rules || []).map(function (r) {
            var k = kpiVals[r.kpi], v = k && k.value;
            if (v == null) return { rule: r, status: 'na', value: null };
            var t = +r.value, tol = r.tolerance != null ? +r.tolerance : 0.5;    // = and <> ignore rounding pennies
            var breach = r.op === '<' ? v < t : r.op === '<=' ? v <= t : r.op === '>' ? v > t : r.op === '>=' ? v >= t : r.op === '=' ? Math.abs(v - t) <= tol : Math.abs(v - t) > tol;
            return { rule: r, status: breach ? 'breach' : 'ok', value: v };
        });
    };

    // ═════════ analytics ═════════
    /** Monthly activity per account (displayed sign) for the last n periods → {code: [v...]} */
    FINE.series = function (data, scenario, codes, period, n, basis) {
        var pi = data._pi || (data._pi = FINE.periodIndex(data.periods)), i = pi.bySeq[period], out = {};
        var f = data.facts[scenario || 'ACTUAL'] || {}, byCode = {}; data.accounts.forEach(function (a) { byCode[a.code] = a; });
        codes.forEach(function (c) {
            var s = [], a = byCode[c], sg = a && FINE.isCredit(a) ? -1 : 1;
            for (var k = Math.max(0, i - n + 1); k <= i; k++) { var x = (f[c] || {})[pi.list[k].period_seq]; s.push(x ? (basis === 'balance' ? x[1] : x[0]) * sg : 0); }
            out[c] = s;
        });
        return out;
    };
    /** Accounts whose latest month is far from their own history. With 24+ months the comparison is seasonal: this month
        against the same month last year × the account's usual year-on-year growth, z = deviation of that ratio over the
        last 12 months (median ± 1.4826 × MAD); otherwise the median of the previous months. LEARNING when too little data. */
    FINE.anomalies = function (data, period, opts) {
        opts = opts || {};
        var codes = data.accounts.filter(function (a) { return FINE.isPl(a); }).map(function (a) { return a.code; });
        var S = FINE.series(data, 'ACTUAL', codes, period, 25), out = [];
        var names = {}; data.accounts.forEach(function (a) { names[a.code] = a; });
        codes.forEach(function (c) {
            var s = S[c], n = s.length, last = s[n - 1], typical, z;
            if (opts.seasonal !== false && n >= 24 && s[n - 13] !== 0) {
                var r = [];
                for (var k = n - 12; k < n - 1; k++) if (s[k - 12] && s[k]) r.push(s[k] / s[k - 12]);
                if (r.length < 8) return;
                var mr = median(r), madr = median(r.map(function (v) { return Math.abs(v - mr); })) * 1.4826 || Math.abs(mr) * 0.05 || 0.05;
                typical = s[n - 13] * mr;
                z = (last / s[n - 13] - mr) / madr;
            } else {
                var hist = s.slice(Math.max(0, n - 13), -1).filter(function (v) { return v !== 0; });
                if (hist.length < 6) return;
                var med = median(hist), mad = median(hist.map(function (v) { return Math.abs(v - med); })) * 1.4826 || Math.abs(med) * 0.05 || 1;
                typical = med; z = (last - med) / mad;
            }
            if (Math.abs(z) >= (opts.z || 3) && Math.abs(last - typical) >= (opts.minAmount || 0)) out.push({ code: c, name: names[c].name, class: names[c].class, value: last, typical: typical, z: z, change: last - typical, history: s.slice(-13) });
        });
        return out.sort(function (a, b) { return Math.abs(b.change) - Math.abs(a.change); });
    };
    function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; }
    FINE.median = median;

    /** Largest account movements between two windows (e.g. YTD vs PY YTD) → [{code, name, a, b, diff, pct}] */
    FINE.movers = function (data, period, colA, colB, filter) {
        var pi = data._pi || (data._pi = FINE.periodIndex(data.periods)), out = [];
        var wa = FINE.windowOf(colA, pi, period), wb = FINE.windowOf(colB, pi, period);
        data.accounts.forEach(function (a) {
            if (filter && !filter(a)) return;
            var basis = FINE.isPl(a) ? 'activity' : 'balance', sg = FINE.isCredit(a) ? -1 : 1;
            var va = amountOf((data.facts[colA.scenario || 'ACTUAL'] || {})[a.code], pi, wa, basis) * sg;
            var vb = amountOf((data.facts[colB.scenario || 'ACTUAL'] || {})[a.code], pi, wb, basis) * sg;
            if (Math.abs(va - vb) < 0.5) return;
            out.push({ code: a.code, name: a.name, class: a.class, type: a.account_type, a: va, b: vb, diff: va - vb, pct: vb ? (va - vb) / Math.abs(vb) * 100 : null });
        });
        return out.sort(function (x, y) { return Math.abs(y.diff) - Math.abs(x.diff); });
    };

    /** Bridge (waterfall) from one column to another through the rows listed: [{label, value, kind: start|step|end}] */
    FINE.bridge = function (stmt, fromCol, toCol, startRow, endRow, stepRows) {
        var ci = function (id) { return stmt.columns.map(function (c) { return c.id; }).indexOf(id); };
        var a = ci(fromCol), b = ci(toCol), row = function (id) { return stmt.rows.filter(function (r) { return r.id === id; })[0]; };
        var s = row(startRow), e = row(endRow);
        if (!s || !e || a < 0 || b < 0) return [];
        var out = [{ label: stmt.columns[a].label, value: s.values[a], kind: 'start' }], sum = s.values[a];
        stepRows.forEach(function (st) {
            var r = row(st.id); if (!r) return;
            var d = (r.values[b] - r.values[a]) * (st.sign || 1);
            sum += d; out.push({ label: st.label || r.label, value: d, kind: 'step' });
        });
        var other = e.values[b] - sum;
        if (Math.abs(other) > 0.0001 * Math.max(1, Math.abs(e.values[b]))) out.push({ label: 'Other', value: other, kind: 'step' });
        out.push({ label: stmt.columns[b].label, value: e.values[b], kind: 'end' });
        return out;
    };

    /** Holt-Winters additive (monthly, season 12) when there are 24+ points, else a linear trend → {fit, forecast[h]} */
    FINE.forecast = function (y, h, opts) {
        opts = opts || {};
        var n = y.length, out = [];
        if (n >= 24) {
            var m = 12, a = opts.alpha || 0.35, b = opts.beta || 0.08, g = opts.gamma || 0.3;
            var L = avg(y.slice(0, m)), T = (avg(y.slice(m, 2 * m)) - L) / m, S = [];
            for (var i = 0; i < m; i++) S[i] = y[i] - L;
            for (var t = 0; t < n; t++) {
                var Lp = L, s = S[t % m];
                L = a * (y[t] - s) + (1 - a) * (L + T);
                T = b * (L - Lp) + (1 - b) * T;
                S[t % m] = g * (y[t] - L) + (1 - g) * s;
            }
            for (var k = 1; k <= h; k++) out.push(L + k * T + S[(n + k - 1) % m]);
            return { method: 'Holt-Winters (seasonal)', forecast: out };
        }
        var xs = y.map(function (_, i) { return i; }), mx = avg(xs), my = avg(y), num = 0, den = 0;
        xs.forEach(function (x, i) { num += (x - mx) * (y[i] - my); den += (x - mx) * (x - mx); });
        var slope = den ? num / den : 0, icp = my - slope * mx;
        for (var j = 0; j < h; j++) out.push(icp + slope * (n + j));
        return { method: 'Linear trend', forecast: out };
    };
    function avg(a) { var s = 0; a.forEach(function (v) { s += v; }); return a.length ? s / a.length : 0; }

    /** Benford's law on first digits → {n, rows:[{d, expected, actual, count}], mad, verdict} (Nigrini's MAD bands). */
    FINE.benford = function (amounts) {
        var c = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], n = 0;
        amounts.forEach(function (v) { v = Math.abs(v); if (v < 10) return; var d = +String(v).replace(/^[0.]+/, '')[0]; if (d >= 1 && d <= 9) { c[d]++; n++; } });
        var rows = [], mad = 0;
        for (var d = 1; d <= 9; d++) { var e = Math.log10(1 + 1 / d), a = n ? c[d] / n : 0; mad += Math.abs(a - e); rows.push({ d: d, expected: e, actual: a, count: c[d] }); }
        mad /= 9;
        return { n: n, rows: rows, mad: mad, verdict: n < 100 ? 'too few amounts' : mad < 0.006 ? 'close conformity' : mad < 0.012 ? 'acceptable' : mad < 0.015 ? 'marginal' : 'nonconformity' };
    };

    /** Benford from first-digit counts {1: n1, …, 9: n9} (the database counts them) */
    FINE.benfordCounts = function (counts) {
        var n = 0, rows = [], mad = 0, d;
        for (d = 1; d <= 9; d++) n += +(counts[d] || 0);
        for (d = 1; d <= 9; d++) { var e = Math.log10(1 + 1 / d), a = n ? (counts[d] || 0) / n : 0; mad += Math.abs(a - e); rows.push({ d: d, expected: e, actual: a, count: +(counts[d] || 0) }); }
        mad /= 9;
        return { n: n, rows: rows, mad: mad, verdict: n < 100 ? 'too few amounts' : mad < 0.006 ? 'close conformity' : mad < 0.012 ? 'acceptable' : mad < 0.015 ? 'marginal' : 'nonconformity' };
    };

    /** What-if on the facts: drivers {revenuePct, cogsPts, opexPct, payrollPct, …} applied to ACTUAL movements from a period on → new data. */
    FINE.scenario = function (data, drivers, fromSeq) {
        var out = { accounts: data.accounts, periods: data.periods, facts: {} };
        Object.keys(data.facts).forEach(function (s) { out.facts[s] = data.facts[s]; });
        var act = data.facts.ACTUAL || {}, nf = {}, byCode = {};
        data.accounts.forEach(function (a) { byCode[a.code] = a; });
        var pi = data._pi || FINE.periodIndex(data.periods);
        Object.keys(act).forEach(function (code) {
            var a = byCode[code] || {}, f = act[code], g = {};
            var mult = 1;
            if (a.class === 'Revenue') mult = 1 + (drivers.revenuePct || 0) / 100;
            else if (a.class === 'Cost of sales') mult = (1 + (drivers.revenuePct || 0) / 100) * (1 + (drivers.cogsPct || 0) / 100);
            else if (a.class === 'Staff costs') mult = 1 + (drivers.payrollPct || 0) / 100;
            else if (a.account_type === 'E' && ['Depreciation & amortisation', 'Finance costs', 'Tax'].indexOf(a.class) < 0) mult = 1 + (drivers.opexPct || 0) / 100;
            else if (a.class === 'Finance costs') mult = 1 + (drivers.financePct || 0) / 100;
            var run = 0, started = false;
            pi.list.forEach(function (p) {
                var x = f[p.period_seq]; if (!x) return;
                var net = x[0];
                if (p.period_seq >= fromSeq && FINE.isPl(a)) { net = x[0] * mult; started = true; }
                if (!started) { run = x[1]; g[p.period_seq] = [x[0], x[1]]; return; }
                if (FINE.isPl(a) && p.period_num === 1) run = 0;
                run += net; g[p.period_seq] = [net, run];
            });
            nf[code] = g;
        });
        out.facts.SCENARIO = nf;
        out._pi = pi;
        return out;
    };

    /** Plain-language commentary from a computed statement: the biggest variances of the chosen columns. */
    FINE.narrative = function (stmt, colA, colB, opts) {
        opts = opts || {};
        var ia = stmt.columns.map(function (c) { return c.id; }).indexOf(colA), ib = stmt.columns.map(function (c) { return c.id; }).indexOf(colB);
        if (ia < 0 || ib < 0) return [];
        var fmt = opts.fmt || function (v) { return Math.round(v).toLocaleString(); };
        var lines = [];
        var key = (opts.keyRows || []).map(function (id) { return stmt.rows.filter(function (r) { return r.id === id; })[0]; }).filter(Boolean);
        key.forEach(function (r) {
            var a = r.values[ia], b = r.values[ib]; if (a == null || b == null) return;
            var d = a - b, pct = b ? d / Math.abs(b) * 100 : null, good = r.favourable === 'down' ? d <= 0 : d >= 0;
            lines.push({ tone: Math.abs(pct || 0) < 2 ? 'neutral' : good ? 'good' : 'bad', text: r.label + ' ' + fmt(a) + ' vs ' + fmt(b) + ' (' + (d >= 0 ? '+' : '') + fmt(d) + (pct != null ? ', ' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + ' %' : '') + ')' });
        });
        var movers = stmt.rows.filter(function (r) { return r.type === 'accounts' && r.values[ia] != null && r.values[ib] != null && !r.hidden; })
            .map(function (r) { var d = r.values[ia] - r.values[ib]; return { r: r, d: d, good: r.favourable === 'down' ? d <= 0 : d >= 0 }; })
            .sort(function (x, y) { return Math.abs(y.d) - Math.abs(x.d); }).slice(0, opts.top || 4);
        movers.forEach(function (m) {
            if (Math.abs(m.d) < 1e-9) return;
            lines.push({ tone: m.good ? 'good' : 'bad', text: m.r.label + (m.d > 0 ? ' up ' : ' down ') + fmt(Math.abs(m.d)) + (m.r.values[ib] ? ' (' + (m.d / Math.abs(m.r.values[ib]) * 100).toFixed(1) + ' %)' : '') + ' — ' + (m.good ? 'favourable' : 'unfavourable') });
        });
        return lines;
    };

    /** Facts from query rows [scenario, account, period_seq, net, end] */
    FINE.factsFrom = function (rows) {
        var f = {};
        rows.forEach(function (r) {
            var s = r[0], a = String(r[1]), p = +r[2];
            ((f[s] = f[s] || {})[a] = f[s][a] || {})[p] = [+r[3] || 0, +r[4] || 0];
        });
        return f;
    };

    /** Number formatting used by the page and the board pack. */
    FINE.fmt = function (v, format, opts) {
        opts = opts || {};
        if (v == null || isNaN(v)) return '';
        if (format === 'pct') return (Math.abs(v) < 0.05 ? '0.0' : v.toFixed(1)) + '%';
        if (format === 'ratio') return v.toFixed(2) + '×';
        if (format === 'days') return Math.round(v) + ' d';
        var d = opts.decimals != null ? opts.decimals : 0, a = Math.abs(v);
        if (a < Math.pow(10, -d) / 2) return opts.zero != null ? opts.zero : '–';
        var s = a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
        return v < 0 ? (opts.paren === false ? '-' + s : '(' + s + ')') : s;
    };

    // ── chart of accounts from Fusion: a class per account, and statement templates built on those classes ──
    /** The classes the auto templates use, by account type (the first one is the fallback). */
    FINE.CLASSES = {
        A: ['Other current assets', 'Cash', 'Receivables', 'Inventory', 'Fixed assets', 'Accumulated depreciation', 'Intangibles', 'Intercompany', 'Suspense'],
        L: ['Other liabilities', 'Payables', 'Accruals', 'Tax liabilities', 'Borrowings', 'Long-term borrowings', 'Leases', 'Intercompany'],
        O: ['Share capital', 'Retained earnings'],
        R: ['Revenue', 'Other income'],
        E: ['Administration', 'Cost of sales', 'Staff costs', 'Premises', 'Distribution', 'Selling', 'Depreciation & amortisation', 'Finance costs', 'Tax']
    };
    var RULES = {
        A: [[/suspense|clearing|unallocated|unidentified|holding acc/i, 'Suspense'], [/inter.?co|due from (related|group)|related part/i, 'Intercompany'],
            [/accum|provision for dep|depreciation|amorti[sz]ation|impairment/i, 'Accumulated depreciation'],
            [/\bcash\b|bank|petty|deposit acc|call acc|cash equiv/i, 'Cash'], [/receivable|debtor|allowance|doubtful|unbilled|customer/i, 'Receivables'],
            [/inventor|stock|\bwip\b|work in progress|raw material|finished goods|goods in transit|consign/i, 'Inventory'],
            [/goodwill|intangib|software|licen[cs]e|patent|trademark|development cost/i, 'Intangibles'],
            [/property|plant|equipment|\bppe\b|building|land|vehicle|motor|furniture|fixture|machiner|computer|leasehold|right.of.use|\brou\b|capital work|construction in progress|\bcwip\b|asset/i, 'Fixed assets']],
        L: [[/inter.?co|due to (related|group)|related part/i, 'Intercompany'], [/lease liab|lease oblig|finance lease/i, 'Leases'],
            [/(long.term|non.current).*(loan|borrow|debt|note)|(loan|borrow|debt).*(long.term|non.current)|term loan|debenture|bond/i, 'Long-term borrowings'],
            [/loan|borrow|overdraft|credit facility|revolv|short.term debt/i, 'Borrowings'],
            [/\bvat\b|\bgst\b|sales tax|withholding|income tax|tax payable|tax liab|deferred tax|\btax\b/i, 'Tax liabilities'],
            [/accru|payroll|salar|wage|deferred (income|revenue)|unearned|provision|bonus|pension|employee|social sec/i, 'Accruals'],
            [/payable|creditor|supplier|vendor|\bgrni\b|received not invoiced|uninvoiced/i, 'Payables']],
        O: [[/retained|accumulated (profit|earning|loss)|reserve|profit and loss|p&l|current year (profit|earning)|dividend/i, 'Retained earnings']],
        R: [[/other income|interest income|investment income|dividend income|gain|sundry income|misc|rental income|exchange gain/i, 'Other income']],
        E: [[/depreci|amorti[sz]/i, 'Depreciation & amortisation'],
            [/salar|wage|payroll|staff|employee|bonus|pension|benefit|social sec|overtime|recruit|training|medical|gratuit|commission to staff/i, 'Staff costs'],
            [/income tax|tax expense|deferred tax|corporate tax|\bcit\b/i, 'Tax'],
            [/interest|bank charge|finance (cost|charge)|exchange|forex|\bfx\b|loan fee/i, 'Finance costs'],
            [/cost of (goods|sales|revenue)|\bcogs\b|purchases?\b|material|freight in|import dut|landed|inventory (adj|write|loss|variance)|shrink|cost variance|production/i, 'Cost of sales'],
            [/\brent|lease expense|utilit|electric|water|repair|maint|premis|building|cleaning|security|property tax|rates/i, 'Premises'],
            [/freight|deliver|transport|vehicle|fuel|distribution|logistic|shipping|courier|warehous/i, 'Distribution'],
            [/market|advert|promot|commission|selling|sponsor|bad debt|doubtful|discount allowed|merchand/i, 'Selling']]
    };
    /** The class of an account from its type and name: {code, name, account_type} → 'Staff costs' … */
    FINE.classify = function (a) {
        var t = a.account_type, name = String(a.name || '');
        var list = RULES[t];
        if (!list) return t === 'L' ? 'Other liabilities' : 'Other current assets';
        for (var i = 0; i < list.length; i++) if (list[i][0].test(name)) return list[i][1];
        return FINE.CLASSES[t][0];
    };

    /** PL, PLS, BS and CF on account classes (works on any chart of accounts) — same row ids as the starters, so KPIs keep working. */
    FINE.autoTemplates = function () {
        var B = { bold: true }, T = { bold: true, topBorder: true }, TT = { bold: true, topBorder: true, doubleBottom: true }, I = { italic: true, muted: true }, H = { italic: true, bold: true };
        var cls = function (c, type) { var o = { class: [].concat(c) }; if (type) o.type = type; return o; };
        var MG = [
            { id: 'm_act', scenario: 'ACTUAL', range: 'MTD' }, { id: 'm_bud', scenario: 'BUDGET', range: 'MTD' }, { id: 'm_var', kind: 'var', a: 'm_act', b: 'm_bud', label: 'Var F/(U)' },
            { id: 'y_act', scenario: 'ACTUAL', range: 'YTD' }, { id: 'y_bud', scenario: 'BUDGET', range: 'YTD' }, { id: 'y_var', kind: 'var', a: 'y_act', b: 'y_bud', label: 'Var F/(U)' },
            { id: 'y_varp', kind: 'var', a: 'y_act', b: 'y_bud', mode: 'pct', label: 'Var %' }, { id: 'y_py', scenario: 'ACTUAL', range: 'YTD', at: 'PY' }, { id: 'y_pyp', kind: 'var', a: 'y_act', b: 'y_py', mode: 'pct', label: 'vs PY %' }];
        var PL = { id: 'PL', name: 'Income statement — management', type: 'PL', scale: 1000, columns: MG, auto: true,
            description: 'Built from your chart of accounts by account class (Data › Account mapping).',
            rows: [
                { id: 'REV', type: 'accounts', label: 'Net revenue', accounts: cls('Revenue', 'R'), sign: 'credit', style: T },
                { id: 'COGS', type: 'accounts', label: 'Cost of sales', accounts: cls('Cost of sales', 'E'), favourable: 'down' },
                { id: 'GP', type: 'formula', label: 'Gross profit', formula: 'REV - COGS', style: TT },
                { id: 'GM', type: 'formula', label: 'Gross margin', formula: 'PCT(GP, REV)', format: 'pct', style: I },
                { id: 'B1', type: 'blank' }, { id: 'H_OPEX', type: 'header', label: 'Operating expenses', style: B },
                { id: 'STAFF', type: 'accounts', label: 'Staff costs', accounts: cls('Staff costs', 'E'), parent: 'OPEX', level: 1, favourable: 'down' },
                { id: 'PREM', type: 'accounts', label: 'Premises & maintenance', accounts: cls('Premises', 'E'), parent: 'OPEX', level: 1, favourable: 'down' },
                { id: 'DIST', type: 'accounts', label: 'Distribution', accounts: cls('Distribution', 'E'), parent: 'OPEX', level: 1, favourable: 'down' },
                { id: 'SELL', type: 'accounts', label: 'Selling & marketing', accounts: cls('Selling', 'E'), parent: 'OPEX', level: 1, favourable: 'down' },
                { id: 'ADMIN', type: 'accounts', label: 'Administration & other', accounts: cls(['Administration', 'Other expenses'], 'E'), parent: 'OPEX', level: 1, favourable: 'down' },
                { id: 'OPEX', type: 'group', label: 'Total operating expenses', style: T, favourable: 'down' },
                { id: 'OI', type: 'accounts', label: 'Other income', accounts: cls('Other income', 'R'), sign: 'credit' },
                { id: 'EBITDA', type: 'formula', label: 'EBITDA', formula: 'GP - OPEX + OI', style: TT },
                { id: 'EBITDAM', type: 'formula', label: 'EBITDA margin', formula: 'PCT(EBITDA, REV)', format: 'pct', style: I },
                { id: 'DA', type: 'accounts', label: 'Depreciation & amortisation', accounts: cls('Depreciation & amortisation', 'E'), favourable: 'down' },
                { id: 'EBIT', type: 'formula', label: 'Operating profit (EBIT)', formula: 'EBITDA - DA', style: T },
                { id: 'FIN', type: 'accounts', label: 'Finance costs', accounts: cls('Finance costs', 'E'), favourable: 'down' },
                { id: 'PBT', type: 'formula', label: 'Profit before tax', formula: 'EBIT - FIN', style: T },
                { id: 'TAX', type: 'accounts', label: 'Income tax', accounts: cls('Tax', 'E'), favourable: 'down' },
                { id: 'NP', type: 'formula', label: 'Net profit', formula: 'PBT - TAX', style: TT },
                { id: 'NPM', type: 'formula', label: 'Net margin', formula: 'PCT(NP, REV)', format: 'pct', style: I }] };
        var PLS = { id: 'PLS', name: 'Income statement — statutory (by function)', type: 'PL', scale: 1000, auto: true,
            description: 'This year to date against last year, by function.',
            columns: [{ id: 'cy', scenario: 'ACTUAL', range: 'YTD' }, { id: 'py', scenario: 'ACTUAL', range: 'YTD', at: 'PY' }, { id: 'ch', kind: 'var', a: 'cy', b: 'py', label: 'Change' }, { id: 'chp', kind: 'var', a: 'cy', b: 'py', mode: 'pct', label: 'Change %' }],
            rows: [
                { id: 'REV', type: 'accounts', label: 'Revenue', accounts: cls('Revenue', 'R'), sign: 'credit', style: B },
                { id: 'COS', type: 'accounts', label: 'Cost of sales', accounts: cls('Cost of sales', 'E'), favourable: 'down' },
                { id: 'GP', type: 'formula', label: 'Gross profit', formula: 'REV - COS', style: T },
                { id: 'OI', type: 'accounts', label: 'Other income', accounts: cls('Other income', 'R'), sign: 'credit' },
                { id: 'DIST', type: 'accounts', label: 'Distribution and selling costs', accounts: cls(['Distribution', 'Selling'], 'E'), favourable: 'down' },
                { id: 'ADM', type: 'accounts', label: 'Administrative expenses', accounts: cls(['Staff costs', 'Premises', 'Administration', 'Other expenses', 'Depreciation & amortisation'], 'E'), favourable: 'down' },
                { id: 'OP', type: 'formula', label: 'Operating profit', formula: 'GP + OI - DIST - ADM', style: T },
                { id: 'FIN', type: 'accounts', label: 'Finance costs', accounts: cls('Finance costs', 'E'), favourable: 'down' },
                { id: 'PBT', type: 'formula', label: 'Profit before tax', formula: 'OP - FIN', style: T },
                { id: 'TAX', type: 'accounts', label: 'Income tax expense', accounts: cls('Tax', 'E'), favourable: 'down' },
                { id: 'NP', type: 'formula', label: 'Profit for the period', formula: 'PBT - TAX', style: TT }] };
        var BS = { id: 'BS', name: 'Statement of financial position', type: 'BS', scale: 1000, auto: true,
            description: 'Balance sheet at the period end against last month and the last year end, with a balance check.',
            columns: [{ id: 'cur', scenario: 'ACTUAL', range: 'BAL' }, { id: 'pm', scenario: 'ACTUAL', range: 'BAL', at: 'PM' }, { id: 'pye', scenario: 'ACTUAL', range: 'BAL', at: 'PYE' }, { id: 'ch', kind: 'var', a: 'cur', b: 'pye', label: 'Change vs YE' }],
            rows: [
                { id: 'H_A', type: 'header', label: 'ASSETS', style: B }, { id: 'H_NCA', type: 'header', label: 'Non-current assets', style: H },
                { id: 'PPE', type: 'accounts', label: 'Property, plant & equipment (net)', accounts: cls(['Fixed assets', 'Accumulated depreciation'], 'A'), parent: 'NCA', level: 1 },
                { id: 'INT', type: 'accounts', label: 'Intangible assets', accounts: cls('Intangibles', 'A'), parent: 'NCA', level: 1 },
                { id: 'NCA', type: 'group', label: 'Total non-current assets', parent: 'TA', style: T },
                { id: 'H_CA', type: 'header', label: 'Current assets', style: H },
                { id: 'INV', type: 'accounts', label: 'Inventories', accounts: cls('Inventory', 'A'), parent: 'CA', level: 1 },
                { id: 'AR', type: 'accounts', label: 'Trade receivables (net)', accounts: cls('Receivables', 'A'), parent: 'CA', level: 1 },
                { id: 'OCA', type: 'accounts', label: 'Prepayments, intercompany & other receivables', accounts: cls(['Other current assets', 'Intercompany'], 'A'), parent: 'CA', level: 1 },
                { id: 'SUSP', type: 'accounts', label: 'Suspense / unallocated', accounts: cls('Suspense', 'A'), parent: 'CA', level: 1, note: 'Should be nil at month end' },
                { id: 'CASH', type: 'accounts', label: 'Cash and cash equivalents', accounts: cls('Cash', 'A'), parent: 'CA', level: 1 },
                { id: 'CA', type: 'group', label: 'Total current assets', parent: 'TA', style: T },
                { id: 'TA', type: 'group', label: 'TOTAL ASSETS', style: TT }, { id: 'B1', type: 'blank' },
                { id: 'H_EL', type: 'header', label: 'EQUITY AND LIABILITIES', style: B },
                { id: 'SC', type: 'accounts', label: 'Share capital & reserves', accounts: cls('Share capital', 'O'), parent: 'EQ', level: 1 },
                { id: 'RE', type: 'accounts', label: 'Retained earnings', accounts: cls('Retained earnings', 'O'), parent: 'EQ', level: 1 },
                { id: 'CYE', type: 'accounts', label: 'Profit for the year to date', accounts: { type: 'RE' }, basis: 'balance', sign: 'credit', parent: 'EQ', level: 1 },
                { id: 'EQ', type: 'group', label: 'Total equity', parent: 'TEL', style: T },
                { id: 'H_NCL', type: 'header', label: 'Non-current liabilities', style: H },
                { id: 'LOANS', type: 'accounts', label: 'Long-term borrowings', accounts: cls('Long-term borrowings', 'L'), parent: 'NCL', level: 1 },
                { id: 'LEASE', type: 'accounts', label: 'Lease liabilities', accounts: cls('Leases', 'L'), parent: 'NCL', level: 1 },
                { id: 'NCL', type: 'group', label: 'Total non-current liabilities', parent: 'TL', style: T },
                { id: 'H_CL', type: 'header', label: 'Current liabilities', style: H },
                { id: 'AP', type: 'accounts', label: 'Trade payables', accounts: cls('Payables', 'L'), parent: 'CL', level: 1 },
                { id: 'ACCR', type: 'accounts', label: 'Accruals & other payables', accounts: cls(['Accruals', 'Other liabilities'], 'L'), parent: 'CL', level: 1 },
                { id: 'TAXL', type: 'accounts', label: 'Tax liabilities', accounts: cls('Tax liabilities', 'L'), parent: 'CL', level: 1 },
                { id: 'ICP', type: 'accounts', label: 'Intercompany payables', accounts: cls('Intercompany', 'L'), parent: 'CL', level: 1 },
                { id: 'STB', type: 'accounts', label: 'Short-term borrowings', accounts: cls('Borrowings', 'L'), parent: 'CL', level: 1 },
                { id: 'CL', type: 'group', label: 'Total current liabilities', parent: 'TL', style: T },
                { id: 'TL', type: 'group', label: 'Total liabilities', parent: 'TEL', style: T },
                { id: 'TEL', type: 'group', label: 'TOTAL EQUITY AND LIABILITIES', style: TT },
                { id: 'CHK', type: 'check', label: 'Check: assets − equity and liabilities', formula: 'TA - TEL', style: I }] };
        var ch = function (id, label, c, type, parent) { return { id: id, type: 'accounts', label: label, accounts: cls(c, type), basis: 'change', sign: 'credit', parent: parent, level: 1 }; };
        var CF = { id: 'CF', name: 'Statement of cash flows — indirect', type: 'CF', scale: 1000, auto: true,
            description: 'Built from the balance sheet movements by account class — ties to the cash balance.',
            columns: [{ id: 'm', scenario: 'ACTUAL', range: 'MTD' }, { id: 'q', scenario: 'ACTUAL', range: 'QTD' }, { id: 'y', scenario: 'ACTUAL', range: 'YTD' }, { id: 'l', scenario: 'ACTUAL', range: 'LTM' }],
            rows: [
                { id: 'H_OP', type: 'header', label: 'Cash flows from operating activities', style: B },
                { id: 'NP', type: 'accounts', label: 'Profit for the period', accounts: { type: 'RE' }, basis: 'activity', sign: 'credit', parent: 'OPC', level: 1 },
                ch('DA', 'Depreciation & amortisation (non-cash)', 'Accumulated depreciation', 'A', 'OPC'),
                ch('WC_AR', '(Increase) / decrease in receivables', 'Receivables', 'A', 'OPC'),
                ch('WC_INV', '(Increase) / decrease in inventories', 'Inventory', 'A', 'OPC'),
                ch('WC_OTH', '(Increase) / decrease in other receivables', ['Other current assets', 'Intercompany', 'Suspense'], 'A', 'OPC'),
                ch('WC_AP', 'Increase / (decrease) in trade payables', 'Payables', 'L', 'OPC'),
                ch('WC_ACC', 'Increase / (decrease) in accruals, taxes & other payables', ['Accruals', 'Other liabilities', 'Tax liabilities', 'Intercompany'], 'L', 'OPC'),
                { id: 'OPC', type: 'group', label: 'Net cash from operating activities', style: T }, { id: 'B1', type: 'blank' },
                { id: 'H_INV', type: 'header', label: 'Cash flows from investing activities', style: B },
                ch('CAPEX', 'Purchase of fixed and intangible assets', ['Fixed assets', 'Intangibles'], 'A', 'INVC'),
                { id: 'INVC', type: 'group', label: 'Net cash used in investing activities', style: T }, { id: 'B2', type: 'blank' },
                { id: 'H_FIN', type: 'header', label: 'Cash flows from financing activities', style: B },
                ch('BORR', 'Borrowings drawn / (repaid)', ['Borrowings', 'Long-term borrowings'], 'L', 'FINC'),
                ch('LEASEP', 'Lease payments', 'Leases', 'L', 'FINC'),
                ch('EQT', 'Share capital issued', 'Share capital', 'O', 'FINC'),
                { id: 'FINC', type: 'group', label: 'Net cash from financing activities', style: T }, { id: 'B3', type: 'blank' },
                { id: 'NET', type: 'formula', label: 'Net increase / (decrease) in cash', formula: 'OPC + INVC + FINC', style: T },
                { id: 'OPEN', type: 'accounts', label: 'Cash at the beginning of the period', accounts: cls('Cash', 'A'), basis: 'opening', sign: 'debit' },
                { id: 'CLOSE', type: 'formula', label: 'Cash at the end of the period', formula: 'OPEN + NET', style: TT },
                { id: 'BOOK', type: 'accounts', label: 'Cash per balance sheet', accounts: cls('Cash', 'A'), basis: 'balance', sign: 'debit', style: I },
                { id: 'CHK', type: 'check', label: 'Check: cash flow ties to the bank balance', formula: 'CLOSE - BOOK', style: I },
                { id: 'B4', type: 'blank' },
                { id: 'FCF', type: 'formula', label: 'Free cash flow (operating + investing)', formula: 'OPC + INVC', style: B }] };
        return [PL, PLS, BS, CF];
    };

    // ── simple templates: main groups → sections → accounts (what a finance user thinks in), compiled to template rows ──
    // simple = { kind: 'PL' | 'BS', lines: [ {t: 'group', id, name, nature: income|expense|asset|liability|equity,
    //   sections: [{id, name, accounts: [codes], match: '5011*, 5012*', special: 'cye', cls: [hint classes]}]},
    //   {t: 'subtotal', id, name, of: [group ids] | null (PL: everything above; BS: the groups since the last subtotal), margin} ] }
    var NATURE_TYPE = { income: 'R', expense: 'E', asset: 'A', liability: 'L', equity: 'O' };
    var TYPE_NATURE = { R: 'income', E: 'expense', A: 'asset', L: 'liability', O: 'equity' };
    FINE.NATURES = ['income', 'expense', 'asset', 'liability', 'equity'];
    var RESERVED = { PCT: 1, DIV: 1, IF: 1, ABS: 1, MIN: 1, MAX: 1, SUM: 1, AVG: 1, ROUND: 1, NEG: 1 };

    /** Account type from the name and code when Fusion gave none ("PL EXP - SALARIES" → E; 1… A, 2… L, 3… O, 4… R, 5-9… E). */
    FINE.guessType = function (a) {
        var n = String(a.name || '').toUpperCase(), c = String(a.code || '');
        var pl = /(^|[^A-Z])(PL|P\s*&\s*L|P\/L)([^A-Z]|$)|PROFIT AND LOSS|INCOME STATEMENT/.test(n);
        if (/INCOME TAX|TAX EXPENSE/.test(n)) return 'E';
        if (/REVENUE|TURNOVER|\bSALES\b(?! (TAX|RETURN))|\bINCOME\b|\bREV\b|GAIN/.test(n) && !/COST OF|EXPENSE|\bEXP\b/.test(n)) return 'R';
        if (/EXPENSE|\bEXP\b|\bCOST\b|COSTS|SALAR|WAGE|\bRENT\b|DEPRECIATION EXP|CHARGES|FEES PAID|UTILIT/.test(n) && !/ACCRU|PAYABLE|PREPAID|PREPAY/.test(n)) return 'E';
        if (pl) return /REV|INCOME|SALES/.test(n) ? 'R' : 'E';
        if (/PAYABLE|ACCRU|\bLOAN|BORROW|OVERDRAFT|PROVISION|DEFERRED (INCOME|REVENUE)|CREDITOR/.test(n)) return 'L';
        if (/SHARE CAPITAL|RETAINED|RESERVE|EQUITY|CAPITAL ACCOUNT/.test(n)) return 'O';
        if (/RECEIVABLE|\bCASH\b|\bBANK|INVENTOR|STOCK|PREPAID|PREPAY|DEPOSIT|ASSET|EQUIPMENT|DEBTOR|ACCUM/.test(n)) return 'A';
        var d = c.replace(/\D/g, '').charAt(0);
        return { 1: 'A', 2: 'L', 3: 'O', 4: 'R', 5: 'E', 6: 'E', 7: 'E', 8: 'E', 9: 'E' }[d] || 'E';
    };
    /** A formula-safe id from a name, unique among `used` */
    FINE.simpleId = function (name, used) {
        var b = String(name || 'LINE').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'LINE';
        if (/^\d/.test(b) || RESERVED[b] || /^H_/.test(b)) b = 'L_' + b;
        var id = b, i = 2;
        while (used[id]) id = b + '_' + (i++);
        used[id] = 1;
        return id;
    };
    FINE.simpleIds = function (s) { var u = {}; (s.lines || []).forEach(function (l) { u[l.id] = 1; u['H_' + l.id] = 1; (l.sections || []).forEach(function (x) { u[x.id] = 1; }); }); u.CHK = 1; return u; };

    var DEF = {
        PL: [['g', 'REV', 'Revenue', 'income', [['REV_S', 'Revenue', ['Revenue']]]],
            ['g', 'COGS', 'Cost of sales', 'expense', [['COGS_S', 'Cost of sales', ['Cost of sales']]]],
            ['s', 'GP', 'Gross profit', 1],
            ['g', 'OPEX', 'Operating expenses', 'expense', [['STAFF', 'Staff costs', ['Staff costs']], ['PREM', 'Premises & maintenance', ['Premises']], ['DIST', 'Distribution', ['Distribution']],
                ['SELL', 'Selling & marketing', ['Selling']], ['ADMIN', 'Administration & other', ['Administration', 'Other expenses']]]],
            ['g', 'OI', 'Other income', 'income', [['OI_S', 'Other income', ['Other income']]]],
            ['s', 'EBITDA', 'EBITDA', 1],
            ['g', 'DA', 'Depreciation & amortisation', 'expense', [['DA_S', 'Depreciation & amortisation', ['Depreciation & amortisation']]]],
            ['s', 'EBIT', 'Operating profit (EBIT)'],
            ['g', 'FIN', 'Finance costs', 'expense', [['FIN_S', 'Finance costs', ['Finance costs']]]],
            ['s', 'PBT', 'Profit before tax'],
            ['g', 'TAX', 'Income tax', 'expense', [['TAX_S', 'Income tax', ['Tax']]]],
            ['s', 'NP', 'Net profit', 1]],
        BS: [['g', 'NCA', 'Non-current assets', 'asset', [['PPE', 'Property, plant & equipment (net)', ['Fixed assets', 'Accumulated depreciation']], ['INT', 'Intangible assets', ['Intangibles']]]],
            ['g', 'CA', 'Current assets', 'asset', [['INV', 'Inventories', ['Inventory']], ['AR', 'Trade receivables', ['Receivables']], ['OCA', 'Prepayments & other receivables', ['Other current assets', 'Intercompany']],
                ['SUSP', 'Suspense / unallocated', ['Suspense']], ['CASH', 'Cash and cash equivalents', ['Cash']]]],
            ['s', 'TA', 'Total assets'],
            ['g', 'EQ', 'Equity', 'equity', [['SC', 'Share capital & reserves', ['Share capital']], ['RE', 'Retained earnings', ['Retained earnings']], ['CYE', 'Profit for the year to date', null, 'cye']]],
            ['g', 'NCL', 'Non-current liabilities', 'liability', [['LOANS', 'Long-term borrowings', ['Long-term borrowings']], ['LEASE', 'Lease liabilities', ['Leases']]]],
            ['g', 'CL', 'Current liabilities', 'liability', [['AP', 'Trade payables', ['Payables']], ['ACCR', 'Accruals & other payables', ['Accruals', 'Other liabilities']], ['TAXL', 'Tax liabilities', ['Tax liabilities']],
                ['ICP', 'Intercompany payables', ['Intercompany']], ['STB', 'Short-term borrowings', ['Borrowings']]]],
            ['s', 'TEL', 'Total equity and liabilities']]
    };
    var natureOk = function (nature, a) { return NATURE_TYPE[nature] === a.account_type; };
    FINE.simpleKindOf = function (a) { return a.account_type === 'R' || a.account_type === 'E' ? 'PL' : 'BS'; };

    /** The default structure for PL or BS, every account of that kind placed by its type + class (FINE.classify). */
    FINE.simpleDefault = function (kind, accounts) {
        var s = { kind: kind, auto: true, lines: DEF[kind].map(function (d) {
            if (d[0] === 's') return { t: 'subtotal', id: d[1], name: d[2], of: null, margin: !!d[3] };
            return { t: 'group', id: d[1], name: d[2], nature: d[3], sections: d[4].map(function (x) { var o = { id: x[0], name: x[1], accounts: [], cls: x[2] || [] }; if (x[3]) o.special = x[3]; return o; }) };
        }) };
        FINE.simplePlace(s, accounts, (accounts || []).filter(function (a) { return FINE.simpleKindOf(a) === kind; }).map(function (a) { return a.code; }));
        return s;
    };
    /** Account codes this structure maps: {code: [section ids]} */
    FINE.simpleMapped = function (s, accounts) {
        var m = {};
        (s.lines || []).forEach(function (l) {
            (l.sections || []).forEach(function (x) {
                if (x.special) return;
                var codes = (x.accounts || []).slice();
                if (x.match && accounts) codes = codes.concat(FINE.matchAccounts(x.match, accounts));
                codes.forEach(function (c) { var a = m[c] = m[c] || []; if (a.indexOf(x.id) < 0) a.push(x.id); });
            });
        });
        return m;
    };
    /** Accounts of this kind in no section, and accounts in two or more sections */
    FINE.simpleCheck = function (s, accounts) {
        var m = FINE.simpleMapped(s, accounts), kind = s.kind || 'PL';
        return { unmapped: accounts.filter(function (a) { return FINE.simpleKindOf(a) === kind && !m[a.code]; }),
            twice: accounts.filter(function (a) { return m[a.code] && m[a.code].length > 1; }),
            mapped: accounts.filter(function (a) { return m[a.code]; }).length };
    };
    /** Places accounts: the section whose hint classes or existing accounts share the account's class (same nature), else the first
        section of a group with the account's nature, else a new group "Other …". Returns how many were placed. */
    FINE.simplePlace = function (s, accounts, codes) {
        var byCode = {}; (accounts || []).forEach(function (a) { byCode[a.code] = a; });
        var used = FINE.simpleIds(s), n = 0, clsOf = {};
        (s.lines || []).forEach(function (l) { (l.sections || []).forEach(function (x) { (x.accounts || []).forEach(function (c) { var a = byCode[c]; if (a && a.class) { var k = l.nature + '|' + a.class; (clsOf[k] = clsOf[k] || {})[x.id] = ((clsOf[k] || {})[x.id] || 0) + 1; } }); }); });
        var secById = {}; (s.lines || []).forEach(function (l) { (l.sections || []).forEach(function (x) { secById[x.id] = { l: l, x: x }; }); });
        (codes || []).forEach(function (c) {
            var a = byCode[c]; if (!a) return;
            var target = null;
            (s.lines || []).some(function (l) {
                if (l.t !== 'group' || !natureOk(l.nature, a)) return false;
                return (l.sections || []).some(function (x) { if (!x.special && (x.cls || []).indexOf(a.class) >= 0) { target = x; return true; } return false; });
            });
            if (!target) {
                var votes = clsOf[TYPE_NATURE[a.account_type] + '|' + a.class], best = 0;
                Object.keys(votes || {}).forEach(function (id) { if (votes[id] > best) { best = votes[id]; target = secById[id].x; } });
            }
            if (!target) (s.lines || []).some(function (l) { if (l.t === 'group' && natureOk(l.nature, a)) { target = (l.sections || []).filter(function (x) { return !x.special; })[0]; } return !!target; });
            if (!target) {
                var nat = TYPE_NATURE[a.account_type] || 'expense', name = 'Other ' + nat + (nat === 'income' || nat === 'equity' ? '' : 's');
                var g = { t: 'group', id: FINE.simpleId(name, used), name: name.charAt(0).toUpperCase() + name.slice(1), nature: nat, sections: [] };
                target = { id: FINE.simpleId(g.name + ' S', used), name: g.name, accounts: [] };
                g.sections.push(target);
                var at = s.lines.length; if (s.kind === 'PL') { for (var i = s.lines.length - 1; i >= 0; i--) if (s.lines[i].t === 'subtotal') { at = i; break; } }
                s.lines.splice(at, 0, g);
                secById[target.id] = { l: g, x: target };
            }
            (target.accounts = target.accounts || []).push(c); n++;
        });
        (s.lines || []).forEach(function (l) { (l.sections || []).forEach(function (x) { if (x.accounts) x.accounts.sort(); }); });
        return n;
    };
    /** Groups a subtotal adds up (ids) */
    FINE.simpleOf = function (s, ix) {
        var l = s.lines[ix];
        if (l.of && l.of.length) return l.of.slice();
        var out = [];
        for (var i = ix - 1; i >= 0; i--) {
            var x = s.lines[i];
            if (x.t === 'subtotal') { if (s.kind === 'BS') break; continue; }
            out.unshift(x.id);
        }
        return out;
    };
    /** simple → template rows (ids stay as written so KPIs like PL.REV / BS.CASH keep working) */
    FINE.simpleCompile = function (s) {
        var B = { bold: true }, T = { bold: true, topBorder: true }, TT = { bold: true, topBorder: true, doubleBottom: true }, I = { italic: true, muted: true };
        var rows = [], pl = s.kind !== 'BS', basis = pl ? 'activity' : 'balance', natOf = {}, lines = s.lines || [];
        var firstIncome = (lines.filter(function (l) { return l.t === 'group' && l.nature === 'income'; })[0] || {}).id;
        lines.forEach(function (l) { if (l.t === 'group') natOf[l.id] = l.nature; });
        var lastSub = -1; lines.forEach(function (l, i) { if (l.t === 'subtotal') lastSub = i; });
        lines.forEach(function (l, ix) {
            if (l.t === 'group') {
                var sign = l.nature === 'income' || l.nature === 'liability' || l.nature === 'equity' ? 'credit' : 'debit', fav = l.nature === 'expense' ? 'down' : undefined;
                var spec = function (x) { return x.special === 'cye' ? { type: 'RE' } : (x.accounts || []).concat(x.match ? String(x.match).split(/[,;\n]+/).map(function (p) { return p.trim(); }).filter(Boolean) : []); };
                var secs = l.sections || [];
                var row = function (x, extra) { var r = { id: x.id, type: 'accounts', label: x.name, accounts: spec(x), basis: x.special === 'cye' ? 'balance' : basis, sign: x.special === 'cye' ? 'credit' : sign }; if (fav) r.favourable = fav; return Object.assign(r, extra || {}); };
                if (secs.length === 1 && !secs[0].special) rows.push(row({ id: l.id, name: l.name, accounts: secs[0].accounts, match: secs[0].match }, { style: B }));
                else {
                    rows.push({ id: 'H_' + l.id, type: 'header', label: l.name, style: B });
                    secs.forEach(function (x) { rows.push(row(x, { parent: l.id, level: 1 })); });
                    var g = { id: l.id, type: 'group', label: 'Total ' + l.name.charAt(0).toLowerCase() + l.name.slice(1), style: T }; if (fav) g.favourable = fav;
                    rows.push(g);
                }
            } else if (l.t === 'subtotal') {
                var of = FINE.simpleOf(s, ix);
                var f = of.map(function (id, i) { var neg = pl && natOf[id] === 'expense'; return (neg ? (i ? ' - ' : '-') : (i ? ' + ' : '')) + id; }).join('') || '0';
                rows.push({ id: l.id, type: 'formula', label: l.name, formula: f, style: ix === lastSub ? TT : T });
                if (pl && l.margin && firstIncome) rows.push({ id: l.id + '_M', type: 'formula', label: l.name + ' margin', formula: 'PCT(' + l.id + ', ' + firstIncome + ')', format: 'pct', style: I });
                if (!pl && ix < lines.length - 1) rows.push({ id: 'B_' + l.id, type: 'blank' });
            }
        });
        if (!pl) {
            var a = lines.filter(function (l) { return l.t === 'group' && l.nature === 'asset'; }).map(function (l) { return l.id; });
            var o = lines.filter(function (l) { return l.t === 'group' && l.nature !== 'asset'; }).map(function (l) { return l.id; });
            if (a.length && o.length) rows.push({ id: 'CHK', type: 'check', label: 'Check: assets − equity and liabilities', formula: '(' + a.join(' + ') + ') - (' + o.join(' + ') + ')', style: I });
        }
        return rows;
    };

    /** Column sets a simple template can use */
    FINE.COLSETS = {
        PL: [{ id: 'month_ytd', label: 'Month · YTD · last year', cols: [{ id: 'm', scenario: 'ACTUAL', range: 'MTD' }, { id: 'y', scenario: 'ACTUAL', range: 'YTD' }, { id: 'py', scenario: 'ACTUAL', range: 'YTD', at: 'PY', label: 'YTD last year' }, { id: 'ch', kind: 'var', a: 'y', b: 'py', mode: 'pct', label: 'vs last year %' }] },
            { id: 'budget', label: 'Month & YTD vs budget', cols: [{ id: 'm_act', scenario: 'ACTUAL', range: 'MTD' }, { id: 'm_bud', scenario: 'BUDGET', range: 'MTD' }, { id: 'm_var', kind: 'var', a: 'm_act', b: 'm_bud', label: 'Var F/(U)' },
                { id: 'y_act', scenario: 'ACTUAL', range: 'YTD' }, { id: 'y_bud', scenario: 'BUDGET', range: 'YTD' }, { id: 'y_var', kind: 'var', a: 'y_act', b: 'y_bud', label: 'Var F/(U)' }, { id: 'y_varp', kind: 'var', a: 'y_act', b: 'y_bud', mode: 'pct', label: 'Var %' }] },
            { id: 'ytd_py', label: 'Year to date vs last year', cols: [{ id: 'cy', scenario: 'ACTUAL', range: 'YTD' }, { id: 'py', scenario: 'ACTUAL', range: 'YTD', at: 'PY' }, { id: 'ch', kind: 'var', a: 'cy', b: 'py', label: 'Change' }, { id: 'chp', kind: 'var', a: 'cy', b: 'py', mode: 'pct', label: 'Change %' }] },
            { id: 'trend', label: 'Last 12 months + YTD', cols: [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map(function (n) { return { id: 'm' + n, scenario: 'ACTUAL', range: 'MTD', at: n ? 'M-' + n : 'CUR', plain: true }; }).concat([{ id: 'ytd', scenario: 'ACTUAL', range: 'YTD' }]) },
            { id: 'quarter', label: 'Month · quarter · YTD · full year', cols: [{ id: 'm', scenario: 'ACTUAL', range: 'MTD' }, { id: 'q', scenario: 'ACTUAL', range: 'QTD' }, { id: 'y', scenario: 'ACTUAL', range: 'YTD' }, { id: 'pfy', scenario: 'ACTUAL', range: 'FY', at: 'PY', label: 'Last full year' }] }],
        BS: [{ id: 'bal', label: 'Period end · last month · last year end', cols: [{ id: 'cur', scenario: 'ACTUAL', range: 'BAL' }, { id: 'pm', scenario: 'ACTUAL', range: 'BAL', at: 'PM' }, { id: 'pye', scenario: 'ACTUAL', range: 'BAL', at: 'PYE' }, { id: 'ch', kind: 'var', a: 'cur', b: 'pye', label: 'Change vs YE' }] },
            { id: 'trend', label: 'Last 12 month ends', cols: [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map(function (n) { return { id: 'b' + n, scenario: 'ACTUAL', range: 'BAL', at: n ? 'M-' + n : 'CUR' }; }) },
            { id: 'py', label: 'Period end vs a year ago', cols: [{ id: 'cur', scenario: 'ACTUAL', range: 'BAL' }, { id: 'py', scenario: 'ACTUAL', range: 'BAL', at: 'PY' }, { id: 'ch', kind: 'var', a: 'cur', b: 'py', label: 'Change' }, { id: 'chp', kind: 'var', a: 'cur', b: 'py', mode: 'pct', label: 'Change %' }] }]
    };
    FINE.colset = function (kind, id) { var l = FINE.COLSETS[kind === 'BS' ? 'BS' : 'PL']; return JSON.parse(JSON.stringify((l.filter(function (c) { return c.id === id; })[0] || l[0]).cols)); };
    /** A full template from a simple structure: {id, name, type, colset, simple} → + rows + columns */
    FINE.simpleTemplate = function (t) {
        t.type = t.simple.kind === 'BS' ? 'BS' : 'PL';
        t.colset = t.colset || FINE.COLSETS[t.type][0].id;
        t.columns = FINE.colset(t.type, t.colset);
        t.rows = FINE.simpleCompile(t.simple);
        t.scale = t.scale || 1000;
        return t;
    };

    /** Mapping as flat rows (download / Excel): [{template, group, nature, section, account, name, type}] — subtotals as nature 'subtotal';
        accounts of this kind in no section come last with an empty group / section to fill in. */
    FINE.simpleToRows = function (t, accounts) {
        var names = {}; (accounts || []).forEach(function (a) { names[a.code] = a; });
        var out = [], s = t.simple;
        s.lines.forEach(function (l) {
            if (l.t === 'subtotal') { out.push({ template: t.name, group: l.name, nature: 'subtotal', section: '', account: '', name: '', type: '' }); return; }
            (l.sections || []).forEach(function (x) {
                var codes = x.special ? [] : (x.accounts || []);
                if (!codes.length) out.push({ template: t.name, group: l.name, nature: l.nature, section: x.special === 'cye' ? x.name + ' [profit for the year]' : x.name, account: x.match ? x.match : '', name: '', type: '' });
                codes.forEach(function (c) { var a = names[c] || {}; out.push({ template: t.name, group: l.name, nature: l.nature, section: x.name, account: c, name: a.name || '', type: a.account_type || '' }); });
            });
        });
        FINE.simpleCheck(s, accounts || []).unmapped.forEach(function (a) { out.push({ template: t.name, group: '', nature: '', section: '', account: a.code, name: a.name || '', type: a.account_type || '' }); });
        return out;
    };
    /** Flat rows (upload: Template, Main group, Nature, Section, Account …, header names are matched loosely) → {templates: [{name, simple}], warnings} */
    FINE.simpleFromRows = function (rows, accounts, defName) {
        var byCode = {}; (accounts || []).forEach(function (a) { byCode[String(a.code)] = a; });
        var key = function (r, re) { var k = Object.keys(r).filter(function (x) { return re.test(String(x).trim()); })[0]; return k == null ? '' : String(r[k] == null ? '' : r[k]).trim(); };
        var tpls = {}, order = [], warn = [], unknown = 0;
        rows.forEach(function (r, i) {
            var tn = key(r, /^template/i) || defName || 'My statement', gname = key(r, /^(main\s*)?group|^line$|^heading/i), nat = key(r, /^nature|^kind/i).toLowerCase();
            var sname = key(r, /^section|^sub/i), code = key(r, /^account(\s*(code|no|number))?$|^code$|^segment/i);
            if (!gname && !sname && !code) return;
            if (!gname) { if (code) warn.push('Row ' + (i + 2) + ': account ' + code + ' has no main group — left unmapped'); return; }
            var t = tpls[tn]; if (!t) { t = tpls[tn] = { name: tn, simple: { kind: 'PL', lines: [] }, used: {}, g: {} }; order.push(tn); }
            if (/^sub|^total|^=/.test(nat) || /^=/.test(gname)) { var nm = gname.replace(/^=\s*/, ''); if (!t.g['§' + nm]) { t.g['§' + nm] = 1; t.simple.lines.push({ t: 'subtotal', id: FINE.simpleId(nm, t.used), name: nm, of: null }); } return; }
            var g = t.g[gname];
            if (!g) { g = t.g[gname] = { t: 'group', id: FINE.simpleId(gname, t.used), name: gname, nature: FINE.NATURES.indexOf(nat) >= 0 ? nat : '', sections: [], s: {} }; t.simple.lines.push(g); }
            if (!g.nature && FINE.NATURES.indexOf(nat) >= 0) g.nature = nat;
            var cye = /\[profit for the year\]/i.test(sname); sname = sname.replace(/\s*\[profit for the year\]\s*/i, '') || gname;
            var x = g.s[sname];
            if (!x) { x = g.s[sname] = { id: FINE.simpleId(sname === gname ? gname + ' S' : sname, t.used), name: sname, accounts: [] }; if (cye) x.special = 'cye'; g.sections.push(x); }
            if (!code || cye) return;
            if (/[*\-!,]/.test(code)) { x.match = x.match ? x.match + ', ' + code : code; return; }
            if (!byCode[code]) unknown++;
            if (x.accounts.indexOf(code) < 0) x.accounts.push(code);
            if (!g.nature && byCode[code]) g.nature = TYPE_NATURE[byCode[code].account_type] || '';
        });
        if (unknown) warn.push(unknown + ' account code(s) are not in the synced chart of accounts (kept — they show once synced)');
        return { templates: order.map(function (n) {
            var t = tpls[n], s = t.simple;
            s.lines.forEach(function (l) { delete l.s; if (l.t === 'group' && !l.nature) l.nature = s.lines.some(function (z) { return z.nature === 'asset' || z.nature === 'liability' || z.nature === 'equity'; }) ? 'asset' : 'expense'; });
            s.kind = s.lines.some(function (l) { return l.nature === 'asset' || l.nature === 'liability' || l.nature === 'equity'; }) ? 'BS' : 'PL';
            return { name: n, simple: s };
        }), warnings: warn };
    };

    /** Where every account lands: {code: [{tpl, row, label}]} for the accounts rows of the templates (to find unmapped / double-counted). */
    FINE.accountLines = function (templates, accounts) {
        var out = {};
        accounts.forEach(function (a) { out[a.code] = []; });
        templates.forEach(function (t) {
            (t.rows || []).forEach(function (r) {
                if (r.type !== 'accounts') return;
                FINE.matchAccounts(r.accounts, accounts).forEach(function (c) { if (out[c]) out[c].push({ tpl: t.id, row: r.id, label: r.label, basis: r.basis }); });
            });
        });
        return out;
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = FINE; else root.FINE = FINE;
})(typeof window !== 'undefined' ? window : this);
