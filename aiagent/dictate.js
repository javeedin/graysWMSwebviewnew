/* AI Agent — Dictate: speech to text on this PC through Microsoft Foundry Local (Whisper), typed into the prompt.
   Click the dictation button next to the camera (or Ctrl+Shift+D), speak, click again: the recording goes to the
   AI Hub (POST /voice/stt, provider "foundry"), which runs Whisper inside its own process on this PC - no cloud, no
   key, no cost - and the words land in the composer at the cursor. Nothing is sent to the agent until you press Send.
   Only this: the hands-free voice mode (voice.js) and its settings are untouched. The first use offers a one-click
   setup (POST /voice/foundry/install: the foundry-local-sdk package + the Whisper model, downloaded once); the
   recording that hit the missing setup is kept and transcribed as soon as the setup is done. */

var DICT = window.DICT = { state: 'idle', frames: [], stream: null, ctx: null, node: null, since: 0, timer: null, level: 0, peak: 0, pending: null, MAX_SECS: 120 };

DICT.toggle = function () {
    if (DICT.state === 'rec') { DICT.finish(); return; }
    if (DICT.state === 'busy') return;
    DICT.start();
};

DICT.start = function () {
    if (window.VOICE && VOICE.on) VOICE.stop();                       // one owner of the microphone at a time
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('This window has no microphone access.', 'err'); return; }
    DICT.setState('busy', '<i class="fa-solid fa-circle-notch fa-spin"></i> Opening the microphone…');
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
    }).catch(function (e) { DICT.setState('idle'); toast('Microphone: ' + (e && e.message ? e.message : e), 'err'); });
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
    DICT.meta('<i class="fa-solid fa-circle rec-dot"></i> Dictating… ' + m + ':' + (s < 10 ? '0' : '') + s +
        ' — click the dictation button again to put the words in the prompt' + (secs > 6 && DICT.peak < 0.002 ? ' · <b>your microphone sends no sound</b>' : ''), 0, 'rec');
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
    if (secs < 0.4) { DICT.setState('idle'); toast('Nothing recorded — click, speak, then click again.', ''); return; }
    var lang = window.VOICE && VOICE.cfg && VOICE.cfg.language ? VOICE.cfg.language.split('-')[0] : null;
    DICT.transcribe(VOICE.wav(frames, rate, 16000), lang);
};

/** 16 kHz WAV (base64) → the AI Hub → Whisper on this PC → the words in the composer. */
DICT.transcribe = function (wav, lang) {
    DICT.setState('busy', '<i class="fa-solid fa-circle-notch fa-spin"></i> Writing it down on this PC…');
    var body = { audio_b64: wav, mime: 'audio/wav', provider: 'foundry' }; if (lang) body.language = lang;
    var t0 = Date.now();
    hub('POST', '/voice/stt', body).then(function (r) {
        DICT.setState('idle'); DICT.pending = null;
        var text = ((r && r.text) || '').trim();
        if (!text) { toast('I could not make out any words — try again a little closer to the microphone.', ''); return; }
        DICT.insert(text);
        DICT.meta('<i class="fa-solid fa-microphone-lines"></i> Dictated on this PC in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s · check the words, then Send', 6000, 'ok');
    }).catch(function (e) {
        DICT.setState('idle');
        var msg = String(e || '');
        if (/not set up/i.test(msg)) { DICT.pending = { wav: wav, lang: lang }; DICT.setup(msg); }   // kept: transcribed right after the setup
        else toast('Dictation: ' + msg, 'err');
    });
};

/** Puts the words at the cursor (a space on either side when needed) and lets the composer grow. */
DICT.insert = function (text) {
    var inp = $('input'); if (!inp) return;
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
    btn.innerHTML = '<i class="fa-solid ' + (s === 'rec' ? 'fa-stop' : s === 'busy' ? 'fa-circle-notch fa-spin' : 'fa-microphone-lines') + '"></i>';
    btn.title = s === 'rec' ? 'Listening — click to stop and put the words in the prompt' : s === 'busy' ? 'Working…' : 'Dictate — speech to text on this PC (Ctrl+Shift+D)';
    if (s === 'idle') { btn.style.removeProperty('--lvl'); DICT.meta(''); }
    if (metaHtml != null) DICT.meta(metaHtml, 0, s);
};

/** The one-line status under the composer row (its own element - the compose-meta line belongs to core.js). */
DICT.meta = function (html, hideMs, cls) {
    var row = document.querySelector('.compose-row'); if (!row) return;
    var el = $('dict-status');
    if (!el) { el = document.createElement('div'); el.id = 'dict-status'; el.className = 'dict-status'; row.parentNode.insertBefore(el, row.nextSibling); }
    el.innerHTML = html || ''; el.className = 'dict-status' + (cls ? ' ' + cls : '');
    clearTimeout(DICT.metaTimer);
    if (html && hideMs) DICT.metaTimer = setTimeout(function () { if (el.innerHTML === html) el.innerHTML = ''; }, hideMs);
};

// ── first-time setup: Foundry Local's Whisper into the AI Hub on this PC ──
DICT.setup = function (why) {
    openModal('Set up local dictation',
        '<p>' + esc(why || 'Dictation runs on this PC through Microsoft Foundry Local.') + '</p>' +
        '<p class="sm">One click installs Microsoft Foundry Local\'s speech recognition (Whisper) into the AI Hub on this PC — about 100 MB downloaded once. ' +
        'Your voice never leaves the PC; there is no key and no cost. The hands-free voice mode is not changed.</p>' +
        '<pre id="dict-log" class="dict-log" hidden></pre>',
        [{ label: '<i class="fa-solid fa-download"></i> Set up now', cls: 'primary', onClick: DICT.install }, { label: 'Close', onClick: closeModal }]);
};

DICT.install = function () {
    var f = $('modal-f'), log = $('dict-log');
    var buttons = function (on) { if (f) f.querySelectorAll('button').forEach(function (b) { b.disabled = !on; }); };
    buttons(false);
    if (log) { log.hidden = false; log.textContent = 'Starting…'; }
    hub('POST', '/voice/foundry/install', {}).then(function poll(st) {
        if (log) { log.textContent = (st.log || '') + (st.error ? '\n' + st.error : ''); log.scrollTop = log.scrollHeight; }
        if (st.state === 'done') {
            closeModal(); toast('Local dictation is ready' + (st.model ? ' (' + st.model + ')' : '') + '.', 'ok');
            if (DICT.pending) { var p = DICT.pending; DICT.pending = null; DICT.transcribe(p.wav, p.lang); }
            return;
        }
        if (st.state === 'error') { buttons(true); toast('Setup failed: ' + st.error, 'err'); return; }
        return sleep(3000).then(function () { return hub('GET', '/voice/foundry'); }).then(poll);
    }).catch(function (e) {
        buttons(true);
        var msg = String(e || '');
        toast('Setup: ' + msg + (/not found|404/i.test(msg) ? ' — this AI Hub is older than the app: update it from the AI Hub page.' : ''), 'err');
    });
};

document.addEventListener('keydown', function (e) { if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd') && $('btn-dictate')) { e.preventDefault(); DICT.toggle(); } });
