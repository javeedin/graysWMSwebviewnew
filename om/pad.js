/* Order Management — Order Pad.
   Customer (F7) → order header → lines (scan / type / F6 / smart paste / usual items / price list) → live checks
   (credit, stock, period, customer PO, reference) → verdict → Save / Ask for approval / Fusion draft / Submit. */

var PAD = {
    inited: false, order: null, sel: -1, mode: 'ORD', price: null, custRules: [], live: {}, res: null,
    otypes: [], reasons: [], liveTimer: null, stockAt: {}, saving: false, lookErr: {}
};

function padUid() { return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function padCtx() { var g = omGen(), ot = PAD.order.orderTypeAttrs || {}; return { precision: g.precision, taxRates: g.taxRates, taxOff: omUp(ot.TAX) === 'NO' }; }
function padH() { return PAD.order.header; }
function padHash() {
    var h = padH();
    return JSON.stringify([h.customerNumber, h.orderType, h.priceList, PAD.order.lines.map(function (l) { return [l.item, l.type, +l.qty, +l.price, +l.discCust, +l.discMkt, +l.discAdd, l.fixedSell]; })]);
}

// ── open / new / load ─────────────────────────────────────────
function padOpen() {
    if (!PAD.inited) padWire();
    if (!PAD.order) {
        var saved = lsGet('om_pad_' + OM.instance, null);
        if (saved && saved.header && saved.header.bu === (OM.bu && OM.bu.name) && (saved.lines || []).length) { PAD.order = saved; toast('Your unsaved order was restored.'); }
        else padNewOrder(true);
        padLoadLookups().then(function () { padFillHeader(); padReloadPrices(false); });
    }
    padRender();
}
function padNewOrder(silent) {
    var bu = OM.bu || {}, me = OM.me || {};
    PAD.order = {
        id: null, status: 'DRAFT', lines: [], orderTypeAttrs: {},
        header: { bu: bu.name, orderNo: '', orderDate: today(), pricingDate: today(), warehouse: me.WAREHOUSE || bu.warehouse || '', orgId: bu.orgId, subinventory: me.SUBINVENTORY || bu.subinventory || '',
            currency: bu.currency || 'MUR', salesrep: me.SALESREP_NAME || '', salesrepId: me.SALESREP_ID || '', priceList: me.PRICE_LIST || '' }
    };
    PAD.live = {}; PAD.custRules = []; PAD.sel = -1; PAD.stockAt = {};
    padSaveLocal();
    if (!silent) { padFillHeader(); padRender(); $('cust-q').focus(); }
}
function padBuChanged() {
    PAD.order = null; PAD.price = null;
    if (!$('page-pad').hidden) padOpen();
}
/** Open a stored or prepared order in the pad (from Orders: edit, copy, credit note). */
function padLoad(order) {
    PAD.order = order; PAD.live = {}; PAD.sel = -1; PAD.stockAt = {};
    if (order.header.bu && (!OM.bu || OM.bu.name !== order.header.bu) && omBuByName(order.header.bu)) omSetBu(omBuByName(order.header.bu));
    omShowTab('pad');
    padLoadLookups().then(function () {
        padFillHeader(); padCustRules();
        return padReloadPrices(false);
    }).then(function () { padRender(); padScheduleLive(10); });
    padRender();
}
function padSaveLocal() { if (PAD.order && !PAD.order.id) lsSet('om_pad_' + OM.instance, PAD.order); }
function padReadOnly() { var s = PAD.order.status; return s === 'SUBMITTED' || s === 'FUSION_DRAFT' || s === 'DISCARDED'; }

// ── lookups ────────────────────────────────────────────────────
function padLoadLookups() {
    var jobs = {
        orderTypes: omLookup('orderTypes').then(function (r) { PAD.otypes = r.map(omNormOrderType); }),
        priceLists: omLookup('priceLists').then(function (r) { PAD.plists = r.map(function (x) { return omNamed('priceLists', x, 'name', ['PRICE_LIST_NAME', 'NAME', 'PRICE_LIST']); }).filter(Boolean); }),
        warehouses: omLookup('warehouses').then(function (r) {
            PAD.whs = r.map(function (x) { return { code: omNamed('warehouses', x, 'code', ['ORGANIZATION_CODE', 'ORG_CODE', 'CODE']), name: omNamed('warehouses', x, 'name', ['ORGANIZATION_NAME', 'NAME', 'WAREHOUSE']), id: omNamed('warehouses', x, 'id', ['ORGANIZATION_ID', 'ORG_ID']) }; });
        }),
        salesreps: omLookup('salesreps').then(function (r) { PAD.reps = r.map(function (x) { return { name: omNamed('salesreps', x, 'name', ['SALESREP_NAME', 'RESOURCE_NAME', 'NAME', 'PARTY_NAME']), id: omNamed('salesreps', x, 'id', ['SALESREP_ID', 'RESOURCE_ID', 'PARTY_ID', 'ID']), number: omNamed('salesreps', x, 'number', ['SALESREP_NUMBER', 'NUMBER', 'PERSON_NUMBER']) }; }).filter(function (x) { return x.name; }); }),
        officers: omLookup('officers').then(function (r) { PAD.officers = r.map(function (x) { return { name: omNamed('officers', x, 'name', ['NAME', 'OFFICER_NAME', 'FULL_NAME', 'MEANING']), number: omNamed('officers', x, 'number', ['NUMBER', 'OFFICER_NO', 'LOOKUP_CODE', 'CODE']) }; }).filter(function (x) { return x.name; }); }),
        returnReasons: omLookup('returnReasons').then(function (r) { PAD.reasons = r.map(function (x) { return { code: omNamed('returnReasons', x, 'code', ['LOOKUP_CODE', 'CODE', 'REASON_CODE']), name: omNamed('returnReasons', x, 'name', ['MEANING', 'DESCRIPTION', 'NAME', 'REASON']) }; }).filter(function (x) { return x.code; }); }),
        rules: omLoadRules().then(function () { padCustRules(); })
    };
    PAD.lookErr = {};
    return Promise.all(Object.keys(jobs).map(function (k) { return jobs[k].catch(function (e) { PAD.lookErr[k] = String(e); console.warn('[OM] lookup ' + k, e); }); }))
        .then(function () { padShowLookErr(); });
}
function padShowLookErr() {
    var ks = Object.keys(PAD.lookErr);
    if (!ks.length) return;
    toast('Could not load: ' + ks.map(function (k) { return (omSrc(k) || {}).label || k; }).join(', ') + ' — check Setup › Lookup sources.', 'err');
}
function padOpts(sel, list, val, blank) {
    var h = blank ? '<option value="">' + blank + '</option>' : '';
    var found = false;
    list.forEach(function (o) { var v = typeof o === 'string' ? o : o.v, t = typeof o === 'string' ? o : o.t; if (v === val) found = true; h += '<option value="' + esc(v) + '"' + (v === val ? ' selected' : '') + '>' + esc(t) + '</option>'; });
    if (val && !found) h += '<option value="' + esc(val) + '" selected>' + esc(val) + '</option>';
    $(sel).innerHTML = h;
}
function padFillHeader() {
    var h = padH(), bu = OM.bu || {};
    padOpts('h-otype', PAD.otypes.map(function (o) { return { v: o.NAME, t: o.NAME }; }), h.orderType, 'Choose…');
    padOpts('h-plist', (PAD.plists || []), h.priceList, 'Choose…');
    var whs = (PAD.whs || []).map(function (w) { return { v: w.name || w.code, t: (w.code ? w.code + ' · ' : '') + (w.name || '') }; });
    if (!whs.length && bu.warehouse) whs = [{ v: bu.warehouse, t: bu.warehouse }];
    padOpts('h-wh', whs, h.warehouse, 'Choose…');
    padOpts('h-sub', omCsv(String(bu.subinventories || bu.subinventory || '').split(',')), h.subinventory, '');
    padOpts('h-rep', (PAD.reps || []).map(function (r) { return { v: r.name, t: r.name }; }), h.salesrep, '—');
    padOpts('h-do', (PAD.officers || []).map(function (r) { return { v: r.name, t: r.name + (r.number ? ' (' + r.number + ')' : '') }; }), h.deliveryOfficer, '—');
    $('h-pdate').value = h.pricingDate || today(); $('h-odate').value = h.orderDate || today();
    $('h-po').value = h.customerPo || ''; $('h-ref').value = h.reference || ''; $('h-ship').value = h.shipDate || '';
    $('h-terms').value = h.paymentTerms || ''; $('h-comments').value = h.comments || '';
    $('cust-q').value = h.customerName ? h.customerName : '';
    padRenderCustomer();
}
function padReadHeader() {
    var h = padH();
    h.orderType = $('h-otype').value; h.priceList = $('h-plist').value; h.pricingDate = $('h-pdate').value; h.orderDate = $('h-odate').value;
    h.warehouse = $('h-wh').value; h.subinventory = $('h-sub').value; h.salesrep = $('h-rep').value; h.deliveryOfficer = $('h-do').value;
    h.customerPo = $('h-po').value.trim(); h.reference = $('h-ref').value.trim(); h.shipDate = $('h-ship').value; h.paymentTerms = $('h-terms').value.trim(); h.comments = $('h-comments').value;
    var ot = PAD.otypes.filter(function (o) { return o.NAME === h.orderType; })[0];
    PAD.order.orderTypeAttrs = ot || PAD.order.orderTypeAttrs || {};
    h.orderTypeCode = ot ? ot.CODE : h.orderTypeCode;
    var rep = (PAD.reps || []).filter(function (r) { return r.name === h.salesrep; })[0]; h.salesrepId = rep ? rep.id : h.salesrepId; h.salesrepNumber = rep ? rep.number : h.salesrepNumber;
    var dof = (PAD.officers || []).filter(function (r) { return r.name === h.deliveryOfficer; })[0]; h.deliveryOfficerNo = dof ? dof.number : h.deliveryOfficerNo;
    var wh = (PAD.whs || []).filter(function (w) { return (w.name || w.code) === h.warehouse; })[0]; if (wh && wh.id) h.orgId = wh.id; h.warehouseCode = wh ? wh.code : h.warehouseCode;
}

// ── customer ───────────────────────────────────────────────────
var _custTimer = null, _custSeq = 0;
function padCustSearch() {
    var q = $('cust-q').value.trim(), list = $('cust-list');
    clearTimeout(_custTimer);
    if (q.length < 2) { list.hidden = true; return; }
    _custTimer = setTimeout(function () {
        var seq = ++_custSeq, num = /^\d+$/.test(q);
        list.hidden = false; list.innerHTML = '<div class="ta-msg"><i class="fa-solid fa-circle-notch fa-spin"></i> Searching Fusion…</div>';
        omRunSource('customers', { Q: q, Q_NAME: num ? '' : q, Q_NUMBER: num ? q : '' }).then(function (rows) {
            if (seq !== _custSeq) return;
            var cs = rows.map(omNormCustomer).filter(function (c) { return c.number || c.name; });
            var lq = q.toLowerCase();
            cs.sort(function (a, b) { return (b.name.toLowerCase().indexOf(lq) === 0) - (a.name.toLowerCase().indexOf(lq) === 0) || a.name.localeCompare(b.name); });
            PAD.custHits = cs.slice(0, 60);
            list.innerHTML = PAD.custHits.length ? PAD.custHits.map(function (c, i) {
                return '<div class="ta-item" data-i="' + i + '"><span class="code">' + esc(c.number) + '</span><span class="t">' + esc(c.name) + '</span><span class="r">' + esc([c.category, c.class].filter(Boolean).join(' · ')) + '</span></div>';
            }).join('') : '<div class="ta-msg">No customer matches "' + esc(q) + '".</div>';
            PAD.custIdx = -1;
        }).catch(function (e) { if (seq === _custSeq) list.innerHTML = '<div class="ta-msg" style="color:var(--err)">' + esc(e) + '</div>'; });
    }, 350);
}
function padSetCustomer(c) {
    var h = padH();
    $('cust-list').hidden = true;
    Object.assign(h, { customerNumber: c.number, customerName: c.name, custAccountId: c.accountId, partyId: c.partyId, partyNumber: c.partyNumber, billSiteUseId: c.siteUseId,
        shipPartySiteId: c.partySiteId, customerClass: c.class, customerCategory: c.category, creditLimit: c.creditLimit, vat: c.vat, brn: c.brn, consignment: c.consignment, address: c.address });
    h.paymentTerms = c.terms ? (/^GR/i.test(c.terms) || isNaN(c.terms) ? c.terms : 'GR' + c.terms) : h.paymentTerms;
    var pm = omGen().creditPaymentMethods || {};
    h.paymentMethod = c.creditLimit > 0 ? 'CREDIT' : 'CASH'; h.paymentMethodCode = c.creditLimit > 0 ? pm.credit : pm.cash;
    if (c.priceList) h.priceList = c.priceList;
    $('cust-q').value = c.name;
    PAD.live.credit = null; PAD.live.dupPo = null;
    PAD.order.lines.forEach(function (l) { l.noCons = omUp(h.consignment) === 'NO' || omUp(h.consignment) === 'N'; });
    padCustRules();
    padFillHeader();
    if (c.priceList) padReloadPrices(false);
    padChanged(true);
    $('item-q').focus();
}
function padCustRules() {
    var h = padH();
    PAD.custRules = h.customerNumber && OM.rules ? omRulesForCustomer(OM.rules, { number: h.customerNumber, category: h.customerCategory }) : [];
}
function padRenderCustomer() {
    var h = padH(), box = $('cust-info');
    $('ord-no').textContent = h.orderNo ? h.orderNo : 'New order';
    if (!h.customerNumber) { box.innerHTML = '<div class="muted">No customer yet.</div>'; return; }
    var cr = PAD.live.credit, lim = +h.creditLimit || (cr && +cr.limit) || 0, bal = cr ? +cr.balance || 0 : null, net = PAD.res ? PAD.res.totals.net : 0;
    var gauge = '';
    if (lim > 0) {
        var used = bal == null ? 0 : Math.min(100, bal / lim * 100), add = Math.max(0, Math.min(100 - used, net / lim * 100));
        gauge = '<div class="gauge"><div class="bar2"><i style="width:' + used + '%;background:#94a3b8"></i><i style="width:' + add + '%;background:' + (bal != null && bal + net > lim ? 'var(--err)' : 'var(--accent)') + '"></i></div>' +
            '<div class="lbl"><span>' + (bal == null ? 'balance …' : 'balance ' + fmtMoney(bal, 0)) + ' + this ' + fmtMoney(net, 0) + '</span><span>limit ' + fmtMoney(lim, 0) + '</span></div></div>';
    } else gauge = '<div class="gauge muted" style="font-size:.74rem"><i class="fa-solid fa-money-bill"></i> Cash customer (no credit limit)</div>';
    box.innerHTML = '<div class="nm">' + esc(h.customerName) + '</div><div class="muted">' + esc(h.customerNumber) + (h.address ? ' · ' + esc(h.address) : '') + '</div>' +
        '<div class="grid"><div><span>Class</span> ' + esc(h.customerClass || '—') + '</div><div><span>Category</span> ' + esc(h.customerCategory || '—') + '</div>' +
        '<div><span>Terms</span> ' + esc(h.paymentTerms || '—') + '</div><div><span>Payment</span> ' + esc(h.paymentMethodCode || h.paymentMethod || '—') + '</div>' +
        (h.vat || h.brn ? '<div><span>VAT</span> ' + esc(h.vat || '—') + '</div><div><span>BRN</span> ' + esc(h.brn || '—') + '</div>' : '') +
        '<div><span>Rules</span> ' + PAD.custRules.length + ' discount' + (PAD.custRules.length === 1 ? '' : 's') + '</div><div><span>Deposit</span> ' + (omUp(h.consignment) === 'NO' || omUp(h.consignment) === 'N' ? 'no' : 'yes') + '</div></div>' + gauge;
}

// ── price list ─────────────────────────────────────────────────
function padReloadPrices(force) {
    var h = padH();
    if (!h.priceList) { PAD.price = null; padPlState(); return Promise.resolve(); }
    var key = h.priceList + '|' + (h.pricingDate || today()) + '|' + (OM.bu ? OM.bu.name : '');
    if (!force && OM.prices[key] && OM.prices[key].items) { PAD.price = OM.prices[key]; padRepriceLines(); padPlState(); return Promise.resolve(); }
    PAD.price = { key: key, loading: true }; padPlState();
    var src = omSrc('priceItems');
    return omRunSource('priceItems', { PRICE_LIST: h.priceList, PRICING_DATE: h.pricingDate || today() }).then(function (rows) {
        var pc = { key: key, items: [], byCode: {}, byBar: {}, at: new Date() };
        rows.forEach(function (r) {
            var it = omNormItem(r, src && src.map); if (!it.item) return;
            var prev = pc.byCode[it.item.toUpperCase()];
            if (prev && !it.lot) return;                       // one row per item (lots come as extra rows)
            if (!prev) pc.items.push(it);
            pc.byCode[it.item.toUpperCase()] = it;
            if (it.barcode) String(it.barcode).split(/[,;\s]+/).forEach(function (b) { if (b) pc.byBar[b] = it; });
        });
        pc.items.forEach(function (it) { it._s = (it.item + ' ' + it.desc + ' ' + it.brand + ' ' + it.barcode).toLowerCase(); });
        OM.prices[key] = pc;
        if (PAD.price && PAD.price.key === key) { PAD.price = pc; padRepriceLines(); padPlState(); padRender(); }
    }).catch(function (e) {
        if (PAD.price && PAD.price.key === key) { PAD.price = { key: key, error: String(e) }; padPlState(); }
    });
}
function padPlState() {
    var p = PAD.price, el = $('pl-state'), h = padH();
    if (!h.priceList) { el.innerHTML = '<span><i class="fa-solid fa-circle-info"></i> Choose a price list to search items.</span>'; return; }
    if (!p || p.loading) { el.innerHTML = '<span><i class="fa-solid fa-circle-notch fa-spin"></i> Loading ' + esc(h.priceList) + '…</span>'; return; }
    if (p.error) { el.innerHTML = '<span class="err"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(p.error) + '</span><button class="link" onclick="padReloadPrices(true)">Retry</button>'; return; }
    el.innerHTML = '<span><i class="fa-solid fa-tags"></i> <b>' + esc(h.priceList) + '</b> · ' + p.items.length.toLocaleString() + ' items · priced ' + esc(h.pricingDate) +
        ' · loaded ' + p.at.toLocaleTimeString().slice(0, 5) + '</span><button class="link" onclick="padReloadPrices(true)"><i class="fa-solid fa-rotate"></i> Refresh</button>';
}
function padFind(code) {
    var p = PAD.price; if (!p || !p.items) return null;
    code = String(code || '').trim(); if (!code) return null;
    return p.byCode[code.toUpperCase()] || p.byBar[code] || null;
}
/** Keep lines in step with the chosen price list (price + attributes), except "copy as is" lines. */
function padRepriceLines() {
    var changed = 0;
    PAD.order.lines.forEach(function (l) {
        if (l.fixedSell != null && l.fixedSell !== '') return;
        var it = padFind(l.item); if (!it) { l.notInList = true; return; }
        l.notInList = false;
        if (+l.price !== +it.price) changed++;
        padCopyItem(l, it);
    });
    if (changed) { padApplyDiscounts(); toast(changed + ' line price(s) updated from ' + padH().priceList + '.'); }
}
function padCopyItem(l, it) {
    l.desc = it.desc; l.uom = it.uom || l.uom; l.price = it.price; l.tax = it.tax; l.cons = it.cons; l.consItem = it.consItem;
    l.crtItem = it.crtItem; l.crtPrice = it.crtPrice; l.crtMin = it.crtMin; l.crtDefault = it.crtDefault; l.itemType = it.itemType; l.buffer = it.buffer;
    l.attrs = { pc: it.pc, supplier: it.supplier, brand: it.brand, cat: it.cat, subcat: it.subcat, group: it.group };
    if (!l.lot && it.lot) l.lot = it.lot;
}

// ── items: search + add ────────────────────────────────────────
function padItemSearch() {
    var raw = $('item-q').value, list = $('item-list');
    var m = /^\s*(\d+(?:\.\d+)?)\s*[*xX]\s*(.+)$/.exec(raw), q = (m ? m[2] : raw).trim().toLowerCase();
    if (!q || !PAD.price || !PAD.price.items) { list.hidden = true; return; }
    var exact = padFind(q), words = q.split(/\s+/), hits = [];
    if (exact) hits.push(exact);
    for (var i = 0; i < PAD.price.items.length && hits.length < 60; i++) {
        var it = PAD.price.items[i]; if (it === exact) continue;
        if (words.every(function (w) { return it._s.indexOf(w) >= 0; })) hits.push(it);
    }
    hits.sort(function (a, b) { return (b === exact) - (a === exact) || (b.item.toLowerCase().indexOf(q) === 0) - (a.item.toLowerCase().indexOf(q) === 0); });
    PAD.itemHits = hits; PAD.itemIdx = hits.length ? 0 : -1;
    list.hidden = false;
    list.innerHTML = hits.length ? hits.map(function (it, i) {
        return '<div class="ta-item' + (i === 0 ? ' on' : '') + '" data-i="' + i + '"><span class="code">' + esc(it.item) + '</span><span class="t">' + esc(it.desc) + '</span><span class="r">' +
            esc(it.uom) + ' · ' + fmtMoney(it.price) + (it.cons ? ' · dep ' + fmtMoney(it.cons) : '') + '</span></div>';
    }).join('') : '<div class="ta-msg">Nothing in ' + esc(padH().priceList) + ' matches.</div>';
}
function padItemKey(e) {
    var list = $('item-list'), hits = PAD.itemHits || [];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!hits.length) return;
        PAD.itemIdx = (PAD.itemIdx + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
        Array.prototype.forEach.call(list.querySelectorAll('.ta-item'), function (x, i) { x.classList.toggle('on', i === PAD.itemIdx); if (i === PAD.itemIdx) x.scrollIntoView({ block: 'nearest' }); });
    } else if (e.key === 'Enter') {
        e.preventDefault();
        var raw = $('item-q').value.trim(), m = /^\s*(\d+(?:\.\d+)?)\s*[*xX]\s*(.+)$/.exec(raw), qty = m ? +m[1] : 1, code = m ? m[2].trim() : raw;
        var mu = omUp(raw);
        if (/^(ORD|RET|PADJ|NADJ|ADJ\+|ADJ-)$/.test(mu)) { padSetMode(mu === 'ADJ+' ? 'PADJ' : mu === 'ADJ-' ? 'NADJ' : mu); $('item-q').value = ''; list.hidden = true; return; }
        var it = padFind(code) || (hits.length && PAD.itemIdx >= 0 ? hits[PAD.itemIdx] : null);
        if (!it) { toast(PAD.price && PAD.price.items ? 'Item ' + code + ' is not in the price list.' : 'Choose a price list first.', 'err'); return; }
        padAddItem(it, qty, PAD.mode, { scan: !m && padFind(code) });
        $('item-q').value = ''; list.hidden = true;
    } else if (e.key === 'Escape') { list.hidden = true; }
}
function padSetMode(m) {
    PAD.mode = m;
    Array.prototype.forEach.call(document.querySelectorAll('#mode button'), function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === m); });
}
function padAddItem(it, qty, type, opts) {
    if (padReadOnly()) { toast('This order is already in Fusion — copy it to make changes.', 'err'); return; }
    opts = opts || {}; type = type || 'ORD';
    var lines = PAD.order.lines;
    var same = lines.filter(function (l) { return l.item === it.item && l.type === type && !l.lot === !it.lot; })[0];
    if (same && opts.scan) { same.qty = (+same.qty || 0) + (+qty || 1); PAD.sel = lines.indexOf(same); }
    else {
        var l = { id: padUid(), item: it.item, qty: +qty || 1, type: type, discAdd: 0, status: 'DRAFT', ediPrice: opts.ediPrice || null };
        padCopyItem(l, it);
        l.noCons = omUp(padH().consignment) === 'NO' || omUp(padH().consignment) === 'N';
        if (opts.reason) l.reason = opts.reason;
        if (opts.fixedSell != null) l.fixedSell = opts.fixedSell;
        if (opts.refOrder) l.refOrder = opts.refOrder;
        if (opts.lot) l.lot = opts.lot;
        lines.push(l); PAD.sel = lines.length - 1;
        if (same && !opts.bulk) toast(it.item + ' is now on two lines — the health panel offers to merge them.');
    }
    if (!opts.bulk) { padApplyDiscounts(); padChanged(true); }
}
function padApplyDiscounts() {
    var ot = PAD.order.orderTypeAttrs || {};
    omApplyDiscounts(PAD.order.lines, PAD.custRules, padH().orderDate, { off: omUp(ot.DISCOUNTS) === 'NO' || !padH().customerNumber });
}
function padMergeDups() {
    var keep = {}, out = [];
    PAD.order.lines.forEach(function (l) {
        var k = l.item + '|' + l.type + '|' + (l.lot || '');
        if (keep[k]) keep[k].qty = (+keep[k].qty || 0) + (+l.qty || 0); else { keep[k] = l; out.push(l); }
    });
    PAD.order.lines = out; padApplyDiscounts(); padChanged(true);
}

