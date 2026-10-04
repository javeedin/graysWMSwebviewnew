/* Finance Lens — Segment P&L › KPIs (view `kpi` of FL.segpl): what a CFO wants to see per value of the first group-by segment
   (salesperson, profit centre …) for the chosen periods — headline KPI cards (with the comparison of *Compare with*), plain-language
   insights found by rules (concentration, margin laggards, loss makers, unassigned / default values, revenue without cost of sales,
   movers), a ranking table (share, margins, change, trend, flags; click → the whole statement), a concentration curve, a margin map
   (revenue × gross margin, EBITDA sign) and the drivers of the change. Every number is the statement template computed on that
   value's rows (G.stmt), so it matches the Tree / By columns views. */
(function () {
    var G = FL.segpl; if (!G) return;
    var K = G.kpi = {};
    var esc = window.esc || function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var money = function (v) { return G.money ? G.money(v) : String(v); };
    var pct = function (v, d) { return v == null || !isFinite(v) ? '–' : v.toFixed(d == null ? 1 : d) + '%'; };
    var sgn = function (v, f) { return v == null ? '' : (v > 0 ? '+' : '') + f(v); };

    /** One line of a computed statement by id (first id found), else null */
    K.line = function (st, ids) {
        for (var i = 0; i < ids.length; i++) { var r = st.rows.filter(function (x) { return x.id === ids[i]; })[0]; if (r) return r.values[0] || 0; }
        return null;
    };
    K.metrics = function (st) {
        var rev = K.line(st, ['REV']), cogs = K.line(st, ['COGS', 'COS']), gp = K.line(st, ['GP']), opex = K.line(st, ['OPEX']);
        var ebitda = K.line(st, ['EBITDA', 'EBIT', 'OP']), np = K.line(st, ['NP', 'PBT']);
        if (gp == null && rev != null && cogs != null) gp = rev - cogs;
        return { rev: rev || 0, cogs: cogs || 0, gp: gp || 0, opex: opex || 0, ebitda: ebitda == null ? (gp || 0) - (opex || 0) : ebitda, np: np == null ? ebitda || 0 : np,
            gpm: rev ? (gp || 0) / Math.abs(rev) * 100 : null, em: rev ? (ebitda == null ? (gp || 0) - (opex || 0) : ebitda) / Math.abs(rev) * 100 : null };
    };
    /** A default / blank / "unassigned" value: costs and income parked there are not really owned by anyone */
    K.unassigned = function (f, v) {
        if (v === '' || /^[A-Z]?0+$/i.test(v)) return true;
        var n = (G.valName[f] || {})[v] || '';
        return /default|unassign|not assign|no salesperson|^none$|^n\/?a$|dummy|generic/i.test(n);
    };
    K.METRICS = [['rev', 'Revenue'], ['gp', 'Gross profit'], ['ebitda', 'EBITDA'], ['np', 'Net profit']];

    K.build = function () {
        var s = G.st, f = s.groups[0], cmp = s.cmp !== 'none', ps = s.periods.slice().sort();
        var by = {}, cby = {}, key = function (r) { var v = f === 'company' ? r.company : r[f]; return v == null ? '' : String(v); };
        G.rows.forEach(function (r) { (by[key(r)] = by[key(r)] || []).push(r); });
        (G.cmpRows || []).forEach(function (r) { (cby[key(r)] = cby[key(r)] || []).push(r); });
        if (cmp) Object.keys(cby).forEach(function (v) { if (!by[v]) by[v] = []; });
        var tot = K.metrics(G.total), ctot = cmp ? K.metrics(G.stmt(G.cmpRows || [])) : null;
        var list = Object.keys(by).map(function (v) {
            var m = K.metrics(G.stmt(by[v])), c = cmp ? K.metrics(G.stmt(cby[v] || [])) : null;
            var trend = ps.length >= 3 ? ps.map(function (q) { return K.metrics(G.stmt(by[v].filter(function (r) { return r.period_seq === q; })))[s.kpiMetric || 'rev']; }) : null;
            return { v: v, label: G.valLabel(f, v), rows: by[v], m: m, c: c, trend: trend, un: K.unassigned(f, v) };
        }).filter(function (x) { return ['rev', 'gp', 'opex', 'ebitda', 'np'].some(function (k) { return Math.abs(x.m[k]) >= 0.5 || (x.c && Math.abs(x.c[k]) >= 0.5); }); });
        list.sort(function (a, b) { return Math.abs(b.m.rev) - Math.abs(a.m.rev) || Math.abs(b.m.ebitda) - Math.abs(a.m.ebitda); });
        list.forEach(function (x, i) { x.rank = i + 1; x.share = tot.rev ? x.m.rev / tot.rev * 100 : null; });
        return { f: f, cmp: cmp, tot: tot, ctot: ctot, list: list, ps: ps };
    };

    /** Rules that turn the table into sentences a CFO can act on (good / bad / info), most important first */
    K.insights = function (d) {
        var out = [], L = d.list, T = d.tot, name = G.label(d.f), real = L.filter(function (x) { return !x.un; });
        var revs = real.filter(function (x) { return x.m.rev > 0; }).sort(function (a, b) { return b.m.rev - a.m.rev; });
        var totRev = revs.reduce(function (a, x) { return a + x.m.rev; }, 0);
        if (revs.length >= 5 && totRev > 0) {
            var n20 = Math.max(1, Math.round(revs.length * 0.2)), top20 = revs.slice(0, n20).reduce(function (a, x) { return a + x.m.rev; }, 0) / totRev * 100;
            var top1 = revs[0].m.rev / totRev * 100;
            out.push({ k: top20 >= 70 || top1 >= 30 ? 'bad' : 'info', w: 80, t: 'Concentration: the top ' + n20 + ' of ' + revs.length + ' ' + esc(name.toLowerCase()) + ' values (20%) bring <b>' + pct(top20, 0) + '</b> of revenue; the largest, <b>' + esc(revs[0].label) + '</b>, alone ' + pct(top1, 0) + '.' + (top1 >= 30 ? ' A dependency risk if it is lost.' : '') });
        }
        var un = L.filter(function (x) { return x.un; });
        if (un.length) {
            var uo = un.reduce(function (a, x) { return a + x.m.opex; }, 0), ur = un.reduce(function (a, x) { return a + x.m.rev; }, 0), ue = un.reduce(function (a, x) { return a + x.m.ebitda; }, 0);
            var po = T.opex ? uo / T.opex * 100 : 0, pr = T.rev ? ur / T.rev * 100 : 0;
            if (Math.abs(po) >= 5 || Math.abs(pr) >= 5) out.push({ k: 'bad', w: 95, t: 'Not owned: <b>' + esc(un.map(function (x) { return x.label; }).join(', ')) + '</b> (blank / default) carries ' + pct(pr, 0) + ' of revenue and <b>' + pct(po, 0) + ' of operating expenses</b> (EBITDA ' + money(ue) + '). Until those costs are allocated, every other ' + esc(name.toLowerCase()) + ' looks more profitable than it is.' });
        }
        var loss = real.filter(function (x) { return x.m.ebitda < -0.5; }).sort(function (a, b) { return a.m.ebitda - b.m.ebitda; });
        if (loss.length) out.push({ k: 'bad', w: 90, t: '<b>' + loss.length + '</b> ' + esc(name.toLowerCase()) + ' value' + (loss.length === 1 ? ' is' : 's are') + ' loss-making at EBITDA, together ' + money(loss.reduce(function (a, x) { return a + x.m.ebitda; }, 0)) + ' — worst: ' + loss.slice(0, 3).map(function (x) { return '<b>' + esc(x.label) + '</b> ' + money(x.m.ebitda); }).join(', ') + '.' });
        var med = revs.length ? revs[Math.floor(revs.length / 2)].m.rev : 0, big = revs.filter(function (x) { return x.m.rev >= med && x.m.gpm != null; });
        if (big.length >= 3 && T.gpm != null) {
            var worst = big.slice().sort(function (a, b) { return a.m.gpm - b.m.gpm; })[0], best = big.slice().sort(function (a, b) { return b.m.gpm - a.m.gpm; })[0];
            if (T.gpm - worst.m.gpm >= 5) out.push({ k: 'bad', w: 75, t: 'Margin laggard: <b>' + esc(worst.label) + '</b> sells ' + money(worst.m.rev) + ' at a <b>' + pct(worst.m.gpm) + '</b> gross margin, ' + (T.gpm - worst.m.gpm).toFixed(1) + ' pts below the average ' + pct(T.gpm) + '. At the average margin it would earn ' + money(worst.m.rev * (T.gpm - worst.m.gpm) / 100) + ' more gross profit. Check pricing and discounts.' });
            if (best.m.gpm - T.gpm >= 5) out.push({ k: 'good', w: 50, t: 'Best margin among the larger ones: <b>' + esc(best.label) + '</b> at ' + pct(best.m.gpm) + ' on ' + money(best.m.rev) + ' revenue.' });
        }
        var noCost = real.filter(function (x) { return x.m.rev > 0 && x.m.gpm != null && x.m.gpm >= 99 && Math.abs(x.m.cogs) < 0.01 * x.m.rev; });
        if (noCost.length) out.push({ k: 'bad', w: 70, t: '<b>' + noCost.length + '</b> value' + (noCost.length === 1 ? ' has' : 's have') + ' revenue but almost no cost of sales (' + noCost.slice(0, 4).map(function (x) { return esc(x.label); }).join(', ') + (noCost.length > 4 ? ' …' : '') + ') — their ~100% gross margin is probably a posting gap: cost of sales is landing on another (default) value.' });
        var costOnly = real.filter(function (x) { return Math.abs(x.m.rev) < 0.5 && x.m.opex > 0; });
        if (costOnly.length) out.push({ k: 'info', w: 40, t: costOnly.length + ' value' + (costOnly.length === 1 ? ' has' : 's have') + ' costs but no revenue (' + money(costOnly.reduce(function (a, x) { return a + x.m.opex; }, 0)) + ') — overhead centres, or revenue posted elsewhere.' });
        if (d.cmp && d.ctot) {
            var dr = T.rev - d.ctot.rev, de = T.ebitda - d.ctot.ebitda;
            out.push({ k: de >= 0 ? 'good' : 'bad', w: 85, t: 'Versus the comparison: revenue ' + sgn(dr, money) + ' (' + (d.ctot.rev ? sgn(dr / Math.abs(d.ctot.rev) * 100, function (v) { return pct(v); }) : 'new') + '), EBITDA ' + sgn(de, money) + '.' });
            var mv = L.filter(function (x) { return x.c; }).map(function (x) { return { x: x, d: x.m.ebitda - x.c.ebitda }; }).sort(function (a, b) { return a.d - b.d; });
            if (mv.length >= 2) {
                var up = mv[mv.length - 1], dn = mv[0];
                if (up.d > 0.5) out.push({ k: 'good', w: 65, t: 'Biggest EBITDA gain: <b>' + esc(up.x.label) + '</b> ' + sgn(up.d, money) + (up.x.c.rev ? ' (revenue ' + sgn((up.x.m.rev - up.x.c.rev) / Math.abs(up.x.c.rev) * 100, function (v) { return pct(v); }) + ')' : '') + '.' });
                if (dn.d < -0.5) out.push({ k: 'bad', w: 66, t: 'Biggest EBITDA drop: <b>' + esc(dn.x.label) + '</b> ' + sgn(dn.d, money) + (dn.x.c.rev ? ' (revenue ' + sgn((dn.x.m.rev - dn.x.c.rev) / Math.abs(dn.x.c.rev) * 100, function (v) { return pct(v); }) + ')' : '') + '.' });
            }
            var lost = L.filter(function (x) { return x.c && Math.abs(x.m.rev) < 0.5 && x.c.rev > 0.5; });
            if (lost.length) out.push({ k: 'bad', w: 60, t: lost.length + ' value' + (lost.length === 1 ? '' : 's') + ' had revenue in the comparison period and none now (' + lost.slice(0, 4).map(function (x) { return esc(x.label) + ' ' + money(x.c.rev); }).join(', ') + ').' });
        }
        return out.sort(function (a, b) { return b.w - a.w; });
    };

    K.spark = function (vals) {
        if (!vals || vals.length < 2) return '';
        var w = 70, h = 18, mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), rg = mx - mn || 1;
        var pts = vals.map(function (v, i) { return (i * (w - 4) / (vals.length - 1) + 2).toFixed(1) + ',' + (h - 2 - (v - mn) / rg * (h - 4)).toFixed(1); }).join(' ');
        return '<svg width="' + w + '" height="' + h + '" class="sk-spark"><polyline points="' + pts + '" fill="none" stroke="' + FL.PAL.act + '" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    };

    G.viewKpi = function (out) {
        var s = G.st;
        if (!s.groups.length) { out.innerHTML = '<div class="card sp-card"><p>Add a segment on the left (e.g. <b>Salesperson</b>) — the KPIs rank its values.</p></div>'; G.out = null; return; }
        var d = K.build(), T = d.tot, C = d.ctot, name = G.label(d.f), metric = s.kpiMetric || 'rev', mName = (K.METRICS.filter(function (m) { return m[0] === metric; })[0] || K.METRICS[0])[1];
        var CL = s.cmp === 'py' ? 'last year' : 'previous';
        var card = function (lbl, v, cv, fmt, sub, goodDown) {
            var ch = C && cv != null ? (cv ? (v - cv) / Math.abs(cv) * 100 : null) : null, tone = ch == null || Math.abs(ch) < 0.05 ? '' : (goodDown ? ch < 0 : ch > 0) ? 'pos' : 'neg';
            return '<div class="sk-card"><div class="sk-l">' + esc(lbl) + '</div><div class="sk-v">' + fmt(v) + '</div>' +
                (sub ? '<div class="sk-s">' + sub + '</div>' : '') + (C && cv != null ? '<div class="sk-s ' + tone + '">' + (ch == null ? 'new' : sgn(ch, function (x) { return pct(x); })) + ' vs ' + CL + ' · was ' + fmt(cv) + '</div>' : '') + '</div>';
        };
        var real = d.list.filter(function (x) { return !x.un; }), loss = real.filter(function (x) { return x.m.ebitda < -0.5; });
        var revs = real.filter(function (x) { return x.m.rev > 0; }), totRev = revs.reduce(function (a, x) { return a + x.m.rev; }, 0);
        var top5 = totRev ? revs.slice(0, 5).reduce(function (a, x) { return a + x.m.rev; }, 0) / totRev * 100 : null;
        var un = d.list.filter(function (x) { return x.un; }), unOpex = un.reduce(function (a, x) { return a + x.m.opex; }, 0);
        var ins = K.insights(d);
        var cards = card('Revenue', T.rev, C && C.rev, money) +
            card('Gross profit', T.gp, C && C.gp, money, 'margin ' + pct(T.gpm)) +
            card('Operating expenses', T.opex, C && C.opex, money, T.rev ? pct(T.opex / Math.abs(T.rev) * 100) + ' of revenue' : '', true) +
            card('EBITDA', T.ebitda, C && C.ebitda, money, 'margin ' + pct(T.em)) +
            card('Net profit', T.np, C && C.np, money) +
            '<div class="sk-card"><div class="sk-l">Active ' + esc(name.toLowerCase()) + ' values</div><div class="sk-v">' + real.length + '</div><div class="sk-s">' + revs.length + ' with revenue · avg ' + money(revs.length ? totRev / revs.length : 0) + '</div></div>' +
            '<div class="sk-card"><div class="sk-l">Loss-making at EBITDA</div><div class="sk-v' + (loss.length ? ' neg' : '') + '">' + loss.length + '</div><div class="sk-s">' + (loss.length ? money(loss.reduce(function (a, x) { return a + x.m.ebitda; }, 0)) : 'none') + '</div></div>' +
            '<div class="sk-card"><div class="sk-l">Top 5 share of revenue</div><div class="sk-v">' + pct(top5, 0) + '</div><div class="sk-s">concentration</div></div>' +
            (un.length ? '<div class="sk-card"><div class="sk-l">Opex not owned (blank / default)</div><div class="sk-v' + (T.opex && Math.abs(unOpex / T.opex) >= 0.05 ? ' neg' : '') + '">' + pct(T.opex ? unOpex / T.opex * 100 : null, 0) + '</div><div class="sk-s">' + money(unOpex) + '</div></div>' : '');
        out.innerHTML = '<div class="sk-wrap">' +
            '<div class="row sm" style="flex-wrap:wrap;gap:10px;margin-bottom:8px"><b>KPIs by ' + esc(name) + '</b><span class="muted">' + esc(d.ps.map(G.pname).join(', ')) + (d.cmp ? ' vs ' + CL : '') + '</span><span class="grow"></span>' +
            '<label>Compare with <select id="sk-cmp">' + [['none', 'nothing'], ['py', 'same period last year'], ['prev', 'previous period' + (d.ps.length > 1 ? 's' : '')]].map(function (o) { return '<option value="' + o[0] + '"' + (s.cmp === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
            '<label>Rank and chart by <select id="sk-m">' + K.METRICS.map(function (m) { return '<option value="' + m[0] + '"' + (metric === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select></label>' +
            '<button class="btn sm" id="sk-ask"><i class="fa-solid fa-wand-magic-sparkles"></i> Ask the Copilot</button></div>' +
            '<div class="sk-cards">' + cards + '</div>' +
            '<div class="sk-grid"><div class="card"><h3><i class="fa-solid fa-lightbulb"></i> What stands out</h3>' + (ins.length ? '<ul class="sk-ins">' + ins.map(function (i) { return '<li class="' + i.k + '"><span class="sk-ic">' + (i.k === 'good' ? '▲' : i.k === 'bad' ? '!' : 'i') + '</span><span>' + i.t + '</span></li>'; }).join('') + '</ul>' : '<p class="muted sm">Nothing unusual in this choice.</p>') + '</div>' +
            '<div class="card"><h3>Margin map <span class="muted sm">revenue × gross margin · dashed = average margin</span></h3><div class="sk-ch"><canvas id="sk-map"></canvas></div></div></div>' +
            '<div class="sk-grid"><div class="card"><h3>Concentration <span class="muted sm">cumulative share of ' + esc(mName.toLowerCase()) + '</span></h3><div class="sk-ch"><canvas id="sk-con"></canvas></div></div>' +
            '<div class="card"><h3>' + (d.cmp ? 'What drove the change in ' + esc(mName) : esc(mName) + ' by ' + esc(name)) + ' <span class="muted sm">' + (d.cmp ? 'vs ' + CL + ', top 12' : 'top 12') + '</span></h3><div class="sk-ch"><canvas id="sk-drv"></canvas></div></div></div>' +
            '<div class="card"><h3>Ranking <span class="muted sm">click a row for its full statement · ⚑ flags</span></h3><div id="sk-tbl"></div></div></div>';

        // charts
        var pal = FL.PAL;
        var pts = real.filter(function (x) { return x.m.rev > 0 && x.m.gpm != null; });
        var clampY = function (v) { return Math.max(-100, Math.min(100, v)); };   // a tiny revenue can give a -1,000% margin; the tooltip keeps the real figure
        var xs = pts.map(function (x) { return x.m.rev; }), xmin = Math.min.apply(null, xs.concat([0])), xmax = Math.max.apply(null, xs.concat([1]));
        FL.chart('sk-map', { type: 'scatter', data: { datasets: [
            { label: 'EBITDA positive', data: pts.filter(function (x) { return x.m.ebitda >= 0; }).map(function (x) { return { x: x.m.rev, y: clampY(x.m.gpm), g: x.m.gpm, n: x.label, e: x.m.ebitda }; }), backgroundColor: pal.good, borderColor: '#fff', borderWidth: 2, pointRadius: 6, pointHoverRadius: 8 },
            { label: 'EBITDA negative', data: pts.filter(function (x) { return x.m.ebitda < 0; }).map(function (x) { return { x: x.m.rev, y: clampY(x.m.gpm), g: x.m.gpm, n: x.label, e: x.m.ebitda }; }), backgroundColor: pal.bad, borderColor: '#fff', borderWidth: 2, pointRadius: 6, pointHoverRadius: 8, pointStyle: 'triangle' },
            { label: 'Average margin', type: 'line', data: [{ x: xmin, y: clampY(T.gpm || 0) }, { x: xmax, y: clampY(T.gpm || 0) }], borderColor: '#94a3b8', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 }] },
            options: { interaction: { mode: 'nearest', intersect: true }, plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 } } }, tooltip: { filter: function (i) { return i.datasetIndex < 2; }, callbacks: { label: function (c) { var r = c.raw; return r.n + ': revenue ' + money(r.x) + ' · GP ' + pct(r.g) + ' · EBITDA ' + money(r.e); } } } },
                scales: { x: Object.assign(FL.moneyAxis(), { title: { display: true, text: 'Revenue' } }), y: { title: { display: true, text: 'Gross margin %' }, ticks: { callback: function (v) { return v + '%'; }, font: { size: 10 } }, grid: { color: '#f1f5f9' } } } } });
        var conv = real.map(function (x) { return x.m[metric]; }).filter(function (v) { return v > 0; }).sort(function (a, b) { return b - a; }), csum = conv.reduce(function (a, v) { return a + v; }, 0), run = 0;
        var cpts = [{ x: 0, y: 0 }].concat(conv.map(function (v, i) { run += v; return { x: (i + 1) / conv.length * 100, y: csum ? run / csum * 100 : 0 }; }));
        FL.chart('sk-con', { type: 'line', data: { datasets: [
            { label: mName, data: cpts, borderColor: pal.act, backgroundColor: 'rgba(29,78,216,.08)', fill: 'origin', borderWidth: 2, pointRadius: 0, tension: 0.2 },
            { label: 'Equal shares', data: [{ x: 0, y: 0 }, { x: 100, y: 100 }], borderColor: '#94a3b8', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 }] },
            options: { interaction: { mode: 'nearest', intersect: false }, plugins: { tooltip: { filter: function (i) { return i.datasetIndex === 0; }, callbacks: { label: function (c) { return 'top ' + c.raw.x.toFixed(0) + '% of values = ' + c.raw.y.toFixed(0) + '% of ' + mName.toLowerCase(); } } } },
                scales: { x: { type: 'linear', min: 0, max: 100, title: { display: true, text: '% of ' + name.toLowerCase() + ' values (largest first)' }, ticks: { callback: function (v) { return v + '%'; }, font: { size: 10 } }, grid: { color: '#f1f5f9' } },
                    y: { min: 0, max: 100, ticks: { callback: function (v) { return v + '%'; }, font: { size: 10 } }, grid: { color: '#f1f5f9' } } } } });
        var drv = d.cmp ? d.list.map(function (x) { return { n: x.label, v: x.m[metric] - (x.c ? x.c[metric] : 0) }; }) : d.list.map(function (x) { return { n: x.label, v: x.m[metric] }; });
        drv = drv.filter(function (x) { return Math.abs(x.v) >= 0.5; }).sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); }).slice(0, 12);
        FL.chart('sk-drv', { type: 'bar', data: { labels: drv.map(function (x) { return x.n.length > 28 ? x.n.slice(0, 27) + '…' : x.n; }),
            datasets: [{ label: d.cmp ? 'Change in ' + mName : mName, data: drv.map(function (x) { return x.v; }), backgroundColor: drv.map(function (x) { return x.v >= 0 ? pal.good : pal.bad; }), borderRadius: 4, barPercentage: 0.7 }] },
            options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return (d.cmp ? 'change ' : '') + sgn(c.raw, money); } } } }, scales: { x: FL.moneyAxis(), y: { ticks: { font: { size: 10 } }, grid: { display: false } } } } });

        // ranking
        var flags = function (x) {
            var f = [];
            if (x.un) f.push('<span class="tag warn" title="blank / default value — costs here are not owned">not owned</span>');
            if (x.m.ebitda < -0.5) f.push('<span class="tag bad">loss</span>');
            if (x.m.rev > 0 && x.m.gpm != null && x.m.gpm >= 99 && Math.abs(x.m.cogs) < 0.01 * x.m.rev) f.push('<span class="tag warn" title="revenue without cost of sales">no COGS</span>');
            else if (x.m.rev > 0 && T.gpm != null && x.m.gpm != null && T.gpm - x.m.gpm >= 10) f.push('<span class="tag bad" title="10+ pts below the average gross margin">low margin</span>');
            if (x.c && x.c.rev > 0.5 && Math.abs(x.m.rev) < 0.5) f.push('<span class="tag bad">lost</span>');
            if (x.c && Math.abs(x.c.rev) < 0.5 && x.m.rev > 0.5) f.push('<span class="tag good">new</span>');
            return f.join(' ');
        };
        var sc = FL.filter.scale || 1, num = function (k, lbl) { return { label: lbl, n: 1, val: function (x) { return Math.round(x.m[k] / sc * 100) / 100; }, get: function (x) { return money(x.m[k]); } }; };
        var cols = [{ label: '#', n: 1, key: 'rank' }, { label: name, key: 'label' }, num('rev', 'Revenue'), { label: 'Share', n: 1, val: function (x) { return x.share == null ? null : Math.round(x.share * 10) / 10; }, get: function (x) { return pct(x.share); } },
            num('gp', 'Gross profit'), { label: 'GP %', n: 1, val: function (x) { return x.m.gpm == null ? null : Math.round(x.m.gpm * 10) / 10; }, get: function (x) { return pct(x.m.gpm); } },
            num('opex', 'Opex'), num('ebitda', 'EBITDA'), { label: 'EBITDA %', n: 1, val: function (x) { return x.m.em == null ? null : Math.round(x.m.em * 10) / 10; }, get: function (x) { return pct(x.m.em); } }];
        if (d.cmp) cols.push(
            { label: 'Revenue Δ %', n: 1, html: 1, val: function (x) { return x.c && x.c.rev ? Math.round((x.m.rev - x.c.rev) / Math.abs(x.c.rev) * 1000) / 10 : null; }, get: function (x) { var v = x.c && x.c.rev ? (x.m.rev - x.c.rev) / Math.abs(x.c.rev) * 100 : null; return v == null ? '' : '<span class="' + (v >= 0 ? 'pos' : 'neg') + '">' + sgn(v, function (z) { return pct(z); }) + '</span>'; } },
            { label: 'EBITDA Δ', n: 1, html: 1, val: function (x) { return x.c ? Math.round((x.m.ebitda - x.c.ebitda) / sc) : null; }, get: function (x) { var v = x.c ? x.m.ebitda - x.c.ebitda : null; return v == null ? '' : '<span class="' + (v >= 0 ? 'pos' : 'neg') + '">' + sgn(v, money) + '</span>'; } });
        if (d.ps.length >= 3) cols.push({ label: mName + ' trend', html: 1, val: function () { return ''; }, get: function (x) { return K.spark(x.trend); } });
        cols.push({ label: 'Flags', html: 1, val: function (x) { return flags(x).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }, get: flags });
        FL.grid($('sk-tbl'), cols, d.list, { id: 'sk-rank-' + d.f + (d.cmp ? '-c' : '') + (d.ps.length >= 3 ? '-t' : ''), height: '60vh', max: 1000, csv: 'segment-kpis.csv', click: function (x) { G.full({ rows: x.rows, label: name + ' ' + x.label }); } });
        G.out = { head: cols.filter(function (c) { return c.label !== mName + ' trend'; }).map(function (c) { return c.label; }), rows: d.list.map(function (x) { return cols.filter(function (c) { return c.label !== mName + ' trend'; }).map(function (c) { return c.val ? c.val(x) : x[c.key]; }); }) };

        $('sk-cmp').onchange = function () { s.cmp = this.value; FL.lsSet('segpl', Object.assign({}, s, { open: undefined })); G.run(); };
        $('sk-m').onchange = function () { s.kpiMetric = this.value; FL.lsSet('segpl', Object.assign({}, s, { open: undefined })); G.draw(); };
        $('sk-ask').onclick = function () {
            var lines = d.list.slice(0, 25).map(function (x) { return '- ' + x.label + ': revenue ' + Math.round(x.m.rev) + ', GP ' + Math.round(x.m.gp) + ' (' + pct(x.m.gpm) + '), opex ' + Math.round(x.m.opex) + ', EBITDA ' + Math.round(x.m.ebitda) + (x.c ? ', comparison revenue ' + Math.round(x.c.rev) + ', EBITDA ' + Math.round(x.c.ebitda) : '') + (x.un ? ' [blank/default value]' : ''); }).join('\n');
            FL.copilot.ask('Review the P&L by ' + name + ' for ' + d.ps.map(G.pname).join(', ') + (d.cmp ? ' compared with ' + CL : '') + ' (amounts in the ledger currency, units). Totals: revenue ' + Math.round(T.rev) + ', GP ' + Math.round(T.gp) + ', EBITDA ' + Math.round(T.ebitda) + '.\n' + lines +
                '\nGive me the 5 things a CFO should act on (who to look at, why, the money at stake), and what to check in the data (unassigned costs, missing cost of sales).');
        };
    };
})();
