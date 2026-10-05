/* WMS 2.0 — Trips board / list, Trip 360, all orders of the date and the order side panel.
   "Order details" opens the COPIED WMS dialogs (legacy/trip-workspace.js: editTripOrder → Order Transactions or
   Store Transactions) with the order's original GETTRIPDETAILS/ALL row, so the same tested screens and actions run. */
(function () {
    'use strict';
    var W2 = window.W2, esc = W2.esc;

    var MISSING = {
        nopicker: ['without a picker', function (o) { return !o.picker; }],
        notreleased: ['not released to the warehouse', function (o) { return ['NOT CHECKED', 'NO LINES', 'PENDING', 'READY'].indexOf(o.stage) >= 0; }],
        notstaged: ['not picked / staged', function (o) { return ['STAGED', 'PART INTERFACED', 'INTERFACED'].indexOf(o.stage) < 0; }],
        notinterfaced: ['not interfaced', function (o) { return o.stage !== 'INTERFACED'; }],
        nomra: ['interfaced, MRA not done', function (o) { return o.stage === 'INTERFACED' && ['SENT', 'DONE', 'ALREADY', 'SKIPPED', 'OFF'].indexOf(o.mra) < 0; }],
        notprinted: ['not printed', function (o) { return o.print_state !== 'PRINTED'; }],
        tocancel: ['with lines to cancel', function (o) { return W2.n(o.to_cancel) > 0; }]
    };
    W2.ORDER_COLS = function (withTrip) {
        return (withTrip ? [{ k: 'trip_id', t: 'Trip', fmt: function (v) { return '<span class="mono">' + esc(v) + '</span>'; } }] : []).concat([
            { k: 'order_number', t: 'Order', fmt: function (v) { return '<b class="mono">' + esc(v) + '</b>'; } },
            { k: 'account_name', t: 'Customer' },
            { k: 'order_type', t: 'Type' },
            { k: 'wms_lines', t: 'Lines', num: true, sum: true },
            { k: 'picker', t: 'Picker', fmt: function (v) { return v ? esc(v) : '<span class="pill w">none</span>'; } },
            { k: 'stage', t: 'Fusion status', fmt: function (v, o) { return W2.stagePill(v) + (o.ship_n ? ' <span class="muted xs">' + o.itf + '/' + o.active + '</span>' : ''); } },
            { k: 'mra', t: 'MRA', fmt: function (v) { return W2.mraPill(v); } },
            { k: 'print_state', t: 'Print', fmt: function (v) { return W2.printPill(v); } },
            { k: 'to_cancel', t: 'Cancel', fmt: function (v, o) { return W2.n(v) ? '<span class="pill w">' + v + ' to cancel</span>' : W2.n(o.cancelled_w2) ? '<span class="pill">' + o.cancelled_w2 + ' cancelled</span>' : ''; } }
        ]);
    };

    // ── Trips board / list ───────────────────────────────────
    var TRIPS_LIST = ({
        title: 'Trips', icon: 'fa-truck',
        render: function (main, params, live) {
            var view = W2.ls('w2.trips.view') || 'board';
            return W2.M.trips(W2.pod(), W2.date()).then(function (trips) {
                if (!live()) return;
                var h = '<div class="pagehead"><h2>Trips · ' + W2.dayName(W2.date()) + '</h2><span class="muted">' + trips.length + ' trip(s)</span><span class="grow"></span>' +
                    '<button class="btn sm ' + (view === 'board' ? 'primary' : '') + '" data-v="board"><i class="fa-solid fa-table-columns"></i> Board</button><button class="btn sm ' + (view === 'list' ? 'primary' : '') + '" data-v="list"><i class="fa-solid fa-list"></i> List</button>' +
                    '<button class="btn sm" id="tr-rel"><i class="fa-solid fa-dolly"></i> Pick release the day</button>' +
                    '<button class="btn sm primary" id="tr-new"><i class="fa-solid fa-plus"></i> Create trip</button></div><div id="tr-body"></div>';
                main.innerHTML = h;
                main.querySelectorAll('[data-v]').forEach(function (b) { b.onclick = function () { W2.ls('w2.trips.view', b.dataset.v); W2.render(); }; });
                main.querySelector('#tr-rel').onclick = function () { W2.go('pickrelease'); };
                main.querySelector('#tr-new').onclick = function () { W2.ws.createTrip(); };
                var body = main.querySelector('#tr-body');
                if (!trips.length) { body.innerHTML = '<div class="card empty"><i class="fa-solid fa-truck"></i>No trips for this date in the local copy — press Refresh.</div>'; return; }
                if (view === 'list') {
                    W2.grid(body, trips, [
                        { k: 'trip_id', t: 'Trip', fmt: function (v) { return '<b class="mono">' + esc(v) + '</b>'; } }, { k: 'lorry', t: 'Lorry' }, { k: 'loading_bay', t: 'Bay' }, { k: 'priority', t: 'Priority' }, { k: 'pickers', t: 'Pickers' },
                        { k: 'orders', t: 'Orders', num: true, sum: true }, { k: 'lines', t: 'Lines', num: true, sum: true }, { k: 'with_picker', t: 'With picker', num: true, sum: true },
                        { k: 'released', t: 'Released', num: true, sum: true }, { k: 'interfaced', t: 'Interfaced', num: true, sum: true }, { k: 'mra_ok', t: 'MRA ok', num: true, sum: true },
                        { k: 'printed', t: 'Printed', num: true, sum: true }, { k: 'to_cancel', t: 'Lines to cancel', num: true, sum: true }
                    ], { onRow: function (t, e) { W2.tt.open(t.trip_id, e && (e.ctrlKey || e.metaKey)); }, csv: 'trips-' + W2.date() + '.csv' });
                    return;
                }
                var lanes = {}; W2.M.LANES.forEach(function (l) { lanes[l[0]] = []; });
                trips.forEach(function (t) { lanes[W2.M.tripStage(t)].push(t); });
                body.innerHTML = '<div class="kan">' + W2.M.LANES.filter(function (l) { return l[0] !== 'EMPTY' || lanes.EMPTY.length; }).map(function (l) {
                    return '<div class="lane"><h4><span><i class="fa-solid ' + l[2] + '"></i> ' + l[1] + '</span><span class="mono">' + lanes[l[0]].length + '</span></h4>' + lanes[l[0]].map(function (t) {
                        var a = W2.n(t.active_lines) || 1, risk = t.orders - t.with_picker > 0 || t.mra_bad || t.print_bad;
                        return '<div class="tcard ' + (risk ? 'risk' : '') + '" data-t="' + esc(t.trip_id) + '"><div class="id"><span>' + esc(t.trip_id) + '</span><span class="muted">' + esc(t.lorry || '') + '</span></div>' +
                            '<div class="muted xs">' + t.orders + ' order(s) · ' + W2.fmt(t.lines) + ' line(s)' + (t.pickers ? ' · ' + esc(t.pickers) : '') + '</div>' +
                            '<div><span class="prog" style="width:100%"><b style="width:' + (100 * t.itf_lines / a) + '%"></b><b class="st" style="width:' + (100 * t.stg_lines / a) + '%"></b><b class="rl" style="width:' + (100 * t.rel_lines / a) + '%"></b></span></div>' +
                            '<div class="row" style="gap:4px">' + (t.orders - t.with_picker ? '<span class="pill w">' + (t.orders - t.with_picker) + ' no picker</span>' : '') + (t.mra_bad ? '<span class="pill x">MRA ' + t.mra_bad + ' failed</span>' : '') +
                            (t.print_bad ? '<span class="pill x">print ' + t.print_bad + ' failed</span>' : '') + (W2.n(t.to_cancel) ? '<span class="pill w">' + t.to_cancel + ' to cancel</span>' : '') + '</div></div>';
                    }).join('') + '</div>';
                }).join('') + '</div>';
                body.querySelectorAll('[data-t]').forEach(function (c) {
                    c.onclick = function (e) { W2.tt.open(c.dataset.t, e.ctrlKey || e.metaKey); };
                    c.onauxclick = function (e) { if (e.button === 1) { e.preventDefault(); W2.tt.open(c.dataset.t, true); } };
                });
            });
        }
    });

    // ── Trip 360 ─────────────────────────────────────────────
    var TRIP_360 = ({
        title: 'Trip 360', icon: 'fa-truck-fast',
        render: function (main, params, live) {
            var trip = String(params.trip || '');
            if (!trip) { W2.go('trips'); return; }
            var pod = W2.pod(), date = W2.date();
            return Promise.all([W2.M.trips(pod, date), W2.q(W2.M.ordersSql(pod, date) + " SELECT * FROM o2 WHERE trip_id = " + W2.lit(trip) + " ORDER BY order_number")]).then(function (r) {
                if (!live()) return;
                var t = r[0].filter(function (x) { return String(x.trip_id) === trip; })[0] || { trip_id: trip, orders: 0 }, orders = r[1];
                var live0 = orders.filter(function (x) { return x.stage !== 'CANCELLED'; }), num = function (x) { return x.order_number; };
                var noPick = live0.filter(function (x) { return !x.picker; }), s2v = live0.filter(function (x) { return /store to van|van to store|s2v|v2s/i.test(x.order_type || ''); });
                var notRel = live0.filter(function (x) { return ['NOT CHECKED', 'NO LINES', 'PENDING', 'READY'].indexOf(x.stage) >= 0 && s2v.indexOf(x) < 0; });
                var a = W2.n(t.active_lines), o = W2.n(t.orders) - W2.n(t.cancelled);
                var tl = [['On trip', o, o], ['Pickers', t.with_picker, o], ['Released', t.released, o], ['Picked / staged', t.staged, o], ['Interfaced', t.interfaced, o], ['MRA', t.mra_ok, t.interfaced || o], ['Printed', t.printed, o]];
                var wms = (params.view || 'wms') === 'wms';
                var h = '<div class="pagehead"><button class="btn sm" id="t-back"><i class="fa-solid fa-arrow-left"></i> All trips</button><h2>Trip <span class="mono">' + esc(trip) + '</span></h2>' +
                    '<span class="muted">' + esc([t.lorry, t.loading_bay && 'bay ' + t.loading_bay, t.priority && 'priority ' + t.priority, W2.dayName(date)].filter(Boolean).join(' · ')) + '</span><span class="grow"></span>' +
                    '<button class="btn sm" id="t-ref"><i class="fa-solid fa-rotate"></i> Read this trip again</button>' +
                    '<button class="btn sm" id="t-rel"><i class="fa-solid fa-dolly"></i> Pick release</button>' +
                    '<button class="btn sm" id="t-mra"><i class="fa-solid fa-receipt"></i> MRA</button>' +
                    '<span class="seg"><button class="btn sm' + (wms ? ' primary' : '') + '" data-view="wms" title="The WMS trip page with every WMS button"><i class="fa-solid fa-table-list"></i> WMS page</button>' +
                    '<button class="btn sm' + (wms ? '' : ' primary') + '" data-view="insights" title="WMS 2.0 view: orders with Fusion status, MRA, print, cancellations"><i class="fa-solid fa-chart-simple"></i> Insights</button></span></div>' +
                    // the WMS trip page's actions — each opens the trip screen and runs the WMS code (orders pre-ticked where it needs a selection)
                    (wms ? '' : '<div class="actbar">' +
                    '<button class="btn sm" data-a="assign"><i class="fa-solid fa-user-plus"></i> Assign picker<small>' + W2.fmt(noPick.length) + ' without</small></button>' +
                    '<button class="btn sm" data-a="unassign"><i class="fa-solid fa-user-minus"></i> Unassign picker</button>' +
                    '<button class="btn sm" data-a="pickReleaseAll"><i class="fa-solid fa-dolly"></i> Pick Release All<small>' + W2.fmt(notRel.length) + ' not released</small></button>' +
                    '<button class="btn sm" data-a="allocateLotsForS2V"' + (s2v.length ? '' : ' disabled title="No Store to Van / Van to Store orders"') + '><i class="fa-solid fa-boxes-stacked"></i> Allocate lots S2V<small>' + s2v.length + '</small></button>' +
                    '<button class="btn sm" data-a="openAddOrdersModalForTrip"><i class="fa-solid fa-cart-plus"></i> Add orders</button>' +
                    '<button class="btn sm" data-a="openEditTripHeaderModal"><i class="fa-solid fa-pen"></i> Edit trip</button>' +
                    '<button class="btn sm" data-a="showAllShipmentLines"><i class="fa-solid fa-truck-fast"></i> All shipment lines</button>' +
                    '<button class="btn sm" data-a="showTripLines"><i class="fa-solid fa-list"></i> Show lines</button>' +
                    '<button class="btn sm" data-a="getTripProfitCenters"><i class="fa-solid fa-sitemap"></i> Profit centers</button>' +
                    '<button class="btn sm" data-a="saAddTripToAgent"><i class="fa-solid fa-user-gear"></i> Add to agent</button>' +
                    '</div>') +
                    '<div class="card"><div class="tl">' + tl.map(function (s) { var cls = !s[2] ? '' : s[1] >= s[2] ? 'd' : s[1] > 0 ? 'p' : ''; return '<div class="' + cls + '">' + s[0] + '<small>' + W2.n(s[1]) + ' / ' + W2.n(s[2]) + '</small></div>'; }).join('') + '</div></div>' +
                    '<div class="kpis" style="margin-top:12px">' +
                    '<div class="kpi"><span class="l">Orders</span><span class="n">' + W2.fmt(t.orders) + '</span><span class="s">' + W2.fmt(t.lines) + ' WMS line(s)</span></div>' +
                    '<div class="kpi ' + (a && t.itf_lines >= a ? 'good' : '') + '"><span class="l">Lines interfaced</span><span class="n">' + W2.pct(t.itf_lines, a) + '%</span><span class="s">' + W2.fmt(t.itf_lines) + ' of ' + W2.fmt(a) + ' Fusion line(s)</span></div>' +
                    '<div class="kpi ' + (t.orders - t.with_picker ? 'warn' : '') + '"><span class="l">Without picker</span><span class="n">' + W2.fmt(t.orders - t.with_picker) + '</span><span class="s">' + esc(t.pickers || 'no picker yet') + '</span></div>' +
                    '<div class="kpi ' + (t.mra_bad ? 'bad' : '') + '"><span class="l">MRA</span><span class="n">' + W2.fmt(t.mra_ok) + '</span><span class="s">' + (t.mra_bad ? t.mra_bad + ' failed' : 'done') + '</span></div>' +
                    '<div class="kpi ' + (t.print_bad ? 'bad' : '') + '"><span class="l">Printed</span><span class="n">' + W2.fmt(t.printed) + '</span><span class="s">' + (t.print_bad ? t.print_bad + ' failed' : 'of ' + o) + '</span></div>' +
                    '<div class="kpi ' + (W2.n(t.to_cancel) ? 'warn' : '') + '"><span class="l">Lines to cancel</span><span class="n">' + W2.fmt(t.to_cancel) + '</span><span class="s">' + W2.fmt(t.cancelled_w2) + ' cancelled by autopilot</span></div>' +
                    (wms ? '<div class="kpi" id="t-load"><span class="l">Lorry load</span><span class="n">…</span><span class="s">m³ from the WMS trip page</span></div>' : '') + '</div>' +
                    (wms ? '<div id="t-wms" class="t-wms"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Opening the WMS trip page…</div></div>'
                        : '<div class="card" style="margin-top:12px"><h3><i class="fa-solid fa-file-lines"></i>Orders <small>click an order for its details</small></h3><div id="t-ord"></div></div>');
                main.innerHTML = h;
                main.querySelector('#t-back').onclick = function () { W2.tt.show('list'); };
                main.querySelector('#t-ref').onclick = function () { W2.trip.refresh(trip); };
                main.querySelector('#t-rel').onclick = function () { W2.go('pickrelease', { trip: trip }); };
                main.querySelector('#t-mra').onclick = function () { W2.go('mra', { trip: trip }); };
                main.querySelectorAll('[data-view]').forEach(function (b) { b.onclick = function () { W2.tt.setView(trip, b.dataset.view); W2.render(); }; });
                main.querySelectorAll('[data-a]').forEach(function (b) {
                    b.onclick = function () {
                        var a = b.dataset.a;
                        if (a === 'unassign') return W2.ws.unassignPicker(live0.filter(function (x) { return x.picker; })).then(function () { W2.render(); });
                        if (a === 'assign') return W2.ws.run(trip, 'assignPickerToTrip', (noPick.length ? noPick : live0).map(num));
                        if (a === 'pickReleaseAll') return W2.ws.run(trip, a, (notRel.length ? notRel : live0.filter(function (x) { return s2v.indexOf(x) < 0; })).map(num));
                        if (a === 'allocateLotsForS2V') return W2.ws.run(trip, a, s2v.map(num));
                        W2.ws.run(trip, a);
                    };
                });
                if (wms) {
                    var box = main.querySelector('#t-wms');
                    W2.ws.mount(box, trip).then(function () {
                        var e = box.querySelector('.empty'); if (e) e.remove();
                        if (!live()) return;
                        // lorry load: the WMS rows' order volume vs the vehicle's capacity (what the hidden WMS summary card showed)
                        var rows = (window.tripOrdersStore || {})[trip] || [], vol = 0;
                        rows.forEach(function (r) { vol += parseFloat(r.order_volume1 != null ? r.order_volume1 : (r.ORDER_VOLUME || r.order_volume || 0)) || 0; });
                        var norm = function (v) { return String(v || '').replace(/\s+/g, '').toUpperCase(); }, lorry = norm(t.lorry);
                        var veh = (window.vehiclesData || []).filter(function (v) { return norm(v.lorry_number || v.LORRY_NUMBER) === lorry; })[0];
                        var cap = veh ? parseFloat(veh.volume_m3 || veh.VOLUME_M3 || 0) || 0 : 0, k = main.querySelector('#t-load');
                        if (k) {
                            var pc = cap ? Math.round(100 * vol / cap) : 0;
                            k.className = 'kpi' + (pc > 100 ? ' bad' : pc > 90 ? ' warn' : '');
                            k.innerHTML = '<span class="l">Lorry load</span><span class="n">' + (cap ? pc + '%' : vol.toFixed(2)) + '</span><span class="s">' + vol.toFixed(2) + ' m³' + (cap ? ' of ' + cap.toFixed(2) + ' m³' : ' · capacity unknown') + '</span>';
                        }
                    }, function (e) { box.innerHTML = '<div class="callout bad">' + esc(e) + '</div>'; });
                } else W2.grid(main.querySelector('#t-ord'), orders, W2.ORDER_COLS(false), { onRow: function (row) { W2.orderPanel(row); }, csv: 'trip-' + trip + '.csv' });
                if (params.order) { var x = orders.filter(function (y) { return y.order_number === params.order; })[0]; if (x) W2.orderPanel(x); }
            });
        }
    });

    // ── Trips area with tabs: the list + one tab per opened trip (Trip 360), per instance and trip date ──
    var TT = W2.tt = {};
    function ttKey() { return 'w2.tt.' + W2.pod() + '|' + W2.date(); }
    TT.get = function () {
        var st = null; try { st = JSON.parse(sessionStorage.getItem(ttKey()) || 'null'); } catch (e) {}
        st = st || { tabs: [], active: 'list' };
        if (st.active !== 'list' && st.tabs.indexOf(st.active) < 0) st.active = 'list';
        return st;
    };
    TT.save = function (st) { try { sessionStorage.setItem(ttKey(), JSON.stringify(st)); } catch (e) {} };
    /** Opens a trip as a tab (background = keep the current tab on screen). */
    TT.open = function (trip, background) {
        trip = String(trip); var st = TT.get();
        if (st.tabs.indexOf(trip) < 0) st.tabs.push(trip);
        if (!background) st.active = trip;
        TT.save(st);
        if (background) { W2.toast('Trip ' + trip + ' opened in a tab.', 'info'); paintTabs(); return; }
        W2.go('trips');
    };
    TT.show = function (tab) { var st = TT.get(); st.active = String(tab); TT.save(st); W2.go('trips'); };
    TT.close = function (trip) {
        var st = TT.get(), i = st.tabs.indexOf(String(trip)); if (i < 0) return;
        st.tabs.splice(i, 1); if (W2.ws) W2.ws.drop(String(trip));
        if (st.active === String(trip)) st.active = st.tabs[Math.min(i, st.tabs.length - 1)] || 'list';
        TT.save(st); W2.go('trips');
    };
    TT.closeAll = function () { TT.get().tabs.forEach(function (t) { if (W2.ws) W2.ws.drop(t); }); TT.save({ tabs: [], active: 'list' }); W2.go('trips'); };
    /** Per trip tab: 'wms' (the WMS trip page under the timeline + cards, default) or 'insights' (WMS 2.0 orders view). */
    TT.view = function (trip) { var v = TT.get().views || {}; return v[String(trip)] || 'wms'; };
    TT.setView = function (trip, view) { var st = TT.get(); st.views = st.views || {}; st.views[String(trip)] = view; TT.save(st); };

    var tripInfo = {};
    function paintTabs() {
        var bar = document.getElementById('tt-bar'); if (!bar) return;
        var st = TT.get();
        var tab = function (id, html, extra) {
            return '<button class="tt' + (st.active === id ? ' on' : '') + '" data-tt="' + esc(id) + '"' + (extra || '') + '>' + html + '</button>';
        };
        bar.innerHTML = tab('list', '<i class="fa-solid fa-list"></i> All trips <span class="muted">' + (tripInfo.count != null ? tripInfo.count : '') + '</span>') +
            st.tabs.map(function (t) {
                var x = tripInfo[t] || {}, o = W2.n(x.orders) - W2.n(x.cancelled), p = o ? Math.round(100 * W2.n(x.interfaced) / o) : 0;
                var risk = x.orders && (x.orders - x.with_picker > 0 || x.mra_bad || x.print_bad);
                return tab(t, '<i class="fa-solid fa-truck' + (risk ? ' warn' : '') + '"></i> <b class="mono">' + esc(t) + '</b>' + (x.lorry ? ' <span class="muted">' + esc(x.lorry) + '</span>' : '') +
                    '<span class="tp" title="' + p + '% interfaced"><b style="width:' + p + '%"></b></span><span class="x" data-x="' + esc(t) + '" title="Close (middle-click)">×</span>',
                    ' title="Trip ' + esc(t) + (x.orders ? ' · ' + x.orders + ' order(s) · ' + p + '% interfaced' : '') + '"');
            }).join('') +
            (st.tabs.length > 1 ? '<button class="tt ghost" data-closeall title="Close every trip tab"><i class="fa-solid fa-xmark"></i> Close all</button>' : '') +
            '<span class="grow"></span><span class="muted xs">Ctrl+click or middle-click a trip to open it in the background</span>';
        bar.querySelectorAll('[data-tt]').forEach(function (b) {
            b.onclick = function (e) { var x = e.target.closest('[data-x]'); if (x) { TT.close(x.dataset.x); return; } TT.show(b.dataset.tt); };
            b.onauxclick = function (e) { if (e.button === 1 && b.dataset.tt !== 'list') { e.preventDefault(); TT.close(b.dataset.tt); } };
        });
        var ca = bar.querySelector('[data-closeall]'); if (ca) ca.onclick = TT.closeAll;
    }

    W2.page('trips', {
        title: 'Trips', icon: 'fa-truck',
        render: function (main, params, live) {
            main.innerHTML = '<div class="ttbar" id="tt-bar"></div><div id="tt-body"></div>';
            var body = main.querySelector('#tt-body'), st = TT.get();
            W2.M.trips(W2.pod(), W2.date()).then(function (trips) {
                tripInfo = { count: trips.length }; trips.forEach(function (t) { tripInfo[String(t.trip_id)] = t; });
                if (live()) paintTabs();
            }).catch(function () {});
            paintTabs();
            if (st.active === 'list') return TRIPS_LIST.render(body, params, live);
            return TRIP_360.render(body, { trip: st.active, order: params.order, view: TT.view(st.active) }, live);
        }
    });
    /** Trip 360 links (dashboard, find, orders …) open the trip as a tab of the Trips area. */
    W2.page('trip', {
        title: 'Trip 360', icon: 'fa-truck-fast',
        render: function (main, params, live) {
            var trip = String(params.trip || ''), st = TT.get();
            if (trip) { if (st.tabs.indexOf(trip) < 0) st.tabs.push(trip); st.active = trip; TT.save(st); }
            W2.state.page = 'trips'; W2.state.params = { order: params.order };
            try { history.replaceState(null, '', '#trips'); } catch (e) {}
            document.querySelectorAll('#nav button[data-p]').forEach(function (b) { b.classList.toggle('on', b.dataset.p === 'trips'); });
            return W2.pages.trips.render(main, W2.state.params, live);
        }
    });

    W2.trip = {
        /** Reads one trip again: its lines (date), shipment lines of its orders, WMS order lines, print jobs, pickers. */
        refresh: function (trip) {
            var pod = W2.pod(), date = W2.date();
            W2.busy.start('Reading trip ' + trip + ' again…');
            return W2.q("SELECT DISTINCT order_number FROM w2_trip_lines WHERE pod = " + W2.lit(pod) + " AND trip_date = " + W2.lit(date) + " AND trip_id = " + W2.lit(trip)).then(function (r) {
                var orders = r.map(function (x) { return x.order_number; }), rows = [], ck = [];
                return W2.pool(orders, 6, function (o) {
                    return W2.sync.shipOne(pod, date, o).then(function (x) { rows = rows.concat(x); ck.push({ pod: pod, trip_date: date, order_number: o, lines: String(x.length), checked_at: W2.now(), error: '' }); },
                        function (e) { ck.push({ pod: pod, trip_date: date, order_number: o, lines: '', checked_at: W2.now(), error: String(e).slice(0, 300) }); });
                }).then(function () {
                    return W2.put('w2_ship_lines', { pod: pod, order_number: orders }, rows).then(function () { return W2.put('w2_ship_checked', { pod: pod, order_number: orders }, ck); });
                }).then(function () { return W2.sync.orderLinesTrip(pod, date, trip).catch(function () {}); })
                    .then(function () { return W2.sync.day(date, { only: ['print', 'pickers'], auto: true }); })
                    .then(function () { W2.busy.done('Trip ' + trip + ' read again (' + orders.length + ' order(s)).'); W2.render(); });
            }).catch(function (e) { W2.busy.done('Could not read trip ' + trip + ': ' + e, true); });
        }
    };

    // ── All orders of the date ───────────────────────────────
    W2.page('orders', {
        title: 'Orders', icon: 'fa-file-lines',
        render: function (main, params, live) {
            return W2.M.orders().then(function (orders) {
                if (!live()) return;
                var m = MISSING[params.missing], list = orders;
                if (m) list = orders.filter(function (o) { return o.stage !== 'CANCELLED' && m[1](o); });
                if (params.stage) list = list.filter(function (o) { return o.stage === params.stage; });
                var counts = {}; orders.forEach(function (o) { counts[o.stage] = (counts[o.stage] || 0) + 1; });
                main.innerHTML = '<div class="pagehead"><h2>Orders · ' + W2.dayName(W2.date()) + '</h2>' + (m ? '<span class="tag warn">' + list.length + ' ' + m[0] + '</span>' : params.stage ? '<span class="tag info">' + esc(params.stage) + '</span>' : '') +
                    ((m || params.stage) ? '<button class="btn sm" id="o-all">Show all ' + orders.length + '</button>' : '') + '<span class="grow"></span>' +
                    Object.keys(MISSING).map(function (k) { return '<button class="btn sm ' + (params.missing === k ? 'primary' : '') + '" data-m="' + k + '">' + MISSING[k][0] + '</button>'; }).join('') + '</div>' +
                    '<div class="row" style="margin-bottom:10px">' + Object.keys(counts).map(function (s) { return '<span style="cursor:pointer" data-s="' + esc(s) + '">' + W2.stagePill(s) + ' <b>' + counts[s] + '</b></span>'; }).join(' ') + '</div><div id="o-grid"></div>';
                var all = main.querySelector('#o-all'); if (all) all.onclick = function () { W2.go('orders'); };
                main.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { W2.go('orders', { missing: b.dataset.m }); }; });
                main.querySelectorAll('[data-s]').forEach(function (b) { b.onclick = function () { W2.go('orders', { stage: b.dataset.s }); }; });
                W2.grid(main.querySelector('#o-grid'), list, W2.ORDER_COLS(true), { onRow: function (o) { W2.orderPanel(o); }, csv: 'orders-' + W2.date() + '.csv' });
            });
        }
    });

    // ── order side panel ─────────────────────────────────────
    W2.orderPanel = function (o) {
        var pod = W2.pod(), date = W2.date(), on = o.order_number;
        var d = W2.drawer('Order <span class="mono">' + esc(on) + '</span> <span class="muted" style="font-weight:500">· trip ' + esc(o.trip_id) + '</span>',
            '<div class="row">' + W2.stagePill(o.stage) + W2.mraPill(o.mra) + W2.printPill(o.print_state) + (o.picker ? '<span class="pill b"><i class="fa-solid fa-user"></i>' + esc(o.picker) + '</span>' : '<span class="pill w">no picker</span>') + '</div>' +
            '<div class="muted sm">' + esc(o.account_name || '') + ' · ' + esc(o.order_type || '') + ' · ' + W2.n(o.wms_lines) + ' WMS line(s)</div>' +
            '<div class="row"><button class="btn primary sm" id="op-open"><i class="fa-solid fa-up-right-from-square"></i> Order details</button>' +
            '<button class="btn sm" id="op-ref"><i class="fa-solid fa-rotate"></i> Read again</button>' +
            '<button class="btn sm" id="op-mra"' + (o.stage === 'INTERFACED' ? '' : ' disabled title="MRA needs every line interfaced"') + '><i class="fa-solid fa-receipt"></i> Send to MRA</button>' +
            '<button class="btn sm" id="op-rel"><i class="fa-solid fa-dolly"></i> Pick release</button></div>' +
            '<div class="row"><button class="btn sm" id="op-pick"><i class="fa-solid fa-user-plus"></i> ' + (o.picker ? 'Change picker' : 'Assign picker') + '</button>' +
            (o.picker ? '<button class="btn sm" id="op-unpick"><i class="fa-solid fa-user-minus"></i> Unassign picker</button>' : '') +
            '<button class="btn sm" id="op-move"><i class="fa-solid fa-right-left"></i> Move to another trip</button>' +
            '<button class="btn sm" id="op-print"><i class="fa-solid fa-print"></i> Print</button>' +
            '<button class="btn sm danger" id="op-del"><i class="fa-solid fa-trash"></i> Remove from trip</button></div>' +
            '<div class="card"><h3>Fusion shipment lines <small>' + (o.ship_checked_at ? 'read ' + W2.ago(o.ship_checked_at) : 'not read yet') + '</small></h3><div id="op-sl"></div></div>' +
            '<div class="card"><h3>WMS order lines <small>Scheduled / Manual Reservation = cancelled by the autopilot</small></h3><div id="op-ol"></div></div>' +
            '<div class="card"><h3>MRA</h3><div id="op-mralog" class="sm"></div></div>' +
            '<div class="card"><h3>Print jobs</h3><div id="op-pr"></div></div>' +
            '<div class="card"><h3>Cancellations by the autopilot</h3><div id="op-cl"></div></div>');
        d.querySelector('#op-open').onclick = function () { W2.openOrderDialog(o); };
        d.querySelector('#op-ref').onclick = function () {
            W2.sync.shipOne(pod, date, on).then(function (rows) {
                return W2.put('w2_ship_lines', { pod: pod, order_number: on }, rows).then(function () { return W2.put('w2_ship_checked', { pod: pod, order_number: on }, [{ pod: pod, trip_date: date, order_number: on, lines: String(rows.length), checked_at: W2.now(), error: '' }]); });
            }).then(function () { return W2.sync.orderLinesTrip(pod, date, o.trip_id); }).then(function () {
                return W2.q(W2.M.ordersSql(pod, date) + " SELECT * FROM o2 WHERE order_number = " + W2.lit(on));
            }).then(function (r) { if (r[0]) W2.orderPanel(r[0]); W2.toast('Order ' + on + ' read again.', 'success'); }, function (e) { W2.toast('Could not read ' + on + ': ' + e, 'error'); });
        };
        d.querySelector('#op-mra').onclick = function () { if (W2.MRA) W2.MRA.send([o]); };
        d.querySelector('#op-rel').onclick = function () { W2.go('pickrelease', { trip: o.trip_id, order: on }); d.remove(); };
        // the WMS trip page's per-order actions (copied WMS code)
        var row = W2.legacyRow(o);
        d.querySelector('#op-pick').onclick = function () { d.remove(); W2.ws.run(o.trip_id, 'assignPickerToTrip', [on]); };
        var up = d.querySelector('#op-unpick'); if (up) up.onclick = function () { W2.ws.unassignPicker([o]).then(function () { d.remove(); W2.render(); }); };
        d.querySelector('#op-move').onclick = function () {
            window.currentTripInstance = pod;
            window.openMoveOrderToTrip({ orderNumber: on, fromTripId: o.trip_id, instance: pod, row: row });
            W2.ws.dirty = true; d.remove();
        };
        d.querySelector('#op-print').onclick = function () { window.printStoreTransaction(on, pod, o.order_type || row.ORDER_TYPE || '', o.trip_id, row.TRIP_DATE || W2.date()); };
        d.querySelector('#op-del').onclick = function () {
            window.currentTripInstance = pod;
            window.deleteTripOrder(o.trip_id, on, pod);
            W2.ws.dirty = true; d.remove();
        };
        W2.qs([
            "SELECT line, item, line_status, bucket, requested_qty, staged_qty, shipped_qty FROM w2_ship_lines WHERE pod = " + W2.lit(pod) + " AND order_number = " + W2.lit(on) + " ORDER BY TRY_CAST(line AS DOUBLE), line",
            "SELECT line_number, item, status, ordered_qty, fulfill_line_id, CASE WHEN " + W2.M.FLAG + " THEN 1 ELSE 0 END AS flag FROM w2_order_lines WHERE pod = " + W2.lit(pod) + " AND order_number = " + W2.lit(on) + " ORDER BY TRY_CAST(line_number AS DOUBLE), line_number",
            "SELECT status, irn, msg, checked_at, source, timings, log FROM w2_mra WHERE pod = " + W2.lit(pod) + " AND order_number = " + W2.lit(on) + " ORDER BY checked_at DESC",
            "SELECT overall_status, print_status, download_status, retry_count, error_message, print_completed, changed FROM w2_print WHERE order_number = " + W2.lit(on) + " ORDER BY changed DESC",
            "SELECT ts, line_number, item, status_before, via, result, message FROM w2_cancel_log WHERE pod = " + W2.lit(pod) + " AND order_number = " + W2.lit(on) + " ORDER BY ts DESC"
        ]).then(function (r) {
            W2.grid(d.querySelector('#op-sl'), r[0], [{ k: 'line', t: 'Line' }, { k: 'item', t: 'Item' }, { k: 'line_status', t: 'Status' }, { k: 'requested_qty', t: 'Qty', num: true }, { k: 'staged_qty', t: 'Staged', num: true }, { k: 'shipped_qty', t: 'Shipped', num: true }], { empty: 'No shipment lines read.', max: 300 });
            W2.grid(d.querySelector('#op-ol'), r[1], [{ k: 'line_number', t: 'Line' }, { k: 'item', t: 'Item' }, { k: 'status', t: 'Status', fmt: function (v, l) { return l.flag == 1 ? '<span class="pill w">' + esc(v) + '</span>' : esc(v); } }, { k: 'ordered_qty', t: 'Qty', num: true }], { empty: 'No WMS order lines read (Refresh › order lines).', max: 300 });
            var m = r[2][0];
            d.querySelector('#op-mralog').innerHTML = m ? W2.mraPill(m.status) + ' ' + esc(m.irn ? 'IRN ' + m.irn : '') + ' <span class="muted">' + esc(m.msg || '') + ' · ' + W2.ago(m.checked_at) + ' (' + esc(m.source || '') + ')</span>' + (m.log ? ' <button class="btn sm" id="op-mralog-b"><i class="fa-solid fa-file-lines"></i> Log</button>' : '') : '<span class="muted">Not checked yet.</span>';
            var lb = d.querySelector('#op-mralog-b'); if (lb && W2.MRA) lb.onclick = function () { W2.MRA.showLog(on, m); };
            W2.grid(d.querySelector('#op-pr'), r[3], [{ k: 'overall_status', t: 'Status' }, { k: 'print_status', t: 'Print' }, { k: 'download_status', t: 'Download' }, { k: 'retry_count', t: 'Tries' }, { k: 'error_message', t: 'Error' }, { k: 'changed', t: 'Changed' }], { empty: 'No print job.', max: 50 });
            W2.grid(d.querySelector('#op-cl'), r[4], [{ k: 'ts', t: 'When' }, { k: 'line_number', t: 'Line' }, { k: 'item', t: 'Item' }, { k: 'status_before', t: 'Was' }, { k: 'via', t: 'Why' }, { k: 'result', t: 'Result' }, { k: 'message', t: 'Message' }], { empty: 'Nothing cancelled on this order.', max: 100 });
        });
    };

    /** Opens the copied WMS dialog for an order with its original GETTRIPDETAILS/ALL row (same fields the WMS grid passes). */
    W2.legacyRow = function (o) {
        var row = {}; try { row = JSON.parse(o.raw || o.raw_json || '{}'); } catch (e) {}
        row.ORDER_NUMBER = row.ORDER_NUMBER || o.order_number; row.TRIP_ID = row.TRIP_ID || o.trip_id; row.TRIP_DATE = row.TRIP_DATE || W2.date();
        row.ORDER_TYPE = row.ORDER_TYPE || o.order_type; row.ACCOUNT_NAME = row.ACCOUNT_NAME || o.account_name; row.ACCOUNT_NUMBER = row.ACCOUNT_NUMBER || o.account_number;
        return row;
    };
    W2.openOrderDialog = function (o) {
        var row = {}; try { row = JSON.parse(o.raw || '{}'); } catch (e) {}
        row.ORDER_NUMBER = row.ORDER_NUMBER || o.order_number; row.TRIP_ID = row.TRIP_ID || o.trip_id; row.TRIP_DATE = row.TRIP_DATE || W2.date();
        row.ORDER_TYPE = row.ORDER_TYPE || o.order_type; row.ACCOUNT_NAME = row.ACCOUNT_NAME || o.account_name; row.ACCOUNT_NUMBER = row.ACCOUNT_NUMBER || o.account_number;
        row.PICKER = row.PICKER || o.picker || ''; row.instance_name = row.instance_name || row.INSTANCE_NAME || W2.pod();
        window.currentTripInstance = W2.pod();
        if (typeof window.editTripOrder === 'function') window.editTripOrder(row);
        else W2.toast('The order dialogs are not loaded.', 'error');
    };
})();
