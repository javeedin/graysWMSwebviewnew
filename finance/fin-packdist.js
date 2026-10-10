/* Finance Lens — Board packs › Distribution › New distribution (FL.packDist).
   One page: ① the template, ② the period and ledgers, ③ the people (To / Cc / Bcc, saved distribution lists), ④ the
   message and tracking, with the pack and the e-mail previewed on the right, then Distribute. Distribute sends through
   FL.mail.deliver (the same path as the e-mail dialog: stamped copy, one copy per person when tracked, recorded in
   WMS_FIN_PACK_SENDS / _RCPT with the e-mail text) and keeps the exact pack file with its figures in the archive
   (WMS_FIN_PACK_ARCHIVE), so the distribution can be opened later: people and their status, the e-mail, the pack, the figures.
   Saved distribution lists live in packs.json (`lists`: [{name, to, cc, bcc}]). */
(function () {
    var W = FL.packDist = {};
    var D = function () { return FL.packDesign; };
    var P = function () { return FL.packs; };
    var split = function (v) { return String(v || '').split(/[;,\s]+/).map(function (a) { return a.trim(); }).filter(function (a) { return /@/.test(a); }); };

    /** People in To / Cc / Bcc, each counted once (e-mail sends one copy each) */
    W.count = function (s) { var seen = {}; split(s.to).concat(split(s.cc), split(s.bcc)).forEach(function (a) { seen[a.toLowerCase()] = 1; }); return Object.keys(seen).length; };
    W.state = function () {
        if (W.s) return W.s;
        var packs = D().doc.packs, p = D().cur || packs[0], e = (p && p.email) || {};
        W.s = { packId: p && p.id, period: FL.filter.period, ledgers: FL.filter.ledger ? [FL.filter.ledger] : [], to: e.to || '', cc: e.cc || '', bcc: e.bcc || '', subject: '', intro: e.intro,
            tiles: e.tiles !== false, lines: e.lines !== false, chart: e.chart !== false, hl: e.hl !== false, logo: e.logo !== false, attach: e.attach !== false,
            track: e.track !== false, rr: e.receipts !== false, how: '', comments: '', meeting: '', view: 'pack' };
        return W.s;
    };
    W.pack = function () { return D().byId(W.s.packId) || D().doc.packs[0]; };

    W.render = function (body) {
        W.body = body;
        var go = function () {
            var s = W.state(), packs = D().doc.packs, pk = W.pack(), leds = FL.dims.ledgers || [], pers = (FL.dims.periods || []).slice().sort(function (a, b) { return b.period_seq - a.period_seq; });
            var mst = FL.mail.st || {}, me = s.how || (mst.settings && mst.settings.Method) || 'OUTLOOK', lists = D().doc.lists || [];
            var addrs = {}; (FL.packTrack.rows || []).forEach(function (r) { addrs[r.EMAIL] = 1; }); (mst.recent || []).forEach(function (x) { String((x.To || '') + ';' + (x.Cc || '')).split(/[;,]/).forEach(function (a) { a = a.trim(); if (a) addrs[a] = 1; }); });
            var n = W.count(s);
            body.innerHTML = '<div class="card"><div class="row" style="gap:10px"><button class="btn sm" id="dw-back"><i class="fa-solid fa-arrow-left"></i> Distribution</button><h3 style="margin:0"><i class="fa-solid fa-paper-plane"></i> New distribution</h3>' +
                '<span class="sm muted">choose, preview, distribute — the record keeps the people, the e-mail, the pack and its figures</span></div></div>' +
                '<div class="dw"><div class="dw-left">' +
                // ① template
                '<div class="card"><h4 class="pk-h"><span class="dw-n">1</span> Template</h4><div class="dw-tpls">' + packs.map(function (p) {
                    return '<button class="dw-tpl' + (p === pk ? ' on' : '') + '" data-pk="' + esc(p.id) + '">' + D().mini(p) + '<b>' + esc(p.name) + '</b><small>' + (p.sections || []).filter(function (x) { return x.on !== false; }).length + ' sections</small></button>';
                }).join('') + '</div></div>' +
                // ② period + ledgers
                '<div class="card"><h4 class="pk-h"><span class="dw-n">2</span> Period and ledgers</h4><div class="row" style="gap:10px;flex-wrap:wrap"><label class="field" style="margin:0">Period<select id="dw-per">' +
                pers.map(function (x) { return '<option value="' + x.period_seq + '"' + (+s.period === x.period_seq ? ' selected' : '') + '>' + esc(x.period_name) + '</option>'; }).join('') + '</select></label>' +
                '<div class="field" style="margin:0;flex:1;min-width:220px">Ledgers <span class="sm muted">— none ticked = the header\'s; several = one document broken out by ledger</span><div class="pk-leds" style="margin-top:4px">' +
                leds.map(function (l) { return '<label class="pk-ledc' + (s.ledgers.indexOf(l.code) >= 0 ? ' on' : '') + '"><input type="checkbox" class="dw-led" value="' + esc(l.code) + '"' + (s.ledgers.indexOf(l.code) >= 0 ? ' checked' : '') + '>' + esc(l.name || l.code) + ' <span class="muted">' + esc(l.currency || '') + '</span></label>'; }).join('') + '</div></div></div></div>' +
                // ③ people
                '<div class="card"><h4 class="pk-h"><span class="dw-n">3</span> People <span class="sm muted">· ' + n + ' recipient' + (n === 1 ? '' : 's') + '</span></h4>' +
                (lists.length ? '<div class="dw-lists"><span class="sm muted">Lists:</span>' + lists.map(function (l, i) { return '<button class="chip" data-list="' + i + '" title="' + esc([l.to, l.cc].filter(Boolean).join(' · ')) + '"><i class="fa-solid fa-users"></i> ' + esc(l.name) + '</button>'; }).join('') + '</div>' : '') +
                '<datalist id="dw-addrs">' + Object.keys(addrs).map(function (a) { return '<option value="' + esc(a) + '">'; }).join('') + '</datalist>' +
                '<div class="row" style="margin:2px 0 4px"><button class="btn sm" id="dw-ab" title="Pick people from Outlook / Microsoft 365"><i class="fa-solid fa-address-book"></i> Address book</button><span class="sm muted">Outlook contacts, contact groups, the company address book</span></div>' +
                '<label class="field">To<input id="dw-to" list="dw-addrs" value="' + esc(s.to) + '" placeholder="chair@company.com; ceo@company.com"></label>' +
                '<div class="grid g2"><label class="field">Cc<input id="dw-cc" list="dw-addrs" value="' + esc(s.cc) + '"></label><label class="field">Bcc<input id="dw-bcc" list="dw-addrs" value="' + esc(s.bcc) + '"></label></div>' +
                '<div class="row sm" style="margin-top:6px"><button class="btn sm" id="dw-savelist"><i class="fa-solid fa-floppy-disk"></i> Save as a list</button>' + (lists.length ? '<button class="btn sm ghost" id="dw-dellist">Manage lists</button>' : '') + '</div></div>' +
                // ④ message
                '<div class="card"><h4 class="pk-h"><span class="dw-n">4</span> Message</h4><label class="field">Subject<input id="dw-subj" value="' + esc(s.subject || '') + '" placeholder="' + esc((pk.email || {}).subject || '{TITLE} · {PERIOD}') + '"></label>' +
                '<label class="field">Message<textarea id="dw-intro" rows="5">' + esc(s.intro != null ? s.intro : P().newPack().email.intro) + '</textarea></label>' +
                '<div class="ml-chks"><label><input type="checkbox" data-o="tiles"' + (s.tiles ? ' checked' : '') + '> KPI tiles</label><label><input type="checkbox" data-o="lines"' + (s.lines ? ' checked' : '') + '> income statement at a glance</label><label><input type="checkbox" data-o="chart"' + (s.chart ? ' checked' : '') + '> trend chart</label>' +
                '<label><input type="checkbox" data-o="hl"' + (s.hl ? ' checked' : '') + '> highlights</label><label><input type="checkbox" data-o="logo"' + (s.logo ? ' checked' : '') + '> logo</label><label><input type="checkbox" data-o="attach"' + (s.attach ? ' checked' : '') + '> attach the interactive pack</label></div>' +
                '<div class="ml-chks" style="margin-top:6px"><label><input type="checkbox" data-o="track"' + (s.track ? ' checked' : '') + '> track: one copy per person with <b>Confirm receipt</b> and open tracking</label><label><input type="checkbox" data-o="rr"' + (s.rr ? ' checked' : '') + '> ask for delivery and read receipts</label></div>' +
                '<div class="grid g2" style="margin-top:6px"><label class="field">Board meeting <span class="muted sm">(optional)</span><input type="date" id="dw-meet" value="' + esc(s.meeting) + '"></label><label class="field">Comment for the record<input id="dw-com" value="' + esc(s.comments) + '" placeholder="e.g. September board, final"></label></div>' +
                '<div class="row" style="margin-top:8px"><label class="sm">Send with <select id="dw-how">' + ['OUTLOOK', 'GRAPH', 'SMTP'].map(function (k) { return '<option value="' + k + '"' + (k === me ? ' selected' : '') + '>' + ({ OUTLOOK: 'Outlook (this PC)', GRAPH: 'Microsoft 365', SMTP: 'SMTP' })[k] + '</option>'; }).join('') + '</select></label>' +
                FL.mail.fromSelect('dw-from', me) + '<button class="btn sm ghost" onclick="FL.mail.setup()" title="E-mail setup"><i class="fa-solid fa-gear"></i></button></div></div>' +
                '</div><div class="dw-right card"><div class="row"><div class="seg sm" id="dw-view"><button data-v="pack"' + (s.view === 'pack' ? ' class="on"' : '') + '><i class="fa-solid fa-book-open"></i> The pack</button><button data-v="email"' + (s.view === 'email' ? ' class="on"' : '') + '><i class="fa-solid fa-envelope"></i> The e-mail</button></div>' +
                '<span class="sm muted" id="dw-stat"></span><span class="grow"></span><button class="btn sm" id="dw-full" title="Full screen"><i class="fa-solid fa-up-right-and-down-left-from-center"></i></button></div>' +
                '<div class="dw-frame"><iframe id="dw-f" title="Preview"></iframe></div>' +
                '<div class="dw-go"><div id="dw-msg" class="sm"></div><button class="btn primary dw-dist" id="dw-dist"><i class="fa-solid fa-paper-plane"></i> Distribute to ' + n + ' ' + (n === 1 ? 'person' : 'people') + '</button></div></div></div>';
            W.wire(body);
            W.preview();
        };
        (FL.mail.st ? Promise.resolve() : FL.mail.status().catch(function () { FL.mail.st = { settings: {}, recent: [] }; })).then(go);
    };

    W.wire = function (body) {
        var s = W.s, re = function () { W.render(body); };
        $('dw-back').onclick = function () { FL.packTrack.mode = null; FL.packTrack.render(body); };
        body.querySelectorAll('[data-pk]').forEach(function (b) { b.onclick = function () { s.packId = b.dataset.pk; W.built = null; var e = W.pack().email || {}; if (!s.to) s.to = e.to || ''; re(); }; });
        $('dw-per').onchange = function () { s.period = +this.value; W.built = null; W.preview(); };
        body.querySelectorAll('.dw-led').forEach(function (c) { c.onchange = function () { s.ledgers = Array.prototype.filter.call(body.querySelectorAll('.dw-led'), function (x) { return x.checked; }).map(function (x) { return x.value; }); c.parentNode.classList.toggle('on', c.checked); W.built = null; W.preview(); }; });
        var people = function () { var n = W.count(s); $('dw-dist').innerHTML = '<i class="fa-solid fa-paper-plane"></i> Distribute to ' + n + ' ' + (n === 1 ? 'person' : 'people'); var h = body.querySelector('.dw-left .card:nth-child(3) .pk-h .sm'); if (h) h.textContent = '· ' + n + ' recipient' + (n === 1 ? '' : 's'); };
        ['to', 'cc', 'bcc'].forEach(function (k) { $('dw-' + k).oninput = function () { s[k] = this.value; people(); W.mailPreview(); }; });
        body.querySelectorAll('[data-list]').forEach(function (b) { b.onclick = function () { var l = D().doc.lists[+b.dataset.list]; s.to = l.to || ''; s.cc = l.cc || ''; s.bcc = l.bcc || ''; re(); }; });
        $('dw-ab').onclick = function () { FL.mail.contacts(function (field, emails) { s[field] = FL.mail.merge(s[field], emails); var el = $('dw-' + field); if (el) el.value = s[field]; people(); W.mailPreview(); }); };
        $('dw-savelist').onclick = function () {
            if (!split(s.to).length && !split(s.cc).length) { FL.toast('Add some people first', 'err'); return; }
            var name = prompt('Name of this distribution list (e.g. Board of directors):'); if (!name) return;
            var lists = D().doc.lists = D().doc.lists || [], ex = lists.filter(function (l) { return l.name.toLowerCase() === name.trim().toLowerCase(); })[0];
            if (ex) Object.assign(ex, { to: s.to, cc: s.cc, bcc: s.bcc }); else lists.push({ name: name.trim(), to: s.to, cc: s.cc, bcc: s.bcc });
            D().store().then(re);
        };
        if ($('dw-dellist')) $('dw-dellist').onclick = function () {
            var lists = D().doc.lists || [];
            FL.modal('<i class="fa-solid fa-users"></i> Distribution lists', '<table class="tbl pt-tbl"><tbody>' + lists.map(function (l, i) { return '<tr><td><b>' + esc(l.name) + '</b><div class="sm muted" style="white-space:normal">' + esc([l.to, l.cc && 'cc ' + l.cc, l.bcc && 'bcc ' + l.bcc].filter(Boolean).join(' · ')) + '</div></td><td><button class="btn sm ghost" data-rm="' + i + '"><i class="fa-solid fa-trash"></i> Remove</button></td></tr>'; }).join('') + '</tbody></table>');
            document.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { lists.splice(+b.dataset.rm, 1); D().store().then(function () { FL.closeModal(); re(); }); }; });
        };
        $('dw-subj').oninput = function () { s.subject = this.value; W.mailPreview(); };
        $('dw-intro').oninput = function () { s.intro = this.value; W.mailPreview(); };
        $('dw-meet').onchange = function () { s.meeting = this.value; };
        $('dw-com').oninput = function () { s.comments = this.value; };
        $('dw-how').onchange = function () { s.how = this.value; };
        body.querySelectorAll('[data-o]').forEach(function (c) { c.onchange = function () { s[c.dataset.o] = c.checked; W.mailPreview(); }; });
        body.querySelectorAll('#dw-view button').forEach(function (b) { b.onclick = function () { s.view = b.dataset.v; body.querySelectorAll('#dw-view button').forEach(function (x) { x.classList.toggle('on', x === b); }); W.show(); }; });
        $('dw-full').onclick = function () { if (W.built) { if (s.view === 'email') FL.packView(W.emailHtml(), { title: 'E-mail preview' }); else FL.packView(W.built.html, { title: W.pack().title || W.pack().name }); } };
        $('dw-dist').onclick = W.distribute;
        FL.mail.wireFrom('dw-from', 'dw-how');
    };

    /** Builds the pack for the chosen period / ledgers (the header filter is restored after) */
    W.build = function () {
        var s = W.s, design = JSON.parse(JSON.stringify(W.pack()));
        design.ledgers = s.ledgers.length > 1 ? s.ledgers.slice() : [];
        var keep = { period: FL.filter.period, ledger: FL.filter.ledger, company: FL.filter.company, cc: FL.filter.cc };
        Object.assign(FL.filter, { period: +s.period || keep.period, company: s.ledgers.length ? '' : keep.company, cc: s.ledgers.length ? '' : keep.cc }, s.ledgers.length === 1 ? { ledger: s.ledgers[0] } : {});
        FL.cache = {};
        var restore = function () { Object.assign(FL.filter, keep); FL.cache = {}; };
        return P().build(design, function (m) { if ($('dw-stat')) $('dw-stat').textContent = m; }).then(function (b) { restore(); b._design = design; return b; }, function (e) { restore(); throw e; });
    };
    W.preview = function () {
        if (!(FL.status && FL.status.loaded)) { $('dw-f').srcdoc = '<p style="font:14px Segoe UI;color:#64748b;padding:30px">No data loaded yet — sync a trial balance first.</p>'; return; }
        var n = ++W._n || (W._n = 1);
        $('dw-stat').textContent = 'building…';
        W.build().then(function (b) {
            if (n !== W._n) return;
            W.built = b; $('dw-stat').textContent = b.model.period + ' · ' + (b.model.ledgers && b.model.ledgers.length > 1 ? b.model.ledgers.length + ' ledgers' : b.model.filter) + ' · ' + Math.round(b.html.length / 1024) + ' KB';
            W.show();
        }).catch(function (e) { if ($('dw-stat')) $('dw-stat').textContent = 'failed: ' + (e && e.message || e); });
    };
    W.opts = function () {
        var s = W.s, b = W.built;
        return { intro: s.intro != null ? s.intro : P().newPack().email.intro, tiles: s.tiles, keyLines: s.lines, highlights: s.hl, chart: s.chart && b.model.trendPng ? 'cid:trend@financelens' : null,
            logo: s.logo && b.model.logo ? 'cid:logo@financelens' : null, attached: s.attach ? b.file : null, sections: b.sections };
    };
    W.emailHtml = function () {
        var o = FL.mail.previewOpts(W.opts(), W.built);
        if (W.s.track) o.track = { ack: '#', copyFor: split(W.s.to)[0] || 'name@company.com', also: '' };
        return P().emailHtml(W.pack(), W.built.model, o).html;
    };
    W.mailPreview = function () { clearTimeout(W._mt); W._mt = setTimeout(function () { if (W.s.view === 'email') W.show(); }, 250); };
    W.show = function () { var f = $('dw-f'); if (!f || !W.built) return; f.srcdoc = W.s.view === 'email' ? W.emailHtml() : W.built.html; };

    W.distribute = function () {
        var s = W.s, pk = W.pack(), n = W.count(s);
        if (!split(s.to).length) { FL.toast('Add at least one person in To', 'err'); $('dw-to').focus(); return; }
        if (!W.built) { FL.toast('Wait for the preview to finish building', 'info'); return; }
        var subject = s.subject || FL.mail.subject(pk, W.built);
        if (!confirm('Distribute "' + (pk.title || pk.name) + '" for ' + W.built.model.period + ' to ' + n + ' ' + (n === 1 ? 'person' : 'people') + (s.track ? ' (one tracked copy each)' : '') + '?\n\nSubject: ' + subject + '\n\nThe pack, its figures and the e-mail are kept as a record.')) return;
        var btn = $('dw-dist'); btn.disabled = true;
        var say = function (h) { if ($('dw-msg')) $('dw-msg').innerHTML = h; };
        var mst = FL.mail.st || {}, how = s.how || (mst.settings && mst.settings.Method) || 'OUTLOOK';
        var job = { pack: Object.assign({}, pk, { ledgers: W.built._design.ledgers }), built: W.built, how: how, display: false, to: s.to, cc: s.cc, bcc: s.bcc, subject: subject, opts: W.opts(), track: s.track, rr: s.rr, say: say,
            archive: { status: 'ISSUED', comments: s.comments || 'Distributed to ' + n + ' people', meeting: s.meeting } };
        FL.mail.deliver(job).then(function (res) {
            pk.lastSent = new Date().toISOString().slice(0, 10); D().store();
            setTimeout(function () { var T = FL.packTrack; T.mode = null; T.detailId = res.stamped.docId; T.dTab = 'people'; W.s = null; W.built = null; T.load().then(function () { T.render(W.body); }); }, 1500);
        }).catch(function (e) { say('<span class="neg">✗ ' + esc(String(e && e.message || e)) + '</span>'); btn.disabled = false; });
    };
})();
