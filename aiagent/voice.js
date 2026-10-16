/* AI Agent — voice mode: talk to the agent hands-free, like a phone conversation.
   Listen (voice activity detection on the microphone) → transcribe (AI Hub /voice/stt: ElevenLabs Scribe, Azure,
   local Whisper — or the WebView's own recogniser) → the agent (voice style: short spoken sentences) → speak each
   sentence as soon as it arrives (AI Hub /voice/tts: ElevenLabs / Azure neural / Amazon Polly — or the browser's
   voices) → listen again. Talk over it to interrupt (barge-in). Question cards can be answered by voice; anything
   that changes data still needs a click on its confirm card. */

var VOICE = window.VOICE = { on: false, state: 'off', cfg: null, since: 0, muted: false, queue: [], playing: null, level: 0 };

VOICE.ICON = { off: 'fa-microphone', listening: 'fa-ear-listen', hearing: 'fa-wave-square', transcribing: 'fa-pen', thinking: 'fa-brain', speaking: 'fa-volume-high', waiting: 'fa-hand-pointer' };
VOICE.LABEL = { listening: 'Listening…', hearing: 'Hearing you…', transcribing: 'Got it…', thinking: 'Thinking…', speaking: 'Speaking — talk to interrupt', waiting: 'Waiting for your click on the card', muted: 'Microphone muted' };

/** Speech recognition actually used now: the setting, unless the WebView's recogniser failed and we fell back. */
VOICE.stt = function () { return VOICE.sttOverride || (VOICE.cfg && VOICE.cfg.voice.stt.provider) || 'browser'; };
/** The voice in use (Voice settings). */
VOICE.tts = function () {
    return (VOICE.cfg && VOICE.cfg.voice.tts.provider) || 'browser';   // installing the natural voice switches the setting to it
};
VOICE.lang = function () { return (VOICE.cfg && VOICE.cfg.language) || 'en-US'; };
VOICE.male = function () { return VOICE.cfg && VOICE.cfg.gender === 'male'; };
VOICE.toggle = function () { if (VOICE.on) VOICE.stop(); else VOICE.start(); };

VOICE.loadCfg = function (force) {
    if (VOICE.cfg && !force) return Promise.resolve(VOICE.cfg);
    return hub('GET', '/voice/config').then(function (c) { VOICE.cfg = c; return c; });
};

VOICE.start = function () {
    VOICE.loadCfg(true).then(function () {
        VOICE.sttOverride = null; VOICE.srBroken = false;
        // the WebView's own recogniser rarely works inside the app: use local Whisper when it is installed
        if (VOICE.cfg.voice.stt.provider === 'browser' && (!VOICE.browserSR() || (VOICE.cfg.whisper && VOICE.cfg.whisper.installed))) VOICE.sttOverride = VOICE.cfg.whisper && VOICE.cfg.whisper.installed ? 'whisper' : 'none';
        return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (stream) {
            VOICE.stream = stream;
            var Ctx = window.AudioContext || window.webkitAudioContext;
            VOICE.ctx = new Ctx();
            var src = VOICE.ctx.createMediaStreamSource(stream);
            VOICE.proc = VOICE.ctx.createScriptProcessor(2048, 1, 1);
            src.connect(VOICE.proc); VOICE.proc.connect(VOICE.ctx.destination);
            VOICE.proc.onaudioprocess = VOICE.onAudio;
            VOICE.on = true; VOICE.since = Date.now() / 1000; VOICE.peak = 0; VOICE.silentChecked = false; VOICE.sticky = false; VOICE.floor = 0.008; VOICE.frames = []; VOICE.pre = [];
            VOICE.ui(true);
            VOICE.setState('listening');
            VOICE.tick = setInterval(VOICE.loop, 200);
            // you hear at once that the voice side works
            if (VOICE.stt() === 'none') { VOICE.speakText("Hi! Before I can hear you, set up speech recognition with the button."); VOICE.needStt('This app window has no built-in speech recognition.'); }
            else { VOICE.speakText("Hi, I'm listening."); if (VOICE.stt() === 'browser') VOICE.srListen(); }
            VOICE.offerNatural();
        });
    }).catch(function (e) { toast('Voice mode: ' + (e && e.message ? e.message : e), 'err'); VOICE.stop(); });
};

VOICE.stop = function () {
    VOICE.on = false;
    clearInterval(VOICE.tick);
    VOICE.hush();
    try { if (VOICE.sr) VOICE.sr.abort(); } catch (e) { /* ended */ }
    try { if (VOICE.proc) VOICE.proc.disconnect(); if (VOICE.ctx) VOICE.ctx.close(); } catch (e) { /* closed */ }
    if (VOICE.stream) VOICE.stream.getTracks().forEach(function (t) { t.stop(); });
    VOICE.stream = VOICE.ctx = VOICE.proc = VOICE.sr = null;
    VOICE.setState('off'); VOICE.ui(false);
};

