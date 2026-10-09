// ============================================================================
// PICK RELEASE (page) — release every order of the chosen trips of one date, in iterations, in the background
// ----------------------------------------------------------------------------
// WMS menu › Pick Release (data-page="pick-release"). One date (default tomorrow) + instance → Load trips reads
// GETTRIPDETAILS for the date and GETTRIPDETAILS/{trip} per trip (4 at a time), shows the trips as cards with a tick
// box each (lorry, bay, priority, orders, how many are released) and the orders in a grid. Start = the run:
//   · the SAME calls as the Trip Details › Pick Release dialog (wms/app.js), always "With lots" (the Mode control is shown
//     disabled — the No-lots call stays in the code, callNoLots, should it ever be wanted again):
//       With lots: POST trip/order/fetchfusionorderlines → trip/callpickwave → trips/getopenpicksbyorder → trip/getlotsforpicks
//       (a step whose answer says success:false / status error / error fails the order — the dialog only shows the answers)
//       No lots  : POST TRIPMANAGEMENT/trip/pickrelease/oneorder/{order}?P_TRIP_ID1={trip}&P_INSTANCE_NAME={pod}   (not offered)
//     "Orders at a time" = how many orders are sent to Fusion at once (1 = one after another, like the dialog); default 2.
//     Store to Van / Van to Store orders are skipped (the WMS allocates lots for them — Store Transactions).
//   · Iterations: the run goes over the orders again after a pause (default 1 minute): iteration 1 releases the chosen
//     orders, then the trips are read again (GETTRIPDETAILS/{trip} → released or not per order), pause, iteration 2 …
//     Later iterations take the orders that are still not released + the ones that failed (or every order again).
//   · It runs in the background: the promise chain lives in this script, so the user may open any other WMS page;
//     a floating chip (bottom right) shows the progress on every page and opens the Pick Release page; Stop ends it
//     after the order in hand.
// DuckDB (the WMS 2.0 file C:\fusion\wms2\wms2.duckdb through the host actions w2Status / w2Put / w2Query / w2Queries —
// shared by every WMS window on the PC, the host serialises the writes): tables of this page only (names must start w2_)
//   w2_pr_trips        pod × trip_date × trip: lorry, bay, priority, orders, released, read_at         (the trips of the date, as read)
//   w2_pr_trip_orders  pod × trip_date × trip × order: customer, type, lines, released Y/N, status …  (every order, as read)
//   w2_pr_runs         one row per run: trips, mode, iterations planned / done, pause, status RUNNING / WAITING / DONE /
//                      STOPPED / INTERRUPTED, counts, started / ended, heartbeat, next iteration time, PC, user
//   w2_pr_run_orders   run × order: result of the last try (OK / FAILED / SKIPPED), message, tries, iteration, released after
//   w2_pr_log          run × iteration × line: the run log
// On open the page draws the date from DuckDB first (trips, orders, the runs of the date, the last log); a RUNNING run
// whose heartbeat is older than 3 minutes (the window was closed) is marked INTERRUPTED. Without DuckDB (an exe built
// before WMS 2.0) everything still runs, only nothing is kept.
// ============================================================================
(function () {
    'use strict';
    var ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP';
    var WM = ORDS + '/WAREHOUSEMANAGEMENT', TM = ORDS + '/TRIPMANAGEMENT';
    var PAGE = 'pick-release';
    var S2V = /store to van|van to store|^s2v$/i;
    var PAUSES = [[30, '30 seconds'], [60, '1 minute'], [120, '2 minutes'], [180, '3 minutes'], [300, '5 minutes'], [600, '10 minutes']];

    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var lit = function (s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; };
    var pad2 = function (n) { return ('0' + n).slice(-2); };
    var ts = function (ms) { var d = new Date(ms || Date.now()); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); };
    var hm = function (s) { return s ? String(s).slice(11, 16) : ''; };
    var num = function (v) { var x = parseFloat(v); return isFinite(x) ? x : 0; };
    var yes = function (v) { return /^(Y|YES|TRUE|1|DONE|COMPLETE|COMPLETED|RELEASED|PRINTED|SUCCESS|OK)$/i.test(String(v == null ? '' : v).trim()); };
    function pick(row, names) {
        if (!row) return '';
        var keys = Object.keys(row);
        for (var i = 0; i < names.length; i++) {
            var k = keys.find(function (x) { return x.toLowerCase() === names[i].toLowerCase(); });
            if (k && row[k] != null && row[k] !== '') return row[k];
        }
        return '';
    }
    function user() { try { return localStorage.getItem('wms_user') || sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || 'WMS'; } catch (e) { return 'WMS'; } }
    function pcName() { try { return localStorage.getItem('wms_pc') || (navigator.userAgentData && navigator.userAgentData.platform) || 'PC'; } catch (e) { return 'PC'; } }
    function note(m, t) { if (typeof showNotification === 'function') showNotification(m, t || 'info'); else console.log('[Pick Release]', m); }
    function ls(k, v) { try { if (v === undefined) { var s = localStorage.getItem(k); return s == null ? null : JSON.parse(s); } localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } return v; }
    function tomorrow() { var d = new Date(); d.setDate(d.getDate() + 1); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function ddmmyyyy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : String(iso || ''); }
    function dayName(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); if (!m) return '';
        var d = new Date(+m[1], +m[2] - 1, +m[3]), t = new Date(); t.setHours(0, 0, 0, 0);
        var diff = Math.round((d - t) / 86400000);
        return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
    }
    function dur(ms) { var s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + pad2(s % 60) + ' s'; }
    function mmss(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + pad2(s % 60); }
    function orderOf(r) { return String(pick(r, ['ORDER_NUMBER', 'order_number', 'SOURCE_ORDER_NUMBER', 'source_order_number']) || '').trim(); }
    /** Released = what the Trip Details summary counts as released (PICK_RELEASE_STATUS, picks / lots, pick slip, release date, or a later stage). */
    function isReleased(r) {
        var st = String(pick(r, ['LINE_STATUS', 'line_status', 'STATUS']) || '');
        return yes(pick(r, ['PICK_CONFIRM_ST', 'pick_confirm_st'])) || yes(pick(r, ['SHIP_CONFIRM_ST', 'ship_confirm_st'])) || /closed|interfac|billing|billed|invoic|shipped/i.test(st) ||
            yes(pick(r, ['PICK_RELEASE_STATUS', 'pick_release_status'])) || num(pick(r, ['picks_count', 'PICKS_COUNT'])) > 0 || num(pick(r, ['lot_count', 'LOT_COUNT'])) > 0 ||
            !!pick(r, ['PICK_SLIP_NO', 'pick_slip_no', 'RELEASE_DATE', 'release_date']);
    }
    function isCancelled(r) { return /^cancel/i.test(String(pick(r, ['LINE_STATUS', 'line_status', 'STATUS']) || '')); }

    // ─── host IO ───────────────────────────────────────────────────────────────
    function host(msg, ms) {
        return new Promise(function (resolve, reject) {
            if (!(window.chrome && window.chrome.webview) || typeof sendMessageToCSharp !== 'function') { reject(new Error('Open this page inside the Gray\'s WMS app.')); return; }
            sendMessageToCSharp(msg, function (err, data) {
                if (err) { reject(new Error(typeof err === 'string' ? err : (err.message || JSON.stringify(err)))); return; }
                var r = data; if (typeof data === 'string') { try { r = JSON.parse(data); } catch (e) { r = data; } }
                resolve(r);
            }, ms || 120000, false);          // never the full-page "Processing" overlay: the run is in the background
        });
    }
    function get(url) { return host({ action: 'executeGet', fullUrl: url }, 120000); }
    function post(url, body, ms) { return host({ action: 'executePost', fullUrl: url, body: typeof body === 'string' ? body : JSON.stringify(body || {}) }, ms || 180000); }
    function items(r) { return Array.isArray(r) ? r : (r && Array.isArray(r.items)) ? r.items : []; }

    /** DuckDB through the WMS 2.0 host actions; a busy answer (another WMS window writes) is asked again 3 times. */
    var DB = {
        host: null, probing: null, io: Promise.resolve(),
        call: function (action, payload, ms, attempt) {
            return host(Object.assign({ action: action, appUser: user() }, payload || {}), ms || 120000).then(function (d) {
                var busy = d && d.ok === false && (d.busy || /another .*window|busy/i.test(String(d.error || '')));
                if (busy && (attempt || 0) < 3) return new Promise(function (r) { setTimeout(r, 1500 + 1500 * (attempt || 0)); }).then(function () { return DB.call(action, payload, ms, (attempt || 0) + 1); });
                return d;
            });
        },
        probe: function () {
            if (DB.probing) return DB.probing;
            DB.probing = DB.call('w2Status', {}, 15000).then(function (d) { DB.host = !!(d && d.ok !== false); DB.error = DB.host ? '' : ((d && d.error) || 'DuckDB did not answer'); return DB.host; },
                function (e) { DB.host = false; DB.error = /timed out/i.test(String(e && e.message)) ? 'this build has no WMS 2.0 DuckDB actions (rebuild the app)' : String(e && e.message || e); return false; });
            return DB.probing;
        },
        on: function () { return DB.host === true; },
        rowsOf: function (d) { var cols = (d.columns || []).map(function (c) { return String(c).toLowerCase(); }); return (d.rows || []).map(function (r) { var o = {}; cols.forEach(function (c, i) { o[c] = r[i]; }); return o; }); },
        q: function (sql) { return DB.call('w2Query', { sql: sql, maxRows: 100000 }).then(function (d) { if (!d || d.ok === false) throw new Error((d && d.error) || 'query failed'); return DB.rowsOf(d); }); },
        /** Several reads in one open of the file; a failing one (the table does not exist yet) gives []. */
        qs: function (list) {
            return DB.call('w2Queries', { queries: list }).then(function (d) {
                return ((d && d.results) || []).map(function (r) { if (!r || r.error) return []; return DB.rowsOf(r); });
            });
        },
        put: function (table, scope, rows) {
            return DB.call('w2Put', { table: table, scope: scope, rows: rows || [], replaceAll: false, columns: COLS[table] || [] }, 300000)
                .then(function (d) { if (!d || d.ok === false) throw new Error((d && d.error) || 'save failed'); return d; });
        },
        /** Writes one after another, never two at once from this page. */
        serial: function (fn) { var p = DB.io.then(fn, fn); DB.io = p.catch(function (e) { console.warn('[Pick Release] DuckDB write failed:', e && e.message || e); }); return p; }
    };
    var COLS = {
        w2_pr_trips: ['pod', 'trip_date', 'trip_id', 'lorry', 'loading_bay', 'priority', 'orders', 'released', 'not_released', 's2v', 'cancelled', 'read_at'],
        w2_pr_trip_orders: ['pod', 'trip_date', 'trip_id', 'order_number', 'account_name', 'order_type', 'line_status', 'lines', 'picker', 'released', 'cancelled', 's2v', 'read_at', 'raw_json'],
        w2_pr_runs: ['run_id', 'pod', 'trip_date', 'trips', 'trip_count', 'orders_total', 'scope', 'later', 'mode', 'warehouse', 'parallel', 'iterations', 'iteration', 'pause_s',
            'status', 'ok_count', 'failed_count', 'skipped_count', 'released_count', 'started_at', 'ended_at', 'hb', 'next_at', 'pc', 'by_user', 'message'],
        w2_pr_run_orders: ['run_id', 'pod', 'trip_date', 'trip_id', 'order_number', 'account_name', 'order_type', 'lines', 'released_before', 'result', 'message', 'tries', 'iteration', 'last_ts', 'ms', 'released_after'],
        w2_pr_log: ['run_id', 'iteration', 'n', 'ts', 'level', 'text']
    };

    // ─── state ─────────────────────────────────────────────────────────────────
    var st = {
        pod: null, date: null,
        trips: [],                // [{trip_id, lorry, bay, priority, orders:[row], released, notReleased, s2v, cancelled, read_at}]
        orders: {},               // trip_id → [order rows (GETTRIPDETAILS/{trip})]
        selected: {},             // trip_id → true
        source: '',               // 'apex' | 'duckdb' | ''
        loading: false,
        runs: [],                 // runs of the date (DuckDB)
        view: null,               // a run shown in the grid when no run is live
        viewOrders: [], viewLog: [],
        grep: '',
        tab: 'orders'             // 'orders' | 'log' | 'runs'
    };
    var SET = Object.assign({ mode: 'lots', wh: 'GIC', par: 2, iter: 2, pause: 60, scope: 'notreleased', later: 'left' }, ls('wms.pr.set') || {});
    SET.mode = 'lots';          // always with lots (the Mode control is disabled)
    var R = { run: null };        // the live run (one at a time per page)

    // ─── reads ─────────────────────────────────────────────────────────────────
    function tripsOfDate(pod, date) {
        var p = new URLSearchParams({ P_DATE_FROM: ddmmyyyy(date), P_DATE_TO: ddmmyyyy(date), P_INSTANCE_NAME: pod });
        return get(WM + '/GETTRIPDETAILS?' + p.toString()).then(function (r) {
            var map = {}, list = [];
            items(r).forEach(function (t) {
                var id = String(pick(t, ['TRIP_ID', 'trip_id']) || '').trim(); if (!id) return;
                if (!map[id]) { map[id] = { trip_id: id, lorry: pick(t, ['TRIP_LORRY', 'trip_lorry', 'LORRY_NUMBER', 'lorry_number']) || '', bay: pick(t, ['TRIP_LOADING_BAY', 'trip_loading_bay', 'LOADING_BAY', 'loading_bay']) || '',
                    priority: pick(t, ['TRIP_PRIORITY', 'trip_priority', 'PRIORITY', 'priority']) || '', count: num(pick(t, ['order_count', 'ORDER_COUNT'])), rows: 0 }; list.push(map[id]); }
                map[id].rows++;
            });
            list.forEach(function (t) { if (!t.count) t.count = t.rows; });
            return list.sort(function (a, b) { return num(a.trip_id) - num(b.trip_id); });
        });
    }
    function ordersOfTrip(pod, tripId) {
        return get(WM + '/GETTRIPDETAILS/' + encodeURIComponent(tripId) + '?P_INSTANCE_NAME=' + encodeURIComponent(pod)).then(function (r) { return items(r).filter(orderOf); });
    }
    function decorate(t, rows) {
        t.orders = rows; t.released = 0; t.notReleased = 0; t.s2v = 0; t.cancelled = 0;
        rows.forEach(function (r) {
            r.__o = orderOf(r); r.__rel = isReleased(r); r.__can = isCancelled(r); r.__s2v = S2V.test(String(pick(r, ['ORDER_TYPE', 'order_type', 'ORDER_TYPE_CODE']) || '').trim());
            if (r.__can) t.cancelled++; else if (r.__s2v) t.s2v++; else if (r.__rel) t.released++; else t.notReleased++;
        });
        t.count = rows.length;
    }
    /** n at a time; a failing item never stops the others. */
    function pool(list, n, fn, stop) {
        var i = 0;
        var next = function () {
            if (i >= list.length || (stop && stop())) return Promise.resolve();
            var idx = i++;
            return Promise.resolve().then(function () { return fn(list[idx], idx); }).catch(function (e) { console.warn('[Pick Release] pooled call failed:', e && e.message || e); }).then(next);
        };
        var w = []; for (var k = 0; k < Math.min(n, list.length); k++) w.push(next());
        return Promise.all(w);
    }

    /** Load trips: APEX → state → DuckDB. */
    function load() {
        if (st.loading) return Promise.resolve();
        var pod = st.pod, date = st.date, t0 = Date.now();
        st.loading = true; st.error = ''; paint();
        return tripsOfDate(pod, date).then(function (list) {
            return pool(list, 4, function (t) {
                return ordersOfTrip(pod, t.trip_id).then(function (rows) { decorate(t, rows); }, function (e) { t.error = String(e && e.message || e); decorate(t, []); });
            }).then(function () { return list; });
        }).then(function (list) {
            if (st.pod !== pod || st.date !== date) return;      // the user moved on
            var at = ts();
            list.forEach(function (t) { t.read_at = at; });
            st.trips = list; st.source = 'apex'; st.loading = false; st.readAt = at;
            var keep = {}; list.forEach(function (t) { if (st.selected[t.trip_id]) keep[t.trip_id] = true; }); st.selected = keep;
            paint();
            note(list.length + ' trip(s) of ' + dayName(date) + ' read in ' + dur(Date.now() - t0), 'success');
            if (!DB.on()) return;
            DB.serial(function () {
                var trips = list.map(function (t) { return { pod: pod, trip_date: date, trip_id: t.trip_id, lorry: t.lorry, loading_bay: t.bay, priority: t.priority, orders: String(t.count), released: String(t.released), not_released: String(t.notReleased), s2v: String(t.s2v), cancelled: String(t.cancelled), read_at: at }; });
                var ords = [];
                list.forEach(function (t) { t.orders.forEach(function (r) { ords.push(orderRow(pod, date, t.trip_id, r, at)); }); });
                return DB.put('w2_pr_trips', { pod: pod, trip_date: date }, trips).then(function () { return DB.put('w2_pr_trip_orders', { pod: pod, trip_date: date }, ords); });
            });
        }, function (e) {
            st.loading = false; st.error = String(e && e.message || e); paint();
            note('Trips not read: ' + st.error, 'error');
        });
    }
    function orderRow(pod, date, tripId, r, at) {
        return { pod: pod, trip_date: date, trip_id: String(tripId), order_number: r.__o, account_name: pick(r, ['ACCOUNT_NAME', 'account_name', 'CUSTOMER_NAME', 'customer_name']) || '',
            order_type: pick(r, ['ORDER_TYPE', 'order_type', 'ORDER_TYPE_CODE']) || '', line_status: pick(r, ['LINE_STATUS', 'line_status', 'STATUS']) || '',
            lines: String(num(pick(r, ['order_lines', 'ORDER_LINES', 'line_count', 'LINE_COUNT', 'TOTAL_LINES']))), picker: pick(r, ['picker', 'PICKER', 'PICKER_NAME', 'picker_name']) || '',
            released: r.__rel ? 'Y' : 'N', cancelled: r.__can ? 'Y' : 'N', s2v: r.__s2v ? 'Y' : 'N', read_at: at, raw_json: JSON.stringify(r).slice(0, 8000) };
    }
    /** The date from DuckDB: trips, their orders, the runs of the date. */
    function loadDb() {
        var pod = st.pod, date = st.date;
        var w = ' WHERE pod = ' + lit(pod) + ' AND trip_date = ' + lit(date);
        return DB.qs(['SELECT * FROM w2_pr_trips' + w + ' ORDER BY CAST(trip_id AS BIGINT)', 'SELECT * FROM w2_pr_trip_orders' + w, 'SELECT * FROM w2_pr_runs' + w + ' ORDER BY started_at DESC LIMIT 50']).then(function (r) {
            if (st.pod !== pod || st.date !== date) return;
            var byTrip = {}; r[1].forEach(function (o) { (byTrip[o.trip_id] = byTrip[o.trip_id] || []).push(o); });
            if (r[0].length) {
                st.trips = r[0].map(function (t) {
                    var rows = (byTrip[t.trip_id] || []).map(function (o) { var raw = {}; try { raw = JSON.parse(o.raw_json || '{}'); } catch (e) { raw = {}; } raw.__o = o.order_number; raw.__rel = o.released === 'Y'; raw.__can = o.cancelled === 'Y'; raw.__s2v = o.s2v === 'Y'; return raw; });
                    var x = { trip_id: t.trip_id, lorry: t.lorry || '', bay: t.loading_bay || '', priority: t.priority || '', read_at: t.read_at };
                    x.orders = rows; x.released = 0; x.notReleased = 0; x.s2v = 0; x.cancelled = 0;
                    rows.forEach(function (o) { if (o.__can) x.cancelled++; else if (o.__s2v) x.s2v++; else if (o.__rel) x.released++; else x.notReleased++; });
                    x.count = rows.length || num(t.orders);
                    return x;
                });
                st.source = 'duckdb'; st.readAt = r[0][0].read_at;
            }
            st.runs = r[2];
            // a run that says RUNNING / WAITING but whose window is gone (heartbeat older than 3 minutes) is INTERRUPTED
            var stale = st.runs.filter(function (x) { return /^(RUNNING|WAITING)$/.test(x.status) && !(R.run && R.run.id === x.run_id) && Date.now() - new Date(String(x.hb || x.started_at).replace(' ', 'T')).getTime() > 180000; });
            stale.forEach(function (x) { x.status = 'INTERRUPTED'; x.ended_at = x.hb || ts(); x.message = 'The WMS window closed before the run finished'; });
            if (stale.length) DB.serial(function () { return Promise.all(stale.map(function (x) { return DB.put('w2_pr_runs', { run_id: x.run_id }, [x]); })); });
            if (!R.run && !st.view && st.runs.length) viewRun(st.runs[0].run_id, true);
            paint();
        }).catch(function (e) { console.warn('[Pick Release] DuckDB read failed:', e && e.message || e); });
    }
    function viewRun(runId, quiet) {
        var run = st.runs.filter(function (x) { return x.run_id === runId; })[0]; if (!run) return Promise.resolve();
        st.view = run; st.viewOrders = []; st.viewLog = [];
        if (!DB.on()) { if (R.last && R.last.id === runId) { st.viewOrders = runOrderRows(R.last); st.viewLog = R.last.log.slice(); } paint(); return Promise.resolve(); }
        return DB.qs(['SELECT * FROM w2_pr_run_orders WHERE run_id = ' + lit(runId) + ' ORDER BY CAST(trip_id AS BIGINT), order_number', 'SELECT * FROM w2_pr_log WHERE run_id = ' + lit(runId) + ' ORDER BY CAST(n AS BIGINT) DESC LIMIT 400']).then(function (r) {
            if (!st.view || st.view.run_id !== runId) return;
            st.viewOrders = r[0]; st.viewLog = r[1];
            if (!quiet) st.tab = 'orders';
            paint();
        }).catch(function (e) { console.warn('[Pick Release] run not read:', e && e.message || e); });
    }

    // ─── the run ───────────────────────────────────────────────────────────────
    function okOf(res) {
        if (!res || typeof res !== 'object') return { ok: true, msg: 'completed' };
        if (res.success === true || res.success === 'true' || res.status === 'success') return { ok: true, msg: res.message || 'released' };
        return { ok: res.success !== false && res.status !== 'error', msg: res.message || res.error || JSON.stringify(res).slice(0, 200) };
    }
    function callNoLots(pod, tripId, order) {
        return post(TM + '/trip/pickrelease/oneorder/' + encodeURIComponent(order) + '?P_TRIP_ID1=' + encodeURIComponent(tripId) + '&P_INSTANCE_NAME=' + encodeURIComponent(pod), '{}', 180000).then(okOf);
    }
    /** An answer that says it failed (success false / status error / an error text) ends the order as FAILED with that text. */
    function failed(r, step) {
        if (!r || typeof r !== 'object') return null;
        if (r.success === false || r.status === 'error' || r.status === 'ERROR' || (r.error && !r.items)) return step + ': ' + String(r.message || r.error || JSON.stringify(r).slice(0, 200));
        return null;
    }
    function callWithLots(pod, tripId, order, wh) {
        var on = encodeURIComponent(order), steps = [];
        var check = function (step) { return function (r) { var f = failed(r, step); if (f) throw new Error(f); return r; }; };
        return post(TM + '/trip/order/fetchfusionorderlines?P_INSTANCE_NAME=' + pod + '&p_order_number=' + on + '&p_trip_id=' + encodeURIComponent(tripId), {}, 120000).then(check('order lines'))
            .then(function (r) { steps.push((r && (r.RECORDCOUNT || r.recordcount || r.count)) || 0); return post(TM + '/trip/callpickwave?warehouse=' + encodeURIComponent(wh) + '&order_number=' + on + '&p_instance_name=' + pod, {}, 180000); }).then(check('pick wave'))
            .then(function () { return post(TM + '/trips/getopenpicksbyorder?organization_code=' + encodeURIComponent(wh) + '&order_number=' + on + '&p_instance_name=' + pod, {}, 120000); }).then(check('open picks'))
            .then(function (r) { steps.push(items(r).length || (r && r.count) || 0); return post(TM + '/trip/getlotsforpicks?source_order_number=' + on + '&p_instance_name=' + pod, {}, 120000); }).then(check('lots'))
            .then(function (r) { steps.push(items(r).length || (r && r.count) || 0); return { ok: true, msg: 'wave released · ' + steps[0] + ' line(s) · ' + steps[1] + ' pick(s) · ' + steps[2] + ' lot row(s)' }; });
    }

    function start() {
        if (R.run) { note('A run is already going. Stop it first.', 'warning'); return; }
        var trips = st.trips.filter(function (t) { return st.selected[t.trip_id]; });
        if (!trips.length) { note('Tick the trips to pick release.', 'warning'); return; }
        var list = [];
        trips.forEach(function (t) { t.orders.forEach(function (r) {
            if (r.__can) return;
            if (SET.scope === 'notreleased' && r.__rel && !r.__s2v) return;
            list.push({ trip_id: t.trip_id, order: r.__o, row: r, s2v: r.__s2v, account: pick(r, ['ACCOUNT_NAME', 'account_name', 'CUSTOMER_NAME', 'customer_name']) || '', type: pick(r, ['ORDER_TYPE', 'order_type', 'ORDER_TYPE_CODE']) || '',
                lines: num(pick(r, ['order_lines', 'ORDER_LINES', 'line_count', 'LINE_COUNT', 'TOTAL_LINES'])), relBefore: r.__rel, result: '', msg: '', tries: 0, iter: 0, lastTs: '', ms: 0, relAfter: '' });
        }); });
        var toRun = list.filter(function (o) { return !o.s2v; });
        if (!toRun.length) { note(SET.scope === 'notreleased' ? 'Every order of the ticked trips is released already — choose "Every order" to release them again.' : 'No order to release on the ticked trips.', 'warning'); return; }
        var pause = SET.pause >= 2 && SET.pause <= 3600 ? SET.pause : 60;      // seconds (the select's values; a test may add its own)
        var what = toRun.length + ' order(s) on ' + trips.length + ' trip(s) of ' + dayName(st.date) + ' (' + st.pod + '), ' + (SET.mode === 'lots' ? 'with lots (warehouse ' + SET.wh + ')' : 'no lots') + ', ' + SET.par + ' order(s) at a time, ' +
            SET.iter + ' iteration(s)' + (SET.iter > 1 ? ' with ' + pauseLabel(pause) + ' between them (' + (SET.later === 'all' ? 'every order again' : 'orders still not released + failed') + ')' : '') + (list.length > toRun.length ? '; ' + (list.length - toRun.length) + ' Store to Van order(s) skipped' : '') + '.';
        if (!confirm('Pick release ' + what + '\n\nThe run goes on in the background — you may open any other page. Start?')) return;
        var run = R.run = { id: 'PR' + Date.now().toString(36).toUpperCase(), pod: st.pod, date: st.date, trips: trips.map(function (t) { return t.trip_id; }), orders: list, mode: SET.mode, wh: SET.wh, par: SET.par, iters: SET.iter, iter: 0, pause: pause,
            scope: SET.scope, later: SET.later, status: 'RUNNING', started: Date.now(), ended: 0, nextAt: 0, stopping: false, skipWait: null, log: [], n: 0, done: 0, total: toRun.length, phase: '' };
        list.forEach(function (o) { if (o.s2v) { o.result = 'SKIPPED'; o.msg = 'Store to Van / Van to Store: the WMS allocates lots for these (Store Transactions)'; } else o.result = 'PENDING'; });
        say(run, 'dim', 'Run ' + run.id + ': ' + what);
        st.view = null; st.tab = 'orders';
        saveRun(run);
        paint();
        var chain = Promise.resolve();
        for (var i = 1; i <= run.iters; i++) chain = chain.then(iteration.bind(null, run, i));
        chain.then(function () { finish(run, run.stopping ? 'STOPPED' : 'DONE'); }, function (e) { say(run, 'err', 'The run stopped: ' + (e && e.message || e)); finish(run, 'STOPPED'); });
        tick();
    }
    function pauseLabel(s) { var p = PAUSES.filter(function (x) { return x[0] === s; })[0]; return p ? p[1] : s + ' s'; }
    function targets(run, iter) {
        return run.orders.filter(function (o) {
            if (o.s2v) return false;
            if (iter === 1 || run.later === 'all') return true;
            return o.result === 'FAILED' || o.relAfter !== 'Y';            // still not released, or the last try failed
        });
    }
    function iteration(run, iter) {
        if (run.stopping) return Promise.resolve();
        var list = targets(run, iter);
        if (iter > 1 && !list.length) { say(run, 'ok', 'Iteration ' + iter + ': every order is released — nothing left to do'); run.iter = iter; return Promise.resolve(); }
        var wait = iter > 1 ? pause(run, iter) : Promise.resolve();
        return wait.then(function () {
            if (run.stopping) return;
            run.iter = iter; run.status = 'RUNNING'; run.done = 0; run.total = list.length; run.phase = 'releasing';
            say(run, 'dim', 'Iteration ' + iter + ' of ' + run.iters + ': ' + list.length + ' order(s)');
            list.forEach(function (o) { o.result = 'RUNNING'; o.msg = ''; });
            saveRun(run); paint();
            return pool(list, run.par, function (o) {
                var s0 = Date.now();
                return (run.mode === 'lots' ? callWithLots(run.pod, o.trip_id, o.order, run.wh) : callNoLots(run.pod, o.trip_id, o.order)).catch(function (e) { return { ok: false, msg: String(e && e.message || e) }; }).then(function (res) {
                    o.result = res.ok ? 'OK' : 'FAILED'; o.msg = String(res.msg || '').slice(0, 400); o.tries++; o.iter = iter; o.lastTs = ts(); o.ms = Date.now() - s0;
                    run.done++; run.hb = Date.now();
                    say(run, res.ok ? 'ok' : 'err', o.trip_id + ' · ' + o.order + ': ' + o.msg);
                    if (run.done % 5 === 0) saveRun(run);
                    paint();
                });
            }, function () { return run.stopping; }).then(function () {
                list.forEach(function (o) { if (o.result === 'RUNNING') { o.result = 'PENDING'; o.msg = 'not reached (stopped)'; } });
                return readBack(run, iter);
            }).then(function () { saveRun(run); paint(); });
        });
    }
    /** The pause before an iteration: a countdown, Skip the wait, Stop. */
    function pause(run, iter) {
        run.status = 'WAITING'; run.phase = 'waiting'; run.nextAt = Date.now() + run.pause * 1000;
        say(run, 'dim', 'Waiting ' + pauseLabel(run.pause) + ' before iteration ' + iter + ' (' + hm(ts(run.nextAt)) + ')');
        saveRun(run); paint();
        return new Promise(function (resolve) {
            var t = setInterval(function () {
                run.hb = Date.now();
                if (run.stopping || Date.now() >= run.nextAt) { clearInterval(t); run.skipWait = null; run.nextAt = 0; resolve(); }
            }, 500);
            run.skipWait = function () { run.nextAt = Date.now(); };
        });
    }
    /** After an iteration: the trips are read again → released or not per order (and the trips cache follows). */
    function readBack(run, iter) {
        run.phase = 'reading'; paint();
        var at = ts(), rel = 0;
        return pool(run.trips, 4, function (tripId) {
            return ordersOfTrip(run.pod, tripId).then(function (rows) {
                var byO = {}; rows.forEach(function (r) { byO[orderOf(r)] = r; });
                run.orders.forEach(function (o) { if (o.trip_id !== tripId || o.s2v) return; var r = byO[o.order]; if (r) { o.relAfter = isReleased(r) ? 'Y' : 'N'; o.row = r; } });
                var t = st.trips.filter(function (x) { return x.trip_id === tripId; })[0];
                if (t && st.pod === run.pod && st.date === run.date) { decorate(t, rows); t.read_at = at; }
                if (DB.on() && st.pod === run.pod && st.date === run.date) DB.serial(function () { return DB.put('w2_pr_trip_orders', { pod: run.pod, trip_date: run.date, trip_id: tripId }, rows.map(function (r) { return orderRow(run.pod, run.date, tripId, r, at); })).then(function () {
                    return t ? DB.put('w2_pr_trips', { pod: run.pod, trip_date: run.date, trip_id: tripId }, [{ pod: run.pod, trip_date: run.date, trip_id: tripId, lorry: t.lorry, loading_bay: t.bay, priority: t.priority, orders: String(t.count), released: String(t.released), not_released: String(t.notReleased), s2v: String(t.s2v), cancelled: String(t.cancelled), read_at: at }]) : null; }); });
            }, function (e) { say(run, 'warn', 'Trip ' + tripId + ' not read back: ' + (e && e.message || e)); });
        }).then(function () {
            run.orders.forEach(function (o) { if (o.relAfter === 'Y') rel++; });
            var left = run.orders.filter(function (o) { return !o.s2v && o.relAfter !== 'Y'; }).length;
            say(run, left ? 'warn' : 'ok', 'Iteration ' + iter + ' done: ' + rel + ' released, ' + left + ' still not released' + (counts(run).failed ? ', ' + counts(run).failed + ' failed call(s)' : ''));
            run.phase = '';
        });
    }
    function counts(run) {
        var c = { ok: 0, failed: 0, skipped: 0, released: 0, pending: 0 };
        run.orders.forEach(function (o) { if (o.result === 'OK') c.ok++; else if (o.result === 'FAILED') c.failed++; else if (o.result === 'SKIPPED') c.skipped++; else c.pending++; if (o.relAfter === 'Y') c.released++; });
        return c;
    }
    function finish(run, status) {
        run.status = status; run.ended = Date.now(); run.phase = ''; run.nextAt = 0;
        var c = counts(run);
        var msg = 'Pick release ' + (status === 'DONE' ? 'done' : 'stopped') + ': ' + run.iter + ' of ' + run.iters + ' iteration(s), ' + c.released + ' of ' + run.orders.filter(function (o) { return !o.s2v; }).length + ' order(s) released, ' + c.failed + ' failed in ' + dur(run.ended - run.started);
        run.message = msg;
        say(run, c.failed || status !== 'DONE' ? 'warn' : 'ok', msg);
        saveRun(run);
        note(msg, c.failed ? 'warning' : 'success');
        host({ action: 'aiAudit', source: 'WMS', actionKey: 'pick_release_page', outcome: status !== 'DONE' ? 'STOPPED' : c.failed ? 'PARTIAL' : 'OK', instance: run.pod, refId: 'DATE:' + run.date, target: run.trips.length + ' trip(s), ' + run.orders.length + ' order(s)', detail: msg }, 15000).catch(function () {});
        R.run = null; R.last = run;
        if (st.pod === run.pod && st.date === run.date) DB.io.then(function () { return loadDb(); }).then(function () { return viewRun(run.id, true); }).catch(function () {});
        paint();
    }
    function stop() { if (!R.run) return; R.run.stopping = true; say(R.run, 'warn', 'Stop pressed — the order in hand finishes, nothing more is sent'); paint(); }
    function say(run, level, text) {
        run.n++; run.log.unshift({ n: run.n, iter: run.iter, ts: ts(), level: level, text: text });
        if (run.log.length > 400) run.log.length = 400;
    }
    function runRow(run) {
        var c = counts(run);
        return { run_id: run.id, pod: run.pod, trip_date: run.date, trips: run.trips.join(','), trip_count: String(run.trips.length), orders_total: String(run.orders.filter(function (o) { return !o.s2v; }).length), scope: run.scope, later: run.later,
            mode: run.mode, warehouse: run.wh, parallel: String(run.par), iterations: String(run.iters), iteration: String(run.iter), pause_s: String(run.pause), status: run.status, ok_count: String(c.ok), failed_count: String(c.failed),
            skipped_count: String(c.skipped), released_count: String(c.released), started_at: ts(run.started), ended_at: run.ended ? ts(run.ended) : '', hb: ts(), next_at: run.nextAt ? ts(run.nextAt) : '', pc: pcName(), by_user: user(), message: run.message || '' };
    }
    function saveRun(run) {
        run.lastSave = Date.now();
        var row = runRow(run), i = st.runs.findIndex(function (x) { return x.run_id === run.id; });
        if (i >= 0) st.runs[i] = row; else st.runs.unshift(row);         // the Runs tab follows the live run (also without DuckDB, for this session)
        if (!DB.on()) return;
        DB.serial(function () {
            var rows = run.orders.map(function (o) { return { run_id: run.id, pod: run.pod, trip_date: run.date, trip_id: o.trip_id, order_number: o.order, account_name: o.account, order_type: o.type, lines: String(o.lines), released_before: o.relBefore ? 'Y' : 'N',
                result: o.result, message: o.msg, tries: String(o.tries), iteration: String(o.iter), last_ts: o.lastTs, ms: String(o.ms), released_after: o.relAfter }; });
            var log = run.log.map(function (l) { return { run_id: run.id, iteration: String(l.iter), n: String(l.n), ts: l.ts, level: l.level, text: l.text }; });
            return DB.put('w2_pr_runs', { run_id: run.id }, [row]).then(function () { return DB.put('w2_pr_run_orders', { run_id: run.id }, rows); }).then(function () { return DB.put('w2_pr_log', { run_id: run.id }, log); });
        });
    }
    var ticking = null;
    function tick() {
        if (ticking) return;
        ticking = setInterval(function () {
            if (!R.run) { clearInterval(ticking); ticking = null; paintBar(); paintFloat(); return; }
            if (Date.now() - (R.run.lastSave || 0) > 60000) saveRun(R.run);       // heartbeat: a run whose hb is 3 min old was cut off by a closed window
            paintBar(); paintFloat();
        }, 1000);
    }

    // ─── page ──────────────────────────────────────────────────────────────────
    function root() { return document.getElementById(PAGE); }
    function visible() { var r = root(); return !!(r && r.style.display !== 'none' && r.offsetParent !== null); }
    function shell() {
        var r = root(); if (!r || r.querySelector('.pr')) return;
        r.innerHTML = '<div class="pr">' +
            '<div class="pr-head"><div><h2><i class="fas fa-dolly"></i> Pick Release</h2><div class="pr-sub">Release every order of the ticked trips — the same calls as Trip Details › Pick Release — in iterations, in the background.</div></div>' +
            '<span class="grow"></span><span class="pr-db" id="pr-db" title="The trips, orders and runs of this page are kept in the WMS 2.0 DuckDB file, shared by every WMS window on this PC"></span></div>' +
            '<div class="pr-card pr-bar-card"><div class="pr-row">' +
            '<label>Instance <select id="pr-pod"><option>PROD</option><option>TEST</option><option>DEV</option></select></label>' +
            '<label>Trip date <input type="date" id="pr-date"></label>' +
            '<button class="pr-btn" id="pr-prev" title="The day before">‹</button><button class="pr-btn" id="pr-next" title="The day after">›</button>' +
            '<button class="pr-btn" id="pr-today">Today</button><button class="pr-btn" id="pr-tomorrow">Tomorrow</button>' +
            '<button class="pr-btn primary" id="pr-load"><i class="fas fa-sync-alt"></i> Load trips</button>' +
            '<span class="pr-src" id="pr-src"></span></div></div>' +
            '<div class="pr-card"><div class="pr-row pr-trips-head"><h3>Trips <span class="pr-day" id="pr-day"></span></h3>' +
            '<button class="pr-btn sm" id="pr-all">Tick all</button><button class="pr-btn sm" id="pr-notrel">Tick trips with orders not released</button><button class="pr-btn sm" id="pr-none">Untick all</button>' +
            '<span class="grow"></span><span class="pr-count" id="pr-tcount"></span></div><div class="pr-trips" id="pr-trips"></div></div>' +
            '<div class="pr-card"><div class="pr-row pr-opts">' +
            '<label title="Always with lots: order lines → pick wave → open picks → lots, like Trip Details › Pick Release › With lots">Mode <select id="pr-mode" disabled><option value="lots">With lots — wave, picks, lots</option></select></label>' +
            '<label id="pr-wh-l" title="The warehouse (inventory organisation) of the pick wave">Warehouse <input id="pr-wh" style="width:70px"></label>' +
            '<label>Orders <select id="pr-scope"><option value="notreleased">Not released yet</option><option value="all">Every order on the trip</option></select></label>' +
            '<label title="How many orders are sent to Fusion at the same time: 1 = one order after another (like the dialog), 2 = two orders run side by side, and so on">Orders at a time <select id="pr-par"><option>1</option><option>2</option><option>3</option><option>4</option></select></label>' +
            '<label>Iterations <select id="pr-iter">' + [1, 2, 3, 4, 5, 6, 8, 10].map(function (n) { return '<option>' + n + '</option>'; }).join('') + '</select></label>' +
            '<label>Pause between iterations <select id="pr-pause">' + PAUSES.map(function (p) { return '<option value="' + p[0] + '">' + p[1] + '</option>'; }).join('') + '</select></label>' +
            '<label>Later iterations <select id="pr-later"><option value="left">Orders still not released + failed</option><option value="all">Every order again</option></select></label>' +
            '<span class="grow"></span><button class="pr-btn primary big" id="pr-go"><i class="fas fa-play"></i> Pick release <span id="pr-gon">0</span> order(s)</button></div>' +
            '<div class="pr-hint"><b>Orders at a time</b> = how many orders are sent to Fusion at once (1 = one after another, 2 = two side by side). <b>Iterations</b>: iteration 1 releases the chosen orders (order lines → pick wave → open picks → lots, per order); the trips are then read again (released or not, per order), the run waits the pause and iteration 2 releases what is left, and so on. Store to Van / Van to Store orders are skipped — the WMS allocates lots for them. The run goes on in the background: a chip at the bottom right follows it on every page.</div></div>' +
            '<div class="pr-card pr-status" id="pr-status"></div>' +
            '<div class="pr-card"><div class="pr-tabs"><button data-t="orders" class="on">Orders</button><button data-t="log">Run log</button><button data-t="runs">Runs of the day</button>' +
            '<span class="grow"></span><span class="pr-grep-box"><i class="fas fa-search"></i><input id="pr-grep" placeholder="Filter the rows shown — any column"><button id="pr-grep-x" title="Clear">✕</button><span id="pr-grep-n"></span></span>' +
            '<button class="pr-btn sm" id="pr-csv" title="Download the rows shown as CSV"><i class="fas fa-file-csv"></i> CSV</button></div><div id="pr-body"></div></div></div>';
        wire(r);
    }
    function wire(r) {
        var $ = function (id) { return r.querySelector('#' + id); };
        $('pr-pod').value = st.pod; $('pr-date').value = st.date;
        $('pr-pod').onchange = function () { st.pod = $('pr-pod').value; ls('wms.pr.pod', st.pod); reset(); };
        $('pr-date').onchange = function () { if ($('pr-date').value) { st.date = $('pr-date').value; reset(); } };
        var shift = function (n) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(st.date); var d = new Date(+m[1], +m[2] - 1, +m[3] + n); st.date = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); $('pr-date').value = st.date; reset(); };
        $('pr-prev').onclick = function () { shift(-1); }; $('pr-next').onclick = function () { shift(1); };
        $('pr-today').onclick = function () { var d = new Date(); st.date = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); $('pr-date').value = st.date; reset(); };
        $('pr-tomorrow').onclick = function () { st.date = tomorrow(); $('pr-date').value = st.date; reset(); };
        $('pr-load').onclick = function () { load(); };
        $('pr-all').onclick = function () { st.trips.forEach(function (t) { st.selected[t.trip_id] = true; }); paint(); };
        $('pr-notrel').onclick = function () { st.selected = {}; st.trips.forEach(function (t) { if (t.notReleased) st.selected[t.trip_id] = true; }); paint(); };
        $('pr-none').onclick = function () { st.selected = {}; paint(); };
        $('pr-mode').value = SET.mode; $('pr-wh').value = SET.wh; $('pr-scope').value = SET.scope; $('pr-par').value = String(SET.par); $('pr-iter').value = String(SET.iter); $('pr-pause').value = String(SET.pause); $('pr-later').value = SET.later;
        var save = function () { SET = { mode: 'lots', wh: $('pr-wh').value.trim() || 'GIC', scope: $('pr-scope').value, par: +$('pr-par').value, iter: +$('pr-iter').value, pause: +$('pr-pause').value, later: $('pr-later').value }; ls('wms.pr.set', SET); paintCount(); };
        ['pr-mode', 'pr-wh', 'pr-scope', 'pr-par', 'pr-iter', 'pr-pause', 'pr-later'].forEach(function (id) { $(id).onchange = save; });
        $('pr-go').onclick = start;
        r.querySelectorAll('.pr-tabs [data-t]').forEach(function (b) { b.onclick = function () { st.tab = b.dataset.t; paint(); }; });
        var g = $('pr-grep'), tm = null;
        g.oninput = function () { clearTimeout(tm); tm = setTimeout(function () { st.grep = g.value; paintBody(); }, 120); };
        g.onkeydown = function (e) { if (e.key === 'Escape') { g.value = ''; st.grep = ''; paintBody(); } };
        $('pr-grep-x').onclick = function () { g.value = ''; st.grep = ''; paintBody(); g.focus(); };
        $('pr-csv').onclick = csv;
        r.querySelector('#pr-trips').onclick = function (e) {
            var card = e.target.closest('.pr-trip'); if (!card) return;
            if (e.target.closest('a,button')) return;
            var id = card.dataset.trip;
            if (st.selected[id]) delete st.selected[id]; else st.selected[id] = true;
            paint();
        };
    }
    function reset() { st.trips = []; st.source = ''; st.selected = {}; st.runs = []; st.view = null; st.viewOrders = []; st.viewLog = []; st.error = ''; paint(); if (DB.on()) loadDb(); }

    function paint() {
        var r = root(); if (!r || !r.querySelector('.pr')) return;
        var $ = function (id) { return r.querySelector('#' + id); };
        $('pr-day').textContent = dayName(st.date) ? dayName(st.date) + ' · ' + ddmmyyyy(st.date) : ddmmyyyy(st.date);
        $('pr-db').innerHTML = DB.host === null ? '' : DB.host ? '<i class="fas fa-database"></i> DuckDB' : '<i class="fas fa-database" style="opacity:.4"></i> no DuckDB — ' + esc(DB.error || '');
        $('pr-db').className = 'pr-db' + (DB.host === false ? ' off' : '');
        $('pr-src').innerHTML = st.loading ? '<i class="fas fa-spinner fa-spin"></i> reading the trips of ' + esc(dayName(st.date) || ddmmyyyy(st.date)) + '…' : st.error ? '<span class="bad">' + esc(st.error) + '</span>' :
            st.source === 'apex' ? '<i class="fas fa-check" style="color:#15803d"></i> read from APEX at ' + esc(hm(st.readAt)) : st.source === 'duckdb' ? '<i class="fas fa-database"></i> from DuckDB · read at ' + esc(String(st.readAt || '').slice(0, 16)) + ' — Load trips reads again' : '<span class="muted">Load trips reads the trips and their orders.</span>';
        $('pr-load').disabled = st.loading;
        paintTrips(); paintCount(); paintBar(); paintBody(); paintFloat();
    }
    function paintTrips() {
        var box = root().querySelector('#pr-trips');
        if (!st.trips.length) { box.innerHTML = '<div class="pr-empty">' + (st.loading ? 'Reading…' : 'No trips loaded for ' + esc(dayName(st.date) || ddmmyyyy(st.date)) + ' — press <b>Load trips</b>.') + '</div>'; root().querySelector('#pr-tcount').textContent = ''; return; }
        var last = {}; st.runs.forEach(function (x) { String(x.trips || '').split(',').forEach(function (t) { if (!last[t]) last[t] = x; }); });
        box.innerHTML = st.trips.map(function (t) {
            var on = !!st.selected[t.trip_id], live = t.count - t.cancelled, pct = live ? Math.round(100 * t.released / live) : 0, lr = last[t.trip_id];
            var prio = String(t.priority || '').toLowerCase();
            return '<div class="pr-trip' + (on ? ' on' : '') + (t.notReleased ? '' : ' done') + '" data-trip="' + esc(t.trip_id) + '">' +
                '<div class="pr-trip-top"><input type="checkbox"' + (on ? ' checked' : '') + ' tabindex="-1"><b class="mono">Trip ' + esc(t.trip_id) + '</b>' + (t.bay ? '<span class="pr-pill">bay ' + esc(t.bay) + '</span>' : '') +
                (t.priority ? '<span class="pr-pill ' + (/high|^1$|^10$/.test(prio) ? 'hi' : /low/.test(prio) ? 'lo' : '') + '">' + esc(t.priority) + '</span>' : '') + '<span class="grow"></span>' +
                (t.error ? '<span class="pr-pill bad" title="' + esc(t.error) + '">not read</span>' : '') + '</div>' +
                '<div class="pr-trip-lorry"><i class="fas fa-truck"></i> ' + esc(t.lorry || '—') + '</div>' +
                '<div class="pr-trip-n"><span><b>' + live + '</b> order' + (live === 1 ? '' : 's') + '</span><span class="' + (t.notReleased ? 'warn' : 'good') + '"><b>' + t.released + '</b> released</span>' +
                (t.notReleased ? '<span class="warn"><b>' + t.notReleased + '</b> not released</span>' : '') + (t.s2v ? '<span class="muted" title="Store to Van / Van to Store — the WMS allocates lots for these">' + t.s2v + ' S2V</span>' : '') + (t.cancelled ? '<span class="muted">' + t.cancelled + ' cancelled</span>' : '') + '</div>' +
                '<div class="pr-bar"><b style="width:' + pct + '%"></b></div>' +
                '<div class="pr-trip-foot">' + (lr ? '<span title="Last run ' + esc(lr.run_id) + ' · ' + esc(lr.status) + '">last run ' + esc(hm(lr.started_at)) + ' · ' + esc(lr.status.toLowerCase()) + ' · ' + esc(lr.iteration) + '/' + esc(lr.iterations) + '</span>' : '<span class="muted">no run today</span>') +
                '<span class="grow"></span>' + (typeof window.openTripDetails === 'function' ? '<a href="#" class="pr-open" data-open="' + esc(t.trip_id) + '" title="Open the trip in its own tab">Open</a>' : '') + '</div></div>';
        }).join('');
        box.querySelectorAll('[data-open]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); e.stopPropagation(); var t = st.trips.filter(function (x) { return x.trip_id === a.dataset.open; })[0]; if (!t) return;
            try { window.openTripDetails(t.trip_id, st.date + 'T00:00:00', t.lorry, st.pod, t.bay, t.priority); if (typeof navigateToPage === 'function') navigateToPage('trip-management'); } catch (err) { note('Could not open the trip: ' + err.message, 'error'); } }; });
        var sel = st.trips.filter(function (t) { return st.selected[t.trip_id]; });
        root().querySelector('#pr-tcount').textContent = st.trips.length + ' trip(s) · ' + sel.length + ' ticked';
    }
    function paintCount() {
        var r = root(); if (!r || !r.querySelector('.pr')) return;
        var n = 0;
        st.trips.filter(function (t) { return st.selected[t.trip_id]; }).forEach(function (t) { t.orders.forEach(function (o) { if (o.__can || o.__s2v) return; if (SET.scope === 'notreleased' && o.__rel) return; n++; }); });
        r.querySelector('#pr-gon').textContent = n;
        r.querySelector('#pr-go').disabled = !!R.run;
        r.querySelector('#pr-go').title = R.run ? 'A run is going — stop it first' : '';
    }
    /** The status bar of the live run (or of the run shown). */
    function paintBar() {
        var r = root(); if (!r || !r.querySelector('.pr')) return;
        var box = r.querySelector('#pr-status'), run = R.run;
        if (!run) {
            var v = st.view;
            if (!v) { box.style.display = 'none'; return; }
            box.style.display = '';
            var cls = v.status === 'DONE' ? 'done' : v.status === 'STOPPED' || v.status === 'INTERRUPTED' ? 'stopped' : '';
            box.innerHTML = '<div class="pr-status-top ' + cls + '"><span class="pr-st-pill">' + esc(v.status) + '</span><b>Run ' + esc(v.run_id) + '</b><span>' + esc(v.trip_count) + ' trip(s) · ' + esc(v.orders_total) + ' order(s) · ' + esc(v.mode === 'lots' ? 'with lots' : 'no lots') + '</span>' +
                '<span>iteration ' + esc(v.iteration) + ' of ' + esc(v.iterations) + '</span><span class="good">' + esc(v.released_count) + ' released</span>' + (num(v.failed_count) ? '<span class="bad">' + esc(v.failed_count) + ' failed</span>' : '') +
                '<span class="muted">' + esc(String(v.started_at).slice(0, 16)) + (v.ended_at ? ' → ' + esc(hm(v.ended_at)) : '') + ' · ' + esc(v.by_user || '') + (v.pc ? ' · ' + esc(v.pc) : '') + '</span><span class="grow"></span>' +
                (v.message ? '<span class="pr-msg" title="' + esc(v.message) + '">' + esc(v.message) + '</span>' : '') + '</div>';
            return;
        }
        box.style.display = '';
        var c = counts(run), total = run.total || 1, pct = run.status === 'WAITING' ? 100 : Math.round(100 * run.done / total);
        var head = run.stopping ? 'Stopping after the order in hand…' : run.status === 'WAITING' ? 'Waiting ' + mmss(run.nextAt - Date.now()) + ' before iteration ' + (run.iter + 1) + ' of ' + run.iters :
            run.phase === 'reading' ? 'Iteration ' + run.iter + ' of ' + run.iters + ' · reading the trips again…' : 'Iteration ' + run.iter + ' of ' + run.iters + ' · ' + run.done + ' of ' + run.total + ' order(s)';
        box.innerHTML = '<div class="pr-status-top live"><span class="pr-st-pill"><i class="fas fa-spinner fa-spin"></i> ' + esc(run.status) + '</span><b>' + esc(head) + '</b>' +
            '<span class="good">' + c.ok + ' ok</span>' + (c.failed ? '<span class="bad">' + c.failed + ' failed</span>' : '') + (c.released ? '<span class="good">' + c.released + ' released</span>' : '') + (c.skipped ? '<span class="muted">' + c.skipped + ' skipped</span>' : '') +
            '<span class="muted">' + dur(Date.now() - run.started) + ' · ' + esc(run.id) + '</span><span class="grow"></span>' +
            (run.status === 'WAITING' && !run.stopping ? '<button class="pr-btn sm" id="pr-skip">Skip the wait</button>' : '') + '<button class="pr-btn sm danger" id="pr-stop"' + (run.stopping ? ' disabled' : '') + '><i class="fas fa-stop"></i> Stop</button></div>' +
            '<div class="pr-prog' + (run.status === 'WAITING' ? ' wait' : '') + '"><b style="width:' + pct + '%"></b></div>' +
            '<div class="pr-iters">' + Array.from({ length: run.iters }, function (_, i) { var k = i + 1; return '<span class="' + (k < run.iter ? 'd' : k === run.iter ? (run.status === 'WAITING' ? 'd' : 'p') : '') + '">' + k + '</span>'; }).join('') + '</div>';
        var sk = box.querySelector('#pr-skip'); if (sk) sk.onclick = function () { if (run.skipWait) run.skipWait(); };
        box.querySelector('#pr-stop').onclick = stop;
    }
    function hay(o) { return Object.keys(o).filter(function (k) { return k !== 'raw_json' && k.charAt(0) !== '_'; }).map(function (k) { return String(o[k] == null ? '' : o[k]); }).join(' \u0001 ').toLowerCase(); }
    function grepTokens() { return String(st.grep || '').toLowerCase().split(/\s+/).filter(Boolean); }
    function shown(list) { var tk = grepTokens(); if (!tk.length) return list; return list.filter(function (o) { var h = hay(o); return tk.every(function (t) { return h.indexOf(t) >= 0; }); }); }
    function runOrderRows(run) {
        return run.orders.map(function (o) { return { trip_id: o.trip_id, order_number: o.order, account_name: o.account, order_type: o.type, lines: o.lines, released_before: o.relBefore ? 'Y' : 'N', result: o.result, message: o.msg, tries: o.tries, iteration: o.iter, last_ts: o.lastTs, ms: o.ms, released_after: o.relAfter, __row: o.row }; });
    }
    function liveOrders() {
        if (R.run) return runOrderRows(R.run);
        if (st.view) return st.viewOrders;
        var out = [];
        st.trips.filter(function (t) { return st.selected[t.trip_id]; }).forEach(function (t) { t.orders.forEach(function (r) { if (r.__can) return; out.push({ trip_id: t.trip_id, order_number: r.__o, account_name: pick(r, ['ACCOUNT_NAME', 'account_name', 'CUSTOMER_NAME', 'customer_name']) || '', order_type: pick(r, ['ORDER_TYPE', 'order_type', 'ORDER_TYPE_CODE']) || '',
            lines: num(pick(r, ['order_lines', 'ORDER_LINES', 'line_count', 'LINE_COUNT', 'TOTAL_LINES'])), released_before: r.__rel ? 'Y' : 'N', result: r.__s2v ? 'SKIPPED' : '', message: r.__s2v ? 'Store to Van / Van to Store — the WMS allocates lots' : '', tries: '', iteration: '', last_ts: '', ms: '', released_after: '', __row: r }); }); });
        return out;
    }
    function pill(result) {
        var m = { OK: 'ok', FAILED: 'bad', RUNNING: 'run', PENDING: 'wait', SKIPPED: 'dim' };
        return result ? '<span class="pr-res ' + (m[result] || '') + '">' + (result === 'RUNNING' ? '<i class="fas fa-spinner fa-spin"></i> ' : '') + esc(result) + '</span>' : '<span class="muted">—</span>';
    }
    function yn(v, good) { return v === 'Y' ? '<span class="' + (good === false ? 'muted' : 'good') + '"><i class="fas fa-check"></i> yes</span>' : v === 'N' ? '<span class="warn">no</span>' : '<span class="muted">—</span>'; }
    function paintBody() {
        var r = root(); if (!r || !r.querySelector('.pr')) return;
        r.querySelectorAll('.pr-tabs [data-t]').forEach(function (b) { b.classList.toggle('on', b.dataset.t === st.tab); });
        var body = r.querySelector('#pr-body'), gbox = r.querySelector('.pr-grep-box'), gn = r.querySelector('#pr-grep-n');
        gbox.style.visibility = st.tab === 'runs' ? 'hidden' : '';
        if (st.tab === 'orders') {
            var all = liveOrders(), list = shown(all);
            gn.textContent = st.grep ? list.length + ' of ' + all.length : '';
            if (!all.length) { body.innerHTML = '<div class="pr-empty">' + (st.trips.length ? 'Tick a trip to see its orders.' : 'No orders.') + '</div>'; return; }
            var canOpen = typeof window.editTripOrder === 'function';
            body.innerHTML = '<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Trip</th><th>Order</th><th>Customer</th><th>Type</th><th class="num">Lines</th><th>Released before</th><th>Result</th><th>Message</th><th class="num">Tries</th><th class="num">Iter.</th><th>Last try</th><th class="num">ms</th><th>Released after</th></tr></thead><tbody>' +
                list.map(function (o) {
                    return '<tr class="' + (o.result === 'FAILED' ? 'bad' : o.result === 'OK' ? 'ok' : '') + '"><td class="mono">' + esc(o.trip_id) + '</td><td class="mono">' + (canOpen && o.__row ? '<a href="#" data-od="' + esc(o.order_number) + '" data-trip="' + esc(o.trip_id) + '" title="Open the order details">' + esc(o.order_number) + '</a>' : esc(o.order_number)) + '</td>' +
                        '<td class="cut" title="' + esc(o.account_name) + '">' + esc(o.account_name) + '</td><td class="cut" title="' + esc(o.order_type) + '">' + esc(o.order_type) + '</td><td class="num">' + esc(o.lines) + '</td><td>' + yn(o.released_before, false) + '</td><td>' + pill(o.result) + '</td>' +
                        '<td class="cut msg" title="' + esc(o.message) + '">' + esc(o.message) + '</td><td class="num">' + esc(o.tries) + '</td><td class="num">' + esc(o.iteration) + '</td><td class="mono">' + esc(hm(o.last_ts) || (o.last_ts ? String(o.last_ts).slice(0, 16) : '')) + '</td><td class="num">' + esc(o.ms) + '</td><td>' + yn(o.released_after) + '</td></tr>';
                }).join('') + '</tbody></table></div>';
            body.querySelectorAll('[data-od]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); var o = all.filter(function (x) { return x.order_number === a.dataset.od && x.trip_id === a.dataset.trip; })[0]; if (o && o.__row) { try { window.currentTripInstance = st.pod; window.editTripOrder(o.__row); } catch (err) { note('Could not open the order: ' + err.message, 'error'); } } }; });
        } else if (st.tab === 'log') {
            var lines = R.run ? R.run.log : st.viewLog, l2 = shown(lines);
            gn.textContent = st.grep ? l2.length + ' of ' + lines.length : '';
            body.innerHTML = lines.length ? '<div class="pr-log">' + l2.map(function (l) { return '<div class="' + esc(l.level) + '"><span class="t">' + esc(hm(l.ts) + ':' + String(l.ts).slice(17, 19)) + '</span><span class="i">' + (num(l.iteration != null ? l.iteration : l.iter) ? 'it. ' + esc(l.iteration != null ? l.iteration : l.iter) : '') + '</span>' + esc(l.text) + '</div>'; }).join('') + '</div>' : '<div class="pr-empty">Nothing run yet.</div>';
        } else {
            gn.textContent = '';
            body.innerHTML = st.runs.length ? '<div class="pr-scroll"><table class="pr-table"><thead><tr><th>Run</th><th>Started</th><th>Ended</th><th>Status</th><th>Trips</th><th class="num">Orders</th><th>Mode</th><th class="num">Iterations</th><th class="num">Released</th><th class="num">Failed</th><th>By</th><th>Message</th><th></th></tr></thead><tbody>' +
                st.runs.map(function (x) {
                    var on = (R.run && R.run.id === x.run_id) || (st.view && st.view.run_id === x.run_id);
                    return '<tr class="' + (on ? 'on' : '') + '"><td class="mono">' + esc(x.run_id) + '</td><td>' + esc(String(x.started_at || '').slice(0, 16)) + '</td><td>' + esc(hm(x.ended_at)) + '</td><td><span class="pr-res ' + (x.status === 'DONE' ? 'ok' : /RUNNING|WAITING/.test(x.status) ? 'run' : x.status === 'STOPPED' ? 'dim' : 'bad') + '">' + esc(x.status) + '</span></td>' +
                        '<td class="cut" title="' + esc(x.trips) + '">' + esc(x.trips) + '</td><td class="num">' + esc(x.orders_total) + '</td><td>' + esc(x.mode === 'lots' ? 'with lots' : 'no lots') + '</td><td class="num">' + esc(x.iteration) + ' / ' + esc(x.iterations) + '</td><td class="num">' + esc(x.released_count) + '</td><td class="num">' + esc(x.failed_count) + '</td><td>' + esc(x.by_user || '') + '</td><td class="cut msg" title="' + esc(x.message || '') + '">' + esc(x.message || '') + '</td>' +
                        '<td>' + (R.run && R.run.id === x.run_id ? '<span class="muted">live</span>' : '<button class="pr-btn sm" data-view="' + esc(x.run_id) + '">Show</button>') + '</td></tr>';
                }).join('') + '</tbody></table></div>' : '<div class="pr-empty">No run for ' + esc(dayName(st.date) || ddmmyyyy(st.date)) + (DB.host === false ? ' (DuckDB is not available on this build, runs are not kept)' : '') + '.</div>';
            body.querySelectorAll('[data-view]').forEach(function (b) { b.onclick = function () { viewRun(b.dataset.view); }; });
        }
    }
    function csv() {
        var rows, cols;
        if (st.tab === 'runs') { rows = st.runs; cols = COLS.w2_pr_runs; }
        else if (st.tab === 'log') { rows = shown(R.run ? R.run.log : st.viewLog); cols = ['ts', 'iteration', 'level', 'text']; rows = rows.map(function (l) { return { ts: l.ts, iteration: l.iteration != null ? l.iteration : l.iter, level: l.level, text: l.text }; }); }
        else { rows = shown(liveOrders()); cols = ['trip_id', 'order_number', 'account_name', 'order_type', 'lines', 'released_before', 'result', 'message', 'tries', 'iteration', 'last_ts', 'ms', 'released_after']; }
        if (!rows.length) { note('Nothing to download.', 'info'); return; }
        var q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var text = cols.join(',') + '\n' + rows.map(function (r) { return cols.map(function (c) { return q(r[c]); }).join(','); }).join('\n');
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv' })); a.download = 'pick-release-' + st.tab + '-' + st.date + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
    /** The floating chip: visible on every other page while a run is going. */
    function paintFloat() {
        var el = document.getElementById('pr-float');
        var run = R.run;
        if (!run || visible()) { if (el) el.style.display = 'none'; return; }
        if (!el) {
            el = document.createElement('div'); el.id = 'pr-float'; el.className = 'pr-float';
            el.innerHTML = '<i class="fas fa-dolly"></i><span class="pr-float-text"></span><button class="pr-btn sm" id="pr-float-open">Open</button>';
            document.body.appendChild(el);
            el.querySelector('#pr-float-open').onclick = function () { if (typeof navigateToPage === 'function') navigateToPage(PAGE); };
        }
        var c = counts(run);
        el.querySelector('.pr-float-text').innerHTML = '<b>Pick release</b> · ' + (run.status === 'WAITING' ? 'next iteration in ' + mmss(run.nextAt - Date.now()) : 'iteration ' + run.iter + '/' + run.iters + ' · ' + run.done + ' of ' + run.total) + (c.failed ? ' · <span class="bad">' + c.failed + ' failed</span>' : '') + ' · <span class="good">' + c.released + ' released</span>';
        el.style.display = '';
    }

    // ─── open / wiring ─────────────────────────────────────────────────────────
    var PR = window.PickRelease = {
        onShow: function () {
            if (!st.pod) { st.pod = (ls('wms.pr.pod') || (document.getElementById('trip-instance-name') || {}).value || 'PROD'); }
            if (!st.date) st.date = window.wmsTripDate ? window.wmsTripDate.get() : tomorrow();   // the trip date chosen when the WMS opened
            shell(); paint();
            DB.probe().then(function (ok) { paint(); if (ok && !st.trips.length && !st.loading) loadDb(); });
        },
        load: load, start: start, stop: stop, state: st, run: function () { return R.run; }, settings: function () { return SET; }, isReleased: isReleased, DB: DB
    };
    // the toolbar's trip date moves this page too (not during a run; the page's own date controls still work)
    (function () { var reg = function () { if (window.wmsTripDate) window.wmsTripDate.on(function (d) { if (R.run || st.date === d) return; st.date = d; var inp = root() && root().querySelector('#pr-date'); if (inp) { inp.value = d; reset(); } }); }; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reg); else reg(); })();
    // the menu's navigateToPage shows the page; this wrapper draws it (app.js itself is unchanged)
    function hook() {
        var orig = window.navigateToPage;
        if (typeof orig !== 'function' || orig.__pr) return false;
        var w = function (pageId, pushState) { var r = orig.apply(this, arguments); if (pageId === PAGE) PR.onShow(); else paintFloat(); return r; };
        w.__pr = true; window.navigateToPage = w;
        return true;
    }
    if (!hook()) document.addEventListener('DOMContentLoaded', function () { setTimeout(hook, 0); });
    document.addEventListener('DOMContentLoaded', function () {
        setTimeout(function () { var r = root(); if (r && r.style.display !== 'none' && (location.hash === '#' + PAGE || new URLSearchParams(location.search).get('page') === PAGE)) PR.onShow(); }, 400);
    });
    window.addEventListener('beforeunload', function (e) { if (R.run) { e.preventDefault(); e.returnValue = 'A pick release run is going — closing stops it.'; return e.returnValue; } });
})();
