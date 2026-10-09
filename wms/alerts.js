// ============================================================================
// WMS ALERTS — every n minutes the WMS checks the trips of today and tomorrow on the toolbar's instance and tells you:
//   Pending cancellations  lines the cancellation rule would cancel now and nobody has (W2CR.expand, the Shipping Agent's Task 2)
//   No picker              sales orders on a trip without a picker, not shipped yet
//   Not interfaced to MRA  sales orders whose latest MRA try is not SUCCESS / ALREADY_DONE (failed, skipped, never sent)
//   Order errors           a main line Cancelled while its BOGO free item / sub-line is not
// The rules are wms/alert-rules.js (WMSAL, node-tested). The data is the DuckDB copy the MRA Interface already builds:
// every check runs MraInterface.sync(pod, date) — the trips + orders + MRA statuses from APEX, DuckDB w2_mri_* overwritten —
// then reads every trip's WMS order lines (getsalesorderlinesbytrip, 3 trips at a time) and the BOGO map, runs the rules
// and keeps the findings in its own tables w2_nt_runs / w2_nt_items (first_seen carried from the earlier run of the date,
// so every finding says since when). The bell gets one card per category (the previous check's cards are replaced), a toast
// when the counts changed, and the header's radar button shows the total; the dialog (card / button click) has one tab per
// category with a grid, filter, CSV and the actions (open the trip, the order dialog, Interface to MRA, the autopilot page),
// a Date + Search for ANY date (live read, kept in DuckDB) and the period select 15 / 30 / 45 / 60 / 120 min (this PC).
// Opening the dialog draws the date from memory, else from DuckDB (as of …); Search / Check now read APEX again.
// ============================================================================
(function () {
    'use strict';
    var ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP';
    var WM = ORDS + '/WAREHOUSEMANAGEMENT', TM = ORDS + '/TRIPMANAGEMENT';
    var SENDER = 'WMS alerts', KEY = 'wms.alerts', EVERY = [15, 30, 45, 60, 120];
    var DEFAULTS = { on: true, every: 30, today: true, tomorrow: true };
    var A = window.WMSAL, R = window.W2CR;
    if (!A || !R) { console.warn('[Alerts] alert-rules.js / cancel-rules.js not loaded'); return; }

    // ─── helpers ───────────────────────────────────────────────────────────────
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var lit = function (s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; };
    var pad2 = function (n) { return ('0' + n).slice(-2); };
    var iso = function (d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
    var today = function () { return iso(new Date()); };
    var addDays = function (s, n) { var d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
    var now = function () { var d = new Date(); return iso(d) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); };
    var ddmmyyyy = function (s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : String(s || ''); };
    var enc = encodeURIComponent;
    function dayWord(s) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); if (!m) return s || '';
        var d = new Date(+m[1], +m[2] - 1, +m[3]), t = new Date(); t.setHours(0, 0, 0, 0);
        var diff = Math.round((d - t) / 86400000);
        return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + ddmmyyyy(s);
    }
    function hm(t) { var m = /T(\d{2}):(\d{2})/.exec(String(t || '')); return m ? m[1] + ':' + m[2] : ''; }
    function ago(t) { if (!t) return ''; var s = Math.max(0, (Date.now() - new Date(String(t)).getTime()) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; }
    function since(t) { var s = t ? (Date.now() - new Date(String(t)).getTime()) / 60000 : 0; return { text: t ? 'since ' + hm(t) + (s >= 1440 ? ' (' + Math.floor(s / 1440) + ' d)' : s >= 60 ? ' (' + Math.floor(s / 60) + ' h)' : '') : '', old: s >= 120 }; }
    function items(r) { if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return []; } } return Array.isArray(r) ? r : (r && Array.isArray(r.items)) ? r.items : []; }
    function user() { try { return localStorage.getItem('wms_user') || sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || 'WMS'; } catch (e) { return 'WMS'; } }
    function pc() { try { var raw = localStorage.getItem('w2.pcid'), v = raw && raw.charAt(0) === '"' ? JSON.parse(raw) : raw; return v || 'PC'; } catch (e) { return 'PC'; } }
    function ls(k, v) { try { if (v === undefined) { var s = localStorage.getItem(k); return s == null ? null : JSON.parse(s); } localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } return v; }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function pool(list, n, fn) {
        var i = 0;
        var next = function () { if (i >= list.length) return Promise.resolve(); var idx = i++; return Promise.resolve().then(function () { return fn(list[idx], idx); }).catch(function (e) { console.warn('[Alerts] pooled call failed:', e && e.message || e); }).then(next); };
        var w = []; for (var k = 0; k < Math.min(n, list.length); k++) w.push(next());
        return Promise.all(w);
    }
    function hosted() { return !!(window.chrome && window.chrome.webview && typeof sendMessageToCSharp === 'function'); }
    function host(msg, ms) {
        return new Promise(function (resolve, reject) {
            if (!hosted()) { reject(new Error('Open this inside the Gray\'s WMS app.')); return; }
            sendMessageToCSharp(msg, function (err, data) {
                if (err) { reject(new Error(typeof err === 'string' ? err : (err.message || JSON.stringify(err)))); return; }
                var r = data; if (typeof data === 'string') { try { r = JSON.parse(data); } catch (e) { r = data; } }
                resolve(r);
            }, ms || 120000, false);
        });
    }
    function get(url, ms) { return host({ action: 'executeGet', fullUrl: url }, ms || 120000); }
    function curInstance() {
        var el = document.getElementById('current-instance-display'), v = el ? String(el.textContent || '').trim().toUpperCase() : '';
        if (!v) { try { v = String(sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || localStorage.getItem('wms_instance') || '').toUpperCase(); } catch (e) { v = ''; } }
        return v || 'PROD';
    }
    function note(m, t) { if (typeof showNotification === 'function') showNotification(m, t || 'info'); else console.log('[Alerts]', m); }

    // ─── state ─────────────────────────────────────────────────────────────────
    var st = {
        settings: Object.assign({}, DEFAULTS, ls(KEY) || {}),
        running: false, step: '', open: false, pod: curInstance(),
        last: {},                       // pod|date → the latest result {pod, date, items, summary, at, trips, orders, errors, src}
        lastRun: ls(KEY + '.run') || {},// pod → the auto run: {at, summary (both dates added up), dates}
        view: { date: today(), tab: 'CANCEL', grep: '' },
        busy: {}, live: {}, timer: null
    };
    if (EVERY.indexOf(+st.settings.every) < 0) st.settings.every = DEFAULTS.every;
    function save() { ls(KEY, st.settings); }
    function keyOf(pod, date) { return pod + '|' + date; }
    function autoDates() { var d = []; if (st.settings.today) d.push(today()); if (st.settings.tomorrow) d.push(addDays(today(), 1)); return d; }

    // ─── DuckDB (the WMS 2.0 file; best effort — everything works without it for the session) ───
    var COLS = {
        w2_nt_runs: ['pod', 'run_id', 'trip_date', 'mode', 'started_at', 'ended_at', 'ms', 'n_trips', 'n_orders', 'n_cancel', 'n_picker', 'n_mra', 'n_error', 'errors', 'pc', 'by_user'],
        w2_nt_items: ['pod', 'trip_date', 'run_id', 'kind', 'key', 'trip_id', 'lorry', 'bay', 'priority', 'order_number', 'customer', 'order_type', 'line_number', 'item', 'status', 'detail', 'via', 'child_of', 'child_line', 'child_item', 'child_status', 'fid', 'printed', 'released', 'tries', 'why', 'first_seen', 'read_at', 'raw_json']
    };
    var DB = {
        host: null, probing: null, io: Promise.resolve(),
        call: function (action, payload, ms, attempt) {
            return host(Object.assign({ action: action, appUser: user() }, payload || {}), ms || 120000).then(function (d) {
                var busy = d && d.ok === false && (d.busy || /another .*window|busy/i.test(String(d.error || '')));
                if (busy && (attempt || 0) < 3) return sleep(1500 + 1500 * (attempt || 0)).then(function () { return DB.call(action, payload, ms, (attempt || 0) + 1); });
                return d;
            });
        },
        probe: function () {
            if (DB.probing) return DB.probing;
            DB.probing = DB.call('w2Status', {}, 15000).then(function (d) { DB.host = !!(d && d.ok !== false); return DB.host; }, function () { DB.host = false; return false; });
            return DB.probing;
        },
        on: function () { return DB.host === true; },
        rowsOf: function (d) { var cols = (d.columns || []).map(function (c) { return String(c).toLowerCase(); }); return (d.rows || []).map(function (r) { var o = {}; cols.forEach(function (c, i) { o[c] = r[i]; }); return o; }); },
        qs: function (list) {
            if (!DB.on() || !list.length) return Promise.resolve(list.map(function () { return []; }));
            return DB.io.then(function () { return DB.call('w2Queries', { queries: list }); })
                .then(function (d) { return ((d && d.results) || []).map(function (r) { if (!r || r.error) return []; return DB.rowsOf(r); }); }, function () { return list.map(function () { return []; }); });
        },
        put: function (table, scope, rows, allowEmpty) {
            if (!DB.on() || (!rows.length && !allowEmpty)) return Promise.resolve();
            var clean = rows.map(function (r) { var o = {}; COLS[table].forEach(function (k) { var v = r[k]; o[k] = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); }); return o; });
            var p = DB.io.then(function () { return DB.call('w2Put', { table: table, scope: scope, rows: clean, replaceAll: false, columns: COLS[table] }, 300000); });
            DB.io = p.catch(function (e) { console.warn('[Alerts] DuckDB write failed:', e && e.message || e); });
            return p.catch(function () {});
        }
    };
    function fromDb(v) { return v == null ? '' : String(v); }
    /** The latest kept findings of a date on this PC → result | null. */
    function loadDate(pod, date) {
        return DB.probe().then(function () {
            if (!DB.on()) return null;
            var where = ' WHERE pod = ' + lit(pod) + ' AND trip_date IN (' + lit(date) + ')';
            return DB.qs(['SELECT ' + COLS.w2_nt_runs.join(', ') + ' FROM w2_nt_runs' + where, 'SELECT ' + COLS.w2_nt_items.join(', ') + ' FROM w2_nt_items' + where]).then(function (q) {
                var runs = q[0].sort(function (a, b) { return fromDb(a.ended_at) < fromDb(b.ended_at) ? 1 : -1; }), run = runs[0];
                if (!run) return null;
                var list = q[1].filter(function (r) { return fromDb(r.run_id) === fromDb(run.run_id); }).map(function (r) {
                    var it = {}; COLS.w2_nt_items.forEach(function (k) { it[k] = fromDb(r[k]); });
                    it.printed = it.printed === 'true'; it.released = it.released === 'true'; it.tries = Number(it.tries) || 0;
                    if (it.raw_json) { try { it.raw = JSON.parse(it.raw_json); } catch (e) { it.raw = null; } } delete it.raw_json;
                    return it;
                });
                return { pod: pod, date: date, items: list, summary: A.summary(list), at: fromDb(run.ended_at), trips: Number(run.n_trips) || 0, orders: Number(run.n_orders) || 0, errors: run.errors ? String(run.errors).split(' | ').filter(Boolean) : [], src: 'db', mode: fromDb(run.mode) };
            });
        });
    }

    // ─── reads ─────────────────────────────────────────────────────────────────
    function linesOfTrip(pod, trip) { return get(TM + '/trip/orders/getsalesorderlinesbytrip/' + enc(trip) + '?P_INSTANCE_NAME=' + enc(pod)).then(items); }
    var bogoCache = {};
    function bogo(pod) {
        var c = bogoCache[pod];
        if (c && Date.now() - c.at < 12 * 3600000) return Promise.resolve(c.map);
        return get(ORDS + '/ARMODULE/BOGO?p_instance_name=' + enc(pod)).then(function (j) { var map = R.bogoMap(items(j)); bogoCache[pod] = { at: Date.now(), map: map }; return map; }).catch(function () { return (c && c.map) || {}; });
    }
    /** One date LIVE: MraInterface.sync (trips, orders, MRA statuses → DuckDB) → the order lines of every trip → the rules → kept. */
    function check(pod, date, mode, say) {
        if (!window.MraInterface || typeof window.MraInterface.sync !== 'function') return Promise.reject(new Error('mra-interface.js is not loaded'));
        var t0 = Date.now(), started = now(), runId = 'NT' + Date.now().toString(36).toUpperCase(), errors = [], tell = function (t) { st.step = t; if (say) say(t); paintBtn(); paintStep(); };
        tell(dayWord(date) + ' · trips of ' + pod);
        return Promise.all([window.MraInterface.sync(pod, date, date, function (n, of, text) { tell(dayWord(date) + ' · ' + (text || 'trip ' + n + ' of ' + of)); }), bogo(pod)]).then(function (r) {
            var sync = r[0], bg = r[1], trips = sync.trips, lines = [], n = 0;
            if (sync.statusErr) errors.push('MRA statuses: ' + sync.statusErr);
            return pool(trips, 3, function (t) {
                return linesOfTrip(pod, t.trip_id).then(function (rows) { lines.push({ trip_id: t.trip_id, lines: rows }); }, function (e) { errors.push('trip ' + t.trip_id + ' lines: ' + (e && e.message || e)); })
                    .then(function () { n++; tell(dayWord(date) + ' · order lines of trip ' + n + ' of ' + trips.length); });
            }).then(function () {
                var list = A.run({ date: date, rows: sync.rows, trips: lines, bogo: bg }), byOrder = {}, tripOf = {};
                sync.rows.forEach(function (x) { byOrder[x.ORDER_NUMBER] = x; });
                trips.forEach(function (t) { tripOf[t.trip_id] = t; });
                list.forEach(function (it) {
                    var t = tripOf[it.trip_id]; if (t) { it.lorry = t.lorry || ''; it.bay = t.bay || ''; it.priority = t.priority || ''; if (!it.trip_date) it.trip_date = t.date || date; }
                    var row = byOrder[it.order_number]; if (row && row.RAW) it.raw = row.RAW;
                });
                return loadDate(pod, date).then(function (prev) {
                    var at = now(); A.carry(prev ? prev.items : [], list, at);
                    var res = { pod: pod, date: date, items: list, summary: A.summary(list), at: at, trips: trips.length, orders: sync.rows.length, errors: errors, src: 'live', mode: mode, ms: Date.now() - t0, hidden: sync.hidden };
                    st.last[keyOf(pod, date)] = res;
                    try { document.dispatchEvent(new CustomEvent('wms-alerts', { detail: { pod: pod, date: date, summary: res.summary } })); } catch (e) {}
                    var s = res.summary;
                    DB.put('w2_nt_items', { pod: pod, trip_date: [date] }, list.map(function (it) {
                        var o = {}; COLS.w2_nt_items.forEach(function (k) { o[k] = it[k]; }); o.pod = pod; o.trip_date = date; o.run_id = runId; o.raw_json = it.raw ? JSON.stringify(it.raw) : ''; return o;
                    }), true);
                    DB.put('w2_nt_runs', { pod: pod, run_id: runId }, [{ pod: pod, run_id: runId, trip_date: date, mode: mode, started_at: started, ended_at: at, ms: res.ms, n_trips: trips.length, n_orders: sync.rows.length, n_cancel: s.CANCEL.n, n_picker: s.PICKER.n, n_mra: s.MRA.n, n_error: s.ERROR.n, errors: errors.join(' | '), pc: pc(), by_user: user() }]);
                    return res;
                });
            });
        }).then(function (res) { st.step = ''; paintBtn(); paintStep(); return res; }, function (e) { st.step = ''; paintBtn(); paintStep(); throw e; });
    }

    // ─── the automatic run: today + tomorrow on the toolbar's instance → the bell ─────────
    function runAuto(byHand) {
        if (st.running) return Promise.resolve();
        if (!hosted()) { if (byHand) note('Open this inside the Gray\'s WMS app.', 'warning'); return Promise.resolve(); }
        var pod = curInstance(), dates = autoDates();
        if (!dates.length) { if (byHand) note('Tick Today or Tomorrow first.', 'warning'); return Promise.resolve(); }
        st.running = true; st.pod = pod; paintBtn();
        var results = [], failed = [];
        return dates.reduce(function (p, d) { return p.then(function () { return check(pod, d, byHand ? 'MANUAL' : 'AUTO').then(function (r) { results.push(r); }, function (e) { failed.push(dayWord(d) + ': ' + (e && e.message || e)); }); }); }, Promise.resolve()).then(function () {
            var prev = st.lastRun[pod], all = []; results.forEach(function (r) { all = all.concat(r.items); });
            var sum = A.summary(all), diff = A.diff(prev && prev.summary, sum);
            st.lastRun[pod] = { at: now(), summary: sum, dates: dates, failed: failed }; ls(KEY + '.run', st.lastRun);
            bell(pod, results, sum, diff, prev, failed);
            if (failed.length && byHand) note('Alerts: ' + failed.join(' · '), 'warning');
        }).catch(function (e) { console.warn('[Alerts] run failed:', e); if (byHand) note('Alerts: ' + (e && e.message || e), 'error'); })
            .then(function () { st.running = false; paintBtn(); if (st.open) render(); });
    }
    function due() { var r = st.lastRun[curInstance()]; return !r || !r.at || (Date.now() - new Date(r.at).getTime()) >= (+st.settings.every || 30) * 60000; }
    function nextIn() { var r = st.lastRun[curInstance()]; if (!st.settings.on) return 'paused'; if (!r || !r.at) return 'soon'; var m = Math.ceil(((+st.settings.every || 30) * 60000 - (Date.now() - new Date(r.at).getTime())) / 60000); return m <= 0 ? 'now' : 'in ' + m + ' min'; }
    function tick() { if (!st.settings.on || st.running || !hosted()) return; if (due()) runAuto(false); }   // runs in a background tab too (the host never suspends tabs)
    function start() { if (st.timer) return; st.timer = setInterval(tick, 30000); setTimeout(tick, 15000); }

    // ─── the bell: one card per category, the earlier check's cards replaced; a toast when the counts changed ───
    function bellText(kind, results) {
        return results.map(function (r) { return dayWord(r.date) + ': ' + A.message(kind, r.summary); }).join(' · ') || 'nothing read';
    }
    function bell(pod, results, sum, diff, prev, failed) {
        if (!Array.isArray(window._mobileNotifications)) return;
        var rest = window._mobileNotifications.filter(function (n) { return n.sender !== SENDER; }), at = new Date().toISOString();
        var cards = A.KINDS.map(function (k) { return { type: k.type, orderNumber: k.label, message: bellText(k.id, results) + (sum[k.id].n ? '' : ' ✓'), sender: SENDER, data: {}, receivedAt: at, kind: k.id, pod: pod }; });
        if (failed.length) cards.push({ type: 'alert', orderNumber: 'Check failed', message: failed.join(' · '), sender: SENDER, data: {}, receivedAt: at, kind: '', pod: pod });
        // newest first: the categories in order on top of everything else
        window._mobileNotifications = cards.concat(rest);
        if (window._mobileNotifications.length > 100) window._mobileNotifications.length = 100;
        if (!window._mobileNotifPanelOpen && (diff.changed || !prev)) { window._mobileUnread = (window._mobileUnread || 0) + A.KINDS.filter(function (k) { return sum[k.id].n > 0; }).length; }
        if (typeof window._updateMobileNotifBadge === 'function') window._updateMobileNotifBadge();
        if (typeof window._renderMobileNotifList === 'function') window._renderMobileNotifList();
        if (diff.changed && prev && typeof window._showMobileToast === 'function') {
            var worst = diff.up.length ? A.kind(diff.up[0]) : A.kind(diff.down[0]);
            try { window._showMobileToast({ type: diff.up.length ? 'alert' : 'status_change', sender: SENDER, orderNumber: '', message: diff.text, data: {}, receivedAt: at }); } catch (e) { console.warn('[Alerts] toast:', e); }
            if (worst && diff.up.length) note('WMS alerts: ' + worst.label + ' went up — ' + diff.text, 'warning');
        }
        paintBtn();
    }
    function isOurs(card) { var head = card && card.querySelector('span'); return !!(head && head.textContent.trim().indexOf(SENDER) === 0); }
    function kindOfCard(card) {
        var head = card && card.querySelector('span'), text = head ? head.textContent : '';
        for (var i = 0; i < A.KINDS.length; i++) if (text.indexOf(A.KINDS[i].label) >= 0) return A.KINDS[i].id;
        return '';
    }
    function decorateCards() {
        var list = document.getElementById('mobile-notif-list'); if (!list) return;
        list.querySelectorAll('.mobile-notif-card').forEach(function (card) { if (isOurs(card)) { card.classList.add('wa-notif'); card.title = 'Click to open the WMS alerts'; } });
    }
    (function wireBell() {
        var orig = window._renderMobileNotifList;
        if (typeof orig === 'function' && !orig._wa) {
            var w = function () { var r = orig.apply(this, arguments); decorateCards(); return r; }; w._wa = true;
            window._renderMobileNotifList = w;
        }
        document.addEventListener('click', function (e) {
            var card = e.target && e.target.closest ? e.target.closest('.mobile-notif-card') : null;
            if (!card || !isOurs(card)) return;
            if (typeof window.closeMobileNotifPanel === 'function') window.closeMobileNotifPanel();
            open(kindOfCard(card) || st.view.tab);
        }, true);
    })();

    // ─── the header button ─────────────────────────────────────────────────────
    function ensureBtn() {
        if (document.getElementById('wms-alerts-btn')) return;
        var bell = document.getElementById('mobile-notif-bell'), anchor = bell && bell.parentElement; if (!anchor || !anchor.parentElement) return;
        var wrap = document.createElement('div'); wrap.style.position = 'relative';
        wrap.innerHTML = '<button id="wms-alerts-btn" title="WMS alerts — pending cancellations, no picker, not interfaced to MRA, order errors"><i class="fas fa-satellite-dish"></i><span id="wms-alerts-badge">0</span></button>';
        anchor.parentElement.insertBefore(wrap, anchor);
        wrap.querySelector('button').addEventListener('click', function () { open(); });
        paintBtn();
    }
    function paintBtn() {
        var b = document.getElementById('wms-alerts-btn'), badge = document.getElementById('wms-alerts-badge'); if (!b) return;
        var r = st.lastRun[curInstance()], n = r && r.summary ? r.summary.total : 0;
        b.classList.toggle('busy', !!st.running); b.classList.toggle('has', n > 0 && !st.running);
        if (badge) { badge.style.display = n > 0 ? 'block' : 'none'; badge.textContent = n > 99 ? '99+' : n; }
        b.title = st.running ? 'WMS alerts — checking… ' + st.step : r && r.at ? 'WMS alerts — ' + A.KINDS.map(function (k) { return r.summary[k.id].n + ' ' + k.label.toLowerCase(); }).join(' · ') + ' · checked ' + ago(r.at) + ' · next ' + nextIn() : 'WMS alerts — not checked yet (every ' + st.settings.every + ' min)';
    }

    // ─── the dialog ────────────────────────────────────────────────────────────
    function current() { return st.last[keyOf(st.pod, st.view.date)] || null; }
    function open(tab) {
        st.pod = curInstance();
        if (tab && A.kind(tab)) st.view.tab = tab;
        if (!st.open) { st.open = true; st.view.grep = ''; }
        render();
        if (!current()) showDate(st.view.date);
    }
    function close() { st.open = false; var d = document.getElementById('wa-dlg'); if (d) d.remove(); }
    /** The date on screen: from memory, else this PC's DuckDB (as of …); nothing kept = says so (Search reads live). */
    function showDate(date) {
        st.view.date = date; st.view.grep = '';
        var k = keyOf(st.pod, date);
        if (st.last[k]) { render(); return Promise.resolve(); }
        st.busy.load = true; render();
        return loadDate(st.pod, date).then(function (r) { if (r) st.last[k] = r; }).catch(function () {}).then(function () { st.busy.load = false; render(); });
    }
    /** Search = the date read live (APEX + the order lines), kept in DuckDB. */
    function search(date) {
        if (st.busy.search) return Promise.resolve();
        date = date || st.view.date; st.view.date = date; st.view.grep = '';
        if (!hosted()) { note('Open this inside the Gray\'s WMS app.', 'warning'); render(); return Promise.resolve(); }
        st.busy.search = true; st.searchErr = ''; render();
        return check(st.pod, date, 'SEARCH', function () { paintStep(); }).then(function () {}, function (e) { st.searchErr = e && e.message || String(e); })
            .then(function () { st.busy.search = false; render(); });
    }
    function paintStep() { var el = document.getElementById('wa-step'); if (el) el.innerHTML = st.step ? '<i class="fas fa-spinner fa-spin"></i> ' + esc(st.step) : ''; paintBtn(); }
    function tokens() { return st.view.grep.trim().toLowerCase().split(/\s+/).filter(Boolean); }
    function hay(it) { return [it.trip_id, it.lorry, it.order_number, it.customer, it.order_type, it.line_number, it.item, it.status, it.detail, it.via, it.child_item, it.child_status, it.why].join(' \u0001 ').toLowerCase(); }
    function shown() {
        var r = current(); if (!r) return [];
        var tok = tokens(), list = r.items.filter(function (it) { return it.kind === st.view.tab; });
        if (!tok.length) return list;
        return list.filter(function (it) { var h = hay(it); return tok.every(function (t) { return h.indexOf(t) >= 0; }); });
    }
    function jsArg(v) { return JSON.stringify(String(v)).replace(/"/g, '&quot;'); }
    function tripLink(it) { return '<a class="lnk" title="Open trip ' + esc(it.trip_id) + (it.lorry ? ' · ' + esc(it.lorry) : '') + '" onclick="WmsAlerts.trip(' + jsArg(it.trip_id) + ')">' + esc(it.trip_id) + '</a>'; }
    function orderLink(it) { return '<a class="lnk" title="Open the order dialog" onclick="WmsAlerts.order(' + jsArg(it.key) + ')">' + esc(it.order_number) + '</a>'; }
    function sinceHtml(it) { var s = since(it.first_seen); return '<span class="wa-since' + (s.old ? ' old' : '') + '" title="first seen by a check on this PC">' + esc(s.text) + '</span>'; }
    function statusPill(s) {
        var u = String(s || '').toUpperCase(), cls = /CANCEL/.test(u) ? 'red' : /SCHEDULED|MANUAL/.test(u) ? 'amber' : /CLOSED|SHIPPED|INTERFAC|BILL/.test(u) ? 'green' : /AWAITING|BOOKED|RELEASED/.test(u) ? 'blue' : 'grey';
        return '<span class="wa-s ' + cls + '">' + esc(s || '—') + '</span>';
    }
    function mraPill(it) {
        var live = st.live[it.key];
        if (live) return '<span class="wa-live"><i class="fas fa-spinner fa-spin"></i> ' + esc(live) + '</span>';
        var cls = it.status === 'FAILED' ? 'red' : it.status === 'SKIPPED' ? 'amber' : it.status === 'SUCCESS' || it.status === 'ALREADY_DONE' ? 'green' : 'grey';
        return '<span class="wa-s ' + cls + '">' + esc(it.status) + '</span>';
    }
    var HEAD = {
        CANCEL: ['Trip', 'Order', 'Customer', 'Line', 'Item', 'Status', 'Via', 'Since', ''],
        PICKER: ['Trip', 'Lorry', 'Order', 'Customer', 'Type', 'Line status', 'Released', 'Since', ''],
        MRA: ['Trip', 'Order', 'Customer', 'MRA', 'Printed', 'Detail', 'Since', ''],
        ERROR: ['Trip', 'Order', 'Customer', 'Main line', 'Main status', 'Child line', 'Child status', 'Via', 'Since', '']
    };
    function rowHtml(it) {
        var k = it.kind, b = ' <button class="wa-btn light sm" title="Open the trip" onclick="WmsAlerts.trip(' + jsArg(it.trip_id) + ')"><i class="fas fa-truck"></i></button>';
        if (k === 'CANCEL') return '<tr><td>' + tripLink(it) + '</td><td>' + orderLink(it) + '</td><td title="' + esc(it.customer) + '">' + esc(it.customer) + '</td><td>' + esc(it.line_number) + '</td><td>' + esc(it.item) + '</td><td>' + statusPill(it.status) + '</td><td>' + esc(it.via === 'MAIN' ? 'main line' : it.via + ' of ' + it.child_of) + (it.fid ? '' : ' · <span class="wa-s red">no id</span>') + '</td><td>' + sinceHtml(it) + '</td><td>' + b + '</td></tr>';
        if (k === 'PICKER') return '<tr><td>' + tripLink(it) + '</td><td>' + esc(it.lorry) + '</td><td>' + orderLink(it) + '</td><td title="' + esc(it.customer) + '">' + esc(it.customer) + '</td><td>' + esc(it.order_type) + '</td><td>' + statusPill(it.status) + '</td><td>' + (it.released ? '<span class="wa-s green">released</span>' : '<span class="wa-s grey">not released</span>') + '</td><td>' + sinceHtml(it) + '</td><td>' + b.replace('Open the trip', 'Open the trip — Assign Picker') + '</td></tr>';
        if (k === 'MRA') return '<tr><td>' + tripLink(it) + '</td><td>' + orderLink(it) + '</td><td title="' + esc(it.customer) + '">' + esc(it.customer) + '</td><td>' + mraPill(it) + '</td><td>' + (it.printed ? '<span class="wa-s green">printed</span>' : '<span class="wa-s grey">no</span>') + '</td><td class="wrap" title="' + esc(it.detail) + '">' + esc(it.detail) + '</td><td>' + sinceHtml(it) + '</td><td>' +
            (it.status === 'SUCCESS' || it.status === 'ALREADY_DONE' ? '<span class="wa-s green"><i class="fas fa-check"></i> done</span>' : '<button class="wa-btn sm' + (it.status === 'FAILED' ? ' red' : '') + '" ' + (st.live[it.key] ? 'disabled' : '') + ' onclick="WmsAlerts.mra([' + jsArg(it.key) + '])"><i class="fas fa-paper-plane"></i> ' + (it.status === 'FAILED' ? 'Retry' : 'Interface') + '</button>') +
            ' <button class="wa-btn light sm" title="MRA history of the order" onclick="WmsAlerts.history(' + jsArg(it.order_number) + ')"><i class="fas fa-history"></i></button>' + b + '</td></tr>';
        return '<tr><td>' + tripLink(it) + '</td><td>' + orderLink(it) + '</td><td title="' + esc(it.customer) + '">' + esc(it.customer) + '</td><td>' + esc(it.line_number) + ' · ' + esc(it.item) + '</td><td>' + statusPill(it.status) + '</td><td>' + esc(it.child_line) + ' · ' + esc(it.child_item) + '</td><td>' + statusPill(it.child_status) + '</td><td>' + esc(it.via === 'BOGO' ? 'BOGO free item' : 'sub-line') + '</td><td>' + sinceHtml(it) + '</td><td>' + b + '</td></tr>';
    }
    function tabTools(kind, list) {
        var r = current(), h = '<div class="wa-tools"><input type="text" id="wa-grep" placeholder="Filter these rows…" value="' + esc(st.view.grep) + '"><span style="font-size:12px;color:#64748b;">' + list.length + ' of ' + (r ? r.summary[kind].n : 0) + '</span>';
        h += '<button class="wa-btn light sm" onclick="WmsAlerts.csv()"><i class="fas fa-file-csv"></i> CSV</button><span class="wa-sep" style="flex:1"></span>';
        if (kind === 'CANCEL') h += (list.length && window.WmsAutopilot ? '<button class="wa-btn red sm" ' + (st.busy.cancel ? 'disabled' : '') + ' onclick="WmsAlerts.cancelNow()" title="Run the cancellation autopilot for this date now: every order is read live again and only the lines still Scheduled / Manual Reservation are cancelled in Fusion"><i class="fas fa-ban"></i> ' + (st.busy.cancel ? 'Cancelling…' : 'Cancel these ' + r.summary.CANCEL.n + ' lines now') + '</button>' : '') + '<button class="wa-btn light sm" onclick="WmsAlerts.page(\'cancel-autopilot\')"><i class="fas fa-robot"></i> Open Cancellation autopilot</button>';
        if (kind === 'PICKER') h += '<span style="font-size:12px;color:#64748b;">Open the trip to assign a picker</span>';
        if (kind === 'MRA') { var open_ = list.filter(function (it) { return it.status !== 'SUCCESS' && it.status !== 'ALREADY_DONE' && !st.live[it.key]; }); h += '<button class="wa-btn sm" ' + (open_.length ? '' : 'disabled') + ' onclick="WmsAlerts.mra()"><i class="fas fa-paper-plane"></i> Interface all ' + open_.length + '</button><button class="wa-btn light sm" onclick="WmsAlerts.page(\'mra-interface\')"><i class="fas fa-file-invoice"></i> Open MRA Interface</button>'; }
        if (kind === 'ERROR') h += '<span style="font-size:12px;color:#64748b;">A main line cancelled while its BOGO free item / sub-line is still open or closed — fix the lines in the order dialog</span>';
        return h + '</div>';
    }
    function bodyHtml() {
        var r = current(), kind = st.view.tab, k = A.kind(kind);
        if (st.busy.load) return '<div class="wa-empty"><i class="fas fa-spinner fa-spin" style="color:#1e3a8a"></i> opening ' + esc(dayWord(st.view.date)) + ' from this PC…</div>';
        if (st.searchErr) return '<div class="wa-empty" style="color:#b91c1c"><i class="fas fa-exclamation-triangle" style="color:#b91c1c"></i> ' + esc(st.searchErr) + '</div>';
        if (!r) return '<div class="wa-empty"><i class="fas fa-search" style="color:#1e3a8a"></i> ' + esc(dayWord(st.view.date)) + ' was not checked on this PC yet' + (hosted() ? ' — press <b>Search</b> to read it now.' : '.') + '</div>';
        var list = shown(), h = '<div class="wa-note">' + (r.src === 'db' ? '<i class="fas fa-database" style="color:#4f46e5"></i> from this PC\'s DuckDB as of <b>' + esc(r.at.replace('T', ' ').slice(0, 16)) + '</b> — Search reads APEX again' : '<i class="fas fa-sync-alt" style="color:#16a34a"></i> read ' + esc(ago(r.at)) + (r.ms ? ' in ' + Math.round(r.ms / 1000) + ' s' : '')) +
            ' · <b>' + r.trips + '</b> trip' + (r.trips === 1 ? '' : 's') + ', <b>' + r.orders + '</b> sales order' + (r.orders === 1 ? '' : 's') + (r.hidden && (r.hidden.store || r.hidden.cancelled) ? ' (' + [r.hidden.store ? r.hidden.store + ' store / van' : '', r.hidden.cancelled ? r.hidden.cancelled + ' cancelled' : ''].filter(Boolean).join(', ') + ' left out)' : '') +
            (r.errors && r.errors.length ? ' · <span style="color:#b91c1c" title="' + esc(r.errors.join('\n')) + '"><i class="fas fa-exclamation-triangle"></i> ' + r.errors.length + ' read error' + (r.errors.length === 1 ? '' : 's') + '</span>' : '') + '</div>';
        h += tabTools(kind, list);
        if (!list.length) return h + '<div class="wa-empty"><i class="fas fa-check-circle"></i> ' + (tokens().length ? 'nothing matches the filter' : esc(A.message(kind, r.summary))) + '</div>';
        return h + '<div style="overflow:auto;max-height:52vh;"><table class="wa-grid"><thead><tr>' + HEAD[kind].map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' + list.map(rowHtml).join('') + '</tbody></table></div>';
    }
    function render() {
        if (!st.open) return;
        var dlg = document.getElementById('wa-dlg');
        if (!dlg) { dlg = document.createElement('div'); dlg.id = 'wa-dlg'; dlg.className = 'wa-dlg'; document.body.appendChild(dlg); dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); }); }
        var r = current(), run = st.lastRun[st.pod], t = today(), tm = addDays(t, 1), s = st.settings;
        var tabs = A.KINDS.map(function (k) { var n = r ? r.summary[k.id].n : 0; return '<button class="wa-tab' + (st.view.tab === k.id ? ' on' : '') + '" data-tab="' + k.id + '" style="--wa-c:' + k.color + '"><i class="fas ' + k.icon + '" style="color:' + k.color + '"></i> ' + esc(k.label) + ' <span class="n' + (n ? ' has' : '') + '">' + n + '</span></button>'; }).join('');
        dlg.innerHTML = '<div class="wa-box" role="dialog" aria-label="WMS alerts">' +
            '<div class="wa-head"><h3><i class="fas fa-satellite-dish"></i> WMS alerts <span class="wa-pod">' + esc(st.pod) + '</span></h3>' +
            '<span class="wa-when" id="wa-when">' + (st.running ? '<i class="fas fa-spinner fa-spin"></i> checking… ' + esc(st.step) : run && run.at ? 'last check ' + esc(ago(run.at)) + ' · next ' + esc(nextIn()) : 'not checked yet') + '</span>' +
            '<button class="wa-x" id="wa-close" title="Close">✕</button></div>' +
            '<div class="wa-bar"><label>Date</label><input type="date" id="wa-date" value="' + esc(st.view.date) + '">' +
            '<button class="wa-chip' + (st.view.date === t ? ' on' : '') + '" data-d="' + t + '">Today</button><button class="wa-chip' + (st.view.date === tm ? ' on' : '') + '" data-d="' + tm + '">Tomorrow</button>' +
            '<button class="wa-btn" id="wa-search" ' + (st.busy.search ? 'disabled' : '') + '><i class="fas fa-search"></i> Search</button><span class="wa-step" id="wa-step">' + (st.step ? '<i class="fas fa-spinner fa-spin"></i> ' + esc(st.step) : '') + '</span>' +
            '<span class="wa-sep"></span>' +
            '<label>Check every</label><select id="wa-every">' + EVERY.map(function (m) { return '<option value="' + m + '"' + (+s.every === m ? ' selected' : '') + '>' + (m < 60 ? m + ' min' : m === 60 ? '1 hour' : (m / 60) + ' hours') + '</option>'; }).join('') + '</select>' +
            '<label class="wa-toggle" title="Today\'s trips in the automatic check"><input type="checkbox" id="wa-today"' + (s.today ? ' checked' : '') + '> today</label>' +
            '<label class="wa-toggle" title="Tomorrow\'s trips in the automatic check"><input type="checkbox" id="wa-tomorrow"' + (s.tomorrow ? ' checked' : '') + '> tomorrow</label>' +
            '<label class="wa-toggle"><input type="checkbox" id="wa-on"' + (s.on ? ' checked' : '') + '> automatic</label>' +
            '<button class="wa-btn light" id="wa-now" ' + (st.running ? 'disabled' : '') + ' title="Check today and tomorrow now and refresh the bell"><i class="fas fa-bolt"></i> Check now</button></div>' +
            '<div class="wa-tabs">' + tabs + '</div><div class="wa-body" id="wa-body">' + bodyHtml() + '</div>' +
            '<div class="wa-foot"><span><i class="fas fa-bell"></i> one bell card per category after every check · the counts are for ' + esc(dayWord(st.view.date)) + ' on ' + esc(st.pod) + '</span><span class="wa-sep"></span><span>' + (DB.on() ? '<i class="fas fa-database" style="color:#4f46e5"></i> findings kept on this PC' : DB.host === false ? 'no DuckDB on this build — nothing kept' : '') + '</span></div></div>';
        wire(dlg);
    }
    function wire(dlg) {
        dlg.querySelector('#wa-close').onclick = close;
        dlg.querySelectorAll('.wa-tab').forEach(function (b) { b.onclick = function () { st.view.tab = b.getAttribute('data-tab'); st.view.grep = ''; render(); }; });
        dlg.querySelectorAll('.wa-chip').forEach(function (b) { b.onclick = function () { showDate(b.getAttribute('data-d')); }; });
        dlg.querySelector('#wa-date').onchange = function () { if (this.value) showDate(this.value); };
        dlg.querySelector('#wa-search').onclick = function () { var v = dlg.querySelector('#wa-date').value; if (v) search(v); };
        dlg.querySelector('#wa-every').onchange = function () { st.settings.every = +this.value; save(); paintBtn(); render(); };
        ['today', 'tomorrow', 'on'].forEach(function (k) { dlg.querySelector('#wa-' + k).onchange = function () { st.settings[k] = !!this.checked; save(); paintBtn(); render(); }; });
        dlg.querySelector('#wa-now').onclick = function () { runAuto(true).then(function () { if (st.open) render(); }); render(); };
        wireBody();
    }
    function wireBody() { var g = document.getElementById('wa-grep'); if (g && !g.onfocusSet) { g.onfocusSet = true; g.oninput = function () { st.view.grep = this.value; var pos = this.selectionStart, body = document.getElementById('wa-body'); if (body) { body.innerHTML = bodyHtml(); var n = document.getElementById('wa-grep'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } wireBody(); } }; } }

    // ─── actions ───────────────────────────────────────────────────────────────
    function itemOf(key) { var r = current(); if (!r) return null; for (var i = 0; i < r.items.length; i++) if (r.items[i].key === key) return r.items[i]; return null; }
    function openTrip(tripId) {
        var r = current(), it = null; if (r) for (var i = 0; i < r.items.length; i++) if (r.items[i].trip_id === String(tripId)) { it = r.items[i]; break; }
        if (typeof window.openTripDetails !== 'function') { note('Trip Management is not loaded.', 'warning'); return; }
        close();
        if (typeof window.navigateToPage === 'function') window.navigateToPage('trip-management');
        try { window.openTripDetails(String(tripId), it ? it.trip_date || st.view.date : st.view.date, it ? it.lorry : '', st.pod, it ? it.bay : '', it ? it.priority : ''); } catch (e) { note('Could not open trip ' + tripId + ': ' + (e && e.message || e), 'error'); }
    }
    function openOrder(key) {
        var it = itemOf(key); if (!it) return;
        if (!it.raw) { openTrip(it.trip_id); return; }
        if (typeof window.editTripOrder !== 'function') { note('The order dialog is not loaded.', 'warning'); return; }
        try { window.currentTripInstance = st.pod; } catch (e) {}
        try { window.editTripOrder(it.raw); } catch (e) { note('Could not open order ' + it.order_number + ': ' + (e && e.message || e), 'error'); }
    }
    /** Interface the given (or every open) MRA item of the date on screen through the MRA Interface's own runner, 3 at a time. */
    function mraRun(keys) {
        var r = current(); if (!r || !window.MraInterface || typeof window.MraInterface.interfaceOrder !== 'function') return Promise.resolve();
        var list = r.items.filter(function (it) { return it.kind === 'MRA' && it.status !== 'SUCCESS' && it.status !== 'ALREADY_DONE' && !st.live[it.key] && (!keys || keys.indexOf(it.key) >= 0); });
        if (!list.length) return Promise.resolve();
        if (keys == null && !window.confirm('Interface ' + list.length + ' order' + (list.length === 1 ? '' : 's') + ' of ' + dayWord(st.view.date) + ' to MRA on ' + st.pod + '?')) return Promise.resolve();
        var gw = 0;
        list.forEach(function (it) { st.live[it.key] = 'queued'; });
        render();
        return pool(list, 3, function (it) {
            if (gw >= 2) { st.live[it.key] = ''; it.detail = 'not sent — two gateway problems in a row'; render(); return; }
            st.live[it.key] = 'starting…';
            return window.MraInterface.interfaceOrder({ order: it.order_number, instance: st.pod, tripId: it.trip_id }, function (text) { st.live[it.key] = text; var el = document.getElementById('wa-body'); if (el && st.open) { el.innerHTML = bodyHtml(); wireBody(); } }, 'WMS_ALERTS')
                .then(function (res) {
                    delete st.live[it.key]; res = res || { st: 'FAILED', msg: 'no answer' };
                    it.status = res.st === 'SUCCESS' || res.st === 'ALREADY_DONE' ? res.st : res.st === 'SKIPPED' ? 'SKIPPED' : 'FAILED';
                    it.detail = (res.st === 'SUCCESS' ? 'interfaced now' : res.st === 'ALREADY_DONE' ? 'already in MRA' : (res.st === 'SKIPPED' ? 'skipped' : 'failed') + (res.msg ? ': ' + res.msg : '')); it.why = res.msg || '';
                    if (res.gw) gw++; else gw = 0;
                    render();
                });
        }).then(function () {
            // the date's findings read again (MRA rows that are done now leave the list; the others keep their first_seen)
            var done = r.items.filter(function (it) { return it.kind === 'MRA' && (it.status === 'SUCCESS' || it.status === 'ALREADY_DONE'); }).length;
            if (done) note(done + ' order' + (done === 1 ? '' : 's') + ' interfaced to MRA — re-checking ' + dayWord(r.date), 'success');
            return search(r.date);
        });
    }
    function csv() {
        var list = shown(), kind = st.view.tab; if (!list.length) return;
        var cols = ['trip_id', 'lorry', 'trip_date', 'order_number', 'customer', 'order_type', 'line_number', 'item', 'status', 'detail', 'via', 'child_of', 'child_line', 'child_item', 'child_status', 'first_seen'];
        var q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var text = cols.join(',') + '\n' + list.map(function (it) { return cols.map(function (c) { return q(it[c]); }).join(','); }).join('\n');
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = 'wms-alerts-' + kind.toLowerCase() + '-' + st.pod + '-' + st.view.date + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }

    // ─── the toolbar instance: a change drops the dialog's view; the next due check runs on the new pod ───
    (function followToolbar() {
        var el = document.getElementById('current-instance-display'); if (!el || !window.MutationObserver) return;
        new MutationObserver(function () { var p = curInstance(); if (p !== st.pod) { st.pod = p; paintBtn(); if (st.open) { render(); if (!current()) showDate(st.view.date); } } }).observe(el, { childList: true, characterData: true, subtree: true });
    })();

    /** The autopilot run for the date on screen (kill switch, lease, live re-check, PATCH, ledger, audit — all the autopilot's), then the date is checked again. */
    function cancelNow() {
        var r = current(); if (!r || !window.WmsAutopilot || st.busy.cancel) return Promise.resolve();
        var n = r.summary.CANCEL.n; if (!n) return Promise.resolve();
        if (!window.confirm('Cancel the ' + n + ' pending line' + (n === 1 ? '' : 's') + ' of ' + dayWord(r.date) + ' on ' + st.pod + ' in Fusion now?\n\nEvery order is read live first; only lines still Scheduled / Manual Reservation are sent (OUT OF STOCK).')) return Promise.resolve();
        st.busy.cancel = true; render();
        try { window.WmsAutopilot.state.pod = st.pod; } catch (e) {}
        return Promise.resolve(window.WmsAutopilot.run({ dates: [r.date] })).then(function (sum) {
            if (sum && typeof sum === 'object' && 'done' in sum) note('Autopilot: ' + sum.done + ' line(s) cancelled, ' + sum.failed + ' failed.', sum.failed ? 'warning' : 'success');
        }, function (e) { note('Autopilot: ' + (e && e.message || e), 'error'); }).then(function () { st.busy.cancel = false; return search(r.date); });
    }
    window.WmsAlerts = {
        open: open, close: close, check: function () { return runAuto(true); }, search: search, show: showDate, cancelNow: cancelNow,
        /** The findings of a date for another script (the toolbar's pending-cancellations icon): memory, else this PC's DuckDB → {summary, at, src} | null. */
        counts: function (date) {
            var pod = curInstance(), k = keyOf(pod, date || today());
            if (st.last[k]) return Promise.resolve({ summary: st.last[k].summary, at: st.last[k].at, src: st.last[k].src });
            return loadDate(pod, date || today()).then(function (r) { if (r) { st.last[k] = r; return { summary: r.summary, at: r.at, src: 'db' }; } return null; }).catch(function () { return null; });
        },
        trip: openTrip, order: openOrder, mra: mraRun, csv: csv,
        history: function (order) { close(); if (window.MraInterface && typeof window.MraInterface.history === 'function') window.MraInterface.history(order, st.pod); },
        page: function (id) { close(); if (typeof window.navigateToPage === 'function') window.navigateToPage(id); },
        settings: function (s) { if (s) { Object.assign(st.settings, s); save(); paintBtn(); } return Object.assign({}, st.settings); },
        state: function () { return { pod: st.pod, running: st.running, step: st.step, view: st.view, last: st.last, lastRun: st.lastRun, open: st.open, db: DB.host, due: due(), nextIn: nextIn() }; },
        tick: tick
    };
    function init() { ensureBtn(); start(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
