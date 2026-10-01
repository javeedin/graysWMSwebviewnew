/* Fusion Purchasing — receiving: Expected Receipts (linesToReceive → receive + deliver), Create ASN, Supplier Returns.
   All three post receivingReceiptRequests through PUR.receive (one success rule: HTTP 2xx, ProcessingStatusCode absent or
   SUCCESS / PENDING, ReturnStatus not ERROR). */

PUR.SRC_DOCS = [{ v: '', t: 'All' }, { v: 'PO', t: 'Purchase Order (PO)' }, { v: 'TRANSFER ORDER', t: 'Transfer Order (TO)' }, { v: 'ASN', t: 'ASN' }, { v: 'RMA', t: 'RMA' }];
PUR.lineKey = function (l) { return l.DocumentLineId != null ? String(l.DocumentLineId) : [l.DocumentNumber, l.DocumentLineNumber, l.DocumentScheduleNumber].join('-'); };
PUR.uom = function (l) { return l.UnitOfMeasure || l.UOMCode || ''; };
PUR.lnSch = function (l) { return (l.DocumentLineNumber != null ? l.DocumentLineNumber : '?') + '.' + (l.DocumentScheduleNumber != null ? l.DocumentScheduleNumber : '1'); };
PUR.intChip = function (s) { if (!s || s === '—') return '<span class="muted">—</span>'; return '<span class="chip ' + (s === 'Mixed' ? 'warn' : /ready to interface/i.test(s) ? 'ok' : 'warn') + '">' + esc(s) + '</span>'; };

