/* FBDI engine — turns source rows into FBDI template rows, checks them and writes the CSVs.

   Mapping expressions (one per template column):
     plain text            → a constant, e.g.  NEW
     {Source Column}       → that column of the source row
     {Col|filter:arg|…}    → with filters, e.g.  {Inv Date|date}  {Amount|dr}  {Vendor|upper|trim}
     {#row} {#doc} {#line} {#today} {#now} {#load}
                           → source row number, document number (by the load's document key),
                             line number inside the document, today (YYYY/MM/DD), now, load id
   Text and references can be mixed:  WMS-{Trip}-{#line}

   CSV format follows Oracle's own template macros: no header row, one extra "END" column,
   CRLF line ends, UTF-8 without BOM, dates YYYY/MM/DD, values with , " or line breaks quoted. */

var FE = {};

FE.FILTERS = {
    upper: 'UPPER CASE', lower: 'lower case', trim: 'remove spaces at both ends', title: 'Title Case',
    date: 'to YYYY/MM/DD (date:mdy for US month-first input)', datetime: 'to YYYY/MM/DD HH:MI:SS',
    num: 'clean number (drops , and currency; (12) → -12)', abs: 'absolute value', neg: 'change sign',
    dr: 'value when > 0, else empty (debit)', cr: 'minus the value when < 0, else empty (credit)',
    round: 'round:2', add: 'add:1000', mul: 'mul:-1', left: 'left:10', right: 'right:4', sub: 'sub:start:length',
    pad: 'pad:6 (zeros on the left)', replace: 'replace:old:new', default: 'default:value when empty',
    map: 'map:A=X;B=Y;*=Other', prefix: 'prefix:text', suffix: 'suffix:text'
};
FE.SPECIALS = { '#row': 'source row number', '#doc': 'document number', '#line': 'line number inside the document',
    '#today': 'today YYYY/MM/DD', '#now': 'now YYYY/MM/DD HH:MI:SS', '#load': 'load id',
    '#count': 'rows in the document', '#sum:Column': 'total of a column over the document\'s rows' };

