/* Page guard: <script src="../Home/access-guard.js" data-module="finance" data-title="Finance Lens"></script> as the first
 * script of a module page. Uses this PC's copy of the signed-in user's module access (written by Home / Home/access.js):
 * when that copy says the user does not have the module, the page goes back to Home with a notice. No copy (access not
 * set up, never read) = the page opens as before. Not used inside frames (a module may embed another one). */
(function () {
    'use strict';
    try {
        if (window.top !== window.self) return;
        var me = document.currentScript, code = me && me.getAttribute('data-module'), title = (me && me.getAttribute('data-title')) || code;
        if (!code || localStorage.getItem('loggedIn') !== 'true') return;
        var user = (localStorage.getItem('username') || localStorage.getItem('wms_user') || '').trim().toUpperCase();
        var raw = user && localStorage.getItem('access.mods.' + user), c = raw ? JSON.parse(raw) : null;
        if (!c || c.state !== 'ok') return;
        var ok = (c.modules || []).some(function (m) { return String(m).toLowerCase() === code.toLowerCase(); });
        if (!ok) { window.ACCESS_BLOCKED = true; window.FIN_BLOCKED = true; location.replace('../Home/index.html?blocked=' + encodeURIComponent(title)); }
    } catch (e) { }
})();
