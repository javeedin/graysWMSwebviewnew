/* Field Apps · the desktop page (window.FAP): Apps (make, edit, sign, publish), Preview (the app in a phone frame with this
 * page as the host), Results (what the phones sent), Photos (bay pictures + the desktop's vision worker), POS console,
 * Devices (pairing by QR), Setup (tables, handlers, signing key). APEX through fa-store.js, the shell through fa-host.js. */
(function () {
    'use strict';
    var FAP = window.FAP = {};
    var P = { tab: 'apps', apps: [], sel: null, keys: [], admin: false, hostKey: null, pod: FAS.pod(), previewUser: FAS.user(), previewDevice: 'desk_' + (FAS.user() || 'wms').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12), previewOnline: true,
        previewSrc: null, previewSize: 'handheld', previewZoom: 'fit', previewRot: false, log: [], sent: [], subs: [], subsF: {}, photos: [], photosF: {}, sales: [], salesF: { from: today(), to: today() }, tenders: [], shifts: [], items: [], itemsQ: '', itemsN: null, custN: null, devices: [], pend: [], setup: null, mobileUsers: null, drawer: null, busyN: 0, ready: false };
    var SIZES = { handheld: [360, 640, 'Handheld · 360 × 640'], phone: [390, 844, 'Phone · 390 × 844'], large: [430, 932, 'Large phone · 430 × 932'], tablet: [820, 1180, 'Tablet · 820 × 1180'] };
    var $ = function (id) { return document.getElementById(id); };
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function today() { var d = new Date(); function z(n) { return (n < 10 ? '0' : '') + n; } return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
    function fmt(iso) { return iso ? String(iso).replace('T', ' ').slice(0, 16) : ''; }
    function money(n) { return POSE.money(n, { currency: 'Rs', precision: 2 }); }
    function toast(msg, kind, ms) { var t = $('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); } t.className = 'toast ' + (kind || ''); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { t.style.display = 'none'; }, ms || (kind === 'bad' ? 7000 : 2500)); }
    function busy(label) { P.busyN++; var b = $('busy'); if (!b) { b = document.createElement('div'); b.id = 'busy'; b.className = 'busy'; document.body.appendChild(b); } b.innerHTML = '<span class="spin"></span><span>' + esc(label || 'Working…') + '</span>'; b.style.display = 'flex'; return function () { P.busyN = Math.max(0, P.busyN - 1); if (!P.busyN && $('busy')) $('busy').style.display = 'none'; }; }
    /** Runs p(step) under the busy banner; step(label) changes the banner's text; a failure is toasted and rethrown. */
    function run(label, p) { var done = busy(label); function step(l) { var b = $('busy'); if (b && b.lastChild) b.lastChild.textContent = l; } return Promise.resolve().then(function () { return p(step); }).then(function (r) { done(); return r; }, function (e) { done(); toast(String(e && e.message || e), 'bad', 12000); throw e; }); }
    function builtins() { return window.FA_APPS || {}; }
    function appById(id) { return P.apps.filter(function (a) { return a.APP_ID === id; })[0] || null; }
    function usersText(a) { return !a.USERS_N ? 'nobody yet' : a.USERS === '*' ? 'everyone' : a.USERS; }

    // ── frame ─────────────────────────────────────────────────────
    var TABS = [['apps', 'Apps'], ['preview', 'Preview'], ['results', 'Results'], ['photos', 'Photos'], ['pos', 'POS'], ['devices', 'Devices'], ['setup', 'Setup']];
    function paintTabs() {
        $('tabs').innerHTML = TABS.map(function (t) { var n = t[0] === 'apps' ? P.apps.length : t[0] === 'results' ? P.subs.filter(function (s) { return s.STATUS === 'NEW' || s.STATUS === 'ERROR'; }).length : t[0] === 'devices' ? P.devices.filter(function (d) { return d.REVOKED !== 'Y'; }).length : 0; return '<button class="' + (P.tab === t[0] ? 'on' : '') + '" data-tab="' + t[0] + '">' + t[1] + (n ? '<span class="n">' + n + '</span>' : '') + '</button>'; }).join('');
        $('who').innerHTML = esc(FAS.user()) + ' · ' + esc(P.pod) + (P.admin ? ' · <span class="pill ok">AI admin</span>' : ' · <span class="pill">user</span>');
    }
    function go(tab) { P.tab = tab; try { localStorage.setItem('fieldapps.tab', tab); } catch (e) { } paintTabs(); render(); }
    function render() {
        var m = $('main');
        if (P.tab !== 'preview') FAH.detach();
        if (P.tab === 'apps') m.innerHTML = vApps();
        else if (P.tab === 'preview') { m.innerHTML = vPreview(); mountPreview(); }
        else if (P.tab === 'results') m.innerHTML = vResults();
        else if (P.tab === 'photos') m.innerHTML = vPhotos();
        else if (P.tab === 'pos') m.innerHTML = vPos();
        else if (P.tab === 'devices') m.innerHTML = vDevices();
        else if (P.tab === 'setup') m.innerHTML = vSetup();
    }

    // ── Apps ──────────────────────────────────────────────────────
    function vApps() {
        var h = '<div class="row" style="margin-bottom:12px"><button class="btn pri" data-act="newBuiltin"><i class="fas fa-plus"></i> New app from a built-in</button><button class="btn" data-act="newFile"><i class="fas fa-file-code"></i> New app from an HTML file</button><button class="btn" data-act="newBlank"><i class="fas fa-pen"></i> Blank app</button><span class="sp"></span><button class="btn" data-act="reloadApps"><i class="fas fa-rotate"></i> Refresh</button></div>';
        if (!P.admin) h += '<div class="warnbox" style="margin-bottom:12px">You can look at everything here. Signing and publishing an app to the phones needs an AI admin (AI Digital Employee › Control).</div>';
        if (!P.apps.length) h += '<div class="card empty">No apps in APEX yet. Start with the built-in POS: <b>New app from a built-in</b>.</div>';
        h += '<div class="apps">' + P.apps.map(function (a) {
            var st = a.STATUS === 'PUBLISHED' ? '<span class="pill ok">published</span>' : a.STATUS === 'KILLED' ? '<span class="pill bad">killed</span>' : '<span class="pill warn">draft</span>';
            var exp = a.EXPIRES_AT ? (new Date(a.EXPIRES_AT) < new Date() ? '<span class="pill bad">expired ' + esc(fmt(a.EXPIRES_AT)) + '</span>' : '<span class="pill">until ' + esc(fmt(a.EXPIRES_AT)) + '</span>') : '';
            var bi = builtins()[a.APP_ID], newer = bi && String(bi.manifest.version) !== String(a.VERSION) ? '' : '';
            return '<div class="app' + (P.sel === a.APP_ID ? ' sel' : '') + '" data-app="' + esc(a.APP_ID) + '"><div class="row"><span class="ic">' + esc(a.ICON || '📱') + '</span><div><div class="nm">' + esc(a.NAME) + '</div><div class="small muted mono">' + esc(a.APP_ID) + ' · v' + esc(a.VERSION) + '</div></div><span class="sp"></span>' + st + '</div>' +
                '<div class="ds">' + esc((a.NOTES || '')) + '</div>' +
                '<div class="meta"><span>👥 ' + esc(usersText(a)) + '</span>' + exp + '<span>' + Math.round((+a.CODE_BYTES || 0) / 1024) + ' KB</span>' + (a.SIGNATURE ? '<span title="key ' + esc(a.KEY_ID) + '">🔏 signed</span>' : '<span>not signed</span>') + (a.PUBLISHED ? '<span>published ' + esc(fmt(a.PUBLISHED)) + ' by ' + esc(a.PUBLISHED_BY) + '</span>' : '') + newer + '</div>' +
                '<div class="acts"><button class="btn sm" data-act="preview" data-id="' + esc(a.APP_ID) + '"><i class="fas fa-mobile-screen"></i> Preview</button><button class="btn sm" data-act="edit" data-id="' + esc(a.APP_ID) + '"><i class="fas fa-pen"></i> Edit</button>' +
                (a.STATUS === 'PUBLISHED' ? '<button class="btn sm" data-act="kill" data-id="' + esc(a.APP_ID) + '"><i class="fas fa-ban"></i> Kill</button>' : '<button class="btn sm pri" data-act="publish" data-id="' + esc(a.APP_ID) + '" ' + (P.admin ? '' : 'disabled') + '><i class="fas fa-paper-plane"></i> Publish</button>') +
                '<button class="btn sm" data-act="check" data-id="' + esc(a.APP_ID) + '" title="Read the app back from APEX exactly as a phone would and check the code, the hash and the signature"><i class="fas fa-shield-halved"></i> Check</button><button class="btn sm ghost" data-act="delete" data-id="' + esc(a.APP_ID) + '">Delete</button></div></div>';
        }).join('') + '</div>';
        var bis = Object.keys(builtins()).filter(function (id) { return !appById(id); });
        if (bis.length) h += '<div class="card" style="margin-top:14px"><h2>Built into this version of the WMS</h2><div class="apps">' + bis.map(function (id) { var m = builtins()[id].manifest; return '<div class="app"><div class="row"><span class="ic">' + esc(m.icon || '📱') + '</span><div><div class="nm">' + esc(m.name) + '</div><div class="small muted mono">' + esc(id) + ' · v' + esc(m.version) + ' · ' + Math.round(builtins()[id].code.length / 1024) + ' KB</div></div></div><div class="ds">' + esc(m.description || '') + '</div><div class="acts"><button class="btn sm pri" data-act="addBuiltin" data-id="' + esc(id) + '"><i class="fas fa-plus"></i> Add to APEX</button><button class="btn sm" data-act="previewBuiltin" data-id="' + esc(id) + '"><i class="fas fa-mobile-screen"></i> Try it</button></div></div>'; }).join('') + '</div></div>';
        return h;
    }
    function loadApps() { return FAS.ensure().then(FAS.apps.list).then(function (r) { P.apps = r; paintTabs(); }); }
    function addBuiltin(id, open) {
        var b = builtins()[id]; if (!b) return Promise.reject(new Error('No built-in ' + id));
        var man = JSON.parse(JSON.stringify(b.manifest)); delete man.builtAt;
        return run('Adding ' + man.name + '…', function () {
            return FAS.apps.save({ appId: id, name: man.name, kind: 'CODE', version: 0, status: 'DRAFT', pod: '', icon: man.icon, manifest: JSON.stringify(man), code: b.code, notes: man.description || '' })
                .then(function () { return FAS.apps.setQueries(id, man.queries || {}); })
                .then(function () { return FAS.apps.setUsers(id, ['*']); })
                .then(loadApps).then(function () { toast(man.name + ' added as a draft — edit who gets it, then Publish', 'ok'); if (open) editApp(id); });
        });
    }
    function newFromCode(code, name, id) {
        id = (id || name || 'app').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'app';
        var man = { id: id, name: name || id, icon: '📱', kind: 'CODE', version: 1, description: '', chrome: false, queries: {}, kinds: [], settings: {} };
        return run('Saving ' + name + '…', function () {
            return FAS.apps.save({ appId: id, name: man.name, kind: 'CODE', version: 0, status: 'DRAFT', icon: man.icon, manifest: JSON.stringify(man), code: code, notes: '' }).then(function () { return FAS.apps.setUsers(id, []); }).then(loadApps).then(function () { editApp(id); });
        });
    }
    FAP.newFromCode = newFromCode;

    // editor
    function editApp(id) {
        run('Opening ' + id + '…', function () { return FAS.apps.get(id); }).then(function (a) {
            if (!a) { toast('App not found', 'bad'); return; }
            var man = a.manifest || {}; man.queries = a.QUERIES && Object.keys(a.QUERIES).length ? a.QUERIES : (man.queries || {});
            var users = (a.USERS || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
            var bi = builtins()[id];
            var html = '<div class="form">' +
                '<div class="field"><label>Name</label><input type="text" id="e-name" value="' + esc(a.NAME) + '"></div>' +
                '<div class="field"><label>Icon</label><input type="text" id="e-icon" value="' + esc(a.ICON || man.icon || '') + '" maxlength="4"></div>' +
                '<div class="field"><label>Pod (queries run on)</label><select id="e-pod"><option value="">Follows the phone</option><option ' + (a.POD === 'PROD' ? 'selected' : '') + '>PROD</option><option ' + (a.POD === 'TEST' ? 'selected' : '') + '>TEST</option></select></div>' +
                '<div class="field"><label>Expires (blank = never)</label><input type="datetime-local" id="e-exp" value="' + esc(a.EXPIRES_AT || '') + '"></div>' +
                '<div class="field wide"><label>Description</label><input type="text" id="e-notes" value="' + esc(a.NOTES || man.description || '') + '"></div>' +
                '<div class="field wide"><label>Who gets it — one login per line, or tick everyone</label><label class="chk"><input type="checkbox" id="e-all" ' + (users.indexOf('*') >= 0 ? 'checked' : '') + '> everyone with the mobile app</label><textarea id="e-users" rows="3" placeholder="ravi&#10;sam">' + esc(users.filter(function (u) { return u !== '*'; }).join('\n')) + '</textarea><div class="chips" id="e-mu" style="margin-top:6px"><button class="btn sm" data-act="mobileUsers">Pick from the mobile app\'s users…</button></div></div>' +
                '<div class="field wide"><label>Settings (JSON — what the app reads as FA.ctx.settings: shop, currency, tenders, receipt…)</label><textarea id="e-settings" rows="8">' + esc(JSON.stringify(man.settings || {}, null, 2)) + '</textarea></div>' +
                '<div class="field wide"><label>Queries the app may ask for (read-only SELECT, {{POD}} {{USER}} {{DEVICE}} and the app\'s own {{PARAMS}} become literals; the phone never sends SQL)</label><div id="e-queries">' + Object.keys(man.queries).map(function (n) { return qRow(n, man.queries[n]); }).join('') + '</div><button class="btn sm" data-act="addQuery">+ Query</button></div>' +
                '<div class="field wide"><label>Code (one HTML file; the shell seals it: no network, no CDN — bundle what it needs)</label><div class="row"><button class="btn sm" data-act="codeFile">Load an HTML file…</button>' + (bi ? '<button class="btn sm" data-act="codeBuiltin">Take the built-in v' + esc(bi.manifest.version) + ' (' + Math.round(bi.code.length / 1024) + ' KB)</button>' : '') + '<span class="muted small" id="e-codelen">' + Math.round((a.CODE || '').length / 1024) + ' KB</span></div><textarea id="e-code" rows="10" spellcheck="false">' + esc(a.CODE || '') + '</textarea></div></div>';
            drawer({ title: '<span>' + esc(a.ICON || '📱') + ' ' + esc(a.NAME) + ' <span class="muted small mono">' + esc(id) + ' · v' + esc(a.VERSION) + ' · ' + esc(a.STATUS) + '</span></span>', html: html, foot: '<button class="btn" data-act="drawerClose">Cancel</button><span class="sp"></span><button class="btn" data-act="edPreview">Preview</button><button class="btn" data-act="edSave">Save draft</button><button class="btn pri" data-act="edPublish" ' + (P.admin ? '' : 'disabled title="AI admins only"') + '>Save & publish</button>', state: { id: id, app: a, man: man } });
        });
    }
    function qRow(name, q) { q = q || {}; return '<div class="card" style="padding:10px;margin-bottom:8px" data-q="1"><div class="row"><input type="text" class="qn" value="' + esc(name) + '" placeholder="name" style="width:160px"><input type="number" class="qm" value="' + esc(q.maxRows || 5000) + '" style="width:110px" title="max rows"><span class="sp"></span><button class="btn sm ghost" data-act="rmQuery">remove</button></div><textarea class="qs" rows="3" spellcheck="false">' + esc(q.sql || '') + '</textarea></div>'; }
    function readEditor() {
        var st = P.drawer.state, a = st.app, man = st.man;
        man.name = $('e-name').value.trim() || a.NAME; man.icon = $('e-icon').value.trim(); man.description = $('e-notes').value.trim();
        try { man.settings = JSON.parse($('e-settings').value || '{}'); } catch (e) { throw new Error('Settings are not valid JSON: ' + e.message); }
        var qs = {}; [].forEach.call(document.querySelectorAll('#e-queries [data-q]'), function (el) { var n = el.querySelector('.qn').value.trim(); if (n) qs[n] = { sql: el.querySelector('.qs').value.trim(), maxRows: +el.querySelector('.qm').value || 5000 }; });
        man.queries = qs;
        var users = $('e-all').checked ? ['*'] : $('e-users').value.split(/\n|,/).map(function (s) { return s.trim(); }).filter(Boolean);
        return { appId: st.id, name: man.name, icon: man.icon, pod: $('e-pod').value, expiresAt: $('e-exp').value || '', notes: man.description, manifestObj: man, code: $('e-code').value, users: users, queries: qs, version: +a.VERSION || 0, status: a.STATUS };
    }
    function saveDraft(e) {
        return run('Saving…', function () {
            return FAS.apps.save({ appId: e.appId, name: e.name, kind: 'CODE', version: e.version, status: e.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT', pod: e.pod, icon: e.icon, manifest: JSON.stringify(e.manifestObj), code: e.code, expiresAt: e.expiresAt, notes: e.notes, codeSha256: null, manifestSha256: null, signature: null, keyId: null })
                .then(function () { return FAS.apps.setUsers(e.appId, e.users); }).then(function () { return FAS.apps.setQueries(e.appId, e.queries); }).then(loadApps);
        });
    }
    /** Sign and publish: version + 1, the code and manifest written to APEX and READ BACK — only code that APEX kept
     *  exactly (same SHA-256) is signed with the host's ECDSA key, the public key published, the row set PUBLISHED.
     *  A damaged round trip leaves the row a draft with no signature and says where the stored code differs. */
    function publish(e) {
        var man = e.manifestObj, version = (e.version || 0) + 1; man.version = version;
        var manifest = JSON.stringify(man), code = e.code;
        if (!code || code.length < 20) return Promise.reject(new Error('The app has no code'));
        var row = { appId: e.appId, name: e.name, kind: 'CODE', version: version, pod: e.pod, icon: e.icon, expiresAt: e.expiresAt, notes: e.notes };
        return run('Publishing ' + e.name + '…', function (step) {
            return Promise.all([FAS.sha256(code), FAS.sha256(manifest)]).then(function (h) {
                step('Writing ' + e.name + ' to APEX (' + Math.round(FAS.utf8Len(code) / 1024) + ' KB)…');
                return FAS.apps.save(Object.assign({}, row, { status: 'DRAFT', manifest: manifest, code: code, codeSha256: h[0], manifestSha256: h[1], signature: null, keyId: null })).then(function () {
                    step('Reading it back from APEX…');
                    return FAS.apps.check(e.appId, code, manifest);
                }).then(function (c) {
                    if (!c.ok) { var d = c.diff; throw new Error('Not published: ' + c.why + (d ? ' — expected “' + d.expected.slice(0, 24) + '”, found “' + d.got.slice(0, 24) + '” (' + d.lenB.toLocaleString() + ' of ' + d.lenA.toLocaleString() + ' characters kept)' : '') + '. The app stays a draft; the phones keep the version they have.'); }
                    step('Signing…');
                    var payload = e.appId + '.' + version + '.' + h[0] + '.' + h[1];
                    return FAS.hostOk('fieldAppSign', { payload: payload, appId: e.appId, version: String(version) }).then(function (s) {
                        return FAS.keys.ensure({ keyId: s.keyId, spki: s.spki }).then(function (list) {
                            P.keys = list;
                            return FAS.apps.save(Object.assign({}, row, { status: 'PUBLISHED', codeSha256: h[0], manifestSha256: h[1], signature: s.signature, keyId: s.keyId, publish: true }));
                        });
                    });
                });
            }).then(function () { return FAS.apps.setUsers(e.appId, e.users); }).then(function () { return FAS.apps.setQueries(e.appId, e.queries); }).then(function () { return FAS.apps.check(e.appId); }).then(function (c) {
                if (!c.ok || !c.signed) throw new Error('Published, but the check after publishing failed: ' + c.why);
                return loadApps();
            }).then(function () { toast(e.name + ' v' + version + ' published to ' + (e.users.indexOf('*') >= 0 ? 'everyone' : e.users.length + ' user(s)') + ' — read back from APEX and verified, the phones see it within a minute', 'ok'); });
        });
    }
    /** Apps › Check: reads the app back exactly as a phone would and says whether it will run there. */
    function checkApp(id) {
        return run('Checking ' + id + ' in APEX…', function () { return FAS.apps.check(id); }).then(function (c) {
            if (!c) return;
            var where = c.diff ? ' — first difference at character ' + c.diff.at.toLocaleString() + ' (line ' + c.diff.line + '): expected “' + c.diff.expected.slice(0, 24) + '”, found “' + c.diff.got.slice(0, 24) + '”' : '';
            if (c.ok && c.signed) toast('✓ ' + id + ' v' + c.version + ': the code in APEX is exactly what was signed (' + c.len.toLocaleString() + ' characters, ' + Math.round(c.bytes / 1024) + ' KB, SHA-256 ' + c.codeSha.slice(0, 12) + '…, key ' + c.keyId + ') — the phones will run it', 'ok', 9000);
            else if (c.ok) toast(id + ' v' + c.version + ': ' + c.why + ' (' + c.len.toLocaleString() + ' characters read back intact) — Publish signs it', 'warn', 9000);
            else toast('✗ ' + id + ' v' + c.version + ': ' + c.why + where + ' — publish it again; the phones refuse this copy', 'bad', 12000);
        });
    }

    // ── Preview ───────────────────────────────────────────────────
    function previewOptions() {
        var opts = [];
        P.apps.forEach(function (a) { opts.push({ v: 'apex:' + a.APP_ID, t: (a.ICON || '📱') + ' ' + a.NAME + ' · v' + a.VERSION + ' · ' + a.STATUS.toLowerCase() + ' (APEX)' }); });
        Object.keys(builtins()).forEach(function (id) { opts.push({ v: 'builtin:' + id, t: (builtins()[id].manifest.icon || '📱') + ' ' + builtins()[id].manifest.name + ' · built-in v' + builtins()[id].manifest.version + ' (draft)' }); });
        if (P.draft) opts.push({ v: 'draft:' + P.draft.appId, t: '✏️ ' + P.draft.name + ' · unsaved editor draft' });
        return opts;
    }
    function vPreview() {
        var opts = previewOptions();
        if (!P.previewSrc && opts.length) P.previewSrc = opts[0].v;
        var sz = SIZES[P.previewSize] || SIZES.handheld;
        var h = '<div class="pv"><div><div class="phone" id="phone"><iframe id="pvframe" title="phone" allow="camera; microphone; geolocation"></iframe></div></div><div class="pvside">';
        h += '<div class="card"><h2>This page is the phone\'s host</h2><div class="form">' +
            '<div class="field wide"><label>App</label><select id="pv-src">' + opts.map(function (o) { return '<option value="' + esc(o.v) + '" ' + (o.v === P.previewSrc ? 'selected' : '') + '>' + esc(o.t) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>Signed in as</label><input type="text" id="pv-user" value="' + esc(P.previewUser) + '"></div>' +
            '<div class="field"><label>Pod</label><select id="pv-pod"><option ' + (P.pod === 'PROD' ? 'selected' : '') + '>PROD</option><option ' + (P.pod === 'TEST' ? 'selected' : '') + '>TEST</option></select></div>' +
            '<div class="field"><label>Device</label><input type="text" id="pv-device" value="' + esc(P.previewDevice) + '"></div>' +
            '<div class="field"><label>Network</label><div class="row"><label class="chk"><input type="checkbox" id="pv-online" ' + (P.previewOnline ? 'checked' : '') + '> online</label></div></div>' +
            '<div class="field"><label>Size</label><select id="pv-size">' + Object.keys(SIZES).map(function (k) { return '<option value="' + k + '" ' + (P.previewSize === k ? 'selected' : '') + '>' + esc(SIZES[k][2]) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>Zoom</label><select id="pv-zoom">' + ['fit', '75', '100', '125'].map(function (z) { return '<option value="' + z + '" ' + (P.previewZoom === z ? 'selected' : '') + '>' + (z === 'fit' ? 'Fit the window' : z + ' %') + '</option>'; }).join('') + '</select></div>' +
            '</div><div class="row" style="margin-top:10px"><button class="btn pri" data-act="pvReload"><i class="fas fa-rotate"></i> Reload</button><button class="btn" data-act="pvRotate"><i class="fas fa-rotate-right"></i> Rotate</button><span class="sp"></span><input type="text" id="pv-scan" placeholder="barcode" style="width:150px"><button class="btn" data-act="pvScan"><i class="fas fa-barcode"></i> Scan</button><button class="btn" data-act="pvBack">Back</button></div></div>';
        h += '<div class="card"><h2>Console <span class="muted small">(the app\'s FA.log, errors, every host call)</span> <button class="btn sm ghost" data-act="pvClear">clear</button></h2><div class="log" id="pv-log">' + P.log.map(logLine).join('') + '</div></div>';
        h += '<div class="card"><h2>Sent from this preview</h2>' + (P.sent.length ? '<table class="tbl"><tr><th>At</th><th>Kind</th><th>Ref</th><th class="r">Amount</th><th>Status</th></tr>' + P.sent.map(function (s) { return '<tr><td>' + esc(s.at) + '</td><td>' + esc(s.kind) + '</td><td class="mono">' + esc(s.ref || s.subId) + '</td><td class="r money">' + (s.amount != null ? esc(money(s.amount)) : '') + '</td><td><span class="pill ' + (s.status === 'DONE' ? 'ok' : s.status === 'ERROR' ? 'bad' : 'info') + '">' + esc(s.status) + '</span>' + (s.error ? ' <span class="small bad">' + esc(s.error) + '</span>' : '') + '</td></tr>'; }).join('') + '</table>' : '<div class="muted small">Nothing yet — complete a sale, upload a photo.</div>') + '</div>';
        return h + '</div></div>';
    }
    function logLine(l) { return '<div class="' + (l.k || '') + '">' + esc(l.t) + ' ' + esc(l.m) + '</div>'; }
    function log(m, k) { var t = new Date().toTimeString().slice(0, 8); P.log.push({ t: t, m: m, k: k || '' }); if (P.log.length > 300) P.log.shift(); var el = $('pv-log'); if (el) { el.insertAdjacentHTML('beforeend', logLine(P.log[P.log.length - 1])); el.scrollTop = el.scrollHeight; } }
    function sizePhone() {
        var ph = $('phone'), fr = $('pvframe'); if (!ph || !fr) return;
        var sz = SIZES[P.previewSize] || SIZES.handheld, w = P.previewRot ? sz[1] : sz[0], hh = P.previewRot ? sz[0] : sz[1];
        var scale = P.previewZoom === 'fit' ? Math.max(0.4, Math.min(1.4, (window.innerHeight - 54 - 46 - 32 - 20) / (hh + 28))) : (+P.previewZoom || 100) / 100;
        fr.style.width = w + 'px'; fr.style.height = hh + 'px'; fr.style.transform = 'scale(' + scale.toFixed(3) + ')'; fr.style.transformOrigin = 'top left';
        ph.style.width = Math.round((w + 28) * scale) + 'px'; ph.style.height = Math.round((hh + 28) * scale) + 'px';
    }
    window.addEventListener('resize', function () { if (P.tab === 'preview') sizePhone(); });
    function previewBundle() {
        var src = P.previewSrc || '', kind = src.split(':')[0], id = src.slice(kind.length + 1);
        if (kind === 'builtin') { var b = builtins()[id]; return Promise.resolve({ appId: id, name: b.manifest.name, version: b.manifest.version, manifest: JSON.stringify(b.manifest), manifestObj: b.manifest, code: b.code, signature: '', keyId: '', codeSha256: '', unsigned: true, queries: b.manifest.queries || {} }); }
        if (kind === 'draft' && P.draft) { var d = P.draft; return Promise.resolve({ appId: d.appId, name: d.name, version: d.version, manifest: JSON.stringify(d.manifestObj), manifestObj: d.manifestObj, code: d.code, signature: '', keyId: '', unsigned: true, queries: d.queries || {} }); }
        return FAS.apps.get(id).then(function (a) {
            if (!a) throw new Error('App ' + id + ' not found');
            return { appId: id, name: a.NAME, version: a.VERSION, manifest: a.MANIFEST, manifestObj: a.manifest, code: a.CODE, signature: a.SIGNATURE || '', keyId: a.KEY_ID || '', codeSha256: a.CODE_SHA256 || '', expiresAt: a.EXPIRES_AT, unsigned: a.STATUS !== 'PUBLISHED' || !a.SIGNATURE, queries: a.QUERIES && Object.keys(a.QUERIES).length ? a.QUERIES : (a.manifest.queries || {}) };
        });
    }
    var cur = { bundle: null };
    function mountPreview() {
        sizePhone();
        var fr = $('pvframe'); if (!fr) return;
        var src = P.previewSrc || '', id = src.slice(src.indexOf(':') + 1);
        cur.bundle = null;
        FAH.attach(fr, {
            user: function () { return P.previewUser; }, device: function () { return P.previewDevice; }, pod: function () { return P.pod; }, online: function () { return P.previewOnline; },
            keys: function () { return P.keys; }, allowUnsigned: function () { return true; }, appId: function () { return id; }, settings: function () { return {}; },
            bundle: function () { log('bundle ' + src, 'q'); return previewBundle().then(function (b) { cur.bundle = b; log('bundle read · ' + FAS.cpLen(b.code).toLocaleString() + ' characters · ' + Math.round(FAS.utf8Len(b.code) / 1024) + ' KB · ' + (b.unsigned ? 'draft (not signed)' : 'signed ' + b.keyId + ' — the shell verifies it next'), 'ok'); return b; }); },
            query: function (name, params) {
                var b = cur.bundle; if (!b) return Promise.reject(new Error('no bundle'));
                var q = (b.queries || {})[name]; if (!q || !q.sql) return Promise.reject(new Error('No query "' + name + '" in the app'));
                var sql = String(q.sql); var vals = Object.assign({ POD: P.pod, USER: P.previewUser, DEVICE: P.previewDevice }, params || {});
                Object.keys(vals).forEach(function (k) { sql = sql.split('{{' + String(k).toUpperCase() + '}}').join(vals[k] == null ? 'NULL' : FAS.lit(vals[k])); });
                sql = sql.replace(/\{\{[A-Za-z0-9_]+\}\}/g, 'NULL');
                log('query ' + name + ' ' + JSON.stringify(params || {}), 'q');
                return FAS.rowsAll(sql, q.maxRows || 5000).then(function (r) { log('query ' + name + ' → ' + r.length + ' rows', 'ok'); return r; }, function (e) { log('query ' + name + ' failed: ' + e.message, 'e'); throw e; });
            },
            submit: function (a) {
                log('submit ' + a.kind + ' ' + (a.ref || a.subId) + (a.amount != null ? ' · ' + money(a.amount) : ''), 'q');
                var rec = { at: new Date().toTimeString().slice(0, 8), kind: a.kind, ref: a.ref, subId: a.subId, amount: a.amount, status: '…' };
                P.sent.unshift(rec);
                return FAS.subs.put({ subId: a.subId, app: a.app || id, kind: a.kind, ref: a.ref, amount: a.amount, doc: a.doc, user: P.previewUser, device: P.previewDevice }).then(function (r) { rec.status = r.status; rec.error = r.error; log('submit ' + a.kind + ' → ' + r.status + (r.error ? ' ' + r.error : ''), r.status === 'ERROR' ? 'e' : 'ok'); refreshSentTable(); return r; }, function (e) { rec.status = 'FAILED'; rec.error = e.message; log('submit failed: ' + e.message, 'e'); refreshSentTable(); throw e; });
            },
            upload: function (a) {
                var ph = a.photo || {}, meta = Object.assign({ app: id }, a.meta || {}, { width: ph.width, height: ph.height, taken: ph.at });
                log('upload photo ' + (meta.id || '') + ' ' + Math.round((ph.dataUrl || '').length * 0.75 / 1024) + ' KB', 'q');
                var rec = { at: new Date().toTimeString().slice(0, 8), kind: 'photo', ref: meta.trip || meta.ref1 || meta.id, status: '…' }; P.sent.unshift(rec);
                return FAS.photos.upload(ph.dataUrl, meta).then(function (r) { rec.status = 'DONE'; rec.ref = r.photoId; log('photo stored ' + r.photoId, 'ok'); refreshSentTable(); return { ok: true, photoId: r.photoId }; }, function (e) { rec.status = 'FAILED'; rec.error = e.message; log('upload failed: ' + e.message, 'e'); refreshSentTable(); throw e; });
            },
            photo: function (a) { log('photo requested', 'q'); return capture(a); },
            scan: function () { log('scan requested', 'q'); return new Promise(function (res) { var v = prompt('Scan — type a barcode:', ''); res(v ? { code: v, format: 'manual' } : null); }); },
            print: function (a) { log('print ' + (a.title || '') + ' × ' + (a.copies || 1), 'q'); printDoc(a); return true; },
            log: function (a) { log(a.m, a.level === 'error' ? 'e' : ''); },
            ready: function () { log('app ready', 'ok'); }, error: function (e) { log('app error: ' + e, 'e'); },
            open: function (appId) { P.previewSrc = 'apex:' + appId; render(); return true; }, close: function () { log('app asked to close'); return true; }
        });
        FAS.keys.list().then(function (k) { P.keys = k; }).catch(function () { }).then(function () { fr.src = 'runtime/shell.html?' + Date.now() + '#app=' + encodeURIComponent(id); });
    }
    function refreshSentTable() { if (P.tab === 'preview') { var m = $('main'); var tmp = document.createElement('div'); tmp.innerHTML = vPreview(); var cards = tmp.querySelectorAll('.pvside .card'), live = m.querySelectorAll('.pvside .card'); if (cards.length === live.length) live[live.length - 1].innerHTML = cards[cards.length - 1].innerHTML; } }
    /** Photo for the preview: webcam or a file, resized to 1600 px. */
    function capture(a) {
        return new Promise(function (resolve) {
            var html = '<div class="row"><video id="cap-v" autoplay playsinline style="width:100%;max-height:360px;background:#000;border-radius:10px"></video></div><div class="row" style="margin-top:10px"><button class="btn pri" data-act="capSnap"><i class="fas fa-camera"></i> Take the picture</button><label class="btn">Choose a file <input type="file" id="cap-f" accept="image/*" hidden></label><span class="sp"></span><span class="muted small" id="cap-msg"></span></div>';
            drawer({ title: '📷 ' + esc(a && a.title || 'Photo'), html: html, foot: '<button class="btn" data-act="capCancel">Cancel</button>', state: { kind: 'capture', resolve: resolve, stream: null } });
            var v = $('cap-v');
            var msg = function (t) { var el = $('cap-msg'); if (el) el.textContent = t; };
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false }).then(function (s) { if (!P.drawer || P.drawer.state.kind !== 'capture') { s.getTracks().forEach(function (t) { t.stop(); }); return; } P.drawer.state.stream = s; v.srcObject = s; }, function (e) { msg('No camera here (' + e.message + ') — choose a file'); });
            else msg('No camera here — choose a file');
            $('cap-f').addEventListener('change', function () { var f = this.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { shrink(r.result).then(finishCapture); }; r.readAsDataURL(f); });
            function finishCapture(img) { var st = P.drawer && P.drawer.state; if (st && st.stream) st.stream.getTracks().forEach(function (t) { t.stop(); }); closeDrawer(); resolve(Object.assign({ at: POSE.nowIso(), gps: null }, img)); }
            P.drawer.state.snap = function () { var c = document.createElement('canvas'); c.width = v.videoWidth || 1280; c.height = v.videoHeight || 720; c.getContext('2d').drawImage(v, 0, 0); shrink(c.toDataURL('image/jpeg', 0.9)).then(finishCapture); };
            P.drawer.state.cancel = function () { var st = P.drawer.state; if (st.stream) st.stream.getTracks().forEach(function (t) { t.stop(); }); closeDrawer(); resolve(null); };
        });
    }
    function shrink(dataUrl, max) {
        max = max || 1600;
        return new Promise(function (res) { var im = new Image(); im.onload = function () { var s = Math.min(1, max / Math.max(im.width, im.height)); var c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res({ dataUrl: c.toDataURL('image/jpeg', 0.85), width: c.width, height: c.height }); }; im.onerror = function () { res({ dataUrl: dataUrl, width: 0, height: 0 }); }; im.src = dataUrl; });
    }
    function printDoc(a) {
        var html = a.html || ('<pre style="font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;white-space:pre">' + esc(a.text || '') + '</pre>');
        var f = document.createElement('iframe'); f.style.position = 'fixed'; f.style.right = '0'; f.style.bottom = '0'; f.style.width = '1px'; f.style.height = '1px'; f.style.opacity = '0';
        document.body.appendChild(f);
        f.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(a.title || 'Receipt') + '</title><style>@page{margin:6mm}body{margin:0}</style></head><body>' + html + '</body></html>';
        f.onload = function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { } setTimeout(function () { try { document.body.removeChild(f); } catch (e) { } }, 60000); };
    }

    // ── Results ───────────────────────────────────────────────────
    function vResults() {
        var f = P.subsF;
        var h = '<div class="card"><div class="row"><input type="text" id="rf-app" placeholder="app" value="' + esc(f.app || '') + '" style="width:120px"><input type="text" id="rf-kind" placeholder="kind (pos_sale…)" value="' + esc(f.kind || '') + '" style="width:150px"><select id="rf-status"><option value="">any status</option>' + ['NEW', 'DONE', 'ERROR'].map(function (s) { return '<option ' + (f.status === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') + '</select><input type="text" id="rf-user" placeholder="user" value="' + esc(f.user || '') + '" style="width:120px"><input type="date" id="rf-from" value="' + esc(f.from || '') + '"><input type="date" id="rf-to" value="' + esc(f.to || '') + '"><button class="btn pri" data-act="subsLoad"><i class="fas fa-magnifying-glass"></i> Search</button><span class="sp"></span><button class="btn" data-act="subsProcess"><i class="fas fa-gears"></i> Process new</button><button class="btn" data-act="subsCsv">CSV</button></div></div>';
        if (!P.subs.length) h += '<div class="card empty">No submissions match. Phones send sales, shifts, counts and reports here; the preview tab does too.</div>';
        else h += '<div class="card" style="padding:0"><table class="tbl"><tr><th>Received</th><th>App</th><th>Kind</th><th>User</th><th>Device</th><th>Ref</th><th class="r">Amount</th><th>Status</th><th></th></tr>' + P.subs.map(function (s) { return '<tr><td>' + esc(fmt(s.CREATED)) + '</td><td class="mono">' + esc(s.APP_ID) + '</td><td>' + esc(s.KIND) + '</td><td>' + esc(s.USERNAME) + '</td><td class="mono small">' + esc(s.DEVICE_ID) + '</td><td class="mono">' + esc(s.DOC_REF || '') + '</td><td class="r money">' + (s.AMOUNT != null ? esc(money(s.AMOUNT)) : '') + '</td><td><span class="pill ' + (s.STATUS === 'DONE' ? 'ok' : s.STATUS === 'ERROR' ? 'bad' : 'info') + '" title="' + esc(s.ERROR_TEXT || '') + '">' + esc(s.STATUS) + '</span></td><td class="act"><button class="btn sm" data-act="subView" data-id="' + esc(s.SUB_ID) + '">View</button></td></tr>'; }).join('') + '</table></div>';
        return h;
    }
    function loadSubs() { return FAS.ensure().then(function () { return FAS.subs.list(Object.assign({ max: 300 }, P.subsF)); }).then(function (r) { P.subs = r; paintTabs(); }); }

    // ── Photos ────────────────────────────────────────────────────
    function vPhotos() {
        var f = P.photosF;
        var h = '<div class="card"><div class="row"><input type="text" id="pf-app" placeholder="app" value="' + esc(f.app || '') + '" style="width:120px"><input type="text" id="pf-trip" placeholder="trip" value="' + esc(f.trip || '') + '" style="width:110px"><input type="text" id="pf-user" placeholder="user" value="' + esc(f.user || '') + '" style="width:120px"><input type="date" id="pf-from" value="' + esc(f.from || '') + '"><input type="date" id="pf-to" value="' + esc(f.to || '') + '"><button class="btn pri" data-act="photosLoad"><i class="fas fa-magnifying-glass"></i> Search</button><span class="sp"></span><span class="muted small">Pictures the phones took · counted and checked by this PC\'s vision worker (OpenCV / YOLO)</span></div></div>';
        if (!P.photos.length) h += '<div class="card empty">No photos yet. A bay photo taken in an app lands here with its trip, bay, GPS and who took it.</div>';
        else h += '<div class="thumbs">' + P.photos.map(function (p) { var vc = p.VISION_COUNT != null ? '<span class="pill ' + (p.EXPECTED_COUNT != null ? (+p.VISION_COUNT === +p.EXPECTED_COUNT ? 'ok' : 'bad') : 'info') + '">' + esc(p.VISION_OP) + ' ' + esc(p.VISION_COUNT) + (p.EXPECTED_COUNT != null ? ' / ' + esc(p.EXPECTED_COUNT) : '') + '</span>' : ''; return '<div class="thumb" data-act="photoOpen" data-id="' + esc(p.PHOTO_ID) + '"><div class="im" id="th-' + esc(p.PHOTO_ID) + '">' + Math.round((+p.BYTES || 0) / 1024) + ' KB · click to load</div><div class="cap"><b>' + esc(p.TRIP_ID ? 'Trip ' + p.TRIP_ID : (p.REF1 || p.APP_ID)) + '</b>' + (p.BAY ? ' · bay ' + esc(p.BAY) : '') + '<br>' + esc(fmt(p.TAKEN)) + ' · ' + esc(p.USERNAME) + ' ' + vc + '</div></div>'; }).join('') + '</div>';
        return h;
    }
    function loadPhotos() { return FAS.ensure().then(function () { return FAS.photos.list(Object.assign({ max: 200 }, P.photosF)); }).then(function (r) { P.photos = r; }); }
    function openPhoto(id) {
        var p = P.photos.filter(function (x) { return x.PHOTO_ID === id; })[0]; if (!p) return;
        var html = '<div class="grid2"><div><div id="ph-img" class="muted">Loading the picture…</div></div><div><div class="kv">' + [['Taken', fmt(p.TAKEN)], ['By', p.USERNAME + ' · ' + p.DEVICE_ID], ['App', p.APP_ID], ['Trip', p.TRIP_ID], ['Bay', p.BAY], ['Ref', [p.REF1, p.REF2].filter(Boolean).join(' · ')], ['GPS', p.LAT != null ? p.LAT + ', ' + p.LNG : ''], ['Size', p.WIDTH + ' × ' + p.HEIGHT + ' · ' + Math.round((+p.BYTES || 0) / 1024) + ' KB'], ['Note', p.NOTE]].map(function (kv) { return '<div class="k">' + esc(kv[0]) + '</div><div>' + esc(kv[1] || '') + '</div>'; }).join('') + '</div>' +
            '<h3>Vision on this PC</h3><div class="row"><button class="btn" data-act="vis" data-op="count"><i class="fas fa-hashtag"></i> Count objects</button><button class="btn" data-act="vis" data-op="detect"><i class="fas fa-box"></i> Detect (YOLO)</button><button class="btn" data-act="vis" data-op="barcodes"><i class="fas fa-barcode"></i> Barcodes</button><button class="btn" data-act="vis" data-op="ocr"><i class="fas fa-font"></i> Read text</button></div>' +
            '<div class="row" style="margin-top:8px"><label class="small muted">Expected</label><input type="number" id="ph-exp" value="' + esc(p.EXPECTED_COUNT != null ? p.EXPECTED_COUNT : '') + '" style="width:100px"><button class="btn sm" data-act="phExp">Save</button><span class="sp"></span>' + (p.VISION_COUNT != null ? '<span class="pill ' + (p.EXPECTED_COUNT != null ? (+p.VISION_COUNT === +p.EXPECTED_COUNT ? 'ok' : 'bad') : 'info') + '">' + esc(p.VISION_OP) + ' → ' + esc(p.VISION_COUNT) + (p.EXPECTED_COUNT != null ? ' of ' + esc(p.EXPECTED_COUNT) + ' expected' : '') + ' · ' + esc(fmt(p.VISION_AT)) + '</span>' : '') + '</div>' +
            '<div id="ph-vis" style="margin-top:10px"></div></div></div>';
        drawer({ title: '📷 ' + esc(p.TRIP_ID ? 'Trip ' + p.TRIP_ID : p.REF1 || p.APP_ID) + (p.BAY ? ' · bay ' + esc(p.BAY) : ''), html: html, foot: '<button class="btn" data-act="drawerClose">Close</button>', state: { kind: 'photo', p: p, img: null } });
        FAS.photos.image(id).then(function (d) { P.drawer.state.img = d; var el = $('ph-img'); if (el) el.innerHTML = '<img class="photo-big" src="' + d + '">'; var th = $('th-' + id); if (th) { th.style.backgroundImage = 'url(' + d + ')'; th.textContent = ''; } }, function (e) { var el = $('ph-img'); if (el) el.innerHTML = '<div class="badbox">' + esc(e.message) + '</div>'; });
        FAS.photos.vision(id).then(function (v) { if (v) showVision(v, p.VISION_OP); });
    }
    function showVision(v, op) {
        var el = $('ph-vis'); if (!el) return;
        var res = v.result || v, imgs = v.images || [];
        var cnt = countOf(res);
        el.innerHTML = '<div class="okbox">' + esc(op) + ': ' + (cnt != null ? '<b>' + cnt + '</b> found' : 'done') + (res && res.labels ? ' · ' + esc(Object.keys(res.labels).map(function (k) { return k + ' ' + res.labels[k]; }).join(', ')) : '') + (res && res.codes ? ' · ' + esc(res.codes.map(function (c) { return c.text || c.data || c; }).join(', ')) : '') + (res && res.text ? '<div class="mono small" style="margin-top:6px;white-space:pre-wrap">' + esc(String(res.text).slice(0, 1500)) + '</div>' : '') + '</div>' +
            imgs.filter(function (i) { return i && i.data; }).slice(0, 1).map(function (i) { return '<img class="photo-big" style="margin-top:8px" src="data:' + esc(i.media_type || 'image/png') + ';base64,' + i.data + '">'; }).join('') +
            '<details style="margin-top:8px"><summary class="muted small">raw result</summary><pre class="code">' + esc(JSON.stringify(res, null, 1).slice(0, 6000)) + '</pre></details>';
    }
    function countOf(r) { if (!r || typeof r !== 'object') return null; if (r.count != null) return +r.count; if (r.total != null) return +r.total; if (Array.isArray(r.objects)) return r.objects.length; if (Array.isArray(r.detections)) return r.detections.length; if (Array.isArray(r.codes)) return r.codes.length; if (r.counts && typeof r.counts === 'object') return Object.keys(r.counts).reduce(function (a, k) { return a + (+r.counts[k] || 0); }, 0); return null; }
    function runVision(op) {
        var st = P.drawer && P.drawer.state; if (!st || !st.img) { toast('Wait for the picture to load', 'warn'); return; }
        var params = op === 'detect' ? { imgsz: 1280 } : op === 'count' ? {} : {};
        run('Running ' + op + ' on this PC…', function () {
            return FAS.hostOk('visionRun', { op: op, params: params, via: 'tab', images: [{ name: st.p.PHOTO_ID + '.jpg', data: st.img.split(',')[1] }] }, 300000).then(function (r) {
                var cnt = countOf(r.result);
                showVision(r, op);
                return FAS.photos.saveVision(st.p.PHOTO_ID, op, { result: r.result, images: (r.images || []).slice(0, 1) }, cnt).then(function () { st.p.VISION_OP = op; st.p.VISION_COUNT = cnt; st.p.VISION_AT = new Date().toISOString(); toast(op + ' saved' + (cnt != null ? ': ' + cnt : ''), 'ok'); if (P.tab === 'photos') { var m = $('main'); if (m) m.innerHTML = vPhotos(); } });
            });
        });
    }

    // ── POS console ───────────────────────────────────────────────
    function vPos() {
        var f = P.salesF, tot = { n: 0, net: 0, ret: 0, retNet: 0, tax: 0, disc: 0 };
        P.sales.forEach(function (s) { if (s.KIND === 'RETURN') { tot.ret++; tot.retNet += +s.ROUNDED || 0; } else { tot.n++; tot.net += +s.ROUNDED || 0; } tot.tax += +s.TAX || 0; tot.disc += +s.DISC || 0; });
        var h = '<div class="card"><div class="row"><select id="ps-pod"><option ' + (P.pod === 'PROD' ? 'selected' : '') + '>PROD</option><option ' + (P.pod === 'TEST' ? 'selected' : '') + '>TEST</option></select><input type="date" id="ps-from" value="' + esc(f.from) + '"><input type="date" id="ps-to" value="' + esc(f.to) + '"><button class="btn pri" data-act="salesLoad"><i class="fas fa-magnifying-glass"></i> Show</button><span class="sp"></span><button class="btn" data-act="itemsImport"><i class="fas fa-upload"></i> Import items</button><button class="btn" data-act="custImport"><i class="fas fa-users"></i> Import customers</button><button class="btn" data-act="salesCsv">CSV</button></div></div>';
        h += '<div class="kpis"><div class="kpi"><div class="l">Sales</div><div class="v">' + tot.n + '</div><div class="s money">' + esc(money(tot.net)) + '</div></div><div class="kpi"><div class="l">Returns</div><div class="v">' + tot.ret + '</div><div class="s money">' + esc(money(tot.retNet)) + '</div></div><div class="kpi"><div class="l">VAT</div><div class="v money">' + esc(money(tot.tax)) + '</div></div><div class="kpi"><div class="l">Discounts</div><div class="v money">' + esc(money(tot.disc)) + '</div></div>' + P.tenders.map(function (t) { return '<div class="kpi"><div class="l">' + esc(t.TENDER) + '</div><div class="v money">' + esc(money(t.AMOUNT)) + '</div><div class="s">' + esc(t.N) + ' payments</div></div>'; }).join('') +
            '<div class="kpi"><div class="l">Catalogue · ' + esc(P.pod) + '</div><div class="v">' + (P.itemsN ? esc(P.itemsN.N) : '0') + '</div><div class="s">items · ' + (P.custN ? esc(P.custN.N) : '0') + ' customers</div></div></div>';
        h += '<div class="grid2"><div class="card" style="padding:0"><table class="tbl"><tr><th>Done</th><th>No</th><th>Device · user</th><th>Customer</th><th class="r">Lines</th><th class="r">Total</th><th>Kind</th><th></th></tr>' + (P.sales.length ? P.sales.map(function (s) { return '<tr><td>' + esc(fmt(s.DONE_AT)) + '</td><td class="mono">' + esc(s.SALE_NUMBER) + '</td><td class="small">' + esc(s.DEVICE_ID) + ' · ' + esc(s.USERNAME) + '</td><td>' + esc(s.CUSTOMER_NAME || '') + '</td><td class="r">' + esc(s.LINES_N) + '</td><td class="r money">' + esc(money(s.ROUNDED)) + '</td><td>' + (s.KIND === 'RETURN' ? '<span class="pill bad">return</span>' : '<span class="pill ok">sale</span>') + '</td><td class="act"><button class="btn sm" data-act="saleView" data-id="' + esc(s.SALE_ID) + '">View</button></td></tr>'; }).join('') : '<tr><td colspan="8" class="empty">No sales in this range</td></tr>') + '</table></div>' +
            '<div><div class="card" style="padding:0"><table class="tbl"><tr><th>Shift</th><th>Device · user</th><th class="r">Float</th><th class="r">Expected</th><th class="r">Counted</th><th class="r">Diff</th><th>Status</th></tr>' + (P.shifts.length ? P.shifts.map(function (s) { return '<tr><td>' + esc(fmt(s.OPENED_AT)) + (s.CLOSED_AT ? ' → ' + esc(fmt(s.CLOSED_AT).slice(11)) : '') + '</td><td class="small">' + esc(s.DEVICE_ID) + ' · ' + esc(s.USERNAME) + '</td><td class="r money">' + esc(money(s.FLOAT_AMT)) + '</td><td class="r money">' + (s.EXPECTED != null ? esc(money(s.EXPECTED)) : '') + '</td><td class="r money">' + (s.COUNTED != null ? esc(money(s.COUNTED)) : '') + '</td><td class="r money" style="color:' + (Math.abs(+s.VARIANCE || 0) > 0.005 ? 'var(--bad)' : 'inherit') + '">' + (s.VARIANCE != null ? esc(money(s.VARIANCE)) : '') + '</td><td><span class="pill ' + (s.STATUS === 'CLOSED' ? '' : 'ok') + '">' + esc(s.STATUS || '') + '</span></td></tr>'; }).join('') : '<tr><td colspan="7" class="empty">No shifts yet</td></tr>') + '</table></div>' +
            '<div class="card"><h2>Items · ' + esc(P.pod) + ' <span class="muted small">(what the tills sell — the Order Pad\'s price-list columns)</span></h2><div class="row"><input type="search" id="ps-iq" placeholder="search items" value="' + esc(P.itemsQ) + '"><button class="btn sm" data-act="itemsFind">Find</button></div>' + (P.items.length ? '<table class="tbl" style="margin-top:8px"><tr><th>Code</th><th>Description</th><th>Barcode</th><th class="r">Price</th><th>Tax</th><th class="r">Deposit</th><th>Category</th></tr>' + P.items.slice(0, 100).map(function (i) { return '<tr><td class="mono">' + esc(i.ITEM_CODE) + '</td><td>' + esc(i.DESCRIPTION) + '</td><td class="mono small">' + esc(i.BARCODE || '') + '</td><td class="r money">' + esc(money(i.LIST_PRICE)) + '</td><td class="small">' + esc(i.TAX_CODE || '') + '</td><td class="r">' + esc(i.CONS || '') + '</td><td class="small">' + esc(i.CATEGORY || '') + '</td></tr>'; }).join('') + '</table>' : '<div class="muted small" style="margin-top:8px">No items for this pod yet — <b>Import items</b> from a paste or an APEX SQL.</div>') + '</div></div></div>';
        return h;
    }
    function loadPos() {
        return FAS.ensure().then(function () {
            var f = { pod: P.pod, from: P.salesF.from, to: P.salesF.to };
            return Promise.all([FAS.pos.sales(f), FAS.pos.tenders(f), FAS.pos.shifts({ pod: P.pod }), FAS.pos.itemsCount(P.pod), FAS.pos.customersCount(P.pod), FAS.pos.items(P.pod, P.itemsQ, 100)]);
        }).then(function (r) { P.sales = r[0]; P.tenders = r[1]; P.shifts = r[2]; P.itemsN = r[3]; P.custN = r[4]; P.items = r[5]; });
    }
    function saleView(id) {
        var s = P.sales.filter(function (x) { return x.SALE_ID === id; })[0]; if (!s) return;
        run('Reading ' + s.SALE_NUMBER + '…', function () { return Promise.all([FAS.pos.saleLines(id), FAS.pos.payments(id)]); }).then(function (r) {
            var html = '<div class="kv">' + [['Number', s.SALE_NUMBER], ['Done', fmt(s.DONE_AT)], ['Device · user', s.DEVICE_ID + ' · ' + s.USERNAME], ['Customer', s.CUSTOMER_NAME ? s.CUSTOMER_NAME + ' (' + s.CUSTOMER_NUMBER + ')' : 'walk-in'], ['Shift', s.SHIFT_ID], ['Return of', s.RETURN_OF], ['MRA', s.MRA_STATUS]].map(function (kv) { return '<div class="k">' + esc(kv[0]) + '</div><div>' + esc(kv[1] || '') + '</div>'; }).join('') + '</div>' +
                '<table class="tbl" style="margin-top:10px"><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">List</th><th class="r">Sell</th><th class="r">Disc %</th><th class="r">VAT</th><th class="r">Deposit</th><th class="r">Crates</th><th class="r">Net</th></tr>' + r[0].map(function (l) { return '<tr><td>' + esc(l.LINE_NO) + '</td><td>' + esc(l.DESCRIPTION) + ' <span class="muted small mono">' + esc(l.ITEM_CODE) + '</span>' + (l.LINE_TYPE === 'RET' ? ' <span class="pill bad">return</span>' : '') + '</td><td class="r">' + esc(l.QTY) + '</td><td class="r money">' + esc(money(l.LIST_PRICE)) + '</td><td class="r money">' + esc(money(l.SELL_PRICE)) + '</td><td class="r">' + esc(l.DISC_PCT || 0) + '</td><td class="r money">' + esc(money(l.TAX)) + '</td><td class="r money">' + esc(money(l.CONS)) + '</td><td class="r money">' + esc(money(l.CRATES)) + '</td><td class="r money">' + esc(money(l.NET)) + '</td></tr>'; }).join('') + '</table>' +
                '<div class="kv" style="margin-top:10px"><div class="k">Subtotal</div><div class="money">' + esc(money(s.GROSS)) + '</div><div class="k">Discount</div><div class="money">' + esc(money(s.DISC)) + '</div><div class="k">VAT</div><div class="money">' + esc(money(s.TAX)) + '</div><div class="k">Deposits</div><div class="money">' + esc(money(s.CONS)) + '</div><div class="k">Crates</div><div class="money">' + esc(money(s.CRATES)) + '</div><div class="k"><b>Total</b></div><div class="money"><b>' + esc(money(s.ROUNDED)) + '</b></div></div>' +
                '<h3>Payments</h3><table class="tbl">' + r[1].map(function (p) { return '<tr><td>' + esc(p.TENDER) + (p.PAY_REF ? ' · ' + esc(p.PAY_REF) : '') + '</td><td>' + esc(p.AT || '') + '</td><td class="r money">' + esc(money(p.AMOUNT)) + '</td></tr>'; }).join('') + '</table>';
            drawer({ title: '🧾 ' + esc(s.SALE_NUMBER) + ' · ' + esc(money(s.ROUNDED)), html: html, foot: '<button class="btn" data-act="drawerClose">Close</button>', state: { kind: 'sale' } });
        });
    }
    function importDrawer(kind) {
        var isItems = kind === 'items';
        var html = '<div class="warnbox">Paste rows with a header line (tab or comma separated, straight from Excel). ' + (isItems ? 'Columns are found by name like the Order Pad: ITEM_NUMBER / ITEM_CODE, ITEM_DESC / DESCRIPTION, UOM, LIST_PRICE / PRICE, TAX_CODE, CONS, CRT_ITEM_CODE, CRT, CRT_MIN_QTY, CRT_DEFAULT_QTY, CATEGORY, SUB_CATEGORY, BRAND, SUPPLIER, PROFIT_CENTER, GROUPCODE, BARCODE, ITEM_TYPE, IMAGE_URL.' : 'Columns: CUSTOMER_NUMBER, CUSTOMER_NAME, CUSTOMER_CATEGORY, CUSTOMER_CLASS, CREDIT_LIMIT, VAT, BRN, PHONE, ADDRESS, PRICE_LIST.') + ' Or run an APEX SQL that returns those columns (a Fusion SQL dataset FSQ_… table, a view, the Order Pad\'s tables).</div>' +
            '<div class="field" style="margin-top:10px"><label>Pod</label><select id="im-pod"><option ' + (P.pod === 'PROD' ? 'selected' : '') + '>PROD</option><option ' + (P.pod === 'TEST' ? 'selected' : '') + '>TEST</option></select></div>' +
            '<div class="field" style="margin-top:10px"><label>Paste</label><textarea id="im-text" rows="8" placeholder="ITEM_NUMBER\tITEM_DESC\tLIST_PRICE\tTAX_CODE\tBARCODE&#10;A1\tMineral water 1.5L\t100\tGROT1.4\t6001234567890"></textarea></div>' +
            '<div class="field" style="margin-top:10px"><label>…or APEX SQL</label><textarea id="im-sql" rows="3" placeholder="SELECT * FROM fsq_price_list"></textarea></div><div class="row" style="margin-top:8px"><span class="muted small" id="im-msg"></span></div>';
        drawer({ title: (isItems ? '📦 Import items' : '👥 Import customers'), html: html, foot: '<button class="btn" data-act="drawerClose">Cancel</button><span class="sp"></span><button class="btn pri" data-act="importGo" data-kind="' + kind + '">Import</button>', state: { kind: 'import' } });
    }
    function parseTable(text) {
        var lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.trim(); }); if (lines.length < 2) return [];
        var sep = lines[0].indexOf('\t') >= 0 ? '\t' : lines[0].indexOf(';') >= 0 ? ';' : ',';
        var head = lines[0].split(sep).map(function (h) { return h.trim().replace(/^"|"$/g, '').toUpperCase(); });
        return lines.slice(1).map(function (l) { var cells = l.split(sep); var o = {}; head.forEach(function (h, i) { o[h] = (cells[i] || '').trim().replace(/^"|"$/g, ''); }); return o; });
    }
    function importGo(kind) {
        var pod = $('im-pod').value, text = $('im-text').value, sql = $('im-sql').value.trim();
        var rowsP = sql ? FAS.rowsAll(sql, 50000) : Promise.resolve(parseTable(text));
        run('Importing…', function () {
            return rowsP.then(function (rows) {
                if (!rows.length) throw new Error('No rows to import');
                if (kind === 'items') { var items = rows.map(POSE.normItem).filter(function (i) { return i.item; }); return FAS.pos.mergeItems(pod, items); }
                var custs = rows.map(function (r) { var g = function () { for (var i = 0; i < arguments.length; i++) if (r[arguments[i]] != null && r[arguments[i]] !== '') return r[arguments[i]]; return ''; }; return { number: g('CUSTOMER_NUMBER', 'CUSTOMER_NO', 'ACCOUNT_NUMBER', 'NUMBER'), name: g('CUSTOMER_NAME', 'NAME'), category: g('CUSTOMER_CATEGORY', 'CATEGORY'), type: g('CUSTOMER_CLASS', 'CLASS', 'TYPE'), credit: +g('CREDIT_LIMIT', 'CREDIT') || 0, vat: g('VAT', 'VAT_NO'), brn: g('BRN'), phone: g('PHONE', 'TELEPHONE', 'MOBILE'), address: g('ADDRESS'), priceList: g('PRICE_LIST') }; }).filter(function (c) { return c.number; });
                return FAS.pos.mergeCustomers(pod, custs);
            }).then(function (n) { closeDrawer(); toast(n + ' ' + kind + ' imported into ' + pod, 'ok'); return loadPos().then(render); });
        });
    }

    // ── Devices ───────────────────────────────────────────────────
    function vDevices() {
        var me = FAS.device.get();
        var h = '<div class="card"><div class="row"><button class="btn pri" data-act="pairNew"><i class="fas fa-qrcode"></i> Pair a phone</button><button class="btn" data-act="devLoad"><i class="fas fa-rotate"></i> Refresh</button><span class="sp"></span><span class="muted small">This desktop: ' + (me && me.key ? '<span class="pill ok">paired as ' + esc(me.deviceId) + '</span> <button class="btn sm ghost" data-act="deskForget">forget</button>' : '<span class="pill">not paired</span> <button class="btn sm" data-act="deskPair">Pair this desktop (for photos)</button>') + '</span></div></div>';
        h += '<div class="card" style="padding:0"><table class="tbl"><tr><th>Device</th><th>Label</th><th>User</th><th>Platform</th><th>Paired</th><th>Last seen</th><th>Status</th><th></th></tr>' + (P.devices.length ? P.devices.map(function (d) { return '<tr><td class="mono small">' + esc(d.DEVICE_ID) + '</td><td>' + esc(d.LABEL || '') + '</td><td>' + esc(d.USERNAME || '') + '</td><td class="small">' + esc(d.PLATFORM || '') + (d.APP_VERSION ? ' ' + esc(d.APP_VERSION) : '') + '</td><td class="small">' + esc(fmt(d.PAIRED)) + ' by ' + esc(d.PAIRED_BY || '') + '</td><td class="small">' + esc(fmt(d.LAST_SEEN)) + '</td><td>' + (d.REVOKED === 'Y' ? '<span class="pill bad" title="' + esc(d.REVOKE_REASON || '') + '">revoked</span>' : '<span class="pill ok">active</span>') + '</td><td class="act">' + (d.REVOKED === 'Y' ? '<button class="btn sm" data-act="devRestore" data-id="' + esc(d.DEVICE_ID) + '">Restore</button>' : '<button class="btn sm" data-act="devRevoke" data-id="' + esc(d.DEVICE_ID) + '">Revoke</button>') + '</td></tr>'; }).join('') : '<tr><td colspan="8" class="empty">No phone paired yet. <b>Pair a phone</b> shows a QR the mobile app scans.</td></tr>') + '</table></div>';
        if (P.pend.length) h += '<div class="card"><h2>Pairing codes of the last 24 h</h2><table class="tbl"><tr><th>For</th><th>Label</th><th>Made</th><th>Expires</th><th>Used</th><th>Device</th></tr>' + P.pend.map(function (p) { return '<tr><td>' + esc(p.USERNAME) + '</td><td>' + esc(p.LABEL || '') + '</td><td>' + esc(p.AT) + ' by ' + esc(p.CREATED_BY) + '</td><td>' + esc(p.EXPIRES) + '</td><td>' + (p.USED ? '<span class="pill ok">' + esc(p.USED) + '</span>' : '<span class="pill">open</span>') + '</td><td class="mono small">' + esc(p.DEVICE_ID || '') + '</td></tr>'; }).join('') + '</table></div>';
        return h;
    }
    function loadDevices() { return FAS.ensure().then(function () { return Promise.all([FAS.devices.list(), FAS.pair.pending()]); }).then(function (r) { P.devices = r[0]; P.pend = r[1]; paintTabs(); }); }
    function pairNew() {
        var mu = P.mobileUsers || [];
        var html = '<div class="form"><div class="field"><label>Who will use this phone (mobile app login)</label><input type="text" id="pr-user" list="pr-users" placeholder="ravi"><datalist id="pr-users">' + mu.map(function (u) { return '<option value="' + esc(u.username) + '">' + esc(u.name || u.type || '') + '</option>'; }).join('') + '</datalist></div><div class="field"><label>Label</label><input type="text" id="pr-label" placeholder="Van 3 handheld"></div></div><div id="pr-out" style="margin-top:12px"></div>';
        drawer({ title: '📱 Pair a phone', html: html, foot: '<button class="btn" data-act="drawerClose">Close</button><span class="sp"></span><button class="btn pri" data-act="pairGo">Make the code</button>', state: { kind: 'pair' } });
    }
    function pairGo() {
        var user = $('pr-user').value.trim(), label = $('pr-label').value.trim();
        if (!user) { toast('Who will use the phone?', 'warn'); return; }
        run('Making a pairing code…', function () { return FAS.pair.create(user, label || (user + '\'s phone')); }).then(function (p) {
            var payload = JSON.stringify({ t: 'fieldapps', v: 1, base: FAS.WM, code: p.code, user: user });
            var out = $('pr-out'); out.innerHTML = '<div class="row" style="align-items:flex-start"><div class="qr" id="pr-qr"></div><div><div class="muted small">In the mobile app: <b>Field Apps › Add app › Scan</b>, or type the code</div><div class="bigcode">' + esc(p.code) + '</div><div class="muted small">for <b>' + esc(user) + '</b> · valid 15 minutes · one phone</div><div class="muted small mono" style="margin-top:8px;word-break:break-all">' + esc(payload) + '</div></div></div>';
            if (window.QRCode) { try { new window.QRCode($('pr-qr'), { text: payload, width: 220, height: 220, correctLevel: window.QRCode.CorrectLevel.M }); } catch (e) { $('pr-qr').textContent = payload; } } else $('pr-qr').textContent = payload;
            loadDevices().then(function () { if (P.tab === 'devices') { } });
        });
    }

    // ── Setup ─────────────────────────────────────────────────────
    function vSetup() {
        var s = P.setup || {}, me = FAS.device.get();
        var h = '<div class="grid2"><div class="card"><h2>Tables in APEX</h2>' + (s.tables ? '<table class="tbl">' + s.tables.map(function (t) { return '<tr><td class="mono">' + esc(t.table) + '</td><td>' + (t.exists ? '<span class="pill ok">ok</span>' : '<span class="pill warn">missing</span>') + '</td></tr>'; }).join('') + '</table>' : '<div class="muted">…</div>') + '<div class="row" style="margin-top:10px"><button class="btn" data-act="setupTables">Create the missing tables</button></div></div>' +
            '<div class="card"><h2>Phone handlers (apex_sql/97_field_apps.sql)</h2>' + (s.ping ? (s.ping.installed ? '<div class="okbox">Installed — field/ping answers ' + esc(s.ping.status) + '. Phones can pair, read apps, send results and photos.</div>' : '<div class="warnbox">Not installed (field/ping → HTTP ' + esc(s.ping.status || 0) + '). The desktop works without them; the phones need them. Run <code>apex_sql/97_field_apps.sql</code> once in SQL Developer or APEX SQL Workshop (the gateway cannot create procedures).</div>') : '<div class="muted">…</div>') + '<div class="row" style="margin-top:10px"><button class="btn" data-act="setupPing">Check again</button></div></div>' +
            '<div class="card"><h2>Signing key of this PC</h2>' + (P.hostKey ? (P.hostKey.exists ? '<div class="kv"><div class="k">Key id</div><div class="mono">' + esc(P.hostKey.keyId) + '</div><div class="k">Created</div><div>' + esc(P.hostKey.created) + '</div><div class="k">In APEX</div><div>' + (P.keys.some(function (k) { return k.keyId === P.hostKey.keyId; }) ? '<span class="pill ok">published — phones trust it</span>' : '<span class="pill warn">not yet</span> <button class="btn sm" data-act="keyPublish">Publish it</button>') + '</div></div>' : '<div class="muted">No key yet. ' + (P.hostKey.admin ? 'It is made the first time an AI admin publishes an app, or now:' : 'An AI admin makes it the first time they publish.') + '</div><div class="row" style="margin-top:8px"><button class="btn" data-act="keyCreate" ' + (P.hostKey.admin ? '' : 'disabled') + '>Create the key</button></div>') : '<div class="muted">Open this page inside the WMS app to see the key.</div>') +
            '<h3>Keys the phones trust</h3>' + (P.keys.length ? '<table class="tbl">' + P.keys.map(function (k) { return '<tr><td class="mono">' + esc(k.keyId) + '</td><td class="small">' + esc(k.by || '') + ' · ' + esc(fmt(k.at)) + '</td><td class="act"><button class="btn sm ghost" data-act="keyRemove" data-id="' + esc(k.keyId) + '" ' + (P.admin ? '' : 'disabled') + '>remove</button></td></tr>'; }).join('') + '</table>' : '<div class="muted small">none yet</div>') + '</div>' +
            '<div class="card"><h2>This desktop as a device</h2><div class="muted small">Photos taken in the Preview go through the same handler as a phone\'s, so this PC pairs itself once (a code for your login, redeemed at once).</div><div class="row" style="margin-top:8px">' + (me && me.key ? '<span class="pill ok">paired as ' + esc(me.deviceId) + ' · ' + esc(fmt(me.at)) + '</span><button class="btn sm ghost" data-act="deskForget">forget</button>' : '<span class="pill">not paired</span><button class="btn sm" data-act="deskPair">Pair now</button>') + '</div>' +
            '<h3>Where things are</h3><div class="kv small"><div class="k">Apps, users, queries, devices, submissions, photos, POS</div><div>APEX tables WMS_FIELD_* and WMS_POS_*</div><div class="k">Phone API</div><div class="mono">' + esc(FAS.WM) + '/field/…</div><div class="k">Private signing key</div><div class="mono">%APPDATA%\\GraysWMS\\FieldApps\\signing.key (DPAPI)</div><div class="k">Runtime shell</div><div class="mono">fieldapps/runtime/shell.html — the same file the mobile app embeds</div><div class="k">Guide</div><div class="mono">docs/FIELD_APPS.md</div></div></div></div>';
        return h;
    }
    function loadSetup() {
        return Promise.all([FAS.tableStatus().catch(function () { return null; }), FAS.ping(), FAS.hasHost() ? FAS.host('fieldAppKeys', {}).catch(function () { return null; }) : Promise.resolve(null), FAS.keys.list().catch(function () { return []; })]).then(function (r) { P.setup = { tables: r[0], ping: r[1] }; P.hostKey = r[2]; P.keys = r[3]; });
    }

    // ── drawer ────────────────────────────────────────────────────
    function drawer(o) {
        closeDrawer();
        P.drawer = { state: o.state || {} };
        var bg = document.createElement('div'); bg.className = 'drawer-bg'; bg.id = 'drawer-bg'; bg.setAttribute('data-act', 'drawerClose');
        var d = document.createElement('div'); d.className = 'drawer'; d.id = 'drawer';
        d.innerHTML = '<div class="dh"><div class="t">' + o.title + '</div><span class="sp" style="flex:1"></span><button class="btn sm ghost" data-act="drawerClose">✕</button></div><div class="db">' + o.html + '</div><div class="df">' + (o.foot || '') + '</div>';
        document.body.appendChild(bg); document.body.appendChild(d);
    }
    function closeDrawer() { var st = P.drawer && P.drawer.state; if (st && st.kind === 'capture' && st.stream) { try { st.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { } } ['drawer-bg', 'drawer'].forEach(function (id) { var el = $(id); if (el) el.parentNode.removeChild(el); }); P.drawer = null; }
    FAP.closeDrawer = closeDrawer;
    function csv(rows, cols, name) {
        var lines = [cols.join(',')].concat(rows.map(function (r) { return cols.map(function (c) { var v = r[c]; v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }));
        var text = lines.join('\r\n');
        if (FAS.hasHost()) FAS.host('saveFileAs', { fileName: name, base64: btoa(unescape(encodeURIComponent(text))), filter: 'CSV|*.csv', title: 'Save ' + name }).catch(function () { });
        else { var a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(text); a.download = name; a.click(); }
    }

    // ── actions ───────────────────────────────────────────────────
    var ACT = {
        reloadApps: function () { run('Reading apps…', loadApps).then(render); },
        newBuiltin: function () { var ids = Object.keys(builtins()); if (!ids.length) { toast('No built-in apps in this build', 'warn'); return; } var id = ids.length === 1 ? ids[0] : prompt('Built-in app (' + ids.join(', ') + '):', ids[0]); if (id && builtins()[id]) addBuiltin(id, true); },
        addBuiltin: function (d) { addBuiltin(d.id, true); },
        previewBuiltin: function (d) { P.previewSrc = 'builtin:' + d.id; go('preview'); },
        newFile: function () { var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.html,.htm'; inp.onchange = function () { var f = inp.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { var name = prompt('Name of the app:', f.name.replace(/\.html?$/i, '')); if (name) newFromCode(String(r.result), name); }; r.readAsText(f); }; inp.click(); },
        newBlank: function () { var name = prompt('Name of the new app:', 'My app'); if (!name) return; newFromCode('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(name) + '</title><style>body{font-family:system-ui;padding:16px}button{font-size:16px;padding:10px 14px}</style></head><body><h2>' + esc(name) + '</h2><p id="who"></p><button id="b">Submit a test</button><script>FA.ready(function(c){document.getElementById("who").textContent="Hello "+c.user+" on "+c.device;});document.getElementById("b").onclick=function(){FA.submit("test",{hello:"world",at:new Date().toISOString()}).then(function(r){FA.toast("Sent "+r.subId);});};<\/script></body></html>', name); },
        preview: function (d) { P.previewSrc = 'apex:' + d.id; go('preview'); },
        edit: function (d) { editApp(d.id); },
        check: function (d) { checkApp(d.id); },
        publish: function (d) { run('Opening ' + d.id + '…', function () { return FAS.apps.get(d.id); }).then(function (a) { if (!a) return; var man = a.manifest || {}; var users = (a.USERS || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); if (!users.length && !confirm('Nobody is listed for this app yet — publish anyway?')) return; publish({ appId: d.id, name: a.NAME, icon: a.ICON, pod: a.POD, expiresAt: a.EXPIRES_AT || '', notes: a.NOTES, manifestObj: Object.assign(man, { queries: a.QUERIES && Object.keys(a.QUERIES).length ? a.QUERIES : man.queries || {} }), code: a.CODE, users: users, queries: a.QUERIES && Object.keys(a.QUERIES).length ? a.QUERIES : man.queries || {}, version: +a.VERSION || 0 }).then(render); }); },
        kill: function (d) { var why = prompt('Kill ' + d.id + ' on every phone? Reason:'); if (why == null) return; run('Killing…', function () { return FAS.apps.setStatus(d.id, 'KILLED'); }).then(loadApps).then(render).then(function () { toast(d.id + ' killed — phones hide it on their next check', 'ok'); }); },
        'delete': function (d) { if (!confirm('Delete app ' + d.id + ' from APEX? Submissions and photos stay.')) return; run('Deleting…', function () { return FAS.apps.del(d.id); }).then(loadApps).then(render); },
        drawerClose: function () { closeDrawer(); },
        mobileUsers: function () { run('Reading the mobile app\'s users…', function () { return P.mobileUsers ? Promise.resolve(P.mobileUsers) : FAS.mobileUsers().then(function (u) { P.mobileUsers = u; return u; }); }).then(function (u) { var box = $('e-mu'); if (!box) return; if (!u.length) { box.innerHTML = '<span class="muted small">No mobile users table found (GR_MOBILE_USER)</span>'; return; } box.innerHTML = u.map(function (x) { return '<button class="chip" data-act="addUser" data-u="' + esc(x.username) + '" title="' + esc(x.type || '') + '">' + esc(x.username) + (x.name ? ' · ' + esc(x.name) : '') + '</button>'; }).join(''); }); },
        addUser: function (d) { var ta = $('e-users'); if (!ta) return; var cur = ta.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); if (cur.indexOf(d.u) < 0) cur.push(d.u); ta.value = cur.join('\n'); $('e-all').checked = false; },
        addQuery: function () { $('e-queries').insertAdjacentHTML('beforeend', qRow('', {})); },
        rmQuery: function (d, el) { var c = el.closest('[data-q]'); if (c) c.parentNode.removeChild(c); },
        codeFile: function () { var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.html,.htm'; inp.onchange = function () { var f = inp.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { $('e-code').value = String(r.result); $('e-codelen').textContent = Math.round(String(r.result).length / 1024) + ' KB'; }; r.readAsText(f); }; inp.click(); },
        codeBuiltin: function () { var st = P.drawer.state, b = builtins()[st.id]; if (!b) return; $('e-code').value = b.code; $('e-codelen').textContent = Math.round(b.code.length / 1024) + ' KB'; var man = JSON.parse(JSON.stringify(b.manifest)); st.man.queries = man.queries || st.man.queries; st.man.settings = Object.assign({}, man.settings || {}, st.man.settings || {}); $('e-settings').value = JSON.stringify(st.man.settings, null, 2); $('e-queries').innerHTML = Object.keys(st.man.queries).map(function (n) { return qRow(n, st.man.queries[n]); }).join(''); toast('Built-in v' + man.version + ' loaded into the editor', 'ok'); },
        edSave: function () { var e; try { e = readEditor(); } catch (x) { toast(x.message, 'bad'); return; } saveDraft(e).then(function () { closeDrawer(); render(); toast('Saved as a draft', 'ok'); }); },
        edPublish: function () { var e; try { e = readEditor(); } catch (x) { toast(x.message, 'bad'); return; } if (!e.users.length && !confirm('Nobody is listed for this app — publish anyway?')) return; publish(e).then(function () { closeDrawer(); render(); }); },
        edPreview: function () { var e; try { e = readEditor(); } catch (x) { toast(x.message, 'bad'); return; } P.draft = e; closeDrawer(); P.previewSrc = 'draft:' + e.appId; go('preview'); },
        pvReload: function () { readPreviewControls(); render(); },
        pvRotate: function () { P.previewRot = !P.previewRot; sizePhone(); },
        pvScan: function () { var v = $('pv-scan').value.trim(); if (!v) return; FAH.send('barcode', { code: v, format: 'manual' }); log('barcode → ' + v); $('pv-scan').value = ''; },
        pvBack: function () { FAH.send('back', {}); },
        pvClear: function () { P.log = []; var el = $('pv-log'); if (el) el.innerHTML = ''; },
        subsLoad: function () { P.subsF = { app: $('rf-app').value.trim(), kind: $('rf-kind').value.trim(), status: $('rf-status').value, user: $('rf-user').value.trim(), from: $('rf-from').value, to: $('rf-to').value }; run('Searching…', loadSubs).then(render); },
        subsProcess: function () { run('Processing new submissions…', FAS.subs.processNew).then(function (n) { toast(n + ' processed', 'ok'); return loadSubs(); }).then(render); },
        subsCsv: function () { csv(P.subs, ['CREATED', 'APP_ID', 'KIND', 'USERNAME', 'DEVICE_ID', 'DOC_REF', 'AMOUNT', 'STATUS', 'ERROR_TEXT'], 'field-submissions.csv'); },
        subView: function (d) { run('Reading…', function () { return FAS.subs.doc(d.id); }).then(function (doc) { var s = P.subs.filter(function (x) { return x.SUB_ID === d.id; })[0] || {}; drawer({ title: '📄 ' + esc(s.KIND || '') + ' · ' + esc(s.DOC_REF || d.id), html: '<div class="kv"><div class="k">From</div><div>' + esc(s.USERNAME) + ' · ' + esc(s.DEVICE_ID) + ' · ' + esc(fmt(s.CREATED)) + '</div><div class="k">Status</div><div>' + esc(s.STATUS) + (s.ERROR_TEXT ? ' · ' + esc(s.ERROR_TEXT) : '') + '</div></div><pre class="code" style="max-height:70vh;margin-top:10px">' + esc(JSON.stringify(doc, null, 2)) + '</pre>', foot: '<button class="btn" data-act="drawerClose">Close</button>' + (s.STATUS !== 'DONE' && /^pos_/.test(s.KIND || '') ? '<span class="sp"></span><button class="btn pri" data-act="subProcess" data-id="' + esc(d.id) + '">Process again</button>' : ''), state: { kind: 'sub' } }); }); },
        subProcess: function (d) { var s = P.subs.filter(function (x) { return x.SUB_ID === d.id; })[0]; if (!s) return; run('Processing…', function () { return FAS.subs.doc(d.id).then(function (doc) { return FAS.subs.process(d.id, s.KIND, doc, s.USERNAME, s.DEVICE_ID); }); }).then(function (r) { toast(r.status + (r.error ? ' · ' + r.error : ''), r.status === 'DONE' ? 'ok' : 'bad'); closeDrawer(); return loadSubs(); }).then(render); },
        photosLoad: function () { P.photosF = { app: $('pf-app').value.trim(), trip: $('pf-trip').value.trim(), user: $('pf-user').value.trim(), from: $('pf-from').value, to: $('pf-to').value }; run('Searching…', loadPhotos).then(render); },
        photoOpen: function (d) { openPhoto(d.id); },
        vis: function (d) { runVision(d.op); },
        phExp: function () { var st = P.drawer && P.drawer.state; if (!st) return; var n = $('ph-exp').value; run('Saving…', function () { return FAS.photos.setExpected(st.p.PHOTO_ID, n === '' ? null : +n); }).then(function () { st.p.EXPECTED_COUNT = n === '' ? null : +n; toast('Expected count saved', 'ok'); }); },
        salesLoad: function () { P.pod = $('ps-pod').value; P.salesF = { from: $('ps-from').value, to: $('ps-to').value }; run('Reading sales…', loadPos).then(render); },
        salesCsv: function () { csv(P.sales, ['DONE_AT', 'SALE_NUMBER', 'KIND', 'DEVICE_ID', 'USERNAME', 'CUSTOMER_NUMBER', 'CUSTOMER_NAME', 'LINES_N', 'GROSS', 'DISC', 'TAX', 'CONS', 'CRATES', 'NET', 'ROUNDED', 'PAID', 'CHANGE_AMT', 'MRA_STATUS'], 'pos-sales-' + P.salesF.from + '.csv'); },
        saleView: function (d) { saleView(d.id); },
        itemsFind: function () { P.itemsQ = $('ps-iq').value.trim(); run('Searching…', function () { return FAS.pos.items(P.pod, P.itemsQ, 100); }).then(function (r) { P.items = r; render(); }); },
        itemsImport: function () { importDrawer('items'); },
        custImport: function () { importDrawer('customers'); },
        importGo: function (d) { importGo(d.kind); },
        pairNew: function () { (P.mobileUsers ? Promise.resolve() : FAS.mobileUsers().then(function (u) { P.mobileUsers = u; })).then(pairNew); },
        pairGo: function () { pairGo(); },
        devLoad: function () { run('Reading devices…', loadDevices).then(render); },
        devRevoke: function (d) { var why = prompt('Revoke ' + d.id + '? The phone loses access at once. Reason:'); if (why == null) return; run('Revoking…', function () { return FAS.devices.revoke(d.id, why); }).then(loadDevices).then(render); },
        devRestore: function (d) { run('Restoring…', function () { return FAS.devices.unrevoke(d.id); }).then(loadDevices).then(render); },
        deskPair: function () { run('Pairing this desktop…', function () { return FAS.device.ensure(); }).then(function () { toast('This desktop is paired', 'ok'); render(); }); },
        deskForget: function () { try { localStorage.removeItem('fieldapps.device'); } catch (e) { } render(); },
        setupTables: function () { run('Creating tables…', function () { return FAS.ensure(); }).then(loadSetup).then(render).then(function () { toast('Tables are in place', 'ok'); }); },
        setupPing: function () { run('Checking the handlers…', loadSetup).then(render); },
        keyCreate: function () { run('Creating the signing key…', function () { return FAS.host('fieldAppKeys', { create: true }); }).then(function (k) { P.hostKey = k; render(); }); },
        keyPublish: function () { if (!P.hostKey || !P.hostKey.exists) return; run('Publishing the key…', function () { return FAS.keys.ensure({ keyId: P.hostKey.keyId, spki: P.hostKey.spki }); }).then(function (k) { P.keys = k; render(); toast('Key published — phones trust it on their next check', 'ok'); }); },
        keyRemove: function (d) { if (!confirm('Remove key ' + d.id + '? Apps signed with it stop running on the phones.')) return; run('Removing…', function () { return FAS.keys.remove(d.id); }).then(loadSetup).then(render); },
        capSnap: function () { var st = P.drawer && P.drawer.state; if (st && st.snap) st.snap(); },
        capCancel: function () { var st = P.drawer && P.drawer.state; if (st && st.cancel) st.cancel(); else closeDrawer(); }
    };
    function readPreviewControls() { var s = $('pv-src'); if (s) P.previewSrc = s.value; var u = $('pv-user'); if (u) P.previewUser = u.value.trim() || FAS.user(); var p = $('pv-pod'); if (p) P.pod = p.value; var d = $('pv-device'); if (d) P.previewDevice = d.value.trim() || 'desktop'; var o = $('pv-online'); if (o) P.previewOnline = o.checked; var z = $('pv-size'); if (z) P.previewSize = z.value; var zz = $('pv-zoom'); if (zz) P.previewZoom = zz.value; }
    document.addEventListener('click', function (ev) {
        var el = ev.target.closest('[data-act]'); if (!el) return;
        if (el.className === 'drawer-bg' && ev.target !== el) return;
        var act = el.getAttribute('data-act'); if (el.tagName === 'LABEL' && act !== 'drawerClose') return;
        ev.preventDefault();
        var fn = ACT[act]; if (fn) fn(el.dataset, el, ev);
    });
    document.addEventListener('click', function (ev) { var t = ev.target.closest('[data-tab]'); if (t) go(t.getAttribute('data-tab')); });
    document.addEventListener('change', function (ev) {
        if (ev.target.id === 'pv-src' || ev.target.id === 'pv-pod' || ev.target.id === 'pv-user' || ev.target.id === 'pv-device') { readPreviewControls(); render(); }
        if (ev.target.id === 'pv-size' || ev.target.id === 'pv-zoom') { readPreviewControls(); sizePhone(); }
        if (ev.target.id === 'pv-online') { P.previewOnline = ev.target.checked; FAH.send('online', { online: P.previewOnline }); log(P.previewOnline ? 'online' : 'offline (simulated)'); }
        if (ev.target.id === 'e-code') { var el = $('e-codelen'); if (el) el.textContent = Math.round(ev.target.value.length / 1024) + ' KB'; }
    });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && P.drawer) { if (P.drawer.state && P.drawer.state.kind === 'capture') ACT.capCancel(); else closeDrawer(); } if (ev.key === 'Enter' && ev.target.id === 'pv-scan') ACT.pvScan(); if (ev.key === 'Enter' && ev.target.id === 'ps-iq') ACT.itemsFind(); });

    // ── boot ──────────────────────────────────────────────────────
    function boot() {
        try { P.tab = localStorage.getItem('fieldapps.tab') || 'apps'; } catch (e) { }
        if (location.hash) { var t = location.hash.replace('#', ''); if (TABS.some(function (x) { return x[0] === t; })) P.tab = t; }
        paintTabs();
        if (!FAS.hasHost()) { $('main').innerHTML = '<div class="card warnbox">Open this page inside the Gray\'s WMS app — it talks to APEX and signs apps through the desktop host.</div>'; return; }
        var done = busy('Reading Field Apps…');
        Promise.all([FAS.host('aiControlStatus', {}).then(function (d) { return !!(d && (d.admin || d.isAdmin)); }).catch(function () { return false; }), loadApps().catch(function (e) { toast(e.message, 'bad'); })]).then(function (r) {
            return FAS.keys.list().catch(function () { return []; }).then(function (k) { return [r[0], null, k]; });     // after ensure(): the settings table exists
        }).then(function (r) {
            P.admin = r[0]; P.keys = r[2] || []; P.ready = true; done();
            paintTabs(); render();
            Promise.all([loadSubs().catch(function () { }), loadDevices().catch(function () { })]).then(paintTabs);
            if (P.tab === 'results') loadSubs().then(render); if (P.tab === 'photos') loadPhotos().then(render); if (P.tab === 'pos') loadPos().then(render); if (P.tab === 'devices') loadDevices().then(render); if (P.tab === 'setup') loadSetup().then(render);
        }, function (e) { done(); toast(e.message, 'bad'); });
    }
    var origGo = go;
    go = function (tab) { origGo(tab); if (tab === 'results') loadSubs().then(render); if (tab === 'photos') loadPhotos().then(render); if (tab === 'pos') loadPos().then(render); if (tab === 'devices') loadDevices().then(render); if (tab === 'setup') loadSetup().then(render); };
    FAP.state = function () { return P; };
    FAP.go = function (t) { go(t); };
    FAP.publish = publish; FAP.editApp = editApp; FAP.checkApp = checkApp;
    document.addEventListener('DOMContentLoaded', boot);
})();
