/* Fusion Model — Reports tab: build a report from the model (values = measures, rows = columns, one column across,
   filters), see KPIs, a chart (Chart.js) and a pivot table, export CSV / Excel / PNG, copy the EVALUATE query, and save
   it for everyone (reports.json in the shared folder). Host actions: fmEvaluate, fmReports, fmReportSave,
   fmReportDelete; values for filters come from fmEvaluate (grouping only, so security roles apply). */

var RP = { list: null, cur: null, result: null, chart: null, values: {} };
var RP_PALETTE = ['#4338ca', '#0d9488', '#f59e0b', '#e11d48', '#7c3aed', '#0284c7', '#65a30d', '#db2777', '#475569', '#ea580c'];

function newReport() { return { name: '', folder: '', request: { groupBy: [], filters: [], measures: [], orderBy: [], top: 500, totals: true }, pivot: '', chart: 'bar' }; }

function renderReports() {
    if (!S.model) return;
    var go = S.schema.length ? Promise.resolve() : loadSchema();
    go.then(function () {
        if (RP.list == null) { RP.list = []; fm('fmReports').then(function (r) { RP.list = r.reports || []; renderReportList(); }).catch(function () { }); }
        if (!RP.cur) RP.cur = newReport();
        renderReportList(); renderBuilder(); renderReportResult();
    });
}

function renderReportList() {
    var by = {};
    (RP.list || []).forEach(function (r) { (by[r.folder || 'Reports'] = by[r.folder || 'Reports'] || []).push(r); });
    $('rp-list').innerHTML = '<button class="btn sm block primary" data-rp="new"><i class="fa-solid fa-plus"></i> New report</button>' +
        (Object.keys(by).length ? Object.keys(by).sort().map(function (f) {
            return '<div class="rgroup">' + esc(f) + '</div>' + by[f].map(function (r) {
                return '<button class="ritem' + (RP.cur && RP.cur.id === r.id ? ' on' : '') + '" data-rpo="' + esc(r.id) + '"><i class="fa-solid ' + chartIcon(r.chart) + '"></i><span><b>' + esc(r.name) + '</b><small>' + esc((r.by || '') + ' · ' + ago(r.utc)) + '</small></span></button>';
            }).join('');
        }).join('') : '<div class="muted pad sm">No saved reports yet.</div>');
}
function chartIcon(c) { return { line: 'fa-chart-line', area: 'fa-chart-area', pie: 'fa-chart-pie', table: 'fa-table', kpi: 'fa-gauge', hbar: 'fa-bars-progress' }[c] || 'fa-chart-column'; }

/** Every groupable column as Table[Column] (bare table name when unique), by table. */
function rpColumns() {
    var cols = modelColumns(), out = [];
    Object.keys(cols).sort().forEach(function (k) { out.push({ table: k, cols: cols[k].map(function (c) { return daxTable(k).replace(/^'|'$/g, '') + '[' + c + ']'; }) }); });
    return out;
}
function colOptions(sel, allowNone) {
    return (allowNone ? '<option value="">' + allowNone + '</option>' : '') + rpColumns().map(function (g) {
        return '<optgroup label="' + esc(g.table) + '">' + g.cols.map(function (c) { return '<option value="' + esc(c) + '"' + (c === sel ? ' selected' : '') + '>' + esc(c.replace(/^.*\[/, '').replace(/\]$/, '')) + '</option>'; }).join('') + '</optgroup>';
    }).join('');
}
function measureOptions() {
    var by = {};
    (S.model.measures || []).forEach(function (m) { (by[m.folder || m.table || 'Measures'] = by[m.folder || m.table || 'Measures'] || []).push(m.name); });
    return '<option value="">+ value…</option>' + Object.keys(by).sort().map(function (f) { return '<optgroup label="' + esc(f) + '">' + by[f].sort().map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('') + '</optgroup>'; }).join('');
}

