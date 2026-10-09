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
    var st = { open: false, pod: curInstance(), date: today(), models: {}, busy: false, step: '', err: '', chart: null, loading: false };
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
                tell('the day\'s records (MRA tries, cancellations, activity, print, audit)');
                var names = Object.keys(reads);
                return Promise.all(names.map(function (k) { return reads[k]; })).then(function (vals) {
                    var g = {}; names.forEach(function (k, i) { g[k] = vals[i]; });
                    var findings = A.run({ date: date, rows: s.rows, trips: lines.map(function (t) { return { trip_id: t.trip_id, lines: t.lines }; }), bogo: bg });
                    var model = E.model({ pod: pod, date: date, builtAt: now(), rows: s.rows, trips: lines, hidden: s.hidden, findings: findings, mraRuns: g.mraRuns, cancelLog: g.cancelLog, activity: g.activity, actions: g.actions, hourly: g.hAct.concat(g.hMra, g.hCancel), audit: g.audit, prints: g.prints, shipDates: g.shipDates, pins: g.pins, errors: errors });
                    model.src = 'live';
                    st.models[key(pod, date)] = model;
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
    }
    function close() { st.open = false; destroyChart(); var d = document.getElementById('dbf-dlg'); if (d) d.remove(); }
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
        h += '<div class="dbf-card"><h4><i class="fas fa-truck"></i> Trips <span class="n">' + m.trips.length + '</span></h4>' + tbl([{ t: 'Trip' }, { t: 'Lorry' }, { t: 'Bay' }, { t: 'Priority' }, { t: 'Orders', num: 1 }, { t: 'Customers', num: 1 }, { t: 'Lines', num: 1 }, { t: 'Released', num: 1 }, { t: 'Picked', num: 1 }, { t: 'Shipped', num: 1 }, { t: 'Printed', num: 1 }, { t: 'MRA', num: 1 }, { t: 'Pickers' }, { t: 'No picker', num: 1 }, { t: 'Cancelled lines', num: 1 }, { t: 'Pending', num: 1 }, { t: 'Errors', num: 1 }, { t: 'Readiness', num: 1 }], m.trips.map(function (t) {
            return '<tr>' + td('<a style="color:#1e3a8a;font-weight:700;cursor:pointer" onclick="WmsDebrief.trip(' + JSON.stringify(String(t.trip_id)).replace(/"/g, '&quot;') + ')">' + esc(t.trip_id) + '</a>', false, true) + td(t.lorry) + td(t.bay) + td(t.priority) + td(t.orders, 1) + td(t.customers, 1) + td(t.lines, 1) + td(t.released, 1) + td(t.picked, 1) + td(t.shipped, 1) + td(t.printed, 1) + td(t.mraDone + '/' + t.orders + (t.mraFailed ? ' <span class="dbf-pill red">' + t.mraFailed + ' failed</span>' : ''), 1, true) + td(t.pickers) + td(t.noPicker ? '<span class="dbf-pill amber">' + t.noPicker + '</span>' : '0', 1, true) + td(t.cancelledLines, 1) + td(t.pendingCancel ? '<span class="dbf-pill red">' + t.pendingCancel + '</span>' : '0', 1, true) + td(t.errors ? '<span class="dbf-pill red">' + t.errors + '</span>' : '0', 1, true) + td('<span class="dbf-bar-mini" style="width:' + Math.max(4, t.readiness * 0.6) + 'px"></span> ' + t.readiness + '%', 1, true) + '</tr>';
        })) + '</div>';
        h += '<div class="dbf-grid2"><div class="dbf-card"><h4><i class="fas fa-user-friends"></i> Pickers <span class="n">' + m.pickers.length + '</span></h4>' + (m.pickers.length ? tbl([{ t: 'Picker' }, { t: 'Orders', num: 1 }, { t: 'Trips', num: 1 }, { t: 'Lines', num: 1 }, { t: 'Picked', num: 1 }, { t: 'Shipped', num: 1 }, { t: 'First assigned' }], m.pickers.map(function (p) { return '<tr>' + td(p.name) + td(p.orders, 1) + td(p.trips, 1) + td(p.lines, 1) + td(p.picked + ' · ' + p.pickedPct + '%', 1) + td(p.shipped, 1) + td(p.firstAssigned) + '</tr>'; })) : '<div style="color:#64748b">no picker assigned on the day</div>') + '</div>';
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
            '<button class="dbf-btn" id="dbf-build" ' + (st.busy ? 'disabled' : '') + ' title="Read the whole day again from APEX, Fusion and the WMS records"><i class="fas fa-sync-alt"></i> ' + (m ? 'Build again' : 'Build') + '</button><span class="dbf-step" id="dbf-step"></span><span class="dbf-sep"></span>' +
            '<button class="dbf-btn light" id="dbf-copy" ' + (m ? '' : 'disabled') + ' title="Copy the debrief as text for e-mail / Teams"><i class="fas fa-copy"></i> Copy text</button><button class="dbf-btn light" id="dbf-print" ' + (m ? '' : 'disabled') + '><i class="fas fa-print"></i> Print</button><button class="dbf-btn" id="dbf-pdf" ' + (m ? '' : 'disabled') + '><i class="fas fa-file-pdf"></i> PDF</button></div>' +
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
    }
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
        doc.save('day-debrief-' + m.pod + '-' + m.date + '.pdf');
        note('PDF saved.', 'success');
        return doc;
    }

    window.WmsDebrief = {
        open: open, close: close, show: showDate, build: rebuild, pdf: pdf, print: printView, copy: copyText,
        trip: function (tripId) { var m = current(), t = m && m.trips.filter(function (x) { return String(x.trip_id) === String(tripId); })[0]; if (typeof window.openTripDetails !== 'function') return; close(); if (typeof window.navigateToPage === 'function') window.navigateToPage('trip-management'); try { window.openTripDetails(String(tripId), m ? m.date : st.date, t ? t.lorry : '', st.pod, t ? t.bay : '', t ? t.priority : ''); } catch (e) { note('Could not open trip ' + tripId + ': ' + (e && e.message || e), 'error'); } },
        html: function () { var m = current(); return m ? printHtml(m) : ''; },
        state: function () { return { pod: st.pod, date: st.date, open: st.open, busy: st.busy, step: st.step, err: st.err, model: current(), db: DB.host }; }
    };
})();
