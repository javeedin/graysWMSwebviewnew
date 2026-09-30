/* Fusion Model — Dashboards: Power BI-style report pages over the model's measures. Pages of visuals on a 24-column
   canvas, slicers and click-to-cross-filter, reading view and edit view (dash-edit.js), Copilot (build / change /
   explain with Claude, every visual checked against the model by the host). Host actions: fmDashboards,
   fmDashboardSave, fmDashboardDelete, fmDashboardAuto, fmDashAi (+ fmProgress), fmEvaluate. Colours follow the
   validated categorical order (never cycled; >8 series fold into "Other"); one value axis per chart. */

var DB = {
    list: null, cur: null, page: 0, edit: false, sel: null, dirty: false,
    results: {}, errors: {}, charts: {}, slicers: {}, cross: null, tableView: {},
    undo: [], redo: [], copilot: false, chat: [], busy: false
};
var DASH_ROW = 40;
var DASH_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
var DASH_OTHER = '#9a9893';
var DASH_TYPES = [
    ['card', 'fa-square', 'Card'], ['kpi', 'fa-gauge-high', 'KPI'], ['column', 'fa-chart-column', 'Column'], ['bar', 'fa-chart-bar', 'Bar'],
    ['stackedcolumn', 'fa-layer-group', 'Stacked column'], ['stackedbar', 'fa-bars-staggered', 'Stacked bar'], ['line', 'fa-chart-line', 'Line'],
    ['area', 'fa-chart-area', 'Area'], ['combo', 'fa-chart-simple', 'Line & column'], ['pie', 'fa-chart-pie', 'Pie'], ['donut', 'fa-circle-notch', 'Donut'],
    ['gauge', 'fa-gauge', 'Gauge'], ['scatter', 'fa-braille', 'Scatter'], ['table', 'fa-table', 'Table'], ['matrix', 'fa-table-cells', 'Matrix'],
    ['slicer', 'fa-filter', 'Slicer'], ['text', 'fa-font', 'Text box']
];
function dashTypeLabel(t) { var x = DASH_TYPES.find(function (y) { return y[0] === t; }); return x ? x[2] : t; }
function dashUid(p) { return (p || 'v') + Math.random().toString(36).slice(2, 8); }
function dashPage() { return DB.cur && DB.cur.pages[DB.page]; }
function dashVisual(id) { var p = dashPage(); return p && p.visuals.find(function (v) { return v.id === id; }); }
function dashNew(name) { return { name: name || 'New dashboard', filters: [], pages: [{ id: dashUid('p'), name: 'Page 1', filters: [], visuals: [] }] }; }

function normDash(d) {
    d.filters = d.filters || []; d.pages = d.pages && d.pages.length ? d.pages : [{ id: dashUid('p'), name: 'Page 1', visuals: [] }];
    d.pages.forEach(function (p) {
        p.id = p.id || dashUid('p'); p.filters = p.filters || []; p.visuals = p.visuals || [];
        p.visuals.forEach(function (v) {
            v.id = v.id || dashUid(); v.fields = v.fields || {}; v.fields.category = v.fields.category || []; v.fields.values = (v.fields.values || []).map(function (x) { return typeof x === 'string' ? { name: x } : x; });
            v.options = v.options || {}; v.x = +v.x || 0; v.y = +v.y || 0; v.w = Math.max(1, +v.w || 6); v.h = Math.max(2, +v.h || 4);
        });
    });
    return d;
}

// ── open / list ────────────────────────────────────────────────
function renderDashboards() {
    if (!S.model) return;
    var go = S.schema.length ? Promise.resolve() : loadSchema();
    go.then(function () {
        if (DB.list == null) return fm('fmDashboards').then(function (r) { DB.list = (r.dashboards || []).map(normDash); if (!DB.cur && DB.list.length) DB.cur = JSON.parse(JSON.stringify(DB.list[0])); dashRender(true); });
        dashRender(true);
    }).catch(function (e) { toast(String(e)); });
}

function dashRender(requery) {
    var el = $('dash-root'); if (!el) return;
    el.classList.toggle('editing', DB.edit);
    el.classList.toggle('with-copilot', DB.copilot);
    $('dash-top').innerHTML = dashToolbar();
    if (!DB.cur) {
        $('dash-canvas').innerHTML = '<div class="empty"><div class="art"><i class="fa-solid fa-chart-pie"></i></div><h2>Dashboards</h2>' +
            '<p>Report pages like Power BI — cards, charts, tables, slicers — on the measures of your model. Clicking a bar filters the rest of the page.</p>' +
            '<div class="row" style="justify-content:center"><button class="btn primary" data-dq="copilot-new"><i class="fa-solid fa-wand-magic-sparkles"></i> Build with Copilot</button>' +
            '<button class="btn" data-dq="quick"><i class="fa-solid fa-bolt"></i> Quick dashboard</button><button class="btn" data-dq="blank"><i class="fa-solid fa-plus"></i> Blank</button></div></div>';
        $('dash-pages').innerHTML = ''; $('dash-left').innerHTML = ''; $('dash-right').innerHTML = '';
        dashRenderCopilot(); return;
    }
    $('dash-pages').innerHTML = DB.cur.pages.map(function (p, i) {
        return '<button class="dpage' + (i === DB.page ? ' on' : '') + '" data-dpg="' + i + '">' + esc(p.name) + '</button>';
    }).join('') + (DB.edit ? '<button class="dpage add" data-dq="addpage" title="New page"><i class="fa-solid fa-plus"></i></button>' : '');
    if (typeof dashRenderPanes === 'function') dashRenderPanes();
    dashRenderCanvas();
    dashRenderCopilot();
    if (requery) dashRunPage();
}

function dashToolbar() {
    var list = DB.list || [];
    var sel = '<select id="dash-sel" title="Open a dashboard"><option value="">' + (DB.cur ? '' : 'Open a dashboard…') + '</option>' + list.map(function (d) {
        return '<option value="' + esc(d.id) + '"' + (DB.cur && DB.cur.id === d.id ? ' selected' : '') + '>' + esc(d.name) + '</option>';
    }).join('') + (DB.cur && !DB.cur.id ? '<option selected>' + esc(DB.cur.name) + ' (not saved)</option>' : '') + '</select>';
    var chips = dashFilterChips();
    return sel +
        '<div class="dtb-group"><button class="btn sm" data-dq="menu-new"><i class="fa-solid fa-plus"></i> New <i class="fa-solid fa-caret-down"></i></button></div>' +
        (DB.cur ? '<button class="btn sm' + (DB.edit ? ' on' : '') + '" data-dq="toggle-edit"><i class="fa-solid fa-' + (DB.edit ? 'eye' : 'pen') + '"></i> ' + (DB.edit ? 'Reading view' : 'Edit') + '</button>' +
            '<button class="btn sm primary" data-dq="save"' + (DB.dirty || !DB.cur.id ? '' : ' disabled') + '><i class="fa-solid fa-floppy-disk"></i> Save' + (DB.dirty ? ' *' : '') + '</button>' +
            '<button class="btn sm" data-dq="more"><i class="fa-solid fa-ellipsis"></i></button>' : '') +
        '<span class="dtb-chips">' + chips + '</span>' +
        (DB.cur ? '<button class="btn sm" data-dq="refresh" title="Run every visual again"><i class="fa-solid fa-rotate"></i></button>' +
            '<button class="btn sm" data-dq="present" title="Full screen"><i class="fa-solid fa-expand"></i></button>' : '') +
        '<button class="btn sm copilot-btn' + (DB.copilot ? ' on' : '') + '" data-dq="copilot"><i class="fa-solid fa-wand-magic-sparkles"></i> Copilot</button>';
}

