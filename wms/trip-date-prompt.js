// ═══════════════════════════════════════════════════════════════════════════════
// TRIP DATE PROMPT — when the WMS opens it first asks which trip date you are working on. The answer becomes the
// toolbar's trip date (window.wmsTripDate, wms/toolbar.js), which every trip-date field starts on: Trip Management
// From / To (the automatic Fetch Trips waits for the answer), Pick Release, the cancellation autopilot, the WMS alerts,
// the Day debrief, the toolbar search, New Trip and the Picker Monitor (localStorage wms.tripDate.last). Changing the
// date in the toolbar later moves those pages too. Asked once per session (sessionStorage wms.tripDate.asked);
// "Ask me every time the WMS opens" off = localStorage wms.tripDate.ask = 'no'; the toolbar's day word reopens it.
// Shows the number of trips of each day (one GETTRIPDETAILS call on the toolbar's instance) so the choice is informed.
// window.WmsTripDatePrompt = { open, close, choose, state }
// ═══════════════════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    var ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT';
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var pad2 = function (n) { return ('0' + n).slice(-2); };
    var iso = function (d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
    var today = function () { return iso(new Date()); };
    var addDays = function (s, n) { var d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
    var isDate = function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); };
    function parse(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
    /** Yesterday / Today / Tomorrow, else the weekday. */
    function dayWord(s) {
        var d = parse(s); if (!d) return '';
        var t = new Date(); t.setHours(0, 0, 0, 0);
        var diff = Math.round((d - t) / 86400000);
        return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : DAYS[d.getDay()];
    }
    /** "10 Oct" or "Fri 10 Oct". */
    function fmt(s, withDay) { var d = parse(s); if (!d) return s; return (withDay ? DAYS[d.getDay()].slice(0, 3) + ' ' : '') + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
    function ddmm(s) { var p = String(s).split('-'); return p[2] + '-' + p[1] + '-' + p[0]; }
    function isoOf(v) { var s = String(v || ''), m = /^(\d{2})-(\d{2})-(\d{4})/.exec(s); if (m) return m[3] + '-' + m[2] + '-' + m[1]; m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? m[1] + '-' + m[2] + '-' + m[3] : ''; }
    function hosted() { return !!(window.chrome && window.chrome.webview && typeof sendMessageToCSharp === 'function'); }
    function curInstance() {
        var el = document.getElementById('current-instance-display'), v = el ? String(el.textContent || '').trim().toUpperCase() : '';
        if (!v) { try { v = String(sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || '').toUpperCase(); } catch (e) { v = ''; } }
        return v || 'PROD';
    }
    function askEvery() { try { return localStorage.getItem('wms.tripDate.ask') !== 'no'; } catch (e) { return true; } }
    function asked() { try { return sessionStorage.getItem('wms.tripDate.asked') === '1'; } catch (e) { return false; } }
    function markAsked() { try { sessionStorage.setItem('wms.tripDate.asked', '1'); } catch (e) { /* storage blocked */ } }
    function tdGet() { return window.wmsTripDate ? window.wmsTripDate.get() : addDays(today(), 1); }
    function dates() { var t = today(); return [-1, 0, 1, 2, 3].map(function (n) { return addDays(t, n); }); }

    var P = { open: false, sel: '', counts: null, held: false, auto: false, pod: '' };

    /** Trips per date on the instance — one GETTRIPDETAILS call over the five days. null = cannot ask (no host). */
    function countTrips(list) {
        if (!hosted()) return Promise.resolve(null);
        var url = ORDS + '/GETTRIPDETAILS?P_DATE_FROM=' + ddmm(list[0]) + '&P_DATE_TO=' + ddmm(list[list.length - 1]) + '&P_INSTANCE_NAME=' + encodeURIComponent(P.pod);
        return new Promise(function (resolve, reject) {
            sendMessageToCSharp({ action: 'executeGet', fullUrl: url }, function (err, data) {
                if (err) { reject(new Error(typeof err === 'string' ? err : (err.message || 'read failed'))); return; }
                var d = data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } } resolve(d);
            }, 30000, false);
        }).then(function (d) {
            var items = Array.isArray(d) ? d : (d && d.items) || [], c = {};
            list.forEach(function (x) { c[x] = 0; });
            items.forEach(function (t) { var k = isoOf(t.TRIP_DATE || t.trip_date); if (k in c) c[k]++; });
            return c;
        });
    }
    function countHtml(d) {
        var c = P.counts; if (c === null) return '<i class="fas fa-circle-notch fa-spin"></i>'; if (!c) return '';
        var n = c[d]; return n == null ? '' : n === 0 ? 'no trips' : n + ' trip' + (n === 1 ? '' : 's');
    }
    function goLabel() { return '<i class="fas fa-arrow-right"></i> Open the WMS on <b>' + esc(dayWord(P.sel)) + ' · ' + esc(fmt(P.sel, true)) + '</b>'; }
    function html() {
        var list = dates(), t = today();
        return '<div class="wtdp-card" role="dialog" aria-modal="true" aria-labelledby="wtdp-h">' +
            '<div class="wtdp-head"><div class="wtdp-ic"><i class="fas fa-calendar-check"></i></div><div class="wtdp-t"><h2 id="wtdp-h">Which trip date are you working on?</h2>' +
            '<p>Every date field in the WMS starts on it — Trip Management, Pick Release, the cancellation autopilot, the alerts, the Day debrief and the search. Change it any time with the date in the toolbar.</p></div>' +
            '<span class="wtdp-pod" title="The trips are counted on this instance"><i class="fas fa-server"></i> ' + esc(P.pod) + '</span></div>' +
            '<div class="wtdp-days">' + list.map(function (d) {
                return '<button type="button" class="wtdp-day' + (d === P.sel ? ' on' : '') + (d === t ? ' today' : '') + '" data-d="' + d + '" title="' + esc(d) + '"><span class="w">' + esc(dayWord(d)) + '</span><span class="d">' + esc(fmt(d)) + '</span><span class="n" data-n="' + d + '">' + countHtml(d) + '</span></button>';
            }).join('') + '</div>' +
            '<div class="wtdp-other"><label for="wtdp-date">Another date</label><input type="date" id="wtdp-date" value="' + esc(P.sel) + '"><span class="wtdp-hint">← → choose a day · Enter opens · Esc keeps ' + esc(dayWord(tdGet())) + '</span></div>' +
            '<div class="wtdp-foot"><label class="wtdp-ask" title="Off: the WMS starts on tomorrow without asking; the day word in the toolbar brings this back"><input type="checkbox" id="wtdp-ask"' + (askEvery() ? ' checked' : '') + '> Ask me every time the WMS opens</label>' +
            '<button type="button" class="wtdp-go" id="wtdp-go">' + goLabel() + '</button></div></div>';
    }
    function paintCounts() { var ov = document.getElementById('wtdp'); if (!ov) return; ov.querySelectorAll('.wtdp-day .n').forEach(function (el) { el.innerHTML = countHtml(el.getAttribute('data-n')); }); }
    function select(d) {
        if (!isDate(d)) return;
        P.sel = d; var ov = document.getElementById('wtdp'); if (!ov) return;
        ov.querySelectorAll('.wtdp-day').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-d') === d); });
        var inp = ov.querySelector('#wtdp-date'); if (inp && inp.value !== d) inp.value = d;
        ov.querySelector('#wtdp-go').innerHTML = goLabel();
        var on = ov.querySelector('.wtdp-day.on'); if (on && document.activeElement !== inp) on.focus();
    }
    /** The automatic Fetch Trips of Trip Management (app.js, 400 ms after load) waits for the answer. */
    function hold() { var b = document.getElementById('fetch-trips-btn'); if (b && !b.disabled) { b.disabled = true; P.held = true; } }
    function release() {
        var b = document.getElementById('fetch-trips-btn'), was = P.held, auto = P.auto; P.held = false; P.auto = false;
        if (was && b) b.disabled = false;
        if (!b || b.disabled) return;
        var page = document.getElementById('trip-management'); if (!page || page.style.display === 'none') return;
        // held = the automatic read never ran → run it now on the chosen date; not held but automatic = it already ran on
        // tomorrow (the login arrived after it) → read again only when another date was chosen; a reopen from the toolbar = no read
        if (was || (auto && P.sel !== addDays(today(), 1))) { try { b.click(); } catch (e) { /* the page decides */ } }
    }
    function open(auto) {
        if (P.open) return;
        P.open = true; P.auto = !!auto; P.pod = curInstance(); P.sel = tdGet(); P.counts = null;
        var ov = document.createElement('div'); ov.id = 'wtdp'; ov.className = 'wtdp'; ov.innerHTML = html(); document.body.appendChild(ov);
        wire(ov);
        if (auto) hold();
        countTrips(dates()).then(function (c) { P.counts = c || false; paintCounts(); }, function () { P.counts = false; paintCounts(); });
        setTimeout(function () { var b = ov.querySelector('.wtdp-day.on') || ov.querySelector('#wtdp-go'); if (b) b.focus(); }, 30);
    }
    function close() { var ov = document.getElementById('wtdp'); if (ov) ov.remove(); P.open = false; release(); }
    /** The answer: the toolbar's trip date (→ Trip Management From / To, the listeners of every page). */
    function choose(d) {
        d = d || P.sel; if (!isDate(d)) return;
        P.sel = d; markAsked();
        if (window.wmsTripDate) window.wmsTripDate.set(d);
        else ['trip-date-from', 'trip-date-to'].forEach(function (id) { var el = document.getElementById(id); if (el && el.type === 'date') el.value = d; });
        close();
    }
    /** Esc / the backdrop: nothing changes (the WMS stays on the date it had), the held read runs. */
    function cancel() { P.sel = tdGet(); markAsked(); close(); }
    function wire(ov) {
        ov.querySelectorAll('.wtdp-day').forEach(function (b) { b.onclick = function () { select(b.getAttribute('data-d')); }; b.ondblclick = function () { choose(b.getAttribute('data-d')); }; });
        ov.querySelector('#wtdp-date').onchange = function () { if (this.value) select(this.value); };
        ov.querySelector('#wtdp-go').onclick = function () { choose(P.sel); };
        ov.querySelector('#wtdp-ask').onchange = function () { try { localStorage.setItem('wms.tripDate.ask', this.checked ? 'yes' : 'no'); } catch (e) { /* storage blocked */ } };
        ov.addEventListener('mousedown', function (e) { if (e.target === ov) cancel(); });
        ov.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && e.target.id !== 'wtdp-ask') { e.preventDefault(); choose(P.sel); }
            else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.target.type !== 'date') { e.preventDefault(); select(addDays(P.sel, e.key === 'ArrowLeft' ? -1 : 1)); }
        });
    }
    document.addEventListener('keydown', function (e) { if (P.open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } }, true);
    /** Ask on open — once the login has shown the page (body.auth-pending gone), never twice in a session, not when switched off. */
    function boot() {
        if (!askEvery() || asked()) return;
        var go = function () { if (!P.open && !asked()) open(true); };
        if (!document.body.classList.contains('auth-pending')) { go(); return; }
        var mo = new MutationObserver(function () { if (!document.body.classList.contains('auth-pending')) { mo.disconnect(); go(); } });
        mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        setTimeout(function () { mo.disconnect(); }, 60000);
    }
    function mount() {
        var w = document.getElementById('wtb-day');
        if (w) { w.classList.add('wtdp-link'); w.title = 'Choose the trip date — every date field in the WMS starts on it'; w.onclick = function () { open(false); }; }
        boot();
    }
    window.WmsTripDatePrompt = { open: function () { open(false); }, close: cancel, choose: choose, state: function () { return { open: P.open, sel: P.sel, counts: P.counts, held: P.held, auto: P.auto, pod: P.pod }; } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
