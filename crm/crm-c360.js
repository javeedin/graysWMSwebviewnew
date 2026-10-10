/* Customer CRM · Customer 360 (tab c360): one customer — Fusion master, AR (open items, invoices, receipts), sales orders,
 * items bought + stock now, statements (Debtors Control records) with the last statement's journey, tickets, calls, e-mails,
 * contacts (Fusion + CRM), the health score and the merged timeline.
 * What it reads: APEX (CRM + Debtors tables) every time; Fusion sections are shown from this PC's DuckDB copy at once
 * (w2_crm_c360) and read live in the background (master, open items, sales) or on demand (the other sections, Refresh). */
(function () {
    'use strict';
    var C = window.CRM, E = C.E, S = C.S, D = C.D, DE = C.DE, esc = C.esc, money = C.money;
    function $(id) { return document.getElementById(id); }
    var SUBS = [['overview', 'fa-gauge', 'Overview'], ['timeline', 'fa-timeline', 'Timeline'], ['ar', 'fa-file-invoice-dollar', 'Invoices & AR'], ['orders', 'fa-cart-shopping', 'Sales orders'], ['items', 'fa-boxes-stacked', 'Items & stock'],
        ['stmts', 'fa-file-invoice', 'Statements'], ['tickets', 'fa-ticket', 'Tickets'], ['calls', 'fa-phone', 'Calls'], ['mail', 'fa-envelope', 'E-mails'], ['contacts', 'fa-address-book', 'Contacts'], ['details', 'fa-circle-info', 'Details']];
    var AUTO = ['master', 'open', 'sales'];

    C.open360 = function (bu, account, name, sub) {
        account = String(account || '').trim(); if (!account) return;
        bu = bu || C.buOf(account);
        var same = C.cust && C.cust.account === account && C.cust.bu === bu;
        if (!same) C.cust = { bu: bu, account: account, name: name || (C.master[account] || {}).CUSTOMER || '', sub: sub || 'overview', a: null, f: {}, loading: true };
        else if (sub) C.cust.sub = sub;
        C.pushRecent({ bu: bu, account: account, name: C.cust.name });
        $('tab-c360').hidden = false; $('c360-name').textContent = C.cust.name || account;
        C.go('c360');
        if (!same) load();
    };
    C.ACT.c360Sub = function (el) { C.cust.sub = el.dataset.sub; C.render(); need(); };
    C.ACT.c360Refresh = function () { C.cust.a = null; load(true); };
    C.ACT.c360Section = function (el) { fetchSection(el.dataset.sec, true); };
    C.CH.c360Bu = function (el) { C.cust.bu = el.value; C.cust.f = {}; load(); };

    function load(force) {
        var c = C.cust, acct = c.account;
        c.loading = true; C.render();
        var apex = Promise.all([
            S.tickets.list({ account: acct, limit: 500 }), S.calls.list({ account: acct, limit: 500 }), S.messages.list({ account: acct, limit: 500 }), S.contacts.list(acct).catch(function () { return []; }),
            D.stmt.search({ account: acct, limit: 300 }).catch(function () { return []; }), D.act.list({ account: acct, limit: 1000 }).catch(function () { return []; })
        ]).then(function (r) {
            var a = { tickets: r[0], calls: r[1], msgs: r[2], contacts: r[3], stmts: r[4].filter(function (s) { return !c.bu || !s.BU_ID || s.BU_ID === c.bu; }), acts: r[5] };
            return S.events.list(a.tickets.map(function (t) { return t.TICKET_ID; })).then(function (ev) { a.events = ev; return a; }, function () { a.events = []; return a; });
        });
        var kept = S.duck.c360(C.pod, c.bu, acct).catch(function () { return {}; });
        Promise.all([apex, kept]).then(function (r) {
            if (C.cust !== c) return;
            c.a = r[0]; Object.keys(r[1]).forEach(function (k) { if (!c.f[k] || !c.f[k].rows) c.f[k] = r[1][k]; });
            c.loading = false;
            if (!c.name) c.name = (c.f.master && c.f.master.rows && c.f.master.rows[0] && c.f.master.rows[0].CUSTOMER) || (c.a.tickets[0] || {}).ACCOUNT_NAME || (c.a.stmts[0] || {}).ACCOUNT_NAME || '';
            $('c360-name').textContent = c.name || acct;
            C.render();
            AUTO.forEach(function (k) { if (force || !c.f[k] || !c.f[k].fresh) fetchSection(k, true); });
            need();
        }, function (e) { c.loading = false; c.err = C.errText(e); C.render(); });
    }
    /** the sections the open sub-tab needs */
    function need() {
        var c = C.cust; if (!c) return;
        var want = { ar: ['open', 'invoices', 'receipts'], orders: ['orders'], items: ['items'], contacts: ['fcontacts'], timeline: ['orders', 'receipts'] }[c.sub] || [];
        want.forEach(function (k) { if (!c.f[k]) fetchSection(k, false); });
    }
    function sqlOf(k) {
        var c = C.cust, b = C.bu(c.bu) || { id: c.bu }, m = 24;
        switch (k) {
            case 'master': return DE.masterSql([c.account]);
            case 'open': return [DE.openItemsSql(b, c.account)];
            case 'sales': return E.sql.salesByMonth(c.account, c.bu);
            case 'orders': return E.sql.orders(c.account, c.bu, m);
            case 'invoices': return E.sql.invoices(c.account, c.bu, 12);
            case 'receipts': return E.sql.receipts(c.account, c.bu, 12);
            case 'items': return E.sql.items(c.account, c.bu, 12);
            case 'fcontacts': return E.sql.contacts(c.account);
            case 'stock': return E.sql.stock(((c.f.items || {}).rows || []).slice(0, 80).map(function (r) { return r.INVENTORY_ITEM_ID; }));
        }
        return [];
    }
    function fetchSection(k, live) {
        var c = C.cust; if (!c || !D.hasHost()) return;
        var cur = c.f[k];
        if (!live && cur && cur.rows) return;
        if (cur && cur.loading) return;
        var list = sqlOf(k); if (!list.length) return;
        c.f[k] = Object.assign({}, cur || {}, { loading: true, err: null });
        if (C.tab === 'c360') C.render();
        C.fusionFirst(list, 5000).then(function (r) {
            c.f[k] = { rows: r.rows, sql: r.sql, at: S.now(), fresh: true };
            S.duck.keep360(C.pod, c.bu, c.account, k, r.rows, r.sql);
            if (k === 'master' && r.rows[0]) { C.master[c.account] = r.rows[0]; if (!c.name) { c.name = r.rows[0].CUSTOMER; $('c360-name').textContent = c.name; } keepPhones(c, r.rows[0]); }
        }, function (e) { c.f[k] = Object.assign({}, cur || {}, { loading: false, err: C.errText(e) }); }).then(function () { if (C.cust === c && C.tab === 'c360') C.render(); });
    }
    /** the customer's numbers into the PC's phone index (screen pop next time) */
    function keepPhones(c, m) {
        var rows = [];
        String(m.PHONE || '').split(/[;,/]/).forEach(function (p) { p = p.trim(); if (p) rows.push({ phone: p, last7: E.phone(p, C.setup.phone.country).last7, bu: c.bu, account: c.account, name: m.CUSTOMER || c.name, contact: '', source: 'Fusion', read_at: S.now() }); });
        if (rows.length) S.duck.put('w2_crm_phone', { account: c.account, source: 'Fusion' }, rows);
    }
    C.c360Fetch = fetchSection;

    // ── helpers ───────────────────────────────────────────────────
    function rowsOf(k) { var x = C.cust.f[k]; return x && x.rows ? x.rows : []; }
    function src(k, label) {
        var x = C.cust.f[k] || {};
        return '<div class="srcnote">' + (x.loading ? '<span class="spin"></span> reading Fusion…' : x.err ? '<span class="badc"><i class="fas fa-triangle-exclamation"></i> ' + esc(x.err) + '</span>' : x.at ? (x.fresh ? 'read from Fusion ' : '<i class="fas fa-database"></i> kept on this PC · read ') + C.when(x.at) : 'not read yet') +
            ' <a data-act="c360Section" data-sec="' + k + '"><i class="fas fa-rotate"></i> ' + (label || 'Read from Fusion') + '</a>' + (x.sql ? ' · <a data-act="showSql" data-sec="' + k + '">SQL</a>' : '') + '</div>';
    }
    C.ACT.showSql = function (el) { var x = C.cust.f[el.dataset.sec] || {}; C.modal('<i class="fas fa-code"></i> SQL · ' + esc(el.dataset.sec), '<textarea class="code" rows="18" readonly>' + esc(x.sql || '') + '</textarea>', '<button class="btn" data-act="mclose">Close</button>', true); };
    function master() { var m = rowsOf('master')[0]; return m || C.master[C.cust.account] || {}; }
    function arSum() { var o = C.cust.f.open; return o && o.rows ? DE.openItemsSummary(o.rows) : null; }
    function lastContact(a) {
        var at = [];
        a.calls.forEach(function (x) { at.push(x.STARTED_AT); }); a.msgs.forEach(function (x) { at.push(x.CREATED_AT); });
        a.acts.forEach(function (x) { if (x.SOURCE === 'USER') at.push(x.CREATED_AT); }); a.events.forEach(function (x) { if (x.KIND === 'COMMENT' || x.KIND === 'EMAIL_OUT') at.push(x.EVENT_AT); });
        a.stmts.forEach(function (s) { if (s.STATUS === 'SENT') at.push(s.SENT_AT || s.CREATED_AT); });
        return at.filter(Boolean).sort().pop() || null;
    }
    C.c360Health = function () {
        var c = C.cust, a = c.a; if (!a) return null;
        var ar = arSum(), tr = E.salesTrend(rowsOf('sales'));
        var csat = { n: 0, sum: 0 }; a.tickets.forEach(function (t) { if (+t.CSAT) { csat.n++; csat.sum += +t.CSAT; } });
        var card = C.cards[c.bu + '|' + c.account] || {};
        return E.health({ ar: ar ? { total: ar.total, overdue: ar.overdue, aging: ar.aging } : null, sales: rowsOf('sales').length ? tr : null, tickets: a.tickets, lastContact: lastContact(a) || null,
            disputes: a.acts.filter(function (x) { return x.KIND === 'DISPUTE' && x.STATUS === 'OPEN'; }).length, brokenPromises: a.acts.filter(function (x) { return x.KIND === 'PROMISE' && x.STATUS === 'BROKEN'; }).length,
            creditHold: card.ON_HOLD === 'Y' || master().CREDIT_HOLD === 'Y', stmt: a.stmts[0], csat: csat });
    };
    function ring(h) {
        var col = h.band.cls === 'ok' ? '#16a34a' : h.band.cls === 'warn' ? '#f59e0b' : '#dc2626';
        return '<div class="health" style="background:conic-gradient(' + col + ' ' + h.score * 3.6 + 'deg, #e5e7eb 0)" title="' + esc(h.why.map(function (w) { return w.text; }).join('\n')) + '"><div class="in"><div><b>' + h.score + '</b><span>' + esc(h.band.label) + '</span></div></div></div>';
    }

    // ── the view ──────────────────────────────────────────────────
    C.views.c360 = function () {
        var c = C.cust; if (!c) return '<div class="empty">Open a customer from Customers or the search box.</div>';
        if (c.err) return '<div class="note bad">' + esc(c.err) + '</div>';
        var m = master(), card = C.cards[c.bu + '|' + c.account] || {}, a = c.a;
        var h = a ? C.c360Health() : null;
        var phones = String(m.PHONE || card.PHONE || '').split(/[;,/]/).map(function (x) { return x.trim(); }).filter(Boolean);
        var email = card.STMT_TO || m.EMAIL || '';
        var head = '<div class="card"><div class="c3head">' + C.avatar(c.name || c.account, true) + '<div style="flex:1;min-width:280px"><div class="nm">' + esc(c.name || '—') + ' ' + (m.STATUS && m.STATUS !== 'A' ? C.pill('inactive', 'bad') : '') + (card.ON_HOLD === 'Y' || m.CREDIT_HOLD === 'Y' ? C.pill('<i class="fas fa-lock"></i> credit hold', 'bad') : '') + (card.TAGS ? ' ' + card.TAGS.split(/[,;]/).map(function (t) { return C.pill(esc(t.trim()), 'vio'); }).join(' ') : '') + '</div>' +
            '<div class="facts"><span><i class="fas fa-hashtag"></i>' + esc(c.account) + '</span><span><i class="fas fa-building"></i><select data-ch="c360Bu" style="min-height:26px;padding:2px 6px">' + C.bus.map(function (b) { return '<option value="' + esc(b.id) + '"' + (b.id === c.bu ? ' selected' : '') + '>' + esc(b.name || b.id) + '</option>'; }).join('') + '</select></span>' +
            phones.map(function (p) { return '<span><i class="fas fa-phone"></i><a data-act="dialNum" data-num="' + esc(p) + '" data-acct="' + esc(c.account) + '">' + esc(p) + '</a></span>'; }).join('') +
            (email ? '<span><i class="fas fa-envelope"></i><a data-act="compose" data-to="' + esc(email) + '">' + esc(email) + '</a></span>' : '') +
            (m.BILL_TO_ADDRESS ? '<span><i class="fas fa-location-dot"></i>' + esc(m.BILL_TO_ADDRESS) + '</span>' : '') + (m.COLLECTOR ? '<span><i class="fas fa-user-tie"></i>' + esc(m.COLLECTOR) + '</span>' : '') +
            (m.PAYMENT_TERMS ? '<span><i class="fas fa-calendar"></i>' + esc(m.PAYMENT_TERMS) + '</span>' : '') + (m.CREDIT_LIMIT != null && m.CREDIT_LIMIT !== '' ? '<span><i class="fas fa-gauge-high"></i>limit ' + money(m.CREDIT_LIMIT) + '</span>' : '') + '</div>' +
            '<div class="qa"><button class="btn ok" data-act="callCust"><i class="fas fa-phone"></i> Call</button><button class="btn" data-act="compose"><i class="fas fa-envelope"></i> E-mail</button>' +
            '<button class="btn pri" data-act="newTicket" data-acct="' + esc(c.account) + '"><i class="fas fa-ticket"></i> New ticket</button><button class="btn" data-act="sendStmt"><i class="fas fa-file-invoice"></i> Send statement</button>' +
            '<button class="btn" data-act="logNote"><i class="fas fa-note-sticky"></i> Note</button><button class="btn" data-act="logPromise"><i class="fas fa-handshake"></i> Promise to pay</button>' +
            '<button class="btn ghost" data-act="askAbout" title="Ask the Autopilot about this customer"><i class="fas fa-robot"></i> Ask</button><span class="sp"></span><button class="btn ghost" data-act="c360Refresh" title="Read everything again"><i class="fas fa-rotate"></i></button></div></div>' +
            (h ? ring(h) : '') + '</div></div>';
        var tabs = '<div class="subtabs">' + SUBS.map(function (s) {
            var n = !a ? '' : s[0] === 'tickets' ? a.tickets.filter(E.isOpen).length : s[0] === 'calls' ? a.calls.length : s[0] === 'stmts' ? a.stmts.length : s[0] === 'mail' ? a.msgs.length : '';
            return '<button data-act="c360Sub" data-sub="' + s[0] + '" class="' + (c.sub === s[0] ? 'on' : '') + '"><i class="fas ' + s[1] + '"></i> ' + s[2] + (n ? ' <span class="pill">' + n + '</span>' : '') + '</button>';
        }).join('') + '</div>';
        if (c.loading && !a) return head + tabs + '<div class="empty"><span class="spin"></span> Reading the customer…</div>';
        var body = (SV[c.sub] || SV.overview)(c, a, m, card, h);
        return head + tabs + body;
    };
    var SV = {};

    SV.overview = function (c, a, m, card, h) {
        var ar = arSum(), tr = E.salesTrend(rowsOf('sales')), lc = lastContact(a), st = a.stmts[0];
        var chg = tr.prev12 ? Math.round((tr.m12 - tr.prev12) / tr.prev12 * 100) : null;
        var openT = a.tickets.filter(E.isOpen);
        var max = Math.max.apply(null, tr.series.map(function (x) { return x.amount; }).concat([1]));
        var k = '<div class="kpis">' + C.kpi('Balance', ar ? money(ar.total) : '…', ar ? ar.n + ' open items' : 'reading', ar && ar.total > 0 ? 'info' : 'ok', 'c360Sub', ' data-sub="ar"') +
            C.kpi('Overdue', ar ? money(ar.overdue) : '…', ar ? (ar.oldest ? 'oldest ' + ar.oldest + ' days' : 'nothing late') : '', ar && ar.overdue > 0 ? 'bad' : 'ok', 'c360Sub', ' data-sub="ar"') +
            C.kpi('Sales 12 months', rowsOf('sales').length ? money(tr.m12, 0) : '…', chg == null ? '' : (chg >= 0 ? '▲ ' : '▼ ') + Math.abs(chg) + '% on the year before', chg != null && chg < -10 ? 'warn' : 'pri', 'c360Sub', ' data-sub="orders"') +
            C.kpi('Open tickets', openT.length, a.tickets.length + ' in total', openT.length ? 'warn' : 'ok', 'c360Sub', ' data-sub="tickets"') +
            C.kpi('Last contact', lc ? E.ago(lc) : 'never', lc || '', lc ? '' : 'warn', 'c360Sub', ' data-sub="timeline"') +
            C.kpi('Last statement', st ? DE.stmtState(st).label : 'none', st ? 'as at ' + st.STMT_DATE : '', st ? DE.stmtState(st).cls : 'warn', 'c360Sub', ' data-sub="stmts"') + '</div>';
        var trend = '<div class="card"><h2><i class="fas fa-chart-column"></i> Sales by month (invoiced, 24 months)</h2>' + src('sales') + (rowsOf('sales').length ? '<div class="spark">' + tr.series.map(function (x, i) { return '<span class="' + (i >= 12 ? 'cur' : '') + '" style="height:' + Math.max(1, Math.round(x.amount / max * 100)) + '%" title="' + x.month + ': ' + money(x.amount, 0) + '"></span>'; }).join('') + '</div><div class="row small muted"><span>' + tr.series[0].month + '</span><span class="sp"></span><span>last 12 months in dark · ' + money(tr.m12, 0) + ' vs ' + money(tr.prev12, 0) + '</span><span class="sp"></span><span>' + tr.series[23].month + '</span></div>' : '') + '</div>';
        var tl = E.timeline({ tickets: a.tickets, events: a.events, calls: a.calls, messages: a.msgs, stmts: a.stmts, acts: a.acts }).slice(0, 10);
        return k + '<div class="c3"><div>' + trend + (ar ? '<div class="card"><h2><i class="fas fa-layer-group"></i> Aging</h2>' + aging(ar) + '</div>' : '') +
            '<div class="card"><h2><i class="fas fa-timeline"></i> Latest</h2>' + tlHtml(tl) + '<div class="pager"><a data-act="c360Sub" data-sub="timeline">the whole timeline</a></div></div></div>' +
            '<div>' + (h ? '<div class="card"><h2>Health ' + C.pill(h.score + ' · ' + esc(h.band.label), h.band.cls) + '</h2>' + (h.why.length ? '<div class="feed">' + h.why.map(function (w) { return '<div class="fi ' + w.cls + '"><div class="ic"><i class="fas ' + (w.cls === 'ok' ? 'fa-arrow-up' : 'fa-arrow-down') + '"></i></div><div class="tx"><div class="t">' + esc(w.text) + '</div><div class="s">' + (w.pts ? w.pts + ' points' : '') + '</div></div></div>'; }).join('') + '</div>' : '<div class="muted small">Nothing pulls it down.</div>') + '</div>' : '') +
            '<div class="card"><h2><i class="fas fa-file-invoice"></i> Last statement</h2>' + stmtCard(st) + '</div>' +
            '<div class="card"><h2><i class="fas fa-ticket"></i> Open tickets</h2>' + C.ticketFeed(openT.sort(C.bySla).slice(0, 6), 'No open tickets.') + '</div></div></div>';
    };
    function aging(ar) {
        var cols = [['current', '#22c55e', 'Current'], ['d30', '#a3e635', '1–30'], ['d60', '#f59e0b', '31–60'], ['d90', '#f97316', '61–90'], ['d90p', '#dc2626', '90+']];
        var tot = cols.reduce(function (s, x) { return s + Math.max(0, ar.aging[x[0]] || 0); }, 0) || 1;
        return '<div class="aging">' + cols.map(function (x) { return '<span style="width:' + Math.max(0, ar.aging[x[0]] || 0) / tot * 100 + '%;background:' + x[1] + '" title="' + x[2] + ': ' + money(ar.aging[x[0]]) + '"></span>'; }).join('') + '</div><div class="legend">' + cols.map(function (x) { return '<span><i style="background:' + x[1] + '"></i>' + x[2] + ' ' + money(ar.aging[x[0]], 0) + '</span>'; }).join('') + '</div>';
    }
    function tlHtml(list) {
        if (!list.length) return '<div class="empty">Nothing recorded yet.</div>';
        return '<div class="feed">' + list.map(function (x) {
            var act = x.refKind === 'ticket' ? ' click" data-act="openTicket" data-id="' + esc(x.ref) : x.refKind === 'order' ? ' click" data-act="orderLines" data-no="' + esc(x.ref) : x.refKind === 'stmt' ? ' click" data-act="c360Sub" data-sub="stmts' : '';
            return '<div class="fi ' + (x.cls || '') + act + '"><div class="ic"><i class="fas ' + x.icon + '"></i></div><div class="tx"><div class="t">' + esc(x.title) + '</div><div class="s">' + esc(x.at) + (x.by ? ' · ' + esc(x.by) : '') + (x.tag ? ' · ' + esc(x.tag) : '') + '</div>' + (x.body ? '<div class="b">' + esc(String(x.body).slice(0, 400)) + '</div>' : '') + '</div></div>';
        }).join('') + '</div>';
    }
    /** the journey of one statement: recorded → PDF → sent → delivered → opened → read → the customer's answer */
    function stmtCard(s) {
        if (!s) return '<div class="empty">No statement sent to this customer yet. <a data-act="sendStmt">Send one</a></div>';
        var st = DE.stmtState(s);
        var steps = [['Recorded', true], ['PDF', !!s.SHA256], ['Sent', s.STATUS === 'SENT' || !!s.SENT_AT, s.STATUS === 'FAILED'], ['Delivered', !!s.DELIVERED_AT, !!s.BOUNCED_AT], ['Opened', +s.OPENS > 0], ['Read', !!s.READ_AT], [s.RESP_STATUS === 'DISPUTED' ? 'Queried' : 'Agreed', !!s.RESP_STATUS, s.RESP_STATUS === 'DISPUTED']];
        return '<div class="stmtcard"><div class="row"><b>As at ' + esc(s.STMT_DATE) + '</b>' + C.pill(st.label, st.cls) + '<span class="sp"></span><b>' + esc(s.CURRENCY || '') + ' ' + money(s.BALANCE) + '</b></div>' +
            '<div class="stepper2">' + steps.map(function (x) { return '<span class="s ' + (x[2] ? 'bad' : x[1] ? 'done' : '') + '">' + (x[1] && !x[2] ? '✓ ' : x[2] ? '✗ ' : '') + x[0] + '</span>'; }).join('') + '</div>' +
            '<div class="small muted">' + (s.EMAIL_TO ? 'To ' + esc(s.EMAIL_TO) + ' · ' : '') + (s.SENT_AT ? 'sent ' + esc(s.SENT_AT) : 'made ' + esc(s.CREATED_AT || '')) + ' by ' + esc(s.APP_USER || '') + (+s.OPENS ? ' · opened ' + s.OPENS + '×, last ' + esc(s.LAST_OPEN || '') : '') + (s.BOUNCED_AT ? ' · <span class="badc">bounced ' + esc(s.BOUNCE_TEXT || '') + '</span>' : '') + (s.ERROR_TEXT ? ' · <span class="badc">' + esc(s.ERROR_TEXT) + '</span>' : '') + '</div>' +
            (s.RESP_STATUS ? '<div class="note ' + (s.RESP_STATUS === 'DISPUTED' ? 'warn' : '') + '" style="margin-top:8px"><b>The customer ' + (s.RESP_STATUS === 'DISPUTED' ? 'queries the balance' : 'agreed the balance') + '</b> · ' + esc(s.RESP_AT || '') + (s.RESP_COMMENT ? '<div>“' + esc(s.RESP_COMMENT) + '”</div>' : '') + '</div>' : '') +
            '<div class="qa"><button class="btn sm" data-act="sendStmt" data-resent="' + esc(s.STMT_ID) + '"><i class="fas fa-paper-plane"></i> Send again</button>' + (s.FILE_PATH ? '<button class="btn sm" data-act="stmtPdf" data-path="' + esc(s.FILE_PATH) + '"><i class="fas fa-file-pdf"></i> Open the PDF</button><button class="btn sm" data-act="stmtVerify" data-path="' + esc(s.FILE_PATH) + '" data-sha="' + esc(s.SHA256) + '"><i class="fas fa-fingerprint"></i> Check the file</button>' : '') +
            '<button class="btn sm" data-act="compose" data-stmt="' + esc(s.STMT_ID) + '"><i class="fas fa-reply"></i> Follow up by e-mail</button></div></div>';
    }
    C.stmtCard = stmtCard;
    C.ACT.stmtPdf = function (el) { D.call('dcOpenFile', { path: el.dataset.path }).catch(function (e) { C.toast(C.errText(e), 'bad', 6000); }); };
    C.ACT.stmtVerify = function (el) {
        D.call('dcFileCheck', { path: el.dataset.path }).then(function (r) {
            if (!r.exists) C.toast('The PDF is not on this PC (made on another PC, or deleted).', 'warn', 6000);
            else C.toast(r.sha256 === el.dataset.sha ? '✓ Same file as the one recorded (SHA-256 matches)' : '✗ The file on this PC is NOT the one recorded', r.sha256 === el.dataset.sha ? 'ok' : 'bad', 7000);
        }, function (e) { C.toast(C.errText(e), 'bad'); });
    };

    SV.timeline = function (c, a) {
        var tl = E.timeline({ tickets: a.tickets, events: a.events, calls: a.calls, messages: a.msgs, stmts: a.stmts, acts: a.acts, orders: rowsOf('orders'), receipts: rowsOf('receipts') });
        var f = c.tlf || '', kinds = {}; tl.forEach(function (x) { kinds[x.kind] = (kinds[x.kind] || 0) + 1; });
        var list = f ? tl.filter(function (x) { return x.kind === f; }) : tl;
        return '<div class="card"><div class="filters"><button class="btn sm ' + (!f ? 'pri' : '') + '" data-act="tlf" data-k="">Everything ' + tl.length + '</button>' + Object.keys(kinds).sort().map(function (k) { return '<button class="btn sm ' + (f === k ? 'pri' : '') + '" data-act="tlf" data-k="' + k + '">' + esc(k.toLowerCase()) + ' ' + kinds[k] + '</button>'; }).join('') + '</div>' + tlHtml(list.slice(0, 300)) + '</div>';
    };
    C.ACT.tlf = function (el) { C.cust.tlf = el.dataset.k; C.render(); };

    SV.ar = function (c) {
        var ar = arSum(), open = rowsOf('open');
        return '<div class="card"><h2><i class="fas fa-file-invoice-dollar"></i> Open items ' + (ar ? C.pill(money(ar.total), 'info') + (ar.overdue > 0 ? C.pill(money(ar.overdue) + ' overdue', 'bad') : '') : '') + '<span class="sp"></span><button class="btn sm" data-act="arCsv"><i class="fas fa-download"></i> CSV</button></h2>' + src('open') + (ar ? aging(ar) : '') +
            C.table([['TRX_NUMBER', 'Number'], ['TRX_TYPE', 'Type'], ['TRX_DATE', 'Date'], ['DUE_DATE', 'Due'], [function (r) { return +r.DAYS_LATE > 0 ? '<span class="' + (+r.DAYS_LATE > 90 ? 'badc' : 'warnc') + '">' + r.DAYS_LATE + '</span>' : ''; }, 'Days late', 'r'],
                [function (r) { return money(r.ORIGINAL); }, 'Original', 'r num'], [function (r) { return '<b>' + money(r.REMAINING) + '</b>'; }, 'Remaining', 'r num'], ['CUSTOMER_PO', 'Customer PO'], ['REFERENCE', 'Reference']], open, { empty: 'No open items.', rowAct: 'drillItem', max: '360px' }) + '</div>' +
            '<div class="cols"><div class="card"><h2>Invoices & credit notes (12 months)</h2>' + src('invoices') + C.table([['TRX_NUMBER', 'Number'], ['TRX_DATE', 'Date'], ['TRX_TYPE', 'Type'], [function (r) { return money(r.AMOUNT); }, 'Amount', 'r num'], [function (r) { return +r.REMAINING ? money(r.REMAINING) : '<span class="okc">paid</span>'; }, 'Open', 'r num'], ['ORDER_NUMBER', 'Order']], rowsOf('invoices'), { empty: 'No invoices in 12 months.', rowAct: 'drillInv', max: '420px' }) + '</div>' +
            '<div class="card"><h2>Payments (12 months)</h2>' + src('receipts') + C.table([['RECEIPT_NUMBER', 'Receipt'], ['RECEIPT_DATE', 'Date'], [function (r) { return money(r.AMOUNT); }, 'Amount', 'r num'], ['METHOD', 'Method'], ['STATUS', 'Status']], rowsOf('receipts'), { empty: 'No payments in 12 months.', rowAct: 'drillRcpt', max: '420px' }) + '</div></div>';
    };
    C.ACT.arCsv = function () { var r = rowsOf('open'); C.csv('open-items-' + C.cust.account + '.csv', Object.keys(r[0] || {}).map(function (k) { return [k, k]; }), r); };
    C.ACT.drillItem = function (el) { var r = rowsOf('open')[+el.dataset.i]; if (r) drill(DE.rowDrill(r)); };
    C.ACT.drillInv = function (el) { var r = rowsOf('invoices')[+el.dataset.i]; if (r) drill(DE.drillOf('TRX', { TRX_ID: r.CUSTOMER_TRX_ID, NUMBER: r.TRX_NUMBER })); };
    C.ACT.drillRcpt = function (el) { var r = rowsOf('receipts')[+el.dataset.i]; if (r) drill(DE.drillOf('RECEIPT', { RECEIPT_ID: r.CASH_RECEIPT_ID, NUMBER: r.RECEIPT_NUMBER })); };
    /** a transaction / receipt / order: every part of the Debtors drill-down, read live, in a dialog */
    function drill(dr) {
        if (!dr) return;
        var def = DE.DRILLS[dr.kind], b = C.bu(C.cust.bu) || { id: C.cust.bu }, out = {};
        function paint() {
            C.modal('<i class="fas fa-magnifying-glass"></i> ' + esc(dr.label), def.parts.map(function (p) {
                var x = out[p.id];
                return '<h3>' + esc(p.title) + '</h3>' + (!x ? '<div class="muted small"><span class="spin"></span> reading…</div>' : x.err ? '<div class="note bad">' + esc(x.err) + '</div>' : C.table(Object.keys(x.rows[0] || {}).map(function (k) { return [k, k]; }), x.rows, { empty: 'Nothing.', max: '260px' }));
            }).join(''), (dr.kind === 'ORDER' ? '<button class="btn" data-act="fusionOrder" data-no="' + esc(dr.vars.ORDER_NUMBER) + '" data-id="' + esc(dr.vars.HEADER_ID || '') + '"><i class="fas fa-up-right-from-square"></i> Open in Fusion</button>' : '') + '<button class="btn" data-act="mclose">Close</button>', true);
        }
        paint();
        def.parts.reduce(function (p, part) {
            return p.then(function () { return D.fusionSql(DE.drillSql(part, dr.vars, b), 2000).then(function (rows) { out[part.id] = { rows: rows }; }, function (e) { out[part.id] = { err: C.errText(e) }; }).then(function () { if ($('modal').classList.contains('on')) paint(); }); });
        }, Promise.resolve());
    }
    C.drill = drill;

    SV.orders = function (c) {
        var rows = rowsOf('orders'), tot = rows.reduce(function (s, r) { return s + (+r.AMOUNT || 0); }, 0);
        var open = rows.filter(function (r) { return !/CLOSED|CANCEL/i.test(r.STATUS || ''); }).length;
        return '<div class="card"><h2><i class="fas fa-cart-shopping"></i> Sales orders (24 months) ' + C.pill(rows.length + ' orders') + C.pill(money(tot, 0), 'info') + (open ? C.pill(open + ' not closed', 'warn') : '') + '</h2>' + src('orders') +
            C.table([['ORDER_NUMBER', 'Order'], ['ORDERED', 'Ordered'], [function (r) { return C.pill(esc(r.STATUS || ''), /CLOSED/i.test(r.STATUS) ? 'ok' : /CANCEL/i.test(r.STATUS) ? 'muted' : 'info'); }, 'Status'], ['CUSTOMER_PO', 'Customer PO'],
                [function (r) { return (r.SHIPPED_N || 0) + ' / ' + (r.LINES_N || 0); }, 'Lines shipped', 'r'], [function (r) { return money(r.AMOUNT); }, 'Amount', 'r num'], ['CURRENCY', ''],
                [function (r) { return '<button class="btn sm ghost" data-act="fusionOrder" data-no="' + esc(r.ORDER_NUMBER) + '" data-id="' + esc(r.HEADER_ID) + '" title="Open in Fusion"><i class="fas fa-up-right-from-square"></i></button>'; }, '', 'r']], rows, { empty: 'No sales orders in 24 months.', rowAct: 'orderRow' }) + '</div>';
    };
    C.ACT.orderRow = function (el, e) { if (e.target.closest('button')) return; var r = rowsOf('orders')[+el.dataset.i]; if (r) drill(DE.drillOf('ORDER', { ORDER_NUMBER: r.ORDER_NUMBER, HEADER_ID: r.HEADER_ID })); };
    C.ACT.orderLines = function (el) { drill(DE.drillOf('ORDER', { ORDER_NUMBER: el.dataset.no })); };
    C.ACT.fusionOrder = function (el) {
        var url = DE.fusionUrl('ORDER', { id: el.dataset.id, number: el.dataset.no }, DE.POD_BASE[C.pod] || DE.POD_BASE.PROD, {});
        if (!url) { C.toast('No link for this order', 'warn'); return; }
        if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage({ action: 'openExternalUrl', url: url }); else window.open(url, '_blank');
    };

    SV.items = function (c) {
        var rows = rowsOf('items'), stock = rowsOf('stock'), byItem = {};
        stock.forEach(function (s) { var x = byItem[s.ITEM] = byItem[s.ITEM] || { qty: 0, where: [] }; x.qty += +s.QTY || 0; x.where.push(s.ORG + (s.SUBINVENTORY ? '/' + s.SUBINVENTORY : '') + ': ' + s.QTY); });
        var st = C.cust.f.stock || {};
        return '<div class="card"><h2><i class="fas fa-boxes-stacked"></i> What this customer buys (12 months) <span class="sp"></span><button class="btn sm" data-act="c360Section" data-sec="stock"' + (rows.length ? '' : ' disabled') + '><i class="fas fa-warehouse"></i> ' + (st.loading ? 'Reading stock…' : 'Stock now') + '</button></h2>' + src('items') +
            (st.err ? '<div class="note bad">Stock: ' + esc(st.err) + '</div>' : '') +
            C.table([['ITEM', 'Item'], ['DESCRIPTION', 'Description'], [function (r) { return r.ORDERS; }, 'Orders', 'r'], [function (r) { return money(r.QTY, 0) + ' ' + esc(r.UOM || ''); }, 'Quantity', 'r'], [function (r) { return money(r.AMOUNT); }, 'Amount', 'r num'], ['LAST_ORDERED', 'Last ordered'],
                [function (r) { var s = byItem[r.ITEM]; if (!stock.length) return '<span class="muted small">—</span>'; return s ? '<span title="' + esc(s.where.join('\n')) + '" class="' + (s.qty > 0 ? 'okc' : 'badc') + '">' + money(s.qty, 0) + '</span>' : '<span class="badc">none</span>'; }, 'On hand', 'r']], rows, { empty: 'Nothing ordered in 12 months.' }) + '</div>';
    };

    SV.stmts = function (c, a) {
        var list = a.stmts;
        return '<div class="cols"><div class="card"><h2><i class="fas fa-file-invoice"></i> Last statement</h2>' + stmtCard(list[0]) + '</div>' +
            '<div class="card"><h2><i class="fas fa-paper-plane"></i> Send a statement now</h2><p class="small muted">The same steps as Debtors Control: the PDF from the business unit\'s statement report, recorded in APEX before it is e-mailed, fingerprinted, tracked (opened / read / agreed / queried).</p><button class="btn pri" data-act="sendStmt"><i class="fas fa-paper-plane"></i> Send a statement</button> <a href="../debtors/index.html" class="small">Debtors Control</a></div></div>' +
            '<div class="card"><h2>Every statement ' + C.pill(list.length) + '</h2>' + C.table([['STMT_DATE', 'As at'], [function (s) { var x = DE.stmtState(s); return C.pill(x.label, x.cls); }, 'Status'], [function (s) { return esc(s.CURRENCY || '') + ' ' + money(s.BALANCE); }, 'Balance', 'r'], ['EMAIL_TO', 'To'], [function (s) { return esc(s.SENT_AT || s.CREATED_AT || ''); }, 'When'], ['APP_USER', 'By'],
                [function (s) { return +s.OPENS ? s.OPENS + '×' : ''; }, 'Opened', 'r'], [function (s) { return s.RESP_STATUS ? C.pill(s.RESP_STATUS === 'DISPUTED' ? 'queried' : 'agreed', s.RESP_STATUS === 'DISPUTED' ? 'warn' : 'ok', s.RESP_COMMENT) : ''; }, 'Answer'],
                [function (s) { return s.FILE_PATH ? '<button class="btn sm ghost" data-act="stmtPdf" data-path="' + esc(s.FILE_PATH) + '"><i class="fas fa-file-pdf"></i></button>' : ''; }, '', 'r']], list, { empty: 'No statements yet.' }) + '</div>';
    };
    SV.tickets = function (c, a) {
        return '<div class="card"><h2><i class="fas fa-ticket"></i> Tickets <span class="sp"></span><button class="btn sm pri" data-act="newTicket" data-acct="' + esc(c.account) + '"><i class="fas fa-plus"></i> New ticket</button></h2>' + C.ticketTable(a.tickets) + '</div>';
    };
    SV.calls = function (c, a) {
        return '<div class="card"><h2><i class="fas fa-phone"></i> Calls <span class="sp"></span><button class="btn sm ok" data-act="callCust"><i class="fas fa-phone"></i> Call</button></h2>' + C.callTable(a.calls) + '</div>';
    };
    SV.mail = function (c, a) {
        return '<div class="card"><h2><i class="fas fa-envelope"></i> E-mails from the CRM <span class="sp"></span><button class="btn sm pri" data-act="compose"><i class="fas fa-pen"></i> New e-mail</button></h2>' + C.msgTable(a.msgs) + '</div>';
    };
    SV.contacts = function (c, a) {
        var f = rowsOf('fcontacts');
        function acts(phone, email, name) { return (phone ? '<button class="btn sm" data-act="dialNum" data-num="' + esc(phone) + '" data-acct="' + esc(c.account) + '" data-contact="' + esc(name) + '"><i class="fas fa-phone"></i></button> ' : '') + (email ? '<button class="btn sm" data-act="compose" data-to="' + esc(email) + '"><i class="fas fa-envelope"></i></button>' : ''); }
        return '<div class="card"><h2><i class="fas fa-address-book"></i> People we deal with <span class="sp"></span><button class="btn sm pri" data-act="contactEdit"><i class="fas fa-plus"></i> Add a contact</button></h2>' +
            C.table([[function (r) { return C.avatar(r.NAME) + ' <b>' + esc(r.NAME) + '</b>' + (r.IS_PRIMARY === 'Y' ? ' ' + C.pill('primary', 'ok') : ''); }, 'Name'], ['ROLE', 'Role'], ['EMAIL', 'E-mail'], [function (r) { return esc([r.PHONE, r.MOBILE].filter(Boolean).join(' / ')); }, 'Phone'], ['NOTES', 'Notes'],
                [function (r) { return acts(r.MOBILE || r.PHONE, r.EMAIL, r.NAME) + ' <button class="btn sm ghost" data-act="contactEdit" data-id="' + esc(r.CONTACT_ID) + '"><i class="fas fa-pen"></i></button>'; }, '', 'r']], a.contacts, { empty: 'No contacts kept in the CRM yet.' }) + '</div>' +
            '<div class="card"><h2>Contacts in Fusion</h2>' + src('fcontacts') + C.table([['CONTACT', 'Name'], ['ROLE', 'Role'], ['EMAIL', 'E-mail'], ['PHONE', 'Phone'], [function (r) { return acts(r.PHONE, r.EMAIL, r.CONTACT); }, '', 'r']], f, { empty: 'No contacts in Fusion.' }) + '</div>';
    };
    C.ACT.contactEdit = function (el) {
        var c = C.cust, x = (c.a.contacts.filter(function (k) { return k.CONTACT_ID === el.dataset.id; })[0]) || { BU_ID: c.bu, ACCOUNT_NUMBER: c.account };
        C.modal('<i class="fas fa-address-card"></i> ' + (x.CONTACT_ID ? 'Contact' : 'New contact') + ' · ' + esc(c.name),
            '<div class="form"><div class="field"><label>Name</label><input type="text" id="ct-name" value="' + esc(x.NAME || '') + '"></div><div class="field"><label>Role</label><input type="text" id="ct-role" value="' + esc(x.ROLE || '') + '" placeholder="Buyer, accounts, owner …"></div>' +
            '<div class="field"><label>E-mail</label><input type="email" id="ct-email" value="' + esc(x.EMAIL || '') + '"></div><div class="field"><label>Phone</label><input type="text" id="ct-phone" value="' + esc(x.PHONE || '') + '"></div><div class="field"><label>Mobile</label><input type="text" id="ct-mobile" value="' + esc(x.MOBILE || '') + '"></div>' +
            '<div class="field"><label>&nbsp;</label><label class="chk"><input type="checkbox" id="ct-primary"' + (x.IS_PRIMARY === 'Y' ? ' checked' : '') + '> Primary contact</label></div><div class="field wide"><label>Notes</label><textarea id="ct-notes" rows="3">' + esc(x.NOTES || '') + '</textarea></div></div>',
            (x.CONTACT_ID ? '<button class="btn bad" data-act="contactDel" data-id="' + esc(x.CONTACT_ID) + '">Remove</button><span class="sp"></span>' : '') + '<button class="btn" data-act="mclose">Cancel</button><button class="btn pri" data-act="contactSave">Save</button>');
        C.ACT.contactSave = function () {
            var v = function (id) { return ($(id).value || '').trim(); };
            if (!v('ct-name')) { C.toast('A name, please', 'warn'); return; }
            var rec = Object.assign({}, x, { NAME: v('ct-name'), ROLE: v('ct-role'), EMAIL: v('ct-email'), PHONE: v('ct-phone'), MOBILE: v('ct-mobile'), IS_PRIMARY: $('ct-primary').checked ? 'Y' : 'N', NOTES: v('ct-notes') });
            S.contacts.save(rec).then(function () { C.mclose(); C.toast('Contact saved', 'ok'); return S.contacts.list(c.account); }).then(function (l) { c.a.contacts = l; C.contacts = C.contacts.filter(function (k) { return k.ACCOUNT_NUMBER !== c.account; }).concat(l); C.render(); }, function (e) { C.toast(C.errText(e), 'bad', 7000); });
        };
    };
    C.ACT.contactDel = function (el) { var c = C.cust; S.contacts.remove(el.dataset.id).then(function () { C.mclose(); c.a.contacts = c.a.contacts.filter(function (k) { return k.CONTACT_ID !== el.dataset.id; }); C.render(); }, function (e) { C.toast(C.errText(e), 'bad'); }); };
    SV.details = function (c, a, m, card) {
        function kv(obj) { var ks = Object.keys(obj || {}).filter(function (k) { return obj[k] != null && obj[k] !== ''; }); return ks.length ? '<div class="kv">' + ks.map(function (k) { return '<div class="k">' + esc(k.replace(/_/g, ' ').toLowerCase()) + '</div><div class="v">' + esc(obj[k]) + '</div>'; }).join('') + '</div>' : '<div class="empty">Nothing.</div>'; }
        return '<div class="cols"><div class="card"><h2>Fusion customer master</h2>' + src('master') + kv(m) + '</div><div class="card"><h2>Debtors Control card</h2>' + kv(card) + '<div class="pager"><a href="../debtors/index.html">Open Debtors Control</a></div></div></div>';
    };

    // ── quick actions on the open customer ──
    C.ACT.callCust = function () {
        var c = C.cust, m = master(), card = C.cards[c.bu + '|' + c.account] || {};
        var nums = String(m.PHONE || card.PHONE || '').split(/[;,/]/).map(function (x) { return x.trim(); }).filter(Boolean).concat(((c.a || {}).contacts || []).map(function (k) { return k.MOBILE || k.PHONE; }).filter(Boolean));
        C.phone.open({ number: nums[0] || '', account: c.account, bu: c.bu, name: c.name, numbers: nums });
    };
    C.ACT.sendStmt = function (el) { var c = C.cust; C.mail.statement({ bu: c.bu, account: c.account, name: c.name, resentOf: el.dataset.resent || null }); };
    C.ACT.askAbout = function () { var c = C.cust; C.autopilot.ask('Give me a 360 summary of customer ' + c.account + ' (' + (c.name || '') + '): balance and overdue, last statement, open tickets, recent calls, and what I should do next.'); };
    function actDialog(kind) {
        var c = C.cust, k = DE.KINDS[kind] || { label: kind };
        C.modal('<i class="fas fa-note-sticky"></i> ' + esc(k.label || kind) + ' · ' + esc(c.name),
            '<div class="form"><div class="field wide"><label>Subject</label><input type="text" id="ac-subj" value="' + (kind === 'PROMISE' ? 'Promise to pay' : '') + '"></div>' + (kind === 'PROMISE' ? '<div class="field"><label>Amount</label><input type="number" id="ac-amt" step="0.01"></div><div class="field"><label>Pay by</label><input type="date" id="ac-due" value="' + C.addDays(7) + '"></div>' : '') +
            '<div class="field wide"><label>Details</label><textarea id="ac-body" rows="4"></textarea></div></div><p class="small muted">Saved on the customer\'s timeline in Debtors Control too.</p>',
            '<button class="btn" data-act="mclose">Cancel</button><button class="btn pri" data-act="actSave">Save</button>');
        C.ACT.actSave = function () {
            var amt = $('ac-amt') ? +$('ac-amt').value || null : null;
            D.act.add({ id: DE.uid('ac'), buId: c.bu, account: c.account, name: c.name, kind: kind, subject: $('ac-subj').value || (k.label || kind), body: $('ac-body').value, amount: amt, due: $('ac-due') ? $('ac-due').value : null, status: kind === 'PROMISE' ? 'OPEN' : 'DONE' })
                .then(function () { C.mclose(); C.toast('Saved', 'ok'); return D.act.list({ account: c.account }); }).then(function (l) { c.a.acts = l; C.render(); }, function (e) { C.toast(C.errText(e), 'bad', 7000); });
        };
    }
    C.ACT.logNote = function () { actDialog('NOTE'); };
    C.ACT.logPromise = function () { actDialog('PROMISE'); };
})();
