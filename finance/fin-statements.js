/* Finance Lens — Statements: any template (income statement, balance sheet, cash flow, your own) for the period and filter,
   formatted like a published statement; click any amount to drill; account detail; Excel (formatted) / CSV / print. */
(function () {
    var S = FL.stmt = { tpl: FL.ls('stmt.tpl', 'PL'), hideZero: FL.ls('stmt.hideZero', true), detail: false };

    FL.stmtOpts = function () { return { period: FL.filter.period, scale: FL.filter.scale }; };

    /** Formats a cell of a computed statement */
    FL.cellText = function (r, c, v) {
        if (v == null) return '';
        if (c.kind === 'var') return c.mode === 'pct' ? FINE.fmt(v, 'pct') : (r.format === 'pct' ? (v >= 0 ? '+' : '') + v.toFixed(1) + ' pts' : FINE.fmt(v, r.format));
        if (c.kind === 'pctof') return FINE.fmt(v, 'pct');
        return FINE.fmt(v, r.format, { decimals: FL.filter.scale >= 1000000 ? 1 : 0 });
    };
    FL.rowClass = function (r) {
        var s = r.style || {}, c = [r.type];
        if (s.bold) c.push('b'); if (s.italic) c.push('i'); if (s.muted) c.push('m'); if (s.topBorder) c.push('tb'); if (s.doubleBottom) c.push('db'); if (s.highlight) c.push('hl');
        if (r.type === 'check') c.push(r.ok ? 'ok' : 'notok');
        return c.join(' ');
    };

    /** Table HTML of a computed statement (also used by the board pack with links off) */
    FL.stmtTable = function (st, opts) {
        opts = opts || {};
        var rows = st.rows.filter(function (r) {
            if (r.hidden) return false;
            if (opts.hideZero && (r.type === 'accounts') && r.values.every(function (v, i) { return st.columns[i].kind !== 'value' || !v || Math.abs(v) < 0.5; })) return false;
            return true;
        });
        var h = '<table class="st"><thead><tr><th>' + esc(opts.firstHeader || ('in ' + FL.scaleLabel())) + '</th>' +
            st.columns.map(function (c) { return '<th class="' + (c.kind !== 'value' ? 'var' : '') + '">' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
        rows.forEach(function (r) {
            var lv = (r.level || 0) * 18;
            h += '<tr class="' + FL.rowClass(r) + '" data-row="' + esc(r.id || '') + '">';
            var expand = opts.detail && r.type === 'accounts' && r.accounts && r.accounts.length > 0;
            h += '<td><span class="lv" style="padding-left:' + lv + 'px">' + (opts.links && expand ? '' : '') + esc(r.label || '') + (r.note && !opts.print ? ' <i class="fa-regular fa-note-sticky muted" title="' + esc(r.note) + '"></i>' : '') + '</span></td>';
            st.columns.forEach(function (c, i) {
                var v = r.values[i], cls = [];
                if (c.kind === 'var' && v != null && Math.abs(v) > 1e-9) cls.push(v > 0 ? 'fav' : 'unf');
                var drill = opts.links && c.kind === 'value' && (r.type === 'accounts' || r.type === 'group') && v != null;
                if (drill) cls.push('v');
                h += '<td class="' + cls.join(' ') + '"' + (drill ? ' data-col="' + esc(c.id) + '"' : '') + '>' + FL.cellText(r, c, v) + '</td>';
            });
            h += '</tr>';
            if (expand && opts.sub && opts.sub[r.id]) {
                opts.sub[r.id].forEach(function (a) {
                    h += '<tr class="sub"><td><span class="lv" style="padding-left:' + (lv + 22) + 'px">' + esc(a.code + ' ' + a.name) + '</span></td>' +
                        st.columns.map(function (c, i) { return '<td>' + FL.cellText(r, c, a.values[i]) + '</td>'; }).join('') + '</tr>';
                });
            }
        });
        return h + '</tbody></table>';
    };

    /** Per-account values of every accounts row (for account detail) */
    function subRows(tpl, data, opts, st) {
        var out = {};
        st.rows.forEach(function (r) {
            if (r.type !== 'accounts' || !r.accounts || r.accounts.length < 1) return;
            var perAcc = {};
            st.columns.forEach(function (c, i) {
                if (c.kind !== 'value') return;
                FINE.explain(tpl, data, opts, r.id, c.id).forEach(function (a) { (perAcc[a.code] = perAcc[a.code] || { code: a.code, name: a.name, raw: {} }).raw[c.id] = a.amount; });
            });
            out[r.id] = Object.keys(perAcc).sort().map(function (k) {
                var a = perAcc[k];
                a.values = st.columns.map(function (c) {
                    if (c.kind === 'value') return a.raw[c.id] == null ? 0 : a.raw[c.id] / st.scale;
                    if (c.kind === 'var') { var va = (a.raw[c.a] || 0), vb = (a.raw[c.b] || 0), d = (va - vb) * (r.favourable === 'down' ? -1 : 1); return c.mode === 'pct' ? (vb ? d / Math.abs(vb) * 100 : null) : d / st.scale; }
                    return null;
                });
                return a;
            });
        });
        return out;
    }

    FL.TABS.statements = {
        render: function (el) {
            var tpl = FL.tpl(S.tpl) || FL.templates[0];
            if (!tpl) { el.innerHTML = '<div class="empty">No templates — open the Template designer.</div>'; return; }
            S.tpl = tpl.id;
            return FL.data().then(function (data) {
                var opts = FL.stmtOpts(), st = FINE.compute(tpl, data, opts);
                S.last = { tpl: tpl, st: st, opts: opts };
                var sub = S.detail ? subRows(tpl, data, opts, st) : null;
                el.innerHTML = '<div class="row toolbar" style="margin-bottom:10px"><div class="seg" id="st-tpls">' +
                    FL.templates.map(function (t) { return '<button data-t="' + esc(t.id) + '" class="' + (t.id === tpl.id ? 'on' : '') + '" title="' + esc(t.description || '') + '">' + esc(t.name) + '</button>'; }).join('') + '</div>' +
                    '<span class="grow"></span>' +
                    '<label class="sm"><input type="checkbox" id="st-zero"' + (S.hideZero ? ' checked' : '') + '> hide empty lines</label>' +
                    '<label class="sm"><input type="checkbox" id="st-det"' + (S.detail ? ' checked' : '') + '> account detail</label>' +
                    '<button class="btn sm" id="st-xl"><i class="fa-solid fa-file-excel"></i> Excel</button>' +
                    '<button class="btn sm" id="st-xla" title="Every template in one workbook"><i class="fa-solid fa-file-excel"></i> All statements</button>' +
                    '<button class="btn sm" id="st-csv"><i class="fa-solid fa-file-csv"></i> CSV</button>' +
                    '<button class="btn sm" onclick="window.print()"><i class="fa-solid fa-print"></i> Print</button>' +
                    '<button class="btn sm" id="st-edit"><i class="fa-solid fa-pen-ruler"></i> Edit template</button></div>' +
                    '<div class="stmt-wrap"><div class="stmt-head"><h2>' + esc(tpl.name) + '</h2><div class="sub">' + esc(FL.filterText()) + ' · period ' + esc(st.periodName) + ' · amounts in ' + FL.scaleLabel() +
                    (FL.filter.cc && tpl.type === 'BS' ? ' · <b>balance sheet accounts carry no cost centre: pick All cost centres</b>' : '') + '</div></div>' +
                    (st.errors.length ? '<div class="stmt-err"><i class="fa-solid fa-triangle-exclamation"></i> ' + st.errors.map(esc).join(' · ') + '</div>' : '') +
                    FL.stmtTable(st, { links: true, hideZero: S.hideZero, detail: S.detail, sub: sub }) + '</div>' +
                    '<p class="sm muted">Click an amount to see the accounts behind it, then companies, cost centres, months and journal lines. Variances are shown favourable (+) / unfavourable (−).</p>';
                el.querySelectorAll('#st-tpls button').forEach(function (b) { b.onclick = function () { S.tpl = b.dataset.t; FL.lsSet('stmt.tpl', S.tpl); FL.render(); }; });
                $('st-zero').onchange = function () { S.hideZero = this.checked; FL.lsSet('stmt.hideZero', S.hideZero); FL.render(); };
                $('st-det').onchange = function () { S.detail = this.checked; FL.render(); };
                $('st-xl').onclick = function () { FL.excel([S.last.st], tpl.name); };
                $('st-xla').onclick = function () { FL.excel(FL.templates.map(function (t) { return FINE.compute(t, data, opts); }), 'Financial statements'); };
                $('st-csv').onclick = function () { FL.csv(tpl.id + '-' + st.periodName + '.csv', ['line'].concat(st.columns.map(function (c) { return c.label; })), st.rows.filter(function (r) { return r.type !== 'blank'; }).map(function (r) { return [r.label].concat(r.values.map(function (v) { return v == null ? '' : Math.round(v * 100) / 100; })); })); };
                $('st-edit').onclick = function () { FL.designer.open(tpl.id); };
                el.querySelectorAll('td.v').forEach(function (td) {
                    td.onclick = function () { FL.drillCell(tpl, opts, td.parentNode.dataset.row, td.dataset.col); };
                });
            });
        }
    };

    // ── Excel: one formatted sheet per statement ──
    FL.excel = function (stmts, title) {
        if (!window.ExcelJS) { FL.toast('Excel library did not load (internet?)', 'err'); return; }
        var wb = new ExcelJS.Workbook(); wb.creator = 'Finance Lens';
        stmts.forEach(function (st) {
            var ws = wb.addWorksheet(String(st.name || st.template).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
            ws.addRow([st.name]).font = { bold: true, size: 14, color: { argb: 'FF0B2545' } };
            ws.addRow([FL.filterText() + ' · ' + st.periodName + ' · amounts in ' + FL.scaleLabel()]).font = { italic: true, color: { argb: 'FF64748B' } };
            ws.addRow([]);
            var hr = ws.addRow([''].concat(st.columns.map(function (c) { return c.label; })));
            hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            hr.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13315C' } }; c.alignment = { horizontal: 'center', wrapText: true }; });
            st.rows.forEach(function (r) {
                if (r.hidden) return;
                var vals = r.values.map(function (v) { return v == null ? null : Math.round(v * 100) / 100; });
                var row = ws.addRow([r.label || ''].concat(r.type === 'header' || r.type === 'blank' || r.type === 'text' ? [] : vals));
                var s = r.style || {};
                row.getCell(1).alignment = { indent: (r.level || 0) * 2 };
                row.font = { bold: !!s.bold, italic: !!s.italic, color: { argb: s.muted ? 'FF64748B' : r.type === 'check' && !r.ok ? 'FFB91C1C' : 'FF0F172A' } };
                st.columns.forEach(function (c, i) {
                    var cell = row.getCell(i + 2);
                    cell.numFmt = (c.kind === 'var' && c.mode === 'pct') || c.kind === 'pctof' || r.format === 'pct' ? '0.0"%";-0.0"%";"–"' : r.format === 'ratio' ? '0.00"×"' : r.format === 'days' ? '0" d"' : '#,##0;(#,##0);"–"';
                    if (c.kind === 'var' && cell.value != null) cell.font = { bold: !!s.bold, color: { argb: cell.value >= 0 ? 'FF15803D' : 'FFB91C1C' } };
                    if (s.topBorder) cell.border = Object.assign({}, cell.border, { top: { style: 'thin' } });
                    if (s.doubleBottom) cell.border = Object.assign({}, cell.border, { bottom: { style: 'double' } });
                });
            });
            ws.getColumn(1).width = 46;
            st.columns.forEach(function (_, i) { ws.getColumn(i + 2).width = 15; });
            ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4 }];
            ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
        });
        wb.xlsx.writeBuffer().then(function (buf) {
            FL.download((title || 'statements').replace(/[^\w -]+/g, '') + ' ' + FL.periodName(FL.filter.period) + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        });
    };
})();
