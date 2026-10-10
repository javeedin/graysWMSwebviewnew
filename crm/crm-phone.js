/* Customer CRM · the softphone and the call log.
 * The CRM is the call record, not the telephone line: a call is placed or answered on the PC's softphone or desk phone and the
 * CRM pops the customer, times it, records the microphone on request, keeps notes, an outcome, a callback and the link to a
 * ticket, and writes one row to WMS_CRM_CALLS. Adapters (Setup › Phone):
 *   manual   you dial on the phone; Call starts the timer
 *   uri      Call hands the number to the PC's softphone (host crmDial: tel: / sip: / callto:) — Teams, Zoiper, MicroSIP, 3CX …
 *   listener the host listens on 127.0.0.1 (crmCtiStart); the softphone calls http://127.0.0.1:<port>/call?event=ring&from=…&key=…
 *            on ring / answer / hangup / missed / dial — incoming calls pop here with the customer, missed ones are logged
 * C.phone.register(name, adapter) adds another (e.g. a WebRTC SIP client) without touching the rest. */
(function () {
    'use strict';
    var C = window.CRM, E = C.E, S = C.S, D = C.D, esc = C.esc;
    function $(id) { return document.getElementById(id); }
    var P = C.phone = { num: '', call: null, last: 0, poll: 0, adapters: {} };

    P.register = function (name, a) { P.adapters[name] = a; };
    P.register('manual', { label: 'Desk phone — I dial, the CRM times and logs', dial: function () { return Promise.resolve(); } });
    P.register('uri', { label: 'Softphone on this PC (tel: / sip: / callto: link)', dial: function (num) { var sch = (C.setup.phone.scheme || 'tel'); return D.call('crmDial', { uri: sch + ':' + E.phone(num, C.setup.phone.country).e164.replace(/^\+/, sch === 'tel' ? '+' : '') }, 15000); } });
    function adapter() { return P.adapters[C.setup.phone.adapter] || P.adapters.manual; }

    // ── panel ──
    C.ACT.phoneToggle = function () { if ($('phone').hidden) P.open({}); else { $('phone').hidden = true; } };
    C.ACT.phoneOpen = function () { P.open({}); };
    C.ACT.dialNum = function (el) { P.open({ number: el.dataset.num, account: el.dataset.acct, contact: el.dataset.contact, ticketId: el.dataset.ticket }); };
    P.open = function (o) {
        o = o || {};
        if (!P.call || P.call.state === 'idle') { if (o.number != null) P.num = o.number; P.ctx = o; }
        $('phone').hidden = false; paint();
        if (!P.call && P.num) lookup(P.num);
    };
    P.dial = function (num, ctx) { P.open(Object.assign({ number: num }, ctx || {})); C.ACT.phCall(); };

    function cust() { var c = P.call || {}; return c.cust || (P.match && P.match[0]) || null; }
    function lookup(num) {
        var p = E.phone(num, C.setup.phone.country); P.match = null;
        if (!p.last7 || p.last7.length < 7) { paint(); return Promise.resolve([]); }
        var local = E.phoneLookup(num, C.phoneIndex(), C.setup.phone.country);
        if (P.ctx && P.ctx.account) local.unshift({ account: P.ctx.account, bu: P.ctx.bu || C.buOf(P.ctx.account), name: P.ctx.name || (C.master[P.ctx.account] || {}).CUSTOMER || '', contact: P.ctx.contact });
        var seen = {}; P.match = local.filter(function (x) { if (seen[x.account]) return false; seen[x.account] = 1; return true; });
        paint();
        if (P.match.length || !D.hasHost()) return Promise.resolve(P.match);
        P.looking = true; paint();
        return C.fusionFirst(E.sql.phone(p.last7), 20).then(function (r) {
            P.match = r.rows.map(function (x) { return { account: x.ACCOUNT_NUMBER, bu: C.buOf(x.ACCOUNT_NUMBER), name: x.CUSTOMER, phone: x.PHONE, source: 'Fusion' }; });
            if (P.match.length) S.duck.put('w2_crm_phone', { last7: p.last7, source: 'Fusion' }, P.match.map(function (m) { return { phone: m.phone, last7: p.last7, bu: m.bu, account: m.account, name: m.name, contact: '', source: 'Fusion', read_at: S.now() }; }));
            return P.match;
        }, function () { return []; }).then(function (m) { P.looking = false; if (P.call && !P.call.cust && m.length) P.call.cust = m[0]; paint(); return m; });
    }
    function timer() { var c = P.call; if (!c || !c.answeredAt) return '0:00'; return E.secs(((c.endedAt ? c.endedAt : new Date()) - c.answeredAt) / 1000); }
    function paint() {
        var el = $('phone'); if (el.hidden) { dot(); return; }
        var c = P.call, cu = cust(), live = c && (c.state === 'live' || c.state === 'dialing' || c.state === 'ringing');
        var head = '<div class="ph"><i class="fas fa-phone"></i> ' + (c ? (c.dir === 'IN' ? 'Incoming call' : 'Call') : 'Phone') + '<span class="sp"></span><span class="muted small">' + esc(adapter().label.split(' — ')[0]) + '</span><button data-act="phoneToggle" title="Hide"><i class="fas fa-minus"></i></button></div>';
        var who = cu ? '<div class="who2"><b>' + esc(cu.name || cu.account) + '</b>' + (cu.contact ? ' · ' + esc(cu.contact) : '') + '<div class="muted small">' + esc(cu.account) + ' · ' + openTickets(cu.account) + '</div><a data-act="phone360">Open the customer</a> · <a data-act="phTicket">New ticket</a></div>' +
            (P.match && P.match.length > 1 && !c ? '<div class="muted small">' + (P.match.length - 1) + ' more customers with this number: ' + P.match.slice(1, 4).map(function (m, i) { return '<a data-act="phPick" data-i="' + (i + 1) + '">' + esc(m.name || m.account) + '</a>'; }).join(', ') + '</div>' : '')
            : P.looking ? '<div class="who2 muted"><span class="spin"></span> looking up the number…</div>' : P.num && E.phone(P.num).last7.length >= 7 ? '<div class="who2 muted">Unknown number · <a data-act="phTicket">New ticket</a></div>' : '';
        var body;
        if (!c || c.state === 'idle') {
            body = '<input class="num" id="ph-num" data-in="phNum" value="' + esc(P.num) + '" placeholder="Number">' + who +
                '<div class="pad">' + '123456789*0#'.split('').map(function (k) { return '<button data-act="phKey" data-k="' + k + '">' + k + '</button>'; }).join('') + '</div>' +
                ((P.ctx && P.ctx.numbers && P.ctx.numbers.length > 1) ? '<div class="muted small" style="margin-bottom:6px">Other numbers: ' + P.ctx.numbers.map(function (n) { return '<a data-act="phSet" data-n="' + esc(n) + '">' + esc(n) + '</a>'; }).join(' · ') + '</div>' : '') +
                '<button class="call" data-act="phCall"' + (P.num ? '' : ' disabled') + '><i class="fas fa-phone"></i> Call</button>' +
                '<div class="row2"><button data-act="go" data-tab="calls"><i class="fas fa-list"></i> Call log</button><button data-act="phLogIn"><i class="fas fa-phone-volume"></i> Log an incoming call</button></div>';
        } else if (live) {
            body = '<div class="timer" id="ph-timer">' + timer() + '</div><div class="st">' + esc({ dialing: 'dialling ' + c.number, ringing: 'ringing · ' + c.number, live: (c.dir === 'IN' ? 'from ' : 'with ') + c.number }[c.state]) + '</div>' + who +
                (c.state === 'ringing' ? '<button class="call" data-act="phAnswer"><i class="fas fa-phone"></i> Answer</button><div class="row2"><button data-act="phMissed">Missed / declined</button></div>'
                    : c.state === 'dialing' ? '<button class="call" data-act="phConnected"><i class="fas fa-check"></i> They answered</button><div class="row2"><button data-act="phNoAnswer" data-o="NO_ANSWER">No answer</button><button data-act="phNoAnswer" data-o="BUSY">Busy</button><button data-act="phNoAnswer" data-o="VOICEMAIL">Voicemail</button></div>'
                        : '<div class="row2"><button data-act="phRec" class="' + (c.rec ? 'on' : '') + '"><i class="fas fa-circle"></i> ' + (c.rec ? 'Recording' : 'Record') + '</button></div><label>Notes during the call</label><textarea id="ph-notes" rows="3" data-in="phNotes">' + esc(c.notes || '') + '</textarea><button class="call end" style="margin-top:8px" data-act="phHang"><i class="fas fa-phone-slash"></i> End call</button>');
        } else {
            body = '<div class="timer">' + timer() + '</div><div class="st">call ended · ' + esc(c.number) + '</div>' + who +
                '<label>Outcome</label><select id="ph-out">' + Object.keys(E.CALL_OUTCOMES).map(function (k) { return '<option value="' + k + '"' + (k === c.outcome ? ' selected' : '') + '>' + esc(E.CALL_OUTCOMES[k]) + '</option>'; }).join('') + '</select>' +
                '<label>What was it about</label><select id="ph-disp"><option value="">—</option>' + C.setup.categories.map(function (k) { return '<option' + (k.name === c.disposition ? ' selected' : '') + '>' + esc(k.name) + '</option>'; }).join('') + '</select>' +
                '<label>Notes</label><textarea id="ph-notes" rows="3" data-in="phNotes">' + esc(c.notes || '') + '</textarea>' +
                '<label>Call back</label><input type="datetime-local" id="ph-cb">' +
                (c.ticketId ? '<div class="muted small" style="margin-top:6px">Linked to ticket ' + esc(c.ticketNo || '') + '</div>' : '<label class="chk" style="margin-top:8px;color:#e2e8f0"><input type="checkbox" id="ph-mkt"> make a ticket from it</label>') +
                (c.recBlob ? '<div class="muted small" style="margin-top:6px"><i class="fas fa-circle" style="color:#f43f5e"></i> recording ' + Math.round(c.recBlob.size / 1024) + ' KB — saved with the call</div>' : '') +
                '<button class="call" style="margin-top:10px" data-act="phSave"><i class="fas fa-check"></i> Save the call</button><div class="row2"><button data-act="phDiscard">Discard</button></div>';
        }
        el.innerHTML = head + '<div class="pb">' + body + '</div>';
        dot();
    }
    function dot() { var d = $('phonedot'); if (!d) return; var c = P.call; d.className = 'dot' + (c && c.state !== 'idle' && c.state !== 'wrap' ? ' live' : P.cti ? ' on' : ''); }
    function openTickets(acct) { var n = C.tickets.filter(function (t) { return t.ACCOUNT_NUMBER === acct && E.isOpen(t); }).length; return n ? n + ' open ticket' + (n === 1 ? '' : 's') : 'no open tickets'; }
    setInterval(function () { var t = $('ph-timer'); if (t) t.textContent = timer(); }, 1000);

    C.IN.phNum = function (el) { P.num = el.value; clearTimeout(P.lt); P.lt = setTimeout(function () { lookup(P.num).then(function () { C.keepFocus('ph-num', function () { }); }); }, 400); var b = document.querySelector('#phone .call'); if (b) b.disabled = !P.num; };
    C.IN.phNotes = function (el) { if (P.call) P.call.notes = el.value; };
    C.ACT.phKey = function (el) { P.num += el.dataset.k; var i = $('ph-num'); if (i) i.value = P.num; C.IN.phNum({ value: P.num }); };
    C.ACT.phSet = function (el) { P.num = el.dataset.n; lookup(P.num); };
    C.ACT.phPick = function (el) { var m = P.match.splice(+el.dataset.i, 1)[0]; P.match.unshift(m); paint(); };
    C.ACT.phone360 = function () { var cu = cust(); if (cu) C.open360(cu.bu, cu.account, cu.name); };
    C.ACT.phTicket = function () {
        var c = P.call || {}, cu = cust();
        if (c.state === 'wrap' || c.state === 'live') c.wantTicket = true;
        C.newTicket({ account: cu && cu.account, bu: cu && cu.bu, name: cu && cu.name, contact: cu && cu.contact, phone: c.number || P.num, channel: 'PHONE', description: c.notes || '' });
        if (C.nt && c.id) C.nt.callId = c.id;
    };

    function newCall(dir, number, extra) {
        if (P.call && P.call.state === 'wrap') saveCall(true);
        var p = E.phone(number, C.setup.phone.country);
        P.call = Object.assign({ id: 'cl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), dir: dir, number: number, e164: p.e164, startedAt: new Date(), state: dir === 'IN' ? 'ringing' : 'dialing', cust: P.match && P.match[0], ticketId: P.ctx && P.ctx.ticketId }, extra || {});
        if (P.call.ticketId) { var t = C.tickets.filter(function (x) { return x.TICKET_ID === P.call.ticketId; })[0]; if (t) P.call.ticketNo = t.TICKET_NO; }
        return P.call;
    }
    C.ACT.phCall = function () {
        var num = (P.num || '').trim(); if (!num) return;
        newCall('OUT', num);
        paint();
        adapter().dial(num).catch(function (e) { C.toast('The softphone did not take the number: ' + C.errText(e), 'bad', 7000); });
        if (!P.call.cust) lookup(num);
    };
    C.ACT.phConnected = function () { var c = P.call; c.state = 'live'; c.answeredAt = new Date(); c.outcome = 'ANSWERED'; paint(); autoRecord(); };
    C.ACT.phAnswer = function () { var c = P.call; c.state = 'live'; c.answeredAt = new Date(); c.outcome = 'ANSWERED'; $('ringbox').hidden = true; paint(); autoRecord(); var cu = cust(); if (cu) C.open360(cu.bu, cu.account, cu.name); };
    C.ACT.phNoAnswer = function (el) { var c = P.call; c.state = 'wrap'; c.endedAt = new Date(); c.outcome = el.dataset.o; paint(); };
    C.ACT.phMissed = function () { var c = P.call; c.state = 'wrap'; c.endedAt = new Date(); c.outcome = 'MISSED'; $('ringbox').hidden = true; paint(); };
    C.ACT.phHang = function () { hang(); };
    function hang() { var c = P.call; if (!c) return; c.state = 'wrap'; c.endedAt = new Date(); stopRec(); $('phone').hidden = false; paint(); }
    C.ACT.phLogIn = function () { var num = (P.num || '').trim(); newCall('IN', num || 'unknown'); P.call.state = 'live'; P.call.answeredAt = new Date(); P.call.outcome = 'ANSWERED'; paint(); };
    C.ACT.phDiscard = function () { if (!window.confirm('Discard this call without saving it?')) return; stopRec(); P.call = null; P.num = ''; paint(); };
    C.ACT.phSave = function () { saveCall(false); };

    // ── recording (the microphone of this PC; the other side is heard only through the speakers — use the softphone's own recording for both sides) ──
    function autoRecord() { if (C.setup.phone.record) C.ACT.phRec(); }
    C.ACT.phRec = function () {
        var c = P.call; if (!c) return;
        if (c.rec) { stopRec(); paint(); return; }
        if (!navigator.mediaDevices || !window.MediaRecorder) { C.toast('This browser cannot record', 'bad'); return; }
        if (C.setup.phone.consent) C.toast('Tell the customer: ' + C.setup.phone.consent, 'warn', 7000);
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            var mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
            var r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), chunks = [];
            r.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
            r.onstop = function () { stream.getTracks().forEach(function (t) { t.stop(); }); c.recBlob = new Blob(chunks, { type: 'audio/webm' }); c.rec = null; paint(); };
            r.start(1000); c.rec = r; paint();
        }, function (e) { C.toast('Microphone: ' + C.errText(e), 'bad', 7000); });
    };
    function stopRec() { var c = P.call; if (c && c.rec && c.rec.state !== 'inactive') try { c.rec.stop(); } catch (e) { } }

    /** one row per call; the recording goes to C:\fusion\crm\recordings first (its path + SHA-256 in the row) */
    function saveCall(quiet) {
        var c = P.call; if (!c) return Promise.resolve();
        var v = function (id, d) { var x = $(id); return x ? x.value : d; };
        c.outcome = v('ph-out', c.outcome || 'ANSWERED'); c.disposition = v('ph-disp', c.disposition || ''); c.notes = v('ph-notes', c.notes || '');
        var cb = v('ph-cb', ''), mk = $('ph-mkt') && $('ph-mkt').checked, cu = cust();
        var row = { id: c.id, direction: c.dir, number: c.number, e164: c.e164, buId: cu && cu.bu, account: cu && cu.account, name: cu && cu.name, contact: cu && cu.contact, machine: (C.info || {}).machine,
            startedAt: c.startedAt, answeredAt: c.answeredAt, endedAt: c.endedAt || new Date(), duration: c.answeredAt ? Math.round(((c.endedAt || new Date()) - c.answeredAt) / 1000) : 0,
            outcome: c.outcome, disposition: c.disposition, notes: c.notes, ticketId: c.ticketId, source: c.source || (C.setup.phone.adapter === 'uri' ? 'SOFTPHONE' : 'MANUAL'), externalId: c.externalId, callbackAt: cb ? cb.replace('T', ' ') : null };
        P.call = null; P.num = ''; P.match = null; if (!quiet) $('phone').hidden = true; paint();
        var end = quiet ? function () { } : C.busy('Saving the call…');
        return S.calls.add(row).then(function () {
            if (!c.recBlob || !D.hasHost()) return;
            return blobB64(c.recBlob).then(function (b64) { return D.call('crmSaveRecording', { callId: c.id, base64: b64, ext: 'webm' }, 300000); })
                .then(function (r) { return S.calls.set(c.id, { recording_path: r.path, recording_sha: r.sha256, recording_bytes: r.bytes }); })
                .catch(function (e) { C.toast('The recording was not saved: ' + C.errText(e), 'bad', 8000); });
        }).then(function () {
            if (c.ticketId) return S.events.add({ ticketId: c.ticketId, kind: 'CALL', body: (c.dir === 'IN' ? 'Call from ' : 'Call to ') + c.number + ' · ' + (E.CALL_OUTCOMES[row.outcome] || row.outcome) + ' · ' + E.secs(row.duration) + (row.notes ? '\n' + row.notes : ''), visibility: 'INTERNAL' })
                .then(function () { var t = C.tickets.filter(function (x) { return x.TICKET_ID === c.ticketId; })[0]; if (t && c.dir === 'OUT' && row.outcome === 'ANSWERED') return C.markReplied(t); });
        }).then(function () { end(); if (!quiet) C.toast('Call saved', 'ok'); return C.loadCore(); }).then(function () {
            if (mk) { C.newTicket({ account: row.account, bu: row.buId, name: row.name, phone: row.number, channel: 'PHONE', description: row.notes, category: row.disposition }); C.nt.callId = c.id; }
            if (C.tab === 'calls' || C.tab === 'today') C.render();
        }, function (e) { end(); C.toast('The call was not saved: ' + C.errText(e), 'bad', 9000); });
    }
    function blobB64(b) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(b); }); }
    C.blobB64 = blobB64;

    // ── incoming (listener events, or a test from Setup) ──
    P.incoming = function (ev) {
        if (P.call && P.call.state !== 'wrap' && P.call.state !== 'idle') return;
        P.num = ev.from || ''; P.ctx = {};
        newCall('IN', ev.from || 'unknown', { source: ev.test ? 'TEST' : 'CTI', externalId: ev.id });
        lookup(P.num).then(function () { if (P.call && !P.call.cust && P.match && P.match[0]) P.call.cust = P.match[0]; paintRing(); paint(); });
        paintRing(); $('phone').hidden = false; paint();
        try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play(); } catch (e) { }
    };
    function paintRing() {
        var c = P.call, box = $('ringbox'); if (!c || c.state !== 'ringing') { box.hidden = true; return; }
        var cu = cust();
        box.innerHTML = '<div class="row"><i class="fas fa-phone-volume" style="color:#16a34a;font-size:22px"></i><div><div class="big">' + esc(cu ? cu.name || cu.account : c.number) + '</div><div class="small muted">' + esc(c.number) + (cu ? ' · ' + esc(cu.account) + ' · ' + openTickets(cu.account) : P.looking ? ' · looking up…' : ' · unknown number') + '</div></div></div>' +
            '<div class="qa"><button class="btn ok" data-act="phAnswer"><i class="fas fa-phone"></i> Answer</button>' + (cu ? '<button class="btn" data-act="phone360">Open the customer</button>' : '') + '<button class="btn" data-act="phMissed">Missed</button></div>';
        box.hidden = false;
    }
    function onCti(ev) {
        var c = P.call;
        if (ev.event === 'ring') return P.incoming(ev);
        if (ev.event === 'dial') { P.num = ev.to || ''; newCall('OUT', ev.to || '', { source: 'CTI', externalId: ev.id }); lookup(P.num); $('phone').hidden = false; return paint(); }
        if (!c) { if (ev.event === 'missed') S.calls.add({ id: 'cl' + Date.now().toString(36), direction: 'IN', number: ev.from, e164: E.phone(ev.from, C.setup.phone.country).e164, startedAt: new Date(), endedAt: new Date(), duration: 0, outcome: 'MISSED', source: 'CTI', externalId: ev.id, machine: (C.info || {}).machine }).then(C.loadCore).then(C.render); return; }
        if (ev.event === 'answer' && c.state !== 'live') { c.state = 'live'; c.answeredAt = new Date(); c.outcome = 'ANSWERED'; $('ringbox').hidden = true; autoRecord(); }
        if (ev.event === 'hangup') { if (c.state === 'ringing') c.outcome = 'MISSED'; else if (c.state === 'dialing') c.outcome = 'NO_ANSWER'; $('ringbox').hidden = true; hang(); return; }
        if (ev.event === 'missed') { c.outcome = 'MISSED'; $('ringbox').hidden = true; hang(); return; }
        paint();
    }
    P.ctiStart = function () {
        var ph = C.setup.phone;
        if (!ph.listen || !D.hasHost()) return Promise.resolve(null);
        return D.call('crmCtiStart', { port: +ph.ctiPort || 8765, key: ph.ctiKey || '' }, 15000).then(function (r) {
            P.cti = r.cti; P.last = Math.max(P.last, (r.cti && r.cti.last) || 0); dot();
            clearInterval(P.poll);
            P.poll = setInterval(function () {
                D.host('crmCtiPoll', { after: P.last }, 8000).then(function (r2) { (r2.events || []).forEach(function (ev) { P.last = Math.max(P.last, ev.seq); onCti(ev); }); P.cti = r2.cti; }).catch(function () { });
            }, 1500);
            return r.cti;
        }, function (e) { P.cti = null; dot(); C.toast('Call listener: ' + C.errText(e), 'bad', 8000); return null; });
    };
    P.ctiStop = function () { clearInterval(P.poll); P.cti = null; dot(); return D.call('crmCtiStop', {}, 10000).catch(function () { }); };
    P.boot = function () { P.ctiStart(); };
    P.test = function (num) { P.incoming({ event: 'ring', from: num, test: true }); };

    // ── the call log (tab Calls) ──
    C.callTable = function (list) {
        return C.table([
            [function (c) { return '<i class="fas ' + (c.DIRECTION === 'IN' ? 'fa-arrow-down-left' : 'fa-arrow-up-right') + '" style="color:' + (c.OUTCOME === 'MISSED' ? 'var(--bad)' : c.DIRECTION === 'IN' ? 'var(--ok)' : 'var(--acc)') + '" title="' + (c.DIRECTION === 'IN' ? 'incoming' : 'outgoing') + '"></i>'; }, ''],
            [function (c) { return esc(c.STARTED_AT); }, 'When'],
            [function (c) { return c.ACCOUNT_NUMBER ? '<a data-act="open360" data-bu="' + esc(c.BU_ID || '') + '" data-acct="' + esc(c.ACCOUNT_NUMBER) + '" data-name="' + esc(c.ACCOUNT_NAME || '') + '">' + esc(c.ACCOUNT_NAME || c.ACCOUNT_NUMBER) + '</a>' : '<span class="muted">unknown</span>'; }, 'Customer'],
            [function (c) { return '<a data-act="dialNum" data-num="' + esc(c.NUMBER_RAW) + '" data-acct="' + esc(c.ACCOUNT_NUMBER || '') + '">' + esc(c.NUMBER_RAW || '') + '</a>'; }, 'Number'],
            [function (c) { return C.pill(esc(E.CALL_OUTCOMES[c.OUTCOME] || c.OUTCOME || ''), c.OUTCOME === 'ANSWERED' ? 'ok' : c.OUTCOME === 'MISSED' ? 'bad' : 'warn'); }, 'Outcome'],
            [function (c) { return c.DURATION_S ? E.secs(c.DURATION_S) : ''; }, 'Talk', 'r'],
            ['AGENT', 'Agent'], [function (c) { return esc(c.DISPOSITION || ''); }, 'About'],
            [function (c) { return '<span class="cut" title="' + esc(c.NOTES || '') + '">' + esc(c.NOTES || '') + '</span>'; }, 'Notes'],
            [function (c) { return c.CALLBACK_AT ? C.pill((c.CALLBACK_DONE === 'Y' ? '✓ ' : '') + esc(c.CALLBACK_AT), c.CALLBACK_DONE === 'Y' ? 'ok' : c.CALLBACK_AT.slice(0, 10) <= C.today() ? 'bad' : 'info') : ''; }, 'Call back'],
            [function (c) { return (c.TICKET_ID ? '<button class="btn sm ghost" data-act="openTicket" data-id="' + esc(c.TICKET_ID) + '" title="Ticket"><i class="fas fa-ticket"></i></button>' : '') + (c.RECORDING_PATH ? '<button class="btn sm ghost" data-act="playRec" data-path="' + esc(c.RECORDING_PATH) + '" data-sha="' + esc(c.RECORDING_SHA || '') + '" title="Play the recording"><i class="fas fa-play"></i></button>' : ''); }, '', 'r']
        ], list, { empty: 'No calls.' });
    };
    C.views.calls = function () {
        var f = C.cl.f, from = C.addDays(-(+f.days || 7) + 1), q = String(f.q || '').toLowerCase();
        var list = C.calls.filter(function (c) {
            if (String(c.STARTED_AT).slice(0, 10) < from) return false;
            if (f.dir && c.DIRECTION !== f.dir) return false; if (f.outcome && c.OUTCOME !== f.outcome) return false;
            if (q && (c.ACCOUNT_NAME + ' ' + c.NUMBER_RAW + ' ' + c.NOTES + ' ' + c.AGENT + ' ' + c.CONTACT_NAME).toLowerCase().indexOf(q) < 0) return false;
            return true;
        });
        var inN = list.filter(function (c) { return c.DIRECTION === 'IN'; }).length, miss = list.filter(function (c) { return c.OUTCOME === 'MISSED'; }).length, ans = list.filter(function (c) { return c.OUTCOME === 'ANSWERED'; });
        var talk = ans.reduce(function (s, c) { return s + (+c.DURATION_S || 0); }, 0);
        var cbs = C.calls.filter(function (c) { return c.CALLBACK_AT && c.CALLBACK_DONE !== 'Y'; }).sort(function (a, b) { return String(a.CALLBACK_AT).localeCompare(b.CALLBACK_AT); });
        var seg = function (k, opts) { return '<div class="seg">' + opts.map(function (o) { return '<button class="' + (String(f[k]) === String(o[0]) ? 'on' : '') + '" data-act="clF" data-k="' + k + '" data-v="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>'; };
        return '<div class="kpis">' + C.kpi('Calls', list.length, inN + ' in · ' + (list.length - inN) + ' out', 'pri') + C.kpi('Answered', ans.length, list.length ? Math.round(ans.length / list.length * 100) + '%' : '', 'ok') + C.kpi('Missed', miss, 'call them back', miss ? 'bad' : 'ok', 'clF', ' data-k="outcome" data-v="MISSED"') +
            C.kpi('Talk time', E.secs(talk), ans.length ? 'average ' + E.secs(talk / ans.length) : '', 'info') + C.kpi('Callbacks planned', cbs.length, cbs.filter(function (c) { return c.CALLBACK_AT.slice(0, 10) <= C.today(); }).length + ' due', cbs.length ? 'warn' : 'ok') +
            C.kpi('Listener', P.cti && P.cti.running ? 'on' : 'off', P.cti && P.cti.running ? '127.0.0.1:' + P.cti.port + ' · ' + P.cti.hits + ' events' : 'Setup › Phone', P.cti && P.cti.running ? 'ok' : '') + '</div>' +
            (cbs.length ? '<div class="card"><h2><i class="fas fa-phone-flip"></i> Callbacks</h2>' + C.table([['CALLBACK_AT', 'When'], [function (c) { return esc(c.ACCOUNT_NAME || c.CONTACT_NAME || ''); }, 'Customer'], ['NUMBER_RAW', 'Number'], ['NOTES', 'Notes'], ['AGENT', 'Agent'],
                [function (c) { return '<button class="btn sm ok" data-act="callBack" data-id="' + esc(c.CALL_ID) + '"><i class="fas fa-phone"></i> Call</button> <button class="btn sm" data-act="cbDone" data-id="' + esc(c.CALL_ID) + '">Done</button>'; }, '', 'r']], cbs) + '</div>' : '') +
            '<div class="card"><div class="filters">' + seg('days', [[1, 'Today'], [7, '7 days'], [30, '30 days']]) + seg('dir', [['', 'All'], ['IN', 'Incoming'], ['OUT', 'Outgoing']]) +
            '<select data-ch="clOut"><option value="">Every outcome</option>' + Object.keys(E.CALL_OUTCOMES).map(function (k) { return '<option value="' + k + '"' + (f.outcome === k ? ' selected' : '') + '>' + esc(E.CALL_OUTCOMES[k]) + '</option>'; }).join('') + '</select>' +
            '<input type="search" id="cl-q" data-in="clQ" placeholder="Customer, number, notes, agent…" value="' + esc(f.q || '') + '"><span class="sp"></span><button class="btn" data-act="clCsv"><i class="fas fa-download"></i></button><button class="btn ok" data-act="phoneOpen"><i class="fas fa-phone"></i> Call</button></div>' + C.callTable(list) + '</div>';
    };
    C.ACT.clF = function (el) { var v = el.dataset.v; C.cl.f[el.dataset.k] = el.dataset.k === 'days' ? +v : v; C.lsSet('cl.f', C.cl.f); C.render(); };
    C.CH.clOut = function (el) { C.cl.f.outcome = el.value; C.lsSet('cl.f', C.cl.f); C.render(); };
    C.IN.clQ = function (el) { C.cl.f.q = el.value; C.keepFocus('cl-q', C.render); };
    C.ACT.clCsv = function () { C.csv('calls.csv', C.S.CL.map(function (k) { return [k, k]; }), C.calls); };
    C.ACT.callBack = function (el) {
        var c = C.calls.filter(function (x) { return x.CALL_ID === el.dataset.id; })[0]; if (!c) return;
        P.cbOf = c.CALL_ID;
        P.dial(c.NUMBER_RAW, { account: c.ACCOUNT_NUMBER, bu: c.BU_ID, name: c.ACCOUNT_NAME, contact: c.CONTACT_NAME, ticketId: c.TICKET_ID });
        S.calls.set(c.CALL_ID, { callback_done: 'Y' }).then(function () { c.CALLBACK_DONE = 'Y'; C.badges(); });
    };
    C.ACT.cbDone = function (el) { S.calls.set(el.dataset.id, { callback_done: 'Y' }).then(function () { var c = C.calls.filter(function (x) { return x.CALL_ID === el.dataset.id; })[0]; if (c) c.CALLBACK_DONE = 'Y'; C.badges(); C.render(); }, function (e) { C.toast(C.errText(e), 'bad'); }); };
    C.ACT.playRec = function (el) {
        var end = C.busy('Opening the recording…');
        D.call('crmRecording', { path: el.dataset.path }, 120000).then(function (r) {
            end();
            var bin = atob(r.base64), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            var url = URL.createObjectURL(new Blob([arr], { type: r.mime }));
            var same = !el.dataset.sha || el.dataset.sha === r.sha256;
            C.modal('<i class="fas fa-play"></i> Call recording', '<audio controls autoplay src="' + url + '"></audio><div class="small ' + (same ? 'muted' : 'badc') + '" style="margin-top:8px">' + (same ? '✓ The file is the one recorded with the call (SHA-256).' : '✗ This file is not the one recorded with the call.') + ' ' + Math.round(r.bytes / 1024) + ' KB</div>',
                '<button class="btn" data-act="recFolder" data-path="' + esc(el.dataset.path) + '"><i class="fas fa-folder-open"></i> Show in folder</button><button class="btn" data-act="mclose">Close</button>');
        }, function (e) { end(); C.toast(C.errText(e), 'bad', 7000); });
    };
    C.ACT.recFolder = function (el) { D.call('crmOpenFolder', { path: el.dataset.path }).catch(function (e) { C.toast(C.errText(e), 'bad'); }); };
})();
