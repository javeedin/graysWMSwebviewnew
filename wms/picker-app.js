// ═══════════════════════════════════════════════════════════════════════════════
// PICKER APP — the pickers' mobile app (FCPos, javeedin/reerpPOSMobileApp) inside the WMS desktop: menu item
// data-page="picker-app" (group Operate). The page shows mobile/index.html (the app's web build, written by
// tools/mobile/build-mobile.js) in a phone-shaped frame and answers the app's Oracle calls: the bridge inside the build
// (mobile/bridge.js) posts every APEX / Fusion request to this page, which runs it through the desktop host's relay
// (executeGet / executePost / executeOracleFusionGet / Post / Patch) and posts the answer back — no CORS, Fusion
// credentials stay in C#. "View only" (default on, localStorage wms.pa.viewOnly) blocks the calls that change data
// (pick confirm, ship confirm, cancel, pick wave …) and lists them in the panel; off = fully live. Size phone / large
// phone / tablet, rotate, reload, open in its own tab. The frame is kept while other pages are shown (the page is only
// hidden), so the app keeps its login and screen. window.WmsPickerApp = {onShow, reload, setViewOnly, state}
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    var PAGE = 'picker-app';
    var SRC = window.WMS_PICKER_APP_SRC || '../mobile/index.html';
    var SIZES = { phone: [390, 844, 'Phone · 390 × 844'], large: [430, 932, 'Large phone · 430 × 932'], tablet: [820, 1180, 'Tablet · 820 × 1180'] };
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
    function hosted() { return !!(window.chrome && window.chrome.webview && typeof sendMessageToCSharp === 'function'); }
    function curInstance() {
        var el = document.getElementById('current-instance-display'), v = el ? String(el.textContent || '').trim().toUpperCase() : '';
        if (!v) { try { v = String(sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || '').toUpperCase(); } catch (e) { v = ''; } }
        return v || 'PROD';
    }
    function hhmm(d) { d = d || new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }
    var st = { drawn: false, viewOnly: ls('wms.pa.viewOnly') !== '0', size: ls('wms.pa.size') || 'phone', landscape: false, ready: false, loaded: false, build: null, calls: 0, log: [], blocked: [], missingTimer: null, frameSeq: 0 };

    function root() { return document.getElementById(PAGE); }
    function frame() { return document.getElementById('pa-frame'); }
    function pathOf(url) { try { var u = new URL(url); return u.pathname.replace(/^\/ords\/WKSP_GRAYSAPP\//, '').replace(/^\/fscmRestApi\/resources\/[\d.]+\//, 'fusion/') + (u.search ? '?' + u.search.slice(1, 40) : ''); } catch (e) { return String(url).slice(0, 80); } }

    // ── the relay: one request of the app → the host → the answer back to the frame ─────────────────────────────────
    function relay(m) {
        var f = frame(), t0 = Date.now(), url = String(m.url || ''), method = String(m.method || 'GET').toUpperCase();
        var apex = /oraclecloudapps\.com\//i.test(url), fusion = !apex && /\.oraclecloud\.com\//i.test(url);
        var reply = function (ok, status, body, note) {
            st.calls++; st.log.unshift({ at: hhmm(), method: method, path: pathOf(url), ok: ok, status: status, ms: Date.now() - t0, note: note || '' }); st.log = st.log.slice(0, 40); paintLog();
            if (f && f.contentWindow) { try { f.contentWindow.postMessage({ type: 'wms-mobile-reply', id: m.id, ok: ok, status: status, body: body, contentType: 'application/json' }, '*'); } catch (e) { /* frame gone */ } }
        };
        if (!hosted()) { reply(false, 503, JSON.stringify({ success: false, error: 'Open the WMS inside the Gray\'s WMS app — the relay needs the desktop host.' }), 'no host'); return; }
        var msg = null;
        if (apex && method === 'GET') msg = { action: 'executeGet', fullUrl: url };
        else if (apex && method === 'POST') msg = { action: 'executePost', fullUrl: url, body: m.body == null ? '' : String(m.body) };
        else if (fusion && method === 'GET') msg = { action: 'executeOracleFusionGet', fullUrl: url, instance: m.instance || curInstance() };
        else if (fusion && method === 'POST') msg = { action: 'executeOracleFusionPost', fullUrl: url, body: m.body == null ? '' : String(m.body), instance: m.instance || curInstance() };
        else if (fusion && method === 'PATCH') msg = { action: 'executeOracleFusionPatch', fullUrl: url, body: m.body == null ? '' : String(m.body), instance: m.instance || curInstance() };
        if (!msg) { reply(false, 405, JSON.stringify({ success: false, error: method + ' is not relayed by the WMS desktop.' }), 'not relayed'); return; }
        try {
            sendMessageToCSharp(msg, function (err, data, statusCode) {
                if (err) { var body = err.body != null ? String(err.body) : JSON.stringify({ success: false, error: err.message || String(err) }); reply(false, err.statusCode || 500, body, err.message || ''); return; }
                reply(true, statusCode || 200, typeof data === 'string' ? data : JSON.stringify(data == null ? {} : data));
            }, 180000, false);
        } catch (e) { reply(false, 500, JSON.stringify({ success: false, error: e && e.message || String(e) }), 'relay error'); }
    }
    function onMessage(e) {
        var f = frame(); if (!f || e.source !== f.contentWindow) return;
        var m = e.data; if (!m || typeof m !== 'object') return;
        if (m.type === 'wms-mobile-hello') { st.ready = true; st.loaded = true; st.build = m.build || st.build; clearTimeout(st.missingTimer); hideMissing(); sendMode(true); paintStatus(); }
        else if (m.type === 'wms-mobile-relay') relay(m);
        else if (m.type === 'wms-mobile-blocked') { st.blocked.unshift({ at: hhmm(), method: m.method, path: pathOf(m.url) }); st.blocked = st.blocked.slice(0, 20); st.log.unshift({ at: hhmm(), method: m.method, path: pathOf(m.url), ok: false, status: 403, ms: 0, note: 'blocked · view only', blocked: true }); st.log = st.log.slice(0, 40); paintLog(); paintBlocked(); }
    }
    function sendMode(ready) { var f = frame(); if (!f || !f.contentWindow) return; try { f.contentWindow.postMessage(ready ? { type: 'wms-mobile-ready', viewOnly: st.viewOnly } : { type: 'wms-mobile-mode', viewOnly: st.viewOnly }, '*'); } catch (e) { /* frame gone */ } }
    window.addEventListener('message', onMessage);

    // ── page ────────────────────────────────────────────────────────────────────────────────────────────────────
    function draw() {
        var r = root(); if (!r) return;
        r.innerHTML = '<div class="pa">' +
            '<div class="pa-side">' +
            '<div class="pa-card"><h3><i class="fas fa-mobile-alt" style="color:#1e3a8a"></i> Picker app <small id="pa-build"></small></h3><p>The FCPos app your pickers use, exactly as it is on their phones. Sign in with a picker login inside it, then tap WMS. Its Oracle calls run through this PC.</p>' +
            '<div class="pa-status" id="pa-status" style="margin-top:8px"></div></div>' +
            '<div class="pa-card"><label class="pa-switch"><input type="checkbox" id="pa-viewonly"' + (st.viewOnly ? ' checked' : '') + '><span class="k"></span><span><b>View only</b><small>Pick confirm, ship confirm, cancel and pick wave are blocked. Off = live, exactly like the phone.</small></span></label></div>' +
            '<div class="pa-card"><h3>Screen</h3><div class="pa-row"><select class="pa-sel" id="pa-size">' + Object.keys(SIZES).map(function (k) { return '<option value="' + k + '"' + (k === st.size ? ' selected' : '') + '>' + SIZES[k][2] + '</option>'; }).join('') + '</select>' +
            '<button class="pa-btn" id="pa-rotate" title="Rotate"><i class="fas fa-sync-alt"></i> Rotate</button></div>' +
            '<div class="pa-row"><button class="pa-btn" id="pa-reload" title="Load the app again"><i class="fas fa-redo"></i> Reload</button><button class="pa-btn" id="pa-open" title="Open the app in its own tab"><i class="fas fa-external-link-alt"></i> Own tab</button></div></div>' +
            '<div class="pa-card"><h3>Blocked by View only <small id="pa-blocked-n"></small></h3><ul class="pa-log" id="pa-blocked"></ul></div>' +
            '<div class="pa-card"><h3>Calls through this PC <small id="pa-calls-n"></small></h3><ul class="pa-log" id="pa-log"></ul></div>' +
            '</div>' +
            '<div class="pa-stage"><div class="pa-phone" id="pa-phone"><div class="pa-missing" id="pa-missing" hidden></div><iframe class="pa-screen" id="pa-frame" title="Picker app" allow="camera; microphone; clipboard-write"></iframe></div></div></div>';
        r.querySelector('#pa-viewonly').onchange = function () { setViewOnly(this.checked); };
        r.querySelector('#pa-size').onchange = function () { st.size = this.value; ls('wms.pa.size', st.size); sizeFrame(); };
        r.querySelector('#pa-rotate').onclick = function () { st.landscape = !st.landscape; sizeFrame(); };
        r.querySelector('#pa-reload').onclick = reload;
        r.querySelector('#pa-open').onclick = function () { try { window.open(SRC, '_blank'); } catch (e) { /* blocked */ } };
        sizeFrame(); load(); paintStatus(); paintLog(); paintBlocked();
        st.drawn = true;
    }
    function sizeFrame() { var p = document.getElementById('pa-phone'); if (!p) return; var s = SIZES[st.size] || SIZES.phone, w = st.landscape ? s[1] : s[0], h = st.landscape ? s[0] : s[1]; var scale = Math.min(1, (window.innerHeight - 150) / (h + 28)); p.style.width = w + 'px'; p.style.height = h + 'px'; p.style.transform = scale < 1 ? 'scale(' + scale.toFixed(3) + ')' : ''; p.style.transformOrigin = 'top center'; p.classList.toggle('tablet', st.size === 'tablet'); var stage = p.parentElement; if (stage) stage.style.height = Math.round((h + 28) * (scale < 1 ? scale : 1)) + 'px'; }
    function load() {
        var f = frame(); if (!f) return;
        st.ready = false; st.loaded = false; st.frameSeq++;
        hideMissing();
        f.src = SRC + (SRC.indexOf('?') >= 0 ? '&' : '?') + 'wms=' + st.frameSeq;
        clearTimeout(st.missingTimer);
        st.missingTimer = setTimeout(function () { if (!st.ready) showMissing(); }, 8000);
        paintStatus();
    }
    function reload() { load(); }
    function showMissing() {
        var el = document.getElementById('pa-missing'); if (!el) return;
        el.innerHTML = '<i class="fas fa-mobile-alt" style="font-size:30px;color:#475569;margin-bottom:10px"></i><b>The app did not answer.</b><span style="margin-top:6px">Either the mobile build is not installed on this PC (<code>mobile/index.html</code> next to the wms folder — run <code>node tools/mobile/build-mobile.js</code>) or it is still loading.</span><button class="pa-btn primary" id="pa-missing-retry" style="margin-top:14px"><i class="fas fa-redo"></i> Try again</button>';
        el.hidden = false; var b = el.querySelector('#pa-missing-retry'); if (b) b.onclick = reload;
        paintStatus();
    }
    function hideMissing() { var el = document.getElementById('pa-missing'); if (el) el.hidden = true; }
    function setViewOnly(on) { st.viewOnly = !!on; ls('wms.pa.viewOnly', st.viewOnly ? '1' : '0'); var c = document.getElementById('pa-viewonly'); if (c && c.checked !== st.viewOnly) c.checked = st.viewOnly; sendMode(false); paintStatus(); }
    function paintStatus() {
        var el = document.getElementById('pa-status'); if (!el) return;
        el.innerHTML = (st.ready ? '<span class="pa-pill ok"><i class="fas fa-link"></i> connected</span>' : st.loaded ? '<span class="pa-pill warn">no bridge</span>' : '<span class="pa-pill">loading…</span>') +
            (hosted() ? '<span class="pa-pill ok">relay on</span>' : '<span class="pa-pill bad">no desktop host — Oracle calls will fail</span>') +
            (st.viewOnly ? '<span class="pa-pill warn"><i class="fas fa-eye"></i> view only</span>' : '<span class="pa-pill bad"><i class="fas fa-bolt"></i> live</span>');
        var b = document.getElementById('pa-build'); if (b) b.textContent = st.build ? (st.build.app || 'FCPos') + ' ' + (st.build.version || '') + (st.build.commit ? ' · ' + st.build.commit : '') : '';
    }
    function paintLog() {
        var el = document.getElementById('pa-log'), n = document.getElementById('pa-calls-n'); if (!el) return;
        if (n) n.textContent = st.calls ? st.calls + ' call' + (st.calls === 1 ? '' : 's') : '';
        el.innerHTML = st.log.length ? st.log.map(function (l) { return '<li' + (l.blocked ? ' class="blocked"' : '') + ' title="' + esc(l.path) + (l.note ? ' · ' + esc(l.note) : '') + '"><span class="m">' + esc(l.method) + '</span><span class="s' + (l.ok ? '' : ' bad') + '">' + esc(l.status) + '</span><span>' + esc(l.path) + '</span><span class="t">' + (l.blocked ? 'blocked' : l.ms + ' ms') + '</span></li>'; }).join('') : '<li class="pa-empty">Nothing yet — the app has not called Oracle.</li>';
    }
    function paintBlocked() {
        var el = document.getElementById('pa-blocked'), n = document.getElementById('pa-blocked-n'); if (!el) return;
        if (n) n.textContent = st.blocked.length ? st.blocked.length : '';
        el.innerHTML = st.blocked.length ? st.blocked.map(function (b) { return '<li class="blocked" title="' + esc(b.path) + '"><span class="m">' + esc(b.method) + '</span><span>' + esc(b.path) + '</span><span class="t">' + esc(b.at) + '</span></li>'; }).join('') : '<li class="pa-empty">Nothing blocked. Turn View only off to let the app change data.</li>';
    }
    window.addEventListener('resize', function () { if (st.drawn) sizeFrame(); });

    var PA = window.WmsPickerApp = {
        onShow: function () { if (!st.drawn) draw(); else sizeFrame(); },
        reload: reload, setViewOnly: setViewOnly,
        state: function () { return { drawn: st.drawn, ready: st.ready, loaded: st.loaded, viewOnly: st.viewOnly, size: st.size, landscape: st.landscape, build: st.build, calls: st.calls, log: st.log.slice(), blocked: st.blocked.slice(), src: SRC }; }
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
