/* AI Agent — phone calls (AI Hub + Twilio ConversationRelay). The Calls dialog places a call (the user confirms),
   shows live transcripts, messages and summaries, and holds the phone settings. While a call is live this page runs
   the read-only tools the caller's conversation asks for (same app user only) - that is how a PIN-verified caller
   gets answers from WMS / Fusion. */

var PHONE = window.PHONE = { active: 0, open: null };

PHONE.status = function () { return hub('GET', '/voice/phone'); };

// ── live calls: run the read tools a call waits for (every 1.5 s while a call is live, else check every 15 s) ──
PHONE.tick = function () {
    hub('GET', '/voice/phone').then(function (st) {
        PHONE.active = (st.active || []).length;
        var b = $('calls-badge'); if (b) { b.hidden = !PHONE.active; b.textContent = PHONE.active; }
        if (PHONE.active) PHONE.serve();
    }).catch(function () { PHONE.active = 0; }).then(function () { setTimeout(PHONE.tick, PHONE.active ? 1500 : 15000); });
};
PHONE.serve = function () {
    if (PHONE.serving) return;
    PHONE.serving = true;
    hub('GET', '/voice/calls/pending').then(function (pend) {
        return pend.reduce(function (p, snap) {
            var calls = (snap.waiting && snap.waiting.calls) || [], results = {};
            return p.then(function () {
                return calls.reduce(function (q, c) { return q.then(function () { return AG.execute(c, false).then(function (r) { results[c.id] = r; }, function (e) { results[c.id] = { ok: false, content: String(e) }; }); }); }, Promise.resolve())
                    .then(function () { return hub('POST', '/agent/threads/' + snap.thread_id + '/resume', { value: { results: results } }); });
            });
        }, Promise.resolve());
    }).catch(function () { }).then(function () { PHONE.serving = false; });
};

// ── the dialog ──
PHONE.show = function (tab) {
    PHONE.tab = tab || PHONE.tab || 'calls';
    Promise.all([PHONE.status(), hub('GET', '/voice/calls?limit=40')]).then(function (r) {
        var st = r[0], calls = r[1];
        var tabs = '<div class="seg" style="margin-bottom:10px">' + ['calls', 'new', 'settings'].map(function (t) { return '<button data-t="' + t + '" class="' + (t === PHONE.tab ? 'on' : '') + '">' + { calls: 'Calls', new: 'New call', settings: 'Settings' }[t] + '</button>'; }).join('') + '</div>';
        var banner = st.ready ? '<div class="pc-ok"><i class="fa-solid fa-circle-check"></i> Ready — calls from ' + esc(st.settings.from_number) + '</div>'
            : '<div class="pc-warn"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(st.why) + ' <a href="#" onclick="PHONE.show(\'settings\');return false">Settings</a></div>';
        var body = PHONE.tab === 'new' ? PHONE.newForm(st) : PHONE.tab === 'settings' ? PHONE.settingsForm(st) : PHONE.list(calls);
        openModal('Phone calls', banner + tabs + '<div id="pc-body">' + body + '</div>', PHONE.buttons());
        document.querySelectorAll('#modal-b .seg button').forEach(function (b) { b.onclick = function () { PHONE.show(b.dataset.t); }; });
        document.querySelectorAll('#modal-b .pc-row').forEach(function (rw) { rw.onclick = function () { PHONE.detail(rw.dataset.id); }; });
        if (PHONE.tab === 'settings') PHONE.wireSettings(st);
    }).catch(function (e) { toast('Calls: ' + e + ' — update the AI Hub (Help › Update) if this is new.', 'err'); });
};
PHONE.buttons = function () {
    if (PHONE.tab === 'new') return [{ label: '<i class="fa-solid fa-phone"></i> Call now', cls: 'primary', onClick: PHONE.place }, { label: 'Close', onClick: PHONE.close }];
    if (PHONE.tab === 'settings') return [{ label: '<i class="fa-solid fa-floppy-disk"></i> Save', cls: 'primary', onClick: PHONE.save }, { label: 'Close', onClick: PHONE.close }];
    return [{ label: '<i class="fa-solid fa-rotate"></i> Refresh', onClick: function () { PHONE.show('calls'); } }, { label: 'Close', onClick: PHONE.close }];
};
PHONE.close = function () { clearInterval(PHONE.live); closeModal(); };

