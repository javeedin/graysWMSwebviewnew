/* Order Management — pure engine (no DOM, no host): runs in the page and in node for tests.
   - Item normalisation: price-list / BIP rows with different column names → one item shape
   - Line maths (same as the legacy order pad): sign by line type, discount % = customer + marketing + additional,
     tax by tax classification, consignment deposit, crates, NET = gross + tax + consignment + crates
   - Discount engine: one ranked rule list instead of 8 copied loops — every level (ALL, ITEM, PROFIT_CENTER,
     SUPPLIER, BRAND, CATEGORY, SUB_CATEGORY, GROUPCODE) is a key of the line; the best CUSTOMER rule and the best
     MARKETING rule are taken separately and added to the additional discount; item exclusions; date window; qty band
   - Live checks → verdict ready / needs approval / blocked
   - Fusion salesOrdersForOrderHub payload (consignment line N.1 and crate line N.2 expanded like the legacy interface)
   - Paste parser: Excel / barcode / free text → cart lines */

var OM_LINE_TYPES = {
    ORD: { sign: 1, label: 'Order', cat: 'ORDER' },
    RET: { sign: -1, label: 'Return', cat: 'RETURN' },
    PADJ: { sign: 1, label: '+ Adjustment', cat: 'ORDER' },
    NADJ: { sign: -1, label: '− Adjustment', cat: 'RETURN' }
};
var OM_LEVELS = ['ITEM', 'GROUPCODE', 'SUB_CATEGORY', 'CATEGORY', 'BRAND', 'SUPPLIER', 'PROFIT_CENTER', 'ALL'];
var OM_LEVEL_LABEL = { ITEM: 'Item', GROUPCODE: 'Group code', SUB_CATEGORY: 'Sub-category', CATEGORY: 'Category', BRAND: 'Brand', SUPPLIER: 'Supplier', PROFIT_CENTER: 'Profit centre', ALL: 'All items' };
var OM_DEFAULT_TAX = { 'GROT1.4': 15, 'GRTESTOUT17': 17 };
var OM_LIVE_STATUSES = ['DOO_DRAFT', 'NEW', 'NOT_STARTED', 'SCHDULED', 'SCHEDULED', 'AWAIT_SHIP', 'DRAFT', ''];

function omNum(v, d) { if (v == null || v === '') return d == null ? 0 : d; var n = +String(v).replace(/,/g, ''); return isNaN(n) ? (d == null ? 0 : d) : n; }
function omRound(x, p) { var f = Math.pow(10, p == null ? 2 : p), s = x < 0 ? -1 : 1; return s * Math.round(Math.abs(x) * f + 1e-9) / f; }
function omStr(v) { return v == null ? '' : String(v).trim(); }
function omUp(v) { return omStr(v).toUpperCase(); }

/** Pick the first present value among candidate column names (case-insensitive, _ and space ignored). */
function omPick(row, names) {
    if (!row) return undefined;
    var idx = row.__idx;
    if (!idx) {
        idx = {};
        Object.keys(row).forEach(function (k) { idx[k.toUpperCase().replace(/[\s_]/g, '')] = k; });
        try { Object.defineProperty(row, '__idx', { value: idx, enumerable: false }); } catch (e) { }
    }
    for (var i = 0; i < names.length; i++) {
        var k = idx[names[i].toUpperCase().replace(/[\s_]/g, '')];
        if (k != null && row[k] != null && row[k] !== '') return row[k];
    }
    return undefined;
}

