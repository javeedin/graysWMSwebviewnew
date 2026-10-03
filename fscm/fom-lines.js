/* Fusion Order Management — editor lines (spec §3.3.17, §3.3.23, §3.3.12, §3.3.26).
   Keyboard-friendly line grid (type-ahead item search, Enter moves qty → price → next line, ↑/↓ between rows), lot picker
   from item costs, on-hand checks, remove / cancel lines, Update Line (qty, tax code, price through the sale charge),
   charges drill + Charges dialog, allocation of lots / serials (inventory transaction), return lot/serial editor, and the
   line tabs (Margin, Lot Details, Fulfillment, Additional Info, Errors, System IDs, Actual Costing, Billing, Sales Credits). */

FOM.edLinesInit = function (E) {
    E.renderLines = function () { FOM.edRenderLines(E); };
    E.drawLinesHead = function () { FOM.edLinesHead(E); };
    E.drawLinesHead();
    E.ltabs = FOM.tabs(E.q('[data-ltabs]'), [
        { id: 'lines', label: 'Lines', icon: 'fa-list', render: function (p) { E.linesPane = p; FOM.edRenderLines(E); } },
        { id: 'margin', fresh: true, label: 'Margin', icon: 'fa-percent', render: function (p) { FOM.edMarginTab(E, p); } },
        { id: 'lots', fresh: true, label: 'Lot Details', icon: 'fa-layer-group', render: function (p) { FOM.edLotsTab(E, p); } },
        { id: 'fulfil', fresh: true, label: 'Fulfillment', icon: 'fa-warehouse', render: function (p) { FOM.edFulfilTab(E, p); } },
        { id: 'add', label: 'Additional Info', icon: 'fa-tags', render: function (p) { FOM.edLineEffTab(E, p); } },
        { id: 'errors', fresh: true, label: 'Errors', icon: 'fa-triangle-exclamation', render: function (p) { FOM.edErrorsTab(E, p); } },
        { id: 'ids', fresh: true, label: 'System IDs', icon: 'fa-fingerprint', render: function (p) { FOM.edIdsTab(E, p); } },
        { id: 'cost', label: 'Actual Costing', icon: 'fa-coins', hidden: !E.isEdit(), render: function (p) { FOM.actualCosting(p, E.rawLines, E.ccy()); } },
        { id: 'billing', label: 'Billing', icon: 'fa-file-invoice-dollar', hidden: !E.isEdit(), render: function (p, reload) { FOM.mergedChild(p, E.rawLines, ['linedetails', 'linedetail'], reload, FOM.billingCol); } },
        { id: 'credits', label: 'Sales Credits', icon: 'fa-user-tie', hidden: !E.isEdit(), render: function (p) { FOM.edCreditsTab(E, p); } }
    ]);
    E.el.addEventListener('click', function (e) { var a = e.target.closest('[data-ar]'); if (a) FOM.arInvoiceDlg(a.getAttribute('data-ar')); });
};
FOM.billingCol = function (rows) {
    var k = Object.keys(rows[0] || {}).filter(function (x) { return /^(billingtransactionnumber|billingtrxnumber|billingtransactionnum)$/i.test(x); })[0];
    return k ? function (r) { return r[k] ? '<a class="fom-a" data-ar="' + esc(r[k]) + '">' + esc(r[k]) + '</a>' : ''; } : null;
};
FOM.edLinesHead = function (E) {
    var m = E.lineMeta, h = E.q('[data-lh]'); if (!h) return;
    var hasExisting = E.lines.some(function (l) { return l.existing && !l.canceled; });
    h.innerHTML = '<b><i class="fa-solid fa-list" style="color:var(--accent)"></i> Lines</b><span class="chip" title="Line additional information segments found on this pod">EFF: lot ' + (m && m.lotSeg ? '✓' : '—') + ' · cost ' + (m && m.costSeg ? '✓' : '—') + '</span><span class="grow"></span>' +
        (E.isReturn() ? '' : '<button class="btn sm" data-lb="new" title="Add a blank line (Alt+N)"><i class="fa-solid fa-plus"></i> New Line</button><button class="btn sm primary" data-lb="multi"><i class="fa-solid fa-table-list"></i> Add Multiple Lines</button>') +
        '<button class="btn sm" data-lb="oh"><i class="fa-solid fa-boxes-stacked"></i> Check On-Hand</button>' +
        (E.saved() ? '<button class="btn sm" data-lb="status"><i class="fa-solid fa-rotate"></i> Refresh Status</button>' : '') +
        (E.saved() && hasExisting && !E.isReturn() ? '<button class="btn sm" data-lb="charges"><i class="fa-solid fa-receipt"></i> Charges</button>' : '') +
        (E.hdr.invTxn && !E.isReturn() ? '<button class="btn sm" data-lb="alloc"><i class="fa-solid fa-barcode"></i> Allocate Lots/Serials</button>' : '');
    h.onclick = function (e) {
        var b = e.target.closest('[data-lb]'); if (!b) return; var x = b.getAttribute('data-lb');
        if (x === 'new') FOM.edAddBlank(E);
        else if (x === 'multi') FOM.addLinesDlg(E);
        else if (x === 'oh') FOM.edCheckOnhand(E);
        else if (x === 'status') FOM.edRefreshStatuses(E);
        else if (x === 'charges') FOM.chargesDlg(E);
        else if (x === 'alloc') { var l = E.lines.filter(function (x2) { return x2.itemNumber && !x2.existing; })[0]; if (l) FOM.edAllocate(E, l); else FX.toast('Add a line first'); }
    };
};
FOM.edAddBlank = function (E, focus) {
    var t = E.taxList.filter(function (x) { return x.code === E.defTax; })[0];
    var l = FOM.newLine({ qty: 1, taxCode: t ? t.code : '', taxPct: t ? t.pct : 0 });
    E.lines.push(l); E.ltabs.show('lines'); E.renderLines(); E.recalc(); E.drawToolbar();
    if (focus !== false) setTimeout(function () { var i = E.q('tr[data-k="' + l.key + '"] [data-f="itemNumber"]'); if (i) i.focus(); }, 30);
    return l;
};
/** Add lines from a source (ItemNumber, ItemDescription, PrimaryUOMValue, _qty, _price, _cost, _taxCode, _taxPct, _tax, _lot, _lots, _qoh); duplicates by item skipped. */
FOM.edAddLines = function (E, rows) {
    var have = {}, added = 0, skipped = [];
    E.lines.forEach(function (l) { if (l.itemNumber && !l.canceled) have[l.itemNumber] = 1; });
    var def = E.taxList.filter(function (x) { return x.code === E.defTax; })[0];
    E.lines = E.lines.filter(function (l) { return l.itemNumber || l.existing; });
    rows.forEach(function (r) {
        var it = r.ItemNumber; if (!it) return; if (have[it]) { skipped.push(it); return; } have[it] = 1;
        var tc = r._taxCode || (def ? def.code : ''), tp = r._taxPct != null ? r._taxPct : (E.taxList.filter(function (x) { return x.code === tc; })[0] || {}).pct || 0;
        var l = FOM.newLine({ itemNumber: it, description: r.ItemDescription || '', uom: FOM.uomOf(r) || '', qty: FOM.n(r._qty) || 1, unitPrice: FOM.n(r._price), costUnit: r._cost != null ? FOM.num(r._cost) : null, taxCode: tc, taxPct: tp, lot: r._lot || '', lots: r._lots || [], qoh: r._qoh != null ? r._qoh : null, subinventory: r._subinv || '' });
        if (r._tax != null) l.taxAmount = FOM.r2(r._tax); else FOM.lineTax(l);
        E.lines.push(l); added++;
    });
    E.ltabs.show('lines'); E.renderLines(); E.recalc(); E.drawToolbar(); E.drawLinesHead();
    FX.toast('Added ' + added + ' line(s)' + (skipped.length ? ' — skipped duplicates: ' + skipped.slice(0, 8).join(', ') : ''), added ? 'ok' : '');
};
FOM.edCanEditQty = function (E, l) { return !l.canceled && !(E.isEdit() && l.existing) && !(l.returnLine && (l.retLots || []).length) && !(E.saved() && l.existing && !E.isEdit()); };
FOM.edCanEditPrice = function (E, l) { return !l.canceled && !l.existing && !l.returnLine; };
FOM.edRowHtml = function (E, l, i) {
    var c = E.ccy(), ret = E.isReturn(), ed = E.isEdit(), cq = FOM.edCanEditQty(E, l), cp = FOM.edCanEditPrice(E, l), newItem = !l.existing && !l.returnLine;
    var tot = FOM.lineTotal(l), calc = FOM.r2(FOM.n(l.qty) * FOM.n(l.unitPrice)), mismatch = l.loadedExt != null && Math.abs(l.loadedExt - calc) > 0.009;
    var margin = l.costUnit != null ? FOM.r2((FOM.n(l.unitPrice) - FOM.n(l.costUnit)) * FOM.n(l.qty)) : null;
    var st = l.error ? '<button class="btn sm danger" data-la="err" title="' + esc(l.error) + '"><i class="fa-solid fa-circle-xmark"></i> Error</button>' : l.canceled ? '<span class="chip err">Canceled</span>' : l.status ? FOM.chip(l.status, l.statusCode) : '<span class="chip">new</span>';
    var lockUpd = /billing|close/i.test((l.status || '') + ' ' + (l.statusCode || ''));
    var acts = ed && l.existing ? '<button class="btn sm icon" data-la="upd" title="Update line"' + (l.canceled || lockUpd ? ' disabled' : '') + '><i class="fa-solid fa-pen-to-square"></i></button><button class="btn sm icon danger" data-la="del" title="' + (E.isDraft() ? 'Delete line (qty 0)' : 'Cancel line') + '"' + (l.canceled ? ' disabled' : '') + '><i class="fa-solid fa-ban"></i></button>'
        : (E.saved() && l.existing ? '' : '<button class="btn sm icon" data-la="rm" title="Remove line"><i class="fa-solid fa-xmark"></i></button>');
    return '<tr data-k="' + l.key + '" class="' + (l.canceled ? 'fom-cx' : '') + (l.error ? ' fom-er' : '') + '">' +
        '<td class="muted">' + (l.srcLineNumber || i + 1) + '</td>' +
        '<td class="fom-item">' + (newItem ? '<div class="fom-itemc"><input data-f="itemNumber" value="' + esc(l.itemNumber) + '" placeholder="Item # or description" autocomplete="off"><button class="btn sm icon" data-la="pick" title="Item picker"><i class="fa-solid fa-magnifying-glass"></i></button>' + (l.itemNumber ? '<button class="btn sm icon" data-la="lot" title="Lot / cost"><i class="fa-solid fa-layer-group"></i></button>' : '') + (E.hdr.invTxn && l.itemNumber ? '<button class="btn sm icon' + ((l.selectedSerials || []).length || l.selectedLot ? ' ok' : '') + '" data-la="alloc" title="Allocate lot & serials"><i class="fa-solid fa-barcode"></i></button>' : '') + '</div>'
            : '<b class="mono">' + esc(l.itemNumber) + '</b>') + (l.lot ? '<div class="muted" style="font-size:.68rem">lot ' + esc(l.lot) + '</div>' : '') + '</td>' +
        '<td>' + esc(l.description) + '</td><td>' + esc(l.uom) + '</td>' +
        '<td class="n">' + (l.costUnit != null ? FOM.amt(l.costUnit) : '<span class="muted">—</span>') + '</td>' +
        '<td class="n">' + (l.qoh != null ? FOM.qty(l.qoh) : '<span class="muted">—</span>') + '</td>' +
        '<td class="n"><input type="number" step="any" min="0" data-f="qty" value="' + esc(l.qty) + '"' + (cq ? '' : ' disabled') + ' class="fom-num"></td>' +
        (ret ? '<td><select data-f="returnReason">' + FOM.opts(E.returnReasons || [{ v: l.returnReason, t: l.returnReason }], l.returnReason) + '</select></td><td>' + ((l.retLots || []).length ? '<button class="btn sm" data-la="retlots">' + (l.retLots.some(function (x) { return x.serial; }) ? l.retLots.length + ' serials' : FOM.distinct(l.retLots.map(function (x) { return x.lot; })).length + ' lots') + '</button>' : '<span class="muted">—</span>') + '</td>' : '') +
        '<td class="n"><input type="number" step="any" min="0" data-f="unitPrice" value="' + esc(l.unitPrice) + '"' + (cp ? '' : ' disabled') + ' class="fom-num"></td>' +
        '<td class="n" data-c="tot"><span class="' + (l.existing ? 'fom-a' : '') + '" data-la="' + (l.existing ? 'drill' : '') + '"' + (mismatch ? ' style="color:var(--err)" title="Fusion amount differs from qty × price (' + FOM.amt(calc) + ')"' : '') + '>' + FOM.amt(tot) + '</span></td>' +
        '<td class="n" data-c="mar">' + (margin == null ? '<span class="muted">—</span>' : '<span style="color:' + (margin < 0 ? 'var(--err)' : 'var(--ok)') + '">' + FOM.amt(margin) + '</span>') + '</td>' +
        '<td><select data-f="taxCode"' + (l.canceled || (ed && l.existing) || l.returnLine ? ' disabled' : '') + '>' + FOM.taxOpts(E.taxList, l.taxCode) + '</select></td>' +
        '<td class="n" data-c="tax">' + (l.taxPct ? '<span class="chip">' + FOM.r2(l.taxPct) + '%</span> ' : '') + FOM.amt(l.taxAmount) + '</td>' +
        '<td class="n">' + (l.chargeAmount ? '<span class="fom-a" data-la="drill">' + FOM.amt(l.chargeAmount) + '</span>' : '<span class="muted">—</span>') + '</td>' +
        '<td class="n" data-c="net"><b>' + FOM.amt(tot + FOM.n(l.taxAmount) + FOM.n(l.chargeAmount)) + '</b></td>' +
        '<td>' + st + '</td><td style="white-space:nowrap">' + acts + '</td></tr>';
};
FOM.edRenderLines = function (E) {
    var p = E.linesPane; if (!p) return;
    E.drawLinesHead();
    if (E.loading) { p.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Reading the order lines…</div>'; return; }
    var ret = E.isReturn(), act = document.activeElement, focusKey = act && act.closest && act.closest('tr[data-k]') ? act.closest('tr[data-k]').getAttribute('data-k') : null, focusF = act && act.getAttribute ? act.getAttribute('data-f') : null;
    if (!E.lines.length) {
        p.innerHTML = '<div class="empty fom-empty-lines"><i class="fa-solid fa-cart-plus"></i><b>No lines yet</b><span>' + (ret ? 'Nothing to return.' : 'Use <b>New Line</b> and type an item number, or <b>Add Multiple Lines</b> from on-hand, item costs, a price list, Excel or pasted text.') + '</span>' + (ret ? '' : '<div class="row-btns" style="justify-content:center;margin-top:10px"><button class="btn primary" data-e0="new"><i class="fa-solid fa-plus"></i> New Line</button><button class="btn" data-e0="multi"><i class="fa-solid fa-table-list"></i> Add Multiple Lines</button></div>') + '</div>';
        p.onclick = function (e) { var b = e.target.closest('[data-e0]'); if (!b) return; if (b.getAttribute('data-e0') === 'new') FOM.edAddBlank(E); else FOM.addLinesDlg(E); };
        return;
    }
    p.innerHTML = '<div class="fom-tw fom-lines"><table class="tbl"><thead><tr><th>#</th><th>Item</th><th>Description</th><th>UOM</th><th class="n">Cost</th><th class="n">QoH</th><th class="n">' + (ret ? 'Return Qty' : 'Qty') + '</th>' + (ret ? '<th>Return Reason</th><th>Lot / Serial</th>' : '') +
        '<th class="n">Unit Price</th><th class="n">Line Total</th><th class="n">Margin</th><th>Tax Code</th><th class="n">Tax</th><th class="n">Charge</th><th class="n">Net</th><th>Status</th><th></th></tr></thead><tbody>' +
        E.lines.map(function (l, i) { return FOM.edRowHtml(E, l, i); }).join('') + '</tbody><tfoot><tr data-foot></tr></tfoot></table></div>' +
        '<div class="fom-kbd muted"><span><kbd>Enter</kbd> next field</span><span><kbd>↑</kbd><kbd>↓</kbd> row</span><span><kbd>Alt</kbd>+<kbd>N</kbd> new line</span><span>Type 3+ characters in Item to search</span></div>';
    var tb = p.querySelector('tbody');
    E.lines.forEach(function (l) {
        var inp = tb.querySelector('tr[data-k="' + l.key + '"] [data-f="itemNumber"]'); if (!inp) return;
        FX.typeahead(inp, function (t) { return FOM.searchItems(t, E.hdr.warehouse).then(function (r) { return r.map(function (x) { return { v: x.ItemNumber, t: x.ItemDescription || '', r: FOM.uomOf(x) || '', o: x }; }); }); }, function (h) { FOM.edApplyItem(E, l, h.o); }, 3);
    });
    FOM.edLineTotals(E);
    tb.oninput = function (e) {
        var t = e.target, f = t.getAttribute('data-f'), tr = t.closest('tr[data-k]'); if (!f || !tr || f === 'itemNumber') return;
        var l = FOM.edLine(E, tr.getAttribute('data-k')); if (!l) return;
        if (f === 'qty' || f === 'unitPrice') {
            var v = FOM.n(t.value);
            if (f === 'qty') {
                if (l.returnLine && v > FOM.n(l.maxQty)) { FX.toast('Cannot return more than ordered (' + l.maxQty + ')', 'err'); v = FOM.n(l.maxQty); t.value = v; }
                else if (!l.returnLine && l.qoh != null && !E.hdr._noCap && v > l.qoh && !l.existing) { FX.toast('Cannot order more than on-hand (' + FOM.qty(l.qoh) + ')', 'err'); v = l.qoh; t.value = v; }
            }
            l[f] = v; if (!l.existing) l.loadedExt = null; FOM.lineTax(l); FOM.edRowCalc(E, tr, l); E.recalc(); E.drawToolbar();
        }
    };
    tb.onchange = function (e) {
        var t = e.target, f = t.getAttribute('data-f'), tr = t.closest('tr[data-k]'); if (!f || !tr) return;
        var l = FOM.edLine(E, tr.getAttribute('data-k')); if (!l) return;
        if (f === 'taxCode') { var tx = E.taxList.filter(function (x) { return x.code === t.value; })[0]; l.taxCode = t.value; l.taxPct = tx ? tx.pct : 0; FOM.lineTax(l); FOM.edRowCalc(E, tr, l); E.recalc(); }
        if (f === 'returnReason') l.returnReason = t.value;
    };
    tb.onkeydown = function (e) {
        var t = e.target, f = t.getAttribute && t.getAttribute('data-f'), tr = t.closest && t.closest('tr[data-k]'); if (!f || !tr) return;
        var rows = Array.prototype.slice.call(tb.querySelectorAll('tr[data-k]')), ri = rows.indexOf(tr);
        var focus = function (row, fld) { if (!row) return false; var x = row.querySelector('[data-f="' + fld + '"]:not([disabled])'); if (x) { x.focus(); if (x.select) x.select(); return true; } return false; };
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (f === 'itemNumber' && t.closest('.ta') && t.closest('.ta').querySelector('.ta-list:not([hidden])')) return; e.preventDefault(); focus(rows[ri + (e.key === 'ArrowDown' ? 1 : -1)], f); return; }
        if (e.key !== 'Enter' || e.defaultPrevented) return;
        e.preventDefault();
        var l = FOM.edLine(E, tr.getAttribute('data-k'));
        if (f === 'itemNumber') {
            var v = t.value.trim();
            if (v && v !== l.itemNumber) { FOM.edExactItem(E, l, v); return; }
            focus(tr, 'qty') || focus(tr, 'unitPrice');
        } else if (f === 'qty') { focus(tr, 'unitPrice') || focus(rows[ri + 1], 'qty') || (!E.isReturn() && FOM.edAddBlank(E)); }
        else if (f === 'unitPrice') { if (ri === rows.length - 1 && !E.isReturn()) FOM.edAddBlank(E); else focus(rows[ri + 1], 'itemNumber') || focus(rows[ri + 1], 'qty'); }
    };
    tb.onclick = function (e) {
        var b = e.target.closest('[data-la]'); if (!b || !b.getAttribute('data-la')) return;
        var tr = b.closest('tr[data-k]'), l = FOM.edLine(E, tr.getAttribute('data-k')), a = b.getAttribute('data-la');
        if (a === 'rm') { (l.itemNumber ? FOM.confirm('Remove line', 'Remove <b>' + esc(l.itemNumber) + '</b> from the order?', 'Remove', 'warn') : Promise.resolve(true)).then(function (ok) { if (ok) { E.lines.splice(E.lines.indexOf(l), 1); E.renderLines(); E.recalc(); E.drawToolbar(); } }); }
        else if (a === 'del') FOM.edRemoveExisting(E, l);
        else if (a === 'upd') FOM.updateLineDlg(E, l);
        else if (a === 'err') FOM.alert('Line ' + (l.srcLineNumber || '') + ' — ' + esc(l.itemNumber), esc(l.error), 'err');
        else if (a === 'pick') FOM.itemPicker(E, l);
        else if (a === 'lot') FOM.edLotPicker(E, l);
        else if (a === 'alloc') FOM.edAllocate(E, l);
        else if (a === 'drill') FOM.chargesDrill(E, l);
        else if (a === 'retlots') FOM.retLotsDlg(E, l);
    };
    if (focusKey && focusF) { var fe = tb.querySelector('tr[data-k="' + focusKey + '"] [data-f="' + focusF + '"]'); if (fe) { fe.focus(); if (fe.type === 'number' && fe.select) fe.select(); } }
    if (!E._altN) { E._altN = true; E.el.addEventListener('keydown', function (e) { if (e.altKey && (e.key === 'n' || e.key === 'N') && !E.isReturn()) { e.preventDefault(); FOM.edAddBlank(E); } }); }
};
FOM.edLine = function (E, key) { return E.lines.filter(function (l) { return l.key === key; })[0]; };
FOM.edRowCalc = function (E, tr, l) {
    var tot = FOM.lineTotal(l), margin = l.costUnit != null ? FOM.r2((FOM.n(l.unitPrice) - FOM.n(l.costUnit)) * FOM.n(l.qty)) : null;
    tr.querySelector('[data-c="tot"]').innerHTML = '<span>' + FOM.amt(tot) + '</span>';
    tr.querySelector('[data-c="mar"]').innerHTML = margin == null ? '<span class="muted">—</span>' : '<span style="color:' + (margin < 0 ? 'var(--err)' : 'var(--ok)') + '">' + FOM.amt(margin) + '</span>';
    tr.querySelector('[data-c="tax"]').innerHTML = (l.taxPct ? '<span class="chip">' + FOM.r2(l.taxPct) + '%</span> ' : '') + FOM.amt(l.taxAmount);
    tr.querySelector('[data-c="net"]').innerHTML = '<b>' + FOM.amt(tot + FOM.n(l.taxAmount) + FOM.n(l.chargeAmount)) + '</b>';
};
FOM.edLineTotals = function (E, t) {
    var f = E.linesPane && E.linesPane.querySelector('[data-foot]'); if (!f) return;
    t = t || FOM.edTotals(E); var ret = E.isReturn();
    f.innerHTML = '<td></td><td colspan="5"><b>' + E.lines.filter(function (l) { return l.itemNumber && !l.canceled; }).length + ' line(s)</b></td><td class="n"><b>' + FOM.qty(t.qty) + '</b></td>' + (ret ? '<td></td><td></td>' : '') + '<td></td><td class="n"><b>' + FOM.amt(t.gross) + '</b></td><td></td><td></td><td class="n"><b>' + FOM.amt(t.tax) + '</b></td><td class="n"><b>' + FOM.amt(t.charges) + '</b></td><td class="n"><b>' + FOM.amt(FOM.r2(t.gross + t.tax + t.charges)) + '</b> <span class="muted">' + esc(E.ccy()) + '</span></td><td></td><td></td>';
};

