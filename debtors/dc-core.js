/* Fusion Debtors Control · the page (window.DC).
 * Overview (worklist), Send statements (balances from a BI Publisher report or Fusion SQL → statement PDFs → e-mail / post,
 * every statement recorded in APEX BEFORE it is sent), Statements sent (who got what, opened / read / bounced, the customer's
 * answer, resend), Customers (list with a collection priority, Customer 360 with the timeline, promises, disputes, the card),
 * Follow-ups, Setup (business units, report / SQL sources, e-mail template, mail account, customer links).
 * Engine: dc-engine.js (DCE, pure). Host + APEX: dc-store.js (DCS). */
(function () {
    'use strict';
    var E = window.DCE, S = window.DCS;
    var esc = E.esc, money = E.money;
    function $(id) { return document.getElementById(id); }
    function ls(k, d) { try { var v = localStorage.getItem('dc.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem('dc.' + k, JSON.stringify(v)); } catch (e) { } }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function key(bu, acct) { return bu + '|' + acct; }
    function today() { return E.iso(new Date()); }
    function addDays(iso, n) { var d = E.parseIso(iso) || new Date(); d.setDate(d.getDate() + n); return E.iso(d); }
    function errText(e) { return String(e && e.message || e || 'error'); }

    var P = window.DC = {
        tab: ls('tab', 'home'), pod: ls('pod', S.loginPod()), bus: [], general: clone(E.GENERAL), buId: ls('bu', ''),
        stmtDate: E.lastMonthEnd(), cards: {}, latest: {}, contact: {}, acts: [], recent: [], runs: [],
        run: { customers: null, loadedFor: null, sel: {}, f: ls('run.f', { q: '', delivery: '', positive: true, unsent: true }), sort: { k: 'balance', d: -1 }, live: null, opts: null },
        stmts: { rows: null, f: ls('stmts.f', { days: 45, buId: '', status: '', resp: '', q: '' }), sort: { k: 'CREATED_AT', d: -1 } },
        cust: { q: '', filter: '', open: null, sub: 'timeline', data: null },
        tasks: { mine: ls('tasks.mine', false) },
        mail: null, info: null, linksOk: null, ready: false
    };

    // ── chrome: toast, busy chip, modal ─────────────────────────────
    function toast(msg, kind, ms) { var t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, ms || 3500); }
    var busyN = 0;
    function busy(label) {
        var b = $('busy'); busyN++; b.className = 'hb on'; b.innerHTML = '<span class="spin"></span><span class="lbl">' + esc(label) + '</span>';
        return function () { busyN = Math.max(0, busyN - 1); if (!busyN) b.className = 'hb'; };
    }
    function modal(title, body, foot, wide) {
        var m = $('modal'), b = $('mbox');
        b.className = 'mbox' + (wide ? ' wide' : '');
        b.innerHTML = '<div class="mh">' + title + '<span class="sp"></span><button class="btn ghost sm" data-act="mclose"><i class="fas fa-xmark"></i></button></div><div class="mb">' + body + '</div>' + (foot ? '<div class="mf">' + foot + '</div>' : '');
        m.className = 'modal on';
        return b;
    }
    function mclose() { $('modal').className = 'modal'; $('mbox').innerHTML = ''; }
    function pill(text, cls, title) { return '<span class="pill ' + (cls || '') + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + text + '</span>'; }
    function statePill(s) { var st = E.stmtState(s); return pill(st.label, st.cls); }
    function csv(name, cols, rows) {
        var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var text = '﻿' + cols.map(function (c) { return q(c[1]); }).join(',') + '\r\n' + rows.map(function (r) { return cols.map(function (c) { return q(typeof c[0] === 'function' ? c[0](r) : r[c[0]]); }).join(','); }).join('\r\n');
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    }
    function when(s) { return s ? esc(S.local(s)) : ''; }

    // ── data ─────────────────────────────────────────────────────────
    function bu(id) { return P.bus.filter(function (b) { return b.id === id; })[0] || null; }
    function curBu() { return bu(P.buId) || P.bus.filter(function (b) { return b.active !== 'N'; })[0] || P.bus[0] || null; }
    function card(buId, acct) { return P.cards[key(buId, acct)] || null; }
    function profileOf(buId, acct) { var c = card(buId, acct) || {}; return { stmtTo: c.STMT_TO, stmtCc: c.STMT_CC, delivery: c.DELIVERY }; }
    function actsOf(buId, acct) { return P.acts.filter(function (a) { return a.BU_ID === buId && a.ACCOUNT_NUMBER === acct; }); }
    function isAdmin() { try { var t = (localStorage.getItem('userType') || '').toUpperCase(); return t === 'ADMIN' || t === 'FINANCE' || !t; } catch (e) { return true; } }

    /** How statements are sent from this PC: the Finance Lens mail setup */
    function mailInfo() {
        var r = P.mail || {}, s = r.settings || {}, m = s.Method || 'OUTLOOK';
        var box = m === 'OUTLOOK' ? (s.OutlookAccount || ((r.outlookAccounts || [])[0]) || 'Outlook default account') : m === 'GRAPH' ? (s.SharedMailbox || r.graphAccount || '') : (s.SmtpFrom || s.SmtpUser || '');
        var ready = m === 'GRAPH' ? !!r.graphAccount : m === 'SMTP' ? !!(r.smtp && r.smtp.hasPassword) : !!r.outlook;
        return { method: m, mailbox: box, ready: ready, label: ({ OUTLOOK: 'Outlook', GRAPH: 'Microsoft 365', SMTP: 'SMTP' })[m] || m };
    }

    function loadSettings() {
        return Promise.all([S.settings.get('BUS'), S.settings.get('GENERAL')]).then(function (r) {
            P.bus = r[0] && r[0].length ? r[0] : clone(E.SEED_BUS);
            P.general = Object.assign(clone(E.GENERAL), r[1] || {});
            P.seeded = !(r[0] && r[0].length);
            if (!bu(P.buId)) P.buId = (curBu() || {}).id || '';
        });
    }
    /** Cards, the latest statement per customer, last contacts, activities (open + the last year) */
    function loadCore() {
        var since = addDays(today(), -365);
        return Promise.all([S.cust.list(), S.stmt.latest(), S.act.lastContact(), S.act.list({ open: true }), S.act.list({ since: since }), S.stmt.search({ from: addDays(today(), -30), limit: 5000 })]).then(function (r) {
            P.cards = {}; r[0].forEach(function (c) { P.cards[key(c.BU_ID, c.ACCOUNT_NUMBER)] = c; });
            P.latest = {}; r[1].forEach(function (s) { P.latest[key(s.BU_ID, s.ACCOUNT_NUMBER)] = s; });
            P.contact = {}; r[2].forEach(function (x) { P.contact[key(x.BU_ID, x.ACCOUNT_NUMBER)] = x.LAST_AT; });
            var seen = {}; P.acts = r[3].concat(r[4]).filter(function (a) { if (seen[a.ACT_ID]) return false; seen[a.ACT_ID] = 1; return true; });
            P.recent = r[5];
            P.ready = true; badges();
        });
    }
    function worklist() { return E.worklist(Object.keys(P.latest).map(function (k) { return P.latest[k]; }), P.acts, { unopenedDays: +P.general.unopenedDays || 7 }); }
    function badges() {
        var wl = worklist(), urgent = wl.filter(function (x) { return x.sev >= 2; }).length;
        $('n-home').textContent = urgent ? urgent : '';
        var due = P.acts.filter(function (a) { var st = E.actState(a); return st === 'LATE' || st === 'DUE'; }).length;
        $('n-tasks').textContent = due ? due : '';
    }
    function refresh() { var end = busy('Reading APEX…'); return loadCore().then(function () { end(); render(); }, function (e) { end(); toast(errText(e), 'bad', 7000); render(); }); }

    // ── header + tabs ───────────────────────────────────────────────
    function paintWho() {
        var m = mailInfo();
        $('who').innerHTML = '<button class="chip' + (P.pod === 'TEST' ? ' test' : '') + '" data-act="pod" title="Fusion pod for the reports — click to switch">' + esc(P.pod) + '</button>' +
            '<button class="chip' + (P.mail && !m.ready ? ' warn' : '') + '" data-act="go" data-tab="setup" title="Statements are e-mailed with ' + esc(m.label) + ' from ' + esc(m.mailbox) + (m.ready ? '' : ' — not ready, open Setup') + '"><i class="fas fa-envelope"></i> ' + esc(m.label) + '</button>' +
            '<span>' + esc(S.user()) + (P.info ? ' · ' + esc(P.info.machine) : '') + '</span>';
    }
    function go(tab) { P.tab = tab; lsSet('tab', tab); document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); }); render(); if (tab === 'stmts' && !P.stmts.rows) loadStmts(); }
    function render() {
        var m = $('main'); if (!m) return;
        if (!S.hasHost()) { m.innerHTML = '<div class="card note warn">Open this page inside the Gray\'s WMS app — the reports and e-mails run in the desktop host with the application\'s Fusion credentials.</div>'; return; }
        if (!P.ready) { m.innerHTML = '<div class="card empty"><i class="fas fa-spinner fa-spin"></i> Loading…</div>'; return; }
        m.innerHTML = P.tab === 'run' ? vRun() : P.tab === 'stmts' ? vStmts() : P.tab === 'cust' ? vCust() : P.tab === 'tasks' ? vTasks() : P.tab === 'setup' ? vSetup() : vHome();
        if (P.tab === 'cust' && P.cust.open && !P.cust.data) load360();
    }

    // ══ Overview ═══════════════════════════════════════════════════
    var WL_ICON = { FAILED: 'fa-circle-xmark', BOUNCED: 'fa-envelope-circle-check', DISPUTED: 'fa-triangle-exclamation', PROMISE_LATE: 'fa-handshake-slash', PROMISE_DUE: 'fa-handshake', FOLLOWUP: 'fa-list-check', UNOPENED: 'fa-envelope' };
    function vHome() {
        var k = E.kpis(P.recent), wl = worklist(), openProm = P.acts.filter(function (a) { return a.KIND === 'PROMISE' && a.STATUS === 'OPEN'; });
        var promAmt = openProm.reduce(function (s, a) { return s + (+a.AMOUNT || 0); }, 0), disputes = P.acts.filter(function (a) { return a.KIND === 'DISPUTE' && a.STATUS === 'OPEN'; }).length;
        var h = '';
        if (P.seeded) h += '<div class="note warn" style="margin-bottom:14px"><b>First time here?</b> The business units and statement reports of the old debtors form are filled in — check them in <a data-act="go" data-tab="setup">Setup</a> and press <b>Save</b>, then <a data-act="linkSetup">set up the customer links</a> so you see who opened a statement and who agreed or queried the balance.</div>';
        h += '<div class="kpis">' +
            kpi('Statements · 30 days', k.total, k.emailed + ' e-mailed · ' + k.posted + ' by post', 'pri', 'stmtsAll') +
            kpi('Opened', k.openRate == null ? '—' : k.openRate + '%', k.opened + ' of ' + k.emailed + ' e-mailed', 'info', 'stmtsAll') +
            kpi('Balance agreed', k.agreed, 'customers confirmed it', 'ok', 'stmtsAgreed') +
            kpi('Queried', k.disputed, disputes + ' dispute' + (disputes === 1 ? '' : 's') + ' open', k.disputed ? 'bad' : '', 'stmtsDisputed') +
            kpi('Not delivered', k.failed + k.bounced, k.failed + ' failed · ' + k.bounced + ' bounced', k.failed + k.bounced ? 'bad' : '', 'stmtsFailed') +
            kpi('Promises open', openProm.length, money(promAmt), 'warn', 'go:tasks') + '</div>';
        h += '<div class="cols"><div class="card"><h2><i class="fas fa-bolt" style="color:var(--amber)"></i> Needs you <span class="pill">' + wl.length + '</span><span class="sp"></span><button class="btn sm" data-act="refresh"><i class="fas fa-rotate"></i></button></h2>' +
            (wl.length ? '<div class="wl">' + wl.slice(0, 60).map(wlItem).join('') + '</div>' : '<div class="empty"><i class="fas fa-circle-check" style="color:var(--ok);font-size:22px"></i><br>Nothing waiting — every statement arrived, no open disputes, no promise past its date.</div>') + '</div>';
        h += '<div><div class="card"><h2><i class="fas fa-paper-plane"></i> Statement runs</h2>' + runsTable() + '<div class="row" style="margin-top:10px"><button class="btn pri" data-act="go" data-tab="run"><i class="fas fa-paper-plane"></i> Send statements</button></div></div>' +
            '<div class="card"><h2><i class="fas fa-circle-info"></i> How it is recorded</h2><div class="small muted">Every statement is written to APEX <b>before</b> it is e-mailed: the customer, balance, To / Cc, subject, the PDF\'s name and SHA-256 fingerprint, who sent it from which PC and mailbox. Then: sent / failed, opened (tracking picture), delivered / read / bounced (receipts from the mailbox), and the customer\'s own answer — <b>agreed</b> or <b>queried</b> with a comment — from the button in the e-mail. Calls, notes, promises to pay and disputes sit on the same customer timeline.</div></div></div></div>';
        return h;
    }
    function kpi(l, v, s, cls, act) { return '<div class="kpi ' + (cls || '') + (act ? ' click' : '') + '"' + (act ? ' data-act="kpi" data-k="' + act + '"' : '') + '><div class="l">' + esc(l) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>'; }
    function wlItem(x) {
        var acts = '<button class="btn sm" data-act="open360" data-bu="' + esc(x.bu) + '" data-acct="' + esc(x.account) + '">Open</button>';
        if (x.kind === 'FAILED' || x.kind === 'BOUNCED') acts += '<button class="btn sm" data-act="resend" data-id="' + esc(x.ref) + '"><i class="fas fa-rotate-right"></i> Send again</button>';
        if (x.kind === 'DISPUTED') acts += '<button class="btn sm" data-act="resolveStmt" data-id="' + esc(x.ref) + '">Resolve</button>';
        if (x.kind === 'PROMISE_LATE' || x.kind === 'PROMISE_DUE') acts += '<button class="btn sm ok" data-act="close" data-id="' + esc(x.ref) + '" data-st="KEPT">Paid</button><button class="btn sm bad" data-act="close" data-id="' + esc(x.ref) + '" data-st="BROKEN">Not paid</button>';
        if (x.kind === 'FOLLOWUP') acts += '<button class="btn sm ok" data-act="close" data-id="' + esc(x.ref) + '" data-st="DONE">Done</button>';
        if (x.kind === 'UNOPENED') acts += '<button class="btn sm" data-act="newAct" data-kind="CALL" data-bu="' + esc(x.bu) + '" data-acct="' + esc(x.account) + '"><i class="fas fa-phone"></i> Log a call</button>';
        return '<div class="wli s' + x.sev + '"><div class="ic"><i class="fas ' + (WL_ICON[x.kind] || 'fa-circle') + '"></i></div><div class="tx"><b data-act="open360" data-bu="' + esc(x.bu) + '" data-acct="' + esc(x.account) + '">' + esc(x.name || x.account) + '</b> <span class="muted small">' + esc(x.account) + ' · ' + esc((bu(x.bu) || {}).name || x.bu) + '</span><div class="t">' + esc(x.text) + '</div></div><div class="ac">' + acts + '</div></div>';
    }
    function runsTable() {
        if (!P.runs.length) return '<div class="muted small">No statement run yet.</div>';
        return '<div class="tblw" style="max-height:300px"><table class="tbl"><thead><tr><th>Started</th><th>Business unit</th><th>As at</th><th class="r">Customers</th><th class="r">E-mailed</th><th class="r">Post</th><th class="r">Failed</th><th>By</th></tr></thead><tbody>' +
            P.runs.slice(0, 15).map(function (r) {
                return '<tr class="click" data-act="runStmts" data-id="' + esc(r.RUN_ID) + '"><td>' + when(r.STARTED_AT) + (r.STATUS === 'RUNNING' ? ' ' + pill('running', 'info') : r.STATUS === 'STOPPED' ? ' ' + pill('stopped', 'warn') : '') + '</td><td>' + esc(r.BU_NAME || r.BU_ID) + '</td><td>' + esc(r.STMT_DATE) + '</td><td class="r">' + esc(r.CUSTOMERS) + '</td><td class="r">' + esc(r.EMAILED) + '</td><td class="r">' + esc(r.POSTED) + '</td><td class="r' + (+r.FAILED ? ' badc' : '') + '">' + esc(r.FAILED) + '</td><td class="small">' + esc(r.APP_USER) + '<div class="muted">' + esc(r.MACHINE || '') + '</div></td></tr>';
            }).join('') + '</tbody></table></div>';
    }

    // ══ Send statements ════════════════════════════════════════════
    function vRun() {
        var b = curBu(), R = P.run, m = mailInfo();
        if (!b) return '<div class="card note warn">No business unit is set up — add one in <a data-act="go" data-tab="setup">Setup</a>.</div>';
        var src = b.balances && b.balances.kind === 'SQL' ? 'Fusion SQL (' + esc(P.pod === S.loginPod() ? 'logged-in pod' : 'logged-in pod — the SQL runner always uses it') + ')' : 'BI Publisher · ' + esc((b.balances || {}).path || '');
        var h = '<div class="card"><div class="row"><div class="field"><label>Business unit</label><select id="r-bu">' + P.bus.filter(function (x) { return x.active !== 'N'; }).map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === b.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>Statement as at</label><input type="date" id="r-date" value="' + esc(P.stmtDate) + '"></div>' +
            '<div class="field"><label>&nbsp;</label><button class="btn pri" data-act="loadBal"><i class="fas fa-download"></i> ' + (R.customers && R.loadedFor === b.id + '|' + P.stmtDate ? 'Read the balances again' : 'Read the balances') + '</button></div>' +
            '<span class="sp"></span><div class="small muted" style="text-align:right">Balances: ' + src + '<br>Statement: ' + esc((b.statement || {}).path || '—') + '<br>Sent with <b>' + esc(m.label) + '</b> from <b>' + esc(m.mailbox || '?') + '</b>' + (m.ready ? '' : ' <span class="badc">(not ready — <a data-act="go" data-tab="setup">Setup</a>)</span>') + '</div></div></div>';
        if (R.live) return h + vLive();
        if (!R.customers || R.loadedFor !== b.id + '|' + P.stmtDate) return h + '<div class="card empty"><i class="fas fa-file-invoice-dollar" style="font-size:26px;color:var(--pri)"></i><br><br>Choose the business unit and the statement date, then <b>Read the balances</b>.<br><span class="small">The customers come from ' + src + '.</span></div>';
        var rows = runRows(), sel = rows.filter(function (r) { return R.sel[r.c.account]; });
        var nE = sel.filter(function (r) { return r.rc.delivery === 'EMAIL'; }).length, nP = sel.filter(function (r) { return r.rc.delivery === 'POST'; }).length, tot = sel.reduce(function (s, r) { return s + (r.c.balance || 0); }, 0);
        var all = R.customers, tb = all.reduce(function (s, c) { return s + (c.balance || 0); }, 0);
        h += '<div class="kpis">' + kpi('Customers', all.length, 'read ' + esc(R.loadedAt || ''), 'pri') + kpi('Total balance', money(tb), (b.currency || '') + ' as at ' + P.stmtDate, 'info') +
            kpi('By e-mail', all.filter(function (c) { return recips(c).delivery === 'EMAIL'; }).length, 'have a valid address', 'ok') + kpi('By post', all.filter(function (c) { return recips(c).delivery === 'POST'; }).length, 'no address / EMAIL_STAT = NO', 'warn') +
            kpi('Already sent', all.filter(function (c) { return sentFor(c); }).length, 'for ' + P.stmtDate, '') + '</div>';
        if (R.missing && R.missing.length) h += '<div class="note bad" style="margin-bottom:12px">The balances answer has no column for: <b>' + esc(R.missing.join(', ')) + '</b>. Columns it has: ' + esc((R.columns || []).join(', ')) + ' — map them in Setup › ' + esc(b.name) + '.</div>';
        h += '<div class="card" style="padding-bottom:0"><div class="row" style="margin-bottom:10px"><input type="search" id="r-q" placeholder="Search account, name, e-mail…" value="' + esc(R.f.q) + '" style="min-width:240px">' +
            '<select id="r-del"><option value="">E-mail and post</option><option value="EMAIL"' + (R.f.delivery === 'EMAIL' ? ' selected' : '') + '>E-mail only</option><option value="POST"' + (R.f.delivery === 'POST' ? ' selected' : '') + '>Post only</option><option value="NONE"' + (R.f.delivery === 'NONE' ? ' selected' : '') + '>No statement</option></select>' +
            '<label class="chk"><input type="checkbox" id="r-pos"' + (R.f.positive ? ' checked' : '') + '> Balance above zero</label><label class="chk"><input type="checkbox" id="r-uns"' + (R.f.unsent ? ' checked' : '') + '> Not sent yet for ' + esc(P.stmtDate) + '</label>' +
            '<span class="sp"></span><button class="btn sm" data-act="selAll">Tick all shown</button><button class="btn sm" data-act="selNone">Clear</button><button class="btn sm" data-act="runCsv"><i class="fas fa-file-csv"></i></button></div>' +
            '<div class="tblw"><table class="tbl"><thead><tr><th style="width:30px"><input type="checkbox" id="r-all"></th>' + th('account', 'Account') + th('name', 'Customer') + th('balance', 'Balance', 'r') + th('overdue', 'Overdue', 'r') + th('score', 'Priority') + '<th>Goes to</th><th>Last statement</th></tr></thead><tbody>' +
            (rows.length ? rows.map(runRow).join('') : '<tr><td colspan="8" class="empty">No customer matches the filters.</td></tr>') + '</tbody></table></div>' +
            '<div class="runbar"><b>' + sel.length + '</b> ticked · ' + nE + ' by e-mail · ' + nP + ' by post · ' + money(tot) + '<span class="sp"></span>' +
            '<button class="btn" data-act="preview"' + (sel.length ? '' : ' disabled') + '><i class="fas fa-eye"></i> Preview the e-mail</button><button class="btn pri" data-act="runStart"' + (sel.length ? '' : ' disabled') + '><i class="fas fa-paper-plane"></i> Send ' + sel.length + ' statement' + (sel.length === 1 ? '' : 's') + '</button></div></div>';
        return h;
    }
    function th(k, label, cls) { var s = P.run.sort; return '<th class="sort ' + (cls || '') + '" data-act="sortRun" data-k="' + k + '">' + label + (s.k === k ? (s.d > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }
    function recips(c) { var b = curBu(); return E.recipients(c, profileOf(b.id, c.account), b); }
    function sentFor(c) { var s = P.latest[key(curBu().id, c.account)]; return s && s.STMT_DATE === P.stmtDate && ['SENT', 'POSTED', 'DRAFT'].indexOf(s.STATUS) >= 0 ? s : null; }
    function runRows() {
        var R = P.run, q = R.f.q.trim().toLowerCase(), b = curBu();
        var rows = R.customers.map(function (c) { return { c: c, rc: recips(c), sc: c._score || { score: 0, why: [] }, last: P.latest[key(b.id, c.account)] }; }).filter(function (r) {
            if (R.f.positive && !(r.c.balance > 0)) return false;
            if (R.f.unsent && sentFor(r.c)) return false;
            if (R.f.delivery && r.rc.delivery !== R.f.delivery) return false;
            if (q && (r.c.account + ' ' + r.c.name + ' ' + r.rc.to.join(' ') + ' ' + (r.c.email || '')).toLowerCase().indexOf(q) < 0) return false;
            return true;
        });
        var s = R.sort, val = function (r) { return s.k === 'score' ? r.sc.score : s.k === 'overdue' ? (r.c.overdue || 0) : s.k === 'balance' ? r.c.balance : String(r.c[s.k] || '').toLowerCase(); };
        rows.sort(function (a, b2) { var x = val(a), y = val(b2); return (x < y ? -1 : x > y ? 1 : 0) * s.d; });
        return rows;
    }
    function runRow(r) {
        var c = r.c, rc = r.rc, b = curBu(), band = E.band(r.sc.score), sent = sentFor(c);
        var goes = rc.delivery === 'EMAIL' ? '<i class="fas fa-envelope" style="color:var(--ok)"></i> ' + esc(rc.to.join('; ')) + (rc.cc.length ? ' <span class="muted">cc ' + esc(rc.cc.join('; ')) + '</span>' : '') : rc.delivery === 'POST' ? pill('<i class="fas fa-envelopes-bulk"></i> Post', 'warn', rc.why) : pill('No statement', 'muted', rc.why);
        return '<tr' + (P.run.sel[c.account] ? ' class="sel"' : '') + '><td><input type="checkbox" class="r-ck" data-acct="' + esc(c.account) + '"' + (P.run.sel[c.account] ? ' checked' : '') + (rc.delivery === 'NONE' ? ' disabled' : '') + '></td>' +
            '<td class="mono">' + esc(c.account) + '</td><td><a data-act="open360" data-bu="' + esc(b.id) + '" data-acct="' + esc(c.account) + '">' + esc(c.name) + '</a>' + ((card(b.id, c.account) || {}).ON_HOLD === 'Y' ? ' ' + pill('hold', 'bad') : '') + '</td>' +
            '<td class="r num' + (c.balance < 0 ? ' neg' : '') + '">' + money(c.balance) + '</td><td class="r num">' + (c.overdue != null ? money(c.overdue) : '<span class="muted">—</span>') + '</td>' +
            '<td>' + pill(band.label + ' · ' + r.sc.score, band.key, r.sc.why.join(' · ')) + '</td><td class="cut" title="' + esc(rc.why) + '">' + goes + '</td>' +
            '<td>' + (r.last ? '<span class="small">' + esc(r.last.STMT_DATE) + '</span> ' + statePill(r.last) : '<span class="muted small">never</span>') + (sent ? ' ' + pill('sent for this date', 'vio') : '') + '</td></tr>';
    }
    function loadBalances() {
        var b = curBu(), date = P.stmtDate, vars = E.vars(b, date, {}), src = b.balances || {};
        var end = busy('Reading the balances of ' + b.name + '…');
        var p = src.kind === 'SQL' ? S.fusionSql(E.fill(src.sql || E.DEFAULT_SQL, vars, 'sql'), 50000)
            : S.call('dcBipRows', { instance: P.pod, path: src.path, params: E.fillParams(src.params, vars) }, 900000).then(function (d) { return d.rows || []; });
        return p.then(function (rows) {
            var m = E.customers(rows, src.map), max = m.customers.reduce(function (x, c) { return Math.max(x, c.balance || 0); }, 0);
            m.customers.forEach(function (c) { var k = key(b.id, c.account); c._score = E.score(c, { maxBalance: max, activities: actsOf(b.id, c.account), lastContact: P.contact[k], lastStatement: P.latest[k] }); });
            var R = P.run; R.customers = m.customers; R.missing = m.missing; R.columns = m.columns; R.loadedFor = b.id + '|' + date; R.loadedAt = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); R.rawCount = rows.length;
            R.sel = {}; runRows().forEach(function (r) { if (r.rc.delivery !== 'NONE') R.sel[r.c.account] = 1; });
            end(); render(); toast(m.customers.length + ' customers read (' + rows.length + ' rows)', 'ok');
        }).catch(function (e) { end(); toast(errText(e), 'bad', 9000); });
    }

    function previewHtml(b, c, opts) {
        var vars = E.vars(b, P.stmtDate, c), mail = b.mail || {}, rc = E.recipients(c, profileOf(b.id, c.account), b);
        var body = '<div style="font:14px/1.5 Segoe UI,Arial,sans-serif;color:#0f172a">' + E.fill(mail.body || E.DEFAULT_BODY, vars, 'html') + E.trackHtml(S.PUBLIC, 'preview-token-not-real', { confirm: opts.confirm, track: false }) + '</div>';
        return { to: rc.to.join('; '), cc: rc.cc.concat(E.emails(mail.cc || '').filter(function (x) { return rc.cc.indexOf(x) < 0; })).join('; '), subject: E.fill(mail.subject, vars), attach: E.fill(mail.attach || 'Statement {ACCOUNT_NUMBER}', vars) + '.pdf', html: body, rc: rc };
    }
    function runOpts(b) {
        var mail = b.mail || {}, o = P.run.opts || {};
        return { track: o.track != null ? o.track : mail.track !== false, confirm: o.confirm != null ? o.confirm : mail.confirm !== false, readReceipt: o.readReceipt != null ? o.readReceipt : !!mail.readReceipt, deliveryReceipt: o.deliveryReceipt != null ? o.deliveryReceipt : !!mail.deliveryReceipt, display: !!o.display };
    }
    function optsHtml(o, m) {
        return '<div class="row small" style="gap:14px"><label class="chk"><input type="checkbox" id="o-track"' + (o.track ? ' checked' : '') + '> See who opened it (tracking picture)</label>' +
            '<label class="chk"><input type="checkbox" id="o-confirm"' + (o.confirm ? ' checked' : '') + '> Ask the customer to agree or query the balance</label>' +
            '<label class="chk"><input type="checkbox" id="o-rr"' + (o.readReceipt ? ' checked' : '') + '> Ask for read receipts</label><label class="chk"><input type="checkbox" id="o-dr"' + (o.deliveryReceipt ? ' checked' : '') + '> Delivery receipts</label>' +
            (m.method === 'OUTLOOK' ? '<label class="chk" title="Each e-mail opens in Outlook for you to check and press Send yourself (recorded as Draft)"><input type="checkbox" id="o-disp"' + (o.display ? ' checked' : '') + '> Open each in Outlook instead of sending</label>' : '') + '</div>' +
            ((o.track || o.confirm) && P.linksOk === false ? '<div class="note warn" style="margin-top:8px">The customer links are not set up yet — opens and answers will not be recorded. <a data-act="linkSetup">Set them up</a>.</div>' : '');
    }
    function readOpts() { var g = function (id) { var e = $(id); return e ? e.checked : false; }; P.run.opts = { track: g('o-track'), confirm: g('o-confirm'), readReceipt: g('o-rr'), deliveryReceipt: g('o-dr'), display: g('o-disp') }; return P.run.opts; }
    function preview() {
        var b = curBu(), sel = runRows().filter(function (r) { return P.run.sel[r.c.account] && r.rc.delivery === 'EMAIL'; });
        if (!sel.length) { toast('None of the ticked customers is e-mailed', 'warn'); return; }
        var i = 0, o = runOpts(b), m = mailInfo();
        function paint() {
            var r = sel[i], pv = previewHtml(b, r.c, o);
            modal('<i class="fas fa-eye"></i> The e-mail · ' + (i + 1) + ' of ' + sel.length,
                '<div class="kv" style="margin-bottom:10px"><div class="k">From</div><div class="v">' + esc(m.mailbox) + ' (' + esc(m.label) + ')</div><div class="k">To</div><div class="v">' + esc(pv.to) + '</div>' + (pv.cc ? '<div class="k">Cc</div><div class="v">' + esc(pv.cc) + '</div>' : '') + '<div class="k">Attachment</div><div class="v"><i class="fas fa-file-pdf" style="color:var(--bad)"></i> ' + esc(pv.attach) + ' <span class="muted small">— made from ' + esc(b.statement.path) + ' when sending</span></div></div>' +
                '<div class="preview"><div class="subj">' + esc(pv.subject) + '</div>' + pv.html + '</div>' + optsHtml(o, m),
                '<button class="btn" data-act="pvPrev"' + (i ? '' : ' disabled') + '>◀</button><button class="btn" data-act="pvNext"' + (i < sel.length - 1 ? '' : ' disabled') + '>▶</button><span class="sp"></span><button class="btn" data-act="mclose">Close</button>', true);
            ['o-track', 'o-confirm', 'o-rr', 'o-dr', 'o-disp'].forEach(function (id) { var e = $(id); if (e) e.onchange = function () { o = readOpts(); paint(); }; });
        }
        ACT.pvPrev = function () { if (i > 0) { i--; paint(); } };
        ACT.pvNext = function () { if (i < sel.length - 1) { i++; paint(); } };
        paint();
    }
    function runConfirm() {
        var b = curBu(), sel = runRows().filter(function (r) { return P.run.sel[r.c.account] && r.rc.delivery !== 'NONE'; }), m = mailInfo(), o = runOpts(b);
        var nE = sel.filter(function (r) { return r.rc.delivery === 'EMAIL'; }).length, nP = sel.length - nE, again = sel.filter(function (r) { return sentFor(r.c); });
        if (!sel.length) return;
        if (nE && !m.ready) { toast('E-mail is not ready on this PC (' + m.label + ') — open Setup', 'bad', 6000); return; }
        modal('<i class="fas fa-paper-plane"></i> Send ' + sel.length + ' statement' + (sel.length === 1 ? '' : 's'),
            '<div class="kv"><div class="k">Business unit</div><div class="v">' + esc(b.name) + ' · ' + esc(P.pod) + '</div><div class="k">Statement as at</div><div class="v">' + esc(P.stmtDate) + '</div>' +
            '<div class="k">By e-mail</div><div class="v"><b>' + nE + '</b>' + (nE ? ' — ' + (o.display ? 'opened in Outlook for you to send' : 'sent with ' + esc(m.label) + ' from <b>' + esc(m.mailbox) + '</b>') : '') + '</div>' +
            '<div class="k">By post</div><div class="v"><b>' + nP + '</b>' + (nP ? ' — the PDFs are made and kept in one folder to print' : '') + '</div>' +
            '<div class="k">Total balance</div><div class="v">' + money(sel.reduce(function (s, r) { return s + (r.c.balance || 0); }, 0)) + '</div></div>' +
            (again.length ? '<div class="note warn" style="margin-top:12px"><b>' + again.length + ' of them already got the statement as at ' + esc(P.stmtDate) + '</b> (' + esc(again.slice(0, 6).map(function (r) { return r.c.name; }).join(', ')) + (again.length > 6 ? ' …' : '') + ') — they will receive it a second time.</div>' : '') +
            '<div style="margin-top:12px">' + optsHtml(o, m) + '</div><div class="note" style="margin-top:12px"><i class="fas fa-database"></i> Each statement is recorded in APEX before its e-mail goes out; a statement whose record cannot be written is not sent.</div>',
            '<button class="btn" data-act="mclose">Cancel</button><button class="btn pri" data-act="runGo"><i class="fas fa-paper-plane"></i> Send now</button>');
        ['o-track', 'o-confirm', 'o-rr', 'o-dr', 'o-disp'].forEach(function (id) { var e = $(id); if (e) e.onchange = readOpts; });
    }

    /** One customer's statement: PDF → record in APEX → e-mail (or post / skip) → record the outcome. */
    var sendChain = Promise.resolve();
    function processOne(ctx, c, onStep) {
        var b = ctx.bu, rc = E.recipients(c, profileOf(b.id, c.account), b), o = ctx.opts, mail = b.mail || {};
        var vars = E.vars(b, ctx.stmtDate, c), tracked = rc.delivery === 'EMAIL' && (o.track || o.confirm), tok = tracked ? E.token() : null;
        var row = { id: E.uid('st'), runId: ctx.runId, pod: ctx.pod, buId: b.id, buName: b.name, company: b.company || b.name, account: c.account, name: c.name, stmtDate: ctx.stmtDate, currency: c.currency || b.currency, balance: c.balance, overdue: c.overdue, aging: c.aging,
            delivery: rc.delivery, to: rc.to.join('; '), cc: rc.cc.join('; '), subject: rc.delivery === 'EMAIL' ? E.fill(mail.subject, vars) : null, machine: (P.info || {}).machine, token: tok, tracked: tracked, resentOf: ctx.resentOf };
        if (rc.delivery === 'NONE') { row.status = 'SKIPPED'; row.error = rc.why; return S.stmt.insert(row).then(function () { return { status: 'SKIPPED', msg: rc.why, id: row.id }; }); }
        onStep('Making the PDF…');
        return S.call('dcStatementPdf', { instance: ctx.pod, path: b.statement.path, params: E.fillParams(b.statement.params, vars), bu: b.name || b.id, stmtDate: ctx.stmtDate, fileName: c.account + ' ' + (c.name || '').slice(0, 60) + ' ' + row.id.slice(-6) }, 300000).then(function (pdf) {   // one file per statement record: a resend never overwrites a fingerprinted PDF
            row.fileName = pdf.name; row.filePath = pdf.path; row.sha = pdf.sha256; row.bytes = pdf.bytes;
            row.status = rc.delivery === 'EMAIL' ? 'GENERATED' : 'POSTED';
            onStep('Recording in APEX…');
            return S.stmt.insert(row).catch(function (e) { var x = new Error('Not sent — the record could not be written to APEX: ' + errText(e)); x.unrecorded = true; throw x; }).then(function () {
                if (rc.delivery === 'POST') return { status: 'POSTED', msg: 'PDF made for the post', id: row.id, path: pdf.path };
                // e-mails one at a time (Outlook / SMTP), PDFs may be made in parallel
                var mine = sendChain.then(function () {
                    if (ctx.stop) return { status: 'STOPPED' };
                    onStep('Sending to ' + row.to + '…');
                    var html = '<div style="font:14px/1.5 Segoe UI,Arial,sans-serif;color:#0f172a">' + E.fill(mail.body || E.DEFAULT_BODY, vars, 'html') + E.trackHtml(S.PUBLIC, tok, { track: o.track, confirm: o.confirm }) + '</div>';
                    var bcc = E.emails(mail.bcc || '').join('; ');
                    return S.call('dcSend', { to: row.to, cc: E.emails([row.cc, mail.cc].join(';')).join('; '), bcc: bcc, subject: row.subject, html: html, file: pdf.path, attachName: E.fill(mail.attach || 'Statement {ACCOUNT_NUMBER}', vars), method: ctx.method, readReceipt: o.readReceipt, deliveryReceipt: o.deliveryReceipt, display: o.display, account: c.account }, 300000)
                        .then(function (r) {
                            var st = r.result === 'draft' ? 'DRAFT' : 'SENT';
                            return S.stmt.sent(row.id, { status: st, method: r.via, mailbox: ctx.mailbox }).catch(function (e) { console.warn('[DC] outcome not recorded', e); }).then(function () { return { status: st, msg: st === 'DRAFT' ? 'Opened in Outlook' : 'Sent to ' + row.to, id: row.id }; });
                        }, function (e) {
                            return S.stmt.sent(row.id, { status: 'FAILED', error: errText(e), method: ctx.method, mailbox: ctx.mailbox }).catch(function () { }).then(function () { return { status: 'FAILED', msg: errText(e), id: row.id }; });
                        });
                });
                sendChain = mine.catch(function () { });
                return mine;
            });
        }, function (e) {
            row.status = 'FAILED'; row.error = 'PDF: ' + errText(e);
            return S.stmt.insert(row).then(function () { return { status: 'FAILED', msg: row.error, id: row.id }; }, function () { return { status: 'FAILED', msg: row.error + ' (and not recorded in APEX)', id: null }; });
        }).catch(function (e) { return { status: 'FAILED', msg: errText(e), id: e.unrecorded ? null : row.id }; });
    }
    function runStart(items, opts, resentOf) {
        var b = curBu(), m = mailInfo(), runId = E.uid('run');
        var ctx = { bu: b, stmtDate: P.stmtDate, pod: P.pod, runId: runId, opts: opts, method: m.method, mailbox: m.mailbox, stop: false, resentOf: resentOf };
        var live = P.run.live = { ctx: ctx, items: items.map(function (c) { return { c: c, status: 'WAIT', msg: '' }; }), started: Date.now(), done: 0 };
        var total = items.reduce(function (s, c) { return s + (c.balance || 0); }, 0);
        render();
        var endBusy = busy('Sending statements…');
        return S.run.start({ id: runId, pod: P.pod, buId: b.id, buName: b.name, stmtDate: P.stmtDate, title: b.name + ' · ' + P.stmtDate, customers: items.length, total: total, method: m.method, mailbox: m.mailbox, sourceKind: (b.balances || {}).kind || 'BIP', machine: (P.info || {}).machine })
            .then(function () {
                var queue = live.items.slice(), par = Math.max(1, Math.min(4, +P.general.parallelPdf || 3));
                function worker() {
                    var it = queue.shift(); if (!it) return Promise.resolve();
                    if (ctx.stop) { it.status = 'STOPPED'; it.msg = 'Not started'; paintLive(); return worker(); }
                    it.status = 'RUN'; paintLive();
                    return processOne(ctx, it.c, function (msg) { it.msg = msg; paintLive(); }).then(function (r) { it.status = r.status; it.msg = r.msg || ''; it.id = r.id; it.path = r.path; live.done++; paintLive(); return worker(); });
                }
                var ws = []; for (var i = 0; i < par; i++) ws.push(worker());
                return Promise.all(ws);
            }).then(function () {
                var c = counts(live.items);
                live.finished = Date.now();
                live.items.forEach(function (it) { if (it.status !== 'FAILED' && it.status !== 'STOPPED') delete P.run.sel[it.c.account]; });   // never ticked twice by accident
                return S.run.finish(runId, c, ctx.stop ? 'STOPPED' : 'DONE').catch(function () { });
            }, function (e) { live.error = 'The run could not be recorded in APEX, nothing was sent: ' + errText(e); live.finished = Date.now(); })
            .then(function () { endBusy(); return loadCore(); }).then(function () { S.run.list(30).then(function (r) { P.runs = r; }); render(); }, function () { render(); });
    }
    function counts(items) {
        var c = { emailed: 0, posted: 0, failed: 0, skipped: 0, drafts: 0 };
        items.forEach(function (it) { if (it.status === 'SENT') c.emailed++; else if (it.status === 'DRAFT') { c.emailed++; c.drafts++; } else if (it.status === 'POSTED') c.posted++; else if (it.status === 'FAILED') c.failed++; else c.skipped++; });
        return c;
    }
    var ICON = { WAIT: 'fa-clock muted', RUN: 'fa-spinner fa-spin', SENT: 'fa-circle-check', DRAFT: 'fa-pen-to-square', POSTED: 'fa-envelopes-bulk', FAILED: 'fa-circle-xmark', SKIPPED: 'fa-forward', STOPPED: 'fa-stop' };
    function vLive() {
        var L = P.run.live, c = counts(L.items), n = L.items.length, pct = Math.round(100 * L.done / Math.max(1, n));
        var h = '<div class="card"><h2><i class="fas fa-paper-plane"></i> ' + (L.finished ? 'Run finished' : 'Sending statements…') + ' <span class="pill">' + L.done + ' / ' + n + '</span><span class="sp"></span>' +
            (L.finished ? '<button class="btn" data-act="runStmts" data-id="' + esc(L.ctx.runId) + '"><i class="fas fa-list"></i> See them in Statements sent</button>' + (c.failed ? '<button class="btn" data-act="retryFailed"><i class="fas fa-rotate-right"></i> Send the ' + c.failed + ' failed again</button>' : '') + (c.posted ? '<button class="btn" data-act="openPostFolder"><i class="fas fa-folder-open"></i> Post PDFs</button>' : '') + '<button class="btn pri" data-act="liveClose">Done</button>'
                : '<button class="btn bad" data-act="runStop"' + (L.ctx.stop ? ' disabled' : '') + '><i class="fas fa-stop"></i> ' + (L.ctx.stop ? 'Stopping…' : 'Stop') + '</button>') + '</h2>' +
            '<div class="prog"><div style="width:' + pct + '%"></div></div><div class="row small" style="margin-top:8px;gap:16px"><span><b style="color:var(--ok)">' + c.emailed + '</b> e-mailed' + (c.drafts ? ' (' + c.drafts + ' in Outlook)' : '') + '</span><span><b>' + c.posted + '</b> for the post</span><span><b class="badc">' + c.failed + '</b> failed</span><span>' + c.skipped + ' skipped</span><span class="muted">' + Math.round(((L.finished || Date.now()) - L.started) / 1000) + ' s</span></div>' +
            (L.error ? '<div class="note bad" style="margin-top:10px">' + esc(L.error) + '</div>' : '') + '</div>';
        h += '<div class="card"><div class="tblw"><table class="tbl" id="live-t"><thead><tr><th></th><th>Account</th><th>Customer</th><th class="r">Balance</th><th>What happened</th></tr></thead><tbody>' + L.items.map(liveRow).join('') + '</tbody></table></div></div>';
        return h;
    }
    function liveRow(it) {
        var cls = it.status === 'FAILED' ? 'badc' : it.status === 'SENT' ? 'neg' : '';
        return '<tr><td><i class="fas ' + (ICON[it.status] || 'fa-circle') + ' ' + cls + '"></i></td><td class="mono">' + esc(it.c.account) + '</td><td>' + esc(it.c.name) + '</td><td class="r num">' + money(it.c.balance) + '</td><td class="small ' + cls + '">' + esc(it.status === 'WAIT' ? 'waiting' : it.msg) + '</td></tr>';
    }
    var liveT = 0;
    function paintLive() { if (liveT) return; liveT = setTimeout(function () { liveT = 0; if (P.tab === 'run' && P.run.live) render(); }, 250); }

    // ══ Statements sent ════════════════════════════════════════════
    function loadStmts() {
        var f = P.stmts.f, end = busy('Reading the statements…');
        return S.stmt.search({ from: f.days ? addDays(today(), -f.days) : null, buId: f.buId, status: f.status, resp: f.resp, runId: f.runId, account: f.account, limit: 10000 }).then(function (r) { P.stmts.rows = r; end(); if (P.tab === 'stmts') render(); }, function (e) { end(); toast(errText(e), 'bad', 7000); });
    }
    function stmtRows() {
        var f = P.stmts.f, q = String(f.q || '').toLowerCase(), st = f.state;
        var rows = (P.stmts.rows || []).filter(function (r) {
            if (st && E.stmtState(r).key !== st) return false;
            return !q || (r.ACCOUNT_NUMBER + ' ' + r.ACCOUNT_NAME + ' ' + (r.EMAIL_TO || '') + ' ' + (r.SUBJECT || '') + ' ' + (r.APP_USER || '')).toLowerCase().indexOf(q) >= 0;
        });
        var s = P.stmts.sort, num = { BALANCE: 1, OPENS: 1 };
        rows.sort(function (a, b) { var x = a[s.k], y = b[s.k]; if (num[s.k]) { x = +x || 0; y = +y || 0; } else { x = String(x || ''); y = String(y || ''); } return (x < y ? -1 : x > y ? 1 : 0) * s.d; });
        return rows;
    }
    function vStmts() {
        var f = P.stmts.f, rows = P.stmts.rows ? stmtRows() : null, k = E.kpis(rows || []);
        var h = '<div class="card"><div class="row"><input type="search" id="s-q" placeholder="Search customer, e-mail, subject, user…" value="' + esc(f.q || '') + '" style="min-width:260px">' +
            '<select id="s-days">' + [[7, 'Last 7 days'], [45, 'Last 45 days'], [90, 'Last 90 days'], [365, 'Last year'], [0, 'Everything']].map(function (o) { return '<option value="' + o[0] + '"' + (+f.days === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
            '<select id="s-bu"><option value="">Every business unit</option>' + P.bus.map(function (b) { return '<option value="' + esc(b.id) + '"' + (f.buId === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') + '</select>' +
            '<select id="s-state"><option value="">Any status</option>' + E.STATES.map(function (x) { return '<option value="' + x + '"' + (f.state === x ? ' selected' : '') + '>' + esc(E.stmtState(stateSample(x)).label) + '</option>'; }).join('') + '</select>' +
            (f.runId ? pill('one run <a data-act="clearRun">×</a>', 'vio') : '') + (f.account ? pill('account ' + esc(f.account) + ' <a data-act="clearAcct">×</a>', 'vio') : '') +
            '<span class="sp"></span><button class="btn" data-act="receipts" title="Read the read / delivery receipts and bounces that came back to the mailbox (Outlook or Microsoft 365)"><i class="fas fa-envelope-circle-check"></i> Check receipts</button><button class="btn" data-act="stmtCsv"><i class="fas fa-file-csv"></i></button><button class="btn" data-act="reloadStmts"><i class="fas fa-rotate"></i></button></div></div>';
        if (!rows) return h + '<div class="card empty"><i class="fas fa-spinner fa-spin"></i></div>';
        h += '<div class="kpis">' + kpi('Statements', k.total, money(k.value) + ' in balances', 'pri') + kpi('E-mailed', k.emailed, k.posted + ' by post', 'info') + kpi('Opened', k.openRate == null ? '—' : k.openRate + '%', k.opened + ' customers', 'info') +
            kpi('Agreed', k.agreed, 'balance confirmed', 'ok') + kpi('Queried', k.disputed, 'see Follow-ups', k.disputed ? 'bad' : '') + kpi('Failed / bounced', k.failed + k.bounced, 'send again from the row', k.failed + k.bounced ? 'bad' : '') + '</div>';
        var cols = [['CREATED_AT', 'When'], ['ACCOUNT_NAME', 'Customer'], ['STMT_DATE', 'As at'], ['BALANCE', 'Balance', 'r'], ['EMAIL_TO', 'Sent to'], ['STATUS', 'Status'], ['OPENS', 'Opens', 'r'], ['RESP_STATUS', 'Answer'], ['APP_USER', 'By']];
        h += '<div class="card"><div class="tblw"><table class="tbl"><thead><tr>' + cols.map(function (c) { var s = P.stmts.sort; return '<th class="sort ' + (c[2] || '') + '" data-act="sortStmts" data-k="' + c[0] + '">' + c[1] + (s.k === c[0] ? (s.d > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
            (rows.length ? rows.slice(0, 1500).map(function (r) {
                return '<tr class="click" data-act="stmt" data-id="' + esc(r.STMT_ID) + '"><td class="small">' + when(r.SENT_AT || r.CREATED_AT) + '</td><td><b>' + esc(r.ACCOUNT_NAME) + '</b><div class="muted small">' + esc(r.ACCOUNT_NUMBER) + ' · ' + esc(r.BU_NAME || '') + '</div></td><td>' + esc(r.STMT_DATE) + '</td><td class="r num">' + money(+r.BALANCE) + '</td>' +
                    '<td class="cut small">' + (r.DELIVERY === 'EMAIL' ? esc(r.EMAIL_TO) : '<span class="muted">' + esc(r.DELIVERY === 'POST' ? 'by post' : r.DELIVERY || '') + '</span>') + '</td><td>' + statePill(r) + (r.RESENT_OF ? ' ' + pill('resend', 'vio') : '') + '</td><td class="r">' + (r.TRACKED === 'Y' ? esc(r.OPENS || 0) : '<span class="muted">—</span>') + '</td>' +
                    '<td>' + (r.RESP_STATUS ? pill(r.RESP_STATUS === 'AGREED' ? 'Agreed' : 'Queried', r.RESP_STATUS === 'AGREED' ? 'ok' : 'bad', r.RESP_COMMENT || '') : '') + '</td><td class="small">' + esc(r.APP_USER) + '</td></tr>';
            }).join('') + (rows.length > 1500 ? '<tr><td colspan="9" class="muted small">' + (rows.length - 1500) + ' more — narrow the search or export CSV</td></tr>' : '') : '<tr><td colspan="9" class="empty">No statement matches.</td></tr>') + '</tbody></table></div></div>';
        return h;
    }
    function stateSample(k) { return { FAILED: { STATUS: 'FAILED' }, BOUNCED: { BOUNCED_AT: 1 }, DISPUTED: { RESP_STATUS: 'DISPUTED' }, AGREED: { RESP_STATUS: 'AGREED' }, READ: { READ_AT: 1 }, OPENED: { OPENS: 1 }, DELIVERED: { DELIVERED_AT: 1 }, SENT: { STATUS: 'SENT' }, DRAFT: { STATUS: 'DRAFT' }, POSTED: { STATUS: 'POSTED' }, SKIPPED: { STATUS: 'SKIPPED' }, GENERATED: {} }[k] || {}; }
    function findStmt(id) {
        var all = (P.stmts.rows || []).concat(P.recent, Object.keys(P.latest).map(function (k) { return P.latest[k]; }), (P.cust.data && P.cust.data.stmts) || []);
        return all.filter(function (s) { return s.STMT_ID === id; })[0] || null;
    }
    function stmtDialog(id) {
        var s = findStmt(id); if (!s) { toast('Statement not found — refresh', 'warn'); return; }
        var st = E.stmtState(s), aging = null; try { aging = s.AGING_JSON ? JSON.parse(s.AGING_JSON) : null; } catch (e) { }
        var steps = [['Recorded', s.CREATED_AT, true], ['PDF made', s.GENERATED_AT, !!s.SHA256], [s.STATUS === 'POSTED' ? 'For the post' : s.STATUS === 'DRAFT' ? 'Opened in Outlook' : 'Sent', s.SENT_AT, ['SENT', 'POSTED', 'DRAFT'].indexOf(s.STATUS) >= 0], ['Delivered', s.DELIVERED_AT, !!s.DELIVERED_AT], ['Opened', s.FIRST_OPEN, +s.OPENS > 0], ['Read', s.READ_AT, !!s.READ_AT], [s.RESP_STATUS === 'DISPUTED' ? 'Queried' : 'Agreed', s.RESP_AT, !!s.RESP_STATUS]];
        var h = '<div class="steps" style="margin-bottom:12px">' + steps.map(function (x) { return '<span class="st ' + (x[2] ? (x[0] === 'Queried' ? 'bad' : 'done') : '') + '"><i class="fas ' + (x[2] ? 'fa-check' : 'fa-minus') + '"></i> ' + esc(x[0]) + (x[1] && x[2] ? ' · ' + when(x[1]) : '') + '</span>'; }).join('') + (s.STATUS === 'FAILED' ? '<span class="st bad"><i class="fas fa-xmark"></i> Failed</span>' : '') + (s.BOUNCED_AT ? '<span class="st bad"><i class="fas fa-xmark"></i> Bounced · ' + when(s.BOUNCED_AT) + '</span>' : '') + '</div>';
        if (s.ERROR_TEXT) h += '<div class="note bad" style="margin-bottom:10px">' + esc(s.ERROR_TEXT) + '</div>';
        if (s.RESP_STATUS) h += '<div class="note ' + (s.RESP_STATUS === 'DISPUTED' ? 'bad' : '') + '" style="margin-bottom:10px"><b>The customer ' + (s.RESP_STATUS === 'DISPUTED' ? 'queried' : 'agreed') + ' the balance</b> · ' + when(s.RESP_AT) + (s.RESP_COMMENT ? '<div style="margin-top:4px;white-space:pre-wrap">"' + esc(s.RESP_COMMENT) + '"</div>' : '') + '</div>';
        h += '<div class="kv">' + [['Customer', esc(s.ACCOUNT_NAME) + ' · ' + esc(s.ACCOUNT_NUMBER)], ['Business unit', esc(s.BU_NAME || s.BU_ID) + ' · ' + esc(s.POD || '')], ['Statement as at', esc(s.STMT_DATE)], ['Balance', esc(s.CURRENCY || '') + ' ' + money(+s.BALANCE) + (s.OVERDUE != null && s.OVERDUE !== '' ? ' · overdue ' + money(+s.OVERDUE) : '')],
            ['Aging', aging ? 'current ' + money(aging.current) + ' · 1–30 ' + money(aging.d30) + ' · 31–60 ' + money(aging.d60) + ' · 61–90 ' + money(aging.d90) + ' · 90+ ' + money(aging.d90p) : '<span class="muted">not in the source</span>'],
            ['Delivery', esc(s.DELIVERY)], ['To', esc(s.EMAIL_TO || '')], ['Cc', esc(s.EMAIL_CC || '')], ['Subject', esc(s.SUBJECT || '')], ['Sent with', esc(s.METHOD || '') + (s.MAILBOX ? ' · from ' + esc(s.MAILBOX) : '')],
            ['PDF', esc(s.FILE_NAME || '') + (s.BYTES_N ? ' · ' + Math.round(+s.BYTES_N / 1024) + ' KB' : '')], ['Fingerprint (SHA-256)', '<span class="mono small">' + esc(s.SHA256 || '') + '</span>'], ['Made on', esc(s.MACHINE || '') + ' · ' + esc(s.FILE_PATH || '')],
            ['By', esc(s.APP_USER || '')], ['Tracking', s.TRACKED === 'Y' ? esc(s.OPENS || 0) + ' open' + (+s.OPENS === 1 ? '' : 's') + (s.LAST_OPEN ? ' · last ' + when(s.LAST_OPEN) : '') + (s.LAST_AGENT ? '<div class="muted small">' + esc(String(s.LAST_AGENT).slice(0, 160)) + '</div>' : '') : 'off'],
            ['Bounce', esc(s.BOUNCE_TEXT || '')], ['Record id', '<span class="mono small">' + esc(s.STMT_ID) + '</span>' + (s.RESENT_OF ? ' · resend of <a data-act="stmt" data-id="' + esc(s.RESENT_OF) + '">' + esc(s.RESENT_OF) + '</a>' : '')]]
            .filter(function (x) { return x[1] !== '' && x[1] != null; }).map(function (x) { return '<div class="k">' + x[0] + '</div><div class="v">' + x[1] + '</div>'; }).join('') + '</div>';
        var mine = P.info && s.MACHINE === P.info.machine;
        modal('<i class="fas fa-file-invoice"></i> Statement · ' + esc(s.ACCOUNT_NAME) + ' ' + pill(st.label, st.cls), h,
            (mine && s.FILE_PATH ? '<button class="btn" data-act="openFile" data-path="' + esc(s.FILE_PATH) + '"><i class="fas fa-file-pdf"></i> Open the PDF</button><button class="btn" data-act="verify" data-id="' + esc(s.STMT_ID) + '"><i class="fas fa-fingerprint"></i> Check it is the same file</button>' : (s.FILE_PATH ? '<span class="small muted">The PDF is on ' + esc(s.MACHINE || 'another PC') + '</span>' : '')) +
            '<span class="sp"></span><button class="btn" data-act="open360" data-bu="' + esc(s.BU_ID) + '" data-acct="' + esc(s.ACCOUNT_NUMBER) + '"><i class="fas fa-user"></i> Customer</button>' + (s.RESP_STATUS === 'DISPUTED' ? '<button class="btn" data-act="resolveStmt" data-id="' + esc(s.STMT_ID) + '">Resolve the query</button>' : '') +
            (s.DELIVERY === 'EMAIL' || s.STATUS === 'FAILED' ? '<button class="btn pri" data-act="resend" data-id="' + esc(s.STMT_ID) + '"><i class="fas fa-rotate-right"></i> Send again</button>' : ''), true);
    }
    /** Read / delivery receipts and bounces from the sending mailbox → delivered_at / read_at / bounced_at */
    function receipts() {
        var rows = (P.stmts.rows || []).filter(function (r) { return r.STATUS === 'SENT' && r.SUBJECT && (!r.READ_AT || !r.DELIVERED_AT) && !r.BOUNCED_AT && r.METHOD !== 'SMTP'; });
        if (!rows.length) { toast('Nothing is waiting for a receipt (SMTP receipts arrive in that mailbox only)', 'warn', 5000); return; }
        var methods = {}; rows.forEach(function (r) { methods[r.METHOD || 'OUTLOOK'] = 1; });
        var since = rows.reduce(function (m, r) { return String(r.SENT_AT || '') < m ? String(r.SENT_AT) : m; }, '9999'), sinceD = new Date(Date.parse(since.replace(' ', 'T') + ':00Z') + (S.offset || 0) + new Date().getTimezoneOffset() * 60000 - 3600000);   // DB wall time → PC wall time → the real moment, an hour early
        var subjects = Object.keys(rows.reduce(function (o, r) { o[r.SUBJECT] = 1; return o; }, {})), addrs = Object.keys(rows.reduce(function (o, r) { E.emails(r.EMAIL_TO).forEach(function (a) { o[a] = 1; }); return o; }, {}));
        var end = busy('Reading receipts from the mailbox…'), found = [];
        Object.keys(methods).reduce(function (p, m) {
            return p.then(function () { return S.host('finMailReceipts', { method: m, since: sinceD.toISOString(), subjects: subjects, addresses: addrs }, 300000).then(function (r) { if (r && r.ok) found = found.concat(r.receipts || []); else toast((r && r.error) || 'Receipts not read', 'bad', 6000); }); });
        }, Promise.resolve()).then(function () {
            var sqls = [];
            found.forEach(function (x) {
                var at = new Date(x.At || x.at || Date.now()), em = String(x.Email || x.email || '').toLowerCase(), subj = x.Subject || x.subject, kind = x.Kind || x.kind;
                var col = { READ: 'read_at', DELIVERED: 'delivered_at', BOUNCED: 'bounced_at' }[kind]; if (!col) return;
                var cand = rows.filter(function (r) { return r.SUBJECT === subj && E.emails(r.EMAIL_TO).indexOf(em) >= 0; }).sort(function (a, b) { return String(b.SENT_AT).localeCompare(String(a.SENT_AT)); })[0];
                if (!cand) return;
                var w = new Date(at.getTime() - at.getTimezoneOffset() * 60000 - (S.offset || 0)), lit = "TO_DATE('" + w.toISOString().slice(0, 19).replace('T', ' ') + "', 'YYYY-MM-DD HH24:MI:SS')";
                sqls.push('UPDATE wms_dc_stmts SET ' + col + ' = NVL(' + col + ', ' + lit + ')' + (kind === 'BOUNCED' ? ', bounce_text = ' + S.lit(x.Detail || x.detail || '', 1000) : '') + (kind === 'READ' ? ', delivered_at = NVL(delivered_at, ' + lit + ')' : '') + ' WHERE stmt_id = ' + S.lit(cand.STMT_ID));
            });
            return sqls.reduce(function (p, q) { return p.then(function () { return S.write(q); }); }, Promise.resolve()).then(function () { end(); toast(found.length ? sqls.length + ' receipt' + (sqls.length === 1 ? '' : 's') + ' matched (' + found.length + ' found)' : 'No new receipts in the mailbox', 'ok'); return loadStmts(); });
        }).catch(function (e) { end(); toast(errText(e), 'bad', 7000); });
    }

    // ══ Customers + Customer 360 ═══════════════════════════════════
    function custList() {
        var b = curBu(), map = {}, R = P.run;
        function add(buId, acct, name) { var k = key(buId, acct); if (!map[k]) map[k] = { buId: buId, account: acct, name: name || '' }; else if (!map[k].name && name) map[k].name = name; return map[k]; }
        if (R.customers && R.loadedFor && R.loadedFor.split('|')[0] === b.id) R.customers.forEach(function (c) { var x = add(b.id, c.account, c.name); x.c = c; });
        Object.keys(P.cards).forEach(function (k) { var c = P.cards[k]; if (c.BU_ID === b.id) add(c.BU_ID, c.ACCOUNT_NUMBER, c.ACCOUNT_NAME); });
        Object.keys(P.latest).forEach(function (k) { var s = P.latest[k]; if (s.BU_ID === b.id) add(s.BU_ID, s.ACCOUNT_NUMBER, s.ACCOUNT_NAME); });
        P.acts.forEach(function (a) { if (a.BU_ID === b.id) add(a.BU_ID, a.ACCOUNT_NUMBER, a.ACCOUNT_NAME); });
        return Object.keys(map).map(function (k) {
            var x = map[k], last = P.latest[k], acts = actsOf(x.buId, x.account), cardx = P.cards[k] || {};
            x.last = last; x.card = cardx; x.contact = P.contact[k];
            x.balance = x.c ? x.c.balance : last ? +last.BALANCE : null; x.balAt = x.c ? P.stmtDate : last ? last.STMT_DATE : null;
            x.score = x.c && x.c._score ? x.c._score : E.score({ balance: x.balance || 0, overdue: last && last.OVERDUE != null ? +last.OVERDUE : null, aging: last && last.AGING_JSON ? safeJson(last.AGING_JSON) : null }, { maxBalance: maxBal(), activities: acts, lastContact: x.contact, lastStatement: last });
            x.promises = acts.filter(function (a) { return a.KIND === 'PROMISE' && a.STATUS === 'OPEN'; });
            x.disputes = acts.filter(function (a) { return a.KIND === 'DISPUTE' && a.STATUS === 'OPEN'; }).length;
            return x;
        });
    }
    var _max = null; function maxBal() { if (_max != null) return _max; _max = 1; Object.keys(P.latest).forEach(function (k) { _max = Math.max(_max, +P.latest[k].BALANCE || 0); }); setTimeout(function () { _max = null; }, 2000); return _max; }
    function safeJson(s) { try { return JSON.parse(s); } catch (e) { return null; } }
    function vCust() {
        if (P.cust.open) return v360();
        var b = curBu(); if (!b) return '<div class="card note warn">Set up a business unit first.</div>';
        var q = P.cust.q.toLowerCase(), fl = P.cust.filter;
        var all = custList(), rows = all.filter(function (x) {
            if (q && (x.account + ' ' + x.name + ' ' + (x.card.TAGS || '') + ' ' + (x.card.OWNER_USER || '')).toLowerCase().indexOf(q) < 0) return false;
            if (fl === 'high' && x.score.score < 70) return false;
            if (fl === 'disp' && !x.disputes) return false;
            if (fl === 'prom' && !x.promises.length) return false;
            if (fl === 'hold' && x.card.ON_HOLD !== 'Y') return false;
            if (fl === 'mine' && (x.card.OWNER_USER || '').toLowerCase() !== S.user().toLowerCase()) return false;
            if (fl === 'noemail' && E.recipients(x.c || { email: x.last ? x.last.EMAIL_TO : '' }, profileOf(x.buId, x.account), b).delivery !== 'POST') return false;
            return true;
        }).sort(function (a, b2) { return b2.score.score - a.score.score || (b2.balance || 0) - (a.balance || 0); });
        var h = '<div class="card"><div class="row"><select id="c-bu">' + P.bus.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === b.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>' +
            '<input type="search" id="c-q" placeholder="Search account, name, tag, collector…" value="' + esc(P.cust.q) + '" style="min-width:260px"><div class="seg" id="c-f">' +
            [['', 'All'], ['high', 'High priority'], ['disp', 'Disputes'], ['prom', 'Promises'], ['noemail', 'By post'], ['hold', 'On hold'], ['mine', 'Mine']].map(function (x) { return '<button data-f="' + x[0] + '"' + (fl === x[0] ? ' class="on"' : '') + '>' + x[1] + '</button>'; }).join('') + '</div><span class="sp"></span>' +
            (P.run.customers && P.run.loadedFor && P.run.loadedFor.split('|')[0] === b.id ? '<span class="small muted">balances as at ' + esc(P.stmtDate) + '</span>' : '<span class="small muted">balances from the last statement — <a data-act="go" data-tab="run">read today\'s</a></span>') + '</div></div>';
        h += '<div class="card"><div class="tblw"><table class="tbl"><thead><tr><th>Account</th><th>Customer</th><th class="r">Balance</th><th>Priority</th><th>Last statement</th><th>Last contact</th><th>Promises</th><th>Collector</th></tr></thead><tbody>' +
            (rows.length ? rows.slice(0, 1000).map(function (x) {
                var band = E.band(x.score.score), pAmt = x.promises.reduce(function (s, a) { return s + (+a.AMOUNT || 0); }, 0);
                return '<tr class="click" data-act="open360" data-bu="' + esc(x.buId) + '" data-acct="' + esc(x.account) + '"><td class="mono">' + esc(x.account) + '</td><td><b>' + esc(x.name) + '</b>' + (x.card.ON_HOLD === 'Y' ? ' ' + pill('hold', 'bad') : '') + (x.disputes ? ' ' + pill('dispute', 'bad') : '') + (x.card.TAGS ? '<div class="small muted">' + esc(x.card.TAGS) + '</div>' : '') + '</td>' +
                    '<td class="r num">' + (x.balance != null ? money(x.balance) + '<div class="small muted">' + esc(x.balAt || '') + '</div>' : '<span class="muted">—</span>') + '</td><td>' + pill(band.label + ' · ' + x.score.score, band.key, x.score.why.join(' · ')) + '</td>' +
                    '<td>' + (x.last ? statePill(x.last) + '<div class="small muted">' + esc(x.last.STMT_DATE) + '</div>' : '<span class="muted small">never</span>') + '</td><td class="small">' + esc(x.contact || '') + '</td><td>' + (x.promises.length ? money(pAmt) + ' <span class="muted small">(' + x.promises.length + ')</span>' : '') + '</td><td class="small">' + esc(x.card.OWNER_USER || '') + '</td></tr>';
            }).join('') : '<tr><td colspan="8" class="empty">No customer yet — read the balances in <a data-act="go" data-tab="run">Send statements</a>, or search.</td></tr>') + '</tbody></table></div></div>';
        return h;
    }
    function open360(buId, acct) { P.cust.open = { buId: buId, account: acct }; P.cust.data = null; P.cust.sub = P.cust.sub || 'timeline'; mclose(); if (P.tab !== 'cust') go('cust'); else render(); }
    function load360() {
        var o = P.cust.open, end = busy('Reading the customer…');
        Promise.all([S.stmt.search({ buId: o.buId, account: o.account, limit: 500 }), S.act.list({ buId: o.buId, account: o.account, limit: 2000 })]).then(function (r) {
            end(); if (!P.cust.open || P.cust.open.account !== o.account) return;
            P.cust.data = { stmts: r[0], acts: r[1] }; render();
        }, function (e) { end(); toast(errText(e), 'bad', 7000); P.cust.data = { stmts: [], acts: [] }; render(); });
    }
    function v360() {
        var o = P.cust.open, b = bu(o.buId) || { id: o.buId, name: o.buId }, d = P.cust.data, cd = card(o.buId, o.account) || {};
        var c = P.run.customers && P.run.loadedFor && P.run.loadedFor.split('|')[0] === o.buId ? P.run.customers.filter(function (x) { return x.account === o.account; })[0] : null;
        var last = P.latest[key(o.buId, o.account)], name = (c && c.name) || cd.ACCOUNT_NAME || (last && last.ACCOUNT_NAME) || o.account;
        var bal = c ? c.balance : last ? +last.BALANCE : null, aging = c && c.aging ? c.aging : last && last.AGING_JSON ? safeJson(last.AGING_JSON) : null;
        var acts = d ? d.acts : actsOf(o.buId, o.account), sc = E.score({ balance: bal || 0, aging: aging, overdue: c ? c.overdue : last && last.OVERDUE != null ? +last.OVERDUE : null }, { maxBalance: maxBal(), activities: acts, lastContact: P.contact[key(o.buId, o.account)], lastStatement: last }), band = E.band(sc.score);
        var rc = E.recipients(c || { email: last ? last.EMAIL_TO : '' }, profileOf(o.buId, o.account), b);
        var h = '<div class="card"><div class="row" style="margin-bottom:10px"><button class="btn sm" data-act="back360"><i class="fas fa-arrow-left"></i> Customers</button><span class="sp"></span>' +
            '<button class="btn sm" data-act="newAct" data-kind="CALL" data-bu="' + esc(o.buId) + '" data-acct="' + esc(o.account) + '"><i class="fas fa-phone"></i> Log a call</button>' +
            '<button class="btn sm" data-act="newAct" data-kind="NOTE" data-bu="' + esc(o.buId) + '" data-acct="' + esc(o.account) + '"><i class="fas fa-note-sticky"></i> Note</button>' +
            '<button class="btn sm" data-act="newAct" data-kind="PROMISE" data-bu="' + esc(o.buId) + '" data-acct="' + esc(o.account) + '"><i class="fas fa-handshake"></i> Promise to pay</button>' +
            '<button class="btn sm" data-act="newAct" data-kind="TASK" data-bu="' + esc(o.buId) + '" data-acct="' + esc(o.account) + '"><i class="fas fa-list-check"></i> Follow-up</button>' +
            '<button class="btn sm" data-act="newAct" data-kind="DISPUTE" data-bu="' + esc(o.buId) + '" data-acct="' + esc(o.account) + '"><i class="fas fa-triangle-exclamation"></i> Dispute</button>' +
            '<button class="btn sm" data-act="editCard" data-bu="' + esc(o.buId) + '" data-acct="' + esc(o.account) + '"><i class="fas fa-pen"></i> Card</button>' +
            '<button class="btn sm pri" data-act="sendOne" data-bu="' + esc(o.buId) + '" data-acct="' + esc(o.account) + '"><i class="fas fa-paper-plane"></i> Send a statement</button></div>' +
            '<div class="c360h"><div class="av">' + esc(String(name).replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?') + '</div><div style="flex:1;min-width:260px"><div class="nm">' + esc(name) + ' ' + (cd.ON_HOLD === 'Y' ? pill('credit hold', 'bad') : '') + '</div>' +
            '<div class="muted small">' + esc(o.account) + ' · ' + esc(b.name) + (cd.OWNER_USER ? ' · collector ' + esc(cd.OWNER_USER) : '') + (cd.TAGS ? ' · ' + esc(cd.TAGS) : '') + '</div>' +
            '<div class="facts"><span><i class="fas fa-envelope"></i> ' + (rc.delivery === 'EMAIL' ? esc(rc.to.join('; ')) : '<span class="warnc">' + esc(rc.why) + '</span>') + '</span>' + (cd.PHONE ? '<span><i class="fas fa-phone"></i> ' + esc(cd.PHONE) + '</span>' : '') + (cd.CONTACT_NAME ? '<span><i class="fas fa-user"></i> ' + esc(cd.CONTACT_NAME) + '</span>' : '') + '</div>' +
            '<div class="why" style="margin-top:8px">' + pill('Priority ' + band.label + ' · ' + sc.score, band.key) + sc.why.map(function (w) { return pill(esc(w), 'muted'); }).join('') + '</div></div>' +
            '<div style="min-width:280px"><div class="muted small">Balance' + (c ? ' as at ' + esc(P.stmtDate) : last ? ' on the statement of ' + esc(last.STMT_DATE) : '') + '</div><div style="font-size:26px;font-weight:800" class="num">' + (bal != null ? money(bal) : '—') + '</div>' + agingBar(aging, bal) + '</div></div>' +
            (cd.NOTES ? '<div class="note" style="margin-top:10px;white-space:pre-wrap">' + esc(cd.NOTES) + '</div>' : '') + '</div>';
        if (!d) return h + '<div class="card empty"><i class="fas fa-spinner fa-spin"></i></div>';
        var sub = P.cust.sub, open = d.acts.filter(function (a) { return a.STATUS === 'OPEN' && a.KIND !== 'CONFIRM'; });
        h += '<div class="card"><div class="subtabs">' + [['timeline', 'Timeline'], ['stmts', 'Statements (' + d.stmts.length + ')'], ['open', 'Open items (' + open.length + ')']].map(function (x) { return '<button data-act="sub360" data-s="' + x[0] + '"' + (sub === x[0] ? ' class="on"' : '') + '>' + x[1] + '</button>'; }).join('') + '</div>';
        if (sub === 'stmts') h += '<div class="tblw"><table class="tbl"><thead><tr><th>When</th><th>As at</th><th class="r">Balance</th><th>To</th><th>Status</th><th>Answer</th><th>By</th></tr></thead><tbody>' + (d.stmts.length ? d.stmts.map(function (s) { return '<tr class="click" data-act="stmt" data-id="' + esc(s.STMT_ID) + '"><td class="small">' + when(s.SENT_AT || s.CREATED_AT) + '</td><td>' + esc(s.STMT_DATE) + '</td><td class="r num">' + money(+s.BALANCE) + '</td><td class="cut small">' + esc(s.EMAIL_TO || s.DELIVERY) + '</td><td>' + statePill(s) + '</td><td>' + (s.RESP_STATUS ? pill(s.RESP_STATUS === 'AGREED' ? 'Agreed' : 'Queried', s.RESP_STATUS === 'AGREED' ? 'ok' : 'bad') : '') + '</td><td class="small">' + esc(s.APP_USER) + '</td></tr>'; }).join('') : '<tr><td colspan="7" class="empty">No statement sent yet.</td></tr>') + '</tbody></table></div>';
        else if (sub === 'open') h += open.length ? '<div class="wl">' + open.map(actItem).join('') + '</div>' : '<div class="empty">Nothing open for this customer.</div>';
        else {
            var tl = E.timeline(d.stmts, d.acts);
            h += tl.length ? '<div class="tl">' + tl.map(function (x) {
                var k = E.KINDS[x.kind] || E.KINDS.NOTE, a = x.act, s = x.stmt;
                var meta = when(x.at) + (x.by ? ' · ' + esc(x.by) : '') + (a && a.AMOUNT != null && a.AMOUNT !== '' ? ' · ' + money(+a.AMOUNT) : '') + (a && a.DUE_DATE ? ' · by ' + esc(a.DUE_DATE) : '') + (a && a.STATUS && a.STATUS !== 'OPEN' && a.STATUS !== 'DONE' ? ' · ' + esc(a.STATUS.toLowerCase()) : '') + (a && a.OUTCOME ? ' · ' + esc(a.OUTCOME) : '');
                var body = x.kind === 'STATEMENT' ? statePill(s) + ' <span class="small">' + money(+s.BALANCE) + ' · ' + esc(s.DELIVERY === 'EMAIL' ? s.EMAIL_TO : s.DELIVERY) + '</span> <a class="small" data-act="stmt" data-id="' + esc(s.STMT_ID) + '">details</a>' : esc(x.body || '');
                return '<div class="tli ' + esc(x.kind) + '"><div class="dot"><i class="fas ' + k.icon + '"></i></div><div class="h">' + esc(x.title) + (a && a.STATUS === 'OPEN' && x.kind !== 'CONFIRM' ? ' ' + pill('open', 'warn') : '') + '</div><div class="m">' + meta + '</div><div class="b">' + body + '</div></div>';
            }).join('') + '</div>' : '<div class="empty">No history yet — log a call, add a note or send a statement.</div>';
        }
        return h + '</div>';
    }
    function agingBar(a, bal) {
        if (!a) return '';
        var parts = [['current', '#10b981', 'Current'], ['d30', '#84cc16', '1–30'], ['d60', '#f59e0b', '31–60'], ['d90', '#f97316', '61–90'], ['d90p', '#dc2626', '90+']], tot = parts.reduce(function (s, p) { return s + Math.max(0, a[p[0]] || 0); }, 0) || 1;
        return '<div class="aging">' + parts.map(function (p) { var v = Math.max(0, a[p[0]] || 0); return v ? '<span style="width:' + (100 * v / tot) + '%;background:' + p[1] + '" title="' + p[2] + ': ' + money(a[p[0]]) + '"></span>' : ''; }).join('') + '</div><div class="legend">' + parts.map(function (p) { return '<span><i style="background:' + p[1] + '"></i>' + p[2] + ' ' + money(a[p[0]] || 0, 0) + '</span>'; }).join('') + '</div>';
    }
    function actItem(a) {
        var st = E.actState(a), k = E.KINDS[a.KIND] || E.KINDS.NOTE, sev = st === 'LATE' ? 3 : st === 'DUE' ? 2 : 1;
        var btns = a.KIND === 'PROMISE' ? '<button class="btn sm ok" data-act="close" data-id="' + esc(a.ACT_ID) + '" data-st="KEPT">Paid</button><button class="btn sm bad" data-act="close" data-id="' + esc(a.ACT_ID) + '" data-st="BROKEN">Not paid</button>'
            : a.KIND === 'DISPUTE' ? '<button class="btn sm ok" data-act="close" data-id="' + esc(a.ACT_ID) + '" data-st="RESOLVED" data-ask="1">Resolve</button>'
                : '<button class="btn sm ok" data-act="close" data-id="' + esc(a.ACT_ID) + '" data-st="DONE">Done</button>';
        return '<div class="wli s' + sev + '"><div class="ic"><i class="fas ' + k.icon + '"></i></div><div class="tx"><b data-act="open360" data-bu="' + esc(a.BU_ID) + '" data-acct="' + esc(a.ACCOUNT_NUMBER) + '">' + esc(a.ACCOUNT_NAME || a.ACCOUNT_NUMBER) + '</b> <span class="muted small">' + esc(k.label) + (a.DUE_DATE ? ' · ' + (st === 'LATE' ? '<span class="badc">was due ' + esc(a.DUE_DATE) + '</span>' : st === 'DUE' ? '<span class="warnc">due today</span>' : 'due ' + esc(a.DUE_DATE)) : '') + (a.ASSIGNED_TO ? ' · for ' + esc(a.ASSIGNED_TO) : '') + (a.SOURCE === 'CUSTOMER' ? ' · from the customer' : '') + '</span>' +
            '<div class="t">' + esc(a.SUBJECT || '') + (a.AMOUNT != null && a.AMOUNT !== '' ? ' · <b>' + money(+a.AMOUNT) + '</b>' : '') + (a.BODY ? '<div class="small muted" style="white-space:pre-wrap">' + esc(String(a.BODY).slice(0, 400)) + '</div>' : '') + '</div></div><div class="ac">' + btns + '</div></div>';
    }

    // ── dialogs: activity, card, one statement ─────────────────────
    function nameOf(buId, acct) {
        var c = P.run.customers && P.run.customers.filter(function (x) { return x.account === acct; })[0];
        return (c && c.name) || (card(buId, acct) || {}).ACCOUNT_NAME || (P.latest[key(buId, acct)] || {}).ACCOUNT_NAME || acct;
    }
    function actDialog(kind, buId, acct, ref) {
        var k = E.KINDS[kind] || E.KINDS.NOTE, nm = nameOf(buId, acct), needsDate = kind === 'PROMISE' || kind === 'TASK', canDate = kind !== 'NOTE' && kind !== 'DISPUTE';
        var subj = { CALL: 'Called the customer', PROMISE: 'Promised to pay', TASK: 'Follow up', DISPUTE: 'Disputed balance', NOTE: '', VISIT: 'Visited the customer', EMAIL: 'E-mailed the customer' }[kind] || '';
        modal('<i class="fas ' + k.icon + '"></i> ' + esc(k.label) + ' · ' + esc(nm),
            '<div class="form"><div class="field wide"><label>Subject</label><input type="text" id="a-subj" value="' + esc(subj) + '"></div>' +
            '<div class="field wide"><label>' + (kind === 'CALL' ? 'What was said' : 'Details') + '</label><textarea id="a-body" rows="4" placeholder="' + (kind === 'DISPUTE' ? 'Which invoices, why, what the customer expects…' : '') + '"></textarea></div>' +
            (kind === 'PROMISE' || kind === 'DISPUTE' ? '<div class="field"><label>' + (kind === 'PROMISE' ? 'Amount promised' : 'Amount in dispute') + '</label><input type="number" step="0.01" id="a-amt"></div>' : '') +
            (canDate ? '<div class="field"><label>' + (kind === 'PROMISE' ? 'Pay by' : kind === 'TASK' ? 'Follow up on' : 'Follow up on (optional)') + '</label><input type="date" id="a-due" value="' + (needsDate ? addDays(today(), kind === 'PROMISE' ? 7 : +P.general.followupDays || 7) : '') + '"></div>' : '') +
            '<div class="field"><label>For</label><input type="text" id="a-to" list="dc-users" value="' + esc((card(buId, acct) || {}).OWNER_USER || S.user()) + '"><datalist id="dc-users">' + (P.general.collectors || []).map(function (u) { return '<option value="' + esc(u) + '">'; }).join('') + '</datalist></div></div>',
            '<button class="btn" data-act="mclose">Cancel</button><button class="btn pri" data-act="actSave">Save</button>');
        ACT.actSave = function () {
            var due = $('a-due') ? $('a-due').value : '', amt = $('a-amt') ? $('a-amt').value : '';
            if (needsDate && !due) { toast('Choose a date', 'warn'); return; }
            var status = kind === 'NOTE' || ((kind === 'CALL' || kind === 'VISIT' || kind === 'EMAIL') && !due) ? 'DONE' : 'OPEN';
            var a = { id: E.uid('ac'), buId: buId, account: acct, name: nm, kind: kind, subject: $('a-subj').value.trim(), body: $('a-body').value.trim(), amount: amt === '' ? null : +amt, due: due || null, status: status, ref: ref || null, assignedTo: $('a-to').value.trim() };
            var end = busy('Saving…');
            S.act.add(a).then(function () { end(); mclose(); toast('Saved on the customer\'s timeline', 'ok'); P.cust.data = null; return loadCore(); }).then(render, function (e) { end(); toast(errText(e), 'bad', 7000); });
        };
    }
    function cardDialog(buId, acct) {
        var c = card(buId, acct) || {}, nm = nameOf(buId, acct);
        var f = function (id, label, v, ph, wide) { return '<div class="field' + (wide ? ' wide' : '') + '"><label>' + label + '</label><input type="text" id="' + id + '" value="' + esc(v || '') + '" placeholder="' + esc(ph || '') + '"></div>'; };
        modal('<i class="fas fa-address-card"></i> Customer card · ' + esc(nm),
            '<div class="form">' + f('k-to', 'Statement e-mail (wins over Fusion)', c.STMT_TO, 'ar@customer.com; boss@customer.com', true) + f('k-cc', 'Copy to (cc)', c.STMT_CC, '', true) +
            '<div class="field"><label>Statement delivery</label><select id="k-del"><option value="">As in Fusion (e-mail when there is an address)</option><option value="EMAIL"' + (c.DELIVERY === 'EMAIL' ? ' selected' : '') + '>E-mail</option><option value="POST"' + (c.DELIVERY === 'POST' ? ' selected' : '') + '>Post</option><option value="NONE"' + (c.DELIVERY === 'NONE' ? ' selected' : '') + '>No statement</option></select></div>' +
            f('k-own', 'Collector', c.OWNER_USER, S.user()) + f('k-con', 'Contact person', c.CONTACT_NAME) + f('k-ph', 'Phone', c.PHONE) + f('k-tag', 'Tags', c.TAGS, 'key account, slow payer…') +
            '<label class="chk" style="align-self:end"><input type="checkbox" id="k-hold"' + (c.ON_HOLD === 'Y' ? ' checked' : '') + '> Credit hold</label>' +
            '<div class="field wide"><label>Notes</label><textarea id="k-notes" rows="4">' + esc(c.NOTES || '') + '</textarea></div></div>',
            '<button class="btn" data-act="mclose">Cancel</button><button class="btn pri" data-act="cardSave">Save</button>');
        ACT.cardSave = function () {
            var to = E.emails($('k-to').value), cc = E.emails($('k-cc').value);
            if (to.bad.length || cc.bad.length) { toast('Not an e-mail address: ' + to.bad.concat(cc.bad).join(', '), 'bad', 6000); return; }
            var hold = $('k-hold').checked, wasHold = c.ON_HOLD === 'Y';
            var rec = { BU_ID: buId, ACCOUNT_NUMBER: acct, ACCOUNT_NAME: nm, STMT_TO: to.join('; '), STMT_CC: cc.join('; '), DELIVERY: $('k-del').value, OWNER_USER: $('k-own').value.trim(), CONTACT_NAME: $('k-con').value.trim(), PHONE: $('k-ph').value.trim(), TAGS: $('k-tag').value.trim(), NOTES: $('k-notes').value, ON_HOLD: hold ? 'Y' : 'N' };
            var end = busy('Saving the card…');
            S.cust.save(rec).then(function () {
                if (hold !== wasHold) return S.act.add({ id: E.uid('ac'), buId: buId, account: acct, name: nm, kind: 'HOLD', subject: hold ? 'Credit hold set' : 'Credit hold lifted', status: 'DONE' });
            }).then(function () { end(); mclose(); toast('Card saved', 'ok'); P.cust.data = null; return loadCore(); }).then(render, function (e) { end(); toast(errText(e), 'bad', 7000); });
        };
    }
    /** One statement now (Customer 360 / resend): same steps and records as a run */
    function sendOneDialog(buId, acct, resentOf) {
        var b = bu(buId); if (!b) { toast('Unknown business unit ' + buId, 'bad'); return; }
        var old = resentOf ? findStmt(resentOf) : null, date = old ? old.STMT_DATE : P.stmtDate;
        var c = (P.run.customers && P.run.loadedFor === buId + '|' + date && P.run.customers.filter(function (x) { return x.account === acct; })[0]) || null;
        var last = old || P.latest[key(buId, acct)];
        if (!c) c = { account: acct, name: nameOf(buId, acct), balance: last ? +last.BALANCE : null, currency: last ? last.CURRENCY : b.currency, overdue: last && last.OVERDUE !== '' && last.OVERDUE != null ? +last.OVERDUE : null, aging: last && last.AGING_JSON ? safeJson(last.AGING_JSON) : null, email: last ? last.EMAIL_TO : '' };
        var m = mailInfo(), o = runOpts(b), rc = E.recipients(c, profileOf(buId, acct), b);
        modal('<i class="fas fa-paper-plane"></i> ' + (resentOf ? 'Send the statement again' : 'Send a statement') + ' · ' + esc(c.name),
            '<div class="form"><div class="field"><label>Statement as at</label><input type="date" id="o1-date" value="' + esc(date) + '"></div><div class="field"><label>Goes to</label><div style="padding-top:6px">' + (rc.delivery === 'EMAIL' ? esc(rc.to.join('; ')) : '<span class="warnc">' + esc(rc.why) + '</span>') + ' <a data-act="editCard" data-bu="' + esc(buId) + '" data-acct="' + esc(acct) + '">change</a></div></div></div>' +
            (c.balance == null ? '<div class="note warn" style="margin-top:10px">The balance is not known here — the PDF from Fusion shows it; the record keeps it blank.</div>' : '<div class="small muted" style="margin-top:8px">Balance recorded with it: ' + money(c.balance) + (last && !P.run.customers ? ' (from the statement of ' + esc(last.STMT_DATE) + ')' : '') + '</div>') +
            '<div style="margin-top:12px">' + optsHtml(o, m) + '</div>',
            '<button class="btn" data-act="mclose">Cancel</button><button class="btn pri" data-act="oneGo"' + (rc.delivery === 'NONE' ? ' disabled' : '') + '><i class="fas fa-paper-plane"></i> ' + (rc.delivery === 'POST' ? 'Make the PDF for the post' : 'Send') + '</button>');
        ['o-track', 'o-confirm', 'o-rr', 'o-dr', 'o-disp'].forEach(function (id) { var e = $(id); if (e) e.onchange = readOpts; });
        ACT.oneGo = function () {
            if (rc.delivery === 'EMAIL' && !m.ready) { toast('E-mail is not ready on this PC (' + m.label + ')', 'bad'); return; }
            var opts = readOpts(), d = $('o1-date').value || date, end = busy('Sending the statement…');
            mclose();
            var ctx = { bu: b, stmtDate: d, pod: P.pod, runId: null, opts: opts, method: m.method, mailbox: m.mailbox, resentOf: resentOf || null };
            processOne(ctx, c, function () { }).then(function (r) {
                end(); toast(r.status === 'FAILED' ? 'Not sent: ' + r.msg : r.msg || r.status, r.status === 'FAILED' ? 'bad' : 'ok', 6000);
                P.cust.data = null; if (P.stmts.rows) loadStmts(); return loadCore();
            }).then(render, function () { render(); });
        };
    }

    // ══ Follow-ups ═════════════════════════════════════════════════
    function vTasks() {
        var me = S.user().toLowerCase(), mine = P.tasks.mine;
        var open = P.acts.filter(function (a) { return a.STATUS === 'OPEN' && a.KIND !== 'CONFIRM' && (!mine || String(a.ASSIGNED_TO || a.CREATED_BY || '').toLowerCase() === me); });
        var groups = { LATE: [], DUE: [], WEEK: [], LATER: [], NODATE: [] }, wk = addDays(today(), 7);
        open.forEach(function (a) { var st = E.actState(a); if (st === 'LATE') groups.LATE.push(a); else if (st === 'DUE') groups.DUE.push(a); else if (!a.DUE_DATE) groups.NODATE.push(a); else if (a.DUE_DATE <= wk) groups.WEEK.push(a); else groups.LATER.push(a); });
        Object.keys(groups).forEach(function (g) { groups[g].sort(function (a, b) { return String(a.DUE_DATE || '').localeCompare(String(b.DUE_DATE || '')); }); });
        var prom = open.filter(function (a) { return a.KIND === 'PROMISE'; }), pAmt = prom.reduce(function (s, a) { return s + (+a.AMOUNT || 0); }, 0);
        var h = '<div class="kpis">' + kpi('Past their date', groups.LATE.length, 'promises and follow-ups', groups.LATE.length ? 'bad' : '') + kpi('Today', groups.DUE.length, '', groups.DUE.length ? 'warn' : '') + kpi('Next 7 days', groups.WEEK.length, '', 'info') +
            kpi('Promised', money(pAmt), prom.length + ' open promise' + (prom.length === 1 ? '' : 's'), 'pri') + kpi('Disputes', open.filter(function (a) { return a.KIND === 'DISPUTE'; }).length, 'waiting for a resolution', '') + '</div>';
        h += '<div class="card"><div class="row" style="margin-bottom:10px"><div class="seg" id="t-mine"><button data-m="0"' + (!mine ? ' class="on"' : '') + '>Everyone</button><button data-m="1"' + (mine ? ' class="on"' : '') + '>Mine</button></div><span class="sp"></span><button class="btn sm" data-act="refresh"><i class="fas fa-rotate"></i></button></div>';
        [['LATE', 'Past their date'], ['DUE', 'Today'], ['WEEK', 'Next 7 days'], ['LATER', 'Later'], ['NODATE', 'No date (disputes, notes to act on)']].forEach(function (g) {
            if (!groups[g[0]].length) return;
            h += '<h3>' + g[1] + ' · ' + groups[g[0]].length + '</h3><div class="wl">' + groups[g[0]].map(actItem).join('') + '</div>';
        });
        if (!open.length) h += '<div class="empty"><i class="fas fa-mug-hot" style="font-size:22px"></i><br>Nothing open.</div>';
        return h + '</div>';
    }
    function closeAct(id, status, ask) {
        var a = P.acts.concat((P.cust.data && P.cust.data.acts) || []).filter(function (x) { return x.ACT_ID === id; })[0];
        var outcome = ask ? prompt('How was it resolved? (kept on the timeline)', '') : '';
        if (ask && outcome === null) return;
        var end = busy('Saving…');
        S.act.close(id, status, outcome || null).then(function () {
            // a broken promise suggests the next step: a follow-up in 2 days
            if (status === 'BROKEN' && a) return S.act.add({ id: E.uid('ac'), buId: a.BU_ID, account: a.ACCOUNT_NUMBER, name: a.ACCOUNT_NAME, kind: 'TASK', subject: 'Promise of ' + (a.AMOUNT != null ? money(+a.AMOUNT) + ' ' : '') + 'not kept — call again', due: addDays(today(), 2), assignedTo: a.ASSIGNED_TO || S.user(), ref: a.ACT_ID });
        }).then(function () { end(); toast(status === 'BROKEN' ? 'Marked not paid — a follow-up in 2 days was added' : 'Done', 'ok'); P.cust.data = null; return loadCore(); }).then(render, function (e) { end(); toast(errText(e), 'bad', 7000); });
    }
    function resolveStmt(id) {
        var s = findStmt(id); if (!s) return;
        var d = P.acts.filter(function (a) { return a.REF_ID === id && a.KIND === 'DISPUTE' && a.STATUS === 'OPEN'; })[0];
        if (d) { closeAct(d.ACT_ID, 'RESOLVED', true); return; }
        var outcome = prompt('How was the query resolved? (kept on the timeline)', ''); if (outcome === null) return;
        S.act.add({ id: E.uid('ac'), buId: s.BU_ID, account: s.ACCOUNT_NUMBER, name: s.ACCOUNT_NAME, kind: 'DISPUTE', subject: 'Query on the statement of ' + s.STMT_DATE, body: s.RESP_COMMENT, status: 'RESOLVED', ref: id })
            .then(function () { return loadCore(); }).then(function () { mclose(); render(); toast('Resolved', 'ok'); }, function (e) { toast(errText(e), 'bad'); });
    }

    // ══ Setup ══════════════════════════════════════════════════════
    function vSetup() {
        var r = P.mail || {}, s = r.settings || {}, m = mailInfo();
        var h = '<div class="cols"><div>';
        h += '<div class="card"><h2><i class="fas fa-building"></i> Business units <span class="sp"></span><button class="btn sm" data-act="buAdd"><i class="fas fa-plus"></i> Add</button><button class="btn sm pri" data-act="busSave"><i class="fas fa-floppy-disk"></i> Save</button></h2>' +
            '<div class="small muted" style="margin-bottom:10px">Each business unit has where the balances come from (a BI Publisher report or Fusion SQL), the statement report that makes the PDF, and the e-mail. Values like <span class="mono">{STMT_DATE_MDY}</span> are filled in for every customer: ' + E.VAR_HELP.map(function (v) { return '<span class="mono">{' + v + '}</span>'; }).join(' ') + '.</div>' +
            P.bus.map(buCard).join('') + '</div></div><div>';
        h += '<div class="card"><h2><i class="fas fa-envelope"></i> E-mail from this PC</h2>' +
            '<div class="small muted" style="margin-bottom:8px">Shared with Finance Lens (board packs). Statements are sent with the way chosen here.</div>' +
            '<div class="row">' + [['OUTLOOK', 'Outlook on this PC'], ['GRAPH', 'Microsoft 365'], ['SMTP', 'SMTP']].map(function (x) { return '<label class="chk"><input type="radio" name="ml-m" value="' + x[0] + '"' + (m.method === x[0] ? ' checked' : '') + '> ' + x[1] + '</label>'; }).join('') + '</div>' +
            (m.method === 'OUTLOOK' ? '<div class="field" style="margin-top:8px"><label>Send from</label><select id="ml-acc"><option value="">Outlook\'s default account</option>' + (r.outlookAccounts || []).map(function (a) { return '<option' + (String(s.OutlookAccount || '').toLowerCase() === a.toLowerCase() ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('') + '</select></div>' : '') +
            '<div style="margin-top:8px">' + (m.ready ? pill('<i class="fas fa-check"></i> ready · ' + esc(m.mailbox), 'ok') : pill('not ready', 'bad')) + (m.method === 'GRAPH' && !r.graphAccount ? ' <button class="btn sm" data-act="mailSignIn">Sign in to Microsoft 365</button>' : '') + (m.method === 'SMTP' ? ' <span class="small muted">server, user and password: Finance Lens › E-mail setup</span>' : '') + '</div>' +
            '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="mailSave">Save</button><button class="btn sm" data-act="mailTest"><i class="fas fa-vial"></i> Send a test to me</button><a class="small" href="../finance/index.html" title="Sender name, reply-to, SMTP, Microsoft 365 app">Full e-mail setup in Finance Lens</a></div></div>';
        h += '<div class="card"><h2><i class="fas fa-link"></i> Customer links</h2><div class="small muted">The tracking picture (opened) and the <b>Agree / Query the balance</b> page live in APEX: <span class="mono small">' + esc(S.PUBLIC) + '/dc/resp/…</span></div><div class="row" style="margin-top:8px">' +
            (P.linksOk === true ? pill('<i class="fas fa-check"></i> working', 'ok') : P.linksOk === false ? pill('not set up', 'bad') : pill('checking…', 'muted')) + '<span class="sp"></span><button class="btn sm" data-act="linkCheck">Check</button><button class="btn sm pri" data-act="linkSetup">Set up</button></div><div class="small muted" style="margin-top:6px">Set up creates the procedures and ORDS endpoints through APEX; if that is not allowed, run <span class="mono">apex_sql/99_debtors_control.sql</span> in SQL Developer.</div></div>';
        var g = P.general;
        h += '<div class="card"><h2><i class="fas fa-sliders"></i> General</h2><div class="form"><div class="field"><label>PDFs made at the same time</label><select id="g-par">' + [1, 2, 3, 4].map(function (n) { return '<option' + (+g.parallelPdf === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>"Not opened" after (days)</label><input type="number" id="g-unop" min="1" max="60" value="' + esc(g.unopenedDays) + '"></div><div class="field"><label>Follow-up after (days)</label><input type="number" id="g-fu" min="1" max="60" value="' + esc(g.followupDays) + '"></div>' +
            '<div class="field wide"><label>Collectors (for "For" and the card)</label><input type="text" id="g-col" value="' + esc((g.collectors || []).join(', ')) + '" placeholder="user1, user2"></div></div><div class="row" style="margin-top:10px"><button class="btn sm pri" data-act="genSave">Save</button></div></div>';
        return h + '</div></div>';
    }
    function paramsText(p) { return Object.keys(p || {}).map(function (k) { return k + ' = ' + p[k]; }).join('\n'); }
    function parseParams(t) { var o = {}; String(t || '').split(/\n/).forEach(function (l) { var i = l.indexOf('='); if (i > 0) { var k = l.slice(0, i).trim(); if (k) o[k] = l.slice(i + 1).trim(); } }); return o; }
    function buCard(b, i) {
        var bal = b.balances || {}, st = b.statement || {}, mail = b.mail || {}, map = bal.map || {};
        var f = function (id, label, v, ph) { return '<div class="field"><label>' + label + '</label><input type="text" id="' + id + i + '" value="' + esc(v || '') + '" placeholder="' + esc(ph || '') + '"></div>'; };
        return '<div class="bucard' + (b.active === 'N' ? ' off' : '') + '"><div class="row" style="margin-bottom:8px"><b style="font-size:15px">' + esc(b.name || 'New business unit') + '</b><span class="muted small mono">' + esc(b.id) + '</span><span class="sp"></span><label class="chk"><input type="checkbox" id="b-act' + i + '"' + (b.active !== 'N' ? ' checked' : '') + '> Active</label><button class="btn sm ghost" data-act="buDel" data-i="' + i + '"><i class="fas fa-trash"></i></button></div>' +
            '<div class="form">' + f('b-name', 'Name', b.name, 'GRAYS INC BU') + f('b-id', 'Business unit id (BUSINESS_UNIT_ID)', b.id, '300000003234003') + f('b-co', 'Company name (in the e-mail)', b.company) + f('b-cur', 'Currency', b.currency, 'MUR') + '</div>' +
            '<h3>Balances — who gets a statement</h3><div class="row"><label class="chk"><input type="radio" name="b-kind' + i + '" value="BIP"' + (bal.kind !== 'SQL' ? ' checked' : '') + '> BI Publisher report</label><label class="chk"><input type="radio" name="b-kind' + i + '" value="SQL"' + (bal.kind === 'SQL' ? ' checked' : '') + '> Fusion SQL (direct, read-only)</label></div>' +
            '<div class="form" style="margin-top:6px"><div class="field wide"><label>Report path</label><input type="text" id="b-bp' + i + '" value="' + esc(bal.path || '') + '"></div><div class="field wide"><label>Report parameters (one per line: name = value)</label><textarea class="code" id="b-bpp' + i + '" rows="2">' + esc(paramsText(bal.params)) + '</textarea></div>' +
            '<div class="field wide"><label>Fusion SQL (account_number, account_name, balance, email; optional currency, current_amt, b1_30, b31_60, b61_90, b90_plus)</label><textarea class="code" id="b-sql' + i + '" rows="6">' + esc(bal.sql || E.DEFAULT_SQL) + '</textarea></div>' +
            '<div class="field wide"><label>Columns, when the names differ (field = COLUMN: account, name, balance, email, emailStat, currency, current, d30, d60, d90, d90p)</label><textarea class="code" id="b-map' + i + '" rows="2" placeholder="account = CUSTOMER_NO">' + esc(paramsText(map)) + '</textarea></div></div>' +
            '<div class="row" style="margin-top:6px"><button class="btn sm" data-act="buTestBal" data-i="' + i + '"><i class="fas fa-vial"></i> Test the balances</button><span class="small muted" id="b-tb' + i + '"></span></div>' +
            '<h3>Statement PDF</h3><div class="form"><div class="field wide"><label>Report path</label><input type="text" id="b-sp' + i + '" value="' + esc(st.path || '') + '"></div><div class="field wide"><label>Parameters</label><textarea class="code" id="b-spp' + i + '" rows="3">' + esc(paramsText(st.params)) + '</textarea></div></div>' +
            '<div class="row" style="margin-top:6px"><input type="text" id="b-tacct' + i + '" placeholder="an account number" style="width:180px"><button class="btn sm" data-act="buTestPdf" data-i="' + i + '"><i class="fas fa-file-pdf"></i> Make a test PDF</button><span class="small muted" id="b-tp' + i + '"></span></div>' +
            '<h3>E-mail</h3><div class="form">' + f('b-subj', 'Subject', mail.subject) + f('b-att', 'Attachment name', mail.attach, 'Statement {ACCOUNT_NUMBER} {STMT_DATE}') + f('b-con', 'Contact for queries ({CONTACT})', mail.contact) + f('b-cc', 'Always cc', mail.cc) + f('b-bcc', 'Always bcc (e.g. the AR mailbox)', mail.bcc) +
            '<div class="field wide"><label>Body (HTML)</label><textarea class="code" id="b-body' + i + '" rows="7">' + esc(mail.body || E.DEFAULT_BODY) + '</textarea></div></div>' +
            '<div class="row small" style="margin-top:6px;gap:14px"><label class="chk"><input type="checkbox" id="b-trk' + i + '"' + (mail.track !== false ? ' checked' : '') + '> Tracking picture</label><label class="chk"><input type="checkbox" id="b-cnf' + i + '"' + (mail.confirm !== false ? ' checked' : '') + '> Agree / query button</label><label class="chk"><input type="checkbox" id="b-rr' + i + '"' + (mail.readReceipt ? ' checked' : '') + '> Read receipts</label><label class="chk"><input type="checkbox" id="b-dr' + i + '"' + (mail.deliveryReceipt ? ' checked' : '') + '> Delivery receipts</label><span class="sp"></span><button class="btn sm" data-act="buPreview" data-i="' + i + '"><i class="fas fa-eye"></i> Preview</button></div></div>';
    }
    function readBu(i) {
        var v = function (id) { var e = $(id + i); return e ? e.value : ''; }, c = function (id) { var e = $(id + i); return e ? e.checked : false; };
        var kind = (document.querySelector('input[name="b-kind' + i + '"]:checked') || {}).value || 'BIP';
        return { id: v('b-id').trim(), name: v('b-name').trim(), company: v('b-co').trim(), currency: v('b-cur').trim(), active: c('b-act') ? 'Y' : 'N',
            balances: { kind: kind, path: v('b-bp').trim(), params: parseParams(v('b-bpp')), sql: v('b-sql'), map: parseParams(v('b-map')) },
            statement: { path: v('b-sp').trim(), params: parseParams(v('b-spp')) },
            mail: { subject: v('b-subj'), attach: v('b-att'), contact: v('b-con'), cc: v('b-cc'), bcc: v('b-bcc'), body: v('b-body'), track: c('b-trk'), confirm: c('b-cnf'), readReceipt: c('b-rr'), deliveryReceipt: c('b-dr') } };
    }
    function readBus() { return P.bus.map(function (b, i) { return $('b-id' + i) ? readBu(i) : b; }); }

    // ── actions ────────────────────────────────────────────────────
    var ACT = {
        mclose: mclose,
        go: function (d) { go(d.tab); },
        refresh: refresh,
        kpi: function (d) {
            var k = d.k; if (k.indexOf('go:') === 0) { go(k.slice(3)); return; }
            P.stmts.f = Object.assign(P.stmts.f, { state: k === 'stmtsAgreed' ? 'AGREED' : k === 'stmtsDisputed' ? 'DISPUTED' : k === 'stmtsFailed' ? 'FAILED' : '', days: 45, runId: null, account: null });
            P.stmts.rows = null; go('stmts');
        },
        pod: function () { P.pod = P.pod === 'PROD' ? 'TEST' : 'PROD'; lsSet('pod', P.pod); paintWho(); render(); toast('Reports now run on ' + P.pod, 'ok'); },
        loadBal: loadBalances,
        sortRun: function (d) { var s = P.run.sort; s.d = s.k === d.k ? -s.d : (d.k === 'name' || d.k === 'account' ? 1 : -1); s.k = d.k; render(); },
        selAll: function () { runRows().forEach(function (r) { if (r.rc.delivery !== 'NONE') P.run.sel[r.c.account] = 1; }); render(); },
        selNone: function () { P.run.sel = {}; render(); },
        runCsv: function () { csv('balances-' + curBu().name + '-' + P.stmtDate + '.csv', [[function (r) { return r.c.account; }, 'Account'], [function (r) { return r.c.name; }, 'Customer'], [function (r) { return r.c.balance; }, 'Balance'], [function (r) { return r.c.overdue; }, 'Overdue'], [function (r) { return r.rc.delivery; }, 'Delivery'], [function (r) { return r.rc.to.join('; '); }, 'E-mail'], [function (r) { return r.sc.score; }, 'Priority'], [function (r) { return r.sc.why.join('; '); }, 'Why']], runRows()); },
        preview: preview,
        runStart: runConfirm,
        runGo: function () { var b = curBu(), items = runRows().filter(function (r) { return P.run.sel[r.c.account] && r.rc.delivery !== 'NONE'; }).map(function (r) { return r.c; }); var o = readOpts(); mclose(); runStart(items, o); },
        runStop: function () { if (P.run.live) { P.run.live.ctx.stop = true; render(); } },
        retryFailed: function () { var L = P.run.live; var items = L.items.filter(function (it) { return it.status === 'FAILED'; }).map(function (it) { return it.c; }); var o = L.ctx.opts; P.run.live = null; runStart(items, o); },
        liveClose: function () { P.run.live = null; render(); },
        openPostFolder: function () { var it = P.run.live && P.run.live.items.filter(function (x) { return x.status === 'POSTED' && x.path; })[0]; S.call('dcOpenFolder', { path: it ? it.path : null }).catch(function (e) { toast(errText(e), 'bad'); }); },
        runStmts: function (d) { P.stmts.f = Object.assign(P.stmts.f, { runId: d.id, days: 0, state: '', account: null }); P.stmts.rows = null; if (P.run.live && P.run.live.finished) P.run.live = null; go('stmts'); },
        clearRun: function () { P.stmts.f.runId = null; P.stmts.f.days = 45; P.stmts.rows = null; loadStmts(); render(); },
        clearAcct: function () { P.stmts.f.account = null; P.stmts.rows = null; loadStmts(); render(); },
        reloadStmts: function () { loadStmts(); },
        sortStmts: function (d) { var s = P.stmts.sort; s.d = s.k === d.k ? -s.d : -1; s.k = d.k; render(); },
        stmt: function (d) { stmtDialog(d.id); },
        stmtCsv: function () {
            csv('statements.csv', [['SENT_AT', 'Sent'], ['CREATED_AT', 'Recorded'], ['BU_NAME', 'Business unit'], ['ACCOUNT_NUMBER', 'Account'], ['ACCOUNT_NAME', 'Customer'], ['STMT_DATE', 'As at'], ['CURRENCY', 'Currency'], ['BALANCE', 'Balance'], ['DELIVERY', 'Delivery'], ['EMAIL_TO', 'To'], ['EMAIL_CC', 'Cc'], ['SUBJECT', 'Subject'],
                [function (r) { return E.stmtState(r).label; }, 'Status'], ['ERROR_TEXT', 'Error'], ['OPENS', 'Opens'], ['FIRST_OPEN', 'First opened'], ['DELIVERED_AT', 'Delivered'], ['READ_AT', 'Read'], ['BOUNCED_AT', 'Bounced'], ['RESP_STATUS', 'Answer'], ['RESP_COMMENT', 'Comment'], ['RESP_AT', 'Answered'], ['METHOD', 'Method'], ['MAILBOX', 'Mailbox'], ['APP_USER', 'User'], ['MACHINE', 'PC'], ['FILE_NAME', 'PDF'], ['SHA256', 'SHA-256'], ['STMT_ID', 'Record id']], stmtRows());
        },
        receipts: receipts,
        resend: function (d) { var s = findStmt(d.id); if (!s) { toast('Statement not found — refresh', 'warn'); return; } sendOneDialog(s.BU_ID, s.ACCOUNT_NUMBER, s.STMT_ID); },
        resolveStmt: function (d) { resolveStmt(d.id); },
        openFile: function (d) { S.call('dcOpenFile', { path: d.path }).catch(function (e) { toast(errText(e), 'bad', 6000); }); },
        verify: function (d) {
            var s = findStmt(d.id); if (!s) return;
            S.call('dcFileCheck', { path: s.FILE_PATH }).then(function (r) { toast(!r.exists ? 'The PDF is no longer on this PC' : r.sha256 === s.SHA256 ? '✓ Same file as the one recorded (SHA-256 matches)' : '✗ The file on this PC was changed after it was sent', !r.exists ? 'warn' : r.sha256 === s.SHA256 ? 'ok' : 'bad', 6000); }).catch(function (e) { toast(errText(e), 'bad'); });
        },
        open360: function (d) { open360(d.bu, d.acct); },
        back360: function () { P.cust.open = null; P.cust.data = null; render(); },
        sub360: function (d) { P.cust.sub = d.s; render(); },
        newAct: function (d) { actDialog(d.kind, d.bu, d.acct); },
        editCard: function (d) { cardDialog(d.bu, d.acct); },
        sendOne: function (d) { sendOneDialog(d.bu, d.acct, null); },
        close: function (d) { closeAct(d.id, d.st, !!d.ask); },
        buAdd: function () { P.bus = readBus(); P.bus.push({ id: '', name: '', company: '', currency: '', active: 'Y', balances: { kind: 'BIP', path: '', params: { p_date_fr: '{STMT_DATE_MDY}', BUSINESS_UNIT_ID: '{BU_ID}' }, sql: E.DEFAULT_SQL }, statement: { path: '', params: { p_cust_no: '{ACCOUNT_NUMBER}', p_date_fr: '{STMT_DATE_MDY}', BUSINESS_UNIT_ID: '{BU_ID}' } }, mail: clone(E.SEED_BUS[0].mail) }); render(); },
        buDel: function (d) { if (!confirm('Remove this business unit from the setup? (its statements stay in APEX)')) return; P.bus = readBus(); P.bus.splice(+d.i, 1); render(); },
        busSave: function () {
            var bus = readBus(), bad = bus.filter(function (b) { return !b.id || !b.name; });
            if (bad.length) { toast('Every business unit needs a name and an id', 'bad'); return; }
            var end = busy('Saving the setup…');
            S.settings.save('BUS', bus).then(function () { P.bus = bus; P.seeded = false; end(); toast('Setup saved in APEX', 'ok'); render(); }, function (e) { end(); toast(errText(e), 'bad', 7000); });
        },
        buTestBal: function (d) {
            var b = readBu(+d.i), out = $('b-tb' + d.i), vars = E.vars(b, P.stmtDate, {});
            out.textContent = 'Reading…';
            var p = b.balances.kind === 'SQL' ? S.fusionSql(E.fill(b.balances.sql, vars, 'sql'), 500) : S.call('dcBipRows', { instance: P.pod, path: b.balances.path, params: E.fillParams(b.balances.params, vars) }, 900000).then(function (x) { return x.rows || []; });
            p.then(function (rows) {
                var m = E.customers(rows, b.balances.map);
                out.innerHTML = rows.length + ' rows → ' + m.customers.length + ' customers as at ' + esc(P.stmtDate) + (m.missing.length ? ' · <span class="badc">missing: ' + esc(m.missing.join(', ')) + '</span>' : ' · ' + pill('columns found', 'ok')) + '<br><span class="mono">' + esc(m.columns.join(', ')) + '</span>';
            }, function (e) { out.innerHTML = '<span class="badc">' + esc(errText(e)) + '</span>'; });
        },
        buTestPdf: function (d) {
            var b = readBu(+d.i), acct = ($('b-tacct' + d.i).value || '').trim(), out = $('b-tp' + d.i);
            if (!acct) { toast('Type an account number', 'warn'); return; }
            out.textContent = 'Making the PDF…';
            S.call('dcStatementPdf', { instance: P.pod, path: b.statement.path, params: E.fillParams(b.statement.params, E.vars(b, P.stmtDate, { account: acct })), bu: 'test', stmtDate: P.stmtDate, fileName: 'TEST ' + acct }, 300000)
                .then(function (r) { out.innerHTML = pill('PDF ' + Math.round(r.bytes / 1024) + ' KB · ' + Math.round(r.ms / 100) / 10 + ' s', 'ok'); return S.call('dcOpenFile', { path: r.path }); })
                .catch(function (e) { out.innerHTML = '<span class="badc">' + esc(errText(e)) + '</span>'; });
        },
        buPreview: function (d) {
            var b = readBu(+d.i), c = { account: '1001', name: 'Sample Customer Ltd', balance: 12500.75, currency: b.currency, overdue: 3000 };
            var pv = previewHtml(b, c, { confirm: b.mail.confirm });
            var unk = E.unknownVars(b.mail.subject + b.mail.body + b.mail.attach, E.vars(b, P.stmtDate, c));
            modal('<i class="fas fa-eye"></i> E-mail preview · ' + esc(b.name), (unk.length ? '<div class="note warn" style="margin-bottom:10px">Unknown values (left as written): ' + esc(unk.join(', ')) + '</div>' : '') + '<div class="small muted" style="margin-bottom:6px">Attachment: ' + esc(pv.attach) + '</div><div class="preview"><div class="subj">' + esc(pv.subject) + '</div>' + pv.html + '</div>', '<button class="btn" data-act="mclose">Close</button>', true);
        },
        genSave: function () {
            var g = { parallelPdf: +$('g-par').value || 3, unopenedDays: +$('g-unop').value || 7, followupDays: +$('g-fu').value || 7, collectors: $('g-col').value.split(/[,;]+/).map(function (x) { return x.trim(); }).filter(Boolean) };
            S.settings.save('GENERAL', g).then(function () { P.general = g; toast('Saved', 'ok'); badges(); }, function (e) { toast(errText(e), 'bad'); });
        },
        mailSave: function () {
            var st = clone((P.mail || {}).settings || {}), me = (document.querySelector('input[name="ml-m"]:checked') || {}).value || 'OUTLOOK';
            st.Method = me; if ($('ml-acc')) st.OutlookAccount = $('ml-acc').value;
            S.host('finMailSave', { settings: JSON.stringify(st) }, 60000).then(function (r) { if (r && r.ok === false) throw new Error(r.error); P.mail = r; paintWho(); render(); toast('E-mail setup saved', 'ok'); }).catch(function (e) { toast(errText(e), 'bad'); });
        },
        mailSignIn: function () { var end = busy('Sign in in the browser window…'); S.host('finMailSignIn', {}, 300000).then(function () { end(); return mailStatus(); }).then(render, function (e) { end(); toast(errText(e), 'bad'); }); },
        mailTest: function () {
            var to = prompt('Send a test e-mail to', (mailInfo().mailbox || '').indexOf('@') > 0 ? mailInfo().mailbox : ''); if (!to) return;
            S.host('finMailTest', { method: mailInfo().method, to: to }, 120000).then(function (r) { if (r && r.ok === false) throw new Error(r.error); toast('Test sent (' + (r.result || 'ok') + ')', 'ok'); }).catch(function (e) { toast(errText(e), 'bad', 7000); });
        },
        linkCheck: function () { P.linksOk = null; render(); S.linksCheck().then(function (ok) { P.linksOk = ok; render(); }); },
        linkSetup: function () {
            var end = busy('Creating the customer links in APEX…');
            S.linksSetup().then(function (ok) { end(); P.linksOk = ok; render(); toast(ok ? 'Customer links are working' : 'Created, but the page does not answer yet — run apex_sql/99_debtors_control.sql in SQL Developer', ok ? 'ok' : 'warn', 7000); })
                .catch(function (e) { end(); toast('Could not create them here (' + errText(e) + ') — run apex_sql/99_debtors_control.sql in SQL Developer', 'bad', 9000); });
        }
    };

    function mailStatus() { return S.host('finMailStatus', {}, 60000).then(function (r) { P.mail = r; paintWho(); return r; }).catch(function () { P.mail = null; }); }

    // ── wiring ─────────────────────────────────────────────────────
    function onClick(e) {
        var t = e.target.closest('[data-act]'); if (!t) { if (e.target.id === 'modal') mclose(); return; }
        var fn = ACT[t.dataset.act]; if (!fn) return;
        e.preventDefault(); fn(t.dataset, t, e);
    }
    var qT = 0;
    function onInput(e) {
        var t = e.target, id = t.id;
        if (id === 'r-q') { P.run.f.q = t.value; lsSet('run.f', P.run.f); clearTimeout(qT); qT = setTimeout(function () { keep('r-q', render); }, 200); }
        else if (id === 's-q') { P.stmts.f.q = t.value; lsSet('stmts.f', P.stmts.f); clearTimeout(qT); qT = setTimeout(function () { keep('s-q', render); }, 200); }
        else if (id === 'c-q') { P.cust.q = t.value; clearTimeout(qT); qT = setTimeout(function () { keep('c-q', render); }, 200); }
    }
    /** re-render keeping the cursor in the search box being typed in */
    function keep(id, fn) { var el = $(id), pos = el ? el.selectionStart : null; fn(); var n = $(id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { } } }
    function onChange(e) {
        var t = e.target, id = t.id;
        if (id === 'r-bu' || id === 'c-bu') { P.buId = t.value; lsSet('bu', P.buId); render(); }
        else if (id === 'r-date') { P.stmtDate = t.value || E.lastMonthEnd(); render(); }
        else if (id === 'r-del') { P.run.f.delivery = t.value; lsSet('run.f', P.run.f); render(); }
        else if (id === 'r-pos') { P.run.f.positive = t.checked; lsSet('run.f', P.run.f); render(); }
        else if (id === 'r-uns') { P.run.f.unsent = t.checked; lsSet('run.f', P.run.f); render(); }
        else if (id === 'r-all') { runRows().forEach(function (r) { if (r.rc.delivery === 'NONE') return; if (t.checked) P.run.sel[r.c.account] = 1; else delete P.run.sel[r.c.account]; }); render(); }
        else if (t.classList && t.classList.contains('r-ck')) { if (t.checked) P.run.sel[t.dataset.acct] = 1; else delete P.run.sel[t.dataset.acct]; render(); }
        else if (id === 's-days') { P.stmts.f.days = +t.value; P.stmts.f.runId = null; lsSet('stmts.f', P.stmts.f); P.stmts.rows = null; render(); loadStmts(); }
        else if (id === 's-bu') { P.stmts.f.buId = t.value; lsSet('stmts.f', P.stmts.f); P.stmts.rows = null; render(); loadStmts(); }
        else if (id === 's-state') { P.stmts.f.state = t.value; render(); }
        else if (t.name === 'ml-m') { var st = (P.mail || {}).settings; if (st) { st.Method = t.value; render(); } }
    }
    function onSeg(e) {
        var b = e.target.closest('#c-f button, #t-mine button'); if (!b) return;
        if (b.dataset.f != null) { P.cust.filter = b.dataset.f; render(); }
        if (b.dataset.m != null) { P.tasks.mine = b.dataset.m === '1'; lsSet('tasks.mine', P.tasks.mine); render(); }
    }

    function boot() {
        document.querySelectorAll('#tabs button').forEach(function (b) { b.addEventListener('click', function () { if (b.dataset.tab === 'cust' && P.tab === 'cust') { P.cust.open = null; P.cust.data = null; } go(b.dataset.tab); }); });
        document.addEventListener('click', onClick);
        document.addEventListener('click', onSeg);
        document.addEventListener('input', onInput);
        document.addEventListener('change', onChange);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') mclose(); });
        document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === P.tab); });
        paintWho(); render();
        if (!S.hasHost()) return;
        var end = busy('Opening…');
        S.call('dcInfo').then(function (i) { P.info = i; paintWho(); }).catch(function (e) { toast('This app is older than Debtors Control — rebuild it (' + errText(e) + ')', 'bad', 9000); });
        mailStatus();
        S.clock().then(loadSettings).then(loadCore).then(function () { end(); render(); return S.run.list(30).then(function (r) { P.runs = r; if (P.tab === 'home') render(); }); })
            .catch(function (e) { end(); P.ready = true; render(); toast('APEX: ' + errText(e), 'bad', 9000); });
        S.linksCheck().then(function (ok) { P.linksOk = ok; if (P.tab === 'setup') render(); });
    }
    document.addEventListener('DOMContentLoaded', boot);
})();
