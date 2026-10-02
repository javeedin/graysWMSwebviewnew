/* AI Agent — WMS Operator tools (page side): trips, orders on a trip, print jobs, printers and the MRA switch / status.
   Same APEX endpoints and tables as the WMS pages (GETTRIPDETAILS, printjobs/trip, wms_print_jobs, wms_printer_config,
   wms_mra_interface_config) and the MRA check report through omBip. Sending to MRA itself is the host tool
   mra_interface (confirm card, MRAProcessor). */
var AG_ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP';
var AG_MRA_CHECK = '/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/MRA_TRX_NO_CHECK_BIP.xdo';

AG.getJson = function (url) {
    return host('executeGet', { fullUrl: url }, 120000).then(function (d) {
        var j = d; if (typeof j === 'string') { try { j = JSON.parse(j); } catch (e) { throw 'Unexpected answer from ' + url.split('/ords/')[1]; } }
        return j;
    });
};
function agItems(j) { return Array.isArray(j) ? j : (j && (j.items || j.ITEMS)) || []; }
function agF(o, k) { if (!o) return undefined; if (o[k] !== undefined) return o[k]; var u = k.toUpperCase(), l = k.toLowerCase(); return o[u] !== undefined ? o[u] : o[l]; }
function agDmy(iso) { var p = String(iso).split('-'); return p[2] + '-' + p[1] + '-' + p[0]; }
function agToday() { var d = new Date(), z = function (n) { return ('0' + n).slice(-2); }; return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
function agInst(i) { return String(i || AG.pod).toUpperCase() === 'TEST' ? 'TEST' : 'PROD'; }

/** The trip id / order number fields, whatever case or name the endpoint uses. */
function agKey(row, prefer, pattern) {
    var keys = Object.keys(row || {});
    for (var i = 0; i < prefer.length; i++) { var k = keys.filter(function (x) { return x.toUpperCase() === prefer[i]; })[0]; if (k) return k; }
    return keys.filter(function (x) { return pattern.test(x); })[0] || null;
}
function agAddDays(iso, n) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); var z = function (x) { return ('0' + x).slice(-2); }; return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
function agTripLines(from, to, inst) {
    return AG.getJson(AG_ORDS + '/WAREHOUSEMANAGEMENT/GETTRIPDETAILS?P_DATE_FROM=' + agDmy(from) + '&P_DATE_TO=' + agDmy(to) + '&P_INSTANCE_NAME=' + inst).then(agItems);
}
AG.tool('trips_find', function (inp) {
    var date = /^\d{4}-\d{2}-\d{2}$/.test(inp.date || '') ? inp.date : agToday(), inst = agInst(inp.instance), note = '';
    return agTripLines(date, date, inst).then(function (lines) {
        if (lines.length || inp.date) return lines;
        // nothing today: look back a week so the answer is useful ("latest trips are on …")
        return agTripLines(agAddDays(date, -7), date, inst).then(function (wk) {
            if (!wk.length) return wk;
            var dk = agKey(wk[0], ['TRIP_DATE'], /date/i), latest = null;
            wk.forEach(function (l) { var d = String(l[dk] || '').slice(0, 10); if (d && (!latest || d > latest)) latest = d; });
            note = 'No trips on ' + date + ' (' + inst + '). Showing the last 7 days' + (latest ? ' — latest trip date ' + latest : '') + '.\n';
            return wk;
        });
    }).then(function (lines) {
        return rows("SELECT trip_id, COUNT(DISTINCT order_number) AS jobs, COUNT(DISTINCT CASE WHEN print_completed IS NOT NULL THEN order_number END) AS printed, " +
            "COUNT(DISTINCT CASE WHEN error_message IS NOT NULL AND print_completed IS NULL THEN order_number END) AS failed FROM wms_print_jobs WHERE trip_date >= TO_DATE(" + lit(agAddDays(date, -7)) + ", 'YYYY-MM-DD') GROUP BY trip_id", 3000)
            .catch(function () { return []; }).then(function (pr) { return [lines, pr]; });
    }).then(function (r) {
        var lines = r[0], prints = {}, trips = {}, order = [];
        r[1].forEach(function (p) { prints[String(p.TRIP_ID)] = p; });
        var first = lines[0] || {}, tk = agKey(first, ['TRIP_ID', 'TRIPID', 'TRIP_NUMBER', 'TRIP_NO'], /trip.?(id|num|no)/i),
            ok = agKey(first, ['ORDER_NUMBER', 'ORDERNUMBER', 'ORDER_NO'], /order.?(num|no)/i), dk = agKey(first, ['TRIP_DATE'], /date/i);
        lines.forEach(function (l) {
            var id = tk ? String(l[tk] == null ? '' : l[tk]) : ''; if (!id) return;
            var t = trips[id];
            if (!t) { t = trips[id] = { TRIP_ID: id, TRIP_DATE: String((dk && l[dk]) || date).slice(0, 10), LORRY: agF(l, 'TRIP_LORRY') || '', LOADING_BAY: agF(l, 'LOADING_BAY') || '', PICKER: agF(l, 'PICKER_NAME') || '', PRIORITY: agF(l, 'TRIP_PRIORITY') || '', _o: {} }; order.push(id); }
            var on = ok ? l[ok] : null; if (on) t._o[on] = 1;
        });
        if (lines.length && !order.length)
            return { ok: true, content: note + lines.length + ' rows came back but no trip id field was recognised. Fields: ' + Object.keys(first).join(', ') };
        var out = order.map(function (id) {
            var t = trips[id], p = prints[id] || {}, n = Object.keys(t._o).length;
            delete t._o;
            t.ORDERS = n; t.PRINTED = +p.PRINTED || 0; t.PRINT_FAILED = +p.FAILED || 0; t.NOT_PRINTED = Math.max(0, n - t.PRINTED);
            return t;
        }).filter(function (t) {
            if (inp.words && (t.TRIP_ID + ' ' + t.LORRY + ' ' + t.PICKER).toLowerCase().indexOf(String(inp.words).toLowerCase()) < 0) return false;
            if (/not.?printed|unprinted|pending/i.test(inp.status || '')) return t.NOT_PRINTED > 0;
            if (/printed|done/i.test(inp.status || '')) return t.NOT_PRINTED === 0;
            return true;
        });
        var res = AG.tableOut('Trips ' + (note ? 'last 7 days' : date) + ' · ' + inst, out, note || ('No trips on ' + date + ' (' + inst + ') — and none in the 7 days before.'));
        if (out.length) res.content = note + out.length + ' trip(s), ' + out.reduce(function (s, t) { return s + t.NOT_PRINTED; }, 0) + ' order(s) not printed (print status from wms_print_jobs).\n' + res.content;
        else if (order.length) res.content = note + order.length + ' trip(s) found, none match the filter "' + (inp.status || inp.words) + '".';
        return res;
    }, function (e) { return { ok: false, content: 'Trips: ' + e }; });
});

