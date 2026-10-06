/* WMS 2.0 — sync: reads one trip date from the same sources the WMS module uses and writes every answer into DuckDB.
   Steps (each one is saved as soon as it is read; one failing step does not stop the others):
     trips        WAREHOUSEMANAGEMENT/GETTRIPDETAILS?P_DATE_FROM&P_DATE_TO&P_INSTANCE_NAME      → w2_trips      (pod, trip_date)
     lines        WAREHOUSEMANAGEMENT/GETTRIPDETAILS/ALL?P_FROM_DATE&P_TO_DATE (one row per line) → w2_trip_lines (trip_date)
     pickers      wms_picker_assignment (AI gateway) for the date's orders                         → w2_picker     (trip_date)
     print        wms_print_jobs (AI gateway) for the date                                         → w2_print      (trip_date)
     shipment     Fusion REST shipmentLines?q=Order=… per order (like the Shipping Agent), only orders not yet interfaced on a quick refresh
                  → w2_ship_lines + w2_ship_checked (order_number)
     orderlines   TRIPMANAGEMENT/trip/orders/getsalesorderlinesbytrip/{trip} (WMS order lines, what the agent cancels from) → w2_order_lines (trip_id)
     mra          wms_mra_interface_config + the MRA check report (omBip MRA_TRX_NO_CHECK_BIP) for interfaced orders → w2_mra_flag, w2_mra
     pending      WAREHOUSEMANAGEMENT/getpendingshipmentlines (POST)                               → w2_pending    (pod)
     masters      pickers/getpickers, ARMODULE/BOGO                                                → w2_pickers, w2_bogo
   A quick refresh (the timer, Refresh) skips masters / pending / order lines when they are recent. */