function renderBuilder() {
    var r = RP.cur, q = r.request;
    var chip = function (kind, i, label) { return '<span class="rchip ' + kind + '">' + esc(label) + '<button data-rpx="' + kind + '" data-i="' + i + '" title="Remove">×</button></span>'; };
    $('rp-builder').innerHTML =
        '<div class="rp-row"><label>Values</label><div class="rp-chips">' + q.measures.map(function (m, i) { return chip('m', i, m.name); }).join('') + '<select id="rp-addm" class="rp-add">' + measureOptions() + '</select></div></div>' +
        '<div class="rp-row"><label>Rows</label><div class="rp-chips">' + q.groupBy.filter(function (g) { return g !== r.pivot; }).map(function (g) { return chip('g', q.groupBy.indexOf(g), g); }).join('') + '<select id="rp-addg" class="rp-add">' + colOptions('', '+ column…') + '</select></div></div>' +
        '<div class="rp-row"><label>Across</label><div class="rp-chips"><select id="rp-pivot" class="rp-add">' + colOptions(r.pivot, '(none)') + '</select></div></div>' +
        '<div class="rp-row"><label>Filters</label><div class="rp-filters">' + q.filters.map(function (f, i) {
            return '<div class="rp-f"><select data-rpf="column" data-i="' + i + '">' + colOptions(f.column) + '</select>' +
                '<select data-rpf="op" data-i="' + i + '">' + [['in', 'is'], ['notIn', 'is not'], ['contains', 'contains'], ['>=', '≥'], ['<=', '≤'], ['between', 'between'], ['blank', 'is blank'], ['notBlank', 'is not blank']].map(function (o) { return '<option value="' + o[0] + '"' + (f.op === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
                (f.op === 'blank' || f.op === 'notBlank' ? '' : '<input data-rpf="values" data-i="' + i + '" list="rp-dl-' + i + '" value="' + esc((f.values || []).join(', ')) + '" placeholder="values, comma separated"><datalist id="rp-dl-' + i + '">' + (RP.values[f.column] || []).map(function (v) { return '<option value="' + esc(v) + '">'; }).join('') + '</datalist>') +
                '<button class="btn xs" data-rpx="f" data-i="' + i + '">×</button></div>';
        }).join('') + '<button class="btn xs" data-rp="addf"><i class="fa-solid fa-filter"></i> filter</button></div></div>' +
        '<div class="rp-row"><label>Show</label><div class="rp-chips">' + ['bar', 'hbar', 'line', 'area', 'pie', 'kpi', 'table'].map(function (c) {
            return '<button class="btn xs' + (r.chart === c ? ' on' : '') + '" data-rpc="' + c + '" title="' + c + '"><i class="fa-solid ' + chartIcon(c) + '"></i></button>';
        }).join('') + '<span class="muted sm" style="margin-left:10px">top</span><input type="number" id="rp-top" class="num" value="' + (q.top || 500) + '" min="1" max="100000">' +
        '<span class="muted sm">sort</span><select id="rp-sort"><option value="">rows A→Z</option>' + q.measures.map(function (m) { var s = (q.orderBy || [])[0]; return '<option value="' + esc(m.name) + '"' + (s && s.by === m.name ? ' selected' : '') + '>' + esc(m.name) + ' ↓</option>'; }).join('') + '</select></div></div>' +
        '<div class="rp-bar"><input id="rp-name" placeholder="Report name" value="' + esc(r.name || '') + '"><input id="rp-folder" placeholder="Folder" value="' + esc(r.folder || '') + '" style="max-width:150px">' +
        '<button class="btn primary" data-rp="run"><i class="fa-solid fa-play"></i> Run</button><button class="btn" data-rp="save"><i class="fa-solid fa-floppy-disk"></i> Save</button>' +
        (r.id ? '<button class="btn" data-rp="saveas">Save as</button><button class="btn" data-rp="del" title="Delete"><i class="fa-solid fa-trash"></i></button>' : '') +
        '<span class="grow"></span><button class="btn sm" data-rp="csv"><i class="fa-solid fa-file-csv"></i></button><button class="btn sm" data-rp="xlsx" title="Excel"><i class="fa-solid fa-file-excel"></i></button>' +
        '<button class="btn sm" data-rp="png" title="Chart as PNG"><i class="fa-solid fa-image"></i></button><button class="btn sm" data-rp="dax" title="Copy the EVALUATE query"><i class="fa-solid fa-code"></i></button>' +
        '<button class="btn sm" data-rp="ask" title="Ask AI about this report"><i class="fa-solid fa-wand-magic-sparkles"></i></button></div>';
}

function evaluateText() {
    var r = RP.cur, q = r.request, lit = function (v) { return /^-?\d+(\.\d+)?$/.test(v) ? v : '"' + String(v).replace(/"/g, '""') + '"'; };
    var args = q.groupBy.slice();
    q.filters.forEach(function (f) {
        var v = f.values || [];
        if (f.op === 'in' && v.length) args.push('TREATAS({' + v.map(lit).join(', ') + '}, ' + f.column + ')');
        else if (f.op === 'notIn' && v.length) args.push('FILTER(ALL(' + f.column + '), NOT ' + f.column + ' IN {' + v.map(lit).join(', ') + '})');
        else if (f.op === '>=' || f.op === '<=') args.push('FILTER(ALL(' + f.column + '), ' + f.column + ' ' + f.op + ' ' + lit(v[0]) + ')');
        else if (f.op === 'between') args.push('FILTER(ALL(' + f.column + '), ' + f.column + ' >= ' + lit(v[0]) + ' && ' + f.column + ' <= ' + lit(v[1]) + ')');
        else if (f.op === 'blank') args.push('FILTER(ALL(' + f.column + '), ISBLANK(' + f.column + '))');
    });
    q.measures.forEach(function (m) { args.push('"' + m.name + '", [' + m.name + ']'); });
    var s = (q.orderBy || [])[0];
    return 'EVALUATE SUMMARIZECOLUMNS(\n    ' + args.join(',\n    ') + '\n)' + (s ? '\nORDER BY [' + s.by + '] DESC' : '');
}

function runReport() {
    var r = RP.cur, q = r.request;
    if (!q.measures.length && !q.groupBy.length) { toast('Add a value or a row column'); return; }
    var req = JSON.parse(JSON.stringify(q));
    if (r.pivot && req.groupBy.indexOf(r.pivot) < 0) req.groupBy.push(r.pivot);
    req.filters = req.filters.filter(function (f) { return f.op === 'blank' || f.op === 'notBlank' || (f.values && f.values.length); });
    $('rp-out').innerHTML = '<div class="muted pad"><i class="fa-solid fa-circle-notch fa-spin"></i> Running…</div>';
    fm('fmEvaluate', { request: req }).then(function (x) { RP.result = x.result; RP.resultFor = JSON.stringify(req); renderReportResult(); })
        .catch(function (e) { $('rp-out').innerHTML = '<div class="err pad">' + esc(e) + '</div>'; });
}

/** Result → pivot: row keys (all group columns but the pivot) × pivot values × measures. */
function pivotData() {
    var res = RP.result, r = RP.cur; if (!res) return null;
    var cols = res.columns.map(function (c) { return c.name; });
    var mIdx = res.columns.map(function (c, i) { return c.role === 'measure' ? i : -1; }).filter(function (i) { return i >= 0; });
    var gIdx = res.columns.map(function (c, i) { return c.role === 'group' ? i : -1; }).filter(function (i) { return i >= 0; });
    var pName = r.pivot ? cols.find(function (c) { return c === r.pivot || c.replace(/^'|'/g, '') === r.pivot || r.pivot.endsWith(c.split('.').pop()) || c.endsWith(r.pivot.replace(/^.*?\./, '')); }) : null;
    var pI = pName ? cols.indexOf(pName) : -1;
    var rowI = gIdx.filter(function (i) { return i !== pI; });
    var rows = [], rowMap = {}, pvals = [], pset = {};
    res.rows.forEach(function (row) {
        var key = rowI.map(function (i) { return row[i]; }).join('\u0001');
        if (!(key in rowMap)) { rowMap[key] = rows.length; rows.push({ labels: rowI.map(function (i) { return row[i]; }), cells: {} }); }
        var pv = pI >= 0 ? String(row[pI]) : '';
        if (!(pv in pset)) { pset[pv] = 1; pvals.push(pv); }
        rows[rowMap[key]].cells[pv] = mIdx.map(function (i) { return row[i]; });
    });
    if (pI >= 0) pvals.sort();
    return { rowHeads: rowI.map(function (i) { return cols[i]; }), measures: mIdx.map(function (i) { return { name: cols[i], format: res.columns[i].format }; }), pvals: pvals, rows: rows, totals: res.totals ? mIdx.map(function (i) { return res.totals[i]; }) : null, pivot: pI >= 0 ? cols[pI] : null, ms: res.ms, capped: res.capped };
}

function renderReportResult() {
    var el = $('rp-out'); if (!el) return;
    if (RP.chart) { try { RP.chart.destroy(); } catch (e) { } RP.chart = null; }
    var p = pivotData();
    if (!p) { el.innerHTML = '<div class="empty"><div class="art"><i class="fa-solid fa-chart-column"></i></div><h2>Build a report</h2><p>Pick <b>values</b> (measures) and <b>rows</b> (columns), optionally a column <b>across</b> and filters, then Run. Numbers come from the measures, so they match everywhere — Ask AI, Explore and Power BI.</p></div>'; return; }
    var r = RP.cur, fmtOf = function (m) { return m.format || '#,0.##'; };
    var kpis = (p.totals || (p.rows.length === 1 && !p.pivot ? p.rows[0].cells[''] : null));
    var html = kpis ? '<div class="rp-kpis">' + p.measures.map(function (m, i) { return '<div class="rp-kpi"><small>' + esc(m.name) + '</small><b>' + esc(fmtValue(kpis[i], fmtOf(m))) + '</b></div>'; }).join('') + '</div>' : '';
    if (r.chart !== 'table' && r.chart !== 'kpi') html += '<div class="rp-chart"><canvas id="rp-canvas"></canvas></div>';
    if (r.chart !== 'kpi') {
        var heads = p.pivot ? p.pvals.reduce(function (a, pv) { return a.concat(p.measures.map(function (m) { return (p.measures.length > 1 ? pv + ' · ' + m.name : pv); })); }, []) : p.measures.map(function (m) { return m.name; });
        html += '<div class="grid rp-table"><table><thead>' + (p.pivot ? '<tr><th colspan="' + p.rowHeads.length + '" class="muted">' + esc(p.pivot) + ' →</th>' + p.pvals.map(function (pv) { return '<th colspan="' + p.measures.length + '" class="n">' + esc(pv) + '</th>'; }).join('') + '</tr>' : '') +
            '<tr>' + p.rowHeads.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + (p.pivot ? p.pvals.map(function () { return p.measures.map(function (m) { return '<th class="n">' + esc(m.name) + '</th>'; }).join(''); }).join('') : heads.map(function (h) { return '<th class="n">' + esc(h) + '</th>'; }).join('')) + '</tr></thead><tbody>' +
            p.rows.map(function (row) {
                return '<tr>' + row.labels.map(function (l) { return '<td>' + esc(l == null ? '(blank)' : l) + '</td>'; }).join('') +
                    (p.pivot ? p.pvals : ['']).map(function (pv) { var c = row.cells[pv] || []; return p.measures.map(function (m, i) { return '<td class="n">' + esc(fmtValue(c[i], fmtOf(m))) + '</td>'; }).join(''); }).join('') + '</tr>';
            }).join('') +
            (p.totals && !p.pivot && p.rowHeads.length ? '<tr class="tot"><td colspan="' + p.rowHeads.length + '">Total</td>' + p.totals.map(function (t, i) { return '<td class="n">' + esc(fmtValue(t, fmtOf(p.measures[i]))) + '</td>'; }).join('') + '</tr>' : '') +
            '</tbody></table></div>';
    }
    html += '<div class="muted sm pad">' + p.rows.length + (p.capped ? '+' : '') + ' rows · ' + p.ms + ' ms in DuckDB</div>';
    el.innerHTML = html;
    if ($('rp-canvas')) drawChart(p);
}

function drawChart(p) {
    if (typeof Chart === 'undefined') { $('rp-canvas').parentNode.innerHTML = '<div class="muted pad sm">Charts need Chart.js (loaded from the internet) — the table below has the numbers.</div>'; return; }
    var r = RP.cur, type = r.chart === 'hbar' ? 'bar' : r.chart === 'area' ? 'line' : r.chart;
    var labels = p.rows.map(function (row) { return row.labels.map(function (l) { return l == null ? '(blank)' : l; }).join(' · ') || 'Total'; });
    var num = function (v) { return v == null ? null : +v; };
    var datasets = p.pivot
        ? p.pvals.map(function (pv, i) { return { label: pv, data: p.rows.map(function (row) { return num((row.cells[pv] || [])[0]); }), backgroundColor: RP_PALETTE[i % RP_PALETTE.length], borderColor: RP_PALETTE[i % RP_PALETTE.length] }; })
        : p.measures.map(function (m, i) { return { label: m.name, data: p.rows.map(function (row) { return num((row.cells[''] || [])[i]); }), backgroundColor: type === 'pie' ? p.rows.map(function (_, j) { return RP_PALETTE[j % RP_PALETTE.length]; }) : RP_PALETTE[i % RP_PALETTE.length], borderColor: RP_PALETTE[i % RP_PALETTE.length] }; });
    if (type === 'pie') datasets = datasets.slice(0, 1);
    // a percentage next to amounts would be a flat line at 0: give it its own axis on the right
    var pct = function (m) { return /%$/.test(m.format || ''); };
    var mixed = !p.pivot && type !== 'pie' && r.chart !== 'hbar' && p.measures.some(pct) && p.measures.some(function (m) { return !pct(m); });
    if (mixed) datasets.forEach(function (d, i) { if (pct(p.measures[i])) { d.yAxisID = 'y1'; d.type = 'line'; d.tension = .25; d.backgroundColor = d.borderColor; } });
    datasets.forEach(function (d) { if (r.chart === 'area') { d.fill = true; d.backgroundColor = d.borderColor + '33'; } if (type === 'line') d.tension = .25; });
    RP.chart = new Chart($('rp-canvas'), {
        type: type, data: { labels: labels, datasets: datasets },
        options: { responsive: true, maintainAspectRatio: false, animation: false, indexAxis: r.chart === 'hbar' ? 'y' : 'x', plugins: { legend: { display: datasets.length > 1 || type === 'pie', position: 'bottom' } },
            scales: type === 'pie' ? {} : Object.assign({ y: { beginAtZero: true } }, mixed ? { y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { callback: function (v) { return Math.round(v * 100) + '%'; } } } } : {}) }
    });
}

function rpDownload(name, blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function rpFile() { return (RP.cur.name || 'report').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'report'; }
function rpMatrix() {
    var p = pivotData(); if (!p) return null;
    var head = p.rowHeads.concat(p.pivot ? p.pvals.reduce(function (a, pv) { return a.concat(p.measures.map(function (m) { return pv + (p.measures.length > 1 ? ' · ' + m.name : ''); })); }, []) : p.measures.map(function (m) { return m.name; }));
    var body = p.rows.map(function (row) { return row.labels.concat((p.pivot ? p.pvals : ['']).reduce(function (a, pv) { var c = row.cells[pv] || []; return a.concat(p.measures.map(function (_, i) { return c[i] == null ? null : c[i]; })); }, [])); });
    return { head: head, body: body, p: p };
}
function exportCsv() {
    var m = rpMatrix(); if (!m) { toast('Run the report first'); return; }
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    rpDownload(rpFile() + '.csv', new Blob(['﻿' + [m.head].concat(m.body).map(function (r) { return r.map(q).join(','); }).join('\r\n')], { type: 'text/csv' }));
}
function exportXlsx() {
    var m = rpMatrix(); if (!m) { toast('Run the report first'); return; }
    if (typeof ExcelJS === 'undefined') { toast('Excel export needs ExcelJS (internet) — CSV instead'); return exportCsv(); }
    var wb = new ExcelJS.Workbook(), ws = wb.addWorksheet((RP.cur.name || 'Report').slice(0, 31));
    ws.addRow([RP.cur.name || 'Report']).font = { bold: true, size: 14 };
    ws.addRow(['Fusion Model · ' + new Date().toLocaleString()]).font = { color: { argb: 'FF64748B' } };
    ws.addRow([]);
    var h = ws.addRow(m.head); h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } }; });
    m.body.forEach(function (r) { ws.addRow(r); });
    var nLab = m.p.rowHeads.length;
    ws.columns.forEach(function (c, i) { c.width = i < nLab ? 26 : 16; if (i >= nLab) c.numFmt = '#,##0.00'; });
    ws.views = [{ state: 'frozen', ySplit: 4, xSplit: nLab }];
    wb.xlsx.writeBuffer().then(function (buf) { rpDownload(rpFile() + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); });
}
function exportPng() {
    var c = $('rp-canvas'); if (!c || !RP.chart) { toast('Show a chart first'); return; }
    c.toBlob(function (b) { rpDownload(rpFile() + '.png', b); });
}

function saveReport(asNew) {
    var r = RP.cur;
    r.name = $('rp-name').value.trim(); r.folder = $('rp-folder').value.trim();
    if (!r.name) { toast('Give the report a name'); $('rp-name').focus(); return; }
    var body = JSON.parse(JSON.stringify(r)); if (asNew) delete body.id;
    fm('fmReportSave', { report: body }).then(function (x) { RP.cur = x.report; toast('Saved — everyone with the model sees it'); return fm('fmReports'); })
        .then(function (x) { RP.list = x.reports || []; renderReportList(); renderBuilder(); }).catch(function (e) { toast(String(e)); });
}

function loadFilterValues(col) {
    if (!col || RP.values[col]) return;
    RP.values[col] = [];
    fm('fmEvaluate', { request: { groupBy: [col], measures: [], top: 300 } }).then(function (x) { RP.values[col] = (x.result.rows || []).map(function (r) { return r[0]; }).filter(function (v) { return v != null; }); renderBuilder(); }).catch(function () { });
}

document.addEventListener('click', function (e) {
    if (!$('page-reports') || $('page-reports').hidden) return;
    var b = e.target.closest('[data-rp], [data-rpo], [data-rpx], [data-rpc]'); if (!b) return;
    var d = b.dataset, q = RP.cur.request;
    if (d.rpo) { var x = (RP.list || []).find(function (y) { return y.id === d.rpo; }); if (x) { RP.cur = JSON.parse(JSON.stringify(x)); RP.result = null; renderReports(); runReport(); } return; }
    if (d.rpx === 'm') { q.measures.splice(+d.i, 1); q.orderBy = (q.orderBy || []).filter(function (o) { return q.measures.some(function (m) { return m.name === o.by; }); }); return renderBuilder(); }
    if (d.rpx === 'g') { q.groupBy.splice(+d.i, 1); return renderBuilder(); }
    if (d.rpx === 'f') { q.filters.splice(+d.i, 1); return renderBuilder(); }
    if (d.rpc) { RP.cur.chart = d.rpc; renderBuilder(); return renderReportResult(); }
    switch (d.rp) {
        case 'new': RP.cur = newReport(); RP.result = null; return renderReports();
        case 'addf': var c0 = q.groupBy[0] || (rpColumns()[0] || { cols: [] }).cols[0]; q.filters.push({ column: c0, op: 'in', values: [] }); loadFilterValues(c0); return renderBuilder();
        case 'run': return runReport();
        case 'save': return saveReport(false);
        case 'saveas': return saveReport(true);
        case 'del': if (confirm('Delete report ' + RP.cur.name + ' for everyone?')) fm('fmReportDelete', { id: RP.cur.id }).then(function () { RP.list = RP.list.filter(function (y) { return y.id !== RP.cur.id; }); RP.cur = newReport(); RP.result = null; renderReports(); }); return;
        case 'csv': return exportCsv();
        case 'xlsx': return exportXlsx();
        case 'png': return exportPng();
        case 'dax': var t = evaluateText(); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('EVALUATE query copied — paste it in Explore or DAX query view'); }, function () { prompt('EVALUATE query', t); }); return;
        case 'ask': showTab('ask'); $('ask-in').value = 'Explain this report and what stands out:\n' + evaluateText(); $('ask-in').focus(); return;
    }
});
document.addEventListener('change', function (e) {
    if (!$('page-reports') || $('page-reports').hidden) return;
    var x = e.target, q = RP.cur.request;
    if (x.id === 'rp-addm' && x.value) { if (!q.measures.some(function (m) { return m.name === x.value; })) q.measures.push({ name: x.value }); return renderBuilder(); }
    if (x.id === 'rp-addg' && x.value) { if (q.groupBy.indexOf(x.value) < 0) q.groupBy.push(x.value); return renderBuilder(); }
    if (x.id === 'rp-pivot') { RP.cur.pivot = x.value; return renderBuilder(); }
    if (x.id === 'rp-top') { q.top = +x.value || 500; return; }
    if (x.id === 'rp-sort') { q.orderBy = x.value ? [{ by: x.value, desc: true }] : []; return; }
    var d = x.dataset;
    if (d.rpf) {
        var f = q.filters[+d.i];
        if (d.rpf === 'values') f.values = csvList(x.value);
        else { f[d.rpf] = x.value; if (d.rpf === 'column') { f.values = []; loadFilterValues(x.value); } renderBuilder(); }
    }
});
document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.rpf === 'values') { e.target.dispatchEvent(new Event('change', { bubbles: true })); runReport(); } });