AG.tool('trip_orders', function (inp) {
    var trip = String(inp.trip_id || '').replace(/[^\w\-]/g, ''); if (!trip) return { ok: false, content: 'trip_id required' };
    var inst = agInst(inp.instance);
    return Promise.all([AG.getJson(AG_ORDS + '/WAREHOUSEMANAGEMENT/GETTRIPDETAILS/' + encodeURIComponent(trip) + '?P_INSTANCE_NAME=' + inst),
        AG.getJson(AG_ORDS + '/TRIPMANAGEMENT/printjobs/trip/' + encodeURIComponent(trip)).catch(function () { return { items: [] }; })]).then(function (r) {
        var seen = {}, out = [], pj = {};
        agItems(r[1]).forEach(function (p) { pj[String(agF(p, 'order_number'))] = p; });
        agItems(r[0]).forEach(function (l) {
            var on = String(agF(l, 'ORDER_NUMBER') || ''); if (!on || seen[on]) { if (seen[on]) seen[on].LINES++; return; }
            var p = pj[on] || {};
            seen[on] = { ORDER_NUMBER: on, CUSTOMER: agF(l, 'ACCOUNT_NAME') || '', ACCOUNT: agF(l, 'ACCOUNT_NUMBER') || '', ORDER_TYPE: agF(l, 'ORDER_TYPE') || '', PICK: agF(l, 'PICK_CONFIRM_ST') || '',
                LINES: 1, PRINTED: (+agF(p, 'print_printed') || 0) + '/' + (+agF(p, 'print_total') || 0), PRINT_STATUS: agF(p, 'overall_status') || 'not queued' };
            out.push(seen[on]);
        });
        return AG.tableOut('Trip ' + trip + ' · orders', out, 'No orders on trip ' + trip + ' (' + inst + ').');
    }, function (e) { return { ok: false, content: 'Trip orders: ' + e }; });
});

