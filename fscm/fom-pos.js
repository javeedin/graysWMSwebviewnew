/* Fusion Order Management — POS sales order (spec §4, §5): register the header (same dialog as Create Order), then a
   scan-to-sell ticket (barcode = item number + Enter adds qty 1 or increments), one tax code for the ticket, Complete Sale
   creates the Order Hub order (draft, or submitted when ticked), 80 mm receipt printed with window.print and a print
   stylesheet, "Order Editor" hands the ticket to a full create tab. */

FOM.POS = { hdr: null, lines: [], cache: {}, taxCode: '', sold: null };
FOM.posNew = function () { var P = FOM.POS; P.lines = []; P.sold = null; P.seq = FOM.genSeq(); P.orderNumber = P.hdr ? FOM.genOrderNo(P.hdr.orderType, P.hdr.orderDate, P.seq) : ''; P.last = null; };
FOM.viewPos = function (el) {
    var P = FOM.POS;
    if (!P.hdr) {
        el.innerHTML = '<div class="fom-pos-land card"><div class="ic"><i class="fa-solid fa-cash-register"></i></div><h2>Point of Sale</h2><p>Register the order first — business unit, customer, warehouse. Then scan barcodes to build the ticket: each scan adds the item with qty 1.</p><div class="row-btns" style="justify-content:center"><button class="btn primary" data-reg><i class="fa-solid fa-file-circle-plus"></i> Register New Order</button><button class="btn" data-so><i class="fa-solid fa-file-lines"></i> Sales Orders</button></div></div>';
        el.querySelector('[data-reg]').onclick = function () { FOM.posRegister(); };
        el.querySelector('[data-so]').onclick = function () { FX.show('orders'); };
        return;
    }
    if (!P.seq) FOM.posNew();
    var h = P.hdr;
    el.innerHTML = '<div class="fom-pos">' +
        '<div class="card fom-pos-l"><div class="fom-scan"><i class="fa-solid fa-barcode"></i><input id="fom-scan" placeholder="Scan or type an item number and press Enter" autocomplete="off"><span class="muted" data-scan-st></span></div><div data-ticket class="fom-ticket"></div></div>' +
        '<div class="fom-pos-r"><div class="card pad fom-pos-cust"><div class="row-btns"><span class="chip info">' + esc(h.businessUnit || '') + '</span><span class="grow"></span><button class="btn sm" data-chg><i class="fa-solid fa-user-pen"></i> Change Customer</button></div><b style="font-size:1.05rem">' + esc(h.customerName || '') + '</b><div class="muted" style="font-size:.78rem">Account ' + esc(h.accountNumber || '') + ' · ' + esc(h.paymentTerms || '') + '</div>' +
        '<details><summary class="muted" style="font-size:.74rem;cursor:pointer">Customer details</summary><div class="facts" style="margin-top:6px"><div><span>Warehouse</span>' + esc(h.warehouse || '') + '</div><div><span>Subinventory</span>' + esc(h.subinventory || '—') + '</div><div><span>Salesperson</span>' + esc(h.salesRep || '—') + '</div><div><span>Bill To</span>' + esc(h.billToAddress || '') + '</div><div><span>Ship To</span>' + esc(h.shipToAddress || '') + '</div></div></details></div>' +
        '<div class="card pad"><div class="row-btns"><span class="muted" style="font-size:.74rem">Order</span><b class="mono" data-ono></b><span class="grow"></span><label class="fom-chk">Tax <select class="fom-in" data-tax style="width:auto"><option value="">— none —</option></select></label></div><div class="fom-pos-tot" data-tot></div>' +
        '<button class="btn primary fom-pos-go" data-go><i class="fa-solid fa-circle-check"></i> COMPLETE SALE</button>' +
        '<div class="row-btns" style="margin-top:8px"><button class="btn sm" data-ed><i class="fa-solid fa-pen-to-square"></i> Order Editor</button><button class="btn sm" data-pr><i class="fa-solid fa-print"></i> Print ticket</button><button class="btn sm" data-api><i class="fa-solid fa-code"></i> API</button><span class="grow"></span><button class="btn sm danger" data-clr><i class="fa-solid fa-trash"></i> Clear</button></div>' +
        '<div class="row-btns" style="margin-top:8px"><label class="fom-chk"><input type="checkbox" data-sub' + (FOM.cfg('posSubmit') === 'Y' ? ' checked' : '') + '> Submit order on completion</label><label class="fom-chk"><input type="checkbox" data-sil' + (FOM.posSilent() ? ' checked' : '') + '> Silent print</label></div></div></div></div>';
    var q = function (s) { return el.querySelector(s); };
    FOM.taxCodes().then(function (l) { P.taxList = l; q('[data-tax]').innerHTML = FOM.taxOpts(l, P.taxCode); FOM.posDraw(el); });
    q('[data-tax]').onchange = function () { P.taxCode = this.value; FOM.posDraw(el); };
    q('[data-chg]').onclick = function () { FOM.posRegister(); };
    q('[data-clr]').onclick = function () { if (!P.lines.length) return; FOM.confirm('Clear ticket', 'Remove all ' + P.lines.length + ' line(s) from the ticket?', 'Clear', 'warn').then(function (ok) { if (ok) { FOM.posNew(); FOM.posDraw(el); } }); };
    q('[data-go]').onclick = function () { FOM.posComplete(el); };
    q('[data-pr]').onclick = function () { FOM.posPrint(); };
    q('[data-api]').onclick = function () { FOM.json('POST ' + FOM.u('salesOrdersForOrderHub'), FOM.posBody(q('[data-sub]').checked)); };
    q('[data-sil]').onchange = function () { try { localStorage.setItem('pos.silentPrint', this.checked ? 'Y' : 'N'); } catch (e) { } };
    q('[data-ed]').onclick = function () {
        if (!P.lines.length) { FX.toast('The ticket is empty', 'err'); return; }
        var lines = P.lines.map(function (l) { return { itemNumber: l.item, description: l.desc, uom: l.uom, qty: l.qty, unitPrice: l.price, costUnit: l.cost, taxCode: P.taxCode, taxPct: FOM.posPct(), taxAmount: FOM.r2(l.qty * l.price * FOM.posPct() / 100) }; });
        FOM.openEditor({ mode: 'create', hdr: Object.assign({}, P.hdr), posLines: lines }); FX.toast('Loaded ' + lines.length + ' POS line(s) into a new order', 'ok');
    };
    var scan = q('#fom-scan');
    scan.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); var v = scan.value.trim(); scan.value = ''; if (v) FOM.posScan(el, v); } };
    el.onclick = function (e) {
        var b = e.target.closest('[data-pa]'); if (!b) { if (!e.target.closest('input, select, button, textarea, summary, a')) scan.focus(); return; }
        var i = +b.getAttribute('data-i'), l = P.lines[i], a = b.getAttribute('data-pa');
        if (a === 'inc') l.qty++; else if (a === 'dec') l.qty--; else if (a === 'del') l.qty = 0;
        if (l.qty <= 0) P.lines.splice(i, 1);
        FOM.posDraw(el); scan.focus();
    };
    el.onchange = function (e) {
        var i = e.target.getAttribute('data-i'), f = e.target.getAttribute('data-pf'); if (i == null || !f) return;
        var l = P.lines[+i], v = FOM.n(e.target.value);
        if (f === 'qty') { l.qty = Math.round(v); if (l.qty <= 0) P.lines.splice(+i, 1); } else l.price = v;
        FOM.posDraw(el);
    };
    FOM.posDraw(el); setTimeout(function () { scan.focus(); }, 50);
};
FOM.posSilent = function () { try { var v = localStorage.getItem('pos.silentPrint'); return v ? v === 'Y' : FOM.cfg('posSilent') === 'Y'; } catch (e) { return false; } };
FOM.posRegister = function () {
    FOM.registerOrder({ title: 'Register POS order', onDone: function (h) { FOM.POS.hdr = h; FOM.posNew(); FX.show('pos'); } });
};
FOM.posPct = function () { var P = FOM.POS, t = (P.taxList || []).filter(function (x) { return x.code === P.taxCode; })[0]; return t ? t.pct : 0; };
FOM.posTotals = function () {
    var P = FOM.POS, pct = FOM.posPct();
    P.lines.forEach(function (l) { l.tax = FOM.r2(l.qty * l.price * pct / 100); });
    var sub = FOM.r2(FOM.sum(P.lines, function (l) { return l.qty * l.price; })), tax = FOM.r2(FOM.sum(P.lines, 'tax'));
    return { items: P.lines.length, units: FOM.sum(P.lines, 'qty'), sub: sub, tax: tax, total: FOM.r2(sub + tax), pct: pct };
};
FOM.posDraw = function (el) {
    var P = FOM.POS, t = FOM.posTotals(), c = P.hdr.txnCurrency || 'AED', q = function (s) { return el.querySelector(s); };
    if (!q('[data-ticket]')) return;
    q('[data-ono]').textContent = P.sold ? P.sold.orderNo : P.orderNumber;
    q('[data-ticket]').innerHTML = P.lines.length ? '<table class="tbl"><thead><tr><th>#</th><th>Item</th><th>Description</th><th class="n">Price</th><th class="n" style="width:140px">Qty</th><th class="n">Total</th><th></th></tr></thead><tbody>' + P.lines.map(function (l, i) {
        return '<tr class="' + (P.last === l.item ? 'fom-flash' : '') + '"><td class="muted">' + (i + 1) + '</td><td class="mono"><b>' + esc(l.item) + '</b></td><td>' + esc(l.desc) + (l.uom ? ' <span class="chip">' + esc(l.uom) + '</span>' : '') + (!l.price ? ' <span class="chip warn">no price</span>' : '') + '</td>' +
            '<td class="n"><input class="fom-in fom-num" type="number" step="any" data-pf="price" data-i="' + i + '" value="' + esc(l.price) + '" style="width:96px"></td>' +
            '<td class="n"><div class="fom-qty"><button class="btn sm icon" data-pa="dec" data-i="' + i + '">−</button><input class="fom-in fom-num" type="number" min="1" data-pf="qty" data-i="' + i + '" value="' + l.qty + '"><button class="btn sm icon" data-pa="inc" data-i="' + i + '">+</button></div></td>' +
            '<td class="n"><b>' + FOM.amt(l.qty * l.price) + '</b></td><td><button class="btn sm icon danger" data-pa="del" data-i="' + i + '"><i class="fa-solid fa-xmark"></i></button></td></tr>';
    }).join('') + '</tbody></table>' : '<div class="empty fom-empty-lines"><i class="fa-solid fa-barcode"></i><b>Ticket is empty</b><span>Scan a barcode or type an item number and press Enter.</span></div>';
    q('[data-tot]').innerHTML = '<div class="fom-tot"><span>Items / Units</span><b>' + t.items + ' / ' + FOM.qty(t.units) + '</b></div><div class="fom-tot"><span>Subtotal</span><b>' + FOM.amt(t.sub) + '</b></div><div class="fom-tot"><span>Tax' + (P.taxCode ? ' ' + esc(P.taxCode) + ' (' + t.pct + '%)' : '') + '</span><b>' + FOM.amt(t.tax) + '</b></div><div class="fom-tot grand big"><span>TOTAL</span><b>' + FOM.amt(t.total) + ' ' + esc(c) + '</b></div>' + (P.sold ? '<div class="note ok" style="margin-top:6px">Sale complete — order <b>' + esc(P.sold.orderNo) + '</b>. <button class="btn sm" data-new>New Sale</button></div>' : '');
    var nb = q('[data-new]'); if (nb) nb.onclick = function () { FOM.posNew(); FOM.posDraw(el); };
    q('[data-go]').disabled = !P.lines.length || !!P.sold;
};
FOM.posBeep = function (ok) { try { var a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = ok ? 1200 : 220; o.connect(g); g.connect(a.destination); g.gain.value = 0.08; o.start(); setTimeout(function () { o.stop(); a.close(); }, ok ? 80 : 300); } catch (e) { } };
FOM.posLookup = function (code) {
    var P = FOM.POS, k = code.toUpperCase();
    if (P.cache[k] !== undefined) return Promise.resolve(P.cache[k]);
    return Promise.all([
        FX.get('itemsV2', { q: "ItemNumber='" + code.replace(/'/g, "''") + "'", limit: 2 }).then(function (j) { return (j.items || [])[0] || null; }).catch(function () { return null; }),
        FX.get('itemCosts', { version: 'latest', q: 'ItemNumber=' + FOM.qv(code), limit: 100 }).then(function (j) { var rows = j.items || [], wh = P.hdr.warehouse; return rows.filter(function (r) { var v = FOM.parseVU(r.ValuationUnit); return v.invOrg === wh || v.costOrg === wh; })[0] || rows[0] || null; }).catch(function () { return null; })
    ]).then(function (r) {
        var it = r[0], c = r[1];
        var res = it || c ? { item: (it && it.ItemNumber) || (c && c.ItemNumber) || code, desc: (it && it.ItemDescription) || (c && c.ItemDescription) || '', uom: (it && (it.PrimaryUOMCode || it.PrimaryUOMValue)) || (c && (c.PrimaryUOMCode || c.UOMCode)) || '', cost: c ? FOM.costOf(c) : null } : null;
        P.cache[k] = res; return res;
    });
};
FOM.posScan = function (el, code) {
    var P = FOM.POS, st = el.querySelector('[data-scan-st]');
    if (P.sold) { FOM.posNew(); }
    var ex = P.lines.filter(function (l) { return l.item.toUpperCase() === code.toUpperCase(); })[0];
    if (ex) { ex.qty++; P.last = ex.item; FOM.posBeep(true); FOM.posDraw(el); return; }
    st.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
    FOM.posLookup(code).then(function (r) {
        st.innerHTML = '';
        if (!r) { FOM.posBeep(false); FX.toast('Item "' + code + '" not found in the item master', 'err'); return; }
        var again = P.lines.filter(function (l) { return l.item === r.item; })[0];
        if (again) again.qty++; else P.lines.push({ item: r.item, desc: r.desc, uom: r.uom, qty: 1, price: r.cost || 0, cost: r.cost });
        P.last = r.item; FOM.posBeep(true);
        if (!r.cost) FX.toast('No cost found for ' + r.item + ' — set the price on the ticket', 'err');
        FOM.posDraw(el);
    }).catch(function (e) { st.innerHTML = ''; FOM.posBeep(false); FX.toast(FOM.emsg(e), 'err'); });
};
FOM.posBody = function (submit) {
    var P = FOM.POS, h = P.hdr, pct = FOM.posPct();
    var b = FOM.headerBody(h, P.orderNumber, P.seq, { SubmittedFlag: submit ? 'true' : 'false', CustomerPONumber: P.orderNumber });
    b.lines = P.lines.map(function (l, i) {
        var id = String(P.seq * 100 + i + 1), tax = FOM.r2(l.qty * l.price * pct / 100);
        var x = { SourceTransactionLineId: id, SourceTransactionLineNumber: String(i + 1), SourceTransactionScheduleId: id, SourceScheduleNumber: id };
        if (l.uom) x.OrderedUOMCode = l.uom;
        Object.assign(x, { OrderedQuantity: l.qty, ProductNumber: l.item });
        if (h.subinventory) x.SubinventoryCode = h.subinventory; if (h.paymentTerms) x.PaymentTerms = h.paymentTerms;
        Object.assign(x, { InventoryTransactionFlag: !!h.invTxn, TransactionCategoryCode: 'ORDER', charges: [FOM.saleCharge(i, l.qty, l.price, tax, h.txnCurrency || 'AED')] });
        return x;
    });
    return b;
};
FOM.posComplete = function (el) {
    var P = FOM.POS; if (!P.lines.length || P.sold) return;
    var submit = el.querySelector('[data-sub]').checked, body = FOM.posBody(submit), btn = el.querySelector('[data-go]');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Creating order…';
    FOM.raw('POST', 'salesOrdersForOrderHub', { contentType: 'json' }, body).then(function (r) {
        btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> COMPLETE SALE';
        var j = r.json || {};
        if (!r.ok || !(j.OrderNumber || j.HeaderId)) {
            var m = j && j['o:errorDetails'] ? j['o:errorDetails'].map(function (d) { return d.detail; }).join('\n') : (j.detail || j.title || String(r.text || '').slice(0, 400));
            btn.disabled = false; FOM.alert('Sale not completed', esc(m || ('HTTP ' + r.status)), 'err'); return;
        }
        P.sold = { orderNo: j.OrderNumber || j.SourceTransactionNumber || P.orderNumber, headerId: j.HeaderId, status: j.StatusCode, at: new Date(), total: FOM.posTotals() };
        FOM.posDraw(el);
        if (FOM.posSilent()) FOM.posPrint();
        FOM.dlg({ title: '<i class="fa-solid fa-circle-check" style="color:var(--ok)"></i> Sale complete', body: '<div class="fom-result"><div class="big">' + esc(P.sold.orderNo) + '</div><div>' + FOM.amt(P.sold.total.total) + ' ' + esc(P.hdr.txnCurrency || '') + ' · ' + FOM.chip(P.sold.status || (submit ? 'DOO_SUBMITTED' : 'DOO_DRAFT')) + '</div></div>', buttons: [{ label: '<i class="fa-solid fa-print"></i> Print Receipt', act: 'print' }, { label: 'Open order', act: 'open' }, { label: 'New Sale', act: 'new', cls: 'primary' }], onAction: function (a) { if (a === 'print') { FOM.posPrint(); return false; } if (a === 'open') { FOM.openOrderBy(P.sold.orderNo, P.sold.headerId); return true; } if (a === 'new') { FOM.posNew(); FOM.posDraw(el); return true; } } });
    }).catch(function (e) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> COMPLETE SALE'; FOM.alert('Sale not completed', esc(FOM.emsg(e)), 'err'); });
};
/** 80 mm receipt → window.print with the receipt print stylesheet (fom.css). */
FOM.posReceiptHtml = function () {
    var P = FOM.POS, h = P.hdr, t = P.sold ? P.sold.total : FOM.posTotals(), c = h.txnCurrency || '', d = P.sold ? P.sold.at : new Date(), no = P.sold ? P.sold.orderNo : P.orderNumber;
    var p2 = function (x) { return ('0' + x).slice(-2); }, when = d.getDate() + '-' + _fomMon[d.getMonth()] + '-' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    return '<div class="rc-c"><b class="rc-big">' + esc(FOM.cfg('companyName')) + '</b><br>' + esc(h.businessUnit || '') + '<br>Warehouse: ' + esc(h.warehouse || '') + (h.subinventory ? ' / ' + esc(h.subinventory) : '') + '</div>' +
        '<div class="rc-stamp">' + (P.sold ? 'SALES RECEIPT' : 'PRE-SALE TICKET') + '</div>' +
        '<div>Order #: <b>' + esc(no) + '</b><br>Date: ' + when + '<br>Cashier: ' + esc(FX.user || 'POS') + '<br>Customer: ' + esc(h.customerName || '') + '<br>Account #: ' + esc(h.accountNumber || '') + '<br>Terms: ' + esc(h.paymentTerms || '') + '</div><hr>' +
        P.lines.map(function (l, i) { return '<div class="rc-l"><b>' + (i + 1) + '. ' + esc(l.item) + '</b><br>' + esc(l.desc) + '<div class="rc-r"><span>' + l.qty + ' ' + esc(l.uom || '') + ' @ ' + FOM.amt(l.price) + '</span><span>' + FOM.amt(l.qty * l.price) + '</span></div></div>'; }).join('') + '<hr>' +
        '<div class="rc-r"><span>Items / Units</span><span>' + t.items + ' / ' + t.units + '</span></div><div class="rc-r"><span>Subtotal</span><span>' + FOM.amt(t.sub) + '</span></div><div class="rc-r"><span>Tax ' + esc(P.taxCode || '') + (t.pct ? ' (' + t.pct + '%)' : '') + '</span><span>' + FOM.amt(t.tax) + '</span></div><div class="rc-r rc-big"><span>TOTAL ' + esc(c) + '</span><span>' + FOM.amt(t.total) + '</span></div><hr>' +
        '<div class="rc-c">' + (P.sold ? 'Thank you for your business!' : '*** NOT A RECEIPT — SALE NOT COMPLETED ***') + '<br><span class="rc-bar">*' + esc(no) + '*</span><br><small>Gray\'s WMS · Fusion Order Management</small></div>';
};
FOM.posPrint = function () {
    if (!FOM.POS.lines.length) { FX.toast('The ticket is empty', 'err'); return; }
    var r = document.getElementById('fom-receipt'); if (!r) { r = document.createElement('div'); r.id = 'fom-receipt'; document.body.appendChild(r); }
    r.innerHTML = FOM.posReceiptHtml();
    document.body.classList.add('fom-print-rc');
    var done = function () { document.body.classList.remove('fom-print-rc'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); setTimeout(done, 500); }, 30);
};
