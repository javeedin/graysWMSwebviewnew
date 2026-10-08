// wms/page-tabs.js — the WMS pages as tabs across the top of the central panel.
//
// The left menu no longer replaces the page: a click opens that page as a tab (or switches to its tab when it is
// already open). Trip Management is the first tab and is always there; every other tab has a × (middle-click closes
// too) and "Close all" closes everything except Trip Management. The open tabs are remembered per PC
// (localStorage wms.ptabs) and come back after a reload with Trip Management on screen.
//
// app.js is unchanged: its navigateToPage still shows the page and marks the menu; this script wraps it so every
// way a page is reached (a menu click, a hash, a script such as the pick-release chip or MraInterface.history,
// the browser's back button) lands in a tab. A closed tab's page is only hidden, so a page keeps its state and a
// background run (pick release, pending cancellations) goes on; opening the tab again shows it as it was.
(function () {
    'use strict';
    var FIXED = 'trip-management', KEY = 'wms.ptabs', MAIN = 'main-content';
    var T = { open: [FIXED], active: FIXED, el: null, tries: 0 };
    var ls = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } } };

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function menuItem(id) { return id ? document.querySelector('.menu-item[data-page="' + id + '"]') : null; }
    function pageOf(id) { var p = id ? document.getElementById(id) : null; return p && p.classList.contains('page-content') ? p : null; }
    function isPage(id) { return !!menuItem(id) && !!pageOf(id); }
    function labelOf(id) {
        var m = menuItem(id), sp = m && m.querySelector('span'), t = sp ? sp.textContent.trim() : '';
        return t || String(id).replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }
    function iconOf(id) { var m = menuItem(id), i = m && m.querySelector('i'); return i && !i.classList.contains('menu-new-window') ? i.className : 'fas fa-file-lines'; }
    function save() { ls.set(KEY, JSON.stringify({ open: T.open, active: T.active })); }
    function load() {
        try { var s = JSON.parse(ls.get(KEY) || 'null'); if (s && Array.isArray(s.open)) T.open = s.open.filter(isPage); } catch (e) { T.open = [FIXED]; }
        T.open = [FIXED].concat(T.open.filter(function (x) { return x !== FIXED; }));
    }

    function render() {
        var bar = T.el; if (!bar) return;
        bar.innerHTML = T.open.map(function (id) {
            var fixed = id === FIXED, on = id === T.active;
            return '<button type="button" class="pt' + (on ? ' on' : '') + (fixed ? ' fixed' : '') + '" data-id="' + esc(id) + '" title="' + esc(labelOf(id)) + (fixed ? ' — always open' : ' · middle-click closes') + '">' +
                '<i class="' + esc(iconOf(id)) + '"></i><span>' + esc(labelOf(id)) + '</span>' + (fixed ? '<i class="fas fa-thumbtack pin"></i>' : '<b class="x" title="Close">×</b>') + '</button>';
        }).join('') + '<span class="sp"></span><button type="button" class="pt-all" title="Close every tab except Trip Management"' + (T.open.length > 1 ? '' : ' disabled') + '><i class="fas fa-xmark"></i> Close all</button>';
        bar.querySelectorAll('.pt').forEach(function (b) {
            var id = b.getAttribute('data-id');
            b.addEventListener('click', function (e) { if (e.target.closest('.x')) close(id); else show(id); });
            b.addEventListener('auxclick', function (e) { if (e.button === 1 && id !== FIXED) { e.preventDefault(); close(id); } });
            b.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });     // no autoscroll on a middle-click
        });
        bar.querySelector('.pt-all').addEventListener('click', closeAll);
    }
    /** Shows a page through the WMS's own navigation (the wrapper below then opens / activates its tab). */
    function show(id) { if (typeof window.navigateToPage === 'function') window.navigateToPage(id, true); }
    function opened(id) {
        if (!isPage(id)) return;
        if (T.open.indexOf(id) < 0) T.open.push(id);
        T.active = id; render(); save();
    }
    function close(id) {
        if (id === FIXED) return;
        var i = T.open.indexOf(id); if (i < 0) return;
        T.open.splice(i, 1); save();
        if (T.active === id) show(T.open[Math.max(0, i - 1)] || FIXED); else render();
    }
    function closeAll() {
        var wasActive = T.active;
        T.open = [FIXED]; save();
        if (wasActive !== FIXED) show(FIXED); else render();
    }
    function ensureBar() {
        if (T.el) return true;
        var main = document.getElementById(MAIN); if (!main) return false;
        var bar = document.createElement('div'); bar.id = 'wms-page-tabs'; bar.className = 'wms-ptabs';
        main.insertBefore(bar, main.firstChild); T.el = bar; return true;
    }
    function hook() {
        var orig = window.navigateToPage;
        if (typeof orig !== 'function' || orig.__ptabs) return !!(orig && orig.__ptabs);
        var w = function (pageId, pushState) { var r = orig.apply(this, arguments); opened(pageId); return r; };
        w.__ptabs = true; window.navigateToPage = w;
        return true;
    }
    function start() {
        if (!ensureBar() || !hook()) { if (T.tries++ < 100) setTimeout(start, 50); return; }     // app.js installs navigateToPage on DOMContentLoaded
        load();
        var shown = Array.prototype.filter.call(document.querySelectorAll('.page-content'), function (p) { return p.style.display !== 'none' && isPage(p.id); })[0];
        var act = document.querySelector('.menu-item.active');
        var id = (shown && shown.id) || (act && act.getAttribute('data-page')) || FIXED;
        if (!isPage(id)) id = FIXED;
        if (T.open.indexOf(id) < 0) T.open.push(id);
        T.active = id; render(); save();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 0); });
    else setTimeout(start, 0);

    window.wmsPageTabs = { open: show, close: close, closeAll: closeAll, state: function () { return { open: T.open.slice(), active: T.active }; } };
})();
