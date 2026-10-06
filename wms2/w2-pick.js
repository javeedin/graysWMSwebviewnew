/* WMS 2.0 — Picking: picker load per picker, and pick release for the WHOLE trip date in one run.
   Pick release calls exactly what the WMS module calls (wms/app.js):
     No lots  : POST TRIPMANAGEMENT/trip/pickrelease/oneorder/{order}?P_TRIP_ID1={trip}&P_INSTANCE_NAME={pod}   (processSalesOrdersSequentially)
     With lots: POST trip/order/fetchfusionorderlines → trip/callpickwave → trips/getopenpicksbyorder → trip/getlotsforpicks (startWithLotsPickRelease)
   Store to Van / Van to Store orders are not pick released here (the WMS uses Allocate lots for them) — they open the
   copied Store Transactions dialog instead. Results are kept in w2_pick_runs; the released orders are read again from Fusion. */
(function () {
    'use strict';
    var W2 = window.W2, esc = W2.esc, TM = W2.ORDS + '/TRIPMANAGEMENT';
    var S2V = /store to van|van to store|^s2v$/i;

    function ok(res) {
        // same reading as the WMS: success true / 'true' / status success, else anything that is not success:false
        if (!res || typeof res !== 'object') return { ok: true, msg: 'completed' };
        if (res.success === true || res.success === 'true' || res.status === 'success') return { ok: true, msg: res.message || 'released' };
        return { ok: res.success !== false && res.status !== 'error', msg: res.message || res.error || JSON.stringify(res).slice(0, 200) };
    }
    var P = W2.PICK = {};
    P.noLots = function (o, pod) {
        return W2.post(TM + '/trip/pickrelease/oneorder/' + encodeURIComponent(o.order_number) + '?P_TRIP_ID1=' + encodeURIComponent(o.trip_id) + '&P_INSTANCE_NAME=' + pod, '{}', 180000).then(ok);
    };
    P.withLots = function (o, pod, wh) {
        var on = encodeURIComponent(o.order_number), steps = [];
        return W2.post(TM + '/trip/order/fetchfusionorderlines?P_INSTANCE_NAME=' + pod + '&p_order_number=' + on + '&p_trip_id=' + encodeURIComponent(o.trip_id), {}, 120000)
            .then(function (r) { steps.push((r && (r.RECORDCOUNT || r.recordcount)) || 0); return W2.post(TM + '/trip/callpickwave?warehouse=' + wh + '&order_number=' + on + '&p_instance_name=' + pod, {}, 180000); })
            .then(function () { return W2.post(TM + '/trips/getopenpicksbyorder?organization_code=' + wh + '&order_number=' + on + '&p_instance_name=' + pod, {}, 120000); })
            .then(function (r) { steps.push(W2.items(r).length || (r && r.count) || 0); return W2.post(TM + '/trip/getlotsforpicks?source_order_number=' + on + '&p_instance_name=' + pod, {}, 120000); })
            .then(function (r) { steps.push(W2.items(r).length || (r && r.count) || 0); return { ok: true, msg: steps[0] + ' line(s) · ' + steps[1] + ' pick(s) · ' + steps[2] + ' lot row(s)' }; });
    };

    /** Actual ship date for orders: read each order's shipments live, POST shipmentTransactionRequests (ShipmentUpdate) once per
        shipment — exactly the WMS All Shipment Lines › Update Actual Ship Date call — and record one row per order × shipment in
        APEX WMS_ACTUAL_SHIPDATE (window.wmsRecordShipDates, legacy/future-trip.js). onOrder(o, text, ok) reports progress. */
    P.shipDate = function (list, pod, date, d, t, say, onOrder) {
        var sent = d + 'T' + t + ':00+04:00', byOrder = {}, shipments = {}, lines = [];
        return W2.pool(list, 6, function (o) {
            return W2.sync.shipOne(pod, date, o.order_number).then(function (rows) {
                lines = lines.concat(rows);
                var per = {};
                rows.forEach(function (r) { if (r.shipment && r.bucket !== 'CANCELLED') per[r.shipment] = (per[r.shipment] || 0) + 1; });
                byOrder[o.order_number] = per;
                Object.keys(per).forEach(function (sh) { (shipments[sh] = shipments[sh] || []).push(o.order_number); });
                if (!Object.keys(per).length) onOrder(o, 'no shipment yet — pick release it first', false);
            }, function (e) { byOrder[o.order_number] = {}; onOrder(o, 'could not read its shipments: ' + e, false); });
        }).then(function () {
            var list2 = Object.keys(shipments), res = {}, n = 0;
            say('dim', list2.length + ' shipment(s) for ' + list.length + ' order(s) — sending ' + sent);
            var url = W2.fusionUrl('/fscmRestApi/resources/11.13.18.05/shipmentTransactionRequests', pod);
            return W2.pool(list2, 3, function (sh) {
                return W2.fusionPost(url, { ActionCode: 'ShipmentUpdate', shipments: [{ Shipment: sh, ActualShipDate: sent }] }, pod).then(function (r) {
                    var err = r && typeof r === 'object' ? (r['o:errorDetails'] ? JSON.stringify(r['o:errorDetails']).slice(0, 300) : r.ErrorExplanation || (r.status && +r.status >= 400 ? (r.title || 'HTTP ' + r.status) + (r.detail ? ': ' + r.detail : '') : '')) : '';
                    res[sh] = { ok: !err, err: err };
                }, function (e) { res[sh] = { ok: false, err: String(e) }; }).then(function () {
                    n++; W2.busy.step('Actual ship date · shipment ' + n + ' of ' + list2.length);
                    say(res[sh].ok ? 'ok' : 'err', 'Shipment ' + sh + ' (' + shipments[sh].join(', ') + '): ' + (res[sh].ok ? 'updated' : res[sh].err));
                });
            }).then(function () {
                var recs = [];
                list.forEach(function (o) {
                    var per = byOrder[o.order_number] || {}, shs = Object.keys(per); if (!shs.length) return;
                    var good = shs.filter(function (sh) { return res[sh] && res[sh].ok; });
                    shs.forEach(function (sh) {
                        recs.push({ instance: pod, trip_id: o.trip_id, trip_date: date, order_number: o.order_number, order_type: o.order_type, customer_number: o.account_number,
                            customer_name: o.account_name, shipment: sh, line_count: per[sh], date: d, time: t, sent: sent, ok: !!(res[sh] && res[sh].ok), error: res[sh] && res[sh].err, source: 'WMS2_PICK' });
                    });
                    onOrder(o, good.length === shs.length ? 'updated (' + shs.join(', ') + ')' : good.length + ' of ' + shs.length + ' shipment(s) updated', good.length === shs.length);
                });
                var save = typeof window.wmsRecordShipDates === 'function' ? window.wmsRecordShipDates(recs) : Promise.reject('wmsRecordShipDates is not loaded');
                return save.then(function (k) { say('dim', k + ' row(s) saved in WMS_ACTUAL_SHIPDATE'); }, function (e) { say('err', 'Sent to Fusion but not saved in WMS_ACTUAL_SHIPDATE: ' + e); })
                    .then(function () { return W2.put('w2_ship_lines', { pod: pod, order_number: list.map(function (o) { return o.order_number; }) }, lines).catch(function () {}); })
                    .then(function () { return { shipments: list2.length, ok: list2.filter(function (sh) { return res[sh].ok; }).length }; });
            });
        });
    };

    // ── Pick release for the day ─────────────────────────────
    W2.page('pickrelease', {
        title: 'Pick release (day)', icon: 'fa-dolly',
        render: function (main, params, live) {
            var pod = W2.pod(), date = W2.date();
            var set = Object.assign({ mode: 'nolots', wh: 'GIC', par: 2 }, W2.ls('w2.pick') || {});
            return Promise.all([W2.M.orders(pod, date), W2.q("SELECT run_id, order_number, result, message, ts FROM w2_pick_runs WHERE pod = " + W2.lit(pod) + " AND trip_date = " + W2.lit(date) + " ORDER BY ts DESC")]).then(function (r) {
                if (!live()) return;
                var orders = r[0].filter(function (o) { return o.stage !== 'CANCELLED'; }), last = {};
                r[1].forEach(function (x) { if (!last[x.order_number]) last[x.order_number] = x; });
                orders.forEach(function (o) { o.s2v = S2V.test(String(o.order_type || '').trim()); var l = last[o.order_number]; o.last = l ? l.result + (l.message ? ' — ' + l.message : '') : ''; o.last_ok = l ? l.result : ''; });
                var notRel = function (o) { return ['NOT CHECKED', 'NO LINES', 'PENDING', 'READY'].indexOf(o.stage) >= 0; };
                var trips = Array.from(new Set(orders.map(function (o) { return o.trip_id; })));
                var pre = orders.filter(function (o) { return !o.s2v && (params.order ? o.order_number === params.order : params.trip ? o.trip_id === params.trip && notRel(o) : notRel(o)); }).map(function (o) { return o.order_number; });
                main.innerHTML = '<div class="pagehead"><h2>Pick release · ' + W2.dayName(date) + '</h2><span class="muted">' + orders.length + ' order(s) on ' + trips.length + ' trip(s) · ' + orders.filter(notRel).length + ' not released yet</span></div>' +
                    '<div class="card"><div class="row">' +
                    '<label class="sm">Mode <select class="f" id="pr-mode"><option value="nolots">No lots — one call per order (the WMS default)</option><option value="lots">With lots — wave, picks, lots</option></select></label>' +
                    '<label class="sm">Warehouse <input class="f" id="pr-wh" value="' + esc(set.wh) + '" style="width:80px"></label>' +
                    '<label class="sm">At the same time <select class="f" id="pr-par">' + [1, 2, 3, 4].map(function (n) { return '<option' + (n === set.par ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
                    '<span class="grow"></span><span class="sm muted">Trips:</span>' + trips.map(function (t) { return '<button class="btn sm" data-trip="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') +
                    '<button class="btn sm" id="pr-notrel">All not released</button><button class="btn sm" id="pr-none">None</button></div>' +
                    '<div class="row" style="margin-top:10px"><button class="btn primary" id="pr-go"><i class="fa-solid fa-dolly"></i> Pick release <span id="pr-n">0</span> order(s)</button>' +
                    '<button class="btn" id="pr-retry"><i class="fa-solid fa-rotate-right"></i> Retry failed</button><span class="grow"></span><span class="sm muted" id="pr-prog"></span></div>' +
                    '<div class="row" style="margin-top:10px;padding-top:10px;border-top:1px dashed #e2e8f0"><span class="sm" style="font-weight:700"><i class="fa-solid fa-truck-fast"></i> Actual ship date</span>' +
                    '<input type="date" class="f" id="pr-sd" value="' + esc(date) + '"><input type="time" class="f" id="pr-st" value="' + esc(new Date().toTimeString().slice(0, 5)) + '">' +
                    '<button class="btn" id="pr-sgo"><i class="fa-solid fa-calendar-check"></i> Update ship date · <span id="pr-sn">0</span> order(s)</button>' +
                    '<span class="sm muted">for the ticked orders (tick a trip above for all its orders) — every shipment of each order is updated in Fusion and saved in WMS_ACTUAL_SHIPDATE</span></div></div>' +
                    '<div style="margin-top:12px" id="pr-grid"></div><div class="card" style="margin-top:12px"><h3>Run log</h3><div class="log" id="pr-log"><div class="dim">Nothing run yet.</div></div></div>';
                main.querySelector('#pr-mode').value = set.mode;
                var save = function () { set = { mode: main.querySelector('#pr-mode').value, wh: main.querySelector('#pr-wh').value.trim() || 'GIC', par: +main.querySelector('#pr-par').value }; W2.ls('w2.pick', set); };
                ['pr-mode', 'pr-wh', 'pr-par'].forEach(function (id) { main.querySelector('#' + id).onchange = save; });
                var count = function () { main.querySelector('#pr-n').textContent = g.selected().filter(function (o) { return !o.s2v; }).length; main.querySelector('#pr-sn').textContent = g.selected().length; };
                var g = W2.grid(main.querySelector('#pr-grid'), orders, [
                    { k: 'trip_id', t: 'Trip' }, { k: 'order_number', t: 'Order', fmt: function (v, o) { return '<a href="#" class="mono" data-od="' + esc(v) + '" title="Open the order details" style="font-weight:700;color:#4f46e5;text-decoration:none">' + esc(v) + '</a>' + (o.s2v ? ' <span class="pill v" title="Store to Van / Van to Store: the WMS allocates lots for these (Store Transactions)">S2V</span>' : ''); } },
                    { k: 'account_name', t: 'Customer' }, { k: 'wms_lines', t: 'Lines', num: true, sum: true }, { k: 'picker', t: 'Picker' },
                    { k: 'stage', t: 'Fusion status', fmt: function (v) { return W2.stagePill(v); } },
                    { k: 'ship_date', t: 'Actual ship date', fmt: function (v, o) { return v ? '<span title="' + esc(v + (o.ship_shp ? ' · shipment(s) ' + o.ship_shp : '')) + '" style="color:#0369a1;font-weight:600;white-space:nowrap"><i class="fa-solid fa-truck-fast" style="opacity:.7"></i> ' + esc(String(v).split(' ')[0]) + '</span>' : (o.ship_msg ? '<span class="pill x" title="' + esc(o.ship_msg) + '">' + esc(o.ship_msg.slice(0, 40)) + '</span>' : '<span class="muted">—</span>'); } },
                    { k: 'last', t: 'Pick release', fmt: function (v, o) { return v ? '<span class="pill ' + (o.last_ok === 'OK' ? 'ok' : o.last_ok === 'RUNNING' ? 'v' : 'x') + '" title="' + esc(v) + '">' + esc(v.slice(0, 60)) + '</span>' : (o.s2v ? '<button class="btn sm" data-s2v="' + esc(o.order_number) + '">Store transaction</button>' : ''); } }
                ], { select: true, key: 'order_number', preselect: pre, onSelect: count, csv: 'pick-release-' + date + '.csv', max: 2000,
                    after: function (box) { box.querySelectorAll('[data-od]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); e.stopPropagation(); W2.openOrderDialog(orders.filter(function (o) { return o.order_number === a.dataset.od; })[0]); }; }); box.querySelectorAll('[data-s2v]').forEach(function (b) { b.onclick = function () { W2.openOrderDialog(orders.filter(function (o) { return o.order_number === b.dataset.s2v; })[0]); }; }); } });
                count();
                var loadShip = function () {
                    if (typeof window.wmsShipDates !== 'function') return Promise.resolve();
                    return window.wmsShipDates(orders.map(function (o) { return o.order_number; }), pod).then(function (m) {
                        if (!live()) return;
                        orders.forEach(function (o) { var x = m[o.order_number]; o.ship_date = x ? x.d : ''; o.ship_shp = x ? x.shp : ''; });
                        g.redraw();
                    }, function (e) { console.warn('[Pick release] actual ship dates not read:', e); });
                };
                loadShip();
                main.querySelector('#pr-sgo').onclick = function () {
                    var sel = g.selected(), d = main.querySelector('#pr-sd').value, t = main.querySelector('#pr-st').value || '00:00';
                    if (!sel.length) { W2.toast('Tick the orders (or a trip) to update.', 'warning'); return; }
                    if (!d) { W2.toast('Choose the actual ship date.', 'warning'); return; }
                    var tr = Array.from(new Set(sel.map(function (o) { return o.trip_id; })));
                    W2.confirm('Update actual ship date', '<p>Set the actual ship date of <b>' + sel.length + '</b> order(s) on trip(s) <b>' + esc(tr.join(', ')) + '</b> (' + pod + ') to <b>' + esc(d.split('-').reverse().join('-') + ' ' + t) + '</b>?</p><p class="muted sm">Each order\'s shipments are read live from Fusion; every shipment gets one ShipmentUpdate (shipmentTransactionRequests), like All Shipment Lines › Update Actual Ship Date. Orders without a shipment yet are skipped. Every result is saved in WMS_ACTUAL_SHIPDATE.</p>', 'Update').then(function (y) {
                        if (!y) return;
                        var t0 = Date.now(), okN = 0, badN = 0;
                        W2.busy.start('Actual ship date · ' + sel.length + ' order(s) …');
                        say('dim', 'Actual ship date ' + d + ' ' + t + ' for ' + sel.length + ' order(s) on trip(s) ' + tr.join(', '));
                        sel.forEach(function (o) { o.ship_msg = ''; });
                        P.shipDate(sel, pod, date, d, t, say, function (o, text, ok) {
                            if (ok) { okN++; o.ship_date = d.split('-').reverse().join('-') + ' ' + t; o.ship_msg = ''; } else { badN++; o.ship_msg = text; }
                            say(ok ? 'ok' : 'warn', o.trip_id + ' · ' + o.order_number + ': ' + text);
                        }).then(function (r) {
                            g.redraw();
                            var msg = 'Actual ship date: ' + okN + ' order(s) updated' + (badN ? ', ' + badN + ' not' : '') + ' · ' + r.ok + ' of ' + r.shipments + ' shipment(s) in ' + Math.round((Date.now() - t0) / 1000) + ' s';
                            say(badN ? 'warn' : 'ok', msg); W2.busy.done(msg, badN > 0);
                            W2.call('aiAudit', { source: 'WMS2', actionKey: 'actual_ship_date', outcome: badN ? 'PARTIAL' : 'OK', instance: pod, refId: 'DATE:' + date, target: sel.length + ' order(s)', detail: msg }).catch(function () {});
                            return loadShip();
                        }, function (e) { W2.busy.done('Actual ship date failed: ' + e, true); say('err', String(e)); });
                    });
                };
                main.querySelectorAll('[data-trip]').forEach(function (b) { b.onclick = function () { g.select(orders.filter(function (o) { return o.trip_id === b.dataset.trip && !o.s2v; }).map(function (o) { return o.order_number; })); count(); }; });
                main.querySelector('#pr-notrel').onclick = function () { g.select(orders.filter(function (o) { return notRel(o) && !o.s2v; }).map(function (o) { return o.order_number; })); count(); };
                main.querySelector('#pr-none').onclick = function () { g.select([]); count(); };
                var log = main.querySelector('#pr-log'), lines = [];
                var say = function (cls, t) { lines.unshift('<div class="' + cls + '">' + new Date().toLocaleTimeString() + '  ' + esc(t) + '</div>'); log.innerHTML = lines.slice(0, 400).join(''); };
                var run = function (list) {
                    save();
                    list = list.filter(function (o) { return !o.s2v; });
                    if (!list.length) { W2.toast('Tick the orders to release.', 'warning'); return; }
                    var runId = 'PR' + Date.now().toString(36).toUpperCase(), done = 0, bad = 0, t0 = Date.now(), results = [];
                    W2.busy.start('Pick release · ' + list.length + ' order(s) of ' + W2.dayName(date) + ' …', function () { W2.stopping = true; });
                    W2.stopping = false;
                    say('dim', 'Run ' + runId + ': ' + list.length + ' order(s), ' + (set.mode === 'lots' ? 'with lots, warehouse ' + set.wh : 'no lots') + ', ' + set.par + ' at a time');
                    list.forEach(function (o) { o.last = 'RUNNING'; o.last_ok = 'RUNNING'; }); g.redraw();
                    return W2.pool(list, set.par, function (o) {
                        var s0 = Date.now();
                        return (set.mode === 'lots' ? P.withLots(o, pod, set.wh) : P.noLots(o, pod)).catch(function (e) { return { ok: false, msg: String(e) }; }).then(function (res) {
                            done++; if (!res.ok) bad++;
                            o.last = (res.ok ? 'OK' : 'FAILED') + ' — ' + res.msg; o.last_ok = res.ok ? 'OK' : 'FAILED'; g.redraw();
                            say(res.ok ? 'ok' : 'err', o.trip_id + ' · ' + o.order_number + ': ' + res.msg);
                            results.push({ pod: pod, run_id: runId, trip_date: date, trip_id: o.trip_id, order_number: o.order_number, mode: set.mode, result: res.ok ? 'OK' : 'FAILED', message: String(res.msg).slice(0, 400), ts: W2.now(), ms: String(Date.now() - s0) });
                            main.querySelector('#pr-prog').textContent = done + ' of ' + list.length + (bad ? ' · ' + bad + ' failed' : '');
                            W2.busy.step('Pick release · ' + done + ' of ' + list.length + (bad ? ' · ' + bad + ' failed' : ''));
                        });
                    }).then(function () {
                        return W2.put('w2_pick_runs', { pod: pod, run_id: runId }, results);
                    }).then(function () {
                        say('dim', 'Reading the released orders again from Fusion…');
                        var okList = results.filter(function (x) { return x.result === 'OK'; }).map(function (x) { return x.order_number; });
                        var rows = [], ck = [];
                        return W2.pool(okList, 6, function (on) {
                            return W2.sync.shipOne(pod, date, on).then(function (x) { rows = rows.concat(x); ck.push({ pod: pod, trip_date: date, order_number: on, lines: String(x.length), checked_at: W2.now(), error: '' }); }, function () {});
                        }).then(function () { if (!ck.length) return; return W2.put('w2_ship_lines', { pod: pod, order_number: ck.map(function (c) { return c.order_number; }) }, rows).then(function () { return W2.put('w2_ship_checked', { pod: pod, order_number: ck.map(function (c) { return c.order_number; }) }, ck); }); });
                    }).then(function () {
                        var msg = 'Pick release done: ' + (done - bad) + ' of ' + done + ' order(s) released' + (bad ? ', ' + bad + ' failed' : '') + ' in ' + Math.round((Date.now() - t0) / 1000) + ' s' + (W2.stopping ? ' (stopped)' : '');
                        say(bad ? 'warn' : 'ok', msg); W2.busy.done(msg, bad > 0);
                        W2.call('aiAudit', { source: 'WMS2', actionKey: 'pick_release_day', outcome: bad ? 'PARTIAL' : 'OK', instance: pod, refId: 'DATE:' + date, target: list.length + ' order(s)', detail: msg }).catch(function () {});
                    });
                };
                main.querySelector('#pr-go').onclick = function () {
                    var sel = g.selected().filter(function (o) { return !o.s2v; });
                    if (!sel.length) { W2.toast('Tick the orders to release.', 'warning'); return; }
                    W2.confirm('Pick release ' + sel.length + ' order(s)', '<p>Pick release <b>' + sel.length + '</b> order(s) on <b>' + new Set(sel.map(function (o) { return o.trip_id; })).size + '</b> trip(s) of ' + W2.dayName(date) + ' (' + pod + '), ' + (set.mode === 'lots' ? 'with lots (warehouse ' + esc(set.wh) + ')' : 'no lots') + ', ' + set.par + ' at a time.</p><p class="muted sm">Same calls as the WMS Pick release. Already released orders are released again only if you ticked them.</p>', 'Pick release').then(function (y) { if (y) run(sel); });
                };
                main.querySelector('#pr-retry').onclick = function () { var f = orders.filter(function (o) { return o.last_ok === 'FAILED'; }); if (!f.length) { W2.toast('No failed order to retry.', 'info'); return; } run(f); };
            });
        }
    });

    // ── Picking: picker load + orders per picker ─────────────
    W2.page('picking', {
        title: 'Picking', icon: 'fa-person-walking',
        render: function (main, params, live) {
            return Promise.all([W2.M.orders(), W2.q("SELECT DISTINCT picker_name FROM w2_pickers WHERE pod = " + W2.lit(W2.pod()) + " AND picker_name <> '' ORDER BY 1")]).then(function (r) {
                if (!live()) return;
                var orders = r[0].filter(function (o) { return o.stage !== 'CANCELLED'; }), known = r[1].map(function (x) { return x.picker_name; });
                var by = {}; orders.forEach(function (o) { var k = o.picker || '(none)'; (by[k] = by[k] || []).push(o); });
                known.forEach(function (k) { by[k] = by[k] || []; });
                var keys = Object.keys(by).sort(function (a, b) { return a === '(none)' ? -1 : b === '(none)' ? 1 : by[b].length - by[a].length; });
                var sel = params.picker || (params.filter === 'nopicker' ? '(none)' : null);
                main.innerHTML = '<div class="pagehead"><h2>Picking · ' + W2.dayName(W2.date()) + '</h2><span class="muted">' + orders.length + ' order(s) · ' + (by['(none)'] || []).length + ' without a picker</span><span class="grow"></span>' +
                    '<span class="muted sm">Assign or remove pickers on Trip 360 (Assign picker / Unassign picker) or the Trip screen — the orders without a picker are ticked for you.</span></div>' +
                    '<div class="grid g23"><div class="card"><h3>Pickers <small>orders · lines · done</small></h3><div id="pk-list"></div></div><div class="card"><h3 id="pk-h">' + (sel ? esc(sel) : 'Pick a picker') + '</h3><div id="pk-ord"></div></div></div>';
                var list = main.querySelector('#pk-list');
                list.innerHTML = keys.map(function (k) {
                    var os = by[k], n = os.length || 1, done = os.filter(function (o) { return o.stage === 'INTERFACED'; }).length, stg = os.filter(function (o) { return ['STAGED', 'PART STAGED', 'PART INTERFACED'].indexOf(o.stage) >= 0; }).length, rel = os.filter(function (o) { return o.stage === 'RELEASED'; }).length;
                    var ln = os.reduce(function (s, o) { return s + W2.n(o.wms_lines); }, 0);
                    return '<div class="hbar" data-k="' + esc(k) + '" style="' + (k === sel ? 'font-weight:700' : '') + '"><span class="lbl">' + (k === '(none)' ? '<span class="pill w">no picker</span>' : esc(k)) + '</span><span class="tr"><b style="width:' + (os.length ? 100 * done / n : 0) + '%"></b><s style="width:' + (100 * stg / n) + '%"></s><u style="width:' + (100 * rel / n) + '%"></u></span><span class="num">' + os.length + ' · ' + ln + ' ln</span></div>';
                }).join('') || '<div class="empty">No orders.</div>';
                var show = function (k) {
                    main.querySelector('#pk-h').textContent = k === '(none)' ? 'Orders without a picker' : 'Orders of ' + k;
                    W2.grid(main.querySelector('#pk-ord'), by[k] || [], W2.ORDER_COLS(true), { onRow: function (o) { W2.orderPanel(o); }, csv: 'picker-' + k + '.csv', empty: 'No orders for this picker on ' + W2.dayName(W2.date()) + '.' });
                };
                list.querySelectorAll('[data-k]').forEach(function (e) { e.onclick = function () { show(e.dataset.k); }; });
                if (sel && by[sel]) show(sel); else if (keys[0]) show(keys[0]);
            });
        }
    });
})();
