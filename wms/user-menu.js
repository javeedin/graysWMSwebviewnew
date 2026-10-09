// ============================================================================
// USER MENU — one avatar at the right end of the header; a click opens a popup with everything the old toolbar spread out:
// who is signed in and since when, the instance (PROD / TEST switch inside the WMS, read-only on Home), the Fusion
// integration-user check, Refresh / Logout (Home is an icon on the toolbar). Shared by wms/index.html (mode "wms") and Home/index.html (mode "home").
// The ids the other scripts write to keep living inside the popup, so nothing else changes: #logged-in-username,
// #login-datetime, #current-instance-display (+ -mini), #integration-user-badge / #integration-user-icon, and the WMS's own
// selectInstance() still does the switching. window.USER_MENU = { mode, mount } configures it before this script loads.
// ============================================================================
(function () {
    'use strict';
    var cfg = Object.assign({ mode: 'wms', mount: '#wms-user-menu', version: '' }, window.USER_MENU || {});
    function version() { if (cfg.version) return cfg.version; var b = document.getElementById('app-version-badge') || document.querySelector('.version-badge'); return b ? b.textContent.trim() : ''; }
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    function ls(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
    function ss(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
    /** "javeed" → JA, "Khalid S" → KS, "john.doe" → JD. */
    function initials(name) {
        var s = String(name || '').trim(); if (!s) return '?';
        var parts = s.split(/[\s._\-@]+/).filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return s.slice(0, 2).toUpperCase();
    }
    var PALETTE = ['#4f46e5', '#0e7490', '#15803d', '#b45309', '#be185d', '#7c3aed', '#1d4ed8', '#0f766e'];
    function colour(name) { var h = 0, s = String(name || ''); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return PALETTE[h % PALETTE.length]; }
    function fmtTime(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleDateString() + ' ' + d.toLocaleTimeString(); }

    var UM = { btn: null, pop: null, open: false, home: cfg.mode === 'home' };
    function guest() { return UM.home && ls('loggedIn') !== 'true'; }
    function name() {
        if (UM.home) return guest() ? 'Guest' : (ls('username') || ls('fusionUsername') || 'User');
        var el = document.getElementById('logged-in-username');
        return (el && el.textContent.trim()) || ss('loggedInUsername') || ls('username') || ls('fusionUsername') || '';
    }
    function instance() {
        if (UM.home) return guest() ? '' : String(ls('instanceName') || ls('fusionInstance') || '').toUpperCase();
        var el = document.getElementById('current-instance-display');
        return String((el && el.textContent.trim()) || ss('loggedInInstance') || ls('fusionInstance') || 'PROD').toUpperCase();
    }
    function since() {
        if (UM.home) { var t = ls('loginTime'); return guest() ? 'Not logged in' : t ? 'Logged in: ' + fmtTime(t) : ''; }
        var el = document.getElementById('login-datetime'); return el ? el.textContent.trim() : '';
    }

    // ─── build ─────────────────────────────────────────────────────────────────
    function build() {
        var mount = document.querySelector(cfg.mount); if (!mount || UM.btn) return;
        mount.innerHTML = '<button type="button" class="um-btn" id="um-btn" aria-haspopup="dialog" aria-expanded="false" title="Account, instance and sign-out">' +
            '<span class="um-avatar" id="um-av">?</span><span class="um-who"><b id="um-who-name"></b><span class="um-tag" id="um-tag">PROD</span></span><i class="fas fa-chevron-down"></i></button>';
        UM.btn = mount.querySelector('#um-btn');
        var pop = document.createElement('div'); pop.className = 'um-pop'; pop.id = 'um-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Account');
        pop.innerHTML = UM.home ? homeHtml() : wmsHtml();
        document.body.appendChild(pop); UM.pop = pop;
        UM.btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
        document.addEventListener('click', function (e) { if (UM.open && !pop.contains(e.target) && !UM.btn.contains(e.target)) close(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && UM.open) close(); });
        window.addEventListener('resize', function () { if (UM.open) place(); });
        pop.querySelectorAll('.um-seg button[data-inst]').forEach(function (b) {
            b.addEventListener('click', function () {
                var inst = b.getAttribute('data-inst');
                if (typeof window.selectInstance === 'function') window.selectInstance(inst);
                else { var el = document.getElementById('current-instance-display'); if (el) el.textContent = inst; }
                paint();
            });
        });
        watch(); paint();
    }
    function wmsHtml() {
        return '<div class="um-head"><span class="um-avatar xl" id="um-av-xl">?</span><div style="min-width:0;flex:1"><div id="logged-in-username" class="um-name"></div><div id="login-datetime" class="um-sub">Not logged in</div></div></div>' +
            '<div class="um-sec um-row"><span class="um-lbl">Instance</span><div class="um-seg"><button type="button" data-inst="PROD"><i class="fas fa-check"></i>PROD</button><button type="button" data-inst="TEST" class="test"><i class="fas fa-check"></i>TEST</button></div>' +
            '<span id="current-instance-display" class="um-hidden">PROD</span><span id="current-instance-display-mini" class="um-hidden"></span></div>' +
            '<div class="um-sec um-row"><span class="um-lbl">Fusion integration user</span><span id="integration-user-badge" title="Checking Fusion Integration user..." style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:#64748b;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;padding:3px 10px;cursor:default;"><i id="integration-user-icon" class="fas fa-circle-notch fa-spin" style="color:#94a3b8;"></i> Integration User</span></div>' +
            '<div class="um-actions"><button type="button" onclick="window.location.reload()" title="Refresh this page"><i class="fas fa-sync-alt"></i> Refresh</button><button type="button" class="danger" onclick="handleLogout()"><i class="fas fa-sign-out-alt"></i> Logout</button></div>' +
            '<div class="um-foot"><span>Gray\'s WMS' + (version() ? ' · ' + esc(version()) : '') + '</span><span id="um-foot-right"></span></div>';
    }
    function homeHtml() {
        return '<div class="um-head"><span class="um-avatar xl" id="um-av-xl">?</span><div style="min-width:0;flex:1"><div class="um-name" id="um-home-name"></div><div class="um-sub" id="um-home-since"></div></div></div>' +
            '<div class="um-sec um-row"><span class="um-lbl">Instance</span><span class="um-inst-ro" id="um-home-inst"></span></div>' +
            '<div class="um-actions" id="um-home-actions"></div>' +
            '<div class="um-foot"><span>Fusion Client' + (version() ? ' · ' + esc(version()) : '') + '</span><span>' + esc(new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })) + '</span></div>';
    }
    // ─── paint: the button and the popup follow the ids the other scripts write ───
    function paint() {
        if (!UM.btn) return;
        var n = name(), inst = instance(), g = guest(), ini = g ? '?' : initials(n), col = colour(n);
        [document.getElementById('um-av'), document.getElementById('um-av-xl')].forEach(function (a) { if (!a) return; a.textContent = ini; a.style.background = g ? '' : col; a.classList.toggle('guest', g); });
        var who = document.getElementById('um-who-name'); if (who) who.textContent = n || '';
        var tag = document.getElementById('um-tag'); if (tag) { tag.textContent = inst || (g ? 'Guest' : '—'); tag.className = 'um-tag' + (inst === 'TEST' ? ' test' : inst ? '' : ' none'); }
        UM.btn.title = (n ? n + ' · ' : '') + (inst ? 'Instance ' + inst : g ? 'not signed in' : '') + ' — account, instance and sign-out';
        if (UM.home) {
            var hn = document.getElementById('um-home-name'), hs = document.getElementById('um-home-since'), hi = document.getElementById('um-home-inst'), ha = document.getElementById('um-home-actions');
            if (hn) hn.textContent = n; if (hs) hs.textContent = since();
            if (hi) hi.innerHTML = inst ? '<span class="um-tag ' + (inst === 'TEST' ? 'test' : '') + '" style="color:#0f172a">' + esc(inst) + '</span> <span style="font-weight:500;color:#64748b">set at login</span>' : '<span style="font-weight:500;color:#64748b">not signed in</span>';
            if (ha) ha.innerHTML = g ? '<button type="button" class="primary" onclick="handleAuthAction()"><i class="fas fa-right-to-bracket"></i> Login</button>' :
                '<a class="primary" href="../wms/index.html"><i class="fas fa-warehouse"></i> Open WMS</a><button type="button" class="danger" onclick="handleAuthAction()"><i class="fas fa-right-from-bracket"></i> Logout</button>';
        } else {
            UM.pop.querySelectorAll('.um-seg button[data-inst]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-inst') === inst); });
            var fr = document.getElementById('um-foot-right'); if (fr) fr.textContent = inst ? 'Instance ' + inst : '';
        }
    }
    function watch() {
        if (!window.MutationObserver) return;
        ['logged-in-username', 'current-instance-display', 'login-datetime'].forEach(function (id) { var el = document.getElementById(id); if (el) new MutationObserver(paint).observe(el, { childList: true, characterData: true, subtree: true }); });
        window.addEventListener('storage', paint);
    }
    function place() {
        var r = UM.btn.getBoundingClientRect(), w = UM.pop.offsetWidth || 320;
        UM.pop.style.top = Math.round(r.bottom + 8) + 'px';
        UM.pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, Math.round(r.right - w))) + 'px';
    }
    function open() { if (!UM.pop) return; paint(); UM.pop.classList.add('open'); UM.open = true; UM.btn.classList.add('open'); UM.btn.setAttribute('aria-expanded', 'true'); place(); }
    function close() { if (!UM.pop) return; UM.pop.classList.remove('open'); UM.open = false; UM.btn.classList.remove('open'); UM.btn.setAttribute('aria-expanded', 'false'); }
    function toggle() { if (UM.open) close(); else open(); }

    window.WmsUserMenu = { open: open, close: close, toggle: toggle, refresh: paint, initials: initials, state: function () { return { name: name(), instance: instance(), since: since(), open: UM.open, guest: guest() }; } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
    // the header may be parsed after this script when it is loaded early: build as soon as the mount exists
    if (!UM.btn) build();
})();
