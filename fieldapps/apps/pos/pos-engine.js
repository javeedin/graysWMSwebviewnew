/* Field Apps · POS engine (pure — runs in node and in the phone's WebView).
 * Lines are priced by the Order Pad's engine (om/om-engine.js: omCalcLine / omTotals / discount rules),
 * so a till, the Order Pad and Fusion agree on every amount. Nothing here touches the DOM or the network. */
(function (root) {
    'use strict';
    var OM = (typeof module !== 'undefined' && module.exports) ? require('../../../om/om-engine.js') : {
        omNum: root.omNum, omRound: root.omRound, omCalcLine: root.omCalcLine, omTotals: root.omTotals, omNormItem: root.omNormItem,
        omNormRule: root.omNormRule, omRulesForCustomer: root.omRulesForCustomer, omApplyDiscounts: root.omApplyDiscounts, omExplainDiscount: root.omExplainDiscount
    };
    var num = OM.omNum, rnd = OM.omRound;
    var P = {};
    P.VERSION = '1.0';
    P.TENDERS = [
        { code: 'CASH', label: 'Cash', change: true, drawer: true },
        { code: 'CARD', label: 'Card', change: false, ref: 'Last 4 digits / slip' },
        { code: 'MOBILE', label: 'Mobile money', change: false, ref: 'Transaction id' },
        { code: 'CREDIT', label: 'On account', change: false, customer: true }
    ];
    P.DEFAULTS = {
        currency: 'Rs', precision: 2, cashRounding: 0, maxDiscountPct: 100, allowPriceEdit: false, allowReturns: true,
        receiptCols: 32, taxRates: { 'GROT1.4': 15, 'GRTESTOUT17': 17 }, taxOff: false, numberPrefix: 'POS', orderType: 'ORD',
        shop: { name: 'Gray\'s', address: '', phone: '', brn: '', vat: '', footer: 'Thank you' }
    };

    function str(v) { return v == null ? '' : String(v).trim(); }
    function up(v) { return str(v).toUpperCase(); }
    function merge(a, b) { var o = {}; Object.keys(a || {}).forEach(function (k) { o[k] = a[k]; }); Object.keys(b || {}).forEach(function (k) { if (b[k] !== undefined) o[k] = b[k]; }); return o; }
    P.settings = function (s) { var o = merge(P.DEFAULTS, s); o.shop = merge(P.DEFAULTS.shop, s && s.shop); o.taxRates = (s && s.taxRates) || P.DEFAULTS.taxRates; return o; };

    var seq = 0;
    P.newId = function (prefix) {
        seq = (seq + 1) % 1000;
        var t = Date.now().toString(36), r = Math.random().toString(36).slice(2, 8);
        return (prefix || 'id') + '_' + t + '_' + ('00' + seq).slice(-3) + r;
    };
    P.nowIso = function (d) { d = d || new Date(); function z(n) { return (n < 10 ? '0' : '') + n; } return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + 'T' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds()); };

    // ── catalogue ────────────────────────────────────────────────
    /** One catalogue row (any column names the price list uses) → the item the till keeps. */
    P.normItem = function (row) {
        var n = OM.omNormItem(row);
        var o = { item: n.item, desc: n.desc, uom: n.uom, price: num(n.price), tax: n.tax, cons: num(n.cons), consItem: n.consItem, crtItem: n.crtItem,
            crtPrice: num(n.crtPrice), crtMin: num(n.crtMin), crtDefault: num(n.crtDefault), barcode: n.barcode, itemType: n.itemType,
            attrs: { group: n.group, subcat: n.subcat, cat: n.cat, brand: n.brand, supplier: n.supplier, pc: n.pc } };
        o.active = up(row.ACTIVE || row.active || 'Y') !== 'N';
        o.image = str(row.IMAGE_URL || row.image || row.IMAGE);
        o.qoh = row.QOH != null ? num(row.QOH) : (row.qoh != null ? num(row.qoh) : null);
        return o;
    };
    /** Ranked search: exact code / barcode first, then every word in code or description, then prefix. */
    P.search = function (items, q, max) {
        q = str(q); max = max || 60;
        if (!q) return items.slice(0, max);
        var Q = q.toUpperCase(), words = Q.split(/\s+/).filter(Boolean), out = [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i], code = up(it.item), bc = up(it.barcode), d = up(it.desc), s = 0;
            if (code === Q || bc === Q) s = 100;
            else if (code.indexOf(Q) === 0 || bc.indexOf(Q) === 0) s = 60;
            else {
                var all = true;
                for (var w = 0; w < words.length; w++) { if (code.indexOf(words[w]) < 0 && d.indexOf(words[w]) < 0 && bc.indexOf(words[w]) < 0) { all = false; break; } }
                if (all) s = d.indexOf(words[0]) === 0 ? 40 : 20;
            }
            if (s) out.push({ s: s, it: it });
        }
        out.sort(function (a, b) { return b.s - a.s || (a.it.desc < b.it.desc ? -1 : 1); });
        return out.slice(0, max).map(function (x) { return x.it; });
    };
    P.byBarcode = function (items, code) {
        code = up(code); if (!code) return null;
        for (var i = 0; i < items.length; i++) if (up(items[i].barcode) === code || up(items[i].item) === code) return items[i];
        var m = /^(\d+)\*(.+)$/.exec(code);     // "12*CODE" = qty × item (scanner words of the Order Pad)
        if (m) { var it = P.byBarcode(items, m[2]); return it ? { item: it, qty: +m[1] } : null; }
        return null;
    };

    // ── sale ─────────────────────────────────────────────────────
    P.newSale = function (o) {
        o = o || {};
        return { saleId: P.newId('s'), number: '', kind: 'SALE', status: 'OPEN', pod: o.pod || '', shiftId: o.shiftId || '', device: o.device || '', user: o.user || '',
            customer: o.customer || null, openedAt: P.nowIso(o.now), doneAt: '', lines: [], payments: [], totals: null, note: '', gps: null, returnOf: o.returnOf || null, mra: { status: 'PENDING' } };
    };
    function lineOf(sale, id) { for (var i = 0; i < sale.lines.length; i++) if (sale.lines[i].id === id) return sale.lines[i]; return null; }
    P.line = lineOf;
    /** Adds qty of an item (merges with an open line of the same item and type unless opts.separate). */
    P.addItem = function (sale, it, qty, opts) {
        opts = opts || {};
        if (sale.status !== 'OPEN' && sale.status !== 'PARKED') throw new Error('This sale is ' + sale.status.toLowerCase() + ' — start a new one');
        qty = num(qty, 1); if (qty <= 0) qty = 1;
        var type = opts.type || 'ORD';
        if (!opts.separate) for (var i = 0; i < sale.lines.length; i++) {
            var l = sale.lines[i];
            if (l.item === it.item && l.type === type && !l.fixedSell && !l.returnOf) { l.qty = rnd(l.qty + qty, 3); return l; }
        }
        var line = { id: P.newId('l'), item: it.item, desc: it.desc, uom: it.uom, barcode: it.barcode, qty: qty, price: num(it.price), listPrice: num(it.price),
            discCust: 0, discMkt: 0, discAdd: 0, tax: it.tax, cons: num(it.cons), consItem: it.consItem, crtItem: it.crtItem, crtPrice: num(it.crtPrice), crtMin: num(it.crtMin), crtDefault: num(it.crtDefault),
            itemType: it.itemType, attrs: it.attrs || {}, type: type, status: '', note: '', fixedSell: opts.fixedSell != null ? opts.fixedSell : null, returnOf: opts.returnOf || null, noCrates: !!opts.noCrates, noCons: !!opts.noCons };
        sale.lines.push(line);
        return line;
    };
    P.setQty = function (sale, id, qty) { var l = lineOf(sale, id); if (!l) return null; qty = num(qty); if (qty <= 0) return P.removeLine(sale, id); l.qty = rnd(qty, 3); return l; };
    P.removeLine = function (sale, id) { sale.lines = sale.lines.filter(function (l) { return l.id !== id; }); return null; };
    P.setDiscount = function (sale, id, pct, settings) {
        var l = lineOf(sale, id); if (!l) return null;
        var s = P.settings(settings); pct = Math.max(0, Math.min(num(pct), s.maxDiscountPct));
        l.discAdd = rnd(pct, 3); return l;
    };
    P.setPrice = function (sale, id, price, settings) {
        var l = lineOf(sale, id); if (!l) return null;
        if (!P.settings(settings).allowPriceEdit) throw new Error('Price changes are not allowed on this till');
        l.price = Math.abs(rnd(num(price), 2)); l.priceEdited = l.price !== l.listPrice; return l;
    };
    P.setCustomer = function (sale, cust) { sale.customer = cust ? { number: str(cust.number || cust.CUSTOMER_NUMBER), name: str(cust.name || cust.CUSTOMER_NAME), category: str(cust.category || cust.CUSTOMER_CATEGORY), type: str(cust.type || cust.CUSTOMER_CLASS), credit: num(cust.credit != null ? cust.credit : cust.CREDIT_LIMIT), vat: str(cust.vat || cust.VAT), brn: str(cust.brn || cust.BRN) } : null; return sale.customer; };

    /** Prices every line (discount rules of the customer, then the Order Pad maths) and returns lines + totals. Does not change the sale. */
    P.compute = function (sale, ctx) {
        ctx = ctx || {};
        var s = P.settings(ctx.settings);
        var rules = ctx.rules ? OM.omRulesForCustomer(ctx.rules.map(function (r) { return r.ctx ? r : OM.omNormRule(r); }), sale.customer || {}) : [];
        var lines = sale.lines.map(function (l) { var c = merge(l, {}); c.attrs = l.attrs; return c; });
        if (rules.length) OM.omApplyDiscounts(lines, rules, ctx.now || new Date(), {});
        var octx = { precision: s.precision, taxRates: s.taxRates, taxOff: !!s.taxOff };
        var out = lines.map(function (l) { var c = OM.omCalcLine(l, octx); return { line: l, calc: c, why: l.discWhy ? OM.omExplainDiscount(l) : '' }; });
        var t = OM.omTotals(lines, octx);
        t.items = lines.length; t.units = lines.reduce(function (a, l) { return a + Math.abs(num(l.qty)); }, 0);
        t.total = P.roundCash(t.net, 0);
        t.rounded = P.roundCash(t.net, s.cashRounding);
        t.rounding = rnd(t.rounded - t.net, s.precision);
        return { lines: out, totals: t, settings: s };
    };
    P.roundCash = function (amount, step) { step = num(step); if (!step) return rnd(amount, 2); return rnd(Math.round(amount / step) * step, 2); };

    // ── payments ─────────────────────────────────────────────────
    /** The tenders a till offers: settings.tenders = codes ("CARD") or whole tender objects; default all four. */
    P.tenderList = function (settings) {
        var want = (settings && settings.tenders) || P.TENDERS;
        return want.map(function (x) { if (typeof x !== 'string') return x && x.code ? x : null; for (var i = 0; i < P.TENDERS.length; i++) if (P.TENDERS[i].code === up(x)) return P.TENDERS[i]; return null; }).filter(Boolean);
    };
    P.tender = function (code, settings) { var list = P.tenderList(settings); for (var i = 0; i < list.length; i++) if (list[i].code === up(code)) return list[i]; return null; };
    P.paid = function (sale) { return rnd(sale.payments.reduce(function (a, p) { return a + num(p.amount); }, 0), 2); };
    /** total = what is owed (negative for a refund), paid, due (>0 still to pay), change (cash given back). */
    P.balance = function (sale, ctx) {
        var c = P.compute(sale, ctx), s = c.settings, total = c.totals.rounded;
        var cashOnly = sale.payments.length && sale.payments.every(function (p) { var t = P.tender(p.tender, s); return t && t.change; });
        var paid = P.paid(sale), due = rnd(total - paid, 2), change = 0;
        if (total >= 0 && due < 0) { change = -due; due = 0; }
        if (!cashOnly && change > 0) {           // only cash gives change: cards never over-pay
            var cash = sale.payments.filter(function (p) { var t = P.tender(p.tender, s); return t && t.change; }).reduce(function (a, p) { return a + num(p.amount); }, 0);
            if (change > cash) change = cash;
        }
        return { total: total, paid: paid, due: due, change: rnd(change, 2), totals: c.totals, settings: s };
    };
    P.addPayment = function (sale, p, ctx) {
        var s = P.settings(ctx && ctx.settings), t = P.tender(p.tender, s);
        if (!t) throw new Error('Unknown tender ' + p.tender);
        var amount = rnd(num(p.amount), 2);
        if (!amount) throw new Error('Amount missing');
        if (t.customer && !(sale.customer && sale.customer.number)) throw new Error(t.label + ' needs a customer on the sale');
        var b = P.balance(sale, ctx);
        if (!t.change && b.total >= 0 && amount > b.due + 1e-9) throw new Error(t.label + ' cannot be more than the amount due (' + P.money(b.due, s) + ')');
        var pay = { id: P.newId('p'), tender: t.code, amount: amount, ref: str(p.ref), at: P.nowIso(ctx && ctx.now) };
        sale.payments.push(pay);
        return pay;
    };
    P.removePayment = function (sale, id) { sale.payments = sale.payments.filter(function (p) { return p.id !== id; }); };

    /** Can this sale be completed now? */
    P.canComplete = function (sale, ctx) {
        if (sale.status !== 'OPEN' && sale.status !== 'PARKED') return { ok: false, why: 'This sale is ' + sale.status.toLowerCase() };
        if (!sale.lines.length) return { ok: false, why: 'Nothing on the sale yet' };
        var b = P.balance(sale, ctx);
        if (b.total >= 0 && b.due > 0.005) return { ok: false, why: P.money(b.due, b.settings) + ' still to pay', due: b.due };
        if (b.total < 0 && rnd(b.paid - b.total, 2) !== 0 && Math.abs(b.paid - b.total) > 0.005) return { ok: false, why: 'Refund ' + P.money(-b.total, b.settings) + ' must be paid out in full' };
        var s = b.settings, c = P.compute(sale, ctx);
        for (var i = 0; i < c.lines.length; i++) if (c.lines[i].calc.pct > s.maxDiscountPct + 1e-9) return { ok: false, why: 'Discount over ' + s.maxDiscountPct + '% on ' + c.lines[i].line.item };
        return { ok: true, balance: b };
    };
    /** Freezes the sale: number, totals, done time. Returns the document to submit. */
    P.complete = function (sale, ctx) {
        var can = P.canComplete(sale, ctx); if (!can.ok) throw new Error(can.why);
        var c = P.compute(sale, ctx), b = can.balance, s = c.settings;
        var n = num(ctx && ctx.nextNumber, 1);
        sale.number = sale.number || (s.numberPrefix + '-' + (ctx && ctx.device ? ctx.device + '-' : '') + ('000000' + n).slice(-6));
        sale.kind = b.total < 0 ? 'RETURN' : 'SALE';
        sale.status = 'DONE';
        sale.doneAt = P.nowIso(ctx && ctx.now);
        sale.lines = c.lines.map(function (x) { var l = merge(x.line, {}); l.calc = x.calc; delete l.discWhy; return l; });
        sale.totals = merge(c.totals, { paid: b.paid, change: b.change });
        if (b.change > 0) sale.payments.push({ id: P.newId('p'), tender: 'CASH', amount: -b.change, ref: 'change', at: sale.doneAt });
        return sale;
    };
    P.park = function (sale) { if (sale.status === 'OPEN') sale.status = 'PARKED'; return sale; };
    P.resume = function (sale) { if (sale.status === 'PARKED') sale.status = 'OPEN'; return sale; };
    P.voidSale = function (sale, reason, user) { if (sale.status === 'DONE') throw new Error('A completed sale is reversed with a return, not voided'); sale.status = 'VOID'; sale.voidReason = str(reason); sale.voidBy = user || ''; return sale; };

    /** A return of some lines of a done sale, at the price the customer paid (fixedSell). picks = [{lineId, qty, reason}]. */
    P.returnOf = function (done, picks, o) {
        if (done.status !== 'DONE') throw new Error('Only a completed sale can be returned');
        var r = P.newSale(merge(o, { returnOf: { saleId: done.saleId, number: done.number }, customer: done.customer }));
        (picks || []).forEach(function (p) {
            var l = lineOf(done, p.lineId); if (!l) return;
            var qty = Math.min(Math.abs(num(p.qty, l.qty)), Math.abs(num(l.qty)));
            if (qty <= 0) return;
            var sell = l.calc ? Math.abs(l.calc.sell) : l.price;
            var line = P.addItem(r, l, qty, { type: 'RET', fixedSell: sell, separate: true, returnOf: { saleId: done.saleId, lineId: l.id }, noCrates: !l.calc || !l.calc.crtTotal, noCons: !l.calc || !l.calc.consTotal });
            line.note = str(p.reason);
        });
        return r;
    };

    // ── shifts ───────────────────────────────────────────────────
    P.openShift = function (o) { o = o || {}; return { shiftId: P.newId('sh'), pod: o.pod || '', device: o.device || '', user: o.user || '', openedAt: P.nowIso(o.now), floatAmt: rnd(num(o.floatAmt), 2), closedAt: '', counted: null, expected: null, variance: null, payouts: [], note: '', status: 'OPEN' }; };
    P.payout = function (shift, amount, reason, user) { var p = { id: P.newId('po'), amount: rnd(num(amount), 2), reason: str(reason), by: user || '', at: P.nowIso() }; shift.payouts.push(p); return p; };
    /** Totals of a shift from its done sales. */
    P.shiftSummary = function (shift, sales, settings) {
        var s = P.settings(settings), byTender = {}, sum = { sales: 0, returns: 0, voids: 0, net: 0, tax: 0, disc: 0, items: 0 };
        (sales || []).forEach(function (sl) {
            if (sl.shiftId !== shift.shiftId) return;
            if (sl.status === 'VOID') { sum.voids++; return; }
            if (sl.status !== 'DONE') return;
            if (sl.kind === 'RETURN') sum.returns++; else sum.sales++;
            sum.net = rnd(sum.net + num(sl.totals && sl.totals.rounded), 2);
            sum.tax = rnd(sum.tax + num(sl.totals && sl.totals.tax), 2);
            sum.disc = rnd(sum.disc + num(sl.totals && sl.totals.disc), 2);
            sum.items += (sl.lines || []).length;
            (sl.payments || []).forEach(function (p) { byTender[p.tender] = rnd((byTender[p.tender] || 0) + num(p.amount), 2); });
        });
        var payouts = rnd((shift.payouts || []).reduce(function (a, p) { return a + num(p.amount); }, 0), 2);
        var cashExpected = rnd(shift.floatAmt + (byTender.CASH || 0) - payouts, 2);
        return { byTender: byTender, sum: sum, payouts: payouts, cashExpected: cashExpected, floatAmt: shift.floatAmt, currency: s.currency };
    };
    P.closeShift = function (shift, counted, sales, settings, now) {
        var z = P.shiftSummary(shift, sales, settings);
        shift.counted = rnd(num(counted), 2); shift.expected = z.cashExpected; shift.variance = rnd(shift.counted - z.cashExpected, 2);
        shift.closedAt = P.nowIso(now); shift.status = 'CLOSED'; shift.summary = z;
        return shift;
    };

    // ── formatting & receipts ────────────────────────────────────
    P.money = function (n, settings) {
        var s = settings && settings.currency != null ? settings : P.settings(settings);
        var v = rnd(num(n), s.precision == null ? 2 : s.precision), neg = v < 0; v = Math.abs(v);
        var parts = v.toFixed(s.precision == null ? 2 : s.precision).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (neg ? '-' : '') + (s.currency ? s.currency + ' ' : '') + parts.join('.');
    };
    function padR(t, n) { t = String(t == null ? '' : t); return t.length >= n ? t.slice(0, n) : t + new Array(n - t.length + 1).join(' '); }
    function padL(t, n) { t = String(t == null ? '' : t); return t.length >= n ? t.slice(-n) : new Array(n - t.length + 1).join(' ') + t; }
    function center(t, n) { t = String(t || ''); if (t.length >= n) return t.slice(0, n); var l = Math.floor((n - t.length) / 2); return new Array(l + 1).join(' ') + t; }
    function wrap(t, n) { var out = [], w = String(t || '').split(/\s+/), cur = ''; w.forEach(function (x) { if ((cur + ' ' + x).trim().length > n) { if (cur) out.push(cur); cur = x; } else cur = (cur + ' ' + x).trim(); }); if (cur) out.push(cur); return out; }
    /** Plain-text receipt for an ESC/POS printer (cols = 32 for 58 mm, 42/48 for 80 mm) and the same as HTML. */
    P.receipt = function (sale, settings) {
        var s = P.settings(settings), n = s.receiptCols || 32, L = [], t = sale.totals || P.compute(sale, { settings: s }).totals;
        var line = new Array(n + 1).join('-');
        L.push(center(s.shop.name, n));
        wrap(s.shop.address, n).forEach(function (x) { L.push(center(x, n)); });
        if (s.shop.phone) L.push(center('Tel ' + s.shop.phone, n));
        if (s.shop.brn) L.push(center('BRN ' + s.shop.brn + (s.shop.vat ? '  VAT ' + s.shop.vat : ''), n));
        L.push(line);
        L.push(center(sale.kind === 'RETURN' ? 'CREDIT NOTE' : 'RECEIPT', n));
        L.push(('No ' + (sale.number || sale.saleId)).slice(0, n));
        L.push(padL((sale.doneAt || sale.openedAt).replace('T', ' ').slice(0, 16), n));
        if (sale.user) L.push('Served by ' + sale.user + (sale.device ? ' · ' + sale.device : ''));
        if (sale.customer && sale.customer.name) L.push(('Customer ' + sale.customer.name).slice(0, n));
        if (sale.returnOf) L.push(('Return of ' + sale.returnOf.number).slice(0, n));
        L.push(line);
        var qw = 6, aw = 11, dw = n - qw - aw;
        sale.lines.forEach(function (l) {
            var c = l.calc || OM.omCalcLine(l, { precision: s.precision, taxRates: s.taxRates, taxOff: s.taxOff });
            wrap(l.desc || l.item, n).forEach(function (x, i) { if (i === 0) L.push(x); else L.push('  ' + x); });
            L.push(padR('  ' + Math.abs(c.qty) + ' x ' + P.money(Math.abs(c.sell), { currency: '', precision: s.precision }), dw + qw) + padL(P.money(c.gross, { currency: '', precision: s.precision }), aw));
            if (c.pct) L.push(padR('  disc ' + rnd(c.pct, 2) + '%', dw + qw) + padL('-' + P.money(Math.abs(c.discTotal), { currency: '', precision: s.precision }), aw));
            if (c.consTotal) L.push(padR('  deposit', dw + qw) + padL(P.money(c.consTotal, { currency: '', precision: s.precision }), aw));
            if (c.crtTotal) L.push(padR('  crates ' + Math.abs(c.crtQty), dw + qw) + padL(P.money(c.crtTotal, { currency: '', precision: s.precision }), aw));
        });
        L.push(line);
        function tot(label, v, bold) { L.push(padR(label, n - aw - 2) + padL(P.money(v, { currency: '', precision: s.precision }), aw + 2)); }
        tot('Subtotal', t.gross);
        if (t.disc) tot('Discount', -Math.abs(t.disc));
        if (t.tax) tot('VAT', t.tax);
        if (t.cons) tot('Deposits', t.cons);
        if (t.crates) tot('Crates', t.crates);
        if (t.rounding) tot('Rounding', t.rounding);
        tot('TOTAL ' + s.currency, t.rounded != null ? t.rounded : t.net, true);
        (sale.payments || []).forEach(function (p) { var td = P.tender(p.tender, s); tot((p.ref === 'change' ? 'Change' : (td ? td.label : p.tender)) + (p.ref && p.ref !== 'change' ? ' ' + p.ref : ''), p.ref === 'change' ? -p.amount : p.amount); });
        L.push(line);
        if (sale.mra && sale.mra.irn) { L.push('MRA IRN ' + sale.mra.irn); }
        else if (sale.mra && sale.mra.status === 'PENDING') L.push(center('Invoice to follow', n));
        wrap(s.shop.footer, n).forEach(function (x) { L.push(center(x, n)); });
        var text = L.join('\n');
        var html = '<pre style="font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;white-space:pre;margin:0">' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>';
        return { text: text, html: html, lines: L, cols: n };
    };

    // ── sync documents ───────────────────────────────────────────
    /** The document the phone submits (kind pos_sale): the done sale, nothing computed on the server. */
    P.saleDoc = function (sale) { var d = JSON.parse(JSON.stringify(sale)); d.engine = P.VERSION; return d; };
    P.shiftDoc = function (shift) { var d = JSON.parse(JSON.stringify(shift)); d.engine = P.VERSION; return d; };

    if (typeof module !== 'undefined' && module.exports) module.exports = P; else root.POSE = P;
})(typeof window !== 'undefined' ? window : this);
