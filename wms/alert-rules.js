/* WMS alerts — the rules behind the four alert categories (wms/alerts.js shows them, this file only decides).
   Pure functions, no DOM, no host; global WMSAL in the browser, module.exports in node (wms/tests/alert-rules.test.js).
   Input = what the WMS already reads for a trip date:
     rows        the MRA Interface's order rows of the date (one per sales order: TRIP_ID, ORDER_NUMBER, CUSTOMER_NAME, ORDER_TYPE,
                 LINE_STATUS, PICKER, RELEASED, SHIPPED, PRINTED, MRA_INTERFACE_STATUS, MRA_WHY, TRIES …) — store / van transactions
                 and cancelled orders are already left out of them
     linesByOrder {order: [WMS order lines of getsalesorderlinesbytrip]} with the trip they came from
     bogo        the BOGO map of W2CR.bogoMap (main item → promo items)
   Output = items {kind, key, trip_id, order_number, customer, order_type, line_number, item, status, detail, …}:
     CANCEL  a line the cancellation rule (W2CR.expand — the Shipping Agent's Task 2) would cancel now and nobody has:
             Scheduled / Manual Reservation main lines + their sub-lines / BOGO free items; a main line without a fulfillment
             line id is listed too (it must be cancelled by hand)
     PICKER  a sales order on a trip with no picker that is not shipped yet
     MRA     a sales order whose latest MRA try is not SUCCESS / ALREADY_DONE (failed, skipped or never sent); printed ones first
     ERROR   a main line that is Cancelled while a child of it — a numbered sub-line, else the BOGO free item of its item — is
             anything but cancelled (the customer would get the free item without the paid one). A free item is only an error
             when NO other main line of the same item is still live (then it belongs to that one). */
