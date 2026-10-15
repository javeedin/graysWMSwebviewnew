/* Sales Lens — page core: tabs, the filter bar, shared reference data and the "no results yet" states.
 * Screens live in sl-views.js (Dashboard, Worklist, Customers, Products, Order risk), sl-sim.js (Simulation Lab),
 * sl-models.js (Models) and sl-setup.js (Setup & data). */
(function () {
    'use strict';
    var SL = window.SL;
    var TABS = ['dash', 'work', 'cust', 'prod', 'risk', 'sim', 'models', 'setup'];
    SL.views = {};
    SL.f = { bu: '', pc: '', tier: '', rep: '', q: '' };
    SL.ref = null;            // {run, bus, pcs, reps, settings}
    SL.settings = {};
    var main = document.getElementById('main');
    var bar = document.getElementById('fbar');
    var current = 'dash';

    function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

    /** the business units this login may see (settings.allowedBus[LOGIN]); null = every one */
    SL.allowedBus = function () {
        var m = (SL.settings || {}).allowedBus || {}, u = SL.user().toUpperCase();
        var l = m[u] || m[SL.user()];
        return Array.isArray(l) && l.length ? l.map(String) : null;
    };
    /** WHERE for tables with bu_id / profit_center / tier / salesperson columns (missing columns are left out by the caller) */
    SL.where = function (o) {
        o = o || {}; var w = ['1 = 1'], al = o.alias ? o.alias + '.' : '';
        var allowed = SL.allowedBus();
        if (o.bu !== false) {
            if (SL.f.bu) w.push(al + 'bu_id = ' + SL.lit(SL.f.bu));
            else if (allowed) w.push(al + 'bu_id IN (' + allowed.map(SL.lit).join(', ') + ')');
        }
        if (o.pc !== false && SL.f.pc) w.push(al + 'profit_center = ' + SL.lit(SL.f.pc));
        if (o.tier !== false && SL.f.tier) w.push(al + 'tier = ' + SL.lit(SL.f.tier));
        if (o.rep !== false && SL.f.rep) w.push(al + 'salesperson = ' + SL.lit(SL.f.rep));
        if (o.q && SL.f.q) {
            var words = SL.f.q.toLowerCase().split(/\s+/).filter(Boolean);
            words.forEach(function (x) { w.push('(' + o.q.map(function (c) { return 'lower(CAST(' + c + ' AS VARCHAR)) LIKE ' + SL.lit('%' + x + '%'); }).join(' OR ') + ')'); });
        }
        return w.join(' AND ');
    };

    SL.loadRef = function (force) {
        if (SL.ref && !SL.ref.missing && !force) return Promise.resolve(SL.ref);
        return Promise.all([
            SL.host('salesLensSettings', {}, 20000).catch(function () { return {}; }),
            SL.qs(['SELECT * FROM sl_runs ORDER BY built_at DESC LIMIT 1', 'SELECT bu_id, bu_name FROM sl_bus',
                "SELECT DISTINCT profit_center FROM sl_items WHERE profit_center IS NOT NULL AND profit_center <> '' ORDER BY 1",
                "SELECT DISTINCT salesperson FROM sl_customers WHERE salesperson IS NOT NULL AND salesperson <> '' ORDER BY 1"]).catch(function (e) { var r = [[], [], [], []]; r.missing = true; r.error = e.message; return r; })
        ]).then(function (x) {
            SL.settings = (x[0] && x[0].settings) || {};
            SL.cur = SL.settings.reportingCurrency || 'MUR';
            var d = x[1];
            var run = d[0][0] || null;
            SL.ref = { run: run, summary: run ? SL.json(run.summary, {}) : null, bus: d[1], pcs: d[2].map(function (r) { return r.profit_center; }), reps: d[3].map(function (r) { return r.salesperson; }), missing: d.missing || !run };
            paintBar();
            return SL.ref;
        });
    };

    function paintBar() {
        var r = SL.ref || {}, allowed = SL.allowedBus();
        var bus = (r.bus || []).filter(function (b) { return !allowed || allowed.indexOf(String(b.bu_id)) >= 0; });
        var s = r.summary;
        bar.innerHTML = (s ? '<span class="chip run" title="Run ' + SL.esc(r.run.run_id) + ' · model ' + SL.esc(r.run.version) + '"><i class="fas fa-database"></i> ' +
            SL.esc(SL.month((s.window || [])[0])) + '–' + SL.esc(SL.month((s.window || []).slice(-1)[0])) + ' · built ' + SL.esc(String(r.run.built_at || '').replace('T', ' ').slice(0, 16)) + '</span>' : '<span class="chip warn">No results yet</span>') +
            '<label>BU <select data-f="bu"><option value="">' + (allowed ? 'My business units' : 'All') + '</option>' + bus.map(function (b) { return '<option value="' + SL.esc(b.bu_id) + '"' + (SL.f.bu === String(b.bu_id) ? ' selected' : '') + '>' + SL.esc(b.bu_name || b.bu_id) + '</option>'; }).join('') + '</select></label>' +
            '<label>Profit centre <select data-f="pc"><option value="">All</option>' + (r.pcs || []).map(function (p) { return '<option' + (SL.f.pc === p ? ' selected' : '') + '>' + SL.esc(p) + '</option>'; }).join('') + '</select></label>' +
            '<label>Tier <select data-f="tier"><option value="">All</option>' + ['A', 'B', 'C'].map(function (t) { return '<option' + (SL.f.tier === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></label>' +
            '<label>Salesperson <select data-f="rep"><option value="">All</option>' + (r.reps || []).map(function (p) { return '<option' + (SL.f.rep === p ? ' selected' : '') + '>' + SL.esc(p) + '</option>'; }).join('') + '</select></label>' +
            '<input data-f="q" placeholder="Customer, item…" value="' + SL.esc(SL.f.q) + '"><span class="sp"></span>' +
            '<button class="btn sm ghost" id="f-clear" title="Clear the filters"><i class="fas fa-filter-circle-xmark"></i></button>';
        bar.querySelectorAll('[data-f]').forEach(function (e) {
            var k = e.dataset.f;
            e.addEventListener(e.tagName === 'INPUT' ? 'input' : 'change', function () {
                SL.f[k] = e.value; lsSet('saleslens.f', JSON.stringify(SL.f));
                clearTimeout(paintBar.t); paintBar.t = setTimeout(function () { show(current, true); }, e.tagName === 'INPUT' ? 350 : 0);
            });
        });
        document.getElementById('f-clear').onclick = function () { SL.f = { bu: '', pc: '', tier: '', rep: '', q: '' }; lsSet('saleslens.f', '{}'); paintBar(); show(current, true); };
        bar.style.display = current === 'setup' || current === 'sim' || current === 'models' ? 'none' : '';
    }

    SL.empty = function (el, why) {
        el.innerHTML = '<div class="card empty-state"><h2><i class="fas fa-seedling"></i> No results on this PC yet</h2>' +
            '<p>' + SL.esc(why || 'Sales Lens reads your Fusion order lines, builds expected demand per customer × item and finds the sales you missed.') + '</p>' +
            '<ol><li>Install Python (Setup & data › Python) — once per PC.</li><li>Sync the order lines from Fusion (Setup & data › Data) — 24 months the first time.</li>' +
            '<li>Build &amp; score — it runs by itself after a sync.</li></ol>' +
            '<p class="muted">Want to look around first? <button class="btn sm" id="go-demo"><i class="fas fa-flask"></i> Try it with demo data</button> on this PC.</p>' +
            '<button class="btn pri" id="go-setup"><i class="fas fa-gear"></i> Open Setup &amp; data</button></div>';
        el.querySelector('#go-setup').onclick = function () { show('setup'); };
        el.querySelector('#go-demo').onclick = function () { show('setup'); setTimeout(function () { if (SL.views.setup && SL.views.setup.demo) SL.views.setup.demo(); }, 300); };
    };

    function show(tab, keep) {
        if (TABS.indexOf(tab) < 0) tab = 'dash';
        if (current === 'setup' && tab !== 'setup' && window.SalesLensSetup) window.SalesLensSetup.leave();
        current = tab;
        lsSet('saleslens.tab', tab);
        document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
        bar.style.display = tab === 'setup' || tab === 'sim' || tab === 'models' ? 'none' : '';
        SL.destroyCharts();
        SL.close();
        if (tab === 'setup') { window.SalesLensSetup.render(main); return; }
        if (!keep) main.innerHTML = '<div class="card muted"><i class="fas fa-spinner fa-spin"></i> Reading this PC\'s results…</div>';
        SL.loadRef().then(function (ref) {
            if (ref.missing) { SL.empty(main); return; }
            var v = SL.views[tab];
            if (v) return v(main);
        }).catch(function (e) {
            main.innerHTML = '<div class="card"><h2><i class="fas fa-triangle-exclamation"></i> Could not read the results</h2><p class="r">' + SL.esc(e.message) + '</p></div>';
        });
    }
    SL.show = show;
    SL.refresh = function () { SL.ref = null; show(current); };
    SL.current = function () { return current; };

    try { var f = JSON.parse(lsGet('saleslens.f', '{}')); if (f && typeof f === 'object') SL.f = Object.assign(SL.f, f); } catch (e) { }
    document.getElementById('tabs').addEventListener('click', function (e) { var b = e.target.closest('button[data-tab]'); if (b) show(b.dataset.tab); });
    window.SalesLens = { show: show, refresh: SL.refresh };
    window.addEventListener('load', function () { show(lsGet('saleslens.tab', 'dash')); });
})();
