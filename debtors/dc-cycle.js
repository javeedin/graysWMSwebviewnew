/* Fusion Debtors Control · statement cycles — pure engine (extends window.DCE; also a node module for debtors/tests).
 * A cycle = one business unit × one month: ① the pre-send checklist (Fusion SQL / BI Publisher / checks on the balances,
 * each PASS / FAIL / ERROR, a failure bypassed only with a comment) → ② the balances archived (one frozen row per customer:
 * total due, aging, overdue, items, e-mail, delivery + the movement against the previous cycle) → ③ the statement report
 * checked (its data-model SQL captured and fingerprinted, drift against the last cycle, sample PDFs signed off) →
 * ④ statements sent from the archive → ⑤ closed with its coverage. No DOM, no host, no APEX here. */
(function (root) {
    'use strict';
    var E = root.DCE || (typeof require === 'function' ? require('./dc-engine.js') : null);
    if (!E) throw new Error('dc-engine.js must be loaded first');

    // ── periods ──
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    E.periodOf = function (iso) { return String(iso || '').slice(0, 7); };
    E.monthEnd = function (period) { var m = /^(\d{4})-(\d{2})$/.exec(period || ''); if (!m) return null; return E.iso(new Date(+m[1], +m[2], 0)); };
    E.periodLabel = function (period) { var m = /^(\d{4})-(\d{2})$/.exec(period || ''); return m ? MONTHS[+m[2] - 1] + ' ' + m[1] : String(period || ''); };
    E.prevPeriod = function (period) { var m = /^(\d{4})-(\d{2})$/.exec(period || ''); if (!m) return null; var d = new Date(+m[1], +m[2] - 2, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
    /** Placeholders of a cycle: the statement ones + PERIOD, PERIOD_START, MON_YY (SEP-26), PERIOD_NAME (Sep-26), TOLERANCE */
    E.cycleVars = function (bu, cycle, extra) {
        var v = E.vars(bu, cycle.stmtDate, {}), d = E.parseIso(cycle.stmtDate) || new Date();
        v.PERIOD = E.periodOf(cycle.stmtDate);
        v.PERIOD_START = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-01';
        v.MON_YY = MON[d.getMonth()] + '-' + String(d.getFullYear()).slice(2);
        v.PERIOD_NAME = MON[d.getMonth()].charAt(0) + MON[d.getMonth()].slice(1).toLowerCase() + '-' + String(d.getFullYear()).slice(2);
        v.TOLERANCE = String(cycle.tolerance != null ? cycle.tolerance : 1);
        Object.keys(extra || {}).forEach(function (k) { v[k] = extra[k]; });
        return v;
    };

    // ── the checklist ──
    var D = "TO_DATE('{STMT_DATE}', 'YYYY-MM-DD')", D0 = "TO_DATE('{PERIOD_START}', 'YYYY-MM-DD')";
    /** Starter checks. kind SQL = Fusion SQL through the read-only runner, BIP = a BI Publisher report, LOCAL = computed from the
     *  balances of the cycle. Every SQL / BIP check returns the EXCEPTIONS: no rows = PASS. A column AMOUNT is added up. */
    E.CHECKS = [
        { id: 'UNAPPLIED_RECEIPTS', area: 'Receipts', severity: 'BLOCK', kind: 'SQL', title: 'No unapplied receipts',
          help: 'Receipts with money not applied to invoices make the statement balance look wrong — apply them first.',
          sql: "SELECT cr.receipt_number, TO_CHAR(cr.receipt_date, 'YYYY-MM-DD') AS receipt_date, ca.account_number, p.party_name AS customer, ps.amount_due_remaining AS amount\n  FROM ar_payment_schedules_all ps\n  JOIN ar_cash_receipts_all cr ON cr.cash_receipt_id = ps.cash_receipt_id\n  LEFT JOIN hz_cust_accounts ca ON ca.cust_account_id = ps.customer_id\n  LEFT JOIN hz_parties p ON p.party_id = ca.party_id\n WHERE ps.class = 'PMT' AND ps.status = 'OP' AND ps.amount_due_remaining <> 0\n   AND ps.org_id = {BU_ID} AND ps.gl_date <= " + D + "\n ORDER BY ps.amount_due_remaining" },
        { id: 'UNIDENTIFIED_RECEIPTS', area: 'Receipts', severity: 'BLOCK', kind: 'SQL', title: 'No unidentified receipts',
          help: 'Money received without a customer — it belongs on somebody\'s statement.',
          sql: "SELECT cr.receipt_number, TO_CHAR(cr.receipt_date, 'YYYY-MM-DD') AS receipt_date, cr.amount AS amount, cr.comments\n  FROM ar_cash_receipts_all cr\n WHERE cr.status = 'UNID' AND cr.org_id = {BU_ID} AND cr.receipt_date <= " + D },
        { id: 'INCOMPLETE_TRX', area: 'AR', severity: 'BLOCK', kind: 'SQL', title: 'No incomplete AR transactions',
          help: 'Invoices and credit memos saved but not completed are missing from the statement.',
          sql: "SELECT t.trx_number, TO_CHAR(t.trx_date, 'YYYY-MM-DD') AS trx_date, ca.account_number, p.party_name AS customer\n  FROM ra_customer_trx_all t\n  LEFT JOIN hz_cust_accounts ca ON ca.cust_account_id = t.bill_to_customer_id\n  LEFT JOIN hz_parties p ON p.party_id = ca.party_id\n WHERE t.complete_flag = 'N' AND t.org_id = {BU_ID} AND t.trx_date <= " + D },
        { id: 'AR_NOT_ACCOUNTED', area: 'AR', severity: 'BLOCK', kind: 'SQL', title: 'Every AR event accounted (interfaced to GL)',
          help: 'Receivables transactions and receipts whose accounting is not created yet (Create Accounting not run, or in error).',
          sql: "SELECT e.event_id, e.event_type_code, TO_CHAR(e.event_date, 'YYYY-MM-DD') AS event_date, e.event_status_code, e.process_status_code, te.transaction_number\n  FROM xla_events e\n  JOIN xla_transaction_entities te ON te.entity_id = e.entity_id AND te.application_id = e.application_id\n WHERE e.application_id = 222 AND e.event_status_code IN ('U', 'I')\n   AND te.security_id_int_1 = {BU_ID} AND e.event_date <= " + D },
        { id: 'AUTOINVOICE_PENDING', area: 'OM → AR', severity: 'BLOCK', kind: 'SQL', title: 'Nothing waiting in AutoInvoice',
          help: 'Billing lines from Order Management still in the AutoInvoice interface (not imported, or in error).',
          sql: "SELECT l.interface_line_context, l.sales_order, l.description, l.amount AS amount, (SELECT MAX(er.message_text) FROM ra_interface_errors_all er WHERE er.interface_line_id = l.interface_line_id) AS error\n  FROM ra_interface_lines_all l\n WHERE l.org_id = {BU_ID}" },
        { id: 'OM_NOT_BILLED', area: 'OM → AR', severity: 'BLOCK', kind: 'SQL', title: 'Every shipped order line is billed',
          help: 'Order lines shipped by the statement date but not invoiced in Receivables yet.',
          sql: "SELECT h.order_number, fl.fulfill_line_number, fl.status_code, TO_CHAR(fl.actual_ship_date, 'YYYY-MM-DD') AS shipped, fl.extended_amount AS amount\n  FROM doo_fulfill_lines_all fl\n  JOIN doo_headers_all h ON h.header_id = fl.header_id\n WHERE h.org_id = {BU_ID} AND fl.status_code IN ('SHIPPED', 'AWAIT_BILLING')\n   AND fl.actual_ship_date < " + D + " + 1" },
        { id: 'OM_AR_AMOUNTS', area: 'OM → AR', severity: 'BLOCK', kind: 'SQL', title: 'OM and AR amounts of the month agree',
          help: 'Order lines shipped this month vs AR invoice lines that carry a sales order. A row comes back only when they differ by more than the tolerance.',
          sql: "WITH om AS (SELECT NVL(SUM(fl.extended_amount), 0) AS amt FROM doo_fulfill_lines_all fl JOIN doo_headers_all h ON h.header_id = fl.header_id\n              WHERE h.org_id = {BU_ID} AND fl.actual_ship_date >= " + D0 + " AND fl.actual_ship_date < " + D + " + 1\n                AND fl.status_code IN ('SHIPPED', 'AWAIT_BILLING', 'BILLED', 'CLOSED')),\n     ar AS (SELECT NVL(SUM(l.extended_amount), 0) AS amt FROM ra_customer_trx_lines_all l JOIN ra_customer_trx_all t ON t.customer_trx_id = l.customer_trx_id\n              WHERE t.org_id = {BU_ID} AND l.line_type = 'LINE' AND l.sales_order IS NOT NULL\n                AND t.trx_date >= " + D0 + " AND t.trx_date < " + D + " + 1)\nSELECT om.amt AS om_amount, ar.amt AS ar_amount, om.amt - ar.amt AS amount FROM om, ar WHERE ABS(om.amt - ar.amt) > {TOLERANCE}" },
        { id: 'OM_AR_RECON_BIP', area: 'OM → AR', severity: 'WARN', kind: 'BIP', enabled: false, title: 'OM ↔ AR reconciliation (report of the old form)',
          help: 'The old debtors form\'s reconciliation report. Every row it returns is listed — switch it on once its parameters are checked.',
          path: '/Custom/DEXPRESS/DEBTORS_CONTROL/AR_OM_RECON_PIVOT_BIP_V2.xdo', params: { ORG_ID: '{BU_ID}', ORDER_MONTH: '{MON_YY}' } },
        { id: 'AR_PERIOD', area: 'Period', severity: 'WARN', kind: 'SQL', title: 'The AR period is closed',
          help: 'Statements of an open period can still change after they are sent.',
          sql: "SELECT ps.period_name, ps.closing_status\n  FROM gl_period_statuses ps\n  JOIN ar_system_parameters_all sp ON sp.set_of_books_id = ps.ledger_id\n WHERE sp.org_id = {BU_ID} AND ps.application_id = 222 AND NVL(ps.adjustment_period_flag, 'N') = 'N'\n   AND " + D + " BETWEEN ps.start_date AND ps.end_date AND ps.closing_status NOT IN ('C', 'P')" },
        { id: 'NO_EMAIL', area: 'Customers', severity: 'BLOCK', kind: 'LOCAL', title: 'Every customer with a balance has an e-mail',
          help: 'Customers who owe money but have no e-mail and are not set to post on their card.' },
        { id: 'BAD_EMAIL', area: 'Customers', severity: 'BLOCK', kind: 'LOCAL', title: 'Every e-mail address is valid', help: 'Addresses that cannot be sent to.' },
        { id: 'SHARED_EMAIL', area: 'Customers', severity: 'WARN', kind: 'LOCAL', title: 'No e-mail shared by several customers',
          help: 'One address on several accounts is often a salesperson\'s or our own — the customers would get each other\'s statements.' },
        { id: 'CREDIT_BALANCES', area: 'Customers', severity: 'WARN', kind: 'LOCAL', title: 'Credit balances reviewed', help: 'Customers we owe money to — refund or apply before the statement.' },
        { id: 'OLD_DEBT', area: 'Customers', severity: 'WARN', kind: 'LOCAL', title: 'Debt over 90 days followed up', help: 'Customers with more than a quarter of the balance over 90 days and no open follow-up.' }
    ];
    E.AREAS = ['Receipts', 'AR', 'OM → AR', 'Period', 'Customers'];

    /** A LOCAL check on the cycle's customers → exception rows {ACCOUNT_NUMBER, ACCOUNT_NAME, AMOUNT, DETAIL} */
    E.localCheck = function (id, customers, ctx) {
        var c = ctx || {}, bu = c.bu || {}, prof = c.profile || function () { return null; }, acts = c.activities || [], out = [];
        var list = (customers || []).filter(function (x) { return x && x.account; });
        function row(x, detail, amt) { return { ACCOUNT_NUMBER: x.account, ACCOUNT_NAME: x.name, AMOUNT: amt != null ? amt : x.balance, DETAIL: detail }; }
        if (id === 'NO_EMAIL') list.forEach(function (x) {
            if (!(x.balance > 0)) return;
            var p = prof(x.account) || {}, r = E.recipients(x, p, bu);
            if (r.delivery === 'POST' && String(p.delivery || '').toUpperCase() !== 'POST' && !E.emails(p.stmtTo || x.email || '').bad.length) out.push(row(x, x.emailStat === 'NO' ? 'EMAIL_STAT = NO in Fusion — set the card to Post or add an e-mail' : 'No e-mail in Fusion or on the card'));
        });
        else if (id === 'BAD_EMAIL') list.forEach(function (x) {
            var p = prof(x.account) || {}, bad = E.emails(p.stmtTo || x.email || '').bad.concat(E.emails(p.stmtCc || '').bad);
            if (bad.length) out.push(row(x, 'Not an address: ' + bad.join(', ')));
        });
        else if (id === 'SHARED_EMAIL') {
            var by = {};
            list.forEach(function (x) { if (!(x.balance > 0)) return; var p = prof(x.account) || {}; E.emails(p.stmtTo || x.email || '').forEach(function (a) { (by[a] = by[a] || []).push(x); }); });
            Object.keys(by).forEach(function (a) { if (by[a].length > 1) by[a].forEach(function (x) { out.push(row(x, a + ' is also on ' + by[a].filter(function (y) { return y !== x; }).map(function (y) { return y.account; }).join(', '))); }); });
        } else if (id === 'CREDIT_BALANCES') list.forEach(function (x) { if (x.balance < 0) out.push(row(x, 'We owe the customer ' + E.money(-x.balance))); });
        else if (id === 'OLD_DEBT') list.forEach(function (x) {
            if (!(x.balance > 0) || !x.aging) return;
            var share = (x.aging.d90p || 0) / x.balance;
            if (share < 0.25) return;
            var open = acts.some(function (a) { return a.ACCOUNT_NUMBER === x.account && a.STATUS === 'OPEN' && (a.KIND === 'TASK' || a.KIND === 'PROMISE' || a.KIND === 'DISPUTE'); });
            if (!open) out.push(row(x, Math.round(share * 100) + '% over 90 days (' + E.money(x.aging.d90p) + '), no open follow-up', x.aging.d90p));
        });
        return out;
    };

    /** rows of a check → its outcome {status PASS | FAIL, rows, amount} (an AMOUNT column, any case, is added up) */
    E.checkOutcome = function (rows) {
        var n = (rows || []).length, amt = 0, has = false;
        (rows || []).forEach(function (r) { var k = Object.keys(r).filter(function (x) { return x.toUpperCase() === 'AMOUNT'; })[0]; if (k != null) { has = true; amt += E.num(r[k]) || 0; } });
        return { status: n ? 'FAIL' : 'PASS', rows: n, amount: has ? Math.round(amt * 100) / 100 : null };
    };
    /** Can the cycle go on? Every enabled check has run; a BLOCK that failed / errored must be bypassed (with a comment). */
    E.gate = function (checks, results) {
        var res = results || {}, g = { ready: true, blocking: [], warnings: [], pending: [], passed: [], bypassed: [], total: 0 };
        (checks || []).forEach(function (c) {
            if (c.enabled === false) return;
            g.total++;
            var r = res[c.id];
            if (!r || !r.status || r.status === 'RUNNING') { g.pending.push(c.id); g.ready = false; return; }
            if (r.status === 'PASS') { g.passed.push(c.id); return; }
            if (r.bypassNote) { g.bypassed.push(c.id); return; }
            if (c.severity === 'BLOCK') { g.blocking.push(c.id); g.ready = false; } else g.warnings.push(c.id);
        });
        g.score = g.total ? Math.round(100 * (g.passed.length + g.bypassed.length * 0.5 + g.warnings.length * 0.5) / g.total) : 0;
        return g;
    };
    E.BYPASS_MIN = 10;
    E.bypassOk = function (note) { return String(note || '').trim().length >= E.BYPASS_MIN; };

    // ── the archive ──
    /** customers → archive rows + totals (+ movement against the previous cycle's rows) */
    E.snapshot = function (customers, ctx) {
        var c = ctx || {}, bu = c.bu || {}, prof = c.profile || function () { return null; }, prev = {}, t = { customers: 0, total: 0, owed: 0, overdue: 0, cur: 0, d30: 0, d60: 0, d90: 0, d90p: 0, creditN: 0, creditAmt: 0, emailN: 0, postN: 0, noneN: 0, items: 0, hasAging: false };
        (c.prev || []).forEach(function (r) { prev[r.ACCOUNT_NUMBER] = r; });
        var rows = (customers || []).map(function (x) {
            var r = E.recipients(x, prof(x.account) || {}, bu), a = x.aging, p = prev[x.account];
            t.customers++; t.total += x.balance || 0;
            if (x.balance > 0) t.owed += x.balance; else if (x.balance < 0) { t.creditN++; t.creditAmt += x.balance; }
            if (x.overdue != null) t.overdue += x.overdue;
            if (a) { t.hasAging = true; t.cur += a.current || 0; t.d30 += a.d30 || 0; t.d60 += a.d60 || 0; t.d90 += a.d90 || 0; t.d90p += a.d90p || 0; }
            t.items += x.lines || 0;
            if (r.delivery === 'EMAIL') t.emailN++; else if (r.delivery === 'POST') t.postN++; else t.noneN++;
            return { account: x.account, name: x.name, currency: x.currency || bu.currency || '', balance: x.balance || 0, overdue: x.overdue, aging: a || null, items: x.lines || 0,
                email: r.to.join('; '), delivery: r.delivery, why: r.why, score: x._score ? x._score.score : null, prev: p ? +p.BALANCE : null };
        });
        Object.keys(t).forEach(function (k) { if (typeof t[k] === 'number') t[k] = Math.round(t[k] * 100) / 100; });
        t.movement = E.movement(rows, c.prev || []);
        return { rows: rows, totals: t };
    };
    /** this cycle's rows vs the previous cycle's archive rows → new / cleared / up / down + the biggest moves */
    E.movement = function (rows, prevRows) {
        var prev = {}, seen = {}, m = { hasPrev: !!(prevRows && prevRows.length), newN: 0, clearedN: 0, upN: 0, downN: 0, prevTotal: 0, top: [] };
        (prevRows || []).forEach(function (r) { prev[r.ACCOUNT_NUMBER] = +r.BALANCE || 0; m.prevTotal += +r.BALANCE || 0; });
        if (!m.hasPrev) return m;
        var moves = [];
        (rows || []).forEach(function (r) {
            seen[r.account] = 1;
            var was = prev[r.account], now = r.balance || 0;
            if (was == null) { if (now) { m.newN++; moves.push({ account: r.account, name: r.name, was: 0, now: now, diff: now, kind: 'NEW' }); } return; }
            var d = Math.round((now - was) * 100) / 100;
            if (!now && was) { m.clearedN++; moves.push({ account: r.account, name: r.name, was: was, now: 0, diff: d, kind: 'CLEARED' }); }
            else if (d > 0) { m.upN++; moves.push({ account: r.account, name: r.name, was: was, now: now, diff: d, kind: 'UP' }); }
            else if (d < 0) { m.downN++; moves.push({ account: r.account, name: r.name, was: was, now: now, diff: d, kind: 'DOWN' }); }
        });
        Object.keys(prev).forEach(function (k) { if (!seen[k] && prev[k]) { m.clearedN++; moves.push({ account: k, name: '', was: prev[k], now: 0, diff: -prev[k], kind: 'CLEARED' }); } });
        m.prevTotal = Math.round(m.prevTotal * 100) / 100;
        m.top = moves.sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); }).slice(0, 15);
        return m;
    };
    /** archive rows (APEX) → customer objects for a statement run */
    E.fromArchive = function (rows) {
        return (rows || []).map(function (r) {
            var aging = r.CUR_AMT != null && r.CUR_AMT !== '' ? { current: +r.CUR_AMT || 0, d30: +r.D30 || 0, d60: +r.D60 || 0, d90: +r.D90 || 0, d90p: +r.D90P || 0 } : null;
            return { account: r.ACCOUNT_NUMBER, name: r.ACCOUNT_NAME || '', balance: +r.BALANCE || 0, overdue: r.OVERDUE != null && r.OVERDUE !== '' ? +r.OVERDUE : null, aging: aging, currency: r.CURRENCY || '', email: r.EMAIL || '', emailStat: '', lines: +r.ITEMS_N || 0, fromArchive: true };
        });
    };

    // ── the statement report ──
    E.sqlNorm = function (s) { return String(s || '').replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim().toUpperCase(); };
    /** the data sets of a BIP data model → one text (what is fingerprinted and compared) */
    E.modelText = function (model) {
        var ds = (model && (model.dataSets || model.DataSets)) || [];
        return ds.map(function (d) { return '-- data set: ' + (d.name || d.Name || '') + '\n' + String(d.sql || d.Sql || '').trim(); }).join('\n\n');
    };
    /** line diff (LCS, at most 1,500 lines a side) → [{t: ' ' | '+' | '-', s}] */
    E.lineDiff = function (a, b) {
        var x = String(a || '').split('\n').slice(0, 1500), y = String(b || '').split('\n').slice(0, 1500), n = x.length, m = y.length, L = [], i, j;
        for (i = 0; i <= n; i++) { L.push(new Array(m + 1).fill(0)); }
        for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
        var out = []; i = 0; j = 0;
        while (i < n && j < m) { if (x[i] === y[j]) { out.push({ t: ' ', s: x[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ t: '-', s: x[i++] }); } else out.push({ t: '+', s: y[j++] }); }
        while (i < n) out.push({ t: '-', s: x[i++] });
        while (j < m) out.push({ t: '+', s: y[j++] });
        return out;
    };
    /** Sample customers for the statement check: the largest balance, the oldest debt, a credit, one with many items */
    E.samples = function (customers) {
        var list = (customers || []).slice(), pick = [], seen = {};
        function add(x, why) { if (x && !seen[x.account]) { seen[x.account] = 1; pick.push({ c: x, why: why }); } }
        add(list.slice().sort(function (a, b) { return (b.balance || 0) - (a.balance || 0); })[0], 'largest balance');
        add(list.filter(function (x) { return x.aging && x.aging.d90p > 0; }).sort(function (a, b) { return b.aging.d90p - a.aging.d90p; })[0], 'oldest debt');
        add(list.filter(function (x) { return x.balance < 0; })[0], 'credit balance');
        add(list.slice().sort(function (a, b) { return (b.lines || 0) - (a.lines || 0); })[0], 'most lines');
        return pick;
    };

    // ── sending and the cycle's state ──
    /** archive rows × the cycle's statements → per customer the latest statement + counts */
    E.coverage = function (rows, stmts) {
        var latest = {}, c = { customers: 0, deliverable: 0, emailed: 0, posted: 0, drafts: 0, failed: 0, skipped: 0, notSent: 0, opened: 0, agreed: 0, disputed: 0, bounced: 0 };
        (stmts || []).forEach(function (s) { var k = s.ACCOUNT_NUMBER; if (!latest[k] || String(s.CREATED_AT || '') > String(latest[k].CREATED_AT || '') || (String(s.CREATED_AT || '') === String(latest[k].CREATED_AT || '') && String(s.STMT_ID) > String(latest[k].STMT_ID))) latest[k] = s; });
        var per = (rows || []).map(function (r) {
            c.customers++;
            var s = latest[r.ACCOUNT_NUMBER], deliverable = r.DELIVERY !== 'NONE';
            if (deliverable) c.deliverable++;
            if (!s) { if (deliverable) c.notSent++; return { row: r, stmt: null, state: deliverable ? 'NOT_SENT' : 'NONE' }; }
            var st = E.stmtState(s).key;
            if (s.STATUS === 'SENT') c.emailed++; else if (s.STATUS === 'DRAFT') c.drafts++; else if (s.STATUS === 'POSTED') c.posted++; else if (s.STATUS === 'FAILED') c.failed++; else if (s.STATUS === 'SKIPPED') c.skipped++; else if (deliverable) c.notSent++;
            if (+s.OPENS > 0 || s.READ_AT || s.RESP_STATUS) c.opened++;
            if (s.RESP_STATUS === 'AGREED') c.agreed++;
            if (s.RESP_STATUS === 'DISPUTED') c.disputed++;
            if (s.BOUNCED_AT) c.bounced++;
            return { row: r, stmt: s, state: st };
        });
        var done = c.emailed + c.posted + c.drafts;
        c.pct = c.deliverable ? Math.round(100 * done / c.deliverable) : 0;
        c.done = done;
        return { per: per, counts: c };
    };
    E.CYCLE_STEPS = [
        { key: 'checks', label: 'Checklist', icon: 'fa-list-check' }, { key: 'archive', label: 'Archive balances', icon: 'fa-box-archive' },
        { key: 'review', label: 'Statement check', icon: 'fa-magnifying-glass' }, { key: 'send', label: 'Send', icon: 'fa-paper-plane' }, { key: 'close', label: 'Close', icon: 'fa-flag-checkered' }
    ];
    /** cycle row (APEX, upper-case keys) → each step's state: done / active / locked, and the step to show */
    E.cycleSteps = function (cy) {
        var c = cy || {}, closed = c.STATUS === 'CLOSED';
        var done = { checks: !!c.CHECKS_AT, archive: !!c.SNAP_AT, review: !!c.REVIEW_AT, send: (+c.SENT_N || 0) + (+c.POSTED_N || 0) > 0, close: closed };
        var order = ['checks', 'archive', 'review', 'send', 'close'], first = null;
        order.forEach(function (k) { if (!first && !done[k]) first = k; });
        var steps = order.map(function (k) {
            // done / active (the next thing to do) / open (may be used now) / locked (an earlier step is not done)
            var st = closed ? 'done' : done[k] ? 'done' : k === first ? 'active' : (k === 'close' || k === 'send') && done.review ? 'open' : 'locked';
            return { key: k, state: st };
        });
        return { steps: steps, active: closed ? 'close' : first || 'close', closed: closed, done: done };
    };
    E.CYCLE_STATUS = { OPEN: { label: 'Open', cls: 'info' }, CHECKED: { label: 'Checklist done', cls: 'info' }, ARCHIVED: { label: 'Balances archived', cls: 'vio' }, READY: { label: 'Ready to send', cls: 'warn' }, SENDING: { label: 'Sending', cls: 'warn' }, CLOSED: { label: 'Closed', cls: 'ok' } };

    if (typeof module !== 'undefined' && module.exports) module.exports = E;
    root.DCE = E;
})(typeof window !== 'undefined' ? window : globalThis);