// ── View: Expected Receipts ────────────────────────────────────
var ER = null;
function erGroup(rows) {
    var m = {}, order = [];
    rows.forEach(function (l) {
        var k = (l.DocumentNumber || '') + '||' + String(l.ASNNumber || '').trim();
        if (!m[k]) { m[k] = { key: k, DocumentNumber: l.DocumentNumber, asn: String(l.ASNNumber || '').trim(), lines: [], sets: {} }; order.push(k); }
        m[k].lines.push(l);
    });
    var one = function (g, f, multi) { var v = PUR.distinct(g.lines, f); return !v.length ? '—' : v.length === 1 ? v[0] : (multi || 'Multiple'); };
    return order.map(function (k) {
        var g = m[k], dues = g.lines.map(function (l) { return FX.fmt.date(l.DueDate); }).filter(Boolean).sort();
        g.ToOrganizationCode = one(g, 'ToOrganizationCode'); g.SourceDocumentCode = one(g, 'SourceDocumentCode'); g.VendorName = one(g, 'VendorName');
        g.DestinationType = one(g, 'DestinationType'); g.ShipToLocation = one(g, 'ShipToLocation'); g.IntegrationStatus = one(g, 'IntegrationStatus', 'Mixed');
        g.ASNNumbers = g.asn || PUR.distinct(g.lines, 'ASNNumber').join(', ');
        g.dueFirst = dues[0] || ''; g.dueLast = dues[dues.length - 1] || ''; g.linesCount = g.lines.length;
        return g;
    });
}
function erDays(d) { return d ? Math.floor((new Date(d + 'T00:00:00') - new Date(FX.today() + 'T00:00:00')) / 864e5) : null; }
function purReceipts(el) {
    var p = PUR.take('receipts');
    el.innerHTML = '<div id="er-list" style="display:flex;flex-direction:column;gap:10px;flex:1;min-height:0"></div><div id="er-det" style="display:flex;flex-direction:column;gap:10px" hidden></div>';
    var g = ER = FX.grid($('er-list'), {
        id: 'er', key: 'key', csvName: 'expected-po-receipts', emptyText: 'Search to list the PO schedules waiting to be received.',
        filters: [
            { id: 'org', label: 'Organization', type: 'lov', lov: 'orgs', value: PUR.recall('org'), blank: 'All' },
            { id: 'po', label: 'Purchase order', ph: 'e.g. 2026020014', value: p.po || '' },
            { id: 'asn', label: 'ASN number', ph: 'e.g. ASN2607282232' },
            { id: 'src', label: 'Source document', type: 'select', options: PUR.SRC_DOCS },
            { id: 'dm', label: 'Due date', type: 'select', options: [{ v: '', t: 'No date filter' }, { v: 'exact', t: 'Exact date' }, { v: 'last7', t: 'Last 7 days' }, { v: 'last15', t: 'Last 15 days' }, { v: 'range', t: 'Date range' }] },
            { id: 'd1', label: 'Date / from', type: 'date' }, { id: 'd2', label: 'To', type: 'date' }
        ],
        validate: function (g2) { var m = g2.val('dm'); if (m === 'exact' && !g2.val('d1')) return 'Pick the exact due date.'; if (m === 'range' && !(g2.val('d1') && g2.val('d2'))) return 'Pick both dates of the range.'; return null; },
        load: function (g2) {
            var q = [], v = function (k) { return g2.val(k); };
            if (v('org')) q.push('ToOrganizationCode=' + FX.qv(v('org')));
            if (v('po')) q.push('DocumentNumber=' + FX.qv(v('po')));
            if (v('asn')) q.push('ASNNumber=' + FX.qv(v('asn')));
            var dm = v('dm');
            if (dm === 'exact') q.push("DueDate='" + v('d1') + "'");
            if (dm === 'last7') q.push("DueDate>='" + FX.daysAgo(7) + "'");
            if (dm === 'last15') q.push("DueDate>='" + FX.daysAgo(15) + "'");
            if (dm === 'range') { q.push("DueDate>='" + v('d1') + "'"); q.push("DueDate<='" + v('d2') + "'"); }
            if (v('src')) q.push('SourceDocumentCode=' + FX.qv(v('src')));
            g2.quick = ''; var qi = g2.el.querySelector('[data-g="quick"]'); if (qi) qi.value = '';
            return FX.restAll('linesToReceive', { q: q.join(';'), limit: 500, onlyData: false }, 20000).then(function (rows) { g2.lineCount = rows.length; if (!rows.length) FX.toast('No records found.'); return erGroup(rows); });
        },
        columns: [
            { label: 'PO number', f: 'DocumentNumber', html: function (r) { return '<b class="mono">' + esc(r.DocumentNumber) + '</b>'; } },
            { label: 'ASN', f: 'ASNNumbers', html: function (r) { return r.ASNNumbers ? '<span class="chip info">' + esc(r.ASNNumbers) + '</span>' : '<span class="muted">—</span>'; } },
            { label: 'Lines', f: 'linesCount', n: 1 }, { label: 'Organization', f: 'ToOrganizationCode' }, { label: 'Source doc', f: 'SourceDocumentCode' }, { label: 'Vendor', f: 'VendorName' },
            { label: 'Destination', f: 'DestinationType' }, { label: 'Ship-to location', f: 'ShipToLocation' },
            { label: 'Integration status', f: 'IntegrationStatus', html: function (r) { return PUR.intChip(r.IntegrationStatus); } },
            { label: 'Due date', f: 'dueFirst', html: function (r) { return PUR.dueChip(r.dueFirst) + (r.dueLast && r.dueLast !== r.dueFirst ? ' <span class="muted">→</span> ' + PUR.dueChip(r.dueLast) : ''); } }
        ],
        kpis: function (rows) {
            var od = function (r) { var d = erDays(r.dueFirst); return d != null && d < 0; }, soon = function (r) { var d = erDays(r.dueFirst); return d != null && d >= 0 && d <= 7; };
            return [{ k: 'g', label: 'PO / ASN groups', value: rows.length }, { k: 'l', label: 'Schedules', value: PUR.sum(rows, 'linesCount') },
            { k: 'od', label: 'Overdue', value: rows.filter(od).length, filter: od }, { k: 'soon', label: 'Due within 7 days', value: rows.filter(soon).length, filter: soon },
            { k: 'asn', label: 'On an ASN', value: rows.filter(function (r) { return r.ASNNumbers; }).length, filter: function (r) { return !!r.ASNNumbers; } },
            { k: 'rdy', label: 'Ready to interface', value: rows.filter(function (r) { return /ready to interface/i.test(r.IntegrationStatus); }).length, filter: function (r) { return /ready to interface/i.test(r.IntegrationStatus); } }];
        },
        actions: [{ label: 'Export', icon: 'fa-file-csv', run: function (g2) { var v = g2.visible(); if (!v.length) { FX.toast('No data to export.', 'err'); return; } FX.csv(v, [{ label: 'PO Number', f: 'DocumentNumber' }, { label: 'Organization', f: 'ToOrganizationCode' }, { label: 'Source Doc Code', f: 'SourceDocumentCode' }, { label: 'Vendor', f: 'VendorName' }, { label: 'Destination Type', f: 'DestinationType' }, { label: 'Ship To Location', f: 'ShipToLocation' }, { label: 'Integration Status', f: 'IntegrationStatus' }, { label: 'ASN Number', f: 'ASNNumbers' }, { label: 'Earliest Due Date', f: 'dueFirst' }, { label: 'Latest Due Date', get: function (r) { return r.dueLast !== r.dueFirst ? r.dueLast : ''; } }, { label: 'Lines Count', f: 'linesCount' }], 'expected-po-receipts'); } }],
        onRow: function (r) { erOpen(r); }
    });
    PUR.bindRemember('gf_er_org', 'org');
    var dm = $('gf_er_dm'), sync = function () { var m = dm.value; $('gf_er_d1').parentNode.hidden = !(m === 'exact' || m === 'range'); $('gf_er_d2').parentNode.hidden = m !== 'range'; };
    dm.addEventListener('change', function () { $('gf_er_d1').value = ''; $('gf_er_d2').value = ''; sync(); }); sync();
    if (p.po) setTimeout(function () { g.search(); }, 0);
}
function erOpen(grp) {
    $('er-list').hidden = true; var el = $('er-det'); el.hidden = false;
    var first = grp.lines[0] || {}, po = grp.DocumentNumber;
    var D = ER.det = { grp: grp, lines: grp.lines.slice(), tab: 'lines', rcv: {}, sel: {}, done: {}, flags: {}, lotPrefix: 'IGRN_' + po, serialStart: 1, ship: '', subs: [] };
    var asn = grp.asn || PUR.distinct(grp.lines, 'ASNNumber').join(', ');
    el.innerHTML = '<div class="card pu-head"><button class="btn icon" id="er-back" title="Back to the results"><i class="fa-solid fa-arrow-left"></i></button><span class="po-no">PO ' + esc(po) + '</span>' + (asn ? '<span class="chip info">ASN ' + esc(asn) + '</span>' : '') + PUR.intChip(grp.IntegrationStatus) +
        '<span class="grow"></span><button class="btn" id="er-refresh"><i class="fa-solid fa-rotate"></i> Refresh lines</button></div>' +
        '<div class="card pad"><div class="facts">' + [['No. of lines', '<b id="er-n">' + grp.lines.length + '</b>'], ['Organization', esc(first.ToOrganizationCode)], ['Vendor', esc(first.VendorName)], ['Vendor site', esc(first.VendorSiteCode)], ['Source doc', esc(first.SourceDocumentCode)], ['Currency', esc(first.CurrencyCode)], ['Destination', esc(first.DestinationType)], ['Ship-to location', esc(first.ShipToLocation)]]
            .filter(function (f) { return f[1]; }).map(function (f) { return '<div><span>' + f[0] + '</span>' + f[1] + '</div>'; }).join('') + '</div></div>' +
        '<div class="card"><div class="pu-tabs" id="er-tabs"><button data-t="lines" class="on">Lines</button><button data-t="rcv">Receiving</button></div><div class="pu-body" id="er-body"></div></div>';
    $('er-back').onclick = function () { el.hidden = true; $('er-list').hidden = false; ER.det = null; };
    $('er-refresh').onclick = function () {
        $('er-body').innerHTML = '<div class="muted">' + PUR.spin + ' Refreshing…</div>';
        FX.restAll('linesToReceive', { q: 'DocumentNumber=' + FX.qv(po) + (grp.asn ? ';ASNNumber=' + FX.qv(grp.asn) : ''), limit: 500, onlyData: false }, 20000).then(function (rows) {
            if (!grp.asn) rows = rows.filter(function (r) { return !String(r.ASNNumber || '').trim(); });
            D.lines = rows; $('er-n').textContent = rows.length; erInit(D, true); erBody();
        }).catch(function (e) { $('er-body').innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
    };
    $('er-tabs').onclick = function (e) { var b = e.target.closest('[data-t]'); if (!b) return; D.tab = b.getAttribute('data-t'); this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); erBody(); };
    erInit(D, false); erBody();
    var org = first.ToOrganizationCode;
    if (org) FX.subinvs(org).then(function (l) { D.subs = l.map(function (x) { return x.v; }); if (D.tab === 'rcv') erBody(); }).catch(function () { });
    var items = PUR.distinct(D.lines, 'ItemNumber');
    PUR.pool(items, 6, function (it) {
        return FX.get('itemsV2', { q: 'OrganizationCode=' + PUR.dq(org) + ';ItemNumber=' + PUR.dq(it), limit: 1 }).then(function (j) {
            var r = (j.items || [])[0], f = { lot: false, serial: false };
            if (r) {
                f.lot = r.LotControlCode != null ? Number(r.LotControlCode) !== 1 : /full lot/i.test(r.LotControlValue || '');
                var sc = PUR.first(r, 'SerialGenerationCode', 'SerialNumberControlCode'), sv = PUR.first(r, 'SerialGenerationValue', 'SerialNumberControlValue', 'SerialGeneration');
                f.serial = sc != null ? Number(sc) !== 1 : !!sv && !/no\s*serial/i.test(sv);
            }
            D.flags[String(it).toUpperCase()] = f;
        }).catch(function () { D.flags[String(it).toUpperCase()] = { lot: false, serial: false }; });
    }).then(function () { if (ER.det === D && D.tab === 'rcv') erBody(); });
}
/** (Re)build receiving data. keep = keep the user's subinventory / locator / qty; lot + serials are regenerated from the current qty. */
function erInit(D, keep) {
    var pad3 = function (n) { return String(Math.ceil(n)).padStart(3, '0'); }, c = +D.serialStart || 1, old = D.rcv;
    D.rcv = {};
    D.lines.forEach(function (l) {
        var k = PUR.lineKey(l), o = keep && old[k];
        var qty = o ? o.qty : Math.ceil(+PUR.first(l, 'AvailableQuantity', 'OrderedQuantity') || 1);
        D.rcv[k] = { qty: qty, lotNumber: D.lotPrefix, locator: o ? o.locator : '', subinventory: o ? o.subinventory : (l.Subinventory || ''), fromSerial: D.lotPrefix + '_' + pad3(c), toSerial: D.lotPrefix + '_' + pad3(c + qty - 1) };
        c += qty;
    });
}
function erBody() {
    var D = ER.det, el = $('er-body'); if (!D || !el) return;
    if (!D.lines.length) { el.innerHTML = '<div class="empty"><i class="fa-solid fa-inbox"></i>No open lines left to receive.</div>'; return; }
    if (D.tab === 'lines') {
        el.innerHTML = '<div class="pu-scroll">' + FX.table(D.lines, [{ label: 'Line / sch', get: PUR.lnSch }, { label: 'Item', f: 'ItemNumber', fmt: 'mono' }, { label: 'Description', f: 'ItemDescription' },
            { label: 'Available', n: 1, html: function (l) { var v = PUR.n(l.AvailableQuantity); return '<b style="color:' + (v > 0 ? 'var(--ok)' : 'inherit') + '">' + FX.fmt.num(v) + '</b>'; } }, { label: 'Ordered', f: 'OrderedQuantity', n: 1, fmt: 'num' },
            { label: 'UOM', f: 'UOMCode' }, { label: 'Due', html: function (l) { return PUR.dueChip(l.DueDate); } }, { label: 'Unit price', f: 'POUnitPrice', n: 1, fmt: 'money' }, { label: 'CCY', f: 'CurrencyCode' },
            { label: 'Status', html: function (l) { return PUR.intChip(l.IntegrationStatus); } }, { label: 'ASN', f: 'ASNNumber' },
            { label: '', html: function (l) { return '<button class="btn sm icon" data-all="' + esc(PUR.lineKey(l)) + '" title="All fields"><i class="fa-solid fa-eye"></i></button>'; } }]) + '</div>';
        el.onclick = function (e) { var b = e.target.closest('[data-all]'); if (b) { var l = D.lines.filter(function (x) { return PUR.lineKey(x) === b.getAttribute('data-all'); })[0]; PUR.allFields('All fields — PO ' + l.DocumentNumber + ' · Line ' + PUR.lnSch(l), l); } };
        el.onchange = null;
        return;
    }
    var subs = PUR.distinct([].concat(D.subs.map(function (s) { return { s: s }; }), D.lines.map(function (l) { return { s: l.Subinventory }; }), Object.keys(D.rcv).map(function (k) { return { s: D.rcv[k].subinventory }; })), 's').sort();
    var nSel = Object.keys(D.sel).filter(function (k) { return D.sel[k]; }).length;
    var opt = function (v) { return '<option value="">—</option>' + subs.map(function (s) { return '<option' + (s === v ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join(''); };
    el.innerHTML = '<div class="pu-inline"><label>Subinventory for all <select id="er-suball">' + opt('') + '</select></label>' +
        '<button class="btn sm" data-er="lot"><i class="fa-solid fa-tag"></i> Lot: ' + esc(D.lotPrefix) + '</button><button class="btn sm" data-er="serial"><i class="fa-solid fa-barcode"></i> Serial start: ' + D.serialStart + '</button>' +
        '<label>Shipment # <input id="er-ship" value="' + esc(D.ship) + '" placeholder="auto-generated" style="width:150px"></label><span class="grow"></span><span class="chip ' + (nSel ? 'info' : '') + '">' + nSel + ' line(s) selected</span>' +
        '<button class="btn sm" data-er="json"' + (nSel ? '' : ' disabled') + '><i class="fa-solid fa-code"></i> View JSON</button><button class="btn primary" data-er="receive"' + (nSel ? '' : ' disabled') + '><i class="fa-solid fa-dolly"></i> Receive</button></div>' +
        '<div class="pu-scroll"><table class="tbl edit"><thead><tr><th><input type="checkbox" id="er-selall"></th><th>Line / sch</th><th>Item</th><th>Description</th><th class="n">Qty</th><th>UOM</th><th>Lot / serial</th><th>Subinventory *</th><th>Lot number</th><th>Locator</th><th>From serial</th><th>To serial</th></tr></thead><tbody>' +
        D.lines.map(function (l) {
            var k = PUR.lineKey(l), r = D.rcv[k], s = !!D.sel[k], dn = D.done[k], f = D.flags[String(l.ItemNumber).toUpperCase()], dis = s && !dn ? '' : ' disabled';
            var fl = f ? '<span class="chip ' + (f.lot ? 'ok' : '') + '">Lot ' + (f.lot ? '✓' : '✗') + '</span> <span class="chip ' + (f.serial ? 'ok' : '') + '">Ser ' + (f.serial ? '✓' : '✗') + '</span>' : PUR.spin;
            return '<tr class="' + (dn ? 'done' : '') + '"><td>' + (dn ? '<i class="fa-solid fa-circle-check" style="color:var(--ok)" title="Received"></i>' : '<input type="checkbox" data-sel="' + esc(k) + '"' + (s ? ' checked' : '') + '>') + '</td><td>' + PUR.lnSch(l) + '</td><td class="mono">' + esc(l.ItemNumber) + '</td><td>' + esc(l.ItemDescription) + '</td>' +
                '<td><input type="number" min="0" step="0.0001" data-f="qty" data-k="' + esc(k) + '" value="' + esc(r.qty) + '"' + dis + '></td><td>' + esc(PUR.uom(l)) + '</td><td style="white-space:nowrap">' + fl + '</td>' +
                '<td style="white-space:nowrap"><select data-f="subinventory" data-k="' + esc(k) + '" class="' + (s && !r.subinventory ? 'bad' : '') + '" style="min-width:110px;width:auto"' + dis + '>' + opt(r.subinventory) + '</select> <button class="btn sm icon" data-copy="' + esc(k) + '" title="Copy to all lines"' + dis + '><i class="fa-solid fa-clone"></i></button></td>' +
                ['lotNumber', 'locator', 'fromSerial', 'toSerial'].map(function (x) { return '<td><input data-f="' + x + '" data-k="' + esc(k) + '" value="' + esc(r[x]) + '"' + dis + '></td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div><div class="muted" style="font-size:.72rem">Lot / serial blocks are sent only for lot-controlled items (serials only when the item is lot- and serial-controlled). Lot and serial numbers regenerate when you change the lot prefix or the serial start — subinventory, locator and quantity are kept.</div>';
    el.onclick = function (e) {
        var b = e.target.closest('[data-er]'), c = e.target.closest('[data-copy]');
        if (c) { var v = D.rcv[c.getAttribute('data-copy')].subinventory; if (!v) { FX.toast('Pick a subinventory on that line first.', 'err'); return; } Object.keys(D.rcv).forEach(function (k) { D.rcv[k].subinventory = v; }); erBody(); FX.toast('Subinventory ' + v + ' applied to all lines.'); return; }
        if (!b || b.disabled) return;
        var a = b.getAttribute('data-er');
        if (a === 'lot') FX.modal({ title: 'Change lot', body: '<div class="form"><label>Lot prefix<input id="er-lotv" value="' + esc(D.lotPrefix) + '"></label></div><div class="muted">Empty = IGRN_' + esc(D.grp.DocumentNumber) + '. Lots and serials are regenerated.</div>', buttons: [{ label: 'Cancel', act: 'close' }, { label: 'OK', cls: 'primary', act: 'ok' }], onAction: function (x) { if (x === 'ok') { D.lotPrefix = $('er-lotv').value.trim() || 'IGRN_' + D.grp.DocumentNumber; erInit(D, true); setTimeout(erBody, 0); } } });
        if (a === 'serial') FX.modal({ title: 'Serial start', body: '<div class="form"><label>First serial number<input id="er-serv" type="number" min="1" step="1" value="' + D.serialStart + '"></label></div><div class="muted">Example: line 1 (qty 10) → ' + esc(D.lotPrefix) + '_' + String(D.serialStart).padStart(3, '0') + ' to ' + esc(D.lotPrefix) + '_' + String(D.serialStart + 9).padStart(3, '0') + '. Serials run on across all lines.</div>', buttons: [{ label: 'Cancel', act: 'close' }, { label: 'OK', cls: 'primary', act: 'ok' }], onAction: function (x) { if (x === 'ok') { var n = Math.floor(+$('er-serv').value); D.serialStart = n > 0 ? n : 1; erInit(D, true); setTimeout(erBody, 0); } } });
        if (a === 'json') { var rows = erRows(D); FX.json('receivingReceiptRequests — ' + rows.length + ' request(s), one per line', rows.map(function (r) { return r.body; })); }
        if (a === 'receive') erReceive(D);
    };
    el.onchange = function (e) {
        var t = e.target;
        if (t.id === 'er-suball') { if (t.value) { Object.keys(D.rcv).forEach(function (k) { D.rcv[k].subinventory = t.value; }); erBody(); FX.toast('Subinventory ' + t.value + ' applied to all lines.'); } return; }
        if (t.id === 'er-ship') { D.ship = t.value.trim(); return; }
        if (t.id === 'er-selall') { D.lines.forEach(function (l) { var k = PUR.lineKey(l); if (!D.done[k]) D.sel[k] = t.checked; }); erBody(); return; }
        if (t.matches('[data-sel]')) { D.sel[t.getAttribute('data-sel')] = t.checked; erBody(); return; }
        if (t.matches('[data-f]')) { var r = D.rcv[t.getAttribute('data-k')], f = t.getAttribute('data-f'); r[f] = f === 'qty' ? Math.max(0, PUR.n(t.value)) : t.value.trim(); if (f === 'subinventory') t.classList.toggle('bad', !t.value); }
    };
}
function erBodyFor(D, l, shipBase) {
    var k = PUR.lineKey(l), r = D.rcv[k], f = D.flags[String(l.ItemNumber).toUpperCase()] || {};
    var line = {
        POHeaderId: String(l.POHeaderId), POLineLocationId: String(l.POLineLocationId), SourceDocumentCode: l.SourceDocumentCode || 'PO', ReceiptSourceCode: l.ReceiptSourceCode || 'VENDOR',
        TransactionType: 'RECEIVE', AutoTransactCode: 'DELIVER', DocumentNumber: l.DocumentNumber || D.grp.DocumentNumber, DocumentLineNumber: String(l.DocumentLineNumber),
        ItemNumber: l.ItemNumber, OrganizationCode: l.ToOrganizationCode, Subinventory: r.subinventory, Quantity: PUR.n(r.qty), FromOrganizationCode: null, UnitOfMeasure: PUR.uom(l)
    };
    if (r.locator) line.Locator = r.locator;
    if (f.lot && r.lotNumber) {
        var lot = { LotNumber: r.lotNumber, TransactionQuantity: PUR.n(r.qty) };
        if (f.serial && r.fromSerial) lot.lotSerialItemSerials = [{ FromSerialNumber: r.fromSerial, ToSerialNumber: r.toSerial }];
        line.lotSerialItemLots = [lot];
    }
    return { FromOrganizationCode: null, OrganizationCode: l.ToOrganizationCode, ReceiptSourceCode: 'VENDOR', EmployeeId: '', VendorName: l.VendorName, ShipmentNumber: shipBase + l.DocumentLineNumber, lines: [line] };
}
function erRows(D) {
    var base = D.ship || String(Date.now()).slice(-6);
    return D.lines.filter(function (l) { var k = PUR.lineKey(l); return D.sel[k] && !D.done[k]; }).map(function (l) { var k = PUR.lineKey(l); return { key: k, l: l, item: l.ItemNumber, qty: D.rcv[k].qty, subinv: D.rcv[k].subinventory, body: erBodyFor(D, l, base), status: 'pending', msg: '' }; });
}
function erReceive(D) {
    var rows = erRows(D);
    var miss = rows.filter(function (r) { return !r.subinv; }).length;
    if (miss) { FX.toast('Select a Subinventory on ' + miss + ' selected line(s) before receiving.', 'err'); return; }
    var zero = rows.filter(function (r) { return !(r.qty > 0); }).length;
    if (zero) { FX.toast('Enter a quantity greater than 0 on ' + zero + ' selected line(s).', 'err'); return; }
    var open = {}, running = false;
    var draw = function () {
        var left = rows.filter(function (r) { return r.status !== 'ok'; }).length;
        $('rc-t').innerHTML = '<table class="tbl"><thead><tr><th></th><th>Item</th><th class="n">Qty</th><th>Subinventory</th><th>Status</th><th>Message</th></tr></thead><tbody>' + rows.map(function (r, i) {
            return '<tr class="click ' + (r.status === 'ok' ? 'done' : r.status === 'err' ? 'err' : '') + '" data-x="' + i + '"><td><i class="fa-solid fa-chevron-' + (open[i] ? 'down' : 'right') + ' muted"></i></td><td class="mono">' + esc(r.item) + '</td><td class="n">' + FX.fmt.num(r.qty) + '</td><td>' + esc(r.subinv) + '</td><td>' +
                (r.status === 'busy' ? PUR.spin + ' Processing…' : r.status === 'ok' ? '<span class="chip ok">Success</span>' : r.status === 'err' ? '<span class="chip err">Error</span>' : '<span class="chip">Pending</span>') + '</td><td style="max-width:380px;white-space:pre-wrap">' + esc(r.msg) + '</td></tr>' +
                (open[i] ? '<tr><td></td><td colspan="5"><div class="mono muted">POST ' + esc(FX.url('receivingReceiptRequests', { onlyData: false })) + '</div><pre class="json">' + esc(JSON.stringify(r.body, null, 2)) + '</pre>' + (r.resp ? '<pre class="json">' + esc(r.resp.slice(0, 6000)) + '</pre>' : '') + '</td></tr>' : '');
        }).join('') + '</tbody></table>';
        var btn = document.querySelector('[data-mact="go"]'); if (btn) { btn.innerHTML = '<i class="fa-solid fa-dolly"></i> Confirm & receive (' + left + ')'; btn.disabled = !left || running; }
    };
    FX.modal({
        title: '<i class="fa-solid fa-dolly" style="color:var(--accent)"></i> Receive PO ' + esc(D.grp.DocumentNumber) + ' — ' + rows.length + ' line(s)', wide: true,
        body: '<div class="note">One receivingReceiptRequests POST per line: RECEIVE + DELIVER into the subinventory. Click a row to see the request and the reply.</div><div id="rc-t"></div>',
        buttons: [{ label: 'Close', act: 'close' }, { label: 'Confirm & receive', cls: 'primary', act: 'go' }],
        onOpen: function () { draw(); $('rc-t').onclick = function (e) { var tr = e.target.closest('[data-x]'); if (tr) { var i = +tr.getAttribute('data-x'); open[i] = !open[i]; draw(); } }; },
        onClose: function () { if (ER.det === D) erBody(); },
        onAction: function (a) {
            if (a !== 'go' || running) return false;
            running = true; var i = 0, okN = 0;
            (function next() {
                while (i < rows.length && rows[i].status === 'ok') i++;
                if (i >= rows.length) { running = false; draw(); if (okN) FX.toast(okN + ' line(s) received.', 'ok'); return; }
                var r = rows[i++]; r.status = 'busy'; draw();
                PUR.receive(r.body).then(function (res) {
                    r.status = res.ok ? 'ok' : 'err'; r.msg = res.msg; r.resp = res.text;
                    if (res.ok) { okN++; D.done[r.key] = true; D.sel[r.key] = false; }
                    next();
                });
            })();
            return false;
        }
    });
}

// ── View: Create ASN ───────────────────────────────────────────
var AS = null;
function purCreateASN(el) {
    var p = PUR.take('asn');
    AS = { lines: [], qty: {}, sel: {}, result: null, form: null, searched: false };
    el.innerHTML = '<div id="as-steps"></div><div class="card"><div class="filters"><label>Purchase order #<input id="as-po" type="search" placeholder="e.g. 2026020095" value="' + esc(p.po || '') + '"></label>' +
        '<label>Receiving org (optional)<select id="as-org"></select></label><div class="go"><button class="btn" id="as-clear"><i class="fa-solid fa-eraser"></i> Clear</button><button class="btn primary" id="as-go"><i class="fa-solid fa-magnifying-glass"></i> Search</button></div></div></div>' +
        '<div class="card" style="display:flex;flex-direction:column;min-height:0"><div class="filters" style="border-bottom:1px solid var(--line)"><b><i class="fa-solid fa-boxes-packing" style="color:var(--accent)"></i> PO lines available to ship</b><span class="muted" id="as-n"></span><span class="grow"></span><span id="as-res"></span>' +
        '<button class="btn primary" id="as-create" disabled><i class="fa-solid fa-truck-fast"></i> Create ASN</button></div><div id="as-body" class="pu-scroll"></div></div>';
    FX.fillSelect('as-org', FX.lov('orgs'), '', 'Any');
    $('as-go').onclick = asSearch; $('as-po').onkeydown = function (e) { if (e.key === 'Enter') asSearch(); };
    $('as-clear').onclick = function () { $('as-po').value = ''; $('as-org').value = ''; AS = { lines: [], qty: {}, sel: {}, result: null, form: null, searched: false }; asDraw(); };
    $('as-create').onclick = function () { AS.result = null; asDialog(); };
    asDraw();
    if (p.po) asSearch();
}
function asStep() {
    var nSel = Object.keys(AS.sel).filter(function (k) { return AS.sel[k]; }).length, r = AS.result;
    var st = [['Find PO lines', AS.lines.length > 0, AS.lines.length + ' open line(s)'], ['Select & quantities', nSel > 0, nSel + ' selected'], ['Shipment details', !!AS.form, AS.form ? esc(AS.form.ShipmentNumber) : 'ASN number, dates'], ['Fusion validation', r && r.ok && r.pStatus === 'SUCCESS', r ? esc(r.pStatus || (r.ok ? 'sent' : 'ERROR')) : 'receivingReceiptRequests']];
    var cur = st.findIndex(function (s) { return !s[1]; });
    $('as-steps').innerHTML = '<div class="pu-steps">' + st.map(function (s, i) { var bad = i === 3 && r && !r.ok; return '<div class="s ' + (bad ? 'bad' : s[1] ? 'done' : i === cur ? 'cur' : '') + '"><span class="n">' + (bad ? '!' : s[1] ? '<i class="fa-solid fa-check"></i>' : i + 1) + '</span><span><b>' + s[0] + '</b>' + s[2] + '</span></div>'; }).join('') + '</div>';
}
function asSearch() {
    var po = $('as-po').value.trim(), org = $('as-org').value;
    if (!po && !org) { FX.toast('Enter a PO number (or organization) to search', 'err'); return; }
    var q = []; if (po) q.push('DocumentNumber=' + FX.qv(po)); if (org) q.push('ToOrganizationCode=' + FX.qv(org));
    $('as-body').innerHTML = '<div class="empty">' + PUR.spin + ' Reading Fusion…</div>';
    FX.restAll('linesToReceive', { q: q.join(';'), limit: 500, onlyData: false }, 20000).then(function (rows) {
        AS.lines = rows.filter(function (l) { return !String(l.ASNNumber || '').trim(); }); AS.qty = {}; AS.sel = {}; AS.searched = true;
        AS.lines.forEach(function (l) { AS.qty[PUR.lineKey(l)] = Number(PUR.first(l, 'AvailableQuantity', 'OrderedQuantity') || 0) || 0; });
        if (!AS.lines.length) FX.toast('No PO lines available to ship for these criteria');
        asDraw();
    }).catch(function (e) { $('as-body').innerHTML = '<div class="note err" style="margin:12px">' + esc(e) + '</div>'; });
}
function asDraw() {
    asStep();
    var nSel = Object.keys(AS.sel).filter(function (k) { return AS.sel[k]; }).length, r = AS.result;
    $('as-n').textContent = AS.lines.length ? AS.lines.length + ' line(s)' : '';
    $('as-create').disabled = !nSel; $('as-create').innerHTML = '<i class="fa-solid fa-truck-fast"></i> Create ASN' + (nSel ? ' (' + nSel + ')' : '');
    $('as-res').innerHTML = r ? '<span class="chip ' + (r.ok ? 'ok' : 'err') + '" title="' + esc(r.msg || '') + '">' + esc(r.pStatus || (r.ok ? 'sent' : 'ERROR')) + (r.headerId ? ' · Hdr ' + esc(r.headerId) : '') + '</span>' : '';
    if (!AS.lines.length) { $('as-body').innerHTML = '<div class="empty"><i class="fa-solid fa-truck-fast"></i>' + (AS.searched ? 'No PO lines available to ship for these criteria.' : 'Find the PO lines that are not on an ASN yet, choose quantities and create the Advance Shipment Notice.') + '</div>'; return; }
    $('as-body').innerHTML = '<table class="tbl edit"><thead><tr><th><input type="checkbox" id="as-all"></th><th>PO</th><th>Line</th><th>Sched</th><th>Item</th><th>Description</th><th>Org</th><th>Supplier</th><th class="n">Ordered</th><th class="n">Available</th><th>UOM</th><th class="n">Ship qty</th></tr></thead><tbody>' +
        AS.lines.map(function (l) {
            var k = PUR.lineKey(l), avail = +PUR.first(l, 'AvailableQuantity', 'OrderedQuantity') || 0, can = avail > 0, s = !!AS.sel[k];
            return '<tr class="' + (can ? '' : 'dis') + '"><td><input type="checkbox" data-s="' + esc(k) + '"' + (can ? '' : ' disabled title="Nothing available to ship"') + (s ? ' checked' : '') + '></td><td class="mono">' + esc(l.DocumentNumber) + '</td><td>' + esc(l.DocumentLineNumber) + '</td><td>' + esc(l.DocumentScheduleNumber) + '</td><td class="mono">' + esc(l.ItemNumber) + '</td><td>' + esc(l.ItemDescription) + '</td><td>' + esc(l.ToOrganizationCode) + '</td><td>' + esc(l.VendorName) + '</td>' +
                '<td class="n">' + FX.fmt.num(l.OrderedQuantity, 4) + '</td><td class="n" style="color:' + (avail > 0 ? 'var(--ok)' : 'inherit') + ';font-weight:600">' + FX.fmt.num(l.AvailableQuantity, 4) + '</td><td>' + esc(PUR.uom(l)) + '</td>' +
                '<td><input type="number" min="0" max="' + avail + '" step="any" data-q="' + esc(k) + '" value="' + esc(AS.qty[k]) + '"' + (can ? '' : ' disabled') + ' class="' + (s && !(AS.qty[k] > 0) ? 'bad' : '') + '" style="max-width:110px"></td></tr>';
        }).join('') + '</tbody></table>';
    var b = $('as-body');
    b.onchange = function (e) {
        var t = e.target;
        if (t.id === 'as-all') { AS.lines.forEach(function (l) { if ((+PUR.first(l, 'AvailableQuantity', 'OrderedQuantity') || 0) > 0) AS.sel[PUR.lineKey(l)] = t.checked; }); asDraw(); return; }
        if (t.matches('[data-s]')) { AS.sel[t.getAttribute('data-s')] = t.checked; asDraw(); return; }
        if (t.matches('[data-q]')) { var mx = +t.max, v = Math.max(0, PUR.n(t.value)); if (mx && v > mx) { v = mx; FX.toast('Ship quantity cannot exceed the available ' + mx + '.'); } t.value = v; AS.qty[t.getAttribute('data-q')] = v; t.classList.toggle('bad', !(v > 0)); }
    };
}
function asSelected() { return AS.lines.filter(function (l) { return AS.sel[PUR.lineKey(l)]; }); }
function asDefaults() {
    var d = new Date(), p = function (n) { return ('0' + n).slice(-2); };
    var y = new Date(); y.setDate(y.getDate() - 1); var e = new Date(); e.setDate(e.getDate() + 3);
    return { ShipmentNumber: 'ASN' + String(d.getFullYear()).slice(-2) + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()), ShippedDate: FX.today(y), ExpectedReceiptDate: FX.today(e), FreightCarrierName: '', BillOfLading: '', PackingSlip: '', NumberOfContainers: '', Comments: '' };
}
function asReadForm() { var f = {}; ['ShipmentNumber', 'ShippedDate', 'ExpectedReceiptDate', 'FreightCarrierName', 'BillOfLading', 'PackingSlip', 'NumberOfContainers', 'Comments'].forEach(function (k) { var e = $('asf-' + k); f[k] = e ? e.value.trim() : ''; }); return f; }
function asValidate(f) {
    var sel = asSelected();
    if (!sel.length) return 'Select at least one line.';
    if (!f.ShipmentNumber) return 'Enter the shipment (ASN) number.';
    if (!f.ShippedDate) return 'Enter the shipment date.';
    if (!(f.ShippedDate < FX.today())) return 'The shipment date must be before today.';
    for (var i = 0; i < sel.length; i++) if (!(AS.qty[PUR.lineKey(sel[i])] > 0)) return 'Enter a ship quantity greater than 0 for item ' + sel[i].ItemNumber + '.';
    if (PUR.distinct(sel, 'ToOrganizationCode').length > 1) return 'All lines on one ASN must share the same receiving organization — create one ASN per organization.';
    if (f.NumberOfContainers !== '' && !(Number(f.NumberOfContainers) >= 0 && Number(f.NumberOfContainers) % 1 === 0)) return '# Containers must be a whole number ≥ 0.';
    return null;
}
function asBody(f) {
    var sel = asSelected(), first = sel[0];
    var b = { ReceiptSourceCode: 'VENDOR', OrganizationCode: first.ToOrganizationCode, ASNType: 'ASN', ShipmentNumber: f.ShipmentNumber, VendorName: first.VendorName };
    if (first.VendorSiteCode) b.VendorSiteCode = first.VendorSiteCode;
    b.ShippedDate = f.ShippedDate; if (f.ExpectedReceiptDate) b.ExpectedReceiptDate = f.ExpectedReceiptDate;
    ['BillOfLading', 'PackingSlip', 'FreightCarrierName', 'Comments'].forEach(function (k) { if (f[k]) b[k] = f[k]; });
    if (f.NumberOfContainers !== '') b.NumberOfContainers = Number(f.NumberOfContainers);
    b.lines = sel.map(function (l) { return { ReceiptSourceCode: 'VENDOR', SourceDocumentCode: 'PO', TransactionType: 'SHIP', AutoTransactCode: 'SHIP', OrganizationCode: l.ToOrganizationCode, DocumentNumber: l.DocumentNumber, DocumentLineNumber: String(l.DocumentLineNumber), ItemNumber: l.ItemNumber, Quantity: AS.qty[PUR.lineKey(l)], UnitOfMeasure: PUR.uom(l), ShipmentNumber: f.ShipmentNumber }; });
    return b;
}
function asDialog(errHtml) {
    var f = AS.form || asDefaults(), sel = asSelected(), first = sel[0] || {};
    FX.modal({
        title: '<i class="fa-solid fa-truck-fast" style="color:var(--accent)"></i> Advance Shipment Notice — ' + sel.length + ' line(s)', wide: true,
        body: '<div class="row-btns"><span class="chip info">' + esc(first.ToOrganizationCode || '') + '</span><span>' + esc(first.VendorName || '') + '</span>' + (first.VendorSiteCode ? '<span class="muted">' + esc(first.VendorSiteCode) + '</span>' : '') + '<span class="muted">· ' + PUR.distinct(sel, 'DocumentNumber').map(esc).join(', ') + '</span></div>' +
            (errHtml || '') +
            '<div class="form"><label><span>Shipment (ASN) number <b class="r">*</b></span><input id="asf-ShipmentNumber" value="' + esc(f.ShipmentNumber) + '"></label><label><span>Shipment date (before today) <b class="r">*</b></span><input id="asf-ShippedDate" type="date" max="' + FX.daysAgo(1) + '" value="' + esc(f.ShippedDate) + '"></label>' +
            '<label>Expected receipt date<input id="asf-ExpectedReceiptDate" type="date" value="' + esc(f.ExpectedReceiptDate) + '"></label><label>Freight carrier<input id="asf-FreightCarrierName" value="' + esc(f.FreightCarrierName) + '"></label>' +
            '<label>Bill of lading<input id="asf-BillOfLading" value="' + esc(f.BillOfLading) + '"></label><label>Packing slip<input id="asf-PackingSlip" value="' + esc(f.PackingSlip) + '"></label><label># Containers<input id="asf-NumberOfContainers" type="number" min="0" step="1" value="' + esc(f.NumberOfContainers) + '"></label>' +
            '<label class="wide">Comments<textarea id="asf-Comments" rows="2">' + esc(f.Comments) + '</textarea></label></div>' +
            FX.table(sel, [{ label: 'PO', f: 'DocumentNumber', fmt: 'mono' }, { label: 'Line', get: PUR.lnSch }, { label: 'Item', f: 'ItemNumber', fmt: 'mono' }, { label: 'Description', f: 'ItemDescription' }, { label: 'Ship qty', n: 1, get: function (l) { return AS.qty[PUR.lineKey(l)]; }, fmt: 'num' }, { label: 'UOM', get: PUR.uom }]),
        buttons: [{ label: 'Cancel', act: 'close' }, { label: '<i class="fa-solid fa-code"></i> Inspect', act: 'inspect' }, { label: '<i class="fa-solid fa-paper-plane"></i> Create ASN', cls: 'primary', act: 'create' }],
        onAction: function (a) {
            var form = asReadForm(), m = asValidate(form);
            if (m) { FX.toast(m, 'err'); return false; }
            AS.form = form;
            if (a === 'inspect') { FX.modal({ title: 'Create ASN — request preview', wide: true, body: '<div class="mono muted">POST ' + esc(FX.url('receivingReceiptRequests', { onlyData: false })) + '</div><pre class="json">' + esc(JSON.stringify(asBody(form), null, 2)) + '</pre>' + (AS.lastText ? '<h4>Last response</h4><pre class="json">' + esc(AS.lastText.slice(0, 6000)) + '</pre>' : ''), buttons: [{ label: 'Back', act: 'back' }, { label: 'Submit', cls: 'primary', act: 'create' }], onAction: function (b) { if (b === 'back') setTimeout(function () { asDialog(); }, 0); if (b === 'create') setTimeout(asSubmit, 0); } }); return false; }
            if (a === 'create') { setTimeout(asSubmit, 0); }
        }
    });
}
function asSubmit() {
    var body = asBody(AS.form);
    FX.busy('Creating ASN ' + AS.form.ShipmentNumber + '…');
    PUR.receive(body).then(function (r) {
        AS.lastText = r.text;
        if (!r.http || r.http < 200 || r.http >= 300) { FX.busy(false); AS.result = { ok: false, pStatus: 'ERROR', msg: r.msg }; asDraw(); asDialog('<div class="note err">' + esc(r.msg) + '</div>'); return; }
        var ps = String(r.pStatus || 'PENDING').toUpperCase(), hdr = r.headerId;
        var wait = hdr && ps === 'PENDING' ? PUR.pollReceipt(hdr, 8, 2000, function (n, s) { FX.busy('Fusion is validating the ASN… ' + s + ' (' + n + '/8)'); }) : Promise.resolve({ pStatus: ps, retMsg: r.retMsg });
        return wait.then(function (w) {
            ps = w.pStatus; var msg = w.retMsg || r.retMsg;
            if (ps === 'SUCCESS') {
                FX.busy(false); AS.result = { ok: true, pStatus: ps, headerId: hdr, msg: 'ASN created successfully.' }; AS.form = null; FX.closeModal();
                FX.toast('ASN ' + body.ShipmentNumber + ' created successfully.', 'ok'); asSearch(); asStep();
            } else if (ps === 'ERROR') {
                FX.busy('Reading the processing errors…');
                PUR.receiptErrors(hdr).then(function (errs) {
                    FX.busy(false); AS.result = { ok: false, pStatus: 'ERROR', headerId: hdr, msg: msg || "The receiving transactions couldn't be processed." }; asDraw();
                    asDialog('<div class="note err"><b>' + esc(AS.result.msg) + '</b>' + (errs.length ? '<ul style="margin:6px 0 0 18px">' + errs.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + '<div class="muted" style="margin-top:4px">Header interface id ' + esc(hdr) + '</div></div>');
                });
            } else {
                FX.busy(false); AS.result = { ok: true, pStatus: ps, headerId: hdr, msg: 'still processing' }; AS.form = null; FX.closeModal(); asDraw();
                FX.modal({ title: 'ASN submitted', body: '<div class="note warn">ASN ' + esc(body.ShipmentNumber) + ' submitted — still processing in Fusion (' + esc(ps) + '). Check Manage Inbound Shipments shortly.' + (hdr ? '<br>Header interface id ' + esc(hdr) : '') + '</div>' });
            }
        });
    }).catch(function (e) { FX.busy(false); FX.toast(String(e), 'err'); });
}

// ── View: Supplier Returns ─────────────────────────────────────
var SR = null;
function purReturns(el) {
    var p = PUR.take('returns');
    SR = { lines: [], po: null, subs: {} };
    el.innerHTML = '<div class="card"><div class="filters"><label>Organization<select id="sr-org"></select></label><label>Purchase order *<input id="sr-po" type="search" placeholder="e.g. 2026020095" value="' + esc(p.po || '') + '"></label>' +
        '<div class="go"><button class="btn primary" id="sr-go"><i class="fa-solid fa-magnifying-glass"></i> Search received</button></div></div></div><div id="sr-head"></div>' +
        '<div class="card" style="display:flex;flex-direction:column"><div class="filters" style="border-bottom:1px solid var(--line)" id="sr-tb" hidden><b><i class="fa-solid fa-rotate-left" style="color:var(--accent)"></i> Received schedules</b><span class="grow"></span>' +
        '<button class="btn sm" id="sr-json"><i class="fa-solid fa-code"></i> View JSON</button><button class="btn sm" id="sr-ref"><i class="fa-solid fa-rotate"></i> Refresh</button><button class="btn danger" id="sr-ret"><i class="fa-solid fa-truck-arrow-right"></i> Return to supplier</button></div><div id="sr-body" class="pu-scroll"><div class="empty"><i class="fa-solid fa-rotate-left"></i>Enter a purchase order to list what was received and can go back to the supplier.</div></div></div>';
    FX.fillSelect('sr-org', FX.lov('orgs'), PUR.recall('ret_org', ''), 'Any / from PO');
    PUR.bindRemember('sr-org', 'ret_org');
    $('sr-go').onclick = srSearch; $('sr-ref').onclick = srSearch; $('sr-po').onkeydown = function (e) { if (e.key === 'Enter') srSearch(); };
    $('sr-json').onclick = function () { FX.json('receivingReceiptRequests — one request per line', srTargets(true).map(srBody)); };
    $('sr-ret').onclick = srReturn;
    if (p.po) srSearch();
}
function srSearch() {
    var po = $('sr-po').value.trim(); if (!po) { FX.toast('Enter a PO number', 'err'); return; }
    $('sr-body').innerHTML = '<div class="empty">' + PUR.spin + ' Reading PO ' + esc(po) + '…</div>'; $('sr-head').innerHTML = ''; $('sr-tb').hidden = true;
    FX.get('purchaseOrders', { q: 'OrderNumber=' + PUR.dq(po), limit: 5, expand: 'lines.schedules' }).then(function (j) {
        var P = (j.items || [])[0];
        if (!P) { $('sr-body').innerHTML = '<div class="empty"><i class="fa-solid fa-circle-question"></i>PO not found</div>'; return; }
        var vendor = P.Supplier || P.SupplierName, selOrg = $('sr-org').value, out = [];
        ((P.lines && (P.lines.items || P.lines)) || []).forEach(function (l) {
            ((l.schedules && (l.schedules.items || l.schedules)) || []).forEach(function (s) {
                var rec = +PUR.first(s, 'QuantityReceived', 'ReceivedQuantity') || 0; if (rec <= 0) return;
                out.push({ key: (l.LineNumber != null ? l.LineNumber : l.POLineId) + '-' + (s.ScheduleNumber != null ? s.ScheduleNumber : s.LineLocationId), po: P.OrderNumber, vendor: vendor,
                    item: PUR.first(l, 'Item', 'ItemNumber'), desc: PUR.first(l, 'Description', 'ItemDescription'), uom: PUR.first(l, 'UOM', 'UOMCode', 'UnitOfMeasure'), lineNum: l.LineNumber,
                    schedNum: s.ScheduleNumber, org: PUR.first(s, 'DestinationOrganizationCode', 'ShipToOrganizationCode', 'ReceivingOrganizationCode') || selOrg, ordered: PUR.first(s, 'Quantity', 'OrderedQuantity'),
                    received: rec, returnQty: rec, subinventory: '', receiptNumber: '', reason: '', status: null, msg: '' });
            });
        });
        SR.po = P; SR.lines = out;
        $('sr-head').innerHTML = '<div class="card pu-head"><span class="po-no">' + esc(P.OrderNumber) + '</span>' + FX.chip(P.StatusCode) + '<span>' + esc(vendor || '') + '</span><span class="muted">' + esc(P.ProcurementBU || '') + '</span><div class="tot"><div><span>Received schedules</span><b>' + out.length + '</b></div><div><span>Received qty</span><b>' + FX.fmt.num(PUR.sum(out, 'received')) + '</b></div></div></div>';
        if (!out.length) { $('sr-body').innerHTML = '<div class="empty"><i class="fa-solid fa-inbox"></i>No received quantities found on this PO — nothing to return.</div>'; return; }
        if (!selOrg && out[0].org) { $('sr-org').value = out[0].org; }
        PUR.distinct(out, 'org').forEach(function (o) { FX.subinvs(o).then(function (l) { SR.subs[o] = l.map(function (x) { return x.v; }); srDraw(); }).catch(function () { }); });
        $('sr-tb').hidden = false; srDraw();
    }).catch(function (e) { $('sr-body').innerHTML = '<div class="note err" style="margin:12px">' + esc(e) + '</div>'; });
}
function srTargets(all) { return SR.lines.filter(function (l) { return l.returnQty > 0 && (all || l.status !== 'ok'); }); }
function srBody(l) {
    var line = { TransactionType: 'RETURN TO VENDOR', SourceDocumentCode: 'PO', DocumentNumber: l.po };
    if (l.lineNum != null) line.DocumentLineNumber = String(l.lineNum);
    line.ItemNumber = l.item; line.OrganizationCode = l.org; line.Quantity = l.returnQty;
    if (l.uom) line.UnitOfMeasure = l.uom;
    if (l.subinventory) line.Subinventory = l.subinventory;
    if (l.receiptNumber.trim()) line.ReceiptNumber = l.receiptNumber.trim();
    if (l.reason.trim()) line.ReasonName = l.reason.trim();
    var b = { ReceiptSourceCode: 'VENDOR', OrganizationCode: l.org }; if (l.vendor) b.VendorName = l.vendor; b.lines = [line];
    return b;
}
function srDraw() {
    var n = srTargets().length;
    $('sr-ret').innerHTML = '<i class="fa-solid fa-truck-arrow-right"></i> Return to supplier (' + n + ')'; $('sr-ret').disabled = !n;
    $('sr-body').innerHTML = '<table class="tbl edit"><thead><tr><th>Line / sch</th><th>Item</th><th>Description</th><th>Org</th><th class="n">Received</th><th>UOM</th><th class="n">Return qty</th><th>Subinventory</th><th>Receipt #</th><th>Reason</th><th>Status</th></tr></thead><tbody>' +
        SR.lines.map(function (l, i) {
            var subs = SR.subs[l.org] || [], dis = l.status === 'ok' ? ' disabled' : '';
            return '<tr class="' + (l.status === 'ok' ? 'done' : l.status === 'err' ? 'err' : '') + '"><td>' + esc(l.lineNum) + '.' + esc(l.schedNum) + '</td><td class="mono">' + esc(l.item) + '</td><td>' + esc(l.desc) + '</td><td>' + esc(l.org) + '</td><td class="n" style="color:var(--ok);font-weight:600">' + FX.fmt.num(l.received) + '</td><td>' + esc(l.uom) + '</td>' +
                '<td><input type="number" min="0" max="' + l.received + '" step="any" data-r="returnQty" data-i="' + i + '" value="' + esc(l.returnQty) + '" style="max-width:100px"' + dis + '></td>' +
                '<td><select data-r="subinventory" data-i="' + i + '"' + dis + '><option value="">From…</option>' + subs.concat(l.subinventory && subs.indexOf(l.subinventory) < 0 ? [l.subinventory] : []).map(function (s) { return '<option' + (s === l.subinventory ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></td>' +
                '<td><input data-r="receiptNumber" data-i="' + i + '" value="' + esc(l.receiptNumber) + '" placeholder="(if required)"' + dis + '></td><td><input data-r="reason" data-i="' + i + '" value="' + esc(l.reason) + '" placeholder="optional"' + dis + '></td>' +
                '<td>' + (l.status === 'busy' ? PUR.spin : l.status === 'ok' ? '<span class="chip ok" title="' + esc(l.msg) + '">Returned</span>' : l.status === 'err' ? '<span class="chip err" title="' + esc(l.msg) + '">Error</span> <span class="muted" style="font-size:.72rem">' + esc(String(l.msg).slice(0, 120)) + '</span>' : '<span class="muted">—</span>') + '</td></tr>';
        }).join('') + '</tbody></table>';
    $('sr-body').onchange = function (e) {
        var t = e.target.closest('[data-r]'); if (!t) return; var l = SR.lines[+t.getAttribute('data-i')], f = t.getAttribute('data-r');
        if (f === 'returnQty') { var v = Math.max(0, PUR.n(t.value)); if (v > l.received) { v = l.received; FX.toast('You can return at most the received ' + l.received + '.'); } l.returnQty = v; t.value = v; if (l.status === 'err') l.status = null; srDraw(); }
        else l[f] = t.value;
    };
}
function srReturn() {
    var T = srTargets();
    if (!T.length) { FX.toast('Set a return quantity on at least one line', 'err'); return; }
    FX.confirm('Return to supplier', 'Return <b>' + T.length + '</b> line(s) of PO <b>' + esc(SR.po.OrderNumber) + '</b> to ' + esc(T[0].vendor || 'the supplier') + '?<div class="muted" style="margin-top:6px">One receivingReceiptRequests POST per line (RETURN TO VENDOR). Lines that failed before are retried.</div>', 'Return', 'danger').then(function (ok) {
        if (!ok) return;
        var i = 0;
        (function next() {
            if (i >= T.length) { srDraw(); FX.toast('Done — see the status per line.', T.every(function (l) { return l.status === 'ok'; }) ? 'ok' : 'err'); return; }
            var l = T[i++]; l.status = 'busy'; srDraw();
            PUR.receive(srBody(l)).then(function (r) { l.status = r.ok ? 'ok' : 'err'; l.msg = r.ok ? 'Return #' + (r.headerId || (r.json && r.json.ReceiptNumber) || '') + (r.pStatus ? ' · ' + r.pStatus : '') : r.msg; next(); });
        })();
    });
}
