/* WMS 2.0 — MRA, Printing, Pending, Insights (WMS charts from DuckDB), Data & sync, Settings. */
(function () {
    'use strict';
    var W2 = window.W2, esc = W2.esc;
    var DONE = ['SENT', 'DONE', 'ALREADY', 'SKIPPED', 'OFF'];

    // ── MRA: send interfaced orders (same host action + flow as the Shipping Agent's Print Trip) ──
    var MRA = W2.MRA = {};
    MRA.creds = function () {
        if (window.F_username && window.F_password) return Promise.resolve({ username: window.F_username, password: window.F_password });
        // the WMS reads the Fusion user for MRA from this endpoint too (fetchFusionCredentialsForBatchMRA); kept in memory only
        return W2.get(W2.ORDS + '/ARMODULE/fusion').then(function (j) {
            var it = W2.items(j)[0]; if (!it) throw 'No Fusion credentials found (ARMODULE/fusion).';
            window.F_username = it.username || ''; window.F_password = it.password1 || '';
            return { username: window.F_username, password: window.F_password };
        });
    };
    MRA.one = function (order, pod, creds, batchId, onStep, tripId) {
        return new Promise(function (resolve) {
            var rid = 'w2_mra_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), t0 = Date.now(), log = [{ t: t0, type: 'step', text: 'Start MRA for ' + order + ' on ' + pod }], extra = {}, timer = null;
            function handler(ev) {
                var d = ev.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
                if (!d || d.requestId !== rid) return;
                var now = Date.now();
                if (d.action === 'mraProcessingProgress') { log.push({ t: now, type: 'step', text: d.message || d.step }); if (onStep) onStep(d.step); return; }
                if (d.action === 'mraLog') { log.push({ t: now, type: d.type || 'info', text: String(d.message || '').slice(0, 3000) }); return; }
                if (d.action === 'mraRequestData') { extra.req = d.request; log.push({ t: now, type: 'info', text: 'Sent to the MRA gateway' }); return; }
                if (d.action === 'mraResponseData') { extra.res = d.response; log.push({ t: now, type: d.success ? 'success' : 'error', text: 'MRA gateway answered: ' + (d.success ? 'OK' : 'error') }); return; }
                if (d.action === 'mraOrderData') return;
                if (d.action === 'error') return done({ status: 'FAILED', msg: d.message || 'MRA error' });
                if (d.action !== 'processMRAInterfaceResponse') return;
                var base = { timings: d.timings || '' };
                if (d.success) done(Object.assign(base, { status: 'DONE', irn: d.irnCode || '', msg: d.message || '' }));
                else if (d.skipped) done(Object.assign(base, { status: 'SKIPPED', msg: d.message || 'Order type not interfaced to MRA' }));
                else if (/already done/i.test(d.message || '')) done(Object.assign(base, { status: 'ALREADY', msg: d.message }));
                else done(Object.assign(base, { status: 'FAILED', msg: d.message || 'MRA failed', gw: d.gatewayProblem || null }));
            }
            function done(r) {
                clearTimeout(timer); window.chrome.webview.removeEventListener('message', handler);
                log.push({ t: Date.now(), type: r.status === 'FAILED' ? 'error' : 'success', text: r.status + ': ' + (r.msg || '') });
                r.secs = ((Date.now() - t0) / 1000).toFixed(1); r.log = log; r.req = extra.req; r.res = extra.res;
                resolve(r);
            }
            window.chrome.webview.addEventListener('message', handler);
            timer = setTimeout(function () { done({ status: 'FAILED', msg: 'MRA request timed out after 3 minutes' }); }, 180000);
            window.chrome.webview.postMessage({ action: 'processMRAInterface', requestId: rid, orderNumber: order, fusionUsername: creds.username, fusionPassword: creds.password, instance: pod, batchId: batchId, source: 'WMS2', tripId: tripId != null ? String(tripId) : undefined, appUser: (function(){try{return localStorage.getItem('wms_user')||sessionStorage.getItem('loggedInUser')||'';}catch(e){return '';}})() });
        });
    };
    /** Sends orders to MRA, 4 at a time (MRA_ORDER_TYPES read once for the batch); stops after two gateway problems in a row. */
    MRA.send = function (orders) {
        var pod = W2.pod(), date = W2.date(), batch = 'w2_' + Date.now(), par = W2.n((W2.ls('w2.sync') || {}).mraPar) || 4;
        orders = orders.filter(function (o) { return o && o.order_number; });
        if (!orders.length) return Promise.resolve();
        W2.busy.start('MRA · ' + orders.length + ' order(s) …', function () { W2.stopping = true; });
        W2.stopping = false;
        var n = 0, ok = 0, bad = 0, skip = 0, gw = 0, stop = null, rows = [], send = orders;
        return MRA.creds().then(function (creds) {
            // the MRA status table first (every PC, every screen): orders that already reached MRA are not sent again
            var pre = typeof window.wmsMraDone === 'function' ? window.wmsMraDone(orders.map(function (o) { return o.order_number; }), pod).catch(function () { return {}; }) : Promise.resolve({});
            return pre.then(function (already) {
            send = orders.filter(function (o) {
                var d = already[String(o.order_number).trim()];
                if (!d) return true;
                skip++;
                rows.push({ pod: pod, order_number: o.order_number, trip_date: date, trip_id: o.trip_id, status: 'ALREADY', irn: d.irn || '', msg: 'Already in MRA' + (d.irn ? ' (IRN ' + d.irn + ')' : '') + (d.at ? ' since ' + d.at : '') + ' — not sent again', checked_at: W2.now(), source: 'w2' });
                return false;
            });
            W2.busy.step('MRA · ' + (skip ? skip + ' already in MRA · ' : '') + send.length + ' to send');
            return W2.pool(send, par, function (o) {
                if (stop) { rows.push({ pod: pod, order_number: o.order_number, trip_date: date, trip_id: o.trip_id, status: 'FAILED', msg: 'Not sent: ' + stop, checked_at: W2.now(), source: 'w2' }); return; }
                return MRA.one(o.order_number, pod, creds, batch, null, o.trip_id).then(function (r) {
                    n++; if (r.status === 'FAILED') bad++; else ok++;
                    if (r.gw) gw++; else if (r.status !== 'FAILED') gw = 0;
                    if (gw >= 2 && !stop) stop = 'the MRA gateway did not answer for 2 orders in a row — stopped sending. Retry when MRA answers.';
                    rows.push({ pod: pod, order_number: o.order_number, trip_date: date, trip_id: o.trip_id, status: r.status, irn: r.irn || '', msg: String(r.msg || '').slice(0, 500), checked_at: W2.now(), source: 'w2', secs: r.secs, timings: r.timings, log: JSON.stringify({ log: r.log, req: r.req, res: r.res }).slice(0, 60000) });
                    W2.busy.step('MRA · ' + n + ' of ' + send.length + (bad ? ' · ' + bad + ' failed' : ''));
                });
            });
            });
        }).then(function () {
            return W2.put('w2_mra', { pod: pod, order_number: rows.map(function (r) { return r.order_number; }) }, rows);
        }).then(function () {
            W2.busy.done('MRA: ' + ok + ' done, ' + skip + ' already in MRA, ' + bad + ' failed' + (stop ? ' — ' + stop : ''), bad > 0);
            W2.call('aiAudit', { source: 'WMS2', actionKey: 'mra_interface', outcome: bad ? 'PARTIAL' : 'OK', instance: pod, refId: 'DATE:' + date, target: orders.length + ' order(s)', detail: ok + ' done, ' + skip + ' already in MRA, ' + bad + ' failed' }).catch(function () {});
            W2.render();
        }, function (e) { W2.busy.done('MRA: ' + e, true); });
    };
    MRA.showLog = function (order, m) {
        var d = {}; try { d = JSON.parse(m.log || '{}'); } catch (e) {}
        var log = d.log || [], t0 = log.length ? log[0].t : 0;
        W2.modal('MRA log — ' + esc(order), '<div class="row">' + W2.mraPill(m.status) + '<span class="muted sm">' + esc(m.msg || '') + (m.secs ? ' · ' + m.secs + ' s' : '') + '</span></div>' +
            (m.timings ? '<div class="sm" style="margin-top:6px"><b>Time per step:</b> ' + esc(m.timings) + '</div>' : '') +
            '<div class="log" style="margin-top:8px">' + (log.map(function (l) { return '<div class="' + (l.type === 'error' ? 'err' : l.type === 'success' ? 'ok' : l.type === 'warning' ? 'warn' : '') + '">+' + ((l.t - t0) / 1000).toFixed(1) + 's  ' + esc(l.text) + '</div>'; }).join('') || '<div class="dim">No log.</div>') + '</div>' +
            (d.req ? '<details style="margin-top:8px"><summary>MRA request</summary><pre class="log">' + esc(JSON.stringify(d.req, null, 2)) + '</pre></details>' : '') +
            (d.res ? '<details><summary>MRA answer</summary><pre class="log">' + esc(JSON.stringify(d.res, null, 2)) + '</pre></details>' : ''), null, 760);
    };

    var ST_MAP = { SUCCESS: 'DONE', ALREADY_DONE: 'ALREADY', FAILED: 'FAILED', SKIPPED: 'SKIPPED' };
    /** Every try of one order from WMS_MRA_INTERFACE_STATUS (all PCs, all screens) in a dialog. */
    MRA.history = function (order, pod) {
        var m = W2.modal('MRA tries — ' + esc(order), '<div id="mh-g"><div class="muted">Reading WMS_MRA_INTERFACE_STATUS…</div></div>', null, 980);
        W2.apexRows("SELECT id, TO_CHAR(created_date, 'DD-MM-YYYY HH24:MI:SS') AS at, trip_id, mra_interface_status AS status, mra_interface_id AS irn, failed_step, " +
            "SUBSTR(failed_reason, 1, 1000) AS reason, gateway_problem, http_status, source, app_user, machine, ROUND(duration_ms / 1000, 1) AS secs " +
            "FROM wms_mra_interface_status WHERE order_number = " + W2.lit(order) + " AND instance_name = " + W2.lit(pod) + " ORDER BY created_date DESC, id DESC", 200).then(function (rows) {
            var box = (m && m.querySelector ? m : document).querySelector('#mh-g'); if (!box) return;
            W2.grid(box, rows.map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toLowerCase()] = r[k]; }); return o; }), [
                { k: 'at', t: 'When' }, { k: 'status', t: 'Status', fmt: function (v) { return W2.mraPill(ST_MAP[v] || v); } }, { k: 'irn', t: 'IRN' }, { k: 'trip_id', t: 'Trip' },
                { k: 'failed_step', t: 'Failed step' }, { k: 'reason', t: 'Reason', fmt: function (v) { return v ? '<span title="' + esc(v) + '">' + esc(String(v).slice(0, 90)) + '</span>' : ''; } },
                { k: 'gateway_problem', t: 'Gateway' }, { k: 'source', t: 'Source' }, { k: 'app_user', t: 'User' }, { k: 'secs', t: 'Secs', num: true }
            ], { empty: 'No try in WMS_MRA_INTERFACE_STATUS for this order.', csv: 'mra-' + order + '.csv' });
        }, function (e) { var box = document.querySelector('#mh-g'); if (box) box.innerHTML = '<div class="callout bad">' + esc(String(e)) + '</div>'; });
    };
    MRA.print = function (list, date) {
        return W2.pool(list, 1, function (o) {
            return W2.call('printOrder', { orderNumber: o.order_number, tripId: o.trip_id, tripDate: date }, 120000)
                .then(function (r) { if (r && r.success === false) throw r.message || 'print failed'; W2.toast('Print job sent for ' + o.order_number + '.', 'success'); }).catch(function (e) { W2.toast('Print ' + o.order_number + ' failed: ' + e, 'error'); });
        }).then(function () { W2.sync.day(date, { only: ['print'], auto: true }); });
    };

    W2.page('mra', {
        title: 'MRA', icon: 'fa-receipt',
        render: function (main, params, live) {
            var pod = W2.pod(), date = W2.date();
            return Promise.all([W2.M.orders(), W2.q("SELECT upper(interface_flag) AS flag, changed_by, changed_at FROM w2_mra_flag WHERE upper(instance_name) = " + W2.lit(pod)),
                W2.q("SELECT order_number, status, irn, msg, checked_at, source, secs, timings, log FROM w2_mra WHERE pod = " + W2.lit(pod))]).then(function (r) {
                if (!live()) return;
                var flag = r[1][0] || {}, logs = {}; r[2].forEach(function (x) { if (!logs[x.order_number] || x.checked_at > logs[x.order_number].checked_at) logs[x.order_number] = x; });
                var orders = r[0].filter(function (o) { return o.stage !== 'CANCELLED'; });
                // the MRA status table: latest try per order, from every PC and every screen (WMS, Shipping Agent, AI, WMS 2.0 …)
                var stP = typeof window.wmsMraStatuses === 'function' ? window.wmsMraStatuses(orders.map(function (o) { return o.order_number; }), pod).catch(function (e) { console.warn('[W2 MRA] status table:', e); return {}; }) : Promise.resolve({});
                return stP.then(function (st) {
                    if (!live()) return;
                    orders.forEach(function (o) {
                        var x = st[o.order_number];
                        o.st = x ? x.s : ''; o.st_irn = x ? x.irn : ''; o.st_why = x ? x.why : ''; o.st_at = x ? x.at : ''; o.st_n = x ? x.n : 0;
                        o.mra_eff = x && x.s ? (ST_MAP[x.s] || x.s) : (o.mra || '');
                        o.mra_done = DONE.indexOf(o.mra_eff) >= 0;
                    });
                    var f = params.filter || 'todo';
                    var list = orders.filter(function (o) {
                        return f === 'all' ? true : f === 'failed' ? (o.mra_eff === 'FAILED' || o.mra_eff === 'CHECK FAILED') : f === 'done' ? o.mra_done : o.stage === 'INTERFACED' && !o.mra_done;
                    });
                    if (params.trip) list = list.filter(function (o) { return o.trip_id === params.trip; });
                    var cnt = { todo: orders.filter(function (o) { return o.stage === 'INTERFACED' && !o.mra_done; }).length, failed: orders.filter(function (o) { return o.mra_eff === 'FAILED'; }).length, done: orders.filter(function (o) { return o.mra_done; }).length, all: orders.length };
                    main.innerHTML = '<div class="pagehead"><h2>MRA · ' + W2.dayName(date) + '</h2>' +
                        '<span class="tag ' + (flag.flag === 'N' ? 'warn' : 'good') + '"><i class="fa-solid fa-flag"></i> MRA interface: ' + (flag.flag ? (flag.flag === 'N' ? 'No' : 'Yes') : '?') + (flag.changed_by ? ' · ' + esc(flag.changed_by) + ' ' + esc(flag.changed_at || '') : '') + '</span><span class="grow"></span>' +
                        ['todo', 'failed', 'done', 'all'].map(function (k) { return '<button class="btn sm ' + (f === k ? 'primary' : '') + '" data-f="' + k + '">' + { todo: 'To send', failed: 'Failed', done: 'Done', all: 'All' }[k] + ' <span class="muted">' + cnt[k] + '</span></button>'; }).join('') + '</div>' +
                        (flag.flag === 'N' ? '<div class="callout warn">MRA interface is switched off for ' + pod + ' (WMS › MRA Interface) — the Shipping Agent prints without MRA. You can still send orders here.</div>' : '') +
                        '<div class="row" style="margin:10px 0"><button class="btn primary" id="m-send"><i class="fa-solid fa-paper-plane"></i> Interface ticked to MRA</button><button class="btn" id="m-print"><i class="fa-solid fa-print"></i> Print ticked</button>' +
                        '<button class="btn" id="m-check"><i class="fa-solid fa-magnifying-glass"></i> Check ticked (MRA report)</button>' +
                        '<span class="muted sm">MRA column = the latest try in WMS_MRA_INTERFACE_STATUS (every PC and screen). Retry checks first that MRA does not already have the order, so nothing is sent twice.</span></div><div id="m-grid"></div>';
                    main.querySelectorAll('[data-f]').forEach(function (b) { b.onclick = function () { W2.go('mra', { filter: b.dataset.f, trip: params.trip }); }; });
                    var byNum = {}; orders.forEach(function (o) { byNum[o.order_number] = o; });
                    var g = W2.grid(main.querySelector('#m-grid'), list, [
                        { k: 'order_number', t: '', fmt: function (v, o) {
                            var failed = o.mra_eff === 'FAILED';
                            return '<span style="white-space:nowrap">' + (o.mra_done ? '' : '<button class="btn sm ' + (failed ? 'danger' : '') + '" data-retry="' + esc(v) + '" title="' + (failed ? 'Retry — last try failed: ' + esc(o.st_why || o.mra_msg || '') : 'Interface this order to MRA now') + '"><i class="fa-solid ' + (failed ? 'fa-rotate-right' : 'fa-paper-plane') + '"></i> ' + (failed ? 'Retry' : 'Interface') + '</button> ') +
                                '<button class="btn sm" data-print="' + esc(v) + '" title="Print the order (Fusion PDF + print job)"><i class="fa-solid fa-print"></i></button> ' +
                                '<button class="btn sm" data-hist="' + esc(v) + '" title="Every MRA try of this order (WMS_MRA_INTERFACE_STATUS)"><i class="fa-solid fa-clock-rotate-left"></i></button>' +
                                (logs[v] && logs[v].log ? ' <button class="btn sm" data-log="' + esc(v) + '" title="Log of the last send from this PC"><i class="fa-solid fa-file-lines"></i></button>' : '') + '</span>';
                        } },
                        { k: 'trip_id', t: 'Trip' }, { k: 'order_number', t: 'Order', fmt: function (v) { return '<a href="#" class="mono" data-od="' + esc(v) + '" style="font-weight:700;color:#4f46e5;text-decoration:none" title="Open the order details">' + esc(v) + '</a>'; } },
                        { k: 'account_name', t: 'Customer' }, { k: 'order_type', t: 'Type' },
                        { k: 'stage', t: 'Fusion status', fmt: function (v) { return W2.stagePill(v); } },
                        { k: 'mra_eff', t: 'MRA', fmt: function (v, o) { return (v ? W2.mraPill(v) : '<span class="muted">not sent</span>') + (o.st_n > 1 ? ' <span class="muted sm" title="tries">×' + o.st_n + '</span>' : ''); } },
                        { k: 'st_irn', t: 'IRN', fmt: function (v) { return v ? '<span class="mono sm" title="' + esc(v) + '">' + esc(String(v).slice(0, 18)) + (String(v).length > 18 ? '…' : '') + '</span>' : ''; } },
                        { k: 'st_why', t: 'Failed reason', fmt: function (v, o) { var t = v || (o.mra_eff === 'FAILED' ? o.mra_msg : ''); return t ? '<span title="' + esc(t) + '">' + esc(String(t).slice(0, 70)) + '</span>' : ''; } },
                        { k: 'st_at', t: 'Last try', fmt: function (v, o) { return v || (o.mra_at ? W2.ago(o.mra_at) : ''); } }
                    ], { select: true, key: 'order_number', preselect: f === 'todo' || f === 'failed' ? list.filter(function (o) { return o.stage === 'INTERFACED'; }).map(function (o) { return o.order_number; }) : [], csv: 'mra-' + date + '.csv', onRow: function (o) { W2.orderPanel(o); },
                        after: function (box) {
                            box.querySelectorAll('[data-log]').forEach(function (b) { b.onclick = function () { MRA.showLog(b.dataset.log, logs[b.dataset.log]); }; });
                            box.querySelectorAll('[data-hist]').forEach(function (b) { b.onclick = function () { MRA.history(b.dataset.hist, pod); }; });
                            box.querySelectorAll('[data-od]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); e.stopPropagation(); W2.openOrderDialog(byNum[a.dataset.od]); }; });
                            box.querySelectorAll('[data-retry]').forEach(function (b) { b.onclick = function () { send([byNum[b.dataset.retry]]); }; });
                            box.querySelectorAll('[data-print]').forEach(function (b) { b.onclick = function () { print([byNum[b.dataset.print]]); }; });
                        } });
                    function send(sel) {
                        var notIf = sel.filter(function (o) { return o.stage !== 'INTERFACED'; }), done = sel.filter(function (o) { return o.mra_done; });
                        W2.confirm('Interface ' + sel.length + ' order(s) to MRA', '<p>Interface <b>' + sel.length + '</b> order(s) to the Mauritius Revenue Authority now (' + pod + ').</p>' +
                            (notIf.length ? '<p class="callout warn">' + notIf.length + ' of them are not fully interfaced in Fusion yet — MRA will most likely refuse them.</p>' : '') +
                            (done.length ? '<p class="muted sm">' + done.length + ' already reached MRA — the first step checks that, so they are not sent twice.</p>' : '') +
                            (flag.flag === 'N' ? '<p class="muted sm">The MRA switch is OFF for ' + pod + ' — this sends them anyway.</p>' : ''), 'Send to MRA').then(function (y) { if (y) MRA.send(sel); });
                    }
                    function print(sel) {
                        var bad = sel.filter(function (o) { return o.mra_eff === 'FAILED' || (!o.mra_done && flag.flag !== 'N'); });
                        W2.confirm('Print ' + sel.length + ' order(s)', '<p>Print <b>' + sel.length + '</b> order(s)?</p>' + (bad.length ? '<p class="callout warn">' + bad.length + ' of them have not reached MRA (not fiscalised). Print anyway?</p>' : ''), 'Print').then(function (y) { if (y) MRA.print(sel, date); });
                    }
                    main.querySelector('#m-send').onclick = function () { var sel = g.selected(); if (!sel.length) { W2.toast('Tick the orders to interface.', 'warning'); return; } send(sel); };
                    main.querySelector('#m-print').onclick = function () { var sel = g.selected(); if (!sel.length) { W2.toast('Tick the orders to print.', 'warning'); return; } print(sel); };
                    main.querySelector('#m-check').onclick = function () {
                        var sel = g.selected(); if (!sel.length) { W2.toast('Tick orders to check.', 'warning'); return; }
                        W2.busy.start('Checking ' + sel.length + ' order(s) with the MRA report…');
                        var rows = [];
                        W2.pool(sel, 3, function (o) { return W2.sync.mraCheckOne(pod, o.order_number).then(function (st) { rows.push({ pod: pod, order_number: o.order_number, trip_date: date, trip_id: o.trip_id, status: st, checked_at: W2.now(), source: 'check' }); }, function (e) { rows.push({ pod: pod, order_number: o.order_number, trip_date: date, trip_id: o.trip_id, status: 'CHECK FAILED', msg: String(e), checked_at: W2.now(), source: 'check' }); }); })
                            .then(function () { return W2.put('w2_mra', { pod: pod, order_number: rows.map(function (r) { return r.order_number; }) }, rows); })
                            .then(function () { W2.busy.done(rows.length + ' order(s) checked.'); W2.render(); });
                    };
                });
            });
        }
    });

    // ── Printing ─────────────────────────────────────────────
    W2.page('printing', {
        title: 'Printing', icon: 'fa-print',
        render: function (main, params, live) {
            var date = W2.date();
            return Promise.all([W2.M.orders(), W2.q("SELECT * FROM w2_print WHERE trip_date = " + W2.lit(date) + " ORDER BY changed DESC")]).then(function (r) {
                if (!live()) return;
                var orders = r[0], jobs = r[1], f = params.filter || 'all';
                var notQueued = orders.filter(function (o) { return o.stage === 'INTERFACED' && DONE.indexOf(o.mra) >= 0 && o.print_state === 'NONE'; });
                var list = f === 'failed' ? jobs.filter(function (j) { return j.error_message && !j.print_completed; }) : f === 'none' ? [] : jobs;
                var cnt = { printed: orders.filter(function (o) { return o.print_state === 'PRINTED'; }).length, failed: orders.filter(function (o) { return o.print_state === 'FAILED'; }).length, queued: orders.filter(function (o) { return o.print_state === 'QUEUED'; }).length };
                main.innerHTML = '<div class="pagehead"><h2>Printing · ' + W2.dayName(date) + '</h2><span class="grow"></span>' +
                    ['all', 'failed', 'none'].map(function (k) { return '<button class="btn sm ' + (f === k ? 'primary' : '') + '" data-f="' + k + '">' + { all: 'All jobs', failed: 'Failed', none: 'Ready, not queued' }[k] + '</button>'; }).join('') + '</div>' +
                    '<div class="kpis"><div class="kpi good"><span class="l">Printed</span><span class="n">' + cnt.printed + '</span><span class="s">order(s)</span></div><div class="kpi ' + (cnt.failed ? 'bad' : '') + '"><span class="l">Failed</span><span class="n">' + cnt.failed + '</span><span class="s">order(s)</span></div>' +
                    '<div class="kpi warn"><span class="l">Queued</span><span class="n">' + cnt.queued + '</span><span class="s">order(s)</span></div><div class="kpi"><span class="l">Ready, not queued</span><span class="n">' + notQueued.length + '</span><span class="s">interfaced + MRA done</span></div></div>' +
                    '<div class="card" style="margin-top:12px" id="p-box"></div>';
                main.querySelectorAll('[data-f]').forEach(function (b) { b.onclick = function () { W2.go('printing', { filter: b.dataset.f }); }; });
                var box = main.querySelector('#p-box');
                if (f === 'none') {
                    box.innerHTML = '<h3>Interfaced, MRA done, no print job yet</h3><p class="muted sm">These print from the WMS Shipping Agent (Print Trip) or Monitor Printing. Open an order for its details.</p><div id="p-g"></div>';
                    W2.grid(box.querySelector('#p-g'), notQueued, W2.ORDER_COLS(true), { onRow: function (o) { W2.orderPanel(o); } });
                    return;
                }
                box.innerHTML = '<h3>Print jobs <small>wms_print_jobs</small></h3><div id="p-g"></div>';
                W2.grid(box.querySelector('#p-g'), list, [
                    { k: 'trip_id', t: 'Trip' }, { k: 'order_number', t: 'Order', fmt: function (v) { return '<b class="mono">' + esc(v) + '</b>'; } }, { k: 'customer_name', t: 'Customer' },
                    { k: 'overall_status', t: 'Status', fmt: function (v, j) { return j.print_completed ? '<span class="pill ok">' + esc(v || 'Printed') + '</span>' : j.error_message ? '<span class="pill x">' + esc(v || 'Failed') + '</span>' : '<span class="pill w">' + esc(v || 'Queued') + '</span>'; } },
                    { k: 'download_status', t: 'Download' }, { k: 'print_status', t: 'Print' }, { k: 'retry_count', t: 'Tries', num: true }, { k: 'error_message', t: 'Error' }, { k: 'print_completed', t: 'Printed at' },
                    { k: 'order_number', t: '', fmt: function (v, j) { return '<button class="btn sm" data-pr="' + esc(v) + '" data-trip="' + esc(j.trip_id) + '"><i class="fa-solid fa-print"></i> Print again</button>'; } }
                ], { csv: 'print-jobs-' + date + '.csv', after: function (b) {
                    b.querySelectorAll('[data-pr]').forEach(function (btn) {
                        btn.onclick = function () {
                            btn.disabled = true;
                            W2.call('printOrder', { orderNumber: btn.dataset.pr, tripId: btn.dataset.trip, tripDate: date }, 120000)
                                .then(function () { W2.toast('Print job sent for ' + btn.dataset.pr + '.', 'success'); }, function (e) { W2.toast('Print failed: ' + e, 'error'); })
                                .then(function () { btn.disabled = false; W2.sync.day(date, { only: ['print'], auto: true }); });
                        };
                    });
                } });
            });
        }
    });

    // ── Pending (not on a trip) ──────────────────────────────
    W2.page('pending', {
        title: 'Pending orders', icon: 'fa-inbox',
        render: function (main, params, live) {
            var pod = W2.pod();
            return W2.q("SELECT order_number, any_value(account_name) AS account_name, min(NULLIF(order_date, '')) AS order_date, COUNT(*) AS lines, max(synced_at) AS read_at FROM w2_pending WHERE pod = " + W2.lit(pod) + " AND order_number <> '' GROUP BY 1 ORDER BY order_date NULLS LAST, 1").then(function (rows) {
                if (!live()) return;
                var t = W2.today();
                rows.forEach(function (r) { r.age = r.order_date ? Math.round((new Date(t) - new Date(r.order_date)) / 86400000) : ''; });
                main.innerHTML = '<div class="pagehead"><h2>Pending orders · ' + pod + '</h2><span class="muted">' + rows.length + ' order(s) not on any trip · read ' + W2.ago(rows[0] && rows[0].read_at) + '</span><span class="grow"></span>' +
                    '<button class="btn sm" id="pe-r"><i class="fa-solid fa-rotate"></i> Read again</button></div>' +
                    '<p class="muted sm">From WAREHOUSEMANAGEMENT/getpendingshipmentlines (' + esc(W2.sync.settings().org) + ', last ' + W2.sync.settings().pendingDays + ' days to the trip date). Plan them into a trip in the WMS Trip Management (Add orders).</p><div id="pe-g"></div>';
                main.querySelector('#pe-r').onclick = function () { W2.sync.day(W2.date(), { only: ['pending'] }); };
                W2.grid(main.querySelector('#pe-g'), rows, [{ k: 'order_number', t: 'Order', fmt: function (v) { return '<b class="mono">' + esc(v) + '</b>'; } }, { k: 'account_name', t: 'Customer' }, { k: 'order_date', t: 'Date' },
                    { k: 'age', t: 'Days old', num: true, fmt: function (v) { return v === '' ? '' : '<span class="pill ' + (v > 2 ? 'w' : '') + '">' + v + '</span>'; } }, { k: 'lines', t: 'Lines', num: true, sum: true }],
                    { csv: 'pending-' + pod + '.csv', empty: 'No pending orders in the local copy — press Read again.', onRow: function (r) {
                        W2.q("SELECT * EXCLUDE (raw_json) FROM w2_pending WHERE pod = " + W2.lit(pod) + " AND order_number = " + W2.lit(r.order_number)).then(function (ls) {
                            var d = W2.drawer('Pending order ' + esc(r.order_number), '<div id="pd-g"></div>');
                            var cols = Object.keys(ls[0] || {}).filter(function (k) { return ['pod', 'synced_at'].indexOf(k) < 0; }).slice(0, 14).map(function (k) { return { k: k, t: k.replace(/_/g, ' ') }; });
                            W2.grid(d.querySelector('#pd-g'), ls, cols, { max: 500 });
                        });
                    } });
            });
        }
    });

    // ── Insights: WMS charts from the local copy ─────────────
    W2.page('insights', {
        title: 'Insights', icon: 'fa-chart-line',
        render: function (main, params, live) {
            var pod = W2.pod();
            return W2.qs([
                "SELECT item, COUNT(*) AS lines, COUNT(DISTINCT order_number) AS orders FROM w2_cancel_log WHERE pod = " + W2.lit(pod) + " AND result = 'DONE' GROUP BY 1 ORDER BY 2 DESC LIMIT 15",
                "SELECT trip_date, COUNT(*) AS lines FROM w2_cancel_log WHERE pod = " + W2.lit(pod) + " AND result = 'DONE' GROUP BY 1 ORDER BY 1",
                "SELECT result, COUNT(*) AS n FROM w2_pick_runs WHERE pod = " + W2.lit(pod) + " GROUP BY 1",
                "SELECT trip_date, COUNT(DISTINCT order_number) AS orders, COUNT(*) AS lines FROM w2_trip_lines WHERE pod = " + W2.lit(pod) + " GROUP BY 1 ORDER BY 1 DESC LIMIT 30"
            ]).then(function (r) {
                if (!live()) return;
                main.innerHTML = '<div class="pagehead"><h2>Insights</h2><span class="muted">from the local copy (DuckDB)</span></div>' +
                    '<div class="grid g3"><div class="card"><h3>Items cancelled by the autopilot</h3><div class="chartbox"><canvas id="i1"></canvas></div></div>' +
                    '<div class="card"><h3>Lines cancelled per trip date</h3><div class="chartbox"><canvas id="i2"></canvas></div></div>' +
                    '<div class="card"><h3>Orders per trip date <small>dates read so far</small></h3><div class="chartbox"><canvas id="i3"></canvas></div></div></div>' +
                    '';
                var it = r[0];
                W2.chart(main.querySelector('#i1'), { type: 'bar', data: { labels: it.map(function (x) { return x.item; }), datasets: [{ label: 'Lines', data: it.map(function (x) { return x.lines; }), backgroundColor: '#dc2626' }] }, options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } } } });
                W2.chart(main.querySelector('#i2'), { type: 'line', data: { labels: r[1].map(function (x) { return x.trip_date; }), datasets: [{ label: 'Lines cancelled', data: r[1].map(function (x) { return x.lines; }), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.15)', fill: true, tension: .3 }] }, options: { maintainAspectRatio: false } });
                var od = r[3].slice().reverse();
                W2.chart(main.querySelector('#i3'), { type: 'bar', data: { labels: od.map(function (x) { return x.trip_date; }), datasets: [{ label: 'Orders', data: od.map(function (x) { return x.orders; }), backgroundColor: '#1d4ed8' }] }, options: { maintainAspectRatio: false, plugins: { legend: { display: false } } } });
            });
        }
    });

    // ── Data & sync ──────────────────────────────────────────
    var STEP_NAMES = ['trips', 'lines', 'pickers', 'print', 'shipment', 'orderlines', 'mra', 'pending', 'masters'];
    W2.page('data', {
        title: 'Data & sync', icon: 'fa-arrows-rotate',
        render: function (main, params, live) {
            return Promise.all([W2.call('w2Status', {}), W2.q("SELECT trip_date, kind, ts, ms, steps FROM w2_sync_runs WHERE pod = " + W2.lit(W2.pod()) + " AND trip_date <> '' ORDER BY ts DESC LIMIT 30")]).then(function (r) {
                if (!live()) return;
                var st = r[0] || {}, runs = r[1], last = runs.filter(function (x) { return x.trip_date === W2.date(); })[0];
                var steps = []; try { steps = JSON.parse(last && last.steps || '[]'); } catch (e) {}
                main.innerHTML = '<div class="pagehead"><h2>Data &amp; sync</h2><span class="muted mono xs">' + esc(st.path || '') + ' · ' + W2.fmt((st.sizeBytes || 0) / 1048576, 1) + ' MB</span><span class="grow"></span>' +
                    '<button class="btn primary" id="ds-full"><i class="fa-solid fa-rotate"></i> Full refresh of ' + W2.dayName(W2.date()) + '</button></div>' +
                    '<div class="grid g2"><div class="card"><h3>Last refresh of ' + W2.dayName(W2.date()) + ' <small>' + (last ? esc(last.kind) + ' · ' + W2.ago(last.ts) + ' · ' + (W2.n(last.ms) / 1000).toFixed(1) + ' s' : 'none') + '</small></h3><div class="steps">' +
                    STEP_NAMES.map(function (n) { var s = steps.filter(function (x) { return x.step === n; })[0]; return '<div class="s"><i class="fa-solid ' + (!s ? 'fa-circle muted' : s.ok ? 'fa-circle-check' : 'fa-circle-xmark') + '" style="color:' + (!s ? '' : s.ok ? 'var(--good)' : 'var(--bad)') + '"></i><span><b>' + n + '</b> <span class="muted">' + esc(s ? s.msg : 'not run') + '</span></span><button class="btn sm" data-step="' + n + '">Run</button></div>'; }).join('') + '</div></div>' +
                    '<div class="card"><h3>Sync log <small>this session</small></h3><div class="log" style="max-height:320px">' + (W2.sync.log.map(function (l) { return '<div class="' + (l.kind === 'err' ? 'err' : l.kind === 'warn' ? 'warn' : l.kind === 'ok' ? 'ok' : 'dim') + '">' + esc(l.at + '  ' + l.text) + '</div>'; }).join('') || '<div class="dim">Nothing yet.</div>') + '</div></div></div>' +
                    '<div class="card" style="margin-top:12px"><h3>Tables in the local copy</h3><div id="ds-t"></div></div><div class="card" style="margin-top:12px"><h3>Refreshes</h3><div id="ds-r"></div></div>';
                main.querySelector('#ds-full').onclick = function () { W2.sync.day(W2.date(), { full: true }); };
                main.querySelectorAll('[data-step]').forEach(function (b) { b.onclick = function () { W2.sync.day(W2.date(), { only: [b.dataset.step] }); }; });
                W2.grid(main.querySelector('#ds-t'), (st.tables || []).map(function (t) { return Object.assign({}, t, { ago: W2.ago(t.lastWrite) }); }), [{ k: 'table', t: 'Table' }, { k: 'rows', t: 'Rows', num: true, sum: true }, { k: 'ago', t: 'Last write' }, { k: 'lastScope', t: 'Scope' }, { k: 'lastMs', t: 'ms', num: true },
                    { k: 'table', t: '', fmt: function (v) { return v === 'w2_sync_log' ? '' : '<button class="btn sm" data-clear="' + esc(v) + '">Clear</button>'; } }],
                    { after: function (b) { b.querySelectorAll('[data-clear]').forEach(function (btn) { btn.onclick = function () { W2.call('w2Clear', { table: btn.dataset.clear }).then(function () { return W2.ensureTables(); }).then(function () { W2.toast(btn.dataset.clear + ' cleared — the next refresh fills it again.', 'success'); W2.render(); }); }; }); } });
                W2.grid(main.querySelector('#ds-r'), runs.map(function (x) { var s = []; try { s = JSON.parse(x.steps || '[]'); } catch (e) {} return Object.assign({}, x, { failed: s.filter(function (y) { return !y.ok; }).map(function (y) { return y.step; }).join(', ') }); }),
                    [{ k: 'trip_date', t: 'Trip date' }, { k: 'kind', t: 'Kind' }, { k: 'ts', t: 'When' }, { k: 'ms', t: 'ms', num: true }, { k: 'failed', t: 'Failed steps' }], { max: 100 });
            });
        }
    });

    // ── Settings ─────────────────────────────────────────────
    W2.page('settings', {
        title: 'Settings', icon: 'fa-gear',
        render: function (main) {
            var s = W2.sync.settings();
            main.innerHTML = '<div class="pagehead"><h2>Settings</h2><span class="muted">this PC</span></div><div class="grid g2"><div class="card"><h3>Refresh</h3><div class="stack sm">' +
                '<label>Refresh the trip date on screen in the background <select class="f" id="s-auto">' + [[30, 'every 30 minutes'], [45, 'every 45 minutes'], [60, 'every hour'], [120, 'every 2 hours'], [0, 'never (Refresh button only)']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] == s.autoMin ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select> (only while the page is visible; it reads trips, trip lines, pickers, print jobs, Fusion shipment status and MRA of that date into the local copy)</label>' +
                '<label>Read shipment lines from Fusion <select class="f" id="s-pool">' + [2, 4, 6, 8, 10].map(function (n) { return '<option' + (n == s.shipPool ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select> orders at a time</label>' +
                '<label>Send <select class="f" id="s-mra">' + [1, 2, 3, 4, 5, 6].map(function (n) { return '<option' + (n == (s.mraPar || 4) ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select> orders to MRA at a time</label>' +
                '<label><input type="checkbox" id="s-mrachk"' + (s.mraCheck ? ' checked' : '') + '> check MRA status of interfaced orders on every refresh (MRA_TRX_NO_CHECK_BIP)</label>' +
                '<label>Pending orders: organization <input class="f" id="s-org" value="' + esc(s.org) + '"> · last <input class="f" id="s-days" type="number" value="' + s.pendingDays + '" style="width:70px"> days</label>' +
                '<button class="btn primary sm" id="s-save">Save</button></div></div>' +
                '<div class="card"><h3>About WMS 2.0</h3><div class="sm stack"><p>A new module next to the WMS — the WMS itself is not changed. It reads the same APEX endpoints and tables, keeps a copy in DuckDB on this PC (Data &amp; sync), and runs actions through the same calls as the WMS (pick release, order dialogs, MRA, printing).</p>' +
                '<p>The trip date opens on <b>tomorrow</b> every time; the date you pick stays while the page is open.</p>' +
                '<p>Order details, store transactions, pick confirm, ship confirm and cancelling a line by hand are the WMS dialogs copied as they are. The Trip screen is the WMS trip page itself (Edit trip, Assign picker, Pick Release All, Allocate lots S2V, All shipment lines, Show lines, Profit centers, Add orders, Add to agent, Move / Remove / Print per order, Create trip) — copied from wms/ by wms2/legacy/copy-from-wms.py.</p></div></div></div>';
            main.querySelector('#s-save').onclick = function () {
                W2.ls('w2.sync', { autoMin: +main.querySelector('#s-auto').value, shipPool: +main.querySelector('#s-pool').value, mraPar: +main.querySelector('#s-mra').value, mraCheck: main.querySelector('#s-mrachk').checked,
                    org: main.querySelector('#s-org').value.trim() || 'GRAYS INC', pendingDays: Math.max(1, +main.querySelector('#s-days').value || 30) });
                W2.toast('Settings saved on this PC.', 'success'); W2.sync.ensureFresh();
            };
        }
    });
})();
