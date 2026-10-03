/* Finance Lens — Trial balance (Statements › Trial balance): every account for the period and filter — opening balance,
   debits, credits, closing balance shown as debit / credit — for the month, quarter, year to date or a chosen range,
   by account, class or type, optionally split by company / cost centre / ledger, with the debits = credits check.
   Straight from fin_balances (no template), so it shows exactly what was loaded; click an account to drill. */
(function () {
    var T = FL.tb = { range: FL.ls('tb.range', 'YTD'), group: FL.ls('tb.group', 'account'), by: FL.ls('tb.by', ''), zero: FL.ls('tb.zero', true), scen: FL.ls('tb.scen', 'ACTUAL') };
    var TYPE = { A: 'Assets', L: 'Liabilities', O: 'Equity', R: 'Revenue', E: 'Expenses' }, ORDER = { A: 1, L: 2, O: 3, R: 4, E: 5 };

    /** The periods of the window ending at the filter period */
    T.window = function () {
        var cur = FL.filter.period, list = FL.dims.periods, i = list.map(function (p) { return p.period_seq; }).indexOf(cur), p = list[i] || {};
        if (T.range === 'MTD') return [cur];
        if (T.range === 'QTD') return list.filter(function (x) { return x.fiscal_year === p.fiscal_year && x.quarter === p.quarter && x.period_seq <= cur; }).map(function (x) { return x.period_seq; });
        if (T.range === 'YTD') return list.filter(function (x) { return x.fiscal_year === p.fiscal_year && x.period_seq <= cur; }).map(function (x) { return x.period_seq; });
        if (T.range === 'LTM') return list.slice(Math.max(0, i - 11), i + 1).map(function (x) { return x.period_seq; });
        return [cur];
    };

    T.render = function (el) {
        var seqs = T.window(); if (!seqs.length) seqs = [FL.filter.period];
        var first = Math.min.apply(null, seqs), last = Math.max.apply(null, seqs);
        var w = FL.where('b').concat(["b.scenario = " + FL.q(T.scen), 'b.period_seq IN (' + seqs.join(',') + ')']);
        var dim = T.by === 'company' ? 'b.company' : T.by === 'cc' ? 'b.cost_centre' : T.by === 'ledger' ? 'b.ledger' : null;
        var sql = 'SELECT ' + (dim ? dim + ' AS dim, ' : '') + 'b.account, ' +
            'SUM(CASE WHEN b.period_seq = ' + first + ' THEN b.begin_bal ELSE 0 END) AS opening, SUM(b.period_dr) AS dr, SUM(b.period_cr) AS cr, ' +
            'SUM(CASE WHEN b.period_seq = ' + last + ' THEN b.end_bal ELSE 0 END) AS closing FROM fin_balances b WHERE ' + w.join(' AND ') + ' GROUP BY ALL';
        return FL.rows(sql, 500000).then(function (rows) {
            var acc = {}; FL.dims.accounts.forEach(function (a) { acc[a.code] = a; });
            // P&L accounts carry no opening balance into a new year; a closing balance still has to come from the last period
            rows.forEach(function (r) { var a = acc[r.account] || {}; r.name = a.name || r.account; r.type = a.account_type || '?'; r.cls = a.class || ''; r.net = r.dr - r.cr; });
            if (T.zero) rows = rows.filter(function (r) { return Math.abs(r.opening) >= 0.005 || Math.abs(r.dr) >= 0.005 || Math.abs(r.cr) >= 0.005 || Math.abs(r.closing) >= 0.005; });
            // group
            var keyOf = T.group === 'class' ? function (r) { return (ORDER[r.type] || 9) + '|' + r.cls; } : T.group === 'type' ? function (r) { return (ORDER[r.type] || 9) + '|' + (TYPE[r.type] || r.type); } : null;
            var lines = rows;
            if (keyOf) {
                var g = {};
                rows.forEach(function (r) {
                    var k = (dim ? r.dim + '§' : '') + keyOf(r), x = g[k] = g[k] || { dim: r.dim, account: '', name: k.split('|')[1] || '(no class)', type: r.type, opening: 0, dr: 0, cr: 0, closing: 0, net: 0, n: 0, sort: k };
                    x.opening += r.opening; x.dr += r.dr; x.cr += r.cr; x.closing += r.closing; x.net += r.net; x.n++;
                });
                lines = Object.keys(g).map(function (k) { return g[k]; });
            }
            lines.sort(function (a, b) { return String(a.dim || '').localeCompare(String(b.dim || '')) || (keyOf ? String(a.sort).localeCompare(String(b.sort)) : String(a.account).localeCompare(String(b.account), undefined, { numeric: true })); });
            var tot = { opening: 0, dr: 0, cr: 0, closing: 0, cdr: 0, ccr: 0 };
            lines.forEach(function (r) { tot.opening += r.opening; tot.dr += r.dr; tot.cr += r.cr; tot.closing += r.closing; if (r.closing >= 0) tot.cdr += r.closing; else tot.ccr -= r.closing; });
            var okMove = Math.abs(tot.dr - tot.cr) < 1, okBal = Math.abs(tot.closing) < 1;
            var f = function (v) { return Math.abs(v) < 0.005 ? '–' : FINE.fmt(v / (FL.filter.scale || 1), 'num', { decimals: FL.filter.scale >= 1000 ? 0 : 2 }); };
            var dc = function (v, side) { return side === 'dr' ? (v > 0.005 ? f(v) : '') : (v < -0.005 ? f(-v) : ''); };
            T.last = { lines: lines, tot: tot, dim: dim };
            var head = (dim ? '<th>' + { 'b.company': 'Company', 'b.cost_centre': 'Cost centre', 'b.ledger': 'Ledger' }[dim] + '</th>' : '') + (keyOf ? '<th>' + (T.group === 'class' ? 'Class' : 'Type') + '</th><th class="n">Accounts</th>' : '<th>Account</th><th>Name</th><th>Type</th><th>Class</th>') +
                '<th class="n">Opening</th><th class="n">Debits</th><th class="n">Credits</th><th class="n">Net movement</th><th class="n">Closing debit</th><th class="n">Closing credit</th>';
            el.innerHTML = '<div class="row toolbar" style="margin-bottom:10px"><div class="seg" id="st-tpls">' + FL.templates.map(function (t) { return '<button data-t="' + esc(t.id) + '">' + esc(t.name) + '</button>'; }).join('') +
                '<button data-t="TB" class="on"><i class="fa-solid fa-scale-balanced"></i> Trial balance</button></div><span class="grow"></span>' +
                '<label class="sm">Range <select id="tb-range">' + [['MTD', 'Month'], ['QTD', 'Quarter to date'], ['YTD', 'Year to date'], ['LTM', 'Last 12 months']].map(function (x) { return '<option value="' + x[0] + '"' + (T.range === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
                '<label class="sm">Show <select id="tb-group">' + [['account', 'every account'], ['class', 'by class'], ['type', 'by type']].map(function (x) { return '<option value="' + x[0] + '"' + (T.group === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
                '<label class="sm">Split <select id="tb-by">' + [['', 'none'], ['company', 'by company'], ['cc', 'by cost centre'], ['ledger', 'by ledger']].map(function (x) { return '<option value="' + x[0] + '"' + (T.by === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
                '<label class="sm">Scenario <select id="tb-scen"><option' + (T.scen === 'ACTUAL' ? ' selected' : '') + '>ACTUAL</option><option' + (T.scen === 'BUDGET' ? ' selected' : '') + '>BUDGET</option></select></label>' +
                '<label class="sm"><input type="checkbox" id="tb-zero"' + (T.zero ? ' checked' : '') + '> hide empty</label>' +
                '<button class="btn sm" id="tb-xl"><i class="fa-solid fa-file-excel"></i> Excel</button><button class="btn sm" id="tb-csv"><i class="fa-solid fa-file-csv"></i> CSV</button><button class="btn sm" onclick="window.print()"><i class="fa-solid fa-print"></i></button></div>' +
                '<div class="stmt-wrap"><div class="stmt-head"><h2>Trial balance</h2><div class="sub">' + esc(FL.filterText()) + ' · ' + esc(FL.periodName(first)) + (first !== last ? ' – ' + esc(FL.periodName(last)) : '') + ' · ' + esc(T.scen.toLowerCase()) + ' · amounts in ' + FL.scaleLabel() + '</div></div>' +
                '<div class="row" style="margin:6px 0 10px"><span class="tag ' + (okMove ? 'good' : 'bad') + '">' + (okMove ? '✓ debits = credits' : '✗ debits ≠ credits: ' + f(tot.dr - tot.cr)) + '</span><span class="tag ' + (okBal ? 'good' : 'bad') + '">' + (okBal ? '✓ closing balances net to nil' : '✗ closing balances net to ' + f(tot.closing)) + '</span>' +
                '<span class="sm muted">' + lines.length.toLocaleString() + ' line(s)' + (FL.filter.cc ? ' · cost centre filter: balance sheet accounts may carry no cost centre' : '') + '</span></div>' +
                '<div class="scroll" style="max-height:66vh"><table class="t tb"><thead><tr>' + head + '</tr></thead><tbody>' +
                lines.map(function (r, i) {
                    return '<tr class="click" data-i="' + i + '">' + (dim ? '<td>' + esc(r.dim) + '</td>' : '') + (keyOf ? '<td>' + esc(r.name) + '</td><td class="n">' + r.n + '</td>' : '<td class="mono">' + esc(r.account) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.type) + '</td><td class="sm muted">' + esc(r.cls) + '</td>') +
                        '<td class="n">' + f(r.opening) + '</td><td class="n">' + f(r.dr) + '</td><td class="n">' + f(r.cr) + '</td><td class="n">' + f(r.net) + '</td><td class="n">' + dc(r.closing, 'dr') + '</td><td class="n">' + dc(r.closing, 'cr') + '</td></tr>';
                }).join('') + '</tbody><tfoot><tr><td colspan="' + ((dim ? 1 : 0) + (keyOf ? 2 : 4)) + '"><b>Total</b></td><td class="n"><b>' + f(tot.opening) + '</b></td><td class="n"><b>' + f(tot.dr) + '</b></td><td class="n"><b>' + f(tot.cr) + '</b></td><td class="n"><b>' + f(tot.dr - tot.cr) + '</b></td>' +
                '<td class="n"><b>' + f(tot.cdr) + '</b></td><td class="n"><b>' + f(tot.ccr) + '</b></td></tr></tfoot></table></div></div>' +
                '<p class="sm muted">Opening = balance at the start of the range (income statement accounts start each fiscal year at nil); closing debit / credit = the closing balance on its side. Click a line to drill to companies, cost centres, months and journal lines.</p>';
            el.querySelectorAll('#st-tpls button').forEach(function (b) { b.onclick = function () { FL.stmt.tpl = b.dataset.t; FL.lsSet('stmt.tpl', b.dataset.t); FL.render(); }; });
            [['tb-range', 'range'], ['tb-group', 'group'], ['tb-by', 'by'], ['tb-scen', 'scen']].forEach(function (x) { $(x[0]).onchange = function () { T[x[1]] = this.value; FL.lsSet('tb.' + x[1], this.value); FL.render(); }; });
            $('tb-zero').onchange = function () { T.zero = this.checked; FL.lsSet('tb.zero', T.zero); FL.render(); };
            $('tb-csv').onclick = function () { FL.csv('trial-balance-' + FL.periodName(last) + '.csv', (dim ? ['split'] : []).concat(['account', 'name', 'type', 'class', 'opening', 'debits', 'credits', 'net', 'closing']), lines.map(function (r) { return (dim ? [r.dim] : []).concat([r.account, r.name, r.type, r.cls, r.opening.toFixed(2), r.dr.toFixed(2), r.cr.toFixed(2), r.net.toFixed(2), r.closing.toFixed(2)]); })); };
            $('tb-xl').onclick = function () { T.excel(first, last); };
            FL.wireRows(el, lines, function (r) {
                if (keyOf) { FL.toast('Show every account to drill', ''); return; }
                var ctx = { tpl: { name: 'Trial balance' }, row: { label: 'Trial balance' }, col: { id: 'tb', scenario: T.scen, range: T.range }, seqs: seqs, label: 'Trial balance ' + FL.periodName(last) };
                if (dim === 'b.company') { var keep = FL.filter.company; FL.filter.company = r.dim; FL.drillAccount(r.account, ctx); FL.filter.company = keep; }
                else FL.drillAccount(r.account, ctx);
            });
        });
    };

    T.excel = function (first, last) {
        if (!window.ExcelJS) { FL.toast('Excel library did not load (internet?)', 'err'); return; }
        var L = T.last, wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Trial balance');
        ws.addRow(['Trial balance']).font = { bold: true, size: 14, color: { argb: 'FF0B2545' } };
        ws.addRow([FL.filterText() + ' · ' + FL.periodName(first) + (first !== last ? ' – ' + FL.periodName(last) : '') + ' · ' + T.scen.toLowerCase()]).font = { italic: true, color: { argb: 'FF64748B' } };
        ws.addRow([]);
        var hdr = (L.dim ? ['Split'] : []).concat(['Account', 'Name', 'Type', 'Class', 'Opening', 'Debits', 'Credits', 'Net movement', 'Closing debit', 'Closing credit']);
        var hr = ws.addRow(hdr); hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        hr.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13315C' } }; });
        var start = ws.rowCount + 1;
        L.lines.forEach(function (r) { ws.addRow((L.dim ? [r.dim] : []).concat([r.account, r.name, r.type, r.cls, r.opening, r.dr, r.cr, r.net, r.closing > 0 ? r.closing : null, r.closing < 0 ? -r.closing : null])); });
        var end = ws.rowCount, off = L.dim ? 1 : 0, col = function (i) { return String.fromCharCode(65 + off + i); };
        var tr = ws.addRow((L.dim ? [''] : []).concat(['Total', '', '', ''].concat([4, 5, 6, 7, 8, 9].map(function (i) { return { formula: 'SUM(' + col(i) + start + ':' + col(i) + end + ')' }; }))));
        tr.font = { bold: true };
        for (var i = 4; i <= 9; i++) { ws.getColumn(off + i + 1).numFmt = '#,##0.00;(#,##0.00);"–"'; ws.getColumn(off + i + 1).width = 16; }
        ws.getColumn(off + 2).width = 40;
        ws.addRow([]);
        ws.addRow(['Check: debits − credits']).getCell(2).value = { formula: col(5) + tr.number + '-' + col(6) + tr.number };
        wb.xlsx.writeBuffer().then(function (buf) { FL.download('trial-balance-' + FL.periodName(last) + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); });
    };
})();