(function (root) {
    'use strict';
    var R = (typeof module !== 'undefined' && module.exports) ? require('./cancel-rules.js') : root.W2CR;
    var A = {};
    A.KINDS = [
        { id: 'CANCEL', label: 'Pending cancellations', unit: 'line', icon: 'fa-ban', color: '#dc2626', type: 'alert' },
        { id: 'PICKER', label: 'No picker', unit: 'order', icon: 'fa-user-slash', color: '#d97706', type: 'status_change' },
        { id: 'MRA', label: 'Not interfaced to MRA', unit: 'order', icon: 'fa-file-invoice', color: '#7c3aed', type: 'action' },
        { id: 'ERROR', label: 'Order errors', unit: 'line', icon: 'fa-exclamation-triangle', color: '#b91c1c', type: 'alert' }
    ];
    A.kind = function (id) { for (var i = 0; i < A.KINDS.length; i++) if (A.KINDS[i].id === id) return A.KINDS[i]; return null; };
    A.FINAL = { SUCCESS: 1, ALREADY_DONE: 1 };
    var S = function (v) { return String(v == null ? '' : v).trim(); };
    var up = function (v) { return S(v).toUpperCase(); };
    var cancelled = function (status) { return up(status).indexOf('CANCEL') >= 0; };
    var isMain = function (l) { return R.lineNum(l).indexOf('.') < 0; };

    /** The order number of a WMS order line (getsalesorderlinesbytrip). */
    A.orderOf = function (l) {
        var keys = Object.keys(l || {}), names = ['SOURCE_ORDER_NUMBER', 'ORDER_NUMBER', 'order_number'];
        for (var i = 0; i < names.length; i++) { var k = keys.find(function (x) { return x.toLowerCase() === names[i].toLowerCase(); }); if (k && l[k] != null && l[k] !== '') return S(l[k]); }
        return '';
    };
    /** Lines of one trip → {order: [lines]}. */
    A.byOrder = function (lines) { var by = {}; (lines || []).forEach(function (l) { var o = A.orderOf(l); if (o) (by[o] = by[o] || []).push(l); }); return by; };

    function base(kind, order, info, tripId) {
        var r = info || {};
        return { kind: kind, trip_id: S(r.TRIP_ID || tripId), trip_date: S(r.TRIP_DATE), order_number: order, customer: S(r.CUSTOMER_NAME), order_type: S(r.ORDER_TYPE), line_number: '', item: '', status: '', detail: '' };
    }

    /** CANCEL items of one order's lines. info = the order's row (trip, customer …), tripId = the trip the lines came from. */
    A.pendingCancels = function (order, lines, bogo, info, tripId) {
        if (!lines || !lines.some(R.flagged)) return [];
        var x = R.expand(lines, bogo || {}), out = [];
        x.lines.forEach(function (p) {
            var it = base('CANCEL', order, info, tripId);
            it.key = 'CANCEL|' + order + '|' + R.key(p.line); it.line_number = R.lineNum(p.line); it.item = R.lineItem(p.line); it.status = R.lineStatus(p.line);
            it.via = p.via; it.child_of = S(p.childOf); it.fid = S(R.fid(p.line));
            it.detail = p.via === 'MAIN' ? 'main line · ' + it.status : p.via + ' of line ' + it.child_of + ' · ' + it.status;
            out.push(it);
        });
        x.noId.forEach(function (l) {
            var it = base('CANCEL', order, info, tripId);
            it.key = 'CANCEL|' + order + '|' + R.key(l); it.line_number = R.lineNum(l); it.item = R.lineItem(l); it.status = R.lineStatus(l);
            it.via = 'MAIN'; it.child_of = ''; it.fid = ''; it.detail = 'main line · ' + it.status + ' · no fulfillment line id — cancel by hand';
            out.push(it);
        });
        return out;
    };

    /** ERROR items of one order's lines: a cancelled main line whose sub-line / BOGO free item is not cancelled. */
    A.orderErrors = function (order, lines, bogo, info, tripId) {
        lines = lines || []; bogo = bogo || {};
        var mains = lines.filter(isMain), out = [], seen = {};
        var liveMainOfItem = function (item) { return mains.some(function (m) { return !cancelled(R.lineStatus(m)) && R.lineItem(m).toUpperCase() === item; }); };
        mains.forEach(function (m) {
            if (!cancelled(R.lineStatus(m))) return;
            var num = R.lineNum(m), item = R.lineItem(m).toUpperCase(), via = 'SUB-LINE';
            var children = num ? lines.filter(function (l) { return R.lineNum(l).indexOf(num + '.') === 0; }) : [];
            if (!children.length) {
                var promos = bogo[item] || [];
                if (!promos.length) return;
                if (liveMainOfItem(item)) return;                                   // the free item belongs to the live main line of the same item
                children = lines.filter(function (l) { return l !== m && promos.indexOf(R.lineItem(l).toUpperCase()) >= 0; }); via = 'BOGO';
            }
            children.forEach(function (ch) {
                var st = R.lineStatus(ch); if (cancelled(st)) return;
                var k = 'ERROR|' + order + '|' + R.key(ch); if (seen[k]) return; seen[k] = 1;
                var it = base('ERROR', order, info, tripId);
                it.key = k; it.line_number = num; it.item = R.lineItem(m); it.status = R.lineStatus(m);
                it.via = via; it.child_line = R.lineNum(ch); it.child_item = R.lineItem(ch); it.child_status = st; it.fid = S(R.fid(ch));
                it.detail = 'line ' + num + ' (' + it.item + ') is ' + it.status + ' — ' + (via === 'BOGO' ? 'BOGO free item' : 'sub-line') + ' ' + it.child_line + ' (' + it.child_item + ') is ' + (st || 'open');
                out.push(it);
            });
        });
        return out;
    };

    /** PICKER items: sales orders of the date without a picker, not shipped yet. */
    A.noPicker = function (rows) {
        return (rows || []).filter(function (r) { return !S(r.PICKER) && !r.SHIPPED; }).map(function (r) {
            var it = base('PICKER', S(r.ORDER_NUMBER), r); it.key = 'PICKER|' + it.order_number; it.status = S(r.LINE_STATUS);
            it.released = !!r.RELEASED; it.detail = (r.RELEASED ? 'released' : 'not released') + ' · no picker'; return it;
        });
    };

    /** MRA items: sales orders whose latest MRA try is not SUCCESS / ALREADY_DONE. */
    A.notInterfaced = function (rows) {
        return (rows || []).filter(function (r) { return !A.FINAL[up(r.MRA_INTERFACE_STATUS)]; }).map(function (r) {
            var it = base('MRA', S(r.ORDER_NUMBER), r), st = up(r.MRA_INTERFACE_STATUS);
            it.key = 'MRA|' + it.order_number; it.status = st || 'NOT SENT'; it.printed = !!r.PRINTED; it.shipped = !!r.SHIPPED; it.why = S(r.MRA_WHY); it.tries = Number(r.TRIES) || 0; it.line_status = S(r.LINE_STATUS);
            it.detail = st === 'FAILED' ? 'failed' + (it.why ? ': ' + it.why : '') + (it.tries > 1 ? ' · ' + it.tries + ' tries' : '') : st === 'SKIPPED' ? 'skipped' + (it.why ? ': ' + it.why : '') : (r.PRINTED ? 'printed, never sent to MRA' : r.SHIPPED ? 'shipped, not printed, never sent' : 'not printed yet');
            it.rank = st === 'FAILED' ? 0 : r.PRINTED ? 1 : st === 'SKIPPED' ? 2 : 3;
            return it;
        }).sort(function (a, b) { return a.rank - b.rank || (a.trip_id < b.trip_id ? -1 : a.trip_id > b.trip_id ? 1 : 0) || (a.order_number < b.order_number ? -1 : 1); });
    };

    /**
     * One date: rows (the MRA Interface's order rows), trips [{trip_id, linesByOrder}] (the WMS order lines per trip), bogo → every item.
     * An order's lines are matched to its row for trip / customer; lines of orders without a row (e.g. a store transfer) still count for
     * CANCEL / ERROR with the trip they came from.
     */
    A.run = function (input) {
        var rows = input.rows || [], byOrder = {}; rows.forEach(function (r) { byOrder[S(r.ORDER_NUMBER)] = r; });
        var items = [];
        (input.trips || []).forEach(function (t) {
            var by = t.linesByOrder || A.byOrder(t.lines);
            Object.keys(by).forEach(function (o) {
                var info = byOrder[o] || null;
                items = items.concat(A.pendingCancels(o, by[o], input.bogo, info, t.trip_id), A.orderErrors(o, by[o], input.bogo, info, t.trip_id));
            });
        });
        items = items.concat(A.noPicker(rows), A.notInterfaced(rows));
        items.forEach(function (it) { if (!it.trip_date) it.trip_date = S(input.date); });
        return items;
    };

    /** Counts per kind: n (items), orders, trips (ids) + MRA split (failed / printed). */
    A.summary = function (items) {
        var s = { total: 0 };
        A.KINDS.forEach(function (k) { s[k.id] = { n: 0, orders: 0, trips: [] }; });
        var orders = {}, trips = {};
        (items || []).forEach(function (it) {
            var k = s[it.kind]; if (!k) return; k.n++; s.total++;
            var ok = it.kind + '|' + it.order_number; if (!orders[ok]) { orders[ok] = 1; k.orders++; }
            var tk = it.kind + '|' + it.trip_id; if (it.trip_id && !trips[tk]) { trips[tk] = 1; k.trips.push(it.trip_id); }
            if (it.kind === 'MRA') { if (it.status === 'FAILED') k.failed = (k.failed || 0) + 1; if (it.printed) k.printed = (k.printed || 0) + 1; }
        });
        return s;
    };
    function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
    function tripsText(list) { if (!list || !list.length) return ''; var l = list.slice().sort(function (a, b) { return (parseFloat(a) || 0) - (parseFloat(b) || 0); }); return ' · trip' + (l.length === 1 ? ' ' : 's ') + (l.length > 4 ? l.slice(0, 4).join(', ') + ' +' + (l.length - 4) : l.join(', ')); }
    /** The sentence of one category for the bell / toast. */
    A.message = function (kind, s) {
        var k = s[kind] || { n: 0, orders: 0, trips: [] };
        if (!k.n) return 'nothing ' + (kind === 'CANCEL' ? 'pending for cancellation' : kind === 'PICKER' ? 'without a picker' : kind === 'MRA' ? 'left to interface to MRA' : 'wrong on the orders');
        if (kind === 'CANCEL') return plural(k.n, 'line') + ' on ' + plural(k.orders, 'order') + ' still pending for cancellation' + tripsText(k.trips);
        if (kind === 'PICKER') return plural(k.n, 'order') + ' without a picker' + tripsText(k.trips);
        if (kind === 'MRA') return plural(k.n, 'order') + ' not interfaced to MRA' + ((k.failed || k.printed) ? ' (' + [k.failed ? k.failed + ' failed' : '', k.printed ? k.printed + ' printed' : ''].filter(Boolean).join(', ') + ')' : '') + tripsText(k.trips);
        return plural(k.n, 'order error') + ': main line cancelled, its BOGO / sub-line not' + tripsText(k.trips);
    };
    /** Carries first_seen from the previous items of the same date (by key); new ones get `at`. */
    A.carry = function (prev, cur, at) {
        var m = {}; (prev || []).forEach(function (p) { if (p.key) m[p.key] = p.first_seen || p.read_at || at; });
        (cur || []).forEach(function (it) { it.first_seen = m[it.key] || at; it.read_at = at; });
        return cur;
    };
    /** What changed between two summaries → {changed, up: [kind], down: [kind], text}. */
    A.diff = function (prev, cur) {
        var d = { changed: false, up: [], down: [], text: '' }, parts = [];
        A.KINDS.forEach(function (k) {
            var a = prev && prev[k.id] ? prev[k.id].n : 0, b = cur && cur[k.id] ? cur[k.id].n : 0;
            if (a === b) return; d.changed = true; (b > a ? d.up : d.down).push(k.id);
            parts.push(k.label + ' ' + a + ' → ' + b);
        });
        d.text = parts.join(' · ');
        return d;
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = A;
    else root.WMSAL = A;
})(typeof window !== 'undefined' ? window : this);
