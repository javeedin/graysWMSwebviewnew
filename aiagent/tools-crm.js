/* AI Agent — Customer Desk tools (page side): the Customer CRM module's own store and engine (../crm/crm-store.js = window.CRMS
   on the Debtors store, ../crm/crm-engine.js = window.CRME) — the same reads the CRM pages make. Read-only: replying to a
   customer, changing a ticket or sending a statement stays with the user in the CRM page.
   crm_open asks the page that embeds the agent (CRM › Autopilot) to open a customer / ticket / tab. */
(function () {
    if (!window.CRMS || !window.CRME || !window.DCS) return;          // the module's scripts are not shipped in this release
    var S = window.CRMS, E = window.CRME, D = window.DCS, DE = window.DCE;
    function addDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return E.iso(d); }
    function r2(v) { return v == null || v === '' || isNaN(+v) ? null : Math.round(+v * 100) / 100; }
    function words(s) { return String(s || '').toLowerCase().split(/\s+/).filter(Boolean); }
    function hit(text, ws) { var t = String(text || '').toLowerCase(); return ws.every(function (w) { return t.indexOf(w) >= 0; }); }
    var _setup = null;
    function setup() { if (_setup) return Promise.resolve(_setup); return S.settings.get('SETUP').catch(function () { return null; }).then(function (s) { _setup = E.setup(s); return _setup; }); }
    function ticketRow(t, now) {
        var s = E.sla(t, now);
        return { Ticket: t.TICKET_NO, Priority: t.PRIORITY, Status: E.status(t.STATUS).label, Subject: t.SUBJECT, Customer: t.ACCOUNT_NAME || t.CONTACT_NAME, Account: t.ACCOUNT_NUMBER, Category: t.CATEGORY, Owner: t.ASSIGNED_TO || null, SLA: s.label, Opened: t.CREATED_AT, Channel: t.CHANNEL };
    }

    AG.tool('crm_tickets', function (inp) {
        var scope = String(inp.scope || 'open').toLowerCase(), now = new Date(), me = D.user().toLowerCase(), ws = words(inp.words);
        return S.tickets.list({ since: addDays(-(+inp.days || 90)), account: inp.account || null }).then(function (list) {
            list = list.filter(function (t) {
                var open = E.isOpen(t);
                if (scope === 'open' && !open) return false;
                if (scope === 'mine' && (!open || String(t.ASSIGNED_TO || '').toLowerCase() !== me)) return false;
                if (scope === 'unassigned' && (!open || t.ASSIGNED_TO)) return false;
                if (scope === 'breached' && (!open || E.sla(t, now).state !== 'breached')) return false;
                if (scope === 'waiting' && t.STATUS !== 'PENDING_CUSTOMER') return false;
                if (scope === 'resolved' && open) return false;
                if (inp.priority && t.PRIORITY !== inp.priority) return false;
                if (inp.category && String(t.CATEGORY || '').toLowerCase() !== String(inp.category).toLowerCase()) return false;
                if (ws.length && !hit(t.TICKET_NO + ' ' + t.SUBJECT + ' ' + t.DESCRIPTION + ' ' + t.ACCOUNT_NAME + ' ' + t.ACCOUNT_NUMBER + ' ' + t.CONTACT_NAME, ws)) return false;
                return true;
            });
            var k = E.ticketKpis(list, now, D.user());
            var out = AG.tableOut('Tickets · ' + scope, list.slice(0, Math.min(+inp.top || 50, 500)).map(function (t) { return ticketRow(t, now); }), 'No ticket matches.');
            if (out.data) out.content = JSON.stringify({ matching: list.length, open: k.open, past_sla: k.breached, at_risk: k.risk, unassigned: k.unassigned, result: out.data });
            return out;
        });
    });

    AG.tool('crm_ticket', function (inp) {
        var no = String(inp.ticket || '').replace(/\D/g, '').replace(/^0+/, '');
        return S.tickets.list({ no: no, limit: 5 }).then(function (r) {
            var t = r.filter(function (x) { return String(x.TICKET_NO).replace(/\D/g, '').replace(/^0+/, '') === no; })[0];
            if (!t) return { ok: true, content: 'No ticket ' + inp.ticket + '.' };
            return Promise.all([S.events.list([t.TICKET_ID]), setup()]).then(function (x) {
                var ev = x[0], st = x[1], sim = [];
                return S.tickets.learning(2000).then(function (l) { sim = E.similar(t.SUBJECT + ' ' + t.DESCRIPTION, l.filter(function (y) { return y.RESOLUTION && y.TICKET_ID !== t.TICKET_ID; }), 3); }, function () { }).then(function () {
                    var s = E.sla(t, new Date(), st);
                    return { ok: true, content: JSON.stringify({
                        ticket: ticketRow(t, new Date()), description: t.DESCRIPTION, contact: { name: t.CONTACT_NAME, email: t.CONTACT_EMAIL, phone: t.CONTACT_PHONE }, queue: t.QUEUE, order: t.ORDER_NUMBER, invoice: t.INVOICE_NUMBER,
                        sla: { state: s.state, label: s.label, first_reply_due: t.DUE_FIRST, first_reply: t.FIRST_RESPONSE_AT, resolve_due: t.DUE_RESOLVE, resolved: t.RESOLVED_AT }, resolution: t.RESOLUTION || null, rating: t.CSAT ? +t.CSAT : null,
                        conversation: ev.filter(function (e) { return ['COMMENT', 'EMAIL_OUT', 'CUSTOMER', 'NOTE', 'CALL'].indexOf(e.KIND) >= 0; }).slice(-15).map(function (e) { return { at: e.EVENT_AT, kind: e.KIND === 'NOTE' ? 'internal note' : e.KIND === 'CUSTOMER' ? 'customer' : e.KIND.toLowerCase(), by: e.BY_USER, text: String(e.BODY || '').slice(0, 600) }; }),
                        solved_before: sim.map(function (y) { return { ticket: y.t.TICKET_NO, subject: y.t.SUBJECT, resolution: String(y.t.RESOLUTION).slice(0, 300), match: y.score }; }),
                        tip: 'crm_open what=ticket shows it to the user; replies and status changes are made by the user in the ticket.'
                    }) };
                });
            });
        });
    });

    AG.tool('crm_customer', function (inp) {
        var acct = String(inp.account || '').trim();
        var find = acct ? Promise.resolve(acct) : D.fusionSql(DE.masterSearchSql(inp.words || ''), 20).then(function (r) { return r[0] ? r[0].ACCOUNT_NUMBER : ''; });
        return find.then(function (a) {
            if (!a) return { ok: true, content: 'No customer found for "' + (inp.words || '') + '".' };
            return Promise.all([
                D.fusionSql(DE.masterSql([a])[2], 5).catch(function () { return []; }),
                S.tickets.list({ account: a, limit: 300 }), S.calls.list({ account: a, limit: 300 }), S.messages.list({ account: a, limit: 300 }),
                D.stmt.search({ account: a, limit: 20 }).catch(function () { return []; }), D.act.list({ account: a, limit: 300 }).catch(function () { return []; }), S.contacts.list(a).catch(function () { return []; })
            ]).then(function (r) {
                var m = r[0][0] || {}, now = new Date(), tl = E.timeline({ tickets: r[1], calls: r[2], messages: r[3], stmts: r[4], acts: r[5] }).slice(0, 12);
                var h = E.health({ tickets: r[1], disputes: r[5].filter(function (x) { return x.KIND === 'DISPUTE' && x.STATUS === 'OPEN'; }).length, brokenPromises: r[5].filter(function (x) { return x.KIND === 'PROMISE' && x.STATUS === 'BROKEN'; }).length, stmt: r[4][0] });
                return { ok: true, content: JSON.stringify({
                    account: a, name: m.CUSTOMER || (r[1][0] || {}).ACCOUNT_NAME || (r[4][0] || {}).ACCOUNT_NAME || '', phone: m.PHONE || null, email: m.EMAIL || null, address: m.BILL_TO_ADDRESS || null,
                    open_tickets: r[1].filter(E.isOpen).map(function (t) { return ticketRow(t, now); }), tickets_total: r[1].length,
                    calls_30_days: r[2].filter(function (c) { return String(c.STARTED_AT) >= addDays(-30); }).length, last_call: r[2][0] ? { at: r[2][0].STARTED_AT, outcome: r[2][0].OUTCOME, notes: r[2][0].NOTES } : null,
                    callbacks: r[2].filter(function (c) { return c.CALLBACK_AT && c.CALLBACK_DONE !== 'Y'; }).map(function (c) { return { at: c.CALLBACK_AT, notes: c.NOTES }; }),
                    last_statement: r[4][0] ? { as_at: r[4][0].STMT_DATE, state: DE.stmtState(r[4][0]).label, balance: r2(r[4][0].BALANCE), sent: r[4][0].SENT_AT, to: r[4][0].EMAIL_TO, answer: r[4][0].RESP_STATUS || null, comment: r[4][0].RESP_COMMENT || null } : null,
                    contacts: r[6].map(function (c) { return { name: c.NAME, role: c.ROLE, email: c.EMAIL, phone: c.MOBILE || c.PHONE }; }),
                    health_without_ar: { score: h.score, band: h.band.label, reasons: h.why.map(function (w) { return w.text; }) },
                    latest: tl.map(function (x) { return { at: x.at, what: x.title }; }),
                    tip: 'dc_open_items reads the balance live from Fusion; crm_open what=customer shows the Customer 360 to the user.'
                }) };
            });
        });
    });

    AG.tool('crm_calls', function (inp) {
        var days = Math.min(+inp.days || 7, 90), out0 = String(inp.outcome || '').toUpperCase();
        return S.calls.list({ since: addDays(-days + 1), account: inp.account || null, callbacks: !!inp.callbacks }).then(function (list) {
            if (out0) list = list.filter(function (c) { return c.OUTCOME === out0; });
            if (inp.direction) list = list.filter(function (c) { return c.DIRECTION === String(inp.direction).toUpperCase(); });
            var talk = list.reduce(function (s, c) { return s + (+c.DURATION_S || 0); }, 0);
            var out = AG.tableOut('Calls · ' + days + ' days', list.slice(0, 300).map(function (c) {
                return { When: c.STARTED_AT, Direction: c.DIRECTION === 'IN' ? 'in' : 'out', Customer: c.ACCOUNT_NAME || null, Number: c.NUMBER_RAW, Outcome: E.CALL_OUTCOMES[c.OUTCOME] || c.OUTCOME, Talk: E.secs(c.DURATION_S), Agent: c.AGENT, Notes: c.NOTES || null, 'Call back': c.CALLBACK_AT && c.CALLBACK_DONE !== 'Y' ? c.CALLBACK_AT : null };
            }), 'No call matches.');
            if (out.data) out.content = JSON.stringify({ calls: list.length, missed: list.filter(function (c) { return c.OUTCOME === 'MISSED'; }).length, talk_time: E.secs(talk), result: out.data });
            return out;
        });
    });

    AG.tool('crm_open', function (inp) {
        var emb = window.AG_EMBED;
        if (!emb || emb.module !== 'crm') return Promise.resolve({ ok: true, content: 'The user is not in the CRM page - tell them: open Customer CRM (Home) ' + (inp.what === 'customer' ? '› search ' + inp.account : inp.what === 'ticket' ? '› Tickets › ' + inp.ticket : '') + '.' });
        emb.toParent({ __agModule: 1, op: 'open', what: inp.what, account: inp.account || null, ticket_no: inp.ticket || null, tab: inp.tab || null, sub: inp.section || null });
        return Promise.resolve({ ok: true, content: 'Opened ' + (inp.what === 'customer' ? 'customer ' + inp.account : inp.what === 'ticket' ? 'ticket ' + inp.ticket : 'the ' + inp.tab + ' tab') + ' in the CRM for the user.' });
    });
    Object.assign(AG.LABELS, { crm_tickets: 'Tickets', crm_ticket: 'Ticket', crm_customer: 'Customer 360', crm_calls: 'Calls', crm_open: 'Open in the CRM' });
    Object.assign(AG.ICONS, { crm_tickets: 'fa-ticket', crm_ticket: 'fa-ticket', crm_customer: 'fa-id-card', crm_calls: 'fa-phone', crm_open: 'fa-up-right-from-square' });
})();