// ── the conversation loop (every 200 ms): when the agent and the voice are done, listen again ──
VOICE.loop = function () {
    if (!VOICE.on) return;
    var st = VOICE.state;
    if (st === 'thinking' && !AG.busy) {
        if (AG.pendingCards && document.querySelector('#cards .card.confirm:not(.ask)')) { if (!VOICE.saidWait) { VOICE.saidWait = true; VOICE.speakText('It needs your confirmation on the screen.'); } VOICE.setState('waiting'); return; }
        if (!VOICE.queue.length && !VOICE.playing) VOICE.setState('listening');
    }
    if (st === 'waiting' && !AG.pendingCards) VOICE.setState(AG.busy ? 'thinking' : 'listening');
    if (st === 'speaking' && !VOICE.queue.length && !VOICE.playing) VOICE.setState(AG.busy ? 'thinking' : AG.pendingCards ? 'waiting' : 'listening');
    if (VOICE.state === 'listening' && VOICE.stt() === 'browser' && !VOICE.srActive && !VOICE.srBroken) VOICE.srListen();
};

VOICE.setState = function (s) {
    VOICE.state = s;
    if (s === 'listening') VOICE.saidWait = false;
    if (VOICE.refreshBar) VOICE.refreshBar();
    var lbl = $('vc-state'), orb = $('vc-orb');
    if (!lbl || !orb) return;
    lbl.textContent = VOICE.muted && (s === 'listening' || s === 'hearing') ? VOICE.LABEL.muted : s === 'listening' && VOICE.stt() === 'none' ? 'I can\'t hear you yet — set up speech recognition' : (VOICE.LABEL[s] || '');
    // the icon is re-created (Font Awesome's script may have swapped the <i> for an <svg>)
    if (orb.dataset.s !== s) { orb.innerHTML = '<i class="fa-solid ' + (VOICE.ICON[s] || 'fa-microphone') + '"></i>'; orb.dataset.s = s; }
    orb.className = 'vc-orb ' + s;
};

// ── microphone: voice activity detection + recording ──
VOICE.onAudio = function (ev) {
    if (!VOICE.on) return;
    var x = ev.inputBuffer.getChannelData(0), sum = 0;
    for (var i = 0; i < x.length; i++) sum += x[i] * x[i];
    var rms = Math.sqrt(sum / x.length);
    VOICE.level = VOICE.level * 0.6 + rms * 0.4;
    var orb = $('vc-orb'); if (orb) orb.style.setProperty('--lvl', Math.min(1, VOICE.level * 12).toFixed(3));
    var lv = $('vc-lvl'); if (lv) lv.style.width = Math.min(100, Math.round(VOICE.level * 600)) + '%';
    VOICE.peak = Math.max(VOICE.peak || 0, rms);
    if (!VOICE.silentChecked && VOICE.since && Date.now() / 1000 - VOICE.since > 8) {
        VOICE.silentChecked = true;
        if (VOICE.peak < 0.002 && !VOICE.sticky) VOICE.status('Your microphone sends no sound. Check it is not muted (keyboard key or Windows sound settings) and that the right microphone is the default.');
    }
    if (VOICE.muted || VOICE.stt() === 'none') return;
    if (VOICE.stt() === 'browser') { VOICE.watchSR(rms); return; }
    var st = VOICE.state, speaking = st === 'speaking';
    var thr = Math.max(0.012, VOICE.floor * 3), barge = Math.max(0.05, VOICE.floor * 7);
    var frame = new Float32Array(x);
    if (st === 'listening' || speaking) {
        if (rms < thr) VOICE.floor = VOICE.floor * 0.95 + rms * 0.05;
        VOICE.pre.push(frame); if (VOICE.pre.length > 6) VOICE.pre.shift();
        var loud = rms > (speaking ? barge : thr);
        VOICE.loudRun = loud ? (VOICE.loudRun || 0) + 1 : 0;
        if (VOICE.loudRun >= (speaking ? 5 : 3)) {
            if (speaking) VOICE.hush();                          // barge-in: the user talks over the agent
            VOICE.frames = VOICE.pre.slice(); VOICE.pre = []; VOICE.quiet = 0; VOICE.heard = 0;
            VOICE.setState('hearing');
        }
        return;
    }
    if (st === 'hearing') {
        VOICE.frames.push(frame); VOICE.heard++;
        VOICE.quiet = rms < thr * 0.75 ? VOICE.quiet + 1 : 0;
        var secs = VOICE.frames.length * x.length / VOICE.ctx.sampleRate;
        if ((VOICE.quiet * x.length / VOICE.ctx.sampleRate > 0.85 && VOICE.heard > 8) || secs > 30) VOICE.finishUtterance();
    }
};

