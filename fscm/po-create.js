/* Fusion Purchasing — Create / Edit Purchase Order (draftPurchaseOrders).
   New: build header + lines here, POST draftPurchaseOrders, then submit. Edit: load an INCOMPLETE draft, add lines (POST child/lines),
   change lines (PATCH lines + schedules). Deleting draft lines / the draft needs HTTP DELETE, which the host relay does not allow:
   those buttons stay disabled with the reason. Local tools: on-hand checks, item → org assignment (itemsV2), landed cost, JSON, print. */

var PC = null, _pcSeq = 0;
var PC_DOC_TYPES = ['LPON', 'IPON', 'STANDARD', 'BLANKET'];
var PC_CHARGES = ['Freight', 'Insurance', 'Customs Duty', 'Local Handling', 'Port Charges', 'Inspection', 'Brokerage', 'Survey', 'Quarantine', 'Other'];

function pcNew(mode) {
    return {
        mode: mode || 'new', poHeaderId: null, tab: 'lines', defTax: 0, needAll: '', assignOrg: '', rateType: 'CORPORATE', userRate: '', fx: null, fxState: '',
        header: { status: 'Incomplete', docType: PUR.recall('doctype', 'STANDARD'), orderDate: FX.today(), poNumber: '', procurementBU: PUR.recall('bu', ''), requisitioningBU: '', billToBU: '',
            currency: '', supplierId: null, supplierName: '', supplierSite: '', shipToOrg: PUR.recall('org', ''), subinventory: '', buyer: PUR.recall('buyer', ''), description: '',
            contact: '', commMethod: 'E-Mail', email: '', billToLocation: '', shipToLocation: '', paymentTerms: '', shippingMethod: '', noteToSupplier: '', payOnReceipt: false },
        lines: [], charges: [], qoh: {}, orgOnhand: null, busy: false
    };
}
function pcLine(o) { return Object.assign({ _k: ++_pcSeq, poLineId: null, scheduleId: null, lineNum: 0, itemNumber: '', description: '', uom: '', qty: 1, price: 0, taxPct: PC ? +PC.defTax || 0 : 0, needBy: PC ? PC.needAll : '', destinationType: 'Inventory', chargeAccount: '', assign: null }, o || {}); }
function pcRenumber() { PC.lines.forEach(function (l, i) { if (!l.poLineId) l.lineNum = 0; }); var max = Math.max.apply(null, [0].concat(PC.lines.filter(function (l) { return l.poLineId; }).map(function (l) { return +l.lineNum || 0; }))); PC.lines.forEach(function (l) { if (!l.poLineId) l.lineNum = ++max; }); if (PC.mode !== 'edit') PC.lines.forEach(function (l, i) { l.lineNum = i + 1; }); }
function pcCalc(l) { var amt = PUR.n(l.qty) * PUR.n(l.price), tax = amt * PUR.n(l.taxPct) / 100; return { amt: amt, tax: tax, net: amt + tax }; }
function pcTotals() { var t = { amt: 0, tax: 0, net: 0, qty: 0 }; PC.lines.forEach(function (l) { var c = pcCalc(l); t.amt += c.amt; t.tax += c.tax; t.net += c.net; t.qty += PUR.n(l.qty); }); return t; }
function pcBU() { return FX.lov('payBUs').then(function (l) { return l.filter(function (b) { return b.v === String(PC.header.procurementBU); })[0] || null; }); }
function pcBase() { return PC._buCcy || 'AED'; }
function pcCcyName(code) { return (PC._ccys || []).filter(function (c) { return c.v === code; }).map(function (c) { return (c.o && c.o.Name) || null; })[0] || null; }

// ── view entry ─────────────────────────────────────────────────
function purCreatePO(el) {
    var p = PUR.take('po-create');
    if (p.edit) { PC = pcNew('edit'); PC.poHeaderId = p.edit; pcShell(el); pcLoadDraft(p.edit); return; }
    if (p.fresh || !PC) PC = pcNew('new');
    pcShell(el); pcRender();
}
function pcShell(el) {
    el.innerHTML = '<div id="pc-root" style="display:flex;flex-direction:column;gap:10px"></div><input type="file" id="pc-file" accept=".json" hidden>';
    $('pc-file').onchange = function () { var f = this.files[0]; this.value = ''; if (f) f.text().then(pcLoadJson).catch(function (e) { FX.toast(String(e), 'err'); }); };
    $('fx-vh-r').innerHTML = '<button class="btn" id="pc-newbtn" title="Start a new purchase order"><i class="fa-solid fa-file-circle-plus"></i> New</button>';
    $('pc-newbtn').onclick = function () { if (PC && PC.lines.length && PC.mode !== 'edit') FX.confirm('New purchase order', 'All unsaved changes will be lost.', 'Start new', 'danger').then(function (ok) { if (ok) { PC = pcNew('new'); pcRender(); } }); else { PC = pcNew('new'); pcRender(); } };
}

// ── edit mode: load an existing draft ──────────────────────────
function pcLoadDraft(id) {
    $('pc-root').innerHTML = '<div class="card pad muted">' + PUR.spin + ' Loading draft purchase order from Fusion…</div>';
    FX.get('draftPurchaseOrders/' + id).then(function (d) {
        var h = PC.header;
        Object.assign(h, {
            poNumber: d.OrderNumber || '', docType: String(d.OrderNumber || '').replace(/\d.*$/, '') || 'STD', orderDate: FX.fmt.date(d.CreationDate) || FX.today(),
            status: d.DocumentStatus || d.StatusCode || 'Incomplete', buyer: d.Buyer || '', description: d.Description || '', currency: d.CurrencyCode || '',
            supplierId: d.SupplierId, supplierName: d.Supplier || '', supplierSite: d.SupplierSite || '', email: d.SupplierEmailAddress || '', contact: d.SupplierContact || '',
            billToLocation: d.BillToLocation || '', shipToLocation: d.DefaultShipToLocation || '', shipToOrg: '', subinventory: '', paymentTerms: d.PaymentTerms || '',
            shippingMethod: d.ModeOfTransportCode || '', noteToSupplier: d.NoteToSupplier || '', payOnReceipt: d.PayOnReceiptFlag === 'Y' || d.PayOnReceiptFlag === true,
            procurementBU: d.ProcurementBUId != null ? String(d.ProcurementBUId) : h.procurementBU, requisitioningBU: d.RequisitioningBUId != null ? String(d.RequisitioningBUId) : '', billToBU: d.BillToBUId != null ? String(d.BillToBUId) : ''
        });
        PC._draft = d;
        PC.poHeaderId = d.POHeaderId || id;
        if (d.ConversionRateType) PC.rateType = /USER/i.test(d.ConversionRateType) ? 'USER' : 'CORPORATE';
        if (d.ConversionRate) PC.userRate = d.ConversionRate;
        return FX.restAll('draftPurchaseOrders/' + PC.poHeaderId + '/child/lines', { expand: 'schedules', limit: 500 }, 100000);
    }).then(function (ls) {
        PC.lines = ls.map(function (l) {
            var s = l.schedules ? (l.schedules.items || l.schedules)[0] : null, nb = (s && PUR.first(s, 'RequestedDeliveryDate', 'RequestedShipDate', 'PromisedDeliveryDate', 'NeedByDate')) || PUR.first(l, 'RequestedDeliveryDate', 'RequestedShipDate', 'PromisedDeliveryDate', 'NeedByDate');
            if (s && !PC.header.shipToOrg) PC.header.shipToOrg = s.ShipToOrganizationCode || '';
            return pcLine({ poLineId: l.POLineId, scheduleId: s ? PUR.first(s, 'LineLocationId', 'ScheduleId') : null, lineNum: l.LineNumber, itemNumber: l.Item || l.ItemNumber || '', description: l.Description || '', uom: l.UOM || '', qty: +l.Quantity || 0, price: +PUR.first(l, 'Price', 'UnitPrice') || 0, taxPct: 0, needBy: FX.fmt.date(nb), destinationType: s && /EXPENSE/i.test(s.DestinationTypeCode || s.DestinationType || '') ? 'Expense' : 'Inventory' });
        }).sort(function (a, b) { return a.lineNum - b.lineNum; });
        PC.charges = [];
        pcRender();
    }).catch(function (e) { $('pc-root').innerHTML = '<div class="note err" style="white-space:pre-wrap">Could not load the draft: ' + esc(e) + '</div>'; });
}

