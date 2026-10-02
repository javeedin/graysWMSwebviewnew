/* AI Agent — camera in the chat. A live preview card; YOU press the shutter (the agent never takes a picture by
   itself and the camera is off whenever the card is closed). Photos go to the model as images, so it can read text,
   tables, labels, delivery notes, invoices, handwriting, damaged goods … and turn them into text, a table
   (format_result / render) or a document.
   Two ways in: the camera button next to the paperclip (photos become attachments of your next message), or the
   agent's `camera` tool ("take a picture of this delivery note") - the card opens, the photos go back as its result. */

var CAM = window.CAM = { stream: null, shots: [], facing: 'environment', deviceId: null, mirror: false };

CAM.MAX_SIDE = 2000;        // long side of a photo sent to the model (sharp enough for small print)
CAM.MAX_SHOTS = 6;

/** Opens the camera card. opts: {title, reason, pages, onDone(shots|null)} */
CAM.open = function (opts) {
    opts = opts || {};
    if (CAM.card) { toast('The camera is already open', 'err'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('No camera access in this window', 'err'); if (opts.onDone) opts.onDone(null); return; }
    CAM.shots = []; CAM.opts = opts;
    var el = CAM.card = document.createElement('div'); el.className = 'card cam-card';
    el.innerHTML = '<h4><i class="fa-solid fa-camera"></i> ' + esc(opts.title || 'Camera') + (opts.reason ? ' <span class="muted sm">— ' + esc(opts.reason) + '</span>' : '') +
        '<span class="grow"></span><select class="cam-dev" title="Camera"></select></h4>' +
        '<div class="cam-stage"><video class="cam-video" autoplay playsinline muted></video><div class="cam-flash"></div>' +
        '<div class="cam-guide"></div><div class="cam-msg">Starting the camera…</div>' +
        // controls sit ON the preview so they are always visible
        '<div class="cam-bar"><span class="cam-left"><button class="cam-ib cam-mirror" title="Mirror the preview"><i class="fa-solid fa-left-right"></i></button>' +
        '<label class="cam-ib cam-file" title="Use a picture file instead"><i class="fa-regular fa-image"></i><input type="file" accept="image/*" multiple hidden></label></span>' +
        '<button class="cam-snap" title="' + (opts.fromTool ? 'Take the picture (Space)' : 'Take the picture and paste it into your message (Space)') + '"><span></span></button>' +
        '<span class="cam-right">' + (opts.fromTool ? '<button class="cam-ib cam-use" disabled title="Send the photos to the agent"><i class="fa-solid fa-check"></i> <span class="cam-n">0</span></button>' : '') +
        '<button class="cam-ib cam-cancel" title="Close the camera"><i class="fa-solid fa-xmark"></i></button></span></div></div>' +
        '<div class="cam-shots"></div>';
    $('cards').appendChild(el);
    if (opts.fromTool) AG.pendingCards++;
    el.querySelector('.cam-snap').onclick = CAM.snap;
    if (el.querySelector('.cam-use')) el.querySelector('.cam-use').onclick = function () { CAM.close(true); };
    el.querySelector('.cam-cancel').onclick = function () { CAM.close(false); };
    el.querySelector('.cam-mirror').onclick = function () { CAM.mirror = !CAM.mirror; el.querySelector('.cam-video').classList.toggle('mirror', CAM.mirror); };
    el.querySelector('.cam-dev').onchange = function () { CAM.deviceId = this.value; CAM.start(); };
    el.querySelector('.cam-file input').onchange = function () { Array.prototype.forEach.call(this.files, CAM.addFile); this.value = ''; };
    CAM.keys = function (e) { if (e.code === 'Space' && CAM.card && document.activeElement && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); CAM.snap(); } };
    document.addEventListener('keydown', CAM.keys);
    el.scrollIntoView({ block: 'nearest' });
    CAM.start();
};

