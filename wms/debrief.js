// ============================================================================
// DAY DEBRIEF — the whole trip date on one page: trips, orders, pickers, lines, cancellations, MRA, print, the issues, who did
// what, an hour-by-hour timeline and a plain-words story of the day — with a PDF. Header icon (clipboard) → dialog; any date.
// Reads = what the WMS already has: MraInterface.sync (trips + orders + MRA statuses, the DuckDB copy refreshed), every trip's
// WMS order lines + the BOGO map, WMSAL.run for the findings, and the day's rows of WMS_MRA_INTERFACE_STATUS, WMS_W2_CANCEL_LOG,
// WMS_ACTIVITY_LOG, WMS_AI_AUDIT, WMS_PRINT_JOBS, WMS_ACTUAL_SHIPDATE, WMS_TRIP_PINS (each read fails soft — a missing table
// is an empty section). The numbers and the narrative come from wms/debrief-engine.js (WMSDBF, pure, node-tested).
// The built debrief is kept per pod × date in DuckDB w2_dbf_days (opening a date is instant; Build reads everything again).
// PDF = jsPDF + autotable when loaded (CDN in wms/index.html), else the print view; Print = the same page; Copy = plain text.
// ============================================================================
(function () {
    'use strict';
    var ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP';
    var WM = ORDS + '/WAREHOUSEMANAGEMENT', TM = ORDS + '/TRIPMANAGEMENT', GW = WM + '/ai';
    var E = window.WMSDBF, A = window.WMSAL, R = window.W2CR;
    if (!E || !A || !R) { console.warn('[Debrief] debrief-engine.js / alert-rules.js / cancel-rules.js not loaded'); return; }

    // ─── helpers ───────────────────────────────────────────────────────────────
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var lit = function (s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; };
    var pad2 = function (n) { return ('0' + n).slice(-2); };
    var iso = function (d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
    var today = function () { return iso(new Date()); };
    var addDays = function (s, n) { var d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
    var now = function () { var d = new Date(); return iso(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
    var enc = encodeURIComponent;
    function items(r) { if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return []; } } return Array.isArray(r) ? r : (r && Array.isArray(r.items)) ? r.items : []; }
    function user() { try { return localStorage.getItem('wms_user') || sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || 'WMS'; } catch (e) { return 'WMS'; } }
    function pc() { try { var raw = localStorage.getItem('w2.pcid'), v = raw && raw.charAt(0) === '"' ? JSON.parse(raw) : raw; return v || 'PC'; } catch (e) { return 'PC'; } }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function pool(list, n, fn) {
        var i = 0;
        var next = function () { if (i >= list.length) return Promise.resolve(); var idx = i++; return Promise.resolve().then(function () { return fn(list[idx], idx); }).catch(function (e) { console.warn('[Debrief] pooled call failed:', e && e.message || e); }).then(next); };
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
    function post(url, body, ms) { return host({ action: 'executePost', fullUrl: url, body: typeof body === 'string' ? body : JSON.stringify(body || {}) }, ms || 180000); }
    /** One APEX read → rows with upper-case keys; a failing one (the table does not exist yet) gives [] and is noted. */
    /** One gateway read; a missing table (ORA-00942) is silently empty, any other failure is noted with the table it was reading. */
    function gw(sql, max, note) {
        var table = (/FROM\s+([a-z0-9_$.]+)/i.exec(sql) || [])[1] || 'APEX';
        return post(GW + '/executequery', { appUser: user(), sql: sql, maxRows: max || 5000 }).then(function (d) {
            if (!d || d.success === false) throw new Error((d && d.error) || 'APEX query failed');
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || []).map(function (r) { if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; } var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x; });
        }).catch(function (e) { if (note && !/ORA-00942|does not exist/i.test(String(e && e.message || e))) note.push(table + ': ' + String(e && e.message || e).slice(0, 160)); return []; });
    }
    function curInstance() {
        var el = document.getElementById('current-instance-display'), v = el ? String(el.textContent || '').trim().toUpperCase() : '';
        if (!v) { try { v = String(sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || localStorage.getItem('wms_instance') || '').toUpperCase(); } catch (e) { v = ''; } }
        return v || 'PROD';
    }
    function note(m, t) { if (typeof showNotification === 'function') showNotification(m, t || 'info'); else console.log('[Debrief]', m); }
    function dayShort(s) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); if (!m) return s || '';
        var d = new Date(+m[1], +m[2] - 1, +m[3]), t = new Date(); t.setHours(0, 0, 0, 0);
        var diff = Math.round((d - t) / 86400000);
        return (diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]) + ' ' + m[3] + '-' + m[2] + '-' + m[1];
    }
    function dayRange(date) { return "TO_DATE(" + lit(date) + ", 'YYYY-MM-DD')"; }

    // ─── state ─────────────────────────────────────────────────────────────────
    var st = { open: false, pod: curInstance(), date: today(), models: {}, busy: false, step: '', err: '', chart: null, loading: false,
        keep: { running: false, step: '', i: 0, n: 0, stop: false, menu: false, from: '', to: '' }, cov: null, covPod: '' };
    function key(pod, date) { return pod + '|' + date; }
    function current() { return st.models[key(st.pod, st.date)] || null; }

    // ─── DuckDB (the WMS 2.0 file; best effort) ───────────────────────────────
    var COLS = { w2_dbf_days: ['pod', 'trip_date', 'built_at', 'by_user', 'pc', 'model_json'] };
    var DB = {
        host: null, probing: null, io: Promise.resolve(),
        call: function (action, payload, ms, attempt) {
            return host(Object.assign({ action: action, appUser: user() }, payload || {}), ms || 120000).then(function (d) {
                var busy = d && d.ok === false && (d.busy || /another .*window|busy/i.test(String(d.error || '')));
                if (busy && (attempt || 0) < 3) return sleep(1500 + 1500 * (attempt || 0)).then(function () { return DB.call(action, payload, ms, (attempt || 0) + 1); });
                return d;
            });
        },
        probe: function () { if (DB.probing) return DB.probing; DB.probing = DB.call('w2Status', {}, 15000).then(function (d) { DB.host = !!(d && d.ok !== false); return DB.host; }, function () { DB.host = false; return false; }); return DB.probing; },
        on: function () { return DB.host === true; },
        rowsOf: function (d) { var cols = (d.columns || []).map(function (c) { return String(c).toLowerCase(); }); return (d.rows || []).map(function (r) { var o = {}; cols.forEach(function (c, i) { o[c] = r[i]; }); return o; }); },
        qs: function (list) {
            if (!DB.on() || !list.length) return Promise.resolve(list.map(function () { return []; }));
            return DB.io.then(function () { return DB.call('w2Queries', { queries: list }); }).then(function (d) { return ((d && d.results) || []).map(function (r) { if (!r || r.error) return []; return DB.rowsOf(r); }); }, function () { return list.map(function () { return []; }); });
        },
        put: function (table, scope, rows) {
            if (!DB.on() || !rows.length) return Promise.resolve();
            var p = DB.io.then(function () { return DB.call('w2Put', { table: table, scope: scope, rows: rows, replaceAll: false, columns: COLS[table] }, 300000); });
            DB.io = p.catch(function (e) { console.warn('[Debrief] DuckDB write failed:', e && e.message || e); });
            return p.catch(function () {});
        }
    };
    function loadKept(pod, date) {
        return DB.probe().then(function () {
            if (!DB.on()) return null;
            return DB.qs(['SELECT built_at, by_user, model_json FROM w2_dbf_days WHERE pod = ' + lit(pod) + ' AND trip_date IN (' + lit(date) + ')']).then(function (q) {
                var r = q[0].sort(function (a, b) { return String(a.built_at) < String(b.built_at) ? 1 : -1; })[0]; if (!r || !r.model_json) return null;
                try { var m = JSON.parse(r.model_json); m.src = 'db'; return m; } catch (e) { return null; }
            });
        });
    }
    function keep(pod, date, model) {
        var copy = Object.assign({}, model); delete copy.src;
        return DB.put('w2_dbf_days', { pod: pod, trip_date: [date] }, [{ pod: pod, trip_date: date, built_at: model.builtAt, by_user: user(), pc: pc(), model_json: JSON.stringify(copy) }]);
    }

    // ─── build: everything about one date, live ──────────────────────────────
    var bogoCache = {};
    function bogo(pod) {
        var c = bogoCache[pod]; if (c && Date.now() - c.at < 12 * 3600000) return Promise.resolve(c.map);
        return get(ORDS + '/ARMODULE/BOGO?p_instance_name=' + enc(pod)).then(function (j) { var map = R.bogoMap(items(j)); bogoCache[pod] = { at: Date.now(), map: map }; return map; }).catch(function () { return (c && c.map) || {}; });
    }
    function linesOfTrip(pod, trip) { return get(TM + '/trip/orders/getsalesorderlinesbytrip/' + enc(trip) + '?P_INSTANCE_NAME=' + enc(pod)).then(items); }
    function build(pod, date) {
        if (!window.MraInterface || typeof window.MraInterface.sync !== 'function') return Promise.reject(new Error('mra-interface.js is not loaded'));
        var errors = [], tell = function (t) { st.step = t; paintStep(); };
        var D = dayRange(date), D1 = D + ' + 1', podLit = lit(pod);
        tell('trips and orders of ' + dayShort(date));
        var reads = {
            mraRuns: gw("SELECT NVL(app_user, '?') AS u, NVL(source, '?') AS src, mra_interface_status AS s, COUNT(*) AS n, SUM(CASE WHEN gateway_problem IS NOT NULL THEN 1 ELSE 0 END) AS gw FROM wms_mra_interface_status WHERE UPPER(instance_name) = " + podLit + ' AND created_date >= ' + D + ' AND created_date < ' + D1 + ' GROUP BY app_user, source, mra_interface_status', 500, errors),
            cancelLog: gw("SELECT run_id, TO_CHAR(logged_at, 'HH24:MI') AS t, app_user, trip_id, order_number, line_number, item, status_before, via, result, SUBSTR(message, 1, 200) AS message FROM wms_w2_cancel_log WHERE pod = " + podLit + ' AND (trip_date = ' + lit(date) + ' OR (logged_at >= ' + D + ' AND logged_at < ' + D1 + ')) ORDER BY logged_at', 2000, errors),
            activity: gw("SELECT user_name, event_type, page, COUNT(*) AS n, TO_CHAR(MIN(event_ts), 'HH24:MI') AS first_t, TO_CHAR(MAX(event_ts), 'HH24:MI') AS last_t FROM wms_activity_log WHERE event_ts >= " + D + ' AND event_ts < ' + D1 + ' GROUP BY user_name, event_type, page', 2000, errors),
            actions: gw("SELECT user_name, target, COUNT(*) AS n FROM wms_activity_log WHERE event_type = 'action' AND target IS NOT NULL AND event_ts >= " + D + ' AND event_ts < ' + D1 + ' GROUP BY user_name, target ORDER BY COUNT(*) DESC FETCH FIRST 120 ROWS ONLY', 200, errors),
            hAct: gw("SELECT 'activity' AS src, TO_CHAR(event_ts, 'HH24') AS h, COUNT(*) AS n FROM wms_activity_log WHERE event_ts >= " + D + ' AND event_ts < ' + D1 + " GROUP BY TO_CHAR(event_ts, 'HH24')", 50, errors),
            hMra: gw("SELECT 'mra' AS src, TO_CHAR(created_date, 'HH24') AS h, COUNT(*) AS n FROM wms_mra_interface_status WHERE UPPER(instance_name) = " + podLit + ' AND created_date >= ' + D + ' AND created_date < ' + D1 + " GROUP BY TO_CHAR(created_date, 'HH24')", 50, errors),
            hCancel: gw("SELECT 'cancel' AS src, TO_CHAR(logged_at, 'HH24') AS h, COUNT(*) AS n FROM wms_w2_cancel_log WHERE pod = " + podLit + ' AND logged_at >= ' + D + ' AND logged_at < ' + D1 + " AND result IN ('DONE', 'FAILED') GROUP BY TO_CHAR(logged_at, 'HH24')", 50, errors),
            audit: gw('SELECT app_user, source, action_key, outcome, COUNT(*) AS n FROM wms_ai_audit WHERE event_time >= ' + D + ' AND event_time < ' + D1 + ' AND (instance IS NULL OR UPPER(instance) = ' + podLit + ') GROUP BY app_user, source, action_key, outcome', 500, errors),
            prints: gw('SELECT print_status, overall_status, COUNT(*) AS n FROM wms_print_jobs WHERE trip_date >= ' + D + ' AND trip_date < ' + D1 + ' GROUP BY print_status, overall_status', 50, errors),
            shipDates: gw('SELECT app_user, status, COUNT(*) AS n FROM wms_actual_shipdate WHERE UPPER(instance_name) = ' + podLit + ' AND created_date >= ' + D + ' AND created_date < ' + D1 + ' GROUP BY app_user, status', 100, errors),
            pins: gw('SELECT pinned_by, trip_id FROM wms_trip_pins WHERE UPPER(instance_name) = ' + podLit, 500, errors)
        };
        var sync = window.MraInterface.sync(pod, date, date, function (n, of, text) { tell(text || 'trip ' + n + ' of ' + of); });
        return Promise.all([sync, bogo(pod)]).then(function (r) {
            var s = r[0], bg = r[1], trips = s.trips, lines = [], n = 0;
            if (s.statusErr) errors.push('MRA statuses: ' + s.statusErr);
            return pool(trips, 3, function (t) {
                return linesOfTrip(pod, t.trip_id).then(function (rows) { lines.push({ trip_id: t.trip_id, lorry: t.lorry, bay: t.bay, priority: t.priority, lines: rows }); }, function (e) { errors.push('trip ' + t.trip_id + ' lines: ' + (e && e.message || e)); lines.push({ trip_id: t.trip_id, lorry: t.lorry, bay: t.bay, priority: t.priority, lines: [] }); })
                    .then(function () { n++; tell('order lines of trip ' + n + ' of ' + trips.length); });
            }).then(function () {
                try { if (typeof window.MraInterface.keepLines === 'function') window.MraInterface.keepLines(pod, date, lines); } catch (e) {}   // the lines → DuckDB too (the toolbar search finds items)
                tell('the day\'s records (MRA tries, cancellations, activity, print, audit)');
                var names = Object.keys(reads);
                return Promise.all(names.map(function (k) { return reads[k]; })).then(function (vals) {
                    var g = {}; names.forEach(function (k, i) { g[k] = vals[i]; });
                    var findings = A.run({ date: date, rows: s.rows, trips: lines.map(function (t) { return { trip_id: t.trip_id, lines: t.lines }; }), bogo: bg });
                    var model = E.model({ pod: pod, date: date, builtAt: now(), rows: s.rows, trips: lines, hidden: s.hidden, findings: findings, mraRuns: g.mraRuns, cancelLog: g.cancelLog, activity: g.activity, actions: g.actions, hourly: g.hAct.concat(g.hMra, g.hCancel), audit: g.audit, prints: g.prints, shipDates: g.shipDates, pins: g.pins, errors: errors });
                    model.src = 'live';
                    st.models[key(pod, date)] = model;
                    loadCov();
                    keep(pod, date, model);
                    return model;
                });
            });
        });
    }

    // ─── dialog ────────────────────────────────────────────────────────────────
    function open(date) {
        st.pod = curInstance(); if (date) st.date = date; else if (window.wmsTripDate && !st.openedOnce) st.date = window.wmsTripDate.get();
        st.openedOnce = true;
        st.open = true; st.err = ''; render();
        if (!current()) showDate(st.date);
        DB.probe().then(loadCov);                                   // the coverage strip (what this PC holds)
    }
    function close() { st.open = false; closePdf(); destroyChart(); var d = document.getElementById('dbf-dlg'); if (d) d.remove(); }
    function showDate(date) {
        st.date = date; st.err = '';
        if (current()) { render(); return Promise.resolve(); }
        st.loading = true; render();
        return loadKept(st.pod, date).then(function (m) { if (m) st.models[key(st.pod, date)] = m; }).catch(function () {}).then(function () { st.loading = false; render(); });
    }
    function rebuild(date) {
        if (st.busy) return Promise.resolve();
        date = date || st.date; st.date = date;
        if (!hosted()) { note('Open this inside the Gray\'s WMS app.', 'warning'); return Promise.resolve(); }
        st.busy = true; st.err = ''; st.pod = curInstance(); paintBtn(); render();
        return build(st.pod, date).then(function () {}, function (e) { st.err = e && e.message || String(e); })
            .then(function () { st.busy = false; st.step = ''; paintBtn(); render(); });
    }
    function paintBtn() { var b = document.getElementById('wms-debrief-btn'); if (b) b.classList.toggle('busy', st.busy); }
    function paintStep() { var el = document.getElementById('dbf-step'); if (el) el.innerHTML = st.step ? '<i class="fas fa-spinner fa-spin"></i> ' + esc(st.step) : ''; }
    function destroyChart() { if (st.chart) { try { st.chart.destroy(); } catch (e) {} st.chart = null; } }
    function kpi(label, v, cls) { return '<div class="dbf-kpi' + (cls ? ' ' + cls : '') + '"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>'; }
    function pct(a, b) { return b ? Math.round(a * 100 / b) : 0; }
    function ring(score) {
        var r = 54, c = 2 * Math.PI * r, v = score == null ? 0 : score, col = v >= 90 ? '#15803d' : v >= 70 ? '#1e3a8a' : v >= 40 ? '#b45309' : '#b91c1c';
        return '<div class="dbf-ring"><svg viewBox="0 0 130 130"><circle cx="65" cy="65" r="' + r + '" fill="none" stroke="#e2e8f0" stroke-width="12"/><circle cx="65" cy="65" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + (c * v / 100).toFixed(1) + ' ' + c.toFixed(1) + '"/></svg><div class="v">' + (score == null ? '—' : score + '%') + '<small>readiness</small></div></div>';
    }
    function tbl(head, rows, cls) { return '<div class="dbf-scroll"><table class="dbf-tbl ' + (cls || '') + '"><thead><tr>' + head.map(function (h) { return '<th class="' + (h.num ? 'num' : '') + '">' + esc(h.t) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'; }
    function td(v, num, raw) { return '<td class="' + (num ? 'num' : '') + '">' + (raw ? v : esc(v)) + '</td>'; }
    function pill(v, cls) { return '<span class="dbf-pill ' + (cls || '') + '">' + esc(v) + '</span>'; }
    // ─── compact table cells ──────────────────────────────────────────────────
    var AV_PALETTE = ['#4f46e5', '#0e7490', '#15803d', '#b45309', '#be185d', '#7c3aed', '#1d4ed8', '#0f766e'];
    function avColour(name) { var h = 0, x = String(name || ''); for (var i = 0; i < x.length; i++) h = (h * 31 + x.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
    function avInitials(name) { var w = String(name || '').trim().split(/[\s._-]+/).filter(Boolean); return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] || '?').slice(0, 2)).toUpperCase(); }
    /** The pickers of a trip as stacked initials (≤ max shown, then +n) — every name on hover; one line whatever the count. */
    function avatars(names, max) {
        var list = String(names || '').split(/,\s*/).filter(Boolean); max = max || 5;
        if (!list.length) return '<span class="dbf-muted">—</span>';
        var shown = list.slice(0, max), rest = list.length - shown.length;
        return '<span class="dbf-avs" title="' + esc(list.join(', ')) + '">' + shown.map(function (n) { return '<span class="dbf-av" style="background:' + avColour(n) + '">' + esc(avInitials(n)) + '</span>'; }).join('') + (rest > 0 ? '<span class="dbf-av more">+' + rest + '</span>' : '') + '<span class="dbf-avn">' + list.length + '</span></span>';
    }
    /** n of `of` with a thin bar under the number (the stage columns of the trips table). */
    function prog(n, of, cls) { var p = of ? Math.round(Math.min(1, n / of) * 100) : 0; return '<td class="num prog" title="' + n + ' of ' + of + ' (' + p + '%)"><div class="dbf-prog ' + (cls || '') + '"><b>' + n + '</b><i><i style="width:' + p + '%"></i></i></div></td>'; }
    /** A count that reads quiet when it is 0 and as a coloured pill when it is not. */
    function flag(n, cls) { return '<td class="num">' + (n ? '<span class="dbf-pill ' + cls + '">' + n + '</span>' : '<span class="dbf-muted">0</span>') + '</td>'; }
    function tripsTable(m) {
        var head = '<thead><tr class="grp">' +
            '<th colspan="4" class="grp">Trip</th><th colspan="3" class="grp">Volume</th><th colspan="5" class="grp">Progress</th><th colspan="2" class="grp">People</th><th colspan="3" class="grp">Issues</th><th class="grp"></th></tr><tr>' +
            '<th>Trip</th><th>Lorry</th><th>Bay</th><th>Prio</th>' +
            '<th class="num">Orders</th><th class="num">Cust.</th><th class="num">Lines</th>' +
            '<th class="num">Released</th><th class="num">Picked</th><th class="num">Shipped</th><th class="num">Printed</th><th class="num">MRA</th>' +
            '<th>Pickers</th><th class="num">No picker</th>' +
            '<th class="num">Cancelled</th><th class="num">Pending</th><th class="num">Errors</th>' +
            '<th class="num">Ready</th></tr></thead>';
        var rows = m.trips.map(function (t) {
            var rd = Math.max(0, Math.min(100, Number(t.readiness) || 0)), rc = rd >= 80 ? 'g' : rd >= 40 ? 'a' : 'r';
            return '<tr>' +
                '<td><a class="dbf-trip" onclick="WmsDebrief.trip(' + JSON.stringify(String(t.trip_id)).replace(/"/g, '&quot;') + ')">' + esc(t.trip_id) + '</a></td>' +
                '<td class="ell" title="' + esc(t.lorry) + '">' + esc(t.lorry || '—') + '</td><td class="dbf-muted">' + esc(t.bay || '—') + '</td><td>' + (t.priority ? '<span class="dbf-pill">' + esc(t.priority) + '</span>' : '<span class="dbf-muted">—</span>') + '</td>' +
                '<td class="num"><b>' + t.orders + '</b></td><td class="num">' + t.customers + '</td><td class="num">' + t.lines + '</td>' +
                prog(t.released, t.orders) + prog(t.picked, t.orders) + prog(t.shipped, t.orders, 'g') + prog(t.printed, t.orders, 'g') +
                '<td class="num prog" title="' + t.mraDone + ' of ' + t.orders + ' interfaced' + (t.mraFailed ? ', ' + t.mraFailed + ' failed' : '') + '"><div class="dbf-prog g"><b>' + (t.mraFailed ? '<span class="dbf-pill red" title="' + t.mraFailed + ' failed at MRA">' + t.mraFailed + ' ✗</span>' : '') + t.mraDone + '</b><i><i style="width:' + (t.orders ? Math.round(t.mraDone * 100 / t.orders) : 0) + '%"></i></i></div></td>' +
                '<td>' + avatars(t.pickers) + '</td>' + flag(t.noPicker, 'amber') +
                flag(t.cancelledLines, 'amber') + flag(t.pendingCancel, 'red') + flag(t.errors, 'red') +
                '<td class="num"><span class="dbf-ready ' + rc + '"><i><i style="width:' + rd + '%"></i></i><b>' + rd + '%</b></span></td></tr>';
        });
        return '<div class="dbf-scroll"><table class="dbf-tbl compact dbf-trips">' + head + '<tbody>' + rows.join('') + '</tbody></table></div>';
    }
    function bodyHtml() {
        var m = current();
        if (st.busy) return '<div class="dbf-empty"><i class="fas fa-spinner fa-spin"></i> building the debrief of ' + esc(dayShort(st.date)) + '…<br><span id="dbf-step" class="dbf-step">' + (st.step ? '<i class="fas fa-spinner fa-spin"></i> ' + esc(st.step) : '') + '</span></div>';
        if (st.err) return '<div class="dbf-empty" style="color:#b91c1c"><i class="fas fa-exclamation-triangle" style="color:#b91c1c"></i> ' + esc(st.err) + '</div>';
        if (st.loading) return '<div class="dbf-empty"><i class="fas fa-spinner fa-spin"></i> opening ' + esc(dayShort(st.date)) + ' from this PC…</div>';
        if (!m) return '<div class="dbf-empty"><i class="fas fa-clipboard-list"></i> No debrief of ' + esc(dayShort(st.date)) + ' on this PC yet' + (hosted() ? ' — press <b>Build</b> to read the day.' : '.') + '</div>';
        var k = m.kpis, n = m.narrative, h = '';
        h += '<div class="dbf-hero">' + ring(m.score) + '<div><h2>' + esc(n.headline) + '</h2><p>' + esc(n.paragraphs[0] ? n.paragraphs[0].text : '') + '</p><div class="dbf-tags">' + n.highlights.map(function (x) { return '<span class="dbf-tag good"><i class="fas fa-check"></i> ' + esc(x) + '</span>'; }).join('') + n.lowlights.map(function (x) { return '<span class="dbf-tag bad"><i class="fas fa-exclamation"></i> ' + esc(x) + '</span>'; }).join('') + '</div></div></div>';
        h += '<div class="dbf-kpis">' + kpi('Trips', k.trips) + kpi('Sales orders', k.orders) + kpi('Order lines', k.lines) + kpi('Pickers', k.pickers) + kpi('Released', k.released + (k.orders ? ' · ' + pct(k.released, k.orders) + '%' : ''), 'blue') + kpi('Picked', k.picked + (k.orders ? ' · ' + pct(k.picked, k.orders) + '%' : ''), 'blue') + kpi('Shipped', k.shipped + (k.orders ? ' · ' + pct(k.shipped, k.orders) + '%' : ''), 'green') + kpi('Printed', k.printed, 'green') + kpi('MRA done', k.mraDone + (k.orders ? ' · ' + m.mra.pct + '%' : ''), 'green') + kpi('MRA failed', k.mraFailed, k.mraFailed ? 'red' : '') + kpi('Cancelled lines', k.cancelledLines, k.cancelledLines ? 'amber' : '') + kpi('Pending cancel', k.pendingCancel, k.pendingCancel ? 'red' : '') + kpi('Order errors', k.orderErrors, k.orderErrors ? 'red' : '') + kpi('No picker', k.noPicker, k.noPicker ? 'amber' : '') + (k.store ? kpi('Store / van', k.store) : '') + kpi('People active', k.users) + '</div>';
        h += '<div class="dbf-grid2"><div class="dbf-card dbf-story"><h4><i class="fas fa-book-open"></i> The story of the day</h4>' + n.paragraphs.map(function (p) { return '<p><b>' + esc(p.title) + '.</b> ' + esc(p.text) + '</p>'; }).join('') + '</div>';
        h += '<div><div class="dbf-card"><h4><i class="fas fa-clock"></i> Timeline <span class="n">' + esc(m.timeline.first ? m.timeline.first + ' – ' + m.timeline.last : 'no events') + '</span></h4>' + timelineHtml(m) + '</div>';
        h += '<div class="dbf-card"><h4><i class="fas fa-exclamation-triangle" style="color:#b91c1c"></i> Needs attention <span class="n">' + m.issues.length + '</span></h4>' + (m.issues.length ? '<ul class="dbf-issues">' + m.issues.map(function (i) { return '<li><b>' + esc(i.kind) + '</b> — ' + esc(i.text) + '</li>'; }).join('') + '</ul>' : '<div style="color:#15803d"><i class="fas fa-check-circle"></i> nothing open</div>') + '</div></div></div>';
        h += '<div class="dbf-card"><h4><i class="fas fa-truck"></i> Trips <span class="n">' + m.trips.length + '</span><span class="dbf-legend">bar = share of the trip\'s orders · hover the initials for the pickers\' names</span></h4>' + tripsTable(m) + '</div>';
        h += '<div class="dbf-grid2"><div class="dbf-card"><h4><i class="fas fa-user-friends"></i> Pickers <span class="n">' + m.pickers.length + '</span></h4>' + (m.pickers.length ? tbl([{ t: 'Picker' }, { t: 'Orders', num: 1 }, { t: 'Trips', num: 1 }, { t: 'Lines', num: 1 }, { t: 'Picked', num: 1 }, { t: 'Shipped', num: 1 }, { t: 'First assigned' }], m.pickers.map(function (p) { return '<tr>' + td('<span class="dbf-avs"><span class="dbf-av" style="background:' + avColour(p.name) + '">' + esc(avInitials(p.name)) + '</span></span> ' + esc(p.name), false, true) + td(p.orders, 1) + td(p.trips, 1) + td(p.lines, 1) + td(p.picked + ' <span class="dbf-pill ' + (p.pickedPct >= 90 ? 'green' : p.pickedPct >= 50 ? 'amber' : 'red') + '">' + p.pickedPct + '%</span>', 1, true) + td(p.shipped, 1) + td(p.firstAssigned) + '</tr>'; }), 'compact') : '<div style="color:#64748b">no picker assigned on the day</div>') + '</div>';
        h += '<div class="dbf-card"><h4><i class="fas fa-file-invoice"></i> MRA</h4><div class="dbf-tags" style="margin:0 0 8px">' + pill(m.mra.done + ' done', 'green') + ' ' + pill(m.mra.failed + ' failed', m.mra.failed ? 'red' : '') + ' ' + pill(m.mra.skipped + ' skipped', m.mra.skipped ? 'amber' : '') + ' ' + pill(m.mra.none + ' not sent', m.mra.none ? 'blue' : '') + ' ' + pill(m.mra.tries + ' tries on the day' + (m.mra.gw ? ', ' + m.mra.gw + ' gateway' : ''), '') + '</div>' + (m.mra.byUser.length ? tbl([{ t: 'By' }, { t: 'Tries', num: 1 }, { t: 'Ok', num: 1 }, { t: 'Failed', num: 1 }, { t: 'Gateway', num: 1 }, { t: 'Sources' }], m.mra.byUser.map(function (u) { return '<tr>' + td(u.name) + td(u.tries, 1) + td(u.ok, 1) + td(u.failed, 1) + td(u.gw, 1) + td(u.sources) + '</tr>'; })) : '') + (m.mra.failedRows.length ? '<h4 style="margin-top:10px">Failed orders</h4>' + tbl([{ t: 'Trip' }, { t: 'Order' }, { t: 'Customer' }, { t: 'Reason' }, { t: 'Tries', num: 1 }], m.mra.failedRows.map(function (r) { return '<tr>' + td(r.trip_id) + td(r.order_number) + td(r.customer) + td(r.why) + td(r.tries, 1) + '</tr>'; })) : '') + '</div></div>';
        h += '<div class="dbf-grid2"><div class="dbf-card"><h4><i class="fas fa-ban"></i> Cancellations <span class="n">' + m.cancels.lines + '</span></h4><div class="dbf-tags" style="margin:0 0 8px">' + pill(k.cancelledLines + ' cancelled lines on the trips', k.cancelledLines ? 'amber' : '') + ' ' + pill(m.cancels.done + ' done on the day', m.cancels.done ? 'green' : '') + ' ' + pill(m.cancels.failed + ' failed', m.cancels.failed ? 'red' : '') + ' ' + pill(m.cancels.runs + ' runs', '') + ' ' + pill(k.pendingCancel + ' pending', k.pendingCancel ? 'red' : '') + '</div>' + (m.cancels.rows.length ? tbl([{ t: 'Time' }, { t: 'By' }, { t: 'Trip' }, { t: 'Order' }, { t: 'Line' }, { t: 'Item' }, { t: 'Via' }, { t: 'Result' }, { t: 'Message' }], m.cancels.rows.map(function (r) { return '<tr>' + td(r.t) + td(r.user) + td(r.trip_id) + td(r.order_number) + td(r.line_number) + td(r.item) + td(r.via) + td(pill(r.result, r.result === 'DONE' ? 'green' : r.result === 'FAILED' ? 'red' : ''), false, true) + td(r.message) + '</tr>'; })) : '<div style="color:#64748b">no cancellation run on the day</div>') + '</div>';
        h += '<div class="dbf-card"><h4><i class="fas fa-layer-group"></i> Order types & line statuses</h4><div class="dbf-grid2">' + tbl([{ t: 'Order type' }, { t: 'Orders', num: 1 }], m.orderTypes.map(function (x) { return '<tr>' + td(x.name) + td(x.n, 1) + '</tr>'; })) + tbl([{ t: 'Line status' }, { t: 'Lines', num: 1 }], m.lineStatuses.map(function (x) { return '<tr>' + td(x.status) + td(x.n, 1) + '</tr>'; })) + '</div>' + (m.customers.length ? '<h4 style="margin-top:10px">Top customers</h4>' + tbl([{ t: 'Customer' }, { t: 'Orders', num: 1 }], m.customers.map(function (x) { return '<tr>' + td(x.name) + td(x.n, 1) + '</tr>'; })) : '') + '</div></div>';
        h += '<div class="dbf-card"><h4><i class="fas fa-users"></i> People — who did what <span class="n">' + m.users.length + '</span></h4>' + (m.users.length ? tbl([{ t: 'User' }, { t: 'Active' }, { t: 'Actions', num: 1 }, { t: 'What they did' }, { t: 'Most used' }], m.users.map(function (u) { return '<tr>' + td('<b>' + esc(u.name) + '</b>', false, true) + td(u.first ? u.first + (u.last && u.last !== u.first ? ' – ' + u.last : '') : '') + td(u.events, 1) + td('<span class="dbf-did">' + esc(u.did) + '</span>', false, true) + td(u.actions.map(function (a) { return a.target + ' ×' + a.n; }).join(', ')) + '</tr>'; })) : '<div style="color:#64748b">no user activity recorded for the day</div>') + '</div>';
        if (m.errors.length) h += '<div class="dbf-card"><h4><i class="fas fa-exclamation-triangle" style="color:#b91c1c"></i> Order errors <span class="n">' + m.errors.length + '</span></h4>' + tbl([{ t: 'Trip' }, { t: 'Order' }, { t: 'Customer' }, { t: 'Main line' }, { t: 'Status' }, { t: 'Child' }, { t: 'Child status' }], m.errors.map(function (e) { return '<tr>' + td(e.trip_id) + td(e.order_number) + td(e.customer) + td(e.line_number + ' · ' + e.item) + td(e.status) + td(e.child_line + ' · ' + e.child_item) + td(e.child_status) + '</tr>'; })) + '</div>';
        return h;
    }
    function timelineHtml(m) {
        var hrs = m.timeline.hours, max = 1; hrs.forEach(function (x) { max = Math.max(max, x.activity + x.mra + x.cancel); });
        if (window.Chart) return '<canvas id="dbf-chart" height="110"></canvas>';
        return '<div class="dbf-hours">' + hrs.map(function (x) { var t = x.activity + x.mra + x.cancel; return '<div title="' + x.h + ':00 · ' + x.activity + ' actions, ' + x.mra + ' MRA, ' + x.cancel + ' cancellations" style="height:' + Math.round(t * 86 / max) + 'px" class="' + (x.cancel > x.activity ? 'c' : x.mra > x.activity ? 'm' : '') + '"></div>'; }).join('') + '</div><div class="dbf-hlabels">' + hrs.map(function (x, i) { return '<span>' + (i % 3 === 0 ? x.h : '') + '</span>'; }).join('') + '</div>';
    }
    function drawChart(m) {
        destroyChart(); var c = document.getElementById('dbf-chart'); if (!c || !window.Chart) return;
        var hrs = m.timeline.hours;
        st.chart = new window.Chart(c.getContext('2d'), { type: 'bar', data: { labels: hrs.map(function (x) { return x.h + ':00'; }), datasets: [{ label: 'Actions', data: hrs.map(function (x) { return x.activity; }), backgroundColor: '#1e3a8a' }, { label: 'MRA tries', data: hrs.map(function (x) { return x.mra; }), backgroundColor: '#7c3aed' }, { label: 'Cancellations', data: hrs.map(function (x) { return x.cancel; }), backgroundColor: '#dc2626' }] },
            options: { responsive: true, animation: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { x: { stacked: true, ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true } }, y: { stacked: true, beginAtZero: true, ticks: { font: { size: 9 } } } } } });
    }
    function render() {
        if (!st.open) return;
        var dlg = document.getElementById('dbf-dlg');
        if (!dlg) { dlg = document.createElement('div'); dlg.id = 'dbf-dlg'; dlg.className = 'dbf-dlg'; document.body.appendChild(dlg); dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); }); }
        var m = current(), t = today();
        dlg.innerHTML = '<div class="dbf-box" role="dialog" aria-label="Day debrief">' +
            '<div class="dbf-head"><h3><i class="fas fa-clipboard-list"></i> Day debrief <span class="dbf-pod">' + esc(st.pod) + '</span></h3><span class="dbf-day">' + esc(E.dayWord(st.date)) + '</span><button class="dbf-x" id="dbf-close" title="Close">✕</button></div>' +
            '<div class="dbf-bar"><button class="dbf-btn light icon" id="dbf-prev" title="Previous day"><i class="fas fa-chevron-left"></i></button><input type="date" id="dbf-date" value="' + esc(st.date) + '"><button class="dbf-btn light icon" id="dbf-next" title="Next day"><i class="fas fa-chevron-right"></i></button>' +
            [addDays(t, -1), t, addDays(t, 1)].map(function (d) { return '<button class="dbf-chip' + (st.date === d ? ' on' : '') + '" data-d="' + d + '">' + esc(dayShort(d).split(' ')[0]) + '</button>'; }).join('') +
            '<button class="dbf-btn" id="dbf-build" ' + (st.busy ? 'disabled' : '') + ' title="Read the whole day again from APEX, Fusion and the WMS records"><i class="fas fa-sync-alt"></i> ' + (m ? 'Build again' : 'Build') + '</button>' +
            '<span class="dbf-keepwrap"><button class="dbf-btn light" id="dbf-keep-btn" ' + (st.keep.running ? 'disabled' : '') + ' title="Read whole dates from APEX and keep them on this PC: trips, orders, MRA statuses and order lines — the toolbar search and the debrief then work without APEX"><i class="fas fa-database"></i> Keep on this PC <i class="fas fa-caret-down"></i></button>' + keepMenuHtml() + '</span>' +
            '<span class="dbf-step" id="dbf-step">' + keepProgHtml() + '</span><span class="dbf-sep"></span>' +
            '<button class="dbf-btn light" id="dbf-copy" ' + (m ? '' : 'disabled') + ' title="Copy the debrief as text for e-mail / Teams"><i class="fas fa-copy"></i> Copy text</button><button class="dbf-btn light" id="dbf-print" ' + (m ? '' : 'disabled') + '><i class="fas fa-print"></i> Print</button><button class="dbf-btn" id="dbf-pdf" ' + (m ? '' : 'disabled') + '><i class="fas fa-file-pdf"></i> PDF</button></div>' +
            '<div class="dbf-cov" id="dbf-cov">' + covHtml() + '</div>' +
            '<div class="dbf-body" id="dbf-body">' + bodyHtml() + '</div>' +
            '<div class="dbf-foot"><span>' + (m ? (m.src === 'db' ? '<i class="fas fa-database" style="color:#4f46e5"></i> from this PC, built ' + esc(m.builtAt) + ' — Build again reads the day afresh' : '<i class="fas fa-sync-alt" style="color:#16a34a"></i> built ' + esc(m.builtAt) + (DB.on() ? ' · kept on this PC' : '')) : DB.host === false ? 'no DuckDB on this build — nothing kept' : '') + '</span><span class="dbf-sep"></span><span>Gray\'s WMS · Day debrief</span></div></div>';
        wire(dlg);
        if (m && !st.busy && !st.loading && !st.err) drawChart(m);
    }
    function wire(dlg) {
        dlg.querySelector('#dbf-close').onclick = close;
        dlg.querySelector('#dbf-prev').onclick = function () { showDate(addDays(st.date, -1)); };
        dlg.querySelector('#dbf-next').onclick = function () { showDate(addDays(st.date, 1)); };
        dlg.querySelector('#dbf-date').onchange = function () { if (this.value) showDate(this.value); };
        dlg.querySelectorAll('.dbf-chip').forEach(function (b) { b.onclick = function () { showDate(b.getAttribute('data-d')); }; });
        dlg.querySelector('#dbf-build').onclick = function () { rebuild(dlg.querySelector('#dbf-date').value || st.date); };
        dlg.querySelector('#dbf-copy').onclick = copyText;
        dlg.querySelector('#dbf-print').onclick = printView;
        dlg.querySelector('#dbf-pdf').onclick = pdf;
        dlg.querySelector('#dbf-keep-btn').onclick = function (e) { e.stopPropagation(); st.keep.menu = !st.keep.menu; paintKeepMenu(); };
        wireKeep(dlg); wireCov(dlg);
    }
    // ─── "Keep on this PC": whole dates into DuckDB (MraInterface.keepRange) + the coverage strip ─────────────────────────────
    function rangeDates(from, to) { var out = [], d = from; if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return out; while (d <= to && out.length < 120) { out.push(d); d = addDays(d, 1); } return out; }
    function covDates() { var t = today(), out = []; for (var i = -28; i <= 1; i++) out.push(addDays(t, i)); return out; }   // the last 4 weeks, today and tomorrow
    function covGaps() { var cov = st.cov || {}; return covDates().filter(function (d) { return !cov[d]; }); }
    function keepMenuHtml() {
        var t = today(), gaps = covGaps(), k = st.keep;
        return '<div class="dbf-keepmenu" id="dbf-keep-menu" style="display:' + (k.menu ? 'block' : 'none') + '">' +
            '<div class="hd">Read from APEX and keep on this PC</div>' +
            '<button data-keep="this"><i class="fas fa-calendar-day"></i> This date <small>' + esc(st.date) + '</small></button>' +
            '<button data-keep="7"><i class="fas fa-calendar-week"></i> Last 7 days <small>' + esc(addDays(t, -6)) + ' → ' + esc(t) + '</small></button>' +
            '<button data-keep="30"><i class="fas fa-calendar-alt"></i> Last 30 days <small>' + esc(addDays(t, -29)) + ' → ' + esc(t) + '</small></button>' +
            (gaps.length ? '<button data-keep="gaps"><i class="fas fa-fill-drip"></i> Fill the gaps <small>' + gaps.length + ' date' + (gaps.length === 1 ? '' : 's') + ' of the last 4 weeks not on this PC</small></button>' : '') +
            '<div class="rng"><span>From</span><input type="date" id="dbf-keep-from" value="' + esc(k.from || addDays(t, -13)) + '"><span>to</span><input type="date" id="dbf-keep-to" value="' + esc(k.to || t) + '"><button class="dbf-btn" id="dbf-keep-go">Keep</button></div>' +
            '<div class="ft">About 20 APEX calls a date · at most 120 dates a run · a kept date is a snapshot (Build / Refresh read it again)</div></div>';
    }
    function keepProgHtml() { var k = st.keep; return k.running ? '<i class="fas fa-spinner fa-spin"></i> keeping ' + (k.i + 1) + ' of ' + k.n + ' · ' + esc(k.step) + ' <a class="dbf-stop" onclick="WmsDebrief.keepStop()">Stop</a>' : ''; }
    function paintKeepMenu() { var el = document.getElementById('dbf-keep-menu'); if (el) el.style.display = st.keep.menu ? 'block' : 'none'; }
    function paintKeepProg() { var el = document.getElementById('dbf-step'); if (el && (st.keep.running || /keeping/.test(el.textContent))) el.innerHTML = keepProgHtml(); }
    document.addEventListener('click', function (e) { if (st.keep.menu && !(e.target.closest && e.target.closest('.dbf-keepwrap'))) { st.keep.menu = false; paintKeepMenu(); } });
    function wireKeep(dlg) {
        dlg.querySelectorAll('#dbf-keep-menu [data-keep]').forEach(function (b) {
            b.onclick = function () {
                var t = today(), w = b.getAttribute('data-keep');
                if (w === 'this') keepDates([st.date]); else if (w === '7') keepDates(rangeDates(addDays(t, -6), t)); else if (w === '30') keepDates(rangeDates(addDays(t, -29), t)); else if (w === 'gaps') keepDates(covGaps());
            };
        });
        var go = dlg.querySelector('#dbf-keep-go'); if (go) go.onclick = function () { var f = dlg.querySelector('#dbf-keep-from').value, t = dlg.querySelector('#dbf-keep-to').value; if (!f || !t) return; if (f > t) { var x = f; f = t; t = x; } st.keep.from = f; st.keep.to = t; keepDates(rangeDates(f, t)); };
    }
    function keepDates(dates) {
        st.keep.menu = false; paintKeepMenu();
        if (!dates.length) { note('Nothing to keep.', 'info'); return Promise.resolve(); }
        if (!window.MraInterface || typeof window.MraInterface.keepRange !== 'function') { note('mra-interface.js is not loaded.', 'warning'); return Promise.resolve(); }
        if (!DB.on()) { note('This build has no DuckDB — nothing can be kept on this PC.', 'warning'); return Promise.resolve(); }
        if (st.keep.running) { note('A keep run is already going — Stop it first.', 'warning'); return Promise.resolve(); }
        var k = st.keep, pod = st.pod; k.running = true; k.stop = false; k.i = 0; k.n = dates.length; k.step = 'starting'; render();
        return window.MraInterface.keepRange(pod, dates, null, function (text, i) { k.i = i; k.step = text; paintKeepProg(); covMark(dates[i], 'busy'); }, function () { return k.stop; }).then(function (r) {
            k.running = false;
            var msg = r.dates + ' date' + (r.dates === 1 ? '' : 's') + ' kept on this PC — ' + r.trips + ' trips, ' + r.orders + ' orders, ' + r.lines + ' lines' + (r.failed.length ? ' · ' + r.failed.length + ' failed (' + r.failed[0].date + ': ' + r.failed[0].error + ')' : '') + (r.stopped ? ' · stopped' : '') + '. The toolbar search now finds them; Build reads a date\'s debrief.';
            note(msg, r.failed.length ? 'warning' : 'success');
            try { if (typeof window.aiAudit === 'function') window.aiAudit({ source: 'WMS_DEBRIEF', actionKey: 'keep_dates', outcome: r.failed.length ? 'PARTIAL' : 'OK', detail: msg }); } catch (e) {}
            return loadCov().then(render);
        }).catch(function (e) { k.running = false; note('Keep failed: ' + (e && e.message || e), 'error'); render(); });
    }
    function loadCov() {
        if (!window.MraInterface || typeof window.MraInterface.coverage !== 'function') return Promise.resolve();
        var pod = st.pod;
        return window.MraInterface.coverage(pod).then(function (rows) { var m = {}; (rows || []).forEach(function (r) { m[r.trip_date] = r; }); st.cov = m; st.covPod = pod; paintCov(); }).catch(function () {});
    }
    function covHtml() {
        if (!DB.on()) return '';
        var cov = st.cov || {}, dates = covDates(), kept = dates.filter(function (d) { return cov[d]; }).length, all = Object.keys(cov).sort(), t = today();
        return '<span class="lbl"><i class="fas fa-database"></i> On this PC</span>' +
            '<span class="cells">' + dates.map(function (d) { var c = cov[d]; return '<i class="c ' + (c ? (c.lines ? 'k kl' : 'k') : 'm') + (d === t ? ' t' : '') + (d === st.date ? ' s' : '') + '" data-d="' + d + '" title="' + esc(dayWord(d) ? dayWord(d) + ' · ' : '') + esc(d) + (c ? ' · ' + c.n_trips + ' trip' + (c.n_trips === 1 ? '' : 's') + (c.lines ? ' · ' + c.lines + ' lines' : ' · no lines yet') + ' · read ' + esc(String(c.read_at).replace('T', ' ').slice(0, 16)) : ' · not on this PC — click to open, Keep to read it') + '"></i>'; }).join('') + '</span>' +
            '<span class="sum">' + kept + ' of the last ' + dates.length + ' days' + (all.length > kept ? ' · ' + all.length + ' dates in all (' + esc(all[0]) + ' → ' + esc(all[all.length - 1]) + ')' : '') + (kept < dates.length ? ' · <a onclick="WmsDebrief.keepGaps()">fill the ' + (dates.length - kept) + ' missing</a>' : ' · complete') + '</span>';
    }
    function paintCov() { var el = document.getElementById('dbf-cov'); if (el) { el.innerHTML = covHtml(); wireCov(el); } }
    function covMark(d, cls) { var el = document.querySelector('#dbf-cov .c[data-d="' + d + '"]'); if (el) el.classList.add(cls); }
    function wireCov(root) { root.querySelectorAll('#dbf-cov .c, .dbf-cov .c').forEach(function (c) { c.onclick = function () { showDate(c.getAttribute('data-d')); }; }); }
    function dayWord(s) { return E.dayWord ? String(E.dayWord(s)).split(' ')[0].replace(/,$/, '') : ''; }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.open) close(); });

    // ─── outputs: copy / print / PDF ──────────────────────────────────────────
    function copyText() {
        var m = current(); if (!m) return; var text = E.text(m);
        var done = function () { note('Debrief copied as text.', 'success'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); }); else { fallbackCopy(text); done(); }
    }
    function fallbackCopy(text) { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); }
    /** A self-contained print page (also the PDF fallback when jsPDF is not loaded). */
    function printHtml(m) {
        var k = m.kpis, n = m.narrative, css = 'body{font-family:Segoe UI,Arial,sans-serif;font-size:11.5px;color:#0f172a;margin:24px} h1{font-size:20px;margin:0 0 2px;color:#0b2545} h2{font-size:13px;margin:16px 0 6px;color:#0b2545;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid #e2e8f0;padding-bottom:3px} .sub{color:#64748b;margin-bottom:12px} .k{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin:10px 0} .k div{border:1px solid #e2e8f0;border-radius:6px;padding:6px 8px} .k b{display:block;font-size:16px} .k span{font-size:9.5px;color:#64748b;text-transform:uppercase} table{width:100%;border-collapse:collapse;margin:4px 0 8px} th{text-align:left;font-size:9.5px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #cbd5e1;padding:3px 5px} td{padding:3px 5px;border-bottom:1px solid #f1f5f9;vertical-align:top} td.n,th.n{text-align:right} p{line-height:1.5;margin:0 0 6px} .tag{display:inline-block;border-radius:999px;padding:1px 8px;font-size:10px;font-weight:700;margin:2px 4px 2px 0} .good{background:#dcfce7;color:#15803d} .bad{background:#fee2e2;color:#b91c1c} @page{margin:14mm} tr{page-break-inside:avoid}';
        var row = function (cells) { return '<tr>' + cells.map(function (c) { return '<td class="' + (typeof c === 'number' ? 'n' : '') + '">' + esc(c) + '</td>'; }).join('') + '</tr>'; };
        var table = function (head, rows) { return '<table><thead><tr>' + head.map(function (h) { return '<th class="' + (/^#/.test(h) ? 'n' : '') + '">' + esc(h.replace(/^#/, '')) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>'; };
        var h = '<!doctype html><html><head><meta charset="utf-8"><title>Day debrief ' + esc(m.date) + ' ' + esc(m.pod) + '</title><style>' + css + '</style></head><body>';
        h += '<h1>Day debrief — ' + esc(m.dayWord) + '</h1><div class="sub">' + esc(m.pod) + ' · ' + esc(n.headline) + (m.score != null ? ' · readiness ' + m.score + ' %' : '') + ' · built ' + esc(m.builtAt) + ' · Gray\'s WMS</div>';
        h += '<div class="k">' + [['Trips', k.trips], ['Sales orders', k.orders], ['Order lines', k.lines], ['Pickers', k.pickers], ['Released', k.released], ['Picked', k.picked], ['Shipped', k.shipped], ['Printed', k.printed], ['MRA done', k.mraDone], ['MRA failed', k.mraFailed], ['Cancelled lines', k.cancelledLines], ['Pending cancel', k.pendingCancel], ['Order errors', k.orderErrors], ['No picker', k.noPicker], ['Store / van', k.store], ['People active', k.users]].map(function (x) { return '<div><b>' + esc(x[1]) + '</b><span>' + esc(x[0]) + '</span></div>'; }).join('') + '</div>';
        h += '<div>' + n.highlights.map(function (x) { return '<span class="tag good">✓ ' + esc(x) + '</span>'; }).join('') + n.lowlights.map(function (x) { return '<span class="tag bad">! ' + esc(x) + '</span>'; }).join('') + '</div>';
        h += '<h2>The story of the day</h2>' + n.paragraphs.map(function (p) { return '<p><b>' + esc(p.title) + '.</b> ' + esc(p.text) + '</p>'; }).join('');
        if (m.issues.length) h += '<h2>Needs attention</h2>' + table(['Kind', '#n', 'Detail'], m.issues.map(function (i) { return row([i.kind, i.n, i.text]); }));
        h += '<h2>Trips</h2>' + table(['Trip', 'Lorry', 'Bay', 'Priority', '#Orders', '#Lines', '#Released', '#Picked', '#Shipped', '#Printed', 'MRA', 'Pickers', '#No picker', '#Cancelled', '#Pending', '#Errors', '#Readiness %'], m.trips.map(function (t) { return row([t.trip_id, t.lorry, t.bay, t.priority, t.orders, t.lines, t.released, t.picked, t.shipped, t.printed, t.mraDone + '/' + t.orders + (t.mraFailed ? ' (' + t.mraFailed + ' failed)' : ''), t.pickers, t.noPicker, t.cancelledLines, t.pendingCancel, t.errors, t.readiness]); }));
        if (m.pickers.length) h += '<h2>Pickers</h2>' + table(['Picker', '#Orders', '#Trips', '#Lines', '#Picked', '#Picked %', '#Shipped', 'First assigned'], m.pickers.map(function (p) { return row([p.name, p.orders, p.trips, p.lines, p.picked, p.pickedPct, p.shipped, p.firstAssigned]); }));
        h += '<h2>MRA</h2><p>' + m.mra.done + ' done · ' + m.mra.failed + ' failed · ' + m.mra.skipped + ' skipped · ' + m.mra.none + ' not sent · ' + m.mra.tries + ' tries on the day (' + m.mra.ok + ' ok, ' + m.mra.fail + ' failed' + (m.mra.gw ? ', ' + m.mra.gw + ' gateway problems' : '') + ')</p>' + (m.mra.byUser.length ? table(['By', '#Tries', '#Ok', '#Failed', '#Gateway', 'Sources'], m.mra.byUser.map(function (u) { return row([u.name, u.tries, u.ok, u.failed, u.gw, u.sources]); })) : '') + (m.mra.failedRows.length ? table(['Trip', 'Order', 'Customer', 'Reason', '#Tries'], m.mra.failedRows.map(function (r) { return row([r.trip_id, r.order_number, r.customer, r.why, r.tries]); })) : '');
        h += '<h2>Cancellations</h2><p>' + k.cancelledLines + ' cancelled lines on the trips · ' + m.cancels.done + ' done on the day · ' + m.cancels.failed + ' failed · ' + m.cancels.runs + ' runs · ' + k.pendingCancel + ' pending</p>' + (m.cancels.rows.length ? table(['Time', 'By', 'Trip', 'Order', 'Line', 'Item', 'Via', 'Result', 'Message'], m.cancels.rows.slice(0, 80).map(function (r) { return row([r.t, r.user, r.trip_id, r.order_number, r.line_number, r.item, r.via, r.result, r.message]); })) : '');
        if (m.errors.length) h += '<h2>Order errors</h2>' + table(['Trip', 'Order', 'Customer', 'Main line', 'Status', 'Child', 'Child status'], m.errors.map(function (e) { return row([e.trip_id, e.order_number, e.customer, e.line_number + ' · ' + e.item, e.status, e.child_line + ' · ' + e.child_item, e.child_status]); }));
        h += '<h2>People — who did what</h2>' + (m.users.length ? table(['User', 'Active', '#Actions', 'What they did', 'Most used'], m.users.map(function (u) { return row([u.name, u.first ? u.first + (u.last && u.last !== u.first ? ' – ' + u.last : '') : '', u.events, u.did, u.actions.map(function (a) { return a.target + ' ×' + a.n; }).join(', ')]); })) : '<p>No user activity recorded.</p>');
        h += '<h2>Timeline</h2><p>' + (m.timeline.first ? 'From ' + m.timeline.first + ' to ' + m.timeline.last + (m.timeline.peak ? ', busiest around ' + m.timeline.peak : '') + '.' : 'No events.') + '</p>' + table(['Hour', '#Actions', '#MRA tries', '#Cancellations'], m.timeline.hours.filter(function (x) { return x.activity + x.mra + x.cancel > 0; }).map(function (x) { return row([x.h + ':00', x.activity, x.mra, x.cancel]); }));
        h += '<h2>Order types · line statuses · top customers</h2>' + table(['Order type', '#Orders'], m.orderTypes.map(function (x) { return row([x.name, x.n]); })) + table(['Line status', '#Lines'], m.lineStatuses.map(function (x) { return row([x.status, x.n]); })) + table(['Customer', '#Orders'], m.customers.map(function (x) { return row([x.name, x.n]); }));
        return h + '</body></html>';
    }
    function printView() {
        var m = current(); if (!m) return;
        var f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'; f.setAttribute('srcdoc', printHtml(m)); document.body.appendChild(f);
        f.onload = function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { note('Print failed: ' + e.message, 'error'); } setTimeout(function () { f.remove(); }, 60000); };
    }
    /** The PDF with jsPDF + autotable: header band, KPIs, the story, every table, the timeline chart, page numbers. */
    function pdf() {
        var m = current(); if (!m) return;
        var J = window.jspdf && window.jspdf.jsPDF;
        if (!J) { note('The PDF library is not loaded — the print view opens instead (Save as PDF).', 'warning'); printView(); return; }
        var doc = new J({ orientation: 'portrait', unit: 'pt', format: 'a4' }), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 36, y = 0, k = m.kpis, n = m.narrative;
        var auto = typeof doc.autoTable === 'function';
        var head = function () { doc.setFillColor(11, 37, 69); doc.rect(0, 0, W, 64, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('Day debrief — ' + m.dayWord, M, 28); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(m.pod + ' · ' + n.headline + (m.score != null ? ' · readiness ' + m.score + ' %' : '') + ' · built ' + m.builtAt, M, 46); doc.setTextColor(15, 23, 42); y = 80; };
        var need = function (h) { if (y + h > H - 40) { doc.addPage(); y = M; } };
        var title = function (t) { need(28); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(11, 37, 69); doc.text(t.toUpperCase(), M, y); doc.setDrawColor(226, 232, 240); doc.line(M, y + 4, W - M, y + 4); y += 14; doc.setTextColor(15, 23, 42); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); };
        var para = function (text, bold) { var lines = doc.splitTextToSize(text, W - 2 * M); need(lines.length * 12 + 4); if (bold) doc.setFont('helvetica', 'bold'); doc.text(lines, M, y); doc.setFont('helvetica', 'normal'); y += lines.length * 12 + 4; };
        var table = function (headRow, body, widths) {
            if (!body.length) return;
            if (!auto) { body.slice(0, 40).forEach(function (r) { para(r.join(' · ')); }); return; }
            doc.autoTable({ startY: y, head: [headRow], body: body, margin: { left: M, right: M }, styles: { fontSize: 7.5, cellPadding: 2.5, overflow: 'linebreak' }, headStyles: { fillColor: [30, 58, 138], textColor: 255, fontSize: 7.5 }, alternateRowStyles: { fillColor: [248, 250, 252] }, columnStyles: widths || {}, didDrawPage: function () { y = M; } });
            y = doc.lastAutoTable.finalY + 12;
        };
        head();
        // KPI grid
        var tiles = [['Trips', k.trips], ['Sales orders', k.orders], ['Order lines', k.lines], ['Pickers', k.pickers], ['Released', k.released + (k.orders ? ' (' + pct(k.released, k.orders) + ' %)' : '')], ['Picked', k.picked], ['Shipped', k.shipped + (k.orders ? ' (' + pct(k.shipped, k.orders) + ' %)' : '')], ['Printed', k.printed], ['MRA done', k.mraDone + (k.orders ? ' (' + m.mra.pct + ' %)' : '')], ['MRA failed', k.mraFailed], ['Cancelled lines', k.cancelledLines], ['Pending cancel', k.pendingCancel], ['Order errors', k.orderErrors], ['No picker', k.noPicker], ['Store / van', k.store], ['People active', k.users]];
        var cw = (W - 2 * M) / 4, ch = 34;
        tiles.forEach(function (t, i) { var cx = M + (i % 4) * cw, cy = y + Math.floor(i / 4) * (ch + 4); doc.setDrawColor(226, 232, 240); doc.setFillColor(248, 250, 252); doc.roundedRect(cx + 2, cy, cw - 4, ch, 4, 4, 'FD'); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(String(t[1]), cx + 8, cy + 15); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.text(t[0].toUpperCase(), cx + 8, cy + 27); doc.setTextColor(15, 23, 42); });
        y += Math.ceil(tiles.length / 4) * (ch + 4) + 10;
        if (n.highlights.length) para('Highlights: ' + n.highlights.join(' · '), true);
        if (n.lowlights.length) para('Watch: ' + n.lowlights.join(' · '), true);
        title('The story of the day');
        n.paragraphs.forEach(function (p) { para(p.title + '. ' + p.text); });
        // timeline chart from the dialog's canvas
        var c = document.getElementById('dbf-chart');
        if (c && m.timeline.first) { try { var img = c.toDataURL('image/png'); var iw = W - 2 * M, ih = iw * c.height / c.width; need(ih + 30); title('Timeline'); doc.addImage(img, 'PNG', M, y, iw, ih); y += ih + 10; } catch (e) { console.warn('[Debrief] chart image:', e); } }
        if (m.issues.length) { title('Needs attention'); table(['Kind', 'n', 'Detail'], m.issues.map(function (i) { return [i.kind, i.n, i.text]; }), { 0: { cellWidth: 90 }, 1: { cellWidth: 24, halign: 'right' } }); }
        title('Trips'); table(['Trip', 'Lorry', 'Orders', 'Lines', 'Rel.', 'Picked', 'Shipped', 'Printed', 'MRA', 'Pickers', 'No picker', 'Canc. lines', 'Pending', 'Errors', 'Ready %'], m.trips.map(function (t) { return [t.trip_id, t.lorry, t.orders, t.lines, t.released, t.picked, t.shipped, t.printed, t.mraDone + '/' + t.orders + (t.mraFailed ? ' (' + t.mraFailed + ' f)' : ''), t.pickers, t.noPicker, t.cancelledLines, t.pendingCancel, t.errors, t.readiness]; }));
        if (m.pickers.length) { title('Pickers'); table(['Picker', 'Orders', 'Trips', 'Lines', 'Picked', 'Picked %', 'Shipped', 'First assigned'], m.pickers.map(function (p) { return [p.name, p.orders, p.trips, p.lines, p.picked, p.pickedPct, p.shipped, p.firstAssigned]; })); }
        title('MRA'); para(m.mra.done + ' done · ' + m.mra.failed + ' failed · ' + m.mra.skipped + ' skipped · ' + m.mra.none + ' not sent · ' + m.mra.tries + ' tries on the day (' + m.mra.ok + ' ok, ' + m.mra.fail + ' failed' + (m.mra.gw ? ', ' + m.mra.gw + ' gateway problems' : '') + ')');
        if (m.mra.byUser.length) table(['By', 'Tries', 'Ok', 'Failed', 'Gateway', 'Sources'], m.mra.byUser.map(function (u) { return [u.name, u.tries, u.ok, u.failed, u.gw, u.sources]; }));
        if (m.mra.failedRows.length) table(['Trip', 'Order', 'Customer', 'Reason', 'Tries'], m.mra.failedRows.map(function (r) { return [r.trip_id, r.order_number, r.customer, r.why, r.tries]; }));
        title('Cancellations'); para(k.cancelledLines + ' cancelled lines on the trips · ' + m.cancels.done + ' done on the day · ' + m.cancels.failed + ' failed · ' + m.cancels.runs + ' runs · ' + k.pendingCancel + ' pending');
        if (m.cancels.rows.length) table(['Time', 'By', 'Trip', 'Order', 'Line', 'Item', 'Via', 'Result', 'Message'], m.cancels.rows.slice(0, 80).map(function (r) { return [r.t, r.user, r.trip_id, r.order_number, r.line_number, r.item, r.via, r.result, r.message]; }));
        if (m.errors.length) { title('Order errors'); table(['Trip', 'Order', 'Customer', 'Main line', 'Status', 'Child', 'Child status'], m.errors.map(function (e) { return [e.trip_id, e.order_number, e.customer, e.line_number + ' · ' + e.item, e.status, e.child_line + ' · ' + e.child_item, e.child_status]; })); }
        title('People — who did what');
        if (m.users.length) table(['User', 'Active', 'Actions', 'What they did', 'Most used'], m.users.map(function (u) { return [u.name, u.first ? u.first + (u.last && u.last !== u.first ? ' – ' + u.last : '') : '', u.events, u.did, u.actions.map(function (a) { return a.target + ' ×' + a.n; }).join(', ')]; }), { 3: { cellWidth: 220 } }); else para('No user activity recorded.');
        title('Order types · line statuses · top customers');
        table(['Order type', 'Orders'], m.orderTypes.map(function (x) { return [x.name, x.n]; }), { 0: { cellWidth: 200 } });
        table(['Line status', 'Lines'], m.lineStatuses.map(function (x) { return [x.status, x.n]; }), { 0: { cellWidth: 200 } });
        table(['Customer', 'Orders'], m.customers.map(function (x) { return [x.name, x.n]; }), { 0: { cellWidth: 200 } });
        // page numbers
        var pages = doc.internal.getNumberOfPages();
        for (var p = 1; p <= pages; p++) { doc.setPage(p); doc.setFontSize(8); doc.setTextColor(148, 163, 184); doc.text('Gray\'s WMS · Day debrief · ' + m.dayWord + ' · ' + m.pod, M, H - 18); doc.text('Page ' + p + ' of ' + pages, W - M, H - 18, { align: 'right' }); }
        showPdf(doc, 'day-debrief-' + m.pod + '-' + m.date + '.pdf');
        return doc;
    }

    // ─── the PDF viewer: inside the app, with its own Save / Print / Close ───────────────────────────────────────────
    // jsPDF's own save() hands a blob: download to the host, and this app's WebView2 opened it as a bare new tab with no
    // way back. So the PDF is shown here, in an overlay over the debrief: Chromium's viewer in an iframe, a bar with the
    // file name, Save PDF (host `saveFileAs` → a Save dialog; without the host the browser download), Print and ✕ / Esc.
    var PV = { url: null, blob: null, name: '', saved: '' };
    function fmtBytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
    function showPdf(doc, name) {
        closePdf();
        var blob; try { blob = doc.output('blob'); } catch (e) { note('Could not build the PDF: ' + (e && e.message || e), 'error'); return; }
        var pages = 0; try { pages = doc.internal.getNumberOfPages(); } catch (e) {}
        PV.blob = blob; PV.name = name; PV.saved = ''; PV.url = URL.createObjectURL(blob);
        var ov = document.createElement('div'); ov.id = 'dbf-pdfv'; ov.className = 'dbf-pdfv';
        ov.innerHTML = '<div class="dbf-pdfbar"><i class="fas fa-file-pdf"></i><b>' + esc(name) + '</b><span class="dbf-pdfn">' + (pages ? pages + ' page' + (pages === 1 ? '' : 's') + ' · ' : '') + fmtBytes(blob.size) + '</span><span id="dbf-pdf-saved" class="dbf-pdfsaved"></span><span class="sp"></span>' +
            '<button class="dbf-btn" id="dbf-pdf-save" title="Save the PDF where you choose"><i class="fas fa-download"></i> Save PDF</button>' +
            '<button class="dbf-btn light" id="dbf-pdf-print" title="Print the PDF"><i class="fas fa-print"></i> Print</button>' +
            '<button class="dbf-x" id="dbf-pdf-close" title="Close the PDF (Esc)">✕</button></div>' +
            '<iframe class="dbf-pdfframe" src="' + PV.url + '#view=FitH" title="' + esc(name) + '"></iframe>' +
            '<div class="dbf-pdfhint">Shown inside the app. <b>Save PDF</b> keeps a copy where you choose · <b>Close</b> (or Esc) returns to the debrief.</div>';
        document.body.appendChild(ov);
        ov.querySelector('#dbf-pdf-close').onclick = closePdf;
        ov.querySelector('#dbf-pdf-print').onclick = printPdf;
        ov.querySelector('#dbf-pdf-save').onclick = savePdf;
        try { ov.querySelector('#dbf-pdf-save').focus(); } catch (e) {}
    }
    function closePdf() {
        var ov = document.getElementById('dbf-pdfv'); if (ov) ov.remove();
        if (PV.url) { try { URL.revokeObjectURL(PV.url); } catch (e) {} }
        PV.url = null; PV.blob = null;
    }
    function printPdf() {
        var f = document.querySelector('#dbf-pdfv iframe');
        try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { printView(); }
    }
    /** Save PDF: the host's Save dialog (saveFileAs), else the browser's own download. */
    function savePdf() {
        if (!PV.blob) return;
        var btn = document.getElementById('dbf-pdf-save'), tag = document.getElementById('dbf-pdf-saved');
        if (!hosted()) { var a = document.createElement('a'); a.href = PV.url; a.download = PV.name; document.body.appendChild(a); a.click(); a.remove(); note('PDF downloaded.', 'success'); return; }
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }
        var done = function () { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Save PDF'; } };
        var rd = new FileReader();
        rd.onerror = function () { done(); note('Could not read the PDF for saving.', 'error'); };
        rd.onload = function () {
            var b64 = String(rd.result || '').split(',')[1] || '';
            sendMessageToCSharp({ action: 'saveFileAs', fileName: PV.name, base64: b64, filter: 'PDF files (*.pdf)|*.pdf|All files (*.*)|*.*', title: 'Save the day debrief' }, function (err, data) {
                done();
                if (err) { note('Could not save the PDF: ' + (err.message || err), 'error'); return; }
                var d = typeof data === 'string' ? (function () { try { return JSON.parse(data); } catch (e) { return {}; } })() : (data || {});
                if (d.cancelled) return;
                if (!d.ok) { note('Could not save the PDF: ' + (d.error || 'the host did not save it'), 'error'); return; }
                PV.saved = d.path || '';
                if (tag) tag.innerHTML = '<i class="fas fa-check"></i> saved · <span title="' + esc(PV.saved) + '">' + esc(PV.saved.split(/[\\/]/).pop()) + '</span> <a onclick="WmsDebrief.reveal()">Show in folder</a>';
                note('PDF saved: ' + PV.saved, 'success');
            }, 15 * 60000, false);
        };
        rd.readAsDataURL(PV.blob);
    }
    function revealSaved() { if (PV.saved && hosted()) sendMessageToCSharp({ action: 'revealFile', path: PV.saved }, function () {}, 5000, false); }
    // Esc closes the PDF first (capture phase, so the debrief behind it stays open)
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.getElementById('dbf-pdfv')) { e.stopPropagation(); e.preventDefault(); closePdf(); } }, true);

    window.WmsDebrief = {
        open: open, close: close, show: showDate, build: rebuild, pdf: pdf, print: printView, copy: copyText, closePdf: closePdf, savePdf: savePdf, reveal: revealSaved,
        keep: function (from, to) { return keepDates(Array.isArray(from) ? from : rangeDates(from, to || from)); }, keepStop: function () { st.keep.stop = true; st.keep.step = 'stopping after this date'; paintKeepProg(); }, keepGaps: function () { return keepDates(covGaps()); }, coverage: loadCov,
        trip: function (tripId) { var m = current(), t = m && m.trips.filter(function (x) { return String(x.trip_id) === String(tripId); })[0]; if (typeof window.openTripDetails !== 'function') return; close(); if (typeof window.navigateToPage === 'function') window.navigateToPage('trip-management'); try { window.openTripDetails(String(tripId), m ? m.date : st.date, t ? t.lorry : '', st.pod, t ? t.bay : '', t ? t.priority : ''); } catch (e) { note('Could not open trip ' + tripId + ': ' + (e && e.message || e), 'error'); } },
        html: function () { var m = current(); return m ? printHtml(m) : ''; },
        state: function () { return { pod: st.pod, date: st.date, open: st.open, busy: st.busy, step: st.step, err: st.err, model: current(), db: DB.host, keep: st.keep, cov: st.cov }; }
    };
})();
