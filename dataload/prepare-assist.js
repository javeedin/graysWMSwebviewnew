/* Prepare & Load helpers that make the common paths one click:
   · Browse APEX tables — pick a table and its columns instead of typing the SELECT
   · Input template — an Excel file with just the columns the chosen FBDI sheets need; dropped back in,
     it maps itself (hidden "_fbdi" sheet carries the mapping)
   · Prepare FBDI — before the checks, list every required value that is missing and fix it in place */

// ── APEX table browser ──────────────────────────────────────────
var PA = { tables: null, cols: {}, sel: null, picked: {} };

function paBrowseTables() {
    prModal('<h2><i class="fa-solid fa-table"></i> APEX tables</h2><p class="muted">Pick a table or view, tick the columns you need — columns that match the template are ticked for you.</p>' +
        '<div class="pa-tb"><div class="pa-left"><div class="pr-search"><i class="fa-solid fa-magnifying-glass"></i><input id="pa-q" type="search" placeholder="Search tables…" autocomplete="off"></div><div class="pa-list" id="pa-list"><div class="empty">Reading the APEX schema…</div></div></div>' +
        '<div class="pa-right" id="pa-cols"><div class="empty">← choose a table</div></div></div>' +
        '<div class="modal-f"><span class="muted grow" id="pa-sqlpv"></span><button class="btn" data-mact="close">Cancel</button><button class="btn" data-mact="pause" disabled>Use query</button><button class="btn primary" data-mact="parun" disabled><i class="fa-solid fa-play"></i> Use &amp; run</button></div>');
    $('pr-modal-box').classList.add('wide');
    $('pa-q').addEventListener('input', paRenderTables);
    $('pa-q').focus();
    (PA.tables ? Promise.resolve(PA.tables) : prRead("SELECT table_name AS name, 'TABLE' AS kind, num_rows FROM user_tables UNION ALL SELECT view_name, 'VIEW', NULL FROM user_views ORDER BY 1", 1000)
        .then(function (r) { return (PA.tables = r.map(function (x) { return { n: x.NAME, k: x.KIND, rows: x.NUM_ROWS }; })); }))
        .then(paRenderTables)
        .catch(function (e) { var l = $('pa-list'); if (l) l.innerHTML = '<div class="empty err">Could not read the tables: ' + esc(String(e)) + '</div>'; });
}
function paRenderTables() {
    var el = $('pa-list'); if (!el || !PA.tables) return;
    var q = ($('pa-q').value || '').trim().toUpperCase(), sys = /^(APEX\$|DR\$|BIN\$|SYS_|MLOG\$|RUPD\$|ISEQ\$)/;
    var list = PA.tables.filter(function (t) { return !sys.test(t.n) && (!q || t.n.indexOf(q) >= 0); });
    el.innerHTML = list.length ? list.slice(0, 400).map(function (t) {
        return '<button class="pa-t' + (t.n === PA.sel ? ' on' : '') + '" data-patab="' + esc(t.n) + '"><i class="fa-solid ' + (t.k === 'VIEW' ? 'fa-eye' : 'fa-table') + '"></i><span>' + esc(t.n) + '</span>' +
            (t.rows != null && t.rows !== '' ? '<small>' + Number(t.rows).toLocaleString() + '</small>' : '') + '</button>';
    }).join('') + (list.length > 400 ? '<div class="muted pa-more">' + (list.length - 400) + ' more — refine the search</div>' : '') : '<div class="empty">No table matches.</div>';
}
function paTemplateKeys() {
    var L = P.load, spec = prSpec(L.tpl), keys = {};
    if (!spec) return keys;
    spec.sheets.forEach(function (s) {
        if ((L.options.sheets[s.csv] || {}).include === false) return;
        s.cols.forEach(function (c) { [c.c, c.n].forEach(function (k) { if (k) keys[prNorm(k)] = c.n; }); });
    });
    var syn = prRules(L.tpl).synonyms || {};
    Object.keys(syn).forEach(function (k) { syn[k].forEach(function (w) { keys[prNorm(w)] = keys[prNorm(w)] || k; }); });
    return keys;
}
function paSelectTable(name) {
    PA.sel = name; paRenderTables();
    var box = $('pa-cols'); box.innerHTML = '<div class="empty">Reading columns…</div>';
    (PA.cols[name] ? Promise.resolve(PA.cols[name]) : prRead('SELECT column_name, data_type, data_length, nullable FROM user_tab_columns WHERE table_name = ' + prLit(name) + ' ORDER BY column_id', 1000)
        .then(function (r) { return (PA.cols[name] = r); }))
        .then(function (cols) {
            if (PA.sel !== name) return;
            var tk = paTemplateKeys(), any = false;
            PA.picked = {};
            cols.forEach(function (c) { if (tk[prNorm(c.COLUMN_NAME)]) { PA.picked[c.COLUMN_NAME] = 1; any = true; } });
            if (!any) cols.forEach(function (c) { PA.picked[c.COLUMN_NAME] = 1; });
            box.innerHTML = '<div class="pa-ch"><b>' + esc(name) + '</b><span class="muted">' + cols.length + ' columns</span>' +
                '<button class="link" data-paall="1">all</button><button class="link" data-paall="0">none</button><button class="link" data-paall="m">template matches</button></div>' +
                '<div class="pa-cl">' + cols.map(function (c) {
                    var m = tk[prNorm(c.COLUMN_NAME)];
                    return '<label class="pa-c"><input type="checkbox" data-pacol="' + esc(c.COLUMN_NAME) + '"' + (PA.picked[c.COLUMN_NAME] ? ' checked' : '') + '><span>' + esc(c.COLUMN_NAME) + '</span>' +
                        '<small>' + esc(c.DATA_TYPE + (/CHAR/.test(c.DATA_TYPE) ? '(' + c.DATA_LENGTH + ')' : '')) + '</small>' + (m ? '<em title="Maps to the template column ' + esc(m) + '">→ ' + esc(m) + '</em>' : '') + '</label>';
                }).join('') + '</div>' +
                '<label class="fld"><span>Filter <em>(optional WHERE, e.g. status = \'NEW\')</em></span><input id="pa-where" autocomplete="off"></label>';
            box.querySelector('#pa-where').addEventListener('input', paSqlPreview);
            paSqlPreview();
        }).catch(function (e) { box.innerHTML = '<div class="empty err">' + esc(String(e)) + '</div>'; });
}
function paSql() {
    if (!PA.sel) return '';
    var cols = (PA.cols[PA.sel] || []).map(function (c) { return c.COLUMN_NAME; }).filter(function (c) { return PA.picked[c]; });
    if (!cols.length) return '';
    var w = ($('pa-where') && $('pa-where').value || '').trim().replace(/^where\s+/i, '');
    return 'SELECT ' + cols.map(function (c) { return /^[A-Z][A-Z0-9_$#]*$/.test(c) ? c.toLowerCase() : '"' + c + '"'; }).join(', ') + '\n  FROM ' + PA.sel.toLowerCase() + (w ? '\n WHERE ' + w : '');
}
function paSqlPreview() {
    var sql = paSql(), n = Object.keys(PA.picked).length;
    $('pa-sqlpv').textContent = sql ? n + ' column' + (n === 1 ? '' : 's') + ' from ' + PA.sel : 'Tick at least one column';
    Array.prototype.forEach.call(document.querySelectorAll('[data-mact="pause"],[data-mact="parun"]'), function (b) { b.disabled = !sql; });
}
function paUse(run) {
    var sql = paSql(); if (!sql) return;
    P.load.srcSql = sql; P.dirty = true;
    prModal(null); prRenderMain();
    if (run) prRunSql();
}
document.addEventListener('click', function (e) {
    var b;
    if ((b = e.target.closest('[data-patab]'))) { paSelectTable(b.getAttribute('data-patab')); return; }
    if ((b = e.target.closest('[data-paall]'))) {
        var v = b.getAttribute('data-paall'), tk = paTemplateKeys();
        PA.picked = {};
        (PA.cols[PA.sel] || []).forEach(function (c) { if (v === '1' || (v === 'm' && tk[prNorm(c.COLUMN_NAME)])) PA.picked[c.COLUMN_NAME] = 1; });
        Array.prototype.forEach.call(document.querySelectorAll('[data-pacol]'), function (x) { x.checked = !!PA.picked[x.getAttribute('data-pacol')]; });
        paSqlPreview(); return;
    }
    if ((b = e.target.closest('[data-mact="pause"]'))) { paUse(false); return; }
    if ((b = e.target.closest('[data-mact="parun"]'))) { paUse(true); return; }
    if ((b = e.target.closest('[data-mact="itgo"]'))) { itDownload(); return; }
    if ((b = e.target.closest('#pr-modal-box [data-gocol]'))) { var gc = b.getAttribute('data-gocol').split('|'); prModal(null); P.mapCsv = gc[0]; P.mapFilter = 'all'; P.mapQ = gc.slice(1).join('|'); P.step = 'map'; prRenderMain(); return; }
    if ((b = e.target.closest('[data-mact="pfgo"]'))) { pfApply(true); return; }
    if ((b = e.target.closest('[data-mact="pfskip"]'))) { pfApply(false); return; }
});
document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute('data-pacol')) { if (t.checked) PA.picked[t.getAttribute('data-pacol')] = 1; else delete PA.picked[t.getAttribute('data-pacol')]; paSqlPreview(); }
    if (t.hasAttribute && (t.hasAttribute('data-itsheet') || t.name === 'it-cols')) itCount();
});

