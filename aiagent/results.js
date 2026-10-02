/* AI Agent — results panel: one tab per result (Fusion run, analysis, report). Rows stay in the host's result cache
   (agentResult); the panel shows KPIs, a chart (fixed colours, legend, the grid is the table view), a sortable /
   filterable grid and follow-ups: CSV, copy for Excel, open in Fusion SQL, save query, watch it, ask about it. */

AG.lastDry = {};
AG.resById = function (id) { return AG.results.filter(function (r) { return r.id === id; })[0]; };
AG.addResult = function (data, quiet) {
    var id = data.result_id || data.report_id; if (!id) return null;
    var r = AG.resById(id);
    if (!r) { r = { id: id, title: data.title || 'Result', rows: data.row_count, report: data.report || null, doc: data.doc || null, data: data.page_data || null }; AG.results.push(r); }
    else { if (data.report) r.report = data.report; if (data.doc) r.doc = data.doc; if (data.row_count != null) r.rows = data.row_count; }
    $('results').parentNode.classList.remove('nores');
    if (!quiet || !AG.resSel) AG.selectResult(id); else AG.renderResults();
    return r;
};
AG.fetchResult = function (id) {
    var r = AG.resById(id);
    if (r && r.data) return Promise.resolve(r.data);
    return host('agentResult', { resultId: id, limit: 50000 }, 60000).then(function (d) {
        if (!d || d.ok === false) throw (d && d.error) || 'Result not available';
        if (r) r.data = d;
        return d;
    });
};
AG.selectResult = function (id) { AG.resSel = id; AG.renderResults(); };
AG.renderResults = function () {
    var tabs = $('res-tabs'), body = $('res-body');
    tabs.innerHTML = AG.results.map(function (r) { return '<div class="res-tab' + (r.id === AG.resSel ? ' on' : '') + '" data-id="' + r.id + '" title="' + esc(r.title) + '">' + esc(r.title) + (r.rows != null ? ' · ' + r.rows : '') + '</div>'; }).join('');
    tabs.querySelectorAll('.res-tab').forEach(function (t) { t.onclick = function () { AG.selectResult(t.dataset.id); }; });
    var r = AG.resById(AG.resSel);
    if (!r) { body.innerHTML = '<div class="empty"><i class="fa-regular fa-chart-bar big"></i><p>Query results, charts and reports appear here.</p></div>'; return; }
    if (r.report) { AG.renderReport(r); return; }
    if (r.doc) { AG.renderDoc(r); return; }
    body.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading…</div>';
    AG.fetchResult(r.id).then(function (d) { if (AG.resSel === r.id) AG.renderGrid(r, d); }, function (e) {
        body.innerHTML = '<div class="card"><b>' + esc(r.title) + '</b><p class="muted sm" style="margin-top:6px">' + esc(e) + '</p></div>';
    });
};
AG.applyView = function (tool, data) { if (data && (data.result_id || data.report_id)) AG.selectResult(data.result_id || data.report_id); };

