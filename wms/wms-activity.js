// ============================================================
// WMS ACTIVITY INTELLIGENCE - client tracker + voice feedback
// ============================================================
// Logs what the user does (task mining) and captures spoken/typed
// feedback (pain areas). Events are buffered locally and pushed to
// the DB in the background through the SAME guarded write endpoint
// the AI bot uses (ai/executewrite), batched into one INSERT ALL.
//
// Include on any module page:
//   <script src="wms-activity.js"></script>
// It auto-starts. It captures ACTIONS and BUSINESS ENTITIES only -
// never keystrokes, passwords, credentials or free-text content.
//
// Public API:
//   WMSActivity.track(type, opts)      log one event
//   WMSActivity.entity(kind, id, opts) log an entity view (trip/order)
//   WMSActivity.flush()                push now
//   WMSActivity.openVoiceFeedback()    open the mic feedback widget
// ============================================================

(function () {
    'use strict';
    if (window.WMSActivity) return;

    var AI_BASE = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';
    var FLUSH_MS = 30 * 60 * 1000;   // 30 minutes
    var MAX_BUFFER = 500;            // or this many events
    var LOCAL_FLUSH = 25;            // mirror to localStorage every N events
    var IDLE_MS = 5 * 60 * 1000;     // gap that counts as idle
    var LS_KEY = 'wms_activity_buffer';

    var buf = [];
    var session = 'S-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    var lastEventAt = Date.now();
    var pageEnteredAt = Date.now();
    var currentPage = null;
    var started = false;

    // ── context helpers ─────────────────────────────────────
    function ctx() {
        return {
            user: (function () { try { return localStorage.getItem('wms_user') || (typeof appUserName === 'function' ? appUserName() : 'UNKNOWN'); } catch (e) { return 'UNKNOWN'; } })(),
            app_ver: (function () { try { return (window.APP_VERSION || document.querySelector('[data-app-version]') && document.querySelector('[data-app-version]').getAttribute('data-app-version')) || '9.0.1'; } catch (e) { return '9.0.1'; } })(),
            instance: (function () { try { return (typeof currentInstance === 'function' ? currentInstance() : (localStorage.getItem('wms_instance') || 'PROD')); } catch (e) { return 'PROD'; } })(),
            module: (function () { var p = location.pathname.toLowerCase(); if (p.indexOf('aianalysis') >= 0) return 'aianalysis'; if (p.indexOf('inventory') >= 0) return 'inventory'; if (p.indexOf('formsdesigner') >= 0) return 'formsdesigner'; return 'wms'; })()
        };
    }
    function nowPage() {
        // active data-page menu item, else the visible section id
        try {
            var mi = document.querySelector('.menu-item.active[data-page], [data-page].active');
            if (mi) return mi.getAttribute('data-page');
            var vis = document.querySelector('.page-section:not([style*="display: none"]), section.active');
            if (vis && vis.id) return vis.id;
        } catch (e) { }
        return currentPage || (location.pathname.split('/').pop() || 'index').replace('.html', '');
    }

    // ── event queue ─────────────────────────────────────────
    function track(type, o) {
        o = o || {};
        var c = ctx();
        var ev = {
            ts: new Date().toISOString(),
            session: session, user: c.user, app_ver: c.app_ver, instance: c.instance,
            module: c.module, page: o.page || nowPage(), type: type,
            target: (o.target || '').toString().slice(0, 200),
            entity_type: o.entity_type || null, entity_id: o.entity_id ? String(o.entity_id).slice(0, 100) : null,
            dur_ms: (o.dur_ms === 0 || o.dur_ms) ? Math.round(o.dur_ms) : null,
            meta: o.meta ? JSON.stringify(o.meta).slice(0, 500) : null
        };
        buf.push(ev);
        lastEventAt = Date.now();
        if (buf.length % LOCAL_FLUSH === 0) mirror();
        if (buf.length >= MAX_BUFFER) flush();
    }
    function entity(kind, id, o) { o = o || {}; o.entity_type = kind; o.entity_id = id; track('entity_view', o); }

    function mirror() { try { localStorage.setItem(LS_KEY, JSON.stringify(buf)); } catch (e) { } }
    function restore() { try { var s = localStorage.getItem(LS_KEY); if (s) { var a = JSON.parse(s); if (a && a.length) buf = a.concat(buf); } } catch (e) { } }

    // ── SQL escaping / batch build ──────────────────────────
    function q(v) { return v === null || v === undefined || v === '' ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'"; }
    function num(v) { return (v === null || v === undefined || v === '') ? 'NULL' : Number(v); }
    var COLS = 'session_id,user_name,app_ver,instance,module,page,event_type,target,entity_type,entity_id,dur_ms,meta,event_ts';
    function rowSql(e) {
        return 'INTO wms_activity_log (' + COLS + ') VALUES (' +
            [q(e.session), q(e.user), q(e.app_ver), q(e.instance), q(e.module), q(e.page),
             q(e.type), q(e.target), q(e.entity_type), q(e.entity_id), num(e.dur_ms), q(e.meta),
             "TO_TIMESTAMP_TZ(" + q(e.ts) + ",'YYYY-MM-DD\"T\"HH24:MI:SS.FF3\"Z\"')"].join(',') + ')';
    }

    var flushing = false;
    function flush() {
        if (flushing || !buf.length) return;
        if (!(window.chrome && window.chrome.webview)) return;   // only inside the app
        flushing = true;
        var batch = buf.slice(0, MAX_BUFFER);
        var sql = 'INSERT ALL ' + batch.map(rowSql).join(' ') + ' SELECT * FROM dual';
        var c = ctx();
        sendMessageToCSharp({
            action: 'executePost', fullUrl: AI_BASE + '/executewrite',
            body: JSON.stringify({ sql: sql, appUser: c.user })
        }, function (err, data) {
            flushing = false;
            var ok = !err;
            try { var r = typeof data === 'string' ? JSON.parse(data) : data; if (r && r.success === false) ok = false; } catch (e) { }
            if (ok) {
                buf = buf.slice(batch.length);
                mirror();
            }
            // on failure the buffer stays; next cycle retries (nothing lost)
        });
    }

    // ── automatic capture (event delegation, no code changes) ─
    function hookNavigation() {
        // menu / data-page clicks
        document.addEventListener('click', function (e) {
            var t = e.target.closest('[data-page]');
            if (t) {
                var to = t.getAttribute('data-page');
                onPageChange(to);
            }
        }, true);
        // wrap showPage() if present
        if (typeof window.showPage === 'function') {
            var orig = window.showPage;
            window.showPage = function (p) { onPageChange(p); return orig.apply(this, arguments); };
        }
    }
    function onPageChange(to) {
        var dwell = Date.now() - pageEnteredAt;
        if (currentPage && dwell > 300) track('nav', { page: currentPage, dur_ms: dwell, meta: { to: to } });
        currentPage = to;
        pageEnteredAt = Date.now();
    }

    function hookClicks() {
        document.addEventListener('click', function (e) {
            var el = e.target.closest('button, .menu-item, a, [role="button"], .btn, i[onclick], [data-track]');
            if (!el) return;
            var label = (el.getAttribute('data-track') || el.id || (el.textContent || '').trim().slice(0, 40) || el.className || 'el');
            var dlg = el.closest('[id*="modal"], [id*="dialog"], .modal');
            // if the element (or a parent) carries an entity marker, log an
            // entity_view too - e.g. data-entity-type="TRIP" data-entity-id="7832"
            var ent = el.closest('[data-entity-type][data-entity-id]');
            if (ent) {
                entity(ent.getAttribute('data-entity-type'), ent.getAttribute('data-entity-id'), { target: label });
                window._wmsFbEntityType = ent.getAttribute('data-entity-type');
                window._wmsFbEntityId = ent.getAttribute('data-entity-id');
            }
            track('click', { target: label, meta: dlg ? { dialog: (dlg.id || 'dialog') } : undefined });
        }, true);
    }

    function hookIdle() {
        setInterval(function () {
            var gap = Date.now() - lastEventAt;
            if (gap >= IDLE_MS && !window._wmsIdle) {
                window._wmsIdle = true;
                track('idle', { dur_ms: gap });
            } else if (gap < IDLE_MS && window._wmsIdle) {
                window._wmsIdle = false;
                track('resume', {});
            }
        }, 60 * 1000);
    }

    // ── lifecycle ───────────────────────────────────────────
    function start() {
        if (started) return; started = true;
        restore();
        track('session_start', { meta: { ua: navigator.userAgent.slice(0, 80) } });
        currentPage = nowPage();
        pageEnteredAt = Date.now();
        hookNavigation(); hookClicks(); hookIdle();
        setInterval(flush, FLUSH_MS);
        // best-effort push on close
        window.addEventListener('beforeunload', function () {
            var dwell = Date.now() - pageEnteredAt;
            if (currentPage && dwell > 300) track('nav', { page: currentPage, dur_ms: dwell });
            track('session_end', {});
            mirror();
            flush();
        });
        // small "logging on" indicator + voice button
        injectWidget();
    }

    // ── UI: activity indicator + push-to-talk feedback ──────
    function injectWidget() {
        if (document.getElementById('wms-act-fab')) return;
        var wrap = document.createElement('div');
        wrap.id = 'wms-act-fab';
        wrap.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:40000;display:flex;flex-direction:column;gap:8px;align-items:flex-end;font-family:Segoe UI,system-ui,sans-serif;';
        wrap.innerHTML =
            '<button id="wms-fb-btn" title="Tell us what is slowing you down (voice or text)" ' +
            'style="width:46px;height:46px;border-radius:50%;border:none;background:linear-gradient(135deg,#0f766e,#134e4a);color:white;font-size:18px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,0.25);">' +
            '<i class="fas fa-microphone"></i></button>' +
            '<div title="Activity logging is on. Actions only - no keystrokes or passwords." ' +
            'style="font-size:8.5px;color:#0f766e;background:rgba(255,255,255,0.85);border:1px solid #d1e7e3;border-radius:10px;padding:1px 7px;font-weight:700;">' +
            '<i class="fas fa-circle" style="font-size:6px;color:#16a34a;"></i> logging</div>';
        document.body.appendChild(wrap);
        document.getElementById('wms-fb-btn').addEventListener('click', openVoiceFeedback);
    }

    var LANGS = [['en-US', 'English'], ['fr-FR', 'French'], ['hi-IN', 'Hindi'], ['ur-PK', 'Urdu'], ['ar-SA', 'Arabic'], ['ta-IN', 'Tamil']];
    function openVoiceFeedback() {
        var old = document.getElementById('wms-fb-modal'); if (old) old.remove();
        var langOpts = LANGS.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === (localStorage.getItem('wms_fb_lang') || 'en-US') ? ' selected' : '') + '>' + l[1] + '</option>'; }).join('');
        var html =
        '<div id="wms-fb-modal" style="position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:41000;display:flex;align-items:center;justify-content:center;font-family:Segoe UI,system-ui,sans-serif;">' +
          '<div style="background:white;width:92%;max-width:460px;border-radius:14px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.35);">' +
            '<div style="padding:0.8rem 1.1rem;background:linear-gradient(135deg,#0f766e,#134e4a);color:white;display:flex;justify-content:space-between;align-items:center;">' +
              '<div style="font-weight:800;font-size:13px;"><i class="fas fa-comment-dots"></i> What is slowing you down?</div>' +
              '<button onclick="document.getElementById(\'wms-fb-modal\').remove()" style="background:none;border:none;color:white;font-size:1.3rem;cursor:pointer;">&times;</button>' +
            '</div>' +
            '<div style="padding:1rem 1.1rem;">' +
              '<div style="font-size:11px;color:#64748b;margin-bottom:8px;">Press the mic and describe the problem in your own language, or type it. It is tagged with the screen you are on now (<b>' + esc(nowPage()) + '</b>).</div>' +
              '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">' +
                '<select id="wms-fb-lang" style="padding:6px 8px;border:1px solid #e2e8f0;border-radius:7px;font-size:12px;">' + langOpts + '</select>' +
                '<button id="wms-fb-mic" style="flex:1;padding:8px;border:none;border-radius:8px;background:#0f766e;color:white;font-weight:700;font-size:12px;cursor:pointer;"><i class="fas fa-microphone"></i> Hold to speak</button>' +
              '</div>' +
              '<textarea id="wms-fb-text" placeholder="Your feedback appears here - you can edit it before sending." style="width:100%;box-sizing:border-box;min-height:88px;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:12.5px;resize:vertical;"></textarea>' +
              '<div id="wms-fb-status" style="font-size:10.5px;color:#0e7490;min-height:15px;margin-top:5px;"></div>' +
            '</div>' +
            '<div style="padding:0.7rem 1.1rem;border-top:1px solid #f1f5f9;display:flex;justify-content:flex-end;gap:8px;">' +
              '<button onclick="document.getElementById(\'wms-fb-modal\').remove()" style="padding:7px 14px;border:1px solid #e2e8f0;border-radius:8px;background:white;font-size:12px;font-weight:600;color:#64748b;cursor:pointer;">Cancel</button>' +
              '<button id="wms-fb-send" style="padding:7px 18px;border:none;border-radius:8px;background:#16a34a;color:white;font-size:12px;font-weight:800;cursor:pointer;"><i class="fas fa-paper-plane"></i> Send</button>' +
            '</div>' +
          '</div>' +
        '</div>';
        document.body.insertAdjacentHTML('beforeend', html);
        wireVoice();
    }

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

    function wireVoice() {
        var micBtn = document.getElementById('wms-fb-mic');
        var taEl = document.getElementById('wms-fb-text');
        var statusEl = document.getElementById('wms-fb-status');
        var langEl = document.getElementById('wms-fb-lang');
        langEl.addEventListener('change', function () { try { localStorage.setItem('wms_fb_lang', langEl.value); } catch (e) { } });

        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            micBtn.disabled = true; micBtn.style.opacity = 0.5;
            statusEl.textContent = 'Voice not available on this machine - please type your feedback.';
        } else {
            var rec = null, listening = false, netRetried = false;
            var ERRMSG = {
                'network': 'Voice needs internet access to the speech service, which appears blocked on this network. Please type your feedback below — it works exactly the same.',
                'not-allowed': 'Microphone is blocked. Allow the mic for this app, or type your feedback below.',
                'service-not-allowed': 'The speech service is not available on this machine. Please type your feedback below.',
                'no-speech': 'Did not catch anything — try again, or type it below.',
                'audio-capture': 'No microphone found. Please type your feedback below.',
                'aborted': ''
            };
            var startRec = function () {
                if (listening) return;
                rec = new SR();
                rec.lang = langEl.value;
                rec.interimResults = true;
                rec.continuous = true;
                var baseText = taEl.value ? taEl.value + ' ' : '';
                rec.onresult = function (ev) {
                    var s = '';
                    for (var i = ev.resultIndex; i < ev.results.length; i++) s += ev.results[i][0].transcript;
                    taEl.value = baseText + s;
                };
                rec.onerror = function (ev) {
                    // Google's speech backend blocked on the network -> one silent retry, then fall back to typing
                    if (ev.error === 'network' && !netRetried) {
                        netRetried = true;
                        statusEl.textContent = 'Reconnecting to the speech service…';
                        setTimeout(function () { try { rec.start(); listening = true; } catch (e) { } }, 700);
                        return;
                    }
                    var msg = ERRMSG[ev.error];
                    if (msg === undefined) msg = 'Voice error (' + ev.error + ') — please type your feedback below.';
                    if (msg) statusEl.innerHTML = '<span style="color:#b45309;">' + msg + '</span>';
                    try { taEl.focus(); } catch (e) { }
                };
                rec.onend = function () { listening = false; micBtn.innerHTML = '<i class="fas fa-microphone"></i> Hold to speak'; micBtn.style.background = '#0f766e'; };
                try { rec.start(); listening = true; micBtn.innerHTML = '<i class="fas fa-stop"></i> Listening…'; micBtn.style.background = '#dc2626'; statusEl.textContent = 'Listening… release to stop.'; } catch (e) { statusEl.textContent = 'Could not start mic: ' + e.message; }
            };
            var stopRec = function () { if (rec && listening) { try { rec.stop(); } catch (e) { } } };
            micBtn.addEventListener('mousedown', startRec);
            micBtn.addEventListener('touchstart', function (e) { e.preventDefault(); startRec(); });
            micBtn.addEventListener('mouseup', stopRec);
            micBtn.addEventListener('mouseleave', stopRec);
            micBtn.addEventListener('touchend', stopRec);
            // click toggles too (some setups don't fire mousedown reliably)
            micBtn.addEventListener('click', function () { if (!listening) startRec(); else stopRec(); });
        }
        document.getElementById('wms-fb-send').addEventListener('click', function () { sendFeedback(taEl.value, langEl.value, statusEl); });
    }

    function sendFeedback(text, lang, statusEl) {
        text = (text || '').trim();
        if (!text) { statusEl.textContent = 'Please say or type something first.'; return; }
        if (!(window.chrome && window.chrome.webview)) { statusEl.textContent = 'Open inside the WMS app to send feedback.'; return; }
        statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…';
        var c = ctx();
        var isEn = /^en/i.test(lang);
        var doInsert = function (textEn, status) {
            var sql = 'INSERT INTO wms_user_feedback (session_id,user_name,app_ver,instance,module,page,entity_type,entity_id,source,lang,text_raw,text_en,trans_status) VALUES (' +
                [q(session), q(c.user), q(c.app_ver), q(c.instance), q(c.module), q(nowPage()),
                 q(window._wmsFbEntityType || null), q(window._wmsFbEntityId || null),
                 q('VOICE'), q(lang), q(text), q(textEn), q(status)].join(',') + ')';
            sendMessageToCSharp({
                action: 'executePost', fullUrl: AI_BASE + '/executewrite',
                body: JSON.stringify({ sql: sql, appUser: c.user })
            }, function (err, data) {
                var ok = !err;
                try { var r = typeof data === 'string' ? JSON.parse(data) : data; if (r && r.success === false) ok = false; } catch (e) { }
                if (ok) {
                    statusEl.innerHTML = '<span style="color:#15803d;">Thank you - your feedback was recorded.</span>';
                    track('action', { target: 'voice-feedback', meta: { lang: lang } });
                    setTimeout(function () { var m = document.getElementById('wms-fb-modal'); if (m) m.remove(); }, 1200);
                } else {
                    statusEl.innerHTML = '<span style="color:#b91c1c;">Could not send: ' + esc(String(err || (r && r.error) || 'error')) + '</span>';
                }
            });
        };
        if (isEn) { doInsert(text, 'SAME'); return; }
        // translate to English if the app exposes a translator (AI module),
        // else store raw and mark for later translation - nothing is lost
        if (typeof window.wmsTranslate === 'function') {
            window.wmsTranslate(text, lang, function (en) {
                if (en && en.trim()) doInsert(en.trim(), 'DONE');
                else doInsert(text, 'RAW');
            });
        } else {
            doInsert(text, 'RAW');
        }
    }

    // Translate non-English feedback via the app's Claude API key (the
    // one configured for the AI engine). No key -> callback(null) and the
    // caller stores the raw text marked for later translation.
    if (typeof window.wmsTranslate !== 'function') {
        window.wmsTranslate = function (text, lang, cb) {
            var key = '';
            try {
                var s = JSON.parse(localStorage.getItem('aiEngineSettings') || 'null');
                if (s && s.mode === 'api' && s.k) key = atob(s.k);
            } catch (e) { }
            if (!key || !(window.chrome && window.chrome.webview)) { cb(null); return; }
            sendMessageToCSharp({ action: 'translateText', text: text, apiKey: key }, function (err, data) {
                if (err) { cb(null); return; }
                var r = data;
                try { r = typeof data === 'string' ? JSON.parse(data) : data; } catch (e) { }
                cb(r && r.success && r.english ? r.english : null);
            });
        };
    }

    window.WMSActivity = {
        track: track, entity: entity, flush: flush,
        openVoiceFeedback: openVoiceFeedback,
        setFeedbackEntity: function (kind, id) { window._wmsFbEntityType = kind; window._wmsFbEntityId = id; }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