// ── Input template (Excel) ─────────────────────────────────────
/* Columns the template needs, for the chosen sheets. Columns the app fills itself (generated interface keys,
   Oracle's control values) are left out; the same DB column on several sheets becomes one input column. */
function itPlan(sheets, level) {
    var L = P.load, spec = prSpec(L.tpl), R = prRules(L.tpl), pre = prDefaultMaps(L.tpl), relax = {};
    (R.notRequired || []).forEach(function (k) { relax[String(k).toUpperCase()] = 1; });
    var cols = [], byKey = {}, used = {};
    var rootDoc = sheets.some(function (csv) { return (L.options.sheets[csv] || {}).mode === 'doc'; });
    if (rootDoc) cols.push({ h: 'Document key', key: '#DOC', targets: [], req: true, help: 'Same value on every line of one document — each value becomes one ' + spec.sheets[0].n + ' row', t: 'V' });
    spec.sheets.forEach(function (s) {
        if (sheets.indexOf(s.csv) < 0) return;
        var ex = (s.ex || [])[0] || [];
        s.cols.forEach(function (c, i) {
            if ((pre[s.csv] || {})[i + 1]) return;                                  // the app fills it
            var req = !!c.r && !relax[(c.c || c.n).toUpperCase()];
            var k0 = (c.c || c.n).toUpperCase(), hasEx = (s.ex || []).some(function (r) { return r[i] !== '' && r[i] != null; });
            var common = req || (!/ATTRIBUTE|_ID$|^BATCH|TIMESTAMP|^GLOBAL_/.test(k0) && (hasEx || (s === spec.sheets[0] && (/(^|_)(NUM|NUMBER)$/.test(k0) || /^(ORDER|NUMBER|DOCUMENT NUMBER|INVOICE NUMBER|REQUISITION)$/.test(k0)))));
            if (level === 'req' && !req) return;
            if (level === 'common' && !common) return;
            var key = (c.c || c.n).toUpperCase();
            if (byKey[key]) { byKey[key].targets.push([s.csv, i + 1, c.t]); byKey[key].req = byKey[key].req || req; byKey[key].sheets.push(s.n); return; }
            var h = c.n; if (used[h.toUpperCase()]) h = c.n + ' (' + s.n.replace(/_INTERFACE|_INTF|_INT$|_ALL|_T$/g, '').replace(/_/g, ' ').toLowerCase() + ')';
            used[h.toUpperCase()] = 1;
            var col = { h: h, key: key, targets: [[s.csv, i + 1, c.t]], req: req, t: c.t, l: c.l, db: c.c, help: c.h || '', ex: c.e || ex[i] || '', sheets: [s.n] };
            byKey[key] = col; cols.push(col);
        });
    });
    return cols;
}
function itDialog() {
    var L = P.load, spec = prSpec(L.tpl), R = prRules(L.tpl), saved = L.options.inputTpl || {};
    var h = '<h2><i class="fa-solid fa-file-excel"></i> Download the input template</h2>' +
        '<p class="muted">One Excel sheet with just the columns Oracle needs — fill it (one row per line; header values repeat on each line) and drop it back here. It maps itself.</p>' +
        '<h3 class="pa-h3">1 · Which FBDI sheets will you load?</h3><div class="it-sheets">' +
        spec.sheets.map(function (s, i) {
            var def = (R.sheets || {})[s.csv] || {}, on = saved.sheets ? saved.sheets.indexOf(s.csv) >= 0 : (L.options.sheets[s.csv] || {}).include !== false;
            var req = s.cols.filter(function (c) { return c.r; }).length;
            return '<label class="it-s' + (i === 0 ? ' main' : '') + '"><input type="checkbox" data-itsheet="' + s.csv + '"' + (on || i === 0 ? ' checked' : '') + (i === 0 ? ' disabled' : '') + '>' +
                '<span><b>' + esc(s.n) + '</b><small>' + esc(def.role || '') + '</small></span><em>' + s.cols.length + ' cols · ' + req + ' required</em></label>';
        }).join('') + '</div>' +
        '<h3 class="pa-h3">2 · Which columns?</h3><div class="seg it-lv">' +
        [['req', 'Required only'], ['common', 'Required + commonly used'], ['all', 'All columns']].map(function (o) {
            return '<label><input type="radio" name="it-cols" value="' + o[0] + '"' + ((saved.level || 'common') === o[0] ? ' checked' : '') + '> ' + o[1] + '</label>';
        }).join('') + '</div>' +
        '<p class="muted" id="it-count"></p>' +
        '<div class="modal-f"><button class="btn" data-mact="close">Cancel</button><button class="btn primary" data-mact="itgo"><i class="fa-solid fa-download"></i> Download template</button></div>';
    prModal(h); $('pr-modal-box').classList.add('wide');
    itCount();
}
function itChoice() {
    var sheets = [prSpec(P.load.tpl).sheets[0].csv];
    Array.prototype.forEach.call(document.querySelectorAll('[data-itsheet]'), function (x) { if (x.checked && sheets.indexOf(x.getAttribute('data-itsheet')) < 0) sheets.push(x.getAttribute('data-itsheet')); });
    var lv = document.querySelector('input[name=it-cols]:checked');
    return { sheets: sheets, level: lv ? lv.value : 'common' };
}
function itCount() {
    var el = $('it-count'); if (!el) return;
    var ch = itChoice(), cols = itPlan(ch.sheets, ch.level), req = cols.filter(function (c) { return c.req; }).length;
    el.innerHTML = '<b>' + cols.length + ' columns</b> (' + req + ' required) across ' + ch.sheets.length + ' sheet' + (ch.sheets.length === 1 ? '' : 's') + '. Interface keys and control values are filled by the app.';
}
function itDownload() {
    if (!window.XLSX) { toast('The Excel library did not load — check the internet connection.'); return; }
    var L = P.load, spec = prSpec(L.tpl), ch = itChoice(), cols = itPlan(ch.sheets, ch.level), t = tplByFile(L.tpl) || { n: L.tpl };
    var head = cols.map(function (c) { return c.h + (c.req ? ' *' : ''); });
    var data = XLSX.utils.aoa_to_sheet([head]);
    data['!cols'] = cols.map(function (c) { return { wch: Math.min(40, Math.max(12, c.h.length + 4)) }; });
    data['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, cols.length - 1) } }) };
    var info = [['Column', 'Required', 'FBDI sheet(s)', 'Oracle column', 'Type', 'Max length', "Oracle's example", 'What to enter']].concat(cols.map(function (c) {
        return [c.h, c.req ? 'Yes' : '', (c.sheets || ['(grouping)']).join(', '), c.db || '', { V: 'Text', N: 'Number', D: 'Date' }[c.t] || 'Text', c.l || '', c.ex || '', c.help || ''];
    }));
    var infoWs = XLSX.utils.aoa_to_sheet(info);
    infoWs['!cols'] = [{ wch: 34 }, { wch: 9 }, { wch: 30 }, { wch: 30 }, { wch: 8 }, { wch: 10 }, { wch: 22 }, { wch: 90 }];
    var how = XLSX.utils.aoa_to_sheet([
        [t.n + ' — input template'], [''],
        ['1. Fill the "Data" sheet: one row per line. Columns marked * are required.'],
        ['2. ' + (cols[0] && cols[0].key === '#DOC' ? 'Give every line of the same document the same "Document key" (e.g. 1, 1, 2 …) — header values repeat on each of its lines.' : 'Every row becomes one row of ' + spec.sheets[0].n + '.')],
        ['3. Dates as dates (or DD/MM/YYYY), numbers without thousand separators.'],
        ['4. Drop the file on Prepare & Load › Source › Excel / CSV file, then press "Prepare FBDI".'], [''],
        ['FBDI sheets in this template: ' + ch.sheets.map(function (c) { return spec.sheets.filter(function (s) { return s.csv === c; })[0].n; }).join(', ')],
        ['Interface keys, line numbers and Action / Operation values are generated by the app — they are not in the template.'],
        ['See "Columns" for what every column means.']
    ]);
    how['!cols'] = [{ wch: 120 }];
    var meta = XLSX.utils.aoa_to_sheet([[JSON.stringify({ v: 1, tpl: L.tpl, sheets: ch.sheets, level: ch.level, docKey: cols[0] && cols[0].key === '#DOC' ? 'Document key' : '', cols: cols.map(function (c) { return { h: c.h, t: c.targets }; }) })]]);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, data, 'Data');
    XLSX.utils.book_append_sheet(wb, infoWs, 'Columns');
    XLSX.utils.book_append_sheet(wb, how, 'How to fill');
    XLSX.utils.book_append_sheet(wb, meta, '_fbdi');
    wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }] };
    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var name = (t.n || L.tpl).replace(/[^\w]+/g, '_') + '_input_' + L.id + '.xlsx';
    prDownload(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
    L.options.inputTpl = { sheets: ch.sheets, level: ch.level }; P.dirty = true;
    prModal(null); prRenderHead();
    toast(name + ' downloaded — ' + cols.length + ' columns');
}
/** A dropped workbook that is our input template: read "Data", map every column, switch the sheets on. Returns true when handled. */
function itRecognise(wb, fileName) {
    if (wb.SheetNames.indexOf('_fbdi') < 0 || wb.SheetNames.indexOf('Data') < 0) return false;
    var meta; try { meta = JSON.parse(XLSX.utils.sheet_to_json(wb.Sheets._fbdi, { header: 1 })[0][0]); } catch (e) { return false; }
    var L = P.load;
    if (meta.tpl !== L.tpl) { toast('This input template is for ' + prTplName(meta.tpl) + ', not ' + prTplName(L.tpl) + ' — reading it as a plain sheet.'); return false; }
    var a = XLSX.utils.sheet_to_json(wb.Sheets.Data, { header: 1, blankrows: false, defval: '', raw: true });
    var head = (a[0] || []).map(function (h) { return String(h).replace(/\s*\*\s*$/, '').trim(); });
    var spec = prSpec(L.tpl);
    // options: chosen sheets on, the rest off; maps: defaults (generated keys, control values) + one per column
    spec.sheets.forEach(function (s) { prSheetOpt(s.csv).include = meta.sheets.indexOf(s.csv) >= 0; });
    L.maps = prDefaultMaps(L.tpl);
    var n = 0;
    meta.cols.forEach(function (c) {
        if (head.indexOf(c.h) < 0) return;
        c.t.forEach(function (tg) {
            var f = tg[2] === 'D' ? '|date' + (L.options.dateOrder === 'mdy' ? ':mdy' : '') : tg[2] === 'N' ? '|num' : '';
            (L.maps[tg[0]] = L.maps[tg[0]] || {})[tg[1]] = '{' + c.h + f + '}'; n++;
        });
    });
    if (meta.docKey && head.indexOf(meta.docKey) >= 0) L.options.docKey = '{' + meta.docKey + '}';
    L.options.inputTpl = { sheets: meta.sheets, level: meta.level };
    L.srcSql = '';
    P.wb = null;
    var keepAuto = window.prAutoMap; window.prAutoMap = function () { return 0; };     // the template's own mapping wins
    try { prSetSource(head, a.slice(1), fileName + ' › input template'); } finally { window.prAutoMap = keepAuto; }
    toast('Input template recognised — ' + (a.length - 1) + ' rows, ' + n + ' template columns mapped. Press “Prepare FBDI”.');
    return true;
}

