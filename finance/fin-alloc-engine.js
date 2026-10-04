/* Finance Lens — cost allocation / activity-based costing engine (FALLOC). Pure: runs in the page and in node (tests).

   Input rows (one per company × account × dimension values, summed over the chosen periods):
     { company, account, type: 'R'|'E'|…, dims: { cc: '100', segment10: 'S01', … }, amount }   amount = debit − credit
   A model holds ordered rules, manual driver tables and virtual dimensions (e.g. "activity", "product" — not in the GL):
     rule = { id, name, active, pool: { accounts, where: { field: [values] }, pct },
              to: { field, method: fixed|even|gl|driver|cost, targets: [values] | [{ value, pct }], exclude: [values],
                    gl: { accounts, where }, driver: driverId, perCompany },
              post: { out: account | '', in: account | '' }, stepDown }
     driver = { id, name, unit, field, values: { value: number } }
   Rules run in order on a working set (step-down): what an earlier rule moved onto a value can be moved on again by a later rule
   (cost centre → activity → product = ABC). A value a rule emptied does not receive from later rules (stepDown, default on).
   Every rule nets to zero: one credit line per pool row, debit lines on the targets in proportion to the weights. */
(function (root) {
    'use strict';
    var A = {};
    var FINE = root.FINE || (typeof require === 'function' ? require('./fin-engine.js') : null);

    A.METHODS = {
        fixed: 'Fixed percentages',
        even: 'Evenly',
        gl: 'GL driver (amounts of other accounts — e.g. revenue)',
        driver: 'Driver table (headcount, m², orders …)',
        cost: 'Share of the receivers’ own costs'
    };
    A.uid = function (p) { return (p || 'r') + Math.random().toString(36).slice(2, 8); };
    var val = function (row, f) { return f === 'company' ? row.company : f === 'account' ? row.account : row.dims ? (row.dims[f] == null ? '' : String(row.dims[f])) : ''; };
    var r2 = function (v) { return Math.round(v * 100) / 100; };

    /** Account codes of a spec (template syntax: ranges, wildcards, !exclusions, {type, class}); null spec = every account */
    A.accSet = function (spec, accounts) {
        if (spec == null || spec === '' || (Array.isArray(spec) && !spec.length)) return null;
        var set = {}; FINE.matchAccounts(spec, accounts).forEach(function (c) { set[c] = 1; }); return set;
    };
    var whereOk = function (row, where) {
        if (!where) return true;
        return Object.keys(where).every(function (f) { var l = where[f]; if (!l || !l.length) return true; return l.map(String).indexOf(val(row, f)) >= 0; });
    };
    A.poolRows = function (rows, rule, accounts) {
        var p = rule.pool || {}, set = A.accSet(p.accounts, accounts);
        return rows.filter(function (r) { return Math.abs(r.amount) > 1e-9 && (!set || set[r.account]) && whereOk(r, p.where); });
    };

    /** Weights {target value: w ≥ 0} for one pool row (company = the row's company when the rule works per company) */
    A.weights = function (rule, ctx, company) {
        var to = rule.to || {}, f = to.field, ex = {}, out = {}, list = (to.targets || []).map(function (t) { return typeof t === 'object' ? String(t.value) : String(t); });
        (to.exclude || []).forEach(function (v) { ex[String(v)] = 1; });
        (ctx.closed[f] ? Object.keys(ctx.closed[f]) : []).forEach(function (v) { if (rule.stepDown !== false) ex[v] = 1; });
        var only = list.length ? {} : null; list.forEach(function (v) { only[v] = 1; });
        var ok = function (v) { return !ex[v] && (!only || only[v]); };
        var per = to.perCompany !== false;
        if (to.method === 'fixed') {
            (to.targets || []).forEach(function (t) { var v = String(t.value), w = +t.pct || 0; if (!ex[v] && w > 0) out[v] = (out[v] || 0) + w; });
        } else if (to.method === 'driver') {
            var d = (ctx.model.drivers || []).filter(function (x) { return x.id === to.driver; })[0], vals = (d && d.values) || {};
            Object.keys(vals).forEach(function (v) { var w = +vals[v] || 0; if (ok(v) && w > 0) out[v] = w; });
        } else if (to.method === 'gl' || to.method === 'cost') {
            var g = to.gl || {}, set = to.method === 'cost' ? null : A.accSet(g.accounts, ctx.accounts);
            var src = to.method === 'cost' ? ctx.work : ctx.base;
            src.forEach(function (r) {
                if (per && company != null && r.company !== company) return;
                if (to.method === 'cost' ? r.type !== 'E' : (set && !set[r.account])) return;
                if (!whereOk(r, g.where)) return;
                var v = val(r, f); if (!ok(v) || v === '') return;
                out[v] = (out[v] || 0) + r.amount;
            });
            Object.keys(out).forEach(function (v) { out[v] = to.method === 'gl' && g.sign !== 'debit' ? Math.abs(out[v]) : out[v]; if (!(out[v] > 0)) delete out[v]; });
        } else {                                                                     // even: the listed targets, else every value seen
            var vs = list.length ? list : Object.keys(ctx.values[f] || {});
            vs.forEach(function (v) { if (ok(v)) out[v] = 1; });
        }
        return out;
    };

    /** Runs a model. Returns { work (rows after), lines, steps, flows, warnings, ok } */
    A.run = function (model, rows, accounts) {
        var base = rows.map(function (r) { return { company: r.company, account: String(r.account), type: r.type, dims: Object.assign({}, r.dims || {}), amount: +r.amount || 0, src: 'GL' }; });
        var values = {};
        base.forEach(function (r) { Object.keys(r.dims).forEach(function (f) { if (r.dims[f] !== '' && r.dims[f] != null) (values[f] = values[f] || {})[r.dims[f]] = 1; }); (values.company = values.company || {})[r.company] = 1; });
        (model.virtual || []).forEach(function (vd) { values[vd.id] = values[vd.id] || {}; (vd.values || []).forEach(function (v) { values[vd.id][typeof v === 'object' ? v.value : v] = 1; }); });
        var ctx = { model: model, base: base, work: base.slice(), accounts: accounts || [], closed: {}, values: values };
        var lines = [], steps = [], flows = {}, warnings = [], seq = 0;
        (model.rules || []).forEach(function (rule, ri) {
            if (rule.active === false) { steps.push({ rule: rule.id, name: rule.name, skipped: true }); return; }
            var to = rule.to || {}, f = to.field, pct = rule.pool && rule.pool.pct != null && rule.pool.pct !== '' ? +rule.pool.pct / 100 : 1;
            var st = { rule: rule.id, name: rule.name || ('Rule ' + (ri + 1)), pool: 0, allocated: 0, unallocated: 0, rows: 0, targets: {}, warn: [] };
            if (!f) { st.warn.push('no target dimension'); steps.push(st); warnings.push(st.name + ': no target dimension'); return; }
            // pool rows summed per company × account × dimensions (earlier rules' lines on the same key net out first)
            var pool = [], pk = {};
            A.poolRows(ctx.work, rule, ctx.accounts).forEach(function (r) {
                var k = r.company + '\u0001' + r.account + '\u0001' + Object.keys(r.dims).sort().map(function (d) { return d + '=' + r.dims[d]; }).join('\u0001');
                if (pk[k]) pk[k].amount += r.amount; else { pk[k] = { company: r.company, account: r.account, type: r.type, dims: r.dims, amount: r.amount }; pool.push(pk[k]); }
            });
            pool = pool.filter(function (r) { return Math.abs(r.amount) > 0.005; });
            var add = [], wCache = {}, where0 = (rule.pool && rule.pool.where) || {};
            if (to.method === 'fixed' && rule.stepDown !== false && ctx.closed[f]) {
                var gone = (to.targets || []).map(function (t) { return String(t.value); }).filter(function (v) { return ctx.closed[f][v]; });
                if (gone.length) st.warn.push(gone.join(', ') + ' emptied by an earlier rule (step-down) — its share goes to the other receivers');
            }
            var poolVals = {};
            pool.forEach(function (r) {
                var x = r.amount * pct; st.pool += x; st.rows++;
                var key = to.perCompany !== false ? r.company : '*';
                var w = wCache[key] || (wCache[key] = A.weights(rule, ctx, to.perCompany !== false ? r.company : null));
                // never back to itself — when the pool is defined on the receiving dimension (or not by any dimension)
                var wfs = Object.keys(where0).filter(function (k) { return (where0[k] || []).length; }), selfDim = !wfs.length || wfs.indexOf(f) >= 0;
                var own = selfDim ? val(r, f) : ''; if (own && w[own] != null && to.method !== 'fixed') { w = Object.assign({}, w); delete w[own]; }
                var tot = 0; Object.keys(w).forEach(function (v) { tot += w[v]; });
                if (!(tot > 0)) { st.unallocated += x; return; }
                if (own) poolVals[own] = 1;
                var outLine = { company: r.company, account: rule.post && rule.post.out ? String(rule.post.out) : r.account, type: r.type, dims: Object.assign({}, r.dims), amount: -x, src: rule.id, side: 'out', origin: r.account };
                add.push(outLine);
                var keys = Object.keys(w), done = 0;
                keys.forEach(function (v, i) {
                    var y = i === keys.length - 1 ? x - done : x * w[v] / tot; done += y;      // last share takes the rounding
                    var d = Object.assign({}, r.dims); d[f] = v;
                    add.push({ company: r.company, account: rule.post && rule.post['in'] ? String(rule.post['in']) : r.account, type: r.type, dims: d, amount: y, src: rule.id, side: 'in', origin: r.account });
                    st.targets[v] = (st.targets[v] || 0) + y;
                    var fromLbl = wfs.length ? wfs.map(function (k) { return k + '=' + val(r, k); }).join(' ') : own ? f + '=' + own : 'pool';
                    var fk = rule.id + '|' + fromLbl + '|' + f + '=' + v;
                    var fl = flows[fk] = flows[fk] || { rule: rule.id, step: seq, from: fromLbl, to: f + '=' + v, toField: f, toValue: v, amount: 0 };
                    fl.amount += y;
                });
                st.allocated += x;
            });
            // the pool rows' moved part is now on the targets: the credit lines sit beside them in the working set
            add.forEach(function (l) { lines.push(l); ctx.work.push(l); });
            Object.keys(poolVals).forEach(function (v) { (ctx.closed[f] = ctx.closed[f] || {})[v] = 1; });
            (rule.pool && rule.pool.where ? Object.keys(rule.pool.where) : []).forEach(function (wf) { if (wf === f) (rule.pool.where[wf] || []).forEach(function (v) { (ctx.closed[f] = ctx.closed[f] || {})[String(v)] = 1; }); });
            if (!st.rows) st.warn.push('the pool is empty for these periods');
            if (Math.abs(st.unallocated) >= 0.5) st.warn.push(Math.round(st.unallocated).toLocaleString('en-US') + ' not allocated: no receiver has a driver value');
            st.warn.forEach(function (w) { warnings.push(st.name + ': ' + w); });
            st.nTargets = Object.keys(st.targets).length;
            var net = 0; add.forEach(function (l) { net += l.amount; }); st.net = r2(net);
            steps.push(st); seq++;
        });
        var ok = steps.every(function (s) { return s.skipped || Math.abs(s.net || 0) < 0.01; });
        return { work: ctx.work, base: base, lines: lines, steps: steps, flows: Object.keys(flows).map(function (k) { return flows[k]; }), warnings: warnings, ok: ok };
    };

    /** Per value of a field: revenue (income +), direct cost (before), allocated in / out, fully loaded cost, margin before / after */
    A.summary = function (res, field) {
        var by = {};
        var get = function (v) { return by[v] = by[v] || { value: v, revenue: 0, direct: 0, inAmt: 0, outAmt: 0 }; };
        res.base.forEach(function (r) { var o = get(val(r, field)); if (r.type === 'R') o.revenue -= r.amount; else o.direct += r.amount; });
        // per rule, the net moved onto / off each value (a rule that only moves cost inside a value — e.g. cost centre → activity,
        // seen by cost centre — nets to nothing there)
        var net = {};
        res.lines.forEach(function (l) { var k = l.src + '\u0001' + val(l, field); net[k] = (net[k] || 0) + l.amount; });
        Object.keys(net).forEach(function (k) { var o = get(k.split('\u0001')[1]), x = net[k]; if (x > 0) o.inAmt += x; else o.outAmt -= x; });
        return Object.keys(by).map(function (k) {
            var o = by[k]; o.loaded = o.direct + o.inAmt - o.outAmt; o.before = o.revenue - o.direct; o.after = o.revenue - o.loaded;
            o.mBefore = o.revenue ? o.before / o.revenue * 100 : null; o.mAfter = o.revenue ? o.after / o.revenue * 100 : null; return o;
        }).sort(function (a, b) { return Math.abs(b.loaded) - Math.abs(a.loaded); });
    };

    /** Journal lines (debit / credit) of the allocation, grouped by company × account × the dimensions × rule */
    A.journal = function (res, fields) {
        var g = {};
        res.lines.forEach(function (l) {
            var k = [l.src, l.company, l.account].concat(fields.map(function (f) { return val(l, f); })).join('\u0001');
            var o = g[k] = g[k] || { rule: l.src, company: l.company, account: l.account, dims: {}, amount: 0 };
            fields.forEach(function (f) { o.dims[f] = val(l, f); });
            o.amount += l.amount;
        });
        return Object.keys(g).map(function (k) { var o = g[k]; o.dr = o.amount > 0 ? r2(o.amount) : 0; o.cr = o.amount < 0 ? r2(-o.amount) : 0; return o; })
            .filter(function (o) { return o.dr || o.cr; });
    };

    /** Sankey layout: nodes by depth (a value reached by a later rule sits further right), links with thickness ∝ amount */
    A.sankey = function (res, maxLinks) {
        var flows = res.flows.slice().sort(function (a, b) { return Math.abs(b.amount) - Math.abs(a.amount); }).slice(0, maxLinks || 60);
        var depth = {}, nodes = {};
        flows.sort(function (a, b) { return a.step - b.step; }).forEach(function (f) {
            var d0 = depth[f.from] != null ? depth[f.from] : 0; depth[f.from] = d0;
            depth[f.to] = Math.max(depth[f.to] || 0, d0 + 1);
        });
        flows.forEach(function (f) {
            (nodes[f.from] = nodes[f.from] || { id: f.from, out: 0, inn: 0 }).out += Math.abs(f.amount);
            (nodes[f.to] = nodes[f.to] || { id: f.to, out: 0, inn: 0 }).inn += Math.abs(f.amount);
        });
        Object.keys(nodes).forEach(function (k) { nodes[k].depth = depth[k] || 0; nodes[k].size = Math.max(nodes[k].out, nodes[k].inn); });
        return { nodes: Object.keys(nodes).map(function (k) { return nodes[k]; }), links: flows };
    };

    var TYPES = { R: 'revenue', E: 'expense', A: 'asset', L: 'liability', O: 'equity' };
    A.specText = function (s) {
        if (s && typeof s === 'object' && !Array.isArray(s)) {
            var p = [];
            if (s.type) p.push(String(s.type).split('').map(function (t) { return TYPES[t] || t; }).join(' / ') + ' accounts');
            if (s['class']) p.push('class ' + [].concat(s['class']).join(', '));
            if (s.prefix) p.push('starting ' + [].concat(s.prefix).join(', '));
            return p.join(', ') || 'every account';
        }
        return 'accounts ' + [].concat(s).join(', ');
    };
    /** What a rule does, in one sentence (cards, Copilot) */
    A.describe = function (rule, label) {
        label = label || function (f) { return f; };
        var p = rule.pool || {}, to = rule.to || {}, w = p.where || {};
        var src = Object.keys(w).filter(function (f) { return (w[f] || []).length; }).map(function (f) { return label(f) + ' ' + w[f].slice(0, 4).join(', ') + (w[f].length > 4 ? ' …' : ''); }).join(' · ');
        var acc = p.accounts ? A.specText(p.accounts) : 'every account';
        var how = to.method === 'fixed' ? (to.targets || []).slice(0, 4).map(function (t) { return t.value + ' ' + t.pct + '%'; }).join(', ') + ((to.targets || []).length > 4 ? ' …' : '')
            : to.method === 'driver' ? 'by driver ' + (to.driver || '?') : to.method === 'gl' ? 'by the amounts of ' + ((to.gl || {}).accounts ? A.specText(to.gl.accounts) : 'every account') : to.method === 'cost' ? 'by their own costs' : 'evenly';
        return (p.pct != null && p.pct !== '' && +p.pct !== 100 ? p.pct + '% of ' : '') + acc + (src ? ' on ' + src : '') + ' → ' + label(to.field || '?') + ' ' + how;
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = A; else root.FALLOC = A;
})(typeof window !== 'undefined' ? window : this);
