/* Finance Lens — one-click board pack: cover, executive summary (headline KPIs + editable commentary), KPI table,
   statements from the templates, charts (revenue & profit, margins, net profit bridge), cost centres against budget,
   monitors and risk highlights. Shown in a print-ready viewer: Print / save as PDF, or download the HTML. */
(function () {
    var SECTIONS = [['summary', 'Cover and executive summary'], ['kpis', 'KPI table'], ['charts', 'Charts: trend, margins, profit bridge'], ['statements', 'Financial statements'],
        ['costcentres', 'Cost centres against budget'], ['monitor', 'Monitors and covenants'], ['risk', 'Risk highlights (anomalies, journal tests)']];

    FL.packDialog = function () {
        if (!FL.status || !FL.status.loaded) { FL.toast('Load data first', 'err'); return; }
        var p = FL.config.pack || {}, on = p.on || SECTIONS.map(function (s) { return s[0]; });
        FL.data().then(function (data) {
            var tm = FL.tplMap(), pl = tm.PL ? FINE.compute(tm.PL, data, { period: FL.filter.period, scale: 1 }) : null, lines = [];
            if (pl) {
                lines = lines.concat(FINE.narrative(pl, 'm_act', 'm_bud', { keyRows: ['REV', 'NP'], top: 2, fmt: FL.compact }).map(function (x) { return '• Month vs budget — ' + x.text; }));
                lines = lines.concat(FINE.narrative(pl, 'y_act', 'y_bud', { keyRows: ['REV', 'EBITDA', 'NP'], top: 3, fmt: FL.compact }).map(function (x) { return '• Year to date vs budget — ' + x.text; }));
                lines = lines.concat(FINE.narrative(pl, 'y_act', 'y_py', { keyRows: ['REV', 'NP'], top: 0, fmt: FL.compact }).map(function (x) { return '• Year to date vs last year — ' + x.text; }));
            }
            var tpls = p.templates || FL.templates.map(function (t) { return t.id; }).filter(function (id) { return id !== 'PLS'; });
            FL.modal('<i class="fa-solid fa-book-open"></i> Board pack · ' + esc(FL.periodName(FL.filter.period)),
                '<div class="grid g2"><label class="field">Title<input id="pk-t" value="' + esc(p.title || 'Monthly board pack') + '"></label>' +
                '<label class="field">Company / group name<input id="pk-c" value="' + esc(p.company || 'Grays Group') + '"></label>' +
                '<label class="field">Prepared by<input id="pk-by" value="' + esc(p.by || (FL.who && FL.who.user) || appUser() || '') + '"></label>' +
                '<label class="field">Scope<input value="' + esc(FL.filterText() + ' · amounts in ' + FL.scaleLabel()) + '" disabled></label></div>' +
                '<div class="grid g2" style="margin-top:10px"><div><div class="field">Sections</div>' + SECTIONS.map(function (s) { return '<label style="display:block"><input type="checkbox" data-s="' + s[0] + '"' + (on.indexOf(s[0]) >= 0 ? ' checked' : '') + '> ' + esc(s[1]) + '</label>'; }).join('') + '</div>' +
                '<div><div class="field">Statements</div>' + FL.templates.map(function (t) { return '<label style="display:block"><input type="checkbox" data-t="' + esc(t.id) + '"' + (tpls.indexOf(t.id) >= 0 ? ' checked' : '') + '> ' + esc(t.name) + '</label>'; }).join('') + '</div></div>' +
                '<label class="field" style="margin-top:10px">Commentary (edit freely — it opens the pack)<textarea id="pk-n" rows="8">' + esc(lines.join('\n')) + '</textarea></label>' +
                '<div class="row" style="margin-top:10px"><span class="grow"></span><button class="btn primary" id="pk-go"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate the pack</button></div>');
            $('pk-go').onclick = function () {
                var opt = { title: $('pk-t').value, company: $('pk-c').value, by: $('pk-by').value, note: $('pk-n').value,
                    on: Array.prototype.map.call(document.querySelectorAll('[data-s]:checked'), function (x) { return x.dataset.s; }),
                    templates: Array.prototype.map.call(document.querySelectorAll('[data-t]:checked'), function (x) { return x.dataset.t; }) };
                FL.config.pack = Object.assign(FL.config.pack || {}, { title: opt.title, company: opt.company, by: opt.by, on: opt.on, templates: opt.templates });
                FL.saveConfig().catch(function () { /* not fatal */ });
                $('pk-go').disabled = true; $('pk-go').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Building…';
                FL.buildPack(opt).then(function (html) { FL.closeModal(); FL.packView(html, opt); })
                    .catch(function (e) { console.error(e); FL.toast('Pack failed: ' + (e && e.message || e), 'err'); $('pk-go').disabled = false; $('pk-go').textContent = 'Generate the pack'; });
            };
        });
    };

    /** Renders a Chart.js config to a PNG data URL (off screen). */
    function chartImg(cfg, w, h) {
        if (!window.Chart) return 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';   // no chart library (offline): an empty picture
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.style.cssText = 'position:fixed;left:-9999px;top:0;width:' + w + 'px;height:' + h + 'px';
        document.body.appendChild(cv);
        cfg.options = Object.assign({ responsive: false, animation: false, devicePixelRatio: 2, plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } } }, cfg.options || {});
        var c = new Chart(cv, cfg), url = c.toBase64Image();
        c.destroy(); cv.remove();
        return url;
    }
    FL.chartImg = chartImg;

    FL.buildPack = function (o) {
        var per = FL.filter.period, pname = FL.periodName(per), cfg = FL.config, tm = FL.tplMap();
        return FL.data().then(function (data) {
            var pi = data._pi || (data._pi = FINE.periodIndex(data.periods)), kv = FINE.kpis(cfg.kpis, tm, data, per), i = pi.bySeq[per];
            var kPm = i > 0 ? FINE.kpis(cfg.kpis, tm, data, pi.list[i - 1].period_seq) : {}, kPy = i >= 12 ? FINE.kpis(cfg.kpis, tm, data, pi.list[i - 12].period_seq) : {};
            var mon = FINE.monitor(cfg.monitors, kv);
            var parts = [], on = function (s) { return o.on.indexOf(s) >= 0; };
            var kdef = function (id) { return cfg.kpis.filter(function (k) { return k.id === id; })[0]; };
            var head = cfg.headline.map(kdef).filter(Boolean);
            var tile = function (k) {
                var v = (kv[k.id] || {}).value, py = (kPy[k.id] || {}).value, d = v != null && py != null ? v - py : null, good = d == null ? null : (k.good === 'down' ? d <= 0 : d >= 0);
                return '<div class="tile"><div class="tl">' + esc(k.label) + '</div><div class="tv">' + FL.kfmt(v, k.fmt) + '</div><div class="td ' + (good == null ? '' : good ? 'pos' : 'neg') + '">' + (d == null ? '' : FL.kdelta(d, k.fmt) + ' vs last year') + '</div></div>';
            };
            if (on('summary')) {
                parts.push('<section class="cover"><div class="brand">FINANCE LENS</div><h1>' + esc(o.title) + '</h1><h2>' + esc(o.company) + '</h2><div class="cp">' + esc(pname) + '</div>' +
                    '<div class="cm">' + esc(FL.filterText()) + ' · amounts in ' + FL.scaleLabel() + '<br>Prepared by ' + esc(o.by || '—') + ' on ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + '</div></section>');
                var br = mon.filter(function (m) { return m.status === 'breach'; });
                parts.push('<section><h2>Executive summary</h2><div class="tiles">' + head.map(tile).join('') + '</div>' +
                    (o.note ? '<h3>Commentary</h3><div class="note">' + esc(o.note).replace(/\n/g, '<br>') + '</div>' : '') +
                    '<h3>Attention points</h3>' + (br.length ? '<ul>' + br.map(function (b) { var d = kdef(b.rule.kpi) || {}; return '<li><b>' + esc(b.rule.label) + '</b> — ' + esc(d.label || '') + ' at ' + FL.kfmt(b.value, d.fmt) + ' (' + esc(b.rule.severity) + ')</li>'; }).join('') + '</ul>' : '<p>All monitors are within their limits.</p>') + '</section>');
            }
            if (on('kpis')) {
                var groups = {}; cfg.kpis.forEach(function (k) { (groups[k.group || 'Other'] = groups[k.group || 'Other'] || []).push(k); });
                parts.push('<section class="pb"><h2>Key performance indicators</h2><table class="t"><thead><tr><th>KPI</th><th class="n">' + esc(pname) + '</th><th class="n">Previous month</th><th class="n">Same month last year</th><th>Definition</th></tr></thead><tbody>' +
                    Object.keys(groups).map(function (g) { return '<tr class="g"><td colspan="5">' + esc(g) + '</td></tr>' + groups[g].map(function (k) { return '<tr><td>' + esc(k.label) + '</td><td class="n"><b>' + FL.kfmt((kv[k.id] || {}).value, k.fmt) + '</b></td><td class="n">' + FL.kfmt((kPm[k.id] || {}).value, k.fmt) + '</td><td class="n">' + FL.kfmt((kPy[k.id] || {}).value, k.fmt) + '</td><td class="def">' + esc(k.desc || k.expr) + '</td></tr>'; }).join(''); }).join('') + '</tbody></table></section>');
            }
            if (on('charts') && tm.PL) {
                var m = FL.monthly(data, tm.PL, ['REV', 'NP', 'GM', 'EBITDAM', 'NPM'], { scenario: 'ACTUAL', range: 'MTD' }, 24), b = FL.monthly(data, tm.PL, ['REV'], { scenario: 'BUDGET', range: 'MTD' }, 24);
                var c1 = chartImg({ data: { labels: m.labels, datasets: [{ type: 'bar', label: 'Revenue', data: m.series.REV, backgroundColor: 'rgba(29,78,216,.75)', order: 2 }, { type: 'line', label: 'Budget revenue', data: b.series.REV, borderColor: '#94a3b8', borderDash: [5, 4], pointRadius: 0, order: 1 },
                    { type: 'line', label: 'Net profit', data: m.series.NP, borderColor: '#f59e0b', yAxisID: 'y2', order: 0 }] }, options: { scales: { y: FL.moneyAxis(), y2: Object.assign(FL.moneyAxis(), { position: 'right', grid: { display: false } }) } } }, 1000, 340);
                var c2 = chartImg({ type: 'line', data: { labels: m.labels, datasets: [{ label: 'Gross margin %', data: m.series.GM, borderColor: FL.PAL.series[0], pointRadius: 0 }, { label: 'EBITDA margin %', data: m.series.EBITDAM, borderColor: FL.PAL.series[1], pointRadius: 0 }, { label: 'Net margin %', data: m.series.NPM, borderColor: FL.PAL.series[2], pointRadius: 0 }] } }, 490, 280);
                var pl = FINE.compute(tm.PL, data, { period: per, scale: 1 }), steps = FINE.bridge(pl, 'y_py', 'y_act', 'NP', 'NP', [{ id: 'REV', label: 'Revenue' }, { id: 'COGS', label: 'Cost of sales', sign: -1 }, { id: 'OPEX', label: 'Opex', sign: -1 }, { id: 'OI', label: 'Other inc.' }, { id: 'DA', label: 'D&A', sign: -1 }, { id: 'FIN', label: 'Finance', sign: -1 }, { id: 'TAX', label: 'Tax', sign: -1 }]);
                var run = 0, bars = steps.map(function (s) { if (s.kind !== 'step') { run = s.value; return [0, s.value]; } var r = [run, run + s.value]; run += s.value; return r; });
                var c3 = chartImg({ type: 'bar', data: { labels: steps.map(function (s) { return s.kind === 'start' ? 'YTD last year' : s.kind === 'end' ? 'YTD this year' : s.label; }), datasets: [{ data: bars, backgroundColor: steps.map(function (s) { return s.kind !== 'step' ? '#1d4ed8' : s.value >= 0 ? '#16a34a' : '#dc2626'; }) }] }, options: { plugins: { legend: { display: false } }, scales: { y: FL.moneyAxis() } } }, 490, 280);
                parts.push('<section class="pb"><h2>Performance</h2><img src="' + c1 + '" class="wide"><div class="two"><figure><img src="' + c2 + '"><figcaption>Margins, monthly</figcaption></figure><figure><img src="' + c3 + '"><figcaption>Net profit bridge: year to date, last year → this year</figcaption></figure></div></section>');
            }
            if (on('statements')) {
                o.templates.forEach(function (id) {
                    var t = tm[id]; if (!t) return;
                    var st = FINE.compute(t, data, { period: per, scale: FL.filter.scale });
                    parts.push('<section class="pb"><h2>' + esc(t.name) + '</h2><div class="sub">' + esc(FL.filterText()) + ' · ' + esc(pname) + ' · in ' + FL.scaleLabel() + '</div>' + FL.stmtTable(st, { hideZero: true, print: true }) + '</section>');
                });
            }
            var chain = Promise.resolve();
            if (on('costcentres') && tm.PL) {
                chain = chain.then(function () {
                    return FL.sql("SELECT cost_centre, scenario, account, period_seq, SUM(period_net), SUM(end_bal) FROM fin_balances WHERE cost_centre <> '000'" + (FL.filter.company ? ' AND company = ' + FL.q(FL.filter.company) : '') + ' GROUP BY ALL', 500000).then(function (d) {
                        var by = {}; d.rows.forEach(function (r) { (by[r[0]] = by[r[0]] || []).push(r.slice(1)); });
                        var rows = FL.dims.ccs.filter(function (c) { return by[c.code]; }).map(function (c) {
                            var st = FINE.compute(tm.PL, { accounts: data.accounts, periods: data.periods, facts: FINE.factsFrom(by[c.code]) }, { period: per, scale: 1, columns: [{ id: 'a', range: 'YTD' }, { id: 'b', range: 'YTD', scenario: 'BUDGET' }] });
                            var x = st.rows.filter(function (r) { return r.id === 'OPEX'; })[0] || { values: [0, 0] }, cs = st.rows.filter(function (r) { return r.id === 'COGS'; })[0] || { values: [0, 0] };
                            return { cc: c.code + ' ' + c.name, a: x.values[0] + cs.values[0], b: x.values[1] + cs.values[1] };
                        });
                        parts.push('<section class="pb"><h2>Cost centres against budget</h2><div class="sub">Operating expenses and cost of sales, year to date, in ' + FL.scaleLabel() + '</div><table class="t"><thead><tr><th>Cost centre</th><th class="n">Actual</th><th class="n">Budget</th><th class="n">Variance F/(U)</th><th class="n">%</th></tr></thead><tbody>' +
                            rows.map(function (r) { var v = r.b - r.a; return '<tr><td>' + esc(r.cc) + '</td><td class="n">' + FL.num(r.a) + '</td><td class="n">' + FL.num(r.b) + '</td><td class="n ' + (v >= 0 ? 'pos' : 'neg') + '">' + FL.num(v) + '</td><td class="n">' + (r.b ? (v / Math.abs(r.b) * 100).toFixed(1) + '%' : '') + '</td></tr>'; }).join('') + '</tbody></table></section>');
                    });
                });
            }
            if (on('monitor')) {
                chain = chain.then(function () {
                    parts.push('<section class="pb"><h2>Monitors and covenants</h2><table class="t"><thead><tr><th>Rule</th><th>Severity</th><th class="n">Value</th><th>Status</th></tr></thead><tbody>' +
                        mon.map(function (m) { var d = kdef(m.rule.kpi) || {}; return '<tr><td>' + esc(m.rule.label) + '</td><td>' + esc(m.rule.severity) + '</td><td class="n">' + FL.kfmt(m.value, d.fmt) + '</td><td class="' + (m.status === 'breach' ? 'neg' : 'pos') + '"><b>' + (m.status === 'breach' ? 'ALERT' : m.status === 'ok' ? 'OK' : 'n/a') + '</b></td></tr>'; }).join('') + '</tbody></table></section>');
                });
            }
            if (on('risk')) {
                chain = chain.then(function () {
                    var an = FINE.anomalies(data, per, { z: 3.5 }).slice(0, 8);
                    var seqs = FINE.windowSeqs({ range: 'YTD' }, data, per), w = FL.where('j').concat(['j.period_seq IN (' + seqs.join(',') + ')']).join(' AND ');
                    return FL.sql('SELECT COUNT(DISTINCT je_id) FILTER (WHERE dayofweek(j.posted_at) IN (0, 6)), COUNT(DISTINCT je_id) FILTER (WHERE j.je_source = \'Manual\' AND j.dr + j.cr >= 1000000), ' +
                        "COUNT(DISTINCT je_id) FILTER (WHERE j.account IN (SELECT code FROM fin_accounts WHERE class = 'Suspense')), COUNT(DISTINCT je_id) FROM fin_journals j WHERE " + w).then(function (d) {
                        var r = d.rows[0] || [];
                        parts.push('<section class="pb"><h2>Risk highlights</h2><h3>Unusual account movements this month</h3>' + (an.length ? '<table class="t"><thead><tr><th>Account</th><th class="n">This month</th><th class="n">Typical</th><th class="n">σ</th></tr></thead><tbody>' +
                            an.map(function (a) { return '<tr><td>' + esc(a.code + ' ' + a.name) + '</td><td class="n">' + FL.num(a.value) + '</td><td class="n">' + FL.num(a.typical) + '</td><td class="n">' + a.z.toFixed(1) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p>None.</p>') +
                            '<h3>Journal tests, year to date</h3><table class="t"><tbody><tr><td>Journals posted</td><td class="n">' + (r[3] || 0) + '</td></tr><tr><td>Posted at the weekend</td><td class="n">' + (r[0] || 0) + '</td></tr><tr><td>Manual journals of 1 million or more</td><td class="n">' + (r[1] || 0) + '</td></tr><tr><td>Postings to suspense</td><td class="n">' + (r[2] || 0) + '</td></tr></tbody></table></section>');
                    });
                });
            }
            return chain.then(function () { return packHtml(o, pname, parts); });
        });
    };

    function packHtml(o, pname, parts) {
        var css = '@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font:11px/1.45 "Segoe UI",Arial,sans-serif;color:#0f172a;margin:0}' +
            'section{padding:4mm 2mm}section.pb{page-break-before:always}h2{font-size:17px;color:#0b2545;border-bottom:2px solid #0b2545;padding-bottom:4px;margin:0 0 8px}h3{font-size:12.5px;color:#13315c;margin:14px 0 6px}' +
            '.sub{color:#64748b;font-size:10px;margin:-4px 0 8px}.cover{height:178mm;display:flex;flex-direction:column;justify-content:center;padding:0 22mm;background:linear-gradient(135deg,#0b2545,#1e3a8a 60%,#0d9488);color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
            '.cover .brand{letter-spacing:.3em;font-size:11px;color:#a5f3fc}.cover h1{font-size:34px;margin:10px 0 4px;color:#fff;border:0}.cover h2{font-size:20px;color:#cbd5e1;border:0;font-weight:500}.cover .cp{font-size:26px;font-weight:800;margin:16px 0}.cover .cm{color:#cbd5e1;font-size:12px}' +
            '.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.tile{border:1px solid #e2e8f0;border-radius:8px;padding:7px 10px}.tl{font-size:9.5px;color:#64748b;font-weight:600}.tv{font-size:19px;font-weight:800}.td{font-size:9.5px}' +
            '.pos{color:#15803d}.neg{color:#b91c1c}.note{background:#f8fafc;border-left:3px solid #1d4ed8;padding:8px 12px;border-radius:4px}' +
            'table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}table.t th{background:#13315c;color:#fff;text-align:left;padding:4px 6px;font-size:9.5px;-webkit-print-color-adjust:exact;print-color-adjust:exact}table.t td{padding:3px 6px;border-bottom:1px solid #eef2f7}' +
            '.n{text-align:right;white-space:nowrap}tr.g td{font-weight:700;color:#0b2545;background:#f1f5f9;-webkit-print-color-adjust:exact;print-color-adjust:exact}td.def{color:#64748b;font-size:9.5px}' +
            'table.st th{background:#13315c;color:#fff;text-align:right;padding:4px 7px;font-size:9.5px;-webkit-print-color-adjust:exact;print-color-adjust:exact}table.st th:first-child{text-align:left}table.st td{padding:2.5px 7px;text-align:right;white-space:nowrap;border-bottom:1px solid #f1f5f9}table.st td:first-child{text-align:left;white-space:normal}' +
            'tr.header td{font-weight:700;color:#0b2545;padding-top:7px}tr.blank td{height:6px;border:0}tr.text td{color:#64748b;font-style:italic}tr.b td{font-weight:700}tr.i td{font-style:italic}tr.m td{color:#64748b}tr.tb td{border-top:1px solid #334155}tr.db td{border-bottom:3px double #334155}' +
            'tr.check td{font-size:9px;color:#64748b}tr.check.notok td{color:#b91c1c;font-weight:700}td.fav{color:#15803d}td.unf{color:#b91c1c}img.wide{width:100%;margin-top:4px}.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.two img{width:100%}figure{margin:6px 0}figcaption{font-size:9.5px;color:#64748b;text-align:center}' +
            'ul{margin:4px 0;padding-left:18px}li{margin:2px 0}.foot{color:#94a3b8;font-size:9px;text-align:center;margin-top:10px}';
        return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(o.title + ' — ' + pname) + '</title><style>' + css + '</style></head><body>' + parts.join('') +
            '<div class="foot">' + esc(o.company) + ' · ' + esc(o.title) + ' · ' + esc(pname) + ' · generated by Finance Lens from the general ledger</div></body></html>';
    }

    /** Full-screen viewer with Print / Save HTML */
    FL.packView = function (html, o) {
        var old = document.getElementById('packview'); if (old) old.remove();
        var d = document.createElement('div'); d.id = 'packview';
        d.style.cssText = 'position:fixed;inset:0;background:#334155;z-index:70;display:flex;flex-direction:column';
        d.innerHTML = '<div style="display:flex;gap:8px;align-items:center;padding:8px 14px;background:#0b2545;color:#fff"><b style="flex:1"><i class="fa-solid fa-book-open"></i> ' + esc(o.title) + ' · ' + esc(FL.periodName(FL.filter.period)) + '</b>' +
            '<style>#packview .btn{color:#0b2545}</style><button class="btn" id="pv-print"><i class="fa-solid fa-print"></i> Print / PDF</button><button class="btn" id="pv-save"><i class="fa-solid fa-download"></i> Save HTML</button><button class="btn" id="pv-x"><i class="fa-solid fa-xmark"></i> Close</button></div>' +
            '<iframe id="pv-f" style="flex:1;border:0;background:#fff;width:min(1180px,100%);margin:10px auto;box-shadow:0 10px 40px rgba(0,0,0,.4)"></iframe>';
        document.body.appendChild(d);
        $('pv-f').srcdoc = html;
        $('pv-print').onclick = function () { $('pv-f').contentWindow.focus(); $('pv-f').contentWindow.print(); };
        $('pv-save').onclick = function () { FL.download((o.title + ' ' + FL.periodName(FL.filter.period)).replace(/[^\w -]+/g, '') + '.html', new Blob([html], { type: 'text/html' })); };
        $('pv-x').onclick = function () { d.remove(); };
    };
})();
