/* AI Agent — the Vision tab.
   Photo · OpenCV: images (files, paste, drop, chat photos, live snapshots) → fixed OpenCV operations run by the host
   (classes/VisionCv.cs, Python + opencv-contrib + zxing-cpp): scan a document, read barcodes / QR of every format, count
   objects, compare before / after, find a label or logo, enhance, edges, info, resize, read text (lot / expiry fields),
   measure with a printed ArUco marker (volume from a top + side photo), colour / shade check (ΔE), shelf panorama with empty
   spaces, fill level, stereo depth, and make QR / barcode labels (no picture needed). Results: annotated images, numbers,
   tables to the results panel, images to the chat.
   Watch · video & CCTV (vision-watch.js): a webcam, RTSP camera or video file watched by its own process on the PC.
   Live · gestures & skeleton: the camera with Google MediaPipe Tasks Vision running IN the page (WASM; nothing leaves the
   PC): hand skeletons + gestures (GestureRecognizer), body pose (33 points) with joint angles, face mesh — drawn as a HUD.
   Gestures held ~0.7 s trigger actions you choose (snap to the tray, scan barcodes, send to chat); the posture coach
   watches lifting (back bend vs knee bend) and warns on a stooped lift.
   YOLO (Ultralytics on PyTorch, optional add-on): object detection with names (80 COCO classes), segmentation, pose, or your
   own trained .pt model (models folder) — on photos and live on the camera (frames go to the host's warm worker, ~50 ms).
   The agent's `vision` tool runs the same operations on photos in the conversation. */

var VISION = window.VISION = { tray: [], mode: 'photo', status: null, op: 'barcodes', params: {}, live: { on: false } };

VISION.MP_VER = '0.10.14';
VISION.MP_BASES = ['https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + VISION.MP_VER, 'https://unpkg.com/@mediapipe/tasks-vision@' + VISION.MP_VER];
VISION.MODELS = {
    gesture: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
    pose: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
};

VISION.YOLO_OFFICIAL = [['yolo11n', 'YOLO11n · objects (fast)'], ['yolo11s', 'YOLO11s · objects (better)'], ['yolo11m', 'YOLO11m · objects (best, slower)'],
    ['yolo11n-seg', 'YOLO11n-seg · object outlines'], ['yolo11n-pose', 'YOLO11n-pose · people skeletons'], ['yolo11n-cls', 'YOLO11n-cls · what is it (1000 classes)']];
VISION.modelOpts = function () {
    var have = ((VISION.status || {}).models || []).map(function (m) { return m.name; }), off = VISION.YOLO_OFFICIAL.map(function (x) { return x[0]; });
    return VISION.YOLO_OFFICIAL.map(function (x) { return [x[0], x[1] + (have.indexOf(x[0]) < 0 ? ' — downloads once' : '')]; })
        .concat(have.filter(function (n) { return off.indexOf(n) < 0; }).map(function (n) { return [n, n + ' · your model']; }));
};
VISION.OPS = [
    { id: 'detect', icon: 'fa-crosshairs', label: 'Detect (YOLO)', hint: 'Finds and names objects: people, vehicles, bottles, boxes … or your own trained model', need: 1, yolo: true,
        params: [{ k: 'model', label: 'Model', type: 'select', opts: function () { return VISION.modelOpts(); }, def: 'yolo11n' },
            { k: 'conf', label: 'Confidence ≥', type: 'number', def: 0.25, step: 0.05 }, { k: 'classes', label: 'Only (e.g. person, truck)', type: 'text' }] },
    { id: 'similar', icon: 'fa-clone', label: 'Count anything', hint: 'Type what to count (people, chickens, cars …) or drag a box around ONE example, then Run. Click a mark to remove it, an empty spot to add one.', need: 1,
        params: [{ k: 'tolerance', label: 'Looseness (0 strict … 100 loose)', type: 'number', def: 50, step: 10 }] },
    { id: 'document', icon: 'fa-file-image', label: 'Scan document', hint: 'Finds the page, flattens the perspective, cleans it up', need: 1,
        params: [{ k: 'mode', label: 'Output', type: 'select', opts: [['color', 'Colour'], ['gray', 'Gray'], ['bw', 'Black & white']] }] },
    { id: 'barcodes', icon: 'fa-barcode', label: 'Read barcodes', hint: 'QR, Code 128 / 39, EAN, UPC, DataMatrix, PDF417 … (faded, inverted or shiny QR codes get a second, tougher try)', need: 1, params: [] },
    { id: 'ocr', icon: 'fa-font', label: 'Read text', hint: 'All text on a label or document, plus lot / batch, expiry (with days left), made date, weight, serial, GTIN', need: 1, params: [] },
    { id: 'measure', icon: 'fa-ruler-combined', label: 'Measure', hint: 'Put a printed marker flat next to the object. Photo from above = length × width; add a side photo (2nd image) for height and volume.', need: 1, box: 'the object (optional)',
        params: [{ k: 'marker_cm', label: 'Marker size (cm)', type: 'number', def: 5, step: 0.5 }], extra: '<button class="btn sm" onclick="VISION.markerSheet()"><i class="fa-solid fa-print"></i> Print marker sheet</button>' },
    { id: 'color', icon: 'fa-palette', label: 'Colour check', hint: 'Is the shade right? Compare with a reference colour (#RRGGBB) or a 2nd photo of the approved sample (CIEDE2000 ΔE).', need: 1, box: 'the area to check (optional)',
        params: [{ k: 'reference', label: 'Reference #RRGGBB', type: 'text' }, { k: 'tolerance', label: 'Accept ΔE ≤', type: 'number', def: 5, step: 0.5 }] },
    { id: 'stitch', icon: 'fa-images', label: 'Shelf panorama', hint: 'Join 2–6 overlapping photos of a long shelf / rack (left to right) and mark possible empty spaces', need: 2,
        params: [{ k: 'gaps', label: 'Find empty spaces', type: 'check', def: true }] },
    { id: 'level', icon: 'fa-glass-water', label: 'Fill level', hint: 'How full is a bottle, tank or container — drag a box around the container', need: 1, box: 'the container',
        params: [] },
    { id: 'generate', icon: 'fa-qrcode', label: 'Make labels', hint: 'QR / barcode labels to print — one text per line (locations, pallets, assets). No picture needed.', need: 0,
        params: [{ k: 'format', label: 'Type', type: 'select', opts: [['qr', 'QR code'], ['code128', 'Code 128'], ['datamatrix', 'DataMatrix'], ['ean13', 'EAN-13'], ['ean8', 'EAN-8'], ['upca', 'UPC-A'], ['code39', 'Code 39'], ['pdf417', 'PDF417'], ['itf', 'ITF']], def: 'qr' },
            { k: 'caption', label: 'Text under the code', type: 'check', def: true }, { k: 'items', label: 'Texts (one per line)', type: 'area', def: 'LOC-A01-01\nLOC-A01-02\nLOC-A01-03' }] },
    { id: 'depth', icon: 'fa-cubes', label: 'Depth (stereo)', hint: 'Two photos side by side (same height, a few cm apart, left first) → what is near / far', need: 2,
        params: [{ k: 'focal_px', label: 'Focal length px (optional)', type: 'number', step: 10 }, { k: 'baseline_cm', label: 'Camera distance cm (optional)', type: 'number', step: 0.5 }] },
    { id: 'count', icon: 'fa-boxes-stacked', label: 'Count objects', hint: 'Boxes, bottles, coins, cartons … touching ones are split', need: 1,
        params: [{ k: 'method', label: 'Method', type: 'select', opts: [['auto', 'Auto (split touching)'], ['contours', 'Separate objects'], ['circles', 'Round things (tops, coins)']] },
            { k: 'min_area_pct', label: 'Ignore smaller than % of image', type: 'number', def: 0.05, step: 0.01 }] },
    { id: 'compare', icon: 'fa-code-compare', label: 'Compare', hint: 'Before / after: what changed (aligns the photos first)', need: 2,
        params: [{ k: 'threshold', label: 'Sensitivity (lower = more)', type: 'number', def: 35, step: 5 }, { k: 'align', label: 'Align the photos', type: 'check', def: true }] },
    { id: 'find', icon: 'fa-magnifying-glass-location', label: 'Find', hint: 'First image = scene, second = the thing to find (label, logo, product)', need: 2,
        params: [{ k: 'threshold', label: 'Match ≥', type: 'number', def: 0.75, step: 0.05 }] },
    { id: 'enhance', icon: 'fa-wand-magic-sparkles', label: 'Enhance', hint: 'White balance, contrast, denoise, sharpen, straighten', need: 1,
        params: [{ k: 'steps', label: 'Steps', type: 'multi', opts: [['white_balance', 'White balance'], ['contrast', 'Contrast'], ['denoise', 'Denoise'], ['sharpen', 'Sharpen'], ['deskew', 'Straighten'], ['gray', 'Gray'], ['rotate90', 'Rotate 90°']], def: ['white_balance', 'contrast', 'sharpen', 'deskew'] }] },
    { id: 'info', icon: 'fa-circle-info', label: 'Photo check', hint: 'Size, sharp or blurry, light, main colours', need: 1, params: [] },
    { id: 'edges', icon: 'fa-draw-polygon', label: 'Edges', hint: 'Outline drawing (Canny)', need: 1, params: [] },
    { id: 'resize', icon: 'fa-compress', label: 'Resize', hint: 'Smaller copy for e-mail', need: 1, params: [{ k: 'max_side', label: 'Longest side (px)', type: 'number', def: 1600, step: 100 }] }
];

// ── tab ──
VISION.start = function () {
    if (VISION.started) return;
    VISION.started = true;
    $('visionws').innerHTML =
        '<div class="vz-head"><div class="seg" id="vz-mode"><button data-m="photo" class="on"><i class="fa-regular fa-image"></i> Photo · OpenCV</button>' +
        '<button data-m="live"><i class="fa-solid fa-hand-sparkles"></i> Live · gestures &amp; skeleton</button>' +
        '<button data-m="watch"><i class="fa-solid fa-video"></i> Watch · video &amp; CCTV</button></div><span class="grow"></span><span id="vz-status" class="sm"></span></div>' +
        '<div id="vz-photo" class="vz-photo"><aside class="vz-tray"><div class="row"><b class="grow">Images</b>' +
        '<label class="btn sm" title="Add picture files"><i class="fa-solid fa-plus"></i> Files<input type="file" accept="image/*" multiple hidden id="vz-file"></label>' +
        '<button class="btn sm" onclick="VISION.fromChat()" title="Photos and pictures from this conversation"><i class="fa-regular fa-comments"></i> From chat</button>' +
        '<button class="btn sm" onclick="VISION.setMode(\'live\')" title="Take photos with the camera (Live → Snap)"><i class="fa-solid fa-camera"></i></button></div>' +
        '<div class="vz-drop" id="vz-drop">Drop or paste (Ctrl+V) pictures here</div><div id="vz-list" class="vz-list"></div></aside>' +
        '<section class="vz-main"><div class="vz-ops" id="vz-ops"></div><div class="vz-params" id="vz-params"></div><div class="vz-result" id="vz-result">' +
        '<p class="muted sm">Pick images on the left (click to select, the order counts for Compare / Find), choose what to do, press Run.</p></div></section></div>' +
        '<div id="vz-live" class="vz-livewrap" hidden></div><div id="vz-watch" class="vz-watchwrap" hidden></div>';
    $('vz-mode').querySelectorAll('button').forEach(function (b) { b.onclick = function () { VISION.setMode(b.dataset.m); }; });
    $('vz-file').onchange = function () { Array.prototype.forEach.call(this.files, VISION.addFile); this.value = ''; };
    var drop = $('vz-drop');
    drop.ondragover = function (e) { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = function () { drop.classList.remove('over'); };
    drop.ondrop = function (e) { e.preventDefault(); drop.classList.remove('over'); Array.prototype.forEach.call(e.dataTransfer.files, VISION.addFile); };
    document.addEventListener('paste', function (e) {
        if ($('visionws').hidden || VISION.mode !== 'photo') return;
        Array.prototype.forEach.call((e.clipboardData && e.clipboardData.files) || [], VISION.addFile);
    });
    VISION.renderOps(); VISION.renderTray(); VISION.checkStatus();
};
VISION.setMode = function (m) {
    VISION.mode = m;
    $('vz-mode').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.m === m); });
    $('vz-photo').hidden = m !== 'photo'; $('vz-live').hidden = m !== 'live'; $('vz-watch').hidden = m !== 'watch';
    if (m === 'live') VISION.liveUi(); else VISION.liveStop();
    if (m === 'watch' && VISION.watchUi) VISION.watchUi();
};

