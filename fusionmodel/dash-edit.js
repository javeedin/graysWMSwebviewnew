/* Fusion Model — Dashboards, edit view: Data pane (measures by folder, tables → columns, search, drag), Visualizations
   pane (type picker + wells, Format, Filters), select / move / resize visuals on the 24-column canvas, drop fields
   onto wells, visuals or empty canvas (a measure makes a card, a column a table, like Power BI). */

var DE = { pane: 'build', q: '', drag: null };
var DE_WELLS = {
    card: [['values', 'Value', 1]], kpi: [['values', 'Value, then target / comparison', 2], ['category', 'Trend axis (a date column)', 1]],
    bar: [['category', 'Y-axis', 1], ['series', 'Legend', 1], ['values', 'X-axis (values)', 8]], column: [['category', 'X-axis', 1], ['series', 'Legend', 1], ['values', 'Y-axis (values)', 8]],
    stackedbar: [['category', 'Y-axis', 1], ['series', 'Legend', 1], ['values', 'Values', 8]], stackedcolumn: [['category', 'X-axis', 1], ['series', 'Legend', 1], ['values', 'Values', 8]],
    line: [['category', 'X-axis', 1], ['series', 'Legend', 1], ['values', 'Y-axis (values)', 8]], area: [['category', 'X-axis', 1], ['series', 'Legend', 1], ['values', 'Y-axis (values)', 8]],
    combo: [['category', 'X-axis', 1], ['values', 'Columns, then lines', 8]], pie: [['category', 'Legend', 1], ['values', 'Values', 1]], donut: [['category', 'Legend', 1], ['values', 'Values', 1]],
    gauge: [['values', 'Value, then maximum', 2]], scatter: [['category', 'Values (one dot each)', 1], ['values', 'X-axis, then Y-axis', 2]],
    table: [['category', 'Columns', 10], ['values', 'Values', 10]], matrix: [['category', 'Rows', 3], ['series', 'Columns', 1], ['values', 'Values', 6]],
    slicer: [['category', 'Field', 1]], text: []
};

function dashRenderPanes() {
    if (!DB.edit || !DB.cur) { $('dash-left').innerHTML = ''; $('dash-right').innerHTML = ''; return; }
    dashRenderFields(); dashRenderRight();
}

// ── Data pane ──────────────────────────────────────────────────
function dashRenderFields() {
    var q = DE.q.toLowerCase(), hit = function (s) { return !q || String(s).toLowerCase().indexOf(q) >= 0; };
    var byFolder = {}, cols = modelColumns();
    (S.model.measures || []).filter(function (m) { return hit(m.name) || hit(m.folder || ''); }).forEach(function (m) { (byFolder[m.folder || m.table || 'Measures'] = byFolder[m.folder || m.table || 'Measures'] || []).push(m); });
    $('dash-left').innerHTML = '<div class="dp-h"><b>Data</b></div><div class="search"><i class="fa-solid fa-magnifying-glass"></i><input id="de-q" type="search" placeholder="Search" value="' + esc(DE.q) + '"></div><div class="dp-list">' +
        Object.keys(byFolder).sort().map(function (f) {
            return '<details' + (byFolder[f].some(function (m) { return !m.table || cols[m.table]; }) ? ' open' : '') + '><summary><i class="fa-solid fa-calculator"></i> ' + esc(f) + '</summary>' + byFolder[f].map(function (m) {
                var loaded = !m.table || !!cols[m.table];                 // a pack added but not refreshed yet
                return loaded ? '<div class="fld m" draggable="true" data-fk="m" data-fr="' + esc(m.name) + '" title="' + esc(m.description || m.expression || '') + '"><i class="fa-solid fa-calculator"></i> ' + esc(m.name) + '</div>'
                    : '<div class="fld m off" title="' + esc(m.table) + ' is not loaded yet - refresh its module"><i class="fa-solid fa-calculator"></i> ' + esc(m.name) + '</div>';
            }).join('') + '</details>';
        }).join('') +
        Object.keys(cols).sort().map(function (k) {
            var list = cols[k].filter(function (c) { return hit(c) || hit(k); }); if (!list.length) return '';
            var tn = daxTable(k).replace(/^'|'$/g, '');
            return '<details' + (q ? ' open' : '') + '><summary><i class="fa-solid fa-table"></i> ' + esc(k) + '</summary>' + list.map(function (c) {
                return '<div class="fld c" draggable="true" data-fk="c" data-fr="' + esc(tn + '[' + c + ']') + '"><i class="fa-solid fa-' + (k === 'calendar' ? 'calendar' : 'font') + '"></i> ' + esc(c) + '</div>';
            }).join('') + '</details>';
        }).join('') + '</div>';
}

