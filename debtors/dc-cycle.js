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
        v.ONLY_DIFF = 'Y';
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
          sql: "SELECT cr.receipt_number, TO_CHAR(cr.receipt_date, 'YYYY-MM-DD') AS receipt_date, ca.account_number, p.party_name AS customer, ps.amount_due_remaining AS amount, cr.cash_receipt_id\n  FROM ar_payment_schedules_all ps\n  JOIN ar_cash_receipts_all cr ON cr.cash_receipt_id = ps.cash_receipt_id\n  LEFT JOIN hz_cust_accounts ca ON ca.cust_account_id = ps.customer_id\n  LEFT JOIN hz_parties p ON p.party_id = ca.party_id\n WHERE ps.class = 'PMT' AND ps.status = 'OP' AND ps.amount_due_remaining <> 0\n   AND ps.org_id = {BU_ID} AND ps.gl_date <= " + D + "\n ORDER BY ps.amount_due_remaining" },
        { id: 'UNIDENTIFIED_RECEIPTS', area: 'Receipts', severity: 'BLOCK', kind: 'SQL', title: 'No unidentified receipts',
          help: 'Money received without a customer — it belongs on somebody\'s statement.',
          sql: "SELECT cr.receipt_number, TO_CHAR(cr.receipt_date, 'YYYY-MM-DD') AS receipt_date, cr.amount AS amount, cr.comments, cr.cash_receipt_id\n  FROM ar_cash_receipts_all cr\n WHERE cr.status = 'UNID' AND cr.org_id = {BU_ID} AND cr.receipt_date <= " + D },
        { id: 'INCOMPLETE_TRX', area: 'AR', severity: 'BLOCK', kind: 'SQL', title: 'No incomplete AR transactions',
          help: 'Invoices and credit memos saved but not completed are missing from the statement.',
          sql: "SELECT t.trx_number, TO_CHAR(t.trx_date, 'YYYY-MM-DD') AS trx_date, ca.account_number, p.party_name AS customer, t.customer_trx_id\n  FROM ra_customer_trx_all t\n  LEFT JOIN hz_cust_accounts ca ON ca.cust_account_id = t.bill_to_customer_id\n  LEFT JOIN hz_parties p ON p.party_id = ca.party_id\n WHERE t.complete_flag = 'N' AND t.org_id = {BU_ID} AND t.trx_date <= " + D },
        { id: 'AR_NOT_ACCOUNTED', area: 'AR', severity: 'BLOCK', kind: 'SQL', title: 'Every AR transaction and receipt accounted',
          help: 'Receivables transactions and receipts up to the statement date whose accounting is not created yet (Create Accounting not run, draft or in error).',
          sql: "SELECT te.entity_code AS kind, te.transaction_number AS trx_number, TO_CHAR(e.event_date, 'YYYY-MM-DD') AS event_date, e.event_type_code,\n" +
               "       CASE WHEN e.process_status_code = 'E' THEN 'Error' WHEN e.process_status_code = 'D' THEN 'Draft' WHEN e.process_status_code IN ('I', 'R') THEN 'Invalid'\n" +
               "            WHEN e.event_status_code = 'I' THEN 'Incomplete' ELSE 'Not accounted' END AS acct_status,\n" +
               "       ca.account_number, p.party_name AS customer,\n" +
               "       CASE WHEN te.entity_code = 'RECEIPTS' THEN cr.amount ELSE (SELECT SUM(ps.amount_due_original) FROM ar_payment_schedules_all ps WHERE ps.customer_trx_id = t.customer_trx_id) END AS amount,\n" +
               "       te.source_id_int_1 AS source_id, e.event_id\n" +
               "  FROM xla_events e\n  JOIN xla_transaction_entities te ON te.entity_id = e.entity_id AND te.application_id = e.application_id\n" +
               "  LEFT JOIN ra_customer_trx_all t ON te.entity_code = 'TRANSACTIONS' AND t.customer_trx_id = te.source_id_int_1\n" +
               "  LEFT JOIN ar_cash_receipts_all cr ON te.entity_code = 'RECEIPTS' AND cr.cash_receipt_id = te.source_id_int_1\n" +
               "  LEFT JOIN hz_cust_accounts ca ON ca.cust_account_id = NVL(t.bill_to_customer_id, cr.pay_from_customer)\n" +
               "  LEFT JOIN hz_parties p ON p.party_id = ca.party_id\n" +
               " WHERE e.application_id = 222 AND e.event_status_code <> 'N'\n   AND (e.event_status_code IN ('U', 'I') OR e.process_status_code IN ('E', 'D', 'I', 'R'))\n" +
               "   AND te.security_id_int_1 = {BU_ID} AND e.event_date <= " + D + "\n ORDER BY e.event_date" },
        { id: 'AR_NOT_IN_GL', area: 'AR', severity: 'BLOCK', kind: 'SQL', title: 'Every AR journal transferred to GL',
          help: 'Receivables accounting created in final mode but not transferred to the General Ledger yet — the GL balance and the statements would not agree.',
          sql: "SELECT te.entity_code AS kind, te.transaction_number AS trx_number, TO_CHAR(h.accounting_date, 'YYYY-MM-DD') AS accounting_date, h.event_type_code, h.gl_transfer_status_code,\n" +
               "       'Accounted, not in GL' AS acct_status, ca.account_number, p.party_name AS customer,\n" +
               "       (SELECT SUM(NVL(al.accounted_dr, 0)) FROM xla_ae_lines al WHERE al.ae_header_id = h.ae_header_id AND al.application_id = h.application_id) AS amount,\n" +
               "       te.source_id_int_1 AS source_id, h.ae_header_id\n" +
               "  FROM xla_ae_headers h\n  JOIN xla_transaction_entities te ON te.entity_id = h.entity_id AND te.application_id = h.application_id\n" +
               "  LEFT JOIN ra_customer_trx_all t ON te.entity_code = 'TRANSACTIONS' AND t.customer_trx_id = te.source_id_int_1\n" +
               "  LEFT JOIN ar_cash_receipts_all cr ON te.entity_code = 'RECEIPTS' AND cr.cash_receipt_id = te.source_id_int_1\n" +
               "  LEFT JOIN hz_cust_accounts ca ON ca.cust_account_id = NVL(t.bill_to_customer_id, cr.pay_from_customer)\n" +
               "  LEFT JOIN hz_parties p ON p.party_id = ca.party_id\n" +
               " WHERE h.application_id = 222 AND h.accounting_entry_status_code = 'F' AND NVL(h.gl_transfer_status_code, 'N') <> 'Y'\n" +
               "   AND te.security_id_int_1 = {BU_ID} AND h.accounting_date <= " + D + "\n ORDER BY h.accounting_date" },
        { id: 'AUTOINVOICE_PENDING', area: 'OM → AR', severity: 'BLOCK', kind: 'SQL', title: 'Nothing waiting in AutoInvoice',
          help: 'Billing lines from Order Management still in the AutoInvoice interface (not imported, or in error).',
          sql: "SELECT l.interface_line_context, l.sales_order, l.description, l.amount AS amount, (SELECT MAX(er.message_text) FROM ra_interface_errors_all er WHERE er.interface_line_id = l.interface_line_id) AS error\n  FROM ra_interface_lines_all l\n WHERE l.org_id = {BU_ID}" },
        { id: 'OM_NOT_BILLED', area: 'OM → AR', severity: 'BLOCK', kind: 'SQL', title: 'Every shipped order line is billed',
          help: 'Order lines shipped by the statement date but not invoiced in Receivables yet.',
          sql: "SELECT ca.account_number, p.party_name AS customer, h.order_number, h.header_id, fl.fulfill_line_number, fl.status_code, TO_CHAR(fl.actual_ship_date, 'YYYY-MM-DD') AS shipped, fl.extended_amount AS amount\n" +
               "  FROM doo_fulfill_lines_all fl\n  JOIN doo_headers_all h ON h.header_id = fl.header_id\n" +
               "  LEFT JOIN hz_cust_accounts ca ON ca.cust_account_id = NVL(fl.bill_to_customer_id, h.sold_to_customer_id)\n  LEFT JOIN hz_parties p ON p.party_id = ca.party_id\n" +
               " WHERE h.org_id = {BU_ID} AND fl.status_code IN ('SHIPPED', 'AWAIT_BILLING')\n   AND fl.actual_ship_date < " + D + " + 1\n ORDER BY fl.actual_ship_date" },
        { id: 'OM_AR_AMOUNTS', area: 'OM → AR', severity: 'BLOCK', kind: 'SQL', title: 'OM and AR amounts of the month agree', compare: true,
          help: 'Per customer and order: order lines shipped this month (OM) vs AR invoice lines of the month that carry the order. A row comes back when they differ by more than the tolerance — with the accounting status of its invoices.',
          sql: "WITH om AS (SELECT h.header_id, h.order_number, NVL(fl.bill_to_customer_id, h.sold_to_customer_id) AS cust_id,\n" +
               "                   SUM(fl.extended_amount) AS om_amount, COUNT(*) AS om_lines, MAX(fl.actual_ship_date) AS shipped\n" +
               "              FROM doo_fulfill_lines_all fl JOIN doo_headers_all h ON h.header_id = fl.header_id\n" +
               "             WHERE h.org_id = {BU_ID} AND fl.actual_ship_date >= " + D0 + " AND fl.actual_ship_date < " + D + " + 1\n" +
               "               AND fl.status_code IN ('SHIPPED', 'AWAIT_BILLING', 'BILLED', 'CLOSED')\n" +
               "             GROUP BY h.header_id, h.order_number, NVL(fl.bill_to_customer_id, h.sold_to_customer_id)),\n" +
               "     ar AS (SELECT l.sales_order AS order_number, MAX(t.bill_to_customer_id) AS cust_id, SUM(l.extended_amount) AS ar_amount,\n" +
               "                   COUNT(DISTINCT t.customer_trx_id) AS ar_trx, MIN(t.trx_number) AS trx_number, MIN(t.customer_trx_id) AS customer_trx_id,\n" +
               "                   SUM(CASE WHEN t.complete_flag = 'Y' THEN 0 ELSE 1 END) AS incomplete_lines\n" +
               "              FROM ra_customer_trx_lines_all l JOIN ra_customer_trx_all t ON t.customer_trx_id = l.customer_trx_id\n" +
               "             WHERE t.org_id = {BU_ID} AND l.line_type = 'LINE' AND l.sales_order IS NOT NULL\n" +
               "               AND t.trx_date >= " + D0 + " AND t.trx_date < " + D + " + 1\n" +
               "             GROUP BY l.sales_order),\n" +
               "     acc AS (SELECT x.sales_order AS order_number, COUNT(e.event_id) AS events,\n" +
               "                    SUM(CASE WHEN e.event_status_code IN ('U', 'I') OR e.process_status_code IN ('E', 'D', 'I', 'R') THEN 1 ELSE 0 END) AS not_accounted,\n" +
               "                    SUM(CASE WHEN e.process_status_code = 'E' THEN 1 ELSE 0 END) AS in_error\n" +
               "               FROM (SELECT DISTINCT l.customer_trx_id, l.sales_order FROM ra_customer_trx_lines_all l JOIN ra_customer_trx_all t ON t.customer_trx_id = l.customer_trx_id\n" +
               "                      WHERE t.org_id = {BU_ID} AND l.line_type = 'LINE' AND l.sales_order IS NOT NULL AND t.trx_date >= " + D0 + " AND t.trx_date < " + D + " + 1) x\n" +
               "               JOIN xla_transaction_entities te ON te.application_id = 222 AND te.entity_code = 'TRANSACTIONS' AND te.source_id_int_1 = x.customer_trx_id\n" +
               "               JOIN xla_events e ON e.application_id = 222 AND e.entity_id = te.entity_id AND e.event_status_code <> 'N'\n" +
               "              GROUP BY x.sales_order)\n" +
               "SELECT ca.account_number, p.party_name AS customer, NVL(om.order_number, ar.order_number) AS order_number, om.header_id,\n" +
               "       NVL(om.om_amount, 0) AS om_amount, NVL(ar.ar_amount, 0) AS ar_amount, NVL(om.om_amount, 0) - NVL(ar.ar_amount, 0) AS amount,\n" +
               "       CASE WHEN ar.order_number IS NULL THEN 'Shipped, not invoiced this month' WHEN om.order_number IS NULL THEN 'Invoiced, not shipped this month' ELSE 'Amounts differ' END AS difference,\n" +
               "       CASE WHEN ar.order_number IS NULL THEN 'No invoice' WHEN NVL(acc.events, 0) = 0 THEN 'No accounting event' WHEN acc.in_error > 0 THEN 'Error'\n" +
               "            WHEN acc.not_accounted > 0 THEN 'Not accounted' ELSE 'Accounted' END AS acct_status,\n" +
               "       ar.trx_number, ar.customer_trx_id, NVL(ar.ar_trx, 0) AS invoices, NVL(om.om_lines, 0) AS om_lines, TO_CHAR(om.shipped, 'YYYY-MM-DD') AS shipped\n" +
               "  FROM om FULL OUTER JOIN ar ON ar.order_number = om.order_number\n" +
               "  LEFT JOIN acc ON acc.order_number = NVL(om.order_number, ar.order_number)\n" +
               "  LEFT JOIN hz_cust_accounts ca ON ca.cust_account_id = NVL(om.cust_id, ar.cust_id)\n" +
               "  LEFT JOIN hz_parties p ON p.party_id = ca.party_id\n" +
               " WHERE ('{ONLY_DIFF}' = 'N' OR ABS(NVL(om.om_amount, 0) - NVL(ar.ar_amount, 0)) > {TOLERANCE})\n" +
               " ORDER BY ABS(NVL(om.om_amount, 0) - NVL(ar.ar_amount, 0)) DESC" },
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
    // ── drill-down: the transactions behind a row, each part one read-only Fusion query ──
    var ACCT_CASE = "CASE WHEN COUNT(*) = 0 THEN 'No accounting event' WHEN SUM(CASE WHEN e.process_status_code = 'E' THEN 1 ELSE 0 END) > 0 THEN 'Error' " +
        "WHEN SUM(CASE WHEN e.event_status_code IN ('U', 'I') OR e.process_status_code IN ('D', 'I', 'R') THEN 1 ELSE 0 END) > 0 THEN 'Not accounted' ELSE 'Accounted' END";
    function acctOf(entity, idExpr) {
        return "(SELECT " + ACCT_CASE + " FROM xla_transaction_entities te JOIN xla_events e ON e.entity_id = te.entity_id AND e.application_id = 222 AND e.event_status_code <> 'N'" +
            " WHERE te.application_id = 222 AND te.entity_code = '" + entity + "' AND te.source_id_int_1 = " + idExpr + ")";
    }
    function journal(entity, idWhere) {
        return "SELECT TO_CHAR(h.accounting_date, 'YYYY-MM-DD') AS accounting_date, h.event_type_code, h.accounting_entry_status_code AS entry_status, h.gl_transfer_status_code AS gl_transfer,\n" +
            "       al.ae_line_num AS line, al.accounting_class_code AS class,\n" +
            "       cc.segment1 || '.' || cc.segment2 || '.' || cc.segment3 || '.' || cc.segment4 || '.' || cc.segment5 || '.' || cc.segment6 AS account,\n" +
            "       al.entered_dr, al.entered_cr, al.accounted_dr, al.accounted_cr, h.ae_header_id\n" +
            "  FROM xla_transaction_entities te\n  JOIN xla_ae_headers h ON h.entity_id = te.entity_id AND h.application_id = te.application_id\n" +
            "  JOIN xla_ae_lines al ON al.ae_header_id = h.ae_header_id AND al.application_id = h.application_id\n" +
            "  LEFT JOIN gl_code_combinations cc ON cc.code_combination_id = al.code_combination_id\n" +
            " WHERE te.application_id = 222 AND te.entity_code = '" + entity + "' AND te.source_id_int_1 " + idWhere + "\n ORDER BY h.accounting_date, h.ae_header_id, al.ae_line_num";
    }
    function events(entity, idWhere) {
        return "SELECT te.transaction_number AS trx_number, e.event_id, e.event_type_code, TO_CHAR(e.event_date, 'YYYY-MM-DD') AS event_date,\n" +
            "       CASE WHEN e.process_status_code = 'P' THEN 'Accounted' WHEN e.process_status_code = 'E' THEN 'Error' WHEN e.process_status_code = 'D' THEN 'Draft'\n" +
            "            WHEN e.event_status_code = 'N' THEN 'No accounting needed' WHEN e.event_status_code = 'I' THEN 'Incomplete' ELSE 'Not accounted' END AS acct_status,\n" +
            "       e.event_status_code, e.process_status_code\n" +
            "  FROM xla_transaction_entities te JOIN xla_events e ON e.entity_id = te.entity_id AND e.application_id = te.application_id\n" +
            " WHERE te.application_id = 222 AND te.entity_code = '" + entity + "' AND te.source_id_int_1 " + idWhere + "\n ORDER BY e.event_date, e.event_id";
    }
    var TRX_OF_ORDER = "IN (SELECT DISTINCT l.customer_trx_id FROM ra_customer_trx_lines_all l WHERE l.sales_order = '{ORDER_NUMBER}' AND l.line_type = 'LINE')";
    /** kind → {title, parts: [{id, title, sql}]}; placeholders {ORDER_NUMBER} {HEADER_ID} {TRX_ID} {RECEIPT_ID} {BU_ID} */
    E.DRILLS = {
        ORDER: { title: 'Sales order', parts: [
            { id: 'om', title: 'Order lines (Order Management)', sql: "SELECT fl.fulfill_line_number AS line, i.item_number AS item, fl.ordered_qty, fl.shipped_qty, fl.ordered_uom AS uom, fl.status_code AS status,\n" +
                "       TO_CHAR(fl.actual_ship_date, 'YYYY-MM-DD') AS shipped, fl.unit_selling_price AS price, fl.extended_amount AS amount, fl.fulfill_line_id\n" +
                "  FROM doo_fulfill_lines_all fl\n  JOIN doo_headers_all h ON h.header_id = fl.header_id\n" +
                "  LEFT JOIN egp_system_items_b i ON i.inventory_item_id = fl.inventory_item_id AND i.organization_id = fl.fulfill_org_id\n" +
                " WHERE h.order_number = '{ORDER_NUMBER}' AND h.org_id = {BU_ID}\n ORDER BY fl.fulfill_line_number" },
            { id: 'ar', title: 'AR invoice lines that carry the order', sql: "SELECT t.trx_number, TO_CHAR(t.trx_date, 'YYYY-MM-DD') AS trx_date, tt.name AS trx_type, l.line_number AS line, l.description,\n" +
                "       l.quantity_invoiced AS qty, l.unit_selling_price AS price, l.extended_amount AS amount, l.sales_order_line AS order_line, t.complete_flag,\n" +
                "       " + acctOf('TRANSACTIONS', 't.customer_trx_id') + " AS acct_status,\n       t.customer_trx_id\n" +
                "  FROM ra_customer_trx_lines_all l\n  JOIN ra_customer_trx_all t ON t.customer_trx_id = l.customer_trx_id\n" +
                "  LEFT JOIN ra_cust_trx_types_all tt ON tt.cust_trx_type_seq_id = t.cust_trx_type_seq_id\n" +
                " WHERE l.sales_order = '{ORDER_NUMBER}' AND l.line_type = 'LINE' AND t.org_id = {BU_ID}\n ORDER BY t.trx_date, t.trx_number, l.line_number" },
            { id: 'ai', title: 'Waiting in AutoInvoice', sql: "SELECT l.batch_source_name, l.line_type, l.description, l.quantity, l.amount, TO_CHAR(l.creation_date, 'YYYY-MM-DD HH24:MI') AS created,\n" +
                "       (SELECT MAX(er.message_text) FROM ra_interface_errors_all er WHERE er.interface_line_id = l.interface_line_id) AS error, l.interface_line_id\n" +
                "  FROM ra_interface_lines_all l\n WHERE l.sales_order = '{ORDER_NUMBER}' AND l.org_id = {BU_ID}" },
            { id: 'ev', title: 'Accounting events of its invoices', sql: events('TRANSACTIONS', TRX_OF_ORDER) }
        ] },
        TRX: { title: 'AR transaction', parts: [
            { id: 'hd', title: 'Transaction', sql: "SELECT t.trx_number, TO_CHAR(t.trx_date, 'YYYY-MM-DD') AS trx_date, tt.name AS trx_type, ca.account_number, p.party_name AS customer, t.invoice_currency_code AS currency,\n" +
                "       (SELECT SUM(ps.amount_due_original) FROM ar_payment_schedules_all ps WHERE ps.customer_trx_id = t.customer_trx_id) AS amount,\n" +
                "       (SELECT SUM(ps.amount_due_remaining) FROM ar_payment_schedules_all ps WHERE ps.customer_trx_id = t.customer_trx_id) AS remaining,\n" +
                "       t.complete_flag, " + acctOf('TRANSACTIONS', 't.customer_trx_id') + " AS acct_status, t.ct_reference AS reference, t.customer_trx_id\n" +
                "  FROM ra_customer_trx_all t\n  LEFT JOIN ra_cust_trx_types_all tt ON tt.cust_trx_type_seq_id = t.cust_trx_type_seq_id\n" +
                "  LEFT JOIN hz_cust_accounts ca ON ca.cust_account_id = t.bill_to_customer_id\n  LEFT JOIN hz_parties p ON p.party_id = ca.party_id\n WHERE t.customer_trx_id = {TRX_ID}" },
            { id: 'ln', title: 'Lines', sql: "SELECT l.line_number AS line, l.line_type, l.description, l.quantity_invoiced AS qty, l.unit_selling_price AS price, l.extended_amount AS amount, l.sales_order AS order_number, l.sales_order_line AS order_line\n" +
                "  FROM ra_customer_trx_lines_all l\n WHERE l.customer_trx_id = {TRX_ID}\n ORDER BY l.line_number" },
            { id: 'ev', title: 'Accounting events', sql: events('TRANSACTIONS', '= {TRX_ID}') },
            { id: 'je', title: 'Journal lines (Subledger Accounting)', sql: journal('TRANSACTIONS', '= {TRX_ID}') }
        ] },
        RECEIPT: { title: 'Receipt', parts: [
            { id: 'hd', title: 'Receipt', sql: "SELECT cr.receipt_number, TO_CHAR(cr.receipt_date, 'YYYY-MM-DD') AS receipt_date, cr.amount, cr.currency_code AS currency, cr.status, ca.account_number, p.party_name AS customer,\n" +
                "       " + acctOf('RECEIPTS', 'cr.cash_receipt_id') + " AS acct_status, cr.comments, cr.cash_receipt_id\n" +
                "  FROM ar_cash_receipts_all cr\n  LEFT JOIN hz_cust_accounts ca ON ca.cust_account_id = cr.pay_from_customer\n  LEFT JOIN hz_parties p ON p.party_id = ca.party_id\n WHERE cr.cash_receipt_id = {RECEIPT_ID}" },
            { id: 'ap', title: 'Applications', sql: "SELECT ra.status, TO_CHAR(ra.apply_date, 'YYYY-MM-DD') AS apply_date, TO_CHAR(ra.gl_date, 'YYYY-MM-DD') AS gl_date, t.trx_number, ra.amount_applied, ra.display, t.customer_trx_id\n" +
                "  FROM ar_receivable_applications_all ra\n  LEFT JOIN ra_customer_trx_all t ON t.customer_trx_id = ra.applied_customer_trx_id\n WHERE ra.cash_receipt_id = {RECEIPT_ID}\n ORDER BY ra.apply_date" },
            { id: 'ev', title: 'Accounting events', sql: events('RECEIPTS', '= {RECEIPT_ID}') },
            { id: 'je', title: 'Journal lines (Subledger Accounting)', sql: journal('RECEIPTS', '= {RECEIPT_ID}') }
        ] }
    };
    function digits(v) { var s = String(v == null ? '' : v).trim(); return /^\d+$/.test(s) ? s : ''; }
    function get(row, k) { if (!row) return ''; var x = row[k]; if (x == null) x = row[k.toLowerCase()]; return x == null ? '' : String(x); }
    E.drillOf = function (kind, v) {
        var vars = Object.assign({}, v), num = kind === 'ORDER' ? vars.ORDER_NUMBER : vars.NUMBER || vars.TRX_ID || vars.RECEIPT_ID;
        var key = kind === 'ORDER' ? 'ORDER:' + vars.ORDER_NUMBER : kind === 'TRX' ? 'TRX:' + vars.TRX_ID : 'RECEIPT:' + vars.RECEIPT_ID;
        return { kind: kind, key: key, vars: vars, label: (E.DRILLS[kind] || {}).title + ' ' + num };
    };
    /** a check's row → what it opens: {kind, key, vars, label} or null */
    E.rowDrill = function (row) {
        var kind = get(row, 'KIND').toUpperCase(), src = digits(get(row, 'SOURCE_ID'));
        if (get(row, 'ORDER_NUMBER')) return E.drillOf('ORDER', { ORDER_NUMBER: get(row, 'ORDER_NUMBER'), HEADER_ID: digits(get(row, 'HEADER_ID')) });
        if (kind === 'RECEIPTS' && src) return E.drillOf('RECEIPT', { RECEIPT_ID: src, NUMBER: get(row, 'TRX_NUMBER') });
        if (kind === 'TRANSACTIONS' && src) return E.drillOf('TRX', { TRX_ID: src, NUMBER: get(row, 'TRX_NUMBER') });
        if (digits(get(row, 'CUSTOMER_TRX_ID'))) return E.drillOf('TRX', { TRX_ID: digits(get(row, 'CUSTOMER_TRX_ID')), NUMBER: get(row, 'TRX_NUMBER') });
        if (digits(get(row, 'CASH_RECEIPT_ID'))) return E.drillOf('RECEIPT', { RECEIPT_ID: digits(get(row, 'CASH_RECEIPT_ID')), NUMBER: get(row, 'RECEIPT_NUMBER') });
        return null;
    };
    /** the SQL of one drill part with its placeholders filled (ids must be digits; an order number is quoted) */
    E.drillSql = function (part, vars, bu) {
        var v = { BU_ID: digits(bu && bu.id) || '0', ORDER_NUMBER: String(vars.ORDER_NUMBER || ''), HEADER_ID: digits(vars.HEADER_ID) || '0', TRX_ID: digits(vars.TRX_ID) || '0', RECEIPT_ID: digits(vars.RECEIPT_ID) || '0' };
        return E.fill(part.sql, v, 'sql');
    };
    /** which grid cells open something: ORDER_NUMBER → the order, TRX_NUMBER → the transaction (when the row has its id),
     *  RECEIPT_NUMBER → the receipt, ACCOUNT_NUMBER → the customer */
    E.cellLink = function (col, row) {
        var c = String(col).toUpperCase(), kind = get(row, 'KIND').toUpperCase(), src = digits(get(row, 'SOURCE_ID'));
        if (c === 'ORDER_NUMBER' && get(row, c)) return { open: E.drillOf('ORDER', { ORDER_NUMBER: get(row, c), HEADER_ID: digits(get(row, 'HEADER_ID')) }), fusion: 'ORDER', id: digits(get(row, 'HEADER_ID')), number: get(row, c) };
        if (c === 'TRX_NUMBER' || c === 'TRANSACTION_NUMBER') {
            if (kind === 'RECEIPTS' && src) return { open: E.drillOf('RECEIPT', { RECEIPT_ID: src, NUMBER: get(row, c) }), fusion: 'RECEIPT', id: src, number: get(row, c) };
            var id = digits(get(row, 'CUSTOMER_TRX_ID')) || (kind === 'TRANSACTIONS' ? src : '');
            if (id) return { open: E.drillOf('TRX', { TRX_ID: id, NUMBER: get(row, c) }), fusion: 'TRX', id: id, number: get(row, c) };
        }
        if (c === 'RECEIPT_NUMBER' && digits(get(row, 'CASH_RECEIPT_ID'))) return { open: E.drillOf('RECEIPT', { RECEIPT_ID: digits(get(row, 'CASH_RECEIPT_ID')), NUMBER: get(row, c) }), fusion: 'RECEIPT', id: digits(get(row, 'CASH_RECEIPT_ID')), number: get(row, c) };
        if (c === 'ACCOUNT_NUMBER' && get(row, c)) return { customer: get(row, c) };
        return null;
    };

    // ── links into Oracle Fusion ──
    /** The sales order link is Oracle's documented one (Order Management › Create Direct Links to Order Management Pages);
     *  the others come from Setup (copy one from your pod) — {BASE} {ID} {NUMBER} filled in. Empty = no direct link: the
     *  number is copied and Fusion opens on its home page instead. */
    E.LINK_DEFAULTS = {
        ORDER: '{BASE}/fndSetup/faces/deeplink?objType=SALES_ORDER&action=VIEW&objKey=HeaderId={ID}',
        ORDER_BY_NUMBER: '{BASE}/fndSetup/faces/deeplink?objType=SALES_ORDER&action=VIEW&objKey=OrderNumber={NUMBER}',
        TRX: '', RECEIPT: '', HOME: '{BASE}/fscmUI/faces/FuseWelcome'
    };
    E.POD_BASE = { PROD: 'https://efmh.fa.em3.oraclecloud.com', TEST: 'https://efmh-test.fa.em3.oraclecloud.com' };
    E.fusionUrl = function (kind, ids, base, templates) {
        var t = Object.assign({}, E.LINK_DEFAULTS), b = String(base || '').replace(/\/+$/, ''), id = digits(ids && ids.id), num = String((ids && ids.number) || '');
        Object.keys(templates || {}).forEach(function (k) { if (templates[k]) t[k] = templates[k]; });
        if (!/^https:\/\//i.test(b)) return null;
        var tpl = kind === 'ORDER' ? (id ? t.ORDER : t.ORDER_BY_NUMBER) : t[kind];
        if (!tpl || (/\{ID\}/.test(tpl) && !id) || (/\{NUMBER\}/.test(tpl) && !num)) return null;
        return tpl.replace(/\{BASE\}/g, b).replace(/\{ID\}/g, encodeURIComponent(id)).replace(/\{NUMBER\}/g, encodeURIComponent(num));
    };
    /** a grid's totals: the amount columns added up + the count per value of a status-like column */
    E.gridSummary = function (rows, cols) {
        var sums = {}, counts = {};
        (cols || []).forEach(function (c) {
            var C = String(c).toUpperCase();
            if (/AMOUNT|^ENTERED_|^ACCOUNTED_|REMAINING/.test(C)) { var t = 0; (rows || []).forEach(function (r) { t += E.num(r[c]) || 0; }); sums[c] = Math.round(t * 100) / 100; }
            if (/ACCT_STATUS|^DIFFERENCE$|^KIND$/.test(C)) { var m = {}; (rows || []).forEach(function (r) { var v = r[c] == null || r[c] === '' ? '(blank)' : String(r[c]); m[v] = (m[v] || 0) + 1; }); counts[c] = m; }
        });
        return { sums: sums, counts: counts };
    };

    /** What sending needs from a cycle that is not ready: the checks to bypass (blocking failures, errors, not run), the
     *  archive (made now from the balances read) and the statement check (signed off with the same comment). */
    E.sendPlan = function (checks, results, cy) {
        var g = E.gate(checks, results), c = cy || {}, by = {};
        (checks || []).forEach(function (x) { by[x.id] = x; });
        var bypass = g.blocking.concat(g.pending).map(function (id) { var r = (results || {})[id] || {}; return { id: id, title: (by[id] || {}).title || id, state: !r.status || r.status === 'RUNNING' ? 'not run' : r.status === 'ERROR' ? 'could not run' : (r.rows != null ? r.rows + ' found' : 'failed') }; });
        return { bypass: bypass, warnings: g.warnings.slice(), archive: !c.SNAP_AT, review: !c.REVIEW_AT, checksDone: !!c.CHECKS_AT, ready: !bypass.length && !!c.SNAP_AT && !!c.REVIEW_AT, gate: g };
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
            // done / active (the next thing to do) / open (may be used now)
            var st = closed ? 'done' : done[k] ? 'done' : k === first ? 'active' : 'open';   // every step may be opened; sending confirms (or bypasses) what is left
            return { key: k, state: st };
        });
        return { steps: steps, active: closed ? 'close' : first || 'close', closed: closed, done: done };
    };
    E.CYCLE_STATUS = { OPEN: { label: 'Open', cls: 'info' }, CHECKED: { label: 'Checklist done', cls: 'info' }, ARCHIVED: { label: 'Balances archived', cls: 'vio' }, READY: { label: 'Ready to send', cls: 'warn' }, SENDING: { label: 'Sending', cls: 'warn' }, CLOSED: { label: 'Closed', cls: 'ok' } };

    if (typeof module !== 'undefined' && module.exports) module.exports = E;
    root.DCE = E;
})(typeof window !== 'undefined' ? window : globalThis);
