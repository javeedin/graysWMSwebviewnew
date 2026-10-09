// ═══════════════════════════════════════════════════════════════════════════════
// PICKER APP — the pickers' mobile app (FCPos, javeedin/reerpPOSMobileApp) inside the WMS desktop: menu item
// data-page="picker-app" (group Operate). The page shows mobile/index.html (the app's web build, written by
// tools/mobile/build-mobile.js) in phone-shaped frames and answers the app's Oracle calls: the bridge inside the build
// (mobile/bridge.js) posts every APEX / Fusion request to this page, which runs it through the desktop host's relay
// (executeGet / executePost / executeOracleFusionGet / Post / Patch) and posts the answer back — no CORS, Fusion
// credentials stay in C#. "View only" (default on, localStorage wms.pa.viewOnly) blocks the calls that change data
// (pick confirm, ship confirm, cancel, pick wave …) and lists them in the panel; off = fully live.
// PICKERS: the panel lists the app users whose type is PICKER (the table behind the LOGIN/user ORDS handler, found
// through user_ords_handlers; else the WMS pickers list) — a click opens the app in a NEW frame signed in as that picker
// (the frame's own storage is seeded with the user row, no password; audited picker_app_open), so several pickers' apps
// run side by side, each with its own login and cache. "Sign in yourself" opens a plain frame with the login screen.
// Size phone / large phone / tablet, rotate, reload / close per frame, open in its own tab. Frames are kept while other
// pages are shown. window.WmsPickerApp = {onShow, open, openPicker, close, reload, setViewOnly, loadPickers, state}
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    var PAGE = 'picker-app', MAX_FRAMES = 6;
    var SRC = window.WMS_PICKER_APP_SRC || '../mobile/index.html';
    var ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP', WM = ORDS + '/WAREHOUSEMANAGEMENT', GW = WM + '/ai';
    var SIZES = { phone: [390, 844, 'Phone · 390 × 844'], large: [430, 932, 'Large phone · 430 × 932'], tablet: [820, 1180, 'Tablet · 820 × 1180'] };
    var SECRET = /(PASSWORD|PASSWD|PWD|SECRET|TOKEN|HASH|SALT|PIN)/i;
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
    function hosted() { return !!(window.chrome && window.chrome.webview && typeof sendMessageToCSharp === 'function'); }
    function user() { try { return localStorage.getItem('wms_user') || sessionStorage.getItem('loggedInUser') || 'WMS'; } catch (e) { return 'WMS'; } }
    function curInstance() {
        var el = document.getElementById('current-instance-display'), v = el ? String(el.textContent || '').trim().toUpperCase() : '';
        if (!v) { try { v = String(sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || '').toUpperCase(); } catch (e) { v = ''; } }
        return v || 'PROD';
    }
    function hhmm(d) { d = d || new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }
    function initials(name) { var p = String(name || '?').trim().split(/[\s._-]+/).filter(Boolean); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : (p[0] || '')[1] || '')).toUpperCase(); }
    function colour(name) { var h = 0, s = String(name || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return 'hsl(' + (h % 360) + ' 55% 42%)'; }
    function b64url(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    function host(msg, ms) {
        return new Promise(function (resolve, reject) {
            if (!hosted()) { reject(new Error('Open this inside the Gray\'s WMS app.')); return; }
            sendMessageToCSharp(msg, function (err, data) { if (err) { reject(new Error(typeof err === 'string' ? err : (err.message || JSON.stringify(err)))); return; } var r = data; if (typeof data === 'string') { try { r = JSON.parse(data); } catch (e) { r = data; } } resolve(r); }, ms || 60000, false);
        });
    }
    /** One APEX read through the AI gateway → rows with upper-case keys. */
    function gw(sql, max) {
        return host({ action: 'executePost', fullUrl: GW + '/executequery', body: JSON.stringify({ appUser: user(), sql: sql, maxRows: max || 500 }) }, 120000).then(function (d) {
            if (!d || d.success === false) throw new Error((d && d.error) || 'APEX query failed');
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || []).map(function (r) { if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; } var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x; });
        });
    }
    var st = { drawn: false, viewOnly: ls('wms.pa.viewOnly') !== '0', size: ls('wms.pa.size') || 'phone', landscape: false, frames: [], seq: 0,
        pickers: null, pickersSrc: '', pickersErr: '', pickersBusy: false, showAll: false, filter: '', calls: 0, log: [], blocked: [] };

    function root() { return document.getElementById(PAGE); }
    function pathOf(url) { try { var u = new URL(url); return u.pathname.replace(/^\/ords\/WKSP_GRAYSAPP\//, '').replace(/^\/fscmRestApi\/resources\/[\d.]+\//, 'fusion/') + (u.search ? '?' + u.search.slice(1, 40) : ''); } catch (e) { return String(url).slice(0, 80); } }
    function frameOf(win) { for (var i = 0; i < st.frames.length; i++) { var f = st.frames[i]; if (f.el && f.el.contentWindow === win) return f; } return null; }
    function frameById(id) { for (var i = 0; i < st.frames.length; i++) if (st.frames[i].id === id) return st.frames[i]; return null; }

    // ── the pickers (app users of type PICKER) ─────────────────────────────────────────────────────────────────────
    function typeOf(r) { var k = ['USER_TYPE', 'USERTYPE', 'TYPE', 'USER_ROLE', 'ROLE', 'USER_CATEGORY', 'CATEGORY']; for (var i = 0; i < k.length; i++) if (r[k[i]] != null && String(r[k[i]]).trim()) return String(r[k[i]]).trim().toUpperCase(); return ''; }
    function usernameOf(r) { var k = ['USERNAME', 'USER_NAME', 'LOGIN', 'LOGIN_NAME', 'USER_ID', 'USERID']; for (var i = 0; i < k.length; i++) if (r[k[i]] != null && String(r[k[i]]).trim()) return String(r[k[i]]).trim(); return ''; }
    function nameOf(r) { var k = ['PICKER_NAME', 'FULL_NAME', 'DISPLAY_NAME', 'NAME', 'EMPLOYEE_NAME']; for (var i = 0; i < k.length; i++) if (r[k[i]] != null && String(r[k[i]]).trim()) return String(r[k[i]]).trim(); return usernameOf(r); }
    function toPicker(r, src) {
        var clean = {}; Object.keys(r).forEach(function (k) { if (!SECRET.test(k)) clean[k] = r[k]; });
        var username = usernameOf(r), name = nameOf(r);
        return { username: username, name: name, type: typeOf(r), warehouse: r.WAREHOUSE || r.ORGANIZATION || r.ORG_CODE || '', active: !(r.ACTIVE === 'N' || r.STATUS === 'INACTIVE' || r.IS_ACTIVE === 'N'), row: clean, src: src };
    }
    /** The users table = the one the LOGIN/user ORDS handler reads (user_ords_handlers), else the WMS pickers list. */
    function loadPickers(force) {
        if (st.pickersBusy || (st.pickers && !force)) return Promise.resolve(st.pickers);
        st.pickersBusy = true; st.pickersErr = ''; paintPickers();
        var sql = "SELECT TO_CHAR(SUBSTR(h.source, 1, 4000)) AS src, t.uri_template AS tpl FROM user_ords_handlers h JOIN user_ords_templates t ON t.id = h.template_id JOIN user_ords_modules m ON m.id = t.module_id " +
            "WHERE h.method = 'GET' AND (UPPER(m.name) = 'LOGIN' OR UPPER(m.uri_prefix) LIKE '%LOGIN%') AND LOWER(t.uri_template) LIKE 'user%'";
        return gw(sql, 10).then(function (rows) {
            var src = rows.map(function (r) { return r.SRC || ''; }).join('\n'), m = /FROM\s+("?[A-Za-z0-9_$#]+"?)/i.exec(src);
            if (!m) throw new Error('no LOGIN/user handler');
            var table = m[1].replace(/"/g, '').toUpperCase();
            return gw('SELECT * FROM ' + table + ' ORDER BY 1', 2000).then(function (users) { st.pickersSrc = 'the ' + table + ' table (the LOGIN/user handler)'; return users.map(function (r) { return toPicker(r, table); }); });
        }).catch(function () {
            return host({ action: 'executeGet', fullUrl: WM + '/pickers/getpickers' }, 60000).then(function (d) {
                var items = Array.isArray(d) ? d : (d && d.items) || [];
                st.pickersSrc = 'the WMS pickers list (no users table found)';
                return items.map(function (p) { var name = String(p.name || p.NAME || p.picker_name || p.PICKER_NAME || '').trim(); return { username: name, name: name, type: 'PICKER', warehouse: '', active: !(p.active === 'N' || p.ACTIVE === 'N'), row: { PICKER_NAME: name, USER_TYPE: 'PICKER', USERNAME: name }, src: 'pickers' }; }).filter(function (p) { return p.name; });
            });
        }).then(function (list) {
            list.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
            st.pickers = list; st.pickersBusy = false; paintPickers(); return list;
        }).catch(function (e) { st.pickers = []; st.pickersErr = e && e.message || String(e); st.pickersBusy = false; paintPickers(); return []; });
    }
    function visiblePickers() {
        var q = st.filter.trim().toUpperCase();
        return (st.pickers || []).filter(function (p) { return (st.showAll || p.type === 'PICKER') && (!q || (p.name + ' ' + p.username + ' ' + p.type + ' ' + p.warehouse).toUpperCase().indexOf(q) >= 0); });
    }
    /** The user object the app keeps after its own login (AuthContext fullUserData), from the picker's row — no password. */
    function userDataOf(p, instance) {
        var u = {}; Object.keys(p.row || {}).forEach(function (k) { u[k] = p.row[k]; });
        u.username = p.username || p.name; u.user_name = u.username; u.USERNAME = u.username;
        u.PICKER_NAME = p.name; u.picker_name = p.name;
        u.user_type = p.type || 'PICKER'; u.USER_TYPE = u.user_type; u.userType = u.user_type;
        if (p.warehouse) u.warehouse = p.warehouse;
        u.instance = instance; u.loginTime = new Date().toISOString(); u.wmsDesktop = true;
        return u;
    }

    // ── frames ───────────────────────────────────────────────────────────────────────────────────────────────────
    function open(picker) {
        if (!st.drawn) draw();
        if (picker) { var had = st.frames.filter(function (f) { return f.picker && f.picker.username === picker.username; })[0]; if (had) { focusFrame(had); return had; } }
        if (st.frames.length >= MAX_FRAMES) { note('At most ' + MAX_FRAMES + ' apps at a time — close one first.', 'warning'); return null; }
        var instance = curInstance(), f = { id: ++st.seq, picker: picker || null, label: picker ? picker.name : 'Sign in yourself', instance: instance, ready: false, loaded: false, build: null, calls: 0, el: null, missingTimer: null, openedAt: hhmm() };
        st.frames.push(f);
        var dev = document.createElement('div'); dev.className = 'pa-dev'; dev.id = 'pa-dev-' + f.id;
        dev.innerHTML = '<div class="pa-devhead"><span class="pa-av" style="background:' + (picker ? colour(picker.name) : '#475569') + '">' + (picker ? esc(initials(picker.name)) : '<i class="fas fa-user"></i>') + '</span>' +
            '<span class="pa-who"><b>' + esc(f.label) + '</b><small>' + (picker ? esc(picker.username) + ' · ' + esc(instance) : 'the app\'s own login screen') + '</small></span>' +
            '<span class="pa-devpills" id="pa-pills-' + f.id + '"></span>' +
            '<button class="pa-ib" data-act="reload" title="Load the app again"><i class="fas fa-redo"></i></button><button class="pa-ib" data-act="close" title="Close this app"><i class="fas fa-times"></i></button></div>' +
            '<div class="pa-phone" id="pa-phone-' + f.id + '"><div class="pa-missing" id="pa-missing-' + f.id + '" hidden></div><iframe class="pa-screen" id="pa-frame-' + f.id + '" title="' + esc(f.label) + '" allow="camera; microphone; clipboard-write"></iframe></div>';
        var row = document.getElementById('pa-frames'); row.appendChild(dev);
        dev.querySelector('[data-act="reload"]').onclick = function () { load(f); };
        dev.querySelector('[data-act="close"]').onclick = function () { close(f.id); };
        f.el = dev.querySelector('iframe');
        sizeFrames(); load(f); paintStatus(); paintPickers();
        if (picker) host({ action: 'aiAudit', source: 'WMS_PICKER_APP', actionKey: 'picker_app_open', outcome: 'OK', instance: instance, refId: 'USER:' + (picker.username || picker.name), target: picker.name, detail: 'Picker app opened as ' + picker.name + ' (' + (picker.username || '') + ') on ' + instance + ' · ' + (st.viewOnly ? 'view only' : 'LIVE') + ' · by ' + user() }, 15000).catch(function () {});
        setTimeout(function () { focusFrame(f); }, 50);
        return f;
    }
    function load(f) {
        if (!f || !f.el) return;
        f.ready = false; f.loaded = false; hideMissing(f);
        var seed = { viewOnly: st.viewOnly, label: f.label, storage: { app_instance: f.instance } };
        if (f.picker) seed.storage.userData = JSON.stringify(userDataOf(f.picker, f.instance));
        f.el.src = SRC + (SRC.indexOf('?') >= 0 ? '&' : '?') + 'wms=' + f.id + '-' + Date.now() + '#wms=' + b64url(JSON.stringify(seed));
        clearTimeout(f.missingTimer);
        f.missingTimer = setTimeout(function () { if (!f.ready) showMissing(f); }, 8000);
        paintPills(f); paintStatus();
    }
    function close(id) { var f = frameById(id); if (!f) return; clearTimeout(f.missingTimer); var dev = document.getElementById('pa-dev-' + id); if (dev) dev.remove(); st.frames = st.frames.filter(function (x) { return x.id !== id; }); sizeFrames(); paintStatus(); paintPickers(); paintHint(); }
    function focusFrame(f) { var dev = document.getElementById('pa-dev-' + f.id); if (dev && dev.scrollIntoView) { try { dev.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); } catch (e) { dev.scrollIntoView(); } } }
    function reloadAll() { st.frames.forEach(load); }
    function showMissing(f) {
        var el = document.getElementById('pa-missing-' + f.id); if (!el) return;
        el.innerHTML = '<i class="fas fa-mobile-alt" style="font-size:30px;color:#475569;margin-bottom:10px"></i><b>The app did not answer.</b><span style="margin-top:6px">Either the mobile build is not installed on this PC (<code>mobile/index.html</code> next to the wms folder — run <code>node tools/mobile/build-mobile.js</code>) or it is still loading.</span><button class="pa-btn primary" style="margin-top:14px"><i class="fas fa-redo"></i> Try again</button>';
        el.hidden = false; el.querySelector('button').onclick = function () { load(f); };
        paintPills(f); paintStatus();
    }
    function hideMissing(f) { var el = document.getElementById('pa-missing-' + f.id); if (el) el.hidden = true; }
    function sizeFrames() {
        var s = SIZES[st.size] || SIZES.phone, w = st.landscape ? s[1] : s[0], h = st.landscape ? s[0] : s[1];
        var scale = Math.min(1, (window.innerHeight - 200) / (h + 28));
        st.frames.forEach(function (f) {
            var p = document.getElementById('pa-phone-' + f.id); if (!p) return;
            p.style.width = w + 'px'; p.style.height = h + 'px'; p.style.transform = scale < 1 ? 'scale(' + scale.toFixed(3) + ')' : ''; p.style.transformOrigin = 'top left'; p.classList.toggle('tablet', st.size === 'tablet');
            var dev = document.getElementById('pa-dev-' + f.id); if (dev) { dev.style.width = Math.round((w + 28) * (scale < 1 ? scale : 1)) + 'px'; dev.style.height = Math.round((h + 28) * (scale < 1 ? scale : 1) + 54) + 'px'; }
        });
        paintHint();
    }

    // ── the relay: one request of an app → the host → the answer back to that frame ──────────────────────────────
    function relay(f, win, m) {
        var t0 = Date.now(), url = String(m.url || ''), method = String(m.method || 'GET').toUpperCase();
        var apex = /oraclecloudapps\.com\//i.test(url), fusion = !apex && /\.oraclecloud\.com\//i.test(url);
        var reply = function (ok, status, body, noteText) {
            st.calls++; if (f) f.calls++;
            st.log.unshift({ at: hhmm(), who: f ? f.label : '?', method: method, path: pathOf(url), ok: ok, status: status, ms: Date.now() - t0, note: noteText || '' }); st.log = st.log.slice(0, 60); paintLog();
            try { win.postMessage({ type: 'wms-mobile-reply', id: m.id, ok: ok, status: status, body: body, contentType: 'application/json' }, '*'); } catch (e) { /* frame gone */ }
        };
        if (!hosted()) { reply(false, 503, JSON.stringify({ success: false, error: 'Open the WMS inside the Gray\'s WMS app — the relay needs the desktop host.' }), 'no host'); return; }
        var msg = null, inst = m.instance || (f && f.instance) || curInstance();
        if (apex && method === 'GET') msg = { action: 'executeGet', fullUrl: url };
        else if (apex && method === 'POST') msg = { action: 'executePost', fullUrl: url, body: m.body == null ? '' : String(m.body) };
        else if (fusion && method === 'GET') msg = { action: 'executeOracleFusionGet', fullUrl: url, instance: inst };
        else if (fusion && method === 'POST') msg = { action: 'executeOracleFusionPost', fullUrl: url, body: m.body == null ? '' : String(m.body), instance: inst };
        else if (fusion && method === 'PATCH') msg = { action: 'executeOracleFusionPatch', fullUrl: url, body: m.body == null ? '' : String(m.body), instance: inst };
        if (!msg) { reply(false, 405, JSON.stringify({ success: false, error: method + ' is not relayed by the WMS desktop.' }), 'not relayed'); return; }
        try {
            sendMessageToCSharp(msg, function (err, data, statusCode) {
                if (err) { var body = err.body != null ? String(err.body) : JSON.stringify({ success: false, error: err.message || String(err) }); reply(false, err.statusCode || 500, body, err.message || ''); return; }
                reply(true, statusCode || 200, typeof data === 'string' ? data : JSON.stringify(data == null ? {} : data));
            }, 180000, false);
        } catch (e) { reply(false, 500, JSON.stringify({ success: false, error: e && e.message || String(e) }), 'relay error'); }
    }
    function onMessage(e) {
        var f = frameOf(e.source); if (!f) return;
        var m = e.data; if (!m || typeof m !== 'object') return;
        if (m.type === 'wms-mobile-hello') { f.ready = true; f.loaded = true; f.build = m.build || f.build; clearTimeout(f.missingTimer); hideMissing(f); try { e.source.postMessage({ type: 'wms-mobile-ready', viewOnly: st.viewOnly }, '*'); } catch (x) { /* frame gone */ } paintPills(f); paintStatus(); }
        else if (m.type === 'wms-mobile-relay') relay(f, e.source, m);
        else if (m.type === 'wms-mobile-blocked') { st.blocked.unshift({ at: hhmm(), who: f.label, method: m.method, path: pathOf(m.url) }); st.blocked = st.blocked.slice(0, 30); st.log.unshift({ at: hhmm(), who: f.label, method: m.method, path: pathOf(m.url), ok: false, status: 403, ms: 0, note: 'blocked · view only', blocked: true }); st.log = st.log.slice(0, 60); paintLog(); paintBlocked(); }
    }
    function sendMode() { st.frames.forEach(function (f) { if (f.el && f.el.contentWindow) { try { f.el.contentWindow.postMessage({ type: 'wms-mobile-mode', viewOnly: st.viewOnly }, '*'); } catch (e) { /* frame gone */ } } }); }
    window.addEventListener('message', onMessage);

    // ── page ─────────────────────────────────────────────────────────────────────────────────────────────────────
    function draw() {
        var r = root(); if (!r) return;
        r.innerHTML = '<div class="pa">' +
            '<div class="pa-side">' +
            '<div class="pa-card"><h3><i class="fas fa-mobile-alt" style="color:#1e3a8a"></i> Picker app <small id="pa-build"></small></h3><p>The FCPos app your pickers use, exactly as it is on their phones. Open it as any picker from the list, or sign in yourself. Every Oracle call runs through this PC.</p>' +
            '<div class="pa-status" id="pa-status" style="margin-top:8px"></div></div>' +
            '<div class="pa-card"><label class="pa-switch"><input type="checkbox" id="pa-viewonly"' + (st.viewOnly ? ' checked' : '') + '><span class="k"></span><span><b>View only</b><small>Pick confirm, ship confirm, cancel and pick wave are blocked in every open app. Off = live, exactly like the phone.</small></span></label></div>' +
            '<div class="pa-card pa-pickers"><h3><i class="fas fa-users" style="color:#1e3a8a"></i> Pickers <small id="pa-pickers-n"></small></h3>' +
            '<div class="pa-row" style="margin-top:0"><input type="search" class="pa-sel pa-q" id="pa-q" placeholder="Find a picker…" autocomplete="off"><button class="pa-btn" id="pa-pickers-refresh" title="Read the list again"><i class="fas fa-sync-alt"></i></button></div>' +
            '<div class="pa-row" style="margin-top:6px"><label class="pa-chk"><input type="checkbox" id="pa-showall"> All users, not only pickers</label><button class="pa-btn" id="pa-self" style="margin-left:auto"><i class="fas fa-user"></i> Sign in yourself</button></div>' +
            '<ul class="pa-plist" id="pa-plist"></ul><p class="pa-src" id="pa-src"></p></div>' +
            '<div class="pa-card"><h3>Screen</h3><div class="pa-row" style="margin-top:0"><select class="pa-sel" id="pa-size">' + Object.keys(SIZES).map(function (k) { return '<option value="' + k + '"' + (k === st.size ? ' selected' : '') + '>' + SIZES[k][2] + '</option>'; }).join('') + '</select>' +
            '<button class="pa-btn" id="pa-rotate" title="Rotate"><i class="fas fa-sync-alt"></i> Rotate</button><button class="pa-btn" id="pa-open" title="Open the app in its own tab"><i class="fas fa-external-link-alt"></i> Own tab</button></div></div>' +
            '<div class="pa-card"><h3>Blocked by View only <small id="pa-blocked-n"></small></h3><ul class="pa-log" id="pa-blocked"></ul></div>' +
            '<div class="pa-card"><h3>Calls through this PC <small id="pa-calls-n"></small></h3><ul class="pa-log" id="pa-log"></ul></div>' +
            '</div>' +
            '<div class="pa-stage"><div class="pa-hint" id="pa-hint" hidden></div><div class="pa-frames" id="pa-frames"></div></div></div>';
        r.querySelector('#pa-viewonly').onchange = function () { setViewOnly(this.checked); };
        r.querySelector('#pa-size').onchange = function () { st.size = this.value; ls('wms.pa.size', st.size); sizeFrames(); };
        r.querySelector('#pa-rotate').onclick = function () { st.landscape = !st.landscape; sizeFrames(); };
        r.querySelector('#pa-open').onclick = function () { try { window.open(SRC, '_blank'); } catch (e) { /* blocked */ } };
        r.querySelector('#pa-self').onclick = function () { open(null); };
        r.querySelector('#pa-q').oninput = function () { st.filter = this.value; paintPickers(); };
        r.querySelector('#pa-showall').onchange = function () { st.showAll = this.checked; paintPickers(); };
        r.querySelector('#pa-pickers-refresh').onclick = function () { loadPickers(true); };
        st.drawn = true;
        paintStatus(); paintLog(); paintBlocked(); paintPickers(); paintHint();
        loadPickers(false);
        open(null);
    }
    function paintHint() { var el = document.getElementById('pa-hint'); if (!el) return; el.hidden = st.frames.length > 0; el.innerHTML = '<i class="fas fa-mobile-alt"></i><b>No app open.</b> Click a picker on the left to open the app as that picker, or <a id="pa-hint-self">sign in yourself</a>.'; var a = el.querySelector('#pa-hint-self'); if (a) a.onclick = function () { open(null); }; }
    function setViewOnly(on) {
        st.viewOnly = !!on; ls('wms.pa.viewOnly', st.viewOnly ? '1' : '0');
        var c = document.getElementById('pa-viewonly'); if (c && c.checked !== st.viewOnly) c.checked = st.viewOnly;
        sendMode(); paintStatus(); st.frames.forEach(paintPills);
        if (!st.viewOnly && st.frames.some(function (f) { return f.picker; })) host({ action: 'aiAudit', source: 'WMS_PICKER_APP', actionKey: 'picker_app_live', outcome: 'OK', instance: curInstance(), refId: 'PICKERS:' + st.frames.filter(function (f) { return f.picker; }).map(function (f) { return f.picker.username || f.picker.name; }).join(','), target: st.frames.length + ' app(s)', detail: 'View only switched OFF by ' + user() + ' with picker apps open' }, 15000).catch(function () {});
    }
    function paintStatus() {
        var el = document.getElementById('pa-status'); if (!el) return;
        var ready = st.frames.filter(function (f) { return f.ready; }).length;
        el.innerHTML = '<span class="pa-pill' + (st.frames.length ? ' ok' : '') + '">' + st.frames.length + ' app' + (st.frames.length === 1 ? '' : 's') + ' open' + (st.frames.length ? ' · ' + ready + ' connected' : '') + '</span>' +
            (hosted() ? '<span class="pa-pill ok">relay on</span>' : '<span class="pa-pill bad">no desktop host — Oracle calls will fail</span>') +
            (st.viewOnly ? '<span class="pa-pill warn"><i class="fas fa-eye"></i> view only</span>' : '<span class="pa-pill bad"><i class="fas fa-bolt"></i> live</span>');
        var b = document.getElementById('pa-build'), bf = st.frames.filter(function (f) { return f.build; })[0]; if (b) b.textContent = bf ? (bf.build.app || 'FCPos') + ' ' + (bf.build.version || '') + (bf.build.commit ? ' · ' + bf.build.commit : '') : '';
    }
    function paintPills(f) { var el = document.getElementById('pa-pills-' + f.id); if (!el) return; el.innerHTML = (f.ready ? '<span class="pa-pill ok">connected</span>' : f.loaded ? '<span class="pa-pill warn">no bridge</span>' : '<span class="pa-pill">loading…</span>') + (f.picker ? (st.viewOnly ? '<span class="pa-pill warn">view only</span>' : '<span class="pa-pill bad">live</span>') : ''); }
    function paintPickers() {
        var el = document.getElementById('pa-plist'), n = document.getElementById('pa-pickers-n'), src = document.getElementById('pa-src'); if (!el) return;
        var list = visiblePickers(), openBy = {}; st.frames.forEach(function (f) { if (f.picker) openBy[f.picker.username] = f.id; });
        if (n) n.textContent = st.pickersBusy ? 'reading…' : st.pickers ? list.length + (st.showAll ? ' users' : ' picker' + (list.length === 1 ? '' : 's')) : '';
        if (st.pickersBusy && !st.pickers) el.innerHTML = '<li class="pa-empty"><i class="fas fa-spinner fa-spin"></i> reading the users…</li>';
        else if (st.pickersErr && !(st.pickers || []).length) el.innerHTML = '<li class="pa-empty">Could not read the pickers: ' + esc(st.pickersErr) + '</li>';
        else if (!list.length) el.innerHTML = '<li class="pa-empty">' + (st.pickers && st.pickers.length ? 'No ' + (st.showAll ? 'user' : 'picker') + ' matches.' : 'No pickers found.') + '</li>';
        else el.innerHTML = list.slice(0, 200).map(function (p) {
            var fid = openBy[p.username];
            return '<li class="pa-p' + (fid ? ' open' : '') + (p.active ? '' : ' off') + '" data-u="' + esc(p.username) + '"><span class="pa-av sm" style="background:' + colour(p.name) + '">' + esc(initials(p.name)) + '</span><span class="pa-who"><b>' + esc(p.name) + '</b><small>' + esc(p.username) + (p.type && p.type !== 'PICKER' ? ' · ' + esc(p.type) : '') + (p.warehouse ? ' · ' + esc(p.warehouse) : '') + (p.active ? '' : ' · inactive') + '</small></span>' +
                '<button class="pa-btn sm' + (fid ? '' : ' primary') + '" data-open="' + esc(p.username) + '">' + (fid ? '<i class="fas fa-eye"></i> Show' : '<i class="fas fa-mobile-alt"></i> Open') + '</button></li>';
        }).join('');
        el.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { var u = b.getAttribute('data-open'), p = (st.pickers || []).filter(function (x) { return x.username === u; })[0]; if (p) open(p); }; });
        if (src) src.textContent = st.pickers && st.pickers.length ? 'From ' + st.pickersSrc + '. Opening a picker signs the app in as them without a password; what they do here is recorded under their name.' : '';
    }
    function paintLog() {
        var el = document.getElementById('pa-log'), n = document.getElementById('pa-calls-n'); if (!el) return;
        if (n) n.textContent = st.calls ? st.calls + ' call' + (st.calls === 1 ? '' : 's') : '';
        el.innerHTML = st.log.length ? st.log.map(function (l) { return '<li' + (l.blocked ? ' class="blocked"' : '') + ' title="' + esc(l.who) + ' · ' + esc(l.path) + (l.note ? ' · ' + esc(l.note) : '') + '"><span class="w" style="background:' + colour(l.who) + '">' + esc(initials(l.who)) + '</span><span class="m">' + esc(l.method) + '</span><span class="s' + (l.ok ? '' : ' bad') + '">' + esc(l.status) + '</span><span>' + esc(l.path) + '</span><span class="t">' + (l.blocked ? 'blocked' : l.ms + ' ms') + '</span></li>'; }).join('') : '<li class="pa-empty">Nothing yet — no app has called Oracle.</li>';
    }
    function paintBlocked() {
        var el = document.getElementById('pa-blocked'), n = document.getElementById('pa-blocked-n'); if (!el) return;
        if (n) n.textContent = st.blocked.length ? st.blocked.length : '';
        el.innerHTML = st.blocked.length ? st.blocked.map(function (b) { return '<li class="blocked" title="' + esc(b.who) + ' · ' + esc(b.path) + '"><span class="w" style="background:' + colour(b.who) + '">' + esc(initials(b.who)) + '</span><span class="m">' + esc(b.method) + '</span><span>' + esc(b.path) + '</span><span class="t">' + esc(b.at) + '</span></li>'; }).join('') : '<li class="pa-empty">Nothing blocked. Turn View only off to let the apps change data.</li>';
    }
    function note(m, t) { if (typeof showNotification === 'function') showNotification(m, t || 'info'); else console.log('[Picker app]', m); }
    window.addEventListener('resize', function () { if (st.drawn) sizeFrames(); });

    var PA = window.WmsPickerApp = {
        onShow: function () { if (!st.drawn) draw(); else sizeFrames(); },
        open: function () { return open(null); },
        openPicker: function (username) { var p = (st.pickers || []).filter(function (x) { return x.username === username || x.name === username; })[0]; return p ? open(p) : null; },
        close: close, reload: reloadAll, setViewOnly: setViewOnly, loadPickers: function () { return loadPickers(true); },
        state: function () { return { drawn: st.drawn, viewOnly: st.viewOnly, size: st.size, landscape: st.landscape, calls: st.calls, log: st.log.slice(), blocked: st.blocked.slice(), src: SRC, pickers: st.pickers, pickersSrc: st.pickersSrc, pickersErr: st.pickersErr, showAll: st.showAll,
            frames: st.frames.map(function (f) { return { id: f.id, label: f.label, picker: f.picker ? f.picker.username : null, instance: f.instance, ready: f.ready, loaded: f.loaded, calls: f.calls, build: f.build }; }) }; }
    };
    function hook() {
        var orig = window.navigateToPage;
        if (typeof orig !== 'function' || orig.__pa) return false;
        var w = function (pageId) { var r = orig.apply(this, arguments); if (pageId === PAGE) PA.onShow(); return r; };
        w.__pa = true; window.navigateToPage = w;
        return true;
    }
    if (!hook()) document.addEventListener('DOMContentLoaded', function () { setTimeout(hook, 0); });
    document.addEventListener('DOMContentLoaded', function () {
        setTimeout(function () { var r = root(); if (r && r.style.display !== 'none' && (location.hash === '#' + PAGE || new URLSearchParams(location.search).get('page') === PAGE)) PA.onShow(); }, 400);
    });
})();
