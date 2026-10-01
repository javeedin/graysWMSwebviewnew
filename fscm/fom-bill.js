/* Fusion Order Management — billing (spec §3.0.6 AR invoice drill, §3.0.9 AutoInvoice through erpintegrations)
   + the Settings view (hard-coded business values of the source made configurable, stored per PC). */

// ── AR invoice dialog (§3.0.6) ─────────────────────────────────
FOM.arCalc = function (h, lines, dists) {
    var lt = function (l) { return String(FOM.pf(l, ['LineType', 'TransactionLineType', 'LineTypeCode']) || 'LINE').toUpperCase(); };
    var la = function (l) { return FOM.n(FOM.pf(l, ['LineAmount', 'Amount', 'ExtendedAmount', 'RevenueAmount'])); };
    var prod = lines.filter(function (l) { return !/TAX|FREIGHT|CHARGE/.test(lt(l)); });
    var linesAmt = FOM.sum(prod, la), tax, freight, charges, total;
    if (dists.length) {
        var cls = function (d) { return String(FOM.pf(d, ['AccountClass', 'AccountClassCode', 'ClassCode', 'AccountClassMeaning']) || '').toUpperCase(); };
        var amt = function (d) { return Math.abs(FOM.n(FOM.pf(d, ['Amount', 'AccountedAmount', 'AmountDr', 'DistributionAmount', 'LineAmount']))); };
        var by = function (re) { return FOM.sum(dists.filter(function (d) { return re.test(cls(d)); }), amt); };
        tax = by(/TAX/); freight = by(/FREIGHT/); charges = by(/CHARGE/); total = by(/REC/);
    } else {
        tax = FOM.num(FOM.pf(h, ['TaxAmount', 'TotalTax'])); if (tax == null) tax = FOM.sum(lines.filter(function (l) { return /TAX/.test(lt(l)); }), la);
        freight = FOM.n(FOM.pf(h, ['FreightAmount', 'Freight'])); charges = FOM.n(FOM.pf(h, ['ChargeAmount', 'Charges']));
        total = FOM.num(FOM.pf(h, ['TransactionTotal', 'InvoiceAmount', 'TotalAmount', 'EnteredAmount'])); if (total == null) total = linesAmt + tax + freight + charges;
    }
    return { lines: linesAmt, tax: tax, freight: freight, charges: charges, total: total, prod: prod, ccy: FOM.pf(h, ['InvoiceCurrencyCode', 'CurrencyCode']) || '' };
};
FOM.arInvoiceDlg = function (txn) {
    var d = FOM.dlg({ title: '<i class="fa-solid fa-file-invoice-dollar"></i> AR invoice ' + esc(txn), xwide: true, body: '<div data-b><i class="fa-solid fa-circle-notch fa-spin"></i> Reading receivables invoice…</div>', buttons: [{ label: 'Reload', act: 'reload' }, { label: 'Close', act: 'close' }], onAction: function (a) { if (a === 'reload') { load(); return false; } } });
    function load() {
        var b = d.q('[data-b]'); b.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Reading receivables invoice…';
        FX.get('receivablesInvoices', { q: 'TransactionNumber=' + FOM.qv(txn), limit: 1, onlyData: false }).then(function (j) {
            var h = (j.items || [])[0];
            if (!h) { b.innerHTML = '<div class="empty"><i class="fa-solid fa-file-circle-question"></i>No AR invoice found for transaction ' + esc(txn) + '</div>'; return; }
            var lh = FOM.link(h, 'receivablesInvoiceLines') || 'receivablesInvoices/' + h.CustomerTransactionId + '/child/receivablesInvoiceLines';
            return FOM.all(lh, { onlyData: false, limit: 500 }).catch(function () { return []; }).then(function (lines) {
                var dl = (h.links || []).filter(function (x) { return x.rel === 'child' && /account|distribut|journal/i.test(x.name || ''); })[0];
                var dp = dl ? FOM.all(dl.href, { limit: 500 }) : FOM.mapLimit(lines, 6, function (l) { var x = (l.links || []).filter(function (k) { return k.rel === 'child' && /account|distribut|journal/i.test(k.name || ''); })[0]; return x ? FOM.all(x.href, { limit: 500 }) : []; }).then(function (c) { return [].concat.apply([], c.filter(Array.isArray)); });
                return dp.catch(function () { return []; }).then(function (dists) { render(h, lines, dists); });
            });
        }).catch(function (e) { b.innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
    }
    function render(h, lines, dists) {
        var c = FOM.arCalc(h, lines, dists), ccy = c.ccy;
        var so = h.SalesOrderNumber || FOM.pf(c.prod[0] || {}, ['SalesOrderNumber', 'SalesOrder', 'InterfaceLineAttribute1']);
        var f = function (l, v) { return v != null && v !== '' ? '<div><span>' + l + '</span>' + v + '</div>' : ''; };
        var html = '<div class="fom-split"><div><h4>General information</h4><div class="facts">' +
            f('Business Unit', esc(FOM.pf(h, ['BusinessUnit', 'BusinessUnitName']))) + f('Transaction Source', esc(FOM.pf(h, ['TransactionSource', 'TransactionBatchSource', 'BatchSource', 'TransactionSourceName']))) + f('Transaction Type', esc(FOM.pf(h, ['TransactionType', 'TransactionTypeName']))) +
            f('Transaction Number', '<b>' + esc(h.TransactionNumber) + '</b>') + f('Sales Order', esc(so)) + f('Status', FOM.chip(FOM.pf(h, ['Status', 'TransactionStatus', 'PaymentStatus', 'StatusCode']))) +
            f('Transaction Date', esc(FOM.d(h.TransactionDate))) + f('Accounting Date', esc(FOM.d(FOM.pf(h, ['AccountingDate', 'GlDate'])))) + f('Currency', esc(ccy)) + f('Comments', esc(h.Comments)) + '</div>' +
            '<h4 style="margin-top:12px">Customer</h4><div class="facts">' + f('Bill-to Name', esc(h.BillToCustomerName)) + f('Bill-to Site', esc(FOM.pf(h, ['BillToSite', 'BillToCustomerSiteNumber', 'BillToSiteNumber', 'BillToCustomerAccountSiteId']))) + f('Ship-to Name', esc(h.ShipToCustomerName)) + f('Ship-to Site', esc(FOM.pf(h, ['ShipToSite', 'ShipToCustomerSiteNumber', 'ShipToSiteNumber']))) + '</div>' +
            '<h4 style="margin-top:12px">Payment</h4><div class="facts">' + f('Payment Terms', esc(FOM.pf(h, ['PaymentTerms', 'PaymentTermsName']))) + f('Due Date', esc(FOM.d(FOM.pf(h, ['DueDate', 'PaymentDueDate'])))) + '</div></div>' +
            '<div class="fom-totbox"><div class="fom-tot grand"><span>Transaction Total</span><b>' + FOM.amt(c.total, ccy) + '</b></div><div class="fom-tot"><span>Lines</span><b>' + FOM.amt(c.lines) + '</b></div><div class="fom-tot"><span>Tax</span><b>' + FOM.amt(c.tax) + '</b></div><div class="fom-tot"><span>Freight</span><b>' + FOM.amt(c.freight) + '</b></div><div class="fom-tot"><span>Charges</span><b>' + FOM.amt(c.charges) + '</b></div>' + (dists.length ? '<div class="muted" style="font-size:.7rem">From ' + dists.length + ' accounting distribution(s)</div>' : '') + '</div></div>' +
            '<div class="row-btns"><h4 style="margin:0">Invoice lines</h4><span class="grow"></span><button class="btn sm" data-acc' + (dists.length ? '' : ' disabled') + '><i class="fa-solid fa-book"></i> View Accounting (' + dists.length + ')</button><button class="btn sm" data-af><i class="fa-solid fa-list"></i> All fields</button></div>' +
            FOM.table(lines, [
                { label: 'Line', html: function (l) { return esc(FOM.pf(l, ['LineNumber', 'CustomerTrxLineNumber'])); } }, { label: 'Item', html: function (l) { return '<span class="mono">' + esc(FOM.pf(l, ['ItemNumber', 'InventoryItemNumber', 'Item'])) + '</span>'; } },
                { label: 'Description', html: function (l) { return esc(FOM.pf(l, ['Description', 'LineDescription'])); } }, { label: 'UOM', html: function (l) { return esc(FOM.pf(l, ['UnitOfMeasure', 'UOM', 'UOMCode'])); } },
                { label: 'Quantity', n: 1, html: function (l) { return FOM.qty(FOM.pf(l, ['Quantity', 'InvoicedQuantity'])); } }, { label: 'Unit Price', n: 1, html: function (l) { return FOM.amt(FOM.pf(l, ['UnitSellingPrice', 'UnitPrice', 'UnitStandardPrice'])); } },
                { label: 'Amount', n: 1, html: function (l) { return FOM.amt(FOM.pf(l, ['LineAmount', 'Amount', 'ExtendedAmount', 'RevenueAmount'])); } }, { label: 'Sales Order', html: function (l) { return esc(FOM.pf(l, ['SalesOrderNumber', 'SalesOrder', 'InterfaceLineAttribute1'])); } },
                { label: 'Date', html: function (l) { return esc(FOM.d(FOM.pf(l, ['SalesOrderDate', 'LineDate', 'RuleStartDate']))); } }, { label: 'Ship-to', html: function (l) { return esc(FOM.pf(l, ['ShipToCustomerName', 'ShipToCustomer'])); } }, { label: 'Tax Class', html: function (l) { return esc(FOM.pf(l, ['TaxClassificationCode', 'TaxClassification'])); } }
            ], { empty: 'No lines returned.', foot: ['', '', '', 'Total', { n: 1, v: FOM.qty(FOM.sum(lines, function (l) { return FOM.pf(l, ['Quantity', 'InvoicedQuantity']); })) }, '', { n: 1, v: FOM.amt(FOM.sum(lines, function (l) { return FOM.pf(l, ['LineAmount', 'Amount', 'ExtendedAmount', 'RevenueAmount']); })) }, '', '', '', ''] });
        var b = d.q('[data-b]'); b.innerHTML = html;
        b.querySelector('[data-af]').onclick = function () { FOM.allFields(h, 'AR invoice ' + h.TransactionNumber); };
        b.querySelector('[data-acc]').onclick = function () { FOM.dlg({ title: 'Accounting — ' + esc(h.TransactionNumber), xwide: true, body: FOM.table(dists, FOM.dyn(dists)) }); };
    }
    load();
};

// ── AutoInvoice (§3.0.9) ───────────────────────────────────────
FOM.AI_PARAMS = ['Number of Workers', 'Business Unit', 'Transaction Source', 'Default Date', 'Transaction Type', 'From Customer', 'To Customer', 'From Customer Account Number', 'To Customer Account Number', 'From Accounting Date', 'To Accounting Date', 'From Ship Date', 'To Ship Date', 'From Transaction Number', 'To Transaction Number', 'From Sales Order Number', 'To Sales Order Number', 'From Transaction Date', 'To Transaction Date', 'From Ship-to Customer Account Number', 'To Ship-to Customer Account Number', 'From Ship-to Customer Name', 'To Ship-to Customer Name', 'Base Due Date on Transaction Date', 'Due Date Adjustment Days', 'Load Request ID'];
FOM.essStatusChip = function (s) { var u = String(s || '').toUpperCase(); var c = /SUCCEED/.test(u) ? 'ok' : /ERROR|WARN/.test(u) ? 'err' : /RUN|WAIT|READY|PEND/.test(u) ? 'warn' : 'info'; return s ? '<span class="chip ' + c + '">' + (c === 'warn' ? '<i class="fa-solid fa-circle-notch fa-spin"></i> ' : '') + esc(s) + '</span>' : ''; };
FOM.essStatus = function (id) { return FX.get('erpintegrations', { finder: 'ESSJobStatusRF;requestId=' + id, limit: 1 }).then(function (j) { return ((j.items || [])[0] || {}).RequestStatus || ''; }); };
FOM.aiReqs = function () { return lsGet('fom_ai_reqs', []) || []; };
FOM.aiRemember = function (r) { var l = FOM.aiReqs().filter(function (x) { return x.id !== r.id; }); l.unshift(r); lsSet('fom_ai_reqs', l.slice(0, 40)); };
/** Renders the AutoInvoice form into el. preset: {orderNo, buId} */
FOM.autoInvoicePanel = function (el, preset) {
    preset = preset || {};
    var vals = FOM.AI_PARAMS.map(function () { return ''; });
    vals[0] = '1'; vals[1] = preset.buId ? String(preset.buId) : ''; vals[2] = String(FOM.cfg('aiSourceId')); vals[3] = FX.today(); vals[15] = preset.orderNo || ''; vals[16] = preset.orderNo || ''; vals[23] = 'Y';
    el.innerHTML = '<div class="form"><label>Job package<input data-pk value="' + esc(FOM.cfg('aiPackage')) + '"></label><label>Job definition<input data-jd value="' + esc(FOM.cfg('aiJob')) + '"></label>' +
        '<label>Business Unit<select data-bu><option value="">All business units</option></select></label></div>' +
        '<details class="fom-det" open><summary>Parameters (26, blank → #NULL)</summary><div class="form fom-ai">' + FOM.AI_PARAMS.map(function (p, i) { return '<label>' + (i + 1) + '. ' + esc(p) + (i === 2 ? ' <b class="r">*</b>' : '') + '<input data-p="' + i + '" value="' + esc(vals[i]) + '"' + (/Date$/.test(p) && i !== 23 ? ' placeholder="YYYY-MM-DD"' : '') + '></label>'; }).join('') + '</div></details>' +
        '<div class="row-btns"><button class="btn primary" data-go><i class="fa-solid fa-paper-plane"></i> Submit AutoInvoice</button><button class="btn" data-st disabled><i class="fa-solid fa-rotate"></i> Refresh status</button><button class="btn" data-cp disabled><i class="fa-regular fa-copy"></i> Copy request</button><span data-sc></span><span class="grow"></span><span class="muted mono" data-rid></span></div><div data-out></div>';
    var reqId = null, q = function (s) { return el.querySelector(s); };
    FOM.bus().then(function (l) { q('[data-bu]').innerHTML = '<option value="">All business units</option>' + FOM.opts(l, vals[1]); }).catch(function () { });
    q('[data-bu]').onchange = function () { q('[data-p="1"]').value = this.value; };
    function args() { return FOM.AI_PARAMS.map(function (p, i) { var v = q('[data-p="' + i + '"]').value.trim(); return v === '' ? '#NULL' : v; }).join(','); }
    function status() {
        if (!reqId) return;
        q('[data-sc]').innerHTML = FOM.essStatusChip('CHECKING');
        FOM.essStatus(reqId).then(function (s) { q('[data-sc]').innerHTML = FOM.essStatusChip(s || 'UNKNOWN'); FOM.aiRemember({ id: reqId, order: q('[data-p="15"]').value, at: new Date().toISOString(), status: s }); }).catch(function (e) { q('[data-sc]').innerHTML = '<span class="chip err">' + esc(FOM.emsg(e)) + '</span>'; });
    }
    q('[data-st]').onclick = status;
    q('[data-cp]').onclick = function () { FOM.copy(String(reqId)); };
    q('[data-go]').onclick = function () {
        if (!q('[data-p="2"]').value.trim()) { FX.toast('Transaction Source is required', 'err'); return; }
        var body = { OperationName: 'submitESSJobRequest', JobPackageName: q('[data-pk]').value.trim(), JobDefName: q('[data-jd]').value.trim(), ESSParameters: args() };
        var btn = this; btn.disabled = true; q('[data-out]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting…';
        FOM.raw('POST', 'erpintegrations', { contentType: 'json' }, body).then(function (r) {
            btn.disabled = false;
            var j = r.json || {}, id = FOM.pf(j, ['ReqstId', 'reqstId', 'RequestId', 'DocumentId']);
            q('[data-out]').innerHTML = '<details><summary class="muted" style="font-size:.76rem;cursor:pointer">Raw response (HTTP ' + r.status + ')</summary><pre class="json">' + esc(r.text || '') + '</pre></details>';
            if (!r.ok || !id || String(id) === '-1') { q('[data-out]').insertAdjacentHTML('afterbegin', '<div class="note err" style="white-space:pre-wrap">AutoInvoice was not submitted.\n' + esc(r.ok ? 'No request id in the response.' : FOM.errs(r.json, r.text, r.status).join('\n')) + '</div>'); return; }
            reqId = id; q('[data-rid]').textContent = 'Request ' + id; q('[data-st]').disabled = false; q('[data-cp]').disabled = false;
            FOM.aiRemember({ id: id, order: q('[data-p="15"]').value, at: new Date().toISOString(), status: 'SUBMITTED' });
            FX.toast('AutoInvoice submitted — request ' + id, 'ok'); setTimeout(status, 2500);
            if (preset.onSubmit) preset.onSubmit(id);
        }).catch(function (e) { btn.disabled = false; q('[data-out]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
    };
};
FOM.autoInvoiceDlg = function (orderNo, buId) {
    var d = FOM.dlg({ title: '<i class="fa-solid fa-file-invoice"></i> Push to AR — AutoInvoice for order ' + esc(orderNo), xwide: true, body: '<div data-ai></div>' });
    FOM.autoInvoicePanel(d.q('[data-ai]'), { orderNo: orderNo, buId: buId });
};
FOM.viewAutoInvoice = function (el) {
    el.innerHTML = '<div class="card pad"><div data-ai></div></div><div class="card pad"><div class="row-btns"><b><i class="fa-solid fa-clock-rotate-left" style="color:var(--accent)"></i> Recent AutoInvoice requests (this PC)</b><span class="grow"></span><button class="btn sm" data-rf><i class="fa-solid fa-rotate"></i> Refresh all</button></div><div data-rl style="margin-top:8px"></div></div>';
    function list() {
        var l = FOM.aiReqs();
        el.querySelector('[data-rl]').innerHTML = FOM.table(l, [{ f: 'id', label: 'Request', mono: 1 }, { f: 'order', label: 'Sales order' }, { label: 'Submitted', html: function (r) { return esc(FOM.dt(r.at)); } }, { label: 'Status', html: function (r) { return FOM.essStatusChip(r.status); } }], { empty: 'No requests submitted from this PC yet.', icon: 'fa-file-invoice' });
    }
    FOM.autoInvoicePanel(el.querySelector('[data-ai]'), { onSubmit: function () { setTimeout(list, 300); } });
    el.querySelector('[data-rf]').onclick = function () {
        var l = FOM.aiReqs().slice(0, 15);
        FOM.mapLimit(l, 3, function (r) { return FOM.essStatus(r.id).then(function (s) { r.status = s || r.status; }); }).then(function () { var all = FOM.aiReqs(); l.forEach(function (r) { all.forEach(function (a) { if (a.id === r.id) a.status = r.status; }); }); lsSet('fom_ai_reqs', all); list(); });
    };
    list();
};
FOM.viewArInvoices = function (el) {
    FX.grid(el, {
        id: 'far', pageSize: 50, csvName: 'ar_invoices', resource: 'receivablesInvoices', orderBy: 'TransactionDate:desc',
        filters: [
            { id: 'txn', label: 'Transaction #', q: function (v) { return 'TransactionNumber=' + FOM.qv(v); } },
            { id: 'cust', label: 'Bill-to customer', ph: 'contains', q: function (v) { return "UPPER(BillToCustomerName) LIKE '%" + v.toUpperCase().replace(/'/g, "''") + "%'"; } },
            { id: 'from', label: 'Date from', type: 'date', value: FX.daysAgo(30), q: function (v) { return "TransactionDate>='" + v + "'"; } },
            { id: 'to', label: 'Date to', type: 'date', q: function (v) { return "TransactionDate<='" + v + "'"; } },
            { id: 'bu', label: 'Business unit', type: 'lov', lov: function () { return FOM.bus().then(function (l) { return l.map(function (b) { return { v: b.t, t: b.t }; }); }); }, q: function (v) { return 'BusinessUnit=' + FOM.qv(v); } }
        ],
        columns: [
            { f: 'TransactionNumber', label: 'Transaction #', html: function (r) { return '<a class="fom-a">' + esc(r.TransactionNumber) + '</a>'; } }, { f: 'TransactionDate', label: 'Date', html: function (r) { return esc(FOM.d(r.TransactionDate)); } },
            { f: 'TransactionType', label: 'Type' }, { f: 'TransactionSource', label: 'Source' }, { f: 'BillToCustomerName', label: 'Bill-to' }, { f: 'BusinessUnit', label: 'BU' },
            { label: 'Currency', get: function (r) { return FOM.pf(r, ['InvoiceCurrencyCode', 'CurrencyCode']); } }, { label: 'Amount', n: 1, get: function (r) { return FOM.num(FOM.pf(r, ['EnteredAmount', 'TransactionTotal', 'InvoiceAmount'])); }, html: function (r) { return FOM.amt(FOM.pf(r, ['EnteredAmount', 'TransactionTotal', 'InvoiceAmount'])); } },
            { label: 'Balance', n: 1, get: function (r) { return FOM.num(FOM.pf(r, ['InvoiceBalanceAmount', 'BalanceDue'])); }, html: function (r) { return FOM.amt(FOM.pf(r, ['InvoiceBalanceAmount', 'BalanceDue'])); } },
            { label: 'Status', html: function (r) { return FOM.chip(FOM.pf(r, ['TransactionStatus', 'Status', 'PaymentStatus'])); } }
        ],
        kpis: function (rows) { var amt = FOM.sum(rows, function (r) { return FOM.pf(r, ['EnteredAmount', 'TransactionTotal', 'InvoiceAmount']); }), bal = FOM.sum(rows, function (r) { return FOM.pf(r, ['InvoiceBalanceAmount', 'BalanceDue']); }); return [{ k: 'n', label: 'Invoices', value: rows.length }, { k: 'a', label: 'Amount', value: FOM.amt(amt) }, { k: 'b', label: 'Open balance', value: FOM.amt(bal), filter: function (r) { return FOM.n(FOM.pf(r, ['InvoiceBalanceAmount', 'BalanceDue'])) > 0; } }]; },
        onRow: function (r) { FOM.arInvoiceDlg(r.TransactionNumber); }
    });
};

// ── Settings view ──────────────────────────────────────────────
FOM.SETTINGS = [
    ['Orders', [['orderType', 'Default order type (Register New Order)'], ['srcSystem', 'Source transaction system'], ['cancelReason', 'Cancel reason code'], ['returnReason', 'Default return reason'], ['currencies', 'Transaction currencies (comma separated)'], ['taxCodes', 'Tax codes "CODE=pct, …" (blank = Fusion ZX_RATES_B)']]],
    ['Shipping & billing', [['shipConfirmRule', 'Ship confirm rule'], ['aiSourceId', 'AutoInvoice transaction source id'], ['aiPackage', 'AutoInvoice job package'], ['aiJob', 'AutoInvoice job definition']]],
    ['Branch sales → branch PO', [['buyer', 'PO buyer'], ['poPrefix', 'Branch PO number prefix'], ['soPrefixStrip', 'Sales order prefix replaced by it'], ['needByDays', 'Need-by date (days from today)']]],
    ['Customers & POS', [['bipCustomer', 'Customer search BI Publisher report'], ['custSqlFallback', 'Fall back to Fusion SQL (HZ_ tables) when the report fails (Y/N)'], ['companyName', 'Company name on receipts / printouts'], ['posSubmit', 'POS: submit order on completion (Y/N)'], ['posSilent', 'POS: print receipt straight after the sale (Y/N)']]]
];
FOM.viewSettings = function (el) {
    el.innerHTML = '<div class="card pad"><div class="note">These values were hard-coded in the source app. They are stored on this PC only (localStorage) — blank = the default shown in grey.</div></div>' +
        FOM.SETTINGS.map(function (s) { return '<div class="card pad"><h4>' + esc(s[0]) + '</h4><div class="form">' + s[1].map(function (f) { var v = (lsGet('fom_settings', {}) || {})[f[0]]; return '<label class="' + (f[0] === 'taxCodes' || f[0] === 'bipCustomer' || f[0] === 'aiPackage' ? 'wide' : '') + '">' + esc(f[1]) + '<input data-k="' + f[0] + '" value="' + esc(v == null ? '' : v) + '" placeholder="' + esc(FOM.DEFAULTS[f[0]]) + '"></label>'; }).join('') + '</div></div>'; }).join('') +
        '<div class="row-btns"><button class="btn primary" data-sv><i class="fa-solid fa-floppy-disk"></i> Save settings</button><button class="btn" data-rs><i class="fa-solid fa-rotate-left"></i> Reset to defaults</button><span class="grow"></span><button class="btn" data-tl><i class="fa-solid fa-stethoscope"></i> Test lookups</button></div><div data-tr></div>';
    el.querySelector('[data-sv]').onclick = function () { var o = {}; Array.prototype.forEach.call(el.querySelectorAll('[data-k]'), function (i) { o[i.getAttribute('data-k')] = i.value.trim(); }); FOM.setCfg(o); FOM.memo = {}; FX.toast('Settings saved.', 'ok'); };
    el.querySelector('[data-rs]').onclick = function () { FOM.confirm('Reset settings', 'Clear every Order Management setting on this PC?', 'Reset', 'warn').then(function (ok) { if (!ok) return; lsSet('fom_settings', {}); FOM.memo = {}; FX.show('settings'); }); };
    el.querySelector('[data-tl]').onclick = function () {
        var out = el.querySelector('[data-tr]'), tests = [['Business units (payablesOptions)', FOM.bus], ['Order types (standardLookups)', FOM.orderTypes], ['Payment terms (RA_TERMS)', FOM.paymentTerms], ['Salespersons (JTF_RS_SALESREPS)', FOM.salesReps], ['Tax codes', FOM.taxCodes], ['Return reasons', FOM.returnReasons], ['Inventory organizations', FOM.orgs]];
        out.innerHTML = '<div class="card pad"><div class="fom-tests">' + tests.map(function (t, i) { return '<div data-t="' + i + '"><i class="fa-solid fa-circle-notch fa-spin"></i> ' + esc(t[0]) + '</div>'; }).join('') + '</div></div>';
        FOM.memo = {};
        tests.forEach(function (t, i) {
            var row = out.querySelector('[data-t="' + i + '"]'), t0 = Date.now();
            t[1]().then(function (l) { row.innerHTML = '<span class="chip ' + (l.length ? 'ok' : 'warn') + '">' + l.length + '</span> ' + esc(t[0]) + ' <span class="muted">· ' + (Date.now() - t0) + ' ms</span>'; }).catch(function (e) { row.innerHTML = '<span class="chip err">failed</span> ' + esc(t[0]) + ' <span class="muted">' + esc(FOM.emsg(e)).slice(0, 200) + '</span>'; });
        });
    };
};
