/* WMS 2.0 — Trip screen: the WMS Trip Details page itself (legacy/trip-workspace.js, copied verbatim) hosted inside
   WMS 2.0, so every trip feature of the WMS works exactly as there:
     Refresh · Edit Trip (lorry / bay / priority) · Assign Picker (+ date) · Allocate Lots for S2V · Pick Release All
     (with / without lots, progress, retry) · All Shipment Lines (update ship date, cancel) · Add to Agent · Show Lines ·
     Get Profit Centers · Add Orders (pending orders, paste orders, fetch pending shipments) · per order: Move to another
     trip, Remove from trip, Print, Order / Store Transactions dialogs · Excel export · trip summary (volume vs lorry)
   plus Create Trip (copied from the WMS Co-Pilot).
   WMS 2.0 only hosts it: the page opens the trip with the same call as the WMS (GETTRIPDETAILS/{trip}), can tick the
   orders an action is for (Trip 360 buttons), and reads the date again into DuckDB when you come back.
   It also adds what the WMS has only as a stub: Unassign picker (deletes the order's wms_picker_assignment row). */
(function () {
    'use strict';
    var W2 = window.W2, esc = W2.esc;
    var WS = W2.ws = { dirty: false };

    function $(id) { return document.getElementById(id); }

    function panel() {
        var p = $('w2-ws'); if (p) return p;
        p = document.createElement('div'); p.id = 'w2-ws'; p.hidden = true;
        p.innerHTML =
            '<div class="ws-bar"><button class="btn sm" id="ws-back"><i class="fa-solid fa-arrow-left"></i> Back</button>' +
            '<b><i class="fa-solid fa-truck-ramp-box"></i> Trip screen</b><span class="muted xs">the WMS trip page — every button works as in the WMS</span><span class="grow"></span>' +
            '<select id="ws-pick" title="Open another trip of the date"></select><button class="btn sm" id="ws-open"><i class="fa-solid fa-folder-open"></i> Open</button>' +
            '<button class="btn sm primary" id="ws-new"><i class="fa-solid fa-plus"></i> Create trip</button></div>' +
            // ids the copied WMS code looks for
            '<input type="hidden" id="trip-instance-name"><div id="trip-tab-header" class="ws-tabs"></div><div id="trip-tab-content" class="ws-content">' +
            '<div class="empty" id="ws-empty"><i class="fa-solid fa-truck"></i>Pick a trip above, or open one from Trips / Trip 360.</div></div>';
        document.querySelector('.pane').appendChild(p);
        $('ws-back').onclick = function () { W2.go(WS.from && WS.from[0] !== 'tripws' ? WS.from[0] : 'trips', WS.from ? WS.from[1] : {}); };
        $('ws-new').onclick = WS.createTrip;
        $('ws-open').onclick = function () { var v = $('ws-pick').value; if (v) WS.open(v); };
        return p;
    }

    function show(on) {
        var p = panel();
        p.hidden = !on; $('main').hidden = !!on;
        if (on) $('trip-instance-name').value = W2.pod();
    }
    function tabsOpen() { return document.querySelectorAll('#trip-tab-header .tab-item').length; }
    function emptyNote() { var e = $('ws-empty'); if (e) e.style.display = tabsOpen() ? 'none' : ''; }

    // the panel is only on screen on its own page
    var render = W2.render;
    W2.render = function () {
        if (W2.state.page !== 'tripws') {
            if (WS.dirty) { WS.dirty = false; resync(); }
            show(false);
        }
        return render.apply(this, arguments);
    };
    var go = W2.go;
    W2.go = function (page, params) {
        if (page === 'tripws' && W2.state.page !== 'tripws') WS.from = [W2.state.page, W2.state.params];
        return go.apply(this, arguments);
    };

    /** The WMS keeps the trips of the search in currentFullData (Edit Trip, Add Orders and Move read it). */
    function feedLegacy() {
        var pod = W2.pod(), date = W2.date();
        return W2.qs([
            "SELECT trip_id, lorry, loading_bay, priority, raw_json FROM w2_trips WHERE pod = " + W2.lit(pod) + " AND trip_date = " + W2.lit(date) + " ORDER BY TRY_CAST(trip_id AS BIGINT), trip_id",
            "SELECT raw_json FROM w2_trip_lines WHERE pod = " + W2.lit(pod) + " AND trip_date = " + W2.lit(date)
        ]).then(function (r) {
            var parse = function (x) { try { return JSON.parse(x.raw_json || '{}'); } catch (e) { return {}; } };
            var trips = r[0].map(function (t) { var o = parse(t); o.TRIP_ID = o.TRIP_ID || t.trip_id; o.INSTANCE_NAME = o.INSTANCE_NAME || pod; return o; });
            try { currentFullData = trips; } catch (e) { /* bridge not loaded */ }
            window.currentFullData = trips;
            window.tripDetailsAllData = r[1].map(parse);
            window.currentTripInstance = pod;
            var sel = $('ws-pick');
            if (sel) sel.innerHTML = '<option value="">Trip…</option>' + r[0].map(function (t) { return '<option value="' + esc(t.trip_id) + '">' + esc(t.trip_id + (t.lorry ? ' · ' + t.lorry : '')) + '</option>'; }).join('');
            WS.trips = r[0];
            return r[0];
        });
    }

    function gridOf(trip) {
        var el = window.jQuery && jQuery('#grid-trip-detail-' + trip);
        if (!el || !el.length) return null;
        try { return el.dxDataGrid('instance'); } catch (e) { return null; }
    }
    /** Resolves the trip's DevExtreme grid once the WMS page has drawn it (≤ 30 s). */
    function whenGrid(trip) {
        return new Promise(function (resolve, reject) {
            var t0 = Date.now();
            (function poll() {
                var g = gridOf(trip);
                if (g) return setTimeout(function () { resolve(g); }, 150);
                if (Date.now() - t0 > 30000) return reject('The trip screen did not open.');
                setTimeout(poll, 200);
            })();
        });
    }
    /** Ticks the orders in the WMS grid (rows are its own data objects — no key field). */
    function tick(g, orders) {
        var want = {}; orders.forEach(function (o) { want[String(o).trim()] = 1; });
        var items = g.option('dataSource') || [];
        var rows = items.filter(function (r) { return want[String(r.ORDER_NUMBER || r.order_number || '').trim()]; });
        g.clearSelection(); if (rows.length) g.selectRows(rows, false);
        return rows.length;
    }

    /** Opens a trip in the trip screen; then(grid) runs once its grid is there. */
    WS.open = function (trip, then) {
        WS.pending = { trip: String(trip), then: then || null };
        if (W2.state.page === 'tripws' && String(W2.state.params.trip || '') === String(trip)) return openNow();
        W2.go('tripws', { trip: String(trip) });
    };
    function openNow() {
        var p = WS.pending; WS.pending = null;
        if (!p) return feedLegacy();
        var trip = p.trip;
        show(true);
        return feedLegacy().then(function (trips) {
            var t = trips.filter(function (x) { return String(x.trip_id) === trip; })[0] || {}, raw = {};
            try { raw = JSON.parse(t.raw_json || '{}'); } catch (e) {}
            if (!gridOf(trip)) {
                window.openTripDetails(trip, raw.TRIP_DATE || raw.trip_date || W2.dmy(W2.date()), t.lorry || raw.TRIP_LORRY || '', W2.pod(), t.loading_bay || '', t.priority || '');
            } else {
                var ti = document.querySelector('.tab-item[data-tab="trip-detail-' + trip + '"]'); if (ti) ti.click();
            }
            WS.dirty = true;
            return whenGrid(trip);
        }).then(function (g) { emptyNote(); if (p.then) p.then(g); return g; }).catch(function (e) { W2.toast(String(e), 'error'); });
    }

    /** Runs a WMS trip action, with the given orders ticked first (selection actions: Assign Picker, Pick Release All, Allocate Lots). */
    WS.run = function (trip, action, orders) {
        return WS.open(trip, function (g) {
            if (orders) {
                var n = tick(g, orders);
                if (!n) { W2.toast('None of those orders is on the trip screen — tick them in the grid, then use the button.', 'info'); return; }
            }
            var fn = window[action];
            if (typeof fn !== 'function') { W2.toast(action + ' is not loaded.', 'error'); return; }
            var inst = W2.pod(), tab = 'trip-detail-' + trip;
            ({
                openEditTripHeaderModal: function () { fn(trip, tab); }, getTripProfitCenters: function () { fn(trip, tab); },
                showAllShipmentLines: function () { fn(trip, inst); }, showTripLines: function () { fn(trip, inst); },
                saAddTripToAgent: function () { fn(trip, 'Trip ' + trip, inst); }
            }[action] || function () { fn(trip); })();
        });
    };

    WS.createTrip = function () {
        if (typeof window.openNewTripModal !== 'function') { W2.toast('Create trip is not loaded.', 'error'); return; }
        window.openNewTripModal();
        WS.dirty = true;
    };

    /** Unassign picker — the WMS button is a stub; this removes the picker assignment rows of the orders ticked here.
        orders: [{order_number, picker}] (all ticked when there is one). */
    WS.unassignPicker = function (orders) {
        orders = orders.filter(function (o) { return o && o.order_number; });
        if (!orders.length) { W2.toast('No order on this trip has a picker.', 'info'); return Promise.resolve(); }
        var html = '<p class="sm">Removes the picker of the ticked orders (rows of <code>wms_picker_assignment</code>). The orders stay on their trip.</p>' +
            '<div class="scroll" style="max-height:320px"><table><thead><tr><th><input type="checkbox" id="ua-all"' + (orders.length === 1 ? ' checked' : '') + '></th><th>Order</th><th>Picker</th></tr></thead><tbody>' +
            orders.map(function (o, i) { return '<tr><td><input type="checkbox" data-i="' + i + '"' + (orders.length === 1 ? ' checked' : '') + '></td><td class="mono">' + esc(o.order_number) + '</td><td>' + esc(o.picker || '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
        var picked = [];
        var done = W2.confirm('Unassign picker', html, 'Remove picker', 'danger');
        var mods = document.querySelectorAll('.w2-modal'), box = mods[mods.length - 1];
        if (box) {
            var all = box.querySelector('#ua-all');
            all.onchange = function () { box.querySelectorAll('[data-i]').forEach(function (c) { c.checked = all.checked; }); };
            box.addEventListener('change', function () { picked = [].filter.call(box.querySelectorAll('[data-i]'), function (c) { return c.checked; }).map(function (c) { return orders[+c.dataset.i].order_number; }); });
            if (orders.length === 1) picked = [orders[0].order_number];
        }
        return done.then(function (ok) {
            if (!ok) return;
            if (!picked.length) { W2.toast('Tick the orders to remove the picker from.', 'info'); return; }
            var list = picked.map(function (o) { return "'" + String(o).trim().replace(/'/g, "''") + "'"; }).join(', ');
            return W2.apexWrite('DELETE FROM wms_picker_assignment WHERE TRIM(source_order_number) IN (' + list + ')').then(function () {
                W2.toast('Picker removed from ' + picked.length + ' order(s).', 'success');
                return W2.sync.day(W2.date(), { only: ['pickers'], auto: true });
            }, function (e) { W2.toast('Could not remove the picker: ' + e, 'error'); });
        });
    };

    // hooks the WMS calls after Add Orders / Create Trip (missing in the WMS itself): read the date again
    function resync() { if (!W2.sync.running) W2.sync.day(W2.date(), { only: ['trips', 'lines', 'pickers', 'print'], auto: true }); }
    window.fetchTripsData = resync;
    window.fetchTrips = resync;

    W2.page('tripws', {
        title: 'Trip screen', icon: 'fa-truck-ramp-box',
        render: function (main, params) {
            show(true); emptyNote();
            if (params.trip && !(WS.pending && WS.pending.trip === String(params.trip))) WS.pending = { trip: String(params.trip), then: null };
            return openNow();
        }
    });

    // keep the "pick a trip" note right when the WMS closes a tab
    W2.on('ready', function () { panel(); var h = $('trip-tab-header'); if (h) new MutationObserver(emptyNote).observe(h, { childList: true }); });
})();
