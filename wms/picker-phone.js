/* Picker Monitor (wms/picker-view.html) — a phone icon on every order card, picker group header, grid row and lorry-view picker
   row: a click opens that picker's mobile app (FCPos, the pickers' handheld app) in a panel docked at the right of the page, signed in
   as that picker — WmsPickerApp.popup (wms/picker-app.js) on the instance chosen on this page. Loaded after picker-drill.js;
   picker-view.html itself is not changed beyond the script / stylesheet tags. */
(function () {
    'use strict';
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var PP = window.PickerPhone = { last: '', count: 0 };
    function isPicker(name) { return !!name && !/^(unassigned|unknown|none|n\/a|—|-|)$/i.test(String(name).trim()); }
    function btn(name, cls, label) {
        return '<button type="button" class="pv-phone' + (cls ? ' ' + cls : '') + '" data-picker="' + esc(name) + '" title="Open ' + esc(name) + '’s mobile app — the pickers’ handheld app signed in as ' + esc(name) + '"><i class="fas fa-mobile-alt"></i>' + (label ? '<span>' + esc(label) + '</span>' : '') + '</button>';
    }
    function mode() { try { return typeof viewMode !== 'undefined' ? viewMode : 'picker'; } catch (e) { return 'picker'; } }   // eslint-disable-line no-undef

    // 1. the order cards (buildOrderCard is the page's; picker-drill.js wraps it too — any order is fine)
    var orig = window.buildOrderCard;
    if (typeof orig === 'function') window.buildOrderCard = function (o) {
        var div = orig.apply(this, arguments);
        try {
            if (o && isPicker(o.picker) && !div.querySelector('.pv-phone')) {
                var rows = div.querySelectorAll('.card-meta-row'), hit = null;
                for (var i = 0; i < rows.length; i++) if (rows[i].querySelector('i.fa-user')) { hit = rows[i]; break; }
                if (hit) { hit.classList.add('pv-pickrow'); hit.insertAdjacentHTML('beforeend', btn(o.picker, 'sm')); }
            }
        } catch (e) { /* card markup changed */ }
        return div;
    };

    // 2. everything the page draws without buildOrderCard: picker group headers, grid rows, the lorry view's picker rows
    function decorate() {
        var area = document.getElementById('cardsArea'); if (!area) return;
        if (mode() === 'picker') area.querySelectorAll('.group-header:not(.pv-phoned)').forEach(function (h) {
            h.classList.add('pv-phoned');
            var t = h.querySelector('.group-title'), name = t ? t.textContent.trim() : ''; if (!isPicker(name)) return;
            var badges = h.querySelector('.group-badges') || h;
            badges.insertAdjacentHTML('beforeend', btn(name, 'gh', 'Phone'));
        });
        area.querySelectorAll('tr[data-order-num]:not(.pv-phoned)').forEach(function (tr) {
            tr.classList.add('pv-phoned');
            var td = tr.children[1]; if (!td) return;
            var name = td.textContent.trim(); if (!isPicker(name)) return;
            td.classList.add('pv-pickcell'); td.insertAdjacentHTML('beforeend', btn(name, 'sm'));
        });
        area.querySelectorAll('.sv-picker-row:not(.pv-phoned)').forEach(function (r) {
            r.classList.add('pv-phoned');
            var n = r.querySelector('.sv-picker-name'), name = n ? n.textContent.trim() : ''; if (!isPicker(name)) return;
            r.insertAdjacentHTML('beforeend', btn(name, 'sm'));
        });
    }
    var queued = false;
    function schedule() { if (queued) return; queued = true; (window.requestAnimationFrame || setTimeout)(function () { queued = false; decorate(); }); }
    function watch() {
        var area = document.getElementById('cardsArea'); if (!area || !window.MutationObserver) return;
        new MutationObserver(schedule).observe(area, { childList: true, subtree: true });
        decorate();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();

    // 3. the click → the picker's phone (the drill-down's card click ignores buttons, so the order dialog never opens with it)
    PP.open = function (name) {
        name = String(name || '').trim(); if (!name) return null;
        PP.last = name; PP.count++;
        var inst = (document.getElementById('fpInstance') || {}).value || 'PROD';
        if (!window.WmsPickerApp || typeof window.WmsPickerApp.popup !== 'function') { alert('The Picker app script (wms/picker-app.js) is not loaded on this page.'); return null; }
        return window.WmsPickerApp.popup(name, { instance: inst });
    };
    document.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('.pv-phone'); if (!b) return;
        e.preventDefault(); e.stopPropagation();
        PP.open(b.getAttribute('data-picker'));
    });

    var css = document.createElement('style');
    css.textContent =
        '.pv-phone{display:inline-flex;align-items:center;justify-content:center;gap:4px;border:1px solid #c7d2fe;background:#eef2ff;color:#4338ca;border-radius:999px;cursor:pointer;font:inherit;font-weight:700;line-height:1;transition:background .12s,transform .12s}' +
        '.pv-phone:hover{background:#4338ca;color:#fff;border-color:#4338ca;transform:translateY(-1px)}' +
        '.pv-phone.sm{width:20px;height:20px;padding:0;font-size:10px;margin-left:auto;flex:0 0 auto}' +
        '.pv-phone.gh{height:24px;padding:0 10px;font-size:11px;margin-left:4px}' +
        '.card-meta-row.pv-pickrow{display:flex;align-items:center}' +
        '.card-meta-row.pv-pickrow > span{flex:1;min-width:0}' +
        'td.pv-pickcell{white-space:nowrap} td.pv-pickcell .pv-phone{margin-left:6px;vertical-align:middle}' +
        '.sv-picker-row .pv-phone{margin-left:4px}';
    document.head.appendChild(css);
})();
