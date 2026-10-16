/* Order Management — Orders (board / list, order drawer with timeline and actions) and Approvals. */

var ORD = { view: 'board', rows: [], inited: false };
var ORD_COLS = [
    { k: 'DRAFT', t: 'Draft', st: ['DRAFT', 'REJECTED'] },
    { k: 'PENDING_APPROVAL', t: 'Waiting approval', st: ['PENDING_APPROVAL'] },
    { k: 'APPROVED', t: 'Approved', st: ['APPROVED'] },
    { k: 'FUSION_DRAFT', t: 'Fusion draft', st: ['FUSION_DRAFT'] },
    { k: 'SUBMITTED', t: 'In Fusion', st: ['SUBMITTED'] },
    { k: 'FAILED', t: 'Failed', st: ['FAILED'] }
];

function ordersOpen() { if (!ORD.inited) ordWire(); ordLoad(); }
function ordWire() {
    ORD.inited = true;
    ORD.view = lsGet('om_oview', 'board');
    $('o-view').onclick = function (e) { var b = e.target.closest('button[data-v]'); if (!b) return; ORD.view = b.getAttribute('data-v'); lsSet('om_oview', ORD.view); ordRender(); };
    $('o-refresh').onclick = ordLoad;
    $('o-scope').onchange = $('o-days').onchange = ordLoad;
    var t = null; $('o-q').oninput = function () { clearTimeout(t); t = setTimeout(ordRender, 200); };
    $('o-sync').onclick = ordSyncFusion;
    $('o-fusion').onkeydown = function (e) { if (e.key === 'Enter' && this.value.trim()) ordOpenFusion(this.value.trim()); };
    $('o-body').onclick = function (e) { var c = e.target.closest('[data-oid]'); if (c) ordOpen(+c.getAttribute('data-oid')); };
}
function ordLoad() {
    var scope = $('o-scope').value, days = +$('o-days').value || 30;
    var w = ['instance = ' + omLit(OM.instance), 'created_date >= SYSDATE - ' + days, "status <> 'DISCARDED'"];
    if (scope === 'mine') w.push('created_by = ' + omLit(OM.user));
    if (scope === 'bu' && OM.bu) w.push('bu_name = ' + omLit(OM.bu.name));
    $('o-body').innerHTML = '<div class="muted" style="padding:20px"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading orders…</div>';
    omRead("SELECT order_id, order_no, bu_name, status, verdict, customer_number, customer_name, order_type, customer_po, TO_CHAR(order_date, 'YYYY-MM-DD') AS order_date, currency, total_net, total_tax, line_count, " +
        "fusion_order_no, fusion_status, SUBSTR(last_error, 1, 300) AS last_error, created_by, TO_CHAR(created_date, 'YYYY-MM-DD HH24:MI') AS created, TO_CHAR(updated_date, 'YYYY-MM-DD HH24:MI') AS upd " +
        'FROM wms_om_orders WHERE ' + w.join(' AND ') + ' ORDER BY order_id DESC', 1000).then(function (r) { ORD.rows = r; ordRender(); })
        .catch(function (e) { $('o-body').innerHTML = '<div class="note warn">' + esc(e) + '</div>'; });
}
function ordFiltered() {
    var q = $('o-q').value.trim().toLowerCase();
    return ORD.rows.filter(function (r) { return !q || [r.ORDER_NO, r.CUSTOMER_NAME, r.CUSTOMER_NUMBER, r.CUSTOMER_PO, r.FUSION_ORDER_NO, r.ORDER_TYPE].join(' ').toLowerCase().indexOf(q) >= 0; });
}
function ordRender() {
    Array.prototype.forEach.call(document.querySelectorAll('#o-view button'), function (b) { b.classList.toggle('on', b.getAttribute('data-v') === ORD.view); });
    var rows = ordFiltered(), cur = (OM.bu && OM.bu.currency) || '';
    var sum = function (f) { return rows.filter(f).reduce(function (s, r) { return s + (+r.TOTAL_NET || 0); }, 0); };
    var inF = function (r) { return r.STATUS === 'SUBMITTED'; };
    $('o-kpis').innerHTML = [
        ['Orders', rows.length], ['In Fusion', rows.filter(inF).length + ' · ' + cur + ' ' + fmtMoney(sum(inF), 0)],
        ['Waiting approval', rows.filter(function (r) { return r.STATUS === 'PENDING_APPROVAL'; }).length],
        ['Drafts', rows.filter(function (r) { return r.STATUS === 'DRAFT' || r.STATUS === 'REJECTED'; }).length],
        ['Failed', rows.filter(function (r) { return r.STATUS === 'FAILED'; }).length]
    ].map(function (k) { return '<div class="kpi"><b>' + k[1] + '</b><span>' + k[0] + '</span></div>'; }).join('');
    if (!rows.length) { $('o-body').innerHTML = '<div class="note">No orders yet for this filter. Orders you save or submit in the Order Pad show up here.</div>'; return; }
    if (ORD.view === 'board') {
        $('o-body').innerHTML = '<div class="board">' + ORD_COLS.map(function (c) {
            var list = rows.filter(function (r) { return c.st.indexOf(r.STATUS) >= 0; });
            return '<div class="col"><h3><i class="fa-solid ' + OM_STATUS[c.k].icon + '"></i> ' + esc(c.t) + '<b>' + list.length + '</b></h3>' + list.slice(0, 80).map(ordCard).join('') + '</div>';
        }).join('') + '</div>';
    } else {
        $('o-body').innerHTML = '<table class="tbl"><thead><tr><th>Order</th><th>Status</th><th>Customer</th><th>Type</th><th>PO</th><th>Date</th><th class="n">Lines</th><th class="n">Net</th><th>Fusion</th><th>By</th></tr></thead><tbody>' +
            rows.map(function (r) {
                return '<tr class="click" data-oid="' + r.ORDER_ID + '"><td class="mono">' + esc(r.ORDER_NO) + '</td><td>' + omStatusChip(r.STATUS) + '</td><td>' + esc(r.CUSTOMER_NAME) + ' <small class="muted">' + esc(r.CUSTOMER_NUMBER) + '</small></td><td>' + esc(r.ORDER_TYPE) +
                    '</td><td>' + esc(r.CUSTOMER_PO || '') + '</td><td>' + esc(r.ORDER_DATE) + '</td><td class="n">' + (r.LINE_COUNT || 0) + '</td><td class="n">' + fmtMoney(r.TOTAL_NET) + '</td><td class="mono">' + esc(r.FUSION_ORDER_NO || '') +
                    (r.FUSION_STATUS ? ' <small class="muted">' + esc(r.FUSION_STATUS) + '</small>' : '') + '</td><td>' + esc(r.CREATED_BY) + '</td></tr>';
            }).join('') + '</tbody></table>';
    }
}
function ordCard(r) {
    return '<div class="ocard" data-oid="' + r.ORDER_ID + '"><div class="r1"><b>' + esc(r.ORDER_NO) + '</b><span class="amt">' + fmtMoney(r.TOTAL_NET, 0) + '</span></div>' +
        '<div class="cu" title="' + esc(r.CUSTOMER_NAME) + '">' + esc(r.CUSTOMER_NAME || '—') + '</div>' +
        '<div class="r3"><span>' + esc(r.ORDER_TYPE || '') + '</span><span>' + omAgo(r.UPD) + '</span></div>' +
        (r.FUSION_ORDER_NO ? '<div class="r3"><span><i class="fa-solid fa-cloud"></i> ' + esc(r.FUSION_ORDER_NO) + '</span><span>' + esc(r.FUSION_STATUS || '') + '</span></div>' : '') +
        (r.STATUS === 'FAILED' && r.LAST_ERROR ? '<div class="er" title="' + esc(r.LAST_ERROR) + '">' + esc(r.LAST_ERROR) + '</div>' : '') + '</div>';
}

