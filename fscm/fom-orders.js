/* Fusion Order Management — Manage Orders (spec §2 + §3.1 + §3.2).
   Workspace "orders": a fixed Search tab (Workbench search by BU with Orders · Lines · Analytics, or Quick find by order /
   customer like the read-only ManageSalesOrders screen) + one closable tab per opened order (order view: header, totals,
   timeline, lines with child collections, actual costing, EFF, billing → AR drill, reservations, auto ship, AutoInvoice,
   printable order, copy / return / change order hand-offs to the editor). */

FOM.SO_STATUSES = ['DOO_DRAFT', 'DOO_OPEN', 'DOO_SUBMITTED', 'DOO_PROCESSING', 'DOO_SCHEDULED', 'DOO_SHIPPED', 'DOO_CLOSED', 'DOO_CANCELED'];
FOM.SO_FIELDS_NOTE = 'salesOrdersForOrderHub';

// ── view entry ─────────────────────────────────────────────────
FOM.viewOrders = function (el) {
    if (!FOM.wsTabs('orders').some(function (t) { return t.id === 'o_search'; })) FOM.ws.tabs.unshift({ id: 'o_search', area: 'orders', label: 'Search', icon: 'fa-magnifying-glass', closable: false, el: (function () { var e = document.createElement('div'); e.className = 'fom-wsp'; FOM.buildSearch(e); return e; })() });
    el.classList.add('fom-ws');
    FOM.renderWs('orders', el, '<button class="btn sm" data-ws-new><i class="fa-solid fa-plus"></i> Create New Order</button><a class="btn sm" href="#create" data-ws-pos><i class="fa-solid fa-cash-register"></i> POS Order</a>');
    el.addEventListener('click', function (e) {
        if (e.target.closest('[data-ws-new]')) { FOM.registerOrder(); }
        if (e.target.closest('[data-ws-pos]')) { e.preventDefault(); FX.show('pos'); }
    });
};

