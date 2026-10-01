/* Fusion Inventory — Transfer Orders: search orders / lines, create through Supply Chain Orchestration (supplyRequests),
   edit line quantity + need-by date, print and copy. */

INV.transfers = {
    id: 'transfers', label: 'Transfer Orders', icon: 'fa-truck-arrow-right', group: 'Movements', desc: 'Search, create, edit, print and copy transfer orders',
    render: function (el) {
        var linesCache = {}, newSeq = 0;
        function toLines(h) {
            var id = h.HeaderId;
            if (!linesCache[id]) linesCache[id] = IU.allHref(IU.link(h, 'transferOrderLines') || FX.url('transferOrders/' + id + '/child/transferOrderLines', { onlyData: false })).catch(function (e) { delete linesCache[id]; throw e; });
            return linesCache[id];
        }
        var tabs = IU.tabs(el, [
            { id: 'orders', label: 'Search Orders', icon: 'fa-magnifying-glass', render: ordersTab },
            { id: 'lines', label: 'Search Lines', icon: 'fa-list', render: linesTab },
            { id: 'new', label: 'New Transfer Order', icon: 'fa-plus', render: function (p) { newTO(p, null); } }
        ], { right: '<button class="btn sm primary" data-newto style="margin:4px"><i class="fa-solid fa-plus"></i> New Transfer Order</button>' });
        el.querySelector('.stabs').addEventListener('click', function (e) { if (e.target.closest('[data-newto]')) openNew(null); });
        function openNew(seed) {
            newSeq++;
            tabs.add({ id: 'new' + newSeq, label: 'New Transfer Order ' + (newSeq + 1), icon: 'fa-plus', render: function (p) { newTO(p, seed); } }, true);
        }
        function openEdit(h) { tabs.add({ id: 'edit' + h.HeaderId, label: 'Edit ' + h.HeaderNumber, icon: 'fa-pen', back: 'lines', render: function (p) { editTab(p, h); } }, true); }
        var statusCls = function (s) { s = String(s || '').toUpperCase(); return /CANCEL/.test(s) ? 'err' : /CLOSE/.test(s) ? '' : /SHIP/.test(s) ? 'ok' : /PROCESS|INTERFACE/.test(s) ? 'info' : /OPEN/.test(s) ? 'done' : 'info'; };
        var stChip = function (s) { return s ? '<span class="chip ' + statusCls(s) + '">' + esc(String(s).replace(/_/g, ' ')) + '</span>' : ''; };
        var L = {
            line: function (r) { return IU.first(r, ['DisplayLineNumber', 'LineNumber']); },
            item: function (r) { return IU.first(r, ['ItemNumber', 'Item']); }, desc: function (r) { return IU.first(r, ['ItemDescription', 'Description']); },
            src: function (r) { return IU.first(r, ['SourceOrganizationCode', 'SourceOrganization', 'ShipFromOrganizationCode']); },
            dst: function (r) { return IU.first(r, ['DestinationOrganizationCode', 'DestinationOrganization', 'ShipToOrganizationCode']); },
            uom: function (r) { return IU.first(r, ['QuantityUOMCode', 'UOMCode', 'UOMName', 'UnitOfMeasure', 'UOM']); },
            qty: function (r) { return IU.first(r, ['RequestedQuantity', 'Quantity', 'OrderedQuantity']); },
            ship: function (r) { return IU.first(r, ['ShippedQuantity', 'QuantityShipped']); }, rcv: function (r) { return IU.first(r, ['ReceivedQuantity', 'QuantityReceived']); },
            ssub: function (r) { return IU.first(r, ['SourceSubinventoryCode', 'SourceSubinventory']); }, dsub: function (r) { return IU.first(r, ['DestinationSubinventoryCode', 'DestinationSubinventory']); },
            rship: function (r) { return IU.first(r, ['RequestedShipDate', 'ScheduledShipDate']); }, rdel: function (r) { return IU.first(r, ['RequestedDeliveryDate', 'RequestedArrivalDate']); },
            status: function (r) { return IU.first(r, ['TransferOrderLineStatus', 'Status', 'StatusCode']); }
        };
        var green = function (v) { var n = IU.num(v); return n > 0 ? '<span class="qty-ok">' + IU.qty(n) + '</span>' : esc(IU.qty(n)); };
        var lineCols = [{ label: 'Line', get: L.line }, { label: 'Item', html: function (r) { return '<span class="tag code">' + esc(L.item(r)) + '</span>'; } }, { label: 'Description', get: L.desc },
            { label: 'Source Org', get: L.src }, { label: 'Dest Org', get: L.dst }, { label: 'UOM', get: L.uom }, { label: 'Requested', n: 1, html: function (r) { return IU.qty(L.qty(r)); } },
            { label: 'Shipped', n: 1, html: function (r) { return green(L.ship(r)); } }, { label: 'Received', n: 1, html: function (r) { return green(L.rcv(r)); } },
            { label: 'Src Subinv', get: L.ssub }, { label: 'Dst Subinv', get: L.dsub }, { label: 'Req. Ship', html: function (r) { return IU.d(L.rship(r)); } }, { label: 'Req. Delivery', html: function (r) { return IU.d(L.rdel(r)); } }, { label: 'Status', html: function (r) { return stChip(L.status(r)); } }];

        // ── Search Orders ──
        function ordersTab(p) {
            var st = { rows: [] }, grid;
            p.innerHTML = IU.filterCard([
                { label: 'Order Number', html: IU.inp('to-num', 'exact') }, { label: 'Business Unit', html: IU.inp('to-bu', 'starts with…') },
                { label: 'Status', html: '<select id="to-st"><option value="">All</option><option>Open</option><option>Closed</option><option>Canceled</option></select>' },
                { label: 'Interface Status', html: IU.inp('to-if', 'starts with…') },
                { label: 'Ordered Date', html: '<div style="display:flex;gap:4px">' + IU.opSel('to-op', '>') + IU.inp('to-date', '', FX.daysAgo(30), 'date') + '</div>' }
            ], '<button class="btn" id="to-reset"><i class="fa-solid fa-eraser"></i> Reset</button><button class="btn" id="to-print"><i class="fa-solid fa-print"></i> Print</button><button class="btn" id="to-copy"><i class="fa-solid fa-copy"></i> Copy</button><button class="btn primary" id="to-go"><i class="fa-solid fa-magnifying-glass"></i> Search</button>') +
                '<div id="to-grid" style="display:flex;flex-direction:column;flex:1;min-height:0;gap:10px"></div>';
            grid = IU.localGrid($('to-grid'), {
                id: 'to', rows: function () { return st.rows; }, select: true, key: 'HeaderId', csvName: 'transfer_orders', emptyText: 'No transfer orders matched.',
                kpis: function (r) { return r.length ? [{ k: 'n', label: 'Orders', value: r.length }, { k: 'o', label: 'Open', value: r.filter(function (x) { return /OPEN/i.test(x.Status); }).length, filter: function (x) { return /OPEN/i.test(x.Status); } }, { k: 'm', label: 'Multi-line', value: r.filter(function (x) { return x._lines > 1; }).length, filter: function (x) { return x._lines > 1; } }] : []; },
                columns: [
                    { f: 'OrderedDate', label: 'Ordered', html: function (r) { return esc(IU.d(r.OrderedDate)); } },
                    { f: 'HeaderNumber', label: 'Order', html: function (r) { return '<button class="lnk" data-edit="' + esc(r.HeaderId) + '">' + esc(r.HeaderNumber) + '</button>'; } },
                    { f: 'BusinessUnitName', label: 'Business Unit' },
                    { label: 'Lines', n: 1, get: function (r) { return r._lines; }, html: function (r) { return r._lines == null ? '<i class="fa-solid fa-circle-notch fa-spin muted"></i>' : '<span class="chip ' + (r._lines > 1 ? 'warn' : '') + '">' + r._lines + '</span>'; } },
                    { label: 'Source', get: function (r) { return (r.SourceTypeLookup || '') + ' ' + (r.SourceOfTransferOrder || ''); }, html: function (r) { return (r.SourceTypeLookup ? '<span class="tag">' + esc(r.SourceTypeLookup) + '</span>' : '') + esc(r.SourceOfTransferOrder || ''); } },
                    { f: 'Status', label: 'Status', html: function (r) { return stChip(r.Status); } }, { f: 'InterfaceStatus', label: 'Interface', html: function (r) { return stChip(r.InterfaceStatus); } },
                    { f: 'TotalTransferPrice', label: 'Total Price', n: 1, html: function (r) { return IU.price(r.TotalTransferPrice, r.CurrencyCode); } },
                    { f: 'CreatedBy', label: 'Created By' }, { f: 'CreationDate', label: 'Created', html: function (r) { return IU.d(r.CreationDate); } }
                ],
                onRow: function (h) { linesDrawer(h); }
            });
            $('to-grid').addEventListener('click', function (e) { var b = e.target.closest('[data-edit]'); if (b) { e.stopPropagation(); openEdit(st.rows.filter(function (h) { return String(h.HeaderId) === b.getAttribute('data-edit'); })[0]); } }, true);
            $('to-go').onclick = search; IU.enter(['to-num', 'to-bu', 'to-if'], search);
            $('to-reset').onclick = function () { ['to-num', 'to-bu', 'to-if'].forEach(function (i) { $(i).value = ''; }); $('to-st').value = ''; $('to-op').value = '>'; $('to-date').value = FX.daysAgo(30); search(); };
            $('to-print').onclick = function () { var sel = grid.selectedRows(); if (!sel.length) { FX.toast('Select one or more orders to print.', 'err'); return; } printOrders(sel); };
            $('to-copy').onclick = function () {
                var sel = grid.selectedRows(); if (sel.length !== 1) { FX.toast('Select exactly one order to copy', 'err'); return; }
                FX.busy('Reading lines of ' + sel[0].HeaderNumber + '…');
                toLines(sel[0]).then(function (ls) {
                    FX.busy();
                    if (!ls.length) { FX.toast('This order has no lines to copy', 'err'); return; }
                    var f = ls[0];
                    if (ls.some(function (l) { return l.SourceOrganizationCode !== f.SourceOrganizationCode || l.DestinationOrganizationCode !== f.DestinationOrganizationCode; })) FX.toast('Lines use different organizations — the first line\'s source / destination are used.');
                    var seed = { src: f.SourceOrganizationCode, dst: f.DestinationOrganizationCode, srcSub: f.SourceSubinventoryCode || '', dstSub: f.DestinationSubinventoryCode || '', needBy: f.NeedByDate ? String(f.NeedByDate).slice(0, 10) : '', lines: ls.map(function (l) { return { item: l.ItemNumber, qty: l.RequestedQuantity, uom: l.QuantityUOMCode || IU.cfg('toUom') }; }) };
                    var pane = tabs.pane('new'); pane.innerHTML = ''; newTO(pane, seed); tabs.show('new');
                    FX.toast('Copied ' + ls.length + ' line(s) from ' + sel[0].HeaderNumber + ' into the new transfer order.', 'ok');
                }).catch(function (e) { FX.busy(); FX.toast(String(e), 'err'); });
            };
            search();
            function search() {
                var q = [], v;
                if ((v = $('to-num').value.trim())) q.push('HeaderNumber="' + v + '"');
                if ((v = $('to-bu').value.trim())) q.push('BusinessUnitName LIKE "' + v + '*"');
                if ((v = $('to-st').value)) q.push('Status="' + v + '"');
                if ((v = $('to-if').value.trim())) q.push('InterfaceStatus LIKE "' + v + '*"');
                if ((v = $('to-date').value)) q.push('OrderedDate' + $('to-op').value + v);
                grid.loading('Reading transfer orders…');
                FX.restAll('transferOrders', { q: q.join(';'), orderBy: 'OrderedDate:desc', onlyData: false }, 10000).then(function (r) {
                    st.rows = r; linesCache = {}; grid.refresh();
                    IU.mapLimit(r, 6, function (h) {
                        return FX.get('transferOrders/' + h.HeaderId + '/child/transferOrderLines', { limit: 1, total: true }).then(function (j) { h._lines = j.totalResults != null ? j.totalResults : (j.items || []).length; }, function () { h._lines = '?'; });
                    }, function (d) { if (d % 6 === 0 || d === r.length) grid.render(); });
                }).catch(grid.error);
            }
        }
        function linesDrawer(h) {
            FX.drawer({
                title: esc(h.HeaderNumber), sub: esc((h.BusinessUnitName || '') + ' · ordered ' + IU.d(h.OrderedDate)), raw: h, chips: [stChip(h.Status), stChip(h.InterfaceStatus)],
                actions: [{ label: 'Edit', icon: 'fa-pen', cls: 'primary', run: function () { FX.closeDrawer(); openEdit(h); } }, { label: 'Print', icon: 'fa-print', run: function () { printOrders([h]); } }],
                facts: FX.facts(h, [['Order', 'HeaderNumber'], ['Business Unit', 'BusinessUnitName'], ['Source', 'SourceOfTransferOrder'], ['Status', 'Status', 'chip'], ['Interface Status', 'InterfaceStatus', 'chip'], ['Ordered', 'OrderedDate', 'date'], ['Total Price', function (r) { return IU.price(r.TotalTransferPrice, r.CurrencyCode); }, 'raw'], ['Created By', 'CreatedBy']]),
                tabs: [{ label: 'Lines', render: function (b) { b.innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading lines…</div>'; toLines(h).then(function (ls) { b.innerHTML = ls.length ? FX.table(ls, lineCols) : '<div class="empty">No lines.</div>'; }).catch(function (e) { b.innerHTML = '<div class="note err">' + esc(e) + '</div>'; }); } }]
            });
        }
        function printOrders(hs) {
            FX.busy('Preparing ' + hs.length + ' order(s)…');
            Promise.all(hs.map(function (h) { return toLines(h).catch(function () { return []; }); })).then(function (all) {
                FX.busy();
                var html = hs.map(function (h, i) {
                    var ls = all[i], ccy = (ls.filter(function (l) { return l.CurrencyCode; })[0] || h).CurrencyCode || '';
                    return '<div class="' + (i < hs.length - 1 ? 'pb' : '') + '"><h1>Transfer Order ' + esc(h.HeaderNumber) + '</h1><div class="hd">' +
                        [['Business Unit', h.BusinessUnitName], ['Status', h.Status], ['Interface Status', h.InterfaceStatus], ['Ordered', IU.d(h.OrderedDate)], ['Source', h.SourceOfTransferOrder]].map(function (x) { return '<div><span>' + x[0] + '</span>' + esc(x[1] || '') + '</div>'; }).join('') + '</div>' +
                        '<table><thead><tr><th>Line</th><th>Item</th><th>Description</th><th>Source</th><th>Destination</th><th>UOM</th><th class="n">Requested</th><th class="n">Shipped</th><th class="n">Received</th><th class="n">Unit Price</th><th class="n">Total</th></tr></thead><tbody>' +
                        ls.map(function (l) { return '<tr><td>' + esc(l.DisplayLineNumber || l.LineNumber) + '</td><td>' + esc(l.ItemNumber) + '</td><td>' + esc(l.ItemDescription) + '</td><td>' + esc((l.SourceOrganizationCode || '') + ' / ' + (l.SourceSubinventoryCode || '')) + '</td><td>' + esc((l.DestinationOrganizationCode || '') + ' / ' + (l.DestinationSubinventoryCode || '')) + '</td><td>' + esc(l.QuantityUOMCode) + '</td><td class="n">' + IU.qty(l.RequestedQuantity) + '</td><td class="n">' + IU.qty(l.ShippedQuantity) + '</td><td class="n">' + IU.qty(l.ReceivedQuantity) + '</td><td class="n">' + IU.price(l.UnitPrice) + '</td><td class="n">' + IU.price(l.TotalTransferPrice) + '</td></tr>'; }).join('') +
                        '</tbody></table><div class="foot">Total Transfer Price: ' + IU.price(IU.sum(ls, 'TotalTransferPrice'), ccy) + '</div></div>';
                }).join('') + '<div class="stamp">Generated ' + esc(new Date().toLocaleString()) + ' · ' + esc(FX.user) + ' · ' + esc(FX.instance) + '</div>';
                FX.modal({ title: '<i class="fa-solid fa-print"></i> Print ' + hs.length + ' transfer order(s)', wide: true, body: '<div style="border:1px solid var(--line);border-radius:10px;padding:14px;max-height:60vh;overflow:auto;font-size:.8rem" class="doc">' + html.replace(/class="pb"/g, 'style="border-bottom:2px dashed var(--line);padding-bottom:14px;margin-bottom:14px"') + '</div>', buttons: [{ label: 'Close', act: 'close' }, { label: '<i class="fa-solid fa-print"></i> Print', cls: 'primary', act: 'print' }], onAction: function (a) { if (a === 'print') { IU.print('Transfer Orders', html); return false; } } });
            });
        }

        // ── Search Lines ──
        function linesTab(p) {
            var st = { rows: [], cnt: {} }, grid;
            p.innerHTML = IU.filterCard([{ label: 'Ordered Date', html: '<div style="display:flex;gap:4px">' + IU.opSel('tl-op', '>') + IU.inp('tl-date', '', FX.daysAgo(30), 'date') + '</div>' }],
                '<span class="muted" id="tl-prog" style="font-size:.78rem;align-self:center"></span><button class="btn primary" id="tl-go"><i class="fa-solid fa-magnifying-glass"></i> Search</button>') +
                '<div class="card"><div class="filters">' +
                '<label>Order #' + IU.inp('tl-f-num', 'contains') + '</label><label>Item' + IU.inp('tl-f-item', 'contains') + '</label>' +
                '<label>Source Org<select id="tl-f-src"><option value="">All</option></select></label><label>Dest Org<select id="tl-f-dst"><option value="">All</option></select></label>' +
                '<label>Line Status<select id="tl-f-st"><option value="">All</option></select></label><label>Any text' + IU.inp('tl-f-any', 'search the whole line') + '</label></div></div>' +
                '<div id="tl-grid" style="display:flex;flex-direction:column;flex:1;min-height:0;gap:10px"></div>';
            function vis() {
                var n = $('tl-f-num').value.toLowerCase(), it = $('tl-f-item').value.toLowerCase(), s = $('tl-f-src').value, d = $('tl-f-dst').value, ls = $('tl-f-st').value, any = $('tl-f-any').value.toLowerCase();
                return st.rows.filter(function (r) {
                    return (!n || String(r._headerNumber).toLowerCase().indexOf(n) >= 0) && (!it || String(r.ItemNumber || '').toLowerCase().indexOf(it) >= 0) && (!s || r.SourceOrganizationCode === s) && (!d || r.DestinationOrganizationCode === d) && (!ls || r.TransferOrderLineStatus === ls) &&
                        (!any || JSON.stringify(r).toLowerCase().indexOf(any) >= 0);
                });
            }
            grid = IU.localGrid($('tl-grid'), {
                id: 'tl', rows: vis, csvName: 'transfer_order_lines', emptyText: 'No lines.',
                kpis: function (r) { if (!r.length) return []; var ccy = (r.filter(function (x) { return x.CurrencyCode; })[0] || {}).CurrencyCode || ''; return [{ k: 'l', label: 'Lines', value: r.length }, { k: 'o', label: 'Orders', value: IU.distinct(r.map(function (x) { return x._headerNumber; })).length }, { k: 'p', label: 'Total Transfer Price', value: IU.price(IU.sum(r, 'TotalTransferPrice'), ccy) }]; },
                columns: [
                    { f: '_orderedDate', label: 'Ordered', html: function (r) { return IU.d(r._orderedDate); } },
                    { f: '_headerNumber', label: 'Order', html: function (r) { var n = st.cnt[r._headerId]; return '<span style="' + (n > 1 ? 'border-left:3px solid #f59e0b;padding-left:5px' : '') + '"><button class="lnk" data-edit="' + esc(r._headerId) + '">' + esc(r._headerNumber) + '</button>' + (n > 1 ? ' <span class="chip warn">×' + n + '</span>' : '') + '</span>'; } },
                    { label: 'Line', get: function (r) { var n = st.cnt[r._headerId]; return (r.DisplayLineNumber || r.LineNumber) + (n > 1 ? ' / ' + n : ''); } },
                    { f: 'ItemNumber', label: 'Item', fmt: 'mono' }, { f: 'ItemDescription', label: 'Description' },
                    { label: 'Source Org', get: function (r) { return (r.SourceOrganizationCode || '') + (r.SourceSubinventoryCode ? ' · ' + r.SourceSubinventoryCode : ''); }, html: function (r) { return '<span title="' + esc(r.SourceOrganizationName || '') + '">' + esc((r.SourceOrganizationCode || '') + (r.SourceSubinventoryCode ? ' · ' + r.SourceSubinventoryCode : '')) + '</span>'; } },
                    { label: 'Dest Org', get: function (r) { return (r.DestinationOrganizationCode || '') + (r.DestinationSubinventoryCode ? ' · ' + r.DestinationSubinventoryCode : ''); }, html: function (r) { return '<span title="' + esc(r.DestinationOrganizationName || '') + '">' + esc((r.DestinationOrganizationCode || '') + (r.DestinationSubinventoryCode ? ' · ' + r.DestinationSubinventoryCode : '')) + '</span>'; } },
                    { f: 'QuantityUOMCode', label: 'UOM' }, { f: 'RequestedQuantity', label: 'Requested', n: 1, html: function (r) { return IU.qty(r.RequestedQuantity); } },
                    { f: 'ShippedQuantity', label: 'Shipped', n: 1, html: function (r) { return green(r.ShippedQuantity); } }, { f: 'ReceivedQuantity', label: 'Received', n: 1, html: function (r) { return green(r.ReceivedQuantity); } },
                    { f: 'DeliveredQuantity', label: 'Delivered', n: 1, html: function (r) { return IU.qty(r.DeliveredQuantity); } },
                    { f: 'UnitPrice', label: 'Unit Price', n: 1, html: function (r) { return IU.price(r.UnitPrice); } }, { f: 'TotalTransferPrice', label: 'Total', n: 1, html: function (r) { return IU.price(r.TotalTransferPrice, r.CurrencyCode); } },
                    { f: 'FulfillStatusMeaning', label: 'Fulfillment' }, { f: 'TransferOrderLineStatus', label: 'Line Status', html: function (r) { return stChip(r.TransferOrderLineStatus); } },
                    { label: 'Supply Ref', get: function (r) { return r.SupplyOrderReferenceNumber || r.SupplyOrderReferenceLineNumber; } }, { f: 'NeedByDate', label: 'Need By', html: function (r) { return IU.d(r.NeedByDate); } }
                ]
            });
            $('tl-grid').addEventListener('click', function (e) { var b = e.target.closest('[data-edit]'); if (b) { e.stopPropagation(); var r = st.rows.filter(function (x) { return String(x._headerId) === b.getAttribute('data-edit'); })[0]; openEdit({ HeaderId: r._headerId, HeaderNumber: r._headerNumber }); } }, true);
            ['tl-f-num', 'tl-f-item', 'tl-f-any'].forEach(function (i) { $(i).oninput = grid.refresh; });
            ['tl-f-src', 'tl-f-dst', 'tl-f-st'].forEach(function (i) { $(i).onchange = grid.refresh; });
            $('tl-go').onclick = search;
            search();
            function search() {
                grid.loading('Reading transfer orders…'); $('tl-prog').textContent = '';
                FX.restAll('transferOrders', { q: 'OrderedDate' + $('tl-op').value + $('tl-date').value, orderBy: 'OrderedDate:desc', onlyData: false }, 5000).then(function (hs) {
                    return IU.mapLimit(hs, 6, function (h) { return toLines(h).then(function (ls) { return ls.map(function (l) { l._headerId = h.HeaderId; l._headerNumber = h.HeaderNumber; l._orderedDate = h.OrderedDate; l._headerStatus = h.Status; return l; }); }); },
                        function (d, n) { $('tl-prog').textContent = 'Loading lines… ' + d + '/' + n + ' orders'; grid.loading('Loading lines… ' + d + '/' + n + ' orders'); });
                }).then(function (res) {
                    st.rows = []; st.cnt = {}; var bad = 0;
                    res.forEach(function (x) { if (x.ok) st.rows = st.rows.concat(x.v); else bad++; });
                    st.rows.forEach(function (r) { st.cnt[r._headerId] = (st.cnt[r._headerId] || 0) + 1; });
                    [['tl-f-src', 'SourceOrganizationCode'], ['tl-f-dst', 'DestinationOrganizationCode'], ['tl-f-st', 'TransferOrderLineStatus']].forEach(function (x) { var cur = $(x[0]).value; $(x[0]).innerHTML = '<option value="">All</option>' + IU.distinct(st.rows.map(function (r) { return r[x[1]]; })).sort().map(function (v) { return '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join(''); });
                    $('tl-prog').textContent = st.rows.length + ' lines' + (bad ? ' · ' + bad + ' orders failed' : '');
                    grid.refresh();
                }).catch(grid.error);
            }
        }

        // ── New Transfer Order ──
        function newTO(p, seed) {
            seed = seed || {};
            var S = { src: seed.src || lsGet('fxinv_to_src', ''), dst: seed.dst || lsGet('fxinv_to_dst', ''), srcSub: seed.srcSub || '', dstSub: seed.dstSub || '', needBy: seed.needBy || IU.days(+IU.cfg('toNeedByDays') || 3), lines: [], seq: 0 };
            var uid = 'nt' + Math.random().toString(36).slice(2, 7), id = function (x) { return uid + '-' + x; };
            function newLine(o) { o = o || {}; return { key: ++S.seq, item: o.item || '', qty: o.qty == null ? '' : o.qty, uom: o.uom || IU.cfg('toUom'), desc: '', sq: null, dq: null, sqErr: '', dqErr: '', loading: false }; }
            S.lines = (seed.lines && seed.lines.length ? seed.lines : [{}]).map(newLine);
            p.innerHTML = '<div class="card pad" style="display:flex;flex-direction:column;gap:10px"><div class="form">' +
                '<label>Source Org <b class="r">*</b><select id="' + id('src') + '"></select></label><label>Source Subinventory<select id="' + id('ssub') + '"><option value="">—</option></select></label>' +
                '<label>Destination Org <b class="r">*</b><select id="' + id('dst') + '"></select></label><label>Destination Subinventory<select id="' + id('dsub') + '"><option value="">—</option></select></label>' +
                '<label>Need-By Date<input type="date" id="' + id('need') + '" value="' + esc(S.needBy) + '"></label>' +
                '<label>Interface Source<input id="' + id('if') + '" value="' + esc(IU.cfg('toIface')) + '"></label><label>Supply Order Source<input id="' + id('os') + '" value="' + esc(IU.cfg('toOrderSource')) + '"></label>' +
                '<label>Supply Request Status<input id="' + id('rs') + '" value="' + esc(IU.cfg('toReqStatus')) + '"></label><label>Preparer / Requester e-mail<input id="' + id('em') + '" value="' + esc(IU.email()) + '" placeholder="name@company.com"></label></div></div>' +
                '<div class="card"><div class="card-h"><b><i class="fa-solid fa-list-ol"></i> Lines</b><span class="muted" id="' + id('cnt') + '"></span><span class="grow" style="flex:1"></span>' +
                '<button class="btn sm" data-a="matrix"><i class="fa-solid fa-table-cells"></i> On-Hand Matrix</button><button class="btn sm" data-a="add"><i class="fa-solid fa-plus"></i> Add Line</button><button class="btn sm" data-a="clear"><i class="fa-solid fa-eraser"></i> Clear</button></div>' +
                '<div style="overflow:auto"><table class="tbl" id="' + id('tbl') + '"></table></div>' +
                '<div class="row-btns" style="padding:10px 12px;border-top:1px solid var(--line)"><span class="muted" style="font-size:.78rem">Creates a supply request; Supply Chain Orchestration then creates the transfer order.</span><span class="grow" style="flex:1"></span><button class="btn primary" data-a="submit"><i class="fa-solid fa-paper-plane"></i> Submit Transfer Order</button></div></div>' +
                '<div id="' + id('res') + '"></div>';
            IU.orgOptions(id('src'), S.src, '— select —').then(function () { if (S.src) subs('src'); });
            IU.orgOptions(id('dst'), S.dst, '— select —').then(function () { if (S.dst) subs('dst'); });
            function subs(side) { var org = side === 'src' ? S.src : S.dst, sel = $(id(side === 'src' ? 'ssub' : 'dsub')); if (!org) { sel.innerHTML = '<option value="">—</option>'; return; } FX.fillSelect(sel, FX.subinvs(org), side === 'src' ? S.srcSub : S.dstSub, '—'); }
            $(id('src')).onchange = function () { S.src = this.value; S.srcSub = ''; lsSet('fxinv_to_src', S.src); subs('src'); refreshAll(); };
            $(id('dst')).onchange = function () { S.dst = this.value; S.dstSub = ''; lsSet('fxinv_to_dst', S.dst); subs('dst'); refreshAll(); };
            $(id('ssub')).onchange = function () { S.srcSub = this.value; };
            $(id('dsub')).onchange = function () { S.dstSub = this.value; };
            function draw() {
                $(id('cnt')).textContent = S.lines.length + ' line(s)';
                $(id('tbl')).innerHTML = '<thead><tr><th>#</th><th style="min-width:180px">Item Number *</th><th>Description</th><th class="n">Source QOH</th><th class="n">Dest QOH</th><th></th><th style="width:110px">Quantity *</th><th style="width:80px">UOM</th><th></th></tr></thead><tbody>' +
                    S.lines.map(function (l, i) {
                        return '<tr data-k="' + l.key + '"><td>' + (i + 1) + '</td><td class="ed"><div style="display:flex;gap:4px"><input data-f="item" value="' + esc(l.item) + '" placeholder="item number"><button class="btn sm icon" data-a="pick" title="Find item"><i class="fa-solid fa-magnifying-glass"></i></button></div></td>' +
                            '<td data-c="desc">' + cellDesc(l) + '</td><td class="n" data-c="sq">' + cellQ(l, 'sq') + '</td><td class="n" data-c="dq">' + cellQ(l, 'dq') + '</td>' +
                            '<td style="white-space:nowrap"><button class="btn sm icon" data-a="reload" title="Reload line info"><i class="fa-solid fa-rotate"></i></button> <button class="btn sm icon" data-a="cost" title="Item cost"><i class="fa-solid fa-dollar-sign"></i></button></td>' +
                            '<td class="ed"><input type="number" min="0" step="any" data-f="qty" value="' + esc(l.qty) + '"></td><td class="ed"><input data-f="uom" value="' + esc(l.uom) + '"></td>' +
                            '<td><button class="btn sm icon danger" data-a="del"' + (S.lines.length < 2 ? ' disabled' : '') + ' title="Remove"><i class="fa-solid fa-trash"></i></button></td></tr>';
                    }).join('') + '</tbody>';
            }
            function cellDesc(l) { return l.loading ? '<i class="fa-solid fa-circle-notch fa-spin muted"></i>' : esc(l.desc || ''); }
            function cellQ(l, k) {
                if (l.loading) return '<i class="fa-solid fa-circle-notch fa-spin muted"></i>';
                if (l[k + 'Err']) return '<span class="chip err" title="' + esc(l[k + 'Err']) + '">err</span>';
                if (l[k] == null) return '<span class="muted">—</span>';
                return '<button class="lnk ' + (l[k] > 0 ? 'qty-ok' : k === 'sq' ? 'qty-zero' : '') + '" style="' + (l[k] > 0 ? '' : k === 'dq' ? 'color:var(--warn)' : '') + '" data-a="matrix1">' + IU.qty(l[k]) + '</button>';
            }
            function paint(l) { var tr = $(id('tbl')).querySelector('tr[data-k="' + l.key + '"]'); if (!tr) return; tr.querySelector('[data-c="desc"]').innerHTML = cellDesc(l); tr.querySelector('[data-c="sq"]').innerHTML = cellQ(l, 'sq'); tr.querySelector('[data-c="dq"]').innerHTML = cellQ(l, 'dq'); }
            function onhand(org, item) { return FX.restAll('inventoryOnhandBalances', { q: 'OrganizationCode=' + FX.qv(org) + ';ItemNumber=' + FX.qv(item) }, 5000); }
            function loadInfo(l) {
                var item = l.item.trim(); if (!item) return;
                l.loading = true; paint(l);
                var jobs = [FX.get('itemsV2', { q: 'ItemNumber=' + FX.qv(item), limit: 1 }).then(function (j) { return ((j.items || [])[0] || {}).ItemDescription || ''; }),
                    S.src ? onhand(S.src, item).then(function (r) { return IU.sum(r, 'PrimaryQuantity'); }) : Promise.resolve(null),
                    S.dst ? onhand(S.dst, item).then(function (r) { return IU.sum(r, 'PrimaryQuantity'); }) : Promise.resolve(null)];
                Promise.all(jobs.map(function (j) { return j.then(function (v) { return { ok: true, v: v }; }, function (e) { return { ok: false, e: IU.errText(e) }; }); })).then(function (r) {
                    l.loading = false;
                    if (r[0].ok) l.desc = r[0].v || '(not found)';
                    if (r[1].ok) { l.sq = r[1].v; l.sqErr = ''; } else l.sqErr = r[1].e;
                    if (r[2].ok) { l.dq = r[2].v; l.dqErr = ''; } else l.dqErr = r[2].e;
                    paint(l);
                });
            }
            function refreshAll() { S.lines.forEach(function (l) { if (l.item.trim()) loadInfo(l); }); }
            function lineOf(t) { var tr = t.closest('tr[data-k]'); return tr && S.lines.filter(function (l) { return l.key === +tr.getAttribute('data-k'); })[0]; }
            var tbl = $(id('tbl'));
            tbl.addEventListener('input', function (e) { var l = lineOf(e.target), f = e.target.getAttribute('data-f'); if (l && f) l[f] = e.target.value; });
            tbl.addEventListener('change', function (e) { var l = lineOf(e.target); if (l && e.target.getAttribute('data-f') === 'item') loadInfo(l); });
            tbl.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.getAttribute('data-f') === 'item') { e.preventDefault(); var l = lineOf(e.target); l.item = e.target.value; loadInfo(l); } });
            p.addEventListener('click', function (e) {
                var b = e.target.closest('[data-a]'); if (!b) return;
                var a = b.getAttribute('data-a'), l = lineOf(b);
                if (a === 'add') { var nl = newLine(); S.lines.push(nl); draw(); if (S.src) picker(nl); }
                else if (a === 'del') { S.lines = S.lines.filter(function (x) { return x !== l; }); draw(); }
                else if (a === 'clear') { var has = S.lines.some(function (x) { return x.item || x.qty; }); (has ? FX.confirm('Clear lines', 'Remove all lines from this transfer order?', 'Clear', 'warn') : Promise.resolve(true)).then(function (ok) { if (ok) { S.lines = [newLine()]; draw(); } }); }
                else if (a === 'reload') loadInfo(l);
                else if (a === 'pick') picker(l);
                else if (a === 'cost') { if (!l.item.trim()) { FX.toast('Enter an item first.', 'err'); return; } IU.itemCostModal(l.item.trim(), S.src, S.dst); }
                else if (a === 'matrix') matrix(S.lines);
                else if (a === 'matrix1') matrix([l]);
                else if (a === 'submit') submit();
            });
            draw(); if (seed.lines) refreshAll();

            function picker(l) {
                if (!S.src) { FX.toast('Select a source organization first', 'err'); return; }
                var fld = 'ItemNumber';
                FX.modal({
                    title: '<i class="fa-solid fa-magnifying-glass"></i> Find item in ' + esc(S.src), wide: true,
                    body: '<div class="toolbar"><div class="seg" id="ip-f"><button class="on" data-f="ItemNumber">Item Number</button><button data-f="ItemDescription">Description</button></div><input type="search" id="ip-q" placeholder="type and press Enter" style="flex:1;min-width:240px"><button class="btn primary" id="ip-go"><i class="fa-solid fa-magnifying-glass"></i> Search</button></div><div id="ip-note"></div><div id="ip-res" class="scroll"></div>',
                    onOpen: function () {
                        $('ip-q').value = l.item || ''; $('ip-q').focus();
                        $('ip-f').onclick = function (e) { var b = e.target.closest('[data-f]'); if (!b) return; fld = b.getAttribute('data-f'); Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); }); };
                        $('ip-q').onkeydown = function (e) { if (e.key === 'Enter') go(); }; $('ip-go').onclick = go;
                        $('ip-res').onclick = function (e) { var b = e.target.closest('[data-pick]'); if (!b) return; l.item = b.getAttribute('data-pick'); if (b.getAttribute('data-uom')) l.uom = b.getAttribute('data-uom'); FX.closeModal(); draw(); loadInfo(l); };
                    }
                });
                function go() {
                    var t = $('ip-q').value.trim(); if (!t) return;
                    var pat = fld === 'ItemNumber' ? t + '%' : '%' + t + '%';
                    $('ip-res').innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Searching…</div>'; $('ip-note').innerHTML = '';
                    var q1 = 'OrganizationCode=' + FX.qv(S.src) + ';' + fld + ' LIKE ' + FX.qv(pat);
                    FX.get('itemsV2', { q: q1, limit: 100 }).then(function (j) {
                        if ((j.items || []).length) return j.items;
                        return FX.get('itemsV2', { q: fld + ' LIKE ' + FX.qv(pat), limit: 100 }).then(function (j2) { if ((j2.items || []).length) $('ip-note').innerHTML = '<div class="note warn">No org-scoped match — showing item master results</div>'; return j2.items || []; });
                    }).then(function (items) {
                        var seen = {}; items = items.filter(function (x) { if (seen[x.ItemNumber]) return false; seen[x.ItemNumber] = 1; return true; });
                        $('ip-res').innerHTML = items.length ? FX.table(items, [{ f: 'ItemNumber', label: 'Item', fmt: 'mono' }, { f: 'ItemDescription', label: 'Description' }, { label: 'UOM', get: function (r) { return r.PrimaryUOMValue || r.PrimaryUOMCode; } },
                            { label: '', html: function (r) { return '<button class="btn sm primary" data-pick="' + esc(r.ItemNumber) + '" data-uom="' + esc(r.PrimaryUOMCode || '') + '">Select</button>'; } }]) : '<div class="empty">No items found.</div>';
                    }).catch(function (e) { $('ip-res').innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
                }
            }
            function matrix(lines) {
                var items = IU.distinct(lines.map(function (l) { return l.item.trim(); }));
                if (!items.length) { FX.toast('Enter at least one item.', 'err'); return; }
                if (!S.src && !S.dst) { FX.toast('Select the source and destination organizations first.', 'err'); return; }
                FX.modal({ title: '<i class="fa-solid fa-table-cells"></i> On-hand matrix · ' + esc(S.src || '—') + ' → ' + esc(S.dst || '—'), wide: true, body: '<div id="mx" class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading on-hand for ' + items.length + ' item(s)…</div>' });
                IU.mapLimit(items, 6, function (it) {
                    return Promise.all([S.src ? onhand(S.src, it) : Promise.resolve(null), S.dst ? onhand(S.dst, it) : Promise.resolve(null)]).then(function (r) { return { item: it, src: r[0], dst: r[1] }; });
                }).then(function (res) {
                    var el2 = $('mx'); if (!el2) return; el2.className = '';
                    var rows = res.map(function (x, i) { return x.ok ? x.v : { item: items[i], err: IU.errText(x.e) }; });
                    var tot = function (a) { return a && a.length ? IU.sum(a, 'PrimaryQuantity') : null; };
                    el2.innerHTML = '<table class="tbl"><thead><tr><th></th><th>Item</th><th>Description</th><th class="n">Source QOH (' + esc(S.src || '—') + ')</th><th class="n">Dest QOH (' + esc(S.dst || '—') + ')</th></tr></thead><tbody>' + rows.map(function (r, i) {
                        if (r.err) return '<tr><td></td><td class="mono">' + esc(r.item) + '</td><td colspan="3" class="st-err">' + esc(r.err) + '</td></tr>';
                        var d = ((r.src || [])[0] || (r.dst || [])[0] || {}).ItemDescription || '', s = tot(r.src), t = tot(r.dst);
                        var det = [].concat((r.src || []).map(function (x) { x._side = 'Source'; return x; }), (r.dst || []).map(function (x) { x._side = 'Dest'; return x; }));
                        return '<tr class="click" data-mx="' + i + '"><td><i class="fa-solid fa-chevron-right muted"></i></td><td class="mono">' + esc(r.item) + '</td><td>' + esc(d) + '</td><td class="n ' + (s > 0 ? 'qty-ok' : 'qty-zero') + '">' + (s == null ? '—' : IU.qty(s)) + '</td><td class="n" style="color:' + (t > 0 ? 'var(--ok)' : 'var(--warn)') + ';font-weight:700">' + (t == null ? '—' : IU.qty(t)) + '</td></tr>' +
                            '<tr hidden data-mxd="' + i + '"><td></td><td colspan="4">' + (det.length ? FX.table(det, [{ f: '_side', label: 'Side' }, { f: 'OrganizationCode', label: 'Org' }, { f: 'SubinventoryCode', label: 'Subinventory' }, { label: 'Locator', get: function (x) { return x.LocatorName || x.Locator; } }, { f: 'LotNumber', label: 'Lot' }, { label: 'UOM', get: function (x) { return x.UnitOfMeasure || x.PrimaryUOMCode; } }, { f: 'PrimaryQuantity', label: 'Qty', n: 1, fmt: 'num' }]) : '<span class="muted">No on-hand rows.</span>') + '</td></tr>';
                    }).join('') + '</tbody></table>';
                    el2.onclick = function (e) { var tr = e.target.closest('[data-mx]'); if (!tr) return; var d = el2.querySelector('[data-mxd="' + tr.getAttribute('data-mx') + '"]'); d.hidden = !d.hidden; tr.querySelector('i').className = 'fa-solid fa-chevron-' + (d.hidden ? 'right' : 'down') + ' muted'; };
                });
            }
            function submit() {
                S.needBy = $(id('need')).value;
                var iface = $(id('if')).value.trim() || 'EXT', osrc = $(id('os')).value.trim() || 'EXT', rstat = $(id('rs')).value.trim() || 'NEW', email = $(id('em')).value.trim();
                var errs = [];
                if (!S.src) errs.push('Source organization is required.');
                if (!S.dst) errs.push('Destination organization is required.');
                if (S.src && S.dst && S.src === S.dst) errs.push('Source and destination organizations must differ.');
                var valid = S.lines.filter(function (l) { return l.item.trim() && +l.qty > 0; });
                if (!valid.length) errs.push('Add at least one line with an item and a quantity above 0.');
                if (errs.length) { FX.toast(errs.join('\n'), 'err'); return; }
                var stamp = Date.now(), batch = 'RE' + stamp, refId = Number(String(stamp).slice(-9));
                var body = {
                    InterfaceSourceCode: iface, InterfaceBatchNumber: batch, SupplyRequestStatus: rstat, SupplyRequestDate: new Date().toISOString(), SupplyOrderSource: osrc,
                    SupplyOrderReferenceNumber: batch, SupplyOrderReferenceId: refId, ProcessRequestFlag: 'Y',
                    supplyRequestLines: valid.map(function (l, i) {
                        var o = { InterfaceBatchNumber: batch, SupplyOrderReferenceLineNumber: batch + '-' + (i + 1), SupplyOrderReferenceLineId: i + 1, SupplyType: 'TRANSFER', DestinationTypeCode: 'INVENTORY', SourceOrganizationCode: S.src, DestinationOrganizationCode: S.dst };
                        if (S.srcSub) o.SourceSubinventoryCode = S.srcSub; if (S.dstSub) o.DestinationSubinventoryCode = S.dstSub;
                        o.ItemNumber = l.item.trim(); o.InterfaceSourceCode = iface; o.SupplyOrderSource = osrc; o.BackToBackFlag = 'N';
                        if (email) { o.PreparerEmail = email; o.DeliverToRequesterEmail = email; }
                        if (S.needBy) o.NeedByDate = S.needBy + 'T00:00:00+00:00';
                        o.Quantity = +l.qty; o.UOMCode = l.uom || 'Ea';
                        return o;
                    })
                };
                FX.modal({
                    title: 'Submit transfer order', wide: true, body: '<div class="note">Create a supply request for <b>' + valid.length + '</b> line(s) from <b>' + esc(S.src) + '</b>' + (S.srcSub ? ' / ' + esc(S.srcSub) : '') + ' to <b>' + esc(S.dst) + '</b>' + (S.dstSub ? ' / ' + esc(S.dstSub) : '') + '? Supply Chain Orchestration creates the transfer order afterwards.</div><details><summary class="muted" style="cursor:pointer">Request payload</summary><pre class="json">' + esc(JSON.stringify(body, null, 2)) + '</pre></details>',
                    buttons: [{ label: 'Cancel', act: 'close' }, { label: '<i class="fa-solid fa-paper-plane"></i> Submit', cls: 'primary', act: 'go' }],
                    onAction: function (a) {
                        if (a !== 'go') return;
                        var res = $(id('res'));
                        res.innerHTML = '<div class="note"><i class="fa-solid fa-circle-notch fa-spin"></i> Submitting batch ' + esc(batch) + '…</div>';
                        FX.rest('POST', 'supplyRequests', {}, body).then(function (j) {
                            res.innerHTML = '<div class="card pad" style="display:flex;flex-direction:column;gap:8px"><div class="note ok"><i class="fa-solid fa-circle-check"></i> Supply request submitted — transfer order will be created by SCO. Batch <b>' + esc(batch) + '</b> · HTTP ' + esc((FX.lastCall || {}).status) + '</div><pre class="json">' + esc(JSON.stringify(j, null, 2).slice(0, 6000)) + '</pre></div>';
                            FX.toast('Supply request submitted.', 'ok');
                        }).catch(function (e) { res.innerHTML = '<div class="card pad"><div class="note err" style="white-space:pre-wrap"><b>HTTP ' + esc((FX.lastCall || {}).status || '') + '</b>\n' + esc(String(e).slice(0, 6000)) + '</div></div>'; });
                    }
                });
            }
        }

        // ── Edit ──
        function editTab(p, h0) {
            p.innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading ' + esc(h0.HeaderNumber) + '…</div>';
            var tid = 'ed' + h0.HeaderId;
            Promise.all([FX.get('transferOrders/' + h0.HeaderId, {}), IU.allHref(FX.url('transferOrders/' + h0.HeaderId + '/child/transferOrderLines', { onlyData: false }))]).then(function (r) {
                var h = r[0], lines = r[1], edits = {}, log = [];
                delete linesCache[h0.HeaderId];
                var editable = function (l) { return !/^(CLOSED|CANCELED|CANCELLED)$/.test(String(l.StatusLookup || '').toUpperCase()); };
                var lid = function (l) { return IU.first(l, ['LineId', 'TransferOrderLineId', 'DocumentLineId']); };
                var dirty = function () { return lines.filter(function (l) { var e = edits[lid(l)]; return e && ((e.q != null && Number(e.q) !== Number(l.RequestedQuantity)) || (e.d != null && String(e.d).slice(0, 10) !== String(l.NeedByDate || '').slice(0, 10))); }); };
                var ccy = (lines.filter(function (l) { return l.CurrencyCode; })[0] || {}).CurrencyCode || '';
                var tot = h.TotalTransferPrice != null ? h.TotalTransferPrice : IU.sum(lines, 'TotalTransferPrice');
                function draw() {
                    var d = dirty();
                    p.innerHTML = '<div class="card hdr-card"><h3><i class="fa-solid fa-truck-arrow-right" style="color:var(--accent)"></i> ' + esc(h.HeaderNumber) + '</h3>' + stChip(h.Status) + stChip(h.InterfaceStatus) + '<span class="grow" style="flex:1"></span>' +
                        '<button class="btn" data-e="refresh"><i class="fa-solid fa-rotate"></i> Refresh</button><button class="btn primary" data-e="save"' + (d.length ? '' : ' disabled') + '><i class="fa-solid fa-floppy-disk"></i> Save Changes (' + d.length + ')</button><button class="btn" data-e="close"><i class="fa-solid fa-xmark"></i> Close Tab</button></div>' +
                        '<div class="card pad"><div class="facts">' + [['Business Unit', h.BusinessUnitName], ['Source', h.SourceOfTransferOrder], ['Ordered', IU.d(h.OrderedDate)], ['Total Transfer Price', IU.price(tot, ccy)], ['Created By', h.CreatedBy]].map(function (f) { return '<div><span>' + f[0] + '</span>' + esc(f[1] || '') + '</div>'; }).join('') + '</div></div>' +
                        '<div class="card"><div class="card-h"><b><i class="fa-solid fa-list"></i> ' + lines.length + ' line(s) · ' + esc(IU.price(IU.sum(lines, 'TotalTransferPrice'), ccy)) + '</b><span class="muted">Requested quantity and need-by date can be changed on lines that are not closed or cancelled.</span></div><div style="overflow:auto"><table class="tbl"><thead><tr><th>Line</th><th>Item</th><th>Description</th><th>Route</th><th>UOM</th><th style="width:110px">Requested</th><th class="n">Shipped</th><th class="n">Received</th><th style="width:150px">Need By</th><th class="n">Unit Price</th><th class="n">Total</th><th>Status</th></tr></thead><tbody>' +
                        lines.map(function (l) {
                            var e = edits[lid(l)] || {}, ed = editable(l), isD = d.indexOf(l) >= 0;
                            return '<tr data-l="' + esc(lid(l)) + '" class="' + (isD ? 'dirty' : '') + (ed ? '' : ' ro') + '"><td>' + esc(l.DisplayLineNumber || l.LineNumber) + '</td><td class="mono">' + esc(l.ItemNumber) + '</td><td>' + esc(l.ItemDescription) + '</td><td>' + esc((l.SourceOrganizationCode || '') + ' → ' + (l.DestinationOrganizationCode || '')) + '</td><td>' + esc(l.QuantityUOMCode) + '</td>' +
                                '<td class="ed">' + (ed ? '<input type="number" min="0" step="any" data-q value="' + esc(e.q != null ? e.q : l.RequestedQuantity) + '">' : IU.qty(l.RequestedQuantity)) + '</td><td class="n">' + IU.qty(l.ShippedQuantity) + '</td><td class="n">' + IU.qty(l.ReceivedQuantity) + '</td>' +
                                '<td class="ed">' + (ed ? '<input type="date" data-d value="' + esc(String(e.d != null ? e.d : (l.NeedByDate || '')).slice(0, 10)) + '">' : IU.d(l.NeedByDate)) + '</td><td class="n">' + IU.price(l.UnitPrice) + '</td><td class="n">' + IU.price(l.TotalTransferPrice) + '</td><td>' + stChip(l.TransferOrderLineStatus) + '</td></tr>';
                        }).join('') + '</tbody></table></div></div>' +
                        (log.length ? '<div class="log">' + log.map(function (x) { return '<div class="' + (x.ok ? 'o' : 'e') + '">' + esc(x.t) + '</div>'; }).join('') + '</div>' : '');
                }
                draw();
                p.oninput = function (e) {
                    var tr = e.target.closest('tr[data-l]'); if (!tr) return; var k = tr.getAttribute('data-l'); edits[k] = edits[k] || {};
                    if (e.target.hasAttribute('data-q')) edits[k].q = e.target.value; if (e.target.hasAttribute('data-d')) edits[k].d = e.target.value;
                    var l = lines.filter(function (x) { return String(lid(x)) === k; })[0], dl = dirty();
                    tr.classList.toggle('dirty', dl.indexOf(l) >= 0);
                    var sb = p.querySelector('[data-e="save"]'); sb.disabled = !dl.length; sb.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Changes (' + dl.length + ')';
                };
                p.onclick = function (e) {
                    var b = e.target.closest('[data-e]'); if (!b) return; var a = b.getAttribute('data-e');
                    if (a === 'close') tabs.close(tid.replace('ed', 'edit'));
                    else if (a === 'refresh') editTab(p, h0);
                    else if (a === 'save') save();
                };
                function save() {
                    var d = dirty(); if (!d.length) return;
                    FX.busy('Saving ' + d.length + ' line(s)…'); log = [];
                    d.reduce(function (pr, l) {
                        return pr.then(function () {
                            var e = edits[lid(l)], body = {};
                            if (e.q != null && Number(e.q) !== Number(l.RequestedQuantity)) body.RequestedQuantity = Number(e.q);
                            if (e.d != null && String(e.d).slice(0, 10) !== String(l.NeedByDate || '').slice(0, 10)) body.NeedByDate = String(e.d).slice(0, 10);
                            var url = IU.self(l) || 'transferOrders/' + h.HeaderId + '/child/transferOrderLines/' + lid(l);
                            return FX.rest('PATCH', url, {}, body).then(function (j) { log.push({ ok: true, t: 'Line ' + lid(l) + ': HTTP ' + ((FX.lastCall || {}).status || 200) + ' OK — ' + JSON.stringify(body) }); },
                                function (er) { log.push({ ok: false, t: 'Line ' + lid(l) + ': ' + String(er).slice(0, 400) }); });
                        });
                    }, Promise.resolve()).then(function () {
                        FX.busy(); var bad = log.filter(function (x) { return !x.ok; }).length;
                        FX.toast(bad ? bad + ' line(s) failed — see the log.' : 'Saved ' + log.length + ' line(s).', bad ? 'err' : 'ok');
                        var keep = log; editTab(p, h0); setTimeout(function () { var lg = document.createElement('div'); lg.className = 'log'; lg.innerHTML = keep.map(function (x) { return '<div class="' + (x.ok ? 'o' : 'e') + '">' + esc(x.t) + '</div>'; }).join(''); var wait = setInterval(function () { if (p.querySelector('.hdr-card')) { clearInterval(wait); p.appendChild(lg); } }, 200); setTimeout(function () { clearInterval(wait); }, 15000); }, 0);
                    });
                }
            }).catch(function (e) { p.innerHTML = '<div class="note err">' + esc(e) + '</div><div><button class="btn" id="' + tid + '-x">Close</button></div>'; $(tid + '-x').onclick = function () { tabs.close('edit' + h0.HeaderId); }; });
        }
    }
};