function isNum(c) { return c.type === 'number'; }
function numv(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function fmt(v) { var n = parseFloat(v); return isNaN(n) ? '' : Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toLocaleString(undefined, { maximumFractionDigits: 2 }); }

/** Column formats of a result (format_result) by upper-case column name. */
AG.colFmt = function (r, c) { var cs = r && r.fmt && r.fmt.columns; return cs ? cs[String(c.name).toUpperCase()] || null : null; };
/** The visible columns in display order (format_result hide / order). */
AG.visibleCols = function (r, cols) {
    var f = r && r.fmt, idx = cols.map(function (_, i) { return i; }), up = cols.map(function (c) { return String(c.name).toUpperCase(); });
    if (f && f.hide && f.hide.length) { var h = f.hide.map(function (x) { return String(x).toUpperCase(); }); idx = idx.filter(function (i) { return h.indexOf(up[i]) < 0; }); }
    if (f && f.order && f.order.length) { var o = f.order.map(function (x) { return String(x).toUpperCase(); }); idx.sort(function (a, b) { var x = o.indexOf(up[a]), y = o.indexOf(up[b]); return (x < 0 ? 1e6 + a : x) - (y < 0 ? 1e6 + b : y); }); }
    return idx;
};
/** One formatted table (results panel, reports, Copy formatted). inline = colours as inline styles for e-mail. */
AG.gridTable = function (r, d, shown, sortable, inline) {
    var cols = d.columns, vis = AG.visibleCols(r, cols), up = cols.map(function (c) { return String(c.name).toUpperCase(); });
    var fm = cols.map(function (c) { return AG.colFmt(r, c); }), num = cols.map(function (c, i) { return isNum(c) || AGF.isNumFormat(fm[i]); });
    var max = cols.map(function (c, i) { if (!fm[i] || fm[i].format !== 'bar') return 0; var m = 0; d.rows.forEach(function (row) { var n = Math.abs(parseFloat(row[i])); if (n > m) m = n; }); return m; });
    var rowRules = (r && r.fmt && r.fmt.row_rules) || [];
    var label = function (i) { return (fm[i] && fm[i].title) || cols[i].name; };
    var html = '<div class="grid-wrap"><table class="t"><thead><tr>' + vis.map(function (i) { return '<th class="' + (num[i] ? 'n' : '') + '"' + (sortable ? ' data-i="' + i + '"' : '') + '>' + esc(label(i)) + (sortable && r.sort && r.sort.i === i ? (r.sort.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
        shown.map(function (row) {
            var obj = {}; up.forEach(function (u, i) { obj[u] = row[i]; });
            var rr = rowRules.filter(function (x) { var k = up.indexOf(String(x.column || '').toUpperCase()); return k >= 0 && AGF.ruleClass(row[k], { rules: [x] }); })[0];
            var rc = rr ? AGF.ruleClass(obj[String(rr.column).toUpperCase()], { rules: [rr] }) : '';
            return '<tr' + (rc ? ' class="row-' + rc + '"' : '') + '>' + vis.map(function (i) {
                var v = row[i], f = fm[i];
                var cell = f ? AGF.cell(v, f, { row: obj, max: max[i] }) : num[i] ? esc(v !== null && v !== '' ? fmt(v) : v) : AGF.cell(v, null, { row: obj });
                return '<td class="' + (num[i] ? 'n' : '') + '" title="' + esc(v) + '">' + cell + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
    return inline ? AG.inlineStyles(html) : html;
};
/** Turns the page's classes into inline styles so Outlook / Teams keep the look. */
AG.inlineStyles = function (html) {
    var box = document.createElement('div'); box.innerHTML = html;
    var css = { 'b-ok': 'background:#dcfce7;color:#166534', 'b-warn': 'background:#fef3c7;color:#92400e', 'b-bad': 'background:#fee2e2;color:#991b1b', 'b-info': 'background:#e0e7ff;color:#3730a3', 'b-muted': 'background:#f1f5f9;color:#475569' };
    box.querySelectorAll('table').forEach(function (t) { t.setAttribute('style', 'border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:12px'); });
    box.querySelectorAll('th').forEach(function (t) { t.setAttribute('style', 'background:#f1f5f9;border:1px solid #e2e8f0;padding:4px 8px;text-align:' + (t.classList.contains('n') ? 'right' : 'left')); });
    box.querySelectorAll('td').forEach(function (t) { t.setAttribute('style', 'border:1px solid #e2e8f0;padding:4px 8px;text-align:' + (t.classList.contains('n') ? 'right' : 'left')); t.removeAttribute('title'); });
    box.querySelectorAll('.tag').forEach(function (b) { var k = Object.keys(css).filter(function (c) { return b.classList.contains(c); })[0]; b.setAttribute('style', 'padding:1px 7px;border-radius:9px;font-weight:600;' + (css[k] || css['b-info'])); });
    box.querySelectorAll('tr[class^="row-"]').forEach(function (tr) { var k = tr.className.replace('row-', ''); tr.querySelectorAll('td').forEach(function (td) { td.setAttribute('style', td.getAttribute('style') + ';' + (css[k] || '').split(';')[0]); }); });
    box.querySelectorAll('a.ag-link').forEach(function (a) { var h = a.getAttribute('data-href'); if (/^(https?|mailto):/i.test(h)) { a.setAttribute('href', h); a.setAttribute('style', 'color:#2563eb'); } else a.removeAttribute('href'); a.removeAttribute('data-href'); var i = a.querySelector('i'); if (i) i.remove(); });
    box.querySelectorAll('.cbar').forEach(function (c) { var em = c.querySelector('em'); c.outerHTML = em ? em.innerHTML : ''; });
    box.querySelectorAll('.neg').forEach(function (n) { n.setAttribute('style', 'color:#b91c1c'); });
    var co = { note: '#2563eb;background:#eff6ff', tip: '#16a34a;background:#f0fdf4', warn: '#d97706;background:#fffbeb', bad: '#dc2626;background:#fef2f2' };
    box.querySelectorAll('.callout').forEach(function (c) { var k = Object.keys(co).filter(function (x) { return c.classList.contains(x); })[0] || 'note'; c.setAttribute('style', 'border-left:4px solid ' + co[k] + ';padding:6px 12px;margin:8px 0;border-radius:6px'); });
    box.querySelectorAll('.kpis').forEach(function (k) { k.setAttribute('style', 'display:flex;gap:10px;flex-wrap:wrap;margin:8px 0'); });
    box.querySelectorAll('.kpi').forEach(function (k) { k.setAttribute('style', 'border:1px solid #e2e8f0;border-radius:8px;padding:6px 12px'); });
    return box.innerHTML;
};
AG.renderGrid = function (r, d) {
    var body = $('res-body');
    r.sort = r.sort || null; r.filter = r.filter || '';
    var cols = d.columns, idx = {};
    cols.forEach(function (c, i) { idx[c.name.toUpperCase()] = i; });
    var nums = cols.filter(function (c) { var f = AG.colFmt(r, c); return isNum(c) && !(f && /^(percent|bar|date|datetime|text|link|badge)$/.test(f.format || '')); });
    var kpis = '<div class="kpis"><div class="kpi"><b>' + d.row_count.toLocaleString() + (d.capped ? '+' : '') + '</b><span>rows' + (d.capped ? ' (capped)' : '') + '</span></div>' +
        nums.slice(0, 3).map(function (c) { var i = cols.indexOf(c), s = 0; d.rows.forEach(function (row) { s += numv(row[i]); }); return '<div class="kpi"><b>' + fmt(s) + '</b><span>total ' + esc(c.name) + '</span></div>'; }).join('') + '</div>';
    var acts = '<div class="res-acts">' +
        '<button class="btn sm" onclick="AG.exportCsv()"><i class="fa-solid fa-file-csv"></i> CSV</button>' +
        '<button class="btn sm" onclick="AG.copyGrid()"><i class="fa-regular fa-copy"></i> Copy for Excel</button>' +
        '<button class="btn sm" onclick="AG.copyFormatted()" title="Keeps links, colours and number formats — paste into Outlook, Teams, Word or Excel"><i class="fa-solid fa-wand-magic-sparkles"></i> Copy formatted</button>' +
        (d.sql ? '<button class="btn sm" onclick="AG.toFusionSql()"><i class="fa-solid fa-database"></i> Open in Fusion SQL</button>' +
            '<button class="btn sm" onclick="AG.saveQueryDlg()"><i class="fa-regular fa-floppy-disk"></i> Save query</button>' +
            '<button class="btn sm" onclick="AG.watchDlg()"><i class="fa-solid fa-shield-dog"></i> Watch this</button>' : '') +
        '<button class="btn sm" onclick="AG.askAbout()"><i class="fa-regular fa-comment"></i> Ask about it</button>' +
        (nums.length ? '<button class="btn sm" onclick="AG.quickChart()"><i class="fa-solid fa-chart-column"></i> Chart</button>' : '') + '</div>';
    var meta = '<div class="res-meta"><b style="color:var(--ink)">' + esc((r.fmt && r.fmt.title) || d.title) + '</b>' + (d.pod ? '<span class="chip" style="background:' + (d.pod === 'PROD' ? '#fee2e2;color:#991b1b' : '#e0e7ff;color:#3730a3') + '">' + d.pod + '</span>' : '') +
        (d.elapsed_ms ? '<span>' + (d.elapsed_ms / 1000).toFixed(1) + ' s</span>' : '') + '<span class="grow"></span><input type="text" id="grid-filter" placeholder="Filter rows…" value="' + esc(r.filter) + '" style="width:160px"></div>';
    var chart = r.chart ? '<div class="chartbox"><canvas id="res-chart"></canvas></div>' : '';
    var view = d.rows.slice();
    if (r.filter) { var f = r.filter.toLowerCase(); view = view.filter(function (row) { return row.some(function (v) { return v != null && String(v).toLowerCase().indexOf(f) >= 0; }); }); }
    if (r.sort) { var si = r.sort.i, dir = r.sort.dir, nn = isNum(cols[si]); view.sort(function (a, b) { var x = a[si], y = b[si]; if (nn) { x = numv(x); y = numv(y); } else { x = String(x == null ? '' : x); y = String(y == null ? '' : y); } return (x < y ? -1 : x > y ? 1 : 0) * dir; }); }
    var shown = view.slice(0, 1000);
    var grid = AG.gridTable(r, d, shown, true) +
        (view.length > shown.length ? '<p class="muted sm" style="margin-top:6px">Showing 1,000 of ' + view.length.toLocaleString() + ' rows — CSV has them all.</p>' : '');
    body.innerHTML = meta + kpis + acts + chart + grid;
    if (r.fmt && r.fmt.note) body.querySelector('.kpis').insertAdjacentHTML('afterend', '<div class="res-note">' + md(r.fmt.note) + '</div>');
    body.querySelectorAll('th[data-i]').forEach(function (th) { th.onclick = function () { var i = +th.dataset.i; r.sort = r.sort && r.sort.i === i ? { i: i, dir: -r.sort.dir } : { i: i, dir: isNum(cols[i]) ? -1 : 1 }; AG.renderGrid(r, d); }; });
    var fi = $('grid-filter'); fi.oninput = function () { r.filter = fi.value; clearTimeout(AG._ft); AG._ft = setTimeout(function () { AG.renderGrid(r, d); var x = $('grid-filter'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 250); };
    if (r.chart) AG.drawChart(r.chart, d);
};

// Fixed categorical colours (validated palette, 8 + Other) — series keep their colour, never re-ordered by rank.
AG.PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#7c5cd6', '#0aa1b0'];
AG.drawChart = function (spec, d) {
    var cv = $('res-chart'); if (!cv || !window.Chart) return;
    if (AG._chart) { AG._chart.destroy(); AG._chart = null; }
    var cols = d.columns.map(function (c) { return c.name.toUpperCase(); });
    var xi = spec.x ? cols.indexOf(spec.x) : -1, yi = spec.y.map(function (y) { return cols.indexOf(y); });
    if (spec.type === 'kpi') { cv.parentNode.innerHTML = '<div class="kpis">' + yi.map(function (i, k) { var s = 0; d.rows.forEach(function (r) { s += numv(r[i]); }); return '<div class="kpi"><b>' + fmt(s) + '</b><span>' + esc(spec.y[k]) + '</span></div>'; }).join('') + '</div>'; return; }
    var agg = {}, order = [];
    d.rows.forEach(function (r) { var k = String(r[xi] == null ? '(blank)' : r[xi]); if (!(k in agg)) { agg[k] = yi.map(function () { return 0; }); order.push(k); } yi.forEach(function (i, j) { agg[k][j] += numv(r[i]); }); });
    if (spec.type === 'line' || /DATE|DAY|MONTH|PERIOD/.test(spec.x)) order.sort(); else order.sort(function (a, b) { return agg[b][0] - agg[a][0]; });
    var labels = order, other = null;
    if (spec.type === 'pie' && labels.length > 8) { other = labels.slice(7).reduce(function (s, k) { return s + agg[k][0]; }, 0); labels = labels.slice(0, 7); }
    else if (labels.length > 40 && spec.type !== 'line') labels = labels.slice(0, 40);
    var datasets = spec.type === 'pie'
        ? [{ data: labels.map(function (k) { return agg[k][0]; }).concat(other != null ? [other] : []), backgroundColor: AG.PALETTE.slice(0, labels.length).concat(other != null ? ['#94a3b8'] : []), borderColor: '#fff', borderWidth: 2 }]
        : spec.y.map(function (y, j) { return { label: y, data: labels.map(function (k) { return agg[k][j]; }), backgroundColor: AG.PALETTE[j % 8], borderColor: AG.PALETTE[j % 8], borderWidth: spec.type === 'line' ? 2 : 0, borderRadius: 3, pointRadius: spec.type === 'line' ? 2 : 0, tension: .25 }; });
    AG._chart = new Chart(cv, {
        type: spec.type === 'column' ? 'bar' : spec.type,
        data: { labels: labels.concat(other != null ? ['Other'] : []), datasets: datasets },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: spec.type === 'bar' ? 'y' : 'x',
            plugins: { legend: { display: spec.type === 'pie' || spec.y.length > 1, position: 'bottom' }, title: { display: !!spec.title, text: spec.title, font: { weight: 'bold' } },
                tooltip: { callbacks: { label: function (c) { return (c.dataset.label || c.label) + ': ' + fmt(c.parsed.x != null && spec.type === 'bar' ? c.parsed.x : c.parsed.y != null ? c.parsed.y : c.parsed); } } } },
            scales: spec.type === 'pie' ? {} : { x: { grid: { display: spec.type === 'bar' }, ticks: { maxRotation: 45, autoSkip: true } }, y: { grid: { display: spec.type !== 'bar', color: '#eef2f7' }, beginAtZero: true } }
        }
    });
};
AG.quickChart = function () {
    var r = AG.resById(AG.resSel); if (!r || !r.data) return;
    var d = r.data, cat = d.columns.filter(function (c) { return !isNum(c); })[0], num = d.columns.filter(isNum)[0];
    if (!cat || !num) { toast('Needs one text and one number column', 'err'); return; }
    r.chart = { type: /DATE|DAY|MONTH|PERIOD/i.test(cat.name) ? 'line' : 'bar', x: cat.name.toUpperCase(), y: [num.name.toUpperCase()], title: num.name + ' by ' + cat.name };
    AG.renderGrid(r, d);
};

AG.renderReport = function (r) {
    var rep = r.report, body = $('res-body');
    body.innerHTML = '<div class="res-acts"><button class="btn sm" onclick="AG.printReport()"><i class="fa-solid fa-print"></i> Print / PDF</button><button class="btn sm" onclick="AG.copyReport()"><i class="fa-regular fa-copy"></i> Copy for e-mail</button></div>' +
        '<div class="report" id="report"><h2>' + esc(rep.title) + '</h2><div class="muted sm" style="margin-bottom:8px">' + new Date().toLocaleString() + ' · ' + esc(AG.pod) + '</div>' +
        (rep.summary ? '<div class="sum">' + md(rep.summary) + '</div>' : '') +
        (rep.kpis && rep.kpis.length ? '<div class="kpis">' + rep.kpis.map(function (k) { return '<div class="kpi"><b>' + esc(k.value) + '</b><span>' + esc(k.label) + '</span></div>'; }).join('') + '</div>' : '') +
        rep.result_ids.map(function (id, n) { return '<div id="rep_part_' + n + '" style="margin-top:12px"><div class="muted sm">Loading ' + esc(id) + '…</div></div>'; }).join('') + '</div>';
    rep.result_ids.forEach(function (id, n) {
        AG.fetchResult(id).then(function (d) {
            var el = $('rep_part_' + n); if (!el) return;
            var src = AG.resById(id) || {};
            el.innerHTML = '<h3 style="font-size:.92rem;margin-bottom:6px">' + esc((src.fmt && src.fmt.title) || d.title) + ' <span class="muted sm">(' + d.row_count + ' rows)</span></h3>' + AG.gridTable(src, d, d.rows.slice(0, 200), false);
        }, function (e) { var el = $('rep_part_' + n); if (el) el.innerHTML = '<p class="muted sm">' + esc(id) + ': ' + esc(e) + '</p>'; });
    });
};
AG.printReport = function () {
    var w = window.open('', '_blank'); if (!w) { toast('Pop-up blocked', 'err'); return; }
    w.document.write('<html><head><title>' + esc(document.querySelector('#report h2').textContent) + '</title><style>body{font-family:Segoe UI,sans-serif;margin:24px;color:#0f172a}table{border-collapse:collapse;width:100%;font-size:11px;margin-bottom:12px}th,td{border-bottom:1px solid #e2e8f0;padding:4px 6px;text-align:left}td.n,th.n{text-align:right}.kpis{display:flex;gap:10px;margin:10px 0}.kpi{border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px}.kpi b{display:block;font-size:18px}.kpi span{font-size:11px;color:#64748b}blockquote{border-left:3px solid #cbd5e1;margin:8px 0;padding:2px 12px;color:#475569}pre{background:#f1f5f9;padding:8px;border-radius:6px;white-space:pre-wrap}mark{background:#fef08a}</style></head><body>' + AG.docHtml() + '</body></html>');
    w.document.close(); setTimeout(function () { w.print(); }, 300);
};
AG.copyReport = function () {
    var html = $('report').innerHTML;
    try { navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([$('report').innerText], { type: 'text/plain' }) })]).then(function () { toast('Copied — paste into Outlook or Teams', 'ok'); }); }
    catch (e) { navigator.clipboard.writeText($('report').innerText).then(function () { toast('Copied as text', 'ok'); }); }
};

// ── follow-ups ──
function curData() { var r = AG.resById(AG.resSel); return r && r.data; }
AG.exportCsv = function () {
    var d = curData(); if (!d) return;
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csv = [d.columns.map(function (c) { return q(c.name); }).join(',')].concat(d.rows.map(function (r) { return r.map(q).join(','); })).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = (d.title || 'result').replace(/[^\w\- ]+/g, '').slice(0, 60) + '.csv'; a.click();
};
AG.copyGrid = function () {
    var d = curData(); if (!d) return;
    var tsv = [d.columns.map(function (c) { return c.name; }).join('\t')].concat(d.rows.map(function (r) { return r.map(function (v) { return v == null ? '' : String(v).replace(/[\t\n]/g, ' '); }).join('\t'); })).join('\n');
    navigator.clipboard.writeText(tsv).then(function () { toast('Copied ' + d.rows.length + ' rows — paste into Excel', 'ok'); });
};
AG.copyFormatted = function () {
    var r = AG.resById(AG.resSel), d = curData(); if (!d) return;
    var shown = d.rows.slice(0, 2000), title = (r.fmt && r.fmt.title) || d.title;
    var html = '<div style="font-family:Segoe UI,Arial,sans-serif"><b style="font-size:14px">' + esc(title) + '</b>' + (r.fmt && r.fmt.note ? '<div style="font-size:12px;color:#475569;margin:4px 0 8px">' + AG.inlineStyles(md(r.fmt.note)) + '</div>' : '') + AG.gridTable(r, d, shown, false, true) + '</div>';
    var vis = AG.visibleCols(r, d.columns), tsv = [vis.map(function (i) { return d.columns[i].name; }).join('\t')].concat(shown.map(function (row) { return vis.map(function (i) { return row[i] == null ? '' : String(row[i]).replace(/[\t\n]/g, ' '); }).join('\t'); })).join('\n');
    AG.copyRich(html, tsv, 'Copied ' + shown.length + ' formatted rows — paste into Outlook, Teams, Word or Excel');
};
AG.copyRich = function (html, text, msg) {
    try { navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]).then(function () { toast(msg || 'Copied', 'ok'); }, function () { navigator.clipboard.writeText(text).then(function () { toast('Copied as text', 'ok'); }); }); }
    catch (e) { navigator.clipboard.writeText(text).then(function () { toast('Copied as text', 'ok'); }); }
};
// ── documents (render tool): a formatted page in the results panel ──
AG.renderDoc = function (r) {
    var body = $('res-body'), doc = r.doc;
    body.innerHTML = '<div class="res-acts"><button class="btn sm" onclick="AG.printDoc()"><i class="fa-solid fa-print"></i> Print / PDF</button>' +
        '<button class="btn sm" onclick="AG.copyDoc()"><i class="fa-solid fa-wand-magic-sparkles"></i> Copy formatted</button>' +
        '<button class="btn sm" onclick="AG.saveDoc()"><i class="fa-solid fa-download"></i> Save .html</button></div>' +
        '<div class="report doc" id="report">' + (doc.title ? '<h2>' + esc(doc.title) + '</h2>' : '') + (doc.markdown ? md(doc.markdown) : '') + (doc.html ? AGF.clean(doc.html) : '') + '</div>';
};
AG.docHtml = function () {
    var el = $('report'); if (!el) return '';
    var clone = el.cloneNode(true);
    clone.querySelectorAll('canvas').forEach(function (cv) { var src = document.getElementById(cv.id); try { var img = document.createElement('img'); img.src = src.toDataURL('image/png'); img.style.maxWidth = '100%'; cv.parentNode.replaceChild(img, cv); } catch (e) { cv.remove(); } });
    clone.querySelectorAll('.copy').forEach(function (b) { b.remove(); });
    return AG.inlineStyles(clone.innerHTML);
};
AG.printDoc = function () { AG.printReport(); };
AG.copyDoc = function () { AG.copyRich(AG.docHtml(), $('report').innerText, 'Copied — paste into Outlook, Teams or Word'); };
AG.saveDoc = function () {
    var t = (document.querySelector('#report h2') || {}).textContent || 'document';
    var page = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(t) + '</title><style>body{font-family:Segoe UI,Arial,sans-serif;max-width:960px;margin:24px auto;color:#0f172a;line-height:1.5}blockquote{border-left:3px solid #cbd5e1;margin:8px 0;padding:2px 12px;color:#475569}pre{background:#0f172a;color:#e2e8f0;padding:10px;border-radius:8px;overflow:auto}mark{background:#fef08a}</style></head><body>' + AG.docHtml() + '</body></html>';
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([page], { type: 'text/html' })); a.download = t.replace(/[^\w\- ]+/g, '').slice(0, 60) + '.html'; a.click();
};
AG.toFusionSql = function () { var d = curData(); if (!d) return; AG.handoff('fusionsql', { sql: d.sql }); };
AG.watchDlg = function () {
    var d = curData(); if (!d) return;
    openModal('Watch this query', '<p class="muted sm" style="margin-bottom:8px">A watchdog runs the query on a schedule, turns it into one number (the row count) and alerts when it is unusual (AUTO learns what is normal).</p>' +
        '<label class="sm">Name<br><input type="text" id="wd-name" style="width:100%" value="' + esc(d.title) + '"></label><label class="sm" style="display:block;margin-top:8px">Every<br><select id="wd-every"><option>15</option><option>30</option><option selected>60</option><option>240</option><option>1440</option></select> minutes</label>',
        [{ label: 'Cancel', onClick: closeModal }, { label: '<i class="fa-solid fa-shield-dog"></i> Create', cls: 'primary', onClick: function () {
            AG.createWatchdog({ name: $('wd-name').value.trim() || d.title, sql: d.sql, schedule_min: +$('wd-every').value, rule: 'AUTO', pod: d.pod }).then(function (r) { closeModal(); toast(r.content, r.ok ? 'ok' : 'err'); });
        } }]);
};
AG.askAbout = function () { var d = curData(); if (!d) return; var i = $('input'); i.value = 'About result ' + AG.resSel + ' (' + d.title + '): '; i.focus(); };
AG.saveQueryDlg = function () {
    var d = curData(); if (!d) return;
    openModal('Save query', '<label class="sm">Name<br><input type="text" id="sq-name" style="width:100%" value="' + esc(d.title) + '"></label><label class="sm" style="display:block;margin-top:8px">Description<br><input type="text" id="sq-desc" style="width:100%"></label><pre style="margin-top:8px;max-height:200px;overflow:auto;background:#0f172a;color:#e2e8f0;padding:8px;border-radius:8px;font-size:.74rem">' + esc(d.sql) + '</pre>',
        [{ label: 'Cancel', onClick: closeModal }, { label: '<i class="fa-regular fa-floppy-disk"></i> Save', cls: 'primary', onClick: function () {
            var name = $('sq-name').value.trim(); if (!name) return;
            AG.saveQuery({ name: name, sql: d.sql, description: $('sq-desc').value.trim(), category: 'AI Agent' }).then(function (r) { closeModal(); toast(r.content, r.ok ? 'ok' : 'err'); });
        } }]);
};
