'use strict';
/* node fieldapps/tests/pos-engine.test.js — the POS engine on top of the Order Pad engine. */
var P = require('../apps/pos/pos-engine.js');
var n = 0, bad = 0;
function eq(a, b, what) { n++; var ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { bad++; console.log('FAIL ' + what + '\n   got      ' + JSON.stringify(a) + '\n   expected ' + JSON.stringify(b)); } }
function ok(c, what) { eq(!!c, true, what); }
function throws(fn, what) { n++; try { fn(); bad++; console.log('FAIL ' + what + ' — no error'); } catch (e) { } }

var S = { currency: 'Rs', taxRates: { 'GROT1.4': 15, 'GRTESTOUT17': 17, 'GROT1.2': 0 }, numberPrefix: 'POS', receiptCols: 32, shop: { name: 'Gray\'s Van 3' } };
var rows = [
    { ITEM_NUMBER: 'A1', ITEM_DESC: 'Mineral water 1.5L', UOM_CODE: 'EA', LIST_PRICE: '100', TAX_CODE: 'GROT1.4', CONS: '2', CONSIGNMENTITEM: 'DEP1', CRT_ITEM_CODE: 'CRT1', CRT: '50', CRT_MIN_QTY: '12', CRT_DEFAULT_QTY: '1', BRAND: 'X', CATEGORY: 'DRINKS', BARCODE: '6001234567890' },
    { ITEM_NUMBER: 'B2', ITEM_DESC: 'Biscuits 200g', UOM_CODE: 'EA', LIST_PRICE: '45.5', TAX_CODE: 'GROT1.2', BRAND: 'Y', CATEGORY: 'FOOD', BARCODE: '5000000000001' },
    { ITEM_NUMBER: 'C3', ITEM_DESC: 'Water bottle 500ml', UOM_CODE: 'EA', LIST_PRICE: '20', TAX_CODE: 'GROT1.4', CATEGORY: 'DRINKS', ACTIVE: 'N' }
];
var items = rows.map(P.normItem);
eq(items[0].item, 'A1', 'normItem code'); eq(items[0].crtMin, 12, 'normItem crate min'); eq(items[0].attrs.brand, 'X', 'normItem attrs'); eq(items[2].active, false, 'inactive item');

// search
eq(P.search(items, 'water').map(function (i) { return i.item; }), ['C3', 'A1'], 'search words, prefix first');
eq(P.search(items, '6001234567890')[0].item, 'A1', 'search barcode exact');
eq(P.byBarcode(items, '5000000000001').item, 'B2', 'byBarcode');
eq(P.byBarcode(items, '3*B2').qty, 3, 'qty*code scanner word');
eq(P.byBarcode(items, 'nope'), null, 'unknown barcode');

// sale, same maths as the Order Pad (24 × A1 at 100, 7 % discount, 15 % VAT, deposit 2, crates 2 × 50 = 2714.8)
var sale = P.newSale({ pod: 'PROD', shiftId: 'sh1', device: 'VAN3', user: 'ravi' });
var l = P.addItem(sale, items[0], 24);
l.discAdd = 7;                       // the cashier's manual discount is 'additional'; customer / marketing % come from the rules
var c = P.compute(sale, { settings: S });
eq(c.lines[0].calc.net, 2714.8, 'line net like omCalcLine'); eq(c.totals.net, 2714.8, 'totals net'); eq(c.totals.tax, 334.8, 'tax'); eq(c.totals.crates, 100, 'crates'); eq(c.totals.cons, 48, 'deposit');
P.addItem(sale, items[0], 1); eq(sale.lines.length, 1, 'same item merges'); eq(sale.lines[0].qty, 25, 'merged qty');
P.addItem(sale, items[1], 2);
eq(sale.lines.length, 2, 'second item');
P.setQty(sale, sale.lines[0].id, 24); eq(sale.lines[0].qty, 24, 'setQty');
P.setQty(sale, sale.lines[1].id, 0); eq(sale.lines.length, 1, 'qty 0 removes');
P.addItem(sale, items[1], 2);

