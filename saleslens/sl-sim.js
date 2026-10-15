/* Sales Lens — Simulation Lab: business assumptions → baseline vs scenario revenue and margin (python -m sales_intel simulate).
 * Results are estimates, never promises: every run names its assumptions, a low / high range and the model version. */
(function () {
    'use strict';
    var SL = window.SL, esc = SL.esc;
    var LEVERS = [
        ['inventoryPct', 'More stock', '%', 0, 50, 5, 'Extra stock as a share of the items\' normal volume — wins back sales lost to stock-outs'],
        ['fillRatePts', 'Better fill rate', 'pts', 0, 20, 0.5, 'Points of fill rate gained — wins back short shipments and cancellations'],
        ['leadTimeDays', 'Shorter lead time', 'days', 0, 10, 1, 'Days faster — wins back sales lost to late deliveries'],
        ['pricePct', 'Price change', '%', -15, 15, 0.5, 'Through each item\'s price response'],
        ['discountPts', 'Discount change', 'pts', -10, 10, 0.5, 'More discount = lower net price, more volume, less margin per unit'],
        ['cancelReductionPct', 'Fewer cancellations', '%', 0, 100, 5, 'Share of cancelled order value (not for stock) kept'],
        ['returnReductionPct', 'Fewer returns', '%', 0, 100, 5, 'Share of returned value kept'],
        ['recoveryRatePct', 'Lost sales won back by the team', '%', 0, 100, 5, 'Share of the open opportunities the sales team wins back']
    ];
    var PRESETS = {
        stock10: { name: 'Stock +10 %', inventoryPct: 10 }, price3: { name: 'Price +3 %', pricePct: 3 }, disc2: { name: 'Discount −2 pts', discountPts: -2 },
        ops: { name: 'Operations fixed', fillRatePts: 3, leadTimeDays: 2, cancelReductionPct: 25 }, team: { name: 'Sales push', recoveryRatePct: 30 }
    };
    var S = { sc: { name: 'My scenario' }, last: null };

    SL.views.sim = function (el) {
        return SL.qs(["SELECT DISTINCT profit_center FROM sl_items WHERE profit_center <> '' ORDER BY 1"]).then(function (d) {
            el.innerHTML = '<div class="sim"><div class="card simf"><h2><i class="fas fa-sliders"></i> Scenario <span class="tag est">Estimate</span></h2>' +
                '<div class="chips">' + Object.keys(PRESETS).map(function (k) { return '<button class="chipb" data-p="' + k + '">' + esc(PRESETS[k].name) + '</button>'; }).join('') + '</div>' +
                '<label class="fl">Name <input id="s-name" value="' + esc(S.sc.name || '') + '"></label>' +
                LEVERS.map(function (l) {
                    var v = S.sc[l[0]] || 0;
                    return '<div class="lev" title="' + esc(l[6]) + '"><div><b>' + esc(l[1]) + '</b><span class="lv" id="v-' + l[0] + '">' + (v > 0 && l[3] < 0 ? '+' : '') + v + ' ' + l[2] + '</span></div>' +
                        '<input type="range" data-l="' + l[0] + '" min="' + l[3] + '" max="' + l[4] + '" step="' + l[5] + '" value="' + v + '"></div>';
                }).join('') +
                '<label class="ck"><input type="checkbox" id="s-sub"' + (S.sc.substitution ? ' checked' : '') + '> Offer a substitute when out of stock</label>' +
                '<h3>Scope</h3><label class="fl">Profit centre <select id="s-pc"><option value="">Everything</option>' + d[0].map(function (r) { return '<option' + ((S.sc.scope || {}).profitCenter === r.profit_center ? ' selected' : '') + '>' + esc(r.profit_center) + '</option>'; }).join('') + '</select></label>' +
                '<label class="fl">Items <input id="s-items" placeholder="item numbers, comma separated" value="' + esc(((S.sc.scope || {}).items || []).join(', ')) + '"></label>' +
                '<label class="fl">Customers <input id="s-cust" placeholder="account numbers, comma separated" value="' + esc(((S.sc.scope || {}).customers || []).join(', ')) + '"></label>' +
                '<div class="bar"><button class="btn pri" id="s-run"><i class="fas fa-play"></i> Run the scenario</button><button class="btn ghost" id="s-reset">Reset</button></div></div>' +
                '<div><div class="card" id="s-out"><p class="muted">Move the sliders and run the scenario. The baseline is the last 12 months of clean order lines; the operational levers win back part of the sales the latest run attributed to that cause.</p></div>' +
                '<div class="card"><h2><i class="fas fa-clock-rotate-left"></i> Saved scenarios</h2><div id="s-hist" class="muted small">Reading…</div></div></div></div>';
            el.querySelectorAll('input[type=range]').forEach(function (r) {
                r.oninput = function () { var l = LEVERS.filter(function (x) { return x[0] === r.dataset.l; })[0]; S.sc[r.dataset.l] = +r.value; el.querySelector('#v-' + r.dataset.l).textContent = (+r.value > 0 && l[3] < 0 ? '+' : '') + r.value + ' ' + l[2]; };
            });
            el.querySelector('.chips').onclick = function (e) { var b = e.target.closest('[data-p]'); if (!b) return; S.sc = Object.assign({ scope: S.sc.scope }, PRESETS[b.dataset.p]); SL.views.sim(el); };
            el.querySelector('#s-reset').onclick = function () { S.sc = { name: 'My scenario' }; SL.views.sim(el); };
            el.querySelector('#s-run').onclick = function () { run(el); };
            if (S.last) paint(el.querySelector('#s-out'), S.last);
            history(el);
        });
    };

    function list(v) { return String(v || '').split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(Boolean); }
    function run(el) {
        S.sc.name = el.querySelector('#s-name').value.trim() || 'Scenario';
        S.sc.substitution = el.querySelector('#s-sub').checked;
        S.sc.scope = { profitCenter: el.querySelector('#s-pc').value || undefined, items: list(el.querySelector('#s-items').value), customers: list(el.querySelector('#s-cust').value) };
        if (!S.sc.scope.items.length) delete S.sc.scope.items;
        if (!S.sc.scope.customers.length) delete S.sc.scope.customers;
        var any = LEVERS.some(function (l) { return +S.sc[l[0]]; }) || S.sc.substitution;
        if (!any) { SL.toast('Move at least one slider', 'err'); return; }
        var out = el.querySelector('#s-out');
        out.innerHTML = '<p class="muted"><i class="fas fa-spinner fa-spin"></i> Running the scenario in Python…</p>';
        SL.call('salesLensSimulate', { scenario: Object.assign({ defaultElasticity: SL.settings.defaultElasticity }, S.sc) }, 200000).then(function (r) {
            S.last = r; paint(out, r); history(el);
            SL.apex.sim(r).then(function () { SL.toast('Scenario saved on this PC and in APEX'); }).catch(function (e) { SL.toast('Saved on this PC — not in APEX: ' + e.message, 'err'); });
        }).catch(function (e) { out.innerHTML = '<p class="r">' + esc(e.message) + '</p>'; });
    }

    function paint(out, r) {
        var b = r.baseline || {}, res = r.result || {}, dl = r.delta || {}, rg = r.range || {};
        out.innerHTML = '<h2><i class="fas fa-scale-balanced"></i> ' + esc((r.scenario || {}).name || 'Scenario') + ' <span class="tag est">' + esc(r.label || 'Estimate') + '</span></h2>' +
            '<div class="kpis sm"><div class="kpi"><div class="k">Revenue</div><div class="v">' + SL.money(res.revenue) + '</div><div class="s">baseline ' + SL.money(b.revenue) + ' · <b class="' + (dl.revenue < 0 ? 'r' : 'g') + '">' + (dl.revenue >= 0 ? '+' : '') + SL.money(dl.revenue) + ' (' + (dl.revenue_pct >= 0 ? '+' : '') + dl.revenue_pct + ' %)</b></div></div>' +
            '<div class="kpi good"><div class="k">Margin</div><div class="v">' + SL.money(res.margin) + '</div><div class="s">baseline ' + SL.money(b.margin) + ' · <b class="' + (dl.margin < 0 ? 'r' : 'g') + '">' + (dl.margin >= 0 ? '+' : '') + SL.money(dl.margin) + ' (' + (dl.margin_pct >= 0 ? '+' : '') + dl.margin_pct + ' %)</b></div></div>' +
            '<div class="kpi"><div class="k">Range (margin change)</div><div class="v">' + SL.money(rg.margin_low) + ' … ' + SL.money(rg.margin_high) + '</div><div class="s">low / high from the price response and recovery assumptions</div></div>' +
            '<div class="kpi"><div class="k">Affected</div><div class="v">' + SL.n((r.impacted || {}).customers) + '</div><div class="s">customers · ' + SL.n((r.impacted || {}).items) + ' items · ' + SL.n((r.impacted || {}).opportunities) + ' opportunities</div></div></div>' +
            '<div class="ch"><canvas id="c-sim"></canvas></div>' +
            '<table class="t"><tr><th>Lever</th><th class="num">Revenue</th><th class="num">Margin</th><th>How</th></tr>' + (r.levers || []).map(function (l) { return '<tr><td>' + esc(l.label) + '</td><td class="num">' + SL.money(l.delta_revenue) + '</td><td class="num">' + SL.money(l.delta_margin) + '</td><td class="small">' + esc(l.note) + '</td></tr>'; }).join('') + '</table>' +
            '<h3>Assumptions</h3><ul class="small">' + (r.assumptions || []).map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' +
            '<p class="small muted">Model ' + esc(r.model_version) + ' · run ' + esc(r.sim_id || '') + ' ' + esc(String(r.at || '').replace('T', ' ')) + '. Estimates, not guaranteed outcomes — test the big ones before acting on them.</p>' +
            '<div class="bar"><button class="btn sm" id="s-xls"><i class="fas fa-file-excel"></i> Excel</button></div>';
        SL.chart('c-sim', {
            type: 'bar', data: { labels: ['Revenue', 'Margin'], datasets: [{ label: 'Baseline (12 m)', data: [b.revenue, b.margin], backgroundColor: '#94a3b8' }, { label: 'Scenario', data: [res.revenue, res.margin], backgroundColor: '#c2410c' }] },
            options: { scales: { y: { ticks: { callback: function (v) { return SL.money(v); } } } } }
        });
        out.querySelector('#s-xls').onclick = function () {
            SL.xlsx('scenario-' + (r.sim_id || 'run') + '.xlsx', [
                { name: 'Result', cols: [{ k: 'what', label: 'What' }, { k: 'baseline', label: 'Baseline' }, { k: 'scenario', label: 'Scenario' }, { k: 'delta', label: 'Change' }],
                    rows: [{ what: 'Revenue', baseline: b.revenue, scenario: res.revenue, delta: dl.revenue }, { what: 'Margin', baseline: b.margin, scenario: res.margin, delta: dl.margin }, { what: 'Margin range', baseline: '', scenario: rg.margin_low + ' … ' + rg.margin_high, delta: '' }] },
                { name: 'Levers', cols: [{ k: 'label', label: 'Lever' }, { k: 'delta_revenue', label: 'Revenue' }, { k: 'delta_margin', label: 'Margin' }, { k: 'note', label: 'How' }], rows: r.levers || [] },
                { name: 'Assumptions', cols: [{ k: 'a', label: 'Assumption' }], rows: (r.assumptions || []).map(function (a) { return { a: a }; }).concat([{ a: 'Scenario: ' + JSON.stringify(r.scenario) }, { a: 'Model ' + r.model_version }]) }]);
        };
    }

    function history(el) {
        SL.host('salesLensSims', {}, 20000).then(function (d) {
            var list = (d && d.sims) || [], box = el.querySelector('#s-hist'); if (!box) return;
            box.innerHTML = list.length ? '<table class="t">' + list.slice(0, 30).map(function (s, i) {
                return '<tr class="click" data-i="' + i + '"><td><b>' + esc((s.scenario || {}).name || '') + '</b><div class="small muted">' + esc(String(s.at || '').replace('T', ' ')) + ' · ' + esc(s.by || '') + '</div></td><td class="num">' + SL.money((s.delta || {}).revenue) + '</td><td class="num"><b>' + SL.money((s.delta || {}).margin) + '</b></td></tr>';
            }).join('') + '</table>' : 'None yet.';
            box.onclick = function (e) { var tr = e.target.closest('[data-i]'); if (!tr) return; S.last = list[+tr.dataset.i]; S.sc = Object.assign({}, S.last.scenario); SL.views.sim(el); };
        }).catch(function () { });
    }
})();
