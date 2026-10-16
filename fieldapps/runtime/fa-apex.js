/* Field Apps · APEX apps (window.FAX; module.exports in node) — ONE file for the desktop page, the runtime shell (phones) and
 * the tests. An APEX app is an Oracle APEX application (Universal Theme, installable as a PWA) built in APEX App Builder; Field
 * Apps publishes it to the phones like any other app: its "code" is a small signed launcher JSON
 *   {"type":"apex","url":"https://…/ords/r/<workspace>/<alias>/home","hosts":["login.microsoftonline.com"]}
 * so the address cannot be changed without a new signature. The phone opens that address full screen in its WebView (only the
 * app's own host and the hosts listed may be navigated to); the APEX app signs the user in with its own authentication — the URL
 * placeholders {{USER}} {{POD}} {{DEVICE}} {{APP}} are context for the app (e.g. P0_POD), never a sign-in. */
(function (root) {
    'use strict';
    var FAX = {};
    /** hosts an APEX app may live on (Oracle Autonomous Database APEX / ORDS) */
    FAX.HOST_SUFFIXES = ['.oraclecloudapps.com', '.oraclecloud.com'];
    /** the App Builder sign-in of the Grays APEX workspace (Setup › APEX App Builder can change it; never a password here) */
    FAX.DEFAULT_BUILDER = 'https://g09254cbbf8e7af-apextestdb.adb.eu-frankfurt-1.oraclecloudapps.com/ords/r/apex/workspace-sign-in/select-workspace';

    function parse(u) {
        var m = /^(https?):\/\/([^\/?#:]+)(:\d+)?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(String(u || '').trim());
        if (!m) return null;
        return { scheme: m[1].toLowerCase(), host: m[2].toLowerCase(), port: m[3] || '', path: m[4] || '/', query: (m[5] || '').slice(1), hash: m[6] || '' };
    }
    function hostOk(host, extra) {
        host = String(host || '').toLowerCase();
        if (FAX.HOST_SUFFIXES.some(function (s) { return host.length > s.length && host.slice(-s.length) === s; })) return true;
        return (extra || []).some(function (h) { h = String(h || '').toLowerCase().replace(/^\*\./, '.'); return h && (h[0] === '.' ? host.slice(-h.length) === h : host === h); });
    }
    FAX.hostOk = hostOk;
    /** query string without APEX's session-bound parameters (a copied address carries the copier's session) */
    function cleanQuery(q) {
        return String(q || '').split('&').filter(function (p) {
            if (!p) return false;
            var k = decodeURIComponent(p.split('=')[0] || '').toLowerCase();
            return ['session', 'p_session', 'cs', 'clear', 'p20_workspace', 'p_trace', 'debug', 'x01'].indexOf(k) < 0;
        }).join('&');
    }
    /** an APEX address as stored: https, ORDS path, no session — f?p=APP:PAGE:SESSION:… keeps APP:PAGE and drops the session */
    FAX.normalize = function (u) {
        var p = parse(u); if (!p) return '';
        var q = cleanQuery(p.query);
        if (/\/ords\/f$/i.test(p.path)) {
            var fp = /(^|&)p=([^&]*)/i.exec(p.query || '');
            if (fp) { var parts = decodeURIComponent(fp[2]).split(':'); q = 'p=' + [parts[0], parts[1] || ''].filter(function (x, i) { return i === 0 || x; }).join(':'); }
        }
        return p.scheme + '://' + p.host + p.port + p.path + (q ? '?' + q : '');
    };
    /** is this the App Builder / workspace sign-in instead of an application? */
    FAX.isBuilder = function (u) {
        var p = parse(u); if (!p) return false;
        return /\/ords\/r\/apex\//i.test(p.path) || /(^|&)p=4(000|050|500|550)(:|&|$)/.test(decodeURIComponent(p.query || '')) || /\/ords\/apex(\/|$)/i.test(p.path);
    };
    /** → {ok, why, url, host} — what may be published / opened */
    FAX.check = function (u, hosts) {
        var p = parse(u);
        if (!p) return { ok: false, why: 'Paste the full address of the APEX app (https://…/ords/r/… or …/ords/f?p=…)' };
        if (p.scheme !== 'https') return { ok: false, why: 'The address must start with https://' };
        if (!hostOk(p.host, hosts)) return { ok: false, why: p.host + ' is not an Oracle APEX host (' + FAX.HOST_SUFFIXES.join(', ') + ') — add it to “other hosts” only if your APEX really lives there' };
        if (!/\/ords\//i.test(p.path + '/')) return { ok: false, why: 'This is not an ORDS address (no /ords/ in it)' };
        if (FAX.isBuilder(u)) return { ok: false, why: 'This is the APEX App Builder / workspace sign-in, not your application — run the app in APEX and copy that address' };
        return { ok: true, why: '', url: FAX.normalize(u), host: p.host };
    };
    /** {{USER}} {{POD}} {{DEVICE}} {{APP}} → URL-encoded values (context only, never authentication) */
    FAX.fill = function (u, c) {
        c = c || {};
        var map = { USER: c.user, POD: c.pod, DEVICE: c.device, APP: c.appId };
        return String(u || '').replace(/\{\{\s*(USER|POD|DEVICE|APP)\s*\}\}/g, function (m, k) { return encodeURIComponent(map[k] == null ? '' : String(map[k])); });
    };
    /** the signed launcher (stable key order so the same app always signs the same bytes) */
    FAX.code = function (def) {
        def = def || {};
        var hosts = (def.hosts || []).map(function (h) { return String(h).trim().toLowerCase(); }).filter(Boolean).filter(function (h, i, a) { return a.indexOf(h) === i; });
        return JSON.stringify({ type: 'apex', url: String(def.url || '').trim(), hosts: hosts, toolbar: def.toolbar !== false });
    };
    FAX.read = function (code) {
        try { var j = JSON.parse(String(code || '')); if (j && j.type === 'apex' && j.url) return { url: j.url, hosts: j.hosts || [], toolbar: j.toolbar !== false }; } catch (e) { }
        return null;
    };
    FAX.isApex = function (b) { return !!b && (String(b.kind || '').toUpperCase() === 'APEX' || !!(b.manifestObj && b.manifestObj.kind === 'APEX') || !!FAX.read(b.code)); };
    /** may the WebView go to this address once the app is open? (its own host, the listed hosts, APEX hosts for SSO hops) */
    FAX.mayNavigate = function (target, appUrl, hosts) {
        var t = parse(target), a = parse(appUrl);
        if (!t) return /^(about:|data:|blob:)/i.test(String(target || ''));
        if (t.scheme !== 'https') return false;
        if (a && t.host === a.host) return true;
        return hostOk(t.host, hosts);
    };
    /** a URL from an APEX_APPLICATIONS row: f?p=<id> on the APEX host (works with or without friendly URLs) */
    FAX.urlFromApp = function (base, row) {
        var p = parse(base); if (!p || !row) return '';
        var id = row.APPLICATION_ID || row.application_id, alias = row.ALIAS || row.alias;
        var ords = (/^(.*?\/ords)(\/|$)/i.exec(p.path) || [])[1] || '/ords';
        return 'https://' + p.host + p.port + ords + '/f?p=' + encodeURIComponent(alias || id);
    };
    if (typeof module === 'object' && module.exports) module.exports = FAX;
    root.FAX = FAX;
})(typeof window !== 'undefined' ? window : this);