// ── cart render ────────────────────────────────────────────────
function padRender() {
    if (!PAD.order) return;
    var ctx = padCtx(), body = $('cart-body'), lines = PAD.order.lines, ro = padReadOnly(), h = '';
    var flagged = {};
    ((PAD.res && PAD.res.checks) || []).forEach(function (c) { c.lines.forEach(function (id) { flagged[id] = c.level === 'block' ? 'bad' : (flagged[id] || 'flag'); }); });
    var reasonOpts = PAD.reasons || [];
    lines.forEach(function (l, i) {
        var c = omCalcLine(l, ctx), ret = c.sign < 0;
        var why = omExplainDiscount(l);
        h += '<tr data-i="' + i + '" class="' + (i === PAD.sel ? 'sel ' : '') + (flagged[l.id] || '') + '">' +
            '<td class="c-no">' + (i + 1) + '</td>' +
            '<td class="it"><b>' + esc(l.item) + '</b>' + (l.notInList ? ' <span class="chip warn" title="Not in the chosen price list">not in list</span>' : '') +
            (l.lot ? ' <small>lot ' + esc(l.lot) + '</small>' : '') + '<div title="' + esc(l.desc) + '">' + esc(l.desc || '') + '</div>' +
            (ret ? '<select class="reason' + (!l.reason ? ' miss' : '') + '" data-f="reason"' + (ro ? ' disabled' : '') + '><option value="">Return reason…</option>' + reasonOpts.map(function (r) {
                return '<option value="' + esc(r.code) + '"' + (r.code === l.reason ? ' selected' : '') + '>' + esc(r.name || r.code) + '</option>'; }).join('') + '</select>' : '') + '</td>' +
            '<td class="c-type"><select class="t t-' + l.type + '" data-f="type"' + (ro ? ' disabled' : '') + '>' + Object.keys(OM_LINE_TYPES).map(function (t) { return '<option' + (t === l.type ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></td>' +
            '<td class="n"><input class="q" data-f="qty" value="' + esc(l.qty) + '"' + (ro ? ' disabled' : '') + '> <small class="muted">' + esc(l.uom || '') + '</small></td>' +
            '<td class="n">' + fmtMoney(Math.abs(c.list)) + '</td>' +
            '<td class="n"><span class="disc" title="' + esc(why) + '">' + (c.pct ? c.pct + '%' : '—') + '</span></td>' +
            '<td class="n"><input class="p" data-f="discAdd" value="' + esc(l.discAdd || '') + '" placeholder="0"' + (ro || l.fixedSell != null && l.fixedSell !== '' ? ' disabled' : '') + '></td>' +
            '<td class="n">' + fmtMoney(Math.abs(c.sell)) + '</td>' +
            '<td class="c-tax" title="' + esc(l.tax || '') + '">' + (c.taxPct ? c.taxPct + '%' : '<span class="muted">0</span>') + '</td>' +
            '<td class="n">' + (c.consTotal ? fmtMoney(c.consTotal) : '') + '</td>' +
            '<td class="n">' + (c.crtTotal ? fmtMoney(c.crtTotal) + ' <small class="muted">' + fmtQty(Math.abs(c.crtQty)) + '</small>' : '') + '</td>' +
            '<td class="n"><b>' + fmtMoney(c.net) + '</b></td>' +
            '<td class="c-x">' + (ro ? '' : '<button class="x" data-act="del" title="Remove (Delete)"><i class="fa-solid fa-xmark"></i></button>') + '</td></tr>';
    });
    body.innerHTML = h;
    $('cart-empty').hidden = lines.length > 0;
    padRenderSide();
}
function padRenderSide() {
    var o = PAD.order, ot = o.orderTypeAttrs || {};
    PAD.res = omChecks(o, ot, PAD.live, omGen());
    var t = PAD.res.totals, p = omGen().precision;
    $('totals').innerHTML = '<div><span>Lines</span><b>' + t.lines + '</b></div><div><span>Gross (after discount)</span><b>' + fmtMoney(t.gross, p) + '</b></div>' +
        '<div><span>Discount given</span><b>' + fmtMoney(t.disc, p) + '</b></div><div><span>Tax</span><b>' + fmtMoney(t.tax, p) + '</b></div>' +
        (t.cons ? '<div><span>Deposits</span><b>' + fmtMoney(t.cons, p) + '</b></div>' : '') + (t.crates ? '<div><span>Crates</span><b>' + fmtMoney(t.crates, p) + '</b></div>' : '') +
        (t.returned ? '<div><span>Returns</span><b>' + fmtMoney(t.returned, p) + '</b></div>' : '') +
        '<div class="net"><span>' + esc(padH().currency || '') + ' Net</span><b>' + fmtMoney(t.net, p) + '</b></div>';
    var icon = { block: 'fa-circle-xmark', approve: 'fa-stamp', warn: 'fa-triangle-exclamation', ok: 'fa-circle-check', pending: 'fa-circle-notch fa-spin' };
    var cks = PAD.res.checks.slice().sort(function (a, b) { var r = { block: 0, approve: 1, warn: 2, pending: 3, ok: 4 }; return r[a.level] - r[b.level]; });
    $('checks').innerHTML = cks.length ? cks.map(function (c) {
        return '<li class="' + c.level + '"' + (c.lines.length ? ' data-lines="' + c.lines.join(',') + '"' : '') + ' data-id="' + c.id + '"><i class="fa-solid ' + icon[c.level] + '"></i><span>' + esc(c.msg) +
            (c.id === 'dup' ? ' <button class="link" data-act="merge">Merge</button>' : '') + (c.id === 'credit' && c.level !== 'ok' && c.level !== 'pending' ? '' : '') + '</span></li>';
    }).join('') : '<li class="ok"><i class="fa-solid fa-circle-check"></i><span>Nothing to check yet.</span></li>';
    // verdict + buttons
    var st = o.status, v = PAD.res.verdict, approved = st === 'APPROVED' && padH().approvalHash === padHash();
    var vEl = $('verdict');
    if (padReadOnly()) {
        vEl.className = 'card verdict ready';
        vEl.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i><div><b>' + (st === 'DISCARDED' ? 'Discarded' : 'In Fusion' + (o.fusion && o.fusion.orderNo ? ' · ' + esc(o.fusion.orderNo) : '')) + '</b><small>' + esc(padH().orderNo) + ' — read only. Copy it to change it.</small></div>';
    } else if (st === 'PENDING_APPROVAL') {
        vEl.className = 'card verdict approval';
        vEl.innerHTML = '<i class="fa-solid fa-hourglass-half"></i><div><b>Waiting for approval</b><small>' + esc(padH().orderNo) + ' · <button class="link" onclick="padCheckApproval()">Check now</button></small></div>';
    } else if (!o.lines.length && !padH().customerNumber) {
        vEl.className = 'card verdict idle'; vEl.innerHTML = '<i class="fa-solid fa-cart-shopping"></i><div><b>New order</b><small>Customer (F7) · items (F6) · submit (Ctrl+Enter)</small></div>';
    } else {
        var txt = { ready: ['fa-circle-check', 'Ready to submit', 'All checks pass.'], approval: approved ? ['fa-circle-check', 'Approved', 'Approved by ' + (o.approvedBy || 'an approver') + ' — you can submit.'] : ['fa-stamp', 'Needs approval', 'Ask an approver, or change the order.'], blocked: ['fa-circle-xmark', 'Not ready', 'Fix the red items first.'] }[v];
        vEl.className = 'card verdict ' + (approved ? 'ready' : v);
        vEl.innerHTML = '<i class="fa-solid ' + txt[0] + '"></i><div><b>' + txt[1] + '</b><small>' + txt[2] + '</small></div>';
    }
    var canSend = !padReadOnly() && st !== 'PENDING_APPROVAL' && (v === 'ready' || (v === 'approval' && approved)) && !PAD.saving;
    $('b-submit').disabled = !canSend; $('b-fdraft').disabled = !canSend;
    $('b-approve').hidden = !(v === 'approval' && !approved && !padReadOnly() && st !== 'PENDING_APPROVAL');
    $('b-save').disabled = padReadOnly() || PAD.saving;
    padRenderCustomer();
}

// ── changes + live checks ──────────────────────────────────────
function padChanged(lines) {
    if (PAD.order.status === 'REJECTED') PAD.order.status = 'DRAFT';
    PAD.order.dirty = true;
    padSaveLocal(); padRender();
    padScheduleLive(lines ? 1200 : 600);
}
function padScheduleLive(ms) { clearTimeout(PAD.liveTimer); PAD.liveTimer = setTimeout(padRunLive, ms || 1000); }
function padRunLive() {
    var o = PAD.order, h = o.header, ot = o.orderTypeAttrs || {}, jobs = [];
    if (!o || padReadOnly()) return;
    var yes = function (v) { return /^(Y|YES|TRUE|1)$/i.test(String(v || '')); };
    var net = omTotals(o.lines, padCtx()).net;
    // credit
    if (yes(ot.CREDITCHECK) && h.customerNumber && net > 0) {
        var ck = h.customerNumber + '|' + Math.round(net);
        if (!PAD.live.credit || PAD.live.creditKey !== ck) {
            PAD.live.creditKey = ck;
            jobs.push(omRunSource('credit', { CUSTOMER_NUMBER: h.customerNumber, AMOUNT: Math.round(net * 100) / 100 }).then(function (rows) {
                var r = rows[0] || {}, g = function (f, n) { return omMapped('credit', r, f, n); };
                var lim = omNum(g('limit', ['CREDIT_LIMIT', 'OVERALL_CREDIT_LIMIT', 'LIMIT']), +h.creditLimit || 0);
                var avail = g('available', ['AVAILABLE', 'AVAILABLE_CREDIT', 'AVAILABLE_LIMIT']);
                var bal = avail != null ? lim - omNum(avail) : omNum(g('balance', ['BALANCE', 'OUTSTANDING', 'AR_BALANCE', 'OPEN_BALANCE', 'AMOUNT_DUE_REMAINING', 'TOTAL_DUE', 'OUTSTANDING_AMOUNT']));
                var hold = String(g('onHold', ['ON_HOLD', 'HOLD', 'HOLD_FLAG', 'INVOICE_ON_HOLD', 'CREDIT_HOLD']) || '');
                var stat = String(g('status', ['STATUS', 'RESULT', 'CREDIT_STATUS', 'CREDIT_CHECK']) || '');
                PAD.live.credit = { limit: lim, balance: bal, onHold: yes(hold) || /HOLD|BLOCK/i.test(stat), holdNote: /FAIL|HOLD|EXCEED|BLOCK/i.test(stat) ? stat : '', raw: r, rows: rows.length };
            }).catch(function (e) { PAD.live.credit = { error: String(e) }; }));
        }
    }
    // stock (order lines only)
    var items = o.lines.filter(function (l) { return l.type === 'ORD' || l.type === 'PADJ'; }).map(function (l) { return l.item; });
    var need = items.filter(function (it) { return !PAD.stockAt[it] || Date.now() - PAD.stockAt[it] > 120000; });
    if (need.length && (h.orgId || (OM.bu && OM.bu.orgId))) {
        need.forEach(function (it) { PAD.stockAt[it] = Date.now(); });
        jobs.push(omRunSource('stock', { ITEMS: { raw: omIn(need) }, ORG_ID: h.orgId || OM.bu.orgId, SUBINVENTORY: h.subinventory || '' }).then(function (rows) {
            PAD.live.stock = PAD.live.stock || {};
            need.forEach(function (it) { PAD.live.stock[it] = 0; });
            rows.forEach(function (r) { var it = omStr(omMapped('stock', r, 'item', ['ITEM_NUMBER', 'ITEM', 'ITEMNUMBER'])); if (it) PAD.live.stock[it] = (PAD.live.stock[it] || 0) + omNum(omMapped('stock', r, 'qty', ['QTY', 'ONHAND', 'ON_HAND', 'AVAILABLE_QTY', 'QUANTITY'])); });
        }).catch(function (e) { need.forEach(function (it) { delete PAD.stockAt[it]; }); PAD.live.stockErr = String(e); }));
    }
    // period
    var per = h.orderDate ? new Date(h.orderDate + 'T00:00:00') : new Date();
    var pname = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][per.getMonth()] + '-' + String(per.getFullYear()).slice(2);
    if (!PAD.live.period || PAD.live.period.name !== pname) {
        PAD.live.period = { name: pname, open: null };
        jobs.push(omRunSource('period', { PERIOD: pname, ORDER_DATE: h.orderDate || today() }).then(function (rows) {
            if (!rows.length) return;
            var s = omUp(omMapped('period', rows[0], 'status', ['STATUS', 'CLOSING_STATUS', 'PERIOD_STATUS', 'SHOW_STATUS']));
            PAD.live.period = { name: pname, open: s === 'O' || s === 'OPEN' || s === 'Y' || s === 'F' || s === 'FUTURE' || s === 'OPENED' };
        }).catch(function () { PAD.live.period = { name: pname, open: null }; }));
    }
    // customer PO
    if (h.customerPo && PAD.live.dupPoFor !== h.customerPo) {
        PAD.live.dupPoFor = h.customerPo;
        jobs.push(omRunSource('dupPo', { PO: h.customerPo, CUSTOMER_NUMBER: h.customerNumber || '' }).then(function (rows) {
            PAD.live.dupPo = rows.map(function (r) { return omStr(omMapped('dupPo', r, 'order', ['ORDER_NUMBER', 'SOURCE_ORDER_NUMBER'])); })
                .filter(function (n) { return n && n !== h.orderNo && n !== (o.fusion && o.fusion.orderNo); });
        }).catch(function () { PAD.live.dupPo = null; }));
    } else if (!h.customerPo) PAD.live.dupPo = null;
    // reference order
    if (h.reference && PAD.live.adjRefFor !== h.reference) {
        PAD.live.adjRefFor = h.reference;
        jobs.push(omRunSource('adjRef', { REF: h.reference }).then(function (rows) { PAD.live.adjRef = rows.length > 0; }).catch(function () { PAD.live.adjRef = null; }));
    } else if (!h.reference) PAD.live.adjRef = null;
    if (!jobs.length) return;
    $('b-recheck').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
    Promise.all(jobs).then(function () { $('b-recheck').textContent = 'Re-check'; padRender(); });
}

// ── save / approval ────────────────────────────────────────────
function padEnsureNo() {
    if (padH().orderNo) return Promise.resolve(padH().orderNo);
    return omNextOrderNo().then(function (no) { padH().orderNo = no; return no; });
}
function padSave(quiet) {
    if (PAD.saving) return Promise.reject('Saving…');
    padReadHeader();
    PAD.saving = true; padRenderSide();
    var o = PAD.order;
    o.verdict = PAD.res ? PAD.res.verdict : null;
    var isNew = !o.id;
    return omEnsureTables().then(padEnsureNo).then(function () { return omSaveOrder(o); }).then(function () {
        PAD.saving = false; o.dirty = false;
        try { localStorage.removeItem('om_pad_' + OM.instance); } catch (e) { }
        if (!quiet) toast('Saved ' + padH().orderNo + '.', 'ok');
        if (!isNew) omEvent(o.id, 'SAVED', o.lines.length + ' lines, net ' + fmtMoney(PAD.res.totals.net));
        padRender(); return o;
    }).catch(function (e) { PAD.saving = false; padRenderSide(); toast('Could not save: ' + e, 'err'); throw e; });
}
function padAskApproval() {
    var reasons = PAD.res.checks.filter(function (c) { return c.level === 'approve'; }).map(function (c) { return c.msg; });
    omModal({ title: '<i class="fa-solid fa-stamp"></i> Ask for approval', body:
        '<div class="note warn">' + reasons.map(esc).join('<br>') + '</div><label class="fgrid" style="display:block"><span class="muted" style="font-size:.78rem">Note for the approver</span><textarea id="ap-note" class="code" rows="3" placeholder="Why this order should go through…"></textarea></label>' +
        '<p class="muted" style="font-size:.78rem">Approvers: ' + esc(omGen().approvers || '(Setup admins)') + '. They see it under Approvals on any PC.</p>',
        buttons: [{ label: 'Cancel', act: 'close' }, { label: '<i class="fa-solid fa-paper-plane"></i> Send request', cls: 'primary', act: 'send' }],
        onAction: function (a) {
            if (a !== 'send') return;
            var note = $('ap-note').value.trim();
            return padSave(true).then(function (o) {
                return omWrite("UPDATE wms_om_approvals SET status = 'CANCELLED' WHERE order_id = " + omN(o.id) + " AND status = 'PENDING'").then(function () {
                    o.header.approvalHash = padHash();
                    return omWrite('INSERT INTO wms_om_approvals (order_id, order_no, reason, amount, requested_by, note) VALUES (' + omN(o.id) + ', ' + omV(o.header.orderNo, 60) + ', ' +
                        omV(reasons.join('\n'), 3900) + ', ' + omN(PAD.res.totals.net) + ', ' + omLit(OM.user) + ', ' + omV(note, 1000) + ')');
                }).then(function () {
                    o.status = 'PENDING_APPROVAL'; o.header.approvalHash = padHash();
                    return omSaveOrder(o, 'PENDING_APPROVAL');
                }).then(function () { return omEvent(o.id, 'APPROVAL_ASKED', reasons.join('\n') + (note ? '\nNote: ' + note : '')); });
            }).then(function () { toast('Approval requested for ' + padH().orderNo + '.', 'ok'); padRender(); if (window.apprBadge) apprBadge(); })
                .catch(function (e) { toast('Could not request approval: ' + e, 'err'); });
        } });
}
function padCheckApproval() {
    var o = PAD.order; if (!o.id) return;
    omRead("SELECT status, decided_by, note FROM wms_om_approvals WHERE order_id = " + omN(o.id) + " ORDER BY approval_id DESC FETCH FIRST 1 ROWS ONLY", 1).then(function (r) {
        var a = r[0];
        if (!a || a.STATUS === 'PENDING') { toast('Still waiting for an approver.'); return; }
        if (a.STATUS === 'APPROVED') { o.status = 'APPROVED'; o.approvedBy = a.DECIDED_BY; toast('Approved by ' + a.DECIDED_BY + ' — you can submit now.', 'ok'); }
        else { o.status = 'REJECTED'; toast('Rejected by ' + a.DECIDED_BY + (a.NOTE ? ': ' + a.NOTE : ''), 'err'); }
        padRender();
    }).catch(function (e) { toast(String(e), 'err'); });
}

// ── Fusion ─────────────────────────────────────────────────────
function padPayload(submit) {
    var g = omGen(), bu = OM.bu || {};
    return omFusionPayload(PAD.order, { sourceSystem: g.sourceSystem, buId: omBuId(bu), buName: bu.name, orgId: padH().orgId || bu.orgId, priceMode: g.priceMode, lineTypes: g.lineTypes,
        headerExtras: g.headerExtras, lineExtras: g.lineExtras, precision: g.precision, taxRates: g.taxRates, currency: bu.currency, defaultReturnReason: g.defaultReturnReason }, { submit: submit, user: OM.user });
}
function padShowPayload() {
    padReadHeader();
    omModal({ title: '<i class="fa-solid fa-code"></i> Fusion payload — salesOrdersForOrderHub', wide: true,
        body: '<p class="muted" style="font-size:.8rem">This is what Submit sends (POST …/fscmRestApi/resources/' + esc(omGen().restVersion) + '/salesOrdersForOrderHub). Header and line extras come from Setup › Rules &amp; Fusion.</p><pre class="json">' + esc(JSON.stringify(padPayload(true), null, 2)) + '</pre>',
        buttons: [{ label: 'Copy', act: 'copy' }, { label: 'Close', act: 'close' }],
        onAction: function (a) { if (a === 'copy') { navigator.clipboard.writeText(JSON.stringify(padPayload(true), null, 2)); toast('Copied.'); return false; } } });
}
function padSend(submit) {
    padReadHeader(); padRender();
    var o = PAD.order, t = PAD.res.totals, short = PAD.res.checks.filter(function (c) { return c.id === 'stock'; })[0];
    if (o.fusion && o.fusion.headerId) { toast('Already in Fusion (' + (o.fusion.orderNo || o.fusion.headerId) + ').', 'err'); return; }
    var bo = /^(Y|YES)$/i.test((o.orderTypeAttrs || {}).BACKORDERSTATUS || '') && short;
    omModal({ title: submit ? '<i class="fa-solid fa-paper-plane"></i> Submit to Fusion' : '<i class="fa-solid fa-cloud"></i> Create Fusion draft',
        body: '<div class="facts"><div><span>Customer</span>' + esc(padH().customerName) + '</div><div><span>Order type</span>' + esc(padH().orderType) + '</div><div><span>Lines</span>' + t.lines + '</div>' +
            '<div><span>Net</span><b>' + esc(padH().currency) + ' ' + fmtMoney(t.net) + '</b></div><div><span>Tax</span>' + fmtMoney(t.tax) + '</div><div><span>Business unit</span>' + esc(padH().bu) + '</div></div>' +
            (short ? '<div class="note warn"><b>Stock:</b> ' + esc(short.msg) + (bo ? '<br><label><input type="radio" name="bo" value="full" checked> Send the full quantities</label><br><label><input type="radio" name="bo" value="bo"> Send what is on hand, record the rest as backorder</label>' : '') + '</div>' : '') +
            '<p class="muted" style="font-size:.8rem">' + (submit ? 'The order is created and submitted in Fusion (' + OM.instance + ').' : 'The order is created in Fusion as a draft — it is not submitted.') + '</p>',
        buttons: [{ label: 'Cancel', act: 'close' }, { label: 'Show payload', act: 'payload' }, { label: submit ? 'Submit' : 'Create draft', cls: 'primary', act: 'go' }],
        onAction: function (a, box) {
            if (a === 'payload') { padShowPayload(); return false; }
            if (a !== 'go') return;
            var useBo = bo && box.querySelector('input[name="bo"]:checked') && box.querySelector('input[name="bo"]:checked').value === 'bo';
            omCloseModal(); padDoSend(submit, useBo); return false;
        } });
}
function padDoSend(submit, backorder) {
    var o = PAD.order, boLines = [];
    if (backorder && PAD.live.stock) {
        o.lines.forEach(function (l) {
            if (l.type !== 'ORD' && l.type !== 'PADJ') return;
            var have = Math.max(0, (PAD.live.stock[l.item] || 0) - (+l.buffer || 0)), q = Math.abs(+l.qty);
            if (q > have) { boLines.push({ item: l.item, desc: l.desc, qty: q - have }); l.qty = have; }
        });
        o.lines = o.lines.filter(function (l) { return +l.qty; });
    }
    omBusy(submit ? 'Submitting to Fusion…' : 'Creating the Fusion draft…');
    padSave(true).then(function () {
        var body = padPayload(submit);
        return omEvent(o.id, submit ? 'SUBMIT' : 'FUSION_DRAFT', 'Sending ' + body.lines.length + ' Fusion lines', body).then(function () {
            return host('omRest', { method: 'POST', resource: 'salesOrdersForOrderHub', body: JSON.stringify(body), version: omGen().restVersion });
        });
    }).then(function (r) {
        var j = omJson(r && r.body, null);
        if (!r || r.ok === false || r.status < 200 || r.status >= 300 || !j) {
            var msg = (r && r.error) || padFusionError(r && r.body) || ('HTTP ' + (r && r.status));
            return omSetStatus(o.id, 'FAILED', { last_error: msg }).then(function () { return omEvent(o.id, 'FUSION_ERROR', msg, { status: r && r.status, body: String(r && r.body || '').slice(0, 20000) }); })
                .then(function () { o.status = 'FAILED'; throw msg; });
        }
        o.fusion = { headerId: String(j.HeaderId || ''), orderNo: String(j.OrderNumber || ''), status: j.StatusCode || '' };
        o.status = submit ? 'SUBMITTED' : 'FUSION_DRAFT';
        return omSetStatus(o.id, o.status, { fusion_header_id: o.fusion.headerId, fusion_order_no: o.fusion.orderNo, fusion_status: o.fusion.status, last_error: '', submitted_by: OM.user, submitted_date: 'SYSDATE' })
            .then(function () { return omEvent(o.id, 'FUSION_OK', 'Fusion order ' + o.fusion.orderNo + ' (' + (o.fusion.status || 'created') + ')', { HeaderId: j.HeaderId, OrderNumber: j.OrderNumber, StatusCode: j.StatusCode }); })
            .then(function () { return omSeq(boLines, function (b) {
                return omWrite('INSERT INTO wms_om_backorders (order_no, customer_number, customer_name, item, item_desc, qty, warehouse, created_by) VALUES (' + omV(padH().orderNo, 60) + ', ' +
                    omV(padH().customerNumber, 60) + ', ' + omV(padH().customerName, 360) + ', ' + omV(b.item, 100) + ', ' + omV(b.desc, 400) + ', ' + omN(b.qty) + ', ' + omV(padH().warehouse, 120) + ', ' + omLit(OM.user) + ')');
            }); });
    }).then(function () {
        omBusy(null); padRender(); padDone(submit, boLines);
    }).catch(function (e) {
        omBusy(null); padRender();
        omModal({ title: '<i class="fa-solid fa-triangle-exclamation" style="color:var(--err)"></i> Fusion did not accept the order', body: '<div class="note warn" style="white-space:pre-wrap">' + esc(e) + '</div><p class="muted" style="font-size:.8rem">The order is saved as ' + esc(padH().orderNo) + ' (status Failed). Fix it and submit again — the error is on the order\'s timeline.</p>',
            buttons: [{ label: 'Show payload', act: 'payload' }, { label: 'Close', cls: 'primary', act: 'close' }], onAction: function (a) { if (a === 'payload') { padShowPayload(); return false; } } });
    });
}
function padFusionError(body) {
    var j = omJson(body, null);
    if (!j) return body ? String(body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500) : '';
    var parts = [];
    if (j.title) parts.push(j.title);
    if (j.detail) parts.push(typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail));
    (j['o:errorDetails'] || []).forEach(function (d) { parts.push((d['o:errorPath'] ? d['o:errorPath'] + ': ' : '') + (d.detail || d.title || '')); });
    return parts.join('\n') || JSON.stringify(j).slice(0, 1500);
}
function padDone(submit, boLines) {
    var o = PAD.order;
    omModal({ title: '<i class="fa-solid fa-circle-check" style="color:var(--ok)"></i> ' + (submit ? 'Order submitted' : 'Fusion draft created'),
        body: '<div class="facts"><div><span>Our number</span><b>' + esc(padH().orderNo) + '</b></div><div><span>Fusion order</span><b>' + esc(o.fusion.orderNo || '—') + '</b></div><div><span>Status</span>' + esc(o.fusion.status || '—') + '</div></div>' +
            (boLines.length ? '<div class="note">' + boLines.length + ' line(s) recorded as backorder.</div>' : ''),
        buttons: [{ label: '<i class="fa-solid fa-print"></i> Print', act: 'print' }, { label: '<i class="fa-solid fa-envelope"></i> E-mail', act: 'mail' }, { label: '<i class="fa-solid fa-receipt"></i> MRA', act: 'mra' },
            { label: '<i class="fa-solid fa-file-circle-plus"></i> New order', cls: 'primary', act: 'new' }],
        onAction: function (a) {
            if (a === 'new') { padNewOrder(); return; }
            var snap = { id: o.id, header: o.header, fusion: o.fusion, status: o.status };
            omCloseModal();
            if (a === 'print') ordPrint(snap); else if (a === 'mail') ordMail(snap); else if (a === 'mra') ordMra(snap);
            return false;
        } });
}

// ── smart paste / usual / price list ───────────────────────────
function padSmartPaste() {
    if (!PAD.price || !PAD.price.items) { toast('Choose a price list first.', 'err'); return; }
    var res = null;
    omModal({ title: '<i class="fa-solid fa-wand-magic-sparkles"></i> Smart paste', wide: true,
        body: '<p class="muted" style="font-size:.8rem">Paste rows from Excel (item + qty columns), scanned barcodes (one per line — ORD / RET / ADJ+ / ADJ- switch mode), or a customer\'s e-mail. What the rules cannot read, Claude can.</p>' +
            '<textarea class="big" id="sp-text" placeholder="Item&#9;Qty&#10;BEER33&#9;24&#10;…  or  6001234567890  or  \'please send 3 cases of …\'"></textarea><div id="sp-out"></div>',
        buttons: [{ label: 'Cancel', act: 'close' }, { label: '<i class="fa-solid fa-robot"></i> Ask Claude for the rest', act: 'ai' }, { label: 'Read', act: 'read' }, { label: 'Add lines', cls: 'primary', act: 'add' }],
        onOpen: function () { setTimeout(function () { $('sp-text').focus(); }, 30); },
        onAction: function (a) {
            if (a === 'read') { res = omParsePaste($('sp-text').value, padFind, PAD.mode); spRender(); return false; }
            if (a === 'ai') {
                if (!res) res = omParsePaste($('sp-text').value, padFind, PAD.mode);
                var text = res.unmatched.length ? res.unmatched.join('\n') : $('sp-text').value;
                if (!text.trim()) { toast('Nothing left to read.'); return false; }
                $('sp-out').innerHTML = '<div class="note"><i class="fa-solid fa-circle-notch fa-spin"></i> Claude is reading the text…</div>';
                host('omAiParse', { text: text.slice(0, 20000), catalog: padCatalogFor(text), mode: PAD.mode }).then(function (r) {
                    if (!r || r.ok === false) throw (r && r.error) || 'No answer';
                    var got = (r.lines || []).filter(function (x) { return padFind(x.item); });
                    res.lines = res.lines.concat(got.map(function (x) { return { item: padFind(x.item).item, qty: +x.qty || 1, type: OM_LINE_TYPES[omUp(x.type)] ? omUp(x.type) : PAD.mode, src: 'Claude: ' + (x.note || x.text || '') }; }));
                    res.unmatched = r.unmatched || [];
                    spRender(r.note);
                }).catch(function (e) { $('sp-out').innerHTML = '<div class="note warn">' + esc(e) + '</div>'; });
                return false;
            }
            if (a === 'add') {
                if (!res) res = omParsePaste($('sp-text').value, padFind, PAD.mode);
                var box = $('sp-out');
                res.lines.forEach(function (x, i) {
                    var q = box.querySelector('input[data-i="' + i + '"]'), t = box.querySelector('select[data-i="' + i + '"]'), on = box.querySelector('input[data-on="' + i + '"]');
                    if (on && !on.checked) return;
                    padAddItem(padFind(x.item), q ? +q.value : x.qty, t ? t.value : x.type, { bulk: true, ediPrice: x.ediPrice });
                });
                padApplyDiscounts(); padChanged(true); toast(res.lines.length + ' line(s) added.', 'ok');
            }
        } });
    function spRender(note) {
        var lines = res.lines;
        $('sp-out').innerHTML = (note ? '<div class="note">' + esc(note) + '</div>' : '') +
            '<table class="tbl"><thead><tr><th></th><th>Item</th><th>Description</th><th>Type</th><th>Qty</th><th>From</th></tr></thead><tbody>' + lines.map(function (x, i) {
                var it = padFind(x.item);
                return '<tr><td><input type="checkbox" data-on="' + i + '" checked></td><td class="mono">' + esc(it.item) + '</td><td>' + esc(it.desc) + '</td><td><select data-i="' + i + '">' + Object.keys(OM_LINE_TYPES).map(function (t) { return '<option' + (t === x.type ? ' selected' : '') + '>' + t + '</option>'; }).join('') +
                    '</select></td><td><input data-i="' + i + '" value="' + esc(x.qty) + '" style="width:70px"></td><td class="muted" style="font-size:.74rem">' + esc(String(x.src || '').slice(0, 80)) + '</td></tr>';
            }).join('') + '</tbody></table>' +
            (res.unmatched.length ? '<div class="note warn"><b>' + res.unmatched.length + ' not understood:</b><br>' + res.unmatched.slice(0, 20).map(esc).join('<br>') + '</div>' : '');
    }
}
/** The price-list items most likely meant by the text (sent to Claude instead of the whole list). */
function padCatalogFor(text) {
    var words = String(text).toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2; });
    var scored = PAD.price.items.map(function (it) { var s = 0; words.forEach(function (w) { if (it._s.indexOf(w) >= 0) s++; }); return { it: it, s: s }; }).filter(function (x) { return x.s; });
    scored.sort(function (a, b) { return b.s - a.s; });
    return scored.slice(0, 300).map(function (x) { return { item: x.it.item, desc: x.it.desc, uom: x.it.uom, barcode: x.it.barcode }; });
}
function padUsual() {
    var h = padH();
    if (!h.customerNumber) { toast('Choose a customer first.', 'err'); return; }
    omBusy('Reading what ' + h.customerName + ' usually orders…');
    omRead("SELECT jt.item, COUNT(DISTINCT o.order_id) AS orders, ROUND(AVG(ABS(jt.qty)), 2) AS avg_qty, MAX(o.order_date) AS last_date FROM wms_om_orders o, " +
        "JSON_TABLE(o.lines_json, '$[*]' COLUMNS (item VARCHAR2(100) PATH '$.item', qty NUMBER PATH '$.qty', ltype VARCHAR2(10) PATH '$.type')) jt " +
        "WHERE o.customer_number = " + omLit(h.customerNumber) + " AND o.instance = " + omLit(OM.instance) + " AND o.status IN ('SUBMITTED','FUSION_DRAFT','APPROVED','DRAFT') AND jt.ltype = 'ORD' " +
        "GROUP BY jt.item ORDER BY COUNT(DISTINCT o.order_id) DESC, MAX(o.order_date) DESC FETCH FIRST 40 ROWS ONLY", 40).then(function (rows) {
        omBusy(null);
        if (!rows.length) { toast('No earlier orders for this customer in the module yet.'); return; }
        omModal({ title: '<i class="fa-solid fa-clock-rotate-left"></i> Usually ordered by ' + esc(h.customerName), wide: true,
            body: '<table class="tbl"><thead><tr><th></th><th>Item</th><th>Description</th><th class="n">Orders</th><th class="n">Usual qty</th><th>Qty</th></tr></thead><tbody>' + rows.map(function (r, i) {
                var it = padFind(r.ITEM);
                return '<tr><td><input type="checkbox" data-u="' + i + '"' + (it ? '' : ' disabled') + '></td><td class="mono">' + esc(r.ITEM) + '</td><td>' + (it ? esc(it.desc) : '<span class="muted">not in this price list</span>') + '</td><td class="n">' + r.ORDERS + '</td><td class="n">' + r.AVG_QTY + '</td><td><input data-q="' + i + '" value="' + Math.round(+r.AVG_QTY || 1) + '" style="width:70px"></td></tr>';
            }).join('') + '</tbody></table>',
            buttons: [{ label: 'Cancel', act: 'close' }, { label: 'Tick all', act: 'all' }, { label: 'Add ticked', cls: 'primary', act: 'add' }],
            onAction: function (a, box) {
                if (a === 'all') { Array.prototype.forEach.call(box.querySelectorAll('input[data-u]:not(:disabled)'), function (c) { c.checked = true; }); return false; }
                if (a !== 'add') return;
                var n = 0;
                rows.forEach(function (r, i) { var c = box.querySelector('input[data-u="' + i + '"]'); if (c && c.checked) { padAddItem(padFind(r.ITEM), +box.querySelector('input[data-q="' + i + '"]').value || 1, 'ORD', { bulk: true }); n++; } });
                padApplyDiscounts(); padChanged(true); toast(n + ' line(s) added.', 'ok');
            } });
    }).catch(function (e) { omBusy(null); toast(String(e), 'err'); });
}
function padBrowsePl() {
    if (!PAD.price || !PAD.price.items) { toast('Choose a price list first.', 'err'); return; }
    omModal({ title: '<i class="fa-solid fa-list"></i> ' + esc(padH().priceList), wide: true,
        body: '<div class="search" style="max-width:none"><i class="fa-solid fa-magnifying-glass"></i><input id="plb-q" type="search" placeholder="Filter…"></div><div id="plb-t" style="max-height:60vh;overflow:auto"></div>',
        onOpen: function () {
            function draw() {
                var q = $('plb-q').value.toLowerCase().split(/\s+/).filter(Boolean), n = 0;
                $('plb-t').innerHTML = '<table class="tbl"><thead><tr><th>Item</th><th>Description</th><th>UOM</th><th class="n">Price</th><th>Tax</th><th class="n">Deposit</th><th>Brand</th><th>Category</th><th></th></tr></thead><tbody>' +
                    PAD.price.items.filter(function (it) { return q.every(function (w) { return it._s.indexOf(w) >= 0; }) && n++ < 400; }).map(function (it) {
                        return '<tr><td class="mono">' + esc(it.item) + '</td><td>' + esc(it.desc) + '</td><td>' + esc(it.uom) + '</td><td class="n">' + fmtMoney(it.price) + '</td><td>' + esc(it.tax) + '</td><td class="n">' + (it.cons ? fmtMoney(it.cons) : '') +
                            '</td><td>' + esc(it.brand) + '</td><td>' + esc(it.cat) + '</td><td><button class="btn sm" data-add="' + esc(it.item) + '"><i class="fa-solid fa-plus"></i></button></td></tr>';
                    }).join('') + '</tbody></table>';
            }
            $('plb-q').oninput = draw; draw();
            $('plb-t').onclick = function (e) { var b = e.target.closest('[data-add]'); if (b) { padAddItem(padFind(b.getAttribute('data-add')), 1, PAD.mode); toast(b.getAttribute('data-add') + ' added.'); } };
            setTimeout(function () { $('plb-q').focus(); }, 30);
        } });
}