// ── Prepare FBDI: what is missing before the checks ──────────────
function pfFind() {
    var L = P.load, spec = prSpec(L.tpl), R = prRules(L.tpl), relax = {};
    (R.notRequired || []).forEach(function (k) { relax[String(k).toUpperCase()] = 1; });
    var built = FE.build(spec, L.maps, P.src, { docKey: L.options.docKey, sheets: L.options.sheets, loadId: L.id });
    var out = [];
    built.sheets.forEach(function (s) {
        var m = L.maps[s.csv] || {};
        s.spec.cols.forEach(function (c, i) {
            if (!c.r || relax[(c.c || c.n).toUpperCase()]) return;
            if (!m[i + 1]) { out.push({ csv: s.csv, sheet: s.name, pos: i + 1, col: c, kind: 'unmapped', n: s.rows.length, total: s.rows.length }); return; }
            var empty = []; s.rows.forEach(function (r, k) { if (r[i] === '' || r[i] == null) empty.push(s.src[k] + 1); });
            if (empty.length) out.push({ csv: s.csv, sheet: s.name, pos: i + 1, col: c, kind: 'empty', n: empty.length, total: s.rows.length, rows: empty, expr: m[i + 1] });
        });
    });
    return { built: built, missing: out };
}
function pfStart() {
    var L = P.load, R = prRules(L.tpl);
    if (!P.src || !P.src.rows.length) { toast('Load the data first.'); return; }
    if (R.docKeyRequired && !L.options.docKey) { toast('Set the Document key first (step Map).'); P.step = 'map'; prRenderMain(); return; }
    var f = pfFind(); P.pf = f;
    if (!f.missing.length) { pfRunChecks(); return; }
    var opts = P.src.cols.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    prModal('<h2><i class="fa-solid fa-circle-exclamation" style="color:#b45309"></i> Required information is missing</h2>' +
        '<p class="muted">Oracle rejects rows without these values. Give a value for all rows, take it from one of your columns, or fix the data and come back.</p>' +
        '<div class="pf-list">' + f.missing.map(function (x, k) {
            var simple = x.kind === 'empty' && /^\{[^{}|]+(\|[^{}]*)?\}$/.test(x.expr);
            return '<div class="pf-row"><div class="pf-t"><b>' + esc(x.col.n) + '</b><small>' + esc(x.sheet) + (x.col.c && x.col.c !== x.col.n ? ' · ' + esc(x.col.c) : '') + '</small>' +
                '<span class="chip err">' + (x.kind === 'unmapped' ? 'not in your data' : x.n + ' of ' + x.total + ' rows empty') + '</span>' +
                (x.rows ? '<small class="muted">rows ' + esc(x.rows.slice(0, 12).join(', ') + (x.rows.length > 12 ? ' …' : '')) + '</small>' : '') +
                (x.col.h ? '<small class="muted pf-h">' + esc(x.col.h.slice(0, 160)) + '</small>' : '') + '</div>' +
                '<div class="pf-fix">' + (x.kind === 'unmapped' || simple ?
                    '<input data-pfval="' + k + '" placeholder="' + esc(x.col.e ? 'e.g. ' + x.col.e : 'value for ' + (x.kind === 'empty' ? 'the empty rows' : 'all rows')) + '">' +
                    (x.kind === 'unmapped' ? '<select data-pfcol="' + k + '"><option value="">…or from column</option>' + opts + '</select>' : '')
                    : '<button class="link" data-gocol="' + esc(x.csv + '|' + x.col.n) + '">fix the mapping</button>') + '</div></div>';
        }).join('') + '</div>' +
        '<div class="modal-f"><button class="btn" data-mact="close">Back to the data</button><button class="btn" data-mact="pfskip">Check anyway</button><button class="btn primary" data-mact="pfgo"><i class="fa-solid fa-wand-magic-sparkles"></i> Apply &amp; prepare FBDI</button></div>');
    $('pr-modal-box').classList.add('wide');
}
function pfApply(apply) {
    var L = P.load, f = P.pf, changed = 0;
    if (apply && f) f.missing.forEach(function (x, k) {
        var v = $('pr-modal-box').querySelector('[data-pfval="' + k + '"]'), c = $('pr-modal-box').querySelector('[data-pfcol="' + k + '"]');
        var val = v ? v.value.trim().replace(/[{}|]/g, '') : '', col = c ? c.value : '';
        var m = L.maps[x.csv] = L.maps[x.csv] || {};
        var fl = x.col.t === 'D' ? '|date' + (L.options.dateOrder === 'mdy' ? ':mdy' : '') : x.col.t === 'N' ? '|num' : '';
        if (x.kind === 'unmapped' && col) { m[x.pos] = '{' + col + fl + '}'; changed++; }
        else if (x.kind === 'unmapped' && val) { m[x.pos] = val; changed++; }
        else if (x.kind === 'empty' && val) { m[x.pos] = x.expr.replace(/\}$/, '|default:' + val + '}'); changed++; }
    });
    prModal(null);
    if (changed) { P.dirty = true; toast(changed + ' value' + (changed === 1 ? '' : 's') + ' filled in'); }
    if (apply && changed) {
        var again = pfFind();
        if (again.missing.length) { P.pf = again; pfStart(); return; }
    }
    pfRunChecks();
}
function pfRunChecks() {
    P.step = 'check'; prRenderMain();
    prRunCheck(P.load.options.live !== false).then(function () {
        if (P.check && !P.check.errors) { P.step = 'generate'; prRenderMain(); toast('Ready — no errors. Generate the FBDI ZIP.'); }
    });
}
