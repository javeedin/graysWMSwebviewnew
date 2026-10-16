/* Fusion Inventory — Manage On-hand: search grouped per item, item tabs with lots, serials, costs, distributions,
   transactions and purchase orders. Grouping covers every storage line found (not just one page). */

INV.onhand = {
    id: 'onhand', label: 'Manage On-hand', icon: 'fa-cubes', group: 'Stock', desc: 'On-hand balances per item, with lots, serials, costs and transactions',
    render: function (el) {
        var tabs = IU.tabs(el, [{ id: 'search', label: 'Search', icon: 'fa-magnifying-glass', render: searchTab }]);
        function searchTab(p) {
            var st = { raw: [], groups: [] }, grid;
            p.innerHTML = IU.filterCard([
                { label: 'Organization', req: 1, html: '<select id="oh-org"></select>' },
                { label: 'Item Number', html: IU.inp('oh-item', 'starts with…') },
                { label: 'Subinventory', html: '<select id="oh-sub"><option value="">All</option></select>' }
            ], '<button class="btn" id="oh-reset"><i class="fa-solid fa-eraser"></i> Reset</button><button class="btn primary" id="oh-go"><i class="fa-solid fa-magnifying-glass"></i> Search</button>') +
                '<div id="oh-grid" style="display:flex;flex-direction:column;flex:1;min-height:0;gap:10px"></div>';
            var last = lsGet('fxinv_oh_org', '');
            IU.orgOptions('oh-org', last, '— select —').then(function () { if ($('oh-org').value) loadSubs(); });
            $('oh-org').onchange = loadSubs;
            function loadSubs() { var o = $('oh-org').value; if (!o) { $('oh-sub').innerHTML = '<option value="">All</option>'; return; } FX.fillSelect('oh-sub', FX.subinvs(o), '', 'All'); }
            $('oh-go').onclick = search; IU.enter(['oh-item'], search);
            $('oh-reset').onclick = function () { $('oh-item').value = ''; $('oh-sub').value = ''; st.raw = []; st.groups = []; grid.refresh(); };
            grid = IU.localGrid($('oh-grid'), {
                id: 'oh', rows: function () { return st.groups; }, csvName: 'onhand_by_item', emptyText: 'Pick an organization and search.',
                kpis: function (g) {
                    if (!g.length) return [];
                    return [{ k: 'i', label: 'Items', value: g.length.toLocaleString() }, { k: 'l', label: 'Storage lines', value: st.raw.length.toLocaleString() },
                        { k: 'z', label: 'Zero on-hand', value: g.filter(function (x) { return x.TotalQty <= 0; }).length, filter: function (x) { return x.TotalQty <= 0; } },
                        { k: 'q', label: 'Total qty', value: IU.compact(IU.sum(g, 'TotalQty')) }];
                },
                columns: [
                    { f: 'ItemNumber', label: 'Item Number', html: function (r) { return '<button class="lnk" data-open>' + esc(r.ItemNumber) + '</button>'; } },
                    { f: 'ItemDescription', label: 'Description' }, { f: 'OrganizationCode', label: 'Org' },
                    { label: 'Subinventories', get: function (r) { return r.Subinventories.join(' '); }, html: function (r) { return r.Subinventories.map(function (s) { return '<span class="tag">' + esc(s) + '</span>'; }).join(''); } },
                    { f: 'LineCount', label: 'Lines', n: 1, html: function (r) { return '<span class="chip">' + r.LineCount + '</span>'; } },
                    { f: 'TotalQty', label: 'Total On-Hand', n: 1, html: function (r) { return '<span class="' + IU.qtyCls(r.TotalQty) + '">' + IU.qty(r.TotalQty) + '</span> <span class="muted">' + esc(r.UOM || '') + '</span>'; } },
                    { f: 'MaterialStatus', label: 'Status', html: function (r) { return r.MaterialStatus ? '<span class="chip ' + (/^active$/i.test(r.MaterialStatus) ? 'ok' : 'warn') + '">' + esc(r.MaterialStatus) + '</span>' : ''; } },
                    { f: 'LastUpdateDate', label: 'Last Updated', html: function (r) { return esc(IU.d(r.LastUpdateDate)); } }
                ],
                rowActions: [{ label: 'Open item', icon: 'fa-circle-info', run: function (r) { openItem(r); } }],
                onRow: function (r) { openItem(r); }
            });
            p.querySelector('#oh-grid').addEventListener('click', function (e) { var b = e.target.closest('[data-open]'); if (b) { var tr = b.closest('tr[data-r]'); openItem(grid.view[+tr.getAttribute('data-r')]); } });
            function search() {
                var org = $('oh-org').value; if (!org) { FX.toast('Organization Code is required', 'err'); return; }
                lsSet('fxinv_oh_org', org);
                var q = ['OrganizationCode=' + FX.qv(org)], item = $('oh-item').value.trim(), sub = $('oh-sub').value;
                if (item) q.push('ItemNumber LIKE ' + FX.qv(item.replace(/\*/g, '%') + '%'));
                if (sub) q.push('SubinventoryCode=' + FX.qv(sub));
                grid.loading('Reading on-hand…');
                IU.pages('inventoryOnhandBalances', { q: q.join(';'), onlyData: false }, 500, 20000, function (n, t) { grid.loading('Loaded ' + n + (t ? ' of ' + t : '') + ' storage lines…'); }).then(function (r) {
                    st.raw = r.rows; st.groups = group(r.rows); grid.refresh();
                    if (r.total && r.total > r.rows.length) FX.toast('Showing the first ' + r.rows.length + ' of ' + r.total + ' storage lines — narrow the search.');
                }).catch(grid.error);
            }
            function group(rows) {
                var m = {}, out = [];
                rows.forEach(function (r) {
                    var k = r.ItemNumber + '::' + r.OrganizationCode, g = m[k];
                    if (!g) { g = m[k] = { key: k, ItemNumber: r.ItemNumber, ItemDescription: r.ItemDescription, OrganizationCode: r.OrganizationCode, UOM: r.PrimaryUOMCode || r.PrimaryUnitOfMeasure, TotalQty: 0, Subinventories: [], LineCount: 0, MaterialStatus: r.MaterialStatus, LastUpdateDate: r.LastUpdateDate, rows: [] }; out.push(g); }
                    g.TotalQty += IU.num(r.PrimaryQuantity) || 0; g.LineCount++; g.rows.push(r);
                    if (r.SubinventoryCode && g.Subinventories.indexOf(r.SubinventoryCode) < 0) g.Subinventories.push(r.SubinventoryCode);
                    if (r.LastUpdateDate && (!g.LastUpdateDate || r.LastUpdateDate > g.LastUpdateDate)) g.LastUpdateDate = r.LastUpdateDate;
                });
                return out;
            }
        }
        function openItem(g) {
            var id = 'it:' + g.key;
            tabs.add({ id: id, label: g.ItemNumber + ' · ' + g.OrganizationCode, icon: 'fa-cube', back: 'search', render: function (p) { ohItemTab(p, g); } }, true);
        }
    }
};

