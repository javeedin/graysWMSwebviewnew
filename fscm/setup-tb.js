/* Setup & Diagnostics — Trial Balance check. Reads a trial-balance Excel in the page (SheetJS, first sheet), filters
   and totals it, and validates its segment columns against the Fusion chart-of-accounts value sets (COA Segments).
   Nothing is loaded into Fusion here — use Data Loading › Journals (FBDI) for the real load. */

var SetTb = { file: null, rows: [], text: [], cols: [], maps: [], results: null, filters: {}, global: '', invalidOnly: false };
SetTb.AMT_RE = /amount|debit|credit|balance|value|total|\bdr\b|\bcr\b|^dr|^cr|_dr$|_cr$/i;

SetTb.norm = function (s) { return String(s || '').toLowerCase().replace(/[_\s\-]/g, ''); };
/** Column → segment by name (exact, then contained either way); each segment used once. */
SetTb.autoMap = function (cols) {
    var segs = SetCoa.segments(), used = {}, out = [];
    cols.forEach(function (c) {
        var n = SetTb.norm(c); if (!n) return;
        var s = segs.filter(function (x) { return !used[x.key] && SetTb.norm(x.label) === n; })[0] ||
            segs.filter(function (x) { var l = SetTb.norm(x.label); return !used[x.key] && l.length > 2 && (n.indexOf(l) >= 0 || l.indexOf(n) >= 0); })[0];
        if (s) { used[s.key] = 1; out.push({ col: c, seg: s.key }); }
    });
    return out;
};

SetTb.render = function (el) {
    SU.headRight(SetTb.file ? '<button class="btn sm" id="tb-another"><i class="fa-solid fa-file-arrow-up"></i> Load another</button> <button class="btn sm danger" id="tb-clear"><i class="fa-solid fa-eraser"></i> Clear</button>' : '');
    if (SetTb.file) {
        $('tb-another').onclick = function () { SU.pickFile('.xlsx,.xls,.xlsm,.csv').then(function (f) { if (f) SetTb.load(f); }); };
        $('tb-clear').onclick = function () { SetTb.file = null; SetTb.rows = []; SetTb.results = null; SetTb.filters = {}; SetTb.global = ''; SetTb.render(el); };
    }
    if (!SetTb.file) {
        el.innerHTML = '<div class="card pad su-intro"><div id="tb-drop"></div><div class="su-steps3">' +
            '<div><b>1</b><span>Drop a trial balance (.xlsx / .xls / .csv). The first sheet is read in this page; header row = first row.</span></div>' +
            '<div><b>2</b><span>Filter and total it; amount columns (debit, credit, balance …) are summed over the filtered rows.</span></div>' +
            '<div><b>3</b><span><b>Validate segments</b>: each mapped column is checked against its Fusion value set; unknown values are highlighted.</span></div></div>' +
            '<div class="note" style="margin-top:10px">This is a pre-check only — the journal load itself is in <b>Data Loading › Prepare &amp; Load</b> (Journals FBDI).</div></div>';
        SU.dropZone($('tb-drop'), { accept: '.xlsx,.xls,.xlsm,.csv', icon: 'fa-file-excel', title: 'Drop a trial balance Excel', text: 'or click to choose a file', onFiles: function (f) { SetTb.load(f[0]); } });
        return;
    }
    SetTb.draw(el);
};

