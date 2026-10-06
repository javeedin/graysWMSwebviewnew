/* Finance Lens — board pack archive: a permanent record of exactly what was shared with the board.
   Every pack that is downloaded or e-mailed can be saved (the app asks) with its status (issued to the board / draft for review),
   the meeting date and comments. APEX keeps the exact HTML file, its SHA-256 fingerprint, the headline figures and notes
   (model JSON), the pack design and every event (saved, downloaded, e-mailed to whom, opened, verified, voided) — so months later
   anyone can open the very file the board saw, prove it was not changed, and compare it with today's numbers to find a discrepancy.
   Tables (created by the page): WMS_FIN_PACK_ARCHIVE, WMS_FIN_PACK_EVENTS. Nothing is ever overwritten; an admin may void a record
   with a reason (it stays, marked VOID).
   Also: generate the pack for several ledgers at once (one file per ledger, all companies of each ledger). */
(function () {
    var R = FL.packArchive = { last: null };
    var A = function () { return FL.apexStore; };
    var lit = function (s) { return s == null || s === '' ? 'NULL' : "'" + String(s).replace(/'/g, "''") + "'"; };
    var num = function (v) { var n = +v; return isFinite(n) ? String(n) : 'NULL'; };
    var cut = function (s, n) { s = s == null ? '' : String(s); return s.length > n ? s.slice(0, n) : s; };
    var clobOf = function (s) { var p = []; for (var j = 0; j < s.length; j += 1000) p.push('TO_CLOB(' + lit(s.slice(j, j + 1000)) + ')'); return p.join(' || ') || 'EMPTY_CLOB()'; };
    var who = function () { return (FL.who && FL.who.user) || appUser() || 'WMS'; };
    var now = function () { var d = new Date(), p = function (x) { return String(x).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };
    var STATUS = { ISSUED: ['Issued to the board', 'good'], DRAFT: ['Draft for review', 'warn'], VOID: ['Void', 'bad'] };

    var TABLES = {
        WMS_FIN_PACK_ARCHIVE: 'CREATE TABLE wms_fin_pack_archive (archive_id VARCHAR2(60) NOT NULL, pack_id VARCHAR2(60), pack_name VARCHAR2(200), title VARCHAR2(300), company_name VARCHAR2(200), ' +
            'ledger_code VARCHAR2(100), ledger_name VARCHAR2(300), company VARCHAR2(150), period_seq NUMBER, period_name VARCHAR2(30), filter_text VARCHAR2(400), amounts_in VARCHAR2(30), ' +
            'sha256 VARCHAR2(64), html_len NUMBER, html CLOB, model_json CLOB, design_json CLOB, status VARCHAR2(10), meeting_date VARCHAR2(20), comments VARCHAR2(4000), void_reason VARCHAR2(1000), ' +
            'saved_by VARCHAR2(100), saved_at VARCHAR2(30), CONSTRAINT wms_fin_pack_archive_pk PRIMARY KEY (archive_id))',
        WMS_FIN_PACK_EVENTS: 'CREATE TABLE wms_fin_pack_events (archive_id VARCHAR2(60) NOT NULL, event_at VARCHAR2(30), event_by VARCHAR2(100), event VARCHAR2(20), detail VARCHAR2(4000))'
    };
    var ready = null;
    R.ensure = function () {
        if (ready) return ready;
        ready = A().read("SELECT table_name FROM user_tables WHERE table_name IN ('WMS_FIN_PACK_ARCHIVE', 'WMS_FIN_PACK_EVENTS')").then(function (rows) {
            var have = {}; rows.forEach(function (r) { have[r.TABLE_NAME] = 1; });
            return Object.keys(TABLES).filter(function (t) { return !have[t]; }).reduce(function (p, t) { return p.then(function () { return A().write(TABLES[t]); }); }, Promise.resolve());
        }).catch(function (e) { ready = null; throw e; });
        return ready;
    };

    // ── SHA-256 of the file (WebCrypto, else a small implementation) ──
    R.sha256 = function (text) {
        var bytes = new TextEncoder().encode(text);
        var hex = function (buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join(''); };
        if (window.crypto && crypto.subtle) return crypto.subtle.digest('SHA-256', bytes).then(hex).catch(function () { return sha256js(bytes); });
        return Promise.resolve(sha256js(bytes));
    };
    function sha256js(m) {
        var K = [], H = [1779033703, -1150833019, 1013904242, -1521486534, 1359893119, -1694144372, 528734635, 1541459225], i, j;
        for (var n = 2, c = 0; c < 64; n++) { var pr = true; for (j = 2; j * j <= n; j++) if (n % j === 0) { pr = false; break; } if (pr) K[c++] = (Math.pow(n, 1 / 3) % 1) * 4294967296 | 0; }
        var l = m.length, w = new Uint8Array(((l + 9 + 63) >> 6) << 6); w.set(m); w[l] = 0x80; var bits = l * 8, dv = new DataView(w.buffer);
        dv.setUint32(w.length - 4, bits >>> 0); dv.setUint32(w.length - 8, Math.floor(bits / 4294967296));
        var W = new Int32Array(64), r = function (x, s) { return (x >>> s) | (x << (32 - s)); };
        for (i = 0; i < w.length; i += 64) {
            for (j = 0; j < 16; j++) W[j] = dv.getInt32(i + j * 4);
            for (j = 16; j < 64; j++) W[j] = (r(W[j - 2], 17) ^ r(W[j - 2], 19) ^ (W[j - 2] >>> 10)) + W[j - 7] + (r(W[j - 15], 7) ^ r(W[j - 15], 18) ^ (W[j - 15] >>> 3)) + W[j - 16] | 0;
            var a = H[0], b = H[1], cc = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
            for (j = 0; j < 64; j++) {
                var t1 = h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[j] + W[j] | 0, t2 = (r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & cc) ^ (b & cc)) | 0;
                h = g; g = f; f = e; e = d + t1 | 0; d = cc; cc = b; b = a; a = t1 + t2 | 0;
            }
            H = [H[0] + a | 0, H[1] + b | 0, H[2] + cc | 0, H[3] + d | 0, H[4] + e | 0, H[5] + f | 0, H[6] + g | 0, H[7] + h | 0];
        }
        return H.map(function (x) { return (x >>> 0).toString(16).padStart(8, '0'); }).join('');
    }

    // ── store ──
    R.event = function (id, ev, detail) {
        return R.ensure().then(function () { return A().write('INSERT INTO wms_fin_pack_events (archive_id, event_at, event_by, event, detail) VALUES (' + lit(id) + ', ' + lit(now()) + ', ' + lit(who()) + ', ' + lit(ev) + ', ' + lit(cut(detail, 4000)) + ')'); });
    };
    R.findBySha = function (sha) {
        return R.ensure().then(function () { return A().read('SELECT archive_id, status, saved_by, saved_at FROM wms_fin_pack_archive WHERE sha256 = ' + lit(sha), 5); });
    };
    /** Saves a built pack: rec = {pack, built, status, meeting, comments, event, detail}; onStep(done, total) */
    R.save = function (rec, onStep) {
        var b = rec.built, m = b.model, pack = rec.pack, id = 'bp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        var model = { period: m.period, per: m.per, ledger: m.ledger, ledgerName: m.ledgerName, company: m.company, filter: m.filter, scaleLabel: m.scaleLabel, tiles: m.tiles, keyLines: m.keyLines,
            highlights: m.highlights, attention: m.attention, sections: b.sections, notes: FL.notes && FL.notes.all ? (FL.notes.all || []).filter(function (n) { return !n.removed && (n.scope === 'GLOBAL' || +n.period === +m.per); }).map(function (n) { return { kind: n.kind, title: n.title, line: n.rowLabel, body: n.body, scope: n.scope }; }) : [] };
        var design = Object.assign({}, pack); delete design.logo;   // the logo is in the HTML already
        var html = b.html, chunks = []; for (var i = 0; i < html.length; i += 20000) chunks.push(html.slice(i, i + 20000));
        var total = chunks.length + 4, done = 0, tick = function () { done++; if (onStep) onStep(done, total); };
        return R.ensure().then(function () { return R.sha256(html); }).then(function (sha) {
            rec.sha = sha;
            var cols = { pack_id: lit(cut(pack.id, 60)), pack_name: lit(cut(pack.name, 200)), title: lit(cut(pack.title || pack.name, 300)), company_name: lit(cut(pack.company, 200)), ledger_code: lit(cut(m.ledger, 100)),
                ledger_name: lit(cut(m.ledgerName, 300)), company: lit(cut(m.company, 150)), period_seq: num(m.per), period_name: lit(m.period), filter_text: lit(cut(m.filter, 400)), amounts_in: lit(m.scaleLabel),
                sha256: lit(sha), html_len: num(html.length), status: lit(rec.status || 'ISSUED'), meeting_date: lit(cut(rec.meeting, 20)), comments: lit(cut(rec.comments, 4000)), saved_by: lit(who()), saved_at: lit(now()) };
            var k = Object.keys(cols);
            return A().write('INSERT INTO wms_fin_pack_archive (archive_id, ' + k.join(', ') + ', html, model_json, design_json) VALUES (' + lit(id) + ', ' + k.map(function (x) { return cols[x]; }).join(', ') + ', ' +
                clobOf(chunks[0] || '') + ', ' + clobOf(JSON.stringify(model).slice(0, 18000)) + ', ' + clobOf(JSON.stringify(design).slice(0, 18000)) + ')').then(tick)
                .then(function () { return chunks.slice(1).reduce(function (p, ch) { return p.then(function () { return A().write('UPDATE wms_fin_pack_archive SET html = html || ' + clobOf(ch) + ' WHERE archive_id = ' + lit(id)); }).then(tick); }, Promise.resolve()); })
                .then(function () { return A().read('SELECT LENGTH(html) n FROM wms_fin_pack_archive WHERE archive_id = ' + lit(id), 1); })
                .then(function (r) { tick(); if (!r.length || +r[0].N !== html.length) throw new Error('The file was not stored completely (' + (r[0] && r[0].N) + ' of ' + html.length + ' characters) — try again'); })
                .then(function () { return R.event(id, 'SAVED', (STATUS[rec.status] || STATUS.ISSUED)[0] + (rec.comments ? ' · ' + rec.comments : '')); }).then(tick)
                .then(function () { return rec.event ? R.event(id, rec.event, rec.detail || '') : null; }).then(tick)
                .then(function () { return { id: id, sha: sha }; });
        });
    };

    R.list = function () {
        return R.ensure().then(function () {
            return A().read('SELECT a.archive_id, a.pack_name, a.title, a.ledger_code, a.ledger_name, a.company, a.period_seq, a.period_name, a.filter_text, a.sha256, a.html_len, a.status, a.meeting_date, a.comments, ' +
                'a.void_reason, a.saved_by, a.saved_at, (SELECT COUNT(*) FROM wms_fin_pack_events e WHERE e.archive_id = a.archive_id) events FROM wms_fin_pack_archive a ORDER BY a.saved_at DESC', 2000);
        });
    };
    /** A CLOB column of one record, read in 4,000-character pieces */
    R.clob = function (id, col) {
        return A().read('SELECT LENGTH(' + col + ') n FROM wms_fin_pack_archive WHERE archive_id = ' + lit(id), 1).then(function (r) {
            var len = r.length ? +r[0].N || 0 : 0, cols = [];
            for (var i = 1; i <= len; i += 4000) cols.push('TO_CHAR(SUBSTR(' + col + ', ' + i + ', 4000)) p' + cols.length);
            var groups = []; for (var g = 0; g < cols.length; g += 20) groups.push(cols.slice(g, g + 20));
            return Promise.all(groups.map(function (gr) { return A().read('SELECT ' + gr.join(', ') + ' FROM wms_fin_pack_archive WHERE archive_id = ' + lit(id), 1); })).then(function (parts) {
                var s = ''; parts.forEach(function (rows, gi) { groups[gi].forEach(function (_, j) { s += (rows[0] || {})['P' + (gi * 20 + j)] || ''; }); }); return s;
            });
        });
    };
    R.events = function (id) {
        return R.ensure().then(function () { return A().read('SELECT event_at, event_by, event, detail FROM wms_fin_pack_events WHERE archive_id = ' + lit(id) + ' ORDER BY event_at', 500); });
    };

    // ── "save a record of what was shared?" ──
    /** opts = {event: 'DOWNLOADED' | 'EMAILED' | null, detail} — asks for status, meeting date and comments, then saves */
    R.ask = function (pack, built, opts) {
        opts = opts || {};
        if (opts.event && FL.ls('pack.archiveNever', false)) return;
        R.sha256(built.html).then(function (sha) {
            return R.findBySha(sha).catch(function () { return null; }).then(function (same) {
                var dup = same && same.length ? same[0] : null, m = built.model;
                if (dup && opts.event) { R.event(dup.ARCHIVE_ID, opts.event, opts.detail || '').then(function () { FL.toast('Recorded in the archive: ' + opts.event.toLowerCase() + ' (same file as saved by ' + dup.SAVED_BY + ' on ' + String(dup.SAVED_AT).slice(0, 16) + ')', 'ok'); }); return; }
                FL.modal('<i class="fa-solid fa-box-archive"></i> Keep a record of this board pack',
                    '<p class="sm" style="margin-top:0">' + (opts.event === 'EMAILED' ? 'The pack was e-mailed. ' : opts.event === 'DOWNLOADED' ? 'The pack was downloaded. ' : '') +
                    'Save the exact file in APEX with your comments, so you can show later exactly what the board received — open it again, prove it was not changed (fingerprint), and compare it with the numbers of that day.</p>' +
                    '<div class="card" style="padding:10px 12px;margin:8px 0"><b>' + esc(pack.title || pack.name) + '</b> · ' + esc(m.period) + ' · ' + esc(m.ledgerName || m.filter) + (m.company ? ' · company ' + esc(m.company) : '') + '<br>' +
                    '<span class="sm muted">' + built.sections.length + ' sections · ' + Math.round(built.html.length / 1024) + ' KB · fingerprint <code>' + sha.slice(0, 16) + '…</code>' + (opts.detail ? ' · ' + esc(opts.detail) : '') + '</span></div>' +
                    (dup ? '<div class="callout warn sm">This exact file is already in the archive (saved by ' + esc(dup.SAVED_BY) + ' on ' + esc(String(dup.SAVED_AT).slice(0, 16)) + ').</div>' : '') +
                    '<div class="grid g2"><label class="field">Status<select id="ar-st"><option value="ISSUED">Issued to the board</option><option value="DRAFT"' + (opts.event ? '' : ' selected') + '>Draft for review</option></select></label>' +
                    '<label class="field">Board / meeting date<input id="ar-date" type="date"></label></div>' +
                    '<label class="field">Comments <span class="muted sm">(what was agreed, caveats, who approved it …)</span><textarea id="ar-com" rows="4" maxlength="4000"></textarea></label>' +
                    '<div class="row" style="margin-top:10px">' + (opts.event ? '<label class="sm"><input type="checkbox" id="ar-never"> do not ask again on this PC</label>' : '') + '<span class="grow"></span><button class="btn" id="ar-skip">Not now</button>' +
                    '<button class="btn primary" id="ar-save"><i class="fa-solid fa-box-archive"></i> Save to the archive</button></div><div id="ar-msg" class="sm" style="margin-top:6px"></div>');
                $('ar-skip').onclick = function () { if ($('ar-never') && $('ar-never').checked) FL.lsSet('pack.archiveNever', true); FL.closeModal(); };
                $('ar-save').onclick = function () {
                    var bt = this; bt.disabled = true;
                    R.save({ pack: pack, built: built, status: $('ar-st').value, meeting: $('ar-date').value, comments: $('ar-com').value.trim(), event: opts.event, detail: opts.detail }, function (d, t) { $('ar-msg').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving the file in APEX… ' + Math.round(d / t * 100) + ' %'; })
                        .then(function (r) { $('ar-msg').innerHTML = '<span class="pos">✓ Saved · fingerprint ' + r.sha.slice(0, 16) + '…</span>'; FL.toast('Board pack saved to the archive', 'ok'); setTimeout(FL.closeModal, 1000); if (FL.packDesign && FL.packDesign.archiveOpen) R.render(); })
                        .catch(function (e) { $('ar-msg').innerHTML = '<span class="neg">✗ ' + esc(String(e && e.message || e)) + '</span>'; bt.disabled = false; });
                };
            });
        }).catch(function (e) { FL.toast('Archive not reachable: ' + (e && e.message || e), 'err'); });
    };

    // ── the archive view (Board packs › Archive) ──
    R.render = function (box) {
        box = box || $('pk-arch'); if (!box) return;
        box.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading the archive from APEX…</div>';
        R.list().then(function (rows) {
            R.rows = rows;
            var per = {}; rows.forEach(function (r) { per[r.PERIOD_NAME] = 1; });
            box.innerHTML = '<div class="row"><h3 style="margin:0"><i class="fa-solid fa-box-archive"></i> Board pack archive</h3><span class="sm muted">every pack saved — the exact file, its fingerprint, figures, comments and who received it</span><span class="grow"></span>' +
                '<input id="ar-q" placeholder="search title, ledger, comments, person…" style="width:260px"><select id="ar-fs"><option value="">every status</option>' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '">' + STATUS[k][0] + '</option>'; }).join('') + '</select></div>' +
                (rows.length ? '' : '<p class="sm muted" style="margin-top:12px">Nothing saved yet. Download or e-mail a pack and keep a record when asked, or use <b>Save to archive</b>.</p>') + '<div id="ar-grid" style="margin-top:10px"></div>';
            var paint = function () {
                var q = $('ar-q').value.toLowerCase(), fs = $('ar-fs').value;
                var list = rows.filter(function (r) { return (!fs || r.STATUS === fs) && (!q || [r.TITLE, r.PACK_NAME, r.LEDGER_NAME, r.COMMENTS, r.SAVED_BY, r.PERIOD_NAME].join(' ').toLowerCase().indexOf(q) >= 0); });
                $('ar-grid').innerHTML = '<table class="t"><thead><tr><th>Saved</th><th>Period</th><th>Pack</th><th>Ledger</th><th>Status</th><th>Meeting</th><th>Comments</th><th>By</th><th class="n">Events</th><th>Fingerprint</th></tr></thead><tbody>' +
                    list.map(function (r) { var s = STATUS[r.STATUS] || STATUS.ISSUED; return '<tr class="click" data-id="' + esc(r.ARCHIVE_ID) + '"><td>' + esc(String(r.SAVED_AT || '').slice(0, 16)) + '</td><td>' + esc(r.PERIOD_NAME) + '</td><td><b>' + esc(r.TITLE) + '</b></td><td>' + esc(r.LEDGER_NAME || r.FILTER_TEXT) + (r.COMPANY ? ' · ' + esc(r.COMPANY) : '') + '</td><td><span class="tag ' + s[1] + '">' + s[0] + '</span></td><td>' + esc(r.MEETING_DATE || '') + '</td><td class="sm">' + esc(cut(r.COMMENTS || '', 90)) + '</td><td>' + esc(r.SAVED_BY) + '</td><td class="n">' + (+r.EVENTS || 0) + '</td><td class="mono sm">' + esc(String(r.SHA256 || '').slice(0, 12)) + '</td></tr>'; }).join('') + '</tbody></table>';
                $('ar-grid').querySelectorAll('tr[data-id]').forEach(function (tr) { tr.onclick = function () { R.detail(tr.dataset.id); }; });
            };
            $('ar-q').oninput = paint; $('ar-fs').onchange = paint; paint();
        }).catch(function (e) { box.innerHTML = '<div class="callout bad">The archive could not be read from APEX: ' + esc(String(e && e.message || e)) + '</div>'; });
    };

    R.detail = function (id) {
        var r = (R.rows || []).filter(function (x) { return x.ARCHIVE_ID === id; })[0]; if (!r) return;
        var s = STATUS[r.STATUS] || STATUS.ISSUED, admin = FL.who && FL.who.admin;
        FL.modal('<i class="fa-solid fa-box-archive"></i> ' + esc(r.TITLE) + ' · ' + esc(r.PERIOD_NAME),
            '<div class="row"><span class="tag ' + s[1] + '">' + s[0] + '</span><span class="sm muted">' + esc(r.LEDGER_NAME || r.FILTER_TEXT) + (r.COMPANY ? ' · company ' + esc(r.COMPANY) : '') + ' · saved by ' + esc(r.SAVED_BY) + ' on ' + esc(String(r.SAVED_AT).slice(0, 16)) + (r.MEETING_DATE ? ' · meeting ' + esc(r.MEETING_DATE) : '') + '</span></div>' +
            (r.COMMENTS ? '<div class="note" style="margin:10px 0;white-space:pre-wrap">' + esc(r.COMMENTS) + '</div>' : '') + (r.VOID_REASON ? '<div class="callout bad sm">Voided: ' + esc(r.VOID_REASON) + '</div>' : '') +
            '<div class="row" style="margin:10px 0"><button class="btn primary" id="ad-open"><i class="fa-regular fa-eye"></i> Open the file</button><button class="btn" id="ad-dl"><i class="fa-solid fa-download"></i> Download</button>' +
            '<button class="btn" id="ad-ver" title="Read the file back and recompute its SHA-256 — it must match the fingerprint taken when it was saved"><i class="fa-solid fa-fingerprint"></i> Verify</button>' +
            '<button class="btn" id="ad-cmp" title="Build the same pack again from today\'s data and compare the headline figures"><i class="fa-solid fa-code-compare"></i> Compare with today\'s numbers</button>' +
            (admin && r.STATUS !== 'VOID' ? '<span class="grow"></span><button class="btn ghost" id="ad-void"><i class="fa-solid fa-ban"></i> Void…</button>' : '') + '</div>' +
            '<div id="ad-out"></div><h4 style="margin:12px 0 4px">What happened to it</h4><div id="ad-ev" class="sm"><i class="fa-solid fa-circle-notch fa-spin"></i></div>' +
            '<div class="sm muted" style="margin-top:8px">Fingerprint (SHA-256): <code>' + esc(r.SHA256) + '</code> · ' + Math.round((+r.HTML_LEN || 0) / 1024) + ' KB</div>');
        R.events(id).then(function (ev) {
            $('ad-ev').innerHTML = ev.length ? '<table class="t"><tbody>' + ev.map(function (e) { return '<tr><td>' + esc(String(e.EVENT_AT).slice(0, 16)) + '</td><td><b>' + esc(e.EVENT) + '</b></td><td>' + esc(e.EVENT_BY) + '</td><td>' + esc(e.DETAIL || '') + '</td></tr>'; }).join('') + '</tbody></table>' : 'No events.';
        }).catch(function () { $('ad-ev').textContent = 'Events could not be read.'; });
        var file = function () { $('ad-out').innerHTML = '<span class="sm"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading the file from APEX…</span>'; return R.clob(id, 'html').then(function (h) { $('ad-out').innerHTML = ''; return h; }); };
        $('ad-open').onclick = function () { file().then(function (h) { R.event(id, 'OPENED', ''); FL.packView(h, { title: r.TITLE + ' (archived ' + String(r.SAVED_AT).slice(0, 10) + ')' }); }); };
        $('ad-dl').onclick = function () { file().then(function (h) { R.event(id, 'DOWNLOADED', 'from the archive'); FL.download((r.TITLE + ' ' + r.PERIOD_NAME + ' archived').replace(/[^\w .-]+/g, '') + '.html', new Blob([h], { type: 'text/html' })); }); };
        $('ad-ver').onclick = function () {
            file().then(function (h) { return R.sha256(h).then(function (sha) {
                var ok = sha === r.SHA256 && h.length === +r.HTML_LEN;
                R.event(id, 'VERIFIED', ok ? 'fingerprint matches' : 'FINGERPRINT DIFFERS: ' + sha);
                $('ad-out').innerHTML = '<div class="callout ' + (ok ? 'good' : 'bad') + ' sm">' + (ok ? '✓ The file is exactly the one saved — fingerprint matches (' + sha.slice(0, 16) + '…).' : '✗ The file differs from the one saved: ' + sha + ' (' + h.length + ' characters, expected ' + r.HTML_LEN + ').') + '</div>';
            }); });
        };
        $('ad-cmp').onclick = function () { R.compare(r); };
        if ($('ad-void')) $('ad-void').onclick = function () {
            var why = prompt('Why is this pack void? (the record stays, marked VOID)'); if (!why) return;
            R.ensure().then(function () { return A().write("UPDATE wms_fin_pack_archive SET status = 'VOID', void_reason = " + lit(cut(why, 1000)) + ' WHERE archive_id = ' + lit(id)); })
                .then(function () { return R.event(id, 'VOIDED', why); }).then(function () { FL.toast('Marked void', 'ok'); FL.closeModal(); R.render(); });
        };
    };

    /** Build the same design for the same ledger / period from today's data and compare the headline figures with the archived ones */
    R.compare = function (r) {
        var out = $('ad-out'); out.innerHTML = '<span class="sm"><i class="fa-solid fa-circle-notch fa-spin"></i> Rebuilding the pack from today\'s data…</span>';
        Promise.all([R.clob(r.ARCHIVE_ID, 'model_json'), R.clob(r.ARCHIVE_ID, 'design_json')]).then(function (x) {
            var old = JSON.parse(x[0] || '{}'), design = JSON.parse(x[1] || '{}');
            if (!FL.dims.periods.some(function (p) { return p.period_seq === +r.PERIOD_SEQ; })) throw new Error('Period ' + r.PERIOD_NAME + ' is not loaded on this PC — sync it first');
            var keep = { period: FL.filter.period, ledger: FL.filter.ledger, company: FL.filter.company, cc: FL.filter.cc, scale: FL.filter.scale };
            Object.assign(FL.filter, { period: +r.PERIOD_SEQ, ledger: r.LEDGER_CODE || '', company: r.COMPANY || '', cc: '', scale: old.scaleLabel === 'millions' ? 1000000 : old.scaleLabel === 'thousands' ? 1000 : old.scaleLabel === 'hundreds' ? 100 : 1 });
            FL.cache = {};
            return FL.packs.build(design).then(function (b) { Object.assign(FL.filter, keep); FL.cache = {}; return { old: old, cur: b.model }; }, function (e) { Object.assign(FL.filter, keep); FL.cache = {}; throw e; });
        }).then(function (c) {
            var rows = [], diffs = 0;
            var byLabel = function (list) { var o = {}; (list || []).forEach(function (t) { o[t.label] = t; }); return o; };
            var ot = byLabel(c.old.tiles), nt = byLabel(c.cur.tiles);
            Object.keys(ot).forEach(function (k) { var a = ot[k].value, b = (nt[k] || {}).value; var d = String(a) !== String(b); if (d) diffs++; rows.push(['KPI', k, a, b == null ? '–' : b, d]); });
            var ol = byLabel(c.old.keyLines), nl = byLabel(c.cur.keyLines), f = function (v) { return v == null ? '–' : FINE.fmt(v, 'num', { decimals: 0 }); };
            Object.keys(ol).forEach(function (k) { ['m', 'y'].forEach(function (col) { var a = ol[k][col], b = (nl[k] || {})[col]; var d = Math.abs((+a || 0) - (+b || 0)) >= 1; if (d) diffs++; rows.push([col === 'm' ? 'Month' : 'YTD', k, f(a), f(b), d]); }); });
            R.event(r.ARCHIVE_ID, 'COMPARED', diffs ? diffs + ' figure(s) differ from today' : 'same as today');
            out.innerHTML = '<div class="callout ' + (diffs ? 'warn' : 'good') + ' sm">' + (diffs ? diffs + ' figure(s) differ between the pack the board received and today\'s data — postings after the pack was issued, a changed mapping or a re-sync.' : '✓ Today\'s data gives the same headline figures as the archived pack.') + '</div>' +
                '<div class="scroll" style="max-height:40vh"><table class="t sm"><thead><tr><th></th><th>Line</th><th class="n">In the archived pack</th><th class="n">Today</th></tr></thead><tbody>' +
                rows.map(function (x) { return '<tr' + (x[4] ? ' style="background:#fef3c7"' : '') + '><td>' + x[0] + '</td><td>' + esc(x[1]) + '</td><td class="n">' + x[2] + '</td><td class="n">' + x[3] + (x[4] ? ' ⚠' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
        }).catch(function (e) { out.innerHTML = '<div class="callout bad sm">' + esc(String(e && e.message || e)) + '</div>'; });
    };

    // ── generate for several ledgers ──
    R.multi = function (pack) {
        var leds = FL.dims.ledgers || [];
        if (!leds.length) { FL.toast('No ledgers loaded', 'err'); return; }
        FL.modal('<i class="fa-solid fa-layer-group"></i> Board packs for several ledgers · ' + esc(FL.periodName(FL.filter.period)),
            '<p class="sm" style="margin-top:0">One pack per ledger (all companies of the ledger), with the design <b>' + esc(pack.name) + '</b>, for ' + esc(FL.periodName(FL.filter.period)) + '.</p>' +
            '<div class="ml-chks">' + leds.map(function (l) { return '<label><input type="checkbox" class="mg-led" value="' + esc(l.code) + '" checked> ' + esc(l.name || l.code) + ' <span class="muted">' + esc(l.currency || '') + '</span></label>'; }).join('') + '</div>' +
            '<div class="row" style="margin-top:10px"><span class="grow"></span><button class="btn primary" id="mg-go"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</button></div><div id="mg-out" style="margin-top:10px"></div>');
        $('mg-go').onclick = function () {
            var codes = Array.prototype.map.call(document.querySelectorAll('.mg-led:checked'), function (x) { return x.value; });
            if (!codes.length) { FL.toast('Tick at least one ledger', 'err'); return; }
            var bt = this; bt.disabled = true;
            var keep = { ledger: FL.filter.ledger, company: FL.filter.company, cc: FL.filter.cc }, res = [];
            codes.reduce(function (p, code) {
                return p.then(function () {
                    $('mg-out').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> ' + esc(code) + ' (' + (res.length + 1) + ' of ' + codes.length + ')…';
                    Object.assign(FL.filter, { ledger: code, company: '', cc: '' }); FL.cache = {};
                    return FL.packs.build(pack).then(function (b) { res.push({ code: code, built: b }); }, function (e) { res.push({ code: code, error: String(e && e.message || e) }); });
                });
            }, Promise.resolve()).then(function () {
                Object.assign(FL.filter, keep); FL.cache = {};
                R.multiRes = res; bt.disabled = false;
                $('mg-out').innerHTML = '<table class="t"><thead><tr><th>Ledger</th><th>Pack</th><th></th></tr></thead><tbody>' + res.map(function (x, i) {
                    var m = x.built && x.built.model;
                    return '<tr><td><b>' + esc(m ? m.ledgerName || x.code : x.code) + '</b></td><td class="sm">' + (x.error ? '<span class="neg">' + esc(x.error) + '</span>' : esc(x.built.file) + ' · ' + Math.round(x.built.html.length / 1024) + ' KB · ' + (m.tiles[0] ? esc(m.tiles[0].label + ' ' + m.tiles[0].value) : '')) + '</td><td>' +
                        (x.error ? '' : '<button class="btn sm" data-mv="' + i + '"><i class="fa-regular fa-eye"></i></button><button class="btn sm" data-md="' + i + '"><i class="fa-solid fa-download"></i></button><button class="btn sm" data-mm="' + i + '"><i class="fa-solid fa-paper-plane"></i></button><button class="btn sm" data-ma="' + i + '"><i class="fa-solid fa-box-archive"></i></button>') + '</td></tr>';
                }).join('') + '</tbody></table><div class="row" style="margin-top:8px"><span class="grow"></span><button class="btn" id="mg-dlall"><i class="fa-solid fa-download"></i> Download all</button><button class="btn primary" id="mg-arall"><i class="fa-solid fa-box-archive"></i> Save all to the archive…</button></div>';
                var get = function (b) { return res[+b.dataset[Object.keys(b.dataset)[0]]]; };
                document.querySelectorAll('[data-mv]').forEach(function (b) { b.onclick = function () { var x = get(b); FL.packView(x.built.html, { title: pack.title + ' · ' + x.code }); }; });
                document.querySelectorAll('[data-md]').forEach(function (b) { b.onclick = function () { var x = get(b); FL.download(x.built.file.replace(/\.html$/, ' ' + x.code + '.html'), new Blob([x.built.html], { type: 'text/html' })); }; });
                document.querySelectorAll('[data-mm]').forEach(function (b) { b.onclick = function () { var x = get(b); FL.mail.compose(pack, x.built, function (r) { R.ask(pack, x.built, { event: 'EMAILED', detail: 'to ' + ((pack.email || {}).to || '') + ' via ' + r.via }); }); }; });
                document.querySelectorAll('[data-ma]').forEach(function (b) { b.onclick = function () { R.ask(pack, get(b).built, {}); }; });
                $('mg-dlall').onclick = function () { res.filter(function (x) { return x.built; }).forEach(function (x, i) { setTimeout(function () { FL.download(x.built.file.replace(/\.html$/, ' ' + x.code + '.html'), new Blob([x.built.html], { type: 'text/html' })); }, i * 400); }); };
                $('mg-arall').onclick = function () { R.askAll(pack, res.filter(function (x) { return x.built; })); };
            });
        };
    };
    /** Save several packs at once with one status / meeting / comments */
    R.askAll = function (pack, list) {
        FL.modal('<i class="fa-solid fa-box-archive"></i> Save ' + list.length + ' board pack(s) to the archive',
            '<div class="grid g2"><label class="field">Status<select id="aa-st"><option value="ISSUED">Issued to the board</option><option value="DRAFT">Draft for review</option></select></label><label class="field">Board / meeting date<input id="aa-date" type="date"></label></div>' +
            '<label class="field">Comments<textarea id="aa-com" rows="4" maxlength="4000"></textarea></label><div class="row" style="margin-top:10px"><span class="grow"></span><button class="btn primary" id="aa-go">Save all</button></div><div id="aa-msg" class="sm"></div>');
        $('aa-go').onclick = function () {
            var bt = this; bt.disabled = true; var n = 0;
            list.reduce(function (p, x) { return p.then(function () { $('aa-msg').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> ' + esc(x.code) + ' (' + (++n) + ' of ' + list.length + ')…'; return R.save({ pack: pack, built: x.built, status: $('aa-st').value, meeting: $('aa-date').value, comments: $('aa-com').value.trim() }); }); }, Promise.resolve())
                .then(function () { $('aa-msg').innerHTML = '<span class="pos">✓ ' + list.length + ' pack(s) saved</span>'; FL.toast('Saved to the archive', 'ok'); setTimeout(FL.closeModal, 1000); })
                .catch(function (e) { $('aa-msg').innerHTML = '<span class="neg">✗ ' + esc(String(e && e.message || e)) + '</span>'; bt.disabled = false; });
        };
    };
})();