var OM_ITEM_COLS = {
    item: ['ITEM_NUMBER', 'ITEMNUMBER', 'ITEM_CODE', 'ITEM', 'PRODUCT_NUMBER', 'SKU'],
    desc: ['ITEM_DESC', 'ITEMDESC', 'DESCRIPTION', 'ITEM_DESCRIPTION', 'DESC'],
    uom: ['UOM_CODE', 'UOM', 'PRIMARY_UOM_CODE', 'PRICING_UOM_CODE', 'UNIT'],
    price: ['LIST_PRICE', 'PRICE', 'BASE_PRICE', 'UNIT_PRICE', 'SELLING_PRICE'],
    currency: ['CURRENCY_CODE', 'CURRENCY'],
    tax: ['TAX_CODE', 'TAX_CLASSIFICATION_CODE', 'TAX_CLASSIFICATION'],
    cons: ['CONS', 'CONS_AMOUNT', 'CONSIGNMENT', 'DEPOSIT'],
    consItem: ['CONSIGNMENTITEM', 'CONSIGNMENT_ITEM', 'CONS_ITEM'],
    crtItem: ['CRT_ITEM_CODE', 'CRATE_ITEM', 'CRT_ITEM'],
    crtPrice: ['CRT', 'CRT_PRICE', 'CRATE_PRICE'],
    crtMin: ['CRT_MIN_QTY', 'CRT_MIN_', 'CRATE_MIN_QTY'],
    crtDefault: ['CRT_DEFAULT_QTY', 'CRATE_DEFAULT_QTY'],
    pc: ['PROFIT_CENTER', 'PROFITCENTER', 'PROFIT_CENTRE'],
    supplier: ['SUPPLIER', 'SUPPLIER_NAME', 'VENDOR'],
    brand: ['BRAND'],
    cat: ['CATEGORY', 'ITEM_CATEGORY'],
    subcat: ['SUB_CATEGORY', 'SUBCATEGORY'],
    group: ['GROUPCODE', 'GROUP_CODE'],
    barcode: ['BARCODE', 'GTIN', 'UPC', 'EAN', 'CROSS_REFERENCE'],
    itemType: ['ITEM_TYPE', 'USER_ITEM_TYPE', 'ITEMTYPE'],
    lot: ['LOT_NUMBER', 'LOT'],
    expiry: ['EXPIRATION_DATE', 'LOT_EXPIRY', 'EXPIRY'],
    buffer: ['BUFFERSTOCK', 'BUFFER_STOCK'],
    ediPrice: ['EDI_PRICE'],
    itemId: ['INVENTORY_ITEM_ID', 'ITEM_ID']
};
var OM_NUMERIC = { price: 1, cons: 1, crtPrice: 1, crtMin: 1, crtDefault: 1, buffer: 1, ediPrice: 1 };

/** Normalise one price-list row. `rename` = optional {canonical: 'SOURCE_COLUMN'} from the source setup. */
function omNormItem(row, rename) {
    var o = {};
    Object.keys(OM_ITEM_COLS).forEach(function (k) {
        var names = rename && rename[k] ? [rename[k]].concat(OM_ITEM_COLS[k]) : OM_ITEM_COLS[k];
        var v = omPick(row, names);
        o[k] = OM_NUMERIC[k] ? omNum(v) : omStr(v);
    });
    o.item = omStr(o.item);
    return o;
}

// ── line maths ─────────────────────────────────────────────────
/** ctx: { precision, taxRates, taxOff (order type TAX=NO) }. Returns signed display values + unsigned basis. */
function omCalcLine(l, ctx) {
    ctx = ctx || {};
    var p = ctx.precision == null ? 2 : ctx.precision;
    var lt = OM_LINE_TYPES[l.type] || OM_LINE_TYPES.ORD, sign = lt.sign;
    var qty = Math.abs(omNum(l.qty));
    var list = Math.abs(omRound(omNum(l.price), p));
    var pct = omNum(l.discCust) + omNum(l.discMkt) + omNum(l.discAdd);
    var discUnit, sell;
    if (l.fixedSell != null && l.fixedSell !== '') {            // "copy as is": keep the source order's selling price
        sell = Math.abs(omNum(l.fixedSell));
        discUnit = Math.max(0, omRound(list - sell, p));
        pct = list ? omRound(discUnit / list * 100, 5) : 0;
    } else {
        discUnit = Math.abs(omRound(list * pct / 100, p));
        sell = Math.abs(omRound(list - discUnit, p));
    }
    var rates = ctx.taxRates || OM_DEFAULT_TAX;
    var taxPct = ctx.taxOff ? 0 : omNum(rates[omStr(l.tax)], 0);
    var discTotal = Math.abs(omRound(discUnit * qty, p));
    var gross = Math.abs(omRound(qty * sell, p));
    var tax = Math.abs(omRound(qty * sell * taxPct / 100, p));
    var consTotal = omRound(qty * Math.abs(omNum(l.cons)), p);
    var crtQty = 0, crtTotal = 0, crtPrice = Math.abs(omNum(l.crtPrice)), crtMin = omNum(l.crtMin);
    if (crtPrice > 0 && crtMin > 0 && !l.noCrates) {
        var n = Math.floor(qty / crtMin + 1e-9);
        if (n >= 1) { crtQty = n * omNum(l.crtDefault); crtTotal = omRound(n * crtPrice * omNum(l.crtDefault), p); }
    }
    if (l.noCons) consTotal = 0;
    var net = Math.abs(omRound(gross + tax + consTotal + crtTotal, p));
    return {
        sign: sign, qty: qty * sign, list: list * sign, pct: omRound(pct, 5), discUnit: discUnit, sell: sell * sign,
        discTotal: discTotal * sign, gross: gross * sign, taxPct: taxPct, tax: tax * sign,
        consTotal: consTotal * sign, crtQty: crtQty * sign, crtTotal: crtTotal * sign, net: net * sign
    };
}