SetTb.load = function (file) {
    if (!window.XLSX) { FX.toast('The Excel library did not load (needs internet for cdnjs).', 'err'); return; }
    FX.busy('Reading ' + file.name + '…');
    file.arrayBuffer().then(function (buf) {
        var wb = XLSX.read(buf, { type: 'array', cellDates: true });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(ws, { defval: null });
        var text = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
        FX.busy(false);
        if (!rows.length) { FX.toast('No data found in the spreadsheet.', 'err'); return; }
        rows.forEach(function (r, i) { r.__rowIdx = i; });
        SetTb.file = { name: file.name, sheet: wb.SheetNames[0], sheets: wb.SheetNames.length };
        SetTb.rows = rows; SetTb.text = text;
        SetTb.cols = Object.keys(rows[0]).filter(function (k) { return k !== '__rowIdx'; });
        rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (k !== '__rowIdx' && SetTb.cols.indexOf(k) < 0) SetTb.cols.push(k); }); });
        SetTb.results = null; SetTb.filters = {}; SetTb.global = ''; SetTb.invalidOnly = false;
        var auto = SetTb.autoMap(SetTb.cols), saved = lsGet('set_tb_maps', []).filter(function (m) { return SetTb.cols.indexOf(m.col) >= 0 && SetCoa.seg(m.seg); });
        SetTb.maps = auto.length ? auto : saved;
        SetTb.analyse();
        FX.toast(rows.length + ' rows read from ' + file.name + (auto.length ? ' · ' + auto.length + ' segment column(s) recognised' : '') + '.', 'ok');
        if (FX.cur && FX.cur.id === 'tb') SetTb.render($('fx-view'));
    }).catch(function (e) { FX.busy(false); FX.toast('Failed to read the file. Make sure it is a valid Excel (.xlsx / .xls) file.\n' + (e && e.message || e), 'err'); });
};
SetTb.analyse = function () {
    var num = {}, distinct = {};
    SetTb.cols.forEach(function (c) { distinct[c] = {}; });
    SetTb.rows.forEach(function (r) { SetTb.cols.forEach(function (c) { var v = r[c]; if (typeof v === 'number') num[c] = 1; if (v != null && v !== '' && Object.keys(distinct[c]).length <= 101) distinct[c][v instanceof Date ? FX.today(v) : String(v)] = 1; }); });
    SetTb.numericCols = SetTb.cols.filter(function (c) { return num[c]; });
    SetTb.amountCols = SetTb.numericCols.filter(function (c) { return SetTb.AMT_RE.test(c); });
    SetTb.catCols = SetTb.cols.filter(function (c) { return !num[c] && Object.keys(distinct[c]).length <= 100; });
    SetTb.distinct = distinct;
};
SetTb.txt = function (r, c) { var t = SetTb.text[r.__rowIdx]; var v = t ? t[c] : r[c]; return v == null ? '' : String(v).trim(); };
SetTb.cellStr = function (r, c) { var v = r[c]; return v == null ? '' : v instanceof Date ? FX.today(v) : String(v); };

