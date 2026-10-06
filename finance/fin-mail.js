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
    var CID = 'trend@financelens';

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
                '<label><input type="checkbox" id="mc-att"' + (e.attach !== false ? ' checked' : '') + '> attach the interactive pack <span class="muted">(' + esc(built.file) + ', ' + Math.round(built.html.length / 1024) + ' KB)</span></label></div>' +
                '<div class="row ml-send"><label class="sm">Send with <select id="mc-how">' + ['OUTLOOK', 'GRAPH', 'SMTP'].map(function (k) { return '<option value="' + k + '"' + (k === me ? ' selected' : '') + '>' + METHODS[k].name + '</option>'; }).join('') + '</select></label>' +
                '<button class="btn sm ghost" onclick="FL.mail.setup()" title="E-mail setup"><i class="fa-solid fa-gear"></i></button>' + (ok ? '' : '<span class="tag warn">not set up</span>') + '<span class="grow"></span>' +
                (M.st && M.st.outlook ? '<button class="btn" id="mc-review" title="Open the message in Outlook to check it and send it yourself"><i class="fa-brands fa-microsoft"></i> Open in Outlook</button>' : '') +
                '<button class="btn primary" id="mc-send"><i class="fa-solid fa-paper-plane"></i> Send</button></div><div id="mc-msg" class="sm"></div></div>' +
                '<div class="ml-prev"><div class="sm muted" style="margin-bottom:4px"><i class="fa-regular fa-eye"></i> How the message looks</div><iframe id="mc-f" title="Message preview"></iframe></div></div>');
            var opts = function (forSend) {
                return { intro: $('mc-intro').value, tiles: $('mc-tiles').checked, keyLines: $('mc-lines').checked, highlights: $('mc-hl').checked,
                    chart: $('mc-chart').checked && built.model.trendPng ? (forSend ? 'cid:' + CID : built.model.trendPng) : null, attached: $('mc-att').checked ? built.file : null, sections: built.sections };
            };
            var paint = function () { $('mc-f').srcdoc = FL.packs.emailHtml(pack, built.model, opts(false)).html; };
            ['mc-intro', 'mc-tiles', 'mc-lines', 'mc-chart', 'mc-hl', 'mc-att'].forEach(function (id) { $(id).oninput = $(id).onchange = function () { clearTimeout(M._pt); M._pt = setTimeout(paint, 250); }; });
            paint();
            var send = function (how, display) {
                var o = opts(true), mail = FL.packs.emailHtml(pack, built.model, o), att = [];
                if (o.attached) att.push({ name: built.file, contentType: 'text/html', base64: b64(built.html) });
                if (o.chart) att.push({ name: 'trend.png', contentType: 'image/png', cid: CID, base64: built.model.trendPng.split(',')[1] });
                var to2 = $('mc-to').value.trim();
                if (!to2 && !(how === 'OUTLOOK' && display)) { FL.toast('Add at least one recipient', 'err'); $('mc-to').focus(); return; }
                Object.assign(pack.email, { to: to2, cc: $('mc-cc').value.trim(), bcc: $('mc-bcc').value.trim(), subject: subjTemplate(pack, $('mc-subj').value, built), intro: $('mc-intro').value,
                    tiles: $('mc-tiles').checked, lines: $('mc-lines').checked, chart: $('mc-chart').checked, hl: $('mc-hl').checked, attach: $('mc-att').checked });
                var btns = document.querySelectorAll('#mc-send, #mc-review'); btns.forEach(function (b) { b.disabled = true; });
                $('mc-msg').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> ' + (display ? 'Opening Outlook…' : 'Sending…');
                FL.call('finMailSend', { method: how, display: !!display, to: to2, cc: pack.email.cc, bcc: pack.email.bcc, subject: $('mc-subj').value, html: mail.html, attachments: att }, 600000).then(function (r) {
                    var txt = r.result === 'draft' ? 'Opened in Outlook — check it and press Send there.' : 'Sent' + (r.by ? ' from ' + r.by : '') + ' to ' + to2;
                    $('mc-msg').innerHTML = '<span class="pos">✓ ' + esc(txt) + '</span>'; FL.toast(txt, 'ok');
                    if (onSent) onSent(r);
                    if (r.result !== 'draft') setTimeout(FL.closeModal, 1200);
                }).catch(function (e2) { $('mc-msg').innerHTML = '<span class="neg">✗ ' + esc(String(e2 && e2.message || e2)) + '</span>'; })
                    .then(function () { btns.forEach(function (b) { b.disabled = false; }); });
            };
            $('mc-send').onclick = function () { send($('mc-how').value, false); };
            if ($('mc-review')) $('mc-review').onclick = function () { send('OUTLOOK', true); };
        };
        (M.st ? Promise.resolve() : M.status().catch(function () { M.st = { settings: {}, recent: [] }; })).then(go);
    };
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
