// node crm/tests/crm-growth.test.js — the CRM growth engine: signals, rules, playbooks, wallboard (no host, no APEX, no Fusion)
'use strict';
var G = require('../crm-growth-engine.js');
var n = 0, bad = 0;
function ok(c, m) { n++; if (!c) { bad++; console.log('FAIL ' + m); } }
function eq(a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m + ' — got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
var NOW = '2026-10-11 10:00';

// a portfolio row: M0 = this month … M23
function acct(no, name, monthly, opts) {
    var r = { ACCOUNT_NUMBER: no, CUSTOMER: name, CLASS: (opts || {}).cls || '', LAST_ORDER: (opts || {}).last || '2026-10-05', DAYS12: (opts || {}).days12 || 24, ORD12: 30 };
    for (var k = 0; k < 24; k++) r['M' + k] = typeof monthly === 'function' ? monthly(k) : monthly;
    return r;
}

// ── churn: the customer's own normal ──
var steady = acct('100', 'Steady Ltd', 10000);
eq(G.churn(steady, NOW), null, 'steady buying = no signal');
var dropping = acct('200', 'Dropping Ltd', function (k) { return k >= 1 && k <= 3 ? 3000 : 10000; });
var c = G.churn(dropping, NOW);
ok(c && c.kind === 'CHURN', 'last 3 months at 30 % of normal = churn');
eq(c.data.drop, 70, 'drop measured as 70 %');
eq(c.value, 84000, 'money at stake = (10,000 − 3,000) × 12');
eq(c.key, 'CHURN|200|2026-10', 'one churn signal per account and month');
ok(/70 % down/.test(c.detail), 'the reason names the drop');
var small = acct('300', 'Tiny', function (k) { return k >= 1 && k <= 3 ? 0 : 200; });
eq(G.churn(small, NOW), null, 'below the minimum normal → ignored');
var gap = acct('400', 'Gone quiet', 10000, { last: '2026-07-01', days12: 26 });
var g2 = G.churn(gap, NOW);
ok(g2 && /no order for 102 days/.test(g2.detail) && /every 14 days/.test(g2.detail), 'no order for far longer than the usual gap = churn even when the months still look normal');
var newish = acct('500', 'New', function (k) { return k <= 5 ? 5000 : 0; });
eq(G.churn(newish, NOW), null, 'fewer than 4 active months in the base = too new to judge');
ok(G.churn(dropping, NOW, Object.assign({}, G.DEFAULTS.rules.CHURN, { dropPct: 80 })) === null, 'a stricter rule (80 %) keeps a 70 % drop out');
eq(G.series(dropping).length, 24, '24 months');
eq(G.series(dropping)[23], 10000, 'series ends with this month (M0)');

// ── lapsed ranges ──
var lp = G.lapsed('200', 'Dropping Ltd', [
    { GRP: 'BEVERAGES', PREV12: 20000, NOW12: 0, LAST3: 0, LAST_MONTH: '2025-09' },
    { GRP: 'SNACKS', PREV12: 10000, NOW12: 2000, LAST3: 0, LAST_MONTH: '2026-05' },
    { GRP: 'DAIRY', PREV12: 10000, NOW12: 9000, LAST3: 2000 },
    { GRP: 'TINY', PREV12: 100, NOW12: 0, LAST3: 0 },
    { GRP: '(none)', PREV12: 99999, NOW12: 0 }
], NOW, null, 'Profit centre');
eq(lp.map(function (x) { return x.data.group; }), ['BEVERAGES', 'SNACKS'], 'stopped + slowed (≥ 70 % down, nothing in 3 months); steady, tiny and blank left out');
ok(/^Stopped buying BEVERAGES/.test(lp[0].title) && /^Hardly buying SNACKS/.test(lp[1].title), 'titles say stopped / hardly');
eq(lp[0].value, 20000, 'at stake = what they bought before');
ok(lp[0].score > lp[1].score, 'stopped scores above slowed');

// ── whitespace: peers by class ──
var accounts = [], groups = [];
for (var i = 0; i < 6; i++) {
    accounts.push({ ACCOUNT_NUMBER: 'S' + i, CUSTOMER: 'Shop ' + i, CLASS: 'RETAIL', total12: 100000 });
    groups.push({ ACCOUNT_NUMBER: 'S' + i, GRP: 'BEVERAGES', NOW12: 40000, PREV12: 30000 });
    if (i > 0) groups.push({ ACCOUNT_NUMBER: 'S' + i, GRP: 'SNACKS', NOW12: 10000, PREV12: 0 });
    if (i === 1) groups.push({ ACCOUNT_NUMBER: 'S1', GRP: 'RARE', NOW12: 5000 });
}
accounts.push({ ACCOUNT_NUMBER: 'H1', CUSTOMER: 'Hotel', CLASS: 'HOTEL', total12: 50000 });
var ws = G.whitespace(accounts, groups, null, 'Profit centre');
eq(ws.map(function (x) { return x.account + ':' + x.data.group; }), ['S0:SNACKS'], 'S0 is the only shop of 6 not buying SNACKS (5 of 6 = 83 %); RARE (1 of 6) and the lone hotel class give nothing');
eq(ws[0].data.share, 83, 'penetration among peers');
eq(ws[0].value, 10000, 'expected value = median peer spend × size ratio');
ok(/class RETAIL/.test(ws[0].detail), 'detail names the peer group');
var wsBand = G.whitespace(accounts.map(function (a) { return Object.assign({}, a, { CLASS: '' }); }), groups, Object.assign({}, G.DEFAULTS.rules.WHITESPACE, { minPeers: 3 }));
ok(wsBand.some(function (x) { return x.account === 'S0' && /size band/.test(x.detail); }), 'without a class the peers are the size band');
eq(G.bandOf(0, [1, 2, 3]), 'none', 'no sales = no band');
eq(G.bands([10, 20, 30, 40]), [20, 30, 40], 'quartile cut-offs');

// ── service signals ──
var b = G.bounced([{ CASH_RECEIPT_ID: 77, RECEIPT_NUMBER: 'R-1', ACCOUNT_NUMBER: '200', CUSTOMER: 'Dropping Ltd', AMOUNT: 15000, CURRENCY: 'MUR', REVERSAL_DATE: '2026-10-09', REVERSAL_CATEGORY: 'NSF' }, { RECEIPT_NUMBER: 'R-2', AMOUNT: 5 }]);
eq(b.length, 1, 'a receipt without a customer is left out');
eq(b[0].key, 'BOUNCED|77', 'keyed by the receipt id');
ok(/insufficient funds/.test(b[0].detail), 'NSF in plain words');
var m = G.mra([{ ORDER_NUMBER: 'SO1', CUSTOMER_NUMBER: '200', CUSTOMER_NAME: 'Dropping Ltd', TRIP_ID: '8223', ORDER_AMOUNT: 4000, FAILED_REASON: 'BRN missing', TRIES: 3 }]);
ok(m[0].key === 'MRA|SO1' && /failed 3 times/.test(m[0].detail) && /BRN missing/.test(m[0].detail), 'MRA failure with the tries and the reason');
var cx = G.cancels([{ ORDER_NUMBER: 'SO2', ACCOUNT_NUMBER: ' 300 ', ACCOUNT_NAME: 'Tiny', TRIP_ID: '9', LINES: 2, ITEM: 'COLA' }, { ORDER_NUMBER: 'SO3', ACCOUNT_NUMBER: '', LINES: 4 }]);
ok(cx.length === 1 && cx[0].account === '300' && /^2 lines cancelled/.test(cx[0].title), 'cancelled lines of a customer, the account trimmed');

// ── the scan ──
var settings = G.settings(null);
var all = G.scan({ portfolio: [steady, dropping, gap], groups: [{ ACCOUNT_NUMBER: '200', GRP: 'BEVERAGES', PREV12: 20000, NOW12: 0, LAST3: 0 }], bounced: [{ CASH_RECEIPT_ID: 77, ACCOUNT_NUMBER: '200', AMOUNT: 15000 }], mra: [], cancels: [], now: NOW, settings: settings });
eq(all.map(function (x) { return x.kind; }).sort(), ['BOUNCED', 'CHURN', 'CHURN', 'LAPSED'], 'churn × 2 + lapsed + bounced');
ok(all[0].score >= all[all.length - 1].score, 'best first');
var off = G.settings({ rules: { CHURN: { on: false } } });
ok(G.scan({ portfolio: [dropping], now: NOW, settings: off }).length === 0, 'a kind switched off gives nothing');
eq(off.rules.CHURN.dropPct, 40, 'saved rules keep the defaults they do not set');
eq(G.settings({ rules: { CHURN: { dropPct: 55 } } }).rules.CHURN.on, true, 'a partial rule keeps on');

// actions
eq(G.actionFor(c, settings), { action: 'PLAYBOOK', playbook: 'winback' }, 'churn starts the win-back playbook');
eq(G.actionFor(Object.assign({}, c, { score: 10 }), settings), { action: 'NONE' }, 'below minScore = worklist only');
eq(G.actionFor(lp[0], settings).action, 'NONE', 'lapsed = worklist by default');
eq(G.actionFor(cx[0], settings), { action: 'TASK', playbook: 'service' }, 'cancelled lines = a follow-up task');

// merge with what APEX holds
var stored = [{ SIGNAL_KEY: 'CHURN|200|2026-10', STATUS: 'NEW', KIND: 'CHURN' }, { SIGNAL_KEY: 'LAPSED|9|X', STATUS: 'OPEN', KIND: 'LAPSED' }, { SIGNAL_KEY: 'LAPSED|8|Y', STATUS: 'DISMISSED', KIND: 'LAPSED' }];
var mg = G.merge(all, stored);
eq(mg.touch.map(function (x) { return x.key; }), ['CHURN|200|2026-10'], 'a signal already in APEX is touched, not added');
eq(mg.add.length, 3, 'the others are new');
eq(mg.gone.map(function (r) { return r.SIGNAL_KEY; }), ['LAPSED|9|X'], 'an open signal the scan no longer finds is gone; a dismissed one stays as it is');

// live / summary / byAccount
ok(G.isLive({ STATUS: 'SNOOZED', SNOOZE_UNTIL: '2026-10-11' }, NOW), 'a snooze that ends today wakes up');
ok(!G.isLive({ STATUS: 'SNOOZED', SNOOZE_UNTIL: '2026-10-20' }, NOW), 'a snooze in the future stays asleep');
ok(!G.isLive({ STATUS: 'DONE' }, NOW), 'done is not live');
var rows = [{ STATUS: 'NEW', KIND: 'CHURN', VALUE: 100, ACCOUNT_NUMBER: 'A', SCORE: 20 }, { STATUS: 'OPEN', KIND: 'CHURN', VALUE: 50, ACCOUNT_NUMBER: 'A', SCORE: 60 }, { STATUS: 'DONE', KIND: 'LAPSED', VALUE: 999, ACCOUNT_NUMBER: 'B' }];
var su = G.summary(rows, NOW);
ok(su.open === 2 && su.value === 150 && su.newN === 1 && su.byKind.CHURN.n === 2, 'summary of the live ones');
var ba = G.byAccount(rows, NOW);
ok(ba.A.length === 2 && ba.A[0].SCORE === 60 && !ba.B, 'by account, best first, closed left out');

// ── playbooks ──
var pb = G.playbook(settings, 'winback');
ok(pb && pb.steps.length === 4 && pb.stopOnOrder, 'the seed win-back playbook');
var play = { PLAY_ID: 'P1', STATUS: 'ACTIVE', STEP_N: 0, STARTED_AT: '2026-10-11 08:00', OWNER: 'amy', ACCOUNT_NUMBER: '200', ACCOUNT_NAME: 'Dropping Ltd', PLAYBOOK_NAME: pb.name, STEPS_JSON: JSON.stringify(pb.steps) };
var ps = G.playState(play, NOW);
ok(ps.step.kind === 'CALL' && ps.due === '2026-10-11 09:00' && ps.dueNow && ps.today && !ps.late, 'step 1 due today 09:00');
ps = G.playState(Object.assign({}, play, { STEP_N: 1, LAST_DONE_AT: '2026-10-11 09:30' }), NOW);
ok(ps.step.kind === 'EMAIL' && ps.due === '2026-10-13 09:00' && !ps.dueNow, 'step 2 on day 2');
ps = G.playState(Object.assign({}, play, { STEP_N: 1, STARTED_AT: '2026-10-01 08:00', LAST_DONE_AT: '2026-10-08 15:00' }), NOW);
ok(ps.due === '2026-10-08 15:00' && ps.late && ps.days === 3, 'a step is never due before the previous one was done — then late by 3 days');
ps = G.playState(Object.assign({}, play, { STEP_N: 4 }), NOW);
ok(ps.status === 'DONE' && ps.progress === 100 && !ps.step, 'all steps done = DONE');
eq(G.playState(Object.assign({}, play, { STATUS: 'STOPPED' }), NOW).status, 'STOPPED', 'stopped stays stopped');
var pn = G.playNotifications([play, Object.assign({}, play, { PLAY_ID: 'P2', OWNER: 'bob' })], NOW, 'Amy');
ok(pn.length === 1 && pn[0].key === 'pb:P1:0' && pn[0].k === 'plays' && /Call ·/.test(pn[0].title), 'the bell gets my due step, not bob\'s');
var sto = G.stopOnOrder([Object.assign({}, play, { STOP_ON_ORDER: 'Y', STARTED_AT: '2026-10-01 08:00' }), Object.assign({}, play, { PLAY_ID: 'P3', STOP_ON_ORDER: 'N', STARTED_AT: '2026-10-01 08:00' })], { '200': '2026-10-05' });
eq(sto.map(function (p) { return p.PLAY_ID; }), ['P1'], 'an order after the start stops a stop-on-order playbook');
eq(G.fill('Dear {CONTACT}, {RANGE}', { RANGE: 'SNACKS' }), 'Dear Customer, SNACKS', 'placeholders filled, a missing contact = Customer');

// playbook text form round trip
var txt = G.playbooksText(settings.playbooks);
var back = G.parsePlaybooks(txt);
eq(back.errors, [], 'the text form parses back');
eq(back.list.map(function (p) { return p.id + ':' + p.steps.length; }), settings.playbooks.map(function (p) { return p.id + ':' + p.steps.length; }), 'same playbooks and steps');
eq(back.list[0].steps[1].subject, settings.playbooks[0].steps[1].subject, 'e-mail subject kept');
eq(back.list[0].steps[1].body, settings.playbooks[0].steps[1].body, 'e-mail body (with new lines) kept');
var bad1 = G.parsePlaybooks('# x | X\n3 | PHONE | nope\n');
ok(bad1.errors.length === 2, 'an unknown step kind is an error, and a playbook without steps too');

// ── SQL ──
var sql = G.sql.portfolio('300000003234003', 'C100');
ok(sql.length >= 4 && /M23/.test(sql[0]) && /h\.org_id = 300000003234003/.test(sql[0]) && /account_number > 'C100'/.test(sql[0]), 'portfolio: 24 months, the BU, keyset after');
ok(/NOT EXISTS/.test(sql[0]) && /MAX\(x\.change_version_number\)/.test(sql[1]), 'latest version first by NOT EXISTS, then by MAX()');
ok(!/org_id/.test(sql[sql.length - 1]), 'the last alternative without the BU');
eq(G.sql.groups('1', 'drop table'), [], 'a column that is not an item DFF is refused');
ok(/i\.attribute1/.test(G.sql.groups('1', 'ATTRIBUTE1')[0]), 'groups by the DFF column');
ok(/'O''Brien'/.test(G.sql.portfolio('', "O'Brien")[0]), 'quotes doubled');
ok(/org_id/.test(G.sql.bounced('12', 14)[0]) && /- 14/.test(G.sql.bounced('12', 14)[0]), 'bounced: BU + days');
ok(/'PROD'/.test(G.sql.mraFailed('prod', 7)[0]) && !/UPDATE|DELETE/i.test(G.sql.mraFailed('PROD', 7)[0]), 'MRA query: the pod upper-cased, nothing the gateway refuses');
ok(!/UPDATE|DELETE/i.test(G.sql.cancels('PROD', 3)[0]) && !/UPDATE|DELETE/i.test(G.sql.deliveries('PROD', 'A1', 90).join(' ')), 'APEX reads free of refused words');
eq(G.sql.deliveries('PROD', 'A1').length, 4, 'deliveries: 4 alternatives (picker / MRA / ship date dropped one by one)');

// keyset pages
var page = [{ ACCOUNT_NUMBER: 'A' }, { ACCOUNT_NUMBER: 'B' }, { ACCOUNT_NUMBER: 'B' }];
eq(G.pageOf(page, 3), { rows: [{ ACCOUNT_NUMBER: 'A' }], next: 'A' }, 'a full page drops the account it ends inside');
eq(G.pageOf(page, 5).next, null, 'a short page is the last');
eq(G.pageOf([{ ACCOUNT_NUMBER: 'X' }, { ACCOUNT_NUMBER: 'X' }], 2).next, 'X', 'one account filling the page is taken whole');

// delivery stage
eq(G.deliveryStage({ TRIP_DATE: '2026-10-12', PICKER: 'Ravi' }, '2026-10-11').stage, 'Planned', 'tomorrow\'s trip = planned');
eq(G.deliveryStage({ TRIP_DATE: '2026-10-11', RELEASE_DATE: '2026-10-11 07:00' }, '2026-10-11').stage, 'Picking', 'released = picking');
var ds = G.deliveryStage({ TRIP_DATE: '2026-10-10', ACTUAL_SHIP_DATE: '2026-10-10 14:00', MRA_STATUS: 'FAILED' }, '2026-10-11');
ok(ds.stage === 'Shipped' && ds.steps[4][2] === true, 'shipped, MRA failed flagged');
eq(G.deliveryStage({ TRIP_DATE: '2026-10-01' }, '2026-10-11').stage, 'Trip passed', 'an old trip without a ship date = passed');

// ── wallboard ──
var isOpen = function (t) { return t.STATUS !== 'RESOLVED'; };
var sla = function (t) { return { state: t._s || 'ok' }; };
var wb = G.wallboard({ now: NOW, isOpen: isOpen, sla: sla, queues: ['Sales'],
    tickets: [{ QUEUE: 'Sales', STATUS: 'OPEN', _s: 'breached', ASSIGNED_TO: 'amy', CREATED_AT: '2026-10-09 10:00' }, { QUEUE: 'Sales', STATUS: 'OPEN', _s: 'risk', CREATED_AT: '2026-10-10 10:00' }, { QUEUE: 'Logistics', STATUS: 'OPEN' }, { STATUS: 'RESOLVED', ASSIGNED_TO: 'amy', RESOLVED_AT: '2026-10-11 09:00' }],
    calls: [{ DIRECTION: 'IN', OUTCOME: 'ANSWERED', STARTED_AT: '2026-10-11 08:10', DURATION_S: 120, AGENT: 'amy', ACCOUNT_NUMBER: '1' }, { DIRECTION: 'IN', OUTCOME: 'MISSED', STARTED_AT: '2026-10-11 09:00', ACCOUNT_NUMBER: '2' },
        { DIRECTION: 'OUT', OUTCOME: 'NO_ANSWER', STARTED_AT: '2026-10-11 09:30', AGENT: 'bob', ACCOUNT_NUMBER: '3', CALLBACK_AT: '2026-10-11 09:45' }, { DIRECTION: 'IN', OUTCOME: 'MISSED', STARTED_AT: '2026-10-10 09:00' }],
    plays: [play], signals: rows });
ok(wb.tickets.open === 3 && wb.tickets.breached === 1 && wb.tickets.risk === 1 && wb.tickets.unassigned === 2, 'ticket totals');
eq(wb.queues[0].queue, 'Sales', 'the queue with breaches first');
ok(wb.calls.all === 3 && wb.calls.answered === 1 && wb.calls.missed === 1 && wb.calls.unreached === 1 && wb.calls.missedOpen === 1 && wb.calls.answerRate === 50, 'calls today (yesterday\'s left out)');
eq(wb.calls.byHour[9], 2, 'calls by hour');
ok(wb.callbacks.due === 1 && wb.callbacks.planned === 1, 'call-backs due');
var amy = wb.agents.filter(function (a) { return a.agent === 'amy'; })[0];
ok(amy.open === 1 && amy.breached === 1 && amy.calls === 1 && amy.talk === 120 && amy.solved === 1, 'per agent');
ok(wb.plays.active === 1 && wb.plays.due === 1, 'playbook steps due');
eq(wb.signals.open, 2, 'open signals');

console.log(n + ' checks, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
