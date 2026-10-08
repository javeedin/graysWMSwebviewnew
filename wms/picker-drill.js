/* Picker Monitor (wms/picker-view.html) — drill-down dialogs + the real pick status.
   Loaded after the page's own script; picker-view.html itself is not changed beyond the script tag.

   1. Pick status from the lines. The pickers-view API gives one summary row per order (total_lines / picked_lines /
      balance_lines). Lines that were CANCELLED can never be picked, so an order with 12 picked + 4 cancelled read
      "12 / 16 · Partial" for ever (Store to Van orders mostly). After every Fetch Data this script reads, for the date on
      screen, the order headers (WAREHOUSEMANAGEMENT/GETTRIPDETAILS/ALL — order type, order status, pick / ship confirm)
      and every trip's WMS order lines (TRIPMANAGEMENT/trip/orders/getsalesorderlinesbytrip/{trip}, 3 trips at a time —
      the same rows the cancellation autopilot reads) and corrects the counts in place: cancelled lines leave the total,
      lines that read Shipped / Closed / Awaiting Billing / interfaced count as picked, an order whose status is Closed /
      Shipped / interfaced is picked, an order whose lines are ALL cancelled shows Picked with "all n lines cancelled".
      So 12 picked + 4 cancelled = "12 / 12 · Picked · 4 cancelled". The summary strip, grid, cards and Excel follow,
      because the page's own buildOrderMap runs on the corrected rows.
   2. Drill-down. A click on an order card (or a grid row) opens a dialog chosen by the ORDER TYPE exactly like the WMS's
      editTripOrder: Store to Van / Van to Store → Store transactions (WAREHOUSEMANAGEMENT/trip/s2vdetails/{order} with the
      QOH of each item from trip/tripqoh — the Transaction Details columns in the WMS order, requested qty > QOH in red),
      every other type → Order details (TRIPMANAGEMENT/trip/orders/getsalesorderlines/{order}, Pick release details, Lots).
      Read-only: this page has no jQuery / DevExtreme / app.js, so the WMS dialogs themselves cannot run here; the
      actions (pick release, cancel lines, process transaction …) stay in Trip Management. */