// ── Search tab ─────────────────────────────────────────────────
FOM.S = { rows: [], mode: 'wb', offset: 0, hasMore: false, total: null, showRef: false, an: { view: 'date', show: 50, chart: true } };
FOM.buildSearch = function (el) {
    var S = FOM.S;
    el.innerHTML = '<div class="card"><div class="fom-sh"><div class="seg" data-mode><button class="on" data-m="wb">Workbench</button><button data-m="qf">Quick find</button></div><span class="muted" style="font-size:.76rem" data-mh>Search Order Hub by business unit — dates unquoted, text uses LIKE, codes exact.</span></div>' +
        '<div class="filters" data-f="wb">' +
        '<label>Order date from<input type="date" id="fs-from"></label><label>Order date to<input type="date" id="fs-to"></label>' +
        '<label>Business unit *<select id="fs-bu"><option value="">Loading…</option></select></label><label>Order type<select id="fs-type"><option value="">Any</option></select></label>' +
        '<label>Customer<input id="fs-cust" placeholder="Name contains"></label><label>Customer #<input id="fs-custno" placeholder="e.g. DCLG0030"></label>' +
        '<label>Status<select id="fs-st"><option value="">Any</option>' + FOM.SO_STATUSES.map(function (s) { return '<option value="' + s + '">' + FOM.humanize(s.replace('DOO_', '').toLowerCase()) + ' (' + s + ')</option>'; }).join('') + '</select></label>' +
        '<label>Order key<input id="fs-key" placeholder="OPS:300000010754319"></label></div>' +
        '<div class="filters" data-f="qf" hidden><label>Order #<input id="fq-no"></label><label>Customer<input id="fq-cust" placeholder="Name prefix…"></label>' +
        '<label>Status<select id="fq-st"><option value="">Any</option><option>OPEN</option><option>CLOSED</option><option>CANCELED</option><option>ON_HOLD</option></select></label>' +
        '<label>Currency<select id="fq-ccy"><option value="">Any</option>' + FOM.currencies().map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></label>' +
        '<label>Order date from<input type="date" id="fq-from"></label><label>to<input type="date" id="fq-to"></label></div>' +
        '<div class="fom-sbar"><button class="btn primary" data-go><i class="fa-solid fa-magnifying-glass"></i> Search</button><button class="btn" data-reset><i class="fa-solid fa-eraser"></i> Reset</button><button class="btn" data-more hidden><i class="fa-solid fa-angles-down"></i> Load next</button><span class="muted" data-cnt style="font-size:.78rem"></span><span class="grow"></span><button class="btn sm" data-api title="The Fusion call behind this search"><i class="fa-solid fa-code"></i> API</button></div></div>' +
        '<div data-sub style="display:flex;flex-direction:column;gap:10px;min-height:0;flex:1"></div>';
    var q = function (s) { return el.querySelector(s); };
    function defaults() { var d = new Date(); d.setMonth(d.getMonth() - 1); q('#fs-from').value = FX.today(d); q('#fs-to').value = FOM.days(1); }
    defaults();
    FOM.bus().then(function (l) { q('#fs-bu').innerHTML = '<option value="">Select a business unit…</option>' + FOM.opts(l, lsGet('fom_s_bu', '')); }).catch(function (e) { q('#fs-bu').innerHTML = '<option value="">(could not load)</option>'; FX.toast(FOM.emsg(e), 'err'); });
    FOM.orderTypes().then(function (l) { q('#fs-type').innerHTML = '<option value="">Any</option>' + l.map(function (t) { return '<option value="' + esc(t.v) + '">' + esc(t.v + ' — ' + t.t) + '</option>'; }).join(''); }).catch(function () { });
    q('[data-mode]').onclick = function (e) { var b = e.target.closest('[data-m]'); if (!b) return; S.mode = b.getAttribute('data-m'); q('[data-mode]').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); el.querySelectorAll('[data-f]').forEach(function (f) { f.hidden = f.getAttribute('data-f') !== S.mode; }); q('[data-mh]').textContent = S.mode === 'wb' ? 'Search Order Hub by business unit — dates unquoted, text uses LIKE, codes exact.' : 'Read-only quick find by order number or customer — 25 per page with the total count.'; };
    el.querySelectorAll('[data-f] input').forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') search(false); }); });
    q('[data-go]').onclick = function () { search(false); };
    q('[data-more]').onclick = function () { search(true); };
    q('[data-reset]').onclick = function () { el.querySelectorAll('[data-f] input').forEach(function (i) { i.value = ''; }); el.querySelectorAll('[data-f] select:not(#fs-bu)').forEach(function (s) { s.value = ''; }); defaults(); S.rows = []; S.searched = false; drawResults(); };
    q('[data-api]').onclick = function () { var u = buildUrl(0); FOM.dlg({ title: 'API — sales order search', wide: true, body: '<div class="fom-call"><b class="m GET">GET</b> <span class="mono">' + esc(u || '(choose a business unit first)') + '</span></div><div class="note">Order lines: <span class="mono">' + esc(FX.url('salesOrdersForOrderHub/{OrderKey}/child/lines', { onlyData: false })) + '</span></div><div data-r></div>', buttons: [{ label: 'Copy', act: 'copy' }, { label: 'Run', act: 'run', cls: 'primary' }, { label: 'Close', act: 'close' }], onAction: function (a, d) { if (a === 'copy') { FOM.copy(u); return false; } if (a === 'run' && u) { var t0 = Date.now(); d.q('[data-r]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>'; FX.restRaw('GET', u).then(function (r) { d.q('[data-r]').innerHTML = '<div class="muted">HTTP ' + r.status + ' · ' + (r.text || '').length + ' bytes · ' + (Date.now() - t0) + ' ms</div><pre class="json">' + esc((r.text || '').slice(0, 4000)) + '</pre>'; }); return false; } } }); };
    function buildUrl(off) {
        var p = [];
        if (S.mode === 'wb') {
            var bu = q('#fs-bu').value; if (!bu) return null;
            var f = q('#fs-from').value, t = q('#fs-to').value, ty = q('#fs-type').value, c = q('#fs-cust').value.trim(), cn = q('#fs-custno').value.trim(), st = q('#fs-st').value, k = q('#fs-key').value.trim();
            if (f) p.push('TransactionOn>' + f); if (t) p.push('TransactionOn<' + t); p.push('RequestingBusinessUnitId=' + bu);
            if (ty) p.push("TransactionTypeCode='" + ty + "'"); if (c) p.push("BuyingPartyName LIKE '%" + c.replace(/'/g, "''") + "%'"); if (cn) p.push("BuyingPartyNumber='" + cn.replace(/'/g, "''") + "'"); if (st) p.push("StatusCode='" + st + "'"); if (k) p.push("OrderKey='" + k.replace(/'/g, "''") + "'");
            return FX.url('salesOrdersForOrderHub', { q: p.join(';'), orderBy: 'TransactionOn:desc', expand: 'lines', limit: 50, offset: off, onlyData: false });
        }
        var no = q('#fq-no').value.trim(), cu = q('#fq-cust').value.trim(), s2 = q('#fq-st').value, cc = q('#fq-ccy').value, f2 = q('#fq-from').value, t2 = q('#fq-to').value;
        if (no) p.push('OrderNumber=' + FOM.qv(no)); if (cu) p.push('BuyingPartyName like "' + cu.replace(/"/g, '') + '*"'); if (s2) p.push('StatusCode=' + s2); if (cc) p.push('TransactionalCurrencyCode=' + cc);
        if (f2) p.push('TransactionOn>="' + f2 + 'T00:00:00+00:00"'); if (t2) p.push('TransactionOn<="' + t2 + 'T23:59:59+00:00"');
        return FX.url('salesOrdersForOrderHub', { q: p.join(';') || null, expand: 'lines', limit: 25, offset: off, total: true, onlyData: false });
    }
    function search(more) {
        if (S.mode === 'wb' && !q('#fs-bu').value) { FX.toast('Please select a Business Unit to search', 'err'); return; }
        if (S.mode === 'wb') lsSet('fom_s_bu', q('#fs-bu').value);
        var off = more ? S.offset : 0, url = buildUrl(off);
        q('[data-cnt]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Reading Order Hub…'; q('[data-go]').disabled = true;
        FX.rest('GET', url).then(function (j) {
            var items = j.items || [], lim = S.mode === 'wb' ? 50 : 25;
            S.rows = more ? S.rows.concat(items) : items; S.offset = off + items.length; S.searched = true;
            S.hasMore = !!j.hasMore && items.length === lim; S.total = S.mode === 'qf' ? (j.totalResults != null ? j.totalResults : j.count != null ? j.count : null) : null;
            drawResults();
        }).catch(function (e) { q('[data-cnt]').innerHTML = '<span style="color:var(--err)">' + esc(FOM.emsg(e)) + '</span>'; }).then(function () { q('[data-go]').disabled = false; });
    }
    function drawResults() {
        q('[data-more]').hidden = !S.hasMore;
        q('[data-more]').innerHTML = '<i class="fa-solid fa-angles-down"></i> Load next ' + (S.mode === 'wb' ? 50 : 25);
        q('[data-cnt]').textContent = S.searched ? S.rows.length + ' loaded' + (S.total != null ? ' of ' + S.total : '') + (S.hasMore ? '' : ' — no more —') : '';
        if (!S.subTabs) {
            S.subTabs = FOM.tabs(q('[data-sub]'), [
                { id: 'orders', label: 'Orders', icon: 'fa-file-lines', render: function (p) { FOM.searchOrdersTab(p); } },
                { id: 'lines', label: 'Lines', icon: 'fa-list', render: function (p) { FOM.searchLinesTab(p); } },
                { id: 'an', label: 'Analytics', icon: 'fa-chart-column', render: function (p) { FOM.searchAnalyticsTab(p); } }
            ], { cls: 'fom-subtabs' });
        }
        FOM.S.refresh && FOM.S.refresh();
    }
    FOM.S.redraw = drawResults;
    drawResults();
};
FOM.searchVisible = function () { return FOM.S.rows.filter(function (r) { return FOM.S.showRef || r.StatusCode !== 'DOO_REFERENCE'; }).sort(function (a, b) { return String(b.TransactionOn || '').localeCompare(String(a.TransactionOn || '')); }); };
FOM.searchLines = function () {
    var out = [];
    FOM.searchVisible().forEach(function (o) { (o.lines || []).forEach(function (l) { out.push(Object.assign({}, l, { _o: o, _cust: o.BuyingPartyName, _ord: o.OrderNumber, _src: o.SourceTransactionNumber, _ccy: o.TransactionalCurrencyCode || o.AppliedCurrencyCode, _type: o.TransactionTypeCode || o.TransactionType, _on: o.TransactionOn, _key: o.HeaderId + '-' + (l.LineId || l.FulfillLineId) })); }); });
    return out;
};
FOM.lineExt = function (l) { var e = FOM.num(l.ExtendedAmount); return e != null ? e : FOM.r2(FOM.n(l.OrderedQuantity) * FOM.n(l.UnitSellingPrice)); };
FOM.orderValue = function (o) { return FOM.sum(o.lines || [], FOM.lineExt); };
FOM.searchOrdersTab = function (p) {
    p.innerHTML = '<div class="row-btns"><label class="fom-chk"><input type="checkbox" data-ref> Show DOO_REFERENCE</label><span class="grow"></span><button class="btn sm" data-xo><i class="fa-solid fa-file-excel"></i> Export Orders</button></div><div data-gw style="display:flex;flex-direction:column;gap:10px;flex:1;min-height:340px"></div>';
    var g = FX.grid(p.querySelector('[data-gw]'), {
        id: 'fso', csvName: 'sales_orders', key: 'HeaderId', emptyText: FOM.S.searched ? 'No sales orders matched.' : 'Choose a business unit and search.',
        onRow: function (r) { FOM.openOrder(r); },
        columns: [
            { label: 'Source Txn #', get: function (r) { return r.SourceTransactionNumber || r.OrderNumber; }, html: function (r) { return '<span class="fom-a">' + esc(r.SourceTransactionNumber || r.OrderNumber) + '</span>'; } },
            { f: 'OrderNumber', label: 'Order', fmt: 'mono' },
            { f: 'TransactionOn', label: 'Order Date', html: function (r) { return esc(FOM.d(r.TransactionOn)); } },
            { label: 'Transaction Type', get: function (r) { return r.TransactionType || r.TransactionTypeCode; }, html: function (r) { return r.TransactionType ? '<span class="chip info">' + esc(r.TransactionType) + '</span>' : esc(r.TransactionTypeCode || ''); } },
            { label: 'Currency', get: function (r) { return r.TransactionalCurrencyCode || r.AppliedCurrencyCode; } },
            { label: 'Value', n: 1, get: function (r) { return FOM.orderValue(r); }, html: function (r) { return r.lines ? FOM.amt(FOM.orderValue(r)) : ''; } },
            { label: 'Payment Terms', get: function (r) { return r.PaymentTerms || r.PaymentTermsCode; } },
            { label: 'Status', get: function (r) { return r.Status || r.StatusCode; }, html: function (r) { return FOM.chip(r.Status, r.StatusCode) + (r.Status && r.StatusCode ? ' <span class="chip">' + esc(r.StatusCode) + '</span>' : '') + (FOM.yes(r.OnHoldFlag) ? ' <span class="chip warn">Hold</span>' : ''); } },
            { f: 'BusinessUnitName', label: 'Business Unit' }, { f: 'BuyingPartyName', label: 'Customer' }, { f: 'BuyingPartyNumber', label: 'Customer #', fmt: 'mono' }, { f: 'CustomerPONumber', label: 'Customer PO' },
            { f: 'RequestedShipDate', label: 'Requested Ship', html: function (r) { return esc(FOM.d(r.RequestedShipDate)); } }, { f: 'SourceTransactionSystem', label: 'Source System' }, { f: 'OrderKey', label: 'Order Key', fmt: 'mono' },
            { f: 'CreationDate', label: 'Created', html: function (r) { return esc(FOM.dt(r.CreationDate)); } }
        ],
        rowActions: [
            { label: 'View order', icon: 'fa-eye', run: function (r) { FOM.openOrder(r); } },
            { label: 'Edit order (change order)', icon: 'fa-pen', run: function (r) { FOM.openEditor({ mode: 'edit', order: r }); } },
            { label: 'Order totals', icon: 'fa-dollar-sign', run: function (r) { FOM.totalsDlg(r); } },
            { label: 'All fields', icon: 'fa-list', run: function (r) { FOM.allFields(r, 'Order ' + (r.OrderNumber || '')); } }
        ],
        kpis: function (rows) {
            var c = function (re) { return function (r) { return re.test(String(r.StatusCode || r.Status || '')); }; };
            var ccys = {}; rows.forEach(function (r) { var k = r.TransactionalCurrencyCode || r.AppliedCurrencyCode || ''; ccys[k] = (ccys[k] || 0) + FOM.orderValue(r); });
            var top = Object.keys(ccys).sort(function (a, b) { return ccys[b] - ccys[a]; })[0];
            return [{ k: 'all', label: 'Orders', value: rows.length },
                { k: 'dr', label: 'Draft', value: rows.filter(c(/DRAFT/)).length, filter: c(/DRAFT/) },
                { k: 'op', label: 'Open / in process', value: rows.filter(c(/OPEN|SUBMIT|PROCESS|SCHEDUL|AWAIT/)).length, filter: c(/OPEN|SUBMIT|PROCESS|SCHEDUL|AWAIT/) },
                { k: 'cl', label: 'Closed / shipped', value: rows.filter(c(/CLOSED|SHIPPED/)).length, filter: c(/CLOSED|SHIPPED/) },
                { k: 'ca', label: 'Canceled', value: rows.filter(c(/CANCEL/)).length, filter: c(/CANCEL/) },
                { k: 'ho', label: 'On hold', value: rows.filter(function (r) { return FOM.yes(r.OnHoldFlag); }).length, filter: function (r) { return FOM.yes(r.OnHoldFlag); } },
                { k: 'val', label: 'Value' + (top ? ' (' + top + ')' : ''), value: top != null ? FOM.amt(ccys[top]) : '—' }];
        }
    });
    function refresh() { g.cfg.emptyText = FOM.S.searched ? 'No sales orders matched.' : 'Choose a business unit and search.'; g.rows = FOM.searchVisible(); g.hasMore = false; g.render(); }
    p.querySelector('[data-ref]').onchange = function () { FOM.S.showRef = this.checked; FOM.S.refreshAll(); };
    p.querySelector('[data-xo]').onclick = function () { FOM.exportOrders(g.visible()); };
    FOM.S.ordersRefresh = refresh; refresh();
};
FOM.S.refreshAll = FOM.S.refresh = function () { ['ordersRefresh', 'linesRefresh', 'anRefresh'].forEach(function (k) { if (FOM.S[k]) FOM.S[k](); }); };
FOM.exportOrders = function (rows) {
    var hdr = ['Order Number', 'Customer', 'Order Date', 'Status', 'Currency', 'Ordered Qty', 'Ordered Amount', 'Freight', 'Tax', 'Total', 'Business Unit', 'Type', 'Buyer'];
    var aoa = [['Sales Orders'], ['Date: ' + FOM.d(FX.today())], ['Total Orders: ' + rows.length], [], hdr].concat(rows.map(function (r) {
        var qty = r.lines ? FOM.sum(r.lines, 'OrderedQuantity') : FOM.n(r.OrderedQuantity), val = r.lines ? FOM.orderValue(r) : FOM.n(r.OrderedAmount);
        return [r.OrderNumber, r.BuyingPartyName, FOM.d(r.TransactionOn), r.StatusCode || r.Status, r.TransactionalCurrencyCode || r.AppliedCurrencyCode || r.CurrencyCode || '', qty, val, FOM.n(r.FreightAmount), FOM.n(r.TaxAmount), FOM.num(r.GrandTotalAmount != null ? r.GrandTotalAmount : r.OrderAmount) != null ? FOM.n(r.GrandTotalAmount != null ? r.GrandTotalAmount : r.OrderAmount) : val, r.BusinessUnitName, r.TransactionTypeCode || r.TransactionType, r.BuyerName || ''];
    }));
    FOM.xlsx('SalesOrders_' + FOM.ts() + '.xlsx', [{ name: 'Orders', aoa: aoa, merges: [[0, 0, 0, 12]], cols: [16, 32, 12, 16, 8, 10, 14, 10, 10, 14, 26, 12, 18] }]);
};
FOM.searchLinesTab = function (p) {
    p.innerHTML = '<div class="row-btns"><span class="muted" style="font-size:.78rem">Lines of the loaded orders (expand=lines), with their header.</span><span class="grow"></span><button class="btn sm" data-xl><i class="fa-solid fa-file-excel"></i> Export Lines</button></div><div data-gw style="display:flex;flex-direction:column;gap:10px;flex:1;min-height:340px"></div>';
    var g = FX.grid(p.querySelector('[data-gw]'), {
        id: 'fsl2', csvName: 'sales_order_lines', key: '_key', emptyText: 'Search orders first — their lines appear here.',
        columns: [
            { label: 'Source Txn #', get: function (r) { return r._src || r._ord; }, html: function (r) { return '<a class="fom-a" data-oo>' + esc(r._src || r._ord) + '</a>'; } },
            { label: 'Type', get: function (r) { return r._type; } }, { label: 'Txn Date', get: function (r) { return r._on; }, html: function (r) { return esc(FOM.dt(r._on)); } },
            { label: 'Customer', get: function (r) { return r._cust; } }, { label: 'Order #', get: function (r) { return r._ord; }, html: function (r) { return '<a class="fom-a" data-oo>' + esc(r._ord) + '</a>'; } },
            { f: 'ProductNumber', label: 'Product #', fmt: 'mono' }, { f: 'ProductDescription', label: 'Description' },
            { f: 'OrderedQuantity', label: 'Qty', n: 1, html: function (r) { return FOM.amt(r.OrderedQuantity); } }, { f: 'UnitSellingPrice', label: 'Unit Price', n: 1, html: function (r) { return FOM.amt(r.UnitSellingPrice); } },
            { label: 'Extended', n: 1, get: FOM.lineExt, html: function (r) { return FOM.amt(FOM.lineExt(r)); } }, { label: 'Currency', get: function (r) { return r._ccy; } },
            { label: 'Status', get: function (r) { return r.Status || r.StatusCode; }, html: function (r) { return FOM.chip(r.Status, r.StatusCode); } },
            { f: 'RequestedFulfillmentOrganizationCode', label: 'Org Code' }, { f: 'RequestedFulfillmentOrganizationName', label: 'Org Name' }
        ],
        rowActions: [{ label: 'Order totals', icon: 'fa-dollar-sign', run: function (r) { FOM.totalsDlg(r._o); } }, { label: 'Open order', icon: 'fa-eye', run: function (r) { FOM.openOrder(r._o); } }],
        kpis: function (rows) { return [{ k: 'n', label: 'Lines', value: rows.length }, { k: 'q', label: 'Σ Quantity', value: FOM.qty(FOM.sum(rows, 'OrderedQuantity')) }, { k: 'e', label: 'Σ Extended amount', value: FOM.amt(FOM.sum(rows, FOM.lineExt)) }, { k: 'c', label: 'Canceled', value: rows.filter(function (r) { return /CANCEL/i.test(r.StatusCode || r.Status || ''); }).length, filter: function (r) { return /CANCEL/i.test(r.StatusCode || r.Status || ''); } }]; }
    });
    p.addEventListener('click', function (e) { var a = e.target.closest('[data-oo]'); if (a) { var tr = a.closest('tr[data-r]'); FOM.openOrder(g.view[+tr.getAttribute('data-r')]._o); } }, true);
    p.querySelector('[data-xl]').onclick = function () {
        var rows = g.visible();
        var aoa = [['Sales Order Lines'], ['Total Lines: ' + rows.length], ['Total Quantity: ' + FOM.sum(rows, 'OrderedQuantity')], ['Total Amount: ' + FOM.r2(FOM.sum(rows, FOM.lineExt))], [], ['Order', 'Line #', 'Product', 'Description', 'Qty', 'UOM', 'Unit Price', 'Extended Amount', 'Status', 'Customer']]
            .concat(rows.map(function (r) { return [r._ord, r.DisplayLineNumber || r.LineNumber, r.ProductNumber, r.ProductDescription, FOM.n(r.OrderedQuantity), r.OrderedUOM || r.OrderedUOMCode, FOM.n(r.UnitSellingPrice), FOM.lineExt(r), r.Status || r.StatusCode, r._cust]; }));
        FOM.xlsx('SalesOrderLines_' + FOM.ts() + '.xlsx', [{ name: 'Lines', aoa: aoa, cols: [14, 8, 18, 36, 8, 8, 12, 14, 18, 30] }]);
    };
    FOM.S.linesRefresh = function () { g.rows = FOM.searchLines(); g.render(); };
    FOM.S.linesRefresh();
};
FOM.AN_VIEWS = [['date', 'By Date'], ['month', 'By Month'], ['item', 'By Item'], ['cust', 'By Customer'], ['type', 'By Type']];
FOM.searchAnalyticsTab = function (p) {
    var A = FOM.S.an;
    p.innerHTML = '<div class="card pad"><div class="row-btns"><div class="seg" data-av>' + FOM.AN_VIEWS.map(function (v) { return '<button data-v="' + v[0] + '"' + (A.view === v[0] ? ' class="on"' : '') + '>' + v[1] + '</button>'; }).join('') + '</div>' +
        '<input class="fom-in" data-fc placeholder="Customer contains" style="max-width:170px"><input class="fom-in" data-fp placeholder="Product # contains" style="max-width:160px"><select class="fom-in" data-ft style="max-width:150px"><option value="">All types</option></select>' +
        '<label class="fom-chk">Load records <input type="number" min="1" max="200" data-ls value="' + A.show + '" style="width:64px" class="fom-in"></label><label class="fom-chk"><input type="checkbox" data-ch' + (A.chart ? ' checked' : '') + '> Show chart</label><span class="grow"></span><button class="btn sm" data-x><i class="fa-solid fa-file-excel"></i> Export to Excel</button></div></div><div class="kpis" data-k></div><div data-chart></div><div class="card" data-t style="overflow:auto"></div>';
    var q = function (s) { return p.querySelector(s); };
    function agg() {
        var fc = q('[data-fc]').value.toLowerCase(), fp = q('[data-fp]').value.toLowerCase(), ft = q('[data-ft]').value;
        var lines = FOM.searchLines().filter(function (l) { return (!fc || String(l._cust || '').toLowerCase().indexOf(fc) >= 0) && (!fp || String(l.ProductNumber || '').toLowerCase().indexOf(fp) >= 0) && (!ft || l._type === ft); });
        var key = function (l) { return A.view === 'date' ? String(l._on || '').slice(0, 10) : A.view === 'month' ? String(l._on || '').slice(0, 7) : A.view === 'item' ? l.ProductNumber : A.view === 'cust' ? l._cust : l._type; };
        var g = {};
        lines.forEach(function (l) { var k = key(l) || '—'; if (!g[k]) g[k] = { key: k, desc: A.view === 'item' ? l.ProductDescription : A.view === 'cust' ? l._cust : '', quantity: 0, amount: 0, count: 0 }; g[k].quantity += FOM.n(l.OrderedQuantity); g[k].amount += FOM.lineExt(l); g[k].count++; });
        var rows = Object.keys(g).map(function (k) { var r = g[k]; r.avgPrice = r.quantity ? r.amount / r.quantity : 0; return r; }).sort(function (a, b) { return b.amount - a.amount; });
        return { rows: rows, lines: lines };
    }
    function draw() {
        var types = FOM.distinct(FOM.searchLines().map(function (l) { return l._type; })), ft = q('[data-ft]'), cur = ft.value;
        ft.innerHTML = '<option value="">All types</option>' + types.map(function (t) { return '<option' + (t === cur ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');
        var r = agg(), rows = r.rows, show = Math.max(1, Math.min(200, +q('[data-ls]').value || 50)), qty = FOM.sum(rows, 'quantity'), amt = FOM.sum(rows, 'amount');
        q('[data-k]').innerHTML = [['Total Orders (groups)', rows.length], ['Total Quantity', FOM.qty(qty)], ['Total Amount', FOM.amt(amt)], ['Avg Amount', FOM.amt(rows.length ? amt / rows.length : 0)]].map(function (k) { return '<div class="kpi"><b>' + k[1] + '</b><span>' + k[0] + '</span></div>'; }).join('');
        var lab = { date: 'Date', month: 'Month', item: 'Product #', cust: 'Customer', type: 'Type' }[A.view];
        var top = rows.slice(0, show);
        if (A.chart && top.length) {
            var mx = Math.max.apply(null, top.slice(0, 20).map(function (x) { return Math.abs(x.amount); })) || 1;
            var ch = A.view === 'date' || A.view === 'month' ? top.slice(0, 31).sort(function (a, b) { return a.key.localeCompare(b.key); }) : top.slice(0, 20);
            var mx2 = Math.max.apply(null, ch.map(function (x) { return Math.abs(x.amount); })) || mx;
            q('[data-chart]').innerHTML = '<div class="card pad"><h4>Amount ' + esc(FOM.AN_VIEWS.filter(function (v) { return v[0] === A.view; })[0][1].toLowerCase()) + '</h4><div class="fom-bars' + (A.view === 'date' || A.view === 'month' ? ' cols' : '') + '">' + ch.map(function (x) { var w = Math.max(1, Math.round(Math.abs(x.amount) / mx2 * 100)); return '<div class="b" title="' + esc(x.key) + ': ' + FOM.amt(x.amount) + ' · qty ' + FOM.qty(x.quantity) + '"><span class="l">' + esc(x.key) + '</span><span class="t"><i style="' + (A.view === 'date' || A.view === 'month' ? 'height' : 'width') + ':' + w + '%"></i></span><span class="v">' + FOM.amt(x.amount) + '</span></div>'; }).join('') + '</div></div>';
        } else q('[data-chart]').innerHTML = '';
        q('[data-t]').innerHTML = FOM.table(top, [{ f: 'key', label: lab }].concat(A.view === 'item' ? [{ f: 'desc', label: 'Description' }] : []).concat([{ f: 'quantity', label: 'Quantity', n: 1, fmt: 'qty' }, { f: 'amount', label: 'Amount', n: 1, fmt: 'amt' }, { f: 'avgPrice', label: 'Avg Price', n: 1, fmt: 'amt' }, { f: 'count', label: 'Count', n: 1 }]), { empty: 'Search orders first — analytics run over the loaded lines.', icon: 'fa-chart-column', foot: [{ v: 'Total' }].concat(A.view === 'item' ? [''] : []).concat([{ n: 1, v: FOM.qty(qty) }, { n: 1, v: FOM.amt(amt) }, '', { n: 1, v: r.lines.length }]) });
        FOM.S.anRows = rows;
    }
    q('[data-av]').onclick = function (e) { var b = e.target.closest('[data-v]'); if (!b) return; A.view = b.getAttribute('data-v'); p.querySelectorAll('[data-av] button').forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); };
    ['[data-fc]', '[data-fp]', '[data-ls]'].forEach(function (s) { q(s).oninput = function () { A.show = +q('[data-ls]').value || 50; draw(); }; });
    q('[data-ft]').onchange = draw; q('[data-ch]').onchange = function () { A.chart = this.checked; draw(); };
    q('[data-x]').onclick = function () {
        var rows = FOM.S.anRows || [], v = A.view, head, map;
        if (v === 'date' || v === 'month') { head = ['Date', 'Quantity', 'Amount', 'Order Count']; map = function (r) { return [r.key, r.quantity, FOM.r2(r.amount), r.count]; }; }
        else if (v === 'item') { head = ['Product #', 'Description', 'Quantity', 'Amount', 'Avg Price', 'Count']; map = function (r) { return [r.key, r.desc, r.quantity, FOM.r2(r.amount), FOM.r2(r.avgPrice), r.count]; }; }
        else { head = [v === 'cust' ? 'Customer' : 'Type', 'Quantity', 'Amount', 'Order Count', 'Avg Price']; map = function (r) { return [r.key, r.quantity, FOM.r2(r.amount), r.count, FOM.r2(r.avgPrice)]; }; }
        FOM.xlsx('Analytics_' + v + '_' + FOM.ts() + '.xlsx', [{ name: 'Analytics', aoa: [head].concat(rows.map(map)), cols: head.map(function () { return 16; }) }]);
    };
    FOM.S.anRefresh = draw; draw();
};

// ── order view tab (§3.1) ──────────────────────────────────────
/** Open an order (search row with links, or {OrderNumber}/{HeaderId}). */
FOM.openOrder = function (row) {
    var id = 'o_' + (row.HeaderId || row.OrderKey || row.OrderNumber);
    FOM.open('orders', { id: id, label: String(row.SourceTransactionNumber || row.OrderNumber || 'Order'), icon: 'fa-file-lines', build: function (el, t) { FOM.buildOrderView(el, row, t); } });
};
FOM.openOrderBy = function (orderNumber, headerId) {
    FX.busy('Opening order ' + (orderNumber || headerId) + '…');
    FX.get('salesOrdersForOrderHub', { q: headerId ? 'HeaderId=' + headerId : 'OrderNumber=' + FOM.qv(orderNumber), limit: 1, onlyData: false }).then(function (j) {
        FX.busy(); var o = (j.items || [])[0]; if (!o) { FX.toast('Order ' + orderNumber + ' not found', 'err'); return; } FOM.openOrder(o);
    }).catch(function (e) { FX.busy(); FX.toast(FOM.emsg(e), 'err'); });
};
FOM.LINE_TAB_DEFS = [['additionalinformation', 'Additional Information', ['additionalinformation', 'additionalinfo']], ['attachments', 'Attachments', ['attachments', 'attachment']], ['customers', 'Customers', ['billtocustomer', 'billto', 'shiptocustomer', 'shipto']], ['charges', 'Charges', ['charges', 'charge']], ['holds', 'Holds', ['holds', 'hold']], ['billing', 'Billing', ['linedetails', 'linedetail']], ['lotserials', 'Lot Serials', ['lotserials', 'lotserial']], ['notes', 'Notes', ['notes', 'note']]];
FOM.childHref = function (l, names) { var x = (l.links || []).filter(function (k) { return names.indexOf(String(k.name || '').toLowerCase()) >= 0; })[0]; return x ? x.href : null; };
FOM.buildOrderView = function (el, row, tab) {
    var V = { o: row, lines: [], totals: null, sel: {}, resCount: null };
    el.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Opening order…</div>';
    var ensure = row.links && row.links.length ? Promise.resolve(row) : FX.get('salesOrdersForOrderHub', { q: row.HeaderId ? 'HeaderId=' + row.HeaderId : 'OrderNumber=' + FOM.qv(row.OrderNumber), limit: 1, onlyData: false }).then(function (j) { return (j.items || [])[0] || row; });
    ensure.then(function (o) { V.o = o; render(); loadLines(); loadTotals(); }).catch(function (e) { el.innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
    function orderNo() { return V.o.OrderNumber || V.o.SourceTransactionNumber; }
    function sourceNo() { return V.o.SourceTransactionNumber || V.o.OrderNumber; }
    function ccy() { return V.o.TransactionalCurrencyCode || V.o.AppliedCurrencyCode || ''; }
    function has(re) { return V.lines.some(function (l) { return re.test(FOM.lineStatus(l)); }); }
    function render() {
        var o = V.o;
        el.innerHTML = '<div class="card fom-oh"><div class="fom-oh-top"><div><div class="muted" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.4px">Sales order</div><h2>#' + esc(orderNo()) + ' <span class="muted" style="font-weight:500;font-size:.9rem">' + esc(o.BuyingPartyName || '') + '</span></h2>' +
            '<div class="row-btns" style="margin-top:4px">' + FOM.chip(o.Status, o.StatusCode) + (o.StatusCode ? '<span class="chip">' + esc(o.StatusCode) + '</span>' : '') + (FOM.yes(o.OnHoldFlag) ? '<span class="chip warn">ON HOLD</span>' : '') + (FOM.yes(o.CanceledFlag) ? '<span class="chip err">CANCELED</span>' : '') + '<span class="muted" style="font-size:.76rem">' + esc(o.TransactionType || o.TransactionTypeCode || '') + ' · ' + esc(FOM.d(o.TransactionOn)) + '</span></div></div>' +
            '<span class="grow"></span><div data-tl></div></div>' +
            '<div class="fom-stats" data-stats></div>' +
            '<div class="acts" data-acts></div></div>' +
            '<div class="fom-2col"><div class="card"><div data-htabs></div></div><div class="card pad"><div class="row-btns"><b><i class="fa-solid fa-calculator" style="color:var(--accent)"></i> Order Total</b><span class="grow"></span><button class="btn sm icon" data-rt title="Reload totals"><i class="fa-solid fa-rotate"></i></button></div><div data-tot style="margin-top:8px"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div></div>' +
            '<div class="card" data-lcard><div class="fom-lh"><b><i class="fa-solid fa-list" style="color:var(--accent)"></i> Lines</b><span class="grow"></span><button class="btn sm" data-rl><i class="fa-solid fa-rotate"></i> Reload lines</button></div><div data-ltabs><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Reading lines…</div></div></div>';
        var q = function (s) { return el.querySelector(s); };
        q('[data-rt]').onclick = loadTotals; q('[data-rl]').onclick = loadLines;
        FOM.tabs(q('[data-htabs]'), [{ id: 'cur', label: 'Current Info', render: currentInfo }, { id: 'add', label: 'Additional Info', render: function (p, reload) { headerEff(p, reload); } }]);
        drawHead();
    }
    function drawHead() {
        var o = V.o, q = function (s) { return el.querySelector(s); };
        q('[data-tl]').innerHTML = FOM.timeline(FOM.orderStage(o, V.lines));
        var tot = FOM.sum(V.lines.filter(function (l) { return !FOM.yes(l.CanceledFlag); }), function (l) { return FOM.n(l.OrderedQuantity) * FOM.n(l.UnitSellingPrice); });
        var st = [['Customer', o.BuyingPartyName], ['Business Unit', o.BusinessUnitName], ['Transaction Type', o.TransactionTypeCode || o.TransactionType], ['Currency', ccy()], ['Order Date', FOM.d(o.TransactionOn)], ['Ship Date', FOM.d(o.RequestedShipDate)], ['Payment Terms', o.PaymentTerms || o.PaymentTermsCode]];
        q('[data-stats]').innerHTML = st.map(function (s) { return '<div><span>' + s[0] + '</span><b>' + esc(s[1] || '—') + '</b></div>'; }).join('') + '<div class="big"><span>Order Total</span><b>' + esc(ccy()) + ' ' + FOM.amt(tot) + '</b><small>' + V.lines.length + ' lines</small></div>';
        var nSel = Object.keys(V.sel).filter(function (k) { return V.sel[k]; }).length;
        var acts = '<button class="btn" data-a="print"><i class="fa-solid fa-print"></i> Print Order</button>' +
            '<button class="btn" data-a="copy"' + (V.lines.length ? '' : ' disabled') + '><i class="fa-regular fa-copy"></i> Copy Order</button>' +
            '<button class="btn" data-a="return"' + (V.lines.length ? '' : ' disabled') + '><i class="fa-solid fa-rotate-left"></i> ' + (nSel ? 'Return ' + nSel + ' Line(s)' : 'Return Order') + '</button>' +
            '<button class="btn" data-a="edit"><i class="fa-solid fa-pen"></i> Change Order</button>' +
            '<button class="btn" data-a="res"><i class="fa-solid fa-lock"></i> Reservations' + (V.resCount != null ? ' (' + V.resCount + ')' : '') + '</button>' +
            (has(/awaiting\s*shipping/i) ? '<button class="btn ok" data-a="ship"><i class="fa-solid fa-truck-fast"></i> Auto Shipconfirm</button>' : '') +
            (has(/awaiting\s*billing/i) ? '<button class="btn ok" data-a="ar"><i class="fa-solid fa-file-invoice"></i> Push to AR</button>' : '') +
            '<span class="grow"></span><button class="btn" data-a="totals"><i class="fa-solid fa-dollar-sign"></i> Totals</button><button class="btn" data-a="all"><i class="fa-solid fa-list"></i> All fields</button><button class="btn" data-a="reload" title="Reload the order"><i class="fa-solid fa-rotate"></i></button>';
        q('[data-acts]').innerHTML = acts;
        q('[data-acts]').onclick = function (e) {
            var b = e.target.closest('[data-a]'); if (!b) return; var a = b.getAttribute('data-a');
            if (a === 'print') FOM.printOrder(V.o, V.lines, V.totals || []);
            else if (a === 'copy') FOM.openEditor({ mode: 'copy', order: V.o, lines: V.lines });
            else if (a === 'return') { var picked = V.lines.filter(function (l, i) { return V.sel[i]; }); FOM.openEditor({ mode: 'return', order: V.o, lines: picked.length ? picked : V.lines }); }
            else if (a === 'edit') FOM.openEditor({ mode: 'edit', order: V.o });
            else if (a === 'res') FOM.reservationsDlg(sourceNo(), items());
            else if (a === 'ship') FOM.autoShipDlg(sourceNo(), null, loadLines);
            else if (a === 'ar') FOM.autoInvoiceDlg(sourceNo(), V.o.BusinessUnitId);
            else if (a === 'totals') FOM.totalsDlg(V.o);
            else if (a === 'all') FOM.allFields(V.o, 'Order ' + orderNo());
            else if (a === 'reload') FX.get('salesOrdersForOrderHub', { q: 'HeaderId=' + V.o.HeaderId, limit: 1, onlyData: false }).then(function (j) { if (j.items && j.items[0]) { V.o = j.items[0]; render(); loadLines(); loadTotals(); } }).catch(function (er) { FX.toast(FOM.emsg(er), 'err'); });
        };
    }
    function items() { return FOM.distinct(V.lines.map(function (l) { return FOM.pf(l, ['ProductNumber', 'Item', 'ItemNumber']); })); }
    function currentInfo(p) {
        var o = V.o;
        var orgs = FOM.distinct(V.lines.map(function (l) { return l.RequestedFulfillmentOrganizationCode; })), orgN = FOM.distinct(V.lines.map(function (l) { return l.RequestedFulfillmentOrganizationName; }));
        var f = [['Order Number', esc(o.OrderNumber)], ['Source Transaction #', esc(o.SourceTransactionNumber) + (o.SourceTransactionSystem ? ' <span class="chip">' + esc(o.SourceTransactionSystem) + '</span>' : '')], ['Order Key', '<span class="mono">' + esc(o.OrderKey) + '</span>'], ['Transaction Type', esc(o.TransactionType || o.TransactionTypeCode)], ['Business Unit', esc(o.BusinessUnitName)], ['Customer', esc(o.BuyingPartyName)], ['Customer #', esc(o.BuyingPartyNumber)], ['Customer PO', esc(o.CustomerPONumber)], ['Currency', esc(o.TransactionalCurrencyCode || o.TransactionalCurrencyName || o.AppliedCurrencyCode) + (o.TransactionalCurrencyName && o.TransactionalCurrencyCode ? ' – ' + esc(o.TransactionalCurrencyName) : '')], ['Payment Terms', esc(o.PaymentTerms || o.PaymentTermsCode)], ['Salesperson', esc(o.Salesperson)], ['Transaction On', esc(FOM.dt(o.TransactionOn))], ['Requested Ship', esc(FOM.d(o.RequestedShipDate))], ['Requested Arrival', esc(FOM.d(o.RequestedArrivalDate))], ['Requesting BU', esc(o.RequestingBusinessUnitName)], ['Legal Entity', esc(o.RequestingLegalEntity)], ['Organization', '<span title="' + esc(orgN.join(', ')) + '">' + esc(orgs.join(', ')) + '</span>'], ['Subinventory', esc(FOM.distinct(V.lines.map(function (l) { return l.SubinventoryCode; })).join(', '))], ['Submitted', esc(FOM.dt(o.SubmittedDate)) + (o.SubmittedBy ? ' · ' + esc(o.SubmittedBy) : '')], ['Created', esc(FOM.dt(o.CreationDate)) + (o.CreatedBy ? ' · ' + esc(o.CreatedBy) : '')], ['Last Updated', esc(FOM.dt(o.LastUpdateDate))]];
        var flags = [['Open', 'OpenFlag'], ['Submitted', 'SubmittedFlag'], ['On Hold', 'OnHoldFlag'], ['Canceled', 'CanceledFlag'], ['Freeze Price', 'FreezePriceFlag']].filter(function (x) { return FOM.yes(o[x[1]]); });
        p.innerHTML = '<div style="padding:12px 14px">' + (flags.length ? '<div class="row-btns" style="margin-bottom:10px">' + flags.map(function (x) { return '<span class="chip ' + (x[0] === 'Canceled' ? 'err' : x[0] === 'On Hold' ? 'warn' : 'done') + '">' + x[0] + '</span>'; }).join('') + '</div>' : '') + '<div class="facts">' + f.filter(function (x) { return x[1] && x[1] !== ' · '; }).map(function (x) { return '<div><span>' + x[0] + '</span>' + x[1] + '</div>'; }).join('') + '</div></div>';
    }
    function headerEff(p, reload) {
        p.innerHTML = '<div style="padding:12px 14px"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading additional information…</div>';
        FOM.effRows(FOM.orderBase(V.o)).then(function (rows) { p.innerHTML = '<div style="padding:12px 14px"><div class="row-btns" style="margin-bottom:8px"><span class="muted" style="font-size:.76rem">Header extensible flexfields (DOO_HEADERS_ADD_INFO)</span><span class="grow"></span><button class="btn sm" data-r><i class="fa-solid fa-rotate"></i> Run</button></div>' + FOM.effCards(rows) + '</div>'; p.querySelector('[data-r]').onclick = reload; })
            .catch(function (e) { p.innerHTML = '<div class="note err" style="margin:12px">' + esc(FOM.emsg(e)) + '</div>'; });
    }
    function loadTotals() {
        var t = el.querySelector('[data-tot]'); if (!t) return; t.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
        FOM.orderTotals(V.o).then(function (r) { V.totals = r; t.innerHTML = FOM.totalsHtml(r, ccy()); }).catch(function (e) { t.innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
    }
    function loadLines() {
        var lt = el.querySelector('[data-ltabs]'); if (!lt) return;
        lt.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Reading lines…</div>';
        FOM.orderLines(V.o).then(function (lines) {
            V.lines = lines; V.sel = {}; drawHead(); drawLineTabs();
            FOM.fetchReservations(sourceNo(), items()).then(function (r) { V.resCount = r.length; drawHead(); }).catch(function () { });
        }).catch(function (e) { lt.innerHTML = '<div class="note err" style="margin:12px">' + esc(FOM.emsg(e)) + '</div>'; });
    }
    function drawLineTabs() {
        var present = FOM.LINE_TAB_DEFS.filter(function (d) { return V.lines.some(function (l) { return FOM.childHref(l, d[2]); }); });
        FOM.tabs(el.querySelector('[data-ltabs]'), [{ id: 'lines', label: 'Lines', badge: V.lines.length, render: linesTab }, { id: 'cost', label: 'Actual Costing', render: function (p) { FOM.actualCosting(p, V.lines, ccy()); } }, { id: 'leff', label: 'Additional Info', render: lineEff }]
            .concat(present.map(function (d) { return { id: d[0], label: d[1], render: d[0] === 'customers' ? customersTab : function (p, reload) { FOM.mergedChild(p, V.lines, d[2], reload, d[0] === 'billing' ? billingCols : null); } }; })));
    }
    function billingCols(rows) {
        var k = Object.keys(rows[0] || {}).filter(function (x) { return /^(billingtransactionnumber|billingtrxnumber|billingtransactionnum)$/i.test(x); })[0];
        return k ? function (r) { return r[k] ? '<a class="fom-a" data-ar="' + esc(r[k]) + '">' + esc(r[k]) + '</a>' : ''; } : null;
    }
    function customersTab(p, reload) {
        p.innerHTML = '<div style="padding:10px 12px"><h4>Bill-To Customer</h4><div data-b></div><h4 style="margin-top:14px">Ship-To Customer</h4><div data-s></div></div>';
        FOM.mergedChild(p.querySelector('[data-b]'), V.lines, ['billtocustomer', 'billto'], reload);
        FOM.mergedChild(p.querySelector('[data-s]'), V.lines, ['shiptocustomer', 'shipto'], reload);
    }
    function linesTab(p) {
        var all = lsGet('fom_ov_allcols', false);
        function draw() {
            var lines = V.lines, c = ccy();
            var base = [
                { th: '<input type="checkbox" data-sa>', html: function (l, i) { return '<input type="checkbox" data-sl="' + i + '"' + (V.sel[i] ? ' checked' : '') + '>'; } },
                { label: 'Line', html: function (l) { return esc(l.DisplayLineNumber || l.LineNumber); } }, { label: 'Product', html: function (l) { return '<span class="mono">' + esc(l.ProductNumber) + '</span>'; } }, { f: 'ProductDescription', label: 'Description' },
                { label: 'Ordered Qty', n: 1, html: function (l) { return FOM.qty(l.OrderedQuantity) + ' ' + esc(l.OrderedUOM || l.OrderedUOMCode || ''); } }, { label: 'Unit List', n: 1, html: function (l) { return FOM.amt(l.UnitListPrice); } }, { label: 'Unit Selling', n: 1, html: function (l) { return FOM.amt(l.UnitSellingPrice); } },
                { label: 'Line Total', n: 1, html: function (l) { return FOM.amt(FOM.n(l.OrderedQuantity) * FOM.n(l.UnitSellingPrice), c); } }, { label: 'Status', html: function (l) { return FOM.chip(l.Status, l.StatusCode); } },
                { label: 'Req Ship', html: function (l) { return esc(FOM.d(l.RequestedShipDate)); } }, { f: 'InventoryOrganizationCode', label: 'Inv Org' }, { f: 'RequestedFulfillmentOrganizationCode', label: 'Organization' }, { f: 'SubinventoryCode', label: 'Subinventory' }
            ];
            var used = ['DisplayLineNumber', 'LineNumber', 'ProductNumber', 'ProductDescription', 'OrderedQuantity', 'OrderedUOM', 'UnitListPrice', 'UnitSellingPrice', 'Status', 'StatusCode', 'RequestedShipDate', 'InventoryOrganizationCode', 'RequestedFulfillmentOrganizationCode', 'SubinventoryCode'];
            var cols = base.concat(all ? FOM.dyn(lines, used) : []).concat([{ html: function (l, i) { return '<button class="btn sm icon" data-af="' + i + '" title="All fields"><i class="fa-solid fa-list"></i></button>'; } }]);
            p.innerHTML = '<div class="row-btns" style="padding:8px 12px"><span class="muted" style="font-size:.76rem">Select lines to return only those.</span><span class="grow"></span><label class="fom-chk"><input type="checkbox" data-allc' + (all ? ' checked' : '') + '> Every attribute</label></div>' +
                FOM.table(lines, cols, { empty: 'No lines on this order.', foot: ['', '', '', 'Total', { n: 1, v: FOM.qty(FOM.sum(lines, 'OrderedQuantity')) }, '', '', { n: 1, v: FOM.amt(FOM.sum(lines, function (l) { return FOM.n(l.OrderedQuantity) * FOM.n(l.UnitSellingPrice); }), c) }].concat(cols.slice(8).map(function () { return ''; })) });
        }
        p.onclick = function (e) {
            var a = e.target.closest('[data-af]'); if (a) { FOM.allFields(V.lines[+a.getAttribute('data-af')], 'Line ' + (V.lines[+a.getAttribute('data-af')].LineNumber || '')); return; }
            var s = e.target.closest('[data-sl]'); if (s) { V.sel[+s.getAttribute('data-sl')] = s.checked; drawHead(); return; }
            var sa = e.target.closest('[data-sa]'); if (sa) { V.lines.forEach(function (l, i) { V.sel[i] = sa.checked; }); draw(); drawHead(); }
        };
        p.onchange = function (e) { if (e.target.matches('[data-allc]')) { all = e.target.checked; lsSet('fom_ov_allcols', all); draw(); } };
        draw();
    }
    function lineEff(p, reload) {
        p.innerHTML = '<div style="padding:12px"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading line additional information…</div>';
        FOM.mapLimit(V.lines, 4, function (l) { var s = FOM.self(l); return s ? FOM.effRows(s).then(function (r) { return r.map(function (x) { return Object.assign({ _l: l }, x); }); }).catch(function () { return []; }) : []; }).then(function (ch) {
            var rows = [].concat.apply([], ch.filter(Array.isArray));
            p.innerHTML = '<div style="padding:10px 12px"><div class="row-btns" style="margin-bottom:6px"><span class="muted" style="font-size:.76rem">Line extensible flexfields (DOO_FULFILL_LINES_ADD_INFO)</span><span class="grow"></span><button class="btn sm" data-r><i class="fa-solid fa-rotate"></i> Run</button></div>' +
                FOM.table(rows, [{ label: 'Line', html: function (r) { return esc(FOM.pf(r._l, ['LineNumber', 'SourceTransactionLineNumber'])); } }, { label: 'Item', html: function (r) { return '<span class="mono">' + esc(FOM.pf(r._l, ['ProductNumber', 'Item', 'ItemNumber'])) + '</span>'; } }, { f: 'ctx', label: 'Context' }, { label: 'Segments', html: function (r) { return Object.keys(r.vals).map(function (k) { return '<span class="chip">' + esc(k) + ': ' + esc(r.vals[k]) + '</span>'; }).join(' '); } }], { empty: 'No line additional information.' }) + '</div>';
            p.querySelector('[data-r]').onclick = reload;
        });
    }
    el.addEventListener('click', function (e) { var a = e.target.closest('[data-ar]'); if (a) FOM.arInvoiceDlg(a.getAttribute('data-ar')); });
    tab.onShow = function () { };
};
/** MergedLineChildTab (§3.0.4) */
FOM.mergedChild = function (p, lines, names, reload, render) {
    p.innerHTML = '<div style="padding:12px"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading from ' + lines.length + ' lines…</div>';
    FOM.mapLimit(lines, 6, function (l) {
        var h = FOM.childHref(l, names); if (!h) return [];
        return FOM.all(h, { limit: 500 }).then(function (r) { return r.map(function (x) { return Object.assign({ _line: l.DisplayLineNumber || l.LineNumber, _prod: l.ProductNumber, _desc: l.ProductDescription, _uom: l.OrderedUOM }, x); }); }).catch(function () { return []; });
    }).then(function (ch) {
        var rows = [].concat.apply([], ch.filter(Array.isArray)), over = render ? render(rows) : null;
        var dyn = FOM.dyn(rows, ['_line', '_prod', '_desc', '_uom']);
        if (over) dyn = dyn.map(function (c) { return /^(billingtransactionnumber|billingtrxnumber|billingtransactionnum)$/i.test(c.f) ? Object.assign({}, c, { html: over }) : c; });
        p.innerHTML = '<div style="padding:10px 12px" data-pt></div>';
        FOM.ptable(p.querySelector('[data-pt]'), { rows: rows, pageSize: 25, cols: [{ f: '_line', label: 'Line' }, { label: 'Product', html: function (r) { return '<span class="mono">' + esc(r._prod || '') + '</span>'; } }, { f: '_desc', label: 'Description' }].concat(dyn), empty: 'Nothing on these lines.', tools: '<span class="muted" style="font-size:.74rem">Merged from ' + lines.length + ' lines</span><button class="btn sm" data-rl><i class="fa-solid fa-rotate"></i> Reload</button>' });
        var rb = p.querySelector('[data-rl]'); if (rb) rb.onclick = reload;
    });
};
/** Actual Costing tab (§3.0.5) */
FOM.actualCosting = function (p, lines, ccy) {
    var tp = function (l) { var e = FOM.num(l.ExtendedAmount); return e != null ? e : FOM.n(l.OrderedQuantity) * FOM.n(l.UnitSellingPrice); };
    var ext = FOM.sum(lines, tp), cost = FOM.sum(lines, 'EstimateFulfillmentCost'), mar = FOM.sum(lines, 'EstimateMargin');
    p.innerHTML = '<div style="padding:10px 12px;display:flex;flex-direction:column;gap:10px"><div class="kpis"><div class="kpi"><b>' + FOM.amt(ext) + '</b><span>Extended amount (revenue)</span></div><div class="kpi"><b>' + FOM.amt(cost) + '</b><span>Estimate fulfillment cost</span></div><div class="kpi"><b style="color:' + (mar < 0 ? 'var(--err)' : 'var(--ok)') + '">' + FOM.amt(mar) + '</b><span>Estimate margin · ' + (ext ? (mar / ext * 100).toFixed(1) : '0.0') + '%</span></div></div>' +
        FOM.table(lines, [{ label: 'Line', html: function (l) { return esc(l.DisplayLineNumber || l.LineNumber); } }, { f: 'ProductNumber', label: 'Item', mono: 1 }, { f: 'ProductDescription', label: 'Description' }, { label: 'Qty', n: 1, html: function (l) { return FOM.qty(l.OrderedQuantity) + ' ' + esc(l.OrderedUOM || ''); } }, { label: 'Unit Price', n: 1, html: function (l) { return FOM.amt(l.UnitSellingPrice); } }, { label: 'Total Price', n: 1, html: function (l) { return FOM.amt(tp(l)); } }, { label: 'Est Fulfillment Cost', n: 1, html: function (l) { return FOM.amt(l.EstimateFulfillmentCost); } }, { label: 'Est Margin', n: 1, html: function (l) { var m = FOM.num(l.EstimateMargin); return m == null ? '' : '<span style="color:' + (m < 0 ? 'var(--err)' : 'inherit') + '">' + FOM.amt(m) + '</span>'; } }],
            { empty: 'No lines.', foot: ['', '', 'Total', { n: 1, v: FOM.qty(FOM.sum(lines, 'OrderedQuantity')) }, '', { n: 1, v: FOM.amt(ext) }, { n: 1, v: FOM.amt(cost) }, { n: 1, v: FOM.amt(mar) }] }) + '<div class="muted" style="font-size:.72rem">Amounts in ' + esc(ccy) + '</div></div>';
};
/** Printable order (replaces the jsPDF A4 export: preview + print / Save as PDF). */
FOM.printOrder = function (o, lines, totals) {
    var ccy = o.TransactionalCurrencyCode || o.AppliedCurrencyCode || '';
    var kv = [['Business Unit', o.BusinessUnitName, 'Customer', o.BuyingPartyName], ['Legal Entity', o.RequestingLegalEntity, 'Customer #', o.BuyingPartyNumber], ['Source Txn #', (o.SourceTransactionNumber || '') + (o.SourceTransactionSystem ? ' (' + o.SourceTransactionSystem + ')' : ''), 'Customer PO', o.CustomerPONumber], ['Transaction Type', o.TransactionType || o.TransactionTypeCode, 'Currency', ccy], ['Payment Terms', o.PaymentTerms || o.PaymentTermsCode, 'Requested Ship', FOM.d(o.RequestedShipDate)], ['Order Key', o.OrderKey, 'Created', FOM.dt(o.CreationDate)]];
    var grand = totals.filter(function (r) { return FOM.yes(r.PrimaryFlag); })[0] || totals.filter(function (r) { var c = String(r.TotalCode || '').toUpperCase(); return /ORDER|GRAND|NET/.test(c) && !/TAX|SHIP|DISC|SUB|LINE|CHARGE|MARGIN/.test(c); })[0];
    var rest = totals.filter(function (r) { return r !== grand; }).sort(function (a, b) { return FOM.totRank(a.TotalCode) - FOM.totRank(b.TotalCode); });
    var e = function (v) { return esc(v == null ? '' : v); };
    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>SalesOrder_' + e(o.OrderNumber) + '</title><style>@page{size:A4;margin:14mm}body{font-family:Segoe UI,Arial,sans-serif;font-size:11px;color:#111;margin:0}.band{background:#b91c1c;color:#fff;padding:14px 18px;display:flex;justify-content:space-between;align-items:center}.band h1{margin:0;font-size:20px;letter-spacing:2px}.band div{text-align:right;font-size:11px;line-height:1.5}table{width:100%;border-collapse:collapse;margin-top:12px}th{background:#f1f5f9;text-align:left;font-size:10px;text-transform:uppercase;padding:6px;border-bottom:1px solid #cbd5e1}td{padding:5px 6px;border-bottom:1px solid #e2e8f0;vertical-align:top}.kv td:nth-child(odd){color:#64748b;width:16%}.n{text-align:right}.tot{width:45%;margin-left:auto}.tot .g td{font-weight:700;font-size:13px;border-top:2px solid #111}.foot{margin-top:18px;color:#94a3b8;font-size:9px;display:flex;justify-content:space-between}</style></head><body>' +
        '<div class="band"><h1>SALES ORDER</h1><div>Order <b>' + e(o.OrderNumber) + '</b><br>Status ' + e(o.Status || o.StatusCode) + '<br>Date ' + e(FOM.d(o.TransactionOn)) + '</div></div>' +
        '<table class="kv">' + kv.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + e(r[1]) + '</td><td>' + r[2] + '</td><td>' + e(r[3]) + '</td></tr>'; }).join('') + '</table>' +
        '<table><thead><tr><th>#</th><th>Product</th><th>Description</th><th class="n">Qty</th><th class="n">Unit List</th><th class="n">Unit Price</th><th class="n">Extended</th><th>Status</th></tr></thead><tbody>' + lines.map(function (l) { return '<tr><td>' + e(l.DisplayLineNumber || l.LineNumber) + '</td><td>' + e(l.ProductNumber) + '</td><td>' + e(l.ProductDescription) + '</td><td class="n">' + FOM.qty(l.OrderedQuantity) + ' ' + e(l.OrderedUOM) + '</td><td class="n">' + FOM.amt(l.UnitListPrice) + '</td><td class="n">' + FOM.amt(l.UnitSellingPrice) + '</td><td class="n">' + FOM.amt(FOM.n(l.OrderedQuantity) * FOM.n(l.UnitSellingPrice)) + '</td><td>' + e(l.Status || l.StatusCode) + '</td></tr>'; }).join('') + '</tbody></table>' +
        '<table class="tot">' + rest.map(function (r) { return '<tr><td>' + e(r.TotalName || r.TotalCode) + '</td><td class="n">' + FOM.amt(r.TotalAmount) + '</td></tr>'; }).join('') + (grand ? '<tr class="g"><td>' + e(grand.TotalName || 'Total') + '</td><td class="n">' + FOM.amt(grand.TotalAmount) + ' ' + e(ccy) + '</td></tr>' : '') + '</table>' +
        '<div class="foot"><span>Generated by Gray\'s WMS — Fusion Order Management</span><span>' + e(FOM.dt(new Date().toISOString())) + '</span></div></body></html>';
    var d = FOM.dlg({ title: '<i class="fa-solid fa-print"></i> Order ' + esc(o.OrderNumber), xwide: true, body: '<iframe class="fom-prev" data-f></iframe>', buttons: [{ label: '<i class="fa-solid fa-print"></i> Print / Save as PDF', act: 'print', cls: 'primary' }, { label: 'Close', act: 'close' }], onAction: function (a, dd) { if (a === 'print') { dd.q('[data-f]').contentWindow.focus(); dd.q('[data-f]').contentWindow.print(); return false; } } });
    d.q('[data-f]').srcdoc = html;
};