var _feCache = {};
FE.parse = function (expr) {
    expr = expr == null ? '' : String(expr);
    if (_feCache[expr]) return _feCache[expr];
    var parts = [], re = /\{([^{}]*)\}/g, last = 0, m;
    while ((m = re.exec(expr))) {
        if (m.index > last) parts.push({ lit: expr.slice(last, m.index) });
        var bits = m[1].split('|');
        parts.push({
            ref: bits[0].trim(),
            filters: bits.slice(1).map(function (f) { var a = f.split(':'); return { name: a[0].trim().toLowerCase(), args: a.slice(1) }; })
        });
        last = re.lastIndex;
    }
    if (last < expr.length) parts.push({ lit: expr.slice(last) });
    return (_feCache[expr] = parts);
};
FE.refs = function (expr) {
    return FE.parse(expr).map(function (p) { return !p.ref ? null : /^#sum:/i.test(p.ref) ? p.ref.slice(5).trim() : p.ref.charAt(0) === '#' ? null : p.ref; }).filter(Boolean);
};
FE.isConstant = function (expr) { return !FE.parse(expr).some(function (p) { return p.ref != null; }); };

FE.pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
FE.fmtDate = function (d, withTime) {
    var s = d.getFullYear() + '/' + FE.pad2(d.getMonth() + 1) + '/' + FE.pad2(d.getDate());
    return withTime ? s + ' ' + FE.pad2(d.getHours()) + ':' + FE.pad2(d.getMinutes()) + ':' + FE.pad2(d.getSeconds()) : s;
};
var FE_MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
/** Any common date input → Date (local), or null. Excel serials, ISO, 2024/01/31, 31/01/2024, 31-JAN-2024 … */
FE.toDate = function (v, order) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    var s = String(v).trim(), m;
    if (/^\d{5}(\.\d+)?$/.test(s)) {                          // Excel serial day number
        var n = parseFloat(s); if (n < 20000 || n > 80000) return null;
        var ms = Math.round((n - 25569) * 864e5), d0 = new Date(ms);
        return new Date(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate(), d0.getUTCHours(), d0.getUTCMinutes(), d0.getUTCSeconds());
    }
    var t = '(?:[ T](\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?';
    if ((m = new RegExp('^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})' + t).exec(s)))
        return FE.mk(+m[1], +m[2], +m[3], m[4], m[5], m[6]);
    if ((m = new RegExp('^(\\d{1,2})[-/. ]([A-Za-z]{3})[A-Za-z]*[-/. ](\\d{2,4})' + t).exec(s)) && FE_MON[m[2].toUpperCase()])
        return FE.mk(FE.yy(+m[3]), FE_MON[m[2].toUpperCase()], +m[1], m[4], m[5], m[6]);
    if ((m = new RegExp('^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{2,4})' + t).exec(s))) {
        var a = +m[1], b = +m[2];
        var mdy = order === 'mdy' || (order !== 'dmy' && a <= 12 && b > 12);
        return FE.mk(FE.yy(+m[3]), mdy ? a : b, mdy ? b : a, m[4], m[5], m[6]);
    }
    return null;
};
FE.yy = function (y) { return y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y; };
FE.mk = function (y, mo, d, h, mi, se) {
    var dt = new Date(y, mo - 1, d, +(h || 0), +(mi || 0), +(se || 0));
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
};
/** Clean a number: "1,234.50" "$ 12" "(45.10)" "12-" → number or NaN. */
FE.toNum = function (v) {
    if (typeof v === 'number') return v;
    var s = String(v == null ? '' : v).trim();
    if (!s) return NaN;
    var neg = /^\(.*\)$/.test(s) || /-$/.test(s);
    s = s.replace(/[()\s]/g, '').replace(/-$/, '').replace(/[^\d.,eE+-]/g, '');
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0 && s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');   // 1.234,50
    else if (/,\d{1,2}$/.test(s) && s.indexOf('.') < 0 && (s.match(/,/g) || []).length === 1) s = s.replace(',', '.');                    // 12,5
    s = s.replace(/,/g, '');
    var n = s === '' ? NaN : Number(s);
    return neg && !isNaN(n) ? -Math.abs(n) : n;
};
/** Number → plain text (no exponent, no float noise). */
FE.numStr = function (n) {
    if (n == null || n === '' || isNaN(n)) return '';
    if (Number.isInteger(n)) return String(n);
    var s = Number(n.toPrecision(15)).toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
};
FE.str = function (v) {
    if (v == null) return '';
    if (v instanceof Date) return FE.fmtDate(v, v.getHours() || v.getMinutes() || v.getSeconds());
    if (typeof v === 'number') return FE.numStr(v);
    return String(v);
};

FE.applyFilter = function (val, f) {
    var a = f.args, s = FE.str(val), n;
    switch (f.name) {
        case 'upper': return s.toUpperCase();
        case 'lower': return s.toLowerCase();
        case 'trim': return s.trim();
        case 'title': return s.toLowerCase().replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); });
        case 'date': case 'datetime': {
            if (!s.trim() && !(val instanceof Date)) return '';
            var d = FE.toDate(val instanceof Date ? val : s, a[0]);
            if (!d) throw 'not a date: "' + s + '"';
            return FE.fmtDate(d, f.name === 'datetime');
        }
        case 'num': if (!s.trim()) return ''; n = FE.toNum(s); if (isNaN(n)) throw 'not a number: "' + s + '"'; return FE.numStr(n);
        case 'abs': case 'neg': case 'dr': case 'cr': case 'round': case 'add': case 'mul': {
            if (!s.trim()) return f.name === 'add' ? FE.numStr(+a[0] || 0) : '';
            n = FE.toNum(s); if (isNaN(n)) throw 'not a number: "' + s + '"';
            if (f.name === 'abs') return FE.numStr(Math.abs(n));
            if (f.name === 'neg') return FE.numStr(-n);
            if (f.name === 'dr') return n > 0 ? FE.numStr(n) : '';
            if (f.name === 'cr') return n < 0 ? FE.numStr(-n) : '';
            if (f.name === 'round') { var p = Math.pow(10, +a[0] || 0); return FE.numStr(Math.round(n * p) / p); }
            if (f.name === 'add') return FE.numStr(n + (+a[0] || 0));
            return FE.numStr(n * (a[0] == null ? 1 : +a[0]));
        }
        case 'left': return s.slice(0, +a[0] || 0);
        case 'right': return (+a[0] || 0) ? s.slice(-(+a[0])) : '';
        case 'sub': return s.substr(Math.max(0, (+a[0] || 1) - 1), a[1] == null ? undefined : +a[1]);
        case 'pad': { var w = +a[0] || 0, ch = a[1] || '0'; while (s.length < w) s = ch + s; return s; }
        case 'replace': return a.length ? s.split(a[0]).join(a.slice(1).join(':')) : s;
        case 'default': return s.trim() ? s : a.join(':');
        case 'prefix': return s ? a.join(':') + s : s;
        case 'suffix': return s ? s + a.join(':') : s;
        case 'map': {
            var pairs = a.join(':').split(';'), star = null;
            for (var i = 0; i < pairs.length; i++) {
                var kv = pairs[i].split('='); if (kv.length < 2) continue;
                var k = kv[0].trim(), v = kv.slice(1).join('=');
                if (k === '*') star = v; else if (k.toUpperCase() === s.trim().toUpperCase()) return v;
            }
            return star != null ? star : s;
        }
    }
    throw 'unknown function "' + f.name + '"';
};