// ── OpenCV status / setup ──
VISION.cmd = function (a, ms) { return host(a.action, a, ms || 60000); };
VISION.checkStatus = function (fresh) {
    return VISION.cmd({ action: 'visionStatus', fresh: !!fresh }).then(function (d) {
        VISION.status = d.status || {}; VISION.admin = !!d.admin;
        var s = VISION.status, setup = s.setup || {}, el = $('vz-status');
        if (setup.State === 'running') {
            el.innerHTML = '<span class="tag b-warn"><i class="fa-solid fa-circle-notch fa-spin"></i> Setting up OpenCV…</span> <span class="muted">' + esc(String(setup.Log || '').trim().split('\n').pop()) + '</span>';
            clearTimeout(VISION._st); VISION._st = setTimeout(function () { VISION.checkStatus(true); }, 3000);
        } else if (s.ready) {
            var ys = s.yoloSetup || {};
            el.innerHTML = '<span class="tag b-ok">OpenCV ' + esc(s.opencv) + '</span>' + (s.zxing ? ' <span class="tag b-ok">all barcode types</span>' : ' <span class="tag b-warn" title="Only QR / EAN / UPC">basic barcodes</span>') +
                (s.ocr ? ' <span class="tag b-ok">text reading</span>' : VISION.admin ? ' <button class="btn sm" onclick="VISION.setup()" title="Adds the text reader (Read text) and the newest barcode reader (~30 MB)"><i class="fa-solid fa-plus"></i> Text reading</button>' : '') +
                (ys.State === 'running' ? ' <span class="tag b-warn"><i class="fa-solid fa-circle-notch fa-spin"></i> adding YOLO…</span> <span class="muted">' + esc(String(ys.Log || '').trim().split('\n').pop()) + '</span>'
                    : s.yolo ? ' <span class="tag b-ok" title="PyTorch ' + esc(s.torch || '') + '">YOLO ' + esc(s.yolo) + '</span>' + (VISION.admin ? ' <button class="btn sm" onclick="VISION.modelsFolder()" title="Drop your own trained .pt models here"><i class="fa-regular fa-folder-open"></i> Models</button>' : '')
                    : (ys.State === 'error' ? ' <span class="tag b-bad" title="' + esc(ys.Error || '') + '">YOLO setup failed</span>' : '') + (VISION.admin ? ' <button class="btn sm" onclick="VISION.setup(true)" title="Object detection with names, segmentation, pose, custom models (~600 MB)"><i class="fa-solid fa-plus"></i> YOLO + PyTorch</button>' : ''));
            if (ys.State === 'running') { clearTimeout(VISION._st); VISION._st = setTimeout(function () { VISION.checkStatus(true); }, 4000); }
            if (VISION.started) VISION.renderOps();
        } else {
            el.innerHTML = (setup.State === 'error' ? '<span class="tag b-bad" title="' + esc(setup.Error || '') + '">setup failed</span> ' : '') +
                '<span class="tag b-warn">OpenCV not set up on this PC</span> ' +
                (VISION.admin ? '<button class="btn sm primary" onclick="VISION.setup()"><i class="fa-solid fa-download"></i> Set up (~130 MB, once)</button>' : '<span class="muted">an AI admin sets it up once per PC</span>') +
                ' <span class="muted">Live mode works without it.</span>';
        }
    }).catch(function (e) { $('vz-status').innerHTML = '<span class="tag b-bad">' + esc(e) + '</span>'; });
};
VISION.setup = function (yolo) {
    if (!confirm(yolo ? 'Add YOLO (Ultralytics) on PyTorch (CPU) to this PC\'s Python? About 600 MB from PyPI, a few minutes.\n\nLicence: Ultralytics YOLO is AGPL-3.0 — using it inside a commercial product you distribute needs an Ultralytics Enterprise licence (see docs/AI_AGENT.md).'
        : 'Install Python (if missing), OpenCV, the zxing-cpp barcode reader and the rapidocr text reader for your Windows user on this PC? (~130 MB from python.org / PyPI)')) return;
    VISION.cmd({ action: 'visionSetup', yolo: !!yolo }).then(function (d) { if (d.ok === false) throw d.error; setTimeout(function () { VISION.checkStatus(true); }, 800); }).catch(function (e) { toast(String(e), 'err'); });
};

VISION.modelsFolder = function () { VISION.cmd({ action: 'visionModelsFolder' }).then(function (d) { if (d.ok === false) throw d.error; toast('Drop .pt models in ' + d.folder + ', then reopen the Vision tab', 'ok'); }).catch(function (e) { toast(String(e), 'err'); }); };