function omTotals(lines, ctx) {
    var t = { lines: 0, qty: 0, list: 0, disc: 0, gross: 0, tax: 0, cons: 0, crates: 0, net: 0, maxPct: 0, ordered: 0, returned: 0 };
    var p = (ctx && ctx.precision != null) ? ctx.precision : 2;
    (lines || []).forEach(function (l) {
        if (!l.item) return;
        var c = omCalcLine(l, ctx);
        t.lines++; t.qty += c.qty; t.list += c.list * Math.abs(c.qty) * c.sign; t.disc += c.discTotal; t.gross += c.gross; t.tax += c.tax;
        t.cons += c.consTotal; t.crates += c.crtTotal; t.net += c.net; t.maxPct = Math.max(t.maxPct, c.pct);
        if (c.sign > 0) t.ordered += c.net; else t.returned += c.net;
    });
    ['list', 'disc', 'gross', 'tax', 'cons', 'crates', 'net', 'ordered', 'returned'].forEach(function (k) { t[k] = omRound(t[k], p); });
    return t;
}

// ── discount engine ────────────────────────────────────────────
function omParseDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    var s = String(v).trim(), m;
    if ((m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s))) return new Date(+m[1], +m[2] - 1, +m[3]);
    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s))) return new Date(+m[3], +m[2] - 1, +m[1]);   // d/m/yyyy (legacy)
    if ((m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/.exec(s))) {
        var mo = 'JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC'.indexOf(m[2].toUpperCase()) / 3;
        if (mo >= 0) return new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], mo, +m[1]);
    }
    var d = new Date(s); return isNaN(d) ? null : d;
}
function omDay(d) { d = omParseDate(d); return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() : null; }

/** Normalise a discount rule row (APEX WMS_OM_DISCOUNTS, the legacy FUSION_DISCOUNTS view or an import). */
function omNormRule(r) {
    var ctx = omUp(omPick(r, ['CTX', 'QUALIFIER_CONTEXT', 'CONTEXT'])) || 'CUSTOMER';
    var excl = omUp(omPick(r, ['EXCL', 'EXCLUDER_FLAG', 'EXCLUDE']));
    return {
        id: omStr(omPick(r, ['RULE_ID', 'ID'])),
        ctx: ctx === 'MARKETING' || ctx === 'MKT' ? 'MARKETING' : 'CUSTOMER',
        level: omUp(omPick(r, ['LEVEL', 'DISC_LEVEL', 'APPLY_LEVEL'])),
        target: omStr(omPick(r, ['TARGET', 'ITEM_CODE', 'APPLY_TO', 'VALUE'])) || 'ALL',
        pct: omNum(omPick(r, ['PCT', 'DISCOUNT_PER', 'DISCOUNT_PCT', 'PERCENT'])),
        from: omPick(r, ['FROM', 'START_DATE_ACTIVE', 'START_DATE', 'VALID_FROM']) || null,
        to: omPick(r, ['TO', 'END_DATE_ACTIVE', 'END_DATE', 'VALID_TO']) || null,
        excl: excl === 'Y' || excl === 'YES',
        ref: omStr(omPick(r, ['REF', 'DISC_REF', 'EBS_DISCOUNT_REF', 'DISC_REFERENCE', 'REFERENCE'])),
        custNo: omStr(omPick(r, ['CUST_NO', 'CUSTOMER_NUMBER'])),
        custCat: omStr(omPick(r, ['CUST_CAT', 'CUSTOMER_CAT', 'CUSTOMER_CATEGORY'])),
        minQty: omNum(omPick(r, ['MIN_QTY', 'FROM_QTY']), 0),
        maxQty: omNum(omPick(r, ['MAX_QTY', 'TO_QTY']), 0),
        active: omUp(omPick(r, ['ACTIVE', 'ENABLED'])) !== 'N'
    };
}

/** Rules that belong to this customer: its number, else its category (legacy UNION), plus rules with neither. */
function omRulesForCustomer(rules, cust) {
    var no = omStr(cust && cust.number), cat = omUp(cust && cust.category);
    return (rules || []).filter(function (r) {
        if (!r.active) return false;
        if (r.custNo) return r.custNo === no;
        if (r.custCat) return omUp(r.custCat) === cat && !!cat;
        return true;
    });
}

