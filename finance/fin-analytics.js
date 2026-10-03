/* Finance Lens — Overview (the CFO cockpit) and Analytics: trends + forecast, variance bridges and movers, cost centres
   against budget, companies with intercompany elimination, ratios, common-size statements, what-if, anomalies. */
(function () {
    var T = function () { return FL.tplMap(); };
    var rowOf = function (st, id) { return st.rows.filter(function (r) { return r.id === id; })[0]; };
    var colIx = function (st, id) { return st.columns.map(function (c) { return c.id; }).indexOf(id); };

    /** Monthly values of some rows of a template over the last n periods, for one column definition → {labels, seqs, series} */
    FL.monthly = function (data, tpl, ids, col, n, endSeq) {
        var pi = data._pi || (data._pi = FINE.periodIndex(data.periods)), i = pi.bySeq[endSeq || FL.filter.period], out = { labels: [], seqs: [], series: {} };
        ids.forEach(function (id) { out.series[id] = []; });
        for (var k = Math.max(0, i - n + 1); k <= i; k++) {
            var p = pi.list[k], st = FINE.compute(tpl, data, { period: p.period_seq, scale: 1, columns: [Object.assign({ id: 'x' }, col)] });
            out.labels.push(p.period_name); out.seqs.push(p.period_seq);
            ids.forEach(function (id) { var r = rowOf(st, id); out.series[id].push(r ? r.values[0] : null); });
        }
        return out;
    };

    // ═════════ Overview ═════════
    FL.TABS.overview = {
        render: function (el) {
            return FL.data().then(function (data) {
                var cfg = FL.config, tm = T(), per = FL.filter.period;
                var kv = FINE.kpis(cfg.kpis, tm, data, per), mon = FINE.monitor(cfg.monitors, kv);
                var head = cfg.headline.map(function (id) { return cfg.kpis.filter(function (k) { return k.id === id; })[0]; }).filter(Boolean);
                var trend = FINE.kpiTrend(cfg.kpis, tm, data, per, 12);      // all of them: some KPIs use others (cash cycle = DSO + DIO − DPO)
                var status = {}; mon.forEach(function (m) { if (m.status === 'breach' || !status[m.rule.kpi]) status[m.rule.kpi] = m.status; });
                var breaches = mon.filter(function (m) { return m.status === 'breach'; });
                var pl = tm.PL ? FINE.compute(tm.PL, data, { period: per, scale: 1 }) : null;
                var story = [];
                if (pl && colIx(pl, 'm_act') >= 0) story = story.concat(FINE.narrative(pl, 'm_act', 'm_bud', { keyRows: ['REV', 'EBITDA', 'NP'], top: 3, fmt: FL.compact }).map(function (x) { x.text = 'Month vs budget: ' + x.text; return x; }));
                if (pl && colIx(pl, 'y_py') >= 0) story = story.concat(FINE.narrative(pl, 'y_act', 'y_py', { keyRows: ['REV', 'NP'], top: 2, fmt: FL.compact }).map(function (x) { x.text = 'YTD vs last year: ' + x.text; return x; }));
                var anom = FINE.anomalies(data, per, { z: 3.5 }).slice(0, 3);
                anom.forEach(function (a) { story.push({ tone: 'bad', text: 'Unusual this month: ' + a.code + ' ' + a.name + ' ' + FL.compact(a.value) + ' vs a typical ' + FL.compact(a.typical) + ' (' + a.z.toFixed(1) + ' σ)' }); });
                breaches.slice(0, 4).forEach(function (b) { story.push({ tone: 'bad', text: 'Monitor: ' + b.rule.label + ' — now ' + FL.kfmt(b.value, (cfg.kpis.filter(function (k) { return k.id === b.rule.kpi; })[0] || {}).fmt) }); });

                el.innerHTML = '<div class="row" style="margin-bottom:10px"><h2 style="margin:0;font-size:1.1rem">CFO overview · ' + esc(FL.periodName(per)) + '</h2><span class="muted sm">' + esc(FL.filterText()) + '</span><span class="grow"></span>' +
                    (breaches.length ? '<span class="tag bad">' + breaches.length + ' monitor alert' + (breaches.length > 1 ? 's' : '') + '</span>' : '<span class="tag good">all monitors OK</span>') + '</div>' +
                    '<div class="kpis" id="ov-kpis">' + head.map(function (k, i) {
                        var v = kv[k.id].value, tr = trend[k.id].map(function (x) { return x.value; }), prev = tr.length > 1 ? tr[tr.length - 2] : null;
                        var d = v != null && prev != null ? v - prev : null, good = d == null ? null : (k.good === 'down' ? d <= 0 : d >= 0);
                        return '<div class="kpi" data-k="' + esc(k.id) + '" title="' + esc((k.desc || '') + '\n' + k.expr) + '"><span class="dot ' + (status[k.id] || '') + '"></span><div class="k-l">' + esc(k.label) + '</div><div class="k-v">' + FL.kfmt(v, k.fmt) + '</div>' +
                            '<div class="k-d ' + (good == null ? 'muted' : good ? 'pos' : 'neg') + '">' + (d == null ? '&nbsp;' : FL.kdelta(d, k.fmt) + ' vs last month') + '</div><canvas id="sp' + i + '"></canvas></div>';
                    }).join('') + '</div>' +
                    '<div class="grid g3" style="margin-top:12px"><div class="card" style="grid-column:span 2"><h3><i class="fa-solid fa-chart-column"></i> Revenue and net profit <small>24 months, ' + esc(FL.filterText()) + '</small></h3><div class="chartbox"><canvas id="ov-rev"></canvas></div></div>' +
                    '<div class="card"><h3><i class="fa-solid fa-comment-dots"></i> What happened</h3><ul class="story">' + (story.length ? story.map(function (s) { return '<li class="' + s.tone + '">' + esc(s.text) + '</li>'; }).join('') : '<li>Nothing unusual.</li>') + '</ul></div></div>' +
                    '<div class="grid g3" style="margin-top:12px"><div class="card"><h3><i class="fa-solid fa-percent"></i> Margins</h3><div class="chartbox short"><canvas id="ov-mg"></canvas></div></div>' +
                    '<div class="card"><h3><i class="fa-solid fa-stairs"></i> Net profit bridge <small>YTD last year → this year</small></h3><div class="chartbox short"><canvas id="ov-br"></canvas></div></div>' +
                    '<div class="card"><h3><i class="fa-solid fa-coins"></i> Cash and working capital</h3><div class="chartbox short"><canvas id="ov-cash"></canvas></div></div></div>' +
                    '<div class="grid g2" style="margin-top:12px"><div class="card"><h3><i class="fa-solid fa-chart-pie"></i> Operating expenses YTD</h3><div class="chartbox short"><canvas id="ov-opex"></canvas></div></div>' +
                    '<div class="card"><h3><i class="fa-solid fa-arrow-trend-up"></i> Biggest movements <small>YTD vs last year, income statement accounts</small></h3><div class="scroll" style="max-height:220px" id="ov-mov"></div></div></div>';

                head.forEach(function (k, i) { var vals = trend[k.id].map(function (x) { return x.value; }); FL.spark('sp' + i, vals, k.good === 'down' ? '#0d9488' : FL.PAL.act); });
                el.querySelectorAll('.kpi').forEach(function (c) { c.onclick = function () { FL.kpiModal(c.dataset.k); }; });
                if (!tm.PL) return;
                var m = FL.monthly(data, tm.PL, ['REV', 'NP', 'GM', 'EBITDAM', 'NPM'], { scenario: 'ACTUAL', range: 'MTD' }, 24);
                var b = FL.monthly(data, tm.PL, ['REV'], { scenario: 'BUDGET', range: 'MTD' }, 24);
                FL.chart('ov-rev', { data: { labels: m.labels, datasets: [
                    { type: 'bar', label: 'Revenue', data: m.series.REV, backgroundColor: 'rgba(29,78,216,.75)', borderRadius: 3, order: 2 },
                    { type: 'line', label: 'Budget revenue', data: b.series.REV, borderColor: FL.PAL.bud, borderDash: [5, 4], pointRadius: 0, order: 1 },
                    { type: 'line', label: 'Net profit', data: m.series.NP, borderColor: FL.PAL.py, backgroundColor: FL.PAL.py, yAxisID: 'y2', tension: 0.25, order: 0 }] },
                    options: { scales: { y: FL.moneyAxis(), y2: Object.assign(FL.moneyAxis(), { position: 'right', grid: { display: false } }) } } });
                FL.chart('ov-mg', { type: 'line', data: { labels: m.labels, datasets: [
                    { label: 'Gross', data: m.series.GM, borderColor: FL.PAL.series[0], pointRadius: 0, tension: 0.25 }, { label: 'EBITDA', data: m.series.EBITDAM, borderColor: FL.PAL.series[1], pointRadius: 0, tension: 0.25 },
                    { label: 'Net', data: m.series.NPM, borderColor: FL.PAL.series[2], pointRadius: 0, tension: 0.25 }] }, options: { scales: { y: { ticks: { callback: function (v) { return v + '%'; } } } } } });
                if (colIx(pl, 'y_py') >= 0) FL.waterfall('ov-br', FINE.bridge(pl, 'y_py', 'y_act', 'NP', 'NP', [{ id: 'REV', label: 'Revenue' }, { id: 'COGS', label: 'Cost of sales', sign: -1 }, { id: 'OPEX', label: 'Opex', sign: -1 }, { id: 'OI', label: 'Other income' }, { id: 'DA', label: 'D&A', sign: -1 }, { id: 'FIN', label: 'Finance', sign: -1 }, { id: 'TAX', label: 'Tax', sign: -1 }])
                    .map(function (s) { if (s.kind !== 'step') s.label = s.kind === 'start' ? 'YTD last year' : 'YTD this year'; return s; }));
                if (tm.BS) {
                    var bs = FL.monthly(data, tm.BS, ['CASH', 'CA', 'CL', 'INV', 'AR', 'AP'], { scenario: 'ACTUAL', range: 'BAL' }, 24);
                    FL.chart('ov-cash', { type: 'line', data: { labels: bs.labels, datasets: [
                        { label: 'Cash', data: bs.series.CASH, borderColor: FL.PAL.series[1], backgroundColor: 'rgba(13,148,136,.1)', fill: true, pointRadius: 0, tension: 0.25 },
                        { label: 'Working capital (excl. cash)', data: bs.series.INV.map(function (v, i) { return v + bs.series.AR[i] - bs.series.AP[i]; }), borderColor: FL.PAL.series[3], pointRadius: 0, tension: 0.25 }] }, options: { scales: { y: FL.moneyAxis() } } });
                }
                var yi = colIx(pl, 'y_act'), opx = pl.rows.filter(function (r) { return r.parent === 'OPEX'; });
                FL.chart('ov-opex', { type: 'doughnut', data: { labels: opx.map(function (r) { return r.label; }), datasets: [{ data: opx.map(function (r) { return r.values[yi]; }), backgroundColor: FL.PAL.series }] },
                    options: { plugins: { legend: { position: 'right' } }, interaction: {} } });
                var mv = FINE.movers(data, per, { range: 'YTD' }, { range: 'YTD', at: 'PY' }, FINE.isPl).slice(0, 12);
                $('ov-mov').innerHTML = FL.table([{ label: 'Account', get: function (r) { return r.code + ' ' + r.name; } }, { label: 'YTD', n: 1, get: function (r) { return FL.num(r.a); } }, { label: 'Last year', n: 1, get: function (r) { return FL.num(r.b); } },
                    { label: 'Change', n: 1, html: 1, get: function (r) { var good = r.type === 'R' ? r.diff >= 0 : r.diff <= 0; return '<span class="' + (good ? 'pos' : 'neg') + '">' + FL.num(r.diff) + '</span>'; } },
                    { label: '%', n: 1, get: function (r) { return r.pct == null ? '' : r.pct.toFixed(1) + '%'; } }], mv, { click: true });
                FL.wireRows($('ov-mov'), mv, function (r) { FL.drillAccount(r.code, { label: 'YTD', col: { scenario: 'ACTUAL' }, seqs: FINE.windowSeqs({ range: 'YTD' }, data, per), tpl: tm.PL, row: {} }); });
            });
        }
    };

    /** One KPI: definition, 24-month trend, monitors */
    FL.kpiModal = function (id) {
        var k = FL.config.kpis.filter(function (x) { return x.id === id; })[0]; if (!k) return;
        FL.data().then(function (data) {
            var tr = FINE.kpiTrend([k], T(), data, FL.filter.period, 24)[k.id];
            var rules = FL.config.monitors.filter(function (m) { return m.kpi === id; });
            FL.modal('<i class="fa-solid fa-chart-line"></i> ' + esc(k.label), '<p class="sm">' + esc(k.desc || '') + '</p><p class="sm muted">Formula: <code>' + esc(k.expr) + '</code></p>' +
                (rules.length ? '<p class="sm">Monitors: ' + rules.map(function (r) { return '<span class="tag">' + esc(r.label) + '</span>'; }).join(' ') + '</p>' : '') +
                '<div class="chartbox"><canvas id="kpim"></canvas></div>');
            var ds = [{ label: k.label, data: tr.map(function (x) { return x.value; }), borderColor: FL.PAL.act, backgroundColor: 'rgba(29,78,216,.08)', fill: true, tension: 0.25 }];
            rules.forEach(function (r) { ds.push({ label: r.op + ' ' + r.value, data: tr.map(function () { return +r.value; }), borderColor: FL.PAL.bad, borderDash: [5, 4], pointRadius: 0 }); });
            FL.chart('kpim', { type: 'line', data: { labels: tr.map(function (x) { return x.name; }), datasets: ds }, options: { scales: { y: k.fmt === 'money' ? FL.moneyAxis() : {} } } });
            FL.charts.drill = FL.charts.kpim;
        });
    };

    // ═════════ Analytics ═════════
    var TR = FL.ls('an.trend', {});
    var A = FL.an = { view: FL.ls('an.view', 'trend'), trendRows: TR.rows || ['REV', 'COGS', 'GP'], trendTpl: TR.tpl || 'PL', trendBud: TR.bud != null ? TR.bud : false, trendFc: TR.fc != null ? TR.fc : true, trendType: TR.type || 'line', horizon: TR.h || 6, cmp: 'ytd_bud', drivers: { revenuePct: 0, cogsPct: 0, opexPct: 0, payrollPct: 0, financePct: 0 } };
    var VIEWS = [['trend', 'fa-chart-line', 'Trends & forecast'], ['variance', 'fa-stairs', 'Variance & bridge'], ['cc', 'fa-table-cells', 'Cost centres vs budget'], ['company', 'fa-building', 'Companies & consolidation'],
        ['ratios', 'fa-scale-balanced', 'Ratios'], ['common', 'fa-percent', 'Common-size'], ['whatif', 'fa-sliders', 'What-if'], ['anom', 'fa-bolt', 'Anomalies']];
    FL.TABS.analytics = {
        render: function (el) {
            el.innerHTML = '<div class="split"><div class="side">' + VIEWS.map(function (v) { return '<div class="item' + (v[0] === A.view ? ' on' : '') + '" data-v="' + v[0] + '"><i class="fa-solid ' + v[1] + '"></i>' + v[2] + '</div>'; }).join('') +
                '</div><div id="an-main"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div></div>';
            el.querySelectorAll('.side .item').forEach(function (it) { it.onclick = function () { A.view = it.dataset.v; FL.lsSet('an.view', A.view); FL.render(); }; });
            return FL.data().then(function (data) { return VIEW_FN[A.view](document.getElementById('an-main'), data); });
        }
    };

    var VIEW_FN = {
        trend: function (el, data) {
            // several lines of an income statement template on one chart: each its own colour, forecast (dotted) and budget (dashed)
            var tpls = FL.templates.filter(function (t) { return t.type === 'PL'; }), tm = T();
            var tpl = tm[A.trendTpl] && tm[A.trendTpl].type === 'PL' ? tm[A.trendTpl] : tm.PL || tpls[0];
            if (!tpl) { el.innerHTML = '<div class="empty">No income statement template — create one in the Statement builder.</div>'; return; }
            var rows = tpl.rows.filter(function (r) { return r.id && ['accounts', 'group', 'formula'].indexOf(r.type) >= 0; }), has = {};
            rows.forEach(function (r) { has[r.id] = r; });
            var sel = (A.trendRows || []).filter(function (id) { return has[id]; });
            if (!sel.length) sel = ['REV', 'COGS', 'GP'].filter(function (id) { return has[id]; });
            if (!sel.length && rows.length) sel = [rows[0].id];
            A.trendRows = sel;
            var m = FL.monthly(data, tpl, sel, { scenario: 'ACTUAL', range: 'MTD' }, 36), b = A.trendBud ? FL.monthly(data, tpl, sel, { scenario: 'BUDGET', range: 'MTD' }, 36) : null;
            var labels = m.labels.slice(), cp = FL.filter.period, n = m.labels.length, H = A.trendFc ? A.horizon : 0;
            for (var i = 1; i <= H; i++) { var d = new Date(Math.floor(cp / 100), (cp % 100) - 1 + i, 1); labels.push(d.toLocaleString('en', { month: 'short' }) + '-' + String(d.getFullYear()).slice(2) + ' f'); }
            var pad = function (a) { return a.concat(new Array(H).fill(null)); };
            var colour = function (i) { return FL.PAL.series[i % FL.PAL.series.length]; };
            var isPct = function (id) { return has[id].format === 'pct'; }, anyPct = sel.some(isPct), anyAmt = sel.some(function (id) { return !isPct(id); });
            var fcs = {}, sets = [], bar = A.trendType === 'bar';
            sel.forEach(function (id, k) {
                var y = m.series[id].map(function (v) { return v || 0; }), c = colour(k), ax = isPct(id) && anyAmt ? 'y1' : 'y';
                fcs[id] = H ? FINE.forecast(y, H) : { forecast: [], method: '' };
                sets.push({ type: bar && !isPct(id) ? 'bar' : 'line', label: has[id].label, data: pad(y), borderColor: c, backgroundColor: bar ? c : c + '22', fill: !bar && sel.length === 1, tension: 0.25, yAxisID: ax, borderRadius: 3, order: 2 });
                if (H) sets.push({ type: 'line', label: has[id].label + ' forecast', data: new Array(Math.max(0, y.length - 1)).fill(null).concat(y.length ? [y[y.length - 1]] : []).concat(fcs[id].forecast), borderColor: c, borderDash: [2, 3], pointRadius: 2, tension: 0.25, yAxisID: ax, order: 1 });
                if (b) sets.push({ type: 'line', label: has[id].label + ' budget', data: pad(b.series[id]), borderColor: c, borderDash: [6, 4], borderWidth: 1.2, pointRadius: 0, yAxisID: ax, order: 1 });
            });
            var fmtV = function (id, v) { return v == null ? '–' : isPct(id) ? v.toFixed(1) + '%' : FL.compact(v); };
            var presets = [['Sales & costs', ['REV', 'COGS', 'OPEX']], ['Profit', ['GP', 'EBITDA', 'NP']], ['Operating expenses', ['STAFF', 'PREM', 'DIST', 'SELL', 'ADMIN']], ['Margins', ['GP_M', 'EBITDA_M', 'NP_M', 'GM', 'EBITDAM', 'NPM']]]
                .map(function (p) { return [p[0], p[1].filter(function (id) { return has[id]; })]; }).filter(function (p) { return p[1].length; });
            var on = {}; sel.forEach(function (id, k) { on[id] = k; });
            el.innerHTML = '<div class="card"><h3><i class="fa-solid fa-chart-line"></i> Trends & forecast<span class="grow"></span>' +
                (tpls.length > 1 ? '<select id="tr-tpl" title="Income statement template">' + tpls.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t === tpl ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select>' : '') +
                '<div class="seg" id="tr-type"><button data-t="line" class="' + (bar ? '' : 'on') + '">Lines</button><button data-t="bar" class="' + (bar ? 'on' : '') + '">Columns</button></div>' +
                '<label class="sm"><input type="checkbox" id="tr-bud"' + (A.trendBud ? ' checked' : '') + '> budget</label>' +
                '<label class="sm"><input type="checkbox" id="tr-fc"' + (A.trendFc ? ' checked' : '') + '> forecast</label>' +
                '<select id="tr-h"' + (A.trendFc ? '' : ' disabled') + '>' + [3, 6, 12].map(function (h) { return '<option' + (h === A.horizon ? ' selected' : '') + '>' + h + '</option>'; }).join('') + '</select><small>months ahead</small></h3>' +
                '<div class="tr-pick">' + (presets.length ? '<span class="sm muted">Quick:</span> ' + presets.map(function (p, i) { return '<a class="tr-pre" data-p="' + i + '">' + esc(p[0]) + '</a>'; }).join(' · ') + ' <span class="sm muted">· click lines to add or remove them</span>' : '') +
                '<div class="tr-chips">' + rows.map(function (r) { var k = on[r.id]; return '<button class="tr-chip' + (k != null ? ' on' : '') + '" data-id="' + esc(r.id) + '"' + (k != null ? ' style="border-color:' + colour(k) + ';background:' + colour(k) + '1a"' : '') + '>' + (k != null ? '<i class="dot" style="background:' + colour(k) + '"></i>' : '') + esc(r.label) + '</button>'; }).join('') + '</div></div>' +
                '<div class="chartbox tall"><canvas id="tr-c"></canvas></div>' +
                '<p class="sm muted">' + (H ? 'Forecast (dotted): ' + esc((fcs[sel[0]] || {}).method || '') + ' on the last ' + n + ' months' + (n >= 24 ? ' (level, trend and month-of-year seasonality)' : '') + '. ' : '') + (b ? 'Dashed = budget. ' : '') + (anyPct && anyAmt ? '% lines use the right-hand axis.' : '') + '</p>' +
                '<div class="scroll"><table class="t"><thead><tr><th>Line</th>' + m.labels.slice(-12).map(function (l) { return '<th class="n">' + esc(l) + '</th>'; }).join('') + (H ? fcs[sel[0]].forecast.map(function (_, i) { return '<th class="n muted">' + esc(labels[n + i]) + '</th>'; }).join('') : '') + '</tr></thead><tbody>' +
                sel.map(function (id, k) { return '<tr><td><i class="dot" style="background:' + colour(k) + '"></i> ' + esc(has[id].label) + '</td>' + m.series[id].slice(-12).map(function (v) { return '<td class="n">' + fmtV(id, v) + '</td>'; }).join('') +
                    (H ? fcs[id].forecast.map(function (v) { return '<td class="n muted"><i>' + fmtV(id, v) + '</i></td>'; }).join('') : '') + '</tr>'; }).join('') + '</tbody></table></div></div>';
            var redo = function () { FL.lsSet('an.trend', { rows: A.trendRows, tpl: A.trendTpl, bud: A.trendBud, fc: A.trendFc, type: A.trendType, h: A.horizon }); VIEW_FN.trend(el, data); };
            el.querySelectorAll('.tr-chip').forEach(function (c) { c.onclick = function () { var id = c.dataset.id, i = A.trendRows.indexOf(id); if (i >= 0) { if (A.trendRows.length > 1) A.trendRows.splice(i, 1); } else if (A.trendRows.length < 8) A.trendRows.push(id); else FL.toast('Up to 8 lines', ''); redo(); }; });
            el.querySelectorAll('.tr-pre').forEach(function (a) { a.onclick = function () { A.trendRows = presets[+a.dataset.p][1].slice(); redo(); }; });
            el.querySelectorAll('#tr-type button').forEach(function (x) { x.onclick = function () { A.trendType = x.dataset.t; redo(); }; });
            if ($('tr-tpl')) $('tr-tpl').onchange = function () { A.trendTpl = this.value; redo(); };
            $('tr-bud').onchange = function () { A.trendBud = this.checked; redo(); };
            $('tr-fc').onchange = function () { A.trendFc = this.checked; redo(); };
            $('tr-h').onchange = function () { A.horizon = +this.value; redo(); };
            var scales = { y: anyAmt ? FL.moneyAxis() : { ticks: { callback: function (v) { return v + '%'; } } } };
            if (anyPct && anyAmt) scales.y1 = { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: function (v) { return v + '%'; } } };
            FL.chart('tr-c', { type: 'bar', data: { labels: labels, datasets: sets },
                options: { plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 }, filter: function (it) { return !/ (forecast|budget)$/.test(it.text); } } }, tooltip: { callbacks: { label: function (c) { var id = sel[Math.floor(c.datasetIndex / (1 + (H ? 1 : 0) + (b ? 1 : 0)))]; return c.dataset.label + ': ' + fmtV(id, c.parsed.y); } } } }, scales: scales } });
        },

        variance: function (el, data) {
            var tpl = T().PL; if (!tpl) return;
            var CMP = { ytd_bud: ['YTD vs budget', { range: 'YTD' }, { range: 'YTD', scenario: 'BUDGET' }, 'Actual YTD', 'Budget YTD'], ytd_py: ['YTD vs last year', { range: 'YTD' }, { range: 'YTD', at: 'PY' }, 'This year YTD', 'Last year YTD'],
                m_bud: ['Month vs budget', { range: 'MTD' }, { range: 'MTD', scenario: 'BUDGET' }, 'Actual month', 'Budget month'], m_pm: ['Month vs last month', { range: 'MTD' }, { range: 'MTD', at: 'PM' }, 'This month', 'Last month'],
                ltm_py: ['Last 12 months vs the 12 before', { range: 'LTM' }, { range: 'LTM', at: 'PY' }, 'Last 12 months', 'The 12 before'] };
            var c = CMP[A.cmp], ca = Object.assign({ id: 'a', scenario: 'ACTUAL' }, c[1]), cb = Object.assign({ id: 'b', scenario: 'ACTUAL' }, c[2]);
            var st = FINE.compute(tpl, data, { period: FL.filter.period, scale: 1, columns: [ca, cb] });
            var br = FINE.bridge(st, 'b', 'a', 'NP', 'NP', [{ id: 'REV', label: 'Revenue' }, { id: 'COGS', label: 'Cost of sales', sign: -1 }, { id: 'STAFF', label: 'Staff', sign: -1 }, { id: 'PREM', label: 'Premises', sign: -1 },
                { id: 'DIST', label: 'Distribution', sign: -1 }, { id: 'SELL', label: 'Selling', sign: -1 }, { id: 'ADMIN', label: 'Admin', sign: -1 }, { id: 'OI', label: 'Other income' }, { id: 'DA', label: 'D&A', sign: -1 }, { id: 'FIN', label: 'Finance', sign: -1 }, { id: 'TAX', label: 'Tax', sign: -1 }]);
            var mv = FINE.movers(data, FL.filter.period, ca, cb, FINE.isPl);
            var nar = FINE.narrative(st, 'a', 'b', { keyRows: ['REV', 'GP', 'OPEX', 'EBITDA', 'NP'], top: 5, fmt: FL.compact });
            el.innerHTML = '<div class="card"><h3><i class="fa-solid fa-stairs"></i> Net profit bridge<span class="grow"></span><div class="seg" id="vr-c">' + Object.keys(CMP).map(function (k) { return '<button data-c="' + k + '" class="' + (k === A.cmp ? 'on' : '') + '">' + CMP[k][0] + '</button>'; }).join('') + '</div></h3>' +
                '<div class="chartbox tall"><canvas id="vr-w"></canvas></div></div>' +
                '<div class="grid g2" style="margin-top:12px"><div class="card"><h3><i class="fa-solid fa-comment-dots"></i> Commentary</h3><ul class="story">' + nar.map(function (s) { return '<li class="' + s.tone + '">' + esc(s.text) + '</li>'; }).join('') + '</ul></div>' +
                '<div class="card"><h3><i class="fa-solid fa-list-ol"></i> Account movers <small>click for journals</small></h3><div class="scroll" id="vr-m"></div></div></div>';
            el.querySelectorAll('#vr-c button').forEach(function (b) { b.onclick = function () { A.cmp = b.dataset.c; VIEW_FN.variance(el, data); }; });
            FL.waterfall('vr-w', br.map(function (s) { if (s.kind === 'start') s.label = c[4]; if (s.kind === 'end') s.label = c[3]; return s; }));
            $('vr-m').innerHTML = FL.table([{ label: 'Account', get: function (r) { return r.code + ' ' + r.name; } }, { label: c[3], n: 1, get: function (r) { return FL.num(r.a); } }, { label: c[4], n: 1, get: function (r) { return FL.num(r.b); } },
                { label: 'Δ', n: 1, html: 1, get: function (r) { var g = r.type === 'R' ? r.diff >= 0 : r.diff <= 0; return '<span class="' + (g ? 'pos' : 'neg') + '">' + FL.num(r.diff) + '</span>'; } }, { label: '%', n: 1, get: function (r) { return r.pct == null ? '' : r.pct.toFixed(1) + '%'; } }], mv.slice(0, 40), { click: true });
            FL.wireRows($('vr-m'), mv.slice(0, 40), function (r) { FL.drillJournals({ account: r.code, seqs: FINE.windowSeqs(ca, data, FL.filter.period), title: r.code + ' ' + r.name + ' · ' + c[3] }); });
        },

        cc: function (el, data) {
            var tpl = T().PL; if (!tpl) return;
            var w = FL.where('', { noCc: true });
            return FL.sql('SELECT cost_centre, scenario, account, period_seq, SUM(period_net), SUM(end_bal) FROM fin_balances WHERE cost_centre <> \'000\'' + (w.length ? ' AND ' + w.join(' AND ') : '') + ' GROUP BY ALL', 500000).then(function (d) {
                var by = {}; d.rows.forEach(function (r) { (by[r[0]] = by[r[0]] || []).push(r.slice(1)); });
                var ccs = FL.dims.ccs.filter(function (c) { return by[c.code]; });
                var lines = tpl.rows.filter(function (r) { return r.type === 'accounts' && (r.parent === 'OPEX' || r.parent === 'COGS'); });
                var cols = [{ id: 'a', scenario: 'ACTUAL', range: A.ccRange || 'YTD' }, { id: 'b', scenario: 'BUDGET', range: A.ccRange || 'YTD' }];
                var res = {}; ccs.forEach(function (c) { res[c.code] = FINE.compute(tpl, { accounts: data.accounts, periods: data.periods, facts: FINE.factsFrom(by[c.code]) }, { period: FL.filter.period, scale: 1, columns: cols }); });
                var cell = function (code, id) { var r = rowOf(res[code], id); return r ? { a: r.values[0], b: r.values[1] } : { a: 0, b: 0 }; };
                var heat = function (a, b) { if (!b) return a ? '#fee2e2' : '#fff'; var p = (a - b) / Math.abs(b); var x = Math.min(1, Math.abs(p) / 0.25); return p > 0 ? 'rgba(239,68,68,' + (0.12 + 0.55 * x) + ')' : 'rgba(34,197,94,' + (0.1 + 0.45 * x) + ')'; };
                el.innerHTML = '<div class="card"><h3><i class="fa-solid fa-table-cells"></i> Cost centres against budget<span class="grow"></span><div class="seg" id="cc-r">' + ['MTD', 'QTD', 'YTD'].map(function (r) { return '<button data-r="' + r + '" class="' + ((A.ccRange || 'YTD') === r ? 'on' : '') + '">' + r + '</button>'; }).join('') + '</div></h3>' +
                    '<p class="sm muted">Actual in ' + FL.scaleLabel() + '; red = over budget, green = under (darker = further). Click a cell for its journal lines.</p><div style="overflow:auto"><table class="t heat"><thead><tr><th>Line</th>' +
                    ccs.map(function (c) { return '<th class="n">' + esc(c.code + ' ' + c.name) + '</th>'; }).join('') + '<th class="n">Total</th><th class="n">Budget</th><th class="n">Var %</th></tr></thead><tbody>' +
                    lines.map(function (l) {
                        var ta = 0, tb = 0;
                        var tds = ccs.map(function (c) { var v = cell(c.code, l.id); ta += v.a; tb += v.b; return '<td class="h" style="background:' + heat(v.a, v.b) + '" data-cc="' + c.code + '" data-row="' + l.id + '" title="budget ' + FL.num(v.b) + '">' + (v.a || v.b ? FL.num(v.a) : '') + '</td>'; }).join('');
                        return '<tr><td>' + esc(l.label) + '</td>' + tds + '<td class="n"><b>' + FL.num(ta) + '</b></td><td class="n">' + FL.num(tb) + '</td><td class="n ' + (ta > tb ? 'neg' : 'pos') + '">' + (tb ? ((ta - tb) / Math.abs(tb) * 100).toFixed(1) + '%' : '') + '</td></tr>';
                    }).join('') + '</tbody></table></div></div>';
                el.querySelectorAll('#cc-r button').forEach(function (b) { b.onclick = function () { A.ccRange = b.dataset.r; VIEW_FN.cc(el, data); }; });
                el.querySelectorAll('td.h').forEach(function (td) {
                    td.onclick = function () {
                        var l = lines.filter(function (x) { return x.id === td.dataset.row; })[0], accs = FINE.matchAccounts(l.accounts, data.accounts);
                        var seqs = FINE.windowSeqs({ range: A.ccRange || 'YTD' }, data, FL.filter.period);
                        var w2 = FL.where('j', { noCc: true }).concat(['j.cost_centre = ' + FL.q(td.dataset.cc), 'j.account IN (' + accs.map(FL.q).join(',') + ')', 'j.period_seq IN (' + seqs.join(',') + ')']);
                        FL.drillJournals({ where: w2.join(' AND '), title: l.label + ' · cost centre ' + td.dataset.cc });
                    };
                });
            });
        },

        company: function (el, data) {
            var tpl = T().PL; if (!tpl) return;
            var cat = FL.config.icCategory || 'Intercompany';
            return Promise.all([
                FL.sql('SELECT company, scenario, account, period_seq, SUM(period_net), SUM(end_bal) FROM fin_balances' + (FL.filter.cc ? ' WHERE cost_centre = ' + FL.q(FL.filter.cc) : '') + ' GROUP BY ALL', 500000),
                FL.sql("SELECT 'ACTUAL', account, period_seq, SUM(dr - cr), 0 FROM fin_journals WHERE je_category = " + FL.q(cat) + (FL.filter.cc ? ' AND cost_centre = ' + FL.q(FL.filter.cc) : '') + ' GROUP BY ALL', 100000)
            ]).then(function (r) {
                var by = {}; r[0].rows.forEach(function (x) { (by[x[0]] = by[x[0]] || []).push(x.slice(1)); });
                var cols = [{ id: 'y', scenario: 'ACTUAL', range: A.coRange || 'YTD' }];
                var mk = function (rows) { return FINE.compute(tpl, { accounts: data.accounts, periods: data.periods, facts: FINE.factsFrom(rows) }, { period: FL.filter.period, scale: 1, columns: cols }); };
                var cos = FL.dims.companies.filter(function (c) { return by[c.code]; }), res = cos.map(function (c) { return mk(by[c.code]); });
                var ice = mk(r[1].rows);
                var lines = tpl.rows.filter(function (x) { return x.type !== 'blank'; });
                el.innerHTML = '<div class="card"><h3><i class="fa-solid fa-building"></i> Companies and consolidation<span class="grow"></span><div class="seg" id="co-r">' + ['MTD', 'YTD', 'LTM'].map(function (x) { return '<button data-r="' + x + '" class="' + ((A.coRange || 'YTD') === x ? 'on' : '') + '">' + x + '</button>'; }).join('') + '</div></h3>' +
                    '<p class="sm muted">Each company, the elimination of journals in category "' + esc(cat) + '" (management fees, intercompany sales) and the group total — in ' + FL.scaleLabel() + '.</p>' +
                    '<div class="stmt-wrap"><table class="st"><thead><tr><th>' + esc(tpl.name) + '</th>' + cos.map(function (c) { return '<th>' + esc(c.code + ' ' + c.name) + '</th>'; }).join('') + '<th class="var">IC elimination</th><th>Group</th></tr></thead><tbody>' +
                    lines.map(function (l) {
                        var vals = res.map(function (s) { var x = rowOf(s, l.id); return x ? x.values[0] : null; });
                        var e = rowOf(ice, l.id), ev = e && e.values[0] != null && l.format !== 'pct' ? -e.values[0] : null;
                        var g = l.format === 'pct' ? null : vals.reduce(function (s, v) { return s + (v || 0); }, 0) + (ev || 0);
                        if (l.format === 'pct' && l.formula) { var m = /PCT\((\w+),\s*(\w+)\)/.exec(l.formula); if (m) { var gv = function (id) { var t = 0; res.forEach(function (s) { var x = rowOf(s, id); t += x ? x.values[0] : 0; }); var ex = rowOf(ice, id); return t - (ex ? ex.values[0] : 0); }; var den = gv(m[2]); g = den ? gv(m[1]) / den * 100 : null; } }
                        var rr = { format: l.format || 'num' }, cc = { kind: 'value' };
                        var t = function (v) { return v == null ? '' : FL.cellText(rr, cc, l.format === 'pct' ? v : v / FL.filter.scale); };
                        return l.type === 'header' ? '<tr class="header"><td colspan="' + (cos.length + 3) + '">' + esc(l.label) + '</td></tr>' :
                            '<tr class="' + FL.rowClass({ type: l.type, style: l.style || {} }) + '"><td><span style="padding-left:' + ((l.level || 0) * 18) + 'px">' + esc(l.label || '') + '</span></td>' + vals.map(function (v) { return '<td>' + t(v) + '</td>'; }).join('') + '<td>' + (ev ? t(ev) : '') + '</td><td><b>' + t(g) + '</b></td></tr>';
                    }).join('') + '</tbody></table></div></div>';
                el.querySelectorAll('#co-r button').forEach(function (b) { b.onclick = function () { A.coRange = b.dataset.r; VIEW_FN.company(el, data); }; });
            });
        },

        ratios: function (el, data) {
            var cfg = FL.config, groups = {};
            cfg.kpis.forEach(function (k) { (groups[k.group || 'Other'] = groups[k.group || 'Other'] || []).push(k); });
            var tr = FINE.kpiTrend(cfg.kpis, T(), data, FL.filter.period, 13);
            var py = FINE.kpis(cfg.kpis, T(), data, (data._pi.list[data._pi.bySeq[FL.filter.period] - 12] || {}).period_seq || FL.filter.period);
            var html = '<div class="card"><h3><i class="fa-solid fa-scale-balanced"></i> Ratios and KPIs <small>last 6 months, same month last year, 12-month trend — click a line for its chart</small></h3><div style="overflow:auto"><table class="t"><thead><tr><th>KPI</th>';
            var any = tr[cfg.kpis[0].id] || [];
            any.slice(-6).forEach(function (p) { html += '<th class="n">' + esc(p.name) + '</th>'; });
            html += '<th class="n">Last year</th><th>Trend</th></tr></thead><tbody>';
            var i = 0;
            Object.keys(groups).forEach(function (g) {
                html += '<tr><td colspan="9" style="font-weight:700;color:var(--navy);padding-top:10px">' + esc(g) + '</td></tr>';
                groups[g].forEach(function (k) {
                    var s = tr[k.id];
                    html += '<tr class="click" data-k="' + esc(k.id) + '"><td title="' + esc(k.expr) + '">' + esc(k.label) + '</td>' + s.slice(-6).map(function (p) { return '<td class="n">' + FL.kfmt(p.value, k.fmt) + '</td>'; }).join('') +
                        '<td class="n muted">' + FL.kfmt(py[k.id] && py[k.id].value, k.fmt) + '</td><td style="width:120px"><div style="height:26px;width:110px"><canvas id="rt' + (i++) + '"></canvas></div></td></tr>';
                });
            });
            el.innerHTML = html + '</tbody></table></div></div>';
            i = 0;
            Object.keys(groups).forEach(function (g) { groups[g].forEach(function (k) { FL.spark('rt' + (i++), tr[k.id].map(function (p) { return p.value; }), k.good === 'down' ? '#0d9488' : FL.PAL.act); }); });
            el.querySelectorAll('tr.click').forEach(function (r) { r.onclick = function () { FL.kpiModal(r.dataset.k); }; });
        },

        common: function (el, data) {
            var tm = T(), out = '';
            if (tm.PL) {
                var pl = FINE.compute(tm.PL, data, { period: FL.filter.period, scale: FL.filter.scale, columns: [{ id: 'cy', range: 'YTD' }, { id: 'cyp', kind: 'pctof', of: 'cy', row: 'REV', label: '% of revenue' }, { id: 'py', range: 'YTD', at: 'PY' }, { id: 'pyp', kind: 'pctof', of: 'py', row: 'REV', label: '% of revenue' }] });
                out += '<div class="stmt-wrap" style="margin-bottom:12px"><div class="stmt-head"><h2>Income statement — common size</h2><div class="sub">Every line as % of net revenue, this year to date and last year</div></div>' + FL.stmtTable(pl, { hideZero: true }) + '</div>';
            }
            if (tm.BS) {
                var bs = FINE.compute(tm.BS, data, { period: FL.filter.period, scale: FL.filter.scale, columns: [{ id: 'c', range: 'BAL' }, { id: 'cp', kind: 'pctof', of: 'c', row: 'TA', label: '% of total assets' }, { id: 'p', range: 'BAL', at: 'PYE' }, { id: 'pp', kind: 'pctof', of: 'p', row: 'TA', label: '% of total assets' }] });
                out += '<div class="stmt-wrap"><div class="stmt-head"><h2>Balance sheet — common size</h2><div class="sub">Every line as % of total assets, now and at the last year end</div></div>' + FL.stmtTable(bs, { hideZero: true }) + '</div>';
            }
            el.innerHTML = out;
        },

        whatif: function (el, data) {
            var tpl = T().PL; if (!tpl) return;
            var pi = data._pi, cur = pi.list[pi.bySeq[FL.filter.period]], from = cur.fiscal_year * 100 + 1;
            var sc = FINE.scenario(data, A.drivers, from);
            var st = FINE.compute(tpl, sc, { period: FL.filter.period, scale: FL.filter.scale, columns: [{ id: 'o', range: 'YTD', label: 'Actual YTD' }, { id: 's', range: 'YTD', scenario: 'SCENARIO', label: 'What-if YTD' }, { id: 'd', kind: 'var', a: 's', b: 'o', label: 'Impact' }] });
            var D = [['revenuePct', 'Revenue (volume)', -20, 20], ['cogsPct', 'Unit cost of sales', -10, 10], ['payrollPct', 'Payroll', -15, 15], ['opexPct', 'Other operating costs', -20, 20], ['financePct', 'Finance costs', -50, 50]];
            el.innerHTML = '<div class="grid g3"><div class="card"><h3><i class="fa-solid fa-sliders"></i> Drivers <small>applied to ' + cur.fiscal_year + ' to date</small></h3>' +
                D.map(function (d) { return '<div class="field" style="margin-bottom:10px">' + d[1] + ' <span><input type="range" min="' + d[2] + '" max="' + d[3] + '" step="0.5" value="' + A.drivers[d[0]] + '" data-d="' + d[0] + '" style="width:70%"> <b id="wv-' + d[0] + '">' + (A.drivers[d[0]] > 0 ? '+' : '') + A.drivers[d[0]] + ' %</b></span></div>'; }).join('') +
                '<button class="btn sm" id="wi-reset">Reset</button><p class="sm muted">Revenue moves cost of sales with it (same margin per unit); "unit cost" changes cost of sales on top. Tax stays as booked.</p></div>' +
                '<div class="stmt-wrap" style="grid-column:span 2"><div class="stmt-head"><h2>What-if: income statement</h2><div class="sub">' + esc(FL.filterText()) + ' · in ' + FL.scaleLabel() + '</div></div>' + FL.stmtTable(st, { hideZero: true }) + '</div></div>';
            el.querySelectorAll('input[type=range]').forEach(function (r) {
                r.oninput = function () { $('wv-' + r.dataset.d).textContent = (r.value > 0 ? '+' : '') + r.value + ' %'; };
                r.onchange = function () { A.drivers[r.dataset.d] = +r.value; VIEW_FN.whatif(el, data); };
            });
            $('wi-reset').onclick = function () { Object.keys(A.drivers).forEach(function (k) { A.drivers[k] = 0; }); VIEW_FN.whatif(el, data); };
        },

        anom: function (el, data) {
            var an = FINE.anomalies(data, FL.filter.period, { z: A.z || 3 });
            el.innerHTML = '<div class="card"><h3><i class="fa-solid fa-bolt"></i> Unusual account movements · ' + esc(FL.periodName(FL.filter.period)) + '<span class="grow"></span><small>sensitivity</small><select id="an-z">' +
                [[2.5, 'high'], [3, 'medium'], [4, 'low']].map(function (z) { return '<option value="' + z[0] + '"' + ((A.z || 3) === z[0] ? ' selected' : '') + '>' + z[1] + '</option>'; }).join('') + '</select></h3>' +
                '<p class="sm muted">This month compared with the same account\'s previous 12 months (median and robust spread): ' + an.length + ' found. Click for the journal lines.</p>' +
                (an.length ? '<table class="t"><thead><tr><th>Account</th><th>Class</th><th class="n">This month</th><th class="n">Typical</th><th class="n">Difference</th><th class="n">σ</th><th>13 months</th></tr></thead><tbody>' +
                    an.map(function (a, i) { return '<tr class="click" data-i="' + i + '"><td>' + esc(a.code + ' ' + a.name) + '</td><td>' + esc(a.class) + '</td><td class="n">' + FL.num(a.value) + '</td><td class="n">' + FL.num(a.typical) + '</td><td class="n ' + (a.change > 0 ? 'neg' : 'pos') + '">' + FL.num(a.change) + '</td><td class="n">' + a.z.toFixed(1) + '</td><td><div style="height:26px;width:130px"><canvas id="ans' + i + '"></canvas></div></td></tr>'; }).join('') + '</tbody></table>'
                    : '<div class="callout good">Nothing unusual this month.</div>') + '</div>';
            an.forEach(function (a, i) { FL.spark('ans' + i, a.history, FL.PAL.bad); });
            $('an-z').onchange = function () { A.z = +this.value; VIEW_FN.anom(el, data); };
            el.querySelectorAll('tr.click').forEach(function (tr) { tr.onclick = function () { var a = an[+tr.dataset.i]; FL.drillJournals({ account: a.code, seqs: [FL.filter.period], title: a.code + ' ' + a.name + ' · ' + FL.periodName(FL.filter.period) }); }; });
        }
    };
})();
