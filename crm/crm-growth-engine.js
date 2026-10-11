/* Customer CRM · growth engine (window.CRMG, pure — runs in node for the tests): the ideas of Salesforce Consumer Goods Cloud,
 * Dynamics 365 Sales / Customer Insights, HubSpot and Zoho (Zia, Blueprint) brought into the CRM on the data it already has.
 *   Signals    one portfolio scan of Fusion sales (account × month, account × profit centre / supplier) + the service records
 *              → CHURN (orders dropped below the customer's own normal, or the gap since the last order is far longer than usual),
 *              LAPSED (a profit centre / supplier the customer bought last year and stopped), WHITESPACE (what most similar
 *              customers buy and this one never did — peers = same customer class, else the same size band), BOUNCED (a cheque
 *              reversed in Fusion), MRA (an invoice MRA refused), CANCEL (order lines cancelled out of stock on a recent trip).
 *              Every signal has a stable key, a score 0–100, the money at stake and the reason in plain words.
 *   Rules      per kind: on / off, thresholds and what happens when a signal appears — nothing (worklist), a follow-up task,
 *              a ticket, or a playbook.
 *   Playbooks  outreach cadences (call → e-mail → visit …) with day offsets; enrolments know the step due, late or done.
 *   Wallboard  live numbers for a supervisor screen (queues, SLA, calls, call-backs, agents, playbook steps, signals).
 *   Delivery   the customer's orders on WMS trips (APEX) with their stage.
 * The page (crm-growth.js) runs the SQL, keeps the scan on this PC (DuckDB) and the signals / enrolments in APEX. */
