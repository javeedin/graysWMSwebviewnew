/* node wms2/tests/premortem.test.js — the Tomorrow check predicts the right risks. */
'use strict';
const P = require('../w2-premortem-engine.js');
const R = require('../w2-cancel-rules.js');
let n = 0, bad = 0;
function ok(c, what) { n++; if (!c) { bad++; console.error('FAIL ' + what); } }

const L = (num, item, status, id) => ({ LINE_NUMBER: num, PRODUCT_NUMBER: item, STATUS: status, FULFILL_LINE_ID: id });
const O = (on, trip, extra) => Object.assign({ order_number: on, trip_id: trip, account_number: 'C' + on, account_name: 'Cust ' + on, stage: 'READY', picker: 'ALI', mra: null, wms_lines: 3 }, extra || {});

const allOut = [L('1', 'A', 'Scheduled', 1), L('2', 'B', 'Manual Reservation Required', 2)];
const someOut = [L('1', 'A', 'Awaiting Shipping', 3), L('2', 'B', 'Scheduled', 4), L('2.1', 'B-F', 'Shipped', 5)];
const r = P.assess({
    orders: [
        O('100', 'T1'), O('101', 'T1'), O('102', 'T1', { stage: 'NO LINES' }), O('103', 'T2', { mra: 'FAILED', mra_msg: 'BRN missing' }),
        O('104', 'T2', { account_number: 'BAD' }), O('105', 'T2', { picker: '' }), O('106', 'T2', { stage: 'CANCELLED' }),
        O('107', 'T2', { stage: 'INTERFACED', picker: '' }), O('108', 'T3'), O('108', 'T4'), O('109', 'T3', { account_number: 'GOOD' }), O('110', 'T3', { stage: 'NO LINES', order_type: 'Store to Van' })
    ],
    cancelSets: { 100: R.expand(allOut, {}), 101: R.expand(someOut, {}) },
    lineCounts: { 100: { total: 2, live: 2 }, 101: { total: 3, live: 3 } },
    autopilotOn: true,
    mraCustomers: { BAD: { tries: 8, failed: 6, gw: 1, lastStatus: 'FAILED', lastReason: 'Invalid BRN' }, GOOD: { tries: 20, failed: 1, gw: 1 } },
    mraGateway: { timeouts: 12, tries: 100, peakHour: 17 },
    pending: [{ order_number: '900', account_number: 'C101', order_date: '2026-10-01' }, { order_number: '100', account_number: 'C100' }]
});
const kinds = o => r.risks.filter(x => x.order === o).map(x => x.kind).sort().join(',');
ok(kinds('100') === 'EMPTY', 'all lines out of stock → EMPTY: ' + kinds('100'));
ok(kinds('101') === 'ADD_ON,CANCEL,STRANDED', 'some lines + shipped sub-line + pending add-on: ' + kinds('101'));
ok(kinds('102') === 'GHOST', 'no lines in Fusion: ' + kinds('102'));
ok(kinds('103') === 'MRA_REPEAT', 'failed MRA already: ' + kinds('103'));
ok(kinds('104') === 'MRA_RISK', 'customer usually fails: ' + kinds('104'));
ok(r.risks.find(x => x.order === '104').sev === 3, 'high chance = sev 3');
ok(kinds('105') === 'NO_PICKER', 'no picker: ' + kinds('105'));
ok(kinds('106') === 'STALE', 'cancelled still on trip: ' + kinds('106'));
ok(kinds('107') === '', 'interfaced = nothing');
ok(kinds('108') === 'DUPLICATE', 'on two trips once: ' + kinds('108'));
ok(kinds('109') === '', 'good customer = nothing');
ok(kinds('110') === '', 'store to van without shipment lines = nothing');
ok(r.risks[0].kind === 'EMPTY', 'worst first');
ok(r.systemic.some(s => s.kind === 'GATEWAY' && /17:00/.test(s.why)), 'gateway peak hour');
ok(r.summary.willNotShip === 2 && r.summary.lines === 3, 'summary ' + JSON.stringify(r.summary));
const t1 = r.trips.find(t => t.trip === 'T1');
ok(t1.orders === 3 && t1.atRisk === 3 && t1.readiness === 0, 'trip T1 readiness ' + JSON.stringify(t1));
ok(r.trips[0].readiness <= r.trips[r.trips.length - 1].readiness, 'trips worst first');

const off = P.assess({ orders: [O('1', 'T')], cancelSets: { 1: R.expand(someOut, {}) }, lineCounts: { 1: { live: 3 } }, autopilotOn: false, mraOn: false, orderLinesRead: false });
ok(off.systemic.some(s => s.kind === 'AUTOPILOT') && off.systemic.some(s => s.kind === 'DATA'), 'autopilot off + data missing');

const sc = P.score([{ order: '1', kind: 'CANCEL' }, { order: '2', kind: 'MRA_RISK' }, { order: '3', kind: 'NO_PICKER' }],
    [{ order_number: '1', cancelled_w2: 2 }, { order_number: '2', mra: 'DONE' }, { order_number: '3' }, { order_number: '4', mra: 'FAILED' }]);
ok(sc.hit === 1 && sc.miss === 1 && sc.precision === 50 && sc.surprises.join() === '4', 'score ' + JSON.stringify(sc));

console.log((bad ? 'FAILED ' : 'OK ') + (n - bad) + ' of ' + n);
process.exit(bad ? 1 : 0);
