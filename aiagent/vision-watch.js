/* AI Agent — Vision › Watch · video & CCTV.
   A watch = a source (webcam, RTSP / CCTV camera, or a video file picked in the app) + a mode, run by its own Python process
   on this PC (classes/VisionWatch.cs → vision.py --watch):
     motion  — movement inside zones you draw, with an alert schedule (e.g. after hours 18:00–07:00)
     line    — counts what crosses a line you draw, IN / OUT (moving blobs, or YOLO objects such as person / truck)
     scan    — reads barcodes / QR codes that pass the camera (each code once per few seconds)
     detect  — YOLO objects in the zones: an event when what is there changes (a truck arrives, a person enters)
   Events (with a snapshot) are shown live, kept per run on the PC, saved to APEX (WMS_VISION_EVENTS, created by this page)
   and — when the watch has alerts on — sent through the AI Control alert settings (Teams / e-mail). Saving or deleting a
   watch is for AI admins (stream addresses hold camera passwords: the host keeps them DPAPI-encrypted and never sends them
   back); anyone may start, stop and look. The agent's `vision_watch` tool reads the same status and events. */

(function () {
    var W = VISION.W = { list: [], sel: null, edit: null, lastN: {}, events: {}, status: {}, frameStamp: null, visible: false, alertAt: {}, run: {} };
    var MODES = [['motion', 'fa-person-running', 'Motion in zones'], ['line', 'fa-arrows-left-right-to-line', 'Line counting'], ['scan', 'fa-barcode', 'Barcodes'], ['detect', 'fa-crosshairs', 'Objects (YOLO)']];
    var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var modeOf = function (m) { return MODES.filter(function (x) { return x[0] === m; })[0] || MODES[0]; };
    var cmd = function (a, ms) { return host(a.action, a, ms || 60000); };
    var srcText = function (s) { s = s || {}; return s.kind === 'rtsp' ? (s.url_masked || 'stream') : s.kind === 'file' ? (s.file || 'video file') + (s.file_ok === false ? ' (missing)' : '') : 'camera ' + (s.index || 0); };
    var fmtS = function (s) { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); };

    VISION.watchUi = function () {
        W.visible = true;
        if (!W.ui) {
            W.ui = true;
            $('vz-watch').innerHTML = '<aside class="vz-wlist"><div class="row"><b class="grow">Watches</b><button class="btn sm" id="vw-new" onclick="VISION.watchEdit()"><i class="fa-solid fa-plus"></i> New</button></div>' +
                '<div id="vw-items"></div><p class="muted sm" style="margin-top:auto">Each watch runs in its own process on this PC (at most 4 at once) and keeps going while you use other tabs.</p></aside>' +
                '<section class="vz-wmain" id="vw-main"></section>';
        }
        VISION.watchLoad();
        VISION.watchPollStart();
    };

    VISION.watchLoad = function () {
        return cmd({ action: 'visionWatchList' }).then(function (d) {
            if (d.ok === false) throw d.error;
            W.list = d.watches || [];
            if (d.admin != null) VISION.admin = !!d.admin;
            if (W.ui) {
                $('vw-new').hidden = !VISION.admin;
                VISION.watchRenderList();
                if (!W.edit) { if (!W.sel && W.list.length) W.sel = W.list[0].id; VISION.watchRenderView(); }
            }
            if (W.list.some(function (w) { return w.running; })) VISION.watchPollStart();
        }).catch(function (e) { if (W.ui) $('vw-main').innerHTML = '<div class="callout bad">' + esc(e) + '</div>'; });
    };

    VISION.watchRenderList = function () {
        $('vw-items').innerHTML = W.list.length ? W.list.map(function (w) {
            var m = modeOf(w.mode), st = W.status[w.id] || {};
            return '<div class="vw-item' + (w.id === W.sel ? ' on' : '') + '" data-id="' + esc(w.id) + '"><div class="row"><i class="fa-solid ' + m[1] + '"></i><b class="grow">' + esc(w.name) + '</b>' +
                (w.running ? '<span class="vw-dot on" title="running"></span>' : '<span class="vw-dot"></span>') + '</div>' +
                '<div class="muted sm">' + esc(m[2]) + ' · ' + esc(srcText(w.source)) + '</div>' +
                (st.counts && Object.keys(st.counts).length ? '<div class="sm">' + Object.keys(st.counts).slice(0, 4).map(function (k) { return '<span class="tag">' + esc(k) + ' ' + st.counts[k] + '</span>'; }).join(' ') + '</div>' : '') + '</div>';
        }).join('') : '<p class="muted sm">No watches yet.' + (VISION.admin ? ' Press New.' : ' An AI admin adds them.') + '</p>';
        $('vw-items').querySelectorAll('.vw-item').forEach(function (el) { el.onclick = function () { W.sel = el.dataset.id; W.edit = null; W.frameStamp = null; VISION.watchRenderList(); VISION.watchRenderView(); }; });
    };

    // ── the view of one watch: live picture, counters, events ──
    VISION.watchRenderView = function () {
        var w = W.list.filter(function (x) { return x.id === W.sel; })[0];
        if (!w) {
            $('vw-main').innerHTML = '<div class="vw-empty"><i class="fa-solid fa-video"></i><div><b>Watch a camera, a CCTV stream or a video file</b></div>' +
                '<div class="muted sm">Motion in zones after hours · count what crosses a line (doors, conveyors, dock) · read barcodes going past · see when trucks or people arrive (YOLO).</div>' +
                (VISION.admin ? '<button class="btn primary" onclick="VISION.watchEdit()"><i class="fa-solid fa-plus"></i> New watch</button>' : '') + '</div>';
            return;
        }
        var m = modeOf(w.mode);
        $('vw-main').innerHTML = '<div class="vz-rhead"><b><i class="fa-solid ' + m[1] + '"></i> ' + esc(w.name) + '</b><span class="muted sm">' + esc(m[2]) + ' · ' + esc(srcText(w.source)) + '</span><span id="vw-state"></span>' +
            '<span class="grow"></span>' +
            (w.running ? '<button class="btn sm" onclick="VISION.watchStop(\'' + w.id + '\')"><i class="fa-solid fa-stop"></i> Stop</button>' : '<button class="btn sm primary" onclick="VISION.watchStart(\'' + w.id + '\')"><i class="fa-solid fa-play"></i> Start</button>') +
            (VISION.admin ? '<button class="btn sm" onclick="VISION.watchEdit(\'' + w.id + '\')"><i class="fa-solid fa-pen"></i> Edit</button>' : '') + '</div>' +
            '<div class="vw-body"><div class="vw-stagecol"><div class="vw-stage"><img id="vw-frame" alt=""><div class="vw-ph" id="vw-ph">' + (w.running ? 'Starting…' : 'Not running — press Start') + '</div></div>' +
            '<div class="vw-prog" id="vw-prog" hidden><div><span id="vw-progbar"></span></div><span id="vw-progtxt" class="sm"></span></div><div class="vw-counts" id="vw-counts"></div></div>' +
            '<div class="vw-evcol"><div class="row"><b class="grow">Events</b><button class="icon" title="Events to the results panel" onclick="VISION.watchToResults()"><i class="fa-solid fa-table"></i></button>' +
            '<button class="icon" title="Download CSV" onclick="VISION.watchCsv()"><i class="fa-solid fa-file-csv"></i></button>' +
            '<button class="icon" title="History saved in APEX" onclick="VISION.watchHistory()"><i class="fa-solid fa-clock-rotate-left"></i></button>' +
            '<button class="icon" title="Ask the agent about it" onclick="VISION.watchToChat()"><i class="fa-regular fa-comment"></i></button></div><div id="vw-events" class="vw-events"></div></div></div>';
        W.frameStamp = null;
        VISION.watchRenderStatus(w.id);
        VISION.watchRenderEvents(w.id);
        setTimeout(function () { VISION.watchPollOne(w.id, true); }, 30);   // after a poll in progress has finished
    };

    VISION.watchRenderStatus = function (id) {
        if (id !== W.sel || W.edit || !$('vw-state')) return;
        var s = (W.status[id] || {}), st = s.status || {}, w = W.list.filter(function (x) { return x.id === id; })[0] || {};
        var state = st.state || (s.running ? 'running' : 'stopped');
        var cls = { running: 'b-ok', finished: 'b-ok', reconnecting: 'b-warn', starting: 'b-warn', error: 'b-bad' }[state] || '';
        $('vw-state').innerHTML = '<span class="tag ' + cls + '">' + esc(state) + '</span>' + (st.fps ? ' <span class="muted sm">' + st.fps + ' fps · ' + (st.frames || 0) + ' frames</span>' : '') +
            (st.alerting === false && w.mode === 'motion' ? ' <span class="tag" title="Outside the alert schedule: events are kept but no alerts">quiet hours</span>' : '') +
            (st.error ? ' <span class="tag b-bad" title="' + esc(st.error) + '">' + esc(String(st.error).slice(0, 60)) + '</span>' : '') +
            (s.stderr && !s.running && state !== 'finished' && state !== 'stopped' ? ' <span class="tag b-bad" title="' + esc(s.stderr) + '">failed</span>' : '');
        var c = st.counts || {};
        $('vw-counts').innerHTML = Object.keys(c).length ? Object.keys(c).map(function (k) { return '<div class="vw-count"><b>' + c[k] + '</b><span>' + esc(k) + '</span></div>'; }).join('')
            : '<span class="muted sm">' + (w.mode === 'line' ? 'IN / OUT counts appear here' : w.mode === 'motion' ? 'Motion events per zone appear here' : w.mode === 'scan' ? 'Codes read appear here' : 'Objects in the zones appear here') + '</span>';
        var pr = $('vw-prog');
        if (st.total) {
            pr.hidden = false; $('vw-progbar').style.width = (st.progress || 0) + '%';
            $('vw-progtxt').textContent = fmtS(st.video_s) + ' / ' + fmtS(st.length_s) + ' · ' + (st.progress || 0) + ' %' + (st.state === 'finished' ? ' · done' : '');
        } else pr.hidden = true;
    };

    VISION.watchEvText = function (e) {
        if (e.type === 'cross') return '<b>' + e.direction.toUpperCase() + '</b> ' + (e.label && e.label !== 'object' ? esc(e.label) + ' ' : '') + '· in ' + e.total_in + ' / out ' + e.total_out;
        if (e.type === 'motion') return 'Motion in <b>' + esc(e.zone) + '</b> (' + e.moving_pct + ' %)' + (e.schedule === 'outside' ? ' <span class="muted">quiet hours</span>' : '');
        if (e.type === 'motion_end') return '<span class="muted">' + esc(e.zone) + ' quiet again (peak ' + e.peak_pct + ' %)</span>';
        if (e.type === 'code') return '<span class="tag">' + esc(e.code_type) + '</span> <b>' + esc(e.data) + '</b>';
        if (e.type === 'objects') {
            var a = e.appeared || {}, g = e.left || {};
            return (Object.keys(a).length ? '+ ' + Object.keys(a).map(function (k) { return a[k] + ' ' + esc(k); }).join(', ') + ' ' : '') + (Object.keys(g).length ? '<span class="muted">− ' + Object.keys(g).map(function (k) { return g[k] + ' ' + esc(k); }).join(', ') + '</span> ' : '') +
                '<span class="muted">now ' + (Object.keys(e.now_in_zone || {}).map(function (k) { return e.now_in_zone[k] + ' ' + esc(k); }).join(', ') || 'nothing') + '</span>';
        }
        return esc(e.type);
    };
    VISION.watchRenderEvents = function (id) {
        if (id !== W.sel || W.edit || !$('vw-events')) return;
        var ev = (W.events[id] || []).slice(-300).reverse();
        $('vw-events').innerHTML = ev.length ? ev.map(function (e) {
            return '<div class="vw-ev' + (e.alert ? ' alert' : '') + '"><span class="vw-t">' + (e.video_s != null ? fmtS(e.video_s) : esc(String(e.at || '').slice(11))) + '</span><span class="grow">' + VISION.watchEvText(e) + '</span>' +
                (e.snap ? '<button class="icon" title="Snapshot" onclick="VISION.watchSnap(\'' + id + '\',\'' + e.snap + '\',\'' + esc(e._run || '') + '\')"><i class="fa-regular fa-image"></i></button>' : '') + '</div>';
        }).join('') : '<p class="muted sm">No events yet.</p>';
    };

    VISION.watchSnap = function (id, snap, run) {
        cmd({ action: 'visionWatchSnap', id: id, snap: snap, run: run }).then(function (d) {
            if (!d.ok) throw d.error;
            var url = 'data:' + d.media_type + ';base64,' + d.data;
            if (AG.zoomImg) AG.zoomImg(url); else window.open(url);
        }).catch(function (e) { toast(String(e), 'err'); });
    };

    // ── start / stop / poll ──
    VISION.watchStart = function (id) {
        cmd({ action: 'visionWatchStart', id: id }).then(function (d) {
            if (d.ok === false) throw d.error;
            W.lastN[id] = 0; W.events[id] = []; W.frameStamp = null; W.run[id] = d.run;
            W.list.forEach(function (w) { if (w.id === id) w.running = true; });
            VISION.watchRenderList(); VISION.watchRenderView(); VISION.watchPollStart();
        }).catch(function (e) { toast(String(e), 'err'); });
    };
    VISION.watchStop = function (id) {
        cmd({ action: 'visionWatchStop', id: id }).then(function () { setTimeout(VISION.watchLoad, 1500); toast('Stopping…', 'ok'); }).catch(function (e) { toast(String(e), 'err'); });
    };
    VISION.watchPollStart = function () {
        if (W.timer) return;
        W.timer = setInterval(VISION.watchTick, 1000);
    };
    VISION.watchTick = function () {
        W.visible = !$('visionws').hidden && VISION.mode === 'watch';
        var running = W.list.filter(function (w) { return w.running; });
        if (!running.length && !W.visible) { clearInterval(W.timer); W.timer = null; return; }
        W.n = (W.n || 0) + 1;
        running.forEach(function (w) { if (w.id === W.sel && W.visible) VISION.watchPollOne(w.id, true); else if (W.n % 3 === 0) VISION.watchPollOne(w.id, false); });
    };
    VISION.watchPollOne = function (id, frame) {
        if (W['busy_' + id]) return;
        W['busy_' + id] = true;
        cmd({ action: 'visionWatchStatus', id: id, after: W.lastN[id] || 0, frame: !!frame && !W.edit, frameStamp: W.frameStamp }, 20000).then(function (d) {
            if (d.ok === false) return;
            if (d.run && W.run[id] && d.run !== W.run[id]) { W.lastN[id] = 0; W.events[id] = []; }
            W.run[id] = d.run;
            W.status[id] = d;
            var fresh = (d.events || []).map(function (e) { e._run = d.run; return e; });
            if (fresh.length) {
                W.events[id] = (W.events[id] || []).concat(fresh).slice(-2000);
                W.lastN[id] = fresh[fresh.length - 1].n;
                VISION.watchRenderEvents(id);
                VISION.watchHandle(id, fresh);
            }
            if (frame && d.frame && id === W.sel && $('vw-frame')) { $('vw-frame').src = 'data:image/jpeg;base64,' + d.frame; W.frameStamp = d.frameStamp; $('vw-ph').hidden = true; }
            var w = W.list.filter(function (x) { return x.id === id; })[0];
            if (w && w.running !== d.running) { w.running = d.running; VISION.watchRenderList(); if (id === W.sel && !W.edit) VISION.watchRenderView(); }
            VISION.watchRenderStatus(id);
        }).catch(function () { /* the next tick tries again */ }).then(function () { W['busy_' + id] = false; });
    };

    // ── new events: APEX log + alerts ──
    VISION.watchHandle = function (id, evs) {
        var w = W.list.filter(function (x) { return x.id === id; })[0]; if (!w) return;
        var al = w.alerts || {};
        // each event is logged once per PC, also when the page is reloaded or opened after the run (catch-up)
        var key = 'aiagent.vision.logged.' + id, done = {};
        try { done = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { /* private mode */ }
        var todo = evs.filter(function (e) { return e._run > (done.run || '') || (e._run === done.run && e.n > (done.n || 0)); });
        if (!todo.length) return;
        var lastE = todo[todo.length - 1];
        try { localStorage.setItem(key, JSON.stringify({ run: lastE._run, n: lastE.n })); } catch (e) { /* private mode */ }
        evs = todo;
        if (al.apex !== false) VISION.watchSave(w, evs);
        var hot = evs.filter(function (e) { return e.alert && e.type !== 'motion_end'; });
        if (al.on && hot.length) {
            var gap = (+al.gap_s || 120) * 1000, now = Date.now();
            if (now - (W.alertAt[id] || 0) < gap) return;
            W.alertAt[id] = now;
            var text = w.name + ' (' + modeOf(w.mode)[2] + ', ' + srcText(w.source) + '): ' + hot.length + ' event(s)\n' +
                hot.slice(0, 10).map(function (e) { return '• ' + String(e.at || '').replace('T', ' ') + ' — ' + VISION.watchEvText(e).replace(/<[^>]+>/g, ''); }).join('\n');
            cmd({ action: 'fusionSqlWatchAlert', subject: 'Vision watch: ' + w.name, text: text, teamsWebhook: al.hook || '', emailTo: al.email || '' }, 60000)
                .then(function (d) { if (d && d.ok === false) toast('Alert not sent: ' + d.error, 'err'); }).catch(function () { /* shown in the audit */ });
        }
    };
    var q = function (v) { return v == null || v === '' ? 'NULL' : "'" + String(v).replace(/'/g, "''").slice(0, 3900) + "'"; };
    var num = function (v) { return v == null || v === '' || isNaN(+v) ? 'NULL' : String(+v); };
    VISION.watchEnsureTable = function () {
        if (W.table) return Promise.resolve();
        return rows("SELECT COUNT(*) AS N FROM user_tables WHERE table_name = 'WMS_VISION_EVENTS'").then(function (r) {
            if (+((r[0] || {}).N) > 0) { W.table = true; return; }
            return dbWrite('CREATE TABLE wms_vision_events (id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, watch_id VARCHAR2(40) NOT NULL, watch_name VARCHAR2(200), ' +
                'run_id VARCHAR2(40), event_no NUMBER, event_type VARCHAR2(30), event_at DATE, video_s NUMBER, zone VARCHAR2(100), direction VARCHAR2(10), label VARCHAR2(100), ' +
                'code_data VARCHAR2(1000), alert_flag CHAR(1), details VARCHAR2(4000), app_user VARCHAR2(100), created_date DATE DEFAULT SYSDATE)').then(function () {
                return dbWrite('CREATE INDEX wms_vision_events_ix1 ON wms_vision_events (watch_id, event_at)');
            }).then(function () { W.table = true; });
        });
    };
    VISION.watchSave = function (w, evs) {
        VISION.watchEnsureTable().then(function () {
            var sel = evs.slice(0, 200).map(function (e) {
                var det = {}; Object.keys(e).forEach(function (k) { if (['n', 'type', 'at', 'video_s', 'zone', 'direction', 'label', 'data', 'alert', 'snap', '_run'].indexOf(k) < 0) det[k] = e[k]; });
                return 'SELECT ' + [q(w.id), q(w.name), q(e._run), num(e.n), q(e.type), e.at ? "TO_DATE(" + q(String(e.at).slice(0, 19).replace('T', ' ')) + ", 'YYYY-MM-DD HH24:MI:SS')" : 'NULL',
                    num(e.video_s), q(e.zone), q(e.direction), q(e.label), q(e.data), q(e.alert ? 'Y' : 'N'), q(JSON.stringify(det)), q(appUser())].join(', ') + ' FROM dual';
            });
            if (!sel.length) return;
            return dbWrite('INSERT INTO wms_vision_events (watch_id, watch_name, run_id, event_no, event_type, event_at, video_s, zone, direction, label, code_data, alert_flag, details, app_user) ' + sel.join(' UNION ALL '));
        }).catch(function (e) { if (!W.saveErr) { W.saveErr = true; toast('Vision events not saved to APEX: ' + e, 'err'); } });
    };

    // ── outputs ──
    VISION.watchRows = function (id) {
        return (W.events[id] || []).map(function (e) {
            return [e.n, String(e.at || '').replace('T', ' '), e.video_s == null ? '' : e.video_s, e.type, e.zone || '', e.direction || '', e.label || '', e.data || e.code_type || '',
                VISION.watchEvText(e).replace(/<[^>]+>/g, ''), e.alert ? 'Y' : ''];
        });
    };
    VISION.WCOLS = ['n', 'at', 'video_s', 'type', 'zone', 'direction', 'label', 'data', 'what', 'alert'];
    VISION.watchToResults = function () {
        var w = W.list.filter(function (x) { return x.id === W.sel; })[0]; if (!w || !AG.pageResult) return;
        AG.pageResult('Watch · ' + w.name, VISION.WCOLS, VISION.watchRows(w.id));
        CODE.showTab('chat'); AG.toggleResults && AG.toggleResults(true, true);
    };
    VISION.watchCsv = function () {
        var w = W.list.filter(function (x) { return x.id === W.sel; })[0]; if (!w) return;
        var cell = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var csv = [VISION.WCOLS].concat(VISION.watchRows(w.id)).map(function (r) { return r.map(cell).join(','); }).join('\r\n');
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = w.name.replace(/[^\w-]+/g, '_') + '-events.csv';
        document.body.appendChild(a); a.click(); a.remove();
    };
    VISION.watchHistory = function () {
        var w = W.list.filter(function (x) { return x.id === W.sel; })[0]; if (!w) return;
        VISION.watchEnsureTable().then(function () {
            return rows("SELECT TO_CHAR(event_at, 'YYYY-MM-DD HH24:MI:SS') AS at, event_type, zone, direction, label, code_data, alert_flag, run_id, app_user FROM wms_vision_events WHERE watch_id = " + q(w.id) + ' ORDER BY event_at DESC, event_no DESC', 2000);
        }).then(function (r) {
            if (!AG.pageResult) return;
            var cols = ['AT', 'EVENT_TYPE', 'ZONE', 'DIRECTION', 'LABEL', 'CODE_DATA', 'ALERT_FLAG', 'RUN_ID', 'APP_USER'];
            AG.pageResult('Watch history · ' + w.name, cols.map(function (c) { return c.toLowerCase(); }), r.map(function (x) { return cols.map(function (c) { return x[c]; }); }));
            CODE.showTab('chat'); AG.toggleResults && AG.toggleResults(true, true);
        }).catch(function (e) { toast(String(e), 'err'); });
    };
    VISION.watchToChat = function () {
        var w = W.list.filter(function (x) { return x.id === W.sel; })[0]; if (!w) return;
        var st = ((W.status[w.id] || {}).status) || {}, ev = W.events[w.id] || [];
        var img = $('vw-frame') && $('vw-frame').src;
        if (img && /^data:image/.test(img)) { AG.files.push({ name: 'watch-' + w.id + '.jpg', media_type: 'image/jpeg', data: img.split(',')[1] }); AG.renderFiles(); }
        CODE.showTab('chat');
        $('input').value = 'Vision watch "' + w.name + '" (' + modeOf(w.mode)[2] + ', ' + srcText(w.source) + '): state ' + (st.state || '?') + ', counts ' + JSON.stringify(st.counts || {}) + ', ' + ev.length + ' event(s); last: ' +
            ev.slice(-5).map(function (e) { return VISION.watchEvText(e).replace(/<[^>]+>/g, ''); }).join(' | ') + '\n\n';
        $('input').focus();
    };

    // ═════ editor ═════
    VISION.watchEdit = function (id) {
        if (!VISION.admin) { toast('Only an AI admin can add or change watches', 'err'); return; }
        var w = id ? W.list.filter(function (x) { return x.id === id; })[0] : null;
        W.edit = w ? JSON.parse(JSON.stringify(w)) : { name: '', mode: 'motion', source: { kind: 'camera', index: 0 }, zones: [], line: null, schedule: {}, options: { sensitivity: 50 }, alerts: { apex: true } };
        W.edit.options = W.edit.options || {}; W.edit.alerts = W.edit.alerts || {}; W.edit.schedule = W.edit.schedule || {}; W.edit.zones = W.edit.zones || [];
        W.draw = { tool: W.edit.mode === 'line' ? 'line' : 'zone', pts: [], img: null };
        VISION.watchRenderEdit();
    };
    VISION.watchRenderEdit = function () {
        var e = W.edit, s = e.source, o = e.options, sc = e.schedule, al = e.alerts;
        var opt = function (k, label, def, step, title) { return '<label class="sm" title="' + esc(title || '') + '">' + esc(label) + ' <input type="number" data-o="' + k + '" value="' + (o[k] != null ? o[k] : def != null ? def : '') + '" step="' + (step || 1) + '" style="width:72px"></label>'; };
        var modeOpts = {
            motion: opt('sensitivity', 'Sensitivity 1–100', 50, 5, 'Higher = smaller movements count') + opt('cooldown_s', 'Quiet after (s)', 10, 1, 'Seconds without movement before the zone counts as quiet again') + opt('min_area_pct', 'Min moving % of zone', '', 0.1, 'Empty = from the sensitivity'),
            line: '<label class="sm">Count <select data-o="detector"><option value="motion"' + (o.detector !== 'yolo' ? ' selected' : '') + '>anything that moves</option><option value="yolo"' + (o.detector === 'yolo' ? ' selected' : '') + '>YOLO objects</option></select></label>' +
                '<label class="sm">Only (YOLO) <input type="text" data-o="classes" value="' + esc(o.classes || '') + '" placeholder="person, truck" style="width:120px"></label>' + opt('sensitivity', 'Sensitivity', 50, 5) + opt('max_move', 'Max move per frame (0–1)', 0.12, 0.01, 'How far one object may move between frames, as a share of the picture'),
            scan: opt('every', 'Read every Nth frame', 5, 1) + opt('repeat_s', 'Same code again after (s)', 5, 1),
            detect: '<label class="sm">Model <select data-o="model">' + VISION.modelOpts().map(function (x) { return '<option value="' + x[0] + '"' + ((o.model || 'yolo11n') === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></label>' +
                '<label class="sm">Only <input type="text" data-o="classes" value="' + esc(o.classes || '') + '" placeholder="person, truck, car" style="width:130px"></label>' + opt('conf', 'Confidence ≥', 0.35, 0.05) + opt('every', 'Every Nth frame', 5, 1)
        };
        $('vw-main').innerHTML = '<div class="vz-rhead"><b><i class="fa-solid fa-pen"></i> ' + (e.id ? 'Edit watch' : 'New watch') + '</b><span class="grow"></span>' +
            (e.id ? '<button class="btn sm" onclick="VISION.watchDelete()"><i class="fa-regular fa-trash-can"></i> Delete</button>' : '') +
            '<button class="btn sm" onclick="VISION.watchCancel()">Cancel</button><button class="btn sm primary" onclick="VISION.watchSaveDef()"><i class="fa-solid fa-floppy-disk"></i> Save</button></div>' +
            '<div class="vw-form">' +
            '<label class="sm">Name <input type="text" id="vw-name" value="' + esc(e.name || '') + '" placeholder="Dock door 3 / Night watch store" style="width:220px"></label>' +
            '<div class="row sm"><b>Source</b> <select id="vw-kind"><option value="camera">Camera on this PC</option><option value="rtsp">IP / CCTV camera (RTSP)</option><option value="file">Video file</option></select>' +
            '<span id="vw-srcfields"></span></div>' +
            '<div class="row sm"><b>Watch for</b> <span class="seg sm" id="vw-modes">' + MODES.map(function (m) { return '<button data-m="' + m[0] + '" class="' + (e.mode === m[0] ? 'on' : '') + '"><i class="fa-solid ' + m[1] + '"></i> ' + m[2] + '</button>'; }).join('') + '</span></div>' +
            '<div class="row sm vw-opts">' + modeOpts[e.mode] + opt('step', 'Use every Nth frame', 1, 1, 'Skip frames to save CPU (line counting needs every frame for fast objects)') +
            '<label class="sm"><input type="checkbox" data-o="snapshots"' + (o.snapshots !== false ? ' checked' : '') + '> snapshots</label>' +
            (s.kind === 'file' ? '<label class="sm" title="Play the file at its real speed instead of as fast as possible"><input type="checkbox" data-o="realtime"' + (o.realtime ? ' checked' : '') + '> real speed</label>' : '') + '</div>' +
            '<div class="row sm"><b>Alert hours</b> ' + DAYS.map(function (d, i) { return '<label><input type="checkbox" data-day="' + i + '"' + ((sc.days || []).indexOf(i) >= 0 ? ' checked' : '') + '> ' + d + '</label>'; }).join(' ') +
            ' from <input type="time" id="vw-from" value="' + esc(sc.from || '') + '"> to <input type="time" id="vw-to" value="' + esc(sc.to || '') + '"> <span class="muted">(empty = always; 18:00 → 07:00 runs over midnight)</span></div>' +
            '<div class="row sm"><b>Then</b> <label><input type="checkbox" id="vw-apex"' + (al.apex !== false ? ' checked' : '') + '> save events in APEX</label>' +
            '<label><input type="checkbox" id="vw-alert"' + (al.on ? ' checked' : '') + '> send alerts</label> <input type="text" id="vw-hook" value="' + esc(al.hook || '') + '" placeholder="Teams webhook (optional)" style="width:170px">' +
            '<input type="text" id="vw-email" value="' + esc(al.email || '') + '" placeholder="e-mail (optional)" style="width:150px"> at most every <input type="number" id="vw-gap" value="' + (al.gap_s || 120) + '" style="width:60px"> s' +
            ' <span class="muted">(AI Control alert settings are used when both are empty)</span></div></div>' +
            '<div class="vw-draw"><div class="row sm"><button class="btn sm" onclick="VISION.watchGrab()"><i class="fa-solid fa-camera"></i> Get a picture</button>' +
            '<span id="vw-atwrap" hidden>at <input type="number" id="vw-at" value="0" min="0" step="1" style="width:60px"> s</span>' +
            '<span class="seg sm" id="vw-tools"><button data-t="zone"><i class="fa-solid fa-draw-polygon"></i> Zone</button><button data-t="line"><i class="fa-solid fa-slash"></i> Line</button></span>' +
            '<span id="vw-drawhelp" class="muted"></span><span class="grow"></span><button class="btn sm" onclick="VISION.watchClearDraw()"><i class="fa-solid fa-eraser"></i> Clear</button>' +
            '<button class="btn sm" id="vw-swap" onclick="VISION.watchSwap()" title="Swap IN and OUT"><i class="fa-solid fa-right-left"></i> Swap in/out</button></div>' +
            '<div class="vw-cvwrap"><canvas id="vw-cv"></canvas><div class="vw-ph" id="vw-cvph">Press "Get a picture", then draw ' + (e.mode === 'line' ? 'the counting line (2 clicks)' : 'zones (click the corners, click the first point to close)') + '.</div></div>' +
            '<div id="vw-zones" class="sm"></div></div>';
        $('vw-kind').value = s.kind || 'camera';
        $('vw-kind').onchange = function () { e.source = { kind: this.value, index: 0 }; VISION.watchRenderEdit(); };
        VISION.watchSrcFields();
        $('vw-modes').querySelectorAll('button').forEach(function (b) { b.onclick = function () { VISION.watchCollect(); e.mode = b.dataset.m; W.draw.tool = e.mode === 'line' ? 'line' : 'zone'; VISION.watchRenderEdit(); }; });
        $('vw-main').querySelectorAll('[data-o]').forEach(function (el) {
            el.onchange = function () { o[el.dataset.o] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? null : +el.value) : el.value; };
        });
        $('vw-tools').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === W.draw.tool); b.onclick = function () { W.draw.tool = b.dataset.t; W.draw.pts = []; VISION.watchRenderEdit(); }; });
        $('vw-atwrap').hidden = s.kind !== 'file';
        $('vw-swap').hidden = !e.line;
        $('vw-drawhelp').textContent = W.draw.tool === 'line' ? 'click 2 points: the arrow shows IN' : 'click the corners, click the first point to close';
        VISION.watchWireCanvas();
        VISION.watchDrawCv();
    };
    VISION.watchSrcFields = function () {
        var s = W.edit.source, el = $('vw-srcfields');
        if (s.kind === 'camera') el.innerHTML = ' number <input type="number" id="vw-index" min="0" max="9" value="' + (s.index || 0) + '" style="width:50px"> <span class="muted">(0 = the first camera)</span>';
        else if (s.kind === 'rtsp') el.innerHTML = ' <input type="password" id="vw-url" placeholder="' + esc(s.has_url ? 'saved: ' + s.url_masked + ' — type to replace' : 'rtsp://<user>:<password>@<camera-ip>:554/stream1') + '" style="width:320px" autocomplete="off"> <span class="muted">kept encrypted on this PC</span>';
        else el.innerHTML = ' <button class="btn sm" onclick="VISION.watchPickVideo()"><i class="fa-regular fa-folder-open"></i> Pick a video…</button> <span id="vw-file" class="muted">' + esc(s.file || (s.video_token ? s.video_name : 'none')) + '</span>';
    };
    VISION.watchPickVideo = function () {
        cmd({ action: 'visionPickVideo' }, 600000).then(function (d) {
            if (!d.ok) { if (!d.cancelled) toast(d.error || 'failed', 'err'); return; }
            W.edit.source.video_token = d.token; W.edit.source.video_name = d.file; W.edit.source.file = d.file;
            $('vw-file').textContent = d.file + ' (' + d.mb + ' MB)';
            if (!W.edit.name) $('vw-name').value = d.file.replace(/\.[^.]+$/, '');
            VISION.watchGrab();
        }).catch(function (e) { toast(String(e), 'err'); });
    };
    VISION.watchSourceForHost = function () {
        var s = W.edit.source, out = { kind: s.kind };
        if (s.kind === 'camera') out.index = +(($('vw-index') || {}).value || 0);
        if (s.kind === 'rtsp') out.url = ($('vw-url') || {}).value || '';
        if (s.kind === 'file' && s.video_token) out.video_token = s.video_token;
        return out;
    };
    VISION.watchGrab = function () {
        $('vw-cvph').hidden = false; $('vw-cvph').textContent = 'Getting a picture…';
        cmd({ action: 'visionWatchPreview', id: W.edit.id || '', source: VISION.watchSourceForHost(), at_s: +(($('vw-at') || {}).value || 0) }, 60000).then(function (d) {
            if (!d.ok) throw d.error;
            var img = new Image();
            img.onload = function () { W.draw.img = img; $('vw-cvph').hidden = true; VISION.watchDrawCv(); };
            img.src = 'data:' + d.media_type + ';base64,' + d.data;
            if (d.info && d.info.length_s && $('vw-at')) $('vw-at').max = Math.floor(d.info.length_s);
        }).catch(function (e) { $('vw-cvph').textContent = String(e); });
    };
    VISION.watchCvSize = function () {
        var img = W.draw.img, maxW = Math.min(980, ($('vw-main').clientWidth || 900) - 24);
        var w = img ? img.width : 960, h = img ? img.height : 540, k = Math.min(1, maxW / w, 520 / h);
        return [Math.round(w * k), Math.round(h * k)];
    };
    VISION.watchDrawCv = function () {
        var cv = $('vw-cv'); if (!cv) return;
        var sz = VISION.watchCvSize(); cv.width = sz[0]; cv.height = sz[1];
        var g = cv.getContext('2d'), e = W.edit, W0 = cv.width, H0 = cv.height;
        g.fillStyle = '#0f172a'; g.fillRect(0, 0, W0, H0);
        if (W.draw.img) g.drawImage(W.draw.img, 0, 0, W0, H0);
        g.lineWidth = 3; g.font = '700 13px Segoe UI, sans-serif';
        (e.zones || []).forEach(function (z, i) {
            var p = z.points || z; g.beginPath(); p.forEach(function (q, j) { if (j) g.lineTo(q[0] * W0, q[1] * H0); else g.moveTo(q[0] * W0, q[1] * H0); }); g.closePath();
            g.fillStyle = 'rgba(245,158,11,.18)'; g.fill(); g.strokeStyle = '#f59e0b'; g.stroke();
            g.fillStyle = '#f59e0b'; g.fillText(z.name || 'Zone ' + (i + 1), p[0][0] * W0 + 4, p[0][1] * H0 + 16);
        });
        if (W.draw.pts.length) {
            g.strokeStyle = '#22d3ee'; g.beginPath(); W.draw.pts.forEach(function (q, j) { if (j) g.lineTo(q[0] * W0, q[1] * H0); else g.moveTo(q[0] * W0, q[1] * H0); }); g.stroke();
            W.draw.pts.forEach(function (q) { g.fillStyle = '#22d3ee'; g.fillRect(q[0] * W0 - 4, q[1] * H0 - 4, 8, 8); });
        }
        if (e.line) {
            var a = [e.line[0][0] * W0, e.line[0][1] * H0], b = [e.line[1][0] * W0, e.line[1][1] * H0];
            g.strokeStyle = '#facc15'; g.lineWidth = 4; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
            // IN = the side the normal (-dy, dx) points to — the same rule as vision.py crosses()
            var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, len = 46;
            // one arrow across the line: its head is the IN side, its tail the OUT side
            var x0 = mx - nx * len, y0 = my - ny * len, x1 = mx + nx * len, y1 = my + ny * len, an = Math.atan2(y1 - y0, x1 - x0);
            g.strokeStyle = '#16a34a'; g.fillStyle = '#16a34a'; g.lineWidth = 4; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
            g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - 14 * Math.cos(an - 0.45), y1 - 14 * Math.sin(an - 0.45)); g.lineTo(x1 - 14 * Math.cos(an + 0.45), y1 - 14 * Math.sin(an + 0.45)); g.fill();
            var lab = function (txt, x, y, col) { var tw = g.measureText(txt).width; g.fillStyle = 'rgba(15,23,42,.75)'; g.fillRect(x - tw / 2 - 5, y - 10, tw + 10, 20); g.fillStyle = col; g.fillText(txt, x - tw / 2, y + 5); };
            lab('IN', x1 + nx * 18, y1 + ny * 18, '#4ade80');
            lab('OUT', x0 - nx * 18, y0 - ny * 18, '#f87171');
        }
        $('vw-zones').innerHTML = (e.zones || []).map(function (z, i) {
            return '<span class="tag">' + '<input type="text" data-zn="' + i + '" value="' + esc(z.name || 'Zone ' + (i + 1)) + '" style="width:110px;border:0;background:none"> <button class="icon" data-zx="' + i + '" title="Remove">×</button></span>';
        }).join(' ') + (e.mode !== 'line' && !(e.zones || []).length ? '<span class="muted">No zones: the whole picture is watched.</span>' : '') + (e.mode === 'line' && !e.line ? '<span class="tag b-warn">draw the counting line</span>' : '');
        $('vw-zones').querySelectorAll('[data-zn]').forEach(function (el) { el.onchange = function () { e.zones[+el.dataset.zn].name = el.value; VISION.watchDrawCv(); }; });
        $('vw-zones').querySelectorAll('[data-zx]').forEach(function (el) { el.onclick = function () { e.zones.splice(+el.dataset.zx, 1); VISION.watchDrawCv(); }; });
    };
    VISION.watchWireCanvas = function () {
        var cv = $('vw-cv');
        cv.onclick = function (ev) {
            var r = cv.getBoundingClientRect(), p = [Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))];
            var e = W.edit, d = W.draw;
            if (d.tool === 'line') {
                d.pts.push(p);
                if (d.pts.length === 2) { e.line = [d.pts[0], d.pts[1]]; d.pts = []; $('vw-swap').hidden = false; }
            } else {
                var f = d.pts[0];
                if (f && d.pts.length >= 3 && Math.hypot((f[0] - p[0]) * r.width, (f[1] - p[1]) * r.height) < 14) {
                    e.zones.push({ name: 'Zone ' + (e.zones.length + 1), points: d.pts.map(function (q) { return [+q[0].toFixed(4), +q[1].toFixed(4)]; }) }); d.pts = [];
                } else d.pts.push(p);
            }
            VISION.watchDrawCv();
        };
        cv.ondblclick = function () {
            var d = W.draw; if (d.tool !== 'zone' || d.pts.length < 3) return;
            W.edit.zones.push({ name: 'Zone ' + (W.edit.zones.length + 1), points: d.pts.slice(0, -1).map(function (q) { return [+q[0].toFixed(4), +q[1].toFixed(4)]; }) }); d.pts = []; VISION.watchDrawCv();
        };
    };
    VISION.watchSwap = function () { var l = W.edit.line; if (l) { W.edit.line = [l[1], l[0]]; VISION.watchDrawCv(); } };
    VISION.watchClearDraw = function () { if (W.draw.tool === 'line') W.edit.line = null; else W.edit.zones = []; W.draw.pts = []; VISION.watchDrawCv(); };
    VISION.watchCollect = function () {
        var e = W.edit; if (!$('vw-name')) return;
        e.name = $('vw-name').value.trim();
        var days = Array.prototype.map.call($('vw-main').querySelectorAll('[data-day]:checked'), function (x) { return +x.dataset.day; });
        e.schedule = { days: days, from: $('vw-from').value, to: $('vw-to').value };
        e.alerts = { apex: $('vw-apex').checked, on: $('vw-alert').checked, hook: $('vw-hook').value.trim(), email: $('vw-email').value.trim(), gap_s: +$('vw-gap').value || 120 };
        if (e.source.kind === 'camera') e.source.index = +(($('vw-index') || {}).value || 0);
        if (e.source.kind === 'rtsp') e.source.url = ($('vw-url') || {}).value || '';
    };
    VISION.watchSaveDef = function () {
        VISION.watchCollect();
        var e = W.edit;
        if (e.mode === 'line' && !e.line) { toast('Draw the counting line first (Get a picture → Line → 2 clicks)', 'err'); return; }
        if (e.mode === 'detect' && !(VISION.status || {}).yolo) { toast('Objects (YOLO) needs YOLO on this PC (Photo · OpenCV › YOLO + PyTorch)', 'err'); return; }
        if (e.alerts.hook && !/^https:\/\//i.test(e.alerts.hook)) { toast('The Teams webhook must be an https address', 'err'); return; }
        var src = VISION.watchSourceForHost();
        var body = { id: e.id || '', name: e.name, mode: e.mode, source: src, zones: e.zones, line: e.mode === 'line' ? e.line : null, schedule: e.schedule, options: e.options, alerts: e.alerts };
        cmd({ action: 'visionWatchSave', watch: body }).then(function (d) {
            if (d.ok === false) throw d.error;
            W.edit = null; W.sel = d.watch.id; toast('Saved', 'ok');
            return VISION.watchLoad();
        }).catch(function (er) { toast(String(er), 'err'); });
    };
    VISION.watchCancel = function () { W.edit = null; VISION.watchRenderView(); };
    VISION.watchDelete = function () {
        var e = W.edit; if (!e || !e.id || !confirm('Delete the watch "' + e.name + '"? It is stopped and its snapshots on this PC are removed (events saved in APEX stay).')) return;
        cmd({ action: 'visionWatchDelete', id: e.id }).then(function (d) { if (d.ok === false) throw d.error; W.edit = null; W.sel = null; return VISION.watchLoad(); }).catch(function (er) { toast(String(er), 'err'); });
    };

    // ── the agent's vision_watch tool (read): list, status, events ──
    AG.tool('vision_watch', function (inp) {
        var op = inp.op || 'list';
        return cmd({ action: 'visionWatchList' }).then(function (d) {
            W.list = d.watches || W.list;
            if (op === 'list') {
                var rowsL = W.list.map(function (w) { return [w.id, w.name, modeOf(w.mode)[2], srcText(w.source), w.running ? 'running' : 'stopped']; });
                return { ok: true, content: rowsL.length ? 'Vision watches:\n' + rowsL.map(function (r) { return '- ' + r[1] + ' (' + r[0] + '): ' + r[2] + ', ' + r[3] + ', ' + r[4]; }).join('\n') : 'No vision watches are set up on this PC.',
                    data: rowsL.length ? { title: 'Vision watches', columns: ['id', 'name', 'mode', 'source', 'state'], rows: rowsL } : undefined };
            }
            var w = W.list.filter(function (x) { return x.id === inp.id || (inp.name && x.name.toLowerCase() === String(inp.name).toLowerCase()); })[0];
            if (!w) return { ok: false, content: 'No watch ' + (inp.id || inp.name || '') + '. Use op list first.' };
            if (op === 'history') {
                return VISION.watchEnsureTable().then(function () {
                    return rows("SELECT TO_CHAR(event_at, 'YYYY-MM-DD HH24:MI:SS') AS at, event_type, zone, direction, label, code_data, alert_flag FROM wms_vision_events WHERE watch_id = " + q(w.id) +
                        (inp.since ? " AND event_at >= TO_DATE(" + q(String(inp.since).slice(0, 19).replace('T', ' ')) + ", 'YYYY-MM-DD HH24:MI:SS')" : '') + ' ORDER BY event_at DESC', Math.min(+inp.max || 500, 2000));
                }).then(function (r) {
                    var cols = ['AT', 'EVENT_TYPE', 'ZONE', 'DIRECTION', 'LABEL', 'CODE_DATA', 'ALERT_FLAG'], data = r.map(function (x) { return cols.map(function (c) { return x[c]; }); });
                    var by = {}; r.forEach(function (x) { var k = x.EVENT_TYPE + (x.DIRECTION ? ' ' + x.DIRECTION : ''); by[k] = (by[k] || 0) + 1; });
                    return { ok: true, content: 'Watch "' + w.name + '" saved events' + (inp.since ? ' since ' + inp.since : '') + ': ' + r.length + ' — ' + JSON.stringify(by), data: { title: 'Watch history · ' + w.name, columns: cols.map(function (c) { return c.toLowerCase(); }), rows: data } };
                });
            }
            return cmd({ action: 'visionWatchStatus', id: w.id, after: 0, frame: op === 'status' && !!inp.picture }).then(function (s) {
                var st = s.status || {}, ev = (s.events || []).slice(-40);
                var out = { ok: true, content: 'Watch "' + w.name + '" (' + modeOf(w.mode)[2] + ', ' + srcText(w.source) + '): ' + (s.running ? 'running' : 'not running') + ', state ' + (st.state || '—') +
                    ', counts ' + JSON.stringify(st.counts || {}) + (st.total ? ', video ' + st.progress + ' % done' : '') + ', ' + (s.events || []).length + ' event(s) in the current run' +
                    (ev.length ? '\nLast events:\n' + ev.map(function (e) { return '- ' + String(e.at || '').replace('T', ' ') + (e.video_s != null ? ' (video ' + fmtS(e.video_s) + ')' : '') + ': ' + VISION.watchEvText(e).replace(/<[^>]+>/g, ''); }).join('\n') : '') };
                if (s.frame) out.attachment = { name: 'watch-' + w.id + '.jpg', media_type: 'image/jpeg', data: s.frame };
                return out;
            });
        });
    });

    // pick up watches that kept running (the app runs them, this page only shows them) — and keep logging their events
    setTimeout(function () { if (typeof hasHost === 'function' && hasHost()) VISION.watchLoad(); }, 4000);
})();