(function () {
    'use strict';
    var W2 = window.W2;
    var S = W2.sync = { running: null, log: [] };
    S.settings = function () {
        return Object.assign({ autoMin: 3, shipPool: 6, org: 'GRAYS INC', pendingDays: 30, mraCheck: true, shipMode: 'rest' }, W2.ls('w2.sync') || {});
    };

    S.lastInfo = function (date) {
        date = date || W2.date();
        return W2.q("SELECT ts, ms, kind FROM w2_sync_runs WHERE pod = " + W2.lit(W2.pod()) + " AND trip_date = " + W2.lit(date) + " ORDER BY ts DESC LIMIT 1")
            .then(function (r) { return r[0] || null; }).catch(function () { return null; });
    };

    var timer = null;
    /** Called on start / date or instance change: syncs when the copy of this date is missing or old, and keeps a timer. */
    S.ensureFresh = function () {
        S.lastInfo().then(function (info) {
            W2.paintSync(info);
            var age = info ? (Date.now() - new Date(String(info.ts).replace(' ', 'T')).getTime()) / 60000 : Infinity;
            if (!S.running && age > S.settings().autoMin) S.day(W2.date(), { full: !info, auto: true });
        });
        clearInterval(timer);
        timer = setInterval(function () {
            if (document.hidden || S.running) return;
            S.lastInfo().then(function (info) {
                var age = info ? (Date.now() - new Date(String(info.ts).replace(' ', 'T')).getTime()) / 60000 : Infinity;
                if (age >= S.settings().autoMin) S.day(W2.date(), { auto: true });
            });
        }, 30000);
    };

    function note(kind, text) { S.log.unshift({ at: new Date().toLocaleTimeString(), kind: kind, text: text }); S.log = S.log.slice(0, 300); W2.emit('synclog'); }

    /** Sync one trip date. opts: {full, auto, only: ['trips', …]} */
    S.day = function (date, opts) {
        opts = opts || {};
        if (S.running) { if (!opts.auto) W2.toast('A refresh is already running.', 'info'); return S.running; }
        var pod = W2.pod(), t0 = Date.now(), steps = [], ctx = { pod: pod, date: date, orders: [], trips: [] };
        W2.stopping = false;
        var want = function (s) { return !opts.only || opts.only.indexOf(s) >= 0; };
        var label = (opts.full ? 'Full refresh' : 'Refresh') + ' of ' + W2.dayName(date) + ' (' + date + ', ' + pod + ')';
        // the first read of a date shows the banner too: an empty screen with a silent sync behind it looks like "no data"
        var loud = !opts.auto || opts.full;
        if (loud) W2.busy.start(label + ' …', function () { W2.stopping = true; W2.busy.step('Stopping after the current step…'); });
        S.current = { date: date, pod: pod, label: label, step: '', t0: t0, steps: steps };
        note('start', label);
        function step(name, fn) {
            return function () {
                if (W2.stopping) return;
                S.current.step = name; W2.paintSync(); W2.emit('syncstep', name);
                var s0 = Date.now(); if (loud) W2.busy.step(label + ' · ' + name + ' …');
                return Promise.resolve().then(fn).then(function (msg) {
                    steps.push({ step: name, ok: true, ms: Date.now() - s0, msg: msg || '' }); note('ok', name + ': ' + (msg || 'done') + ' (' + ((Date.now() - s0) / 1000).toFixed(1) + ' s)');
                    // trips + lines are in DuckDB: draw the screen now, the slower steps (Fusion, MRA) fill it in later
                    if (name === 'lines' && date === W2.date() && pod === W2.pod()) W2.render();
                }, function (e) {
                    var m = String(e && e.message || e);
                    steps.push({ step: name, ok: false, ms: Date.now() - s0, msg: m }); note('err', name + ': ' + m);
                });
            };
        }
        var chain = Promise.resolve();
        [
            ['trips', function () { return S.trips(ctx); }],
            ['lines', function () { return S.lines(ctx); }],
            ['pickers', function () { return S.pickers(ctx); }],
            ['print', function () { return S.print(ctx); }],
            ['shipment', function () { return S.shipment(ctx, opts.full); }],
            ['orderlines', function () { return opts.full || opts.only ? S.orderLines(ctx) : S.orderLinesIfOld(ctx); }],
            ['mra', function () { return S.mra(ctx); }],
            ['pending', function () { return opts.full || opts.only ? S.pending(ctx) : S.ifOld('w2_pending', 30, function () { return S.pending(ctx); }); }],
            ['masters', function () { return opts.full || opts.only ? S.masters(ctx) : S.ifOld('w2_pickers', 720, function () { return S.masters(ctx); }); }]
        ].forEach(function (s) { if (want(s[0])) chain = chain.then(step(s[0], s[1])); });
        S.running = chain.then(function () {
            var ms = Date.now() - t0, bad = steps.filter(function (s) { return !s.ok; });
            return W2.put('w2_sync_runs', { pod: pod, trip_date: date, kind: opts.full ? 'FULL' : 'QUICK' }, [{ pod: pod, trip_date: date, kind: opts.full ? 'FULL' : 'QUICK', ts: W2.now(), ms: String(ms), steps: JSON.stringify(steps) }]).then(function () {
                var msg = label + ' done in ' + (ms / 1000).toFixed(1) + ' s' + (bad.length ? ' — ' + bad.length + ' step(s) failed: ' + bad.map(function (b) { return b.step; }).join(', ') : '') + (W2.stopping ? ' (stopped)' : '');
                if (loud || bad.length) W2.busy.done(msg, bad.length > 0);
                note(bad.length ? 'warn' : 'ok', msg);
                return { steps: steps, ms: ms };
            });
        }).catch(function (e) {
            W2.busy.done(label + ' failed: ' + e, true);
            steps.push({ step: 'save', ok: false, ms: 0, msg: String(e && e.message || e) });
        }).then(function (r) {
            S.lastRun = { date: date, pod: pod, steps: steps, ms: Date.now() - t0, ts: W2.now() };
            S.running = null; S.current = null; W2.stopping = false;
            S.lastInfo(date).then(W2.paintSync);
            if (date === W2.date() && pod === W2.pod()) { W2.emit('synced', date); W2.render(); }
            return r;
        });
        return S.running;
    };

    /** Runs fn only when the table was not written for `mins` minutes (scope-less tables). */
    S.ifOld = function (table, mins, fn) {
        return W2.call('w2Status', {}).then(function (st) {
            var t = (st && st.tables || []).filter(function (x) { return x.table === table; })[0];
            var age = t && t.lastWrite ? (Date.now() - new Date(t.lastWrite).getTime()) / 60000 : Infinity;
            if (age < mins && t.rows > 0) return 'kept (read ' + Math.round(age) + ' min ago)';
            return fn();
        });
    };

    // ── trips (one row per trip) ──────────────────────────────
    S.trips = function (ctx) {
        var url = W2.ORDS + '/WAREHOUSEMANAGEMENT/GETTRIPDETAILS?P_DATE_FROM=' + W2.dmy(ctx.date) + '&P_DATE_TO=' + W2.dmy(ctx.date) + '&P_INSTANCE_NAME=' + ctx.pod;
        return W2.get(url).then(function (j) {
            var seen = {}, rows = [];
            W2.items(j).forEach(function (r) {
                var id = W2.pick(r, ['TRIP_ID', 'TRIPID', 'TRIP_NUMBER', 'TRIP_NO'], /trip.?(id|num|no)/i); if (id == null) return;
                id = String(id); if (seen[id]) return; seen[id] = 1;
                var o = W2.norm(r, true);
                o.pod = ctx.pod; o.trip_date = ctx.date; o.trip_id = id;
                o.lorry = W2.pick(r, ['TRIP_LORRY', 'LORRY_NUMBER', 'LORRY_NAME', 'LORRY'], /lorry/i) || '';
                o.loading_bay = W2.pick(r, ['LOADING_BAY'], /bay/i) || '';
                o.priority = W2.pick(r, ['TRIP_PRIORITY', 'PRIORITY'], /priority/i) || '';
                o.picker = W2.pick(r, ['PICKER_NAME', 'PICKER'], /picker/i) || '';
                o.order_count = W2.pick(r, ['ORDER_COUNT', 'TOTAL_ORDERS', 'NO_OF_ORDERS'], /order.?(count|cnt)|total.?orders/i) || '';
                rows.push(o);
            });
            ctx.trips = rows.map(function (r) { return r.trip_id; });
            return W2.put('w2_trips', { pod: ctx.pod, trip_date: ctx.date }, rows).then(function () { return rows.length + ' trip(s)'; });
        });
    };

    // ── order lines on the trips (one row per line) ───────────
    S.lines = function (ctx) {
        var url = W2.ORDS + '/WAREHOUSEMANAGEMENT/GETTRIPDETAILS/ALL?P_FROM_DATE=' + ctx.date + '&P_TO_DATE=' + ctx.date;
        return W2.get(url, 180000).then(function (j) {
            var mine = {}; ctx.trips.forEach(function (t) { mine[t] = 1; });
            var rows = [];
            W2.items(j).forEach(function (r) {
                var trip = W2.pick(r, ['TRIP_ID', 'TRIPID', 'TRIP_NUMBER'], /trip.?(id|num|no)/i);
                var inst = String(W2.pick(r, ['INSTANCE_NAME', 'INSTANCE'], null) || '').toUpperCase();
                // the ALL endpoint has every instance: keep this instance's trips (by instance column, else by the trips list)
                if (inst ? inst !== ctx.pod : (ctx.trips.length && !mine[String(trip)])) return;
                var o = W2.norm(r, true);
                o.pod = ctx.pod; o.trip_date = ctx.date; o.trip_id = trip == null ? '' : String(trip);
                o.order_number = String(W2.pick(r, ['ORDER_NUMBER', 'SOURCE_ORDER_NUMBER', 'ORDERNUMBER'], /order.?(num|no)/i) || '').trim();
                o.order_type = W2.pick(r, ['ORDER_TYPE', 'ORDER_TYPE_CODE'], null) || '';
                o.account_number = W2.pick(r, ['ACCOUNT_NUMBER'], null) || '';
                o.account_name = W2.pick(r, ['ACCOUNT_NAME', 'CUSTOMER_NAME'], null) || '';
                o.picker = W2.pick(r, ['PICKER', 'PICKER_NAME'], null) || '';
                o.pick_confirm_st = W2.pick(r, ['PICK_CONFIRM_ST'], null) || '';
                o.lorry = W2.pick(r, ['LORRY_NUMBER', 'TRIP_LORRY'], /lorry/i) || '';
                o.line_status = W2.pick(r, ['LINE_STATUS', 'STATUS'], null) || '';
                o.instance_name = inst || ctx.pod;
                if (o.order_number) rows.push(o);
            });
            ctx.orders = Array.from(new Set(rows.map(function (r) { return r.order_number; })));
            if (!ctx.trips.length) ctx.trips = Array.from(new Set(rows.map(function (r) { return r.trip_id; })));
            return W2.put('w2_trip_lines', { pod: ctx.pod, trip_date: ctx.date }, rows).then(function () { return ctx.orders.length + ' order(s), ' + rows.length + ' line(s)'; });
        });
    };

    function ordersOfDate(ctx) {
        if (ctx.orders.length) return Promise.resolve(ctx.orders);
        return W2.q("SELECT DISTINCT order_number FROM w2_trip_lines WHERE pod = " + W2.lit(ctx.pod) + " AND trip_date = " + W2.lit(ctx.date)).then(function (r) { ctx.orders = r.map(function (x) { return x.order_number; }); return ctx.orders; });
    }
    function inList(list) { return list.map(W2.lit).join(', '); }

    // ── picker assignments (wms_picker_assignment) ────────────
    S.pickers = function (ctx) {
        return ordersOfDate(ctx).then(function (orders) {
            if (!orders.length) return W2.put('w2_picker', { trip_date: ctx.date }, []).then(function () { return 'no orders'; });
            var all = [];
            return W2.chunks(orders, 300).reduce(function (p, ch) {
                return p.then(function () {
                    return W2.apexRows("SELECT TRIM(source_order_number) AS order_number, picker_name, loading_bay, instance, TO_CHAR(picker_assignment_date, 'YYYY-MM-DD HH24:MI') AS assigned_at, pickslip, pickwave " +
                        "FROM wms_picker_assignment WHERE TRIM(source_order_number) IN (" + inList(ch) + ")", 5000).then(function (r) { all = all.concat(r); });
                });
            }, Promise.resolve()).then(function () {
                var rows = all.map(function (r) { var o = W2.norm(r); o.trip_date = ctx.date; return o; });
                return W2.put('w2_picker', { trip_date: ctx.date }, rows).then(function () { return rows.length + ' assignment(s)'; });
            });
        });
    };

    // ── print jobs (wms_print_jobs) ───────────────────────────
    S.print = function (ctx) {
        return W2.apexRows("SELECT order_number, trip_id, TO_CHAR(trip_date, 'YYYY-MM-DD') AS trip_date, customer_name, download_status, print_status, overall_status, retry_count, " +
            "SUBSTR(error_message, 1, 300) AS error_message, TO_CHAR(print_completed, 'YYYY-MM-DD HH24:MI') AS print_completed, TO_CHAR(NVL(modified_date, created_date), 'YYYY-MM-DD HH24:MI') AS changed " +
            "FROM wms_print_jobs WHERE trip_date >= TO_DATE(" + W2.lit(ctx.date) + ", 'YYYY-MM-DD') AND trip_date < TO_DATE(" + W2.lit(ctx.date) + ", 'YYYY-MM-DD') + 1", 20000).then(function (r) {
            var rows = r.map(function (x) { var o = W2.norm(x); o.trip_date = ctx.date; o.order_number = String(o.order_number || '').trim(); return o; });
            return W2.put('w2_print', { trip_date: ctx.date }, rows).then(function () { return rows.length + ' print job(s)'; });
        });
    };

    // ── shipment lines from Fusion (the agent's buckets) ──────
    /** Same rules as the Shipping Agent (saFetchOrderStatus): LineStatusCode / LineStatus → one bucket per line. */
    S.bucket = function (l) {
        var lsc = String(l.LineStatusCode || '').toUpperCase().trim(), ls = String(l.LineStatus || l.LineStatusCode || '').toUpperCase().trim();
        if (lsc === 'Y' || ls.indexOf('INTERFACED') >= 0 || ls.indexOf('PENDING INVENTORY') >= 0 || ls.indexOf('SHIPPED') >= 0) return 'INTERFACED';
        if (lsc === 'C' || ls.indexOf('STAGED') >= 0) return 'STAGED';
        if (lsc === 'X' || ls.indexOf('CANCEL') >= 0) return 'CANCELLED';
        if (ls.indexOf('RELEASED TO WAREHOUSE') >= 0 || ls.indexOf('RELEASED') >= 0) return 'RELEASED';
        if (ls.indexOf('READY') >= 0) return 'READY';
        return 'OTHER';
    };
    S.shipOne = function (pod, date, order) {
        var url = W2.fusionUrl('/fscmRestApi/resources/11.13.18.05/shipmentLines?q=Order=' + encodeURIComponent(order) + '&limit=500', pod);
        return W2.fusionGet(url, pod).then(function (j) {
            var items = (j && j.items) || [];
            if (j && !j.items && (j.ReturnStatus === 'Error' || j.title || j.status)) throw (j.ErrorExplanation || j.detail || j.title || 'Fusion error');
            return items.map(function (l) {
                return { pod: pod, trip_date: date, order_number: order, line: String(l.OrderLineNumber || l.LineNumber || l.SourceLineNumber || l.ShipmentLine || ''), item: l.Item || l.ItemNumber || '',
                    line_status: l.LineStatus || '', line_status_code: l.LineStatusCode || '', bucket: S.bucket(l), requested_qty: String(l.RequestedQuantity || 0), staged_qty: String(l.StagedQuantity || 0),
                    shipped_qty: String(l.ShippedQuantity || 0), shipment_line: String(l.ShipmentLine || ''), shipment: l.Shipment == null ? '' : String(l.Shipment), fulfill_line_id: String(l.FulfillmentLineId || l.SourceShipmentId || '') };
            });
        });
    };
    S.shipment = function (ctx, full) {
        return ordersOfDate(ctx).then(function (orders) {
            if (!orders.length) return 'no orders';
            // a quick refresh skips orders already fully interfaced or cancelled (that is final)
            var p = full ? Promise.resolve(orders) : W2.q("SELECT order_number FROM w2_ship_lines WHERE pod = " + W2.lit(ctx.pod) + " AND trip_date = " + W2.lit(ctx.date) +
                " GROUP BY 1 HAVING COUNT(*) > 0 AND SUM(CASE WHEN bucket IN ('INTERFACED', 'CANCELLED') THEN 1 ELSE 0 END) = COUNT(*)").then(function (done) {
                    var d = {}; done.forEach(function (x) { d[x.order_number] = 1; }); return orders.filter(function (o) { return !d[o]; });
                });
            return p.then(function (todo) {
                if (!todo.length) return 'all orders already interfaced';
                var buf = [], checked = [], n = 0, failed = 0;
                var flush = function () {
                    if (!checked.length) return Promise.resolve();
                    var ords = checked.map(function (c) { return c.order_number; }), rows = buf.splice(0), ck = checked.splice(0);
                    return W2.put('w2_ship_lines', { pod: ctx.pod, order_number: ords }, rows).then(function () { return W2.put('w2_ship_checked', { pod: ctx.pod, order_number: ords }, ck); });
                };
                return W2.pool(todo, S.settings().shipPool, function (o) {
                    return S.shipOne(ctx.pod, ctx.date, o).then(function (rows) {
                        buf = buf.concat(rows); checked.push({ pod: ctx.pod, trip_date: ctx.date, order_number: o, lines: String(rows.length), checked_at: W2.now(), error: '' });
                    }, function (e) {
                        failed++; checked.push({ pod: ctx.pod, trip_date: ctx.date, order_number: o, lines: '', checked_at: W2.now(), error: String(e).slice(0, 300) });
                    }).then(function () {
                        n++; W2.busy.step('Shipment lines from Fusion · ' + n + ' of ' + todo.length + ' order(s)');
                        if (checked.length >= 25) return flush();
                    });
                }).then(flush).then(function () { return todo.length + ' order(s) checked' + (failed ? ', ' + failed + ' failed' : ''); });
            });
        });
    };

    // ── WMS order lines (what the autopilot cancels from) ─────
    S.orderLinesTrip = function (pod, date, trip) {
        var url = W2.ORDS + '/TRIPMANAGEMENT/trip/orders/getsalesorderlinesbytrip/' + encodeURIComponent(trip) + '?P_INSTANCE_NAME=' + pod;
        return W2.get(url, 120000).then(function (j) {
            var rows = W2.items(j).map(function (l) {
                var o = W2.norm(l, true);
                o.pod = pod; o.trip_date = date; o.trip_id = String(trip);
                o.order_number = String(W2.pick(l, ['SOURCE_ORDER_NUMBER', 'ORDER_NUMBER'], null) || '').trim();
                o.line_number = String(W2.pick(l, ['LINE_NUMBER'], null) || '').trim();
                o.item = String(W2.pick(l, ['PRODUCT_NUMBER', 'ITEM_NUMBER', 'ITEM'], null) || '').trim();
                o.status = String(W2.pick(l, ['LINE_STATUS', 'STATUS'], null) || '').trim();
                o.fulfill_line_id = String(W2.AP ? W2.AP.fid(l) || '' : '');
                o.ordered_qty = String(W2.pick(l, ['ORDERED_QUANTITY', 'ORDERED_QTY'], null) || '');
                return o;
            });
            return W2.put('w2_order_lines', { pod: pod, trip_id: String(trip) }, rows).then(function () { return rows; });
        });
    };
    S.orderLines = function (ctx) {
        var trips = ctx.trips.length ? Promise.resolve(ctx.trips) : W2.q("SELECT DISTINCT trip_id FROM w2_trip_lines WHERE pod = " + W2.lit(ctx.pod) + " AND trip_date = " + W2.lit(ctx.date)).then(function (r) { return r.map(function (x) { return x.trip_id; }); });
        return trips.then(function (list) {
            var n = 0, failed = 0, lines = 0;
            return W2.pool(list, 3, function (t) { return S.orderLinesTrip(ctx.pod, ctx.date, t).then(function (r) { lines += r.length; }, function () { failed++; }).then(function () { n++; W2.busy.step('Order lines · trip ' + n + ' of ' + list.length); }); })
                .then(function () { return lines + ' line(s) on ' + list.length + ' trip(s)' + (failed ? ', ' + failed + ' trip(s) failed' : ''); });
        });
    };
    S.orderLinesIfOld = function (ctx) {
        return W2.q("SELECT MIN(synced_at) AS ts FROM w2_order_lines WHERE pod = " + W2.lit(ctx.pod) + " AND trip_date = " + W2.lit(ctx.date)).then(function (r) {
            var at = r[0] && r[0].ts, age = at ? (Date.now() - new Date(at).getTime()) / 60000 : Infinity;
            if (age < 15) return 'kept (read ' + Math.round(age) + ' min ago)';
            return S.orderLines(ctx);
        });
    };

    // ── MRA: switch + check report per interfaced order ───────
    var MRA_CHECK = '/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/MRA_TRX_NO_CHECK_BIP.xdo';
    S.mraCheckOne = function (pod, order) {
        return W2.call('omBip', { path: MRA_CHECK, params: { source_order_number: order }, instance: pod }, 90000).then(function (d) {
            if (!d || d.ok === false) throw (d && d.error) || 'check failed';
            return (d.count || (d.rows || []).length) ? 'SENT' : 'NOT SENT';
        });
    };
    S.mra = function (ctx) {
        var flag = W2.apexRows("SELECT instance_name, interface_flag, changed_by, TO_CHAR(changed_date, 'YYYY-MM-DD HH24:MI') AS changed_at FROM wms_mra_interface_config", 10)
            .then(function (r) { return W2.put('w2_mra_flag', null, r.map(function (x) { return W2.norm(x); }), { all: true }); }).catch(function () { return null; });
        if (!S.settings().mraCheck) return flag.then(function () { return 'switch read; order check off in Settings'; });
        return flag.then(function () {
            // interfaced orders of the date whose MRA state is not known to be done
            return W2.q(W2.M.ordersSql(ctx.pod, ctx.date) + " SELECT order_number, trip_id FROM o2 WHERE stage = 'INTERFACED' AND COALESCE(mra, '') NOT IN ('SENT', 'DONE', 'ALREADY', 'SKIPPED') LIMIT 80");
        }).then(function (list) {
            if (!list.length) return 'nothing to check';
            var rows = [], n = 0;
            return W2.pool(list, 3, function (o) {
                return S.mraCheckOne(ctx.pod, o.order_number).then(function (st) {
                    rows.push({ pod: ctx.pod, order_number: o.order_number, trip_date: ctx.date, trip_id: o.trip_id, status: st, checked_at: W2.now(), source: 'check' });
                }, function (e) {
                    rows.push({ pod: ctx.pod, order_number: o.order_number, trip_date: ctx.date, trip_id: o.trip_id, status: 'CHECK FAILED', msg: String(e).slice(0, 300), checked_at: W2.now(), source: 'check' });
                }).then(function () { n++; W2.busy.step('MRA check · ' + n + ' of ' + list.length); });
            }).then(function () {
                return W2.put('w2_mra', { pod: ctx.pod, order_number: rows.map(function (r) { return r.order_number; }) }, rows).then(function () { return rows.length + ' order(s) checked'; });
            });
        });
    };

    // ── pending shipment lines (not on a trip yet) ────────────
    S.pending = function (ctx) {
        var st = S.settings();
        var body = { p_instance_name: ctx.pod, P2_ORG_D: st.org, P2_DATE_FROM_D: W2.addDays(ctx.date, -st.pendingDays), P2_DATE_TO_D: ctx.date };
        return W2.post(W2.ORDS + '/WAREHOUSEMANAGEMENT/getpendingshipmentlines', body, 180000).then(function (j) {
            var rows = W2.items(j).map(function (r) {
                var o = W2.norm(r, true); o.pod = ctx.pod;
                o.order_number = String(W2.pick(r, ['SOURCE_ORDER_NUMBER', 'ORDER_NUMBER', 'SOURCE_HEADER_NUMBER'], /order.?(num|no)/i) || '').trim();
                o.account_name = W2.pick(r, ['ACCOUNT_NAME', 'CUSTOMER_NAME', 'SHIP_TO_PARTY_NAME'], /customer|account.?name/i) || '';
                o.order_date = W2.toIso(W2.pick(r, ['ORDER_DATE', 'ORDERED_DATE', 'SCHEDULE_SHIP_DATE', 'REQUESTED_DATE', 'CREATION_DATE'], /date/i));
                return o;
            });
            return W2.put('w2_pending', { pod: ctx.pod }, rows).then(function () { return new Set(rows.map(function (r) { return r.order_number; })).size + ' pending order(s), ' + rows.length + ' line(s)'; });
        });
    };

    // ── masters: pickers, BOGO map ────────────────────────────
    S.masters = function (ctx) {
        var pk = W2.get(W2.ORDS + '/WAREHOUSEMANAGEMENT/pickers/getpickers').then(function (j) {
            var rows = W2.items(j).map(function (r) { var o = W2.norm(r, true); o.pod = ctx.pod; o.picker_name = W2.pick(r, ['PICKER_NAME', 'NAME', 'PICKER'], /name/i) || ''; return o; });
            return W2.put('w2_pickers', { pod: ctx.pod }, rows).then(function () { return rows.length; });
        });
        var bg = W2.get(W2.ORDS + '/ARMODULE/BOGO?p_instance_name=' + ctx.pod).then(function (j) {
            var rows = W2.items(j).map(function (it) {
                return { pod: ctx.pod, main_item: String(it.mainitemcode || it.MAINITEMCODE || '').trim().toUpperCase(), promo_item: String(it.promoitemcode || it.PROMOITEMCODE || '').trim().toUpperCase(), promo_name: it.promoname || it.PROMONAME || '' };
            }).filter(function (r) { return r.main_item && r.promo_item; });
            return W2.put('w2_bogo', { pod: ctx.pod }, rows).then(function () { return rows.length; });
        });
        return Promise.all([pk.catch(function (e) { return 'pickers failed: ' + e; }), bg.catch(function (e) { return 'BOGO failed: ' + e; })])
            .then(function (r) { return r[0] + ' picker(s), ' + r[1] + ' BOGO pair(s)'; });
    };
})();
