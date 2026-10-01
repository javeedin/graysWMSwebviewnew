/* Fusion Order Management — Create / Change order editor (spec §3.3, §3.4).
   Modes: create (from the Register New Order dialog), edit (= change order), copy, return (RMA), draft (JSON), POS hand-off.
   One editor per workspace tab in the "create" view; each keeps its own state E. Lines are in fom-lines.js, the
   "Add Multiple Lines" sources in fom-add.js, sales credits / notes / credit check / validations / reservations /
   branch PO in fom-extra.js. */

// ── Register New Order (§3.3.8) → header ───────────────────────
/** opts: {title, onDone(hdr)} — default opens a create editor. */
FOM.registerOrder = function (opts) {
    opts = opts || {};
    var H = { orderType: FOM.cfg('orderType'), rate: 1, orderDate: FX.today(), currencyRateType: 'User', invTxn: false }, buList = [], types = [];
    var d = FOM.dlg({
        title: '<i class="fa-solid fa-file-circle-plus"></i> ' + (opts.title || 'Register New Order'), xwide: true,
        body: '<div class="fom-reg">' +
            '<section><h4>Order details</h4><div class="form">' +
            '<label>Business Unit <b class="r">*</b><select data-r="bu"><option value="">Loading…</option></select></label>' +
            '<label>Base Ccy <b class="r">*</b><input data-r="base" readonly></label>' +
            '<label>Txn Ccy <b class="r">*</b><select data-r="txn">' + FOM.opts(FOM.currencies(), '') + '</select></label>' +
            '<label>Rate<input data-r="rate" type="number" step="any" value="1"></label>' +
            '<label>Rate Type<select data-r="rtype">' + FOM.opts(['Corporate', 'Spot', 'User'], 'User') + '</select></label>' +
            '<label>Currency Date<input data-r="cdate" type="date" value="' + FX.today() + '"></label>' +
            '<label>Order Type <b class="r">*</b><select data-r="type"><option value="">Loading…</option></select></label>' +
            '<label>Order Date <b class="r">*</b><input data-r="date" type="date" value="' + FX.today() + '"></label>' +
            '<label data-branch hidden>Branch Business Unit <b class="r">*</b><select data-r="branch"></select></label></div><div data-bnote></div></section>' +
            '<section><h4>Customer</h4><div class="form"><label class="wide">Customer Name <b class="r">*</b><div class="fom-inbtn"><input data-r="cust" readonly placeholder="Search the customer…"><button class="btn" data-find><i class="fa-solid fa-magnifying-glass"></i> Find</button></div></label>' +
            '<label>Account #<input data-r="acct" readonly></label><label>Credit limit<input data-r="cl" readonly></label><label class="wide">Bill To Address<input data-r="bill" readonly></label><label class="wide">Ship To Address<input data-r="ship" readonly></label></div></section>' +
            '<section><h4>Terms &amp; fulfillment</h4><div class="form"><label>Payment Terms <b class="r">*</b><input data-r="terms" list="fom-reg-terms" placeholder="Type or pick"><datalist id="fom-reg-terms"></datalist></label>' +
            '<label>Sales Rep<input data-r="rep" list="fom-reg-reps" placeholder="Type or pick"><datalist id="fom-reg-reps"></datalist></label>' +
            '<label>Warehouse <b class="r">*</b><select data-r="wh"><option value="">Select a BU first</option></select></label><label>Sub Inventory<select data-r="sub"><option value=""></option></select></label>' +
            '<label class="wide fom-chk"><input type="checkbox" data-r="inv"> <span data-invt>Standard fulfillment (recommended)</span></label><label class="wide">Remarks<input data-r="rem"></label></div></section></div>' +
            '<div data-err></div>',
        buttons: [{ label: 'Cancel', act: 'close' }, { label: 'Proceed to Lines <i class="fa-solid fa-arrow-right"></i>', act: 'go', cls: 'primary' }],
        onAction: function (a, dd) {
            if (a !== 'go') return;
            var q = function (k) { return dd.q('[data-r="' + k + '"]'); };
            var bu = buList.filter(function (b) { return b.v === q('bu').value; })[0], ty = types.filter(function (t) { return t.v === q('type').value; })[0];
            Object.assign(H, { businessUnit: bu && bu.t, businessUnitId: bu && bu.v, baseCurrency: q('base').value, txnCurrency: q('txn').value, rate: FOM.num(q('rate').value), currencyRateType: q('rtype').value, currencyDate: q('cdate').value, orderType: q('type').value, orderDate: q('date').value, paymentTerms: q('terms').value.trim(), salesRep: q('rep').value.trim(), warehouse: q('wh').value, subinventory: q('sub').value, invTxn: q('inv').checked, remarks: q('rem').value.trim() });
            var rep = (FOM._reps || []).filter(function (r) { return r.v === H.salesRep; })[0]; H.salesRepId = rep ? rep.id : null;
            var br = buList.filter(function (b) { return b.v === q('branch').value; })[0]; H.branchBU = br ? br.t : ''; H.branchBUId = br ? br.v : '';
            var miss = [];
            if (!bu) miss.push('Business Unit'); if (!H.txnCurrency) miss.push('Txn Ccy'); if (!H.orderType) miss.push('Order Type'); if (!H.orderDate) miss.push('Order Date'); if (!H.customerName) miss.push('Customer'); if (!H.paymentTerms) miss.push('Payment Terms'); if (!H.warehouse) miss.push('Warehouse');
            if (ty && ty.branch && !H.branchBU) miss.push('Branch Business Unit');
            if (ty && ty.branch && H.invTxn && !H.subinventory) miss.push('Subinventory (required for inventory transactions)');
            if (miss.length) { dd.q('[data-err]').innerHTML = '<div class="note err">Missing: ' + esc(miss.join(', ')) + '</div>'; return false; }
            H.isBranch = !!(ty && ty.branch);
            if (opts.onDone) opts.onDone(H); else FOM.openEditor({ mode: 'create', hdr: H });
            return true;
        },
        onOpen: function (dd) {
            var q = function (k) { return dd.q('[data-r="' + k + '"]'); };
            function enable(on) { dd.qa('.fom-reg section:not(:first-child) input, .fom-reg section:not(:first-child) select, .fom-reg section:not(:first-child) button, [data-r="txn"], [data-r="rate"], [data-r="rtype"], [data-r="cdate"], [data-r="type"], [data-r="date"]').forEach(function (x) { if (!x.readOnly) x.disabled = !on; }); }
            enable(false);
            FOM.bus().then(function (l) { buList = l; q('bu').innerHTML = '<option value="">Select…</option>' + l.map(function (b) { return '<option value="' + esc(b.v) + '">' + esc(b.t + (b.ccy ? ' — ' + b.ccy : '')) + '</option>'; }).join(''); q('branch').innerHTML = '<option value="">Select…</option>' + FOM.opts(l, ''); }).catch(function (e) { q('bu').innerHTML = '<option value="">(could not load)</option>'; FX.toast(FOM.emsg(e), 'err'); });
            FOM.orderTypes().then(function (l) { types = l; q('type').innerHTML = '<option value="">Select…</option>' + l.map(function (t) { return '<option value="' + esc(t.v) + '"' + (t.v === H.orderType ? ' selected' : '') + '>' + esc(t.t) + (t.branch ? ' — BRANCH SALES' : '') + '</option>'; }).join('') + (l.some(function (t) { return t.v === H.orderType; }) ? '' : '<option selected value="' + esc(H.orderType) + '">' + esc(H.orderType) + '</option>'); typeChange(); }).catch(function () { q('type').innerHTML = FOM.opts([H.orderType], H.orderType); });
            FOM.paymentTerms().then(function (l) { dd.q('#fom-reg-terms').innerHTML = l.map(function (t) { return '<option value="' + esc(t) + '">'; }).join(''); });
            FOM.salesReps().then(function (l) { FOM._reps = l; dd.q('#fom-reg-reps').innerHTML = l.map(function (t) { return '<option value="' + esc(t.v) + '">'; }).join(''); });
            q('bu').onchange = function () {
                var bu = buList.filter(function (b) { return b.v === q('bu').value; })[0]; enable(!!bu);
                q('base').value = bu ? bu.ccy || '' : ''; if (bu && bu.ccy) { q('txn').value = bu.ccy; if (q('txn').value !== bu.ccy) q('txn').insertAdjacentHTML('beforeend', '<option selected>' + esc(bu.ccy) + '</option>'); } rateChange();
                q('wh').innerHTML = '<option value="">Loading…</option>'; q('sub').innerHTML = '<option value=""></option>';
                if (bu) FOM.orgsForBu(bu.v, bu.t).then(function (l) { q('wh').innerHTML = '<option value="">Select…</option>' + FOM.opts(l, ''); });
            };
            q('wh').onchange = function () { q('sub').innerHTML = '<option value="">Loading…</option>'; FOM.subinvs(q('wh').value).then(function (l) { q('sub').innerHTML = '<option value=""></option>' + FOM.opts(l, ''); }).catch(function () { q('sub').innerHTML = '<option value=""></option>'; }); };
            function rateChange() {
                var b = q('base').value, t = q('txn').value; q('rtype').value = 'User'; q('cdate').value = q('date').value;
                if (!b || !t || b === t) { q('rate').value = 1; return; }
                q('rate').value = ''; q('rate').placeholder = 'Looking up…';
                FOM.dailyRate(t, b, q('date').value).then(function (r) { if (r == null) { q('rate').placeholder = 'No rate — please enter manually'; } else q('rate').value = r; });
            }
            q('txn').onchange = rateChange;
            function typeChange() {
                var ty = types.filter(function (t) { return t.v === q('type').value; })[0], br = !!(ty && ty.branch);
                dd.q('[data-branch]').hidden = !br; q('inv').checked = br; invText();
                dd.q('[data-bnote]').innerHTML = '';
                if (br) FOM.branchPoCode(ty.v).then(function (c) { dd.q('[data-bnote]').innerHTML = '<div class="note">Branch sales order — a linked branch purchase order' + (c ? ' with the <b>' + esc(c) + '</b> prefix' : '') + ' is created after saving.</div>'; });
            }
            function invText() { dd.q('[data-invt]').textContent = q('inv').checked ? 'Direct inventory transaction' : 'Standard fulfillment (recommended)'; }
            q('type').onchange = typeChange; q('inv').onchange = invText;
            dd.q('[data-find]').onclick = function () {
                var bu = buList.filter(function (b) { return b.v === q('bu').value; })[0];
                FOM.findCustomer(bu && bu.v, bu && bu.t).then(function (c) {
                    if (!c) return; var f = FOM.custFill(c); Object.assign(H, f);
                    q('cust').value = f.customerName; q('acct').value = f.accountNumber; q('bill').value = f.billToAddress; q('ship').value = f.shipToAddress; q('cl').value = f.creditLimit != null ? FOM.amt(f.creditLimit) : '';
                });
            };
        }
    });
    return d;
};

