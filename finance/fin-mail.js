/* Finance Lens — e-mail for board packs.
   FL.mail.setup(): the envelope icon in the header — how this PC sends: Outlook desktop (open the message to review,
   or send at once), Microsoft 365 through Microsoft Graph (sign in once; optional shared mailbox) or SMTP (Office 365
   preset). Sender name, reply-to, default recipients and a signature. Test sends a short message. Host: finMail*
   (classes/FinanceMail.cs) — passwords and tokens never reach the page.
   FL.mail.compose(pack, built, onSent): recipients (with the addresses used before), subject, intro, what goes in the
   body (KPI tiles, income statement at a glance, trend chart, highlights), the interactive pack attached, a live
   preview of the message, then Send / Open in Outlook. */
(function () {
    var M = FL.mail = { st: null };
    var METHODS = {
        OUTLOOK: { icon: 'fa-brands fa-microsoft', name: 'Outlook on this PC', what: 'Uses the Outlook desktop app and its account — opens the message for a last look (or sends at once). Nothing to sign in.' },
        GRAPH: { icon: 'fa-solid fa-cloud', name: 'Microsoft 365 (Outlook online)', what: 'Sends from your Office 365 mailbox through Microsoft Graph, also when Outlook is not installed. Sign in once with your work account.' },
        SMTP: { icon: 'fa-solid fa-server', name: 'SMTP (Office 365 or other)', what: 'Sends through an SMTP account — smtp.office365.com:587 for Office 365. The password is kept encrypted on this PC.' }
    };
    var v = function (id) { var e = $(id); return e ? (e.type === 'checkbox' ? e.checked : e.value) : ''; };

    M.status = function () { return FL.call('finMailStatus').then(function (r) { M.st = r; M.paintHeader(); return r; }); };
    M.paintHeader = function () {
        var b = $('b-mail'); if (!b || !M.st) return;
        var s = M.st.settings || {}, ok = s.Method === 'GRAPH' ? !!M.st.graphAccount : s.Method === 'SMTP' ? !!(M.st.smtp && M.st.smtp.hasPassword) : M.st.outlook;
        b.classList.toggle('warn', !ok);
        b.title = 'E-mail setup — ' + (METHODS[s.Method] || METHODS.OUTLOOK).name + (ok ? ' (ready)' : ' (not ready — click to set up)');
    };

    // ═════ setup ═════
    M.setup = function () {
        FL.modal('<i class="fa-solid fa-envelope-circle-check"></i> E-mail setup', '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading this PC…</div>');
        M.status().then(M.paintSetup).catch(function (e) { $('m-body').innerHTML = '<div class="callout bad">' + esc(String(e && e.message || e)) + '<br>An app built before this version has no e-mail service — rebuild GraysWMS.</div>'; });
    };
    M.paintSetup = function () {
        var r = M.st, s = r.settings || {}, me = s.Method || 'OUTLOOK', smtp = r.smtp || {};
        var card = function (k) {
            var m = METHODS[k], ok = k === 'OUTLOOK' ? r.outlook : k === 'GRAPH' ? !!r.graphAccount : !!smtp.hasPassword;
            var badge = k === 'OUTLOOK' ? (r.outlook ? '<span class="tag good">installed</span>' : '<span class="tag">not on this PC</span>') : k === 'GRAPH' ? (r.graphAccount ? '<span class="tag good">' + esc(r.graphAccount) + '</span>' : '<span class="tag">not signed in</span>') : (smtp.hasPassword ? '<span class="tag good">' + esc(smtp.username) + '</span>' : '<span class="tag">not set up</span>');
            return '<label class="ml-card' + (me === k ? ' on' : '') + (ok ? ' ok' : '') + '"><input type="radio" name="ml-m" value="' + k + '"' + (me === k ? ' checked' : '') + '><i class="' + m.icon + '"></i><div><b>' + m.name + '</b> ' + badge + '<small>' + m.what + '</small></div></label>';
        };
        var h = '<div class="ml-cards">' + ['OUTLOOK', 'GRAPH', 'SMTP'].map(card).join('') + '</div>';
        h += '<div class="ml-pane" data-p="OUTLOOK"' + (me === 'OUTLOOK' ? '' : ' hidden') + '><label class="sm"><input type="radio" name="ml-os" value="0"' + (!s.OutlookSend ? ' checked' : '') + '> open the message in Outlook so I can look and press Send <span class="muted">(recommended)</span></label><br>' +
            '<label class="sm"><input type="radio" name="ml-os" value="1"' + (s.OutlookSend ? ' checked' : '') + '> send at once from my Outlook account</label>' +
            (r.outlook ? '' : '<div class="callout warn sm" style="margin-top:8px">Outlook (classic desktop) is not installed on this PC — the new Outlook app has no automation. Choose Microsoft 365 instead.</div>') + '</div>';
        h += '<div class="ml-pane" data-p="GRAPH"' + (me === 'GRAPH' ? '' : ' hidden') + '><div class="row">' +
            (r.graphAccount ? '<span class="tag good"><i class="fa-solid fa-circle-check"></i> Signed in as ' + esc(r.graphAccount) + '</span><button class="btn sm" id="ml-out">Sign out</button>' : '<button class="btn primary sm" id="ml-in"><i class="fa-brands fa-microsoft"></i> Sign in with Microsoft 365</button><span class="sm muted">opens the Microsoft sign-in in your browser</span>') +
            '</div><details style="margin-top:8px"' + (r.graphApp || s.ClientId ? '' : ' open') + '><summary class="sm">App registration ' + (r.graphApp ? '<span class="muted">— using the ' + esc(r.graphApp) + '</span>' : '<span class="neg">— needed once</span>') + '</summary>' +
            '<div class="grid g2" style="margin-top:6px"><label class="field">Directory (tenant) ID<input id="ml-ten" value="' + esc(s.TenantId || '') + '" placeholder="blank = the Power BI one / any work account"></label>' +
            '<label class="field">Application (client) ID<input id="ml-cli" value="' + esc(s.ClientId || '') + '" placeholder="blank = the Power BI app registration"></label>' +
            '<label class="field">Send from a shared mailbox (optional)<input id="ml-shared" value="' + esc(s.SharedMailbox || '') + '" placeholder="finance@company.com"></label></div>' +
            '<p class="sm muted" style="margin:6px 0 0">Azure portal › App registrations › New: <b>Mobile and desktop</b> redirect URI <code>http://localhost</code>, <i>Allow public client flows</i> on; API permissions › Microsoft Graph › Delegated: <b>Mail.Send</b>, <b>User.Read</b> (and <b>Mail.Send.Shared</b> for a shared mailbox, where you need Send As rights). The same registration as Power BI works once Mail.Send is added.</p></details>' +
            (r.graphError ? '<div class="callout warn sm">' + esc(r.graphError) + '</div>' : '') + '</div>';
        h += '<div class="ml-pane" data-p="SMTP"' + (me === 'SMTP' ? '' : ' hidden') + '><div class="row sm"><span class="muted">Presets</span><button class="btn sm" data-pre="smtp.office365.com|587">Office 365</button><button class="btn sm" data-pre="smtp-mail.outlook.com|587">Outlook.com</button><button class="btn sm" data-pre="smtp.gmail.com|587">Gmail</button></div>' +
            '<div class="grid g2"><label class="field">Server<input id="ml-srv" value="' + esc(s.SmtpServer || smtp.server || 'smtp.office365.com') + '"></label><label class="field">Port<input id="ml-port" type="number" value="' + (s.SmtpPort || smtp.port || 587) + '"></label>' +
            '<label class="field">User name (e-mail)<input id="ml-user" value="' + esc(s.SmtpUser || smtp.username || '') + '" autocomplete="off"></label><label class="field">Password ' + (smtp.hasPassword ? '<span class="muted">(saved — leave blank to keep)</span>' : '') + '<input id="ml-pw" type="password" autocomplete="new-password"></label>' +
            '<label class="field">Send as (optional)<input id="ml-from" value="' + esc(s.SmtpFrom || '') + '" placeholder="same as the user name"></label></div><p class="sm muted">Office 365 needs <i>Authenticated SMTP</i> allowed for the mailbox. The password is encrypted for your Windows account on this PC (shared with the AI assistant\'s e-mail).</p></div>';
        h += '<h4 class="pk-h" style="margin-top:14px"><i class="fa-solid fa-signature"></i> Every message</h4><div class="grid g2">' +
            '<label class="field">Sender name<input id="ml-name" value="' + esc(s.FromName || '') + '" placeholder="Finance team"></label><label class="field">Replies go to (optional)<input id="ml-reply" value="' + esc(s.ReplyTo || '') + '"></label>' +
            '<label class="field">Default To<input id="ml-to" value="' + esc(s.DefaultTo || '') + '" placeholder="board@company.com; cfo@company.com"></label><label class="field">Default Cc<input id="ml-cc" value="' + esc(s.DefaultCc || '') + '"></label></div>' +
            '<label class="field">Signature<textarea id="ml-sig" rows="3" placeholder="Kind regards,&#10;Finance team">' + esc(s.Signature || '') + '</textarea></label>' +
            '<div class="row" style="margin-top:12px"><input id="ml-testto" placeholder="test address" value="' + esc(r.graphAccount || smtp.username || '') + '" style="max-width:240px"><button class="btn" id="ml-test"><i class="fa-solid fa-vial"></i> Save &amp; send a test</button><span class="grow"></span><button class="btn primary" id="ml-save"><i class="fa-solid fa-floppy-disk"></i> Save</button></div><div id="ml-msg" class="sm" style="margin-top:6px"></div>';
        var recent = r.recent || [];
        if (recent.length) h += '<details style="margin-top:10px"><summary class="sm">Sent from this PC (' + recent.length + ')</summary><table class="t sm"><thead><tr><th>When</th><th>How</th><th>Subject</th><th>To</th></tr></thead><tbody>' + recent.slice(0, 15).map(function (x) { return '<tr><td>' + esc(x.At) + '</td><td>' + esc(x.Via + (x.Result === 'draft' ? ' · opened' : '')) + '</td><td>' + esc(x.Subject) + '</td><td>' + esc(x.To) + '</td></tr>'; }).join('') + '</tbody></table></details>';
        $('m-body').innerHTML = h;
        document.querySelectorAll('[name=ml-m]').forEach(function (x) { x.onchange = function () { document.querySelectorAll('.ml-card').forEach(function (c) { c.classList.toggle('on', c.querySelector('input').checked); }); document.querySelectorAll('.ml-pane').forEach(function (p) { p.hidden = p.dataset.p !== x.value; }); }; });
        document.querySelectorAll('[data-pre]').forEach(function (b) { b.onclick = function () { var a = b.dataset.pre.split('|'); $('ml-srv').value = a[0]; $('ml-port').value = a[1]; }; });
        if ($('ml-in')) $('ml-in').onclick = function () {
            var b = this; b.disabled = true; b.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Waiting for the browser sign-in…';
            M.save(true).then(function () { return FL.call('finMailSignIn', {}, 320000); }).then(function (x) { FL.toast('Signed in as ' + x.account, 'ok'); return M.status(); }).then(M.paintSetup)
                .catch(function (e) { FL.toast(String(e && e.message || e), 'err'); b.disabled = false; b.innerHTML = '<i class="fa-brands fa-microsoft"></i> Sign in with Microsoft 365'; });
        };
        if ($('ml-out')) $('ml-out').onclick = function () { FL.call('finMailSignOut').then(M.status).then(M.paintSetup); };
        $('ml-save').onclick = function () { M.save().then(function () { FL.toast('E-mail setup saved', 'ok'); FL.closeModal(); }); };
        $('ml-test').onclick = function () {
            var b = this, to = v('ml-testto'); b.disabled = true; $('ml-msg').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Sending…';
            M.save(true).then(function () { return FL.call('finMailTest', { to: to }, 180000); }).then(function (x) {
                $('ml-msg').innerHTML = '<span class="pos">✓ ' + (x.result === 'draft' ? 'Opened in Outlook' : 'Sent via ' + esc(x.via) + (x.by ? ' as ' + esc(x.by) : '') + ' to ' + esc(to)) + '</span>';
            }).catch(function (e) { $('ml-msg').innerHTML = '<span class="neg">✗ ' + esc(String(e && e.message || e)) + '</span>'; }).then(function () { b.disabled = false; });
        };
    };
    /** Saves the dialog's settings (quiet = no reload of the dialog) */
    M.save = function (quiet) {
        var cur = (M.st && M.st.settings) || {};
        var s = Object.assign({}, cur, {
            Method: (document.querySelector('[name=ml-m]:checked') || {}).value || 'OUTLOOK', OutlookSend: (document.querySelector('[name=ml-os]:checked') || {}).value === '1',
            TenantId: v('ml-ten'), ClientId: v('ml-cli'), SharedMailbox: v('ml-shared'), SmtpServer: v('ml-srv'), SmtpPort: +v('ml-port') || 587, SmtpUser: v('ml-user'), SmtpFrom: v('ml-from'),
            FromName: v('ml-name'), ReplyTo: v('ml-reply'), DefaultTo: v('ml-to'), DefaultCc: v('ml-cc'), Signature: v('ml-sig')
        });
        return FL.call('finMailSave', { settings: JSON.stringify(s), smtpPassword: v('ml-pw') || '' }).then(function (r) { M.st = r; M.paintHeader(); if (!quiet) return r; return r; })
            .catch(function (e) { FL.toast(String(e && e.message || e), 'err'); throw e; });
    };

    // ═════ compose ═════
    var b64 = function (str) { var bytes = new TextEncoder().encode(str), bin = ''; for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
    var CID = 'trend@financelens', LOGO = 'logo@financelens';

    M.compose = function (pack, built, onSent) {
        var go = function () {
            var s = (M.st && M.st.settings) || {}, e = pack.email = pack.email || {}, me = s.Method || 'OUTLOOK';
            var addrs = {}; (M.st && M.st.recent || []).forEach(function (x) { String((x.To || '') + ';' + (x.Cc || '')).split(/[;,]/).forEach(function (a) { a = a.trim(); if (a) addrs[a] = 1; }); });
            var to = e.to || s.DefaultTo || '', cc = e.cc != null && e.cc !== '' ? e.cc : (s.DefaultCc || '');
            var subj = P_subject(pack, built);
            var ok = me === 'GRAPH' ? !!(M.st && M.st.graphAccount) : me === 'SMTP' ? !!(M.st && M.st.smtp && M.st.smtp.hasPassword) : !!(M.st && M.st.outlook);
            FL.modal('<i class="fa-solid fa-paper-plane"></i> E-mail the board pack · ' + esc(built.model.period),
                '<div class="ml-comp"><div class="ml-form">' +
                '<datalist id="ml-addrs">' + Object.keys(addrs).map(function (a) { return '<option value="' + esc(a) + '">'; }).join('') + '</datalist>' +
                '<label class="field">To<input id="mc-to" list="ml-addrs" value="' + esc(to) + '" placeholder="name@company.com; …"></label>' +
                '<div class="grid g2"><label class="field">Cc<input id="mc-cc" list="ml-addrs" value="' + esc(cc) + '"></label><label class="field">Bcc<input id="mc-bcc" list="ml-addrs" value="' + esc(e.bcc || '') + '"></label></div>' +
                '<label class="field">Subject<input id="mc-subj" value="' + esc(subj) + '"></label>' +
                '<label class="field">Message <span class="muted sm">({PERIOD}, {TITLE}, {COMPANY} are filled in)</span><textarea id="mc-intro" rows="6">' + esc(e.intro != null ? e.intro : FL.packs.newPack().email.intro) + '</textarea></label>' +
                '<div class="field">In the message</div><div class="ml-chks"><label><input type="checkbox" id="mc-tiles"' + (e.tiles !== false ? ' checked' : '') + '> KPI tiles</label><label><input type="checkbox" id="mc-lines"' + (e.lines !== false ? ' checked' : '') + '> income statement at a glance</label>' +
                '<label><input type="checkbox" id="mc-chart"' + (e.chart !== false && built.model.trendPng ? ' checked' : '') + (built.model.trendPng ? '' : ' disabled') + '> trend chart</label><label><input type="checkbox" id="mc-hl"' + (e.hl !== false ? ' checked' : '') + '> highlights</label>' +
                (built.model.logo ? '<label><input type="checkbox" id="mc-logo"' + (e.logo !== false ? ' checked' : '') + '> logo</label>' : '') +
                '<label><input type="checkbox" id="mc-att"' + (e.attach !== false ? ' checked' : '') + '> attach the interactive pack <span class="muted">(' + esc(built.file) + ', ' + Math.round(built.html.length / 1024) + ' KB)</span></label></div>' +
                '<div class="field">Distribution <span class="muted sm">— every send is recorded in Board packs › Distribution</span></div><div class="ml-chks">' +
                '<label title="Each person gets their own copy with a button to confirm receipt and a small picture that shows when it is opened"><input type="checkbox" id="mc-track"' + (e.track !== false ? ' checked' : '') + '> track: one copy per person with <b>Confirm receipt</b> and open tracking</label>' +
                '<label title="The mail system sends a receipt back to your mailbox when it is delivered and when it is read (people can decline a read receipt)"><input type="checkbox" id="mc-rr"' + (e.receipts !== false ? ' checked' : '') + '> ask for delivery and read receipts</label></div>' +
                '<div class="row ml-send"><label class="sm">Send with <select id="mc-how">' + ['OUTLOOK', 'GRAPH', 'SMTP'].map(function (k) { return '<option value="' + k + '"' + (k === me ? ' selected' : '') + '>' + METHODS[k].name + '</option>'; }).join('') + '</select></label>' +
                '<button class="btn sm ghost" onclick="FL.mail.setup()" title="E-mail setup"><i class="fa-solid fa-gear"></i></button>' + (ok ? '' : '<span class="tag warn">not set up</span>') + '<span class="grow"></span>' +
                (M.st && M.st.outlook ? '<button class="btn" id="mc-review" title="Open the message in Outlook to check it and send it yourself"><i class="fa-brands fa-microsoft"></i> Open in Outlook</button>' : '') +
                '<button class="btn primary" id="mc-send"><i class="fa-solid fa-paper-plane"></i> Send</button></div><div id="mc-msg" class="sm"></div></div>' +
                '<div class="ml-prev"><div class="sm muted" style="margin-bottom:4px"><i class="fa-regular fa-eye"></i> How the message looks</div><iframe id="mc-f" title="Message preview"></iframe></div></div>');
            var opts = function (forSend) {
                return { intro: $('mc-intro').value, tiles: $('mc-tiles').checked, keyLines: $('mc-lines').checked, highlights: $('mc-hl').checked,
                    chart: $('mc-chart').checked && built.model.trendPng ? (forSend ? 'cid:' + CID : built.model.trendPng) : null,
                    logo: $('mc-logo') && $('mc-logo').checked ? (forSend ? 'cid:' + LOGO : built.model.logo.png) : null, attached: $('mc-att').checked ? built.file : null, sections: built.sections };
            };
            var paint = function () { var o = opts(false); if ($('mc-track') && $('mc-track').checked) o.track = { ack: '#', copyFor: (String($('mc-to').value).split(/[;,\s]+/).filter(Boolean)[0] || 'name@company.com'), also: '' }; $('mc-f').srcdoc = FL.packs.emailHtml(pack, built.model, o).html; };
            ['mc-intro', 'mc-tiles', 'mc-lines', 'mc-chart', 'mc-hl', 'mc-att', 'mc-logo', 'mc-track', 'mc-to'].filter($).forEach(function (id) { $(id).oninput = $(id).onchange = function () { clearTimeout(M._pt); M._pt = setTimeout(paint, 250); }; });
            paint();
            var send = function (how, display) {
                var to2 = $('mc-to').value.trim();
                if (!to2 && !(how === 'OUTLOOK' && display)) { FL.toast('Add at least one recipient', 'err'); $('mc-to').focus(); return; }
                Object.assign(pack.email, { to: to2, cc: $('mc-cc').value.trim(), bcc: $('mc-bcc').value.trim(), subject: subjTemplate(pack, $('mc-subj').value, built), intro: $('mc-intro').value,
                    tiles: $('mc-tiles').checked, lines: $('mc-lines').checked, chart: $('mc-chart').checked, hl: $('mc-hl').checked, logo: !$('mc-logo') || $('mc-logo').checked, attach: $('mc-att').checked,
                    track: $('mc-track').checked, receipts: $('mc-rr').checked });
                var btns = document.querySelectorAll('#mc-send, #mc-review'); btns.forEach(function (b) { b.disabled = true; });
                var say = function (h) { $('mc-msg').innerHTML = h; };
                M.deliver({ pack: pack, built: built, how: how, display: display, to: to2, cc: pack.email.cc, bcc: pack.email.bcc, subject: $('mc-subj').value, opts: opts(true), track: $('mc-track').checked && !display, rr: $('mc-rr').checked, say: say })
                    .then(function (res) {
                        var r = res.r;
                        if (onSent) onSent(r);
                        if (r.result !== 'draft' && !res.failed.length) setTimeout(FL.closeModal, 1200);
                    }).catch(function (e2) { say('<span class="neg">✗ ' + esc(String(e2 && e2.message || e2)) + '</span>'); })
                    .then(function () { btns.forEach(function (b) { b.disabled = false; }); });
            };
            $('mc-send').onclick = function () { send($('mc-how').value, false); };
            if ($('mc-review')) $('mc-review').onclick = function () { send('OUTLOOK', true); };
        };
        (M.st ? Promise.resolve() : M.status().catch(function () { M.st = { settings: {}, recent: [] }; })).then(go);
    };
    /**
     * Sends a built pack: stamps the copy (document ID, distribution page), records the send and every person in APEX
     * (Distribution), sends one copy per person when tracking (their own picture + confirmation button) or one message,
     * keeps the e-mail text with the record. job = {pack, built, how, display, to, cc, bcc, subject, opts (emailHtml options
     * with cid: pictures), track, rr, say(html), archive: {status, comments, meeting} → also saved in the archive}.
     * Resolves {r, ok, failed, stamped, sha, recorded, people, archived}.
     */
    M.deliver = function (job) {
        var pack = job.pack, built = job.built, how = job.how, display = !!job.display, track = !!job.track, rr = !!job.rr, say = job.say || function () { };
        var split = function (v) { return String(v || '').split(/[;,\s]+/).map(function (a) { return a.trim(); }).filter(function (a) { return /@/.test(a); }); };
        var seen = {}, people = [].concat(split(job.to).map(function (e) { return { email: e, kind: 'TO' }; }), split(job.cc).map(function (e) { return { email: e, kind: 'CC' }; }), split(job.bcc).map(function (e) { return { email: e, kind: 'BCC' }; }))
            .filter(function (x) { var k = x.email.toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; });
        people.forEach(function (x) { x.token = FL.packTrack.token(); });
        say('<i class="fa-solid fa-circle-notch fa-spin"></i> ' + (display ? 'Opening Outlook…' : 'Preparing…'));
        // the copy that leaves: the pack + its distribution page and document ID; its fingerprint goes in the e-mail and the archive
        var via = { GRAPH: 'Microsoft 365', SMTP: 'SMTP', OUTLOOK: 'Outlook' }[how] || how;
        var stamped = FL.packs.stamp(built, { to: job.to, cc: job.cc, by: (M.st && M.st.graphAccount) || (FL.who && FL.who.user) || '', via: via, kind: 'EMAIL' });
        var subject = job.subject, recorded = false, sha = null, body = null;
        return FL.packArchive.sha256(stamped.html).then(function (h) {
            sha = h;
            var o = Object.assign({}, job.opts); o.fingerprint = o.attached ? sha : null; o.docId = stamped.docId; if (o.attached) o.attached = stamped.file;
            var att = [];
            if (o.attached) att.push({ name: stamped.file, contentType: 'text/html', base64: b64(stamped.html) });
            if (o.logo) att.push({ name: 'logo.png', contentType: 'image/png', cid: LOGO, base64: built.model.logo.png.split(',')[1] });
            if (o.chart) att.push({ name: 'trend.png', contentType: 'image/png', cid: CID, base64: built.model.trendPng.split(',')[1] });
            // the record in APEX first, so an open or a confirmation that comes at once finds its row
            var rec = FL.packTrack.record({ sendId: stamped.docId, docId: stamped.docId, pack: pack, period: built.model.period, ledgers: (built.model.ledgers || []).map(function (l) { return l.name; }).join(', ') || built.model.ledgerName || '',
                subject: subject, method: how, mailbox: (M.st && M.st.graphAccount) || (M.st && M.st.settings && (M.st.settings.SmtpFrom || M.st.settings.SmtpUser)) || via, file: stamped.file, sha: sha, tracked: track, receipts: rr,
                note: display ? 'opened in Outlook to review' : (job.archive && job.archive.comments) || '' }, people).then(function () { recorded = true; })
                .catch(function (e) { console.warn('[mail] distribution record', e); say('<span class="neg">The distribution record could not be written to APEX (' + esc(String(e && e.message || e)) + ') — sending anyway.</span>'); });
            var html = function (oo) { var h2 = FL.packs.emailHtml(pack, built.model, oo).html; if (!body) body = h2; return h2; };
            var one = function (to, cc, bcc, oo) {
                return FL.call('finMailSend', { method: how, display: display, to: to, cc: cc, bcc: bcc, subject: subject, html: html(oo), attachments: att, readReceipt: rr, deliveryReceipt: rr }, 600000);
            };
            var mark = function (tokens, st, err) { return recorded ? FL.packTrack.mark(tokens, st, err) : Promise.resolve(); };
            return rec.then(function () {
                if (!track) {
                    return one(job.to, job.cc, job.bcc, o).then(function (r) {
                        return mark(people.map(function (x) { return x.token; }), r.result === 'draft' ? 'DRAFT' : 'SENT').then(function () { return { r: r, ok: people.length, failed: [] }; });
                    }, function (e) { return mark(people.map(function (x) { return x.token; }), 'FAILED', String(e && e.message || e)).then(function () { throw e; }); });
                }
                // one copy per person: their own confirmation button and picture
                var shown = people.filter(function (x) { return x.kind !== 'BCC'; }).map(function (x) { return x.email; }), done = 0, failed = [], last = null;
                return people.reduce(function (pr, x, k) {
                    return pr.then(function () {
                        say('<i class="fa-solid fa-circle-notch fa-spin"></i> Sending ' + (k + 1) + ' of ' + people.length + ' — ' + esc(x.email) + '…');
                        var oo = Object.assign({}, o, { track: { pixel: FL.packTrack.pixelUrl(x.token), ack: FL.packTrack.ackUrl(x.token), copyFor: x.email + (x.kind === 'TO' ? '' : ' (' + x.kind.toLowerCase() + ')'), also: shown.filter(function (e) { return e !== x.email; }).join(', ') } });
                        return one(x.email, '', '', oo).then(function (r) { last = r; done++; return mark([x.token], 'SENT'); },
                            function (e) { failed.push({ email: x.email, error: String(e && e.message || e) }); return mark([x.token], 'FAILED', String(e && e.message || e)); });
                    });
                }, Promise.resolve()).then(function () {
                    if (!done) throw new Error('Not sent to anyone: ' + failed.map(function (f) { return f.email + ' — ' + f.error; }).join('; '));
                    return { r: last, ok: done, failed: failed };
                });
            });
        }).then(function (res) {
            var r = res.r;
            res.stamped = stamped; res.sha = sha; res.recorded = recorded; res.people = people;
            r.stamped = stamped; r.sha = sha; r.sendId = stamped.docId; r.sentTo = res.ok; r.failed = res.failed;
            // the e-mail as sent (one person's copy, its personal picture and button made inert) is kept with the record
            var keep = recorded && body ? FL.packTrack.saveBody(stamped.docId, body.replace(/pack\/px\/[0-9a-f]+/g, 'pack/px/0').replace(/pack\/ack\/[0-9a-f]+/g, 'pack/ack/0')).catch(function (e) { console.warn('[mail] e-mail text', e); }) : Promise.resolve();
            var arc = job.archive && r.result !== 'draft' ? keep.then(function () {
                say('<i class="fa-solid fa-circle-notch fa-spin"></i> Keeping the pack in the archive…');
                return FL.packArchive.save({ pack: pack, built: stamped, status: job.archive.status || 'ISSUED', comments: job.archive.comments || '', meeting: job.archive.meeting || '', event: 'EMAILED', detail: 'sent to ' + res.ok + ' of ' + people.length + ' via ' + via });
            }).then(function () { res.archived = true; }, function (e) { res.archiveError = String(e && e.message || e); }) : keep;
            return arc.then(function () {
                var txt = r.result === 'draft' ? 'Opened in Outlook — check it and press Send there.' : 'Sent' + (r.by ? ' from ' + r.by : '') + ' to ' + (track ? res.ok + ' of ' + people.length + ' people, one copy each' : job.to) + (res.failed.length ? ' — not sent to ' + res.failed.map(function (f) { return f.email; }).join(', ') : '');
                say('<span class="' + (res.failed.length ? 'neg' : 'pos') + '">' + (res.failed.length ? '⚠ ' : '✓ ') + esc(txt) + '</span>' + (res.failed.length ? '<div class="sm">' + res.failed.map(function (f) { return esc(f.email + ': ' + f.error); }).join('<br>') + '</div>' : '') +
                    (recorded ? '<div class="sm muted">Recorded in Board packs › Distribution' + (track ? ' — opens and confirmations show up there' : '') + (res.archived ? ' · the pack is kept in the archive' : res.archiveError ? ' · not archived: ' + esc(res.archiveError) : '') + '.</div>' : ''));
                FL.toast(txt, res.failed.length ? 'err' : 'ok');
                return res;
            });
        });
    };
    /** The e-mail options from the pack's saved choices (for sending without the dialog) */
    M.optsOf = function (pack, built) {
        var e = pack.email || {};
        return { intro: e.intro != null ? e.intro : FL.packs.newPack().email.intro, tiles: e.tiles !== false, keyLines: e.lines !== false, highlights: e.hl !== false,
            chart: e.chart !== false && built.model.trendPng ? 'cid:' + CID : null, logo: e.logo !== false && built.model.logo ? 'cid:' + LOGO : null, attached: e.attach !== false ? built.file : null, sections: built.sections };
    };
    M.previewOpts = function (o, built) { var p = Object.assign({}, o); if (p.chart) p.chart = built.model.trendPng; if (p.logo) p.logo = built.model.logo.png; return p; };
    M.subject = function (pack, built) { return P_subject(pack, built); };
    function P_subject(pack, built) { return String((pack.email || {}).subject || '{TITLE} · {PERIOD}').replace(/\{PERIOD\}/g, built.model.period).replace(/\{TITLE\}/g, pack.title || pack.name).replace(/\{COMPANY\}/g, pack.company || ''); }
    /** Keeps the subject as a template when only the period / title in it changed */
    function subjTemplate(pack, typed, built) {
        var t = (pack.email || {}).subject || '{TITLE} · {PERIOD}';
        return typed === P_subject(pack, built) ? t : typed.split(built.model.period).join('{PERIOD}');
    }

    // header button: e-mail setup
    (function () {
        var pk = $('b-pack'); if (!pk || $('b-mail')) return;
        var b = document.createElement('button'); b.className = 'btn'; b.id = 'b-mail'; b.title = 'E-mail setup';
        b.innerHTML = '<i class="fa-solid fa-envelope"></i><i class="fa-solid fa-gear ml-gear"></i>';
        pk.parentNode.insertBefore(b, pk.nextSibling);
        b.onclick = function () { M.setup(); };
        pk.onclick = function () { FL.show('packs'); };
        pk.title = 'Board packs: design them, download them as an interactive HTML file or e-mail them';
        setTimeout(function () { M.status().catch(function () { /* older host */ }); }, 1500);
    })();
})();
