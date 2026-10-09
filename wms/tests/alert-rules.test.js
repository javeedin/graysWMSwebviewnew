/* node wms/tests/alert-rules.test.js — the four WMS alert categories pick exactly what they should. */
'use strict';
const A = require('../alert-rules.js');
const R = require('../cancel-rules.js');
let n = 0, bad = 0;
function eq(a, b, what) { n++; const X = JSON.stringify(a), Y = JSON.stringify(b); if (X !== Y) { bad++; console.error('FAIL ' + what + '\n  got  ' + X + '\n  want ' + Y); } }

const L = (order, num, item, status, id) => ({ SOURCE_ORDER_NUMBER: order, LINE_NUMBER: num, PRODUCT_NUMBER: item, LINE_STATUS: status, FULFILL_LINE_ID: id });
const bogo = R.bogoMap([{ MAINITEMCODE: 'JUICE1', PROMOITEMCODE: 'JUICE1-FREE' }, { MAINITEMCODE: 'CHIPS', PROMOITEMCODE: 'DIP' }]);
const lines8223 = [
    // order A: a Scheduled main line with a sub-line + a BOGO pair where the main is live → pending cancellation, no error
    L('A', '1', 'COLA15', 'Awaiting Shipping', 101),
    L('A', '2', 'WATER5', 'Scheduled', 102),
    L('A', '2.1', 'CRATE', 'Awaiting Shipping', 103),
    L('A', '3', 'JUICE1', 'Awaiting Shipping', 104),
    L('A', '4', 'JUICE1-FREE', 'Awaiting Shipping', 105),
    // order B: the main JUICE1 is Cancelled but the free item is Closed → order error; main CHIPS cancelled with its DIP cancelled → fine
    L('B', '1', 'JUICE1', 'Cancelled', 201),
    L('B', '2', 'JUICE1-FREE', 'Closed', 202),
    L('B', '3', 'CHIPS', 'Canceled', 203),
    L('B', '4', 'DIP', 'Cancelled', 204),
    // order C: cancelled main with an open sub-line → error (sub-line, not BOGO); a Manual Reservation main without id → pending, by hand
    L('C', '5', 'SNACK', 'Cancelled', 301),
    L('C', '5.1', 'SNACK-DEP', 'Awaiting Shipping', 302),
    L('C', '6', 'BEER', 'Manual Reservation Required', null),
    // order D: two JUICE1 mains, one cancelled, one live → the free item belongs to the live one: no error
    L('D', '1', 'JUICE1', 'Cancelled', 401),
    L('D', '2', 'JUICE1', 'Awaiting Shipping', 402),
    L('D', '3', 'JUICE1-FREE', 'Awaiting Shipping', 403)
];
const rows = [
    { TRIP_ID: '8223', TRIP_DATE: '2026-10-09', ORDER_NUMBER: 'A', CUSTOMER_NAME: 'Alpha', ORDER_TYPE: 'ORD', LINE_STATUS: 'Awaiting Shipping', PICKER: '', RELEASED: true, SHIPPED: false, PRINTED: false, MRA_INTERFACE_STATUS: '' },
    { TRIP_ID: '8223', TRIP_DATE: '2026-10-09', ORDER_NUMBER: 'B', CUSTOMER_NAME: 'Bravo', ORDER_TYPE: 'ORD', LINE_STATUS: 'Closed', PICKER: 'Ravi', RELEASED: true, SHIPPED: true, PRINTED: true, MRA_INTERFACE_STATUS: 'SUCCESS' },
    { TRIP_ID: '8223', TRIP_DATE: '2026-10-09', ORDER_NUMBER: 'C', CUSTOMER_NAME: 'Charlie', ORDER_TYPE: 'ORD', LINE_STATUS: 'Awaiting Shipping', PICKER: '', RELEASED: false, SHIPPED: false, PRINTED: true, MRA_INTERFACE_STATUS: 'FAILED', MRA_WHY: 'VAT number missing', TRIES: 2 },
    { TRIP_ID: '8224', TRIP_DATE: '2026-10-09', ORDER_NUMBER: 'D', CUSTOMER_NAME: 'Delta', ORDER_TYPE: 'ORD', LINE_STATUS: 'Shipped', PICKER: '', RELEASED: true, SHIPPED: true, PRINTED: true, MRA_INTERFACE_STATUS: 'ALREADY_DONE' },
    { TRIP_ID: '8224', TRIP_DATE: '2026-10-09', ORDER_NUMBER: 'E', CUSTOMER_NAME: 'Echo', ORDER_TYPE: 'ORD', LINE_STATUS: 'Awaiting Shipping', PICKER: 'Sam', RELEASED: true, SHIPPED: false, PRINTED: false, MRA_INTERFACE_STATUS: 'SKIPPED' }
];