PHONE.ST = { completed: 'b-ok', 'in-progress': 'b-info', ringing: 'b-warn', initiated: 'b-warn', queued: 'b-warn', busy: 'b-bad', 'no-answer': 'b-bad', failed: 'b-bad', canceled: 'b-muted' };
PHONE.list = function (calls) {
    if (!calls.length) return '<div class="empty"><i class="fa-solid fa-phone big"></i><p>No calls yet. Ask the agent ("call +230… and confirm tomorrow\'s delivery slot") or use New call.</p></div>';
    return '<div class="pc-list">' + calls.map(function (c) {
        var msg = c.message ? JSON.parse(c.message) : null;
        return '<div class="pc-row" data-id="' + esc(c.id) + '"><i class="fa-solid ' + (c.direction === 'inbound' ? 'fa-phone-volume' : 'fa-phone') + '"></i>' +
            '<div class="grow"><b>' + esc(c.name || c.number) + '</b> <span class="muted sm">' + esc(c.number) + ' · ' + new Date(c.started * 1000).toLocaleString() + (c.verified ? ' · verified ' + esc(c.app_user || '') : '') + '</span>' +
            '<div class="sm">' + esc(c.summary || c.goal || (msg ? 'Message: ' + msg.message : '') || '') + '</div>' + (msg ? '<div class="sm"><span class="tag b-warn">message</span> ' + esc([msg.name, msg.company, msg.callback].filter(Boolean).join(' · ')) + '</div>' : '') + '</div>' +
            '<span class="tag ' + (PHONE.ST[c.status] || 'b-muted') + '">' + esc(c.status) + '</span></div>';
    }).join('') + '</div>';
};
PHONE.detail = function (id) {
    var draw = function () {
        return hub('GET', '/voice/calls/' + id).then(function (c) {
            var live = /in-progress|ringing|initiated|queued/.test(c.status);
            $('pc-body').innerHTML = '<p><a href="#" onclick="PHONE.show(\'calls\');return false">‹ All calls</a></p>' +
                '<h4>' + esc(c.name || c.number) + ' <span class="tag ' + (PHONE.ST[c.status] || 'b-muted') + '">' + esc(c.status) + '</span>' + (live ? ' <button class="btn danger sm" onclick="PHONE.hangup(\'' + esc(c.id) + '\')"><i class="fa-solid fa-phone-slash"></i> Hang up</button>' : '') + '</h4>' +
                (c.goal ? '<p class="sm"><b>Goal:</b> ' + esc(c.goal) + '</p>' : '') + (c.summary ? '<div class="callout tip"><div class="co-t">Summary</div>' + md(c.summary) + '</div>' : '') +
                (c.message ? '<div class="callout warn"><div class="co-t">Message for the team</div>' + esc(Object.entries(JSON.parse(c.message)).filter(function (x) { return x[1]; }).map(function (x) { return x[0] + ': ' + x[1]; }).join(' · ')) + '</div>' : '') +
                (c.error ? '<p class="sm" style="color:#b91c1c">' + esc(c.error) + '</p>' : '') +
                '<div class="pc-tx">' + (c.transcript || []).map(function (t) { return '<div class="tx ' + t.who + '"><b>' + (t.who === 'agent' ? 'AI' : t.who === 'caller' ? 'Caller' : '') + '</b> ' + esc(t.text) + '</div>'; }).join('') + '</div>' +
                (c.thread_id ? '<p class="sm"><a href="#" onclick="PHONE.close();AG.open(\'' + esc(c.thread_id) + '\');return false">Open the conversation (tools it used)</a></p>' : '');
            var tx = document.querySelector('.pc-tx'); if (tx) tx.scrollTop = 1e9;
            if (!live) clearInterval(PHONE.live);
        });
    };
    clearInterval(PHONE.live);
    draw().then(function () { PHONE.live = setInterval(draw, 2000); }).catch(function (e) { toast(String(e), 'err'); });
};
PHONE.hangup = function (id) { hub('POST', '/voice/calls/' + id + '/hangup', {}).then(function () { toast('Hanging up…', 'ok'); }).catch(function (e) { toast(String(e), 'err'); }); };

