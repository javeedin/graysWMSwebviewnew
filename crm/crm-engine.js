/* Customer CRM · pure engine (window.CRME; also a node module for the tests in crm/tests/crm-engine.test.js).
 * Nothing here talks to the host, APEX or Fusion — the page (crm-core.js) and the store (crm-store.js) do.
 *   tickets      statuses, priorities, transitions, SLA on business hours (first response + resolution, paused while the
 *                ticket waits for the customer), routing rules, the ticket number, canned replies with {VARIABLES}
 *   customers    phone numbers (Mauritius +230 by default), the health score, the 360 timeline, KPIs
 *   learning     a small naive-Bayes classifier (category / priority from the text — the fallback when the host's ML.NET
 *                model is not trained), similar resolved tickets (TF-IDF cosine), the rule-based ask parser
 *   Fusion SQL   the read-only queries of Customer 360 (orders, invoices, receipts, items bought, stock, contacts, phone
 *                lookup) — every value that goes into SQL is quoted or digits only. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.CRME = api;
})(typeof window !== 'undefined' ? window : this, function () {
    'use strict';
    var E = {};

    // ── small helpers ─────────────────────────────────────────────
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    E.iso = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    E.stamp = function (d) { return E.iso(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
    /** 'YYYY-MM-DD[ HH:MI[:SS]]' or a Date → Date (local time) */
    E.parse = function (s) {
        if (s instanceof Date) return new Date(s.getTime());
        var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s || ''));
        return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : null;
    };
    E.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    E.money = function (n, dec) {
        if (n == null || n === '' || isNaN(+n)) return '';
        var d = dec == null ? 2 : dec, v = +n, s = Math.abs(v).toFixed(d).split('.');
        s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (v < 0 ? '-' : '') + s.join('.');
    };
    E.uid = function (prefix) {
        var r = '';
        for (var i = 0; i < 16; i++) r += Math.floor(Math.random() * 16).toString(16);
        return (prefix || '') + Date.now().toString(36) + r;
    };
    E.token = function () { return E.uid('').slice(0, 32); };
    E.initials = function (name) {
        var w = String(name || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
        return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : (w[0] || '')[1] || '')).toUpperCase();
    };
    /** {NAME} placeholders → values (html mode escapes) */
    E.fill = function (tpl, vars, mode) {
        return String(tpl == null ? '' : tpl).replace(/\{([A-Z][A-Z0-9_]*)\}/g, function (m, k) {
            if (!vars || vars[k] == null) return m;
            var v = String(vars[k]);
            return mode === 'html' ? E.esc(v) : mode === 'sql' ? v.replace(/'/g, "''") : v;
        });
    };
    E.emails = function (text) {
        var out = [], seen = {};
        String(text || '').split(/[;,\s]+/).forEach(function (x) {
            x = x.trim().replace(/^<|>$/g, '');
            if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x) && !seen[x.toLowerCase()]) { seen[x.toLowerCase()] = 1; out.push(x); }
        });
        return out;
    };

    // ── tickets ───────────────────────────────────────────────────
    E.STATUSES = [
        { key: 'NEW', label: 'New', cls: 'info', open: true },
        { key: 'OPEN', label: 'Open', cls: 'vio', open: true },
        { key: 'PENDING_CUSTOMER', label: 'Waiting for customer', cls: 'warn', open: true, paused: true },
        { key: 'PENDING_INTERNAL', label: 'Waiting on us', cls: 'warn', open: true },
        { key: 'RESOLVED', label: 'Resolved', cls: 'ok', open: false },
        { key: 'CLOSED', label: 'Closed', cls: 'muted', open: false }
    ];
    E.status = function (k) { return E.STATUSES.filter(function (s) { return s.key === k; })[0] || { key: k, label: k || '—', cls: 'muted', open: true }; };
    E.isOpen = function (t) { return E.status(t && t.STATUS).open; };
    /** what may follow what (a resolved ticket reopens when the customer writes again) */
    E.NEXT = {
        NEW: ['OPEN', 'PENDING_CUSTOMER', 'PENDING_INTERNAL', 'RESOLVED', 'CLOSED'],
        OPEN: ['PENDING_CUSTOMER', 'PENDING_INTERNAL', 'RESOLVED', 'CLOSED'],
        PENDING_CUSTOMER: ['OPEN', 'PENDING_INTERNAL', 'RESOLVED', 'CLOSED'],
        PENDING_INTERNAL: ['OPEN', 'PENDING_CUSTOMER', 'RESOLVED', 'CLOSED'],
        RESOLVED: ['OPEN', 'CLOSED'],
        CLOSED: ['OPEN']
    };
    E.canMove = function (from, to) { return (E.NEXT[from || 'NEW'] || []).indexOf(to) >= 0; };

    E.PRIORITIES = [
        { key: 'P1', label: 'P1 · Urgent', cls: 'bad', first: 1, resolve: 8 },
        { key: 'P2', label: 'P2 · High', cls: 'warn', first: 4, resolve: 24 },
        { key: 'P3', label: 'P3 · Normal', cls: 'info', first: 8, resolve: 72 },
        { key: 'P4', label: 'P4 · Low', cls: 'muted', first: 24, resolve: 160 }
    ];
    E.priority = function (k, policy) {
        var p = E.PRIORITIES.filter(function (x) { return x.key === k; })[0] || E.PRIORITIES[2];
        var o = policy && policy[p.key];
        return o ? Object.assign({}, p, { first: +o.first || p.first, resolve: +o.resolve || p.resolve }) : p;
    };
    E.CHANNELS = { PHONE: 'Phone', EMAIL: 'E-mail', PORTAL: 'Customer portal', WALKIN: 'Walk-in', VISIT: 'Visit', CHAT: 'Chat', WHATSAPP: 'WhatsApp', INTERNAL: 'Internal' };

    /** The default setup (Setup › CRM saves its own copy in WMS_CRM_SETTINGS 'SETUP') */
    E.DEFAULTS = {
        categories: [
            { name: 'Delivery', subs: ['Late delivery', 'Short delivery', 'Wrong item', 'Damaged goods', 'Delivery address'], queue: 'Logistics' },
            { name: 'Billing', subs: ['Invoice query', 'Price difference', 'Credit note', 'Statement query', 'Payment not applied'], queue: 'Accounts' },
            { name: 'Order', subs: ['New order', 'Change order', 'Cancel order', 'Order status', 'Backorder'], queue: 'Sales' },
            { name: 'Product', subs: ['Quality', 'Expiry date', 'Stock availability', 'Product information'], queue: 'Sales' },
            { name: 'Returns', subs: ['Return request', 'Empties / crates', 'Collection'], queue: 'Logistics' },
            { name: 'Account', subs: ['New customer', 'Contact details', 'Credit limit', 'Credit hold'], queue: 'Accounts' },
            { name: 'Complaint', subs: ['Service', 'Driver / salesperson', 'Other'], queue: 'Customer care' },
            { name: 'Other', subs: [], queue: 'Customer care' }
        ],
        queues: ['Customer care', 'Sales', 'Logistics', 'Accounts'],
        agents: [],
        sla: { P1: { first: 1, resolve: 8 }, P2: { first: 4, resolve: 24 }, P3: { first: 8, resolve: 72 }, P4: { first: 24, resolve: 160 } },
        hours: { days: [1, 2, 3, 4, 5, 6], start: '08:00', end: '17:00', saturdayEnd: '12:00', holidays: [] },
        rules: [
            { when: { words: 'urgent, asap, emergency, no stock, stopped' }, set: { priority: 'P2' } },
            { when: { category: 'Billing' }, set: { queue: 'Accounts' } }
        ],
        canned: [
            { name: 'Acknowledge', body: 'Dear {CONTACT},\n\nThank you for contacting us. Your request has been logged as {TICKET_NO} and {AGENT} is looking into it. We will update you shortly.\n\nKind regards,\n{AGENT}' },
            { name: 'Need more information', body: 'Dear {CONTACT},\n\nTo help us with {TICKET_NO}, could you please send us the invoice or order number and a short description of what went wrong?\n\nKind regards,\n{AGENT}' },
            { name: 'Resolved', body: 'Dear {CONTACT},\n\nWe have resolved {TICKET_NO}: {RESOLUTION}\n\nIf anything is still not right, simply reply to this e-mail and the ticket opens again.\n\nKind regards,\n{AGENT}' },
            { name: 'Statement attached', body: 'Dear {CONTACT},\n\nPlease find attached your statement of account. Let us know if anything does not agree with your records.\n\nKind regards,\n{AGENT}' }
        ],
        phone: { country: '230', adapter: 'manual', ctiPort: 8765, record: false, consent: 'This call may be recorded for quality and training.', wrapUpSecs: 30 },
        signature: '',
        prefix: 'CS-'
    };
    E.setup = function (saved) {
        var d = JSON.parse(JSON.stringify(E.DEFAULTS));
        if (!saved) return d;
        Object.keys(saved).forEach(function (k) {
            if (saved[k] == null) return;
            if (k === 'phone' || k === 'hours' || k === 'sla') d[k] = Object.assign(d[k], saved[k]);
            else d[k] = saved[k];
        });
        return d;
    };
    E.categoryOf = function (setup, name) { return (setup.categories || []).filter(function (c) { return c.name === name; })[0] || null; };
    E.ticketNo = function (prefix, n) { var s = String(n || 0); while (s.length < 6) s = '0' + s; return (prefix || 'CS-') + s; };

    // ── business hours ────────────────────────────────────────────
    function hm(s, d) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : d; }
    /** the working window of one day in minutes since midnight, or null (closed) */
    E.dayWindow = function (d, hours) {
        var h = hours || E.DEFAULTS.hours, dow = d.getDay(), iso = E.iso(d);
        if ((h.holidays || []).indexOf(iso) >= 0) return null;
        if ((h.days || []).indexOf(dow) < 0) return null;
        var start = hm(h.start, 480), end = hm(dow === 6 && h.saturdayEnd ? h.saturdayEnd : h.end, 1020);
        return end > start ? { start: start, end: end } : null;
    };
    /** a moment + n working minutes → the moment it is due */
    E.addWorkMinutes = function (from, minutes, hours) {
        var t = E.parse(from); if (!t) return null;
        var left = Math.max(0, Math.round(minutes));
        for (var guard = 0; guard < 800; guard++) {
            var w = E.dayWindow(t, hours), mins = t.getHours() * 60 + t.getMinutes();
            if (w && mins < w.end) {
                var startAt = Math.max(mins, w.start), room = w.end - startAt;
                if (left <= room) { var r = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, startAt + left); return r; }
                left -= room;
            }
            t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, 0, 0);
        }
        return t;
    };
    /** working minutes between two moments (0 when b is before a) */
    E.workMinutes = function (a, b, hours) {
        var x = E.parse(a), y = E.parse(b); if (!x || !y || y <= x) return 0;
        var total = 0, t = new Date(x.getTime());
        for (var guard = 0; guard < 800 && t < y; guard++) {
            var w = E.dayWindow(t, hours);
            var dayEnd = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, 0, 0);
            if (w) {
                var s = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, w.start), e = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 0, w.end);
                var from = t > s ? t : s, to = y < e ? y : e;
                if (to > from) total += Math.round((to - from) / 60000);
            }
            t = dayEnd;
        }
        return total;
    };
    /** due dates of a new ticket */
    E.slaDue = function (created, priority, setup) {
        var s = setup || E.DEFAULTS, p = E.priority(priority, s.sla);
        return { first: E.addWorkMinutes(created, p.first * 60, s.hours), resolve: E.addWorkMinutes(created, p.resolve * 60, s.hours) };
    };
    /** after a pause (waiting for the customer) the resolution due date moves by the working minutes paused */
    E.shiftDue = function (due, pausedAt, now, hours) {
        var mins = E.workMinutes(pausedAt, now, hours);
        return mins ? E.addWorkMinutes(due, mins, hours) : E.parse(due);
    };
    function part(due, done, now, hours) {
        if (!due) return { state: 'none', label: '' };
        var d = E.parse(due), n = E.parse(now) || new Date();
        if (done) { var dn = E.parse(done); return dn <= d ? { state: 'met', label: 'met', due: d } : { state: 'missed', label: 'missed by ' + E.dur(E.workMinutes(d, dn, hours)), due: d }; }
        if (n > d) return { state: 'breached', label: 'overdue ' + E.dur(E.workMinutes(d, n, hours)), due: d };
        var left = E.workMinutes(n, d, hours);
        return { state: left <= 60 ? 'risk' : 'ok', label: E.dur(left) + ' left', due: d, left: left };
    };
    /** a ticket's SLA now: {first, resolve, state ok | risk | breached | paused | met | missed, label, cls} */
    E.sla = function (t, now, setup) {
        var hours = (setup || E.DEFAULTS).hours;
        var first = part(t.DUE_FIRST, t.FIRST_RESPONSE_AT, now, hours), res = part(t.DUE_RESOLVE, t.RESOLVED_AT, now, hours);
        var paused = E.status(t.STATUS).paused && !t.RESOLVED_AT;
        var worst = [first, res].map(function (x) { return x.state; });
        var state = worst.indexOf('breached') >= 0 ? 'breached' : paused ? 'paused' : worst.indexOf('risk') >= 0 ? 'risk' : !E.isOpen(t) ? (worst.indexOf('missed') >= 0 ? 'missed' : 'met') : 'ok';
        var cls = { breached: 'bad', risk: 'warn', paused: 'muted', missed: 'bad', met: 'ok', ok: 'ok' }[state];
        var label = state === 'paused' ? 'paused · waiting for customer' : state === 'breached' ? (first.state === 'breached' ? 'first reply ' + first.label : 'resolution ' + res.label)
            : state === 'risk' ? (first.state === 'risk' ? 'reply within ' + first.label.replace(' left', '') : 'resolve within ' + res.label.replace(' left', ''))
            : E.isOpen(t) ? (t.FIRST_RESPONSE_AT ? 'resolve: ' + res.label : 'reply: ' + first.label) : state === 'met' ? 'SLA met' : 'SLA missed';
        return { first: first, resolve: res, state: state, cls: cls, label: label };
    };
    E.dur = function (mins) {
        mins = Math.max(0, Math.round(mins || 0));
        if (mins < 60) return mins + ' min';
        var h = Math.floor(mins / 60), m = mins % 60;
        if (h < 24) return h + ' h' + (m ? ' ' + m + ' min' : '');
        var d = Math.floor(h / 24); return d + ' d ' + (h % 24) + ' h';
    };
    E.ago = function (s, now) {
        var d = E.parse(s), n = E.parse(now) || new Date(); if (!d) return '';
        var m = Math.round((n - d) / 60000);
        if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
        var h = Math.round(m / 60); if (h < 24) return h + ' h ago';
        var dd = Math.round(h / 24); if (dd < 45) return dd + ' d ago';
        return Math.round(dd / 30) + ' mo ago';
    };

    // ── routing ───────────────────────────────────────────────────
    function words(s) { return String(s || '').toLowerCase().split(/[,;]+/).map(function (x) { return x.trim(); }).filter(Boolean); }
    /** rules in order: when {category, sub, channel, words, account, priority} → set {queue, priority, assignee, category};
     *  then the category's queue; then the least busy agent of the queue (open tickets per agent) */
    E.route = function (t, setup, load) {
        var s = setup || E.DEFAULTS, out = { queue: t.QUEUE || '', priority: t.PRIORITY || 'P3', assignee: t.ASSIGNED_TO || '', category: t.CATEGORY || '', why: [] };
        var text = (String(t.SUBJECT || '') + ' ' + String(t.DESCRIPTION || '')).toLowerCase();
        (s.rules || []).forEach(function (r, i) {
            var w = r.when || {}, ok = true;
            if (w.category && w.category !== out.category) ok = false;
            if (w.sub && w.sub !== t.SUBCATEGORY) ok = false;
            if (w.channel && w.channel !== t.CHANNEL) ok = false;
            if (w.account && String(w.account) !== String(t.ACCOUNT_NUMBER || '')) ok = false;
            if (w.priority && w.priority !== out.priority) ok = false;
            if (w.words) { var ws = words(w.words); if (!ws.some(function (x) { return text.indexOf(x) >= 0; })) ok = false; }
            if (!ok) return;
            var set = r.set || {};
            if (set.queue) out.queue = set.queue;
            if (set.category && !out.category) out.category = set.category;
            if (set.priority && E.priority(set.priority).key < E.priority(out.priority).key) out.priority = set.priority;
            if (set.assignee) out.assignee = set.assignee;
            out.why.push('rule ' + (i + 1));
        });
        if (!out.queue) { var c = E.categoryOf(s, out.category); out.queue = (c && c.queue) || (s.queues || [])[0] || ''; if (c && c.queue) out.why.push('category queue'); }
        if (!out.assignee) {
            var agents = (s.agents || []).filter(function (a) { return a.active !== false && (!a.queues || !a.queues.length || a.queues.indexOf(out.queue) >= 0); });
            if (agents.length) {
                agents.sort(function (a, b) { return ((load || {})[a.user] || 0) - ((load || {})[b.user] || 0) || String(a.user).localeCompare(String(b.user)); });
                out.assignee = agents[0].user; out.why.push('least busy in ' + out.queue);
            }
        }
        return out;
    };

    // ── phone numbers ─────────────────────────────────────────────
    /** raw → {digits, e164, local, last7, display}; country default 230 (Mauritius: 7-digit fixed, 8-digit mobile 5xxxxxxx) */
    E.phone = function (raw, country) {
        var cc = String(country || '230').replace(/\D/g, '') || '230';
        var s = String(raw || '').trim(), d = s.replace(/\D/g, '');
        if (!d) return { digits: '', e164: '', local: '', last7: '', display: s };
        var local = d;
        if (/^00/.test(d)) d = d.slice(2);
        else if (s.charAt(0) === '+') { /* already international */ }
        else if (d.length <= 8) d = cc + d;
        else if (d.indexOf(cc) !== 0 && d.charAt(0) === '0') d = cc + d.replace(/^0+/, '');
        if (d.indexOf(cc) === 0) local = d.slice(cc.length);
        var disp = d.indexOf(cc) === 0 ? '+' + cc + ' ' + (local.length === 8 ? local.slice(0, 4) + ' ' + local.slice(4) : local.length === 7 ? local.slice(0, 3) + ' ' + local.slice(3) : local) : '+' + d;
        return { digits: d, e164: '+' + d, local: local, last7: d.slice(-7), display: disp };
    };
    E.samePhone = function (a, b, country) {
        var x = E.phone(a, country), y = E.phone(b, country);
        return !!x.last7 && x.last7.length >= 7 && x.last7 === y.last7;
    };
    /** a phone → the customers whose numbers match (index = [{phone, bu, account, name, contact, source}]) */
    E.phoneLookup = function (raw, index, country) {
        var p = E.phone(raw, country); if (!p.last7 || p.last7.length < 7) return [];
        var seen = {}, out = [];
        (index || []).forEach(function (x) {
            String(x.phone || '').split(/[;,/]| or /).forEach(function (one) {
                if (!E.samePhone(one, raw, country)) return;
                var k = (x.bu || '') + '|' + x.account + '|' + (x.contact || '');
                if (seen[k]) return; seen[k] = 1; out.push(x);
            });
        });
        return out;
    };
    E.CALL_OUTCOMES = { ANSWERED: 'Answered', NO_ANSWER: 'No answer', BUSY: 'Busy', VOICEMAIL: 'Voicemail', MISSED: 'Missed', WRONG_NUMBER: 'Wrong number', FAILED: 'Could not connect' };

    // ── customer health ───────────────────────────────────────────
    /** 0–100 (higher = healthier) with the reasons. ctx = {ar: {total, overdue, aging}, sales: {m12, prev12}, tickets: [rows],
     *  lastContact, disputes, brokenPromises, creditHold, stmt: latest statement row, now} */
    E.health = function (ctx) {
        ctx = ctx || {};
        var score = 100, why = [], now = E.parse(ctx.now) || new Date();
        function hit(n, text, cls) { if (n <= 0) return; score -= n; why.push({ text: text, cls: cls || 'warn', pts: -Math.round(n) }); }
        var ar = ctx.ar;
        if (ar && ar.total > 0) {
            var od = Math.max(0, ar.overdue || 0) / ar.total, d90 = ar.aging ? Math.max(0, ar.aging.d90p || 0) / ar.total : 0;
            hit(Math.min(25, od * 30), Math.round(od * 100) + '% of the balance is overdue', od > 0.5 ? 'bad' : 'warn');
            hit(Math.min(15, d90 * 40), Math.round(d90 * 100) + '% older than 90 days', 'bad');
        }
        var open = (ctx.tickets || []).filter(E.isOpen), urgent = open.filter(function (t) { return t.PRIORITY === 'P1' || t.PRIORITY === 'P2'; });
        var breached = open.filter(function (t) { return E.sla(t, now).state === 'breached'; });
        hit(Math.min(12, open.length * 3), open.length + ' open ticket' + (open.length === 1 ? '' : 's'));
        hit(Math.min(12, urgent.length * 6), urgent.length + ' urgent / high ticket' + (urgent.length === 1 ? '' : 's'), 'bad');
        hit(Math.min(10, breached.length * 5), breached.length + ' past the SLA', 'bad');
        var reopened = (ctx.tickets || []).filter(function (t) { return +t.REOPENED_N > 0; }).length;
        hit(Math.min(6, reopened * 3), reopened + ' reopened');
        if (ctx.disputes) hit(Math.min(10, ctx.disputes * 5), ctx.disputes + ' open dispute' + (ctx.disputes === 1 ? '' : 's'), 'bad');
        if (ctx.brokenPromises) hit(Math.min(10, ctx.brokenPromises * 5), ctx.brokenPromises + ' broken promise' + (ctx.brokenPromises === 1 ? '' : 's') + ' to pay', 'bad');
        if (ctx.creditHold) hit(8, 'on credit hold', 'bad');
        var s = ctx.sales;
        if (s && s.prev12 > 0) {
            var ch = (s.m12 - s.prev12) / s.prev12;
            if (ch < -0.1) hit(Math.min(15, -ch * 30), 'sales down ' + Math.round(-ch * 100) + '% on the year before', ch < -0.4 ? 'bad' : 'warn');
            else if (ch > 0.1) { score += Math.min(5, ch * 10); why.push({ text: 'sales up ' + Math.round(ch * 100) + '%', cls: 'ok', pts: Math.round(Math.min(5, ch * 10)) }); }
        }
        var lc = E.parse(ctx.lastContact);
        if (lc) { var days = Math.round((now - lc) / 86400000); if (days > 60) hit(Math.min(8, (days - 60) / 10), 'no contact for ' + days + ' days'); }
        else if (ctx.lastContact !== undefined) hit(4, 'never contacted');
        if (ctx.stmt && ctx.stmt.BOUNCED_AT) hit(5, 'the last statement bounced', 'bad');
        if (ctx.csat && ctx.csat.n) { var avg = ctx.csat.sum / ctx.csat.n; if (avg < 3) hit((3 - avg) * 5, 'satisfaction ' + avg.toFixed(1) + ' / 5', 'bad'); else if (avg >= 4.5) why.push({ text: 'satisfaction ' + avg.toFixed(1) + ' / 5', cls: 'ok', pts: 0 }); }
        score = Math.max(0, Math.min(100, Math.round(score)));
        return { score: score, band: score >= 75 ? { key: 'good', label: 'Healthy', cls: 'ok' } : score >= 50 ? { key: 'watch', label: 'Watch', cls: 'warn' } : { key: 'risk', label: 'At risk', cls: 'bad' }, why: why };
    };

    // ── the 360 timeline ──────────────────────────────────────────
    /** every source → one list newest first: {at, kind, icon, title, body, by, ref, refKind, cls} */
    E.timeline = function (src) {
        src = src || {}; var out = [];
        (src.tickets || []).forEach(function (t) { out.push({ at: t.CREATED_AT, kind: 'TICKET', icon: 'fa-ticket', title: (t.TICKET_NO || 'Ticket') + ' · ' + (t.SUBJECT || ''), body: t.DESCRIPTION, by: t.CREATED_BY, ref: t.TICKET_ID, refKind: 'ticket', cls: E.isOpen(t) ? 'info' : 'ok', tag: E.status(t.STATUS).label }); });
        (src.events || []).forEach(function (e) { if (e.KIND === 'STATUS' || e.KIND === 'ASSIGN') return; out.push({ at: e.EVENT_AT, kind: e.KIND === 'NOTE' ? 'NOTE' : e.KIND === 'CUSTOMER' ? 'CUSTOMER' : 'REPLY', icon: e.KIND === 'NOTE' ? 'fa-note-sticky' : e.KIND === 'CUSTOMER' ? 'fa-user' : 'fa-reply', title: (e.KIND === 'CUSTOMER' ? 'Customer wrote on ' : e.KIND === 'NOTE' ? 'Internal note on ' : 'Reply on ') + (e.TICKET_NO || 'ticket'), body: e.BODY, by: e.BY_USER, ref: e.TICKET_ID, refKind: 'ticket' }); });
        (src.calls || []).forEach(function (c) { out.push({ at: c.STARTED_AT, kind: 'CALL', icon: c.DIRECTION === 'IN' ? 'fa-phone-volume' : 'fa-phone', title: (c.DIRECTION === 'IN' ? 'Call from ' : 'Call to ') + (c.CONTACT_NAME || c.NUMBER_RAW || '') + ' · ' + (E.CALL_OUTCOMES[c.OUTCOME] || c.OUTCOME || '') + (c.DURATION_S ? ' · ' + E.secs(c.DURATION_S) : ''), body: c.NOTES, by: c.AGENT, ref: c.CALL_ID, refKind: 'call', cls: c.OUTCOME === 'MISSED' ? 'bad' : '' }); });
        (src.messages || []).forEach(function (m) { out.push({ at: m.SENT_AT || m.CREATED_AT, kind: 'EMAIL', icon: 'fa-envelope', title: 'E-mail · ' + (m.SUBJECT || ''), body: (m.TO_ADDR ? 'To ' + m.TO_ADDR + '. ' : '') + (m.ATTACHMENTS ? 'Attached: ' + m.ATTACHMENTS : ''), by: m.BY_USER, ref: m.MSG_ID, refKind: 'msg', cls: m.STATUS === 'FAILED' ? 'bad' : '' }); });
        (src.stmts || []).forEach(function (s) { out.push({ at: s.SENT_AT || s.CREATED_AT, kind: 'STATEMENT', icon: 'fa-file-invoice', title: 'Statement as at ' + s.STMT_DATE + ' · ' + (s.STATUS || '') + (s.RESP_STATUS ? ' · customer ' + s.RESP_STATUS.toLowerCase() : ''), body: s.RESP_COMMENT || (s.EMAIL_TO ? 'To ' + s.EMAIL_TO : ''), by: s.APP_USER, ref: s.STMT_ID, refKind: 'stmt', cls: s.BOUNCED_AT || s.STATUS === 'FAILED' ? 'bad' : s.RESP_STATUS === 'DISPUTED' ? 'warn' : '' }); });
        (src.acts || []).forEach(function (a) { out.push({ at: a.CREATED_AT, kind: a.KIND, icon: { CALL: 'fa-phone', NOTE: 'fa-note-sticky', EMAIL: 'fa-envelope', VISIT: 'fa-car', PROMISE: 'fa-handshake', DISPUTE: 'fa-triangle-exclamation', CONFIRM: 'fa-circle-check', TASK: 'fa-list-check', HOLD: 'fa-lock' }[a.KIND] || 'fa-circle', title: (a.SUBJECT || a.KIND) + (a.SOURCE === 'CUSTOMER' ? ' (customer)' : ''), body: a.BODY, by: a.CREATED_BY, ref: a.ACT_ID, refKind: 'act', cls: a.KIND === 'DISPUTE' ? 'warn' : '' }); });
        (src.orders || []).forEach(function (o) { out.push({ at: o.ORDERED, kind: 'ORDER', icon: 'fa-cart-shopping', title: 'Sales order ' + o.ORDER_NUMBER + ' · ' + (o.STATUS || '') + (o.AMOUNT != null ? ' · ' + E.money(o.AMOUNT) : ''), body: o.CUSTOMER_PO ? 'PO ' + o.CUSTOMER_PO : '', ref: o.ORDER_NUMBER, refKind: 'order' }); });
        (src.receipts || []).forEach(function (r) { out.push({ at: r.RECEIPT_DATE, kind: 'RECEIPT', icon: 'fa-money-bill-wave', title: 'Payment ' + r.RECEIPT_NUMBER + ' · ' + E.money(r.AMOUNT), body: r.METHOD || '', ref: r.CASH_RECEIPT_ID, refKind: 'receipt', cls: 'ok' }); });
        out = out.filter(function (x) { return x.at; });
        out.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
        return out;
    };
    E.secs = function (s) { s = Math.max(0, Math.round(+s || 0)); var m = Math.floor(s / 60); return m + ':' + pad(s % 60); };

    // ── KPIs ──────────────────────────────────────────────────────
    E.ticketKpis = function (tickets, now, me) {
        var n = E.parse(now) || new Date(), today = E.iso(n), k = { open: 0, unassigned: 0, mine: 0, breached: 0, risk: 0, dueToday: 0, newToday: 0, resolvedToday: 0, waiting: 0, p1: 0 };
        (tickets || []).forEach(function (t) {
            if (String(t.CREATED_AT || '').slice(0, 10) === today) k.newToday++;
            if (String(t.RESOLVED_AT || '').slice(0, 10) === today) k.resolvedToday++;
            if (!E.isOpen(t)) return;
            k.open++;
            if (!t.ASSIGNED_TO) k.unassigned++;
            if (me && String(t.ASSIGNED_TO || '').toLowerCase() === String(me).toLowerCase()) k.mine++;
            if (t.STATUS === 'PENDING_CUSTOMER') k.waiting++;
            if (t.PRIORITY === 'P1') k.p1++;
            var s = E.sla(t, n);
            if (s.state === 'breached') k.breached++; else if (s.state === 'risk') k.risk++;
            if (String(t.DUE_RESOLVE || '').slice(0, 10) === today) k.dueToday++;
        });
        return k;
    };
    /** SLA compliance, first reply and resolution times of the tickets closed in a period */
    E.slaStats = function (tickets, hours) {
        var r = { n: 0, met: 0, firstN: 0, firstMins: 0, resN: 0, resMins: 0, byCat: {}, byAgent: {}, csatN: 0, csatSum: 0 };
        (tickets || []).forEach(function (t) {
            var c = t.CATEGORY || 'Other', a = t.ASSIGNED_TO || '(nobody)';
            r.byCat[c] = r.byCat[c] || { n: 0, open: 0 }; r.byCat[c].n++; if (E.isOpen(t)) r.byCat[c].open++;
            r.byAgent[a] = r.byAgent[a] || { n: 0, open: 0, resolved: 0 }; r.byAgent[a].n++; if (E.isOpen(t)) r.byAgent[a].open++; else r.byAgent[a].resolved++;
            if (t.FIRST_RESPONSE_AT) { r.firstN++; r.firstMins += E.workMinutes(t.CREATED_AT, t.FIRST_RESPONSE_AT, hours); }
            if (t.RESOLVED_AT) {
                r.resN++; r.resMins += E.workMinutes(t.CREATED_AT, t.RESOLVED_AT, hours); r.n++;
                if ((!t.DUE_RESOLVE || t.RESOLVED_AT <= t.DUE_RESOLVE) && (!t.DUE_FIRST || !t.FIRST_RESPONSE_AT || t.FIRST_RESPONSE_AT <= t.DUE_FIRST)) r.met++;
            }
            if (+t.CSAT > 0) { r.csatN++; r.csatSum += +t.CSAT; }
        });
        r.metPct = r.n ? Math.round(r.met / r.n * 100) : null;
        r.avgFirst = r.firstN ? Math.round(r.firstMins / r.firstN) : null;
        r.avgResolve = r.resN ? Math.round(r.resMins / r.resN) : null;
        r.csat = r.csatN ? Math.round(r.csatSum / r.csatN * 10) / 10 : null;
        return r;
    };

    // ── learning: tokens, naive Bayes, similar tickets ────────────
    var STOP = ('a an and are as at be but by for from has have he her his i if in into is it its me my no not of on or our so that the their them '
        + 'then there these they this to was we were what when which who will with you your please thanks thank regards dear hello hi kind sir madam '
        + 'le la les de des du un une et est pour pas sur avec dans').split(' ').reduce(function (o, w) { o[w] = 1; return o; }, {});
    E.tokens = function (text) {
        return String(text || '').toLowerCase().replace(/[^a-z0-9àâçéèêëîïôûùüÿñæœ]+/g, ' ').split(' ').filter(function (w) { return w.length > 1 && !STOP[w] && !/^\d{1,2}$/.test(w); })
            .map(function (w) { return w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w; });
    };
    /** rows [{text, label}] → model (multinomial naive Bayes with Laplace smoothing) */
    E.nbTrain = function (rows) {
        var m = { labels: {}, words: {}, vocab: {}, n: 0 };
        (rows || []).forEach(function (r) {
            if (!r || !r.label) return;
            var l = String(r.label); m.n++;
            m.labels[l] = (m.labels[l] || 0) + 1;
            var w = m.words[l] = m.words[l] || { _t: 0 };
            E.tokens(r.text).forEach(function (t) { w[t] = (w[t] || 0) + 1; w._t++; m.vocab[t] = 1; });
        });
        m.v = Object.keys(m.vocab).length; delete m.vocab;
        return m;
    };
    /** model + text → [{label, p}] best first (p = normalised probability) */
    E.nbPredict = function (m, text) {
        if (!m || !m.n) return [];
        var toks = E.tokens(text), labels = Object.keys(m.labels);
        if (!toks.length || labels.length < 2) return [];
        var logs = labels.map(function (l) {
            var w = m.words[l], lp = Math.log(m.labels[l] / m.n);
            toks.forEach(function (t) { lp += Math.log(((w[t] || 0) + 1) / (w._t + m.v + 1)); });
            return lp;
        });
        var max = Math.max.apply(null, logs), ex = logs.map(function (x) { return Math.exp(x - max); }), sum = ex.reduce(function (a, b) { return a + b; }, 0);
        return labels.map(function (l, i) { return { label: l, p: ex[i] / sum }; }).sort(function (a, b) { return b.p - a.p; });
    };
    /** the tickets most like this text (resolved ones with a resolution first) → [{t, score}] */
    E.similar = function (text, tickets, k) {
        var docs = (tickets || []).map(function (t) { return { t: t, toks: E.tokens((t.SUBJECT || '') + ' ' + (t.DESCRIPTION || '') + ' ' + (t.RESOLUTION || '')) }; });
        var df = {}; docs.forEach(function (d) { var seen = {}; d.toks.forEach(function (w) { if (!seen[w]) { seen[w] = 1; df[w] = (df[w] || 0) + 1; } }); });
        var N = docs.length || 1;
        function vec(toks) { var tf = {}, v = {}, norm = 0; toks.forEach(function (w) { tf[w] = (tf[w] || 0) + 1; }); Object.keys(tf).forEach(function (w) { var x = tf[w] * Math.log(1 + N / (1 + (df[w] || 0))); v[w] = x; norm += x * x; }); return { v: v, n: Math.sqrt(norm) || 1 }; }
        var q = vec(E.tokens(text));
        return docs.map(function (d) {
            var x = vec(d.toks), dot = 0; Object.keys(q.v).forEach(function (w) { if (x.v[w]) dot += q.v[w] * x.v[w]; });
            var s = dot / (q.n * x.n); if (d.t.RESOLUTION) s *= 1.15;
            return { t: d.t, score: Math.round(s * 1000) / 1000 };
        }).filter(function (x) { return x.score > 0.08; }).sort(function (a, b) { return b.score - a.score; }).slice(0, k || 5);
    };

    // ── ask: plain words → an intent the page answers without a language model ──
    var ASK = [
        { intent: 'tickets_breached', re: /\b(breach|overdue|late|past (the )?sla|sla)\b.*\btickets?\b|\btickets?\b.*\b(breach|overdue|late|sla)\b/ },
        { intent: 'tickets_mine', re: /\bmy (open )?tickets?\b|\btickets? (assigned )?(to|for) me\b/ },
        { intent: 'tickets_unassigned', re: /\bunassigned\b|\bnobody\b.*\btickets?\b/ },
        { intent: 'tickets_open', re: /\bopen tickets?\b|\btickets? (that are )?open\b|\ball tickets?\b/ },
        { intent: 'callbacks', re: /\bcall ?backs?\b|\bwho (do|should) i call\b/ },
        { intent: 'calls_missed', re: /\bmissed calls?\b/ },
        { intent: 'calls_today', re: /\bcalls? (today|of today)\b|\btoday'?s? calls?\b/ },
        { intent: 'last_statement', re: /\b(last|latest) statement\b|\bstatement (sent|communication|history)\b/, needsCustomer: true },
        { intent: 'send_statement', re: /\bsend (the |a )?statement\b|\bstatement to\b/, needsCustomer: true },
        { intent: 'balance', re: /\b(balance|owe|owes|outstanding|overdue amount|how much)\b/, needsCustomer: true },
        { intent: 'orders', re: /\b(orders?|sales orders?)\b/, needsCustomer: true },
        { intent: 'invoices', re: /\binvoices?\b/, needsCustomer: true },
        { intent: 'call_customer', re: /^\s*call\b|\bring\b|\bphone\b/, needsCustomer: true },
        { intent: 'new_ticket', re: /\b(new|raise|log|open|create) (a )?(ticket|case|complaint|issue)\b/ },
        { intent: 'customer', re: /\b(customer|account|open|show|find|who is)\b/, needsCustomer: true }
    ];
    /** text → {intent, customer (the words left after the intent), ticket (a ticket number), phone} or {intent: null} */
    E.ask = function (text, opts) {
        var s = String(text || '').trim(), low = s.toLowerCase(), out = { intent: null, text: s };
        var tk = new RegExp('\\b' + ((opts && opts.prefix) || 'CS-').replace(/[-]/g, '\\-') + '?\\d{3,}\\b', 'i').exec(s) || /\b(?:ticket|case)\s*#?\s*(\d+)\b/i.exec(s);
        if (tk) { out.intent = 'ticket'; out.ticket = (tk[1] || tk[0]).replace(/\D/g, ''); return out; }
        var ph = /(\+?\d[\d\s-]{6,}\d)/.exec(s);
        for (var i = 0; i < ASK.length; i++) {
            if (!ASK[i].re.test(low)) continue;
            out.intent = ASK[i].intent;
            if (ASK[i].needsCustomer) {
                var rest = s.replace(/\b(what('?s| is)?|show|open|find|who is|me|the|a|an|of|for|to|from|customer|account|last|latest|statement|statements|send|balance|owe[s]?|outstanding|overdue|amount|how much|does|do|is|orders?|sales|invoices?|call|ring|phone|communication|history|sent|please|\?)\b/gi, ' ').replace(/[?.!,]/g, ' ').replace(/\s+/g, ' ').trim();
                if (ph && /^\+?[\d\s-]+$/.test(ph[1])) { out.phone = ph[1].replace(/\s/g, ''); rest = rest.replace(ph[1], '').trim(); }
                out.customer = rest;
                if (!rest && !out.phone && out.intent === 'customer') out.intent = null;
            }
            return out;
        }
        if (ph && s.replace(/[\d\s+()-]/g, '').length < 3) { out.intent = 'phone'; out.phone = ph[1].replace(/\s/g, ''); return out; }
        if (s.length >= 2) { out.intent = 'search'; out.customer = s; }
        return out;
    };

    // ── Fusion SQL of Customer 360 (read-only; account numbers quoted, ids digits only) ──
    function q(v) { return "'" + String(v == null ? '' : v).replace(/'/g, "''") + "'"; }
    function digits(v) { var s = String(v == null ? '' : v).trim(); return /^\d+$/.test(s) ? s : '0'; }
    E.digits = digits;
    var LATEST_ORDER = "h.change_version_number = (SELECT MAX(x.change_version_number) FROM doo_headers_all x WHERE x.header_id = h.header_id OR (x.source_order_number = h.source_order_number AND x.source_order_system = h.source_order_system))";
    /** each section: a list of alternatives — the page runs the first the pod accepts */
    E.sql = {
        orders: function (acct, bu, months) {
            var m = Math.max(1, Math.min(60, +months || 12)), base = "SELECT h.order_number, TO_CHAR(h.ordered_date, 'YYYY-MM-DD') AS ordered, h.status_code AS status, h.customer_po_number AS customer_po,\n" +
                "       h.transactional_curr_code AS currency,\n       (SELECT SUM(fl.extended_amount) FROM doo_fulfill_lines_all fl WHERE fl.header_id = h.header_id) AS amount,\n" +
                "       (SELECT COUNT(*) FROM doo_fulfill_lines_all fl WHERE fl.header_id = h.header_id) AS lines_n,\n" +
                "       (SELECT COUNT(*) FROM doo_fulfill_lines_all fl WHERE fl.header_id = h.header_id AND fl.status_code IN ('SHIPPED', 'BILLED', 'CLOSED', 'PARTIALLY_SHIPPED', 'AWAIT_BILLING')) AS shipped_n,\n" +
                "       h.header_id\n  FROM doo_headers_all h\n  JOIN hz_cust_accounts ca ON ca.party_id = h.sold_to_party_id\n WHERE ca.account_number = " + q(acct) +
                " AND h.ordered_date >= ADD_MONTHS(TRUNC(SYSDATE), -" + m + ") AND NVL(h.submitted_flag, 'Y') = 'Y'";
            return [base + ' AND h.org_id = ' + digits(bu) + ' AND ' + LATEST_ORDER + '\n ORDER BY h.ordered_date DESC, h.order_number DESC FETCH FIRST 400 ROWS ONLY',
                base + ' AND ' + LATEST_ORDER + '\n ORDER BY h.ordered_date DESC FETCH FIRST 400 ROWS ONLY',
                base + '\n ORDER BY h.ordered_date DESC FETCH FIRST 400 ROWS ONLY'];
        },
        orderLines: function (headerId) {
            return ["SELECT fl.fulfill_line_number AS line, i.item_number AS item, fl.ordered_qty, fl.shipped_qty, fl.ordered_uom AS uom, fl.status_code AS status,\n" +
                "       TO_CHAR(fl.actual_ship_date, 'YYYY-MM-DD') AS shipped, fl.unit_selling_price AS price, fl.extended_amount AS amount\n" +
                "  FROM doo_fulfill_lines_all fl\n  LEFT JOIN egp_system_items_b i ON i.inventory_item_id = fl.inventory_item_id AND i.organization_id = fl.fulfill_org_id\n" +
                " WHERE fl.header_id = " + digits(headerId) + "\n ORDER BY fl.fulfill_line_number"];
        },
        invoices: function (acct, bu, months) {
            var m = Math.max(1, Math.min(60, +months || 12));
            var base = "SELECT t.trx_number, TO_CHAR(t.trx_date, 'YYYY-MM-DD') AS trx_date, tt.name AS trx_type, tt.type AS class, t.invoice_currency_code AS currency,\n" +
                "       (SELECT SUM(ps.amount_due_original) FROM ar_payment_schedules_all ps WHERE ps.customer_trx_id = t.customer_trx_id) AS amount,\n" +
                "       (SELECT SUM(ps.amount_due_remaining) FROM ar_payment_schedules_all ps WHERE ps.customer_trx_id = t.customer_trx_id) AS remaining,\n" +
                "       (SELECT TO_CHAR(MIN(ps.due_date), 'YYYY-MM-DD') FROM ar_payment_schedules_all ps WHERE ps.customer_trx_id = t.customer_trx_id) AS due_date,\n" +
                "       (SELECT MAX(l.sales_order) FROM ra_customer_trx_lines_all l WHERE l.customer_trx_id = t.customer_trx_id AND l.line_type = 'LINE') AS order_number,\n" +
                "       t.purchase_order AS customer_po, t.customer_trx_id\n  FROM ra_customer_trx_all t\n  JOIN hz_cust_accounts ca ON ca.cust_account_id = t.bill_to_customer_id\n" +
                "  LEFT JOIN ra_cust_trx_types_all tt ON tt.cust_trx_type_seq_id = t.cust_trx_type_seq_id\n WHERE ca.account_number = " + q(acct) +
                " AND t.trx_date >= ADD_MONTHS(TRUNC(SYSDATE), -" + m + ") AND NVL(t.complete_flag, 'Y') = 'Y'";
            return [base + ' AND t.org_id = ' + digits(bu) + '\n ORDER BY t.trx_date DESC, t.trx_number DESC FETCH FIRST 500 ROWS ONLY', base + '\n ORDER BY t.trx_date DESC FETCH FIRST 500 ROWS ONLY'];
        },
        receipts: function (acct, bu, months) {
            var m = Math.max(1, Math.min(60, +months || 12));
            var base = "SELECT cr.receipt_number, TO_CHAR(cr.receipt_date, 'YYYY-MM-DD') AS receipt_date, cr.amount, cr.currency_code AS currency, cr.status,\n" +
                "       (SELECT rm.name FROM ar_receipt_methods rm WHERE rm.receipt_method_id = cr.receipt_method_id) AS method, cr.comments, cr.cash_receipt_id\n" +
                "  FROM ar_cash_receipts_all cr\n  JOIN hz_cust_accounts ca ON ca.cust_account_id = cr.pay_from_customer\n WHERE ca.account_number = " + q(acct) +
                " AND cr.receipt_date >= ADD_MONTHS(TRUNC(SYSDATE), -" + m + ")";
            var plain = base.replace(",\n       (SELECT rm.name FROM ar_receipt_methods rm WHERE rm.receipt_method_id = cr.receipt_method_id) AS method", '');
            return [base + ' AND cr.org_id = ' + digits(bu) + '\n ORDER BY cr.receipt_date DESC FETCH FIRST 300 ROWS ONLY', plain + '\n ORDER BY cr.receipt_date DESC FETCH FIRST 300 ROWS ONLY'];
        },
        items: function (acct, bu, months) {
            var m = Math.max(1, Math.min(60, +months || 12));
            var desc = "(SELECT MAX(tl.description) FROM egp_system_items_tl tl WHERE tl.inventory_item_id = fl.inventory_item_id AND tl.organization_id = fl.fulfill_org_id AND tl.language = USERENV('LANG'))";
            var body = function (d) {
                return "SELECT i.item_number AS item, MAX(" + d + ") AS description, COUNT(DISTINCT h.header_id) AS orders, SUM(fl.ordered_qty) AS qty, MAX(fl.ordered_uom) AS uom,\n" +
                    "       SUM(fl.extended_amount) AS amount, TO_CHAR(MAX(h.ordered_date), 'YYYY-MM-DD') AS last_ordered, MAX(fl.inventory_item_id) AS inventory_item_id\n" +
                    "  FROM doo_fulfill_lines_all fl\n  JOIN doo_headers_all h ON h.header_id = fl.header_id\n  JOIN hz_cust_accounts ca ON ca.party_id = h.sold_to_party_id\n" +
                    "  LEFT JOIN egp_system_items_b i ON i.inventory_item_id = fl.inventory_item_id AND i.organization_id = fl.fulfill_org_id\n" +
                    " WHERE ca.account_number = " + q(acct) + " AND h.ordered_date >= ADD_MONTHS(TRUNC(SYSDATE), -" + m + ") AND NVL(fl.status_code, 'X') <> 'CANCELED'\n" +
                    " GROUP BY i.item_number\n ORDER BY SUM(fl.extended_amount) DESC NULLS LAST FETCH FIRST 150 ROWS ONLY";
            };
            return [body(desc), body('i.item_number')];
        },
        stock: function (itemIds) {
            var ids = (itemIds || []).map(digits).filter(function (x) { return x !== '0'; }).slice(0, 300);
            if (!ids.length) return [];
            return ["SELECT i.item_number AS item, op.organization_code AS org, oh.subinventory_code AS subinventory, SUM(oh.transaction_quantity) AS qty, MAX(oh.transaction_uom_code) AS uom\n" +
                "  FROM inv_onhand_quantities_detail oh\n  JOIN egp_system_items_b i ON i.inventory_item_id = oh.inventory_item_id AND i.organization_id = oh.organization_id\n" +
                "  LEFT JOIN inv_org_parameters op ON op.organization_id = oh.organization_id\n WHERE oh.inventory_item_id IN (" + ids.join(', ') + ")\n" +
                " GROUP BY i.item_number, op.organization_code, oh.subinventory_code\n HAVING SUM(oh.transaction_quantity) <> 0\n ORDER BY i.item_number, op.organization_code, oh.subinventory_code"];
        },
        contacts: function (acct) {
            var cp = function (type, col) {
                return "(SELECT MAX(" + col + ") KEEP (DENSE_RANK FIRST ORDER BY DECODE(cp.primary_flag, 'Y', 0, 1)) FROM hz_contact_points cp WHERE cp.owner_table_name = 'HZ_PARTIES' AND cp.owner_table_id = r.party_id AND cp.contact_point_type = '" + type + "' AND cp.status = 'A')";
            };
            return ["SELECT pp.party_name AS contact, NVL(r.relationship_code, 'CONTACT') AS role, " + cp('EMAIL', 'cp.email_address') + " AS email,\n" +
                "       " + cp('PHONE', "NVL2(cp.phone_area_code, cp.phone_area_code || ' ', '') || cp.phone_number") + " AS phone, pp.party_number\n" +
                "  FROM hz_cust_accounts ca\n  JOIN hz_relationships r ON r.object_id = ca.party_id AND r.subject_type = 'PERSON' AND r.status = 'A' AND r.directional_flag = 'F'\n" +
                "  JOIN hz_parties pp ON pp.party_id = r.subject_id\n WHERE ca.account_number = " + q(acct) + "\n ORDER BY pp.party_name FETCH FIRST 100 ROWS ONLY"];
        },
        /** customers whose phone ends with these 7+ digits (the screen pop when the number is not known on this PC) */
        phone: function (last7) {
            var d = String(last7 || '').replace(/\D/g, '').slice(-7); if (d.length < 7) return [];
            return ["SELECT ca.account_number, p.party_name AS customer, NVL2(cp.phone_area_code, cp.phone_area_code || ' ', '') || cp.phone_number AS phone\n" +
                "  FROM hz_contact_points cp\n  JOIN hz_parties p ON p.party_id = cp.owner_table_id\n  JOIN hz_cust_accounts ca ON ca.party_id = p.party_id\n" +
                " WHERE cp.owner_table_name = 'HZ_PARTIES' AND cp.contact_point_type = 'PHONE' AND cp.status = 'A'\n" +
                "   AND REGEXP_REPLACE(NVL(cp.phone_area_code, '') || cp.phone_number, '[^0-9]', '') LIKE '%" + d + "'\n FETCH FIRST 20 ROWS ONLY"];
        },
        /** 24 months of sales by month (invoices) for the trend */
        salesByMonth: function (acct, bu) {
            var base = "SELECT TO_CHAR(t.trx_date, 'YYYY-MM') AS month, SUM(ps.amount_due_original) AS amount, COUNT(DISTINCT t.customer_trx_id) AS invoices\n" +
                "  FROM ra_customer_trx_all t\n  JOIN hz_cust_accounts ca ON ca.cust_account_id = t.bill_to_customer_id\n  JOIN ar_payment_schedules_all ps ON ps.customer_trx_id = t.customer_trx_id\n" +
                " WHERE ca.account_number = " + q(acct) + " AND t.trx_date >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -23) AND ps.class IN ('INV', 'DM', 'CM')";
            return [base + ' AND t.org_id = ' + digits(bu) + "\n GROUP BY TO_CHAR(t.trx_date, 'YYYY-MM')\n ORDER BY 1", base + "\n GROUP BY TO_CHAR(t.trx_date, 'YYYY-MM')\n ORDER BY 1"];
        }
    };
    /** monthly sales rows → {m12, prev12, series [{month, amount}]} over the 24 months to `now` */
    E.salesTrend = function (rows, now) {
        var n = E.parse(now) || new Date(), by = {}, series = [];
        (rows || []).forEach(function (r) { by[r.MONTH] = (by[r.MONTH] || 0) + (+r.AMOUNT || 0); });
        for (var i = 23; i >= 0; i--) { var d = new Date(n.getFullYear(), n.getMonth() - i, 1), k = d.getFullYear() + '-' + pad(d.getMonth() + 1); series.push({ month: k, amount: Math.round((by[k] || 0) * 100) / 100 }); }
        var m12 = 0, prev12 = 0; series.forEach(function (s, i) { if (i >= 12) m12 += s.amount; else prev12 += s.amount; });
        return { m12: Math.round(m12 * 100) / 100, prev12: Math.round(prev12 * 100) / 100, series: series };
    };

    // ── e-mail bodies ─────────────────────────────────────────────
    E.vars = function (ctx) {
        ctx = ctx || {}; var t = ctx.ticket || {}, c = ctx.customer || {};
        return { CUSTOMER: c.name || t.ACCOUNT_NAME || '', ACCOUNT_NUMBER: c.account || t.ACCOUNT_NUMBER || '', CONTACT: t.CONTACT_NAME || c.contact || c.name || 'Customer',
            TICKET_NO: t.TICKET_NO || '', SUBJECT: t.SUBJECT || '', STATUS: E.status(t.STATUS).label, RESOLUTION: t.RESOLUTION || '', AGENT: ctx.agent || '', COMPANY: ctx.company || '', LINK: ctx.link || '' };
    };
    /** plain text → simple HTML paragraphs (links kept) */
    E.textHtml = function (text) {
        return E.esc(text).split(/\n{2,}/).map(function (p) { return '<p style="margin:0 0 10px">' + p.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>') + '</p>'; }).join('');
    };
    E.emailHtml = function (body, opts) {
        opts = opts || {};
        return '<div style="font:14px/1.5 Segoe UI,Arial,sans-serif;color:#0f172a">' + E.textHtml(body) +
            (opts.ticketLink ? '<p style="margin:14px 0"><a href="' + E.esc(opts.ticketLink) + '" style="display:inline-block;background:#4338ca;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-weight:600">View or reply to ' + E.esc(opts.ticketNo || 'your request') + '</a></p>' : '') +
            (opts.signature ? '<div style="margin-top:14px;color:#334155">' + E.textHtml(opts.signature) + '</div>' : '') + '</div>';
    };
    E.subjectFor = function (t) { return t && t.TICKET_NO ? '[' + t.TICKET_NO + '] ' + (t.SUBJECT || '') : ''; };

    return E;
});
