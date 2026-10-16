// ============================================================================
// TRIP DETAILS › SUMMARY — the WMS 2.0 trip header (stage timeline + KPI cards) on the WMS trip page
// ----------------------------------------------------------------------------
// app.js draws the "Trip Summary & Statistics" card (Trip Date, Lorry, Orders, Customers, Loading Bay, Volume, Products,
// Priority tiles) when a trip opens. This script does not change app.js: once the trip grid has its rows it redraws the
// INSIDE of that card as WMS 2.0 draws a trip — one header line (trip · lorry · bay · priority · date), the stage timeline
// On trip › Pickers › Released › Picked › Shipped › Interfaced › MRA › Printed (n / n per stage, from the GETTRIPDETAILS
// columns: picker, PICK_RELEASE_STATUS / picks_count / RELEASE_DATE, PICK_CONFIRM_ST, SHIP_CONFIRM_ST, LINE_STATUS Closed,
// MRA_STATUS of future-trip.js, PRINTING_ST) and the KPI cards Orders · Shipped · Without picker · MRA · Printed · Lines ·
// Lorry load (volume like the old tile: order_volume1 … vs volume_m3 / vehiclesData). A click on a stage or a card filters
// the grid to those orders (click again, or ✕, to clear) — the grid itself is untouched.
// The old tiles' ids (kpi-date-…, kpi-volume-…) stay in the card as hidden spans, so the updates app.js makes after Edit Trip
// or Refresh still land, and a MutationObserver on them redraws the header line. The redraw runs after openTripDetailsWithData
// / refreshTripDetails (when the grid shows the new rows) and after wmsAddPickerDates (MRA / picker date columns).
// Styles: wms/trip-summary.css. WMS 2.0 hides this card in its trip tabs (it has its own timeline).
// ============================================================================
(function () {
    'use strict';
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    function pick(row, names) {
        if (!row) return '';
        var keys = Object.keys(row);
        for (var i = 0; i < names.length; i++) {
            var k = keys.find(function (x) { return x.toLowerCase() === names[i].toLowerCase(); });
            if (k && row[k] != null && row[k] !== '') return row[k];
        }
        return '';
    }
    var yes = function (v) { return /^(Y|YES|TRUE|1|DONE|COMPLETE|COMPLETED|RELEASED|PRINTED|SUCCESS|OK)$/i.test(String(v == null ? '' : v).trim()); };
    var num = function (v) { var x = parseFloat(v); return isFinite(x) ? x : 0; };
    var fmt = function (v, d) { return num(v).toLocaleString(undefined, { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
    var pct = function (a, b) { return b ? Math.round(100 * a / b) : 0; };
    function orderOf(r) { return String(pick(r, ['ORDER_NUMBER', 'order_number', 'SOURCE_ORDER_NUMBER']) || '').trim(); }
    function dateOnly(v) { var s = String(v == null ? '' : v), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? m[3] + '-' + m[2] + '-' + m[1] : s.split('T')[0]; }
    /** "Today" / "Tomorrow" / "Yesterday" / the weekday for a yyyy-mm-dd (or dd-mm-yyyy) date, '' otherwise. */
    function dayName(v) {
        var s = String(v || ''), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s) || (function (x) { return x ? [0, x[3], x[2], x[1]] : null; })(/^(\d{2})-(\d{2})-(\d{4})/.exec(s));
        if (!m) return '';
        var d = new Date(+m[1], +m[2] - 1, +m[3]), t = new Date(); t.setHours(0, 0, 0, 0);
        var diff = Math.round((d - t) / 86400000);
        return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
    }

    // ─── the facts of one trip from its grid rows ───────────────────────────
    function grid(tripId) {
        try { var el = window.$ && $('#grid-trip-detail-' + tripId); return el && el.length ? el.dxDataGrid('instance') : null; } catch (e) { return null; }
    }
    function rowsOf(tripId) {
        var g = grid(tripId), ds = g && g.option('dataSource');
        if (Array.isArray(ds)) return ds;
        return (window.tripOrdersStore && window.tripOrdersStore[tripId]) || [];
    }
    var MRA_OK = { SUCCESS: 1, ALREADY_DONE: 1 };
    /** Per order: the stage flags; per trip: the counts the timeline and cards show. */
    function facts(tripId, rows) {
        var live = rows.filter(function (r) { return orderOf(r) && !/^cancel/i.test(String(pick(r, ['LINE_STATUS', 'line_status', 'STATUS']) || '')); });
        var t = { orders: live.length, cancelled: rows.length - live.length, picker: 0, released: 0, picked: 0, shipped: 0, closed: 0, mra: 0, mraBad: 0, mraNone: 0, printed: 0, printBad: 0,
            lines: 0, notPicked: 0, volume: 0, customers: new Set(), products: new Set(), pickers: {}, sets: {} };
        var S = t.sets; ['ontrip', 'picker', 'nopicker', 'released', 'notreleased', 'picked', 'notpicked', 'shipped', 'notshipped', 'closed', 'notclosed', 'mra', 'mrabad', 'nomra', 'printed', 'notprinted'].forEach(function (k) { S[k] = []; });
        live.forEach(function (r) {
            var o = orderOf(r);
            S.ontrip.push(o);
            var pk = String(pick(r, ['picker', 'PICKER', 'PICKER_NAME', 'picker_name']) || '').trim();
            if (pk) { t.picker++; t.pickers[pk] = (t.pickers[pk] || 0) + 1; S.picker.push(o); } else S.nopicker.push(o);
            var picked = yes(pick(r, ['PICK_CONFIRM_ST', 'pick_confirm_st']));
            var shipped = yes(pick(r, ['SHIP_CONFIRM_ST', 'ship_confirm_st']));
            var st = String(pick(r, ['LINE_STATUS', 'line_status', 'STATUS']) || '');
            var closed = /closed|interfac|billing|billed|invoic|shipped/i.test(st);   // the shipment is interfaced once the order line reads Shipped / Awaiting Billing / Closed
            var released = picked || shipped || closed || yes(pick(r, ['PICK_RELEASE_STATUS', 'pick_release_status'])) || num(pick(r, ['picks_count', 'PICKS_COUNT'])) > 0 ||
                num(pick(r, ['lot_count', 'LOT_COUNT'])) > 0 || !!pick(r, ['PICK_SLIP_NO', 'pick_slip_no', 'RELEASE_DATE', 'release_date']);
            if (released) { t.released++; S.released.push(o); } else S.notreleased.push(o);
            if (picked) { t.picked++; S.picked.push(o); } else S.notpicked.push(o);
            if (shipped) { t.shipped++; S.shipped.push(o); } else S.notshipped.push(o);
            if (closed) { t.closed++; S.closed.push(o); } else S.notclosed.push(o);
            var m = String(pick(r, ['MRA_STATUS', 'mra_status']) || '').toUpperCase();
            if (MRA_OK[m]) { t.mra++; S.mra.push(o); } else { S.nomra.push(o); if (m === 'FAILED') { t.mraBad++; S.mrabad.push(o); } else if (!m) t.mraNone++; }
            var p = String(pick(r, ['PRINTING_ST', 'printing_st']) || '');
            if (yes(p)) { t.printed++; S.printed.push(o); } else { S.notprinted.push(o); if (/fail|error/i.test(p)) t.printBad++; }
            t.lines += num(pick(r, ['order_lines', 'ORDER_LINES', 'line_count', 'LINE_COUNT']));
            t.notPicked += num(pick(r, ['not_picked', 'NOT_PICKED', 'not_picked_count']));
            var vol = r.order_volume1; if (vol == null) vol = r.ORDER_VOLUME1; if (vol == null) vol = r.order_volume; if (vol == null) vol = r.ORDER_VOLUME != null ? r.ORDER_VOLUME : (r.weight != null ? r.weight : r.WEIGHT);
            t.volume += num(vol);
            var c = pick(r, ['account_name', 'ACCOUNT_NAME', 'CUSTOMER_NAME']); if (c) t.customers.add(c);
            var pr = pick(r, ['PRODUCT_NAME', 'item_name', 'ITEM_NAME']); if (pr) t.products.add(pr);
        });
        var f = rows[0] || {}, lorry = pick(f, ['LORRY_NUMBER', 'trip_lorry', 'TRIP_LORRY', 'lorry_number']) || legacy(tripId, 'lorry');
        t.lorry = lorry; t.date = pick(f, ['TRIP_DATE', 'trip_date', 'tripdate']) || legacy(tripId, 'date');
        t.bay = pick(f, ['LOADING_BAY', 'loading_bay', 'TRIP_LOADING_BAY', 'trip_loading_bay']) || legacy(tripId, 'loading-bay');
        t.priority = pick(f, ['TRIP_PRIORITY', 'trip_priority', 'PRIORITY']) || legacy(tripId, 'priority');
        t.instance = pick(f, ['INSTANCE_NAME', 'instance_name', 'INSTANCE', 'instance']) || window.currentTripInstance || '';
        // lorry capacity like the old tile: the handler's volume_m3, else vehiclesData by lorry number
        t.capacity = num(pick(f, ['volume_m3', 'VOLUME_M3']));
        if (!t.capacity && lorry && window.vehiclesData && window.vehiclesData.length) {
            var norm = function (v) { return String(v || '').replace(/\s+/g, '').toUpperCase(); }, L = norm(lorry);
            var veh = window.vehiclesData.find(function (v) { return norm(v.lorry_number || v.LORRY_NUMBER) === L; });
            if (veh) t.capacity = num(veh.volume_m3 || veh.VOLUME_M3);
        }
        return t;
    }
    /** A value of the hidden legacy tiles (app.js keeps writing them: Edit Trip, Refresh). */
    function legacy(tripId, k) {
        var el = document.getElementById('kpi-' + k + '-trip-detail-' + tripId);
        var v = el ? el.textContent.trim() : '';
        return v && v !== 'N/A' ? v : '';
    }

    // ─── drawing ────────────────────────────────────────────────────────────
    var filterOn = {};   // tripId → key of the active stage / card filter
    function paint(tripId) {
        var tabId = 'trip-detail-' + tripId, body = document.getElementById('trip-summary-' + tabId);
        if (!body) return false;
        var rows = rowsOf(tripId), t = facts(tripId, rows), o = t.orders;
        var head = body.parentElement && body.parentElement.querySelector('[onclick^="toggleTripSummary"]');
        if (head) {
            var left = head.firstElementChild;
            if (left && !left.classList.contains('ts2-head')) {
                left.className = 'ts2-head';
                var ic = left.querySelector('i.fas'); if (ic) ic.className = 'fas fa-truck-fast';
            }
            var txt = left && left.children[1];
            if (txt) {
                var day = dayName(t.date);
                txt.innerHTML = '<h2>Trip <span class="mono">' + esc(tripId) + '</span></h2>' +
                    '<div class="ts2-sub">' + [t.lorry && '<b>' + esc(t.lorry) + '</b>', t.bay && 'bay ' + esc(t.bay), t.priority && 'priority ' + esc(t.priority), t.date && esc(dateOnly(t.date)), t.instance && esc(t.instance)].filter(Boolean).join(' · ') +
                    (day ? ' <span class="ts2-day">' + day + '</span>' : '') + '</div>';
            }
        }
        var tl = [
            ['ontrip', 'On trip', o, o], ['picker', 'Pickers', t.picker, o], ['released', 'Released', t.released, o], ['picked', 'Picked', t.picked, o],
            ['shipped', 'Shipped', t.shipped, o], ['closed', 'Interfaced', t.closed, o], ['mra', 'MRA', t.mra, Math.max(t.closed, t.mra) || o], ['printed', 'Printed', t.printed, o]
        ];
        var on = filterOn[tripId] || '';
        var pickers = Object.keys(t.pickers).sort(function (a, b) { return t.pickers[b] - t.pickers[a]; });
        var cap = t.capacity, loadPc = cap ? Math.round(100 * t.volume / cap) : 0;
        var kpis = [
            { k: 'ontrip', l: 'Orders', n: fmt(o), s: t.customers.size + ' customer' + (t.customers.size === 1 ? '' : 's') + (t.products.size ? ' · ' + t.products.size + ' product' + (t.products.size === 1 ? '' : 's') : '') + (t.cancelled ? ' · ' + t.cancelled + ' cancelled' : ''), cls: '' },
            { k: 'shipped', l: 'Shipped', n: pct(t.shipped, o) + '%', s: fmt(t.shipped) + ' of ' + fmt(o) + ' ship confirmed', cls: o && t.shipped >= o ? 'good' : '', bar: pct(t.shipped, o) },
            { k: 'nopicker', l: 'Without picker', n: fmt(o - t.picker), s: pickers.length ? pickers.slice(0, 4).join(', ') + (pickers.length > 4 ? ' +' + (pickers.length - 4) : '') : 'no picker yet', cls: o - t.picker ? 'warn' : '', title: pickers.map(function (p) { return p + ': ' + t.pickers[p]; }).join('\n') },
            { k: t.mraBad ? 'mrabad' : 'mra', l: 'MRA', n: fmt(t.mra), s: t.mraBad ? t.mraBad + ' failed' : t.mra ? (t.mra >= (t.closed || o) ? 'done' : 'of ' + fmt(Math.max(t.closed, t.mra) || o) + ' interfaced') : 'not sent yet', cls: t.mraBad ? 'bad' : (o && t.mra >= o ? 'good' : '') },
            { k: 'printed', l: 'Printed', n: fmt(t.printed), s: t.printBad ? t.printBad + ' failed' : 'of ' + fmt(o), cls: t.printBad ? 'bad' : (o && t.printed >= o ? 'good' : '') },
            { k: 'notpicked', l: 'Lines', n: fmt(t.lines), s: t.notPicked ? fmt(t.notPicked) + ' not picked yet' : (t.lines ? 'all picked' : 'WMS line(s)'), cls: t.notPicked ? 'warn' : '' },
            { k: '', l: 'Lorry load', n: cap ? loadPc + '%' : t.volume.toFixed(2), s: t.volume.toFixed(2) + ' m³' + (cap ? ' of ' + cap.toFixed(2) + ' m³' : ' · capacity unknown'), cls: loadPc > 100 ? 'bad' : loadPc > 90 ? 'warn' : (cap ? 'good' : ''), bar: cap ? Math.min(loadPc, 100) : 0, title: cap ? 'Available: ' + Math.max(cap - t.volume, 0).toFixed(2) + ' m³' : 'No capacity for this lorry (Vehicles)' }
        ];
        var leg = body.querySelector('.ts2-legacy');
        var legacyHtml = leg ? leg.outerHTML : legacyBlock(tabId, body, t);
        body.classList.add('ts2');
        body.innerHTML =
            '<div class="ts2-card"><div class="tl">' + tl.map(function (s) {
                var cls = !s[3] ? '' : s[2] >= s[3] ? 'd' : s[2] > 0 ? 'p' : '';
                return '<div class="' + cls + (on === s[0] ? ' on' : '') + '" data-k="' + s[0] + '" title="Click: show these orders in the grid">' + s[1] + '<small>' + fmt(s[2]) + ' / ' + fmt(s[3]) + '</small></div>';
            }).join('') + '</div></div>' +
            '<div class="kpis">' + kpis.map(function (k) {
                return '<div class="kpi ' + k.cls + (k.k && on === k.k ? ' on' : '') + '"' + (k.k ? ' data-k="' + k.k + '"' : '') + (k.title ? ' title="' + esc(k.title) + '"' : '') + '>' +
                    '<span class="l">' + k.l + '</span><span class="n">' + k.n + '</span><span class="s">' + esc(k.s) + '</span>' +
                    (k.bar != null ? '<span class="bar"><b style="width:' + Math.min(k.bar, 100) + '%"></b></span>' : '') + '</div>';
            }).join('') + '</div>' +
            (on ? '<div class="ts2-filter"><i class="fas fa-filter"></i> Showing ' + esc(labelOf(on)) + ' · ' + fmt((t.sets[on] || []).length) + ' order' + ((t.sets[on] || []).length === 1 ? '' : 's') + ' <button type="button" title="Show every order again">✕</button></div>' : '') +
            legacyHtml;
        body.querySelectorAll('[data-k]').forEach(function (el) { el.addEventListener('click', function () { toggleFilter(tripId, el.dataset.k, t); }); });
        var x = body.querySelector('.ts2-filter button'); if (x) x.addEventListener('click', function () { toggleFilter(tripId, '', t); });
        watchLegacy(tripId, body);
        return true;
    }
    var LABELS = { ontrip: 'orders on the trip', picker: 'orders with a picker', nopicker: 'orders without a picker', released: 'released orders', notreleased: 'orders not released', picked: 'picked orders', notpicked: 'orders not picked',
        shipped: 'ship-confirmed orders', notshipped: 'orders not ship confirmed', closed: 'interfaced orders', notclosed: 'orders not interfaced', mra: 'orders MRA has', mrabad: 'orders MRA refused', nomra: 'orders not in MRA', printed: 'printed orders', notprinted: 'orders not printed' };
    function labelOf(k) { return LABELS[k] || k; }
    /** The old tiles' ids live on as hidden spans (app.js writes them after Edit Trip / Refresh; we read them back). */
    function legacyBlock(tabId, body, t) {
        var old = function (k, fallback) { var el = body.querySelector('#kpi-' + k + '-' + tabId); return el ? el.innerHTML : esc(fallback == null ? '' : fallback); };
        return '<div class="ts2-legacy" aria-hidden="true">' + ['date', 'lorry', 'orders', 'customers', 'loading-bay', 'volume', 'products', 'priority'].map(function (k) {
            var fb = k === 'date' ? t.date : k === 'lorry' ? t.lorry : k === 'orders' ? t.orders : k === 'customers' ? t.customers.size : k === 'loading-bay' ? t.bay : k === 'products' ? t.products.size : k === 'priority' ? t.priority : '';
            return '<span id="kpi-' + k + '-' + tabId + '">' + old(k, fb) + '</span>';
        }).join('') + '</div>';
    }
    var observers = {};
    function watchLegacy(tripId, body) {
        var leg = body.querySelector('.ts2-legacy'); if (!leg || !window.MutationObserver) return;
        if (observers[tripId]) observers[tripId].disconnect();
        var timer = null;
        observers[tripId] = new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(function () { paint(tripId); }, 150); });
        observers[tripId].observe(leg, { childList: true, characterData: true, subtree: true });
    }
    /** Stage / card click: the grid shows only those orders; the same click (or ✕) shows every order again. */
    function toggleFilter(tripId, key, t) {
        var g = grid(tripId);
        var next = filterOn[tripId] === key ? '' : key;
        filterOn[tripId] = next;
        if (g) {
            try {
                if (!next) g.clearFilter('dataSource');
                else { var set = {}; (t.sets[next] || []).forEach(function (o) { set[o] = 1; }); g.filter(function (r) { return !!set[orderOf(r)]; }); }
            } catch (e) { console.warn('[Trip summary] grid filter:', e); }
        }
        paint(tripId);
    }
    /** Waits until the grid shows rows it did not have before, then paints (as future-trip.js does for its columns). */
    function whenReady(tripId, before, tries) {
        tries = tries || 0;
        var g = grid(tripId), ds = g && g.option('dataSource');
        if (g && Array.isArray(ds) && ds !== before) { filterOn[tripId] = ''; paint(tripId); return; }
        if (!g && tries > 6 && (window.tripOrdersStore || {})[tripId]) { paint(tripId); return; }   // no DevExtreme grid: the stored rows
        if (tries < 90) setTimeout(function () { whenReady(tripId, before, tries + 1); }, 400);
    }
    window.wmsTripSummary = { paint: paint, facts: function (tripId) { return facts(tripId, rowsOf(tripId)); }, dayName: dayName };

    document.addEventListener('DOMContentLoaded', function () {
        setTimeout(function () {
            ['openTripDetailsWithData', 'refreshTripDetails'].forEach(function (name) {
                var orig = window[name]; if (typeof orig !== 'function' || orig.__ts2) return;
                var wrapped = function (tripId) {
                    var g = grid(tripId), before = g ? g.option('dataSource') : null;
                    var r = orig.apply(this, arguments);
                    setTimeout(function () { whenReady(tripId, before); }, 250);
                    return r;
                };
                wrapped.__ts2 = true;
                window[name] = wrapped;
            });
            // MRA / picker date columns arrive later (future-trip.js): paint again when they do
            var add = window.wmsAddPickerDates;
            if (typeof add === 'function' && !add.__ts2) {
                var w2 = function (g) {
                    var r = add.apply(this, arguments);
                    return Promise.resolve(r).then(function (x) {
                        try { var el = g && g.element && g.element(); var m = el && /grid-trip-detail-(.+)$/.exec(($(el).attr('id') || '')); if (m) paint(m[1]); } catch (e) { /* no grid id */ }
                        return x;
                    });
                };
                w2.__ts2 = true;
                window.wmsAddPickerDates = w2;
            }
        }, 10);   // after future-trip.js' own wrappers (its timeout 0 runs first)
    });
})();
