// ============================================================================
// PENDING SHIPMENT LINES › "Identify lines to Cancel" (wms/pending-cancel.js)
// ----------------------------------------------------------------------------
// The pending shipment lines are orders that have NO trip yet, so the trip endpoints (getsalesorderlinesbytrip,
// fetchfusionorderlines — both need a trip id) cannot read their lines. This script reads them straight from Fusion:
//   1. the button on the Pending Shipment Lines action bar starts a BACKGROUND run (a promise chain — the user may open
//      any other WMS page; a floating chip at the bottom right shows the progress there): for every pending order
//      (the ticked rows of the grid, else every fetched row) GET salesOrdersForOrderHub/OPS:{order}/child/lines through
//      the host action executeOracleFusionGet (credentials stay in C#), 4 orders at a time;
//   2. the lines are kept in their own DuckDB table w2_pend_lines (the WMS 2.0 file through w2Put — one row per order
//      line, the newest read wins; best effort: without DuckDB everything still works for the session);
//   3. the Shipping Agent's rule (wms/cancel-rules.js, global W2CR = Task 2: Scheduled / Manual Reservation main lines
//      + their sub-lines / BOGO promo items, children already cancelled / shipped / interfaced skipped) picks the lines
//      to cancel → w2_pend_cands + a run row in w2_pend_runs;
//   4. a dialog lists them (tick boxes, filters, CSV) and a notification lands in the bell icon — clicking that
//      notification opens the same dialog again;
//   5. "Cancel ticked lines in Fusion" (a second confirmation inside the dialog) → the AI kill switch → per order:
//      the lines are read LIVE again, only the ticked lines that are still eligible are sent (PATCH
//      salesOrdersForOrderHub/OPS:{order} { lines: [{ FulfillLineId, OrderedQuantity: 0, CancelReason: 'OUT OF STOCK' }] }),
//      read again after 2.5 s — DONE only when the line now reads Cancelled (or is gone), else FAILED — every line goes
//      to the shared ledger WMS_W2_CANCEL_LOG (trip_id 'PENDING'), every order is audited (aiAudit, source
//      WMS_PENDING_CANCEL, approval POPUP), the results stay in the dialog and w2_pend_cands, the grid is fetched again.
// window.PendingCancel = { start, stop, open, onShow, state, last }
// ============================================================================
(function () {
    'use strict';
    var ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP';
    var WM = ORDS + '/WAREHOUSEMANAGEMENT', GW = WM + '/ai';
    var FUSION = { PROD: 'https://efmh.fa.em3.oraclecloud.com', TEST: 'https://efmh-test.fa.em3.oraclecloud.com' };
    var REST = '/fscmRestApi/resources/11.13.18.05/';
    var PAGE = 'pending-shipment-lines';
    var SENDER = 'Pending shipments';          // the bell notifications of this script carry this sender
    var READ_POOL = 4, CANCEL_POOL = 2;
    var R = window.W2CR;

    // ─── small helpers ─────────────────────────────────────────────────────────
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var lit = function (s) { return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"; };
    var pad2 = function (n) { return ('0' + n).slice(-2); };
    var now = function () { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); };
    var hhmm = function (t) { var m = /T(\d{2}:\d{2})/.exec(String(t || '')); return m ? m[1] : String(t || ''); };
    var enc = encodeURIComponent;
    var str = function (v) { return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); };
    function secs(ms) { var s = Math.round(ms / 1000); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' m ' + pad2(s % 60) + ' s'; }
    function pick(row, names) {
        if (!row) return '';
        var keys = Object.keys(row);
        for (var i = 0; i < names.length; i++) { var k = keys.find(function (x) { return x.toLowerCase() === names[i].toLowerCase(); }); if (k && row[k] != null && row[k] !== '') return row[k]; }
        return '';
    }
    function items(r) { if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return []; } } return Array.isArray(r) ? r : (r && Array.isArray(r.items)) ? r.items : []; }
    function user() { try { return localStorage.getItem('wms_user') || sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || 'WMS'; } catch (e) { return 'WMS'; } }
    function pc() {
        try {
            var raw = localStorage.getItem('w2.pcid'), v = raw && raw.charAt(0) === '"' ? JSON.parse(raw) : raw;
            if (!v) { v = 'PC-' + Math.random().toString(36).slice(2, 8).toUpperCase(); localStorage.setItem('w2.pcid', JSON.stringify(v)); }
            return v;
        } catch (e) { return 'PC'; }
    }
    function note(m, t) { if (typeof showNotification === 'function') showNotification(m, t || 'info'); else console.log('[PendingCancel]', m); }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    /** n at a time; a failing item never stops the others (fn handles its own errors); stops early when `stop()` says so. */
    function pool(list, n, fn, stop) {
        var i = 0;
        var next = function () {
            if (i >= list.length || (stop && stop())) return Promise.resolve();
            var idx = i++;
            return Promise.resolve().then(function () { return fn(list[idx], idx); }).catch(function (e) { console.warn('[PendingCancel] pooled call failed:', e && e.message || e); }).then(next);
        };
        var w = []; for (var k = 0; k < Math.min(n, list.length); k++) w.push(next());
        return Promise.all(w);
    }
    function lineSort(a, b) {
        var oa = String(a.order), ob = String(b.order); if (oa !== ob) return oa < ob ? -1 : 1;
        var pa = String(a.line).split('.'), pb = String(b.line).split('.');
        for (var i = 0; i < Math.max(pa.length, pb.length); i++) { var x = parseFloat(pa[i] || '0') || 0, y = parseFloat(pb[i] || '0') || 0; if (x !== y) return x - y; }
        return 0;
    }

    // ─── host IO (never the full-page "Processing" overlay: the run happens in the background) ─────
    function host(msg, ms) {
        return new Promise(function (resolve, reject) {
            if (typeof sendMessageToCSharp !== 'function') { reject(new Error('Open this page inside the Gray\'s WMS app.')); return; }
            sendMessageToCSharp(msg, function (err, data) {
                if (err) { reject(new Error(typeof err === 'string' ? err : (err.message || JSON.stringify(err)))); return; }
                var r = data; if (typeof data === 'string') { try { r = JSON.parse(data); } catch (e) { r = data; } }
                resolve(r);
            }, ms || 120000, false);
        });
    }
    function get(url, ms) { return host({ action: 'executeGet', fullUrl: url }, ms || 120000); }
    function post(url, body, ms) { return host({ action: 'executePost', fullUrl: url, body: typeof body === 'string' ? body : JSON.stringify(body || {}) }, ms || 180000); }
    function gw(sql, max) {
        return post(GW + '/executequery', { appUser: user(), sql: sql, maxRows: max || 5000 }).then(function (d) {
            if (!d || d.success === false) throw new Error((d && d.error) || 'APEX query failed');
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || []).map(function (r) {
                if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; }
                var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x;
            });
        });
    }
    function gwWrite(sql) { return post(GW + '/executewrite', { appUser: user(), sql: sql }).then(function (d) { if (!d || d.success === false) throw new Error((d && d.error) || 'APEX write failed'); return d; }); }
    function fusionGet(pod, url) { return host({ action: 'executeOracleFusionGet', fullUrl: url, instance: pod }, 120000); }
    function fusionPatch(pod, order, body) { return host({ action: 'executeOracleFusionPatch', fullUrl: R.url(FUSION[pod] || FUSION.PROD, order), body: JSON.stringify(body), instance: pod }, 120000); }
    function audit(ev) { return host(Object.assign({ action: 'aiAudit', source: 'WMS_PENDING_CANCEL', approval: 'POPUP', appUser: user() }, ev), 15000).catch(function () {}); }

    // ─── DuckDB (the WMS 2.0 file; best effort — the page works without it) ────
    var COLS = {
        w2_pend_runs: ['pod', 'run_id', 'started_at', 'ended_at', 'ms', 'status', 'orders', 'orders_read', 'orders_failed', 'lines_read', 'cand_orders', 'cand_lines', 'skipped', 'cancelled', 'cancel_failed', 'organization', 'from_date', 'to_date', 'selected_only', 'pc', 'by_user', 'summary'],
        w2_pend_lines: ['pod', 'order_number', 'line_number', 'item', 'description', 'line_status', 'status_code', 'fulfill_line_id', 'qty', 'uom', 'schedule_ship_date', 'requested_ship_date', 'org_code', 'source_line_number', 'line_id', 'account_name', 'order_date', 'read_at', 'run_id'],
        w2_pend_cands: ['pod', 'run_id', 'order_number', 'account_name', 'order_date', 'order_type', 'line_number', 'item', 'description', 'qty', 'line_status', 'fulfill_line_id', 'via', 'child_of', 'schedule_ship_date', 'tries_before', 'found_at', 'ticked', 'result', 'message', 'response', 'decided_at', 'by_user']
    };
    var DB = {
        host: null, probing: null, io: Promise.resolve(),
        call: function (action, payload, ms, attempt) {
            return host(Object.assign({ action: action, appUser: user() }, payload || {}), ms || 120000).then(function (d) {
                var busy = d && d.ok === false && (d.busy || /another .*window|busy/i.test(String(d.error || '')));
                if (busy && (attempt || 0) < 3) return sleep(1500 + 1500 * (attempt || 0)).then(function () { return DB.call(action, payload, ms, (attempt || 0) + 1); });
                return d;
            });
        },
        probe: function () {
            if (DB.probing) return DB.probing;
            DB.probing = DB.call('w2Status', {}, 15000).then(function (d) { DB.host = !!(d && d.ok !== false); return DB.host; }, function () { DB.host = false; return false; });
            return DB.probing;
        },
        on: function () { return DB.host === true; },
        rowsOf: function (d) { var cols = (d.columns || []).map(function (c) { return String(c).toLowerCase(); }); return (d.rows || []).map(function (r) { var o = {}; cols.forEach(function (c, i) { o[c] = r[i]; }); return o; }); },
        /** Several reads in one open of the file; a failing one (the table does not exist yet) gives []. */
        qs: function (list) {
            if (!DB.on()) return Promise.resolve(list.map(function () { return []; }));
            return DB.call('w2Queries', { queries: list }).then(function (d) { return ((d && d.results) || []).map(function (r) { if (!r || r.error) return []; return DB.rowsOf(r); }); });
        },
        put: function (table, scope, rows) {
            if (!DB.on() || !rows.length) return Promise.resolve();
            var clean = rows.map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { o[k] = str(r[k]); }); return o; });
            var p = DB.io.then(function () { return DB.call('w2Put', { table: table, scope: scope, rows: clean, replaceAll: false, columns: COLS[table] || [] }, 300000); });
            DB.io = p.catch(function (e) { console.warn('[PendingCancel] DuckDB write failed:', e && e.message || e); });
            return p.catch(function () {});
        }
    };

    // ─── the shared ledger (same table as the autopilot / WMS 2.0; created on first use) ──────
    var LEDGER_DDL = "CREATE TABLE wms_w2_cancel_log (log_id NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, run_id VARCHAR2(40), logged_at DATE DEFAULT SYSDATE, pod VARCHAR2(10), " +
        "pc_name VARCHAR2(60), app_user VARCHAR2(200), trip_date VARCHAR2(10), trip_id VARCHAR2(60), order_number VARCHAR2(60), line_number VARCHAR2(30), item VARCHAR2(200), status_before VARCHAR2(200), " +
        "fulfill_line_id VARCHAR2(60), via VARCHAR2(20), result VARCHAR2(20), message VARCHAR2(1000), response VARCHAR2(2000))";
    var ready = null;
    function ensure() {
        if (ready) return ready;
        ready = gw("SELECT table_name FROM user_tables WHERE table_name = 'WMS_W2_CANCEL_LOG'", 2).then(function (r) { if (!r.length) return gwWrite(LEDGER_DDL); }).catch(function (e) { ready = null; throw e; });
        return ready;
    }
    /** Ledger rows to APEX (INSERT … SELECT … FROM dual UNION ALL, 20 per statement). */
    function pushLog(rows) {
        var cols = ['run_id', 'pod', 'pc_name', 'app_user', 'trip_date', 'trip_id', 'order_number', 'line_number', 'item', 'status_before', 'fulfill_line_id', 'via', 'result', 'message', 'response'];
        var val = function (r, c) { return lit(String(r[c] == null ? '' : r[c]).slice(0, c === 'response' ? 1900 : c === 'message' ? 990 : 190)); };
        var chunks = []; for (var i = 0; i < rows.length; i += 20) chunks.push(rows.slice(i, i + 20));
        return ensure().then(function () {
            return chunks.reduce(function (p, ch) {
                return p.then(function () { return gwWrite("INSERT INTO wms_w2_cancel_log (" + cols.join(', ') + ") " + ch.map(function (r) { return "SELECT " + cols.map(function (c) { return val(r, c); }).join(', ') + " FROM dual"; }).join(' UNION ALL ')); });
            }, Promise.resolve());
        });
    }
    /** How often each fulfillment line was tried in the last 3 days (any PC, autopilot or popup) — {fid: n}. */
    function triesOf(pod, fids) {
        if (!fids.length) return Promise.resolve({});
        var chunks = []; for (var i = 0; i < fids.length; i += 300) chunks.push(fids.slice(i, i + 300));
        var out = {};
        return ensure().then(function () {
            return chunks.reduce(function (p, ch) {
                return p.then(function () {
                    return gw("SELECT fulfill_line_id, COUNT(*) AS tries FROM wms_w2_cancel_log WHERE pod = " + lit(pod) + " AND result IN ('DONE', 'FAILED') AND logged_at >= SYSDATE - 3 AND fulfill_line_id IN (" + ch.map(lit).join(',') + ") GROUP BY fulfill_line_id", 1000)
                        .then(function (rows) { rows.forEach(function (r) { out[String(r.FULFILL_LINE_ID)] = +r.TRIES || 0; }); });
                });
            }, Promise.resolve());
        }).then(function () { return out; }).catch(function () { return out; });
    }

    // ─── Fusion: the lines of one order, shaped like the WMS lines the rule reads ─────────
    function shape(order, l) {
        var ln = l.DisplayLineNumber != null && l.DisplayLineNumber !== '' ? String(l.DisplayLineNumber)
            : l.LineNumber != null ? String(l.LineNumber) + (l.FulfillLineNumber && +l.FulfillLineNumber > 1 ? '.' + l.FulfillLineNumber : '') : '';
        var status = l.Status || l.DisplayStatus || l.FulfillLineStatus || String(l.StatusCode || '').replace(/_/g, ' ');
        if (!/cancel/i.test(status) && (l.CanceledFlag === true || l.CanceledFlag === 'true')) status = 'Canceled';
        return {
            ORDER_NUMBER: String(order), LINE_NUMBER: ln, PRODUCT_NUMBER: l.ProductNumber || l.ItemNumber || '', PRODUCT_DESCRIPTION: l.ProductDescription || '',
            LINE_STATUS: String(status || ''), STATUS_CODE: l.StatusCode || '', FULFILL_LINE_ID: l.FulfillLineId != null ? String(l.FulfillLineId) : '',
            ORDERED_QUANTITY: l.OrderedQuantity != null ? l.OrderedQuantity : '', UOM: l.OrderedUOMCode || l.OrderedUOM || '', SCHEDULE_SHIP_DATE: l.ScheduleShipDate || '',
            REQUESTED_SHIP_DATE: l.RequestedShipDate || '', ORG_CODE: l.RequestedFulfillmentOrganizationCode || '', SOURCE_LINE_NUMBER: l.SourceTransactionLineNumber || '', LINE_ID: l.LineId != null ? String(l.LineId) : ''
        };
    }
    function readLines(pod, order) {
        var base = FUSION[pod];
        if (!base) return Promise.reject(new Error('No Fusion address is known for instance ' + pod));
        var all = [];
        function page(off) {
            return fusionGet(pod, base + REST + 'salesOrdersForOrderHub/OPS:' + enc(order) + '/child/lines?onlyData=true&limit=500&offset=' + off).then(function (r) {
                if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { /* text answer */ } }
                if (!r || !Array.isArray(r.items)) throw new Error(R.patchError(r) || (typeof r === 'string' ? r.slice(0, 200) : 'unexpected answer ' + JSON.stringify(r == null ? null : r).slice(0, 200)));
                r.items.forEach(function (l) { all.push(shape(order, l)); });
                if (r.hasMore && r.items.length) return page(off + r.items.length);
                return all;
            });
        }
        return page(0);
    }
    var bogoCache = {};
    function bogo(pod) {
        var c = bogoCache[pod];
        if (c && Date.now() - c.at < 12 * 3600000) return Promise.resolve(c.map);
        return get(ORDS + '/ARMODULE/BOGO?p_instance_name=' + enc(pod)).then(function (j) { var map = R.bogoMap(items(j)); bogoCache[pod] = { at: Date.now(), map: map }; return map; }).catch(function () { return (c && c.map) || {}; });
    }

    // ─── the pending orders on the page ────────────────────────────────────────
    function pod() { var el = document.getElementById('psl-instance-name'); return String((el && el.value) || 'PROD').toUpperCase(); }
    function pendingOrders() {
        var rows = [], selected = false;
        try { if (typeof pslGrid !== 'undefined' && pslGrid && typeof pslGrid.getSelectedRowsData === 'function') rows = pslGrid.getSelectedRowsData() || []; } catch (e) { rows = []; }
        if (rows.length) selected = true;
        else { try { rows = (typeof pslData !== 'undefined' && Array.isArray(pslData)) ? pslData : []; } catch (e) { rows = []; } }
        var map = {}, list = [];
        rows.forEach(function (r) {
            var o = String(pick(r, ['source_order_number', 'order_number', 'SOURCE_ORDER_NUMBER']) || '').trim();
            if (!o || map[o]) return;
            map[o] = { order: o, account: pick(r, ['account_name', 'customer_name']), accountNo: pick(r, ['account_number']), orderDate: String(pick(r, ['order_date']) || '').slice(0, 10), orderType: pick(r, ['order_type_code', 'order_type']), rep: pick(r, ['salesrep_name']) };
            list.push(map[o]);
        });
        return { list: list, selected: selected };
    }
    function filtersNow() { var v = function (id) { var e = document.getElementById(id); return e ? String(e.value || '') : ''; }; return { organization: v('psl-organization'), from: v('psl-from-date'), to: v('psl-to-date') }; }

    // ─── state ─────────────────────────────────────────────────────────────────
    var PC = window.PendingCancel = { state: { running: null, stopping: false, status: '', lastLoad: null }, last: null };
    function newRunId() { return 'PC-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(); }

    /** Start the background check. */
    PC.start = function (opts) {
        opts = opts || {};
        if (PC.state.running) { note('A check is already running — ' + PC.state.status, 'warning'); return PC.state.running; }
        if (!R) { note('cancel-rules.js is not loaded — the rule module is missing.', 'error'); return Promise.resolve(); }
        var p = pod(), po = pendingOrders(), orders = po.list;
        if (!orders.length) { note('Fetch the pending shipment lines first (Fetch Data), then identify the lines to cancel.', 'warning'); return Promise.resolve(); }
        if (!FUSION[p]) { note('No Fusion address is known for instance ' + p + ' — choose PROD or TEST.', 'error'); return Promise.resolve(); }
        var runId = newRunId(), t0 = Date.now(), started = now(), f = filtersNow();
        var res = { runId: runId, pod: p, startedAt: started, endedAt: null, ms: 0, status: 'RUNNING', selectedOnly: po.selected, filters: f, by: user(),
            orders: orders.length, ordersRead: 0, ordersFailed: 0, linesRead: 0, cands: [], skipped: [], errors: [], noId: [], candOrders: 0, cancelled: 0, cancelFailed: 0, fromDb: false };
        var lines = {}, readAt = now();
        PC.state.stopping = false;
        var say = function (t) { PC.state.status = t; paintChip(); paintFloat(); };
        say('starting · ' + orders.length + ' pending order' + (orders.length === 1 ? '' : 's') + (po.selected ? ' (ticked)' : ''));
        note('Identifying lines to cancel on ' + orders.length + ' pending order' + (orders.length === 1 ? '' : 's') + ' — runs in the background, you may keep working.', 'info');
        var btn = document.getElementById('psl-identify-btn'); if (btn) btn.disabled = true;

        PC.state.running = Promise.all([bogo(p), DB.probe()]).then(function (r) {
            var bg = r[0], done = 0;
            return pool(orders, READ_POOL, function (o) {
                return readLines(p, o.order).then(function (ls) {
                    lines[o.order] = ls; res.ordersRead++; res.linesRead += ls.length;
                }, function (e) {
                    res.ordersFailed++; res.errors.push({ order: o.order, account: o.account, message: String(e && e.message || e) });
                }).then(function () {
                    done++;
                    say('reading Fusion lines · ' + done + ' / ' + orders.length + ' orders' + (res.ordersFailed ? ' · ' + res.ordersFailed + ' could not be read' : ''));
                });
            }, function () { return PC.state.stopping; }).then(function () {
                // 2. the lines to DuckDB (one row per order line, the newest read of an order replaces its earlier rows)
                var rows = [], ordersWithLines = Object.keys(lines);
                ordersWithLines.forEach(function (o) {
                    var meta = orders.find(function (x) { return x.order === o; }) || {};
                    lines[o].forEach(function (l) {
                        rows.push({ pod: p, order_number: o, line_number: l.LINE_NUMBER, item: l.PRODUCT_NUMBER, description: l.PRODUCT_DESCRIPTION, line_status: l.LINE_STATUS, status_code: l.STATUS_CODE, fulfill_line_id: l.FULFILL_LINE_ID, qty: l.ORDERED_QUANTITY, uom: l.UOM, schedule_ship_date: l.SCHEDULE_SHIP_DATE, requested_ship_date: l.REQUESTED_SHIP_DATE, org_code: l.ORG_CODE, source_line_number: l.SOURCE_LINE_NUMBER, line_id: l.LINE_ID, account_name: meta.account || '', order_date: meta.orderDate || '', read_at: readAt, run_id: runId });
                    });
                });
                if (ordersWithLines.length) { say('saving ' + rows.length + ' lines to DuckDB'); DB.put('w2_pend_lines', { pod: p, order_number: ordersWithLines }, rows); }
                // 3. the rule
                say('identifying the lines to cancel');
                ordersWithLines.forEach(function (o) {
                    var meta = orders.find(function (x) { return x.order === o; }) || {}, set = R.expand(lines[o], bg);
                    set.lines.forEach(function (x) {
                        var l = x.line;
                        res.cands.push({ order: o, account: meta.account || '', orderDate: meta.orderDate || '', orderType: meta.orderType || '', line: R.lineNum(l), item: R.lineItem(l), desc: l.PRODUCT_DESCRIPTION || '', qty: l.ORDERED_QUANTITY, status: R.lineStatus(l), fid: String(R.fid(l) || ''), via: x.via, childOf: x.childOf || '', shipDate: String(l.SCHEDULE_SHIP_DATE || l.REQUESTED_SHIP_DATE || '').slice(0, 10), tries: 0, tick: true, result: '', message: '', response: '', decidedAt: '' });
                    });
                    set.skipped.forEach(function (s) { res.skipped.push({ order: o, account: meta.account || '', line: R.lineNum(s.line), item: R.lineItem(s.line), status: R.lineStatus(s.line), via: s.via, childOf: s.parentNum || '', reason: s.reason }); });
                    set.noId.forEach(function (l) { res.noId.push({ order: o, account: meta.account || '', line: R.lineNum(l), item: R.lineItem(l), status: R.lineStatus(l), via: 'MAIN', childOf: '', reason: 'no fulfillment line id — not cancellable through the API' }); });
                });
                res.cands.sort(lineSort);
                res.candOrders = Object.keys(res.cands.reduce(function (m, c) { m[c.order] = 1; return m; }, {})).length;
                return triesOf(p, res.cands.map(function (c) { return c.fid; }).filter(Boolean));
            }).then(function (tries) {
                res.cands.forEach(function (c) { c.tries = tries[c.fid] || 0; if (c.tries >= 3) c.tick = false; });
            });
        }).then(function () { finish(null); }, function (e) { finish(e); });
        paintChip(); paintFloat();

        function finish(err) {
            res.ms = Date.now() - t0; res.endedAt = now();
            res.status = err ? 'FAILED' : PC.state.stopping ? 'STOPPED' : 'DONE';
            if (err) res.errors.unshift({ order: '*', account: '', message: String(err && err.message || err) });
            PC.last = res;
            DB.put('w2_pend_cands', { pod: p, run_id: runId }, candRows(res));
            DB.put('w2_pend_runs', { pod: p, run_id: runId }, [runRow(res)]);
            PC.state.running = null; PC.state.stopping = false; PC.state.status = '';
            if (btn) btn.disabled = false;
            paintChip(); paintFloat();
            var text = res.cands.length + ' line' + (res.cands.length === 1 ? '' : 's') + ' to cancel on ' + res.candOrders + ' of ' + res.orders + ' pending order' + (res.orders === 1 ? '' : 's') +
                (res.ordersFailed ? ' · ' + res.ordersFailed + ' order' + (res.ordersFailed === 1 ? '' : 's') + ' could not be read' : '') + (res.status === 'STOPPED' ? ' · stopped early' : '');
            if (err) note('Identify lines to cancel: ' + (err.message || err), 'error');
            else note(text + ' · ' + secs(res.ms), res.cands.length ? 'warning' : 'success');
            notify(res.cands.length ? '⚡ ' + text + ' — click to review and cancel' : (err ? '✗ The check failed: ' + (err.message || err) : '✓ No lines to cancel — ' + text), res.cands.length ? 'action' : err ? 'alert' : 'status_change');
            audit({ actionKey: 'pending_cancel_check', outcome: err ? 'FAILED' : res.status === 'STOPPED' ? 'STOPPED' : 'OK', instance: p, refId: 'RUN:' + runId, target: res.candOrders + ' order(s)', detail: text + ' · ' + res.linesRead + ' lines read from Fusion in ' + secs(res.ms) + (res.selectedOnly ? ' · ticked orders only' : '') });
            if (!opts.silent && !err) PC.open();
        }
        return PC.state.running;
    };
    PC.stop = function () { if (!PC.state.running) return; PC.state.stopping = true; PC.state.status = 'stopping after the orders in hand'; paintChip(); paintFloat(); };

    function runRow(res) {
        return { pod: res.pod, run_id: res.runId, started_at: res.startedAt, ended_at: res.endedAt, ms: res.ms, status: res.status, orders: res.orders, orders_read: res.ordersRead, orders_failed: res.ordersFailed, lines_read: res.linesRead,
            cand_orders: res.candOrders, cand_lines: res.cands.length, skipped: res.skipped.length + res.noId.length, cancelled: res.cancelled, cancel_failed: res.cancelFailed, organization: (res.filters || {}).organization || '', from_date: (res.filters || {}).from || '', to_date: (res.filters || {}).to || '',
            selected_only: res.selectedOnly ? 'Y' : 'N', pc: pc(), by_user: res.by || user(), summary: JSON.stringify({ errors: res.errors.slice(0, 50), skipped: res.skipped.length, noId: res.noId.length }) };
    }
    function candRows(res) {
        return res.cands.map(function (c) {
            return { pod: res.pod, run_id: res.runId, order_number: c.order, account_name: c.account, order_date: c.orderDate, order_type: c.orderType, line_number: c.line, item: c.item, description: c.desc, qty: c.qty, line_status: c.status, fulfill_line_id: c.fid, via: c.via, child_of: c.childOf, schedule_ship_date: c.shipDate, tries_before: c.tries, found_at: res.endedAt || now(), ticked: c.tick ? 'Y' : 'N', result: c.result, message: c.message, response: c.response, decided_at: c.decidedAt, by_user: c.by || '' };
        });
    }
    /** The last run of this pod from DuckDB (another day, another window) so the chip and the dialog come back. */
    PC.loadLast = function () {
        var p = pod();
        if (PC.last && PC.last.pod === p && !PC.last.fromDb) return Promise.resolve(PC.last);
        return DB.probe().then(function (on) {
            if (!on) return null;
            return DB.qs([{ sql: "SELECT * FROM w2_pend_runs WHERE pod = " + lit(p) + " ORDER BY started_at DESC LIMIT 1" }]).then(function (r) {
                var run = r[0][0]; if (!run) return null;
                return DB.qs([{ sql: "SELECT * FROM w2_pend_cands WHERE pod = " + lit(p) + " AND run_id = " + lit(run.run_id) }]).then(function (q) {
                    var sum = {}; try { sum = JSON.parse(run.summary || '{}'); } catch (e) { sum = {}; }
                    var res = { runId: run.run_id, pod: p, startedAt: run.started_at, endedAt: run.ended_at, ms: +run.ms || 0, status: run.status, selectedOnly: run.selected_only === 'Y', filters: { organization: run.organization, from: run.from_date, to: run.to_date }, by: run.by_user,
                        orders: +run.orders || 0, ordersRead: +run.orders_read || 0, ordersFailed: +run.orders_failed || 0, linesRead: +run.lines_read || 0, candOrders: +run.cand_orders || 0, cancelled: +run.cancelled || 0, cancelFailed: +run.cancel_failed || 0,
                        errors: sum.errors || [], skipped: [], noId: [], skippedCount: +run.skipped || 0, fromDb: true,
                        cands: q[0].map(function (c) { return { order: c.order_number, account: c.account_name, orderDate: c.order_date, orderType: c.order_type, line: c.line_number, item: c.item, desc: c.description, qty: c.qty, status: c.line_status, fid: c.fulfill_line_id, via: c.via, childOf: c.child_of, shipDate: c.schedule_ship_date, tries: +c.tries_before || 0, tick: c.ticked !== 'N' && !c.result, result: c.result || '', message: c.message || '', response: c.response || '', decidedAt: c.decided_at || '', by: c.by_user || '' }; }).sort(lineSort) };
                    if (!PC.last || PC.last.pod !== p || PC.last.fromDb) PC.last = res;
                    return PC.last;
                });
            });
        }).catch(function () { return null; }).then(function (r) { paintChip(); return r; });
    };

    // ─── the bell icon ─────────────────────────────────────────────────────────
    function notify(message, type) {
        if (typeof window.handleMobileNotification !== 'function') return;
        try { window.handleMobileNotification({ type: type || 'action', orderNumber: '', message: message, sender: SENDER, data: {}, receivedAt: new Date().toISOString() }); } catch (e) { console.warn('[PendingCancel] bell:', e); }
    }
    function isOurs(card) { var head = card && card.querySelector('span'); return !!(head && head.textContent.trim().indexOf(SENDER) === 0); }
    function decorateCards() {
        var list = document.getElementById('mobile-notif-list'); if (!list) return;
        list.querySelectorAll('.mobile-notif-card').forEach(function (card) { if (isOurs(card)) { card.classList.add('pc-notif'); card.title = 'Click to open the lines to cancel'; } });
    }
    (function wireBell() {
        var orig = window._renderMobileNotifList;
        if (typeof orig === 'function' && !orig._pc) {
            var w = function () { var r = orig.apply(this, arguments); decorateCards(); return r; }; w._pc = true;
            window._renderMobileNotifList = w;
        }
        document.addEventListener('click', function (e) {
            var card = e.target && e.target.closest ? e.target.closest('.mobile-notif-card') : null;
            if (!card || !isOurs(card)) return;
            if (typeof window.closeMobileNotifPanel === 'function') window.closeMobileNotifPanel();
            PC.open();
        }, true);
    })();

    // ─── chips: the action bar of the page, the floating one on other pages ────
    function onPage() { var r = document.getElementById(PAGE); return !!(r && r.style.display !== 'none' && r.offsetParent !== null); }
    function paintChip() {
        var prog = document.getElementById('pc-progress'), txt = document.getElementById('pc-progress-text'), last = document.getElementById('pc-last');
        if (prog) { prog.style.display = PC.state.running ? 'inline-flex' : 'none'; if (txt) txt.textContent = PC.state.status; }
        if (!last) return;
        var r = PC.last;
        if (!r || r.pod !== pod()) { last.style.display = 'none'; return; }
        var n = r.cands.length, open = r.cands.filter(function (c) { return !c.result; }).length;
        last.style.display = 'inline-flex';
        last.className = 'pc-chip ' + (r.status === 'FAILED' ? 'err' : n ? '' : 'none');
        last.innerHTML = '<i class="fas ' + (n ? 'fa-exclamation-triangle' : 'fa-check') + '"></i> ' +
            esc(hhmm(r.endedAt || r.startedAt) + ' · ' + (n ? n + ' line' + (n === 1 ? '' : 's') + ' to cancel on ' + r.candOrders + ' order' + (r.candOrders === 1 ? '' : 's') + (r.cancelled ? ' · ' + r.cancelled + ' cancelled' : '') + (open < n ? ' · ' + open + ' open' : '') : 'no lines to cancel on ' + r.orders + ' orders') + (r.fromDb ? ' · from DuckDB' : '')) +
            ' <button class="pc-mini" type="button" onclick="PendingCancel.open()">Review</button>';
    }
    function paintFloat() {
        var el = document.getElementById('pc-float');
        var show = PC.state.running && !onPage() && !document.querySelector('.pc-ov');
        if (!show) { if (el) el.remove(); return; }
        if (!el) {
            el = document.createElement('div'); el.id = 'pc-float'; el.className = 'pc-float';
            el.onclick = function (e) { if (e.target.tagName === 'BUTTON') return; if (typeof navigateToPage === 'function') navigateToPage(PAGE); };
            document.body.appendChild(el);
        }
        var pr = document.getElementById('pr-float'); el.classList.toggle('up', !!(pr && pr.offsetParent !== null));
        el.innerHTML = '<i class="fas fa-cut"></i> <span><b>Identify lines to cancel</b> · ' + esc(PC.state.status) + '</span> <button class="pc-mini" type="button" onclick="PendingCancel.stop()">Stop</button>';
    }
    PC.onShow = function () { paintChip(); paintFloat(); PC.loadLast(); };
    (function wireShow() {
        var orig = window.navigateToPage;
        if (typeof orig === 'function' && !orig._pc) {
            var w = function (page) { var r = orig.apply(this, arguments); try { if (page === PAGE) setTimeout(PC.onShow, 50); else paintFloat(); } catch (e) { /* ok */ } return r; }; w._pc = true;
            window.navigateToPage = w;
        }
        var boot = function () { if (onPage()) PC.onShow(); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 800); }); else setTimeout(boot, 800);
    })();

    // ─── the dialog ────────────────────────────────────────────────────────────
    var D = { ov: null, view: 'list', filt: {}, running: null, stopping: false, status: '' };
    PC.open = function () {
        if (D.ov) { D.render(); return; }
        if (!PC.last || PC.last.pod !== pod()) {           // another pod or a fresh window: the last run comes from DuckDB
            PC.loadLast().then(function (r) { if (r && !D.ov) PC.open(); else if (!r) note('No check yet for ' + pod() + ' — click "Identify lines to Cancel" first.', 'info'); });
            return;
        }
        var ov = document.createElement('div'); ov.className = 'pc-ov'; ov.id = 'pc-dialog';
        ov.innerHTML = '<div class="pc-dlg" role="dialog" aria-label="Lines to cancel"></div>';
        ov.addEventListener('click', function (e) { if (e.target === ov && !D.running) PC.close(); });
        document.body.appendChild(ov);
        D.ov = ov; D.view = 'list';
        D.render(); paintFloat();
        document.addEventListener('keydown', escClose);
    };
    PC.close = function () { if (!D.ov) return; if (D.running) { note('Wait for the cancellation to finish (or press Stop).', 'warning'); return; } D.ov.remove(); D.ov = null; document.removeEventListener('keydown', escClose); paintFloat(); };
    function escClose(e) { if (e.key === 'Escape') PC.close(); }

    var COLDEFS = [
        { k: 'tick', t: '', w: 34, f: function (c, i) { return c.result ? '' : '<input type="checkbox" data-i="' + i + '"' + (c.tick ? ' checked' : '') + ' aria-label="cancel this line">'; } },
        { k: 'order', t: 'Order', f: function (c) { return '<span class="ord"><b>' + esc(c.order) + '</b><small>' + esc(c.account || '') + '</small></span>'; }, text: function (c) { return c.order + ' ' + (c.account || ''); } },
        { k: 'orderDate', t: 'Order date' },
        { k: 'line', t: 'Line' },
        { k: 'item', t: 'Item' },
        { k: 'desc', t: 'Description', cls: 'desc' },
        { k: 'qty', t: 'Qty', cls: 'num' },
        { k: 'status', t: 'Status' },
        { k: 'via', t: 'Via', f: function (c) { return '<span class="pc-tag ' + (c.via === 'SUB-LINE' ? 'SUB' : esc(c.via)) + '">' + esc(c.via === 'MAIN' ? 'MAIN LINE' : c.via === 'SUB-LINE' ? 'SUB-LINE of ' + c.childOf : 'BOGO of ' + c.childOf) + '</span>'; }, text: function (c) { return c.via + ' ' + (c.childOf || ''); } },
        { k: 'shipDate', t: 'Ship date' },
        { k: 'tries', t: 'Tried', f: function (c) { return c.tries ? '<span title="tried ' + c.tries + ' time(s) in the last 3 days (autopilot or a person)">' + c.tries + '×' + (c.tries >= 3 ? ' ⚠' : '') + '</span>' : ''; } },
        { k: 'result', t: 'Result', f: function (c) { return c.result ? '<span class="pc-res ' + esc(c.result) + '">' + esc(c.result) + '</span>' : ''; }, text: function (c) { return c.result || ''; } },
        { k: 'message', t: 'Message', cls: 'msg' }
    ];
    function cellText(col, c) { return col.text ? col.text(c) : String(c[col.k] == null ? '' : c[col.k]); }
    function visible(res) {
        var f = D.filt;
        return res.cands.map(function (c, i) { return { c: c, i: i }; }).filter(function (x) {
            return COLDEFS.every(function (col) { var q = (f[col.k] || '').toLowerCase(); return !q || cellText(col, x.c).toLowerCase().indexOf(q) >= 0; });
        });
    }
    D.render = function () {
        var res = PC.last, dlg = D.ov && D.ov.querySelector('.pc-dlg'); if (!dlg || !res) return;
        var hasRes = res.cands.some(function (c) { return c.result; });
        var ticked = res.cands.filter(function (c) { return c.tick && !c.result; });
        var head = '<div class="pc-head"><h3><i class="fas fa-cut"></i> Lines to cancel · pending shipments</h3>' +
            '<span class="sub">' + esc(res.pod + ' · checked ' + hhmm(res.endedAt || res.startedAt) + (res.by ? ' by ' + res.by : '') + ' · ' + res.linesRead + ' lines of ' + res.ordersRead + ' orders read from Fusion' + (res.ms ? ' in ' + secs(res.ms) : '') + (res.selectedOnly ? ' · ticked orders only' : '') + (res.status === 'STOPPED' ? ' · stopped early' : '') + (res.fromDb ? ' · from DuckDB' : '')) + '</span>' +
            '<button class="x" type="button" title="Close" onclick="PendingCancel.close()">✕</button></div>';
        var skippedN = res.skipped.length + res.noId.length || res.skippedCount || 0;
        var kpis = '<div class="pc-kpis">' + kpi(res.orders, 'orders checked') + kpi(res.linesRead, 'lines read') + kpi(res.candOrders, 'orders affected', res.candOrders ? 'bad' : 'good') + kpi(res.cands.length, 'lines to cancel', res.cands.length ? 'bad' : 'good') +
            (hasRes ? kpi(res.cands.filter(function (c) { return c.result === 'DONE'; }).length, 'cancelled', 'good') + kpi(res.cands.filter(function (c) { return c.result === 'FAILED'; }).length, 'failed', 'bad') : '') +
            kpi(skippedN, 'not cancellable', skippedN ? 'warn' : '') + kpi(res.ordersFailed, 'could not read', res.ordersFailed ? 'warn' : '') + '</div>';
        var body, foot;
        if (D.view === 'confirm') {
            var byOrder = {}; ticked.forEach(function (c) { byOrder[c.order] = (byOrder[c.order] || 0) + 1; });
            var orders = Object.keys(byOrder);
            body = '<div class="pc-callout bad"><b>' + ticked.length + ' line' + (ticked.length === 1 ? '' : 's') + ' on ' + orders.length + ' order' + (orders.length === 1 ? '' : 's') + ' will be cancelled in Oracle Fusion ' + esc(res.pod) + '</b> with the reason <b>OUT OF STOCK</b> (ordered quantity set to 0) — exactly what the Shipping Agent does. ' +
                'Every order is read again live first: a line that is no longer Scheduled / Manual Reservation is <b>not</b> sent. This cannot be undone from here.' +
                '<ul>' + orders.slice(0, 30).map(function (o) { var c = ticked.find(function (x) { return x.order === o; }); return '<li><b>' + esc(o) + '</b> ' + esc(c.account || '') + ' — ' + byOrder[o] + ' line' + (byOrder[o] === 1 ? '' : 's') + '</li>'; }).join('') + (orders.length > 30 ? '<li>… and ' + (orders.length - 30) + ' more</li>' : '') + '</ul></div>' +
                '<label class="pc-check"><input type="checkbox" id="pc-sure"> I have reviewed the list and want these lines cancelled in Fusion.</label>';
            foot = '<div class="pc-foot"><span class="grow">Results go to the shared cancellation ledger (WMS_W2_CANCEL_LOG) and the audit trail.</span>' +
                '<button class="pc-btn" type="button" data-act="back"><i class="fas fa-arrow-left"></i> Back</button>' +
                '<button class="pc-btn danger" type="button" data-act="go" disabled><i class="fas fa-cut"></i> Yes, cancel ' + ticked.length + ' line' + (ticked.length === 1 ? '' : 's') + '</button></div>';
        } else {
            var vis = visible(res), ordersVis = Object.keys(vis.reduce(function (m, x) { m[x.c.order] = 1; return m; }, {})).length;
            var status = D.running ? '<div class="pc-status"><i class="fas fa-spinner fa-spin"></i> ' + esc(D.status) + '</div>' : (D.status ? '<div class="pc-callout ' + (D.statusCls || '') + '">' + esc(D.status) + '</div>' : '');
            var callout = res.errors.length && res.errors[0].order === '*' ? '<div class="pc-callout bad">The check stopped: ' + esc(res.errors[0].message) + '</div>' : '';
            var grid = res.cands.length ? '<div class="pc-scroll"><table class="pc-grid" id="pc-grid"><thead><tr>' + COLDEFS.filter(function (c) { return hasRes || (c.k !== 'result' && c.k !== 'message'); }).map(function (col) {
                return '<th' + (col.w ? ' style="width:' + col.w + 'px"' : '') + '>' + (col.k === 'tick' ? '<input type="checkbox" id="pc-all" title="tick / untick every line shown"' + (vis.length && vis.every(function (x) { return x.c.tick || x.c.result; }) ? ' checked' : '') + '>' : esc(col.t)) + '</th>';
            }).join('') + '</tr><tr class="pc-filters">' + COLDEFS.filter(function (c) { return hasRes || (c.k !== 'result' && c.k !== 'message'); }).map(function (col) {
                return '<th>' + (col.k === 'tick' ? '' : '<input type="text" data-f="' + col.k + '" value="' + esc(D.filt[col.k] || '') + '" placeholder="filter">') + '</th>';
            }).join('') + '</tr></thead><tbody>' + (vis.length ? vis.map(function (x, n) {
                var c = x.c, first = n === 0 || vis[n - 1].c.order !== c.order;
                return '<tr class="' + (c.tick || c.result ? '' : 'off') + (first ? ' pc-first' : '') + '">' + COLDEFS.filter(function (cd) { return hasRes || (cd.k !== 'result' && cd.k !== 'message'); }).map(function (col) {
                    return '<td' + (col.cls ? ' class="' + col.cls + '"' : '') + '>' + (col.f ? col.f(c, x.i) : esc(cellText(col, c))) + '</td>';
                }).join('') + '</tr>';
            }).join('') : '<tr><td colspan="' + COLDEFS.length + '" class="pc-empty">Nothing matches the filters</td></tr>') + '</tbody></table></div>' +
                '<div class="pc-status" style="margin-top:6px"><span>' + vis.length + ' of ' + res.cands.length + ' line' + (res.cands.length === 1 ? '' : 's') + ' shown · ' + ordersVis + ' order' + (ordersVis === 1 ? '' : 's') + ' · <b>' + ticked.length + ' ticked</b></span></div>'
                : '<div class="pc-empty"><i class="fas fa-check-circle" style="color:#16a34a;font-size:1.6rem"></i><br>No Scheduled / Manual Reservation lines on the ' + res.ordersRead + ' pending order' + (res.ordersRead === 1 ? '' : 's') + ' read — nothing to cancel.</div>';
            var folds = '';
            if (res.skipped.length || res.noId.length) {
                var sk = res.skipped.concat(res.noId);
                folds += '<details class="pc-fold"><summary>Not cancellable · ' + sk.length + ' line' + (sk.length === 1 ? '' : 's') + ' (children already cancelled / shipped / interfaced, lines without a fulfillment line id)</summary><div class="pc-scroll"><table class="pc-grid"><thead><tr><th>Order</th><th>Line</th><th>Item</th><th>Status</th><th>Via</th><th>Why</th></tr></thead><tbody>' +
                    sk.map(function (s) { return '<tr><td>' + esc(s.order) + ' <small style="color:#64748b">' + esc(s.account || '') + '</small></td><td>' + esc(s.line) + '</td><td>' + esc(s.item) + '</td><td>' + esc(s.status) + '</td><td>' + esc(s.via + (s.childOf ? ' of ' + s.childOf : '')) + '</td><td class="msg">' + esc(s.reason) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
            } else if (res.skippedCount) folds += '<div class="pc-status">' + res.skippedCount + ' child line(s) were not cancellable when this check ran (details are kept for the session of the check only).</div>';
            var errs = res.errors.filter(function (e) { return e.order !== '*'; });
            if (errs.length) folds += '<details class="pc-fold"><summary>Could not read · ' + errs.length + ' order' + (errs.length === 1 ? '' : 's') + ' — their lines were not checked</summary><div class="pc-scroll"><table class="pc-grid"><thead><tr><th>Order</th><th>Customer</th><th>Fusion said</th></tr></thead><tbody>' +
                errs.map(function (e) { return '<tr><td>' + esc(e.order) + '</td><td>' + esc(e.account || '') + '</td><td class="msg">' + esc(e.message) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
            body = callout + status + grid + folds;
            foot = '<div class="pc-foot"><span class="grow">' + (res.cands.length ? 'Untick what should stay. The ticked lines are read live again before anything is sent.' : '') + '</span>' +
                (res.cands.length ? '<button class="pc-btn" type="button" data-act="copy" title="Copy the order numbers of the ticked lines"><i class="fas fa-copy"></i> Copy orders</button><button class="pc-btn" type="button" data-act="csv"><i class="fas fa-file-csv"></i> CSV</button>' : '') +
                '<button class="pc-btn" type="button" data-act="again"' + (PC.state.running || D.running ? ' disabled' : '') + '><i class="fas fa-redo"></i> Check again</button>' +
                '<button class="pc-btn" type="button" data-act="close"' + (D.running ? ' disabled' : '') + '>Close</button>' +
                (D.running ? '<button class="pc-btn danger" type="button" data-act="stop"' + (D.stopping ? ' disabled' : '') + '><i class="fas fa-stop"></i> ' + (D.stopping ? 'Stopping…' : 'Stop after this order') + '</button>'
                    : (res.cands.length ? '<button class="pc-btn danger" type="button" data-act="confirm"' + (ticked.length ? '' : ' disabled') + '><i class="fas fa-cut"></i> Cancel ' + ticked.length + ' ticked line' + (ticked.length === 1 ? '' : 's') + ' in Fusion</button>' : '')) + '</div>';
        }
        dlg.innerHTML = head + kpis + '<div class="pc-body">' + body + '</div>' + foot;
        wire(dlg, res, ticked);
    };
    function kpi(v, label, cls) { return '<div class="pc-kpi ' + (cls || '') + '"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>'; }
    function wire(dlg, res, ticked) {
        dlg.querySelectorAll('input[type=checkbox][data-i]').forEach(function (cb) { cb.onchange = function () { res.cands[+cb.getAttribute('data-i')].tick = cb.checked; D.render(); }; });
        var all = dlg.querySelector('#pc-all'); if (all) all.onchange = function () { visible(res).forEach(function (x) { if (!x.c.result) x.c.tick = all.checked; }); D.render(); };
        dlg.querySelectorAll('input[data-f]').forEach(function (inp) {
            inp.oninput = function () { D.filt[inp.getAttribute('data-f')] = inp.value; var at = inp.selectionStart; D.render(); var again = dlg.querySelector('input[data-f="' + inp.getAttribute('data-f') + '"]'); if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (e) { /* ok */ } } };
        });
        var sure = dlg.querySelector('#pc-sure'), go = dlg.querySelector('[data-act="go"]'); if (sure && go) sure.onchange = function () { go.disabled = !sure.checked; };
        dlg.querySelectorAll('[data-act]').forEach(function (b) {
            b.onclick = function () {
                var act = b.getAttribute('data-act');
                if (act === 'close') PC.close();
                else if (act === 'again') { PC.close(); PC.start(); }
                else if (act === 'confirm') { D.view = 'confirm'; D.render(); }
                else if (act === 'back') { D.view = 'list'; D.render(); }
                else if (act === 'go') { D.view = 'list'; cancelTicked(res); }
                else if (act === 'stop') { D.stopping = true; D.status = 'stopping after the order in hand…'; D.render(); }
                else if (act === 'copy') { var os = Object.keys(ticked.reduce(function (m, c) { m[c.order] = 1; return m; }, {})); copyText(os.join('\n')); note(os.length + ' order number(s) copied.', 'success'); }
                else if (act === 'csv') downloadCsv('pending-lines-to-cancel-' + res.pod + '-' + String(res.endedAt || '').replace(/[:T]/g, '-') + '.csv', COLDEFS.filter(function (c) { return c.k !== 'tick'; }), res.cands);
            };
        });
    }
    function copyText(t) { try { if (navigator.clipboard) { navigator.clipboard.writeText(t); return; } } catch (e) { /* fall through */ } var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { /* ok */ } ta.remove(); }
    function downloadCsv(name, cols, rows) {
        var q = function (v) { v = String(v == null ? '' : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var text = [cols.map(function (c) { return q(c.t); }).join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return q(c.k === 'order' ? r.order : c.k === 'via' ? r.via + (r.childOf ? ' of ' + r.childOf : '') : r[c.k]); }).join(','); })).join('\r\n');
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }

    // ─── the cancellation (from the dialog) ────────────────────────────────────
    function cancelTicked(res) {
        if (D.running) return D.running;
        var p = res.pod, want = res.cands.filter(function (c) { return c.tick && !c.result; });
        if (!want.length) return Promise.resolve();
        var orders = Object.keys(want.reduce(function (m, c) { m[c.order] = 1; return m; }, {}));
        var runId = res.runId, t0 = Date.now(), ledger = [], sum = { done: 0, failed: 0, nothing: 0, orders: 0 };
        D.stopping = false; D.statusCls = '';
        var say = function (t) { D.status = t; D.render(); };
        say('checking the AI kill switch…');
        D.running = host({ action: 'aiControlStatus' }, 15000).catch(function () { return null; }).then(function (ctl) {
            if (ctl && ctl.enabled === false) throw new Error('The AI is paused in AI Digital Employee › Control' + (ctl.reason ? ' (' + ctl.reason + ')' : '') + ' — nothing is cancelled until it is resumed.');
            return bogo(p);
        }).then(function (bg) {
            var n = 0;
            return pool(orders, CANCEL_POOL, function (o) {
                say('cancelling · order ' + (++n) + ' of ' + orders.length + ' (' + o + ') — reading it live…');
                return doOrder(p, o, want.filter(function (c) { return c.order === o; }), bg, runId, ledger, sum).then(function () { D.render(); });
            }, function () { return D.stopping; });
        }).then(function () { return finish(null); }, function (e) { return finish(e); });

        function finish(err) {
            var ms = Date.now() - t0;
            res.cancelled = res.cands.filter(function (c) { return c.result === 'DONE'; }).length;
            res.cancelFailed = res.cands.filter(function (c) { return c.result === 'FAILED'; }).length;
            var text = (err ? 'stopped: ' + (err.message || err) + ' · ' : D.stopping ? 'stopped early · ' : '') + sum.done + ' line' + (sum.done === 1 ? '' : 's') + ' cancelled, ' + sum.failed + ' failed' + (sum.nothing ? ', ' + sum.nothing + ' not sent (changed since the check)' : '') + ' on ' + sum.orders + ' order' + (sum.orders === 1 ? '' : 's') + ' · ' + secs(ms);
            var p1 = ledger.length ? pushLog(ledger).catch(function (e) { text += ' · APEX ledger: ' + (e && e.message || e); }) : Promise.resolve();
            return p1.then(function () {
                return pushLog([{ run_id: runId, pod: p, pc_name: pc(), app_user: user(), trip_date: '', trip_id: 'PENDING', order_number: '*', line_number: '', item: '', status_before: '', fulfill_line_id: '', via: '', result: 'RUN', message: 'Pending shipments popup: ' + text, response: '' }]).catch(function () {});
            }).then(function () {
                DB.put('w2_pend_cands', { pod: p, run_id: runId }, candRows(res));
                DB.put('w2_pend_runs', { pod: p, run_id: runId }, [runRow(Object.assign({}, res, { status: res.status === 'RUNNING' ? 'DONE' : res.status }))]);
                D.running = null; D.stopping = false; D.status = text; D.statusCls = err || sum.failed ? 'bad' : 'good';
                D.render(); paintChip();
                note('Pending shipments: ' + text, err || sum.failed ? 'warning' : 'success');
                notify((sum.failed || err ? '⚠ ' : '✓ ') + text + ' — click for the details', 'order_update');
                audit({ actionKey: 'pending_cancel_run', outcome: err ? 'STOPPED' : sum.failed ? 'PARTIAL' : 'OK', instance: p, refId: 'RUN:' + runId, target: orders.join(',').slice(0, 900), detail: text });
                if (sum.done && typeof window.fetchPendingShipmentLines === 'function') { try { window.fetchPendingShipmentLines(); } catch (e) { /* the grid refresh is a convenience */ } }
            });
        }
        return D.running;
    }
    /** One order: live read → the rule again → only the ticked lines still eligible are sent → re-read → DONE / FAILED. */
    function doOrder(p, order, want, bg, runId, ledger, sum) {
        sum.orders++;
        var log = function (c, result, message, response) {
            c.result = result; c.message = String(message || '').slice(0, 900); c.response = response ? String(typeof response === 'string' ? response : JSON.stringify(response)).slice(0, 1800) : ''; c.decidedAt = now(); c.by = user();
            if (result !== 'NOTHING') ledger.push({ run_id: runId, pod: p, pc_name: pc(), app_user: user(), trip_date: '', trip_id: 'PENDING', order_number: order, line_number: c.line, item: c.item, status_before: c.status, fulfill_line_id: c.fid, via: c.via, result: result, message: c.message, response: c.response });
        };
        return readLines(p, order).then(function (live) {
            var set = R.expand(live, bg), ok = {}, st = {};
            set.lines.forEach(function (x) { ok[String(R.fid(x.line))] = x; });
            live.forEach(function (l) { st[String(R.fid(l))] = R.lineStatus(l); });
            var send = [];
            want.forEach(function (c) {
                if (ok[c.fid]) { c.status = R.lineStatus(ok[c.fid].line); send.push(c); return; }
                log(c, 'NOTHING', 'live re-check: ' + (st[c.fid] == null ? 'the line is no longer listed' : 'the line now reads "' + st[c.fid] + '" — not cancellable any more') + ' — not sent'); sum.nothing++;
            });
            if (!send.length) return;
            return fusionPatch(p, order, R.body(send.map(function (c) { return { line: { FULFILL_LINE_ID: c.fid } }; }))).then(function (r) { return { res: r, err: R.patchError(r) }; }, function (e) { return { res: null, err: String(e && e.message || e) }; }).then(function (out) {
                if (out.err) { send.forEach(function (c) { log(c, 'FAILED', 'Fusion: ' + out.err, out.res); sum.failed++; }); return; }
                return sleep(2500).then(function () { return readLines(p, order); }).then(function (after) {
                    var nowSt = {}; after.forEach(function (l) { nowSt[String(R.fid(l))] = R.lineStatus(l); });
                    send.forEach(function (c) {
                        var s2 = nowSt[c.fid];
                        if (s2 != null && !/CANCEL/i.test(s2)) { log(c, 'FAILED', 'still "' + s2 + '" after the cancel', out.res); sum.failed++; }
                        else { log(c, 'DONE', 'cancelled (' + c.via + (c.childOf ? ' of line ' + c.childOf : '') + ') — OUT OF STOCK' + (s2 == null ? ' · line no longer listed' : ''), out.res); sum.done++; }
                    });
                }, function (e) { send.forEach(function (c) { log(c, 'FAILED', 'sent, but the order could not be read again: ' + (e && e.message || e), out.res); sum.failed++; }); });
            });
        }, function (e) {
            want.forEach(function (c) { log(c, 'FAILED', 'the order could not be read live: ' + (e && e.message || e)); sum.failed++; });
        }).then(function () {
            var mine = want, okN = mine.filter(function (c) { return c.result === 'DONE'; }).length, bad = mine.filter(function (c) { return c.result === 'FAILED'; }).length;
            return audit({ actionKey: 'cancel_lines', outcome: bad ? (okN ? 'PARTIAL' : 'FAILED') : okN ? 'OK' : 'NOTHING', instance: p, refId: 'PENDING RUN:' + runId, target: order, detail: okN + ' line(s) cancelled, ' + bad + ' failed, ' + (mine.length - okN - bad) + ' not sent (Scheduled / Manual Reservation, OUT OF STOCK) — pending shipments popup, confirmed by ' + user() });
        });
    }
})();
