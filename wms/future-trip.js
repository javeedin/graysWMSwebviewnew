// ============================================================================
// FUTURE TRIP (trip 9999) + PICKER ASSIGNMENT DATE + MRA STATUS
// 1) Trip details grids get "MRA" (latest WMS_MRA_INTERFACE_STATUS row, right after Actions) and "Picker Assigned On"
//    (WMS_PICKER_ASSIGNMENT.PICKER_ASSIGNMENT_DATE, right after the order number) — from the GETTRIPDETAILS handler when it
//    sends them (apex_sql/91_gettripdetails_mra_picker.sql), else read through the APEX gateway ai/executequery.
// 2) Trip 9999 is the "future trip": orders that have no real trip yet are moved there (Move dialog, pinned at the top).
// 3) Trip Management › "Future Trip" (fixed tab): every order on trip 9999 with only Move (to a real trip) and Delete per
//    line — the other trip buttons are shown disabled. "Set up trip 9999" creates the trip header row when it is missing
//    (the header table is found from the trips/create ORDS handler; the INSERT is shown before it runs).
// ============================================================================
(function () {
    'use strict';
    var FUTURE = '9999';
    var ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP';
    var GW = ORDS + '/WAREHOUSEMANAGEMENT/ai';
    window.FUTURE_TRIP_ID = FUTURE;

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
        $('<span>').attr('title', 'Actual ship date sent to Fusion' + (r.ACTUAL_SHIP_SHIPMENTS ? '\nShipment(s): ' + r.ACTUAL_SHIP_SHIPMENTS : ''))
            .css({ color: '#0369a1', fontWeight: 600 }).html('<i class="fas fa-truck-fast" style="margin-right:5px;opacity:.7"></i>' + esc(v)).appendTo(el);
    }
    /** Writes one row per order × shipment of the dialog's run into WMS_ACTUAL_SHIPDATE and shows the date in the trip grid. */
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
        var dateSqlSent = "TO_DATE(" + lit(dateVal + ' ' + timeVal) + ", 'YYYY-MM-DD HH24:MI')";
        var sel = Object.keys(keys).map(function (k) {
            var x = keys[k], r = byOrder[x.o] || {}, res = result[x.shp];
            return 'SELECT ' + [lit(inst), lit(tripId), dateSql(tripDate), lit(x.o), lit(x.hid), dateSql(pick(r, ['order_date', 'ORDER_DATE'])),
                lit(pick(r, ['order_type', 'ORDER_TYPE']) || ''), lit(pick(r, ['account_number', 'ACCOUNT_NUMBER']) || ''),
                lit(String(pick(r, ['account_name', 'ACCOUNT_NAME']) || x.cust || '').slice(0, 400)), lit(x.shp), x.n, dateSqlSent, lit(sentText),
                lit(res.ok ? 'SUCCESS' : 'FAILED'), lit(String(res.err || '').slice(0, 3900)), lit(user()), "'WMS_ASL'"].join(', ') + ' FROM dual';
        });
        if (!sel.length) return Promise.resolve();
        var chunks = []; for (var i = 0; i < sel.length; i += 40) chunks.push(sel.slice(i, i + 40));
        return shipEnsure().then(function () {
            return chunks.reduce(function (p, c) {
                return p.then(function () {
                    return apexWrite('INSERT INTO wms_actual_shipdate (instance_name, trip_id, trip_date, order_number, header_id, order_date, order_type, ' +
                        'customer_number, customer_name, shipment, line_count, actual_ship_date, actual_ship_date_tz, status, error_message, app_user, source) ' + c.join(' UNION ALL '));
                });
            }, Promise.resolve());
        }).then(function () {
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

    // ─── 2) trip 9999 exists? set it up ───────────────────────────────────
    /** Finds the trip header table: the INSERT of the trips/create ORDS handler, else a table with TRIP_ID + a lorry column. */
    function headerTable() {
        return apexQuery("SELECT TO_CHAR(SUBSTR(h.source, 1, 4000)) AS src FROM user_ords_handlers h JOIN user_ords_templates t ON t.id = h.template_id " +
            "WHERE LOWER(t.uri_template) LIKE 'trips/create%' AND h.method = 'POST'", 5).catch(function () { return []; }).then(function (rows) {
            var src = rows.map(function (r) { return r.SRC || ''; }).join('\n'), m = /INSERT\s+INTO\s+("?[A-Za-z0-9_$#]+"?)/i.exec(src);
            if (m && !/wms_trip_details/i.test(m[1])) return { table: m[1].replace(/"/g, '').toUpperCase(), how: 'the trips/create ORDS handler' };
            return apexQuery("SELECT table_name FROM user_tab_columns WHERE column_name IN ('TRIP_ID', 'TRIP_LORRY', 'LORRY_NUMBER', 'VEHICLE') " +
                "GROUP BY table_name HAVING SUM(CASE WHEN column_name = 'TRIP_ID' THEN 1 ELSE 0 END) = 1 AND COUNT(*) >= 2 ORDER BY table_name", 50).then(function (t) {
                var names = t.map(function (r) { return r.TABLE_NAME; }).filter(function (n) { return !/TRIP_DETAILS|TRIP_CONFIG|^WMS_W2|PRINT|_V$|^FSQ_/i.test(n); });
                if (!names.length) throw 'No trip header table found (a table with TRIP_ID and a lorry column).';
                return { table: names[0], how: 'the tables with TRIP_ID + lorry columns (' + names.join(', ') + ')' };
            });
        });
    }
    /** {exists, table, how, insert} — the INSERT fills the columns a new trip row needs. */
    window.futureTripStatus = function (instance) {
        return headerTable().then(function (h) {
            return apexQuery("SELECT column_name, data_type, nullable, NVL(identity_column, 'NO') AS ident, data_default FROM user_tab_columns WHERE table_name = " + lit(h.table) + " ORDER BY column_id", 300).then(function (cols) {
                var has = function (c) { return cols.some(function (x) { return x.COLUMN_NAME === c; }); };
                var inst = cols.find(function (x) { return /^(INSTANCE|INSTANCE_NAME|TRIP_INSTANCE|P_INSTANCE_NAME)$/.test(x.COLUMN_NAME); });
                var where = 'trip_id = ' + FUTURE + (inst ? ' AND ' + inst.COLUMN_NAME + ' = ' + lit(instance) : '');
                return apexQuery('SELECT COUNT(*) AS n FROM ' + h.table + ' WHERE ' + where, 1).then(function (r) {
                    var idc = cols.find(function (x) { return x.COLUMN_NAME === 'TRIP_ID'; });
                    var names = [], vals = [];
                    cols.forEach(function (c) {
                        var n = c.COLUMN_NAME, t = String(c.DATA_TYPE || ''), v = null;
                        if (n === 'TRIP_ID') v = FUTURE;
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
                    var blocked = idc && idc.IDENT === 'YES' ? 'TRIP_ID of ' + h.table + ' is an identity column, so trip 9999 cannot be inserted with that number — ask the DBA (apex_sql/88_future_trip_9999.sql).' : '';
                    if (!has('TRIP_ID')) blocked = h.table + ' has no TRIP_ID column.';
                    return { exists: (r[0] && +r[0].N) > 0, table: h.table, how: h.how, blocked: blocked,
                        insert: 'INSERT INTO ' + h.table + ' (' + names.join(', ') + ') VALUES (' + vals.join(', ') + ')' };
                });
            });
        });
    };

    // ─── 3) Future Trip tab ───────────────────────────────────────────────
    var F = window.FutureTrip = { rows: [], instance: null, grid: null };
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
    function shell() {
        var root = document.getElementById('future-trip-root'); if (!root || root.dataset.ready) return root;
        root.dataset.ready = '1';
        root.innerHTML =
            '<div style="padding:1rem;">' +
            '<div style="background:linear-gradient(135deg,#fef3c7,#fde68a);border:1px solid #f59e0b;border-radius:12px;padding:.9rem 1.1rem;display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:1rem;">' +
              '<div style="width:42px;height:42px;border-radius:10px;background:#f59e0b;color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.2rem;"><i class="fas fa-hourglass-half"></i></div>' +
              '<div style="flex:1;min-width:220px;"><div style="font-weight:800;color:#78350f;font-size:1.05rem;">Trip ' + FUTURE + ' · Future Trip</div>' +
                '<div style="font-size:.8rem;color:#92400e;">Orders parked until they get a real trip. Use <b>Move</b> to send an order to its trip, or <b>Delete</b> to take it off.</div></div>' +
              '<label style="font-size:.75rem;color:#78350f;font-weight:700;">Instance <select id="ft-inst" style="margin-left:4px;padding:4px 8px;border-radius:6px;border:1px solid #f59e0b;"><option>PROD</option><option>TEST</option></select></label>' +
              '<span id="ft-count" style="background:#fff;border-radius:20px;padding:4px 12px;font-weight:800;color:#92400e;font-size:.8rem;">…</span>' +
              '<span id="ft-setup"></span>' +
            '</div>' +
            '<div style="background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.08);padding:1rem;">' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:.75rem;">' +
                '<b style="margin-right:8px;color:#1e293b;">Order Details</b>' +
                '<button class="btn btn-info" id="ft-refresh" style="font-size:.68rem;padding:.3rem .6rem;"><i class="fas fa-sync-alt"></i> Refresh</button>' +
                DISABLED.map(function (b) { return '<button class="btn" disabled title="Not available on the future trip — move the order to a real trip first" style="font-size:.68rem;padding:.3rem .6rem;background:#e2e8f0;color:#94a3b8;border:none;cursor:not-allowed;"><i class="fas ' + b[0] + '"></i> ' + b[1] + '</button>'; }).join('') +
              '</div>' +
              '<div id="ft-grid"></div>' +
            '</div></div>';
        var s = document.getElementById('ft-inst');
        try { s.value = localStorage.getItem('futureTripInstance') || 'PROD'; } catch (e) { /* storage blocked */ }
        s.onchange = function () { try { localStorage.setItem('futureTripInstance', s.value); } catch (e) { /* storage blocked */ } F.load(); };
        document.getElementById('ft-refresh').onclick = function () { F.load(); };
        return root;
    }
    function setupBox(st) {
        var box = document.getElementById('ft-setup'); if (!box) return;
        if (!st) { box.innerHTML = ''; return; }
        if (st.exists) { box.innerHTML = '<span style="font-size:.72rem;color:#166534;font-weight:700;"><i class="fas fa-check-circle"></i> trip ' + FUTURE + ' is set up (' + esc(st.table) + ')</span>'; return; }
        box.innerHTML = '<button id="ft-mk" style="background:#b45309;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-weight:800;font-size:.75rem;cursor:pointer;"><i class="fas fa-plus-circle"></i> Set up trip ' + FUTURE + ' in ' + esc(inst()) + '</button>';
        document.getElementById('ft-mk').onclick = function () { F.setup(st); };
    }
    F.setup = function (st) {
        if (st.blocked) { alert(st.blocked); return; }
        if (!confirm('Create trip ' + FUTURE + ' (Future Trip) in ' + inst() + '?\n\nFound the trip table through ' + st.how + '. This runs:\n\n' + st.insert)) return;
        apexWrite(st.insert).then(function () { note('Trip ' + FUTURE + ' created in ' + inst() + '.', 'success'); F.load(); },
            function (e) { alert('Trip ' + FUTURE + ' was not created:\n' + e + '\n\nRun apex_sql/88_future_trip_9999.sql by hand instead.'); });
    };
    F.load = function () {
        shell();
        var instance = inst(), gridEl = document.getElementById('ft-grid');
        document.getElementById('ft-count').textContent = 'loading…';
        window.futureTripStatus(instance).then(setupBox, function (e) { console.warn('[Future Trip] setup check:', e); setupBox(null); });
        host({ action: 'executeGet', fullUrl: ORDS + '/WAREHOUSEMANAGEMENT/GETTRIPDETAILS/' + FUTURE + '?P_INSTANCE_NAME=' + encodeURIComponent(instance) }).then(function (res) {
            var rows = ((res && res.items) || []).filter(function (r) { return orderOf(r); });
            F.rows = rows;
            rows.forEach(function (r) {
                if (apiVal(r, 'mra_status') === undefined) return;
                r[MRA_FIELD] = apiVal(r, 'mra_status') || ''; r.MRA_IRN = apiVal(r, 'mra_irn') || ''; r.MRA_REASON = apiVal(r, 'mra_reason') || '';
                r.MRA_AT = apiVal(r, 'mra_at') || ''; r.MRA_TRIES = Number(apiVal(r, 'mra_tries')) || 0;
            });
            document.getElementById('ft-count').textContent = rows.length + ' order' + (rows.length === 1 ? '' : 's');
            return window.wmsPickerDates(rows.map(orderOf)).then(function (map) { rows.forEach(function (r) { r[DATE_FIELD] = map[orderOf(r)] || ''; }); }, function () {}).then(function () { draw(gridEl, rows, instance); });
        }).catch(function (e) {
            document.getElementById('ft-count').textContent = 'error';
            gridEl.innerHTML = '<div style="padding:1.5rem;color:#b91c1c;">Could not read trip ' + FUTURE + ': ' + esc(e) + '</div>';
        });
    };
    function draw(el, rows, instance) {
        var skip = { test: function (k) {
            return /^(trip_id|trip_date|trip_lorry|trip_loading_bay|loading_bay|trip_priority|instance|instance_name|links)$/i.test(k) ||
                /^(mra_status|mra_irn|mra_reason|mra_at|mra_tries|picker_assigned_on|MRA_IRN|MRA_REASON|MRA_AT|MRA_TRIES)$/.test(k);   // handler fields: shown as MRA / Picker Assigned On
        } };
        var keys = []; rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (keys.indexOf(k) < 0 && !skip.test(k)) keys.push(k); }); });
        var first = [MRA_FIELD, 'ORDER_NUMBER', 'order_number', 'ORDER_TYPE', 'order_type', 'ACCOUNT_NAME', 'account_name', 'PICKER', 'picker', DATE_FIELD];
        keys.sort(function (a, b) { var x = first.indexOf(a), y = first.indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y); });
        var cols = [{
            caption: 'Actions', width: 96, alignment: 'center', allowSorting: false, allowFiltering: false,
            cellTemplate: function (c, info) {
                var r = info.data, o = orderOf(r);
                $('<button title="Move to a real trip" style="border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:6px;padding:3px 8px;margin-right:4px;cursor:pointer;"><i class="fas fa-right-left"></i></button>')
                    .on('click', function () {
                        if (typeof window.openMoveOrderToTrip !== 'function') { alert('Move order is not loaded. Please refresh the page.'); return; }
                        window.openMoveOrderToTrip({ orderNumber: o, fromTripId: FUTURE, instance: instance, row: r, onMoved: function () { setTimeout(F.load, 400); } });
                    }).appendTo(c);
                $('<button title="Delete from the future trip" style="border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;border-radius:6px;padding:3px 8px;cursor:pointer;"><i class="fas fa-trash"></i></button>')
                    .on('click', function () { F.remove(o, instance); }).appendTo(c);
            }
        }].concat(keys.map(function (k) {
            var c = { dataField: k, caption: k === DATE_FIELD ? 'Picker Assigned On' : k === MRA_FIELD ? 'MRA' : k.replace(/_/g, ' ') };
            if (k === MRA_FIELD) { c.cellTemplate = mraCell; c.alignment = 'center'; }
            if (/^order_number$/i.test(k)) c.cellTemplate = function (cell, info) { $('<b>').text(info.value || '').appendTo(cell); };
            return c;
        }));
        if (F.grid) { try { F.grid.dispose(); } catch (e) { /* gone */ } }
        el.innerHTML = '';
        F.grid = $('<div>').appendTo(el).dxDataGrid({
            dataSource: rows, columns: cols, showBorders: true, rowAlternationEnabled: true, columnAutoWidth: true, allowColumnResizing: true,
            searchPanel: { visible: true, width: 240, placeholder: 'Search…' }, filterRow: { visible: true }, headerFilter: { visible: true },
            paging: { pageSize: 50 }, export: { enabled: true }, height: 'auto',
            noDataText: 'No orders on the future trip. Move an order here from any trip with the Move button (trip ' + FUTURE + ' is at the top of the list).',
            onExporting: function (e) {
                if (typeof ExcelJS === 'undefined' || typeof saveAs === 'undefined') return;
                var wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Trip ' + FUTURE);
                DevExpress.excelExporter.exportDataGrid({ component: e.component, worksheet: ws }).then(function () {
                    return wb.xlsx.writeBuffer();
                }).then(function (b) { saveAs(new Blob([b], { type: 'application/octet-stream' }), 'Future_Trip_' + FUTURE + '.xlsx'); });
                e.cancel = true;
            }
        }).dxDataGrid('instance');
    }
    /** Delete = the WMS Remove: deletetripline + the picker assignment row. */
    F.remove = function (o, instance) {
        if (!confirm('Delete order ' + o + ' from the future trip (' + FUTURE + ')?\n\nIt goes back to the pending orders; its picker assignment is deleted too.')) return;
        host({ action: 'executeDelete', fullUrl: ORDS + '/TRIPMANAGEMENT/deletetripline?P_ORDER_NUMBER=' + encodeURIComponent(o) + '&P_INSTANCE_NAME=' + encodeURIComponent(instance) }).then(function (r) {
            if (r && (r.status === 'error' || r.success === false)) throw r.message || JSON.stringify(r);
            return (window.wmsClearPickerAssignment ? window.wmsClearPickerAssignment(o) : Promise.resolve({ ok: true }));
        }).then(function () { note('Order ' + o + ' deleted from the future trip.', 'success'); F.load(); },
            function (e) { note('Could not delete ' + o + ': ' + e, 'error'); });
    };

    document.addEventListener('DOMContentLoaded', function () {
        var tab = document.querySelector('.tab-item[data-tab="future-trip"]');
        if (tab) tab.addEventListener('click', function () { activate(); F.load(); });
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
