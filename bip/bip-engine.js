/* Oracle BIP Reporting · pure engine (window.BIPE, also loads in node for the tests).
 * Parameter kinds and date pairs of a BI Publisher report, date formats the way BIP writes them (Java patterns),
 * date / value buckets (one run per bucket), the run plan, catalog search, and the aggregations the dashboard cards use. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.BIPE = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var E = { version: '1.1' };

    // ── parameters ───────────────────────────────────────────────
    var DATE_NAME = /(^|_)(DATE|DT|DAY|PERIOD|FROM|TO|START|END|SINCE|UNTIL|AS_OF|ASOF)($|_)/i;
    E.kind = function (p) {
        p = p || {};
        var ui = String(p.uiType || '').toLowerCase(), dt = String(p.dataType || '').toLowerCase(), name = String(p.name || '');
        if (ui === 'hidden') return 'hidden';
        if (dt.indexOf('date') >= 0 || ui.indexOf('date') >= 0) return 'date';
        if (ui === 'checkbox' || dt === 'boolean') return 'bool';
        if ((p.lovLabels && p.lovLabels.length) || ui === 'menu' || ui === 'lov' || ui === 'select') return 'menu';
        if (dt === 'integer' || dt === 'float' || dt === 'number' || dt === 'double' || dt === 'decimal') return 'number';
        if (p.dateFormatString) return 'date';
        return 'text';
    };
    E.isDateName = function (name) { return DATE_NAME.test(String(name || '')); };
    /** Pairs of date parameters that look like a range: (FROM|START|BEGIN) with (TO|END|UNTIL), else the first two dates. */
    E.datePairs = function (params) {
        var dates = (params || []).filter(function (p) { return E.kind(p) === 'date'; });
        var out = [], used = {};
        var FROM = /(FROM|START|BEGIN|SINCE|_LOW|MIN)/i, TO = /(^|_)(TO|END|UNTIL|_HIGH|MAX|THRU)($|_)/i;
        dates.forEach(function (f) {
            if (used[f.name] || !FROM.test(f.name)) return;
            var stem = f.name.replace(FROM, '').replace(/__+/g, '_');
            var t = dates.filter(function (x) { return !used[x.name] && x.name !== f.name && TO.test(x.name) && x.name.replace(TO, '$1$3').replace(/__+/g, '_') === stem; })[0]
                || dates.filter(function (x) { return !used[x.name] && x.name !== f.name && TO.test(x.name); })[0];
            if (t) { out.push({ from: f.name, to: t.name }); used[f.name] = used[t.name] = true; }
        });
        if (!out.length && dates.length >= 2) out.push({ from: dates[0].name, to: dates[1].name });
        return out;
    };

    // ── dates (Java patterns like BI Publisher: yyyy MM dd HH mm ss, MMM = Jan) ──
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
    E.toDate = function (v) {
        if (v == null || v === '') return null;
        if (v instanceof Date) return isNaN(v) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
        var s = String(v).trim(), m;
        if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return new Date(+m[1], +m[2] - 1, +m[3]);
        if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/.exec(s))) return new Date(+m[3], +m[2] - 1, +m[1]);
        if ((m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/.exec(s))) { var mi = MON.map(function (x) { return x.toLowerCase(); }).indexOf(m[2].toLowerCase()); if (mi >= 0) return new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], mi, +m[1]); }
        var d = new Date(s); return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
    };
    E.iso = function (d) { d = E.toDate(d); return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) : ''; };
    E.addDays = function (d, n) { d = E.toDate(d); if (!d) return null; var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; };
    /** Formats a date with a BIP / Java pattern (yyyy, yy, MMM, MM, M, dd, d, HH, mm, ss); '' → yyyy-MM-dd. */
    E.format = function (d, fmt) {
        d = E.toDate(d); if (!d) return '';
        fmt = String(fmt || 'yyyy-MM-dd');
        return fmt.replace(/yyyy|yy|MMM|MM|M|dd|d|HH|mm|ss/g, function (t) {
            switch (t) {
                case 'yyyy': return String(d.getFullYear());
                case 'yy': return pad(d.getFullYear() % 100);
                case 'MMM': return MON[d.getMonth()];
                case 'MM': return pad(d.getMonth() + 1);
                case 'M': return String(d.getMonth() + 1);
                case 'dd': return pad(d.getDate());
                case 'd': return String(d.getDate());
                case 'HH': return '00'; case 'mm': return '00'; case 'ss': return '00';
            }
            return t;
        });
    };
    /** Reads a date written with a BIP pattern (the parameter's dateFormatString) → Date | null. */
    E.parse = function (s, fmt) {
        if (s == null || s === '') return null;
        s = String(s).trim(); fmt = String(fmt || '');
        if (!fmt) return E.toDate(s);
        var re = '^', keys = [];
        fmt.replace(/yyyy|yy|MMM|MM|M|dd|d|HH|mm|ss|[^A-Za-z]+|[A-Za-z]+/g, function (t) {
            if (t === 'yyyy') { re += '(\\d{4})'; keys.push('y'); }
            else if (t === 'yy') { re += '(\\d{2})'; keys.push('y2'); }
            else if (t === 'MMM') { re += '([A-Za-z]{3})'; keys.push('mon'); }
            else if (t === 'MM' || t === 'M') { re += '(\\d{1,2})'; keys.push('m'); }
            else if (t === 'dd' || t === 'd') { re += '(\\d{1,2})'; keys.push('d'); }
            else if (t === 'HH' || t === 'mm' || t === 'ss') { re += '(\\d{1,2})'; keys.push('x'); }
            else re += t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return t;
        });
        var m = new RegExp(re).exec(s);
        if (!m) return E.toDate(s);
        var y = 1970, mo = 0, dd = 1;
        keys.forEach(function (k, i) {
            var v = m[i + 1];
            if (k === 'y') y = +v; else if (k === 'y2') y = 2000 + +v; else if (k === 'm') mo = +v - 1; else if (k === 'd') dd = +v;
            else if (k === 'mon') { var mi = MON.map(function (x) { return x.toLowerCase(); }).indexOf(v.toLowerCase()); if (mi >= 0) mo = mi; }
        });
        var d = new Date(y, mo, dd); return isNaN(d) ? null : d;
    };

    // ── buckets ──────────────────────────────────────────────────
    /** Cuts [from, to] into inclusive ranges: by 'days' (n each), 'week' (Mon–Sun), 'month', 'quarter', 'year', 'none'. */
    E.buckets = function (o) {
        o = o || {};
        var from = E.toDate(o.from), to = E.toDate(o.to), by = o.by || 'none', n = Math.max(1, Math.floor(+o.n || 1));
        if (!from || !to) return [];
        if (to < from) { var t = from; from = to; to = t; }
        var out = [], cur = from, guard = 0;
        if (by === 'none') return [{ from: E.iso(from), to: E.iso(to), label: E.iso(from) + ' → ' + E.iso(to) }];
        while (cur <= to && guard++ < 5000) {
            var end;
            if (by === 'days') end = E.addDays(cur, n - 1);
            else if (by === 'week') { var dow = (cur.getDay() + 6) % 7; end = E.addDays(cur, 6 - dow + 7 * (n - 1)); }
            else if (by === 'month') end = new Date(cur.getFullYear(), cur.getMonth() + n, 0);
            else if (by === 'quarter') end = new Date(cur.getFullYear(), cur.getMonth() - (cur.getMonth() % 3) + 3 * n, 0);
            else if (by === 'year') end = new Date(cur.getFullYear() + n, 0, 0);
            else end = E.addDays(cur, n - 1);
            if (end > to) end = to;
            out.push({ from: E.iso(cur), to: E.iso(end), label: E.bucketLabel(cur, end, by) });
            cur = E.addDays(end, 1);
        }
        return out;
    };
    E.bucketLabel = function (a, b, by) {
        a = E.toDate(a); b = E.toDate(b);
        if (by === 'month' && a.getDate() === 1 && E.iso(b) === E.iso(new Date(a.getFullYear(), a.getMonth() + 1, 0))) return MON[a.getMonth()] + ' ' + a.getFullYear();
        if (by === 'year' && a.getMonth() === 0 && a.getDate() === 1 && b.getMonth() === 11 && b.getDate() === 31) return String(a.getFullYear());
        if (by === 'quarter' && a.getDate() === 1 && a.getMonth() % 3 === 0 && E.iso(b) === E.iso(new Date(a.getFullYear(), a.getMonth() + 3, 0))) return 'Q' + (a.getMonth() / 3 + 1) + ' ' + a.getFullYear();
        return E.iso(a) + (E.iso(a) === E.iso(b) ? '' : ' → ' + E.iso(b));
    };

    /** The parameter values the page sends → { name: [strings] } the way BIP wants them (dates in the parameter's format). */
    E.encode = function (params, values) {
        var out = {};
        (params || []).forEach(function (p) {
            var k = E.kind(p), v = values ? values[p.name] : undefined;
            if (k === 'hidden') { if (v != null && v !== '') out[p.name] = [String(v)]; return; }
            if (v == null || v === '' || (Array.isArray(v) && !v.length)) {
                if (k === 'bool') out[p.name] = ['false'];
                return;
            }
            if (k === 'menu') {
                var arr = Array.isArray(v) ? v : [v];
                if (arr.indexOf('__ALL__') >= 0) { if (p.useNullForAll) return; out[p.name] = ['*']; return; }
                out[p.name] = arr.map(String); return;
            }
            if (k === 'date') { var d = E.toDate(v); out[p.name] = [d ? E.format(d, p.dateFormatString) : String(v)]; return; }
            if (k === 'bool') { out[p.name] = [v === true || v === 'true' || v === 'Y' ? 'true' : 'false']; return; }
            out[p.name] = Array.isArray(v) ? v.map(String) : [String(v)];
        });
        return out;
    };

    /** Runs of a bucketed run: the cross product of date buckets × value buckets, each { label, params } (params override the base). */
    E.plan = function (o) {
        o = o || {};
        var fmtOf = function (name) { var p = (o.params || []).filter(function (x) { return x.name === name; })[0]; return p && p.dateFormatString || ''; };
        var dates = [], vals = [];
        if (o.dateBucket && o.dateBucket.fromParam && o.dateBucket.toParam && o.dateBucket.by && o.dateBucket.by !== 'none') {
            var db = o.dateBucket;
            dates = E.buckets({ from: db.from, to: db.to, by: db.by, n: db.n }).map(function (b) {
                var p = {}; p[db.fromParam] = [E.format(b.from, fmtOf(db.fromParam))]; p[db.toParam] = [E.format(b.to, fmtOf(db.toParam))];
                return { label: b.label, params: p };
            });
        }
        if (o.valueBucket && o.valueBucket.param && o.valueBucket.values && o.valueBucket.values.length) {
            var vb = o.valueBucket;
            vals = vb.values.filter(function (v) { return v != null && String(v) !== ''; }).map(function (v) { var p = {}; p[vb.param] = [String(v)]; return { label: String(v), params: p }; });
        }
        if (!dates.length && !vals.length) return [];
        if (!dates.length) return vals;
        if (!vals.length) return dates;
        var out = [];
        dates.forEach(function (d) { vals.forEach(function (v) { var p = {}; Object.keys(d.params).forEach(function (k) { p[k] = d.params[k]; }); Object.keys(v.params).forEach(function (k) { p[k] = v.params[k]; }); out.push({ label: d.label + ' · ' + v.label, params: p }); }); });
        return out;
    };

    // ── catalog search ───────────────────────────────────────────
    E.search = function (items, q, max) {
        q = String(q || '').trim().toLowerCase(); if (!q) return [];
        var words = q.split(/\s+/).filter(Boolean);
        var out = [];
        (items || []).forEach(function (it) {
            var name = String(it.displayName || it.fileName || '').toLowerCase(), path = String(it.absolutePath || '').toLowerCase();
            var score = 0, ok = true;
            words.forEach(function (w) {
                if (name.indexOf(w) >= 0) score += name === w ? 20 : name.indexOf(w) === 0 ? 8 : 5;
                else if (path.indexOf(w) >= 0) score += 1;
                else ok = false;
            });
            if (!ok) return;
            if (it.type === 'Report') score += 3; else if (it.type === 'Folder') score += 1;
            out.push({ item: it, score: score });
        });
        var rank = function (it) { return it.type === 'Report' ? 0 : it.type === 'Folder' ? 1 : 2; };
        out.sort(function (a, b) { return b.score - a.score || rank(a.item) - rank(b.item) || String(a.item.displayName || '').localeCompare(String(b.item.displayName || '')); });
        return out.slice(0, max || 50).map(function (x) { return x.item; });
    };

    // ── data helpers for results and dashboard cards ─────────────
    E.num = function (v) { if (v == null || v === '') return null; if (typeof v === 'number') return isFinite(v) ? v : null; var n = Number(String(v).replace(/,/g, '')); return isFinite(n) ? n : null; };
    /** Column facts: numeric / date / text, distinct, min, max, sum, nulls. */
    E.summary = function (rows, columns) {
        rows = rows || []; columns = columns || (rows[0] ? Object.keys(rows[0]) : []);
        return columns.map(function (c) {
            var n = 0, nulls = 0, sum = 0, nums = 0, dates = 0, min = null, max = null, seen = {}, distinct = 0;
            rows.forEach(function (r) {
                var v = r[c]; n++;
                if (v == null || v === '') { nulls++; return; }
                var key = String(v); if (!seen[key] && distinct < 100000) { seen[key] = 1; distinct++; }
                var x = E.num(v);
                if (x != null && typeof v !== 'string' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()))) { nums++; sum += x; if (min == null || x < min) min = x; if (max == null || x > max) max = x; }
                else if (E.toDate(v) && /\d{4}/.test(key)) dates++;
            });
            var filled = n - nulls;
            var kind = filled && nums === filled ? 'number' : filled && dates === filled ? 'date' : 'text';
            return { column: c, kind: kind, rows: n, nulls: nulls, distinct: distinct, sum: kind === 'number' ? sum : null, min: kind === 'number' ? min : null, max: kind === 'number' ? max : null, avg: kind === 'number' && nums ? sum / nums : null };
        });
    };
    /** Group rows by a column and aggregate a value column: fn count | sum | avg | min | max → [{key, value, n}] sorted by value desc. */
    E.agg = function (rows, o) {
        o = o || {}; var fn = o.fn || 'count', g = {}, order = [];
        (rows || []).forEach(function (r) {
            var key = o.groupBy ? (r[o.groupBy] == null ? '(blank)' : String(r[o.groupBy])) : 'All';
            if (!g[key]) { g[key] = { key: key, n: 0, sum: 0, min: null, max: null }; order.push(key); }
            var b = g[key]; b.n++;
            var v = o.valueCol ? E.num(r[o.valueCol]) : null;
            if (v != null) { b.sum += v; if (b.min == null || v < b.min) b.min = v; if (b.max == null || v > b.max) b.max = v; }
        });
        var out = order.map(function (k) { var b = g[k]; var value = fn === 'count' ? b.n : fn === 'sum' ? b.sum : fn === 'avg' ? (b.n ? b.sum / b.n : 0) : fn === 'min' ? b.min : fn === 'max' ? b.max : b.n; return { key: k, value: value == null ? 0 : value, n: b.n }; });
        if (o.sort !== 'key') out.sort(function (a, b) { return b.value - a.value; });
        if (o.top) out = out.slice(0, o.top);
        return out;
    };
    /** One number for a dashboard card: mode count | sum | avg | min | max | first (first row's column). */
    E.cardValue = function (rows, cfg) {
        cfg = cfg || {}; rows = rows || [];
        if (cfg.mode === 'count' || !cfg.mode) return rows.length;
        if (cfg.mode === 'first') return rows.length ? rows[0][cfg.column] : null;
        var a = E.agg(rows, { fn: cfg.mode, valueCol: cfg.column });
        return a.length ? a[0].value : 0;
    };
    E.fmtNum = function (v, dec) {
        var n = E.num(v); if (n == null) return v == null ? '' : String(v);
        var d = dec == null ? (Math.abs(n) >= 1000 || Number.isInteger(n) ? 0 : 2) : dec;
        return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
    };
    E.fmtMs = function (ms) { ms = +ms || 0; if (ms < 1000) return ms + ' ms'; if (ms < 60000) return (ms / 1000).toFixed(1) + ' s'; var m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000); return m + ' min' + (s ? ' ' + s + ' s' : ''); };
    E.fmtBytes = function (b) { b = +b || 0; if (b < 1024) return b + ' B'; if (b < 1048576) return Math.round(b / 1024) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; };
    /** Keeps a param set where dates became strings so the same values can be put back into the form. */
    E.csvOf = function (rows, columns) {
        columns = columns || (rows[0] ? Object.keys(rows[0]) : []);
        var esc = function (v) { if (v == null) return ''; v = String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        return columns.map(esc).join(',') + '\n' + (rows || []).map(function (r) { return columns.map(function (c) { return esc(r[c]); }).join(','); }).join('\n');
    };
    // ── output formats, from the report definition ──────────────
    /** csv | xml | data = rows the page can show as a grid. */
    E.isData = function (f) { f = String(f || '').toLowerCase(); return f === 'csv' || f === 'xml' || f === 'data'; };
    /** The output formats a report offers = the union of its templates' formats (getReportDefinition) in their order, plus XML data,
     *  which runReport always accepts. → [{ value, label, data, templates, always }]. CSV is listed only when a layout offers it. */
    E.formats = function (def) {
        var out = [], seen = {};
        function add(v, label, tpl) {
            v = String(v == null ? '' : v).toLowerCase().trim(); if (!v) return; if (v === 'data') v = 'xml';
            if (!seen[v]) { seen[v] = { value: v, label: label && String(label).trim() ? String(label).trim() : v.toUpperCase(), data: E.isData(v), templates: [] }; out.push(seen[v]); }
            if (tpl && seen[v].templates.indexOf(tpl) < 0) seen[v].templates.push(tpl);
        }
        ((def && def.templates) || []).forEach(function (t) { (t.formats || []).forEach(function (f) { if (f == null) return; if (typeof f === 'string') add(f, null, t.id); else add(f.value || f.key, f.key && String(f.key).toLowerCase() !== String(f.value || '').toLowerCase() ? f.key : null, t.id); }); });
        if (!seen.xml) add('xml', 'XML data');
        seen.xml.always = true;
        return out;
    };
    /** The format the Run tab starts on: the definition's defaultOutputFormat when a layout offers it, else csv when offered, else xml. */
    E.defaultFormat = function (def, list) {
        list = list || E.formats(def);
        var d = String(def && def.defaultOutputFormat || '').toLowerCase().trim(); if (d === 'data') d = 'xml';
        if (d && list.some(function (f) { return f.value === d; })) return d;
        return list.some(function (f) { return f.value === 'csv'; }) ? 'csv' : 'xml';
    };
    /** The format a dashboard card runs with: the report's default when it is data, else csv when a layout offers it, else xml. */
    E.dataFormat = function (def, list) {
        list = list || E.formats(def);
        var d = E.defaultFormat(def, list);
        if (E.isData(d)) return d;
        return list.some(function (f) { return f.value === 'csv'; }) ? 'csv' : 'xml';
    };

    // ── grid helpers: filters, sorting, pivot ────────────────────
    /** One column filter: contains; =x exact; !x not containing; >n <n >=n <=n; a..b between; "=" alone = blank. */
    E.filterMatch = function (v, expr) {
        expr = String(expr == null ? '' : expr).trim(); if (!expr) return true;
        var s = v == null ? '' : String(v), m;
        if (expr === '=') return s === '';
        if ((m = /^(>=|<=|>|<)\s*(-?[\d.,]+)$/.exec(expr))) { var n = E.num(v), x = E.num(m[2]); if (n == null || x == null) return false; return m[1] === '>' ? n > x : m[1] === '<' ? n < x : m[1] === '>=' ? n >= x : n <= x; }
        if ((m = /^(-?[\d.,]+)\s*\.\.\s*(-?[\d.,]+)$/.exec(expr))) { var n2 = E.num(v), a = E.num(m[1]), b = E.num(m[2]); return n2 != null && n2 >= Math.min(a, b) && n2 <= Math.max(a, b); }
        if (expr[0] === '=') return s.toLowerCase() === expr.slice(1).trim().toLowerCase();
        if (expr[0] === '!') return s.toLowerCase().indexOf(expr.slice(1).trim().toLowerCase()) < 0;
        return s.toLowerCase().indexOf(expr.toLowerCase()) >= 0;
    };
    /** Rows matching every column filter ({col: expr}) and every word of q in any of the given columns. */
    E.filterRows = function (rows, filters, q, columns) {
        filters = filters || {}; var fcols = Object.keys(filters).filter(function (c) { return String(filters[c] || '').trim(); });
        var words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
        if (!fcols.length && !words.length) return (rows || []).slice();
        return (rows || []).filter(function (r) {
            for (var i = 0; i < fcols.length; i++) if (!E.filterMatch(r[fcols[i]], filters[fcols[i]])) return false;
            if (!words.length) return true;
            var cols = columns || Object.keys(r), text = '';
            for (var j = 0; j < cols.length; j++) { var v = r[cols[j]]; if (v != null) text += String(v).toLowerCase() + '\u0001'; }
            for (var k = 0; k < words.length; k++) if (text.indexOf(words[k]) < 0) return false;
            return true;
        });
    };
    /** A new array sorted by one column: numbers numerically, text with localeCompare, blanks last. dir 'asc' | 'desc'. */
    E.sortRows = function (rows, col, dir) {
        if (!col) return (rows || []).slice();
        var sign = dir === 'desc' ? -1 : 1;
        var dec = (rows || []).map(function (r, i) { var v = r[col]; var n = typeof v === 'number' ? v : (v != null && v !== '' && /^-?[\d,]*\.?\d+$/.test(String(v).trim()) ? E.num(v) : null); return { i: i, r: r, n: n, s: v == null ? null : String(v), blank: v == null || v === '' }; });
        dec.sort(function (a, b) {
            if (a.blank !== b.blank) return a.blank ? 1 : -1;
            if (a.blank) return a.i - b.i;
            var c = a.n != null && b.n != null ? a.n - b.n : a.n != null ? -1 : b.n != null ? 1 : a.s.localeCompare(b.s, undefined, { numeric: true, sensitivity: 'base' });
            return c ? c * sign : a.i - b.i;
        });
        return dec.map(function (d) { return d.r; });
    };
    function keyCmp(a, b) { for (var i = 0; i < Math.max(a.length, b.length); i++) { var x = a[i] == null ? '' : a[i], y = b[i] == null ? '' : b[i]; var nx = E.num(x), ny = E.num(y); var c = nx != null && ny != null && /^-?[\d.,]+$/.test(x) && /^-?[\d.,]+$/.test(y) ? nx - ny : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }); if (c) return c; } return 0; }
    /** A pivot: o.rows / o.cols = field names, o.value = the column aggregated (none → count), o.fn sum | count | avg | min | max,
     *  o.sort 'key' (default) | 'total' (rows by total desc), o.maxCols (default 60).
     *  → { rowFields, colFields, value, fn, cols: [[keys]], rows: [{ keys, values, total, n }], colTotals, grand, colsCut } */
    E.pivot = function (rows, o) {
        o = o || {}; var rf = o.rows || [], cf = o.cols || [], val = o.value || null, fn = val ? (o.fn || 'sum') : 'count';
        var SEP = '\u0001', JOIN = '\u0002';
        var rowKeys = {}, rowOrder = [], colKeys = {}, colOrder = [], cells = {};
        function keyOf(r, fields) { return fields.map(function (f) { var v = r[f]; return v == null || v === '' ? '(blank)' : String(v); }); }
        function cell() { return { n: 0, k: 0, sum: 0, min: null, max: null }; }
        function acc(c, v) { c.n++; if (v != null) { c.sum += v; c.k++; if (c.min == null || v < c.min) c.min = v; if (c.max == null || v > c.max) c.max = v; } }
        function merge(t, c) { if (!c) return; t.n += c.n; t.k += c.k; t.sum += c.sum; if (c.min != null && (t.min == null || c.min < t.min)) t.min = c.min; if (c.max != null && (t.max == null || c.max > t.max)) t.max = c.max; }
        function value(c) { if (!c || !c.n) return null; return fn === 'count' ? c.n : fn === 'sum' ? c.sum : fn === 'avg' ? (c.k ? c.sum / c.k : null) : fn === 'min' ? c.min : fn === 'max' ? c.max : c.n; }
        (rows || []).forEach(function (r) {
            var rk = keyOf(r, rf), ck = keyOf(r, cf), rs = rk.join(SEP), cs = ck.join(SEP);
            if (!rowKeys[rs]) { rowKeys[rs] = rk; rowOrder.push(rs); }
            if (!colKeys[cs]) { colKeys[cs] = ck; colOrder.push(cs); }
            var id = rs + JOIN + cs; if (!cells[id]) cells[id] = cell();
            acc(cells[id], val ? E.num(r[val]) : null);
        });
        rowOrder.sort(function (a, b) { return keyCmp(rowKeys[a], rowKeys[b]); });
        colOrder.sort(function (a, b) { return keyCmp(colKeys[a], colKeys[b]); });
        var maxCols = o.maxCols || 60, colsCut = colOrder.length > maxCols ? colOrder.length - maxCols : 0;
        if (colsCut) colOrder = colOrder.slice(0, maxCols);
        var out = rowOrder.map(function (rs) {
            var tot = cell(), vals = colOrder.map(function (cs) { var c = cells[rs + JOIN + cs]; merge(tot, c); return value(c); });
            if (colsCut) Object.keys(colKeys).forEach(function (cs) { if (colOrder.indexOf(cs) < 0) merge(tot, cells[rs + JOIN + cs]); });
            return { keys: rowKeys[rs], values: vals, total: value(tot), n: tot.n };
        });
        if (o.sort === 'total') out.sort(function (a, b) { return (b.total == null ? -Infinity : b.total) - (a.total == null ? -Infinity : a.total); });
        var grand = cell();
        var colTotals = colOrder.map(function (cs) { var t = cell(); rowOrder.forEach(function (rs) { merge(t, cells[rs + JOIN + cs]); }); merge(grand, t); return value(t); });
        if (colsCut) rowOrder.forEach(function (rs) { Object.keys(colKeys).forEach(function (cs) { if (colOrder.indexOf(cs) < 0) merge(grand, cells[rs + JOIN + cs]); }); });
        return { rowFields: rf, colFields: cf, value: val, fn: fn, cols: colOrder.map(function (cs) { return colKeys[cs]; }), rows: out, colTotals: colTotals, grand: value(grand), colsCut: colsCut };
    };
    return E;
});
