// ============================================================
// WMS left menu — the WMS 2.0 look, without changing what the menu does
// ------------------------------------------------------------
// The menu items of wms/index.html stay exactly as they are (same elements, same data-page, same
// onclick, same "open in a new window" icon, the click listeners app.js attached): this script only
// MOVES them into groups (Operate, Orders & shipping, Printing, Automation, Analyse, Setup & help),
// adds a Collapse button (icon rail, body.wms-menu-min) and a "Classic look" switch that puts every
// item back where it was. Styles: wms/menu.css under body.wms-menu-v2.
// Per PC: localStorage wms.menu.classic ('1' = the old look), wms.menu.min ('1' = rail),
// wms.menu.fold.<group> ('1' = folded).
// ============================================================
(function () {
    'use strict';
    const GROUPS = [
        { key: 'operate',  title: 'Operate',            pages: ['trip-management', 'pick-release', 'cancel-autopilot', 'vehicles', 'vehicles-management', 'pickers-management', 'picker-view', 'picking-time-monitor'] },
        { key: 'orders',   title: 'Orders & shipping',  pages: ['pending-shipment-lines', 'pending-store-transactions', 'shipping-agents', 'mra-interface'] },
        { key: 'printing', title: 'Printing',           pages: ['monitor-printing', 'printer-setup-new'] },
        { key: 'auto',     title: 'Automation',         pages: ['auto-inventory-processing', 'auto-sales-order-processing'] },
        { key: 'analyse',  title: 'Analyse',            pages: ['bi-dashboard', 'daily-history'] },
        { key: 'setup',    title: 'Setup & help',       pages: ['settings', 'help-documentation', 'training-center', 'release-manager'] }
    ];
    const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };
    let original = null;          // the items in their original order, to restore the classic look

    /** The page key of a menu item: its data-page, else the argument of its "open in a new window" icon. */
    function keyOf(item) {
        if (item.dataset.page) return item.dataset.page;
        const nw = item.querySelector('.menu-new-window');
        const m = nw && /openNewWmsInstance\('([^']+)'\)/.exec(nw.getAttribute('onclick') || '');
        if (m) return m[1];
        const oc = /href='([^'.]+)\.html'/.exec(item.getAttribute('onclick') || '');
        return oc ? oc[1] : (item.textContent || '').trim();
    }
    function labelOf(item) { const s = item.querySelector('span'); return (s ? s.textContent : item.textContent || '').trim(); }

    function build() {
        const side = document.getElementById('sidebar');
        if (!side || side.querySelector('.menu-group')) return;
        const items = Array.from(side.querySelectorAll(':scope > .menu-item'));
        if (!items.length) return;
        original = items.slice();
        const byKey = {};
        items.forEach(it => { byKey[keyOf(it)] = byKey[keyOf(it)] || []; byKey[keyOf(it)].push(it); });
        const used = new Set();
        const frag = document.createDocumentFragment();
        const groups = GROUPS.map(g => ({ key: g.key, title: g.title, items: g.pages.flatMap(p => byKey[p] || []) }));
        const rest = items.filter(it => !groups.some(g => g.items.includes(it)));
        if (rest.length) groups.push({ key: 'more', title: 'More', items: rest });
        groups.filter(g => g.items.length).forEach(g => {
            const box = document.createElement('div');
            box.className = 'menu-group' + (ls.get('wms.menu.fold.' + g.key) === '1' ? ' folded' : '');
            box.dataset.group = g.key;
            const title = document.createElement('div');
            title.className = 'menu-group-title';
            title.innerHTML = `<span>${g.title}</span><i class="fas fa-chevron-down menu-fold"></i>`;
            title.title = 'Show / hide this group';
            title.addEventListener('click', () => { box.classList.toggle('folded'); ls.set('wms.menu.fold.' + g.key, box.classList.contains('folded') ? '1' : '0'); });
            const list = document.createElement('div');
            list.className = 'menu-group-items';
            g.items.forEach(it => { used.add(it); it.title = labelOf(it); list.appendChild(it); });   // moved, not copied: listeners and onclick stay
            box.appendChild(title); box.appendChild(list); frag.appendChild(box);
        });
        const foot = document.createElement('div');
        foot.className = 'menu-foot';
        foot.innerHTML = `<button type="button" class="menu-collapse" title="Collapse the menu to icons"><i class="fas fa-angles-left"></i><span>Collapse</span></button>
            <button type="button" class="menu-classic" title="Back to the old menu (the items work exactly the same)"><i class="fas fa-undo"></i><span>Classic look</span></button>`;
        foot.querySelector('.menu-collapse').addEventListener('click', () => setMin(!document.body.classList.contains('wms-menu-min')));
        foot.querySelector('.menu-classic').addEventListener('click', () => classic(true));
        frag.appendChild(foot);
        side.appendChild(frag);
        document.body.classList.add('wms-menu-v2');
        setMin(ls.get('wms.menu.min') === '1', true);
        // the active page opens its group
        const act = side.querySelector('.menu-item.active');
        if (act) { const g = act.closest('.menu-group'); if (g) g.classList.remove('folded'); }
    }
    function setMin(on, silent) {
        document.body.classList.toggle('wms-menu-min', !!on);
        const b = document.querySelector('#sidebar .menu-collapse');
        if (b) {
            b.innerHTML = on ? '<i class="fas fa-angles-right"></i><span>Expand</span>' : '<i class="fas fa-angles-left"></i><span>Collapse</span>';
            b.title = on ? 'Expand the menu' : 'Collapse the menu to icons';
        }
        if (!silent) ls.set('wms.menu.min', on ? '1' : '0');
    }
    /** Put every item back in its original place (the old look); "New look" brings the groups back. */
    function classic(on) {
        const side = document.getElementById('sidebar');
        if (!side) return;
        if (on) {
            (original || []).forEach(it => { it.removeAttribute('title'); side.appendChild(it); });
            side.querySelectorAll('.menu-group, .menu-foot').forEach(el => el.remove());
            document.body.classList.remove('wms-menu-v2', 'wms-menu-min');
            ls.set('wms.menu.classic', '1');
            if (!side.querySelector('.menu-newlook')) {
                const b = document.createElement('div');
                b.className = 'menu-item menu-newlook';
                b.style.cssText = 'margin-top:14px;opacity:.75;font-size:.78rem;';
                b.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i><span>New menu look</span>';
                b.title = 'Grouped menu with Collapse (the WMS 2.0 look)';
                b.addEventListener('click', e => { e.stopPropagation(); b.remove(); ls.set('wms.menu.classic', '0'); build(); });
                side.appendChild(b);
            }
        } else { ls.set('wms.menu.classic', '0'); build(); }
    }
    window.wmsMenu = { build, classic, setMin, GROUPS };

    document.addEventListener('DOMContentLoaded', function () {
        if (ls.get('wms.menu.classic') === '1') { classic(true); return; }
        build();
    });
})();
