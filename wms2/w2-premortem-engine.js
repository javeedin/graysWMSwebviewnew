/* WMS 2.0 — Tomorrow check (pre-mortem): which orders of a trip date will most likely NOT leave as planned, and why.
   Pure functions (no DOM, no host) — used by w2-tomorrow.js and tested by wms2/tests/premortem.test.js.
   Input (all optional except orders):
     orders      o2 rows of the date (W2.M.ordersSql): order_number, trip_id, account_number, account_name, stage, picker,
                 mra, wms_lines, to_cancel, cancelled_w2, ship_err …
     cancelSets  { order_number: R.expand(...) } of the orders with Scheduled / Manual Reservation lines (W2.AP.preview)
     lineCounts  { order_number: { total, live } } — WMS order lines, live = not cancelled
     autopilotOn true when the cancellation autopilot runs for this instance
     mraOn       false when the MRA switch is N for this instance
     mraCustomers { customer key: { tries, failed, lastStatus, lastReason, lastStep, gw } } — WMS_MRA_INTERFACE_STATUS history
     mraGateway  { timeouts, tries, peakHour } — the gateway's last days
     pending     [{ order_number, account_name, account_number, order_date }] — pending orders not on a trip
     orderLinesRead  false when the WMS order lines of the date were never read (cancel prediction impossible)
   Output: { risks: [{ order, trip, customer, kind, sev 3 | 2 | 1, score, title, why, fix }], trips: [{ trip, orders, atRisk, high, readiness }],
             summary: { orders, atRisk, high, willNotShip, lines, byKind }, systemic: [{ kind, sev, title, why, fix }] } */
