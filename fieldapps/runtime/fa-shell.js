/* Field Apps · runtime shell (fieldapps/runtime/shell.html)
 * Runs ONE signed app bundle in a sealed frame (no network, no same-origin, CSP) and relays the app's calls
 * (FA.query / submit / photo / upload / scan / gps / print / store / toast …) to its HOST:
 *   - the Field Apps desktop page (this frame's parent window) — preview before publishing, or
 *   - the FCPos mobile app (react-native-webview: window.ReactNativeWebView.postMessage up, window.__faDeliver(json) down).
 * Host protocol (both): shell → host {faHost:1, id, op, args, app}; host → shell {faHost:1, id, ok, data | error} and events {faHost:1, event, data}.
 * App protocol (inside the frame, injected SDK `FA`): app → shell {fa:1, id, op, args}; shell → app {fa:1, id, ok, data | error} and events {fa:1, event, data}.
 * Signature: ECDSA P-256 / SHA-256 over "appId.version.sha256(code).sha256(manifest)" with the public keys the host hands over
 * (WMS_FIELD_SETTINGS signing_keys) — a bundle that does not verify never runs unless the host allows drafts (desktop preview). */
(function () {
    'use strict';
    var SH = window.FA_SHELL = { version: '1.0', ctx: null, bundle: null, queue: [] };
    var $ = function (id) { return document.getElementById(id); };
    var qs = (function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var i = p.indexOf('='); if (i > 0) { try { o[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); } catch (e) { } } }); return o; })();
    var appId = qs.app || '';
    var RN = !!window.ReactNativeWebView, PARENT = !RN && window.parent !== window;
    var seq = 0, hostPending = {}, frame = null, appWin = null, ctx = null, bundle = null, appReady = false, flushTimer = null;

    // ── host adapter ──────────────────────────────────────────────
    function hostSend(op, args, ms) {
        return new Promise(function (resolve, reject) {
            var id = 'h' + (++seq);
            hostPending[id] = { resolve: resolve, reject: reject };
            var msg = { faHost: 1, id: id, op: op, args: args || {}, app: appId };
            if (RN) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
            else if (PARENT) window.parent.postMessage(msg, '*');
            else { delete hostPending[id]; reject(new Error('No host — open this app inside the Field Apps page or the mobile app')); return; }
            if (ms) setTimeout(function () { if (hostPending[id]) { delete hostPending[id]; reject(new Error(op + ' timed out')); } }, ms);
        });
    }
    function hostReply(r) {
        if (!r || r.faHost !== 1) return;
        if (r.event) { onHostEvent(r.event, r.data); return; }
        var p = hostPending[r.id]; if (!p) return; delete hostPending[r.id];
        if (r.ok === false) p.reject(new Error(r.error || 'Host error')); else p.resolve(r.data);
    }
    window.__faDeliver = function (json) { try { hostReply(typeof json === 'string' ? JSON.parse(json) : json); } catch (e) { } };
    window.addEventListener('message', function (ev) {
        var d = ev.data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
        if (!d) return;
        if (d.faHost === 1) { if ((PARENT && ev.source === window.parent) || RN) hostReply(d); return; }
        if (d.fa === 1 && appWin && ev.source === appWin) onAppMessage(d);
    });
    document.addEventListener('message', function (ev) { try { var d = JSON.parse(ev.data); if (d && d.faHost === 1) hostReply(d); } catch (e) { } });   // older react-native-webview on Android

    // ── crypto ────────────────────────────────────────────────────
    function b64bytes(b64) { var s = atob(String(b64).replace(/-/g, '+').replace(/_/g, '/')); var a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
    function hex(buf) { var a = new Uint8Array(buf), s = ''; for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16); return s; }
    function sha256(text) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(hex); }
    SH.sha256 = sha256;
    /** → {ok, why, codeSha, manSha}. keys = [{keyId, spki}] */
    SH.verify = function (b, keys) {
        var out = {};
        return Promise.all([sha256(String(b.code || '')), sha256(String(b.manifest || ''))]).then(function (h) {
            out.codeSha = h[0]; out.manSha = h[1];
            if (b.codeSha256 && b.codeSha256.toLowerCase() !== h[0]) { out.ok = false; out.why = 'The code is not the code that was signed'; return out; }
            if (!b.signature || !b.keyId) { out.ok = false; out.why = 'This app is not signed'; return out; }
            var k = (keys || []).filter(function (x) { return x && x.keyId === b.keyId && x.spki; })[0];
            if (!k) { out.ok = false; out.why = 'Signed with a key this device does not know (' + b.keyId + ')'; return out; }
            var payload = new TextEncoder().encode(String(b.appId) + '.' + String(b.version) + '.' + h[0] + '.' + h[1]);
            return crypto.subtle.importKey('spki', b64bytes(k.spki), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
                .then(function (key) { return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64bytes(b.signature), payload); })
                .then(function (ok) { out.ok = !!ok; out.why = ok ? '' : 'The signature does not match'; return out; });
        }).catch(function (e) { out.ok = false; out.why = 'Could not verify: ' + (e && e.message || e); return out; });
    };

    // ── the SDK injected into the app frame ───────────────────────
    function faSdk(ctx0) {
        var FA = window.FA = { ctx: ctx0, version: '1.0' };
        var seq = 0, pend = {}, handlers = {}, readyFns = [], ready = false;
        function call(op, args, ms) {
            return new Promise(function (res, rej) {
                var id = 'a' + (++seq); pend[id] = { res: res, rej: rej };
                parent.postMessage({ fa: 1, id: id, op: op, args: args || {} }, '*');
                if (ms) setTimeout(function () { if (pend[id]) { delete pend[id]; rej(new Error(op + ' timed out')); } }, ms);
            });
        }
        window.addEventListener('message', function (ev) {
            var d = ev.data; if (!d || d.fa !== 1) return;
            if (d.event) { if (d.event === 'ctx') FA.ctx = d.data; (handlers[d.event] || []).forEach(function (f) { try { f(d.data); } catch (e) { } }); return; }
            var p = pend[d.id]; if (!p) return; delete pend[d.id];
            if (d.ok === false) p.rej(new Error(d.error || 'failed')); else p.res(d.data);
        });
        FA.ready = function (fn) { if (ready) fn(FA.ctx); else readyFns.push(fn); };
        FA.query = function (name, params) { return call('query', { name: name, params: params || {} }, 300000); };
        FA.submit = function (kind, doc, o) { o = o || {}; return call('submit', { kind: kind, doc: doc, subId: o.subId || (doc && (doc.subId || doc.saleId || doc.shiftId)) || ('sub_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)), ref: o.ref, amount: o.amount }, 120000); };
        FA.photo = function (o) { return call('photo', o || {}, 0); };
        FA.upload = function (photo, meta) { return call('upload', { photo: photo, meta: meta || {} }, 300000); };
        FA.scan = function (o) { return call('scan', o || {}, 0); };
        FA.gps = function () { return call('gps', {}, 60000); };
        FA.print = function (doc) { return call('print', typeof doc === 'string' ? { text: doc } : (doc || {}), 0); };
        FA.store = { get: function (k) { return call('store', { op: 'get', key: k }); }, set: function (k, v) { return call('store', { op: 'set', key: k, value: v }); }, del: function (k) { return call('store', { op: 'del', key: k }); }, keys: function () { return call('store', { op: 'keys' }); } };
        FA.toast = function (m, kind) { call('toast', { msg: String(m), kind: kind || '' }); };
        FA.close = function () { call('close', {}); };
        FA.open = function (id) { return call('open', { appId: id }); };
        FA.log = function () { call('log', { m: [].map.call(arguments, function (x) { try { return typeof x === 'object' ? JSON.stringify(x) : String(x); } catch (e) { return String(x); } }).join(' ') }); };
        FA.on = function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return FA; };
        FA.off = function (ev, fn) { handlers[ev] = (handlers[ev] || []).filter(function (f) { return f !== fn; }); };
        window.addEventListener('error', function (e) { call('log', { m: 'error: ' + e.message + (e.lineno ? ' (line ' + e.lineno + ')' : ''), level: 'error' }); });
        var mem = function () { var d = {}; return { getItem: function (k) { return k in d ? d[k] : null; }, setItem: function (k, v) { d[k] = String(v); }, removeItem: function (k) { delete d[k]; }, clear: function () { d = {}; }, key: function (i) { return Object.keys(d)[i] || null; }, get length() { return Object.keys(d).length; } }; };
        ['localStorage', 'sessionStorage'].forEach(function (n) { try { window[n].length; } catch (e) { try { Object.defineProperty(window, n, { value: mem(), configurable: true }); } catch (x) { } } });
        function fire() { if (ready) return; ready = true; readyFns.splice(0).forEach(function (f) { try { f(FA.ctx); } catch (e) { FA.log('ready handler: ' + (e && e.message)); } }); }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fire); else setTimeout(fire, 0);
        call('ready', {});
    }
    SH.CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'";
    function ctxForApp() {
        var m = bundle && bundle.manifestObj || {};
        return { appId: bundle ? bundle.appId : appId, name: bundle && bundle.name, version: bundle && bundle.version, user: ctx.user, device: ctx.device, pod: ctx.pod, platform: ctx.platform,
            online: ctx.online !== false, params: ctx.params || {}, settings: Object.assign({}, m.settings || {}, ctx.settings || {}), manifest: m, shell: SH.version, signed: !!(bundle && bundle.signedOk), caps: ctx.caps || {} };
    }
    SH.appDoc = function (b, c) {
        var inject = '<meta http-equiv="Content-Security-Policy" content="' + SH.CSP + '"><script>(' + faSdk.toString() + ')(' + JSON.stringify(c).replace(/</g, '\\u003c') + ');<\/script>';
        var code = String(b.code || '').replace(/^\s*<!doctype[^>]*>/i, '');
        if (/<head[^>]*>/i.test(code)) return '<!doctype html>' + code.replace(/<head([^>]*)>/i, function (m, a) { return '<head' + a + '>' + inject; });
        if (/<html[^>]*>/i.test(code)) return '<!doctype html>' + code.replace(/<html([^>]*)>/i, function (m, a) { return '<html' + a + '><head><meta charset="utf-8">' + inject + '</head>'; });
        return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + inject + '</head><body>' + code + '</body></html>';
    };

    // ── app messages ──────────────────────────────────────────────
    function reply(d, ok, data, error) { if (appWin) appWin.postMessage({ fa: 1, id: d.id, ok: ok, data: data === undefined ? null : data, error: error || '' }, '*'); }
    function relay(d, op, args, ms) { hostSend(op, args, ms).then(function (r) { reply(d, true, r); }, function (e) { reply(d, false, null, e && e.message || String(e)); }); }
    function onAppMessage(d) {
        var a = d.args || {};
        switch (d.op) {
            case 'ready': appReady = true; reply(d, true, ctxForApp()); sendEvent('ctx', ctxForApp()); hideOverlay(); hostSend('appReady', {}); break;
            case 'query': relay(d, 'query', { app: appId, name: a.name, params: a.params || {} }, 300000); break;
            case 'submit': submit(a).then(function (r) { reply(d, true, r); }, function (e) { reply(d, false, null, e.message); }); break;
            case 'upload': upload(a).then(function (r) { reply(d, true, r); }, function (e) { reply(d, false, null, e.message); }); break;
            case 'photo': case 'scan': case 'gps': case 'print': case 'open': relay(d, d.op, Object.assign({ app: appId }, a), 0); break;
            case 'store': try { reply(d, true, store(a)); } catch (e) { reply(d, false, null, e.message); } break;
            case 'toast': toast(a.msg, a.kind); reply(d, true, true); break;
            case 'close': hostSend('close', {}); reply(d, true, true); break;
            case 'log': try { (a.level === 'error' ? console.error : console.log)('[' + appId + '] ' + a.m); } catch (e) { } hostSend('log', a).catch(function () { }); reply(d, true, true); break;
            default: reply(d, false, null, 'Unknown op ' + d.op);
        }
    }
    function sendEvent(ev, data) { if (appWin) appWin.postMessage({ fa: 1, event: ev, data: data }, '*'); }
    function onHostEvent(ev, data) {
        if (ev === 'online') { ctx.online = !!(data && data.online); paintChip(); if (ctx.online) flush(); sendEvent('ctx', ctxForApp()); }
        if (ev === 'ctx') { ctx = Object.assign(ctx || {}, data || {}); sendEvent('ctx', ctxForApp()); return; }
        sendEvent(ev, data);
    }

    // ── store (this device, per app) ──────────────────────────────
    var memStore = {};
    function skey(k) { return 'fa.s.' + appId + '.' + k; }
    function store(a) {
        var k = skey(a.key);
        if (a.op === 'get') { var v = null; try { v = localStorage.getItem(k); } catch (e) { } if (v == null && k in memStore) v = memStore[k]; if (v == null) return null; try { return JSON.parse(v); } catch (e) { return v; } }
        if (a.op === 'set') { var s = JSON.stringify(a.value === undefined ? null : a.value); try { localStorage.setItem(k, s); delete memStore[k]; } catch (e) { memStore[k] = s; } return true; }
        if (a.op === 'del') { try { localStorage.removeItem(k); } catch (e) { } delete memStore[k]; return true; }
        if (a.op === 'keys') { var out = [], p = skey(''); try { for (var i = 0; i < localStorage.length; i++) { var n = localStorage.key(i); if (n && n.indexOf(p) === 0) out.push(n.slice(p.length)); } } catch (e) { } Object.keys(memStore).forEach(function (n) { if (n.indexOf(p) === 0 && out.indexOf(n.slice(p.length)) < 0) out.push(n.slice(p.length)); }); return out; }
        throw new Error('store op?');
    }

    // ── submissions with an offline queue ─────────────────────────
    function qkey() { return 'fa.q.' + appId; }
    function loadQueue() { try { SH.queue = JSON.parse(localStorage.getItem(qkey()) || '[]') || []; } catch (e) { SH.queue = []; } }
    function saveQueue() { try { localStorage.setItem(qkey(), JSON.stringify(SH.queue)); } catch (e) { } paintChip(); }
    function offlineError(e) { var m = String(e && e.message || e).toLowerCase(); return ctx.online === false || /network|offline|timed out|failed to fetch|econn|unreachable|502|503|504/.test(m); }
    function submit(a) {
        var item = { kind: 'submit', args: { app: appId, subId: a.subId, kind: a.kind, ref: a.ref, amount: a.amount, doc: a.doc }, at: Date.now() };
        return hostSend('submit', item.args, 120000).then(function (r) { return Object.assign({ ok: true, queued: false, subId: a.subId }, r || {}); }).catch(function (e) {
            if (!offlineError(e)) throw e;
            SH.queue.push(item); saveQueue(); toast('Saved on this device — sent when back online', 'warn');
            return { ok: true, queued: true, subId: a.subId };
        });
    }
    function upload(a) {
        var item = { kind: 'upload', args: { app: appId, photo: a.photo, meta: a.meta }, at: Date.now() };
        return hostSend('upload', item.args, 300000).then(function (r) { return Object.assign({ ok: true, queued: false }, r || {}); }).catch(function (e) {
            if (!offlineError(e)) throw e;
            SH.queue.push(item); saveQueue(); toast('Photo kept on this device — sent when back online', 'warn');
            return { ok: true, queued: true, photoId: a.meta && a.meta.id };
        });
    }
    var flushing = false;
    function flush() {
        if (flushing || !SH.queue.length || ctx.online === false) return;
        flushing = true;
        var item = SH.queue[0];
        hostSend(item.kind, item.args, 120000).then(function () { SH.queue.shift(); saveQueue(); flushing = false; if (SH.queue.length) flush(); else toast('Everything sent', 'ok'); })
            .catch(function () { flushing = false; });
    }
    SH.flush = flush;

    // ── UI ────────────────────────────────────────────────────────
    function overlay(msg, sub, retry) { var ov = $('fa-ov'); if (!ov) return; ov.hidden = false; $('fa-msg').textContent = msg || ''; $('fa-sub').textContent = sub || ''; $('fa-retry').hidden = !retry; $('fa-spin').hidden = !!retry; }
    function hideOverlay() { var ov = $('fa-ov'); if (ov) ov.hidden = true; }
    var toastTimer = null;
    function toast(msg, kind) { var t = $('fa-toast'); if (!t) return; t.textContent = msg; t.className = 'fa-toast ' + (kind || ''); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, kind === 'warn' ? 4000 : 2200); }
    function paintChip() {
        var c = $('fa-chip'); if (!c) return;
        var parts = [];
        if (ctx && ctx.online === false) parts.push('offline');
        if (SH.queue.length) parts.push(SH.queue.length + ' to send');
        if (bundle && !bundle.signedOk) parts.push('draft · not signed');
        c.hidden = !parts.length; c.textContent = parts.join(' · ');
        c.className = 'fa-chip' + (ctx && ctx.online === false ? ' off' : '') + (bundle && !bundle.signedOk ? ' draft' : '');
    }
    SH.toast = toast;

    // ── boot ──────────────────────────────────────────────────────
    function boot() {
        overlay('Starting…', appId ? 'app ' + appId : '');
        appReady = false; bundle = null;
        hostSend('hello', { app: appId, shell: SH.version }, 60000).then(function (c) {
            ctx = c || {}; SH.ctx = ctx;
            if (ctx.appId) appId = ctx.appId;
            if (!appId) throw new Error('No app to open');
            loadQueue();
            overlay('Loading ' + appId + '…', ctx.user ? 'for ' + ctx.user : '');
            return hostSend('bundle', { app: appId }, 120000);
        }).then(function (b) {
            if (!b || !b.code) throw new Error('The app has no code');
            bundle = b; SH.bundle = b;
            try { b.manifestObj = typeof b.manifest === 'string' ? JSON.parse(b.manifest || '{}') : (b.manifest || {}); } catch (e) { b.manifestObj = {}; }
            if (b.manifestObj && typeof b.manifest !== 'string') b.manifest = JSON.stringify(b.manifest || {});
            return SH.verify(b, ctx.keys || []).then(function (v) {
                b.signedOk = !!v.ok; b.verify = v;
                if (!v.ok && !ctx.allowUnsigned) throw new Error('This app cannot run: ' + v.why);
                if (!v.ok) { toast('Draft — ' + v.why, 'warn'); hostSend('log', { m: 'NOT VERIFIED — ' + v.why + ' (' + String(b.code).length.toLocaleString() + ' characters read, SHA-256 ' + String(v.codeSha || '').slice(0, 12) + '…' + (b.codeSha256 ? ', signed ' + String(b.codeSha256).slice(0, 12) + '…' : '') + '); the phones refuse it, this preview runs it as a draft', level: 'error' }).catch(function () { }); }
                else hostSend('log', { m: 'verified · ' + String(b.code).length.toLocaleString() + ' characters · SHA-256 ' + String(v.codeSha || '').slice(0, 12) + '… · key ' + b.keyId }).catch(function () { });
                if (b.expiresAt && new Date(b.expiresAt.replace(' ', 'T')) < new Date() && !ctx.allowUnsigned) throw new Error('This app expired on ' + b.expiresAt.slice(0, 16).replace('T', ' '));
                paintChip();
                mount();
            });
        }).catch(function (e) { overlay('Cannot start', e && e.message || String(e), true); hostSend('appError', { error: e && e.message || String(e) }).catch(function () { }); });
    }
    function mount() {
        var host = $('fa-root');
        if (frame) { try { host.removeChild(frame); } catch (e) { } }
        frame = document.createElement('iframe');
        frame.id = 'fa-frame'; frame.className = 'fa-frame';
        frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.setAttribute('allow', 'camera; microphone; geolocation');
        frame.title = bundle.name || appId;
        host.insertBefore(frame, host.firstChild);
        var docHtml = SH.appDoc(bundle, ctxForApp());
        frame.srcdoc = docHtml;
        appWin = frame.contentWindow;
        var loads = 0;
        frame.addEventListener('load', function () { loads++; if (loads > 1) { frame.srcdoc = '<p style="font-family:sans-serif;padding:20px">This app tried to navigate away and was stopped.</p>'; } });
        setTimeout(function () { if (!appReady) hideOverlay(); }, 4000);   // an app that never calls the SDK still shows
        if (flushTimer) clearInterval(flushTimer);
        flushTimer = setInterval(flush, 30000);
        setTimeout(flush, 1500);
    }
    SH.reload = boot;
    document.addEventListener('DOMContentLoaded', function () {
        var r = $('fa-retry'); if (r) r.addEventListener('click', boot);
        window.addEventListener('online', function () { if (ctx) { ctx.online = true; paintChip(); flush(); sendEvent('ctx', ctxForApp()); } });
        window.addEventListener('offline', function () { if (ctx) { ctx.online = false; paintChip(); sendEvent('ctx', ctxForApp()); } });
        boot();
    });
})();
