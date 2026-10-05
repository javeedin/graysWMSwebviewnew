/* WMS 2.0 — the WMS Trip Details page (legacy/trip-workspace.js, copied verbatim) shown INSIDE each trip tab of the
   Trips area, under WMS 2.0's stage timeline and KPI cards (the WMS summary cards are hidden there). Every WMS trip
   feature works exactly as in the WMS:
     Refresh · Edit Trip (lorry / bay / priority) · Assign Picker (+ date) · Allocate Lots for S2V · Pick Release All
     (with / without lots, progress, retry) · All Shipment Lines (update ship date, cancel) · Add to Agent · Show Lines ·
     Get Profit Centers · Add Orders (pending orders, paste orders, fetch pending shipments) · per order: Move to another
     trip, Remove from trip, Print, Order / Store Transactions dialogs · Excel export
   plus Create Trip (copied from the WMS Co-Pilot) and Unassign picker (a stub in the WMS; here it deletes the
   order's wms_picker_assignment row).
   One host element holds the WMS ids (#trip-tab-header hidden, #trip-tab-content, #trip-instance-name). It is parked
   (hidden, still in the document) whenever a page is drawn and mounted into the trip tab on screen, so the DevExtreme
   grids and any running pick release keep their state while you switch tabs. */
(function () {
    'use strict';
    var W2 = window.W2, esc = W2.esc;
    var WS = W2.ws = { dirty: false };
    var host = null, park = null;

    function ensureHost() {
        if (host) return host;
        park = document.createElement('div'); park.id = 'w2-park'; park.hidden = true; document.body.appendChild(park);
        host = document.createElement('div'); host.id = 'w2-lhost';
        host.innerHTML = '<input type="hidden" id="trip-instance-name"><div id="trip-tab-header" hidden></div><div id="trip-tab-content"></div>';
        park.appendChild(host);
        return host;
    }
    WS.park = function () { if (host && host.parentNode !== park) park.appendChild(host); };

    // the host leaves the screen before any page is drawn; after WMS actions, coming back reads the date again
    var render = W2.render;
    W2.render = function () {
        WS.park();
        var onWms = W2.state.page === 'trips' && W2.tt && W2.tt.get().active !== 'list' && W2.tt.view(W2.tt.get().active) === 'wms';
        if (WS.dirty && !onWms) { WS.dirty = false; resync(); }
        return render.apply(this, arguments);
    };

    WS.feed = function () { return feedLegacy(); };
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
                if (Date.now() - t0 > 30000) return reject('The WMS trip page did not open.');
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
    function showPane(trip) {
        host.querySelectorAll('#trip-tab-content > .tab-pane').forEach(function (p) { p.classList.toggle('active', p.id === 'trip-trip-detail-' + trip + '-tab'); });
    }

    // the WMS's own openTripDetails (W2 calls it); when WMS code opens a trip (Create trip), it becomes a tab
    var legacyOpen = window.openTripDetails;
    window.openTripDetails = function (tripId) {
        if (WS.opening === String(tripId)) return legacyOpen.apply(this, arguments);
        if (W2.tt) W2.tt.open(String(tripId));
    };

    /** Puts the WMS trip page of `trip` into `box` (opens it with GETTRIPDETAILS/{trip} the first time). Resolves its grid. */
    WS.mount = function (box, trip) {
        trip = String(trip); ensureHost();
        host.querySelector('#trip-instance-name').value = W2.pod();
        box.appendChild(host);
        WS.dirty = true;
        return feedLegacy().then(function (trips) {
            if (gridOf(trip)) { showPane(trip); var g = gridOf(trip); try { g.updateDimensions(); } catch (e) {} return g; }
            var t = trips.filter(function (x) { return String(x.trip_id) === trip; })[0] || {}, raw = {};
            try { raw = JSON.parse(t.raw_json || '{}'); } catch (e) {}
            WS.opening = trip;
            try { legacyOpen(trip, raw.TRIP_DATE || raw.trip_date || W2.dmy(W2.date()), t.lorry || raw.TRIP_LORRY || '', W2.pod(), t.loading_bay || '', t.priority || ''); }
            finally { WS.opening = null; }
            return whenGrid(trip).then(function (g) { showPane(trip); return g; });
        });
    };
    /** Removes a trip's WMS page (its tab was closed). */
    WS.drop = function (trip) {
        if (typeof window.closeTripTab === 'function' && document.getElementById('trip-trip-detail-' + trip + '-tab')) {
            try { window.closeTripTab('trip-detail-' + trip, { stopPropagation: function () {} }); } catch (e) {}
        }
    };

    /** Runs a WMS trip action on the trip's WMS page, with the given orders ticked first. */
    WS.run = function (trip, action, orders) {
        trip = String(trip);
        W2.tt.setView(trip, 'wms'); W2.tt.open(trip);
        return whenGrid(trip).then(function (g) {
            if (orders) {
                var n = tick(g, orders);
                if (!n) { W2.toast('None of those orders is on the WMS trip page — tick them in the grid, then use the button.', 'info'); return; }
            }
            var fn = window[action];
            if (typeof fn !== 'function') { W2.toast(action + ' is not loaded.', 'error'); return; }
            var inst = W2.pod(), tab = 'trip-detail-' + trip;
            ({
                openEditTripHeaderModal: function () { fn(trip, tab); }, getTripProfitCenters: function () { fn(trip, tab); },
                showAllShipmentLines: function () { fn(trip, inst); }, showTripLines: function () { fn(trip, inst); },
                saAddTripToAgent: function () { fn(trip, 'Trip ' + trip, inst); }
            }[action] || function () { fn(trip); })();
        }).catch(function (e) { W2.toast(String(e), 'error'); });
    };
    WS.open = function (trip) { W2.tt.setView(String(trip), 'wms'); W2.tt.open(String(trip)); };

    WS.createTrip = function () {
        if (typeof window.openNewTripModal !== 'function') { W2.toast('Create trip is not loaded.', 'error'); return; }
        window.openNewTripModal();
        WS.dirty = true;
    };

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

    // hooks the WMS calls after Add Orders / Create Trip (missing in the WMS itself): read the date again
    function resync() { if (!W2.sync.running) W2.sync.day(W2.date(), { only: ['trips', 'lines', 'pickers', 'print'], auto: true }); }
    window.fetchTripsData = resync;
    window.fetchTrips = resync;

    // Future Trip (trip 9999): the WMS Future Trip grid (legacy/future-trip.js, copied verbatim) on its own page, for the
    // instance in the top bar. Move lists the trips of the date on screen (fed from DuckDB) — or type the trip id.
    W2.page('futuretrip', {
        title: 'Future trip', icon: 'fa-hourglass-half',
        render: function (main) {
            var F = window.FutureTrip;
            if (!F) { main.innerHTML = '<div class="callout bad">The Future Trip code is not loaded.</div>'; return; }
            main.innerHTML = '<div class="pagehead"><h2><i class="fa-solid fa-hourglass-half" style="color:#d97706"></i> Future trip <span class="mono">' + (window.FUTURE_TRIP_ID || '9999') + '</span></h2>' +
                '<span class="muted">orders without a real trip yet · ' + esc(W2.pod()) + '</span></div>' +
                '<div class="w2-ft"><div id="future-trip-root"></div></div>';
            F.instance = W2.pod();      // the top bar's instance, not the WMS page's own select
            WS.dirty = true;             // a move / delete here changes the trips of the date: read it again when leaving
            return WS.feed().then(function () { F.load(); });
        }
    });
    /** Orders on trip 9999 for the nav badge (APEX gateway, no DuckDB copy). */
    WS.futureCount = function () {
        return W2.apexRows("SELECT COUNT(DISTINCT order_number) AS n FROM wms_trip_details WHERE trip_id = 9999 AND instance_name = " + W2.lit(W2.pod()), 1)
            .then(function (r) { var n = +((r[0] || {}).N || 0); W2.badges({ futuretrip: { n: n, cls: 'warn' } }); return n; }, function () { return null; });
    };
    W2.on('ready', function () { WS.futureCount(); });
    W2.on('pod', function () { WS.futureCount(); });

    // old links to the separate trip screen now land on the trip tabs
    W2.page('tripws', {
        title: 'Trips', icon: 'fa-truck',
        render: function (main, params) { if (params.trip) WS.open(params.trip); else W2.go('trips'); }
    });
})();