(function (root) {
    'use strict';
    var P = {};
    var DONE_MRA = ['SENT', 'DONE', 'ALREADY', 'SKIPPED', 'OFF'];
    var SHIPPED = ['INTERFACED', 'CANCELLED'];

    P.KINDS = {
        EMPTY: { label: 'Ships empty', icon: 'fa-box-open' },
        CANCEL: { label: 'Lines will be cancelled', icon: 'fa-ban' },
        STRANDED: { label: 'Free item / sub-line left behind', icon: 'fa-link-slash' },
        NOID: { label: 'Line cannot be cancelled', icon: 'fa-circle-exclamation' },
        GHOST: { label: 'Nothing to ship in Fusion', icon: 'fa-ghost' },
        STALE: { label: 'Cancelled but still on the trip', icon: 'fa-trash-can' },
        MRA_REPEAT: { label: 'Failed MRA already', icon: 'fa-receipt' },
        MRA_RISK: { label: 'MRA likely to fail', icon: 'fa-receipt' },
        NO_PICKER: { label: 'No picker', icon: 'fa-user-xmark' },
        UNKNOWN: { label: 'Not read from Fusion', icon: 'fa-circle-question' },
        DUPLICATE: { label: 'On two trips', icon: 'fa-clone' },
        ADD_ON: { label: 'Customer has another order waiting', icon: 'fa-cart-plus' }
    };

    P.custKey = function (o) { return String(o.account_number || o.customer_number || '').trim() || ('NAME:' + String(o.account_name || o.customer_name || '').trim().toUpperCase()); };

    /** MRA failure chance for a customer from its history: failed tries (gateway problems left out) ÷ tries, smoothed. */
    P.mraChance = function (h) {
        if (!h || !h.tries) return null;
        var real = Math.max(0, (h.failed || 0) - (h.gw || 0)), tries = Math.max(1, h.tries - (h.gw || 0));
        return (real + 0.5) / (tries + 2);
    };

    P.assess = function (input) {
        input = input || {};
        var orders = (input.orders || []).filter(function (o) { return o && o.order_number; });
        var sets = input.cancelSets || {}, counts = input.lineCounts || {}, hist = input.mraCustomers || {};
        var mraOn = input.mraOn !== false, risks = [], systemic = [], cutLines = 0;
        var add = function (o, kind, sev, score, title, why, fix) {
            risks.push({ order: o.order_number, trip: o.trip_id, customer: o.account_name || '', kind: kind, sev: sev, score: score, title: title, why: why, fix: fix });
        };

        // the same order on two trips of the date
        var tripsOf = {};
        orders.forEach(function (o) { (tripsOf[o.order_number] = tripsOf[o.order_number] || []).push(String(o.trip_id)); });

        orders.forEach(function (o) {
            var stage = o.stage || '';
            if (stage === 'CANCELLED') {
                add(o, 'STALE', 1, 10, 'Cancelled in Fusion but still on trip ' + o.trip_id, 'Every shipment line is cancelled — the lorry would carry nothing for it.', 'remove');
                return;
            }
            if (stage === 'INTERFACED') return;      // already shipped: nothing can go wrong tomorrow

            if (tripsOf[o.order_number].length > 1 && tripsOf[o.order_number][0] === String(o.trip_id))
                add(o, 'DUPLICATE', 2, 45, 'On ' + tripsOf[o.order_number].length + ' trips: ' + tripsOf[o.order_number].join(', '), 'It can only leave once — one of the trips will miss it.', 'trip');

            var transfer = /STORE|VAN|TRANSFER/i.test(o.order_type || '');   // store / van transfers move by store transactions, not shipments
            if (stage === 'NO LINES' && !transfer) add(o, 'GHOST', 3, 70, 'Fusion has no shipment lines for it', 'Nothing will be released or shipped; the trip shows it but the warehouse cannot pick it.', 'details');
            if (stage === 'NOT CHECKED') add(o, 'UNKNOWN', 1, 15, 'Not read from Fusion yet', o.ship_err ? 'The last read failed: ' + String(o.ship_err).slice(0, 120) : 'Refresh the date to know its shipment status.', 'refresh');

            // stock: Scheduled / Manual Reservation lines the autopilot (or a person) will cancel
            var set = sets[o.order_number];
            if (set && set.lines && set.lines.length) {
                var c = counts[o.order_number] || {}, live = c.live != null ? c.live : (c.total != null ? c.total : null);
                var cut = set.lines.length + (set.noId ? set.noId.length : 0);
                cutLines += cut;
                var main = set.lines.filter(function (x) { return x.via === 'MAIN'; }).length + (set.noId ? set.noId.length : 0);
                if (live != null && cut >= live) {
                    add(o, 'EMPTY', 3, 95, 'Every line is out of stock (' + cut + ' line' + (cut === 1 ? '' : 's') + ')',
                        'All its lines are Scheduled / Manual Reservation' + (input.autopilotOn ? ' — the autopilot will cancel them and the order ships empty.' : ' — nothing can be picked.'), 'future');
                } else {
                    add(o, 'CANCEL', 2, 55 + Math.min(20, cut * 2), cut + ' of ' + (live != null ? live : '?') + ' line(s) will be cancelled',
                        main + ' main line(s) Scheduled / Manual Reservation' + (set.children ? ' + ' + set.children + ' free item / sub-line(s) with them' : '') +
                        (input.autopilotOn ? ' — the autopilot cancels them (OUT OF STOCK).' : ' — the autopilot is off, so they block picking.'), 'details');
                }
                if (set.skipped && set.skipped.length)
                    add(o, 'STRANDED', 2, 50, set.skipped.length + ' free item / sub-line(s) stay without their main line',
                        set.skipped.map(function (s) { return (s.line.LINE_NUMBER || s.line.line_number || '?') + ' (' + s.via + ', ' + s.reason + ')'; }).slice(0, 4).join('; ') +
                        ' — the customer receives a free item for a product that is cancelled.', 'details');
                if (set.noId && set.noId.length)
                    add(o, 'NOID', 2, 48, set.noId.length + ' line(s) have no fulfilment line id', 'The autopilot cannot cancel them — cancel them by hand in the order details.', 'details');
            }

            // MRA: the order failed already, or its customer usually fails
            if (mraOn && !transfer) {
                if (o.mra === 'FAILED' || o.mra === 'CHECK FAILED') {
                    add(o, 'MRA_REPEAT', 3, 80, 'Already failed MRA', (o.mra_msg ? String(o.mra_msg).slice(0, 160) : 'The last try failed') + ' — it will fail again unless the cause is fixed.', 'mra');
                } else if (DONE_MRA.indexOf(o.mra) < 0) {
                    var h = hist[P.custKey(o)], ch = P.mraChance(h);
                    if (h && ch != null && ch >= 0.3 && (h.failed - (h.gw || 0)) >= 2)
                        add(o, 'MRA_RISK', ch >= 0.5 ? 3 : 2, Math.round(30 + ch * 50), Math.round(ch * 100) + '% chance MRA fails for this customer',
                            (h.failed - (h.gw || 0)) + ' of ' + (h.tries - (h.gw || 0)) + ' tries failed recently' + (h.lastReason ? ' — last: ' + String(h.lastReason).slice(0, 140) : '') +
                            (h.lastStep ? ' (step ' + h.lastStep + ')' : '') + '.', 'mra');
                    else if (h && h.lastStatus === 'FAILED' && (h.lastGw || '') === '')
                        add(o, 'MRA_RISK', 2, 40, 'This customer\'s last MRA try failed', h.lastReason ? String(h.lastReason).slice(0, 160) : 'Check the customer (BRN / VAT) before the trip.', 'mra');
                }
            }

            if (!o.picker && SHIPPED.indexOf(stage) < 0) add(o, 'NO_PICKER', 1, 20, 'No picker assigned', 'Nobody picks it unless someone is assigned.', 'picker');
        });

        // a customer on the trips has another order waiting (pending, on no trip) — it could ride the same lorry
        var onTrip = {};
        orders.forEach(function (o) { if (o.stage !== 'CANCELLED') onTrip[P.custKey(o)] = o; });
        var seen = {};
        (input.pending || []).forEach(function (p) {
            var o = onTrip[P.custKey(p)];
            if (!o || seen[p.order_number] || tripsOf[p.order_number]) return;
            seen[p.order_number] = 1;
            risks.push({ order: o.order_number, trip: o.trip_id, customer: o.account_name || '', kind: 'ADD_ON', sev: 1, score: 12, title: 'Pending order ' + p.order_number + ' for the same customer',
                why: 'Ordered ' + (p.order_date || '?') + ', on no trip — add it to trip ' + o.trip_id + ' so it rides the same lorry.', fix: 'addon', extra: p.order_number });
        });

        // systemic risks
        if (input.orderLinesRead === false)
            systemic.push({ kind: 'DATA', sev: 2, title: 'The WMS order lines of this date were not read', why: 'Out-of-stock cancellations cannot be predicted without them.', fix: 'refresh' });
        var g = input.mraGateway;
        if (mraOn && g && g.timeouts >= 3)
            systemic.push({ kind: 'GATEWAY', sev: g.timeouts >= 10 ? 3 : 2, title: 'The MRA gateway did not answer ' + g.timeouts + ' time(s) in the last days',
                why: (g.peakHour != null ? 'Most of them around ' + ('0' + g.peakHour).slice(-2) + ':00 — send MRA for tomorrow\'s orders before that hour.' : 'Send MRA early so a slow gateway does not hold the trip.'), fix: 'mra' });
        var flagged = risks.filter(function (r) { return r.kind === 'CANCEL' || r.kind === 'EMPTY'; }).length;
        if (flagged && !input.autopilotOn)
            systemic.push({ kind: 'AUTOPILOT', sev: 2, title: 'The cancellation autopilot is off', why: flagged + ' order(s) have out-of-stock lines nobody will cancel before picking.', fix: 'autopilot' });

        risks.sort(function (a, b) { return b.sev - a.sev || b.score - a.score || String(a.trip).localeCompare(String(b.trip), undefined, { numeric: true }); });

        // per order: worst risk; per trip: readiness
        var worst = {};
        risks.forEach(function (r) { if (!worst[r.order] || r.score > worst[r.order].score) worst[r.order] = r; });
        var trips = {};
        orders.forEach(function (o) {
            var t = trips[o.trip_id] = trips[o.trip_id] || { trip: o.trip_id, orders: 0, atRisk: 0, high: 0, lines: 0 };
            if (o.stage === 'CANCELLED') return;
            t.orders++; t.lines += +o.wms_lines || 0;
            var w = worst[o.order_number];
            if (w && w.sev >= 2) t.atRisk++;
            if (w && w.sev >= 3) t.high++;
        });
        var tripList = Object.keys(trips).map(function (k) { var t = trips[k]; t.readiness = t.orders ? Math.round(100 * (t.orders - t.atRisk) / t.orders) : 100; return t; })
            .sort(function (a, b) { return a.readiness - b.readiness || String(a.trip).localeCompare(String(b.trip), undefined, { numeric: true }); });

        var byKind = {};
        risks.forEach(function (r) { byKind[r.kind] = (byKind[r.kind] || 0) + 1; });
        var live = orders.filter(function (o) { return o.stage !== 'CANCELLED'; });
        var atRisk = Object.keys(worst).filter(function (k) { return worst[k].sev >= 2; }).length;
        return {
            risks: risks, trips: tripList, systemic: systemic, worst: worst,
            summary: {
                orders: live.length, atRisk: atRisk, high: Object.keys(worst).filter(function (k) { return worst[k].sev >= 3; }).length,
                willNotShip: risks.filter(function (r) { return r.kind === 'EMPTY' || r.kind === 'GHOST'; }).length,
                lines: cutLines,
                byKind: byKind,
                readiness: live.length ? Math.round(100 * (live.length - atRisk) / live.length) : 100
            }
        };
    };

    /** Did yesterday evening's forecast come true? predicted = rows kept with the snapshot {order, kind}; orders = o2 of the date now. */
    P.score = function (predicted, orders) {
        var by = {}; (orders || []).forEach(function (o) { by[o.order_number] = o; });
        var happened = function (o, kind) {
            if (!o) return kind === 'EMPTY' || kind === 'DUPLICATE';       // gone from the trips: moved / removed
            if (kind === 'EMPTY' || kind === 'GHOST') return o.stage === 'CANCELLED' || o.stage === 'NO LINES' || +o.cancelled_w2 > 0;
            if (kind === 'CANCEL') return +o.cancelled_w2 > 0 || +o.cnc > 0;
            if (kind === 'MRA_RISK' || kind === 'MRA_REPEAT') return o.mra === 'FAILED' || o.mra === 'CHECK FAILED';
            return null;                                                   // not something that "happens"
        };
        var rows = [], hit = 0, miss = 0;
        (predicted || []).forEach(function (p) {
            var h = happened(by[p.order], p.kind); if (h === null) return;
            rows.push({ order: p.order, kind: p.kind, happened: h }); if (h) hit++; else miss++;
        });
        var predictedOrders = {}; (predicted || []).forEach(function (p) { predictedOrders[p.order] = 1; });
        var surprises = (orders || []).filter(function (o) {
            return !predictedOrders[o.order_number] && (o.mra === 'FAILED' || o.stage === 'CANCELLED' || +o.cancelled_w2 > 0);
        }).map(function (o) { return o.order_number; });
        return { rows: rows, hit: hit, miss: miss, surprises: surprises, precision: hit + miss ? Math.round(100 * hit / (hit + miss)) : null };
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = P;
    else root.W2PM = P;
})(typeof window !== 'undefined' ? window : this);