/** Active selections (slicers, cross-filter) as chips in the toolbar, each clearable. */
function dashFilterChips() {
    var p = dashPage(); if (!p) return '';
    var out = [];
    Object.keys(DB.slicers).forEach(function (vid) {
        var v = dashVisual(vid), vals = DB.slicers[vid];
        if (v && vals && vals.length) out.push('<span class="fchip">' + esc(dashShortCol(v.fields.category[0])) + ': ' + esc(vals.length > 2 ? vals.length + ' selected' : vals.join(', ')) + '<button data-dclr="' + esc(vid) + '">×</button></span>');
    });
    if (DB.cross && DB.cross.page === p.id) out.push('<span class="fchip x">' + esc(dashShortCol(DB.cross.column)) + ' = ' + esc(DB.cross.value == null ? '(blank)' : DB.cross.value) + '<button data-dclr="cross">×</button></span>');
    return out.join('');
}
function dashShortCol(c) { var m = /\[([^\]]+)\]$/.exec(c || ''); return m ? m[1].replace(/_/g, ' ').toLowerCase().replace(/^\w/, function (x) { return x.toUpperCase(); }) : c; }

// ── queries ────────────────────────────────────────────────────
/** Filters for one visual: dashboard + page filters, other slicers' selections, the cross-filter from another visual. */
function dashFiltersFor(v) {
    var p = dashPage(), f = (DB.cur.filters || []).concat(p.filters || []);
    p.visuals.forEach(function (o) {
        if (o.id === v.id || o.type !== 'slicer') return;
        var sel = DB.slicers[o.id];
        if (sel && sel.length && o.fields.category[0]) f.push({ column: o.fields.category[0], op: 'in', values: sel });
    });
    if (DB.cross && DB.cross.page === p.id && DB.cross.vid !== v.id && v.type !== 'slicer')
        f.push(DB.cross.value == null ? { column: DB.cross.column, op: 'blank', values: [] } : { column: DB.cross.column, op: 'in', values: [String(DB.cross.value)] });
    return f.filter(function (x) { return x.column && (x.op === 'blank' || x.op === 'notBlank' || (x.values && x.values.length)); });
}

function dashRequest(v) {
    var f = v.fields, req = { groupBy: [], filters: dashFiltersFor(v), measures: [], orderBy: [], totals: v.type === 'table' || v.type === 'matrix' };
    (f.category || []).forEach(function (c) { if (c && req.groupBy.indexOf(c) < 0) req.groupBy.push(c); });
    if (f.series && req.groupBy.indexOf(f.series) < 0) req.groupBy.push(f.series);
    if (v.type !== 'slicer') (f.values || []).forEach(function (m) { req.measures.push(m.expression ? { name: m.name, expression: m.expression } : { name: m.name }); });
    // a slicer lists the values that have data (a calendar has every day of every year): borrow a measure of the page
    if (v.type === 'slicer' && /^'?calendar'?\[/.test(f.category[0] || '')) {
        var withValue = dashPage().visuals.find(function (o) { return o.type !== 'slicer' && o.fields.values && o.fields.values.length; });
        if (withValue) req.measures = [withValue.fields.values[0].expression ? { name: '_n', expression: withValue.fields.values[0].expression } : { name: withValue.fields.values[0].name }];
    }
    if (v.type === 'kpi' && f.category && f.category.length) req.groupBy = [];        // the KPI value is the total; its trend is a second query
    req.top = v.top || (v.type === 'slicer' ? 500 : v.type === 'pie' || v.type === 'donut' ? 50 : 1000);
    if (v.sort && v.sort.by) req.orderBy.push({ by: v.sort.by, desc: v.sort.desc !== false });
    else if (['bar', 'column', 'pie', 'donut', 'stackedbar', 'stackedcolumn'].indexOf(v.type) >= 0 && !f.series && req.measures.length && !/calendar\[/.test(f.category[0] || ''))
        req.orderBy.push({ by: req.measures[0].name, desc: true });                 // biggest first, like Power BI
    return req;
}

function dashRunPage(only) {
    var p = dashPage(); if (!p) return;
    var todo = p.visuals.filter(function (v) { return v.type !== 'text' && (!only || only.indexOf(v.id) >= 0); });
    var queue = todo.slice(), running = 0;
    function next() {
        while (running < 4 && queue.length) {
            var v = queue.shift(); running++;
            dashRunVisual(v).then(function () { running--; next(); });
        }
    }
    todo.forEach(function (v) { var b = document.querySelector('.dv[data-v="' + v.id + '"] .dv-body'); if (b) b.classList.add('loading'); });
    next();
    p.visuals.filter(function (v) { return v.type === 'text'; }).forEach(dashDrawVisual);
}

function dashRunVisual(v) {
    var ok = v.type === 'slicer' ? (v.fields.category || []).length : (v.fields.values || []).length;
    if (!ok) { delete DB.results[v.id]; DB.errors[v.id] = null; dashDrawVisual(v); return Promise.resolve(); }
    var jobs = [fm('fmEvaluate', { request: dashRequest(v) })];
    if (v.type === 'kpi' && v.fields.category && v.fields.category[0]) {
        var t = dashRequest(v); t.groupBy = [v.fields.category[0]]; t.measures = t.measures.slice(0, 1); t.orderBy = []; t.totals = false; t.top = 60;
        jobs.push(fm('fmEvaluate', { request: t }));
    }
    return Promise.all(jobs).then(function (rs) {
        DB.results[v.id] = rs[0].result; DB.results[v.id].trend = rs[1] ? rs[1].result : null; DB.errors[v.id] = null;
    }).catch(function (e) { DB.results[v.id] = null; DB.errors[v.id] = String(e); })
      .then(function () { dashDrawVisual(v); });
}

// ── canvas ─────────────────────────────────────────────────────
function dashColW() { var c = $('dash-canvas'); return Math.max(20, (c.clientWidth - 16) / 24); }

function dashRenderCanvas() {
    var p = dashPage(), c = $('dash-canvas'); if (!p || !c) return;
    Object.keys(DB.charts).forEach(function (k) { try { DB.charts[k].destroy(); } catch (e) { } }); DB.charts = {};
    var bottom = p.visuals.reduce(function (m, v) { return Math.max(m, v.y + v.h); }, 0);
    c.innerHTML = '<div class="dgrid" style="height:' + Math.max(bottom + (DB.edit ? 6 : 1), 10) * DASH_ROW + 'px">' + p.visuals.map(dashVisualShell).join('') + '</div>' +
        (!p.visuals.length ? '<div class="dcanvas-empty">' + (DB.edit ? '<i class="fa-solid fa-hand-pointer"></i> Pick a visual on the right, or drag a measure or a column onto the canvas' :
            'This page is empty — <a href="#" data-dq="toggle-edit">edit</a> it or ask Copilot') + '</div>' : '');
    dashLayout();
    p.visuals.forEach(function (v) { if (DB.results[v.id] !== undefined || v.type === 'text') dashDrawVisual(v); });
}

function dashLayout() {
    var p = dashPage(); if (!p) return;
    var cw = dashColW();
    // narrow screens (reading view): one column in reading order, like a phone layout
    if (!DB.edit && $('dash-canvas').clientWidth < 700) {
        var top = 0, full = $('dash-canvas').clientWidth - 16;
        p.visuals.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; }).forEach(function (v) {
            var el = document.querySelector('.dv[data-v="' + v.id + '"]'); if (!el) return;
            var h = (v.type === 'card' || v.type === 'kpi' ? Math.max(3, v.h) : v.type === 'slicer' ? Math.min(v.h, 5) : Math.max(6, v.h)) * DASH_ROW - 8;
            el.style.left = '8px'; el.style.top = top + 'px'; el.style.width = full + 'px'; el.style.height = h + 'px';
            top += h + 8;
        });
        var g = document.querySelector('#dash-canvas .dgrid'); if (g) g.style.height = top + 'px';
        Object.keys(DB.charts).forEach(function (k) { try { DB.charts[k].resize(); } catch (e) { } });
        return;
    }
    p.visuals.forEach(function (v) {
        var el = document.querySelector('.dv[data-v="' + v.id + '"]'); if (!el) return;
        el.style.left = (8 + v.x * cw) + 'px'; el.style.top = (v.y * DASH_ROW) + 'px';
        el.style.width = (v.w * cw - 8) + 'px'; el.style.height = (v.h * DASH_ROW - 8) + 'px';
    });
    Object.keys(DB.charts).forEach(function (k) { try { DB.charts[k].resize(); } catch (e) { } });
}