// discount rules of the customer (customer rule 10 % on brand Y)
var rules = [{ RULE_ID: 1, CTX: 'CUSTOMER', LEVEL: 'BRAND', TARGET: 'Y', PCT: 10, CUST_NO: 'C100' }, { RULE_ID: 2, CTX: 'MARKETING', TARGET: 'ALL', PCT: 1 }];
P.setCustomer(sale, { CUSTOMER_NUMBER: 'C100', CUSTOMER_NAME: 'Shop One', CUSTOMER_CATEGORY: 'RETAIL' });
c = P.compute(sale, { settings: S, rules: rules });
eq(c.lines[1].calc.pct, 11, 'brand rule 10 % + marketing 1 % on B2'); eq(c.lines[1].calc.sell, 40.49, 'sell after 11 % (45.5 − 5.01, rounded like the Order Pad)'); ok(/Brand "Y" 10%/.test(c.lines[1].why), 'discount explanation');
eq(c.lines[0].calc.pct, 8, 'A1 keeps its manual 7 % + marketing 1 %');
ok(sale.lines[1].discCust === 0, 'compute does not change the sale lines');

// manual discount capped
P.setDiscount(sale, sale.lines[1].id, 150, { maxDiscountPct: 20 }); eq(sale.lines[1].discAdd, 20, 'discount capped at max');
P.setDiscount(sale, sale.lines[1].id, 0);
throws(function () { P.setPrice(sale, sale.lines[1].id, 10, S); }, 'price edit refused by default');
P.setPrice(sale, sale.lines[1].id, 40, { allowPriceEdit: true }); eq(sale.lines[1].price, 40, 'price edit allowed');
P.setPrice(sale, sale.lines[1].id, 45.5, { allowPriceEdit: true });

// payments
var ctx = { settings: S, rules: rules, device: 'VAN3', nextNumber: 7 };
var b = P.balance(sale, ctx);
eq(b.total, 2768.18, 'total = A1 at 8 % (2687.2) + 2 × 40.49'); eq(b.due, 2768.18, 'due before paying');
throws(function () { P.addPayment(sale, { tender: 'CARD', amount: 3000 }, ctx); }, 'card cannot overpay');
throws(function () { P.addPayment(sale, { tender: 'GOLD', amount: 10 }, ctx); }, 'unknown tender');
P.addPayment(sale, { tender: 'CARD', amount: 1000, ref: '1234' }, ctx);
eq(P.canComplete(sale, ctx).ok, false, 'not complete with due');
P.addPayment(sale, { tender: 'CASH', amount: 2000 }, ctx);
b = P.balance(sale, ctx); eq(b.due, 0, 'due 0'); eq(b.change, 231.82, 'change from cash');
eq(P.canComplete(sale, ctx).ok, true, 'can complete');
var done = P.complete(sale, ctx);
eq(done.status, 'DONE', 'done'); eq(done.number, 'POS-VAN3-000007', 'number'); eq(done.kind, 'SALE', 'kind'); eq(done.totals.paid, 3000, 'paid'); eq(done.totals.change, 231.82, 'change kept');
eq(done.payments[done.payments.length - 1].amount, -231.82, 'change line in payments');
eq(done.lines[1].discCust, 10, 'rules frozen on the done lines');
throws(function () { P.complete(done, ctx); }, 'cannot complete twice');
throws(function () { P.addItem(done, items[0], 1); }, 'cannot add to a done sale');

// receipt
var r = P.receipt(done, S);
ok(r.lines.every(function (x) { return x.length <= 32; }), 'receipt lines fit 32 columns');
ok(/TOTAL Rs\s+2,768\.18/.test(r.text), 'receipt total'); ok(/Change\s+231\.82/.test(r.text), 'receipt change'); ok(/Card 1234/.test(r.text), 'card ref on receipt'); ok(/Customer Shop One/.test(r.text), 'customer on receipt');
ok(/crates 2\s+100\.00/.test(r.text), 'crates on receipt');

// credit needs a customer
var s2 = P.newSale({});
P.addItem(s2, items[1], 1);
throws(function () { P.addPayment(s2, { tender: 'CREDIT', amount: 45.5 }, { settings: S }); }, 'on account without customer');
P.setCustomer(s2, { number: 'C1', name: 'A' });
P.addPayment(s2, { tender: 'CREDIT', amount: 45.5 }, { settings: S });
eq(P.canComplete(s2, { settings: S }).ok, true, 'on account with customer');

