/* Customer CRM · Opportunities (tab growth) — the ideas of Salesforce (Consumer Goods Cloud, Agentforce), Dynamics 365, HubSpot and
 * Zoho brought into the CRM on the data it already has (engine: crm-growth-engine.js = CRMG):
 *   Signals    one portfolio scan (Fusion sales of every customer: account × month and account × profit centre / supplier, bounced
 *              cheques; APEX: MRA failures, cancelled lines) → orders dropping, ranges stopped, cross-sell, service risks. The scan
 *              runs by itself when the last one is older than the rules say (any PC with the CRM open; a lease in WMS_CRM_SETTINGS
 *              GROWTH_SCAN_<pod> keeps two PCs from scanning at once), or from Scan now. The rows read are kept on this PC
 *              (DuckDB w2_crm_g_rows) so new rules can be tried without Fusion; the signals are shared in APEX WMS_CRM_SIGNALS
 *              (NEW → OPEN → DONE / DISMISSED / SNOOZED; GONE when the scan no longer finds them).
 *   Rules      per kind: on / off, thresholds, and what a new signal does — worklist only, a follow-up task (Debtors timeline),
 *              a ticket, or a playbook; only one PC acts on a signal (CRMS.signals.claim).
 *   Playbooks  outreach cadences (call → e-mail → visit …): enrolments in WMS_CRM_PLAYS, every step done in WMS_CRM_PLAY_STEPS;
 *              due steps ring the bell and sit on Today; a stop-on-order playbook stops when the customer orders again.
 *   Wallboard  Insights › Live wallboard: queues, SLA, calls, call-backs, agents, playbook steps, signals (refreshes every 30 s).
 *   Customer 360 › Opportunities (the customer's signals, playbooks, start one) and › Deliveries (its orders on WMS trips).
 *   Tickets › Draft with AI (the AI Hub through the host; the agent edits before sending). */
