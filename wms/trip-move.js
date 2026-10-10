// ============================================================================
// MOVE ORDER TO ANOTHER TRIP (Trip details grids — the icon before Remove)
// A move = remove the order from its trip (TRIPMANAGEMENT/deletetripline) and add it to the chosen trip
// (WAREHOUSEMANAGEMENT/trips/addorders). If adding fails, the order is put back on the trip it came from.
// ============================================================================
(function () {
    const ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP';
    const DELETE_URL = ORDS + '/TRIPMANAGEMENT/deletetripline';
    const ADD_URL = ORDS + '/WAREHOUSEMANAGEMENT/trips/addorders';

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const errText = e => { try { return typeof e === 'string' ? e : (e && e.message ? e.message : JSON.stringify(e)); } catch (_) { return String(e); } };
    /** First non-empty value among the field names (case-insensitive). */
    function pick(row, names) {
        if (!row) return '';
        const keys = Object.keys(row);
        for (const n of names) {
            const k = keys.find(x => x.toLowerCase() === n.toLowerCase());
            if (k && row[k] != null && row[k] !== '') return row[k];
        }
        return '';
    }
    function call(action, fullUrl, body) {
        return new Promise((resolve, reject) => {
            const msg = { action: action, fullUrl: fullUrl };
            if (body !== undefined) msg.body = JSON.stringify(body);
            sendMessageToCSharp(msg, function (error, data) {
                if (error) { reject(errText(error)); return; }
                let r = null;
                try { r = typeof data === 'string' ? JSON.parse(data) : data; } catch (e) { r = null; }
                if (r && (r.status === 'error' || r.success === false)) { reject(r.message || r.error || JSON.stringify(r)); return; }
                resolve(r);
            });
        });
    }

    /** Trips the user can move to: the trips loaded on Trip Management (same date range / instance), current one left out. */
    function tripChoices(fromTripId) {
        const by = {};
        const add = (r, isOrderRow) => {
            const id = String(pick(r, ['TRIP_ID', 'trip_id', 'TRIPID', 'tripid']) || '').trim();
            if (!id || id === String(fromTripId)) return;
            const t = by[id] || (by[id] = { id: id, date: '', lorry: '', status: '', bay: '', orders: 0, customers: {} });
            t.date = t.date || String(pick(r, ['TRIP_DATE', 'trip_date', 'COST_DATE', 'cost_date']) || '').slice(0, 10);
            t.lorry = t.lorry || pick(r, ['TRIP_LORRY', 'trip_lorry', 'LORRY', 'lorry_number', 'VEHICLE', 'vehicle']);
            t.status = t.status || pick(r, ['TRIP_STATUS', 'trip_status', 'STATUS']);
            t.bay = t.bay || pick(r, ['TRIP_LOADING_BAY', 'trip_loading_bay', 'LOADING_BAY', 'loading_bay']);
            if (isOrderRow && pick(r, ['ORDER_NUMBER', 'order_number', 'source_order_number'])) t.orders++;
        };
        (window.currentFullData || []).forEach(r => add(r, true));
        (window.tripDetailsAllData || []).forEach(r => add(r, true));
        const FUTURE = String(window.FUTURE_TRIP_ID || '999999999');
        delete by[FUTURE];
        const list = Object.values(by).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id, undefined, { numeric: true }));
        // trip 999999999 = the Future Trip (Trip Management › Pinned Trips): orders that have no real trip yet; always first
        if (String(fromTripId) !== FUTURE) list.unshift({ id: FUTURE, date: '', lorry: 'Future trip — no trip yet', status: 'FUTURE', bay: '', orders: 0, future: true });
        return list;
    }

    /**
     * opts: { orderNumber, fromTripId, instance, row (the grid row, for the add payload), onMoved(toTripId) }
     */
    window.openMoveOrderToTrip = function (opts) {
        const orderNumber = String(opts.orderNumber || '').trim();
        if (!orderNumber) { alert('Order number not found for this row.'); return; }
        const fromTrip = String(opts.fromTripId || '').trim();
        const instance = opts.instance || window.currentTripInstance || sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || 'TEST';
        const row = opts.row || {};
        const trips = tripChoices(fromTrip);
        let chosen = '';

        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:100000;display:flex;align-items:center;justify-content:center;padding:20px;';
        ov.innerHTML =
            '<div style="background:#fff;width:100%;max-width:640px;max-height:88vh;display:flex;flex-direction:column;border-radius:14px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.35);">' +
              '<div style="padding:.8rem 1.1rem;background:linear-gradient(135deg,#2563eb,#1e40af);color:#fff;display:flex;align-items:center;gap:10px;font-weight:700;font-size:.95rem;">' +
                '<i class="fas fa-right-left"></i><span style="flex:1;">Move order to another trip</span>' +
                '<i class="fas fa-code" id="mv-api-toggle" title="Show API requests" style="cursor:pointer;opacity:.9;"></i>' +
                '<i class="fas fa-times" id="mv-x" style="cursor:pointer;"></i>' +
              '</div>' +
              '<div style="padding:1rem 1.1rem;display:flex;flex-direction:column;gap:10px;overflow:auto;">' +
                '<div style="font-size:.85rem;color:#334155;">Move order <b>' + esc(orderNumber) + '</b>' + (fromTrip ? ' from trip <b>' + esc(fromTrip) + '</b>' : '') + ' to:</div>' +
                '<div style="display:flex;gap:8px;align-items:center;">' +
                  '<div style="position:relative;flex:1;"><i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:.75rem;"></i>' +
                    '<input id="mv-q" type="search" placeholder="Filter trips (id, date, lorry, status)…" style="width:100%;padding:7px 10px 7px 28px;border:1px solid #e2e8f0;border-radius:8px;font-size:.8rem;"></div>' +
                  '<span style="font-size:.75rem;color:#64748b;">or trip ID</span>' +
                  '<input id="mv-id" type="text" inputmode="numeric" placeholder="e.g. 12345" style="width:110px;padding:7px 9px;border:1px solid #e2e8f0;border-radius:8px;font-size:.8rem;">' +
                '</div>' +
                '<div id="mv-list" style="border:1px solid #e2e8f0;border-radius:10px;max-height:300px;overflow:auto;"></div>' +
                '<div id="mv-api" style="display:none;border:1px solid #1e293b;border-radius:8px;background:#0b1020;color:#a6e3a1;font-family:Consolas,monospace;font-size:11px;padding:10px;white-space:pre-wrap;word-break:break-all;"></div>' +
                '<div id="mv-result" style="font-size:12px;min-height:16px;"></div>' +
              '</div>' +
              '<div style="padding:.7rem 1.1rem;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
                '<span id="mv-sel" style="font-size:.78rem;color:#64748b;">Choose a trip</span>' +
                '<div style="display:flex;gap:8px;">' +
                  '<button id="mv-cancel" style="padding:7px 14px;border:1px solid #e2e8f0;background:#fff;border-radius:8px;font-weight:700;cursor:pointer;">Cancel</button>' +
                  '<button id="mv-go" disabled style="padding:7px 16px;border:none;background:#2563eb;color:#fff;border-radius:8px;font-weight:800;cursor:pointer;opacity:.5;"><i class="fas fa-right-left"></i> Move</button>' +
                '</div>' +
              '</div>' +
            '</div>';
        document.body.appendChild(ov);
        const $ = sel => ov.querySelector(sel);
        const close = () => ov.remove();
        ov.addEventListener('click', e => { if (e.target === ov) close(); });
        $('#mv-x').onclick = close; $('#mv-cancel').onclick = close;
        $('#mv-api-toggle').onclick = () => { const b = $('#mv-api'); b.style.display = b.style.display === 'none' ? 'block' : 'none'; };

        function payloadFor(tripId) {
            return {
                trip_id: parseInt(tripId, 10) || tripId,
                orders: [{
                    order_number: orderNumber,
                    account_number: pick(row, ['account_number', 'ACCOUNT_NUMBER', 'CUSTOMER_NUMBER', 'customer_number']),
                    account_name: pick(row, ['account_name', 'ACCOUNT_NAME', 'CUSTOMER_NAME', 'customer_name', 'PARTY_NAME']),
                    order_date: pick(row, ['order_date', 'ORDER_DATE', 'ORDERED_DATE', 'ordered_date']),
                    order_type: pick(row, ['order_type_code', 'ORDER_TYPE_CODE', 'order_type', 'ORDER_TYPE']),
                    salesrep_name: pick(row, ['salesrep_name', 'SALESREP_NAME', 'SALESREP', 'salesrep']),
                    instance: pick(row, ['instance', 'INSTANCE', 'instance_name', 'INSTANCE_NAME']) || instance
                }]
            };
        }
        function deleteUrl() { return DELETE_URL + '?P_ORDER_NUMBER=' + encodeURIComponent(orderNumber) + '&P_INSTANCE_NAME=' + encodeURIComponent(instance); }
        function showApi() {
            $('#mv-api').textContent = '1) DELETE ' + deleteUrl() + '\n\n2) POST ' + ADD_URL + '\n' + JSON.stringify(payloadFor(chosen || '<trip id>'), null, 2) +
                (fromTrip ? '\n\nIf step 2 fails, the order is added back to trip ' + fromTrip + ' with the same POST.' : '');
        }
        function select(id) {
            chosen = String(id || '').trim();
            Array.prototype.forEach.call(ov.querySelectorAll('[data-trip]'), el => {
                const on = el.getAttribute('data-trip') === chosen;
                el.style.background = on ? '#eff6ff' : (el.getAttribute('data-future') ? '#fffbeb' : ''); el.style.boxShadow = on ? 'inset 3px 0 0 #2563eb' : '';
            });
            const ok = !!chosen && chosen !== fromTrip;
            $('#mv-go').disabled = !ok; $('#mv-go').style.opacity = ok ? '1' : '.5';
            $('#mv-sel').innerHTML = chosen === fromTrip && chosen ? '<span style="color:#b91c1c;">That is the order\'s current trip.</span>'
                : ok ? 'Move to trip <b style="color:#1e40af;">' + esc(chosen) + '</b>' : 'Choose a trip';
            showApi();
        }
        function draw() {
            const q = $('#mv-q').value.trim().toLowerCase();
            const list = trips.filter(t => !q || [t.id, t.date, t.lorry, t.status, t.bay].join(' ').toLowerCase().indexOf(q) >= 0);
            $('#mv-list').innerHTML = list.length ? list.map(t =>
                '<div data-trip="' + esc(t.id) + '"' + (t.future ? ' data-future="1"' : '') + ' style="display:flex;gap:10px;align-items:center;padding:8px 12px;border-bottom:1px solid #f1f5f9;cursor:pointer;font-size:.8rem;' + (t.future ? 'background:#fffbeb;' : '') + '">' +
                  '<i class="fas ' + (t.future ? 'fa-hourglass-half' : 'fa-truck') + '" style="color:' + (t.future ? '#d97706' : '#2563eb') + ';"></i>' +
                  '<b style="min-width:70px;">' + esc(t.id) + '</b>' +
                  '<span style="color:#475569;min-width:84px;">' + esc(t.date || '') + '</span>' +
                  '<span style="color:#334155;flex:1;">' + esc(t.lorry || '') + (t.bay ? ' · bay ' + esc(t.bay) : '') + '</span>' +
                  (t.status ? '<span style="font-size:.68rem;font-weight:700;background:#f1f5f9;color:#475569;border-radius:10px;padding:1px 8px;">' + esc(t.status) + '</span>' : '') +
                  (t.orders ? '<span style="font-size:.7rem;color:#64748b;">' + t.orders + ' order' + (t.orders === 1 ? '' : 's') + '</span>' : '') +
                '</div>').join('')
                : '<div style="padding:18px;text-align:center;color:#64748b;font-size:.8rem;">' + (trips.length ? 'No trip matches.' : 'No other trips are loaded — fetch trips on Trip Management, or type the trip ID.') + '</div>';
            select(chosen);
        }
        $('#mv-q').oninput = draw;
        $('#mv-id').oninput = function () { select(this.value.replace(/[^0-9A-Za-z_-]/g, '')); };
        $('#mv-list').onclick = e => { const el = e.target.closest('[data-trip]'); if (el) { $('#mv-id').value = ''; select(el.getAttribute('data-trip')); } };
        $('#mv-list').ondblclick = e => { const el = e.target.closest('[data-trip]'); if (el) { select(el.getAttribute('data-trip')); $('#mv-go').click(); } };
        draw();
        setTimeout(() => $('#mv-q').focus(), 30);

        $('#mv-go').onclick = function () {
            const to = chosen;
            if (!to || to === fromTrip) return;
            const go = $('#mv-go'), res = $('#mv-result');
            go.disabled = true; go.style.opacity = '.5'; $('#mv-cancel').disabled = true;
            res.innerHTML = '<span style="color:#0e7490;"><i class="fas fa-spinner fa-spin"></i> Removing from trip ' + esc(fromTrip || '…') + '…</span>';
            call('executeDelete', deleteUrl())
                .then(() => {
                    res.innerHTML = '<span style="color:#0e7490;"><i class="fas fa-spinner fa-spin"></i> Adding to trip ' + esc(to) + '…</span>';
                    return call('executePost', ADD_URL, payloadFor(to)).catch(addErr => {
                        // put it back where it was
                        if (!fromTrip) throw 'Adding to trip ' + to + ' failed: ' + errText(addErr) + '\nThe order is no longer on a trip — add it again from Add Orders.';
                        res.innerHTML = '<span style="color:#b45309;"><i class="fas fa-spinner fa-spin"></i> Adding failed — putting the order back on trip ' + esc(fromTrip) + '…</span>';
                        return call('executePost', ADD_URL, payloadFor(fromTrip))
                            .then(() => { throw 'Adding to trip ' + to + ' failed: ' + errText(addErr) + '\nThe order is back on trip ' + fromTrip + '.'; },
                                  backErr => { throw 'Adding to trip ' + to + ' failed: ' + errText(addErr) + '\nPutting it back on trip ' + fromTrip + ' also failed: ' + errText(backErr) + '\nThe order is not on any trip now — add it from Add Orders.'; });
                    });
                })
                .then(() => {
                    res.innerHTML = '<div style="color:#15803d;font-weight:700;"><i class="fas fa-check-circle"></i> Order ' + esc(orderNumber) + ' moved to trip ' + esc(to) + '.</div>';
                    try { if (opts.onMoved) opts.onMoved(to); } catch (e) { console.warn('[Move Order] onMoved', e); }
                    // the destination trip's tab, if open, shows the order straight away
                    try { if (document.getElementById('grid-trip-detail-' + to) && typeof window.refreshTripDetails === 'function') window.refreshTripDetails(to); } catch (e) { }
                    setTimeout(close, 1300);
                })
                .catch(e => {
                    $('#mv-api').style.display = 'block'; showApi();
                    res.innerHTML = '<div style="color:#b91c1c;font-weight:700;white-space:pre-wrap;">' + esc(errText(e)) + '</div>';
                    $('#mv-cancel').disabled = false; go.disabled = false; go.style.opacity = '1';
                    try { if (opts.onFailed) opts.onFailed(); } catch (er) { }
                });
        };
    };
})();
