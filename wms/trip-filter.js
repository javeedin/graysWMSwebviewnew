// ============================================================================
// TRIP MANAGEMENT › TRIPS TAB — "Filter trips on any column" box in the Filter by Date bar
// ----------------------------------------------------------------------------
// app.js draws the Trips tab (renderTripsAsCards: the Filter by Date chips + one card per trip). This script adds a search
// box next to the date chips and hides the cards that do not match — app.js is not changed. A card matches when every
// word typed is found in the card's text OR in any column of that trip's rows in window.currentFullData (the GETTRIPDETAILS
// answer: trip id, date, lorry, bay, priority, status, instance, order count and whatever else the handler sends).
// `column:value` (e.g. lorry:pickup, priority:high, bay:l1) looks in the columns whose name contains "column" only.
// The "Showing n of m trips" count follows the filter; Esc or ✕ clears it; a date-chip re-render keeps the filter.
// ============================================================================
(function () {
    'use strict';
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var state = {};   // tabId → { q }

    function tripIdOf(card) {
        var b = card.querySelector('[onclick*="openTripDetails("]'), m = b && /openTripDetails\(\s*'([^']*)'/.exec(b.getAttribute('onclick') || '');
        if (m) return m[1];
        var t = /Trip\s*#\s*([^\s-]+)/.exec(card.textContent || '');
        return t ? t[1] : '';
    }
    /** Every value of the trip's rows (any column) as one lower-case string, plus per-column text for column:value. */
    function dataOf(tripId) {
        var rows = (window.currentFullData || []).filter(function (r) { return String(r.trip_id != null ? r.trip_id : r.TRIP_ID) === String(tripId); });
        var all = [], cols = {};
        rows.forEach(function (r) {
            Object.keys(r).forEach(function (k) {
                var v = r[k]; if (v == null || typeof v === 'object') return;
                var s = String(v).toLowerCase(); all.push(s);
                var ck = k.toLowerCase(); cols[ck] = (cols[ck] ? cols[ck] + ' ' : '') + s;
            });
        });
        return { all: all.join(' '), cols: cols };
    }
    function matches(card, tokens) {
        var text = (card.textContent || '').toLowerCase(), d = null;
        return tokens.every(function (tok) {
            var m = /^([a-z_ ]+):(.+)$/.exec(tok);
            if (m) {
                d = d || dataOf(tripIdOf(card));
                var key = m[1].replace(/ /g, '_'), val = m[2];
                return Object.keys(d.cols).some(function (c) { return c.indexOf(key) >= 0 && d.cols[c].indexOf(val) >= 0; });
            }
            if (text.indexOf(tok) >= 0) return true;
            d = d || dataOf(tripIdOf(card));
            return d.all.indexOf(tok) >= 0;
        });
    }
    function apply(tabId) {
        var box = document.getElementById('trip-cards-' + tabId), input = document.getElementById('trip-filter-' + tabId);
        if (!box || !input) return;
        var q = input.value.trim().toLowerCase(), tokens = q ? q.split(/\s+/) : [];
        var cards = Array.from(box.children).filter(function (c) { return !c.classList.contains('empty-state'); });
        var shown = 0;
        cards.forEach(function (c) { var on = !tokens.length || matches(c, tokens); c.style.display = on ? '' : 'none'; if (on) shown++; });
        var cnt = document.getElementById('trips-count-' + tabId);
        if (cnt && cards.length) cnt.textContent = shown;
        var info = input.parentElement.parentElement.querySelector('.ttf-count');
        if (info) info.textContent = tokens.length ? shown + ' of ' + cards.length + ' match' : '';
        input.parentElement.querySelector('.ttf-clear').style.display = q ? '' : 'none';
        var none = box.querySelector('.ttf-none');
        if (tokens.length && !shown && cards.length) {
            if (!none) { none = document.createElement('div'); none.className = 'ttf-none'; none.style.cssText = 'grid-column:1/-1;padding:1.2rem;text-align:center;color:#64748b;font-size:.85rem;'; box.appendChild(none); }
            none.innerHTML = '<i class="fas fa-filter" style="color:#94a3b8;"></i> No trip matches <b>' + esc(input.value.trim()) + '</b> — the words are looked for in the card and in every column of the trip\'s rows.';
        } else if (none) none.remove();
        state[tabId] = { q: input.value };
    }
    function addBox(dateFilters) {
        var tabId = (dateFilters.id || '').replace(/^date-filters-/, '');
        if (!tabId || dateFilters.parentElement.querySelector('.trip-text-filter')) return;
        dateFilters.style.flex = '0 1 auto';          // the chips keep their width, the box takes the rest
        var wrap = document.createElement('div');
        wrap.className = 'trip-text-filter';
        wrap.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1 1 260px;min-width:220px;';
        wrap.innerHTML = '<div style="position:relative;flex:1;">' +
            '<i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:.75rem;pointer-events:none;"></i>' +
            '<input type="text" id="trip-filter-' + esc(tabId) + '" autocomplete="off" spellcheck="false" placeholder="Filter trips on any column… trip, bay, lorry, date, status, priority, orders (or lorry:pickup)" ' +
                'title="Every word must match the card or any column of the trip\'s rows. column:value looks in that column only, e.g. lorry:pickup, priority:high. Esc clears." ' +
                'style="width:100%;box-sizing:border-box;padding:7px 30px 7px 30px;border:1px solid #cbd5e1;border-radius:8px;font-size:.8rem;color:#0f172a;background:#fff;">' +
            '<button type="button" class="ttf-clear" title="Clear the filter" style="display:none;position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:#e2e8f0;color:#334155;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:.7rem;line-height:20px;padding:0;">✕</button>' +
            '</div><span class="ttf-count" style="font-size:.74rem;color:#64748b;white-space:nowrap;"></span>';
        dateFilters.insertAdjacentElement('afterend', wrap);
        var input = wrap.querySelector('input');
        if (state[tabId] && state[tabId].q) input.value = state[tabId].q;
        input.addEventListener('input', function () { apply(tabId); });
        input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { input.value = ''; apply(tabId); } });
        wrap.querySelector('.ttf-clear').addEventListener('click', function () { input.value = ''; apply(tabId); input.focus(); });
        watchCards(tabId);
        apply(tabId);
    }
    var cardWatchers = {};
    /** The date chips re-render the cards (innerHTML): apply the filter again on every change. */
    function watchCards(tabId) {
        var box = document.getElementById('trip-cards-' + tabId);
        if (!box || !window.MutationObserver) return;
        if (cardWatchers[tabId]) cardWatchers[tabId].disconnect();
        var t = null;
        cardWatchers[tabId] = new MutationObserver(function (muts) {
            if (!muts.some(function (m) { return m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length) && !Array.from(m.addedNodes).every(function (n) { return n.className === 'ttf-none'; }); })) return;
            clearTimeout(t); t = setTimeout(function () { apply(tabId); }, 30);
        });
        cardWatchers[tabId].observe(box, { childList: true });
    }
    function scan(root) {
        (root.querySelectorAll ? Array.from(root.querySelectorAll('[id^="date-filters-"]')) : []).forEach(addBox);
        if (root.id && /^date-filters-/.test(root.id)) addBox(root);
    }
    window.wmsTripFilter = { apply: apply, matches: matches };
    document.addEventListener('DOMContentLoaded', function () {
        var host = document.getElementById('trip-tab-content') || document.body;
        scan(host);
        if (!window.MutationObserver) return;
        new MutationObserver(function (muts) {
            muts.forEach(function (m) { Array.from(m.addedNodes).forEach(function (n) { if (n.nodeType === 1) scan(n); }); });
        }).observe(host, { childList: true, subtree: true });
    });
})();
