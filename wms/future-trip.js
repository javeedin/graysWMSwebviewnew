// ============================================================================
// PINNED TRIPS (+ the Future trip 999999999) + PICKER ASSIGNMENT DATE + MRA STATUS
// 1) Trip details grids get "MRA" (latest WMS_MRA_INTERFACE_STATUS row, right after Actions) and "Picker Assigned On"
//    (WMS_PICKER_ASSIGNMENT.PICKER_ASSIGNMENT_DATE, right after the order number) — from the GETTRIPDETAILS handler when it
//    sends them (apex_sql/91_gettripdetails_mra_picker.sql), else read through the APEX gateway ai/executequery.
// 2) Trip 999999999 is the "future trip": orders that have no real trip yet are moved there (Move dialog, pinned at the top).
//    Trip 9999 was the future trip before; its orders are still shown (section "Trip 9999") until they are moved.
// 3) Pinned trips: a Pin button on every trip card (wmsPinButtonHtml / wmsPinToggle) marks a trip pinned in the shared
//    APEX table WMS_TRIP_PINS (instance × trip, who / when; created on first use, apex_sql/96_pinned_trips.sql has the DDL).
// 4) Trip Management › "Pinned Trips" (fixed tab): the pinned trips of the instance as cards (date, lorry, bay, priority,
//    orders; Open = the trip opens in its own tab exactly like from the trip cards; Unpin), then every order on the future
//    trip 999999999 with only Move (to a real trip) and Delete per line — the other trip buttons are shown disabled.
//    "Set up trip 999999999" creates the trip header row when it is missing (the header table is found from the
//    trips/create ORDS handler; the INSERT is shown before it runs).
// ============================================================================
(function () {
    'use strict';
    var FUTURE = '999999999';
    var LEGACY = '9999';                 // the future trip before 999999999: shown until its orders are moved
    var ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP';
    var GW = ORDS + '/WAREHOUSEMANAGEMENT/ai';
    window.FUTURE_TRIP_ID = FUTURE;
    window.LEGACY_FUTURE_TRIP_ID = LEGACY;

    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var lit = function (s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; };
    function user() { try { return localStorage.getItem('wms_user') || sessionStorage.getItem('loggedInUser') || 'WMS'; } catch (e) { return 'WMS'; } }
    function note(m, t) { if (typeof showNotification === 'function') showNotification(m, t || 'info'); else alert(m); }
    function pick(row, names) {
        if (!row) return '';
        var keys = Object.keys(row);
        for (var i = 0; i < names.length; i++) {
            var k = keys.find(function (x) { return x.toLowerCase() === names[i].toLowerCase(); });
            if (k && row[k] != null && row[k] !== '') return row[k];
        }
        return '';
    }
    function host(msg) {
        return new Promise(function (resolve, reject) {
            if (!(window.chrome && window.chrome.webview) || typeof sendMessageToCSharp !== 'function') { reject('Open this inside the Gray\'s WMS app.'); return; }
            sendMessageToCSharp(msg, function (err, data) {
                if (err) { reject(typeof err === 'string' ? err : (err.message || JSON.stringify(err))); return; }
                var r = data; try { r = typeof data === 'string' ? JSON.parse(data) : data; } catch (e) { /* text */ }
                resolve(r);
            });
        });
    }
    /** Read-only SQL through the APEX gateway → array of row objects with UPPER-CASE keys. */
    function apexQuery(sql, max) {
        return host({ action: 'executePost', fullUrl: GW + '/executequery', body: JSON.stringify({ appUser: user(), sql: sql, maxRows: max || 5000 }) }).then(function (d) {
            if (!d || d.success === false) throw (d && (d.error || d.message)) || 'APEX query failed';
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || d.items || []).map(function (r) {
                var o = {};
                if (Array.isArray(r)) cols.forEach(function (c, i) { o[c] = r[i]; });
                else Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; });
                return o;
            });
        });
    }
    function apexWrite(sql) {
        return host({ action: 'executePost', fullUrl: GW + '/executewrite', body: JSON.stringify({ appUser: user(), sql: sql }) }).then(function (d) {
            if (d && d.success === false) throw d.error || d.message || 'APEX write failed';
            return d;
        });
    }

    // ─── 1) picker assignment date ─────────────────────────────────────────
    var DATE_FIELD = 'PICKER_ASSIGNED_ON';
    function orderOf(r) { return String(pick(r, ['ORDER_NUMBER', 'order_number', 'SOURCE_ORDER_NUMBER']) || '').trim(); }
    /** {order: 'dd-mm-yyyy hh24:mi'} for the orders (chunks of 300). */
    window.wmsPickerDates = function (orders) {
        var list = Array.from(new Set((orders || []).map(function (o) { return String(o || '').trim(); }).filter(Boolean)));
        var out = {}, chunks = [];
        for (var i = 0; i < list.length; i += 300) chunks.push(list.slice(i, i + 300));
        return Promise.all(chunks.map(function (c) {
            return apexQuery("SELECT TRIM(source_order_number) AS o, TO_CHAR(MAX(picker_assignment_date), 'DD-MM-YYYY HH24:MI') AS d FROM wms_picker_assignment WHERE TRIM(source_order_number) IN (" +
                c.map(lit).join(', ') + ") GROUP BY TRIM(source_order_number)", 5000).then(function (rows) { rows.forEach(function (r) { out[String(r.O).trim()] = r.D || ''; }); });
        })).then(function () { return out; });
    };
    // ─── 1b) MRA status (latest WMS_MRA_INTERFACE_STATUS row per order) ──────
    var MRA_FIELD = 'MRA_STATUS', API_FIELDS = { mra_status: 1, mra_irn: 1, mra_reason: 1, mra_at: 1, mra_tries: 1, picker_assigned_on: 1, actual_ship_date: 1, actual_ship_shipments: 1 };
    /** {order: {s, irn, why, at, n}} — the handler fields when the API sends them (91_gettripdetails_mra_picker.sql),
        else read through the gateway (chunks of 300; a missing table = no status). */
    window.wmsMraStatuses = function (orders, instance) {
        var list = Array.from(new Set((orders || []).map(function (o) { return String(o || '').trim(); }).filter(Boolean)));
        var out = {}, chunks = [], last = function (c) { return 'MAX(' + c + ') KEEP (DENSE_RANK LAST ORDER BY created_date, id)'; };
        for (var i = 0; i < list.length; i += 300) chunks.push(list.slice(i, i + 300));
        return Promise.all(chunks.map(function (c) {
            return apexQuery('SELECT order_number AS o, ' + last('mra_interface_status') + ' AS s, ' + last('mra_interface_id') + ' AS irn, ' +
                last('SUBSTR(failed_reason, 1, 300)') + " AS why, TO_CHAR(MAX(created_date), 'DD-MM-YYYY HH24:MI') AS at, COUNT(*) AS n " +
                'FROM wms_mra_interface_status WHERE order_number IN (' + c.map(lit).join(', ') + ')' +
                (instance ? ' AND instance_name = ' + lit(String(instance).toUpperCase()) : '') + ' GROUP BY order_number', 5000)
                .then(function (rows) { rows.forEach(function (r) { out[String(r.O).trim()] = { s: r.S || '', irn: r.IRN || '', why: r.WHY || '', at: r.AT || '', n: r.N || 0 }; }); });
        })).then(function () { return out; }, function (e) {
            if (/ORA-00942|does not exist/i.test(String(e && e.message || e))) return out;   // table not created yet: no runs
            throw e;
        });
    };
    /** MRA cell: ✔ when MRA has the order (SUCCESS / ALREADY_DONE — click = its history), otherwise an Interface button
        that runs MRAProcessor for that order right here (FAILED = red, the reason on hover; SKIPPED = order type not sent). */
    var MRA_OK = { SUCCESS: 1, ALREADY_DONE: 1 };
    function mraTip(r, s) {
        var t = [s ? s.replace('_', ' ') : 'Not sent to MRA yet'];
        if (r.MRA_IRN) t.push('IRN: ' + r.MRA_IRN);
        if (r.MRA_REASON) t.push('Reason: ' + r.MRA_REASON);
        if (r.MRA_AT) t.push('Last try: ' + r.MRA_AT + (r.MRA_TRIES > 1 ? ' · ' + r.MRA_TRIES + ' tries' : ''));
        return t;
    }
    function mraHistory(r) { if (window.MraInterface && MraInterface.history) MraInterface.history(orderOf(r), r.instance_name || r.INSTANCE_NAME); }
    function mraCell(el, info) {
        var r = info.data || {}, s = String(r[MRA_FIELD] || '').toUpperCase();
        el.empty().css({ whiteSpace: 'nowrap' });
        if (r._mraBusy) {
            $('<span>').attr('title', r._mraBusy).css({ color: '#a16207', fontSize: '.72rem', fontWeight: 700 })
                .html('<i class="fas fa-spinner fa-spin"></i> ' + esc(String(r._mraBusy).slice(0, 22))).appendTo(el);
            return;
        }
        if (MRA_OK[s]) {
            $('<span>').attr('title', mraTip(r, s).concat('Click: MRA history of this order').join('\n'))
                .css({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', borderRadius: '50%',
                    background: '#dcfce7', color: '#15803d', cursor: 'pointer', fontSize: '.95rem' })
                .html('<i class="fas fa-check"></i>')
                .on('click', function (e) { e.stopPropagation(); mraHistory(r); }).appendTo(el);
            return;
        }
        var failed = s === 'FAILED', skipped = s === 'SKIPPED';
        var tip = mraTip(r, s).concat(skipped ? 'Click: try MRA again (the app skips order types MRA does not take)' : 'Click: interface this order to MRA now');
        $('<button type="button">').attr('title', tip.join('\n'))
            .css({ border: '1px solid ' + (failed ? '#fca5a5' : skipped ? '#cbd5e1' : '#a5b4fc'), background: failed ? '#fef2f2' : skipped ? '#f8fafc' : '#eef2ff',
                color: failed ? '#b91c1c' : skipped ? '#64748b' : '#4338ca', borderRadius: '6px', padding: '2px 8px', fontSize: '.72rem', fontWeight: 700, cursor: 'pointer' })
            .html('<i class="fas ' + (failed ? 'fa-rotate-right' : 'fa-paper-plane') + '"></i> ' + (failed ? 'Retry' : 'Interface'))
            .on('click', function (e) {
                e.stopPropagation();
                if (!window.MraInterface || !MraInterface.interfaceOrder) { note('MRA Interface page script is not loaded — refresh the page.', 'error'); return; }
                var o = orderOf(r), inst = r.instance_name || r.INSTANCE_NAME || window.currentTripInstance || 'PROD';
                if (!window.confirm('Interface order ' + o + ' (' + inst + ') to MRA now?' + (failed && r.MRA_REASON ? '\n\nLast try failed: ' + r.MRA_REASON : ''))) return;
                r._mraBusy = 'Starting…'; mraCell(el, info);
                MraInterface.interfaceOrder({ order: o, instance: inst, tripId: r.trip_id || r.TRIP_ID }, function (step) { r._mraBusy = step || 'Running…'; mraCell(el, info); })
                    .then(function (x) {
                        delete r._mraBusy;
                        r[MRA_FIELD] = x.st; r.MRA_AT = new Date().toLocaleString(); r.MRA_TRIES = (Number(r.MRA_TRIES) || 0) + 1;
                        if (x.st === 'SUCCESS') { r.MRA_IRN = String(x.msg || '').replace(/^IRN\s*/, ''); r.MRA_REASON = ''; }
                        else if (!MRA_OK[x.st]) r.MRA_REASON = x.msg || '';
                        mraCell(el, info);
                        note('MRA ' + o + ': ' + (MRA_OK[x.st] ? 'interfaced' : x.st === 'SKIPPED' ? 'skipped (order type not sent to MRA)' : 'failed — ' + (x.msg || '')),
                            MRA_OK[x.st] ? 'success' : x.st === 'SKIPPED' ? 'info' : 'error');
                    });
            }).appendTo(el);
        if (s) $('<i class="fas fa-clock-rotate-left">').attr('title', 'MRA history of this order').css({ marginLeft: '6px', color: '#94a3b8', cursor: 'pointer' })
            .on('click', function (e) { e.stopPropagation(); mraHistory(r); }).appendTo(el);
    }

    // ─── 1c) Actual ship date (WMS_ACTUAL_SHIPDATE, written by the All Shipment Lines › Update Actual Ship Date dialog) ──
    var SHIP_FIELD = 'ACTUAL_SHIP_DATE', shipReady = null;
    /** Creates WMS_ACTUAL_SHIPDATE on first use (apex_sql/92_actual_shipdate.sql has the same DDL). */
    function shipEnsure() {
        if (shipReady) return shipReady;
        shipReady = apexQuery("SELECT table_name FROM user_tables WHERE table_name = 'WMS_ACTUAL_SHIPDATE'", 5).then(function (r) {
            if (r.length) return;
            return apexWrite('CREATE TABLE wms_actual_shipdate (id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, created_date DATE DEFAULT SYSDATE, ' +
                'instance_name VARCHAR2(20), trip_id VARCHAR2(50), trip_date DATE, order_number VARCHAR2(60), header_id VARCHAR2(40), order_date DATE, ' +
                'order_type VARCHAR2(100), customer_number VARCHAR2(60), customer_name VARCHAR2(400), shipment VARCHAR2(40), line_count NUMBER, ' +
                'actual_ship_date DATE, actual_ship_date_tz VARCHAR2(40), status VARCHAR2(20), error_message VARCHAR2(4000), app_user VARCHAR2(120), source VARCHAR2(30))')
                .then(function () { return apexWrite('CREATE INDEX wms_actual_shipdate_n1 ON wms_actual_shipdate (order_number, created_date)'); })
                .then(function () { return apexWrite('CREATE INDEX wms_actual_shipdate_n2 ON wms_actual_shipdate (trip_id, instance_name)'); });
        }).catch(function (e) { shipReady = null; throw e; });
        return shipReady;
    }
    /** "2026-10-06T00:00:00Z" / "06-10-2026" / "2026-10-06" → TO_DATE(...) or NULL. */
    function dateSql(v) {
        var s = String(v == null ? '' : v).trim(), m;
        if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return "TO_DATE('" + m[1] + '-' + m[2] + '-' + m[3] + "','YYYY-MM-DD')";
        if ((m = /^(\d{2})-(\d{2})-(\d{4})/.exec(s))) return "TO_DATE('" + m[3] + '-' + m[2] + '-' + m[1] + "','YYYY-MM-DD')";
        return 'NULL';
    }
    /** {order: {d: 'DD-MM-YYYY HH24:MI', shp: 'list'}} — latest SUCCESS row per order (chunks of 300; missing table = none). */
    window.wmsShipDates = function (orders, instance) {
        var list = Array.from(new Set((orders || []).map(function (o) { return String(o || '').trim(); }).filter(Boolean)));
        var out = {}, chunks = [];
        for (var i = 0; i < list.length; i += 300) chunks.push(list.slice(i, i + 300));
        return Promise.all(chunks.map(function (c) {
            return apexQuery("SELECT order_number AS o, TO_CHAR(MAX(actual_ship_date) KEEP (DENSE_RANK LAST ORDER BY created_date, id), 'DD-MM-YYYY HH24:MI') AS d, " +
                "LISTAGG(DISTINCT shipment, ', ') WITHIN GROUP (ORDER BY shipment) AS shp FROM wms_actual_shipdate WHERE status = 'SUCCESS' AND order_number IN (" +
                c.map(lit).join(', ') + ')' + (instance ? ' AND instance_name = ' + lit(String(instance).toUpperCase()) : '') + ' GROUP BY order_number', 5000)
                .then(function (rows) { rows.forEach(function (r) { out[String(r.O).trim()] = { d: r.D || '', shp: r.SHP || '' }; }); });
        })).then(function () { return out; }, function (e) {
            if (/ORA-00942|does not exist/i.test(String(e && e.message || e))) return out;
            throw e;
        });
    };
    function shipCell(el, info) {
        var r = info.data || {}, v = info.value || '';
        el.empty().css({ whiteSpace: 'nowrap' });
        if (!v) { el.html('<span style="color:#cbd5e1;" title="No actual ship date yet — All Shipment Lines › Update Actual Ship Date">—</span>'); return; }
        // the date only; the time (and the shipments) on hover
        $('<span>').attr('title', 'Actual ship date sent to Fusion: ' + v + (r.ACTUAL_SHIP_SHIPMENTS ? '\nShipment(s): ' + r.ACTUAL_SHIP_SHIPMENTS : ''))
            .css({ color: '#0369a1', fontWeight: 600 }).html('<i class="fas fa-truck-fast" style="margin-right:5px;opacity:.7"></i>' + esc(String(v).split(' ')[0])).appendTo(el);
    }
    /** Writes one row per order × shipment of the dialog's run into WMS_ACTUAL_SHIPDATE and shows the date in the trip grid. */
    /** Shared with WMS 2.0 (Pick release › Actual ship date): writes one row per order × shipment into WMS_ACTUAL_SHIPDATE.
        recs: [{instance, trip_id, trip_date, order_number, header_id, order_date, order_type, customer_number, customer_name,
                shipment, line_count, date 'YYYY-MM-DD', time 'HH:MM', sent (text sent to Fusion), ok, error, source}] */
    window.wmsRecordShipDates = function (recs) {
        var sel = (recs || []).map(function (x) {
            return 'SELECT ' + [lit(String(x.instance || 'PROD').toUpperCase()), lit(x.trip_id || ''), dateSql(x.trip_date), lit(x.order_number || ''), lit(x.header_id || ''), dateSql(x.order_date),
                lit(x.order_type || ''), lit(x.customer_number || ''), lit(String(x.customer_name || '').slice(0, 400)), lit(x.shipment || ''), Number(x.line_count) || 0,
                "TO_DATE(" + lit(x.date + ' ' + (x.time || '00:00')) + ", 'YYYY-MM-DD HH24:MI')", lit(x.sent || ''),
                lit(x.ok ? 'SUCCESS' : 'FAILED'), lit(String(x.error || '').slice(0, 3900)), lit(user()), lit(x.source || 'WMS')].join(', ') + ' FROM dual';
        });
        if (!sel.length) return Promise.resolve(0);
        var chunks = []; for (var i = 0; i < sel.length; i += 40) chunks.push(sel.slice(i, i + 40));
        return shipEnsure().then(function () {
            return chunks.reduce(function (p, c) {
                return p.then(function () {
                    return apexWrite('INSERT INTO wms_actual_shipdate (instance_name, trip_id, trip_date, order_number, header_id, order_date, order_type, ' +
                        'customer_number, customer_name, shipment, line_count, actual_ship_date, actual_ship_date_tz, status, error_message, app_user, source) ' + c.join(' UNION ALL '));
                });
            }, Promise.resolve());
        }).then(function () { return sel.length; });
    };
    function shipRecord(ctx, shipments, dateVal, timeVal, sentText) {
        var tripId = String(ctx.tripId || ''), inst = String(ctx.instance || window.currentTripInstance || 'PROD').toUpperCase();
        var result = {};
        shipments.forEach(function (shp, i) {
            var el = document.getElementById('asl-shipdate-status-' + i); if (!el) return;
            var ok = !!el.querySelector('.fa-check-circle'), bad = el.querySelector('[title]');
            result[shp] = ok ? { ok: true } : { ok: false, err: bad ? bad.getAttribute('title') : el.textContent.trim() };
        });
        var g = tripGrid(tripId), gridRows = (g && g.option('dataSource')) || [], byOrder = {};
        gridRows.forEach(function (r) { byOrder[orderOf(r)] = r; });
        var keys = {};
        (window._aslAllLines || []).forEach(function (l) {
            var shp = l.Shipment == null ? '' : String(l.Shipment).trim(); if (!shp || !result[shp]) return;
            var o = String(l._orderNumber || l.Order || '').trim(), k = o + '|' + shp;
            keys[k] = keys[k] || { o: o, shp: shp, n: 0, hid: l._headerId || l.SourceOrderId || '', cust: l.ShipToCustomer || l.ShipToPartyName || '' };
            keys[k].n++;
        });
        var tripRow = gridRows[0] || {}, tripDate = pick(tripRow, ['trip_date', 'tripdate', 'TRIP_DATE']) || '';
        var recs = Object.keys(keys).map(function (k) {
            var x = keys[k], r = byOrder[x.o] || {}, res = result[x.shp];
            return { instance: inst, trip_id: tripId, trip_date: tripDate, order_number: x.o, header_id: x.hid, order_date: pick(r, ['order_date', 'ORDER_DATE']),
                order_type: pick(r, ['order_type', 'ORDER_TYPE']), customer_number: pick(r, ['account_number', 'ACCOUNT_NUMBER']), customer_name: pick(r, ['account_name', 'ACCOUNT_NAME']) || x.cust,
                shipment: x.shp, line_count: x.n, date: dateVal, time: timeVal, sent: sentText, ok: res.ok, error: res.err, source: 'WMS_ASL' };
        });
        if (!recs.length) return Promise.resolve();
        var sel = recs;
        return window.wmsRecordShipDates(recs).then(function () {
            // show it in the trip grid at once
            var shown = dateVal.split('-').reverse().join('-') + ' ' + timeVal, n = 0;
            Object.keys(keys).forEach(function (k) {
                var x = keys[k], r = byOrder[x.o]; if (!r || !result[x.shp].ok) return;
                r[SHIP_FIELD] = shown; r.ACTUAL_SHIP_SHIPMENTS = r.ACTUAL_SHIP_SHIPMENTS && r.ACTUAL_SHIP_SHIPMENTS.indexOf(x.shp) < 0 ? r.ACTUAL_SHIP_SHIPMENTS + ', ' + x.shp : (r.ACTUAL_SHIP_SHIPMENTS || x.shp); n++;
            });
            if (g && n) g.refresh();
            var sum = document.getElementById('asl-shipdate-summary');
            if (sum) sum.insertAdjacentHTML('beforeend', ' &nbsp;•&nbsp; <span style="color:#0369a1;"><i class="fas fa-database"></i> saved in WMS_ACTUAL_SHIPDATE (' + sel.length + ' row' + (sel.length === 1 ? '' : 's') + ')</span>');
        }).catch(function (e) {
            console.warn('[Actual ship date] not saved:', e);
            note('Actual ship date was sent to Fusion but not saved in WMS_ACTUAL_SHIPDATE: ' + (e && e.message || e), 'error');
        });
    }
    function wrapShipDate() {
        var orig = window.aslConfirmUpdateShipDate;
        if (typeof orig !== 'function' || orig.__shipRec) return;
        var wrapped = function () {
            var ctx = Object.assign({}, window._aslApiContext || {}), shipments = (window._aslShipDateShipments || []).slice();
            var d = document.getElementById('asl-shipdate-date'), t = document.getElementById('asl-shipdate-time');
            var dateVal = d && d.value, timeVal = (t && t.value) || '00:00';
            var r = orig.apply(this, arguments);
            if (!dateVal || !shipments.length) return r;
            return Promise.resolve(r).then(function () { return shipRecord(ctx, shipments, dateVal, timeVal, dateVal + 'T' + timeVal + ':00+04:00'); });
        };
        wrapped.__shipRec = true;
        window.aslConfirmUpdateShipDate = wrapped;
    }
    function apiVal(r, k) { return Object.prototype.hasOwnProperty.call(r, k) ? r[k] : (Object.prototype.hasOwnProperty.call(r, k.toUpperCase()) ? r[k.toUpperCase()] : undefined); }

    /** Trip details grid: "MRA" right after Actions and "Picker Assigned On" right after the order number.
        Uses the fields the GET handler sends (mra_status, mra_irn, mra_reason, mra_at, mra_tries, picker_assigned_on);
        whatever it does not send is read through the gateway, so the grid works before and after the handler change. */
    window.wmsAddPickerDates = function (grid) {
        if (!grid) return Promise.resolve();
        var rows = grid.option('dataSource');
        if (!Array.isArray(rows) || !rows.length) return Promise.resolve();
        var f = rows[0], apiMra = apiVal(f, 'mra_status') !== undefined, apiDate = apiVal(f, 'picker_assigned_on') !== undefined,
            apiShip = apiVal(f, 'actual_ship_date') !== undefined;
        var inst = pick(f, ['instance_name', 'INSTANCE_NAME']) || window.currentTripInstance || '';
        var orders = rows.map(orderOf);
        return Promise.all([
            apiDate ? null : window.wmsPickerDates(orders).catch(function (e) { console.warn('[Picker date] not read:', e); return {}; }),
            apiMra ? null : window.wmsMraStatuses(orders, inst).catch(function (e) { console.warn('[MRA status] not read:', e); return {}; }),
            apiShip ? null : window.wmsShipDates(orders, inst).catch(function (e) { console.warn('[Actual ship date] not read:', e); return {}; })
        ]).then(function (res) {
            rows.forEach(function (r) {
                var o = orderOf(r);
                r[DATE_FIELD] = apiDate ? (apiVal(r, 'picker_assigned_on') || '') : ((res[0] || {})[o] || '');
                if (apiShip) { r[SHIP_FIELD] = apiVal(r, 'actual_ship_date') || ''; r.ACTUAL_SHIP_SHIPMENTS = apiVal(r, 'actual_ship_shipments') || ''; }
                else { var sd = (res[2] || {})[o] || {}; r[SHIP_FIELD] = sd.d || ''; r.ACTUAL_SHIP_SHIPMENTS = sd.shp || ''; }
                if (apiMra) {
                    r[MRA_FIELD] = apiVal(r, 'mra_status') || ''; r.MRA_IRN = apiVal(r, 'mra_irn') || ''; r.MRA_REASON = apiVal(r, 'mra_reason') || '';
                    r.MRA_AT = apiVal(r, 'mra_at') || ''; r.MRA_TRIES = Number(apiVal(r, 'mra_tries')) || 0;
                } else {
                    var m = (res[1] || {})[o] || {};
                    r[MRA_FIELD] = m.s || ''; r.MRA_IRN = m.irn || ''; r.MRA_REASON = m.why || ''; r.MRA_AT = m.at || ''; r.MRA_TRIES = Number(m.n) || 0;
                }
            });
            // the handler's own columns (lower case) are replaced by ours, placed where they belong
            var cols = (grid.option('columns') || []).filter(function (c) {
                var k = c && c.dataField; if (!k) return true;
                return !(API_FIELDS[String(k).toLowerCase()] && k !== k.toUpperCase()) && k !== DATE_FIELD && k !== MRA_FIELD && k !== SHIP_FIELD;
            });
            // Column order: Actions · MRA · line status · order number · picker · Picker Assigned On · order type · the rest
            // (Actual Ship Date right after the trip date) · printing status last.
            var take = function (re) {
                var i = cols.findIndex(function (c) { return c && re.test(c.dataField || ''); });
                return i >= 0 ? cols.splice(i, 1)[0] : null;
            };
            var printCol = take(/^printing_st$/i);
            var lead = [
                { dataField: MRA_FIELD, caption: 'MRA', width: 118, alignment: 'center', cellTemplate: mraCell },
                take(/^line_status$/i), take(/^order_number$/i), take(/^picker(_name)?$/i),
                { dataField: DATE_FIELD, caption: 'Picker Assigned On', width: 135, alignment: 'center',
                    cellTemplate: function (el, info) { el.text(info.value || '—').css({ color: info.value ? '#0f766e' : '#94a3b8', whiteSpace: 'nowrap' }); } },
                take(/^order_type$/i)
            ].filter(Boolean);
            var act = cols.findIndex(function (c) { return c && !c.dataField && /actions/i.test(c.caption || ''); });
            cols.splice.apply(cols, [act + 1, 0].concat(lead));          // act = -1 → at the start
            // trip / order dates: the date only (DD-MM-YYYY like the other date columns), the full value on hover
            cols.forEach(function (c) {
                if (!c || !/^(tripdate|trip_date|order_date)$/i.test(c.dataField || '')) return;
                c.cellTemplate = function (el, info) {
                    var v = info.value == null ? '' : String(info.value), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
                    el.text(m ? m[3] + '-' + m[2] + '-' + m[1] : v).attr('title', v).css('white-space', 'nowrap');
                };
            });
            var td = cols.findIndex(function (c) { return c && /^(tripdate|trip_date)$/i.test(c.dataField || ''); });
            if (td < 0) td = cols.findIndex(function (c) { return c && /^ship_confirm_st$/i.test(c.dataField || ''); });
            cols.splice(td >= 0 ? td + 1 : cols.length, 0, { dataField: SHIP_FIELD, caption: 'Actual Ship Date', width: 150, alignment: 'center', cellTemplate: shipCell });
            if (printCol) cols.push(printCol);
            grid.option('columns', cols);
            grid.refresh();
        }).catch(function (e) { console.warn('[Trip extras] not added:', e); });
    };
    function tripGrid(tripId) {
        try { var el = $('#grid-trip-detail-' + tripId); return el.length ? el.dxDataGrid('instance') : null; } catch (e) { return null; }
    }
    /** Waits until the trip grid shows rows it did not have before (the WMS draws / refreshes it asynchronously),
        then adds the picker dates once per data set. */
    function datesWhenReady(tripId, before, tries) {
        tries = tries || 0;
        var g = tripGrid(tripId), ds = g && g.option('dataSource');
        if (g && Array.isArray(ds) && ds !== before && !ds.__pickerDates) {
            ds.__pickerDates = true;
            if (ds.length) window.wmsAddPickerDates(g);
            return;
        }
        if (tries < 90) setTimeout(function () { datesWhenReady(tripId, before, tries + 1); }, 500);
    }

    // ─── 2) the future trip 999999999 exists? set it up ───────────────────
    /** Finds the trip header table: the INSERT of the trips/create ORDS handler, else a table with TRIP_ID + a lorry column. */
    function headerTable() {
        return apexQuery("SELECT TO_CHAR(SUBSTR(h.source, 1, 4000)) AS src FROM user_ords_handlers h JOIN user_ords_templates t ON t.id = h.template_id " +
            "WHERE LOWER(t.uri_template) LIKE 'trips/create%' AND h.method = 'POST'", 5).catch(function () { return []; }).then(function (rows) {
            var src = rows.map(function (r) { return r.SRC || ''; }).join('\n'), m = /INSERT\s+INTO\s+("?[A-Za-z0-9_$#]+"?)/i.exec(src);
            if (m && !/wms_trip_details/i.test(m[1])) return { table: m[1].replace(/"/g, '').toUpperCase(), how: 'the trips/create ORDS handler' };
            return apexQuery("SELECT table_name FROM user_tab_columns WHERE column_name IN ('TRIP_ID', 'TRIP_LORRY', 'LORRY_NUMBER', 'VEHICLE') " +
                "GROUP BY table_name HAVING SUM(CASE WHEN column_name = 'TRIP_ID' THEN 1 ELSE 0 END) = 1 AND COUNT(*) >= 2 ORDER BY table_name", 50).then(function (t) {
                var names = t.map(function (r) { return r.TABLE_NAME; }).filter(function (n) { return !/TRIP_DETAILS|TRIP_CONFIG|TRIP_PINS|^WMS_W2|PRINT|_V$|^FSQ_/i.test(n); });
                if (!names.length) throw 'No trip header table found (a table with TRIP_ID and a lorry column).';
                return { table: names[0], how: 'the tables with TRIP_ID + lorry columns (' + names.join(', ') + ')' };
            });
        });
    }
    /** {exists, table, how, blocked, insert} — the INSERT fills the columns a new trip row needs. */
    window.futureTripStatus = function (instance) {
        return headerTable().then(function (h) {
            return apexQuery("SELECT column_name, data_type, data_precision, nullable, NVL(identity_column, 'NO') AS ident, data_default FROM user_tab_columns WHERE table_name = " + lit(h.table) + " ORDER BY column_id", 300).then(function (cols) {
                var has = function (c) { return cols.some(function (x) { return x.COLUMN_NAME === c; }); };
                var inst = cols.find(function (x) { return /^(INSTANCE|INSTANCE_NAME|TRIP_INSTANCE|P_INSTANCE_NAME)$/.test(x.COLUMN_NAME); });
                var idc = cols.find(function (x) { return x.COLUMN_NAME === 'TRIP_ID'; });
                var idv = idc && /CHAR/.test(String(idc.DATA_TYPE || '')) ? lit(FUTURE) : FUTURE;
                // ONE header row for every instance: the WMS handlers (trips/addorders …) look a trip up by trip_id alone —
                // a second row (e.g. one per instance) makes Move / Add Orders fail with ORA-01422.
                var where = 'trip_id = ' + idv;
                var ic = inst ? inst.COLUMN_NAME : null;
                return apexQuery('SELECT COUNT(*) AS n' + (ic ? ", LISTAGG(" + ic + ", ', ') WITHIN GROUP (ORDER BY " + ic + ') AS insts' : '') + ' FROM ' + h.table + ' WHERE ' + where, 1).then(function (r) {
                    var n = (r[0] && +r[0].N) || 0, insts = (r[0] && r[0].INSTS) || '';
                    var keep = ic ? 'SELECT MIN(ROWID) KEEP (DENSE_RANK FIRST ORDER BY CASE WHEN UPPER(' + ic + ") = 'PROD' THEN 0 ELSE 1 END) FROM " + h.table + ' WHERE ' + where
                                  : 'SELECT MIN(ROWID) FROM ' + h.table + ' WHERE ' + where;
                    var names = [], vals = [];
                    cols.forEach(function (c) {
                        var n = c.COLUMN_NAME, t = String(c.DATA_TYPE || ''), v = null;
                        if (n === 'TRIP_ID') v = idv;
                        else if (/DATE$/.test(n) && /DATE|TIMESTAMP/.test(t)) v = /CREAT|UPDAT|LAST/.test(n) ? 'SYSDATE' : "DATE '2099-12-31'";
                        else if (/LORRY|VEHICLE/.test(n)) v = lit('FUTURE TRIP');
                        else if (/BAY/.test(n)) v = lit('FUTURE');
                        else if (/PRIORITY/.test(n)) v = /NUMBER/.test(t) ? '99' : lit('99');
                        else if (/STATUS/.test(n)) v = lit('OPEN');
                        else if (inst && n === inst.COLUMN_NAME) v = lit(instance);
                        else if (/NOTES?|REMARKS?|DESCRIPTION/.test(n)) v = lit('Future trip: orders without a trip yet');
                        else if (/CREATED_BY|UPDATED_BY|LAST_UPDATED_BY/.test(n)) v = lit(user());
                        else if (c.NULLABLE === 'N' && c.IDENT !== 'YES' && !c.DATA_DEFAULT) v = /NUMBER/.test(t) ? '0' : /DATE|TIMESTAMP/.test(t) ? 'SYSDATE' : lit('-');
                        if (v != null) { names.push(n); vals.push(v); }
                    });
                    var blocked = '';
                    if (idc && idc.IDENT === 'YES') blocked = 'TRIP_ID of ' + h.table + ' is an identity column, so trip ' + FUTURE + ' cannot be inserted with that number — ask the DBA (apex_sql/96_pinned_trips.sql).';
                    else if (idc && idc.DATA_PRECISION && +idc.DATA_PRECISION < FUTURE.length) blocked = 'TRIP_ID of ' + h.table + ' is NUMBER(' + idc.DATA_PRECISION + '): ' + FUTURE + ' does not fit — widen the column (apex_sql/96_pinned_trips.sql).';
                    if (!has('TRIP_ID')) blocked = h.table + ' has no TRIP_ID column.';
                    return { exists: n > 0, rows: n, instances: insts, duplicates: n > 1, table: h.table, how: h.how, blocked: blocked,
                        insert: 'INSERT INTO ' + h.table + ' (' + names.join(', ') + ') VALUES (' + vals.join(', ') + ')',
                        dedupe: 'DELETE FROM ' + h.table + ' WHERE ' + where + ' AND ROWID <> (' + keep + ')' };
                });
            });
        });
    };

    // ─── 3) pinned trips (WMS_TRIP_PINS, shared by every PC) ──────────────
    var pinsReady = null, pinsLoaded = null;
    /** Creates WMS_TRIP_PINS on first use (apex_sql/96_pinned_trips.sql has the same DDL). */
    function pinsEnsure() {
        if (pinsReady) return pinsReady;
        pinsReady = apexQuery("SELECT table_name FROM user_tables WHERE table_name = 'WMS_TRIP_PINS'", 5).then(function (r) {
            if (r.length) return;
            return apexWrite('CREATE TABLE wms_trip_pins (instance_name VARCHAR2(20) NOT NULL, trip_id VARCHAR2(50) NOT NULL, pinned_by VARCHAR2(120), ' +
                'pinned_date DATE DEFAULT SYSDATE, note VARCHAR2(400), CONSTRAINT wms_trip_pins_pk PRIMARY KEY (instance_name, trip_id))');
        }).catch(function (e) { pinsReady = null; throw e; });
        return pinsReady;
    }
    function instOf(instance) {
        var v = String(instance == null ? '' : instance).trim();
        if (!v || v === 'null' || v === 'undefined') { try { v = localStorage.getItem('fusionInstance') || ''; } catch (e) { /* storage blocked */ } }
        return (v || 'PROD').toUpperCase();
    }
    /** {INSTANCE: {tripId: {by, at, note}}} — every pin of every instance (the table is small). */
    window.wmsPins = {};
    window.wmsLoadPins = function (force) {
        if (pinsLoaded && !force) return pinsLoaded;
        pinsLoaded = apexQuery("SELECT instance_name, trip_id, pinned_by, TO_CHAR(pinned_date, 'DD-MM-YYYY HH24:MI') AS at, note FROM wms_trip_pins ORDER BY pinned_date DESC", 5000)
            .then(function (rows) {
                var m = {};
                rows.forEach(function (r) {
                    var i = String(r.INSTANCE_NAME || '').toUpperCase(), t = String(r.TRIP_ID || '').trim(); if (!i || !t) return;
                    m[i] = m[i] || {}; m[i][t] = { by: r.PINNED_BY || '', at: r.AT || '', note: r.NOTE || '' };
                });
                window.wmsPins = m; window.wmsPaintPins(); return m;
            }, function (e) {
                if (/ORA-00942|does not exist/i.test(String(e && e.message || e))) { window.wmsPins = {}; window.wmsPaintPins(); return window.wmsPins; }   // nothing pinned yet
                pinsLoaded = null; throw e;
            });
        return pinsLoaded;
    };
    window.wmsIsPinned = function (tripId, instance) { var m = window.wmsPins[instOf(instance)]; return !!(m && m[String(tripId == null ? '' : tripId).trim()]); };
    window.wmsPinnedTrips = function (instance) { var m = window.wmsPins[instOf(instance)] || {}; return Object.keys(m).map(function (t) { return Object.assign({ trip: t }, m[t]); }); };
    function pinCount() { var n = 0; Object.keys(window.wmsPins).forEach(function (i) { n += Object.keys(window.wmsPins[i]).length; }); return n; }
    function paintPinBtn(b) {
        var on = window.wmsIsPinned(b.dataset.trip, b.dataset.inst), info = on ? (window.wmsPins[instOf(b.dataset.inst)] || {})[String(b.dataset.trip).trim()] : null;
        b.classList.toggle('pinned', on);
        b.style.background = on ? '#fef3c7' : '#fff'; b.style.color = on ? '#b45309' : '#64748b'; b.style.borderColor = on ? '#fcd34d' : '#e2e8f0';
        b.title = on ? 'Pinned' + (info && info.by ? ' by ' + info.by : '') + (info && info.at ? ' on ' + info.at : '') + ' — it is on the Pinned Trips tab. Click to unpin.' : 'Pin this trip — it stays on the Pinned Trips tab until you unpin it';
        b.innerHTML = '<i class="fas fa-thumbtack" style="font-size:.55rem;' + (on ? '' : 'transform:rotate(45deg);opacity:.7;') + '"></i>' + (b.dataset.label ? ' ' + (on ? 'Pinned' : 'Pin') : '');
    }
    /** Repaints every Pin button on the page and the count on the tab. */
    window.wmsPaintPins = function () {
        document.querySelectorAll('.wms-pin-btn').forEach(paintPinBtn);
        var n = pinCount();
        document.querySelectorAll('.wms-pin-count').forEach(function (el) { el.textContent = n; el.style.display = n ? '' : 'none'; });
    };
    /** The Pin button of a trip card (app.js renders it between View Details and Assign Agent). */
    window.wmsPinButtonHtml = function (tripId, instance, label) {
        if (!pinsLoaded) window.wmsLoadPins().catch(function (e) { console.warn('[Pinned trips] not read:', e); });
        var on = window.wmsIsPinned(tripId, instance);
        return '<button type="button" class="wms-pin-btn' + (on ? ' pinned' : '') + '" data-trip="' + esc(tripId) + '" data-inst="' + esc(instOf(instance)) + '"' + (label ? ' data-label="1"' : '') +
            ' onclick="event.stopPropagation();wmsPinToggle(this.dataset.trip,this.dataset.inst,this)" title="' + (on ? 'Pinned — click to unpin' : 'Pin this trip') + '"' +
            ' style="flex:0 0 auto;font-size:.6rem;padding:.35rem .5rem;border:1px solid ' + (on ? '#fcd34d' : '#e2e8f0') + ';border-radius:4px;background:' + (on ? '#fef3c7' : '#fff') + ';color:' + (on ? '#b45309' : '#64748b') + ';cursor:pointer;display:flex;align-items:center;gap:.3rem;font-weight:700;">' +
            '<i class="fas fa-thumbtack" style="font-size:.55rem;' + (on ? '' : 'transform:rotate(45deg);opacity:.7;') + '"></i>' + (label ? (on ? ' Pinned' : ' Pin') : '') + '</button>';
    };
    /** Pin / unpin one trip: one row in WMS_TRIP_PINS (every PC sees it); repaints the cards and the tab. */
    window.wmsPinToggle = function (tripId, instance, btn) {
        var t = String(tripId == null ? '' : tripId).trim(), i = instOf(instance);
        if (!t) return Promise.resolve();
        if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
        var was = window.wmsIsPinned(t, i);
        var p = was
            ? pinsEnsure().then(function () { return apexWrite('DELETE FROM wms_trip_pins WHERE instance_name = ' + lit(i) + ' AND trip_id = ' + lit(t)); })
            : pinsEnsure().then(function () {
                return apexWrite('INSERT INTO wms_trip_pins (instance_name, trip_id, pinned_by) SELECT ' + lit(i) + ', ' + lit(t) + ', ' + lit(user()) +
                    ' FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_trip_pins WHERE instance_name = ' + lit(i) + ' AND trip_id = ' + lit(t) + ')');
            });
        return p.then(function () {
            window.wmsPins[i] = window.wmsPins[i] || {};
            if (was) delete window.wmsPins[i][t]; else window.wmsPins[i][t] = { by: user(), at: new Date().toLocaleString(), note: '' };
            window.wmsPaintPins();
            note(was ? 'Trip ' + t + ' unpinned.' : 'Trip ' + t + ' pinned — see Trip Management › Pinned Trips.', 'success');
            if (document.getElementById('pt-list') && document.getElementById('trip-future-trip-tab') && document.getElementById('trip-future-trip-tab').classList.contains('active')) loadPinned();
            return !was;
        }).catch(function (e) {
            note('Could not ' + (was ? 'unpin' : 'pin') + ' trip ' + t + ': ' + (e && e.message || e), 'error');
        }).then(function (r) { if (btn) { btn.disabled = false; btn.style.opacity = '1'; } return r; });
    };

    // ─── 4) Pinned Trips tab ──────────────────────────────────────────────
    var F = window.FutureTrip = { rows: [], legacyRows: [], instance: null, grid: null, legacyGrid: null, pinned: [] };
    function inst() {
        if (F.instance) return F.instance;
        var s = document.getElementById('ft-inst'); return (s && s.value) || 'PROD';
    }
    function activate() {
        document.querySelectorAll('#trip-tab-header .tab-item').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === 'future-trip'); });
        document.querySelectorAll('#trip-tab-content .tab-pane').forEach(function (p) { p.classList.toggle('active', p.id === 'trip-future-trip-tab'); });
    }
    var DISABLED = [['fa-edit', 'Edit Trip'], ['fa-user-plus', 'Assign Picker'], ['fa-boxes', 'Allocate Lots for S2V'], ['fa-truck-loading', 'Pick Release All'],
        ['fa-shipping-fast', 'All Shipment Lines'], ['fa-user-cog', 'Add to Agent'], ['fa-list', 'Show Lines'], ['fa-tags', 'Get Profit Centers'], ['fa-plus', 'Add Orders']];
    var CARD = 'background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.08);padding:1rem;';
    function shell() {
        var root = document.getElementById('future-trip-root'); if (!root || root.dataset.ready) return root;
        root.dataset.ready = '1';
        root.innerHTML =
            '<div style="padding:1rem;display:flex;flex-direction:column;gap:1rem;">' +
            // pinned trips: title row with the instance, the count and Refresh (no header strip)
            '<div style="' + CARD + '">' +
              '<div style="display:flex;gap:8px;align-items:center;margin-bottom:.75rem;flex-wrap:wrap;"><b style="color:#1e293b;"><i class="fas fa-thumbtack" style="color:#b45309;margin-right:6px;"></i>Pinned trips</b>' +
                '<span id="pt-sub" style="font-size:.74rem;color:#64748b;"></span><span style="flex:1;"></span>' +
                '<label style="font-size:.75rem;color:#334155;font-weight:700;">Instance <select id="ft-inst" style="margin-left:4px;padding:4px 8px;border-radius:6px;border:1px solid #cbd5e1;"><option>PROD</option><option>TEST</option></select></label>' +
                '<span id="pt-count" title="Pinned trips of this instance" style="background:#f1f5f9;border-radius:20px;padding:3px 10px;font-weight:700;color:#334155;font-size:.74rem;white-space:nowrap;">…</span>' +
                '<button class="btn btn-info" id="ft-refresh" style="font-size:.68rem;padding:.3rem .6rem;"><i class="fas fa-sync-alt"></i> Refresh</button></div>' +
              '<div id="pt-list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.75rem;"></div>' +
            '</div>' +
            // the future trip: title row with its order count and the set-up / fix status, then the WMS trip buttons (disabled) and the grid
            '<div style="' + CARD + '">' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:.75rem;">' +
                '<b style="margin-right:4px;color:#1e293b;"><i class="fas fa-hourglass-half" style="color:#d97706;margin-right:6px;"></i>Future trip ' + FUTURE + ' · Order Details</b>' +
                '<span id="ft-count" title="Orders on the future trip ' + FUTURE + '" style="background:#f1f5f9;border-radius:20px;padding:3px 10px;font-weight:700;color:#334155;font-size:.74rem;white-space:nowrap;">…</span>' +
                '<span id="ft-setup"></span>' +
                DISABLED.map(function (b) { return '<button class="btn" disabled title="Not available on the future trip — move the order to a real trip first" style="font-size:.68rem;padding:.3rem .6rem;background:#e2e8f0;color:#94a3b8;border:none;cursor:not-allowed;"><i class="fas ' + b[0] + '"></i> ' + b[1] + '</button>'; }).join('') +
              '</div>' +
              '<div id="ft-grid"></div>' +
            '</div>' +
            '<div id="ft-legacy" style="' + CARD + 'display:none;border:1px solid #fde68a;">' +
              '<div style="display:flex;gap:8px;align-items:center;margin-bottom:.75rem;flex-wrap:wrap;"><b style="color:#92400e;"><i class="fas fa-triangle-exclamation" style="margin-right:6px;"></i>Trip ' + LEGACY + ' (the future trip before ' + FUTURE + ')</b>' +
                '<span id="ft-legacy-sub" style="font-size:.74rem;color:#92400e;">still holds orders — Move each one to trip ' + FUTURE + ' (first in the list) or to a real trip.</span></div>' +
              '<div id="ft-legacy-grid"></div>' +
            '</div>' +
            '</div>';
        var s = document.getElementById('ft-inst');
        try { s.value = localStorage.getItem('futureTripInstance') || 'PROD'; } catch (e) { /* storage blocked */ }
        s.onchange = function () { try { localStorage.setItem('futureTripInstance', s.value); } catch (e) { /* storage blocked */ } F.load(); };
        document.getElementById('ft-refresh').onclick = function () { F.load(true); };
        return root;
    }
    function setupBox(st) {
        var box = document.getElementById('ft-setup'); if (!box) return;
        if (!st) { box.innerHTML = ''; return; }
        if (st.duplicates) {
            box.innerHTML = '<button id="ft-fix" title="The WMS handlers find a trip by its id alone, so two header rows make Move / Add Orders fail with ORA-01422. This keeps one row and deletes the others." ' +
                'style="background:#b91c1c;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-weight:800;font-size:.75rem;cursor:pointer;"><i class="fas fa-triangle-exclamation"></i> Fix: trip ' + FUTURE + ' has ' + st.rows + ' header rows' + (st.instances ? ' (' + esc(st.instances) + ')' : '') + ' — Move fails with ORA-01422</button>';
            document.getElementById('ft-fix').onclick = function () { F.fix(st); };
            return;
        }
        if (st.exists) { box.innerHTML = '<span title="Trip ' + FUTURE + ' is set up in ' + esc(st.table) + '" style="font-size:.72rem;color:#166534;font-weight:700;"><i class="fas fa-check-circle"></i> set up</span>'; return; }
        box.innerHTML = '<button id="ft-mk" style="background:#b45309;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-weight:800;font-size:.75rem;cursor:pointer;"><i class="fas fa-plus-circle"></i> Set up trip ' + FUTURE + '</button>';
        document.getElementById('ft-mk').onclick = function () { F.setup(st); };
    }
    F.setup = function (st) {
        if (st.blocked) { alert(st.blocked); return; }
        if (!confirm('Create trip ' + FUTURE + ' (Future Trip) — one header row, used by every instance?\n\nFound the trip table through ' + st.how + '. This runs:\n\n' + st.insert)) return;
        apexWrite(st.insert).then(function () { note('Trip ' + FUTURE + ' created.', 'success'); F.load(); },
            function (e) { alert('Trip ' + FUTURE + ' was not created:\n' + e + '\n\nRun apex_sql/96_pinned_trips.sql by hand instead.'); });
    };
    /** Two header rows for the future trip (one per instance) break trips/addorders (ORA-01422): keep one, delete the rest. */
    F.fix = function (st) {
        if (!confirm('Trip ' + FUTURE + ' has ' + st.rows + ' header rows in ' + st.table + (st.instances ? ' (' + st.instances + ')' : '') + '.\n\nThe WMS handlers look a trip up by its id alone, so Move / Add Orders to trip ' + FUTURE +
            ' fail with ORA-01422 until one row is left. The order lines keep their own instance, so one header row serves PROD and TEST.\n\nThis runs:\n\n' + st.dedupe)) return;
        apexWrite(st.dedupe).then(function () { note('Trip ' + FUTURE + ' now has one header row.', 'success'); F.load(); },
            function (e) { alert('Could not delete the extra rows:\n' + e + '\n\nRun the DELETE of apex_sql/96_pinned_trips.sql by hand.'); });
    };
    /** GETTRIPDETAILS/{trip} → the order rows (MRA fields of the handler mapped). */
    function tripRows(tripId, instance) {
        return host({ action: 'executeGet', fullUrl: ORDS + '/WAREHOUSEMANAGEMENT/GETTRIPDETAILS/' + encodeURIComponent(tripId) + '?P_INSTANCE_NAME=' + encodeURIComponent(instance) }).then(function (res) {
            var rows = ((res && res.items) || []).filter(function (r) { return orderOf(r); });
            rows.forEach(function (r) {
                if (apiVal(r, 'mra_status') === undefined) return;
                r[MRA_FIELD] = apiVal(r, 'mra_status') || ''; r.MRA_IRN = apiVal(r, 'mra_irn') || ''; r.MRA_REASON = apiVal(r, 'mra_reason') || '';
                r.MRA_AT = apiVal(r, 'mra_at') || ''; r.MRA_TRIES = Number(apiVal(r, 'mra_tries')) || 0;
            });
            return rows;
        });
    }
    function dateOnly(v) { var s = String(v == null ? '' : v), m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? m[3] + '-' + m[2] + '-' + m[1] : s; }
    /** The facts of one pinned trip from its first order row (date, lorry, bay, priority) + the order count. */
    function tripFacts(tripId, rows) {
        var r = rows[0] || {};
        return { trip: String(tripId), n: rows.length, date: pick(r, ['TRIP_DATE', 'trip_date', 'tripdate']), lorry: pick(r, ['TRIP_LORRY', 'trip_lorry', 'LORRY_NUMBER', 'lorry_number', 'VEHICLE']),
            bay: pick(r, ['TRIP_LOADING_BAY', 'trip_loading_bay', 'LOADING_BAY', 'loading_bay']), prio: pick(r, ['TRIP_PRIORITY', 'trip_priority', 'PRIORITY', 'priority']),
            pickers: Array.from(new Set(rows.map(function (x) { return pick(x, ['PICKER_NAME', 'picker_name', 'PICKER', 'picker']); }).filter(Boolean))).length };
    }
    /** Open a pinned trip exactly like a trip card does: openTripDetails fetches the trip and opens its tab. */
    F.open = function (tripId, instance) {
        var f = (F.pinned || []).find(function (x) { return x.trip === String(tripId); }) || {};
        if (typeof window.openTripDetails !== 'function') { note('Trip details are not loaded — refresh the page.', 'error'); return; }
        window.openTripDetails(String(tripId), f.date || '', f.lorry || '', instance, f.bay || '', f.prio || '');
    };
    function pinCard(p, f, instance) {
        var missing = f && f.n === 0, err = f && f.error;
        return '<div class="pt-card" data-trip="' + esc(p.trip) + '" style="border:1px solid ' + (err ? '#fecaca' : '#fde68a') + ';border-radius:10px;padding:.7rem .8rem;background:' + (err ? '#fff7f7' : '#fffdf5') + ';display:flex;flex-direction:column;gap:.45rem;">' +
            '<div style="display:flex;align-items:center;gap:8px;"><i class="fas fa-thumbtack" style="color:#b45309;"></i><b style="font-size:1rem;color:#1e293b;">Trip ' + esc(p.trip) + '</b>' +
              '<span style="margin-left:auto;font-size:.68rem;color:#64748b;" title="Pinned by ' + esc(p.by || '?') + (p.at ? ' on ' + esc(p.at) : '') + '">' + esc(p.by || '') + (p.at ? ' · ' + esc(String(p.at).split(' ')[0]) : '') + '</span></div>' +
            (f ? (err ? '<div style="font-size:.74rem;color:#b91c1c;">Could not read this trip: ' + esc(err) + '</div>'
                : '<div style="display:flex;gap:.4rem;flex-wrap:wrap;font-size:.7rem;">' +
                    '<span style="background:#eff6ff;color:#1d4ed8;border-radius:6px;padding:2px 7px;font-weight:700;" title="Trip date"><i class="fas fa-calendar-day"></i> ' + esc(f.date ? dateOnly(f.date) : '—') + '</span>' +
                    '<span style="background:#f1f5f9;color:#334155;border-radius:6px;padding:2px 7px;font-weight:700;" title="Lorry"><i class="fas fa-truck"></i> ' + esc(f.lorry || '—') + '</span>' +
                    (f.bay ? '<span style="background:#f1f5f9;color:#334155;border-radius:6px;padding:2px 7px;font-weight:700;" title="Loading bay"><i class="fas fa-warehouse"></i> ' + esc(f.bay) + '</span>' : '') +
                    (f.prio ? '<span style="background:#fef3c7;color:#92400e;border-radius:6px;padding:2px 7px;font-weight:700;" title="Priority"><i class="fas fa-flag"></i> ' + esc(f.prio) + '</span>' : '') +
                    '<span style="background:#ecfdf5;color:#047857;border-radius:6px;padding:2px 7px;font-weight:700;" title="Orders on the trip"><i class="fas fa-box"></i> ' + f.n + ' order' + (f.n === 1 ? '' : 's') + '</span>' +
                    (f.pickers ? '<span style="background:#f5f3ff;color:#6d28d9;border-radius:6px;padding:2px 7px;font-weight:700;" title="Pickers assigned"><i class="fas fa-user"></i> ' + f.pickers + '</span>' : '') +
                  '</div>' + (missing ? '<div style="font-size:.72rem;color:#92400e;">No orders on this trip in ' + esc(instance) + ' (deleted, or on another instance).</div>' : ''))
                : '<div style="font-size:.74rem;color:#64748b;"><i class="fas fa-spinner fa-spin"></i> reading the trip…</div>') +
            (p.note ? '<div style="font-size:.72rem;color:#475569;font-style:italic;">' + esc(p.note) + '</div>' : '') +
            '<div style="display:flex;gap:.4rem;margin-top:auto;">' +
              '<button type="button" class="pt-open" style="flex:1;font-size:.7rem;padding:.4rem .6rem;background:#1d4ed8;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;display:flex;align-items:center;justify-content:center;gap:.35rem;" title="Open this trip in its own tab, like from the trip cards"><i class="fas fa-eye"></i> Open</button>' +
              '<button type="button" class="pt-unpin" style="font-size:.7rem;padding:.4rem .6rem;background:#fff;color:#b45309;border:1px solid #fcd34d;border-radius:6px;cursor:pointer;font-weight:700;" title="Take this trip off the Pinned Trips tab"><i class="fas fa-thumbtack" style="transform:rotate(45deg);"></i> Unpin</button>' +
            '</div></div>';
    }
    /** The pinned trips of the instance as cards; each trip's facts are read with GETTRIPDETAILS (4 at a time). */
    function loadPinned() {
        var instance = inst(), list = document.getElementById('pt-list'), sub = document.getElementById('pt-sub'), cnt = document.getElementById('pt-count');
        if (!list) return Promise.resolve();
        var token = loadPinned.token = {};
        return window.wmsLoadPins(true).catch(function (e) { if (sub) sub.textContent = 'Pins not read: ' + (e && e.message || e); return {}; }).then(function () {
            if (loadPinned.token !== token) return;
            var pins = window.wmsPinnedTrips(instance).sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
            F.pinned = pins.map(function (p) { return { trip: p.trip }; });
            if (cnt) cnt.textContent = pins.length + ' pinned';
            if (sub) sub.textContent = pins.length ? instance + ' · newest first' : '';
            if (!pins.length) {
                list.innerHTML = '<div style="grid-column:1/-1;padding:1rem;text-align:center;color:#64748b;font-size:.82rem;border:1px dashed #e2e8f0;border-radius:10px;">' +
                    'No pinned trips in ' + esc(instance) + ' yet. On <b>All Trips</b> press <i class="fas fa-thumbtack" style="color:#b45309;"></i> <b>Pin</b> on a trip card and it appears here.</div>';
                return;
            }
            list.innerHTML = pins.map(function (p) { return pinCard(p, null, instance); }).join('');
            list.onclick = function (e) {
                var card = e.target.closest('.pt-card'); if (!card) return;
                var t = card.dataset.trip;
                if (e.target.closest('.pt-open')) F.open(t, instance);
                else if (e.target.closest('.pt-unpin')) { if (confirm('Unpin trip ' + t + '?')) window.wmsPinToggle(t, instance, e.target.closest('.pt-unpin')); }
            };
            var i = 0;
            function next() {
                if (i >= pins.length || loadPinned.token !== token) return Promise.resolve();
                var p = pins[i++];
                return tripRows(p.trip, instance).then(function (rows) { return tripFacts(p.trip, rows); }, function (e) { return { trip: p.trip, n: 0, error: String(e && e.message || e) }; }).then(function (f) {
                    if (loadPinned.token !== token) return;
                    var k = F.pinned.findIndex(function (x) { return x.trip === p.trip; }); if (k >= 0) F.pinned[k] = f;
                    var card = list.querySelector('.pt-card[data-trip="' + p.trip.replace(/"/g, '') + '"]');
                    if (card) card.outerHTML = pinCard(p, f, instance);
                    return next();
                });
            }
            return Promise.all([next(), next(), next(), next()]);
        });
    }
    /** The future trip's orders (and the old 9999's, shown only while it still has some). */
    function loadFuture() {
        var instance = inst(), gridEl = document.getElementById('ft-grid'), cnt = document.getElementById('ft-count');
        if (cnt) cnt.textContent = 'loading…';
        window.futureTripStatus(instance).then(setupBox, function (e) { console.warn('[Pinned Trips] setup check:', e); setupBox(null); });
        var main = tripRows(FUTURE, instance).then(function (rows) {
            F.rows = rows;
            if (cnt) cnt.textContent = rows.length + ' order' + (rows.length === 1 ? '' : 's') + ' on ' + FUTURE;
            return window.wmsPickerDates(rows.map(orderOf)).then(function (map) { rows.forEach(function (r) { r[DATE_FIELD] = map[orderOf(r)] || ''; }); }, function () {})
                .then(function () { F.grid = draw(gridEl, rows, instance, FUTURE, F.grid); });
        }).catch(function (e) {
            if (cnt) cnt.textContent = 'error';
            gridEl.innerHTML = '<div style="padding:1.5rem;color:#b91c1c;">Could not read trip ' + FUTURE + ': ' + esc(e) + '</div>';
        });
        var legacy = tripRows(LEGACY, instance).then(function (rows) {
            F.legacyRows = rows;
            var box = document.getElementById('ft-legacy'); if (!box) return;
            box.style.display = rows.length ? '' : 'none';
            if (!rows.length) return;
            document.getElementById('ft-legacy-sub').innerHTML = 'still holds <b>' + rows.length + '</b> order' + (rows.length === 1 ? '' : 's') + ' — Move each one to trip ' + FUTURE + ' (first in the list) or to a real trip.';
            F.legacyGrid = draw(document.getElementById('ft-legacy-grid'), rows, instance, LEGACY, F.legacyGrid);
        }).catch(function (e) { console.warn('[Pinned Trips] trip ' + LEGACY + ' not read:', e); });
        return Promise.all([main, legacy]);
    }
    F.load = function () {
        shell();
        return Promise.all([loadPinned(), loadFuture()]);
    };
    function draw(el, rows, instance, tripId, oldGrid) {
        if (!el) return null;
        var skip = { test: function (k) {
            return /^(trip_id|trip_date|trip_lorry|trip_loading_bay|loading_bay|trip_priority|instance|instance_name|links)$/i.test(k) ||
                /^(mra_status|mra_irn|mra_reason|mra_at|mra_tries|picker_assigned_on|MRA_IRN|MRA_REASON|MRA_AT|MRA_TRIES)$/.test(k);   // handler fields: shown as MRA / Picker Assigned On
        } };
        var keys = []; rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (keys.indexOf(k) < 0 && !skip.test(k)) keys.push(k); }); });
        var first = [MRA_FIELD, 'ORDER_NUMBER', 'order_number', 'ORDER_TYPE', 'order_type', 'ACCOUNT_NAME', 'account_name', 'PICKER', 'picker', DATE_FIELD];
        keys.sort(function (a, b) { var x = first.indexOf(a), y = first.indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });
        var onMoved = function () { setTimeout(F.load, 400); };
        if (oldGrid) { try { oldGrid.dispose(); } catch (e) { /* gone */ } }
        el.innerHTML = '';
        if (!rows.length) {
            el.innerHTML = '<div class="ft-empty" style="padding:.9rem 1rem;border:1px dashed #e2e8f0;border-radius:10px;color:#64748b;font-size:.82rem;"><i class="fas fa-hourglass-half" style="color:#d97706;margin-right:6px;"></i>' +
                (tripId === FUTURE ? 'No orders on the future trip. Move an order here from any trip with its <b>Move</b> button — trip ' + FUTURE + ' is first in the list.' : 'No orders on trip ' + esc(tripId) + '.') + '</div>';
            return null;
        }
        if (!(window.$ && $.fn && $.fn.dxDataGrid)) {
            // no DevExtreme on this page: a plain table with the same Move / Delete
            var show = keys.slice(0, 8);
            el.innerHTML = '<table class="pt-plain" style="width:100%;border-collapse:collapse;font-size:.78rem;"><thead><tr><th style="text-align:left;padding:4px 6px;border-bottom:1px solid #e2e8f0;">Actions</th>' +
                show.map(function (k) { return '<th style="text-align:left;padding:4px 6px;border-bottom:1px solid #e2e8f0;">' + esc(k === DATE_FIELD ? 'Picker Assigned On' : k.replace(/_/g, ' ')) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                (rows.length ? rows.map(function (r, i) {
                    return '<tr data-i="' + i + '"><td style="padding:4px 6px;white-space:nowrap;"><button type="button" class="pt-move" title="Move to a real trip" style="border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:6px;padding:3px 8px;margin-right:4px;cursor:pointer;"><i class="fas fa-right-left"></i></button>' +
                        '<button type="button" class="pt-del" title="Delete from this trip" style="border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;border-radius:6px;padding:3px 8px;cursor:pointer;"><i class="fas fa-trash"></i></button></td>' +
                        show.map(function (k) { return '<td style="padding:4px 6px;">' + esc(r[k] == null ? '' : r[k]) + '</td>'; }).join('') + '</tr>';
                }).join('') : '<tr><td colspan="' + (show.length + 1) + '" style="padding:12px;color:#64748b;">No orders on trip ' + esc(tripId) + '.</td></tr>') + '</tbody></table>';
            el.onclick = function (e) {
                var tr = e.target.closest('tr[data-i]'); if (!tr) return;
                var r = rows[+tr.dataset.i], o = orderOf(r);
                if (e.target.closest('.pt-move')) { if (typeof window.openMoveOrderToTrip === 'function') window.openMoveOrderToTrip({ orderNumber: o, fromTripId: tripId, instance: instance, row: r, onMoved: onMoved }); }
                else if (e.target.closest('.pt-del')) F.remove(o, instance, tripId);
            };
            return null;
        }
        var cols = [{
            caption: 'Actions', width: 96, alignment: 'center', allowSorting: false, allowFiltering: false,
            cellTemplate: function (c, info) {
                var r = info.data, o = orderOf(r);
                $('<button title="Move to a real trip" style="border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:6px;padding:3px 8px;margin-right:4px;cursor:pointer;"><i class="fas fa-right-left"></i></button>')
                    .on('click', function () {
                        if (typeof window.openMoveOrderToTrip !== 'function') { alert('Move order is not loaded. Please refresh the page.'); return; }
                        window.openMoveOrderToTrip({ orderNumber: o, fromTripId: tripId, instance: instance, row: r, onMoved: onMoved });
                    }).appendTo(c);
                $('<button title="Delete from this trip" style="border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;border-radius:6px;padding:3px 8px;cursor:pointer;"><i class="fas fa-trash"></i></button>')
                    .on('click', function () { F.remove(o, instance, tripId); }).appendTo(c);
            }
        }].concat(keys.map(function (k) {
            var c = { dataField: k, caption: k === DATE_FIELD ? 'Picker Assigned On' : k === MRA_FIELD ? 'MRA' : k.replace(/_/g, ' ') };
            if (k === MRA_FIELD) { c.cellTemplate = mraCell; c.alignment = 'center'; }
            if (/^order_number$/i.test(k)) c.cellTemplate = function (cell, info) { $('<b>').text(info.value || '').appendTo(cell); };
            return c;
        }));
        return $('<div>').appendTo(el).dxDataGrid({
            dataSource: rows, columns: cols, showBorders: true, rowAlternationEnabled: true, columnAutoWidth: true, allowColumnResizing: true,
            searchPanel: { visible: true, width: 240, placeholder: 'Search…' }, filterRow: { visible: true }, headerFilter: { visible: true },
            paging: { pageSize: 50 }, export: { enabled: true }, height: 'auto',
            noDataText: tripId === FUTURE ? 'No orders on the future trip. Move an order here from any trip with the Move button (trip ' + FUTURE + ' is at the top of the list).' : 'No orders on trip ' + tripId + '.',
            onExporting: function (e) {
                if (typeof ExcelJS === 'undefined' || typeof saveAs === 'undefined') return;
                var wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Trip ' + tripId);
                DevExpress.excelExporter.exportDataGrid({ component: e.component, worksheet: ws }).then(function () {
                    return wb.xlsx.writeBuffer();
                }).then(function (b) { saveAs(new Blob([b], { type: 'application/octet-stream' }), 'Future_Trip_' + tripId + '.xlsx'); });
                e.cancel = true;
            }
        }).dxDataGrid('instance');
    }
    /** Delete = the WMS Remove: deletetripline + the picker assignment row. */
    F.remove = function (o, instance, tripId) {
        tripId = tripId || FUTURE;
        if (!confirm('Delete order ' + o + ' from trip ' + tripId + (tripId === FUTURE ? ' (the future trip)' : '') + '?\n\nIt goes back to the pending orders; its picker assignment is deleted too.')) return;
        host({ action: 'executeDelete', fullUrl: ORDS + '/TRIPMANAGEMENT/deletetripline?P_ORDER_NUMBER=' + encodeURIComponent(o) + '&P_INSTANCE_NAME=' + encodeURIComponent(instance) }).then(function (r) {
            if (r && (r.status === 'error' || r.success === false)) throw r.message || JSON.stringify(r);
            return (window.wmsClearPickerAssignment ? window.wmsClearPickerAssignment(o) : Promise.resolve({ ok: true }));
        }).then(function () { note('Order ' + o + ' deleted from trip ' + tripId + '.', 'success'); F.load(); },
            function (e) { note('Could not delete ' + o + ': ' + e, 'error'); });
    };

    document.addEventListener('DOMContentLoaded', function () {
        var tab = document.querySelector('.tab-item[data-tab="future-trip"]');
        if (tab) tab.addEventListener('click', function () { activate(); F.load(); });
        // the pin count on the tab and the Pin buttons of the first cards
        if (window.chrome && window.chrome.webview) setTimeout(function () { window.wmsLoadPins().catch(function (e) { console.warn('[Pinned trips] not read:', e); }); }, 1500);
        // after app.js has set up its window functions: picker dates on every trip details grid
        setTimeout(function () {
            wrapShipDate();
            ['openTripDetailsWithData', 'refreshTripDetails'].forEach(function (name) {
                var orig = window[name]; if (typeof orig !== 'function' || orig.__pickerDates) return;
                var wrapped = function (tripId) {
                    var g = tripGrid(tripId), before = g ? g.option('dataSource') : null;
                    var r = orig.apply(this, arguments);
                    setTimeout(function () { datesWhenReady(tripId, before); }, 200);
                    return r;
                };
                wrapped.__pickerDates = true;
                window[name] = wrapped;
            });
        }, 0);
    });
})();