function dashVisualShell(v) {
    var title = v.options.hideTitle ? '' : (v.title || '');
    return '<div class="dv t-' + v.type + (DB.sel === v.id ? ' sel' : '') + '" data-v="' + esc(v.id) + '">' +
        '<div class="dv-head"><span class="dv-title">' + esc(title) + '</span><span class="dv-tools">' +
        (v.type !== 'text' && v.type !== 'slicer' ? '<button data-dva="table" title="Show as a table"><i class="fa-solid fa-table-list"></i></button>' : '') +
        '<button data-dva="focus" title="Focus mode"><i class="fa-solid fa-up-right-and-down-left-from-center"></i></button>' +
        '<button data-dva="menu" title="More"><i class="fa-solid fa-ellipsis"></i></button></span></div>' +
        '<div class="dv-body"></div>' + (DB.edit ? '<div class="dv-resize" title="Resize"></div>' : '') + '</div>';
}

function dashDrawVisual(v) {
    var el = document.querySelector('.dv[data-v="' + v.id + '"] .dv-body'); if (!el) return;
    el.classList.remove('loading');
    if (DB.charts[v.id]) { try { DB.charts[v.id].destroy(); } catch (e) { } delete DB.charts[v.id]; }
    if (v.type === 'text') { el.innerHTML = '<div class="dv-text">' + (typeof md === 'function' ? md(v.options.text || '') : esc(v.options.text || '')) + '</div>'; return; }
    if (DB.errors[v.id]) { el.innerHTML = '<div class="dv-msg err"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(DB.errors[v.id]) + '</div>'; return; }
    var r = DB.results[v.id];
    if (!r) { el.innerHTML = '<div class="dv-msg">' + (DB.edit ? '<i class="fa-solid fa-arrow-right"></i> Add ' + (v.type === 'slicer' ? 'a column' : 'a value') + ' in <b>Build</b>' : 'No fields') + '</div>'; return; }
    if (DB.tableView[v.id]) return dashDrawTable(v, r, el, true);
    switch (v.type) {
        case 'card': return dashDrawCard(v, r, el);
        case 'kpi': return dashDrawKpi(v, r, el);
        case 'table': return dashDrawTable(v, r, el);
        case 'matrix': return dashDrawMatrix(v, r, el);
        case 'slicer': return dashDrawSlicer(v, r, el);
        default: return dashDrawChart(v, r, el);
    }
}

// ── formatting ─────────────────────────────────────────────────
function dashFmt(v, r, i) {
    var c = r.columns[i] || {};
    return (v.options.format && c.role === 'measure') ? v.options.format : c.format || (S.model.measures.find(function (m) { return m.name === c.name; }) || {}).format || '#,0.##';
}
function dashNum(x) { return x == null ? null : +x; }
function dashCompact(v, f) {
    if (v == null || isNaN(v)) return '';
    if (/%$/.test(f || '')) return Math.round(v * 1000) / 10 + '%';
    var a = Math.abs(v);
    return a >= 1e9 ? (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B' : a >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : a >= 1e4 ? (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : (+v.toFixed(2)).toLocaleString();
}
function dashLabel(x) { return x == null ? '(blank)' : String(x); }
function dashGroupCount(r) { return r.columns.filter(function (c) { return c.role === 'group'; }).length; }

// ── cards ──────────────────────────────────────────────────────
function dashDrawCard(v, r, el) {
    var g = dashGroupCount(r), val = r.rows.length ? r.rows[0][g] : null;
    var f = dashFmt(v, r, g);
    el.innerHTML = '<div class="dcard"><b title="' + esc(fmtValue(val, f)) + '">' + esc(val == null ? '—' : dashCompactCard(val, f)) + '</b><small>' + esc(r.columns[g] ? r.columns[g].name : '') + '</small></div>';
}
function dashCompactCard(v, f) { return Math.abs(+v) >= 1e6 && !/%$/.test(f) ? dashCompact(+v, f) : fmtValue(+v, f); }

function dashDrawKpi(v, r, el) {
    var g = dashGroupCount(r), row = r.rows[0] || [], val = row[g], cmp = r.columns.length > g + 1 ? row[g + 1] : null, f = dashFmt(v, r, g);
    var delta = cmp != null && +cmp !== 0 && val != null ? (val - cmp) / Math.abs(cmp) : null;
    var goodUp = v.options.lowerIsBetter ? delta < 0 : delta > 0;
    el.innerHTML = '<div class="dkpi"><div class="dkpi-top"><b>' + esc(val == null ? '—' : dashCompactCard(val, f)) + '</b>' +
        (delta != null ? '<span class="delta ' + (goodUp ? 'good' : 'bad') + '"><i class="fa-solid fa-arrow-' + (delta >= 0 ? 'up' : 'down') + '"></i> ' + (Math.abs(delta) * 100).toFixed(1) + '% <small>vs ' + esc(r.columns[g + 1].name) + ' (' + esc(dashCompact(+cmp, f)) + ')</small></span>' : '') +
        '</div><div class="dkpi-spark"><canvas></canvas></div></div>';
    var t = r.trend;
    if (!t || !t.rows.length || typeof Chart === 'undefined') { el.querySelector('.dkpi-spark').remove(); return; }
    DB.charts[v.id] = new Chart(el.querySelector('canvas'), {
        type: 'line',
        data: { labels: t.rows.map(function (x) { return dashLabel(x[0]); }), datasets: [{ data: t.rows.map(function (x) { return dashNum(x[1]); }), borderColor: v.options.color || DASH_COLORS[0], backgroundColor: (v.options.color || DASH_COLORS[0]) + '22', fill: true, borderWidth: 2, pointRadius: 0, tension: .3 }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return fmtValue(c.parsed.y, f); } } } }, scales: { x: { display: false }, y: { display: false } } }
    });
}

