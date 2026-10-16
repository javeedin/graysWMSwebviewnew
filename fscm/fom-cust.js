/* Fusion Order Management — Customers (spec §6: BI Publisher customer search, read-only) and Price List (spec §7 was a
   placeholder — built on the Fusion REST priceLists resource + items with their charges, as the "From Price List" panel). */

FOM.viewCustomers = function (el) {
    var S = FOM.CS || (FOM.CS = { rows: [], type: 'name' });
    el.innerHTML = '<div class="card"><div class="filters"><label>Search type<select data-t><option value="name">By Name</option><option value="account">By Account</option></select></label><label>Business unit<select data-bu><option value="">Any (optional)</option></select></label><label style="flex:1">Search term *<input data-q placeholder="Customer name or account number" style="min-width:260px"></label><div class="go"><button class="btn primary" data-s><i class="fa-solid fa-magnifying-glass"></i> Search</button></div></div></div>' +
        '<div class="kpis" data-k></div><div class="card pad" style="flex:1;min-height:300px"><div data-res></div><div class="muted" data-src style="font-size:.7rem;margin-top:6px"></div></div>';
    var q = function (s) { return el.querySelector(s); };
    q('[data-t]').value = S.type;
    FOM.bus().then(function (l) { q('[data-bu]').innerHTML = '<option value="">Any (optional)</option>' + FOM.opts(l, S.bu || ''); }).catch(function () { });
    function kpis() { var r = S.rows; q('[data-k]').innerHTML = r.length ? [['Customers', r.length], ['Active', r.filter(function (c) { return c.status === 'A'; }).length], ['Inactive', r.filter(function (c) { return c.status !== 'A'; }).length], ['Total credit limit', FOM.amt(FOM.sum(r, function (c) { return c.prCreditLimit != null ? c.prCreditLimit : c.creditLimit; }))]].map(function (k) { return '<div class="kpi"><b>' + k[1] + '</b><span>' + k[0] + '</span></div>'; }).join('') : ''; }
    function draw() {
        kpis();
        if (!S.searched) { q('[data-res]').innerHTML = '<div class="empty"><i class="fa-solid fa-users"></i>Search customer accounts by name or account number.</div>'; return; }
        FOM.ptable(q('[data-res]'), { rows: S.rows, pageSize: 20, filter: function (c) { return [c.accountName, c.accountNumber, c.partyNumber, c.city, c.country, c.status].join(' '); }, empty: 'No customers found.',
            cols: [{ label: 'Account Name', html: function (c) { return '<b>' + esc(c.accountName || '') + '</b>'; } }, { f: 'accountNumber', label: 'Account Number', mono: 1 }, { f: 'partyNumber', label: 'Party Number', mono: 1 }, { f: 'city', label: 'City' }, { f: 'country', label: 'Country' }, { label: 'Credit Limit', n: 1, html: function (c) { return FOM.amt(c.prCreditLimit != null ? c.prCreditLimit : c.creditLimit); } }, { label: 'Status', html: function (c) { return c.status === 'A' ? '<span class="chip ok">Active</span>' : '<span class="chip err">Inactive</span>'; } }, { label: '', html: function () { return '<button class="btn sm" data-ra="view"><i class="fa-solid fa-eye"></i> View</button>'; } }],
            onRow: FOM.custDrawer, onAct: function (a, c) { FOM.custDrawer(c); } });
    }
    function go() {
        var t = q('[data-q]').value.trim(); if (!t) { FX.toast('Please enter a search term', 'err'); return; }
        S.type = q('[data-t]').value; S.bu = q('[data-bu]').value;
        q('[data-res]').innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Running the customer search report…</div>';
        FOM.searchCustomers(S.bu, t, S.type).then(function (l) { S.rows = l; S.searched = true; q('[data-src]').textContent = 'Source: ' + (l.source || '') + ' · ' + FOM.cfg('bipCustomer'); draw(); }).catch(function (e) { q('[data-res]').innerHTML = '<div class="note err" style="white-space:pre-wrap">' + esc(FOM.emsg(e)) + '</div>'; });
    }
    q('[data-s]').onclick = go; q('[data-q]').onkeydown = function (e) { if (e.key === 'Enter') go(); };
    draw();
};
FOM.custDrawer = function (c) {
    FX.drawer({
        title: esc(c.accountName || ''), sub: 'Account ' + esc(c.accountNumber || '') + ' · Party ' + esc(c.partyNumber || ''), width: 640,
        chips: [c.status === 'A' ? '<span class="chip ok">Active</span>' : '<span class="chip err">Inactive</span>'], raw: c,
        facts: [['Account Number', '<span class="mono">' + esc(c.accountNumber || '') + '</span>'], ['Party Number', esc(c.partyNumber || '')], ['Status', c.status === 'A' ? 'Active' : 'Inactive'], ['City', esc(c.city || '')], ['Country', esc(c.country || '')], ['Address', esc([c.address1, c.address2].filter(Boolean).join(', '))], ['Credit Limit', '$' + FOM.amt(c.prCreditLimit != null ? c.prCreditLimit : c.creditLimit)], ['Customer class', esc(c.customerClassCode || '')], ['Business unit', esc(c.buName || '')], ['Cust Account Id', '<span class="mono">' + esc(c.custAccountId || '') + '</span>'], ['Party Id', '<span class="mono">' + esc(c.partyId || '') + '</span>'], ['Bill-to site use', '<span class="mono">' + esc(c.billToSiteUseId || '') + '</span>'], ['Ship-to party site', '<span class="mono">' + esc(c.shipToPartySiteId || '') + '</span>']],
        tabs: [{ label: 'Receivables', render: function (p) {
            p.innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading open receivables…</div>';
            FOM.custActivity(c.accountNumber).then(function (a) {
                if (!a) { p.innerHTML = '<div class="empty"><i class="fa-solid fa-scale-balanced"></i>No receivables activity.</div>'; return; }
                return FOM.openSchedules(a.BillToSiteUseId).catch(function () { return []; }).then(function (s) { var ag = FOM.aging(s); p.innerHTML = '<div class="kpis"><div class="kpi"><b>' + FOM.amt(a.TotalOpenReceivablesForSite) + '</b><span>Open receivables</span></div>' + [['Current', ag.cur], ['Over 30', ag.o30], ['Over 60', ag.o60], ['Over 90', ag.o90]].map(function (x) { return '<div class="kpi"><b>' + FOM.amt(x[1]) + '</b><span>' + x[0] + '</span></div>'; }).join('') + '</div>' + FOM.table(s, [{ f: 'TransactionNumber', label: 'Transaction' }, { label: 'Amount', n: 1, html: function (x) { return FOM.amt(x._amt); } }, { label: 'Due', html: function (x) { return esc(FOM.d(x._due)); } }, { label: 'Days', n: 1, html: function (x) { return String(x._days); } }, { label: 'Bucket', html: function (x) { return '<span class="chip ' + (x._bucket === 'Current' ? 'ok' : 'warn') + '">' + x._bucket + '</span>'; } }], { empty: 'No open installments.' }); });
            }).catch(function (e) { p.innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
        } }],
        actions: [{ label: 'Copy account #', icon: 'fa-copy', run: function () { FOM.copy(c.accountNumber || ''); } }, { label: 'Orders of this customer', icon: 'fa-file-lines', run: function () { FX.closeDrawer(); FOM.custOrders(c); } }]
    });
};
FOM.custOrders = function (c) {
    var d = FOM.dlg({ title: 'Recent orders — ' + esc(c.accountName || ''), xwide: true, body: '<div data-o><i class="fa-solid fa-circle-notch fa-spin"></i></div>' });
    FX.get('salesOrdersForOrderHub', { q: "BuyingPartyNumber='" + String(c.accountNumber || '').replace(/'/g, "''") + "'", orderBy: 'TransactionOn:desc', limit: 50, onlyData: false }).then(function (j) {
        var rows = j.items || [];
        d.q('[data-o]').innerHTML = FOM.table(rows, [{ label: 'Order', html: function (o) { return '<a class="fom-a" data-oo="' + rows.indexOf(o) + '">' + esc(o.OrderNumber) + '</a>'; } }, { f: 'SourceTransactionNumber', label: 'Source #' }, { label: 'Date', html: function (o) { return esc(FOM.d(o.TransactionOn)); } }, { label: 'Status', html: function (o) { return FOM.chip(o.Status, o.StatusCode); } }, { f: 'TransactionTypeCode', label: 'Type' }, { f: 'TransactionalCurrencyCode', label: 'Ccy' }], { empty: 'No orders for this customer.' });
        d.box.addEventListener('click', function (e) { var a = e.target.closest('[data-oo]'); if (a) { d.close(); FOM.openOrder(rows[+a.getAttribute('data-oo')]); } });
    }).catch(function (e) { d.q('[data-o]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
};

// ── Price List ─────────────────────────────────────────────────
FOM.viewPriceList = function (el) {
    var g = FX.grid(el, {
        id: 'fpl', resource: 'priceLists', pageSize: 100, csvName: 'price_lists', autoLoad: true,
        filters: [
            { id: 'name', label: 'Name', ph: 'contains', q: function (v) { return FX.like('Name', v); } },
            { id: 'no', label: 'Price list number', q: function (v) { return 'PriceListNumber=' + FOM.qv(v); } },
            { id: 'ccy', label: 'Currency', type: 'select', options: [{ v: '', t: 'Any' }].concat(FOM.currencies().map(function (c) { return { v: c, t: c }; })), q: function (v) { return 'CurrencyCode=' + FOM.qv(v); } },
            { id: 'st', label: 'Status', type: 'select', options: [{ v: '', t: 'Any' }, { v: 'APPROVED', t: 'Approved' }, { v: 'IN_PROGRESS', t: 'In progress' }], q: function (v) { return 'StatusCode=' + FOM.qv(v); } }
        ],
        columns: [
            { label: 'Name', get: function (r) { return r.Name || r.PriceListName; }, html: function (r) { return '<b>' + esc(r.Name || r.PriceListName || '') + '</b>'; } }, { f: 'PriceListNumber', label: 'Number', fmt: 'mono' }, { f: 'Description', label: 'Description' },
            { label: 'Currency', get: function (r) { return r.CurrencyCode || r.Currency; } }, { label: 'Status', get: function (r) { return r.StatusCode || r.Status; }, fmt: 'chip' },
            { label: 'Type', get: function (r) { return r.PriceListTypeCode || r.PriceListType; } }, { label: 'Line type', get: function (r) { return r.LineTypeCode || r.LineType; } },
            { label: 'Business unit', get: function (r) { return r.BusinessUnit || r.BusinessUnitName; } },
            { label: 'Start', get: function (r) { return r.StartDate; }, html: function (r) { return esc(FOM.d(r.StartDate)); } }, { label: 'End', get: function (r) { return r.EndDate; }, html: function (r) { return esc(FOM.d(r.EndDate)); } }
        ],
        kpis: function (rows) { var ccys = FOM.distinct(rows.map(function (r) { return r.CurrencyCode || r.Currency; })); return [{ k: 'n', label: 'Price lists', value: rows.length }, { k: 'a', label: 'Approved', value: rows.filter(function (r) { return /APPROVED/i.test(r.StatusCode || r.Status || ''); }).length, filter: function (r) { return /APPROVED/i.test(r.StatusCode || r.Status || ''); } }, { k: 'c', label: 'Currencies', value: ccys.join(', ') || '—' }]; },
        actions: [{ label: 'Where is an item priced?', icon: 'fa-magnifying-glass-dollar', run: function (g2) { FOM.itemPriceLookup(g2.rows); } }],
        onRow: function (r) { FOM.priceListDrawer(r); }
    });
    return g;
};
FOM.priceListDrawer = function (pl) {
    var items = [];
    FX.drawer({
        title: esc(pl.Name || pl.PriceListName || ''), sub: esc([pl.PriceListNumber, pl.CurrencyCode || pl.Currency, pl.Description].filter(Boolean).join(' · ')), width: 1000, raw: pl,
        chips: [FX.chip(pl.StatusCode || pl.Status)],
        facts: FX.facts(pl, [['Price list id', 'PriceListId'], ['Number', 'PriceListNumber'], ['Currency', function (r) { return r.CurrencyCode || r.Currency; }], ['Status', function (r) { return r.StatusCode || r.Status; }], ['Type', function (r) { return r.PriceListTypeCode || r.PriceListType; }], ['Line type', function (r) { return r.LineTypeCode || r.LineType; }], ['Business unit', function (r) { return r.BusinessUnit || r.BusinessUnitName; }], ['Start', 'StartDate', 'date'], ['End', 'EndDate', 'date'], ['Pricing strategy', 'PricingStrategy'], ['Created', 'CreationDate', 'dt'], ['Updated', 'LastUpdateDate', 'dt']]),
        tabs: [{ label: 'Items & prices', render: function (p) {
            p.innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading items…</div>';
            FOM.priceListItems(pl.PriceListId, function (n) { p.innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> ' + n + ' items…</div>'; }).then(function (r) {
                items = r.map(function (it) { return Object.assign(it, { _item: FOM.pf(it, ['Item', 'ItemNumber', 'ProductNumber']), _desc: FOM.pf(it, ['Description', 'ItemDescription', 'ProductDescription']) || '', _price: FOM.plPrice(it), _uom: FOM.pf(it, ['PricingUOMCode', 'PrimaryUOMCode', 'UOMCode']) || '' }); });
                var ccy = pl.CurrencyCode || pl.Currency || '';
                p.innerHTML = (r.truncated ? '<div class="note warn">First 1,500 items only.</div>' : '') + '<div class="kpis" style="margin-bottom:8px"><div class="kpi"><b>' + items.length + '</b><span>Items</span></div><div class="kpi"><b>' + items.filter(function (i) { return i._price == null; }).length + '</b><span>Without a price</span></div><div class="kpi"><b>' + FOM.amt(items.length ? FOM.sum(items, '_price') / Math.max(1, items.filter(function (i) { return i._price != null; }).length) : 0) + '</b><span>Average list price</span></div></div><div data-pt></div>';
                FOM.ptable(p.querySelector('[data-pt]'), { rows: items, pageSize: 50, filter: function (i) { return i._item + ' ' + i._desc; }, tools: '<button class="btn sm" data-x><i class="fa-solid fa-file-excel"></i> Excel</button>',
                    cols: [{ label: 'Item', html: function (i) { return '<span class="mono">' + esc(i._item) + '</span>'; } }, { label: 'Description', html: function (i) { return esc(i._desc); } }, { f: 'LineType', label: 'Line type' }, { label: 'UOM', html: function (i) { return esc(i._uom); } }, { label: 'List price', n: 1, html: function (i) { return i._price != null ? FOM.amt(i._price) + ' <span class="muted">' + esc(ccy) + '</span>' : '<span class="muted">—</span>'; } }, { label: 'Charges', n: 1, html: function (i) { return String((i.charges || []).length); } }, { label: '', html: function () { return '<button class="btn sm icon" data-ra="ch" title="Charges"><i class="fa-solid fa-receipt"></i></button>'; } }],
                    onAct: function (a, i) { FOM.dlg({ title: 'Charges — ' + esc(i._item), wide: true, body: FOM.table(i.charges || [], FOM.dyn(i.charges || []), { empty: 'No charges.' }) }); } });
                p.querySelector('[data-x]').onclick = function () { FOM.xlsx('PriceList_' + String(pl.Name || pl.PriceListId).replace(/[^\w-]+/g, '_') + '_' + FOM.ts() + '.xlsx', [{ name: 'Items', aoa: [['Price list', pl.Name || ''], ['Currency', ccy], [], ['Item', 'Description', 'Line Type', 'UOM', 'List Price']].concat(items.map(function (i) { return [i._item, i._desc, i.LineType || '', i._uom, i._price]; })), cols: [20, 40, 14, 8, 12] }]); };
            }).catch(function (e) { p.innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
        } }]
    });
};
/** Which of the listed price lists price an item (one REST call per list, at most 60 lists). */
FOM.itemPriceLookup = function (lists) {
    var d = FOM.dlg({ title: 'Where is an item priced?', wide: true, body: '<div class="row-btns"><input class="fom-in" data-q placeholder="Item number" style="flex:1"><button class="btn primary" data-s><i class="fa-solid fa-magnifying-glass"></i> Look up</button></div><div class="muted" style="font-size:.74rem">Checks the ' + Math.min(60, lists.length) + ' price list(s) currently in the grid.</div><div data-r></div>' });
    function go() {
        var it = d.q('[data-q]').value.trim(); if (!it) return; var ls = lists.slice(0, 60), hits = [];
        d.q('[data-r]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Checking ' + ls.length + ' list(s)…';
        FOM.mapLimit(ls, 4, function (pl) { return FX.get('priceLists/' + pl.PriceListId + '/child/items', { q: 'Item=' + FOM.qv(it), expand: 'charges', limit: 5 }).then(function (j) { (j.items || []).forEach(function (x) { hits.push({ pl: pl, it: x }); }); }).catch(function () { }); })
            .then(function () { d.q('[data-r]').innerHTML = FOM.table(hits, [{ label: 'Price list', html: function (h) { return '<b>' + esc(h.pl.Name || h.pl.PriceListName || '') + '</b>'; } }, { label: 'Currency', html: function (h) { return esc(h.pl.CurrencyCode || ''); } }, { label: 'UOM', html: function (h) { return esc(FOM.pf(h.it, ['PricingUOMCode', 'PrimaryUOMCode', 'UOMCode']) || ''); } }, { label: 'List price', n: 1, html: function (h) { var v = FOM.plPrice(h.it); return v != null ? FOM.amt(v) : '—'; } }, { label: 'Status', html: function (h) { return FX.chip(h.pl.StatusCode); } }], { empty: 'Item ' + it + ' is not on these price lists.' }); });
    }
    d.q('[data-s]').onclick = go; d.q('[data-q]').onkeydown = function (e) { if (e.key === 'Enter') go(); };
};
