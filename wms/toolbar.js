// ============================================================================
// WMS TOOLBAR CONTEXT — three things on the main toolbar, left of the icons:
//   • the TRIP DATE (default tomorrow; ◀ ▶ / date picker; kept per session) — window.wmsTripDate.get() / set() / on(fn);
//     a change also sets Trip Management's From / To inputs (no fetch)
//   • a SEARCH box: trip, order, customer, picker, lorry … of that date — the suggestions come straight from this PC's DuckDB
//     copy (w2_mri_orders / w2_mri_trips / w2_mri_mra, the tables the MRA Interface and the alerts keep); grouped Trips /
//     Orders / Pickers / Customers, a picker or customer opens into its orders, Enter / click opens the trip (openTripDetails)
//     or the order dialog (editTripOrder on the kept API row); a date not on this PC yet offers "Read it now" (MraInterface.sync)
//   • the PENDING CANCELLATIONS icon: the lines the cancellation rule would cancel for that date (the WMS alerts' count,
//     WmsAlerts.counts), flashing with the number until every line is cancelled; a click opens the alerts on that tab, where
//     "Cancel these lines now" runs the autopilot for the date.
// ============================================================================
(function () {
    'use strict';
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var lit = function (s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; };
    var pad2 = function (n) { return ('0' + n).slice(-2); };
    var iso = function (d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
    var today = function () { return iso(new Date()); };
    var addDays = function (s, n) { var d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
    function dayWord(s) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); if (!m) return '';
        var d = new Date(+m[1], +m[2] - 1, +m[3]), t = new Date(); t.setHours(0, 0, 0, 0);
        var diff = Math.round((d - t) / 86400000);
        return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    }
    function user() { try { return localStorage.getItem('wms_user') || sessionStorage.getItem('loggedInUser') || 'WMS'; } catch (e) { return 'WMS'; } }
    function hosted() { return !!(window.chrome && window.chrome.webview && typeof sendMessageToCSharp === 'function'); }
    function host(msg, ms) {
        return new Promise(function (resolve, reject) {
            if (!hosted()) { reject(new Error('Open this inside the Gray\'s WMS app.')); return; }
            sendMessageToCSharp(msg, function (err, data) { if (err) { reject(new Error(typeof err === 'string' ? err : (err.message || JSON.stringify(err)))); return; } var r = data; if (typeof data === 'string') { try { r = JSON.parse(data); } catch (e) { r = data; } } resolve(r); }, ms || 60000, false);
        });
    }
    function curInstance() {
        var el = document.getElementById('current-instance-display'), v = el ? String(el.textContent || '').trim().toUpperCase() : '';
        if (!v) { try { v = String(sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || '').toUpperCase(); } catch (e) { v = ''; } }
        return v || 'PROD';
    }
    function note(m, t) { if (typeof showNotification === 'function') showNotification(m, t || 'info'); else console.log('[Toolbar]', m); }

    // ─── trip date ─────────────────────────────────────────────────────────────
    var TD = { listeners: [] };
    function tdGet() { try { var v = sessionStorage.getItem('wms.tripDate'); if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v; } catch (e) {} return addDays(today(), 1); }
    function tdSet(d, quiet) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) return;
        try { sessionStorage.setItem('wms.tripDate', d); } catch (e) {}
        var inp = document.getElementById('wtb-date'); if (inp && inp.value !== d) inp.value = d;
        var w = document.getElementById('wtb-day'); if (w) w.textContent = dayWord(d);
        ['trip-date-from', 'trip-date-to'].forEach(function (id) { var el = document.getElementById(id); if (el && el.type === 'date') el.value = d; });
        if (!quiet) TD.listeners.forEach(function (fn) { try { fn(d); } catch (e) { console.warn('[Toolbar] date listener:', e); } });
        cancelCount();
    }
    window.wmsTripDate = { get: tdGet, set: function (d) { tdSet(d); }, on: function (fn) { TD.listeners.push(fn); }, tomorrow: function () { return addDays(today(), 1); } };

    // ─── search over the DuckDB copy ──────────────────────────────────────────
    var SR = { q: '', items: [], hl: -1, timer: null, seq: 0, open: false, reading: false };
    function dbq(list) {
        return host({ action: 'w2Queries', appUser: user(), queries: list }, 60000).then(function (d) {
            if (!d || d.ok === false) throw new Error((d && d.error) || 'DuckDB did not answer');
            return (d.results || []).map(function (r) { if (!r || r.error) return []; var cols = (r.columns || []).map(function (c) { return String(c).toLowerCase(); }); return (r.rows || []).map(function (row) { var o = {}; cols.forEach(function (c, i) { o[c] = row[i]; }); return o; }); });
        });
    }
    function pick(row, names) { if (!row) return ''; var keys = Object.keys(row); for (var i = 0; i < names.length; i++) { var k = keys.find(function (x) { return x.toLowerCase() === names[i].toLowerCase(); }); if (k && row[k] != null && row[k] !== '') return String(row[k]); } return ''; }
    function like(q) { return lit('%' + String(q).toUpperCase().replace(/[%_]/g, function (c) { return '\\' + c; }) + '%'); }
    /** Everything of the date that mentions the words → grouped suggestions. */
    function search(q) {
        var pod = curInstance(), date = tdGet(), words = q.trim().toUpperCase().split(/\s+/).filter(Boolean), seq = ++SR.seq;
        if (!words.length) { SR.items = []; paintDd(); return; }
        var cond = function (col) { return words.map(function (w) { return 'UPPER(' + col + ') LIKE ' + like(w) + " ESCAPE '\\'"; }).join(' AND '); };
        var qs = ['SELECT trip_id, order_number, raw_json FROM w2_mri_orders WHERE pod = ' + lit(pod) + ' AND trip_date IN (' + lit(date) + ') AND (' + cond('order_number') + ' OR ' + cond('raw_json') + ') LIMIT 60',
            'SELECT trip_id, lorry, bay, priority FROM w2_mri_trips WHERE pod = ' + lit(pod) + ' AND trip_date IN (' + lit(date) + ') AND (' + cond("trip_id || ' ' || lorry || ' ' || bay") + ') LIMIT 10',
            'SELECT COUNT(*) AS n FROM w2_mri_days WHERE pod = ' + lit(pod) + ' AND trip_date IN (' + lit(date) + ')'];
        dbq(qs).then(function (r) {
            if (seq !== SR.seq) return;
            var orders = r[0].map(function (x) { var raw = {}; try { raw = JSON.parse(x.raw_json || '{}'); } catch (e) {} return { trip: String(x.trip_id), order: String(x.order_number), raw: raw, customer: pick(raw, ['ACCOUNT_NAME', 'CUSTOMER_NAME']), picker: pick(raw, ['picker', 'PICKER', 'PICKER_NAME']), type: pick(raw, ['ORDER_TYPE']), status: pick(raw, ['LINE_STATUS', 'STATUS']), lorry: pick(raw, ['TRIP_LORRY', 'LORRY_NUMBER']) }; });
            var trips = r[1].map(function (t) { return { trip: String(t.trip_id), lorry: t.lorry || '', bay: t.bay || '', priority: t.priority || '' }; });
            var known = r[2].length ? Number(r[2][0].n) > 0 : false;
            var mraQ = orders.length ? dbq(['SELECT order_number, s FROM w2_mri_mra WHERE pod = ' + lit(pod) + ' AND order_number IN (' + orders.map(function (o) { return lit(o.order); }).join(', ') + ')']) : Promise.resolve([[]]);
            return mraQ.then(function (m) {
                if (seq !== SR.seq) return;
                var mra = {}; (m[0] || []).forEach(function (x) { mra[String(x.order_number)] = String(x.s || '').toUpperCase(); });
                orders.forEach(function (o) { o.mra = mra[o.order] || ''; });
                SR.items = group(words, orders, trips, known, date); SR.hl = -1; paintDd();
            });
        }).catch(function (e) { if (seq !== SR.seq) return; SR.items = [{ kind: 'note', html: 'Search needs the DuckDB copy: ' + esc(e.message) }]; paintDd(); });
    }
    function hit(text, words) { return words.some(function (w) { return String(text || '').toUpperCase().indexOf(w) >= 0; }); }
    function mark(text, words) { var s = esc(text); words.forEach(function (w) { var re = new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'); s = s.replace(re, '<mark>$1</mark>'); }); return s; }
    function mraPill(s) { return s === 'SUCCESS' || s === 'ALREADY_DONE' ? '<span class="wtb-pill green">MRA ✓</span>' : s === 'FAILED' ? '<span class="wtb-pill red">MRA failed</span>' : s === 'SKIPPED' ? '<span class="wtb-pill amber">MRA skipped</span>' : ''; }
    function group(words, orders, trips, known, date) {
        var out = [], byPicker = {}, byCust = {}, byTrip = {};
        orders.forEach(function (o) { if (o.picker && hit(o.picker, words)) (byPicker[o.picker] = byPicker[o.picker] || []).push(o); if (o.customer && hit(o.customer, words)) (byCust[o.customer] = byCust[o.customer] || []).push(o); byTrip[o.trip] = (byTrip[o.trip] || 0) + 1; });
        trips.forEach(function (t) { if (!byTrip[t.trip]) byTrip[t.trip] = 0; });
        var tripHits = Object.keys(byTrip).filter(function (id) { var t = trips.filter(function (x) { return x.trip === id; })[0]; return hit(id, words) || (t && hit(t.lorry + ' ' + t.bay, words)); });
        if (tripHits.length) { out.push({ kind: 'g', label: 'Trips', n: tripHits.length }); tripHits.slice(0, 6).forEach(function (id) { var t = trips.filter(function (x) { return x.trip === id; })[0] || {}; out.push({ kind: 'trip', trip: id, lorry: t.lorry || '', bay: t.bay || '', priority: t.priority || '', html: '<i class="fas fa-truck"></i><b>Trip ' + mark(id, words) + '</b> ' + mark(t.lorry || '', words) + (t.bay ? ' · bay ' + esc(t.bay) : '') + '<span class="sub">' + (byTrip[id] || 0) + ' orders · open the trip</span>' }); }); }
        var pk = Object.keys(byPicker).sort();
        if (pk.length) { out.push({ kind: 'g', label: 'Pickers', n: pk.length }); pk.slice(0, 5).forEach(function (p) { var list = byPicker[p]; out.push({ kind: 'picker', name: p, orders: list, html: '<i class="fas fa-user"></i><b>' + mark(p, words) + '</b><span class="sub">' + list.length + ' order' + (list.length === 1 ? '' : 's') + ' on trip' + (uniq(list.map(function (o) { return o.trip; })).length === 1 ? ' ' : 's ') + uniq(list.map(function (o) { return o.trip; })).join(', ') + '</span>' }); }); }
        var ck = Object.keys(byCust).sort();
        if (ck.length) { out.push({ kind: 'g', label: 'Customers', n: ck.length }); ck.slice(0, 5).forEach(function (c) { var list = byCust[c]; out.push({ kind: 'customer', name: c, orders: list, html: '<i class="fas fa-store"></i><b>' + mark(c, words) + '</b><span class="sub">' + list.length + ' order' + (list.length === 1 ? '' : 's') + '</span>' }); }); }
        var ord = orders.filter(function (o) { return hit(o.order, words) || hit(o.type, words) || hit(o.status, words) || (!byPicker[o.picker] && !byCust[o.customer] && !hit(o.trip, words)); });
        if (ord.length) { out.push({ kind: 'g', label: 'Orders', n: ord.length }); ord.slice(0, 8).forEach(function (o) { out.push(orderItem(o, words)); }); }
        if (!out.length) out.push({ kind: 'note', html: known ? 'Nothing on ' + esc(dayWord(date) ? dayWord(date) + ' ' : '') + esc(date) + ' matches <b>' + esc(words.join(' ')) + '</b>.' : esc(date) + ' is not on this PC yet — <a onclick="WmsToolbar.read()">read it now</a> and search again.' });
        return out;
    }
    function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
    function orderItem(o, words, sub) { return { kind: 'order', order: o.order, trip: o.trip, raw: o.raw, html: '<i class="fas fa-box"></i><b>' + mark(o.order, words) + '</b> ' + mark(o.customer, words) + (o.picker ? ' <span class="wtb-pill">' + mark(o.picker, words) + '</span>' : '') + ' ' + mraPill(o.mra) + '<span class="sub">trip ' + esc(o.trip) + (o.type ? ' · ' + esc(o.type) : '') + (o.status ? ' · ' + esc(o.status) : '') + '</span>', sub: !!sub }; }
    function paintDd() {
        var box = document.getElementById('wtb-search'), dd = document.getElementById('wtb-dd'); if (!box || !dd) return;
        box.classList.toggle('has', !!SR.q);
        if (!SR.q) { box.classList.remove('open'); SR.open = false; dd.innerHTML = ''; return; }
        dd.innerHTML = SR.items.map(function (it, i) {
            if (it.kind === 'g') return '<div class="g"><span>' + esc(it.label) + '</span><span>' + it.n + '</span></div>';
            if (it.kind === 'note') return '<div class="note">' + it.html + '</div>';
            return '<div class="it' + (it.sub ? ' sub-it' : '') + (i === SR.hl ? ' hl' : '') + '" data-i="' + i + '">' + it.html + '</div>';
        }).join('') || '<div class="note"><i class="fas fa-spinner fa-spin"></i> searching…</div>';
        box.classList.add('open'); SR.open = true;
        dd.querySelectorAll('.it').forEach(function (el) { el.onmousedown = function (e) { e.preventDefault(); choose(+el.getAttribute('data-i')); }; });
    }
    function choose(i) {
        var it = SR.items[i]; if (!it) return;
        if (it.kind === 'trip') { closeDd(); openTrip(it.trip, it.lorry, it.bay, it.priority); return; }
        if (it.kind === 'order') { closeDd(); openOrder(it); return; }
        if (it.kind === 'picker' || it.kind === 'customer') {       // open the group into its orders
            var words = SR.q.trim().toUpperCase().split(/\s+/).filter(Boolean), rows = it.orders.slice(0, 12).map(function (o) { return orderItem(o, words, true); });
            if (SR.items[i + 1] && SR.items[i + 1].sub) { var j = i + 1; while (SR.items[j] && SR.items[j].sub) j++; SR.items.splice(i + 1, j - i - 1); } else SR.items.splice.apply(SR.items, [i + 1, 0].concat(rows));
            paintDd(); return;
        }
    }
    function closeDd() { var box = document.getElementById('wtb-search'); if (box) box.classList.remove('open'); SR.open = false; SR.hl = -1; }
    function openTrip(trip, lorry, bay, priority) {
        if (typeof window.openTripDetails !== 'function') { note('Trip Management is not loaded.', 'warning'); return; }
        if (typeof window.navigateToPage === 'function') window.navigateToPage('trip-management');
        try { window.openTripDetails(String(trip), tdGet(), lorry || '', curInstance(), bay || '', priority || ''); } catch (e) { note('Could not open trip ' + trip + ': ' + (e && e.message || e), 'error'); }
    }
    function openOrder(it) {
        if (typeof window.editTripOrder !== 'function' || !it.raw) { openTrip(it.trip); return; }
        try { window.currentTripInstance = curInstance(); } catch (e) {}
        try { window.editTripOrder(it.raw); } catch (e) { note('Could not open order ' + it.order + ': ' + (e && e.message || e), 'error'); }
    }
    function readDate() {
        if (SR.reading) return; var pod = curInstance(), date = tdGet();
        if (!window.MraInterface || typeof window.MraInterface.sync !== 'function') { note('mra-interface.js is not loaded.', 'warning'); return; }
        SR.reading = true; SR.items = [{ kind: 'note', html: '<i class="fas fa-spinner fa-spin"></i> reading ' + esc(date) + ' on ' + esc(pod) + ' from APEX…' }]; paintDd();
        window.MraInterface.sync(pod, date, date).then(function () { note(date + ' read and kept on this PC.', 'success'); search(SR.q); }, function (e) { note('Could not read ' + date + ': ' + (e && e.message || e), 'error'); }).then(function () { SR.reading = false; });
    }
    function onKey(e) {
        var its = SR.items.map(function (it, i) { return it.kind === 'g' || it.kind === 'note' ? -1 : i; }).filter(function (i) { return i >= 0; });
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!its.length) return; e.preventDefault(); var pos = its.indexOf(SR.hl); pos = e.key === 'ArrowDown' ? (pos + 1) % its.length : (pos - 1 + its.length) % its.length; SR.hl = its[pos]; paintDd(); var el = document.querySelector('#wtb-dd .it.hl'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'Enter') { e.preventDefault(); if (SR.hl >= 0) choose(SR.hl); else if (its.length) choose(its[0]); }
        else if (e.key === 'Escape') { closeDd(); e.target.blur(); }
    }

    // ─── the pending-cancellations icon ───────────────────────────────────────
    var CC = { n: null, timer: null };
    function cancelCount() {
        var b = document.getElementById('wms-cancel-btn'), badge = document.getElementById('wms-cancel-badge'); if (!b) return;
        if (!window.WmsAlerts || typeof window.WmsAlerts.counts !== 'function') return;
        var date = tdGet();
        window.WmsAlerts.counts(date).then(function (r) {
            if (tdGet() !== date) return;
            var n = r && r.summary ? r.summary.CANCEL.n : null; CC.n = n;
            b.classList.toggle('has', !!n); b.classList.remove('busy');
            if (badge) { badge.textContent = n > 99 ? '99+' : (n == null ? '?' : n); badge.style.display = n ? 'block' : 'none'; }
            b.title = n ? n + ' line' + (n === 1 ? '' : 's') + ' still pending for cancellation on ' + date + (r.at ? ' (checked ' + String(r.at).replace('T', ' ').slice(0, 16) + ')' : '') + ' — click to review and cancel' : n === 0 ? 'No line pending for cancellation on ' + date + (r.at ? ' (checked ' + String(r.at).replace('T', ' ').slice(0, 16) + ')' : '') : date + ' not checked yet — click to check the pending cancellations';
        }).catch(function () {});
    }
    function openCancels() {
        if (!window.WmsAlerts) return;
        var date = tdGet(), b = document.getElementById('wms-cancel-btn');
        window.WmsAlerts.open('CANCEL'); window.WmsAlerts.show(date);
        if (CC.n == null && hosted()) { if (b) b.classList.add('busy'); Promise.resolve(window.WmsAlerts.search(date)).then(cancelCount); }
    }

    // ─── mount ─────────────────────────────────────────────────────────────────
    function mount() {
        var home = document.getElementById('wms-home-btn'), anchor = home && home.parentElement; if (!anchor || !anchor.parentElement || document.getElementById('wtb')) return;
        var d = tdGet();
        var el = document.createElement('div'); el.id = 'wtb'; el.className = 'wtb';
        el.innerHTML = '<div class="wtb-date" title="Trip date — the search, the pending cancellations and the debrief use it; default tomorrow"><i class="fas fa-calendar-alt"></i><button id="wtb-prev" title="Previous day"><i class="fas fa-chevron-left"></i></button><input type="date" id="wtb-date" value="' + esc(d) + '"><button id="wtb-next" title="Next day"><i class="fas fa-chevron-right"></i></button><span class="wtb-day" id="wtb-day">' + esc(dayWord(d)) + '</span></div>' +
            '<div class="wtb-search" id="wtb-search"><input type="text" id="wtb-q" placeholder="Search trip, order, customer, picker…" autocomplete="off" spellcheck="false"><i class="fas fa-search"></i><button class="wtb-x" id="wtb-clear" title="Clear">✕</button><div class="wtb-dd" id="wtb-dd"></div></div>' +
            '<div style="position:relative;"><button id="wms-cancel-btn" title="Pending cancellations"><i class="fas fa-ban"></i><span id="wms-cancel-badge">0</span></button></div>';
        anchor.parentElement.insertBefore(el, anchor);
        el.querySelector('#wtb-prev').onclick = function () { tdSet(addDays(tdGet(), -1)); };
        el.querySelector('#wtb-next').onclick = function () { tdSet(addDays(tdGet(), 1)); };
        el.querySelector('#wtb-date').onchange = function () { if (this.value) tdSet(this.value); };
        var q = el.querySelector('#wtb-q');
        q.addEventListener('input', function () { SR.q = q.value; clearTimeout(SR.timer); if (!SR.q.trim()) { SR.items = []; paintDd(); return; } SR.items = []; paintDd(); SR.timer = setTimeout(function () { search(SR.q); }, 220); });
        q.addEventListener('focus', function () { if (SR.q.trim()) { search(SR.q); } });
        q.addEventListener('keydown', onKey);
        q.addEventListener('blur', function () { setTimeout(closeDd, 150); });
        el.querySelector('#wtb-clear').onmousedown = function (e) { e.preventDefault(); q.value = ''; SR.q = ''; SR.items = []; paintDd(); q.focus(); };
        el.querySelector('#wms-cancel-btn').onclick = openCancels;
        document.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !e.shiftKey) { e.preventDefault(); q.focus(); q.select(); } });
        tdSet(d, true);
        document.addEventListener('wms-alerts', cancelCount);
        CC.timer = setInterval(cancelCount, 60000);
        setTimeout(cancelCount, 2500);
    }
    window.WmsToolbar = { search: function (q) { var el = document.getElementById('wtb-q'); if (el) { el.value = q; SR.q = q; el.focus(); } search(q); }, read: readDate, refresh: cancelCount, openCancels: openCancels, state: function () { return { date: tdGet(), q: SR.q, items: SR.items, pending: CC.n, open: SR.open }; } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