PHONE.newForm = function (st) {
    return '<label class="sm">Number (international)<br><input type="tel" id="pc-to" placeholder="+230 5xxx xxxx" style="width:100%"></label>' +
        '<label class="sm">Who<br><input type="text" id="pc-name" placeholder="e.g. Mr Lee, Winners Mall" style="width:100%"></label>' +
        '<label class="sm">Goal — what the AI must achieve, and the facts it may share<br><textarea id="pc-goal" rows="4" style="width:100%" placeholder="Confirm the delivery of order SO1234 tomorrow between 9 and 11. If not possible, ask for a better slot."></textarea></label>' +
        '<label class="sm">Language<br><input type="text" id="pc-lang" value="' + esc(st.settings.language || 'en-US') + '"></label>' +
        '<p class="muted sm">The AI says it is an AI and that the call is transcribed. It cannot change anything during the call. Allowed prefixes: ' + esc((st.settings.allowed_prefixes || []).join(', ') || 'none') + ' · max ' + esc(st.settings.max_minutes) + ' min.</p>';
};
PHONE.place = function () {
    var to = $('pc-to').value.trim(), goal = $('pc-goal').value.trim();
    if (!to || !goal) { toast('Number and goal are needed', 'err'); return; }
    if (!confirm('Call ' + to + ' now? The AI will talk with them about:\n\n' + goal)) return;
    hub('POST', '/voice/call', { to: to, goal: goal, name: $('pc-name').value.trim(), language: $('pc-lang').value.trim() }).then(function (r) {
        toast('Calling ' + r.to + '…', 'ok'); PHONE.tab = 'calls'; PHONE.show('calls'); setTimeout(function () { PHONE.detail(r.call_id); }, 600);
    }).catch(function (e) { toast(String(e), 'err'); });
};