function omLineKeys(l) {
    var a = l.attrs || l;
    return { ITEM: omStr(l.item), GROUPCODE: omStr(a.group), SUB_CATEGORY: omStr(a.subcat), CATEGORY: omStr(a.cat), BRAND: omStr(a.brand), SUPPLIER: omStr(a.supplier), PROFIT_CENTER: omStr(a.pc), ALL: 'ALL' };
}

/** Which level does this rule hit for this line? '' when it does not apply. */
function omRuleHit(rule, keys) {
    var t = omUp(rule.target);
    if (rule.level) return keys[rule.level] && omUp(keys[rule.level]) === t ? rule.level : '';
    if (t === 'ALL') return 'ALL';
    for (var i = 0; i < OM_LEVELS.length; i++) { var lv = OM_LEVELS[i]; if (lv !== 'ALL' && keys[lv] && omUp(keys[lv]) === t) return lv; }
    return '';
}

/** Best customer and marketing discount for one line. Returns { cust, mkt, ref, why[], excluded, skipped }. */
function omResolveDiscount(l, rules, orderDate) {
    var res = { cust: 0, mkt: 0, ref: '', why: [], excluded: false, skipped: '' };
    var it = omUp(l.itemType);
    if (it === 'EMPTY' || it === 'EMPTIES' || it === 'ADJUSTMENT') { res.skipped = 'No discounts on ' + it.toLowerCase() + ' items'; return res; }
    var keys = omLineKeys(l), day = omDay(orderDate || new Date()), qty = Math.abs(omNum(l.qty));
    var best = { CUSTOMER: null, MARKETING: null };
    (rules || []).forEach(function (r) {
        var lv = omRuleHit(r, keys); if (!lv) return;
        var f = omDay(r.from), t = omDay(r.to);
        if (f != null && day < f) return;
        if (t != null && day > t) return;
        if (r.minQty && qty < r.minQty) return;
        if (r.maxQty && qty > r.maxQty) return;
        if (r.excl && lv === 'ITEM') { res.excluded = true; res.why.push({ ctx: r.ctx, level: lv, target: r.target, pct: 0, ref: r.ref, excl: true }); return; }
        var b = best[r.ctx];
        // highest % wins; on a tie the more specific level (earlier in OM_LEVELS) wins
        if (!b || r.pct > b.r.pct || (r.pct === b.r.pct && OM_LEVELS.indexOf(lv) < OM_LEVELS.indexOf(b.lv))) best[r.ctx] = { r: r, lv: lv };
    });
    if (res.excluded) { res.skipped = 'Item is excluded from discounts'; return res; }
    ['CUSTOMER', 'MARKETING'].forEach(function (c) {
        var b = best[c]; if (!b) return;
        if (c === 'CUSTOMER') res.cust = b.r.pct; else res.mkt = b.r.pct;
        res.why.push({ ctx: c, level: b.lv, target: b.r.target, pct: b.r.pct, ref: b.r.ref, to: b.r.to });
    });
    res.ref = res.why.filter(function (w) { return w.ref; }).map(function (w) { return w.ref; }).join(' + ');
    return res;
}

/** Apply discounts to every open line (keeps manual additional %, manual marketing % wins when higher — legacy). */
function omApplyDiscounts(lines, rules, orderDate, opts) {
    opts = opts || {};
    (lines || []).forEach(function (l) {
        if (!l.item || l.fixedSell != null && l.fixedSell !== '') return;
        if (OM_LIVE_STATUSES.indexOf(omUp(l.status)) < 0) return;
        if (opts.off) { l.discCust = 0; if (!l.mktManual) l.discMkt = 0; l.discRef = ''; l.discWhy = []; return; }
        var d = omResolveDiscount(l, rules, orderDate);
        l.discCust = d.cust;
        l.discMkt = l.mktManual ? Math.max(omNum(l.mktManualPct), d.mkt) : d.mkt;
        l.discRef = d.ref; l.discWhy = d.why; l.discNote = d.skipped;
    });
    return lines;
}

function omExplainDiscount(l) {
    var parts = [];
    (l.discWhy || []).forEach(function (w) {
        parts.push((w.excl ? 'Excluded by ' : (w.ctx === 'MARKETING' ? 'Marketing ' : 'Customer ')) + (OM_LEVEL_LABEL[w.level] || w.level) +
            (w.level === 'ALL' ? '' : ' "' + w.target + '"') + (w.excl ? '' : ' ' + w.pct + '%') + (w.ref ? ' · ' + w.ref : ''));
    });
    if (l.mktManual) parts.push('Manual marketing ' + omNum(l.mktManualPct) + '%');
    if (omNum(l.discAdd)) parts.push('Additional ' + omNum(l.discAdd) + '%');
    if (l.discNote) parts.push(l.discNote);
    return parts.join('\n') || 'No discount rule applies';
}