// ── tables ─────────────────────────────────────────────────────
function dashDrawTable(v, r, el, asTable) {
    var g = dashGroupCount(r);
    el.innerHTML = '<div class="dtable"><table><thead><tr>' + r.columns.map(function (c, i) { return '<th' + (i >= g ? ' class="n"' : '') + '>' + esc(i < g ? dashShortCol(c.name) : c.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        r.rows.map(function (row) {
            return '<tr' + (g ? ' data-dx="' + esc(JSON.stringify(row[0])) + '"' : '') + '>' + row.map(function (x, i) { return '<td' + (i >= g ? ' class="n"' : '') + '>' + esc(i < g ? dashLabel(x) : fmtValue(x == null ? null : +x, dashFmt(v, r, i))) + '</td>'; }).join('') + '</tr>';
        }).join('') +
        (r.totals && g ? '<tr class="tot"><td colspan="' + g + '">Total</td>' + r.totals.slice(g).map(function (x, i) { return '<td class="n">' + esc(fmtValue(x == null ? null : +x, dashFmt(v, r, g + i))) + '</td>'; }).join('') + '</tr>' : '') +
        '</tbody></table>' + (r.capped ? '<div class="muted sm pad">first ' + r.rows.length + ' rows</div>' : '') + '</div>';
    if (asTable) return;
}

function dashDrawMatrix(v, r, el) {
    var cat = v.fields.category || [], hasSeries = !!v.fields.series, g = dashGroupCount(r), nRow = hasSeries ? g - 1 : g, meas = r.columns.slice(g);
    if (!hasSeries) return dashDrawTable(v, r, el);
    var rowsMap = {}, rows = [], cols = [], colSet = {};
    r.rows.forEach(function (row) {
        var k = JSON.stringify(row.slice(0, nRow)), c = dashLabel(row[nRow]);
        if (!(k in rowsMap)) { rowsMap[k] = rows.length; rows.push({ labels: row.slice(0, nRow), cells: {} }); }
        if (!(c in colSet)) { colSet[c] = 1; cols.push(c); }
        rows[rowsMap[k]].cells[c] = row.slice(g);
    });
    cols.sort();
    var colTotals = cols.map(function (c) { return meas.map(function (_, i) { return rows.reduce(function (s, x) { var y = (x.cells[c] || [])[i]; return s + (y == null ? 0 : +y); }, 0); }); });
    el.innerHTML = '<div class="dtable"><table><thead><tr><th colspan="' + nRow + '"></th>' + cols.map(function (c) { return '<th class="n" colspan="' + meas.length + '">' + esc(c) + '</th>'; }).join('') + '</tr>' +
        (meas.length > 1 ? '<tr><th colspan="' + nRow + '"></th>' + cols.map(function () { return meas.map(function (m) { return '<th class="n">' + esc(m.name) + '</th>'; }).join(''); }).join('') + '</tr>' : '') +
        '</thead><tbody>' + rows.map(function (x) {
            return '<tr>' + x.labels.map(function (l) { return '<td>' + esc(dashLabel(l)) + '</td>'; }).join('') + cols.map(function (c) {
                var cell = x.cells[c] || []; return meas.map(function (_, i) { return '<td class="n">' + esc(cell[i] == null ? '' : fmtValue(+cell[i], dashFmt(v, r, g + i))) + '</td>'; }).join('');
            }).join('') + '</tr>';
        }).join('') +
        '<tr class="tot"><td colspan="' + nRow + '">Total</td>' + colTotals.map(function (t) { return t.map(function (y, i) { return '<td class="n">' + esc(/%$/.test(dashFmt(v, r, g + i)) ? '' : fmtValue(y, dashFmt(v, r, g + i))) + '</td>'; }).join(''); }).join('') + '</tr>' +
        '</tbody></table></div>';
}

// ── slicers ────────────────────────────────────────────────────
function dashDrawSlicer(v, r, el) {
    var vals = r.rows.map(function (x) { return x[0]; }).filter(function (x) { return x != null; }).map(String);
    var sel = DB.slicers[v.id] || [];
    if ((v.options.style || 'list') === 'dropdown') {
        el.innerHTML = '<div class="dslicer"><select data-dsl="' + esc(v.id) + '"><option value="">All</option>' + vals.map(function (x) { return '<option' + (sel[0] === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></div>';
        return;
    }
    el.innerHTML = '<div class="dslicer">' + (vals.length > 8 ? '<input class="dsl-q" data-dslq="' + esc(v.id) + '" placeholder="Search">' : '') +
        '<div class="dsl-list">' + vals.map(function (x) {
            return '<label><input type="checkbox" data-dslc="' + esc(v.id) + '" value="' + esc(x) + '"' + (sel.indexOf(x) >= 0 ? ' checked' : '') + '> <span>' + esc(x) + '</span></label>';
        }).join('') + '</div></div>';
}

function dashSetSlicer(vid, values) {
    DB.slicers[vid] = values;
    var p = dashPage();
    $('dash-top').innerHTML = dashToolbar();
    dashRunPage(p.visuals.filter(function (o) { return o.id !== vid; }).map(function (o) { return o.id; }));
}

// ── charts ─────────────────────────────────────────────────────
/** rows → labels × datasets: with a legend column the series values become datasets (8 + Other), else one per measure. */
function dashSeries(v, r) {
    var g = dashGroupCount(r), hasSeries = !!v.fields.series && g >= 2, catN = hasSeries ? g - 1 : g;
    var labels = [], li = {}, key = function (row) { return row.slice(0, catN).map(dashLabel).join(' · ') || 'Total'; };
    r.rows.forEach(function (row) { var k = key(row); if (!(k in li)) { li[k] = labels.length; labels.push(k); } });
    var raw = r.rows.map(function (row) { return row[0]; });
    var sets = [];
    if (hasSeries) {
        var totals = {};
        r.rows.forEach(function (row) { var s = dashLabel(row[catN]); totals[s] = (totals[s] || 0) + Math.abs(+row[g] || 0); });
        var names = Object.keys(totals).sort(function (a, b) { return totals[b] - totals[a]; }), keep = names.slice(0, names.length > 8 ? 7 : 8);
        var byName = {};
        keep.forEach(function (n) { byName[n] = labels.map(function () { return null; }); });
        if (names.length > 8) byName.Other = labels.map(function () { return null; });
        r.rows.forEach(function (row) {
            var s = dashLabel(row[catN]), target = byName[s] || byName.Other, i = li[key(row)];
            if (target) target[i] = (target[i] || 0) + (row[g] == null ? 0 : +row[g]);
        });
        // colours follow the series name (stable when filters change the count), in fixed order of first appearance
        var order = v.options.seriesOrder || (v.options.seriesOrder = []);
        Object.keys(byName).forEach(function (n) { if (n !== 'Other' && order.indexOf(n) < 0) order.push(n); });
        sets = Object.keys(byName).map(function (n) { return { label: n, data: byName[n], color: n === 'Other' ? DASH_OTHER : DASH_COLORS[order.indexOf(n) % 8] }; });
        return { labels: labels, sets: sets, fmt: dashFmt(v, r, g), raw: raw, catN: catN };
    }
    r.columns.slice(g).slice(0, 8).forEach(function (c, i) {
        var data = labels.map(function () { return null; });
        r.rows.forEach(function (row) { data[li[key(row)]] = dashNum(row[g + i]); });
        sets.push({ label: c.name, data: data, color: i === 0 && v.options.color ? v.options.color : DASH_COLORS[i], fmt: dashFmt(v, r, g + i) });
    });
    return { labels: labels, sets: sets, fmt: dashFmt(v, r, g), raw: raw, catN: catN };
}

var dashLabelsPlugin = {
    id: 'dashLabels',
    afterDatasetsDraw: function (chart) {
        var o = chart.options.plugins.dashLabels; if (!o || !o.on) return;
        var ctx = chart.ctx; ctx.save(); ctx.font = '11px Segoe UI, sans-serif'; ctx.fillStyle = '#52514e'; ctx.textAlign = 'center';
        chart.data.datasets.forEach(function (ds, di) {
            var meta = chart.getDatasetMeta(di); if (meta.hidden) return;
            if (meta.data.length > 24) return;
            meta.data.forEach(function (el, i) {
                var val = ds.data[i]; if (val == null || (typeof val === 'object')) return;
                var p = el.tooltipPosition ? el.tooltipPosition() : el;
                var txt = dashCompact(val, ds._fmt || o.fmt);
                if (chart.options.indexAxis === 'y') { ctx.textAlign = 'left'; ctx.fillText(txt, p.x + 4, p.y + 4); }
                else ctx.fillText(txt, p.x, p.y - 6);
            });
        });
        ctx.restore();
    }
};

function dashDrawChart(v, r, el) {
    if (typeof Chart === 'undefined') { dashDrawTable(v, r, el); return; }
    el.innerHTML = '<div class="dchart"><canvas></canvas></div>';
    var canvas = el.querySelector('canvas');
    var t = v.type, s = dashSeries(v, r);
    var cross = DB.cross && DB.cross.page === dashPage().id && DB.cross.vid === v.id ? dashLabel(DB.cross.value) : null;
    var fade = function (col, i) { return cross == null || s.labels[i] === cross ? col : col + '4d'; };
    var grid = { color: '#e1e0d9', drawTicks: false }, tick = { color: '#898781', font: { size: 11 } };
    var cfg;
    if (t === 'pie' || t === 'donut') {
        var d0 = s.sets[0] || { data: [] }, idx = s.labels.map(function (_, i) { return i; }).sort(function (a, b) { return (d0.data[b] || 0) - (d0.data[a] || 0); });
        var top = idx.slice(0, idx.length > 8 ? 7 : 8), rest = idx.slice(top.length);
        var labels = top.map(function (i) { return s.labels[i]; }).concat(rest.length ? ['Other'] : []);
        var data = top.map(function (i) { return d0.data[i]; }).concat(rest.length ? [rest.reduce(function (a, i) { return a + (d0.data[i] || 0); }, 0)] : []);
        var colors = labels.map(function (l, i) { return l === 'Other' ? DASH_OTHER : DASH_COLORS[i]; });
        cfg = { type: 'doughnut', data: { labels: labels, datasets: [{ data: data, backgroundColor: colors.map(function (c, i) { return cross == null || labels[i] === cross ? c : c + '4d'; }), borderColor: '#fcfcfb', borderWidth: 2 }] },
            options: { cutout: t === 'donut' ? '62%' : 0, plugins: { legend: { display: v.options.legend !== false, position: 'right', labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: function (c) { var sum = c.dataset.data.reduce(function (a, b) { return a + (b || 0); }, 0); return c.label + ': ' + fmtValue(c.parsed, s.fmt) + ' (' + (sum ? (c.parsed / sum * 100).toFixed(1) : 0) + '%)'; } } } } } };
    } else if (t === 'gauge') {
        var val = s.sets[0] ? s.sets[0].data[0] : 0, max = v.options.max || (s.sets[1] ? s.sets[1].data[0] : null) || (val ? val * 1.25 : 1);
        el.querySelector('.dchart').insertAdjacentHTML('beforeend', '<div class="dgauge-v"><b>' + esc(fmtValue(val, s.sets[0] ? s.sets[0].fmt : s.fmt)) + '</b><small>of ' + esc(fmtValue(max, s.sets[0] ? s.sets[0].fmt : s.fmt)) + '</small></div>');
        cfg = { type: 'doughnut', data: { labels: ['Value', 'Remaining'], datasets: [{ data: [Math.min(val, max), Math.max(0, max - val)], backgroundColor: [v.options.color || DASH_COLORS[0], '#e1e0d9'], borderWidth: 0 }] },
            options: { rotation: -90, circumference: 180, cutout: '72%', plugins: { legend: { display: false }, tooltip: { enabled: false } } } };
    } else if (t === 'scatter') {
        var pts = r.rows.map(function (row) { var g = dashGroupCount(r); return { x: dashNum(row[g]), y: dashNum(row[g + 1]), label: dashLabel(row[0]) }; });
        cfg = { type: 'scatter', data: { datasets: [{ data: pts, backgroundColor: (v.options.color || DASH_COLORS[0]) + 'cc', borderColor: '#fcfcfb', borderWidth: 1, pointRadius: 5, pointHoverRadius: 7 }] },
            options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return c.raw.label + ': ' + r.columns[dashGroupCount(r)].name + ' ' + dashCompact(c.raw.x) + ', ' + (r.columns[dashGroupCount(r) + 1] || {}).name + ' ' + dashCompact(c.raw.y); } } } },
                scales: { x: { grid: grid, ticks: tick, title: { display: true, text: (r.columns[dashGroupCount(r)] || {}).name, color: '#52514e' } }, y: { grid: grid, ticks: tick, title: { display: true, text: (r.columns[dashGroupCount(r) + 1] || {}).name, color: '#52514e' } } } } };
    } else {
        var horiz = t === 'bar' || t === 'stackedbar', stacked = t === 'stackedbar' || t === 'stackedcolumn', line = t === 'line' || t === 'area';
        var sets = s.sets.map(function (d, i) {
            var asLine = line || (t === 'combo' && i > 0);
            return {
                type: asLine ? 'line' : 'bar', label: d.label, data: d.data, _fmt: d.fmt,
                backgroundColor: asLine ? (t === 'area' ? d.color + '26' : d.color) : d.data.map(function (_, j) { return fade(d.color, j); }),
                borderColor: d.color, borderWidth: asLine ? 2 : 0, fill: t === 'area', tension: .25,
                pointRadius: asLine && d.data.length <= 24 ? 2 : 0, pointHoverRadius: 5,
                borderRadius: asLine ? 0 : 4, borderSkipped: 'start', maxBarThickness: 48, order: asLine ? 0 : 1
            };
        });
        var valueAxis = { beginAtZero: true, stacked: stacked, grid: grid, border: { display: false }, ticks: Object.assign({ callback: function (x) { return dashCompact(x, s.sets[0] ? s.sets[0].fmt : s.fmt); } }, tick) };
        var catAxis = { stacked: stacked, grid: { display: false }, border: { color: '#c3c2b7' }, ticks: Object.assign({ autoSkip: true, maxRotation: 0 }, tick) };
        cfg = { type: 'bar', data: { labels: s.labels, datasets: sets },
            options: { indexAxis: horiz ? 'y' : 'x', interaction: line || t === 'combo' ? { mode: 'index', intersect: false } : { mode: 'nearest', intersect: true },
                plugins: { legend: { display: sets.length > 1 && v.options.legend !== false, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 } } },
                    tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + fmtValue(c.parsed[horiz ? 'x' : 'y'], c.dataset._fmt || s.fmt); } } },
                    dashLabels: { on: !!v.options.labels, fmt: s.fmt } },
                scales: horiz ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis } } };
    }
    cfg.plugins = [dashLabelsPlugin];
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, cfg.options);
    // click = cross-filter the page by the category under the pointer (click again to clear)
    if (t !== 'gauge' && (v.fields.category || []).length && s.catN === 1)
        cfg.options.onClick = function (evt, els, chart) {
            if (!els.length) return;
            var i = els[0].index, label;
            if (t === 'scatter') label = r.rows[i] ? r.rows[i][0] : null;
            else label = chart.data.labels[i];
            if (label === 'Other') return;
            var rawVal = r.rows.find(function (row) { return dashLabel(row[0]) === label; });
            var value = rawVal ? rawVal[0] : label;
            // after Chart.js has finished handling this click: the cross-filter redraws (and destroys) this chart
            setTimeout(function () { dashCross(v, value); }, 0);
        };
    DB.charts[v.id] = new Chart(canvas, cfg);
}

