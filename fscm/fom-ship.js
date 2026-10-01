/* Fusion Order Management — shipping (spec §3.0.8, §8, §9, §10).
   Pick release (pickWaves / shipmentLineChangeRequests pickRelease), pick slips + pick lines, lot/serial allocation from
   inventoryOnhandBalances, confirm pick (pickTransactions), ship confirm (shippingTransactions — also used by the
   automated run, which posted to shipConfirmations in the source; shipmentTransactionRequests when a ship date is given),
   the Auto Ship Confirm dialog used by the order screens, and the Shipment Lines / Confirm Picks views. */

FOM.SHIP_STAGES = ['Open', 'Pick Released', 'Pick Confirmed', 'Ship Confirmed'];
/** Line stage 0..3 from LineStatus + quantities (§3.0.8). */
FOM.shipLineStage = function (l) {
    var s = String(l.LineStatus || '').toLowerCase(), req = FOM.n(l.RequestedQuantity), sh = FOM.n(l.ShippedQuantity);
    if (/interfaced|shipped/.test(s) || (/ship/.test(s) && /confirm/.test(s)) || (req > 0 && sh >= req)) return 3;
    if (/stage|pick confirm|picked/.test(s)) return 2;
    if (/released|backorder|warehouse/.test(s)) return 1;
    return 0;
};
FOM.shipStage = function (lines) { if (!lines.length) return 0; var m = Math.min.apply(null, lines.map(FOM.shipLineStage)); return m >= 3 ? 4 : m; };
FOM.shipStepper = function (stage) {
    return '<div class="fom-tl sm">' + FOM.SHIP_STAGES.map(function (n, j) { var c = j < stage ? 'done' : j === stage ? 'cur' : ''; return '<div class="fom-st ' + c + '"><span class="dot"><i class="fa-solid ' + (c === 'done' ? 'fa-check' : ['fa-box-open', 'fa-people-carry-box', 'fa-clipboard-check', 'fa-truck'][j]) + '"></i></span><b>' + n + '</b></div>'; }).join('<span class="bar"></span>') + '</div>';
};
FOM.shipStatusChip = function (s) {
    var u = String(s || '').toUpperCase(), c = /SHIP|INTERFACED/.test(u) ? 'ok' : /BACKORDER/.test(u) ? 'err' : /STAGED/.test(u) ? 'warn' : /RELEASE/.test(u) ? 'done' : 'info';
    return s ? '<span class="chip ' + c + '">' + esc(s) + '</span>' : '';
};
FOM.shipLines = function (order) { return FOM.all('shipmentLines', { q: "Order='" + String(order).replace(/'/g, "''") + "'", orderBy: 'OrderLine:asc', limit: 500 }, 5000); };
FOM.orderTypeCode = function (row) {
    var c = row.OrderTypeCode; if (c) return c;
    var n = String(row.OrderType || '').toLowerCase();
    return /transfer/.test(n) ? 'TRANSFER_ORDER' : /purchase/.test(n) ? 'PURCHASE_ORDER' : /return/.test(n) ? 'RETURN_MATERIAL_AUTHORIZATION' : 'SALES_ORDER';
};
/** POST pickWaves → {ok, msg, json, body}. orderTypeCode: omitted for transfer orders, else sent with spaces. */
FOM.pickRelease = function (order, org, orderTypeCode) {
    var body = { SourceSystemName: 'OPS', BatchPrefix: 'PR-' + order, ShipFromOrganizationCode: org, ReleaseStatus: 'All' };
    if (orderTypeCode && orderTypeCode !== 'TRANSFER_ORDER') body.OrderType = orderTypeCode.replace(/_/g, ' ');
    Object.assign(body, { OrderNumber: String(order), PickReleaseFlag: 'true', AutoPickConfirmFlag: 'false', ShipConfirmRule: FOM.cfg('shipConfirmRule'), CreateShipmentsFlag: 'true', ShipmentCreationCriteria: 'Across orders' });
    return FOM.raw('POST', 'pickWaves', { contentType: 'json' }, body).then(function (r) {
        var bad = !r.ok || (r.json && r.json.ReturnStatus === 'E');
        return { ok: !bad, msg: bad ? FOM.errs(r.json, r.text, r.status).join('\n') : 'Pick Release Success', json: r.json, body: body, status: r.status };
    });
};
FOM.pickSlips = function (order) { return FOM.all('pickSlipDetails', { q: "Order='" + String(order).replace(/'/g, "''") + "'", orderBy: 'CreationDate:desc', onlyData: false, limit: 500 }, 500); };
/** 0 → message; 1 → PickSlipDialog; >1 → chooser. */
FOM.openPickSlips = function (order, onDone) {
    FX.busy('Reading pick slips…');
    return FOM.pickSlips(order).then(function (slips) {
        FX.busy();
        if (!slips.length) { FOM.alert('Pick slips', 'No pick slips found for order ' + esc(order) + ' — run Pick Release first.', 'warn'); return; }
        if (slips.length === 1) { FOM.pickSlipDlg(slips[0], onDone); return; }
        var d = FOM.dlg({ title: 'Pick slips for order ' + esc(order), wide: true, body: FOM.table(slips, [{ label: 'Pick Slip', html: function (s) { return '<a class="fom-a" data-ps="' + slips.indexOf(s) + '">' + esc(s.PickSlip) + '</a>'; } }, { f: 'PickSlipStatus', label: 'Status', fmt: 'chip' }, { f: 'PickWave', label: 'Pick Wave' }, { f: 'Organization', label: 'Org' }, { f: 'NumberOfPicks', label: '# Picks', n: 1 }, { f: 'CreationDate', label: 'Created', fmt: 'dt' }]) });
        d.box.addEventListener('click', function (e) { var a = e.target.closest('[data-ps]'); if (a) { d.close(); FOM.pickSlipDlg(slips[+a.getAttribute('data-ps')], onDone); } });
    }).catch(function (e) { FX.busy(); FX.toast(FOM.emsg(e), 'err'); });
};
FOM.pickLinesOf = function (slip) { return FOM.all(FOM.link(slip, 'pickLines') || 'pickSlipDetails/' + encodeURIComponent(slip.PickSlip) + '/child/pickLines', { onlyData: false, limit: 500 }, 3000); };

/** Allocate lot/serials (§9.3) → Promise<{item, lot, serials[], qty}|null>. Lot-only or plain quantity allowed when the item has no serials. */
FOM.allocateDlg = function (org, line, cur) {
    return new Promise(function (res) {
        var out = null, req = FOM.n(line.RequestedQuantity), data = null, lot = cur && cur.lot || '', sel = (cur && cur.serials || []).slice(), qty = cur && cur.qty || req;
        var d = FOM.dlg({
            title: 'Allocate — ' + esc(line.Item) + ' (line ' + esc(line.PickSlipLine) + ')', wide: true,
            body: '<div class="facts"><div><span>Item</span><b class="mono">' + esc(line.Item) + '</b></div><div><span>Requested</span>' + FOM.qty(req) + ' ' + esc(line.UOM || '') + '</div><div><span>Org</span>' + esc(org) + '</div><div><span>Source subinventory</span>' + esc(line.SourceSubinventory || '—') + '</div></div><div data-a><i class="fa-solid fa-circle-notch fa-spin"></i> Reading on-hand lots and serials…</div>',
            foot: '<span class="muted" data-af style="margin-right:auto;font-size:.8rem"></span>',
            buttons: [{ label: 'Cancel', act: 'close' }, { label: 'Apply', cls: 'primary', act: 'apply', id: 'fom-al-ok' }],
            onClose: function () { res(out); },
            onAction: function (a) {
                if (a !== 'apply') return;
                var n = data.mode === 'serial' ? sel.length : FOM.n(qty);
                if (!n) { FX.toast('Allocate at least one unit', 'err'); return false; }
                if (n > req) { FX.toast('Over requested quantity', 'err'); return false; }
                if (data.lots.length && !lot) { FX.toast('Select a lot', 'err'); return false; }
                out = { item: line.Item, lot: lot, serials: data.mode === 'serial' ? sel.slice() : [], qty: n }; return true;
            }
        });
        function draw() {
            var lotRow = data.lots.filter(function (l) { return l.lot === lot; })[0];
            var avail = data.lots.length ? (lotRow ? lotRow.serials : []) : data.serials;
            data.mode = avail.length ? 'serial' : 'qty';
            var h = '';
            if (data.lots.length) h += '<label class="fom-lab">Lot<select class="fom-in" data-lot><option value="">Select a lot…</option>' + data.lots.map(function (l) { return '<option value="' + esc(l.lot) + '"' + (l.lot === lot ? ' selected' : '') + '>' + esc(l.lot) + ' — on-hand ' + FOM.qty(l.qty) + ' · ' + l.serials.length + ' serial(s)</option>'; }).join('') + '</select></label>';
            if (!data.lots.length && !data.serials.length) h += '<div class="note warn">No lots or serials on hand for this item / subinventory — enter the picked quantity for a plain item.</div>';
            else if (data.lots.length && !lot) h += '<div class="note">Select a lot to see its serials.</div>';
            if (data.mode === 'serial') {
                h += '<div class="row-btns"><b style="font-size:.8rem">Serials</b><span class="grow"></span><button class="btn sm" data-auto>Auto-select ' + req + '</button><button class="btn sm" data-none>Clear</button></div><div class="fom-serials">' + avail.map(function (s) { var on = sel.indexOf(s) >= 0; return '<label class="' + (on ? 'on' : '') + '"><input type="checkbox" data-sn="' + esc(s) + '"' + (on ? ' checked' : '') + (!on && sel.length >= req ? ' disabled' : '') + '> <span class="mono">' + esc(s) + '</span></label>'; }).join('') + '</div>';
            } else if (!data.lots.length || lot) h += '<label class="fom-lab" style="max-width:200px">Picked quantity<input class="fom-in" type="number" min="0" step="any" data-qty value="' + esc(qty) + '"></label>';
            d.q('[data-a]').innerHTML = h;
            var n = data.mode === 'serial' ? sel.length : FOM.n(qty);
            d.q('[data-af]').innerHTML = 'Allocated <b>' + n + '</b> of ' + req + (n > req ? ' <b style="color:var(--err)">— over requested!</b>' : '');
            var l2 = d.q('[data-lot]'); if (l2) l2.onchange = function () { lot = this.value; sel = []; var lr = data.lots.filter(function (x) { return x.lot === lot; })[0]; if (lr) sel = lr.serials.slice(0, req); draw(); };
            var q2 = d.q('[data-qty]'); if (q2) q2.oninput = function () { qty = this.value; d.q('[data-af]').innerHTML = 'Allocated <b>' + FOM.n(qty) + '</b> of ' + req; };
            var au = d.q('[data-auto]'); if (au) au.onclick = function () { sel = avail.slice(0, req); draw(); };
            var no = d.q('[data-none]'); if (no) no.onclick = function () { sel = []; draw(); };
            d.qa('[data-sn]').forEach(function (c) { c.onchange = function () { var s = c.getAttribute('data-sn'); if (c.checked) { if (sel.indexOf(s) < 0) sel.push(s); } else sel = sel.filter(function (x) { return x !== s; }); draw(); }; });
        }
        FOM.lotSerials(org, line.Item, line.SourceSubinventory).then(function (r) {
            data = r;
            if (!lot && r.lots.length) { var best = r.lots.slice().sort(function (a, b) { return b.qty - a.qty; })[0]; lot = (r.lots.filter(function (l) { return l.serials.length >= req; })[0] || best).lot; }
            if (!sel.length) { var lr = r.lots.filter(function (l) { return l.lot === lot; })[0]; sel = (lr ? lr.serials : r.serials).slice(0, req); }
            draw();
        }).catch(function (e) { d.q('[data-a]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; data = { lots: [], serials: [] }; });
    });
};
/** pickTransactions body (§9.4) from allocations keyed by PickSlipLine. */
FOM.pickBody = function (slip, lines, alloc) {
    return {
        pickLines: lines.filter(function (l) { return alloc[l.PickSlipLine]; }).map(function (l) {
            var a = alloc[l.PickSlipLine], n = String(a.serials.length || a.qty);
            var pl = { PickSlip: String(slip.PickSlip), PickSlipLine: String(l.PickSlipLine), PickedQuantity: n };
            var sub = l.SourceSubinventory || l.DestinationSubinventory || l.Subinventory; if (sub) pl.SubinventoryCode = sub;
            var sers = a.serials.map(function (s) { return { FromSerialNumber: s, ToSerialNumber: s }; });
            if (a.lot && sers.length) pl.lotSerialItemLots = [{ Lot: a.lot, Quantity: n, lotSerialItemSerials: sers }];
            else if (a.lot) pl.lotItemLots = [{ Lot: a.lot, Quantity: n }];
            else if (sers.length) pl.serialItemSerials = sers;
            return pl;
        })
    };
};
/** PickSlipDialog (§9.2) */
FOM.pickSlipDlg = function (slip, onDone) {
    var alloc = {}, lines = [], org = slip.Organization || slip.OrganizationCode;
    var facts = [['Pick Slip', slip.PickSlip], ['Pick Wave', slip.PickWave], ['Organization', org], ['Order', slip.Order], ['Customer', slip.Customer], ['# Picks', slip.NumberOfPicks], ['Due Date', FOM.d(slip.DueDate)], ['Created', FOM.dt(slip.CreationDate)], ['Shipment', slip.Shipment], ['Movement Request', slip.MovementRequest], ['Shipping Method', slip.ShippingMethod], ['Ship To', slip.ShipToLocation]];
    var d = FOM.dlg({
        title: '<i class="fa-solid fa-clipboard-list"></i> Pick slip ' + esc(slip.PickSlip), xwide: true,
        body: '<div class="facts">' + facts.filter(function (f) { return f[1] != null && f[1] !== ''; }).map(function (f) { return '<div><span>' + f[0] + '</span><span class="fom-clamp">' + esc(f[1]) + '</span></div>'; }).join('') + '</div><div data-tabs></div>',
        foot: '<span class="muted" data-st style="margin-right:auto;font-size:.8rem">Use Allocate on a pick line to enable Confirm Pick</span>',
        buttons: [{ label: 'Close', act: 'close' }, { label: '<i class="fa-solid fa-truck"></i> Ship Confirm', act: 'ship' }, { label: '<i class="fa-solid fa-check-double"></i> Confirm Pick', act: 'confirm', cls: 'primary', id: 'fom-ps-ok', disabled: true }],
        onAction: function (a) {
            if (a === 'ship') { FOM.shipConfirmDlg(slip.Shipment, org, onDone); return false; }
            if (a === 'confirm') { confirmPick(); return false; }
        }
    });
    var tabs, childNames = [];
    function status() { var n = Object.keys(alloc).length; d.q('[data-st]').innerHTML = n ? '<b style="color:var(--ok)">Allocated ' + n + ' line(s) — ready to confirm</b>' : 'Use Allocate on a pick line to enable Confirm Pick'; d.q('#fom-ps-ok').disabled = !n; if (tabs) tabs.badge('c_itemSerials', n ? 'alloc ' + n : ''); }
    function linesTab(el, reload) {
        el.innerHTML = '<div class="row-btns" style="margin-bottom:6px"><span class="muted" style="font-size:.78rem">' + lines.length + ' pick line(s)</span><span class="grow"></span><button class="btn sm" data-rl><i class="fa-solid fa-rotate"></i> Reload</button></div><div data-t></div>';
        function draw() {
            el.querySelector('[data-t]').innerHTML = FOM.table(lines, [
                { f: 'PickSlipLine', label: 'Slip Line' }, { f: 'Item', label: 'Item', mono: 1 }, { label: 'Requested', n: 1, html: function (l) { return FOM.qty(l.RequestedQuantity) + ' ' + esc(l.UOM || ''); } }, { f: 'MaximumPickedQuantity', label: 'Max Picked', n: 1 },
                { f: 'TransactionType', label: 'Txn Type' }, { f: 'SourceSubinventory', label: 'Src Subinv' }, { f: 'DestinationSubinventory', label: 'Dest Subinv' }, { f: 'SourceLocator', label: 'Src Locator' }, { f: 'RequiredDate', label: 'Required', fmt: 'd' },
                { label: 'Source Order', html: function (l) { return esc([l.SourceOrder, l.SourceOrderLine].filter(Boolean).join(' / ')); } }, { f: 'MovementRequestLine', label: 'Mv Req Line' },
                { label: 'Error', html: function (l) { var e = l.ErrorExplanation || l.ErrorCode; return e ? '<span style="color:var(--err)">' + esc(e) + '</span>' : ''; } },
                { label: '', html: function (l) { var a = alloc[l.PickSlipLine]; return '<button class="btn sm ' + (a ? 'ok' : '') + '" data-al="' + esc(l.PickSlipLine) + '">' + (a ? '<i class="fa-solid fa-check"></i> ' + (a.serials.length || a.qty) + (a.lot ? ' · ' + esc(a.lot) : '') : 'Allocate') + '</button>'; } }
            ], { empty: 'No pick lines.' });
        }
        el.onclick = function (e) {
            if (e.target.closest('[data-rl]')) { load().then(function () { reload(); }); return; }
            var b = e.target.closest('[data-al]'); if (!b) return;
            var l = lines.filter(function (x) { return String(x.PickSlipLine) === b.getAttribute('data-al'); })[0];
            FOM.allocateDlg(org, l, alloc[l.PickSlipLine]).then(function (a) { if (a) { alloc[l.PickSlipLine] = a; draw(); status(); } });
        };
        draw();
    }
    function childTab(name) {
        return function (el, reload) {
            el.innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Merging ' + esc(name) + ' across ' + lines.length + ' lines…</div>';
            FOM.mapLimit(lines, 6, function (l) { var h = FOM.link(l, name); return h ? FOM.all(h, { limit: 500 }).then(function (r) { return r.map(function (x) { return Object.assign({ _line: l.PickSlipLine, _item: l.Item }, x); }); }) : []; }).then(function (ch) {
                var rows = [].concat.apply([], ch.filter(Array.isArray));
                if (!rows.length && /serial/i.test(name) && Object.keys(alloc).length) {
                    var pend = Object.keys(alloc).map(function (k) { var a = alloc[k], s = a.serials.slice().sort(function (x, y) { return String(x).localeCompare(String(y), undefined, { numeric: true }); }); return { Line: k, Item: a.item, Lot: a.lot, From: s[0] || '', To: s[s.length - 1] || '', Qty: a.serials.length || a.qty }; });
                    el.innerHTML = '<div class="note">Nothing in Fusion yet — your pending allocations:</div>' + FOM.table(pend, [{ f: 'Line', label: 'Line' }, { f: 'Item', label: 'Item', mono: 1 }, { f: 'Lot', label: 'Selected Lot' }, { f: 'From', label: 'Serial From', mono: 1 }, { f: 'To', label: 'Serial To', mono: 1 }, { f: 'Qty', label: 'Qty', n: 1 }]);
                    return;
                }
                el.innerHTML = '<div class="row-btns" style="margin-bottom:6px"><span class="muted" style="font-size:.76rem">Merged from ' + lines.length + ' lines</span><span class="grow"></span><button class="btn sm" data-rl><i class="fa-solid fa-rotate"></i> Reload</button></div>' + FOM.table(rows, [{ f: '_line', label: 'Line' }, { f: '_item', label: 'Item', mono: 1 }].concat(FOM.dyn(rows, ['_line', '_item'])), { empty: 'None.' });
                var rb = el.querySelector('[data-rl]'); if (rb) rb.onclick = reload;
            });
        };
    }
    function load() {
        return FOM.pickLinesOf(slip).then(function (r) {
            lines = r; childNames = [];
            lines.forEach(function (l) { (l.links || []).forEach(function (x) { if (x.rel === 'child' && childNames.indexOf(x.name) < 0) childNames.push(x.name); }); });
        });
    }
    function build() {
        tabs = FOM.tabs(d.q('[data-tabs]'), [{ id: 'lines', label: 'Pick lines', badge: lines.length, render: linesTab }].concat(childNames.map(function (n) { return { id: 'c_' + n, label: FOM.humanize(n), render: childTab(n) }; })));
        status();
    }
    function confirmPick() {
        var body = FOM.pickBody(slip, lines, alloc), url = FOM.u('pickTransactions');
        var cd = FOM.dlg({
            title: 'Confirm pick — ' + esc(slip.PickSlip), wide: true, body: '<div class="fom-call"><b class="m POST">POST</b> <span class="mono">' + esc(url) + '</span></div><pre class="json" data-j>' + esc(JSON.stringify(body, null, 2)) + '</pre><div data-r></div>',
            buttons: [{ label: 'Copy JSON', act: 'copy' }, { label: 'Close', act: 'close' }, { label: 'Confirm Pick', act: 'go', cls: 'primary' }],
            onAction: function (a, dd, btn) {
                if (a === 'copy') { FOM.copy(JSON.stringify(body, null, 2)); return false; }
                if (a !== 'go') return;
                btn.disabled = true; dd.q('[data-r]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Confirming…';
                FOM.raw('POST', 'pickTransactions', { contentType: 'json' }, body).then(function (r) {
                    if (r.ok && !(r.json && r.json.ReturnStatus === 'E')) { dd.q('[data-r]').innerHTML = '<div class="note ok">Pick confirmed in Fusion.</div><pre class="json">' + esc(JSON.stringify(r.json, null, 2)) + '</pre>'; alloc = {}; status(); load().then(build); if (onDone) onDone(); }
                    else { btn.disabled = false; dd.q('[data-r]').innerHTML = '<div class="note err" style="white-space:pre-wrap">HTTP ' + r.status + '\n' + esc(FOM.errs(r.json, r.text, r.status).join('\n')) + '</div>'; }
                }).catch(function (e) { btn.disabled = false; dd.q('[data-r]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
                return false;
            }
        });
        return cd;
    }
    d.q('[data-tabs]').innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading pick lines…</div>';
    load().then(build).catch(function (e) { d.q('[data-tabs]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
    return d;
};
FOM.localIso = function (v) {
    if (!v) return null; var d = new Date(v); if (isNaN(d)) return null;
    var off = -d.getTimezoneOffset(), p = function (x) { return ('0' + Math.floor(Math.abs(x))).slice(-2); };
    return v.length === 16 ? v + ':00' + (off >= 0 ? '+' : '-') + p(off / 60) + ':' + p(off % 60) : v;
};
/** ShipConfirmModal (§9.5) */
FOM.shipConfirmDlg = function (shipment, org, onDone) {
    var d = FOM.dlg({
        title: '<i class="fa-solid fa-truck"></i> Ship confirm',
        body: '<div class="form"><label>Shipment <b class="r">*</b><input data-s value="' + esc(shipment || '') + '"></label><label>Organization <b class="r">*</b><input data-o value="' + esc(org || '') + '"></label>' +
            '<label>Actual ship date (optional)<input type="datetime-local" data-d></label><label data-rl hidden>Ship confirm rule<input data-r value="' + esc(FOM.cfg('shipConfirmRule')) + '"></label></div>' +
            '<div class="note" data-n>Without a date: POST shippingTransactions (confirm with the rule defaults, ship date = today).</div><div data-res></div>',
        buttons: [{ label: 'Close', act: 'close' }, { label: 'Ship Confirm', act: 'go', cls: 'primary' }],
        onOpen: function (dd) { dd.q('[data-d]').oninput = function () { dd.q('[data-rl]').hidden = !this.value; dd.q('[data-n]').textContent = this.value ? 'With a date: POST shipmentTransactionRequests (ShipmentUpdate) — processed asynchronously by the shipment interface; recheck the status afterwards.' : 'Without a date: POST shippingTransactions (confirm with the rule defaults, ship date = today).'; }; },
        onAction: function (a, dd, btn) {
            if (a !== 'go') return;
            var s = dd.q('[data-s]').value.trim(), o = dd.q('[data-o]').value.trim(), dt = dd.q('[data-d]').value;
            if (!s || !o) { FX.toast('Shipment and Organization are required', 'err'); return false; }
            var path = dt ? 'shipmentTransactionRequests' : 'shippingTransactions';
            var body = dt ? { ActionCode: 'ShipmentUpdate', shipments: [{ Shipment: s, ShipFromOrganizationCode: o, ActualShipDate: FOM.localIso(dt), ShipConfirmRule: dd.q('[data-r]').value.trim() || FOM.cfg('shipConfirmRule') }] } : { ShipmentName: s, Action: 'CONFIRM', Organization: o };
            btn.disabled = true; dd.q('[data-res]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Sending…';
            FOM.raw('POST', path, { contentType: 'json' }, body).then(function (r) {
                btn.disabled = false;
                if (r.ok && !(r.json && r.json.ReturnStatus === 'E')) { dd.q('[data-res]').innerHTML = '<div class="note ok">' + (dt ? 'Shipment update request accepted — recheck the status in a moment.' : 'Ship confirmed in Fusion.') + '</div>'; FX.toast('Ship confirm sent', 'ok'); if (onDone) onDone(); }
                else dd.q('[data-res]').innerHTML = '<div class="note err" style="white-space:pre-wrap">HTTP ' + r.status + '\n' + esc(FOM.errs(r.json, r.text, r.status).join('\n')) + '</div>';
            }).catch(function (e) { btn.disabled = false; dd.q('[data-res]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
            return false;
        }
    });
    return d;
};

/** Auto Ship Confirm dialog (§3.0.8): pick release → pick confirm → ship confirm, or Run All Steps. */
FOM.autoShipDlg = function (orderNo, orgIn, onDone) {
    var lines = [], org = orgIn || '', busy = false;
    var d = FOM.dlg({
        title: '<i class="fa-solid fa-truck-fast"></i> Auto ship confirm — order ' + esc(orderNo), xwide: true,
        body: '<div data-stp></div><div class="row-btns" data-btns></div><div data-prog></div><div data-lines><i class="fa-solid fa-circle-notch fa-spin"></i> Reading shipment lines…</div>',
        buttons: [{ label: 'Close', act: 'close' }],
        onClose: function () { if (onDone) onDone(); }
    });
    function prog(t, cls) { d.q('[data-prog]').innerHTML = t ? '<div class="note ' + (cls || '') + '" style="white-space:pre-wrap">' + t + '</div>' : ''; }
    function candidates() { return lines.filter(function (l) { return !(l.Shipment || l.ShipmentName) && l.ShipmentLine && /stage|ready|release|backorder/i.test(l.LineStatus || ''); }); }
    function draw() {
        var st = FOM.shipStage(lines); org = orgIn || (lines[0] && lines[0].OrganizationCode) || org;
        d.q('[data-stp]').innerHTML = FOM.shipStepper(Math.min(st, 4));
        var c = candidates().length;
        d.q('[data-btns]').innerHTML = '<button class="btn" data-x="check"><i class="fa-solid fa-rotate"></i> Check Status</button>' +
            '<button class="btn" data-x="release"' + (st === 0 && lines.length ? '' : ' disabled') + '><i class="fa-solid fa-people-carry-box"></i> Pick Release</button>' +
            '<button class="btn" data-x="pick"' + (st >= 1 ? '' : ' disabled') + '><i class="fa-solid fa-barcode"></i> Pick Confirm — assign lots / serials</button>' +
            '<button class="btn" data-x="shipm"' + (c ? '' : ' disabled') + '><i class="fa-solid fa-box"></i> Create Shipment (' + c + ')</button>' +
            '<button class="btn" data-x="ship"' + (st >= 2 ? '' : ' disabled') + '><i class="fa-solid fa-truck"></i> Ship Confirm</button><span class="grow"></span>' +
            '<button class="btn primary" data-x="auto"' + (st === 0 && lines.length ? '' : ' disabled') + '><i class="fa-solid fa-wand-magic-sparkles"></i> Run All Steps (Auto)</button>';
        d.q('[data-lines]').innerHTML = FOM.table(lines, [
            { f: 'OrderLine', label: 'Line' }, { f: 'Item', label: 'Item', mono: 1 }, { f: 'ItemDescription', label: 'Description' },
            { label: 'Requested', n: 1, html: function (l) { return FOM.qty(l.RequestedQuantity) + ' ' + esc(FOM.pf(l, ['RequestedQuantityUOMCode', 'RequestedQuantityUOM']) || ''); } }, { f: 'ShippedQuantity', label: 'Shipped', n: 1, fmt: 'qty' },
            { label: 'Unit Price', n: 1, html: function (l) { return FOM.amt(FOM.pf(l, ['SellingPrice', 'UnitPrice'])); } }, { f: 'Subinventory', label: 'Subinv' },
            { label: 'Organization', html: function (l) { return '<span title="' + esc(l.OrganizationName || '') + '">' + esc(l.OrganizationCode || '') + '</span>'; } }, { f: 'Shipment', label: 'Shipment' },
            { label: 'Line Status', html: function (l) { return FOM.shipStatusChip(l.LineStatus); } }
        ], { empty: 'No shipment lines yet for this order — confirm the order first, then Check Status', icon: 'fa-truck-ramp-box' });
    }
    function load() { return FOM.shipLines(orderNo).then(function (r) { lines = r; draw(); }).catch(function (e) { d.q('[data-lines]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; }); }
    function release() {
        if (!org) return Promise.reject('No organization on the shipment lines');
        return FOM.pickRelease(orderNo, org).then(function (r) { if (!r.ok) throw r.msg; return r; });
    }
    function autoPick(slip) {
        return FOM.pickLinesOf(slip).then(function (pl) {
            var todo = pl.filter(function (l) { return l.Item && FOM.n(l.RequestedQuantity) > 0; }), alloc = {}, skipped = [];
            return FOM.mapLimit(todo, 3, function (l) {
                return FOM.lotSerials(org, l.Item, l.SourceSubinventory).then(function (r) {
                    var req = FOM.n(l.RequestedQuantity), lots = r.lots.slice().sort(function (a, b) { return b.qty - a.qty; }), lot = '', sers = [];
                    if (lots.length) { var f = lots.filter(function (x) { return x.serials.length >= req; })[0] || lots[0]; lot = f.lot; sers = f.serials.slice(0, req); }
                    else sers = r.serials.slice(0, req);
                    if (sers.length) alloc[l.PickSlipLine] = { item: l.Item, lot: lot, serials: sers }; else skipped.push(l.Item);
                });
            }).then(function () {
                if (!Object.keys(alloc).length) return { skipped: skipped, none: true };
                return FOM.write('POST', 'pickTransactions', FOM.pickBody(slip, pl, alloc)).then(function () { return { skipped: skipped }; });
            });
        });
    }
    function runAll() {
        busy = true; var log = [];
        var say = function (t) { log.push(t); prog(log.join('\n')); };
        say('1/4 Pick release…');
        return release().then(function () {
            say('   ✓ released'); say('2/4 Waiting for the lines to be released…');
            var n = 0;
            function poll() { return FOM.shipLines(orderNo).then(function (r) { lines = r; draw(); if (r.length && r.every(function (l) { return FOM.shipLineStage(l) >= 1; })) return; if (++n >= 30) throw 'Lines were not released after 30 s — check the pick wave in Fusion.'; return FOM.sleep(1000).then(poll); }); }
            return poll();
        }).then(function () {
            say('3/4 Pick confirm (lots / serials from on-hand)…');
            return FOM.pickSlips(orderNo).then(function (slips) {
                if (!slips.length) throw 'No pick slips were created.';
                return FOM.mapLimit(slips, 1, autoPick).then(function (rs) {
                    rs.forEach(function (r, i) { if (r && r._error) throw r._error; if (r.skipped && r.skipped.length) say('   ! not serial-controlled, confirm by hand: ' + r.skipped.join(', ')); if (r.none) say('   ! slip ' + slips[i].PickSlip + ': nothing could be allocated automatically'); });
                });
            });
        }).then(function () {
            return FOM.shipLines(orderNo).then(function (r) {
                lines = r; draw();
                var sh = (r[0] && (r[0].Shipment || r[0].ShipmentName)) || '';
                if (!sh) throw 'No shipment on the lines yet — use Create Shipment, then Ship Confirm.';
                say('4/4 Ship confirm ' + sh + '…');
                return FOM.write('POST', 'shippingTransactions', { ShipmentName: sh, Action: 'CONFIRM', Organization: org });
            });
        }).then(function () { say('✓ Automated workflow completed'); prog(log.join('\n'), 'ok'); setTimeout(load, 2000); })
            .catch(function (e) { say('✗ ' + FOM.emsg(e)); prog(log.join('\n'), 'err'); load(); })
            .then(function () { busy = false; });
    }
    d.box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-x]'); if (!b || busy) return;
        var x = b.getAttribute('data-x');
        if (x === 'check') load();
        else if (x === 'release') FOM.confirm('Pick release', 'Release order <b>' + esc(orderNo) + '</b> from <b>' + esc(org) + '</b> (pickWaves)?', 'Pick Release').then(function (ok) { if (!ok) return; prog('<i class="fa-solid fa-circle-notch fa-spin"></i> Releasing…'); release().then(function () { prog('Pick Release Success', 'ok'); load(); }).catch(function (er) { prog(esc(FOM.emsg(er)), 'err'); }); });
        else if (x === 'pick') FOM.openPickSlips(orderNo, load);
        else if (x === 'ship') FOM.shipConfirmDlg((lines[0] && (lines[0].Shipment || lines[0].ShipmentName)) || '', org, load);
        else if (x === 'auto') FOM.confirm('Run all steps', 'Pick release, wait, pick-confirm serial items from on-hand and ship confirm order <b>' + esc(orderNo) + '</b>?', 'Run').then(function (ok) { if (ok) runAll(); });
        else if (x === 'shipm') {
            var c = candidates(), fails = [];
            prog('<i class="fa-solid fa-circle-notch fa-spin"></i> Creating shipments for ' + c.length + ' line(s)…');
            FOM.mapLimit(c, 2, function (l) {
                return FOM.raw('POST', 'shipmentLineChangeRequests/action/pickRelease', { contentType: 'action' }, { shipmentLine: +l.ShipmentLine }).then(function (r) {
                    if (!r.ok || (r.json && r.json.ReturnStatus === 'E')) fails.push((l.Item || '') + ' (line ' + l.OrderLine + '): ' + ((r.json && r.json.ReturnMessage) || FOM.errs(r.json, r.text, r.status)[0]));
                });
            }).then(function () { prog(fails.length ? esc(fails.join('\n')) : 'Shipments created for ' + c.length + ' line(s).', fails.length ? 'err' : 'ok'); load(); });
        }
    });
    load();
    return d;
};

// ── View: Shipment Lines (§8) ──────────────────────────────────
FOM.ORDER_TYPES_SHIP = ['Sales order', 'Transfer order', 'Purchase order', 'Return material authorization'];
FOM.LINE_STATUSES = ['Ready to release', 'Released to warehouse', 'Released', 'Staged', 'Shipped', 'Backordered', 'Interfaced', 'Awaiting shipping'];
FOM.orgCodes = function () { return FOM.orgs().then(function (l) { return l.map(function (o) { return { v: o.OrganizationCode, t: o.OrganizationCode + ' — ' + (o.OrganizationName || '') }; }).sort(function (a, b) { return a.v.localeCompare(b.v); }); }); };
FOM.viewShipLines = function (el) {
    var cdOp = function (g) { return g.val('op') || '>'; };
    var g = FX.grid(el, {
        id: 'fsl', pageSize: 50, qJoin: ';', csvName: 'shipment_lines',
        filters: [
            { id: 'op', label: 'Created', type: 'select', options: [{ v: '>', t: '>' }, { v: '>=', t: '>=' }, { v: '=', t: '=' }, { v: '<=', t: '<=' }, { v: '<', t: '<' }] },
            { id: 'cd', label: 'Creation date', type: 'date', q: function (v, g2) { return 'CreationDate' + cdOp(g2) + v; } },
            { id: 'org', label: 'Organization *', type: 'lov', lov: FOM.orgCodes, blank: 'Select…', value: lsGet('fom_sl_org', ''), q: function (v) { return "OrganizationCode='" + v + "'"; } },
            { id: 'ot', label: 'Order type *', type: 'select', options: FOM.ORDER_TYPES_SHIP, value: 'Sales order', q: function (v) { return "OrderType='" + v + "'"; } },
            { id: 'ord', label: 'Order', ph: 'Order number', q: function (v) { return "Order='" + v.replace(/'/g, "''") + "'"; } },
            { id: 'item', label: 'Item', ph: 'Starts with…', q: function (v) { return "Item LIKE '" + v.replace(/'/g, "''") + "%'"; } },
            { id: 'st', label: 'Line status', type: 'select', options: [{ v: '', t: 'Any' }].concat(FOM.LINE_STATUSES.map(function (s) { return { v: s, t: s }; })), value: 'Ready to release', q: function (v) { return "LineStatus='" + v + "'"; } },
            { id: 'desc', label: 'Description contains', q: function (v) { return "ItemDescription LIKE '%" + v.replace(/'/g, "''") + "%'"; } }
        ],
        validate: function (g2) { if (!g2.val('org')) return 'Organization is required.'; if (!g2.val('ot')) return 'Order Type is required.'; lsSet('fom_sl_org', g2.val('org')); },
        load: function (g2) {
            return FX.get('shipmentLines', { q: g2.buildQ(), fields: 'OrganizationCode,OrganizationName,OrderType,OrderTypeCode,ShipmentLine,Order,OrderLine,Item,ItemDescription,LineStatus,RequestedDate,RequestedQuantity,RequestedQuantityUOM,Shipment', limit: 50, offset: g2.offset })
                .then(function (j) { g2.hasMore = !!j.hasMore; g2.total = null; return j.items || []; });
        },
        emptyText: 'No shipment lines matched. Try another status' + ' or widen the Creation Date filter.',
        columns: [
            { f: 'RequestedDate', label: 'Requested', get: function (r) { return r.RequestedDate; }, html: function (r) { return esc(FOM.d(r.RequestedDate)); } },
            { f: 'LineStatus', label: 'Line Status', html: function (r) { return FOM.shipStatusChip(r.LineStatus); } },
            { f: 'OrganizationCode', label: 'Org', html: function (r) { return '<span title="' + esc(r.OrganizationName || '') + '">' + esc(r.OrganizationCode || '') + '</span>'; } },
            { f: 'ShipmentLine', label: 'Shipment Line', fmt: 'mono' },
            { f: 'OrderType', label: 'Order Type', html: function (r) { return '<span title="' + esc(r.OrderTypeCode || '') + '">' + esc(r.OrderType || '') + '</span>'; } },
            { f: 'Order', label: 'Order', html: function (r) { return '<a class="fom-a" data-ord="' + esc(r.Order) + '">' + esc(r.Order) + '</a>'; } },
            { f: 'OrderLine', label: 'Line' }, { f: 'Item', label: 'Item', fmt: 'mono' }, { f: 'ItemDescription', label: 'Description' },
            { f: 'RequestedQuantity', label: 'Requested Qty', n: 1, html: function (r) { return FOM.qty(r.RequestedQuantity) + ' ' + esc(r.RequestedQuantityUOM || ''); } }
        ],
        kpis: function (rows) {
            var c = function (re) { return rows.filter(function (r) { return re.test(r.LineStatus || ''); }).length; };
            return [{ k: 'all', label: 'Lines', value: rows.length }, { k: 'rr', label: 'Ready to release', value: c(/ready/i), filter: function (r) { return /ready/i.test(r.LineStatus); } }, { k: 'rel', label: 'Released', value: c(/released/i), filter: function (r) { return /released/i.test(r.LineStatus); } }, { k: 'stg', label: 'Staged', value: c(/staged/i), filter: function (r) { return /staged/i.test(r.LineStatus); } }, { k: 'bo', label: 'Backordered', value: c(/backorder/i), filter: function (r) { return /backorder/i.test(r.LineStatus); } }, { k: 'sh', label: 'Shipped', value: c(/shipped|interfaced/i), filter: function (r) { return /shipped|interfaced/i.test(r.LineStatus); } }, { k: 'ord', label: 'Orders', value: FOM.distinct(rows.map(function (r) { return r.Order; })).length }];
        },
        rowActions: [{ label: 'All fields', icon: 'fa-ellipsis', run: function (r) { FOM.shipLineRecord(r); } }],
        actions: [{ label: 'Reset', icon: 'fa-eraser', run: function (g2) { g2.setVal('op', '>'); g2.setVal('cd', ''); g2.setVal('st', 'Ready to release'); g2.setVal('org', ''); g2.setVal('ord', ''); g2.setVal('item', ''); g2.setVal('desc', ''); } }]
    });
    el.addEventListener('click', function (e) { var a = e.target.closest('[data-ord]'); if (a) { e.stopPropagation(); var row = g.rows.filter(function (r) { return String(r.Order) === a.getAttribute('data-ord'); })[0]; FOM.shipOrderDlg(a.getAttribute('data-ord'), row); } }, true);
    if (FOM.cfg('_autoShip') !== 'N' && g.val('org')) g.search();
};
FOM.shipLineRecord = function (r) {
    FX.busy('Reading shipment line…');
    FX.get('shipmentLines', { q: 'ShipmentLine=' + r.ShipmentLine, limit: 1 }).then(function (j) {
        FX.busy(); var rec = (j.items || [])[0] || r, clean = {};
        Object.keys(rec).forEach(function (k) { if (!FOM.isIdKey(k) && !/^Src|^QuickShip/.test(k) && !FOM.isEmpty(rec[k])) clean[k] = rec[k]; });
        FX.drawer({ title: 'Shipment line ' + esc(r.ShipmentLine), sub: esc((rec.Item || '') + ' · order ' + (rec.Order || '')), chips: [FOM.shipStatusChip(rec.LineStatus)], raw: rec, facts: Object.keys(clean).sort().map(function (k) { return [FOM.humanize(k), FOM.val(k, clean[k])]; }), actions: [{ label: 'Open order ' + (rec.Order || ''), icon: 'fa-box-open', run: function () { FOM.shipOrderDlg(rec.Order, rec); } }] });
    }).catch(function (e) { FX.busy(); FX.toast(FOM.emsg(e), 'err'); });
};
/** Order dialog (§8.3) */
FOM.shipOrderDlg = function (order, row) {
    var lines = [], hdr = row || {};
    var d = FOM.dlg({
        title: '<i class="fa-solid fa-truck-ramp-box"></i> Shipment lines — order ' + esc(order), xwide: true,
        body: '<div data-stp></div><div data-h></div><div data-l><i class="fa-solid fa-circle-notch fa-spin"></i> Reading lines…</div><div data-res></div>',
        buttons: [{ label: '<i class="fa-solid fa-rotate"></i> Refresh', act: 'refresh' }, { label: '<i class="fa-solid fa-clipboard-list"></i> Pick Slip', act: 'slip' }, { label: '<i class="fa-solid fa-truck"></i> Ship Confirm', act: 'ship' }, { label: '<i class="fa-solid fa-people-carry-box"></i> Pick Release', act: 'release', cls: 'primary', id: 'fom-so-rel', disabled: true }, { label: 'Close', act: 'close' }],
        onAction: function (a, dd) {
            if (a === 'refresh') { load(); return false; }
            if (a === 'slip') { FOM.openPickSlips(order, load); return false; }
            if (a === 'ship') { FOM.shipConfirmDlg(hdr.Shipment || hdr.ShipmentName || (lines[0] && lines[0].Shipment) || '', hdr.OrganizationCode, load); return false; }
            if (a === 'release') {
                var code = FOM.orderTypeCode(hdr);
                FOM.confirm('Pick release', 'Release order <b>' + esc(order) + '</b> (' + esc(hdr.OrderType || code) + ') from <b>' + esc(hdr.OrganizationCode) + '</b>?', 'Pick Release').then(function (ok) {
                    if (!ok) return;
                    dd.q('[data-res]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Releasing…';
                    FOM.pickRelease(order, hdr.OrganizationCode, code).then(function (r) {
                        dd.q('[data-res]').innerHTML = '<div class="note ' + (r.ok ? 'ok' : 'err') + '" style="white-space:pre-wrap">' + esc(r.msg) + '</div><details><summary class="muted" style="font-size:.76rem;cursor:pointer">Request / response</summary><pre class="json">' + esc(JSON.stringify({ request: r.body, response: r.json }, null, 2)) + '</pre></details>';
                        if (r.ok) load();
                    }).catch(function (e) { dd.q('[data-res]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
                });
                return false;
            }
        }
    });
    function load() {
        d.q('[data-l]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Reading lines…';
        FOM.shipLines(order).then(function (r) {
            lines = r; if (r[0]) hdr = Object.assign({}, row || {}, r[0]);
            var f = [['Order', hdr.Order], ['Order Type', [hdr.OrderType, hdr.OrderTypeCode].filter(Boolean).join(' · ')], ['Ship-From Org', [hdr.OrganizationCode, hdr.OrganizationName].filter(Boolean).join(' — ')], ['Destination Org', hdr.DestinationOrganizationCode], ['Business Unit', hdr.BusinessUnit], ['Legal Entity', hdr.LegalEntity], ['Requested', FOM.d(hdr.RequestedDate)], ['Scheduled Ship', FOM.d(hdr.ScheduledShipDate)], ['Created', FOM.dt(hdr.CreationDate)], ['Currency', hdr.CurrencyCode], ['Ship To', hdr.ShipToLocation], ['Src → Dest Subinv', [hdr.SourceSubinventory, hdr.DestinationSubinventory].filter(Boolean).join(' → ')]];
            d.q('[data-h]').innerHTML = '<div class="facts">' + f.filter(function (x) { return x[1]; }).map(function (x) { return '<div><span>' + x[0] + '</span>' + esc(x[1]) + '</div>'; }).join('') + '</div>';
            d.q('[data-stp]').innerHTML = FOM.shipStepper(Math.min(FOM.shipStage(lines), 4));
            d.q('[data-l]').innerHTML = FOM.table(lines, [{ f: 'ShipmentLine', label: 'Ship Line', mono: 1 }, { f: 'OrderLine', label: 'Line' }, { f: 'Item', label: 'Item', mono: 1 }, { f: 'ItemDescription', label: 'Description' }, { label: 'Requested', n: 1, html: function (l) { return FOM.qty(l.RequestedQuantity) + ' ' + esc(l.RequestedQuantityUOM || ''); } }, { f: 'ShippedQuantity', label: 'Shipped', n: 1, fmt: 'qty' }, { f: 'PendingQuantity', label: 'Pending', n: 1, fmt: 'qty' }, { label: 'Line Status', html: function (l) { return FOM.shipStatusChip(l.LineStatus); } }, { f: 'OrganizationCode', label: 'Org' }, { label: 'Src → Dest Subinv', html: function (l) { return esc([l.SourceSubinventory, l.DestinationSubinventory].filter(Boolean).join(' → ')); } }, { f: 'RequestedDate', label: 'Requested', fmt: 'd' }, { f: 'Shipment', label: 'Shipment' }], { empty: 'No shipment lines for this order.' });
            d.q('#fom-so-rel').disabled = !lines.some(function (l) { return /^ready to release/i.test(l.LineStatus || '') || /backorder/i.test(l.LineStatus || ''); });
        }).catch(function (e) { d.q('[data-l]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
    }
    load();
};

// ── View: Confirm Picks (§9) ───────────────────────────────────
FOM.viewConfirmPicks = function (el) {
    var g = FX.grid(el, {
        id: 'fcp', qJoin: ';', csvName: 'pick_slips',
        filters: [
            { id: 'op', label: 'Created', type: 'select', options: [{ v: '>', t: '>' }, { v: '>=', t: '>=' }, { v: '=', t: '=' }, { v: '<=', t: '<=' }, { v: '<', t: '<' }] },
            { id: 'cd', label: 'Creation date', type: 'date', value: FX.daysAgo(7), q: function (v, g2) { return 'CreationDate' + (g2.val('op') || '>') + v; } },
            { id: 'ord', label: 'Order', ph: 'Order number', q: function (v) { return "Order='" + v.replace(/'/g, "''") + "'"; } },
            { id: 'org', label: 'Organization', type: 'lov', lov: function () { return FOM.orgCodes().then(function (l) { return l.map(function (o) { return { v: o.v, t: o.v }; }); }); }, q: function (v) { return "Organization='" + v + "'"; } }
        ],
        load: function (g2) { g2.hasMore = false; return FOM.all('pickSlipDetails', { q: g2.buildQ(), orderBy: 'CreationDate:desc', onlyData: false, limit: 500 }, 3000); },
        emptyText: 'No pick slips matched.',
        onRow: function (r) { FOM.pickSlipDlg(r, function () { g.search(); }); },
        columns: [
            { f: 'PickSlip', label: 'Pick Slip', html: function (r) { return '<a class="fom-a">' + esc(r.PickSlip) + '</a>'; } }, { f: 'PickWave', label: 'Pick Wave' }, { f: 'Organization', label: 'Org' }, { f: 'Order', label: 'Order' }, { f: 'Customer', label: 'Customer' },
            { f: 'NumberOfPicks', label: '# Picks', n: 1 }, { f: 'DueDate', label: 'Due', html: function (r) { return esc(FOM.d(r.DueDate)); } }, { f: 'CreationDate', label: 'Created', html: function (r) { return esc(FOM.dt(r.CreationDate)); } },
            { f: 'Shipment', label: 'Shipment' }, { f: 'MovementRequest', label: 'Movement Request' }, { f: 'ShippingMethod', label: 'Shipping Method' }, { f: 'ShipToLocation', label: 'Ship To', html: function (r) { return '<span class="fom-clamp">' + esc(r.ShipToLocation || '') + '</span>'; } }
        ],
        kpis: function (rows) { return [{ k: 's', label: 'Pick slips', value: rows.length }, { k: 'p', label: 'Picks', value: FOM.sum(rows, 'NumberOfPicks') }, { k: 'o', label: 'Orders', value: FOM.distinct(rows.map(function (r) { return r.Order; })).length }, { k: 'w', label: 'With shipment', value: rows.filter(function (r) { return r.Shipment; }).length, filter: function (r) { return !!r.Shipment; } }]; },
        actions: [{ label: 'Reset', icon: 'fa-eraser', run: function (g2) { g2.setVal('op', '>'); g2.setVal('cd', FX.daysAgo(7)); g2.setVal('ord', ''); g2.setVal('org', ''); } }]
    });
    return g;
};