const items = A.run({ date: '2026-10-09', rows, trips: [{ trip_id: '8223', lines: lines8223 }, { trip_id: '8224', lines: [] }], bogo });
const of = k => items.filter(i => i.kind === k);

eq(of('CANCEL').map(i => [i.order_number, i.line_number, i.via, i.child_of]), [['A', '2', 'MAIN', ''], ['A', '2.1', 'SUB-LINE', '2'], ['C', '6', 'MAIN', '']], 'pending cancellations: the Scheduled main + its sub-line, the Manual Reservation main without id');
eq(of('CANCEL')[2].detail.indexOf('cancel by hand') > 0, true, 'main line without id says cancel by hand');
eq(of('CANCEL')[0].customer, 'Alpha', 'line items carry the order row (customer)');
eq(of('CANCEL')[0].trip_id, '8223', 'line items carry the trip');

eq(of('ERROR').map(i => [i.order_number, i.line_number, i.via, i.child_line, i.child_status]), [['B', '1', 'BOGO', '2', 'Closed'], ['C', '5', 'SUB-LINE', '5.1', 'Awaiting Shipping']], 'order errors: cancelled main with a Closed free item; cancelled main with an open sub-line; D (live twin main) and CHIPS (DIP cancelled) are fine');
eq(of('ERROR')[0].detail, 'line 1 (JUICE1) is Cancelled — BOGO free item 2 (JUICE1-FREE) is Closed', 'error detail text');

eq(of('PICKER').map(i => [i.order_number, i.released]), [['A', true], ['C', false]], 'no picker: A and C (D has none but is shipped, B and E have one)');

eq(of('MRA').map(i => [i.order_number, i.status, i.printed]), [['C', 'FAILED', true], ['E', 'SKIPPED', false], ['A', 'NOT SENT', false]], 'not interfaced: failed first, then skipped / never sent; B SUCCESS and D ALREADY_DONE are out');
eq(of('MRA')[0].detail, 'failed: VAT number missing · 2 tries', 'failed detail with the reason and tries');
eq(of('MRA')[2].detail, 'not printed yet', 'never sent, not printed');

const s = A.summary(items);
eq([s.CANCEL.n, s.CANCEL.orders, s.PICKER.n, s.MRA.n, s.MRA.failed, s.MRA.printed, s.ERROR.n, s.total], [3, 2, 2, 3, 1, 1, 2, 10], 'summary counts');
eq(s.CANCEL.trips, ['8223'], 'trips per kind');
eq(A.message('CANCEL', s), '3 lines on 2 orders still pending for cancellation · trip 8223', 'cancel message');
eq(A.message('MRA', s), '3 orders not interfaced to MRA (1 failed, 1 printed) · trips 8223, 8224', 'mra message');
eq(A.message('PICKER', A.summary([])), 'nothing without a picker', 'empty message');
eq(A.message('ERROR', s), '2 order errors: main line cancelled, its BOGO / sub-line not · trip 8223', 'error message');

// first_seen carried by key, diff between runs
const prev = [{ key: 'PICKER|A', first_seen: '2026-10-09T08:00:00' }];
A.carry(prev, items, '2026-10-09T09:00:00');
eq([items.find(i => i.key === 'PICKER|A').first_seen, items.find(i => i.key === 'PICKER|C').first_seen], ['2026-10-09T08:00:00', '2026-10-09T09:00:00'], 'first_seen carried for a known key, new for a new one');
const d = A.diff(A.summary(prev.map(p => ({ kind: 'PICKER', key: p.key, order_number: 'A', trip_id: '8223' }))), s);
eq([d.changed, d.up, d.down], [true, ['CANCEL', 'PICKER', 'MRA', 'ERROR'], []], 'diff: every kind went up');
eq(A.diff(s, s).changed, false, 'no change = no diff');

// byOrder / orderOf on lower-case keys and ORDER_NUMBER fallback
eq(Object.keys(A.byOrder([{ order_number: 'X', LINE_NUMBER: '1' }, { ORDER_NUMBER: 'Y' }, { LINE_NUMBER: '2' }])), ['X', 'Y'], 'byOrder: SOURCE_ORDER_NUMBER / ORDER_NUMBER / lower case, lines without an order dropped');

console.log((bad ? 'FAILED ' + bad + ' of ' : 'ok ') + n + ' alert-rule checks');
process.exit(bad ? 1 : 0);
