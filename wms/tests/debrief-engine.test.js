/* node wms/tests/debrief-engine.test.js — the day debrief adds the day up and tells it in words. */
'use strict';
const E = require('../debrief-engine.js');
let n = 0, bad = 0;
function eq(a, b, what) { n++; const X = JSON.stringify(a), Y = JSON.stringify(b); if (X !== Y) { bad++; console.error('FAIL ' + what + '\n  got  ' + X + '\n  want ' + Y); } }
function ok(c, what, extra) { n++; if (!c) { bad++; console.error('FAIL ' + what + (extra === undefined ? '' : '\n  ' + JSON.stringify(extra))); } }

const R = (trip, order, o) => Object.assign({ TRIP_ID: trip, LORRY: 'L' + trip, BAY: 'B1', PRIORITY: 'High', ORDER_NUMBER: order, CUSTOMER_NAME: 'C' + order, ORDER_TYPE: 'ORD', LINE_STATUS: 'Awaiting Shipping', PICKER: 'Ravi', RELEASED: true, PICKED: true, SHIPPED: true, PRINTED: true, AMOUNT: 100, MRA_INTERFACE_STATUS: 'SUCCESS', MRA_WHY: '', TRIES: 1, RAW: { picker_assigned_on: '2026-10-09 06:1' + order } }, o || {});
const rows = [
    R('8223', '1'), R('8223', '2', { PICKER: 'Sam', PICKED: false, SHIPPED: false, PRINTED: false, MRA_INTERFACE_STATUS: '' }),
    R('8223', '3', { MRA_INTERFACE_STATUS: 'FAILED', MRA_WHY: 'VAT number missing', TRIES: 2 }),
    R('8224', '4', { PICKER: '', RELEASED: false, PICKED: false, SHIPPED: false, PRINTED: false, MRA_INTERFACE_STATUS: '', ORDER_TYPE: 'SPOS', AMOUNT: 50 })
];
const L = (order, num, status) => ({ SOURCE_ORDER_NUMBER: order, LINE_NUMBER: num, LINE_STATUS: status });
const trips = [
    { trip_id: '8223', lorry: 'L8223', bay: 'B1', priority: 'High', lines: [L('1', '1', 'Shipped'), L('1', '2', 'Cancelled'), L('2', '1', 'Awaiting Shipping'), L('3', '1', 'Closed')] },
    { trip_id: '8224', lorry: 'L8224', bay: 'B2', priority: 'Low', lines: [L('4', '1', 'Scheduled'), L('4', '1.1', 'Awaiting Shipping')] }
];
const findings = [
    { kind: 'CANCEL', trip_id: '8224', order_number: '4', line_number: '1' }, { kind: 'CANCEL', trip_id: '8224', order_number: '4', line_number: '1.1' },
    { kind: 'PICKER', trip_id: '8224', order_number: '4' }, { kind: 'MRA', trip_id: '8223', order_number: '3' }, { kind: 'ERROR', trip_id: '8223', order_number: '1', line_number: '2' }
];
const m = E.model({
    pod: 'PROD', date: '2026-10-09', builtAt: '2026-10-09 18:00', rows, trips, hidden: { store: 2, cancelled: 1 }, findings,
    mraRuns: [{ U: 'javeed', SRC: 'WMS_TRIP_GRID', S: 'SUCCESS', N: 3, GW: 0 }, { U: 'javeed', SRC: 'WMS_TRIP_GRID', S: 'FAILED', N: 1, GW: 1 }, { U: 'khalid', SRC: 'SHIPPING_AGENT', S: 'ALREADY_DONE', N: 2, GW: 0 }],
    cancelLog: [{ RESULT: 'RUN', APP_USER: 'javeed' }, { T: '09:10', APP_USER: 'javeed', TRIP_ID: '8223', ORDER_NUMBER: '1', LINE_NUMBER: '2', ITEM: 'X', VIA: 'MAIN', RESULT: 'DONE', MESSAGE: '' }, { T: '09:11', APP_USER: 'javeed', TRIP_ID: '8223', ORDER_NUMBER: '9', LINE_NUMBER: '1', ITEM: 'Y', VIA: 'BOGO', RESULT: 'FAILED', MESSAGE: 'boom' }, { RESULT: 'WOULD', APP_USER: 'x' }],
    activity: [{ USER_NAME: 'javeed', EVENT_TYPE: 'action', PAGE: 'trip-management', N: 40, FIRST_T: '08:02', LAST_T: '17:30' }, { USER_NAME: 'javeed', EVENT_TYPE: 'nav', PAGE: 'mra-interface', N: 5, FIRST_T: '10:00', LAST_T: '10:05' }, { USER_NAME: 'Khalid', EVENT_TYPE: 'action', PAGE: 'pick-release', N: 12, FIRST_T: '07:00', LAST_T: '09:00' }],
    actions: [{ USER_NAME: 'javeed', TARGET: 'Fetch Trips', N: 20 }, { USER_NAME: 'javeed', TARGET: 'Print', N: 10 }],
    hourly: [{ SRC: 'activity', H: '08', N: 10 }, { SRC: 'activity', H: '09', N: 30 }, { SRC: 'mra', H: '09', N: 4 }, { SRC: 'cancel', H: '17', N: 2 }],
    audit: [{ APP_USER: 'khalid', SOURCE: 'WMS', ACTION_KEY: 'pick_release_page', OUTCOME: 'OK', N: 2 }],
    prints: [{ PRINT_STATUS: 'Printed', OVERALL_STATUS: 'Completed', N: 3 }, { PRINT_STATUS: 'Failed', OVERALL_STATUS: 'Failed', N: 1 }],
    shipDates: [{ APP_USER: 'javeed', STATUS: 'SUCCESS', N: 2 }], pins: [{ PINNED_BY: 'khalid', TRIP_ID: '8223' }, { PINNED_BY: 'khalid', TRIP_ID: '9' }],
    errors: ['trip 8225 lines: HTTP 500']
});

