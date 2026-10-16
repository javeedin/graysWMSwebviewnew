// node debtors/tests/dc-engine.test.js — the pure Debtors Control engine
'use strict';
const E = require('../dc-engine.js');
let n = 0, bad = 0;
function check(name, ok, extra) { n++; if (ok) console.log('ok   ' + name); else { bad++; console.log('FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } }

// dates and numbers
check('last month end from 10 Oct 2026', E.lastMonthEnd(new Date(2026, 9, 10)) === '2026-09-30');
check('last month end in January → 31 Dec', E.lastMonthEnd(new Date(2027, 0, 5)) === '2026-12-31');
check('numbers: commas, brackets, trailing minus', E.num('1,234.50') === 1234.5 && E.num('(10)') === -10 && E.num('25-') === -25 && E.num('') === null && E.num('x') === null);
check('money', E.money(1234567.891) === '1,234,567.89' && E.money(-5) === '-5.00' && E.money(null) === '');

// variables and placeholders
const bu = E.SEED_BUS[1];
const v = E.vars(bu, '2026-09-30', { account: '1001', name: "O'Brien & Sons", balance: 15000.5, currency: 'MUR' });
check('vars: the old form\'s MM-dd-yyyy date', v.STMT_DATE_MDY === '09-30-2026' && v.STMT_DATE_LONG === '30 September 2026' && v.MONTH === 'September 2026');
check('vars: business unit and company', v.BU_ID === '300000004907002' && v.COMPANY === 'Sugarworld Ltd');
check('fill: plain', E.fill('{COMPANY} – {ACCOUNT_NUMBER}', v) === 'Sugarworld Ltd – 1001');
check('fill: html escapes values', E.fill('<b>{ACCOUNT_NAME}</b>', v, 'html') === '<b>O&#39;Brien &amp; Sons</b>');
check('fill: sql doubles quotes', E.fill("WHERE n = '{ACCOUNT_NAME}'", v, 'sql') === "WHERE n = 'O''Brien & Sons'");
check('fill: unknown names stay as written', E.fill('{NOPE} {BALANCE}', v) === '{NOPE} 15,000.50');
check('unknownVars lists names a template uses that do not exist', JSON.stringify(E.unknownVars('{NOPE} {BALANCE} {X1}', v)) === '["NOPE","X1"]');
check('statement report parameters filled', JSON.stringify(E.fillParams(bu.statement.params, v)) === JSON.stringify({ p_cust_no: '1001', p_date_fr: '09-30-2026', BUSINESS_UNIT_ID: '300000004907002' }));
check('default SQL uses the BU and the date', E.fill(E.DEFAULT_SQL, v, 'sql').indexOf('ps.org_id = 300000004907002') > 0 && E.fill(E.DEFAULT_SQL, v, 'sql').indexOf("TO_DATE('2026-09-30'") > 0);

// mapping a report to customers
const rows = [
    { ACCOUNT_NUMBER: '1001', ACCOUNT_NAME: 'Alpha', AMT_REMAINING: '1,000.00', EMAIL: 'ar@alpha.mu', EMAIL_STAT: 'Yes' },
    { ACCOUNT_NUMBER: '1001', ACCOUNT_NAME: 'Alpha', AMT_REMAINING: '500', EMAIL: '' },
    { ACCOUNT_NUMBER: '1002', ACCOUNT_NAME: 'Beta', AMT_REMAINING: '-20', EMAIL: '', EMAIL_STAT: 'NO' },
    { ACCOUNT_NUMBER: '', ACCOUNT_NAME: 'nobody', AMT_REMAINING: '9' }
];
const m = E.customers(rows);
check('customers: one per account, balances added, blank account dropped', m.customers.length === 2 && m.customers[0].balance === 1500 && m.customers[0].lines === 2);
check('customers: e-mail and EMAIL_STAT kept (upper case)', m.customers[0].email === 'ar@alpha.mu' && m.customers[0].emailStat === 'YES' && m.customers[1].emailStat === 'NO');
check('customers: nothing missing for the statement summary columns', m.missing.length === 0);
const sqlRows = [{ ACCOUNT_NUMBER: '7', ACCOUNT_NAME: 'Gamma', CURRENCY: 'MUR', BALANCE: 1000, CURRENT_AMT: 100, B1_30: 200, B31_60: 300, B61_90: 0, B90_PLUS: 400, EMAIL: 'x@y.com' }];
const g = E.customers(sqlRows).customers[0];
check('customers: aging buckets from the SQL, overdue = every bucket past due', g.aging.d90p === 400 && g.overdue === 900 && g.currency === 'MUR');
check('detect: a saved column wins over the known names', E.detect([{ CUST: '1', ACCOUNT_NUMBER: '2', NAME: 'n', TOTAL: 1 }], { account: 'cust' }).map.account === 'CUST');
check('detect: reports what is missing', JSON.stringify(E.detect([{ FOO: 1 }]).missing) === '["account","name","balance"]');

// recipients
const es = E.emails('A@b.com; Name <c@d.org>, bad-address, a@b.com');
check('emails: lower-cased, de-duplicated, bad ones listed', es.length === 2 && es[1] === 'c@d.org' && es.bad[0] === 'bad-address');
check('recipients: Fusion e-mail', E.recipients({ email: 'ar@alpha.mu' }, null, bu).delivery === 'EMAIL');
check('recipients: EMAIL_STAT NO → post', E.recipients({ email: 'ar@alpha.mu', emailStat: 'NO' }, null, bu).delivery === 'POST');
check('recipients: the customer card wins over Fusion and over EMAIL_STAT', (function () { var r = E.recipients({ email: 'old@x.com', emailStat: 'NO' }, { stmtTo: 'new@x.com', delivery: 'EMAIL' }, bu); return r.delivery === 'EMAIL' && r.to[0] === 'new@x.com' && r.source === 'card'; })());
check('recipients: no valid e-mail → post with the reason', (function () { var r = E.recipients({ email: 'not-an-email' }, null, bu); return r.delivery === 'POST' && /not valid/.test(r.why); })());
check('recipients: NONE = no statement', E.recipients({ email: 'a@b.com' }, { delivery: 'NONE' }, bu).delivery === 'NONE');
check('recipients: cc from the card and the BU, never the same as To', (function () { var r = E.recipients({ email: 'a@b.com' }, { stmtCc: 'a@b.com; boss@b.com' }, { mail: { cc: 'ar@us.com' } }); return r.cc.join() === 'boss@b.com,ar@us.com'; })());

// statement states
check('state: failed', E.stmtState({ STATUS: 'FAILED' }).key === 'FAILED');
check('state: opened beats sent', E.stmtState({ STATUS: 'SENT', OPENS: 2 }).key === 'OPENED');
check('state: dispute beats read', E.stmtState({ STATUS: 'SENT', READ_AT: 'x', RESP_STATUS: 'DISPUTED' }).key === 'DISPUTED');
check('state: bounce beats everything but failure', E.stmtState({ STATUS: 'SENT', OPENS: 1, BOUNCED_AT: 'x' }).key === 'BOUNCED');
check('state: by post', E.stmtState({ STATUS: 'POSTED' }).label === 'By post');
check('tracking html: picture + confirm button with the token', (function () { var h = E.trackHtml('https://h/ords/W/WAREHOUSEMANAGEMENT', 'tok123', { track: true, confirm: true }); return h.indexOf('/dc/px/tok123') > 0 && h.indexOf('/dc/resp/tok123') > 0; })());
check('tracking html: nothing without a token', E.trackHtml('https://h', '', { track: true }) === '');

// activities, score, worklist
const today = new Date(2026, 9, 10);
check('actState: late / due / open / done', E.actState({ DUE_DATE: '2026-10-01' }, today) === 'LATE' && E.actState({ DUE_DATE: '2026-10-10' }, today) === 'DUE' && E.actState({ DUE_DATE: '2026-11-01' }, today) === 'OPEN' && E.actState({ STATUS: 'KEPT', DUE_DATE: '2026-10-01' }, today) === 'KEPT');
const big = { balance: 100000, aging: { current: 0, d30: 0, d60: 10000, d90: 10000, d90p: 60000 } };
const sc = E.score(big, { maxBalance: 100000, activities: [{ KIND: 'PROMISE', STATUS: 'OPEN', DUE_DATE: '2026-09-01' }], today: today });
check('score: big, old, a broken promise, never contacted → high with reasons', sc.score >= 70 && E.band(sc.score).key === 'high' && sc.why.indexOf('1 promise not kept') >= 0 && sc.why.indexOf('Never contacted') >= 0, sc);
check('score: a credit balance is not chased', E.score({ balance: -50 }, {}).score === 0);
const small = E.score({ balance: 100, aging: { current: 100, d30: 0, d60: 0, d90: 0, d90p: 0 } }, { maxBalance: 100000, lastContact: '2026-10-01', today: today });
check('score: small and current → low', small.score < 40, small);
const stmts = [
    { STMT_ID: 's1', BU_ID: 'B', ACCOUNT_NUMBER: '1', ACCOUNT_NAME: 'A', STMT_DATE: '2026-08-31', STATUS: 'SENT', CREATED_AT: '2026-09-01 10:00', SENT_AT: '2026-09-01 10:00', TRACKED: 'Y' },
    { STMT_ID: 's2', BU_ID: 'B', ACCOUNT_NUMBER: '1', ACCOUNT_NAME: 'A', STMT_DATE: '2026-09-30', STATUS: 'SENT', CREATED_AT: '2026-10-01 10:00', SENT_AT: '2026-10-01 10:00', TRACKED: 'Y', RESP_STATUS: 'DISPUTED', RESP_COMMENT: 'Invoice 55 was returned', RESP_AT: '2026-10-02 09:00' },
    { STMT_ID: 's3', BU_ID: 'B', ACCOUNT_NUMBER: '2', ACCOUNT_NAME: 'Bee', STMT_DATE: '2026-09-30', STATUS: 'FAILED', ERROR_TEXT: 'Outlook closed', CREATED_AT: '2026-10-01 10:01' },
    { STMT_ID: 's4', BU_ID: 'B', ACCOUNT_NUMBER: '3', ACCOUNT_NAME: 'Cee', STMT_DATE: '2026-09-30', STATUS: 'SENT', CREATED_AT: '2026-10-01 10:02', SENT_AT: '2026-10-01 10:02', TRACKED: 'Y' }
];
const acts = [
    { ACT_ID: 'a1', KIND: 'PROMISE', BU_ID: 'B', ACCOUNT_NUMBER: '3', ACCOUNT_NAME: 'Cee', AMOUNT: 500, DUE_DATE: '2026-10-05', STATUS: 'OPEN' },
    { ACT_ID: 'a2', KIND: 'TASK', BU_ID: 'B', ACCOUNT_NUMBER: '2', ACCOUNT_NAME: 'Bee', SUBJECT: 'Call back', DUE_DATE: '2026-10-10', STATUS: 'OPEN' }
];
const wl = E.worklist(stmts, acts, { today: today, unopenedDays: 7 });
const kinds = wl.map(function (x) { return x.kind; });
check('worklist: only the latest statement per customer counts (no old one)', !wl.some(function (x) { return x.ref === 's1'; }));
check('worklist: dispute, failed send, late promise, follow-up due, unopened', ['DISPUTED', 'FAILED', 'PROMISE_LATE', 'FOLLOWUP', 'UNOPENED'].every(function (k) { return kinds.indexOf(k) >= 0; }), kinds);
check('worklist: most urgent first', wl[0].sev === 3 && wl[wl.length - 1].sev === 1);
check('worklist: a resolved dispute leaves the list', !E.worklist(stmts, acts.concat([{ KIND: 'DISPUTE', REF_ID: 's2', STATUS: 'RESOLVED' }]), { today: today }).some(function (x) { return x.kind === 'DISPUTED'; }));
const tl = E.timeline(stmts.slice(0, 2), [{ KIND: 'CALL', CREATED_AT: '2026-10-03 11:00', SUBJECT: 'Called' }, { KIND: 'DISPUTE', SOURCE: 'CUSTOMER', CREATED_AT: '2026-10-02 09:00' }]);
check('timeline: newest first, the customer\'s answer once', tl[0].kind === 'CALL' && tl[1].kind === 'DISPUTE' && tl.filter(function (x) { return x.kind === 'DISPUTE'; }).length === 1 && tl.length === 4);
const k = E.kpis(stmts);
check('kpis: sent, failed, disputed, open rate', k.emailed === 3 && k.failed === 1 && k.disputed === 1 && k.openRate === 33);
check('token: 32 hex characters', /^[0-9a-f]{32}$/.test(E.token()));

console.log(bad ? 'FAILED ' + bad + ' of ' + n + ' Debtors Control engine checks' : 'ok ' + n + ' Debtors Control engine checks');
process.exit(bad ? 1 : 0);