// ── wiring ─────────────────────────────────────────────────────
function padWire() {
    PAD.inited = true;
    $('cust-q').oninput = padCustSearch;
    $('cust-q').onkeydown = function (e) {
        var list = $('cust-list'), hits = PAD.custHits || [];
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault(); if (!hits.length) return;
            PAD.custIdx = ((PAD.custIdx == null ? -1 : PAD.custIdx) + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
            Array.prototype.forEach.call(list.querySelectorAll('.ta-item'), function (x, i) { x.classList.toggle('on', i === PAD.custIdx); if (i === PAD.custIdx) x.scrollIntoView({ block: 'nearest' }); });
        } else if (e.key === 'Enter' && hits.length) { e.preventDefault(); padSetCustomer(hits[Math.max(0, PAD.custIdx)]); }
        else if (e.key === 'Escape') list.hidden = true;
    };
    $('cust-list').onclick = function (e) { var x = e.target.closest('.ta-item'); if (x) padSetCustomer(PAD.custHits[+x.getAttribute('data-i')]); };
    $('item-q').oninput = padItemSearch;
    $('item-q').onkeydown = padItemKey;
    $('item-list').onclick = function (e) { var x = e.target.closest('.ta-item'); if (!x) return; padAddItem(PAD.itemHits[+x.getAttribute('data-i')], 1, PAD.mode); $('item-q').value = ''; $('item-list').hidden = true; $('item-q').focus(); };
    document.addEventListener('click', function (e) { if (!e.target.closest('.typeahead')) { $('cust-list').hidden = true; $('item-list').hidden = true; } });
    $('mode').onclick = function (e) { var b = e.target.closest('button[data-mode]'); if (b) { padSetMode(b.getAttribute('data-mode')); $('item-q').focus(); } };
    ['h-otype', 'h-wh', 'h-sub', 'h-rep', 'h-do', 'h-ship', 'h-terms', 'h-comments'].forEach(function (id) { $(id).onchange = function () { padReadHeader(); if (id === 'h-otype') padApplyDiscounts(); padChanged(id === 'h-otype'); }; });
    $('h-plist').onchange = $('h-pdate').onchange = function () { padReadHeader(); padReloadPrices(false); padChanged(false); };
    $('h-odate').onchange = function () { padReadHeader(); padApplyDiscounts(); padChanged(true); };
    $('h-po').onchange = $('h-ref').onchange = function () { padReadHeader(); padChanged(false); };
    $('hdr-more').onclick = function () { $('hdr-more-box').hidden = !$('hdr-more-box').hidden; };
    $('cart-body').addEventListener('change', function (e) {
        var tr = e.target.closest('tr[data-i]'), f = e.target.getAttribute('data-f'); if (!tr || !f) return;
        var l = PAD.order.lines[+tr.getAttribute('data-i')];
        if (f === 'qty') l.qty = Math.abs(omNum(e.target.value, 0));
        else if (f === 'discAdd') l.discAdd = omNum(e.target.value, 0);
        else l[f] = e.target.value;
        if (f === 'qty' || f === 'type') padApplyDiscounts();
        padChanged(true);
    });
    $('cart-body').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('input')) { e.target.blur(); $('item-q').focus(); } });
    $('cart-body').addEventListener('click', function (e) {
        var tr = e.target.closest('tr[data-i]'); if (!tr) return;
        var i = +tr.getAttribute('data-i');
        if (e.target.closest('[data-act="del"]')) { PAD.order.lines.splice(i, 1); PAD.sel = Math.min(i, PAD.order.lines.length - 1); padChanged(true); return; }
        if (PAD.sel !== i) { PAD.sel = i; Array.prototype.forEach.call(document.querySelectorAll('#cart-body tr'), function (r) { r.classList.toggle('sel', +r.getAttribute('data-i') === i); }); }
    });
    $('checks').onclick = function (e) {
        if (e.target.closest('[data-act="merge"]')) { padMergeDups(); return; }
        var li = e.target.closest('li[data-lines]'); if (!li) return;
        var ids = li.getAttribute('data-lines').split(','), i = PAD.order.lines.findIndex(function (l) { return ids.indexOf(l.id) >= 0; });
        if (i >= 0) { PAD.sel = i; padRender(); var r = document.querySelector('#cart-body tr[data-i="' + i + '"]'); if (r) r.scrollIntoView({ block: 'center' }); }
    };
    $('b-recheck').onclick = function () { PAD.live = {}; PAD.stockAt = {}; padRunLive(); };
    $('b-new').onclick = function () {
        if (PAD.order && PAD.order.dirty && PAD.order.lines.length && !padReadOnly()) omConfirm('New order', 'Start a new order? The current one has unsaved changes.', 'Start new', 'danger').then(function (ok) { if (ok) padNewOrder(); });
        else padNewOrder();
    };
    $('b-save').onclick = function () { padSave(false); };
    $('b-payload').onclick = padShowPayload;
    $('b-approve').onclick = padAskApproval;
    $('b-submit').onclick = function () { padSend(true); };
    $('b-fdraft').onclick = function () { padSend(false); };
    $('b-paste').onclick = padSmartPaste;
    $('b-repeat').onclick = padUsual;
    $('b-pl').onclick = padBrowsePl;
    document.addEventListener('keydown', function (e) {
        if ($('page-pad').hidden || !$('modal').hidden) return;
        if (e.key === 'F6') { e.preventDefault(); $('item-q').focus(); }
        else if (e.key === 'F7') { e.preventDefault(); $('cust-q').focus(); $('cust-q').select(); }
        else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); if (!$('b-submit').disabled) padSend(true); }
        else if ((e.key === 's' || e.key === 'S') && e.ctrlKey) { e.preventDefault(); if (!$('b-save').disabled) padSave(false); }
        else if (e.key === 'Delete' && PAD.sel >= 0 && !e.target.matches('input, textarea, select') && !padReadOnly()) { PAD.order.lines.splice(PAD.sel, 1); PAD.sel = Math.min(PAD.sel, PAD.order.lines.length - 1); padChanged(true); }
    });
    window.addEventListener('beforeunload', function () { if (PAD.order) padSaveLocal(); });
}