(function () {
    'use strict';
    var C = window.CRM, E = C.E, S = C.S, D = C.D, G = window.CRMG, esc = C.esc, money = C.money;
    function $(id) { return document.getElementById(id); }
    function errText(e) { return C.errText(e); }
    var GR = C.gr = {
        view: C.ls('gr.view', 'signals'), st: G.settings(null), signals: [], plays: [], steps: {}, meta: null, run: null, loaded: false, err: null,
        f: C.ls('gr.f', { kind: '', q: '', status: 'live', owner: '' }), pf: C.ls('gr.pf', { mine: true }), local: null, ins: C.ls('gr.ins', 'reports')
    };
    C.growth = GR;

    // ── data ──────────────────────────────────────────────────────
    GR.load = function () {
        return Promise.all([S.settings.get('GROWTH').catch(function () { return null; }), S.signals.list(C.pod), S.plays.list(C.pod), S.settings.get('GROWTH_SCAN_' + C.pod).catch(function () { return null; })]).then(function (r) {
            GR.st = G.settings(r[0]); GR.signals = r[1]; GR.plays = r[2]; GR.meta = r[3]; GR.loaded = true; GR.err = null;
            badge();
            if (C.bell) C.bell.compute();
        }, function (e) { GR.err = errText(e); GR.loaded = true; });
    };
    var loadCore = C.loadCore;
    C.loadCore = function () { return loadCore.apply(this, arguments).then(function (v) { return GR.load().then(function () { return v; }); }); };
    function badge() {
        var el = $('n-growth'); if (!el) return;
        var sm = G.summary(GR.signals, new Date()), due = G.playNotifications(GR.plays.map(withSteps), new Date(), C.me()).length;
        el.textContent = due ? due : sm.newN ? sm.newN : '';
        el.className = 'n' + (due ? ' due' : '');
        el.title = (due ? due + ' playbook step' + (due > 1 ? 's' : '') + ' due · ' : '') + sm.open + ' open signals';
    }
    GR.badge = badge;
    /** a play row with its playbook's steps (the playbook as it is now; a removed playbook has none) */
    function withSteps(p) { var pb = G.playbook(GR.st, p.PLAYBOOK_ID); return Object.assign({}, p, { steps: pb ? pb.steps : [] }); }
    GR.withSteps = withSteps;
    function dimLabel() { return GR.st.dim === 'SUPPLIER' ? 'Supplier' : 'Profit centre'; }
    function dimCol() { var d = (C.setup || {}).itemDff || {}; return GR.st.dim === 'SUPPLIER' ? d.supplier : d.profitCenter; }
    function playbookName(id) { var p = G.playbook(GR.st, id); return p ? p.name : id || ''; }
    function custName(acct) { return (C.master[acct] || {}).CUSTOMER || ''; }

    // ── the scan ──────────────────────────────────────────────────
    /** read every source (each failing soft), keep the rows on this PC, work out the signals, merge them into APEX and act on the new ones */
    GR.scan = function (auto) {
        if (GR.run) return Promise.resolve();
        if (!D.hasHost()) { if (!auto) C.toast('Open the CRM inside the app to scan Fusion.', 'warn'); return Promise.resolve(); }
        var me = C.me(), key = 'GROWTH_SCAN_' + C.pod, t0 = Date.now();
        var run = GR.run = { step: 'Checking the last scan…', errors: [], counts: {}, started: S.now(), ok: {} };
        paintRun();
        return S.settings.get(key).catch(function () { return null; }).then(function (m) {
            var now = Date.now();
            if (auto && m && m.at && (now - Date.parse(String(m.at).replace(' ', 'T'))) < (+GR.st.scanHours || 24) * 3600e3) { GR.meta = m; throw { skip: 'recent' }; }
            if (m && m.running && m.until && Date.parse(m.until) > now && m.by !== me) { GR.meta = m; throw { skip: 'running', by: m.by }; }
            return S.settings.save(key, Object.assign({}, m || {}, { running: true, by: me, until: new Date(now + 30 * 60e3).toISOString() }));
        }).then(function () {
            var parts = {};
            function step(label) { run.step = label; paintRun(); }
            function soft(part, p) { return p.then(function (rows) { parts[part] = rows; run.ok[part] = true; run.counts[part] = rows.length; return S.duck.keepScan(C.pod, part, rows); }, function (e) { run.errors.push({ part: part, error: errText(e), sql: e && e.sql || '' }); }); }
            var bu = GR.st.bu || '';
            return soft('portfolio', keyset(function (after) { return G.sql.portfolio(bu, after); }, G.PAGE, function (n) { step('Sales of every customer · ' + n.toLocaleString() + ' customers read'); }))
                .then(function () { var col = dimCol(); if (!G.dffCol(col)) { run.errors.push({ part: 'groups', error: 'No item DFF column for ' + dimLabel().toLowerCase() + ' in Setup › General' }); return; } return soft('groups', keyset(function (after) { return G.sql.groups(bu, col, after); }, G.GROUP_PAGE, function (n) { step(dimLabel() + ' per customer · ' + n.toLocaleString() + ' rows read'); })); })
                .then(function () { if (!GR.st.rules.BOUNCED.on) return; step('Bounced cheques…'); return soft('bounced', C.fusionFirst(G.sql.bounced(bu, GR.st.rules.BOUNCED.days), 2000, 300000).then(function (r) { return r.rows; })); })
                .then(function () { if (!GR.st.rules.MRA.on) return; step('MRA failures…'); return soft('mra', D.rows(G.sql.mraFailed(C.pod, GR.st.rules.MRA.days)[0], 1000)); })
                .then(function () { if (!GR.st.rules.CANCEL.on) return; step('Cancelled lines…'); return soft('cancels', D.rows(G.sql.cancels(C.pod, GR.st.rules.CANCEL.days)[0], 1000)); })
                .then(function () { step('Working out the signals…'); return apply(parts, run); })
                .then(function (res) {
                    var meta = { at: S.now(), by: me, ms: Date.now() - t0, counts: run.counts, errors: run.errors.map(function (x) { return { part: x.part, error: x.error }; }), signals: res.total, added: res.added, gone: res.gone, acted: res.acted, running: false };
                    GR.meta = meta;
                    return S.settings.save(key, meta).then(function () { return res; });
                });
        }).then(function (res) {
            GR.run = null;
            C.toast('Scan done · ' + res.total + ' signals (' + res.added + ' new' + (res.acted ? ', ' + res.acted + ' acted on' : '') + (res.gone ? ', ' + res.gone + ' no longer found' : '') + ')' + (run.errors.length ? ' · ' + run.errors.length + ' source' + (run.errors.length > 1 ? 's' : '') + ' failed' : ''), run.errors.length ? 'warn' : 'ok', 7000);
            return GR.load();
        }, function (e) {
            GR.run = null;
            if (e && e.skip) { if (!auto) C.toast(e.skip === 'running' ? 'A scan is running on another PC (' + e.by + ') — try again in a while.' : 'Scanned less than ' + GR.st.scanHours + ' h ago.', 'info'); return; }
            S.settings.get(key).then(function (m) { if (m && m.running && m.by === me) S.settings.save(key, Object.assign({}, m, { running: false })); }).catch(function () { });
            C.toast('Scan: ' + errText(e), 'bad', 9000);
        }).then(function () { if (C.tab === 'growth' || C.tab === 'c360') C.render(); paintRun(); });
    };
    /** a keyset read (pages of `size`, an account cut by the page end read again on the next one) → every row */
    function keyset(sqlOf, size, onStep) {
        var all = [];
        function next(after) {
            return C.fusionFirst(sqlOf(after), size + 10, 600000).then(function (r) {
                var pg = G.pageOf(r.rows, size); all = all.concat(pg.rows); if (onStep) onStep(all.length);
                return pg.next ? next(pg.next) : all;
            });
        }
        return next('');
    }
    /** the rows read (now, or this PC's copy) → signals → APEX; the new ones get their action */
    function apply(parts, run) {
        var fresh = G.scan({ portfolio: parts.portfolio, groups: parts.groups, bounced: parts.bounced, mra: parts.mra, cancels: parts.cancels, now: new Date(), settings: GR.st, dimLabel: dimLabel() });
        fresh.forEach(function (s) { s.bu = C.buOf(s.account); if (!s.name) s.name = custName(s.account); });
        // a source that failed (or was off) keeps its signals as they are: only kinds read this time can be "gone"
        var kindsRead = {}; if (run.ok.portfolio) kindsRead.CHURN = 1; if (run.ok.portfolio && run.ok.groups) { kindsRead.LAPSED = 1; kindsRead.WHITESPACE = 1; }
        if (run.ok.bounced) kindsRead.BOUNCED = 1; if (run.ok.mra) kindsRead.MRA = 1; if (run.ok.cancels) kindsRead.CANCEL = 1;
        Object.keys(GR.st.rules).forEach(function (k) { if (!GR.st.rules[k].on) kindsRead[k] = 1; });
        return S.signals.list(C.pod).then(function (stored) {
            var mg = G.merge(fresh, stored), gone = mg.gone.filter(function (r) { return kindsRead[r.KIND]; }).map(function (r) { return r.SIGNAL_KEY; });
            run.step = 'Saving ' + fresh.length + ' signals to APEX…'; paintRun();
            return S.signals.upsert(C.pod, fresh, function (d, n) { run.step = 'Saving signals to APEX · ' + d + ' / ' + n; paintRun(); })
                .then(function () { return gone.length ? S.signals.gone(C.pod, gone) : null; })
                .then(function () { return actOn(mg.add, run); })
                .then(function (acted) { return stopOnOrder(parts).then(function () { return { total: fresh.length, added: mg.add.length, gone: gone.length, acted: acted }; }); });
        });
    }
    /** the rules' actions for new signals — each one claimed first, so one PC acts */
    function actOn(list, run) {
        var todo = list.map(function (s) { return { s: s, a: G.actionFor(s, GR.st) }; }).filter(function (x) { return x.a.action !== 'NONE'; }).slice(0, 200), acted = 0;
        return todo.reduce(function (p, x, i) {
            return p.then(function () {
                if (run) { run.step = 'Acting on new signals · ' + (i + 1) + ' / ' + todo.length; paintRun(); }
                return S.signals.claim(C.pod, x.s.key).then(function (mine) { if (!mine) return; return GR.act(x.s, x.a, true).then(function () { acted++; }); }).catch(function (e) { console.warn('[CRM] action:', errText(e)); });
            });
        }, Promise.resolve()).then(function () { return acted; });
    }
    /** a signal's action: TASK (a follow-up in the Debtors timeline), TICKET, PLAYBOOK → the signal OPEN with the reference */
    GR.act = function (s, a, auto) {
        var bu = s.bu || C.buOf(s.account), name = s.name || custName(s.account), owner = (auto ? '' : C.me());
        var p;
        if (a.action === 'TASK') {
            var id = E.uid('ac'), due = C.addDays(+GR.st.taskDays || 1);
            p = D.act.add({ id: id, buId: bu, account: s.account, name: name, kind: 'TASK', subject: s.title, body: s.detail + (auto ? '\n(raised by the opportunity scan)' : ''), due: due, assignedTo: owner || null, source: 'USER', ref: s.key.slice(0, 40) }).then(function () { return id; });
        } else if (a.action === 'TICKET') {
            var t = { POD: C.pod, BU_ID: bu, ACCOUNT_NUMBER: s.account, ACCOUNT_NAME: name, SUBJECT: s.title.slice(0, 400), DESCRIPTION: s.detail + '\n\n' + (G.KINDS[s.kind] || {}).text, CATEGORY: s.kind === 'BOUNCED' ? 'Billing' : s.kind === 'CANCEL' ? 'Delivery' : 'Other', PRIORITY: s.score >= 70 ? 'P2' : 'P3', CHANNEL: 'INTERNAL', TOKEN: E.token(), prefix: C.setup.prefix };
            var r = E.route(t, C.setup, C.load); t.QUEUE = GR.st.ticketQueue || r.queue; t.PRIORITY = r.priority; t.ASSIGNED_TO = owner || r.assignee;
            var due2 = E.slaDue(S.now(), t.PRIORITY, C.setup); t.DUE_FIRST = due2.first; t.DUE_RESOLVE = due2.resolve;
            p = S.tickets.create(t).then(function (res) { return S.events.add({ ticketId: res.id, kind: 'CREATED', body: 'Raised by the opportunity scan: ' + s.title, visibility: 'INTERNAL' }).then(function () { return res.no || res.id; }); });
        } else if (a.action === 'PLAYBOOK') {
            var pb = G.playbook(GR.st, a.playbook);
            if (!pb) return Promise.reject(new Error('No playbook "' + a.playbook + '" — check the rules'));
            p = S.plays.start(C.pod, { playbook: pb.id, name: pb.name, account: s.account, accountName: name, bu: bu, signal: s.key, owner: owner, stopOnOrder: pb.stopOnOrder, reason: s.title + ' — ' + s.detail }).then(function (id) { return id || 'already running'; });
        } else return Promise.resolve();
        return p.then(function (ref) { return S.signals.set(C.pod, s.key, { status: 'OPEN', action: a.action, action_ref: String(ref || '').slice(0, 100), owner: owner || null }); });
    };
    /** stop-on-order playbooks whose customer ordered after they started */
    function stopOnOrder(parts) {
        if (!parts.portfolio) return Promise.resolve();
        var last = {}; parts.portfolio.forEach(function (r) { last[r.ACCOUNT_NUMBER] = r.LAST_ORDER; });
        return S.plays.list(C.pod).then(function (plays) {
            var stop = G.stopOnOrder(plays, last);
            return stop.reduce(function (p, x) { return p.then(function () { return S.plays.stop(x.PLAY_ID, 'the customer ordered again (' + last[x.ACCOUNT_NUMBER] + ')', 'DONE'); }); }, Promise.resolve());
        }).catch(function () { });
    }
    /** new rules on the rows this PC kept from the last scan — no Fusion */
    GR.recompute = function () {
        if (GR.run) return;
        var run = GR.run = { step: 'Reading this PC\'s copy of the last scan…', errors: [], counts: {}, ok: {} };
        paintRun();
        S.duck.scanRows(C.pod).then(function (x) {
            var parts = x.parts;
            if (!parts.portfolio && !parts.bounced) throw new Error('This PC has no scan yet — press Scan now');
            Object.keys(parts).forEach(function (k) { run.ok[k] = true; run.counts[k] = parts[k].length; });
            return apply(parts, run);
        }).then(function (res) { GR.run = null; C.toast('Rules applied to the last scan · ' + res.total + ' signals (' + res.added + ' new)', 'ok', 6000); return GR.load(); }, function (e) { GR.run = null; C.toast(errText(e), 'bad', 7000); })
            .then(function () { if (C.tab === 'growth') C.render(); });
    };
    function paintRun() {
        var el = $('gr-run'); if (!el) { if (C.tab === 'growth' && !GR.run) C.render(); return; }
        el.innerHTML = runHtml();
    }
    function runHtml() {
        if (GR.run) return '<span class="spin"></span> ' + esc(GR.run.step) + (GR.run.errors.length ? ' · <span class="warnc">' + GR.run.errors.length + ' source failed</span>' : '');
        var m = GR.meta;
        if (!m || !m.at) return '<span class="muted">Never scanned on ' + esc(C.pod) + ' — Scan now reads the sales of every customer from Fusion (a few minutes).</span>';
        return '<span class="muted">Last scan ' + C.when(m.at) + ' by ' + esc(m.by || '') + (m.ms ? ' · ' + Math.round(m.ms / 1000) + ' s' : '') + ' · ' + (m.signals || 0) + ' signals' + (m.counts && m.counts.portfolio ? ' from ' + m.counts.portfolio.toLocaleString() + ' customers' : '') +
            (m.errors && m.errors.length ? ' · <a data-act="grErrs" class="warnc">' + m.errors.length + ' source' + (m.errors.length > 1 ? 's' : '') + ' failed</a>' : '') + (m.running ? ' · <b>running on ' + esc(m.by) + '</b>' : '') + '</span>';
    }
    C.ACT.grScan = function () { GR.scan(false); };
    C.ACT.grRecompute = function () { GR.recompute(); };
    C.ACT.grErrs = function () {
        var m = GR.meta || {}, list = (GR.run || {}).errors || m.errors || [];
        C.modal('<i class="fas fa-triangle-exclamation"></i> Sources that failed in the last scan', list.map(function (x) { return '<div class="note bad"><b>' + esc(x.part) + '</b> — ' + esc(x.error) + (x.sql ? '<pre class="code sm">' + esc(x.sql) + '</pre>' : '') + '</div>'; }).join('') || '<div class="empty">None.</div>', '<button class="btn" data-act="mclose">Close</button>', true);
    };

    // ══ the Opportunities tab ═════════════════════════════════════
    var VIEWS = [['signals', 'fa-bolt', 'Signals'], ['plays', 'fa-route', 'Playbooks'], ['rules', 'fa-sliders', 'Rules & playbooks']];
    C.views.growth = function () {
        if (!GR.loaded) return '<div class="empty"><span class="spin"></span> Reading…</div>';
        var now = new Date(), sm = G.summary(GR.signals, now), plays = GR.plays.map(withSteps), due = G.playNotifications(plays, now, '').length, active = plays.filter(function (p) { return p.STATUS === 'ACTIVE'; }).length;
        var kinds = Object.keys(G.KINDS);
        var head = '<div class="card"><div class="row"><div><div style="font-size:18px;font-weight:800"><i class="fas fa-seedling"></i> Opportunities & risks</div><div class="small" id="gr-run">' + runHtml() + '</div></div><span class="sp"></span>' +
            '<button class="btn" data-act="grRecompute"' + (GR.run ? ' disabled' : '') + ' title="Apply the rules again to the rows this PC kept from the last scan — no Fusion"><i class="fas fa-calculator"></i> Re-apply rules</button>' +
            '<button class="btn pri" data-act="grScan"' + (GR.run ? ' disabled' : '') + '><i class="fas fa-satellite-dish"></i> Scan now</button></div>' + (GR.err ? '<div class="note bad">' + esc(GR.err) + '</div>' : '') + '</div>' +
            '<div class="kpis">' + C.kpi('Open signals', sm.open, sm.newN + ' new · not looked at', sm.newN ? 'warn' : 'info', 'grKind', ' data-k=""') +
            C.kpi('Revenue at stake', money(sm.value, 0), 'yearly, open signals', 'pri', 'grKind', ' data-k=""') +
            kinds.map(function (k) { var b = sm.byKind[k] || { n: 0, value: 0 }, K = G.KINDS[k]; return C.kpi(K.label, b.n, b.value ? money(b.value, 0) : K.group === 'grow' ? '' : 'service', b.n ? K.cls : '', 'grKind', ' data-k="' + k + '"'); }).join('') +
            C.kpi('Playbook steps due', due, active + ' playbooks running', due ? 'bad' : 'ok', 'grView', ' data-v="plays"') + '</div>';
        var tabs = '<div class="subtabs">' + VIEWS.map(function (v) { return '<button data-act="grView" data-v="' + v[0] + '" class="' + (GR.view === v[0] ? 'on' : '') + '"><i class="fas ' + v[1] + '"></i> ' + v[2] + '</button>'; }).join('') + '</div>';
        return head + tabs + (V[GR.view] || V.signals)();
    };
    C.ACT.grView = function (el) { GR.view = el.dataset.v; C.lsSet('gr.view', GR.view); if (C.tab !== 'growth') C.go('growth'); else C.render(); };
    C.ACT.grKind = function (el) { GR.f.kind = el.dataset.k || ''; GR.f.status = 'live'; C.lsSet('gr.f', GR.f); GR.view = 'signals'; C.render(); };
    var V = {};

    // ── signals ──
    function filtered() {
        var f = GR.f, now = new Date(), q = String(f.q || '').toLowerCase().trim(), me = C.me().toLowerCase();
        return GR.signals.filter(function (r) {
            if (f.kind && r.KIND !== f.kind) return false;
            if (f.status === 'live' && !G.isLive(r, now)) return false;
            if (f.status === 'closed' && G.isLive(r, now)) return false;
            if (f.owner === 'mine' && String(r.OWNER || '').toLowerCase() !== me) return false;
            if (f.owner === 'nobody' && r.OWNER) return false;
            if (q && (r.ACCOUNT_NUMBER + ' ' + r.ACCOUNT_NAME + ' ' + r.TITLE + ' ' + r.DETAIL).toLowerCase().indexOf(q) < 0) return false;
            return true;
        });
    }
    var ST = { NEW: ['new', 'warn'], OPEN: ['working', 'info'], SNOOZED: ['snoozed', 'muted'], DONE: ['done', 'ok'], DISMISSED: ['dismissed', 'muted'], GONE: ['no longer found', 'muted'] };
    V.signals = function () {
        var f = GR.f, list = filtered();
        var sel = function (id, cur, opts) { return '<select data-ch="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; };
        return '<div class="card"><div class="filters">' + sel('grFKind', f.kind, [['', 'Every kind']].concat(Object.keys(G.KINDS).map(function (k) { return [k, G.KINDS[k].label]; }))) +
            sel('grFStatus', f.status, [['live', 'Open (new, working, snoozed ending)'], ['closed', 'Closed'], ['all', 'All']]) + sel('grFOwner', f.owner, [['', 'Anyone'], ['mine', 'Mine'], ['nobody', 'Nobody yet']]) +
            '<input type="search" data-in="grQ" id="gr-q" placeholder="Customer, account, range…" value="' + esc(f.q || '') + '" style="flex:1"><button class="btn sm" data-act="grCsv"><i class="fas fa-file-csv"></i> CSV</button></div>' +
            C.table([
                [function (r) { var s = +r.SCORE || 0; return '<div class="gscore" title="Score ' + s + ' / 100"><span style="width:' + s + '%;background:' + (s >= 70 ? 'var(--bad)' : s >= 45 ? 'var(--amber)' : 'var(--ok)') + '"></span></div><b class="small">' + s + '</b>'; }, 'Score'],
                [function (r) { var K = G.KINDS[r.KIND] || {}; return '<span class="pill ' + (K.cls || '') + '"><i class="fas ' + (K.icon || 'fa-bolt') + '"></i> ' + esc(K.label || r.KIND) + '</span>'; }, 'Kind'],
                [function (r) { return '<a data-act="open360" data-acct="' + esc(r.ACCOUNT_NUMBER) + '" data-bu="' + esc(r.BU_ID || '') + '" data-name="' + esc(r.ACCOUNT_NAME || '') + '" data-sub="growth"><b>' + esc(r.ACCOUNT_NAME || r.ACCOUNT_NUMBER) + '</b></a><div class="small muted">' + esc(r.ACCOUNT_NUMBER) + '</div>'; }, 'Customer'],
                [function (r) { return '<div class="small">' + esc(r.DETAIL || '') + '</div>' + spark(r); }, 'Why'],
                [function (r) { return +r.VALUE ? money(+r.VALUE, 0) : ''; }, 'At stake / a year', 'r'],
                [function (r) { var x = ST[r.STATUS] || [r.STATUS, '']; return C.pill(x[0], x[1]) + (r.STATUS === 'SNOOZED' && r.SNOOZE_UNTIL ? '<div class="small muted">until ' + esc(String(r.SNOOZE_UNTIL).slice(0, 10)) + '</div>' : '') + actionText(r); }, 'Status'],
                [function (r) { return esc(r.OWNER || '') + '<div class="small muted">' + C.when(r.FIRST_SEEN) + '</div>'; }, 'Owner · seen'],
                [function (r) { return sigButtons(r); }, '', 'r']
            ], list, { empty: GR.signals.length ? 'No signal matches.' : 'No signals yet — press Scan now.', limit: 500 }) + '</div>';
    };
    /** what was done about a signal, in words: the playbook (and where it stands), the task, the ticket number */
    function actionText(r) {
        if (!r.ACTION || r.ACTION === 'NONE') return '';
        var t = r.ACTION === 'PLAYBOOK' ? (function () { var p = GR.plays.filter(function (x) { return x.PLAY_ID === r.ACTION_REF; })[0]; return p ? 'playbook ' + p.PLAYBOOK_NAME + ' · ' + (p.STATUS === 'ACTIVE' ? 'step ' + ((+p.STEP_N || 0) + 1) : p.STATUS.toLowerCase()) : 'a playbook'; })()
            : r.ACTION === 'TASK' ? 'follow-up task' : r.ACTION === 'TICKET' ? 'ticket ' + (r.ACTION_REF || '') : r.ACTION;
        return '<div class="small muted">' + esc(t) + (r.ACTION_BY && !r.OWNER ? ' · by the scan' : '') + '</div>';
    }
    function spark(r) {
        if (r.KIND !== 'CHURN') return '';
        var d; try { d = JSON.parse(r.DATA_JSON || '{}'); } catch (e) { d = {}; }
        var s = d.series || []; if (!s.length) return '';
        var max = Math.max.apply(null, s.concat([1]));
        return '<div class="spark mini" title="24 months, the last 3 full months in red">' + s.map(function (v, i) { return '<span class="' + (i >= 20 && i <= 22 ? 'hot' : i === 23 ? 'part' : '') + '" style="height:' + Math.max(2, Math.round(v / max * 100)) + '%"></span>'; }).join('') + '</div>';
    }
    function sigButtons(r) {
        var k = esc(r.SIGNAL_KEY), live = G.isLive(r, new Date());
        return (live ? '<button class="btn sm ok" data-act="grCall" data-key="' + k + '" title="Call the customer"><i class="fas fa-phone"></i></button>' +
            '<button class="btn sm" data-act="grPlay" data-key="' + k + '" title="Start a playbook"><i class="fas fa-route"></i></button>' +
            '<button class="btn sm" data-act="grTask" data-key="' + k + '" title="A follow-up task"><i class="fas fa-list-check"></i></button>' +
            '<button class="btn sm" data-act="grTicket" data-key="' + k + '" title="Open a ticket"><i class="fas fa-ticket"></i></button>' +
            (r.OWNER ? '' : '<button class="btn sm" data-act="grOwn" data-key="' + k + '" title="Take it — it becomes yours"><i class="fas fa-hand"></i></button>') +
            '<button class="btn sm ghost" data-act="grSnooze" data-key="' + k + '" title="Snooze 7 days"><i class="fas fa-clock"></i></button>' +
            '<button class="btn sm ghost" data-act="grDone" data-key="' + k + '" title="Done"><i class="fas fa-check"></i></button>' +
            '<button class="btn sm ghost" data-act="grDismiss" data-key="' + k + '" title="Dismiss — not relevant"><i class="fas fa-xmark"></i></button>'
            : '<button class="btn sm ghost" data-act="grReopen" data-key="' + k + '" title="Open again">Reopen</button>');
    }
    C.CH.grFKind = function (el) { GR.f.kind = el.value; C.lsSet('gr.f', GR.f); C.render(); };
    C.CH.grFStatus = function (el) { GR.f.status = el.value; C.lsSet('gr.f', GR.f); C.render(); };
    C.CH.grFOwner = function (el) { GR.f.owner = el.value; C.lsSet('gr.f', GR.f); C.render(); };
    var qT = 0;
    C.IN.grQ = function (el) { GR.f.q = el.value; clearTimeout(qT); qT = setTimeout(function () { C.lsSet('gr.f', GR.f); C.keepFocus('gr-q', C.render); }, 250); };
    C.ACT.grCsv = function () {
        C.csv('opportunities-' + C.pod + '.csv', [['SCORE', 'Score'], [function (r) { return (G.KINDS[r.KIND] || {}).label || r.KIND; }, 'Kind'], ['ACCOUNT_NUMBER', 'Account'], ['ACCOUNT_NAME', 'Customer'], ['TITLE', 'Signal'], ['DETAIL', 'Why'], ['VALUE', 'At stake / year'], ['STATUS', 'Status'], ['OWNER', 'Owner'], ['ACTION', 'Action'], ['ACTION_REF', 'Reference'], ['FIRST_SEEN', 'First seen'], ['LAST_SEEN', 'Last seen']], filtered());
    };
    function sig(key) { return GR.signals.filter(function (r) { return r.SIGNAL_KEY === key; })[0]; }
    function asSignal(r) { var d; try { d = JSON.parse(r.DATA_JSON || '{}'); } catch (e) { d = {}; } return { key: r.SIGNAL_KEY, kind: r.KIND, account: r.ACCOUNT_NUMBER, name: r.ACCOUNT_NAME, bu: r.BU_ID, score: +r.SCORE || 0, value: +r.VALUE || 0, title: r.TITLE, detail: r.DETAIL, data: d }; }
    function setSig(key, sets, msg) {
        return S.signals.set(C.pod, key, sets).then(function () { var r = sig(key); if (r) Object.keys(sets).forEach(function (k) { var v = sets[k]; r[k.toUpperCase()] = v && v.at ? v.at : v === 'SYSDATE' ? S.now() : v; }); if (msg) C.toast(msg, 'ok'); badge(); if (C.bell) C.bell.compute(true); C.render(); }, function (e) { C.toast(errText(e), 'bad', 7000); });
    }
    function phoneOf(acct) {
        var m = C.master[acct] || {}, hit = C.customerIndex().filter(function (x) { return x.account === acct; })[0] || {};
        return E.phoneList(m.PHONE || hit.phone || '')[0] || String(hit.phone || '').split(' / ')[0] || '';
    }
    C.ACT.grCall = function (el) {
        var r = sig(el.dataset.key); if (!r) return;
        var ph = phoneOf(r.ACCOUNT_NUMBER);
        if (!r.OWNER || r.STATUS === 'NEW') setSig(r.SIGNAL_KEY, { status: 'OPEN', owner: r.OWNER || C.me() });
        if (ph) C.ACT.dialNum({ dataset: { num: ph, acct: r.ACCOUNT_NUMBER } });
        else { C.toast('No phone number kept for ' + (r.ACCOUNT_NAME || r.ACCOUNT_NUMBER) + ' — opening the customer', 'warn'); C.open360(r.BU_ID, r.ACCOUNT_NUMBER, r.ACCOUNT_NAME, 'contacts'); }
    };
    C.ACT.grOwn = function (el) { setSig(el.dataset.key, { status: 'OPEN', owner: C.me() }, 'It is yours now'); };
    C.ACT.grSnooze = function (el) {
        var d = prompt('Snooze for how many days?', '7'); if (d == null) return; d = Math.max(1, Math.min(365, parseInt(d, 10) || 7));
        setSig(el.dataset.key, { status: 'SNOOZED', snooze_until: { at: C.addDays(d) + ' 00:00' } }, 'Snoozed until ' + C.addDays(d));
    };
    C.ACT.grDone = function (el) { var n = prompt('Done — what happened? (optional)', ''); if (n == null) return; setSig(el.dataset.key, { status: 'DONE', note: n, closed_by: C.me(), closed_at: 'SYSDATE' }, 'Marked done'); };
    C.ACT.grDismiss = function (el) { var n = prompt('Why is it not relevant? (the scan will not raise it again)', ''); if (n == null) return; setSig(el.dataset.key, { status: 'DISMISSED', note: n, closed_by: C.me(), closed_at: 'SYSDATE' }, 'Dismissed'); };
    C.ACT.grReopen = function (el) { setSig(el.dataset.key, { status: 'OPEN', closed_by: null, closed_at: null }, 'Open again'); };
    C.ACT.grTask = function (el) {
        var r = sig(el.dataset.key); if (!r) return;
        var end = C.busy('Creating the task…');
        GR.act(asSignal(r), { action: 'TASK' }, false).then(function () { end(); C.toast('Follow-up task created for ' + (C.addDays(+GR.st.taskDays || 1)), 'ok'); return C.loadCore(); }, function (e) { end(); C.toast(errText(e), 'bad', 7000); }).then(function () { C.render(); });
    };
    C.ACT.grTicket = function (el) {
        var r = sig(el.dataset.key); if (!r) return;
        setSig(r.SIGNAL_KEY, { status: 'OPEN', owner: r.OWNER || C.me(), action: 'TICKET' });
        C.newTicket({ account: r.ACCOUNT_NUMBER, bu: r.BU_ID, name: r.ACCOUNT_NAME, subject: r.TITLE, description: r.DETAIL, category: r.KIND === 'BOUNCED' ? 'Billing' : r.KIND === 'CANCEL' ? 'Delivery' : '', channel: 'INTERNAL' });
    };
    /** start a playbook for a signal or a customer: the playbook, the owner, the reason */
    C.ACT.grPlay = function (el) {
        var r = el.dataset.key ? sig(el.dataset.key) : null, acct = r ? r.ACCOUNT_NUMBER : el.dataset.acct, name = r ? r.ACCOUNT_NAME : el.dataset.name || custName(acct);
        if (!acct) return;
        var pbs = GR.st.playbooks, pre = r ? ((GR.st.rules[r.KIND] || {}).playbook || (pbs.filter(function (p) { return (p.for || []).indexOf(r.KIND) >= 0; })[0] || {}).id) : el.dataset.pb;
        var agents = (C.setup.agents || []).map(function (a) { return a.user; }); if (agents.indexOf(C.me()) < 0) agents.unshift(C.me());
        GR.pp = { r: r, acct: acct, name: name, bu: r ? r.BU_ID : el.dataset.bu || C.buOf(acct) };
        C.modal('<i class="fas fa-route"></i> Start a playbook · ' + esc(name || acct),
            '<div class="form"><div class="field wide"><label>Playbook</label><select id="pp-pb" data-ch="ppPb">' + pbs.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === pre ? ' selected' : '') + '>' + esc(p.name) + ' · ' + p.steps.length + ' steps</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>Owner</label><select id="pp-owner">' + agents.map(function (a) { return '<option' + (a === C.me() ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field wide"><label>Why (shown on every step)</label><input type="text" id="pp-why" value="' + esc(r ? r.TITLE + ' — ' + r.DETAIL : '') + '"></div><div class="field wide" id="pp-steps">' + stepsHtml(G.playbook(GR.st, pre) || pbs[0]) + '</div></div>',
            '<button class="btn" data-act="mclose">Cancel</button><button class="btn pri" data-act="ppStart"><i class="fas fa-play"></i> Start</button>', true);
    };
    function stepsHtml(pb) {
        if (!pb) return '';
        return '<div class="pbsteps">' + pb.steps.map(function (s) { var K = G.STEP_KINDS[s.kind] || {}; return '<div class="pbs"><span class="d">day ' + s.day + '</span><i class="fas ' + K.icon + '"></i> <b>' + esc(s.title) + '</b>' + (s.note ? '<div class="small muted">' + esc(s.note) + '</div>' : '') + '</div>'; }).join('') + '</div>' + (pb.stopOnOrder ? '<div class="small muted"><i class="fas fa-circle-stop"></i> stops by itself when the customer orders again</div>' : '');
    }
    C.CH.ppPb = function (el) { $('pp-steps').innerHTML = stepsHtml(G.playbook(GR.st, el.value)); };
    C.ACT.ppStart = function () {
        var pp = GR.pp, pb = G.playbook(GR.st, $('pp-pb').value); if (!pb) return;
        var owner = $('pp-owner').value, why = $('pp-why').value.trim(), end = C.busy('Starting the playbook…');
        C.mclose();
        S.plays.start(C.pod, { playbook: pb.id, name: pb.name, account: pp.acct, accountName: pp.name, bu: pp.bu, signal: pp.r ? pp.r.SIGNAL_KEY : '', owner: owner, stopOnOrder: pb.stopOnOrder, reason: why }).then(function (id) {
            if (!id) { C.toast(pb.name + ' is already running for ' + (pp.name || pp.acct), 'warn', 6000); return; }
            return (pp.r ? S.signals.set(C.pod, pp.r.SIGNAL_KEY, { status: 'OPEN', owner: owner, action: 'PLAYBOOK', action_ref: id }) : Promise.resolve()).then(function () { C.toast(pb.name + ' started · first step due ' + G.playState({ STARTED_AT: S.now(), STEP_N: 0, steps: pb.steps }, new Date()).due, 'ok', 6000); });
        }).catch(function (e) { C.toast(errText(e), 'bad', 7000); }).then(function () { end(); return GR.load(); }).then(function () { C.render(); });
    };

    // ── playbooks ──
    V.plays = function () {
        var now = new Date(), me = C.me().toLowerCase(), plays = GR.plays.map(withSteps).map(function (p) { p._s = G.playState(p, now); return p; });
        var mine = GR.pf.mine, act = plays.filter(function (p) { return p.STATUS === 'ACTIVE' && (!mine || !p.OWNER || String(p.OWNER).toLowerCase() === me); });
        var due = act.filter(function (p) { return p._s.dueNow; }).sort(function (a, b) { return String(a._s.due).localeCompare(String(b._s.due)); });
        var later = act.filter(function (p) { return !p._s.dueNow; }).sort(function (a, b) { return String(a._s.due).localeCompare(String(b._s.due)); });
        var ended = plays.filter(function (p) { return p.STATUS !== 'ACTIVE'; });
        return '<div class="card"><div class="row"><label class="chk"><input type="checkbox" data-ch="grMine"' + (mine ? ' checked' : '') + '> only mine (and nobody\'s)</label><span class="sp"></span><span class="small muted">Start a playbook from a signal, a customer\'s 360 › Opportunities, or below.</span></div></div>' +
            '<div class="card"><h2><i class="fas fa-bell"></i> Steps due now <span class="pill ' + (due.length ? 'bad' : 'ok') + '">' + due.length + '</span></h2>' + playList(due, 'Nothing due — well done.') + '</div>' +
            '<div class="card"><h2><i class="fas fa-calendar"></i> Coming up <span class="pill">' + later.length + '</span></h2>' + playList(later, due.length ? 'Nothing else planned.' : 'No playbook running.') + '</div>' +
            '<div class="card"><h2><i class="fas fa-book"></i> Playbook library</h2><div class="pblib">' + GR.st.playbooks.map(function (pb) {
                var running = plays.filter(function (p) { return p.PLAYBOOK_ID === pb.id && p.STATUS === 'ACTIVE'; }).length;
                return '<div class="pbcard"><div class="row"><b>' + esc(pb.name) + '</b><span class="sp"></span>' + C.pill(running + ' running', running ? 'info' : 'muted') + '</div><div class="small muted">' + ((pb.for || []).length ? 'for ' + pb.for.map(function (k) { return (G.KINDS[k] || {}).label || k; }).join(', ') : 'start by hand') + (pb.stopOnOrder ? ' · stops when they order' : '') + '</div>' + stepsHtml(pb) +
                    '<div class="row"><input type="search" placeholder="Start for a customer…" data-in="pbFind" data-pb="' + esc(pb.id) + '" style="flex:1"></div><div class="feed" id="pbf-' + esc(pb.id) + '"></div></div>';
            }).join('') + '</div></div>' +
            (ended.length ? '<div class="card"><h2><i class="fas fa-flag-checkered"></i> Ended in the last 30 days <span class="pill">' + ended.length + '</span></h2>' + C.table([
                [function (p) { return '<a data-act="open360" data-acct="' + esc(p.ACCOUNT_NUMBER) + '" data-bu="' + esc(p.BU_ID || '') + '" data-name="' + esc(p.ACCOUNT_NAME || '') + '" data-sub="growth">' + esc(p.ACCOUNT_NAME || p.ACCOUNT_NUMBER) + '</a>'; }, 'Customer'], ['PLAYBOOK_NAME', 'Playbook'], [function (p) { return C.pill(esc(p.STATUS), p.STATUS === 'DONE' ? 'ok' : 'muted'); }, 'Status'],
                [function (p) { return esc(p.END_REASON || ''); }, 'Why it ended'], ['OWNER', 'Owner'], [function (p) { return esc(String(p.ENDED_AT || '').slice(0, 16)); }, 'Ended']], ended, { limit: 200 }) + '</div>' : '');
    };
    function playList(list, empty) {
        if (!list.length) return '<div class="empty">' + esc(empty) + '</div>';
        return '<div class="feed">' + list.map(function (p) {
            var s = p._s, st = s.step || {}, K = G.STEP_KINDS[st.kind] || {};
            return '<div class="fi ' + (s.late ? 'bad' : s.dueNow ? 'warn' : '') + '"><div class="ic"><i class="fas ' + (K.icon || 'fa-route') + '"></i></div><div class="tx"><div class="t">' + esc(K.label || '') + ' · ' + esc(st.title || '') + ' — <a data-act="open360" data-acct="' + esc(p.ACCOUNT_NUMBER) + '" data-bu="' + esc(p.BU_ID || '') + '" data-name="' + esc(p.ACCOUNT_NAME || '') + '" data-sub="growth">' + esc(p.ACCOUNT_NAME || p.ACCOUNT_NUMBER) + '</a></div>' +
                '<div class="s">' + esc(p.PLAYBOOK_NAME || '') + ' · step ' + (s.index + 1) + ' of ' + s.total + ' · due ' + esc(s.due) + (s.late ? ' · ' + s.days + ' day' + (s.days > 1 ? 's' : '') + ' late' : '') + (p.OWNER ? ' · ' + esc(p.OWNER) : ' · nobody') + '</div>' +
                '<div class="pbprog"><span style="width:' + s.progress + '%"></span></div>' + (p.REASON ? '<div class="b">' + esc(String(p.REASON).slice(0, 220)) + '</div>' : '') + '</div>' +
                '<div class="ac"><button class="btn sm pri" data-act="pbDo" data-id="' + esc(p.PLAY_ID) + '">Do it</button><button class="btn sm ghost" data-act="pbStop" data-id="' + esc(p.PLAY_ID) + '" title="Stop this playbook"><i class="fas fa-stop"></i></button></div></div>';
        }).join('') + '</div>';
    }
    C.CH.grMine = function (el) { GR.pf.mine = el.checked; C.lsSet('gr.pf', GR.pf); C.render(); };
    C.IN.pbFind = function (el) {
        var hits = C.searchLocal(el.value, 6), box = $('pbf-' + el.dataset.pb); if (!box) return;
        box.innerHTML = el.value.trim().length < 2 ? '' : hits.map(function (h) { return '<div class="fi click" data-act="grPlay" data-acct="' + esc(h.account) + '" data-bu="' + esc(h.bu || '') + '" data-name="' + esc(h.name || '') + '" data-pb="' + esc(el.dataset.pb) + '"><div class="ic"><i class="fas fa-user"></i></div><div class="tx"><div class="t">' + esc(h.name || h.account) + '</div><div class="s">' + esc(h.account) + '</div></div></div>'; }).join('') || '<div class="small muted">Nobody found here — open the customer from Customers first.</div>';
    };
    function playById(id) { var p = GR.plays.filter(function (x) { return x.PLAY_ID === id; })[0]; return p ? withSteps(p) : null; }
    GR.playById = playById;
    /** a due step: what to do, the tools (call, e-mail with the text filled in), then the outcome */
    C.ACT.pbDo = function (el) {
        var p = playById(el.dataset.id); if (!p) return;
        var s = G.playState(p, new Date()), st = s.step; if (!st) { C.toast('Nothing left to do in this playbook', 'info'); return; }
        var K = G.STEP_KINDS[st.kind] || {}, vars = playVars(p), ph = phoneOf(p.ACCOUNT_NUMBER);
        GR.pd = { p: p, s: s, vars: vars };
        C.modal('<i class="fas ' + K.icon + '"></i> ' + esc(K.label) + ' · ' + esc(p.ACCOUNT_NAME || p.ACCOUNT_NUMBER),
            '<div class="small muted">' + esc(p.PLAYBOOK_NAME || '') + ' · step ' + (s.index + 1) + ' of ' + s.total + ' · due ' + esc(s.due) + (p.REASON ? '<br>' + esc(p.REASON) : '') + '</div>' +
            '<h3 style="margin:10px 0 4px">' + esc(st.title) + '</h3>' + (st.note ? '<div class="note">' + esc(st.note) + '</div>' : '') +
            (st.kind === 'EMAIL' ? '<div class="note"><b>' + esc(G.fill(st.subject || st.title, vars)) + '</b><div style="white-space:pre-wrap;margin-top:6px">' + esc(G.fill(st.body || '', vars)) + '</div></div>' : '') +
            '<div class="row" style="margin:10px 0">' + (st.kind === 'CALL' || st.kind === 'VISIT' ? (ph ? '<button class="btn ok" data-act="pdCall"><i class="fas fa-phone"></i> Call ' + esc(ph) + '</button>' : '<span class="small muted">No phone number kept for this customer.</span>') : '') +
            (st.kind === 'EMAIL' ? '<button class="btn pri" data-act="pdMail"><i class="fas fa-envelope"></i> Write the e-mail</button>' : '') + (st.kind === 'TICKET' ? '<button class="btn" data-act="pdTicket"><i class="fas fa-ticket"></i> Open a ticket</button>' : '') +
            '<button class="btn ghost" data-act="pd360"><i class="fas fa-id-card"></i> Customer 360</button></div>' +
            '<div class="form"><div class="field"><label>Outcome</label><select id="pd-out"><option value="DONE">Done</option><option value="REACHED">Reached the customer</option><option value="NOT_REACHED">Not reached</option><option value="SKIPPED">Skipped</option></select></div>' +
            '<div class="field wide"><label>Note</label><textarea id="pd-note" rows="3" placeholder="What happened, what they said…"></textarea></div></div>' +
            (s.next ? '<div class="small muted">Next: day ' + s.next.day + ' · ' + esc((G.STEP_KINDS[s.next.kind] || {}).label) + ' · ' + esc(s.next.title) + '</div>' : '<div class="small muted">This is the last step.</div>'),
            '<button class="btn" data-act="mclose">Later</button><span class="sp"></span><button class="btn pri" data-act="pdSave"><i class="fas fa-check"></i> Save the step</button>', true);
    };
    function playVars(p) {
        var c = C.contacts.filter(function (k) { return k.ACCOUNT_NUMBER === p.ACCOUNT_NUMBER; })[0] || {}, sg = p.SIGNAL_KEY ? sig(p.SIGNAL_KEY) : null, d = {};
        try { d = sg ? JSON.parse(sg.DATA_JSON || '{}') : {}; } catch (e) { d = {}; }
        return { CONTACT: c.NAME || '', CUSTOMER: p.ACCOUNT_NAME || '', ACCOUNT_NUMBER: p.ACCOUNT_NUMBER, AGENT: C.me(), RANGE: d.group || '', REF: d.receipt || d.order || '', AMOUNT: d.amount ? money(d.amount) : '' };
    }
    C.ACT.pdCall = function () { var p = GR.pd.p; C.ACT.dialNum({ dataset: { num: phoneOf(p.ACCOUNT_NUMBER), acct: p.ACCOUNT_NUMBER } }); };
    C.ACT.pdMail = function () {
        var pd = GR.pd, st = pd.s.step, p = pd.p;
        C.mclose();
        C.mail.compose({ account: p.ACCOUNT_NUMBER, bu: p.BU_ID || C.buOf(p.ACCOUNT_NUMBER), name: p.ACCOUNT_NAME, subject: G.fill(st.subject || st.title, pd.vars), body: G.fill(st.body || '', pd.vars) });
        C.toast('After sending, open the step again (Playbooks › Do it) and save it as done', 'info', 7000);
    };
    C.ACT.pdTicket = function () { var p = GR.pd.p; C.mclose(); C.newTicket({ account: p.ACCOUNT_NUMBER, bu: p.BU_ID, name: p.ACCOUNT_NAME, subject: GR.pd.s.step.title, description: p.REASON || '' }); };
    C.ACT.pd360 = function () { var p = GR.pd.p; C.mclose(); C.open360(p.BU_ID, p.ACCOUNT_NUMBER, p.ACCOUNT_NAME, 'growth'); };
    C.ACT.pdSave = function () {
        var pd = GR.pd, out = $('pd-out').value, note = $('pd-note').value.trim(), p = pd.p, end = C.busy('Saving the step…');
        C.mclose();
        S.plays.step(p, pd.s.step, out, note, '', pd.s.total).then(function () {
            // the step also lands on the customer's timeline (Debtors activity) so the 360 shows it
            var kind = pd.s.step.kind === 'EMAIL' ? 'EMAIL' : pd.s.step.kind === 'VISIT' ? 'VISIT' : pd.s.step.kind === 'CALL' ? 'CALL' : 'NOTE';
            return D.act.add({ id: E.uid('ac'), buId: p.BU_ID || C.buOf(p.ACCOUNT_NUMBER), account: p.ACCOUNT_NUMBER, name: p.ACCOUNT_NAME, kind: kind, subject: (p.PLAYBOOK_NAME || 'Playbook') + ' · ' + pd.s.step.title, body: out.replace('_', ' ').toLowerCase() + (note ? ' — ' + note : ''), status: 'DONE', source: 'USER', ref: p.PLAY_ID }).catch(function () { });
        }).then(function () { end(); C.toast(pd.s.index + 1 >= pd.s.total ? 'Playbook done 🎉' : 'Step saved — next: ' + pd.s.next.title, 'ok', 5000); return GR.load(); }, function (e) { end(); C.toast(errText(e), 'bad', 7000); }).then(function () { C.render(); });
    };
    C.ACT.pbStop = function (el) {
        var n = prompt('Stop this playbook — why?', ''); if (n == null) return;
        S.plays.stop(el.dataset.id, n || 'stopped by ' + C.me()).then(function () { C.toast('Stopped', 'ok'); return GR.load(); }, function (e) { C.toast(errText(e), 'bad'); }).then(function () { C.render(); });
    };

    // ── rules & playbooks ──
    V.rules = function () {
        var st = GR.st, R = st.rules, pbOpts = function (cur) { return '<option value="">—</option>' + st.playbooks.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === cur ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join(''); };
        var num = function (k, f, v, w, hint) { return '<label class="small" title="' + esc(hint || '') + '">' + esc(f) + ' <input type="number" id="gr-' + k + '-' + f.replace(/\W+/g, '') + '" value="' + esc(v) + '" style="width:' + (w || 80) + 'px"></label>'; };
        var TH = {
            CHURN: [['minBase', 'normal month ≥', 'the customer\'s normal monthly buying (12 months before the last 3) must be at least this'], ['dropPct', 'drop % ≥', 'last 3 full months below the normal by at least'], ['gapFactor', 'gap × ', 'or no order for this many times the usual gap between orders'], ['minGapDays', 'and ≥ days', 'and at least this many days']],
            LAPSED: [['minPrev', 'bought ≥', 'bought at least this in the 12 months before'], ['slowPct', 'or down % ≥', 'or bought this much less and nothing in 3 months']],
            WHITESPACE: [['minPeers', 'peers ≥', 'at least this many similar customers'], ['minPenetration', '% of peers ≥', 'bought by at least this share of them'], ['top', 'per customer', 'at most this many ideas per customer']],
            BOUNCED: [['days', 'last days', 'receipts reversed in the last n days']], MRA: [['days', 'last days', 'failed in the last n days']], CANCEL: [['days', 'last days', 'cancelled in the last n days'], ['minLines', 'lines ≥', 'at least this many lines on the order']]
        };
        return '<div class="card"><h2>Rules <span class="small muted">— what the scan looks for and what a NEW signal does by itself (one PC acts on it)</span></h2>' +
            '<div class="form"><div class="field"><label>Ranges by</label><select id="gr-dim"><option value="PROFIT_CENTER"' + (st.dim !== 'SUPPLIER' ? ' selected' : '') + '>Profit centre (item DFF ' + esc(((C.setup || {}).itemDff || {}).profitCenter || '—') + ')</option><option value="SUPPLIER"' + (st.dim === 'SUPPLIER' ? ' selected' : '') + '>Supplier (item DFF ' + esc(((C.setup || {}).itemDff || {}).supplier || '—') + ')</option></select></div>' +
            '<div class="field"><label class="chk"><input type="checkbox" id="gr-auto"' + (st.auto !== false ? ' checked' : '') + '> Scan by itself every (hours)</label><input type="number" id="gr-hours" min="1" value="' + esc(st.scanHours) + '"></div><div class="field"><label>Business unit id (blank = every one)</label><input type="text" id="gr-bu" value="' + esc(st.bu || '') + '"></div>' +
            '<div class="field"><label>Follow-up tasks due in (days)</label><input type="number" id="gr-tdays" min="0" value="' + esc(st.taskDays) + '"></div><div class="field"><label>Tickets go to the queue</label><select id="gr-tq">' + (C.setup.queues || []).map(function (q) { return '<option' + (q === st.ticketQueue ? ' selected' : '') + '>' + esc(q) + '</option>'; }).join('') + '</select></div></div>' +
            '<table class="tbl" style="margin-top:10px"><thead><tr><th>On</th><th>Signal</th><th>Thresholds</th><th>A new one…</th><th>Playbook</th><th>Act from score</th></tr></thead><tbody>' + Object.keys(G.KINDS).map(function (k) {
                var r = R[k], K = G.KINDS[k];
                return '<tr><td><input type="checkbox" id="gr-' + k + '-on"' + (r.on ? ' checked' : '') + '></td><td><b><i class="fas ' + K.icon + '"></i> ' + esc(K.label) + '</b><div class="small muted">' + esc(K.text) + '</div></td><td><div class="row" style="gap:8px;flex-wrap:wrap">' + (TH[k] || []).map(function (t) { return num(k, t[1], r[t[0]], 70, t[2]).replace('id="gr-' + k + '-' + t[1].replace(/\W+/g, '') + '"', 'id="gr-' + k + '-' + t[0] + '"'); }).join('') + '</div></td>' +
                    '<td><select id="gr-' + k + '-action">' + Object.keys(G.ACTIONS).map(function (a) { return '<option value="' + a + '"' + (a === r.action ? ' selected' : '') + '>' + esc(G.ACTIONS[a]) + '</option>'; }).join('') + '</select></td><td><select id="gr-' + k + '-playbook">' + pbOpts(r.playbook) + '</select></td><td><input type="number" id="gr-' + k + '-minScore" min="0" max="100" value="' + esc(r.minScore || 0) + '" style="width:64px"></td></tr>';
            }).join('') + '</tbody></table></div>' +
            '<div class="card"><h2>Playbooks <span class="small muted">— <code># id | name | for kinds | stop on order</code>, then one step per line <code>day | CALL / EMAIL / VISIT / TASK / TICKET | title | note or e-mail body (\\n = new line) | e-mail subject</code>. In texts: {CONTACT} {CUSTOMER} {ACCOUNT_NUMBER} {AGENT} {RANGE} {REF} {AMOUNT}</span></h2>' +
            '<textarea class="code" id="gr-pbs" rows="18">' + esc(G.playbooksText(st.playbooks)) + '</textarea><div class="small" id="gr-pbs-err"></div></div>' +
            '<div class="runbar"><span class="muted small">Shared by every PC (APEX WMS_CRM_SETTINGS GROWTH). After a change, Re-apply rules works on the last scan without Fusion.</span><span class="sp"></span><button class="btn" data-act="grDefaults">Back to the defaults</button><button class="btn pri" data-act="grSaveRules"><i class="fas fa-floppy-disk"></i> Save</button></div>';
    };
    C.ACT.grSaveRules = function () {
        var st = JSON.parse(JSON.stringify(GR.st)), v = function (id) { var x = $(id); return x ? x.value : ''; };
        st.auto = $('gr-auto').checked; st.dim = v('gr-dim'); st.scanHours = Math.max(1, +v('gr-hours') || 24); st.bu = v('gr-bu').trim(); st.taskDays = Math.max(0, +v('gr-tdays') || 0); st.ticketQueue = v('gr-tq');
        Object.keys(G.KINDS).forEach(function (k) {
            var r = st.rules[k]; r.on = $('gr-' + k + '-on').checked; r.action = v('gr-' + k + '-action'); r.playbook = v('gr-' + k + '-playbook'); r.minScore = +v('gr-' + k + '-minScore') || 0;
            Object.keys(r).forEach(function (f) { var el = $('gr-' + k + '-' + f); if (el && el.type === 'number' && f !== 'minScore') r[f] = +el.value || 0; });
        });
        var pb = G.parsePlaybooks(v('gr-pbs'));
        if (pb.errors.length) { $('gr-pbs-err').innerHTML = '<span class="badc">' + pb.errors.map(esc).join('<br>') + '</span>'; C.toast('Fix the playbooks first', 'bad'); return; }
        if (!pb.list.length) { C.toast('Keep at least one playbook', 'bad'); return; }
        st.playbooks = pb.list;
        var bad = Object.keys(st.rules).filter(function (k) { return st.rules[k].action === 'PLAYBOOK' && !G.playbook(st, st.rules[k].playbook); });
        if (bad.length) { C.toast('Choose a playbook for: ' + bad.map(function (k) { return G.KINDS[k].label; }).join(', '), 'bad'); return; }
        var end = C.busy('Saving…');
        S.settings.save('GROWTH', st).then(function () { end(); GR.st = G.settings(st); C.toast('Rules saved', 'ok'); C.render(); }, function (e) { end(); C.toast(errText(e), 'bad', 7000); });
    };
    C.ACT.grDefaults = function () { if (!confirm('Put the rules and the playbooks back to the defaults? (Save to keep them)')) return; GR.st = G.settings(null); C.render(); };

    // ══ Customer 360 › Opportunities + Deliveries ════════════════
    var subs = C.C360_SUBS, at = subs.map(function (s) { return s[0]; }).indexOf('items') + 1;
    subs.splice(at, 0, ['growth', 'fa-seedling', 'Opportunities'], ['delivery', 'fa-truck', 'Deliveries']);
    C.C360_COUNT.growth = function (c) { var n = (G.byAccount(GR.signals, new Date())[c.account] || []).length + GR.plays.filter(function (p) { return p.ACCOUNT_NUMBER === c.account && p.STATUS === 'ACTIVE'; }).length; return n || ''; };
    C.C360_VIEWS.growth = function (c) {
        var now = new Date(), sigs = GR.signals.filter(function (r) { return r.ACCOUNT_NUMBER === c.account; }), live = sigs.filter(function (r) { return G.isLive(r, now); }), closed = sigs.filter(function (r) { return !G.isLive(r, now); });
        var plays = GR.plays.filter(function (p) { return p.ACCOUNT_NUMBER === c.account; }).map(withSteps).map(function (p) { p._s = G.playState(p, now); return p; });
        if (!c.pstep && plays.length) { c.pstep = 'loading'; S.plays.steps(plays.map(function (p) { return p.PLAY_ID; })).then(function (r) { c.pstep = r; if (C.cust === c && c.sub === 'growth') C.render(); }, function () { c.pstep = []; }); }
        var steps = Array.isArray(c.pstep) ? c.pstep : [];
        return '<div class="cols"><div><div class="card"><h2><i class="fas fa-bolt"></i> Risks & opportunities <span class="pill">' + live.length + '</span><span class="sp"></span><button class="btn sm pri" data-act="grPlay" data-acct="' + esc(c.account) + '" data-bu="' + esc(c.bu || '') + '" data-name="' + esc(c.name || '') + '"><i class="fas fa-route"></i> Start a playbook</button></h2>' +
            (live.length ? '<div class="feed">' + live.map(function (r) { var K = G.KINDS[r.KIND] || {}; return '<div class="fi ' + (K.cls === 'bad' ? 'bad' : K.cls === 'warn' ? 'warn' : '') + '"><div class="ic"><i class="fas ' + (K.icon || 'fa-bolt') + '"></i></div><div class="tx"><div class="t">' + esc(r.TITLE) + ' ' + C.pill(r.SCORE + '', +r.SCORE >= 70 ? 'bad' : +r.SCORE >= 45 ? 'warn' : 'ok') + '</div><div class="b">' + esc(r.DETAIL) + '</div>' + spark(r) + '<div class="s">' + (+r.VALUE ? money(+r.VALUE, 0) + ' a year at stake · ' : '') + 'seen ' + C.when(r.FIRST_SEEN) + (r.OWNER ? ' · ' + esc(r.OWNER) : '') + '</div></div><div class="ac">' + sigButtons(r) + '</div></div>'; }).join('') + '</div>'
                : '<div class="empty">' + (GR.meta && GR.meta.at ? 'Nothing found for this customer in the last scan (' + esc(String(GR.meta.at).slice(0, 16)) + ').' : 'No scan yet — Opportunities › Scan now.') + '</div>') +
            (closed.length ? '<details style="margin-top:8px"><summary class="small muted">' + closed.length + ' closed</summary>' + C.table([[function (r) { return esc(r.TITLE); }, 'Signal'], [function (r) { return C.pill((ST[r.STATUS] || [r.STATUS])[0], 'muted'); }, 'Status'], ['NOTE', 'Note'], ['CLOSED_BY', 'By']], closed) + '</details>' : '') + '</div></div>' +
            '<div><div class="card"><h2><i class="fas fa-route"></i> Playbooks</h2>' + (plays.length ? '<div class="feed">' + plays.map(function (p) {
                var s = p._s, done = steps.filter(function (x) { return x.PLAY_ID === p.PLAY_ID; });
                return '<div class="fi ' + (p.STATUS === 'ACTIVE' && s.late ? 'bad' : '') + '"><div class="ic"><i class="fas fa-route"></i></div><div class="tx"><div class="t">' + esc(p.PLAYBOOK_NAME) + ' ' + C.pill(esc(p.STATUS), p.STATUS === 'ACTIVE' ? 'info' : p.STATUS === 'DONE' ? 'ok' : 'muted') + '</div>' +
                    '<div class="s">started ' + esc(String(p.STARTED_AT || '').slice(0, 16)) + ' · ' + esc(p.OWNER || 'nobody') + (p.STATUS === 'ACTIVE' && s.step ? ' · next: ' + esc(s.step.title) + ' due ' + esc(s.due) : p.END_REASON ? ' · ' + esc(p.END_REASON) : '') + '</div><div class="pbprog"><span style="width:' + s.progress + '%"></span></div>' +
                    (done.length ? '<div class="small">' + done.map(function (x) { return '✓ ' + esc(x.TITLE) + ' — ' + esc(String(x.OUTCOME || '').replace('_', ' ').toLowerCase()) + (x.NOTE ? ': ' + esc(x.NOTE) : '') + ' <span class="muted">' + esc(x.BY_USER) + ' ' + esc(String(x.DONE_AT || '').slice(0, 16)) + '</span>'; }).join('<br>') + '</div>' : '') + '</div>' +
                    (p.STATUS === 'ACTIVE' ? '<div class="ac"><button class="btn sm pri" data-act="pbDo" data-id="' + esc(p.PLAY_ID) + '">Do it</button><button class="btn sm ghost" data-act="pbStop" data-id="' + esc(p.PLAY_ID) + '"><i class="fas fa-stop"></i></button></div>' : '') + '</div>';
            }).join('') + '</div>' : '<div class="empty">No playbook for this customer yet.</div>') + '</div></div></div>';
    };
    C.C360_VIEWS.delivery = function (c) {
        var dv = c.deliv;
        if (!dv) { loadDeliveries(c); return '<div class="empty"><span class="spin"></span> Reading the WMS trips…</div>'; }
        if (dv.loading) return '<div class="empty"><span class="spin"></span> Reading the WMS trips…</div>';
        var t0 = C.today(), rows = dv.rows || [];
        var counts = {}; rows.forEach(function (r) { var st = G.deliveryStage(r, t0).stage; counts[st] = (counts[st] || 0) + 1; });
        return '<div class="card"><div class="row"><h2 style="margin:0"><i class="fas fa-truck"></i> Orders on WMS trips · last ' + dv.days + ' days</h2><span class="sp"></span>' + Object.keys(counts).map(function (k) { return C.pill(esc(k) + ' ' + counts[k], ''); }).join(' ') +
            '<select data-ch="dvDays">' + [30, 90, 180, 365].map(function (d) { return '<option value="' + d + '"' + (d === dv.days ? ' selected' : '') + '>' + d + ' days</option>'; }).join('') + '</select><button class="btn sm" data-act="dvRefresh"><i class="fas fa-rotate"></i></button></div>' +
            (dv.err ? '<div class="note bad">' + esc(dv.err) + '</div>' : '') + (dv.note ? '<div class="small muted">' + esc(dv.note) + '</div>' : '') +
            C.table([
                [function (r) { return '<b>' + esc(r.ORDER_NUMBER) + '</b><div class="small muted">' + esc(r.ORDER_TYPE || '') + (r.ORDER_DATE ? ' · ' + esc(r.ORDER_DATE) : '') + '</div>'; }, 'Order'],
                [function (r) { return 'Trip <b>' + esc(r.TRIP_ID) + '</b><div class="small muted">' + esc(r.TRIP_DATE || '') + ' · ' + esc(r.LORRY || '') + (r.BAY ? ' · bay ' + esc(r.BAY) : '') + '</div>'; }, 'Trip'],
                [function (r) { var g = G.deliveryStage(r, t0); return C.pill(esc(g.stage), g.cls) + '<div class="dvsteps">' + g.steps.map(function (s) { return '<span class="' + (s[2] ? 'bad' : s[1] ? 'done' : '') + '">' + (s[2] ? '✗ ' : s[1] ? '✓ ' : '') + esc(s[0]) + '</span>'; }).join('') + '</div>'; }, 'Stage'],
                [function (r) { return esc(r.PICKER || ''); }, 'Picker'],
                [function (r) { return esc(r.ACTUAL_SHIP_DATE || ''); }, 'Shipped'],
                [function (r) { return esc(r.MRA_STATUS || ''); }, 'MRA'],
                [function (r) { return esc(r.SALESMAN || ''); }, 'Salesman'],
                [function (r) { return '<button class="btn sm" data-act="orderLines" data-no="' + esc(r.ORDER_NUMBER) + '" title="The order lines in Fusion"><i class="fas fa-list"></i></button>'; }, '', 'r']
            ], rows, { empty: 'No order of this customer on a WMS trip in the last ' + dv.days + ' days.' }) + '</div>';
    };
    function loadDeliveries(c, days) {
        days = days || (c.deliv && c.deliv.days) || 90;
        c.deliv = { loading: true, days: days };
        var list = G.sql.deliveries(C.pod, c.account, days), i = 0, tried = 0;
        function next() {
            if (i >= list.length) return Promise.reject(new Error('The WMS trip tables did not answer'));
            var sql = list[i++];
            return D.rows(sql, 400).catch(function (e) { tried++; if (i >= list.length) throw e; return next(); });
        }
        next().then(function (rows) { c.deliv = { rows: rows, days: days, note: tried ? 'Some WMS tables were not there (picker / MRA / ship date) — shown without them.' : '' }; }, function (e) { c.deliv = { rows: [], days: days, err: errText(e) }; })
            .then(function () { if (C.cust === c && c.sub === 'delivery') C.render(); });
    }
    C.CH.dvDays = function (el) { loadDeliveries(C.cust, +el.value); C.render(); };
    C.ACT.dvRefresh = function () { loadDeliveries(C.cust); C.render(); };

    // ══ the customer's flags (Needs you), the bell, Today ════════
    function blank() { return { tickets: { n: 0, breached: 0, risk: 0, waiting: 0, ids: [] }, callbacks: { n: 0, late: 0, today: 0, next: '', ids: [] }, missed: { n: 0, last: '', ids: [] }, unreached: { n: 0, last: '', ids: [] }, promises: { n: 0, late: 0, amount: 0, ids: [] }, disputes: { n: 0, ids: [] }, followups: { n: 0, late: 0, ids: [] }, flags: [], score: 0 }; }
    var custFlags = C.custFlags;
    C.custFlags = function () {
        var out = custFlags(), now = new Date(), by = G.byAccount(GR.signals, now);
        Object.keys(by).forEach(function (a) {
            var x = out[a] = out[a] || blank(), list = by[a], v = list.reduce(function (s, r) { return s + (+r.VALUE || 0); }, 0), top = list[0];
            var risk = list.filter(function (r) { return (G.KINDS[r.KIND] || {}).cls !== 'ok'; }).length;
            x.signals = { n: list.length, ids: list.map(function (r) { return r.SIGNAL_KEY; }), value: v, risk: risk };
            x.flags.push({ k: 'signals', n: list.length, cls: risk ? (top && (G.KINDS[top.KIND] || {}).cls === 'bad' ? 'bad' : 'warn') : 'ok', label: list.length + ' signal' + (list.length > 1 ? 's' : '') + ' · ' + top.TITLE + (v ? ' · ' + money(v, 0) + ' a year at stake' : '') });
            x.score += risk * 2 + list.length;
        });
        GR.plays.forEach(function (p) {
            if (p.STATUS !== 'ACTIVE') return;
            var s = G.playState(withSteps(p), now); if (!s.dueNow) return;
            var x = out[p.ACCOUNT_NUMBER] = out[p.ACCOUNT_NUMBER] || blank();
            if (!x.plays) { x.plays = { n: 0, late: 0, ids: [] }; x.flags.push({ k: 'plays', n: 0, cls: 'info', label: '' }); }
            x.plays.n++; x.plays.ids.push(p.PLAY_ID); if (s.late) x.plays.late++;
            var f = x.flags.filter(function (g) { return g.k === 'plays'; })[0];
            f.n = x.plays.n; f.cls = x.plays.late ? 'bad' : 'warn'; f.label = x.plays.n + ' playbook step' + (x.plays.n > 1 ? 's' : '') + ' due' + (x.plays.late ? ' · ' + x.plays.late + ' late' : '');
            x.score += s.late ? 3 : 2;
        });
        return out;
    };
    C.FLAG_IC.signals = 'fa-seedling'; C.FLAG_IC.plays = 'fa-route';
    C.FLAG_WORD.signals = function (f, x) { return (f.n > 1 ? '<b>' + f.n + '</b> ' : '') + (x.signals.risk ? 'Risk' : 'Opportunity'); };
    C.FLAG_WORD.plays = function (f, x) { return (f.n > 1 ? '<b>' + f.n + '</b> ' : '') + 'Playbook' + (x.plays.late ? ' · late' : ' · due'); };
    C.FLAG_TABS.push(['signals', 'Risks & opportunities'], ['plays', 'Playbook steps']);
    C.FLAG_SUB.signals = 'growth'; C.FLAG_SUB.plays = 'growth';
    C.FLAG_BODY.signals = function (x) {
        return C.table([[function (r) { var K = G.KINDS[r.KIND] || {}; return C.pill('<i class="fas ' + K.icon + '"></i> ' + esc(K.label), K.cls); }, ''], [function (r) { return '<b>' + esc(r.TITLE) + '</b><div class="small muted">' + esc(r.DETAIL) + '</div>'; }, 'Signal'], [function (r) { return +r.VALUE ? money(+r.VALUE, 0) : ''; }, 'At stake', 'r'], [function (r) { return sigButtons(r); }, '', 'r']],
            GR.signals.filter(function (r) { return x.ids.indexOf(r.SIGNAL_KEY) >= 0; }));
    };
    C.FLAG_BODY.plays = function (x) { var now = new Date(); return playList(GR.plays.filter(function (p) { return x.ids.indexOf(p.PLAY_ID) >= 0; }).map(withSteps).map(function (p) { p._s = G.playState(p, now); return p; }), 'Nothing due.'); };
    // the bell: my playbook steps due + new high-score signals nobody has taken
    C.bellExtra.push(function () {
        var now = new Date(), out = G.playNotifications(GR.plays.map(withSteps), now, C.me());
        GR.signals.forEach(function (r) {
            if (r.STATUS !== 'NEW' || r.OWNER || (+r.SCORE || 0) < 70) return;
            out.push({ key: 'sg:' + r.SIGNAL_KEY, k: 'signals', sev: (G.KINDS[r.KIND] || {}).cls === 'bad' ? 'bad' : 'warn', at: String(r.FIRST_SEEN || ''), account: r.ACCOUNT_NUMBER, name: r.ACCOUNT_NAME, id: r.SIGNAL_KEY, title: r.TITLE, detail: r.DETAIL + (+r.VALUE ? ' · ' + money(+r.VALUE, 0) + ' a year' : '') });
        });
        return out;
    });
    C.bellGo.plays = function (x) { C.ACT.pbDo({ dataset: { id: x.id } }); };
    C.bellGo.signals = function (x) { GR.f = { kind: '', q: x.account, status: 'live', owner: '' }; GR.view = 'signals'; C.go('growth'); };
    // Today: playbook steps due + the top open risks
    var today = C.views.today;
    C.views.today = function () {
        var html = today(); if (!C.ready || !GR.loaded) return html;
        var now = new Date(), me = C.me().toLowerCase();
        var due = GR.plays.filter(function (p) { return p.STATUS === 'ACTIVE' && (!p.OWNER || String(p.OWNER).toLowerCase() === me); }).map(withSteps).map(function (p) { p._s = G.playState(p, now); return p; }).filter(function (p) { return p._s.dueNow; }).sort(function (a, b) { return String(a._s.due).localeCompare(String(b._s.due)); });
        var top = GR.signals.filter(function (r) { return G.isLive(r, now) && (!r.OWNER || String(r.OWNER).toLowerCase() === me); }).slice(0, 6);
        if (!due.length && !top.length) return html;
        var card = '<div class="cols"><div class="card"><h2><i class="fas fa-route"></i> Playbook steps due <span class="pill ' + (due.length ? 'bad' : 'ok') + '">' + due.length + '</span><span class="sp"></span><a data-act="grView" data-v="plays">all</a></h2>' + playList(due.slice(0, 6), 'Nothing due.') + '</div>' +
            '<div class="card"><h2><i class="fas fa-seedling"></i> Risks & opportunities <span class="pill">' + top.length + '</span><span class="sp"></span><a data-act="grView" data-v="signals">all</a></h2>' + (top.length ? '<div class="feed">' + top.map(function (r) {
                var K = G.KINDS[r.KIND] || {};
                return '<div class="fi click ' + (K.cls === 'bad' ? 'bad' : '') + '" data-act="open360" data-acct="' + esc(r.ACCOUNT_NUMBER) + '" data-bu="' + esc(r.BU_ID || '') + '" data-name="' + esc(r.ACCOUNT_NAME || '') + '" data-sub="growth"><div class="ic"><i class="fas ' + K.icon + '"></i></div><div class="tx"><div class="t">' + esc(r.TITLE) + '</div><div class="s">' + esc(String(r.DETAIL || '').slice(0, 140)) + '</div></div><div class="ac">' + C.pill(r.SCORE + '', +r.SCORE >= 70 ? 'bad' : 'warn') + '</div></div>';
            }).join('') + '</div>' : '<div class="empty">Nothing open for you.</div>') + '</div></div>';
        var i = html.indexOf('<div class="cols">');
        return i < 0 ? html + card : html.slice(0, i) + card + html.slice(i);
    };

    // ══ Insights › Live wallboard ═════════════════════════════════
    var insights = C.views.insights;
    C.views.insights = function () {
        var bar = '<div class="subtabs"><button data-act="insV" data-v="reports" class="' + (GR.ins !== 'wall' ? 'on' : '') + '"><i class="fas fa-chart-column"></i> Reports</button><button data-act="insV" data-v="wall" class="' + (GR.ins === 'wall' ? 'on' : '') + '"><i class="fas fa-display"></i> Live wallboard</button></div>';
        return bar + (GR.ins === 'wall' ? wallboard() : insights());
    };
    C.ACT.insV = function (el) { GR.ins = el.dataset.v; C.lsSet('gr.ins', GR.ins); C.render(); wbTick(); };
    function wallboard() {
        var w = G.wallboard({ now: new Date(), tickets: C.tickets, calls: C.calls, plays: GR.plays.map(withSteps), signals: GR.signals, queues: C.setup.queues || [], isOpen: E.isOpen, sla: function (t, n) { return E.sla(t, n); } });
        var tile = function (l, v, s, cls) { return '<div class="wbt ' + (cls || '') + '"><div class="l">' + esc(l) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s || '') + '</div></div>'; };
        var maxH = Math.max.apply(null, w.calls.byHour.concat([1]));
        return '<div class="wb" id="wb"><div class="row"><b style="font-size:18px"><i class="fas fa-display"></i> Customer service · live</b><span class="sp"></span><span class="small muted">updated ' + esc(w.at.slice(11)) + ' · every 30 s</span><button class="btn sm" data-act="wbFull"><i class="fas fa-expand"></i> Full screen</button></div>' +
            '<div class="wbtiles">' + tile('Open tickets', w.tickets.open, w.tickets.unassigned + ' with nobody', w.tickets.unassigned ? 'warn' : '') + tile('Past the SLA', w.tickets.breached, w.tickets.risk + ' at risk', w.tickets.breached ? 'bad' : 'ok') +
            tile('Calls today', w.calls.all, w.calls.inN + ' in · ' + w.calls.outN + ' out', '') + tile('Answered', w.calls.answerRate == null ? '—' : w.calls.answerRate + ' %', w.calls.missed + ' missed · ' + w.calls.missedOpen + ' not returned', w.calls.missedOpen ? 'bad' : 'ok') +
            tile('Call-backs due', w.callbacks.due, w.callbacks.today + ' today · ' + w.callbacks.planned + ' planned', w.callbacks.due ? 'warn' : 'ok') + tile('Talk time', E.secs(w.calls.talk), w.calls.unreached + ' not reached', '') +
            tile('Playbook steps due', w.plays.due, w.plays.late + ' late · ' + w.plays.active + ' running', w.plays.late ? 'bad' : w.plays.due ? 'warn' : 'ok') + tile('Open signals', w.signals.open, money(w.signals.value, 0) + ' at stake', w.signals.newN ? 'warn' : '') + '</div>' +
            '<div class="cols"><div class="card"><h2>Queues</h2>' + C.table([[function (q) { return '<b>' + esc(q.queue) + '</b>'; }, 'Queue'], ['open', 'Open', 'r'], [function (q) { return q.breached ? '<b class="badc">' + q.breached + '</b>' : '0'; }, 'Past SLA', 'r'], ['risk', 'At risk', 'r'], ['unassigned', 'Nobody', 'r'], [function (q) { return q.oldest ? C.when(q.oldest) : ''; }, 'Oldest']], w.queues) + '</div>' +
            '<div class="card"><h2>Agents today</h2>' + C.table([[function (a) { return C.avatar(a.agent) + ' ' + esc(a.agent); }, 'Agent'], ['open', 'Open', 'r'], [function (a) { return a.breached ? '<b class="badc">' + a.breached + '</b>' : '0'; }, 'Past SLA', 'r'], ['solved', 'Solved today', 'r'], ['calls', 'Calls', 'r'], [function (a) { return E.secs(a.talk); }, 'Talk', 'r']], w.agents, { empty: 'Nobody active today yet.' }) + '</div></div>' +
            '<div class="card"><h2>Calls by hour</h2><div class="spark" style="height:90px">' + w.calls.byHour.map(function (n, h) { return '<span style="height:' + Math.max(2, Math.round(n / maxH * 100)) + '%" title="' + h + ':00 — ' + n + ' calls"></span>'; }).join('') + '</div><div class="row small muted"><span>00:00</span><span class="sp"></span><span>12:00</span><span class="sp"></span><span>23:00</span></div></div></div>';
    }
    C.ACT.wbFull = function () { var el = $('wb'); if (!el) return; if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen().catch(function () { }); };
    var wbT = 0;
    function wbTick() {
        clearTimeout(wbT);
        if (C.tab !== 'insights' || GR.ins !== 'wall') return;
        wbT = setTimeout(function () {
            if (C.tab !== 'insights' || GR.ins !== 'wall') return;
            (document.hidden ? Promise.resolve() : C.loadCore().catch(function () { })).then(function () { if (C.tab === 'insights' && GR.ins === 'wall' && !$('modal').classList.contains('on')) { var fs = document.fullscreenElement && document.fullscreenElement.id === 'wb'; if (!fs) C.render(); else { var box = $('wb'); if (box) box.outerHTML = wallboard(); } } wbTick(); });
        }, 30000);
    }
    var go = C.go;
    C.go = function (tab) { go(tab); if (tab === 'insights') wbTick(); };

    // ══ Tickets › Draft with AI (the AI Hub; a draft from the solved tickets when it is not there) ══
    C.ACT.tkDraft = function (el) {
        var o = C.openTicket, t = o && o.t; if (!t) return;
        var box = $('tk-text'); if (!box) return;
        var conv = (o.events || []).filter(function (e) { return e.KIND === 'CUSTOMER' || e.KIND === 'COMMENT' || e.KIND === 'EMAIL_OUT' || e.KIND === 'NOTE'; }).slice(-8)
            .map(function (e) { return (e.KIND === 'CUSTOMER' ? 'Customer' : e.KIND === 'NOTE' ? 'Internal note' : 'Us') + ' (' + e.EVENT_AT + '): ' + String(e.BODY || '').slice(0, 800); }).join('\n');
        var sim = E.similar(t.SUBJECT + ' ' + t.DESCRIPTION, C.learn.filter(function (x) { return x.RESOLUTION && x.TICKET_ID !== t.TICKET_ID; }), 3);
        var system = 'You draft replies for the customer-service team of a B2B food and beverage distributor in Mauritius. Write ONE short, polite, plain-text e-mail reply (no subject line, no markdown) from the agent to the customer contact. ' +
            'Use only facts in the ticket, the conversation and the internal notes; never invent amounts, dates, stock or promises — where a fact is missing, write [check: …] for the agent to fill in. Internal notes are for you, never quote them. Sign with the agent\'s name.';
        var user = 'Ticket ' + t.TICKET_NO + ' · ' + (t.CATEGORY || '') + (t.SUBCATEGORY ? ' / ' + t.SUBCATEGORY : '') + ' · status ' + E.status(t.STATUS).label + '\nCustomer: ' + (t.ACCOUNT_NAME || '') + ' · contact ' + (t.CONTACT_NAME || 'the customer') +
            '\nSubject: ' + t.SUBJECT + '\nDescription: ' + String(t.DESCRIPTION || '').slice(0, 2000) + (t.ORDER_NUMBER ? '\nOrder: ' + t.ORDER_NUMBER : '') + (t.INVOICE_NUMBER ? '\nInvoice: ' + t.INVOICE_NUMBER : '') +
            (conv ? '\n\nConversation so far:\n' + conv : '') + (sim.length ? '\n\nHow similar tickets were solved:\n' + sim.map(function (x) { return '- ' + x.t.SUBJECT + ': ' + String(x.t.RESOLUTION).slice(0, 400); }).join('\n') : '') +
            (box.value.trim() ? '\n\nThe agent\'s own notes for this reply: ' + box.value.trim() : '') + '\n\nAgent: ' + C.me();
        var btn = el; if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Drafting…'; }
        var fallback = function (why) {
            var c = C.setup.canned.filter(function (x) { return /information|acknowledge/i.test(x.name); })[0] || C.setup.canned[0];
            var txt = E.fill(c ? c.body : 'Dear {CONTACT},\n\nThank you for your message about {SUBJECT}.\n\nKind regards,\n{AGENT}', E.vars({ ticket: t, agent: C.me() }));
            if (sim.length) txt = txt.replace(/\n\nKind regards/, '\n\n[check: as with ' + sim[0].t.TICKET_NO + ' — ' + String(sim[0].t.RESOLUTION).slice(0, 200) + ']\n\nKind regards');
            box.value = txt; C.toast('AI not available (' + why + ') — a draft from the canned replies and a similar solved ticket instead', 'warn', 7000);
        };
        (D.hasHost() ? D.host('hubApi', { method: 'POST', path: '/v1/chat', body: { messages: [{ role: 'user', content: user }], system: system, task: 'default', max_tokens: 700 } }, 120000) : Promise.reject(new Error('no host')))
            .then(function (d) {
                var r = d && (d.result || d); if (!d || d.ok === false || !r || r.ok === false || !r.text) throw new Error((d && d.error) || (r && r.error) || 'no answer');
                box.value = String(r.text).trim(); box.focus();
                C.toast('Draft by ' + (r.model || 'AI') + ' — check every [check: …] before sending', 'ok', 6000);
            }).catch(function (e) { fallback(/no host/.test(errText(e)) ? 'open the CRM in the app' : /not running|refused|connect|install/i.test(errText(e)) ? 'the AI Hub is not running' : errText(e).slice(0, 80)); })
            .then(function () { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Draft with AI'; } });
    };

    // ── start ─────────────────────────────────────────────────────
    C.after.growth = function () { if (!GR.loaded && C.ready) GR.load().then(function () { if (C.tab === 'growth') C.render(); }); };
    /** the scan runs by itself after the CRM started, when the last one is older than the rules say (checked once an hour) */
    function autoScan() { if (C.ready && GR.loaded && GR.st.auto !== false && D.hasHost() && !GR.run && !document.hidden) GR.scan(true); }
    setTimeout(function wait() { if (!C.ready || !GR.loaded) { setTimeout(wait, 5000); return; } if (C.info && C.info.machine) S.machine = C.info.machine; setTimeout(autoScan, 20000); setInterval(autoScan, 3600e3); }, 5000);
})();
