/* node wms2/tests/cancel-rules.test.js — the autopilot picks exactly the lines the Shipping Agent's Task 2 picks. */
'use strict';
const R = require('../w2-cancel-rules.js');
let n = 0, bad = 0;
function eq(a, b, what) { n++; const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) { bad++; console.error('FAIL ' + what + '\n  got  ' + A + '\n  want ' + B); } }

const L = (num, item, status, id) => ({ LINE_NUMBER: num, PRODUCT_NUMBER: item, STATUS: status, FULFILL_LINE_ID: id });
const order = [
    L('1', 'COLA15', 'Awaiting Shipping', 101),
    L('2', 'WATER5', 'Scheduled', 102),
    L('2.1', 'WATER5-DEP', 'Scheduled', 103),
    L('2.2', 'CRATE', 'Shipped', 104),
    L('3', 'JUICE1', 'Manual Reservation Required', 105),
    L('4', 'JUICE1-FREE', 'Booked', 106),
    L('5', 'SNACK', 'Scheduled', null),
    L('6', 'CHIPS', 'Interfaced', 107)
];
const bogo = R.bogoMap([{ MAINITEMCODE: 'juice1', PROMOITEMCODE: 'JUICE1-FREE' }, { MAINITEMCODE: 'CHIPS', PROMOITEMCODE: 'DIP' }]);
eq(bogo, { JUICE1: ['JUICE1-FREE'], CHIPS: ['DIP'] }, 'bogo map');

const x = R.expand(order, bogo);
eq(x.lines.map(l => [R.lineNum(l.line), l.via]), [['2', 'MAIN'], ['2.1', 'MAIN'], ['3', 'MAIN'], ['4', 'BOGO']], 'lines picked (2.1 is Scheduled itself = main; 2.2 shipped is skipped; 4 via BOGO of 3; 5 has no id)');
eq(x.main, 4, 'flagged main lines (incl. the one without id)');
eq(x.noId.map(R.lineNum), ['5'], 'main line without id reported');
eq(x.skipped.map(s => [R.lineNum(s.line), s.via, s.reason]), [['2.2', 'SUB-LINE', 'status "Shipped" not cancellable']], 'skipped child');
eq(R.body(x.lines), { lines: [102, 103, 105, 106].map(id => ({ FulfillLineId: id, OrderedQuantity: 0, CancelReason: 'OUT OF STOCK' })) }, 'PATCH body');
eq(R.url('https://x', 'VVTB51731'), 'https://x/fscmRestApi/resources/11.13.18.05/salesOrdersForOrderHub/OPS:VVTB51731', 'PATCH url');

// sub-lines win over BOGO: a main line with numbered children never looks at the BOGO map
const o2 = [L('7', 'JUICE1', 'Scheduled', 201), L('7.1', 'X', 'Booked', 202), L('8', 'JUICE1-FREE', 'Booked', 203)];
eq(R.expand(o2, bogo).lines.map(l => R.lineNum(l.line) + ':' + l.via), ['7:MAIN', '7.1:SUB-LINE'], 'sub-lines before BOGO');
// a child without id is skipped
const o3 = [L('9', 'A', 'Scheduled', 301), L('9.1', 'B', 'Booked', null)];
// like the agent (saChildBlocked: SHIPPED), a child line in Awaiting Shipping IS cancelled with its main line; a Shipped one is not
eq(R.expand([L('10', 'A', 'Manual Reservation Required', 401), L('10.1', 'B', 'Awaiting Shipping', 402)], {}).lines.map(x => x.via), ['MAIN', 'SUB-LINE'], 'awaiting shipping child cancelled with its main line');
eq(R.expand([L('10', 'A', 'Scheduled', 401), L('10.1', 'B', 'Shipped', 402)], {}).skipped.map(s => s.reason), ['status "Shipped" not cancellable'], 'shipped child kept');
eq(R.expand([L('12', 'MAINX', 'Manual Reservation Required', 601), L('13', 'PROMOX', 'Awaiting Shipping', 602)], { MAINX: ['PROMOX'] }).lines.map(x => x.via), ['MAIN', 'BOGO'], 'awaiting shipping BOGO item cancelled with its main item');
eq(R.expand([L('11', 'A', 'Awaiting Shipping', 501)], {}).lines.length, 0, 'awaiting shipping main line is not cancelled');
eq(R.expand(o3, {}).skipped.map(s => s.reason), ['missing FULFILL_LINE_ID'], 'child without id');
// nothing flagged → nothing
eq(R.expand([L('1', 'A', 'Awaiting Shipping', 1)], {}).lines.length, 0, 'nothing to cancel');
// other field names the endpoints use
eq(R.fid({ SOURCE_FULFILLMENT_LINE_ID: 9 }), 9, 'fid alias'); eq(R.lineStatus({ line_status: 'Scheduled' }), 'Scheduled', 'status alias');
// PATCH answers
eq(R.patchError({ ReturnStatus: 'Error', ErrorExplanation: 'HTTP Error: BadRequest' }), 'HTTP Error: BadRequest', 'host error shape');
eq(R.patchError('{"title":"Bad Request","status":"400","detail":"Line is closed"}'), 'Bad Request: Line is closed', 'Fusion error shape');
eq(R.patchError({ OrderNumber: 'OPS:1', lines: [] }), null, 'success');

console.log(n - bad + ' of ' + n + ' passed');
process.exit(bad ? 1 : 0);
