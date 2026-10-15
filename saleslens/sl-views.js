/* Sales Lens — Dashboard, Worklist (+ opportunity detail and feedback), Customers (+ Customer 360), Products (+ product view),
 * Order risk. Every number is read from this PC's DuckDB file; facts, predictions and simulations are labelled as such. */
(function () {
    'use strict';
    var SL = window.SL, V = SL.views, esc = SL.esc;

    function lf() { return +((SL.ref && SL.ref.summary) || {}).last_month || 0; }
    /** filters for queries that join sl_customers (c) and sl_items (i) */
    function wci(q) {
        var w = ['1 = 1'], allowed = SL.allowedBus();
        if (SL.f.bu) w.push('c.bu_id = ' + SL.lit(SL.f.bu)); else if (allowed) w.push('c.bu_id IN (' + allowed.map(SL.lit).join(', ') + ')');
        if (SL.f.pc) w.push('i.profit_center = ' + SL.lit(SL.f.pc));
        if (SL.f.tier) w.push('c.tier = ' + SL.lit(SL.f.tier));
        if (SL.f.rep) w.push('c.salesperson = ' + SL.lit(SL.f.rep));
        if (q && SL.f.q) SL.f.q.toLowerCase().split(/\s+/).filter(Boolean).forEach(function (x) { w.push('(' + q.map(function (col) { return 'lower(CAST(' + col + ' AS VARCHAR)) LIKE ' + SL.lit('%' + x + '%'); }).join(' OR ') + ')'); });
        return w.join(' AND ');
    }
    var OPPQ = ['customer', 'account_number', 'item', 'description'];
    var PRICE = 'p AS (SELECT account_number, item_id, SUM(revenue) / NULLIF(SUM(qty), 0) AS price FROM sl_cm GROUP BY 1, 2)';
    function kpi(label, value, sub, cls, tip) { return '<div class="kpi ' + (cls || '') + '" title="' + esc(tip || '') + '"><div class="k">' + esc(label) + '</div><div class="v">' + value + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>'; }
    function tag(kind) { return '<span class="tag ' + kind + '">' + { fact: 'Observed', pred: 'Prediction', est: 'Estimate' }[kind] + '</span>'; }
    function windowText() { var s = (SL.ref || {}).summary || {}; return SL.month((s.window || [])[0]) + '–' + SL.month((s.window || []).slice(-1)[0]); }

    // ── Dashboard ─────────────────────────────────────────────────
    V.dash = function (el) {
        var w = SL.where({ q: OPPQ }), L = lf();
        return Promise.all([SL.qs([
            'SELECT COUNT(*) AS n, SUM(lost_revenue) AS lr, SUM(lost_margin) AS lm, SUM(recoverable_margin) AS rm, SUM(recoverable_revenue) AS rr, COUNT(*) FILTER (WHERE priority = \'High\') AS hi FROM sl_opps WHERE ' + w,
            'SELECT primary_cause, COUNT(*) AS n, SUM(lost_margin) AS lm, SUM(lost_revenue) AS lr FROM sl_opps WHERE ' + w + ' GROUP BY 1 ORDER BY lm DESC',
            'WITH ' + PRICE + ' SELECT cm.month, SUM(cm.revenue) AS actual, SUM(cm.expected * p.price) AS expected, SUM(cm.margin) AS margin FROM sl_cm cm JOIN p USING (account_number, item_id) JOIN sl_customers c USING (account_number) LEFT JOIN sl_items i USING (item_id) WHERE ' + wci() + ' AND cm.month > ' + (L - 200) + ' GROUP BY 1 ORDER BY 1',
            // one figure per opportunity: what the user typed when they gave one, else the sales measured after the window
            "WITH f AS (SELECT opp_id, TRY_CAST(value AS DOUBLE) AS v FROM sl_feedback WHERE upper(outcome) IN ('WON', 'PARTIAL') AND TRY_CAST(value AS DOUBLE) IS NOT NULL) " +
            'SELECT COALESCE(SUM(COALESCE(f.v, r.recovered_revenue)), 0) AS rec FROM sl_recovered r FULL OUTER JOIN f USING (opp_id)',
            "SELECT COUNT(*) FILTER (WHERE upper(decision) = 'ACCEPTED') AS acc, COUNT(*) FILTER (WHERE upper(decision) = 'REJECTED') AS rej, COUNT(*) AS n, SUM(TRY_CAST(value AS DOUBLE)) FILTER (WHERE upper(outcome) IN ('WON', 'PARTIAL')) AS typed FROM sl_feedback",
            'SELECT COUNT(*) FILTER (WHERE c.risk_band = \'High\') AS hi, SUM(c.revenue_at_risk) AS rar FROM sl_customers c WHERE ' + wci().replace(/i\.profit_center = '[^']*'/, '1 = 1'),
            'SELECT COUNT(*) FILTER (WHERE risk >= 0.5) AS n, SUM(value_at_risk) AS v, COUNT(*) AS lines FROM sl_order_risk WHERE ' + SL.where({ pc: false, tier: false, rep: false }),
            'SELECT * FROM sl_opps WHERE ' + w + ' ORDER BY rank LIMIT 10',
            "SELECT c.account_number, c.customer_name, c.tier, c.revenue_12, s.risk, s.risk_band, s.revenue_at_risk, s.reasons FROM sl_customers c JOIN sl_cust_scores s USING (account_number) WHERE " + wci().replace(/i\.profit_center = '[^']*'/, '1 = 1') + ' ORDER BY s.risk DESC LIMIT 8',
            'SELECT profit_center, SUM(lost_margin) AS lm, COUNT(*) AS n FROM sl_opps WHERE ' + w + ' GROUP BY 1 ORDER BY 2 DESC LIMIT 12'
        ]), SL.host('salesLensSims', {}, 20000).catch(function () { return {}; })]).then(function (x) {
            var d = x[0], k = d[0][0] || {}, rec = d[3][0] || {}, fb = d[4][0] || {}, ar = d[5][0] || {}, orr = d[6][0] || {}, sims = (x[1] && x[1].sims) || [];
            var sim = sims[0];
            var recovered = +rec.rec || 0;
            el.innerHTML = '<div class="kpis">' +
                kpi('Missed revenue', SL.money(k.lr), windowText() + ' · ' + SL.n(k.n) + ' opportunities', '', 'Expected minus actual sales, valued at each customer\'s own price before the window') +
                kpi('Missed margin', SL.money(k.lm), 'gross margin of the missed sales') +
                kpi('Recoverable margin', SL.money(k.rm), 'after recoverability × confidence', 'good') +
                kpi('High priority', SL.n(k.hi), 'opportunities to act on first', 'warn') +
                kpi('Recovered so far', SL.money(recovered), SL.n(fb.acc || 0) + ' accepted · ' + SL.n(fb.rej || 0) + ' rejected', 'good', 'Sales after an accepted opportunity, above the window\'s rate, plus outcome values typed in') +
                kpi('Customers at risk', SL.n(ar.hi), SL.money(ar.rar) + ' revenue at risk (3 months)', 'bad') +
                kpi('Open lines at risk', SL.n(orr.n), SL.money(orr.v) + ' value at risk of ' + SL.n(orr.lines) + ' open lines') +
                kpi('Scenario uplift', sim ? SL.money((sim.delta || {}).margin) : '—', sim ? 'margin · ' + esc((sim.scenario || {}).name || 'last simulation') : 'run one in the Simulation Lab', '', 'The last simulation — an estimate') +
                '</div>' +
                '<div class="grid2"><div class="card"><h2><i class="fas fa-chart-line"></i> Sales: expected vs actual ' + tag('fact') + '</h2><div class="ch"><canvas id="c-trend"></canvas></div>' +
                '<p class="small muted">Expected = each customer × item\'s seasonal 12-month average, valued at its own price. The gap after the dashed line is what the worklist explains.</p></div>' +
                '<div class="card"><h2><i class="fas fa-magnifying-glass-chart"></i> Why sales were missed</h2><div class="ch"><canvas id="c-cause"></canvas></div></div></div>' +
                '<div class="grid2"><div class="card"><h2><i class="fas fa-list-ol"></i> Act first <span class="sp"></span><button class="btn sm" data-go="work">Worklist</button></h2><div id="d-top"></div></div>' +
                '<div class="card"><h2><i class="fas fa-user-clock"></i> Customers at risk ' + tag('pred') + '<span class="sp"></span><button class="btn sm" data-go="cust">Customers</button></h2><div id="d-risk"></div></div></div>' +
                '<div class="card"><h2><i class="fas fa-layer-group"></i> Missed margin by profit centre</h2><div class="ch sm"><canvas id="c-pc"></canvas></div></div>';
            el.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { SL.show(b.dataset.go); }; });
            var t = d[2], wfrom = ((SL.ref.summary || {}).window || [])[0];
            SL.chart('c-trend', {
                type: 'line', data: {
                    labels: t.map(function (r) { return SL.month(r.month); }), datasets: [
                        { label: 'Actual', data: t.map(function (r) { return Math.round(r.actual || 0); }), borderColor: '#c2410c', backgroundColor: 'rgba(194,65,12,.08)', fill: true, tension: .25 },
                        { label: 'Expected', data: t.map(function (r) { return r.expected == null ? null : Math.round(r.expected); }), borderColor: '#2563eb', borderDash: [6, 4], tension: .25 }]
                }, options: { scales: { y: { ticks: { callback: function (v) { return SL.money(v); } } } }, plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + SL.money(c.raw, true); } } }, annotation: {} } }
            });
            if (wfrom) { var wi = t.findIndex(function (r) { return +r.month === +wfrom; }); if (wi >= 0) el.querySelector('#c-trend').dataset.window = wi; }
            var c = d[1];
            SL.chart('c-cause', {
                type: 'bar', data: { labels: c.map(function (r) { return (SL.CAUSES[r.primary_cause] || [r.primary_cause])[0]; }), datasets: [{ label: 'Missed margin', data: c.map(function (r) { return Math.round(r.lm || 0); }), backgroundColor: c.map(function (r) { return (SL.CAUSES[r.primary_cause] || [0, '#94a3b8'])[1]; }) }] },
                options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (x) { var r = c[x.dataIndex]; return SL.money(r.lm, true) + ' margin · ' + r.n + ' opportunities'; } } } }, scales: { x: { ticks: { callback: function (v) { return SL.money(v); } } } } }
            });
            var pc = d[9];
            SL.chart('c-pc', { type: 'bar', data: { labels: pc.map(function (r) { return r.profit_center || '(none)'; }), datasets: [{ label: 'Missed margin', data: pc.map(function (r) { return Math.round(r.lm || 0); }), backgroundColor: '#c2410c' }] }, options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: function (v) { return SL.money(v); } } } } } });
            el.querySelector('#d-top').innerHTML = '<table class="t">' + d[7].map(function (o) {
                return '<tr class="click" data-opp="' + esc(o.opp_id) + '"><td>' + SL.pri(o.priority) + '</td><td><b>' + esc(o.customer) + '</b><div class="small muted">' + esc(o.item) + ' · ' + esc(o.description) + '</div></td><td>' + SL.cause(o.primary_cause) + '</td><td class="num"><b>' + SL.money(o.recoverable_margin) + '</b><div class="small muted">of ' + SL.money(o.lost_margin) + '</div></td></tr>';
            }).join('') + '</table>' || '<p class="muted">No opportunities in this filter.</p>';
            el.querySelector('#d-top').onclick = function (e) { var tr = e.target.closest('[data-opp]'); if (tr) V.opp(tr.dataset.opp); };
            el.querySelector('#d-risk').innerHTML = '<table class="t">' + d[8].map(function (r) {
                var why = SL.json(r.reasons, []).map(function (x) { return x.text; }).join('; ');
                return '<tr class="click" data-c="' + esc(r.account_number) + '"><td><b>' + esc(r.customer_name || r.account_number) + '</b><div class="small muted">' + esc(why) + '</div></td><td>' + riskPill(r.risk, r.risk_band) + '</td><td class="num">' + SL.money(r.revenue_at_risk) + '</td></tr>';
            }).join('') + '</table>';
            el.querySelector('#d-risk').onclick = function (e) { var tr = e.target.closest('[data-c]'); if (tr) V.c360(tr.dataset.c); };
        });
    };
    function riskPill(p, band) { return '<span class="risk ' + esc(String(band || '').toLowerCase()) + '">' + Math.round((+p || 0) * 100) + ' %</span>'; }

    // ── Worklist ──────────────────────────────────────────────────
    V.work = function (el) {
        var w = SL.where({ q: OPPQ });
        return SL.qs(['SELECT * FROM sl_opps WHERE ' + w + ' ORDER BY rank', 'SELECT opp_id, decision, outcome FROM sl_feedback']).then(function (d) {
            var fb = {}; d[1].forEach(function (r) { fb[r.opp_id] = r; });
            var rows = d[0].map(function (r) { var f = fb[r.opp_id] || {}; r.fb = (f.decision || r.fb_decision || '') + (f.outcome || r.fb_outcome ? ' · ' + (f.outcome || r.fb_outcome) : ''); return r; });
            el.innerHTML = '<div class="card"><h2><i class="fas fa-list-ol"></i> Opportunity worklist <span class="muted small">' + windowText() + ' · ranked by recoverable margin × urgency × account tier</span></h2>' +
                '<div class="chips" id="w-chips"></div><div id="w-grid"></div></div>';
            var chips = [['', 'All'], ['High', 'High priority'], ['STOCKOUT', 'Stock-out'], ['LATE', 'Late'], ['PRICE_UP', 'Price'], ['INACTIVE', 'Stopped buying'], ['open', 'No feedback yet']], cur = '';
            function paint() {
                var list = rows.filter(function (r) { return !cur || (cur === 'High' ? r.priority === 'High' : cur === 'open' ? !r.fb : r.primary_cause === cur); });
                SL.grid(el.querySelector('#w-grid'), {
                    name: 'sales-lens-worklist', rows: list, sort: 'rank', dir: 1, onRow: function (r) { V.opp(r.opp_id); },
                    cols: [{ k: 'rank', label: '#', num: true }, { k: 'priority', label: 'Priority', html: function (r) { return SL.pri(r.priority); } },
                    { k: 'customer', label: 'Customer', w: 160, html: function (r) { return '<b>' + esc(r.customer) + '</b><div class="small muted">' + esc(r.account_number) + ' · tier ' + esc(r.tier) + '</div>'; } },
                    { k: 'item', label: 'Item', w: 140, html: function (r) { return esc(r.item) + '<div class="small muted">' + esc(r.description) + '</div>'; } },
                    { k: 'primary_cause', label: 'Cause', html: function (r) { return SL.cause(r.primary_cause) + (r.secondary_cause ? ' <span class="small muted">+ ' + esc((SL.CAUSES[r.secondary_cause] || [r.secondary_cause])[0]) + '</span>' : ''); }, text: function (r) { return (SL.CAUSES[r.primary_cause] || [r.primary_cause])[0]; } },
                    { k: 'drop_pct', label: 'Drop', num: true, html: function (r) { return '−' + SL.pct(r.drop_pct); } },
                    { k: 'lost_revenue', label: 'Lost revenue', num: true, sum: true, html: function (r) { return SL.money(r.lost_revenue); } },
                    { k: 'lost_margin', label: 'Lost margin', num: true, sum: true, html: function (r) { return SL.money(r.lost_margin); } },
                    { k: 'recoverable_margin', label: 'Recoverable', num: true, sum: true, html: function (r) { return '<b>' + SL.money(r.recoverable_margin) + '</b>'; } },
                    { k: 'confidence', label: 'Confidence', num: true, html: function (r) { return SL.pct(r.confidence * 100); } },
                    { k: 'score', label: 'Score', num: true },
                    { k: 'action', label: 'Recommended action', w: 260, html: function (r) { return '<span class="small">' + esc(r.action) + '</span>'; } },
                    { k: 'owner', label: 'Owner', html: function (r) { return esc(r.owner) + (r.salesperson ? '<div class="small muted">' + esc(r.salesperson) + '</div>' : ''); } },
                    { k: 'due_date', label: 'Due' }, { k: 'fb', label: 'Feedback', html: function (r) { return r.fb ? '<span class="pill">' + esc(r.fb) + '</span>' : '<span class="muted small">—</span>'; } }]
                });
            }
            el.querySelector('#w-chips').innerHTML = chips.map(function (c) { return '<button class="chipb' + (c[0] === cur ? ' on' : '') + '" data-c="' + c[0] + '">' + c[1] + '</button>'; }).join('');
            el.querySelector('#w-chips').onclick = function (e) { var b = e.target.closest('[data-c]'); if (!b) return; cur = b.dataset.c; el.querySelectorAll('#w-chips .chipb').forEach(function (x) { x.classList.toggle('on', x === b); }); paint(); };
            paint();
        });
    };

    /** one opportunity: evidence, cause probabilities, expected vs actual, numbers, the action and the feedback form */
    V.opp = function (id) {
        SL.qs(['SELECT * FROM sl_opps WHERE opp_id = ' + SL.lit(id), 'SELECT * FROM sl_feedback WHERE opp_id = ' + SL.lit(id)]).then(function (d) {
            var o = d[0][0]; if (!o) { SL.toast('Not in the latest run any more', 'err'); return; }
            var fb = d[1][0] || {};
            var probs = SL.json(o.cause_probs, {});
            var body = SL.modal(o.customer + ' · ' + o.item, '<div class="opp">' +
                '<div class="kpis sm">' + kpi('Expected', SL.n(o.expected_qty), 'units in ' + windowText()) + kpi('Actual', SL.n(o.actual_qty), '−' + SL.pct(o.drop_pct) + ' · ' + SL.n(o.gap_qty) + ' short', 'bad') +
                kpi('Lost revenue', SL.money(o.lost_revenue), 'at ' + SL.money(o.base_price, true) + ' a unit') + kpi('Lost margin', SL.money(o.lost_margin), '') +
                kpi('Recoverable', SL.money(o.recoverable_margin), Math.round(o.recoverability * 100) + ' % recoverable × ' + Math.round(o.confidence * 100) + ' % confidence', 'good') + kpi('Priority', SL.pri(o.priority), 'score ' + o.score + ' · due ' + esc(o.due_date)) + '</div>' +
                '<div class="grid2"><div><h3>Evidence ' + tag('fact') + '</h3><ul class="ev">' + String(o.evidence || '').split('; ').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
                '<h3>Likely causes ' + tag('pred') + '</h3>' + Object.keys(probs).map(function (k) { var c = SL.CAUSES[k] || [k, '#94a3b8']; return '<div class="pbar"><span>' + esc(c[0]) + '</span><i style="--w:' + Math.round(probs[k] * 100) + '%;--c:' + c[1] + '"></i><b>' + Math.round(probs[k] * 100) + ' %</b></div>'; }).join('') +
                '<h3>Recommended action</h3><p class="act">' + esc(o.action) + '</p><p class="small muted">Owner: ' + esc(o.owner) + (o.salesperson ? ' · salesperson ' + esc(o.salesperson) : '') + (o.substitute ? ' · alternative item ' + esc(o.substitute) : '') + '</p></div>' +
                '<div><h3>Expected vs actual, month by month</h3><div class="ch"><canvas id="c-opp"></canvas></div><p class="small muted">Shaded = the expected range (90 %). Model ' + esc(o.model_version) + ', scored ' + esc(String(o.scored_at).replace('T', ' ')) + ', run ' + esc(o.run_id) + '.</p></div></div>' +
                '<h3>Feedback</h3><div class="fb">' +
                '<div class="seg" id="fb-dec">' + ['ACCEPTED', 'REJECTED'].map(function (x) { return '<button data-v="' + x + '" class="' + (fb.decision === x ? 'on' : '') + '">' + (x === 'ACCEPTED' ? '<i class="fas fa-check"></i> Accept' : '<i class="fas fa-xmark"></i> Reject') + '</button>'; }).join('') + '</div>' +
                '<input id="fb-reason" placeholder="Why (e.g. customer moved to a competitor, already ordered)" value="' + esc(fb.reason || '') + '">' +
                '<select id="fb-out"><option value="">Outcome…</option>' + [['WON', 'Won back'], ['PARTIAL', 'Partly won back'], ['LOST', 'Lost'], ['OPEN', 'Still working']].map(function (x) { return '<option value="' + x[0] + '"' + (fb.outcome === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>' +
                '<input id="fb-val" type="number" placeholder="Value won (' + esc(SL.cur) + ')" value="' + esc(fb.value || '') + '"><input id="fb-note" placeholder="Note" value="' + esc(fb.note || '') + '">' +
                '<button class="btn pri" id="fb-save"><i class="fas fa-floppy-disk"></i> Save feedback</button></div>' +
                (fb.at ? '<p class="small muted">Last feedback by ' + esc(fb.by) + ' on ' + esc(String(fb.at).replace('T', ' ')) + '</p>' : '') + '</div>', [{ label: 'Close' }], true);
            var dec = fb.decision || '';
            body.querySelector('#fb-dec').onclick = function (e) { var b = e.target.closest('[data-v]'); if (!b) return; dec = b.dataset.v; body.querySelectorAll('#fb-dec button').forEach(function (x) { x.classList.toggle('on', x === b); }); };
            body.querySelector('#fb-save').onclick = function () {
                if (!dec) { SL.toast('Accept or reject first', 'err'); return; }
                var row = { opp_id: o.opp_id, account_number: o.account_number, item: o.item, decision: dec, reason: body.querySelector('#fb-reason').value.trim(), outcome: body.querySelector('#fb-out').value,
                    value: body.querySelector('#fb-val').value || null, note: body.querySelector('#fb-note').value.trim() };
                SL.call('salesLensFeedback', { row: row }).then(function (r) {
                    SL.toast('Feedback saved on this PC');
                    return SL.apex.feedback(Object.assign({}, row, { at: (r.row || {}).at })).then(function () { SL.toast('… and in APEX'); }).catch(function (e) { SL.toast('Not in APEX: ' + e.message, 'err'); });
                }).then(function () { SL.close(); if (SL.current() === 'work') SL.show('work', true); }).catch(function (e) { SL.toast(e.message, 'err'); });
            };
            SL.q('SELECT month, qty, expected, lo, hi FROM sl_cm WHERE account_number = ' + SL.lit(o.account_number) + ' AND item_id = ' + SL.lit(o.item_id) + ' AND month > ' + (lf() - 200) + ' ORDER BY month').then(function (m) {
                SL.chart('c-opp', {
                    type: 'line', data: {
                        labels: m.map(function (r) { return SL.month(r.month); }), datasets: [
                            { label: 'High', data: m.map(function (r) { return r.hi; }), borderWidth: 0, pointRadius: 0, backgroundColor: 'rgba(37,99,235,.10)', fill: '+1' },
                            { label: 'Low', data: m.map(function (r) { return r.lo; }), borderWidth: 0, pointRadius: 0, fill: false },
                            { label: 'Expected', data: m.map(function (r) { return r.expected; }), borderColor: '#2563eb', borderDash: [6, 4], pointRadius: 0 },
                            { label: 'Bought', data: m.map(function (r) { return r.qty; }), borderColor: '#c2410c', backgroundColor: '#c2410c' }]
                    }, options: { plugins: { legend: { labels: { filter: function (l) { return l.text === 'Expected' || l.text === 'Bought'; } } } } }
                });
            });
        }).catch(function (e) { SL.toast(e.message, 'err'); });
    };

    // ── Customers ─────────────────────────────────────────────────
    V.cust = function (el) {
        var L = lf();
        return SL.q('SELECT c.account_number, c.customer_name, c.customer_class, c.tier, c.bu_id, c.salesperson, c.revenue_12, s.risk, s.risk_band, s.revenue_at_risk, s.rev_trend, s.recency, s.overdue, s.reasons, o.n, o.lm, o.rm, x.n_x ' +
            'FROM sl_customers c LEFT JOIN sl_cust_scores s USING (account_number) LEFT JOIN (SELECT account_number, COUNT(*) AS n, SUM(lost_margin) AS lm, SUM(recoverable_margin) AS rm FROM sl_opps GROUP BY 1) o USING (account_number) ' +
            'LEFT JOIN (SELECT account_number, COUNT(*) AS n_x FROM sl_xsell GROUP BY 1) x USING (account_number) ' +
            'WHERE ' + wci(['c.customer_name', 'c.account_number']).replace(/i\.profit_center = '[^']*'/, '1 = 1') + ' AND (c.revenue_12 > 0 OR o.n > 0)').then(function (rows) {
                el.innerHTML = '<div class="card"><h2><i class="fas fa-users"></i> Customers <span class="muted small">risk = the chance spending falls ' + esc((SL.settings.churnDropPct || 50)) + ' %+ in the next 3 months ' + tag('pred') + '</span></h2><div id="c-grid"></div></div>';
                SL.grid(el.querySelector('#c-grid'), {
                    name: 'sales-lens-customers', rows: rows, sort: 'risk', onRow: function (r) { V.c360(r.account_number); },
                    cols: [{ k: 'customer_name', label: 'Customer', w: 180, html: function (r) { return '<b>' + esc(r.customer_name || r.account_number) + '</b><div class="small muted">' + esc(r.account_number) + ' · ' + esc(r.customer_class || '') + '</div>'; } },
                    { k: 'tier', label: 'Tier' }, { k: 'salesperson', label: 'Salesperson' },
                    { k: 'revenue_12', label: 'Revenue 12 m', num: true, sum: true, html: function (r) { return SL.money(r.revenue_12); } },
                    { k: 'rev_trend', label: 'Trend 3 m', num: true, html: function (r) { return r.rev_trend == null ? '' : '<span class="' + (r.rev_trend < -0.1 ? 'r' : r.rev_trend > 0.1 ? 'g' : '') + '">' + (r.rev_trend > 0 ? '+' : '') + Math.round(r.rev_trend * 100) + ' %</span>'; } },
                    { k: 'risk', label: 'Risk', num: true, html: function (r) { return r.risk == null ? '' : riskPill(r.risk, r.risk_band); } },
                    { k: 'revenue_at_risk', label: 'At risk', num: true, sum: true, html: function (r) { return SL.money(r.revenue_at_risk); } },
                    { k: 'reasons', label: 'Why', w: 220, html: function (r) { return '<span class="small">' + esc(SL.json(r.reasons, []).map(function (x) { return x.text; }).join('; ')) + '</span>'; }, text: function (r) { return SL.json(r.reasons, []).map(function (x) { return x.text; }).join('; '); } },
                    { k: 'n', label: 'Opportunities', num: true }, { k: 'lm', label: 'Missed margin', num: true, sum: true, html: function (r) { return SL.money(r.lm); } },
                    { k: 'overdue', label: 'Overdue', num: true, html: function (r) { return r.overdue ? SL.money(r.overdue) : ''; } }, { k: 'n_x', label: 'Cross-sell', num: true }]
                });
                void L;
            });
    };

    /** Customer 360: expected vs actual, products bought / dropped / slowing, margins, delays, returns, risk, recommendations */
    V.c360 = function (acct) {
        var L = lf(), A = SL.lit(acct);
        SL.qs(['SELECT c.*, s.* EXCLUDE (account_number) FROM sl_customers c LEFT JOIN sl_cust_scores s USING (account_number) WHERE c.account_number = ' + A,
            'WITH ' + PRICE + ' SELECT cm.month, SUM(cm.revenue) AS rev, SUM(cm.expected * p.price) AS exp, SUM(cm.margin) AS mar, SUM(cm.cancel_value) AS canc, SUM(cm.return_value) AS ret FROM sl_cm cm JOIN p USING (account_number, item_id) WHERE cm.account_number = ' + A + ' AND cm.month > ' + (L - 200) + ' GROUP BY 1 ORDER BY 1',
            'SELECT i.item_number, i.description, i.profit_center, SUM(CASE WHEN cm.month > ' + (L - 100) + ' THEN cm.revenue END) AS r12, SUM(CASE WHEN cm.month <= ' + (L - 100) + ' AND cm.month > ' + (L - 200) + ' THEN cm.revenue END) AS p12, ' +
            'SUM(CASE WHEN cm.month > ' + (L - 100) + ' THEN cm.margin END) AS m12, MAX(CASE WHEN cm.qty > 0 THEN cm.month END) AS last_month FROM sl_cm cm LEFT JOIN sl_items i USING (item_id) WHERE cm.account_number = ' + A + ' GROUP BY 1, 2, 3 ORDER BY r12 DESC NULLS LAST',
            'SELECT * FROM sl_opps WHERE account_number = ' + A + ' ORDER BY rank',
            'SELECT * FROM sl_xsell WHERE account_number = ' + A + ' ORDER BY score DESC',
            'SELECT * FROM sl_order_risk WHERE account_number = ' + A + ' ORDER BY risk DESC',
            'SELECT COUNT(*) FILTER (WHERE done) AS done, AVG(late_days) FILTER (WHERE done AND late_days > 0) AS late_avg, AVG(CASE WHEN late_days > ' + (+SL.settings.lateDays || 2) + ' THEN 1.0 ELSE 0 END) FILTER (WHERE done AND late_days IS NOT NULL) AS late_share, ' +
            'AVG(CASE WHEN partial THEN 1.0 ELSE 0 END) FILTER (WHERE done) AS partial_share, SUM(return_value) AS ret, SUM(cancel_value) AS canc, SUM(revenue) AS rev, SUM(margin) AS mar, COUNT(DISTINCT header_id) AS orders FROM sl_lines WHERE account_number = ' + A + ' AND month > ' + (L - 100)
        ]).then(function (d) {
            var c = d[0][0] || { account_number: acct }, st = d[6][0] || {};
            var reasons = SL.json(c.reasons, []);
            var prods = d[2].map(function (p) {
                p.trend = !p.p12 && p.r12 ? 'NEW' : p.p12 && !p.r12 ? 'DROPPED' : p.last_month && +p.last_month < L - 2 ? 'NOT LATELY' : p.p12 ? ((p.r12 - p.p12) / Math.abs(p.p12) <= -0.2 ? 'SLOWING' : (p.r12 - p.p12) / Math.abs(p.p12) >= 0.2 ? 'GROWING' : 'STEADY') : '';
                return p;
            });
            var body = SL.modal('Customer 360 · ' + (c.customer_name || acct), '<div class="kpis sm">' +
                kpi('Revenue 12 m', SL.money(st.rev), SL.n(st.orders) + ' orders · tier ' + esc(c.tier || '')) +
                kpi('Margin 12 m', SL.money(st.mar), st.rev ? SL.pct(st.mar / st.rev * 100, 1) : '') +
                kpi('Risk of buying less', c.risk == null ? '—' : riskPill(c.risk, c.risk_band), reasons.map(function (x) { return esc(x.text); }).join(' · '), c.risk_band === 'High' ? 'bad' : '') +
                kpi('Missed (window)', SL.money(d[3].reduce(function (a, o) { return a + (+o.lost_margin || 0); }, 0)), d[3].length + ' opportunity(ies) · margin') +
                kpi('Deliveries', st.late_share == null ? '—' : SL.pct(st.late_share * 100) + ' late', st.late_avg ? SL.n(st.late_avg, 1) + ' days on average · ' + SL.pct((st.partial_share || 0) * 100) + ' partial' : '') +
                kpi('Returns & cancels', SL.money((+st.ret || 0) + (+st.canc || 0)), SL.money(st.ret) + ' returned · ' + SL.money(st.canc) + ' cancelled') +
                kpi('Overdue', SL.money(c.overdue || 0), c.over90 ? SL.money(c.over90) + ' over 90 days' : '', c.over90 ? 'bad' : '') + '</div>' +
                '<div class="grid2"><div><h3>Expected vs actual ' + tag('fact') + '</h3><div class="ch"><canvas id="c-360"></canvas></div></div>' +
                '<div><h3>Opportunities ' + tag('pred') + '</h3>' + (d[3].length ? '<table class="t">' + d[3].map(function (o) { return '<tr class="click" data-opp="' + esc(o.opp_id) + '"><td>' + SL.pri(o.priority) + '</td><td>' + esc(o.item) + '<div class="small muted">' + esc(o.description) + '</div></td><td>' + SL.cause(o.primary_cause) + '</td><td class="num">' + SL.money(o.lost_margin) + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">No missed sales flagged.</p>') +
                '<h3>Could also buy ' + tag('pred') + '</h3>' + (d[4].length ? '<table class="t">' + d[4].map(function (x) { return '<tr><td><b>' + esc(x.item) + '</b><div class="small muted">' + esc(x.description) + '</div></td><td class="small">' + esc(x.reason) + '</td><td class="num">~' + SL.money(x.monthly_value) + '/month</td></tr>'; }).join('') + '</table>' : '<p class="muted">Nothing stands out.</p>') + '</div></div>' +
                '<h3>Products — last 12 months vs the 12 before</h3><div id="c360-p"></div>' +
                (d[5].length ? '<h3>Open order lines at risk ' + tag('pred') + '</h3><table class="t">' + d[5].slice(0, 12).map(function (r) { return '<tr><td>' + esc(r.order_number) + '</td><td>' + esc(r.item_number) + '</td><td>' + riskPill(r.risk, r.risk >= 0.6 ? 'high' : r.risk >= 0.35 ? 'medium' : 'low') + ' ' + esc(r.main_risk) + '</td><td class="small">' + esc(SL.json(r['why_' + r.main_risk], []).map(function (x) { return x.text; }).join('; ')) + '</td></tr>'; }).join('') + '</table>' : ''), [{ label: 'Close' }], true);
            body.addEventListener('click', function (e) { var tr = e.target.closest('[data-opp]'); if (tr) V.opp(tr.dataset.opp); });
            SL.grid(body.querySelector('#c360-p'), {
                name: 'customer-' + acct + '-products', rows: prods, sort: 'r12', limit: 50,
                cols: [{ k: 'item_number', label: 'Item' }, { k: 'description', label: 'Description' }, { k: 'profit_center', label: 'Profit centre' },
                { k: 'r12', label: '12 m', num: true, sum: true, html: function (r) { return SL.money(r.r12); } }, { k: 'p12', label: '12 before', num: true, sum: true, html: function (r) { return SL.money(r.p12); } },
                { k: 'm12', label: 'Margin', num: true, html: function (r) { return r.r12 ? SL.pct(r.m12 / r.r12 * 100, 1) : ''; } }, { k: 'last_month', label: 'Last bought', text: function (r) { return SL.month(r.last_month); } },
                { k: 'trend', label: 'Trend', html: function (r) { return '<span class="pill ' + ({ DROPPED: 'bad', SLOWING: 'warn', 'NOT LATELY': 'warn', GROWING: 'good', NEW: 'good' }[r.trend] || '') + '">' + esc(r.trend) + '</span>'; } }]
            });
            var m = d[1];
            SL.chart('c-360', {
                type: 'bar', data: {
                    labels: m.map(function (r) { return SL.month(r.month); }), datasets: [
                        { type: 'line', label: 'Expected', data: m.map(function (r) { return r.exp == null ? null : Math.round(r.exp); }), borderColor: '#2563eb', borderDash: [6, 4], pointRadius: 0 },
                        { label: 'Revenue', data: m.map(function (r) { return Math.round(r.rev || 0); }), backgroundColor: '#c2410c' },
                        { label: 'Cancelled', data: m.map(function (r) { return Math.round(r.canc || 0); }), backgroundColor: '#fca5a5' }]
                }, options: { scales: { x: { stacked: true }, y: { stacked: false, ticks: { callback: function (v) { return SL.money(v); } } } } }
            });
        }).catch(function (e) { SL.toast(e.message, 'err'); });
    };

    // ── Products ──────────────────────────────────────────────────
    V.prod = function (el) {
        var L = lf(), wo = SL.where({ q: OPPQ });
        var wi = ['1 = 1']; if (SL.f.pc) wi.push('i.profit_center = ' + SL.lit(SL.f.pc));
        if (SL.f.q) SL.f.q.toLowerCase().split(/\s+/).filter(Boolean).forEach(function (x) { wi.push('(lower(i.item_number) LIKE ' + SL.lit('%' + x + '%') + ' OR lower(i.description) LIKE ' + SL.lit('%' + x + '%') + ')'); });
        return SL.q('WITH x AS (SELECT item_id, SUM(CASE WHEN month > ' + (L - 100) + ' THEN revenue END) AS r12, SUM(CASE WHEN month <= ' + (L - 100) + ' AND month > ' + (L - 200) + ' THEN revenue END) AS p12, ' +
            'SUM(CASE WHEN month > ' + (L - 100) + ' THEN margin END) AS m12, SUM(CASE WHEN month > ' + (L - 100) + ' THEN cancel_value END) AS canc, COUNT(DISTINCT CASE WHEN month > ' + (L - 100) + ' AND qty > 0 THEN account_number END) AS buyers FROM sl_cm GROUP BY 1), ' +
            'o AS (SELECT item_id, COUNT(*) AS n, SUM(lost_revenue) AS lr, SUM(lost_margin) AS lm, SUM(CASE WHEN primary_cause = \'STOCKOUT\' THEN lost_revenue END) AS so FROM sl_opps WHERE ' + wo + ' GROUP BY 1) ' +
            'SELECT i.item_id, i.item_number, i.description, i.profit_center, i.supplier, i.abc, x.r12, x.p12, x.m12, x.canc, x.buyers, o.n, o.lr, o.lm, o.so, p.used AS elasticity, p.source AS el_source ' +
            'FROM sl_items i LEFT JOIN x USING (item_id) LEFT JOIN o USING (item_id) LEFT JOIN sl_price p USING (item_id) WHERE (x.r12 > 0 OR o.n > 0) AND ' + wi.join(' AND ')).then(function (rows) {
                el.innerHTML = '<div class="card"><h2><i class="fas fa-box"></i> Products <span class="muted small">demand trend, the loss from stock-outs, customers buying less, price response</span></h2><div id="p-grid"></div></div>';
                SL.grid(el.querySelector('#p-grid'), {
                    name: 'sales-lens-products', rows: rows, sort: 'lm', onRow: function (r) { V.product(r.item_id); },
                    cols: [{ k: 'item_number', label: 'Item', html: function (r) { return '<b>' + esc(r.item_number) + '</b><div class="small muted">' + esc(r.description) + '</div>'; } },
                    { k: 'profit_center', label: 'Profit centre' }, { k: 'abc', label: 'ABC' },
                    { k: 'r12', label: 'Revenue 12 m', num: true, sum: true, html: function (r) { return SL.money(r.r12); } },
                    { k: 'trend', label: 'vs 12 before', num: true, csv: function (r) { return r.p12 ? (r.r12 - r.p12) / Math.abs(r.p12) : ''; }, html: function (r) { if (!r.p12) return ''; var t = (r.r12 - r.p12) / Math.abs(r.p12) * 100; return '<span class="' + (t < -10 ? 'r' : t > 10 ? 'g' : '') + '">' + (t > 0 ? '+' : '') + Math.round(t) + ' %</span>'; } },
                    { k: 'm12', label: 'Margin %', num: true, html: function (r) { return r.r12 ? SL.pct(r.m12 / r.r12 * 100, 1) : ''; } }, { k: 'buyers', label: 'Buyers', num: true },
                    { k: 'n', label: 'Buying less', num: true, tip: 'customers flagged with a missed opportunity on this item' },
                    { k: 'lm', label: 'Missed margin', num: true, sum: true, html: function (r) { return SL.money(r.lm); } },
                    { k: 'so', label: 'Stock-out loss', num: true, sum: true, html: function (r) { return r.so ? '<span class="r">' + SL.money(r.so) + '</span>' : ''; } },
                    { k: 'canc', label: 'Cancelled 12 m', num: true, html: function (r) { return SL.money(r.canc); } },
                    { k: 'elasticity', label: 'Price response', num: true, html: function (r) { return r.elasticity == null ? '' : (+r.elasticity).toFixed(2) + (String(r.el_source).indexOf('assumed') === 0 ? ' <span class="small muted">assumed</span>' : ''); }, tip: '% change in quantity for 1 % change in price' }]
                });
            });
    };

    V.product = function (itemId) {
        var L = lf(), I = SL.lit(itemId);
        SL.qs(['SELECT i.*, p.* EXCLUDE (item_id, item) FROM sl_items i LEFT JOIN sl_price p USING (item_id) WHERE i.item_id = ' + I,
            'SELECT month, SUM(qty) AS qty, SUM(expected) AS exp, SUM(revenue) AS rev, SUM(cancel_qty) AS canc, SUM(oos_cancel) AS oos, SUM(revenue) / NULLIF(SUM(qty), 0) AS price, (SUM(list_value) - SUM(revenue)) / NULLIF(SUM(list_value), 0) * 100 AS disc FROM sl_cm WHERE item_id = ' + I + ' AND month > ' + (L - 200) + ' GROUP BY 1 ORDER BY 1',
            'SELECT * FROM sl_opps WHERE item_id = ' + I + ' AND ' + SL.where({ pc: false }) + ' ORDER BY lost_margin DESC',
            'SELECT c.bu_id, b.bu_name, SUM(CASE WHEN cm.month > ' + (L - 100) + ' THEN cm.revenue END) AS r12, SUM(CASE WHEN cm.month <= ' + (L - 100) + ' AND cm.month > ' + (L - 200) + ' THEN cm.revenue END) AS p12 FROM sl_cm cm JOIN sl_customers c USING (account_number) LEFT JOIN sl_bus b ON CAST(b.bu_id AS VARCHAR) = c.bu_id WHERE cm.item_id = ' + I + ' GROUP BY 1, 2 ORDER BY 3 DESC NULLS LAST',
            "SELECT day, SUM(TRY_CAST(qty AS DOUBLE)) AS qty FROM sl_onhand WHERE item_id = " + I + " OR item_id = " + I + " || '.0' GROUP BY 1 ORDER BY 1 DESC LIMIT 1"
        ]).then(function (d) {
            var it = d[0][0] || {}, m = d[1], oh = d[4][0];
            var body = SL.modal('Product · ' + (it.item_number || itemId) + ' ' + (it.description || ''), '<div class="kpis sm">' +
                kpi('Revenue 12 m', SL.money(it.revenue_12), 'ABC ' + esc(it.abc || '') + ' · ' + esc(it.profit_center || '')) +
                kpi('Customers buying less', SL.n(d[2].length), SL.money(d[2].reduce(function (a, o) { return a + (+o.lost_margin || 0); }, 0)) + ' missed margin', d[2].length ? 'warn' : '') +
                kpi('Stock-out loss', SL.money(d[2].filter(function (o) { return o.primary_cause === 'STOCKOUT'; }).reduce(function (a, o) { return a + (+o.lost_revenue || 0); }, 0)), 'lost revenue where stock was the cause', 'bad') +
                kpi('On hand', oh ? SL.n(oh.qty) : '—', oh ? 'snapshot ' + esc(oh.day) : 'no snapshot yet') +
                kpi('Price response', it.used == null ? '—' : (+it.used).toFixed(2), it.source === 'estimated' ? 'estimated from ' + it.obs + ' customer-months (raw ' + (+it.elasticity).toFixed(2) + ' ± ' + (+it.se).toFixed(2) + ')' : 'assumed — the price hardly changed', '', '% change in quantity for 1 % change in price') + '</div>' +
                '<div class="grid2"><div><h3>Demand: expected vs actual ' + tag('fact') + '</h3><div class="ch"><canvas id="c-p1"></canvas></div></div>' +
                '<div><h3>Net price and discount</h3><div class="ch"><canvas id="c-p2"></canvas></div></div></div>' +
                '<div class="grid2"><div><h3>Customers buying less ' + tag('pred') + '</h3>' + (d[2].length ? '<table class="t">' + d[2].slice(0, 25).map(function (o) { return '<tr class="click" data-opp="' + esc(o.opp_id) + '"><td><b>' + esc(o.customer) + '</b></td><td>' + SL.cause(o.primary_cause) + '</td><td class="num">−' + SL.pct(o.drop_pct) + '</td><td class="num">' + SL.money(o.lost_margin) + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">None flagged.</p>') + '</div>' +
                '<div><h3>By business unit</h3><table class="t">' + d[3].map(function (r) { var t = r.p12 ? (r.r12 - r.p12) / Math.abs(r.p12) * 100 : null; return '<tr><td>' + esc(r.bu_name || r.bu_id || '—') + '</td><td class="num">' + SL.money(r.r12) + '</td><td class="num ' + (t != null && t < -10 ? 'r' : '') + '">' + (t == null ? '' : (t > 0 ? '+' : '') + Math.round(t) + ' %') + '</td></tr>'; }).join('') + '</table></div></div>', [{ label: 'Close' }], true);
            body.addEventListener('click', function (e) { var tr = e.target.closest('[data-opp]'); if (tr) V.opp(tr.dataset.opp); });
            SL.chart('c-p1', {
                type: 'bar', data: {
                    labels: m.map(function (r) { return SL.month(r.month); }), datasets: [
                        { type: 'line', label: 'Expected', data: m.map(function (r) { return r.exp == null ? null : Math.round(r.exp); }), borderColor: '#2563eb', borderDash: [6, 4], pointRadius: 0 },
                        { label: 'Sold', data: m.map(function (r) { return Math.round(r.qty || 0); }), backgroundColor: '#c2410c', stack: 's' },
                        { label: 'Cancelled for stock', data: m.map(function (r) { return Math.round(r.oos || 0); }), backgroundColor: '#dc2626', stack: 's' },
                        { label: 'Other cancellations', data: m.map(function (r) { return Math.max(0, Math.round((r.canc || 0) - (r.oos || 0))); }), backgroundColor: '#fca5a5', stack: 's' }]
                }, options: { scales: { x: { stacked: true }, y: { stacked: true } } }
            });
            SL.chart('c-p2', {
                type: 'line', data: {
                    labels: m.map(function (r) { return SL.month(r.month); }), datasets: [
                        { label: 'Net price', data: m.map(function (r) { return r.price == null ? null : +(+r.price).toFixed(2); }), borderColor: '#7c3aed', yAxisID: 'y' },
                        { label: 'Discount %', data: m.map(function (r) { return r.disc == null ? null : +(+r.disc).toFixed(1); }), borderColor: '#0891b2', borderDash: [4, 3], yAxisID: 'y1' }]
                }, options: { scales: { y: { position: 'left' }, y1: { position: 'right', grid: { drawOnChartArea: false } } } }
            });
        }).catch(function (e) { SL.toast(e.message, 'err'); });
    };

    // ── Order risk ────────────────────────────────────────────────
    V.risk = function (el) {
        var w = SL.where({ pc: false, tier: false, rep: false, q: ['order_number', 'account_number', 'item_number'] });
        return SL.qs(['SELECT r.*, c.customer_name FROM sl_order_risk r LEFT JOIN sl_customers c USING (account_number) WHERE ' + w.replace(/(^|\s)bu_id/g, '$1r.bu_id') + ' ORDER BY value_at_risk DESC',
            "SELECT model, method, metrics, base_rate FROM sl_models WHERE model LIKE 'order_%'"]).then(function (d) {
                var rows = d[0], models = {}; d[1].forEach(function (m) { models[m.model] = m; });
                function mtxt(k) { var m = models['order_' + k]; if (!m) return ''; var mt = SL.json(m.metrics, {}); return esc(m.method) + (mt.roc_auc ? ' · AUC ' + (+mt.roc_auc).toFixed(2) : '') + (m.base_rate != null ? ' · base rate ' + SL.pct(m.base_rate * 100) : ''); }
                var hi = rows.filter(function (r) { return r.risk >= 0.5; });
                el.innerHTML = '<div class="kpis">' + kpi('Open lines', SL.n(rows.length), SL.money(rows.reduce(function (a, r) { return a + (+r.revenue || 0); }, 0)) + ' open value') +
                    kpi('At risk (≥ 50 %)', SL.n(hi.length), SL.money(hi.reduce(function (a, r) { return a + (+r.value_at_risk || 0); }, 0)) + ' value at risk', 'bad') +
                    kpi('Late', SL.n(rows.filter(function (r) { return r.main_risk === 'late' && r.risk >= 0.5; }).length), mtxt('late')) +
                    kpi('Cancelled', SL.n(rows.filter(function (r) { return r.main_risk === 'cancel' && r.risk >= 0.5; }).length), mtxt('cancel')) +
                    kpi('Partly shipped', SL.n(rows.filter(function (r) { return r.main_risk === 'partial' && r.risk >= 0.5; }).length), mtxt('partial')) + '</div>' +
                    '<div class="card"><h2><i class="fas fa-truck-fast"></i> Open order lines at risk ' + tag('pred') + '<span class="muted small">each score with its top reasons — trained on finished lines of the last 18 months</span></h2><div id="r-grid"></div></div>';
                function why(r) { return SL.json(r['why_' + r.main_risk], []).map(function (x) { return x.text; }).join('; '); }
                SL.grid(el.querySelector('#r-grid'), {
                    name: 'sales-lens-order-risk', rows: rows, sort: 'value_at_risk',
                    cols: [{ k: 'order_number', label: 'Order' }, { k: 'ordered_date', label: 'Ordered' }, { k: 'promised', label: 'Promised' },
                    { k: 'customer_name', label: 'Customer', html: function (r) { return '<b>' + esc(r.customer_name || r.account_number) + '</b>'; } },
                    { k: 'item_number', label: 'Item' }, { k: 'qty', label: 'Qty', num: true },
                    { k: 'revenue', label: 'Value', num: true, sum: true, html: function (r) { return SL.money(r.revenue); } },
                    { k: 'p_late', label: 'Late', num: true, html: function (r) { return SL.pct(r.p_late * 100); } },
                    { k: 'p_cancel', label: 'Cancel', num: true, html: function (r) { return SL.pct(r.p_cancel * 100); } },
                    { k: 'p_partial', label: 'Partial', num: true, html: function (r) { return SL.pct(r.p_partial * 100); } },
                    { k: 'value_at_risk', label: 'Value at risk', num: true, sum: true, html: function (r) { return '<b>' + SL.money(r.value_at_risk) + '</b>'; } },
                    { k: 'why', label: 'Why', w: 240, text: why, html: function (r) { return '<span class="small">' + esc(why(r)) + '</span>'; } },
                    { k: 'action', label: 'What to do', w: 220, html: function (r) { return '<span class="small">' + esc(r.action) + '</span>'; } }]
                });
            });
    };
})();
