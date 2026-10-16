/* Setup & Diagnostics — 360° PO Tracker (UAT): one purchase order's header, every child collection, the inventory
   transactions received against it and a PO-vs-receipt variance. Read-only REST through the host relay. */

var SetPo = { num: '', org: lsGet('set_po_org', ''), data: null, tab: 'header', child: {} };

SetPo.HEADER = [['OrderNumber', 'PO Number'], ['POHeaderId', 'PO Header ID'], ['DocumentStatus', 'Status'], ['Supplier', 'Supplier'], ['SupplierNumber', 'Supplier Number'], ['SupplierSite', 'Supplier Site'],
    ['BuyerEmail', 'Buyer Email'], ['Currency', 'Currency'], ['OrderedAmount', 'Ordered Amount'], ['ApprovedDate', 'Approved Date'], ['CreationDate', 'Creation Date'], ['BusinessUnitName', 'Business Unit'],
    ['ProcurementBU', 'Procurement BU'], ['ShipToLocation', 'Ship-To Location'], ['PaymentTerms', 'Payment Terms'], ['Description', 'Description'], ['FreezeFlagMeaning', 'Frozen'], ['HoldFlagMeaning', 'On Hold']];
SetPo.TXN = [['TransactionId', 'Transaction ID'], ['TransactionType', 'Type'], ['TransactionDate', 'Date', 'date'], ['Organization', 'Organization'], ['ItemNumber', 'Item'], ['ItemDescription', 'Description'],
    ['TransactionQuantity', 'Qty', 'n'], ['TransactionUOM', 'UOM'], ['TransactionCost', 'Unit Cost', 'm'], ['TransactionAmount', 'Amount', 'm'], ['PurchaseOrderHeaderId', 'PO Header ID'], ['PurchaseOrderNumber', 'PO Number'],
    ['PurchaseOrderLineNumber', 'PO Line'], ['ReceiptNumber', 'Receipt #'], ['Subinventory', 'Subinventory'], ['Locator', 'Locator'], ['AccountingStatus', 'Acctg Status'],
    ['TransferOrderHeaderNumber', 'Transfer Order'], ['CostGroup', 'Cost Group'], ['ProjectNumber', 'Project'], ['TaskNumber', 'Task'], ['CreatedBy', 'Created By']];

SetPo.render = function (el) {
    SU.headRight(SetPo.data ? '<button class="btn sm" id="sp-x"><i class="fa-solid fa-file-excel"></i> Export Excel</button>' : '');
    if ($('sp-x')) $('sp-x').onclick = SetPo.excel;
    el.innerHTML = '<div class="card"><div class="filters"><label>PO Number<input id="sp-num" placeholder="e.g. 100245" value="' + esc(SetPo.num) + '"></label>' +
        '<label>Organization<select id="sp-org"></select></label>' +
        '<div class="go"><button class="btn primary" id="sp-go"><i class="fa-solid fa-magnifying-glass-chart"></i> Fetch 360°</button></div></div></div><div id="sp-body" class="su-fill"></div>';
    FX.fillSelect('sp-org', FX.lov('orgs'), SetPo.org, 'All organizations');
    $('sp-go').onclick = SetPo.fetch;
    $('sp-num').onkeydown = function (e) { if (e.key === 'Enter') SetPo.fetch(); };
    SetPo.draw();
};

