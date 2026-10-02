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
        if (!p) return (RANGE_LABEL[col.range] || col.range) + sc;
        if (col.range === 'BAL' || col.range === 'OPEN') return p.period_name + sc;
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
        var vals = {};
        Object.keys(need).forEach(function (t) {
            var tpl = templates[t]; if (!tpl) return;
            var res = FINE.compute(tpl, data, { period: period, columns: Object.keys(need[t]).map(function (k) { return need[t][k]; }), scale: 1 });
            res.rows.forEach(function (r) { if (!r.id) return; res.columns.forEach(function (c, i) { vals[t + '.' + r.id + '@' + c.id] = r.raw[i]; }); });
        });
        var out = {};
        parsed.forEach(function (x) {
            if (x.err) { out[x.d.id] = { value: null, error: x.err }; return; }
            var missing = [];
            var v = FINE.evalAst(x.ast, function (ref) {
                var m = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)(?:@([A-Za-z_]+))?$/.exec(ref);
                if (!m) { if (out[ref] && out[ref].value != null) return out[ref].value; missing.push(ref); return 0; }   // an earlier KPI
                var k = m[1] + '.' + m[2] + '@' + (m[3] || x.d.win || 'YTD').toUpperCase();
                if (!(k in vals)) { missing.push(ref); return 0; }
                return vals[k];
            });
            out[x.d.id] = missing.length ? { value: null, error: 'unknown ' + missing.join(', ') } : { value: isFinite(v) ? v : null };
        });
        return out;
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

    if (typeof module !== 'undefined' && module.exports) module.exports = FINE; else root.FINE = FINE;
})(typeof window !== 'undefined' ? window : this);
