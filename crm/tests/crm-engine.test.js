// node crm/tests/crm-engine.test.js — the CRM engine (no host, no APEX, no Fusion)
'use strict';
var E = require('../crm-engine.js');
var n = 0, bad = 0;
function ok(c, m) { n++; if (!c) { bad++; console.log('FAIL ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' — got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

// business hours: Mon–Fri 08–17, Sat 08–12
var H = E.DEFAULTS.hours;
eq(E.stamp(E.addWorkMinutes('2026-10-05 16:30', 60, H)), '2026-10-06 08:30', 'Monday 16:30 + 1 h → Tuesday 08:30');
eq(E.stamp(E.addWorkMinutes('2026-10-10 11:00', 120, H)), '2026-10-12 09:00', 'Saturday 11:00 + 2 h → Monday 09:00 (Sat closes 12:00, Sunday closed)');
eq(E.stamp(E.addWorkMinutes('2026-10-04 10:00', 30, H)), '2026-10-05 08:30', 'Sunday → Monday morning');
eq(E.workMinutes('2026-10-05 16:00', '2026-10-06 09:00', H), 120, 'working minutes over a night');
var H2 = Object.assign({}, H, { holidays: ['2026-10-06'] });
eq(E.stamp(E.addWorkMinutes('2026-10-05 16:30', 60, H2)), '2026-10-07 08:30', 'a holiday is skipped');
var due = E.slaDue('2026-10-05 09:00', 'P1');
eq(E.stamp(due.first), '2026-10-05 10:00', 'P1 first reply in 1 working hour');
eq(E.stamp(due.resolve), '2026-10-05 17:00', 'P1 resolved in 8 working hours');
eq(E.stamp(E.shiftDue('2026-10-05 17:00', '2026-10-05 10:00', '2026-10-05 12:00', H)), '2026-10-06 10:00', 'two hours waiting for the customer move the due date');

// SLA state
var t = { STATUS: 'OPEN', PRIORITY: 'P2', CREATED_AT: '2026-10-05 09:00', DUE_FIRST: '2026-10-05 13:00', DUE_RESOLVE: '2026-10-07 15:00' };
eq(E.sla(t, '2026-10-05 12:30').state, 'risk', 'half an hour before the first-reply due date = at risk');
eq(E.sla(t, '2026-10-05 14:00').state, 'breached', 'after it = breached');
ok(/first reply overdue 1 h/.test(E.sla(t, '2026-10-05 14:00').label), 'label names the first reply');
t.FIRST_RESPONSE_AT = '2026-10-05 10:00';
eq(E.sla(t, '2026-10-05 14:00').state, 'ok', 'replied in time → ok');
eq(E.sla(Object.assign({}, t, { STATUS: 'PENDING_CUSTOMER' }), '2026-10-06 10:00').state, 'paused', 'waiting for the customer = paused');
eq(E.sla(Object.assign({}, t, { STATUS: 'RESOLVED', RESOLVED_AT: '2026-10-06 10:00' }), '2026-10-09 10:00').state, 'met', 'resolved in time = met');
eq(E.sla(Object.assign({}, t, { STATUS: 'RESOLVED', RESOLVED_AT: '2026-10-08 10:00' }), '2026-10-09 10:00').state, 'missed', 'resolved late = missed');
ok(E.canMove('RESOLVED', 'OPEN') && !E.canMove('CLOSED', 'RESOLVED'), 'transitions');

// routing
var setup = E.setup({ agents: [{ user: 'amy', queues: ['Accounts'] }, { user: 'bob', queues: ['Accounts'] }, { user: 'cid', queues: ['Logistics'] }] });
var r = E.route({ SUBJECT: 'Invoice is wrong', CATEGORY: 'Billing', PRIORITY: 'P3' }, setup, { amy: 4, bob: 1 });
eq([r.queue, r.assignee], ['Accounts', 'bob'], 'billing → Accounts, least busy agent');
r = E.route({ SUBJECT: 'URGENT no stock for tomorrow', CATEGORY: 'Delivery', PRIORITY: 'P3' }, setup, {});
eq([r.priority, r.queue, r.assignee], ['P2', 'Logistics', 'cid'], 'urgent words raise the priority, category queue');
eq(E.setup({ phone: { record: true } }).phone.country, '230', 'saved setup keeps the defaults it does not name');

// phones
eq(E.phone('5712 3456').e164, '+23057123456', 'Mauritius mobile');
eq(E.phone('+230 212-3456').display, '+230 212 3456', 'fixed line display');
eq(E.phone('00230 5712 3456').digits, '23057123456', '00 prefix');
ok(E.samePhone('57123456', '+230 5712 3456'), 'same number in two forms');
var hits = E.phoneLookup('+230 57123456', [{ phone: '5712 3456 / 212 0000', account: 'A1', name: 'Shop' }, { phone: '57999999', account: 'A2' }]);
eq(hits.map(function (h) { return h.account; }), ['A1'], 'phone lookup finds the customer with one of several numbers');

// health
var h = E.health({ ar: { total: 1000, overdue: 800, aging: { d90p: 500 } }, tickets: [{ STATUS: 'OPEN', PRIORITY: 'P1', DUE_RESOLVE: '2026-01-01 10:00' }], disputes: 1, creditHold: true, sales: { m12: 500, prev12: 1000 }, lastContact: '2026-01-01', now: '2026-10-05' });
ok(h.score < 40 && h.band.key === 'risk', 'a customer with old debt, an overdue P1, a dispute and falling sales is at risk (' + h.score + ')');
ok(h.why.length >= 6, 'with the reasons');
eq(E.health({ ar: { total: 1000, overdue: 0 }, tickets: [], sales: { m12: 1300, prev12: 1000 }, lastContact: '2026-10-01', now: '2026-10-05' }).band.key, 'good', 'a good customer is healthy');

// timeline
var tl = E.timeline({ tickets: [{ TICKET_ID: 't1', TICKET_NO: 'CS-000001', SUBJECT: 'Late', CREATED_AT: '2026-10-02 10:00', STATUS: 'OPEN' }], calls: [{ CALL_ID: 'c1', DIRECTION: 'IN', STARTED_AT: '2026-10-03 09:00', OUTCOME: 'ANSWERED', DURATION_S: 75 }], stmts: [{ STMT_ID: 's1', STMT_DATE: '2026-09-30', STATUS: 'SENT', SENT_AT: '2026-10-01 08:00' }], orders: [{ ORDER_NUMBER: '123', ORDERED: '2026-09-15' }] });
eq(tl.map(function (x) { return x.kind; }), ['CALL', 'TICKET', 'STATEMENT', 'ORDER'], 'timeline newest first across every source');
ok(/1:15/.test(tl[0].title), 'call duration');

// KPIs
var k = E.ticketKpis([{ STATUS: 'OPEN', PRIORITY: 'P1', ASSIGNED_TO: 'amy', DUE_FIRST: '2026-10-05 10:00', DUE_RESOLVE: '2026-10-05 17:00', CREATED_AT: '2026-10-05 09:00' }, { STATUS: 'NEW', PRIORITY: 'P3', CREATED_AT: '2026-10-05 09:30', DUE_RESOLVE: '2026-10-09 09:00' }, { STATUS: 'RESOLVED', CREATED_AT: '2026-10-01 09:00', RESOLVED_AT: '2026-10-05 08:00' }], '2026-10-05 11:00', 'AMY');
eq([k.open, k.unassigned, k.mine, k.breached, k.p1, k.newToday, k.resolvedToday, k.dueToday], [2, 1, 1, 1, 1, 2, 1, 1], 'ticket KPIs');
var st = E.slaStats([{ STATUS: 'RESOLVED', CREATED_AT: '2026-10-05 09:00', FIRST_RESPONSE_AT: '2026-10-05 09:30', RESOLVED_AT: '2026-10-05 12:00', DUE_RESOLVE: '2026-10-05 17:00', DUE_FIRST: '2026-10-05 10:00', CSAT: 5, CATEGORY: 'Billing' }], H);
eq([st.metPct, st.avgFirst, st.avgResolve, st.csat], [100, 30, 180, 5], 'SLA stats');

// learning
var m = E.nbTrain([{ text: 'invoice price wrong credit note', label: 'Billing' }, { text: 'invoice amount differs from quote', label: 'Billing' }, { text: 'delivery late truck did not come', label: 'Delivery' }, { text: 'goods damaged on delivery', label: 'Delivery' }]);
eq(E.nbPredict(m, 'the truck is late again')[0].label, 'Delivery', 'naive Bayes: delivery');
eq(E.nbPredict(m, 'wrong price on my invoice')[0].label, 'Billing', 'naive Bayes: billing');
var sim = E.similar('price on invoice is wrong', [{ TICKET_ID: 'a', SUBJECT: 'Wrong price on invoice', RESOLUTION: 'Credit note issued' }, { TICKET_ID: 'b', SUBJECT: 'Truck late' }]);
eq(sim.map(function (x) { return x.t.TICKET_ID; }), ['a'], 'similar tickets');

// ask
eq(E.ask('CS-000123').intent, 'ticket', 'a ticket number');
eq(E.ask('ticket 45').ticket, '45', 'ticket N');
eq(E.ask('show my tickets').intent, 'tickets_mine', 'my tickets');
eq(E.ask('which tickets are past the SLA').intent, 'tickets_breached', 'breached tickets');
var a = E.ask('last statement of Super U Grand Baie');
eq([a.intent, a.customer], ['last_statement', 'Super U Grand Baie'], 'last statement of a customer');
a = E.ask('send statement to 1002');
eq([a.intent, a.customer], ['send_statement', '1002'], 'send a statement');
a = E.ask('how much does Winners owe');
eq([a.intent, a.customer], ['balance', 'Winners'], 'balance');
eq(E.ask('+230 5712 3456').intent, 'phone', 'a phone number');
eq(E.ask('callbacks').intent, 'callbacks', 'callbacks');
eq(E.ask('Jumbo').intent, 'search', 'anything else = search');

// SQL is read-only and quotes its values
var all = [].concat(E.sql.orders("A'1", '300000003234003'), E.sql.invoices('A1', 'x'), E.sql.receipts('A1', 1), E.sql.items('A1'), E.sql.stock(['1', 'x', '22']), E.sql.contacts('A1'), E.sql.phone('57123456'), E.sql.salesByMonth('A1', 2));
ok(all.every(function (s) { return /^\s*SELECT\b/i.test(s) && !/\b(UPDATE|DELETE|INSERT|MERGE|DROP)\b/i.test(s); }), 'every 360 query is a SELECT');
ok(E.sql.orders("A'1", 1)[0].indexOf("'A''1'") > 0, 'account numbers are quoted');
var oa = E.sql.orders('A1', 1);
ok(oa[0].indexOf('transactional_currency_code') > 0 && oa.join('').indexOf('transactional_curr_code ') < 0, 'orders: the currency column is TRANSACTIONAL_CURRENCY_CODE');
ok(oa[oa.length - 1].indexOf('currency') < 0 && oa[oa.length - 1].indexOf('submitted_flag') < 0, 'orders: the last alternative has no fragile column');
ok(E.sql.invoices('A1', "1 OR 1=1")[0].indexOf('t.org_id = 0') > 0, 'a business unit id that is not digits becomes 0');
ok(E.sql.stock(['1', 'x', '22'])[0].indexOf('IN (1, 22)') > 0, 'only digit item ids');
var tr = E.salesTrend([{ MONTH: '2026-10', AMOUNT: 100 }, { MONTH: '2025-10', AMOUNT: 50 }, { MONTH: '2025-09', AMOUNT: 70 }], '2026-10-05');
eq([tr.m12, tr.prev12, tr.series.length], [100, 120, 24], 'sales trend: last 12 vs the 12 before');
eq(E.fill('Hi {CONTACT}, {TICKET_NO}', E.vars({ ticket: { TICKET_NO: 'CS-000007', CONTACT_NAME: 'Ravi' } })), 'Hi Ravi, CS-000007', 'canned reply variables');
ok(E.emailHtml('a <b>\n\nx', { ticketLink: 'https://x/y', ticketNo: 'CS-1' }).indexOf('&lt;b&gt;') > 0, 'e-mail body escapes');
eq(E.ticketNo('CS-', 42), 'CS-000042', 'ticket number');

// customer master pages: keyset, changes since, quoting
var cp = E.sql.customersPage(123, '2026-10-01 08:00:00', 500);
ok(cp.length === 3 && cp.every(function (x) { return x.indexOf('ca.cust_account_id > 123') > 0 && x.indexOf('FETCH FIRST 500 ROWS ONLY') > 0 && x.indexOf("TO_DATE('2026-10-01 08:00:00'") > 0; }), 'customer pages: keyset + changed since');
ok(E.sql.customersPage("1 OR 1=1", "x'; DROP")[0].indexOf('> 0') > 0 && E.sql.customersPage(0, "x'; DROP")[0].indexOf('DROP') < 0, 'customer pages: id digits only, a bad date is left out');
var cr = E.custRow({ ACCOUNT_NUMBER: 'A1', CUSTOMER: 'Pick & Buy', PHONE: '+230 5712-3456', EMAIL: 'X@y.mu' }, 'PROD');
eq([cr.pod, cr.phone_digits, cr.hay.indexOf('pick & buy') >= 0], ['PROD', '23057123456', true], 'customer row: phone digits + search text');
var cw = E.custWhere("pick o'neil", function (v) { return "'" + v.replace(/'/g, "''") + "'"; });
ok(cw === "hay LIKE '%pick%' AND hay LIKE '%o''neil%'", 'customer search WHERE', cw);
ok(E.custWhere('5712 3456', function (v) { return "'" + v + "'"; }).indexOf('phone_digits') < 0 && E.custWhere('57123456', function (v) { return "'" + v + "'"; }).indexOf("phone_digits LIKE '%7123456%'") > 0, 'a phone number also matches the digits');

// AR 360 + rating
var ar = E.ar360({
    trx: [{ TRX_DATE: '2026-09-01', CLASS: 'INV', AMOUNT: 1000 }, { TRX_DATE: '2026-09-05', CLASS: 'CM', AMOUNT: -100 }, { TRX_DATE: '2024-01-01', CLASS: 'INV', AMOUNT: 999 }],
    apps: [{ APP_TYPE: 'CASH', APPLY_DATE: '2026-09-20', AMOUNT_APPLIED: 600, DAYS_LATE: 10, DAYS_TO_PAY: 40 }, { APP_TYPE: 'CASH', APPLY_DATE: '2026-03-01', AMOUNT_APPLIED: 200, DAYS_LATE: 0, DAYS_TO_PAY: 30 }, { APP_TYPE: 'CM', APPLY_DATE: '2026-09-06', AMOUNT_APPLIED: 100 }],
    receipts: [{ RECEIPT_DATE: '2026-08-01', AMOUNT: 50, REVERSAL_DATE: '2026-08-03', REVERSAL_CATEGORY: 'NSF' }, { RECEIPT_DATE: '2026-08-02', AMOUNT: 600, STATUS: 'APP' }],
    open: [{ REMAINING: 300, DAYS_LATE: 20 }, { REMAINING: 100, DAYS_LATE: 120 }, { REMAINING: 100, DAYS_LATE: 0 }]
}, '2026-10-10');
eq([ar.invoiced12, ar.credits12, ar.collected12, ar.bounced.length, ar.daysLate, ar.daysToPay, ar.balance, ar.overdue, ar.over90], [1000, 100, 800, 1, 8, 38, 500, 400, 100], 'AR 360 totals');
eq(E.reversalLabel(ar.bounced[0]), 'Bounced (insufficient funds)', 'a bounced cheque');
eq(ar.months.length, 24, '24 months');
ok(ar.rating.score >= 0 && ar.rating.score <= 100 && 'ABCDE'.indexOf(ar.rating.grade) >= 0 && ar.rating.factors.length === 6, 'rating with 6 factors', ar.rating);
var good = E.arRating({ invoiced: 1000, collected: 1000, credits: 0, daysLate: 0, trend: -3, balance: 100, overdue: 0, over90: 0, bounced: 0 });
var poor = E.arRating({ invoiced: 1000, collected: 300, credits: 300, daysLate: 60, trend: 20, balance: 900, overdue: 800, over90: 600, bounced: 3 });
eq([good.grade, poor.grade], ['A', 'E'], 'grades A and E');
eq(E.arRating({ invoiced: 1, collected: 1, balance: 100, overdue: 0, over90: 0, creditLimit: 50 }).factors.length, 7, 'credit limit adds a factor');

// drill-downs: never the subledger accounting tables (they made a drill take minutes)
ok(Object.keys(E.DRILLS).every(function (k) { return E.DRILLS[k].parts.every(function (p) { return !/xla_|gl_code_combinations/i.test(p.sql) && /^\s*SELECT\b/i.test(p.sql); }); }), 'no XLA / journal in a CRM drill');

// items & categories: last 12 months vs the 12 before
var ir = [
    { MONTH: '2025-09', ITEM: 'RICE5', DESCRIPTION: 'Rice 5kg', CATEGORY: 'Grocery', QTY: 10, AMOUNT: 1000, ORDERS: 2 },
    { MONTH: '2026-09', ITEM: 'RICE5', CATEGORY: 'Grocery', QTY: 5, AMOUNT: 500, ORDERS: 1 },
    { MONTH: '2025-06', ITEM: 'OIL1', CATEGORY: 'Grocery', QTY: 8, AMOUNT: 800, ORDERS: 1 },
    { MONTH: '2026-08', ITEM: 'JUICE', CATEGORY: 'Beverages', QTY: 20, AMOUNT: 2000, ORDERS: 3 },
    { MONTH: '2025-01', ITEM: 'SOAP', CATEGORY: 'Household', QTY: 4, AMOUNT: 400, ORDERS: 1 },
    { MONTH: '2026-02', ITEM: 'SOAP', CATEGORY: 'Household', QTY: 1, AMOUNT: 100, ORDERS: 1 }
];
var tr2 = E.itemTrends(ir, '2026-10-10', 'CATEGORY');
var byI = {}; tr2.items.forEach(function (x) { byI[x.item] = x; });
eq([tr2.total.now, tr2.total.prev, byI.JUICE.trend, byI.OIL1.trend, byI.SOAP.trend, byI.RICE5.trend], [2600, 2200, 'NEW', 'STOPPED', 'SLOWING', 'DECLINING'], 'item trends');
eq([tr2.items[0].item, tr2.categories[0].category, tr2.categories[0].shareNow], ['JUICE', 'Beverages', 76.9], 'top item + top category share');
ok(tr2.insights.some(function (x) { return /Mix shift: Beverages up/.test(x.text); }) && tr2.insights.some(function (x) { return /Not bought lately/.test(x.text); }), 'insights: mix shift, not bought lately', tr2.insights);
// group by the item DFF: ATTRIBUTE1 = profit centre, ATTRIBUTE2 = supplier
ir.forEach(function (r) { r.PROFIT_CENTER = r.ITEM === 'JUICE' ? 'PC-DRINKS' : 'PC-FOOD'; r.SUPPLIER = r.ITEM === 'SOAP' ? '' : 'Unilever'; });
var tp = E.itemTrends(ir, '2026-10-10'), ts = E.itemTrends(ir, '2026-10-10', 'SUPPLIER');
eq([tp.dim.label, tp.categories[0].category, tp.categories.length, ts.categories.map(function (x) { return x.category; }).sort().join(','), ts.filled], ['Profit centre', 'PC-DRINKS', 2, '(no supplier),Unilever', 1], 'profit centre (default) + supplier groups');
var tpi = {}; tp.items.forEach(function (x) { tpi[x.item] = x; });
eq([tpi.JUICE.group, tpi.JUICE.supplier, tpi.JUICE.category], ['PC-DRINKS', 'Unilever', 'Beverages'], 'items carry every dimension');
var si = E.sql.salesItems('A1', 1, 24);
ok(/MAX\(i\.attribute1\) AS profit_center, MAX\(i\.attribute2\) AS supplier/.test(si[0]) && /egp_item_categories/.test(si[0]) && !/attribute/.test(si[si.length - 1]), 'sales items SQL: DFF first, plain last');
ok(/i\.attribute7\) AS profit_center/.test(E.sql.salesItems('A1', 1, 24, { profitCenter: 'attribute7', supplier: 'x; drop' })[0]) && /MAX\(''\) AS supplier/.test(E.sql.salesItems('A1', 1, 24, { profitCenter: 'attribute7', supplier: 'x; drop' })[0]), 'DFF columns from setup, unsafe ones dropped');
eq([E.dffCol('attribute_char3'), E.dffCol('SEGMENT1'), E.setup({ itemDff: { supplier: 'ATTRIBUTE5' } }).itemDff.profitCenter], ['ATTRIBUTE_CHAR3', '', 'ATTRIBUTE1'], 'dffCol + setup merge');
ok(E.sql.salesItems("A'1", 1).every(function (x) { return x.indexOf("'A''1'") > 0 && /GROUP BY TO_CHAR/.test(x); }), 'sales items SQL');

console.log((n - bad) + ' / ' + n + ' passed');
if (bad) process.exit(1);
