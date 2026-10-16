/* Setup & Diagnostics — Setup Data Explorer. Reads an Oracle FSM "Setup Data Export" ZIP entirely in the page
   (JSZip; the per-task .xls files are BI Publisher HTML tables): which setup tasks are configured, records per task,
   a dashboard per module and a Business Unit × setup-task coverage matrix. Excel + printable (PDF) report.
   Complements Data Loading › Setup Projects › Setup data (which counts business-object CSVs). */

var SetExp = { fileNames: [], tasks: [], module: 'Financials', view: 'explorer', confOnly: false, q: '', busy: null };
SetExp.MODULES = ['Financials', 'Supply Chain', 'Common'];

SetExp.moduleOf = function (name) {
    var n = String(name).toLowerCase();
    if (/^item\b|item class|item status|item attribute|item lifecycle|revenue management item|inventory|subinventory|unit of measure|interorganization|intersubinventory|min-?max|packing|pick\b|picking|pick wave|pick sequence|ship confirm|shipping|receiving|carrier|\broute\b|transportation|transit|warehouse|source organization|landed cost|contract manufacturing|\bcost\b|costing|cost book|cost element|cost component|cost organization|cost profile|cost analysis|cost valuation|default cost|transfer pricing|\babc\b|supply |manufacturing|profit center|financial orchestration|barcode|planning|material|charge reference|supplier number|supplier user|enable new supplier|procurement agent/.test(n)) return 'Supply Chain';
    if (/receivable|payable|payment|\btax\b|subledger|\bledger\b|journal|legal|business unit|fixed asset|expense|collection|revenue management|\bbank\b|intercompany|chart of account|general ledger|conversion rate|aging|autoinvoice|funds capture|credit card|credit case|\bcash\b|distribution|jurisdiction|approval|accounting|financials|internal payer|disbursement|reporting entity|interest rate|\bperiod\b|1099|segment value|data access|balancing|suspense|statistical|reconciliation|remit-to|\bmemo\b|dunning|collector|lockbox|card issuer|corporate card|configuration owner|country tax|customer tax|application tax|revaluation|invoice|scoring|contingency|autocash|automatch|balance forward|late charge|statement|reversal|standard message/.test(n)) return 'Financials';
    return 'Common';
};

SetExp.BU_HEADER = /^(business\s*unit(\s*name)?|bu(\s*name)?)$/i;
/** One HTML-table .xls → {name, sdoTitle, headers, rows, businessUnits}; keeps the block with the most rows. */
SetExp.parseHtmlTable = function (html, fileName) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var cellsOf = function (tr) { return Array.prototype.slice.call(tr.querySelectorAll('td,th')); };
    var txt = function (el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); };
    var tables = Array.prototype.slice.call(doc.querySelectorAll('table'));
    var blocks = tables.length ? tables.map(function (t) { return Array.prototype.slice.call(t.querySelectorAll('tr')); }) : [Array.prototype.slice.call(doc.querySelectorAll('tr'))];
    var sdoTitle, primary = { headers: [], rows: [] }, bus = {};
    blocks.forEach(function (trs) {
        var hi = -1; for (var i = 0; i < trs.length; i++) if (cellsOf(trs[i]).length > 1) { hi = i; break; }
        if (hi < 0) { var one = trs[0] && cellsOf(trs[0]); if (one && one.length === 1 && !sdoTitle) sdoTitle = txt(one[0]) || undefined; return; }
        var headers = cellsOf(trs[hi]).map(txt), hj = headers.join(''), rows = [];
        for (var r = hi + 1; r < trs.length; r++) {
            var cells = cellsOf(trs[r]); if (cells.length < 2) continue;
            var vals = cells.map(txt);
            if (vals.every(function (v) { return !v; })) continue;
            if (vals.join('') === hj) continue;
            rows.push(vals);
        }
        headers.forEach(function (h, idx) {
            if (!SetExp.BU_HEADER.test((h || '').trim())) return;
            rows.forEach(function (row) { var v = (row[idx] || '').trim(); if (v && !/^\d+$/.test(v) && v.length < 80 && !/^business ?unit$/i.test(v)) bus[v] = 1; });
        });
        if (rows.length > primary.rows.length) primary = { headers: headers, rows: rows };
    });
    return { name: fileName, sdoTitle: sdoTitle, headers: primary.headers, rows: primary.rows, businessUnits: Object.keys(bus) };
};

