/* Customer CRM · the page shell (window.CRM): state, UI helpers, data loading, the ask bar, Today, Customers, Insights.
 * Customer 360 = crm-c360.js, tickets = crm-tickets.js, the softphone + calls = crm-phone.js, e-mail + statements = crm-mail.js,
 * Setup = crm-setup.js, the Autopilot (AI Agent embedded, module=crm) = crm-autopilot.js.
 * Engine: crm-engine.js (CRME). APEX + DuckDB: crm-store.js (CRMS) on the Debtors store (DCS); statements come from Debtors
 * Control (DCE / DCS, the same records — a statement sent here shows in Debtors and the other way round). */
(function () {
    'use strict';
    var E = window.CRME, S = window.CRMS, D = window.DCS, DE = window.DCE;
    var esc = E.esc, money = E.money;
    function $(id) { return document.getElementById(id); }
    function ls(k, d) { try { var v = localStorage.getItem('crm.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem('crm.' + k, JSON.stringify(v)); } catch (e) { } }
    function errText(e) { return String(e && e.message || e || 'error'); }
    function today() { return E.iso(new Date()); }
    function addDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return E.iso(d); }

    var C = window.CRM = {
        E: E, S: S, D: D, DE: DE, esc: esc, money: money, ls: ls, lsSet: lsSet, errText: errText, today: today, addDays: addDays,
        tab: ls('tab', 'today'), pod: ls('pod', D.loginPod()), setup: E.setup(null), bus: [], buId: ls('bu', ''),
        tickets: [], calls: [], msgs: [], cards: {}, contacts: [], load: {}, master: {}, model: null, learn: [],
        info: null, mail: null, ready: false, views: {}, after: {}, ACT: {}, IN: {}, CH: {}, cust: null,
        tk: { f: ls('tk.f', { scope: 'open', view: 'list', queue: '', priority: '', q: '' }) },
        cl: { f: ls('cl.f', { days: 7, dir: '', outcome: '', q: '' }) },
        ml: { f: { days: 30, q: '' } }
    };
    C.me = function () { return D.user(); };
    C.isAdmin = function () { try { var t = (localStorage.getItem('userType') || '').toUpperCase(); return !t || t === 'ADMIN' || t === 'FINANCE' || t === 'CRM'; } catch (e) { return true; } };

    // ── UI helpers ──────────────────────────────────────────────────
    C.toast = function (msg, kind, ms) { var t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, ms || 3500); };
    var busyN = 0;
    C.busy = function (label) {
        var b = $('busy'); busyN++; b.className = 'hb on'; b.innerHTML = '<span class="spin"></span><span class="lbl">' + esc(label) + '</span>';
        return function () { busyN = Math.max(0, busyN - 1); if (!busyN) b.className = 'hb'; };
    };
    C.modal = function (title, body, foot, wide) {
        var m = $('modal'), b = $('mbox');
        b.className = 'mbox' + (wide ? ' wide' : '');
        b.innerHTML = '<div class="mh">' + title + '<span class="sp"></span><button class="btn ghost sm" data-act="mclose"><i class="fas fa-xmark"></i></button></div><div class="mb">' + body + '</div>' + (foot ? '<div class="mf">' + foot + '</div>' : '');
        m.className = 'modal on';
        return b;
    };
    C.mclose = function () { $('modal').className = 'modal'; $('mbox').innerHTML = ''; };
    C.drawer = function (html) { $('dbox').innerHTML = html; $('drawer').className = 'drawer on'; };
    C.dclose = function () { $('drawer').className = 'drawer'; $('dbox').innerHTML = ''; C.openTicket = null; };
    C.pill = function (text, cls, title) { return '<span class="pill ' + (cls || '') + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + text + '</span>'; };
    C.when = function (s) { return s ? '<span title="' + esc(s) + '">' + esc(E.ago(s)) + '</span>' : ''; };
    C.kpi = function (l, v, s, cls, act, extra) { return '<div class="kpi ' + (cls || '') + (act ? ' click' : '') + '"' + (act ? ' data-act="' + act + '"' + (extra || '') : '') + '><div class="l">' + esc(l) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s || '') + '</div></div>'; };
    C.color = function (s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return 'hsl(' + h + ',55%,45%)'; };
    C.avatar = function (name, lg) { return '<span class="av' + (lg ? ' lg' : '') + '" style="background:' + C.color(name) + '">' + esc(E.initials(name)) + '</span>'; };
    C.csv = function (name, cols, rows) {
        var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var text = '﻿' + cols.map(function (c) { return q(c[1]); }).join(',') + '\r\n' + rows.map(function (r) { return cols.map(function (c) { return q(typeof c[0] === 'function' ? c[0](r) : r[c[0]]); }).join(','); }).join('\r\n');
        if (D.hasHost()) return D.host('saveFileAs', { fileName: name, base64: btoa(unescape(encodeURIComponent(text))), filter: 'CSV file (*.csv)|*.csv', title: 'Save ' + name }, 600000).then(function (r) { if (r && r.ok && r.path) C.toast('Saved · ' + r.path, 'ok', 5000); }).catch(function (e) { C.toast(errText(e), 'bad'); });
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click();
    };
    /** a plain table: cols = [[key | fn, label, cls]] */
    C.table = function (cols, rows, opts) {
        opts = opts || {};
        if (!rows.length) return '<div class="empty">' + esc(opts.empty || 'Nothing to show.') + '</div>';
        return '<div class="tblw"' + (opts.max ? ' style="max-height:' + opts.max + '"' : '') + '><table class="tbl"><thead><tr>' + cols.map(function (c) { return '<th class="' + (c[2] || '') + '">' + esc(c[1]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
            rows.slice(0, opts.limit || 1000).map(function (r, i) {
                return '<tr' + (opts.rowAct ? ' class="click" data-act="' + opts.rowAct + '" data-i="' + i + '"' + (opts.rowData ? ' ' + opts.rowData(r) : '') : '') + '>' + cols.map(function (c) {
                    var v = typeof c[0] === 'function' ? c[0](r, i) : esc(r[c[0]]);
                    return '<td class="' + (c[2] || '') + '">' + (v == null ? '' : v) + '</td>';
                }).join('') + '</tr>';
            }).join('') + '</tbody>' + (opts.foot ? '<tfoot>' + opts.foot + '</tfoot>' : '') + '</table></div>' + (rows.length > (opts.limit || 1000) ? '<div class="pager">first ' + (opts.limit || 1000) + ' of ' + rows.length + '</div>' : '');
    };

    // ── business units (from Debtors Control) ──────────────────────
    C.bu = function (id) { return C.bus.filter(function (b) { return b.id === id; })[0] || null; };
    C.curBu = function () { return C.bu(C.buId) || C.bus.filter(function (b) { return b.active !== 'N'; })[0] || C.bus[0] || null; };
    /** the BU a customer belongs to: its Debtors card, a ticket, a statement, else the default */
    C.buOf = function (account) {
        var hit = Object.keys(C.cards).filter(function (k) { return k.split('|')[1] === String(account); })[0];
        if (hit) return hit.split('|')[0];
        var t = C.tickets.filter(function (x) { return x.ACCOUNT_NUMBER === String(account) && x.BU_ID; })[0];
        return t ? t.BU_ID : (C.curBu() || {}).id || '';
    };

    // ── Fusion: the first SQL alternative the pod accepts ───────────
    /** runs the first alternative the pod accepts; a failure carries every SQL tried (e.sql = the last, e.tried = [{sql, error}]) so the page can show it */
    C.fusionFirst = function (list, limit, timeoutMs) {
        var i = 0, last = null, tried = [];
        function fail(e) {
            var err = e instanceof Error ? e : new Error(errText(e));
            err.sql = tried.length ? tried[tried.length - 1].sql : ''; err.tried = tried.slice();
            return err;
        }
        function next() {
            if (i >= list.length) return Promise.reject(fail(last || new Error('No query to run')));
            var sql = list[i++];
            return D.fusionSql(sql, limit || 5000, timeoutMs).then(function (rows) { return { rows: rows, sql: sql, tried: tried.length }; }, function (e) {
                last = e; tried.push({ sql: sql, error: errText(e) });
                if (/timeout|timed out|did not answer/i.test(errText(e))) throw fail(e);
                return next();
            });
        }
        return next();
    };

    // ── data ─────────────────────────────────────────────────────────
    C.loadSetup = function () {
        return Promise.all([S.settings.get('SETUP').catch(function () { return null; }), D.settings.get('BUS').catch(function () { return null; }), D.cust.list().catch(function () { return []; })]).then(function (r) {
            C.setup = E.setup(r[0]);
            C.bus = r[1] && r[1].length ? r[1] : JSON.parse(JSON.stringify(DE.SEED_BUS));
            C.cards = {}; r[2].forEach(function (c) { C.cards[c.BU_ID + '|' + c.ACCOUNT_NUMBER] = c; });
            if (!C.bu(C.buId)) C.buId = (C.curBu() || {}).id || '';
        });
    };
    /** tickets (open + the last 90 days), calls and e-mails (30 days), CRM contacts, agent load */
    C.loadCore = function () {
        return Promise.all([S.tickets.list({ since: addDays(-90) }), S.calls.list({ since: addDays(-30) }), S.messages.list({ since: addDays(-30) }), S.contacts.list().catch(function () { return []; }), S.tickets.load().catch(function () { return {}; })]).then(function (r) {
            C.tickets = r[0]; C.calls = r[1]; C.msgs = r[2]; C.contacts = r[3]; C.load = r[4];
            C.ready = true; C.badges();
            if (C.triage) C.triage();
        });
    };
    /** this PC's copy of Fusion customer master (Debtors + CRM 360) → C.master[account] */
    C.loadMaster = function () {
        var L = S.duck.lit;
        return S.duck.qs(['SELECT account, json FROM w2_dc_master WHERE pod = ' + L(C.pod), "SELECT account, bu, json FROM w2_crm_c360 WHERE section = 'master' AND pod = " + L(C.pod), 'SELECT phone, bu, account, name, contact, source FROM w2_crm_phone']).then(function (r) {
            r[0].concat(r[1]).forEach(function (x) { try { var j = JSON.parse(x.json); j = Array.isArray(j) ? j[0] : j; if (j) C.master[x.account] = j; } catch (e) { } });
            C.phoneKept = r[2] || [];
        });
    };
    C.refresh = function () {
        var end = C.busy('Reading APEX…');
        return C.loadCore().then(function () { end(); C.render(); }, function (e) { end(); C.toast(errText(e), 'bad', 8000); C.render(); });
    };
    C.badges = function () {
        var k = E.ticketKpis(C.tickets, new Date(), C.me());
        $('n-tickets').textContent = k.breached ? k.breached : '';
        var cb = C.calls.filter(function (c) { return c.CALLBACK_AT && c.CALLBACK_DONE !== 'Y' && c.CALLBACK_AT.slice(0, 10) <= today(); }).length;
        $('n-calls').textContent = cb ? cb : '';
        $('n-today').textContent = k.mine ? k.mine : '';
    };

    /** every customer this PC knows: Debtors cards, tickets, calls, CRM contacts, Fusion master kept → [{bu, account, name, phone, email, src}] */
    C.customerIndex = function () {
        var by = {};
        function add(bu, acct, name, phone, email, src) {
            if (!acct) return; acct = String(acct);
            var x = by[acct] = by[acct] || { bu: bu || '', account: acct, name: '', phone: '', email: '', src: src };
            if (!x.name && name) x.name = name; if (!x.bu && bu) x.bu = bu;
            if (phone && x.phone.indexOf(phone) < 0) x.phone = x.phone ? x.phone + ' / ' + phone : phone;
            if (email && !x.email) x.email = email;
        }
        Object.keys(C.master).forEach(function (a) { var m = C.master[a]; add('', a, m.CUSTOMER || m.ACCOUNT_NAME, m.PHONE, m.EMAIL, 'Fusion'); });
        Object.keys(C.cards).forEach(function (k) { var c = C.cards[k]; add(c.BU_ID, c.ACCOUNT_NUMBER, c.ACCOUNT_NAME, c.PHONE, (c.STMT_TO || '').split(/[;,]/)[0], 'card'); });
        C.contacts.forEach(function (c) { add(c.BU_ID, c.ACCOUNT_NUMBER, '', [c.PHONE, c.MOBILE].filter(Boolean).join(' / '), c.EMAIL, 'contact'); });
        C.tickets.forEach(function (t) { add(t.BU_ID, t.ACCOUNT_NUMBER, t.ACCOUNT_NAME, t.CONTACT_PHONE, t.CONTACT_EMAIL, 'ticket'); });
        C.calls.forEach(function (c) { add(c.BU_ID, c.ACCOUNT_NUMBER, c.ACCOUNT_NAME, c.NUMBER_RAW, '', 'call'); });
        return Object.keys(by).map(function (k) { return by[k]; });
    };
    /** numbers → customers (screen pop) */
    C.phoneIndex = function () {
        var out = [];
        C.customerIndex().forEach(function (c) { if (c.phone) out.push({ phone: c.phone, bu: c.bu, account: c.account, name: c.name, source: c.src }); });
        C.contacts.forEach(function (c) { var p = [c.PHONE, c.MOBILE].filter(Boolean).join(' / '); if (p) out.push({ phone: p, bu: c.BU_ID, account: c.ACCOUNT_NUMBER, name: (C.master[c.ACCOUNT_NUMBER] || {}).CUSTOMER || '', contact: c.NAME, source: 'contact' }); });
        (C.phoneKept || []).forEach(function (p) { out.push(p); });
        return out;
    };
    C.searchLocal = function (q, max) {
        var words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) return [];
        var p = E.phone(q, C.setup.phone.country), byPhone = p.last7 && p.last7.length >= 7 && /^[\d\s+()-]+$/.test(q);
        return C.customerIndex().filter(function (c) {
            if (byPhone) return E.samePhone(c.phone.split(' / ')[0], q, C.setup.phone.country) || c.phone.split(' / ').some(function (x) { return E.samePhone(x, q, C.setup.phone.country); });
            var hay = (c.account + ' ' + c.name + ' ' + c.phone + ' ' + c.email).toLowerCase();
            return words.every(function (w) { return hay.indexOf(w) >= 0; });
        }).sort(function (a, b) { return (a.account === q ? -1 : 0) - (b.account === q ? -1 : 0) || String(a.name).localeCompare(String(b.name)); }).slice(0, max || 50);
    };
    /** Fusion customer search (Debtors master query) → rows kept as master */
    C.searchFusion = function (q) {
        var sql = DE.masterSearchSql(q); if (!sql) return Promise.resolve([]);
        return D.fusionSql(sql, 200).then(function (rows) {
            rows.forEach(function (r) { if (!C.master[r.ACCOUNT_NUMBER]) C.master[r.ACCOUNT_NUMBER] = r; });
            return rows;
        });
    };

    // recent customers
    C.recent = function () { return ls('recent', []); };
    C.pushRecent = function (c) { var r = C.recent().filter(function (x) { return x.account !== c.account; }); r.unshift({ bu: c.bu, account: c.account, name: c.name }); lsSet('recent', r.slice(0, 12)); };

    // ── tabs ─────────────────────────────────────────────────────────
    C.go = function (tab) {
        C.tab = tab; if (tab !== 'c360') lsSet('tab', tab);
        document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
        C.render();
    };
    C.render = function () {
        var m = $('main'); if (!m) return;
        var auto = C.tab === 'auto';
        $('ap-host').hidden = !auto; m.style.display = auto ? 'none' : '';
        var v = C.views[C.tab] || C.views.today;
        try { m.innerHTML = v() || ''; } catch (e) { console.error(e); m.innerHTML = '<div class="note bad">' + esc(errText(e)) + '</div>'; }
        if (C.after[C.tab]) try { C.after[C.tab](); } catch (e) { console.error(e); }
    };
    C.paintWho = function () {
        $('who').innerHTML = '<button class="chip' + (C.pod === 'TEST' ? ' test' : '') + '" data-act="pod" title="Fusion pod for customer data — click to switch">' + esc(C.pod) + '</button><span>' + esc(C.me()) + (C.info ? ' · ' + esc(C.info.machine) : '') + '</span>';
    };

    // ══ Today ═════════════════════════════════════════════════════════
    C.views.today = function () {
        if (!C.ready) return '<div class="empty"><span class="spin"></span> Reading…</div>';
        var now = new Date(), k = E.ticketKpis(C.tickets, now, C.me()), me = C.me().toLowerCase();
        var callsToday = C.calls.filter(function (c) { return String(c.STARTED_AT || '').slice(0, 10) === today(); });
        var missed = callsToday.filter(function (c) { return c.OUTCOME === 'MISSED'; }).length;
        var cbs = C.calls.filter(function (c) { return c.CALLBACK_AT && c.CALLBACK_DONE !== 'Y'; }).sort(function (a, b) { return String(a.CALLBACK_AT).localeCompare(b.CALLBACK_AT); });
        var cbDue = cbs.filter(function (c) { return c.CALLBACK_AT.slice(0, 10) <= today(); });
        var mailToday = C.msgs.filter(function (m) { return String(m.CREATED_AT || '').slice(0, 10) === today(); }).length;
        var open = C.tickets.filter(E.isOpen);
        var mine = open.filter(function (t) { return String(t.ASSIGNED_TO || '').toLowerCase() === me; }).sort(bySla);
        var risk = open.filter(function (t) { var s = E.sla(t, now).state; return s === 'breached' || s === 'risk'; }).sort(bySla);
        var h = now.getHours(), hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
        var rec = C.recent();
        return '<div class="card"><div class="row"><div><div style="font-size:20px;font-weight:800">' + hello + ', ' + esc(C.me()) + '</div><div class="muted small">' + esc(new Date().toDateString()) + ' · ' + k.open + ' open tickets, ' + k.breached + ' past the SLA, ' + cbDue.length + ' callbacks due</div></div><span class="sp"></span>' +
            '<button class="btn pri" data-act="newTicket"><i class="fas fa-plus"></i> New ticket</button><button class="btn" data-act="phoneOpen"><i class="fas fa-phone"></i> Call</button><button class="btn" data-act="compose"><i class="fas fa-envelope"></i> E-mail</button><button class="btn ghost" data-act="refresh" title="Read again"><i class="fas fa-rotate"></i></button></div>' +
            (rec.length ? '<div class="recent" style="margin-top:12px">' + rec.map(function (r) { return '<span class="rc" data-act="open360" data-bu="' + esc(r.bu) + '" data-acct="' + esc(r.account) + '" data-name="' + esc(r.name) + '">' + C.avatar(r.name || r.account) + esc(r.name || r.account) + '</span>'; }).join('') + '</div>' : '') + '</div>' +
            '<div class="kpis">' + C.kpi('My open tickets', k.mine, 'assigned to you', 'pri', 'tkScope', ' data-scope="mine"') + C.kpi('Past the SLA', k.breached, k.risk + ' at risk', k.breached ? 'bad' : 'ok', 'tkScope', ' data-scope="breached"') +
            C.kpi('Unassigned', k.unassigned, 'need an owner', k.unassigned ? 'warn' : 'ok', 'tkScope', ' data-scope="unassigned"') + C.kpi('New today', k.newToday, k.resolvedToday + ' resolved today', 'info', 'tkScope', ' data-scope="open"') +
            C.kpi('Waiting for customer', k.waiting, 'SLA paused', '', 'tkScope', ' data-scope="waiting"') + C.kpi('Calls today', callsToday.length, missed + ' missed', missed ? 'warn' : 'info', 'go', ' data-tab="calls"') +
            C.kpi('Callbacks due', cbDue.length, cbs.length + ' planned', cbDue.length ? 'bad' : 'ok', 'go', ' data-tab="calls"') + C.kpi('E-mails today', mailToday, 'sent from the CRM', '', 'go', ' data-tab="mail"') + '</div>' +
            '<div class="cols"><div><div class="card"><h2><i class="fas fa-inbox"></i> My queue <span class="pill">' + mine.length + '</span><span class="sp"></span><a data-act="tkScope" data-scope="mine">all</a></h2>' + C.ticketFeed(mine.slice(0, 10), 'Nothing assigned to you — pick one from Unassigned.') + '</div>' +
            '<div class="card"><h2><i class="fas fa-stopwatch"></i> Past the SLA or close to it <span class="pill ' + (risk.length ? 'bad' : 'ok') + '">' + risk.length + '</span></h2>' + C.ticketFeed(risk.slice(0, 10), 'Every ticket is within its SLA.') + '</div></div>' +
            '<div><div class="card"><h2><i class="fas fa-phone-flip"></i> Callbacks</h2>' + (cbs.length ? '<div class="feed">' + cbs.slice(0, 10).map(function (c) {
                var late = c.CALLBACK_AT.slice(0, 10) < today();
                return '<div class="fi ' + (late ? 'bad' : c.CALLBACK_AT.slice(0, 10) === today() ? 'warn' : '') + '"><div class="ic"><i class="fas fa-phone"></i></div><div class="tx"><div class="t">' + esc(c.ACCOUNT_NAME || c.CONTACT_NAME || c.NUMBER_RAW) + '</div><div class="s">' + esc(c.CALLBACK_AT) + ' · ' + esc(c.NUMBER_RAW || '') + '</div>' + (c.NOTES ? '<div class="b">' + esc(c.NOTES) + '</div>' : '') + '</div>' +
                    '<div class="ac"><button class="btn sm ok" data-act="callBack" data-id="' + esc(c.CALL_ID) + '"><i class="fas fa-phone"></i> Call</button><button class="btn sm" data-act="cbDone" data-id="' + esc(c.CALL_ID) + '" title="Mark done">✓</button></div></div>';
            }).join('') + '</div>' : '<div class="empty">No callbacks planned.</div>') + '</div>' +
            '<div class="card"><h2><i class="fas fa-bolt"></i> Activity today</h2>' + C.activityFeed() + '</div></div></div>';
    };
    function bySla(a, b) { return String(a.DUE_FIRST && !a.FIRST_RESPONSE_AT ? a.DUE_FIRST : a.DUE_RESOLVE || '9').localeCompare(String(b.DUE_FIRST && !b.FIRST_RESPONSE_AT ? b.DUE_FIRST : b.DUE_RESOLVE || '9')); }
    C.bySla = bySla;
    C.ticketFeed = function (list, empty) {
        if (!list.length) return '<div class="empty">' + esc(empty) + '</div>';
        var now = new Date();
        return '<div class="feed">' + list.map(function (t) {
            var s = E.sla(t, now), p = E.priority(t.PRIORITY);
            return '<div class="fi click ' + (s.state === 'breached' ? 'bad' : s.state === 'risk' ? 'warn' : '') + '" data-act="openTicket" data-id="' + esc(t.TICKET_ID) + '"><div class="ic"><i class="fas fa-ticket"></i></div><div class="tx"><div class="t">' + esc(t.TICKET_NO) + ' · ' + esc(t.SUBJECT) + '</div>' +
                '<div class="s">' + esc(t.ACCOUNT_NAME || t.CONTACT_NAME || '') + ' · ' + esc(t.CATEGORY || '') + ' · ' + C.when(t.CREATED_AT) + '</div></div><div class="ac">' + C.pill(p.key, p.cls) + C.pill(esc(s.label), s.cls) + '</div></div>';
        }).join('') + '</div>';
    };
    C.activityFeed = function () {
        var t0 = today(), items = [];
        C.tickets.forEach(function (t) { if (String(t.CREATED_AT).slice(0, 10) === t0) items.push({ at: t.CREATED_AT, ic: 'fa-ticket', t: 'New ticket ' + t.TICKET_NO, s: (t.ACCOUNT_NAME || '') + ' · ' + t.SUBJECT, act: 'openTicket', id: t.TICKET_ID }); });
        C.calls.forEach(function (c) { if (String(c.STARTED_AT).slice(0, 10) === t0) items.push({ at: c.STARTED_AT, ic: c.DIRECTION === 'IN' ? 'fa-phone-volume' : 'fa-phone', t: (c.DIRECTION === 'IN' ? 'Call from ' : 'Call to ') + (c.ACCOUNT_NAME || c.NUMBER_RAW || ''), s: (E.CALL_OUTCOMES[c.OUTCOME] || c.OUTCOME || '') + (c.DURATION_S ? ' · ' + E.secs(c.DURATION_S) : '') + ' · ' + (c.AGENT || ''), cls: c.OUTCOME === 'MISSED' ? 'bad' : '' }); });
        C.msgs.forEach(function (m) { if (String(m.CREATED_AT).slice(0, 10) === t0) items.push({ at: m.CREATED_AT, ic: 'fa-envelope', t: 'E-mail · ' + (m.SUBJECT || ''), s: (m.TO_ADDR || '') + ' · ' + (m.STATUS || ''), cls: m.STATUS === 'FAILED' ? 'bad' : '' }); });
        items.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
        if (!items.length) return '<div class="empty">Nothing yet today.</div>';
        return '<div class="feed">' + items.slice(0, 25).map(function (x) { return '<div class="fi ' + (x.cls || '') + (x.act ? ' click" data-act="' + x.act + '" data-id="' + esc(x.id) : '') + '"><div class="ic"><i class="fas ' + x.ic + '"></i></div><div class="tx"><div class="t">' + esc(x.t) + '</div><div class="s">' + esc(String(x.at).slice(11)) + ' · ' + esc(x.s) + '</div></div></div>'; }).join('') + '</div>';
    };

    // ══ Customers ═════════════════════════════════════════════════════
    // the grid = one page of the Fusion customer master kept on this PC (all of it, or the ones matching the box); a search that
    // finds nobody here reads Fusion by itself and keeps what it finds (this PC + APEX)
    C.cu = { q: '', fusion: null, searching: false, kept: null, total: null, page: 0, size: ls('cu.size', 50), src: '', loading: false, auto: '', err: null };
    var cuSeq = 0;
    C.cuLoad = function () {
        var cu = C.cu, my = ++cuSeq, q = cu.q.trim();
        if (!C.cs) return Promise.resolve();
        cu.loading = true;
        return C.cs.page(q, cu.size, cu.page * cu.size).then(function (r) {
            if (my !== cuSeq) return;
            cu.kept = r.rows; cu.total = r.total; cu.src = r.src; cu.err = null;
            // nobody here: ask Fusion once for this text (Enter / Find in Fusion asks again)
            if (q.length >= 3 && !r.total && !C.searchLocal(q, 1).length && cu.auto !== q && D.hasHost()) { cu.auto = q; C.ACT.cuFusion(true); }
        }, function (e) { if (my === cuSeq) { cu.kept = []; cu.total = 0; cu.err = errText(e); } }).then(function () {
            if (my !== cuSeq) return;
            cu.loading = false;
            if (C.tab === 'customers') keepFocus('cu-q', C.render);
        });
    };
    C.views.customers = function () {
        var cu = C.cu, q = cu.q.trim(), local = q && cu.page === 0 ? C.searchLocal(q, 50) : [];
        var openBy = {}; C.tickets.filter(E.isOpen).forEach(function (t) { openBy[t.ACCOUNT_NUMBER] = (openBy[t.ACCOUNT_NUMBER] || 0) + 1; });
        var lastBy = {}; C.calls.forEach(function (c) { if (!lastBy[c.ACCOUNT_NUMBER] || c.STARTED_AT > lastBy[c.ACCOUNT_NUMBER]) lastBy[c.ACCOUNT_NUMBER] = c.STARTED_AT; });
        var rows = [];
        function add(x) { var have = rows.filter(function (y) { return y.account === x.account; })[0]; if (have) { if (!have.name) have.name = x.name; if (!have.addr) have.addr = x.addr; if (!have.phone) have.phone = x.phone; if (!have.email) have.email = x.email; return; } rows.push(x); }
        (cu.fusion || []).forEach(function (r) { var m = E.dffUnpack(r.DFF_JSON).m; add({ bu: '', account: r.ACCOUNT_NUMBER, name: r.CUSTOMER || r.ACCOUNT_NAME, phone: r.PHONE || '', email: r.EMAIL || '', phoneFrom: m.p || '', emailFrom: m.e || '', dff: r.DFF_JSON || '', addr: r.BILL_TO_ADDRESS || '', src: 'Fusion · just read' }); });
        (cu.kept || []).forEach(add);
        local.forEach(add);
        if (cu.kept == null && !cu.loading && C.cs && C.ready) { cu.loading = true; setTimeout(C.cuLoad, 0); }
        var rec = C.recent();
        var total = cu.total || 0, from = total ? cu.page * cu.size + 1 : 0, to = Math.min(total, (cu.page + 1) * cu.size), pages = Math.max(1, Math.ceil(total / cu.size));
        var srcTxt = cu.src === 'apex' ? 'from APEX (no copy on this PC)' : 'on this PC';
        var pager = '<div class="pagerbar"><span class="small muted">' + (cu.loading ? '<span class="spin"></span> reading… ' : '') +
            (total ? from.toLocaleString() + '–' + to.toLocaleString() + ' of <b>' + total.toLocaleString() + '</b> ' + (q ? 'matching ' : 'customers ') + srcTxt : cu.kept ? (q ? 'Nobody ' + srcTxt + ' matches' : 'No customers ' + srcTxt + ' yet — Load all Fusion customers above') : '') +
            (cu.searching ? ' · <span class="spin"></span> reading Fusion…' : cu.fusion ? ' · ' + cu.fusion.length + ' read from Fusion now and kept' : '') + '</span><span class="sp"></span>' +
            '<button class="btn sm" data-act="cuPage" data-p="first"' + (cu.page > 0 ? '' : ' disabled') + ' title="First page">«</button>' +
            '<button class="btn sm" data-act="cuPage" data-p="prev"' + (cu.page > 0 ? '' : ' disabled') + '>‹ Prev</button>' +
            '<span class="small">page <input type="number" id="cu-pg" data-ch="cuPg" min="1" max="' + pages + '" value="' + (cu.page + 1) + '" style="width:64px"> of ' + pages.toLocaleString() + '</span>' +
            '<button class="btn sm" data-act="cuPage" data-p="next"' + (cu.page + 1 < pages ? '' : ' disabled') + '>Next ›</button>' +
            '<button class="btn sm" data-act="cuPage" data-p="last"' + (cu.page + 1 < pages ? '' : ' disabled') + ' title="Last page">»</button>' +
            '<select data-ch="cuSize" title="Rows per page">' + [25, 50, 100, 200, 500].map(function (n) { return '<option' + (n === cu.size ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>' +
            '<button class="btn sm" data-act="cuRefresh" title="Read the page again (and the counts)"><i class="fas fa-rotate"></i> Refresh</button></div>';
        return (C.cs ? C.cs.bar() : '') + '<div class="card"><div class="filters"><input type="search" id="cu-q" data-in="cuQ" placeholder="Name, account number, phone or e-mail' + (C.cs && C.cs.st.local && C.cs.st.local.n ? ' — searches the ' + C.cs.st.local.n.toLocaleString() + ' Fusion customers on this PC; not found → read from Fusion' : ' — Enter also searches Fusion') + '" value="' + esc(cu.q) + '" style="flex:1">' +
            '<button class="btn" data-act="cuFusion"' + (q ? '' : ' disabled') + '><i class="fas fa-cloud"></i> Find in Fusion</button><button class="btn" data-act="newTicket"><i class="fas fa-plus"></i> New ticket</button></div>' +
            (!q && rec.length ? '<div class="recent small"><span class="muted">Recent:</span> ' + rec.slice(0, 10).map(function (r) { return '<a data-act="open360" data-bu="' + esc(r.bu) + '" data-acct="' + esc(r.account) + '" data-name="' + esc(r.name) + '">' + esc(r.name || r.account) + '</a>'; }).join(' · ') + '</div>' : '') +
            (cu.err ? '<div class="note bad">' + esc(cu.err) + '</div>' : '') + '</div>' +
            '<div class="card">' + pager + C.table([
                [function (r) { return C.avatar(r.name || r.account); }, ''],
                [function (r) { return '<b>' + esc(r.name || '—') + '</b><div class="small muted">' + esc(r.account) + (r.status && r.status !== 'A' ? ' · ' + C.pill('inactive', 'muted') : '') + '</div>'; }, 'Customer'],
                [function (r) { return '<span class="small">' + esc(r.addr || '') + '</span>'; }, 'Address'],
                [function (r) { return r.phone ? '<span class="small">' + esc(r.phone) + '</span>' + (r.phoneFrom ? ' <span class="dfftag" title="From the DFF segment ' + esc(r.phoneFrom) + '">DFF</span>' : '') : ''; }, 'Phone'],
                [function (r) { return r.email ? '<span class="small">' + esc(r.email).replace(/,\s*/g, ',<wbr> ') + '</span>' + (r.emailFrom ? ' <span class="dfftag" title="From the DFF segment ' + esc(r.emailFrom) + '">DFF</span>' : '') : ''; }, 'E-mail'],
                [function (r) { return openBy[r.account] ? C.pill(openBy[r.account] + ' open', 'warn') : ''; }, 'Tickets'],
                [function (r) { return lastBy[r.account] ? C.when(lastBy[r.account]) : ''; }, 'Last call'],
                [function (r) { return C.pill(esc(r.src), /just read/.test(r.src) ? 'info' : 'muted'); }, 'Found in'],
                [function (r) { var ph = E.phoneList(r.phone)[0] || ''; return '<button class="btn sm ghost' + (r.dff ? ' dffon' : '') + '" data-act="cuDff" data-acct="' + esc(r.account) + '" title="' + (r.dff ? 'Account / party / organization DFFs' : 'DFFs — read from Fusion') + '"><i class="fas fa-tags"></i></button> ' + (ph ? '<button class="btn sm" data-act="dialNum" data-num="' + esc(ph) + '" data-acct="' + esc(r.account) + '" title="Call ' + esc(ph) + '"><i class="fas fa-phone"></i></button>' : '') + ' <button class="btn sm pri" data-act="open360" data-bu="' + esc(r.bu) + '" data-acct="' + esc(r.account) + '" data-name="' + esc(r.name) + '">Open</button>'; }, '', 'r']
            ], rows, { empty: cu.loading || cu.kept == null ? 'Reading…' : cu.searching ? 'Nobody here — reading Fusion…' : q ? 'No customer matches here or in Fusion.' : 'No customers on this PC yet — Load all Fusion customers above.' }) + (total > cu.size ? pager : '') + '</div>';
    };
    C.after.customers = function () { if (C.cs && !C.cs.st.apex && !C.cs.run) C.cs.status(); };
    var cuT = 0;
    C.IN.cuQ = function (el, e) {
        if (e && e.key === 'Enter') { C.ACT.cuFusion(); return; }
        if (C.cu.q === el.value) return;
        C.cu.q = el.value; C.cu.fusion = null; C.cu.page = 0;
        clearTimeout(cuT);
        cuT = setTimeout(C.cuLoad, 250);
    };
    C.ACT.cuPage = function (el) {
        var cu = C.cu, pages = Math.max(1, Math.ceil((cu.total || 0) / cu.size)), p = el.dataset.p;
        cu.page = p === 'first' ? 0 : p === 'last' ? pages - 1 : p === 'prev' ? Math.max(0, cu.page - 1) : Math.min(pages - 1, cu.page + 1);
        C.cuLoad();
    };
    C.CH.cuPg = function (el) { var cu = C.cu, pages = Math.max(1, Math.ceil((cu.total || 0) / cu.size)); cu.page = Math.max(0, Math.min(pages - 1, (+el.value || 1) - 1)); C.cuLoad(); };
    C.CH.cuSize = function (el) { C.cu.size = +el.value || 50; lsSet('cu.size', C.cu.size); C.cu.page = 0; C.cuLoad(); };
    C.ACT.cuRefresh = function () { if (C.cs) { C.cs.cache = {}; C.cs.status(); } C.cuLoad(); };
    /** Find in Fusion (button / Enter, or by itself when nobody here matches): what Fusion finds is kept on this PC + APEX and shown at once */
    C.ACT.cuFusion = function (auto) {
        var q = C.cu.q.trim(); if (!q || C.cu.searching) return;
        C.cu.searching = true; C.render();
        C.searchFusion(q).then(function (rows) {
            if (C.cu.q.trim() !== q) return;
            C.cu.fusion = rows;
            var kept = rows.map(function (r) { return E.custRow(r, C.pod); }).filter(function (x) { return x.account_number; });
            if (!kept.length) { if (auto !== true) C.toast('Nobody in Fusion matches "' + q + '"', 'warn'); return; }
            C.toast(kept.length + ' customer' + (kept.length > 1 ? 's' : '') + ' read from Fusion · kept on this PC and in APEX', 'ok');
            if (C.cs) C.cs.cache = {};
            // read them again with their DFFs (e-mail / phone often sit there); fall back to what the search found
            var withDff = C.cs ? C.cs.readAccounts(kept.map(function (x) { return x.account_number; })).then(function (rows) {
                var by = {}; rows.forEach(function (o) { by[o.account_number] = E.custMaster(o); });
                C.cu.fusion = (C.cu.fusion || []).map(function (r) { return by[r.ACCOUNT_NUMBER] ? Object.assign({}, r, by[r.ACCOUNT_NUMBER]) : r; });
                return rows.length;
            }, function () { return 0; }) : Promise.resolve(0);
            return withDff.then(function (n) { if (n) return; return Promise.all([S.duck.custPut(C.pod, kept), S.customers.merge(C.pod, kept).catch(function () { })]); }).then(function () { if (C.cs) C.cs.status(); });
        }, function (e) { C.toast('Fusion: ' + errText(e), 'bad', 7000); C.cu.fusion = []; }).then(function () {
            C.cu.searching = false;
            if (C.cu.q.trim() === q) C.cuLoad(); else if (C.tab === 'customers') keepFocus('cu-q', C.render);
        });
    };
    function keepFocus(id, fn) { var el = $(id), pos = el ? el.selectionStart : null; fn(); var n = $(id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { } } }
    C.keepFocus = keepFocus;

    // ══ Insights ══════════════════════════════════════════════════════
    C.views.insights = function () {
        var st = E.slaStats(C.tickets, C.setup.hours), k = E.ticketKpis(C.tickets, new Date());
        function bars(obj, key) {
            var list = Object.keys(obj).map(function (k2) { return { k: k2, n: key ? obj[k2][key] : obj[k2] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 12), max = Math.max.apply(null, list.map(function (x) { return x.n; }).concat([1]));
            return list.length ? '<div class="bars">' + list.map(function (x) { return '<div class="br"><span class="cut" title="' + esc(x.k) + '">' + esc(x.k) + '</span><div class="bg"><div style="width:' + Math.round(x.n / max * 100) + '%"></div></div><b class="r">' + x.n + '</b></div>'; }).join('') + '</div>' : '<div class="empty">No data.</div>';
        }
        var chan = {}; C.tickets.forEach(function (t) { var c = E.CHANNELS[t.CHANNEL] || t.CHANNEL || 'Other'; chan[c] = (chan[c] || 0) + 1; });
        var custs = {}; C.tickets.forEach(function (t) { var n = t.ACCOUNT_NAME || t.ACCOUNT_NUMBER || t.CONTACT_NAME || '(unknown)'; custs[n] = (custs[n] || 0) + 1; });
        var days = []; for (var i = 13; i >= 0; i--) days.push(addDays(-i));
        var perDay = days.map(function (d) { var l = C.calls.filter(function (c) { return String(c.STARTED_AT).slice(0, 10) === d; }); return { d: d, n: l.length, miss: l.filter(function (c) { return c.OUTCOME === 'MISSED'; }).length }; });
        var maxD = Math.max.apply(null, perDay.map(function (x) { return x.n; }).concat([1]));
        var talk = C.calls.reduce(function (a, c) { return a + (+c.DURATION_S || 0); }, 0), answered = C.calls.filter(function (c) { return c.OUTCOME === 'ANSWERED'; }).length;
        return '<div class="kpis">' + C.kpi('SLA met', st.metPct == null ? '—' : st.metPct + '%', st.n + ' resolved in 90 days', st.metPct >= 90 ? 'ok' : st.metPct >= 70 ? 'warn' : 'bad') +
            C.kpi('First reply', st.avgFirst == null ? '—' : E.dur(st.avgFirst), 'average working time', 'info') + C.kpi('Resolution', st.avgResolve == null ? '—' : E.dur(st.avgResolve), 'average working time', 'info') +
            C.kpi('Satisfaction', st.csat == null ? '—' : st.csat + ' / 5', st.csatN + ' ratings', st.csat >= 4 ? 'ok' : st.csat ? 'warn' : '') + C.kpi('Open now', k.open, k.breached + ' past the SLA', k.breached ? 'bad' : 'ok') +
            C.kpi('Calls (30 days)', C.calls.length, answered + ' answered · ' + E.secs(talk) + ' talk', 'pri') + '</div>' +
            '<div class="cols"><div class="card"><h2>Tickets by category</h2>' + bars(st.byCat, 'n') + '</div><div class="card"><h2>By channel</h2>' + bars(chan) + '</div></div>' +
            '<div class="cols"><div class="card"><h2>By agent</h2>' + C.table([[function (r) { return C.avatar(r.k) + ' ' + esc(r.k); }, 'Agent'], [function (r) { return r.v.n; }, 'Tickets', 'r'], [function (r) { return r.v.open; }, 'Open', 'r'], [function (r) { return r.v.resolved; }, 'Resolved', 'r']],
                Object.keys(st.byAgent).map(function (a) { return { k: a, v: st.byAgent[a] }; }).sort(function (a, b) { return b.v.n - a.v.n; })) + '</div><div class="card"><h2>Customers with most tickets</h2>' + bars(custs) + '</div></div>' +
            '<div class="card"><h2>Calls per day (14 days)</h2><div class="spark" style="height:120px">' + perDay.map(function (x) { return '<span style="height:' + Math.max(2, Math.round(x.n / maxD * 100)) + '%" title="' + x.d + ': ' + x.n + ' calls, ' + x.miss + ' missed"></span>'; }).join('') + '</div><div class="row small muted"><span>' + days[0] + '</span><span class="sp"></span><span>' + days[13] + '</span></div></div>';
    };

    // ══ the ask bar (Ctrl+K): customers, tickets, phone numbers, plain questions — no language model needed ══
    var askSel = 0, askItems = [];
    function askSuggest() {
        var q = $('ask').value.trim(), pop = $('askpop');
        if (!q) { pop.className = 'askpop'; return; }
        var a = E.ask(q, { prefix: C.setup.prefix }), items = [];
        var lbl = { tickets_breached: 'Tickets past the SLA', tickets_mine: 'My tickets', tickets_unassigned: 'Unassigned tickets', tickets_open: 'Open tickets', callbacks: 'Callbacks', calls_missed: 'Missed calls', calls_today: 'Calls today', new_ticket: 'New ticket' };
        if (lbl[a.intent]) items.push({ g: 'Do', ic: 'fa-bolt', t: lbl[a.intent], s: 'Enter', run: function () { runIntent(a); } });
        var verbs = { last_statement: 'Last statement of', send_statement: 'Send a statement to', balance: 'Balance of', orders: 'Orders of', invoices: 'Invoices of', call_customer: 'Call' };
        var wq = a.customer || a.phone || q, who = C.searchLocal(wq, 6), kept = C.cs && C.cs.cache[String(wq).trim().toLowerCase() + '|8'];
        if (kept) kept.forEach(function (c) { if (who.length < 8 && !who.some(function (x) { return x.account === c.account; })) who.push(c); });
        else if (C.cs && String(wq).trim().length >= 2) C.cs.search(wq, 8).then(function () { if ($('ask').value.trim() === q) askSuggest(); });
        if (verbs[a.intent]) who.forEach(function (c) { items.push({ g: 'Do', ic: 'fa-bolt', t: verbs[a.intent] + ' ' + (c.name || c.account), s: c.account, run: function () { runIntent(a, c); } }); });
        if (a.intent === 'ticket' || /^[A-Za-z-]*\d{2,}$/.test(q)) C.tickets.filter(function (t) { return String(t.TICKET_NO).replace(/\D/g, '').replace(/^0+/, '') === String(a.ticket || q).replace(/\D/g, '').replace(/^0+/, ''); }).slice(0, 3)
            .forEach(function (t) { items.push({ g: 'Tickets', ic: 'fa-ticket', t: t.TICKET_NO + ' · ' + t.SUBJECT, s: t.ACCOUNT_NAME || '', run: function () { C.openTicketById(t.TICKET_ID); } }); });
        var low = q.toLowerCase();
        C.tickets.filter(function (t) { return String(t.SUBJECT).toLowerCase().indexOf(low) >= 0 || String(t.TICKET_NO).toLowerCase() === low; }).slice(0, 4)
            .forEach(function (t) { if (!items.some(function (i) { return i.t.indexOf(t.TICKET_NO) === 0; })) items.push({ g: 'Tickets', ic: 'fa-ticket', t: t.TICKET_NO + ' · ' + t.SUBJECT, s: t.ACCOUNT_NAME || '', run: function () { C.openTicketById(t.TICKET_ID); } }); });
        if (!verbs[a.intent]) who.forEach(function (c) { items.push({ g: 'Customers', ic: 'fa-user', t: c.name || c.account, s: c.account + (c.phone ? ' · ' + c.phone : ''), run: function () { C.open360(c.bu, c.account, c.name); } }); });
        items.push({ g: 'More', ic: 'fa-cloud', t: 'Find "' + q + '" in Fusion customers', s: 'Customers tab', run: function () { C.cu.q = q; C.go('customers'); C.ACT.cuFusion(); } });
        if (a.phone || a.intent === 'phone') items.push({ g: 'More', ic: 'fa-phone', t: 'Call ' + (a.phone || q), s: 'softphone', run: function () { C.phone.dial(a.phone || q); } });
        items.push({ g: 'More', ic: 'fa-robot', t: 'Ask the Autopilot', s: 'the AI Agent with the Customer Desk', run: function () { C.autopilot.ask(q); } });
        askItems = items; askSel = 0;
        var g = '';
        pop.innerHTML = items.map(function (it, i) { var head = it.g !== g ? '<div class="g">' + esc(it.g) + '</div>' : ''; g = it.g; return head + '<div class="it' + (i === 0 ? ' on' : '') + '" data-ai="' + i + '"><div class="ic"><i class="fas ' + it.ic + '"></i></div><div class="tx"><div>' + esc(it.t) + '</div><div class="s">' + esc(it.s) + '</div></div></div>'; }).join('');
        pop.className = 'askpop on';
    }
    function askRun(i) { var it = askItems[i]; $('askpop').className = 'askpop'; if (it) { $('ask').value = ''; it.run(); } }
    function runIntent(a, c) {
        var scope = { tickets_breached: 'breached', tickets_mine: 'mine', tickets_unassigned: 'unassigned', tickets_open: 'open' }[a.intent];
        if (scope) { C.tk.f.scope = scope; return C.go('tickets'); }
        if (a.intent === 'callbacks' || a.intent === 'calls_missed' || a.intent === 'calls_today') { C.cl.f.outcome = a.intent === 'calls_missed' ? 'MISSED' : ''; C.cl.f.days = a.intent === 'calls_today' ? 1 : C.cl.f.days; return C.go('calls'); }
        if (a.intent === 'new_ticket') return C.newTicket();
        if (!c) return;
        var sub = { last_statement: 'stmts', balance: 'ar', orders: 'orders', invoices: 'ar' }[a.intent];
        C.open360(c.bu, c.account, c.name, sub);
        if (a.intent === 'send_statement') C.mail.statement({ bu: c.bu || C.buOf(c.account), account: c.account, name: c.name });
        if (a.intent === 'call_customer' && c.phone) C.phone.dial(c.phone.split(' / ')[0], { account: c.account, bu: c.bu, name: c.name });
    }

    // ── events ──────────────────────────────────────────────────────
    document.addEventListener('click', function (e) {
        var ai = e.target.closest('[data-ai]'); if (ai) { askRun(+ai.dataset.ai); return; }
        if (!e.target.closest('.ask')) $('askpop').className = 'askpop';
        if (e.target.id === 'drawer') { C.dclose(); return; }
        var t = e.target.closest('[data-tab]');
        if (t && t.closest('#tabs')) { C.go(t.dataset.tab); return; }
        var a = e.target.closest('[data-act]'); if (!a) return;
        var fn = C.ACT[a.dataset.act]; if (fn) { e.preventDefault(); fn(a, e); }
    });
    document.addEventListener('input', function (e) { var n = e.target.dataset && e.target.dataset.in; if (n && C.IN[n]) C.IN[n](e.target, e); });
    document.addEventListener('change', function (e) { var n = e.target.dataset && e.target.dataset.ch; if (n && C.CH[n]) C.CH[n](e.target, e); });
    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('ask').focus(); $('ask').select(); return; }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); C.ACT.phoneToggle(); return; }
        if (e.target.id === 'ask') {
            var n = askItems.length;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); askSel = (askSel + (e.key === 'ArrowDown' ? 1 : -1) + n) % Math.max(1, n); document.querySelectorAll('#askpop .it').forEach(function (x, i) { x.classList.toggle('on', i === askSel); }); return; }
            if (e.key === 'Enter') { e.preventDefault(); askRun(askSel); return; }
            if (e.key === 'Escape') { $('askpop').className = 'askpop'; e.target.blur(); return; }
        }
        if (e.key === 'Enter' && e.target.dataset && e.target.dataset.in && C.IN[e.target.dataset.in]) C.IN[e.target.dataset.in](e.target, e);
        if (e.key === 'Escape') { if ($('modal').classList.contains('on')) C.mclose(); else if ($('drawer').classList.contains('on')) C.dclose(); }
    });
    var askT = 0;
    $('ask').addEventListener('input', function () { clearTimeout(askT); askT = setTimeout(askSuggest, 120); });
    $('ask').addEventListener('focus', function () { if ($('ask').value) askSuggest(); });

    C.ACT.mclose = C.mclose;
    C.ACT.dclose = C.dclose;
    C.ACT.go = function (el) { C.go(el.dataset.tab); };
    C.ACT.refresh = function () { C.refresh(); };
    C.ACT.tkScope = function (el) { C.tk.f.scope = el.dataset.scope; lsSet('tk.f', C.tk.f); C.go('tickets'); };
    C.ACT.open360 = function (el) { C.open360(el.dataset.bu, el.dataset.acct, el.dataset.name, el.dataset.sub); };
    C.ACT.pod = function () { C.pod = C.pod === 'PROD' ? 'TEST' : 'PROD'; lsSet('pod', C.pod); C.master = {}; C.paintWho(); C.loadMaster().then(C.render); if (C.cs) { C.cs.cache = {}; C.cs.auto(); } C.cu.kept = null; C.cu.page = 0; C.toast('Fusion customer data now from ' + C.pod); };

    // ── boot ─────────────────────────────────────────────────────────
    function boot() {
        C.paintWho();
        document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === C.tab); });
        if (C.tab === 'c360') C.tab = 'today';
        C.render();
        if (!D.hasHost()) { $('main').innerHTML = '<div class="note warn">Open the CRM inside the Gray\'s WMS app — it reads APEX and Fusion through the app.</div>'; return; }
        var end = C.busy('Starting…');
        D.clock().then(function () { return Promise.all([D.call('crmInfo', {}, 20000).then(function (r) { C.info = r; }, function () { C.info = null; }), C.loadSetup(), C.loadMaster().catch(function () { })]); })
            .then(function () { return S.ensure(); })
            .then(C.loadCore)
            .then(function () { end(); C.paintWho(); C.render(); if (C.phone && C.phone.boot) C.phone.boot(); if (C.mail && C.mail.status) C.mail.status(); C.learnBoot(); if (C.cs) C.cs.auto(); },
                function (e) { end(); C.toast(errText(e), 'bad', 10000); C.ready = true; C.render(); });
        setInterval(function () { if (!document.hidden && C.ready && !$('modal').classList.contains('on')) C.loadCore().then(function () { if (C.tab === 'today' || C.tab === 'tickets') C.render(); }).catch(function () { }); }, 120000);
    }
    /** the ticket classifiers: ML.NET on the host when trained, else naive Bayes here; similar tickets need the resolved ones */
    C.learnBoot = function () {
        S.tickets.learning(3000).then(function (rows) {
            C.learn = rows;
            C.model = { category: E.nbTrain(rows.map(function (r) { return { text: r.SUBJECT + ' ' + r.DESCRIPTION, label: r.CATEGORY }; })), priority: E.nbTrain(rows.map(function (r) { return { text: r.SUBJECT + ' ' + r.DESCRIPTION, label: r.PRIORITY }; })) };
        }).catch(function () { });
    };
    /** suggestion for a text → {category, catP, priority, prP, engine} (ML.NET first, naive Bayes when the host has no model) */
    C.suggest = function (text) {
        if (!text || text.length < 8) return Promise.resolve(null);
        var nb = function (m) { var p = C.model && E.nbPredict(C.model[m], text); return p && p.length ? p[0] : null; };
        var hostP = function (m) { return D.hasHost() ? D.host('crmMlPredict', { model: m, text: text }, 15000).then(function (r) { return r && r.ok && r.top && r.top.length ? { label: r.top[0].label, p: r.top[0].score } : null; }, function () { return null; }) : Promise.resolve(null); };
        return Promise.all([hostP('category'), hostP('priority')]).then(function (r) {
            var c = r[0] || nb('category'), p = r[1] || nb('priority');
            return c || p ? { category: c && c.label, catP: c && c.p, priority: p && p.label, prP: p && p.p, engine: r[0] ? 'ML.NET' : 'naive Bayes' } : null;
        });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
})();