// ── open editor ────────────────────────────────────────────────
FOM.edSeq = 0;
/** opts: {mode: create|edit|copy|return|draft, hdr, order, lines, draft, posLines} */
FOM.openEditor = function (opts) {
    var id, label;
    if (opts.mode === 'edit') { id = 'e_' + (opts.order.HeaderId || opts.order.OrderKey); label = 'Edit ' + (opts.order.OrderNumber || opts.order.SourceTransactionNumber); }
    else { FOM.edSeq++; id = 'n_' + FOM.edSeq + '_' + Date.now(); label = opts.mode === 'copy' ? 'Copy Order' : opts.mode === 'return' ? 'Return ' + (opts.order.OrderNumber || '') : 'New Order ' + FOM.edSeq; }
    FOM.open('create', { id: id, label: label, icon: opts.mode === 'return' ? 'fa-rotate-left' : opts.mode === 'edit' ? 'fa-pen' : 'fa-file-circle-plus', build: function (el, t) { t.E = FOM.Editor(el, opts, t); } });
};
FOM.viewCreate = function (el) {
    if (!FOM.wsTabs('create').some(function (t) { return t.id === 'c_start'; })) FOM.ws.tabs.push({ id: 'c_start', area: 'create', label: 'Start', icon: 'fa-flag', closable: false, el: (function () { var e = document.createElement('div'); e.className = 'fom-wsp'; FOM.buildStart(e); return e; })() });
    el.classList.add('fom-ws');
    FOM.renderWs('create', el, '');
};
FOM.buildStart = function (el) {
    el.innerHTML = '<div class="fom-start">' +
        '<div class="tile" data-s="new"><div class="ic" style="background:linear-gradient(135deg,#fb923c,#c2410c)"><i class="fa-solid fa-file-circle-plus"></i></div><div><b>Create new order</b><span>Register the header — business unit, customer, warehouse — then add lines and save it as a draft.</span></div></div>' +
        '<div class="tile" data-s="pos"><div class="ic" style="background:linear-gradient(135deg,#34d399,#047857)"><i class="fa-solid fa-cash-register"></i></div><div><b>POS sales order</b><span>Scan barcodes to build a ticket, complete the sale and print an 80 mm receipt.</span></div></div>' +
        '<div class="tile" data-s="json"><div class="ic" style="background:linear-gradient(135deg,#a78bfa,#6d28d9)"><i class="fa-solid fa-file-import"></i></div><div><b>Load from JSON</b><span>Open a draft saved with "Save JSON" (sales-order-….json).</span></div></div></div>' +
        '<div class="card pad" style="max-width:760px"><h4>Change an existing order</h4><div class="row-btns"><input class="fom-in" data-on placeholder="Order number or source transaction number" style="flex:1"><button class="btn primary" data-oe><i class="fa-solid fa-pen"></i> Edit order</button><button class="btn" data-ov><i class="fa-solid fa-eye"></i> View</button></div><div class="muted" style="font-size:.74rem;margin-top:6px">Change order = header type/date, add lines, change quantities, cancel lines, charges, sales credits, notes, instructions, additional information.</div></div>' +
        '<input type="file" accept=".json,application/json" data-file hidden>';
    var q = function (s) { return el.querySelector(s); };
    el.querySelector('.fom-start').onclick = function (e) { var t = e.target.closest('[data-s]'); if (!t) return; var s = t.getAttribute('data-s'); if (s === 'new') FOM.registerOrder(); else if (s === 'pos') FX.show('pos'); else q('[data-file]').click(); };
    q('[data-file]').onchange = function () { var f = this.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { try { var j = JSON.parse(r.result); FOM.openEditor({ mode: 'draft', draft: j }); } catch (er) { FX.toast('Not a JSON draft: ' + er.message, 'err'); } }; r.readAsText(f); this.value = ''; };
    function find(cb) {
        var v = q('[data-on]').value.trim(); if (!v) { FX.toast('Enter an order number', 'err'); return; }
        FX.busy('Finding order ' + v + '…');
        FX.get('salesOrdersForOrderHub', { q: 'OrderNumber=' + FOM.qv(v), limit: 1, onlyData: false }).then(function (j) {
            if (j.items && j.items[0]) return j.items[0];
            return FX.get('salesOrdersForOrderHub', { q: 'SourceTransactionNumber=' + FOM.qv(v), limit: 1, onlyData: false }).then(function (j2) { return (j2.items || [])[0]; });
        }).then(function (o) { FX.busy(); if (!o) { FX.toast('Order ' + v + ' not found', 'err'); return; } cb(o); }).catch(function (e) { FX.busy(); FX.toast(FOM.emsg(e), 'err'); });
    }
    q('[data-oe]').onclick = function () { find(function (o) { FOM.openEditor({ mode: 'edit', order: o }); }); };
    q('[data-ov]').onclick = function () { find(function (o) { FOM.openOrder(o); }); };
    q('[data-on]').onkeydown = function (e) { if (e.key === 'Enter') q('[data-oe]').click(); };
};

// ── helpers shared by editor + POS ─────────────────────────────
FOM.newLine = function (o) { return Object.assign({ key: 'L' + Math.random().toString(36).slice(2, 9), itemNumber: '', description: '', uom: '', qty: 1, unitPrice: 0, costUnit: null, taxCode: '', taxPct: 0, taxAmount: 0, lot: '', lots: [], qoh: null, effVals: {} }, o || {}); };
FOM.lineTotal = function (l) { return l.loadedExt != null ? l.loadedExt : FOM.r2(FOM.n(l.qty) * FOM.n(l.unitPrice)); };
FOM.lineTax = function (l) { l.taxAmount = FOM.r2(FOM.n(l.qty) * FOM.n(l.unitPrice) * FOM.n(l.taxPct) / 100); return l.taxAmount; };
FOM.genSeq = function () { return Math.floor(Date.now() / 1000) % 100000; };
FOM.genOrderNo = function (type, date, seq) { return (type || 'SO') + String(date || FX.today()).slice(0, 7).replace('-', '') + seq; };
/** QP_SALE_PRICE charge with 4 components (§3.3.18). */
FOM.saleCharge = function (i, qty, price, tax, ccy) {
    var ext = FOM.r2(price * qty), tu = qty ? FOM.r2(tax / qty) : 0, s = 'C' + (i + 1);
    var c = { SourceChargeId: s, ApplyTo: 'Price', PricedQuantity: qty, GSAUnitPrice: price, PriceType: 'One time', ChargeType: 'Sale', ChargeSubType: 'Price', ChargeCurrencyCode: ccy, SequenceNumber: 1, ChargeDefinitionCode: 'QP_SALE_PRICE', PrimaryFlag: 'true', RollupFlag: 'false', chargeComponents: [
        { SourceChargeComponentId: s + '-CC1', PriceElementCode: 'QP_LIST_PRICE', PriceElementUsageCode: 'LIST_PRICE', HeaderCurrencyUnitPrice: price, HeaderCurrencyExtendedAmount: ext, RollupFlag: 'false', SequenceNumber: 1 },
        { SourceChargeComponentId: s + '-CC2', PriceElementCode: 'QP_NET_PRICE', PriceElementUsageCode: 'NET_PRICE', HeaderCurrencyUnitPrice: price, HeaderCurrencyExtendedAmount: ext, RollupFlag: 'false', SequenceNumber: 2 },
        { SourceChargeComponentId: s + '-CC3', PriceElementCode: 'QP_EXCLUSIVE_TAX', PriceElementUsageCode: 'EXCLUSIVE_TAX', HeaderCurrencyUnitPrice: tu, HeaderCurrencyExtendedAmount: FOM.r2(tax), RollupFlag: 'false', SequenceNumber: 3 },
        { SourceChargeComponentId: s + '-CC4', PriceElementCode: 'QP_NET_PRICE_PLUS_TAX', PriceElementUsageCode: 'NET_PRICE_PLUS_TAX', HeaderCurrencyUnitPrice: FOM.r2(price + tu), HeaderCurrencyExtendedAmount: FOM.r2(ext + tax), RollupFlag: 'false', SequenceNumber: 4 }] };
    if (!ccy) delete c.ChargeCurrencyCode;
    return c;
};
/** Header part of the create body shared by the editor and POS. */
FOM.headerBody = function (h, srcNo, seq, extra) {
    var d = FOM.iso0(h.orderDate);
    var b = { SourceTransactionNumber: srcNo, SourceTransactionSystem: FOM.cfg('srcSystem'), SourceTransactionId: 'APEX:' + seq, TransactionalCurrencyCode: h.txnCurrency || 'AED' };
    if (h.rate != null && h.rate !== '' && h.txnCurrency && h.baseCurrency && h.txnCurrency !== h.baseCurrency) { b.CurrencyConversionRate = +h.rate; b.CurrencyConversionType = h.currencyRateType || 'User'; b.CurrencyConversionDate = FOM.iso0(h.currencyDate || h.orderDate); }
    Object.assign(b, { BusinessUnitId: +h.businessUnitId, RequestingBusinessUnitId: +h.businessUnitId, BuyingPartyNumber: h.accountNumber, RequestedShipDate: d, TransactionOn: d, TransactionTypeCode: h.orderType, TransactionType: h.orderType, SubmittedFlag: 'false', FreezePriceFlag: 'true', FreezeShippingChargeFlag: 'true', FreezeTaxFlag: 'true', PaymentTerms: h.paymentTerms, RequestedFulfillmentOrganizationCode: h.warehouse, CustomerPONumber: h.customerPONumber || srcNo });
    var bt = {}; if (h.custAccountId) bt.CustomerAccountId = +h.custAccountId || h.custAccountId; if (h.billToSite) bt.SiteUseId = +h.billToSite || h.billToSite;
    var st = {}; if (h.partyId) st.PartyId = String(h.partyId); if (h.shipToSite) st.SiteId = +h.shipToSite || h.shipToSite;
    if (Object.keys(bt).length) b.billToCustomer = [bt]; if (Object.keys(st).length) b.shipToCustomer = [st];
    return Object.assign(b, extra || {});
};