PHONE.settingsForm = function (st) {
    var p = st.settings, known = p.known || {};
    return '<div class="vgrid"><div>' +
        '<label class="row sm"><input type="checkbox" id="ps-on"' + (p.enabled ? ' checked' : '') + '> Phone calls on</label>' +
        '<label class="sm">Twilio Account SID<br><input type="text" id="ps-sid" value="' + esc(p.account_sid || '') + '" style="width:100%"></label>' +
        '<label class="sm">Twilio auth token ' + (st.auth_token ? '<span class="chip ok">set</span>' : '<span class="chip">not set</span>') + '<br><input type="password" id="ps-tok" placeholder="' + (st.auth_token ? 'leave empty to keep' : 'paste the token') + '" style="width:100%"></label>' +
        '<label class="sm">Twilio number (calls come from / to it)<br><input type="tel" id="ps-from" value="' + esc(p.from_number || '') + '" placeholder="+230…"></label>' +
        '<label class="sm">Public https address of the phone server (tunnel → 127.0.0.1:' + esc(p.port || 8101) + ')<br><input type="url" id="ps-url" value="' + esc(p.public_url || '') + '" placeholder="https://xxxx.trycloudflare.com" style="width:100%"></label>' +
        '<p class="muted sm">Run on this PC: <code>cloudflared tunnel --url http://localhost:' + esc(p.port || 8101) + '</code> and paste the https address. Only the Twilio routes are served there, each request is signature-checked.</p>' +
        '<button class="btn sm" id="ps-connect"><i class="fa-solid fa-link"></i> Point the Twilio number here</button> <span class="muted sm">' + esc(st.voice_url) + '</span>' +
        '</div><div>' +
        '<label class="sm">Incoming calls<br><select id="ps-in"><option value="off">Off — polite message, hang up</option><option value="known">Known numbers with PIN get answers, others leave a message</option><option value="everyone">Everyone leaves a message (no data)</option></select></label>' +
        '<label class="sm">Company name (greeting)<br><input type="text" id="ps-co" value="' + esc(p.company || '') + '"></label>' +
        '<label class="sm">Language<br><input type="text" id="ps-lang" value="' + esc(p.language || 'en-US') + '"></label>' +
        '<label class="sm">Call voice (Twilio)<br><select id="ps-ttsp">' + ['ElevenLabs', 'Google', 'Amazon'].map(function (x) { return '<option' + (x === p.tts_provider ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select> <input type="text" id="ps-voice" value="' + esc(p.voice || '') + '" placeholder="voice id (optional)"></label>' +
        '<label class="sm">Outbound allowed prefixes (comma)<br><input type="text" id="ps-pre" value="' + esc((p.allowed_prefixes || []).join(', ')) + '"></label>' +
        '<label class="sm">Max minutes per call<br><input type="number" id="ps-max" min="1" max="60" value="' + esc(p.max_minutes || 10) + '"></label>' +
        '</div></div>' +
        '<h4 style="margin-top:12px">Known numbers (PIN-verified callers get read-only answers as that app user)</h4><table class="t"><thead><tr><th>Number</th><th>App user</th><th>PIN</th><th></th></tr></thead><tbody>' +
        Object.keys(known).map(function (n) { return '<tr><td>' + esc(n) + '</td><td>' + esc(known[n].user) + '</td><td>' + (known[n].pin ? '••••' : '<span class="tag b-bad">none</span>') + '</td><td><button class="icon" onclick="PHONE.known(\'' + esc(n) + '\', null)"><i class="fa-solid fa-trash"></i></button></td></tr>'; }).join('') +
        '<tr><td><input type="tel" id="pk-n" placeholder="+230…"></td><td><input type="text" id="pk-u" placeholder="APP USER" value="' + esc(appUser()) + '"></td><td><input type="password" id="pk-p" placeholder="4-8 digits" inputmode="numeric"></td><td><button class="btn sm" onclick="PHONE.known()">Add</button></td></tr></tbody></table>' +
        '<p class="muted sm">After switching calls on or changing the port, restart the AI Hub (server button). Read tools during a call run in your open AI Agent page — keep it open.</p>';
};
PHONE.wireSettings = function (st) {
    $('ps-in').value = st.settings.inbound || 'known';
    $('ps-connect').onclick = function () { PHONE.save(true).then(function () { return hub('POST', '/voice/phone/connect-number', {}); }).then(function (r) { toast('Twilio number now calls ' + r.voice_url, 'ok'); }).catch(function (e) { toast(String(e), 'err'); }); };
};
PHONE.save = function (quiet) {
    var tok = $('ps-tok').value.trim();
    return (tok ? hub('PUT', '/voice/secret', { name: 'twilio.auth_token', value: tok }) : Promise.resolve()).then(function () {
        return hub('PUT', '/voice/phone', { phone: {
            enabled: $('ps-on').checked, account_sid: $('ps-sid').value.trim(), from_number: $('ps-from').value.replace(/\s+/g, ''), public_url: $('ps-url').value.trim().replace(/\/+$/, ''),
            inbound: $('ps-in').value, company: $('ps-co').value.trim(), language: $('ps-lang').value.trim(), tts_provider: $('ps-ttsp').value, voice: $('ps-voice').value.trim(),
            allowed_prefixes: $('ps-pre').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean), max_minutes: parseInt($('ps-max').value, 10) || 10 } });
    }).then(function (r) { if (quiet !== true) { toast('Phone settings saved' + (r.ready ? '' : ' — ' + r.why), r.ready ? 'ok' : ''); PHONE.show('settings'); } return r; })
        .catch(function (e) { toast(String(e), 'err'); throw e; });
};
PHONE.known = function (number, user) {
    var n = number || $('pk-n').value.replace(/\s+/g, ''), u = number ? user : $('pk-u').value.trim().toUpperCase(), pin = number ? null : $('pk-p').value.trim();
    if (!number && (!n || !u || !pin)) { toast('Number, app user and PIN are needed', 'err'); return; }
    hub('POST', '/voice/phone/known', { number: n, user: u, pin: pin }).then(function () { PHONE.show('settings'); }).catch(function (e) { toast(String(e), 'err'); });
};

// confirm card of the agent's phone_call tool
AG.preview.phone_call = function (i) {
    return '<div class="why"><i class="fa-solid fa-phone"></i> Call <b>' + esc(i.name || i.to) + '</b> (' + esc(i.to) + ') — the AI talks with them itself:</div><pre>' + esc(i.goal || '') + '</pre>' +
        '<div class="muted sm">It says it is an AI and the call is transcribed; it cannot change anything during the call.</div>';
};

setTimeout(PHONE.tick, 5000);
