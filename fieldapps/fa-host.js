/* Field Apps · desktop host adapter for the runtime shell (window.FAH).
 * The Preview tab shows runtime/shell.html in a phone frame; this file answers the shell's {faHost:1} messages exactly
 * like the FCPos mobile app will — hello / bundle / query / submit / upload / photo / scan / gps / print / log —
 * using the APEX gateway and the host (see fa-store.js). The page passes the callbacks in opts. */
(function (root) {
    'use strict';
    var FAH = root.FAH = {};
    var cur = null;
    FAH.attach = function (frame, opts) { cur = { frame: frame, opts: opts || {} }; return cur; };
    FAH.detach = function () { cur = null; };
    FAH.current = function () { return cur; };
    /** Push an event into the running app (barcode {code}, online {online}, back, resume, ctx). */
    FAH.send = function (event, data) { if (cur && cur.frame && cur.frame.contentWindow) cur.frame.contentWindow.postMessage({ faHost: 1, event: event, data: data === undefined ? null : data }, '*'); };
    window.addEventListener('message', function (ev) {
        var d = ev.data;
        if (!d || d.faHost !== 1 || !cur || !cur.frame || ev.source !== cur.frame.contentWindow) return;
        var src = ev.source;
        function reply(ok, data, error) { try { src.postMessage({ faHost: 1, id: d.id, ok: ok, data: data === undefined ? null : data, error: error || '' }, '*'); } catch (e) { } }
        Promise.resolve().then(function () { return handle(d.op, d.args || {}, cur.opts); }).then(function (r) { reply(true, r); }, function (e) { reply(false, null, e && e.message || String(e)); });
    });
    function handle(op, a, o) {
        switch (op) {
            case 'hello': return { user: o.user(), device: o.device(), pod: o.pod(), platform: 'desktop', keys: o.keys(), online: o.online(), allowUnsigned: !!o.allowUnsigned(), params: o.params ? o.params() : {}, settings: o.settings ? o.settings() : {}, appId: o.appId() };
            case 'bundle': return o.bundle();
            case 'query': if (!o.online()) throw new Error('offline (simulated)'); return o.query(a.name, a.params || {});
            case 'submit': if (!o.online()) throw new Error('offline (simulated)'); return o.submit(a);
            case 'upload': if (!o.online()) throw new Error('offline (simulated)'); return o.upload(a);
            case 'photo': return o.photo(a);
            case 'scan': return o.scan(a);
            case 'gps': return gps();
            case 'print': return o.print(a);
            case 'open': return o.open ? o.open(a.appId) : null;
            case 'close': return o.close ? o.close() : null;
            case 'log': if (o.log) o.log(a); return true;
            case 'appReady': if (o.ready) o.ready(); return true;
            case 'appError': if (o.error) o.error(a.error); return true;
            default: throw new Error('Unknown op ' + op);
        }
    }
    function gps() {
        return new Promise(function (resolve) {
            if (!navigator.geolocation) { resolve(null); return; }
            navigator.geolocation.getCurrentPosition(function (p) { resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); }, function () { resolve(null); }, { timeout: 8000, maximumAge: 60000 });
        });
    }
})(typeof window !== 'undefined' ? window : this);