AG.tool('print_jobs', function (inp) {
    var hours = Math.min(24 * 14, Math.max(1, parseInt(inp.hours, 10) || 24)), trip = String(inp.trip_id || '').replace(/[^\w\-]/g, ''), st = AG.words(inp.status)[0];
    return rows("SELECT order_number, trip_id, TO_CHAR(trip_date, 'YYYY-MM-DD') AS trip_date, customer_name, download_status, print_status, overall_status, retry_count, SUBSTR(error_message, 1, 200) AS error, " +
        "TO_CHAR(NVL(modified_date, created_date), 'YYYY-MM-DD HH24:MI') AS changed FROM wms_print_jobs WHERE created_date >= SYSDATE - " + hours + "/24" +
        (trip ? ' AND trip_id = ' + lit(trip) : '') + (st === 'FAILED' ? " AND error_message IS NOT NULL AND print_completed IS NULL" : st ? ' AND UPPER(overall_status) LIKE ' + lit('%' + st + '%') : '') +
        ' ORDER BY NVL(modified_date, created_date) DESC FETCH FIRST 500 ROWS ONLY', 500)
        .then(function (list) { return AG.tableOut('Print jobs · last ' + hours + ' h' + (trip ? ' · trip ' + trip : ''), list, 'No print jobs in the last ' + hours + ' hours.'); }, function (e) { return { ok: false, content: 'Print jobs: ' + e }; });
});

AG.tool('printers_status', function () {
    // never the stored Fusion user / password columns
    return rows("SELECT c.config_id, c.printer_name, c.paper_size, c.orientation, c.fusion_instance, c.auto_download, c.auto_print, c.is_active, " +
        "(SELECT TO_CHAR(MAX(j.print_completed), 'YYYY-MM-DD HH24:MI') FROM wms_print_jobs j WHERE j.created_date >= SYSDATE - 7) AS last_print_any FROM wms_printer_config c ORDER BY c.printer_name", 100)
        .then(function (list) { return AG.tableOut('Printers', list, 'No printers configured.'); }, function (e) { return { ok: false, content: 'Printers: ' + e }; });
});

AG.tool('mra_status', function (inp) {
    var inst = agInst(inp.instance), orders = (inp.orders || []).map(String).filter(function (o) { return /^[\w\-\/]{1,40}$/.test(o); }).slice(0, 20);
    return rows("SELECT instance_name, interface_flag, SUBSTR(note, 1, 200) AS note, changed_by, TO_CHAR(changed_date, 'YYYY-MM-DD HH24:MI') AS changed FROM wms_mra_interface_config", 10).catch(function () { return []; }).then(function (cfg) {
        var flag = cfg.filter(function (c) { return c.INSTANCE_NAME === inst; })[0];
        var head = 'MRA interface on ' + inst + ': ' + (flag ? (flag.INTERFACE_FLAG === 'Y' ? 'ON' : 'OFF') + ' (changed ' + (flag.CHANGED || '?') + ' by ' + (flag.CHANGED_BY || '?') + (flag.NOTE ? ', note: ' + flag.NOTE : '') + ')' : 'not set (treated as ON)');
        if (!orders.length) return { ok: true, content: head + '\nGive order numbers to check whether MRA already has them.' };
        return orders.reduce(function (p, o) {
            return p.then(function (acc) {
                return host('omBip', { path: AG_MRA_CHECK, params: { source_order_number: o }, instance: inst }, 90000).then(function (d) {
                    acc.push({ ORDER_NUMBER: o, MRA: d && d.ok ? (d.count || (d.rows || []).length ? 'SENT' : 'NOT SENT') : 'CHECK FAILED', DETAIL: d && d.ok ? '' : (d && d.error) || '' }); return acc;
                }, function (e) { acc.push({ ORDER_NUMBER: o, MRA: 'CHECK FAILED', DETAIL: String(e) }); return acc; });
            });
        }, Promise.resolve([])).then(function (list) {
            var out = AG.tableOut('MRA status · ' + inst, list);
            out.content = head + '\n' + out.content;
            return out;
        });
    });
});
