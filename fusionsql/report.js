/* ═══════════════════════════════════════════════════════════════
   Fusion SQL — Format Results (report studio)
   Turns the current result grid into a dashboard: KPI tiles, auto
   insights, a Top-N chart, a trend or second breakdown, a grouped
   summary and a formatted data table — then exports it (Excel with
   charts, PDF, standalone HTML, CSV, PNG) or shares it (Outlook draft
   with inline charts + Excel attached, copy for email / Teams).
   Reads FS.result (the filtered rows the grid shows).
   ═══════════════════════════════════════════════════════════════ */

var RP = { charts: {}, st: null };
var RP_COLORS = { series: '#2a78d6', series2: '#1baf7a', grid: '#ece8e4', ink: '#312d2a', muted: '#8a817b' };
var RP_MAX_TABLE = 500;          // rows rendered in the dialog table
var RP_MAX_HTML = 2000;          // rows in the HTML report
var RP_MAX_EMAIL = 50;           // rows in the email / clipboard body

// ── analysis ───────────────────────────────────────────────────
function rpIsDateCol(rows, c) {
    var seen = 0, hit = 0;
    for (var i = 0; i < rows.length && seen < 60; i++) {
        var v = rows[i][c];
        if (v === undefined || v === null || v === '') continue;
        seen++;
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) hit++;
    }
    return seen > 0 && hit / seen >= 0.8;
}
function rpDistinct(rows, c, cap) {
    var m = {}, n = 0;
    for (var i = 0; i < rows.length; i++) {
        var k = rows[i][c]; k = k === undefined || k === null || k === '' ? '(blank)' : String(k);
        if (!(k in m)) { m[k] = 1; if (++n > cap) return n; }
    }
    return n;
}
/** Picks measures, dimensions and a date column from the result. */
function rpAnalyse(R) {
    var rows = R.filtered;
    var measures = R.columns.filter(function (c) { return R.isNum[c] && !R.isId[c]; });
    var dates = R.columns.filter(function (c) { return !R.isNum[c] && rpIsDateCol(rows, c); });
    var dims = R.columns.filter(function (c) { return !R.isNum[c] && !R.isId[c] && dates.indexOf(c) < 0; })
        .map(function (c) { return { c: c, n: rpDistinct(rows, c, 200) }; })
        .filter(function (d) { return d.n >= 2 && d.n <= 200; })
        .sort(function (a, b) {
            var sa = a.n <= 30 ? 0 : 1, sb = b.n <= 30 ? 0 : 1;           // readable breakdowns first
            return sa - sb || (sa === 0 ? 0 : a.n - b.n);
        })
        .map(function (d) { return d.c; });
    return { measures: measures, dims: dims, dates: dates };
}
function rpGroup(rows, dim, measure) {
    var g = {}, order = [];
    rows.forEach(function (r) {
        var k = r[dim]; k = k === undefined || k === null || k === '' ? '(blank)' : String(k);
        if (!g[k]) { g[k] = { key: k, n: 0, sum: 0, min: null, max: null }; order.push(k); }
        var o = g[k]; o.n++;
        if (measure) {
            var v = r[measure];
            if (typeof v === 'number') { o.sum += v; o.min = o.min === null ? v : Math.min(o.min, v); o.max = o.max === null ? v : Math.max(o.max, v); }
        }
    });
    var list = order.map(function (k) { return g[k]; });
    list.sort(function (a, b) { return (measure ? b.sum - a.sum : b.n - a.n) || a.key.localeCompare(b.key); });
    return list;
}
function rpStats(rows, c) {
    var s = { sum: 0, n: 0, min: null, max: null, nulls: 0 };
    rows.forEach(function (r) {
        var v = r[c];
        if (typeof v !== 'number') { s.nulls++; return; }
        s.sum += v; s.n++;
        s.min = s.min === null ? v : Math.min(s.min, v); s.max = s.max === null ? v : Math.max(s.max, v);
    });
    s.avg = s.n ? s.sum / s.n : 0;
    return s;
}
/** Trend points by day or month (month when the span is over ~2 months). */
function rpTrend(rows, dateCol, measure) {
    var pts = {}, keys = [];
    var days = rows.map(function (r) { return String(r[dateCol] || '').slice(0, 10); }).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }).sort();
    if (!days.length) return { labels: [], values: [], unit: 'day' };
    var span = (new Date(days[days.length - 1]) - new Date(days[0])) / 864e5;
    var unit = span > 62 ? 'month' : 'day';
    rows.forEach(function (r) {
        var d = String(r[dateCol] || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
        var k = unit === 'month' ? d.slice(0, 7) : d;
        if (!(k in pts)) { pts[k] = 0; keys.push(k); }
        pts[k] += measure ? (typeof r[measure] === 'number' ? r[measure] : 0) : 1;
    });
    keys.sort();
    return { labels: keys, values: keys.map(function (k) { return pts[k]; }), unit: unit };
}