function ohItemTab(p, g) {
    var rows = g.rows, item = g.ItemNumber, org = g.OrganizationCode, uom = g.UOM || '';
    var lotsP = null, serP = null;
    function lotsOf() {
        if (!lotsP) lotsP = IU.mapLimit(rows.filter(function (r) { return IU.link(r, 'lots'); }), 6, function (r) {
            return IU.allHref(IU.link(r, 'lots')).then(function (ls) { return ls.map(function (l) { l._subinventory = r.SubinventoryCode; l._locator = r.Locator || r.LocatorName || ''; return l; }); });
        }).then(function (res) { var all = []; res.forEach(function (x) { if (x.ok) all = all.concat(x.v); }); return all; });
        return lotsP;
    }
    var consigned = IU.sum(rows, 'ConsignedQuantity');
    p.innerHTML = '<div class="card hdr-card"><h3><i class="fa-solid fa-cube" style="color:var(--accent)"></i><span class="mono" style="font-size:1rem">' + esc(item) + '</span></h3><span class="muted">' + esc(g.ItemDescription || '') + '</span><span class="chip">' + esc(org) + '</span><span class="grow" style="flex:1"></span></div>' +
        '<div id="ohs-' + esc(g.key).replace(/[^a-z0-9]/gi, '_') + '"></div><div class="ohd" style="display:flex;flex-direction:column;flex:1;min-height:0"></div>';
    var statsEl = p.children[1];
    function drawStats(lots) {
        statsEl.innerHTML = IU.stats([{ label: 'Total On-Hand' + (uom ? ' (' + uom + ')' : ''), value: IU.qty(g.TotalQty), cls: g.TotalQty > 0 ? 'ok' : 'err' }, { label: 'Storage Lines', value: rows.length },
            { label: 'Total Lots', value: lots == null ? '…' : lots.length }, { label: 'Consigned', value: IU.qty(consigned) }, { label: 'Status', value: esc(g.MaterialStatus || '—') }]);
    }
    drawStats(null);
    lotsOf().then(drawStats, function () { drawStats([]); });
    var hasSerials = rows.some(function (r) { return IU.link(r, 'serials'); });
    var list = [
        { id: 'sum', label: 'Summary', icon: 'fa-chart-simple', render: summary },
        { id: 'lots', label: 'Lots', icon: 'fa-tags', render: lotsTab }
    ].concat(hasSerials ? [{ id: 'ser', label: 'Serials', icon: 'fa-hashtag', render: serialsTab }] : []).concat([
        { id: 'rc', label: 'Receipt Costs', icon: 'fa-receipt', render: function (el) { costLoad(el, 'receipt'); } },
        { id: 'ic', label: 'Item Costs', icon: 'fa-coins', render: function (el) { costLoad(el, 'item'); } },
        { id: 'cd', label: 'Cost Distributions', icon: 'fa-sitemap', render: distTab },
        { id: 'tx', label: 'Inventory Transactions', icon: 'fa-right-left', render: txTab },
        { id: 'po', label: 'Purchase Order', icon: 'fa-file-invoice', render: poTab }
    ]);
    IU.tabs(p.children[2], list, { inner: true });

    function summary(el) {
        var facts = [['Item Number', item], ['Description', g.ItemDescription], ['Organization', org], ['UOM', uom], ['Material Status', g.MaterialStatus], ['Summary Level', rows[0].SummaryLevel], ['Inventory Item ID', rows[0].InventoryItemId], ['Organization ID', rows[0].OrganizationId]];
        var cols = [{ f: 'SubinventoryCode', label: 'Subinventory' }, { label: 'Locator', get: function (r) { return r.Locator || r.LocatorName; } }, { f: 'PrimaryQuantity', label: 'Quantity', n: 1, html: function (r) { return '<span class="' + IU.qtyCls(r.PrimaryQuantity) + '">' + IU.qty(r.PrimaryQuantity) + '</span>'; } },
            { f: 'ConsignedQuantity', label: 'Consigned', n: 1, html: function (r) { return IU.qty(r.ConsignedQuantity); } }, { f: 'MaterialStatus', label: 'Material Status' }, { f: 'Revision', label: 'Revision' }, { label: 'Last Update', html: function (r) { return IU.d(r.LastUpdateDate); } }];
        el.innerHTML = '<div class="card pad"><div class="facts">' + facts.map(function (f) { return '<div><span>' + esc(f[0]) + '</span>' + esc(f[1] == null ? '—' : f[1]) + '</div>'; }).join('') + '</div></div>' +
            '<div class="card" style="overflow:auto">' + FX.table(rows, cols).replace('</tbody>', '</tbody><tfoot><tr><td>Total</td><td></td><td class="n">' + IU.qty(g.TotalQty) + '</td><td class="n">' + IU.qty(consigned) + '</td><td></td><td></td><td></td></tr></tfoot>') + '</div>';
    }
    function lotsTab(el) {
        el.innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading lots…</div>';
        lotsOf().then(function (lots) {
            if (!lots.length) { el.innerHTML = '<div class="empty"><i class="fa-solid fa-tags"></i>No lots for this item (not lot controlled, or no lot links).</div>'; return; }
            IU.localGrid(el, {
                id: 'ohl', rows: function () { return lots; }, csvName: 'lots_' + item, autoLoad: true,
                columns: [{ f: '_subinventory', label: 'Subinventory' }, { f: '_locator', label: 'Locator' }, { f: 'LotNumber', label: 'Lot', fmt: 'mono' },
                    { f: 'PrimaryQuantity', label: 'Quantity', n: 1, get: function (r) { return IU.num(r.PrimaryQuantity); }, html: function (r) { return IU.qty(r.PrimaryQuantity); } }, { f: 'PrimaryUOMCode', label: 'UOM' },
                    { f: 'ExpirationDate', label: 'Expires', html: function (r) { return r.ExpirationDate ? '<span class="chip warn">' + esc(IU.d(r.ExpirationDate)) + '</span>' : ''; } },
                    { f: 'OriginationDate', label: 'Origination', html: function (r) { return IU.d(r.OriginationDate); } }, { f: 'MaterialStatus', label: 'Material Status' }],
                rowActions: [{ label: 'Serials', icon: 'fa-hashtag', when: function (r) { return !!IU.link(r, 'lotSerials'); }, run: function (r) { serialDrawer('Serials of lot ' + r.LotNumber, [IU.link(r, 'lotSerials')]); } },
                    { label: 'All fields', icon: 'fa-list', run: function (r) { IU.allFields('Lot ' + r.LotNumber, r); } }]
            });
        }).catch(function (e) { el.innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
    }
    var serCols = [{ f: 'SerialNumber', label: 'Serial', fmt: 'mono' }, { f: 'CurrentStatus', label: 'Status' }, { f: 'LotNumber', label: 'Lot' }, { f: '_subinventory', label: 'Subinventory' }, { label: 'Created', html: function (r) { return IU.d(r.CreationDate); } }, { label: 'Updated', html: function (r) { return IU.d(r.LastUpdateDate); } }];
    function serialDrawer(title, hrefs) {
        var d = FX.drawer({ title: esc(title), extra: '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading serials…</div>' });
        Promise.all(hrefs.map(function (h) { return IU.allHref(h); })).then(function (res) {
            var all = [].concat.apply([], res), b = $('fx-drawer-b'); if (!b) return;
            b.innerHTML = all.length ? FX.table(all, serCols) : '<div class="empty">No serials.</div>';
        }).catch(function (e) { var b = $('fx-drawer-b'); if (b) b.innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
        return d;
    }
    function serialsTab(el) {
        el.innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading serials…</div>';
        if (!serP) serP = IU.mapLimit(rows.filter(function (r) { return IU.link(r, 'serials'); }), 6, function (r) { return IU.allHref(IU.link(r, 'serials')).then(function (s) { return s.map(function (x) { x._subinventory = r.SubinventoryCode; return x; }); }); })
            .then(function (res) { var all = []; res.forEach(function (x) { if (x.ok) all = all.concat(x.v); }); return all; });
        serP.then(function (all) {
            if (!all.length) { el.innerHTML = '<div class="empty"><i class="fa-solid fa-hashtag"></i>No serials for this item.</div>'; return; }
            IU.localGrid(el, { id: 'ohsr', rows: function () { return all; }, columns: serCols, csvName: 'serials_' + item, autoLoad: true, rowActions: [{ label: 'All fields', icon: 'fa-list', run: function (r) { IU.allFields('Serial ' + r.SerialNumber, r); } }] });
        });
    }
    function costLoad(el, kind) {
        el.innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading ' + (kind === 'item' ? 'item costs' : 'receipt costs') + '…</div>';
        var job = kind === 'item' ? FX.restAll('itemCosts', { version: 'latest', q: 'ItemNumber=' + FX.qv(item) }, 5000) : FX.restAll('receiptCosts', { q: 'Item=' + FX.qv(item) }, 5000);
        job.then(function (r) {
            if (!r.length) { el.innerHTML = '<div class="empty"><i class="fa-solid fa-coins"></i>No ' + (kind === 'item' ? 'item' : 'receipt') + ' costs for ' + esc(item) + '.<br><button class="btn sm" style="margin-top:8px">Refresh</button></div>'; el.querySelector('button').onclick = function () { costLoad(el, kind); }; return; }
            IU.costTable(el, r, { refresh: function () { costLoad(el, kind); }, csvName: kind + '_costs_' + item });
        }).catch(function (e) { el.innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
    }
    function distTab(el) {
        el.innerHTML = '<div class="toolbar"><select id="cd-tx-' + esc(g.key).replace(/[^a-z0-9]/gi, '_') + '" style="min-width:320px"><option>Loading transaction ids…</option></select><button class="btn primary" data-cdgo><i class="fa-solid fa-download"></i> Retrieve Distributions</button><span class="muted" data-cdn style="font-size:.78rem"></span></div><div data-cdg style="display:flex;flex-direction:column;flex:1;min-height:0"></div>';
        var sel = el.querySelector('select'), ids = [];
        FX.restAll('itemCosts', { version: 'latest', q: 'ItemNumber=' + FX.qv(item) }, 5000).then(function (r) {
            var m = {}; r.forEach(function (x) { if (x.TransactionId != null && !m[x.TransactionId]) { m[x.TransactionId] = 1; ids.push({ id: x.TransactionId, rc: x.ReceiptNumber, ref: x.ReferenceNumber }); } });
            sel.innerHTML = '<option value="">All transactions (' + ids.length + ')</option>' + ids.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.id + (t.rc ? ' · Rcpt ' + t.rc : '') + (t.ref ? ' · Ref ' + t.ref : '')) + '</option>'; }).join('');
        }).catch(function (e) { sel.innerHTML = '<option value="">(could not read item costs)</option>'; FX.toast(String(e), 'err'); });
        el.querySelector('[data-cdgo]').onclick = function () {
            var pick = sel.value ? [sel.value] : ids.map(function (t) { return t.id; });
            if (!pick.length) { FX.toast('No transaction ids found on the item costs of this item.', 'err'); return; }
            var box = el.querySelector('[data-cdg]'); box.innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading distributions of ' + pick.length + ' transaction(s)…</div>';
            IU.mapLimit(pick, 6, function (id) { return FX.restAll('costDistributions', { q: 'TransactionId=' + id }, 5000).then(function (r) { return r.map(function (x) { x._TransactionId = id; return x; }); }); }).then(function (res) {
                var all = [], errs = 0; res.forEach(function (x) { if (x.ok) all = all.concat(x.v); else errs++; });
                el.querySelector('[data-cdn]').textContent = all.length + ' distribution rows' + (errs ? ' · ' + errs + ' failed' : '');
                if (!all.length) { box.innerHTML = '<div class="empty">No distributions.</div>'; return; }
                var cols = IU.dynCols(all, true), ci = -1, ai = -1;
                cols.forEach(function (c, i) { if (c.f === 'CostElementCode') ci = i; if (ai < 0 && /^AccountedDr/i.test(c.f)) ai = i; });
                if (ci >= 0 && ai >= 0) { var ce = cols.splice(ci, 1)[0]; if (ci < ai) ai--; cols.splice(ai + 1, 0, ce); }
                cols.unshift({ f: '_TransactionId', label: 'Transaction', fmt: 'mono' });
                IU.localGrid(box, { id: 'ohcd', rows: function () { return all; }, columns: cols, csvName: 'cost_distributions_' + item, autoLoad: true });
            });
        };
    }
    function txTab(el) {
        el.innerHTML = '<div class="toolbar"><button class="btn primary" data-txgo><i class="fa-solid fa-rotate"></i> Refresh</button><span class="muted" style="font-size:.78rem">Completed transactions of ' + esc(item) + ' in ' + esc(org) + '</span></div><div data-txg style="display:flex;flex-direction:column;flex:1;min-height:0"></div>';
        el.querySelector('[data-txgo]').onclick = load;
        function load() {
            var box = el.querySelector('[data-txg]'); box.innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading transactions…</div>';
            FX.restAll('inventoryCompletedTransactions', { q: 'Organization=' + FX.qv(org) + ';Item=' + FX.qv(item), onlyData: false }, 20000).then(function (r) {
                if (!r.length) { box.innerHTML = '<div class="empty">No transactions for ' + esc(item) + '</div>'; return; }
                IU.localGrid(box, {
                    id: 'ohtx', rows: function () { return r; }, columns: IU.dynCols(r, false), csvName: 'transactions_' + item, autoLoad: true,
                    rowActions: [{ label: 'Lots', icon: 'fa-tags', run: function (t) { txLots(t); } }, { label: 'All fields', icon: 'fa-list', run: function (t) { IU.allFields('Transaction ' + t.TransactionId, t); } }]
                });
            }).catch(function (e) { box.innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
        }
        load();
    }
    function txLots(t) {
        var href = IU.link(t, 'lots') || FX.url('inventoryCompletedTransactions/' + t.TransactionId + '/child/lots', { onlyData: false });
        FX.modal({ title: 'Lots of transaction ' + esc(t.TransactionId), wide: true, body: '<div id="iu-txl" class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading…</div>' });
        IU.allHref(href).then(function (ls) { var b = $('iu-txl'); if (b) { b.className = ''; b.innerHTML = ls.length ? FX.table(ls, IU.dynCols(ls, true)) : '<div class="empty">No lots on this transaction.</div>'; } })
            .catch(function (e) { var b = $('iu-txl'); if (b) b.innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
    }
    function poTab(el) {
        el.innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Finding purchase orders from receipt costs…</div>';
        FX.restAll('receiptCosts', { q: 'Item=' + FX.qv(item) }, 5000).then(function (rc) {
            var refs = IU.distinct(rc.map(function (r) { return r.ReferenceNumber; }));
            if (!refs.length) { el.innerHTML = '<div class="empty"><i class="fa-solid fa-file-invoice"></i>No Reference # (PO) found on receipt costs for this item.</div>'; return; }
            return IU.mapLimit(refs, 6, function (ref) {
                return FX.get('purchaseOrders', { q: 'OrderNumber=' + FX.qv(ref), onlyData: false }).then(function (j) {
                    var po = (j.items || [])[0]; if (!po) return [];
                    var href = IU.link(po, 'lines') || FX.url('purchaseOrders/' + po.POHeaderId + '/child/lines', { onlyData: false });
                    return IU.allHref(href).then(function (ls) { return ls.map(function (l) { l._orderNumber = po.OrderNumber || ref; return l; }); });
                });
            }).then(function (res) {
                var lines = [], pos = 0; res.forEach(function (x) { if (x.ok && x.v.length) { lines = lines.concat(x.v); pos++; } });
                el.innerHTML = '<div class="muted" style="font-size:.8rem">' + lines.length + ' line(s) · ' + pos + ' PO(s)</div><div data-pol style="display:flex;flex-direction:column;flex:1;min-height:0"></div>';
                var cols = [{ f: '_orderNumber', label: 'Order Number', html: function (r) { return '<button class="lnk" data-po="' + esc(r._orderNumber) + '">' + esc(r._orderNumber) + '</button>'; } }].concat(IU.dynCols(lines, true));
                IU.localGrid(el.querySelector('[data-pol]'), { id: 'ohpo', rows: function () { return lines; }, columns: cols, csvName: 'po_lines_' + item, autoLoad: true });
                el.onclick = function (e) { var b = e.target.closest('[data-po]'); if (b) IU.poDialog(b.getAttribute('data-po')); };
            });
        }).catch(function (e) { el.innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
    }
}