/** Evaluate one expression for a context { row, idx (UPPER name → index), rowNo, doc, line, loadId }. */
FE.evalExpr = function (expr, ctx) {
    var parts = FE.parse(expr);
    if (parts.length === 1 && parts[0].lit != null) return parts[0].lit;
    var out = '';
    parts.forEach(function (p) {
        if (p.lit != null) { out += p.lit; return; }
        var v, ref = p.ref;
        if (/^#sum:/i.test(ref)) {                                   // {#sum:Amount} — total of the document's rows
            var ci = ctx.idx[ref.slice(5).trim().toUpperCase()];
            if (ci == null) throw 'no source column "' + ref.slice(5).trim() + '"';
            var tot = 0; (ctx.docRows || [ctx.row]).forEach(function (r) { var x = FE.toNum(r[ci]); if (!isNaN(x)) tot += x; });
            v = FE.numStr(Math.round(tot * 1e6) / 1e6);
        } else if (ref.charAt(0) === '#') {
            var k = ref.toLowerCase();
            if (k === '#count') v = (ctx.docRows || [ctx.row]).length; else
            v = k === '#row' ? ctx.rowNo : k === '#doc' ? ctx.doc : k === '#line' ? ctx.line : k === '#load' ? (ctx.loadId || '') :
                k === '#today' ? FE.fmtDate(new Date()) : k === '#now' ? FE.fmtDate(new Date(), true) : undefined;
            if (v === undefined) throw 'unknown value {' + ref + '}';
        } else {
            var i = ctx.idx[ref.toUpperCase()];
            if (i == null) throw 'no source column "' + ref + '"';
            v = ctx.row[i];
        }
        p.filters.forEach(function (f) { v = FE.applyFilter(v, f); });
        out += FE.str(v);
    });
    return out;
};

FE.srcIndex = function (cols) { var idx = {}; cols.forEach(function (c, i) { idx[String(c).toUpperCase()] = i; }); return idx; };

/** Column lookup inside a spec sheet: DB column name or label, case-insensitive. */
FE.colIndex = function (sheet, key) {
    var K = String(key).toUpperCase();
    for (var i = 0; i < sheet.cols.length; i++) {
        var c = sheet.cols[i];
        if ((c.c && c.c.toUpperCase() === K) || c.n.toUpperCase() === K) return i;
    }
    for (i = 0; i < sheet.cols.length; i++) if (sheet.cols[i].n.toUpperCase().indexOf(K + ' ') === 0) return i;   // "REFERENCE1 (Batch Name)"
    return -1;
};

/**
 * Build the template rows.
 * spec: FBDI_SPECS[template]; maps: { csv: { pos(1-based): expr } }; src: { cols, rows };
 * opts: { docKey, sheets: { csv: { include, mode: 'row'|'doc' } }, loadId }
 * → { sheets: [{ csv, name, spec, rows: [[…]], src: [srcRowIndex], errs: [{r,c,msg}] }], docCount }
 */
