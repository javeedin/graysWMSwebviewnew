/* WMS 2.0 — Tomorrow check: a pre-mortem of a trip date. Which orders will most likely NOT leave as planned
   (out-of-stock lines the autopilot will cancel, orders that ship empty, free items left behind, orders Fusion has no
   lines for, MRA failures — the order's own and its customer's history —, no picker, the same order on two trips,
   pending orders of the same customer that could ride along) and the fix for each, while there is still time.
   Risk rules: w2-premortem-engine.js (W2PM, node-tested). Data: the DuckDB copy (o2, w2_order_lines, w2_pending) +
   the autopilot preview + WMS_MRA_INTERFACE_STATUS history from APEX (read-only).
   Evening run (Settings on the page, per PC): from a set time the page refreshes tomorrow, checks it, keeps the result
   as a snapshot (w2_premortem) and can send a Teams / e-mail alert; the next day the page scores the forecast. */
(function () {
    'use strict';
    var W2 = window.W2, P = window.W2PM, esc = W2.esc;
    var T = W2.tomorrow = { cache: {} };
    W2.SCHEMA.w2_premortem = ['pod', 'trip_date', 'ts', 'by_user', 'pc', 'order_number', 'trip_id', 'customer', 'kind', 'sev', 'score', 'title', 'why'];
    var openedOnTomorrow = /^#tomorrow\b/.test(location.hash || '');
    var SEV = { 3: ['x', 'High'], 2: ['w', 'Medium'], 1: ['b', 'Low'] };

    T.settings = function () { return Object.assign({ auto: true, at: '18:00', alert: false, hook: '', email: '' }, W2.ls('w2.pm') || {}); };

    // ── APEX: MRA history per customer (read-only, cached 30 min) ──
    function chunks(a, n) { var o = []; for (var i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }
    T.mraHistory = function (pod, customers) {
        var key = pod + '|' + customers.slice().sort().join(','), c = T.cache[key];
        if (c && Date.now() - c.t < 30 * 60000) return Promise.resolve(c.v);
        var keep = "KEEP (DENSE_RANK LAST ORDER BY created_date, id)";
        var reads = chunks(customers.filter(Boolean), 300).map(function (list) {
            return W2.apexRows("SELECT customer_number, COUNT(*) AS tries, SUM(CASE WHEN mra_interface_status = 'FAILED' THEN 1 ELSE 0 END) AS failed, " +
                "SUM(CASE WHEN mra_interface_status = 'FAILED' AND gateway_problem IS NOT NULL THEN 1 ELSE 0 END) AS gw, " +
                "MAX(mra_interface_status) " + keep + " AS last_status, MAX(SUBSTR(failed_reason, 1, 300)) " + keep + " AS last_reason, " +
                "MAX(failed_step) " + keep + " AS last_step, MAX(gateway_problem) " + keep + " AS last_gw " +
                "FROM wms_mra_interface_status WHERE instance_name = " + W2.lit(pod) + " AND created_date >= SYSDATE - 120 AND customer_number IN (" + list.map(W2.lit).join(', ') + ") GROUP BY customer_number", 400);
        });
        var gw = W2.apexRows("SELECT TO_CHAR(created_date, 'HH24') AS hh, COUNT(*) AS n FROM wms_mra_interface_status WHERE instance_name = " + W2.lit(pod) +
            " AND created_date >= SYSDATE - 7 AND gateway_problem IS NOT NULL GROUP BY TO_CHAR(created_date, 'HH24')", 30);
        return Promise.all([Promise.all(reads), gw]).then(function (r) {
            var cust = {};
            [].concat.apply([], r[0]).forEach(function (x) {
                cust[x.CUSTOMER_NUMBER] = { tries: +x.TRIES || 0, failed: +x.FAILED || 0, gw: +x.GW || 0, lastStatus: x.LAST_STATUS, lastReason: x.LAST_REASON, lastStep: x.LAST_STEP, lastGw: x.LAST_GW || '' };
            });
            var tot = 0, peak = null, max = 0;
            r[1].forEach(function (x) { var n = +x.N || 0; tot += n; if (n > max) { max = n; peak = +x.HH; } });
            var v = { customers: cust, gateway: { timeouts: tot, peakHour: peak } };
            T.cache[key] = { t: Date.now(), v: v };
            return v;
        }).catch(function (e) { console.warn('[W2 tomorrow] MRA history not read:', e); return { customers: {}, gateway: null, error: String(e) }; });
    };

    /** Everything the engine needs for one date → W2PM.assess(...) + the inputs. */
    T.check = function (pod, date) {
        var P_ = W2.lit(pod), D = W2.lit(date);
        var apOn = W2.AP && W2.AP.settings && W2.AP.settings.pod === pod ? Promise.resolve(W2.AP.settings) : (W2.AP ? W2.AP.load() : Promise.resolve({}));
        return Promise.all([
            W2.M.orders(pod, date),
            W2.AP ? W2.AP.preview(pod, date).catch(function () { return []; }) : Promise.resolve([]),
            W2.qs([
                "SELECT order_number, COUNT(*) AS total, SUM(CASE WHEN upper(COALESCE(status, '')) LIKE '%CANCEL%' THEN 0 ELSE 1 END) AS live FROM w2_order_lines WHERE pod = " + P_ + " AND trip_date = " + D + " GROUP BY 1",
                "SELECT upper(interface_flag) AS flag FROM w2_mra_flag WHERE upper(instance_name) = " + P_,
                "SELECT order_number, account_name, account_number, order_date FROM w2_pending WHERE pod = " + P_,
                "SELECT ts, steps FROM w2_sync_runs WHERE pod = " + P_ + " AND trip_date = " + D + " ORDER BY ts DESC LIMIT 1"
            ]),
            apOn.catch(function () { return {}; })
        ]).then(function (r) {
            var orders = r[0], sets = {}, counts = {};
            r[1].forEach(function (x) { sets[x.order_number] = x.set; });
            r[2][0].forEach(function (x) { counts[x.order_number] = { total: +x.total, live: +x.live }; });
            var customers = Array.from(new Set(orders.map(function (o) { return String(o.account_number || '').trim(); }).filter(Boolean)));
            var mraOn = (r[2][1][0] || {}).flag !== 'N';
            return (mraOn && customers.length ? T.mraHistory(pod, customers) : Promise.resolve({ customers: {}, gateway: null })).then(function (h) {
                var res = P.assess({
                    orders: orders, cancelSets: sets, lineCounts: counts, autopilotOn: !!(r[3] && r[3].on), mraOn: mraOn,
                    mraCustomers: h.customers, mraGateway: h.gateway, pending: r[2][2],
                    orderLinesRead: !orders.length || r[2][0].length > 0
                });
                res.orders = orders; res.lastSync = r[2][3][0] || null; res.mraError = h.error; res.autopilot = r[3] || {}; res.mraOn = mraOn;
                return res;
            });
        });
    };

    /** Keeps the forecast of a date (replaces this run's rows only — earlier snapshots stay for scoring). */
    T.saveSnapshot = function (pod, date, res) {
        var ts = W2.now(), by = W2.user(), pc = W2.pc();
        var rows = res.risks.map(function (x) { return { pod: pod, trip_date: date, ts: ts, by_user: by, pc: pc, order_number: x.order, trip_id: x.trip, customer: x.customer, kind: x.kind, sev: String(x.sev), score: String(x.score), title: x.title, why: String(x.why || '').slice(0, 500) }; });
        if (!rows.length) rows.push({ pod: pod, trip_date: date, ts: ts, by_user: by, pc: pc, order_number: '', kind: 'NONE', sev: '0', title: 'No risk found' });
        return W2.put('w2_premortem', { pod: pod, trip_date: date, ts: ts }, rows).then(function () { return ts; });
    };

    /** The forecast made BEFORE the date started, scored against what the date looks like now. */
    T.accuracy = function (pod, date, orders) {
        if (date > W2.today()) return Promise.resolve(null);
        return W2.q("SELECT order_number, kind, ts FROM w2_premortem WHERE pod = " + W2.lit(pod) + " AND trip_date = " + W2.lit(date) +
            " AND ts = (SELECT max(ts) FROM w2_premortem WHERE pod = " + W2.lit(pod) + " AND trip_date = " + W2.lit(date) + " AND ts < " + W2.lit(date + 'T00:00:00') + ")").then(function (rows) {
            if (!rows.length) return null;
            var s = P.score(rows.filter(function (x) { return x.kind !== 'NONE'; }).map(function (x) { return { order: x.order_number, kind: x.kind }; }), orders);
            s.ts = rows[0].ts; return s;
        }).catch(function () { return null; });
    };

    // ── fixes ──────────────────────────────────────────────────
    T.fix = function (r, o, done) {
        var pod = W2.pod(), date = W2.date();
        var reread = function (only) { return W2.sync.day(date, { only: only, auto: true }).then(function () { if (done) done(); }); };
        switch (r.fix) {
            case 'future':
            case 'remove':
                if (typeof window.openMoveOrderToTrip !== 'function') { W2.go('trip', { trip: r.trip, order: r.order }); return; }
                if (W2.ws && W2.ws.feed) { try { W2.ws.feed(); } catch (e) {} }
                window.openMoveOrderToTrip({ orderNumber: r.order, fromTripId: r.trip, instance: pod, row: W2.legacyRow ? W2.legacyRow(o || {}) : (o || {}), onMoved: function () { reread(['trips', 'lines']); } });
                if (r.fix === 'future') W2.toast('Choose trip ' + (window.FUTURE_TRIP_ID || '999999999') + ' (Future trip) to keep the order off tomorrow until stock arrives.', 'info');
                return;
            case 'details': if (o) W2.openOrderDialog(o); else W2.go('trip', { trip: r.trip, order: r.order }); return;
            case 'mra': W2.MRA.history(r.order, pod); return;
            case 'picker': W2.ws.run(r.trip, 'assignPickerToTrip', [r.order]); return;
            case 'refresh': W2.sync.day(date, { only: ['shipment', 'orderlines'] }).then(function () { if (done) done(); }); return;
            case 'addon': W2.toast('On trip ' + r.trip + ' use Add Orders and add ' + (r.extra || 'the pending order') + '.', 'info'); W2.go('trip', { trip: r.trip }); return;
            case 'autopilot': W2.go('autopilot'); return;
            default: W2.go('trip', { trip: r.trip, order: r.order });
        }
    };
    var SYS_LABEL = { mra: 'Open MRA', autopilot: 'Autopilot', refresh: 'Read again' };
    var FIX_LABEL = { future: 'Move to Future trip', remove: 'Move off the trip', details: 'Order details', mra: 'MRA tries', picker: 'Assign picker', refresh: 'Read again', addon: 'Open trip', trip: 'Open trip', autopilot: 'Autopilot' };

    function gauge(pct) {
        var c = pct >= 90 ? 'var(--good)' : pct >= 70 ? 'var(--warn)' : 'var(--bad)';
        return '<div class="pm-gauge" style="--p:' + pct + ';--c:' + c + '"><b>' + pct + '%</b><span>ready</span></div>';
    }

    W2.page('tomorrow', {
        title: 'Tomorrow check', icon: 'fa-moon',
        render: function (main, params, live) {
            var pod = W2.pod(), date = W2.date(), tom = W2.addDays(W2.today(), 1);
            if (!W2.state.soft) main.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Looking for what can go wrong on ' + W2.dayName(date) + '…</div>';
            return T.check(pod, date).then(function (res) {
                if (!live()) return;
                return T.accuracy(pod, date, res.orders).then(function (acc) {
                    if (!live()) return;
                    T.last = { pod: pod, date: date, res: res };
                    paint(main, res, acc, pod, date, tom, params || {});
                    T.badge(res);
                });
            });
        }
    });

    function paint(main, res, acc, pod, date, tom, params) {
        var s = res.summary, set = T.settings(), byOrder = {};
        res.orders.forEach(function (o) { if (!byOrder[o.order_number]) byOrder[o.order_number] = o; });
        var head = s.atRisk ? 'If nothing changes, <b>' + s.atRisk + ' of ' + s.orders + '</b> order(s) will not leave as planned' + (s.willNotShip ? ' — <b>' + s.willNotShip + '</b> will not ship at all' : '') + '.'
            : s.orders ? 'Nothing found that should stop <b>' + s.orders + '</b> order(s) from leaving.' : 'No orders on ' + W2.dayName(date) + ' yet.';
        var h = '<div class="pagehead"><h2><i class="fa-solid fa-moon"></i> Tomorrow check · ' + W2.dayName(date) + ' <small class="muted">' + date + ' · ' + pod + '</small></h2><span class="grow"></span>' +
            (date !== tom ? '<button class="btn sm" id="pm-tom"><i class="fa-solid fa-forward"></i> Check tomorrow (' + tom + ')</button>' : '') +
            '<button class="btn sm" id="pm-set"><i class="fa-solid fa-gear"></i> Evening run</button>' +
            '<button class="btn sm" id="pm-snap" title="Keep this forecast to score it tomorrow"><i class="fa-solid fa-camera"></i> Keep forecast</button>' +
            '<button class="btn primary sm" id="pm-run"><i class="fa-solid fa-rotate"></i> Read again &amp; check</button></div>';
        h += '<div class="card pm-hero"><div class="row" style="gap:18px;flex-wrap:nowrap">' + gauge(s.readiness) + '<div class="grow"><div class="pm-head">' + head + '</div>' +
            '<div class="muted sm">A pre-mortem from the local copy' + (res.lastSync ? ' read ' + esc(W2.ago ? W2.ago(res.lastSync.ts) : res.lastSync.ts) : ' (not read yet — press Read again)') +
            ' + the autopilot\'s cancel rules + 120 days of MRA tries per customer. Fix what you can tonight; the evening run checks again at ' + esc(set.at) + '.</div></div></div></div>';
        if (res.systemic.length || res.mraError) {
            h += '<div class="stack" style="margin-top:10px">' + res.systemic.map(function (x) {
                return '<div class="callout ' + (x.sev >= 3 ? 'bad' : 'warn') + ' row"><span class="grow"><b>' + esc(x.title) + '.</b> ' + esc(x.why) + '</span><button class="btn sm" data-sys="' + x.fix + '">' + esc(SYS_LABEL[x.fix] || 'Open') + '</button></div>';
            }).join('') + (res.mraError ? '<div class="callout warn">MRA history not read from APEX (' + esc(res.mraError.slice(0, 160)) + ') — MRA risks use this PC\'s copy only.</div>' : '') + '</div>';
        }
        // KPI per kind
        var kinds = Object.keys(P.KINDS).filter(function (k) { return s.byKind[k]; });
        if (kinds.length) {
            h += '<div class="kpis" style="margin-top:10px">' + kinds.map(function (k) {
                var worst = Math.max.apply(null, res.risks.filter(function (r) { return r.kind === k; }).map(function (r) { return r.sev; }));
                return '<div class="kpi ' + (worst >= 3 ? 'bad' : worst >= 2 ? 'warn' : '') + (params.kind === k ? ' on' : '') + '" data-kind="' + k + '"><span class="l"><i class="fa-solid ' + P.KINDS[k].icon + '"></i>' + esc(P.KINDS[k].label) + '</span><span class="n">' + s.byKind[k] + '</span><span class="s">order(s)</span></div>';
            }).join('') + '</div>';
        }
        h += '<div class="grid pm-grid" style="margin-top:10px"><div class="card"><h3><i class="fa-solid fa-truck"></i> Trips · how ready <small>worst first</small></h3><div class="pm-trips">' +
            (res.trips.length ? res.trips.map(function (t) {
                var c = t.readiness >= 90 ? 'good' : t.readiness >= 70 ? 'warn' : 'bad';
                return '<div class="pm-trip' + (String(params.trip) === String(t.trip) ? ' on' : '') + '" data-pmtrip="' + esc(t.trip) + '"><b>' + esc(t.trip) + '</b><div class="pm-bar"><i class="' + c + '" style="width:' + t.readiness + '%"></i></div>' +
                    '<span class="num">' + t.readiness + '%</span><span class="muted xs">' + (t.atRisk ? t.atRisk + ' of ' + t.orders + ' at risk' + (t.high ? ' · ' + t.high + ' high' : '') : t.orders + ' order(s) clear') + '</span></div>';
            }).join('') : '<div class="muted">No trips.</div>') + '</div></div>';
        h += '<div class="card"><h3><i class="fa-solid fa-bullseye"></i> Was last night\'s forecast right?</h3>' + accHtml(acc, date) + '</div></div>';
        h += '<div class="card" style="margin-top:10px"><h3><i class="fa-solid fa-list-check"></i> What will go wrong — and the fix <small>' + res.risks.length + ' finding(s)' +
            (params.kind ? ' · ' + esc(P.KINDS[params.kind].label) : '') + (params.trip ? ' · trip ' + esc(params.trip) : '') + '</small><span class="grow"></span>' +
            (params.kind || params.trip ? '<button class="btn sm" id="pm-all">Show all</button>' : '') + '</h3><div id="pm-g"></div></div>';
        main.innerHTML = h;

        var rows = res.risks.filter(function (r) { return (!params.kind || r.kind === params.kind) && (!params.trip || String(r.trip) === String(params.trip)); });
        W2.grid(main.querySelector('#pm-g'), rows, [
            { k: 'sev', t: 'Risk', w: '70px', fmt: function (v) { var x = SEV[v]; return '<span class="pill ' + x[0] + '">' + x[1] + '</span>'; } },
            { k: 'trip', t: 'Trip', w: '70px' },
            { k: 'order', t: 'Order', w: '100px', fmt: function (v) { return '<a href="#" data-o="' + esc(v) + '">' + esc(v) + '</a>'; } },
            { k: 'customer', t: 'Customer' },
            { k: 'kind', t: 'What', fmt: function (v) { return '<i class="fa-solid ' + P.KINDS[v].icon + '"></i> ' + esc(P.KINDS[v].label); } },
            { k: 'title', t: 'Finding', fmt: function (v, r) { return '<b>' + esc(v) + '</b><div class="muted xs">' + esc(r.why) + '</div>'; } },
            { k: 'fix', t: 'Fix', w: '150px', fmt: function (v, r) { return '<button class="btn sm" data-fix="' + res.risks.indexOf(r) + '">' + esc(FIX_LABEL[v] || 'Open') + '</button>'; } }
        ], {
            empty: res.orders.length ? 'Nothing to fix here.' : 'No orders on this date in the local copy — press Read again.', csv: 'tomorrow-check-' + date + '.csv',
            after: function (box) {
                box.querySelectorAll('[data-fix]').forEach(function (b) { b.onclick = function () { var r = res.risks[+b.dataset.fix]; T.fix(r, byOrder[r.order], function () { W2.render({ soft: true }); }); }; });
                box.querySelectorAll('[data-o]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); var o = byOrder[a.dataset.o]; if (o) W2.openOrderDialog(o); }; });
            }
        });
        main.querySelectorAll('[data-kind]').forEach(function (k) { k.onclick = function () { W2.go('tomorrow', { kind: params.kind === k.dataset.kind ? null : k.dataset.kind, trip: params.trip }); }; });
        main.querySelectorAll('[data-pmtrip]').forEach(function (k) { k.onclick = function () { W2.go('tomorrow', { kind: params.kind, trip: String(params.trip) === k.dataset.pmtrip ? null : k.dataset.pmtrip }); }; });
        main.querySelectorAll('[data-sys]').forEach(function (b) { b.onclick = function () { if (b.dataset.sys === 'mra') { W2.go('mra', { filter: 'todo' }); return; } T.fix({ fix: b.dataset.sys }, null, function () { W2.render({ soft: true }); }); }; });
        var on = function (id, fn) { var b = main.querySelector('#' + id); if (b) b.onclick = fn; };
        on('pm-all', function () { W2.go('tomorrow', {}); });
        on('pm-tom', function () { W2.setDate(tom); });
        on('pm-run', function () { W2.sync.day(date, { full: true }).then(function () { if (W2.state.page === 'tomorrow') W2.render(); }); });
        on('pm-snap', function () { T.saveSnapshot(pod, date, res).then(function () { W2.toast('Forecast kept — on ' + W2.dayName(date) + ' this page scores it.', 'success'); }, function (e) { W2.toast(String(e), 'error'); }); });
        on('pm-set', T.settingsDialog);
    }

    function accHtml(acc, date) {
        if (!acc) return '<div class="muted sm">' + (date > W2.today() ? 'Ask again on ' + W2.dayName(date) + ': the forecast kept tonight (Keep forecast, or the evening run) is then compared with what really happened — orders cancelled, failed MRA, orders that left the trip.'
            : 'No forecast was kept before this date started.') + '</div>';
        return '<div class="row" style="gap:16px"><div class="pm-acc"><b>' + (acc.precision == null ? '—' : acc.precision + '%') + '</b><span>came true</span></div><div class="grow sm">' +
            '<div><b>' + acc.hit + '</b> predicted problem(s) happened, <b>' + acc.miss + '</b> did not (fixed in time, or a false alarm).</div>' +
            '<div><b>' + acc.surprises.length + '</b> surprise(s) nobody predicted' + (acc.surprises.length ? ': ' + acc.surprises.slice(0, 8).map(esc).join(', ') + (acc.surprises.length > 8 ? '…' : '') : '') + '.</div>' +
            '<div class="muted xs">Forecast kept ' + esc(acc.ts) + '.</div></div></div>';
    }

    T.settingsDialog = function () {
        var s = T.settings();
        W2.modal('Tomorrow check — evening run', '<div class="stack sm">' +
            '<label class="row"><input type="checkbox" id="pm-auto"' + (s.auto ? ' checked' : '') + '> Check tomorrow by itself every evening while WMS 2.0 is open on this PC</label>' +
            '<label class="row">From <input type="time" id="pm-at" value="' + esc(s.at) + '"> it reads tomorrow again (APEX + Fusion), checks it and keeps the forecast.</label>' +
            '<label class="row"><input type="checkbox" id="pm-alert"' + (s.alert ? ' checked' : '') + '> Send an alert when orders are at risk (Teams / e-mail of AI Digital Employee › Control, or below)</label>' +
            '<label>Teams webhook (optional)<br><input id="pm-hook" style="width:100%" value="' + esc(s.hook) + '" placeholder="https://….webhook.office.com/…"></label>' +
            '<label>E-mail to (optional, comma separated)<br><input id="pm-email" style="width:100%" value="' + esc(s.email) + '"></label>' +
            '<div class="muted xs">Last evening run here: ' + esc(W2.ls('w2.pm.last.' + W2.pod()) || 'never') + '. Each PC with the page open runs it once a day — switch it on on one PC only if you use the alert.</div></div>',
            [{ label: 'Cancel' }, { label: 'Run it now', onClick: function (m) { save(m); T.evening(true); } }, { label: 'Save', cls: 'primary', onClick: function (m) { save(m); W2.toast('Saved.', 'success'); } }], 600);
        function save(m) {
            W2.ls('w2.pm', { auto: m.querySelector('#pm-auto').checked, at: m.querySelector('#pm-at').value || '18:00', alert: m.querySelector('#pm-alert').checked, hook: m.querySelector('#pm-hook').value.trim(), email: m.querySelector('#pm-email').value.trim() });
        }
    };

    /** The evening run: read tomorrow, check it, keep the forecast, alert. Once a day per PC and instance (unless forced). */
    T.evening = function (force) {
        var s = T.settings(), pod = W2.pod(), today = W2.today(), tom = W2.addDays(today, 1), now = new Date();
        var hm = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
        if (!force && (!s.auto || hm < s.at || W2.ls('w2.pm.last.' + pod) === today || T.eveningRunning)) return Promise.resolve(null);
        T.eveningRunning = true; W2.ls('w2.pm.last.' + pod, today);
        return W2.sync.day(tom, { full: true, auto: !force }).catch(function () {}).then(function () { return T.check(pod, tom); }).then(function (res) {
            return T.saveSnapshot(pod, tom, res).then(function () {
                var sm = res.summary;
                W2.toast('Tomorrow check: ' + (sm.atRisk ? sm.atRisk + ' of ' + sm.orders + ' order(s) at risk.' : 'nothing at risk.'), sm.high ? 'warning' : 'info');
                if (W2.date() === tom) T.badge(res);
                if (s.alert && sm.atRisk) {
                    var text = 'Tomorrow (' + tom + ', ' + pod + '): ' + sm.atRisk + ' of ' + sm.orders + ' order(s) will not leave as planned' + (sm.willNotShip ? ', ' + sm.willNotShip + ' will not ship at all' : '') + '.\n' +
                        res.trips.filter(function (t) { return t.atRisk; }).slice(0, 10).map(function (t) { return 'Trip ' + t.trip + ': ' + t.atRisk + ' of ' + t.orders + ' at risk'; }).join('\n') + '\n\n' +
                        res.risks.filter(function (r) { return r.sev >= 3; }).slice(0, 15).map(function (r) { return '• ' + r.order + ' (trip ' + r.trip + ') — ' + r.title; }).join('\n') +
                        '\n\nOpen WMS 2.0 › Tomorrow check to fix them.';
                    return W2.call('fusionSqlWatchAlert', { subject: 'Tomorrow check: ' + sm.atRisk + ' order(s) at risk (' + pod + ')', text: text, teamsWebhook: s.hook || '', emailTo: s.email || '' }, 60000).catch(function (e) { W2.toast('Alert not sent: ' + e, 'error'); });
                }
            }).then(function () {
                W2.call('aiAudit', { source: 'WMS2', actionKey: 'tomorrow_check', outcome: 'OK', instance: pod, refId: 'DATE:' + tom, detail: res.summary.atRisk + ' of ' + res.summary.orders + ' at risk' }).catch(function () {});
                if (W2.state.page === 'tomorrow' && W2.date() === tom) W2.render({ soft: true });
                return res;
            });
        }).catch(function (e) { console.warn('[W2 tomorrow] evening run:', e); }).then(function (r) { T.eveningRunning = false; return r; });
    };

    T.badge = function (res) {
        if (res) W2.badges({ tomorrow: { n: res.summary.atRisk, cls: res.summary.high ? '' : 'warn' } });
    };

    // nav entry (Operate, right after the control tower) + evening timer
    W2.GROUPS[0][1].splice(1, 0, 'tomorrow');
    W2.on('ready', function () {
        if (openedOnTomorrow && W2.date() !== W2.addDays(W2.today(), 1)) W2.setDate(W2.addDays(W2.today(), 1));
        setTimeout(function () { T.evening(false); }, 20000);
        setInterval(function () { T.evening(false); }, 5 * 60000);
    });
})();
