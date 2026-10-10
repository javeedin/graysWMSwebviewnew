// node debtors/tests/dc-cycle.test.js — statement cycles (pure)
'use strict';
const E = require('../dc-engine.js');
require('../dc-cycle.js');
let n = 0, bad = 0;
function check(name, ok, extra) { n++; if (ok) console.log('ok   ' + name); else { bad++; console.log('FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 400) : '')); } }

// periods + placeholders
check('periods: month end, label, previous', E.monthEnd('2026-09') === '2026-09-30' && E.monthEnd('2024-02') === '2024-02-29' && E.periodLabel('2026-09') === 'September 2026' && E.prevPeriod('2026-01') === '2025-12');
const bu = E.SEED_BUS[0];
const v = E.cycleVars(bu, { stmtDate: '2026-09-30', tolerance: 5 });
check('cycle vars: PERIOD_START, MON_YY, PERIOD_NAME, TOLERANCE, BU_ID', v.PERIOD === '2026-09' && v.PERIOD_START === '2026-09-01' && v.MON_YY === 'SEP-26' && v.PERIOD_NAME === 'Sep-26' && v.TOLERANCE === '5' && v.BU_ID === '300000003234003');
const ids = E.CHECKS.map(c => c.id);
check('checklist: unapplied receipts, AR not accounted, OM not billed, OM vs AR, e-mails', ['UNAPPLIED_RECEIPTS', 'AR_NOT_ACCOUNTED', 'OM_NOT_BILLED', 'OM_AR_AMOUNTS', 'NO_EMAIL', 'BAD_EMAIL'].every(i => ids.indexOf(i) >= 0));
check('checklist: every SQL fills without unknown placeholders', E.CHECKS.filter(c => c.kind === 'SQL').every(c => E.unknownVars(c.sql, v).length === 0), E.CHECKS.filter(c => c.kind === 'SQL').map(c => [c.id, E.unknownVars(c.sql, v)]).filter(x => x[1].length));
check('checklist: the BU and the date reach the SQL', E.fill(E.CHECKS[0].sql, v, 'sql').indexOf('ps.org_id = 300000003234003') > 0 && E.fill(E.CHECKS[0].sql, v, 'sql').indexOf("TO_DATE('2026-09-30'") > 0);
const omar = E.fill(E.CHECKS.find(c => c.id === 'OM_AR_AMOUNTS').sql, v, 'sql');
check('checklist: OM vs AR per customer × order, the month, the tolerance, the accounting status', /TO_DATE\('2026-09-01'/.test(omar) && /> 5\)\n/.test(omar) && /'Y' = 'N' OR/.test(omar) && /order_number/.test(omar) && /om_amount/.test(omar) && /ar_amount/.test(omar) && /acct_status/.test(omar) && /FULL OUTER JOIN/.test(omar));
check('checklist: "every order of the month" = the same SQL with ONLY_DIFF N', /'N' = 'N' OR/.test(E.fill(E.CHECKS.find(c => c.id === 'OM_AR_AMOUNTS').sql, Object.assign({}, v, { ONLY_DIFF: 'N' }), 'sql')));
check('checklist: AR accounted + transferred to GL, with customer and source ids', ['AR_NOT_ACCOUNTED', 'AR_NOT_IN_GL'].every(id => { const q = E.CHECKS.find(c => c.id === id).sql; return /acct_status/.test(q) && /source_id/.test(q) && /account_number/.test(q); }));

// local checks
const custs = [
    { account: '1', name: 'A', balance: 100, email: 'a@x.com' },
    { account: '2', name: 'B', balance: 50, email: '' },
    { account: '3', name: 'C', balance: 70, email: 'bad-address' },
    { account: '4', name: 'D', balance: -20, email: 'd@x.com' },
    { account: '5', name: 'E', balance: 90, email: 'a@x.com' },
    { account: '6', name: 'F', balance: 40, email: '', emailStat: 'NO' },
    { account: '7', name: 'G', balance: 1000, email: 'g@x.com', aging: { current: 0, d30: 0, d60: 0, d90: 0, d90p: 600 } },
    { account: '8', name: 'H', balance: 30, email: '' }
];
const prof = acct => acct === '8' ? { delivery: 'POST' } : null;
const noEmail = E.localCheck('NO_EMAIL', custs, { bu, profile: prof });
check('NO_EMAIL: no address → listed; card set to post → not; EMAIL_STAT NO → listed with the hint', noEmail.map(r => r.ACCOUNT_NUMBER).join() === '2,6' && /EMAIL_STAT/.test(noEmail[1].DETAIL), noEmail);
check('BAD_EMAIL: the invalid address only', E.localCheck('BAD_EMAIL', custs, { bu, profile: prof }).map(r => r.ACCOUNT_NUMBER).join() === '3');
const shared = E.localCheck('SHARED_EMAIL', custs, { bu, profile: prof });
check('SHARED_EMAIL: both accounts on one address, each naming the other', shared.length === 2 && /also on 5/.test(shared[0].DETAIL));
check('CREDIT_BALANCES', E.localCheck('CREDIT_BALANCES', custs, {}).map(r => r.ACCOUNT_NUMBER).join() === '4');
check('OLD_DEBT: > 25% over 90 days without a follow-up; an open task clears it', E.localCheck('OLD_DEBT', custs, {}).map(r => r.ACCOUNT_NUMBER).join() === '7' && E.localCheck('OLD_DEBT', custs, { activities: [{ ACCOUNT_NUMBER: '7', STATUS: 'OPEN', KIND: 'TASK' }] }).length === 0);
check('outcome: rows → FAIL with the AMOUNT added (any case)', JSON.stringify(E.checkOutcome([{ amount: '10.5' }, { Amount: 4 }])) === JSON.stringify({ status: 'FAIL', rows: 2, amount: 14.5 }) && E.checkOutcome([]).status === 'PASS');

// gate
const checks = [{ id: 'A', severity: 'BLOCK' }, { id: 'B', severity: 'BLOCK' }, { id: 'C', severity: 'WARN' }, { id: 'X', severity: 'BLOCK', enabled: false }];
let g = E.gate(checks, { A: { status: 'PASS' } });
check('gate: a check not run yet holds the cycle; disabled ones do not count', !g.ready && g.pending.join() === 'B,C' && g.total === 3);
g = E.gate(checks, { A: { status: 'PASS' }, B: { status: 'FAIL' }, C: { status: 'FAIL' } });
check('gate: a failed BLOCK check holds it, a failed WARN does not', !g.ready && g.blocking.join() === 'B' && g.warnings.join() === 'C');
g = E.gate(checks, { A: { status: 'PASS' }, B: { status: 'ERROR', bypassNote: 'Fusion table missing on this pod, checked by hand' }, C: { status: 'FAIL' } });
check('gate: bypassed with a comment → ready', g.ready && g.bypassed.join() === 'B' && g.score > 0 && g.score < 100);
check('bypass needs a real comment', !E.bypassOk('ok') && E.bypassOk('Checked with Ravi, receipts applied on 2 Oct'));

// archive
const prev = [{ ACCOUNT_NUMBER: '1', BALANCE: 80 }, { ACCOUNT_NUMBER: '2', BALANCE: 50 }, { ACCOUNT_NUMBER: '9', BALANCE: 300 }];
const snap = E.snapshot(custs, { bu, profile: prof, prev });
const t = snap.totals;
check('archive: totals (customers, total, owed, credit, delivery split)', t.customers === 8 && t.total === 1360 && t.owed === 1380 && t.creditN === 1 && t.creditAmt === -20 && t.emailN === 4 && t.postN === 4, t);
check('archive: rows carry delivery, e-mail and last cycle\'s balance', snap.rows[0].delivery === 'EMAIL' && snap.rows[0].prev === 80 && snap.rows[1].delivery === 'POST' && snap.rows[2].prev === null);
const mv = t.movement;
check('movement: new / cleared (gone from the list) / up / unchanged', mv.hasPrev && mv.newN === 6 && mv.clearedN === 1 && mv.upN === 1 && mv.downN === 0 && mv.prevTotal === 430, mv);
check('movement: biggest moves first', Math.abs(mv.top[0].diff) >= Math.abs(mv.top[1].diff) && mv.top.some(x => x.kind === 'CLEARED' && x.account === '9'));
const back = E.fromArchive([{ ACCOUNT_NUMBER: '7', ACCOUNT_NAME: 'G', BALANCE: '1000', OVERDUE: '600', CUR_AMT: '0', D30: '0', D60: '0', D90: '0', D90P: '600', EMAIL: 'g@x.com', ITEMS_N: '4', CURRENCY: 'MUR' }]);
check('fromArchive: archive rows become customers for the run (frozen balance, aging)', back[0].balance === 1000 && back[0].aging.d90p === 600 && back[0].email === 'g@x.com' && back[0].fromArchive && back[0].lines === 4);

// statement report
const model = { dataSets: [{ name: 'G_HDR', sql: 'select a from t\nwhere x = :p_cust_no' }, { name: 'G_LINES', sql: 'select b from u' }] };
const txt = E.modelText(model);
check('modelText: every data set with its name', /-- data set: G_HDR/.test(txt) && /select b from u/.test(txt));
check('sqlNorm: comments, spacing and case do not count', E.sqlNorm('select a  -- x\n from t /* y */') === E.sqlNorm('SELECT A FROM T'));
const d = E.lineDiff('a\nb\nc', 'a\nB\nc\nd');
check('lineDiff: changed and added lines', d.filter(x => x.t === '-').map(x => x.s).join() === 'b' && d.filter(x => x.t === '+').map(x => x.s).join() === 'B,d' && d.filter(x => x.t === ' ').length === 2);
const smp = E.samples(custs.map(c => Object.assign({ lines: c.account === '5' ? 40 : 1 }, c)));
check('samples: largest, oldest debt, credit, most lines — each once', smp.map(s => s.why).join() === 'largest balance,credit balance,most lines' && smp[0].c.account === '7', smp.map(s => [s.c.account, s.why]));

// coverage + steps
const rows = [{ ACCOUNT_NUMBER: '1', DELIVERY: 'EMAIL' }, { ACCOUNT_NUMBER: '2', DELIVERY: 'POST' }, { ACCOUNT_NUMBER: '3', DELIVERY: 'EMAIL' }, { ACCOUNT_NUMBER: '4', DELIVERY: 'NONE' }, { ACCOUNT_NUMBER: '5', DELIVERY: 'EMAIL' }];
const stm = [
    { STMT_ID: 's1', ACCOUNT_NUMBER: '1', STATUS: 'FAILED', CREATED_AT: '2026-10-01 09:00' },
    { STMT_ID: 's2', ACCOUNT_NUMBER: '1', STATUS: 'SENT', CREATED_AT: '2026-10-01 10:00', OPENS: 1, RESP_STATUS: 'AGREED' },
    { STMT_ID: 's3', ACCOUNT_NUMBER: '2', STATUS: 'POSTED', CREATED_AT: '2026-10-01 10:00' },
    { STMT_ID: 's4', ACCOUNT_NUMBER: '3', STATUS: 'FAILED', CREATED_AT: '2026-10-01 10:00' }
];
const cov = E.coverage(rows, stm).counts;
check('coverage: the latest try counts (resend over a failure), NONE is not due', cov.customers === 5 && cov.deliverable === 4 && cov.emailed === 1 && cov.posted === 1 && cov.failed === 1 && cov.notSent === 1 && cov.agreed === 1 && cov.pct === 50, cov);
let s = E.cycleSteps({ STATUS: 'OPEN' });
check('steps: a new cycle starts on the checklist, every other step may be opened', s.active === 'checks' && s.steps.map(x => x.state).join() === 'active,open,open,open,open');
s = E.cycleSteps({ STATUS: 'READY', CHECKS_AT: 'x', SNAP_AT: 'x', REVIEW_AT: 'x' });
check('steps: after the statement check, send is next and close may be used', s.active === 'send' && s.steps[3].state === 'active' && s.steps[4].state === 'open');
s = E.cycleSteps({ STATUS: 'CLOSED', CHECKS_AT: 'x' });
check('steps: a closed cycle is done everywhere', s.closed && s.steps.every(x => x.state === 'done'));


// drill-down + links
const dr = E.rowDrill({ ACCOUNT_NUMBER: '1001', ORDER_NUMBER: '78326003965', HEADER_ID: '300000123', AMOUNT: 10 });
check('rowDrill: an order row opens the order', dr.kind === 'ORDER' && dr.key === 'ORDER:78326003965' && dr.vars.HEADER_ID === '300000123');
check('rowDrill: an accounting row opens its transaction / receipt by source id', E.rowDrill({ KIND: 'TRANSACTIONS', SOURCE_ID: '55', TRX_NUMBER: 'INV1' }).key === 'TRX:55' && E.rowDrill({ KIND: 'RECEIPTS', SOURCE_ID: '77' }).key === 'RECEIPT:77' && E.rowDrill({ CASH_RECEIPT_ID: '9', RECEIPT_NUMBER: 'R9' }).kind === 'RECEIPT' && E.rowDrill({ X: 1 }) === null);
const osql = E.drillSql(E.DRILLS.ORDER.parts[0], { ORDER_NUMBER: "78'1" }, bu);
check('drillSql: the order number quoted and escaped, the BU filled, ids digits only', /order_number = '78''1'/.test(osql) && /org_id = 300000003234003/.test(osql) && /= 0$/m.test(E.drillSql(E.DRILLS.TRX.parts[0], { TRX_ID: '1; DROP' }, bu)));
check('drills: order → OM lines, AR lines with accounting status, AutoInvoice, events; trx → journal lines', E.DRILLS.ORDER.parts.map(p => p.id).join() === 'om,ar,ai,ev' && /acct_status/.test(E.DRILLS.ORDER.parts[1].sql) && /xla_ae_lines/.test(E.DRILLS.TRX.parts[3].sql) && /ar_receivable_applications_all/.test(E.DRILLS.RECEIPT.parts[1].sql));
check('cellLink: order number, transaction (by its id), customer', E.cellLink('ORDER_NUMBER', { ORDER_NUMBER: '5', HEADER_ID: '9' }).fusion === 'ORDER' && E.cellLink('TRX_NUMBER', { TRX_NUMBER: 'I1', CUSTOMER_TRX_ID: '8' }).open.key === 'TRX:8' && E.cellLink('TRX_NUMBER', { TRX_NUMBER: 'I1' }) === null && E.cellLink('ACCOUNT_NUMBER', { ACCOUNT_NUMBER: '1' }).customer === '1');
check('fusionUrl: Oracle\'s sales order deep link by HeaderId, else by OrderNumber', E.fusionUrl('ORDER', { id: '300000123', number: '78' }, 'https://x.fa.oraclecloud.com/') === 'https://x.fa.oraclecloud.com/fndSetup/faces/deeplink?objType=SALES_ORDER&action=VIEW&objKey=HeaderId=300000123' && /objKey=OrderNumber=78$/.test(E.fusionUrl('ORDER', { number: '78' }, 'https://x.fa.oraclecloud.com')));
check('fusionUrl: no template for a transaction = no link; a template from Setup is used; http refused', E.fusionUrl('TRX', { id: '5' }, 'https://x') === null && E.fusionUrl('TRX', { id: '5', number: 'I 1' }, 'https://x', { TRX: '{BASE}/t?id={ID}&n={NUMBER}' }) === 'https://x/t?id=5&n=I%201' && E.fusionUrl('ORDER', { id: '1' }, 'http://x') === null);
const gs = E.gridSummary([{ OM_AMOUNT: '10', AR_AMOUNT: '4', AMOUNT: '6', ACCT_STATUS: 'Accounted' }, { OM_AMOUNT: '5', AR_AMOUNT: '0', AMOUNT: '5', ACCT_STATUS: 'No invoice' }, { OM_AMOUNT: '1', AR_AMOUNT: '1', AMOUNT: '0', ACCT_STATUS: 'Accounted' }], ['OM_AMOUNT', 'AR_AMOUNT', 'AMOUNT', 'ACCT_STATUS']);
check('gridSummary: OM / AR / difference totals and the accounting status counts', gs.sums.OM_AMOUNT === 16 && gs.sums.AR_AMOUNT === 5 && gs.sums.AMOUNT === 11 && gs.counts.ACCT_STATUS.Accounted === 2);
// send plan
const plan = E.sendPlan(checks, { A: { status: 'PASS' }, B: { status: 'FAIL', rows: 3 }, C: { status: 'FAIL', rows: 1 } }, { STATUS: 'OPEN' });
check('sendPlan: blocking failures and checks not run must be bypassed; warnings listed; archive and review still to do', plan.bypass.map(x => x.id + ':' + x.state).join() === 'B:3 found' && plan.warnings.join() === 'C' && plan.archive && plan.review && !plan.ready);
const plan2 = E.sendPlan(checks, { A: { status: 'PASS' } }, { SNAP_AT: 'x', REVIEW_AT: 'x' });
check('sendPlan: a check never run is listed as not run', plan2.bypass.map(x => x.id + ':' + x.state).join() === 'B:not run,C:not run');
check('sendPlan: everything done → ready', E.sendPlan(checks, { A: { status: 'PASS' }, B: { status: 'PASS' }, C: { status: 'FAIL', rows: 2 } }, { SNAP_AT: 'x', REVIEW_AT: 'y' }).ready);

// accounting status read after the comparison
const omarDef = E.CHECKS.find(c => c.id === 'OM_AR_AMOUNTS');
check('OM vs AR: no XLA join in the comparison itself (it timed out on big months)', omarDef.acct && !/xla_/i.test(omarDef.sql) && /trx_ids/.test(omarDef.sql));
const ar = [{ ORDER_NUMBER: '1', TRX_IDS: '11,12', ACCT_STATUS: 'Not checked' }, { ORDER_NUMBER: '2', TRX_IDS: '13', ACCT_STATUS: 'Not checked' }, { ORDER_NUMBER: '3', ACCT_STATUS: 'No invoice' }, { ORDER_NUMBER: '4', TRX_IDS: '14,15...', ACCT_STATUS: 'Not checked' }, { ORDER_NUMBER: '5', TRX_IDS: '16', ACCT_STATUS: 'Invoice incomplete' }];
const ch = E.acctChunks(ar, 2);
check('acctChunks: unique whole ids in chunks', JSON.stringify(ch) === JSON.stringify([['11', '12'], ['13', '16']]) || JSON.stringify(ch.flat()) === JSON.stringify(['11', '12', '13', '14', '16']), JSON.stringify(ch));
check('acctSql: ids only digits, IN list', /IN \(11, 12\)/.test(E.acctSql(['11', '12', "1) OR (1=1"])));
E.acctMerge(ar, [{ CUSTOMER_TRX_ID: 11, EVENTS: 1, NOT_ACCOUNTED: 0, IN_ERROR: 0 }, { CUSTOMER_TRX_ID: 12, EVENTS: 1, NOT_ACCOUNTED: 1, IN_ERROR: 0 }, { CUSTOMER_TRX_ID: 14, EVENTS: 2, NOT_ACCOUNTED: 0, IN_ERROR: 1 }]);
check('acctMerge: worst of the invoices, no event, no invoice kept, incomplete kept', ar.map(r => r.ACCT_STATUS).join() === 'Not accounted,No accounting event,No invoice,Error,Invoice incomplete', ar.map(r => r.ACCT_STATUS).join());

// Customer 360 › open invoices
const oiq = E.openItemsSql({ id: '300000003234003' }, "GR'1");
check('openItemsSql: account quoted, BU id, open schedules only', /account_number = 'GR''1'/.test(oiq) && /ps.org_id = 300000003234003/.test(oiq) && /ps.status = 'OP'/.test(oiq) && /0/.test(E.openItemsSql({ id: 'x;drop' }, 'A')));
const ois = E.openItemsSummary([{ REMAINING: 100, DAYS_LATE: 0, CUSTOMER: 'Grays' }, { REMAINING: 50, DAYS_LATE: 45 }, { REMAINING: 20, DAYS_LATE: 120 }, { REMAINING: -30, DAYS_LATE: 5 }]);
check('openItemsSummary: total, overdue, credits, aging buckets, oldest, name', ois.total === 140 && ois.overdue === 40 && ois.credits === -30 && ois.aging.d60 === 50 && ois.aging.d90p === 20 && ois.aging.d30 === -30 && ois.oldest === 120 && ois.name === 'Grays', JSON.stringify(ois));

console.log(bad ? 'FAILED ' + bad + ' of ' + n + ' statement cycle checks' : 'ok ' + n + ' statement cycle checks');
process.exit(bad ? 1 : 0);
