/* Fusion Debtors Control · pure engine (window.DCE, also a node module for the tests in debtors/tests).
 * No DOM, no host, no APEX: business-unit starters, placeholders, mapping a balances report / SQL result to customers,
 * who a statement goes to, the status of a sent statement, the collection priority of a customer, the worklist and
 * the customer timeline. */
(function (root) {
    'use strict';
    var E = {};

    // ── starters: the business units and reports of the old DevExpress debtors form ──
    E.DEFAULT_SQL = [
        "SELECT ca.account_number AS account_number, p.party_name AS account_name, ps.invoice_currency_code AS currency,",
        "       SUM(ps.amount_due_remaining) AS balance,",
        "       SUM(CASE WHEN ps.due_date >= TO_DATE('{STMT_DATE}', 'YYYY-MM-DD') THEN ps.amount_due_remaining ELSE 0 END) AS current_amt,",
        "       SUM(CASE WHEN TO_DATE('{STMT_DATE}', 'YYYY-MM-DD') - ps.due_date BETWEEN 1 AND 30 THEN ps.amount_due_remaining ELSE 0 END) AS b1_30,",
        "       SUM(CASE WHEN TO_DATE('{STMT_DATE}', 'YYYY-MM-DD') - ps.due_date BETWEEN 31 AND 60 THEN ps.amount_due_remaining ELSE 0 END) AS b31_60,",
        "       SUM(CASE WHEN TO_DATE('{STMT_DATE}', 'YYYY-MM-DD') - ps.due_date BETWEEN 61 AND 90 THEN ps.amount_due_remaining ELSE 0 END) AS b61_90,",
        "       SUM(CASE WHEN TO_DATE('{STMT_DATE}', 'YYYY-MM-DD') - ps.due_date > 90 THEN ps.amount_due_remaining ELSE 0 END) AS b90_plus,",
        "       MAX(em.email_address) AS email",
        "  FROM ar_payment_schedules_all ps",
        "  JOIN hz_cust_accounts ca ON ca.cust_account_id = ps.customer_id",
        "  JOIN hz_parties p ON p.party_id = ca.party_id",
        "  LEFT JOIN (SELECT owner_table_id AS party_id, MAX(email_address) AS email_address FROM hz_contact_points",
        "              WHERE owner_table_name = 'HZ_PARTIES' AND contact_point_type = 'EMAIL' AND status = 'A' GROUP BY owner_table_id) em ON em.party_id = p.party_id",
        " WHERE ps.org_id = {BU_ID}",
        "   AND ps.status = 'OP'",
        "   AND ps.gl_date <= TO_DATE('{STMT_DATE}', 'YYYY-MM-DD')",
        " GROUP BY ca.account_number, p.party_name, ps.invoice_currency_code",
        "HAVING SUM(ps.amount_due_remaining) <> 0",
        " ORDER BY 4 DESC"
    ].join('\n');

    E.DEFAULT_BODY = [
        '<p>Dear Sir / Madam,</p>',
        '<p>Please find attached your <b>Statement of Account</b> for account <b>{ACCOUNT_NUMBER}</b> ({ACCOUNT_NAME}) as at <b>{STMT_DATE_LONG}</b>.</p>',
        '<p>Balance as per our records: <b>{CURRENCY} {BALANCE}</b>.</p>',
        '<p>Kindly ignore this e-mail if payment has already been made after the statement date.</p>',
        '<p>Sincerely,<br>Accounts Receivable Department<br>{COMPANY}</p>',
        '<p style="color:#64748b;font-size:12px">For any queries please contact {CONTACT}.</p>'
    ].join('\n');

    E.SEED_BUS = [
        {
            id: '300000003234003', name: 'GRAYS INC BU', company: 'Grays Inc Ltd', currency: 'MUR', active: 'Y',
            balances: { kind: 'BIP', path: '/Custom/OQ/Customer Stmt/CUSTOMER_STATEMENT_SUMMARY_BIP.xdo', params: { p_date_fr: '{STMT_DATE_MDY}', BUSINESS_UNIT_ID: '{BU_ID}' }, sql: E.DEFAULT_SQL },
            statement: { path: '/Custom/OQ/Customer Stmt/Customer_Statement_Rep.xdo', params: { p_cust_no: '{ACCOUNT_NUMBER}', p_date_fr: '{STMT_DATE_MDY}', BUSINESS_UNIT_ID: '{BU_ID}' } },
            mail: { subject: '{COMPANY} - Your Customer Statement as at {STMT_DATE_LONG}', body: E.DEFAULT_BODY, contact: '', cc: '', bcc: '', attach: 'Statement {ACCOUNT_NUMBER} {STMT_DATE}', track: true, confirm: true, readReceipt: false, deliveryReceipt: false }
        },
        {
            id: '300000004907002', name: 'SUGARWORLD BU', company: 'Sugarworld Ltd', currency: 'MUR', active: 'Y',
            balances: { kind: 'BIP', path: '/Custom/OQ/Customer Stmt/SW_Customer_Statement_Summary_BIP.xdo', params: { p_date_fr: '{STMT_DATE_MDY}', BUSINESS_UNIT_ID: '{BU_ID}' }, sql: E.DEFAULT_SQL },
            statement: { path: '/Custom/OQ/Customer Stmt/SW_Customer_Statement.xdo', params: { p_cust_no: '{ACCOUNT_NUMBER}', p_date_fr: '{STMT_DATE_MDY}', BUSINESS_UNIT_ID: '{BU_ID}' } },
            mail: { subject: '{COMPANY} - Your Customer Statement as at {STMT_DATE_LONG}', body: E.DEFAULT_BODY, contact: 'finance1@aventuredusucre.com, finance3@aventuredusucre.com', cc: '', bcc: '', attach: 'Statement {ACCOUNT_NUMBER} {STMT_DATE}', track: true, confirm: true, readReceipt: false, deliveryReceipt: false }
        }
    ];
    E.GENERAL = { parallelPdf: 3, unopenedDays: 7, followupDays: 7, collectors: [] };

    // ── small helpers ──
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    E.iso = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    E.parseIso = function (s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
    /** The usual statement date: the last day of the month before `today`. */
    E.lastMonthEnd = function (today) { var t = today || new Date(); return E.iso(new Date(t.getFullYear(), t.getMonth(), 0)); };
    E.num = function (v) {
        if (v == null || v === '') return null;
        if (typeof v === 'number') return isFinite(v) ? v : null;
        var s = String(v).trim().replace(/[\s,]/g, ''), neg = /^\(.*\)$/.test(s);
        if (neg) s = s.slice(1, -1);
        if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
        var n = parseFloat(s); if (!isFinite(n)) return null;
        return neg ? -Math.abs(n) : n;
    };
    E.money = function (n, dec) {
        if (n == null || !isFinite(n)) return '';
        dec = dec == null ? 2 : dec;
        var neg = n < 0, s = Math.abs(n).toFixed(dec), parts = s.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (neg ? '-' : '') + parts.join('.');
    };
    E.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    E.uid = function (prefix) {
        var hex = '';
        var c = root.crypto || (typeof require === 'function' ? (function () { try { return require('crypto').webcrypto; } catch (e) { return null; } })() : null);
        if (c && c.getRandomValues) { var a = new Uint8Array(12); c.getRandomValues(a); for (var i = 0; i < a.length; i++) hex += pad16(a[i]); }
        else for (var j = 0; j < 24; j++) hex += Math.floor(Math.random() * 16).toString(16);
        return (prefix || '') + hex;
    };
    function pad16(b) { return (b < 16 ? '0' : '') + b.toString(16); }
    E.token = function () { return E.uid('').slice(0, 24) + E.uid('').slice(0, 8); };

    // ── placeholders ──
    /** Variables for one customer's statement. */
    E.vars = function (bu, stmtDate, cust, extra) {
        var d = E.parseIso(stmtDate) || new Date(), c = cust || {}, b = bu || {};
        var v = {
            STMT_DATE: E.iso(d), STMT_DATE_MDY: pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' + d.getFullYear(),
            STMT_DATE_DMY: pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear(),
            STMT_DATE_LONG: d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(), MONTH: MONTHS[d.getMonth()] + ' ' + d.getFullYear(),
            BU_ID: b.id || '', BU_NAME: b.name || '', COMPANY: b.company || b.name || '', CONTACT: (b.mail && b.mail.contact) || 'us by replying to this e-mail',
            ACCOUNT_NUMBER: c.account || '', ACCOUNT_NAME: c.name || '', BALANCE: E.money(c.balance), CURRENCY: c.currency || b.currency || '',
            OVERDUE: E.money(c.overdue)
        };
        Object.keys(extra || {}).forEach(function (k) { v[k] = extra[k]; });
        return v;
    };
    /** {NAME} → value. mode 'sql' doubles quotes, 'html' escapes, else plain text. Unknown names stay as written. */
    E.fill = function (tpl, vars, mode) {
        return String(tpl == null ? '' : tpl).replace(/\{([A-Z][A-Z0-9_]*)\}/g, function (all, k) {
            if (!Object.prototype.hasOwnProperty.call(vars, k)) return all;
            var v = vars[k] == null ? '' : String(vars[k]);
            return mode === 'sql' ? v.replace(/'/g, "''") : mode === 'html' && k !== 'CONFIRM_LINK' ? E.esc(v) : v;
        });
    };
    E.fillParams = function (params, vars) { var o = {}; Object.keys(params || {}).forEach(function (k) { o[k] = E.fill(params[k], vars); }); return o; };
    E.unknownVars = function (tpl, vars) { var out = [], re = /\{([A-Z][A-Z0-9_]*)\}/g, m; while ((m = re.exec(String(tpl || '')))) if (!Object.prototype.hasOwnProperty.call(vars, m[1]) && out.indexOf(m[1]) < 0) out.push(m[1]); return out; };
    E.VAR_HELP = ['STMT_DATE', 'STMT_DATE_MDY', 'STMT_DATE_DMY', 'STMT_DATE_LONG', 'MONTH', 'BU_ID', 'BU_NAME', 'COMPANY', 'CONTACT', 'ACCOUNT_NUMBER', 'ACCOUNT_NAME', 'BALANCE', 'OVERDUE', 'CURRENCY'];

    // ── a balances report / SQL → customers ──
    E.COLS = {
        account: ['ACCOUNT_NUMBER', 'CUSTOMER_NUMBER', 'ACCOUNT_NO', 'CUST_NO', 'CUST_ACCOUNT_NUMBER', 'PARTY_NUMBER'],
        name: ['ACCOUNT_NAME', 'CUSTOMER_NAME', 'PARTY_NAME', 'CUST_NAME', 'NAME'],
        balance: ['AMT_REMAINING', 'BALANCE', 'AMOUNT_DUE_REMAINING', 'CLOSING_BALANCE', 'OUTSTANDING', 'TOTAL_DUE', 'TOTAL'],
        email: ['EMAIL', 'EMAIL_ADDRESS', 'STMT_EMAIL', 'E_MAIL'],
        emailStat: ['EMAIL_STAT', 'EMAIL_STATUS', 'SEND_BY_EMAIL', 'EMAIL_FLAG'],
        currency: ['CURRENCY', 'CURRENCY_CODE', 'INVOICE_CURRENCY_CODE'],
        current: ['CURRENT_AMT', 'NOT_DUE', 'B_CURRENT', 'CURRENT_BAL'],
        d30: ['B1_30', 'DAYS_1_30', 'BUCKET_1_30', 'AGE_1_30'],
        d60: ['B31_60', 'DAYS_31_60', 'BUCKET_31_60', 'AGE_31_60'],
        d90: ['B61_90', 'DAYS_61_90', 'BUCKET_61_90', 'AGE_61_90'],
        d90p: ['B90_PLUS', 'DAYS_90_PLUS', 'OVER_90', 'BUCKET_90_PLUS', 'AGE_91_PLUS'],
        overdue: ['OVERDUE', 'PAST_DUE', 'OVERDUE_AMT'],
        cls: ['CUSTOMER_CLASS', 'CUSTOMER_CLASS_CODE', 'CLASS'],
        salesperson: ['SALESPERSON', 'SALES_REP', 'SALESREP_NAME']
    };
    /** Which column of the rows holds each field: the saved map wins, else the first known name present. */
    E.detect = function (rows, saved) {
        var cols = {}; (rows || []).slice(0, 50).forEach(function (r) { Object.keys(r).forEach(function (k) { cols[k.toUpperCase()] = k; }); });
        var map = {};
        Object.keys(E.COLS).forEach(function (f) {
            var want = saved && saved[f] ? String(saved[f]).toUpperCase() : null;
            if (want && cols[want]) { map[f] = cols[want]; return; }
            for (var i = 0; i < E.COLS[f].length; i++) if (cols[E.COLS[f][i]]) { map[f] = cols[E.COLS[f][i]]; return; }
        });
        return { map: map, columns: Object.keys(cols).map(function (k) { return cols[k]; }), missing: ['account', 'name', 'balance'].filter(function (f) { return !map[f]; }) };
    };
    /** Rows → one customer per account (balances and buckets added up, the first non-empty e-mail / name kept). */
    E.customers = function (rows, saved) {
        var det = E.detect(rows, saved), m = det.map, by = {}, list = [];
        function val(r, f) { return m[f] ? r[m[f]] : null; }
        (rows || []).forEach(function (r) {
            var acct = String(val(r, 'account') == null ? '' : val(r, 'account')).trim(); if (!acct) return;
            var c = by[acct];
            if (!c) { c = by[acct] = { account: acct, name: '', balance: 0, email: '', emailStat: '', currency: '', cls: '', salesperson: '', aging: null, overdue: null, lines: 0 }; list.push(c); }
            c.lines++;
            if (!c.name && val(r, 'name')) c.name = String(val(r, 'name')).trim();
            c.balance += E.num(val(r, 'balance')) || 0;
            if (!c.email && val(r, 'email')) c.email = String(val(r, 'email')).trim();
            if (!c.emailStat && val(r, 'emailStat')) c.emailStat = String(val(r, 'emailStat')).trim().toUpperCase();
            ['currency', 'cls', 'salesperson'].forEach(function (f) { if (!c[f] && val(r, f)) c[f] = String(val(r, f)).trim(); });
            if (m.current || m.d30 || m.d60 || m.d90 || m.d90p) {
                c.aging = c.aging || { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
                ['current', 'd30', 'd60', 'd90', 'd90p'].forEach(function (f) { c.aging[f] += E.num(val(r, f)) || 0; });
            }
            if (m.overdue) c.overdue = (c.overdue || 0) + (E.num(val(r, 'overdue')) || 0);
        });
        list.forEach(function (c) {
            c.balance = Math.round(c.balance * 100) / 100;
            if (c.aging && c.overdue == null) c.overdue = Math.round((c.aging.d30 + c.aging.d60 + c.aging.d90 + c.aging.d90p) * 100) / 100;
        });
        return { customers: list, map: m, columns: det.columns, missing: det.missing };
    };

    // ── who gets the statement ──
    var EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;
    /** "a@b.com; Name <c@d.com>, e@f" → ['a@b.com', 'c@d.com'] (invalid ones in .bad) */
    E.emails = function (text) {
        var good = [], bad = [];
        String(text || '').split(/[;,\n]+/).forEach(function (p) {
            p = p.trim(); if (!p) return;
            var m = /<([^>]+)>/.exec(p), a = (m ? m[1] : p).trim().replace(/^mailto:/i, '');
            if (EMAIL_RE.test(a)) { if (good.indexOf(a.toLowerCase()) < 0) good.push(a.toLowerCase()); } else bad.push(p);
        });
        var r = good.slice(); r.bad = bad; return r;
    };
    /** cust (from the report) + profile (WMS_DC_CUSTOMERS overrides) + bu → {delivery EMAIL | POST | NONE, to, cc, why} */
    E.recipients = function (cust, profile, bu) {
        var p = profile || {}, c = cust || {}, mail = (bu && bu.mail) || {};
        var toText = p.stmtTo || c.email || '', to = E.emails(toText), cc = E.emails([p.stmtCc, mail.cc].filter(Boolean).join(';'));
        var want = String(p.delivery || '').toUpperCase();
        if (want === 'NONE') return { delivery: 'NONE', to: [], cc: [], why: 'No statement for this customer (customer setting)' };
        if (want === 'POST') return { delivery: 'POST', to: [], cc: [], why: 'Sent by post (customer setting)' };
        if (!want && c.emailStat === 'NO') return { delivery: 'POST', to: [], cc: [], why: 'Sent by post (EMAIL_STAT = NO in Fusion)' };
        if (!to.length) return { delivery: 'POST', to: [], cc: [], why: to.bad.length ? 'E-mail not valid: ' + to.bad.join(', ') : 'No e-mail address — by post' };
        return { delivery: 'EMAIL', to: to.slice(), cc: cc.filter(function (x) { return to.indexOf(x) < 0; }), why: p.stmtTo ? 'E-mail from the customer card' : 'E-mail from Fusion', source: p.stmtTo ? 'card' : 'fusion' };
    };

    // ── a sent statement ──
    /** The furthest step a statement reached → {key, label, cls, rank} */
    E.stmtState = function (s) {
        var x = s || {};
        if (x.STATUS === 'FAILED') return { key: 'FAILED', label: 'Failed', cls: 'bad', rank: 0 };
        if (x.BOUNCED_AT) return { key: 'BOUNCED', label: 'Bounced', cls: 'bad', rank: 1 };
        if (x.RESP_STATUS === 'DISPUTED') return { key: 'DISPUTED', label: 'Disputed', cls: 'bad', rank: 9 };
        if (x.RESP_STATUS === 'AGREED') return { key: 'AGREED', label: 'Balance agreed', cls: 'ok', rank: 8 };
        if (x.READ_AT) return { key: 'READ', label: 'Read', cls: 'ok', rank: 7 };
        if (+x.OPENS > 0) return { key: 'OPENED', label: 'Opened', cls: 'ok', rank: 6 };
        if (x.DELIVERED_AT) return { key: 'DELIVERED', label: 'Delivered', cls: 'info', rank: 5 };
        if (x.STATUS === 'SENT') return { key: 'SENT', label: 'Sent', cls: 'info', rank: 4 };
        if (x.STATUS === 'DRAFT') return { key: 'DRAFT', label: 'Draft in Outlook', cls: 'warn', rank: 3 };
        if (x.STATUS === 'POSTED') return { key: 'POSTED', label: 'By post', cls: 'muted', rank: 3 };
        if (x.STATUS === 'SKIPPED') return { key: 'SKIPPED', label: 'Skipped', cls: 'muted', rank: 2 };
        return { key: 'GENERATED', label: 'PDF made', cls: 'muted', rank: 2 };
    };
    E.STATES = ['SENT', 'DELIVERED', 'OPENED', 'READ', 'AGREED', 'DISPUTED', 'BOUNCED', 'FAILED', 'POSTED', 'DRAFT', 'GENERATED', 'SKIPPED'];

    /** The tracking picture + the agree / dispute button for one copy (HTML, Outlook-safe). */
    E.trackHtml = function (base, token, opts) {
        var o = opts || {}, h = '';
        if (!base || !token) return '';
        if (o.confirm) h += '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0"><tr><td style="background:#1d4ed8;border-radius:8px"><a href="' + E.esc(base + '/dc/resp/' + token) + '" style="display:inline-block;padding:11px 20px;color:#ffffff;font:bold 14px Segoe UI,Arial,sans-serif;text-decoration:none">Confirm or query this balance</a></td></tr></table>';
        if (o.track) h += '<img src="' + E.esc(base + '/dc/px/' + token) + '" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">';
        return h;
    };

    // ── follow-ups and promises ──
    E.KINDS = {
        NOTE: { label: 'Note', icon: 'fa-note-sticky' }, CALL: { label: 'Call', icon: 'fa-phone' }, EMAIL: { label: 'E-mail', icon: 'fa-envelope' },
        VISIT: { label: 'Visit', icon: 'fa-person-walking' }, PROMISE: { label: 'Promise to pay', icon: 'fa-handshake' },
        DISPUTE: { label: 'Dispute', icon: 'fa-triangle-exclamation' }, CONFIRM: { label: 'Balance agreed', icon: 'fa-circle-check' },
        TASK: { label: 'Follow-up', icon: 'fa-list-check' }, STATEMENT: { label: 'Statement', icon: 'fa-file-invoice' }, HOLD: { label: 'Credit hold', icon: 'fa-hand' }
    };
    /** OPEN / DUE (today) / LATE (past its date) / DONE / KEPT / BROKEN / RESOLVED */
    E.actState = function (a, today) {
        var st = String(a.STATUS || 'OPEN').toUpperCase();
        if (st !== 'OPEN') return st;
        var d = E.parseIso(a.DUE_DATE); if (!d) return 'OPEN';
        var t = E.parseIso(E.iso(today || new Date()));
        return d < t ? 'LATE' : +d === +t ? 'DUE' : 'OPEN';
    };

    // ── collection priority ──
    /** 0–100 and the reasons: how much, how old, broken promises, open disputes, not reached. */
    E.score = function (cust, ctx) {
        var c = cust || {}, x = ctx || {}, s = 0, why = [];
        var bal = Math.max(0, c.balance || 0), max = Math.max(1, x.maxBalance || bal || 1);
        if (bal <= 0) return { score: 0, why: [c.balance < 0 ? 'Credit balance' : 'Nothing owed'] };
        var size = Math.round(30 * Math.log10(1 + 9 * bal / max)); s += size; if (size >= 20) why.push('Large balance');
        if (c.aging) {
            var old = (c.aging.d60 + c.aging.d90 + c.aging.d90p) / bal, very = c.aging.d90p / bal;
            var age = Math.round(20 * Math.min(1, old) + 15 * Math.min(1, very)); s += age;
            if (very > 0.25) why.push(Math.round(very * 100) + '% over 90 days'); else if (old > 0.25) why.push(Math.round(old * 100) + '% over 60 days');
        } else if (c.overdue != null && bal) { var od = Math.min(1, c.overdue / bal); s += Math.round(25 * od); if (od > 0.4) why.push(Math.round(od * 100) + '% overdue'); }
        var acts = x.activities || [], today = x.today || new Date();
        var broken = acts.filter(function (a) { return a.KIND === 'PROMISE' && (a.STATUS === 'BROKEN' || E.actState(a, today) === 'LATE'); }).length;
        if (broken) { s += Math.min(20, 12 * broken); why.push(broken + ' promise' + (broken > 1 ? 's' : '') + ' not kept'); }
        var disputes = acts.filter(function (a) { return a.KIND === 'DISPUTE' && String(a.STATUS || 'OPEN') === 'OPEN'; }).length;
        if (disputes) { s += 10; why.push('Open dispute'); }
        var last = x.lastContact ? E.parseIso(x.lastContact) : null, days = last ? Math.round((today - last) / 86400000) : null;
        if (days == null) { s += 8; why.push('Never contacted'); } else if (days > 45) { s += 8; why.push('No contact for ' + days + ' days'); }
        var st = x.lastStatement;
        if (st && (st.STATUS === 'FAILED' || st.BOUNCED_AT)) { s += 7; why.push('Last statement did not arrive'); }
        return { score: Math.max(0, Math.min(100, s)), why: why };
    };
    E.band = function (score) { return score >= 70 ? { key: 'high', label: 'High' } : score >= 40 ? { key: 'med', label: 'Medium' } : { key: 'low', label: 'Low' }; };

    // ── what needs someone ──
    /** stmts (latest per customer first or any order), acts → worklist items {kind, account, name, text, when, ref, sev} */
    E.worklist = function (stmts, acts, opts) {
        var o = opts || {}, today = o.today || new Date(), out = [], unopened = o.unopenedDays || 7;
        var latest = {};
        (stmts || []).forEach(function (s) { var k = s.BU_ID + '|' + s.ACCOUNT_NUMBER; if (!latest[k] || String(s.CREATED_AT || '') > String(latest[k].CREATED_AT || '')) latest[k] = s; });
        Object.keys(latest).forEach(function (k) {
            var s = latest[k], st = E.stmtState(s);
            if (st.key === 'FAILED') out.push({ kind: 'FAILED', sev: 3, account: s.ACCOUNT_NUMBER, name: s.ACCOUNT_NAME, bu: s.BU_ID, text: 'Statement of ' + s.STMT_DATE + ' was not sent: ' + (s.ERROR_TEXT || 'error'), ref: s.STMT_ID, when: s.CREATED_AT });
            else if (st.key === 'BOUNCED') out.push({ kind: 'BOUNCED', sev: 3, account: s.ACCOUNT_NUMBER, name: s.ACCOUNT_NAME, bu: s.BU_ID, text: 'Statement bounced from ' + (s.EMAIL_TO || '') + ' — fix the e-mail address', ref: s.STMT_ID, when: s.BOUNCED_AT });
            else if (st.key === 'DISPUTED' && !(acts || []).some(function (a) { return a.REF_ID === s.STMT_ID && a.KIND === 'DISPUTE' && a.STATUS && a.STATUS !== 'OPEN'; }))
                out.push({ kind: 'DISPUTED', sev: 3, account: s.ACCOUNT_NUMBER, name: s.ACCOUNT_NAME, bu: s.BU_ID, text: 'Customer disputes the balance' + (s.RESP_COMMENT ? ': "' + String(s.RESP_COMMENT).slice(0, 140) + '"' : ''), ref: s.STMT_ID, when: s.RESP_AT });
            else if ((st.key === 'SENT' || st.key === 'DELIVERED') && s.TRACKED === 'Y' && s.SENT_AT) {
                var d = E.parseIso(String(s.SENT_AT).slice(0, 10)); if (d && (today - d) / 86400000 >= unopened) out.push({ kind: 'UNOPENED', sev: 1, account: s.ACCOUNT_NUMBER, name: s.ACCOUNT_NAME, bu: s.BU_ID, text: 'Statement not opened after ' + Math.floor((today - d) / 86400000) + ' days', ref: s.STMT_ID, when: s.SENT_AT });
            }
        });
        (acts || []).forEach(function (a) {
            var st = E.actState(a, today);
            if (a.KIND === 'PROMISE' && (st === 'LATE' || st === 'DUE')) out.push({ kind: st === 'LATE' ? 'PROMISE_LATE' : 'PROMISE_DUE', sev: st === 'LATE' ? 3 : 2, account: a.ACCOUNT_NUMBER, name: a.ACCOUNT_NAME, bu: a.BU_ID, text: 'Promised ' + (a.AMOUNT != null ? E.money(+a.AMOUNT) + ' ' : '') + 'by ' + a.DUE_DATE + (st === 'LATE' ? ' — check the payment' : ' — due today'), ref: a.ACT_ID, when: a.DUE_DATE });
            else if (a.KIND !== 'PROMISE' && a.KIND !== 'DISPUTE' && (st === 'LATE' || st === 'DUE')) out.push({ kind: 'FOLLOWUP', sev: st === 'LATE' ? 2 : 1, account: a.ACCOUNT_NUMBER, name: a.ACCOUNT_NAME, bu: a.BU_ID, text: (a.SUBJECT || E.KINDS[a.KIND] && E.KINDS[a.KIND].label || 'Follow-up') + ' — ' + (st === 'LATE' ? 'was due ' : 'due ') + a.DUE_DATE, ref: a.ACT_ID, when: a.DUE_DATE });
        });
        return out.sort(function (a, b) { return b.sev - a.sev || String(a.when || '').localeCompare(String(b.when || '')); });
    };

    /** One customer's history, newest first: statements, the customer's answers and every activity. */
    E.timeline = function (stmts, acts) {
        var out = [];
        (stmts || []).forEach(function (s) {
            out.push({ at: s.SENT_AT || s.CREATED_AT, kind: 'STATEMENT', stmt: s, title: 'Statement as at ' + s.STMT_DATE, state: E.stmtState(s) });
            if (s.RESP_AT) out.push({ at: s.RESP_AT, kind: s.RESP_STATUS === 'DISPUTED' ? 'DISPUTE' : 'CONFIRM', stmt: s, title: s.RESP_STATUS === 'DISPUTED' ? 'Customer disputed the balance' : 'Customer agreed the balance', body: s.RESP_COMMENT, by: 'customer' });
        });
        (acts || []).forEach(function (a) { if (a.SOURCE === 'CUSTOMER') return; out.push({ at: a.CREATED_AT, kind: a.KIND, act: a, title: a.SUBJECT || (E.KINDS[a.KIND] && E.KINDS[a.KIND].label) || a.KIND, body: a.BODY, by: a.CREATED_BY }); });
        return out.sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
    };

    /** KPI figures for a set of statements. */
    E.kpis = function (stmts) {
        var k = { total: 0, emailed: 0, posted: 0, failed: 0, opened: 0, read: 0, agreed: 0, disputed: 0, bounced: 0, value: 0 };
        (stmts || []).forEach(function (s) {
            var st = E.stmtState(s).key; k.total++; k.value += +s.BALANCE || 0;
            if (s.STATUS === 'SENT') k.emailed++;
            if (s.STATUS === 'POSTED') k.posted++;
            if (st === 'FAILED') k.failed++;
            if (st === 'BOUNCED') k.bounced++;
            if (+s.OPENS > 0 || s.READ_AT || s.RESP_STATUS) k.opened++;
            if (s.READ_AT) k.read++;
            if (s.RESP_STATUS === 'AGREED') k.agreed++;
            if (s.RESP_STATUS === 'DISPUTED') k.disputed++;
        });
        k.openRate = k.emailed ? Math.round(100 * k.opened / k.emailed) : null;
        return k;
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = E;
    root.DCE = E;
})(typeof window !== 'undefined' ? window : globalThis);
