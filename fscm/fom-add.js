/* Fusion Order Management — "Add Multiple Lines" (spec §3.3.5–3.3.7): On-hand · From Item Cost (default) · From Price
   List · Excel / CSV (SheetJS) · Copy-Paste, with the shared staged preview (edit, validate against Item Cost / ItemsV2 /
   Price List, then add). PDF import of the source app is not rebuilt: copy the PDF's text and use Copy-Paste. */

FOM.addLinesDlg = function (E) {
    var wh = E.hdr.warehouse;
    var d = FOM.dlg({ title: '<i class="fa-solid fa-table-list"></i> Add Multiple Lines' + (wh ? ' — warehouse ' + esc(wh) + (E.hdr.subinventory ? ' / ' + esc(E.hdr.subinventory) : '') : ''), xwide: true, body: '<div data-tabs></div>', buttons: [{ label: 'Close', act: 'close' }] });
    var add = function (rows) { FOM.edAddLines(E, rows); d.close(); };
    FOM.tabs(d.q('[data-tabs]'), [
        { id: 'oh', label: 'On-hand', icon: 'fa-boxes-stacked', render: function (p) { FOM.addOnhand(E, p, add); } },
        { id: 'cost', label: 'From Item Cost', icon: 'fa-coins', render: function (p) { FOM.addItemCost(E, p, add); } },
        { id: 'pl', label: 'From Price List', icon: 'fa-tags', render: function (p) { FOM.addPriceList(E, p, add); } },
        { id: 'xl', label: 'Excel / CSV', icon: 'fa-file-excel', render: function (p) { FOM.addExcel(E, p, add); } },
        { id: 'paste', label: 'Copy-Paste', icon: 'fa-paste', render: function (p) { FOM.addPaste(E, p, add); } }
    ], { start: 'cost' });
};

