/* Customer CRM · tickets (support desk): list / board, the ticket drawer (conversation, internal notes, SLA, fields, the customer,
 * similar resolved tickets, the classifier's suggestion), new ticket (from anywhere: a call, Customer 360, the ask bar), status
 * moves with the SLA pause while waiting for the customer, resolve with a resolution, the customer's own page (crm/t/<token>). */
(function () {
    'use strict';
    var C = window.CRM, E = C.E, S = C.S, D = C.D, esc = C.esc;
    function $(id) { return document.getElementById(id); }
    var SCOPES = [['open', 'All open'], ['mine', 'Mine'], ['unassigned', 'Unassigned'], ['breached', 'Past the SLA'], ['waiting', 'Waiting for customer'], ['resolved', 'Resolved (90 days)'], ['all', 'Everything']];

    function scoped() {
        var f = C.tk.f, me = C.me().toLowerCase(), now = new Date(), q = String(f.q || '').toLowerCase();
        return C.tickets.filter(function (t) {
            var open = E.isOpen(t);
            switch (f.scope) {
                case 'open': if (!open) return false; break;
                case 'mine': if (!open || String(t.ASSIGNED_TO || '').toLowerCase() !== me) return false; break;
                case 'unassigned': if (!open || t.ASSIGNED_TO) return false; break;
                case 'breached': if (!open || E.sla(t, now).state !== 'breached') return false; break;
                case 'waiting': if (t.STATUS !== 'PENDING_CUSTOMER') return false; break;
                case 'resolved': if (open) return false; break;
            }
            if (f.queue && t.QUEUE !== f.queue) return false;
            if (f.priority && t.PRIORITY !== f.priority) return false;
            if (q && (t.TICKET_NO + ' ' + t.SUBJECT + ' ' + t.ACCOUNT_NAME + ' ' + t.ACCOUNT_NUMBER + ' ' + t.CONTACT_NAME + ' ' + t.CATEGORY + ' ' + t.ORDER_NUMBER + ' ' + t.ASSIGNED_TO).toLowerCase().indexOf(q) < 0) return false;
            return true;
        });
    }
    C.ticketTable = function (list, rowAct) {
        var now = new Date();
        return C.table([
            [function (t) { var p = E.priority(t.PRIORITY); return C.pill(p.key, p.cls); }, ''],
            [function (t) { return '<b>' + esc(t.TICKET_NO) + '</b>'; }, 'No'],
            [function (t) { return '<b>' + esc(t.SUBJECT) + '</b><div class="small muted">' + esc(t.CATEGORY || '') + (t.SUBCATEGORY ? ' › ' + esc(t.SUBCATEGORY) : '') + '</div>'; }, 'Subject'],
            [function (t) { return esc(t.ACCOUNT_NAME || t.CONTACT_NAME || '') + '<div class="small muted">' + esc(t.ACCOUNT_NUMBER || '') + '</div>'; }, 'Customer'],
            [function (t) { var s = E.status(t.STATUS); return C.pill(esc(s.label), s.cls); }, 'Status'],
            [function (t) { return t.ASSIGNED_TO ? C.avatar(t.ASSIGNED_TO) + ' ' + esc(t.ASSIGNED_TO) : '<span class="warnc">nobody</span>'; }, 'Owner'],
            [function (t) { var s = E.sla(t, now); return C.pill(esc(s.label), s.cls); }, 'SLA'],
            [function (t) { return C.when(t.CREATED_AT); }, 'Opened'],
            [function (t) { return esc(E.CHANNELS[t.CHANNEL] || t.CHANNEL || ''); }, 'Channel']
        ], list.slice().sort(C.bySla), { empty: 'No tickets.', rowAct: rowAct || 'openTicket', rowData: function (t) { return 'data-id="' + esc(t.TICKET_ID) + '"'; } });
    };
    C.views.tickets = function () {
        var f = C.tk.f, list = scoped(), s = C.setup;
        var head = '<div class="card"><div class="filters"><div class="seg">' + SCOPES.map(function (x) { return '<button class="' + (f.scope === x[0] ? 'on' : '') + '" data-act="tkScope" data-scope="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
            '<select data-ch="tkQueue"><option value="">Every queue</option>' + (s.queues || []).map(function (q) { return '<option' + (f.queue === q ? ' selected' : '') + '>' + esc(q) + '</option>'; }).join('') + '</select>' +
            '<select data-ch="tkPrio"><option value="">Every priority</option>' + E.PRIORITIES.map(function (p) { return '<option value="' + p.key + '"' + (f.priority === p.key ? ' selected' : '') + '>' + esc(p.label) + '</option>'; }).join('') + '</select>' +
            '<input type="search" id="tk-q" data-in="tkQ" placeholder="Search number, subject, customer, order…" value="' + esc(f.q || '') + '">' +
            '<span class="sp"></span><div class="seg"><button class="' + (f.view !== 'board' ? 'on' : '') + '" data-act="tkView" data-v="list"><i class="fas fa-list"></i></button><button class="' + (f.view === 'board' ? 'on' : '') + '" data-act="tkView" data-v="board"><i class="fas fa-table-columns"></i></button></div>' +
            '<button class="btn" data-act="tkCsv"><i class="fas fa-download"></i></button><button class="btn pri" data-act="newTicket"><i class="fas fa-plus"></i> New ticket</button></div><div class="small muted">' + list.length + ' tickets</div></div>';
        if (f.view === 'board') {
            var cols = [['NEW', 'New'], ['OPEN', 'Open'], ['WAIT', 'Waiting'], ['DONE', 'Resolved']], now = new Date();
            return head + '<div class="board">' + cols.map(function (c) {
                var l = list.filter(function (t) { return c[0] === 'WAIT' ? /^PENDING/.test(t.STATUS) : c[0] === 'DONE' ? !E.isOpen(t) : t.STATUS === c[0]; }).sort(C.bySla);
                return '<div class="bcol"><h4>' + c[1] + '<span>' + l.length + '</span></h4>' + l.slice(0, 80).map(function (t) {
                    var sla = E.sla(t, now);
                    return '<div class="tcard ' + esc(t.PRIORITY) + '" data-act="openTicket" data-id="' + esc(t.TICKET_ID) + '"><div class="row"><span class="no">' + esc(t.TICKET_NO) + '</span><span class="sp"></span>' + C.pill(esc(sla.label), sla.cls) + '</div><div class="sj">' + esc(t.SUBJECT) + '</div>' +
                        '<div class="row small muted"><span>' + esc(t.ACCOUNT_NAME || t.CONTACT_NAME || '') + '</span><span class="sp"></span>' + (t.ASSIGNED_TO ? C.avatar(t.ASSIGNED_TO) : '<span class="warnc">unassigned</span>') + '</div></div>';
                }).join('') + '</div>';
            }).join('') + '</div>';
        }
        return head + '<div class="card">' + C.ticketTable(list) + '</div>';
    };
    C.CH.tkQueue = function (el) { C.tk.f.queue = el.value; C.lsSet('tk.f', C.tk.f); C.render(); };
    C.CH.tkPrio = function (el) { C.tk.f.priority = el.value; C.lsSet('tk.f', C.tk.f); C.render(); };
    C.IN.tkQ = function (el) { C.tk.f.q = el.value; C.keepFocus('tk-q', C.render); };
    C.ACT.tkView = function (el) { C.tk.f.view = el.dataset.v; C.lsSet('tk.f', C.tk.f); C.render(); };
    C.ACT.tkCsv = function () {
        C.csv('tickets.csv', [['TICKET_NO', 'Ticket'], ['PRIORITY', 'Priority'], ['STATUS', 'Status'], ['SUBJECT', 'Subject'], ['CATEGORY', 'Category'], ['SUBCATEGORY', 'Sub-category'], ['ACCOUNT_NUMBER', 'Account'], ['ACCOUNT_NAME', 'Customer'], ['CONTACT_NAME', 'Contact'],
            ['QUEUE', 'Queue'], ['ASSIGNED_TO', 'Owner'], ['CHANNEL', 'Channel'], ['CREATED_AT', 'Opened'], ['DUE_FIRST', 'First reply due'], ['FIRST_RESPONSE_AT', 'First reply'], ['DUE_RESOLVE', 'Resolve by'], ['RESOLVED_AT', 'Resolved'], [function (t) { return E.sla(t, new Date()).label; }, 'SLA'], ['CSAT', 'Rating']], scoped());
    };

    // ── triage: tickets without SLA dates (raised on the customer page) get their due dates and an owner ──
    C.triage = function () {
        var todo = C.tickets.filter(function (t) { return E.isOpen(t) && !t.DUE_FIRST; }).slice(0, 20);
        todo.reduce(function (p, t) {
            return p.then(function () {
                var due = E.slaDue(t.CREATED_AT, t.PRIORITY, C.setup), r = E.route(t, C.setup, C.load);
                var sets = { due_first: { at: due.first }, due_resolve: { at: due.resolve } };
                if (!t.QUEUE && r.queue) sets.queue = r.queue;
                if (!t.ASSIGNED_TO && r.assignee) { sets.assigned_to = r.assignee; C.load[r.assignee.toLowerCase()] = (C.load[r.assignee.toLowerCase()] || 0) + 1; }
                if (r.priority !== t.PRIORITY) sets.priority = r.priority;
                if (!t.ACCOUNT_NUMBER) { var hit = (t.CONTACT_PHONE && E.phoneLookup(t.CONTACT_PHONE, C.phoneIndex(), C.setup.phone.country)[0]) || (t.CONTACT_EMAIL && C.customerIndex().filter(function (c) { return c.email && c.email.toLowerCase() === String(t.CONTACT_EMAIL).toLowerCase(); })[0]); if (hit) { sets.account_number = hit.account; sets.bu_id = hit.bu || C.buOf(hit.account); if (!t.ACCOUNT_NAME) sets.account_name = hit.name; } }
                return S.tickets.set(t.TICKET_ID, sets).then(function () {
                    t.DUE_FIRST = E.stamp(due.first); t.DUE_RESOLVE = E.stamp(due.resolve); if (sets.queue) t.QUEUE = sets.queue; if (sets.assigned_to) t.ASSIGNED_TO = sets.assigned_to; if (sets.account_number) { t.ACCOUNT_NUMBER = sets.account_number; t.BU_ID = sets.bu_id; }
                    return S.events.add({ ticketId: t.TICKET_ID, kind: 'SLA', body: 'Triage: reply by ' + t.DUE_FIRST + ', resolve by ' + t.DUE_RESOLVE + (sets.assigned_to ? ', assigned to ' + sets.assigned_to : '') + (r.why.length ? ' (' + r.why.join(', ') + ')' : ''), by: 'CRM' });
                }).catch(function (e) { console.warn('[CRM] triage', e); });
            });
        }, Promise.resolve()).then(function () { if (todo.length) { C.badges(); if (C.tab === 'tickets' || C.tab === 'today') C.render(); } });
    };

    // ── new ticket ──
    C.newTicket = function (pre) {
        pre = pre || {};
        var s = C.setup, cust = pre.account ? { account: pre.account, bu: pre.bu || C.buOf(pre.account), name: pre.name || (C.master[pre.account] || {}).CUSTOMER || '' } : C.cust && C.tab === 'c360' ? { account: C.cust.account, bu: C.cust.bu, name: C.cust.name } : null;
        var nt = C.nt = { cust: cust, sug: null };
        C.modal('<i class="fas fa-ticket"></i> New ticket',
            '<div class="form"><div class="field wide"><label>Customer</label><div class="row"><input type="search" id="nt-cust" data-in="ntCust" placeholder="Search a customer (name, account, phone)…" value="' + esc(cust ? (cust.name || '') + ' · ' + cust.account : '') + '" style="flex:1"><span id="nt-custok">' + (cust ? C.pill('✓ ' + esc(cust.account), 'ok') : C.pill('none — a walk-in or a new customer is fine', 'muted')) + '</span></div><div id="nt-hits" class="feed" style="margin-top:6px"></div></div>' +
            '<div class="field"><label>Contact name</label><input type="text" id="nt-cname" value="' + esc(pre.contact || '') + '"></div><div class="field"><label>Contact e-mail</label><input type="email" id="nt-cemail" value="' + esc(pre.email || '') + '"></div><div class="field"><label>Contact phone</label><input type="text" id="nt-cphone" value="' + esc(pre.phone || '') + '"></div>' +
            '<div class="field wide"><label>Subject</label><input type="text" id="nt-subj" data-in="ntText" maxlength="400" value="' + esc(pre.subject || '') + '"></div>' +
            '<div class="field wide"><label>Description</label><textarea id="nt-desc" data-in="ntText" rows="5" maxlength="4000">' + esc(pre.description || '') + '</textarea></div>' +
            '<div class="field wide"><div class="ai" id="nt-ai">Type the subject and description — the CRM suggests a category and priority from earlier tickets.</div></div>' +
            '<div class="field"><label>Category</label><select id="nt-cat" data-ch="ntCat"><option value="">—</option>' + s.categories.map(function (c) { return '<option>' + esc(c.name) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>Sub-category</label><select id="nt-sub"><option value="">—</option></select></div>' +
            '<div class="field"><label>Priority</label><select id="nt-prio">' + E.PRIORITIES.map(function (p) { return '<option value="' + p.key + '"' + (p.key === (pre.priority || 'P3') ? ' selected' : '') + '>' + esc(p.label) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>Channel</label><select id="nt-chan">' + Object.keys(E.CHANNELS).map(function (k) { return '<option value="' + k + '"' + (k === (pre.channel || 'PHONE') ? ' selected' : '') + '>' + esc(E.CHANNELS[k]) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>Owner</label><select id="nt-owner"><option value="">Route automatically</option><option value="' + esc(C.me()) + '">Me (' + esc(C.me()) + ')</option>' + (s.agents || []).map(function (a) { return '<option>' + esc(a.user) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>Sales order</label><input type="text" id="nt-order" value="' + esc(pre.order || '') + '"></div><div class="field"><label>Invoice</label><input type="text" id="nt-inv" value="' + esc(pre.invoice || '') + '"></div><div class="field"><label>Item</label><input type="text" id="nt-item"></div>' +
            '<div class="field wide"><label class="chk"><input type="checkbox" id="nt-ack"' + (pre.email ? ' checked' : '') + '> E-mail the customer an acknowledgement with the ticket number and a link to follow it</label></div></div>',
            '<button class="btn" data-act="mclose">Cancel</button><button class="btn pri" data-act="ntSave"><i class="fas fa-check"></i> Create ticket</button>', true);
        if (pre.category) { $('nt-cat').value = pre.category; C.CH.ntCat($('nt-cat')); }
        if (cust) fillContact(cust.account);
        if (pre.subject || pre.description) C.IN.ntText();
    };
    function fillContact(acct) {
        var m = C.master[acct] || {}, ct = C.contacts.filter(function (k) { return k.ACCOUNT_NUMBER === acct; }).sort(function (a, b) { return (b.IS_PRIMARY === 'Y') - (a.IS_PRIMARY === 'Y'); })[0] || {};
        var card = C.cards[(C.nt.cust || {}).bu + '|' + acct] || {};
        if (!$('nt-cname').value) $('nt-cname').value = ct.NAME || card.CONTACT_NAME || '';
        if (!$('nt-cemail').value) $('nt-cemail').value = ct.EMAIL || (card.STMT_TO || '').split(/[;,]/)[0] || m.EMAIL || '';
        if (!$('nt-cphone').value) $('nt-cphone').value = ct.MOBILE || ct.PHONE || card.PHONE || m.PHONE || '';
    }
    C.IN.ntCust = function (el) {
        var hits = C.searchLocal(el.value, 6);
        $('nt-hits').innerHTML = hits.map(function (h, i) { return '<div class="fi click" data-act="ntPick" data-i="' + i + '"><div class="ic"><i class="fas fa-user"></i></div><div class="tx"><div class="t">' + esc(h.name || h.account) + '</div><div class="s">' + esc(h.account) + ' · ' + esc(h.phone) + '</div></div></div>'; }).join('');
        C.nt.hits = hits;
    };
    C.ACT.ntPick = function (el) {
        var h = C.nt.hits[+el.dataset.i]; C.nt.cust = { account: h.account, bu: h.bu || C.buOf(h.account), name: h.name };
        $('nt-cust').value = (h.name || '') + ' · ' + h.account; $('nt-hits').innerHTML = ''; $('nt-custok').innerHTML = C.pill('✓ ' + esc(h.account), 'ok'); fillContact(h.account);
    };
    C.CH.ntCat = function (el) { var c = E.categoryOf(C.setup, el.value); $('nt-sub').innerHTML = '<option value="">—</option>' + ((c && c.subs) || []).map(function (x) { return '<option>' + esc(x) + '</option>'; }).join(''); };
    var sugT = 0;
    C.IN.ntText = function () {
        clearTimeout(sugT);
        sugT = setTimeout(function () {
            var text = ($('nt-subj') || {}).value + ' ' + ($('nt-desc') || {}).value;
            C.suggest(text).then(function (s) {
                C.nt.sug = s; var box = $('nt-ai'); if (!box) return;
                var sim = E.similar(text, C.learn.filter(function (t) { return t.RESOLUTION; }), 3);
                box.innerHTML = (s ? '<i class="fas fa-wand-magic-sparkles"></i> Suggested (' + esc(s.engine) + '): ' + (s.category ? '<a data-act="ntUse" data-k="cat" data-v="' + esc(s.category) + '">' + esc(s.category) + '</a> ' + Math.round(s.catP * 100) + '%' : '') + (s.priority ? ' · <a data-act="ntUse" data-k="prio" data-v="' + esc(s.priority) + '">' + esc(s.priority) + '</a> ' + Math.round(s.prP * 100) + '%' : '') : 'No suggestion yet — the CRM learns from resolved tickets.') +
                    (sim.length ? '<div style="margin-top:6px"><b>Solved before:</b> ' + sim.map(function (x) { return esc(x.t.TICKET_NO) + ' “' + esc(x.t.SUBJECT) + '” → ' + esc(String(x.t.RESOLUTION).slice(0, 120)); }).join('<br>') + '</div>' : '');
                if (s && s.category && !$('nt-cat').value && s.catP >= 0.6) { $('nt-cat').value = s.category; C.CH.ntCat($('nt-cat')); }
            });
        }, 450);
    };
    C.ACT.ntUse = function (el) { if (el.dataset.k === 'cat') { $('nt-cat').value = el.dataset.v; C.CH.ntCat($('nt-cat')); } else $('nt-prio').value = el.dataset.v; };
    C.ACT.newTicket = function (el) { C.newTicket(el && el.dataset.acct ? { account: el.dataset.acct } : null); };
    C.ACT.ntSave = function () {
        var v = function (id) { return ($(id).value || '').trim(); }, cust = C.nt.cust;
        if (!v('nt-subj')) { C.toast('A subject, please', 'warn'); return; }
        if (!cust && !v('nt-cname') && !v('nt-cemail') && !v('nt-cphone')) { C.toast('Choose a customer or give a contact', 'warn'); return; }
        var t = { POD: C.pod, BU_ID: cust ? cust.bu : null, ACCOUNT_NUMBER: cust ? cust.account : null, ACCOUNT_NAME: cust ? cust.name : v('nt-cname'), CONTACT_NAME: v('nt-cname'), CONTACT_EMAIL: v('nt-cemail'), CONTACT_PHONE: v('nt-cphone'),
            SUBJECT: v('nt-subj'), DESCRIPTION: v('nt-desc'), CATEGORY: v('nt-cat'), SUBCATEGORY: v('nt-sub'), PRIORITY: v('nt-prio'), CHANNEL: v('nt-chan'), ASSIGNED_TO: v('nt-owner'), ORDER_NUMBER: v('nt-order'), INVOICE_NUMBER: v('nt-inv'), ITEM_NUMBER: v('nt-item'),
            TOKEN: E.token(), prefix: C.setup.prefix, AI_CATEGORY: C.nt.sug && C.nt.sug.category, AI_CONF: C.nt.sug && C.nt.sug.catP ? Math.round(C.nt.sug.catP * 100) / 100 : null };
        var r = E.route(t, C.setup, C.load); t.QUEUE = r.queue; t.PRIORITY = r.priority; if (!t.ASSIGNED_TO) t.ASSIGNED_TO = r.assignee;
        var created = S.now(), due = E.slaDue(created, t.PRIORITY, C.setup); t.DUE_FIRST = due.first; t.DUE_RESOLVE = due.resolve;
        var ack = $('nt-ack').checked && t.CONTACT_EMAIL, callId = C.nt.callId, end = C.busy('Creating the ticket…');
        C.mclose();
        S.tickets.create(t).then(function (res) {
            t.TICKET_ID = res.id; t.TICKET_NO = res.no;
            return S.events.add({ ticketId: res.id, kind: 'CREATED', body: 'Created by ' + C.me() + ' (' + (E.CHANNELS[t.CHANNEL] || t.CHANNEL) + ')' + (r.why.length ? ' · routed: ' + r.why.join(', ') : ''), visibility: 'PUBLIC' })
                .then(function () { if (callId) return S.calls.set(callId, { ticket_id: res.id }); })
                .then(function () { return C.loadCore(); })
                .then(function () {
                    end(); C.toast('Ticket ' + res.no + ' created' + (t.ASSIGNED_TO ? ' for ' + t.ASSIGNED_TO : ''), 'ok', 5000);
                    var tk = C.tickets.filter(function (x) { return x.TICKET_ID === res.id; })[0];
                    if (ack && tk) { var body = E.fill((C.setup.canned.filter(function (x) { return x.name === 'Acknowledge'; })[0] || C.setup.canned[0]).body, E.vars({ ticket: tk, agent: C.me() })); return C.mail.ticketMail(tk, body, { first: false }); }
                }).then(function () { C.openTicketById(res.id); C.render(); });
        }).catch(function (e) { end(); C.toast(C.errText(e), 'bad', 9000); });
    };

    // ── the ticket drawer ──
    C.ACT.openTicket = function (el) { C.openTicketById(el.dataset.id); };
    C.openTicketById = function (id) {
        var t = C.tickets.filter(function (x) { return x.TICKET_ID === id; })[0];
        C.openTicket = { id: id, t: t, events: null, msgs: null, tab: 'reply' };
        paintTicket();
        Promise.all([t ? Promise.resolve(t) : S.tickets.get(id), S.events.list([id]), S.messages.list({ ticketId: id }), Promise.resolve(C.calls.filter(function (c) { return c.TICKET_ID === id; }))]).then(function (r) {
            if (!C.openTicket || C.openTicket.id !== id) return;
            C.openTicket.t = r[0]; C.openTicket.events = r[1]; C.openTicket.msgs = r[2]; C.openTicket.calls = r[3];
            if (r[0] && !C.tickets.some(function (x) { return x.TICKET_ID === id; })) C.tickets.push(r[0]);
            paintTicket();
        }, function (e) { C.toast(C.errText(e), 'bad', 7000); });
    };
    function paintTicket() {
        var o = C.openTicket; if (!o) return;
        var t = o.t;
        if (!t) { C.drawer('<div class="dh"><b>Ticket</b><span class="sp"></span><button class="btn ghost" data-act="dclose"><i class="fas fa-xmark"></i></button></div><div class="db"><div class="empty"><span class="spin"></span> Reading…</div></div>'); return; }
        var now = new Date(), st = E.status(t.STATUS), sla = E.sla(t, now), p = E.priority(t.PRIORITY, C.setup.sla), s = C.setup;
        var moves = (E.NEXT[t.STATUS] || []).map(function (k) { var x = E.status(k); return '<button class="btn sm ' + (k === 'RESOLVED' ? 'ok' : '') + '" data-act="tkMove" data-to="' + k + '">' + esc(k === 'OPEN' && !E.isOpen(t) ? 'Reopen' : k === 'RESOLVED' ? 'Resolve…' : x.label) + '</button>'; }).join('');
        var conv = (o.events || []).map(function (e) {
            var cls = e.KIND === 'NOTE' ? 'note' : e.KIND === 'CUSTOMER' ? 'cust' : e.KIND === 'COMMENT' || e.KIND === 'EMAIL_OUT' ? 'me' : 'sys';
            if (cls === 'sys') return '<div class="msg sys">' + esc(e.EVENT_AT) + ' · ' + esc(e.BY_USER) + ' · ' + esc(e.BODY) + '</div>';
            return '<div class="msg ' + cls + '"><div class="w">' + (cls === 'cust' ? '<i class="fas fa-user"></i> Customer' : cls === 'note' ? '<i class="fas fa-lock"></i> Internal note · ' + esc(e.BY_USER) : '<i class="fas fa-reply"></i> ' + esc(e.BY_USER) + (e.KIND === 'EMAIL_OUT' ? ' · e-mailed' : '')) + ' · ' + esc(e.EVENT_AT) + '</div><div class="bd">' + esc(e.BODY) + '</div></div>';
        }).join('');
        var canned = '<select data-ch="tkCanned"><option value="">Canned reply…</option>' + s.canned.map(function (c, i) { return '<option value="' + i + '">' + esc(c.name) + '</option>'; }).join('') + '</select>';
        var sim = E.similar(t.SUBJECT + ' ' + t.DESCRIPTION, C.learn.filter(function (x) { return x.RESOLUTION && x.TICKET_ID !== t.TICKET_ID; }), 4);
        function bar(part, label) {
            if (!part.due) return '';
            var col = part.state === 'breached' || part.state === 'missed' ? 'var(--bad)' : part.state === 'risk' ? 'var(--amber)' : 'var(--ok)';
            return '<div style="margin-bottom:8px"><div class="row small"><b>' + label + '</b><span class="sp"></span><span>' + esc(part.label) + '</span></div><div class="slabar"><div style="width:' + (part.state === 'met' || part.state === 'missed' || part.state === 'breached' ? 100 : Math.max(5, 100 - Math.min(100, (part.left || 0) / 6))) + '%;background:' + col + '"></div></div><div class="small muted">due ' + esc(E.stamp(part.due)) + '</div></div>';
        }
        var opt = function (list, cur, blank) { return (blank ? '<option value="">' + blank + '</option>' : '') + list.map(function (x) { var v = typeof x === 'string' ? x : x[0], l = typeof x === 'string' ? x : x[1]; return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join(''); };
        var cat = E.categoryOf(s, t.CATEGORY);
        var agents = (s.agents || []).map(function (a) { return a.user; }); if (agents.indexOf(C.me()) < 0) agents.unshift(C.me()); if (t.ASSIGNED_TO && agents.indexOf(t.ASSIGNED_TO) < 0) agents.push(t.ASSIGNED_TO);
        var link = S.ticketUrl(t.TOKEN);
        C.drawer('<div class="dh">' + C.pill(p.key, p.cls) + '<b style="font-size:16px">' + esc(t.TICKET_NO) + '</b><span style="font-size:16px;font-weight:700">' + esc(t.SUBJECT) + '</span>' + C.pill(esc(st.label), st.cls) + C.pill(esc(sla.label), sla.cls) + '<span class="sp"></span>' + moves + '<button class="btn ghost" data-act="dclose"><i class="fas fa-xmark"></i></button></div>' +
            '<div class="db"><div class="tgrid"><div>' +
            '<div class="card"><div class="small muted">' + esc(E.CHANNELS[t.CHANNEL] || t.CHANNEL || '') + ' · opened ' + esc(t.CREATED_AT) + ' by ' + esc(t.CREATED_BY || '') + (t.CONTACT_NAME ? ' · ' + esc(t.CONTACT_NAME) : '') + '</div><div style="white-space:pre-wrap;margin-top:6px">' + esc(t.DESCRIPTION || '(no description)') + '</div>' +
            (t.RESOLUTION ? '<div class="note" style="margin-top:10px"><b>Resolution</b><div style="white-space:pre-wrap">' + esc(t.RESOLUTION) + '</div></div>' : '') + (+t.CSAT ? '<div class="note" style="margin-top:8px">Customer rating: <b>' + '★'.repeat(+t.CSAT) + '☆'.repeat(5 - +t.CSAT) + '</b> ' + esc(t.CSAT_COMMENT || '') + '</div>' : '') + '</div>' +
            '<div class="conv">' + (o.events ? conv || '<div class="muted small">No conversation yet.</div>' : '<div class="muted small"><span class="spin"></span> reading…</div>') + '</div>' +
            '<div class="composer"><div class="row"><div class="seg"><button class="' + (o.tab === 'reply' ? 'on' : '') + '" data-act="tkTab" data-t="reply"><i class="fas fa-reply"></i> Reply to the customer</button><button class="' + (o.tab === 'note' ? 'on' : '') + '" data-act="tkTab" data-t="note"><i class="fas fa-lock"></i> Internal note</button></div><span class="sp"></span>' + (o.tab === 'reply' ? canned : '') + '</div>' +
            '<textarea id="tk-text" placeholder="' + (o.tab === 'reply' ? 'Write to ' + esc(t.CONTACT_NAME || 'the customer') + '…' : 'Only your team sees this') + '"></textarea>' +
            '<div class="row">' + (o.tab === 'reply' ? '<label class="chk"><input type="checkbox" id="tk-mail"' + (t.CONTACT_EMAIL ? ' checked' : ' disabled') + '> e-mail it to ' + esc(t.CONTACT_EMAIL || '(no e-mail on the ticket)') + '</label><label class="chk"><input type="checkbox" id="tk-wait"> then wait for the customer</label>' : '') +
            '<span class="sp"></span><button class="btn pri" data-act="tkSend"><i class="fas fa-paper-plane"></i> ' + (o.tab === 'reply' ? 'Send' : 'Add note') + '</button></div></div>' +
            '</div><div class="side">' +
            '<div class="card"><h2><i class="fas fa-stopwatch"></i> SLA</h2>' + bar(sla.first, 'First reply') + bar(sla.resolve, 'Resolution') + (sla.state === 'paused' ? '<div class="small muted">Paused while waiting for the customer since ' + esc(t.PAUSED_AT || '') + '.</div>' : '') + '</div>' +
            '<div class="card"><h2><i class="fas fa-user"></i> Customer</h2>' + (t.ACCOUNT_NUMBER ? '<div class="row">' + C.avatar(t.ACCOUNT_NAME || t.ACCOUNT_NUMBER) + '<div><b>' + esc(t.ACCOUNT_NAME || '') + '</b><div class="small muted">' + esc(t.ACCOUNT_NUMBER) + '</div></div></div>' : '<div class="muted small">No customer account — <a data-act="tkLinkCust">link one</a></div>') +
            '<div class="small" style="margin-top:6px">' + esc(t.CONTACT_NAME || '') + (t.CONTACT_EMAIL ? '<br><i class="fas fa-envelope"></i> ' + esc(t.CONTACT_EMAIL) : '') + (t.CONTACT_PHONE ? '<br><i class="fas fa-phone"></i> <a data-act="dialNum" data-num="' + esc(t.CONTACT_PHONE) + '" data-acct="' + esc(t.ACCOUNT_NUMBER || '') + '" data-ticket="' + esc(t.TICKET_ID) + '">' + esc(t.CONTACT_PHONE) + '</a>' : '') + '</div>' +
            '<div class="qa">' + (t.ACCOUNT_NUMBER ? '<button class="btn sm" data-act="tk360"><i class="fas fa-id-card"></i> 360</button>' : '') + (t.CONTACT_PHONE ? '<button class="btn sm ok" data-act="dialNum" data-num="' + esc(t.CONTACT_PHONE) + '" data-acct="' + esc(t.ACCOUNT_NUMBER || '') + '" data-ticket="' + esc(t.TICKET_ID) + '"><i class="fas fa-phone"></i> Call</button>' : '') + '</div></div>' +
            '<div class="card"><h2><i class="fas fa-sliders"></i> Details</h2><div class="form" style="grid-template-columns:1fr 1fr">' +
            '<div class="field"><label>Priority</label><select id="tf-prio">' + opt(E.PRIORITIES.map(function (x) { return [x.key, x.label]; }), t.PRIORITY) + '</select></div>' +
            '<div class="field"><label>Owner</label><select id="tf-owner">' + opt(agents, t.ASSIGNED_TO, 'nobody') + '</select></div>' +
            '<div class="field"><label>Queue</label><select id="tf-queue">' + opt(s.queues, t.QUEUE, '—') + '</select></div>' +
            '<div class="field"><label>Channel</label><select id="tf-chan">' + opt(Object.keys(E.CHANNELS).map(function (k) { return [k, E.CHANNELS[k]]; }), t.CHANNEL) + '</select></div>' +
            '<div class="field"><label>Category</label><select id="tf-cat" data-ch="tfCat">' + opt(s.categories.map(function (c) { return c.name; }), t.CATEGORY, '—') + '</select></div>' +
            '<div class="field"><label>Sub-category</label><select id="tf-sub">' + opt((cat && cat.subs) || [], t.SUBCATEGORY, '—') + '</select></div>' +
            '<div class="field"><label>Sales order</label><input type="text" id="tf-order" value="' + esc(t.ORDER_NUMBER || '') + '"></div><div class="field"><label>Invoice</label><input type="text" id="tf-inv" value="' + esc(t.INVOICE_NUMBER || '') + '"></div>' +
            '<div class="field"><label>Item</label><input type="text" id="tf-item" value="' + esc(t.ITEM_NUMBER || '') + '"></div><div class="field"><label>Tags</label><input type="text" id="tf-tags" value="' + esc(t.TAGS || '') + '"></div></div>' +
            '<div class="row" style="margin-top:8px">' + (t.ORDER_NUMBER ? '<button class="btn sm" data-act="orderLines" data-no="' + esc(t.ORDER_NUMBER) + '"><i class="fas fa-cart-shopping"></i> Order</button>' : '') + '<span class="sp"></span><button class="btn sm pri" data-act="tkSaveFields">Save details</button></div></div>' +
            (t.AI_CATEGORY ? '<div class="ai" style="margin-bottom:14px"><i class="fas fa-wand-magic-sparkles"></i> Suggested when opened: ' + esc(t.AI_CATEGORY) + (t.AI_CONF ? ' (' + Math.round(t.AI_CONF * 100) + '%)' : '') + '</div>' : '') +
            '<div class="card"><h2><i class="fas fa-lightbulb"></i> Solved before</h2>' + (sim.length ? '<div class="feed">' + sim.map(function (x) { return '<div class="fi"><div class="tx"><div class="t">' + esc(x.t.TICKET_NO) + ' · ' + esc(x.t.SUBJECT) + '</div><div class="b">' + esc(String(x.t.RESOLUTION).slice(0, 300)) + '</div><div class="s"><a data-act="tkUseRes" data-id="' + esc(x.t.TICKET_ID) + '">use this</a> · <a data-act="openTicket" data-id="' + esc(x.t.TICKET_ID) + '">open</a> · match ' + Math.round(x.score * 100) + '%</div></div></div>'; }).join('') + '</div>' : '<div class="muted small">Nothing similar yet.</div>') + '</div>' +
            (link ? '<div class="card"><h2><i class="fas fa-link"></i> The customer\'s page</h2><div class="small muted">The customer follows the ticket, replies and rates it here.</div><div class="row" style="margin-top:6px"><input type="text" readonly value="' + esc(link) + '" style="flex:1;font-size:11px"><button class="btn sm" data-act="copy" data-text="' + esc(link) + '"><i class="fas fa-copy"></i></button></div></div>' : '') +
            ((o.msgs || []).length || (o.calls || []).length ? '<div class="card"><h2>E-mails & calls</h2><div class="feed">' + (o.msgs || []).map(function (m) { return '<div class="fi"><div class="ic"><i class="fas fa-envelope"></i></div><div class="tx"><div class="t">' + esc(m.SUBJECT) + '</div><div class="s">' + esc(m.CREATED_AT) + ' · ' + esc(m.STATUS) + '</div></div></div>'; }).join('') + (o.calls || []).map(function (c) { return '<div class="fi"><div class="ic"><i class="fas fa-phone"></i></div><div class="tx"><div class="t">' + esc(E.CALL_OUTCOMES[c.OUTCOME] || c.OUTCOME || '') + ' · ' + E.secs(c.DURATION_S) + '</div><div class="s">' + esc(c.STARTED_AT) + ' · ' + esc(c.AGENT) + '</div></div></div>'; }).join('') + '</div></div>' : '') +
            '</div></div></div>');
    }
    C.paintTicket = paintTicket;
    C.CH.tfCat = function (el) { var c = E.categoryOf(C.setup, el.value); $('tf-sub').innerHTML = '<option value="">—</option>' + ((c && c.subs) || []).map(function (x) { return '<option>' + esc(x) + '</option>'; }).join(''); };
    C.CH.tkCanned = function (el) {
        var c = C.setup.canned[+el.value]; if (!c) return;
        var t = C.openTicket.t, box = $('tk-text');
        box.value = E.fill(c.body, E.vars({ ticket: t, agent: C.me(), link: S.ticketUrl(t.TOKEN) })); el.value = '';
    };
    C.ACT.tkTab = function (el) { var keep = $('tk-text').value; C.openTicket.tab = el.dataset.t; paintTicket(); $('tk-text').value = keep; };
    C.ACT.tk360 = function () { var t = C.openTicket.t; C.dclose(); C.open360(t.BU_ID, t.ACCOUNT_NUMBER, t.ACCOUNT_NAME, 'tickets'); };
    C.ACT.copy = function (el) { try { navigator.clipboard.writeText(el.dataset.text); C.toast('Copied', 'ok'); } catch (e) { C.toast('Copy failed', 'bad'); } };
    C.ACT.tkUseRes = function (el) { var x = C.learn.filter(function (t) { return t.TICKET_ID === el.dataset.id; })[0]; if (x) { C.openTicket.tab = 'note'; paintTicket(); $('tk-text').value = 'Same as ' + x.TICKET_NO + ': ' + x.RESOLUTION; } };
    C.ACT.tkLinkCust = function () {
        var t = C.openTicket.t, q = window.prompt('Account number of the customer'); if (!q) return;
        var hit = C.searchLocal(q, 1)[0] || { account: q.trim(), bu: C.buOf(q.trim()), name: '' };
        S.tickets.set(t.TICKET_ID, { account_number: hit.account, bu_id: hit.bu || C.buOf(hit.account), account_name: hit.name || t.ACCOUNT_NAME || '' }).then(function () { t.ACCOUNT_NUMBER = hit.account; t.BU_ID = hit.bu; t.ACCOUNT_NAME = hit.name || t.ACCOUNT_NAME; paintTicket(); }, function (e) { C.toast(C.errText(e), 'bad'); });
    };
    C.ACT.tkSaveFields = function () {
        var t = C.openTicket.t, v = function (id) { return ($(id).value || '').trim(); };
        var sets = { priority: v('tf-prio'), assigned_to: v('tf-owner'), queue: v('tf-queue'), channel: v('tf-chan'), category: v('tf-cat'), subcategory: v('tf-sub'), order_number: v('tf-order'), invoice_number: v('tf-inv'), item_number: v('tf-item'), tags: v('tf-tags') };
        var notes = [];
        if (sets.priority !== t.PRIORITY) {
            notes.push('priority ' + t.PRIORITY + ' → ' + sets.priority);
            // a new priority = new due dates from the time it was opened (a reply already given keeps counting)
            var due = E.slaDue(t.CREATED_AT, sets.priority, C.setup); sets.due_first = { at: due.first }; sets.due_resolve = { at: due.resolve };
        }
        if (sets.assigned_to !== (t.ASSIGNED_TO || '')) notes.push('owner ' + (t.ASSIGNED_TO || 'nobody') + ' → ' + (sets.assigned_to || 'nobody'));
        if (sets.queue !== (t.QUEUE || '')) notes.push('queue → ' + sets.queue);
        if (sets.category !== (t.CATEGORY || '')) notes.push('category → ' + sets.category);
        S.tickets.set(t.TICKET_ID, sets).then(function () { return notes.length ? S.events.add({ ticketId: t.TICKET_ID, kind: notes.some(function (n) { return /owner/.test(n); }) ? 'ASSIGN' : 'STATUS', body: notes.join(', ') }) : null; })
            .then(function () { C.toast('Saved', 'ok'); return refreshOpen(); }, function (e) { C.toast(C.errText(e), 'bad', 7000); });
    };
    function refreshOpen() {
        var id = C.openTicket && C.openTicket.id;
        return C.loadCore().then(function () { if (id && C.openTicket && C.openTicket.id === id) C.openTicketById(id); if (C.tab !== 'c360') C.render(); });
    }
    C.refreshOpenTicket = refreshOpen;

    /** status move: pause / resume the SLA, resolved / closed times, reopen count */
    C.moveTicket = function (t, to, extra) {
        var now = S.now(), sets = Object.assign({ status: to }, extra || {});
        if (to === 'PENDING_CUSTOMER' && t.STATUS !== 'PENDING_CUSTOMER') sets.paused_at = 'SYSDATE';
        if (t.STATUS === 'PENDING_CUSTOMER' && to !== 'PENDING_CUSTOMER') {
            sets.paused_at = { sql: 'NULL' };
            if (t.PAUSED_AT && t.DUE_RESOLVE && E.isOpen({ STATUS: to })) sets.due_resolve = { at: E.shiftDue(t.DUE_RESOLVE, t.PAUSED_AT, now, C.setup.hours) };
        }
        if (to === 'RESOLVED') sets.resolved_at = 'SYSDATE';
        if (to === 'CLOSED') { sets.closed_at = 'SYSDATE'; if (!t.RESOLVED_AT) sets.resolved_at = 'SYSDATE'; }
        if (to === 'OPEN' && !E.isOpen(t)) { sets.resolved_at = { sql: 'NULL' }; sets.closed_at = { sql: 'NULL' }; sets.reopened_n = (+t.REOPENED_N || 0) + 1; }
        if (to !== 'NEW' && !t.ASSIGNED_TO) sets.assigned_to = C.me();
        return S.tickets.set(t.TICKET_ID, sets).then(function () { return S.events.add({ ticketId: t.TICKET_ID, kind: 'STATUS', body: E.status(t.STATUS).label + ' → ' + E.status(to).label + (extra && extra.resolution ? ': ' + extra.resolution : ''), visibility: to === 'RESOLVED' ? 'PUBLIC' : 'INTERNAL' }); });
    };
    C.ACT.tkMove = function (el) {
        var t = C.openTicket.t, to = el.dataset.to;
        if (to !== 'RESOLVED') { C.moveTicket(t, to).then(refreshOpen, function (e) { C.toast(C.errText(e), 'bad', 7000); }); return; }
        C.modal('<i class="fas fa-circle-check"></i> Resolve ' + esc(t.TICKET_NO),
            '<div class="field"><label>What was done</label><textarea id="rs-text" rows="5" placeholder="The resolution — kept for the next similar ticket">' + esc(t.RESOLUTION || '') + '</textarea></div>' +
            '<label class="chk" style="margin-top:8px"><input type="checkbox" id="rs-mail"' + (t.CONTACT_EMAIL ? ' checked' : ' disabled') + '> E-mail the customer the resolution with a link to rate it' + (t.CONTACT_EMAIL ? ' (' + esc(t.CONTACT_EMAIL) + ')' : '') + '</label>',
            '<button class="btn" data-act="mclose">Cancel</button><button class="btn ok" data-act="rsGo">Resolve</button>');
        C.ACT.rsGo = function () {
            var res = $('rs-text').value.trim(); if (!res) { C.toast('Write what was done', 'warn'); return; }
            var mail = $('rs-mail').checked; C.mclose();
            C.moveTicket(t, 'RESOLVED', { resolution: res }).then(function () {
                t.RESOLUTION = res;
                if (mail) { var c = C.setup.canned.filter(function (x) { return x.name === 'Resolved'; })[0]; return C.mail.ticketMail(t, E.fill(c ? c.body : 'We have resolved {TICKET_NO}: {RESOLUTION}', E.vars({ ticket: t, agent: C.me() })), { first: true }); }
            }).then(function () { C.learnBoot(); return refreshOpen(); }, function (e) { C.toast(C.errText(e), 'bad', 7000); });
        };
    };
    C.ACT.tkSend = function () {
        var o = C.openTicket, t = o.t, text = ($('tk-text').value || '').trim();
        if (!text) { C.toast('Write something first', 'warn'); return; }
        if (o.tab === 'note') { S.events.add({ ticketId: t.TICKET_ID, kind: 'NOTE', body: text }).then(refreshOpen, function (e) { C.toast(C.errText(e), 'bad'); }); return; }
        var mail = $('tk-mail') && $('tk-mail').checked, wait = $('tk-wait') && $('tk-wait').checked, end = C.busy('Sending…');
        var p = mail ? C.mail.ticketMail(t, text, { first: true }) : S.events.add({ ticketId: t.TICKET_ID, kind: 'COMMENT', body: text, visibility: 'PUBLIC' }).then(function () { return markReplied(t); });
        p.then(function () { if (wait) return C.moveTicket(t, 'PENDING_CUSTOMER'); if (t.STATUS === 'NEW') return C.moveTicket(t, 'OPEN'); })
            .then(function () { end(); C.toast(mail ? 'Sent' : 'Reply saved', 'ok'); return refreshOpen(); }, function (e) { end(); C.toast(C.errText(e), 'bad', 8000); });
    };
    function markReplied(t) { if (t.FIRST_RESPONSE_AT) return Promise.resolve(); return S.tickets.set(t.TICKET_ID, { first_response_at: 'SYSDATE' }).then(function () { t.FIRST_RESPONSE_AT = S.now(); }); }
    C.markReplied = markReplied;
})();
