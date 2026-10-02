/* AI Agent — the Vision tab.
   Photo · OpenCV: images (files, paste, drop, chat photos, live snapshots) → fixed OpenCV operations run by the host
   (classes/VisionCv.cs, Python + opencv-contrib + zxing-cpp): scan a document, read barcodes / QR of every format, count
   objects, compare before / after, find a label or logo, enhance, edges, info, resize. Results: annotated images, numbers,
   tables to the results panel, images to the chat.
   Live · gestures & skeleton: the camera with Google MediaPipe Tasks Vision running IN the page (WASM; nothing leaves the
   PC): hand skeletons + gestures (GestureRecognizer), body pose (33 points) with joint angles, face mesh — drawn as a HUD.
   Gestures held ~0.7 s trigger actions you choose (snap to the tray, scan barcodes, send to chat, pause); the posture coach
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
    { id: 'document', icon: 'fa-file-image', label: 'Scan document', hint: 'Finds the page, flattens the perspective, cleans it up', need: 1,
        params: [{ k: 'mode', label: 'Output', type: 'select', opts: [['color', 'Colour'], ['gray', 'Gray'], ['bw', 'Black & white']] }] },
    { id: 'barcodes', icon: 'fa-barcode', label: 'Read barcodes', hint: 'QR, Code 128 / 39, EAN, UPC, DataMatrix, PDF417 …', need: 1, params: [] },
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
        '<button data-m="live"><i class="fa-solid fa-hand-sparkles"></i> Live · gestures &amp; skeleton</button></div><span class="grow"></span><span id="vz-status" class="sm"></span></div>' +
        '<div id="vz-photo" class="vz-photo"><aside class="vz-tray"><div class="row"><b class="grow">Images</b>' +
        '<label class="btn sm" title="Add picture files"><i class="fa-solid fa-plus"></i> Files<input type="file" accept="image/*" multiple hidden id="vz-file"></label>' +
        '<button class="btn sm" onclick="VISION.fromChat()" title="Photos and pictures from this conversation"><i class="fa-regular fa-comments"></i> From chat</button>' +
        '<button class="btn sm" onclick="VISION.setMode(\'live\')" title="Take photos with the camera (Live → Snap)"><i class="fa-solid fa-camera"></i></button></div>' +
        '<div class="vz-drop" id="vz-drop">Drop or paste (Ctrl+V) pictures here</div><div id="vz-list" class="vz-list"></div></aside>' +
        '<section class="vz-main"><div class="vz-ops" id="vz-ops"></div><div class="vz-params" id="vz-params"></div><div class="vz-result" id="vz-result">' +
        '<p class="muted sm">Pick images on the left (click to select, the order counts for Compare / Find), choose what to do, press Run.</p></div></section></div>' +
        '<div id="vz-live" class="vz-livewrap" hidden></div>';
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
    $('vz-photo').hidden = m !== 'photo'; $('vz-live').hidden = m !== 'live';
    if (m === 'live') VISION.liveUi(); else VISION.liveStop();
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
                (ys.State === 'running' ? ' <span class="tag b-warn"><i class="fa-solid fa-circle-notch fa-spin"></i> adding YOLO…</span> <span class="muted">' + esc(String(ys.Log || '').trim().split('\n').pop()) + '</span>'
                    : s.yolo ? ' <span class="tag b-ok" title="PyTorch ' + esc(s.torch || '') + '">YOLO ' + esc(s.yolo) + '</span>' + (VISION.admin ? ' <button class="btn sm" onclick="VISION.modelsFolder()" title="Drop your own trained .pt models here"><i class="fa-regular fa-folder-open"></i> Models</button>' : '')
                    : (ys.State === 'error' ? ' <span class="tag b-bad" title="' + esc(ys.Error || '') + '">YOLO setup failed</span>' : '') + (VISION.admin ? ' <button class="btn sm" onclick="VISION.setup(true)" title="Object detection with names, segmentation, pose, custom models (~600 MB)"><i class="fa-solid fa-plus"></i> YOLO + PyTorch</button>' : ''));
            if (ys.State === 'running') { clearTimeout(VISION._st); VISION._st = setTimeout(function () { VISION.checkStatus(true); }, 4000); }
            if (VISION.started) VISION.renderOps();
        } else {
            el.innerHTML = (setup.State === 'error' ? '<span class="tag b-bad" title="' + esc(setup.Error || '') + '">setup failed</span> ' : '') +
                '<span class="tag b-warn">OpenCV not set up on this PC</span> ' +
                (VISION.admin ? '<button class="btn sm primary" onclick="VISION.setup()"><i class="fa-solid fa-download"></i> Set up (~100 MB, once)</button>' : '<span class="muted">an AI admin sets it up once per PC</span>') +
                ' <span class="muted">Live mode works without it.</span>';
        }
    }).catch(function (e) { $('vz-status').innerHTML = '<span class="tag b-bad">' + esc(e) + '</span>'; });
};
VISION.setup = function (yolo) {
    if (!confirm(yolo ? 'Add YOLO (Ultralytics) on PyTorch (CPU) to this PC\'s Python? About 600 MB from PyPI, a few minutes.\n\nLicence: Ultralytics YOLO is AGPL-3.0 — using it inside a commercial product you distribute needs an Ultralytics Enterprise licence (see docs/AI_AGENT.md).'
        : 'Install Python (if missing), OpenCV and the zxing-cpp barcode reader for your Windows user on this PC? (~100 MB from python.org / PyPI)')) return;
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
    $('vz-ops').querySelectorAll('.vz-op').forEach(function (b) { b.onclick = function () { VISION.op = b.dataset.op; VISION.renderOps(); }; });
    var o = VISION.opDef(), p = VISION.params[o.id] = VISION.params[o.id] || {};
    var noYolo = o.yolo && !(VISION.status || {}).yolo;
    $('vz-params').innerHTML = '<span class="muted sm">' + esc(o.hint) + (o.need > 1 ? ' — select ' + o.need + ' images (Ctrl+click), in order.' : '') + '</span>' +
        (noYolo ? '<span class="tag b-warn">YOLO is not set up on this PC</span>' + (VISION.admin ? ' <button class="btn sm" onclick="VISION.setup(true)"><i class="fa-solid fa-download"></i> Add YOLO + PyTorch</button>' : '') : '') +
        o.params.map(function (f) {
            var v = p[f.k] != null ? p[f.k] : f.def;
            if (f.type === 'text') return '<label class="sm">' + esc(f.label) + ' <input type="text" data-k="' + f.k + '" value="' + esc(v || '') + '" style="width:150px"></label>';
            if (f.type === 'select') return '<label class="sm">' + esc(f.label) + ' <select data-k="' + f.k + '">' + (typeof f.opts === 'function' ? f.opts() : f.opts).map(function (x) { return '<option value="' + x[0] + '"' + (v === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></label>';
            if (f.type === 'number') return '<label class="sm">' + esc(f.label) + ' <input type="number" data-k="' + f.k + '" value="' + (v != null ? v : '') + '" step="' + (f.step || 1) + '" style="width:80px"></label>';
            if (f.type === 'check') return '<label class="sm"><input type="checkbox" data-k="' + f.k + '"' + (v ? ' checked' : '') + '> ' + esc(f.label) + '</label>';
            return '<span class="sm">' + f.opts.map(function (x) { return '<label><input type="checkbox" data-m="' + f.k + '" value="' + x[0] + '"' + ((v || []).indexOf(x[0]) >= 0 ? ' checked' : '') + '> ' + esc(x[1]) + '</label>'; }).join(' ') + '</span>';
        }).join('') + '<span class="grow"></span><button class="btn primary" id="vz-run" onclick="VISION.run()"><i class="fa-solid fa-play"></i> Run</button>';
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
    var o = VISION.opDef(), imgs = VISION.sel.map(function (id) { return VISION.tray.filter(function (t) { return t.id === id; })[0]; }).filter(Boolean);
    if (!imgs.length && VISION.tray.length) imgs = [VISION.tray[VISION.tray.length - 1]];
    if (imgs.length < o.need) { toast(o.label + ' needs ' + o.need + ' images — Ctrl+click to select them in order', 'err'); return; }
    var btn = $('vz-run'); btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Working…';
    $('vz-result').innerHTML = '<p class="muted sm"><i class="fa-solid fa-circle-notch fa-spin"></i> ' + esc(o.label) + ' on ' + imgs.length + ' image(s)…</p>';
    VISION.exec(o.id, imgs, VISION.paramsFor(o)).then(function (d) { VISION.last = d; VISION.renderResult(o, d); })
        .catch(function (e) { $('vz-result').innerHTML = '<div class="callout bad"><div class="co-t">Failed</div>' + esc(e) + '</div>'; })
        .then(function () { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-play"></i> Run'; });
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
        case 'detect': return Object.keys(r.counts || {}).length ? Object.keys(r.counts).map(function (k) { return r.counts[k] + ' × ' + k; }).join(', ') + ' (' + r.model + ')' : 'nothing found (' + r.model + ')';
        case 'document': return im.map(function (x) { return x.name + ': ' + (x.page_found ? 'page found' : 'no page edges, whole image'); }).join(', ');
        case 'info': return im.map(function (x) { return x.name + ': ' + x.width + '×' + x.height + ', ' + x.sharp_verdict + ', ' + x.exposure; }).join(', ');
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
        html += '<div class="vz-big">' + rows.length + '<span> code' + (rows.length === 1 ? '' : 's') + '</span></div>' + (rows.length ? '<table class="t"><thead><tr><th>Image</th><th>#</th><th>Type</th><th>Data</th></tr></thead><tbody>' +
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
VISION.outToTray = function (i) { var im = VISION.last.images[i]; VISION.add(im.name, 'data:' + im.media_type + ';base64,' + im.data, 'result'); VISION.select(VISION.tray[VISION.tray.length - 1].id, true); };
VISION.download = function (i) {
    var im = VISION.last.images[i], a = document.createElement('a');
    a.href = 'data:' + im.media_type + ';base64,' + im.data; a.download = im.name; document.body.appendChild(a); a.click(); a.remove();
};
VISION.tableOf = function (r) {
    if (r.op === 'barcodes') return { title: 'Barcodes', columns: r.table.columns, rows: r.table.rows };
    if (r.op === 'detect' && r.table) return { title: 'Objects (' + r.model + ')', columns: r.table.columns, rows: r.table.rows };
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
    L.opt = Object.assign({ hands: true, pose: true, face: false, hud: 'scifi', mirror: true, coach: false, yolo: false, yoloModel: 'yolo11n' }, VISION.ls('opt', {}));
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
        [['hands', 'Hands + gestures'], ['pose', 'Body skeleton'], ['face', 'Face mesh'], ['yolo', 'Objects (YOLO)'], ['coach', 'Posture coach (safe lifting)'], ['mirror', 'Mirror']].map(function (x) {
            return '<label class="vz-chk"><input type="checkbox" data-o="' + x[0] + '"' + (o[x[0]] ? ' checked' : '') + '> ' + x[1] + '</label>';
        }).join('') +
        '<label class="sm">YOLO model <select id="vz-ym">' + VISION.modelOpts().filter(function (x) { return !/-cls$/.test(x[0]); }).map(function (x) { return '<option value="' + x[0] + '"' + (o.yoloModel === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></label>' +
        '<label class="sm">Style <select id="vz-hud"><option value="scifi"' + (o.hud === 'scifi' ? ' selected' : '') + '>Sci-fi HUD</option><option value="clean"' + (o.hud === 'clean' ? ' selected' : '') + '>Clean</option></select></label>' +
        '<div class="side-h">Gesture → action <span class="muted">(hold ~0.7 s)</span></div><div id="vz-map"></div>' +
        '<div class="side-h">Events</div><div id="vz-log" class="vz-log"></div></aside>';
    $('vz-live').querySelectorAll('[data-o]').forEach(function (el) {
        el.onchange = function () { o[el.dataset.o] = el.checked; VISION.lsSet('opt', o); if (L.on && (el.dataset.o === 'hands' || el.dataset.o === 'pose' || el.dataset.o === 'face' || el.dataset.o === 'coach')) VISION.loadModels(); };
    });
    $('vz-hud').onchange = function () { o.hud = this.value; VISION.lsSet('opt', o); };
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
    return Promise.all(jobs).then(function () { return VISION.mp(); }).then(function (mp) { L.C = { hand: mp.m.GestureRecognizer.HAND_CONNECTIONS || mp.m.HandLandmarker.HAND_CONNECTIONS, pose: mp.m.PoseLandmarker.POSE_CONNECTIONS, face: mp.m.FaceLandmarker.FACE_LANDMARKS_TESSELATION, oval: mp.m.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL }; });
};
VISION.liveStart = function () {
    var L = VISION.live;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('No camera access in this window', 'err'); return; }
    $('vz-idle').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><div>Starting the camera and loading the tracking models (first time ~20 MB)…</div>';
    navigator.mediaDevices.getUserMedia({ video: L.deviceId ? { deviceId: { exact: L.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
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
        g.globalAlpha = sci ? 0.35 : 0.5;
        (L.C.face || []).forEach(function (c) { line(f[c.start], f[c.end], sci ? '#67e8f9' : '#94a3b8', 1); });
        g.globalAlpha = 1;
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
    var c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
    var url = c.toDataURL('image/jpeg', 0.92), name = 'live-' + new Date().toISOString().slice(11, 19).replace(/:/g, '') + '.jpg';
    var st = $('vz-stage'); st.classList.add('flash'); setTimeout(function () { st.classList.remove('flash'); }, 180);
    if (act === 'chat') { AG.files.push({ name: name, media_type: 'image/jpeg', data: url.split(',')[1] }); AG.renderFiles(); VISION.log('Photo attached to your next chat message', 'ok'); toast('Photo attached to the chat', 'ok'); return; }
    VISION.add(name, url, 'live');
    if (act !== 'scan') { VISION.log('Photo → images (' + VISION.tray.length + ')'); return; }
    VISION.log('Scanning barcodes…');
    VISION.exec('barcodes', [{ name: name, url: url }], {}).then(function (d) {
        var rows = (((d.result || {}).table) || {}).rows || [];
        if (!d.ok) { VISION.log('Scan: ' + (d.error || 'failed'), 'bad'); return; }
        if (!rows.length) { VISION.log('No barcode found — hold it closer / flatter', 'bad'); return; }
        rows.forEach(function (r) { VISION.log(r[2] + ': ' + r[3], 'ok'); });
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
    rows.push(['HAND TRACKING', L.opt.hands ? (L.hands ? (hands ? hands + ' HAND' + (hands > 1 ? 'S' : '') : 'SEARCHING') : 'LOADING') : 'OFF']);
    rows.push(['SKELETON', L.opt.pose || L.opt.coach ? (L.pose ? (res.pose && res.pose.landmarks && res.pose.landmarks.length ? 'LOCKED' : 'SEARCHING') : 'LOADING') : 'OFF']);
    rows.push(['FACE MESH', L.opt.face ? (L.face ? (res.face && res.face.faceLandmarks && res.face.faceLandmarks.length ? '478 PTS' : 'SEARCHING') : 'LOADING') : 'OFF']);
    if (L.opt.coach) rows.push(['LIFTS', L.coach.lifts + ' (' + L.coach.risky + ' stooped)'], ['BACK / KNEE', (L.coach.back != null ? L.coach.back + '° / ' + L.coach.knee + '°' : '—')]);
    if (L.opt.yolo) {
        var yc = (L.yoloBoxes || {}).counts || {}, keys = Object.keys(yc);
        rows.push(['OBJECTS (YOLO)', L.yoloBoxes ? (keys.length ? keys.map(function (k) { return yc[k] + ' ' + k; }).join(', ').slice(0, 26) : 'NONE') + ' · ' + L.yoloBoxes.ms + 'MS' : 'WARMING UP']);
    }
    if (VISION.lastScan) rows.push(['LAST SCAN', String(VISION.lastScan[0][3]).slice(0, 18)]);
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
    var imgs = VISION.agentImages(inp.images);
    if (!imgs.length) return Promise.resolve({ ok: false, content: 'No picture found. Ask the user to attach one or use the camera tool first. Known pictures: ' + (Object.keys(AG.imgCache || {}).join(', ') || 'none') });
    return VISION.exec(inp.op, imgs, inp.params || {}, 'agent').then(function (d) {
        if (!d.ok) return { ok: false, content: 'Vision ' + inp.op + ' failed: ' + (d.error || 'unknown') };
        var r = d.result || {}, slim = JSON.parse(JSON.stringify(r));
        (slim.images || []).forEach(function (x) { if (x.objects) { x.objects = x.objects.slice(0, 30); } });
        delete slim.table;
        // outputs become pictures of the conversation too, so the next step can use them (e.g. barcodes on scan_1.png)
        (d.images || []).forEach(function (im) { AG.imgCache[im.name] = 'data:' + im.media_type + ';base64,' + im.data; });
        var t = VISION.tableOf(r), ims = (d.images || []).map(function (im) { return { name: im.name, media_type: im.media_type, data: im.data }; });
        AG.pill('👁 ' + inp.op + ': ' + VISION.summary(r).slice(0, 80));
        return { ok: true, content: 'OpenCV ' + inp.op + ' on ' + imgs.map(function (x) { return x.name; }).join(', ') + ': ' + VISION.summary(r) + '\nDetails: ' + JSON.stringify(slim).slice(0, 6000) +
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