SetPo.fetch = function () {
    var num = $('sp-num').value.trim(), org = $('sp-org').value;
    if (!num) { FX.toast('Enter a PO number.', 'err'); return; }
    SetPo.num = num; SetPo.org = org; lsSet('set_po_org', org);
    SetPo.data = null; SetPo.child = {}; SetPo.tab = 'header';
    $('sp-body').innerHTML = '<div class="card">' + SU.loading('Reading PO ' + num + '…') + '</div>';
    var d = { fetched: new Date(), poUrl: FX.url('purchaseOrders', { q: 'OrderNumber="' + num + '"', limit: 1, onlyData: false }) };
    FX.get('purchaseOrders', { q: 'OrderNumber="' + num + '"', limit: 1, onlyData: false }).then(function (j) {
        var po = (j.items || [])[0];
        if (!po) throw 'No PO found for "' + num + '" on ' + FX.instance + '.';
        d.po = po; d.links = SU.childLinks(po);
        if (po.POHeaderId == null) { d.txns = []; return; }
        // Source bug fixed: the whole q is encoded (FX.url) and all pages are read.
        var q = 'PurchaseOrderHeaderId=' + po.POHeaderId + (org ? ';Organization=' + (/^[A-Za-z0-9_\-]+$/.test(org) ? org : '"' + org.replace(/"/g, '') + '"') : '') + ';TransactionDate>=2010-01-01';
        d.invUrl = FX.url('inventoryCompletedTransactions', { q: q, limit: 500 });
        return FX.restAll('inventoryCompletedTransactions', { q: q, limit: 500 }, 50000).then(function (t) { d.txns = t; }, function (e) { d.txns = []; d.txnErr = String(e); });
    }).then(function () {
        SetPo.data = d; if (FX.cur && FX.cur.id === 'po360') SetPo.render($('fx-view'));
    }).catch(function (e) { if ($('sp-body')) $('sp-body').innerHTML = '<div class="card pad">' + SU.err(e) + '</div>'; });
};

SetPo.sum = function (rows, f) { return rows.reduce(function (a, r) { var v = +r[f]; return a + (isNaN(v) ? 0 : v); }, 0); };
SetPo.draw = function () {
    var body = $('sp-body'), d = SetPo.data;
    if (!d) { body.innerHTML = '<div class="card">' + SU.empty('fa-magnifying-glass-chart', 'Enter a PO number to start the 360° audit', 'Fetches the PO header, all child resources, inventory transactions and a variance analysis.') + '</div>'; return; }
    var po = d.po, cur = po.Currency || '', recv = SetPo.sum(d.txns, 'TransactionAmount'), ord = +po.OrderedAmount || 0;
    var steps = [['Created', true], ['Approved', !!po.ApprovedDate], ['Received', d.txns.length > 0]];
    var tabs = [{ id: 'header', label: 'Header', icon: 'fa-file-lines' }, { id: 'inv', label: 'Receipts / Inventory', icon: 'fa-boxes-stacked', badge: d.txns.length }]
        .concat(d.links.map(function (l) { return { id: 'c:' + l.name, label: SU.humanize(l.name) }; }))
        .concat([{ id: 'variance', label: 'Variance', icon: 'fa-scale-balanced' }, { id: 'raw', label: 'Raw JSON', icon: 'fa-code' }]);
    body.innerHTML = '<div class="card su-po-h"><div><div class="su-po-n">PO ' + esc(po.OrderNumber) + ' ' + FX.chip(po.DocumentStatus) + '</div>' +
        '<div class="muted">' + esc([po.Supplier, po.BusinessUnitName || po.ProcurementBU].filter(Boolean).join(' · ')) + ' · ' + esc(cur) + ' ' + SU.num(ord, 2) + '</div></div><span class="grow"></span>' +
        '<div class="steps">' + steps.map(function (s, i) { return (i ? '<i class="fa-solid fa-chevron-right sep"></i>' : '') + '<span class="st ' + (s[1] ? 'done' : '') + '"><i class="fa-solid ' + (s[1] ? 'fa-check' : 'fa-hourglass-half') + '"></i> ' + s[0] + '</span>'; }).join('') + '</div>' +
        '<div class="su-po-u muted">PO API: <code class="su-code">' + esc(d.poUrl) + '</code> · fetched ' + esc(d.fetched.toLocaleTimeString()) + '</div></div>' +
        '<div class="kpis">' + SU.kpi(esc(cur) + ' ' + SU.num(ord, 2), 'PO amount', 'acc') + SU.kpi(esc(cur) + ' ' + SU.num(recv, 2), 'Received amount', recv ? 'ok' : '') + SU.kpi(d.txns.length, 'Receipt transactions') +
        SU.kpi(esc(cur) + ' ' + SU.num(ord - recv, 2), 'Open (ordered − received)', ord - recv > 0.005 ? 'warn' : '') + '</div>' +
        '<div class="note">Invoiced, paid and GL-posted stages are not read yet (planned: Payables invoices and the PO life-cycle service).</div>' +
        '<div id="sp-tabs">' + SU.tabBar(tabs, SetPo.tab) + '</div><div id="sp-tab" class="card pad su-fill"></div>';
    $('sp-tabs').onclick = function (e) { var b = e.target.closest('[data-sutab]'); if (b) { SetPo.tab = b.getAttribute('data-sutab'); $('sp-tabs').innerHTML = SU.tabBar(tabs, SetPo.tab); SetPo.drawTab(); } };
    SetPo.drawTab();
};

SetPo.drawTab = function () {
    var el = $('sp-tab'), d = SetPo.data, po = d.po, t = SetPo.tab;
    if (t === 'header') {
        el.innerHTML = FX.table(SetPo.HEADER, [{ label: 'Field', get: function (f) { return f[1]; } }, { label: 'API Key', html: function (f) { return '<span class="mono muted">' + esc(f[0]) + '</span>'; } },
            { label: 'Value', html: function (f) { var v = po[f[0]]; return f[0] === 'DocumentStatus' ? FX.chip(v) : f[0] === 'OrderedAmount' ? SU.num(v, 2) : SU.val(v); } }]);
    } else if (t === 'inv') {
        var tx = d.txns, types = {};
        tx.forEach(function (r) { types[r.TransactionType || '—'] = (types[r.TransactionType || '—'] || 0) + 1; });
        el.innerHTML = '<div class="muted" style="font-size:.74rem">Inventory API: <code class="su-code">' + esc(d.invUrl || '') + '</code></div>' + (d.txnErr ? SU.err(d.txnErr) : '') +
            '<div class="kpis">' + SU.kpi(tx.length, 'Transactions') + SU.kpi(SU.num(SetPo.sum(tx, 'TransactionQuantity')), 'Total qty received') + SU.kpi(SU.num(SetPo.sum(tx, 'TransactionAmount'), 2), 'Total amount') +
            '<div class="kpi su-k"><span>By type</span><div class="su-chips">' + (Object.keys(types).map(function (k) { return '<span class="chip">' + esc(k) + ' · ' + types[k] + '</span>'; }).join('') || '—') + '</div></div></div><div id="sp-tx"></div>';
        SU.table($('sp-tx'), { rows: tx, pageSize: 50, empty: 'No inventory transactions found for this PO.', columns: SetPo.TXN.map(function (f) {
            return { k: f[0], label: f[1], n: f[2] === 'n' || f[2] === 'm', html: f[2] === 'm' ? function (r) { return SU.num(r[f[0]], 2); } : f[2] === 'date' ? function (r) { return esc(FX.fmt.dt(r[f[0]])); } : null };
        }), onRow: function (r) { FX.json('Transaction ' + r.TransactionId, r); } });
    } else if (t === 'variance') {
        var recv = SetPo.sum(d.txns, 'TransactionAmount'), ord = +po.OrderedAmount || 0, v = Math.round((ord - recv) * 100) / 100;
        var tag = v === 0 ? '<span class="chip ok">Fully received</span>' : v > 0 ? '<span class="chip warn">Under-received</span>' : '<span class="chip err">Over-received</span>';
        el.innerHTML = '<div class="su-cards"><div class="card su-mcard"><div class="su-mc-h"><i class="fa-solid fa-scale-balanced"></i> PO vs Receipt<span class="grow"></span>' + tag + '</div>' +
            '<div class="su-vrow"><span>PO ordered amount</span><b>' + SU.num(ord, 2) + '</b></div><div class="su-vrow"><span>Received amount</span><b>' + SU.num(recv, 2) + '</b></div>' +
            '<div class="su-vrow tot"><span>Variance</span><b class="' + (v ? 'warn' : 'ok') + '">' + SU.num(v, 2) + '</b></div></div>' +
            '<div class="card su-mcard muted-card"><div class="su-mc-h"><i class="fa-solid fa-file-invoice-dollar"></i> Receipt vs Invoice</div><span class="muted">Not read yet — planned.</span></div>' +
            '<div class="card su-mcard muted-card"><div class="su-mc-h"><i class="fa-solid fa-money-check-dollar"></i> Invoice vs Payment</div><span class="muted">Not read yet — planned.</span></div></div>' +
            '<h4 style="margin-top:12px">Receipt detail</h4><div id="sp-vd"></div>';
        SU.table($('sp-vd'), { rows: d.txns, pageSize: 50, quick: false, empty: 'No receipts.', columns: [
            { k: 'TransactionDate', label: 'Date', html: function (r) { return esc(FX.fmt.dt(r.TransactionDate)); } }, { k: 'TransactionType', label: 'Type' }, { k: 'ItemNumber', label: 'Item' },
            { k: 'TransactionQuantity', label: 'Qty', n: 1 }, { k: 'TransactionUOM', label: 'UOM' }, { k: 'TransactionCost', label: 'Unit Cost', n: 1, html: function (r) { return SU.num(r.TransactionCost, 2); } },
            { k: 'TransactionAmount', label: 'Amount', n: 1, html: function (r) { return SU.num(r.TransactionAmount, 2); } }, { k: 'ReceiptNumber', label: 'Receipt #' }, { k: 'Subinventory', label: 'Subinv' }] });
    } else if (t === 'raw') {
        el.innerHTML = '<div class="row-btns"><button class="btn sm" id="sp-cj"><i class="fa-regular fa-copy"></i> Copy</button></div><pre class="json">' + esc(JSON.stringify(po, null, 2)) + '</pre>';
        $('sp-cj').onclick = function () { SU.copy(JSON.stringify(po, null, 2)); };
    } else SetPo.drawChild(el, t.slice(2), false);
};

SetPo.drawChild = function (el, name, force) {
    var link = SetPo.data.links.filter(function (l) { return l.name === name; })[0]; if (!link) return;
    var c = SetPo.child[name];
    if (!c || force) {
        el.innerHTML = '<div class="muted mono" style="font-size:.72rem">' + esc(link.href) + '</div>' + SU.loading('Reading ' + name + '…');
        SetPo.child[name] = { loading: true };
        SU.getAllUrl(link.href, 20000).then(function (rows) { SetPo.child[name] = { rows: rows, at: new Date() }; }, function (e) { SetPo.child[name] = { error: String(e) }; })
            .then(function () { if (SetPo.tab === 'c:' + name && $('sp-tab')) SetPo.drawChild($('sp-tab'), name, false); });
        return;
    }
    if (c.loading) return;
    var head = '<div class="su-row"><code class="su-code grow">' + esc(link.href) + '</code><button class="btn sm" id="sp-cr"><i class="fa-solid fa-rotate"></i> Refresh</button></div>';
    if (c.error) { el.innerHTML = head + SU.err(c.error); $('sp-cr').onclick = function () { SetPo.drawChild(el, name, true); }; return; }
    var keys = [];
    (c.rows[0] ? Object.keys(c.rows[0]) : []).forEach(function (k) { var v = c.rows[0][k]; if (k !== 'links' && (v == null || typeof v !== 'object') && keys.length < 14) keys.push(k); });
    el.innerHTML = head + '<div class="muted" style="font-size:.76rem">' + c.rows.length + ' record' + (c.rows.length === 1 ? '' : 's') + ' · ' + esc(c.at.toLocaleTimeString()) + '</div><div id="sp-ct"></div>' +
        '<details class="su-det"><summary>Raw JSON</summary><pre class="json">' + esc(JSON.stringify(c.rows.slice(0, 200), null, 2)) + '</pre></details>';
    $('sp-cr').onclick = function () { SetPo.drawChild(el, name, true); };
    SU.table($('sp-ct'), { rows: c.rows, pageSize: 50, sizes: [50, 200, 500], empty: 'No ' + SU.humanize(name).toLowerCase() + '.', columns: keys.map(function (k) { return { k: k, label: SU.humanize(k), mono: true }; }), onRow: function (r) { FX.json(SU.humanize(name), r); } });
};

SetPo.excel = function () {
    var d = SetPo.data; if (!d) return;
    var sheets = [{ name: 'PO Header', aoa: [['Field', 'API Key', 'Value']].concat(SetPo.HEADER.map(function (f) { var v = d.po[f[0]]; return [f[1], f[0], v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v]; })) }];
    if (d.txns.length) sheets.push({ name: 'Receipts & Inventory', aoa: SU.aoa(d.txns, [['TransactionId', 'Transaction ID'], ['TransactionType', 'Type'], ['TransactionDate', 'Date'], ['ItemNumber', 'Item'], ['ItemDescription', 'Description'],
        ['TransactionQuantity', 'Qty'], ['TransactionUOM', 'UOM'], ['TransactionCost', 'Unit Cost'], ['TransactionAmount', 'Amount'], ['ReceiptNumber', 'Receipt #'], ['Subinventory', 'Subinventory'], ['PurchaseOrderLineNumber', 'PO Line'], ['AccountingStatus', 'Acctg Status']]
        .map(function (f) { return { k: f[0], label: f[1] }; })) });
    Object.keys(SetPo.child).forEach(function (n) {
        var c = SetPo.child[n]; if (!c.rows || !c.rows.length) return;
        var keys = []; c.rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (k !== 'links' && keys.indexOf(k) < 0 && (r[k] == null || typeof r[k] !== 'object')) keys.push(k); }); });
        sheets.push({ name: SU.humanize(n), aoa: SU.aoa(c.rows, keys.map(function (k) { return { k: k, label: k }; })) });
    });
    SU.xlsx('PO_360_' + SU.safeFile(d.po.OrderNumber) + '_' + FX.today(), sheets);
};
