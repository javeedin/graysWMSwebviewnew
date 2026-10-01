/* Fusion Purchasing — PO Loading: Excel / CSV → grouped POs → validate suppliers, items, warehouses → one draftPurchaseOrders POST per PO.
   Reads .xlsx/.xls with SheetJS (cdnjs) when it is loaded; .csv always works. */

var PL = null;
var PL_ALIASES = {
    businessUnit: ['businessunit', 'bu', 'businessunitname'], trxCode: ['trxcode', 'trx', 'transactioncode', 'trxtype', 'ordertype', 'documentstyle'],
    poNumber: ['ponumber', 'po', 'purchaseorder', 'ordernumber', 'pono'], date: ['date', 'podate', 'orderdate'],
    supplierCode: ['suppliercode', 'supplier', 'suppliernumber', 'vendorcode', 'vendor'], currency: ['pocurrency', 'currency', 'currencycode', 'ccy'],
    itemCode: ['itemcode', 'item', 'itemnumber', 'itemcodee'], qty: ['qty', 'quantity', 'orderedquantity'], unitPrice: ['unitprice', 'price', 'unitcost', 'cost'],
    organization: ['organization', 'org', 'warehouse', 'organizationcode', 'inventoryorg'], subinventory: ['subinventory', 'subinv', 'subinventorycode'],
    needByDate: ['needbydate', 'needby', 'requireddate', 'needbydte']
};
var PL_HEAD = ['BusinessUnit', 'TrxCode', 'PONumber', 'Date', 'SupplierCode', 'POCurrency', 'ItemCode', 'Qty', 'UnitPrice', 'Organization', 'Subinventory', 'NeedByDate'];
var PL_SAMPLE = ['MITSUMI DISTRIBUTION FZCO', 'STANDARD', 'PO-1001', '2026-07-27', 'DCLG0030', 'AED', '167815', 10, 25.5, 'MLC', 'S01EA', '2026-08-15'];