// ── item / lot / on-hand ───────────────────────────────────────
FOM.edExactItem = function (E, l, v) {
    FOM.searchItems(v, E.hdr.warehouse).then(function (r) {
        var ex = r.filter(function (x) { return String(x.ItemNumber).toUpperCase() === v.toUpperCase(); })[0];
        if (ex) FOM.edApplyItem(E, l, ex);
        else if (r.length === 1) FOM.edApplyItem(E, l, r[0]);
        else if (r.length) FOM.itemPicker(E, l, v, r);
        else FX.toast('Item "' + v + '" not found', 'err');
    }).catch(function (e) { FX.toast(FOM.emsg(e), 'err'); });
};
FOM.edApplyItem = function (E, l, it) {
    var dup = E.lines.filter(function (x) { return x !== l && x.itemNumber === it.ItemNumber && !x.canceled; })[0];
    if (dup) FX.toast(it.ItemNumber + ' is already on line ' + (E.lines.indexOf(dup) + 1));
    l.itemNumber = it.ItemNumber; l.description = it.ItemDescription || l.description; l.uom = FOM.uomOf(it) || l.uom; l.loadedExt = null;
    E.renderLines(); E.drawToolbar();
    var focusQty = function () { setTimeout(function () { var q = E.q('tr[data-k="' + l.key + '"] [data-f="qty"]'); if (q) { q.focus(); q.select(); } }, 30); };
    focusQty();
    FOM.itemCosts(l.itemNumber, E.hdr.warehouse, 0, 25).then(function (r) {
        var lots = FOM.distinct(r.rows.map(function (x) { return x._vu.lot; }));
        if (lots.length > 1 || (r.hasMore && r.rows.length)) { FOM.edLotPicker(E, l, r); return; }
        FOM.edApplyCostRow(E, l, r.rows[0]);
    }).catch(function () { FOM.edApplyCostRow(E, l, null); });
};
FOM.edApplyCostRow = function (E, l, row) {
    var vu = row ? row._vu : {};
    if (row) { l.costUnit = row._cost; if (!l.uom) l.uom = FOM.pf(row, ['PrimaryUOMCode', 'UOMCode', 'UOM']) || ''; if (!l.description) l.description = row.ItemDescription || ''; if (vu.lot) l.lot = vu.lot; }
    var org = E.hdr.warehouse || vu.invOrg, sub = E.hdr.subinventory || vu.subinv;
    E.renderLines(); E.recalc();
    if (!org) return;
    FOM.fetchOnhand(l.itemNumber, org, sub, l.lot || null).then(function (oh) { l.qoh = oh.qty; l.lots = oh.lots; E.renderLines(); }).catch(function () { });
};
FOM.edLotPicker = function (E, l, first) {
    var off = 0, all = [], opts = {};
    var d = FOM.dlg({
        title: 'Select lot — ' + esc(l.itemNumber), wide: true, body: '<div data-t><i class="fa-solid fa-circle-notch fa-spin"></i> Reading item costs…</div>',
        buttons: [{ label: 'Next 25', act: 'next', id: 'fom-lp-next' }, { label: 'Close', act: 'close' }],
        onAction: function (a) { if (a === 'next') { off += 25; load(); return false; } }
    });
    function draw(hasMore) {
        d.q('#fom-lp-next').disabled = !hasMore;
        d.q('[data-t]').innerHTML = FOM.table(all, [{ label: 'Lot', html: function (r) { return '<b>' + esc(r._vu.lot || '—') + '</b>'; } }, { label: 'Inv Org', html: function (r) { return esc(r._vu.invOrg); } }, { label: 'Subinv', html: function (r) { return esc(r._vu.subinv); } }, { label: 'On-Hand Qty', n: 1, html: function (r) { var k = (r._vu.lot || '') + '|' + (r._vu.subinv || ''); return opts[k] != null ? FOM.qty(opts[k]) : '<span class="muted">—</span>'; } }, { label: 'Cost', n: 1, html: function (r) { return FOM.amt(r._cost); } }, { label: '', html: function (r, i) { return '<button class="btn sm primary" data-sel="' + i + '">Select</button>'; } }], { empty: 'No cost rows for this item in ' + (E.hdr.warehouse || 'any org') + '.' });
    }
    function load() {
        var p = first && off === 0 ? Promise.resolve(first) : FOM.itemCosts(l.itemNumber, E.hdr.warehouse, off, 25);
        p.then(function (r) { all = all.concat(r.rows); draw(r.hasMore); }).catch(function (e) { d.q('[data-t]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
    }
    if (E.hdr.warehouse) FOM.reserveOptions(l.itemNumber, E.hdr.warehouse, null).then(function (r) { r.options.forEach(function (o) { opts[o.lot + '|' + o.subinventory] = o.qty; }); draw(true); }).catch(function () { });
    d.box.addEventListener('click', function (e) { var b = e.target.closest('[data-sel]'); if (b) { var r = all[+b.getAttribute('data-sel')]; d.close(); FOM.edApplyCostRow(E, l, r); } });
    load();
};
FOM.itemPicker = function (E, l, start, pre) {
    var list = pre || [];
    var d = FOM.dlg({
        title: 'Item picker' + (E.hdr.warehouse ? ' — ' + esc(E.hdr.warehouse) : ''), wide: true,
        body: '<div class="row-btns"><input class="fom-in" data-q placeholder="Item number or description (3+ characters)" value="' + esc(start || '') + '" style="flex:1"><button class="btn primary" data-s><i class="fa-solid fa-magnifying-glass"></i> Search</button></div><input class="fom-in" data-f placeholder="Filter results…" style="max-width:260px"><div data-r></div>'
    });
    function draw() { var f = d.q('[data-f]').value.toLowerCase(), v = list.filter(function (x) { return !f || (x.ItemNumber + ' ' + (x.ItemDescription || '')).toLowerCase().indexOf(f) >= 0; }); d.q('[data-r]').innerHTML = FOM.table(v, [{ f: 'ItemNumber', label: 'Item', mono: 1 }, { f: 'ItemDescription', label: 'Description' }, { label: 'UOM', html: function (x) { return esc(FOM.uomOf(x) || ''); } }, { f: 'OrganizationCode', label: 'Org' }, { label: '', html: function (x) { return '<button class="btn sm primary" data-pk="' + esc(x.ItemNumber) + '">Select</button>'; } }], { empty: 'Search for an item.', maxH: 420 }); }
    function go() { var t = d.q('[data-q]').value.trim(); if (t.length < 2) { FX.toast('Type at least 2 characters', 'err'); return; } d.q('[data-r]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>'; FOM.searchItems(t, E.hdr.warehouse).then(function (r) { list = r; draw(); }).catch(function (e) { d.q('[data-r]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; }); }
    d.q('[data-s]').onclick = go; d.q('[data-q]').onkeydown = function (e) { if (e.key === 'Enter') go(); }; d.q('[data-f]').oninput = draw;
    d.box.addEventListener('click', function (e) { var b = e.target.closest('[data-pk]'); if (b) { var it = list.filter(function (x) { return x.ItemNumber === b.getAttribute('data-pk'); })[0]; d.close(); FOM.edApplyItem(E, l, it); } });
    if (pre) draw(); else if (start) go();
};
FOM.edCheckOnhand = function (E) {
    if (!E.hdr.warehouse) { FX.toast('Pick a warehouse first', 'err'); return; }
    var ls = E.lines.filter(function (l) { return l.itemNumber && !l.canceled; }); if (!ls.length) return;
    FX.busy('Checking on-hand for ' + ls.length + ' line(s)…');
    FOM.mapLimit(ls, 4, function (l) { return FOM.fetchOnhand(l.itemNumber, E.hdr.warehouse, E.hdr.subinventory, l.lot && l.lot.indexOf(',') < 0 ? l.lot : null).then(function (r) { l.qoh = r.qty; l.lots = r.lots; }); }).then(function () { FX.busy(); E.renderLines(); var short = ls.filter(function (l) { return l.qoh != null && l.qoh < FOM.n(l.qty); }); FX.toast(short.length ? short.length + ' line(s) have less on hand than ordered' : 'On-hand checked — all lines covered', short.length ? 'err' : 'ok'); });
};
/** Remove an existing line (edit mode): draft → order PATCH qty 0; otherwise PATCH the line canceled. */
FOM.edRemoveExisting = function (E, l) {
    var draft = E.isDraft(), call;
    if (draft) { if (!(l.srcLineId || l.fulfillLineId)) { FX.toast('Line keys missing — reload the order before removing', 'err'); return; } call = { method: 'PATCH', url: E.orderPath(), body: { lines: [{ SourceTransactionLineId: String(l.srcLineId || l.fulfillLineId), SourceTransactionScheduleId: String(l.srcScheduleNumber || l.srcLineId), OrderedQuantity: 0 }] } }; }
    else { if (!l.lineHref && !l.fulfillLineId) { FX.toast('Line keys missing — reload the order before removing', 'err'); return; } call = { method: 'PATCH', url: l.lineHref || E.orderPath() + '/child/lines/' + l.fulfillLineId, body: { CanceledFlag: true, CancelReasonCode: FOM.cfg('cancelReason') } }; }
    var calls = [{ method: call.method, url: FOM.u(call.url), body: call.body }]; calls.note = draft ? 'Draft order: the line is set to quantity 0 (line-level DELETE is not supported).' : 'The order is not a draft: the line is canceled and stays on the order as Canceled.';
    FOM.preview((draft ? 'Delete' : 'Cancel') + ' line ' + esc(l.srcLineNumber || '') + ' — ' + esc(l.itemNumber), calls, draft ? 'Delete line' : 'Cancel line', 'warn').then(function (ok) {
        if (!ok) return;
        FX.busy('Updating line…');
        FOM.raw(call.method, call.url, {}, call.body).then(function (r) {
            FX.busy();
            if (!r.ok) { l.error = FOM.errs(r.json, r.text, r.status).join('\n'); E.errors.push({ where: 'Line ' + (l.srcLineNumber || ''), item: l.itemNumber, msg: l.error }); E.renderLines(); FOM.alert('Line not changed', esc(l.error), 'err'); return; }
            l.error = null;
            if (draft) E.lines.splice(E.lines.indexOf(l), 1); else { l.canceled = true; l.cancelSaved = true; }
            E.renderLines(); E.recalc(); E.drawToolbar(); FX.toast(draft ? 'Line deleted.' : 'Line canceled.', 'ok');
        }).catch(function (e) { FX.busy(); FOM.alert('Line not changed', esc(FOM.emsg(e)), 'err'); });
    });
};
/** Update Line dialog (§3.3.17) */
FOM.updateLineDlg = function (E, l) {
    var href = l.lineHref; if (!href) { FX.toast('Reload the order first', 'err'); return; }
    var d = FOM.dlg({
        title: 'Update line ' + esc(l.srcLineNumber || '') + ' — ' + esc(l.itemNumber), wide: true,
        body: '<div class="form"><label>Quantity<input type="number" step="any" data-u="qty" value="' + esc(l.qty) + '"></label><label>Unit price<input type="number" step="any" data-u="price" value="' + esc(l.unitPrice) + '"></label><label>Tax code<select data-u="tax">' + FOM.taxOpts(E.taxList, l.taxCode) + '</select></label><label>Lot<select data-u="lot"><option value="">Loading…</option></select></label></div>' +
            '<div class="facts" data-calc></div><div class="note">Frozen-price order: the price is changed through the sale charge and its components (list, net, tax, net + tax). On-hand: <span class="mono" style="font-size:.68rem">' + esc(FOM.u('inventoryOnhandBalances', { q: FOM.onhandQ(E.hdr.warehouse || '', l.itemNumber, E.hdr.subinventory), limit: 25 })) + '</span></div><div data-log></div>',
        buttons: [{ label: 'Close', act: 'close' }, { label: 'Update line', act: 'go', cls: 'primary' }],
        onOpen: function (dd) {
            var calc = function () { var q = FOM.n(dd.q('[data-u="qty"]').value), p = FOM.n(dd.q('[data-u="price"]').value), tx = E.taxList.filter(function (x) { return x.code === dd.q('[data-u="tax"]').value; })[0], pct = tx ? tx.pct : FOM.n(l.taxPct), ext = FOM.r2(p * q), ta = FOM.r2(ext * pct / 100); dd.q('[data-calc]').innerHTML = '<div><span>Extended</span>' + FOM.amt(ext) + '</div><div><span>Tax ' + pct + '%</span>' + FOM.amt(ta) + '</div><div><span>Net + tax</span><b>' + FOM.amt(ext + ta) + '</b></div>'; };
            dd.box.addEventListener('input', calc); dd.box.addEventListener('change', calc); calc();
            if (E.hdr.warehouse) FOM.reserveOptions(l.itemNumber, E.hdr.warehouse, E.hdr.subinventory).then(function (r) { dd.q('[data-u="lot"]').innerHTML = '<option value="">—</option>' + r.options.filter(function (o) { return o.lot; }).map(function (o) { return '<option value="' + esc(o.lot) + '"' + (o.lot === l.lot ? ' selected' : '') + '>' + esc(o.lot + ' · ' + o.subinventory + ' · ' + FOM.qty(o.qty)) + '</option>'; }).join(''); }).catch(function () { dd.q('[data-u="lot"]').innerHTML = '<option value="">—</option>'; });
            else dd.q('[data-u="lot"]').innerHTML = '<option value="">(no warehouse)</option>';
        },
        onAction: function (a, dd, btn) {
            if (a !== 'go') return;
            var q = FOM.n(dd.q('[data-u="qty"]').value), price = FOM.n(dd.q('[data-u="price"]').value), code = dd.q('[data-u="tax"]').value, lot = dd.q('[data-u="lot"]').value;
            if (q <= 0) { FX.toast('Quantity must be above 0', 'err'); return false; }
            var tx = E.taxList.filter(function (x) { return x.code === code; })[0], pct = tx ? tx.pct : (code === l.taxCode ? FOM.n(l.taxPct) : 0);
            var qtyCh = q !== FOM.n(l.qty), priceCh = price !== FOM.n(l.unitPrice), taxCh = code !== (l.taxCode || '');
            var log = []; var say = function (t, cls) { log.push('<div class="' + (cls || '') + '">' + t + '</div>'); dd.q('[data-log]').innerHTML = '<div class="note">' + log.join('') + '</div>'; };
            btn.disabled = true;
            var ext = FOM.r2(price * q), tu = FOM.r2(price * pct / 100), ta = FOM.r2(ext * pct / 100);
            var p = qtyCh ? FOM.write('PATCH', href, { OrderedQuantity: q }, { contentType: null }).then(function () { say('✓ Quantity → ' + q); }) : Promise.resolve();
            p.then(function () {
                if (!taxCh) return;
                return FOM.write('PATCH', href, { TaxClassificationCode: code || null }, { contentType: null }).then(function () { say('✓ Tax code → ' + (code || 'none')); }).catch(function (e) { say('! Tax code not changed: ' + esc(FOM.emsg(e)), 'warn'); });
            }).then(function () {
                if (!qtyCh && !priceCh && !taxCh) return;
                return FOM.get(href + '/child/charges', { expand: 'chargeComponents', limit: 50, onlyData: false }).then(function (j) {
                    var ch = j.items || [], pr = ch.filter(function (c) { return FOM.yes(c.PrimaryFlag); })[0] || ch[0];
                    if (!pr) { say('! No charge on the line — price not changed', 'warn'); return; }
                    return FOM.write('PATCH', FOM.self(pr), { GSAUnitPrice: price, PricedQuantity: q, ChargeCurrencyUnitPrice: price, ChargeCurrencyExtendedAmount: ext, HeaderCurrencyUnitPrice: price, HeaderCurrencyExtendedAmount: ext }, { contentType: null }).then(function () {
                        say('✓ Sale charge');
                        return FOM.mapLimit(pr.chargeComponents || [], 1, function (c) {
                            var u, e2, code2 = c.PriceElementCode;
                            if (code2 === 'QP_LIST_PRICE' || code2 === 'QP_NET_PRICE') { u = price; e2 = ext; } else if (code2 === 'QP_EXCLUSIVE_TAX') { u = tu; e2 = ta; } else if (code2 === 'QP_NET_PRICE_PLUS_TAX') { u = FOM.r2(price + tu); e2 = FOM.r2(ext + ta); } else return;
                            return FOM.write('PATCH', FOM.self(c), { HeaderCurrencyUnitPrice: u, HeaderCurrencyExtendedAmount: e2, ChargeCurrencyUnitPrice: u, ChargeCurrencyExtendedAmount: e2 }, { contentType: null }).then(function () { say('✓ ' + code2); }).catch(function (e) { say('! ' + code2 + ': ' + esc(FOM.emsg(e)), 'warn'); });
                        });
                    });
                });
            }).then(function () {
                Object.assign(l, { qty: q, origQty: q, unitPrice: price, origUnitPrice: price, taxCode: code, taxPct: pct, taxAmount: ta, loadedExt: ext, loadedTax: ta, lot: lot || l.lot, error: null });
                say('<b>Line updated.</b>', 'ok'); E.renderLines(); E.recalc(); btn.disabled = false;
            }).catch(function (e) { btn.disabled = false; l.error = FOM.emsg(e); say('✗ ' + esc(FOM.emsg(e)), 'err'); E.renderLines(); });
            return false;
        }
    });
};
/** Line total / charge drill: the line's charges with components. */
FOM.chargesDrill = function (E, l) {
    var href = l.chargesHref || (l.lineHref ? l.lineHref + '/child/charges' : null); if (!href) return;
    var d = FOM.dlg({ title: 'Charges — line ' + esc(l.srcLineNumber || '') + ' ' + esc(l.itemNumber), wide: true, body: '<div data-c><i class="fa-solid fa-circle-notch fa-spin"></i></div>' });
    FOM.get(href, { expand: 'chargeComponents', limit: 50 }).then(function (j) {
        var ch = j.items || [];
        d.q('[data-c]').innerHTML = ch.length ? ch.map(function (c) { return '<div class="card pad" style="margin-bottom:8px"><div class="row-btns"><b>' + esc(c.ChargeType || c.ChargeTypeCode || c.ChargeDefinitionCode || 'Charge') + '</b>' + (FOM.yes(c.PrimaryFlag) ? '<span class="chip done">Sale</span>' : '') + '<span class="muted mono" style="font-size:.7rem">' + esc(c.ChargeDefinitionCode || '') + '</span><span class="grow"></span><span class="muted">' + esc(c.ApplyTo || c.ApplyToCode || '') + '</span></div>' + FOM.table(c.chargeComponents || [], [{ f: 'PriceElementCode', label: 'Price Element', mono: 1 }, { label: 'Unit Price', n: 1, html: function (x) { return FOM.amt(FOM.pf(x, ['HeaderCurrencyUnitPrice', 'ChargeCurrencyUnitPrice'])); } }, { label: 'Extended', n: 1, html: function (x) { return FOM.amt(FOM.pf(x, ['HeaderCurrencyExtendedAmount', 'ChargeCurrencyExtendedAmount'])); } }], { empty: 'No components.' }) + '</div>'; }).join('') : '<div class="empty"><i class="fa-solid fa-receipt"></i>No charges on this line.</div>';
    }).catch(function (e) { d.q('[data-c]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
};
FOM.CHARGE_PRESETS = { Freight: { def: 'QP_SHIP_FREIGHT', sub: 'Price', apply: 'SHIPPING', type: 'ORA_SHIPPING_FREIGHT' }, Handling: { def: 'QP_SHIP_HANDLING', sub: 'Price', apply: 'SHIPPING', type: 'ORA_SHIPPING_HANDLING' }, Restocking: { def: 'QP_RESTOCKING_CHARGE', sub: 'Price', apply: 'RETURN', type: 'ORA_RESTOCKING' }, Custom: { def: '', sub: 'Price', apply: 'PRICE', type: '' } };
/** Charges dialog (§3.3.12) */
FOM.chargesDlg = function (E) {
    var elig = E.lines.filter(function (l) { return !l.canceled && (l.fulfillLineId || l.lineHref); });
    if (!elig.length) { FX.toast('No saved lines to charge', 'err'); return; }
    var url = function (l) { return l.chargesHref || (l.lineHref ? l.lineHref + '/child/charges' : E.orderPath() + '/child/lines/' + l.fulfillLineId + '/child/charges'); };
    var existing = [];
    var d = FOM.dlg({
        title: '<i class="fa-solid fa-receipt"></i> Charges', xwide: true,
        body: '<div class="row-btns"><div class="seg" data-scope><button class="on" data-s="one">Specific line</button><button data-s="all">Global — split across ' + elig.length + ' lines</button></div><select class="fom-in" data-line style="max-width:360px">' + elig.map(function (l, i) { return '<option value="' + i + '">Line ' + esc(l.srcLineNumber || i + 1) + ' — ' + esc(l.itemNumber) + ' (' + FOM.amt(FOM.lineTotal(l)) + ')</option>'; }).join('') + '</select></div>' +
            '<h4>Existing charges</h4><div data-ex></div><h4>Add a charge</h4><div class="row-btns" data-pre>' + Object.keys(FOM.CHARGE_PRESETS).map(function (k, i) { return '<button class="btn sm' + (i === 0 ? ' primary' : '') + '" data-p="' + k + '">' + k + '</button>'; }).join('') + '</div>' +
            '<div class="form"><label><span>Charge definition <b class="r">*</b></span><input data-c="def"></label><label>Charge sub type<input data-c="sub"></label><label>Apply to<select data-c="apply">' + FOM.opts(['PRICE', 'SHIPPING', 'RETURN'], 'SHIPPING') + '</select></label><label>Charge type code<input data-c="type"></label><label><span>Amount (' + esc(E.ccy()) + ') <b class="r">*</b></span><input type="number" step="any" data-c="amt"></label></div><div data-split></div><div data-res></div>',
        buttons: [{ label: 'Close', act: 'close' }, { label: 'Add charge', act: 'add', cls: 'primary' }],
        onOpen: function (dd) {
            var scope = 'one';
            function preset(k) { var p = FOM.CHARGE_PRESETS[k]; dd.q('[data-c="def"]').value = p.def; dd.q('[data-c="sub"]').value = p.sub; dd.q('[data-c="apply"]').value = p.apply; dd.q('[data-c="type"]').value = p.type; dd.qa('[data-p]').forEach(function (b) { b.classList.toggle('primary', b.getAttribute('data-p') === k); }); }
            preset('Freight');
            dd.q('[data-pre]').onclick = function (e) { var b = e.target.closest('[data-p]'); if (b) preset(b.getAttribute('data-p')); };
            dd.q('[data-scope]').onclick = function (e) { var b = e.target.closest('[data-s]'); if (!b) return; scope = b.getAttribute('data-s'); dd.d_scope = scope; dd.qa('[data-scope] button').forEach(function (x) { x.classList.toggle('on', x === b); }); dd.q('[data-line]').disabled = scope === 'all'; split(); };
            dd.q('[data-c="amt"]').oninput = split;
            function split() {
                if (scope !== 'all') { dd.q('[data-split]').innerHTML = ''; return; }
                var s = FOM.chargeSplit(elig, FOM.n(dd.q('[data-c="amt"]').value));
                dd.q('[data-split]').innerHTML = FOM.table(s, [{ label: 'Line', html: function (x) { return esc(x.l.srcLineNumber || '') + ' ' + esc(x.l.itemNumber); } }, { label: 'Line value', n: 1, html: function (x) { return FOM.amt(x.base); } }, { label: 'Share', n: 1, html: function (x) { return FOM.amt(x.share); } }]);
            }
            function loadEx() {
                var l = elig[+dd.q('[data-line]').value];
                dd.q('[data-ex]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
                FOM.get(url(l), { expand: 'chargeComponents', limit: 50, onlyData: false }).then(function (j) {
                    existing = j.items || [];
                    dd.q('[data-ex]').innerHTML = FOM.table(existing, [{ label: 'Charge', html: function (c) { return esc(c.ChargeType || c.ChargeTypeCode || c.ChargeDefinitionCode) + (FOM.yes(c.PrimaryFlag) ? ' (Sale)' : ''); } }, { f: 'ChargeDefinitionCode', label: 'Definition', mono: 1 }, { label: 'Amount', n: 1, html: function (c) { var cc = (c.chargeComponents || []).filter(function (x) { return x.PriceElementCode === 'QP_NET_PRICE'; })[0] || (c.chargeComponents || []).filter(function (x) { return x.PriceElementCode === 'QP_LIST_PRICE'; })[0]; return FOM.amt(cc ? FOM.pf(cc, ['HeaderCurrencyExtendedAmount', 'HeaderCurrencyUnitPrice']) : c.GSAUnitPrice); } }, { label: '', html: function (c) { return FOM.yes(c.PrimaryFlag) ? '' : '<button class="btn sm icon" disabled title="Deleting a charge needs DELETE, which the app\'s Fusion relay does not allow — remove it in Fusion"><i class="fa-solid fa-trash"></i></button>'; } }], { empty: 'No charges on this line.' });
                }).catch(function (e) { dd.q('[data-ex]').innerHTML = '<div class="note err">' + esc(FOM.emsg(e)) + '</div>'; });
            }
            dd.q('[data-line]').onchange = loadEx; loadEx();
        },
        onAction: function (a, dd, btn) {
            if (a !== 'add') return;
            var def = dd.q('[data-c="def"]').value.trim(), amt = FOM.r2(FOM.n(dd.q('[data-c="amt"]').value));
            if (!def || !amt) { FX.toast('Charge definition and amount are required', 'err'); return false; }
            var apply = dd.q('[data-c="apply"]').value, sub = dd.q('[data-c="sub"]').value.trim(), type = dd.q('[data-c="type"]').value.trim();
            var targets = dd.d_scope === 'all' ? FOM.chargeSplit(elig, amt).filter(function (x) { return x.share > 0; }).map(function (x) { return { l: x.l, a: x.share, seq: 1 }; }) : [{ l: elig[+dd.q('[data-line]').value], a: amt, seq: existing.length + 1 }];
            var fails = []; btn.disabled = true; dd.q('[data-res]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Adding…';
            FOM.mapLimit(targets, 1, function (t) {
                var src = 'MC-' + (t.l.fulfillLineId || t.l.srcLineId || 'x') + '-' + t.seq;
                var body = { SourceChargeId: src, ApplyToCode: apply, PriceType: 'One time' }; if (type) body.ChargeTypeCode = type;
                Object.assign(body, { ChargeSubType: sub, SequenceNumber: t.seq, ChargeDefinitionCode: def, PrimaryFlag: apply !== 'PRICE', RollupFlag: false, chargeComponents: [{ SourceChargeComponentId: src + '-SCC1', PriceElementCode: 'QP_LIST_PRICE', PriceElementUsageCode: 'LIST_PRICE', HeaderCurrencyUnitPrice: t.a, HeaderCurrencyExtendedAmount: t.a, RollupFlag: false, SequenceNumber: 1 }, { SourceChargeComponentId: src + '-SCC2', PriceElementCode: 'QP_NET_PRICE', PriceElementUsageCode: 'NET_PRICE', HeaderCurrencyUnitPrice: t.a, HeaderCurrencyExtendedAmount: t.a, RollupFlag: false, SequenceNumber: 2 }] });
                if (E.ccy()) body.ChargeCurrencyCode = E.ccy();
                return FOM.write('POST', url(t.l), body).then(function () { t.l.chargeAmount = FOM.r2(FOM.n(t.l.chargeAmount) + t.a); }).catch(function (e) { fails.push(t.l.itemNumber + ': ' + FOM.emsg(e)); });
            }).then(function () {
                btn.disabled = false; E.renderLines(); E.recalc();
                dd.q('[data-res]').innerHTML = fails.length ? '<div class="note err" style="white-space:pre-wrap">' + esc(fails.join('\n')) + '</div>' : '<div class="note ok">Charge added to ' + targets.length + ' line(s).</div>';
                dd.q('[data-line]').dispatchEvent(new Event('change'));
            });
            return false;
        }
    });
};
/** Prorate a global charge by line value; the last line takes the rounding remainder. */
FOM.chargeSplit = function (lines, amt) {
    var base = lines.map(function (l) { return l.loadedExt != null ? l.loadedExt : FOM.r2(FOM.n(l.qty) * FOM.n(l.unitPrice)); }), tot = base.reduce(function (s, v) { return s + v; }, 0), used = 0;
    return lines.map(function (l, i) { var s = i === lines.length - 1 ? FOM.r2(amt - used) : (tot ? FOM.r2(amt * base[i] / tot) : 0); used = FOM.r2(used + s); return { l: l, base: base[i], share: s }; });
};
/** Allocation modal for inventory-transaction lines (§3.3.26) → selectedLot / selectedSerials. */
FOM.edAllocate = function (E, l) {
    if (!E.hdr.warehouse) { FX.toast('Pick a warehouse first', 'err'); return; }
    FOM.allocateDlg(E.hdr.warehouse, { Item: l.itemNumber, RequestedQuantity: FOM.n(l.qty), SourceSubinventory: l.subinventory || E.hdr.subinventory, PickSlipLine: l.srcLineNumber || (E.lines.indexOf(l) + 1), UOM: l.uom }, l.selectedLot || (l.selectedSerials || []).length ? { lot: l.selectedLot, serials: l.selectedSerials || [], qty: l.qty } : null).then(function (a) {
        if (!a) return; l.selectedLot = a.lot; l.selectedSerials = a.serials; if (a.lot) l.lot = a.lot; E.renderLines(); FX.toast('Allocated ' + (a.serials.length || a.qty) + ' for ' + l.itemNumber, 'ok');
    });
};
FOM.retLotsDlg = function (E, l) {
    var list = (l.retLots || []).slice();
    var d = FOM.dlg({ title: 'Returned lots / serials — ' + esc(l.itemNumber), wide: true, body: '<div data-t></div>', buttons: [{ label: 'Cancel', act: 'close' }, { label: 'Apply', act: 'ok', cls: 'primary' }], onAction: function (a) { if (a === 'ok') { l.retLots = list; l.qty = FOM.sum(list, 'qty'); l.lot = FOM.distinct(list.map(function (x) { return x.lot; })).join(', '); E.renderLines(); E.recalc(); return true; } } });
    function draw() { d.q('[data-t]').innerHTML = FOM.table(list, [{ f: 'lot', label: 'Lot' }, { f: 'serial', label: 'Serial', mono: 1 }, { f: 'qty', label: 'Qty', n: 1 }, { label: '', html: function (r, i) { return '<button class="btn sm icon danger" data-rm="' + i + '"><i class="fa-solid fa-xmark"></i></button>'; } }], { empty: 'Nothing left — the line will return 0.', foot: ['', 'Total', { n: 1, v: FOM.sum(list, 'qty') }, ''] }); }
    d.box.addEventListener('click', function (e) { var b = e.target.closest('[data-rm]'); if (b) { list.splice(+b.getAttribute('data-rm'), 1); draw(); } });
    draw();
};

// ── line tabs ──────────────────────────────────────────────────
FOM.edMarginTab = function (E, p) {
    var ls = E.lines.filter(function (l) { return l.itemNumber && !l.canceled; });
    var rows = ls.map(function (l) { var tot = FOM.n(l.qty) * FOM.n(l.unitPrice), m = l.costUnit != null ? (FOM.n(l.unitPrice) - FOM.n(l.costUnit)) * FOM.n(l.qty) : null; return { l: l, tot: tot, m: m, pct: m != null && tot ? m / tot * 100 : null }; });
    var tm = FOM.sum(rows, 'm'), tt = FOM.sum(rows, 'tot');
    p.innerHTML = '<div style="padding:10px 12px">' + FOM.table(rows, [{ label: 'Item', html: function (r) { return '<span class="mono">' + esc(r.l.itemNumber) + '</span>'; } }, { label: 'Description', html: function (r) { return esc(r.l.description); } }, { label: 'Qty', n: 1, html: function (r) { return FOM.qty(r.l.qty); } }, { label: 'Cost', n: 1, html: function (r) { return r.l.costUnit != null ? FOM.amt(r.l.costUnit) : '—'; } }, { label: 'Unit Price', n: 1, html: function (r) { return FOM.amt(r.l.unitPrice); } }, { label: 'Margin', n: 1, html: function (r) { return r.m == null ? '—' : '<span style="color:' + (r.m < 0 ? 'var(--err)' : 'var(--ok)') + '">' + FOM.amt(r.m) + '</span>'; } }, { label: 'Margin %', n: 1, html: function (r) { return r.pct == null ? '—' : r.pct.toFixed(1) + '%'; } }], { empty: 'No lines.', foot: ['Total', '', '', '', { n: 1, v: FOM.amt(tt) }, { n: 1, v: FOM.amt(tm) }, { n: 1, v: tt ? (tm / tt * 100).toFixed(1) + '%' : '' }] }) + '</div>';
};
FOM.edLotsTab = function (E, p) {
    var rows = [];
    E.lines.filter(function (l) { return l.itemNumber; }).forEach(function (l, i) {
        var ln = l.srcLineNumber || i + 1;
        if ((l.lineLots || []).length) l.lineLots.forEach(function (x) { rows.push({ line: ln, item: l.itemNumber, lot: FOM.pf(x, ['LotNumber', 'Lot']), serial: [FOM.pf(x, ['ItemSerialNumberFrom', 'FromSerialNumber']), FOM.pf(x, ['ItemSerialNumberTo', 'ToSerialNumber'])].filter(Boolean).join(' → '), sub: x.SubinventoryCode || '', qty: FOM.pf(x, ['Quantity', 'LotQuantity']), src: 'Fusion' }); });
        else if ((l.selectedSerials || []).length || l.selectedLot) { if ((l.selectedSerials || []).length) l.selectedSerials.forEach(function (s) { rows.push({ line: ln, item: l.itemNumber, lot: l.selectedLot, serial: s, sub: E.hdr.subinventory, qty: 1, src: 'allocated' }); }); else rows.push({ line: ln, item: l.itemNumber, lot: l.selectedLot, serial: '', sub: E.hdr.subinventory, qty: l.qty, src: 'allocated' }); }
        else if ((l.retLots || []).length) l.retLots.forEach(function (x) { rows.push({ line: ln, item: l.itemNumber, lot: x.lot, serial: x.serial, sub: '', qty: x.qty, src: 'shipped' }); });
        else rows.push({ line: ln, item: l.itemNumber, lot: l.lot || (l.lots || []).join(', ') || '— no lot —', serial: '', sub: l.subinventory || E.hdr.subinventory, qty: l.qty, src: 'local' });
    });
    p.innerHTML = '<div style="padding:10px 12px">' + (E.hdr.invTxn ? '<div class="row-btns" style="margin-bottom:8px"><span class="muted" style="font-size:.76rem">Inventory transaction: allocate lots / serials per line (sent as lotSerials).</span></div>' : '') + FOM.table(rows, [{ f: 'line', label: 'Line' }, { f: 'item', label: 'Item', mono: 1 }, { f: 'lot', label: 'Lot' }, { f: 'serial', label: 'Serial', mono: 1 }, { f: 'sub', label: 'Subinventory' }, { f: 'qty', label: 'Qty', n: 1, fmt: 'qty' }, { label: 'Source', html: function (r) { return '<span class="chip">' + esc(r.src) + '</span>'; } }], { empty: 'No lines.' }) + '</div>';
};
FOM.edFulfilTab = function (E, p) {
    p.innerHTML = '<div style="padding:10px 12px">' + FOM.table(E.lines.filter(function (l) { return l.itemNumber; }), [{ f: 'itemNumber', label: 'Item', mono: 1 }, { f: 'description', label: 'Description' }, { label: 'Warehouse', html: function (l) { return esc(l.orgCode || E.hdr.warehouse || ''); } }, { label: 'Subinventory', html: function (l) { return esc(l.subinventory || E.hdr.subinventory || ''); } }, { label: 'Lot', html: function (l) { return esc(l.selectedLot || l.lot || ''); } }, { f: 'qty', label: 'Qty', n: 1, fmt: 'qty' }], { empty: 'No lines.' }) + '</div>';
};
FOM.edLineEffTab = function (E, p) {
    var m = E.lineMeta, segs = m ? m.segs : (FOM.EFF_FB.line[0].segs);
    var ls = E.lines.filter(function (l) { return l.itemNumber && !l.canceled; });
    var auto = function (l, s) { if (!m) return ''; if (s === m.lotSeg) return l.selectedLot || l.lot || ''; if (s === m.costSeg) return l.costUnit != null ? FOM.r3(l.costUnit) : ''; if (s === m.qtySeg) return l.qty; return ''; };
    p.innerHTML = '<div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px"><div class="row-btns"><span class="muted" style="font-size:.76rem">Context <b>' + esc(m ? m.contextCode : 'addinfo') + '</b> · blank = automatic value (placeholder)' + (m ? '' : ' · <span style="color:var(--warn)">no lot/cost segment found on this pod — line EFF is not sent with the order</span>') + '</span><span class="grow"></span>' + (E.saved() ? '<button class="btn sm primary" data-sv><i class="fa-solid fa-floppy-disk"></i> Save all line EFF</button>' : '') + '</div>' +
        FOM.table(ls, [{ label: 'Line', html: function (l, i) { return esc(l.srcLineNumber || i + 1); } }, { f: 'itemNumber', label: 'Item', mono: 1 }].concat(segs.map(function (s) { return { label: s.label, html: function (l) { return '<input class="fom-in" data-eff="' + esc(s.name) + '" data-k="' + l.key + '" value="' + esc((l.effVals || {})[s.name] || '') + '" placeholder="' + esc(auto(l, s.name)) + '">'; } }; })), { empty: 'No lines.' }) + '<div data-res></div></div>';
    p.oninput = function (e) { var s = e.target.getAttribute('data-eff'); if (!s) return; var l = FOM.edLine(E, e.target.getAttribute('data-k')); if (l) { l.effVals = l.effVals || {}; l.effVals[s] = e.target.value; } };
    var sv = p.querySelector('[data-sv]'); if (sv) sv.onclick = function () {
        if (!m) { FX.toast('No line context with lot / cost segments on this pod', 'err'); return; }
        var todo = ls.filter(function (l) { return l.lineHref; }), ok = 0, bad = [];
        sv.disabled = true; p.querySelector('[data-res]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving ' + todo.length + ' line(s)…';
        FOM.mapLimit(todo, 3, function (l) { var v = FOM.edLineEff(E, l); if (!v) return; return FOM.effWrite(l.lineHref, m, v, l.effKnown && l.effKnown.voName === m.voName ? l.effKnown : null).then(function (r) { ok++; l.effKnown = { voName: m.voName, voSelf: r.self || (l.effKnown && l.effKnown.voSelf) }; }).catch(function (e) { bad.push(l.itemNumber + ': ' + FOM.emsg(e)); }); }).then(function () { sv.disabled = false; p.querySelector('[data-res]').innerHTML = '<div class="note ' + (bad.length ? 'warn' : 'ok') + '" style="white-space:pre-wrap">Saved ' + ok + ', ' + bad.length + ' failed' + (bad.length ? '\n' + esc(bad.join('\n')) : '') + '</div>'; });
    };
};
FOM.edErrorsTab = function (E, p) {
    var rows = E.errors.slice();
    E.lines.forEach(function (l, i) { if (l.error && !rows.some(function (r) { return r.msg === l.error; })) rows.push({ where: 'Line ' + (l.srcLineNumber || i + 1), item: l.itemNumber, msg: l.error }); });
    E.ltabs.badge('errors', rows.length || '');
    p.innerHTML = '<div style="padding:10px 12px">' + FOM.table(rows, [{ f: 'where', label: 'Where' }, { f: 'item', label: 'Item', mono: 1 }, { label: 'Error', html: function (r) { return '<span style="color:var(--err);white-space:pre-wrap">' + esc(r.msg) + '</span>'; } }], { empty: 'No errors.', icon: 'fa-circle-check' }) + '</div>';
};
FOM.edIdsTab = function (E, p) {
    var draft = E.isDraft(), opsK = {};
    if (E.isEdit()) FOM.edOps(E).forEach(function (o) { opsK[o.l.key] = o.kind; });
    p.innerHTML = '<div style="padding:10px 12px"><div class="facts" style="margin-bottom:10px"><div><span>Order Key</span><span class="mono">' + esc(E.orderKey || '—') + '</span></div><div><span>Header Id</span><span class="mono">' + esc(E.headerId || '—') + '</span></div><div><span>Order #</span>' + esc(E.fusionNo || '—') + '</div><div><span>Source #</span>' + esc(E.orderNumber) + '</div></div>' +
        FOM.table(E.lines.filter(function (l) { return l.itemNumber; }), [{ label: 'Line', html: function (l, i) { return esc(l.srcLineNumber || i + 1); } }, { f: 'itemNumber', label: 'Item', mono: 1 }, { label: 'Action', html: function (l) { var k = opsK[l.key] || (l.canceled ? (l.cancelSaved ? 'Canceled' : draft ? 'Delete' : 'Cancel') : l.existing ? 'Unchanged' : 'New'); return '<span class="chip ' + (k === 'New' ? 'ok' : k === 'Update' ? 'done' : /Cancel|Delete/.test(k) ? 'err' : '') + '">' + k + '</span>'; } }, { f: 'fulfillLineId', label: 'FulfillLineId', mono: 1 }, { f: 'srcLineId', label: 'Source Line Id', mono: 1 }, { label: 'linesUniqID', html: function (l) { var m = String(l.lineHref || '').match(/\/child\/lines\/([^/?]+)/); return '<span class="mono">' + esc(m ? m[1] : '') + '</span>'; } }], { empty: 'No lines.' }) + '</div>';
};