FE.build = function (spec, maps, src, opts) {
    opts = opts || {};
    var idx = FE.srcIndex(src.cols), docRows = [], docOf = [], lineOf = [], firstRowOfDoc = [], keys = {}, nDoc = 0;
    src.rows.forEach(function (row, i) {
        var key = String(i);
        if (opts.docKey) {
            try { key = FE.evalExpr(opts.docKey, { row: row, idx: idx, rowNo: i + 1, doc: 0, line: 0, loadId: opts.loadId }); }
            catch (e) { key = '#err' + i; }
        }
        if (!keys[key]) { nDoc++; keys[key] = { doc: nDoc, lines: 0, rows: [] }; firstRowOfDoc.push(i); docRows[nDoc] = keys[key].rows; }
        keys[key].lines++; keys[key].rows.push(row);
        docOf[i] = keys[key].doc; lineOf[i] = keys[key].lines;
    });
    var out = { sheets: [], docCount: nDoc };
    spec.sheets.forEach(function (sh) {
        var so = (opts.sheets || {})[sh.csv] || {};
        if (so.include === false) return;
        var m = (maps || {})[sh.csv] || {}, rows = [], srcIdx = [], errs = [];
        var list = so.mode === 'doc' ? firstRowOfDoc : src.rows.map(function (_, i) { return i; });
        var exprs = sh.cols.map(function (c, k) { return m[k + 1] || ''; });
        list.forEach(function (i) {
            var ctx = { row: src.rows[i], idx: idx, rowNo: i + 1, doc: docOf[i], line: lineOf[i], docRows: docRows[docOf[i]], loadId: opts.loadId };
            var r = rows.length;
            rows.push(exprs.map(function (e, k) {
                if (!e) return '';
                try { return FE.evalExpr(e, ctx); } catch (x) { errs.push({ r: r, c: k, msg: String(x) }); return ''; }
            }));
            srcIdx.push(i);
        });
        out.sheets.push({ csv: sh.csv, name: sh.n, spec: sh, rows: rows, src: srcIdx, errs: errs });
    });
    return out;
};

/** Generic checks from the template itself: required, number, date, length. */
FE.checkBasic = function (built, notRequired) {
    var issues = [], relax = {};
    (notRequired || []).forEach(function (k) { relax[String(k).toUpperCase()] = 1; });
    built.sheets.forEach(function (s) {
        s.errs.forEach(function (e) { issues.push({ csv: s.csv, r: e.r, c: e.c, sev: 'E', check: 'map', msg: e.msg }); });
        s.rows.forEach(function (row, r) {
            s.spec.cols.forEach(function (col, c) {
                var v = row[c];
                if (v === '' || v == null) {
                    if (col.r && !relax[(col.c || col.n).toUpperCase()]) issues.push({ csv: s.csv, r: r, c: c, sev: 'E', check: 'required', msg: col.n + ' is required' });
                    return;
                }
                if (v === '#NULL') return;                          // FBDI: explicitly clear a value
                if (col.t === 'N' && isNaN(Number(v))) issues.push({ csv: s.csv, r: r, c: c, sev: 'E', check: 'type', msg: col.n + ' must be a number ("' + v + '")' });
                else if (col.t === 'N' && col.p) {
                    var pr = String(col.p).split(','), ip = (+pr[0] || 38) - (+pr[1] || 0), digits = String(v).replace(/^-/, '').split('.')[0].replace(/^0+/, '').length;
                    if (digits > ip) issues.push({ csv: s.csv, r: r, c: c, sev: 'E', check: 'length', msg: col.n + ' has too many digits (max ' + ip + ')' });
                }
                if (col.t === 'D' && !/^\d{4}\/\d{2}\/\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(v)) issues.push({ csv: s.csv, r: r, c: c, sev: 'E', check: 'type', msg: col.n + ' must be YYYY/MM/DD ("' + v + '") — add |date to the mapping' });
                if (col.l && String(v).length > col.l) issues.push({ csv: s.csv, r: r, c: c, sev: 'E', check: 'length', msg: col.n + ' is longer than ' + col.l + ' characters' });
            });
        });
    });
    return issues;
};

FE.csvField = function (v) {
    v = v == null ? '' : String(v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};
/** One sheet → CSV text in Oracle's format. end: the template's macro adds a trailing END column (most do; spec.end === 0 when not). */
FE.toCsv = function (sheetOut, end) {
    var tail = end === false || end === 0 ? '' : ',END';
    return sheetOut.rows.map(function (r) { return r.map(FE.csvField).join(',') + tail; }).join('\r\n') + (sheetOut.rows.length ? '\r\n' : '');
};
FE.utf8Bytes = function (s) { return unescape(encodeURIComponent(s)).length; };