// ── checks ─────────────────────────────────────────────────────
/** order: { header, lines }, ot: order type attrs, live: async results ({credit, stock, period, dupPo, adjRef}), cfg: setup. */
function omChecks(order, ot, live, cfg) {
    var h = order.header || {}, lines = (order.lines || []).filter(function (l) { return l.item; });
    ot = ot || {}; live = live || {}; cfg = cfg || {};
    var out = [];
    function add(id, level, msg, lineIds) { out.push({ id: id, level: level, msg: msg, lines: lineIds || [] }); }
    var yes = function (v) { return /^(Y|YES|TRUE|1)$/i.test(omStr(v)); };
    if (!h.customerNumber) add('customer', 'block', 'Choose a customer.');
    if (!h.orderType) add('orderType', 'block', 'Choose an order type.');
    if (!h.warehouse) add('warehouse', 'block', 'Choose a warehouse.');
    if (!lines.length) add('lines', 'block', 'Add at least one line.');
    if (!h.priceList && lines.length) add('priceList', 'warn', 'No price list chosen — prices are as entered.');
    if (yes(ot.REQUIRE_DO) && !h.deliveryOfficer) add('do', 'block', ot.NAME + ' needs a delivery officer.');
    if (yes(ot.REQUIRE_PO) && !h.customerPo) add('po', 'block', ot.NAME + ' needs a customer PO.');
    var ctx = { precision: cfg.precision, taxRates: cfg.taxRates, taxOff: omUp(ot.TAX) === 'NO' };
    var zeroQty = [], zeroPrice = [], zeroTax = [], bigDisc = [], noReason = [], seen = {}, dups = [];
    var maxPct = omNum(cfg.maxDiscountPct, 50);
    lines.forEach(function (l) {
        var c = omCalcLine(l, ctx);
        if (!omNum(l.qty)) zeroQty.push(l.id);
        if (!omNum(l.price) && omUp(l.itemType) !== 'ADJUSTMENT') zeroPrice.push(l.id);
        if (!ctx.taxOff && c.taxPct === 0 && omNum(l.price)) zeroTax.push(l.id);
        if (c.pct > maxPct) bigDisc.push(l.id);
        if ((l.type === 'RET' || l.type === 'NADJ') && !l.reason && yes(cfg.returnReasonRequired == null ? 'Y' : cfg.returnReasonRequired)) noReason.push(l.id);
        var k = l.item + '|' + l.type + '|' + (l.lot || '');
        if (seen[k]) dups.push(l.id); seen[k] = 1;
    });
    if (zeroQty.length) add('qty', 'block', zeroQty.length + ' line(s) have no quantity.', zeroQty);
    if (zeroPrice.length) add('price', 'warn', zeroPrice.length + ' line(s) have no price.', zeroPrice);
    if (zeroTax.length) add('tax', 'warn', zeroTax.length + ' line(s) are not taxed (tax code not 15% / 17%).', zeroTax);
    if (bigDisc.length) add('discount', 'approve', bigDisc.length + ' line(s) have more than ' + maxPct + '% discount.', bigDisc);
    if (noReason.length) add('reason', 'block', noReason.length + ' return line(s) need a return reason.', noReason);
    if (dups.length) add('dup', 'warn', dups.length + ' item(s) appear twice — merge them?', dups);
    var tot = omTotals(lines, ctx);
    if (live.period && live.period.open === false) add('period', 'block', 'The period ' + (live.period.name || '') + ' is not open for Order Management.');
    if (live.dupPo && live.dupPo.length) add('dupPo', cfg.dupPoBlocks ? 'block' : 'warn', 'Customer PO ' + h.customerPo + ' is already on order ' + live.dupPo.join(', ') + '.');
    if (yes(ot.CREDITCHECK) && tot.net > 0) {
        var cr = live.credit;
        if (!cr) add('credit', 'pending', 'Credit check not run yet.');
        else if (cr.error) add('credit', 'warn', 'Credit check failed: ' + cr.error);
        else {
            var avail = omNum(cr.limit) - omNum(cr.balance);
            if (cr.onHold) add('credit', 'approve', 'Customer has invoices on credit hold' + (cr.holdNote ? ' (' + cr.holdNote + ')' : '') + '.');
            else if (omNum(cr.limit) > 0 && tot.net > avail) add('credit', 'approve', 'Over credit limit: available ' + avail.toFixed(2) + ', this order ' + tot.net.toFixed(2) + '.');
            else if (!omNum(cr.limit) && cfg.cashCustomersNoCredit !== false && h.paymentMethod === 'CREDIT') add('credit', 'approve', 'Customer has no credit limit.');
            else add('credit', 'ok', 'Credit OK — available ' + avail.toFixed(2) + '.');
        }
    }
    if (live.stock) {
        var short = [];
        lines.forEach(function (l) {
            if (l.type !== 'ORD' && l.type !== 'PADJ') return;
            var have = live.stock[l.item]; if (have == null) return;
            var need = lines.filter(function (x) { return x.item === l.item && (x.type === 'ORD' || x.type === 'PADJ'); }).reduce(function (s, x) { return s + Math.abs(omNum(x.qty)); }, 0);
            if (need > have - omNum(l.buffer)) short.push(l.id);
        });
        if (short.length) add('stock', yes(ot.CHECKVIPSTOCK) || yes(ot.STOCKSTATUS) ? 'block' : 'warn', short.length + ' line(s) are short of stock' + (yes(ot.BACKORDERSTATUS) ? ' — they can go on backorder.' : '.'), short);
    }
    if (live.adjRef === false && (h.reference || '').trim()) add('adjRef', 'block', 'Reference order ' + h.reference + ' was not found.');
    if ((lines.some(function (l) { return l.type === 'PADJ' || l.type === 'NADJ'; })) && !omStr(h.reference)) add('adjRef', 'warn', 'Adjustments should quote the original order in Reference.');
    var verdict = out.some(function (c) { return c.level === 'block'; }) ? 'blocked' : out.some(function (c) { return c.level === 'approve'; }) ? 'approval' : 'ready';
    return { checks: out, verdict: verdict, totals: tot };
}