// ── editor ─────────────────────────────────────────────────────
FOM.Editor = function (el, opts, tab) {
    var E = { el: el, tab: tab, mode: opts.mode === 'draft' ? 'create' : opts.mode, hdr: {}, lines: [], errors: [], discAmt: 0, expAmt: 0, seq: FOM.genSeq(), status: '', hdrEffVals: {}, hdrEffSel: 0, salesCredits: [], rawLines: [], taxList: [], resCount: null, hdrLocked: true, instr: {}, orderTypes: [] };
    E.isEdit = function () { return E.mode === 'edit'; };
    E.isReturn = function () { return E.mode === 'return'; };
    E.saved = function () { return !!E.orderKey; };
    E.isDraft = function () { return !E.status || /DRAFT/i.test(E.status); };
    E.ccy = function () { return E.hdr.txnCurrency || ''; };
    E.orderPath = function () { return E.orderSelf || 'salesOrdersForOrderHub/' + FOM.okey(E.orderKey); };
    E.q = function (s) { return el.querySelector(s); };
    E.qa = function (s) { return Array.prototype.slice.call(el.querySelectorAll(s)); };

    // initial header + lines per mode
    var o = opts.order;
    if (opts.mode === 'create') { E.hdr = Object.assign({}, opts.hdr); (opts.posLines || []).forEach(function (l) { E.lines.push(FOM.newLine(l)); }); }
    if (opts.mode === 'draft') { var dj = opts.draft || {}; E.hdr = Object.assign({}, dj.header || dj.Header || dj.hdr || {}); (dj.lines || dj.Lines || []).forEach(function (l) { E.lines.push(FOM.newLine(Object.assign({}, l, { existing: false, key: undefined }))); E.lines[E.lines.length - 1].key = 'L' + Math.random().toString(36).slice(2, 9); }); E.discAmt = FOM.n(dj.discAmt); E.expAmt = FOM.n(dj.expAmt); if (dj.orderNumber) E.orderNumber = dj.orderNumber; }
    if (o) {
        E.hdr = { businessUnit: o.BusinessUnitName, businessUnitId: o.BusinessUnitId || o.RequestingBusinessUnitId, txnCurrency: o.TransactionalCurrencyCode || o.AppliedCurrencyCode || o.CurrencyCode || o.TransactionalCurrencyName || 'AED', orderType: o.TransactionTypeCode || o.TransactionType, orderDate: opts.mode === 'edit' ? String(o.TransactionOn || FX.today()).slice(0, 10) : FX.today(), customerName: o.BuyingPartyName, accountNumber: o.BuyingPartyNumber, paymentTerms: o.PaymentTerms || o.PaymentTermsCode, warehouse: o.RequestedFulfillmentOrganizationCode, rate: o.CurrencyConversionRate || 1, currencyRateType: o.CurrencyConversionType || 'Corporate', currencyDate: o.CurrencyConversionDate ? String(o.CurrencyConversionDate).slice(0, 10) : '', customerPONumber: opts.mode === 'edit' ? o.CustomerPONumber : '' };
        E.hdr.baseCurrency = E.hdr.txnCurrency;
        E.instr = { pack: o.PackingInstructions || '', ship: o.ShippingInstructions || '', fob: o.FOBPointCode || o.FOBPoint || '' };
        if (opts.mode === 'edit') { E.editOrder = o; E.orderKey = o.OrderKey || o.HeaderId; E.headerId = o.HeaderId; E.orderSelf = FOM.self(o); E.fusionNo = o.OrderNumber; E.orderNumber = o.SourceTransactionNumber || o.OrderNumber; E.status = o.StatusCode || ''; E.submitted = FOM.yes(o.SubmittedFlag); E.hdr.customerPONumber = o.CustomerPONumber; }
    }
    if (!E.orderNumber) E.orderNumber = FOM.genOrderNo(E.hdr.orderType, E.hdr.orderDate, E.seq);
    if (!E.hdr.customerPONumber) E.hdr.customerPONumber = E.orderNumber;
    if (E.hdr.rate == null) E.hdr.rate = 1;

    E.toast = function (t, k) { FX.toast(t, k); };
    E.drawTitle = function () { if (E.q('[data-title]')) FOM.edTitle(E); };
    E.drawToolbar = function () { if (E.q('[data-tb]')) FOM.edToolbar(E); };
    E.drawHeader = function () { if (E.hdrPane) FOM.edHeaderPane(E); E.drawTitle(); };
    E.recalc = function () { FOM.edRecalc(E); };
    E.renderLines = function () { }; E.drawLinesHead = function () { };
    E.render = function () { FOM.edRender(E); };
    E.render();
    FOM.edInit(E, opts);
    tab.onShow = function () { };
    return E;
};
/** Loads LOVs / EFF metadata, and per mode the order's lines, references and children. */
FOM.edInit = function (E, opts) {
    FOM.taxCodes().then(function (l) { E.taxList = l; E.lines.forEach(function (ln) { if (ln.taxPct && !ln.taxCode) { var m = l.filter(function (t) { return Math.abs(t.pct - ln.taxPct) < 0.01; }); if (m.length === 1) ln.taxCode = m[0].code; } }); E.renderLines(); E.drawHeader(); });
    FOM.orderTypes().then(function (l) { E.orderTypes = l; var t = l.filter(function (x) { return x.v === E.hdr.orderType; })[0]; E.isBranch = !!(t && t.branch); if (E.isBranch && E.mode === 'create' && E.hdr.invTxn == null) E.hdr.invTxn = true; if (E.isBranch) FOM.branchPoCode(t.v).then(function (c) { E.branchPoCode = c; E.drawHeader(); }); E.drawHeader(); E.drawToolbar(); }).catch(function () { });
    FOM.effContexts('header').then(function (c) { E.hdrCtxs = c; if (E.htabs) E.htabs.reload('add'); });
    FOM.effContexts('line').then(function (c) { E.lineCtxs = c; E.lineMeta = FOM.lineEffMeta(c); E.drawLinesHead(); });
    if (E.isReturn()) FOM.returnReasons().then(function (l) { E.returnReasons = l; E.renderLines(); });
    if (E.mode === 'create' && (opts.mode === 'create' || opts.mode === 'draft') && !E.hdr.baseCurrency && E.hdr.businessUnitId) FOM.buById(E.hdr.businessUnitId).then(function (b) { if (b) { E.hdr.baseCurrency = b.ccy; E.drawHeader(); } });
    var o = opts.order; if (!o) return;
    if (E.isEdit()) {
        E.loading = true; E.renderLines();
        FOM.edLoadLines(E).then(function () {
            E.loading = false;
            FOM.orderCustomerRefs(o, E.rawLines).then(function (r) { Object.assign(E.hdr, r); E.drawHeader(); });
            FOM.edLoadHeaderEff(E);
            FOM.edLoadLineEff(E);
            FOM.edLoadCredits(E);
            FOM.edResCount(E);
        }).catch(function (e) { E.loading = false; E.renderLines(); FX.toast(FOM.emsg(e), 'err'); });
        FOM.buById(E.hdr.businessUnitId).then(function (b) { if (b && b.ccy) { E.hdr.baseCurrency = b.ccy; E.drawHeader(); } });
        return;
    }
    // copy / return: header refs from the order, lines from the given lines
    var src = opts.lines || [];
    var p = src.length ? Promise.resolve(src) : FOM.orderLines(o);
    p.then(function (lines) {
        FOM.orderCustomerRefs(o, lines).then(function (r) { Object.assign(E.hdr, r); E.hdr.subinventory = E.hdr.subinventory || (lines[0] && lines[0].SubinventoryCode) || ''; E.drawHeader(); });
        FOM.buById(E.hdr.businessUnitId).then(function (b) { if (b && b.ccy) { E.hdr.baseCurrency = b.ccy; E.drawHeader(); } });
        if (E.mode === 'copy') {
            E.lines = lines.filter(function (l) { return !FOM.yes(l.CanceledFlag); }).map(function (l) { return FOM.newLine({ itemNumber: FOM.pf(l, ['ProductNumber', 'ItemNumber']), description: FOM.pf(l, ['ProductDescription', 'ItemDescription', 'ProductDescriptionText']), uom: FOM.pf(l, ['OrderedUOMCode', 'OrderedUOM']), qty: FOM.n(l.OrderedQuantity), unitPrice: FOM.n(FOM.pf(l, ['UnitSellingPrice', 'UnitListPrice', 'UnitPrice'])), taxCode: FOM.pf(l, ['TaxClassificationCode', 'TaxClassification']) || '' }); });
            E.lines.forEach(function (l) { var t = E.taxList.filter(function (x) { return x.code === l.taxCode; })[0]; if (t) { l.taxPct = t.pct; FOM.lineTax(l); } });
            E.renderLines(); E.recalc(); return;
        }
        // return
        E.lines = lines.map(function (l) { return FOM.newLine({ returnLine: true, itemNumber: FOM.pf(l, ['ProductNumber', 'ItemNumber']), description: l.ProductDescription, uom: FOM.pf(l, ['OrderedUOMCode', 'OrderedUOM']), qty: FOM.n(l.OrderedQuantity), maxQty: FOM.n(l.OrderedQuantity), unitPrice: FOM.n(l.UnitSellingPrice), returnReason: FOM.cfg('returnReason'), refOrderNumber: o.OrderNumber, refHeaderId: o.HeaderId, refLineId: l.LineId || l.SourceTransactionLineId, refFulfillLineId: l.FulfillLineId, refLineNumber: l.DisplayLineNumber || l.LineNumber, orgCode: l.RequestedFulfillmentOrganizationCode, retLots: [] }); });
        E.renderLines(); E.recalc();
        FOM.mapLimit(E.lines, 4, function (ln) {
            return FOM.shippedLotSerials(ln.itemNumber, ln.orgCode || E.hdr.warehouse, [o.OrderNumber, o.SourceTransactionNumber]).then(function (r) {
                if (r.length) { ln.retLots = r; ln.lot = FOM.distinct(r.map(function (x) { return x.lot; })).join(', '); ln.qty = FOM.sum(r, 'qty'); ln.maxQty = Math.max(ln.maxQty, ln.qty); }
            }).catch(function () { });
        }).then(function () { E.renderLines(); E.recalc(); });
    });
};
/** fetchOrderCustomerRefs (§3.4) */
FOM.orderCustomerRefs = function (o, lines) {
    var p = lines && lines.length ? Promise.resolve(lines) : FOM.orderLines(o).catch(function () { return []; });
    return p.then(function (ls) {
        var l = ls[0] || {}, bh = FOM.childHref(l, ['billtocustomer']), sh = FOM.childHref(l, ['shiptocustomer']);
        return Promise.all([bh ? FOM.get(bh, { limit: 1 }).then(function (j) { return (j.items || [])[0] || {}; }).catch(function () { return {}; }) : {}, sh ? FOM.get(sh, { limit: 1 }).then(function (j) { return (j.items || [])[0] || {}; }).catch(function () { return {}; }) : {}]).then(function (r) {
            var b = r[0], s = r[1];
            var out = { custAccountId: FOM.pf(b, ['CustomerAccountId', 'AccountId', 'BillToCustomerId']) || FOM.pf(l, ['SoldToCustomerId', 'BillToCustomerId', 'CustomerAccountId']) || '', billToSite: FOM.pf(b, ['SiteUseId', 'CustomerAccountSiteUseId', 'BillToSiteUseId']) || FOM.pf(l, ['BillToCustomerUseId', 'BillToSiteUseId']) || '', partyId: FOM.pf(s, ['PartyId', 'ShipToPartyId']) || FOM.pf(l, ['ShipToPartyId', 'PartyId']) || '', shipToSite: FOM.pf(s, ['SiteId', 'PartySiteId', 'ShipToPartySiteId', 'SiteUseId']) || FOM.pf(l, ['ShipToPartySiteId', 'ShipToPartySiteUseId']) || '' };
            var addr = function (x) { return [x.Address1 || x.AddressLine1, x.Address2, x.City, x.Country].filter(Boolean).join(', '); };
            if (addr(b)) out.billToAddress = addr(b); if (addr(s)) out.shipToAddress = addr(s);
            if ((!out.custAccountId || !out.billToSite) && (o.BuyingPartyNumber || o.SoldToPartyNumber)) {
                return FOM.searchCustomers(o.BusinessUnitId, o.BuyingPartyNumber || o.SoldToPartyNumber, 'account').then(function (cs) { var c = cs[0]; if (c) { var f = FOM.custFill(c); Object.keys(f).forEach(function (k) { if (!out[k] && f[k]) out[k] = f[k]; }); } return out; }).catch(function () { return out; });
            }
            return out;
        });
    });
};
/** fetchShippedLotSerials (§3.3.4) → [{lot, serial, qty}] */
FOM.expandSerials = function (from, to) {
    if (!to || to === from) return [from];
    var a = String(from).match(/^(.*?)(\d+)$/), b = String(to).match(/^(.*?)(\d+)$/);
    if (!a || !b || a[1] !== b[1]) return [from, to];
    var out = [], w = a[2].length; for (var n = +a[2]; n <= +b[2] && out.length < 5000; n++) { var s = String(n); while (s.length < w) s = '0' + s; out.push(a[1] + s); }
    return out;
};
FOM.shippedLotSerials = function (item, org, orders) {
    orders = FOM.distinct(orders || []);
    var i = 0;
    function next() {
        if (i >= orders.length || !org) return Promise.resolve([]);
        var ord = orders[i++];
        return FOM.get('inventoryCompletedTransactions', { q: 'OrganizationCode=' + org + ';ItemNumber=' + FOM.qv(item) + ';TransactionType="Sales order issue";TransactionSourceName=' + FOM.qv(ord), expand: 'lots,lots.lotSerials,serials', limit: 200 }).then(function (j) {
            var out = [];
            (j.items || []).forEach(function (t) {
                (t.lots || []).forEach(function (l) {
                    var ser = [];
                    (l.lotSerials || []).forEach(function (s) { ser = ser.concat(FOM.expandSerials(s.FmSerialNumber || s.SerialNumber, s.ToSerialNumber)); });
                    if (ser.length) ser.forEach(function (s) { out.push({ lot: l.LotNumber, serial: s, qty: 1 }); }); else out.push({ lot: l.LotNumber, serial: '', qty: Math.abs(FOM.n(l.TransactionQuantity || t.TransactionQuantity)) });
                });
                if (!(t.lots || []).length) (t.serials || []).forEach(function (s) { FOM.expandSerials(s.FmSerialNumber || s.SerialNumber, s.ToSerialNumber).forEach(function (x) { out.push({ lot: '', serial: x, qty: 1 }); }); });
            });
            return out.length ? out : next();
        }).catch(function () { return next(); });
    }
    return next();
};
/** Edit mode: lines with charges + lot serials → grid lines (§3.3.14). */
FOM.edLoadLines = function (E) {
    return FOM.orderLines(E.editOrder, 'charges.chargeComponents,lotSerials').then(function (raw) {
        E.rawLines = raw;
        E.lines = raw.map(FOM.mapExistingLine);
        E.lines.forEach(function (ln) { if (ln.taxPct && !ln.taxCode) { var m = E.taxList.filter(function (t) { return Math.abs(t.pct - ln.taxPct) < 0.01; }); if (m.length === 1) ln.taxCode = m[0].code; } });
        if (!E.hdr.subinventory && E.lines[0]) E.hdr.subinventory = E.lines[0].subinventory || '';
        E.renderLines(); E.recalc(); E.drawToolbar(); E.drawHeader();
    });
};
FOM.mapExistingLine = function (l) {
    var ch = l.charges || [];
    var sale = ch.filter(function (c) { return c.ChargeDefinitionCode === 'QP_SALE_PRICE'; })[0] || ch.filter(function (c) { return /^price$/i.test(c.ApplyToCode || c.ApplyTo || ''); })[0] || ch.filter(function (c) { return FOM.yes(c.PrimaryFlag); })[0] || ch[0];
    var comp = function (c, code) { return ((c && c.chargeComponents) || []).filter(function (x) { return x.PriceElementCode === code; })[0]; };
    var tc = comp(sale, 'QP_EXCLUSIVE_TAX'), net = comp(sale, 'QP_NET_PRICE') || comp(sale, 'QP_LIST_PRICE');
    var tax = tc ? FOM.r2(FOM.n(FOM.pf(tc, ['HeaderCurrencyExtendedAmount', 'ChargeCurrencyExtendedAmount']))) : FOM.r2(FOM.n(FOM.pf(l, ['TaxAmount', 'TotalTax'])));
    var price = FOM.n(FOM.pf(l, ['UnitSellingPrice', 'UnitListPrice'])), qty = FOM.n(l.OrderedQuantity);
    var ext = net ? FOM.num(net.HeaderCurrencyExtendedAmount) : FOM.num(l.ExtendedAmount);
    var other = ch.filter(function (c) { return c !== sale; }).reduce(function (s, c) { var n2 = comp(c, 'QP_NET_PRICE'); return s + FOM.n(n2 ? n2.HeaderCurrencyExtendedAmount : c.GSAUnitPrice); }, 0);
    var subK = Object.keys(l).filter(function (k) { return /subinventory/i.test(k) && l[k]; })[0];
    var st = FOM.pf(l, ['DisplayStatus', 'Status']) || '';
    return FOM.newLine({
        existing: true, itemNumber: l.ProductNumber, description: l.ProductDescription, uom: l.OrderedUOMCode || l.OrderedUOM, qty: qty, unitPrice: price, origQty: qty, origUnitPrice: price,
        taxCode: FOM.pf(l, ['TaxClassificationCode', 'TaxClassification', 'TaxCode']) || (tc && FOM.pf(tc, ['TaxRateName', 'TaxClassificationCode', 'TaxCode'])) || '', taxAmount: tax, loadedTax: tax, taxPct: (ext || price * qty) ? FOM.r2(tax / (ext || price * qty) * 100) : 0,
        loadedExt: ext, chargeAmount: FOM.r2(other), status: st, statusCode: l.StatusCode || '', canceled: FOM.yes(l.CanceledFlag) || /cancel/i.test(st + ' ' + (l.StatusCode || '')),
        srcLineId: l.SourceTransactionLineId, srcLineNumber: l.SourceTransactionLineNumber, srcScheduleNumber: FOM.pf(l, ['SourceScheduleNumber', 'SourceTransactionScheduleId']), fulfillLineId: l.FulfillLineId, lineHref: FOM.self(l),
        chargesHref: FOM.childHref(l, ['charges']), lotSerialsHref: FOM.childHref(l, ['lotserials']), lineLots: l.lotSerials || [], orgCode: FOM.pf(l, ['RequestedFulfillmentOrganizationCode', 'FulfillmentOrganizationCode', 'OrganizationCode']), subinventory: subK ? l[subK] : '', raw: l
    });
};
FOM.edLoadHeaderEff = function (E) {
    var base = E.orderSelf || FOM.orderBase(E.editOrder);
    return FOM.effRows(base).then(function (rows) {
        var r = rows[0]; if (!r) return;
        E.hdrEffKnown = r; E.hdrEffVals = Object.assign({}, r.vals);
        if (E.hdrEffVals.branchBusinessUnit) E.hdr.branchBU = E.hdr.branchBU || E.hdrEffVals.branchBusinessUnit, E.branchLocked = true;
        var ix = (E.hdrCtxs || []).map(function (c) { return c.voName; }).indexOf(r.voName); if (ix >= 0) E.hdrEffSel = ix;
        if (E.htabs) E.htabs.reload('add'); E.drawHeader();
    }).catch(function () { });
};
FOM.edLoadLineEff = function (E) {
    return FOM.mapLimit(E.lines.filter(function (l) { return l.lineHref; }), 4, function (l) { return FOM.effRows(l.lineHref).then(function (r) { if (r[0]) { l.effVals = Object.assign({}, r[0].vals); l.effKnown = r[0]; } }).catch(function () { }); }).then(function () { E.lineEffLoaded = true; if (E.ltabs) E.ltabs.reload('add'); });
};
FOM.edResCount = function (E) {
    if (!E.saved() || E.isReturn()) return;
    FOM.fetchReservations(E.orderNumber, FOM.distinct(E.lines.map(function (l) { return l.itemNumber; }))).then(function (r) { E.resCount = r.length; E.reservations = r; E.drawToolbar(); }).catch(function () { });
};

