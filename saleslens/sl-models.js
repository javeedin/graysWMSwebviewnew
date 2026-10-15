/* Sales Lens — Models: every model with its version, training window, accuracy, top factors, drift and history (RD 21–22). */
(function () {
    'use strict';
    var SL = window.SL, esc = SL.esc;
    var FEAT = {
        rev_trend: 'Spending trend', rev_12: 'Spend in 12 months', recency: 'Months since the last order', active_12: 'Months with an order', items_trend: 'Items bought trend',
        cancel_rate: 'Cancelled share', late_rate: 'Late deliveries', partial_rate: 'Partial deliveries', return_rate: 'Returned share', price_change: 'Net price change',
        tenure: 'Months as a customer', margin_pct: 'Gross margin %', cust_late_rate: 'Customer\'s late deliveries', cust_cancel_rate: 'Customer\'s cancelled share',
        item_cancel_rate: 'Item\'s cancelled share', item_oos_rate: 'Item cancelled for stock', item_partial_rate: 'Item\'s partial deliveries', org_late_rate: 'Warehouse\'s late deliveries',
        lead_days: 'Days to the promised date', qty_ratio: 'Quantity vs usual', order_lines: 'Lines on the order', dow: 'Day of the week'
    };
    SL.views.models = function (el) {
        return SL.qs(['SELECT * FROM sl_models', 'SELECT * FROM sl_importance', 'SELECT * FROM sl_drift', 'SELECT * FROM sl_backtest',
            'SELECT model, version, method, trained_at, rows, metrics FROM sl_model_history ORDER BY trained_at DESC LIMIT 200', 'SELECT * FROM sl_runs ORDER BY built_at DESC LIMIT 30']).then(function (d) {
                var imp = {}, drift = {};
                d[1].forEach(function (r) { (imp[r.model] = imp[r.model] || []).push(r); });
                d[2].forEach(function (r) { (drift[r.model] = drift[r.model] || []).push(r); });
                function metrics(m) {
                    var x = SL.json(m.metrics, {});
                    if (m.model === 'baseline') return x.wape == null ? '<span class="muted">not enough history to back-test</span>' :
                        '<span class="m">WAPE <b>' + SL.pct(x.wape * 100, 1) + '</b></span><span class="m">bias <b>' + (x.bias >= 0 ? '+' : '') + SL.pct(x.bias * 100, 1) + '</b></span><span class="m">inside the 90 % range <b>' + SL.pct(x.coverage * 100) + '</b></span>';
                    if (x.roc_auc == null) return '<span class="muted">' + esc(x.note || 'not measured — too few examples of both outcomes') + '</span>';
                    return ['roc_auc', 'pr_auc', 'precision', 'recall', 'f1'].map(function (k) { return '<span class="m">' + { roc_auc: 'ROC-AUC', pr_auc: 'PR-AUC', precision: 'precision', recall: 'recall', f1: 'F1' }[k] + ' <b>' + (+x[k]).toFixed(2) + '</b></span>'; }).join('') +
                        '<span class="m muted">tested on ' + SL.n(x.rows) + ' rows (' + SL.n(x.positives) + ' positive) of the latest months</span>';
                }
                el.innerHTML = '<div class="card"><h2><i class="fas fa-diagram-project"></i> Models in use <span class="muted small">trained on every build; tested on the most recent months they did not see</span></h2>' +
                    d[0].map(function (m) {
                        var drifted = (drift[m.model] || []).filter(function (x) { return x.psi != null && x.psi > 0.2; });
                        return '<div class="model"><div class="mh"><b>' + esc(m.title || m.model) + '</b><span class="pill">' + esc(m.method) + '</span>' + (drifted.length ? '<span class="pill warn" title="' + esc(drifted.map(function (x) { return (FEAT[x.feature] || x.feature) + ' PSI ' + x.psi; }).join(', ')) + '">input drift: ' + drifted.length + '</span>' : '<span class="pill good">no drift</span>') + '</div>' +
                            '<div class="small muted">' + esc(m.target || '') + ' · trained ' + esc(String(m.trained_at || '').replace('T', ' ')) + ' on ' + SL.n(m.rows) + ' rows (' + esc(SL.month(m.train_from)) + '–' + esc(SL.month(m.train_to)) + ') · version ' + esc(m.version) + '</div>' +
                            '<div class="ms">' + metrics(m) + '</div>' +
                            ((imp[m.model] || []).length ? '<div class="imp">' + imp[m.model].slice(0, 8).map(function (r) { return '<div class="pbar"><span>' + esc(FEAT[r.feature] || r.feature) + '</span><i style="--w:' + Math.round(r.importance * 100) + '%;--c:#c2410c"></i><b>' + Math.round(r.importance * 100) + ' %</b></div>'; }).join('') + '</div>' : '') + '</div>';
                    }).join('') + '</div>' +
                    '<div class="grid2"><div class="card"><h2><i class="fas fa-bullseye"></i> Baseline accuracy by segment</h2><table class="t"><tr><th>Segment</th><th class="num">Pairs</th><th class="num">WAPE</th><th class="num">Bias</th><th class="num">In range</th></tr>' +
                    d[3].map(function (r) { return '<tr><td>' + esc(r.segment === 'ALL' ? 'Everything' : r.segment + ' · ' + r.value) + '</td><td class="num">' + SL.n(r.pairs) + '</td><td class="num">' + SL.pct(r.wape * 100, 1) + '</td><td class="num">' + (r.bias >= 0 ? '+' : '') + SL.pct(r.bias * 100, 1) + '</td><td class="num">' + SL.pct(r.coverage * 100) + '</td></tr>'; }).join('') + '</table>' +
                    '<p class="small muted">WAPE = total absolute error ÷ total actual over the 12 months before the analysis window; bias > 0 means the baseline expects more than happened.</p></div>' +
                    '<div class="card"><h2><i class="fas fa-wave-square"></i> Input drift <span class="muted small">PSI between training and the rows scored now; above 0.2 = look</span></h2><table class="t"><tr><th>Model</th><th>Factor</th><th class="num">PSI</th></tr>' +
                    d[2].filter(function (r) { return r.psi != null; }).sort(function (a, b) { return b.psi - a.psi; }).slice(0, 14).map(function (r) { return '<tr><td>' + esc(r.model) + '</td><td>' + esc(FEAT[r.feature] || r.feature) + '</td><td class="num ' + (r.psi > 0.2 ? 'r' : '') + '">' + (+r.psi).toFixed(3) + '</td></tr>'; }).join('') + '</table></div></div>' +
                    '<div class="grid2"><div class="card"><h2><i class="fas fa-clock-rotate-left"></i> Retraining history</h2><div id="m-hist"></div></div>' +
                    '<div class="card"><h2><i class="fas fa-list-check"></i> Runs (audit)</h2><div id="m-runs"></div></div></div>';
                SL.grid(el.querySelector('#m-hist'), {
                    name: 'sales-lens-model-history', rows: d[4], limit: 50, cols: [{ k: 'trained_at', label: 'Trained' }, { k: 'model', label: 'Model' }, { k: 'method', label: 'Method' }, { k: 'rows', label: 'Rows', num: true },
                    { k: 'metrics', label: 'Accuracy', text: function (r) { var x = SL.json(r.metrics, {}); return x.roc_auc != null ? 'AUC ' + (+x.roc_auc).toFixed(2) : x.wape != null ? 'WAPE ' + (x.wape * 100).toFixed(1) + ' %' : ''; } }, { k: 'version', label: 'Version' }]
                });
                SL.grid(el.querySelector('#m-runs'), {
                    name: 'sales-lens-runs', rows: d[5].map(function (r) { var s = SL.json(r.summary, {}); r.window = SL.month((s.window || [])[0]) + '–' + SL.month((s.window || []).slice(-1)[0]); r.hash = s.data_hash; return r; }), limit: 30,
                    cols: [{ k: 'built_at', label: 'Built' }, { k: 'run_id', label: 'Run' }, { k: 'window', label: 'Window' }, { k: 'lines', label: 'Lines', num: true }, { k: 'opportunities', label: 'Opportunities', num: true }, { k: 'seconds', label: 's', num: true }, { k: 'hash', label: 'Data fingerprint' }]
                });
            });
    };
})();