// ── Fusion payload ─────────────────────────────────────────────
/** Expand the cart like the legacy interface: line N, consignment N.1 (deposit item, tax GROTCONS), crates N.2. */
function omExpandLines(lines, ctx) {
    var out = [], n = 0;
    (lines || []).forEach(function (l) {
        if (!l.item || !omNum(l.qty)) return;
        n++;
        var c = omCalcLine(l, ctx), childType = l.type === 'RET' ? 'NADJ' : l.type;
        out.push({ no: String(n), src: l, item: l.item, qty: Math.abs(c.qty), uom: l.uom, type: l.type, list: Math.abs(c.list), sell: Math.abs(c.sell),
            pct: c.pct, tax: l.tax, taxAmt: Math.abs(c.tax), net: Math.abs(c.net), lot: l.lot, reason: l.reason, comment: l.comment, refOrder: l.refOrder, discRef: l.discRef });
        if (omNum(l.cons) && l.consItem && !l.noCons)
            out.push({ no: n + '.1', src: l, item: l.consItem, qty: Math.abs(c.qty), uom: l.uom, type: childType, list: Math.abs(omNum(l.cons)), sell: Math.abs(omNum(l.cons)),
                pct: 0, tax: 'GROTCONS', taxAmt: 0, net: Math.abs(c.consTotal), comment: (l.desc || l.item) + '-CONSIGNMENT', reason: l.reason, parent: String(n) });
        if (c.crtQty && l.crtItem)
            out.push({ no: n + '.2', src: l, item: l.crtItem, qty: Math.abs(c.crtQty), uom: l.crtUom || 'Ea', type: childType, list: Math.abs(omNum(l.crtPrice)), sell: Math.abs(omNum(l.crtPrice)),
                pct: 0, tax: 'GROTCONS', taxAmt: 0, net: Math.abs(c.crtTotal), comment: (l.desc || l.item) + '-CRATES', reason: l.reason, parent: String(n) });
    });
    return out;
}

function omFill(tpl, vars) {
    if (tpl == null) return tpl;
    if (typeof tpl === 'string') {
        var whole = /^\{\{(\w+)\}\}$/.exec(tpl);
        if (whole) return vars[whole[1]] == null ? null : vars[whole[1]];
        return tpl.replace(/\{\{(\w+)\}\}/g, function (_, k) { return vars[k] == null ? '' : vars[k]; });
    }
    if (Array.isArray(tpl)) return tpl.map(function (x) { return omFill(x, vars); });
    if (typeof tpl === 'object') { var o = {}; Object.keys(tpl).forEach(function (k) { o[k] = omFill(tpl[k], vars); }); return o; }
    return tpl;
}
function omClean(o) { Object.keys(o).forEach(function (k) { if (o[k] === null || o[k] === undefined || o[k] === '') delete o[k]; }); return o; }

