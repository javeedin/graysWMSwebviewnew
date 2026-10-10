/* Customer CRM · e-mail: compose (contacts, canned replies, files from this PC, the last statement PDF, a fresh statement),
 * statements (the Debtors Control path — PDF from the business unit's report, recorded in WMS_DC_STMTS BEFORE it is sent, tracked:
 * opened / agree / query), ticket replies by e-mail, and the E-mails tab. Mail goes through the host (crmSend → the Finance Lens
 * mail setup: Outlook / Microsoft 365 / SMTP); every message is a WMS_CRM_MESSAGES row with its attachments' fingerprints. */
(function () {
    'use strict';
    var C = window.CRM, E = C.E, S = C.S, D = C.D, DE = C.DE, esc = C.esc;
    function $(id) { return document.getElementById(id); }
    var M = C.mail = { st: null };

    M.status = function () { return D.host('finMailStatus', {}, 60000).then(function (r) { M.st = r; return r; }, function () { M.st = null; }); };
    M.info = function () {
        var r = M.st || {}, s = r.settings || {}, m = s.Method || 'OUTLOOK';
        var box = m === 'OUTLOOK' ? (s.OutlookAccount || ((r.outlookAccounts || [])[0]) || 'Outlook default account') : m === 'GRAPH' ? (s.SharedMailbox || r.graphAccount || '') : (s.SmtpFrom || s.SmtpUser || '');
        var ready = m === 'GRAPH' ? !!r.graphAccount : m === 'SMTP' ? !!(r.smtp && r.smtp.hasPassword) : !!r.outlook;
        return { method: m, mailbox: box, ready: ready, label: ({ OUTLOOK: 'Outlook', GRAPH: 'Microsoft 365', SMTP: 'SMTP' })[m] || m, known: !!M.st };
    };
    /** the addresses we have for a customer: CRM contacts, the Debtors card, Fusion */
    function addressesOf(acct, bu) {
        var out = [], add = function (e, who) { DE.emails(e).forEach(function (x) { if (!out.some(function (o) { return o.email.toLowerCase() === x.toLowerCase(); })) out.push({ email: x, who: who }); }); };
        if (!acct) return out;
        C.contacts.filter(function (k) { return k.ACCOUNT_NUMBER === acct; }).forEach(function (k) { add(k.EMAIL, k.NAME + (k.ROLE ? ' · ' + k.ROLE : '')); });
        var card = C.cards[(bu || C.buOf(acct)) + '|' + acct]; if (card) add(card.STMT_TO, 'statements');
        var m = C.master[acct]; if (m) add(m.EMAIL, 'Fusion');
        ((C.cust && C.cust.account === acct && C.cust.f.fcontacts && C.cust.f.fcontacts.rows) || []).forEach(function (r) { add(r.EMAIL, r.CONTACT); });
        return out;
    }

    // ── compose ──
    C.ACT.compose = function (el) {
        var c = C.cust && C.tab === 'c360' ? C.cust : null, o = { to: el && el.dataset.to };
        if (c) { o.account = c.account; o.bu = c.bu; o.name = c.name; o.lastStmt = c.a && c.a.stmts && c.a.stmts.filter(function (x) { return x.FILE_PATH; })[0]; }
        if (el && el.dataset.stmt && c) { var s = (c.a.stmts || []).filter(function (x) { return x.STMT_ID === el.dataset.stmt; })[0]; if (s) { o.subject = 'Your statement as at ' + s.STMT_DATE; o.stmtId = s.STMT_ID; o.to = o.to || s.EMAIL_TO; o.lastStmt = s; } }
        M.compose(o);
    };
    M.statement = function (o) {
        var b = C.bu(o.bu || C.buOf(o.account));
        if (!b || !b.statement || !b.statement.path) { C.toast('The business unit has no statement report — set it in Debtors Control › Setup', 'bad', 8000); return; }
        var last = (C.cust && C.cust.account === o.account && C.cust.a && C.cust.a.stmts[0]) || null;
        M.compose(Object.assign({ statement: true, lastStmt: last }, o));
    };
    M.compose = function (o) {
        o = o || {};
        var mi = M.info(), addrs = addressesOf(o.account, o.bu), b = C.bu(o.bu || (o.account ? C.buOf(o.account) : C.buId)) || C.curBu() || {};
        var to = o.to || (o.statement ? ((C.cards[b.id + '|' + o.account] || {}).STMT_TO || (addrs[0] || {}).email || '') : (addrs[0] || {}).email || '');
        var mail = b.mail || {}, stmtDate = o.stmtDate || DE.lastMonthEnd(), lastFile = o.lastStmt && o.lastStmt.FILE_PATH ? o.lastStmt : null;
        M.cmp = { o: o, b: b, files: [] };
        C.modal('<i class="fas fa-envelope"></i> ' + (o.statement ? 'Send a statement' : 'New e-mail') + (o.name ? ' · ' + esc(o.name) : ''),
            '<div class="form"><div class="field wide"><label>To</label><input type="text" id="cm-to" value="' + esc(to) + '">' + (addrs.length ? '<div class="chips" style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap">' + addrs.map(function (a) { return '<a class="pill info" data-act="cmAdd" data-e="' + esc(a.email) + '" title="' + esc(a.who) + '">+ ' + esc(a.email) + '</a>'; }).join('') + '</div>' : '') + '</div>' +
            '<div class="field"><label>Cc</label><input type="text" id="cm-cc" value="' + esc(o.statement ? DE.emails([(C.cards[b.id + '|' + o.account] || {}).STMT_CC, mail.cc].join(';')).join('; ') : '') + '"></div><div class="field"><label>Bcc</label><input type="text" id="cm-bcc" value="' + esc(o.statement ? DE.emails(mail.bcc || '').join('; ') : '') + '"></div>' +
            (o.statement ? '<div class="field"><label>Statement as at</label><input type="date" id="cm-date" value="' + esc(stmtDate) + '"></div><div class="field"><label>Business unit</label><div style="padding-top:7px"><b>' + esc(b.name || b.id) + '</b></div></div>' +
                '<div class="field wide"><div class="note">The PDF comes from <code>' + esc(b.statement.path) + '</code>, is recorded in Debtors Control before it is sent, and the e-mail uses the business unit\'s statement text' + (mail.subject ? ' (“' + esc(mail.subject) + '”)' : '') + '.</div></div>' +
                '<div class="field wide"><label class="chk"><input type="checkbox" id="cm-track"' + (mail.track !== false ? ' checked' : '') + '> count when it is opened</label> <label class="chk"><input type="checkbox" id="cm-confirm"' + (mail.confirm !== false ? ' checked' : '') + '> “agree / query the balance” button</label> <label class="chk"><input type="checkbox" id="cm-own"> write my own text</label></div>' : '') +
            '<div class="field wide"' + (o.statement ? ' id="cm-ownbox" hidden' : '') + '><label>Subject</label><input type="text" id="cm-subj" value="' + esc(o.subject || '') + '"></div>' +
            '<div class="field wide"' + (o.statement ? ' id="cm-ownbox2" hidden' : '') + '><div class="row"><label>Message</label><span class="sp"></span><select data-ch="cmCanned"><option value="">Canned reply…</option>' + C.setup.canned.map(function (c, i) { return '<option value="' + i + '">' + esc(c.name) + '</option>'; }).join('') + '</select></div><textarea id="cm-body" rows="9">' + esc(o.body || '') + '</textarea></div>' +
            '<div class="field wide"><label>Attachments</label><div class="row"><input type="file" id="cm-files" multiple data-ch="cmFiles"><span class="small muted">PDF, Excel, pictures … up to 25 MB in all</span></div><div id="cm-list" class="small"></div>' +
            (lastFile && !o.statement ? '<label class="chk" style="margin-top:6px"><input type="checkbox" id="cm-last"> attach the statement as at ' + esc(lastFile.STMT_DATE) + ' (' + esc(lastFile.FILE_NAME || 'PDF') + ')</label>' : '') +
            (o.account && !o.statement ? '<label class="chk" style="margin-top:6px"><input type="checkbox" id="cm-fresh"> make a statement as at <input type="date" id="cm-fdate" value="' + esc(stmtDate) + '" style="min-height:26px"> and attach it (recorded in Debtors Control)</label>' : '') + '</div>' +
            '<div class="field wide"><label class="chk"><input type="checkbox" id="cm-rr"> ask for a read receipt</label> <label class="chk"><input type="checkbox" id="cm-disp"> open it in Outlook first instead of sending</label></div></div>' +
            '<div class="small ' + (mi.ready || !mi.known ? 'muted' : 'badc') + '" style="margin-top:8px"><i class="fas fa-paper-plane"></i> Sent with ' + esc(mi.label) + ' from ' + esc(mi.mailbox || '…') + (mi.known && !mi.ready ? ' — not ready on this PC (Finance Lens › E-mail setup)' : '') + '</div>',
            '<button class="btn" data-act="mclose">Cancel</button><button class="btn pri" data-act="cmSend"><i class="fas fa-paper-plane"></i> Send</button>', true);
        var own = $('cm-own'); if (own) own.onchange = function () { $('cm-ownbox').hidden = !own.checked; $('cm-ownbox2').hidden = !own.checked; };
    };
    C.ACT.cmAdd = function (el) { var t = $('cm-to'); var have = DE.emails(t.value); if (have.indexOf(el.dataset.e) < 0) have.push(el.dataset.e); t.value = have.join('; '); };
    C.CH.cmCanned = function (el) {
        var c = C.setup.canned[+el.value]; if (!c) return; var o = M.cmp.o;
        $('cm-body').value = E.fill(c.body, E.vars({ customer: { name: o.name, account: o.account }, agent: C.me() })); el.value = '';
    };
    C.CH.cmFiles = function (el) {
        var fs = Array.prototype.slice.call(el.files || []);
        Promise.all(fs.map(function (f) { return C.blobB64(f).then(function (b) { return { name: f.name, base64: b, contentType: f.type || 'application/octet-stream', bytes: f.size }; }); })).then(function (list) {
            M.cmp.files = M.cmp.files.concat(list);
            $('cm-list').innerHTML = M.cmp.files.map(function (f, i) { return '<div><i class="fas fa-paperclip"></i> ' + esc(f.name) + ' · ' + Math.round(f.bytes / 1024) + ' KB <a data-act="cmRm" data-i="' + i + '">remove</a></div>'; }).join('');
            el.value = '';
        });
    };
    C.ACT.cmRm = function (el) { M.cmp.files.splice(+el.dataset.i, 1); C.CH.cmFiles({ files: [], value: '' }); };
    C.ACT.cmSend = function () {
        var cmp = M.cmp, o = cmp.o, b = cmp.b, v = function (id) { var x = $(id); return x ? (x.value || '').trim() : ''; }, chk = function (id) { var x = $(id); return !!(x && x.checked); };
        var to = DE.emails(v('cm-to')).join('; ');
        if (!to) { C.toast('Who is it for?', 'warn'); return; }
        var own = !o.statement || chk('cm-own');
        if (own && !v('cm-subj')) { C.toast('A subject, please', 'warn'); return; }
        var job = { to: to, cc: DE.emails(v('cm-cc')).join('; '), bcc: DE.emails(v('cm-bcc')).join('; '), subject: v('cm-subj'), text: v('cm-body'), own: own, files: cmp.files.slice(), display: chk('cm-disp'), readReceipt: chk('cm-rr'),
            lastPath: chk('cm-last') && o.lastStmt ? o.lastStmt : null, stmtDate: o.statement ? v('cm-date') : chk('cm-fresh') ? v('cm-fdate') : null, track: chk('cm-track'), confirm: chk('cm-confirm') };
        C.mclose();
        M.send(o, b, job).then(function (r) { C.toast(r.msg, r.ok ? 'ok' : 'bad', 7000); }, function (e) { C.toast(C.errText(e), 'bad', 9000); });
    };

    /** one e-mail: (a statement PDF made + recorded) → CRM message row → send → outcome on both records */
    M.send = function (o, b, job) {
        var end = C.busy(job.stmtDate ? 'Making the statement…' : 'Sending…'), msgId = 'ms' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        var mi = M.info(), stmt = null, files = [], tok = null, html;
        var c = { account: o.account, name: o.name, currency: b.currency, email: job.to };
        var ar = C.cust && C.cust.account === o.account && C.cust.f.open && C.cust.f.open.rows ? DE.openItemsSummary(C.cust.f.open.rows) : null, last = o.lastStmt;
        if (ar) { c.balance = ar.total; c.overdue = ar.overdue; c.aging = ar.aging; } else if (last) { c.balance = +last.BALANCE; c.overdue = last.OVERDUE !== '' && last.OVERDUE != null ? +last.OVERDUE : null; }
        var mail = b.mail || {}, vars = DE.vars(b, job.stmtDate || DE.lastMonthEnd(), c);
        var p = Promise.resolve();
        if (job.stmtDate) {
            var trackOn = o.statement && (job.track || job.confirm);
            tok = trackOn ? DE.token() : null;
            stmt = { id: DE.uid('st'), pod: C.pod, buId: b.id, buName: b.name, company: b.company || b.name, account: o.account, name: o.name, stmtDate: job.stmtDate, currency: c.currency, balance: c.balance, overdue: c.overdue, aging: c.aging,
                delivery: 'EMAIL', to: job.to, cc: job.cc, subject: job.own ? job.subject : DE.fill(mail.subject, vars), machine: (C.info || {}).machine, token: tok, tracked: !!tok, resentOf: o.resentOf || null };
            p = D.call('dcStatementPdf', { instance: C.pod, path: b.statement.path, params: DE.fillParams(b.statement.params, vars), bu: b.name || b.id, stmtDate: job.stmtDate, fileName: o.account + ' ' + String(o.name || '').slice(0, 60) + ' ' + stmt.id.slice(-6) }, 300000).then(function (pdf) {
                stmt.fileName = pdf.name; stmt.filePath = pdf.path; stmt.sha = pdf.sha256; stmt.bytes = pdf.bytes; stmt.status = 'GENERATED';
                files.push({ path: pdf.path, name: DE.fill(mail.attach || 'Statement {ACCOUNT_NUMBER}', vars) + '.pdf' });
                return D.stmt.insert(stmt).catch(function (e) { throw new Error('Not sent — the statement could not be recorded in APEX: ' + C.errText(e)); });
            });
        }
        if (job.lastPath) p = p.then(function () { return D.call('dcFileCheck', { path: job.lastPath.FILE_PATH }).then(function (r) { if (!r.exists) throw new Error('The statement PDF of ' + job.lastPath.STMT_DATE + ' is not on this PC — make a fresh one instead.'); if (r.sha256 !== job.lastPath.SHA256) throw new Error('The statement PDF on this PC is not the one recorded — make a fresh one instead.'); files.push({ path: job.lastPath.FILE_PATH, name: 'Statement ' + o.account + ' ' + job.lastPath.STMT_DATE + '.pdf' }); }); });
        var subject;
        return p.then(function () {
            subject = job.own ? job.subject : DE.fill(mail.subject, vars);
            html = job.own ? E.emailHtml(job.text, { signature: C.setup.signature, ticketLink: o.ticket ? S.ticketUrl(o.ticket.TOKEN) : '', ticketNo: o.ticket && o.ticket.TICKET_NO })
                : '<div style="font:14px/1.5 Segoe UI,Arial,sans-serif;color:#0f172a">' + DE.fill(mail.body || DE.DEFAULT_BODY, vars, 'html') + '</div>';
            if (tok) html = html.replace(/<\/div>$/, DE.trackHtml(D.PUBLIC, tok, { track: job.track, confirm: job.confirm }) + '</div>');
            var attNames = files.map(function (f) { return f.name; }).concat(job.files.map(function (f) { return f.name; })).join('; ');
            return S.messages.add({ id: msgId, buId: b.id || o.bu, account: o.account, name: o.name, to: job.to, cc: job.cc, subject: subject, body: job.own ? job.text : 'Statement as at ' + job.stmtDate, attachments: attNames, ticketId: o.ticket ? o.ticket.TICKET_ID : o.ticketId, stmtId: stmt ? stmt.id : o.stmtId, status: 'PENDING', method: mi.method, mailbox: mi.mailbox, machine: (C.info || {}).machine });
        }).then(function () {
            return D.call('crmSend', { to: job.to, cc: job.cc, bcc: job.bcc, subject: subject, html: html, files: files, attachments: job.files.map(function (f) { return { name: f.name, base64: f.base64, contentType: f.contentType }; }), display: job.display, readReceipt: job.readReceipt, noSignature: !job.own, account: o.account }, 600000);
        }).then(function (r) {
            var st = r.result === 'draft' ? 'DRAFT' : 'SENT', fp = (r.attachments || []).map(function (a) { return a.name + ' (' + a.sha256.slice(0, 12) + ')'; }).join('; ');
            return Promise.all([
                S.messages.sent(msgId, { status: st, method: r.via, mailbox: mi.mailbox }).then(function () { if (fp) return D.write('UPDATE wms_crm_messages SET attachments = ' + D.lit(fp, 2000) + ' WHERE msg_id = ' + D.lit(msgId)); }),
                stmt ? D.stmt.sent(stmt.id, { status: st, method: r.via, mailbox: mi.mailbox }) : null,
                o.account ? D.act.add({ id: DE.uid('ac'), buId: b.id || o.bu, account: o.account, name: o.name, kind: 'EMAIL', subject: subject, body: (job.own ? job.text : 'Statement as at ' + job.stmtDate).slice(0, 3900), status: 'DONE', ref: stmt ? stmt.id : msgId }).catch(function () { }) : null,
                o.ticket ? S.events.add({ ticketId: o.ticket.TICKET_ID, kind: 'EMAIL_OUT', body: job.text, visibility: 'PUBLIC', meta: { msg: msgId, to: job.to } }).then(function () { if (o.first !== false) return C.markReplied(o.ticket); }) : null
            ]).then(function () { end(); return { ok: true, msg: (st === 'DRAFT' ? 'Opened in Outlook' : 'Sent to ' + job.to) + (stmt ? ' · statement recorded' : '') }; });
        }, function (e) {
            var err = C.errText(e);
            return Promise.all([S.messages.sent(msgId, { status: 'FAILED', error: err, method: mi.method, mailbox: mi.mailbox }).catch(function () { }), stmt && stmt.status ? D.stmt.sent(stmt.id, { status: 'FAILED', error: err, method: mi.method, mailbox: mi.mailbox }).catch(function () { }) : null])
                .then(function () { end(); return { ok: false, msg: 'Not sent: ' + err }; });
        }).then(function (r) {
            C.loadCore().then(function () { if (C.cust && C.cust.account === o.account && C.tab === 'c360') C.ACT.c360Refresh(); else C.render(); });
            return r;
        });
    };
    /** a ticket reply by e-mail: [CS-000123] subject, the link to the customer's page */
    M.ticketMail = function (t, text, opts) {
        if (!t.CONTACT_EMAIL) return Promise.reject(new Error('The ticket has no customer e-mail'));
        var b = C.bu(t.BU_ID) || C.curBu() || {};
        return M.send({ account: t.ACCOUNT_NUMBER, bu: t.BU_ID, name: t.ACCOUNT_NAME, ticket: t, first: !opts || opts.first !== false }, b, { to: t.CONTACT_EMAIL, cc: '', bcc: '', subject: E.subjectFor(t), text: text, own: true, files: [] })
            .then(function (r) { if (!r.ok) throw new Error(r.msg); return r; });
    };

    // ── the E-mails tab ──
    C.msgTable = function (list) {
        return C.table([['CREATED_AT', 'When'], [function (m) { return m.ACCOUNT_NUMBER ? '<a data-act="open360" data-bu="' + esc(m.BU_ID || '') + '" data-acct="' + esc(m.ACCOUNT_NUMBER) + '" data-name="' + esc(m.ACCOUNT_NAME || '') + '">' + esc(m.ACCOUNT_NAME || m.ACCOUNT_NUMBER) + '</a>' : ''; }, 'Customer'],
            ['TO_ADDR', 'To'], [function (m) { return '<b>' + esc(m.SUBJECT) + '</b>' + (m.ATTACHMENTS ? '<div class="small muted"><i class="fas fa-paperclip"></i> ' + esc(m.ATTACHMENTS) + '</div>' : ''); }, 'Subject'],
            [function (m) { return C.pill(esc(m.STATUS), m.STATUS === 'SENT' ? 'ok' : m.STATUS === 'FAILED' ? 'bad' : 'warn', m.ERROR_TEXT); }, 'Status'], ['BY_USER', 'By'], [function (m) { return esc(m.METHOD || ''); }, 'Via'],
            [function (m) { return (m.TICKET_ID ? '<button class="btn sm ghost" data-act="openTicket" data-id="' + esc(m.TICKET_ID) + '"><i class="fas fa-ticket"></i></button>' : '') + (m.STMT_ID ? C.pill('statement', 'info') : ''); }, '', 'r']], list, { empty: 'No e-mails.' });
    };
    C.views.mail = function () {
        var f = C.ml.f, q = String(f.q || '').toLowerCase(), from = C.addDays(-(+f.days || 30));
        var list = C.msgs.filter(function (m) { return String(m.CREATED_AT).slice(0, 10) >= from && (!q || (m.SUBJECT + ' ' + m.TO_ADDR + ' ' + m.ACCOUNT_NAME + ' ' + m.BY_USER).toLowerCase().indexOf(q) >= 0); });
        var mi = M.info(), failed = list.filter(function (m) { return m.STATUS === 'FAILED'; }).length;
        return '<div class="kpis">' + C.kpi('E-mails', list.length, 'last ' + f.days + ' days', 'pri') + C.kpi('Failed', failed, 'not sent', failed ? 'bad' : 'ok') + C.kpi('With statements', list.filter(function (m) { return m.STMT_ID; }).length, 'recorded in Debtors Control', 'info') +
            C.kpi('Sent with', mi.label, mi.mailbox || '', mi.ready ? 'ok' : 'warn') + '</div>' +
            '<div class="card"><div class="filters"><input type="search" id="ml-q" data-in="mlQ" placeholder="Subject, address, customer…" value="' + esc(f.q || '') + '"><span class="sp"></span><button class="btn pri" data-act="compose"><i class="fas fa-pen"></i> New e-mail</button></div>' + C.msgTable(list) + '</div>';
    };
    C.IN.mlQ = function (el) { C.ml.f.q = el.value; C.keepFocus('ml-q', C.render); };
})();
