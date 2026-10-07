/* AI Digital Employee — Dictate: speech to text on this PC through Microsoft Foundry Local (Whisper), typed into the prompt.
   The same feature as the AI Agent's dictation button (aiagent/dictate.js), self-contained for this page: click the
   microphone button beside the paperclip (or Ctrl+Shift+D), speak, click again. The recording (16 kHz WAV) goes through
   the host's AI Hub relay (hubApi → POST /voice/stt, provider "foundry"); the AI Hub runs Whisper inside its own process
   on this PC - no cloud, no key, no cost - and the words land in the prompt box at the cursor. Nothing is sent to the
   assistant until you press Send. The first use offers a one-click setup (POST /voice/foundry/install: the
   foundry-local-sdk package + the Whisper model, downloaded once); the recording that met the missing setup is kept and
   transcribed as soon as the setup is done. Needs the AI Hub installed and running on this PC (AI Hub page). */
(function () {
    'use strict';
    var DICT = window.DICT = { state: 'idle', frames: [], stream: null, ctx: null, node: null, since: 0, timer: null, level: 0, peak: 0, pending: null, MAX_SECS: 120 };
    var $ = function (id) { return document.getElementById(id); };
    var escp = function (s) { return typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

    /** The AI Hub through the host relay (the page never holds the hub token). Resolves with the hub's JSON answer. */
    DICT.hub = function (method, path, body) {
        return new Promise(function (resolve, reject) {
            if (!(window.chrome && window.chrome.webview)) { reject('Open this page inside the Gray\'s WMS app.'); return; }
            var done = false, t = setTimeout(function () { if (!done) { done = true; reject('The app did not answer in time.'); } }, 900000);
            sendMessageToCSharp({ action: 'hubApi', method: method, path: path, body: body || {}, appUser: appUserName() }, function (err, r) {
                if (done) return; done = true; clearTimeout(t);
                if (err) { reject(err); return; }
                var d = r && r.data !== undefined ? r.data : r;
                if (!d || d.ok === false) { var e = (d && d.error) || 'AI Hub error'; if (d && d.offline) e = 'HUB_OFFLINE:' + e; reject(e); return; }
                resolve(d.result);
            });
        });
    };

    DICT.toggle = function () {
        if (DICT.state === 'rec') { DICT.finish(); return; }
        if (DICT.state === 'busy') return;
        DICT.start();
    };

    DICT.start = function () {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { DICT.say('This window has no microphone access.', 'err', 6000); return; }
        DICT.setState('busy', '<i class="fas fa-circle-notch fa-spin"></i> Opening the microphone…');
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (stream) {
            var AC = window.AudioContext || window.webkitAudioContext;
            DICT.stream = stream; DICT.ctx = new AC();
            var src = DICT.ctx.createMediaStreamSource(stream);
            DICT.node = DICT.ctx.createScriptProcessor(4096, 1, 1);
            DICT.frames = []; DICT.level = 0; DICT.peak = 0;
            DICT.node.onaudioprocess = DICT.onAudio;
            src.connect(DICT.node); DICT.node.connect(DICT.ctx.destination);
            DICT.since = Date.now();
            DICT.setState('rec');
            DICT.tick(); DICT.timer = setInterval(DICT.tick, 250);
        }).catch(function (e) { DICT.setState('idle'); DICT.say('Microphone: ' + (e && e.message ? e.message : e), 'err', 8000); });
    };

    DICT.onAudio = function (ev) {
        if (DICT.state !== 'rec') return;
        var x = ev.inputBuffer.getChannelData(0), sum = 0;
        for (var i = 0; i < x.length; i++) sum += x[i] * x[i];
        var rms = Math.sqrt(sum / x.length);
        DICT.level = DICT.level * 0.6 + rms * 0.4; DICT.peak = Math.max(DICT.peak, rms);
        DICT.frames.push(new Float32Array(x));
        var btn = $('btn-dictate'); if (btn) btn.style.setProperty('--lvl', Math.min(1, DICT.level * 12).toFixed(3));
    };

    DICT.tick = function () {
        var secs = (Date.now() - DICT.since) / 1000;
        if (secs >= DICT.MAX_SECS) { DICT.finish(); return; }
        var m = Math.floor(secs / 60), s = Math.floor(secs % 60);
        DICT.meta('<i class="fas fa-circle rec-dot"></i> Dictating… ' + m + ':' + (s < 10 ? '0' : '') + s +
            ' — click the microphone again to put the words in the prompt' + (secs > 6 && DICT.peak < 0.002 ? ' · <b>your microphone sends no sound</b>' : ''), 0, 'rec');
    };

    DICT.release = function () {
        clearInterval(DICT.timer); DICT.timer = null;
        try { if (DICT.node) { DICT.node.disconnect(); DICT.node.onaudioprocess = null; } } catch (e) { /* ok */ }
        try { if (DICT.ctx) DICT.ctx.close(); } catch (e) { /* ok */ }
        if (DICT.stream) DICT.stream.getTracks().forEach(function (t) { t.stop(); });
        DICT.node = null; DICT.ctx = null; DICT.stream = null;
    };

    DICT.finish = function () {
        var frames = DICT.frames, rate = DICT.ctx ? DICT.ctx.sampleRate : 48000;
        DICT.frames = [];
        DICT.release();
        var secs = frames.reduce(function (n, f) { return n + f.length; }, 0) / rate;
        if (secs < 0.4) { DICT.setState('idle'); DICT.say('Nothing recorded — click, speak, then click again.', '', 5000); return; }
        DICT.transcribe(DICT.wav(frames, rate, 16000), null);
    };

    /** Float32 frames at `rate` → mono 16-bit PCM WAV at `out` Hz, base64. */
    DICT.wav = function (frames, rate, out) {
        var len = frames.reduce(function (n, f) { return n + f.length; }, 0), all = new Float32Array(len), o = 0;
        frames.forEach(function (f) { all.set(f, o); o += f.length; });
        var ratio = rate / out, n = Math.floor(len / ratio), pcm = new Int16Array(n);
        for (var i = 0; i < n; i++) {
            var a = Math.floor(i * ratio), b = Math.min(len, Math.floor((i + 1) * ratio)), s = 0;
            for (var j = a; j < b; j++) s += all[j];
            var v = b > a ? s / (b - a) : 0; v = Math.max(-1, Math.min(1, v));
            pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
        }
        var buf = new ArrayBuffer(44 + pcm.length * 2), dv = new DataView(buf);
        var w = function (p, str) { for (var k = 0; k < str.length; k++) dv.setUint8(p + k, str.charCodeAt(k)); };
        w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
        dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, out, true);
        dv.setUint32(28, out * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
        new Int16Array(buf, 44).set(pcm);
        var bytes = new Uint8Array(buf), bin = '';
        for (var q = 0; q < bytes.length; q += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(q, q + 0x8000));
        return btoa(bin);
    };

    /** 16 kHz WAV (base64) → the AI Hub → Whisper on this PC → the words in the prompt box. */
    DICT.transcribe = function (wav, lang) {
        DICT.setState('busy', '<i class="fas fa-circle-notch fa-spin"></i> Writing it down on this PC…');
        var body = { audio_b64: wav, mime: 'audio/wav', provider: 'foundry' }; if (lang) body.language = lang;
        var t0 = Date.now();
        DICT.hub('POST', '/voice/stt', body).then(function (r) {
            DICT.setState('idle'); DICT.pending = null;
            var text = ((r && r.text) || '').trim();
            if (!text) { DICT.say('I could not make out any words — try again a little closer to the microphone.', '', 6000); return; }
            DICT.insert(text);
            DICT.meta('<i class="fas fa-microphone-lines"></i> Dictated on this PC in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s · check the words, then Send', 6000, 'ok');
        }).catch(function (e) {
            DICT.setState('idle');
            var msg = String(e || '');
            if (/not set up/i.test(msg)) { DICT.pending = { wav: wav, lang: lang }; DICT.setup(msg); }      // kept: transcribed right after the setup
            else if (/^HUB_OFFLINE:|not installed|Install the AI Hub|Not set up yet|not running/i.test(msg)) { DICT.pending = { wav: wav, lang: lang }; DICT.needHub(msg.replace(/^HUB_OFFLINE:/, '')); }
            else DICT.say('Dictation: ' + msg, 'err', 10000);
        });
    };

    /** Puts the words at the cursor of the prompt box (a space on either side when needed) and lets it grow. */
    DICT.insert = function (text) {
        var inp = $('prompt-input'); if (!inp) return;
        var a = inp.selectionStart == null ? inp.value.length : inp.selectionStart, b = inp.selectionEnd == null ? a : inp.selectionEnd;
        var before = inp.value.slice(0, a), after = inp.value.slice(b);
        var piece = (before && !/\s$/.test(before) ? ' ' : '') + text + (after && !/^\s/.test(after) ? ' ' : '');
        inp.value = before + piece + after;
        var pos = (before + piece).length;
        inp.focus(); inp.setSelectionRange(pos, pos);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
    };

    DICT.setState = function (s, metaHtml) {
        DICT.state = s;
        var btn = $('btn-dictate'); if (!btn) return;
        btn.classList.toggle('rec', s === 'rec'); btn.classList.toggle('busy', s === 'busy');
        btn.innerHTML = '<i class="fas ' + (s === 'rec' ? 'fa-stop' : s === 'busy' ? 'fa-circle-notch fa-spin' : 'fa-microphone-lines') + '"></i>';
        btn.title = s === 'rec' ? 'Listening — click to stop and put the words in the prompt' : s === 'busy' ? 'Working…' : 'Dictate — speech to text on this PC (Ctrl+Shift+D)';
        if (s === 'idle') { btn.style.removeProperty('--lvl'); DICT.meta(''); }
        if (metaHtml != null) DICT.meta(metaHtml, 0, s);
    };

    /** The one-line status under the input row (its own element — the page's status bar belongs to the chat). */
    DICT.meta = function (html, hideMs, cls) {
        var row = document.querySelector('.input-area .input-row'); if (!row) return;
        var el = $('dict-status');
        if (!el) { el = document.createElement('div'); el.id = 'dict-status'; el.className = 'dict-status'; row.parentNode.insertBefore(el, row.nextSibling); }
        el.innerHTML = html || ''; el.className = 'dict-status' + (cls ? ' ' + cls : '');
        clearTimeout(DICT.metaTimer);
        if (html && hideMs) DICT.metaTimer = setTimeout(function () { if (el.innerHTML === html) el.innerHTML = ''; }, hideMs);
    };
    DICT.say = function (text, cls, hideMs) { DICT.meta('<i class="fas ' + (cls === 'err' ? 'fa-triangle-exclamation' : 'fa-circle-info') + '"></i> ' + escp(text), hideMs || 0, cls || ''); };

    // ── dialogs (this page has no shared modal helper) ──
    DICT.dialog = function (title, bodyHtml, buttons) {
        DICT.closeDialog();
        var dlg = document.createElement('div'); dlg.id = 'dict-dialog';
        dlg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;';
        dlg.innerHTML = '<div class="dict-card"><div class="dict-card-h"><i class="fas fa-microphone-lines"></i> ' + escp(title) + '</div><div class="dict-card-b">' + bodyHtml + '</div><div class="dict-card-f" id="dict-dialog-f"></div></div>';
        dlg.addEventListener('click', function (ev) { if (ev.target === dlg) DICT.closeDialog(); });
        document.body.appendChild(dlg);
        var f = $('dict-dialog-f');
        (buttons || []).forEach(function (b) {
            var btn = document.createElement('button'); btn.className = 'btn' + (b.cls ? ' ' + b.cls : ''); btn.innerHTML = b.label; btn.onclick = b.onClick; f.appendChild(btn);
        });
        return dlg;
    };
    DICT.closeDialog = function () { var d = $('dict-dialog'); if (d) d.remove(); };

    /** First-time setup: Foundry Local's Whisper into the AI Hub on this PC. */
    DICT.setup = function (why) {
        DICT.dialog('Set up local dictation',
            '<p>' + escp(why || 'Dictation runs on this PC through Microsoft Foundry Local.') + '</p>' +
            '<p class="sm">One click installs Microsoft Foundry Local\'s speech recognition (Whisper) into the AI Hub on this PC — about 100 MB downloaded once. ' +
            'Your voice never leaves the PC; there is no key and no cost.</p>' +
            '<pre id="dict-log" class="dict-log" hidden></pre>',
            [{ label: '<i class="fas fa-download"></i> Set up now', cls: 'dict-primary', onClick: DICT.install }, { label: 'Close', onClick: DICT.closeDialog }]);
    };

    /** The AI Hub (the local service that runs Whisper) is missing or not running. */
    DICT.needHub = function (why) {
        DICT.dialog('Dictation needs the AI Hub',
            '<p>' + escp(why || 'The AI Hub is not running.') + '</p>' +
            '<p class="sm">Dictation runs on this PC through the AI Hub, the small local service that also serves the AI Agent. ' +
            'Install or start it on the AI Hub page, then come back — your recording is kept and will be written down when you try again.</p>',
            [{ label: '<i class="fas fa-up-right-from-square"></i> Open the AI Hub page', cls: 'dict-primary', onClick: function () { window.location.href = '../aihub/index.html'; } },
             { label: '<i class="fas fa-rotate"></i> Try again', onClick: function () { DICT.closeDialog(); if (DICT.pending) { var p = DICT.pending; DICT.pending = null; DICT.transcribe(p.wav, p.lang); } } },
             { label: 'Close', onClick: DICT.closeDialog }]);
    };

    DICT.install = function () {
        var f = $('dict-dialog-f'), log = $('dict-log');
        var buttons = function (on) { if (f) f.querySelectorAll('button').forEach(function (b) { b.disabled = !on; }); };
        var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
        buttons(false);
        if (log) { log.hidden = false; log.textContent = 'Starting…'; }
        DICT.hub('POST', '/voice/foundry/install', {}).then(function poll(st) {
            st = st || {};
            if (log) { log.textContent = (st.log || '') + (st.error ? '\n' + st.error : ''); log.scrollTop = log.scrollHeight; }
            if (st.state === 'done') {
                DICT.closeDialog(); DICT.say('Local dictation is ready' + (st.model ? ' (' + st.model + ')' : '') + '.', 'ok', 6000);
                if (DICT.pending) { var p = DICT.pending; DICT.pending = null; DICT.transcribe(p.wav, p.lang); }
                return;
            }
            if (st.state === 'error') { buttons(true); DICT.say('Setup failed: ' + st.error, 'err', 10000); return; }
            return sleep(3000).then(function () { return DICT.hub('GET', '/voice/foundry'); }).then(poll);
        }).catch(function (e) {
            buttons(true);
            var msg = String(e || '').replace(/^HUB_OFFLINE:/, '');
            DICT.say('Setup: ' + msg + (/not found|404/i.test(msg) ? ' — this AI Hub is older than the app: update it from the AI Hub page.' : ''), 'err', 10000);
        });
    };

    document.addEventListener('keydown', function (e) { if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd') && $('btn-dictate')) { e.preventDefault(); DICT.toggle(); } });
})();