// ── formatting ─────────────────────────────────────────────────
function rpNum(v, digits) { return typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: digits == null ? 2 : digits }) : '—'; }
function rpCompact(v) {
    if (typeof v !== 'number') return '—';
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e4) return (v / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K';
    return rpNum(v);
}
function rpPct(p) { return (p * 100).toFixed(p >= 0.1 ? 0 : 1) + '%'; }
function rpNice(c) { return String(c).replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, function (x) { return x.toUpperCase(); }); }
function rpDefaultTitle(R) {
    if (FS.currentQuery && FS.currentQuery.name) return FS.currentQuery.name;
    var m = /\bfrom\s+([a-z0-9_$#."]+)/i.exec(R.sql || '');
    return m ? rpNice(m[1].replace(/^.*\./, '').replace(/"/g, '')) + ' report' : 'Query results';
}

// ── state + open/close ─────────────────────────────────────────
function openReport() {
    var R = FS.result;
    if (!R || !R.rows.length) { toast('Run a query first — Format Results works on the result grid', 'warn'); return; }
    var a = rpAnalyse(R);
    RP.st = {
        title: rpDefaultTitle(R), a: a,
        dim: a.dims[0] || '', dim2: a.dims[1] || '',
        measure: a.measures[0] || '', date: a.dates[0] || '', top: 10
    };
    var ov = $('rp-overlay');
    if (!ov) {
        ov = document.createElement('div'); ov.id = 'rp-overlay'; ov.className = 'rp-overlay';
        ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeReport(); });
        document.body.appendChild(ov);
    }
    ov.innerHTML = rpShellHtml();
    ov.classList.add('open');
    document.addEventListener('keydown', rpKey);
    rpRender();
}
function closeReport() {
    var ov = $('rp-overlay'); if (ov) ov.classList.remove('open');
    rpDestroyCharts();
    rpMenu(null);
    document.removeEventListener('keydown', rpKey);
}
function rpKey(e) { if (e.key === 'Escape') { if (document.querySelector('.rp-menu.open')) rpMenu(null); else closeReport(); } }
function rpDestroyCharts() { Object.keys(RP.charts).forEach(function (k) { try { RP.charts[k].destroy(); } catch (e) { } }); RP.charts = {}; }
function rpSet(k, v) { RP.st[k] = v; rpRender(); }

function rpOpts(list, sel, none) {
    return (none ? '<option value="">' + none + '</option>' : '') +
        list.map(function (c) { return '<option value="' + esc(c) + '"' + (c === sel ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
}
function rpShellHtml() {
    var S = RP.st, a = S.a;
    return '<div class="rp-shell" role="dialog" aria-label="Formatted results">' +
        '<div class="rp-top">' +
        '<div class="rp-brand"><i class="fa-solid fa-wand-magic-sparkles"></i></div>' +
        '<input class="rp-title-input" id="rp-title" value="' + esc(S.title) + '" oninput="RP.st.title=this.value;$(\'rp-h1\').textContent=this.value" title="Report title — used in exports">' +
        '<div class="rp-top-actions">' +
        '<div class="rp-dd"><button class="fs-btn sm" onclick="rpMenu(\'rp-exp\', event)"><i class="fa-solid fa-download"></i> Export <i class="fa-solid fa-caret-down"></i></button>' +
        '<div class="rp-menu" id="rp-exp">' +
        '<button onclick="rpExportExcel()"><i class="fa-solid fa-file-excel" style="color:#16a34a"></i><span><b>Excel workbook</b><small>Dashboard sheet with charts + formatted data</small></span></button>' +
        '<button onclick="rpExportPdf()"><i class="fa-solid fa-file-pdf" style="color:#dc2626"></i><span><b>PDF report</b><small>KPIs, charts, summary and data</small></span></button>' +
        '<button onclick="rpExportHtml()"><i class="fa-solid fa-file-code" style="color:#2563eb"></i><span><b>HTML report</b><small>One file — opens in any browser</small></span></button>' +
        '<button onclick="rpExportCsv()"><i class="fa-solid fa-file-csv" style="color:#0f766e"></i><span><b>CSV</b><small>Raw rows</small></span></button>' +
        '<button onclick="rpExportPng()"><i class="fa-solid fa-image" style="color:#7c3aed"></i><span><b>Chart images</b><small>PNG of each chart</small></span></button>' +
        '</div></div>' +
        '<div class="rp-dd"><button class="fs-btn sm primary" onclick="rpMenu(\'rp-share\', event)"><i class="fa-solid fa-share-nodes"></i> Share <i class="fa-solid fa-caret-down"></i></button>' +
        '<div class="rp-menu" id="rp-share">' +
        '<button onclick="rpShareOutlook()"><i class="fa-solid fa-envelope" style="color:#2563eb"></i><span><b>Email via Outlook</b><small>Draft with the report inline + Excel attached</small></span></button>' +
        '<button onclick="rpCopyRich()"><i class="fa-solid fa-clipboard" style="color:#c74634"></i><span><b>Copy for email / Teams</b><small>Paste as a formatted report</small></span></button>' +
        '<button onclick="rpCopySummary()"><i class="fa-solid fa-align-left" style="color:#57504b"></i><span><b>Copy summary text</b><small>KPIs + insights as plain text</small></span></button>' +
        '<button onclick="rpCopyChart()"><i class="fa-solid fa-chart-simple" style="color:#7c3aed"></i><span><b>Copy chart image</b><small>Paste into chat, slides or mail</small></span></button>' +
        '<button onclick="closeReport();openSaveToApex()"><i class="fa-solid fa-cloud-arrow-up" style="color:#c74634"></i><span><b>Save to APEX</b><small>Share the data with the team as a refreshable table</small></span></button>' +
        '</div></div>' +
        '<button class="fs-icon-btn rp-close" onclick="closeReport()" title="Close (Esc)"><i class="fa-solid fa-xmark"></i></button>' +
        '</div></div>' +
        '<div class="rp-controls">' +
        (a.dims.length ? '<label>Group by <select onchange="rpSet(\'dim\', this.value)">' + rpOpts(a.dims, S.dim) + '</select></label>' : '') +
        '<label>Measure <select onchange="rpSet(\'measure\', this.value)">' + rpOpts(a.measures, S.measure, '(count of rows)') + '</select></label>' +
        (a.dims.length ? '<label>Top <select onchange="rpSet(\'top\', +this.value)">' + [5, 10, 15, 20, 30].map(function (n) { return '<option' + (n === S.top ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' : '') +
        (a.dates.length ? '<label>Trend by <select onchange="rpSet(\'date\', this.value)">' + rpOpts(a.dates, S.date, '(none)') + '</select></label>' : '') +
        (a.dims.length > 1 ? '<label>Also by <select onchange="rpSet(\'dim2\', this.value)">' + rpOpts(a.dims.filter(function (d) { return d !== S.dim; }), S.dim2, '(none)') + '</select></label>' : '') +
        '<span class="rp-controls-note" id="rp-note"></span>' +
        '</div>' +
        '<div class="rp-body" id="rp-body"></div>' +
        '</div>';
}
function rpMenu(id, e) {
    if (e) e.stopPropagation();
    document.querySelectorAll('.rp-menu.open').forEach(function (m) { if (m.id !== id) m.classList.remove('open'); });
    if (id) $(id).classList.toggle('open');
}
document.addEventListener('click', function (e) { if (!e.target.closest || !e.target.closest('.rp-dd')) rpMenu(null); });

// ── model: everything the views and exports need ───────────────
function rpModel() {
    var R = FS.result, S = RP.st, rows = R.filtered;
    var M = { title: S.title || 'Query results', rows: rows, total: R.rows.length, columns: R.columns, R: R, S: S };
    M.subtitle = [
        (FS.status && FS.status.instance ? FS.status.instance + ' · ' + FS.status.pod : ''),
        rows.length.toLocaleString() + ' rows' + (R.search ? ' (filtered from ' + R.rows.length.toLocaleString() + ')' : '') + (R.capped ? ' · capped at ' + R.limit.toLocaleString() : ''),
        'generated ' + new Date().toLocaleString() + ' by ' + appUserName()
    ].filter(Boolean).join('  ·  ');
    M.measureLabel = S.measure ? rpNice(S.measure) : 'Rows';
    M.stats = {}; S.a.measures.forEach(function (c) { M.stats[c] = rpStats(rows, c); });
    // KPIs: rows, groups, then up to 3 measures (selected first)
    var ms = S.measure ? [S.measure].concat(S.a.measures.filter(function (c) { return c !== S.measure; })) : S.a.measures.slice();
    M.kpis = [{ label: 'Rows', value: rows.length, sub: R.columns.length + ' columns' + (R.capped ? ' · capped' : '') }];
    if (S.dim) M.kpis.push({ label: 'Distinct ' + rpNice(S.dim), value: rpDistinct(rows, S.dim, 1e9), sub: 'groups' });
    ms.slice(0, 3).forEach(function (c) {
        var s = M.stats[c];
        M.kpis.push({ label: 'Total ' + rpNice(c), value: s.sum, sub: 'avg ' + rpCompact(s.avg) + ' · min ' + rpCompact(s.min) + ' · max ' + rpCompact(s.max), accent: c === S.measure });
    });
    M.groups = S.dim ? rpGroup(rows, S.dim, S.measure) : [];
    M.grandTotal = S.measure ? M.stats[S.measure].sum : rows.length;
    M.top = M.groups.slice(0, S.top);
    var rest = M.groups.slice(S.top);
    if (rest.length) M.otherVal = rest.reduce(function (t, g) { return t + (S.measure ? g.sum : g.n); }, 0);
    M.trend = S.date ? rpTrend(rows, S.date, S.measure) : null;
    M.groups2 = S.dim2 && S.dim2 !== S.dim ? rpGroup(rows, S.dim2, S.measure).slice(0, 10) : [];
    M.insights = rpInsights(M);
    return M;
}
function rpVal(M, g) { return M.S.measure ? g.sum : g.n; }
function rpInsights(M) {
    var S = M.S, out = [], gt = M.grandTotal;
    if (M.groups.length && gt) {
        var g0 = M.groups[0], share = rpVal(M, g0) / gt;
        out.push({ icon: 'fa-trophy', text: '<b>' + esc(g0.key) + '</b> leads ' + esc(rpNice(S.dim)) + ' with ' + esc(rpCompact(rpVal(M, g0))) + ' ' + (S.measure ? esc(M.measureLabel.toLowerCase()) : 'rows') + ' — ' + rpPct(share) + ' of the total.' });
        if (M.groups.length > 3) {
            var t3 = M.groups.slice(0, 3).reduce(function (t, g) { return t + rpVal(M, g); }, 0) / gt;
            out.push({ icon: 'fa-layer-group', text: 'The top 3 of ' + M.groups.length + ' ' + esc(rpNice(S.dim).toLowerCase()) + ' groups make up <b>' + rpPct(t3) + '</b>' + (t3 > 0.8 ? ' — highly concentrated.' : t3 < 0.4 ? ' — a broad spread.' : '.') });
        }
    }
    if (M.trend && M.trend.values.length > 1) {
        var v = M.trend.values, last = v[v.length - 1], prev = v[v.length - 2];
        var peak = v.indexOf(Math.max.apply(null, v));
        out.push({ icon: 'fa-chart-line', text: 'Peak ' + M.trend.unit + ' is <b>' + esc(M.trend.labels[peak]) + '</b> (' + rpCompact(v[peak]) + ')' +
            (prev ? '; the latest ' + M.trend.unit + ' is ' + (last >= prev ? 'up ' : 'down ') + rpPct(Math.abs(last - prev) / Math.abs(prev)) + ' on the one before.' : '.') });
    }
    if (S.measure) {
        var st = M.stats[S.measure];
        if (st.nulls) out.push({ icon: 'fa-circle-exclamation', text: st.nulls.toLocaleString() + ' row' + (st.nulls === 1 ? ' has' : 's have') + ' no ' + esc(M.measureLabel.toLowerCase()) + ' value.' });
        if (st.min !== null && st.min < 0) out.push({ icon: 'fa-arrow-trend-down', text: 'Contains negative ' + esc(M.measureLabel.toLowerCase()) + ' values (lowest ' + rpNum(st.min) + ').' });
    }
    var empty = M.columns.filter(function (c) { return M.rows.every(function (r) { return r[c] === undefined || r[c] === null || r[c] === ''; }); });
    if (empty.length) out.push({ icon: 'fa-eye-slash', text: empty.length + ' column' + (empty.length === 1 ? ' is' : 's are') + ' empty in every row: ' + empty.slice(0, 4).map(esc).join(', ') + (empty.length > 4 ? '…' : '') + '.' });
    if (M.R.capped) out.push({ icon: 'fa-scissors', text: 'The result was capped at ' + M.R.limit.toLocaleString() + ' rows — raise the row limit for complete totals.' });
    return out;
}

// ── render ─────────────────────────────────────────────────────
function rpRender() {
    var M = rpModel(), S = RP.st, body = $('rp-body');
    RP.model = M;
    $('rp-note').textContent = M.R.search ? 'Filtered by "' + M.R.search + '"' : '';
    var h = [];
    h.push('<div class="rp-hero"><h1 id="rp-h1">' + esc(M.title) + '</h1><p>' + esc(M.subtitle) + '</p></div>');
    h.push('<div class="rp-kpis">' + M.kpis.map(function (k) {
        return '<div class="rp-kpi' + (k.accent ? ' accent' : '') + '"><span>' + esc(k.label) + '</span><b title="' + esc(rpNum(k.value)) + '">' + esc(rpCompact(k.value)) + '</b><small>' + esc(k.sub) + '</small></div>';
    }).join('') + '</div>');
    if (M.insights.length) h.push('<div class="rp-card rp-insights"><h3><i class="fa-solid fa-lightbulb"></i> Insights</h3><ul>' +
        M.insights.map(function (x) { return '<li><i class="fa-solid ' + x.icon + '"></i><span>' + x.text + '</span></li>'; }).join('') + '</ul></div>');

    var charts = [];
    if (M.top.length) charts.push('<div class="rp-card rp-chart"><h3>Top ' + M.top.length + ' ' + esc(rpNice(S.dim)) + ' by ' + esc(M.measureLabel.toLowerCase()) + '</h3>' +
        '<div class="rp-canvas" style="height:' + Math.max(180, M.top.length * 26 + 40) + 'px"><canvas id="rp-c-top"></canvas></div>' +
        (M.otherVal ? '<p class="rp-foot">+ ' + (M.groups.length - M.top.length) + ' more groups: ' + rpCompact(M.otherVal) + ' (' + rpPct(M.otherVal / (M.grandTotal || 1)) + ')</p>' : '') + '</div>');
    if (M.trend && M.trend.labels.length > 1) charts.push('<div class="rp-card rp-chart"><h3>' + esc(M.measureLabel) + ' by ' + M.trend.unit + ' · ' + esc(rpNice(S.date)) + '</h3>' +
        '<div class="rp-canvas" style="height:260px"><canvas id="rp-c-trend"></canvas></div></div>');
    else if (M.groups2.length) charts.push('<div class="rp-card rp-chart"><h3>' + esc(M.measureLabel) + ' by ' + esc(rpNice(S.dim2)) + '</h3>' +
        '<div class="rp-canvas" style="height:' + Math.max(180, M.groups2.length * 26 + 40) + 'px"><canvas id="rp-c-dim2"></canvas></div></div>');
    if (charts.length) h.push('<div class="rp-charts' + (charts.length === 1 ? ' one' : '') + '">' + charts.join('') + '</div>');

    if (M.groups.length) {
        var maxG = Math.max.apply(null, M.groups.map(function (g) { return Math.abs(rpVal(M, g)); })) || 1;
        h.push('<div class="rp-card"><h3><i class="fa-solid fa-table-list"></i> Summary by ' + esc(rpNice(S.dim)) + ' <small>' + M.groups.length + ' groups</small></h3><div class="rp-table-wrap short"><table class="rp-table"><thead><tr>' +
            '<th>' + esc(rpNice(S.dim)) + '</th><th class="n">Rows</th>' + (S.measure ? '<th class="n">' + esc(M.measureLabel) + '</th><th class="n">Average</th>' : '') + '<th class="bar">Share</th></tr></thead><tbody>' +
            M.groups.slice(0, 100).map(function (g) {
                var v = rpVal(M, g), p = M.grandTotal ? v / M.grandTotal : 0;
                return '<tr><td>' + esc(g.key) + '</td><td class="n">' + g.n.toLocaleString() + '</td>' +
                    (S.measure ? '<td class="n">' + rpNum(g.sum) + '</td><td class="n">' + rpNum(g.n ? g.sum / g.n : 0) + '</td>' : '') +
                    '<td class="bar"><div class="rp-bar"><div class="rp-track"><i style="width:' + Math.max(1, Math.abs(v) / maxG * 100).toFixed(1) + '%"></i></div><span>' + rpPct(p) + '</span></div></td></tr>';
            }).join('') +
            '</tbody><tfoot><tr><td>Total</td><td class="n">' + M.rows.length.toLocaleString() + '</td>' + (S.measure ? '<td class="n">' + rpNum(M.grandTotal) + '</td><td class="n">' + rpNum(M.stats[S.measure].avg) + '</td>' : '') + '<td class="bar">100%</td></tr></tfoot></table></div>' +
            (M.groups.length > 100 ? '<p class="rp-foot">First 100 of ' + M.groups.length + ' groups — all are in the Excel export.</p>' : '') + '</div>');
    }
    h.push(rpDataTableHtml(M));
    body.innerHTML = h.join('');
    rpDrawCharts(M);
}
function rpDataTableHtml(M) {
    var R = M.R, S = RP.st, rows = M.rows.slice(0, RP_MAX_TABLE);
    var max = {};
    S.a.measures.forEach(function (c) { var s = M.stats[c]; max[c] = Math.max(Math.abs(s.max || 0), Math.abs(s.min || 0)) || 1; });
    return '<div class="rp-card"><h3><i class="fa-solid fa-table"></i> Data <small>' + (M.rows.length > RP_MAX_TABLE ? 'first ' + RP_MAX_TABLE + ' of ' + M.rows.length.toLocaleString() + ' rows' : M.rows.length.toLocaleString() + ' rows') + '</small></h3>' +
        '<div class="rp-table-wrap"><table class="rp-table data"><thead><tr><th class="rn">#</th>' +
        M.columns.map(function (c) { return '<th class="' + (S.a.measures.indexOf(c) >= 0 ? 'n' : '') + '">' + esc(rpNice(c)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        rows.map(function (r, i) {
            return '<tr><td class="rn">' + (i + 1) + '</td>' + M.columns.map(function (c) {
                var v = r[c];
                if (v === undefined || v === null || v === '') return '<td class="nul">—</td>';
                if (S.a.measures.indexOf(c) >= 0 && typeof v === 'number')
                    return '<td class="n db' + (v < 0 ? ' neg' : '') + '"><i style="width:' + (Math.abs(v) / max[c] * 100).toFixed(1) + '%"></i><span>' + rpNum(v) + '</span></td>';
                var f = fmtCell(R, c, v);
                return '<td' + (R.isNum[c] ? ' class="n"' : '') + ' title="' + esc(f) + '">' + esc(f) + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody>' +
        (S.a.measures.length ? '<tfoot><tr><td class="rn"></td>' + M.columns.map(function (c) { return S.a.measures.indexOf(c) >= 0 ? '<td class="n">' + rpNum(M.stats[c].sum) + '</td>' : '<td></td>'; }).join('') + '</tr></tfoot>' : '') +
        '</table></div></div>';
}

// ── charts (Chart.js; single-series, one hue each; hover tooltips built in) ──
function rpBaseOpts(horizontal) {
    var ax = { grid: { color: RP_COLORS.grid, drawTicks: false }, border: { display: false }, ticks: { color: RP_COLORS.muted, font: { size: 11 }, padding: 6 } };
    var cat = { grid: { display: false }, border: { color: RP_COLORS.grid }, ticks: { color: RP_COLORS.ink, font: { size: 11 }, padding: 4 } };
    var valTicks = Object.assign({}, ax.ticks, { callback: function (v) { return rpCompact(v); } });
    return {
        responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        plugins: {
            legend: { display: false },
            tooltip: { backgroundColor: '#1f1b19', padding: 10, cornerRadius: 6, displayColors: false, callbacks: { label: function (c) { return ' ' + rpNum(horizontal ? c.parsed.x : c.parsed.y); } } }
        },
        scales: horizontal
            ? { x: Object.assign({}, ax, { ticks: valTicks, beginAtZero: true }), y: Object.assign({}, cat, { ticks: Object.assign({}, cat.ticks, { callback: function (v) { var l = this.getLabelForValue(v); return l.length > 28 ? l.slice(0, 27) + '…' : l; } }) }) }
            : { x: cat, y: Object.assign({}, ax, { ticks: valTicks, beginAtZero: true }) }
    };
}
function rpBar(id, labels, values, color) {
    var el = $(id); if (!el) return;
    RP.charts[id] = new Chart(el, {
        type: 'bar',
        data: { labels: labels, datasets: [{ data: values, backgroundColor: color, hoverBackgroundColor: color, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 22, categoryPercentage: 0.8, barPercentage: 0.9 }] },
        options: Object.assign(rpBaseOpts(true), { indexAxis: 'y' })
    });
}
function rpDrawCharts(M) {
    rpDestroyCharts();
    if (!window.Chart) return;
    if (M.top.length) rpBar('rp-c-top', M.top.map(function (g) { return g.key; }), M.top.map(function (g) { return rpVal(M, g); }), RP_COLORS.series);
    if ($('rp-c-trend')) {
        RP.charts['rp-c-trend'] = new Chart($('rp-c-trend'), {
            type: 'line',
            data: { labels: M.trend.labels, datasets: [{ data: M.trend.values, borderColor: RP_COLORS.series, backgroundColor: 'rgba(42,120,214,.10)', fill: true, borderWidth: 2, tension: 0.25, pointRadius: M.trend.labels.length > 40 ? 0 : 4, pointHoverRadius: 6, pointBackgroundColor: RP_COLORS.series, pointBorderColor: '#fff', pointBorderWidth: 2 }] },
            options: Object.assign(rpBaseOpts(false), { interaction: { mode: 'index', intersect: false } })
        });
    }
    if ($('rp-c-dim2')) rpBar('rp-c-dim2', M.groups2.map(function (g) { return g.key; }), M.groups2.map(function (g) { return rpVal(M, g); }), RP_COLORS.series2);
}
/** Chart images for exports: [{ id, title, dataUrl, w, h }] rendered on white. */
function rpChartImages() {
    return Object.keys(RP.charts).map(function (id) {
        var ch = RP.charts[id], src = ch.canvas;
        var c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
        var x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0);
        var card = src.closest('.rp-card'), t = card ? card.querySelector('h3').textContent : id;
        return { id: id, title: t, dataUrl: c.toDataURL('image/png'), w: src.width, h: src.height, cw: src.clientWidth, chh: src.clientHeight };
    });
}
function rpFileName(ext) { return (RP.model.title || 'report').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) + '_' + nowStamp() + '.' + ext; }

// ── Excel: Dashboard sheet (KPIs, insights, charts, summary) + Data + SQL ──
function rpBuildExcel() {
    var M = RP.model, S = RP.st;
    var wb = new ExcelJS.Workbook(); wb.creator = "Gray's WMS — Fusion SQL";
    var red = 'FFC74634', ink = 'FF312D2A', mut = 'FF8A817B';
    var d = wb.addWorksheet('Dashboard', { views: [{ showGridLines: false }] });
    d.columns = [{ width: 3 }, { width: 30 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
    d.getCell('B2').value = M.title; d.getCell('B2').font = { size: 18, bold: true, color: { argb: ink } };
    d.getCell('B3').value = M.subtitle; d.getCell('B3').font = { size: 9, color: { argb: mut } };
    var row = 5;
    M.kpis.forEach(function (k, i) {
        var col = 2 + i * 1;
        var l = d.getCell(row, col), v = d.getCell(row + 1, col), s = d.getCell(row + 2, col);
        l.value = k.label.toUpperCase(); l.font = { size: 8, bold: true, color: { argb: mut } };
        v.value = k.value; v.numFmt = '#,##0.##'; v.font = { size: 16, bold: true, color: { argb: k.accent ? red : ink } };
        s.value = k.sub; s.font = { size: 8, color: { argb: mut } };
        [l, v, s].forEach(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF8F7' } }; c.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }; });
    });
    row += 4;
    if (M.insights.length) {
        d.getCell(row, 2).value = 'Insights'; d.getCell(row, 2).font = { bold: true, size: 11, color: { argb: ink } }; row++;
        M.insights.forEach(function (x) { d.getCell(row, 2).value = '• ' + x.text.replace(/<[^>]+>/g, ''); d.mergeCells(row, 2, row, 8); row++; });
        row++;
    }
    var imgs = rpChartImages();
    imgs.forEach(function (im, i) {
        d.getCell(row, 2 + i * 4).value = im.title; d.getCell(row, 2 + i * 4).font = { bold: true, color: { argb: ink } };
        var id = wb.addImage({ base64: im.dataUrl, extension: 'png' });
        var w = 520, h = Math.round(w * im.h / im.w);
        d.addImage(id, { tl: { col: 1 + i * 4, row: row }, ext: { width: w, height: h } });
        im.rowsUsed = Math.ceil(h / 20) + 2;
    });
    if (imgs.length) row += Math.max.apply(null, imgs.map(function (x) { return x.rowsUsed; })) + 1;
    if (M.groups.length) {
        d.getCell(row, 2).value = 'Summary by ' + rpNice(S.dim); d.getCell(row, 2).font = { bold: true, size: 11, color: { argb: ink } }; row++;
        var hdr = [rpNice(S.dim), 'Rows'].concat(S.measure ? [M.measureLabel, 'Average'] : []).concat(['Share']);
        hdr.forEach(function (t, i) { var c = d.getCell(row, 2 + i); c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: red } }; });
        var first = row + 1;
        M.groups.forEach(function (g) {
            row++;
            var vals = [g.key, g.n].concat(S.measure ? [g.sum, g.n ? g.sum / g.n : 0] : []).concat([M.grandTotal ? rpVal(M, g) / M.grandTotal : 0]);
            vals.forEach(function (v, i) {
                var c = d.getCell(row, 2 + i); c.value = v;
                if (i === vals.length - 1) c.numFmt = '0.0%'; else if (i > 0) c.numFmt = '#,##0.##';
            });
        });
        var shareCol = 2 + hdr.length - 1;
        d.addConditionalFormatting({ ref: d.getCell(first, shareCol).address + ':' + d.getCell(row, shareCol).address, rules: [{ type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: 'FF2A78D6' } }] });
    }
    // Data sheet
    var ws = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = M.columns.map(function (c) {
        var mx = c.length; M.rows.slice(0, 300).forEach(function (r) { var v = r[c]; if (v != null && String(v).length > mx) mx = String(v).length; });
        return { header: c, key: c, width: Math.max(10, Math.min(45, mx + 2)) };
    });
    M.rows.forEach(function (r) { var o = {}; M.columns.forEach(function (c) { var v = r[c]; o[c] = v === undefined || v === '' ? null : (M.R.isId[c] ? String(v) : v); }); ws.addRow(o); });
    ws.getRow(1).eachCell(function (c) { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: red } }; });
    M.columns.forEach(function (c, i) { if (S.a.measures.indexOf(c) >= 0) ws.getColumn(i + 1).numFmt = '#,##0.##'; });
    if (S.a.measures.length && M.rows.length) {
        var tr = ws.addRow({}); tr.font = { bold: true };
        M.columns.forEach(function (c, i) {
            if (S.a.measures.indexOf(c) < 0) return;
            var L = ws.getColumn(i + 1).letter;
            tr.getCell(i + 1).value = { formula: 'SUBTOTAL(109,' + L + '2:' + L + (M.rows.length + 1) + ')' };
        });
        tr.getCell(1).value = tr.getCell(1).value || 'Total';
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: M.columns.length } };
    var sq = wb.addWorksheet('SQL'); sq.getCell('A1').value = M.R.sql; sq.getCell('A1').alignment = { wrapText: true, vertical: 'top' }; sq.getColumn(1).width = 120;
    return wb.xlsx.writeBuffer();
}
function rpExportExcel() {
    rpMenu(null);
    if (typeof ExcelJS === 'undefined') { toast('Excel library not loaded (offline?)', 'err'); return; }
    rpBuildExcel().then(function (buf) {
        downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), rpFileName('xlsx'));
        toast('Excel report exported');
    });
}

// ── PDF ────────────────────────────────────────────────────────
function rpExportPdf() {
    rpMenu(null);
    if (!window.jspdf) { toast('PDF library not loaded (offline?)', 'err'); return; }
    var M = RP.model, S = RP.st;
    var doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    var W = doc.internal.pageSize.getWidth(), y = 0;
    doc.setFillColor(49, 45, 42); doc.rect(0, 0, W, 58, 'F');
    doc.setFillColor(199, 70, 52); doc.rect(0, 58, W, 3, 'F');
    doc.setTextColor(255); doc.setFontSize(17); doc.text(M.title, 32, 30);
    doc.setFontSize(8); doc.setTextColor(210, 204, 199); doc.text(M.subtitle, 32, 46);
    y = 80;
    var kw = (W - 64 - (M.kpis.length - 1) * 10) / M.kpis.length;
    M.kpis.forEach(function (k, i) {
        var x = 32 + i * (kw + 10);
        doc.setFillColor(250, 248, 247); doc.setDrawColor(231, 226, 222); doc.roundedRect(x, y, kw, 58, 6, 6, 'FD');
        doc.setFontSize(7); doc.setTextColor(138, 129, 123); doc.text(k.label.toUpperCase(), x + 10, y + 15);
        doc.setFontSize(16); if (k.accent) doc.setTextColor(199, 70, 52); else doc.setTextColor(49, 45, 42); doc.text(rpCompact(k.value), x + 10, y + 36);
        doc.setFontSize(6.5); doc.setTextColor(138, 129, 123); doc.text(doc.splitTextToSize(k.sub, kw - 20)[0], x + 10, y + 50);
    });
    y += 76;
    var imgs = rpChartImages();
    if (imgs.length) {
        var gap = 16, iw = imgs.length === 1 ? W - 64 : (W - 64 - gap) / 2, maxH = 0;
        imgs.forEach(function (im, i) {
            var ih = Math.min(220, iw * im.h / im.w), x = 32 + i * (iw + gap);
            doc.setFontSize(9); doc.setTextColor(49, 45, 42); doc.text(im.title, x, y);
            doc.addImage(im.dataUrl, 'PNG', x, y + 6, ih * im.w / im.h, ih);
            maxH = Math.max(maxH, ih);
        });
        y += maxH + 22;
    }
    if (M.insights.length) {
        doc.setFontSize(9); doc.setTextColor(49, 45, 42);
        M.insights.forEach(function (x) {
            var lines = doc.splitTextToSize('•  ' + x.text.replace(/<[^>]+>/g, ''), W - 64);
            if (y + lines.length * 11 > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); y = 40; }
            doc.text(lines, 32, y); y += lines.length * 11 + 2;
        });
        y += 8;
    }
    var head = { fillColor: [199, 70, 52], textColor: 255, fontStyle: 'bold' };
    if (M.groups.length) {
        doc.autoTable({
            startY: y, head: [[rpNice(S.dim), 'Rows'].concat(S.measure ? [M.measureLabel, 'Average'] : []).concat(['Share'])],
            body: M.groups.slice(0, 200).map(function (g) { return [g.key, g.n.toLocaleString()].concat(S.measure ? [rpNum(g.sum), rpNum(g.n ? g.sum / g.n : 0)] : []).concat([rpPct(M.grandTotal ? rpVal(M, g) / M.grandTotal : 0)]); }),
            styles: { fontSize: 8, cellPadding: 3 }, headStyles: head, alternateRowStyles: { fillColor: [250, 248, 247] }, margin: { left: 32, right: 32 }
        });
    }
    doc.addPage();
    doc.setFontSize(11); doc.setTextColor(49, 45, 42); doc.text('Data (' + Math.min(M.rows.length, 3000).toLocaleString() + ' of ' + M.rows.length.toLocaleString() + ' rows)', 32, 32);
    doc.autoTable({
        startY: 42, head: [M.columns.map(rpNice)],
        body: M.rows.slice(0, 3000).map(function (r) { return M.columns.map(function (c) { var f = fmtCell(M.R, c, r[c]); return f === null ? '' : f; }); }),
        styles: { fontSize: M.columns.length > 12 ? 5.5 : 7, cellPadding: 2.5, overflow: 'linebreak' }, headStyles: head,
        alternateRowStyles: { fillColor: [250, 248, 247] }, margin: { left: 24, right: 24 },
        didDrawPage: function () { doc.setFontSize(7); doc.setTextColor(138, 129, 123); doc.text(M.title + '  ·  Fusion SQL', 24, doc.internal.pageSize.getHeight() - 12); }
    });
    doc.save(rpFileName('pdf'));
    toast('PDF report exported');
}

// ── HTML (standalone report + email body) ──────────────────────
/** Inline-styled HTML (works in browsers, Outlook and Teams paste). imgSrc(im) gives each chart's src. */
function rpReportHtml(opts) {
    var M = RP.model, S = RP.st, maxRows = opts.maxRows, imgs = rpChartImages();
    var f = 'font-family:Segoe UI,Arial,sans-serif;';
    var th = 'style="' + f + 'background:#c74634;color:#fff;font-size:12px;font-weight:600;text-align:left;padding:7px 10px;border:1px solid #c74634;"';
    var thn = th.replace('text-align:left', 'text-align:right');
    var td = function (n, alt) { return 'style="' + f + 'font-size:12px;padding:6px 10px;border:1px solid #ece8e4;' + (n ? 'text-align:right;' : '') + (alt ? 'background:#faf8f7;' : '') + 'color:#2b2623;"'; };
    var h = [];
    h.push('<div style="' + f + 'color:#2b2623;max-width:1100px;">');
    h.push('<div style="background:#312d2a;border-bottom:3px solid #c74634;padding:16px 20px;border-radius:8px 8px 0 0;"><div style="' + f + 'font-size:20px;font-weight:700;color:#fff;">' + esc(M.title) + '</div>' +
        '<div style="' + f + 'font-size:11px;color:#d2ccc7;margin-top:4px;">' + esc(M.subtitle) + '</div></div>');
    h.push('<table cellspacing="8" cellpadding="0" style="margin:10px 0;"><tr>' + M.kpis.map(function (k) {
        return '<td style="' + f + 'background:#faf8f7;border:1px solid #e7e2de;border-radius:8px;padding:10px 14px;min-width:130px;vertical-align:top;">' +
            '<div style="font-size:10px;font-weight:700;color:#8a817b;text-transform:uppercase;letter-spacing:.5px;">' + esc(k.label) + '</div>' +
            '<div style="font-size:22px;font-weight:700;color:' + (k.accent ? '#c74634' : '#312d2a') + ';margin:2px 0;">' + esc(rpCompact(k.value)) + '</div>' +
            '<div style="font-size:10px;color:#8a817b;">' + esc(k.sub) + '</div></td>';
    }).join('') + '</tr></table>');
    if (M.insights.length) h.push('<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin:6px 0 12px;"><div style="font-size:13px;font-weight:700;margin-bottom:4px;">Insights</div>' +
        M.insights.map(function (x) { return '<div style="font-size:12px;margin:3px 0;">• ' + x.text + '</div>'; }).join('') + '</div>');
    if (imgs.length) h.push('<table cellspacing="0" cellpadding="6"><tr>' + imgs.map(function (im) {
        var w = imgs.length === 1 ? 760 : 520;
        return '<td style="vertical-align:top;"><div style="' + f + 'font-size:13px;font-weight:700;margin-bottom:4px;">' + esc(im.title) + '</div><img src="' + opts.imgSrc(im) + '" width="' + w + '" style="width:' + w + 'px;max-width:100%;border:1px solid #ece8e4;border-radius:6px;" alt="' + esc(im.title) + '"></td>';
    }).join('') + '</tr></table>');
    if (M.groups.length) {
        h.push('<div style="font-size:14px;font-weight:700;margin:14px 0 6px;">Summary by ' + esc(rpNice(S.dim)) + '</div><table cellspacing="0" style="border-collapse:collapse;"><tr><th ' + th + '>' + esc(rpNice(S.dim)) + '</th><th ' + thn + '>Rows</th>' +
            (S.measure ? '<th ' + thn + '>' + esc(M.measureLabel) + '</th>' : '') + '<th ' + thn + '>Share</th></tr>' +
            M.groups.slice(0, opts.maxGroups || 50).map(function (g, i) {
                return '<tr><td ' + td(0, i % 2) + '>' + esc(g.key) + '</td><td ' + td(1, i % 2) + '>' + g.n.toLocaleString() + '</td>' + (S.measure ? '<td ' + td(1, i % 2) + '>' + rpNum(g.sum) + '</td>' : '') +
                    '<td ' + td(1, i % 2) + '>' + rpPct(M.grandTotal ? rpVal(M, g) / M.grandTotal : 0) + '</td></tr>';
            }).join('') + '</table>');
    }
    var rows = M.rows.slice(0, maxRows);
    h.push('<div style="font-size:14px;font-weight:700;margin:16px 0 6px;">Data <span style="font-size:11px;font-weight:400;color:#8a817b;">' + (M.rows.length > maxRows ? 'first ' + maxRows + ' of ' + M.rows.length.toLocaleString() + ' rows' + (opts.attached ? ' — all rows in the attached Excel' : '') : M.rows.length.toLocaleString() + ' rows') + '</span></div>');
    h.push('<table cellspacing="0" style="border-collapse:collapse;"><tr>' + M.columns.map(function (c) { return '<th ' + (S.a.measures.indexOf(c) >= 0 ? thn : th) + '>' + esc(rpNice(c)) + '</th>'; }).join('') + '</tr>' +
        rows.map(function (r, i) { return '<tr>' + M.columns.map(function (c) { var v = fmtCell(M.R, c, r[c]); return '<td ' + td(S.a.measures.indexOf(c) >= 0, i % 2) + '>' + (v === null ? '' : esc(v)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>');
    h.push('<div style="font-size:10px;color:#8a817b;margin-top:12px;">Generated with Gray\'s WMS · Fusion SQL</div></div>');
    return h.join('');
}
function rpExportHtml() {
    rpMenu(null);
    var body = rpReportHtml({ maxRows: RP_MAX_HTML, maxGroups: 500, imgSrc: function (im) { return im.dataUrl; } });
    var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(RP.model.title) + '</title>' +
        '<style>body{margin:0;padding:24px;background:#f4f2f0;}@media print{body{background:#fff;padding:0}}</style></head><body>' + body + '</body></html>';
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), rpFileName('html'));
    toast('HTML report exported — opens in any browser');
}
function rpExportCsv() {
    rpMenu(null);
    var M = RP.model, q = function (v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [M.columns.map(q).join(',')].concat(M.rows.map(function (r) { return M.columns.map(function (c) { return q(r[c]); }).join(','); }));
    downloadBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), rpFileName('csv'));
}
function rpDataUrlBlob(u) {
    var b = atob(u.split(',')[1]), a = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return new Blob([a], { type: 'image/png' });
}
function rpExportPng() {
    rpMenu(null);
    var imgs = rpChartImages();
    if (!imgs.length) { toast('No charts in this report', 'warn'); return; }
    imgs.forEach(function (im, i) { setTimeout(function () { downloadBlob(rpDataUrlBlob(im.dataUrl), rpFileName('chart' + (i + 1) + '.png').replace(/\.chart/, '_chart')); }, i * 300); });
}

// ── Share ──────────────────────────────────────────────────────
function rpB64(buf) {
    var bytes = new Uint8Array(buf), s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
}
function rpShareOutlook() {
    rpMenu(null);
    var M = RP.model, imgs = rpChartImages();
    var html = rpReportHtml({ maxRows: RP_MAX_EMAIL, maxGroups: 25, attached: true, imgSrc: function (im) { return 'cid:' + im.id + '.png'; } });
    var atts = imgs.map(function (im) { return { name: im.id + '.png', cid: im.id + '.png', base64: im.dataUrl.split(',')[1] }; });
    var excel = typeof ExcelJS !== 'undefined' ? rpBuildExcel() : Promise.resolve(null);
    toast('Preparing the email…', 'warn');
    excel.then(function (buf) {
        if (buf) atts.push({ name: rpFileName('xlsx'), base64: rpB64(buf) });
        return fsCall('fusionSqlShareOutlook', { subject: M.title + ' — ' + M.rows.length.toLocaleString() + ' rows', html: html, attachments: atts });
    }).then(function (r) {
        if (r && r.via === 'outlook') toast('Outlook draft opened — review and send');
        else if (r && r.via === 'folder') toast('Outlook not found — the report files are in the folder that just opened', 'warn');
        else toast('Could not prepare the email: ' + ((r && r.error) || 'unknown error'), 'err');
    }).catch(function (e) { toast('Email failed: ' + e, 'err'); });
}
function rpCopyRich() {
    rpMenu(null);
    var html = rpReportHtml({ maxRows: RP_MAX_EMAIL, maxGroups: 25, imgSrc: function (im) { return im.dataUrl; } });
    var text = rpSummaryText();
    if (navigator.clipboard && window.ClipboardItem) {
        navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
            .then(function () { toast('Report copied — paste into Outlook, Teams or Word'); }, function () { copyText(text); });
    } else copyText(text);
}
function rpSummaryText() {
    var M = RP.model, S = RP.st, L = [];
    L.push(M.title); L.push(M.subtitle); L.push('');
    M.kpis.forEach(function (k) { L.push(k.label + ': ' + rpNum(k.value) + '  (' + k.sub + ')'); });
    if (M.insights.length) { L.push(''); L.push('Insights'); M.insights.forEach(function (x) { L.push('• ' + x.text.replace(/<[^>]+>/g, '')); }); }
    if (M.top.length) { L.push(''); L.push('Top ' + M.top.length + ' ' + rpNice(S.dim) + ' by ' + M.measureLabel.toLowerCase()); M.top.forEach(function (g, i) { L.push((i + 1) + '. ' + g.key + ' — ' + rpNum(rpVal(M, g)) + ' (' + rpPct(M.grandTotal ? rpVal(M, g) / M.grandTotal : 0) + ')'); }); }
    return L.join('\n');
}
function rpCopySummary() { rpMenu(null); copyText(rpSummaryText()); }
function rpCopyChart() {
    rpMenu(null);
    var imgs = rpChartImages();
    if (!imgs.length) { toast('No charts in this report', 'warn'); return; }
    if (!(navigator.clipboard && window.ClipboardItem)) { toast('Clipboard images are not supported here — use Export › Chart images', 'warn'); return; }
    navigator.clipboard.write([new ClipboardItem({ 'image/png': rpDataUrlBlob(imgs[0].dataUrl) })])
        .then(function () { toast('Chart copied — paste it anywhere'); }, function () { toast('Copy failed — use Export › Chart images', 'err'); });
}
