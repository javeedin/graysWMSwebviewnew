// ═══════════════════════════════════════════════════════════════════════════════
// WMS ↔ MOBILE BRIDGE — runs inside the FCPos picker app's web build (mobile/index.html, loaded before the app bundle;
// copied there by tools/mobile/build-mobile.js). When the page is shown inside the Gray's WMS desktop (the "Picker app"
// page, wms/picker-app.js) every call the app makes to Oracle APEX (*.oraclecloudapps.com) or Oracle Fusion
// (*.oraclecloud.com) is handed to the WMS page with window.parent.postMessage and answered through the desktop host's
// own relay (executeGet / executePost / executeOracleFusionGet / Post / Patch) — the browser never calls Oracle itself,
// so there is no CORS problem and the Fusion credentials stay in C#. "View only" (the panel's switch) blocks the calls
// that change data and tells the WMS page which ones. Opened on its own (no parent, or a parent that never answers
// "hello") the app calls Oracle directly as it always did.
// Inside a WMS frame the app also gets its OWN storage: window.localStorage (what AsyncStorage uses on web) is replaced
// by an in-memory store, so several frames — one per picker — never share a login or cache. The WMS page may seed that
// store through the page address: #wms=<base64url JSON {storage: {key: value…}, viewOnly, label}> — e.g. the picker's
// `userData` and `app_instance`, which signs the app in as that picker without the login screen.
// Messages: → parent  {type:'wms-mobile-hello', build, label}  {type:'wms-mobile-relay', id, method, url, headers, body, instance}  {type:'wms-mobile-blocked', method, url}
//           ← parent  {type:'wms-mobile-ready', viewOnly}  {type:'wms-mobile-mode', viewOnly}  {type:'wms-mobile-reply', id, ok, status, body, contentType}
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    var ORACLE = /^https:\/\/[^/]*\.oraclecloud(?:apps)?\.com\//i;
    var FUSION = /^https:\/\/[^/]*\.oraclecloud\.com\//i;        // not oraclecloudapps (APEX)
    var WRITE_PATH = /(confirm|update|process|cancel|create|cration|close|insert|delete|submit|save|callpickwave|backorder|requisition|pending_picking|assign|release|print|sync)/i;
    var READ_PATH = /(getopenpicks|getlots|fetchfusionorderlines|get[a-z_]*details|getshipmentnumber|query|search|summary|onhand|lov|list)/i;
    var inFrame = false; try { inFrame = !!(window.parent && window.parent !== window); } catch (e) { inFrame = false; }
    var B = { relay: false, viewOnly: true, seq: 0, pending: {}, hello: 0, label: '' };

    // ── the frame's own storage, seeded from #wms=… ──
    var seed = null;
    try {
        var m = /[#&]wms=([A-Za-z0-9_-]+)/.exec(location.hash || '');
        if (m) seed = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
    } catch (e) { seed = null; }
    if (inFrame) {
        var mem = {};
        var store = {
            getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
            setItem: function (k, v) { mem[String(k)] = String(v); },
            removeItem: function (k) { delete mem[k]; },
            clear: function () { mem = {}; },
            key: function (i) { return Object.keys(mem)[i] || null; },
            get length() { return Object.keys(mem).length; }
        };
        if (seed && seed.storage && typeof seed.storage === 'object') Object.keys(seed.storage).forEach(function (k) { var v = seed.storage[k]; if (v != null) store.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); });
        try { Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { return store; } }); } catch (e) { /* keep the real one */ }
        if (seed && typeof seed.viewOnly === 'boolean') B.viewOnly = seed.viewOnly;
        if (seed && seed.label) B.label = String(seed.label);
    }

    function post(msg) { try { window.parent.postMessage(msg, '*'); } catch (e) { /* no parent */ } }
    function instance() { try { return (localStorage.getItem('app_instance') || 'TEST').toUpperCase(); } catch (e) { return 'TEST'; } }
    /** A call that changes data: PUT / PATCH / DELETE always, every Fusion POST, and APEX POSTs whose path says so. */
    function isWrite(method, url) {
        method = String(method || 'GET').toUpperCase();
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
        if (method !== 'POST') return true;
        var path = String(url).replace(/[?#].*$/, '');
        if (FUSION.test(path)) return true;
        return WRITE_PATH.test(path) && !READ_PATH.test(path);
    }
    function headersOf(h) {
        var out = {}; if (!h) return out;
        try { if (typeof h.forEach === 'function' && !Array.isArray(h)) { h.forEach(function (v, k) { out[k] = v; }); return out; } } catch (e) { /* plain object */ }
        if (Array.isArray(h)) { h.forEach(function (p) { out[p[0]] = p[1]; }); return out; }
        Object.keys(h).forEach(function (k) { out[k] = h[k]; }); return out;
    }
    function bodyText(b) { if (b == null) return null; if (typeof b === 'string') return b; try { return JSON.stringify(b); } catch (e) { return String(b); } }
    function relay(method, url, headers, body) {
        return new Promise(function (resolve) {
            var id = ++B.seq, done = false;
            B.pending[id] = function (r) { if (done) return; done = true; resolve(r); };
            post({ type: 'wms-mobile-relay', id: id, method: method, url: url, headers: headersOf(headers), body: bodyText(body), instance: instance() });
            setTimeout(function () { if (!done) { done = true; delete B.pending[id]; resolve({ ok: false, status: 504, body: JSON.stringify({ success: false, error: 'The WMS desktop did not answer in time.' }) }); } }, 180000);
        });
    }
    function blocked(method, url) {
        post({ type: 'wms-mobile-blocked', method: method, url: url });
        var text = 'View only is on in the WMS desktop. Switch it off in the Picker app panel to make changes.';
        return { ok: false, status: 403, body: JSON.stringify({ success: false, status: 'BLOCKED', error: text, message: text }) };
    }
    /** null = not ours (the browser calls it), else a promise of {ok, status, body, contentType}. */
    function handle(method, url, headers, body) {
        if (!B.relay || !ORACLE.test(String(url))) return null;
        method = String(method || 'GET').toUpperCase();
        if (B.viewOnly && isWrite(method, url)) return Promise.resolve(blocked(method, url));
        return relay(method, url, headers, body);
    }
    if (inFrame) {
        window.addEventListener('message', function (e) {
            var m = e.data; if (!m || typeof m !== 'object') return;
            if (m.type === 'wms-mobile-ready') { B.relay = true; B.viewOnly = !!m.viewOnly; }
            else if (m.type === 'wms-mobile-mode') { B.viewOnly = !!m.viewOnly; }
            else if (m.type === 'wms-mobile-reply') { var p = B.pending[m.id]; if (p) { delete B.pending[m.id]; p(m); } }
        });
        var hello = function () { if (B.relay || B.hello > 20) return; B.hello++; post({ type: 'wms-mobile-hello', build: window.WMS_MOBILE_BUILD || null, label: B.label, href: location.href.replace(/#.*$/, '') }); setTimeout(hello, 500); };
        hello();
    }
    // ── fetch ──
    var realFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
    window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var method = (init && init.method) || (input && input.method) || 'GET';
        var p = handle(method, url, (init && init.headers) || (input && input.headers), init && init.body);
        if (!p) return realFetch ? realFetch(input, init) : Promise.reject(new Error('fetch unavailable'));
        return p.then(function (r) { return new Response(r.body == null ? '' : String(r.body), { status: r.status || 200, statusText: r.ok ? 'OK' : 'Error', headers: { 'Content-Type': r.contentType || 'application/json' } }); });
    };
    // ── XMLHttpRequest (axios on web) ──
    var RealXHR = window.XMLHttpRequest;
    function BridgedXHR() {
        this.readyState = 0; this.status = 0; this.statusText = ''; this.responseText = ''; this.response = ''; this.responseURL = ''; this.responseType = ''; this.timeout = 0; this.withCredentials = false;
        this.upload = { addEventListener: function () {}, removeEventListener: function () {} }; this._headers = {}; this._listeners = {}; this._real = null; this._ours = false;
    }
    BridgedXHR.prototype.open = function (method, url) {
        this._method = String(method || 'GET').toUpperCase(); this._url = String(url);
        this._ours = !!(B.relay && ORACLE.test(this._url));
        if (!this._ours) { this._real = new RealXHR(); this._real.open(method, url, true); }
        this.readyState = 1; this._fire('readystatechange');
    };
    BridgedXHR.prototype.setRequestHeader = function (k, v) { this._headers[k] = v; if (this._real) this._real.setRequestHeader(k, v); };
    BridgedXHR.prototype.getAllResponseHeaders = function () { return this._real ? this._real.getAllResponseHeaders() : 'content-type: ' + (this._ct || 'application/json') + '\r\n'; };
    BridgedXHR.prototype.getResponseHeader = function (k) { return this._real ? this._real.getResponseHeader(k) : (/content-type/i.test(k) ? (this._ct || 'application/json') : null); };
    BridgedXHR.prototype.addEventListener = function (t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); };
    BridgedXHR.prototype.removeEventListener = function (t, fn) { this._listeners[t] = (this._listeners[t] || []).filter(function (f) { return f !== fn; }); };
    BridgedXHR.prototype._fire = function (t) {
        var ev = { type: t, target: this, currentTarget: this, lengthComputable: false, loaded: 0, total: 0 }, h = this['on' + t];
        if (typeof h === 'function') { try { h.call(this, ev); } catch (e) { console.error(e); } }
        (this._listeners[t] || []).forEach(function (fn) { try { fn.call(this, ev); } catch (e) { console.error(e); } }, this);
    };
    BridgedXHR.prototype.abort = function () { if (this._real) this._real.abort(); this.readyState = 0; this._fire('abort'); this._fire('loadend'); };
    BridgedXHR.prototype.send = function (body) {
        var self = this;
        if (!this._ours) {
            var r = this._real; r.responseType = this.responseType; r.timeout = this.timeout; r.withCredentials = this.withCredentials;
            var sync = function () { self.readyState = r.readyState; self.status = r.status; self.statusText = r.statusText; self.responseURL = r.responseURL; try { self.response = r.response; if (!r.responseType || r.responseType === 'text') self.responseText = r.responseText; } catch (e) { /* not readable yet */ } };
            r.onreadystatechange = function () { sync(); self._fire('readystatechange'); };
            r.onload = function () { sync(); self._fire('load'); }; r.onerror = function () { sync(); self._fire('error'); }; r.ontimeout = function () { sync(); self._fire('timeout'); }; r.onabort = function () { sync(); self._fire('abort'); }; r.onloadend = function () { sync(); self._fire('loadend'); };
            r.send(body); return;
        }
        handle(this._method, this._url, this._headers, body).then(function (res) {
            var text = res.body == null ? '' : String(res.body);
            self._ct = res.contentType || 'application/json';
            self.readyState = 4; self.status = res.status || (res.ok ? 200 : 500); self.statusText = res.ok ? 'OK' : 'Error'; self.responseURL = self._url; self.responseText = text;
            if (self.responseType === 'json') { try { self.response = JSON.parse(text); } catch (e) { self.response = null; } } else self.response = text;
            self._fire('readystatechange'); self._fire('load'); self._fire('loadend');
        });
    };
    BridgedXHR.UNSENT = 0; BridgedXHR.OPENED = 1; BridgedXHR.HEADERS_RECEIVED = 2; BridgedXHR.LOADING = 3; BridgedXHR.DONE = 4;
    window.XMLHttpRequest = BridgedXHR;
    window.WMS_MOBILE_BRIDGE = { state: function () { return { inFrame: inFrame, relay: B.relay, viewOnly: B.viewOnly, label: B.label, seeded: !!seed, pending: Object.keys(B.pending).length }; }, isWrite: isWrite };
})();