/** salesOrdersForOrderHub body. setup: { sourceSystem, buId, lineTypes{ORD:{cat,code}}, priceMode FROZEN|MPA|FUSION, headerExtras, lineExtras, orgId, precision, taxRates } */
function omFusionPayload(order, setup, opts) {
    setup = setup || {}; opts = opts || {};
    var h = order.header || {}, ot = order.orderTypeAttrs || {};
    var ctx = { precision: setup.precision, taxRates: setup.taxRates, taxOff: omUp(ot.TAX) === 'NO' };
    var mode = setup.priceMode || 'FROZEN';
    var lt = setup.lineTypes || {};
    var head = omClean({
        SourceTransactionNumber: h.orderNo,
        SourceTransactionSystem: setup.sourceSystem || 'OPS',
        SourceTransactionId: h.orderNo,
        BusinessUnitId: setup.buId ? +setup.buId : null,
        RequestingBusinessUnitId: setup.buId ? +setup.buId : null,
        BuyingPartyId: h.partyId ? +h.partyId : null,
        BuyingPartyNumber: h.partyId ? null : h.partyNumber,
        TransactionTypeCode: h.orderTypeCode || h.orderType,
        TransactionalCurrencyCode: h.currency || setup.currency || 'MUR',
        TransactionOn: (h.orderDate || new Date().toISOString().slice(0, 10)) + 'T00:00:00+00:00',
        RequestedShipDate: h.shipDate ? h.shipDate + 'T00:00:00+00:00' : null,
        CustomerPONumber: h.customerPo,
        SalespersonId: h.salesrepId ? +h.salesrepId : null,
        PaymentTermsCode: h.paymentTerms,
        Comments: h.comments,
        FreezePriceFlag: mode !== 'FUSION',
        FreezeShippingChargeFlag: true,
        FreezeTaxFlag: false,
        SubmittedFlag: !!opts.submit
    });
    head.billToCustomer = [omClean({ CustomerAccountId: h.custAccountId ? +h.custAccountId : null, SiteUseId: h.billSiteUseId ? +h.billSiteUseId : null })];
    head.shipToCustomer = [omClean({ PartyId: h.partyId ? +h.partyId : null, SiteId: h.shipPartySiteId ? +h.shipPartySiteId : null })];
    var vars = Object.assign({}, h, { user: opts.user || '', bu: setup.buName || '' });
    if (setup.headerExtras) Object.assign(head, omFill(setup.headerExtras, vars));
    head.lines = omExpandLines(order.lines, ctx).map(function (x, i) {
        var t = lt[x.type] || {};
        var ln = omClean({
            SourceTransactionLineId: x.no, SourceTransactionLineNumber: x.no, SourceScheduleNumber: '1', SourceTransactionScheduleId: x.no,
            ProductNumber: x.item, OrderedQuantity: x.qty, OrderedUOMCode: x.uom,
            TransactionCategoryCode: t.cat || OM_LINE_TYPES[x.type].cat,
            TransactionLineTypeCode: t.code || null,
            RequestedFulfillmentOrganizationId: setup.orgId ? +setup.orgId : null,
            SubinventoryCode: h.subinventory,
            TaxClassificationCode: x.tax,
            ReturnReasonCode: OM_LINE_TYPES[x.type].sign < 0 ? (x.reason || setup.defaultReturnReason || null) : null,
            Comments: x.comment,
            UnitListPrice: mode === 'FROZEN' ? x.list : null,
            UnitSellingPrice: mode === 'FROZEN' ? x.sell : null
        });
        if (mode === 'MPA' && x.pct > 0)
            ln.manualPriceAdjustments = [{ SourceManualPriceAdjustmentId: x.no + '-D', AdjustmentElementBasis: 'QP_LIST_PRICE', AdjustmentTypeCode: 'DISCOUNT_PERCENT',
                AdjustmentAmount: x.pct, ChargeDefinitionCode: 'QP_SALE_PRICE', ChargeRollupFlag: false, SequenceNumber: 1, ReasonCode: setup.mpaReason || 'OTHER', Comments: x.discRef || null }];
        if (x.lot) ln.lotSerials = [{ LotNumber: x.lot, ItemSerialNumberFrom: null }].map(omClean);
        if (setup.lineExtras) Object.assign(ln, omFill(setup.lineExtras, Object.assign({}, vars, { lineNo: x.no, item: x.item, type: x.type, discRef: x.discRef || '', refOrder: x.refOrder || '' })));
        return ln;
    });
    return head;
}

