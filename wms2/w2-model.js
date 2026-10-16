/* WMS 2.0 — model: the SQL every screen uses over the local DuckDB copy.
   W2.M.ordersSql(pod, date) is a WITH … prefix ending in o2 = one row per order of the trip date with its stage
   (Shipping Agent rules over the Fusion shipment lines), picker, MRA, print and cancellation state. */
(function () {
    'use strict';
    var W2 = window.W2, L = W2.lit;
    var M = W2.M = {};

    /** Lines the autopilot cancels: exactly the Shipping Agent's Task 2 rule. */
    M.FLAG = "(upper(status) LIKE '%SCHEDULED%' OR upper(status) LIKE '%MANUAL RESERVATION%')";

    M.ordersSql = function (pod, date) {
        var P = L(pod), D = L(date);
        return "WITH l AS (SELECT * FROM w2_trip_lines WHERE pod = " + P + " AND trip_date = " + D + "), " +
            "o AS (SELECT trip_id, order_number, any_value(order_type) AS order_type, any_value(account_name) AS account_name, any_value(account_number) AS account_number, " +
            "  max(NULLIF(picker, '')) AS line_picker, max(NULLIF(pick_confirm_st, '')) AS pick_confirm_st, COUNT(*) AS wms_lines, min(raw_json) AS raw FROM l GROUP BY 1, 2), " +
            "s AS (SELECT order_number, COUNT(*) AS n, SUM(CASE WHEN bucket = 'INTERFACED' THEN 1 ELSE 0 END) AS itf, SUM(CASE WHEN bucket = 'STAGED' THEN 1 ELSE 0 END) AS stg, " +
            "  SUM(CASE WHEN bucket = 'RELEASED' THEN 1 ELSE 0 END) AS rel, SUM(CASE WHEN bucket = 'READY' THEN 1 ELSE 0 END) AS rdy, SUM(CASE WHEN bucket = 'CANCELLED' THEN 1 ELSE 0 END) AS cnc " +
            "  FROM w2_ship_lines WHERE pod = " + P + " AND trip_date = " + D + " GROUP BY 1), " +
            "ck AS (SELECT order_number, max(checked_at) AS checked_at, max(COALESCE(error, '')) AS err FROM w2_ship_checked WHERE pod = " + P + " AND trip_date = " + D + " GROUP BY 1), " +
            "pk AS (SELECT order_number, max(NULLIF(picker_name, '')) AS picker_name, max(assigned_at) AS assigned_at FROM w2_picker WHERE trip_date = " + D + " GROUP BY 1), " +
            "m AS (SELECT order_number, arg_max(status, checked_at) AS status, arg_max(msg, checked_at) AS msg, max(checked_at) AS mra_at FROM w2_mra WHERE pod = " + P + " GROUP BY 1), " +
            "pr AS (SELECT order_number, MAX(CASE WHEN COALESCE(print_completed, '') <> '' OR upper(COALESCE(print_status, '')) = 'PRINTED' THEN 1 ELSE 0 END) AS printed, " +
            "  MAX(CASE WHEN COALESCE(error_message, '') <> '' AND COALESCE(print_completed, '') = '' THEN 1 ELSE 0 END) AS failed, COUNT(*) AS jobs, max(error_message) AS err FROM w2_print WHERE trip_date = " + D + " GROUP BY 1), " +
            "ol AS (SELECT order_number, SUM(CASE WHEN " + M.FLAG + " THEN 1 ELSE 0 END) AS flagged, COUNT(*) AS n FROM w2_order_lines WHERE pod = " + P + " AND trip_date = " + D + " GROUP BY 1), " +
            "cl AS (SELECT order_number, SUM(CASE WHEN result = 'DONE' THEN 1 ELSE 0 END) AS cancelled, SUM(CASE WHEN result = 'FAILED' THEN 1 ELSE 0 END) AS cfailed FROM w2_cancel_log WHERE pod = " + P + " AND trip_date = " + D + " GROUP BY 1), " +
            "fl AS (SELECT upper(any_value(interface_flag)) AS flag FROM w2_mra_flag WHERE upper(instance_name) = " + P + "), " +
            "o2 AS (SELECT o.*, COALESCE(pk.picker_name, o.line_picker) AS picker, pk.assigned_at, s.n AS ship_n, COALESCE(s.itf, 0) AS itf, COALESCE(s.stg, 0) AS stg, COALESCE(s.rel, 0) AS rel, " +
            "  COALESCE(s.rdy, 0) AS rdy, COALESCE(s.cnc, 0) AS cnc, COALESCE(s.n, 0) - COALESCE(s.cnc, 0) AS active, " +
            "  CASE WHEN s.n IS NULL THEN (CASE WHEN ck.order_number IS NOT NULL AND ck.err = '' THEN 'NO LINES' ELSE 'NOT CHECKED' END) " +
            "       WHEN s.n - s.cnc = 0 THEN 'CANCELLED' WHEN s.itf = s.n - s.cnc THEN 'INTERFACED' WHEN s.itf > 0 THEN 'PART INTERFACED' " +
            "       WHEN s.stg > 0 AND s.stg = s.n - s.cnc THEN 'STAGED' WHEN s.stg > 0 THEN 'PART STAGED' WHEN s.rel > 0 THEN 'RELEASED' WHEN s.rdy > 0 THEN 'READY' ELSE 'PENDING' END AS stage, " +
            "  CASE WHEN m.status IS NULL AND (SELECT flag FROM fl) = 'N' THEN 'OFF' ELSE m.status END AS mra, m.msg AS mra_msg, m.mra_at, " +
            "  CASE WHEN pr.printed = 1 THEN 'PRINTED' WHEN pr.failed = 1 THEN 'FAILED' WHEN pr.jobs > 0 THEN 'QUEUED' ELSE 'NONE' END AS print_state, pr.err AS print_err, " +
            "  COALESCE(ol.flagged, 0) AS to_cancel, COALESCE(cl.cancelled, 0) AS cancelled_w2, COALESCE(cl.cfailed, 0) AS cancel_failed, ck.checked_at AS ship_checked_at, ck.err AS ship_err " +
            "  FROM o LEFT JOIN s USING (order_number) LEFT JOIN ck USING (order_number) LEFT JOIN pk USING (order_number) LEFT JOIN m USING (order_number) " +
            "  LEFT JOIN pr USING (order_number) LEFT JOIN ol USING (order_number) LEFT JOIN cl USING (order_number)) ";
    };

    /** One row per order of the date. */
    M.orders = function (pod, date) { return W2.q(M.ordersSql(pod || W2.pod(), date || W2.date()) + " SELECT * FROM o2 ORDER BY trip_id, order_number"); };

    /** One row per trip: header fields + order counts per stage. */
    M.tripsSql = function (pod, date) {
        var P = L(pod), D = L(date);
        return M.ordersSql(pod, date) +
            ", ts AS (SELECT trip_id, COUNT(*) AS orders, SUM(wms_lines) AS lines, SUM(CASE WHEN COALESCE(picker, '') <> '' THEN 1 ELSE 0 END) AS with_picker, " +
            "  SUM(CASE WHEN stage IN ('RELEASED', 'PART STAGED', 'STAGED', 'PART INTERFACED', 'INTERFACED') THEN 1 ELSE 0 END) AS released, " +
            "  SUM(CASE WHEN stage IN ('STAGED', 'PART INTERFACED', 'INTERFACED') THEN 1 ELSE 0 END) AS staged, SUM(CASE WHEN stage = 'INTERFACED' THEN 1 ELSE 0 END) AS interfaced, " +
            "  SUM(CASE WHEN stage = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled, SUM(CASE WHEN stage = 'NOT CHECKED' THEN 1 ELSE 0 END) AS not_checked, " +
            "  SUM(CASE WHEN mra IN ('SENT', 'DONE', 'ALREADY', 'SKIPPED', 'OFF') THEN 1 ELSE 0 END) AS mra_ok, SUM(CASE WHEN mra IN ('FAILED', 'CHECK FAILED') THEN 1 ELSE 0 END) AS mra_bad, " +
            "  SUM(CASE WHEN print_state = 'PRINTED' THEN 1 ELSE 0 END) AS printed, SUM(CASE WHEN print_state = 'FAILED' THEN 1 ELSE 0 END) AS print_bad, " +
            "  SUM(to_cancel) AS to_cancel, SUM(cancelled_w2) AS cancelled_w2, SUM(itf) AS itf_lines, SUM(stg) AS stg_lines, SUM(rel) AS rel_lines, SUM(active) AS active_lines, " +
            "  string_agg(DISTINCT NULLIF(picker, ''), ', ') AS pickers FROM o2 GROUP BY 1), " +
            "th AS (SELECT trip_id, any_value(lorry) AS lorry, any_value(loading_bay) AS loading_bay, any_value(priority) AS priority, any_value(picker) AS trip_picker FROM w2_trips WHERE pod = " + P + " AND trip_date = " + D + " GROUP BY 1) " +
            "SELECT COALESCE(th.trip_id, ts.trip_id) AS trip_id, th.lorry, th.loading_bay, th.priority, COALESCE(ts.pickers, th.trip_picker) AS pickers, COALESCE(ts.orders, 0) AS orders, COALESCE(ts.lines, 0) AS lines, " +
            "  COALESCE(ts.with_picker, 0) AS with_picker, COALESCE(ts.released, 0) AS released, COALESCE(ts.staged, 0) AS staged, COALESCE(ts.interfaced, 0) AS interfaced, COALESCE(ts.cancelled, 0) AS cancelled, " +
            "  COALESCE(ts.not_checked, 0) AS not_checked, COALESCE(ts.mra_ok, 0) AS mra_ok, COALESCE(ts.mra_bad, 0) AS mra_bad, COALESCE(ts.printed, 0) AS printed, COALESCE(ts.print_bad, 0) AS print_bad, " +
            "  COALESCE(ts.to_cancel, 0) AS to_cancel, COALESCE(ts.cancelled_w2, 0) AS cancelled_w2, COALESCE(ts.itf_lines, 0) AS itf_lines, COALESCE(ts.stg_lines, 0) AS stg_lines, " +
            "  COALESCE(ts.rel_lines, 0) AS rel_lines, COALESCE(ts.active_lines, 0) AS active_lines " +
            "FROM th FULL OUTER JOIN ts ON ts.trip_id = th.trip_id ORDER BY TRY_CAST(COALESCE(th.trip_id, ts.trip_id) AS BIGINT), 1";
    };
    M.trips = function (pod, date) { return W2.q(M.tripsSql(pod || W2.pod(), date || W2.date())); };

    /** Trip stage for boards: where its slowest order is. */
    M.tripStage = function (t) {
        var o = W2.n(t.orders) - W2.n(t.cancelled);
        if (!W2.n(t.orders)) return 'EMPTY';
        if (o <= 0) return 'DONE';
        if (W2.n(t.printed) >= o) return 'DONE';
        if (W2.n(t.interfaced) >= o) return 'MRA_PRINT';
        if (W2.n(t.released) > 0) return 'PICKING';
        if (W2.n(t.with_picker) > 0) return 'ASSIGNED';
        return 'PLANNED';
    };
    M.LANES = [['PLANNED', 'Planned', 'fa-clipboard-list'], ['ASSIGNED', 'Pickers assigned', 'fa-user-check'], ['PICKING', 'Picking', 'fa-dolly'], ['MRA_PRINT', 'MRA & print', 'fa-receipt'], ['DONE', 'Ready', 'fa-circle-check'], ['EMPTY', 'No orders', 'fa-inbox']];

    /** Flow of the date: orders per stage (each stage counts the orders that reached it). */
    M.flow = function (orders, mraOn) {
        var f = { trip: 0, picker: 0, released: 0, staged: 0, interfaced: 0, mra: 0, printed: 0, cancelled: 0 };
        orders.forEach(function (o) {
            if (o.stage === 'CANCELLED') { f.cancelled++; return; }
            f.trip++;
            if (o.picker) f.picker++;
            if (['RELEASED', 'PART STAGED', 'STAGED', 'PART INTERFACED', 'INTERFACED'].indexOf(o.stage) >= 0) f.released++;
            if (['STAGED', 'PART INTERFACED', 'INTERFACED'].indexOf(o.stage) >= 0) f.staged++;
            if (o.stage === 'INTERFACED') f.interfaced++;
            if (o.stage === 'INTERFACED' && ['SENT', 'DONE', 'ALREADY', 'SKIPPED', 'OFF'].indexOf(o.mra) >= 0) f.mra++;
            if (o.print_state === 'PRINTED') f.printed++;
        });
        return f;
    };

    /** What needs attention: rules over the orders + trips of the date, most urgent first. */
    M.exceptions = function (orders, trips, extra) {
        extra = extra || {};
        var out = [], by = function (fn) { return orders.filter(fn); };
        var noPicker = by(function (o) { return !o.picker && o.stage !== 'CANCELLED' && o.stage !== 'INTERFACED'; });
        if (noPicker.length) {
            var tr = Array.from(new Set(noPicker.map(function (o) { return o.trip_id; })));
            out.push({ sev: 'x', icon: 'fa-user-xmark', t: noPicker.length + ' order(s) have no picker', d: 'on trip(s) ' + tr.slice(0, 6).join(', ') + (tr.length > 6 ? '…' : ''), act: 'Assign pickers', go: ['picking', { filter: 'nopicker' }] });
        }
        var toCancel = orders.reduce(function (s, o) { return s + W2.n(o.to_cancel); }, 0);
        if (toCancel) out.push({ sev: extra.autopilotOn ? 'i' : 'x', icon: 'fa-ban', t: toCancel + ' line(s) are Scheduled / Manual Reservation', d: extra.autopilotOn ? 'the autopilot cancels them on its next run' : 'the autopilot is off — nothing cancels them', act: 'Open autopilot', go: ['autopilot', {}] });
        var mraBad = by(function (o) { return o.mra === 'FAILED' || o.mra === 'CHECK FAILED'; });
        if (mraBad.length) out.push({ sev: 'x', icon: 'fa-receipt', t: mraBad.length + ' order(s) failed MRA', d: mraBad.slice(0, 4).map(function (o) { return o.order_number; }).join(', '), act: 'Open MRA', go: ['mra', { filter: 'failed' }] });
        var mraWait = by(function (o) { return o.stage === 'INTERFACED' && (o.mra === 'NOT SENT' || !o.mra); });
        if (mraWait.length && !extra.mraOff) out.push({ sev: 'w', icon: 'fa-paper-plane', t: mraWait.length + ' interfaced order(s) not sent to MRA', d: 'they cannot be printed until MRA has them', act: 'Send to MRA', go: ['mra', { filter: 'todo' }] });
        var prBad = by(function (o) { return o.print_state === 'FAILED'; });
        if (prBad.length) out.push({ sev: 'x', icon: 'fa-print', t: prBad.length + ' order(s) failed to print', d: (prBad[0].print_err || '').slice(0, 80), act: 'Open printing', go: ['printing', { filter: 'failed' }] });
        var ready = by(function (o) { return o.stage === 'READY' || o.stage === 'PENDING'; });
        if (ready.length) out.push({ sev: 'w', icon: 'fa-dolly', t: ready.length + ' order(s) not released to the warehouse', d: 'release the whole day in one run', act: 'Pick release', go: ['pickrelease', {}] });
        var notChecked = by(function (o) { return o.stage === 'NOT CHECKED'; });
        if (notChecked.length) out.push({ sev: 'i', icon: 'fa-hourglass-half', t: notChecked.length + ' order(s) not read from Fusion yet', d: notChecked.some(function (o) { return o.ship_err; }) ? 'some reads failed — see Data & sync' : 'press Refresh', act: 'Refresh', run: function () { W2.sync.day(W2.date(), { only: ['shipment'] }); } });
        var printWait = by(function (o) { return o.stage === 'INTERFACED' && ['SENT', 'DONE', 'ALREADY', 'SKIPPED', 'OFF'].indexOf(o.mra) >= 0 && o.print_state === 'NONE'; });
        if (printWait.length) out.push({ sev: 'i', icon: 'fa-file-pdf', t: printWait.length + ' order(s) ready to print, no print job yet', d: 'MRA done, nothing queued', act: 'Open printing', go: ['printing', { filter: 'none' }] });
        if (extra.pendingOld) out.push({ sev: 'w', icon: 'fa-inbox', t: extra.pendingOld + ' pending order(s) older than 2 days', d: 'not on any trip', act: 'Open pending', go: ['pending', {}] });
        var empty = (trips || []).filter(function (t) { return !W2.n(t.orders); });
        if (empty.length) out.push({ sev: 'i', icon: 'fa-truck', t: empty.length + ' trip(s) without orders', d: empty.slice(0, 5).map(function (t) { return t.trip_id; }).join(', '), act: 'Open trips', go: ['trips', {}] });
        return out;
    };
})();