// ── drawer ─────────────────────────────────────────────────────
function ordClose() { var d = document.querySelector('.drawer'); if (d) d.remove(); }
function ordOpen(id) {
    ordClose();
    var d = document.createElement('div'); d.className = 'drawer';
    d.innerHTML = '<div class="drawer-h"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading…<span class="grow"></span><button class="btn icon" data-d="close"><i class="fa-solid fa-xmark"></i></button></div>';
    document.body.appendChild(d);
    d.onclick = function (e) { if (e.target.closest('[data-d="close"]')) ordClose(); };
    Promise.all([omLoadOrder(id), omEvents(id)]).then(function (x) { ordDrawer(d, x[0], x[1]); })
        .catch(function (e) { d.querySelector('.drawer-h').innerHTML = '<span style="color:var(--err)">' + esc(e) + '</span><span class="grow"></span><button class="btn icon" data-d="close"><i class="fa-solid fa-xmark"></i></button>'; });
}
function ordDrawer(d, o, events) {
    var h = o.header, g = omGen(), ctx = { precision: g.precision, taxRates: g.taxRates, taxOff: omUp((o.orderTypeAttrs || {}).TAX) === 'NO' }, t = omTotals(o.lines, ctx);
    var editable = ['DRAFT', 'REJECTED', 'FAILED', 'APPROVED', 'PENDING_APPROVAL'].indexOf(o.status) >= 0, inF = !!(o.fusion && o.fusion.orderNo);
    var cls = function (ty) { return /ERROR|REJECT|FAIL/.test(ty) ? 'err' : /OK|APPROVED|PRINT|MAIL|MRA_OK/.test(ty) ? 'ok' : /ASK|PENDING/.test(ty) ? 'warn' : ''; };
    d.innerHTML = '<div class="drawer-h"><h2>' + esc(h.orderNo) + '</h2>' + omStatusChip(o.status) + (inF ? '<span class="chip done"><i class="fa-solid fa-cloud"></i> ' + esc(o.fusion.orderNo) + (o.fusion.status ? ' · ' + esc(o.fusion.status) : '') + '</span>' : '') +
        '<span class="grow"></span><button class="btn icon" data-d="close"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="drawer-b">' +
        '<div class="acts">' +
        (editable ? '<button class="btn primary" data-d="edit"><i class="fa-solid fa-pen"></i> Open in pad</button>' : '') +
        '<button class="btn" data-d="copy"><i class="fa-regular fa-copy"></i> Copy</button>' +
        '<button class="btn" data-d="credit"><i class="fa-solid fa-rotate-left"></i> Credit note</button>' +
        (inF ? '<button class="btn" data-d="print"><i class="fa-solid fa-print"></i> Print</button><button class="btn" data-d="mail"><i class="fa-solid fa-envelope"></i> E-mail</button><button class="btn" data-d="mra"><i class="fa-solid fa-receipt"></i> MRA</button><button class="btn" data-d="status"><i class="fa-solid fa-cloud-arrow-down"></i> Fusion status</button>' : '') +
        (o.status === 'FUSION_DRAFT' ? '<button class="btn danger" data-d="fdel"><i class="fa-solid fa-trash"></i> Delete Fusion draft</button>' : '') +
        (editable && !inF ? '<button class="btn danger" data-d="discard"><i class="fa-solid fa-trash"></i> Discard</button>' : '') +
        '</div>' +
        (o.lastError && o.status === 'FAILED' ? '<div class="note warn" style="white-space:pre-wrap"><b>Fusion said:</b> ' + esc(o.lastError) + '</div>' : '') +
        '<div class="facts"><div><span>Customer</span>' + esc(h.customerName) + '<br><small class="muted">' + esc(h.customerNumber) + '</small></div><div><span>Order type</span>' + esc(h.orderType) + '</div><div><span>Business unit</span>' + esc(h.bu) + '</div>' +
        '<div><span>Order date</span>' + esc(h.orderDate) + '</div><div><span>Price list</span>' + esc(h.priceList || '—') + '</div><div><span>Warehouse</span>' + esc(h.warehouse) + ' / ' + esc(h.subinventory || '') + '</div>' +
        '<div><span>Customer PO</span>' + esc(h.customerPo || '—') + '</div><div><span>Sales rep</span>' + esc(h.salesrep || '—') + '</div><div><span>Created</span>' + esc(o.createdBy) + ' · ' + esc(o.created) + '</div>' +
        '<div><span>Net</span><b>' + esc(h.currency) + ' ' + fmtMoney(t.net) + '</b></div><div><span>Tax</span>' + fmtMoney(t.tax) + '</div><div><span>Discount</span>' + fmtMoney(t.disc) + '</div></div>' +
        '<div><h4>Lines</h4><table class="tbl"><thead><tr><th>#</th><th>Item</th><th>Type</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Disc</th><th class="n">Net</th></tr></thead><tbody>' +
        o.lines.map(function (l, i) { var c = omCalcLine(l, ctx); return '<tr><td>' + (i + 1) + '</td><td><span class="mono">' + esc(l.item) + '</span> <small class="muted">' + esc(l.desc || '') + '</small></td><td>' + esc(l.type) + '</td><td class="n">' + fmtQty(c.qty) + '</td><td class="n">' + fmtMoney(Math.abs(c.sell)) + '</td><td class="n">' + (c.pct ? c.pct + '%' : '') + '</td><td class="n">' + fmtMoney(c.net) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' +
        '<div><h4>Timeline</h4><ul class="timeline">' + events.map(function (e) {
            return '<li class="' + cls(e.EVENT_TYPE) + '"><b>' + esc(String(e.EVENT_TYPE).replace(/_/g, ' ').toLowerCase()) + '</b> <small>' + esc(e.CREATED_BY) + ' · ' + esc(e.AT) + '</small>' + (e.DETAIL ? '<div class="d">' + esc(e.DETAIL) + '</div>' : '') +
                (+e.DLEN ? '<button class="link" data-ev="' + e.EVENT_ID + '">data</button>' : '') + '</li>';
        }).join('') + '</ul></div></div>';
    d.onclick = function (e) {
        var ev = e.target.closest('[data-ev]');
        if (ev) { omReadClob('wms_om_events', 'data_json', 'event_id = ' + omN(ev.getAttribute('data-ev'))).then(function (txt) { omModal({ title: 'Event data', wide: true, body: '<pre class="json">' + esc(JSON.stringify(omJson(txt, txt), null, 2)) + '</pre>' }); }); return; }
        var b = e.target.closest('[data-d]'); if (!b) return;
        var a = b.getAttribute('data-d');
        if (a === 'close') ordClose();
        else if (a === 'edit') { ordClose(); padLoad(o); }
        else if (a === 'copy') { ordClose(); padLoad(ordCopy(o, false)); }
        else if (a === 'credit') { ordClose(); padLoad(ordCopy(o, true)); }
        else if (a === 'print') ordPrint(o);
        else if (a === 'mail') ordMail(o);
        else if (a === 'mra') ordMra(o);
        else if (a === 'status') ordSyncFusion([o.header.orderNo]).then(function () { ordOpen(o.id); });
        else if (a === 'discard') omConfirm('Discard order', 'Discard ' + esc(h.orderNo) + '? It stays on record as Discarded.', 'Discard', 'danger').then(function (ok) {
            if (!ok) return;
            omSetStatus(o.id, 'DISCARDED').then(function () { return omEvent(o.id, 'DISCARDED', ''); }).then(function () { ordClose(); ordLoad(); toast('Discarded.'); });
        });
        else if (a === 'fdel') omConfirm('Delete Fusion draft', 'Delete the draft order ' + esc(o.fusion.orderNo) + ' in Fusion?', 'Delete in Fusion', 'danger').then(function (ok) {
            if (!ok) return;
            omBusy('Deleting the Fusion draft…');
            host('omRest', { method: 'DELETE', resource: 'salesOrdersForOrderHub', key: o.fusion.headerId, version: omGen().restVersion }).then(function (r) {
                omBusy(null);
                if (!r || r.ok === false || r.status >= 300) throw (r && r.error) || padFusionError(r && r.body) || 'HTTP ' + (r && r.status);
                return omSetStatus(o.id, 'DISCARDED', { fusion_status: 'DELETED' }).then(function () { return omEvent(o.id, 'FUSION_DELETED', 'Draft ' + o.fusion.orderNo + ' deleted in Fusion'); });
            }).then(function () { ordClose(); ordLoad(); toast('Draft deleted in Fusion.', 'ok'); }).catch(function (e) { omBusy(null); toast(String(e), 'err'); });
        });
    };
}
/** A new pad order from an existing one. credit = credit note: RET lines at the original selling price, lot = order-line (legacy). */
function ordCopy(o, credit) {
    var h = JSON.parse(JSON.stringify(o.header));
    ['orderNo', 'approvalHash', 'customerPo'].forEach(function (k) { delete h[k]; });
    h.orderDate = today(); h.pricingDate = credit ? (o.header.pricingDate || today()) : today();
    if (credit) h.reference = (o.fusion && o.fusion.orderNo) || o.header.orderNo;
    var ctx = { precision: omGen().precision, taxRates: omGen().taxRates };
    var lines = o.lines.filter(function (l) { return !credit || l.type === 'ORD' || l.type === 'PADJ'; }).map(function (l, i) {
        var x = JSON.parse(JSON.stringify(l)); x.id = padUid(); x.status = 'DRAFT';
        if (credit) {
            var c = omCalcLine(l, ctx);
            x.type = 'RET'; x.fixedSell = Math.abs(c.sell); x.refOrder = h.reference; x.reason = '';
            if (!x.lot && h.reference) x.lot = h.reference + '-' + (i + 1);
        }
        return x;
    });
    toast(credit ? 'Credit note prepared from ' + o.header.orderNo + ' — set the return reasons and quantities.' : 'Copied ' + o.header.orderNo + '.');
    return { id: null, status: 'DRAFT', header: h, lines: lines, orderTypeAttrs: o.orderTypeAttrs || {} };
}
/** A Fusion order that was not made here (search box on the Orders tab) → copy / credit note. */
function ordOpenFusion(no) {
    omBusy('Reading ' + no + ' from Fusion…');
    omRunSource('orderLines', { ORDER_NO: no }).then(function (rows) {
        omBusy(null);
        if (!rows.length) { toast('Order ' + no + ' was not found in Fusion.', 'err'); return; }
        var lines = rows.map(function (r) {
            var g = function (f, n) { return omMapped('orderLines', r, f, n); };
            return { id: padUid(), item: omStr(g('item', ['ITEM_NUMBER', 'ITEM', 'PRODUCT_NUMBER'])), desc: omStr(g('desc', ['ITEM_DESC', 'DESCRIPTION'])), qty: Math.abs(omNum(g('qty', ['QTY', 'ORDERED_QTY']))),
                uom: omStr(g('uom', ['UOM', 'ORDERED_UOM', 'UOM_CODE'])), price: omNum(g('price', ['LIST_PRICE', 'UNIT_LIST_PRICE'])), sell: omNum(g('sell', ['SELLING_PRICE', 'UNIT_SELLING_PRICE'])),
                lot: omStr(g('lot', ['LOT_NUMBER'])), type: /RETURN/i.test(omStr(g('cat', ['CATEGORY_CODE']))) ? 'RET' : 'ORD', status: 'DRAFT' };
        }).filter(function (l) { return l.item; });
        var fno = omStr(omPick(rows[0], ['ORDER_NUMBER'])) || no;
        omModal({ title: '<i class="fa-solid fa-cloud"></i> Fusion order ' + esc(fno), wide: true,
            body: '<table class="tbl"><thead><tr><th>Item</th><th>Description</th><th>Type</th><th class="n">Qty</th><th class="n">List</th><th class="n">Selling</th></tr></thead><tbody>' + lines.map(function (l) {
                return '<tr><td class="mono">' + esc(l.item) + '</td><td>' + esc(l.desc) + '</td><td>' + l.type + '</td><td class="n">' + fmtQty(l.qty) + '</td><td class="n">' + fmtMoney(l.price) + '</td><td class="n">' + fmtMoney(l.sell) + '</td></tr>'; }).join('') + '</tbody></table>' +
                '<p class="muted" style="font-size:.8rem">Copy keeps today\'s prices from your price list. Credit note returns the lines at the selling price of this order.</p>',
            buttons: [{ label: 'Close', act: 'close' }, { label: '<i class="fa-regular fa-copy"></i> Copy to pad', act: 'copy' }, { label: '<i class="fa-solid fa-rotate-left"></i> Credit note', cls: 'primary', act: 'credit' }],
            onAction: function (a) {
                if (a !== 'copy' && a !== 'credit') return;
                var h = PAD.order ? JSON.parse(JSON.stringify(PAD.order.header)) : {};
                delete h.orderNo; delete h.approvalHash; h.orderDate = today();
                if (a === 'credit') h.reference = fno;
                var ls = lines.filter(function (l) { return a === 'copy' || l.type === 'ORD'; }).map(function (l, i) {
                    var x = Object.assign({}, l);
                    if (a === 'credit') { x.type = 'RET'; x.fixedSell = l.sell; x.refOrder = fno; if (!x.lot) x.lot = fno + '-' + (i + 1); }
                    delete x.sell; return x;
                });
                padLoad({ id: null, status: 'DRAFT', header: h, lines: ls, orderTypeAttrs: PAD.order ? PAD.order.orderTypeAttrs : {} });
                toast('Choose the customer if it differs — ' + ls.length + ' lines loaded from ' + fno + '.');
            } });
    }).catch(function (e) { omBusy(null); toast(String(e), 'err'); });
}
/** Read the Fusion status of submitted orders (orderStatus source) and store it. */
function ordSyncFusion(nos) {
    var list = Array.isArray(nos) ? nos : ORD.rows.filter(function (r) { return r.STATUS === 'SUBMITTED' || r.STATUS === 'FUSION_DRAFT' || r.STATUS === 'FAILED'; }).map(function (r) { return r.ORDER_NO; });
    if (!list.length) { toast('No orders in Fusion to check.'); return Promise.resolve(); }
    omBusy('Reading ' + list.length + ' order status(es) from Fusion…');
    return omRunSource('orderStatus', { ORDER_NOS: { raw: omIn(list) } }).then(function (rows) {
        var by = {};
        rows.forEach(function (r) { by[omStr(omMapped('orderStatus', r, 'src', ['SOURCE_ORDER_NUMBER', 'SOURCE_TRANSACTION_NUMBER']))] = r; });
        var upd = list.filter(function (no) { return by[no]; });
        return omSeq(upd, function (no) {
            var r = by[no], st = omStr(omMapped('orderStatus', r, 'status', ['STATUS_CODE', 'STATUS'])), fno = omStr(omMapped('orderStatus', r, 'order', ['ORDER_NUMBER'])), hid = omStr(omMapped('orderStatus', r, 'header', ['HEADER_ID']));
            var submitted = /^Y/i.test(omStr(omPick(r, ['SUBMITTED_FLAG']))) || (st && st !== 'DOO_DRAFT');
            return omWrite('UPDATE wms_om_orders SET fusion_status = ' + omV(st, 60) + ', fusion_order_no = ' + omV(fno, 60) + ', fusion_header_id = NVL(fusion_header_id, ' + omV(hid, 40) + ')' +
                (submitted ? ", status = 'SUBMITTED', last_error = NULL" : '') + ' WHERE order_no = ' + omLit(no) + ' AND instance = ' + omLit(OM.instance));
        }).then(function () { omBusy(null); toast(upd.length + ' of ' + list.length + ' found in Fusion.', 'ok'); if (!Array.isArray(nos)) ordLoad(); });
    }).catch(function (e) { omBusy(null); toast('Fusion status: ' + e, 'err'); });
}

// ── print / e-mail / MRA ───────────────────────────────────────
function ordLayouts(o) {
    return (OM.settings.LAYOUTS || []).filter(function (l) { return !l.bus || omCsv(l.bus.split(',')).indexOf(o.header.bu) >= 0; });
}
function ordPdf(o, layout) {
    var params = {}; params[layout.param || 'Order_Number'] = o.fusion.orderNo;
    String(layout.extra || '').split(/[;&]/).forEach(function (kv) { var p = kv.split('='); if (p[0] && p[0].trim()) params[p[0].trim()] = (p[1] || '').trim(); });
    return host('omPdf', { path: layout.path, params: params, fileName: o.header.orderNo + '_' + o.fusion.orderNo + '_' + layout.name.replace(/[^A-Za-z0-9]+/g, '_') }).then(function (r) {
        if (!r || r.ok === false || !r.base64) throw (r && r.error) || 'No PDF came back.';
        return r;
    });
}
function ordPrint(o) {
    if (!o.fusion || !o.fusion.orderNo) { toast('The order has no Fusion number yet.', 'err'); return; }
    var lays = ordLayouts(o);
    omModal({ title: '<i class="fa-solid fa-print"></i> Print ' + esc(o.fusion.orderNo), wide: true,
        body: '<div class="row-btns">' + lays.map(function (l, i) { return '<button class="btn" data-mact="lay" data-i="' + i + '">' + esc(l.name) + '</button>'; }).join('') + '</div><div id="pdf-box" class="muted">Choose a layout.</div>',
        buttons: [{ label: '<i class="fa-regular fa-folder-open"></i> Open PDF', act: 'open' }, { label: 'Close', act: 'close' }],
        onAction: function (a, box, btn) {
            if (a === 'lay') {
                var l = lays[+btn.getAttribute('data-i')];
                $('pdf-box').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Running ' + esc(l.name) + '…';
                ordPdf(o, l).then(function (r) {
                    ORD.lastPdf = r;
                    var url = URL.createObjectURL(new Blob([Uint8Array.from(atob(r.base64), function (c) { return c.charCodeAt(0); })], { type: 'application/pdf' }));
                    $('pdf-box').innerHTML = '<iframe class="pdf" src="' + url + '"></iframe>';
                    omEvent(o.id, 'PRINTED', l.name + ' · ' + (r.path || ''));
                }).catch(function (e) { $('pdf-box').innerHTML = '<div class="note warn">' + esc(e) + '</div>'; });
                return false;
            }
            if (a === 'open') { if (ORD.lastPdf && ORD.lastPdf.path) host('omOpenFile', { path: ORD.lastPdf.path }); else toast('Run a layout first.'); return false; }
        } });
}
function ordMail(o) {
    if (!o.fusion || !o.fusion.orderNo) { toast('The order has no Fusion number yet.', 'err'); return; }
    var lays = ordLayouts(o), h = o.header;
    omModal({ title: '<i class="fa-solid fa-envelope"></i> E-mail ' + esc(o.fusion.orderNo),
        body: '<div class="fgrid"><label class="wide">To<input id="ml-to" placeholder="customer@…"></label><label class="wide">Subject<input id="ml-sub" value="' + esc('Sales order ' + o.fusion.orderNo + ' — ' + (h.customerName || '')) + '"></label>' +
            '<label class="wide">Attach<select id="ml-lay">' + lays.map(function (l, i) { return '<option value="' + i + '">' + esc(l.name) + '</option>'; }).join('') + '</select></label>' +
            '<label class="wide">Message<textarea id="ml-body" rows="6">Dear customer,\n\nPlease find attached our sales order ' + esc(o.fusion.orderNo) + (h.customerPo ? ' for your PO ' + esc(h.customerPo) : '') + '.\n\nKind regards,\n' + esc(OM.user) + '</textarea></label></div>' +
            '<p class="muted" style="font-size:.78rem">Opens an Outlook draft with the PDF attached — nothing is sent until you press Send in Outlook.</p>',
        buttons: [{ label: 'Cancel', act: 'close' }, { label: '<i class="fa-solid fa-envelope-open-text"></i> Open in Outlook', cls: 'primary', act: 'go' }],
        onAction: function (a) {
            if (a !== 'go') return;
            var l = lays[+$('ml-lay').value], to = $('ml-to').value.trim(), sub = $('ml-sub').value, msg = $('ml-body').value;
            omCloseModal(); omBusy('Preparing the PDF…');
            ordPdf(o, l).then(function (r) {
                return host('fusionSqlShareOutlook', { to: to, subject: sub, html: '<div style="font-family:Segoe UI,Arial;font-size:14px;white-space:pre-wrap">' + esc(msg) + '</div>',
                    attachments: [{ name: (o.fusion.orderNo + '_' + l.name).replace(/[^A-Za-z0-9_-]+/g, '_') + '.pdf', base64: r.base64 }] });
            }).then(function (r) {
                omBusy(null);
                toast(r && r.via === 'outlook' ? 'Outlook draft opened.' : 'Outlook not available — the PDF folder was opened.', 'ok');
                omEvent(o.id, 'MAILED', (to ? 'To ' + to + ' · ' : '') + l.name);
            }).catch(function (e) { omBusy(null); toast(String(e), 'err'); });
            return false;
        } });
}
function ordMra(o) {
    if (!o.fusion || !o.fusion.orderNo) { toast('The order has no Fusion number yet.', 'err'); return; }
    omConfirm('MRA e-invoicing', 'Send Fusion order <b>' + esc(o.fusion.orderNo) + '</b> to the Mauritius Revenue Authority? The same interface as the WMS MRA button runs (it skips orders that are already done or do not need MRA).', 'Send to MRA').then(function (ok) {
        if (!ok) return;
        omBusy('MRA: starting…');
        host('omMra', { orderNumber: o.fusion.orderNo }, function (p) { omBusy('MRA: ' + (p.message || '…')); }).then(function (r) {
            omBusy(null);
            var good = r && r.ok && (r.status === 'INTERFACED' || r.status === 'ALREADY_DONE' || r.status === 'NOT_REQUIRED');
            omEvent(o.id, good ? 'MRA_OK' : 'MRA_ERROR', (r.status || '') + ' ' + (r.message || r.error || '') + (r.irn ? ' · IRN ' + r.irn : ''));
            omModal({ title: good ? '<i class="fa-solid fa-circle-check" style="color:var(--ok)"></i> MRA' : '<i class="fa-solid fa-triangle-exclamation" style="color:var(--err)"></i> MRA',
                body: '<div class="facts"><div><span>Order</span>' + esc(o.fusion.orderNo) + '</div><div><span>Result</span><b>' + esc(String(r.status || 'FAILED').replace(/_/g, ' ')) + '</b></div><div><span>IRN</span>' + esc(r.irn || '—') + '</div></div>' +
                    (r.message || r.error ? '<div class="note' + (good ? '' : ' warn') + '">' + esc(r.message || r.error) + '</div>' : '') });
        }).catch(function (e) { omBusy(null); toast(String(e), 'err'); });
    });
}

// ── approvals ──────────────────────────────────────────────────
var APR = { filter: 'PENDING', inited: false };
function apprOpen() {
    if (!APR.inited) {
        APR.inited = true;
        $('a-filter').onclick = function (e) { var b = e.target.closest('button[data-f]'); if (!b) return; APR.filter = b.getAttribute('data-f'); Array.prototype.forEach.call(document.querySelectorAll('#a-filter button'), function (x) { x.classList.toggle('on', x === b); }); apprLoad(); };
        $('a-refresh').onclick = apprLoad;
        $('a-body').onclick = apprClick;
    }
    $('a-who').textContent = omIsApprover() ? 'You can approve.' : 'You are not an approver (Setup › Rules & Fusion › Approvers).';
    apprLoad();
}
function apprBadge() {
    if (!OM.ready) return;
    omRead("SELECT COUNT(*) AS n FROM wms_om_approvals a JOIN wms_om_orders o ON o.order_id = a.order_id WHERE a.status = 'PENDING' AND o.instance = " + omLit(OM.instance), 1).then(function (r) {
        var n = +(r[0] && r[0].N) || 0; $('appr-n').hidden = !n || !omIsApprover(); $('appr-n').textContent = n;
    }).catch(function () { });
}
function apprLoad() {
    var w = APR.filter === 'PENDING' ? "a.status = 'PENDING'" : APR.filter === 'MINE' ? 'a.requested_by = ' + omLit(OM.user) : "a.status IN ('APPROVED','REJECTED')";
    $('a-body').innerHTML = '<div class="muted" style="padding:20px"><i class="fa-solid fa-circle-notch fa-spin"></i></div>';
    omRead("SELECT a.approval_id, a.order_id, a.order_no, a.reason, a.amount, a.requested_by, TO_CHAR(a.requested_date, 'YYYY-MM-DD HH24:MI') AS asked, a.status, a.decided_by, " +
        "TO_CHAR(a.decided_date, 'YYYY-MM-DD HH24:MI') AS decided, a.note, o.customer_name, o.customer_number, o.order_type, o.currency, o.bu_name, o.line_count " +
        'FROM wms_om_approvals a JOIN wms_om_orders o ON o.order_id = a.order_id WHERE ' + w + ' AND o.instance = ' + omLit(OM.instance) + ' ORDER BY a.approval_id DESC', 200).then(function (rows) {
        apprBadge();
        if (!rows.length) { $('a-body').innerHTML = '<div class="note">' + (APR.filter === 'PENDING' ? 'Nothing waiting for approval.' : 'Nothing here.') + '</div>'; return; }
        var can = omIsApprover();
        $('a-body').innerHTML = rows.map(function (r) {
            return '<div class="acard"><div><b class="mono">' + esc(r.ORDER_NO) + '</b> · ' + esc(r.CUSTOMER_NAME) + ' <small class="muted">' + esc(r.CUSTOMER_NUMBER) + '</small> · ' + esc(r.ORDER_TYPE) + ' · <b>' + esc(r.CURRENCY || '') + ' ' + fmtMoney(r.AMOUNT) + '</b> · ' + (r.LINE_COUNT || 0) + ' lines' +
                '<div class="why">' + esc(r.REASON) + '</div><div class="meta">Asked by ' + esc(r.REQUESTED_BY) + ' · ' + esc(r.ASKED) + (r.NOTE && r.STATUS === 'PENDING' ? ' · "' + esc(r.NOTE) + '"' : '') +
                (r.STATUS !== 'PENDING' ? ' · <b>' + esc(r.STATUS) + '</b> by ' + esc(r.DECIDED_BY) + ' ' + esc(r.DECIDED) + (r.NOTE ? ' — ' + esc(r.NOTE) : '') : '') + '</div></div>' +
                '<div class="btns"><button class="btn" data-a="view" data-oid="' + r.ORDER_ID + '"><i class="fa-solid fa-eye"></i></button>' +
                (r.STATUS === 'PENDING' && can && r.REQUESTED_BY !== OM.user ? '<button class="btn ok" data-a="APPROVED" data-id="' + r.APPROVAL_ID + '" data-oid="' + r.ORDER_ID + '"><i class="fa-solid fa-check"></i> Approve</button><button class="btn danger" data-a="REJECTED" data-id="' + r.APPROVAL_ID + '" data-oid="' + r.ORDER_ID + '"><i class="fa-solid fa-xmark"></i> Reject</button>' : '') +
                (r.STATUS === 'PENDING' && r.REQUESTED_BY === OM.user ? '<span class="muted" style="font-size:.74rem">Someone else must approve</span>' : '') + '</div></div>';
        }).join('');
    }).catch(function (e) { $('a-body').innerHTML = '<div class="note warn">' + esc(e) + '</div>'; });
}
function apprClick(e) {
    var b = e.target.closest('[data-a]'); if (!b) return;
    var a = b.getAttribute('data-a'), oid = +b.getAttribute('data-oid');
    if (a === 'view') { omShowTab('orders'); ordOpen(oid); return; }
    if (!omIsApprover()) { toast('You are not an approver.', 'err'); return; }
    omPrompt(a === 'APPROVED' ? 'Approve' : 'Reject', a === 'APPROVED' ? 'Note (optional)' : 'Why? (the requester sees this)', '').then(function (note) {
        if (note == null) return;
        var id = +b.getAttribute('data-id');
        omWrite('UPDATE wms_om_approvals SET status = ' + omLit(a) + ', decided_by = ' + omLit(OM.user) + ', decided_date = SYSDATE, note = ' + omV(note, 1000) + ' WHERE approval_id = ' + omN(id) + " AND status = 'PENDING'")
            .then(function () { return omRead('SELECT status, decided_by FROM wms_om_approvals WHERE approval_id = ' + omN(id), 1); })
            .then(function (r) {
                if (!r[0] || r[0].DECIDED_BY !== OM.user) throw 'Already decided by ' + (r[0] && r[0].DECIDED_BY) + '.';
                return omWrite("UPDATE wms_om_orders SET status = " + omLit(a) + ", updated_by = " + omLit(OM.user) + ", updated_date = SYSDATE WHERE order_id = " + omN(oid) + " AND status = 'PENDING_APPROVAL'");
            })
            .then(function () { return omEvent(oid, a === 'APPROVED' ? 'APPROVED' : 'REJECTED', (a === 'APPROVED' ? 'Approved' : 'Rejected') + (note ? ': ' + note : '')); })
            .then(function () { toast(a === 'APPROVED' ? 'Approved.' : 'Rejected.', 'ok'); apprLoad(); })
            .catch(function (er) { toast(String(er), 'err'); apprLoad(); });
    });
}