// ── image tray ──
VISION.add = function (name, dataUrl, from) {
    if (!/^data:image\//.test(dataUrl || '')) return;
    if (VISION.tray.some(function (t) { return t.url === dataUrl; })) return;
    VISION.tray.push({ id: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name || 'image.png', url: dataUrl, from: from || '' });
    if (VISION.tray.length > 24) VISION.tray.shift();
    if (VISION.started) VISION.renderTray();
};
VISION.addFile = function (f) {
    if (!/^image\//.test(f.type) || f.size > 20e6) { toast('Not a picture or larger than 20 MB: ' + f.name, 'err'); return; }
    var r = new FileReader(); r.onload = function () { VISION.add(f.name, r.result, 'file'); VISION.select(VISION.tray[VISION.tray.length - 1].id, true); }; r.readAsDataURL(f);
};
VISION.fromChat = function () {
    var n = 0;
    Object.keys(AG.imgCache || {}).forEach(function (k) { var before = VISION.tray.length; VISION.add(k, AG.imgCache[k], 'chat'); n += VISION.tray.length - before; });
    toast(n ? n + ' picture(s) from the chat' : 'No pictures in this conversation yet (attach one, or use the camera)', n ? 'ok' : 'err');
};
VISION.sel = [];
VISION.select = function (id, only) {
    var i = VISION.sel.indexOf(id);
    if (only) VISION.sel = [id]; else if (i >= 0) VISION.sel.splice(i, 1); else VISION.sel.push(id);
    VISION.renderTray();
};
VISION.renderTray = function () {
    if (VISION.op === 'similar' && VISION.started) setTimeout(function () { if (!VISION.sim || VISION.sim.id !== VISION.sel[0]) VISION.simPicker(); }, 0);
    else if (VISION.started && VISION.opDef().box) setTimeout(function () { if (!VISION.bp || VISION.bp.id !== (VISION.simImage() || {}).id) VISION.boxPicker(); }, 0);
    VISION.sel = VISION.sel.filter(function (id) { return VISION.tray.some(function (t) { return t.id === id; }); });
    $('vz-list').innerHTML = VISION.tray.length ? VISION.tray.slice().reverse().map(function (t) {
        var k = VISION.sel.indexOf(t.id);
        return '<div class="vz-thumb' + (k >= 0 ? ' on' : '') + '" data-id="' + t.id + '" title="' + esc(t.name) + '"><img src="' + t.url + '" alt="">' +
            (k >= 0 ? '<span class="vz-n">' + (k + 1) + '</span>' : '') + '<span class="vz-name">' + esc(t.name) + '</span>' +
            '<button class="vz-x" data-x="' + t.id + '" title="Remove">×</button></div>';
    }).join('') : '<p class="muted sm">No images yet.</p>';
    $('vz-list').querySelectorAll('.vz-thumb').forEach(function (el) {
        el.onclick = function (e) { if (e.target.dataset.x) { VISION.tray = VISION.tray.filter(function (t) { return t.id !== e.target.dataset.x; }); VISION.renderTray(); return; } VISION.select(el.dataset.id, !(e.ctrlKey || e.shiftKey || VISION.opDef().need > 1)); };
        el.ondblclick = function () { AG.zoomImg && AG.zoomImg(el.querySelector('img').src); };
    });
};

// ── operations ──
VISION.opDef = function () { return VISION.OPS.filter(function (o) { return o.id === VISION.op; })[0]; };
VISION.renderOps = function () {
    $('vz-ops').innerHTML = VISION.OPS.map(function (o) {
        return '<button class="vz-op' + (o.id === VISION.op ? ' on' : '') + '" data-op="' + o.id + '" title="' + esc(o.hint) + '"><i class="fa-solid ' + o.icon + '"></i><span>' + esc(o.label) + '</span></button>';
    }).join('');
    $('vz-ops').querySelectorAll('.vz-op').forEach(function (b) { b.onclick = function () { VISION.op = b.dataset.op; VISION.renderOps(); if (VISION.op === 'similar') VISION.simPicker(); else if (VISION.opDef().box) VISION.boxPicker(); }; });
    var o = VISION.opDef(), p = VISION.params[o.id] = VISION.params[o.id] || {};
    var noYolo = o.yolo && !(VISION.status || {}).yolo;
    $('vz-params').innerHTML = '<span class="muted sm">' + esc(o.hint) + (o.need > 1 ? ' — select ' + o.need + ' images (Ctrl+click), in order.' : '') + '</span>' +
        (noYolo ? '<span class="tag b-warn">YOLO is not set up on this PC</span>' + (VISION.admin ? ' <button class="btn sm" onclick="VISION.setup(true)"><i class="fa-solid fa-download"></i> Add YOLO + PyTorch</button>' : '') : '') +
        o.params.map(function (f) {
            var v = p[f.k] != null ? p[f.k] : f.def;
            if (f.type === 'text') return '<label class="sm">' + esc(f.label) + ' <input type="text" data-k="' + f.k + '" value="' + esc(v || '') + '" style="width:150px"></label>';
            if (f.type === 'area') return '<label class="sm vz-area">' + esc(f.label) + '<textarea data-k="' + f.k + '" rows="4">' + esc(v || '') + '</textarea></label>';
            if (f.type === 'select') return '<label class="sm">' + esc(f.label) + ' <select data-k="' + f.k + '">' + (typeof f.opts === 'function' ? f.opts() : f.opts).map(function (x) { return '<option value="' + x[0] + '"' + (v === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></label>';
            if (f.type === 'number') return '<label class="sm">' + esc(f.label) + ' <input type="number" data-k="' + f.k + '" value="' + (v != null ? v : '') + '" step="' + (f.step || 1) + '" style="width:80px"></label>';
            if (f.type === 'check') return '<label class="sm"><input type="checkbox" data-k="' + f.k + '"' + (v ? ' checked' : '') + '> ' + esc(f.label) + '</label>';
            return '<span class="sm">' + f.opts.map(function (x) { return '<label><input type="checkbox" data-m="' + f.k + '" value="' + x[0] + '"' + ((v || []).indexOf(x[0]) >= 0 ? ' checked' : '') + '> ' + esc(x[1]) + '</label>'; }).join(' ') + '</span>';
        }).join('') + (o.extra || '') + (o.box ? '<span class="sm" id="vz-boxinfo">' + VISION.boxText(o) + '</span>' : '') +
        '<span class="grow"></span><button class="btn primary" id="vz-run" onclick="VISION.run()"><i class="fa-solid fa-play"></i> Run</button>';
    $('vz-params').querySelectorAll('[data-k]').forEach(function (el) { el.onchange = function () { p[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value; }; });
    $('vz-params').querySelectorAll('[data-m]').forEach(function (el) {
        el.onchange = function () { p[el.dataset.m] = Array.prototype.map.call($('vz-params').querySelectorAll('[data-m="' + el.dataset.m + '"]:checked'), function (x) { return x.value; }); };
    });
};
VISION.paramsFor = function (o) {
    var p = Object.assign({}, VISION.params[o.id] || {});
    o.params.forEach(function (f) { if (p[f.k] == null && f.def != null) p[f.k] = f.def; });
    return p;
};
/** Runs one operation through the host. images: [{name, url}] → {ok, result, images:[{name, media_type, data, note}]} */
VISION.exec = function (op, imgs, params, via) {
    return VISION.cmd({ action: 'visionRun', op: op, params: params || {}, via: via || 'tab',
        images: imgs.map(function (t) { return { name: t.name, data: t.url.split(',')[1] }; }) }, 300000);
};
VISION.run = function () {
    if (VISION.op === 'similar') { VISION.simRun(); return; }
    var o = VISION.opDef(), imgs = VISION.sel.map(function (id) { return VISION.tray.filter(function (t) { return t.id === id; })[0]; }).filter(Boolean);
    if (!imgs.length && VISION.tray.length && o.need) imgs = [VISION.tray[VISION.tray.length - 1]];
    if (!o.need) imgs = [];
    if (imgs.length < o.need) { toast(o.label + ' needs ' + o.need + ' images — Ctrl+click to select them in order', 'err'); return; }
    var btn = $('vz-run'); btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Working…';
    $('vz-result').innerHTML = '<p class="muted sm"><i class="fa-solid fa-circle-notch fa-spin"></i> ' + esc(o.label) + ' on ' + imgs.length + ' image(s)…</p>';
    VISION.exec(o.id, imgs, VISION.paramsFor(o)).then(function (d) { VISION.last = d; VISION.renderResult(o, d); })
        .catch(function (e) { $('vz-result').innerHTML = '<div class="callout bad"><div class="co-t">Failed</div>' + esc(e) + '</div>'; })
        .then(function () { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-play"></i> Run'; });
};

// ── Count anything: type what (YOLO knows 80 kinds: people, birds = chickens, cars, bottles …) or drag a box around one
//    example (anything else: keys, cartons, tops); then correct the marks by clicking ──
VISION.COCO = ['person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
    'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard',
    'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl',
    'banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet',
    'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear',
    'hair drier', 'toothbrush'];
VISION.SYN = { people: 'person', persons: 'person', man: 'person', men: 'person', woman: 'person', women: 'person', worker: 'person', workers: 'person', staff: 'person', child: 'person', children: 'person', kid: 'person', kids: 'person', face: 'person', faces: 'person',
    chicken: 'bird', chickens: 'bird', hen: 'bird', hens: 'bird', duck: 'bird', ducks: 'bird', pigeon: 'bird', pigeons: 'bird', poultry: 'bird', birds: 'bird',
    lorry: 'truck', lorries: 'truck', van: 'truck', vans: 'truck', cattle: 'cow', cows: 'cow', goat: 'sheep', goats: 'sheep', phone: 'cell phone', phones: 'cell phone', mobile: 'cell phone', mobiles: 'cell phone',
    tv: 'tv', television: 'tv', monitor: 'tv', monitors: 'tv', screen: 'tv', screens: 'tv', table: 'dining table', tables: 'dining table', plant: 'potted plant', plants: 'potted plant', sofa: 'couch',
    motorbike: 'motorcycle', motorbikes: 'motorcycle', bike: 'bicycle', bikes: 'bicycle', glass: 'wine glass', mug: 'cup', mugs: 'cup', bag: 'handbag', bags: 'handbag', ball: 'sports ball', balls: 'sports ball' };
/** "chickens and people" → ['bird', 'person'] (COCO names YOLO knows), or [] */
VISION.cocoOf = function (text) {
    var out = [], t = ' ' + String(text || '').toLowerCase().replace(/[^a-z ]/g, ' ') + ' ';
    VISION.COCO.forEach(function (c) { if (t.indexOf(' ' + c + ' ') >= 0 || t.indexOf(' ' + c + 's ') >= 0 || t.indexOf(' ' + c + 'es ') >= 0) out.push(c); });
    t.split(/[ ,]+/).forEach(function (w) { if (VISION.SYN[w]) out.push(VISION.SYN[w]); });
    return out.filter(function (c, i) { return out.indexOf(c) === i; });
};
VISION.simWhat = function () {
    var S = VISION.sim, t = VISION.simImage(), what = ($('vz-what') || {}).value || '';
    if (!S || !t) return;
    var classes = VISION.cocoOf(what);
    if (!classes.length) { toast('"' + what + '" is not one of the 80 things YOLO knows — drag a box around one of them on the picture instead', 'err'); return; }
    if (!(VISION.status || {}).yolo) { toast('YOLO is not set up on this PC (Photo · OpenCV › YOLO + PyTorch) — drag a box around one example instead', 'err'); return; }
    var have = ((VISION.status || {}).models || []).map(function (m) { return m.name; });
    var btn = $('vz-whatbtn'); btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Counting…';
    // bigger input size finds small things in a crowd (chickens in a shed, people far away)
    VISION.exec('detect', [{ name: t.name, url: t.url }], { model: have.indexOf('yolo11s') >= 0 ? 'yolo11s' : 'yolo11n', classes: classes.join(', '), conf: 0.25, imgsz: 1280 }).then(function (d) {
        if (!d.ok) { toast(d.error || ((d.result || {}).error) || 'Failed', 'err'); return; }
        VISION.last = d;
        var objs = (((d.result || {}).images || [])[0] || {}).objects || [];
        S.box = null; S.what = classes.join(', '); S.removed = {}; S.added = [];
        S.marks = objs.filter(function (o) { return o.w != null; }).map(function (o, i) { return { n: i + 1, x: o.x, y: o.y, w: o.w, h: o.h, by: o.label, score: o.conf }; });
        if (!S.marks.length) toast('None found — try a sharper or closer photo, or drag a box around one', 'err');
        VISION.simDraw();
    }).catch(function (e) { toast(String(e), 'err'); })
        .then(function () { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Count them'; });
};
VISION.simImage = function () {
    var id = VISION.sel[0] || (VISION.tray.length ? VISION.tray[VISION.tray.length - 1].id : null);
    return VISION.tray.filter(function (t) { return t.id === id; })[0];
};
VISION.simPicker = function () {
    var t = VISION.simImage();
    if (!t) { $('vz-result').innerHTML = '<p class="muted sm">Add a picture on the left first (file, paste, From chat or the camera).</p>'; VISION.sim = null; return; }
    var img = new Image();
    img.onload = function () {
        VISION.sim = { id: t.id, name: t.name, img: img, box: null, marks: [], removed: {}, added: [] };
        $('vz-result').innerHTML = '<div class="vz-rhead"><b><i class="fa-solid fa-clone"></i> Count anything</b></div>' +
            '<div class="vz-what"><input type="text" id="vz-what" placeholder="What to count? people, chickens, cars, bottles … (YOLO)">' +
            '<button class="btn sm primary" id="vz-whatbtn" onclick="VISION.simWhat()"><i class="fa-solid fa-wand-magic-sparkles"></i> Count them</button>' +
            '<span class="muted sm">— or drag a box around ONE example on the picture (a key, a carton, a bottle top) and press Run.</span></div>' +
            '<div class="vz-simwrap"><canvas id="vz-sim" class="vz-simcv"></canvas></div><div id="vz-simbar" class="vz-simbar"></div>';
        VISION.simDraw(); VISION.simWire();
        $('vz-what').onkeydown = function (e) { if (e.key === 'Enter') VISION.simWhat(); };
    };
    img.src = t.url;
};
VISION.simScale = function () { var S = VISION.sim, maxW = Math.min(980, ($('vz-result').clientWidth || 900) - 24); return Math.min(1, maxW / S.img.width, 620 / S.img.height); };
VISION.simCount = function () { var S = VISION.sim; return S.marks.filter(function (m) { return !S.removed[m.n]; }).length + S.added.length; };
VISION.simDraw = function () {
    var S = VISION.sim, cv = $('vz-sim'); if (!S || !cv) return;
    var k = VISION.simScale(); cv.width = Math.round(S.img.width * k); cv.height = Math.round(S.img.height * k);
    var g = cv.getContext('2d'); g.drawImage(S.img, 0, 0, cv.width, cv.height);
    var lw = Math.max(2, cv.width / 400);
    g.font = '700 ' + Math.max(11, cv.width / 70) + 'px Segoe UI, sans-serif';
    var tag = function (txt, x, y, col) { var w = g.measureText(txt).width + 8, h = Math.max(15, cv.width / 55); g.fillStyle = col; g.fillRect(x, y - h, w, h); g.fillStyle = '#fff'; g.fillText(txt, x + 4, y - 4); };
    var n = 0;
    S.marks.forEach(function (m) {
        var x = m.x * k, y = m.y * k, w = m.w * k, h = m.h * k;
        if (S.removed[m.n]) { g.strokeStyle = '#dc2626'; g.lineWidth = lw; g.setLineDash([5, 4]); g.strokeRect(x, y, w, h); g.setLineDash([]); g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + h); g.moveTo(x + w, y); g.lineTo(x, y + h); g.stroke(); return; }
        n++; g.strokeStyle = m.by === 'example' ? '#f59e0b' : '#16a34a'; g.lineWidth = lw; g.strokeRect(x, y, w, h); tag(String(n), x, y, '#2563eb');
    });
    S.added.forEach(function (m) { n++; var x = m.x * k, y = m.y * k; g.strokeStyle = '#7c3aed'; g.lineWidth = lw; g.strokeRect(x, y, m.w * k, m.h * k); tag(n + ' +', x, y, '#7c3aed'); });
    if (S.box && !S.marks.length) { g.strokeStyle = '#f59e0b'; g.lineWidth = lw * 1.5; g.setLineDash([6, 4]); g.strokeRect(S.box.x * k, S.box.y * k, S.box.w * k, S.box.h * k); g.setLineDash([]); tag('example', S.box.x * k, S.box.y * k, '#f59e0b'); }
    if (S.drag) { g.strokeStyle = '#f59e0b'; g.lineWidth = lw; g.strokeRect(S.drag.x0, S.drag.y0, S.drag.x1 - S.drag.x0, S.drag.y1 - S.drag.y0); }
    var bar = $('vz-simbar');
    if (bar) bar.innerHTML = S.marks.length
        ? '<div class="vz-big">' + VISION.simCount() + '<span> ' + esc(S.what ? S.what.replace('bird', 'birds / chickens').replace('person', 'people') : 'like the example') + ' · found ' + S.marks.length + (Object.keys(S.removed).length ? ', removed ' + Object.keys(S.removed).length : '') + (S.added.length ? ', added ' + S.added.length : '') + '</span></div>' +
          '<span class="muted sm">Click a mark to remove / restore it, an empty spot to add one.</span><div class="res-acts">' +
          '<button class="btn sm" onclick="VISION.simSave()"><i class="fa-solid fa-download"></i> Save marked picture</button>' +
          '<button class="btn sm" onclick="VISION.simTable()"><i class="fa-solid fa-table"></i> List to the results panel</button>' +
          '<button class="btn sm" onclick="VISION.simChat()"><i class="fa-regular fa-comment"></i> Send to the chat</button>' +
          '<button class="btn sm" onclick="VISION.sim.marks=[];VISION.sim.removed={};VISION.sim.added=[];VISION.simDraw()"><i class="fa-solid fa-rotate-left"></i> New example</button></div>'
        : (S.box ? '<span class="tag b-ok">example marked</span> <span class="muted sm">press Run</span>' : '<span class="muted sm">No example yet — drag a box on the picture.</span>');
};
VISION.simWire = function () {
    var cv = $('vz-sim');
    var pt = function (e) { var r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
    cv.onmousedown = function (e) { var p = pt(e); VISION.sim.drag = { x0: p[0], y0: p[1], x1: p[0], y1: p[1] }; };
    cv.onmousemove = function (e) { var S = VISION.sim; if (!S.drag) return; var p = pt(e); S.drag.x1 = p[0]; S.drag.y1 = p[1]; VISION.simDraw(); };
    cv.onmouseup = function (e) {
        var S = VISION.sim, d = S.drag; S.drag = null; if (!d) return;
        var k = VISION.simScale(), p = pt(e), x = Math.min(d.x0, p[0]) / k, y = Math.min(d.y0, p[1]) / k, w = Math.abs(p[0] - d.x0) / k, h = Math.abs(p[1] - d.y0) / k;
        if (w > 8 && h > 8) { S.box = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }; S.marks = []; S.removed = {}; S.added = []; VISION.simDraw(); return; }
        if (!S.marks.length) return;
        // a click: toggle a found mark, remove an added one, or add a mark of the example's size here
        var cx = p[0] / k, cy = p[1] / k;
        var inBox = function (m) { return cx >= m.x && cx <= m.x + m.w && cy >= m.y && cy <= m.y + m.h; };
        var ai = S.added.findIndex(inBox);
        if (ai >= 0) S.added.splice(ai, 1);
        else {
            var m = S.marks.filter(inBox)[0];
            if (m) { if (S.removed[m.n]) delete S.removed[m.n]; else S.removed[m.n] = 1; }
            else {
                var med = function (k2) { var v = S.marks.map(function (q) { return q[k2]; }).sort(function (a, b) { return a - b; }); return v[Math.floor(v.length / 2)]; };
                var b = S.box || { w: med('w'), h: med('h') };
                S.added.push({ x: cx - b.w / 2, y: cy - b.h / 2, w: b.w, h: b.h });
            }
        }
        VISION.simDraw();
    };
};
VISION.simRun = function () {
    var S = VISION.sim, t = VISION.simImage();
    if (S && !S.box && $('vz-what') && $('vz-what').value.trim()) { VISION.simWhat(); return; }
    if (!S || !t || S.id !== t.id) { VISION.simPicker(); toast('Drag a box around one example first', 'err'); return; }
    if (!S.box) { toast('Drag a box around ONE example on the picture first', 'err'); return; }
    var btn = $('vz-run'); btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Counting…';
    VISION.exec('similar', [{ name: t.name, url: t.url }], Object.assign(VISION.paramsFor(VISION.opDef()), { box: S.box })).then(function (d) {
        if (!d.ok) { toast(d.error || ((d.result || {}).error) || 'Failed', 'err'); return; }
        VISION.last = d;
        S.marks = (((d.result || {}).images || [])[0] || {}).objects || []; S.removed = {}; S.added = []; S.what = null;
        VISION.simDraw();
    }).catch(function (e) { toast(String(e), 'err'); })
        .then(function () { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-play"></i> Run'; });
};
VISION.simCanvasUrl = function () { var k0 = VISION.simScale; VISION.simScale = function () { return 1; }; VISION.simDraw(); var u = $('vz-sim').toDataURL('image/jpeg', 0.9); VISION.simScale = k0; VISION.simDraw(); return u; };
VISION.simSave = function () { var a = document.createElement('a'); a.href = VISION.simCanvasUrl(); a.download = 'count-' + VISION.simCount() + '.jpg'; document.body.appendChild(a); a.click(); a.remove(); };
VISION.simList = function () {
    var S = VISION.sim, rows = [], n = 0;
    S.marks.forEach(function (m) { if (!S.removed[m.n]) rows.push([++n, Math.round(m.x), Math.round(m.y), Math.round(m.w), Math.round(m.h), m.by === 'example' ? 'example' : 'found']); });
    S.added.forEach(function (m) { rows.push([++n, Math.round(m.x), Math.round(m.y), Math.round(m.w), Math.round(m.h), 'added by hand']); });
    return rows;
};
VISION.simTable = function () { if (!AG.pageResult) return; AG.pageResult('Count like this · ' + VISION.sim.name, ['n', 'x', 'y', 'w', 'h', 'how'], VISION.simList()); CODE.showTab('chat'); AG.toggleResults && AG.toggleResults(true, true); };
VISION.simChat = function () {
    var S = VISION.sim, url = VISION.simCanvasUrl();
    AG.files.push({ name: 'count-like-this.jpg', media_type: 'image/jpeg', data: url.split(',')[1] }); AG.renderFiles();
    CODE.showTab('chat');
    $('input').value = 'Counted ' + VISION.simCount() + ' items like the marked example in ' + S.name + ' (found ' + S.marks.length + ', removed ' + Object.keys(S.removed).length + ', added ' + S.added.length + ' by hand). ';
    $('input').focus();
};

// ── area picker (Measure / Colour / Fill level): drag a box on the first selected picture; coordinates in image pixels ──
VISION.boxText = function (o) {
    var b = (VISION.params[o.id] || {}).box;
    return b ? '<span class="tag b-ok">' + esc(o.box.replace(' (optional)', '')) + ' marked</span> <button class="icon" title="Clear" onclick="delete VISION.params[\'' + o.id + '\'].box;VISION.renderOps();VISION.boxPicker()">×</button>'
        : '<span class="muted">Drag a box around ' + esc(o.box) + ' on the picture below</span>';
};
VISION.boxPicker = function () {
    var o = VISION.opDef(), t = VISION.simImage();
    if (!o.box) return;
    if (!t) { $('vz-result').innerHTML = '<p class="muted sm">Add a picture on the left first.</p>'; VISION.bp = null; return; }
    var img = new Image();
    img.onload = function () {
        VISION.bp = { id: t.id, img: img, op: o.id };
        $('vz-result').innerHTML = '<div class="vz-rhead"><b><i class="fa-solid ' + o.icon + '"></i> ' + esc(o.label) + '</b> <span class="muted sm">drag a box around ' + esc(o.box) + ', then Run</span></div>' +
            '<div class="vz-simwrap"><canvas id="vz-bp" class="vz-simcv"></canvas></div>';
        VISION.bpDraw();
        var cv = $('vz-bp'), pt = function (e) { var r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
        cv.onmousedown = function (e) { var p = pt(e); VISION.bp.drag = { x0: p[0], y0: p[1], x1: p[0], y1: p[1] }; };
        cv.onmousemove = function (e) { if (!VISION.bp.drag) return; var p = pt(e); VISION.bp.drag.x1 = p[0]; VISION.bp.drag.y1 = p[1]; VISION.bpDraw(); };
        cv.onmouseup = function () {
            var d = VISION.bp.drag; VISION.bp.drag = null; if (!d) return;
            var k = VISION.bpScale(), w = Math.abs(d.x1 - d.x0) / k, h = Math.abs(d.y1 - d.y0) / k;
            if (w > 6 && h > 6) {
                var p = VISION.params[o.id] = VISION.params[o.id] || {};
                p.box = { x: Math.round(Math.min(d.x0, d.x1) / k), y: Math.round(Math.min(d.y0, d.y1) / k), w: Math.round(w), h: Math.round(h) };
                $('vz-boxinfo').innerHTML = VISION.boxText(o);
            }
            VISION.bpDraw();
        };
    };
    img.src = t.url;
};
VISION.bpScale = function () { var B = VISION.bp, maxW = Math.min(980, ($('vz-result').clientWidth || 900) - 24); return Math.min(1, maxW / B.img.width, 560 / B.img.height); };
VISION.bpDraw = function () {
    var B = VISION.bp, cv = $('vz-bp'); if (!B || !cv) return;
    var k = VISION.bpScale(); cv.width = Math.round(B.img.width * k); cv.height = Math.round(B.img.height * k);
    var g = cv.getContext('2d'); g.drawImage(B.img, 0, 0, cv.width, cv.height);
    var b = (VISION.params[B.op] || {}).box;
    g.lineWidth = Math.max(2, cv.width / 400); g.strokeStyle = '#f59e0b'; g.setLineDash([6, 4]);
    if (b) g.strokeRect(b.x * k, b.y * k, b.w * k, b.h * k);
    if (B.drag) g.strokeRect(B.drag.x0, B.drag.y0, B.drag.x1 - B.drag.x0, B.drag.y1 - B.drag.y0);
    g.setLineDash([]);
};
VISION.markerSheet = function () {
    var cm = +((VISION.params.measure || {}).marker_cm || 5);
    toast('Making the marker sheet…', 'ok');
    VISION.exec('markers', [], { marker_cm: cm }).then(function (d) {
        if (!d.ok) throw d.error || 'failed';
        var im = d.images[0], w = window.open('', '_blank');
        if (!w) { VISION.last = d; VISION.download(0); return; }
        w.document.write('<!doctype html><title>Marker sheet</title><style>@page{size:A4;margin:0}body{margin:0}img{width:210mm;height:297mm;display:block}</style><img src="data:' + im.media_type + ';base64,' + im.data + '" onload="setTimeout(function(){print()},300)">');
        w.document.close();
    }).catch(function (e) { toast(String(e), 'err'); });
};

// ── results ──
VISION.summary = function (r) {
    if (!r) return '';
    var im = r.images || [];
    switch (r.op) {
        case 'barcodes': return im.reduce(function (n, x) { return n + (x.count || 0); }, 0) + ' code(s): ' + im.map(function (x) { return (x.codes || []).map(function (c) { return c.type + ' ' + c.data; }).join(', '); }).filter(Boolean).join(' | ');
        case 'count': return im.map(function (x) { return x.name + ': ' + x.count + ' object(s)'; }).join(', ');
        case 'compare': return 'similarity ' + r.similarity + ' %, ' + r.changed_pct + ' % changed, ' + (r.regions || []).length + ' area(s) — ' + r.verdict;
        case 'find': return r.count + ' match(es)';
        case 'similar': return r.count + ' like the example';
        case 'detect': return Object.keys(r.counts || {}).length ? Object.keys(r.counts).map(function (k) { return r.counts[k] + ' × ' + k; }).join(', ') + ' (' + r.model + ')' : 'nothing found (' + r.model + ')';
        case 'document': return im.map(function (x) { return x.name + ': ' + (x.page_found ? 'page found' : 'no page edges, whole image'); }).join(', ');
        case 'info': return im.map(function (x) { return x.name + ': ' + x.width + '×' + x.height + ', ' + x.sharp_verdict + ', ' + x.exposure; }).join(', ');
        case 'measure': return im.map(function (x) { return x.name + ': ' + x.length_cm + ' × ' + x.width_cm + ' cm'; }).join(', ') + (r.box_cm ? ' → box ' + r.box_cm.join(' × ') + ' cm, ' + r.volume_m3 + ' m³' : '');
        case 'ocr': return im.map(function (x) { var f = x.fields || {}; return x.name + ': ' + x.lines + ' line(s)' + Object.keys(f).map(function (k) { return ', ' + k + ' ' + f[k]; }).join(''); }).join(' | ');
        case 'color': return r.delta_e != null ? 'ΔE ' + r.delta_e + ' — ' + r.verdict + ' (' + r.meaning + ', ' + r.lighter_darker + ')' : 'colour ' + ((im[0] || {}).hex || '');
        case 'stitch': return r.joined + ' photos joined, ' + (r.gaps || []).length + ' possible empty space(s)';
        case 'generate': return r.labels + ' ' + r.format + ' label(s)';
        case 'level': return im.map(function (x) { return x.name + ': ' + x.fill_pct + ' % full (' + x.confidence + ')'; }).join(', ');
        case 'depth': return r.valid_pct + ' % of the picture matched' + (r.median_distance_cm ? ', median distance ' + r.median_distance_cm + ' cm' : '');
        default: return (r.outputs || []).map(function (x) { return x.note; }).join(', ');
    }
};
VISION.renderResult = function (o, d) {
    var r = d.result || {}, html = '';
    if (!d.ok) { $('vz-result').innerHTML = '<div class="callout bad"><div class="co-t">' + esc(o.label) + ' failed</div>' + esc(d.error || r.error || 'Failed') + '</div>'; return; }
    html += '<div class="vz-rhead"><b><i class="fa-solid ' + o.icon + '"></i> ' + esc(o.label) + '</b> <span class="muted sm">' + (d.ms / 1000).toFixed(1) + ' s · OpenCV ' + esc(r.opencv || '') + '</span>' +
        '<span class="grow"></span><button class="btn sm" onclick="VISION.toChat()"><i class="fa-regular fa-comment"></i> Ask the agent about it</button></div>';
    if (r.note) html += '<div class="callout warn">' + esc(r.note) + '</div>';
    if (r.op === 'barcodes') {
        var rows = (r.table || {}).rows || [];
        var hints = (r.images || []).filter(function (x) { return x.hint; }).map(function (x) { return esc(x.name) + ': ' + esc(x.hint); });
        html += '<div class="vz-big">' + rows.length + '<span> code' + (rows.length === 1 ? '' : 's') + '</span></div>' +
            (hints.length && !rows.length ? '<div class="callout warn"><div class="co-t">A barcode is there but cannot be read</div>' + hints.join('<br>') + '<br><span class="muted">Each bar needs about 2 pixels: hold it closer (the barcode about a third of the picture wide), steady, flat and without shine — or use Live › Barcode scanner.</span></div>' : '') + (rows.length ? '<table class="t"><thead><tr><th>Image</th><th>#</th><th>Type</th><th>Data</th></tr></thead><tbody>' +
            rows.map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td>' + x[1] + '</td><td><span class="tag">' + esc(x[2]) + '</span></td><td><b>' + esc(x[3]) + '</b></td></tr>'; }).join('') + '</tbody></table>' +
            '<div class="res-acts"><button class="btn sm" onclick="VISION.toResults()"><i class="fa-solid fa-table"></i> To the results panel</button><button class="btn sm" onclick="VISION.copyCodes()"><i class="fa-regular fa-copy"></i> Copy</button></div>' : '');
    } else if (r.op === 'count') {
        html += (r.images || []).map(function (x) { return '<div class="vz-big">' + x.count + '<span> object' + (x.count === 1 ? '' : 's') + ' · ' + esc(x.name) + '</span></div>'; }).join('') +
            '<div class="res-acts"><button class="btn sm" onclick="VISION.toResults()"><i class="fa-solid fa-table"></i> Objects to the results panel</button></div>';
    } else if (r.op === 'compare') {
        html += '<div class="vz-big">' + r.similarity + '%<span> similar · ' + r.changed_pct + '% changed · ' + (r.regions || []).length + ' area(s)</span></div><span class="tag ' + (r.verdict === 'same' ? 'b-ok' : r.verdict === 'different' ? 'b-bad' : 'b-warn') + '">' + esc(r.verdict) + '</span>' + (r.aligned ? ' <span class="muted sm">photos aligned first</span>' : '');
    } else if (r.op === 'detect') {
        var tot = (r.images || []).reduce(function (n, x) { return n + (x.count || 0); }, 0);
        html += '<div class="vz-big">' + tot + '<span> object' + (tot === 1 ? '' : 's') + ' · ' + esc(r.model || '') + ' (' + esc(r.task || '') + ')</span></div>' +
            Object.keys(r.counts || {}).sort(function (a, b) { return r.counts[b] - r.counts[a]; }).map(function (k) { return '<span class="tag">' + esc(k) + ' × ' + r.counts[k] + '</span>'; }).join(' ') +
            (tot ? '<div class="res-acts"><button class="btn sm" onclick="VISION.toResults()"><i class="fa-solid fa-table"></i> Objects to the results panel</button></div>' : '');
    } else if (r.op === 'find') {
        html += '<div class="vz-big">' + r.count + '<span> match' + (r.count === 1 ? '' : 'es') + '</span></div>';
    } else if (r.op === 'info') {
        html += (r.images || []).map(function (x) {
            return '<div class="vz-info"><b>' + esc(x.name) + '</b> ' + x.width + '×' + x.height + ' <span class="tag ' + (x.sharp_verdict === 'blurry' ? 'b-bad' : 'b-ok') + '">' + esc(x.sharp_verdict) + ' (' + x.sharpness + ')</span> <span class="tag ' + (x.exposure === 'ok' ? 'b-ok' : 'b-warn') + '">light ' + esc(x.exposure) + '</span> ' +
                (x.colors || []).map(function (c) { return '<span class="vz-sw" style="background:' + esc(c.hex) + '" title="' + esc(c.hex) + ' · ' + c.share + '%"></span>'; }).join('') + '</div>';
        }).join('');
    } else if (r.op === 'measure') {
        html += (r.images || []).map(function (x, i) { return '<div class="vz-big">' + x.length_cm + ' × ' + x.width_cm + '<span> cm · ' + (i ? 'side' : 'top') + ' · ' + esc(x.name) + ' · ' + x.area_cm2 + ' cm²</span></div>'; }).join('') +
            (r.box_cm ? '<div class="vz-big">' + r.box_cm.join(' × ') + '<span> cm box · ' + r.volume_m3 + ' m³ (' + r.volume_cm3 + ' cm³)</span></div>' : '<span class="muted sm">Add a side photo (2nd image) for height and volume.</span>');
    } else if (r.op === 'ocr') {
        html += (r.images || []).map(function (x) {
            var f = x.fields || {}, keys = Object.keys(f).filter(function (k) { return k !== 'expired' && k !== 'days_left'; });
            return '<div class="vz-info"><b>' + esc(x.name) + '</b> · ' + x.lines + ' line(s)</div>' +
                (keys.length ? '<div class="vz-fields">' + keys.map(function (k) { return '<span class="tag"><b>' + esc(k.replace('_', ' ')) + '</b> ' + esc(f[k]) + '</span>'; }).join(' ') +
                    (f.days_left != null ? ' <span class="tag ' + (f.expired ? 'b-bad' : f.days_left < 30 ? 'b-warn' : 'b-ok') + '">' + (f.expired ? 'EXPIRED ' + (-f.days_left) + ' days ago' : f.days_left + ' days left') + '</span>' : '') + '</div>' : '') +
                '<pre class="vz-text">' + esc(x.text || '(no text found)') + '</pre>';
        }).join('') + '<div class="res-acts"><button class="btn sm" onclick="VISION.toResults()"><i class="fa-solid fa-table"></i> Lines to the results panel</button>' +
            '<button class="btn sm" onclick="navigator.clipboard.writeText(((VISION.last.result.images||[])[0]||{}).text||\'\');toast(\'Copied\',\'ok\')"><i class="fa-regular fa-copy"></i> Copy text</button></div>';
    } else if (r.op === 'color') {
        var c1 = (r.images || [])[0] || {};
        html += r.delta_e != null ? '<div class="vz-big">ΔE ' + r.delta_e + '<span> · accept ≤ ' + r.tolerance + ' · ' + esc(r.meaning) + ' · sample is ' + esc(r.lighter_darker) + '</span></div><span class="tag ' + (r.verdict === 'match' ? 'b-ok' : 'b-bad') + '">' + esc(r.verdict) + '</span> ' : '';
        html += '<div class="vz-info"><span class="vz-sw" style="background:' + esc(c1.hex) + '"></span> sample ' + esc(c1.hex) + ' (Lab ' + (c1.lab || []).join(', ') + ')' +
            (r.reference ? ' &nbsp; <span class="vz-sw" style="background:' + esc(r.reference.hex) + '"></span> reference ' + esc(r.reference.hex) : ' <span class="muted">— give a reference colour or a 2nd photo to compare</span>') + '</div>';
    } else if (r.op === 'stitch') {
        html += '<div class="vz-big">' + (r.gaps || []).length + '<span> possible empty space(s) · ' + r.joined + ' photos joined · ' + r.width + '×' + r.height + (r.method ? ' (side by side)' : '') + '</span></div>';
    } else if (r.op === 'generate') {
        html += '<div class="vz-big">' + r.labels + '<span> ' + esc(r.format) + ' label(s) · ' + r.on_sheet + ' on the A4 sheet</span></div>' +
            '<div class="res-acts"><button class="btn sm primary" onclick="VISION.printSheet()"><i class="fa-solid fa-print"></i> Print the sheet</button></div>';
    } else if (r.op === 'level') {
        html += (r.images || []).map(function (x) { return '<div class="vz-big">' + x.fill_pct + '%<span> full · ' + esc(x.name) + ' · level line ' + esc(x.confidence) + '</span></div>'; }).join('');
    } else if (r.op === 'depth') {
        html += '<div class="vz-big">' + r.valid_pct + '%<span> matched · ' + r.near_pct + '% near' + (r.median_distance_cm ? ' · median ' + r.median_distance_cm + ' cm' : '') + '</span></div>';
    } else if (r.op === 'document') {
        html += (r.images || []).map(function (x) { return '<div class="vz-info"><b>' + esc(x.name) + '</b> ' + (x.page_found ? '<span class="tag b-ok">page found</span>' : '<span class="tag b-warn">no page edges — whole image used</span>') + ' ' + x.width + '×' + x.height + '</div>'; }).join('');
    }
    html += '<div class="vz-gallery">' + (d.images || []).map(function (im, i) {
        return '<figure><img src="data:' + im.media_type + ';base64,' + im.data + '" alt="" onclick="AG.zoomImg && AG.zoomImg(this.src)"><figcaption>' + esc(im.note || im.name) +
            '<span class="grow"></span><button class="icon" title="Add to the images (use it in another step)" onclick="VISION.outToTray(' + i + ')"><i class="fa-solid fa-arrow-left"></i></button>' +
            '<button class="icon" title="Download" onclick="VISION.download(' + i + ')"><i class="fa-solid fa-download"></i></button></figcaption></figure>';
    }).join('') + '</div>';
    $('vz-result').innerHTML = html;
};
VISION.printSheet = function () {
    var im = (VISION.last.images || []).filter(function (x) { return /sheet/.test(x.name); })[0]; if (!im) return;
    var w = window.open('', '_blank'); if (!w) return;
    w.document.write('<!doctype html><title>Labels</title><style>@page{size:A4;margin:0}body{margin:0}img{width:210mm;display:block}</style><img src="data:' + im.media_type + ';base64,' + im.data + '" onload="setTimeout(function(){print()},300)">');
    w.document.close();
};
VISION.outToTray = function (i) { var im = VISION.last.images[i]; VISION.add(im.name, 'data:' + im.media_type + ';base64,' + im.data, 'result'); VISION.select(VISION.tray[VISION.tray.length - 1].id, true); };
VISION.download = function (i) {
    var im = VISION.last.images[i], a = document.createElement('a');
    a.href = 'data:' + im.media_type + ';base64,' + im.data; a.download = im.name; document.body.appendChild(a); a.click(); a.remove();
};
VISION.tableOf = function (r) {
    if (r.op === 'barcodes') return { title: 'Barcodes', columns: r.table.columns, rows: r.table.rows };
    if (r.op === 'similar') return { title: 'Count like this', columns: ['n', 'x', 'y', 'w', 'h', 'score', 'by'], rows: (((r.images || [])[0] || {}).objects || []).map(function (o) { return [o.n, o.x, o.y, o.w, o.h, o.score, o.by]; }) };
    if (r.op === 'detect' && r.table) return { title: 'Objects (' + r.model + ')', columns: r.table.columns, rows: r.table.rows };
    if (r.op === 'ocr' && r.table) return { title: 'Text read', columns: r.table.columns, rows: r.table.rows };
    if (r.op === 'measure') return { title: 'Measured', columns: ['image', 'length_cm', 'width_cm', 'area_cm2', 'markers'], rows: (r.images || []).map(function (x) { return [x.name, x.length_cm, x.width_cm, x.area_cm2, x.markers]; }) };
    if (r.op === 'count') {
        var rows = [];
        (r.images || []).forEach(function (im) { (im.objects || []).forEach(function (o, i) { rows.push([im.name, i + 1, o.x, o.y, o.w, o.h, o.area]); }); });
        return { title: 'Counted objects', columns: ['image', 'n', 'x', 'y', 'w', 'h', 'area'], rows: rows };
    }
    return null;
};
VISION.toResults = function () {
    var t = VISION.last && VISION.tableOf(VISION.last.result || {}); if (!t || !AG.pageResult) return;
    AG.pageResult(t.title, t.columns, t.rows);
    CODE.showTab('chat'); AG.toggleResults && AG.toggleResults(true, true);
};
VISION.copyCodes = function () {
    var rows = ((VISION.last.result || {}).table || {}).rows || [];
    navigator.clipboard.writeText(rows.map(function (x) { return x[3]; }).join('\n')).then(function () { toast('Copied ' + rows.length + ' code(s)', 'ok'); });
};
VISION.toChat = function () {
    var d = VISION.last; if (!d) return;
    (d.images || []).slice(0, 3).forEach(function (im) { AG.files.push({ name: im.name, media_type: im.media_type, data: im.data }); });
    AG.renderFiles();
    CODE.showTab('chat');
    $('input').value = 'Vision result (' + (d.result || {}).op + '): ' + VISION.summary(d.result) + '\n\n';
    $('input').focus();
};

// ═════════════════════ Live: MediaPipe in the page ═════════════════════
VISION.GESTURES = [['Thumb_Up', '👍 Thumb up'], ['Victory', '✌️ Victory'], ['ILoveYou', '🤟 I love you'], ['Pointing_Up', '☝️ Pointing up'], ['Open_Palm', '🖐 Open palm'], ['Closed_Fist', '✊ Fist'], ['Thumb_Down', '👎 Thumb down']];
VISION.ACTIONS = [['', '— nothing —'], ['snap', 'Take a photo (to the images)'], ['scan', 'Scan barcodes now'], ['yolo', 'Objects on / off (YOLO)'], ['chat', 'Send a photo to the chat'], ['voice', 'Voice mode on / off']];
VISION.DEFAULT_MAP = { Thumb_Up: 'snap', Victory: 'scan', ILoveYou: 'chat' };   // pausing is the Pause button only, never a gesture
VISION.ls = function (k, d) { try { var v = localStorage.getItem('aiagent.vision.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
VISION.lsSet = function (k, v) { try { localStorage.setItem('aiagent.vision.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } };

VISION.liveUi = function () {
    var L = VISION.live;
    if (L.ui) return;
    L.ui = true;
    L.opt = Object.assign({ hands: true, pose: true, face: false, hud: 'scifi', bg: 'camera', mirror: true, coach: false, yolo: false, yoloModel: 'yolo11n', scan: false }, VISION.ls('opt', {}));
    L.map = Object.assign({}, VISION.DEFAULT_MAP, VISION.ls('map', {}));
    Object.keys(L.map).forEach(function (k) { if (L.map[k] === 'pause') delete L.map[k]; });   // older saved maps
    var o = L.opt;
    $('vz-live').innerHTML =
        '<div class="vz-stage" id="vz-stage"><video id="vz-video" playsinline muted></video><canvas id="vz-canvas"></canvas>' +
        '<div class="vz-panel" id="vz-panel"></div><div class="vz-gest" id="vz-gest"></div><div class="vz-alert" id="vz-alert" hidden></div>' +
        '<div class="vz-idle" id="vz-idle"><i class="fa-solid fa-hand-sparkles"></i><div>Hands, gestures, body skeleton and face mesh — live, on this PC.</div>' +
        '<button class="btn primary" onclick="VISION.liveStart()"><i class="fa-solid fa-video"></i> Start camera</button><div class="muted sm">The tracking runs in this window (Google MediaPipe); no picture leaves the PC unless you send one.</div></div></div>' +
        '<aside class="vz-lside"><div class="row"><button class="btn primary sm" id="vz-lbtn" onclick="VISION.liveToggle()"><i class="fa-solid fa-video"></i> Start</button>' +
        '<button class="btn sm" onclick="VISION.snap(\'snap\')" title="Photo to the images (Photo mode)"><i class="fa-solid fa-camera"></i> Snap</button>' +
        '<button class="btn sm" id="vz-pbtn" onclick="VISION.setPaused(!VISION.live.paused)" title="Pause / resume the tracking"><i class="fa-solid fa-pause"></i> Pause</button>' +
        '<select id="vz-dev" class="grow" title="Camera"></select></div>' +
        '<div class="side-h">Track</div>' +
        [['scan', 'Barcode scanner (continuous)'], ['hands', 'Hands + gestures'], ['pose', 'Body skeleton'], ['face', 'Face mesh'], ['yolo', 'Objects (YOLO)'], ['coach', 'Posture coach (safe lifting)'], ['mirror', 'Mirror']].map(function (x) {
            return '<label class="vz-chk"><input type="checkbox" data-o="' + x[0] + '"' + (o[x[0]] ? ' checked' : '') + '> ' + x[1] + '</label>';
        }).join('') +
        '<label class="sm">YOLO model <select id="vz-ym">' + VISION.modelOpts().filter(function (x) { return !/-cls$/.test(x[0]); }).map(function (x) { return '<option value="' + x[0] + '"' + (o.yoloModel === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></label>' +
        '<label class="sm" title="Black = only the face mesh and skeleton are shown — your picture is hidden (also in Snap / chat photos)">Background <select id="vz-bg">' +
        [['camera', 'Camera picture'], ['dim', 'Dimmed camera'], ['black', 'Black — mesh & skeleton only']].map(function (x) { return '<option value="' + x[0] + '"' + (o.bg === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
        '<label class="sm">Style <select id="vz-hud"><option value="scifi"' + (o.hud === 'scifi' ? ' selected' : '') + '>Sci-fi HUD</option><option value="clean"' + (o.hud === 'clean' ? ' selected' : '') + '>Clean</option></select></label>' +
        '<div class="side-h">Gesture → action <span class="muted">(hold ~0.7 s)</span></div><div id="vz-map"></div>' +
        '<div class="side-h">Scanned codes <span class="muted" id="vz-scn"></span></div><div id="vz-scans" class="vz-scans"></div>' +
        '<div class="row"><button class="btn sm" onclick="VISION.scansCopy()"><i class="fa-regular fa-copy"></i> Copy</button><button class="btn sm" onclick="VISION.scansResults()"><i class="fa-solid fa-table"></i> Results</button><button class="btn sm" onclick="VISION.scans=[];VISION.renderScans()">Clear</button></div>' +
        '<div class="side-h">Events</div><div id="vz-log" class="vz-log"></div></aside>';
    $('vz-live').querySelectorAll('[data-o]').forEach(function (el) {
        el.onchange = function () { o[el.dataset.o] = el.checked; VISION.lsSet('opt', o); if (L.on && (el.dataset.o === 'hands' || el.dataset.o === 'pose' || el.dataset.o === 'face' || el.dataset.o === 'coach')) VISION.loadModels(); };
    });
    $('vz-hud').onchange = function () { o.hud = this.value; VISION.lsSet('opt', o); };
    $('vz-bg').onchange = function () {
        o.bg = this.value;
        // black with nothing to draw would be an empty screen: switch the face mesh and the skeleton on
        if (o.bg === 'black' && !o.face && !o.pose) {
            o.face = o.pose = true;
            ['face', 'pose'].forEach(function (k) { var cb = $('vz-live').querySelector('[data-o="' + k + '"]'); if (cb) cb.checked = true; });
            if (L.on) VISION.loadModels();
        }
        VISION.lsSet('opt', o); VISION.applyBg();
    };
    VISION.applyBg();
    $('vz-ym').onchange = function () { o.yoloModel = this.value; VISION.lsSet('opt', o); L.yoloBoxes = null; };
    $('vz-live').querySelector('[data-o="yolo"]').addEventListener('change', function () {
        if (this.checked && !(VISION.status || {}).yolo) { this.checked = false; o.yolo = false; VISION.lsSet('opt', o); toast('YOLO is not set up on this PC — Photo mode › YOLO + PyTorch (AI admin)', 'err'); }
        if (!this.checked) L.yoloBoxes = null;
    });
    $('vz-dev').onchange = function () { L.deviceId = this.value; if (L.on) { VISION.liveStop(true); VISION.liveStart(); } };
    $('vz-map').innerHTML = VISION.GESTURES.map(function (g) {
        return '<div class="vz-maprow"><span>' + g[1] + '</span><select data-g="' + g[0] + '">' + VISION.ACTIONS.map(function (a) { return '<option value="' + a[0] + '"' + ((L.map[g[0]] || '') === a[0] ? ' selected' : '') + '>' + a[1] + '</option>'; }).join('') + '</select></div>';
    }).join('');
    $('vz-map').querySelectorAll('select').forEach(function (s) { s.onchange = function () { L.map[s.dataset.g] = s.value; VISION.lsSet('map', L.map); }; });
};
VISION.applyBg = function () {
    var st = $('vz-stage'), bg = (VISION.live.opt || {}).bg || 'camera'; if (!st) return;
    st.classList.toggle('bg-black', bg === 'black'); st.classList.toggle('bg-dim', bg === 'dim');
};
VISION.log = function (msg, kind) {
    var el = $('vz-log'); if (!el) return;
    var d = document.createElement('div'); d.className = kind || '';
    d.innerHTML = '<span class="muted">' + new Date().toLocaleTimeString() + '</span> ' + esc(msg);
    el.insertBefore(d, el.firstChild);
    while (el.children.length > 60) el.removeChild(el.lastChild);
};
VISION.liveToggle = function () { if (VISION.live.on) VISION.liveStop(); else VISION.liveStart(); };

VISION.mp = function () {
    if (VISION._mp) return VISION._mp;
    var tryBase = function (i) {
        if (i >= VISION.MP_BASES.length) return Promise.reject('MediaPipe could not be loaded (no internet, or cdn.jsdelivr.net / unpkg.com blocked)');
        var base = VISION.MP_BASES[i];
        return import(base + '/vision_bundle.mjs').then(function (m) { return m.FilesetResolver.forVisionTasks(base + '/wasm').then(function (fs) { return { m: m, fs: fs }; }); })
            .catch(function () { return tryBase(i + 1); });
    };
    VISION._mp = tryBase(0).catch(function (e) { VISION._mp = null; throw e; });
    return VISION._mp;
};
VISION.create = function (cls, model, extra) {
    return VISION.mp().then(function (mp) {
        var opts = function (delegate) { return Object.assign({ baseOptions: { modelAssetPath: model, delegate: delegate }, runningMode: 'VIDEO' }, extra || {}); };
        // GPU first; a GPU delegate can hang (no WebGL / blocked driver) instead of failing, so give it 15 s, then the CPU
        if (VISION.cpuOnly) return mp.m[cls].createFromOptions(mp.fs, opts('CPU'));
        var gpu = mp.m[cls].createFromOptions(mp.fs, opts('GPU'));
        var limit = new Promise(function (_, rej) { setTimeout(function () { rej('GPU timeout'); }, 15000); });
        return Promise.race([gpu, limit]).catch(function (e) {
            VISION.cpuOnly = true; VISION.log('GPU not usable (' + (e && e.message ? e.message : e) + ') — tracking on the CPU');
            return mp.m[cls].createFromOptions(mp.fs, opts('CPU'));
        });
    });
};
VISION.loadModels = function () {
    var L = VISION.live, o = L.opt, jobs = [];
    var need = function (key, cls, model, extra) {
        if (!o[key] && !(key === 'pose' && o.coach)) return;
        if (L[key] || L['loading_' + key]) return;
        L['loading_' + key] = true; VISION.log('Loading ' + key + ' model…');
        jobs.push(VISION.create(cls, model, extra).then(function (t) { L[key] = t; VISION.log(key + ' ready', 'ok'); })
            .catch(function (e) { VISION.log(key + ': ' + e, 'bad'); toast(String(e), 'err'); }).then(function () { L['loading_' + key] = false; }));
    };
    need('hands', 'GestureRecognizer', VISION.MODELS.gesture, { numHands: 2 });
    need('pose', 'PoseLandmarker', VISION.MODELS.pose, { numPoses: 1 });
    need('face', 'FaceLandmarker', VISION.MODELS.face, { numFaces: 1 });
    // the skeleton connection lists come from MediaPipe — only when one of its models is used (the barcode scanner and YOLO
    // work without MediaPipe, e.g. when its CDN cannot be reached)
    if (!(o.hands || o.pose || o.face || o.coach)) return Promise.all(jobs);
    return Promise.all(jobs).then(function () { return VISION.mp(); }).then(function (mp) { L.C = { hand: mp.m.GestureRecognizer.HAND_CONNECTIONS || mp.m.HandLandmarker.HAND_CONNECTIONS, pose: mp.m.PoseLandmarker.POSE_CONNECTIONS, face: mp.m.FaceLandmarker.FACE_LANDMARKS_TESSELATION, oval: mp.m.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL }; })
        .catch(function (e) { L.mpFailed = true; VISION.log('Hand / body tracking not available: ' + e + ' — the barcode scanner and YOLO still work', 'bad'); });
};
VISION.liveStart = function () {
    var L = VISION.live;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('No camera access in this window', 'err'); return; }
    $('vz-idle').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><div>Starting the camera and loading the tracking models (first time ~20 MB)…</div>';
    // full HD when the camera has it: barcodes need pixels (≥ 2 per bar)
    navigator.mediaDevices.getUserMedia({ video: L.deviceId ? { deviceId: { exact: L.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
        .then(function (stream) {
            L.stream = stream; L.on = true;
            var v = $('vz-video'); v.srcObject = stream; v.play();
            $('vz-lbtn').innerHTML = '<i class="fa-solid fa-stop"></i> Stop';
            navigator.mediaDevices.enumerateDevices().then(function (ds) {
                var cams = ds.filter(function (d) { return d.kind === 'videoinput'; }), cur = stream.getVideoTracks()[0].getSettings().deviceId;
                $('vz-dev').innerHTML = cams.map(function (c, i) { return '<option value="' + esc(c.deviceId) + '"' + (c.deviceId === cur ? ' selected' : '') + '>' + esc(c.label || 'Camera ' + (i + 1)) + '</option>'; }).join('');
            });
            VISION.log('Camera on');
            return VISION.loadModels();
        }).then(function () {
            if (!L.on) return;
            $('vz-idle').hidden = true;
            if (L.paused) VISION.setPaused(false);
            L.fps = 0; L.frames = 0; L.t0 = performance.now(); L.gest = {}; L.coach = { state: 'up', lifts: 0, risky: 0 };
            cancelAnimationFrame(L.raf); L.raf = requestAnimationFrame(VISION.frame);
        }).catch(function (e) {
            $('vz-idle').innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><div>' + esc(e && e.message ? e.message : e) + '</div><button class="btn primary" onclick="VISION.liveStart()">Try again</button>' +
                '<div class="muted sm">Camera blocked? Windows Settings › Privacy &amp; security › Camera (desktop apps). Models need internet the first time.</div>';
            VISION.liveStop(true);
        });
};
VISION.liveStop = function (keepUi) {
    var L = VISION.live;
    cancelAnimationFrame(L.raf);
    if (L.stream) { L.stream.getTracks().forEach(function (t) { t.stop(); }); L.stream = null; }
    if (L.on) VISION.log('Camera off');
    L.on = false;
    if ($('vz-lbtn')) $('vz-lbtn').innerHTML = '<i class="fa-solid fa-video"></i> Start';
    if (!keepUi && $('vz-idle')) { $('vz-idle').hidden = false; $('vz-idle').innerHTML = '<i class="fa-solid fa-hand-sparkles"></i><div>Camera off.</div><button class="btn primary" onclick="VISION.liveStart()"><i class="fa-solid fa-video"></i> Start camera</button>'; }
};

// geometry helpers
VISION.ang = function (a, b, c) { // angle at b, degrees
    var v1 = [a.x - b.x, a.y - b.y], v2 = [c.x - b.x, c.y - b.y];
    var d = Math.sqrt(v1[0] * v1[0] + v1[1] * v1[1]) * Math.sqrt(v2[0] * v2[0] + v2[1] * v2[1]);
    return d ? Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / d))) * 180 / Math.PI : 0;
};
VISION.dist = function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y); };

VISION.frame = function () {
    var L = VISION.live; if (!L.on) return;
    L.raf = requestAnimationFrame(VISION.frame);
    var v = $('vz-video'), cv = $('vz-canvas');
    if (!v || v.readyState < 2 || !v.videoWidth) return;
    if (cv.width !== v.videoWidth) { cv.width = v.videoWidth; cv.height = v.videoHeight; }
    v.classList.toggle('mirror', !!L.opt.mirror);
    var ts = performance.now(); if (ts <= (L.lastTs || 0)) ts = L.lastTs + 1; L.lastTs = ts;
    var res = { hands: null, pose: null, face: null };
    try { if (L.opt.hands && L.hands) res.hands = L.hands.recognizeForVideo(v, ts); } catch (e) { /* frame skipped */ }
    if (!L.paused) {
        try { if ((L.opt.pose || L.opt.coach) && L.pose) res.pose = L.pose.detectForVideo(v, ts); } catch (e) { /* frame skipped */ }
        try { if (L.opt.face && L.face) res.face = L.face.detectForVideo(v, ts); } catch (e) { /* frame skipped */ }
    }
    L.frames++;
    if (ts - L.t0 > 1000) { L.fps = Math.round(L.frames * 1000 / (ts - L.t0)); L.frames = 0; L.t0 = ts; }
    if (L.opt.yolo && !L.paused) VISION.yoloTick(v);
    if (L.opt.scan && !L.paused) VISION.scanTick(v);
    VISION.draw(cv, res);
    VISION.gestures(res.hands);
    if (L.opt.coach) VISION.coach(res.pose); else $('vz-alert').hidden = true;
    VISION.panel(res);
};

VISION.draw = function (cv, res) {
    var L = VISION.live, g = cv.getContext('2d'), W = cv.width, H = cv.height, sci = L.opt.hud === 'scifi', mir = !!L.opt.mirror;
    var P = function (p) { return [(mir ? 1 - p.x : p.x) * W, p.y * H]; };
    g.clearRect(0, 0, W, H);
    var lw = Math.max(2, W / 400), now = performance.now() / 1000;
    var line = function (a, b, color, width) { var pa = P(a), pb = P(b); g.strokeStyle = color; g.lineWidth = width || lw; g.beginPath(); g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]); g.stroke(); };
    var dot = function (p, r, fill, ring) { var q = P(p); g.beginPath(); g.arc(q[0], q[1], r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); if (ring) { g.strokeStyle = ring; g.lineWidth = lw * 0.7; g.stroke(); } };
    var text = function (s, x, y, color, size) {
        g.font = '600 ' + (size || Math.max(12, W / 70)) + 'px Consolas, monospace'; g.fillStyle = color || '#e0f7ff';
        g.shadowColor = sci ? '#06b6d4' : 'transparent'; g.shadowBlur = sci ? 8 : 0; g.fillText(s, x, y); g.shadowBlur = 0;
    };
    g.lineCap = 'round';
    if (sci) { g.shadowColor = '#22d3ee'; g.shadowBlur = 12; }
    // face mesh
    if (res.face && res.face.faceLandmarks && res.face.faceLandmarks[0] && L.C) {
        var f = res.face.faceLandmarks[0], xs = f.map(function (p) { return P(p)[0]; }), ys = f.map(function (p) { return P(p)[1]; });
        var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
        var black = L.opt.bg === 'black';
        g.globalAlpha = black ? 0.75 : sci ? 0.35 : 0.5;
        (L.C.face || []).forEach(function (c) { line(f[c.start], f[c.end], sci || black ? '#67e8f9' : '#94a3b8', black ? 1.2 : 1); });
        g.globalAlpha = 1;
        if (black) { g.fillStyle = '#e0f7ff'; f.forEach(function (p, i) { if (i % 3 === 0) { var q = P(p); g.fillRect(q[0] - 1, q[1] - 1, 2, 2); } }); }
        (L.C.oval || []).forEach(function (c) { line(f[c.start], f[c.end], sci ? '#22d3ee' : '#64748b', lw * 0.6); });
        var k = (x1 - x0) * 0.18, red = sci ? '#f43f5e' : '#64748b';
        g.strokeStyle = red; g.lineWidth = lw;
        [[x0, y0, 1, 1], [x1, y0, -1, 1], [x1, y1, -1, -1], [x0, y1, 1, -1]].forEach(function (c) { g.beginPath(); g.moveTo(c[0] + c[2] * k, c[1]); g.lineTo(c[0], c[1]); g.lineTo(c[0], c[1] + c[3] * k); g.stroke(); });
        if (sci) text('FACE DETECTED', x0, y0 - 10, '#fda4af');
    }
    // body skeleton with joint angles
    if (res.pose && res.pose.landmarks && res.pose.landmarks[0] && L.C) {
        var b = res.pose.landmarks[0], vis = function (i) { return (b[i].visibility == null ? 1 : b[i].visibility) > 0.5; };
        (L.C.pose || []).forEach(function (c) { if (c.start > 10 && vis(c.start) && vis(c.end)) line(b[c.start], b[c.end], sci ? '#f0fdff' : '#22c55e', lw * 1.2); });
        b.forEach(function (p, i) { if (i > 10 && vis(i)) dot(p, lw * 1.6, sci ? '#22d3ee' : '#16a34a', sci ? '#ffffff' : null); });
        if (L.opt.pose) [[11, 13, 15], [12, 14, 16], [23, 25, 27], [24, 26, 28]].forEach(function (t) {
            if (!vis(t[0]) || !vis(t[1]) || !vis(t[2])) return;
            var q = P(b[t[1]]); text(Math.round(VISION.ang(b[t[0]], b[t[1]], b[t[2]])) + '°', q[0] + 10, q[1] - 6, sci ? '#fde68a' : '#0f172a');
        });
    }
    // hands: skeleton, fingertips, palm ring with the pinch gauge, gesture label
    if (res.hands && res.hands.landmarks && L.C) {
        res.hands.landmarks.forEach(function (h, hi) {
            (L.C.hand || []).forEach(function (c) { line(h[c.start], h[c.end], sci ? '#67e8f9' : '#0ea5e9', lw * 1.3); });
            h.forEach(function (p, i) { dot(p, [4, 8, 12, 16, 20].indexOf(i) >= 0 ? lw * 2.6 : lw * 1.5, '#ffffff', sci ? '#22d3ee' : '#0284c7'); });
            var palm = P(h[9]), size = VISION.dist(h[0], h[9]) * W, pinch = Math.max(0, Math.min(1, (VISION.dist(h[4], h[8]) / (VISION.dist(h[0], h[9]) || 1) - 0.15) / 1.1));
            if (sci) {
                g.save(); g.translate(palm[0], palm[1]);
                g.strokeStyle = 'rgba(34,211,238,.85)'; g.lineWidth = lw;
                for (var k = 0; k < 3; k++) { g.beginPath(); g.arc(0, 0, size * (0.9 + k * 0.18), now * (k % 2 ? -1.2 : 0.9) + k, now * (k % 2 ? -1.2 : 0.9) + k + Math.PI * (0.6 + k * 0.25)); g.stroke(); }
                g.strokeStyle = '#f59e0b'; g.lineWidth = lw * 2.2; g.beginPath(); g.arc(0, 0, size * 1.45, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pinch); g.stroke();
                g.restore();
                text(Math.round(pinch * 100) + '%', palm[0] + size * 1.55, palm[1] - size * 0.9, '#fde68a', Math.max(16, W / 45));
            }
            var gest = res.hands.gestures && res.hands.gestures[hi] && res.hands.gestures[hi][0];
            var hand = res.hands.handedness && res.hands.handedness[hi] && res.hands.handedness[hi][0];
            if (gest && gest.categoryName !== 'None') { var w = P(h[0]); text((gest.categoryName || '').toUpperCase() + ' ' + Math.round(gest.score * 100) + '%', w[0] - 40, w[1] + 34, sci ? '#a5f3fc' : '#0f172a'); }
            if (hand && sci) { var t8 = P(h[8]); text(hand.categoryName === 'Left' ? (mir ? 'R' : 'L') : (mir ? 'L' : 'R'), t8[0] + 10, t8[1] - 10, '#ffffff'); }
        });
    }
    // barcode scanner: read codes (green, with the data), barcodes seen but not readable yet (amber, with the reason)
    if (L.opt.scan && L.scanRes && performance.now() - L.scanRes.at < 1500) {
        g.shadowBlur = 0; g.font = '700 ' + Math.max(14, W / 60) + 'px Consolas, monospace';
        var poly = function (pts, col) { g.strokeStyle = col; g.lineWidth = lw * 1.5; g.beginPath(); pts.forEach(function (p, i) { var x = mir ? W - p[0] : p[0]; if (i) g.lineTo(x, p[1]); else g.moveTo(x, p[1]); }); g.closePath(); g.stroke(); };
        var tagAt = function (t, x, y, col) { var tw = g.measureText(t).width + 10, th = Math.max(18, W / 50); g.fillStyle = col; g.fillRect(x, Math.max(0, y - th), tw, th); g.fillStyle = '#020617'; g.fillText(t, x + 5, Math.max(th - 5, y - 5)); };
        L.scanRes.codes.forEach(function (cd) {
            var pts = cd.points || []; if (!pts.length) return;
            poly(pts, '#22c55e');
            var xs = pts.map(function (p) { return mir ? W - p[0] : p[0]; }), ys = pts.map(function (p) { return p[1]; });
            tagAt(cd.data, Math.min.apply(null, xs), Math.min.apply(null, ys), '#22c55e');
        });
        if (!L.scanRes.codes.length) L.scanRes.regions.forEach(function (r) {
            var x = mir ? W - r.x - r.w : r.x; g.strokeStyle = '#f59e0b'; g.lineWidth = lw * 1.2; g.setLineDash([8, 6]); g.strokeRect(x, r.y, r.w, r.h); g.setLineDash([]);
            tagAt(r.why.split(' — ')[0].toUpperCase(), x, r.y, '#f59e0b');
        });
    }
    // YOLO boxes (coordinates of the 640 px frame → video pixels)
    if (L.opt.yolo && L.yoloBoxes) {
        var yb = L.yoloBoxes, k2 = 1 / yb.s;
        g.shadowBlur = 0;
        yb.objs.forEach(function (o) {
            if (o.w == null) return;
            var x = o.x * k2, y = o.y * k2, w = o.w * k2, h = o.h * k2, col = VISION.colorOf(o.label);
            if (mir) x = W - x - w;
            g.strokeStyle = col; g.lineWidth = lw * 1.2; g.strokeRect(x, y, w, h);
            var t = o.label + ' ' + Math.round(o.conf * 100) + '%';
            g.font = '700 ' + Math.max(12, W / 75) + 'px Consolas, monospace';
            var tw = g.measureText(t).width + 8, th = Math.max(16, W / 60);
            g.fillStyle = col; g.fillRect(x, Math.max(0, y - th), tw, th);
            g.fillStyle = '#020617'; g.fillText(t, x + 4, Math.max(th - 4, y - 4));
        });
        (yb.kp || []).forEach(function (person) {
            person.forEach(function (p) { if (p[0] || p[1]) { g.beginPath(); g.arc(mir ? W - p[0] * k2 : p[0] * k2, p[1] * k2, lw * 1.5, 0, Math.PI * 2); g.fillStyle = '#fde68a'; g.fill(); } });
        });
    }
    g.shadowBlur = 0;
    if (sci) { // corner crosshairs
        g.strokeStyle = 'rgba(34,211,238,.7)'; g.lineWidth = 2;
        [[18, 18], [W - 18, 18], [18, H - 18], [W - 18, H - 18]].forEach(function (c) { g.beginPath(); g.moveTo(c[0] - 10, c[1]); g.lineTo(c[0] + 10, c[1]); g.moveTo(c[0], c[1] - 10); g.lineTo(c[0], c[1] + 10); g.stroke(); });
    }
};

/** Live YOLO: one frame at a time to the host's warm worker (640 px JPEG); the last boxes are drawn until the next answer. */
VISION.yoloTick = function (v) {
    var L = VISION.live, now = performance.now();
    if (L.yoloBusy || now - (L.yoloAt || 0) < 90) return;
    L.yoloBusy = true; L.yoloAt = now;
    var s = Math.min(1, 640 / v.videoWidth), c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    VISION.exec('detect', [{ name: 'frame.jpg', url: c.toDataURL('image/jpeg', 0.8) }], { model: L.opt.yoloModel || 'yolo11n', conf: 0.35, live: true }, 'live').then(function (d) {
        if (!d.ok) { if (!L.yoloErr) { VISION.log('YOLO: ' + (d.error || 'failed'), 'bad'); L.yoloErr = true; } return; }
        L.yoloErr = false;
        var im = ((d.result || {}).images || [])[0] || {};
        L.yoloBoxes = { s: s, objs: im.objects || [], kp: im.keypoints, counts: (d.result || {}).counts || {}, ms: Math.round(performance.now() - now) };
    }).catch(function (e) { if (!L.yoloErr) { VISION.log('YOLO: ' + e, 'bad'); L.yoloErr = true; } })
        .then(function () { L.yoloBusy = false; });
};
/** Continuous barcode scanner: full-resolution frames to the warm worker (one in flight, ~3 per second). The worker reads,
    zooms into a barcode it sees but cannot read, and otherwise says why (move closer / hold still / turn it flat). */
VISION.scans = [];
VISION.scanTick = function (v) {
    var L = VISION.live, now = performance.now();
    if (L.scanBusy || now - (L.scanAt || 0) < 300) return;
    L.scanBusy = true; L.scanAt = now;
    var c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
    VISION.exec('barcodes', [{ name: 'frame.jpg', url: c.toDataURL('image/jpeg', 0.92) }], { live: true }, 'live').then(function (d) {
        if (!d.ok) { if (!L.scanErr) { VISION.log('Scanner: ' + (d.error || 'failed'), 'bad'); L.scanErr = true; } return; }
        L.scanErr = false;
        var im = ((d.result || {}).images || [])[0] || {};
        L.scanRes = { at: performance.now(), codes: im.codes || [], regions: im.regions || [], hint: im.hint || '' };
        (im.codes || []).forEach(function (code) { VISION.scanned(code.data, code.type); });
    }).catch(function (e) { if (!L.scanErr) { VISION.log('Scanner: ' + e, 'bad'); L.scanErr = true; } })
        .then(function () { L.scanBusy = false; });
};
VISION.beep = function () {
    try {
        var a = VISION._ac = VISION._ac || new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain();
        o.frequency.value = 1760; g.gain.value = 0.15; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.09);
    } catch (e) { /* no audio */ }
};
/** One read: new code → beep + list; the same code again within 3 s is the same scan (counted once). */
VISION.scanned = function (data, type) {
    var now = Date.now(), s = VISION.scans.filter(function (x) { return x.data === data; })[0];
    if (s && now - s.last < 3000) { s.last = now; return; }
    if (s) { s.count++; s.last = now; } else VISION.scans.unshift({ data: data, type: type, count: 1, first: now, last: now });
    VISION.beep(); VISION.lastScan = [[null, null, type, data]];
    VISION.log(type + ': ' + data, 'ok');
    VISION.renderScans();
};
VISION.renderScans = function () {
    var el = $('vz-scans'); if (!el) return;
    $('vz-scn').textContent = VISION.scans.length ? '(' + VISION.scans.length + ')' : '';
    el.innerHTML = VISION.scans.length ? VISION.scans.map(function (x) {
        return '<div class="vz-scan"><b>' + esc(x.data) + '</b><span class="muted">' + esc(x.type) + (x.count > 1 ? ' · ×' + x.count : '') + ' · ' + new Date(x.last).toLocaleTimeString() + '</span></div>';
    }).join('') : '<p class="muted sm">Tick "Barcode scanner" and hold a barcode up to the camera.</p>';
};
VISION.scansCopy = function () { navigator.clipboard.writeText(VISION.scans.map(function (x) { return x.data; }).join('\n')).then(function () { toast('Copied ' + VISION.scans.length + ' code(s)', 'ok'); }); };
VISION.scansResults = function () {
    if (!AG.pageResult || !VISION.scans.length) return;
    AG.pageResult('Scanned barcodes', ['code', 'type', 'times', 'first', 'last'], VISION.scans.map(function (x) { return [x.data, x.type, x.count, new Date(x.first).toLocaleTimeString(), new Date(x.last).toLocaleTimeString()]; }));
    CODE.showTab('chat'); AG.toggleResults && AG.toggleResults(true, true);
};

VISION.PALETTE = ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#f472b6', '#60a5fa', '#facc15', '#fb7185'];
VISION.colorOf = function (label) { var h = 0; for (var i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0; return VISION.PALETTE[h % VISION.PALETTE.length]; };

/** A gesture held for HOLD ms fires its mapped action once, then a cool-down. */
VISION.HOLD = 700; VISION.COOL = 2500;
VISION.gestures = function (hr) {
    var L = VISION.live, now = performance.now(), top = null;
    if (hr && hr.gestures) hr.gestures.forEach(function (gs) { var x = gs && gs[0]; if (x && x.categoryName !== 'None' && x.score > 0.6 && (!top || x.score > top.score)) top = x; });
    var name = top ? top.categoryName : null, G = L.gest;
    if (name !== G.name) { G.name = name; G.since = now; G.fired = false; }
    var act = name ? L.map[name] : '', held = name ? now - G.since : 0, el = $('vz-gest');
    var label = (VISION.GESTURES.filter(function (x) { return x[0] === name; })[0] || [null, name || ''])[1];
    if (!name) { el.innerHTML = L.paused ? 'PAUSED — ' + esc(VISION.pauseHint()) : ''; return; }
    var pct = Math.min(1, held / VISION.HOLD);
    el.innerHTML = 'GESTURE: <b>' + esc(String(name).toUpperCase()) + '</b>' + (act ? ' → ' + esc((VISION.ACTIONS.filter(function (a) { return a[0] === act; })[0] || [])[1]) +
        ' <span class="vz-hold"><span style="width:' + Math.round(pct * 100) + '%"></span></span>' : '');
    if (L.paused) act = '';                            // paused: gestures do nothing (the button resumes)
    if (act && !G.fired && held >= VISION.HOLD && now - (L.lastFire || 0) > VISION.COOL) {
        G.fired = true; L.lastFire = now;
        VISION.log('Gesture ' + label + ' → ' + act, 'ok');
        VISION.doAction(act);
    }
};
VISION.pauseHint = function () { return 'press Resume to go on'; };
VISION.setPaused = function (p) {
    var L = VISION.live; L.paused = p;
    VISION.log(p ? 'Tracking paused' : 'Tracking resumed');
    var b = $('vz-pbtn'); if (b) b.innerHTML = p ? '<i class="fa-solid fa-play"></i> Resume' : '<i class="fa-solid fa-pause"></i> Pause';
};
VISION.doAction = function (act) {
    if (act === 'yolo') { var cb = $('vz-live').querySelector('[data-o="yolo"]'); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); VISION.log('Objects (YOLO) ' + (cb.checked ? 'on' : 'off')); return; }
    if (act === 'voice') { if (window.VOICE && VOICE.toggle) VOICE.toggle(); else toast('Voice mode is not available here', 'err'); return; }
    VISION.snap(act);
};
/** Takes the current frame (never mirrored) → images tray / barcode scan / chat attachment. */
VISION.snap = function (act) {
    var v = $('vz-video'); if (!v || !v.videoWidth || !VISION.live.on) { toast('Start the camera first', 'err'); return; }
    var c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    var black = VISION.live.opt.bg === 'black' && act !== 'scan', cg = c.getContext('2d');
    if (black) { cg.fillStyle = '#000'; cg.fillRect(0, 0, c.width, c.height); cg.drawImage($('vz-canvas'), 0, 0, c.width, c.height); }   // privacy: only the mesh / skeleton
    else cg.drawImage(v, 0, 0);
    var url = c.toDataURL('image/jpeg', 0.92), name = (black ? 'skeleton-' : 'live-') + new Date().toISOString().slice(11, 19).replace(/:/g, '') + '.jpg';
    var st = $('vz-stage'); st.classList.add('flash'); setTimeout(function () { st.classList.remove('flash'); }, 180);
    if (act === 'chat') { AG.files.push({ name: name, media_type: 'image/jpeg', data: url.split(',')[1] }); AG.renderFiles(); VISION.log('Photo attached to your next chat message', 'ok'); toast('Photo attached to the chat', 'ok'); return; }
    VISION.add(name, url, 'live');
    if (act !== 'scan') { VISION.log('Photo → images (' + VISION.tray.length + ')'); return; }
    VISION.log('Scanning barcodes…');
    VISION.exec('barcodes', [{ name: name, url: url }], {}).then(function (d) {
        var rows = (((d.result || {}).table) || {}).rows || [];
        if (!d.ok) { VISION.log('Scan: ' + (d.error || 'failed'), 'bad'); return; }
        if (!rows.length) { VISION.log('No barcode read' + ((d.result || {}).note ? ' — ' + d.result.note.replace('Barcode seen but not readable: ', '') : ' — hold it closer / flatter'), 'bad'); return; }
        rows.forEach(function (r) { VISION.scanned(r[3], r[2]); });
        toast(rows.map(function (r) { return r[3]; }).join(', '), 'ok');
        VISION.lastScan = rows;
    }).catch(function (e) { VISION.log('Scan: ' + e, 'bad'); });
};

/** Posture coach: stooped lift = back bent > 50° from vertical with nearly straight knees (> 150°). */
VISION.coach = function (pr) {
    var L = VISION.live, c = L.coach, al = $('vz-alert');
    var b = pr && pr.landmarks && pr.landmarks[0];
    if (!b) { al.hidden = true; return; }
    var side = (b[23].visibility || 0) + (b[25].visibility || 0) >= (b[24].visibility || 0) + (b[26].visibility || 0) ? [11, 23, 25, 27] : [12, 24, 26, 28];
    var sh = b[side[0]], hip = b[side[1]], kn = b[side[2]], an = b[side[3]];
    var back = Math.atan2(Math.abs(sh.x - hip.x), Math.abs(hip.y - sh.y)) * 180 / Math.PI, knee = VISION.ang(hip, kn, an);
    c.back = Math.round(back); c.knee = Math.round(knee);
    var bent = back > 50, stooped = bent && knee > 150;
    if (bent && c.state === 'up') { c.state = 'down'; c.bad = false; }
    if (c.state === 'down' && stooped) c.bad = true;
    if (!bent && back < 25 && c.state === 'down') {
        c.state = 'up'; c.lifts++;
        if (c.bad) { c.risky++; VISION.log('Stooped lift — bend the knees, keep the back straight', 'bad'); } else VISION.log('Good lift', 'ok');
    }
    al.hidden = !stooped;
    if (stooped) al.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> BEND YOUR KNEES — back ' + c.back + '°, knees ' + c.knee + '°';
};

VISION.panel = function (res) {
    var L = VISION.live, rows = [];
    var hands = res.hands && res.hands.landmarks ? res.hands.landmarks.length : 0;
    rows.push(['HAND TRACKING', L.opt.hands ? (L.mpFailed && !L.hands ? 'UNAVAILABLE' : L.hands ? (hands ? hands + ' HAND' + (hands > 1 ? 'S' : '') : 'SEARCHING') : 'LOADING') : 'OFF']);
    rows.push(['SKELETON', L.opt.pose || L.opt.coach ? (L.mpFailed && !L.pose ? 'UNAVAILABLE' : L.pose ? (res.pose && res.pose.landmarks && res.pose.landmarks.length ? 'LOCKED' : 'SEARCHING') : 'LOADING') : 'OFF']);
    rows.push(['FACE MESH', L.opt.face ? (L.mpFailed && !L.face ? 'UNAVAILABLE' : L.face ? (res.face && res.face.faceLandmarks && res.face.faceLandmarks.length ? '478 PTS' : 'SEARCHING') : 'LOADING') : 'OFF']);
    if (L.opt.coach) rows.push(['LIFTS', L.coach.lifts + ' (' + L.coach.risky + ' stooped)'], ['BACK / KNEE', (L.coach.back != null ? L.coach.back + '° / ' + L.coach.knee + '°' : '—')]);
    if (L.opt.yolo) {
        var yc = (L.yoloBoxes || {}).counts || {}, keys = Object.keys(yc);
        rows.push(['OBJECTS (YOLO)', L.yoloBoxes ? (keys.length ? keys.map(function (k) { return yc[k] + ' ' + k; }).join(', ').slice(0, 26) : 'NONE') + ' · ' + L.yoloBoxes.ms + 'MS' : 'WARMING UP']);
    }
    if (L.opt.scan) rows.push(['SCANNER', L.scanRes ? (L.scanRes.codes.length ? 'READ ' + L.scanRes.codes.length : (L.scanRes.hint ? L.scanRes.hint.split(' — ')[0].toUpperCase() : 'LOOKING')) : 'STARTING']);
    if (VISION.lastScan) rows.push(['LAST SCAN', String(VISION.lastScan[0][3]).slice(0, 18)]);
    var vv = $('vz-video'); if (vv && vv.videoWidth) rows.push(['CAMERA', vv.videoWidth + '×' + vv.videoHeight]);
    rows.push(['FPS', L.fps + (L.paused ? ' · PAUSED' : '')]);
    $('vz-panel').className = 'vz-panel ' + (L.opt.hud === 'scifi' ? 'scifi' : 'clean');
    $('vz-panel').innerHTML = '<div class="vz-ph">SYSTEM STATUS</div>' + rows.map(function (r) { return '<div><span>' + r[0] + '</span><b>' + esc(r[1]) + '</b></div>'; }).join('');
};

// ── the agent's vision tool: OpenCV on photos of this conversation ──
VISION.agentImages = function (want) {
    var cache = AG.imgCache || {}, keys = Object.keys(cache), out = [];
    var pick = function (k) { if (cache[k]) out.push({ name: k, url: cache[k] }); else { var t = VISION.tray.filter(function (x) { return x.name === k; })[0]; if (t) out.push({ name: t.name, url: t.url }); } };
    (want && want.length ? want : ['last']).forEach(function (w) {
        if (w === 'last') { if (keys.length) pick(keys[keys.length - 1]); else if (VISION.tray.length) pick(VISION.tray[VISION.tray.length - 1].name); }
        else if (/^last\d$/.test(w)) keys.slice(-(+w.slice(4))).forEach(pick);
        else pick(w);
    });
    return out;
};
AG.tool('vision', function (inp) {
    var noImg = inp.op === 'generate' || inp.op === 'markers';
    var imgs = noImg ? [] : VISION.agentImages(inp.images);
    if (!imgs.length && !noImg) return Promise.resolve({ ok: false, content: 'No picture found. Ask the user to attach one or use the camera tool first. Known pictures: ' + (Object.keys(AG.imgCache || {}).join(', ') || 'none') });
    return VISION.exec(inp.op, imgs, inp.params || {}, 'agent').then(function (d) {
        if (!d.ok) return { ok: false, content: 'Vision ' + inp.op + ' failed: ' + (d.error || 'unknown') };
        var r = d.result || {}, slim = JSON.parse(JSON.stringify(r));
        (slim.images || []).forEach(function (x) { if (x.objects) { x.objects = x.objects.slice(0, 30); } });
        delete slim.table;
        // outputs become pictures of the conversation too, so the next step can use them (e.g. barcodes on scan_1.png)
        (d.images || []).forEach(function (im) { AG.imgCache[im.name] = 'data:' + im.media_type + ';base64,' + im.data; });
        var t = VISION.tableOf(r), ims = (d.images || []).map(function (im) { return { name: im.name, media_type: im.media_type, data: im.data }; });
        AG.pill('👁 ' + inp.op + ': ' + VISION.summary(r).slice(0, 80));
        return { ok: true, content: 'OpenCV ' + inp.op + (noImg ? '' : ' on ') + imgs.map(function (x) { return x.name; }).join(', ') + ': ' + VISION.summary(r) + '\nDetails: ' + JSON.stringify(slim).slice(0, 6000) +
                (ims.length ? '\nOutput pictures (usable as images in the next vision call): ' + ims.map(function (x) { return x.name; }).join(', ') + '. The first one follows.' : ''),
            data: t && t.rows.length ? t : undefined, attachment: ims[0], attachments: ims.slice(1, 3) };
    });
});
AG.preview = AG.preview || {};

// tab wiring: Chat | Code | Vision (code.js owns showTab; Vision adds itself)
(function () {
    var go = function () {
        var orig = CODE.showTab;
        CODE.showTab = function (tab) {
            if ($('visionws')) $('visionws').hidden = tab !== 'vision';
            if (tab === 'vision') {
                document.querySelectorAll('.ag-tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === 'vision'); });
                document.querySelector('.shell').hidden = true; $('codews').hidden = true;
                try { localStorage.setItem('aiagent.tab', 'vision'); } catch (e) { /* private mode */ }
                VISION.start();
                return;
            }
            if (VISION.live.on) VISION.liveStop();
            orig(tab);
        };
        document.querySelectorAll('.ag-tabs button').forEach(function (b) { b.onclick = function () { CODE.showTab(b.dataset.tab); }; });
        var t = 'chat'; try { t = localStorage.getItem('aiagent.tab') || 'chat'; } catch (e) { /* private mode */ }
        if (t === 'vision') CODE.showTab('vision');
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else setTimeout(go, 0);
})();