CAM.start = function () {
    CAM.stopStream();
    var v = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    if (CAM.deviceId) v.deviceId = { exact: CAM.deviceId }; else v.facingMode = { ideal: CAM.facing };
    navigator.mediaDevices.getUserMedia({ video: v, audio: false }).then(function (stream) {
        if (!CAM.card) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        CAM.stream = stream;
        var vid = CAM.card.querySelector('.cam-video'); vid.srcObject = stream;
        var s = stream.getVideoTracks()[0].getSettings();
        CAM.card.querySelector('.cam-msg').textContent = (s.width ? s.width + '×' + s.height + ' · ' : '') + 'Hold the page flat and fill the frame, then press the round button (or Space).';
        return navigator.mediaDevices.enumerateDevices().then(function (ds) {
            var cams = ds.filter(function (d) { return d.kind === 'videoinput'; }), sel = CAM.card.querySelector('.cam-dev');
            sel.innerHTML = cams.map(function (d, i) { return '<option value="' + esc(d.deviceId) + '"' + (d.deviceId === s.deviceId ? ' selected' : '') + '>' + esc(d.label || 'Camera ' + (i + 1)) + '</option>'; }).join('');
            sel.hidden = cams.length < 2;
        });
    }).catch(function (e) {
        if (!CAM.card) return;
        var m = e && e.name === 'NotAllowedError' ? 'Camera access is blocked — Settings › Privacy & security › Camera › allow desktop apps (and check the camera shutter key).'
            : e && e.name === 'NotReadableError' ? 'The camera is in use by another app (Teams, Zoom, Camera) — close it and press Retry.'
                : e && e.name === 'NotFoundError' ? 'No camera found.' : 'Camera: ' + (e && e.message || e);
        CAM.card.querySelector('.cam-msg').innerHTML = esc(m) + ' <button class="btn sm" onclick="CAM.start()">Retry</button> — or use <b>File</b>.';
    });
};
CAM.stopStream = function () { if (CAM.stream) CAM.stream.getTracks().forEach(function (t) { t.stop(); }); CAM.stream = null; };