function dashCross(v, value) {
    var p = dashPage();
    if (DB.cross && DB.cross.vid === v.id && DB.cross.value === value) DB.cross = null;
    else DB.cross = { page: p.id, vid: v.id, column: v.fields.category[0], value: value };
    $('dash-top').innerHTML = dashToolbar();
    dashDrawVisual(v);
    dashRunPage(p.visuals.filter(function (o) { return o.id !== v.id; }).map(function (o) { return o.id; }));
}

// ── focus mode, visual menu, export ────────────────────────────
function dashFocus(vid) {
    var v = dashVisual(vid); if (!v) return;
    modal('<div class="mh"><b>' + esc(v.title || dashTypeLabel(v.type)) + '</b><small class="muted"></small><button class="btn sm" data-dva="exportv" data-vid="' + esc(vid) + '"><i class="fa-solid fa-file-csv"></i> Export data</button><button class="btn sm" data-mact="close"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="dv focus t-' + v.type + '" data-v="' + esc(vid) + '" style="position:relative;height:70vh"><div class="dv-body"></div></div>', 'wide');
    dashDrawVisual(v);
}

function dashExportVisual(vid) {
    var v = dashVisual(vid), r = DB.results[vid]; if (!r) { toast('Nothing to export'); return; }
    var q = function (x) { x = x == null ? '' : String(x); return /[",\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    var text = [r.columns.map(function (c) { return q(c.name); }).join(',')].concat(r.rows.map(function (row) { return row.map(q).join(','); })).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }));
    a.download = ((v.title || v.type) + '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function dashVisualMenu(vid, btn) {
    var v = dashVisual(vid); if (!v) return;
    closeDashMenu();
    var items = [['exportv', 'fa-file-csv', 'Export data'], ['focus', 'fa-up-right-and-down-left-from-center', 'Focus mode']];
    if (v.type !== 'text' && v.type !== 'slicer') items.push(['table', 'fa-table-list', DB.tableView[vid] ? 'Show as chart' : 'Show as a table']);
    items.push(['explain', 'fa-wand-magic-sparkles', 'Explain with Copilot']);
    if (DB.edit) items.push(['dup', 'fa-clone', 'Duplicate'], ['front', 'fa-arrow-up', 'Bring to top'], ['del', 'fa-trash', 'Delete']);
    dashMenu(btn, items.map(function (x) { return '<button data-dva="' + x[0] + '" data-vid="' + esc(vid) + '"><i class="fa-solid ' + x[1] + '"></i> ' + x[2] + '</button>'; }).join(''));
}
function dashMenu(anchor, html) {
    closeDashMenu();
    var r = anchor.getBoundingClientRect(), m = document.createElement('div');
    m.className = 'dmenu'; m.innerHTML = html; document.body.appendChild(m);
    m.style.top = (r.bottom + 4) + 'px'; m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + 'px';
}
function closeDashMenu() { document.querySelectorAll('.dmenu').forEach(function (x) { x.remove(); }); }

/** What a page shows, for Copilot's "explain": each visual with its data (rows capped). */
function dashPageData(only) {
    var p = dashPage();
    return {
        dashboard: DB.cur.name, page: p.name, selections: dashFilterChips().replace(/<[^>]+>/g, ' ').replace(/×/g, '').trim(),
        visuals: p.visuals.filter(function (v) { return v.type !== 'text' && (!only || v.id === only); }).map(function (v) {
            var r = DB.results[v.id];
            return { title: v.title, type: v.type, columns: r ? r.columns.map(function (c) { return c.name; }) : [], rows: r ? r.rows.slice(0, 40) : [], totals: r ? r.totals : null };
        })
    };
}

// ── save / open ────────────────────────────────────────────────
function dashMark() { DB.dirty = true; $('dash-top').innerHTML = dashToolbar(); }
function dashSnapshot() { DB.undo.push(JSON.stringify(DB.cur)); if (DB.undo.length > 60) DB.undo.shift(); DB.redo = []; }
function dashUndo() { if (!DB.undo.length) return; DB.redo.push(JSON.stringify(DB.cur)); DB.cur = JSON.parse(DB.undo.pop()); DB.page = Math.min(DB.page, DB.cur.pages.length - 1); DB.dirty = true; dashRender(true); }
function dashRedo() { if (!DB.redo.length) return; DB.undo.push(JSON.stringify(DB.cur)); DB.cur = JSON.parse(DB.redo.pop()); DB.dirty = true; dashRender(true); }

function dashSave(asCopy) {
    var d = JSON.parse(JSON.stringify(DB.cur));
    if (asCopy) { d.name = prompt('Name of the copy', d.name + ' (copy)'); if (!d.name) return; delete d.id; delete d.locked; }
    if (!d.id && !asCopy) { var n = prompt('Dashboard name', d.name); if (!n) return; d.name = n; }
    busy('Saving…');
    return fm('fmDashboardSave', { dashboard: d }).then(function (r) {
        busy(null); DB.cur = normDash(r.dashboard); DB.dirty = false;
        DB.list = (DB.list || []).filter(function (x) { return x.id !== DB.cur.id; }).concat([JSON.parse(JSON.stringify(DB.cur))]);
        toast('Saved — everyone with the model can open it'); dashRender(false);
    }).catch(function (e) { busy(null); toast(String(e)); });
}

function dashOpen(d) {
    if (DB.dirty && !confirm('Discard unsaved changes to ' + DB.cur.name + '?')) { $('dash-top').innerHTML = dashToolbar(); return; }
    DB.cur = d ? normDash(JSON.parse(JSON.stringify(d))) : null; DB.page = 0; DB.sel = null; DB.dirty = false;
    DB.results = {}; DB.errors = {}; DB.slicers = {}; DB.cross = null; DB.tableView = {}; DB.undo = []; DB.redo = [];
    dashRender(true);
}

function dashQuick() {
    var mods = (S.model.modules || []).map(function (m) { return m.name; });
    var module = mods.length > 1 ? prompt('Quick dashboard for which module? (' + mods.join(', ') + ' — empty = all)', '') : '';
    if (module === null) return;
    busy('Designing the page…');
    fm('fmDashboardAuto', { module: module || '' }).then(function (r) {
        busy(null); dashOpen(null); DB.cur = normDash(r.dashboard); DB.edit = true; DB.dirty = true; dashRender(true);
        toast('Quick dashboard ready — change anything, then Save');
    }).catch(function (e) { busy(null); toast(String(e)); });
}

// ── Copilot ────────────────────────────────────────────────────
function dashRenderCopilot() {
    var el = $('dash-copilot'); if (!el) return;
    if (!DB.copilot) { el.innerHTML = ''; return; }
    var sugg = DB.cur
        ? ['Add a donut of the main measure by customer', 'Add a slicer for year and a KPI vs last year', 'Make a second page with the details as a matrix', 'Explain this page']
        : ['Build a sales overview with trend, top customers and a year slicer', 'Build a payables dashboard: open, overdue, due next 30 days by supplier', 'Build an order fulfilment dashboard: fill rate and on-time by customer'];
    el.innerHTML = '<div class="cp-h"><b><i class="fa-solid fa-wand-magic-sparkles"></i> Copilot</b><div class="seg" id="cp-mode">' +
        [['auto', 'Auto'], ['create', 'New'], ['edit', 'Change'], ['insights', 'Explain']].map(function (m) { return '<button data-cpm="' + m[0] + '"' + ((DB.cpMode || 'auto') === m[0] ? ' class="on"' : '') + '>' + m[1] + '</button>'; }).join('') +
        '</div><button class="btn xs" data-dq="copilot"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="cp-thread" id="cp-thread">' + (DB.chat.length ? DB.chat.map(dashChatItem).join('') :
            '<div class="muted sm pad">Describe the dashboard you want — Copilot finds the measures and columns in your model, lays out the page and checks every visual before it appears. It can also change this dashboard or explain what the page shows.</div>' +
            '<div class="cp-sugg">' + sugg.map(function (x) { return '<button class="chip" data-cps="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>') + '</div>' +
        '<div class="cp-in"><textarea id="cp-text" rows="3" placeholder="' + (DB.cur ? 'e.g. add a bar of overdue amount by supplier, top 10' : 'e.g. build a receivables dashboard for the finance team') + '"></textarea>' +
        '<button class="btn primary" data-dq="cp-send"' + (DB.busy ? ' disabled' : '') + '><i class="fa-solid fa-' + (DB.busy ? 'circle-notch fa-spin' : 'paper-plane') + '"></i></button></div>';
    var th = $('cp-thread'); if (th) th.scrollTop = 1e9;
}

function dashChatItem(m) {
    if (m.role === 'user') return '<div class="cp-msg user">' + esc(m.text) + '</div>';
    if (m.pending) return '<div class="cp-msg bot"><i class="fa-solid fa-circle-notch fa-spin"></i> <span class="muted">' + esc(m.status || 'Working…') + '</span>' +
        (m.steps && m.steps.length ? '<div class="steps live">' + m.steps.slice(-4).map(function (s) { return '<div>' + esc(s) + '</div>'; }).join('') + '</div>' : '') + '</div>';
    if (m.error) return '<div class="cp-msg bot err"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(m.error) + '</div>';
    return '<div class="cp-msg bot">' + (typeof md === 'function' ? md(m.text || '') : esc(m.text || '')) +
        (m.applied ? '<div class="cp-applied"><i class="fa-solid fa-check"></i> Applied to the canvas' + (m.undoable ? ' · <a href="#" data-dq="undo">Undo</a>' : '') + '</div>' : '') +
        (m.warnings ? '<div class="cp-warn sm"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(m.warnings) + '</div>' : '') +
        (m.steps && m.steps.length ? '<details class="steps"><summary>' + m.steps.length + ' steps' + (m.cost != null ? ' · $' + (+m.cost).toFixed(3) : '') + '</summary>' + m.steps.map(function (s) { return '<div>' + esc(s) + '</div>'; }).join('') + '</details>' : '') + '</div>';
}

function dashCopilotSend(text, forceMode) {
    text = (text || '').trim(); if (!text || DB.busy) return;
    var mode = forceMode || (DB.cpMode && DB.cpMode !== 'auto' ? DB.cpMode : null);
    if (!mode) mode = !DB.cur || /^\s*(build|create|make|design|new)\b.*\bdashboard\b/i.test(text) ? 'create' : /\b(explain|insight|summar|why|what does|tell me)\b/i.test(text) ? 'insights' : 'edit';
    var history = DB.chat.filter(function (m) { return !m.pending && !m.error; }).slice(-6).map(function (m) { return { role: m.role === 'user' ? 'user' : 'assistant', content: m.text || '' }; });
    DB.chat.push({ role: 'user', text: text });
    var bot = { role: 'bot', pending: true, steps: [], status: 'Copilot is reading the model…' };
    DB.chat.push(bot); DB.busy = true; dashRenderCopilot();
    var payload = { mode: mode, prompt: text, history: history };
    if (mode === 'edit') { payload.dashboard = DB.cur; payload.page = dashPage().name; }
    if (mode === 'insights') payload.pageData = dashPageData(DB.explainVisual);
    DB.explainVisual = null;
    fm('fmDashAi', payload, function (msg) { if (/^[^\w\s]/.test(msg)) bot.steps.push(msg); else bot.status = msg; dashRenderCopilot(); })
        .then(function (r) {
            bot.pending = false; bot.text = r.answer; bot.steps = r.steps; bot.cost = r.costUsd; bot.warnings = r.warnings;
            if (r.dashboard) {
                if (DB.cur) dashSnapshot();
                var keepId = mode === 'edit' && DB.cur ? DB.cur.id : null, pageName = DB.cur && dashPage() ? dashPage().name : null;
                if (mode === 'create') { DB.cur = null; DB.page = 0; DB.slicers = {}; DB.cross = null; }
                DB.cur = normDash(r.dashboard); if (keepId) DB.cur.id = keepId; else delete DB.cur.id;
                var pi = pageName ? DB.cur.pages.findIndex(function (p) { return p.name === pageName; }) : -1;
                DB.page = pi >= 0 ? pi : 0; DB.results = {}; DB.errors = {}; DB.dirty = true;
                bot.applied = true; bot.undoable = DB.undo.length > 0;
            }
        })
        .catch(function (e) { bot.pending = false; bot.error = String(e); })
        .then(function () { DB.busy = false; dashRender(!!bot.applied); });
}

// ── events ─────────────────────────────────────────────────────
document.addEventListener('click', function (e) {
    if (!e.target.closest('.dmenu') && !e.target.closest('[data-dq="menu-new"],[data-dq="more"],[data-dva="menu"]')) closeDashMenu();
    if (!$('page-dash') || $('page-dash').hidden) { if (!e.target.closest('.dmenu') && !e.target.closest('#modal')) return; }
    var b = e.target.closest('[data-dq],[data-dpg],[data-dva],[data-dclr],[data-cps],[data-cpm],[data-dx],[data-dnew]');
    if (!b) return;
    var d = b.dataset;
    if (d.dpg != null) { DB.page = +d.dpg; DB.sel = null; DB.cross = null; return dashRender(true); }
    if (d.dclr) { if (d.dclr === 'cross') DB.cross = null; else delete DB.slicers[d.dclr]; return dashRender(true); }
    if (d.cps) { $('cp-text').value = d.cps; return dashCopilotSend(d.cps); }
    if (d.cpm) { DB.cpMode = d.cpm; return dashRenderCopilot(); }
    if (d.dx != null && !DB.edit) {
        var dv = b.closest('.dv'), v0 = dv && dashVisual(dv.dataset.v);
        if (v0 && v0.type === 'table' && (v0.fields.category || []).length) { try { dashCross(v0, JSON.parse(d.dx)); } catch (x) { } }
        return;
    }
    if (d.dnew) { closeDashMenu(); if (d.dnew === 'blank') { dashOpen(null); DB.cur = dashNew(); DB.edit = true; DB.dirty = true; return dashRender(false); } if (d.dnew === 'quick') return dashQuick(); if (d.dnew === 'copilot') { DB.copilot = true; DB.cpMode = 'create'; return dashRender(false); } }
    if (d.dva) {
        var vid = d.vid || (b.closest('.dv') || {}).dataset && b.closest('.dv').dataset.v;
        closeDashMenu();
        switch (d.dva) {
            case 'menu': return dashVisualMenu(vid, b);
            case 'focus': return dashFocus(vid);
            case 'table': DB.tableView[vid] = !DB.tableView[vid]; return dashDrawVisual(dashVisual(vid));
            case 'exportv': return dashExportVisual(vid);
            case 'explain': DB.copilot = true; DB.explainVisual = vid; dashRender(false); return dashCopilotSend('Explain the visual "' + (dashVisual(vid).title || dashVisual(vid).type) + '"', 'insights');
            case 'dup': dashSnapshot(); var src = dashVisual(vid), cp = JSON.parse(JSON.stringify(src)); cp.id = dashUid(); cp.y = src.y + src.h; dashPage().visuals.push(cp); DB.sel = cp.id; dashMark(); return dashRender(true);
            case 'front': dashSnapshot(); var arr = dashPage().visuals, i = arr.findIndex(function (x) { return x.id === vid; }); arr.push(arr.splice(i, 1)[0]); dashMark(); return dashRender(false);
            case 'del': dashSnapshot(); dashPage().visuals = dashPage().visuals.filter(function (x) { return x.id !== vid; }); DB.sel = null; dashMark(); return dashRender(false);
        }
        return;
    }
    switch (d.dq) {
        case 'menu-new':
            return dashMenu(b, '<button data-dnew="copilot"><i class="fa-solid fa-wand-magic-sparkles"></i> Build with Copilot</button><button data-dnew="quick"><i class="fa-solid fa-bolt"></i> Quick dashboard (from the model)</button><button data-dnew="blank"><i class="fa-solid fa-file"></i> Blank dashboard</button>');
        case 'more':
            return dashMenu(b, '<button data-dq="saveas"><i class="fa-solid fa-copy"></i> Save a copy</button><button data-dq="rename"><i class="fa-solid fa-i-cursor"></i> Rename</button>' +
                '<button data-dq="lock"><i class="fa-solid fa-lock"></i> ' + (DB.cur.locked ? 'Unlock' : 'Lock (only you and admins change it)') + '</button><button data-dq="print"><i class="fa-solid fa-print"></i> Print / PDF</button>' +
                (DB.cur.id ? '<button data-dq="delete" class="danger"><i class="fa-solid fa-trash"></i> Delete dashboard</button>' : ''));
        case 'copilot-new': DB.copilot = true; DB.cpMode = 'create'; return dashRender(false);
        case 'quick': return dashQuick();
        case 'blank': dashOpen(null); DB.cur = dashNew(); DB.edit = true; DB.dirty = true; return dashRender(false);
        case 'toggle-edit': e.preventDefault(); DB.edit = !DB.edit; if (!DB.edit) DB.sel = null; return dashRender(false);
        case 'save': return dashSave(false);
        case 'saveas': closeDashMenu(); return dashSave(true);
        case 'rename': closeDashMenu(); var n = prompt('Dashboard name', DB.cur.name); if (n) { DB.cur.name = n; dashMark(); } return;
        case 'lock': closeDashMenu(); DB.cur.locked = !DB.cur.locked; dashMark(); return;
        case 'print': closeDashMenu(); document.body.classList.add('printing-dash'); setTimeout(function () { window.print(); document.body.classList.remove('printing-dash'); }, 50); return;
        case 'delete':
            closeDashMenu();
            if (!confirm('Delete dashboard ' + DB.cur.name + ' for everyone?')) return;
            return fm('fmDashboardDelete', { id: DB.cur.id }).then(function () { DB.list = DB.list.filter(function (x) { return x.id !== DB.cur.id; }); DB.dirty = false; dashOpen(DB.list[0] || null); }).catch(function (x) { toast(String(x)); });
        case 'refresh': DB.results = {}; return dashRunPage();
        case 'present': var r = $('dash-root'); if (r.requestFullscreen) r.requestFullscreen(); return;
        case 'copilot': DB.copilot = !DB.copilot; return dashRender(false);
        case 'cp-send': return dashCopilotSend($('cp-text').value);
        case 'undo': e.preventDefault(); return dashUndo();
        case 'addpage':
            dashSnapshot(); DB.cur.pages.push({ id: dashUid('p'), name: 'Page ' + (DB.cur.pages.length + 1), filters: [], visuals: [] }); DB.page = DB.cur.pages.length - 1; dashMark(); return dashRender(false);
    }
});
document.addEventListener('change', function (e) {
    if (!$('page-dash') || $('page-dash').hidden) return;
    var x = e.target, d = x.dataset;
    if (x.id === 'dash-sel') { var d0 = (DB.list || []).find(function (y) { return y.id === x.value; }); if (d0) dashOpen(d0); return; }
    if (d.dslc) { var vid = d.dslc, vals = Array.prototype.slice.call(document.querySelectorAll('[data-dslc="' + vid + '"]:checked')).map(function (c) { return c.value; }); return dashSetSlicer(vid, vals); }
    if (d.dsl) return dashSetSlicer(d.dsl, x.value ? [x.value] : []);
});
document.addEventListener('input', function (e) {
    var q = e.target.dataset && e.target.dataset.dslq; if (!q) return;
    var t = e.target.value.toLowerCase();
    e.target.parentNode.querySelectorAll('.dsl-list label').forEach(function (l) { l.hidden = t && l.textContent.toLowerCase().indexOf(t) < 0; });
});
document.addEventListener('keydown', function (e) {
    if (!$('page-dash') || $('page-dash').hidden) return;
    if (e.target.id === 'cp-text' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); dashCopilotSend(e.target.value); return; }
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (DB.edit && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? dashRedo() : dashUndo(); }
    if (DB.edit && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); dashRedo(); }
    if (DB.edit && DB.sel && (e.key === 'Delete' || e.key === 'Backspace')) { dashSnapshot(); dashPage().visuals = dashPage().visuals.filter(function (v) { return v.id !== DB.sel; }); DB.sel = null; dashMark(); dashRender(false); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); dashSave(false); }
});
window.addEventListener('resize', function () { if ($('page-dash') && !$('page-dash').hidden) dashLayout(); });
