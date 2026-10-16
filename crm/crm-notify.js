/* Customer CRM · the bell and the statement viewer.
 * Bell (header, #bellbtn): every follow-up whose time has passed — CRME.notifications over the calls, tickets and Debtors activities
 * the page already holds: callbacks past their time, missed calls not returned, calls that did not get through, promises to pay
 * past their date, Debtors follow-ups past their date, my tickets past the SLA. Worked out again every minute (a callback becomes
 * due without a refresh) and after every read of APEX; new ones ring the bell and show one toast. What was seen is kept per PC
 * (localStorage crm.bell.seen) so the red count is only what is new. A click opens that customer's list (or the ticket / the number).
 * Statement viewer (C.stmtView): the customer's statements recorded in Debtors Control — each one shown here when its PDF is on
 * this PC — and "Make a statement now": the business unit's statement report as at a date, shown here and NOT recorded or sent
 * (Send it opens the normal statement e-mail, which records it first). PDFs come back through the host action crmPdf. */
(function () {
    'use strict';
    var C = window.CRM, E = C.E, D = C.D, DE = C.DE, esc = C.esc;
    function $(id) { return document.getElementById(id); }

    // ── the bell ──────────────────────────────────────────────────
    var B = C.bell = { items: [], open: false, seen: C.ls('bell.seen', {}) || {}, lastNew: 0 };
    var K_ICON = { callbacks: 'fa-phone-flip', missed: 'fa-phone-slash', unreached: 'fa-user-clock', promises: 'fa-hand-holding-dollar', followups: 'fa-flag', tickets: 'fa-ticket', plays: 'fa-route', signals: 'fa-seedling' };
    var K_NAME = { callbacks: 'Call-backs due', missed: 'Missed calls', unreached: 'Not reached', promises: 'Promises not kept', followups: 'Follow-ups overdue', tickets: 'Tickets past the SLA', plays: 'Playbook steps due', signals: 'New risks & opportunities' };
    /** other scripts add items: C.bellExtra = [function () → [{key, k, sev, at, account, name, id, title, detail}]]; C.bellGo[k] = function (item) opens it */
    C.bellExtra = []; C.bellGo = {};
    function unseen() { return B.items.filter(function (x) { return !B.seen[x.key]; }); }
    B.compute = function (quiet) {
        if (!C.ready) return;
        var before = {}; B.items.forEach(function (x) { before[x.key] = 1; });
        B.items = E.notifications({ calls: C.calls, tickets: C.tickets, acts: C.dcOpen }, new Date(), C.me());
        C.bellExtra.forEach(function (f) { try { B.items = B.items.concat(f() || []); } catch (e) { console.warn('[CRM] bell:', e); } });
        // forget seen keys that are no longer due (so the same callback re-rings if it is moved and comes due again)
        var keys = {}; B.items.forEach(function (x) { keys[x.key] = 1; });
        Object.keys(B.seen).forEach(function (k) { if (!keys[k]) delete B.seen[k]; });
        C.lsSet('bell.seen', B.seen);
        var fresh = B.items.filter(function (x) { return !before[x.key] && !B.seen[x.key]; });
        paintBtn();
        if (B.open) paintPop();
        if (!quiet && fresh.length && B.started) {
            var btn = $('bellbtn'); if (btn) { btn.classList.remove('bell-ring'); void btn.offsetWidth; btn.classList.add('bell-ring'); }
            C.toast(fresh.length === 1 ? '🔔 ' + fresh[0].title + ' — ' + fresh[0].detail : '🔔 ' + fresh.length + ' follow-ups are due — see the bell', fresh.some(function (x) { return x.sev === 'bad'; }) ? 'bad' : 'warn', 7000);
        }
        B.started = true;
    };
    function paintBtn() {
        var n = $('n-bell'), btn = $('bellbtn'); if (!n || !btn) return;
        var u = unseen().length, all = B.items.length;
        n.textContent = u ? (u > 99 ? '99+' : u) : all ? '' : '';
        btn.classList.toggle('has', all > 0);
        btn.classList.toggle('new', u > 0);
        btn.title = all ? all + ' follow-up' + (all > 1 ? 's' : '') + ' due' + (u ? ' · ' + u + ' new' : '') : 'Nothing overdue';
    }
    function paintPop() {
        var p = $('bellpop'); if (!p) return;
        var groups = {}; B.items.forEach(function (x) { (groups[x.k] = groups[x.k] || []).push(x); });
        var order = ['callbacks', 'missed', 'unreached', 'plays', 'promises', 'followups', 'tickets', 'signals'];
        p.innerHTML = '<div class="bh"><b><i class="fas fa-bell"></i> Follow-ups due</b><span class="sp"></span>' + (B.items.length ? '<a data-act="bellSeenAll">mark all as seen</a>' : '') + '<button class="btn sm ghost" data-act="bellToggle"><i class="fas fa-xmark"></i></button></div>' +
            (B.items.length ? order.filter(function (k) { return groups[k]; }).map(function (k) {
                return '<div class="bg"><div class="bgh"><i class="fas ' + K_ICON[k] + '"></i> ' + K_NAME[k] + ' <span class="pill">' + groups[k].length + '</span></div>' + groups[k].map(function (x) {
                    return '<div class="bi ' + x.sev + (B.seen[x.key] ? '' : ' unseen') + '" data-act="bellGo" data-key="' + esc(x.key) + '"><div class="t">' + esc(x.title) + '</div><div class="d">' + esc(x.detail) + '</div>' +
                        (x.num && (x.k === 'missed' || x.k === 'unreached' || x.k === 'callbacks') ? '<button class="btn sm ok" data-act="bellCall" data-key="' + esc(x.key) + '" title="Call ' + esc(x.num) + '"><i class="fas fa-phone"></i></button>' : '') + '</div>';
                }).join('') + '</div>';
            }).join('') : '<div class="empty small">Nothing overdue. Call-backs, missed calls, promises and follow-ups show here when their time has passed.</div>');
    }
    C.ACT.bellToggle = function () {
        B.open = !B.open; var p = $('bellpop'); if (!p) return;
        p.hidden = !B.open;
        if (B.open) { paintPop(); setTimeout(function () { if (!B.open) return; B.items.forEach(function (x) { B.seen[x.key] = Date.now(); }); C.lsSet('bell.seen', B.seen); paintBtn(); }, 1500); }
    };
    C.ACT.bellSeenAll = function () { B.items.forEach(function (x) { B.seen[x.key] = Date.now(); }); C.lsSet('bell.seen', B.seen); paintBtn(); paintPop(); };
    function itemOf(key) { return B.items.filter(function (x) { return x.key === key; })[0]; }
    C.ACT.bellGo = function (el, e) {
        if (e && e.target.closest('[data-act=bellCall]')) return;
        var x = itemOf(el.dataset.key); if (!x) return;
        B.seen[x.key] = Date.now(); C.lsSet('bell.seen', B.seen); C.ACT.bellToggle();
        if (C.bellGo[x.k]) { C.bellGo[x.k](x); return; }
        if (x.k === 'tickets') { C.openTicketById(x.id); return; }
        if (!x.account) { C.cl.f.outcome = x.k === 'missed' ? 'MISSED' : ''; C.go('calls'); return; }
        C.ACT.cuFlag({ dataset: { acct: x.account, bu: C.buOf(x.account) || '', name: x.name, k: x.k } });
    };
    C.ACT.bellCall = function (el) {
        var x = itemOf(el.dataset.key); if (!x) return;
        B.seen[x.key] = Date.now(); C.lsSet('bell.seen', B.seen); C.ACT.bellToggle();
        if (x.k === 'callbacks') C.ACT.callBack({ dataset: { id: x.id } });
        else C.ACT.dialNum({ dataset: { num: x.num || '', acct: x.account || '' } });
    };
    document.addEventListener('click', function (e) { if (B.open && !e.target.closest('#bellpop') && !e.target.closest('#bellbtn')) { B.open = false; var p = $('bellpop'); if (p) p.hidden = true; } });
    // after every read of APEX, and once a minute for call-backs that come due on their own
    var loadCore = C.loadCore;
    C.loadCore = function () { return loadCore.apply(this, arguments).then(function (r) { B.compute(); return r; }); };
    setInterval(function () { B.compute(); }, 60000);

    // ── the statement viewer ──────────────────────────────────────
    var V = C.stmtv = {};
    C.stmtView = function (bu, account, name) {
        account = String(account || '').trim(); if (!account) return;
        bu = bu || C.buOf(account) || '';
        var b = C.bu(bu) || C.curBu() || {};
        V.cur = { bu: b.id || bu, account: account, name: name || (C.master[account] || {}).CUSTOMER || '', list: null };
        var box = C.modal('<i class="fas fa-file-invoice"></i> Statement · ' + esc(V.cur.name || account) + ' <span class="small muted">&nbsp;' + esc(account) + '</span>', '<div id="sv-body"><span class="spin"></span> Reading the statements of this customer…</div>',
            '<span class="small muted">Statements are recorded in Debtors Control. Making one here only shows it — nothing is recorded or sent.</span><span class="sp"></span><button class="btn" data-act="mclose">Close</button>', true);
        box.dataset.stmtv = account;
        var held = C.cust && C.cust.account === account && C.cust.a ? Promise.resolve(C.cust.a.stmts) : D.stmt.search({ account: account, limit: 30 });
        held.then(function (l) { V.cur.list = (l || []).filter(function (s) { return !b.id || !s.BU_ID || s.BU_ID === b.id; }); paint(); }, function (e) { V.cur.list = []; V.cur.err = C.errText(e); paint(); });
    };
    function paint() {
        var c = V.cur, el = $('sv-body'); if (!c || !el) return;
        var b = C.bu(c.bu) || {}, can = !!(b.statement && b.statement.path);
        var make = '<div class="card" style="margin:0 0 12px"><div class="row"><b><i class="fas fa-wand-magic-sparkles"></i> Make a statement now</b><span class="small muted">' + (can ? 'from ' + esc(b.statement.path) : 'the business unit has no statement report — Debtors Control › Setup') + '</span><span class="sp"></span>' +
            '<label class="small">as at <input type="date" id="sv-date" value="' + esc(c.date || E.iso(new Date())) + '"></label><button class="btn sm" data-act="svDate" data-d="' + esc(DE.lastMonthEnd()) + '">last month end</button><button class="btn sm" data-act="svDate" data-d="' + esc(E.iso(new Date())) + '">today</button>' +
            '<button class="btn pri" data-act="svMake"' + (can && D.hasHost() ? '' : ' disabled') + '><i class="fas fa-eye"></i> View</button></div></div>';
        var list = c.list == null ? '<div class="small muted"><span class="spin"></span> reading…</div>' : !c.list.length ? '<div class="empty small">' + (c.err ? esc(c.err) : 'No statement recorded for this customer yet.') + '</div>' :
            C.table([
                [function (s) { return '<b>' + esc(s.STMT_DATE || '') + '</b>'; }, 'As at'],
                [function (s) { return s.BALANCE != null && s.BALANCE !== '' ? C.money(+s.BALANCE) + ' <span class="small muted">' + esc(s.CURRENCY || '') + '</span>' : ''; }, 'Balance', 'r'],
                [function (s) { return s.OVERDUE != null && s.OVERDUE !== '' ? C.money(+s.OVERDUE) : ''; }, 'Overdue', 'r'],
                [function (s) { var st = DE.stmtState ? DE.stmtState(s) : { label: s.STATUS }; return C.pill(esc(st.label || s.STATUS || ''), /FAIL|BOUNCE/.test(s.STATUS || '') ? 'bad' : s.STATUS === 'SENT' ? 'ok' : 'info'); }, 'Status'],
                [function (s) { return '<span class="small">' + esc(s.EMAIL_TO || s.DELIVERY || '') + '</span>'; }, 'To'],
                [function (s) { return s.FILE_PATH ? '<button class="btn sm pri" data-act="svShow" data-path="' + esc(s.FILE_PATH) + '" data-sha="' + esc(s.SHA256 || '') + '" data-title="' + esc('Statement as at ' + s.STMT_DATE) + '"><i class="fas fa-eye"></i> View</button>' : '<span class="small muted">no PDF</span>'; }, '', 'r']
            ], c.list);
        el.innerHTML = make + '<h3 style="margin:4px 0 8px">Statements recorded</h3>' + list;
    }
    C.ACT.svDate = function (el) { var i = $('sv-date'); if (i) i.value = el.dataset.d; };
    C.ACT.svShow = function (el) {
        var end = C.busy('Opening the statement…');
        D.call('crmPdf', { path: el.dataset.path }, 60000).then(function (r) {
            end(); if (!r || !r.ok) { C.toast((r && r.error) || 'The PDF could not be read', 'bad', 8000); return; }
            if (el.dataset.sha && r.sha256 && el.dataset.sha.toLowerCase() !== String(r.sha256).toLowerCase()) C.toast('Careful: the PDF on this PC is not the one recorded (its fingerprint differs)', 'warn', 9000);
            V.show(r.base64, el.dataset.title || r.name, r.name, el.dataset.path);
        }, function (e) { end(); C.toast(C.errText(e), 'bad', 8000); });
    };
    C.ACT.svMake = function () {
        var c = V.cur, b = C.bu(c.bu) || {}, date = ($('sv-date') || {}).value || E.iso(new Date()); if (!b.statement) return;
        c.date = date;
        var vars = DE.vars(b, date, { account: c.account, name: c.name, currency: b.currency });
        var end = C.busy('Running the statement report…');
        D.call('dcStatementPdf', { instance: C.pod, path: b.statement.path, params: DE.fillParams(b.statement.params, vars), bu: b.name || b.id, stmtDate: date, fileName: 'VIEW ' + c.account + ' ' + String(c.name || '').slice(0, 50) + ' ' + Date.now().toString(36).slice(-5) }, 300000)
            .then(function (pdf) { if (!pdf || pdf.ok === false) throw new Error((pdf && pdf.error) || 'No PDF'); return D.call('crmPdf', { path: pdf.path }, 60000).then(function (r) { if (!r || !r.ok) throw new Error((r && r.error) || 'The PDF could not be read'); return [pdf, r]; }); })
            .then(function (x) { end(); V.show(x[1].base64, 'Statement as at ' + date + ' · not recorded', x[1].name, x[0].path, { send: true }); }, function (e) { end(); C.toast('The statement could not be made: ' + C.errText(e), 'bad', 9000); });
    };
    /** a PDF over the page: Chromium's viewer on a blob, Save (host saveFileAs), Open in the PDF app, Send it */
    V.show = function (b64, title, name, path, o) {
        o = o || {};
        V.close();
        var bin = atob(b64), bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        V.url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); V.b64 = b64; V.name = name || 'statement.pdf'; V.path = path;
        var d = document.createElement('div'); d.id = 'svpdf'; d.className = 'svpdf';
        d.innerHTML = '<div class="svbar"><i class="fas fa-file-pdf"></i> <b>' + esc(title || name) + '</b><span class="small">' + esc(V.name) + ' · ' + Math.round(bytes.length / 1024) + ' KB</span><span class="sp"></span>' +
            (o.send ? '<button class="btn sm ok" data-act="svSend"><i class="fas fa-paper-plane"></i> Send it…</button>' : '') +
            '<button class="btn sm" data-act="svSave"><i class="fas fa-download"></i> Save</button><button class="btn sm" data-act="svOpen"><i class="fas fa-up-right-from-square"></i> Open in the PDF app</button><button class="btn sm ghost" data-act="svClose" title="Close (Esc)"><i class="fas fa-xmark"></i> Close</button></div>' +
            '<iframe title="statement" src="' + V.url + '"></iframe>';
        document.body.appendChild(d);
    };
    V.close = function () { var d = $('svpdf'); if (d) d.remove(); if (V.url) { URL.revokeObjectURL(V.url); V.url = null; } };
    C.ACT.svClose = function () { V.close(); };
    C.ACT.svSave = function () { D.call('saveFileAs', { fileName: V.name, base64: V.b64, filter: 'PDF|*.pdf', title: 'Save the statement' }, 300000).then(function (r) { if (r && r.ok) C.toast('Saved · ' + r.path, 'ok'); }, function (e) { C.toast(C.errText(e), 'bad'); }); };
    C.ACT.svOpen = function () { if (V.path) D.call('dcOpenFile', { path: V.path }).catch(function (e) { C.toast(C.errText(e), 'bad', 6000); }); };
    C.ACT.svSend = function () { var c = V.cur; V.close(); C.mclose(); if (C.mail && C.mail.statement) C.mail.statement({ bu: c.bu, account: c.account, name: c.name, stmtDate: c.date }); };
    C.ACT.stmtView = function (el) { C.stmtView(el.dataset.bu, el.dataset.acct, el.dataset.name); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('svpdf')) { e.stopPropagation(); V.close(); } }, true);
})();