/** Grabs the current frame at full resolution → JPEG (long side ≤ MAX_SIDE). */
CAM.snap = function () {
    if (!CAM.card) return;
    var vid = CAM.card.querySelector('.cam-video');
    if (!CAM.stream || !vid.videoWidth) { toast('The camera is not ready yet', 'err'); return; }
    if (CAM.shots.length >= CAM.MAX_SHOTS) { toast('At most ' + CAM.MAX_SHOTS + ' photos at a time', 'err'); return; }
    var f = Math.min(1, CAM.MAX_SIDE / Math.max(vid.videoWidth, vid.videoHeight));
    var cv = document.createElement('canvas'); cv.width = Math.round(vid.videoWidth * f); cv.height = Math.round(vid.videoHeight * f);
    var g = cv.getContext('2d');
    if (CAM.mirror) { g.translate(cv.width, 0); g.scale(-1, 1); }
    g.drawImage(vid, 0, 0, cv.width, cv.height);
    CAM.push(cv.toDataURL('image/jpeg', 0.9));
    var fl = CAM.card.querySelector('.cam-flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
    if (!CAM.opts.fromTool) setTimeout(function () { CAM.close(true); }, 250);   // camera button: paste into the message at once
};
CAM.addFile = function (file) {
    if (!/^image\//.test(file.type)) return;
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
        var f = Math.min(1, CAM.MAX_SIDE / Math.max(img.width, img.height)), cv = document.createElement('canvas');
        cv.width = Math.round(img.width * f); cv.height = Math.round(img.height * f);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        CAM.push(cv.toDataURL('image/jpeg', 0.9)); URL.revokeObjectURL(url);
        if (!CAM.opts.fromTool) CAM.close(true);
    };
    img.src = url;
};
CAM.push = function (dataUrl) {
    CAM.shots.push({ name: 'photo-' + new Date().toISOString().slice(11, 19).replace(/:/g, '') + '-' + (CAM.shots.length + 1) + '.jpg', media_type: 'image/jpeg', data: dataUrl.split(',')[1], url: dataUrl });
    CAM.renderShots();
};
CAM.renderShots = function () {
    var box = CAM.card.querySelector('.cam-shots');
    box.innerHTML = CAM.shots.map(function (s, i) { return '<span class="cam-shot"><img src="' + s.url + '" alt=""><button title="Remove" data-i="' + i + '">×</button></span>'; }).join('');
    box.querySelectorAll('button').forEach(function (b) { b.onclick = function () { CAM.shots.splice(+b.dataset.i, 1); CAM.renderShots(); }; });
    var n = CAM.card.querySelector('.cam-n'); if (n) n.textContent = CAM.shots.length;
    var u = CAM.card.querySelector('.cam-use'); if (u) u.disabled = !CAM.shots.length;
};

/** Closes the card and turns the camera OFF. use = hand the photos over. */
CAM.close = function (use) {
    var opts = CAM.opts || {}, shots = use ? CAM.shots.map(function (s) { return { name: s.name, media_type: s.media_type, data: s.data }; }) : null;
    CAM.stopStream();
    document.removeEventListener('keydown', CAM.keys);
    if (CAM.card) { CAM.card.remove(); CAM.card = null; }
    if (opts.fromTool) AG.pendingCards--;
    CAM.shots = []; CAM.opts = null;
    if (opts.onDone) opts.onDone(shots && shots.length ? shots : null);
};

// ── the camera button: photos become attachments of your next message, with quick actions ──
CAM.forMessage = function () {
    CAM.open({ title: 'Camera', reason: 'press the round button — the photo goes into your message', onDone: function (shots) {
        if (!shots) return;
        shots.forEach(function (s) { AG.files.push(s); });
        AG.renderFiles();
        var inp = $('input');
        if (!inp.value.trim()) CAM.quick();
        inp.focus();
    } });
};
CAM.QUICK = [
    ['fa-font', 'Read the text', 'Read all the text in the photo exactly as written (keep the layout as far as possible).'],
    ['fa-table', 'Table → results', 'Turn the table / list in the photo into rows: show them as a table in the results panel (render or a formatted result) so I can copy it to Excel.'],
    ['fa-file-invoice', 'Delivery note / invoice', 'This is a delivery note or invoice: pull out supplier / customer, document number, date, lines (item, description, qty, price) and totals, check the totals add up, and match it to our orders or trips if you can.'],
    ['fa-magnifying-glass', 'What is this?', 'What is in this photo? Describe what matters for the warehouse (product, label, codes, damage).']
];
CAM.quick = function () {
    var bar = document.createElement('div'); bar.className = 'cam-quick';
    bar.innerHTML = '<span class="muted sm">Photo attached — </span>' + CAM.QUICK.map(function (q, i) { return '<button class="btn sm" data-i="' + i + '"><i class="fa-solid ' + q[0] + '"></i> ' + q[1] + '</button>'; }).join('') +
        '<button class="icon" title="Close"><i class="fa-solid fa-xmark"></i></button>';
    $('cards').appendChild(bar);
    bar.querySelectorAll('[data-i]').forEach(function (b) { b.onclick = function () { $('input').value = CAM.QUICK[+b.dataset.i][2]; bar.remove(); AG.send(); }; });
    bar.querySelector('.icon').onclick = function () { bar.remove(); };
    setTimeout(function () { if (bar.parentNode && !AG.files.length) bar.remove(); }, 120000);
};

// ── the agent's camera tool: opens the card, the user takes the picture(s), they go back to the model ──
AG.tool('camera', function (inp) {
    return new Promise(function (resolve) {
        CAM.open({ title: inp.title || 'Take a picture', reason: inp.reason, fromTool: true, onDone: function (shots) {
            if (!shots) { AG.pill('You closed the camera'); resolve({ ok: false, content: 'The user closed the camera without taking a picture.' }); return; }
            AG.pill('📷 ' + shots.length + ' photo(s) sent to the agent');
            // the first photo travels as the tool result's image; more pages are attached to the same result
            var first = shots[0];
            resolve({ ok: true, content: shots.length + ' photo(s) taken by the user' + (inp.reason ? ' for: ' + inp.reason : '') + '. The image' + (shots.length > 1 ? 's follow' : ' follows') + '.',
                attachment: first, attachments: shots.slice(1) });
        } });
    });
});
