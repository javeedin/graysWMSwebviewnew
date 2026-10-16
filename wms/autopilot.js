// ============================================================================
// CANCELLATION AUTOPILOT (WMS page) — the WMS 2.0 autopilot inside the WMS
// ----------------------------------------------------------------------------
// WMS menu › Cancellation autopilot (data-page="cancel-autopilot"): cancels Scheduled / Manual Reservation lines
// automatically with the Shipping Agent's rules (wms/cancel-rules.js = wms2/w2-cancel-rules.js, ONE file for both
// modules, global W2CR), for the trips of today and / or tomorrow, every n minutes while the WMS is open on the PC that
// holds the lease. The same shared APEX tables as WMS 2.0 — WMS_W2_SETTINGS (switch + options), WMS_W2_LEASE
// ('AUTOPILOT_<pod>'), WMS_W2_CANCEL_LOG (ledger) — so ONE switch and ONE ledger serve both modules, and the WMS and
// WMS 2.0 never cancel at the same time (this page's lease holder ends with " WMS", so a WMS 2.0 window on the same PC
// is another holder). One run, per trip date:
//   1. the trips of the date (GETTRIPDETAILS) → every trip's WMS order lines (getsalesorderlinesbytrip, 3 trips at a time)
//   2. the orders with a flagged line, expanded (W2CR.expand: main lines + their sub-lines / BOGO items; ARMODULE/BOGO)
//   3. per order: read it LIVE (POST fetchfusionorderlines + GET getsalesorderlines/{order}) and expand THAT — nothing is
//      decided from old data; a line tried 3 times in 3 days (the shared ledger) is left for a person
//   4. PATCH salesOrdersForOrderHub/OPS:{order} { lines: [{ FulfillLineId, OrderedQuantity: 0, CancelReason: 'OUT OF STOCK' }] }
//   5. read again after 2.5 s: a sent line is DONE only when it now reads Cancelled (or is gone), else FAILED.
// Max lines per run (safety); the AI kill switch (AI Digital Employee › Control) stops it; every order is audited
// (aiAudit, source WMS_AUTOPILOT). "Check (no cancel)" = steps 1-2 only, listed in "Would be cancelled now".
// DuckDB (the WMS 2.0 file through w2Put, best effort): runs and lines also go to w2_runs / w2_cancel_log, so the
// WMS 2.0 autopilot page shows them too. Without DuckDB everything works from APEX alone.
// ============================================================================
(function () {
    'use strict';
    var ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP';
    var WM = ORDS + '/WAREHOUSEMANAGEMENT', TM = ORDS + '/TRIPMANAGEMENT', GW = WM + '/ai';
    var FUSION = { PROD: 'https://efmh.fa.em3.oraclecloud.com', TEST: 'https://efmh-test.fa.em3.oraclecloud.com' };
    var PAGE = 'cancel-autopilot';
    var DEFAULTS = { on: false, every: 45, today: true, tomorrow: true, maxLines: 300 };
    var EVERY = [45, 60, 90, 120, 180, 240];
    var R = window.W2CR;

    // ─── small helpers ─────────────────────────────────────────────────────────
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var lit = function (s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; };
    var pad2 = function (n) { return ('0' + n).slice(-2); };
    var iso = function (d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
    var today = function () { return iso(new Date()); };
    var addDays = function (s, n) { var d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
    var now = function () { var d = new Date(); return iso(d) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); };
    var ddmmyyyy = function (s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '-' + m[2] + '-' + m[1] : String(s || ''); };
    var enc = encodeURIComponent;
    function dayName(s) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); if (!m) return s || '';
        var d = new Date(+m[1], +m[2] - 1, +m[3]), t = new Date(); t.setHours(0, 0, 0, 0);
        var diff = Math.round((d - t) / 86400000);
        return (diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]) + ' · ' + ddmmyyyy(s);
    }
    function ago(t) { if (!t) return ''; var s = Math.max(0, (Date.now() - new Date(String(t).replace(' ', 'T')).getTime()) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; }
    function pick(row, names) {
        if (!row) return '';
        var keys = Object.keys(row);
        for (var i = 0; i < names.length; i++) { var k = keys.find(function (x) { return x.toLowerCase() === names[i].toLowerCase(); }); if (k && row[k] != null && row[k] !== '') return row[k]; }
        return '';
    }
    function items(r) { if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return []; } } return Array.isArray(r) ? r : (r && Array.isArray(r.items)) ? r.items : []; }
    function user() { try { return localStorage.getItem('wms_user') || sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || 'WMS'; } catch (e) { return 'WMS'; } }
    /** The same PC id WMS 2.0 uses (localStorage w2.pcid, JSON), so one PC has one name in the shared ledger. */
    function pc() {
        try {
            var raw = localStorage.getItem('w2.pcid'), v = raw && raw.charAt(0) === '"' ? JSON.parse(raw) : raw;
            if (!v) { v = 'PC-' + Math.random().toString(36).slice(2, 8).toUpperCase(); localStorage.setItem('w2.pcid', JSON.stringify(v)); }
            return v;
        } catch (e) { return 'PC'; }
    }
    function me() { return (pc() + ' ' + user() + ' WMS').slice(0, 200); }
    function note(m, t) { if (typeof showNotification === 'function') showNotification(m, t || 'info'); else console.log('[Autopilot]', m); }
    function ls(k, v) { try { if (v === undefined) { var s = localStorage.getItem(k); return s == null ? null : JSON.parse(s); } localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } return v; }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    /** n at a time; a failing item never stops the others (fn handles its own errors). */
    function pool(list, n, fn) {
        var i = 0;
        var next = function () { if (i >= list.length) return Promise.resolve(); var idx = i++; return Promise.resolve().then(function () { return fn(list[idx], idx); }).catch(function (e) { console.warn('[Autopilot] pooled call failed:', e && e.message || e); }).then(next); };
        var w = []; for (var k = 0; k < Math.min(n, list.length); k++) w.push(next());
        return Promise.all(w);
    }

    // ─── host IO (never the full-page "Processing" overlay: runs happen in the background) ─────────
    function host(msg, ms) {
        return new Promise(function (resolve, reject) {
            if (!(window.chrome && window.chrome.webview) || typeof sendMessageToCSharp !== 'function') { reject(new Error('Open this page inside the Gray\'s WMS app.')); return; }
            sendMessageToCSharp(msg, function (err, data) {
                if (err) { reject(new Error(typeof err === 'string' ? err : (err.message || JSON.stringify(err)))); return; }
                var r = data; if (typeof data === 'string') { try { r = JSON.parse(data); } catch (e) { r = data; } }
                resolve(r);
            }, ms || 120000, false);
        });
    }
    function get(url, ms) { return host({ action: 'executeGet', fullUrl: url }, ms || 120000); }
    function post(url, body, ms) { return host({ action: 'executePost', fullUrl: url, body: typeof body === 'string' ? body : JSON.stringify(body || {}) }, ms || 180000); }
    function gw(sql, max) {
        return post(GW + '/executequery', { appUser: user(), sql: sql, maxRows: max || 5000 }).then(function (d) {
            if (!d || d.success === false) throw new Error((d && d.error) || 'APEX query failed');
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || []).map(function (r) {
                if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; }
                var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x;
            });
        });
    }
    function gwWrite(sql) { return post(GW + '/executewrite', { appUser: user(), sql: sql }).then(function (d) { if (!d || d.success === false) throw new Error((d && d.error) || 'APEX write failed'); return d; }); }
    function fusionPatch(pod, order, body) {
        return host({ action: 'executeOracleFusionPatch', fullUrl: R.url(FUSION[pod] || FUSION.PROD, order), body: JSON.stringify(body), instance: pod }, 120000);
    }
    function audit(ev) { return host(Object.assign({ action: 'aiAudit', source: 'WMS_AUTOPILOT', approval: 'AUTO' }, ev), 15000).catch(function () {}); }

    // ─── DuckDB (the WMS 2.0 file; best effort — the page works from APEX alone) ─────────────
    var COLS = {
        w2_runs: ['pod', 'run_id', 'kind', 'trip_date', 'started_at', 'ended_at', 'ms', 'summary', 'pc', 'by_user'],
        w2_cancel_log: ['pod', 'run_id', 'ts', 'pc', 'by_user', 'trip_date', 'trip_id', 'order_number', 'line_number', 'item', 'status_before', 'fulfill_line_id', 'via', 'result', 'message', 'response']
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
        put: function (table, scope, rows) {
            if (!DB.on() || !rows.length) return Promise.resolve();
            var p = DB.io.then(function () { return DB.call('w2Put', { table: table, scope: scope, rows: rows, replaceAll: false, columns: COLS[table] || [] }, 300000); });
            DB.io = p.catch(function (e) { console.warn('[Autopilot] DuckDB write failed:', e && e.message || e); });
            return p.catch(function () {});
        }
    };

    // ─── APEX tables (created on first use; apex_sql/87_wms2.sql has the same DDL) ─────────────
    var DDL = {
        WMS_W2_SETTINGS: "CREATE TABLE wms_w2_settings (setting_key VARCHAR2(80) PRIMARY KEY, setting_value VARCHAR2(4000), changed_by VARCHAR2(200), changed_date DATE DEFAULT SYSDATE)",
        WMS_W2_LEASE: "CREATE TABLE wms_w2_lease (lease_name VARCHAR2(80) PRIMARY KEY, holder VARCHAR2(200), lease_until DATE)",
        WMS_W2_CANCEL_LOG: "CREATE TABLE wms_w2_cancel_log (log_id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, run_id VARCHAR2(40), logged_at DATE DEFAULT SYSDATE, pod VARCHAR2(10), " +
            "pc_name VARCHAR2(60), app_user VARCHAR2(200), trip_date VARCHAR2(10), trip_id VARCHAR2(60), order_number VARCHAR2(60), line_number VARCHAR2(30), item VARCHAR2(200), status_before VARCHAR2(200), " +
            "fulfill_line_id VARCHAR2(60), via VARCHAR2(20), result VARCHAR2(20), message VARCHAR2(1000), response VARCHAR2(2000))"
    };
    var ready = null;
    function ensure() {
        if (ready) return ready;
        ready = gw("SELECT table_name FROM user_tables WHERE table_name IN ('WMS_W2_SETTINGS', 'WMS_W2_LEASE', 'WMS_W2_CANCEL_LOG')", 10).then(function (r) {
            var have = r.map(function (x) { return x.TABLE_NAME; });
            return Object.keys(DDL).filter(function (t) { return have.indexOf(t) < 0; }).reduce(function (p, t) { return p.then(function () { return gwWrite(DDL[t]); }); }, Promise.resolve());
        }).catch(function (e) { ready = null; throw e; });
        return ready;
    }

    // ─── state ─────────────────────────────────────────────────────────────────
    var st = { pod: null, date: null, settings: null, lease: null, plan: null, planAt: null, planTrips: 0, planErr: '', loadingPlan: false, lists: null, listsErr: '', checks: [] };
    var A = { running: null, stopping: false, status: '', lastRun: null, nextAt: null };

    // ─── settings (shared with WMS 2.0 in APEX) ────────────────────────────────
    function loadSettings() {
        var pod = st.pod;
        return ensure().then(function () {
            return gw("SELECT setting_key, setting_value, changed_by, TO_CHAR(changed_date, 'YYYY-MM-DD HH24:MI') AS changed_at FROM wms_w2_settings WHERE setting_key LIKE 'AUTOPILOT%'", 50);
        }).then(function (rows) {
            var s = Object.assign({}, DEFAULTS, { pod: pod });
            rows.forEach(function (r) {
                if (r.SETTING_KEY === 'AUTOPILOT_' + pod) { s.on = r.SETTING_VALUE === 'ON'; s.by = r.CHANGED_BY; s.at = r.CHANGED_AT; }
                if (r.SETTING_KEY === 'AUTOPILOT_OPTIONS') { try { Object.assign(s, JSON.parse(r.SETTING_VALUE || '{}'), { on: s.on }); } catch (e) { /* keep defaults */ } }
                if (r.SETTING_KEY === 'AUTOPILOT_' + pod + '_REASON') s.reason = r.SETTING_VALUE;
            });
            s.every = Math.max(45, +s.every || 45);
            st.settings = s;
            return s;
        }).catch(function (e) { st.settings = Object.assign({}, DEFAULTS, { pod: pod, error: String(e && e.message || e) }); return st.settings; });
    }
    function setKey(k, v) {
        return gwWrite("MERGE INTO wms_w2_settings t USING (SELECT " + lit(k) + " AS k, " + lit(v) + " AS v FROM dual) s ON (t.setting_key = s.k) " +
            "WHEN MATCHED THEN UPDATE SET t.setting_value = s.v, t.changed_by = " + lit(user()) + ", t.changed_date = SYSDATE " +
            "WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, changed_by, changed_date) VALUES (s.k, s.v, " + lit(user()) + ", SYSDATE)");
    }
    function setOn(on, reason) {
        var pod = st.pod;
        return ensure().then(function () { return setKey('AUTOPILOT_' + pod, on ? 'ON' : 'OFF'); }).then(function () { return setKey('AUTOPILOT_' + pod + '_REASON', reason || ''); }).then(function () {
            audit({ actionKey: on ? 'autopilot_on' : 'autopilot_off', outcome: 'OK', instance: pod, detail: reason || '' });
            A.nextAt = null;
            return loadSettings();
        });
    }
    function saveOptions(o) {
        return ensure().then(function () { return setKey('AUTOPILOT_OPTIONS', JSON.stringify({ every: o.every, today: o.today, tomorrow: o.tomorrow, maxLines: o.maxLines })); }).then(function () { A.nextAt = null; return loadSettings(); });
    }
    function datesOf(s) { s = s || DEFAULTS; var out = [], t = today(); if (s.today) out.push(t); if (s.tomorrow) out.push(addDays(t, 1)); return out; }
    function maxLines() { return (st.settings && st.settings.maxLines) || 300; }

    // ─── lease: one PC cancels at a time (WMS and WMS 2.0 share it) ───────────
    function lease() {
        var name = 'AUTOPILOT_' + st.pod, who = me();
        return gwWrite("MERGE INTO wms_w2_lease t USING (SELECT " + lit(name) + " AS n FROM dual) s ON (t.lease_name = s.n) " +
            "WHEN MATCHED THEN UPDATE SET t.holder = " + lit(who) + ", t.lease_until = SYSDATE + 10/1440 WHERE t.lease_until < SYSDATE OR t.holder = " + lit(who) + " " +
            "WHEN NOT MATCHED THEN INSERT (lease_name, holder, lease_until) VALUES (s.n, " + lit(who) + ", SYSDATE + 10/1440)").then(function () { return readLease(); }).then(function (l) { return !!(l && l.HOLDER === who); });
    }
    function readLease() { return gw("SELECT holder, TO_CHAR(lease_until, 'YYYY-MM-DD HH24:MI:SS') AS until FROM wms_w2_lease WHERE lease_name = " + lit('AUTOPILOT_' + st.pod), 1).then(function (r) { st.lease = r[0] || null; return st.lease; }).catch(function () { return st.lease; }); }
    function release() {
        return gwWrite("MERGE INTO wms_w2_lease t USING (SELECT " + lit('AUTOPILOT_' + st.pod) + " AS n FROM dual) s ON (t.lease_name = s.n) " +
            "WHEN MATCHED THEN UPDATE SET t.lease_until = SYSDATE - 1/1440 WHERE t.holder = " + lit(me())).catch(function () {});
    }
    function holderText() { return (st.lease && st.lease.HOLDER || '?') + ' until ' + (st.lease && st.lease.UNTIL || '?'); }

    // ─── reads ─────────────────────────────────────────────────────────────────
    function tripsOfDate(pod, date) {
        var p = new URLSearchParams({ P_DATE_FROM: ddmmyyyy(date), P_DATE_TO: ddmmyyyy(date), P_INSTANCE_NAME: pod });
        return get(WM + '/GETTRIPDETAILS?' + p.toString()).then(function (r) {
            var map = {}, list = [];
            items(r).forEach(function (t) {
                var inst = String(pick(t, ['INSTANCE_NAME', 'instance_name']) || '').toUpperCase();
                if (inst && inst !== pod) return;
                var id = String(pick(t, ['TRIP_ID', 'trip_id']) || '').trim(); if (!id || map[id]) return;
                map[id] = { trip_id: id, lorry: pick(t, ['TRIP_LORRY', 'trip_lorry', 'LORRY_NUMBER']) || '', bay: pick(t, ['TRIP_LOADING_BAY', 'trip_loading_bay', 'LOADING_BAY']) || '', priority: pick(t, ['TRIP_PRIORITY', 'trip_priority', 'PRIORITY']) || '' };
                list.push(map[id]);
            });
            return list.sort(function (a, b) { return (parseFloat(a.trip_id) || 0) - (parseFloat(b.trip_id) || 0); });
        });
    }
    function linesOfTrip(pod, trip) { return get(TM + '/trip/orders/getsalesorderlinesbytrip/' + enc(trip) + '?P_INSTANCE_NAME=' + enc(pod)).then(items); }
    function liveLines(pod, trip, order) {
        return post(TM + '/trip/order/fetchfusionorderlines?P_INSTANCE_NAME=' + enc(pod) + '&p_order_number=' + enc(order) + '&p_trip_id=' + enc(trip), {}, 120000).catch(function () {})
            .then(function () { return get(TM + '/trip/orders/getsalesorderlines/' + enc(order) + '?P_INSTANCE_NAME=' + enc(pod)); }).then(items);
    }
    var bogoCache = {};
    function bogo(pod) {
        var c = bogoCache[pod];
        if (c && Date.now() - c.at < 12 * 3600000) return Promise.resolve(c.map);
        return get(ORDS + '/ARMODULE/BOGO?p_instance_name=' + enc(pod)).then(function (j) { var map = R.bogoMap(items(j)); bogoCache[pod] = { at: Date.now(), map: map }; return map; }).catch(function () { return (c && c.map) || {}; });
    }
    function orderOf(l) { return String(pick(l, ['SOURCE_ORDER_NUMBER', 'ORDER_NUMBER']) || '').trim(); }
    /** The candidates of a date: trips → lines → the orders with a flagged line, expanded. */
    function candidates(pod, date, say) {
        return Promise.all([tripsOfDate(pod, date), bogo(pod)]).then(function (r) {
            var trips = r[0], bg = r[1], cands = [], n = 0, total = 0, failed = [];
            return pool(trips, 3, function (t) {
                return linesOfTrip(pod, t.trip_id).then(function (rows) {
                    total += rows.length;
                    var by = {}; rows.forEach(function (l) { var o = orderOf(l); if (!o) return; (by[o] = by[o] || []).push(l); });
                    Object.keys(by).forEach(function (o) { if (by[o].some(R.flagged)) cands.push({ trip: t, trip_id: t.trip_id, order_number: o, set: R.expand(by[o], bg) }); });
                }, function (e) { failed.push(t.trip_id + ': ' + (e && e.message || e)); }).then(function () { n++; if (say) say(date + ': order lines of trip ' + n + ' of ' + trips.length); });
            }).then(function () { return { trips: trips, cands: cands, lines: total, failed: failed, bogo: bg }; });
        });
    }
    function planRows(cands) {
        var plan = [];
        cands.forEach(function (c) {
            c.set.lines.forEach(function (x) { plan.push({ trip_id: c.trip_id, order_number: c.order_number, line_number: R.lineNum(x.line), item: R.lineItem(x.line), status: R.lineStatus(x.line), why: x.via + (x.childOf ? ' of line ' + x.childOf : ''), fid: String(R.fid(x.line) || ''), _trip: c.trip }); });
            c.set.skipped.forEach(function (k) { plan.push({ trip_id: c.trip_id, order_number: c.order_number, line_number: R.lineNum(k.line), item: R.lineItem(k.line), status: R.lineStatus(k.line), why: 'skipped: ' + k.reason, fid: String(R.fid(k.line) || ''), _trip: c.trip }); });
            c.set.noId.forEach(function (l) { plan.push({ trip_id: c.trip_id, order_number: c.order_number, line_number: R.lineNum(l), item: R.lineItem(l), status: R.lineStatus(l), why: 'skipped: no fulfillment line id', fid: '', _trip: c.trip }); });
        });
        return plan;
    }
    /** Check (no cancel): the lines that would be cancelled now for the date on screen. */
    function check() {
        if (st.loadingPlan) return Promise.resolve();
        var pod = st.pod, date = st.date;
        st.loadingPlan = true; st.planErr = ''; paintPlan();
        var runId = 'CK' + Date.now().toString(36).toUpperCase(), started = now(), t0 = Date.now();
        return candidates(pod, date, function (t) { A.status = t; paintStatus(); }).then(function (c) {
            if (st.pod !== pod || st.date !== date) return;
            st.plan = planRows(c.cands); st.planAt = now(); st.planTrips = c.trips.length;
            var n = st.plan.filter(function (p) { return p.why.indexOf('skipped') < 0; }).length, orders = c.cands.filter(function (x) { return x.set.lines.length; }).length;
            var text = 'CHECK: ' + n + ' line(s) would be cancelled on ' + orders + ' order(s) · ' + c.trips.length + ' trip(s), ' + c.lines + ' line(s) read' + (c.failed.length ? ' · ' + c.failed.length + ' trip(s) failed' : '');
            A.status = 'Autopilot check (' + pod + '): ' + text + ' · ' + Math.round((Date.now() - t0) / 1000) + ' s';
            st.checks.unshift({ run_id: runId, kind: 'CHECK', trip_date: date, ended_at: now(), text: text, pc: pc(), by_user: user(), ms: String(Date.now() - t0) });
            var sum = { orders: orders, lines: n, done: 0, failed: 0, skipped: st.plan.length - n, nothing: 0, dry: true, dates: [date], notes: c.failed.map(function (f) { return 'trip ' + f; }) };
            DB.put('w2_runs', { pod: pod, run_id: runId }, [{ pod: pod, run_id: runId, kind: 'CHECK', trip_date: date, started_at: started, ended_at: now(), ms: String(Date.now() - t0), summary: JSON.stringify(sum), pc: pc(), by_user: user() }]);
            DB.put('w2_cancel_log', { pod: pod, run_id: runId }, st.plan.map(function (p) { return { pod: pod, run_id: runId, ts: now(), pc: pc(), by_user: user(), trip_date: date, trip_id: p.trip_id, order_number: p.order_number, line_number: p.line_number, item: p.item, status_before: p.status, fulfill_line_id: p.fid, via: p.why.indexOf('skipped') < 0 ? p.why.split(' ')[0] : '', result: p.why.indexOf('skipped') < 0 ? 'WOULD' : 'SKIPPED', message: p.why, response: '' }; }));
        }).catch(function (e) { st.planErr = String(e && e.message || e); A.status = 'Autopilot check failed: ' + st.planErr; })
            .then(function () { st.loadingPlan = false; paint(); });
    }

    // ─── one run ───────────────────────────────────────────────────────────────
    /** opts: {manual, dates} */
    function run(opts) {
        opts = opts || {};
        if (A.running) return A.running;
        if (!R) return Promise.reject(new Error('cancel-rules.js is not loaded'));
        var pod = st.pod, runId = 'AP' + Date.now().toString(36).toUpperCase(), t0 = Date.now(), started = now();
        var sum = { orders: 0, lines: 0, done: 0, failed: 0, skipped: 0, nothing: 0, dry: false, dates: [], notes: [] }, rows = [];
        var label = 'Autopilot run (' + pod + ')';
        A.stopping = false;
        var say = function (t) { A.status = label + ' · ' + t; paintStatus(); };
        say('starting');
        A.running = host({ action: 'aiControlStatus' }, 15000).catch(function () { return null; }).then(function (ctl) {
            if (ctl && ctl.enabled === false) throw new Error('The AI is paused in AI Digital Employee › Control' + (ctl.reason ? ' (' + ctl.reason + ')' : '') + ' — the autopilot does nothing until it is resumed.');
            return lease();
        }).then(function (mine) {
            if (!mine) throw new Error('Another PC is running the autopilot (' + holderText() + ').');
            sum.dates = opts.dates || datesOf(st.settings);
            return gw("SELECT fulfill_line_id, COUNT(*) AS tries FROM wms_w2_cancel_log WHERE pod = " + lit(pod) + " AND result IN ('DONE', 'FAILED') AND logged_at >= SYSDATE - 3 GROUP BY fulfill_line_id", 20000)
                .then(function (tr) { var m = {}; tr.forEach(function (x) { m[String(x.FULFILL_LINE_ID)] = +x.TRIES || 0; }); return m; }).catch(function () { return {}; });
        }).then(function (tries) {
            return sum.dates.reduce(function (p, date) { return p.then(function () { if (!A.stopping) return runDate(date, tries); }); }, Promise.resolve());
        }).then(function () { return finish(null); }, function (e) { return finish(String(e && e.message || e)); });

        function runDate(date, tries) {
            say(date + ': reading the trips');
            return candidates(pod, date, say).then(function (c) {
                c.failed.forEach(function (f) { sum.notes.push('trip ' + f); });
                if (date === st.date) { st.plan = planRows(c.cands); st.planAt = now(); st.planTrips = c.trips.length; paintPlan(); }
                var cands = c.cands.filter(function (x) { return x.set.lines.length || x.set.noId.length; });
                if (!cands.length) { sum.notes.push(date + ': nothing to cancel'); return; }
                var i = 0;
                return cands.reduce(function (p, cnd) {
                    return p.then(function () {
                        if (A.stopping) return;
                        if (sum.lines >= maxLines()) { sum.notes.push('stopped at the limit of ' + maxLines() + ' line(s) per run'); A.stopping = true; return; }
                        say(date + ': order ' + (++i) + ' of ' + cands.length + ' (' + cnd.order_number + ')');
                        return doOrder(date, cnd, c.bogo, tries);
                    });
                }, Promise.resolve());
            });
        }
        function logRow(date, c, x, result, message, response) {
            var l = x.line || x;
            rows.push({ pod: pod, run_id: runId, ts: now(), pc: pc(), by_user: user(), trip_date: date, trip_id: c.trip_id, order_number: c.order_number,
                line_number: R.lineNum(l), item: R.lineItem(l), status_before: R.lineStatus(l), fulfill_line_id: String(R.fid(l) || ''), via: x.via || 'MAIN',
                result: result, message: String(message || '').slice(0, 900), response: response ? String(typeof response === 'string' ? response : JSON.stringify(response)).slice(0, 1800) : '' });
        }
        function doOrder(date, c, bg, tries) {
            sum.orders++;
            return lease().then(function (mine) {
                if (!mine) { A.stopping = true; throw new Error('lost the lease to ' + (st.lease && st.lease.HOLDER)); }
                return liveLines(pod, c.trip_id, c.order_number);
            }).then(function (live) {
                var set = R.expand(live, bg);
                set.noId.forEach(function (l) { logRow(date, c, { line: l, via: 'MAIN' }, 'SKIPPED', 'no fulfillment line id — the WMS line has no FULFILL_LINE_ID'); sum.skipped++; });
                set.skipped.forEach(function (s) { logRow(date, c, { line: s.line, via: s.via }, 'SKIPPED', s.reason); sum.skipped++; });
                var send = set.lines.filter(function (x) {
                    var t = tries[String(R.fid(x.line))] || 0;
                    if (t >= 3) { logRow(date, c, x, 'SKIPPED', 'tried ' + t + ' times already — left for a person (order details)'); sum.skipped++; return false; }
                    return true;
                });
                if (!send.length) { if (!set.lines.length) { sum.nothing++; logRow(date, c, { line: {}, via: '' }, 'NOTHING', 'live re-check: no line to cancel any more'); } return; }
                return fusionPatch(pod, c.order_number, R.body(send)).then(function (res) { return { res: res, err: R.patchError(res) }; }, function (e) { return { res: null, err: String(e && e.message || e) }; }).then(function (out) {
                    if (out.err) { send.forEach(function (x) { logRow(date, c, x, 'FAILED', 'Fusion: ' + out.err, out.res); sum.failed++; sum.lines++; }); return; }
                    return sleep(2500).then(function () { return liveLines(pod, c.trip_id, c.order_number); }).then(function (after) {
                        var nowSt = {}; after.forEach(function (l) { nowSt[String(R.fid(l))] = R.lineStatus(l); });
                        send.forEach(function (x) {
                            var id = String(R.fid(x.line)), s2 = nowSt[id]; sum.lines++;
                            if (s2 != null && !/CANCEL/i.test(s2)) { logRow(date, c, x, 'FAILED', 'still "' + s2 + '" after the cancel', out.res); sum.failed++; }
                            else { logRow(date, c, x, 'DONE', 'cancelled (' + x.via + (x.childOf ? ' of line ' + x.childOf : '') + ') — OUT OF STOCK' + (s2 == null ? ' · line no longer listed' : ''), out.res); sum.done++; }
                        });
                    });
                }).then(function () {
                    var mine = rows.filter(function (r) { return r.order_number === c.order_number; });
                    var ok = mine.filter(function (r) { return r.result === 'DONE'; }).length, bad = mine.filter(function (r) { return r.result === 'FAILED'; }).length;
                    return audit({ actionKey: 'cancel_lines', outcome: bad ? (ok ? 'PARTIAL' : 'FAILED') : 'OK', instance: pod, refId: 'TRIP:' + c.trip_id + ' RUN:' + runId, target: c.order_number, detail: ok + ' line(s) cancelled, ' + bad + ' failed (Scheduled / Manual Reservation, OUT OF STOCK) — WMS autopilot' });
                });
            }).catch(function (e) { sum.notes.push(c.order_number + ': ' + (e && e.message || e)); });
        }
        function finish(err) {
            var ms = Date.now() - t0, ended = now();
            if (err) sum.notes.unshift(err);
            var text = (err ? 'stopped: ' + err + ' · ' : '') + sum.orders + ' order(s), ' + sum.done + ' cancelled, ' + sum.failed + ' failed, ' + sum.skipped + ' skipped';
            var p = rows.length ? pushLog(rows).catch(function (e) { sum.notes.push('APEX log: ' + (e && e.message || e)); }) : Promise.resolve();
            p = p.then(function () {
                return pushLog([{ pod: pod, run_id: runId, pc: pc(), by_user: user(), trip_date: sum.dates.join(','), trip_id: '', order_number: '*', line_number: '', item: '', status_before: '', fulfill_line_id: '', via: '', result: 'RUN', message: text, response: '' }]).catch(function () {});
            });
            return p.then(function () {
                DB.put('w2_runs', { pod: pod, run_id: runId }, [{ pod: pod, run_id: runId, kind: 'AUTOPILOT', trip_date: sum.dates.join(','), started_at: started, ended_at: ended, ms: String(ms), summary: JSON.stringify(sum), pc: pc(), by_user: user() }]);
                DB.put('w2_cancel_log', { pod: pod, run_id: runId }, rows);
                if (!err) release();
                var msg = label + ': ' + (err ? err : sum.done + ' line(s) cancelled' + (sum.failed ? ', ' + sum.failed + ' failed' : '') + (sum.skipped ? ', ' + sum.skipped + ' skipped' : '') + ' on ' + sum.orders + ' order(s)') + ' · ' + Math.round(ms / 1000) + ' s';
                A.status = msg; A.lastRun = { at: ended, msg: msg, err: err, sum: sum };
                A.running = null; A.stopping = false;
                if (opts.manual) note(msg, err || sum.failed ? 'warning' : 'success');
                audit({ actionKey: 'autopilot_run', outcome: err ? 'STOPPED' : sum.failed ? 'PARTIAL' : 'OK', instance: pod, refId: 'RUN:' + runId, target: sum.dates.join(','), detail: text });
                return loadLists().then(paint);
            });
        }
        return A.running;
    }
    /** Ledger rows to APEX (INSERT … SELECT … FROM dual UNION ALL, 20 per statement). */
    function pushLog(rows) {
        var cols = ['run_id', 'pod', 'pc_name', 'app_user', 'trip_date', 'trip_id', 'order_number', 'line_number', 'item', 'status_before', 'fulfill_line_id', 'via', 'result', 'message', 'response'];
        var val = function (r, c) { var v = c === 'pc_name' ? r.pc : c === 'app_user' ? r.by_user : r[c]; return lit(String(v == null ? '' : v).slice(0, c === 'response' ? 1900 : c === 'message' ? 990 : 190)); };
        var chunks = []; for (var i = 0; i < rows.length; i += 20) chunks.push(rows.slice(i, i + 20));
        return ensure().then(function () {
            return chunks.reduce(function (p, ch) {
                return p.then(function () { return gwWrite("INSERT INTO wms_w2_cancel_log (" + cols.join(', ') + ") " + ch.map(function (r) { return "SELECT " + cols.map(function (c) { return val(r, c); }).join(', ') + " FROM dual"; }).join(' UNION ALL ')); });
            }, Promise.resolve());
        });
    }

    // ─── the lists on the page (every PC: from the shared ledger) ─────────────
    function loadLists() {
        var pod = st.pod;
        return ensure().then(function () {
            return Promise.all([
                gw("SELECT COUNT(*) AS n FROM wms_w2_cancel_log WHERE pod = " + lit(pod) + " AND result = 'DONE' AND logged_at >= TRUNC(SYSDATE)", 1),
                gw("SELECT run_id, TO_CHAR(logged_at, 'YYYY-MM-DD HH24:MI') AS at, pc_name, app_user, trip_date, message FROM wms_w2_cancel_log WHERE pod = " + lit(pod) + " AND result = 'RUN' ORDER BY log_id DESC FETCH FIRST 60 ROWS ONLY", 60),
                gw("SELECT TO_CHAR(logged_at, 'YYYY-MM-DD HH24:MI:SS') AS at, run_id, trip_date, trip_id, order_number, line_number, item, status_before, via, result, message, pc_name, app_user FROM wms_w2_cancel_log WHERE pod = " + lit(pod) + " AND result <> 'RUN' AND logged_at >= SYSDATE - 3 ORDER BY log_id DESC FETCH FIRST 3000 ROWS ONLY", 3000),
                readLease()
            ]);
        }).then(function (r) {
            if (st.pod !== pod) return;
            st.lists = { doneToday: +((r[0][0] || {}).N) || 0, runs: r[1], log: r[2] }; st.listsErr = '';
        }).catch(function (e) { st.listsErr = String(e && e.message || e); });
    }

    // ─── timer: run when due (while the WMS is open) ───────────────────────────
    function tick() {
        var s = st.settings;
        if (!s || !s.on || A.running) return;
        if (A.nextAt && Date.now() < A.nextAt) return;
        A.nextAt = Date.now() + (s.every || 45) * 60000;
        run({}).catch(function () {});
    }
    function startTimer() {
        if (startTimer.done) return; startTimer.done = true;
        setTimeout(function () { loadSettings().then(tick); }, 20000);
        setInterval(function () { loadSettings().then(function () { tick(); if (root() && root().style.display !== 'none') paintStatus(); }); }, 60000);
    }

    // ─── UI ────────────────────────────────────────────────────────────────────
    function root() { return document.getElementById(PAGE); }
    function $q(sel) { var r = root(); return r ? r.querySelector(sel) : null; }
    function modal(title, html, buttons) {
        var ov = document.createElement('div'); ov.className = 'ap-ov';
        ov.innerHTML = '<div class="ap-dlg"><h3>' + esc(title) + '</h3><div class="ap-body">' + html + '</div><div class="ap-foot"></div></div>';
        var foot = ov.querySelector('.ap-foot'), close = function () { ov.remove(); };
        (buttons || [{ label: 'Close' }]).forEach(function (b) {
            var e = document.createElement('button'); e.className = 'ap-btn ' + (b.cls || ''); e.innerHTML = b.label;
            e.onclick = function () { if (b.onClick) { if (b.onClick(ov) === false) return; } close(); }; foot.appendChild(e);
        });
        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
        document.body.appendChild(ov);
        var first = ov.querySelector('input'); if (first) first.focus();
        return ov;
    }
    function downloadCsv(name, cols, rows) {
        var q = function (v) { v = String(v == null ? '' : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var text = [cols.map(function (c) { return q(c.t); }).join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c.k]); }).join(','); })).join('\r\n');
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
    /** A table with a filter box per column (contains), the row count, CSV and an optional row click. */
    function grid(el, rows, cols, opts) {
        if (!el) return;
        opts = opts || {}; var f = {}, MAX = opts.max || 500;
        function draw() {
            var shown = rows.filter(function (r) { return cols.every(function (c) { var v = f[c.k]; return !v || String(r[c.k] == null ? '' : r[c.k]).toLowerCase().indexOf(v) >= 0; }); });
            el.innerHTML = '<div class="ap-gridhead"><span class="ap-count">' + shown.length + (shown.length !== rows.length ? ' of ' + rows.length : '') + ' rows</span><span class="grow"></span>' + (opts.csv ? '<button class="ap-btn sm" data-csv><i class="fas fa-file-csv"></i> CSV</button>' : '') + '</div>' +
                '<div class="ap-scroll"><table class="ap-grid"><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c.t) + '</th>'; }).join('') + '</tr><tr class="ap-filters">' + cols.map(function (c) { return '<th><input data-k="' + c.k + '" placeholder="filter" value="' + esc(f[c.k] || '') + '"></th>'; }).join('') + '</tr></thead><tbody>' +
                (shown.length ? shown.slice(0, MAX).map(function (r) { return '<tr' + (opts.onRow ? ' class="click"' : '') + '>' + cols.map(function (c) { var v = r[c.k]; return '<td' + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + (c.fmt ? c.fmt(v, r) : esc(v == null ? '' : v)) + '</td>'; }).join('') + '</tr>'; }).join('')
                    : '<tr><td colspan="' + cols.length + '" class="ap-empty">' + esc(opts.empty || 'Nothing.') + '</td></tr>') + '</tbody></table></div>' +
                (shown.length > MAX ? '<div class="ap-count">first ' + MAX + ' shown — filter to see the rest</div>' : '');
            el.querySelectorAll('.ap-filters input').forEach(function (inp) {
                inp.oninput = function () { f[inp.dataset.k] = inp.value.trim().toLowerCase(); var pos = inp.selectionStart; draw(); var again = el.querySelector('.ap-filters input[data-k="' + inp.dataset.k + '"]'); if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* ok */ } } };
            });
            if (opts.onRow) el.querySelectorAll('tbody tr.click').forEach(function (tr, i) { tr.onclick = function () { opts.onRow(shown[i]); }; });
            var cb = el.querySelector('[data-csv]'); if (cb) cb.onclick = function () { downloadCsv(opts.csv, cols, shown); };
        }
        draw();
    }
    function openTrip(p) {
        var t = p._trip || { trip_id: p.trip_id };
        if (typeof window.openTripDetails !== 'function') return;
        try { window.openTripDetails(t.trip_id, st.date + 'T00:00:00', t.lorry || '', st.pod, t.bay || '', t.priority || ''); if (typeof navigateToPage === 'function') navigateToPage('trip-management'); }
        catch (err) { note('Could not open the trip: ' + err.message, 'error'); }
    }
    function pill(v) { return '<span class="ap-pill ' + (v === 'DONE' ? 'ok' : v === 'FAILED' ? 'x' : v === 'WOULD' ? 'would' : '') + '">' + esc(v) + '</span>'; }

    function paint() {
        var r = root(); if (!r) return;
        if (!R) { r.innerHTML = '<div class="ap"><div class="ap-callout bad">cancel-rules.js did not load — the autopilot cannot tell which lines to cancel.</div></div>'; return; }
        var s = st.settings || Object.assign({}, DEFAULTS, { pod: st.pod }), L = st.lists, pod = st.pod;
        var dates = [s.today && 'today', s.tomorrow && 'tomorrow'].filter(Boolean).join(' and ') || 'no date';
        var h = '<div class="ap">' +
            '<div class="ap-head"><h2><i class="fas fa-robot"></i> Cancellation autopilot · ' + esc(pod) + '</h2>' +
            '<label class="ap-row"><span class="sm muted">Instance</span><select id="ap-pod">' + ['PROD', 'TEST'].map(function (p) { return '<option' + (p === pod ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select></label>' +
            '<span class="grow"></span><label class="ap-switch" title="Switch the autopilot on or off for ' + esc(pod) + ' — shared with WMS 2.0"><input type="checkbox" id="ap-on"' + (s.on ? ' checked' : '') + '><span class="sl"></span><span id="ap-on-lbl">' + (s.on ? 'ON' : 'OFF') + '</span></label></div>' +
            (s.error ? '<div class="ap-callout bad">Could not read the autopilot settings from APEX: ' + esc(s.error) + '</div>' : '') +
            '<div class="ap-callout ' + (s.on ? 'good' : '') + '">' + (s.on ? '<b>On</b> — every ' + s.every + ' min it cancels Scheduled / Manual Reservation lines on the trips of ' + dates + ', with the Shipping Agent\'s rules (sub-lines, BOGO items), from whichever PC holds the lease — this WMS or WMS 2.0. Switched on by ' + esc(s.by || '?') + ' ' + esc(s.at || '') + (s.reason ? ' — ' + esc(s.reason) : '') + '.'
                : '<b>Off</b> — nothing is cancelled automatically on ' + esc(pod) + '. Switch it on to cancel the lines the Shipping Agent cancels, with no approval card; the same switch serves WMS 2.0.') +
            ' A main line in <b>Awaiting Shipping</b> is never cancelled by the autopilot (open the order details to cancel it by hand); a sub-line / BOGO item in Awaiting Shipping is cancelled together with its Scheduled / Manual Reservation main line. Each order is read live just before the cancel and checked after it. The AI kill switch stops it.</div>' +
            '<div class="ap-grid3">' +
            '<div class="ap-card"><h3>Status</h3><div class="ap-row"><span class="ap-pill ' + (s.on ? 'on' : '') + '"><i class="fas fa-power-off"></i> ' + (s.on ? 'ON — every ' + s.every + ' min' : 'OFF') + '</span>' + (A.running ? '<span class="ap-pill run"><i class="fas fa-circle-notch fa-spin"></i> running</span>' : '') +
            '<span class="sm"><b>' + (L ? L.doneToday : '…') + '</b> line(s) cancelled today</span></div>' +
            '<div class="sm muted" style="margin-top:6px" id="ap-last">' + lastRunText() + '</div>' +
            (s.on && A.nextAt && !A.running ? '<div class="sm muted">Next run from this PC about ' + new Date(A.nextAt).toLocaleTimeString() + '</div>' : '') +
            '<div class="ap-status" id="ap-status">' + esc(A.status || '') + '</div>' +
            '<div class="xs muted" style="margin-top:4px">' + (st.lease ? 'Lease: ' + esc(st.lease.HOLDER) + ' until ' + esc(st.lease.UNTIL) : 'Lease: not taken yet') + ' · this PC: ' + esc(me()) + '</div>' +
            '<div class="ap-row" style="margin-top:10px"><button class="ap-btn" id="ap-check"' + (st.loadingPlan ? ' disabled' : '') + '><i class="fas fa-search"></i> Check (no cancel)</button>' +
            (A.running ? '<button class="ap-btn" id="ap-stop"><i class="fas fa-stop"></i> Stop after this order</button>' : '<button class="ap-btn danger" id="ap-run"><i class="fas fa-play"></i> Run now</button>') + '</div></div>' +
            '<div class="ap-card"><h3>Settings <small>shared by every PC and WMS 2.0</small></h3><div class="ap-stack sm">' +
            '<label class="ap-row">Run every <select id="ap-every">' + EVERY.map(function (n) { return '<option' + (n == s.every ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select> minutes</label>' +
            '<label class="ap-row"><input type="checkbox" id="ap-today"' + (s.today ? ' checked' : '') + '> trips dated today</label><label class="ap-row"><input type="checkbox" id="ap-tom"' + (s.tomorrow ? ' checked' : '') + '> trips dated tomorrow</label>' +
            '<label class="ap-row">Stop a run after <input id="ap-max" type="number" min="10" max="5000" value="' + (s.maxLines || 300) + '" style="width:80px"> lines (safety)</label>' +
            '<div><button class="ap-btn" id="ap-save"><i class="fas fa-save"></i> Save settings</button></div></div></div>' +
            '<div class="ap-card"><h3>Trip date <small>what the check looks at</small></h3><div class="ap-row" style="margin-bottom:10px"><button class="ap-btn sm ap-nav" id="ap-prev" title="The day before">&lsaquo;</button><span class="ap-days"><button data-d="' + today() + '"' + (st.date === today() ? ' class="on"' : '') + '>Today</button><button data-d="' + addDays(today(), 1) + '"' + (st.date === addDays(today(), 1) ? ' class="on"' : '') + '>Tomorrow</button></span><button class="ap-btn sm ap-nav" id="ap-next" title="The day after">&rsaquo;</button><input type="date" id="ap-date" class="ap-date" value="' + esc(st.date) + '" title="Pick any trip date"><span class="sm muted">' + esc(dayName(st.date)) + '</span></div>' +
            '<div class="ap-kpis"><div class="ap-kpi"><span class="l">Lines to cancel</span><span class="n">' + (st.plan ? st.plan.filter(function (p) { return p.why.indexOf('skipped') < 0; }).length : '–') + '</span><span class="s">' + (st.plan ? 'on ' + uniq(st.plan.filter(function (p) { return p.why.indexOf('skipped') < 0; }), 'order_number') + ' order(s) · ' + st.planTrips + ' trip(s)' : 'press Check') + '</span></div>' +
            '<div class="ap-kpi"><span class="l">Cancelled today</span><span class="n">' + (L ? L.doneToday : '–') + '</span><span class="s">all PCs</span></div></div></div></div>' +
            '<div class="ap-card"><h3>Would be cancelled now · ' + esc(dayName(st.date)) + ' <small>Scheduled / Manual Reservation lines + their sub-lines / BOGO items' + (st.planAt ? ', read ' + esc(ago(st.planAt)) : '') + '</small><span class="grow"></span><button class="ap-btn sm" id="ap-check2"' + (st.loadingPlan ? ' disabled' : '') + '><i class="fas fa-sync"></i> Read order lines again</button></h3><div id="ap-plan"></div></div>' +
            '<div class="ap-card"><h3>Runs <small>every PC, from the shared ledger</small></h3><div id="ap-runs"></div></div>' +
            '<div class="ap-card"><h3>Cancelled lines <small>every PC, last 3 days</small></h3>' + (st.listsErr ? '<div class="ap-callout bad">' + esc(st.listsErr) + '</div>' : '') + '<div id="ap-log"></div></div>' +
            '</div>';
        r.innerHTML = h;
        wire();
        paintPlan(); paintLists();
    }
    function uniq(rows, k) { var s = {}; rows.forEach(function (x) { s[x[k]] = 1; }); return Object.keys(s).length; }
    function lastRunText() {
        if (A.lastRun) return esc(A.lastRun.msg);
        var L = st.lists; if (!L) return 'Loading…';
        var last = L.runs && L.runs[0];
        return last ? 'Last run ' + esc(ago(last.AT)) + (last.PC_NAME ? ' on ' + esc(last.PC_NAME) : '') + ': ' + esc(last.MESSAGE || '') : 'No run yet.';
    }
    function paintStatus() {
        var el = $q('#ap-status'); if (el) el.textContent = A.status || '';
        var last = $q('#ap-last'); if (last) last.innerHTML = lastRunText();
    }
    function paintPlan() {
        var el = $q('#ap-plan'); if (!el) return;
        if (st.loadingPlan) { el.innerHTML = '<div class="ap-empty"><i class="fas fa-circle-notch fa-spin"></i> Reading the trips of ' + esc(dayName(st.date)) + '… <span class="muted">' + esc(A.status || '') + '</span></div>'; return; }
        if (st.planErr) { el.innerHTML = '<div class="ap-callout bad">' + esc(st.planErr) + '</div>'; return; }
        if (!st.plan) { el.innerHTML = '<div class="ap-empty">Press <b>Check (no cancel)</b> to see what would be cancelled now.</div>'; return; }
        grid(el, st.plan, [{ k: 'trip_id', t: 'Trip' }, { k: 'order_number', t: 'Order', fmt: function (v) { return '<b class="mono">' + esc(v) + '</b>'; } }, { k: 'line_number', t: 'Line' }, { k: 'item', t: 'Item' }, { k: 'status', t: 'Status' }, { k: 'why', t: 'Why', cls: 'msg' }, { k: 'fid', t: 'Fulfill line id' }],
            { empty: 'Nothing to cancel on ' + dayName(st.date) + '.', csv: 'to-cancel-' + st.date + '.csv', onRow: openTrip });
    }
    function paintLists() {
        var L = st.lists || { runs: [], log: [] };
        var runs = st.checks.map(function (c) { return { at: c.ended_at.replace('T', ' ').slice(0, 16), kind: c.kind, trip_date: c.trip_date, text: c.text, pc: c.pc, by_user: c.by_user }; })
            .concat((L.runs || []).map(function (x) { return { at: x.AT, kind: 'AUTOPILOT', trip_date: x.TRIP_DATE, text: x.MESSAGE, pc: x.PC_NAME, by_user: x.APP_USER, run_id: x.RUN_ID }; }))
            .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
        grid($q('#ap-runs'), runs, [{ k: 'at', t: 'When' }, { k: 'kind', t: 'Kind' }, { k: 'trip_date', t: 'Trip dates' }, { k: 'text', t: 'Result', cls: 'msg' }, { k: 'pc', t: 'PC' }, { k: 'by_user', t: 'User' }], { empty: 'No run yet.', max: 100 });
        var log = (L.log || []).map(function (x) { return { at: x.AT, result: x.RESULT, trip_id: x.TRIP_ID, order_number: x.ORDER_NUMBER, line_number: x.LINE_NUMBER, item: x.ITEM, status_before: x.STATUS_BEFORE, via: x.VIA, message: x.MESSAGE, pc: x.PC_NAME, by_user: x.APP_USER, run_id: x.RUN_ID, trip_date: x.TRIP_DATE }; });
        grid($q('#ap-log'), log, [{ k: 'at', t: 'When' }, { k: 'result', t: 'Result', fmt: pill }, { k: 'trip_id', t: 'Trip' }, { k: 'order_number', t: 'Order', fmt: function (v) { return '<b class="mono">' + esc(v) + '</b>'; } }, { k: 'line_number', t: 'Line' }, { k: 'item', t: 'Item' }, { k: 'status_before', t: 'Was' }, { k: 'via', t: 'Why' }, { k: 'message', t: 'Message', cls: 'msg' }, { k: 'pc', t: 'PC' }, { k: 'run_id', t: 'Run' }],
            { empty: 'Nothing cancelled in the last 3 days.', csv: 'autopilot-log.csv' });
    }
    function wire() {
        var s = st.settings || DEFAULTS;
        $q('#ap-pod').onchange = function () { st.pod = this.value; ls('wms.ap.pod', st.pod); st.plan = null; st.planAt = null; st.lists = null; st.lease = null; st.checks = []; A.nextAt = null; paint(); refresh(); };
        root().querySelectorAll('.ap-days button').forEach(function (b) { b.onclick = function () { st.date = b.dataset.d; st.plan = null; st.planAt = null; paint(); }; });
        var setDate = function (d) { if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return; st.date = d; st.plan = null; st.planAt = null; paint(); };
        $q('#ap-date').onchange = function () { setDate(this.value); };
        $q('#ap-prev').onclick = function () { setDate(addDays(st.date, -1)); };
        $q('#ap-next').onclick = function () { setDate(addDays(st.date, 1)); };
        $q('#ap-on').onchange = function () {
            var on = this.checked, box = this, pod = st.pod;
            modal(on ? 'Switch the autopilot ON for ' + pod : 'Switch the autopilot OFF for ' + pod,
                '<p>' + (on ? 'Every ' + s.every + ' minutes, Scheduled and Manual Reservation lines on the trips of ' + ([s.today && 'today', s.tomorrow && 'tomorrow'].filter(Boolean).join(' and ') || 'no date') + ' are cancelled in Oracle Fusion (OrderedQuantity 0, reason OUT OF STOCK) — with their sub-lines / BOGO items — <b>without an approval card</b>, like the Shipping Agent did. It runs from any PC with the WMS or WMS 2.0 open on ' + pod + ', one PC at a time.' : 'Nothing will be cancelled automatically any more on ' + pod + ' — in the WMS and in WMS 2.0.') + '</p>' +
                '<label class="sm">Reason (kept with the change)<input type="text" id="ap-why" placeholder="' + (on ? 'e.g. replaces the Shipping Agent for trips' : 'e.g. stock count today') + '"></label>',
                [{ label: 'Cancel', onClick: function () { box.checked = !on; } }, { label: on ? 'Switch ON' : 'Switch OFF', cls: on ? 'danger' : 'primary', onClick: function (ov) {
                    var why = (ov.querySelector('#ap-why').value || '').trim();
                    if (!why) { note('Give a reason.', 'warning'); return false; }
                    setOn(on, why).then(function () { note('Autopilot ' + (on ? 'ON' : 'OFF') + ' for ' + pod + '.', 'success'); paint(); }, function (e) { note('Could not save: ' + (e && e.message || e), 'error'); box.checked = !on; });
                } }]);
        };
        $q('#ap-save').onclick = function () {
            saveOptions({ every: +$q('#ap-every').value, today: $q('#ap-today').checked, tomorrow: $q('#ap-tom').checked, maxLines: Math.max(10, +$q('#ap-max').value || 300) })
                .then(function () { note('Autopilot settings saved.', 'success'); paint(); }, function (e) { note('Could not save: ' + (e && e.message || e), 'error'); });
        };
        var ck = function () { check(); }; $q('#ap-check').onclick = ck; $q('#ap-check2').onclick = ck;
        var runBtn = $q('#ap-run');
        if (runBtn) runBtn.onclick = function () {
            modal('Run the autopilot now', '<p>Cancel the Scheduled / Manual Reservation lines of <b>' + esc(dayName(st.date)) + '</b> (' + esc(st.pod) + ') in Oracle Fusion now — each order is read live first and checked after. No approval card.</p>',
                [{ label: 'Cancel' }, { label: '<i class="fas fa-play"></i> Run now', cls: 'danger', onClick: function () { run({ manual: true, dates: [st.date] }).catch(function (e) { note(String(e && e.message || e), 'error'); }); paint(); } }]);
        };
        var stopBtn = $q('#ap-stop'); if (stopBtn) stopBtn.onclick = function () { A.stopping = true; A.status = 'Stopping after the order in hand…'; paintStatus(); };
    }
    function refresh() { return Promise.all([loadSettings(), loadLists()]).then(paint); }

    // ─── page plumbing ─────────────────────────────────────────────────────────
    // the toolbar's trip date moves the Trip date card too (not while a run is going)
    (function () { var reg = function () { if (window.wmsTripDate) window.wmsTripDate.on(function (d) { if (A.running || st.date === d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return; st.date = d; st.plan = null; st.planAt = null; if (st.pod && root()) paint(); }); }; if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reg); else reg(); })();
    var AP = window.WmsAutopilot = {
        onShow: function () {
            if (!st.pod) st.pod = ls('wms.ap.pod') || (document.getElementById('trip-instance-name') || {}).value || (function () { try { return localStorage.getItem('fusionInstance'); } catch (e) { return null; } })() || 'PROD';
            if (!st.date) st.date = window.wmsTripDate ? window.wmsTripDate.get() : addDays(today(), 1);   // the trip date chosen when the WMS opened
            paint();
            DB.probe();
            refresh();
        },
        check: check, run: run, state: st, live: A, settings: function () { return st.settings; }, lease: lease, candidates: candidates
    };
    function hook() {
        var orig = window.navigateToPage;
        if (typeof orig !== 'function' || orig.__ap) return false;
        var w = function (pageId) { var r = orig.apply(this, arguments); if (pageId === PAGE) AP.onShow(); return r; };
        w.__ap = true; window.navigateToPage = w;
        return true;
    }
    if (!hook()) document.addEventListener('DOMContentLoaded', function () { setTimeout(hook, 0); });
    document.addEventListener('DOMContentLoaded', function () {
        startTimer();
        setTimeout(function () { var r = root(); if (r && r.style.display !== 'none' && (location.hash === '#' + PAGE || new URLSearchParams(location.search).get('page') === PAGE)) AP.onShow(); }, 400);
    });
    if (!st.pod) { try { st.pod = ls('wms.ap.pod') || localStorage.getItem('fusionInstance') || 'PROD'; } catch (e) { st.pod = 'PROD'; } }
    window.addEventListener('beforeunload', function (e) { if (A.running) { e.preventDefault(); e.returnValue = 'The cancellation autopilot is running — closing stops it after the order in hand.'; return e.returnValue; } });
})();