VOICE.finishUtterance = function () {
    var frames = VOICE.frames; VOICE.frames = [];
    VOICE.setState('transcribing');
    var wav = VOICE.wav(frames, VOICE.ctx.sampleRate, 16000);
    hub('POST', '/voice/stt', { audio_b64: wav, mime: 'audio/wav', language: VOICE.lang().split('-')[0], provider: VOICE.stt() }).then(function (r) {
        VOICE.heardText((r.text || '').trim());
    }).catch(function (e) { toast('Speech recognition: ' + e, 'err'); VOICE.setState('listening'); });
};

/** Float32 frames at `rate` → 16 kHz mono PCM16 WAV, base64. */
VOICE.wav = function (frames, rate, out) {
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

// ── the WebView's own recogniser (when set to "browser") ──
VOICE.browserSR = function () { return window.SpeechRecognition || window.webkitSpeechRecognition || null; };
VOICE.srListen = function () {
    var SR = VOICE.browserSR(); if (!SR || VOICE.muted || VOICE.srActive) return;
    var sr = VOICE.sr = new SR();
    sr.lang = VOICE.lang();
    sr.interimResults = true; sr.continuous = false;
    sr.onstart = function () { VOICE.srActive = true; };
    sr.onresult = function (e) {
        var r = e.results[e.results.length - 1], t = r[0].transcript;
        if (VOICE.state === 'speaking' && t.trim().length > 3) VOICE.hush();
        VOICE.srHeard = Date.now();
        if (r.isFinal) VOICE.heardText(t.trim()); else { VOICE.caption('you', t); if (VOICE.state === 'listening') VOICE.setState('hearing'); }
    };
    sr.onend = function () { VOICE.srActive = false; };
    sr.onerror = function (e) {
        VOICE.srActive = false;
        // "network" / "service-not-allowed": WebView2 has the API but not the online service behind it
        if (e && /network|service-not-allowed|not-allowed|language-not-supported|audio-capture/.test(e.error || '')) VOICE.srFailed(e.error);
    };
    try { sr.start(); } catch (e) { VOICE.srActive = false; }
};

/** You talk but the recogniser returns nothing for 5 s → it is not working in this window. */
VOICE.watchSR = function (rms) {
    if (VOICE.srBroken || VOICE.state !== 'listening') return;
    if (rms > Math.max(0.03, VOICE.floor * 4)) { if (!VOICE.loudSince) VOICE.loudSince = Date.now(); }
    else if (rms < 0.01) VOICE.floor = VOICE.floor * 0.95 + rms * 0.05;
    if (VOICE.loudSince && Date.now() - VOICE.loudSince > 5000 && (!VOICE.srHeard || VOICE.srHeard < VOICE.loudSince)) VOICE.srFailed('no-result');
};
VOICE.srFailed = function (why) {
    if (VOICE.srBroken) return;
    VOICE.srBroken = true; VOICE.loudSince = 0;
    try { if (VOICE.sr) VOICE.sr.abort(); } catch (e) { /* ended */ }
    if (VOICE.cfg.whisper && VOICE.cfg.whisper.installed) { VOICE.sttOverride = 'whisper'; VOICE.caption('agent', 'Switched to local speech recognition (Whisper) — go ahead.'); return; }
    VOICE.sttOverride = 'none';
    VOICE.needStt('The built-in speech recognition does not work in this app window (' + why + ').');
};
/** No working recogniser: a permanent "Set up listening" button in the bar (not in the caption, so nothing can hide it). */
VOICE.needStt = function (why) {
    VOICE.sttWhy = why;
    VOICE.setState('waiting');
    VOICE.status(why + ' Press <b>Set up listening (free)</b> — it runs on this PC — or use an ElevenLabs / Azure key in settings.');
    VOICE.refreshBar();
};
/** A sticky status line under the state (setup progress, errors) — captions do not overwrite it. */
VOICE.status = function (html) {
    var c = $('vc-cap'); if (!c) return;
    VOICE.sticky = !!html;
    c.classList.toggle('help', !!html);
    if (html) c.innerHTML = html;
};
/** Buttons that depend on the state: Set up listening (until it works), Natural voice (while the voice is robotic). */
VOICE.refreshBar = function () {
    var box = document.querySelector('#voice-ov .vc-btns'); if (!box) return;
    var need = VOICE.on && VOICE.stt() === 'none', btn = $('vc-listen');
    if (need && !btn) {
        btn = document.createElement('button'); btn.id = 'vc-listen'; btn.className = 'btn sm vc-natural';
        btn.innerHTML = '<i class="fa-solid fa-ear-listen"></i> Set up listening (free)';
        btn.title = 'Installs free speech recognition (Whisper) in the AI Hub on this PC';
        btn.onclick = VOICE.installWhisper;
        box.prepend(btn);
    } else if (!need && btn) btn.remove();
    var mute = $('vc-mute');
    if (mute) { mute.classList.toggle('on', VOICE.muted); mute.innerHTML = '<i class="fa-solid ' + (VOICE.muted ? 'fa-microphone-slash' : 'fa-microphone') + '"></i>'; mute.title = VOICE.muted ? 'Microphone is MUTED — click to unmute' : 'Microphone is on — click to mute'; }
};
VOICE.installWhisper = function () {
    var btn = $('vc-listen');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Setting up…'; }
    var fail = function (msg, old) {
        VOICE.status(esc(msg) + (old ? ' <button class="btn sm" onclick="AG.showHubPanel()"><i class="fa-solid fa-server"></i> Update the AI Hub</button>' : ''));
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Retry setup'; }
    };
    hub('POST', '/voice/whisper/install', {}).then(function poll(st) {
        if (!VOICE.on) return;
        if (st.state === 'done' || (st.installed && st.state !== 'running')) {
            VOICE.cfg.whisper = st; VOICE.sttOverride = 'whisper'; VOICE.srBroken = true;
            VOICE.status(null); VOICE.refreshBar();
            VOICE.setState('listening'); VOICE.speakText('All set. I can hear you now.');
            return;
        }
        if (st.state === 'error') { fail('Setup failed: ' + st.error + (st.log ? ' — ' + String(st.log).trim().split('\n').pop().slice(0, 120) : '')); return; }
        VOICE.status('Setting up free speech recognition (first time: about 150 MB, a few minutes)… <span class="muted">' + esc(String(st.log || '').trim().split('\n').pop().slice(0, 90)) + '</span>');
        return new Promise(function (r) { setTimeout(r, 3000); }).then(function () { return hub('GET', '/voice/whisper'); }).then(poll);
    }).catch(function (e) {
        var old = /not found|404/i.test(String(e));
        fail(old ? 'This AI Hub is too old for voice setup.' : 'Setup failed: ' + e, true);
    });
};

// ── what the user said → a card answer, a voice command, or a message to the agent ──
VOICE.heardText = function (text) {
    if (!VOICE.on) return;
    if (!text) { VOICE.setState('listening'); return; }
    VOICE.caption('you', text);
    var low = text.toLowerCase().replace(/[.!?]/g, '').trim();
    if (/^(stop|be quiet|quiet|shut up|cancel that)$/.test(low)) { VOICE.hush(); if (AG.busy) AG.stop(); VOICE.setState('listening'); return; }
    if (/^(end voice|stop listening|goodbye|bye|that's all|thats all)$/.test(low)) { VOICE.speakText('Okay, talk soon.'); setTimeout(VOICE.stop, 1800); return; }
    // an open question card: answer it by voice (option buttons by best match, else the free-text answer)
    var ask = document.querySelector('#cards .card.ask');
    if (ask) {
        var opts = Array.prototype.slice.call(ask.querySelectorAll('.opt'));
        var best = opts.map(function (b) { return { b: b, s: VOICE.match(low, b.dataset.v.toLowerCase()) }; }).sort(function (a, b) { return b.s - a.s; })[0];
        if (best && best.s >= 0.5) best.b.click();
        else { var inp = ask.querySelector('.ans'); if (inp) { inp.value = text; ask.querySelector('.btn.primary').click(); } }
        VOICE.setState('thinking');
        return;
    }
    if (AG.pendingCards) { VOICE.speakText('Please use the card on the screen first.'); return; }
    if (AG.busy) { VOICE.setState('thinking'); return; }
    $('input').value = text;
    VOICE.setState('thinking');
    AG.send();
};
VOICE.match = function (said, opt) {
    if (said === opt || said.indexOf(opt) >= 0) return 1;
    var a = said.split(/\s+/), b = opt.split(/\s+/), hit = b.filter(function (w) { return w.length > 1 && a.indexOf(w) >= 0; }).length;
    return b.length ? hit / b.length : 0;
};

// ── speaking ──
/** Called for every live timeline event: speak the agent's words as they arrive. */
VOICE.onEvent = function (e) {
    if (!VOICE.on || !e || (e.ts && e.ts < VOICE.since)) return;
    if (e.kind === 'say' && e.data && e.data.text) VOICE.speakText(e.data.text);
    if (e.kind === 'error') VOICE.speakText('Sorry, something went wrong. ' + String(e.data && e.data.text || '').slice(0, 80));
};
/** Markdown → speakable words (the hub does the same for cloud voices). */
VOICE.plain = function (t) {
    return String(t || '').replace(/^\s*#{1,6}\s*(.+?)\s*$/gm, '$1.').replace(/```[\s\S]*?```/g, ' ').replace(/\[\[\w+:([^\]]+)\]\]/g, '$1').replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/https?:\/\/\S+/g, 'the link on your screen').split('\n').filter(function (l) { return !/^\s*\|/.test(l) && !/^\s*>\s*\[!/.test(l); }).join('\n')
        .replace(/[*_`#>~=]+/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
};
/** Sentence chunks (short first chunk = it starts talking sooner). */
VOICE.chunks = function (text) {
    var s = VOICE.plain(text).match(/[^.!?…]+[.!?…]*\s*/g) || [], out = [], cur = '';
    s.forEach(function (x) { if ((cur + x).length > (out.length ? 240 : 120) && cur) { out.push(cur.trim()); cur = ''; } cur += x; });
    if (cur.trim()) out.push(cur.trim());
    return out;
};
VOICE.speakText = function (text) {
    var parts = VOICE.chunks(text); if (!parts.length) return;
    VOICE.caption('agent', VOICE.plain(text));
    var prov = VOICE.tts();
    parts.forEach(function (p) {
        // cloud voices are fetched at once (in parallel with the playback of earlier chunks)
        var item = { text: p, audio: prov === 'browser' ? null : hub('POST', '/voice/tts', { text: p, provider: prov }).catch(function (e) { return { error: String(e) }; }) };
        VOICE.queue.push(item);
    });
    if (VOICE.state !== 'hearing' && VOICE.state !== 'transcribing') VOICE.setState('speaking');
    if (!VOICE.playing) VOICE.next();
};
VOICE.next = function () {
    var item = VOICE.queue.shift();
    if (!item) { VOICE.playing = null; return; }
    VOICE.playing = item;
    var done = function () { if (VOICE.playing === item) { VOICE.playing = null; VOICE.next(); } };
    if (!item.audio) { VOICE.browserSay(item.text, done); return; }
    item.audio.then(function (r) {
        if (VOICE.playing !== item) return;
        if (!r || r.error || !r.audio_b64) { if (r && r.text) VOICE.browserSay(r.text, done); else { if (r && r.error) toast('Voice: ' + r.error, 'err'); VOICE.browserSay(item.text, done); } return; }
        var a = item.el = new Audio('data:' + (r.mime || 'audio/mpeg') + ';base64,' + r.audio_b64);
        a.onended = done; a.onerror = done;
        a.play().catch(done);
    });
};
VOICE.FEMALE = /zira|hazel|susan|heera|kalpana|hortense|julie|katja|hedda|helena|laura|huihui|yaoyao|hoda|aria|jenny|sonia|denise|female/i;
VOICE.MALE = /david|mark|george|ravi|hemant|paul|claude|stefan|pablo|kangkang|naayf|guy|ryan|henri|male/i;
VOICE.browserSay = function (text, done) {
    if (!window.speechSynthesis) { done(); return; }
    var u = new SpeechSynthesisUtterance(text), vs = speechSynthesis.getVoices(), want = (VOICE.cfg && VOICE.cfg.voice.tts.voice) || '';
    var lang = VOICE.lang(), pre = lang.split('-')[0], g = VOICE.male() ? VOICE.MALE : VOICE.FEMALE;
    var inLang = vs.filter(function (v) { return v.lang && v.lang.replace('_', '-').toLowerCase().indexOf(pre) === 0; });
    var exact = inLang.filter(function (v) { return v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase(); });
    var pool = exact.length ? exact : inLang;
    // the chosen voice, else the most natural one in the language and gender (Windows "Natural" / "Online" voices first)
    var pick = vs.filter(function (v) { return want && v.name === want; })[0] ||
        pool.filter(function (v) { return /natural|online|neural/i.test(v.name) && g.test(v.name); })[0] ||
        pool.filter(function (v) { return g.test(v.name); })[0] || pool[0] || null;
    VOICE.lastVoice = pick && pick.name;
    try { u.voice = pick; } catch (e) { /* not a real SpeechSynthesisVoice: keep the default voice */ }
    u.lang = lang;
    u.rate = parseFloat(VOICE.cfg && VOICE.cfg.voice.tts.speed) || 1;
    u.onend = done; u.onerror = done;
    try { speechSynthesis.speak(u); } catch (e) { done(); }
};
/** Stop talking now (barge-in, "stop", end of voice mode). */
VOICE.hush = function () {
    VOICE.queue = [];
    var p = VOICE.playing; VOICE.playing = null;
    if (p && p.el) { try { p.el.pause(); } catch (e) { /* gone */ } }
    if (window.speechSynthesis) speechSynthesis.cancel();
};

// ── overlay ──
VOICE.ui = function (show) {
    var el = $('voice-ov');
    $('btn-voice').classList.toggle('on', !!show);
    if (!show) { if (el) el.remove(); return; }
    if (el) return;
    el = document.createElement('div'); el.id = 'voice-ov'; el.className = 'voice-ov';
    el.innerHTML = '<div class="vc-orb listening" id="vc-orb"><i class="fa-solid fa-ear-listen"></i></div>' +
        '<div class="vc-mid"><div class="vc-state" id="vc-state">Listening…</div><div class="vc-cap" id="vc-cap">Say something — e.g. “which trips are not printed yet?”</div></div>' +
        '<div class="vc-btns"><span class="vc-meter" title="Microphone level — it should move when you speak"><span id="vc-lvl"></span></span>' +
        '<button class="icon" id="vc-mute" title="Microphone is on — click to mute"><i class="fa-solid fa-microphone"></i></button>' +
        '<button class="icon" title="Stop the agent talking" onclick="VOICE.hush()"><i class="fa-solid fa-stop"></i></button>' +
        '<button class="icon" title="Voice settings" onclick="VOICE.settings()"><i class="fa-solid fa-sliders"></i></button>' +
        '<button class="btn danger sm" onclick="VOICE.stop()"><i class="fa-solid fa-phone-slash"></i> End</button></div>';
    document.querySelector('.composer').prepend(el);
    $('vc-mute').onclick = function () { VOICE.muted = !VOICE.muted; if (VOICE.muted && VOICE.sr) { try { VOICE.sr.abort(); } catch (e) { /* ok */ } } VOICE.setState(VOICE.state); };
};
VOICE.caption = function (who, text) {
    var c = $('vc-cap'); if (!c || VOICE.sticky) return;
    c.innerHTML = '<b>' + (who === 'you' ? 'You' : 'Agent') + ':</b> ' + esc(String(text).slice(0, 220));
};

// ── settings ──
VOICE.SOUNDS = [
    ['piper', 'Natural — free, runs on this PC', 'Neural voice, no key, works offline (one-time download ~70 MB).'],
    ['elevenlabs', 'Most natural — ElevenLabs', 'Studio-quality voices, needs an ElevenLabs key (paid per character).'],
    ['azure', 'Natural — Microsoft Azure', 'Neural voices, needs an Azure Speech key.'],
    ['polly', 'Natural — Amazon Polly', 'Generative voices, uses the AWS keys of your Bedrock provider.'],
    ['browser', 'Windows voices — robotic', 'The old built-in voices. No setup.']
];
VOICE.settings = function () {
    VOICE.loadCfg(true).then(function (c) {
        var v = c.voice, k = c.keys, cur = v.tts.provider;
        var sel = function (id, list, val) { return '<select id="' + id + '">' + list.map(function (x) { return '<option' + (x === val ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>'; };
        var key = function (name, label) { return '<label class="sm">' + label + ' ' + (k[name] ? '<span class="chip ok">set</span>' : '<span class="chip">not set</span>') + '<br><input type="password" data-key="' + name + '" placeholder="' + (k[name] ? 'leave empty to keep' : 'paste the key') + '" style="width:100%"></label>'; };
        var langs = c.languages || { 'en-US': { name: 'English (US)' } };
        openModal('Voice settings',
            '<div class="vpick">' +
            '<label class="sm">Language (what you say and hear)<br><select id="vs-language">' + Object.keys(langs).map(function (l) { return '<option value="' + l + '"' + (l === c.language ? ' selected' : '') + '>' + esc(langs[l].name) + '</option>'; }).join('') + '</select></label>' +
            '<div class="sm">Voice<div class="seg2" id="vs-gender"><button data-g="female" class="' + (c.gender !== 'male' ? 'on' : '') + '"><i class="fa-solid fa-person-dress"></i> Female</button><button data-g="male" class="' + (c.gender === 'male' ? 'on' : '') + '"><i class="fa-solid fa-person"></i> Male</button></div></div>' +
            '<button class="btn primary" id="vs-test"><i class="fa-solid fa-play"></i> Hear it</button></div>' +
            '<div class="vsounds">' + VOICE.SOUNDS.map(function (x) {
                var extra = x[0] === 'piper' ? (c.piper && c.piper.installed ? ' <span class="chip ok">installed</span>' : ' <button class="btn sm" id="vs-piper"><i class="fa-solid fa-download"></i> Set up (free)</button>')
                    : x[0] === 'elevenlabs' ? (k['elevenlabs.api_key'] ? ' <span class="chip ok">key set</span>' : '') : x[0] === 'azure' ? (k['azure_speech.key'] ? ' <span class="chip ok">key set</span>' : '') : '';
                return '<label class="vsound' + (x[0] === cur ? ' on' : '') + '"><input type="radio" name="vs-sound" value="' + x[0] + '"' + (x[0] === cur ? ' checked' : '') + '><span><b>' + x[1] + '</b>' + extra + '<br><span class="muted sm">' + x[2] + '</span></span></label>';
            }).join('') + '</div><div id="vs-msg" class="sm muted"></div>' +
            '<details class="vmore"><summary>More settings — speed, a specific voice, listening, keys</summary><div class="vgrid">' +
            '<div><label class="sm">Speed <span id="vs-spd-v">' + (v.tts.speed || 1) + '</span><br><input type="range" id="vs-speed" min="0.7" max="1.3" step="0.05" value="' + (v.tts.speed || 1) + '"></label>' +
            '<label class="sm">A specific voice (empty = by language + female / male)<br><span class="row"><input type="text" id="vs-voice" value="' + esc(v.tts.voice || '') + '" placeholder="automatic" class="grow"><button class="btn sm" id="vs-list">Choose…</button></span></label><div id="vs-voices" class="vlist"></div>' +
            '<label class="sm">ElevenLabs model<br><input type="text" id="vs-model" value="' + esc(v.tts.model || '') + '"></label>' +
            '<label class="sm">Polly engine<br>' + sel('vs-engine', ['generative', 'neural', 'long-form'], v.tts.engine) + '</label></div>' +
            '<div><label class="sm">Speech recognition (listening)<br>' + sel('vs-stt', c.stt_providers, v.stt.provider) + '</label>' +
            '<label class="sm">Local Whisper size<br>' + sel('vs-wsize', ['tiny', 'base', 'small', 'medium'], v.stt.whisper_size) + '</label>' +
            key('elevenlabs.api_key', 'ElevenLabs API key') + key('azure_speech.key', 'Azure Speech key') +
            '<label class="sm">Azure region<br><input type="text" id="vs-region" value="' + esc(v.azure_region || '') + '"></label>' +
            '<label class="sm">Amazon Polly uses the AWS keys of provider<br><input type="text" id="vs-aws" value="' + esc(v.aws_provider || 'bedrock') + '"></label></div></div></details>',
            [{ label: '<i class="fa-solid fa-floppy-disk"></i> Save', cls: 'primary', onClick: function () { VOICE.saveSettings().then(function () { closeModal(); toast('Voice settings saved', 'ok'); }); } }, { label: 'Close', onClick: closeModal }]);
        $('vs-speed').oninput = function () { $('vs-spd-v').textContent = this.value; };
        document.querySelectorAll('#vs-gender button').forEach(function (b) { b.onclick = function () { document.querySelectorAll('#vs-gender button').forEach(function (x) { x.classList.toggle('on', x === b); }); $('vs-voice').value = ''; VOICE.testVoice(); }; });
        document.querySelectorAll('input[name=vs-sound]').forEach(function (r) { r.onchange = function () { document.querySelectorAll('.vsound').forEach(function (l) { l.classList.toggle('on', l.contains(r)); }); $('vs-voice').value = ''; }; });
        $('vs-language').onchange = function () { $('vs-voice').value = ''; VOICE.testVoice(); };
        $('vs-test').onclick = VOICE.testVoice;
        if ($('vs-piper')) $('vs-piper').onclick = function () { VOICE.installPiper(); };
        $('vs-list').onclick = function () {
            var p = document.querySelector('input[name=vs-sound]:checked').value, box = $('vs-voices');
            if (p === 'browser') { var vs = (window.speechSynthesis ? speechSynthesis.getVoices() : []); box.innerHTML = vs.map(function (x) { return '<div class="vrow" data-id="' + esc(x.name) + '">' + esc(x.name) + ' <span class="muted">' + esc(x.lang) + '</span></div>'; }).join('') || '<p class="muted sm">No voices.</p>'; }
            else {
                box.innerHTML = '<p class="muted sm">Loading…</p>';
                VOICE.saveSettings().then(function () { return hub('GET', '/voice/voices?provider=' + p); }).then(function (list) {
                    box.innerHTML = list.map(function (x) { return '<div class="vrow" data-id="' + esc(x.id) + '"><b>' + esc(x.name) + '</b> <span class="muted">' + esc(x.info || '') + '</span></div>'; }).join('') || '<p class="muted sm">No voices.</p>';
                }).catch(function (e) { box.innerHTML = '<p class="sm" style="color:#b91c1c">' + esc(e) + '</p>'; });
            }
            box.onclick = function (ev) { var r = ev.target.closest('.vrow'); if (r) { $('vs-voice').value = r.dataset.id; box.querySelectorAll('.vrow').forEach(function (x) { x.classList.toggle('on', x === r); }); } };
        };
    }).catch(function (e) { toast('Voice settings: ' + e + ' — is the AI Hub up to date? (server button › Update)', 'err'); });
};
VOICE.SAMPLE = { en: "Hi! This is how I sound. Two trips aren't printed yet, want me to print them?", fr: "Bonjour ! Voici ma voix. Deux tournées ne sont pas encore imprimées, je les imprime ?",
    hi: "नमस्ते! मेरी आवाज़ ऐसी है। दो ट्रिप अभी प्रिंट नहीं हुई हैं, क्या मैं उन्हें प्रिंट कर दूँ?", ar: "مرحبا! هذا صوتي. رحلتان لم تُطبعا بعد، هل أطبعهما؟",
    de: "Hallo! So klinge ich. Zwei Touren sind noch nicht gedruckt, soll ich sie drucken?", es: "¡Hola! Así sueno. Dos viajes aún no están impresos, ¿los imprimo?", zh: "你好！这是我的声音。还有两趟行程没有打印，要我打印吗？" };
VOICE.testVoice = function () {
    ($('vs-language') ? VOICE.saveSettings() : Promise.resolve()).then(function () {
        var was = VOICE.on; VOICE.since = 0; VOICE.hush();
        VOICE.speakText(VOICE.SAMPLE[VOICE.lang().split('-')[0]] || VOICE.SAMPLE.en);
        VOICE.on = was;
    });
};
/** One-click free natural voice (Piper). From the settings dialog or the voice bar; msg(text) shows progress. */
VOICE.installPiper = function (msg) {
    var inDialog = !!$('vs-language');
    msg = typeof msg === 'function' ? msg : function (t) { var m = $('vs-msg'); if (m) m.textContent = t; };
    var b = $('vs-piper') || $('vc-piper'); if (b) b.disabled = true;
    (inDialog ? VOICE.saveSettings() : Promise.resolve()).then(function () { return hub('POST', '/voice/piper/install', {}); }).then(function poll(st) {
        if (st.state === 'done' || (st.installed && st.state !== 'running')) {
            msg('The natural voice is ready.');
            if (!inDialog) setTimeout(function () { VOICE.status(null); }, 4000);
            var vb = $('vc-piper'); if (vb) vb.remove();
            VOICE.loadCfg(true).then(function () { if (inDialog) VOICE.settings(); setTimeout(VOICE.testVoice, inDialog ? 400 : 0); });
            return;
        }
        if (st.state === 'error') { msg('Setup failed: ' + st.error); if (b) b.disabled = false; return; }
        msg('Setting up the natural voice (first time ~70 MB)… ' + String(st.log || '').trim().split('\n').pop().slice(0, 90));
        return new Promise(function (r) { setTimeout(r, 3000); }).then(function () { return hub('GET', '/voice/piper'); }).then(poll);
    }).catch(function (e) { msg('Setup failed: ' + e + ' — update the AI Hub (server button › Update).'); if (b) b.disabled = false; });
};
/** Voice bar: offer the free natural voice when only the robotic Windows voices are in use. */
VOICE.offerNatural = function () {
    if (VOICE.tts() !== 'browser' || $('vc-piper') || !$('voice-ov')) return;
    var btn = document.createElement('button'); btn.id = 'vc-piper'; btn.className = 'btn sm vc-natural';
    btn.title = 'Sounds robotic? Install a free natural voice that runs on this PC';
    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Natural voice (free)';
    var have = VOICE.cfg && VOICE.cfg.piper && VOICE.cfg.piper.installed;
    if (have) { btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Use the natural voice'; btn.title = 'The free natural voice is installed — switch to it'; }
    btn.onclick = have ? function () {
        hub('PUT', '/voice/config', { voice: { tts: { provider: 'piper' } } }).then(function (c) { VOICE.cfg = c; btn.remove(); VOICE.speakText('This is my natural voice.'); })
            .catch(function (e) { VOICE.status(esc('Could not switch: ' + e)); });
    } : function () { VOICE.installPiper(function (t) { VOICE.status(esc(t)); }); };
    document.querySelector('#voice-ov .vc-btns').prepend(btn);
};
VOICE.saveSettings = function () {
    var keys = Array.prototype.filter.call(document.querySelectorAll('[data-key]'), function (i) { return i.value.trim(); });
    var g = document.querySelector('#vs-gender button.on'), snd = document.querySelector('input[name=vs-sound]:checked');
    return Promise.all(keys.map(function (i) { return hub('PUT', '/voice/secret', { name: i.dataset.key, value: i.value.trim() }); })).then(function () {
        return hub('PUT', '/voice/config', { voice: {
            language: $('vs-language').value, gender: g ? g.dataset.g : 'female',
            tts: { provider: snd ? snd.value : 'browser', voice: $('vs-voice').value.trim(), speed: parseFloat($('vs-speed').value), model: $('vs-model').value.trim(), engine: $('vs-engine').value },
            stt: { provider: $('vs-stt').value, language: $('vs-language').value.split('-')[0], whisper_size: $('vs-wsize').value },
            azure_region: $('vs-region').value.trim(), aws_provider: $('vs-aws').value.trim() } });
    }).then(function (c) { VOICE.cfg = c; return c; }).catch(function (e) { toast(String(e), 'err'); throw e; });
};

// ── wiring: speak live events, mark voice turns, the mic button ──
(function () {
    var orig = AG.renderEvent;
    AG.renderEvent = function (e) { var fresh = e && e.seq > AG.seq; orig(e); if (fresh) VOICE.onEvent(e); };
    document.addEventListener('keydown', function (e) { if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v') && $('btn-voice')) { e.preventDefault(); VOICE.toggle(); } });
})();