// ── render ─────────────────────────────────────────────────────
function pcRender() {
    var root = $('pc-root'); if (!root || !PC) return;
    var h = PC.header, t = pcTotals(), edit = PC.mode === 'edit', saved = !!PC.poHeaderId;
    var unsaved = PC.lines.filter(function (l) { return !l.poLineId; }).length;
    var steps = [['Header', !!(h.procurementBU && h.supplierName && h.shipToOrg)], ['Lines', PC.lines.length > 0 && PC.lines.every(function (l) { return l.needBy; })], ['Saved in Fusion', saved && !unsaved], ['Submitted', /PENDING|APPROVED|OPEN/i.test(h.status)]];
    var curStep = steps.findIndex(function (s) { return !s[1]; });
    var inp = function (k, type, ph, extra) { return '<input data-h="' + k + '" type="' + (type || 'text') + '" value="' + esc(h[k]) + '" placeholder="' + esc(ph || '') + '"' + (extra || '') + '>'; };
    var lab = function (t2, req, html, cls) { return '<label class="' + (cls || '') + '"><span>' + esc(t2) + (req ? ' <b class="r">*</b>' : '') + '</span>' + html + '</label>'; };
    root.innerHTML =
        '<div class="pu-steps">' + steps.map(function (s, i) { return '<div class="s ' + (s[1] ? 'done' : i === curStep ? 'cur' : '') + '"><span class="n">' + (s[1] ? '<i class="fa-solid fa-check"></i>' : i + 1) + '</span><span><b>' + s[0] + '</b>' + (i === 0 ? 'BU, supplier, ship-to' : i === 1 ? PC.lines.length + ' line(s)' : i === 2 ? (saved ? 'POHeaderId ' + esc(PC.poHeaderId) : 'draftPurchaseOrders') : esc(h.status)) + '</span></div>'; }).join('') + '</div>' +
        '<div class="card pu-head"><i class="fa-solid fa-file-invoice" style="color:var(--accent);font-size:1.3rem"></i><div><div class="muted" style="font-size:.66rem;text-transform:uppercase;letter-spacing:.3px">Purchase order</div>' +
        '<span class="po-no">' + (h.poNumber ? esc(h.poNumber) : '<span class="muted">(number on save)</span>') + '</span></div>' + FX.chip(h.status) + '<span class="chip info">' + esc(h.docType) + '</span>' + (edit ? '<span class="chip warn">Editing from Fusion</span>' : '') +
        '<div class="tot"><div><span>Ordered</span><b data-tot="amt">' + FX.fmt.money(t.amt) + '</b></div><div><span>Tax</span><b data-tot="tax">' + FX.fmt.money(t.tax) + '</b></div><div><span>Total ' + esc(h.currency) + '</span><b data-tot="net">' + FX.fmt.money(t.net) + '</b></div></div></div>' +
        (edit ? '<div class="note warn"><i class="fa-solid fa-circle-info"></i> Editing draft ' + esc(h.poNumber) + ' from Fusion: <b>Save changes</b> sends the lines only — new lines are added, existing lines get their quantity, price, description and need-by updated. Header fields shown here are not changed in Fusion. Removing saved lines needs DELETE, which the relay does not allow yet.</div>' : '') +
        '<div class="row-btns">' +
        '<button class="btn" data-pc="json-save"><i class="fa-solid fa-download"></i> Save JSON</button><button class="btn" data-pc="json-load"><i class="fa-solid fa-upload"></i> Load JSON</button>' +
        '<button class="btn" data-pc="preview" title="The request(s) that Save will send"><i class="fa-solid fa-code"></i> Request</button>' +
        '<button class="btn" data-pc="pdf"' + (PC.lines.length ? '' : ' disabled') + '><i class="fa-solid fa-print"></i> Print / PDF</button>' +
        '<button class="btn" data-pc="actions"' + (saved ? '' : ' disabled title="Save the purchase order first"') + '><i class="fa-solid fa-bolt"></i> PO actions</button>' +
        '<span class="grow"></span><button class="btn danger" data-pc="discard"><i class="fa-solid fa-xmark"></i> Discard</button>' +
        '<button class="btn primary" data-pc="save"><i class="fa-solid fa-floppy-disk"></i> ' + (edit ? 'Save changes' : saved ? 'Saved' : 'Save purchase order') + '</button>' +
        '<button class="btn ok" data-pc="submit"' + (saved ? '' : ' disabled title="Save the purchase order first"') + '><i class="fa-solid fa-paper-plane"></i> Submit for approval</button></div>' +
        '<div class="pu-cols">' +
        '<div class="pu-sec"><h4><i class="fa-solid fa-sitemap"></i> Organization</h4><div class="form">' +
        lab('Procurement BU', 1, '<select data-h="procurementBU" id="pc-bu"></select>') + lab('Requisitioning BU', 0, '<select data-h="requisitioningBU" id="pc-rbu"></select>') +
        lab('Bill-to BU', 0, '<select data-h="billToBU" id="pc-bbu"></select>') + lab('Document type', 1, '<select data-h="docType">' + PC_DOC_TYPES.concat(PC_DOC_TYPES.indexOf(h.docType) < 0 ? [h.docType] : []).map(function (d) { return '<option' + (d === h.docType ? ' selected' : '') + '>' + esc(d) + '</option>'; }).join('') + '</select>') +
        lab('Order date', 1, inp('orderDate', 'date')) +
        lab('PO number', 0, '<div style="display:flex;gap:4px">' + inp('poNumber', 'text', 'blank = auto', edit ? ' disabled' : '') + '<button class="btn icon sm" data-pc="nextno" title="Next number from Fusion"' + (edit ? ' disabled' : '') + '><i class="fa-solid fa-arrows-rotate"></i></button></div>') +
        lab('Ship-to organization', 1, '<select data-h="shipToOrg" id="pc-org"></select>') + lab('Subinventory', 0, '<select data-h="subinventory" id="pc-sub"></select>') +
        lab('Buyer', 1, inp('buyer', 'text', 'Last, First')) + lab('Description', 0, inp('description'), 'wide') + '</div></div>' +
        '<div class="pu-sec"><h4><i class="fa-solid fa-truck-field"></i> Supplier</h4><div class="form">' +
        lab('Supplier', 1, '<input id="pc-sup" value="' + esc(h.supplierName) + '" placeholder="Type 2+ letters of the name or number"' + (edit ? ' disabled' : '') + '>', 'wide') +
        lab('Supplier site', 0, '<select data-h="supplierSite" id="pc-site"></select>') + lab('Contact', 0, inp('contact')) +
        lab('Communication', 0, '<select data-h="commMethod">' + ['E-Mail', 'Fax', 'Print', 'None'].map(function (m) { return '<option' + (m === h.commMethod ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select>') + lab('E-mail', 0, inp('email', 'email')) +
        lab('Bill-to location', 0, inp('billToLocation', 'text', 'Fusion default')) + lab('Ship-to location', 0, inp('shipToLocation', 'text', 'from the ship-to org')) +
        lab('Payment terms', 0, inp('paymentTerms', 'text', 'Supplier default')) + lab('Shipping method', 0, inp('shippingMethod')) + lab('Note to supplier', 0, '<textarea data-h="noteToSupplier" rows="2">' + esc(h.noteToSupplier) + '</textarea>', 'wide') + '</div></div>' +
        '<div class="pu-sec"><h4><i class="fa-solid fa-coins"></i> Currency & totals</h4><div class="form">' +
        lab('Currency', 1, '<input data-h="currency" id="pc-ccy" list="pc-ccys" value="' + esc(h.currency) + '" placeholder="e.g. USD" style="text-transform:uppercase"><datalist id="pc-ccys"></datalist>') +
        lab('Base currency', 0, '<input value="' + esc(pcBase()) + '" disabled>') + '</div><div id="pc-fx" style="margin-top:8px"></div>' +
        '<div class="facts" style="margin-top:10px"><div><span>Ordered</span><b data-tot="amt">' + FX.fmt.money(t.amt) + '</b></div><div><span>Total tax</span><span data-tot="tax" style="display:inline;font-size:inherit;text-transform:none;color:inherit">' + FX.fmt.money(t.tax) + '</span></div><div><span>Total ' + esc(h.currency) + '</span><b data-tot="net">' + FX.fmt.money(t.net) + '</b></div><div><span>Lines</span>' + PC.lines.length + '</div></div></div>' +
        '</div>' +
        '<div class="card"><div class="filters" style="border-bottom:1px solid var(--line)">' +
        '<button class="btn primary" data-pc="add"><i class="fa-solid fa-plus"></i> Add items</button>' +
        '<button class="btn" data-pc="clear"' + (unsaved && edit ? '' : ' hidden') + '><i class="fa-solid fa-eraser"></i> Clear unsaved (' + unsaved + ')</button>' +
        '<button class="btn danger" disabled title="' + esc(PUR.NO_DELETE) + '"' + (edit ? '' : ' hidden') + '><i class="fa-solid fa-trash"></i> Delete all lines</button>' +
        '<label>Need-by for all<input type="date" id="pc-needall" value="' + esc(PC.needAll) + '"></label><label>Default tax %<input type="number" id="pc-deftax" min="0" max="100" value="' + esc(PC.defTax) + '" style="min-width:90px"></label>' +
        '<label>Assign all to org<select id="pc-aorg"></select></label><button class="btn" data-pc="assignall"' + (PC.lines.length ? '' : ' disabled') + '><i class="fa-solid fa-building-circle-check"></i> Assign all</button>' +
        '<span class="grow"></span><button class="btn" data-pc="orgoh" title="On-hand of the whole ship-to org"><i class="fa-solid fa-warehouse"></i> Org on hand</button></div>' +
        '<div class="pu-tabs" id="pc-tabs">' + [['lines', 'Lines', PC.lines.length], ['sched', 'Schedules', ''], ['dist', 'Distributions', ''], ['qoh', 'Check on hand', ''], ['orgoh', 'On hand in org', ''], ['acq', 'Acquisition cost', PC.charges.length || '']].map(function (x) {
            return '<button data-tab="' + x[0] + '" class="' + (PC.tab === x[0] ? 'on' : '') + '">' + x[1] + (x[2] !== '' ? ' <span class="cnt">' + x[2] + '</span>' : '') + '</button>';
        }).join('') + '</div><div class="pu-body" id="pc-tab"></div></div>';
    pcFillLovs(); pcTab(); pcFxBox();
    root.onclick = pcClick;
    root.onchange = pcChange;
    root.oninput = function (e) { if (e.target.matches('[data-l]')) pcLineInput(e.target, false); };
}
function pcFillLovs() {
    var h = PC.header;
    var bp = FX.lov('payBUs');
    FX.fillSelect('pc-bu', bp, h.procurementBU, 'Select…').then(function (l) {
        if (!h.procurementBU && l.length === 1) { h.procurementBU = l[0].v; $('pc-bu').value = h.procurementBU; }
        var b = l.filter(function (x) { return x.v === String(h.procurementBU); })[0];
        PC._buCcy = b && b.ccy || PC._buCcy; PC._buName = b && b.name;
        if (b && !h.currency) { h.currency = b.ccy || ''; var c = $('pc-ccy'); if (c) c.value = h.currency; }
        pcFxBox(); pcOrgs();
    });
    FX.fillSelect('pc-rbu', bp, h.requisitioningBU || h.procurementBU, 'Same as procurement BU');
    FX.fillSelect('pc-bbu', bp, h.billToBU || h.procurementBU, 'Same as procurement BU');
    FX.lov('currencies').then(function (l) { PC._ccys = l; var d = $('pc-ccys'); if (d) d.innerHTML = l.map(function (c) { return '<option value="' + esc(c.v) + '">' + esc(c.t) + '</option>'; }).join(''); }).catch(function () { });
    if (h.supplierId) pcSites();
    else { var s = $('pc-site'); if (s) s.innerHTML = '<option value="">' + (h.supplierSite ? esc(h.supplierSite) : 'Pick a supplier first') + '</option>'; }
    if (!(PC.mode === 'edit')) FX.typeahead('pc-sup', function (q) {
        var byNum = /^\d/.test(q);
        return FX.get('suppliers', { q: (byNum ? 'SupplierNumber' : 'Supplier') + " LIKE '*" + q.replace(/'/g, "''") + "*'", limit: 20, fields: 'SupplierId,Supplier,SupplierNumber,SupplierType,Status' })
            .then(function (j) { return (j.items || []).map(function (s) { return { v: s.Supplier, t: s.SupplierNumber, r: s.SupplierType || s.Status, o: s }; }); });
    }, function (it) { h.supplierId = it.o.SupplierId; h.supplierName = it.o.Supplier; h.supplierSite = ''; pcSites(); pcRender(); });
    pcSubs();
}
function pcOrgs() {
    var h = PC.header;
    var p = FX.lov('orgs').then(function (l) { var f = PC._buName ? l.filter(function (o) { return o.o.ManagementBusinessUnitName === PC._buName; }) : []; return f.length ? f : l; });
    FX.fillSelect('pc-org', p, h.shipToOrg, 'Select…').then(function (l) { PC._orgs = l; });
    FX.fillSelect('pc-aorg', FX.lov('orgs'), PC.assignOrg || h.shipToOrg, 'Select…');
}
function pcSubs() {
    var h = PC.header, s = $('pc-sub'); if (!s) return;
    if (!h.shipToOrg) { s.innerHTML = '<option value="">Pick a ship-to org</option>'; return; }
    FX.fillSelect(s, FX.subinvs(h.shipToOrg), h.subinventory, '(none)');
}
function pcSites() {
    var h = PC.header;
    FX.fillSelect('pc-site', FX.restAll('suppliers/' + h.supplierId + '/child/sites', { limit: 100, fields: 'SupplierSiteId,SupplierSite,ProcurementBU,InactiveDate' }, 500).then(function (r) {
        return r.filter(function (s) { return !s.InactiveDate || s.InactiveDate > FX.today(); }).map(function (s) { return { v: s.SupplierSite, t: s.SupplierSite + (s.ProcurementBU ? ' · ' + s.ProcurementBU : ''), o: s }; });
    }), h.supplierSite, '(none)').then(function (l) { if (!h.supplierSite && l.length === 1) { h.supplierSite = l[0].v; var e = $('pc-site'); if (e) e.value = h.supplierSite; } });
}
function pcFxBox() {
    var el = $('pc-fx'); if (!el) return;
    var h = PC.header, base = pcBase(), t = pcTotals();
    if (!h.currency || h.currency === base) { el.innerHTML = '<div class="muted" style="font-size:.76rem"><i class="fa-solid fa-circle-check" style="color:var(--ok)"></i> Same as the base currency — no conversion.</div>'; return; }
    var fx = PC.fx, r = PC.rateType === 'USER' ? PUR.n(PC.userRate) : fx && fx.rate;
    el.innerHTML = '<div class="pu-inline"><label>Rate type <select data-pc-fx="type"><option value="CORPORATE"' + (PC.rateType === 'CORPORATE' ? ' selected' : '') + '>Corporate</option><option value="USER"' + (PC.rateType === 'USER' ? ' selected' : '') + '>User</option></select></label>' +
        (PC.rateType === 'USER' ? '<label>Rate <input type="number" step="0.000001" data-pc-fx="rate" value="' + esc(PC.userRate) + '" style="width:120px"></label>' : '') + '</div>' +
        (PC.rateType === 'CORPORATE' ? (PC.fxState === 'loading' ? '<div class="muted" style="margin-top:6px">' + PUR.spin + ' Reading the Corporate rate ' + esc(h.currency) + ' → ' + esc(base) + '…</div>' :
            fx ? '<div class="note ok" style="margin-top:6px">1 ' + esc(h.currency) + ' = <b>' + FX.fmt.num(fx.rate, 6) + '</b> ' + esc(base) + ' · inverse ' + FX.fmt.num(fx.inverse, 6) + ' · ' + esc(fx.type) + ' · ' + esc(fx.date) + '</div>' :
                '<div class="note warn" style="margin-top:6px">No Corporate rate found for ' + esc(h.currency) + ' → ' + esc(base) + '. Use a User rate or load the daily rate in Fusion.</div>') : '') +
        (r ? '<div class="muted" style="font-size:.76rem;margin-top:6px">PO total ≈ <b>' + FX.fmt.money(t.net * r) + ' ' + esc(base) + '</b></div>' : '');
}
function pcLoadFx() {
    var h = PC.header, base = pcBase();
    if (!h.currency || h.currency === base) { PC.fx = null; pcFxBox(); return; }
    PC.fxState = 'loading'; pcFxBox();
    var want = h.currency + '>' + base;
    PUR.fxRate(h.currency, base, h.orderDate || FX.today()).then(function (r) { if (want !== PC.header.currency + '>' + pcBase()) return; PC.fx = r; PC.fxState = r ? 'ok' : 'none'; pcFxBox(); });
}

// ── events ─────────────────────────────────────────────────────
function pcChange(e) {
    var t = e.target, h = PC.header;
    if (t.matches('[data-h]')) {
        var k = t.getAttribute('data-h'); h[k] = t.type === 'checkbox' ? t.checked : t.value.trim();
        if (k === 'currency') { h.currency = h.currency.toUpperCase(); PC.fx = null; pcRender(); pcLoadFx(); return; }
        if (k === 'procurementBU') {
            PUR.remember('bu', h.procurementBU); h.requisitioningBU = ''; h.billToBU = ''; h.shipToOrg = ''; h.subinventory = '';
            pcBU().then(function (b) { PC._buCcy = b && b.ccy; PC._buName = b && b.name; if (b && b.ccy) h.currency = b.ccy; pcRender(); pcLoadFx(); });
            return;
        }
        if (k === 'shipToOrg') {
            PUR.remember('org', h.shipToOrg); h.subinventory = ''; PC.orgOnhand = null; PC.qoh = {};
            var o = (PC._orgs || []).filter(function (x) { return x.v === h.shipToOrg; })[0];
            if (o && o.o.LocationCode && (!h.shipToLocation || h._autoLoc === h.shipToLocation)) { h.shipToLocation = o.o.LocationCode; h._autoLoc = o.o.LocationCode; }
            pcRender(); return;
        }
        if (k === 'buyer') PUR.remember('buyer', h.buyer);
        if (k === 'docType') PUR.remember('doctype', h.docType);
        if (k === 'orderDate') pcLoadFx();
        return;
    }
    if (t.matches('[data-pc-fx]')) { if (t.getAttribute('data-pc-fx') === 'type') { PC.rateType = t.value; pcFxBox(); if (t.value === 'CORPORATE' && !PC.fx) pcLoadFx(); } else { PC.userRate = t.value; pcFxBox(); } return; }
    if (t.id === 'pc-needall') { PC.needAll = t.value; if (t.value) { PC.lines.forEach(function (l) { l.needBy = t.value; }); pcRender(); } return; }
    if (t.id === 'pc-deftax') { PC.defTax = PUR.n(t.value); return; }
    if (t.id === 'pc-aorg') { PC.assignOrg = t.value; return; }
    if (t.matches('[data-l]')) { pcLineInput(t, true); return; }
    if (t.matches('[data-c]')) { pcChargeInput(t); return; }
}
function pcLineInput(t, commit) {
    var l = PC.lines.filter(function (x) { return x._k === +t.getAttribute('data-k'); })[0]; if (!l) return;
    var f = t.getAttribute('data-l'), v = t.value;
    if (f === 'qty' || f === 'price' || f === 'taxPct') { v = PUR.n(v); if (v < 0) v = 0; if (f === 'taxPct' && v > 100) v = 100; }
    if (f === 'manual') { l.manual = l.manual || {}; l.manual[t.getAttribute('data-ch')] = PUR.n(v); }
    else l[f] = v;
    if (f === 'needBy') t.classList.toggle('bad', !v);
    if (commit && (f === 'destinationType' || f === 'manual')) { pcRender(); return; }
    if (f === 'qty' || f === 'price' || f === 'taxPct') {
        var c = pcCalc(l), row = t.closest('tr');
        if (row) row.querySelectorAll('[data-calc]').forEach(function (x) { x.textContent = FX.fmt.money(c[x.getAttribute('data-calc')]); });
        var tt = pcTotals();
        document.querySelectorAll('#pc-root [data-tot]').forEach(function (x) { x.textContent = FX.fmt.money(tt[x.getAttribute('data-tot')]); });
        if (commit) pcFxBox();
    }
}
function pcClick(e) {
    var tb = e.target.closest('[data-tab]'); if (tb && tb.closest('#pc-tabs')) { PC.tab = tb.getAttribute('data-tab'); pcRender(); return; }
    var b = e.target.closest('[data-pc]'); if (!b || b.disabled) return;
    var a = b.getAttribute('data-pc'), k = +b.getAttribute('data-k'), line = PC.lines.filter(function (x) { return x._k === k; })[0];
    switch (a) {
        case 'json-save': pcSaveJson(); break;
        case 'json-load': $('pc-file').click(); break;
        case 'preview': pcPreview(); break;
        case 'pdf': pcPrint(); break;
        case 'actions': PUR.poActions({ POHeaderId: PC.poHeaderId, OrderNumber: PC.header.poNumber, StatusCode: PC.header.status }, function (st) { if (st) { PC.header.status = st; pcRender(); } }); break;
        case 'discard': FX.confirm('Discard', 'All unsaved changes will be lost.', 'Discard', 'danger').then(function (ok) { if (ok) { PC = null; FX.show('pos'); } }); break;
        case 'save': if (PC.mode === 'edit') pcSaveEdit(); else if (!PC.poHeaderId) pcSaveNew(); else FX.toast('Already saved as a draft in Fusion. Use PO actions or Submit.'); break;
        case 'submit': pcSubmit(); break;
        case 'nextno': pcNextNumber(); break;
        case 'add': if (!PC.header.shipToOrg) { FX.toast('Choose the ship-to organization first.', 'err'); return; } pcAddItems(); break;
        case 'clear': FX.confirm('Clear unsaved lines', 'Remove the ' + PC.lines.filter(function (l) { return !l.poLineId; }).length + ' line(s) that are not saved in Fusion yet?', 'Clear', 'danger').then(function (ok) { if (ok) { PC.lines = PC.lines.filter(function (l) { return l.poLineId; }); pcRender(); } }); break;
        case 'del': PC.lines = PC.lines.filter(function (x) { return x !== line; }); pcRenumber(); pcRender(); break;
        case 'item': pcItemDetail(line.itemNumber); break;
        case 'assign': pcAssign(line, (b.parentNode.querySelector('select') || {}).value || PC.header.shipToOrg).then(pcRender); pcRender(); break;
        case 'assignall': pcAssignAll(); break;
        case 'qoh': pcQoh(); break;
        case 'orgoh': PC.tab = 'orgoh'; pcRender(); pcOrgOnhand(); break;
        case 'orgoh-load': pcOrgOnhand(); break;
        case 'addch': PC.charges.push({ _k: ++_pcSeq, type: 'Freight', desc: '', ccy: PC.header.currency || pcBase(), amount: 0, apportion: 'value', fx: null }); pcChargeFx(PC.charges[PC.charges.length - 1]); pcRender(); break;
        case 'delch': PC.charges = PC.charges.filter(function (c) { return c._k !== k; }); pcRender(); break;
    }
}

// ── tabs ───────────────────────────────────────────────────────
function pcTab() {
    var el = $('pc-tab'), h = PC.header, edit = PC.mode === 'edit', L = PC.lines;
    var orgName = ((PC._orgs || []).filter(function (o) { return o.v === h.shipToOrg; })[0] || {}).t || h.shipToOrg;
    if (!L.length && PC.tab !== 'orgoh' && PC.tab !== 'acq') { el.innerHTML = '<div class="empty"><i class="fa-solid fa-cart-plus"></i>No lines yet. Choose the ship-to organization and click <b>Add items</b>.</div>'; return; }
    var t = pcTotals();
    if (PC.tab === 'lines') {
        el.innerHTML = '<div class="pu-scroll"><table class="tbl edit"><thead><tr><th>#</th><th>Item</th><th>Description</th><th>UOM</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Amount</th><th class="n">Tax %</th><th class="n">Tax</th><th class="n">Net total</th><th>Need-by *</th><th>Assign to org</th><th></th></tr></thead><tbody>' +
            L.map(function (l) {
                var c = pcCalc(l), del = edit && l.poLineId;
                return '<tr><td>' + esc(l.lineNum) + (l.poLineId ? '' : ' <span class="chip warn" title="Not saved in Fusion yet">new</span>') + '</td><td><button class="link mono" data-pc="item" data-k="' + l._k + '">' + esc(l.itemNumber) + '</button></td><td><input data-l="description" data-k="' + l._k + '" value="' + esc(l.description) + '" style="min-width:180px"></td><td>' + esc(l.uom) + '</td>' +
                    '<td><input type="number" min="0" step="0.0001" data-l="qty" data-k="' + l._k + '" value="' + esc(l.qty) + '"></td><td><input type="number" min="0" step="0.0001" data-l="price" data-k="' + l._k + '" value="' + esc(l.price) + '"></td>' +
                    '<td class="n" data-calc="amt">' + FX.fmt.money(c.amt) + '</td><td><input type="number" min="0" max="100" data-l="taxPct" data-k="' + l._k + '" value="' + esc(l.taxPct) + '" style="min-width:60px"></td><td class="n" data-calc="tax">' + FX.fmt.money(c.tax) + '</td><td class="n" data-calc="net"><b>' + FX.fmt.money(c.net) + '</b></td>' +
                    '<td><input type="date" data-l="needBy" data-k="' + l._k + '" value="' + esc(l.needBy) + '" class="' + (l.needBy ? '' : 'bad') + '"></td>' +
                    '<td style="white-space:nowrap"><span class="pu-inline"><select style="max-width:110px">' + (PC._orgs || [{ v: h.shipToOrg, t: h.shipToOrg }]).map(function (o) { return '<option' + (o.v === (l.assignOrg || h.shipToOrg) ? ' selected' : '') + '>' + esc(o.v) + '</option>'; }).join('') + '</select><button class="btn sm icon" data-pc="assign" data-k="' + l._k + '" title="Assign the item to this org (itemsV2)"><i class="fa-solid fa-building-circle-check"></i></button>' +
                    (l.assign ? (l.assign.busy ? PUR.spin : '<span class="chip ' + (l.assign.ok ? 'ok' : 'err') + '" title="' + esc(l.assign.msg) + '">' + (l.assign.ok ? '✓' : '✗') + '</span>') : '') + '</span></td>' +
                    '<td><button class="btn sm icon danger" data-pc="del" data-k="' + l._k + '"' + (del ? ' disabled title="' + esc(PUR.NO_DELETE) + '"' : ' title="Remove line"') + '><i class="fa-solid fa-trash"></i></button></td></tr>';
            }).join('') + '</tbody><tfoot><tr><td colspan="6">Total</td><td class="n" data-tot="amt">' + FX.fmt.money(t.amt) + '</td><td></td><td class="n" data-tot="tax">' + FX.fmt.money(t.tax) + '</td><td class="n" data-tot="net">' + FX.fmt.money(t.net) + '</td><td colspan="3"></td></tr></tfoot></table></div>' +
            '<div class="muted" style="font-size:.72rem">Tax % is for your estimate only — Fusion calculates the tax itself. Description, quantity, price and need-by are sent to Fusion.</div>';
    } else if (PC.tab === 'sched') {
        el.innerHTML = '<div class="pu-scroll">' + FX.table(L, [{ label: 'Line', f: 'lineNum' }, { label: 'Sch', get: function () { return 1; } }, { label: 'Item', f: 'itemNumber', fmt: 'mono' }, { label: 'Description', f: 'description' }, { label: 'Qty', f: 'qty', n: 1, fmt: 'num' }, { label: 'UOM', f: 'uom' },
            { label: 'Ship to', get: function () { return h.shipToLocation || h.shipToOrg; } }, { label: 'Ship-to org', get: function () { return orgName; } },
            { label: 'Requested delivery *', html: function (l) { return '<input type="date" data-l="needBy" data-k="' + l._k + '" value="' + esc(l.needBy) + '" class="' + (l.needBy ? '' : 'bad') + '">'; } },
            { label: 'Destination', get: function (l) { return l.destinationType === 'Expense' ? 'EXPENSE' : 'INVENTORY'; } }, { label: 'Match', get: function () { return '3 Way'; } }, { label: 'Invoice match', get: function () { return 'Order'; } },
            { label: 'Receipt routing', get: function () { return 'Direct delivery'; } }, { label: 'Accrue', get: function () { return 'Y'; } }, { label: 'Inspect', get: function () { return 'Y'; } }]).replace('class="tbl"', 'class="tbl edit"') + '</div>';
    } else if (PC.tab === 'dist') {
        el.innerHTML = '<div class="pu-scroll">' + FX.table(L, [{ label: 'Line', f: 'lineNum' }, { label: 'Sch', get: function () { return 1; } }, { label: 'Dist', get: function () { return 1; } }, { label: 'Item', f: 'itemNumber', fmt: 'mono' }, { label: 'Description', f: 'description' },
            { label: 'Destination type', html: function (l) { return '<select data-l="destinationType" data-k="' + l._k + '"><option' + (l.destinationType !== 'Expense' ? ' selected' : '') + '>Inventory</option><option' + (l.destinationType === 'Expense' ? ' selected' : '') + '>Expense</option></select>'; } },
            { label: 'Deliver-to', get: function () { return h.shipToLocation || h.shipToOrg; } }, { label: 'Subinventory', get: function () { return h.subinventory; } }, { label: 'Qty', f: 'qty', n: 1, fmt: 'num' }, { label: 'UOM', f: 'uom' },
            { label: 'Ordered', n: 1, get: function (l) { return pcCalc(l).amt; }, fmt: 'money' },
            { label: 'PO charge account', html: function (l) { return '<input data-l="chargeAccount" data-k="' + l._k + '" value="' + esc(l.chargeAccount) + '" placeholder="e.g. 001-2050000-VLA-000" title="Kept with the JSON only — Fusion derives the charge account">'; } }]).replace('class="tbl"', 'class="tbl edit"') + '</div>';
    } else if (PC.tab === 'qoh') {
        var Q = PC.qoh, done = L.filter(function (l) { return Q[l._k] && !Q[l._k].busy; });
        el.innerHTML = '<div class="row-btns"><button class="btn primary" data-pc="qoh"><i class="fa-solid fa-magnifying-glass-chart"></i> Query on hand</button><span class="muted">Organization ' + esc(h.shipToOrg) + (h.subinventory ? ' · subinventory ' + esc(h.subinventory) : '') + '</span></div>' +
            FX.table(L, [{ label: '#', f: 'lineNum' }, { label: 'Item', f: 'itemNumber', fmt: 'mono' }, { label: 'Description', f: 'description' }, { label: 'UOM', f: 'uom' }, { label: 'PO qty', f: 'qty', n: 1, fmt: 'num' },
                { label: 'On hand', n: 1, html: function (l) { var q = Q[l._k]; if (!q) return '—'; if (q.busy) return PUR.spin; if (q.err) return '—'; return '<b style="color:' + (q.oh <= 0 ? 'var(--err)' : q.oh < l.qty ? 'var(--warn)' : 'var(--ok)') + '">' + FX.fmt.num(q.oh) + '</b>'; } },
                { label: 'Status', html: function (l) { var q = Q[l._k]; if (!q || q.busy) return ''; return q.err ? '<span class="chip err" title="' + esc(q.err) + '">API error</span>' : q.oh <= 0 ? '<span class="chip err">Out of stock</span>' : q.oh < l.qty ? '<span class="chip warn">Low stock</span>' : '<span class="chip ok">Available</span>'; } },
                { label: 'Difference', n: 1, html: function (l) { var q = Q[l._k]; if (!q || q.busy || q.err) return ''; var d = q.oh - l.qty; return (d > 0 ? '+' : '') + FX.fmt.num(d); } }]) +
            (done.length ? '<div class="muted" style="font-size:.76rem">' + done.length + ' queried · ✓ ' + done.filter(function (l) { return !Q[l._k].err && Q[l._k].oh >= l.qty; }).length + ' available · ⚠ ' + done.filter(function (l) { return !Q[l._k].err && Q[l._k].oh < l.qty; }).length + ' low / out</div>' : '');
    } else if (PC.tab === 'orgoh') {
        var O = PC.orgOnhand;
        el.innerHTML = '<div class="row-btns"><button class="btn primary" data-pc="orgoh-load"' + (h.shipToOrg ? '' : ' disabled') + '><i class="fa-solid fa-warehouse"></i> Fetch org on hand</button><input id="pc-ohq" type="search" placeholder="Filter item, description, subinventory, locator…" style="min-width:260px;border:1px solid var(--line);border-radius:8px;padding:6px 9px"><span class="muted" id="pc-ohn"></span></div><div id="pc-oht" class="pu-scroll"></div>';
        var draw = function () {
            if (!O) { $('pc-oht').innerHTML = '<div class="empty"><i class="fa-solid fa-warehouse"></i>' + (h.shipToOrg ? 'Fetch the on-hand of ' + esc(h.shipToOrg) + '.' : 'Choose a ship-to organization first.') + '</div>'; return; }
            if (O.busy) { $('pc-oht').innerHTML = '<div class="muted">' + PUR.spin + ' Reading on-hand… ' + (O.n || '') + '</div>'; return; }
            if (O.err) { $('pc-oht').innerHTML = '<div class="note err">' + esc(O.err) + '</div>'; return; }
            var q = ($('pc-ohq').value || '').toLowerCase(), rows = O.rows.filter(function (r) { return !q || ['ItemNumber', 'ItemDescription', 'SubinventoryCode', 'Locator'].some(function (k) { return String(r[k] || '').toLowerCase().indexOf(q) >= 0; }); });
            $('pc-ohn').textContent = rows.length + ' of ' + O.rows.length + ' balances';
            $('pc-oht').innerHTML = FX.table(rows.slice(0, 1000), [{ label: 'Item', f: 'ItemNumber', fmt: 'mono' }, { label: 'Description', f: 'ItemDescription' }, { label: 'Subinventory', f: 'SubinventoryCode' }, { label: 'Locator', f: 'Locator' }, { label: 'On hand', n: 1, get: function (r) { return PUR.first(r, 'PrimaryQuantity', 'PrimaryOnhandQuantity', 'OnhandQuantity'); }, fmt: 'num' }, { label: 'Consigned', f: 'ConsignedQuantity', n: 1, fmt: 'num' }, { label: 'UOM', f: 'PrimaryUOMCode' }, { label: 'Status', f: 'MaterialStatus' }]);
        };
        draw(); $('pc-ohq').oninput = draw; PC._ohDraw = draw;
    } else if (PC.tab === 'acq') pcAcqTab(el);
}

// ── item search / paste dialog ─────────────────────────────────
function pcAddItems() {
    var h = PC.header, on = {}; PC.lines.forEach(function (l) { on[String(l.itemNumber).toUpperCase()] = l; });
    var S = { rows: [], offset: 0, more: false, sel: {}, paste: [] };
    var drawBrowse = function () {
        $('ai-res').innerHTML = S.rows.length ? '<div class="pu-scroll" style="max-height:44vh"><table class="tbl"><thead><tr><th></th><th>Item</th><th>Description</th><th>UOM</th><th>Status</th></tr></thead><tbody>' + S.rows.map(function (r, i) {
            var dup = on[String(r.ItemNumber).toUpperCase()];
            return '<tr class="' + (dup ? 'dis' : '') + '"><td><input type="checkbox" data-ai="' + i + '"' + (dup ? ' disabled title="Already on the PO"' : S.sel[i] ? ' checked' : '') + '></td><td class="mono">' + esc(r.ItemNumber) + '</td><td>' + esc(r.ItemDescription) + '</td><td>' + esc(r.PrimaryUOMValue) + '</td><td>' + FX.chip(r.ItemStatusValue) + '</td></tr>';
        }).join('') + '</tbody></table></div>' + (S.more ? '<button class="btn sm" id="ai-more"><i class="fa-solid fa-angles-down"></i> Load next 50</button>' : '') : '<div class="empty"><i class="fa-solid fa-magnifying-glass"></i>Search items of ' + esc(h.shipToOrg) + '.</div>';
        var m = $('ai-more'); if (m) m.onclick = function () { search(true); };
    };
    var search = function (more) {
        var term = $('ai-term').value.trim(); if (!term) { FX.toast('Enter a search term.', 'err'); return; }
        if (!more) { S.rows = []; S.offset = 0; S.sel = {}; }
        $('ai-res').innerHTML = '<div class="muted">' + PUR.spin + ' Searching…</div>';
        var q = ($('ai-type').value === 'num' ? 'ItemNumber LIKE ' + PUR.dq(term + '%') : 'ItemDescription LIKE ' + PUR.dq('%' + term + '%')) + ';OrganizationCode=' + PUR.dq(h.shipToOrg);
        FX.get('itemsV2', { q: q, fields: 'ItemNumber,ItemDescription,PrimaryUOMValue,ItemStatusValue', limit: 50, offset: S.offset }).then(function (j) {
            S.rows = S.rows.concat(j.items || []); S.offset = S.rows.length; S.more = !!j.hasMore; drawBrowse();
        }).catch(function (e) { $('ai-res').innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
    };
    var parse = function (txt) {
        var rows = String(txt || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) { return s.split(/\t|;|,(?=\S)|,\s/).map(function (x) { return x.trim(); }); });
        if (rows.length && isNaN(+String(rows[0][1] || '0').replace(/,/g, '')) && !/^\d/.test(rows[0][0])) rows.shift();
        return rows.filter(function (r) { return r[0]; }).map(function (r) { var two = r.length === 2; return { item: r[0].toUpperCase(), qty: two ? 1 : PUR.n(String(r[1] || 1).replace(/,/g, '')), price: PUR.n(String((two ? r[1] : r[2]) || 0).replace(/,/g, '')), st: null }; });
    };
    var drawPaste = function () {
        var P = S.paste;
        $('ai-pres').innerHTML = P.length ? '<div class="pu-scroll" style="max-height:40vh">' + FX.table(P, [{ label: '', html: function (r) { return r.st === 'busy' ? PUR.spin : r.st === 'ok' ? '<span class="chip ok">✓</span>' : r.st === 'bad' ? '<span class="chip err">✗</span>' : ''; } },
            { label: 'Item', f: 'item', fmt: 'mono' }, { label: 'Qty', f: 'qty', n: 1, fmt: 'num' }, { label: 'Price', f: 'price', n: 1, fmt: 'money' }, { label: 'Value', n: 1, get: function (r) { return r.qty * r.price; }, fmt: 'money' },
            { label: 'Description', html: function (r) { return r.st === 'bad' ? '<span style="color:var(--err)">' + esc(r.err || 'Not found in ' + h.shipToOrg) + '</span>' : esc(r.desc || ''); } }, { label: 'UOM', f: 'uom' },
            { label: '', html: function (r) { return on[r.item] ? '<span class="chip warn">already on PO</span>' : ''; } }]) + '</div>' : '';
    };
    FX.modal({
        title: '<i class="fa-solid fa-cart-plus" style="color:var(--accent)"></i> Add items — ' + esc(h.shipToOrg), wide: true,
        body: '<div class="seg" id="ai-seg"><button data-m="b" class="on">Browse items</button><button data-m="p">Import / paste</button></div>' +
            '<div id="ai-b"><div class="pu-inline"><select id="ai-type"><option value="num">Item number</option><option value="desc">Description</option></select><input id="ai-term" type="search" placeholder="Starts with… / contains…" style="min-width:260px"><button class="btn primary sm" id="ai-go"><i class="fa-solid fa-magnifying-glass"></i> Search</button></div><div id="ai-res" style="margin-top:8px"></div></div>' +
            '<div id="ai-p" hidden><div class="note">One item per line: <span class="mono">ItemNumber, Qty, Price</span> (tab, comma or semicolon). Two columns = item, price (qty 1). Or pick an Excel / CSV file: column A item, B qty, C price, row 1 = headers.</div>' +
            '<textarea class="big" id="ai-text" placeholder="167815\t10\t25.50"></textarea><div class="pu-inline"><input type="file" id="ai-file" accept=".xlsx,.xls,.csv,.txt"><button class="btn sm" id="ai-val"><i class="fa-solid fa-list-check"></i> Validate items</button>' +
            '<label>If already on the PO <select id="ai-dup"><option value="upd">update qty & price</option><option value="skip">add new only</option></select></label></div><div id="ai-pres"></div></div>',
        buttons: [{ label: 'Cancel', act: 'close' }, { label: '<i class="fa-solid fa-plus"></i> Add to PO', cls: 'primary', act: 'add' }],
        onOpen: function () {
            drawBrowse();
            $('ai-seg').onclick = function (e) { var b = e.target.closest('[data-m]'); if (!b) return; this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); $('ai-b').hidden = b.getAttribute('data-m') !== 'b'; $('ai-p').hidden = b.getAttribute('data-m') !== 'p'; };
            $('ai-go').onclick = function () { search(false); }; $('ai-term').onkeydown = function (e) { if (e.key === 'Enter') search(false); };
            $('ai-res').onchange = function (e) { var c = e.target.closest('[data-ai]'); if (c) S.sel[+c.getAttribute('data-ai')] = c.checked; };
            $('ai-file').onchange = function () {
                var f = this.files[0]; if (!f) return;
                if (/\.xlsx?$/i.test(f.name)) {
                    if (!window.XLSX) { FX.toast('The Excel reader did not load — save the sheet as CSV.', 'err'); return; }
                    f.arrayBuffer().then(function (buf) { var wb = XLSX.read(buf, { type: 'array' }), rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }); $('ai-text').value = rows.slice(1).filter(function (r) { return r[0] !== ''; }).map(function (r) { return [r[0], r[1], r[2]].join('\t'); }).join('\n'); });
                } else f.text().then(function (t) { $('ai-text').value = t; });
            };
            $('ai-val').onclick = function () {
                var txt = $('ai-text').value, commas = txt.split(/\r?\n/).filter(function (l) { return /\d,\d{3}/.test(l) && /\t/.test(l); });
                S.paste = parse(txt);
                if (!S.paste.length) { FX.toast('Nothing to validate.', 'err'); return; }
                if (commas.length) FX.toast(commas.length + ' row(s) had thousands separators — they were removed.');
                S.paste.forEach(function (r) { r.st = 'busy'; }); drawPaste();
                PUR.pool(S.paste, 8, function (r) {
                    return FX.get('itemsV2', { q: 'OrganizationCode=' + PUR.dq(h.shipToOrg) + ';ItemNumber=' + PUR.dq(r.item), limit: 1, fields: 'ItemNumber,ItemDescription,PrimaryUOMValue' }).then(function (j) {
                        var it = (j.items || [])[0]; r.st = it ? 'ok' : 'bad'; if (it) { r.desc = it.ItemDescription; r.uom = it.PrimaryUOMValue || it.PrimaryUnitOfMeasure; }
                    }).catch(function (e) { r.st = 'bad'; r.err = String(e); });
                }, function () { drawPaste(); });
            };
        },
        onAction: function (a) {
            if (a !== 'add') return;
            var added = 0, upd = 0;
            if (!$('ai-b').hidden) {
                S.rows.forEach(function (r, i) { if (S.sel[i] && !on[String(r.ItemNumber).toUpperCase()]) { PC.lines.push(pcLine({ itemNumber: r.ItemNumber, description: r.ItemDescription || '', uom: r.PrimaryUOMValue || '', qty: 1, price: 0 })); added++; } });
            } else {
                var ok = S.paste.filter(function (r) { return r.st === 'ok'; });
                if (!ok.length) { FX.toast('Validate the items first — only valid items are added.', 'err'); return false; }
                var mode = $('ai-dup').value;
                ok.forEach(function (r) {
                    var ex = on[r.item];
                    if (ex) { if (mode === 'upd') { if (r.qty > 0) ex.qty = r.qty; ex.price = r.price; upd++; } }
                    else { var l = pcLine({ itemNumber: r.item, description: r.desc || '', uom: r.uom || '', qty: r.qty || 1, price: r.price }); PC.lines.push(l); on[r.item] = l; added++; }
                });
            }
            if (!added && !upd) { FX.toast('Nothing selected.', 'err'); return false; }
            pcRenumber(); PC.tab = 'lines'; pcRender();
            FX.toast(added + ' line(s) added' + (upd ? ', ' + upd + ' updated' : '') + '.', 'ok');
        }
    });
}
function pcItemDetail(item) {
    var h = PC.header;
    FX.modal({ title: 'Item ' + esc(item), wide: true, body: '<div id="it-d" class="muted">' + PUR.spin + ' Loading…</div>' });
    FX.get('itemsV2', { q: 'ItemNumber=' + PUR.dq(item), limit: 50 }).then(function (j) {
        var rows = j.items || [], r = rows.filter(function (x) { return x.OrganizationCode === h.shipToOrg; })[0] || rows.filter(function (x) { return x.SalesAccountId; })[0] || rows[0];
        if (!$('it-d')) return;
        if (!r) { $('it-d').innerHTML = '<div class="empty">Item not found.</div>'; return; }
        var keys = Object.keys(r).filter(function (k) { return k !== 'links' && r[k] != null && r[k] !== '' && typeof r[k] !== 'object'; });
        $('it-d').className = '';
        $('it-d').innerHTML = '<div class="row-btns"><span class="chip info">' + esc(r.OrganizationCode) + '</span>' + (r.SalesAccountValue ? '<span class="chip ok">Sales acct ' + esc(r.SalesAccountValue) + '</span>' : '') + '<span class="muted">' + rows.length + ' organization(s) carry this item: ' + esc(rows.map(function (x) { return x.OrganizationCode; }).join(', ')) + '</span></div><div class="facts" style="margin-top:8px">' + keys.map(function (k) { return '<div><span>' + esc(PUR.label(k)) + '</span>' + esc(r[k]) + '</div>'; }).join('') + '</div>';
    }).catch(function (e) { if ($('it-d')) $('it-d').innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
}

// ── item → inventory org assignment (itemsV2) ──────────────────
var PC_COPY = ['SalesAccountId', 'SalesAccountValue', 'CostOfSaleAccountId', 'CostOfSaleAccountValue', 'ExpenseAccountId', 'ExpenseAccountValue', 'EncumbranceAccountId', 'EncumbranceAccountValue', 'ItemClass', 'PrimaryUOMValue', 'ItemStatusValue', 'LifecyclePhaseValue', 'InventoryItemFlag', 'StockEnabledFlag', 'TransactionEnabledFlag', 'ReservableFlag', 'PurchasingItemFlag', 'PurchasableFlag', 'CustomerOrderEnabledFlag', 'CustomerOrderFlag', 'InternalOrderEnabledFlag', 'InternalOrderFlag', 'ShippableItemFlag', 'InvoiceEnabledFlag', 'InvoicedFlag', 'InventoryAssetFlag', 'CostingEnabledFlag', 'IncludeInRollupFlag', 'ListPrice', 'MarketPrice', 'UnitWeight', 'UnitVolume', 'AllowSubstituteReceiptsFlag'];
function pcAssign(l, org) {
    l.assignOrg = org; l.assign = { busy: true };
    var item = l.itemNumber, master, copy = {};
    return FX.get('itemsV2', { q: 'ItemNumber=' + PUR.dq(item), limit: 50 }).then(function (j) {
        var rows = j.items || [];
        master = rows.filter(function (r) { return r.SalesAccountValue; })[0] || rows.filter(function (r) { return r.SalesAccountId; })[0] || rows.filter(function (r) { return r.OrganizationCode === 'AMS'; })[0] || rows[0];
        if (!master) throw 'Item ' + item + ' does not exist in any organization';
        PC_COPY.forEach(function (k) { if (master[k] != null && master[k] !== '') copy[k] = master[k]; });
        var exist = rows.filter(function (r) { return r.OrganizationCode === org; })[0];
        if (exist) return exist;
        return FX.get('itemsV2', { q: 'ItemNumber=' + PUR.dq(item) + ';OrganizationCode=' + PUR.dq(org), limit: 1, onlyData: false }).then(function (j2) { return (j2.items || [])[0]; });
    }).then(function (exist) {
        var assignBody = Object.assign({ OrganizationCode: org, ItemNumber: item, ItemDescription: master.ItemDescription || l.description || item, ItemClass: master.ItemClass || 'Root Item Class' }, copy);
        var post = function () { return FX.rest('POST', 'itemsV2', { upsert: true }, assignBody).then(function () { return 'Assigned ' + org; }); };
        if (exist && !Object.keys(copy).length) return 'Already in ' + org;
        if (exist) {
            var self = (exist.links || []).filter(function (x) { return x.rel === 'self'; })[0];
            if (!self) return post();
            return FX.rest('PATCH', self.href, {}, copy).then(function () { return 'Updated ' + org; }, function (e) { if (/InvalidOperationUpdate/i.test(String(e))) return post(); throw e; });
        }
        return FX.rest('POST', 'itemsV2', {}, assignBody).then(function () { return 'Assigned ' + org; });
    }).then(function (msg) { l.assign = { ok: true, msg: msg + (copy.SalesAccountValue ? ' (Sales acct ' + copy.SalesAccountValue + ')' : '') }; return l.assign; },
        function (e) { l.assign = { ok: false, msg: String(e) }; return l.assign; });
}
function pcAssignAll() {
    var org = PC.assignOrg || ($('pc-aorg') || {}).value; if (!org) { FX.toast('Choose the organization to assign to.', 'err'); return; }
    var i = 0, ok = 0;
    (function next() {
        if (i >= PC.lines.length) { FX.busy(false); pcRender(); FX.toast(ok + ' of ' + PC.lines.length + ' item(s) assigned to ' + org + '.', ok === PC.lines.length ? 'ok' : 'err'); return; }
        var l = PC.lines[i++]; FX.busy('Assigning ' + l.itemNumber + ' to ' + org + ' (' + i + '/' + PC.lines.length + ')…');
        pcAssign(l, org).then(function (r) { if (r.ok) ok++; next(); });
    })();
}

// ── on hand ────────────────────────────────────────────────────
function pcQoh() {
    var h = PC.header, i = 0;
    PC.lines.forEach(function (l) { PC.qoh[l._k] = { busy: true }; }); pcRender();
    (function next() {
        if (i >= PC.lines.length) { pcRender(); return; }
        var l = PC.lines[i++];
        FX.restAll('inventoryOnhandBalances', { q: 'OrganizationCode=' + PUR.dq(h.shipToOrg) + ';ItemNumber=' + PUR.dq(l.itemNumber) + (h.subinventory ? ';SubinventoryCode=' + PUR.dq(h.subinventory) : ''), limit: 50 }, 500)
            .then(function (r) { PC.qoh[l._k] = { oh: PUR.sum(r, function (x) { return PUR.first(x, 'PrimaryQuantity', 'PrimaryOnhandQuantity', 'OnhandQuantity'); }) }; }, function (e) { PC.qoh[l._k] = { err: String(e) }; })
            .then(function () { if (PC.tab === 'qoh') pcRender(); next(); });
    })();
}
function pcOrgOnhand() {
    var h = PC.header; if (!h.shipToOrg) { FX.toast('Choose a ship-to organization first.', 'err'); return; }
    PC.orgOnhand = { busy: true }; if (PC._ohDraw) PC._ohDraw();
    FX.restAll('inventoryOnhandBalances', { q: 'OrganizationCode=' + PUR.dq(h.shipToOrg) + (h.subinventory ? ';SubinventoryCode=' + PUR.dq(h.subinventory) : ''), limit: 500 }, 20000, function (n) { PC.orgOnhand.n = n + ' rows'; if (PC.tab === 'orgoh' && PC._ohDraw) PC._ohDraw(); })
        .then(function (r) { PC.orgOnhand = { rows: r }; }, function (e) { PC.orgOnhand = { err: String(e) }; })
        .then(function () { if (PC.tab === 'orgoh' && PC._ohDraw) PC._ohDraw(); });
}

// ── acquisition / landed cost (local only, in the base currency) ─
function pcChargeFx(c) {
    var base = pcBase();
    if (!c.ccy || c.ccy === base) { c.fx = { rate: 1 }; return; }
    c.fx = null; c.fxBusy = true;
    PUR.fxRate(c.ccy, base, PC.header.orderDate).then(function (r) { c.fx = r; c.fxBusy = false; if (PC.tab === 'acq') pcRender(); });
}
function pcAccounted(c) { var base = pcBase(); if (!c.ccy || c.ccy === base) return PUR.n(c.amount); return c.fx ? PUR.n(c.amount) * c.fx.rate : 0; }
function pcAlloc() {
    var L = PC.lines, sumAmt = L.reduce(function (s, l) { return s + pcCalc(l).amt; }, 0), sumQty = L.reduce(function (s, l) { return s + PUR.n(l.qty); }, 0), out = {};
    L.forEach(function (l) { out[l._k] = 0; });
    PC.charges.forEach(function (c) {
        var acc = pcAccounted(c);
        L.forEach(function (l) {
            var a = c.apportion === 'manual' ? PUR.n((l.manual || {})[c._k]) : c.apportion === 'equal' ? acc / (L.length || 1) : c.apportion === 'qty' ? (sumQty ? PUR.n(l.qty) / sumQty * acc : 0) : (sumAmt ? pcCalc(l).amt / sumAmt * acc : 0);
            out[l._k] += a;
        });
    });
    return out;
}
function pcChargeInput(t) {
    var c = PC.charges.filter(function (x) { return x._k === +t.getAttribute('data-k'); })[0]; if (!c) return;
    var f = t.getAttribute('data-c'); c[f] = f === 'amount' ? PUR.n(t.value) : f === 'ccy' ? t.value.trim().toUpperCase() : t.value;
    if (f === 'ccy') pcChargeFx(c);
    pcRender();
}
function pcAcqTab(el) {
    var base = pcBase(), L = PC.lines, C = PC.charges, al = pcAlloc(), manual = C.filter(function (c) { return c.apportion === 'manual'; });
    var totAcc = C.reduce(function (s, c) { return s + pcAccounted(c); }, 0);
    el.innerHTML = '<div class="row-btns"><b>Acquisition charges</b><span class="muted">kept on this screen, the JSON and the printout — nothing is posted to Fusion. Amounts in ' + esc(base) + '.</span><span class="grow"></span><button class="btn sm primary" data-pc="addch"><i class="fa-solid fa-plus"></i> Add charge</button></div>' +
        (C.length ? '<table class="tbl edit"><thead><tr><th>Charge</th><th>Description</th><th>Currency</th><th class="n">Amount</th><th class="n">Accounted ' + esc(base) + '</th><th>Apportion by</th><th></th></tr></thead><tbody>' + C.map(function (c) {
            return '<tr><td><select data-c="type" data-k="' + c._k + '">' + PC_CHARGES.map(function (x) { return '<option' + (x === c.type ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></td><td><input data-c="desc" data-k="' + c._k + '" value="' + esc(c.desc) + '"></td>' +
                '<td><input data-c="ccy" data-k="' + c._k + '" value="' + esc(c.ccy) + '" list="pc-ccys" style="width:80px;text-transform:uppercase"></td><td><input type="number" step="0.01" data-c="amount" data-k="' + c._k + '" value="' + esc(c.amount) + '"></td>' +
                '<td class="n">' + (c.fxBusy ? PUR.spin : c.ccy && c.ccy !== base && !c.fx ? '<span class="chip err">No rate found</span>' : FX.fmt.money(pcAccounted(c))) + '</td>' +
                '<td><select data-c="apportion" data-k="' + c._k + '">' + [['value', 'By value'], ['qty', 'By quantity'], ['equal', 'Equal'], ['manual', 'Manual']].map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === c.apportion ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></td>' +
                '<td><button class="btn sm icon danger" data-pc="delch" data-k="' + c._k + '"><i class="fa-solid fa-trash"></i></button></td></tr>';
        }).join('') + '</tbody><tfoot><tr><td colspan="4">Total charges</td><td class="n">' + FX.fmt.money(totAcc) + '</td><td colspan="2"></td></tr></tfoot></table>' : '<div class="muted" style="font-size:.78rem">No charges. Add freight, insurance, duty… to see the landed cost per line.</div>') +
        (L.length ? '<h4 style="margin-top:6px">Landed cost per line</h4><div class="pu-scroll"><table class="tbl edit"><thead><tr><th>#</th><th>Item</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Line amount</th>' + manual.map(function (c) { return '<th class="n">' + esc(c.type) + ' (manual)</th>'; }).join('') +
            '<th class="n">Charges</th><th class="n">Landed cost</th><th class="n">Landed unit</th><th class="n">% change</th></tr></thead><tbody>' + L.map(function (l) {
                var amt = pcCalc(l).amt, ch = al[l._k], landed = amt + ch, unit = PUR.n(l.qty) ? landed / PUR.n(l.qty) : 0, pct = PUR.n(l.price) ? (unit - l.price) / l.price * 100 : 0;
                return '<tr><td>' + l.lineNum + '</td><td class="mono">' + esc(l.itemNumber) + '</td><td class="n">' + FX.fmt.num(l.qty) + '</td><td class="n">' + FX.fmt.money(l.price) + '</td><td class="n">' + FX.fmt.money(amt) + '</td>' +
                    manual.map(function (c) { return '<td><input type="number" step="0.01" data-l="manual" data-ch="' + c._k + '" data-k="' + l._k + '" value="' + esc((l.manual || {})[c._k] || 0) + '"></td>'; }).join('') +
                    '<td class="n">' + FX.fmt.money(ch) + '</td><td class="n"><b>' + FX.fmt.money(landed) + '</b></td><td class="n">' + FX.fmt.num(unit, 4) + '</td><td class="n" style="color:' + (pct > 0 ? 'var(--warn)' : 'inherit') + '">' + pct.toFixed(2) + '%</td></tr>';
            }).join('') + '</tbody><tfoot><tr><td colspan="4">Total</td><td class="n">' + FX.fmt.money(pcTotals().amt) + '</td>' + manual.map(function () { return '<td></td>'; }).join('') + '<td class="n">' + FX.fmt.money(L.reduce(function (s, l) { return s + al[l._k]; }, 0)) + '</td><td class="n">' + FX.fmt.money(pcTotals().amt + L.reduce(function (s, l) { return s + al[l._k]; }, 0)) + '</td><td colspan="2"></td></tr></tfoot></table></div>' : '');
}

// ── Fusion bodies ──────────────────────────────────────────────
function pcLineBody(l, num) {
    var h = PC.header, org = (PC._orgs || []).filter(function (o) { return o.v === h.shipToOrg; })[0], loc = h.shipToLocation || h.shipToOrg;
    var dist = { DistributionNumber: 1, DeliverToLocation: loc, DeliverToLocationCode: loc, Quantity: PUR.n(l.qty) };
    if (h.subinventory && l.destinationType !== 'Expense') dist.DestinationSubinventory = h.subinventory;
    return {
        LineNumber: num != null ? num : l.lineNum, LineType: 'Goods', Item: l.itemNumber, Description: l.description, Quantity: PUR.n(l.qty), Price: PUR.n(l.price), UOM: l.uom,
        schedules: [{
            ScheduleNumber: 1, Quantity: PUR.n(l.qty), ShipToLocation: loc, ShipToOrganizationCode: h.shipToOrg, ShipToOrganization: org && org.o ? org.o.OrganizationName : null,
            ReceiptCloseTolerancePercent: 0, InvoiceMatchOptionCode: 'P', InvoiceMatchOption: 'Order', EarlyReceiptToleranceDays: 0, InvoiceCloseTolerancePercent: 0, LateReceiptToleranceDays: 0,
            AccrueAtReceiptFlag: true, InspectionRequiredFlag: true, ReceiptRequiredFlag: false, ReceiptRoutingId: 3, ReceiptRouting: 'Direct delivery',
            DestinationTypeCode: l.destinationType === 'Expense' ? 'EXPENSE' : 'INVENTORY', MatchApprovalLevelCode: '3-Way', MatchApprovalLevel: '3 Way',
            RequestedDeliveryDate: l.needBy || null, distributions: [dist]
        }]
    };
}
function pcRate() { var h = PC.header; if (!h.currency || h.currency === pcBase()) return null; if (PC.rateType === 'USER') return PUR.n(PC.userRate) > 0 ? { type: 'USER', rate: PUR.n(PC.userRate), date: null } : null; return PC.fx && PC.fx.rate ? { type: 'CORPORATE', rate: PC.fx.rate, date: PC.fx.date } : null; }
function pcAutoNumber() {
    var h = PC.header, d = new Date(), seq = (+sessionStorage.getItem('po_seq') || 0) + 1;
    try { sessionStorage.setItem('po_seq', seq); } catch (e) { }
    return h.docType + ('0' + d.getDate()).slice(-2) + ('0' + (d.getMonth() + 1)).slice(-2) + d.getFullYear() + ('000' + seq).slice(-4);
}
function pcBody() {
    var h = PC.header, r = pcRate();
    var b = {
        ProcurementBUId: +h.procurementBU, OrderNumber: h.poNumber, RequiredAcknowledgment: 'None', CurrencyCode: h.currency, Currency: pcCcyName(h.currency),
        ConversionRateTypeCode: r ? r.type : null, ConversionRateType: r ? r.type : null, ConversionRateDate: r && r.date ? r.date : null, ConversionRate: r ? r.rate : null,
        Buyer: h.buyer || null, PayOnReceiptFlag: h.payOnReceipt ? 'Y' : 'N', RequisitioningBUId: h.requisitioningBU ? +h.requisitioningBU : +h.procurementBU,
        Supplier: h.supplierName, SupplierSite: h.supplierSite || null, BillToLocation: h.billToLocation || null, DefaultShipToLocation: h.shipToLocation || null,
        ModeOfTransportCode: h.shippingMethod || null, BuyerManagedTransportFlag: false, SupplierEmailAddress: h.email || null,
        lines: PC.lines.map(function (l, i) { return pcLineBody(l, i + 1); })
    };
    if (h.description) b.Description = h.description;
    if (h.noteToSupplier) b.NoteToSupplier = h.noteToSupplier;
    if (h.paymentTerms) b.PaymentTerms = h.paymentTerms;
    if (h.contact) b.SupplierContact = h.contact;
    return b;
}
function pcValidate() {
    var h = PC.header, e = [];
    if (!h.procurementBU) e.push('Procurement BU is required.');
    if (!h.supplierName) e.push('Supplier is required — pick one from the list.');
    if (!h.shipToOrg) e.push('Ship-to organization is required.');
    if (!h.buyer) e.push('Buyer is required.');
    if (!h.currency) e.push('Currency is required.');
    if (h.currency && h.currency !== pcBase()) {
        if (PC.rateType === 'CORPORATE') { if (PC.fxState === 'loading') e.push('The Corporate rate is still loading.'); else if (!PC.fx || !(PC.fx.rate > 0)) e.push('No Corporate rate found for ' + h.currency + ' → ' + pcBase() + ' — use a User rate.'); }
        else if (!(PUR.n(PC.userRate) > 0)) e.push('Enter a User conversion rate greater than 0.');
    }
    if (!PC.lines.length) e.push('Add at least one line.');
    var nb = PC.lines.filter(function (l) { return !l.needBy; }).map(function (l) { return l.lineNum; });
    if (nb.length) e.push('Need-by date missing on lines: ' + nb.join(', ') + '.');
    var q0 = PC.lines.filter(function (l) { return !(PUR.n(l.qty) > 0); }).map(function (l) { return l.lineNum; });
    if (q0.length) e.push('Quantity must be greater than 0 on lines: ' + q0.join(', ') + '.');
    return e;
}

// ── save / submit ──────────────────────────────────────────────
function pcSaveNew() {
    var errs = pcValidate();
    if (errs.length) { FX.modal({ title: 'Cannot create the purchase order', body: '<div class="note err"><ul style="margin-left:18px">' + errs.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' }); return; }
    if (!PC.header.poNumber) PC.header.poNumber = pcAutoNumber();
    var body = pcBody();
    FX.busy('Creating draft purchase order in Fusion…');
    FX.restRaw('POST', 'draftPurchaseOrders', { onlyData: false }, body).then(function (r) {
        FX.busy(false);
        var j = r.json || {};
        if (r.ok && j.OrderNumber) {
            PC.poHeaderId = j.POHeaderId; PC.header.poNumber = j.OrderNumber; PC.header.status = j.Status || j.DocumentStatus || PC.header.status;
            PC.lines.forEach(function (l, i) { var fl = ((j.lines && (j.lines.items || j.lines)) || [])[i]; if (fl) l.poLineId = fl.POLineId; });
            pcRender();
            FX.modal({
                title: '<i class="fa-solid fa-circle-check" style="color:var(--ok)"></i> Purchase order created', body: '<div class="note ok">Draft <b class="mono">' + esc(j.OrderNumber) + '</b> was created in Fusion (POHeaderId ' + esc(j.POHeaderId) + ').</div>',
                buttons: [{ label: 'Stay here', act: 'close' }, { label: 'Go to PO list', act: 'list' }, { label: '<i class="fa-solid fa-paper-plane"></i> Submit for approval', cls: 'primary', act: 'submit' }],
                onAction: function (a) { if (a === 'list') setTimeout(function () { PUR.go('pos', { po: j.OrderNumber }); }, 0); if (a === 'submit') setTimeout(pcSubmit, 0); }
            });
        } else {
            var name = 'PO_' + String(PC.header.poNumber).replace(/[^\w-]/g, '_') + '_FAILED_' + PUR.stamp() + '.json';
            PUR.download(name, JSON.stringify(pcSnapshot(), null, 2));
            FX.modal({ title: 'Fusion did not create the purchase order', wide: true, body: '<div class="note err" style="white-space:pre-wrap">' + esc(r.error || ('HTTP ' + r.status + ' — no OrderNumber in the reply')) + '</div><div class="muted">A backup of this PO was saved as <b>' + esc(name) + '</b>.</div><pre class="json">' + esc(r.text.slice(0, 8000)) + '</pre>' });
        }
    }).catch(function (e) { FX.busy(false); var name = 'PO_' + String(PC.header.poNumber).replace(/[^\w-]/g, '_') + '_FAILED_' + PUR.stamp() + '.json'; PUR.download(name, JSON.stringify(pcSnapshot(), null, 2)); FX.modal({ title: 'Could not reach Fusion', body: '<div class="note err">' + esc(e) + '</div><div class="muted">Backup saved as ' + esc(name) + '.</div>' }); });
}
function pcSubmit() {
    if (!PC.poHeaderId) { FX.toast('Save the purchase order first, then submit it for approval.', 'err'); return; }
    if (PC.mode === 'edit' && PC.lines.some(function (l) { return !l.poLineId; })) { FX.toast('Save the new lines first (Save changes).', 'err'); return; }
    PUR.runAction('draftPurchaseOrders', PC.poHeaderId, 'submit').then(function (st) { if (st != null) { PC.header.status = st || 'Pending approval'; pcRender(); } });
}
function pcEditOps() {
    var id = PC.poHeaderId, ops = [], max = Math.max.apply(null, [0].concat(PC.lines.filter(function (l) { return l.poLineId; }).map(function (l) { return +l.lineNum || 0; })));
    PC.lines.filter(function (l) { return !l.poLineId; }).forEach(function (l) { max++; ops.push({ kind: 'add', l: l, label: 'Add ' + l.itemNumber, method: 'POST', path: 'draftPurchaseOrders/' + id + '/child/lines', body: pcLineBody(l, max), num: max }); });
    PC.lines.filter(function (l) { return l.poLineId; }).forEach(function (l) {
        ops.push({ kind: 'upd', l: l, label: 'Update line ' + l.lineNum, method: 'PATCH', path: 'draftPurchaseOrders/' + id + '/child/lines/' + l.poLineId, body: { Quantity: PUR.n(l.qty), Price: PUR.n(l.price), Description: l.description } });
        if (l.scheduleId && l.needBy) ops.push({ kind: 'nb', l: l, label: 'Need-by line ' + l.lineNum, method: 'PATCH', path: 'draftPurchaseOrders/' + id + '/child/lines/' + l.poLineId + '/child/schedules/' + l.scheduleId, body: { RequestedDeliveryDate: l.needBy, Quantity: PUR.n(l.qty) } });
    });
    return ops;
}
function pcSaveEdit() {
    var nb = PC.lines.filter(function (l) { return !l.needBy; });
    if (nb.length) { FX.toast('Need-by date missing on lines: ' + nb.map(function (l) { return l.lineNum; }).join(', '), 'err'); return; }
    var ops = pcEditOps(), errs = [], i = 0;
    if (!ops.length) { FX.toast('Nothing to save.'); return; }
    (function next() {
        if (i >= ops.length) {
            FX.busy(false);
            if (errs.length) { pcRender(); FX.modal({ title: (ops.length - errs.length) + ' of ' + ops.length + ' changes saved', body: '<div class="note err" style="white-space:pre-wrap">' + esc(errs.join('\n')) + '</div>' }); }
            else { FX.toast('All changes saved in Fusion.', 'ok'); pcLoadDraft(PC.poHeaderId); }
            return;
        }
        var op = ops[i++]; FX.busy(op.label + ' (' + i + '/' + ops.length + ')…');
        FX.rest(op.method, op.path, {}, op.body).then(function (r) { if (op.kind === 'add') { op.l.poLineId = r.POLineId || r.LineId; op.l.lineNum = op.num; } }, function (e) { errs.push(op.label + ': ' + e); }).then(next);
    })();
}
function pcNextNumber() {
    var dt = PC.header.docType;
    FX.busy('Reading the latest ' + dt + ' number…');
    FX.get('purchaseOrders', { q: "OrderNumber LIKE '" + dt.replace(/'/g, "''") + "%'", orderBy: 'CreationDate:desc', limit: 1, fields: 'OrderNumber' }).then(function (j) {
        FX.busy(false);
        var last = ((j.items || [])[0] || {}).OrderNumber, m = last && String(last).match(/^(.+?)(\d+)$/);
        if (!last) PC.header.poNumber = dt + '1000';
        else if (!m) { FX.toast('Latest number "' + last + '" has no numeric part — enter the number manually.', 'err'); return; }
        else { var n = String(+m[2] + 1); while (n.length < m[2].length) n = '0' + n; PC.header.poNumber = m[1] + n; }
        pcRender(); FX.toast('Next number: ' + PC.header.poNumber + (last ? ' (after ' + last + ')' : ''));
    }).catch(function (e) { FX.busy(false); FX.toast(String(e), 'err'); });
}
function pcPreview() {
    if (PC.mode === 'edit') {
        var ops = pcEditOps();
        FX.modal({ title: 'Save changes — ' + ops.length + ' request(s)', wide: true, body: ops.length ? ops.map(function (o) { return '<div><b>' + esc(o.label) + '</b> <span class="mono">' + o.method + ' ' + esc(FX.url(o.path, { onlyData: false })) + '</span><pre class="json">' + esc(JSON.stringify(o.body, null, 2)) + '</pre></div>'; }).join('') : '<div class="empty">No changes.</div>' });
        return;
    }
    FX.json('POST ' + FX.url('draftPurchaseOrders', { onlyData: false }), pcBody());
}

// ── JSON snapshot ──────────────────────────────────────────────
function pcSnapshot() {
    return { _reactErp: 'purchase-order', version: 1, savedAt: new Date().toISOString(), header: Object.assign({}, PC.header, { rateType: PC.rateType, userRate: PC.userRate }), lines: PC.lines.map(function (l) { var x = Object.assign({}, l); delete x._k; delete x.assign; return x; }), acqCharges: PC.charges.map(function (c) { return { type: c.type, desc: c.desc, ccy: c.ccy, amount: c.amount, apportion: c.apportion }; }) };
}
function pcSaveJson() { PUR.download('PO_' + String(PC.header.poNumber || 'draft').replace(/[^\w-]/g, '_') + '_' + PUR.stamp() + '.json', JSON.stringify(pcSnapshot(), null, 2)); FX.toast('Saved.'); }
function pcLoadJson(txt) {
    var j; try { j = JSON.parse(txt); } catch (e) { FX.toast('Not a JSON file.', 'err'); return; }
    if (!j || j._reactErp !== 'purchase-order' || !j.header) { FX.toast('Not a valid ReactERP purchase-order JSON file', 'err'); return; }
    PC = pcNew('new');
    Object.keys(PC.header).forEach(function (k) { if (j.header[k] != null) PC.header[k] = j.header[k]; });
    PC.header.orderDate = FX.fmt.date(j.header.orderDate) || FX.today();
    PC.header.status = 'Incomplete';
    if (j.header.rateType) PC.rateType = j.header.rateType; if (j.header.userRate) PC.userRate = j.header.userRate;
    PC.lines = (j.lines || []).map(function (l) { return pcLine({ itemNumber: l.itemNumber || '', description: l.description || '', uom: l.uom || '', qty: PUR.n(l.qty), price: PUR.n(l.price), taxPct: PUR.n(l.taxPct), needBy: FX.fmt.date(l.needBy), destinationType: l.destinationType || 'Inventory', chargeAccount: l.chargeAccount || '' }); });
    pcRenumber();
    PC.charges = (j.acqCharges || []).map(function (c) { var x = { _k: ++_pcSeq, type: c.type || 'Other', desc: c.desc || c.description || '', ccy: c.ccy || c.currency || '', amount: PUR.n(c.amount), apportion: c.apportion || 'value', fx: null }; pcChargeFx(x); return x; });
    pcRender(); pcLoadFx();
    FX.toast('Loaded ' + PC.lines.length + ' line(s) — save to create it in Fusion.', 'ok');
}

// ── print ──────────────────────────────────────────────────────
function pcPrint() {
    var h = PC.header, t = pcTotals(), chTot = PC.charges.reduce(function (s, c) { return s + pcAccounted(c); }, 0), r = pcRate();
    var cell = function (l, v) { return v ? '<div><span>' + esc(l) + '</span>' + esc(v) + '</div>' : ''; };
    PUR.print('PO ' + (h.poNumber || 'draft'), '<h1>Purchase Order ' + esc(h.poNumber || '(draft)') + '</h1><div>' + esc(h.status) + ' · ' + esc(h.docType) + ' · ' + esc(h.orderDate) + ' · Buyer ' + esc(h.buyer) + '</div>' +
        '<h3>Supplier</h3><div class="grid">' + cell('Supplier', h.supplierName) + cell('Site', h.supplierSite) + cell('E-mail', h.email) + '</div>' +
        '<h3>Organization</h3><div class="grid">' + cell('Procurement BU', PC._buName || h.procurementBU) + cell('Ship to', h.shipToOrg + (h.subinventory ? ' / ' + h.subinventory : '')) + cell('Currency', h.currency) + (r ? cell('Conversion', '1 ' + h.currency + ' = ' + r.rate + ' ' + pcBase() + ' (' + r.type + ')') : '') + '</div>' +
        '<h3>Lines</h3><table><tr><th>#</th><th>Item</th><th>Description</th><th>UOM</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Amount</th><th class="n">Net total</th><th>Need by</th></tr>' +
        PC.lines.map(function (l) { var c = pcCalc(l); return '<tr><td>' + l.lineNum + '</td><td>' + esc(l.itemNumber) + '</td><td>' + esc(l.description) + '</td><td>' + esc(l.uom) + '</td><td class="n">' + FX.fmt.num(l.qty) + '</td><td class="n">' + FX.fmt.money(l.price) + '</td><td class="n">' + FX.fmt.money(c.amt) + '</td><td class="n">' + FX.fmt.money(c.net) + '</td><td>' + esc(l.needBy) + '</td></tr>'; }).join('') +
        '<tr class="tot"><td colspan="6">Subtotal</td><td class="n">' + FX.fmt.money(t.amt) + '</td><td class="n">' + FX.fmt.money(t.net) + '</td><td></td></tr><tr class="tot"><td colspan="7">Total tax (estimate)</td><td class="n">' + FX.fmt.money(t.tax) + '</td><td></td></tr>' +
        (PC.charges.length ? '<tr class="tot"><td colspan="7">Acquisition charges (' + esc(pcBase()) + ')</td><td class="n">' + FX.fmt.money(chTot) + '</td><td></td></tr>' : '') +
        '<tr class="tot"><td colspan="7">Grand total ' + esc(h.currency) + '</td><td class="n">' + FX.fmt.money(t.net) + '</td><td></td></tr></table>' +
        (PC.charges.length ? '<h3>Acquisition charges</h3><table><tr><th>Charge</th><th>Description</th><th>Currency</th><th class="n">Amount</th><th class="n">Accounted ' + esc(pcBase()) + '</th><th>Apportion</th></tr>' + PC.charges.map(function (c) { return '<tr><td>' + esc(c.type) + '</td><td>' + esc(c.desc) + '</td><td>' + esc(c.ccy) + '</td><td class="n">' + FX.fmt.money(c.amount) + '</td><td class="n">' + FX.fmt.money(pcAccounted(c)) + '</td><td>' + esc(c.apportion) + '</td></tr>'; }).join('') + '</table>' : '') +
        (h.noteToSupplier ? '<h3>Note to supplier</h3><div>' + esc(h.noteToSupplier) + '</div>' : ''));
}