// ── item validation (resolveItems) ─────────────────────────────
FOM.resolveItems = function (numbers, org, source, priceListId) {
    numbers = FOM.distinct(numbers); var out = {};
    numbers.forEach(function (n) { out[n] = { exists: false }; });
    if (source === 'itemsV2') {
        var chunks = []; for (var i = 0; i < numbers.length; i += 20) chunks.push(numbers.slice(i, i + 20));
        return FOM.mapLimit(chunks, 3, function (c) { return FX.get('itemsV2', { q: 'ItemNumber in (' + c.map(function (x) { return "'" + String(x).replace(/'/g, "''") + "'"; }).join(',') + ')' + (org ? ';OrganizationCode=' + org : ''), limit: 200 }).then(function (j) { (j.items || []).forEach(function (it) { if (out[it.ItemNumber]) out[it.ItemNumber] = { exists: true, desc: it.ItemDescription, uom: FOM.pf(it, ['PrimaryUOMValue', 'PrimaryUOMCode', 'UOMCode']) }; }); }); }).then(function () { return out; });
    }
    if (source === 'priceList') {
        var pl = priceListId ? Promise.resolve(priceListId) : FX.get('priceLists', { limit: 1 }).then(function (j) { return ((j.items || [])[0] || {}).PriceListId; });
        return pl.then(function (id) {
            if (!id) throw 'No price list found';
            return FOM.mapLimit(numbers, 4, function (n) { return FX.get('priceLists/' + id + '/child/items', { q: 'ProductNumber=' + FOM.qv(n), limit: 1 }).then(function (j) { var it = (j.items || [])[0]; if (it) out[n] = { exists: true, desc: FOM.pf(it, ['ProductDescription', 'ItemDescription', 'Description']), uom: FOM.pf(it, ['PrimaryUOMCode', 'UOMCode', 'PricingUOMCode']) }; }); });
        }).then(function () { return out; });
    }
    return FOM.mapLimit(numbers, 4, function (n) { return FX.get('itemCosts', { version: 'latest', q: 'ItemNumber=' + FOM.qv(n), limit: 1 }).then(function (j) { var it = (j.items || [])[0]; if (it) out[n] = { exists: true, desc: FOM.pf(it, ['ItemDescription', 'item', 'Item', 'ItemNumber']), uom: FOM.pf(it, ['PrimaryUOMCode', 'UOMCode', 'UOM']) }; }); }).then(function () { return out; });
};
/** StagedPreview: rows [{ItemNumber, _qty, _price, ItemDescription?}] */
FOM.staged = function (E, el, rows, add, opts) {
    opts = opts || {}; var validated = false;
    function draw() {
        var bad = rows.filter(function (r) { return r._invalid; }).length;
        el.innerHTML = '<div class="row-btns" style="margin:8px 0"><b style="font-size:.82rem">Staged preview — ' + rows.length + ' row(s)</b><span class="grow"></span><label class="fom-chk">Validate with <select class="fom-in" data-vs style="width:auto">' + FOM.opts([{ v: 'itemCost', t: 'Item Cost' }, { v: 'itemsV2', t: 'ItemsV2' }, { v: 'priceList', t: 'Price List' }], opts.source || 'itemCost') + '</select></label><button class="btn sm" data-val><i class="fa-solid fa-check-double"></i> Validate</button><button class="btn sm" data-reset>Start over</button><button class="btn sm primary" data-add' + (validated && !bad && rows.length ? '' : ' disabled title="Validate first — every item must exist"') + '><i class="fa-solid fa-plus"></i> Add ' + rows.length + ' line(s) to order</button></div>' +
            FOM.table(rows, [{ label: 'Item', html: function (r, i) { return '<input class="fom-in mono" data-s="ItemNumber" data-i="' + i + '" value="' + esc(r.ItemNumber) + '">'; } }, { label: 'Description', html: function (r) { return esc(r.ItemDescription || '') + (r._invalid ? ' <span class="chip err">Item not found</span>' : r._ok ? ' <span class="chip ok">ok</span>' : ''); } }, { label: 'UOM', html: function (r) { return esc(FOM.uomOf(r) || ''); } }, { label: 'Qty', n: 1, html: function (r, i) { return '<input class="fom-in fom-num" type="number" step="any" data-s="_qty" data-i="' + i + '" value="' + esc(r._qty) + '">'; } }, { label: 'Unit Price', n: 1, html: function (r, i) { return '<input class="fom-in fom-num" type="number" step="any" data-s="_price" data-i="' + i + '" value="' + esc(r._price) + '">'; } }, { label: 'Total', n: 1, html: function (r) { return FOM.amt(FOM.n(r._qty) * FOM.n(r._price)); } }, { label: '', html: function (r, i) { return '<button class="btn sm icon danger" data-del="' + i + '"><i class="fa-solid fa-xmark"></i></button>'; } }], { empty: 'Nothing staged.', maxH: 380, foot: ['', '', 'Total', { n: 1, v: FOM.qty(FOM.sum(rows, '_qty')) }, '', { n: 1, v: FOM.amt(FOM.sum(rows, function (r) { return FOM.n(r._qty) * FOM.n(r._price); })) }, ''] });
    }
    el.onchange = function (e) { var f = e.target.getAttribute('data-s'); if (!f) return; var r = rows[+e.target.getAttribute('data-i')]; r[f] = f === 'ItemNumber' ? e.target.value.trim() : FOM.n(e.target.value); if (f === 'ItemNumber') { validated = false; r._ok = r._invalid = false; } draw(); };
    el.onclick = function (e) {
        var dl = e.target.closest('[data-del]'); if (dl) { rows.splice(+dl.getAttribute('data-del'), 1); draw(); return; }
        if (e.target.closest('[data-reset]')) { if (opts.onReset) opts.onReset(); return; }
        if (e.target.closest('[data-add]')) { add(rows.map(function (r) { return Object.assign({}, r); })); return; }
        if (e.target.closest('[data-val]')) {
            var src = el.querySelector('[data-vs]').value, b = e.target.closest('[data-val]'); b.disabled = true; b.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Validating…';
            FOM.resolveItems(rows.map(function (r) { return r.ItemNumber; }), E.hdr.warehouse, src, opts.priceListId).then(function (m) {
                rows.forEach(function (r) { var x = m[r.ItemNumber] || {}; r._invalid = !x.exists; r._ok = !!x.exists; if (x.exists) { if (x.desc && !r.ItemDescription) r.ItemDescription = x.desc; if (x.uom && !FOM.uomOf(r)) r.PrimaryUOMValue = x.uom; } });
                validated = true; draw();
            }).catch(function (er) { FX.toast(FOM.emsg(er), 'err'); draw(); });
        }
    };
    draw();
};

// ── A. From Item Cost ──────────────────────────────────────────
FOM.addItemCost = function (E, p, add) {
    var rows = [], wh = E.hdr.warehouse;
    p.innerHTML = '<div class="row-btns" style="margin:8px 0"><select class="fom-in" data-m style="width:auto"><option value="ItemNumber">Item Number</option><option value="ItemDescription">Description</option></select><input class="fom-in" data-q placeholder="Starts with…" style="flex:1"><button class="btn primary" data-s><i class="fa-solid fa-magnifying-glass"></i> Search</button><input class="fom-in" data-f placeholder="Filter item / description" style="max-width:220px"></div><div data-st class="muted" style="font-size:.76rem"></div><div data-g></div>' +
        '<div class="row-btns" style="margin-top:8px"><span class="muted" data-sel style="font-size:.78rem"></span><span class="grow"></span><button class="btn primary" data-add disabled><i class="fa-solid fa-plus"></i> Add lines to order</button></div>';
    var q = function (s) { return p.querySelector(s); };
    var taxOpt = function (v) { return FOM.taxOpts(E.taxList, v); };
    function draw() {
        var f = q('[data-f]').value.toLowerCase(), v = rows.filter(function (r) { return !f || (r.item + ' ' + r.desc).toLowerCase().indexOf(f) >= 0; });
        q('[data-g]').innerHTML = FOM.table(v, [
            { th: '', html: function (r) { return '<input type="checkbox" data-ck="' + r.i + '"' + (r.sel ? ' checked' : '') + '>'; } }, { label: 'Item', html: function (r) { return '<span class="mono">' + esc(r.item) + '</span>'; } }, { label: 'Description', html: function (r) { return esc(r.desc); } }, { label: 'UOM', html: function (r) { return esc(r.uom); } }, { label: 'Lot', html: function (r) { return esc(r.vu.lot); } },
            { label: 'Item Cost', n: 1, html: function (r) { return r.cost != null ? FOM.amt(r.cost) : '—'; } }, { label: 'Costed QOH', n: 1, html: function (r) { return FOM.qty(r.costQoh); } },
            { label: 'Total QOH', n: 1, html: function (r) { return r.qoh == null ? '<i class="fa-solid fa-circle-notch fa-spin muted"></i>' : '<span title="' + esc((r.lots || []).join(', ')) + '">' + FOM.qty(r.qoh) + ' ' + (r.costQoh != null ? (r.qoh === r.costQoh ? '<i class="fa-solid fa-check" style="color:var(--ok)"></i>' : '<i class="fa-solid fa-xmark" style="color:var(--err)"></i>') : '') + '</span>'; } },
            { label: 'Un Costed', n: 1, html: function (r) { return r.qoh == null ? '' : FOM.qty(r.qoh - FOM.n(r.costQoh)); } },
            { label: 'Ord Qty', n: 1, html: function (r) { return '<input class="fom-in fom-num" type="number" min="0" step="any" data-qq="' + r.i + '" value="' + esc(r.qty || '') + '">'; } }, { label: 'Unit Price', n: 1, html: function (r) { return '<input class="fom-in fom-num" type="number" step="any" data-pp="' + r.i + '" value="' + esc(r.price) + '">'; } },
            { label: 'Total', n: 1, html: function (r) { return FOM.amt(r.qty * r.price); } }, { label: 'Margin', n: 1, html: function (r) { var m = (r.price - FOM.n(r.cost)) * r.qty, t = r.qty * r.price; return r.qty ? '<span style="color:' + (m < 0 ? 'var(--err)' : 'var(--ok)') + '">' + FOM.amt(m) + '</span> <span class="muted">' + (t ? (m / t * 100).toFixed(1) + '%' : '') + '</span>' : ''; } },
            { label: 'Tax Code', html: function (r) { return '<select class="fom-in" data-tt="' + r.i + '" style="width:auto">' + taxOpt(r.taxCode) + '</select>'; } }, { label: 'Tax', n: 1, html: function (r) { return FOM.amt(r.tax); } }, { label: 'Net', n: 1, html: function (r) { return FOM.amt(r.qty * r.price + r.tax); } },
            { label: 'Cost / Inv Org / Subinv', html: function (r) { return '<span class="muted" style="font-size:.7rem">' + esc([r.vu.costOrg, r.vu.invOrg, r.vu.subinv].join(' / ')) + '</span>'; } }
        ], { empty: rows.length ? 'No match for the filter.' : 'Search items by number or description.', maxH: 420 });
        var n = rows.filter(function (r) { return r.sel && r.qty > 0; }).length;
        q('[data-sel]').textContent = n ? n + ' line(s) selected' : ''; q('[data-add]').disabled = !n; q('[data-add]').innerHTML = '<i class="fa-solid fa-plus"></i> Add ' + n + ' line(s) to order';
    }
    function retax(r) { var t = E.taxList.filter(function (x) { return x.code === r.taxCode; })[0]; r.taxPct = t ? t.pct : 0; r.tax = FOM.r2(r.qty * r.price * r.taxPct / 100); }
    p.addEventListener('input', function (e) {
        var qi = e.target.getAttribute('data-qq'), pi = e.target.getAttribute('data-pp');
        if (qi != null) { var r = rows[+qi], v = FOM.n(e.target.value); if (r.qoh != null && v > r.qoh) { FX.toast('Cannot order more than on-hand (' + FOM.qty(r.qoh) + ')', 'err'); v = r.qoh; e.target.value = v; } r.qty = v; r.sel = v > 0; retax(r); }
        if (pi != null) { var r2 = rows[+pi]; r2.price = FOM.n(e.target.value); retax(r2); }
    });
    p.addEventListener('change', function (e) {
        var ck = e.target.getAttribute('data-ck'), tt = e.target.getAttribute('data-tt');
        if (ck != null) rows[+ck].sel = e.target.checked;
        if (tt != null) { rows[+tt].taxCode = e.target.value; retax(rows[+tt]); }
        if (ck != null || tt != null || e.target.getAttribute('data-qq') != null || e.target.getAttribute('data-pp') != null) draw();
    });
    q('[data-f]').oninput = draw;
    function go() {
        var t = q('[data-q]').value.trim(); if (!t) { FX.toast('Enter an item number or description', 'err'); return; }
        q('[data-st]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Searching items…'; rows = []; draw();
        FOM.all('itemsV2', { q: q('[data-m]').value + " LIKE '" + t.replace(/'/g, "''") + "%'" + (wh ? ';OrganizationCode=' + wh : ''), limit: 100 }, 300).then(function (items) {
            q('[data-st]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Reading item costs for ' + items.length + ' item(s)…';
            return FOM.mapLimit(items, 5, function (it) {
                return FX.get('itemCosts', { version: 'latest', q: 'ItemNumber=' + FOM.qv(it.ItemNumber), limit: 500 }).then(function (j) {
                    var cr = (j.items || []).map(function (r) { return Object.assign({ _vu: FOM.parseVU(r.ValuationUnit) }, r); }).filter(function (r) { return !wh || r._vu.invOrg === wh || r._vu.costOrg === wh; });
                    return (cr.length ? cr : [null]).map(function (c) { return { it: it, c: c }; });
                }).catch(function () { return [{ it: it, c: null }]; });
            });
        }).then(function (ch) {
            var def = E.taxList.filter(function (x) { return x.code === E.defTax; })[0];
            rows = [].concat.apply([], ch.filter(Array.isArray)).map(function (x, i) {
                var c = x.c || {}, vu = x.c ? x.c._vu : { costOrg: '', invOrg: wh || '', subinv: '', lot: '' }, cost = x.c ? FOM.costOf(c) : null;
                return { i: i, item: x.it.ItemNumber, desc: x.it.ItemDescription || '', uom: FOM.uomOf(x.it) || '', vu: vu, cost: cost, costQoh: x.c ? FOM.num(FOM.pf(c, ['Quantity', 'OnhandQuantity', 'OnHandQuantity', 'TotalQuantity', 'ItemQuantity', 'CostQuantity', 'QuantityOnhand'])) : null, qoh: null, qty: 0, price: cost || 0, taxCode: def ? def.code : '', taxPct: def ? def.pct : 0, tax: 0, sel: false };
            });
            q('[data-st]').textContent = rows.length + ' row(s) — reading on-hand…'; draw();
            return FOM.mapLimit(rows, 3, function (r) {
                var org = wh || r.vu.invOrg; if (!org) { r.qoh = 0; return; }
                return FOM.all('inventoryOnhandBalances', { q: FOM.onhandQ(org, r.item, E.hdr.subinventory || r.vu.subinv), expand: 'lots', limit: 500 }, 2000).then(function (bal) {
                    var lots = [], tot = 0;
                    bal.forEach(function (b) { if ((b.lots || []).length) b.lots.forEach(function (l) { if (lots.indexOf(l.LotNumber) < 0) lots.push(l.LotNumber); if (!r.vu.lot || l.LotNumber === r.vu.lot) tot += FOM.n(FOM.pf(l, ['PrimaryQuantity', 'QuantityOnhand', 'OnhandQuantity', 'Quantity', 'LotQuantity'])); }); else tot += FOM.ohQty(b); });
                    r.qoh = tot; r.lots = lots;
                }).catch(function () { r.qoh = 0; });
            }).then(function () { q('[data-st]').textContent = rows.length + ' row(s) for ' + FOM.distinct(rows.map(function (r) { return r.item; })).length + ' item(s)' + (wh ? ' in ' + wh : ''); draw(); });
        }).catch(function (e) { q('[data-st]').innerHTML = '<span style="color:var(--err)">' + esc(FOM.emsg(e)) + '</span>'; });
    }
    q('[data-s]').onclick = go; q('[data-q]').onkeydown = function (e) { if (e.key === 'Enter') go(); };
    q('[data-add]').onclick = function () {
        add(rows.filter(function (r) { return r.sel && r.qty > 0; }).map(function (r) { return { ItemNumber: r.item, ItemDescription: r.desc, PrimaryUOMValue: r.uom, _cost: r.cost, _qty: r.qty, _price: r.price, _taxCode: r.taxCode, _taxPct: r.taxPct, _tax: r.tax, _lot: r.vu.lot, _lots: r.lots || [], _costOrg: r.vu.costOrg, _invOrg: r.vu.invOrg, _subinv: r.vu.subinv, _qoh: r.qoh }; }));
    };
    draw();
};

// ── B. From Price List ─────────────────────────────────────────
FOM.priceListItems = function (id, onPage) {
    var all = [], pages = 0;
    function page(off) {
        return FX.get('priceLists/' + id + '/child/items', { expand: 'charges', limit: 100, offset: off }).then(function (j) {
            all = all.concat(j.items || []); pages++; if (onPage) onPage(all.length);
            if (j.hasMore && pages < 15 && (j.items || []).length) return page(off + 100);
            all.truncated = !!j.hasMore && pages >= 15;
        });
    }
    return page(0).then(function () { return all; });
};
FOM.plPrice = function (it) { var c = (it.charges || []).filter(function (x) { return FOM.pf(x, ['BasePrice', 'CalculationAmount', 'ListPrice']) != null; })[0]; return c ? FOM.num(FOM.pf(c, ['BasePrice', 'CalculationAmount', 'ListPrice'])) : null; };
FOM.addPriceList = function (E, p, add) {
    var lists = [], items = [], plId = null;
    p.innerHTML = '<div class="row-btns" style="margin:8px 0"><select class="fom-in" data-m style="width:auto"><option value="PriceListNumber">Price List Number</option><option value="Name">Description</option></select><input class="fom-in" data-q placeholder="Price list (blank = all)" style="flex:1"><button class="btn primary" data-s><i class="fa-solid fa-magnifying-glass"></i> Search</button><select class="fom-in" data-pl style="max-width:340px"><option value="">— choose a list —</option></select></div><div data-st class="muted" style="font-size:.76rem"></div><input class="fom-in" data-f placeholder="Filter items" style="max-width:240px;margin:6px 0"><div data-g></div><div class="row-btns" style="margin-top:8px"><span class="grow"></span><button class="btn primary" data-stage disabled>Stage for preview</button></div><div data-prev></div>';
    var q = function (s) { return p.querySelector(s); };
    function go() {
        var t = q('[data-q]').value.trim(); q('[data-st]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Reading price lists…';
        FX.get('priceLists', { q: t ? q('[data-m]').value + '=' + FOM.qv(t) : null, limit: 500 }).then(function (j) {
            lists = j.items || [];
            q('[data-pl]').innerHTML = '<option value="">— choose a list (' + lists.length + ') —</option>' + lists.map(function (l, i) { return '<option value="' + i + '">' + esc((l.Name || l.PriceListName || l.PriceListNumber) + ' — ' + (l.CurrencyCode || l.Currency || '') + ' · ' + (l.StatusCode || l.Status || '')) + '</option>'; }).join('');
            q('[data-st]').textContent = lists.length + ' price list(s)'; if (lists.length === 1) { q('[data-pl]').value = '0'; pick(); }
        }).catch(function (e) { q('[data-st]').innerHTML = '<span style="color:var(--err)">' + esc(FOM.emsg(e)) + '</span>'; });
    }
    function draw() {
        var f = q('[data-f]').value.toLowerCase(), v = items.filter(function (it) { return !f || JSON.stringify([it._item, it._desc]).toLowerCase().indexOf(f) >= 0; });
        q('[data-g]').innerHTML = FOM.table(v, [{ th: '', html: function (it) { return '<input type="checkbox" data-ck="' + it._i + '"' + (it._sel ? ' checked' : '') + '>'; } }, { label: 'Item', html: function (it) { return '<span class="mono">' + esc(it._item) + '</span>'; } }, { label: 'Description', html: function (it) { return esc(it._desc); } }, { label: 'Line Type', html: function (it) { return esc(it.LineType || ''); } }, { label: 'UOM', html: function (it) { return esc(FOM.pf(it, ['PricingUOMCode', 'PrimaryUOMCode', 'UOMCode']) || ''); } }, { label: 'List Price', n: 1, html: function (it) { return it._price != null ? FOM.amt(it._price) : '—'; } }, { label: 'Order Qty', n: 1, html: function (it) { return '<input class="fom-in fom-num" type="number" min="0" step="any" data-qq="' + it._i + '" value="' + esc(it._qty || '') + '">'; } }], { empty: plId ? 'No items on this list.' : 'Choose a price list.', maxH: 360 });
        var n = items.filter(function (it) { return it._sel; }).length; q('[data-stage]').disabled = !n; q('[data-stage]').textContent = 'Stage ' + n + ' for preview';
    }
    function pick() {
        var l = lists[+q('[data-pl]').value]; if (!l) return; plId = l.PriceListId; p.plCcy = l.CurrencyCode || l.Currency;
        if (p.plCcy && E.ccy() && p.plCcy !== E.ccy()) FX.toast('Price list currency ' + p.plCcy + ' differs from the order currency ' + E.ccy(), 'err');
        q('[data-st]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Reading items…';
        FOM.priceListItems(plId, function (n) { q('[data-st]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> ' + n + ' items…'; }).then(function (r) {
            items = r.map(function (it, i) { return Object.assign(it, { _i: i, _item: FOM.pf(it, ['Item', 'ItemNumber', 'ProductNumber']), _desc: FOM.pf(it, ['Description', 'ItemDescription', 'ProductDescription']) || '', _price: FOM.plPrice(it) }); });
            q('[data-st]').textContent = items.length + ' item(s)' + (r.truncated ? ' — first 1,500 only, narrow the list in Fusion for more' : ''); draw();
        }).catch(function (e) { q('[data-st]').innerHTML = '<span style="color:var(--err)">' + esc(FOM.emsg(e)) + '</span>'; });
    }
    p.addEventListener('input', function (e) { var qi = e.target.getAttribute('data-qq'); if (qi != null) { var it = items[+qi]; it._qty = FOM.n(e.target.value); it._sel = it._qty > 0; var ck = p.querySelector('[data-ck="' + qi + '"]'); if (ck) ck.checked = it._sel; var n = items.filter(function (x) { return x._sel; }).length; q('[data-stage]').disabled = !n; q('[data-stage]').textContent = 'Stage ' + n + ' for preview'; } });
    p.addEventListener('change', function (e) { var ck = e.target.getAttribute('data-ck'); if (ck != null) { items[+ck]._sel = e.target.checked; draw(); } });
    q('[data-s]').onclick = go; q('[data-q]').onkeydown = function (e) { if (e.key === 'Enter') go(); }; q('[data-pl]').onchange = pick; q('[data-f]').oninput = draw;
    q('[data-stage]').onclick = function () {
        var st = items.filter(function (it) { return it._sel; }).map(function (it) { return { ItemNumber: it._item, ItemDescription: it._desc, PrimaryUOMValue: FOM.pf(it, ['PricingUOMCode', 'PrimaryUOMCode', 'UOMCode']), _qty: it._qty || 1, _price: it._price || 0 }; });
        FOM.staged(E, q('[data-prev]'), st, add, { source: 'priceList', priceListId: plId, onReset: function () { q('[data-prev]').innerHTML = ''; } });
    };
    go();
};

// ── C. On-hand ─────────────────────────────────────────────────
FOM.addOnhand = function (E, p, add) {
    var wh = E.hdr.warehouse, rows = [];
    if (!wh) { p.innerHTML = '<div class="note warn" style="margin-top:8px">Pick a warehouse on the header first.</div>'; return; }
    p.innerHTML = '<div class="row-btns" style="margin:8px 0"><select class="fom-in" data-m style="width:auto"><option value="item">Item Number</option><option value="desc">Description</option></select><input class="fom-in" data-q placeholder="Starts with…" style="flex:1"><button class="btn primary" data-s><i class="fa-solid fa-magnifying-glass"></i> Search</button><input class="fom-in" data-f placeholder="Filter item / desc / subinv" style="max-width:220px"></div><div data-st class="muted" style="font-size:.76rem"></div><div data-g></div><div class="row-btns" style="margin-top:8px"><span class="grow"></span><button class="btn primary" data-stage disabled>Stage for preview</button></div><div data-prev></div>';
    var q = function (s) { return p.querySelector(s); }, sub = E.hdr.subinventory;
    var base = 'OrganizationCode=' + wh + (sub ? ';SubinventoryCode=' + FOM.qv(sub) : '');
    function draw() {
        var f = q('[data-f]').value.toLowerCase(), v = rows.filter(function (r) { return !f || (r.item + ' ' + r.desc + ' ' + r.sub).toLowerCase().indexOf(f) >= 0; });
        q('[data-g]').innerHTML = FOM.table(v, [{ th: '', html: function (r) { return '<input type="checkbox" data-ck="' + r.i + '"' + (r.sel ? ' checked' : '') + '>'; } }, { label: 'Item', html: function (r) { return '<span class="mono">' + esc(r.item) + '</span>'; } }, { label: 'Description', html: function (r) { return esc(r.desc); } }, { label: 'UOM', html: function (r) { return esc(r.uom); } }, { label: 'Subinventory', html: function (r) { return esc(r.sub); } }, { label: 'Total QOH', n: 1, html: function (r) { return FOM.qty(r.qty); } }, { label: 'Order Qty', n: 1, html: function (r) { return '<input class="fom-in fom-num" type="number" min="0" step="any" data-qq="' + r.i + '" value="' + esc(r.oq || '') + '">'; } }], { empty: 'Search on-hand by item number or description.', maxH: 380 });
        var n = rows.filter(function (r) { return r.sel; }).length; q('[data-stage]').disabled = !n; q('[data-stage]').textContent = 'Stage ' + n + ' for preview';
    }
    function go() {
        var t = q('[data-q]').value.trim().replace(/'/g, "''"); if (!t) { FX.toast('Enter a search term', 'err'); return; }
        q('[data-st]').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Reading on-hand…';
        var job = q('[data-m]').value === 'item' ? FX.get('inventoryOnhandBalances', { q: base + ";ItemNumber LIKE '" + t + "%'", expand: 'lots', limit: 100 }).then(function (j) { return j.items || []; })
            : FX.get('itemCosts', { version: 'latest', q: "ItemDescription LIKE '" + t + "%'", limit: 100 }).then(function (j) { var its = FOM.distinct((j.items || []).map(function (x) { return x.ItemNumber || x.Item; })); return FOM.mapLimit(its, 4, function (it) { return FX.get('inventoryOnhandBalances', { q: base + ';ItemNumber=' + FOM.qv(it), expand: 'lots', limit: 100 }).then(function (j2) { return j2.items || []; }); }).then(function (ch) { return [].concat.apply([], ch.filter(Array.isArray)); }); });
        job.then(function (bal) {
            var g = {};
            bal.forEach(function (b) { var k = b.ItemNumber + '|' + (b.SubinventoryCode || ''); if (!g[k]) g[k] = { item: b.ItemNumber, sub: b.SubinventoryCode || '', qty: 0, desc: b.ItemDescription || '', uom: b.PrimaryUOMCode || b.UOMCode || '' }; g[k].qty += FOM.ohQty(b); });
            rows = Object.keys(g).map(function (k, i) { return Object.assign(g[k], { i: i }); });
            draw(); q('[data-st]').textContent = rows.length + ' item / subinventory row(s) — reading descriptions…';
            return FOM.mapLimit(FOM.distinct(rows.map(function (r) { return r.item; })), 4, function (it) { return FX.get('itemCosts', { version: 'latest', q: 'ItemNumber=' + FOM.qv(it), limit: 1 }).then(function (j) { var c = (j.items || [])[0] || {}; rows.forEach(function (r) { if (r.item === it) { r.desc = r.desc || c.ItemDescription || ''; r.uom = r.uom || c.UOMName || c.UOMCode || ''; } }); }).catch(function () { }); }).then(function () { q('[data-st]').textContent = rows.length + ' row(s) in ' + wh + (sub ? ' / ' + sub : ''); draw(); });
        }).catch(function (e) { q('[data-st]').innerHTML = '<span style="color:var(--err)">' + esc(FOM.emsg(e)) + '</span>'; });
    }
    p.addEventListener('input', function (e) { var qi = e.target.getAttribute('data-qq'); if (qi != null) { var r = rows[+qi]; r.oq = FOM.n(e.target.value); r.sel = r.oq > 0; var ck = p.querySelector('[data-ck="' + qi + '"]'); if (ck) ck.checked = r.sel; var n = rows.filter(function (x) { return x.sel; }).length; q('[data-stage]').disabled = !n; q('[data-stage]').textContent = 'Stage ' + n + ' for preview'; } });
    p.addEventListener('change', function (e) { var ck = e.target.getAttribute('data-ck'); if (ck != null) { rows[+ck].sel = e.target.checked; draw(); } });
    q('[data-s]').onclick = go; q('[data-q]').onkeydown = function (e) { if (e.key === 'Enter') go(); }; q('[data-f]').oninput = draw;
    q('[data-stage]').onclick = function () { FOM.staged(E, q('[data-prev]'), rows.filter(function (r) { return r.sel; }).map(function (r) { return { ItemNumber: r.item, ItemDescription: r.desc, PrimaryUOMValue: r.uom, _qty: r.oq || 1, _price: 0, _qoh: r.qty, _subinv: r.sub }; }), add, { onReset: function () { q('[data-prev]').innerHTML = ''; } }); };
    draw();
};

// ── D. Excel / CSV and E. paste ────────────────────────────────
FOM.guessCols = function (head) {
    var find = function (re) { for (var i = 0; i < head.length; i++) if (re.test(String(head[i] || '').toLowerCase().replace(/[\s_.#-]/g, ''))) return i; return -1; };
    return { item: find(/item|sku|product|partno|code/), qty: find(/qty|quantity|ordered/), price: find(/unitprice|price|rate|amount/), desc: find(/desc|name|particular/) };
};
FOM.gridToRows = function (grid, hdrRow, map) {
    var out = [];
    grid.slice(hdrRow).forEach(function (r) {
        var it = map.item >= 0 ? String(r[map.item] == null ? '' : r[map.item]).trim() : ''; if (!it) return;
        var q = map.qty >= 0 ? FOM.num(String(r[map.qty] == null ? '' : r[map.qty]).replace(/,/g, '')) : null, pr = map.price >= 0 ? FOM.num(String(r[map.price] == null ? '' : r[map.price]).replace(/[^\d.\-]/g, '')) : null;
        out.push({ ItemNumber: it, ItemDescription: map.desc >= 0 ? String(r[map.desc] || '') : '', _qty: q || 1, _price: pr || 0 });
    });
    return out;
};
FOM.mapper = function (el, grid, hasHeader, onBuild) {
    var head = hasHeader ? grid[0] || [] : (grid[0] || []).map(function (c, i) { return 'Column ' + (i + 1); }), map = hasHeader ? FOM.guessCols(head) : { item: 0, qty: 1, price: 2, desc: -1 };
    var ncol = Math.max.apply(null, grid.slice(0, 50).map(function (r) { return r.length; }).concat([1]));
    var cols = []; for (var i = 0; i < ncol; i++) cols.push({ v: String(i), t: (hasHeader ? head[i] || '' : 'Column ' + (i + 1)) + ' (' + String.fromCharCode(65 + (i % 26)) + ')' });
    var sel = function (k, lab) { return '<label class="fom-lab">' + lab + '<select class="fom-in" data-map="' + k + '"><option value="-1">—</option>' + FOM.opts(cols, map[k] >= 0 ? String(map[k]) : '') + '</select></label>'; };
    el.innerHTML = '<div class="row-btns" style="align-items:flex-end;margin:8px 0">' + sel('item', 'Item *') + sel('qty', 'Qty') + sel('price', 'Price') + sel('desc', 'Description') + '<span class="grow"></span><button class="btn primary" data-build>Build preview</button></div>' +
        '<div class="fom-tw" style="max-height:220px">' + FOM.table(grid.slice(0, 30), cols.map(function (c, i) { return { label: c.t, html: function (r) { return esc(r[i] == null ? '' : r[i]); } }; })) + '</div><div class="muted" style="font-size:.72rem">First 30 rows shown.</div>';
    el.querySelector('[data-build]').onclick = function () {
        el.querySelectorAll('[data-map]').forEach(function (s) { map[s.getAttribute('data-map')] = +s.value; });
        if (map.item < 0) { FX.toast('Map the Item column', 'err'); return; }
        onBuild(FOM.gridToRows(grid, hasHeader ? 1 : 0, map));
    };
    return map;
};
FOM.addExcel = function (E, p, add) {
    p.innerHTML = '<div class="fom-drop" data-drop><i class="fa-solid fa-file-excel"></i><b>Drop an Excel or CSV file</b><span>or <label class="fom-a">browse<input type="file" accept=".xlsx,.xls,.csv,.txt" data-file hidden></label> — the first sheet is read. PDF: copy its text and use Copy-Paste.</span></div><div class="row-btns" data-hr hidden style="margin-top:8px"><label class="fom-chk">Header row <input class="fom-in" type="number" min="1" value="1" data-h style="width:70px"></label><span class="muted" data-fn style="font-size:.76rem"></span></div><div data-map></div><div data-prev></div>';
    var grid = null, q = function (s) { return p.querySelector(s); };
    function build() { var h = Math.max(1, +q('[data-h]').value || 1); FOM.mapper(q('[data-map]'), grid.slice(h - 1), true, function (rows) { FOM.staged(E, q('[data-prev]'), rows, add, { onReset: function () { q('[data-prev]').innerHTML = ''; } }); }); }
    function read(f) {
        if (!window.XLSX) { FX.toast('Excel reader (SheetJS) is not loaded', 'err'); return; }
        var r = new FileReader();
        r.onload = function () { try { var wb = XLSX.read(new Uint8Array(r.result), { type: 'array' }), ws = wb.Sheets[wb.SheetNames[0]]; grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }).filter(function (x) { return x.some(function (c) { return String(c).trim(); }); }); q('[data-hr]').hidden = false; q('[data-fn]').textContent = f.name + ' · ' + wb.SheetNames[0] + ' · ' + grid.length + ' rows'; build(); } catch (e) { FX.toast('Could not read the file: ' + e.message, 'err'); } };
        r.readAsArrayBuffer(f);
    }
    q('[data-file]').onchange = function () { if (this.files[0]) read(this.files[0]); };
    q('[data-h]').onchange = function () { if (grid) build(); };
    var dz = q('[data-drop]');
    dz.ondragover = function (e) { e.preventDefault(); dz.classList.add('on'); }; dz.ondragleave = function () { dz.classList.remove('on'); };
    dz.ondrop = function (e) { e.preventDefault(); dz.classList.remove('on'); if (e.dataTransfer.files[0]) read(e.dataTransfer.files[0]); };
};
FOM.parsePaste = function (text) {
    var lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.trim(); }); if (!lines.length) return { grid: [], header: false };
    var f = lines[0], split = /\t/.test(f) ? function (l) { return l.split('\t'); } : /,/.test(f) ? function (l) { return l.split(','); } : / {2,}/.test(f) ? function (l) { return l.trim().split(/ {2,}/); } : function (l) { return l.trim().split(/\s+/); };
    var grid = lines.map(function (l) { return split(l).map(function (c) { return c.trim(); }); });
    return { grid: grid, header: /item|qty|price|desc|product|sku/i.test(f) };
};
FOM.addPaste = function (E, p, add) {
    p.innerHTML = '<div class="form" style="margin-top:8px"><label class="wide">Paste rows (Item, Qty, Price — tab, comma or spaces)<textarea rows="7" data-t placeholder="Item&#9;Qty&#9;Price&#10;SM-A057FZKGAFB&#9;2&#9;95.22"></textarea></label></div><label class="fom-chk" style="margin:6px 0"><input type="checkbox" data-h> First row is a header</label><div data-map></div><div data-prev></div>';
    var q = function (s) { return p.querySelector(s); }, timer;
    function build(auto) {
        var r = FOM.parsePaste(q('[data-t]').value); if (auto) q('[data-h]').checked = r.header;
        if (!r.grid.length) { q('[data-map]').innerHTML = ''; q('[data-prev]').innerHTML = ''; return; }
        var hdr = q('[data-h]').checked, map = FOM.mapper(q('[data-map]'), r.grid, hdr, function (rows) { FOM.staged(E, q('[data-prev]'), rows, add, { onReset: function () { q('[data-prev]').innerHTML = ''; } }); });
        if (map.item >= 0) FOM.staged(E, q('[data-prev]'), FOM.gridToRows(r.grid, hdr ? 1 : 0, map), add, { onReset: function () { q('[data-prev]').innerHTML = ''; } });
    }
    q('[data-t]').oninput = function () { clearTimeout(timer); timer = setTimeout(function () { build(true); }, 400); };
    q('[data-h]').onchange = function () { build(false); };
};
