/* Customer CRM · Setup: categories + queues, agents, SLA + business hours, routing rules, canned replies, the phone (adapter,
 * the call listener for the softphone, recording), learning (ML.NET classifiers on the host + the naive-Bayes fallback),
 * the customer page (raise / follow a ticket) and every database object. Saved in WMS_CRM_SETTINGS (shared by every PC). */
(function () {
    'use strict';
    var C = window.CRM, E = C.E, S = C.S, D = C.D, esc = C.esc;
    function $(id) { return document.getElementById(id); }
    var U = { sec: C.ls('setup.sec', 'general'), objs: null, ml: null, portalKey: null };
    var SECS = [['general', 'fa-sliders', 'General'], ['cats', 'fa-tags', 'Categories & queues'], ['sla', 'fa-stopwatch', 'Agents, SLA & hours'], ['rules', 'fa-route', 'Routing & replies'], ['phone', 'fa-phone', 'Phone'], ['learn', 'fa-brain', 'Learning'], ['portal', 'fa-globe', 'Customer page'], ['db', 'fa-database', 'Database']];

    C.views.setup = function () {
        var s = C.setup;
        var nav = '<div class="setupnav">' + SECS.map(function (x) { return '<button class="btn ' + (U.sec === x[0] ? 'pri' : '') + '" data-act="suSec" data-s="' + x[0] + '"><i class="fas ' + x[1] + '"></i> ' + x[2] + '</button>'; }).join('') + '</div>';
        var body = (V[U.sec] || V.general)(s);
        var save = ['general', 'cats', 'sla', 'rules', 'phone', 'portal'].indexOf(U.sec) >= 0 ? '<div class="runbar"><span class="muted small">Shared by every PC (APEX WMS_CRM_SETTINGS).</span><span class="sp"></span><button class="btn pri" data-act="suSave"><i class="fas fa-floppy-disk"></i> Save setup</button></div>' : '';
        return nav + '<div class="card">' + body + save + '</div>';
    };
    C.ACT.suSec = function (el) { if (['general', 'cats', 'sla', 'rules', 'phone', 'portal'].indexOf(U.sec) >= 0) read(); U.sec = el.dataset.s; C.lsSet('setup.sec', U.sec); C.render(); if (U.sec === 'db' && !U.objs) C.ACT.suObjs(); if (U.sec === 'learn' && !U.ml) mlStatus(); if (U.sec === 'portal' && U.portalKey == null) loadKey(); };
    var V = {};

    V.general = function (s) {
        return '<h2>General</h2><div class="form"><div class="field"><label>Ticket number prefix</label><input type="text" id="su-prefix" value="' + esc(s.prefix) + '" maxlength="8"></div>' +
            '<div class="field wide"><label>E-mail signature (added under every reply)</label><textarea id="su-sig" rows="4">' + esc(s.signature || '') + '</textarea></div></div>' +
            '<h3>E-mail</h3><div class="small muted">E-mails go out with the mail setup of this PC — the same as Finance Lens and Debtors Control (Outlook, Microsoft 365 or SMTP). ' + esc(C.mail.info().label) + ' from ' + esc(C.mail.info().mailbox || '…') + (C.mail.info().ready ? ' ✓' : ' — not ready') + '. Change it in Finance Lens › E-mail setup or Debtors Control › Setup.</div>' +
            '<h3>Statements</h3><div class="small muted">Business units, the statement report and the statement e-mail come from Debtors Control › Setup (' + C.bus.length + ' business units).</div>';
    };
    V.cats = function (s) {
        return '<h2>Categories</h2><p class="small muted">One per line: <code>Category | sub-category, sub-category | Queue</code></p><textarea class="code" id="su-cats" rows="12">' + esc(s.categories.map(function (c) { return c.name + ' | ' + (c.subs || []).join(', ') + ' | ' + (c.queue || ''); }).join('\n')) + '</textarea>' +
            '<h2 style="margin-top:14px">Queues</h2><input type="text" id="su-queues" value="' + esc((s.queues || []).join(', ')) + '" style="width:100%">';
    };
    V.sla = function (s) {
        var h = s.hours, days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return '<h2>Agents</h2><p class="small muted">One per line: <code>login | queue, queue</code> (no queues = every queue; start the line with # to pause the agent). New tickets go to the least busy agent of their queue.</p>' +
            '<textarea class="code" id="su-agents" rows="6">' + esc((s.agents || []).map(function (a) { return (a.active === false ? '#' : '') + a.user + ' | ' + (a.queues || []).join(', '); }).join('\n')) + '</textarea>' +
            '<h2 style="margin-top:14px">SLA per priority (working hours)</h2><table class="tbl" style="max-width:520px"><thead><tr><th>Priority</th><th>First reply within</th><th>Resolved within</th></tr></thead><tbody>' +
            E.PRIORITIES.map(function (p) { var x = E.priority(p.key, s.sla); return '<tr><td>' + C.pill(esc(p.label), p.cls) + '</td><td><input type="number" min="0.25" step="0.25" id="su-f-' + p.key + '" value="' + x.first + '" style="width:90px"> h</td><td><input type="number" min="1" step="1" id="su-r-' + p.key + '" value="' + x.resolve + '" style="width:90px"> h</td></tr>'; }).join('') + '</tbody></table>' +
            '<h2 style="margin-top:14px">Business hours</h2><div class="row">' + days.map(function (d, i) { return '<label class="chk"><input type="checkbox" id="su-d' + i + '"' + (h.days.indexOf(i) >= 0 ? ' checked' : '') + '> ' + d + '</label>'; }).join('') + '</div>' +
            '<div class="form" style="margin-top:8px"><div class="field"><label>Opens</label><input type="text" id="su-start" value="' + esc(h.start) + '"></div><div class="field"><label>Closes</label><input type="text" id="su-end" value="' + esc(h.end) + '"></div><div class="field"><label>Saturday closes</label><input type="text" id="su-sat" value="' + esc(h.saturdayEnd || '') + '"></div>' +
            '<div class="field wide"><label>Public holidays (YYYY-MM-DD, one per line) — the SLA clock stops</label><textarea class="code" id="su-hol" rows="4">' + esc((h.holidays || []).join('\n')) + '</textarea></div></div>';
    };
    V.rules = function (s) {
        var opt = function (list, cur, blank) { return '<option value="">' + blank + '</option>' + list.map(function (x) { var v = typeof x === 'string' ? x : x[0]; return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(typeof x === 'string' ? x : x[1]) + '</option>'; }).join(''); };
        return '<h2>Routing rules <span class="small muted">— in order; a rule can raise the priority, pick the queue or an owner</span></h2><div class="lines" id="su-rules">' + (s.rules || []).map(function (r, i) {
            var w = r.when || {}, x = r.set || {};
            return '<div class="ln" style="grid-template-columns:2fr 1fr 1fr 24px 1fr 1fr 1fr 32px"><input type="text" data-r="words" data-i="' + i + '" value="' + esc(w.words || '') + '" placeholder="words in the text (comma)">' +
                '<select data-r="category" data-i="' + i + '">' + opt(s.categories.map(function (c) { return c.name; }), w.category, 'any category') + '</select><select data-r="channel" data-i="' + i + '">' + opt(Object.keys(E.CHANNELS).map(function (k) { return [k, E.CHANNELS[k]]; }), w.channel, 'any channel') + '</select><span>→</span>' +
                '<select data-r="queue" data-i="' + i + '">' + opt(s.queues, x.queue, 'same queue') + '</select><select data-r="priority" data-i="' + i + '">' + opt(E.PRIORITIES.map(function (p) { return [p.key, p.label]; }), x.priority, 'same priority') + '</select>' +
                '<input type="text" data-r="assignee" data-i="' + i + '" value="' + esc(x.assignee || '') + '" placeholder="owner"><button class="btn sm ghost" data-act="suRuleRm" data-i="' + i + '"><i class="fas fa-xmark"></i></button></div>';
        }).join('') + '</div><button class="btn sm" data-act="suRuleAdd" style="margin-top:8px"><i class="fas fa-plus"></i> Add a rule</button>' +
            '<h2 style="margin-top:16px">Canned replies <span class="small muted">— {CONTACT} {CUSTOMER} {TICKET_NO} {SUBJECT} {STATUS} {RESOLUTION} {AGENT} {LINK}</span></h2><div class="lines" id="su-canned">' + (s.canned || []).map(function (c, i) {
                return '<div class="ln" style="grid-template-columns:200px 1fr 32px"><input type="text" data-c="name" data-i="' + i + '" value="' + esc(c.name) + '"><textarea data-c="body" data-i="' + i + '" rows="3">' + esc(c.body) + '</textarea><button class="btn sm ghost" data-act="suCanRm" data-i="' + i + '"><i class="fas fa-xmark"></i></button></div>';
            }).join('') + '</div><button class="btn sm" data-act="suCanAdd" style="margin-top:8px"><i class="fas fa-plus"></i> Add a reply</button>';
    };
    V.phone = function (s) {
        var p = s.phone, cti = C.phone.cti;
        var url = 'http://127.0.0.1:' + (p.ctiPort || 8765) + '/call?event=ring&from=%NUMBER%&key=' + (p.ctiKey || '<key>');
        return '<h2>Phone</h2><div class="form"><div class="field"><label>Country code (numbers without one)</label><input type="text" id="su-cc" value="' + esc(p.country) + '"></div>' +
            '<div class="field"><label>How calls are placed</label><select id="su-adapter">' + Object.keys(C.phone.adapters).map(function (k) { return '<option value="' + k + '"' + (k === p.adapter ? ' selected' : '') + '>' + esc(C.phone.adapters[k].label) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>Link type for the softphone</label><select id="su-scheme">' + ['tel', 'sip', 'callto'].map(function (k) { return '<option' + (k === (p.scheme || 'tel') ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></div>' +
            '<div class="field wide"><label class="chk"><input type="checkbox" id="su-rec"' + (p.record ? ' checked' : '') + '> record every answered call (this PC\'s microphone; saved in C:\\fusion\\crm\\recordings with its fingerprint)</label></div>' +
            '<div class="field wide"><label>What to tell the customer when recording</label><input type="text" id="su-consent" value="' + esc(p.consent || '') + '"></div></div>' +
            '<h2 style="margin-top:14px">Call listener (incoming calls pop up)</h2><div class="form"><div class="field"><label class="chk"><input type="checkbox" id="su-listen"' + (p.listen ? ' checked' : '') + '> listen on this PC</label></div><div class="field"><label>Port (127.0.0.1 only)</label><input type="number" id="su-port" value="' + esc(p.ctiPort || 8765) + '"></div>' +
            '<div class="field"><label>Key</label><div class="row"><input type="text" id="su-key" value="' + esc(p.ctiKey || '') + '" style="flex:1"><button class="btn sm" data-act="suKey">New</button></div></div></div>' +
            '<div class="note" style="margin-top:10px">' + (cti && cti.running ? '<b>Listening</b> on 127.0.0.1:' + cti.port + ' · ' + cti.hits + ' events received.' : 'Not listening on this PC.') + ' Tell the softphone to open this address when a call rings (MicroSIP: <i>cmdCallRing</i> with curl; Zoiper: <i>Run on incoming call</i>; 3CX / Teams connectors: a call-event URL):<div class="row" style="margin-top:6px"><input type="text" readonly value="' + esc(url) + '" style="flex:1" class="mono"><button class="btn sm" data-act="copy" data-text="' + esc(url) + '"><i class="fas fa-copy"></i></button></div>' +
            '<div class="small" style="margin-top:6px">event = ring · answer · hangup · missed · dial (an outgoing call from the softphone, number in <code>to</code>); id = the softphone\'s call id; name = the caller\'s name.</div></div>' +
            '<div class="row" style="margin-top:10px"><input type="text" id="su-testnum" placeholder="a number to test, e.g. 5712 3456"><button class="btn" data-act="suTestCall"><i class="fas fa-phone-volume"></i> Simulate an incoming call</button></div>';
    };
    V.learn = function () {
        var m = U.ml, list = (m && m.models) || [];
        var by = {}; list.forEach(function (x) { by[x.model] = x; });
        var rows = C.learn.length;
        return '<h2>Learning from your tickets</h2><p class="small muted">The CRM suggests a category and a priority for every new ticket and shows similar resolved tickets. On this PC it uses <b>ML.NET</b> models (SDCA maximum-entropy on the ticket text) once trained; until then a naive-Bayes model built in the page from the same tickets. ' + rows + ' categorised tickets are available to learn from.</p>' +
            '<table class="tbl" style="max-width:820px"><thead><tr><th>Model</th><th>Trained</th><th>Tickets</th><th>Labels</th><th>Accuracy (held-out 20 %)</th><th></th></tr></thead><tbody>' + ['category', 'priority'].map(function (k) {
                var x = by[k];
                return '<tr><td><b>' + k + '</b></td><td>' + esc(x ? x.trainedAt : 'not yet') + '</td><td>' + (x ? x.rows : '') + '</td><td class="cut" title="' + esc(x ? (x.labels || []).join(', ') : '') + '">' + esc(x ? (x.labels || []).join(', ') : '') + '</td><td>' + (x && x.accuracy != null ? Math.round(x.accuracy * 100) + '% (' + x.testRows + ' tickets)' : x ? 'needs 40+ tickets to measure' : '') + '</td>' +
                    '<td><button class="btn sm pri" data-act="suTrain" data-m="' + k + '"' + (rows >= 10 ? '' : ' disabled') + '>Train</button></td></tr>';
            }).join('') + '</tbody></table>' + (U.mlMsg ? '<div class="note" style="margin-top:8px">' + esc(U.mlMsg) + '</div>' : '') +
            '<h3>Try it</h3><div class="row"><input type="text" id="su-try" placeholder="e.g. the truck did not come and the shop is out of stock" style="flex:1"><button class="btn" data-act="suTry">Suggest</button></div><div id="su-tryout" class="ai" style="margin-top:8px">—</div>';
    };
    V.portal = function (s) {
        var url = U.portalKey ? S.portalUrl(U.portalKey) : '';
        return '<h2>The customer page</h2><p class="small muted">Customers raise a ticket on a page of your APEX (no login; the key in the address keeps strangers out — change it to stop old links). They get a reference number and a link to follow the ticket, reply to it and rate it when it is resolved. New tickets arrive as <i>New</i> with channel <i>Customer portal</i>; the CRM gives them their SLA, queue and owner.</p>' +
            '<div class="form"><div class="field wide"><label>Link to give customers (website, e-mail signature, invoices)</label><div class="row"><input type="text" readonly value="' + esc(url || (U.portalKey === null ? 'reading…' : 'no key yet — press New key')) + '" style="flex:1" class="mono">' + (url ? '<button class="btn sm" data-act="copy" data-text="' + esc(url) + '"><i class="fas fa-copy"></i></button>' : '') + '<button class="btn sm" data-act="suPortalKey">New key</button></div></div>' +
            '<div class="field wide"><label>Categories the customer can choose (one per line; empty = none asked)</label><textarea class="code" id="su-pcats" rows="5">' + esc((s.portalCategories || s.categories.map(function (c) { return c.name; })).join('\n')) + '</textarea></div></div>' +
            '<div class="small muted">Needs the procedures WMS_CRM_PORTAL / WMS_CRM_TK and their ORDS endpoints — Setup › Database.</div>';
    };
    V.db = function () {
        var o = U.objs;
        return '<h2>Database objects <span class="sp"></span><button class="btn sm" data-act="suObjs"><i class="fas fa-rotate"></i> Check</button><button class="btn sm pri" data-act="suCreate"' + (o && o.some(function (x) { return !x.ok; }) ? '' : ' disabled') + '>Create missing</button><button class="btn sm" data-act="suCreate" data-force="1">Re-create procedures + endpoints</button></h2>' +
            (!o ? '<div class="empty"><span class="spin"></span> checking…</div>' : '<table class="tbl objs"><thead><tr><th>Kind</th><th>Name</th><th>State</th><th></th></tr></thead><tbody>' + o.map(function (x, i) {
                return '<tr><td>' + esc(x.kind) + '</td><td><b>' + esc(x.name) + '</b>' + (x.help ? '<div class="small muted">' + esc(x.help) + '</div>' : '') + '</td><td class="st">' + (x.state === 'running' ? '<span class="spin"></span>' : C.pill(esc(x.detail || ''), x.ok ? 'ok' : x.ok === null ? 'muted' : 'bad')) + '</td><td class="r"><button class="btn sm" data-act="suRun" data-i="' + i + '">Run</button> <button class="btn sm ghost" data-act="suSql" data-i="' + i + '">SQL</button></td></tr>';
            }).join('') + '</tbody></table>') + '<p class="small muted">The same DDL is in <code>apex_sql/100_crm.sql</code>. Statements, cards and the Debtors timeline use the Debtors Control tables.</p>';
    };

    // ── reading the form back ──
    function read() {
        var s = C.setup, v = function (id) { var x = $(id); return x ? x.value : null; }, c = function (id) { var x = $(id); return x ? x.checked : null; };
        if (U.sec === 'general') { s.prefix = (v('su-prefix') || 'CS-').replace(/[^A-Za-z0-9-]/g, '').slice(0, 8) || 'CS-'; s.signature = v('su-sig') || ''; }
        if (U.sec === 'cats') {
            s.categories = String(v('su-cats') || '').split(/\n/).map(function (l) { var p = l.split('|'); return { name: (p[0] || '').trim(), subs: String(p[1] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean), queue: (p[2] || '').trim() }; }).filter(function (x) { return x.name; });
            s.queues = String(v('su-queues') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
            s.categories.forEach(function (x) { if (x.queue && s.queues.indexOf(x.queue) < 0) s.queues.push(x.queue); });
        }
        if (U.sec === 'sla') {
            s.agents = String(v('su-agents') || '').split(/\n/).map(function (l) { var off = /^\s*#/.test(l), p = l.replace(/^\s*#/, '').split('|'); return { user: (p[0] || '').trim(), queues: String(p[1] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean), active: !off }; }).filter(function (a) { return a.user; });
            E.PRIORITIES.forEach(function (p) { s.sla[p.key] = { first: +v('su-f-' + p.key) || p.first, resolve: +v('su-r-' + p.key) || p.resolve }; });
            var days = []; for (var i = 0; i < 7; i++) if (c('su-d' + i)) days.push(i);
            s.hours = { days: days, start: v('su-start') || '08:00', end: v('su-end') || '17:00', saturdayEnd: v('su-sat') || '', holidays: String(v('su-hol') || '').split(/\s+/).filter(function (x) { return /^\d{4}-\d{2}-\d{2}$/.test(x); }) };
        }
        if (U.sec === 'rules') {
            var rules = (s.rules || []).map(function () { return { when: {}, set: {} }; });
            document.querySelectorAll('[data-r]').forEach(function (el) { var r = rules[+el.dataset.i], k = el.dataset.r, val = el.value.trim(); if (!r || !val) return; if (['words', 'category', 'channel'].indexOf(k) >= 0) r.when[k] = val; else r.set[k] = val; });
            s.rules = rules.filter(function (r) { return Object.keys(r.when).length || Object.keys(r.set).length; });
            var canned = (s.canned || []).map(function () { return {}; });
            document.querySelectorAll('[data-c]').forEach(function (el) { var x = canned[+el.dataset.i]; if (x) x[el.dataset.c] = el.value; });
            s.canned = canned.filter(function (x) { return x.name && x.body; });
        }
        if (U.sec === 'phone') s.phone = Object.assign(s.phone, { country: (v('su-cc') || '230').replace(/\D/g, ''), adapter: v('su-adapter'), scheme: v('su-scheme'), record: c('su-rec'), consent: v('su-consent'), listen: c('su-listen'), ctiPort: +v('su-port') || 8765, ctiKey: (v('su-key') || '').trim() });
        if (U.sec === 'portal') s.portalCategories = String(v('su-pcats') || '').split(/\n/).map(function (x) { return x.trim().replace(/\|/g, ''); }).filter(Boolean);
    }
    C.ACT.suSave = function () {
        read();
        var s = C.setup;
        if (s.phone.listen && s.phone.ctiKey.length < 8) { C.toast('The listener key needs 8+ characters — press New', 'warn'); return; }
        var end = C.busy('Saving…');
        S.settings.save('SETUP', s).then(function () { return S.settings.save('PREFIX', s.prefix); })
            .then(function () { return S.settings.save('PORTAL_CATEGORIES', (s.portalCategories || []).length ? '|' + s.portalCategories.join('|') + '|' : ''); })
            .then(function () { end(); C.toast('Setup saved', 'ok'); if (s.phone.listen) C.phone.ctiStart(); else if (C.phone.cti) C.phone.ctiStop(); C.render(); }, function (e) { end(); C.toast(C.errText(e), 'bad', 8000); });
    };
    C.ACT.suKey = function () { $('su-key').value = E.token().slice(0, 20); };
    C.ACT.suRuleAdd = function () { read(); C.setup.rules.push({ when: {}, set: {} }); C.render(); };
    C.ACT.suRuleRm = function (el) { read(); C.setup.rules.splice(+el.dataset.i, 1); C.render(); };
    C.ACT.suCanAdd = function () { read(); C.setup.canned.push({ name: 'New reply', body: 'Dear {CONTACT},\n\n\n\nKind regards,\n{AGENT}' }); C.render(); };
    C.ACT.suCanRm = function (el) { read(); C.setup.canned.splice(+el.dataset.i, 1); C.render(); };
    C.ACT.suTestCall = function () { var n = ($('su-testnum').value || '').trim() || '5712 3456'; C.phone.test(n); };

    // learning
    function mlStatus() { if (!D.hasHost()) { U.ml = { models: [] }; return; } D.host('crmMlStatus', {}, 20000).then(function (r) { U.ml = r; if (C.tab === 'setup') C.render(); }, function () { U.ml = { models: [] }; }); }
    C.ACT.suTrain = function (el) {
        var k = el.dataset.m, rows = C.learn.map(function (t) { return { text: (t.SUBJECT || '') + ' ' + (t.DESCRIPTION || '') + ' ' + (t.SUBCATEGORY || ''), label: k === 'category' ? t.CATEGORY : t.PRIORITY }; }).filter(function (r) { return r.label; });
        var end = C.busy('Training the ' + k + ' model with ML.NET…');
        D.call('crmMlTrain', { model: k, rows: rows }, 600000).then(function (r) { end(); U.mlMsg = 'Trained ' + k + ' on ' + r.rows + ' tickets, ' + r.labels.length + ' labels' + (r.accuracy != null ? ', accuracy ' + Math.round(r.accuracy * 100) + '% on ' + r.testRows + ' held-out tickets' : '') + '.'; mlStatus(); },
            function (e) { end(); U.mlMsg = C.errText(e); C.render(); });
    };
    C.ACT.suTry = function () {
        var t = $('su-try').value; if (!t) return;
        var nb = C.model ? E.nbPredict(C.model.category, t).slice(0, 3) : [];
        C.suggest(t).then(function (s) {
            $('su-tryout').innerHTML = (s ? '<b>' + esc(s.engine) + ':</b> ' + esc(s.category || '—') + (s.catP ? ' ' + Math.round(s.catP * 100) + '%' : '') + ' · priority ' + esc(s.priority || '—') : 'No suggestion.') +
                (nb.length ? '<br><b>naive Bayes:</b> ' + nb.map(function (x) { return esc(x.label) + ' ' + Math.round(x.p * 100) + '%'; }).join(', ') : '') +
                '<br><b>similar:</b> ' + (E.similar(t, C.learn, 3).map(function (x) { return esc(x.t.TICKET_NO + ' ' + x.t.SUBJECT); }).join(' · ') || '—');
        });
    };

    // customer page key
    function loadKey() { S.settings.get('PORTAL_KEY').then(function (k) { U.portalKey = k || ''; if (C.tab === 'setup') C.render(); }, function () { U.portalKey = ''; C.render(); }); }
    C.ACT.suPortalKey = function () {
        if (U.portalKey && !window.confirm('A new key stops every link given out before. Go on?')) return;
        var k = E.token().slice(0, 24);
        S.settings.save('PORTAL_KEY', k).then(function () { U.portalKey = k; C.toast('New customer link ready', 'ok'); C.render(); }, function (e) { C.toast(C.errText(e), 'bad'); });
    };

    // database
    C.ACT.suObjs = function () { U.objs = null; C.render(); S.objects.status().then(function (o) { U.objs = o; if (C.tab === 'setup') C.render(); }, function (e) { C.toast(C.errText(e), 'bad', 8000); U.objs = []; C.render(); }); };
    C.ACT.suCreate = function (el) {
        var force = !!el.dataset.force, list = force ? U.objs.filter(function (o) { return o.kind === 'PROCEDURE' || o.kind === 'ORDS'; }) : U.objs;
        S.objects.create(list, force, function () { C.render(); }).then(function () { C.toast('Done', 'ok'); C.ACT.suObjs(); });
    };
    C.ACT.suRun = function (el) { var o = U.objs[+el.dataset.i]; S.objects.create([o], true, function () { C.render(); }).then(function () { C.render(); }); };
    C.ACT.suSql = function (el) { var o = U.objs[+el.dataset.i]; C.modal('<i class="fas fa-code"></i> ' + esc(o.name), '<textarea class="code" rows="20" readonly>' + esc(o.sql) + '</textarea>', '<button class="btn" data-act="mclose">Close</button>', true); };
})();
