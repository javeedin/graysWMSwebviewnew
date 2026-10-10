/* Customer CRM · Pinned customers (tab pinned): every agent keeps their own list of customers to watch.
 * The list is per app login × pod in APEX (WMS_CRM_PINS, the record — every PC of that agent sees it) and kept on this PC in
 * DuckDB (w2_crm_pins: drawn at once on start, then APEX is read and wins). Pin / unpin from the Customers grid, the Customer 360
 * header or this page; a pinned customer's tab shows a pin. */
(function () {
    'use strict';
    var C = window.CRM, E = C.E, S = C.S, D = C.D, esc = C.esc;
    function $(id) { return document.getElementById(id); }

    var P = C.pins = { list: [], info: {}, src: '', at: '', q: '', busy: {} };
    C.isPinned = function (account) { return P.list.some(function (p) { return p.ACCOUNT_NUMBER === account; }); };

    function after() {
        var n = $('n-pinned'); if (n) n.textContent = P.list.length ? P.list.length : '';
        if (C.paintCTabs) C.paintCTabs();
        if (C.tab === 'pinned' || C.tab === 'customers' || C.tab === 'c360') C.render();
        readInfo();
    }
    /** this PC's copy first (instant), then APEX (the record) — APEX replaces this PC's copy */
    P.load = function () {
        var pod = C.pod;
        var local = S.duck.pins(pod).then(function (l) { if (l && !P.src && pod === C.pod) { P.list = l; P.src = 'this PC'; after(); } }, function () { });
        return local.then(function () { return S.pins.list(pod); }).then(function (l) {
            if (pod !== C.pod) return;
            P.list = l; P.src = 'APEX'; P.at = S.now(); P.err = null;
            S.duck.keepPins(pod, l);
            after();
        }, function (e) { P.err = C.errText(e); console.warn('[CRM] pins:', P.err); if (C.tab === 'pinned') C.render(); });
    };
    /** names, phones and e-mails of the pinned customers from this PC's customer master */
    function readInfo() {
        var need = P.list.map(function (p) { return p.ACCOUNT_NUMBER; }).filter(function (a) { return !P.info[a]; });
        if (!need.length) return;
        var L = S.duck.lit;
        S.duck.qs(['SELECT account_number, customer, phone, email, bill_to_address, dff_json FROM w2_crm_customers WHERE pod = ' + L(C.pod) + ' AND account_number IN (' + need.map(L).join(', ') + ')']).then(function (r) {
            (r[0] || []).forEach(function (x) { P.info[x.account_number] = x; });
            need.forEach(function (a) { if (!P.info[a]) P.info[a] = { none: true }; });
            if (C.tab === 'pinned') C.render();
        }, function () { });
    }
    /** pin / unpin one customer: shown at once, written to APEX, then the list is read again and kept on this PC */
    P.toggle = function (account, bu, name) {
        account = String(account || '').trim(); if (!account || P.busy[account]) return Promise.resolve();
        var pod = C.pod, was = C.isPinned(account), before = P.list.slice();
        P.busy[account] = true;
        if (was) P.list = P.list.filter(function (p) { return p.ACCOUNT_NUMBER !== account; });
        else P.list = [{ APP_USER: D.user(), POD: pod, ACCOUNT_NUMBER: account, BU_ID: bu || C.buOf(account) || '', ACCOUNT_NAME: name || (C.master[account] || {}).CUSTOMER || '', NOTE: '', SORT_N: 0, PINNED_AT: S.now() }].concat(P.list);
        after();
        var w = was ? S.pins.remove(pod, account) : S.pins.add(pod, { account: account, bu: bu || C.buOf(account) || '', name: name || (C.master[account] || {}).CUSTOMER || '' });
        return w.then(function () {
            C.toast((name || account) + (was ? ' unpinned' : ' pinned — see the Pinned tab'), 'ok');
            return S.pins.list(pod).then(function (l) { if (pod === C.pod) { P.list = l; S.duck.keepPins(pod, l); } });
        }, function (e) { P.list = before; C.toast('Pin not saved in APEX: ' + C.errText(e), 'bad', 7000); })
            .then(function () { delete P.busy[account]; after(); });
    };
    C.pinButton = function (account, bu, name, big) {
        var on = C.isPinned(account);
        return '<button class="btn ' + (big ? '' : 'sm ghost ') + 'pinbtn' + (on ? ' on' : '') + '" data-act="pinToggle" data-acct="' + esc(account) + '" data-bu="' + esc(bu || '') + '" data-name="' + esc(name || '') + '" title="' + (on ? 'Unpin — take it off your Pinned customers' : 'Pin — keep it on your Pinned customers') + '"><i class="fas fa-thumbtack"></i>' + (big ? (on ? ' Unpin' : ' Pin') : '') + '</button>';
    };
    C.ACT.pinToggle = function (el) { P.toggle(el.dataset.acct, el.dataset.bu, el.dataset.name); };
    C.ACT.pinOpenAll = function () {
        var l = filtered().slice(0, C.CTAB_MAX);
        l.slice().reverse().forEach(function (p) { C.open360(p.BU_ID, p.ACCOUNT_NUMBER, p.ACCOUNT_NAME); });
    };
    C.ACT.pinReload = function () { P.src = ''; P.info = {}; P.load(); };
    C.CH.pinNote = function (el) {
        var a = el.dataset.acct, p = P.list.filter(function (x) { return x.ACCOUNT_NUMBER === a; })[0]; if (!p || p.NOTE === el.value) return;
        p.NOTE = el.value;
        S.pins.set(C.pod, a, { note: el.value.slice(0, 1000) }).then(function () { S.duck.keepPins(C.pod, P.list); C.toast('Note saved', 'ok'); }, function (e) { C.toast(C.errText(e), 'bad'); });
    };
    C.ACT.pinMove = function (el) {
        var i = P.list.findIndex(function (x) { return x.ACCOUNT_NUMBER === el.dataset.acct; }), j = i + (+el.dataset.d);
        if (i < 0 || j < 0 || j >= P.list.length) return;
        var x = P.list.splice(i, 1)[0]; P.list.splice(j, 0, x);
        P.list.forEach(function (p, k) { p.SORT_N = k + 1; });
        C.render();
        Promise.all(P.list.map(function (p) { return S.pins.set(C.pod, p.ACCOUNT_NUMBER, { sort_n: p.SORT_N }); })).then(function () { S.duck.keepPins(C.pod, P.list); }, function (e) { C.toast(C.errText(e), 'bad'); });
    };
    C.IN.pinQ = function (el) { P.q = el.value; C.keepFocus('pin-q', C.render); };
    function filtered() {
        var q = (P.q || '').toLowerCase().trim();
        return !q ? P.list : P.list.filter(function (p) { var i = P.info[p.ACCOUNT_NUMBER] || {}; return (p.ACCOUNT_NUMBER + ' ' + p.ACCOUNT_NAME + ' ' + (i.customer || '') + ' ' + (i.phone || '') + ' ' + (i.email || '') + ' ' + (p.NOTE || '')).toLowerCase().indexOf(q) >= 0; });
    }

    C.views.pinned = function () {
        var l = filtered(), flags = C.custFlags ? C.custFlags() : {};
        var lastBy = {}; (C.calls || []).forEach(function (c) { if (!lastBy[c.ACCOUNT_NUMBER] || c.STARTED_AT > lastBy[c.ACCOUNT_NUMBER]) lastBy[c.ACCOUNT_NUMBER] = c.STARTED_AT; });
        var needs = P.list.filter(function (p) { var x = flags[p.ACCOUNT_NUMBER]; return x && x.flags.length; }).length;
        var head = '<div class="card"><div class="filters"><h2 style="margin:0"><i class="fas fa-thumbtack"></i> My pinned customers</h2><span class="small muted">' + P.list.length + ' pinned' + (needs ? ' · <b class="warnc">' + needs + ' need you</b>' : '') + ' · ' + esc(C.me()) + ' · ' + esc(C.pod) + (P.src ? ' · from ' + esc(P.src) : '') + '</span><span class="sp"></span>' +
            '<input type="search" id="pin-q" data-in="pinQ" placeholder="Filter the pinned…" value="' + esc(P.q || '') + '">' +
            '<button class="btn" data-act="pinOpenAll"' + (l.length ? '' : ' disabled') + ' title="Open the first ' + C.CTAB_MAX + ' as customer tabs"><i class="fas fa-window-restore"></i> Open ' + Math.min(C.CTAB_MAX, l.length || 0) + ' in tabs</button>' +
            '<button class="btn" data-act="pinReload" title="Read your pins again from APEX"><i class="fas fa-rotate"></i></button></div>' +
            (P.err ? '<div class="note bad">APEX: ' + esc(P.err) + '</div>' : '') + '</div>';
        if (!P.list.length) return head + '<div class="card"><div class="empty"><i class="fas fa-thumbtack" style="font-size:28px;opacity:.4"></i><br>No pinned customers yet.<br><span class="small">Pin a customer with <i class="fas fa-thumbtack"></i> in the Customers list or the Pin button in the customer\'s header — your list follows you to every PC.</span></div></div>';
        var cards = l.map(function (p, i) {
            var a = p.ACCOUNT_NUMBER, inf = P.info[a] || {}, m = C.master[a] || {}, name = p.ACCOUNT_NAME || inf.customer || m.CUSTOMER || a;
            var ph = E.phoneList(inf.phone || m.PHONE || '')[0] || '', em = String(inf.email || m.EMAIL || '').split(/[,;]\s*/)[0] || '';
            var x = flags[a];
            return '<div class="pcard' + (x && x.flags.some(function (f) { return f.cls === 'bad'; }) ? ' hot' : '') + '"><div class="row">' + C.avatar(name) + '<div style="flex:1;min-width:0"><b class="nm">' + esc(name) + '</b><div class="small muted">' + esc(a) + (p.BU_ID ? ' · ' + esc((C.bu(p.BU_ID) || {}).name || p.BU_ID) : '') + '</div></div>' +
                '<button class="btn sm ghost" data-act="pinMove" data-acct="' + esc(a) + '" data-d="-1"' + (i ? '' : ' disabled') + ' title="Move up"><i class="fas fa-arrow-up"></i></button><button class="btn sm ghost" data-act="pinMove" data-acct="' + esc(a) + '" data-d="1"' + (i < l.length - 1 ? '' : ' disabled') + ' title="Move down"><i class="fas fa-arrow-down"></i></button></div>' +
                '<div class="small pfacts">' + (ph ? '<span><i class="fas fa-phone"></i>' + esc(ph) + '</span>' : '') + (em ? '<span><i class="fas fa-envelope"></i>' + esc(em) + '</span>' : '') + (inf.bill_to_address ? '<span><i class="fas fa-location-dot"></i>' + esc(inf.bill_to_address) + '</span>' : '') +
                (lastBy[a] ? '<span><i class="fas fa-clock-rotate-left"></i>last call ' + C.when(lastBy[a]) + '</span>' : '') + '<span class="muted"><i class="fas fa-thumbtack"></i>pinned ' + esc(String(p.PINNED_AT || '').slice(0, 10)) + '</span></div>' +
                '<div class="pneeds">' + (C.flagIcons && x && x.flags.length ? C.flagIcons(x, { account: a, bu: p.BU_ID, name: name }) : '') + '</div>' +
                '<input type="text" class="pnote" data-ch="pinNote" data-acct="' + esc(a) + '" maxlength="1000" placeholder="A note for yourself (why it is pinned)…" value="' + esc(p.NOTE || '') + '">' +
                '<div class="row">' + (ph ? '<button class="btn sm ok" data-act="dialNum" data-num="' + esc(ph) + '" data-acct="' + esc(a) + '"><i class="fas fa-phone"></i> Call</button>' : '') +
                '<button class="btn sm" data-act="newTicket" data-acct="' + esc(a) + '"><i class="fas fa-ticket"></i> Ticket</button><span class="sp"></span>' +
                '<button class="btn sm ghost" data-act="pinToggle" data-acct="' + esc(a) + '" data-bu="' + esc(p.BU_ID || '') + '" data-name="' + esc(name) + '" title="Take it off your pinned customers"><i class="fas fa-thumbtack-slash"></i> Unpin</button>' +
                '<button class="btn sm pri" data-act="open360" data-bu="' + esc(p.BU_ID || '') + '" data-acct="' + esc(a) + '" data-name="' + esc(name) + '">Open</button></div></div>';
        }).join('');
        return head + (l.length ? '<div class="pgrid">' + cards + '</div>' : '<div class="card"><div class="empty">No pinned customer matches.</div></div>');
    };
})();