(function (root) {
    'use strict';
    var G = {};
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function stamp(d) { return iso(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    function parse(s) {
        if (s instanceof Date) return s;
        if (!s) return null;
        var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
        return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
    }
    function q(v) { return "'" + String(v == null ? '' : v).replace(/'/g, "''") + "'"; }
    function digits(v) { var s = String(v == null ? '' : v).trim(); return /^\d+$/.test(s) ? s : ''; }
    function round(v, d) { var p = Math.pow(10, d == null ? 2 : d); return Math.round((+v || 0) * p) / p; }
    function fmt0(v) { return Math.round(+v || 0).toLocaleString('en-US'); }
    function median(a) { var s = a.filter(function (x) { return isFinite(x); }).sort(function (x, y) { return x - y; }); if (!s.length) return 0; var m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    G.iso = iso; G.stamp = stamp; G.parse = parse; G.median = median;
    /** a dimension column of EGP_SYSTEM_ITEMS_B allowed in SQL (ATTRIBUTE1 … ATTRIBUTE30, ATTRIBUTE_CHAR1 …) or '' */
    G.dffCol = function (v) { v = String(v || '').trim().toUpperCase(); return /^ATTRIBUTE(_CHAR)?\d{1,2}$/.test(v) ? v : ''; };

    // ── settings ──────────────────────────────────────────────────
    G.KINDS = {
        CHURN: { label: 'Orders dropping', icon: 'fa-arrow-trend-down', cls: 'bad', group: 'grow', text: 'Buying well below its own normal, or not ordered for much longer than usual' },
        LAPSED: { label: 'Stopped buying a range', icon: 'fa-box-open', cls: 'warn', group: 'grow', text: 'A profit centre / supplier bought last year and not any more' },
        WHITESPACE: { label: 'Cross-sell', icon: 'fa-seedling', cls: 'ok', group: 'grow', text: 'What most similar customers buy and this one never did' },
        BOUNCED: { label: 'Bounced cheque', icon: 'fa-money-check', cls: 'bad', group: 'service', text: 'A receipt reversed in Fusion (insufficient funds, stop payment …)' },
        MRA: { label: 'Invoice refused by MRA', icon: 'fa-building-shield', cls: 'warn', group: 'service', text: 'The invoice of an order failed at the MRA gateway and is not fixed yet' },
        CANCEL: { label: 'Lines cancelled', icon: 'fa-ban', cls: 'warn', group: 'service', text: 'Order lines cancelled (out of stock) on a recent trip — tell the customer before they call' }
    };
    G.ACTIONS = { NONE: 'Worklist only', TASK: 'Follow-up task for the owner', TICKET: 'Open a ticket', PLAYBOOK: 'Start a playbook' };
    G.DEFAULTS = {
        dim: 'PROFIT_CENTER',            // what LAPSED / WHITESPACE look at: PROFIT_CENTER | SUPPLIER (the item DFF columns of the CRM setup)
        auto: true,                      // the scan runs by itself …
        scanHours: 24,                   // … when the last one is older than this (any PC with the CRM open)
        months: 24,
        rules: {
            CHURN: { on: true, minBase: 1000, dropPct: 40, gapFactor: 2, minGapDays: 21, action: 'PLAYBOOK', playbook: 'winback', minScore: 50 },
            LAPSED: { on: true, minPrev: 5000, slowPct: 70, action: 'NONE', playbook: 'winback', minScore: 60 },
            WHITESPACE: { on: true, minPeers: 5, minPenetration: 50, top: 3, action: 'NONE', playbook: 'crosssell', minScore: 0 },
            BOUNCED: { on: true, days: 14, action: 'PLAYBOOK', playbook: 'bounced', minScore: 0 },
            MRA: { on: true, days: 7, action: 'NONE', playbook: '', minScore: 0 },
            CANCEL: { on: true, days: 3, minLines: 1, action: 'TASK', playbook: 'service', minScore: 0 }
        },
        taskDays: 1,                     // a TASK action is due in n days
        ticketQueue: 'Customer care',
        playbooks: null                  // null = G.SEED_PLAYBOOKS
    };
    G.settings = function (saved) {
        var d = JSON.parse(JSON.stringify(G.DEFAULTS)), s = saved || {};
        Object.keys(s).forEach(function (k) { if (k !== 'rules' && s[k] !== undefined) d[k] = s[k]; });
        Object.keys(d.rules).forEach(function (k) { if (s.rules && s.rules[k]) d.rules[k] = Object.assign({}, d.rules[k], s.rules[k]); });
        if (!d.playbooks || !d.playbooks.length) d.playbooks = JSON.parse(JSON.stringify(G.SEED_PLAYBOOKS));
        return d;
    };

    // ── playbooks (outreach cadences) ─────────────────────────────
    G.STEP_KINDS = { CALL: { label: 'Call', icon: 'fa-phone' }, EMAIL: { label: 'E-mail', icon: 'fa-envelope' }, VISIT: { label: 'Visit', icon: 'fa-person-walking' }, TASK: { label: 'Task', icon: 'fa-list-check' }, TICKET: { label: 'Ticket', icon: 'fa-ticket' } };
    G.SEED_PLAYBOOKS = [
        { id: 'winback', name: 'Win back — orders dropping', for: ['CHURN', 'LAPSED'], stopOnOrder: true, steps: [
            { day: 0, kind: 'CALL', title: 'Check-in call', note: 'Ask how business is, whether anything went wrong (service, price, stock, delivery) and what they buy elsewhere. Log the reason.' },
            { day: 2, kind: 'EMAIL', title: 'E-mail: what they used to buy', subject: 'We miss your orders, {CONTACT}', body: 'Dear {CONTACT},\n\nWe noticed we have not received your usual orders lately. If anything on our side was not right — delivery, stock or price — please tell us and we will fix it.\n\nYour sales contact is ready to help with your next order.\n\nKind regards,\n{AGENT}' },
            { day: 7, kind: 'VISIT', title: 'Plan a visit by the sales rep', note: 'Bring the price list and the promotions of the month.' },
            { day: 14, kind: 'CALL', title: 'Follow-up call with an offer', note: 'If still no order: propose a trial order or a promotion on their former range.' }
        ] },
        { id: 'crosssell', name: 'Introduce a new range', for: ['WHITESPACE'], stopOnOrder: false, steps: [
            { day: 0, kind: 'CALL', title: 'Introduce the range', note: 'Similar customers buy it — mention the best sellers and the margin.' },
            { day: 1, kind: 'EMAIL', title: 'E-mail the range details', subject: 'A range your peers sell well', body: 'Dear {CONTACT},\n\nMany customers like you sell our {RANGE} range well. We would be glad to send you a first order to try.\n\nKind regards,\n{AGENT}' },
            { day: 10, kind: 'CALL', title: 'Ask for a first order' }
        ] },
        { id: 'bounced', name: 'Bounced cheque recovery', for: ['BOUNCED'], stopOnOrder: false, steps: [
            { day: 0, kind: 'CALL', title: 'Call about the returned cheque', note: 'Agree a replacement payment (cash / transfer) and a date. Log a promise to pay.' },
            { day: 0, kind: 'EMAIL', title: 'Confirm by e-mail', subject: 'Returned payment', body: 'Dear {CONTACT},\n\nYour payment {REF} was returned by the bank. Please arrange a replacement payment at your earliest convenience.\n\nKind regards,\n{AGENT}' },
            { day: 3, kind: 'TASK', title: 'Check the replacement payment arrived' },
            { day: 7, kind: 'TASK', title: 'Not paid: propose a credit hold to the credit controller' }
        ] },
        { id: 'service', name: 'Service recovery', for: ['CANCEL', 'MRA'], stopOnOrder: false, steps: [
            { day: 0, kind: 'CALL', title: 'Tell the customer before they call', note: 'Explain which lines could not be delivered and offer an alternative or the next delivery date.' },
            { day: 3, kind: 'CALL', title: 'Check they are happy with the solution' }
        ] },
        { id: 'onboard', name: 'New customer onboarding', for: [], stopOnOrder: false, steps: [
            { day: 0, kind: 'CALL', title: 'Welcome call', note: 'Introduce the order desk, delivery days, credit terms and the statement routine.' },
            { day: 1, kind: 'EMAIL', title: 'Welcome e-mail', subject: 'Welcome, {CUSTOMER}', body: 'Dear {CONTACT},\n\nWelcome! Your account number is {ACCOUNT_NUMBER}. For orders, deliveries or your statement just reply to this e-mail.\n\nKind regards,\n{AGENT}' },
            { day: 30, kind: 'CALL', title: 'First-month check-in' }
        ] }
    ];
    G.playbook = function (settings, id) { return ((settings || {}).playbooks || G.SEED_PLAYBOOKS).filter(function (p) { return p.id === id; })[0] || null; };
    /** "id | name | for kinds | stop on order" header lines + "day | KIND | title | note" step lines ⇄ playbooks (the editor's text form) */
    G.playbooksText = function (list) {
        return (list || []).map(function (p) {
            return '# ' + p.id + ' | ' + p.name + ' | ' + (p.for || []).join(', ') + ' | ' + (p.stopOnOrder ? 'stop on order' : '') + '\n' +
                p.steps.map(function (s) { return s.day + ' | ' + s.kind + ' | ' + s.title + ' | ' + String(s.note || s.body || '').replace(/\n/g, '\\n') + (s.subject ? ' | ' + s.subject : ''); }).join('\n');
        }).join('\n\n');
    };
    G.parsePlaybooks = function (text) {
        var out = [], cur = null, errs = [];
        String(text || '').split(/\r?\n/).forEach(function (line, i) {
            var l = line.trim(); if (!l) return;
            if (l[0] === '#') {
                var h = l.slice(1).split('|').map(function (x) { return x.trim(); });
                var id = String(h[0] || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
                if (!id) { errs.push('line ' + (i + 1) + ': a playbook needs an id'); cur = null; return; }
                cur = { id: id, name: h[1] || id, for: String(h[2] || '').toUpperCase().split(/[\s,]+/).filter(function (k) { return G.KINDS[k]; }), stopOnOrder: /stop/i.test(h[3] || ''), steps: [] };
                out.push(cur); return;
            }
            if (!cur) { errs.push('line ' + (i + 1) + ': a step before any "# id | name" line'); return; }
            var p = l.split('|').map(function (x) { return x.trim(); }), kind = String(p[1] || '').toUpperCase();
            if (!/^\d+$/.test(p[0] || '') || !G.STEP_KINDS[kind] || !p[2]) { errs.push('line ' + (i + 1) + ': "day | CALL/EMAIL/VISIT/TASK/TICKET | title | note"'); return; }
            var st = { day: +p[0], kind: kind, title: p[2] }, note = String(p[3] || '').replace(/\\n/g, '\n');
            if (kind === 'EMAIL') { st.body = note; if (p[4]) st.subject = p[4]; } else if (note) st.note = note;
            cur.steps.push(st);
        });
        out.forEach(function (p) { p.steps.sort(function (a, b) { return a.day - b.day; }); if (!p.steps.length) errs.push(p.id + ': no steps'); });
        return { list: out.filter(function (p) { return p.steps.length; }), errors: errs };
    };
    function addDaysAt(start, days) { var d = parse(start) || new Date(); var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (+days || 0), 9, 0); return x; }
    /**
     * Where an enrolment stands: play = {STEP_N (next step index), STARTED_AT, LAST_DONE_AT, STATUS, STEPS_JSON | steps}
     * → {status, done, total, step, due (YYYY-MM-DD HH:MI), late, today, next, progress} — a step is due at 09:00 on
     * start + its day, never before the previous step was done.
     */
    G.playState = function (play, now) {
        var n = parse(now) || new Date(), steps = play.steps || [];
        if (!steps.length && play.STEPS_JSON) { try { steps = JSON.parse(play.STEPS_JSON); } catch (e) { steps = []; } }
        var i = +play.STEP_N || 0, total = steps.length, status = play.STATUS || 'ACTIVE';
        var o = { status: status, done: Math.min(i, total), total: total, steps: steps, progress: total ? Math.round(Math.min(i, total) / total * 100) : 100, step: null, due: '', late: false, today: false, days: 0 };
        if (status !== 'ACTIVE' || i >= total) { o.status = status === 'ACTIVE' ? 'DONE' : status; return o; }
        var st = steps[i], due = addDaysAt(play.STARTED_AT, st.day), last = parse(play.LAST_DONE_AT);
        if (last && due < last) due = new Date(last.getFullYear(), last.getMonth(), last.getDate(), Math.max(9, last.getHours()), last.getMinutes());
        o.step = st; o.index = i; o.due = stamp(due);
        o.late = iso(due) < iso(n); o.today = iso(due) === iso(n); o.dueNow = due <= n;
        o.days = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(due.getFullYear(), due.getMonth(), due.getDate())) / 864e5);
        o.next = steps[i + 1] || null;
        return o;
    };
    /** fill a step's text: {CONTACT} {CUSTOMER} {ACCOUNT_NUMBER} {AGENT} {RANGE} {REF} {AMOUNT} */
    G.fill = function (text, v) { return String(text || '').replace(/\{([A-Z_]+)\}/g, function (m, k) { return v && v[k] != null && v[k] !== '' ? String(v[k]) : m === '{CONTACT}' ? 'Customer' : ''; }); };

    // ── the portfolio SQL (Fusion, read-only) ─────────────────────
    // the latest change version of a sales order without the correlated MAX(): a newer version of the same source order must not exist
    var LATEST = "NOT EXISTS (SELECT 1 FROM doo_headers_all x WHERE x.source_order_system = h.source_order_system AND x.source_order_number = h.source_order_number AND x.change_version_number > h.change_version_number)";
    var LATEST_MAX = "h.change_version_number = (SELECT MAX(x.change_version_number) FROM doo_headers_all x WHERE x.header_id = h.header_id OR (x.source_order_number = h.source_order_number AND x.source_order_system = h.source_order_system))";
    G.PAGE = 2500;
    /**
     * one row per customer account: amount ordered per month (M0 = this month … M23), orders in the last 12 months, the first and
     * last order date, the class and name — every account that ordered in `months`, paged by account number (after = the last one).
     * Alternatives: the business unit + NOT EXISTS latest version, the correlated MAX() latest version, any business unit, plain.
     */
    G.sql = {};
    G.sql.portfolio = function (bu, after, size) {
        var m = []; for (var k = 0; k < 24; k++) m.push("SUM(CASE WHEN TRUNC(h.ordered_date, 'MM') = ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -" + k + ") THEN fl.extended_amount END) AS M" + k);
        function one(latest, useBu, cls) {
            return "SELECT ca.account_number, MAX(p.party_name) AS customer, " + (cls ? 'MAX(ca.customer_class_code)' : "''") + " AS class,\n       " + m.join(',\n       ') + ",\n" +
                "       COUNT(DISTINCT CASE WHEN h.ordered_date >= ADD_MONTHS(TRUNC(SYSDATE), -12) THEN h.header_id END) AS ord12,\n" +
                "       COUNT(DISTINCT CASE WHEN h.ordered_date >= ADD_MONTHS(TRUNC(SYSDATE), -12) THEN TRUNC(h.ordered_date) END) AS days12,\n" +
                "       TO_CHAR(MAX(h.ordered_date), 'YYYY-MM-DD') AS last_order, TO_CHAR(MIN(h.ordered_date), 'YYYY-MM-DD') AS first_order\n" +
                "  FROM doo_fulfill_lines_all fl\n  JOIN doo_headers_all h ON h.header_id = fl.header_id\n  JOIN hz_cust_accounts ca ON ca.party_id = h.sold_to_party_id\n  JOIN hz_parties p ON p.party_id = ca.party_id\n" +
                " WHERE h.ordered_date >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -23) AND NVL(fl.status_code, 'X') NOT IN ('CANCELED', 'CANCELLED')\n" +
                "   AND " + latest + (useBu && digits(bu) ? ' AND h.org_id = ' + digits(bu) : '') + (after ? ' AND ca.account_number > ' + q(after) : '') + "\n" +
                " GROUP BY ca.account_number\n ORDER BY ca.account_number\n FETCH FIRST " + (+size || G.PAGE) + " ROWS ONLY";
        }
        var list = [one(LATEST, true, true), one(LATEST_MAX, true, true), one(LATEST, true, false), one(LATEST, false, true), one('1 = 1', false, false)];
        return list.filter(function (x, i) { return list.indexOf(x) === i; });
    };
    G.GROUP_PAGE = 20000;
    /**
     * account × group (the item DFF of the CRM setup — profit centre or supplier): amount in the last 12 months, the 12 before, the
     * last 3 months and the last month it was bought — what LAPSED and WHITESPACE read. Paged by account (a page that ends inside
     * an account drops that account; the next page starts with it).
     */
    G.sql.groups = function (bu, col, after, size) {
        var c = G.dffCol(col); if (!c) return [];
        function one(latest, useBu) {
            return "SELECT ca.account_number, NVL(i." + c.toLowerCase() + ", '(none)') AS grp,\n" +
                "       SUM(CASE WHEN h.ordered_date >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -11) THEN fl.extended_amount END) AS now12,\n" +
                "       SUM(CASE WHEN h.ordered_date < ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -11) THEN fl.extended_amount END) AS prev12,\n" +
                "       SUM(CASE WHEN h.ordered_date >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -2) THEN fl.extended_amount END) AS last3,\n" +
                "       TO_CHAR(MAX(h.ordered_date), 'YYYY-MM') AS last_month, COUNT(DISTINCT fl.inventory_item_id) AS items\n" +
                "  FROM doo_fulfill_lines_all fl\n  JOIN doo_headers_all h ON h.header_id = fl.header_id\n  JOIN hz_cust_accounts ca ON ca.party_id = h.sold_to_party_id\n" +
                "  LEFT JOIN egp_system_items_b i ON i.inventory_item_id = fl.inventory_item_id AND i.organization_id = fl.fulfill_org_id\n" +
                " WHERE h.ordered_date >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -23) AND NVL(fl.status_code, 'X') NOT IN ('CANCELED', 'CANCELLED')\n" +
                "   AND " + latest + (useBu && digits(bu) ? ' AND h.org_id = ' + digits(bu) : '') + (after ? ' AND ca.account_number > ' + q(after) : '') + "\n" +
                " GROUP BY ca.account_number, NVL(i." + c.toLowerCase() + ", '(none)')\n ORDER BY ca.account_number, 2\n FETCH FIRST " + (+size || G.GROUP_PAGE) + " ROWS ONLY";
        }
        var list = [one(LATEST, true), one(LATEST_MAX, true), one(LATEST, false)];
        return list.filter(function (x, i) { return list.indexOf(x) === i; });
    };
    /** a page of keyset rows → {rows (complete accounts only), next (the account to continue after) | null when the page was the last} */
    G.pageOf = function (rows, size, keyCol) {
        keyCol = keyCol || 'ACCOUNT_NUMBER';
        if (!rows || rows.length < size) return { rows: rows || [], next: null };
        var last = rows[rows.length - 1][keyCol], keep = rows.filter(function (r) { return r[keyCol] !== last; });
        if (!keep.length) return { rows: rows, next: last };           // one account fills the page: take it whole and move on
        return { rows: keep, next: keep[keep.length - 1][keyCol] };
    };
    /** cheques / receipts reversed in Fusion in the last `days` days (the business unit when it is known) */
    G.sql.bounced = function (bu, days) {
        var d = clamp(+days || 14, 1, 120);
        function one(useBu, cat) {
            return "SELECT cr.cash_receipt_id, cr.receipt_number, TO_CHAR(cr.receipt_date, 'YYYY-MM-DD') AS receipt_date, TO_CHAR(cr.reversal_date, 'YYYY-MM-DD') AS reversal_date,\n" +
                "       " + (cat ? 'cr.reversal_category' : "''") + " AS reversal_category, cr.amount, cr.currency_code AS currency, ca.account_number, p.party_name AS customer\n" +
                "  FROM ar_cash_receipts_all cr\n  JOIN hz_cust_accounts ca ON ca.cust_account_id = cr.pay_from_customer\n  JOIN hz_parties p ON p.party_id = ca.party_id\n" +
                " WHERE cr.reversal_date >= TRUNC(SYSDATE) - " + d + (useBu && digits(bu) ? ' AND cr.org_id = ' + digits(bu) : '') + "\n ORDER BY cr.reversal_date DESC FETCH FIRST 2000 ROWS ONLY";
        }
        var list = [one(true, true), one(false, true), one(false, false)];
        return list.filter(function (x, i) { return list.indexOf(x) === i; });
    };
    /** APEX: orders whose latest MRA try failed in the last `days` days (WMS_MRA_INTERFACE_STATUS) */
    G.sql.mraFailed = function (pod, days) {
        var d = clamp(+days || 7, 1, 60);
        return ["SELECT order_number AS ORDER_NUMBER, customer_number AS CUSTOMER_NUMBER, customer_name AS CUSTOMER_NAME, trip_id AS TRIP_ID, order_amount AS ORDER_AMOUNT, failed_reason AS FAILED_REASON, " +
            "TO_CHAR(created_date, 'YYYY-MM-DD HH24:MI') AS TRIED_AT, tries AS TRIES FROM (SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.order_number ORDER BY s.created_date DESC, s.id DESC) AS rn, COUNT(*) OVER (PARTITION BY s.order_number) AS tries " +
            "FROM wms_mra_interface_status s WHERE UPPER(s.instance_name) = " + q(String(pod || 'PROD').toUpperCase()) + " AND s.created_date >= TRUNC(SYSDATE) - " + d + ") WHERE rn = 1 AND mra_interface_status = 'FAILED' AND customer_number IS NOT NULL ORDER BY created_date DESC FETCH FIRST 2000 ROWS ONLY"];
    };
    /** APEX: order lines the cancellation autopilot / pages cancelled in the last `days` days, with the order's customer from the trip */
    G.sql.cancels = function (pod, days) {
        var d = clamp(+days || 3, 1, 30);
        return ["SELECT l.order_number AS ORDER_NUMBER, MAX(d.account_number) AS ACCOUNT_NUMBER, MAX(d.account_name) AS ACCOUNT_NAME, MAX(l.trip_id) AS TRIP_ID, MAX(l.trip_date) AS TRIP_DATE, COUNT(*) AS LINES, " +
            "MAX(l.item) AS ITEM, TO_CHAR(MAX(l.logged_at), 'YYYY-MM-DD HH24:MI') AS CANCELLED_AT FROM wms_w2_cancel_log l JOIN wms_trip_details d ON TRIM(d.order_number) = TRIM(l.order_number) " +
            "WHERE l.result = 'DONE' AND l.via <> 'RUN' AND UPPER(l.pod) = " + q(String(pod || 'PROD').toUpperCase()) + " AND l.logged_at >= TRUNC(SYSDATE) - " + d + " AND d.account_number IS NOT NULL " +
            "GROUP BY l.order_number ORDER BY MAX(l.logged_at) DESC FETCH FIRST 2000 ROWS ONLY"];
    };
    /** APEX: the customer's orders on WMS trips (last `days` days) with picker, MRA and actual ship date when those tables answer */
    G.sql.deliveries = function (pod, account, days) {
        var d = clamp(+days || 90, 7, 400), P = q(String(pod || 'PROD').toUpperCase()), A = q(String(account || '').trim());
        var base = "SELECT TRIM(d.order_number) AS ORDER_NUMBER, d.order_type AS ORDER_TYPE, TO_CHAR(d.order_date, 'YYYY-MM-DD') AS ORDER_DATE, d.trip_id AS TRIP_ID, TO_CHAR(h.trip_date, 'YYYY-MM-DD') AS TRIP_DATE, " +
            "h.trip_lorry AS LORRY, h.trip_loading_bay AS BAY, d.priority AS PRIORITY, d.pick_release_status AS PICK_RELEASE_STATUS, TO_CHAR(d.release_date, 'YYYY-MM-DD HH24:MI') AS RELEASE_DATE, d.salesman AS SALESMAN";
        var from = " FROM wms_trip_details d JOIN wms_trip_header h ON h.trip_id = d.trip_id";
        var where = " WHERE UPPER(d.instance_name) = " + P + " AND TRIM(d.account_number) = " + A + " AND h.trip_date >= TRUNC(SYSDATE) - " + d;
        var pick = ", (SELECT MAX(pa.picker_name) FROM wms_picker_assignment pa WHERE TRIM(pa.source_order_number) = TRIM(d.order_number)) AS PICKER";
        var mra = ", (SELECT MAX(s.mra_interface_status) KEEP (DENSE_RANK LAST ORDER BY s.created_date, s.id) FROM wms_mra_interface_status s WHERE s.order_number = TRIM(d.order_number) AND UPPER(s.instance_name) = " + P + ") AS MRA_STATUS";
        var ship = ", (SELECT TO_CHAR(MAX(a.actual_ship_date), 'YYYY-MM-DD HH24:MI') FROM wms_actual_shipdate a WHERE TRIM(a.order_number) = TRIM(d.order_number) AND a.status = 'SUCCESS') AS ACTUAL_SHIP_DATE";
        var tail = " ORDER BY h.trip_date DESC, d.trip_id DESC FETCH FIRST 400 ROWS ONLY";
        return [base + pick + mra + ship + from + where + tail, base + pick + mra + from + where + tail, base + pick + from + where + tail, base + from + where + tail];
    };
    /** a trip order row → {stage, cls, steps} in plain words */
    G.deliveryStage = function (r, today) {
        var t = today || iso(new Date()), td = String(r.TRIP_DATE || '').slice(0, 10);
        var released = !!(r.RELEASE_DATE || /RELEASE|Y|DONE|SUCCESS/i.test(String(r.PICK_RELEASE_STATUS || '')));
        var shipped = !!r.ACTUAL_SHIP_DATE, mra = String(r.MRA_STATUS || '').toUpperCase();
        var stage = shipped ? 'Shipped' : td && td < t ? 'Trip passed' : released ? 'Picking' : td === t ? 'On today\'s trip' : td > t ? 'Planned' : 'On a trip';
        var cls = shipped ? 'ok' : stage === 'Trip passed' ? 'warn' : stage === 'Picking' ? 'info' : 'muted';
        return { stage: stage, cls: cls, steps: [['On trip', true], ['Picker', !!r.PICKER], ['Released', released], ['Shipped', shipped], ['MRA', mra === 'SUCCESS' || mra === 'ALREADY_DONE', mra === 'FAILED']] };
    };

    // ── signals ───────────────────────────────────────────────────
    /** a portfolio row → the 24 months oldest → newest ([0] = 23 months ago … [23] = this month) */
    G.series = function (r) { var s = []; for (var k = 23; k >= 0; k--) s.push(+r['M' + k] || 0); return s; };
    function scoreOf(atStake, sev, ref) { var base = atStake > 0 ? Math.log10(1 + atStake / Math.max(1, ref || 1000)) * 40 : 0; return clamp(Math.round(base + sev), 1, 100); }
    /**
     * Orders dropping, by the customer's OWN normal: base = average of the 12 full months before the last 3, recent = average of
     * the last 3 full months (this month is partial and left out); a drop ≥ dropPct, or no order for gapFactor × the usual gap
     * between order days (at least minGapDays) → a signal with the yearly money at stake.
     */
    G.churn = function (r, now, rule) {
        rule = rule || G.DEFAULTS.rules.CHURN;
        var n = parse(now) || new Date(), s = G.series(r);
        var recent = (s[20] + s[21] + s[22]) / 3, baseArr = s.slice(8, 20), base = baseArr.reduce(function (a, b) { return a + b; }, 0) / 12;
        var activeMonths = baseArr.filter(function (v) { return v > 0; }).length;
        if (base < (+rule.minBase || 0) || activeMonths < 4) return null;
        var drop = base > 0 ? (1 - recent / base) * 100 : 0;
        var last = parse(r.LAST_ORDER), since = last ? Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - last) / 864e5) : 999;
        var days12 = +r.DAYS12 || +r.ORD12 || 0, gap = days12 > 0 ? Math.round(365 / days12) : 0;
        var late = gap > 0 && since > Math.max(+rule.minGapDays || 21, gap * (+rule.gapFactor || 2));
        if (drop < (+rule.dropPct || 40) && !late) return null;
        var atStake = Math.max(0, base - recent) * 12;
        var why = [];
        if (drop >= (+rule.dropPct || 40)) why.push('last 3 months ' + fmt0(recent) + ' a month vs ' + fmt0(base) + ' before (' + Math.round(drop) + ' % down)');
        if (late) why.push('no order for ' + since + ' days — usually every ' + gap + ' days');
        return { kind: 'CHURN', key: 'CHURN|' + r.ACCOUNT_NUMBER + '|' + iso(n).slice(0, 7), account: String(r.ACCOUNT_NUMBER), name: r.CUSTOMER || '', value: round(atStake, 0),
            score: scoreOf(atStake, (drop >= 75 ? 30 : drop >= 50 ? 20 : 10) + (late ? 15 : 0), +rule.minBase * 12), title: 'Orders dropping · ' + (r.CUSTOMER || r.ACCOUNT_NUMBER),
            detail: why.join('; '), data: { base: round(base, 0), recent: round(recent, 0), drop: Math.round(drop), since: since, gap: gap, series: s } };
    };
    /** groups (profit centre / supplier) the customer bought ≥ minPrev in the 12 months before and stopped (or slowed by slowPct and nothing in 3 months) */
    G.lapsed = function (acct, name, groups, now, rule, dimLabel) {
        rule = rule || G.DEFAULTS.rules.LAPSED;
        var n = parse(now) || new Date(), out = [];
        (groups || []).forEach(function (g) {
            var prev = +g.PREV12 || 0, cur = +g.NOW12 || 0, last3 = +g.LAST3 || 0, grp = String(g.GRP || '(none)');
            if (grp === '(none)' || prev < (+rule.minPrev || 0)) return;
            var stopped = cur <= 0, slowed = !stopped && !last3 && cur < prev * (1 - (+rule.slowPct || 70) / 100);
            if (!stopped && !slowed) return;
            var atStake = prev - Math.max(0, cur);
            out.push({ kind: 'LAPSED', key: 'LAPSED|' + acct + '|' + grp, account: String(acct), name: name || '', value: round(atStake, 0), score: scoreOf(atStake, stopped ? 25 : 12, +rule.minPrev),
                title: (stopped ? 'Stopped buying ' : 'Hardly buying ') + grp + ' · ' + (name || acct),
                detail: (dimLabel || 'Range') + ' ' + grp + ': ' + fmt0(prev) + ' in the 12 months before, ' + fmt0(cur) + ' in the last 12' + (g.LAST_MONTH ? ' · last bought ' + g.LAST_MONTH : ''), data: { group: grp, prev: round(prev, 0), now: round(cur, 0), last: g.LAST_MONTH || '' } });
        });
        return out;
    };
    /** size band of a yearly amount (quartiles of the portfolio) — the peers when a customer has no class */
    G.bands = function (amounts) {
        var s = amounts.filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
        if (!s.length) return [0, 0, 0];
        function at(p) { return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
        return [at(0.25), at(0.5), at(0.75)];
    };
    G.bandOf = function (v, b) { return v <= 0 ? 'none' : v <= b[0] ? 'S' : v <= b[1] ? 'M' : v <= b[2] ? 'L' : 'XL'; };
    /**
     * Cross-sell: for every customer, the groups that ≥ minPenetration % of its peers bought in the last 12 months (at least minPeers
     * peers) and it never bought in 24 months; peers = the same customer class, else the same size band. Expected value = the
     * median of what the peers buying it spend, scaled by the customer's size against the median peer. → signals, `top` per customer.
     * accounts: [{ACCOUNT_NUMBER, CUSTOMER, CLASS, total12}], groups: [{ACCOUNT_NUMBER, GRP, NOW12, PREV12}]
     */
    G.whitespace = function (accounts, groups, rule, dimLabel) {
        rule = rule || G.DEFAULTS.rules.WHITESPACE;
        var minPeers = +rule.minPeers || 5, minPen = (+rule.minPenetration || 50) / 100, top = +rule.top || 3;
        var bands = G.bands(accounts.map(function (a) { return a.total12; })), byAcct = {}, peersOf = {}, out = [];
        accounts.forEach(function (a) {
            var cls = String(a.CLASS || '').trim(), key = cls ? 'C:' + cls : 'B:' + G.bandOf(a.total12, bands);
            a._peer = key; if (a.total12 > 0) (peersOf[key] = peersOf[key] || []).push(a);
            byAcct[a.ACCOUNT_NUMBER] = { a: a, g: {} };
        });
        groups.forEach(function (g) { var x = byAcct[g.ACCOUNT_NUMBER]; if (x && g.GRP && g.GRP !== '(none)') x.g[g.GRP] = { now: +g.NOW12 || 0, prev: +g.PREV12 || 0 }; });
        Object.keys(peersOf).forEach(function (key) {
            var peers = peersOf[key]; if (peers.length < minPeers) return;
            var pen = {}, spend = {};
            peers.forEach(function (p) { var g = byAcct[p.ACCOUNT_NUMBER].g; Object.keys(g).forEach(function (k) { if (g[k].now > 0) { pen[k] = (pen[k] || 0) + 1; (spend[k] = spend[k] || []).push(g[k].now); } }); });
            var medSize = median(peers.map(function (p) { return p.total12; })) || 1;
            peers.forEach(function (p) {
                var g = byAcct[p.ACCOUNT_NUMBER].g, cands = [];
                Object.keys(pen).forEach(function (k) {
                    var share = pen[k] / peers.length; if (share < minPen || g[k]) return;
                    var exp = median(spend[k]) * clamp(p.total12 / medSize, 0.25, 3);
                    cands.push({ group: k, share: Math.round(share * 100), exp: round(exp, 0), buyers: pen[k] });
                });
                cands.sort(function (x, y) { return y.exp - x.exp; }).slice(0, top).forEach(function (c) {
                    out.push({ kind: 'WHITESPACE', key: 'WS|' + p.ACCOUNT_NUMBER + '|' + c.group, account: String(p.ACCOUNT_NUMBER), name: p.CUSTOMER || '', value: c.exp, score: scoreOf(c.exp, Math.round(c.share / 5), 5000),
                        title: 'Cross-sell ' + c.group + ' · ' + (p.CUSTOMER || p.ACCOUNT_NUMBER),
                        detail: c.share + ' % of ' + peers.length + ' similar customers (' + (key[0] === 'C' ? 'class ' + key.slice(2) : 'size band ' + key.slice(2)) + ') buy ' + (dimLabel || 'range') + ' ' + c.group + ' — about ' + fmt0(c.exp) + ' a year for a customer this size',
                        data: { group: c.group, share: c.share, peers: peers.length, buyers: c.buyers, peerKey: key } });
                });
            });
        });
        return out;
    };
    G.bounced = function (rows) {
        return (rows || []).filter(function (r) { return r.ACCOUNT_NUMBER; }).map(function (r) {
            var amt = Math.abs(+r.AMOUNT || 0), cat = String(r.REVERSAL_CATEGORY || '').toUpperCase();
            return { kind: 'BOUNCED', key: 'BOUNCED|' + (r.CASH_RECEIPT_ID || r.RECEIPT_NUMBER), account: String(r.ACCOUNT_NUMBER), name: r.CUSTOMER || '', value: round(amt, 0), score: scoreOf(amt, 35, 2000),
                title: 'Bounced cheque · ' + (r.CUSTOMER || r.ACCOUNT_NUMBER), detail: 'Receipt ' + (r.RECEIPT_NUMBER || '') + ' of ' + (r.CURRENCY || '') + ' ' + fmt0(amt) + ' reversed on ' + (r.REVERSAL_DATE || '') + (cat ? ' (' + (cat === 'NSF' ? 'insufficient funds' : cat === 'STOP' ? 'stop payment' : cat.toLowerCase()) + ')' : ''),
                data: { receipt: r.RECEIPT_NUMBER, receiptId: r.CASH_RECEIPT_ID, amount: amt, currency: r.CURRENCY, reversed: r.REVERSAL_DATE } };
        });
    };
    G.mra = function (rows) {
        return (rows || []).map(function (r) {
            var amt = +r.ORDER_AMOUNT || 0;
            return { kind: 'MRA', key: 'MRA|' + r.ORDER_NUMBER, account: String(r.CUSTOMER_NUMBER), name: r.CUSTOMER_NAME || '', value: round(amt, 0), score: scoreOf(amt, 20, 5000),
                title: 'Invoice refused by MRA · ' + (r.CUSTOMER_NAME || r.CUSTOMER_NUMBER), detail: 'Order ' + r.ORDER_NUMBER + (r.TRIP_ID ? ' (trip ' + r.TRIP_ID + ')' : '') + ' failed ' + (+r.TRIES > 1 ? r.TRIES + ' times' : '') + ' · ' + String(r.FAILED_REASON || '').slice(0, 160),
                data: { order: r.ORDER_NUMBER, trip: r.TRIP_ID, reason: r.FAILED_REASON, at: r.TRIED_AT } };
        });
    };
    G.cancels = function (rows, rule) {
        var min = +(rule || {}).minLines || 1;
        return (rows || []).filter(function (r) { return r.ACCOUNT_NUMBER && (+r.LINES || 0) >= min; }).map(function (r) {
            return { kind: 'CANCEL', key: 'CANCEL|' + r.ORDER_NUMBER, account: String(r.ACCOUNT_NUMBER).trim(), name: r.ACCOUNT_NAME || '', value: 0, score: clamp(30 + (+r.LINES || 1) * 8, 1, 90),
                title: (+r.LINES > 1 ? r.LINES + ' lines' : 'A line') + ' cancelled · ' + (r.ACCOUNT_NAME || r.ACCOUNT_NUMBER), detail: 'Order ' + r.ORDER_NUMBER + (r.TRIP_ID ? ' on trip ' + r.TRIP_ID + (r.TRIP_DATE ? ' of ' + r.TRIP_DATE : '') : '') + ' — out of stock' + (r.ITEM ? ' (e.g. ' + r.ITEM + ')' : '') + ', cancelled ' + (r.CANCELLED_AT || ''),
                data: { order: r.ORDER_NUMBER, trip: r.TRIP_ID, lines: +r.LINES || 0 } };
        });
    };
    /**
     * Everything the scan found → signals by the rules (kinds switched off are left out, below minScore too), best first.
     * input: {portfolio: rows, groups: rows, bounced, mra, cancels, now, settings, dimLabel}
     */
    G.scan = function (input) {
        var st = input.settings || G.settings(null), R = st.rules, now = input.now || new Date(), out = [];
        var names = {}, accts = [];
        (input.portfolio || []).forEach(function (r) {
            var s = G.series(r), t12 = s.slice(12).reduce(function (a, b) { return a + b; }, 0);
            names[r.ACCOUNT_NUMBER] = r.CUSTOMER || '';
            accts.push({ ACCOUNT_NUMBER: r.ACCOUNT_NUMBER, CUSTOMER: r.CUSTOMER, CLASS: r.CLASS, total12: t12 });
            if (R.CHURN.on) { var c = G.churn(r, now, R.CHURN); if (c) out.push(c); }
        });
        var byAcct = {}; (input.groups || []).forEach(function (g) { (byAcct[g.ACCOUNT_NUMBER] = byAcct[g.ACCOUNT_NUMBER] || []).push(g); });
        if (R.LAPSED.on) Object.keys(byAcct).forEach(function (a) { out = out.concat(G.lapsed(a, names[a], byAcct[a], now, R.LAPSED, input.dimLabel)); });
        if (R.WHITESPACE.on && accts.length) out = out.concat(G.whitespace(accts, input.groups || [], R.WHITESPACE, input.dimLabel));
        if (R.BOUNCED.on) out = out.concat(G.bounced(input.bounced));
        if (R.MRA.on) out = out.concat(G.mra(input.mra));
        if (R.CANCEL.on) out = out.concat(G.cancels(input.cancels, R.CANCEL));
        var seen = {};
        // minScore only gates the automatic actions (G.actionFor) — every signal goes to the worklist
        return out.filter(function (s) { if (seen[s.key]) return false; seen[s.key] = 1; return true; })
            .sort(function (a, b) { return b.score - a.score || b.value - a.value; });
    };
    /**
     * Fresh signals vs the ones APEX holds (rows with SIGNAL_KEY, STATUS, SNOOZE_UNTIL) →
     * {add: new signals, touch: still there (score / detail refreshed), gone: stored NEW / OPEN ones the scan no longer finds}.
     * A signal dismissed or done stays closed; a snoozed one wakes up after its date.
     */
    G.merge = function (fresh, stored) {
        var have = {}; (stored || []).forEach(function (r) { have[r.SIGNAL_KEY] = r; });
        var add = [], touch = [], now = {};
        fresh.forEach(function (s) { now[s.key] = 1; if (!have[s.key]) add.push(s); else touch.push(Object.assign({ row: have[s.key] }, s)); });
        var gone = (stored || []).filter(function (r) { return !now[r.SIGNAL_KEY] && (r.STATUS === 'NEW' || r.STATUS === 'OPEN') && G.scanned(r.KIND); });
        return { add: add, touch: touch, gone: gone };
    };
    /** kinds the scan re-checks every time (the others — none today — would only close by hand) */
    G.scanned = function (kind) { return !!G.KINDS[kind]; };
    /** signal rows → the worklist the page shows: open first (snoozed ones that woke up count as open), by score */
    G.isLive = function (r, now) {
        if (r.STATUS === 'NEW' || r.STATUS === 'OPEN') return true;
        if (r.STATUS === 'SNOOZED') return !r.SNOOZE_UNTIL || String(r.SNOOZE_UNTIL).slice(0, 10) <= iso(parse(now) || new Date());
        return false;
    };
    G.summary = function (rows, now) {
        var k = { open: 0, value: 0, byKind: {}, mine: 0, newN: 0 };
        (rows || []).forEach(function (r) {
            if (!G.isLive(r, now)) return;
            k.open++; k.value += +r.VALUE || 0; if (r.STATUS === 'NEW') k.newN++;
            var b = k.byKind[r.KIND] = k.byKind[r.KIND] || { n: 0, value: 0 }; b.n++; b.value += +r.VALUE || 0;
        });
        k.value = round(k.value, 0);
        return k;
    };
    /** the action a new signal triggers by the rules → {action, playbook} (only for signals at or above minScore) */
    G.actionFor = function (signal, settings) {
        var r = ((settings || G.settings(null)).rules || {})[signal.kind] || {};
        if (!r.on || !r.action || r.action === 'NONE' || signal.score < (+r.minScore || 0)) return { action: 'NONE' };
        return { action: r.action, playbook: r.playbook || '' };
    };
    /** per account: the live signals (for the Customers grid, the 360 header and Needs you) */
    G.byAccount = function (rows, now) {
        var out = {};
        (rows || []).forEach(function (r) { if (!G.isLive(r, now)) return; var a = String(r.ACCOUNT_NUMBER || ''); if (!a) return; (out[a] = out[a] || []).push(r); });
        Object.keys(out).forEach(function (a) { out[a].sort(function (x, y) { return (+y.SCORE || 0) - (+x.SCORE || 0); }); });
        return out;
    };
    /** enrolments whose step is due now (mine or nobody's) → bell items */
    G.playNotifications = function (plays, now, me) {
        var n = parse(now) || new Date(), out = [];
        (plays || []).forEach(function (p) {
            if (p.STATUS !== 'ACTIVE') return;
            if (me && p.OWNER && String(p.OWNER).toLowerCase() !== String(me).toLowerCase()) return;
            var s = G.playState(p, n); if (!s.step || !s.dueNow) return;
            out.push({ key: 'pb:' + p.PLAY_ID + ':' + s.index, k: 'plays', sev: s.late ? 'bad' : 'warn', at: s.due, account: p.ACCOUNT_NUMBER, name: p.ACCOUNT_NAME || p.ACCOUNT_NUMBER, id: p.PLAY_ID,
                title: (G.STEP_KINDS[s.step.kind] || {}).label + ' · ' + (p.ACCOUNT_NAME || p.ACCOUNT_NUMBER), detail: s.step.title + ' — ' + (p.PLAYBOOK_NAME || '') + ' step ' + (s.index + 1) + ' of ' + s.total + (s.late ? ' · ' + s.days + ' day' + (s.days > 1 ? 's' : '') + ' late' : '') });
        });
        return out;
    };
    /** enrolments that should stop because the customer ordered again after they started (playbooks with stopOnOrder) */
    G.stopOnOrder = function (plays, lastOrderBy) {
        return (plays || []).filter(function (p) {
            if (p.STATUS !== 'ACTIVE' || p.STOP_ON_ORDER !== 'Y') return false;
            var lo = lastOrderBy[p.ACCOUNT_NUMBER]; return lo && String(lo).slice(0, 10) > String(p.STARTED_AT || '').slice(0, 10);
        });
    };

    // ── the supervisor wallboard ──────────────────────────────────
    /**
     * {tickets, calls, plays, signals, now, isOpen(t), sla(t, now) → {state}, queues} → live numbers: per queue (open, past the
     * SLA, at risk, unassigned, oldest open), calls today (in / out / answered / missed / not reached / talk time / missed
     * not returned), call-backs due, per agent (open tickets, past SLA, calls today, talk), playbook steps due, open signals.
     */
    G.wallboard = function (src) {
        var n = parse(src.now) || new Date(), t0 = iso(n), Q = {}, A = {};
        function qq(name) { return Q[name] = Q[name] || { queue: name, open: 0, breached: 0, risk: 0, unassigned: 0, oldest: '' }; }
        function aa(name) { return A[name] = A[name] || { agent: name, open: 0, breached: 0, calls: 0, talk: 0, solved: 0 }; }
        (src.queues || []).forEach(qq);
        (src.tickets || []).forEach(function (t) {
            var open = src.isOpen(t);
            if (!open) { if (t.ASSIGNED_TO && String(t.RESOLVED_AT || '').slice(0, 10) === t0) aa(t.ASSIGNED_TO).solved++; return; }
            var x = qq(t.QUEUE || '(no queue)'), s = src.sla(t, n).state;
            x.open++; if (s === 'breached') x.breached++; else if (s === 'risk') x.risk++;
            if (!t.ASSIGNED_TO) x.unassigned++;
            if (!x.oldest || String(t.CREATED_AT) < x.oldest) x.oldest = String(t.CREATED_AT || '');
            if (t.ASSIGNED_TO) { var g = aa(t.ASSIGNED_TO); g.open++; if (s === 'breached') g.breached++; }
        });
        var c = { all: 0, inN: 0, outN: 0, answered: 0, missed: 0, unreached: 0, talk: 0, missedOpen: 0, byHour: [] };
        for (var h = 0; h < 24; h++) c.byHour.push(0);
        var calls = (src.calls || []).slice().sort(function (a, b) { return String(a.STARTED_AT || '').localeCompare(String(b.STARTED_AT || '')); }), reach = {};
        calls.forEach(function (x) { if (x.ACCOUNT_NUMBER && (x.DIRECTION === 'OUT' || x.OUTCOME === 'ANSWERED')) reach[x.ACCOUNT_NUMBER] = String(x.STARTED_AT || ''); });
        calls.forEach(function (x) {
            var at = String(x.STARTED_AT || '');
            if (at.slice(0, 10) !== t0) return;
            c.all++; if (x.DIRECTION === 'IN') c.inN++; else c.outN++;
            if (x.OUTCOME === 'ANSWERED') c.answered++; else if (x.OUTCOME === 'MISSED') { c.missed++; if (!(x.ACCOUNT_NUMBER && reach[x.ACCOUNT_NUMBER] > at)) c.missedOpen++; } else if (['NO_ANSWER', 'BUSY', 'VOICEMAIL', 'FAILED'].indexOf(x.OUTCOME) >= 0) c.unreached++;
            c.talk += +x.DURATION_S || 0; c.byHour[+at.slice(11, 13) || 0]++;
            if (x.AGENT) { var g = aa(x.AGENT); g.calls++; g.talk += +x.DURATION_S || 0; }
        });
        c.answerRate = c.inN ? Math.round(c.answered / Math.max(1, c.answered + c.missed) * 100) : null;
        var cb = (src.calls || []).filter(function (x) { return x.CALLBACK_AT && x.CALLBACK_DONE !== 'Y'; });
        var nowS = stamp(n);
        var callbacks = { due: cb.filter(function (x) { return String(x.CALLBACK_AT).slice(0, 16) <= nowS; }).length, today: cb.filter(function (x) { return String(x.CALLBACK_AT).slice(0, 10) === t0; }).length, planned: cb.length };
        var plays = { active: 0, due: 0, late: 0 };
        (src.plays || []).forEach(function (p) { if (p.STATUS !== 'ACTIVE') return; plays.active++; var s = G.playState(p, n); if (s.dueNow) { plays.due++; if (s.late) plays.late++; } });
        var sig = G.summary(src.signals || [], n);
        var tot = { open: 0, breached: 0, risk: 0, unassigned: 0 };
        Object.keys(Q).forEach(function (k) { tot.open += Q[k].open; tot.breached += Q[k].breached; tot.risk += Q[k].risk; tot.unassigned += Q[k].unassigned; });
        return { at: nowS, queues: Object.keys(Q).map(function (k) { return Q[k]; }).sort(function (a, b) { return b.breached - a.breached || b.open - a.open; }), tickets: tot, calls: c, callbacks: callbacks,
            agents: Object.keys(A).map(function (k) { return A[k]; }).sort(function (a, b) { return b.open - a.open || b.calls - a.calls; }), plays: plays, signals: sig };
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = G;
    else root.CRMG = G;
})(typeof window !== 'undefined' ? window : this);