// cash rounding
var s3 = P.newSale({}); P.addItem(s3, items[1], 1); // 45.5
var c3 = P.compute(s3, { settings: Object.assign({}, S, { cashRounding: 1 }) });
eq(c3.totals.rounded, 46, 'rounded to 1'); eq(c3.totals.rounding, 0.5, 'rounding amount');
eq(P.roundCash(45.52, 0.05), 45.5, 'round to 5 cents'); eq(P.roundCash(45.53, 0.05), 45.55, 'round up to 5 cents');

// return of a done sale at the price paid
var ret = P.returnOf(done, [{ lineId: done.lines[1].id, qty: 1, reason: 'Damaged' }], { user: 'ravi', device: 'VAN3' });
eq(ret.lines.length, 1, 'one return line'); eq(ret.lines[0].type, 'RET', 'RET type'); eq(ret.lines[0].fixedSell, 40.49, 'at the selling price paid');
var rb = P.balance(ret, { settings: S });
eq(rb.total, -40.49, 'refund amount'); ok(/Refund/.test(P.canComplete(ret, { settings: S }).why), 'refund must be paid out');
P.addPayment(ret, { tender: 'CASH', amount: -40.49 }, { settings: S });
eq(P.canComplete(ret, { settings: S }).ok, true, 'refund paid out');
var rdone = P.complete(ret, { settings: S, device: 'VAN3', nextNumber: 8 });
eq(rdone.kind, 'RETURN', 'return kind'); ok(/CREDIT NOTE/.test(P.receipt(rdone, S).text), 'credit note receipt');
throws(function () { P.returnOf(s2, [], {}); }, 'return of an open sale refused');

// void and park
var s4 = P.newSale({}); P.addItem(s4, items[0], 1); P.park(s4); eq(s4.status, 'PARKED', 'parked'); P.resume(s4); eq(s4.status, 'OPEN', 'resumed');
P.voidSale(s4, 'customer left', 'ravi'); eq(s4.status, 'VOID', 'void'); throws(function () { P.voidSale(done, 'x'); }, 'done sale cannot be voided');

// shift
var sh = P.openShift({ device: 'VAN3', user: 'ravi', floatAmt: 500 });
done.shiftId = sh.shiftId; rdone.shiftId = sh.shiftId; s4.shiftId = sh.shiftId;
P.payout(sh, 100, 'fuel', 'ravi');
var z = P.shiftSummary(sh, [done, rdone, s4], S);
eq(z.sum.sales, 1, 'shift sales'); eq(z.sum.returns, 1, 'shift returns'); eq(z.sum.voids, 1, 'shift voids');
eq(z.byTender.CASH, 1727.69, 'cash net of change and refund'); eq(z.byTender.CARD, 1000, 'card');
eq(z.cashExpected, 2127.69, 'cash expected = float + cash − payouts');
P.closeShift(sh, 2150, [done, rdone, s4], S);
eq(sh.variance, 22.31, 'variance'); eq(sh.status, 'CLOSED', 'closed');

// tenders from the manifest (codes) or objects
eq(P.tenderList({ tenders: ['CASH', 'card', 'nope'] }).map(function (x) { return x.code; }), ['CASH', 'CARD'], 'tenderList from codes');
eq(P.tender('CARD', { tenders: ['CASH', 'CARD'] }).label, 'Card', 'tender by code with settings codes');
eq(P.tender('MOBILE', { tenders: ['CASH'] }), null, 'tender not offered');
eq(P.tenderList({ tenders: [{ code: 'VOUCHER', label: 'Voucher' }] })[0].label, 'Voucher', 'tender objects kept');
var s5 = P.newSale({}); P.addItem(s5, items[1], 1);
P.addPayment(s5, { tender: 'CARD', amount: 45.5, ref: '1' }, { settings: Object.assign({}, S, { tenders: ['CASH', 'CARD'] }) });
eq(s5.payments.length, 1, 'card payment with settings tenders as codes');

// money
eq(P.money(1234567.891, S), 'Rs 1,234,567.89', 'money format'); eq(P.money(-5, S), '-Rs 5.00', 'negative money');
eq(P.money(12, { currency: '', precision: 2 }), '12.00', 'no currency');

console.log((bad ? 'FAILED ' + bad + ' of ' : 'ok ') + n + ' POS engine checks');
process.exit(bad ? 1 : 0);
