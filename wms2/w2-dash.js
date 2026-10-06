/* WMS 2.0 — Control tower: the first screen. Everything for ONE trip date (default tomorrow), read from DuckDB.
   Every tile, stage, trip row and exception drills to the page / trip / order behind it. */
(function () {
    'use strict';
    var W2 = window.W2, esc = W2.esc;

    function tile(id, label, icon, n, sub, cls, go) {
        return '<div class="kpi ' + (cls || '') + '" data-go="' + esc(JSON.stringify(go || [])) + '" id="k-' + id + '"><span class="l"><i class="fa-solid ' + icon + '"></i>' + label + '</span><span class="n">' + n + '</span><span class="s">' + (sub || '&nbsp;') + '</span></div>';
    }
    function wireGo(root) {
        root.querySelectorAll('[data-go]').forEach(function (el) {
            el.onclick = function () { var g = JSON.parse(el.dataset.go || '[]'); if (g.length) W2.go(g[0], g[1] || {}); };
        });
    }

    /** No trips in DuckDB for the date: say WHY — a refresh running now (and its step), or what the last refresh read. */
    function stepsHtml(steps) {
        if (!steps || !steps.length) return '';
        return '<table class="steps"><tr><th></th><th>Step</th><th>Result</th><th>Time</th></tr>' + steps.map(function (s) {
            return '<tr class="' + (s.ok ? '' : 'bad') + '"><td>' + (s.ok ? '<i class="fa-solid fa-check" style="color:var(--good)"></i>' : '<i class="fa-solid fa-xmark" style="color:var(--bad)"></i>') +
                '</td><td><b>' + esc(s.step) + '</b></td><td>' + esc(s.msg || (s.ok ? 'done' : 'failed')) + '</td><td class="muted">' + ((s.ms || 0) / 1000).toFixed(1) + ' s</td></tr>';
        }).join('') + '</table>';
    }
    function emptyDay(main, h, pod, date, live) {
        var S = W2.sync, cur = S.current && S.current.date === date && S.current.pod === pod ? S.current : null;
        var mem = S.lastRun && S.lastRun.date === date && S.lastRun.pod === pod ? S.lastRun : null;
        var get = cur || mem ? Promise.resolve(null) : W2.q("SELECT ts, steps FROM w2_sync_runs WHERE pod = " + W2.lit(pod) + " AND trip_date = " + W2.lit(date) + " ORDER BY ts DESC LIMIT 1").then(function (r) {
            if (!r[0]) return null; var st = []; try { st = JSON.parse(r[0].steps || '[]'); } catch (e) {} return { ts: r[0].ts, steps: st };
        }).catch(function () { return null; });
        return get.then(function (saved) {
            if (!live()) return;
            var last = mem || saved, bad = last ? last.steps.filter(function (s) { return !s.ok; }) : [];
            var tripStep = last && last.steps.filter(function (s) { return s.step === 'trips'; })[0];
            if (cur) {
                h += '<div class="card empty"><i class="fa-solid fa-circle-notch fa-spin"></i><b>Reading ' + W2.dayName(date) + ' (' + date + ', ' + pod + ') from APEX and Fusion…</b><br>' +
                    'Now: <b>' + esc(cur.step || 'starting') + '</b> · ' + Math.round((Date.now() - cur.t0) / 1000) + ' s. The trips appear as soon as the trip lines are saved; Fusion shipment status and MRA follow.' +
                    '<div style="max-width:640px;margin:10px auto 0;text-align:left">' + stepsHtml(cur.steps) + '</div></div>';
            } else if (!last) {
                h += '<div class="card empty"><i class="fa-solid fa-truck"></i><b>' + W2.dayName(date) + ' (' + date + ') has not been read yet.</b><br>Press <b>Refresh</b> to read the trip date from APEX and Fusion into the local copy.' +
                    '<div class="row" style="justify-content:center;margin-top:10px"><button class="btn primary" id="d-sync"><i class="fa-solid fa-rotate"></i> Refresh ' + W2.dayName(date) + '</button></div></div>';
            } else {
                var why = bad.length ? bad.length + ' step(s) failed — the error is in the table.'
                    : tripStep ? 'APEX answered: <b>' + esc(tripStep.msg) + '</b> for ' + date + ' on ' + pod + '. If the WMS shows trips for this date, check the instance (PROD / TEST) in the top bar.'
                    : 'The last refresh did not read the trips.';
                h += '<div class="card empty"><i class="fa-solid fa-' + (bad.length ? 'triangle-exclamation' : 'truck') + '"></i><b>No trips for ' + W2.dayName(date) + ' (' + date + ', ' + pod + ').</b><br>' + why +
                    '<div style="max-width:680px;margin:10px auto 0;text-align:left">' + stepsHtml(last.steps) + '</div>' +
                    '<div class="row" style="justify-content:center;margin-top:10px"><button class="btn primary" id="d-sync"><i class="fa-solid fa-rotate"></i> Refresh again</button>' +
                    '<button class="btn" data-go=\'["data",{}]\'><i class="fa-solid fa-database"></i> Data &amp; sync</button></div></div>';
            }
            h += W2.archHtml();
            main.innerHTML = h; wireGo(main);
            var b = main.querySelector('#d-sync'); if (b) b.onclick = function () { W2.sync.day(date, { full: true }); };
            if (cur) {   // repaint the live step list while the refresh runs
                setTimeout(function () { if (live() && W2.state.page === 'dash') W2.render(); }, 2500);
            }
        });
    }

    W2.page('dash', {
        title: 'Control tower', icon: 'fa-gauge-high',
        render: function (main, params, live) {
            var pod = W2.pod(), date = W2.date();
            if (!W2.state.soft) main.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Reading ' + W2.dayName(date) + ' from the local copy…</div>';
            return Promise.all([
                W2.M.orders(pod, date), W2.M.trips(pod, date),
                W2.qs([
                    "SELECT COUNT(DISTINCT order_number) AS n, COUNT(DISTINCT CASE WHEN order_date <> '' AND order_date < " + W2.lit(W2.addDays(W2.today(), -2)) + " THEN order_number END) AS old FROM w2_pending WHERE pod = " + W2.lit(pod),
                    "SELECT upper(interface_flag) AS flag, changed_by, changed_at FROM w2_mra_flag WHERE upper(instance_name) = " + W2.lit(pod),
                    "SELECT picker, COUNT(*) AS orders, SUM(CASE WHEN stage = 'INTERFACED' THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN stage IN ('STAGED', 'PART STAGED', 'PART INTERFACED') THEN 1 ELSE 0 END) AS staged, " +
                    "SUM(CASE WHEN stage = 'RELEASED' THEN 1 ELSE 0 END) AS released, SUM(wms_lines) AS lines FROM (" + W2.M.ordersSql(pod, date) + " SELECT * FROM o2) x WHERE stage <> 'CANCELLED' GROUP BY 1 ORDER BY orders DESC LIMIT 14"
                ]),
                W2.AP ? W2.AP.summary(pod, date) : Promise.resolve({})
            ]).then(function (r) {
                if (!live()) return;
                var orders = r[0], trips = r[1], pend = r[2][0][0] || {}, flag = (r[2][1][0] || {}).flag, pickers = r[2][2], ap = r[3] || {};
                var f = W2.M.flow(orders), tot = f.trip || 0, lines = orders.reduce(function (s, o) { return s + W2.n(o.wms_lines); }, 0);
                var mraBad = orders.filter(function (o) { return o.mra === 'FAILED' || o.mra === 'CHECK FAILED'; }).length;
                var prBad = orders.filter(function (o) { return o.print_state === 'FAILED'; }).length;
                var toCancel = orders.reduce(function (s, o) { return s + W2.n(o.to_cancel); }, 0);
                var mraOff = flag === 'N';
                var ex = W2.M.exceptions(orders, trips, { autopilotOn: ap.on, mraOff: mraOff, pendingOld: W2.n(pend.old) });
                W2.badges({ autopilot: { n: toCancel, cls: ap.on ? 'warn' : '' }, mra: { n: mraBad }, printing: { n: prBad }, pending: { n: W2.n(pend.n), cls: 'warn' } });

                var h = '<div class="pagehead"><h2>' + W2.dayName(date) + ' <span class="muted" style="font-weight:500;font-size:.9rem">' + new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' · ' + pod + '</span></h2><span class="grow"></span>' +
                    '<span class="tag ' + (mraOff ? 'warn' : 'good') + '" title="WMS_MRA_INTERFACE_CONFIG for ' + pod + '"><i class="fa-solid fa-flag"></i> MRA: ' + (flag ? (mraOff ? 'No' : 'Yes') : '?') + '</span>' +
                    '<span class="tag ' + (ap.on ? 'good' : '') + '" style="cursor:pointer" data-go=\'["autopilot",{}]\'><i class="fa-solid fa-robot"></i> Autopilot ' + (ap.on ? 'on' : 'off') + '</span></div>';

                if (!trips.length && !orders.length) return emptyDay(main, h, pod, date, live);

                h += '<div class="kpis">' +
                    tile('trips', 'Trips', 'fa-truck', W2.fmt(trips.length), W2.fmt(trips.filter(function (t) { return W2.M.tripStage(t) === 'DONE'; }).length) + ' ready to go', '', ['trips', {}]) +
                    tile('orders', 'Orders on trips', 'fa-file-lines', W2.fmt(tot), W2.fmt(lines) + ' line(s)' + (f.cancelled ? ' · ' + f.cancelled + ' cancelled' : ''), '', ['orders', {}]) +
                    tile('picker', 'Picker assigned', 'fa-user-check', W2.pct(f.picker, tot) + '%', W2.fmt(tot - f.picker) + ' without picker', tot - f.picker ? 'warn' : 'good', ['picking', {}]) +
                    tile('released', 'Released to warehouse', 'fa-dolly', W2.pct(f.released, tot) + '%', W2.fmt(tot - f.released) + ' not released', tot - f.released ? 'warn' : 'good', ['pickrelease', {}]) +
                    tile('itf', 'Interfaced', 'fa-circle-check', W2.pct(f.interfaced, tot) + '%', W2.fmt(f.interfaced) + ' of ' + W2.fmt(tot) + ' orders', f.interfaced === tot && tot ? 'good' : '', ['orders', { stage: 'INTERFACED' }]) +
                    tile('mra', 'MRA', 'fa-receipt', mraOff ? 'Off' : W2.fmt(f.mra), mraOff ? 'printing without MRA' : mraBad ? mraBad + ' failed' : W2.fmt(f.interfaced - f.mra) + ' waiting', mraBad ? 'bad' : '', ['mra', {}]) +
                    tile('print', 'Printed', 'fa-print', W2.fmt(f.printed), prBad ? prBad + ' failed' : W2.fmt(tot - f.printed) + ' not printed', prBad ? 'bad' : '', ['printing', {}]) +
                    tile('cancel', 'Lines to cancel', 'fa-ban', W2.fmt(toCancel), W2.fmt(ap.doneToday || 0) + ' cancelled by autopilot today', toCancel && !ap.on ? 'bad' : toCancel ? 'warn' : 'good', ['autopilot', {}]) +
                    tile('pending', 'Pending, not on a trip', 'fa-inbox', W2.fmt(pend.n || 0), W2.n(pend.old) ? W2.fmt(pend.old) + ' older than 2 days' : 'orders', W2.n(pend.old) ? 'warn' : '', ['pending', {}]) +
                    '</div>';

                var st = [['trip', 'On trip', 'fa-truck', null], ['picker', 'Picker assigned', 'fa-user-check', 'nopicker'], ['released', 'Released', 'fa-share-from-square', 'notreleased'], ['staged', 'Picked / staged', 'fa-layer-group', 'notstaged'],
                    ['interfaced', 'Interfaced', 'fa-circle-check', 'notinterfaced'], ['mra', 'MRA done', 'fa-receipt', 'nomra'], ['printed', 'Printed', 'fa-print', 'notprinted']];
                h += '<div class="card" style="margin-top:12px"><h3><i class="fa-solid fa-route"></i>Order flow <small>orders that reached each stage · click a stage for the orders still before it</small></h3><div class="flow">' +
                    st.map(function (s) {
                        var n = f[s[0]], p = W2.pct(n, tot), hot = s[0] !== 'trip' && p < 50 && tot, done = p === 100;
                        return '<div class="stage ' + (hot ? 'hot' : done ? 'done' : '') + '" data-go=\'' + JSON.stringify(['orders', s[3] ? { missing: s[3] } : {}]) + '\'><span class="k"><i class="fa-solid ' + s[2] + '"></i>' + s[1] + '</span><span class="n">' + W2.fmt(n) + ' <small>' + p + '%</small></span><span class="bar"><b style="width:' + p + '%"></b></span></div>';
                    }).join('') + '</div></div>';

                h += '<div class="grid g32" style="margin-top:12px"><div class="card"><h3><i class="fa-solid fa-truck"></i>Trips <small>' + trips.length + ' · click a trip for Trip 360</small><span class="grow"></span><button class="btn sm" data-go=\'["trips",{}]\'>Board</button></h3><div id="d-trips"></div></div>' +
                    '<div class="card"><h3><i class="fa-solid fa-bell"></i>Needs attention <small>' + ex.length + '</small></h3><div class="ex" id="d-ex">' +
                    (ex.length ? ex.map(function (e, i) { return '<div class="exi ' + e.sev + '"><span class="sev"></span><i class="fa-solid ' + e.icon + '"></i><div><div class="t">' + esc(e.t) + '</div><div class="d">' + esc(e.d || '') + '</div></div><button class="btn sm" data-ex="' + i + '">' + esc(e.act) + '</button></div>'; }).join('')
                        : '<div class="exi g"><span class="sev"></span><i class="fa-solid fa-circle-check"></i><div><div class="t">Nothing needs attention</div><div class="d">every order of ' + W2.dayName(date) + ' is on track</div></div><span></span></div>') + '</div></div></div>';

                h += '<div class="grid g3" style="margin-top:12px">' +
                    '<div class="card"><h3><i class="fa-solid fa-person-walking"></i>Picker load <small>orders: interfaced · staged · released · waiting</small></h3><div id="d-pk"></div></div>' +
                    '<div class="card"><h3><i class="fa-solid fa-chart-column"></i>Lines per trip <small>by Fusion shipment status</small></h3><div class="chartbox"><canvas id="d-ch1"></canvas></div></div>' +
                    '<div class="card"><h3><i class="fa-solid fa-chart-pie"></i>MRA &amp; printing</h3><div class="chartbox"><canvas id="d-ch2"></canvas></div></div></div>';

                h += '<div class="grid g2" style="margin-top:12px"><div class="card"><h3><i class="fa-solid fa-robot"></i>Cancellation autopilot <span class="grow"></span><button class="btn sm" data-go=\'["autopilot",{}]\'>Open</button></h3>' + (W2.AP ? W2.AP.tile(ap) : '') + '</div>' +
                    '<div class="card"><h3><i class="fa-solid fa-clock-rotate-left"></i>Latest activity</h3><div class="log" id="d-log" style="max-height:190px"></div></div></div>';

                main.innerHTML = h;
                wireGo(main);
                main.querySelectorAll('[data-ex]').forEach(function (b) { b.onclick = function () { var e = ex[+b.dataset.ex]; if (e.run) e.run(); else W2.go(e.go[0], e.go[1]); }; });

                // trips table
                W2.grid(main.querySelector('#d-trips'), trips, [
                    { k: 'trip_id', t: 'Trip', fmt: function (v) { return '<b class="mono">' + esc(v) + '</b>'; } },
                    { k: 'lorry', t: 'Lorry' },
                    { k: 'orders', t: 'Orders', num: true },
                    { k: 'with_picker', t: 'Pickers', fmt: function (v, t) { return t.orders - v ? '<span class="pill w">' + (t.orders - v) + ' none</span>' : '<span class="pill ok">all</span>'; } },
                    { k: 'itf_lines', t: 'Progress', fmt: function (v, t) { var a = W2.n(t.active_lines) || 1; return '<span class="prog"><b style="width:' + (100 * t.itf_lines / a) + '%"></b><b class="st" style="width:' + (100 * t.stg_lines / a) + '%"></b><b class="rl" style="width:' + (100 * t.rel_lines / a) + '%"></b></span> ' + W2.pct(t.itf_lines, a) + '%'; } },
                    { k: 'mra_ok', t: 'MRA', fmt: function (v, t) { return t.mra_bad ? '<span class="pill x">' + t.mra_bad + ' failed</span>' : '<span class="pill ' + (v >= t.interfaced && t.interfaced ? 'ok' : '') + '">' + v + '/' + t.interfaced + '</span>'; } },
                    { k: 'printed', t: 'Print', fmt: function (v, t) { return t.print_bad ? '<span class="pill x">' + t.print_bad + ' failed</span>' : '<span class="pill ' + (v >= t.orders - t.cancelled && t.orders ? 'ok' : '') + '">' + v + '/' + (t.orders - t.cancelled) + '</span>'; } },
                    { k: 'to_cancel', t: 'Cancel', fmt: function (v, t) { return W2.n(v) ? '<span class="pill w">' + v + ' line(s)</span>' : t.cancelled_w2 ? '<span class="pill">' + t.cancelled_w2 + ' done</span>' : ''; } }
                ], { onRow: function (t) { W2.go('trip', { trip: t.trip_id }); }, max: 200, csv: 'trips-' + date + '.csv' });

                // picker load
                main.querySelector('#d-pk').innerHTML = pickers.length ? pickers.map(function (p) {
                    var n = W2.n(p.orders) || 1;
                    return '<div class="hbar" data-pk="' + esc(p.picker || '') + '"><span class="lbl">' + (p.picker ? esc(p.picker) : '<i class="muted">no picker</i>') + '</span><span class="tr"><b style="width:' + (100 * p.done / n) + '%"></b><s style="width:' + (100 * p.staged / n) + '%"></s><u style="width:' + (100 * p.released / n) + '%"></u></span><span class="num">' + p.orders + ' · ' + W2.fmt(p.lines) + ' ln</span></div>';
                }).join('') : '<div class="empty">No orders.</div>';
                main.querySelectorAll('[data-pk]').forEach(function (e) { e.onclick = function () { W2.go('picking', { picker: e.dataset.pk || '(none)' }); }; });

                // charts
                var tl = trips.slice(0, 30);
                W2.chart(main.querySelector('#d-ch1'), { type: 'bar', data: { labels: tl.map(function (t) { return t.trip_id; }), datasets: [
                    { label: 'Interfaced', data: tl.map(function (t) { return t.itf_lines; }), backgroundColor: '#16a34a' },
                    { label: 'Staged', data: tl.map(function (t) { return t.stg_lines; }), backgroundColor: '#3b82f6' },
                    { label: 'Released', data: tl.map(function (t) { return t.rel_lines; }), backgroundColor: '#93c5fd' },
                    { label: 'Not released', data: tl.map(function (t) { return Math.max(0, t.active_lines - t.itf_lines - t.stg_lines - t.rel_lines); }), backgroundColor: '#e2e8f0' }] },
                    options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
                        onClick: function (e, els) { if (els.length) W2.go('trip', { trip: tl[els[0].index].trip_id }); } } });
                var mraDone = f.mra, mraWait = Math.max(0, f.interfaced - f.mra - mraBad);
                W2.chart(main.querySelector('#d-ch2'), { type: 'doughnut', data: { labels: ['MRA done', 'MRA waiting', 'MRA failed', 'Printed', 'Print failed', 'Not printed'], datasets: [
                    { data: [mraDone, mraWait, mraBad, 0, 0, 0], backgroundColor: ['#16a34a', '#f59e0b', '#dc2626', '#16a34a', '#dc2626', '#e2e8f0'] },
                    { data: [0, 0, 0, f.printed, prBad, Math.max(0, tot - f.printed - prBad)], backgroundColor: ['#16a34a', '#f59e0b', '#dc2626', '#0d9488', '#dc2626', '#e2e8f0'] }] },
                    options: { maintainAspectRatio: false, cutout: '45%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, filter: function (it, d) { return true; } } } } } });

                // activity log
                var lg = main.querySelector('#d-log');
                var paintLog = function () { lg.innerHTML = (W2.sync.log.concat((ap.recent || []).map(function (x) { return { at: x.ts, kind: x.result === 'FAILED' ? 'err' : 'ok', text: 'Autopilot ' + x.result + ' · ' + x.order_number + ' line ' + x.line_number + ' ' + (x.item || '') }; })))
                    .slice(0, 60).map(function (l) { return '<div class="' + (l.kind === 'err' ? 'err' : l.kind === 'warn' ? 'warn' : l.kind === 'ok' ? 'ok' : 'dim') + '">' + esc(l.at) + '  ' + esc(l.text) + '</div>'; }).join('') || '<div class="dim">Nothing yet in this session.</div>'; };
                paintLog();
            });
        }
    });
})();
