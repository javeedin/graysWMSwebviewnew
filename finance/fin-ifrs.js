/* Finance Lens — IFRS pack (tab `ifrs`, before Statements; FL.ifrs = IF; engine finance/fin-ifrs-engine.js FIFRS).
   The four primary statements (IAS 1 financial position, profit or loss and OCI by function or nature, changes in equity;
   IAS 7 cash flows, indirect) with comparatives (IAS 34: previous year end / same period last year), notes built from the data
   (policies, revenue, expenses by nature, PPE / ROU / intangibles, income tax, receivables & ECL, borrowings & leases, related
   parties, EPS, segments), automatic checks + a disclosure checklist, the IFRS line of every account (mapping, overrides in
   config.json ifrs.map), settings (entity, presentation, tax rate, shares, policies — config.json ifrs), an AI review of the
   pack against IAS 1 / 7 / 34 through finAsk, Excel (one sheet per statement + notes + checks) and Print / PDF. */
(function () {
    'use strict';
    var I = window.FIFRS; if (!I) return;
    var esc = window.esc;
    var IF = FL.ifrs = { view: FL.ls('ifrs.view', 'sfp'), pack: null };
    var money = function (v) { return v == null || isNaN(v) ? '' : FL.num(v); };
    var cfg = function () { var c = FL.config.ifrs = FL.config.ifrs || {}; c.map = c.map || { sfp: {}, fn: {}, nat: {} }; c.manual = c.manual || {}; return c; };
    var VIEWS = [['sfp', 'Financial position'], ['pl', 'Profit or loss & OCI'], ['soce', 'Changes in equity'], ['cf', 'Cash flows'], ['notes', 'Notes'], ['checks', 'Checks'], ['map', 'Mapping'], ['set', 'Settings']];
    // note numbers in the order they are printed
    IF.NOTES = [['basis', 'Corporate information and basis of preparation'], ['policies', 'Material accounting policies'], ['judgements', 'Critical judgements and estimates'],
        ['revenue', 'Revenue'], ['nature', 'Expenses by nature'], ['assets', 'Property, plant and equipment, right-of-use assets and intangible assets'], ['tax', 'Income tax'],
        ['receivables', 'Trade and other receivables'], ['debt', 'Borrowings and lease liabilities'], ['related', 'Related parties'], ['eps', 'Earnings per share'], ['segments', 'Segment information'], ['events', 'Events after the reporting period']];
    IF.noteNo = function (id) { var i = IF.NOTES.map(function (n) { return n[0]; }).indexOf(id); return i < 0 ? '' : String(i + 1); };
    var LINE_NOTE = { PPE: 'assets', ROU: 'assets', INTANG: 'assets', TR: 'receivables', ICA: 'related', ICL: 'related', LTB: 'debt', STB: 'debt', LL: 'debt', LLC: 'debt', CTL: 'tax', DTL: 'tax', DTA: 'tax', CTA: 'tax', REV: 'revenue', TAX: 'tax', EPS: 'eps' };
    IF.DEF_POLICIES = [
        ['Revenue (IFRS 15)', 'Revenue from the sale of goods is recognised when control passes to the customer, normally on delivery, at the consideration the entity expects to be entitled to, net of discounts, rebates and returns.'],
        ['Inventories (IAS 2)', 'Inventories are measured at the lower of cost and net realisable value. Cost is determined on a weighted average basis and includes the cost of purchase and bringing the inventories to their present location and condition.'],
        ['Property, plant and equipment (IAS 16)', 'Items of property, plant and equipment are stated at cost less accumulated depreciation and impairment. Depreciation is charged on a straight-line basis over the estimated useful lives of the assets.'],
        ['Leases (IFRS 16)', 'At the commencement of a lease the entity recognises a right-of-use asset and a lease liability measured at the present value of the lease payments, except for short-term and low-value leases, which are expensed.'],
        ['Financial assets and expected credit losses (IFRS 9)', 'Trade receivables are measured at amortised cost. The entity applies the simplified approach and measures the loss allowance at lifetime expected credit losses using a provision matrix based on days past due.'],
        ['Foreign currencies (IAS 21)', 'Transactions in foreign currencies are translated at the exchange rate at the date of the transaction; monetary items are retranslated at the closing rate and differences are recognised in profit or loss.'],
        ['Income tax (IAS 12)', 'Income tax comprises current and deferred tax. Deferred tax is recognised on temporary differences between the carrying amounts of assets and liabilities and their tax bases.']];

    FL.TABS.ifrs = {
        render: function (el) {
            IF.el = el;
            if (!(FL.status && FL.status.loaded)) { el.innerHTML = '<div class="empty">Sync a trial balance first (Data › Trial balance sync).</div>'; return; }
            return FL.data().then(function (data) { IF.data = data; IF.build(); IF.paint(); })
                .catch(function (e) { el.innerHTML = '<div class="callout bad">' + esc(String(e && e.message || e)) + '</div>'; });
        }
    };
    IF.build = function () {
        var c = cfg();
        IF.pack = I.build(IF.data, FL.filter.period, { map: c.map, presentation: c.presentation, taxRate: c.taxRate, shares: c.shares });
        return IF.pack;
    };
    IF.currency = function () {
        var l = FL.filter.ledger ? (FL.dims.ledgers || []).filter(function (x) { return x.code === FL.filter.ledger; })[0] : (FL.dims.ledgers || [])[0];
        return (l && l.currency) || ((FL.status || {}).meta || {}).currency || '';
    };
    IF.entity = function () { var c = cfg(); return c.entity || (FL.filter.company ? ((FL.dims.companies || []).filter(function (x) { return x.code === FL.filter.company; })[0] || {}).name || FL.filter.company : (FL.dims.ledgers || []).length ? 'All companies' : 'The Company'); };
    IF.unit = function () { return IF.currency() + (FL.filter.scale > 1 ? ' ' + FL.scaleLabel() : ''); };

    IF.paint = function () {
        var el = IF.el, p = IF.pack, c = cfg();
        if (p.error) { el.innerHTML = '<div class="callout warn">' + esc(p.error) + '</div>'; return; }
        var bad = p.checks.filter(function (x) { return !x.ok && x.sev === 'error'; }).length, warn = p.checks.filter(function (x) { return !x.ok && x.sev !== 'error'; }).length;
        var manualOpen = IF.CHECKLIST.filter(function (x) { return !(c.manual[x[0]] || {}).done; }).length;
        var pers = (FL.dims.periods || []).slice().reverse();
        el.innerHTML = '<div class="card if-head"><div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-start">' +
            '<div class="grow"><div class="muted sm">IFRS financial statements</div><h2 style="margin:2px 0">' + esc(IF.entity()) + '</h2>' +
            '<div class="sm">For the period ended <select id="if-per">' + pers.map(function (x) { return '<option value="' + x.period_seq + '"' + (x.period_seq === FL.filter.period ? ' selected' : '') + '>' + esc(x.period_name) + '</option>'; }).join('') + '</select>' +
            ' · comparatives ' + esc(p.cmpPeriod || 'not loaded') + ' (balance sheet) and the same period last year · amounts in ' + esc(IF.unit()) + ' · ' + esc(FL.filterText()) + '</div></div>' +
            '<div class="row" style="gap:6px;flex-wrap:wrap"><span class="tag ' + (bad ? 'bad' : 'good') + '">' + (bad ? bad + ' check(s) fail' : 'checks pass') + '</span>' + (warn ? '<span class="tag warn">' + warn + ' warning(s)</span>' : '') +
            '<span class="tag">' + manualOpen + ' disclosure item(s) open</span>' +
            '<button class="btn sm" id="if-ai"><i class="fa-solid fa-wand-magic-sparkles"></i> AI review</button><button class="btn sm" id="if-xl"><i class="fa-solid fa-file-excel"></i> Excel</button>' +
            '<button class="btn sm primary" id="if-pr"><i class="fa-solid fa-print"></i> Print / PDF</button></div></div>' +
            '<div class="if-tabs">' + VIEWS.map(function (v) { return '<button class="' + (IF.view === v[0] ? 'on' : '') + '" data-v="' + v[0] + '">' + esc(v[1]) + (v[0] === 'checks' && (bad || warn) ? ' <span class="if-dot ' + (bad ? 'bad' : 'warn') + '"></span>' : '') + '</button>'; }).join('') + '</div></div>' +
            '<div id="if-body"></div><div id="if-ai-out"></div>';
        $('if-per').onchange = function () { FL.setFilter({ period: +this.value }); };
        el.querySelectorAll('.if-tabs button').forEach(function (b) { b.onclick = function () { IF.view = b.dataset.v; FL.lsSet('ifrs.view', IF.view); IF.paint(); }; });
        $('if-ai').onclick = IF.aiReview; $('if-xl').onclick = IF.excel; $('if-pr').onclick = IF.print;
        IF.paintBody();
    };
    IF.paintBody = function () {
        var B = $('if-body'), v = IF.view;
        if (v === 'sfp') B.innerHTML = IF.stmtCard('Statement of financial position', 'as at ' + IF.pack.period, IF.pack.sfp, IF.pack.period, IF.pack.cmpPeriod, 'IAS 1.54');
        else if (v === 'pl') B.innerHTML = IF.stmtCard('Statement of profit or loss and other comprehensive income', 'for the period ' + (IF.pack.pl.cur || ''), IF.pack.pl, 'Current', 'Comparative', 'IAS 1.81A–82A · expenses by ' + IF.pack.pl.presentation);
        else if (v === 'soce') B.innerHTML = IF.soceHtml();
        else if (v === 'cf') B.innerHTML = IF.stmtCard('Statement of cash flows', 'for the period ' + (IF.pack.cf.cur || '') + ' — indirect method', IF.pack.cf, 'Current', 'Comparative', 'IAS 7');
        else if (v === 'notes') { B.innerHTML = IF.notesHtml(); IF.asyncNotes(); }
        else if (v === 'checks') IF.paintChecks(B);
        else if (v === 'map') IF.paintMap(B);
        else IF.paintSettings(B);
        B.querySelectorAll('tr[data-line]').forEach(function (tr) { tr.onclick = function () { IF.lineDrill(tr.dataset.kind, tr.dataset.line); }; });
    };

    // ── statements ──
    IF.rowsHtml = function (st, a, b, withNotes, kind) {
        return '<table class="t if-st"><thead><tr><th></th>' + (withNotes ? '<th class="if-nt">Note</th>' : '') + '<th class="n">' + esc(a) + '</th><th class="n">' + esc(b) + '</th></tr></thead><tbody>' +
            st.rows.map(function (r) {
                if (r.type === 'head' || r.type === 'head2') return '<tr class="if-' + r.type + '"><td colspan="' + (withNotes ? 4 : 3) + '">' + esc(r.label) + '</td></tr>';
                var fmt = r.type === 'eps' ? function (v) { return v == null ? '' : v.toFixed(2); } : money;
                var nt = withNotes && LINE_NOTE[r.id] ? IF.noteNo(LINE_NOTE[r.id]) : '';
                var click = kind && r.type === 'line' && r.id;
                return '<tr class="if-' + r.type + (click ? ' click' : '') + '"' + (click ? ' data-kind="' + kind + '" data-line="' + r.id + '" title="Accounts in this line"' : '') + '><td>' + esc(r.label) + (r.ref ? ' <span class="if-ref">' + esc(r.ref) + '</span>' : '') + (r.note ? '<div class="sm muted">' + esc(r.note) + '</div>' : '') + '</td>' +
                    (withNotes ? '<td class="if-nt">' + nt + '</td>' : '') + '<td class="n">' + fmt(r.cur) + '</td><td class="n">' + (r.cmp == null ? '<span class="muted">—</span>' : fmt(r.cmp)) + '</td></tr>';
            }).join('') + '</tbody></table>';
    };
    IF.stmtCard = function (title, sub, st, a, b, ref) {
        var kind = st === IF.pack.sfp ? 'sfp' : st === IF.pack.pl ? 'pl' : null;
        return '<div class="card if-card"><div class="if-ttl"><h3>' + esc(title) + '</h3><div class="muted sm">' + esc(IF.entity()) + ' · ' + esc(sub) + ' · ' + esc(IF.unit()) + ' · <span class="if-ref">' + esc(ref) + '</span></div></div>' +
            IF.rowsHtml(st, a, b, kind !== null || st === IF.pack.cf, kind) +
            (kind ? '<p class="sm muted">Click a line for the accounts in it (and to move an account to another line). Comparatives: ' + esc(kind === 'sfp' ? 'previous financial year end' : 'same period last year') + '.</p>' : '') +
            (st === IF.pack.cf ? IF.cfFoot() : '') + '</div>';
    };
    IF.cfFoot = function () {
        var v = IF.pack.cf.values.cur; if (!v) return '<div class="callout warn sm">The cash flow needs the previous year end (' + esc(IF.pack.cmpPeriod || '—') + ') synced.</div>';
        return '<div class="callout ' + (Math.abs(v.diff) < 1 ? 'good' : 'bad') + ' sm">' + (Math.abs(v.diff) < 1 ? '✓ Ties to the change in cash and cash equivalents.' : '✗ ' + money(v.diff) + ' does not tie — accounts outside the trial balance, or a trial balance that does not balance.') +
            ' Additions to right-of-use assets and other non-cash investing / financing transactions are disclosed separately (IAS 7.43). Interest paid is presented in financing and interest received in investing activities (policy choice, IAS 7.33).</div>';
    };
    IF.soceHtml = function () {
        var s = IF.pack.soce;
        if (!s.blocks.length) return '<div class="callout warn">The statement of changes in equity needs the previous year end synced.</div>';
        return '<div class="card if-card"><div class="if-ttl"><h3>Statement of changes in equity</h3><div class="muted sm">' + esc(IF.entity()) + ' · ' + esc(IF.unit()) + ' · <span class="if-ref">IAS 1.106</span></div></div>' +
            s.blocks.map(function (b) {
                return '<table class="t if-st if-soce"><thead><tr><th></th>' + s.cols.map(function (c) { return '<th class="n">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                    b.rows.map(function (r) { return '<tr class="if-' + r.type + '"><td>' + esc(r.label) + '</td>' + r.v.map(function (x) { return '<td class="n">' + money(x) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
            }).join('<div style="height:10px"></div>') + '</div>';
    };
    /** Accounts in one line, each with a "move to" select (saved as an override) */
    IF.lineDrill = function (kind, id) {
        var p = IF.pack, key = kind === 'sfp' ? 'sfp' : (p.pl.presentation === 'nature' ? 'nat' : 'fn'), list = kind === 'sfp' ? I.SFP : (key === 'nat' ? I.NAT : I.FN);
        var acc = {}; IF.data.accounts.forEach(function (a) { acc[a.code] = a; });
        var codes = Object.keys(p.map).filter(function (k) { return p.map[k][key] === id; });
        var fa = IF.data.facts.ACTUAL || {}, seq = FL.filter.period;
        var amt = function (k) { var f = fa[k] || {}, pi = IF.data._pi, ix = pi.bySeq[seq], s = 0; if (kind === 'sfp') { for (var j = ix; j >= 0; j--) { var x = f[pi.list[j].period_seq]; if (x) return x[1]; } return 0; } var w = FINE.windowOf({ range: 'YTD' }, pi, seq); for (var q = w.from; q <= w.to; q++) { var y = f[pi.list[q].period_seq]; if (y) s += y[0]; } return s; };
        var lab = (list.filter(function (l) { return l.id === id; })[0] || {}).label || id;
        var opts = function (cur) { return list.map(function (l) { return '<option value="' + l.id + '"' + (l.id === cur ? ' selected' : '') + '>' + esc((l.sec ? I.SECS[l.sec] + ' › ' : '') + l.label) + '</option>'; }).join(''); };
        FL.modal('<i class="fa-solid fa-list"></i> ' + esc(lab), '<p class="sm muted">' + codes.length + ' account(s) · ' + (kind === 'sfp' ? 'closing balance' : 'year to date, debit +') + ' · change the line of an account and Save — it is remembered for every period.</p><div class="scroll" style="max-height:60vh"><table class="t"><thead><tr><th>Account</th><th>Name</th><th>Class</th><th class="n">Amount</th><th>IFRS line</th></tr></thead><tbody>' +
            codes.sort().map(function (k) { var a = acc[k] || {}; return '<tr><td>' + esc(k) + '</td><td>' + esc(a.name || '') + '</td><td class="muted">' + esc(a['class'] || '') + '</td><td class="n">' + money(amt(k)) + '</td><td><select data-c="' + esc(k) + '">' + opts(id) + '</select></td></tr>'; }).join('') + '</tbody></table></div>',
            '<button class="btn sm primary" id="ld-save"><i class="fa-solid fa-check"></i> Save</button>');
        $('ld-save').onclick = function () {
            var m = cfg().map, n = 0;
            $('m-body').querySelectorAll('select[data-c]').forEach(function (s) { if (s.value !== id) { (m[key] = m[key] || {})[s.dataset.c] = s.value; n++; } });
            FL.closeModal(); if (!n) return;
            FL.saveConfig().then(function () { FL.toast(n + ' account(s) moved', 'ok'); IF.build(); IF.paint(); });
        };
    };

    // ── notes ──
    var tbl = function (head, rows, foot) { return '<table class="t if-st"><thead><tr>' + head.map(function (h, i) { return '<th' + (i ? ' class="n"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function (r) { return '<tr' + (r.cls ? ' class="' + r.cls + '"' : '') + '>' + r.c.map(function (x, i) { return '<td' + (i ? ' class="n"' : '') + '>' + x + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody>' + (foot ? '<tfoot><tr>' + foot.map(function (x, i) { return '<td' + (i ? ' class="n"' : '') + '><b>' + x + '</b></td>'; }).join('') + '</tr></tfoot>' : '') + '</table>'; };
    IF.notesHtml = function () {
        var p = IF.pack, n = p.notes, c = cfg(), cur = p.period, cmp = p.pyPeriod || 'Comparative', out = [];
        var note = function (id, body) { out.push('<div class="if-note" id="note-' + id + '"><h4>' + IF.noteNo(id) + '. ' + esc(IF.NOTES.filter(function (x) { return x[0] === id; })[0][1]) + '</h4>' + body + '</div>'); };
        var sum = function (rows, k) { return rows.reduce(function (t, r) { return t + (r[k] || 0); }, 0); };
        note('basis', '<p>' + esc(c.basis || (IF.entity() + ' prepares its financial statements in accordance with IFRS Accounting Standards as issued by the International Accounting Standards Board (IASB). These statements cover the period ended ' + cur + ' and are presented in ' + IF.currency() + ', the functional currency, rounded to the nearest ' + (FL.filter.scale > 1 ? FL.scaleLabel().replace(/s$/, '') : 'unit') + '. They have been prepared on the historical cost basis and on a going concern basis.')) + '</p>');
        note('policies', (c.policies && c.policies.length ? c.policies : IF.DEF_POLICIES).map(function (x) { return '<p><b>' + esc(x[0]) + '.</b> ' + esc(x[1]) + '</p>'; }).join(''));
        note('judgements', '<p>' + esc(c.judgements || 'In applying the accounting policies management makes judgements and estimates — principally the expected credit loss rates on trade receivables, the net realisable value of inventories, the useful lives of property, plant and equipment and the lease terms and discount rates under IFRS 16. Estimates are reviewed on an ongoing basis.') + '</p>');
        note('revenue', '<p class="sm muted">Disaggregation of revenue (IFRS 15.114) by revenue account; by segment see note ' + IF.noteNo('segments') + '.</p>' +
            tbl(['', cur, cmp], n.revenue.map(function (r) { return { c: [esc(r.label), money(r.cur), money(r.cmp)] }; }), ['Total revenue', money(sum(n.revenue, 'cur')), money(sum(n.revenue, 'cmp'))]));
        note('nature', '<p class="sm muted">IAS 1.104 — additional information on the nature of expenses when they are presented by function. Expenses are negative.</p>' +
            tbl(['', cur, cmp], n.nature.map(function (r) { return { c: [esc(r.label), money(r.cur), money(r.cmp)] }; })));
        note('assets', tbl(['', 'Opening NBV', 'Additions less disposals*', 'Depreciation / amortisation', 'Closing NBV', 'Cost', 'Accumulated depreciation'],
            n.assets.map(function (r) { return { c: [esc(r.label), money(r.opening), money(r.additions), money(r.depreciation), '<b>' + money(r.closing) + '</b>', money(r.cost), money(r.accumulated)] }; })) +
            '<p class="sm muted">* Derived from the movement in net book value plus the depreciation charge of the year (depreciation accounts are matched to the asset class by name). Disposals, transfers and impairments are not separately available from the trial balance — complete them from the fixed asset register (IAS 16.73, IFRS 16.53).</p>');
        var t = n.tax;
        note('tax', tbl(['', cur], [{ c: ['Profit before tax', money(t.pbt)] }, { c: ['Tax at the statutory rate' + (t.rate != null ? ' of ' + t.rate + '%' : ' (set the rate in Settings)'), money(t.expected)] },
            { c: ['Effect of non-deductible expenses, exempt income, prior-year and other items', money(t.other)] }, { c: ['<b>Income tax expense</b>', '<b>' + money(t.expense) + '</b>'], cls: 'if-sub' },
            { c: ['Effective tax rate', t.effective == null ? '' : t.effective.toFixed(1) + '%'] }]) +
            '<p class="sm">Balances at ' + esc(cur) + ': current tax liabilities ' + money(t.current.ctl) + ' · current tax assets ' + money(t.current.cta) + ' · deferred tax liabilities ' + money(t.current.dtl) + ' · deferred tax assets ' + money(t.current.dta) + ' (IAS 12.81).</p>');
        note('receivables', '<p>Trade and other receivables in the statement of financial position: ' + money(n.receivables.gl) + ' (' + esc(p.cmpPeriod || '—') + ': ' + money(n.receivables.glCmp) + ').</p><div id="note-ecl" class="sm muted">Reading the latest debtors ageing…</div>');
        note('debt', n.debt.length ? tbl(['', cur, p.cmpPeriod || 'Comparative'], n.debt.map(function (r) { return { c: [esc(r.label), money(r.cur), money(r.cmp)] }; }), ['Total', money(sum(n.debt, 'cur')), money(sum(n.debt, 'cmp'))]) +
            '<p class="sm muted">IFRS 16.58 / IFRS 7.39 require a maturity analysis of lease liabilities and borrowings — add it from the loan and lease schedules.</p>' : '<p>The entity has no borrowings or lease liabilities.</p>');
        note('related', n.related.length ? tbl(['', 'Balance', cur, p.cmpPeriod || 'Comparative'], n.related.map(function (r) { return { c: [esc(r.code + ' ' + r.label), r.side, money(r.cur), money(r.cmp)] }; })) +
            '<p class="sm muted">IAS 24.18 — also disclose the nature of each relationship, the transactions of the period and the compensation of key management personnel (IAS 24.17). Intercompany balances are eliminated on consolidation (IFRS 10.B86).</p>' : '<p>No balances with related parties were identified in the trial balance (accounts classed as intercompany).</p>');
        note('eps', n.eps ? tbl(['', cur, cmp], [{ c: ['Profit attributable to ordinary equity holders', money(n.eps.profit), ''] }, { c: ['Weighted average number of ordinary shares', n.eps.shares.toLocaleString(), ''] },
            { c: ['<b>Basic and diluted earnings per share (' + esc(IF.currency()) + ')</b>', '<b>' + n.eps.basic.toFixed(2) + '</b>', n.eps.cmp == null ? '' : n.eps.cmp.toFixed(2)] }]) +
            '<p class="sm muted">No dilutive instruments — diluted EPS equals basic EPS (IAS 33.66).</p>' : '<p class="callout warn sm">Set the weighted average number of ordinary shares in Settings to show earnings per share (IAS 33 — required for listed entities).</p>');
        note('segments', '<div id="note-seg" class="sm muted">' + (c.segment && c.segment.col ? 'Reading the segments…' : 'Choose the segment that the chief operating decision maker reviews (IFRS 8.5) in Settings — e.g. profit centre or salesperson from the extended segments.') + '</div>');
        note('events', '<p>' + esc(c.events || 'No events have occurred after the reporting period that require adjustment to, or disclosure in, these financial statements (IAS 10). Complete in Settings before issue.') + '</p>');
        return '<div class="card if-card if-notes"><div class="if-ttl"><h3>Notes to the financial statements</h3><div class="muted sm">' + esc(IF.entity()) + ' · ' + esc(IF.unit()) + ' · numbers are built from the trial balance; text is edited in Settings</div></div>' + out.join('') + '</div>';
    };
    IF.asyncNotes = function () {
        var c = cfg();
        // receivables ageing + ECL from the latest debtors snapshot (Working capital › Sync)
        FL.rows("SELECT bucket, SUM(amount) AS amt, COUNT(DISTINCT party_number) AS n, MAX(snapshot_at) AS at FROM fin_wc_parties WHERE kind = 'AR' AND snapshot_at = (SELECT MAX(snapshot_at) FROM fin_wc_parties WHERE kind = 'AR') GROUP BY 1", 50)
            .then(function (rows) {
                var box = $('note-ecl'); if (!box) return;
                if (!rows.length) { box.innerHTML = 'No debtors ageing on this PC — sync debtors on Working capital to add the ageing and the expected credit loss allowance (IFRS 7.35M, IFRS 9.5.5.15).'; return; }
                var rates = FL.wcp && FL.wcp.eclRates ? FL.wcp.eclRates() : {}, ord = ['Current', '1-30', '31-60', '61-90', '91-180', '>180'];
                rows.sort(function (a, b) { var i = ord.indexOf(a.bucket), j = ord.indexOf(b.bucket); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); });
                var tot = 0, ecl = 0;
                box.className = ''; box.innerHTML = '<p class="sm">Ageing of trade receivables and the loss allowance under the simplified approach (provision matrix) at ' + esc(String(rows[0].at).slice(0, 16)) + ':</p>' +
                    tbl(['Days past due', 'Gross carrying amount', 'Expected loss rate', 'Loss allowance'], rows.map(function (r) {
                        var rt = rates[r.bucket] != null ? +rates[r.bucket] : 0, e = Math.max(0, +r.amt) * rt / 100; tot += +r.amt; ecl += e;
                        return { c: [esc(r.bucket), money(+r.amt), rt.toFixed(1) + '%', money(e)] };
                    }), ['Total', money(tot), tot ? (ecl / tot * 100).toFixed(1) + '%' : '', money(ecl)]) + '<p class="sm muted">Rates from Debtors › Expected credit loss (editable there). The ageing comes from the subledger and may differ from the GL balance by timing.</p>';
            }).catch(function () { if ($('note-ecl')) $('note-ecl').textContent = 'No debtors ageing on this PC.'; });
        // segment information (IFRS 8) from the extended segments
        var sg = c.segment, box2 = $('note-seg');
        if (sg && sg.col && sg.ledger && box2) {
            var w = FINE.windowOf({ range: 'YTD' }, IF.data._pi, FL.filter.period), seqs = []; for (var k = w.from; k <= w.to; k++) seqs.push(IF.data._pi.list[k].period_seq);
            var col = String(sg.col).replace(/[^a-z0-9_]/gi, '');
            FL.rows('SELECT e.' + col + " AS v, ANY_VALUE(sv.description) AS name, SUM(CASE WHEN e.account_type = 'R' THEN e.cr - e.dr ELSE 0 END) AS rev, SUM(CASE WHEN e.account_type IN ('R', 'E') THEN e.cr - e.dr ELSE 0 END) AS res " +
                'FROM fin_gl_ext_v e LEFT JOIN fin_tb_ledgers l ON l.ledger_id = e.ledger_id AND l.pod = e.pod LEFT JOIN fin_segment_values sv ON sv.coa_id = l.coa_id AND lower(sv.column_name) = ' + FL.q(col.toLowerCase()) + ' AND sv.value = e.' + col +
                ' WHERE e.ledger_id = ' + (+sg.ledger) + ' AND e.period_seq IN (' + seqs.join(',') + ') GROUP BY 1 HAVING ABS(SUM(e.cr - e.dr)) > 0.5 OR ABS(SUM(CASE WHEN e.account_type = \'R\' THEN e.cr - e.dr ELSE 0 END)) > 0.5 ORDER BY 3 DESC', 500).then(function (rows) {
                if (!rows.length) { box2.textContent = 'No extended-segment rows for these periods.'; return; }
                var top = rows.slice(0, 12), rest = rows.slice(12), tr = 0, tp = 0;
                if (rest.length) top.push({ v: rest.length + ' other', name: '', rev: rest.reduce(function (t, r) { return t + r.rev; }, 0), res: rest.reduce(function (t, r) { return t + r.res; }, 0) });
                box2.className = ''; box2.innerHTML = '<p class="sm">Operating segments by ' + esc(sg.label || col) + ' — revenue and result year to date (IFRS 8.23). Result = income less expenses booked to the segment; unallocated items sit under the blank value.</p>' +
                    tbl(['Segment', 'Revenue', 'Segment result'], top.map(function (r) { tr += +r.rev; tp += +r.res; return { c: [esc((r.v || '(unallocated)') + (r.name ? ' ' + r.name : '')), money(+r.rev), money(+r.res)] }; }), ['Total', money(tr), money(tp)]);
            }).catch(function (e) { box2.textContent = String(e && e.message || e); });
        }
    };

    // ── checks + disclosure checklist ──
    IF.CHECKLIST = [
        ['compliance', 'Explicit and unreserved statement of compliance with IFRS', 'IAS 1.16'], ['goingconcern', 'Going concern assessment for at least 12 months', 'IAS 1.25–26'],
        ['policies', 'Material accounting policy information', 'IAS 1.117'], ['judgements', 'Significant judgements and sources of estimation uncertainty', 'IAS 1.122, 125'],
        ['capital', 'Capital management objectives and policies', 'IAS 1.134'], ['events', 'Events after the reporting period and date of authorisation', 'IAS 10.17, 21'],
        ['contingent', 'Contingent liabilities, commitments and guarantees', 'IAS 37.86'], ['leases', 'Lease maturity analysis and expense of short-term / low-value leases', 'IFRS 16.53, 58'],
        ['fininst', 'Financial risk management: credit, liquidity and market risk', 'IFRS 7.31–42'], ['fairvalue', 'Fair value measurement and hierarchy', 'IFRS 13.93'],
        ['kmp', 'Key management personnel compensation', 'IAS 24.17'], ['consolidation', 'Intercompany balances and transactions eliminated', 'IFRS 10.B86'],
        ['fx', 'Foreign operations translated; translation reserve in OCI', 'IAS 21.39'], ['dividends', 'Dividends proposed or declared after the period', 'IAS 1.137'],
        ['newstd', 'New and amended standards issued but not yet effective', 'IAS 8.30'], ['employee', 'Employee benefit obligations (defined benefit plans)', 'IAS 19.135']];
    IF.paintChecks = function (B) {
        var p = IF.pack, c = cfg();
        B.innerHTML = '<div class="card if-card"><h3>Automatic checks</h3>' + p.checks.map(function (x) {
            return '<div class="if-chk ' + (x.ok ? 'ok' : x.sev) + '"><i class="fa-solid ' + (x.ok ? 'fa-circle-check' : x.sev === 'error' ? 'fa-circle-xmark' : 'fa-triangle-exclamation') + '"></i><div><b>' + esc(x.label) + '</b>' + (!x.ok && x.detail ? '<div class="sm muted">' + esc(x.detail) + '</div>' : '') + '</div></div>';
        }).join('') + IF.multiCoCheck() + '</div>' +
            '<div class="card if-card" style="margin-top:10px"><h3>Disclosure checklist <small class="muted">tick when the disclosure is in the pack or the annual report</small></h3>' +
            IF.CHECKLIST.map(function (x) {
                var m = c.manual[x[0]] || {};
                return '<label class="if-man"><input type="checkbox" data-k="' + x[0] + '"' + (m.done ? ' checked' : '') + '><span><b>' + esc(x[1]) + '</b> <span class="if-ref">' + esc(x[2]) + '</span>' + (m.done ? '<span class="sm muted"> · ' + esc((m.by || '') + ' ' + String(m.at || '').slice(0, 10)) + '</span>' : '') + '</span></label>';
            }).join('') + '</div>';
        B.querySelectorAll('.if-man input').forEach(function (cb) {
            cb.onchange = function () { c.manual[cb.dataset.k] = cb.checked ? { done: true, by: (FL.who || {}).user || '', at: new Date().toISOString() } : { done: false }; FL.saveConfig().then(function () { IF.paint(); }); };
        });
    };
    IF.multiCoCheck = function () {
        var cos = FL.filter.company ? 1 : (FL.dims.companies || []).length, ic = IF.pack.notes.related.length;
        if (cos > 1 && ic) return '<div class="if-chk warn"><i class="fa-solid fa-triangle-exclamation"></i><div><b>Several companies are added together and intercompany balances exist</b><div class="sm muted">These statements are a sum, not a consolidation: intercompany balances and transactions are not eliminated (IFRS 10.B86) and foreign ledgers are not translated (IAS 21). Pick one company in the header for its own statements.</div></div></div>';
        return '';
    };

    // ── mapping ──
    IF.paintMap = function (B) {
        var p = IF.pack, c = cfg(), pres = p.pl.presentation, acc = IF.data.accounts.filter(function (a) { return p.map[a.code]; });
        var fa = IF.data.facts.ACTUAL || {}, pi = IF.data._pi, ix = pi.bySeq[FL.filter.period], w = FINE.windowOf({ range: 'YTD' }, pi, FL.filter.period);
        var amt = function (a) { var f = fa[a.code] || {}; if (p.map[a.code].sfp) { for (var j = ix; j >= 0; j--) { var x = f[pi.list[j].period_seq]; if (x) return x[1]; } return 0; } var s = 0; for (var q = w.from; q <= w.to; q++) { var y = f[pi.list[q].period_seq]; if (y) s += y[0]; } return s; };
        var lineOf = function (a) { var m = p.map[a.code]; return m.sfp ? I.SECS[I.SFP_BY[m.sfp].sec] + ' › ' + I.SFP_BY[m.sfp].label : (pres === 'nature' ? (I.NAT_BY[m.nat] || {}).label : (I.FN_BY[m.fn] || {}).label); };
        B.innerHTML = '<div class="card if-card"><h3>IFRS line of every account <small class="muted">from the account class and name; a change you make is kept for every period · ' + (Object.keys(c.map.sfp).length + Object.keys(c.map.fn).length + Object.keys(c.map.nat).length) + ' override(s)</small>' +
            '<span class="grow"></span><button class="btn sm" id="mp-reset">Reset to defaults</button></h3><div id="mp-grid"></div></div>';
        FL.grid($('mp-grid'), [{ label: 'Account', key: 'code' }, { label: 'Name', key: 'name' }, { label: 'Type', key: 'account_type' }, { label: 'Class', get: function (a) { return a['class'] || ''; } },
            { label: 'Amount', n: 1, money: 1, get: function (a) { return money(amt(a)); }, val: amt },
            { label: 'IFRS line', html: 1, get: function (a) { return esc(lineOf(a)) + (p.map[a.code].overridden ? ' <span class="tag">yours</span>' : ''); }, val: lineOf }],
            acc, { id: 'if-map', csv: 'ifrs-mapping.csv', height: 520, click: function (a) { var m = p.map[a.code]; IF.lineDrill(m.sfp ? 'sfp' : 'pl', m.sfp || (pres === 'nature' ? m.nat : m.fn)); } });
        $('mp-reset').onclick = function () { if (!confirm('Remove every IFRS line you set by hand?')) return; c.map = { sfp: {}, fn: {}, nat: {} }; FL.saveConfig().then(function () { IF.build(); IF.paint(); }); };
    };

    // ── settings ──
    IF.paintSettings = function (B) {
        var c = cfg(), pol = (c.policies && c.policies.length ? c.policies : IF.DEF_POLICIES);
        B.innerHTML = '<div class="card if-card if-set"><h3>Settings of the IFRS pack</h3>' +
            '<label>Entity name <input id="st-ent" value="' + esc(c.entity || '') + '" placeholder="' + esc(IF.entity()) + '"></label>' +
            '<label>Expenses presented by <select id="st-pres"><option value="function"' + (c.presentation !== 'nature' ? ' selected' : '') + '>function (cost of sales method)</option><option value="nature"' + (c.presentation === 'nature' ? ' selected' : '') + '>nature</option></select></label>' +
            '<label>Statutory income tax rate % <input id="st-tax" type="number" step="0.01" value="' + esc(c.taxRate == null ? '' : c.taxRate) + '" style="width:100px"></label>' +
            '<label>Weighted average number of ordinary shares <input id="st-sh" type="number" step="1" value="' + esc(c.shares || '') + '" style="width:160px"></label>' +
            '<label>Segment note — segment the decision maker reviews <select id="st-seg"><option value="">— none —</option></select></label>' +
            '<label>Basis of preparation (blank = standard text)<textarea id="st-basis" rows="3">' + esc(c.basis || '') + '</textarea></label>' +
            '<label>Critical judgements and estimates (blank = standard text)<textarea id="st-judg" rows="3">' + esc(c.judgements || '') + '</textarea></label>' +
            '<label>Events after the reporting period<textarea id="st-ev" rows="2">' + esc(c.events || '') + '</textarea></label>' +
            '<div><b>Accounting policies</b> <span class="sm muted">one per block: title on the first line, text below; blank line between policies</span><textarea id="st-pol" rows="12">' + esc(pol.map(function (x) { return x[0] + '\n' + x[1]; }).join('\n\n')) + '</textarea></div>' +
            '<button class="btn primary" id="st-save"><i class="fa-solid fa-floppy-disk"></i> Save settings</button></div>';
        FL.rows("SELECT DISTINCT s.ledger_id, l.name AS lname, s.segments FROM fin_gl_balances_ext_sync s LEFT JOIN fin_tb_ledgers l ON l.ledger_id = s.ledger_id", 100).then(function (rows) {
            return FL.rows('SELECT DISTINCT coa_id, lower(column_name) AS col, segment_name, role FROM fin_coa_segments', 200).catch(function () { return []; }).then(function (names) {
                var nm = {}, skip = {}; names.forEach(function (n) { nm[n.col] = n.segment_name; if (/^(COMPANY|ACCOUNT)$/i.test(n.role || '')) skip[n.col] = 1; });
                var opts = {}; rows.forEach(function (r) { String(r.segments || '').toLowerCase().split(',').forEach(function (col) { if (/^segment\d+$/.test(col) && !skip[col]) opts[r.ledger_id + '|' + col] = (r.lname || r.ledger_id) + ' · ' + (nm[col] || col.toUpperCase()); }); });
                var cur = c.segment ? c.segment.ledger + '|' + c.segment.col : '';
                $('st-seg').innerHTML = '<option value="">— none —</option>' + Object.keys(opts).map(function (k) { return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + esc(opts[k]) + '</option>'; }).join('');
            });
        }).catch(function () { /* no extended segments */ });
        $('st-save').onclick = function () {
            c.entity = $('st-ent').value.trim(); c.presentation = $('st-pres').value;
            c.taxRate = $('st-tax').value === '' ? null : +$('st-tax').value; c.shares = +$('st-sh').value || null;
            var sv = $('st-seg').value; c.segment = sv ? { ledger: sv.split('|')[0], col: sv.split('|')[1], label: $('st-seg').selectedOptions[0].textContent.split(' · ').pop() } : null;
            c.basis = $('st-basis').value.trim(); c.judgements = $('st-judg').value.trim(); c.events = $('st-ev').value.trim();
            c.policies = $('st-pol').value.split(/\n\s*\n/).map(function (b) { var l = b.trim().split('\n'); return l[0] ? [l[0].trim(), l.slice(1).join(' ').trim()] : null; }).filter(function (x) { return x && x[1]; });
            FL.saveConfig().then(function () { FL.toast('IFRS settings saved', 'ok'); IF.build(); IF.paint(); }).catch(function (e) { FL.toast(String(e && e.message || e), 'err'); });
        };
    };

    // ── AI review against IAS 1 / 7 / 34 ──
    IF.aiReview = function () {
        var p = IF.pack, c = cfg(), box = $('if-ai-out');
        var flat = function (st) { return st.rows.filter(function (r) { return r.type !== 'head' && r.type !== 'head2'; }).map(function (r) { return [r.label, r.cur == null ? null : Math.round(r.cur), r.cmp == null ? null : Math.round(r.cmp)]; }); };
        var ctx = { page: 'IFRS pack', entity: IF.entity(), period: p.period, comparativeBalanceSheet: p.cmpPeriod, currency: IF.currency(), presentation: p.pl.presentation,
            statementOfFinancialPosition: flat(p.sfp), profitOrLossAndOci: flat(p.pl), cashFlows: flat(p.cf), changesInEquity: p.soce.blocks.map(function (b) { return b.rows.map(function (r) { return [r.label].concat(r.v.map(Math.round)); }); }),
            notes: { revenue: p.notes.revenue.slice(0, 15), expensesByNature: p.notes.nature, assets: p.notes.assets, tax: p.notes.tax, debt: p.notes.debt, related: p.notes.related.slice(0, 15), eps: p.notes.eps },
            automaticChecks: p.checks.map(function (x) { return (x.ok ? 'PASS ' : 'FAIL ') + x.label + (x.ok ? '' : ' — ' + x.detail); }),
            disclosureChecklist: IF.CHECKLIST.map(function (x) { return ((c.manual[x[0]] || {}).done ? 'DONE ' : 'OPEN ') + x[1] + ' (' + x[2] + ')'; }),
            mappingOverrides: Object.keys(c.map.sfp).length + Object.keys(c.map.fn).length + Object.keys(c.map.nat).length };
        var q = 'Review this IFRS financial statements pack as an experienced IFRS reporting manager / auditor would before it goes to the board. Check presentation against IAS 1 (line items, current / non-current split, comparatives, OCI), IAS 7 (classification, non-cash items, ties to cash), IAS 34 if interim, IAS 12, IFRS 15, IFRS 16, IFRS 9 / 7, IAS 24, IAS 33 and IFRS 8. ' +
            'Use run_sql on DuckDB (fin_balances, fin_accounts) to look behind any number that looks wrong (e.g. classification of an account). Give: 1) a verdict (ready / ready with fixes / not ready); 2) a table of issues — severity, standard, what is wrong, the fix (and the account to move if a mapping is wrong); 3) missing disclosures; 4) what looks unusual in the numbers. Be specific and concise.';
        box.innerHTML = '<div class="card if-card"><h3><i class="fa-solid fa-wand-magic-sparkles"></i> AI review <small class="muted">against IAS 1 / 7 / 34 and the related standards</small></h3><div class="sm" id="if-ai-st"><i class="fa-solid fa-circle-notch fa-spin"></i> Reviewing… <a id="if-ai-stop">stop</a></div><div id="if-ai-md"></div></div>';
        box.scrollIntoView({ behavior: 'smooth' });
        $('if-ai-stop').onclick = function () { FL.call('finAskCancel', {}).catch(function () { /* ended */ }); };
        FL.call('finAsk', { question: q, history: [], context: JSON.stringify(ctx) }, 11 * 60000, function (m) { if ($('if-ai-st') && m) $('if-ai-st').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> ' + esc(m); })
            .then(function (r) { $('if-ai-st').innerHTML = '<span class="muted">' + (r.costUsd != null ? '$' + (+r.costUsd).toFixed(3) : '') + '</span>'; $('if-ai-md').innerHTML = '<div class="cop-md">' + FL.copilot.md(r.answer || '(no answer)', 880) + '</div>'; })
            .catch(function (e) { $('if-ai-st').innerHTML = '<span class="neg">' + esc(String(e && e.message || e)) + '</span>'; });
    };

    // ── exports ──
    IF.excel = function () {
        if (!window.ExcelJS) { FL.toast('Excel library did not load (internet?)', 'err'); return; }
        var p = IF.pack, wb = new ExcelJS.Workbook(), sc = FL.filter.scale || 1, fmtN = '#,##0;(#,##0);"–"';
        var sheet = function (name, title, sub, st, a, b) {
            var ws = wb.addWorksheet(name);
            ws.addRow([IF.entity()]).font = { bold: true, size: 13 }; ws.addRow([title]).font = { bold: true, size: 12 }; ws.addRow([sub + ' · ' + IF.unit()]).font = { italic: true, color: { argb: 'FF64748B' } }; ws.addRow([]);
            var h = ws.addRow(['', a, b]); h.font = { bold: true };
            st.rows.forEach(function (r) {
                if (r.type === 'head' || r.type === 'head2') { ws.addRow([r.label]).font = { bold: true, italic: r.type === 'head2' }; return; }
                var row = ws.addRow([r.label, r.cur == null ? null : (r.type === 'eps' ? r.cur : Math.round(r.cur / sc)), r.cmp == null ? null : (r.type === 'eps' ? r.cmp : Math.round(r.cmp / sc))]);
                if (r.type !== 'line') row.font = { bold: true };
                [2, 3].forEach(function (k) { row.getCell(k).numFmt = r.type === 'eps' ? '0.00' : fmtN; if (r.type === 'total') row.getCell(k).border = { top: { style: 'thin' }, bottom: { style: 'double' } }; else if (r.type === 'sub') row.getCell(k).border = { top: { style: 'thin' } }; });
            });
            ws.getColumn(1).width = 64; ws.getColumn(2).width = 18; ws.getColumn(3).width = 18;
        };
        sheet('Financial position', 'Statement of financial position', 'as at ' + p.period, p.sfp, p.period, p.cmpPeriod || '');
        sheet('Profit or loss & OCI', 'Statement of profit or loss and other comprehensive income', 'for the period ' + (p.pl.cur || ''), p.pl, 'Current', 'Comparative');
        var ws = wb.addWorksheet('Changes in equity'); ws.addRow([IF.entity()]).font = { bold: true, size: 13 }; ws.addRow(['Statement of changes in equity · ' + IF.unit()]).font = { bold: true };
        p.soce.blocks.forEach(function (b) { ws.addRow([]); ws.addRow([''].concat(p.soce.cols)).font = { bold: true }; b.rows.forEach(function (r) { var row = ws.addRow([r.label].concat(r.v.map(function (x) { return Math.round(x / sc); }))); if (r.type !== 'line') row.font = { bold: true }; for (var k = 2; k <= 5; k++) row.getCell(k).numFmt = fmtN; }); });
        ws.getColumn(1).width = 52; for (var k = 2; k <= 5; k++) ws.getColumn(k).width = 18;
        sheet('Cash flows', 'Statement of cash flows (indirect method)', 'for the period ' + (p.cf.cur || ''), p.cf, 'Current', 'Comparative');
        var wn = wb.addWorksheet('Notes data'); wn.addRow(['Notes — figures from the trial balance · ' + IF.unit()]).font = { bold: true };
        var block = function (t, head, rows) { wn.addRow([]); wn.addRow([t]).font = { bold: true }; wn.addRow(head).font = { bold: true }; rows.forEach(function (r) { var row = wn.addRow(r.map(function (x) { return typeof x === 'number' ? Math.round(x / sc) : x; })); row.eachCell(function (c2, i) { if (i > 1) c2.numFmt = fmtN; }); }); };
        block('Revenue', ['', 'Current', 'Comparative'], p.notes.revenue.map(function (r) { return [r.label, r.cur, r.cmp]; }));
        block('Expenses by nature', ['', 'Current', 'Comparative'], p.notes.nature.map(function (r) { return [r.label, r.cur, r.cmp]; }));
        block('PPE, ROU and intangibles', ['', 'Opening', 'Additions less disposals', 'Depreciation', 'Closing'], p.notes.assets.map(function (r) { return [r.label, r.opening, r.additions, r.depreciation, r.closing]; }));
        block('Borrowings and leases', ['', 'Current', 'Comparative'], p.notes.debt.map(function (r) { return [r.label, r.cur, r.cmp]; }));
        block('Related parties', ['', 'Current', 'Comparative'], p.notes.related.map(function (r) { return [r.code + ' ' + r.label, r.cur, r.cmp]; }));
        wn.getColumn(1).width = 52;
        var wc = wb.addWorksheet('Checks'); wc.addRow(['Check', 'Result', 'Detail']).font = { bold: true };
        p.checks.forEach(function (x) { wc.addRow([x.label, x.ok ? 'PASS' : (x.sev === 'error' ? 'FAIL' : 'WARN'), x.ok ? '' : x.detail]); });
        IF.CHECKLIST.forEach(function (x) { var m = cfg().manual[x[0]] || {}; wc.addRow([x[1] + ' (' + x[2] + ')', m.done ? 'DONE' : 'OPEN', m.done ? (m.by || '') + ' ' + String(m.at || '').slice(0, 10) : '']); });
        wc.getColumn(1).width = 70; wc.getColumn(3).width = 60;
        wb.xlsx.writeBuffer().then(function (buf) { FL.download('IFRS-pack-' + String(p.period).replace(/\W+/g, '-') + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); });
    };
    /** The whole pack as one printable HTML document (cover, four statements, notes) — Print / Save as PDF from the dialog */
    IF.html = function () {
        var p = IF.pack;
        var st = function (t, sub, s, a, b, notes) { return '<section><h2>' + esc(t) + '</h2><p class="sub">' + esc(sub) + ' · ' + esc(IF.unit()) + '</p>' + IF.rowsHtml(s, a, b, notes, null) + '</section>'; };
        var notesNode = document.createElement('div'); notesNode.innerHTML = IF.notesHtml();
        var nEcl = document.getElementById('note-ecl'), nSeg = document.getElementById('note-seg');
        if (nEcl) notesNode.querySelector('#note-ecl').innerHTML = nEcl.innerHTML; if (nSeg) notesNode.querySelector('#note-seg').innerHTML = nSeg.innerHTML;
        return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(IF.entity()) + ' — IFRS financial statements ' + esc(p.period) + '</title><style>' +
            'body{font:12px/1.45 Georgia,"Times New Roman",serif;color:#111;margin:28px 40px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 2px;border-bottom:1px solid #111;padding-bottom:3px}h3{font-size:14px}h4{font-size:13px;margin:14px 0 4px}' +
            '.sub{color:#555;margin:0 0 8px;font-style:italic}section{page-break-after:always;margin-bottom:24px}table{border-collapse:collapse;width:100%}td,th{padding:3px 6px;text-align:left}th{border-bottom:1px solid #111}.n{text-align:right;white-space:nowrap}' +
            '.if-head td,.if-head2 td{font-weight:bold;padding-top:10px}.if-head2 td{font-style:italic;font-weight:normal}.if-sub td{font-weight:bold;border-top:1px solid #999}.if-total td{font-weight:bold;border-top:1px solid #111;border-bottom:3px double #111}.if-ref{display:none}.if-nt{width:40px;text-align:center;color:#555}.muted,.sm{color:#555;font-size:11px}' +
            '.cover{height:80vh;display:flex;flex-direction:column;justify-content:center}.callout{border:1px solid #ccc;padding:6px}.tag,button,select,input{display:none}</style></head><body>' +
            '<section class="cover"><h1>' + esc(IF.entity()) + '</h1><h3>Financial statements prepared in accordance with IFRS Accounting Standards</h3><p>for the period ended ' + esc(p.period) + '</p><p class="sub">Amounts in ' + esc(IF.unit()) + '</p></section>' +
            st('Statement of financial position', 'as at ' + p.period, p.sfp, p.period, p.cmpPeriod || '', true) +
            st('Statement of profit or loss and other comprehensive income', 'for the period ' + (p.pl.cur || ''), p.pl, 'Current', 'Comparative', true) +
            '<section>' + IF.soceHtml().replace(/<div class="card if-card"><div class="if-ttl"><h3>/, '<h2>').replace('</h3><div class="muted sm">', '</h2><p class="sub">').replace(/<\/span><\/div><\/div>/, '</span></p>') + '</section>' +
            st('Statement of cash flows', 'for the period ' + (p.cf.cur || '') + ' — indirect method', p.cf, 'Current', 'Comparative', false) +
            '<section>' + notesNode.innerHTML.replace(/<h3>/, '<h2>').replace('</h3>', '</h2>') + '</section></body></html>';
    };
    IF.print = function () {
        if (IF.view !== 'notes') { IF.view = 'notes'; IF.paint(); setTimeout(IF.print2, 1200); } else IF.print2();
    };
    IF.print2 = function () {
        var html = IF.html(), f = document.createElement('iframe');
        f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f);
        f.onload = function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { FL.download('IFRS-pack.html', new Blob([html], { type: 'text/html' })); } setTimeout(function () { f.remove(); }, 60000); };
        f.srcdoc = html;
        FL.toast('Print dialog: choose "Save as PDF" for a PDF', 'info');
    };
    IF.context = function () { return IF.pack ? { period: IF.pack.period, checks: IF.pack.checks.filter(function (x) { return !x.ok; }).map(function (x) { return x.label; }) } : null; };
})();