// ── rendering ──────────────────────────────────────────────────
FOM.edRender = function (E) {
    E.el.innerHTML = '<div class="card fom-eh"><div class="fom-oh-top"><div data-title></div><span class="grow"></span><div data-tl></div></div><div class="acts" data-tb></div></div>' +
        '<div class="card" data-htabs></div>' +
        '<div class="card" data-lcard><div class="fom-lh" data-lh></div><div data-ltabs></div></div>';
    E.htabs = FOM.tabs(E.q('[data-htabs]'), [
        { id: 'hdr', label: 'Header', icon: 'fa-file-lines', render: function (p) { E.hdrPane = p; E.drawHeader(); } },
        { id: 'addr', fresh: true, label: 'Customer Address', icon: 'fa-location-dot', render: function (p) { FOM.edAddress(E, p); } },
        { id: 'add', label: 'Additional Info', icon: 'fa-tags', render: function (p) { FOM.edHeaderEff(E, p); } },
        { id: 'notes', label: 'Notes & Attachments', icon: 'fa-paperclip', render: function (p) { FOM.edNotes(E, p); } },
        { id: 'credit', label: 'Customer Credit Check', icon: 'fa-scale-balanced', render: function (p) { FOM.edCredit(E, p); } },
        { id: 'val', label: 'Order Validations', icon: 'fa-list-check', render: function (p) { FOM.edValidations(E, p); } }
    ]);
    E.drawTitle(); E.drawToolbar();
    FOM.edLinesInit(E);
};
/** Title + timeline */
FOM.edTitle = function (E) {
    var h = E.hdr, t = E.isReturn() ? 'Return Order (RMA)' : E.isEdit() ? 'Edit Sales Order' : 'New Sales Order';
    var chips = (E.isEdit() ? '<span class="chip info">EDIT MODE · rev ' + ((+(E.editOrder.SourceTransactionRevisionNumber || 1)) + 1) + '</span>' : '') + (E.isReturn() ? '<span class="chip warn">RETURN · ref ' + esc(E.lines[0] && E.lines[0].refOrderNumber || '') + '</span>' : '') + (E.saved() || E.isEdit() ? FOM.chip(E.status || 'DOO_DRAFT') : '<span class="chip">not saved</span>') + (E.fusionNo ? '<span class="chip done">Fusion #' + esc(E.fusionNo) + '</span>' : '');
    E.q('[data-title]').innerHTML = '<div class="muted" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.4px">' + t + '</div><h2>' + esc(E.orderNumber) + ' <span class="muted" style="font-weight:500;font-size:.85rem">' + esc([h.orderType, E.ccy(), h.customerName].filter(Boolean).join(' · ')) + (E.isBranch && h.branchBU ? ' · ' + esc(h.businessUnit) + ' → ' + esc(h.branchBU) : '') + '</span></h2><div class="row-btns" style="margin-top:4px">' + chips + '</div>';
    var raw = E.rawLines.length ? E.rawLines : E.lines.map(function (l) { return { Status: l.status, StatusCode: l.statusCode, CanceledFlag: l.canceled }; });
    E.q('[data-tl]').innerHTML = E.saved() ? FOM.timeline(FOM.orderStage({ StatusCode: E.status || 'DOO_DRAFT' }, raw)) : '';
};
FOM.edToolbar = function (E) {
    var anyStat = function (re) { return E.lines.some(function (l) { return re.test((l.status || '') + ' ' + (l.statusCode || '')); }); };
    var nOps = E.isEdit() ? FOM.edOps(E).length : 0;
    var h = (E.isEdit() ? '<button class="btn" data-t="refresh"><i class="fa-solid fa-rotate"></i> Refresh</button>' : '') +
        '<button class="btn" data-t="json"><i class="fa-solid fa-code"></i> JSON <i class="fa-solid fa-caret-down"></i></button>' +
        '<button class="btn" data-t="validate"><i class="fa-solid fa-list-check"></i> Validate Order</button>' +
        (E.isEdit() ? '<button class="btn primary" data-t="update"' + (nOps ? '' : ' disabled') + '><i class="fa-solid fa-floppy-disk"></i> Update Order (' + nOps + ')</button>'
            : '<button class="btn primary" data-t="save"' + (E.saved() ? ' disabled title="Already saved — use Change Order to edit it"' : '') + '><i class="fa-solid fa-floppy-disk"></i> ' + (E.isReturn() ? 'Save Return (Draft)' : 'Save (Draft)') + '</button>');
    if (E.saved()) {
        if (E.isDraft()) h += '<button class="btn ok" data-t="confirm"><i class="fa-solid fa-circle-check"></i> Confirm Order</button>';
        if (!E.isReturn()) h += '<button class="btn" data-t="res"><i class="fa-solid fa-lock"></i> Reservations' + (E.resCount != null ? ' (' + E.resCount + ')' : '') + '</button>';
        if (anyStat(/awaiting\s*shipping/i)) h += '<button class="btn ok" data-t="ship"><i class="fa-solid fa-truck-fast"></i> Auto Ship Confirm</button>';
        if (anyStat(/awaiting\s*billing/i)) h += '<button class="btn ok" data-t="ar"><i class="fa-solid fa-file-invoice"></i> Push to AR</button>';
        if (E.isBranch) h += '<button class="btn" data-t="bpo"><i class="fa-solid fa-code-branch"></i> Branch PO</button>';
        h += '<button class="btn" data-t="actions">Order Actions <i class="fa-solid fa-caret-down"></i></button>';
    }
    E.q('[data-tb]').innerHTML = h;
    E.q('[data-tb]').onclick = function (e) {
        var b = e.target.closest('[data-t]'); if (!b) return; var t = b.getAttribute('data-t');
        if (t === 'refresh') FOM.edRefresh(E);
        else if (t === 'json') FOM.menu(b, [['Save JSON draft', 'fa-download', function () { FOM.edSaveJson(E); }], ['Load JSON draft', 'fa-upload', function () { FOM.edLoadJson(E); }], ['Payload preview', 'fa-eye', function () { FOM.edPayloadPreview(E); }]]);
        else if (t === 'validate') { E.htabs.show('val'); FOM.edRunValidations(E); }
        else if (t === 'save') FOM.edSave(E);
        else if (t === 'update') FOM.edUpdate(E);
        else if (t === 'confirm') FOM.edConfirm(E);
        else if (t === 'res') FOM.edReservations(E);
        else if (t === 'ship') FOM.autoShipDlg(E.orderNumber, E.hdr.warehouse, function () { FOM.edRefreshStatuses(E); });
        else if (t === 'ar') FOM.autoInvoiceDlg(E.orderNumber, E.hdr.businessUnitId);
        else if (t === 'bpo') FOM.branchPoDlg(E);
        else if (t === 'actions') {
            var items = [['Open order view', 'fa-eye', function () { FOM.openOrderBy(E.fusionNo, E.headerId); }], ['Order totals', 'fa-calculator', function () { FOM.totalsDlg({ OrderKey: E.orderKey, HeaderId: E.headerId, OrderNumber: E.fusionNo, links: E.editOrder && E.editOrder.links }); }]];
            if (E.isEdit() && E.rawLines.length) items.push(['Copy to New Order', 'fa-copy', function () { FOM.openEditor({ mode: 'copy', order: E.editOrder, lines: E.rawLines }); }]);
            if (E.isDraft()) { items.push(['Discard Draft', 'fa-trash', function () { FOM.edDiscard(E); }, 'danger']); items.push(['Cancel Order (cancel all lines)', 'fa-ban', function () { FOM.edCancelOrder(E); }, 'danger']); }
            else items.push(['Cancel Order', 'fa-ban', function () { FOM.edCancelOrder(E); }, 'danger']);
            FOM.menu(b, items);
        }
    };
};
FOM.menu = function (btn, items) {
    var old = document.querySelector('.fom-menu'); if (old) old.remove();
    var m = document.createElement('div'); m.className = 'fom-menu';
    m.innerHTML = items.map(function (it, i) { return '<button data-mi="' + i + '" class="' + (it[3] || '') + '"><i class="fa-solid ' + it[1] + '"></i> ' + esc(it[0]) + '</button>'; }).join('');
    document.body.appendChild(m);
    var r = btn.getBoundingClientRect(); m.style.top = (r.bottom + 4) + 'px'; m.style.left = Math.min(r.left, window.innerWidth - 250) + 'px';
    m.onclick = function (e) { var b = e.target.closest('[data-mi]'); if (b) { m.remove(); items[+b.getAttribute('data-mi')][2](); } };
    setTimeout(function () { document.addEventListener('mousedown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off); } }); }, 0);
};
/** Header tab (4 columns) */
FOM.edHeaderPane = function (E) {
    var p = E.hdrPane; if (!p) return;
    var h = E.hdr, ed = E.isEdit(), lock = ed && E.hdrLocked, draft = E.isDraft();
    var sel = function (k, list, v, dis, blank) { return '<select data-h="' + k + '"' + (dis ? ' disabled' : '') + '>' + FOM.opts(list, v, blank) + '</select>'; };
    var types = E.orderTypes.length ? E.orderTypes : [{ v: h.orderType, t: h.orderType }];
    var credits = E.salesCredits.map(function (c) { return c.Salesperson || c.SalespersonName || ('#' + (c.SalespersonId || '')); });
    p.innerHTML = '<div class="fom-hcols">' +
        '<section><h4><i class="fa-solid fa-file-lines"></i> Order</h4><div class="form one">' +
        '<label>Order No<input value="' + esc(E.orderNumber) + '" readonly></label>' +
        '<label>Business Unit<select data-h="businessUnitId"' + (ed || E.saved() ? ' disabled' : '') + '><option value="' + esc(h.businessUnitId || '') + '">' + esc(h.businessUnit || '') + '</option></select></label>' +
        '<label>Order Date<input type="date" data-h="orderDate" value="' + esc(h.orderDate || '') + '"' + (lock ? ' disabled' : '') + '></label>' +
        '<label>Order Type' + sel('orderType', types.map(function (t) { return { v: t.v, t: t.t + (t.branch ? ' — BRANCH' : '') }; }), h.orderType, lock) + '</label>' +
        (ed ? '<div class="row-btns">' + (E.hdrLocked ? '<button class="btn sm" data-hx="unlock"><i class="fa-solid fa-pen"></i> Edit type / date</button>' : '<button class="btn sm primary" data-hx="savehdr"><i class="fa-solid fa-floppy-disk"></i> Save</button><button class="btn sm" data-hx="lock">Cancel</button>') + '</div>' : '') +
        '<label>Customer PO<input data-h="customerPONumber" value="' + esc(h.customerPONumber || '') + '"></label>' +
        (E.isBranch ? '<label>Branch BU <b class="r">*</b><select data-h="branchBU"' + (E.branchLocked ? ' disabled' : '') + ' data-bus><option>' + esc(h.branchBU || '') + '</option></select></label><div class="note" style="font-size:.72rem">Will create a linked PO' + (E.branchPoCode ? ' with the ' + esc(E.branchPoCode) + '- prefix' : '') + '.</div>' : '') +
        '</div></section>' +
        '<section><h4><i class="fa-solid fa-user"></i> Customer information</h4><div class="form one">' +
        '<label>Customer Name<div class="fom-inbtn"><input value="' + esc(h.customerName || '') + '" readonly><button class="btn sm" data-hx="cust"' + (ed && h.customerName ? ' disabled title="The buying party cannot change on an existing order"' : '') + '><i class="fa-solid fa-magnifying-glass"></i></button></div></label>' +
        '<label>Cust Number<input value="' + esc(h.accountNumber || '') + '" readonly></label>' +
        '<label>Payment Terms<input data-h="paymentTerms" list="fom-pt-' + E.tab.id + '" value="' + esc(h.paymentTerms || '') + '"' + (ed ? ' disabled' : '') + '><datalist id="fom-pt-' + E.tab.id + '"></datalist></label>' +
        (ed ? '<label>Salesperson<div class="fom-inbtn"><input value="' + esc(credits.join(', ')) + '" readonly placeholder="No sales credits"><button class="btn sm" data-hx="credits" title="Sales credits"><i class="fa-solid fa-pen"></i></button></div></label>'
            : '<label>Salesperson<input data-h="salesRep" list="fom-sr-' + E.tab.id + '" value="' + esc(h.salesRep || '') + '"><datalist id="fom-sr-' + E.tab.id + '"></datalist></label>') +
        (h.creditLimit != null ? '<label>Credit limit<input value="' + FOM.amt(h.creditLimit) + '" readonly></label>' : '') +
        '</div></section>' +
        '<section><h4><i class="fa-solid fa-warehouse"></i> Warehouse</h4><div class="form one">' +
        '<label>Warehouse<select data-h="warehouse" data-wh><option value="' + esc(h.warehouse || '') + '">' + esc(h.warehouse || '—') + '</option></select></label>' +
        '<label>Sub Inventory<select data-h="subinventory" data-sub><option value="' + esc(h.subinventory || '') + '">' + esc(h.subinventory || '') + '</option></select></label>' +
        '<label class="fom-chk"><input type="checkbox" data-h="invTxn"' + (h.invTxn ? ' checked' : '') + '> Inventory transaction</label>' +
        '<label>Base Currency<input value="' + esc(h.baseCurrency || '') + '" readonly></label>' +
        '<label>Default Tax Code<select data-hx="deftax">' + FOM.taxOpts(E.taxList, E.defTax || '', '— keep line codes —') + '</select></label>' +
        '</div></section>' +
        '<section class="fom-totsec"><h4><i class="fa-solid fa-coins"></i> Totals</h4><div class="form two">' +
        '<label>Txn Currency' + sel('txnCurrency', FOM.currencies(), h.txnCurrency, ed) + '</label><label>Rate<input type="number" step="any" data-h="rate" value="' + esc(h.rate == null ? '' : h.rate) + '"' + (ed ? ' disabled' : '') + '></label>' +
        '<label>Rate Type' + sel('currencyRateType', ['Corporate', 'Spot', 'User'], h.currencyRateType || 'User', ed) + '</label><label>Currency Date<input type="date" data-h="currencyDate" value="' + esc(h.currencyDate || '') + '"' + (ed ? ' disabled' : '') + '></label></div>' +
        '<div class="fom-tots" data-tots></div></section></div>';
    var q = function (s) { return p.querySelector(s); };
    if (!ed && !E.saved()) FOM.bus().then(function (l) { var s = q('[data-h="businessUnitId"]'); if (s) s.innerHTML = '<option value="">Select…</option>' + FOM.opts(l, h.businessUnitId); });
    if (E.isBranch) FOM.bus().then(function (l) { var s = q('[data-bus]'); if (s) s.innerHTML = '<option value="">Select…</option>' + FOM.opts(l.map(function (b) { return { v: b.t, t: b.t }; }), h.branchBU); });
    FOM.paymentTerms().then(function (l) { var d = p.querySelector('datalist[id^="fom-pt"]'); if (d) d.innerHTML = l.map(function (x) { return '<option value="' + esc(x) + '">'; }).join(''); });
    FOM.salesReps().then(function (l) { FOM._reps = l; var d = p.querySelector('datalist[id^="fom-sr"]'); if (d) d.innerHTML = l.map(function (x) { return '<option value="' + esc(x.v) + '">'; }).join(''); });
    if (h.businessUnitId) FOM.orgsForBu(h.businessUnitId, h.businessUnit).then(function (l) { var s = q('[data-wh]'); if (s) s.innerHTML = '<option value="">Select…</option>' + FOM.opts(l, h.warehouse); });
    FOM.subinvs(h.warehouse).then(function (l) { var s = q('[data-sub]'); if (s) s.innerHTML = '<option value=""></option>' + FOM.opts(l, h.subinventory); }).catch(function () { });
    p.onchange = function (e) {
        var t = e.target, k = t.getAttribute('data-h');
        if (t.getAttribute('data-hx') === 'deftax') { E.defTax = t.value; var tx = E.taxList.filter(function (x) { return x.code === t.value; })[0]; if (tx) { E.lines.forEach(function (l) { if (!l.canceled && !(E.isEdit() && l.existing)) { l.taxCode = tx.code; l.taxPct = tx.pct; FOM.lineTax(l); } }); E.renderLines(); E.recalc(); } return; }
        if (!k) return;
        var v = t.type === 'checkbox' ? t.checked : t.value;
        if (k === 'rate') v = FOM.num(v);
        if (k === 'businessUnitId') { FOM.bus().then(function (l) { var b = l.filter(function (x) { return x.v === v; })[0]; h.businessUnit = b ? b.t : ''; h.baseCurrency = b ? b.ccy : ''; h.warehouse = ''; h.subinventory = ''; E.drawHeader(); }); }
        h[k] = v;
        if (k === 'warehouse') { h.subinventory = ''; FOM.subinvs(v).then(function (l) { var s = q('[data-sub]'); if (s) s.innerHTML = '<option value=""></option>' + FOM.opts(l, ''); }); }
        if (k === 'orderType') { var ty = E.orderTypes.filter(function (x) { return x.v === v; })[0]; E.isBranch = !!(ty && ty.branch); if (E.isBranch) { h.invTxn = true; FOM.branchPoCode(v).then(function (c) { E.branchPoCode = c; E.drawHeader(); }); } if (!E.saved() && !E.isEdit()) { E.orderNumber = FOM.genOrderNo(v, h.orderDate, E.seq); if (!h.customerPONumber || /^\w+\d{6}\d+$/.test(h.customerPONumber)) h.customerPONumber = E.orderNumber; } E.drawHeader(); }
        if (k === 'txnCurrency' || (k === 'orderDate' && !ed)) { h.currencyRateType = 'User'; h.currencyDate = h.orderDate; if (h.baseCurrency && h.txnCurrency === h.baseCurrency) h.rate = 1; else if (k === 'txnCurrency') FOM.dailyRate(h.txnCurrency, h.baseCurrency, h.orderDate).then(function (r) { h.rate = r; if (r == null) FX.toast('No daily rate found — please enter the rate manually', 'err'); E.drawHeader(); }); E.drawHeader(); }
        if (k === 'salesRep') { var rep = (FOM._reps || []).filter(function (r) { return r.v === v; })[0]; h.salesRepId = rep ? rep.id : null; }
        if (k === 'invTxn') E.renderLines();
        E.drawTitle(); E.recalc();
    };
    p.oninput = function (e) { var k = e.target.getAttribute('data-h'); if (k === 'customerPONumber' || k === 'rate') { h[k] = k === 'rate' ? FOM.num(e.target.value) : e.target.value; E.recalc(); } };
    p.onclick = function (e) {
        var b = e.target.closest('[data-hx]'); if (!b || b.tagName === 'SELECT') return; var x = b.getAttribute('data-hx');
        if (x === 'unlock') { E.hdrLocked = false; E.drawHeader(); }
        else if (x === 'lock') { E.hdrLocked = true; E.drawHeader(); }
        else if (x === 'savehdr') FOM.edSaveHeaderLock(E);
        else if (x === 'credits') E.ltabs.show('credits');
        else if (x === 'cust') FOM.findCustomer(h.businessUnitId, h.businessUnit).then(function (c) { if (c) { Object.assign(h, FOM.custFill(c)); E.drawHeader(); E.drawTitle(); if (E.htabs) E.htabs.reload('addr'); } });
    };
    E.recalc();
};
FOM.edTotals = function (E) {
    var ls = E.lines.filter(function (l) { return !l.canceled; });
    var gross = FOM.r2(FOM.sum(ls, function (l) { return FOM.n(l.qty) * FOM.n(l.unitPrice); })), tax = FOM.r2(FOM.sum(ls, 'taxAmount')), chg = FOM.r2(FOM.sum(ls, 'chargeAmount'));
    var net = FOM.r2(gross + tax + chg + FOM.n(E.expAmt) - FOM.n(E.discAmt));
    return { qty: FOM.sum(ls, 'qty'), gross: gross, tax: tax, charges: chg, net: net, netBase: FOM.r2(net * (FOM.num(E.hdr.rate) || 1)), lineTotal: FOM.r2(FOM.sum(ls, FOM.lineTotal)) };
};
FOM.edRecalc = function (E) {
    var t = FOM.edTotals(E), c = E.ccy(), box = E.hdrPane && E.hdrPane.querySelector('[data-tots]');
    if (box) {
        box.innerHTML = '<div class="fom-tot"><span>Gross</span><b>' + FOM.amt(t.gross) + '</b></div><div class="fom-tot"><span>Tax (from lines)</span><b>' + FOM.amt(t.tax) + '</b></div>' + (t.charges ? '<div class="fom-tot"><span>Charges</span><b class="fom-a" data-ft>' + FOM.amt(t.charges) + '</b></div>' : '') +
            '<div class="fom-tot"><span>Discount</span><input type="number" step="any" data-disc value="' + esc(E.discAmt || '') + '" placeholder="0.00"></div><div class="fom-tot"><span>Expense</span><input type="number" step="any" data-exp value="' + esc(E.expAmt || '') + '" placeholder="0.00"></div>' +
            '<div class="fom-tot grand"><span>Net (' + esc(c) + ')</span><b' + (E.saved() ? ' class="fom-a" data-ft title="Fusion totals"' : '') + '>' + FOM.amt(t.net) + '</b></div><div class="fom-tot"><span>Net (Base ' + esc(E.hdr.baseCurrency || '') + ')</span><b>' + FOM.amt(t.netBase) + '</b></div>';
        box.querySelector('[data-disc]').oninput = function () { E.discAmt = FOM.n(this.value); FOM.edRecalcSoft(E); };
        box.querySelector('[data-exp]').oninput = function () { E.expAmt = FOM.n(this.value); FOM.edRecalcSoft(E); };
        box.onclick = function (e) { if (e.target.closest('[data-ft]') && E.saved()) FOM.totalsDlg({ OrderKey: E.orderKey, HeaderId: E.headerId, OrderNumber: E.fusionNo, TransactionalCurrencyCode: c }); };
    }
    FOM.edLineTotals(E, t);
};
FOM.edRecalcSoft = function (E) { var t = FOM.edTotals(E), box = E.hdrPane && E.hdrPane.querySelector('[data-tots]'); if (box) { var g = box.querySelectorAll('.grand b')[0], nb = box.lastChild.querySelector('b'); if (g) g.textContent = FOM.amt(t.net); if (nb) nb.textContent = FOM.amt(t.netBase); } FOM.edLineTotals(E, t); };
FOM.edAddress = function (E, p) {
    var h = E.hdr, f = [['Cust Account Id', h.custAccountId], ['Party Id', h.partyId], ['Bill To Site Use Id', h.billToSite], ['Ship To Party Site Id', h.shipToSite], ['Account Number', h.accountNumber], ['Customer', h.customerName], ['Bill To Address', h.billToAddress], ['Ship To Address', h.shipToAddress]];
    p.innerHTML = '<div style="padding:12px 14px"><div class="facts">' + f.map(function (x) { return '<div><span>' + x[0] + '</span>' + (x[1] ? esc(x[1]) : '<span class="muted">—</span>') + '</div>'; }).join('') + '</div>' + (!h.custAccountId || !h.billToSite ? '<div class="note warn" style="margin-top:10px">Bill-to account / site missing — Fusion will default them from the customer, or pick the customer again.</div>' : '') + '</div>';
};
FOM.edHeaderEff = function (E, p) {
    var ctxs = E.hdrCtxs || FOM.EFF_FB.header, c = ctxs[E.hdrEffSel] || ctxs[0];
    p.innerHTML = '<div style="padding:12px 14px;display:flex;flex-direction:column;gap:12px"><div class="row-btns"><b style="font-size:.82rem">Additional information</b><select class="fom-in" data-ctx style="max-width:280px">' + ctxs.map(function (x, i) { return '<option value="' + i + '"' + (x === c ? ' selected' : '') + '>' + esc(x.contextCode) + '</option>'; }).join('') + '</select><span class="muted mono" style="font-size:.66rem">' + esc(c.voName) + '</span><span class="grow"></span>' +
        (E.saved() ? '<button class="btn sm primary" data-se><i class="fa-solid fa-floppy-disk"></i> ' + (E.hdrEffKnown ? 'Update' : 'Save') + ' Additional Info</button>' : '<span class="muted" style="font-size:.74rem">Sent with the order when you save.</span>') + '</div>' +
        '<div class="form">' + c.segs.map(function (s) { var auto = FOM.edAutoSeg(E, s.name); return '<label>' + esc(s.label) + '<input data-seg="' + esc(s.name) + '" value="' + esc(E.hdrEffVals[s.name] != null ? E.hdrEffVals[s.name] : '') + '"' + (auto != null ? ' placeholder="auto: ' + esc(auto) + '"' : '') + '></label>'; }).join('') + '</div>' +
        '<h4>Shipping &amp; packing instructions</h4><div class="form"><label class="wide">Packing instructions<textarea rows="2" data-in="pack">' + esc(E.instr.pack || '') + '</textarea></label><label class="wide">Shipping instructions<textarea rows="2" data-in="ship">' + esc(E.instr.ship || '') + '</textarea></label><label>FOB point<select data-in="fob">' + FOM.opts([{ v: '', t: '—' }, { v: 'Destination', t: 'Destination' }, { v: 'Origin', t: 'Origin' }], E.instr.fob) + '</select></label></div>' +
        '<div class="row-btns"><button class="btn sm" data-si' + (E.saved() ? '' : ' disabled title="Save the order first"') + '><i class="fa-solid fa-floppy-disk"></i> Save Instructions</button></div></div>';
    p.querySelector('[data-ctx]').onchange = function () { E.hdrEffSel = +this.value; E.htabs.reload('add'); };
    p.oninput = function (e) { var s = e.target.getAttribute('data-seg'); if (s) E.hdrEffVals[s] = e.target.value; var i = e.target.getAttribute('data-in'); if (i) E.instr[i] = e.target.value; };
    p.onchange = p.oninput;
    var se = p.querySelector('[data-se]'); if (se) se.onclick = function () { FOM.edSaveHeaderEff(E, se); };
    p.querySelector('[data-si]').onclick = function () {
        var body = { PackingInstructions: E.instr.pack || null, ShippingInstructions: E.instr.ship || null, FOBPointCode: E.instr.fob || null };
        if (E.isEdit() && E.isBranch && E.hdr.branchBU && body.PackingInstructions && body.PackingInstructions.indexOf('Branch BU:') !== 0) body.PackingInstructions = 'Branch BU: ' + E.hdr.branchBU + '\n' + body.PackingInstructions;
        FOM.write('PATCH', E.orderPath(), body, { contentType: null }).then(function () { FX.toast('Instructions saved.', 'ok'); }).catch(function (er) { FOM.alert('Save instructions failed', esc(FOM.emsg(er)), 'err'); });
    };
};
/** Auto-synced header segments: branch BU / branch sales order / credit limit. */
FOM.edAutoSeg = function (E, name) {
    var n = String(name).toLowerCase();
    if (E.isBranch && /branch/.test(n) && /business/.test(n)) return E.hdr.branchBU || null;
    if (E.isBranch && (/branchsalesorder/.test(n) || (/order/.test(n) && !/type/.test(n)))) return E.orderNumber;
    if (/creditlimit/.test(n) && E.hdr.creditLimit != null) return String(E.hdr.creditLimit);
    return null;
};
FOM.edHeaderEffVals = function (E) {
    var ctxs = E.hdrCtxs || FOM.EFF_FB.header, c = ctxs[E.hdrEffSel] || ctxs[0], vals = {};
    c.segs.forEach(function (s) { var v = E.hdrEffVals[s.name]; if (v == null || v === '') v = FOM.edAutoSeg(E, s.name); if (v != null && v !== '') vals[s.name] = v; });
    return { ctx: c, vals: vals };
};
FOM.edSaveHeaderEff = function (E, btn) {
    var x = FOM.edHeaderEffVals(E);
    if (!Object.keys(x.vals).length) { FX.toast('Enter at least one value', 'err'); return; }
    if (btn) btn.disabled = true;
    FOM.effWrite(E.orderSelf || FOM.orderBase({ OrderKey: E.orderKey, HeaderId: E.headerId }), x.ctx, x.vals, E.hdrEffKnown && E.hdrEffKnown.voName === x.ctx.voName ? E.hdrEffKnown : null).then(function (r) {
        FX.toast('Additional information saved (' + r.how + ').', 'ok'); E.hdrEffKnown = { voName: x.ctx.voName, voSelf: r.self || (E.hdrEffKnown && E.hdrEffKnown.voSelf), aiSelf: E.hdrEffKnown && E.hdrEffKnown.aiSelf };
    }).catch(function (e) { FOM.alert('Additional information not saved', esc(FOM.emsg(e)), 'err'); }).then(function () { if (btn) btn.disabled = false; });
};
FOM.edSaveHeaderLock = function (E) {
    var h = E.hdr, d = FOM.iso0(h.orderDate);
    var body = { TransactionTypeCode: h.orderType, TransactionType: h.orderType, TransactionOn: d, RequestedShipDate: d };
    FOM.preview('Save order type / date', [{ method: 'PATCH', url: FOM.u(E.orderPath()), body: body }], 'Save').then(function (ok) {
        if (!ok) return;
        FOM.write('PATCH', E.orderPath(), body, { contentType: null }).then(function () { E.hdrLocked = true; E.drawHeader(); FX.toast('Header updated.', 'ok'); }).catch(function (e) { FOM.alert('Header not updated', esc(FOM.emsg(e)), 'err'); });
    });
};

// ── payload (§3.3.18) ──────────────────────────────────────────
FOM.edLineEff = function (E, l) {
    var m = E.lineMeta; if (!m) return null;
    var v = {}; if (m.lotSeg && (l.lot || l.selectedLot)) v[m.lotSeg] = l.selectedLot || String(l.lot).split(',')[0].trim();
    if (m.costSeg && l.costUnit != null) v[m.costSeg] = FOM.r3(l.costUnit);
    if (m.qtySeg && m.qtySeg !== m.lotSeg && m.qtySeg !== m.costSeg && l.qty) v[m.qtySeg] = l.qty;
    Object.keys(l.effVals || {}).forEach(function (k) { if (l.effVals[k] !== '' && l.effVals[k] != null) v[k] = l.effVals[k]; });
    return Object.keys(v).length ? v : null;
};
FOM.buildFullLine = function (E, l, i) {
    var h = E.hdr, lid = l.srcLineId || (E.isEdit() ? 'N' + (i + 1) : String(E.seq * 100 + i + 1)), sched = l.srcScheduleNumber || lid;
    var b = { SourceTransactionLineId: String(lid), SourceTransactionLineNumber: String(l.srcLineNumber || (i + 1)), SourceTransactionScheduleId: String(sched), SourceScheduleNumber: String(sched) };
    if (l.uom) b.OrderedUOMCode = l.uom;
    b.OrderedQuantity = FOM.n(l.qty); b.ProductNumber = l.itemNumber;
    if (!l.returnLine && h.subinventory) b.SubinventoryCode = h.subinventory;
    if (h.paymentTerms) b.PaymentTerms = h.paymentTerms;
    b.InventoryTransactionFlag = !!h.invTxn;
    b.TransactionCategoryCode = l.returnLine ? 'RETURN' : 'ORDER';
    if (l.returnLine) {
        b.LineCategoryCode = 'RETURN'; b.ReturnReasonCode = l.returnReason || FOM.cfg('returnReason');
        if (l.refFulfillLineId) b.originalOrderReference = [{ OriginalFulfillLineId: l.refFulfillLineId }];
        if ((l.retLots || []).length) b.lotSerials = l.retLots.map(function (r, n) { var x = { SourceLotSerialId: 'LS' + (i + 1) + '-' + (n + 1) }; if (r.lot) x.LotNumber = r.lot; if (r.serial) { x.ItemSerialNumberFrom = r.serial; x.ItemSerialNumberTo = r.serial; } x.Quantity = r.serial ? 1 : r.qty; return x; });
        return b;
    }
    if (h.invTxn && (l.selectedSerials || []).length) b.lotSerials = l.selectedSerials.map(function (s, n) { var x = { SourceLotSerialId: 'LS' + (i + 1) + '-' + (n + 1) }; if (l.selectedLot) x.LotNumber = l.selectedLot; x.ItemSerialNumberFrom = s; x.ItemSerialNumberTo = s; x.Quantity = 1; return x; });
    else if (h.invTxn && l.selectedLot) b.lotSerials = [{ SourceLotSerialId: 'LS' + (i + 1) + '-1', LotNumber: l.selectedLot, Quantity: FOM.n(l.qty) }];
    var eff = FOM.edLineEff(E, l), m = E.lineMeta;
    if (eff && m) { var a = { Category: FOM.effCat.line || m.category }; a[m.voName] = [Object.assign({ ContextCode: m.contextCode }, eff)]; b.additionalInformation = [a]; }
    b.charges = [FOM.saleCharge(i, FOM.n(l.qty), FOM.n(l.unitPrice), FOM.n(l.taxAmount), h.txnCurrency)];
    return b;
};
FOM.edBody = function (E) {
    var h = E.hdr, ed = E.isEdit(), o = E.editOrder || {};
    var b = FOM.headerBody(h, ed ? o.SourceTransactionNumber : E.orderNumber, E.seq);
    if (ed) { b.SourceTransactionSystem = o.SourceTransactionSystem || FOM.cfg('srcSystem'); b.SourceTransactionId = o.SourceTransactionId; b.SourceTransactionRevisionNumber = (+(o.SourceTransactionRevisionNumber || 1)) + 1; }
    if (!ed && h.salesRep) b.salesCredits = [Object.assign({ SourceTransactionSalesCreditIdentifier: 'SC-' + b.SourceTransactionNumber + '-1' }, h.salesRepId ? { SalespersonId: h.salesRepId } : {}, { Salesperson: h.salesRep, SalesCreditTypeId: 1, Percent: 100 })];
    var x = FOM.edHeaderEffVals(E);
    if (Object.keys(x.vals).length) { var a = { Category: FOM.effCat.header || x.ctx.category }; a[x.ctx.voName] = [Object.assign({ ContextCode: x.ctx.contextCode }, x.vals)]; b.additionalInformation = [a]; }
    if (h.remarks && !ed) b.PackingInstructions = h.remarks;
    b.lines = E.lines.map(function (l, i) {
        if (ed && l.existing && l.canceled) return { SourceTransactionLineId: l.srcLineId, SourceTransactionLineNumber: String(l.srcLineNumber || i + 1), SourceScheduleNumber: String(l.srcScheduleNumber || l.srcLineId), ProductNumber: l.itemNumber, OrderedQuantity: 0, CanceledFlag: true, CancelReasonCode: FOM.cfg('cancelReason') };
        return FOM.buildFullLine(E, l, i);
    }).filter(function (l) { return l.ProductNumber; });
    return b;
};
FOM.stripEff = function (b) { var c = JSON.parse(JSON.stringify(b)); delete c.additionalInformation; (c.lines || []).forEach(function (l) { delete l.additionalInformation; }); return c; };
FOM.mapErrorsToLines = function (E, msgs) {
    E.lines.forEach(function (l) { l.error = null; });
    E.errors = [];
    msgs.forEach(function (m) {
        var mm = String(m).match(/SourceTransactionLineNumber\D{0,8}(\d+)/i), hit = null;
        if (mm) hit = E.lines.filter(function (l, i) { return String(l.srcLineNumber || (i + 1)) === mm[1]; })[0];
        if (hit) { hit.error = (hit.error ? hit.error + '\n' : '') + m; E.errors.push({ where: 'Line ' + mm[1], item: hit.itemNumber, msg: m }); }
        else E.errors.push({ where: 'Order', item: '', msg: m });
    });
};

// ── save / update / confirm ────────────────────────────────────
FOM.edValidateSave = function (E) {
    var miss = [];
    if (!E.lines.filter(function (l) { return l.itemNumber; }).length) miss.push('Add at least one line');
    if (E.isBranch && E.hdr.invTxn && !E.hdr.subinventory) miss.push('Subinventory is required for inventory transactions');
    if (!E.hdr.businessUnitId) miss.push('Business unit is missing');
    if (!E.hdr.accountNumber) miss.push('Customer is missing');
    if (E.lines.some(function (l) { return l.returnLine && FOM.n(l.qty) > FOM.n(l.maxQty); })) miss.push('Cannot return more than ordered');
    if (E.lines.some(function (l) { return !l.returnLine && l.itemNumber && FOM.n(l.qty) <= 0 && !l.canceled; })) miss.push('Every line needs a quantity above 0');
    return miss;
};
FOM.edSave = function (E) {
    var miss = FOM.edValidateSave(E);
    if (miss.length) { FOM.alert('Cannot save yet', esc(miss.join('\n')), 'err'); return; }
    var body = FOM.edBody(E), hadEff = JSON.stringify(body).indexOf('privateVO') >= 0, warn = '';
    FX.busy('Saving the order as a draft…');
    var post = function (b) { return FOM.raw('POST', 'salesOrdersForOrderHub', { contentType: 'json' }, b); };
    post(body).then(function (r) {
        var bad = !r.ok || !(r.json && r.json.OrderNumber), txt = FOM.errs(r.json, r.text, r.status).join('\n');
        if (bad && hadEff && /category\s*code|invalid\s*category|additionalinformation|is\s*category/i.test(txt)) {
            warn = 'Additional Information (EFF) was skipped — Fusion rejected it. Save it afterwards with Save Additional Info.';
            return post(FOM.stripEff(body));
        }
        return r;
    }).then(function (r) {
        FX.busy(); E.lastResp = r.json || r.text; E.lastBody = body;
        var j = r.json || {};
        if (!r.ok || !j.OrderNumber) {
            var msgs = FOM.errs(r.json, r.text, r.status); FOM.mapErrorsToLines(E, msgs); E.renderLines(); E.ltabs.show('errors');
            FOM.edResultDlg(E, false, msgs.join('\n')); return;
        }
        E.orderKey = j.OrderKey || j.HeaderId; E.headerId = j.HeaderId; E.fusionNo = j.OrderNumber; E.status = j.StatusCode || j.Status || 'DOO_DRAFT'; E.submitted = FOM.yes(j.SubmittedFlag); E.orderSelf = FOM.self(j);
        E.errors = []; E.lines.forEach(function (l) { l.error = null; });
        FOM.relabel(E.tab.id, E.orderNumber);
        FOM.edResultDlg(E, true, warn);
        FOM.edRefreshStatuses(E).then(function () { FOM.edResCount(E); });
        E.drawTitle(); E.drawToolbar();
        if (E.isBranch && E.mode === 'create') setTimeout(function () { FOM.branchPoDlg(E); }, 400);
    }).catch(function (e) { FX.busy(); FOM.edResultDlg(E, false, FOM.emsg(e)); });
};
FOM.edResultDlg = function (E, ok, msg) {
    FOM.dlg({
        title: ok ? '<i class="fa-solid fa-circle-check" style="color:var(--ok)"></i> Order saved' : '<i class="fa-solid fa-circle-xmark" style="color:var(--err)"></i> Order not saved',
        body: ok ? '<div class="fom-result"><div class="big">' + esc(E.fusionNo) + '</div><div>Source ' + esc(E.orderNumber) + ' · ' + FOM.chip(E.status) + '</div>' + (msg ? '<div class="note warn">' + esc(msg) + '</div>' : '') + '<div class="muted" style="font-size:.78rem">Saved as a draft — use Confirm Order to submit it.</div></div>' : '<div class="note err" style="white-space:pre-wrap">' + esc(msg) + '</div>',
        buttons: [{ label: 'Save Order to JSON', act: 'json' }, { label: 'Show Response', act: 'resp' }].concat(ok ? [{ label: 'Refresh Status', act: 'ref' }, { label: 'Open order view', act: 'view' }] : []).concat([{ label: 'Close', act: 'close', cls: 'primary' }]),
        onAction: function (a) {
            if (a === 'json') { FOM.edSaveJson(E); return false; }
            if (a === 'resp') { FOM.json('Fusion response', E.lastResp || {}); return false; }
            if (a === 'ref') { FOM.edRefreshStatuses(E); return false; }
            if (a === 'view') { FOM.openOrderBy(E.fusionNo, E.headerId); return true; }
        }
    });
};
/** Refresh line statuses after save (§3.3.19 step 3). */
FOM.edRefreshStatuses = function (E) {
    if (!E.orderKey) return Promise.resolve();
    return FOM.all(E.orderPath() + '/child/lines', { onlyData: false, limit: 500 }).then(function (rows) {
        E.rawLines = rows;
        E.lines.forEach(function (l, i) {
            var n = String(l.srcLineNumber || (i + 1));
            var r = rows.filter(function (x) { return String(x.SourceTransactionLineNumber) === n; })[0] || rows.filter(function (x) { return FOM.pf(x, ['ProductNumber', 'Product', 'ItemNumber']) === l.itemNumber; })[0];
            if (!r) return;
            Object.assign(l, { existing: true, status: FOM.pf(r, ['Status', 'DisplayStatus', 'FulfillLineStatus']) || '', statusCode: r.StatusCode || '', fulfillLineId: r.FulfillLineId, lineHref: FOM.self(r), srcLineNumber: r.SourceTransactionLineNumber, srcLineId: r.SourceTransactionLineId, srcScheduleNumber: FOM.pf(r, ['SourceScheduleNumber', 'SourceTransactionScheduleId']) || l.srcScheduleNumber, uom: l.uom || r.OrderedUOMCode, chargesHref: FOM.childHref(r, ['charges']), lotSerialsHref: FOM.childHref(r, ['lotserials']), origQty: FOM.n(r.OrderedQuantity), origUnitPrice: l.unitPrice, raw: r });
            if (/cancel/i.test(l.status + ' ' + l.statusCode)) l.canceled = true;
        });
        E.renderLines(); E.drawTitle(); E.drawToolbar();
    }).catch(function (e) { FX.toast('Could not refresh line statuses: ' + FOM.emsg(e), 'err'); });
};
/** Update Order ops (§3.3.20) */
FOM.edOps = function (E) {
    var ops = [], draft = E.isDraft(), base = E.orderPath();
    E.lines.forEach(function (l, i) {
        if (l.existing && l.canceled && !l.cancelSaved) {
            if (draft) ops.push({ l: l, kind: 'Cancel', method: 'PATCH', url: base, body: { lines: [{ SourceTransactionLineId: String(l.srcLineId || l.fulfillLineId), SourceTransactionScheduleId: String(l.srcScheduleNumber || l.srcLineId), OrderedQuantity: 0 }] } });
            else ops.push({ l: l, kind: 'Cancel', method: 'PATCH', url: l.lineHref || base + '/child/lines/' + l.fulfillLineId, body: { CanceledFlag: true, CancelReasonCode: FOM.cfg('cancelReason') } });
        } else if (l.existing && !l.canceled && FOM.n(l.qty) !== FOM.n(l.origQty)) ops.push({ l: l, kind: 'Update', method: 'PATCH', url: l.lineHref || base + '/child/lines/' + l.fulfillLineId, body: { OrderedQuantity: FOM.n(l.qty) } });
        else if (!l.existing && l.itemNumber && !l.canceled) ops.push({ l: l, kind: 'New', method: 'POST', url: base + '/child/lines', body: FOM.buildFullLine(E, l, i) });
    });
    return ops;
};
FOM.edUpdate = function (E) {
    var ops = FOM.edOps(E);
    if (!ops.length) { FX.toast('No changes to save'); return; }
    FOM.preview('Update order — ' + ops.length + ' change(s)', ops.map(function (o) { return { method: o.method, url: FOM.u(o.url), body: o.body }; }), 'Update Order').then(function (ok) {
        if (!ok) return;
        var fails = 0, done = 0; FX.busy('Updating order…');
        var seq = Promise.resolve();
        ops.forEach(function (op) {
            seq = seq.then(function () {
                FX.busy('Updating order… ' + (++done) + '/' + ops.length);
                return FOM.raw(op.method, op.url, { contentType: op.method === 'POST' ? 'json' : null }, op.body).then(function (r) {
                    if (!r.ok) { fails++; op.l.error = FOM.errs(r.json, r.text, r.status).join('\n'); E.errors.push({ where: 'Line ' + (op.l.srcLineNumber || ''), item: op.l.itemNumber, msg: op.l.error }); return; }
                    op.l.error = null; var j = r.json || {};
                    if (op.kind === 'New') Object.assign(op.l, { existing: true, srcLineId: j.SourceTransactionLineId || op.body.SourceTransactionLineId, srcLineNumber: j.SourceTransactionLineNumber || op.body.SourceTransactionLineNumber, srcScheduleNumber: j.SourceScheduleNumber || op.body.SourceScheduleNumber, fulfillLineId: j.FulfillLineId, lineHref: FOM.self(j), status: j.Status || j.DisplayStatus || '', statusCode: j.StatusCode || '', origQty: FOM.n(op.l.qty), origUnitPrice: op.l.unitPrice });
                    else if (op.kind === 'Update') { op.l.origQty = FOM.n(op.l.qty); op.l.origUnitPrice = op.l.unitPrice; op.l.loadedExt = null; }
                    else { op.l.cancelSaved = true; if (E.isDraft()) E.lines.splice(E.lines.indexOf(op.l), 1); }
                }).catch(function (e) { fails++; op.l.error = FOM.emsg(e); });
            });
        });
        seq.then(function () {
            FX.busy(); E.renderLines(); E.drawToolbar();
            if (fails) { FOM.alert('Update order', fails + ' of ' + ops.length + ' change(s) failed — see the Errors tab.', 'err'); E.ltabs.show('errors'); }
            else FX.toast('Order updated — ' + ops.length + ' change(s).', 'ok');
            FOM.edRefreshStatuses(E);
        });
    });
};
FOM.edSubmit = function (E) {
    FX.busy('Submitting order…');
    return FOM.write('PATCH', E.orderPath(), { SubmittedFlag: 'true' }, { contentType: null }).then(function (j) {
        FX.busy(); E.status = j.StatusCode || 'DOO_SUBMITTED'; E.submitted = true; FX.toast('Order confirmed (submitted).', 'ok'); E.drawTitle(); E.drawToolbar(); return FOM.edRefreshStatuses(E);
    }).catch(function (e) { FX.busy(); FOM.alert('Confirm failed', esc(FOM.emsg(e)), 'err'); });
};
FOM.edConfirm = function (E) {
    FX.busy('Checking reservations…');
    FOM.fetchReservations(E.orderNumber, FOM.distinct(E.lines.map(function (l) { return l.itemNumber; }))).then(function (r) {
        FX.busy();
        if (!r.length) { FOM.confirm('Confirm order', 'Submit order <b>' + esc(E.fusionNo || E.orderNumber) + '</b> to Fusion (SubmittedFlag = true)?', 'Confirm Order', 'ok').then(function (ok) { if (ok) FOM.edSubmit(E); }); return; }
        FOM.dlg({
            title: 'Existing reservations', wide: true,
            body: '<div class="note warn">This order has ' + r.length + ' manual reservation(s) on demand source <b>' + esc(E.orderNumber) + '</b>. The source app deleted them before submitting; the app\'s Fusion relay does not allow DELETE, so release them in Fusion (Manage Reservations) or submit and keep them.</div>' + FOM.table(r, FOM.RES_COLS),
            buttons: [{ label: 'Cancel', act: 'close' }, { label: 'Submit and keep reservations', act: 'go', cls: 'primary' }],
            onAction: function (a) { if (a === 'go') { FOM.edSubmit(E); return true; } }
        });
    }).catch(function (e) { FX.busy(); FX.toast(FOM.emsg(e), 'err'); });
};
FOM.edDiscard = function (E) {
    if (!E.headerId) { FX.toast('The order HeaderId is unknown — refresh first', 'err'); return; }
    FOM.confirm('Discard draft', 'Delete draft order <b>' + esc(E.fusionNo || E.orderNumber) + '</b> from Fusion? This cannot be undone.', 'Discard Draft', 'warn').then(function (ok) {
        if (!ok) return;
        FX.busy('Discarding draft…');
        FX.host('omRest', { method: 'DELETE', resource: 'salesOrdersForOrderHub', key: String(E.headerId), version: FX.ver }).then(function (r) {
            FX.busy();
            if (!r || r.ok === false || (r.status && (r.status < 200 || r.status >= 300))) throw (r && (r.error || FOM.errs(null, r.body, r.status).join('\n'))) || 'Delete failed';
            FX.toast('Draft discarded.', 'ok'); E.lines = []; E.orderKey = null; E.headerId = null; E.fusionNo = null; E.status = ''; E.renderLines(); E.drawTitle(); E.drawToolbar();
            if (E.isEdit()) FOM.closeTab(E.tab.id);
        }).catch(function (e) { FX.busy(); FOM.alert('Discard failed', esc(FOM.emsg(e)), 'err'); });
    });
};
FOM.edCancelOrder = function (E) {
    var ls = E.lines.filter(function (l) { return l.existing && !l.canceled && (l.lineHref || l.fulfillLineId); });
    if (!ls.length) { FX.toast('No open lines to cancel'); return; }
    FOM.confirm('Cancel order', 'Cancel all ' + ls.length + ' line(s) of order <b>' + esc(E.fusionNo || E.orderNumber) + '</b> (CancelReasonCode ' + esc(FOM.cfg('cancelReason')) + ')?', 'Cancel Order', 'warn').then(function (ok) {
        if (!ok) return;
        var fails = []; FX.busy('Canceling lines…');
        FOM.mapLimit(ls, 2, function (l) { return FOM.raw('PATCH', l.lineHref || E.orderPath() + '/child/lines/' + l.fulfillLineId, {}, { CanceledFlag: true, CancelReasonCode: FOM.cfg('cancelReason') }).then(function (r) { if (r.ok) { l.canceled = true; l.cancelSaved = true; } else { fails.push(l.itemNumber + ': ' + FOM.errs(r.json, r.text, r.status)[0]); l.error = fails[fails.length - 1]; } }); }).then(function () {
            FX.busy(); E.renderLines(); E.recalc();
            if (fails.length) FOM.alert('Cancel order', esc(fails.join('\n')), 'err'); else FX.toast('All lines canceled.', 'ok');
            FOM.edRefreshStatuses(E);
        });
    });
};
FOM.edRefresh = function (E) {
    FX.busy('Refreshing…');
    FOM.edLoadLines(E).then(function () { FX.busy(); FOM.edLoadCredits(E); FOM.edResCount(E); FOM.edLoadLineEff(E); }).catch(function (e) { FX.busy(); FX.toast(FOM.emsg(e), 'err'); });
};
FOM.edSaveJson = function (E) {
    var d = { __type: 'reacterp.salesOrderDraft', version: 1, orderNumber: E.orderNumber, header: E.hdr, lines: E.lines.map(function (l) { var c = Object.assign({}, l); delete c.raw; return c; }), discAmt: E.discAmt, expAmt: E.expAmt };
    FOM.download('sales-order-' + E.orderNumber + '.json', JSON.stringify(d, null, 2));
};
FOM.edLoadJson = function (E) {
    var i = document.createElement('input'); i.type = 'file'; i.accept = '.json';
    i.onchange = function () { var f = i.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { try { FOM.openEditor({ mode: 'draft', draft: JSON.parse(r.result) }); } catch (e) { FX.toast('Not a JSON draft', 'err'); } }; r.readAsText(f); };
    i.click();
};
FOM.edPayloadPreview = function (E) {
    if (E.isEdit()) { var ops = FOM.edOps(E); FOM.json('Update operations (' + ops.length + ')', ops.map(function (o) { return { action: o.kind, method: o.method, url: FOM.u(o.url), body: o.body }; })); }
    else FOM.json('POST ' + FOM.u('salesOrdersForOrderHub'), FOM.edBody(E));
};
