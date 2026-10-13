/* Sales Lens — page shell. The module is being built in phases (docs: the Sales Opportunity Intelligence RD);
   each tab says what it will hold and in which phase it arrives. */
(function () {
    'use strict';
    var PHASES = [
        ['1', 'Setup & data', 'One-click Python install, 24–36 months of order lines, shipments, cancellations, prices, costs and returns from Fusion, checked against Fusion totals, daily stock snapshot.'],
        ['2', 'Missed sales (MVP)', 'Expected vs actual per customer × item × month, lost revenue and margin, the recoverable part, causes with evidence, ranked worklist, export, feedback.'],
        ['3', 'Predictions', 'Customers likely to buy less, orders likely to ship late, partly or be cancelled — each score with its top reasons.'],
        ['4', 'Next best action', 'What to do, who does it and by when; outcomes tracked against the action.'],
        ['5', 'Simulation Lab', 'What if: more stock, better fill rate, shorter lead time, other price or discount — baseline vs scenario.'],
        ['6', 'Cross-sell & pricing', 'Products a customer should be buying, price and discount response.']
    ];
    var TABS = {
        dash: { title: 'Dashboard', phase: '2', icon: 'fa-gauge-high', what: ['Missed revenue and missed margin for the period', 'Top causes (stock-out, cancellation, late shipment, price / discount change …)', 'Recovered so far from acted-on opportunities', 'Customers at risk', 'Scenario uplift from the Simulation Lab'] },
        work: { title: 'Worklist', phase: '2', icon: 'fa-list-ol', what: ['Ranked customer × product opportunities: value, margin, score, confidence', 'Primary and secondary cause with the evidence in plain words', 'Recommended action, owner and due date', 'Accept / reject / outcome feedback, export to CSV and Excel'] },
        cust: { title: 'Customers', phase: '2', icon: 'fa-users', what: ['Expected vs actual buying, month by month', 'Products dropped or slowing, margins, delays and returns', 'Risk score with its reasons, recommendations'] },
        prod: { title: 'Products', phase: '2', icon: 'fa-box', what: ['Demand trend and the loss from stock-outs', 'Customers and regions buying less', 'Price and discount performance'] },
        risk: { title: 'Order risk', phase: '3', icon: 'fa-truck-fast', what: ['Open orders likely to ship late, partly or be cancelled', 'Why (stock, lead time, customer history), what to do'] },
        sim: { title: 'Simulation Lab', phase: '5', icon: 'fa-sliders', what: ['Sliders for stock, fill rate, lead time, price and discount', 'Baseline vs scenario revenue and margin, the customers / orders / products affected', 'Every run saved with its assumptions — results are estimates, not promises'] },
        models: { title: 'Models', phase: '3', icon: 'fa-diagram-project', what: ['Each model with its version, training window and accuracy', 'Top factors, drift checks, retraining history'] },
        setup: { title: 'Setup', phase: '1', icon: 'fa-gear', what: ['Install / update the Python packages (pandas, statsmodels, scikit-learn, LightGBM, duckdb, pyarrow) with versions and a self-test', 'Data sources, lines left out (BOGO, crates, consignment, van transfers), units of measure', 'Thresholds and the nightly schedule — nothing hard-coded', 'Where it is saved: APEX (shared record) and DuckDB (full copy on this PC)'] }
    };
    var main = document.getElementById('main');
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function phasesHtml() {
        return '<div class="phases">' + PHASES.map(function (p) {
            return '<div class="phase"><b>Phase ' + p[0] + ' · ' + esc(p[1]) + '</b><div class="small">' + esc(p[2]) + '</div></div>';
        }).join('') + '</div>';
    }
    function show(tab) {
        var t = TABS[tab] || TABS.dash;
        document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
        try { localStorage.setItem('saleslens.tab', tab); } catch (e) { }
        main.innerHTML = '<div class="card"><h2><i class="fas ' + t.icon + '"></i> ' + esc(t.title) + ' <span class="pill now">Phase ' + t.phase + '</span></h2>' +
            '<p class="muted">This page is being built. It will show:</p><ul>' + t.what.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' +
            (tab === 'dash' ? '<div class="card"><h2><i class="fas fa-road"></i> How Sales Lens is being built</h2>' +
                '<p>Python in the pipeline server does the modelling; every result is saved in APEX (shared by every PC) and in DuckDB on this PC.</p>' + phasesHtml() + '</div>' : '');
    }
    document.getElementById('tabs').addEventListener('click', function (e) { var b = e.target.closest('button[data-tab]'); if (b) show(b.dataset.tab); });
    var start = 'dash'; try { start = localStorage.getItem('saleslens.tab') || 'dash'; } catch (e) { }
    show(TABS[start] ? start : 'dash');
    window.SalesLens = { show: show, TABS: TABS, PHASES: PHASES };
})();