/** Whole export → tasks sorted by name. onProgress(done, total). */
SetExp.parse = function (file, onProgress) {
    if (!window.JSZip) return Promise.reject('The ZIP library did not load (needs internet for cdnjs).');
    return JSZip.loadAsync(file).then(function (zip) {
        var report = Object.keys(zip.files).map(function (k) { return zip.files[k]; }).filter(function (f) { return !f.dir && /setup_?data_?report\.zip$/i.test(f.name); })[0];
        return report ? report.async('arraybuffer').then(function (b) { return JSZip.loadAsync(b); }) : zip;
    }).then(function (zip) {
        var entries = Object.keys(zip.files).map(function (k) { return zip.files[k]; }).filter(function (f) { return !f.dir && /\.zip$/i.test(f.name) && !/businessobjectdata\/|tasklistdata\//i.test(f.name); });
        var tasks = [], done = 0;
        return entries.reduce(function (p, entry) {
            return p.then(function () {
                var name = entry.name.replace(/\.zip$/i, '').replace(/^.*\//, ''), files = [], bus = {}, batch = false, unreadable = false;
                return entry.async('arraybuffer').then(function (b) { return JSZip.loadAsync(b); }).then(function (inner) {
                    var list = Object.keys(inner.files).map(function (k) { return inner.files[k]; }).filter(function (f) { return !f.dir; });
                    return list.reduce(function (q, fe) {
                        return q.then(function () {
                            if (/\.zip$/i.test(fe.name)) { batch = true; return; }
                            if (!/\.xls$/i.test(fe.name)) return;
                            return fe.async('string').then(function (s) {
                                var t = SetExp.parseHtmlTable(s, fe.name.replace(/^.*\//, ''));
                                t.businessUnits.forEach(function (b2) { bus[b2] = 1; });
                                if (t.headers.length || t.rows.length || t.sdoTitle) files.push({ name: t.name, sdoTitle: t.sdoTitle, headers: t.headers, rows: t.rows });
                            });
                        });
                    }, Promise.resolve());
                }).catch(function () { unreadable = true; }).then(function () {
                    var rc = files.reduce(function (a, f) { return a + f.rows.length; }, 0);
                    tasks.push({ name: name, module: SetExp.moduleOf(name), files: files, recordCount: rc, hasData: rc > 0 || batch, batch: batch, unreadable: unreadable, businessUnits: Object.keys(bus).sort() });
                    done++; if (onProgress) onProgress(done, entries.length);
                });
            });
        }, Promise.resolve()).then(function () { return tasks.sort(function (a, b) { return a.name.localeCompare(b.name); }); });
    });
};
SetExp.merge = function (existing, incoming) {
    var by = {}; existing.forEach(function (t) { by[t.name] = t; });
    incoming.forEach(function (t) {
        var cur = by[t.name]; if (!cur) { by[t.name] = t; return; }
        var better = (t.recordCount > cur.recordCount || (t.hasData && !cur.hasData)) ? t : cur, u = {};
        cur.businessUnits.concat(t.businessUnits).forEach(function (b) { u[b] = 1; });
        by[t.name] = Object.assign({}, better, { businessUnits: Object.keys(u).sort() });
    });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
};

// ── derived numbers ────────────────────────────────────────────
SetExp.modStats = function () {
    var list = SetExp.MODULES.map(function (m) {
        var t = SetExp.tasks.filter(function (x) { return x.module === m; }), c = t.filter(function (x) { return x.hasData; }).length;
        return { module: m, tasks: t.length, configured: c, empty: t.length - c, pct: SU.pct(c, t.length), records: t.reduce(function (a, x) { return a + x.recordCount; }, 0) };
    });
    var all = { module: 'All modules', tasks: 0, configured: 0, empty: 0, records: 0, _all: true };
    list.forEach(function (m) { all.tasks += m.tasks; all.configured += m.configured; all.empty += m.empty; all.records += m.records; });
    all.pct = SU.pct(all.configured, all.tasks);
    return { list: list, all: all };
};
/** BU × task matrix for one module (or all when module is null). */
SetExp.matrix = function (module) {
    var scoped = SetExp.tasks.filter(function (t) { return (!module || t.module === module) && t.businessUnits.length; })
        .sort(function (a, b) { return b.businessUnits.length - a.businessUnits.length || a.name.localeCompare(b.name); });
    var uni = {}; scoped.forEach(function (t) { t.businessUnits.forEach(function (b) { uni[b] = 1; }); });
    var rows = Object.keys(uni).sort().map(function (b) {
        var cells = {}, n = 0, mods = {};
        scoped.forEach(function (t) { if (t.businessUnits.indexOf(b) >= 0) { cells[t.name] = true; n++; mods[t.module] = 1; } });
        return { bu: b, cells: cells, doneCount: n, modules: Object.keys(mods).sort() };
    }).sort(function (a, b) { return b.doneCount - a.doneCount || a.bu.localeCompare(b.bu); });
    return { scoped: scoped, rows: rows };
};
SetExp.base = function () { return (SetExp.fileNames[0] || 'export').replace(/\.zip$/i, ''); };

// ── render ─────────────────────────────────────────────────────
SetExp.render = function (el, defaultModule) {
    if (defaultModule) SetExp.module = defaultModule;
    SetExp.el = el;
    SU.headRight(SetExp.tasks.length ? '<button class="btn sm" id="sx-add"><i class="fa-solid fa-plus"></i> Add export…</button> <button class="btn sm danger" id="sx-clear"><i class="fa-solid fa-eraser"></i> Clear</button>' : '');
    if ($('sx-add')) {
        $('sx-add').onclick = function () { SU.pickFile('.zip').then(function (f) { if (f) SetExp.load(f, true); }); };
        $('sx-clear').onclick = function () { SetExp.tasks = []; SetExp.fileNames = []; SetExp.render(el); };
    }
    if (!SetExp.tasks.length) {
        el.innerHTML = '<div class="card pad su-intro"><div id="sx-drop"></div>' +
            '<div class="su-steps3"><div><b>1</b><span>In Fusion: <i>Setup and Maintenance › Manage Implementation Projects</i> (or an offering) › <i>Actions › Export › Setup Data Report</i>, then download the ZIP.</span></div>' +
            '<div><b>2</b><span>Drop the ZIP here. It is read in this page only — nothing is uploaded.</span></div>' +
            '<div><b>3</b><span>See which setup tasks are configured per module and which business units each one covers. Add more exports to merge them.</span></div></div></div>' +
            '<div id="sx-prog"></div>';
        SU.dropZone($('sx-drop'), { accept: '.zip', icon: 'fa-file-zipper', title: 'Drop an FSM Setup Data Export (.zip)', text: 'or click to choose — full ASM packages (with SETUP_DATA_REPORT.zip inside) work too', onFiles: function (f) { SetExp.load(f[0], false); } });
        return;
    }
    var st = SetExp.modStats(), all = st.all;
    el.innerHTML =
        '<div class="su-cards">' +
        '<div class="card su-mcard acc"><div class="su-mc-h"><i class="fa-solid fa-list-check"></i> Setup tasks<span class="grow"></span><b>' + all.pct + '% done</b></div>' +
        '<b class="big">' + all.tasks + '</b>' + SU.bar(all.pct, 'ok') + '<div class="su-mc-f"><span class="ok"><b>' + all.configured + '</b> configured</span><span><b>' + all.empty + '</b> empty</span><span><b>' + SU.num(all.records) + '</b> records</span></div>' +
        '<div class="muted" style="font-size:.7rem;margin-top:4px" title="' + esc(SetExp.fileNames.join('\n')) + '"><i class="fa-solid fa-file-zipper"></i> ' + esc(SetExp.fileNames.join(', ')) + '</div></div>' +
        st.list.map(function (m) {
            return '<div class="card su-mcard click ' + SU.MOD_CLS[m.module] + (SetExp.module === m.module ? ' on' : '') + '" data-sxmod="' + esc(m.module) + '"><div class="su-mc-h">' + SU.modTag(m.module) + '<span class="grow"></span><b>' + m.pct + '%</b></div>' +
                '<b class="big">' + m.configured + ' <small>/ ' + m.tasks + '</small></b><span class="muted">tasks configured</span>' + SU.bar(m.pct, SU.MOD_CLS[m.module]) +
                '<div class="su-mc-f"><span><b>' + SU.num(m.records) + '</b> records</span></div></div>';
        }).join('') + '</div>' +
        '<div class="su-row">' + SU.tabBar(st.list.map(function (m) { return { id: m.module, label: m.module, badge: m.configured + '/' + m.tasks }; }), SetExp.module, 'flat') +
        '<span class="grow"></span><span id="sx-viewseg">' + SU.seg([{ v: 'explorer', t: '<i class="fa-solid fa-table-list"></i> Explorer' }, { v: 'analysis', t: '<i class="fa-solid fa-table-cells"></i> BU & Module Analysis' }], SetExp.view, 'sxv') + '</span></div>' +
        '<div id="sx-body" class="su-fill"></div>';
    el.onclick = function (e) {
        var m = e.target.closest('[data-sxmod]') || e.target.closest('[data-sutab]');
        if (m && el.contains(m) && !e.target.closest('#sx-body')) { SetExp.module = m.getAttribute('data-sxmod') || m.getAttribute('data-sutab'); SetExp.render(el); return; }
        var v = e.target.closest('[data-sxv]'); if (v) { SetExp.view = v.getAttribute('data-sxv'); SetExp.render(el); }
    };
    if (SetExp.view === 'explorer') SetExp.drawExplorer($('sx-body')); else SetExp.drawAnalysis($('sx-body'));
};

SetExp.load = function (file, add) {
    if (!/\.zip$/i.test(file.name)) { FX.toast('Choose the .zip file of a Setup Data Export.', 'err'); return; }
    FX.busy('Reading ' + file.name + '…');
    SetExp.parse(file, function (d, t) { FX.busy('Reading ' + file.name + '… task ' + d + ' of ' + t); }).then(function (tasks) {
        FX.busy(false);
        if (!tasks.length) { FX.toast('No setup tasks found in ' + file.name + ' — is it a Setup Data Export (task ZIPs inside)?', 'err'); return; }
        if (add && SetExp.tasks.length) {
            SetExp.tasks = SetExp.merge(SetExp.tasks, tasks);
            if (SetExp.fileNames.indexOf(file.name) < 0) SetExp.fileNames.push(file.name);
            FX.toast('Added ' + tasks.length + ' tasks from ' + file.name + ' (' + SetExp.tasks.length + ' total).', 'ok');
        } else {
            SetExp.tasks = tasks; SetExp.fileNames = [file.name];
            FX.toast(tasks.length + ' setup tasks read from ' + file.name + '.', 'ok');
        }
        if (FX.cur && FX.cur.id === 'setupdata') SetExp.render($('fx-view'));
    }).catch(function (e) { FX.busy(false); FX.toast('Could not read ' + file.name + ': ' + (e && e.message || e), 'err'); });
};

SetExp.drawExplorer = function (body) {
    var mod = SetExp.module;
    var t = SU.table(body, {
        rows: SetExp.tasks, pageSize: 25, quickPh: 'Search setup task…',
        filter: function (x) { return x.module === mod && (!SetExp.confOnly || x.hasData); },
        toolbar: '<label class="su-toggle"><input type="checkbox" id="sx-conf"' + (SetExp.confOnly ? ' checked' : '') + '> Configured only</label>' +
            '<button class="btn sm" id="sx-xs"><i class="fa-solid fa-file-excel"></i> Export summary</button><button class="btn sm" id="sx-pdf"><i class="fa-solid fa-file-pdf"></i> PDF report</button>',
        columns: [
            { k: 'name', label: 'Setup Task', html: function (x) { return '<b>' + esc(x.name) + '</b>' + (x.batch ? ' <span class="chip warn">batch</span>' : '') + (x.unreadable ? ' <span class="chip err">unreadable</span>' : ''); } },
            { k: 'module', label: 'Module', html: function (x) { return SU.modTag(x.module); } },
            { k: 'hasData', label: 'Status', get: function (x) { return x.hasData ? 1 : 0; }, html: function (x) { return x.hasData ? '<span class="su-st ok"><i class="fa-solid fa-circle-check"></i> Configured</span>' : '<span class="su-st none"><i class="fa-regular fa-circle"></i> Not configured</span>'; } },
            { k: 'recordCount', label: 'Records', n: true, html: function (x) { return x.recordCount ? '<b>' + SU.num(x.recordCount) + '</b>' : x.batch ? '<span class="chip warn">batch</span>' : '<span class="muted">—</span>'; } },
            { k: 'files', label: 'Files', n: true, get: function (x) { return x.files.length; }, html: function (x) { return x.files.length || '<span class="muted">—</span>'; } },
            { k: 'bus', label: 'BUs', n: true, get: function (x) { return x.businessUnits.length; }, html: function (x) { return x.businessUnits.length ? '<span class="chip info" title="' + esc(x.businessUnits.join('\n')) + '">' + x.businessUnits.length + '</span>' : ''; } },
            { k: 'x', label: '', html: function (x) { return '<button class="btn sm" data-sxview="' + esc(x.name) + '"' + (x.files.length ? '' : ' disabled') + '><i class="fa-solid fa-eye"></i> View</button>'; } }
        ],
        onRow: function (x) { SetExp.detail(x); }
    });
    $('sx-conf').onchange = function () { SetExp.confOnly = this.checked; t.page = 0; t.render(); };
    $('sx-xs').onclick = SetExp.exportSummary;
    $('sx-pdf').onclick = SetExp.pdf;
    body.onclick = function (e) { var b = e.target.closest('[data-sxview]'); if (b) { e.stopPropagation(); SetExp.detail(SetExp.tasks.filter(function (x) { return x.name === b.getAttribute('data-sxview'); })[0]); } };
};

SetExp.detail = function (x) {
    if (!x) return;
    FX.drawer({
        title: esc(x.name), sub: esc(x.recordCount ? x.recordCount + ' record(s)' : 'empty') + ' · ' + esc(SetExp.fileNames.join(', ')),
        chips: [SU.modTag(x.module), x.hasData ? '<span class="chip ok">Configured</span>' : '<span class="chip">Not configured</span>'],
        facts: [['Module', SU.modTag(x.module)], ['Records', SU.num(x.recordCount)], ['Files', String(x.files.length)], ['Batch format', x.batch ? 'Yes' : 'No'],
            ['Business units', x.businessUnits.length ? x.businessUnits.map(function (b) { return '<span class="chip info">' + esc(b) + '</span>'; }).join(' ') : '—']],
        extra: x.files.length ? '<div class="note">' + x.files.map(function (f) { return esc(f.sdoTitle || f.name) + ' — <b>' + f.rows.length + '</b> rows'; }).join('<br>') + '</div>'
            : '<div class="note">' + (x.batch ? 'Batch-format task — records are in a nested import batch (not table-parsed).' : 'No setup data (task not configured).') + '</div>',
        tabs: x.files.map(function (f) {
            return {
                label: SU.trunc(f.sdoTitle || f.name, 40) + ' (' + f.rows.length + ')', render: function (el) {
                    var cols = f.headers.map(function (h, i) { return { k: 'c' + i, label: h || 'Col ' + (i + 1), get: function (r) { return r[i]; } }; });
                    el.innerHTML = '<div class="muted mono" style="font-size:.72rem">' + esc(f.name) + '</div><div id="sx-ft"></div>';
                    SU.table($('sx-ft'), { rows: f.rows, columns: cols, pageSize: 50, empty: 'No rows in this file.' });
                }
            };
        })
    });
};

SetExp.drawAnalysis = function (body) {
    var st = SetExp.modStats(), mx = SetExp.matrix(SetExp.module), n = mx.scoped.length;
    body.innerHTML = '<div class="card"><div class="card-h"><b><i class="fa-solid fa-layer-group"></i> Module-wise setup status</b><span class="grow"></span>' +
        '<button class="btn sm" id="sx-xa"><i class="fa-solid fa-file-excel"></i> Export analysis</button><button class="btn sm" id="sx-pdf2"><i class="fa-solid fa-file-pdf"></i> PDF report</button></div>' +
        FX.table(st.list.concat([st.all]), [
            { label: 'Module', html: function (m) { return m._all ? '<b>All modules</b>' : SU.modTag(m.module); } }, { label: 'Tasks', f: 'tasks', n: 1 }, { label: 'Configured', f: 'configured', n: 1 },
            { label: 'Empty', f: 'empty', n: 1 }, { label: '% Done', html: function (m) { return '<div class="su-nb"><b>' + m.pct + '%</b>' + SU.bar(m.pct, m._all ? 'ok' : SU.MOD_CLS[m.module]) + '</div>'; } },
            { label: 'Records', n: 1, html: function (m) { return SU.num(m.records); } }]) + '</div>' +
        '<div class="card su-fill" id="sx-mx"></div>';
    $('sx-xa').onclick = SetExp.exportAnalysis; $('sx-pdf2').onclick = SetExp.pdf;
    if (!n) { $('sx-mx').innerHTML = '<div class="card-h"><b><i class="fa-solid fa-table-cells"></i> Business Unit × Setup — ' + esc(SetExp.module) + '</b></div>' + SU.empty('fa-building-circle-xmark', 'No business-unit-scoped setup tasks found in this export', 'Tasks only count here when their report has a "Business Unit" column.'); return; }
    var cols = [
        { k: 'bu', label: 'Business Unit', w: 200, cls: 'su-sticky', thCls: 'su-sticky', html: function (r) { return '<b>' + esc(r.bu) + '</b>'; } },
        { k: 'doneCount', label: 'Setups Done', w: 130, html: function (r) { return '<div class="su-nb"><b>' + r.doneCount + '/' + n + '</b>' + SU.bar(SU.pct(r.doneCount, n), 'ok') + '</div>'; } }
    ].concat(mx.scoped.map(function (t, i) {
        return { k: 't' + i, label: t.name, title: t.name + ' — ' + t.businessUnits.length + ' BUs', th: '<span class="su-vh">' + esc(SU.trunc(t.name, 15)) + '</span><span class="su-cnt">✓ ' + t.businessUnits.length + '</span>', thCls: 'su-mx-h', cls: 'su-mx',
            get: function (r) { return r.cells[t.name] ? 1 : 0; }, html: function (r) { return r.cells[t.name] ? '<b class="su-yes">✓</b>' : '<span class="su-no">·</span>'; } };
    }));
    SU.table($('sx-mx'), { rows: mx.rows, columns: cols, pageSize: 50, quickPh: 'Search business unit…', sort: { k: 'doneCount', d: -1 },
        toolbar: '<b style="font-size:.82rem"><i class="fa-solid fa-table-cells" style="color:var(--accent)"></i> Business Unit × Setup — ' + esc(SetExp.module) + '</b><span class="chip info">' + mx.rows.length + ' BUs</span><span class="chip">' + n + ' BU-scoped tasks</span>' });
};

// ── exports ────────────────────────────────────────────────────
SetExp.exportSummary = function () {
    SU.xlsx('setup-summary-' + SU.safeFile(SetExp.base()), [{ name: 'Setup Tasks', aoa: SU.aoa(SetExp.tasks, [{ label: 'Setup Task', k: 'name' }, { label: 'Module', k: 'module' },
        { label: 'Status', get: function (x) { return x.hasData ? 'Configured' : 'Not configured'; } }, { label: 'Records', k: 'recordCount' }, { label: 'Files', get: function (x) { return x.files.length; } },
        { label: 'Batch', get: function (x) { return x.batch ? 'Yes' : ''; } }, { label: 'Business Units', get: function (x) { return x.businessUnits.join(', '); } }]) }]);
};
SetExp.exportAnalysis = function () {
    var st = SetExp.modStats(), mx = SetExp.matrix(SetExp.module), n = mx.scoped.length;
    var ms = [['Module', 'Tasks', 'Configured', 'Empty', '% Done', 'Records']].concat(st.list.concat([st.all]).map(function (m) { return [m.module, m.tasks, m.configured, m.empty, m.pct / 100, m.records]; }));
    var aoa = [['Business Unit', 'Setups Done', '% Complete'].concat(mx.scoped.map(function (t) { return t.name; }))];
    aoa.push(['BUs →', '', ''].concat(mx.scoped.map(function (t) { return t.businessUnits.length; })));
    mx.rows.forEach(function (r) { aoa.push([r.bu, r.doneCount + '/' + n, n ? r.doneCount / n : 0].concat(mx.scoped.map(function (t) { return r.cells[t.name] ? '✓' : ''; }))); });
    SU.xlsx('setup-bu-analysis-' + SU.safeFile(SetExp.base()), [{ name: 'Module Status', aoa: ms, freeze: { ySplit: 1 } }, { name: 'BU x Setup ' + SetExp.module, aoa: aoa, freeze: { xSplit: 3, ySplit: 2 } }]);
};
SetExp.pdf = function () {
    var st = SetExp.modStats(), mx = SetExp.matrix(null), n = mx.scoped.length;
    var h = '<h1>Fusion Setup Data — Summary Report</h1><div class="meta">Generated ' + esc(new Date().toLocaleString()) + '<br>Exports: ' + esc(SetExp.fileNames.join(', ')) + '<br>' +
        '<b>' + st.all.tasks + '</b> setup tasks · <b>' + st.all.configured + '</b> configured (' + st.all.pct + '%) · <b>' + st.all.empty + '</b> empty · <b>' + st.all.records.toLocaleString() + '</b> records</div>' +
        '<h2>Module status</h2>' + SU.ptable(st.list.concat([st.all]), [{ label: 'Module', k: 'module' }, { label: 'Tasks', k: 'tasks', n: 1 }, { label: 'Configured', k: 'configured', n: 1 }, { label: 'Empty', k: 'empty', n: 1 }, { label: '% Done', n: 1, get: function (m) { return m.pct + '%'; } }, { label: 'Records', n: 1, get: function (m) { return m.records.toLocaleString(); } }]) +
        '<h2>Business Unit setup coverage (' + mx.rows.length + ' BUs)</h2>' + (mx.rows.length ? SU.ptable(mx.rows, [{ label: 'Business Unit', k: 'bu' }, { label: 'Setups Done', n: 1, get: function (r) { return r.doneCount + '/' + n; } }, { label: 'Modules', get: function (r) { return r.modules.join(', '); } }]) : '<p class="muted">No business-unit-scoped setup tasks.</p>') +
        (n ? '<h2>Setup tasks — business units configured</h2>' + SU.ptable(mx.scoped, [{ label: 'Setup Task', k: 'name' }, { label: 'Module', k: 'module' }, { label: 'BUs', n: 1, get: function (t) { return t.businessUnits.length; } }, { label: 'Business Units', get: function (t) { return t.businessUnits.join(', '); } }]) : '') +
        '<h2>All setup tasks</h2>' + SU.ptable(SetExp.tasks, [{ label: 'Setup Task', k: 'name' }, { label: 'Module', k: 'module' }, { label: 'Status', get: function (x) { return x.hasData ? 'Configured' : 'Not configured'; }, cls: function (x) { return x.hasData ? 'ok' : 'muted'; } }, { label: 'Records', n: 1, get: function (x) { return x.recordCount ? x.recordCount.toLocaleString() : x.batch ? 'batch' : ''; } }]);
    if (n && mx.rows.length) {
        var rows = [{ bu: 'BUs configured →', _cls: 'cnt' }].concat(mx.rows);
        h += '<section class="land"><h2>Business Unit × Setup coverage</h2>' + SU.ptable(rows, [{ label: 'Business Unit', h: 1, cls: 'l', get: function (r) { return r.bu; } }]
            .concat(mx.scoped.map(function (t) { return { label: SU.trunc(t.name, 40), get: function (r) { return r.cells ? (r.cells[t.name] ? '✓' : '') : t.businessUnits.length; } }; })), 'mx') + '</section>';
    }
    SU.print('setup-data-summary-' + SetExp.base(), h, 'Gray\'s WMS · Setup Data');
};
