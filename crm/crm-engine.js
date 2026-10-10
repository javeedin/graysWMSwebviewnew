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
        prefix: 'CS-',
        /** the item DFF columns of EGP_SYSTEM_ITEMS_B used by Customer 360 › Items (blank = not used) */
        itemDff: { profitCenter: 'ATTRIBUTE1', supplier: 'ATTRIBUTE2' }
    };
    E.setup = function (saved) {
        var d = JSON.parse(JSON.stringify(E.DEFAULTS));
        if (!saved) return d;
        Object.keys(saved).forEach(function (k) {
            if (saved[k] == null) return;
            if (k === 'phone' || k === 'hours' || k === 'sla' || k === 'itemDff') d[k] = Object.assign(d[k], saved[k]);
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
    /**
     * What each customer needs now, by account: open tickets (breached / at risk / waiting), callbacks not done (late / today /
     * planned), missed calls of the last `missedDays` days that nobody returned (no later answered call or outgoing call to that
     * account), Debtors follow-ups (open promises — late when past the pay-by date —, open disputes, other open tasks / calls).
     * → {account: {tickets, callbacks, missed, promises, disputes, followups, score, flags: [{k, n, cls, label}]}}
     */
    E.custFlags = function (src, now, missedDays) {
        src = src || {};
        var n = E.parse(now) || new Date(), today = E.iso(n), since = E.iso(new Date(n.getTime() - (missedDays || 7) * 864e5)), out = {};
        function of(a) { a = String(a || '').trim(); if (!a) return null; return out[a] || (out[a] = { tickets: { n: 0, breached: 0, risk: 0, waiting: 0, ids: [] }, callbacks: { n: 0, late: 0, today: 0, next: '', ids: [] }, missed: { n: 0, last: '', ids: [] }, promises: { n: 0, late: 0, amount: 0, ids: [] }, disputes: { n: 0, ids: [] }, followups: { n: 0, late: 0, ids: [] } }); }
        (src.tickets || []).forEach(function (t) {
            if (!E.isOpen(t)) return; var x = of(t.ACCOUNT_NUMBER); if (!x) return;
            var s = E.sla(t, n).state;
            x.tickets.n++; x.tickets.ids.push(t.TICKET_ID);
            if (s === 'breached') x.tickets.breached++; else if (s === 'risk') x.tickets.risk++;
            if (/^PENDING/.test(t.STATUS || '')) x.tickets.waiting++;
        });
        var calls = (src.calls || []).slice().sort(function (a, b) { return String(a.STARTED_AT || '').localeCompare(String(b.STARTED_AT || '')); }), lastReach = {};
        calls.forEach(function (c) { if (c.ACCOUNT_NUMBER && (c.DIRECTION === 'OUT' || c.OUTCOME === 'ANSWERED')) lastReach[c.ACCOUNT_NUMBER] = String(c.STARTED_AT || ''); });
        calls.forEach(function (c) {
            var x = of(c.ACCOUNT_NUMBER); if (!x) return;
            if (c.CALLBACK_AT && c.CALLBACK_DONE !== 'Y') {
                var d = String(c.CALLBACK_AT).slice(0, 10);
                x.callbacks.n++; x.callbacks.ids.push(c.CALL_ID);
                if (d < today) x.callbacks.late++; else if (d === today) x.callbacks.today++;
                if (!x.callbacks.next || String(c.CALLBACK_AT) < x.callbacks.next) x.callbacks.next = String(c.CALLBACK_AT);
            }
            var at = String(c.STARTED_AT || '');
            if (c.OUTCOME === 'MISSED' && c.DIRECTION !== 'OUT' && at.slice(0, 10) >= since && !(lastReach[c.ACCOUNT_NUMBER] > at)) {
                x.missed.n++; x.missed.ids.push(c.CALL_ID); if (at > x.missed.last) x.missed.last = at;
            }
        });
        (src.acts || []).forEach(function (a) {
            if (a.STATUS && a.STATUS !== 'OPEN') return; var x = of(a.ACCOUNT_NUMBER); if (!x) return;
            var late = a.DUE_DATE && String(a.DUE_DATE).slice(0, 10) < today;
            if (a.KIND === 'PROMISE') { x.promises.n++; x.promises.ids.push(a.ACT_ID); x.promises.amount += +a.AMOUNT || 0; if (late) x.promises.late++; }
            else if (a.KIND === 'DISPUTE') { x.disputes.n++; x.disputes.ids.push(a.ACT_ID); }
            else if (a.KIND === 'TASK' || a.KIND === 'CALL' || a.KIND === 'EMAIL' || a.KIND === 'VISIT') { x.followups.n++; x.followups.ids.push(a.ACT_ID); if (late) x.followups.late++; }
        });
        Object.keys(out).forEach(function (k) {
            var x = out[k], f = [], tk = x.tickets, cb = x.callbacks;
            if (tk.n) f.push({ k: 'tickets', n: tk.n, cls: tk.breached ? 'bad' : tk.risk ? 'warn' : 'info', label: tk.n + ' open ticket' + (tk.n > 1 ? 's' : '') + (tk.breached ? ' · ' + tk.breached + ' past the SLA' : '') + (tk.risk ? ' · ' + tk.risk + ' at risk' : '') + (tk.waiting ? ' · ' + tk.waiting + ' waiting for the customer' : '') });
            if (cb.n) f.push({ k: 'callbacks', n: cb.n, cls: cb.late ? 'bad' : cb.today ? 'warn' : 'info', label: cb.n + ' callback' + (cb.n > 1 ? 's' : '') + ' to make' + (cb.late ? ' · ' + cb.late + ' late' : '') + (cb.today ? ' · ' + cb.today + ' today' : '') + (!cb.late && !cb.today ? ' · next ' + cb.next.slice(0, 16) : '') });
            if (x.missed.n) f.push({ k: 'missed', n: x.missed.n, cls: 'bad', label: x.missed.n + ' missed call' + (x.missed.n > 1 ? 's' : '') + ' not returned · last ' + x.missed.last.slice(0, 16) });
            if (x.promises.n) f.push({ k: 'promises', n: x.promises.n, cls: x.promises.late ? 'bad' : 'vio', label: x.promises.n + ' promise' + (x.promises.n > 1 ? 's' : '') + ' to pay' + (x.promises.late ? ' · ' + x.promises.late + ' past the date' : '') });
            if (x.disputes.n) f.push({ k: 'disputes', n: x.disputes.n, cls: 'warn', label: x.disputes.n + ' open dispute' + (x.disputes.n > 1 ? 's' : '') });
            if (x.followups.n) f.push({ k: 'followups', n: x.followups.n, cls: x.followups.late ? 'bad' : 'info', label: x.followups.n + ' follow-up' + (x.followups.n > 1 ? 's' : '') + (x.followups.late ? ' · ' + x.followups.late + ' overdue' : '') });
            x.flags = f;
            x.score = tk.breached * 5 + cb.late * 4 + x.missed.n * 3 + x.promises.late * 3 + cb.today * 2 + tk.risk * 2 + x.disputes.n * 2 + x.followups.late * 2 + tk.n + cb.n;
        });
        return out;
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
            var m = Math.max(1, Math.min(60, +months || 12));
            // DOO_HEADERS_ALL differs between releases: the currency is TRANSACTIONAL_CURRENCY_CODE (not _CURR_CODE), SUBMITTED_FLAG may be missing —
            // so the alternatives drop the fragile columns one by one before giving up
            function one(cur, sub, where) {
                return "SELECT h.order_number, TO_CHAR(h.ordered_date, 'YYYY-MM-DD') AS ordered, h.status_code AS status, h.customer_po_number AS customer_po,\n" +
                    (cur ? '       ' + cur + ' AS currency,\n' : '') +
                    "       (SELECT SUM(fl.extended_amount) FROM doo_fulfill_lines_all fl WHERE fl.header_id = h.header_id) AS amount,\n" +
                    "       (SELECT COUNT(*) FROM doo_fulfill_lines_all fl WHERE fl.header_id = h.header_id) AS lines_n,\n" +
                    "       (SELECT COUNT(*) FROM doo_fulfill_lines_all fl WHERE fl.header_id = h.header_id AND fl.status_code IN ('SHIPPED', 'BILLED', 'CLOSED', 'PARTIALLY_SHIPPED', 'AWAIT_BILLING')) AS shipped_n,\n" +
                    "       h.header_id\n  FROM doo_headers_all h\n  JOIN hz_cust_accounts ca ON ca.party_id = h.sold_to_party_id\n WHERE ca.account_number = " + q(acct) +
                    " AND h.ordered_date >= ADD_MONTHS(TRUNC(SYSDATE), -" + m + ")" + (sub ? " AND NVL(h.submitted_flag, 'Y') = 'Y'" : '') + where +
                    '\n ORDER BY h.ordered_date DESC, h.order_number DESC FETCH FIRST 400 ROWS ONLY';
            }
            var buLatest = ' AND h.org_id = ' + digits(bu) + ' AND ' + LATEST_ORDER, latest = ' AND ' + LATEST_ORDER;
            return [one('h.transactional_currency_code', true, buLatest), one('h.transactional_currency_code', true, latest),
                one(null, true, buLatest), one(null, false, buLatest), one(null, false, latest), one(null, false, '')];
        },
        orderLines: function (headerId) {
            return ["SELECT fl.fulfill_line_number AS line, i.item_number AS item, fl.ordered_qty, fl.shipped_qty, fl.ordered_uom AS uom, fl.status_code AS status,\n" +
                "       TO_CHAR(fl.actual_ship_date, 'YYYY-MM-DD') AS shipped, fl.unit_selling_price AS price, fl.extended_amount AS amount\n" +
                "  FROM doo_fulfill_lines_all fl\n  LEFT JOIN egp_system_items_b i ON i.inventory_item_id = fl.inventory_item_id AND i.organization_id = fl.fulfill_org_id\n" +
                " WHERE fl.header_id = " + digits(headerId) + "\n ORDER BY fl.fulfill_line_number"];
        },
        /** every AR transaction (invoices, credit memos, debit memos, chargebacks, deposits): amount, open, due, paid or not, the order,
         *  the invoice a credit memo was made against and its reason. Alternatives drop the columns a pod may not have. */
        invoices: function (acct, bu, months) {
            var m = Math.max(1, Math.min(60, +months || 24));
            function one(extra, typeCol) {
                return "SELECT t.trx_number, TO_CHAR(t.trx_date, 'YYYY-MM-DD') AS trx_date, tt.name AS trx_type, " + typeCol + " AS class, t.invoice_currency_code AS currency,\n" +
                    "       (SELECT SUM(ps.amount_due_original) FROM ar_payment_schedules_all ps WHERE ps.customer_trx_id = t.customer_trx_id) AS amount,\n" +
                    "       (SELECT SUM(ps.amount_due_remaining) FROM ar_payment_schedules_all ps WHERE ps.customer_trx_id = t.customer_trx_id) AS remaining,\n" +
                    "       (SELECT TO_CHAR(MIN(ps.due_date), 'YYYY-MM-DD') FROM ar_payment_schedules_all ps WHERE ps.customer_trx_id = t.customer_trx_id) AS due_date,\n" +
                    "       (SELECT TO_CHAR(MAX(ps.actual_date_closed), 'YYYY-MM-DD') FROM ar_payment_schedules_all ps WHERE ps.customer_trx_id = t.customer_trx_id AND ps.status = 'CL') AS closed_date,\n" +
                    "       (SELECT MAX(l.sales_order) FROM ra_customer_trx_lines_all l WHERE l.customer_trx_id = t.customer_trx_id AND l.line_type = 'LINE') AS order_number,\n" +
                    "       t.purchase_order AS customer_po, t.ct_reference AS reference" + extra + ", t.customer_trx_id\n  FROM ra_customer_trx_all t\n  JOIN hz_cust_accounts ca ON ca.cust_account_id = t.bill_to_customer_id\n" +
                    "  LEFT JOIN ra_cust_trx_types_all tt ON tt.cust_trx_type_seq_id = t.cust_trx_type_seq_id\n WHERE ca.account_number = " + q(acct) +
                    " AND t.trx_date >= ADD_MONTHS(TRUNC(SYSDATE), -" + m + ") AND NVL(t.complete_flag, 'Y') = 'Y'";
            }
            var prev = ",\n       (SELECT p.trx_number FROM ra_customer_trx_all p WHERE p.customer_trx_id = t.previous_customer_trx_id) AS against_trx, t.previous_customer_trx_id AS against_trx_id, t.reason_code AS reason";
            var tail = function (sql, withBu) { return sql + (withBu ? ' AND t.org_id = ' + digits(bu) : '') + '\n ORDER BY t.trx_date DESC, t.trx_number DESC FETCH FIRST 2000 ROWS ONLY'; };
            return [tail(one(prev, 'tt.type'), true), tail(one(prev, 'tt.type'), false), tail(one('', 'tt.type'), true), tail(one('', 'tt.type'), false), tail(one('', "'INV'"), false)];
        },
        /** receipts with what was applied / left unapplied and, when reversed, why (NSF = bounced cheque, STOP = stop payment, REV = reversed) */
        receipts: function (acct, bu, months) {
            var m = Math.max(1, Math.min(60, +months || 24));
            var method = ",\n       (SELECT rm.name FROM ar_receipt_methods rm WHERE rm.receipt_method_id = cr.receipt_method_id) AS method";
            var applied = ",\n       (SELECT SUM(ra.amount_applied) FROM ar_receivable_applications_all ra WHERE ra.cash_receipt_id = cr.cash_receipt_id AND ra.status = 'APP' AND NVL(ra.display, 'Y') = 'Y') AS applied,\n" +
                "       (SELECT SUM(ra.amount_applied) FROM ar_receivable_applications_all ra WHERE ra.cash_receipt_id = cr.cash_receipt_id AND ra.status IN ('UNAPP', 'UNID', 'ACC') AND NVL(ra.display, 'Y') = 'Y') AS unapplied";
            var rev = ",\n       TO_CHAR(cr.reversal_date, 'YYYY-MM-DD') AS reversal_date, cr.reversal_category, cr.reversal_reason_code AS reversal_reason, cr.reversal_comments";
            function one(extra) {
                return "SELECT cr.receipt_number, TO_CHAR(cr.receipt_date, 'YYYY-MM-DD') AS receipt_date, cr.amount, cr.currency_code AS currency, cr.status, cr.type AS receipt_type" + extra + ",\n" +
                    "       cr.comments, cr.cash_receipt_id\n  FROM ar_cash_receipts_all cr\n  JOIN hz_cust_accounts ca ON ca.cust_account_id = cr.pay_from_customer\n WHERE ca.account_number = " + q(acct) +
                    " AND cr.receipt_date >= ADD_MONTHS(TRUNC(SYSDATE), -" + m + ")";
            }
            var tail = function (sql, withBu) { return sql + (withBu ? ' AND cr.org_id = ' + digits(bu) : '') + '\n ORDER BY cr.receipt_date DESC FETCH FIRST 1000 ROWS ONLY'; };
            return [tail(one(method + applied + rev), true), tail(one(method + applied + rev), false), tail(one(method + rev), false), tail(one(method), false), tail(one(''), false)];
        },
        /** applications to this customer's transactions: cash (receipts — also from another account, e.g. a head office) and credit memos,
         *  with days to pay from the invoice date and days late against the due date */
        applications: function (acct, bu, months) {
            var m = Math.max(1, Math.min(60, +months || 24));
            function one(full) {
                return "SELECT ra.application_type AS app_type, TO_CHAR(ra.apply_date, 'YYYY-MM-DD') AS apply_date, " + (full ? 'NVL(cr.receipt_number, cm.trx_number)' : 'cr.receipt_number') + " AS paid_with,\n" +
                    "       t.trx_number, TO_CHAR(t.trx_date, 'YYYY-MM-DD') AS trx_date, TO_CHAR(ps.due_date, 'YYYY-MM-DD') AS due_date, ra.amount_applied,\n" +
                    "       ROUND(ra.apply_date - t.trx_date) AS days_to_pay, ROUND(ra.apply_date - ps.due_date) AS days_late" + (full ? ", pca.account_number AS paid_by" : '') + ",\n" +
                    "       ra.cash_receipt_id, ra.applied_customer_trx_id AS customer_trx_id" + (full ? ', ra.customer_trx_id AS cm_trx_id' : '') + "\n" +
                    "  FROM ar_receivable_applications_all ra\n  JOIN ra_customer_trx_all t ON t.customer_trx_id = ra.applied_customer_trx_id\n  JOIN hz_cust_accounts ca ON ca.cust_account_id = t.bill_to_customer_id\n" +
                    "  LEFT JOIN ar_payment_schedules_all ps ON ps.payment_schedule_id = ra.applied_payment_schedule_id\n  LEFT JOIN ar_cash_receipts_all cr ON cr.cash_receipt_id = ra.cash_receipt_id\n" +
                    (full ? "  LEFT JOIN hz_cust_accounts pca ON pca.cust_account_id = cr.pay_from_customer\n  LEFT JOIN ra_customer_trx_all cm ON cm.customer_trx_id = ra.customer_trx_id\n" : '') +
                    " WHERE ca.account_number = " + q(acct) + " AND ra.status = 'APP' AND NVL(ra.display, 'Y') = 'Y' AND ra.apply_date >= ADD_MONTHS(TRUNC(SYSDATE), -" + m + ")\n ORDER BY ra.apply_date DESC FETCH FIRST 2000 ROWS ONLY";
            }
            return [one(true), one(false)];
        },
        /** adjustments on the customer's transactions (write-offs, small balances, charges) */
        adjustments: function (acct, bu, months) {
            var m = Math.max(1, Math.min(60, +months || 24));
            var base = "SELECT adj.adjustment_number, TO_CHAR(adj.apply_date, 'YYYY-MM-DD') AS apply_date, t.trx_number, adj.amount, adj.type AS adj_type, adj.reason_code AS reason, adj.status";
            var tail = ", t.customer_trx_id\n  FROM ar_adjustments_all adj\n  JOIN ra_customer_trx_all t ON t.customer_trx_id = adj.customer_trx_id\n  JOIN hz_cust_accounts ca ON ca.cust_account_id = t.bill_to_customer_id\n" +
                " WHERE ca.account_number = " + q(acct) + " AND adj.apply_date >= ADD_MONTHS(TRUNC(SYSDATE), -" + m + ")\n ORDER BY adj.apply_date DESC FETCH FIRST 500 ROWS ONLY";
            return [base + ', adj.comments' + tail, base + tail];
        },
        /** product returns: return lines of sales orders (Order Management), with the return reason */
        returns: function (acct, bu, months) {
            var m = Math.max(1, Math.min(60, +months || 24));
            function one(reason, cat) {
                return "SELECT h.order_number, TO_CHAR(h.ordered_date, 'YYYY-MM-DD') AS ordered, fl.fulfill_line_number AS line, i.item_number AS item, fl.ordered_qty AS qty, fl.ordered_uom AS uom,\n" +
                    "       fl.extended_amount AS amount, fl.status_code AS status" + (reason ? ', fl.return_reason_code AS reason' : '') + ", h.header_id\n" +
                    "  FROM doo_fulfill_lines_all fl\n  JOIN doo_headers_all h ON h.header_id = fl.header_id\n  JOIN hz_cust_accounts ca ON ca.party_id = h.sold_to_party_id\n" +
                    "  LEFT JOIN egp_system_items_b i ON i.inventory_item_id = fl.inventory_item_id AND i.organization_id = fl.fulfill_org_id\n" +
                    " WHERE ca.account_number = " + q(acct) + " AND h.ordered_date >= ADD_MONTHS(TRUNC(SYSDATE), -" + m + ") AND " + cat + "\n ORDER BY h.ordered_date DESC, h.order_number DESC FETCH FIRST 500 ROWS ONLY";
            }
            return [one(true, "fl.line_category_code = 'RETURN'"), one(false, "fl.line_category_code = 'RETURN'"), one(false, "fl.category_code = 'RETURN'"), one(false, 'fl.ordered_qty < 0')];
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
    // ── customer DFFs (descriptive flexfields on the account, the party and the organization profile) ──
    /** the tables whose DFFs the customer master reads: A = account, P = party, O = organization profile */
    E.DFF_TABLES = { A: { table: 'HZ_CUST_ACCOUNTS', alias: 'ca', label: 'Account' }, P: { table: 'HZ_PARTIES', alias: 'p', label: 'Party' }, O: { table: 'HZ_ORGANIZATION_PROFILES', alias: 'op', label: 'Organization' } };
    /** a column that may reach SQL as a DFF column */
    E.dffColOk = function (c) { return /^ATTRIBUTE(_CHAR|_NUMBER|_DATE|_TIMESTAMP)?\d{1,2}$/.test(String(c || '').toUpperCase()) || String(c || '').toUpperCase() === 'ATTRIBUTE_CATEGORY'; };
    /** the DFF segments (labels) defined on those tables: FND_DF_SEGMENTS_VL × FND_DF_TABLE_USAGES; alternatives without the
     *  application id join, then by flexfield code */
    E.sql.dffLabels = function () {
        var tabs = "('HZ_CUST_ACCOUNTS', 'HZ_PARTIES', 'HZ_ORGANIZATION_PROFILES')";
        var sel = "SELECT u.table_name AS tbl, s.descriptive_flexfield_code AS flex, s.context_code AS ctx, s.column_name AS col, s.name AS label, s.sequence_number AS seq\n  FROM fnd_df_segments_vl s\n";
        return [sel + "  JOIN fnd_df_table_usages u ON u.descriptive_flexfield_code = s.descriptive_flexfield_code AND u.application_id = s.application_id\n WHERE u.table_name IN " + tabs + "\n ORDER BY 1, 3, 6",
            sel + "  JOIN fnd_df_table_usages u ON u.descriptive_flexfield_code = s.descriptive_flexfield_code\n WHERE u.table_name IN " + tabs + "\n ORDER BY 1, 3, 6",
            "SELECT DECODE(s.descriptive_flexfield_code, 'HZ_CUST_ACCOUNTS', 'HZ_CUST_ACCOUNTS', 'HZ_ORGANIZATION_PROFILES', 'HZ_ORGANIZATION_PROFILES', 'HZ_PARTIES') AS tbl, s.descriptive_flexfield_code AS flex,\n" +
            "       s.context_code AS ctx, s.column_name AS col, s.name AS label, s.sequence_number AS seq\n  FROM fnd_df_segments_vl s\n WHERE s.descriptive_flexfield_code IN ('HZ_CUST_ACCOUNTS', 'HZ_PARTIES', 'HZ_ORGANIZATION_PROFILES', 'PERSON', 'ORGANIZATION')\n ORDER BY 1, 3, 6"];
    };
    /** the label rows → {A|P|O: {cols: [COL…], labels: [{col, ctx, label, seq}]}} — only safe columns, ATTRIBUTE_CATEGORY added */
    E.dffSpec = function (rows) {
        var out = {}, tk = {}; Object.keys(E.DFF_TABLES).forEach(function (k) { tk[E.DFF_TABLES[k].table] = k; });
        (rows || []).forEach(function (r) {
            var k = tk[String(r.TBL || r.tbl || '').toUpperCase()], col = String(r.COL || r.col || '').toUpperCase();
            if (!k || !E.dffColOk(col)) return;
            var t = out[k] || (out[k] = { cols: ['ATTRIBUTE_CATEGORY'], labels: [] });
            if (t.cols.indexOf(col) < 0) t.cols.push(col);
            t.labels.push({ col: col, ctx: String(r.CTX || r.ctx || ''), label: String(r.LABEL || r.label || col), seq: +(r.SEQ || r.seq) || 0 });
        });
        Object.keys(out).forEach(function (k) { out[k].cols = out[k].cols.slice(0, 80); });
        return out;
    };
    /** DFF select list for the spec (keys = which tables) — dates as text; aliases DFF_<A|P|O>_<COLUMN> */
    function dffSelect(spec, keys) {
        var parts = [];
        (keys || []).forEach(function (k) {
            var t = spec && spec[k]; if (!t) return;
            t.cols.forEach(function (c) {
                if (!E.dffColOk(c)) return;
                var ref = E.DFF_TABLES[k].alias + '.' + c.toLowerCase();
                parts.push((/_DATE|_TIMESTAMP/.test(c) ? "TO_CHAR(" + ref + ", 'YYYY-MM-DD')" : ref) + ' AS dff_' + k.toLowerCase() + '_' + c.toLowerCase());
            });
        });
        return parts.length ? ',\n       ' + parts.join(', ') : '';
    }
    /** the whole Fusion customer master, one page at a time (keyset on CUST_ACCOUNT_ID — every page costs the same at any depth);
     *  since = 'YYYY-MM-DD HH24:MI:SS' only reads accounts / parties changed from then (Sync changes); dff = E.dffSpec(...) adds the
     *  account / party / organization DFF columns; account = one account only (the DFF dialog's Read from Fusion).
     *  Alternatives: everything; DFFs without the organization profile; no DFFs (address, e-mail, phone); e-mail + phone; plain. */
    E.sql.customersPage = function (afterId, since, size, dff, account) {
        var n = Math.max(1, Math.min(5000, +size || 1000)), after = digits(afterId || 0);
        var changed = "GREATEST(NVL(ca.last_update_date, DATE '2000-01-01'), NVL(p.last_update_date, DATE '2000-01-01'))";
        var addr = ",\n       (SELECT l.address1 || NVL2(l.city, ', ' || l.city, '') || NVL2(l.country, ', ' || l.country, '')\n" +
            "          FROM hz_cust_acct_sites_all s JOIN hz_party_sites ps ON ps.party_site_id = s.party_site_id JOIN hz_locations l ON l.location_id = ps.location_id\n" +
            "         WHERE s.cust_account_id = ca.cust_account_id AND s.status = 'A' AND ROWNUM = 1) AS bill_to_address";
        var cps = ",\n       (SELECT MAX(cp.email_address) KEEP (DENSE_RANK FIRST ORDER BY DECODE(cp.primary_flag, 'Y', 0, 1)) FROM hz_contact_points cp\n" +
            "         WHERE cp.owner_table_name = 'HZ_PARTIES' AND cp.owner_table_id = p.party_id AND cp.contact_point_type = 'EMAIL' AND cp.status = 'A') AS email,\n" +
            "       (SELECT MAX(NVL2(cp.phone_area_code, cp.phone_area_code || ' ', '') || cp.phone_number) KEEP (DENSE_RANK FIRST ORDER BY DECODE(cp.primary_flag, 'Y', 0, 1)) FROM hz_contact_points cp\n" +
            "         WHERE cp.owner_table_name = 'HZ_PARTIES' AND cp.owner_table_id = p.party_id AND cp.contact_point_type = 'PHONE' AND cp.status = 'A') AS phone";
        var opJoin = "\n  LEFT JOIN hz_organization_profiles op ON op.party_id = p.party_id AND TRUNC(SYSDATE) BETWEEN op.effective_start_date AND op.effective_end_date AND op.effective_latest_change = 'Y'";
        function one(extra, join) {
            return "SELECT ca.cust_account_id, ca.account_number, p.party_name AS customer, p.party_number, ca.account_name, ca.status, ca.customer_type, ca.customer_class_code AS customer_class,\n" +
                "       p.jgzz_fiscal_code AS tax_reference" + extra + ",\n       TO_CHAR(" + changed + ", 'YYYY-MM-DD HH24:MI:SS') AS changed\n" +
                "  FROM hz_cust_accounts ca\n  JOIN hz_parties p ON p.party_id = ca.party_id" + (join || '') +
                (account ? "\n WHERE ca.account_number " + (Array.isArray(account) ? 'IN (' + account.slice(0, 500).map(q).join(', ') + ')' : '= ' + q(account)) : "\n WHERE ca.cust_account_id > " + after +
                    (since && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(since) ? "\n   AND " + changed + " >= TO_DATE('" + since.slice(0, 19) + "', 'YYYY-MM-DD HH24:MI:SS')" : '')) +
                "\n ORDER BY ca.cust_account_id\n FETCH FIRST " + n + " ROWS ONLY";
        }
        var list = [];
        if (dff && dff.O) list.push(one(addr + cps + dffSelect(dff, ['A', 'P', 'O']), opJoin));
        if (dff && (dff.A || dff.P)) list.push(one(addr + cps + dffSelect(dff, ['A', 'P'])), one(addr + cps + dffSelect(dff, ['A'])));
        return list.concat([one(addr + cps), one(cps), one('')]).filter(function (x, i, a) { return a.indexOf(x) === i; });
    };
    /** the label of one DFF column for the row's context (the context's own label, else a global one, else any) */
    E.dffLabel = function (spec, k, col, ctx) {
        var ls = ((spec || {})[k] || { labels: [] }).labels.filter(function (x) { return x.col === col; });
        var own = ls.filter(function (x) { return ctx && x.ctx === ctx; })[0], glob = ls.filter(function (x) { return /^(global|#null|$)/i.test(x.ctx) || /global/i.test(x.ctx); })[0];
        var hit = own || glob || ls[0];
        return { label: hit ? hit.label : col === 'ATTRIBUTE_CATEGORY' ? 'Context' : col, seq: hit ? hit.seq : col === 'ATTRIBUTE_CATEGORY' ? -1 : 999, ctx: hit ? hit.ctx : '' };
    };
    /** the DFF values of a Fusion row → [{t, col, label, value, ctx}] (filled values only), in segment order */
    E.dffValues = function (r, spec) {
        var out = [];
        Object.keys(E.DFF_TABLES).forEach(function (k) {
            var pre = 'DFF_' + k + '_', ctx = '';
            Object.keys(r || {}).forEach(function (key) { if (key.toUpperCase() === pre + 'ATTRIBUTE_CATEGORY') ctx = r[key] == null ? '' : String(r[key]); });
            Object.keys(r || {}).forEach(function (key) {
                var K = key.toUpperCase(); if (K.indexOf(pre) !== 0) return;
                var v = r[key]; if (v == null || String(v).trim() === '') return;
                var col = K.slice(pre.length), l = E.dffLabel(spec, k, col, ctx);
                out.push({ t: k, col: col, label: l.label, value: String(v), ctx: col === 'ATTRIBUTE_CATEGORY' ? '' : ctx, seq: l.seq });
            });
        });
        return out.sort(function (a, b) { return 'APO'.indexOf(a.t) - 'APO'.indexOf(b.t) || a.seq - b.seq; });
    };
    /** a text with one or more phone numbers ("4520202 4525743 / +230 5728 1234") → their digits, one entry per number */
    E.phoneList = function (s) {
        var out = [];
        String(s || '').split(/[,;\/|]+|\s{2,}/).forEach(function (part) {
            var acc = '';
            part.trim().split(/\s+/).forEach(function (tok) {
                var d = tok.replace(/\D/g, ''); if (!d) return;
                if (acc.length >= 7 && (d.length >= 7 || /^\+/.test(tok))) { out.push(acc); acc = ''; }
                acc += d;
            });
            if (acc.length >= 5) out.push(acc);
        });
        return out;
    };
    /** Fusion's contact points are often empty while the e-mail / phone sit in a DFF segment (EMAIL, PHONENO …): the first DFF
     *  value whose label says so and whose value looks like it → {email, emailFrom, phone, phoneFrom} */
    E.dffContact = function (vals) {
        var o = { email: '', emailFrom: '', phone: '', phoneFrom: '' };
        (vals || []).forEach(function (x) {
            if (!o.email && /e-?mail/i.test(x.label) && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(x.value)) { o.email = x.value; o.emailFrom = x.label; }
            if (!o.phone && /phone|mobile|\btel|gsm|contact\s*no|cell/i.test(x.label) && E.phoneList(x.value).length) { o.phone = x.value; o.phoneFrom = x.label; }
        });
        return o;
    };
    /** pack the DFF values into JSON that fits max BYTES (drops the last values rather than cutting the JSON) */
    E.dffPack = function (o, maxBytes) {
        maxBytes = maxBytes || 3900;
        function bytes(t) { return unescape(encodeURIComponent(t)).length; }
        var x = { m: o.m || {}, f: (o.f || []).map(function (v) { return [v.t, v.col, v.label, String(v.value).slice(0, 500), v.ctx || '']; }) };
        var j = JSON.stringify(x);
        while (bytes(j) > maxBytes && x.f.length) { x.f.pop(); x.cut = (x.cut || 0) + 1; j = JSON.stringify(x); }
        return j;
    };
    /** the packed JSON back → {m, f: [{t, col, label, value, ctx}], cut} */
    E.dffUnpack = function (j) {
        if (!j) return { m: {}, f: [] };
        try { var x = typeof j === 'string' ? JSON.parse(j) : j; return { m: x.m || {}, cut: x.cut || 0, f: (x.f || []).map(function (a) { return Array.isArray(a) ? { t: a[0], col: a[1], label: a[2], value: a[3], ctx: a[4] } : a; }) }; } catch (e) { return { m: {}, f: [] }; }
    };
    /** a Fusion master row → the row kept on this PC / in APEX (lower-case columns, digits of every phone, one search text, the DFFs) */
    E.custRow = function (r, pod, spec) {
        var g = function (k) { var v = r[k] != null ? r[k] : r[k.toLowerCase()]; return v == null ? '' : String(v); };
        var o = { pod: pod || '', cust_account_id: g('CUST_ACCOUNT_ID'), account_number: g('ACCOUNT_NUMBER'), customer: g('CUSTOMER'), party_number: g('PARTY_NUMBER'), account_name: g('ACCOUNT_NAME'),
            status: g('STATUS'), customer_type: g('CUSTOMER_TYPE'), customer_class: g('CUSTOMER_CLASS'), tax_reference: g('TAX_REFERENCE'), bill_to_address: g('BILL_TO_ADDRESS'), email: g('EMAIL'), phone: g('PHONE'), changed: g('CHANGED') };
        var vals = E.dffValues(r, spec), packed = g('DFF_JSON'), m = {};
        if (vals.length) {
            var ct = E.dffContact(vals);
            if (!o.email && ct.email) { o.email = ct.email; m.e = ct.emailFrom; }
            if (!o.phone && ct.phone) { o.phone = ct.phone; m.p = ct.phoneFrom; }
            o.dff_json = E.dffPack({ m: m, f: vals });
        } else o.dff_json = packed;
        o.phone_digits = E.phoneList(o.phone).join(' ');
        var dv = E.dffUnpack(o.dff_json).f.map(function (x) { return x.value; }).join(' ');
        o.hay = [o.account_number, o.customer, o.account_name, o.party_number, o.email, o.phone, o.tax_reference, o.bill_to_address, dv].join(' ').toLowerCase();
        return o;
    };
    /** a kept row → the Fusion-style master row the 360 shows (upper-case keys) */
    E.custMaster = function (o) {
        return { ACCOUNT_NUMBER: o.account_number, CUSTOMER: o.customer, PARTY_NUMBER: o.party_number, ACCOUNT_NAME: o.account_name, STATUS: o.status, CUSTOMER_TYPE: o.customer_type, CUSTOMER_CLASS: o.customer_class,
            TAX_REFERENCE: o.tax_reference, BILL_TO_ADDRESS: o.bill_to_address, EMAIL: o.email, PHONE: o.phone, CUST_ACCOUNT_ID: o.cust_account_id, DFF_JSON: o.dff_json || '' };
    };
    /** search words → a WHERE over the kept customers (every word in the search text; 7+ digits also match the phone digits) */
    E.custWhere = function (q, quote) {
        var words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
        if (!words.length) return '';
        return words.map(function (w) {
            var d = w.replace(/\D/g, ''), like = "hay LIKE " + quote('%' + w.replace(/[%_]/g, '') + '%');
            return d.length >= 7 && d.length === w.replace(/[\s+()-]/g, '').length ? '(' + like + ' OR phone_digits LIKE ' + quote('%' + d.slice(-7) + '%') + ')' : like;
        }).join(' AND ');
    };

    // ── AR 360: one picture of a customer's receivables + a rating ──
    function num0(v) { return v == null || v === '' || isNaN(+v) ? 0 : +v; }
    function cls0(r) { var c = String(r.CLASS || '').toUpperCase(); if (c === 'CREDIT MEMO') return 'CM'; if (c === 'INVOICE') return 'INV'; return c || 'INV'; }
    E.isBounced = function (r) { return !!(r.REVERSAL_DATE || /^(NSF|STOP|REV)$/i.test(r.STATUS || '') || /NSF|STOP/i.test(r.REVERSAL_CATEGORY || '')); };
    E.reversalLabel = function (r) { var c = String(r.REVERSAL_CATEGORY || r.STATUS || '').toUpperCase(); return c === 'NSF' ? 'Bounced (insufficient funds)' : c === 'STOP' ? 'Stop payment' : c === 'REV' ? 'Reversed' : c ? c : 'Reversed'; };
    /** {trx, receipts, apps, adjustments, returns, open, creditLimit} → totals, monthly series, rating */
    E.ar360 = function (d, now) {
        d = d || {}; var n = E.parse(now) || new Date(), y1 = new Date(n.getFullYear() - 1, n.getMonth(), n.getDate()), y1s = E.iso(y1);
        var trx = d.trx || [], rc = d.receipts || [], apps = d.apps || [], adj = d.adjustments || [], open = d.open || [];
        var o = { invoiced12: 0, credits12: 0, debit12: 0, collected12: 0, cmApplied12: 0, adjusted12: 0, bounced: [], bouncedAmt: 0, returns: (d.returns || []).length, returnsAmt: 0, months: [] };
        trx.forEach(function (r) { if (String(r.TRX_DATE) < y1s) return; var c = cls0(r), a = num0(r.AMOUNT); if (c === 'CM') o.credits12 += Math.abs(a); else if (c === 'DM') o.debit12 += a; else if (c === 'INV') o.invoiced12 += a; });
        apps.forEach(function (r) { if (String(r.APPLY_DATE) < y1s) return; if (String(r.APP_TYPE).toUpperCase() === 'CM') o.cmApplied12 += num0(r.AMOUNT_APPLIED); else o.collected12 += num0(r.AMOUNT_APPLIED); });
        adj.forEach(function (r) { if (String(r.APPLY_DATE) >= y1s) o.adjusted12 += Math.abs(num0(r.AMOUNT)); });
        rc.forEach(function (r) { if (E.isBounced(r)) { o.bounced.push(r); o.bouncedAmt += num0(r.AMOUNT); } });
        (d.returns || []).forEach(function (r) { o.returnsAmt += Math.abs(num0(r.AMOUNT)); });
        o.bounced12 = o.bounced.filter(function (r) { return String(r.REVERSAL_DATE || r.RECEIPT_DATE) >= y1s; }).length;
        // paying on time: amount-weighted days late / days to pay of cash applications (12 months), and the trend (last 6 months vs the 6 before)
        var w = 0, late = 0, pay = 0, h1 = { w: 0, l: 0 }, h2 = { w: 0, l: 0 }, m6 = E.iso(new Date(n.getFullYear(), n.getMonth() - 6, n.getDate()));
        apps.forEach(function (r) {
            if (String(r.APP_TYPE).toUpperCase() === 'CM' || String(r.APPLY_DATE) < y1s) return;
            var a = Math.abs(num0(r.AMOUNT_APPLIED)), dl = Math.max(0, num0(r.DAYS_LATE)); if (!a) return;
            w += a; late += a * dl; pay += a * Math.max(0, num0(r.DAYS_TO_PAY));
            var hh = String(r.APPLY_DATE) >= m6 ? h1 : h2; hh.w += a; hh.l += a * dl;
        });
        o.daysLate = w ? Math.round(late / w) : null; o.daysToPay = w ? Math.round(pay / w) : null;
        o.trend = h1.w && h2.w ? Math.round(h1.l / h1.w - h2.l / h2.w) : null;
        var bal = 0, over = 0, o90 = 0; open.forEach(function (r) { var a = num0(r.REMAINING), dl = num0(r.DAYS_LATE); bal += a; if (dl > 0 && a > 0) over += a; if (dl > 90 && a > 0) o90 += a; });
        o.balance = bal; o.overdue = over; o.over90 = o90;
        // months: invoiced, credit notes, collected (24)
        var by = {};
        for (var i = 23; i >= 0; i--) { var dd = new Date(n.getFullYear(), n.getMonth() - i, 1), k = dd.getFullYear() + '-' + pad(dd.getMonth() + 1); by[k] = { month: k, invoiced: 0, credits: 0, collected: 0, bounced: 0 }; o.months.push(by[k]); }
        trx.forEach(function (r) { var x = by[String(r.TRX_DATE).slice(0, 7)]; if (!x) return; var c = cls0(r); if (c === 'CM') x.credits += Math.abs(num0(r.AMOUNT)); else if (c !== 'DEP' && c !== 'GUAR') x.invoiced += num0(r.AMOUNT); });
        apps.forEach(function (r) { var x = by[String(r.APPLY_DATE).slice(0, 7)]; if (x && String(r.APP_TYPE).toUpperCase() !== 'CM') x.collected += num0(r.AMOUNT_APPLIED); });
        o.bounced.forEach(function (r) { var x = by[String(r.REVERSAL_DATE || r.RECEIPT_DATE).slice(0, 7)]; if (x) x.bounced++; });
        o.rating = E.arRating({ invoiced: o.invoiced12, collected: o.collected12, credits: o.credits12 + o.adjusted12, daysLate: o.daysLate, trend: o.trend, balance: bal, overdue: over, over90: o90, bounced: o.bounced12, creditLimit: num0(d.creditLimit) });
        return o;
    };
    E.GRADES = [{ g: 'A', min: 85, cls: 'ok', text: 'Excellent payer', action: 'Keep the terms; can be offered more credit.' }, { g: 'B', min: 70, cls: 'ok', text: 'Good payer', action: 'Normal follow-up.' },
        { g: 'C', min: 55, cls: 'warn', text: 'Fair', action: 'Watch the overdue items; call before due dates.' }, { g: 'D', min: 40, cls: 'bad', text: 'Weak', action: 'Collect the overdue before new credit; consider a credit hold.' },
        { g: 'E', min: 0, cls: 'bad', text: 'High risk', action: 'Cash / guaranteed payment only; escalate to credit control.' }];
    /** 0–100 from weighted factors → {score, grade, factors [{name, weight, score, text}]} */
    E.arRating = function (x) {
        x = Object.assign({}, x || {}); var f = [];
        ['invoiced', 'collected', 'credits', 'balance', 'overdue', 'over90', 'bounced', 'creditLimit'].forEach(function (k) { x[k] = num0(x[k]); });
        function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }
        f.push({ name: 'Paying on time', weight: 30, score: x.daysLate == null ? 50 : clamp(100 - x.daysLate * 2.5), text: x.daysLate == null ? 'no payments in 12 months' : 'paid ' + x.daysLate + ' days after the due date on average (amount-weighted)' });
        var ovs = x.balance > 0 ? x.overdue / x.balance : 0, o9 = x.balance > 0 ? x.over90 / x.balance : 0;
        f.push({ name: 'Overdue now', weight: 20, score: clamp(100 - (ovs + 2 * o9) * 100), text: Math.round(ovs * 100) + ' % of the balance overdue, ' + Math.round(o9 * 100) + ' % over 90 days' });
        var cr = x.invoiced > 0 ? x.collected / x.invoiced : null;
        f.push({ name: 'Collected vs invoiced (12 months)', weight: 15, score: cr == null ? 50 : clamp(cr * 100), text: cr == null ? 'nothing invoiced' : Math.round(cr * 100) + ' % of what was invoiced was collected' });
        var cp = x.invoiced > 0 ? x.credits / x.invoiced : 0;
        f.push({ name: 'Credit notes & adjustments', weight: 15, score: clamp(100 - Math.max(0, cp - 0.02) / 0.18 * 100), text: Math.round(cp * 1000) / 10 + ' % of invoicing given back' });
        f.push({ name: 'Bounced cheques (12 months)', weight: 10, score: [100, 60, 30][x.bounced] != null ? [100, 60, 30][x.bounced] : 0, text: (x.bounced || 0) + ' bounced / reversed' });
        f.push({ name: 'Trend', weight: 10, score: x.trend == null ? 50 : clamp(100 - Math.max(0, x.trend) / 15 * 100), text: x.trend == null ? 'not enough payments' : x.trend > 0 ? 'paying ' + x.trend + ' days later than 6 months before' : x.trend < 0 ? 'paying ' + (-x.trend) + ' days sooner than 6 months before' : 'steady' });
        if (x.creditLimit > 0) { var use = x.balance / x.creditLimit; f.forEach(function (y) { y.weight = Math.round(y.weight * 0.9); }); f.push({ name: 'Credit limit use', weight: 10, score: clamp(100 - Math.max(0, use - 0.7) / 0.5 * 100), text: Math.round(use * 100) + ' % of the credit limit used' }); }
        var tw = f.reduce(function (s, y) { return s + y.weight; }, 0), score = Math.round(f.reduce(function (s, y) { return s + y.weight * y.score; }, 0) / tw);
        var g = E.GRADES.filter(function (y) { return score >= y.min; })[0];
        return { score: score, grade: g.g, cls: g.cls, text: g.text, action: g.action, factors: f };
    };

    /** a safe item DFF column name (ATTRIBUTE1 … ATTRIBUTE30, ATTRIBUTE_CHAR1 …) or '' */
    E.dffCol = function (v) { v = String(v || '').trim().toUpperCase(); return /^ATTRIBUTE(_CHAR)?\d{1,2}$/.test(v) ? v : ''; };
    /** how the Items tab can group what the customer buys */
    E.ITEM_DIMS = {
        PROFIT_CENTER: { field: 'profitCenter', col: 'PROFIT_CENTER', label: 'Profit centre', plural: 'Profit centres', none: '(no profit centre)', icon: 'fa-building' },
        SUPPLIER: { field: 'supplier', col: 'SUPPLIER', label: 'Supplier', plural: 'Suppliers', none: '(no supplier)', icon: 'fa-truck-field' },
        CATEGORY: { field: 'category', col: 'CATEGORY', label: 'Catalog category', plural: 'Catalog categories', none: '(no category)', icon: 'fa-layer-group' }
    };
    /** what the customer bought, per month × item, 24 months (sales order lines, not cancelled) with the item's profit centre and
     *  supplier from the item DFF (EGP_SYSTEM_ITEMS_B ATTRIBUTE1 / ATTRIBUTE2 by default — `dff` = setup.itemDff) and the catalog category.
     *  Alternatives: everything; without the catalog; without the description; without the DFF; plain. */
    E.sql.salesItems = function (acct, bu, months, dff) {
        var m = Math.max(3, Math.min(60, +months || 24)); dff = dff || E.DEFAULTS.itemDff;
        var pc = E.dffCol(dff.profitCenter), su = E.dffCol(dff.supplier);
        var desc = "(SELECT MAX(tl.description) FROM egp_system_items_tl tl WHERE tl.inventory_item_id = fl.inventory_item_id AND tl.organization_id = fl.fulfill_org_id AND tl.language = USERENV('LANG'))";
        var catTl = "(SELECT MIN(ct.category_name) FROM egp_item_categories ic JOIN egp_categories_tl ct ON ct.category_id = ic.category_id AND ct.language = USERENV('LANG')\n" +
            "          WHERE ic.inventory_item_id = fl.inventory_item_id AND ic.organization_id = fl.fulfill_org_id)";
        var dffCols = function (on) { return "MAX(" + (on && pc ? 'i.' + pc.toLowerCase() : "''") + ") AS profit_center, MAX(" + (on && su ? 'i.' + su.toLowerCase() : "''") + ") AS supplier"; };
        function one(d, c, useDff) {
            return "SELECT TO_CHAR(h.ordered_date, 'YYYY-MM') AS month, i.item_number AS item, MAX(" + d + ") AS description, " + dffCols(useDff) + ", MAX(" + c + ") AS category,\n" +
                "       SUM(fl.ordered_qty) AS qty, MAX(fl.ordered_uom) AS uom, SUM(fl.extended_amount) AS amount, COUNT(DISTINCT h.header_id) AS orders, MAX(fl.inventory_item_id) AS inventory_item_id\n" +
                "  FROM doo_fulfill_lines_all fl\n  JOIN doo_headers_all h ON h.header_id = fl.header_id\n  JOIN hz_cust_accounts ca ON ca.party_id = h.sold_to_party_id\n" +
                "  LEFT JOIN egp_system_items_b i ON i.inventory_item_id = fl.inventory_item_id AND i.organization_id = fl.fulfill_org_id\n" +
                " WHERE ca.account_number = " + q(acct) + " AND h.ordered_date >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -" + (m - 1) + ")\n" +
                "   AND NVL(fl.status_code, 'X') NOT IN ('CANCELED', 'CANCELLED') AND " + LATEST_ORDER + "\n" +
                " GROUP BY TO_CHAR(h.ordered_date, 'YYYY-MM'), i.item_number\n ORDER BY 1, 2\n FETCH FIRST 8000 ROWS ONLY";
        }
        var list = [one(desc, catTl, true), one(desc, "''", true), one('i.item_number', "''", true), one(desc, catTl, false), one('i.item_number', "''", false)];
        return list.filter(function (x, i) { return list.indexOf(x) === i; });
    };
    function trendOf(now, prev, monthsNow, last3) {
        if (!prev && now) return 'NEW';
        if (prev && !now) return 'STOPPED';
        if (prev && now && !last3) return 'SLOWING';
        if (!prev) return 'NONE';
        var ch = (now - prev) / Math.abs(prev);
        return ch >= 0.2 ? 'GROWING' : ch <= -0.2 ? 'DECLINING' : 'STEADY';
    }
    E.TRENDS = { NEW: ['new', 'info'], STOPPED: ['stopped', 'bad'], SLOWING: ['not in 3 months', 'warn'], GROWING: ['growing', 'ok'], DECLINING: ['declining', 'warn'], STEADY: ['steady', 'muted'], NONE: ['—', 'muted'] };
    /** month × item rows → {months[24], items, categories (with series), totals, insights} — the last 12 months vs the 12 before */
    E.itemTrends = function (rows, now, dim) {
        var D = E.ITEM_DIMS[dim] || E.ITEM_DIMS.PROFIT_CENTER;
        var n = E.parse(now) || new Date(), months = [];
        for (var i = 23; i >= 0; i--) { var d = new Date(n.getFullYear(), n.getMonth() - i, 1); months.push(d.getFullYear() + '-' + pad(d.getMonth() + 1)); }
        var idx = {}; months.forEach(function (m, i2) { idx[m] = i2; });
        var items = {}, cats = {};
        function bucket(map, key, extra) {
            var x = map[key]; if (!x) { x = map[key] = Object.assign({ key: key, series: months.map(function () { return 0; }), qtyS: months.map(function () { return 0; }), now: 0, prev: 0, qtyNow: 0, qtyPrev: 0, orders: 0, first: '', last: '' }, extra || {}); }
            return x;
        }
        (rows || []).forEach(function (r) {
            var mi = idx[r.MONTH]; if (mi == null) return;
            var amt = +r.AMOUNT || 0, qty = +r.QTY || 0, key = r.ITEM || '(no item)', cat = String(r[D.col] || '').trim() || D.none;
            var it = bucket(items, key, { item: key, description: r.DESCRIPTION || '', group: cat, profitCenter: r.PROFIT_CENTER || '', supplier: r.SUPPLIER || '', category: r.CATEGORY || '', uom: r.UOM || '', id: r.INVENTORY_ITEM_ID });
            if (r.DESCRIPTION && !it.description) it.description = r.DESCRIPTION;
            ['profitCenter', 'supplier', 'category'].forEach(function (f) { var v = r[{ profitCenter: 'PROFIT_CENTER', supplier: 'SUPPLIER', category: 'CATEGORY' }[f]]; if (v && !it[f]) it[f] = v; });
            var c = bucket(cats, cat, { category: cat, items: {} });
            [it, c].forEach(function (x) {
                x.series[mi] += amt; x.qtyS[mi] += qty;
                if (mi >= 12) { x.now += amt; x.qtyNow += qty; } else { x.prev += amt; x.qtyPrev += qty; }
                x.orders += +r.ORDERS || 0;
                if (!x.first || r.MONTH < x.first) x.first = r.MONTH; if (!x.last || r.MONTH > x.last) x.last = r.MONTH;
            });
            c.items[key] = 1;
        });
        var tot = { now: 0, prev: 0 }, totS = months.map(function () { return 0; });
        Object.keys(cats).forEach(function (k) { tot.now += cats[k].now; tot.prev += cats[k].prev; cats[k].series.forEach(function (v, i3) { totS[i3] += v; }); });
        function finish(x) {
            x.change = x.prev ? Math.round((x.now - x.prev) / Math.abs(x.prev) * 1000) / 10 : null;
            x.shareNow = tot.now ? Math.round(x.now / tot.now * 1000) / 10 : 0;
            x.sharePrev = tot.prev ? Math.round(x.prev / tot.prev * 1000) / 10 : 0;
            x.shareDelta = Math.round((x.shareNow - x.sharePrev) * 10) / 10;
            x.monthsBought = x.series.slice(12).filter(function (v) { return v; }).length;
            x.trend = trendOf(Math.round(x.now * 100), Math.round(x.prev * 100), x.monthsBought, x.series.slice(21).some(function (v) { return v; }));
            return x;
        }
        var itemList = Object.keys(items).map(function (k) { return finish(items[k]); }).sort(function (a, b) { return b.now - a.now || b.prev - a.prev; });
        var catList = Object.keys(cats).map(function (k) { var c = finish(cats[k]); c.itemCount = Object.keys(c.items).length; delete c.items; return c; }).sort(function (a, b) { return b.now - a.now || b.prev - a.prev; });
        itemList.forEach(function (x, i4) { x.rank = i4 + 1; });
        var o = { dim: D, filled: catList.filter(function (x) { return x.category !== D.none; }).length, months: months, items: itemList, categories: catList, total: { now: Math.round(tot.now * 100) / 100, prev: Math.round(tot.prev * 100) / 100, change: tot.prev ? Math.round((tot.now - tot.prev) / Math.abs(tot.prev) * 1000) / 10 : null, series: totS } };
        o.counts = { items: itemList.filter(function (x) { return x.now; }).length, itemsPrev: itemList.filter(function (x) { return x.prev; }).length, categories: catList.filter(function (x) { return x.now; }).length,
            NEW: itemList.filter(function (x) { return x.trend === 'NEW'; }).length, STOPPED: itemList.filter(function (x) { return x.trend === 'STOPPED'; }).length,
            GROWING: itemList.filter(function (x) { return x.trend === 'GROWING'; }).length, DECLINING: itemList.filter(function (x) { return x.trend === 'DECLINING'; }).length, SLOWING: itemList.filter(function (x) { return x.trend === 'SLOWING'; }).length };
        o.insights = E.itemInsights(o);
        return o;
    };
    function fmt0(v) { return Math.round(v || 0).toLocaleString('en-US'); }
    /** plain-words findings about the customer's buying */
    E.itemInsights = function (o) {
        var out = [], t = o.total, c = o.categories, it = o.items;
        if (!t.now && !t.prev) return out;
        if (t.change != null) out.push({ cls: t.change >= 0 ? 'ok' : t.change <= -15 ? 'bad' : 'warn', text: 'Buying ' + (t.change >= 0 ? 'up ' : 'down ') + Math.abs(t.change) + ' % on the year before (' + fmt0(t.now) + ' vs ' + fmt0(t.prev) + ').' });
        else if (t.now) out.push({ cls: 'info', text: 'A new customer in the last 12 months: ' + fmt0(t.now) + ' bought.' });
        if (c[0] && c[0].now) out.push({ cls: 'info', text: c[0].category + ' is ' + c[0].shareNow + ' % of what they buy' + (c.length > 1 && c[1].now ? ', then ' + c[1].category + ' (' + c[1].shareNow + ' %)' : '') + '.' });
        var shifts = c.filter(function (x) { return Math.abs(x.shareDelta) >= 5 && (x.now || x.prev); }).sort(function (a, b) { return Math.abs(b.shareDelta) - Math.abs(a.shareDelta); }).slice(0, 3);
        shifts.forEach(function (x) { out.push({ cls: x.shareDelta > 0 ? 'ok' : 'warn', text: 'Mix shift: ' + x.category + ' ' + (x.shareDelta > 0 ? 'up ' : 'down ') + Math.abs(x.shareDelta) + ' points of their buying (' + x.sharePrev + ' % → ' + x.shareNow + ' %).' }); });
        c.filter(function (x) { return x.trend === 'STOPPED' && x.prev > t.prev * 0.03; }).slice(0, 2).forEach(function (x) { out.push({ cls: 'bad', text: 'Stopped buying ' + x.category + ' (' + fmt0(x.prev) + ' the year before, last in ' + x.last + ').' }); });
        c.filter(function (x) { return x.trend === 'NEW' && x.now > t.now * 0.03; }).slice(0, 2).forEach(function (x) { out.push({ cls: 'ok', text: 'Started buying ' + x.category + ' (' + fmt0(x.now) + ' since ' + x.first + ').' }); });
        var lost = it.filter(function (x) { return (x.trend === 'STOPPED' || x.trend === 'SLOWING') && x.prev; }).sort(function (a, b) { return b.prev - a.prev; }).slice(0, 3);
        if (lost.length) out.push({ cls: 'warn', text: 'Not bought lately: ' + lost.map(function (x) { return x.item + (x.description ? ' (' + x.description + ')' : '') + ' — last ' + x.last; }).join('; ') + '.' });
        var down = it.filter(function (x) { return x.trend === 'DECLINING'; }).sort(function (a, b) { return (a.now - a.prev) - (b.now - b.prev); }).slice(0, 3);
        if (down.length) out.push({ cls: 'warn', text: 'Biggest drops: ' + down.map(function (x) { return x.item + ' ' + x.change + ' %'; }).join(', ') + '.' });
        var up = it.filter(function (x) { return x.trend === 'GROWING' || x.trend === 'NEW'; }).sort(function (a, b) { return (b.now - b.prev) - (a.now - a.prev); }).slice(0, 3);
        if (up.length) out.push({ cls: 'ok', text: 'Biggest gains: ' + up.map(function (x) { return x.item + (x.change == null ? ' (new)' : ' +' + x.change + ' %'); }).join(', ') + '.' });
        var top = it.slice(0, 5).reduce(function (s, x) { return s + x.now; }, 0);
        if (t.now && it.length > 5) out.push({ cls: 'info', text: 'Top 5 items = ' + Math.round(top / t.now * 100) + ' % of the last 12 months, from ' + o.counts.items + ' items bought.' });
        var gap = o.total.series.slice(21).every(function (v) { return !v; });
        if (gap && t.now) out.push({ cls: 'bad', text: 'Nothing ordered in the last 3 months.' });
        return out;
    };

    /** the CRM's drill-downs: what a customer-service person needs, NO subledger accounting tables (XLA events / journals are
     *  huge — they made each drill take minutes). Parts run at the same time; placeholders are filled by DCE.drillSql. */
    E.DRILLS = {
        TRX: { title: 'AR transaction', parts: [
            { id: 'hd', title: 'Transaction', sql: "SELECT t.trx_number, TO_CHAR(t.trx_date, 'YYYY-MM-DD') AS trx_date, tt.name AS trx_type, tt.type AS class, ca.account_number, p.party_name AS customer,\n" +
                "       t.invoice_currency_code AS currency, ps.amount_due_original AS amount, ps.amount_due_remaining AS remaining, TO_CHAR(ps.due_date, 'YYYY-MM-DD') AS due_date,\n" +
                "       ps.status, t.purchase_order AS customer_po, t.ct_reference AS reference, t.complete_flag, t.customer_trx_id\n" +
                "  FROM ra_customer_trx_all t\n  LEFT JOIN ra_cust_trx_types_all tt ON tt.cust_trx_type_seq_id = t.cust_trx_type_seq_id\n" +
                "  LEFT JOIN ar_payment_schedules_all ps ON ps.customer_trx_id = t.customer_trx_id\n" +
                "  LEFT JOIN hz_cust_accounts ca ON ca.cust_account_id = t.bill_to_customer_id\n  LEFT JOIN hz_parties p ON p.party_id = ca.party_id\n WHERE t.customer_trx_id = {TRX_ID}" },
            { id: 'ln', title: 'Lines', sql: "SELECT l.line_number AS line, l.line_type, l.description, l.quantity_invoiced AS qty, l.unit_selling_price AS price, l.extended_amount AS amount,\n" +
                "       l.sales_order AS order_number, l.sales_order_line AS order_line\n  FROM ra_customer_trx_lines_all l\n WHERE l.customer_trx_id = {TRX_ID} AND l.line_type = 'LINE'\n ORDER BY l.line_number" },
            { id: 'pay', title: 'Receipts & credit notes applied to it', sql: "SELECT ra.application_type AS app_type, TO_CHAR(ra.apply_date, 'YYYY-MM-DD') AS apply_date, cr.receipt_number, cm.trx_number AS credit_memo, ra.amount_applied, ra.status,\n" +
                "       ra.cash_receipt_id, ra.customer_trx_id AS cm_trx_id\n  FROM ar_receivable_applications_all ra\n  LEFT JOIN ar_cash_receipts_all cr ON cr.cash_receipt_id = ra.cash_receipt_id\n" +
                "  LEFT JOIN ra_customer_trx_all cm ON cm.customer_trx_id = ra.customer_trx_id\n WHERE ra.applied_customer_trx_id = {TRX_ID} AND ra.status = 'APP' AND NVL(ra.display, 'Y') = 'Y'\n ORDER BY ra.apply_date" },
            { id: 'adj', title: 'Adjustments', sql: "SELECT adj.adjustment_number, TO_CHAR(adj.apply_date, 'YYYY-MM-DD') AS apply_date, adj.amount, adj.type AS adj_type, adj.reason_code AS reason, adj.status\n" +
                "  FROM ar_adjustments_all adj\n WHERE adj.customer_trx_id = {TRX_ID}\n ORDER BY adj.apply_date" }
        ] },
        RECEIPT: { title: 'Receipt', parts: [
            { id: 'hd', title: 'Receipt', sql: "SELECT cr.receipt_number, TO_CHAR(cr.receipt_date, 'YYYY-MM-DD') AS receipt_date, cr.amount, cr.currency_code AS currency, cr.status, cr.type AS receipt_type,\n" +
                "       (SELECT rm.name FROM ar_receipt_methods rm WHERE rm.receipt_method_id = cr.receipt_method_id) AS method, ca.account_number, p.party_name AS customer,\n" +
                "       TO_CHAR(cr.reversal_date, 'YYYY-MM-DD') AS reversal_date, cr.reversal_category, cr.comments, cr.cash_receipt_id\n" +
                "  FROM ar_cash_receipts_all cr\n  LEFT JOIN hz_cust_accounts ca ON ca.cust_account_id = cr.pay_from_customer\n  LEFT JOIN hz_parties p ON p.party_id = ca.party_id\n WHERE cr.cash_receipt_id = {RECEIPT_ID}" },
            { id: 'ap', title: 'What it paid', sql: "SELECT ra.status, TO_CHAR(ra.apply_date, 'YYYY-MM-DD') AS apply_date, t.trx_number, TO_CHAR(t.trx_date, 'YYYY-MM-DD') AS trx_date, ca.account_number, ra.amount_applied, t.customer_trx_id\n" +
                "  FROM ar_receivable_applications_all ra\n  LEFT JOIN ra_customer_trx_all t ON t.customer_trx_id = ra.applied_customer_trx_id\n  LEFT JOIN hz_cust_accounts ca ON ca.cust_account_id = t.bill_to_customer_id\n" +
                " WHERE ra.cash_receipt_id = {RECEIPT_ID} AND NVL(ra.display, 'Y') = 'Y'\n ORDER BY ra.apply_date" },
            { id: 'rv', title: 'History (cleared, reversed, bounced)', sql: "SELECT h.status, TO_CHAR(h.trx_date, 'YYYY-MM-DD') AS trx_date, TO_CHAR(h.gl_date, 'YYYY-MM-DD') AS gl_date, h.amount, h.current_record_flag\n" +
                "  FROM ar_cash_receipt_history_all h\n WHERE h.cash_receipt_id = {RECEIPT_ID}\n ORDER BY h.cash_receipt_history_id" }
        ] },
        ORDER: { title: 'Sales order', parts: [
            { id: 'om', title: 'Order lines', sql: "SELECT fl.fulfill_line_number AS line, i.item_number AS item, fl.ordered_qty, fl.shipped_qty, fl.ordered_uom AS uom, fl.status_code AS status,\n" +
                "       TO_CHAR(fl.actual_ship_date, 'YYYY-MM-DD') AS shipped, fl.unit_selling_price AS price, fl.extended_amount AS amount\n" +
                "  FROM doo_fulfill_lines_all fl\n  JOIN doo_headers_all h ON h.header_id = fl.header_id\n" +
                "  LEFT JOIN egp_system_items_b i ON i.inventory_item_id = fl.inventory_item_id AND i.organization_id = fl.fulfill_org_id\n" +
                " WHERE h.order_number = '{ORDER_NUMBER}' AND h.change_version_number = (SELECT MAX(x.change_version_number) FROM doo_headers_all x WHERE x.order_number = h.order_number)\n ORDER BY fl.fulfill_line_number" },
            { id: 'ar', title: 'Invoices of the order', sql: "SELECT t.trx_number, TO_CHAR(t.trx_date, 'YYYY-MM-DD') AS trx_date, tt.name AS trx_type, COUNT(*) AS lines, SUM(l.extended_amount) AS amount, t.customer_trx_id\n" +
                "  FROM ra_customer_trx_lines_all l\n  JOIN ra_customer_trx_all t ON t.customer_trx_id = l.customer_trx_id\n" +
                "  LEFT JOIN ra_cust_trx_types_all tt ON tt.cust_trx_type_seq_id = t.cust_trx_type_seq_id\n" +
                " WHERE l.sales_order = '{ORDER_NUMBER}' AND l.line_type = 'LINE'\n GROUP BY t.trx_number, t.trx_date, tt.name, t.customer_trx_id\n ORDER BY t.trx_date" }
        ] }
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