function purPoLoading(el) {
    if (!PL) PL = { rows: [], file: '', sel: {}, tab: 'po' };
    el.innerHTML = '<div class="card pad"><div class="row-btns"><div class="pu-drop grow" id="pl-drop"><i class="fa-solid fa-file-excel"></i><b>Drop the PO Excel file here</b> or click to choose (.xlsx, .xls, .csv)<div class="muted" style="font-size:.74rem;margin-top:4px">One row per PO line · rows with the same PONumber become one draft PO · Fusion assigns the order number</div></div>' +
        '<div style="display:flex;flex-direction:column;gap:6px"><button class="btn" id="pl-tpl"><i class="fa-solid fa-download"></i> Download format</button><button class="btn danger" id="pl-clear"><i class="fa-solid fa-eraser"></i> Clear</button></div></div><input type="file" id="pl-file" accept=".xlsx,.xls,.csv" hidden></div><div id="pl-out" style="display:flex;flex-direction:column;gap:10px"></div>';
    var drop = $('pl-drop');
    drop.onclick = function () { $('pl-file').click(); };
    drop.ondragover = function (e) { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = function () { drop.classList.remove('over'); };
    drop.ondrop = function (e) { e.preventDefault(); drop.classList.remove('over'); var f = e.dataTransfer.files[0]; if (f) plRead(f); };
    $('pl-file').onchange = function () { var f = this.files[0]; this.value = ''; if (f) plRead(f); };
    $('pl-tpl').onclick = plTemplate;
    $('pl-clear').onclick = function () { PL = { rows: [], file: '', sel: {}, tab: 'po' }; plDraw(); };
    plDraw();
}
function plTemplate() {
    if (window.XLSX) { var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([PL_HEAD, PL_SAMPLE]), 'PO_Load'); XLSX.writeFile(wb, 'PO_Load_Template.xlsx'); return; }
    PUR.download('PO_Load_Template.csv', '﻿' + [PL_HEAD.join(','), PL_SAMPLE.map(function (v) { return /,/.test(String(v)) ? '"' + v + '"' : v; }).join(',')].join('\r\n'), 'text/csv');
}
function plCsv(text) {
    var rows = [], row = [], cur = '', q = false;
    text = String(text).replace(/^﻿/, '');
    var sep = (text.split(/\r?\n/)[0].match(/\t/g) || []).length > (text.split(/\r?\n/)[0].match(/,/g) || []).length ? '\t' : (text.split(/\r?\n/)[0].match(/;/g) || []).length > (text.split(/\r?\n/)[0].match(/,/g) || []).length ? ';' : ',';
    for (var i = 0; i < text.length; i++) {
        var c = text[i];
        if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
        else if (c === '"') q = true; else if (c === sep) { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim(); }); });
}
function plDate(v) {
    if (v == null || v === '') return undefined;
    if (v instanceof Date) return isNaN(v) ? undefined : FX.today(v);
    if (typeof v === 'number' && v > 20000 && v < 80000) { var d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
    var s = String(v).trim(), m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    var d2 = new Date(s); return isNaN(d2) ? s : FX.today(d2);
}
function plMap(aoa) {
    if (!aoa.length) throw 'No data rows found in the file.';
    var head = aoa[0].map(function (h) { return String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, ''); }), idx = {};
    Object.keys(PL_ALIASES).forEach(function (k) { var i = head.findIndex(function (h) { return PL_ALIASES[k].indexOf(h) >= 0; }); if (i >= 0) idx[k] = i; });
    if (idx.poNumber == null && idx.itemCode == null && idx.supplierCode == null) throw 'Could not recognise the columns. Please use the PO Load template.';
    var rows = aoa.slice(1).map(function (r) {
        var o = {};
        Object.keys(idx).forEach(function (k) { var v = r[idx[k]]; if (k === 'qty' || k === 'unitPrice') o[k] = v == null || v === '' ? undefined : Number(String(v).replace(/,/g, '')); else if (k === 'date' || k === 'needByDate') o[k] = plDate(v); else { v = v == null ? '' : String(v).trim(); o[k] = v || undefined; } });
        return o;
    }).filter(function (o) { return o.poNumber || o.itemCode || o.supplierCode; });
    if (!rows.length) throw 'No data rows found in the file.';
    rows.forEach(function (r, i) { r._i = i; });
    return rows;
}
function plRead(f) {
    var done = function (aoa) { try { PL = { rows: plMap(aoa), file: f.name, sel: {}, tab: 'po' }; plGroups().forEach(function (g) { PL.sel[g.po] = true; }); plDraw(); FX.toast(PL.rows.length + ' line(s) read from ' + f.name + '.', 'ok'); } catch (e) { FX.toast(String(e), 'err'); } };
    if (/\.csv$/i.test(f.name)) { f.text().then(function (t) { done(plCsv(t)); }).catch(function (e) { FX.toast('Failed to read the file: ' + e, 'err'); }); return; }
    if (!window.XLSX) { FX.toast('The Excel reader did not load — save the sheet as CSV and drop that.', 'err'); return; }
    f.arrayBuffer().then(function (buf) { var wb = XLSX.read(buf, { type: 'array', cellDates: true }); done(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true })); }).catch(function (e) { FX.toast('Failed to read the file: ' + e, 'err'); });
}
function plGroups(rows) {
    var m = {}, order = [];
    (rows || PL.rows).forEach(function (r) { var k = r.poNumber || '(blank)'; if (!m[k]) { m[k] = { po: k, lines: [] }; order.push(k); } m[k].lines.push(r); });
    return order.map(function (k) {
        var g = m[k], f = g.lines[0];
        return Object.assign(g, { bu: f.businessUnit, trx: f.trxCode, supplier: f.supplierCode, ccy: f.currency, date: f.date, items: PUR.distinct(g.lines, 'itemCode').length, n: g.lines.length, qty: PUR.sum(g.lines, 'qty'), value: PUR.sum(g.lines, function (r) { return PUR.n(r.qty) * PUR.n(r.unitPrice); }) });
    });
}
function plDraw() {
    var el = $('pl-out'); if (!el) return;
    if (!PL.rows.length) { el.innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-table"></i>No file loaded. Columns: ' + PL_HEAD.join(', ') + '.</div></div>'; return; }
    var G = plGroups(), nSel = G.filter(function (g) { return PL.sel[g.po]; }).length, byCcy = PUR.groupSum(PL.rows, function (r) { return r.currency || '—'; }, function (r) { return PUR.n(r.qty) * PUR.n(r.unitPrice); });
    el.innerHTML = PUR.kpis([{ label: 'Purchase orders', value: G.length }, { label: 'Lines', value: PL.rows.length }, { label: 'Suppliers', value: PUR.distinct(PL.rows, 'supplierCode').length }, { label: 'Distinct items', value: PUR.distinct(PL.rows, 'itemCode').length }]
        .concat(byCcy.slice(0, 3).map(function (c) { return { label: 'Total value · ' + c.label, value: PUR.compact(c.v) }; }))) +
        '<div class="card"><div class="filters" style="border-bottom:1px solid var(--line)"><span class="chip info"><i class="fa-solid fa-file-excel"></i> ' + esc(PL.file) + '</span><span class="grow"></span><span class="muted">' + nSel + ' of ' + G.length + ' PO(s) selected</span>' +
        '<button class="btn primary" id="pl-val"' + (nSel ? '' : ' disabled') + '><i class="fa-solid fa-list-check"></i> Load & validate</button></div>' +
        '<div class="pu-tabs" id="pl-tabs"><button data-t="po" class="' + (PL.tab === 'po' ? 'on' : '') + '">Purchase orders <span class="cnt">' + G.length + '</span></button><button data-t="ln" class="' + (PL.tab === 'ln' ? 'on' : '') + '">Lines <span class="cnt">' + PL.rows.length + '</span></button></div>' +
        '<div class="pu-body pu-scroll" id="pl-tab"></div></div>';
    $('pl-tabs').onclick = function (e) { var b = e.target.closest('[data-t]'); if (b) { PL.tab = b.getAttribute('data-t'); plDraw(); } };
    $('pl-val').onclick = function () { var sel = G.filter(function (g) { return PL.sel[g.po]; }); if (!sel.length) { FX.toast('Select at least one PO.', 'err'); return; } plValidateDialog([].concat.apply([], sel.map(function (g) { return g.lines; }))); };
    if (PL.tab === 'po') {
        $('pl-tab').innerHTML = '<table class="tbl"><thead><tr><th><input type="checkbox" id="pl-all"' + (nSel === G.length ? ' checked' : '') + '></th><th>Business unit</th><th>PO number</th><th>Trx code</th><th>Supplier</th><th>CCY</th><th>Date</th><th class="n"># Items</th><th class="n"># Lines</th><th class="n">Total qty</th><th class="n">Total value</th></tr></thead><tbody>' +
            G.map(function (g) { return '<tr><td><input type="checkbox" data-po="' + esc(g.po) + '"' + (PL.sel[g.po] ? ' checked' : '') + '></td><td>' + esc(g.bu) + '</td><td class="mono"><b>' + esc(g.po) + '</b></td><td>' + esc(g.trx) + '</td><td>' + esc(g.supplier) + '</td><td>' + esc(g.ccy) + '</td><td>' + esc(g.date) + '</td><td class="n">' + g.items + '</td><td class="n">' + g.n + '</td><td class="n">' + FX.fmt.num(g.qty) + '</td><td class="n"><b>' + FX.fmt.money(g.value) + '</b> <i class="ccy">' + esc(g.ccy || '') + '</i></td></tr>'; }).join('') + '</tbody></table>';
        $('pl-tab').onchange = function (e) { var t = e.target; if (t.id === 'pl-all') G.forEach(function (g) { PL.sel[g.po] = t.checked; }); else if (t.matches('[data-po]')) PL.sel[t.getAttribute('data-po')] = t.checked; plDraw(); };
    } else {
        $('pl-tab').innerHTML = FX.table(PL.rows, [{ label: 'PO', f: 'poNumber', fmt: 'mono' }, { label: 'Business unit', f: 'businessUnit' }, { label: 'Trx', f: 'trxCode' }, { label: 'Supplier', f: 'supplierCode' }, { label: 'CCY', f: 'currency' }, { label: 'Item', f: 'itemCode', fmt: 'mono' }, { label: 'Qty', f: 'qty', n: 1, fmt: 'num' }, { label: 'Unit price', f: 'unitPrice', n: 1, fmt: 'money' }, { label: 'Amount', n: 1, get: function (r) { return PUR.n(r.qty) * PUR.n(r.unitPrice); }, fmt: 'money' }, { label: 'Organization', f: 'organization' }, { label: 'Subinventory', f: 'subinventory' }, { label: 'Need by', f: 'needByDate' }]);
    }
}

// ── validate + load dialog ─────────────────────────────────────
function plValidateDialog(lines) {
    var V = { lines: lines, ovr: {}, res: null, subs: {}, orgs: [], bus: [], fillOrg: '', fillSub: '', bu: lines[0].businessUnit || '' };
    var org = function (l) { return (V.ovr[l._i] && V.ovr[l._i].org != null ? V.ovr[l._i].org : l.organization) || ''; };
    var sub = function (l) { return (V.ovr[l._i] && V.ovr[l._i].sub != null ? V.ovr[l._i].sub : l.subinventory) || ''; };
    var loadSubs = function (o) { if (!o || V.subs[o]) return Promise.resolve(V.subs[o] || []); V.subs[o] = []; return FX.subinvs(o).then(function (l) { V.subs[o] = l.map(function (x) { return x.v; }); return V.subs[o]; }).catch(function () { return []; }); };
    var ok = function (b) { return b == null ? '<span class="muted">—</span>' : b ? '<span class="chip ok" title="Found in Fusion">✓</span>' : '<span class="chip err" title="Not found in Fusion">✗</span>'; };
    var draw = function () {
        var R = V.res, orgOpt = function (v) { return '<option value="">—</option>' + V.orgs.map(function (o) { return '<option' + (o.v === v ? ' selected' : '') + '>' + esc(o.v) + '</option>'; }).join('') + (v && !V.orgs.some(function (o) { return o.v === v; }) ? '<option selected>' + esc(v) + '</option>' : ''); };
        var subOpt = function (o, v) { var l = V.subs[o] || []; return '<option value="">—</option>' + l.map(function (s) { return '<option' + (s === v ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + (v && l.indexOf(v) < 0 ? '<option selected>' + esc(v) + '</option>' : ''); };
        var bus = PUR.distinct(V.bus.map(function (b) { return { v: b.v }; }).concat(V.lines.map(function (l) { return { v: l.businessUnit }; })), 'v');
        $('pv-head').innerHTML = '<div class="pu-inline"><label>Business unit <select id="pv-bu">' + bus.map(function (b) { return '<option' + (b === V.bu ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') + '</select></label>' +
            '<label>Fill organization <select id="pv-forg">' + orgOpt(V.fillOrg) + '</select></label><label>Fill subinventory <select id="pv-fsub">' + subOpt(V.fillOrg, V.fillSub) + '</select></label><button class="btn sm" id="pv-apply"><i class="fa-solid fa-fill-drip"></i> Apply to blank warehouses</button></div>' +
            (R ? '<div class="note ' + (R.all ? 'ok' : 'warn') + '" style="margin-top:8px">' + R.supOk + '/' + R.supN + ' suppliers valid · ' + R.itemOk + '/' + R.itemN + ' items valid · ' + R.whOk + '/' + V.lines.length + ' lines have a valid warehouse' + (R.all ? ' — all valid ✓' : '') + '</div>' : '<div class="muted" style="margin-top:8px;font-size:.78rem">Validate checks every supplier number, item and organization / subinventory against Fusion. Loading is allowed even when something is invalid — Fusion will reject what it cannot accept.</div>');
        $('pv-body').innerHTML = '<table class="tbl edit"><thead><tr><th>PO</th><th>Supplier</th><th></th><th>Item</th><th></th><th class="n">Qty</th><th class="n">Unit price</th><th>Organization</th><th>Subinventory</th><th></th><th>Need by</th></tr></thead><tbody>' + V.lines.map(function (l) {
            var o = org(l), s = sub(l), r = R && R.lines[l._i];
            return '<tr><td class="mono">' + esc(l.poNumber) + '</td><td>' + esc(l.supplierCode) + '</td><td>' + ok(r ? r.sup : null) + '</td><td class="mono">' + esc(l.itemCode) + '</td><td>' + ok(r ? r.item : null) + '</td><td class="n">' + FX.fmt.num(l.qty) + '</td><td class="n">' + FX.fmt.money(l.unitPrice) + '</td>' +
                '<td><select data-o="' + l._i + '" style="min-width:90px">' + orgOpt(o) + '</select></td><td><select data-s="' + l._i + '" style="min-width:100px">' + subOpt(o, s) + '</select></td><td>' + ok(r ? r.wh : null) + '</td><td>' + esc(l.needByDate || '') + '</td></tr>';
        }).join('') + '</tbody></table>';
        var lb = document.querySelector('[data-mact="load"]'); if (lb) lb.disabled = !R;
    };
    var validate = function () {
        FX.busy('Validating suppliers, items and warehouses…');
        var sups = PUR.distinct(V.lines, 'supplierCode'), items = PUR.distinct(V.lines, 'itemCode'), orgs = PUR.distinct(V.lines.map(function (l) { return { o: org(l) }; }), 'o');
        var supOk = {}, itemOk = {};
        return Promise.all([
            PUR.pool(sups, 5, function (s) { return FX.get('suppliers', { q: 'SupplierNumber=' + PUR.dq(s), limit: 1, fields: 'SupplierId' }).then(function (j) { supOk[s] = (j.items || []).length > 0; }, function () { supOk[s] = false; }); }),
            PUR.pool(items, 6, function (i) { return FX.get('itemsV2', { q: 'ItemNumber=' + PUR.dq(i), limit: 1, fields: 'ItemNumber' }).then(function (j) { itemOk[i] = (j.items || []).length > 0; }, function () { itemOk[i] = false; }); }),
            PUR.pool(orgs, 4, function (o) { delete V.subs[o]; return loadSubs(o); })
        ]).then(function () {
            var lines = {}, whOk = 0;
            V.lines.forEach(function (l) {
                var o = org(l), s = sub(l), wh = !!o && V.orgs.some(function (x) { return x.v === o; }) && !!s && (V.subs[o] || []).indexOf(s) >= 0;
                if (wh) whOk++;
                lines[l._i] = { sup: !!supOk[l.supplierCode], item: !!itemOk[l.itemCode], wh: wh };
            });
            var sOk = sups.filter(function (s) { return supOk[s]; }).length, iOk = items.filter(function (i) { return itemOk[i]; }).length;
            V.res = { lines: lines, supN: sups.length, supOk: sOk, itemN: items.length, itemOk: iOk, whOk: whOk, all: sOk === sups.length && iOk === items.length && whOk === V.lines.length };
            FX.busy(false); draw();
        }).catch(function (e) { FX.busy(false); FX.toast(String(e), 'err'); });
    };
    var body = function (G) {
        var f = G.lines[0], bu = V.bu || f.businessUnit, b = {};
        if (bu) { b.ProcurementBU = bu; b.RequisitioningBU = bu; }
        if (f.supplierCode) b.SupplierNumber = f.supplierCode;
        if (f.currency) b.CurrencyCode = f.currency;
        if (f.trxCode) b.StyleDisplayName = f.trxCode;
        b.lines = G.lines.map(function (l, i) {
            var ln = { LineNumber: i + 1, LineType: 'Goods' }, o = org(l), s = sub(l);
            if (l.itemCode) ln.Item = l.itemCode; if (l.qty != null && !isNaN(l.qty)) ln.Quantity = l.qty; if (l.unitPrice != null && !isNaN(l.unitPrice)) ln.Price = l.unitPrice;
            var sc = { ScheduleNumber: 1 }; if (o) sc.ShipToOrganizationCode = o; if (l.qty != null) sc.Quantity = l.qty; if (l.needByDate) sc.RequestedDeliveryDate = l.needByDate;
            var d = { DistributionNumber: 1 }; if (l.qty != null) d.Quantity = l.qty; if (s) d.DestinationSubinventory = s;
            sc.distributions = [d]; ln.schedules = [sc];
            return ln;
        });
        return b;
    };
    var load = function () {
        var G = plGroups(V.lines), out = [], i = 0;
        (function next() {
            if (i >= G.length) {
                FX.busy(false);
                var okN = out.filter(function (r) { return r.ok; }).length;
                FX.toast(okN === out.length ? 'Loaded ' + okN + ' draft PO(s).' : okN + '/' + out.length + ' PO(s) loaded — check the errors.', okN === out.length ? 'ok' : 'err');
                plResults(out); return;
            }
            var g = G[i++], b = body(g); FX.busy('Creating draft PO for ' + g.po + ' (' + i + '/' + G.length + ')…');
            FX.restRaw('POST', 'draftPurchaseOrders', { onlyData: false }, b).then(function (r) { out.push({ po: g.po, ok: r.ok, status: r.status, order: r.json && r.json.OrderNumber, err: r.error, payload: b, resp: r.text }); }, function (e) { out.push({ po: g.po, ok: false, status: 0, err: String(e), payload: b, resp: String(e) }); }).then(next);
        })();
    };
    FX.modal({
        title: '<i class="fa-solid fa-list-check" style="color:var(--accent)"></i> Validate PO load — ' + plGroups(lines).length + ' PO(s), ' + lines.length + ' line(s)', wide: true,
        body: '<div id="pv-head"></div><div id="pv-body" class="pu-scroll" style="max-height:52vh"></div>',
        buttons: [{ label: 'Close', act: 'close' }, { label: '<i class="fa-solid fa-code"></i> Payloads', act: 'json' }, { label: '<i class="fa-solid fa-list-check"></i> Validate', act: 'val' }, { label: '<i class="fa-solid fa-cloud-arrow-up"></i> Load to Fusion', cls: 'primary', act: 'load' }],
        onOpen: function (box) {
            $('pv-head').innerHTML = '<div class="muted">' + PUR.spin + ' Loading business units and organizations…</div>';
            Promise.all([FX.lov('bus').catch(function () { return []; }), FX.lov('orgs').catch(function () { return []; })]).then(function (a) {
                V.bus = a[0]; V.orgs = a[1];
                return Promise.all(PUR.distinct(V.lines, 'organization').map(loadSubs));
            }).then(draw);
            box.addEventListener('change', function (e) {
                var t = e.target;
                if (t.id === 'pv-bu') V.bu = t.value;
                else if (t.id === 'pv-forg') { V.fillOrg = t.value; V.fillSub = ''; loadSubs(t.value).then(draw); }
                else if (t.id === 'pv-fsub') V.fillSub = t.value;
                else if (t.matches('[data-o]')) { var i = +t.getAttribute('data-o'); V.ovr[i] = { org: t.value, sub: '' }; V.res = null; loadSubs(t.value).then(draw); }
                else if (t.matches('[data-s]')) { var j = +t.getAttribute('data-s'); V.ovr[j] = V.ovr[j] || {}; V.ovr[j].sub = t.value; if (V.ovr[j].org == null) V.ovr[j].org = org(V.lines.filter(function (l) { return l._i === j; })[0]); V.res = null; draw(); }
            });
            box.addEventListener('click', function (e) {
                if (!e.target.closest('#pv-apply')) return;
                if (!V.fillOrg) { FX.toast('Choose the organization to fill.', 'err'); return; }
                var n = 0; V.lines.forEach(function (l) { if (!org(l) || !sub(l)) { V.ovr[l._i] = { org: org(l) || V.fillOrg, sub: sub(l) || (org(l) && org(l) !== V.fillOrg ? '' : V.fillSub) }; n++; } });
                V.res = null; loadSubs(V.fillOrg).then(draw); FX.toast(n + ' line(s) filled.');
            });
        },
        onAction: function (a) {
            if (a === 'val') { validate(); return false; }
            if (a === 'json') { FX.json('draftPurchaseOrders — one POST per PO', plGroups(V.lines).map(body)); return false; }
            if (a === 'load') { if (!V.res) { FX.toast('Validate first.', 'err'); return false; } setTimeout(load, 0); }
        }
    });
}
function plResults(out) {
    FX.modal({
        title: '<i class="fa-solid fa-cloud-arrow-up" style="color:var(--accent)"></i> Load results — ' + out.filter(function (r) { return r.ok; }).length + ' of ' + out.length + ' created', wide: true,
        body: out.map(function (r, i) {
            return '<div class="pu-sec"><div class="row-btns"><b class="mono">' + esc(r.po) + '</b>' + (r.ok ? '<span class="chip ok">OK · HTTP ' + r.status + '</span>' : '<span class="chip err">' + (r.status ? 'HTTP ' + r.status : 'Failed') + '</span>') + (r.order ? '<span>Order <b class="mono">' + esc(r.order) + '</b></span>' : '') +
                '<span class="grow"></span><button class="btn sm" data-cp="p' + i + '"><i class="fa-solid fa-copy"></i> Payload</button><button class="btn sm" data-cp="r' + i + '"><i class="fa-solid fa-copy"></i> Response</button></div>' +
                (r.ok ? '' : '<div class="note err" style="margin-top:6px;white-space:pre-wrap">' + esc(r.err || '') + '</div>') + '<details style="margin-top:6px"><summary class="muted" style="cursor:pointer;font-size:.76rem">Response body</summary><pre class="json">' + esc(String(r.resp || '').slice(0, 6000)) + '</pre></details></div>';
        }).join(''),
        buttons: [{ label: 'Go to purchase orders', act: 'pos' }, { label: 'Close', cls: 'primary', act: 'close' }],
        onOpen: function (box) { box.querySelector('.modal-b').onclick = function (e) { var b = e.target.closest('[data-cp]'); if (!b) return; var k = b.getAttribute('data-cp'), r = out[+k.slice(1)]; navigator.clipboard.writeText(k[0] === 'p' ? JSON.stringify(r.payload, null, 2) : String(r.resp || '')); FX.toast('Copied.'); }; },
        onAction: function (a) { if (a === 'pos') setTimeout(function () { PUR.go('pos', {}); }, 0); }
    });
}