eq([m.kpis.trips, m.kpis.orders, m.kpis.store, m.kpis.cancelledOrders, m.kpis.lines, m.kpis.cancelledLines, m.kpis.ordersWithCancelled], [2, 4, 2, 1, 6, 1, 1], 'kpis: trips, orders, hidden, lines');
eq([m.kpis.released, m.kpis.picked, m.kpis.shipped, m.kpis.printed, m.kpis.mraDone, m.kpis.mraFailed, m.kpis.mraNone, m.kpis.pickers, m.kpis.noPicker], [3, 2, 2, 2, 1, 1, 2, 2, 1], 'kpis: stages, MRA, pickers (row 2 and 4 never sent)');
eq([m.kpis.pendingCancel, m.kpis.orderErrors, m.kpis.amount], [2, 1, 350], 'kpis: findings and amount');
eq(m.score, Math.round((75 + 50 + 50 + 50 + 25) / 5), 'readiness score = average of the five stage percentages');
eq(m.trips.map(t => [t.trip_id, t.orders, t.pickers, t.noPicker, t.lines, t.cancelledLines, t.pendingCancel, t.errors, t.readiness]), [['8223', 3, 'Ravi, Sam', 0, 4, 1, 0, 1, 67], ['8224', 1, '', 1, 2, 0, 2, 0, 0]], 'per trip');
eq(m.pickers.map(p => [p.name, p.orders, p.picked, p.trips, p.lines, p.firstAssigned]), [['Ravi', 2, 2, 1, 3, '2026-10-09 06:11'], ['Sam', 1, 0, 1, 1, '2026-10-09 06:12']], 'per picker (lines from the order lines, first assignment)');
eq(m.orderTypes, [{ name: 'ORD', n: 3 }, { name: 'SPOS', n: 1 }], 'order types');
eq(m.lineStatuses.map(x => x.status + ':' + x.n), ['Awaiting Shipping:2', 'Cancelled:1', 'Closed:1', 'Scheduled:1', 'Shipped:1'], 'line statuses');
eq([m.mra.done, m.mra.failed, m.mra.none, m.mra.pct, m.mra.reasons[0].reason, m.mra.tries, m.mra.ok, m.mra.fail, m.mra.gw], [1, 1, 2, 25, 'VAT number missing', 6, 5, 1, 1], 'MRA: statuses of the orders + the tries of the day');
eq(m.mra.byUser.map(u => [u.name, u.tries, u.ok, u.failed]), [['javeed', 4, 3, 1], ['khalid', 2, 2, 0]], 'MRA tries by user');
eq([m.cancels.lines, m.cancels.done, m.cancels.failed, m.cancels.runs, m.cancels.orders], [2, 1, 1, 1, 2], 'cancel ledger: WOULD / RUN rows not counted as lines');
eq([m.prints.total, m.prints.printed, m.prints.failed, m.prints.pending], [4, 3, 1, 0], 'print queue');
eq(m.issues.map(i => i.kind), ['Order errors', 'MRA failed', 'Pending cancellations', 'No picker', 'Cancellations failed', 'Print failed', 'MRA gateway', 'Read error'], 'issues in order');
eq(m.users.map(u => u.name), ['javeed', 'Khalid'], 'people ranked by what they did (case-insensitive merge)');
ok(/45 actions on trip-management, mra-interface \(08:02–17:30\) · 4 MRA tries \(3 ok, 1 failed\) · 1 line cancelled, 1 failed · 2 actual ship dates/.test(m.users[0].did), 'javeed did', m.users[0].did);
ok(/12 actions on pick-release \(07:00–09:00\) · 2 MRA tries \(2 ok\) · pick_release_page ×2 · 1 trip pinned/.test(m.users[1].did), 'khalid did (only the pin on a trip of the day counts)', m.users[1].did);
eq(m.users[0].actions, [{ target: 'Fetch Trips', n: 20 }, { target: 'Print', n: 10 }], 'top actions');
eq([m.timeline.first, m.timeline.last, m.timeline.peak, m.timeline.peakTotal, m.timeline.hours[9].mra], ['08:00', '17:59', '09:00', 34, 4], 'timeline');
const nar = m.narrative;
ok(/^Friday 9 October 2026 on PROD: 2 trips carried 4 sales orders plus 2 store \/ van transfers \(1 cancelled order left out\), 6 order lines, 350 in order value\. The busiest trip was 8223 \(L8223\) with 3 orders\. Overall readiness is 50 %/.test(nar.paragraphs[0].text), 'overview sentence', nar.paragraphs[0].text);
ok(/2 pickers worked the day — Ravi 2 orders, Sam 1 order\. 3 of 4 orders \(75 %\) were released and 2 \(50 %\) pick-confirmed; 1 order had no picker\./.test(nar.paragraphs[1].text), 'picking sentence', nar.paragraphs[1].text);
ok(/1 of 4 orders \(25 %\) are interfaced to MRA, 1 failed — mostly "VAT number missing", 2 not sent yet\. 6 MRA tries were made on the day \(5 ok, 1 failed, 1 gateway problem\) by javeed ×4, khalid ×2\./.test(nar.paragraphs[3].text), 'MRA sentence', nar.paragraphs[3].text);
ok(/1 line on 1 order are cancelled on the trips\. The cancellation runs of the day sent 2 lines \(1 done, 1 failed\) — javeed 2\. 2 lines still wait for cancellation\./.test(nar.paragraphs[4].text), 'cancellations sentence', nar.paragraphs[4].text);
eq(nar.paragraphs.map(p => p.title), ['Overview', 'Picking', 'Shipping & printing', 'MRA', 'Cancellations', 'Needs attention', 'People', 'Timeline'], 'paragraph order');
eq(nar.lowlights, ['only 25 % interfaced to MRA', '1 MRA failure', '1 order without a picker', '1 order error', '2 lines pending cancellation', '1 cancellation failed'], 'lowlights');
eq(nar.highlights, ['1 line cancelled automatically'], 'highlights');
eq(nar.headline, 'Half way — work still open', 'headline from the score');
// an empty day
const e = E.model({ pod: 'TEST', date: '2026-10-10' });
eq([e.kpis.trips, e.kpis.orders, e.score, e.narrative.headline, e.issues.length], [0, 0, null, 'Nothing planned', 0], 'empty day');
ok(/Nothing was planned for Saturday 10 October 2026 on TEST/.test(e.narrative.paragraphs[0].text), 'empty overview');
ok(/^DAY DEBRIEF — Friday 9 October 2026 · PROD · built 2026-10-09 18:00\n/.test(E.text(m)) && /PICKERS\n  Ravi: 2 orders on 1 trip, picked 2 \(100 %\), shipped 2, 3 lines/.test(E.text(m)), 'plain text', E.text(m).slice(0, 300));
console.log((bad ? 'FAILED ' + bad + ' of ' : 'ok ') + n + ' debrief-engine checks');
process.exit(bad ? 1 : 0);