// ── paste parser ───────────────────────────────────────────────
/** text → { lines:[{item, qty, type, src}], unmatched:[...] }. find(code) → item or null (barcode / item number). */
function omParsePaste(text, find, defaultType) {
    var res = { lines: [], unmatched: [] };
    var rows = String(text || '').replace(/\r/g, '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!rows.length) return res;
    var sep = rows[0].indexOf('\t') >= 0 ? '\t' : (rows[0].split(';').length > 2 ? ';' : (rows[0].split(',').length > 2 ? ',' : null));
    var hdr = null;
    if (sep) {
        var first = rows[0].split(sep).map(function (s) { return s.trim().toUpperCase(); });
        var ix = function (re) { for (var i = 0; i < first.length; i++) if (re.test(first[i])) return i; return -1; };
        var ci = ix(/^(ITEM|ITEM.?(NO|NUMBER|CODE)|CODE|SKU|BARCODE|EAN|PRODUCT)/), qi = ix(/^(QTY|QUANTITY|QTE|ORDER.?QTY)/), ti = ix(/^(TYPE|LINE.?TYPE|MODE)$/), pi = ix(/^(PRICE|UNIT.?PRICE|EDI.?PRICE)$/);
        if (ci >= 0 && qi >= 0) { hdr = { ci: ci, qi: qi, ti: ti, pi: pi }; rows = rows.slice(1); }
    }
    var mode = (defaultType || 'ORD').toUpperCase();
    rows.forEach(function (raw) {
        var u = raw.toUpperCase();
        if (/^(ORD|RET|PADJ|NADJ|ADJ\+?|ADJ-)$/.test(u)) { mode = u === 'ADJ' || u === 'ADJ+' ? 'PADJ' : u === 'ADJ-' ? 'NADJ' : u; return; }   // barcode-scanner mode switch
        var code = null, qty = null, type = mode, price = null;
        if (hdr) {
            var c = raw.split(sep).map(function (s) { return s.trim(); });
            code = c[hdr.ci]; qty = omNum(c[hdr.qi], null); if (hdr.ti >= 0 && OM_LINE_TYPES[omUp(c[hdr.ti])]) type = omUp(c[hdr.ti]); if (hdr.pi >= 0) price = omNum(c[hdr.pi], null);
        } else {
            var toks = raw.split(sep ? new RegExp('\\' + sep + '|\\s+') : /\s+/).filter(Boolean);
            var tt = toks.filter(function (t) { return OM_LINE_TYPES[omUp(t)]; }); if (tt.length) type = omUp(tt[0]);
            for (var i = 0; i < toks.length && !code; i++) {
                var cand = toks[i].replace(/[,;]$/, '');
                if (find(cand)) { code = cand; toks.splice(i, 1); }
            }
            var nums = toks.map(function (t) { return /^[x×*]?\d+(\.\d+)?[x×]?$/i.test(t) ? omNum(t.replace(/[x×*]/gi, ''), null) : null; }).filter(function (n) { return n != null; });
            if (code) qty = nums.length ? nums[0] : 1;
            if (!code && /^\d{8,14}$/.test(raw)) { code = raw; qty = 1; }   // a bare barcode = 1 each
        }
        var it = code ? find(code) : null;
        if (!it) { res.unmatched.push(raw); return; }
        var prev = !hdr && res.lines.length && res.lines[res.lines.length - 1];
        if (prev && prev.item === it.item && prev.type === type && /^\d{8,14}$/.test(raw)) { prev.qty += qty || 1; return; }   // repeated scans add up
        res.lines.push({ item: it.item, qty: qty == null ? 1 : qty, type: type, ediPrice: price, src: raw });
    });
    return res;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OM_LINE_TYPES: OM_LINE_TYPES, OM_LEVELS: OM_LEVELS, omNum: omNum, omRound: omRound, omNormItem: omNormItem, omCalcLine: omCalcLine, omTotals: omTotals,
        omNormRule: omNormRule, omRulesForCustomer: omRulesForCustomer, omResolveDiscount: omResolveDiscount, omApplyDiscounts: omApplyDiscounts, omExplainDiscount: omExplainDiscount,
        omChecks: omChecks, omExpandLines: omExpandLines, omFusionPayload: omFusionPayload, omParsePaste: omParsePaste, omParseDate: omParseDate, omFill: omFill, omPick: omPick };
}