// ── filtering ──────────────────────────────────────────────────
SetTb.invalidSet = function () {
    var s = {}; (SetTb.results || []).forEach(function (res) { if (!res.error) s[res.col] = res.bad; }); return s;
};
SetTb.rowInvalid = function (r, inv) { return Object.keys(inv).some(function (c) { var v = SetTb.txt(r, c); return v && inv[c][v]; }); };
SetTb.filtered = function () {
    var f = SetTb.filters, g = SetTb.global.toLowerCase(), inv = SetTb.invalidSet();
    return SetTb.rows.filter(function (r) {
        for (var c in f) { if (!f[c]) continue; var v = SetTb.cellStr(r, c); if (SetTb.catCols.indexOf(c) >= 0) { if (f[c] === '(blank)' ? v !== '' : v !== f[c]) return false; } else if (v.toLowerCase().indexOf(f[c].toLowerCase()) < 0) return false; }
        if (g && !SetTb.cols.some(function (c) { return SetTb.cellStr(r, c).toLowerCase().indexOf(g) >= 0; })) return false;
        if (SetTb.invalidOnly && !SetTb.rowInvalid(r, inv)) return false;
        return true;
    });
};
SetTb.totals = function (rows) { var t = {}; SetTb.amountCols.forEach(function (c) { t[c] = rows.reduce(function (a, r) { return a + (typeof r[c] === 'number' ? r[c] : 0); }, 0); }); return t; };
SetTb.money = function (v) { return (v < 0 ? '<span class="su-neg">' : '<span>') + (+v).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</span>'; };

// ── draw ───────────────────────────────────────────────────────
SetTb.draw = function (el) {
    var inv = SetTb.invalidSet(), invRows = SetTb.results ? SetTb.rows.filter(function (r) { return SetTb.rowInvalid(r, inv); }).length : null;
    var f = SetTb.file;
    el.innerHTML =
        '<div class="card su-info"><div><span>File</span><b>' + esc(f.name) + '</b></div><div><span>Sheet</span><b>' + esc(f.sheet) + (f.sheets > 1 ? ' <small class="muted">(first of ' + f.sheets + ')</small>' : '') + '</b></div>' +
        '<div class="grow"></div><div class="row-btns"><button class="btn primary sm" id="tb-val"><i class="fa-solid fa-list-check"></i> Validate segments' + (SetTb.maps.length ? ' <span class="su-badge light">' + SetTb.maps.length + '</span>' : '') + '</button>' +
        '<button class="btn sm" id="tb-xf"><i class="fa-solid fa-file-excel"></i> Export filtered</button>' +
        (SetTb.results ? '<button class="btn sm" id="tb-xi"' + (invRows ? '' : ' disabled') + '><i class="fa-solid fa-file-excel"></i> Invalid values</button><button class="btn sm" id="tb-xr"' + (invRows ? '' : ' disabled') + '><i class="fa-solid fa-file-excel"></i> Invalid rows (' + invRows + ')</button>' : '') + '</div></div>' +
        '<div class="kpis" id="tb-kpis"></div>' + (SetTb.results ? SetTb.resultsHtml(invRows) : '') +
        '<div class="card"><div class="filters" id="tb-filters"><label>Search all columns<input type="search" id="tb-g" value="' + esc(SetTb.global) + '" placeholder="Any value…"></label>' +
        SetTb.cols.map(function (c, i) {
            if (SetTb.catCols.indexOf(c) >= 0) { var opts = Object.keys(SetTb.distinct[c]).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); }); return '<label title="' + esc(c) + '">' + esc(SU.trunc(c, 22)) + '<select data-tbf="' + i + '"><option value="">All</option><option value="(blank)"' + (SetTb.filters[c] === '(blank)' ? ' selected' : '') + '>(blank)</option>' + opts.map(function (o) { return '<option' + (SetTb.filters[c] === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></label>'; }
            return '<label title="' + esc(c) + '">' + esc(SU.trunc(c, 22)) + '<input type="search" data-tbf="' + i + '" placeholder="contains…" value="' + esc(SetTb.filters[c] || '') + '"></label>';
        }).join('') + (SetTb.results ? '<label class="su-toggle" style="align-self:center"><input type="checkbox" id="tb-io"' + (SetTb.invalidOnly ? ' checked' : '') + '> Invalid rows only</label>' : '') +
        '<div class="go"><button class="btn sm" id="tb-clr"><i class="fa-solid fa-filter-circle-xmark"></i> Clear all</button></div></div></div>' +
        '<div class="card su-fill" id="tb-grid"></div>';
    $('tb-val').onclick = SetTb.dialog;
    $('tb-xf').onclick = SetTb.exportFiltered;
    if ($('tb-xi')) { $('tb-xi').onclick = SetTb.exportInvalidValues; $('tb-xr').onclick = SetTb.exportInvalidRows; }
    var mapped = {}; SetTb.maps.forEach(function (m) { mapped[m.col] = m; });
    var resBy = {}; (SetTb.results || []).forEach(function (r) { resBy[r.col] = r; });
    var cols = SetTb.cols.map(function (c) {
        var res = resBy[c], amt = SetTb.amountCols.indexOf(c) >= 0, isNum = SetTb.numericCols.indexOf(c) >= 0;
        var icon = res ? (res.error ? ' <i class="fa-solid fa-triangle-exclamation" style="color:var(--warn)" title="' + esc(res.error) + '"></i>' : res.invalid.length ? ' <span class="chip err" title="' + res.invalid.length + ' invalid values">✗ ' + res.invalid.length + '</span>' : ' <span class="chip ok">✓</span>') : mapped[c] ? ' <i class="fa-solid fa-link muted" title="Mapped to ' + esc((SetCoa.seg(mapped[c].seg) || {}).label) + '"></i>' : '';
        return { k: c, label: c, th: esc(c) + icon, n: amt || isNum, get: function (r) { return r[c] instanceof Date ? FX.today(r[c]) : r[c]; },
            html: function (r) {
                var v = r[c]; if (v == null || v === '') return '';
                if (res && !res.error) { var t = SetTb.txt(r, c); if (t && res.bad[t]) return '<span class="chip err" title="&quot;' + esc(t) + '&quot; not found in ' + esc(res.label) + '">' + esc(t) + '</span>'; if (t) return '<span class="su-valid">' + esc(t) + '</span>'; }
                if (amt && typeof v === 'number') return SetTb.money(v);
                return v instanceof Date ? FX.today(v) : esc(v);
            } };
    });
    var grid = SU.table($('tb-grid'), {
        rows: SetTb.rows, columns: cols, pageSize: 100, sizes: [50, 100, 200, 500], quick: false,
        rowsFilter: function () { return SetTb.filtered(); },
        rowCls: function (r) { return SetTb.results && SetTb.rowInvalid(r, inv) ? 'su-badrow' : ''; },
        foot: function (rows) {
            if (!SetTb.amountCols.length) return '';
            var t = SetTb.totals(rows);
            return '<tr class="su-total">' + SetTb.cols.map(function (c, i) { return '<td class="n">' + (i === 0 ? '<b>Total</b>' : t[c] != null ? SetTb.money(t[c]) : '') + '</td>'; }).join('') + '</tr>';
        },
        onRender: function (tt) { SetTb.kpis(tt.lastView, invRows); }
    });
    var refilter = function () { grid.page = 0; grid.render(); };
    $('tb-filters').addEventListener('input', function (e) {
        var i = e.target.getAttribute('data-tbf');
        if (i != null) { SetTb.filters[SetTb.cols[+i]] = e.target.value; refilter(); }
        else if (e.target.id === 'tb-g') { SetTb.global = e.target.value; refilter(); }
    });
    $('tb-filters').addEventListener('change', function (e) { if (e.target.id === 'tb-io') { SetTb.invalidOnly = e.target.checked; refilter(); } });
    $('tb-clr').onclick = function () { SetTb.filters = {}; SetTb.global = ''; SetTb.invalidOnly = false; SetTb.draw(el); };
};
SetTb.kpis = function (view, invRows) {
    var t = SetTb.totals(view);
    $('tb-kpis').innerHTML = SU.kpi(SetTb.rows.length.toLocaleString(), 'Total rows') + SU.kpi(view.length.toLocaleString(), 'Filtered', view.length !== SetTb.rows.length ? 'acc' : '') + SU.kpi(SetTb.cols.length, 'Columns') +
        (invRows != null ? SU.kpi(invRows.toLocaleString(), 'Invalid rows', invRows ? 'err' : 'ok') : '') +
        SetTb.amountCols.slice(0, 3).map(function (c) { return SU.kpi(SetTb.money(t[c]), c); }).join('');
};
SetTb.resultsHtml = function (invRows) {
    var R = SetTb.results, okU = 0, badU = 0;
    R.forEach(function (r) { if (!r.error) { okU += r.valid; badU += r.invalid.length; } });
    return '<div class="card pad"><div class="su-row"><b><i class="fa-solid fa-list-check" style="color:var(--accent)"></i> Segment validation</b><span class="chip">' + R.length + ' segment(s) checked</span>' +
        '<span class="chip ok">' + okU + ' valid unique values</span><span class="chip ' + (badU ? 'err' : 'ok') + '">' + badU + ' invalid unique values</span>' + (invRows ? '<span class="muted">' + invRows + ' rows with invalid segment values — highlighted below</span>' : '') + '</div>' +
        '<div class="su-vcards">' + R.map(function (r) {
            var p = r.error ? 0 : r.total ? SU.pct(r.valid, r.total) : 100;
            return '<div class="su-vcard ' + (r.error ? 'warn' : r.invalid.length ? 'bad' : 'good') + '"><div class="su-row"><b>' + esc(r.col) + '</b><i class="fa-solid fa-arrow-right muted"></i><span class="chip info" title="' + esc(r.url) + '">' + esc(r.label) + '</span></div>' +
                (r.error ? '<div class="su-verr">' + esc(r.error) + '</div>' : '<div class="su-nb"><b>' + p + '%</b>' + SU.bar(p, r.invalid.length ? 'err' : 'ok') + '</div><div class="su-row" style="font-size:.74rem"><span class="ok">' + r.valid + ' valid</span>' +
                    (r.invalid.length ? '<span class="err" title="' + esc(r.invalid.slice(0, 40).map(function (x) { return x.value + ' × ' + x.count + ' rows'; }).join('\n')) + '">' + r.invalid.length + ' invalid</span>' : '') + '<span class="muted">of ' + r.total + ' unique · ' + r.vsCount + ' in Fusion</span></div>') + '</div>';
        }).join('') + '</div>' +
        '<div class="muted" style="font-size:.72rem;margin-top:6px">Values are compared as shown in Excel (formatted text), so codes with leading zeros stay intact when the cells are formatted as text or with a number format like 000.</div></div>';
};

// ── validation ─────────────────────────────────────────────────
SetTb.dialog = function () {
    var maps = SetTb.maps.map(function (m) { return Object.assign({}, m); });
    var segs = SetCoa.segments();
    function html() {
        return '<table class="tbl"><thead><tr><th>Excel column</th><th></th><th>COA segment</th><th></th></tr></thead><tbody>' + maps.map(function (m, i) {
            return '<tr><td><select data-tbm="' + i + '" data-f="col">' + SetTb.cols.map(function (c) { return '<option' + (c === m.col ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></td><td><i class="fa-solid fa-arrow-right muted"></i></td>' +
                '<td><select data-tbm="' + i + '" data-f="seg">' + segs.map(function (s) { return '<option value="' + esc(s.key) + '"' + (s.key === m.seg ? ' selected' : '') + '>' + esc(s.label + ' (' + s.valueSet + ')') + '</option>'; }).join('') + '</select></td>' +
                '<td><button class="btn sm danger" data-mact="del' + i + '"><i class="fa-solid fa-trash"></i></button></td></tr>';
        }).join('') + '</tbody></table>' + (maps.length ? '' : '<div class="note">No mapping yet — add one per segment column of the file.</div>');
    }
    function sync(box) { Array.prototype.forEach.call(box.querySelectorAll('[data-tbm]'), function (s) { maps[+s.getAttribute('data-tbm')][s.getAttribute('data-f')] = s.value; }); }
    FX.modal({
        title: '<i class="fa-solid fa-list-check"></i> Validate segments', wide: true,
        body: '<div class="su-row"><span class="chip info" id="tb-mc">' + maps.length + ' mapping(s) ready</span><span class="grow"></span><button class="btn sm" data-mact="add"><i class="fa-solid fa-plus"></i> Add mapping</button>' +
            '<button class="btn sm" data-mact="auto"><i class="fa-solid fa-wand-magic-sparkles"></i> Auto-map</button><button class="btn sm" data-mact="save"><i class="fa-solid fa-download"></i> Save mappings (CSV)</button><button class="btn sm" data-mact="loadcsv"><i class="fa-solid fa-upload"></i> Load mappings</button></div>' +
            '<div id="tb-maps">' + html() + '</div><div class="note">Each mapped column is checked against all values of its value set (COA Segments › Segment list). Mappings are also remembered on this PC.</div>',
        buttons: [{ label: 'Cancel', act: 'close' }, { label: '<i class="fa-solid fa-play"></i> Run validation', cls: 'primary', act: 'run' }],
        onAction: function (a, box) {
            sync(box);
            var redraw = function () { $('tb-maps').innerHTML = html(); $('tb-mc').textContent = maps.length + ' mapping(s) ready'; };
            if (/^del/.test(a)) { maps.splice(+a.slice(3), 1); redraw(); return false; }
            if (a === 'add') { maps.push({ col: SetTb.cols[0], seg: segs[0].key }); redraw(); return false; }
            if (a === 'auto') { maps = SetTb.autoMap(SetTb.cols); redraw(); FX.toast(maps.length + ' column(s) recognised.'); return false; }
            if (a === 'save') {
                var lines = ['excelColumn,coaSegmentKey,coaLabel'].concat(maps.map(function (m) { var s = SetCoa.seg(m.seg) || {}; return [m.col, m.seg, s.label].map(function (v) { return '"' + String(v || '').replace(/"/g, '""') + '"'; }).join(','); }));
                var el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' })); el.download = 'TB_SegmentMappings.csv'; el.click();
                lsSet('set_tb_maps', maps); return false;
            }
            if (a === 'loadcsv') {
                SU.pickFile('.csv').then(function (f) {
                    if (!f) return; return f.text().then(function (txt) {
                        var got = txt.split(/\r?\n/).slice(1).map(function (l) { var p = l.split(',').map(function (x) { return x.replace(/^\s*"|"\s*$/g, '').replace(/""/g, '"').trim(); }); return { col: p[0], seg: p[1] }; })
                            .filter(function (m) { return m.col && m.seg && SetCoa.seg(m.seg); });
                        if (!got.length) { FX.toast('No valid mappings found in CSV.', 'err'); return; }
                        var miss = got.filter(function (m) { return SetTb.cols.indexOf(m.col) < 0; });
                        maps = got.filter(function (m) { return SetTb.cols.indexOf(m.col) >= 0; }); redraw();
                        FX.toast(maps.length + ' mapping(s) loaded' + (miss.length ? ' · ' + miss.length + ' column(s) not in this file: ' + miss.map(function (m) { return m.col; }).join(', ') : '') + '.');
                    });
                });
                return false;
            }
            if (a === 'run') {
                var seen = {};
                maps = maps.filter(function (m) { var k = m.col + '|' + m.seg; if (seen[k]) return false; seen[k] = 1; return true; });
                if (!maps.length) { FX.toast('Add at least one mapping.', 'err'); return false; }
                SetTb.maps = maps; lsSet('set_tb_maps', maps);
                SetTb.validate();
            }
        }
    });
};
SetTb.validate = function () {
    FX.busy('Reading value sets…');
    var done = 0;
    Promise.all(SetTb.maps.map(function (m) {
        var s = SetCoa.seg(m.seg);
        var res = { col: m.col, seg: m.seg, label: s.label, valueSet: s.valueSet, url: SU.root() + SetCoa.path(s.valueSet), total: 0, valid: 0, invalid: [], bad: {}, vsCount: 0, error: null };
        return SetCoa.values(s.valueSet).then(function (vals) {
            var ok = {}; vals.forEach(function (v) { if (v.Value != null) ok[String(v.Value).trim()] = 1; });
            var cnt = {}; SetTb.rows.forEach(function (r) { var v = SetTb.txt(r, m.col); if (v) cnt[v] = (cnt[v] || 0) + 1; });
            var keys = Object.keys(cnt);
            res.vsCount = vals.length; res.total = keys.length;
            keys.forEach(function (k) { if (ok[k]) res.valid++; else { res.invalid.push({ value: k, count: cnt[k] }); res.bad[k] = 1; } });
            res.invalid.sort(function (a, b) { return b.count - a.count; });
        }).catch(function (e) { res.error = String(e).indexOf('HTTP') === 0 ? String(e) + ' for ' + s.valueSet : String(e); })
            .then(function () { done++; FX.busy('Reading value sets… ' + done + '/' + SetTb.maps.length); return res; });
    })).then(function (results) {
        FX.busy(false);
        SetTb.results = results;
        var bad = results.reduce(function (a, r) { return a + r.invalid.length; }, 0);
        FX.toast('Validation done — ' + bad + ' invalid unique value(s).', bad ? 'err' : 'ok');
        if (FX.cur && FX.cur.id === 'tb') SetTb.render($('fx-view'));
    });
};

// ── exports ────────────────────────────────────────────────────
SetTb.plainRows = function (rows) { return SU.aoa(rows, SetTb.cols.map(function (c) { return { label: c, get: function (r) { return r[c]; } }; })); };
SetTb.exportFiltered = function () { SU.xlsx('TB_Filtered_' + SU.safeFile(SU.ext(SetTb.file.name)), [{ name: 'Trial Balance', aoa: SetTb.plainRows(SetTb.filtered()) }]); };
SetTb.exportInvalidValues = function () {
    var sheets = (SetTb.results || []).filter(function (r) { return !r.error && r.invalid.length; }).map(function (r) {
        return { name: r.col + '-' + r.label, aoa: [['Invalid Value', 'Occurrences in File', 'Excel Column', 'COA Segment']].concat(r.invalid.map(function (x) { return [x.value, x.count, r.col, r.label + ' (' + r.valueSet + ')']; })) };
    });
    if (!sheets.length) { FX.toast('No invalid values.'); return; }
    SU.xlsx('TB_InvalidValues_' + SU.safeFile(SU.ext(SetTb.file.name)), sheets);
};
SetTb.exportInvalidRows = function () {
    var inv = SetTb.invalidSet(), rows = SetTb.rows.filter(function (r) { return SetTb.rowInvalid(r, inv); });
    var aoa = SetTb.plainRows(rows);
    aoa[0].push('Invalid segments');
    rows.forEach(function (r, i) { aoa[i + 1].push(Object.keys(inv).filter(function (c) { var v = SetTb.txt(r, c); return v && inv[c][v]; }).map(function (c) { return c + '=' + SetTb.txt(r, c); }).join('; ')); });
    SU.xlsx('TB_InvalidRows_' + SU.safeFile(SU.ext(SetTb.file.name)), [{ name: 'Invalid rows', aoa: aoa }]);
};