// ── Visualizations pane ────────────────────────────────────────
function dashRenderRight() {
    var v = DB.sel && dashVisual(DB.sel);
    var tabs = '<div class="dp-tabs">' + [['build', 'fa-chart-simple', 'Build'], ['format', 'fa-paintbrush', 'Format'], ['filters', 'fa-filter', 'Filters']].map(function (t) {
        return '<button data-dep="' + t[0] + '"' + (DE.pane === t[0] ? ' class="on"' : '') + '><i class="fa-solid ' + t[1] + '"></i> ' + t[2] + '</button>';
    }).join('') + '</div>';
    var types = '<div class="vtypes">' + DASH_TYPES.map(function (t) {
        return '<button data-dvt="' + t[0] + '" title="' + t[2] + (v ? ' — change the selected visual' : ' — add to the page') + '"' + (v && v.type === t[0] ? ' class="on"' : '') + '><i class="fa-solid ' + t[1] + '"></i></button>';
    }).join('') + '</div>';
    var body = '';
    if (DE.pane === 'build') {
        body = types + (!v ? '<p class="muted sm pad">Click a visual on the canvas to edit it, or click a type above to add one. Drag measures and columns from Data into the wells.</p>' :
            '<div class="dp-sec"><b>' + esc(dashTypeLabel(v.type)) + '</b>' + (DE_WELLS[v.type] || []).map(function (w) {
                var key = w[0], items = key === 'series' ? (v.fields.series ? [v.fields.series] : []) : key === 'values' ? v.fields.values.map(function (m) { return m.name; }) : v.fields.category;
                return '<div class="well" data-well="' + key + '"><small>' + esc(w[1]) + '</small>' + items.map(function (x, i) {
                    var m = key === 'values' ? v.fields.values[i] : null;
                    return '<span class="wchip ' + (key === 'values' ? 'm' : 'c') + '" title="' + esc(m && m.expression ? m.expression : x) + '">' + esc(key === 'values' ? x : dashShortCol(x)) + (m && m.expression ? ' <i class="fa-solid fa-code" title="Ad-hoc measure"></i>' : '') +
                        '<button data-wx="' + key + '" data-i="' + i + '">×</button></span>';
                }).join('') + (items.length < w[2] ? '<span class="wdrop">Drag fields here</span>' : '') + '</div>';
            }).join('') +
            (v.type !== 'slicer' && v.type !== 'text' && v.type !== 'card' && v.type !== 'gauge' && v.type !== 'kpi' ?
                '<div class="row"><label class="fld"><span>Top</span><input type="number" data-vo="top" value="' + (v.top || '') + '" placeholder="all" min="1"></label>' +
                '<label class="fld"><span>Sort by</span><select data-vo="sort"><option value="">Default</option>' + v.fields.values.map(function (m) { return '<option value="' + esc(m.name) + '"' + (v.sort && v.sort.by === m.name ? ' selected' : '') + '>' + esc(m.name) + ' ↓</option>'; }).join('') + '</select></label></div>' : '') +
            '<button class="btn sm block" data-dq2="adhoc"><i class="fa-solid fa-code"></i> Add a calculated value…</button></div>');
    } else if (DE.pane === 'format') {
        body = !v ? '<p class="muted sm pad">Select a visual to format it.</p>' :
            '<div class="dp-sec"><label class="fld"><span>Title</span><input data-vo="title" value="' + esc(v.title || '') + '"></label>' +
            '<label class="chk"><input type="checkbox" data-vo="hideTitle"' + (v.options.hideTitle ? ' checked' : '') + '> Hide the title</label>' +
            (v.type === 'text' ? '<label class="fld"><span>Text (markdown: # heading, **bold**, - list)</span><textarea rows="6" data-vo="text">' + esc(v.options.text || '') + '</textarea></label>' : '') +
            (v.type === 'slicer' ? '<label class="fld"><span>Style</span><select data-vo="style"><option value="list">List</option><option value="dropdown"' + (v.options.style === 'dropdown' ? ' selected' : '') + '>Dropdown</option></select></label>' : '') +
            (v.type !== 'text' && v.type !== 'slicer' ? '<label class="fld"><span>Number format</span><select data-vo="format"><option value="">From the measure</option>' +
                [['#,0', '1,234'], ['#,0.00', '1,234.56'], ['0.0%', '12.3%'], ['0%', '12%']].map(function (f) { return '<option value="' + f[0] + '"' + (v.options.format === f[0] ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') + '</select></label>' : '') +
            (['bar', 'column', 'stackedbar', 'stackedcolumn', 'line', 'area', 'combo'].indexOf(v.type) >= 0 ? '<label class="chk"><input type="checkbox" data-vo="labels"' + (v.options.labels ? ' checked' : '') + '> Data labels</label>' : '') +
            (['pie', 'donut', 'bar', 'column', 'stackedbar', 'stackedcolumn', 'line', 'area', 'combo'].indexOf(v.type) >= 0 ? '<label class="chk"><input type="checkbox" data-vo="legend"' + (v.options.legend !== false ? ' checked' : '') + '> Legend</label>' : '') +
            (v.type === 'kpi' ? '<label class="chk"><input type="checkbox" data-vo="lowerIsBetter"' + (v.options.lowerIsBetter ? ' checked' : '') + '> Lower is better (costs, overdue …)</label>' : '') +
            (v.type === 'gauge' ? '<label class="fld"><span>Maximum (empty = second value)</span><input type="number" data-vo="max" value="' + (v.options.max || '') + '"></label>' : '') +
            (['card', 'text', 'slicer', 'table', 'matrix', 'pie', 'donut'].indexOf(v.type) < 0 ? '<label class="fld"><span>Colour (single series)</span><div class="swatches">' + DASH_COLORS.map(function (c) {
                return '<button data-vcol="' + c + '" style="background:' + c + '"' + ((v.options.color || DASH_COLORS[0]) === c ? ' class="on"' : '') + '></button>';
            }).join('') + '</div></label>' : '') +
            '<div class="row"><label class="fld"><span>X</span><input type="number" data-vo="x" value="' + v.x + '" min="0" max="23"></label><label class="fld"><span>Y</span><input type="number" data-vo="y" value="' + v.y + '" min="0"></label>' +
            '<label class="fld"><span>Width</span><input type="number" data-vo="w" value="' + v.w + '" min="1" max="24"></label><label class="fld"><span>Height</span><input type="number" data-vo="h" value="' + v.h + '" min="2"></label></div></div>';
    } else {
        var p = dashPage();
        var list = function (arr, scope) {
            return arr.map(function (f, i) {
                return '<div class="rp-f"><select data-df="column" data-sc="' + scope + '" data-i="' + i + '">' + colOptions(f.column) + '</select>' +
                    '<select data-df="op" data-sc="' + scope + '" data-i="' + i + '">' + [['in', 'is'], ['notIn', 'is not'], ['contains', 'contains'], ['>=', '≥'], ['<=', '≤'], ['between', 'between'], ['blank', 'is blank'], ['notBlank', 'is not blank']].map(function (o) { return '<option value="' + o[0] + '"' + (f.op === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
                    (f.op === 'blank' || f.op === 'notBlank' ? '' : '<input data-df="values" data-sc="' + scope + '" data-i="' + i + '" value="' + esc((f.values || []).join(', ')) + '" placeholder="values, comma separated">') +
                    '<button class="btn xs" data-dfx="' + scope + '" data-i="' + i + '">×</button></div>';
            }).join('');
        };
        body = '<div class="dp-sec"><b>On this page</b>' + list(p.filters, 'page') + '<button class="btn xs" data-dfa="page"><i class="fa-solid fa-plus"></i> Filter</button></div>' +
            '<div class="dp-sec"><b>On all pages</b>' + list(DB.cur.filters, 'dash') + '<button class="btn xs" data-dfa="dash"><i class="fa-solid fa-plus"></i> Filter</button></div>' +
            '<div class="dp-sec"><b>Page</b><label class="fld"><span>Name</span><input data-pgo="name" value="' + esc(p.name) + '"></label>' +
            (DB.cur.pages.length > 1 ? '<button class="btn xs" data-dq2="delpage" style="color:#b91c1c"><i class="fa-solid fa-trash"></i> Delete this page</button>' : '') + '</div>';
    }
    $('dash-right').innerHTML = '<div class="dp-h"><b>Visualizations</b></div>' + tabs + '<div class="dp-body">' + body + '</div>';
}

// ── adding / changing visuals ─────────────────────────────────
/** First free spot for a w×h visual, scanning rows top-down. */
function dashFreeSpot(w, h) {
    var vs = dashPage().visuals;
    for (var y = 0; y < 400; y++) for (var x = 0; x + w <= 24; x++) {
        if (!vs.some(function (v) { return x < v.x + v.w && v.x < x + w && y < v.y + v.h && v.y < y + h; })) return { x: x, y: y };
    }
    return { x: 0, y: 0 };
}
function dashDefaultSize(t) { return { card: [6, 3], kpi: [6, 4], slicer: [6, 6], text: [12, 2], gauge: [6, 5], table: [12, 7], matrix: [12, 7], pie: [8, 7], donut: [8, 7] }[t] || [12, 7]; }

function dashAddVisual(type, at, fields) {
    dashSnapshot();
    var sz = dashDefaultSize(type), pos = at || dashFreeSpot(sz[0], sz[1]);
    var v = { id: dashUid(), type: type, title: '', x: Math.max(0, Math.min(24 - sz[0], pos.x)), y: Math.max(0, pos.y), w: sz[0], h: sz[1], fields: fields || { category: [], series: null, values: [] }, options: type === 'text' ? { text: '## Title' } : {} };
    dashPage().visuals.push(v); DB.sel = v.id; dashAutoTitle(v); dashMark(); dashRender(false); dashRunPage([v.id]);
    return v;
}

function dashAutoTitle(v) {
    if (v.titleEdited) return;
    var vals = v.fields.values.map(function (m) { return m.name; }), cat = (v.fields.category || []).map(dashShortCol);
    v.title = v.type === 'slicer' ? cat.join(', ') : v.type === 'text' ? '' : vals.length ? vals.join(', ') + (cat.length ? ' by ' + cat.join(', ') : '') + (v.fields.series ? ' and ' + dashShortCol(v.fields.series) : '') : dashTypeLabel(v.type);
}

/** Puts a field in the first well of the visual that takes its kind (measure → values, column → axis / legend / rows). */
function dashAddField(v, kind, ref, well) {
    var wells = DE_WELLS[v.type] || [];
    var target = well || (kind === 'm' ? 'values' : (wells.find(function (w) { return w[0] === 'category' && v.fields.category.length < w[2]; }) || wells.find(function (w) { return w[0] === 'series' && !v.fields.series; }) || [null])[0]);
    if (!target) { toast('This visual has no place for that field'); return false; }
    var cap = (wells.find(function (w) { return w[0] === target; }) || [0, 0, 0])[2];
    if (target === 'values') {
        if (kind !== 'm') { toast('Values take measures — drag a measure, or use "Add a calculated value" (e.g. COUNTROWS)'); return false; }
        if (v.fields.values.some(function (m) { return m.name === ref; })) return false;
        if (v.fields.values.length >= cap) v.fields.values.pop();
        v.fields.values.push({ name: ref });
    } else if (target === 'series') {
        if (kind !== 'c') { toast('A legend takes a column'); return false; }
        v.fields.series = ref;
    } else {
        if (kind !== 'c') { toast('This well takes a column'); return false; }
        if (v.fields.category.indexOf(ref) >= 0) return false;
        if (v.fields.category.length >= cap) v.fields.category.pop();
        v.fields.category.push(ref);
    }
    dashAutoTitle(v);
    return true;
}

// ── canvas interactions: select, move, resize ─────────────────
document.addEventListener('pointerdown', function (e) {
    if (!DB.edit || !$('page-dash') || $('page-dash').hidden) return;
    var el = e.target.closest('.dv'); if (!el || !el.closest('#dash-canvas')) return;
    if (e.target.closest('.dv-tools') || e.target.closest('input,select,textarea,label')) return;
    var v = dashVisual(el.dataset.v); if (!v) return;
    if (DB.sel !== v.id) { DB.sel = v.id; document.querySelectorAll('#dash-canvas .dv').forEach(function (x) { x.classList.toggle('sel', x.dataset.v === v.id); }); dashRenderRight(); }
    var resize = e.target.classList.contains('dv-resize');
    if (!resize && !e.target.closest('.dv-head') && !e.altKey) return;              // move by the header (Alt+drag anywhere)
    e.preventDefault();
    DE.drag = { v: v, el: el, resize: resize, sx: e.clientX, sy: e.clientY, x: v.x, y: v.y, w: v.w, h: v.h, cw: dashColW(), moved: false };
    el.setPointerCapture(e.pointerId);
});
document.addEventListener('pointermove', function (e) {
    var d = DE.drag; if (!d) return;
    var dx = Math.round((e.clientX - d.sx) / d.cw), dy = Math.round((e.clientY - d.sy) / DASH_ROW);
    if (!d.moved && (dx || dy)) { dashSnapshot(); d.moved = true; }
    if (d.resize) { d.v.w = Math.max(2, Math.min(24 - d.v.x, d.w + dx)); d.v.h = Math.max(2, d.h + dy); }
    else { d.v.x = Math.max(0, Math.min(24 - d.v.w, d.x + dx)); d.v.y = Math.max(0, d.y + dy); }
    d.el.classList.add('dragging');
    dashLayout();
    var g = document.querySelector('#dash-canvas .dgrid'), bottom = dashPage().visuals.reduce(function (m, v) { return Math.max(m, v.y + v.h); }, 0);
    if (g) g.style.height = (bottom + 6) * DASH_ROW + 'px';
});
document.addEventListener('pointerup', function () {
    var d = DE.drag; if (!d) return;
    DE.drag = null; d.el.classList.remove('dragging');
    if (d.moved) { dashMark(); if (DE.pane === 'format') dashRenderRight(); }
});
document.addEventListener('click', function (e) {
    if (!DB.edit || !$('page-dash') || $('page-dash').hidden) return;
    if (e.target.closest('#dash-canvas') && !e.target.closest('.dv') && DB.sel) { DB.sel = null; document.querySelectorAll('#dash-canvas .dv.sel').forEach(function (x) { x.classList.remove('sel'); }); dashRenderRight(); }
});

// ── drag fields ────────────────────────────────────────────────
document.addEventListener('dragstart', function (e) {
    var f = e.target.closest && e.target.closest('.fld'); if (!f) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({ k: f.dataset.fk, r: f.dataset.fr }));
    e.dataTransfer.effectAllowed = 'copy';
    document.body.classList.add('dragging-field');
});
document.addEventListener('dragend', function () { document.body.classList.remove('dragging-field'); document.querySelectorAll('.drop-hot').forEach(function (x) { x.classList.remove('drop-hot'); }); });
document.addEventListener('dragover', function (e) {
    if (!DB.edit) return;
    var t = e.target.closest && (e.target.closest('.well') || e.target.closest('.dv') || e.target.closest('#dash-canvas'));
    if (!t) return;
    e.preventDefault();
    document.querySelectorAll('.drop-hot').forEach(function (x) { if (x !== t) x.classList.remove('drop-hot'); });
    t.classList.add('drop-hot');
});
document.addEventListener('drop', function (e) {
    if (!DB.edit || !$('page-dash') || $('page-dash').hidden) return;
    var data; try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (x) { return; }
    if (!data || !data.k) return;
    e.preventDefault();
    document.body.classList.remove('dragging-field');
    document.querySelectorAll('.drop-hot').forEach(function (x) { x.classList.remove('drop-hot'); });
    var well = e.target.closest('.well'), dv = e.target.closest('.dv'), canvas = e.target.closest('#dash-canvas');
    if (well && DB.sel) {
        var v = dashVisual(DB.sel); dashSnapshot();
        if (dashAddField(v, data.k, data.r, well.dataset.well)) { dashMark(); dashRenderRight(); dashRender(false); dashRunPage([v.id]); }
        return;
    }
    if (dv && dv.closest('#dash-canvas')) {
        var v2 = dashVisual(dv.dataset.v); DB.sel = v2.id; dashSnapshot();
        if (dashAddField(v2, data.k, data.r)) { dashMark(); dashRender(false); dashRunPage([v2.id]); }
        return;
    }
    if (canvas) {
        var rect = $('dash-canvas').getBoundingClientRect(), cw = dashColW();
        var at = { x: Math.floor((e.clientX - rect.left - 8) / cw), y: Math.floor((e.clientY - rect.top + $('dash-canvas').scrollTop) / DASH_ROW) };
        if (data.k === 'm') dashAddVisual('card', at, { category: [], series: null, values: [{ name: data.r }] });
        else if (/calendar\[/.test(data.r)) dashAddVisual('slicer', at, { category: [data.r], series: null, values: [] });
        else dashAddVisual('table', at, { category: [data.r], series: null, values: [] });
    }
});

// ── pane events ────────────────────────────────────────────────
document.addEventListener('click', function (e) {
    if (!DB.edit || !$('page-dash') || $('page-dash').hidden) return;
    var b = e.target.closest('[data-dep],[data-dvt],[data-wx],[data-dfa],[data-dfx],[data-vcol],[data-dq2],.fld'); if (!b) return;
    var d = b.dataset, v = DB.sel && dashVisual(DB.sel);
    if (d.dep) { DE.pane = d.dep; return dashRenderRight(); }
    if (d.dvt) {
        if (!v) return dashAddVisual(d.dvt);
        dashSnapshot(); v.type = d.dvt;
        var caps = {}; (DE_WELLS[v.type] || []).forEach(function (w) { caps[w[0]] = w[2]; });
        v.fields.category = v.fields.category.slice(0, caps.category || 0); v.fields.values = v.fields.values.slice(0, caps.values || 0); if (!caps.series) v.fields.series = null;
        dashAutoTitle(v); dashMark(); dashRender(false); return dashRunPage([v.id]);
    }
    if (b.classList.contains('fld') && b.classList.contains('off')) { toast(b.title); return; }
    if (b.classList.contains('fld') && v) {                               // click a field = add it to the selected visual
        dashSnapshot(); if (dashAddField(v, d.fk, d.fr)) { dashMark(); dashRender(false); dashRunPage([v.id]); } return;
    }
    if (d.wx && v) {
        dashSnapshot();
        if (d.wx === 'values') v.fields.values.splice(+d.i, 1); else if (d.wx === 'series') v.fields.series = null; else v.fields.category.splice(+d.i, 1);
        dashAutoTitle(v); dashMark(); dashRender(false); return dashRunPage([v.id]);
    }
    if (d.vcol && v) { v.options.color = d.vcol; dashMark(); dashRenderRight(); return dashDrawVisual(v); }
    if (d.dfa) { var arr = d.dfa === 'page' ? dashPage().filters : DB.cur.filters; arr.push({ column: (rpColumns()[0] || { cols: [] }).cols[0], op: 'in', values: [] }); dashMark(); return dashRenderRight(); }
    if (d.dfx) { (d.dfx === 'page' ? dashPage().filters : DB.cur.filters).splice(+d.i, 1); dashMark(); dashRenderRight(); return dashRunPage(); }
    if (d.dq2 === 'adhoc' && v) {
        var name = prompt('Name of the value', 'Rows'); if (!name) return;
        var expr = prompt('Expression (DAX-compatible), e.g. COUNTROWS(lines) or DIVIDE([Sales], [Orders])', ''); if (!expr) return;
        dashSnapshot(); v.fields.values.push({ name: name, expression: expr }); dashAutoTitle(v); dashMark(); dashRender(false); return dashRunPage([v.id]);
    }
    if (d.dq2 === 'delpage') {
        if (!confirm('Delete page ' + dashPage().name + '?')) return;
        dashSnapshot(); DB.cur.pages.splice(DB.page, 1); DB.page = Math.max(0, DB.page - 1); dashMark(); return dashRender(true);
    }
});
document.addEventListener('input', function (e) {
    if (!DB.edit || !$('page-dash') || $('page-dash').hidden) return;
    var x = e.target, d = x.dataset, v = DB.sel && dashVisual(DB.sel);
    if (x.id === 'de-q') { DE.q = x.value; dashRenderFields(); var q = $('de-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); return; }
    if (d.vo && v && (d.vo === 'title' || d.vo === 'text')) {
        if (d.vo === 'title') { v.title = x.value; v.titleEdited = true; var t = document.querySelector('.dv[data-v="' + v.id + '"] .dv-title'); if (t) t.textContent = x.value; }
        else { v.options.text = x.value; dashDrawVisual(v); }
        dashMark(); return;
    }
    if (d.pgo === 'name') { dashPage().name = x.value; dashMark(); var pb = document.querySelector('.dpage.on'); if (pb) pb.textContent = x.value; }
});
document.addEventListener('change', function (e) {
    if (!DB.edit || !$('page-dash') || $('page-dash').hidden) return;
    var x = e.target, d = x.dataset, v = DB.sel && dashVisual(DB.sel);
    if (d.vo && v && d.vo !== 'title' && d.vo !== 'text') {
        dashSnapshot();
        if (d.vo === 'top') v.top = +x.value || undefined;
        else if (d.vo === 'sort') v.sort = x.value ? { by: x.value, desc: true } : undefined;
        else if (['x', 'y', 'w', 'h'].indexOf(d.vo) >= 0) { v[d.vo] = Math.max(d.vo === 'w' || d.vo === 'h' ? 1 : 0, +x.value || 0); if (v.x + v.w > 24) v.w = 24 - v.x; dashMark(); return dashRender(false); }
        else if (x.type === 'checkbox') v.options[d.vo] = d.vo === 'legend' ? x.checked : x.checked || undefined;
        else if (d.vo === 'max') v.options.max = +x.value || undefined;
        else v.options[d.vo] = x.value || undefined;
        dashMark();
        return ['top', 'sort'].indexOf(d.vo) >= 0 ? dashRunPage([v.id]) : (d.vo === 'hideTitle' ? dashRender(false) : dashDrawVisual(v));
    }
    if (d.df) {
        var f = (d.sc === 'page' ? dashPage().filters : DB.cur.filters)[+d.i];
        if (d.df === 'values') f.values = csvList(x.value); else f[d.df] = x.value;
        dashMark(); if (d.df === 'op') dashRenderRight();
        return dashRunPage();
    }
});