(function () {
    'use strict';
    var PV = window.PickerDrill = { ctx: null, seq: 0, busy: false };
    var $ = function (id) { return document.getElementById(id); };
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var enc = encodeURIComponent;
    var up = function (v) { return String(v == null ? '' : v).trim().toUpperCase(); };

    // ── ORDS through the host (the page's own message listener routes restResponse / error to window.pendingRequests) ──
    function ordsRoot() {
        var b = typeof window.getApiBase === 'function' ? window.getApiBase() : 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT';
        return b.replace(/\/TRIPMANAGEMENT\/?$/i, '');
    }
    function rest(url, ms) {
        return new Promise(function (resolve, reject) {
            if (!(window.chrome && window.chrome.webview)) { reject(new Error('Open this page inside the Gray\'s WMS app.')); return; }
            var id = 'pvd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
            if (!window.pendingRequests) window.pendingRequests = {};
            var t = setTimeout(function () { delete window.pendingRequests[id]; reject(new Error('The app did not answer in time.')); }, ms || 60000);
            window.pendingRequests[id] = function (err, data) {
                clearTimeout(t);
                if (err) { reject(new Error(String(err))); return; }
                try { resolve(typeof data === 'string' ? (data.trim() ? JSON.parse(data) : {}) : data); } catch (e) { reject(e); }
            };
            window.chrome.webview.postMessage({ action: 'executeGet', requestId: id, fullUrl: url });
        });
    }
    function items(j) { return Array.isArray(j) ? j : (j && Array.isArray(j.items)) ? j.items : []; }
    function pick(r, names, re) {
        if (!r) return '';
        var ks = Object.keys(r);
        for (var i = 0; i < names.length; i++) { var k = ks.filter(function (x) { return x.toLowerCase() === names[i].toLowerCase(); })[0]; if (k && r[k] != null && r[k] !== '') return r[k]; }
        if (re) { var k2 = ks.filter(function (x) { return re.test(x); })[0]; if (k2 && r[k2] != null) return r[k2]; }
        return '';
    }
    /** The page's rows (picker-view.html declares `let allData`, a lexical global - not a window property). */
    function rowsNow() { try { return typeof allData !== 'undefined' && Array.isArray(allData) ? allData : []; } catch (e) { return []; } }   // eslint-disable-line no-undef
    function pool(list, n, fn) {
        var i = 0, out = [];
        function next() { if (i >= list.length) return Promise.resolve(); var x = list[i++]; return Promise.resolve().then(function () { return fn(x); }).then(function (r) { out.push(r); }, function () {}).then(next); }
        var w = []; for (var k = 0; k < Math.min(n, list.length); k++) w.push(next());
        return Promise.all(w).then(function () { return out; });
    }

    // ── the line vocabulary (same words as the Trip Details summary and the autopilot) ──
    var DONE = /shipped|closed|interfac|billing|billed|invoic/i, CANCEL = /^cancel/i;
    PV.lineStatus = function (l) { return String(pick(l, ['LINE_STATUS', 'STATUS'], null) || '').trim(); };
    /** Store to Van / Van to Store: the order type (also the short codes S2V / V2S) or, when the headers do not carry it,
        the WMS transaction number itself (S2V-SP4051851 / V2S-…). */
    PV.isStore = function (type, orderNum) { return /store\s*to\s*van|van\s*to\s*store|^\s*(s2v|v2s)\s*$/i.test(String(type || '')) || /^\s*(S2V|V2S)[-_]/i.test(String(orderNum || '')); };
    PV.trxStatus = function (l) { return String(pick(l, ['TRANSACTION_STATUS', 'TRX_STATUS', 'LINE_STATUS', 'STATUS'], null) || '').trim(); };
    var TRX_DONE = /complete|process|done|closed|confirm|shipped|interfac/i;
    PV.orderOf = function (r) { return String(pick(r, ['SOURCE_ORDER_NUMBER', 'ORDER_NUMBER', 'ORDERNUMBER'], /order.?(num|no)/i) || '').trim(); };

    // ── 1. read the order headers + lines of the date and correct the counts ──
    function pageCtx() {
        var pod = ($('fpInstance') || {}).value || 'PROD', iso = ($('fpDate') || {}).value || '';
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso), dmy = m ? m[3] + '-' + m[2] + '-' + m[1] : iso;
        return { pod: pod, iso: iso, dmy: dmy, heads: {}, lines: {}, trips: [], read: 0, failed: [] };
    }
    PV.enrich = function () {
        var rows = rowsNow();
        if (!rows.length) return Promise.resolve();
        var ctx = PV.ctx = pageCtx(), seq = ++PV.seq, root = ordsRoot();
        rows.forEach(function (r) { if (!r._pv) r._pv = { total: Number(r.total_lines) || 0, picked: Number(r.picked_lines) || 0, balance: Number(r.balance_lines) || 0 }; });
        var trips = {}; rows.forEach(function (r) { var t = r.trip_id || r.TRIP_ID; if (t != null && String(t).trim()) trips[String(t).trim()] = 1; });
        ctx.trips = Object.keys(trips);
        PV.note('<i class="fas fa-circle-notch fa-spin"></i> reading order lines of ' + ctx.trips.length + ' trip(s)…');
        var heads = rest(root + '/WAREHOUSEMANAGEMENT/GETTRIPDETAILS/ALL?P_FROM_DATE=' + enc(ctx.iso) + '&P_TO_DATE=' + enc(ctx.iso), 180000)
            .then(function (j) { var a = items(j); return a.length ? a : rest(root + '/WAREHOUSEMANAGEMENT/GETTRIPDETAILS/ALL?P_FROM_DATE=' + enc(ctx.dmy) + '&P_TO_DATE=' + enc(ctx.dmy), 180000).then(items); })
            .then(function (a) {
                a.forEach(function (r) {
                    var inst = up(pick(r, ['INSTANCE_NAME', 'INSTANCE'], null));
                    if (inst && inst !== up(ctx.pod)) return;
                    var o = PV.orderOf(r); if (!o) return;
                    var h = ctx.heads[o] || (ctx.heads[o] = { raw: r });
                    h.type = h.type || pick(r, ['ORDER_TYPE', 'ORDER_TYPE_CODE'], null) || '';
                    h.status = h.status || pick(r, ['LINE_STATUS', 'STATUS'], null) || '';
                    h.pick = h.pick || pick(r, ['PICK_CONFIRM_ST'], null) || ''; h.ship = h.ship || pick(r, ['SHIP_CONFIRM_ST'], null) || '';
                    h.account = h.account || pick(r, ['ACCOUNT_NUMBER'], null) || ''; h.trip = h.trip || pick(r, ['TRIP_ID'], /trip.?(id|num|no)/i) || '';
                    h.tripDate = h.tripDate || pick(r, ['TRIP_DATE'], null) || '';
                });
            }).catch(function (e) { ctx.failed.push('order headers: ' + (e && e.message || e)); });
        var lines = pool(ctx.trips, 3, function (trip) {
            return rest(root + '/TRIPMANAGEMENT/trip/orders/getsalesorderlinesbytrip/' + enc(trip) + '?P_INSTANCE_NAME=' + enc(ctx.pod), 120000).then(function (j) {
                items(j).forEach(function (l) {
                    var o = PV.orderOf(l); if (!o) return;
                    var L = ctx.lines[o] || (ctx.lines[o] = { total: 0, cancelled: 0, done: 0, rows: [] });
                    var st = PV.lineStatus(l); L.total++; if (CANCEL.test(st)) L.cancelled++; else if (DONE.test(st)) L.done++; L.rows.push(l);
                });
                ctx.read++;
            }).catch(function (e) { ctx.failed.push('trip ' + trip + ': ' + (e && e.message || e)); });
        });
        var stores = Promise.all([heads, lines]).then(function () {
            if (seq !== PV.seq) return;
            var todo = rows.map(PV.orderOf).filter(function (o, i, a) { return o && a.indexOf(o) === i && !ctx.lines[o] && PV.isStore((ctx.heads[o] || {}).type, o); });
            ctx.s2v = ctx.s2v || {};
            return pool(todo, 4, function (o) {
                return rest(root + '/WAREHOUSEMANAGEMENT/trip/s2vdetails/' + enc(o) + '?p_instance_name=' + enc(ctx.pod), 60000).then(function (j) {
                    var a = items(j); ctx.s2v[o] = a;
                    if (!a.length) return;
                    var L = ctx.lines[o] = { total: 0, cancelled: 0, done: 0, rows: a, store: true };
                    a.forEach(function (l) { var st = PV.trxStatus(l); L.total++; if (CANCEL.test(st) || /cancel/i.test(st)) L.cancelled++; else if (TRX_DONE.test(st)) L.done++; });
                }).catch(function (e) { ctx.failed.push('store ' + o + ': ' + (e && e.message || e)); });
            });
        });
        return stores.then(function () {
            if (seq !== PV.seq) return;                       // a newer Fetch Data took over
            PV.apply(ctx);
            if (typeof window.buildFilterDropdowns === 'function') window.buildFilterDropdowns();
            if (typeof window.applyFilters === 'function') window.applyFilters();
            var n = Object.keys(ctx.lines).length;
            PV.note((ctx.failed.length ? '<i class="fas fa-triangle-exclamation" style="color:#b45309"></i> ' : '<i class="fas fa-check" style="color:#059669"></i> ') +
                'line statuses of ' + n + ' order(s) from ' + ctx.read + ' of ' + ctx.trips.length + ' trip(s)' + (ctx.failed.length ? ' · ' + ctx.failed.length + ' failed' : ''), ctx.failed.join('\n'));
        });
    };
    /** Corrects total / picked / balance in the API rows from the lines (the page's buildOrderMap then reads them). */
    PV.apply = function (ctx) {
        rowsNow().forEach(function (r) {
            var o = PV.orderOf(r), base = r._pv, L = ctx.lines[o], H = ctx.heads[o] || {};
            if (!base) return;
            var total = base.total, picked = base.picked, cancelled = 0, done = 0, all = false;
            if (L) {
                // the API counts every line (total = the lines read) → cancelled ones leave; counted without them already → nothing to take out
                cancelled = L.total === total ? L.cancelled : (L.total - L.cancelled === total ? 0 : 0);
                done = L.done;
                all = L.total > 0 && L.cancelled === L.total;
            }
            if (!all && CANCEL.test(String(H.status || ''))) { all = true; cancelled = total; }
            var eff = Math.max(0, total - cancelled);
            var effPicked = Math.min(eff, Math.max(picked, Math.min(done, eff)));
            if (DONE.test(String(H.status || '')) || (eff > 0 && done >= eff)) effPicked = eff;
            if (all) { eff = 0; effPicked = 0; }
            r.total_lines = eff; r.picked_lines = effPicked; r.balance_lines = Math.max(0, eff - effPicked);
            base.cancelled = all ? (L ? L.total : total) : cancelled; base.done = done; base.all = all;
            base.type = H.type || base.type || (PV.isStore('', o) ? (/^\s*V2S/i.test(o) ? 'Van to Store' : 'Store to Van') : ''); base.status = H.status || ''; base.pick = H.pick || ''; base.ship = H.ship || ''; base.head = H.raw || null; base.account = H.account || '';
            base.lines = L ? L.rows : null;
        });
    };
    PV.info = function (orderNum) { var r = rowsNow().filter(function (x) { return PV.orderOf(x) === String(orderNum); })[0]; return { row: r || null, pv: r && r._pv || {} }; };
    PV.note = function (html, title) {
        var el = $('pvd-note');
        if (!el) { var u = $('lastUpdated'); if (!u) return; el = document.createElement('div'); el.id = 'pvd-note'; el.className = 'pvd-note'; u.parentNode.insertBefore(el, u.nextSibling); }
        el.innerHTML = html || ''; el.title = title || '';
    };

    // the page's hooks: after every Fetch Data read the lines; every order in the map carries its order type / cancelled count;
    // all-cancelled orders show Picked; the card says how many lines were cancelled
    var origHandle = window.handlePickersViewData;
    window.handlePickersViewData = function (data, error) {
        var wasTest = !!window._apiTestPending;
        var out = origHandle ? origHandle.apply(this, arguments) : undefined;
        if (!wasTest && !error && rowsNow().length) setTimeout(function () { PV.enrich(); }, 0);
        return out;
    };
    var origMap = window.buildOrderMap;
    window.buildOrderMap = function (rows) {
        var map = origMap.apply(this, arguments);
        (rows || []).forEach(function (r) {
            var o = map[PV.orderOf(r) || 'UNKNOWN'], p = r._pv; if (!o || !p) return;
            o.orderType = p.type || ''; o.cancelledLines = p.cancelled || 0; o.doneLines = p.done || 0; o.orderStatus = p.status || ''; o.allCancelled = !!p.all;
            if (p.all) { o.pickStatus = 'full'; o.pickPct = 100; o.isShipped = false; }
        });
        return map;
    };
    var origCard = window.buildOrderCard;
    if (typeof origCard === 'function') window.buildOrderCard = function (o) {
        var div = origCard.apply(this, arguments);
        try {
            var span = div.querySelector('.card-prog-nums span');
            if (span && o.allCancelled) span.innerHTML = '<span class="pvd-cancel">all ' + o.cancelledLines + ' line' + (o.cancelledLines === 1 ? '' : 's') + ' cancelled</span>';
            else if (span && o.cancelledLines) span.innerHTML = esc(span.textContent) + ' <span class="pvd-cancel">· ' + o.cancelledLines + ' cancelled</span>';
            if (o.orderType) { var top = div.querySelector('.card-account'); if (top) top.title = o.orderType; }
            div.title = 'Click for ' + (PV.isStore(o.orderType) ? 'the store transactions' : 'the order details');
        } catch (e) { /* card markup changed */ }
        return div;
    };

    // ── 2. the drill-down dialog ──
    document.addEventListener('click', function (e) {
        if (e.target.closest('a, button, input, select, .card-pdf-status, .grid-pdf-cell, th')) return;
        var card = e.target.closest('#cardsArea .order-card, #cardsArea tr[data-order-num]');
        if (!card) return;
        var num = card.dataset.orderNum; if (!num) return;
        e.preventDefault(); PV.open(num);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('pvd-overlay')) PV.close(); });

    PV.open = function (orderNum) {
        var I = PV.info(orderNum), r = I.row || {}, p = I.pv || {}, pod = ($('fpInstance') || {}).value || 'PROD';
        var store = PV.isStore(p.type, orderNum), root = ordsRoot();
        var lines = r._pv ? (Number(r.picked_lines) || 0) + ' / ' + (Number(r.total_lines) || 0) + ' lines picked' : '';
        var chips = [
            p.type ? chip(store ? 'fa-exchange-alt' : 'fa-file-invoice', esc(p.type), store ? '#c2410c' : '#4338ca', store ? '#ffedd5' : '#e0e7ff') : '',
            lines ? chip('fa-check-circle', esc(lines), '#047857', '#d1fae5') : '',
            p.cancelled ? chip('fa-ban', p.cancelled + ' cancelled', '#b91c1c', '#fee2e2') : '',
            p.status ? chip('fa-circle-info', esc(p.status), '#334155', '#f1f5f9') : '',
            yes(p.pick) ? chip('fa-hand-paper', 'Pick confirmed', '#1d4ed8', '#dbeafe') : '',
            yes(p.ship) ? chip('fa-shipping-fast', 'Ship confirmed', '#1d4ed8', '#dbeafe') : ''
        ].join('');
        var meta = [r.account_name, r.trip_id ? 'Trip #' + r.trip_id : '', r.picker_name, r.lorry_number, r.loading_bay ? 'Bay ' + r.loading_bay : '', r.order_priority ? 'P' + r.order_priority : '', pod].filter(Boolean).map(esc).join(' · ');
        var tabs = store
            ? [{ id: 'trx', label: 'Transaction details', icon: 'fa-list', url: root + '/WAREHOUSEMANAGEMENT/trip/s2vdetails/' + enc(orderNum) + '?p_instance_name=' + enc(pod), kind: 'trx' },
               { id: 'qoh', label: 'QOH details', icon: 'fa-boxes-stacked', url: root + '/WAREHOUSEMANAGEMENT/trip/tripqoh?v_trx_number=' + enc(orderNum) + '&p_instance_name=' + enc(pod), kind: 'qoh' }]
            : [{ id: 'lines', label: 'Order lines', icon: 'fa-list', url: root + '/TRIPMANAGEMENT/trip/orders/getsalesorderlines/' + enc(orderNum) + '?P_INSTANCE_NAME=' + enc(pod), kind: 'lines' },
               { id: 'pick', label: 'Pick release details', icon: 'fa-dolly', url: root + '/TRIPMANAGEMENT/trips/orders/getpickreleasedetails/' + enc(orderNum) + '?P_INSTANCE_NAME=' + enc(pod), kind: 'generic' },
               { id: 'lots', label: 'Lots', icon: 'fa-layer-group', url: root + '/TRIPMANAGEMENT/trips/orders/getlotdetails/' + enc(orderNum) + '?P_INSTANCE_NAME=' + enc(pod), kind: 'generic' }];
        PV.close();
        var ov = document.createElement('div'); ov.id = 'pvd-overlay'; ov.className = 'pvd-overlay';
        ov.innerHTML =
            '<div class="pvd-dlg" role="dialog" aria-modal="true">' +
            '<div class="pvd-head' + (store ? ' store' : '') + '"><div class="pvd-icon"><i class="fas ' + (store ? 'fa-exchange-alt' : 'fa-file-invoice') + '"></i></div>' +
            '<div class="pvd-titles"><div class="pvd-title">' + (store ? 'Store transactions' : 'Order details') + ' · #' + esc(orderNum) + '</div><div class="pvd-sub">' + meta + '</div></div>' +
            '<button class="pvd-close" title="Close (Esc)" onclick="PickerDrill.close()"><i class="fas fa-times"></i></button></div>' +
            '<div class="pvd-chips">' + chips + '<span class="pvd-grow"></span><span class="pvd-ro" title="This monitor shows the data; pick release, cancelling lines and processing transactions stay in Trip Management."><i class="fas fa-eye"></i> read-only</span></div>' +
            '<div class="pvd-tabs">' + tabs.map(function (t, i) { return '<button class="pvd-tab' + (i ? '' : ' on') + '" data-tab="' + t.id + '"><i class="fas ' + t.icon + '"></i> ' + t.label + ' <span class="pvd-n" id="pvd-n-' + t.id + '"></span></button>'; }).join('') + '</div>' +
            '<div class="pvd-body">' + tabs.map(function (t, i) { return '<div class="pvd-pane' + (i ? '' : ' on') + '" id="pvd-pane-' + t.id + '"><div class="pvd-loading"><i class="fas fa-circle-notch fa-spin"></i> Loading…</div></div>'; }).join('') + '</div>' +
            '</div>';
        ov.addEventListener('click', function (ev) { if (ev.target === ov) PV.close(); });
        document.body.appendChild(ov);
        ov.querySelectorAll('.pvd-tab').forEach(function (b) { b.onclick = function () { ov.querySelectorAll('.pvd-tab').forEach(function (x) { x.classList.toggle('on', x === b); }); ov.querySelectorAll('.pvd-pane').forEach(function (x) { x.classList.toggle('on', x.id === 'pvd-pane-' + b.dataset.tab); }); }; });
        var qohRows = null, trxRows = null;
        tabs.forEach(function (t) {
            rest(t.url, 90000).then(function (j) {
                var rows = items(j);
                if (t.kind === 'qoh') { qohRows = rows; if (trxRows) PV.applyQoh(trxRows, qohRows, $('pvd-pane-trx')); }
                if (t.kind === 'trx') { trxRows = rows; }
                PV.table($('pvd-pane-' + t.id), rows, t.kind, orderNum);
                var n = $('pvd-n-' + t.id); if (n) n.textContent = rows.length;
                if (t.kind === 'trx' && qohRows) PV.applyQoh(trxRows, qohRows, $('pvd-pane-trx'));
            }).catch(function (e) { var pane = $('pvd-pane-' + t.id); if (pane) pane.innerHTML = '<div class="pvd-err"><i class="fas fa-triangle-exclamation"></i> ' + esc(e && e.message || e) + '</div>'; });
        });
    };
    PV.close = function () { var o = $('pvd-overlay'); if (o) o.remove(); };
    function chip(icon, html, color, bg) { return '<span class="pvd-chip" style="color:' + color + ';background:' + bg + '"><i class="fas ' + icon + '"></i> ' + html + '</span>'; }
    function yes(v) { return /^(y|yes|true|1|done|complete)/i.test(String(v == null ? '' : v).trim()); }

    // column order like the WMS dialogs: Transaction Details = … TRX NUMBER · item · description · requested qty · QOH · the rest;
    // Order lines = line number · item · description · quantity · status · the rest
    PV.trxKeys = function (keys) {
        var first = function (res) { for (var i = 0; i < res.length; i++) { var k = keys.filter(function (x) { return res[i].test(x); })[0]; if (k) return k; } return null; };
        return {
            trx: first([/^trx_?number$/i]),
            item: first([/^item_?code$/i, /^item_?(number|no|num)$/i, /^item$/i, /^inventory_?item$/i, /^product_?(number|code)$/i]),
            desc: first([/^item_?desc(ription)?$/i, /^description$/i, /^item_?name$/i, /^product_?desc(ription)?$/i]),
            qty: first([/^req(uested)?_?(qty|quantity)$/i, /^(trx|transaction|ordered|order)_?(qty|quantity)$/i, /^(quantity|qty)$/i]),
            qoh: first([/^qoh$/i, /^qoh_?(qty|quantity)$/i, /^(on_?hand|onhand)(_?(qty|quantity))?$/i, /^quantity_?on_?hand$/i, /^available_?(qty|quantity)$/i]),
            org: first([/^(source_?|src_?|from_?)?org(anization)?(_?code)?$/i]),
            sub: first([/^(source_?|src_?|from_?)?sub_?inv(entory)?(_?code)?$/i]),
            line: first([/^line_?(number|num|no)$/i]),
            status: first([/^line_?status$/i, /^(transaction|trx)_?status$/i, /^status$/i]),
            fid: first([/fulfill/i])
        };
    };
    PV.columns = function (rows, kind) {
        var keys = Object.keys(rows[0] || {}).filter(function (k) { return k.indexOf('__') !== 0; });
        var K = PV.trxKeys(keys), lead = [];
        if (kind === 'trx') { if (K.trx) lead = keys.slice(0, keys.indexOf(K.trx)).concat([K.trx]); lead = lead.concat([K.item, K.desc, K.qty, K.qoh || '__qoh']); }
        else if (kind === 'lines') lead = [K.line, K.item, K.desc, K.qty, K.status];
        else if (kind === 'qoh') lead = [K.item, K.org, K.sub];
        var seen = {}, out = [];
        lead.concat(keys).forEach(function (k) { if (k && !seen[k]) { seen[k] = 1; out.push(k); } });
        if (kind === 'trx' && !K.qoh && out.indexOf('__qoh') < 0) out.splice(Math.min(out.length, lead.filter(Boolean).length), 0, '__qoh');
        return { keys: out, K: K };
    };
    PV.table = function (pane, rows, kind, orderNum) {
        if (!pane) return;
        if (!rows.length) { pane.innerHTML = '<div class="pvd-empty"><i class="fas fa-inbox"></i> Nothing to show for this order.</div>'; return; }
        var C = PV.columns(rows, kind), keys = C.keys, K = C.K;
        var label = function (k) { return k === '__qoh' ? 'QOH' : k.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); };
        var cell = function (r, k) {
            var v = k === '__qoh' ? '' : r[k];
            if (k === (K.qoh || '__qoh') && kind === 'trx') return PV.qohCell(r, v);
            if (k === K.status && v) return '<span class="pvd-st ' + (CANCEL.test(String(v)) ? 'cancel' : DONE.test(String(v)) ? 'done' : /await|released|picked|staged/i.test(String(v)) ? 'live' : '') + '">' + esc(v) + '</span>';
            if (typeof v === 'number') return '<span class="num">' + esc(v) + '</span>';
            return esc(v == null ? '' : v);
        };
        pane.innerHTML =
            '<div class="pvd-bar"><input type="search" class="pvd-filter" placeholder="Filter rows…"><span class="pvd-count">' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + '</span><span class="pvd-grow"></span>' +
            '<button class="pvd-btn pvd-csv"><i class="fas fa-file-csv"></i> CSV</button></div>' +
            '<div class="pvd-scroll"><table class="pvd-grid"><thead><tr>' + keys.map(function (k) { return '<th>' + esc(label(k)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
            rows.map(function (r) {
                var st = kind === 'trx' ? PV.trxStatus(r) : (K.status && r[K.status]);
                var cls = [st && (kind === 'lines' ? CANCEL.test(String(st)) : /cancel/i.test(String(st))) ? 'cancelled' : '', r.__qohShort ? 'short' : ''].filter(Boolean).join(' ');
                return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' + keys.map(function (k) { return '<td>' + cell(r, k) + '</td>'; }).join('') + '</tr>';
            }).join('') + '</tbody></table></div>';
        var inp = pane.querySelector('.pvd-filter'), trs = Array.prototype.slice.call(pane.querySelectorAll('tbody tr')), cnt = pane.querySelector('.pvd-count');
        inp.oninput = function () {
            var words = inp.value.toLowerCase().split(/\s+/).filter(Boolean), n = 0;
            trs.forEach(function (tr) { var t = tr.textContent.toLowerCase(), ok = words.every(function (w) { return t.indexOf(w) >= 0; }); tr.style.display = ok ? '' : 'none'; if (ok) n++; });
            cnt.textContent = n + ' of ' + rows.length + ' rows';
        };
        pane.querySelector('.pvd-csv').onclick = function () {
            var q = function (v) { v = String(v == null ? '' : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
            var csv = keys.map(label).map(q).join(',') + '\n' + rows.map(function (r) { return keys.map(function (k) { return q(k === '__qoh' ? (r.__qohInfo && r.__qohInfo.qoh != null ? r.__qohInfo.qoh : '') : r[k]); }).join(','); }).join('\n');
            var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })); a.download = 'order-' + orderNum + '-' + kind + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        };
    };
    /** Transaction Details › QOH = the QOH Details rows summed per item × organisation × subinventory of the transaction's
        source (per item alone when no row has that source) — the same rule as the WMS dialog (wmsApplyQohToTrx). */
    PV.applyQoh = function (trx, qoh, pane) {
        if (!Array.isArray(trx) || !trx.length || !Array.isArray(qoh)) return;
        var byKey = {}, byItem = {}, cnt = {};
        qoh.forEach(function (r) {
            var item = up(pick(r, ['itemnumber', 'item_number', 'item', 'item_code', 'itemcode'], null)); if (!item) return;
            var qty = parseFloat(pick(r, ['primaryquantity', 'primary_quantity', 'quantity', 'qoh', 'onhand', 'on_hand_qty'], null)) || 0;
            var k = item + '|' + up(pick(r, ['organizationcode', 'organization_code', 'org_code'], null)) + '|' + up(pick(r, ['subinventorycode', 'subinventory_code', 'subinventory', 'sub_inv'], null));
            byKey[k] = (byKey[k] || 0) + qty; byItem[item] = (byItem[item] || 0) + qty; cnt[k] = (cnt[k] || 0) + 1; cnt[item] = (cnt[item] || 0) + 1;
        });
        var K = PV.trxKeys(Object.keys(trx[0]));
        trx.forEach(function (r) {
            var item = up(K.item && r[K.item]); if (!item) { r.__qohInfo = { none: true }; return; }
            var k = item + '|' + up(K.org && r[K.org]) + '|' + up(K.sub && r[K.sub]);
            var has = Object.prototype.hasOwnProperty.call(byKey, k);
            var v = has ? byKey[k] : (Object.prototype.hasOwnProperty.call(byItem, item) ? byItem[item] : null);
            var req = parseFloat(K.qty && r[K.qty]);
            r.__qohInfo = v == null ? { none: true } : { qoh: Math.round(v * 100) / 100, rows: cnt[has ? k : item] || 0, req: isFinite(req) ? req : null, scope: has ? 'this item in the source organisation / subinventory' : 'this item in every subinventory (no QOH row for the source subinventory)' };
            r.__qohShort = v != null && isFinite(req) && req > v + 1e-9;
        });
        if (pane && pane.querySelector('.pvd-grid')) PV.table(pane, trx, 'trx', '');
    };
    PV.qohCell = function (r, v) {
        var i = r.__qohInfo;
        if (!i) return '<span class="num" title="From the API — the QOH Details rows are still loading">' + esc(v == null ? '' : v) + '</span>';
        if (i.none) return '<span class="num" style="color:#94a3b8" title="No QOH Details row for this item">' + esc(v == null || v === '' ? '—' : v) + '</span>';
        return '<span class="num" style="font-weight:700;color:' + (r.__qohShort ? '#b91c1c' : '#15803d') + '" title="' + esc('QOH = the sum of ' + i.rows + ' QOH Details row(s) for ' + i.scope + (r.__qohShort ? '\nRequested ' + i.req + ' is MORE than the QOH' : '')) + '">' +
            esc(Number(i.qoh).toLocaleString(undefined, { maximumFractionDigits: 2 })) + (r.__qohShort ? ' <i class="fas fa-triangle-exclamation"></i>' : '') + '</span>';
    };

    // ── styles ──
    var css = document.createElement('style');
    css.textContent =
        '#cardsArea .order-card, #cardsArea tr[data-order-num] { cursor: pointer; }' +
        '.pvd-cancel { color: #b91c1c; font-weight: 700; }' +
        '.pvd-note { font-size: .68rem; color: #64748b; margin-top: 2px; display: flex; gap: 5px; align-items: center; }' +
        '.pvd-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.6); backdrop-filter: blur(3px); z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 18px; }' +
        '.pvd-dlg { background: #fff; border-radius: 14px; box-shadow: 0 24px 60px rgba(0,0,0,.3); width: min(1300px, 97vw); height: min(88vh, 900px); display: flex; flex-direction: column; overflow: hidden; animation: pvdIn .2s ease; font-size: .8rem; color: #1e293b; }' +
        '@keyframes pvdIn { from { opacity: 0; transform: translateY(-14px) scale(.98); } to { opacity: 1; transform: none; } }' +
        '.pvd-head { background: linear-gradient(135deg,#4f46e5,#7c3aed); color: #fff; padding: .8rem 1.2rem; display: flex; align-items: center; gap: .7rem; flex-shrink: 0; }' +
        '.pvd-head.store { background: linear-gradient(135deg,#ea580c,#c2410c); }' +
        '.pvd-icon { width: 36px; height: 36px; border-radius: 10px; background: rgba(255,255,255,.18); display: flex; align-items: center; justify-content: center; font-size: 1.05rem; flex-shrink: 0; }' +
        '.pvd-title { font-size: 1rem; font-weight: 800; } .pvd-sub { font-size: .72rem; opacity: .85; margin-top: 1px; }' +
        '.pvd-close { margin-left: auto; background: rgba(255,255,255,.18); border: 0; border-radius: 8px; color: #fff; cursor: pointer; width: 30px; height: 30px; font-size: 1rem; }' +
        '.pvd-close:hover { background: rgba(255,255,255,.35); }' +
        '.pvd-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: .55rem 1.2rem; background: #f8fafc; border-bottom: 1px solid #e5e7eb; }' +
        '.pvd-chip { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; padding: 2px 9px; font-size: .7rem; font-weight: 700; }' +
        '.pvd-ro { font-size: .68rem; color: #64748b; } .pvd-grow { flex: 1; }' +
        '.pvd-tabs { display: flex; gap: 4px; padding: .45rem 1.2rem 0; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; }' +
        '.pvd-tab { border: 0; background: transparent; padding: .45rem .8rem; font: inherit; font-size: .76rem; font-weight: 700; color: #64748b; cursor: pointer; border-bottom: 2px solid transparent; display: inline-flex; gap: 6px; align-items: center; }' +
        '.pvd-tab.on { color: #4338ca; border-bottom-color: #4f46e5; } .pvd-head.store ~ .pvd-tabs .pvd-tab.on { color: #c2410c; border-bottom-color: #ea580c; }' +
        '.pvd-n { background: #e2e8f0; color: #334155; border-radius: 999px; padding: 0 6px; font-size: .64rem; min-width: 14px; text-align: center; } .pvd-n:empty { display: none; }' +
        '.pvd-body { flex: 1; min-height: 0; display: flex; } .pvd-pane { display: none; flex: 1; min-height: 0; flex-direction: column; } .pvd-pane.on { display: flex; }' +
        '.pvd-loading, .pvd-empty, .pvd-err { padding: 2rem; text-align: center; color: #64748b; } .pvd-err { color: #b91c1c; }' +
        '.pvd-bar { display: flex; align-items: center; gap: 8px; padding: .55rem 1.2rem; }' +
        '.pvd-filter { border: 1px solid #cbd5e1; border-radius: 8px; padding: 5px 9px; font: inherit; font-size: .76rem; width: 240px; } .pvd-filter:focus { outline: none; border-color: #6366f1; }' +
        '.pvd-count { font-size: .7rem; color: #64748b; }' +
        '.pvd-btn { border: 1px solid #cbd5e1; background: #fff; border-radius: 8px; padding: 4px 10px; font: inherit; font-size: .72rem; font-weight: 700; color: #334155; cursor: pointer; display: inline-flex; gap: 5px; align-items: center; } .pvd-btn:hover { background: #f1f5f9; }' +
        '.pvd-scroll { flex: 1; min-height: 0; overflow: auto; margin: 0 1.2rem 1rem; border: 1px solid #e5e7eb; border-radius: 8px; }' +
        '.pvd-grid { border-collapse: collapse; width: 100%; font-size: .74rem; white-space: nowrap; }' +
        '.pvd-grid th { position: sticky; top: 0; background: #f8fafc; color: #64748b; text-align: left; font-size: .64rem; text-transform: uppercase; letter-spacing: .04em; padding: 7px 9px; border-bottom: 1px solid #e5e7eb; z-index: 1; }' +
        '.pvd-grid td { padding: 5px 9px; border-bottom: 1px solid #f1f5f9; } .pvd-grid tr:hover td { background: #f8fafc; } .pvd-grid .num { text-align: right; display: block; font-variant-numeric: tabular-nums; }' +
        '.pvd-grid tr.cancelled td { color: #94a3b8; text-decoration: line-through; } .pvd-grid tr.cancelled td .pvd-st { text-decoration: none; } .pvd-grid tr.short td { background: #fef2f2; }' +
        '.pvd-st { border-radius: 999px; padding: 1px 7px; font-size: .66rem; font-weight: 700; background: #f1f5f9; color: #334155; } .pvd-st.cancel { background: #fee2e2; color: #b91c1c; } .pvd-st.done { background: #d1fae5; color: #047857; } .pvd-st.live { background: #fef3c7; color: #92400e; }';
    document.head.appendChild(css);
})();
