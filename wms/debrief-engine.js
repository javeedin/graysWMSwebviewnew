/* Day debrief — turns what the WMS read about one trip date into one model + a plain-words narrative (wms/debrief.js shows it
   and writes the PDF; this file only computes). Pure: no DOM, no host; global WMSDBF in the browser, module.exports in node
   (wms/tests/debrief-engine.test.js).
   Input (every list optional):
     pod, date (ISO), rows = the MRA Interface's order rows of the date (sales orders only: TRIP_ID, LORRY, ORDER_NUMBER,
     CUSTOMER_NAME, ORDER_TYPE, LINE_STATUS, PICKER, RELEASED, PICKED, SHIPPED, PRINTED, AMOUNT, MRA_INTERFACE_STATUS, MRA_WHY, RAW),
     trips = [{trip_id, lorry, bay, priority, lines: [WMS order lines]}], hidden = {store, cancelled} (rows left out),
     findings = WMSAL.run items (CANCEL / PICKER / MRA / ERROR), mraRuns (MRA tries made ON that day: U, SRC, S, N, GW),
     cancelLog (WMS_W2_CANCEL_LOG rows: T, APP_USER, TRIP_ID, ORDER_NUMBER, LINE_NUMBER, ITEM, VIA, RESULT, MESSAGE),
     activity (WMS_ACTIVITY_LOG per user × event × page: USER_NAME, EVENT_TYPE, PAGE, N, FIRST_T, LAST_T),
     actions (USER_NAME, TARGET, N), hourly (SRC, H, N), audit (APP_USER, SOURCE, ACTION_KEY, OUTCOME, N),
     prints (PRINT_STATUS, OVERALL_STATUS, N), shipDates (APP_USER, STATUS, N), pins (PINNED_BY, TRIP_ID), errors [text].
   Output: {kpis, score, trips, pickers, orderTypes, lineStatuses, mra, cancels, issues, users, timeline, customers, narrative}. */
(function (root) {
    'use strict';
    var E = {};
    var S = function (v) { return String(v == null ? '' : v).trim(); };
    var up = function (v) { return S(v).toUpperCase(); };
    var N = function (v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; };
    var FINAL = { SUCCESS: 1, ALREADY_DONE: 1 };
    function pct(a, b) { return b ? Math.round(a * 100 / b) : 0; }
    function plural(n, w, ws) { return n + ' ' + (n === 1 ? w : (ws || w + 's')); }
    function pick(row, names) { if (!row) return ''; var keys = Object.keys(row); for (var i = 0; i < names.length; i++) { var k = keys.find(function (x) { return x.toLowerCase() === names[i].toLowerCase(); }); if (k && row[k] != null && row[k] !== '') return row[k]; } return ''; }
    function orderOfLine(l) { return S(pick(l, ['SOURCE_ORDER_NUMBER', 'ORDER_NUMBER'])); }
    function lineStatus(l) { return S(pick(l, ['LINE_STATUS', 'STATUS'])); }
    function dayWord(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return iso || '';
        var d = new Date(+m[1], +m[2] - 1, +m[3]);
        return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()] + ' ' + (+m[3]) + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+m[2] - 1] + ' ' + m[1];
    }
    E.dayWord = dayWord;
    function top(map, n, keyName, valName) { return Object.keys(map).map(function (k) { return { k: k, v: map[k] }; }).sort(function (a, b) { return b.v - a.v || (a.k < b.k ? -1 : 1); }).slice(0, n).map(function (x) { var o = {}; o[keyName || 'name'] = x.k; o[valName || 'n'] = x.v; return o; }); }
    function list(names, max) { names = names.filter(Boolean); if (!names.length) return ''; var l = names.slice(0, max || 4); return l.join(', ') + (names.length > l.length ? ' and ' + (names.length - l.length) + ' more' : ''); }

    E.model = function (input) {
        input = input || {};
        var rows = input.rows || [], trips = input.trips || [], hidden = input.hidden || { store: 0, cancelled: 0 }, findings = input.findings || [];
        var byTrip = {}, tripList = [];
        trips.forEach(function (t) { var id = S(t.trip_id); byTrip[id] = { trip_id: id, lorry: S(t.lorry), bay: S(t.bay), priority: S(t.priority), orders: 0, released: 0, picked: 0, shipped: 0, printed: 0, mraDone: 0, mraFailed: 0, mraNone: 0, pickers: {}, noPicker: 0, lines: 0, cancelledLines: 0, pendingCancel: 0, errors: 0, amount: 0, customers: {} }; tripList.push(byTrip[id]); });
        var tripOf = function (id) { id = S(id); if (!byTrip[id]) { byTrip[id] = { trip_id: id, lorry: '', bay: '', priority: '', orders: 0, released: 0, picked: 0, shipped: 0, printed: 0, mraDone: 0, mraFailed: 0, mraNone: 0, pickers: {}, noPicker: 0, lines: 0, cancelledLines: 0, pendingCancel: 0, errors: 0, amount: 0, customers: {} }; tripList.push(byTrip[id]); } return byTrip[id]; };
        // ── orders ──
        var k = { orders: rows.length, released: 0, picked: 0, shipped: 0, printed: 0, mraDone: 0, mraFailed: 0, mraSkipped: 0, mraNone: 0, noPicker: 0, amount: 0 };
        var pickers = {}, types = {}, customers = {}, mraWhy = {}, mraFailedRows = [];
        rows.forEach(function (r) {
            var t = tripOf(r.TRIP_ID); if (!t.lorry && r.LORRY) { t.lorry = S(r.LORRY); t.bay = S(r.BAY); t.priority = S(r.PRIORITY); }
            t.orders++; t.amount += N(r.AMOUNT); k.amount += N(r.AMOUNT);
            var st = up(r.MRA_INTERFACE_STATUS), p = S(r.PICKER), cust = S(r.CUSTOMER_NAME) || '(no name)', type = S(r.ORDER_TYPE) || '(none)';
            if (r.RELEASED) { k.released++; t.released++; } if (r.PICKED) { k.picked++; t.picked++; } if (r.SHIPPED) { k.shipped++; t.shipped++; } if (r.PRINTED) { k.printed++; t.printed++; }
            if (FINAL[st]) { k.mraDone++; t.mraDone++; } else if (st === 'FAILED') { k.mraFailed++; t.mraFailed++; var why = S(r.MRA_WHY) || 'no reason given'; mraWhy[why] = (mraWhy[why] || 0) + 1; mraFailedRows.push({ trip_id: t.trip_id, order_number: S(r.ORDER_NUMBER), customer: cust, why: why, tries: N(r.TRIES) }); } else if (st === 'SKIPPED') { k.mraSkipped++; t.mraNone++; } else { k.mraNone++; t.mraNone++; }
            if (p) { var pk = pickers[p] = pickers[p] || { name: p, orders: 0, picked: 0, shipped: 0, trips: {}, lines: 0, firstAssigned: '' }; pk.orders++; if (r.PICKED) pk.picked++; if (r.SHIPPED) pk.shipped++; pk.trips[t.trip_id] = 1; t.pickers[p] = (t.pickers[p] || 0) + 1; var at = S(pick(r.RAW || {}, ['PICKER_ASSIGNED_ON', 'picker_assigned_on'])); if (at && (!pk.firstAssigned || at < pk.firstAssigned)) pk.firstAssigned = at; }
            else if (!r.SHIPPED) { k.noPicker++; t.noPicker++; }
            types[type] = (types[type] || 0) + 1; customers[cust] = (customers[cust] || 0) + 1; t.customers[cust] = 1;
        });
        // ── lines ──
        var lineStatuses = {}, linesTotal = 0, linesCancelled = 0, ordersWithCancelled = {}, linesPerOrder = {};
        trips.forEach(function (t) {
            var tt = tripOf(t.trip_id);
            (t.lines || []).forEach(function (l) {
                var st = lineStatus(l) || '(blank)', o = orderOfLine(l);
                linesTotal++; tt.lines++; lineStatuses[st] = (lineStatuses[st] || 0) + 1; linesPerOrder[o] = (linesPerOrder[o] || 0) + 1;
                if (/CANCEL/i.test(st)) { linesCancelled++; tt.cancelledLines++; if (o) ordersWithCancelled[o] = 1; }
            });
        });
        rows.forEach(function (r) { var p = S(r.PICKER); if (p && pickers[p]) pickers[p].lines += linesPerOrder[S(r.ORDER_NUMBER)] || 0; });
        // ── findings ──
        var f = { CANCEL: [], PICKER: [], MRA: [], ERROR: [] };
        findings.forEach(function (it) { if (f[it.kind]) f[it.kind].push(it); var t = byTrip[S(it.trip_id)]; if (t) { if (it.kind === 'CANCEL') t.pendingCancel++; if (it.kind === 'ERROR') t.errors++; } });
        // ── MRA tries on the day ──
        var mraRuns = input.mraRuns || [], mraByUser = {}, mraBySource = {}, mraTries = 0, mraOk = 0, mraFail = 0, mraGw = 0;
        mraRuns.forEach(function (r) {
            var u = S(r.U || r.APP_USER) || '?', src = S(r.SRC || r.SOURCE) || '?', s = up(r.S || r.MRA_INTERFACE_STATUS), n = N(r.N), gw = N(r.GW);
            mraTries += n; if (FINAL[s]) mraOk += n; else if (s === 'FAILED') mraFail += n; mraGw += gw;
            var mu = mraByUser[u] = mraByUser[u] || { name: u, tries: 0, ok: 0, failed: 0, gw: 0, sources: {} }; mu.tries += n; if (FINAL[s]) mu.ok += n; else if (s === 'FAILED') mu.failed += n; mu.gw += gw; mu.sources[src] = (mu.sources[src] || 0) + n;
            mraBySource[src] = (mraBySource[src] || 0) + n;
        });
        // ── cancel ledger ──
        var log = input.cancelLog || [], cl = { lines: 0, done: 0, failed: 0, runs: 0, byUser: {}, orders: {}, rows: [] };
        log.forEach(function (r) {
            var res = up(r.RESULT), u = S(r.APP_USER) || '?';
            if (res === 'RUN') { cl.runs++; return; }
            if (res === 'WOULD' || res === 'SKIPPED' || res === 'NOTHING') return;
            cl.lines++; if (res === 'DONE') cl.done++; else if (res === 'FAILED') cl.failed++;
            cl.orders[S(r.ORDER_NUMBER)] = 1;
            var cu = cl.byUser[u] = cl.byUser[u] || { name: u, done: 0, failed: 0 }; if (res === 'DONE') cu.done++; else if (res === 'FAILED') cu.failed++;
            cl.rows.push({ t: S(r.T), user: u, trip_id: S(r.TRIP_ID), order_number: S(r.ORDER_NUMBER), line_number: S(r.LINE_NUMBER), item: S(r.ITEM), via: S(r.VIA), result: res, message: S(r.MESSAGE) });
        });
        // ── people ──
        var users = {}, uKey = function (n) { return up(n) || '?'; };
        var user = function (n) { var key = uKey(n); if (!users[key]) users[key] = { name: S(n) || '?', events: 0, pages: {}, first: '', last: '', actions: {}, mra: { tries: 0, ok: 0, failed: 0 }, cancels: { done: 0, failed: 0 }, audit: {}, ships: 0, pins: 0 }; return users[key]; };
        (input.activity || []).forEach(function (a) {
            var u = user(a.USER_NAME || a.user_name); var n = N(a.N || a.n); u.events += n; var pg = S(a.PAGE || a.page); if (pg) u.pages[pg] = (u.pages[pg] || 0) + n;
            var ft = S(a.FIRST_T || a.first_t), lt = S(a.LAST_T || a.last_t); if (ft && (!u.first || ft < u.first)) u.first = ft; if (lt && (!u.last || lt > u.last)) u.last = lt;
        });
        (input.actions || []).forEach(function (a) { var u = user(a.USER_NAME || a.user_name); var tg = S(a.TARGET || a.target); if (tg) u.actions[tg] = (u.actions[tg] || 0) + N(a.N || a.n); });
        Object.keys(mraByUser).forEach(function (n) { var u = user(n), m = mraByUser[n]; u.mra.tries += m.tries; u.mra.ok += m.ok; u.mra.failed += m.failed; });
        Object.keys(cl.byUser).forEach(function (n) { var u = user(n), c = cl.byUser[n]; u.cancels.done += c.done; u.cancels.failed += c.failed; });
        (input.audit || []).forEach(function (a) { var u = user(a.APP_USER || a.app_user); var key = S(a.ACTION_KEY || a.action_key) || S(a.SOURCE || a.source) || '?'; u.audit[key] = (u.audit[key] || 0) + N(a.N || a.n); });
        (input.shipDates || []).forEach(function (a) { user(a.APP_USER || a.app_user).ships += N(a.N || a.n); });
        (input.pins || []).forEach(function (p) { if (byTrip[S(p.TRIP_ID || p.trip_id)]) user(p.PINNED_BY || p.pinned_by).pins++; });
        var userList = Object.keys(users).map(function (key) {
            var u = users[key], parts = [];
            if (u.events) parts.push(plural(u.events, 'action') + (Object.keys(u.pages).length ? ' on ' + list(top(u.pages, 3).map(function (x) { return x.name; }), 3) : '') + (u.first ? ' (' + u.first + (u.last && u.last !== u.first ? '–' + u.last : '') + ')' : ''));
            if (u.mra.tries) parts.push(plural(u.mra.tries, 'MRA try', 'MRA tries') + ' (' + u.mra.ok + ' ok' + (u.mra.failed ? ', ' + u.mra.failed + ' failed' : '') + ')');
            if (u.cancels.done || u.cancels.failed) parts.push(plural(u.cancels.done, 'line') + ' cancelled' + (u.cancels.failed ? ', ' + u.cancels.failed + ' failed' : ''));
            var ak = Object.keys(u.audit); if (ak.length) parts.push(ak.map(function (a) { return a + ' ×' + u.audit[a]; }).join(', '));
            if (u.ships) parts.push(plural(u.ships, 'actual ship date'));
            if (u.pins) parts.push(plural(u.pins, 'trip') + ' pinned');
            var score = u.events + u.mra.tries * 3 + (u.cancels.done + u.cancels.failed) * 3 + ak.reduce(function (s, a) { return s + u.audit[a] * 2; }, 0) + u.ships * 2 + u.pins;
            return { name: u.name, events: u.events, first: u.first, last: u.last, pages: top(u.pages, 5), actions: top(u.actions, 5, 'target'), mra: u.mra, cancels: u.cancels, audit: u.audit, ships: u.ships, pins: u.pins, did: parts.join(' · ') || 'nothing recorded', score: score };
        }).sort(function (a, b) { return b.score - a.score || (a.name < b.name ? -1 : 1); });
        // ── timeline ──
        var hours = []; for (var h = 0; h < 24; h++) hours.push({ h: (h < 10 ? '0' : '') + h, activity: 0, mra: 0, cancel: 0 });
        (input.hourly || []).forEach(function (r) { var hh = parseInt(r.H || r.h, 10); if (isNaN(hh) || hh < 0 || hh > 23) return; var src = S(r.SRC || r.src).toLowerCase(); if (hours[hh][src] != null) hours[hh][src] += N(r.N || r.n); });
        var busy = hours.filter(function (x) { return x.activity + x.mra + x.cancel > 0; }), peak = null;
        hours.forEach(function (x) { var tot = x.activity + x.mra + x.cancel; if (tot && (!peak || tot > peak.total)) peak = { h: x.h, total: tot }; });
        // ── prints ──
        var prints = { total: 0, printed: 0, failed: 0, pending: 0 };
        (input.prints || []).forEach(function (p) { var n = N(p.N || p.n), s = up(p.PRINT_STATUS || p.print_status), o = up(p.OVERALL_STATUS || p.overall_status); prints.total += n; if (s === 'PRINTED' || o === 'COMPLETED') prints.printed += n; else if (s === 'FAILED' || o === 'FAILED') prints.failed += n; else prints.pending += n; });
        // ── issues ──
        var issues = [];
        if (f.ERROR.length) issues.push({ kind: 'Order errors', n: f.ERROR.length, text: plural(f.ERROR.length, 'main line') + ' cancelled while the BOGO free item / sub-line is not — ' + list(f.ERROR.map(function (i) { return i.order_number; }), 5) });
        if (k.mraFailed) issues.push({ kind: 'MRA failed', n: k.mraFailed, text: plural(k.mraFailed, 'order') + ' failed at MRA — ' + top(mraWhy, 3).map(function (x) { return x.name + ' (' + x.n + ')'; }).join(', ') });
        if (f.CANCEL.length) issues.push({ kind: 'Pending cancellations', n: f.CANCEL.length, text: plural(f.CANCEL.length, 'line') + ' on ' + plural(Object.keys(f.CANCEL.reduce(function (m, i) { m[i.order_number] = 1; return m; }, {})).length, 'order') + ' still waiting to be cancelled' });
        if (k.noPicker) issues.push({ kind: 'No picker', n: k.noPicker, text: plural(k.noPicker, 'order') + ' without a picker' + (k.noPicker ? ' on trip' + (tripList.filter(function (t) { return t.noPicker; }).length === 1 ? ' ' : 's ') + list(tripList.filter(function (t) { return t.noPicker; }).map(function (t) { return t.trip_id; }), 4) : '') });
        if (cl.failed) issues.push({ kind: 'Cancellations failed', n: cl.failed, text: plural(cl.failed, 'line') + ' could not be cancelled in Fusion' });
        if (prints.failed) issues.push({ kind: 'Print failed', n: prints.failed, text: plural(prints.failed, 'print job') + ' failed' });
        if (mraGw) issues.push({ kind: 'MRA gateway', n: mraGw, text: plural(mraGw, 'gateway problem') + ' (timeouts / unreachable) during the MRA tries of the day' });
        (input.errors || []).forEach(function (e) { issues.push({ kind: 'Read error', n: 1, text: S(e) }); });
        // ── score ──
        var parts = k.orders ? [pct(k.released, k.orders), pct(k.picked, k.orders), pct(k.shipped, k.orders), pct(k.printed, k.orders), pct(k.mraDone, k.orders)] : [];
        var score = parts.length ? Math.round(parts.reduce(function (a, b) { return a + b; }, 0) / parts.length) : null;
        var m = {
            pod: S(input.pod), date: S(input.date), dayWord: dayWord(input.date), builtAt: S(input.builtAt),
            kpis: { trips: tripList.length, orders: k.orders, store: N(hidden.store), cancelledOrders: N(hidden.cancelled), released: k.released, picked: k.picked, shipped: k.shipped, printed: k.printed, mraDone: k.mraDone, mraFailed: k.mraFailed, mraSkipped: k.mraSkipped, mraNone: k.mraNone, pickers: Object.keys(pickers).length, noPicker: k.noPicker, lines: linesTotal, cancelledLines: linesCancelled, ordersWithCancelled: Object.keys(ordersWithCancelled).length, pendingCancel: f.CANCEL.length, orderErrors: f.ERROR.length, amount: Math.round(k.amount * 100) / 100, users: userList.length, issues: issues.reduce(function (s, i) { return s + i.n; }, 0) },
            score: score,
            trips: tripList.map(function (t) { return { trip_id: t.trip_id, lorry: t.lorry, bay: t.bay, priority: t.priority, orders: t.orders, customers: Object.keys(t.customers).length, released: t.released, picked: t.picked, shipped: t.shipped, printed: t.printed, mraDone: t.mraDone, mraFailed: t.mraFailed, mraNone: t.mraNone, pickers: Object.keys(t.pickers).sort().join(', '), noPicker: t.noPicker, lines: t.lines, cancelledLines: t.cancelledLines, pendingCancel: t.pendingCancel, errors: t.errors, amount: Math.round(t.amount * 100) / 100, readiness: t.orders ? Math.round((pct(t.released, t.orders) + pct(t.picked, t.orders) + pct(t.shipped, t.orders) + pct(t.printed, t.orders) + pct(t.mraDone, t.orders)) / 5) : 0 }; }).sort(function (a, b) { return N(a.trip_id) - N(b.trip_id); }),
            pickers: Object.keys(pickers).map(function (n) { var p = pickers[n]; return { name: n, orders: p.orders, picked: p.picked, shipped: p.shipped, trips: Object.keys(p.trips).length, tripList: Object.keys(p.trips).sort().join(', '), lines: p.lines, firstAssigned: p.firstAssigned, pickedPct: pct(p.picked, p.orders) }; }).sort(function (a, b) { return b.orders - a.orders || (a.name < b.name ? -1 : 1); }),
            orderTypes: top(types, 12), customers: top(customers, 10), lineStatuses: top(lineStatuses, 12, 'status'),
            mra: { done: k.mraDone, failed: k.mraFailed, skipped: k.mraSkipped, none: k.mraNone, pct: pct(k.mraDone, k.orders), reasons: top(mraWhy, 8, 'reason'), failedRows: mraFailedRows.slice(0, 50), tries: mraTries, ok: mraOk, fail: mraFail, gw: mraGw, byUser: Object.keys(mraByUser).map(function (n) { var u = mraByUser[n]; return { name: n, tries: u.tries, ok: u.ok, failed: u.failed, gw: u.gw, sources: Object.keys(u.sources).join(', ') }; }).sort(function (a, b) { return b.tries - a.tries; }), bySource: top(mraBySource, 8, 'source') },
            cancels: { lines: cl.lines, done: cl.done, failed: cl.failed, runs: cl.runs, orders: Object.keys(cl.orders).length, byUser: Object.keys(cl.byUser).map(function (n) { return cl.byUser[n]; }).sort(function (a, b) { return (b.done + b.failed) - (a.done + a.failed); }), rows: cl.rows.slice(0, 200), cancelledLines: linesCancelled, pending: f.CANCEL.slice(0, 100) },
            prints: prints, issues: issues, errors: f.ERROR.slice(0, 100), users: userList,
            timeline: { hours: hours, first: busy.length ? busy[0].h + ':00' : '', last: busy.length ? busy[busy.length - 1].h + ':59' : '', peak: peak ? peak.h + ':00' : '', peakTotal: peak ? peak.total : 0 }
        };
        m.narrative = E.narrative(m);
        return m;
    };

    /** Plain-words story of the day: paragraphs + highlights + lowlights. */
    E.narrative = function (m) {
        var k = m.kpis, P = [], hi = [], lo = [], o = k.orders;
        var p = function (title, text) { P.push({ title: title, text: text }); };
        if (!k.trips && !o) {
            p('Overview', 'Nothing was planned for ' + m.dayWord + ' on ' + m.pod + ': no trips and no sales orders were found.');
        } else {
            var busiest = m.trips.slice().sort(function (a, b) { return b.orders - a.orders; })[0];
            p('Overview', m.dayWord + ' on ' + m.pod + ': ' + plural(k.trips, 'trip') + ' carried ' + plural(o, 'sales order') + (k.store ? ' plus ' + plural(k.store, 'store / van transfer') : '') + (k.cancelledOrders ? ' (' + plural(k.cancelledOrders, 'cancelled order') + ' left out)' : '') + (k.lines ? ', ' + plural(k.lines, 'order line') : '') + (k.amount ? ', ' + k.amount.toLocaleString() + ' in order value' : '') + '.' +
                (busiest ? ' The busiest trip was ' + busiest.trip_id + (busiest.lorry ? ' (' + busiest.lorry + ')' : '') + ' with ' + plural(busiest.orders, 'order') + '.' : '') +
                (m.score != null ? ' Overall readiness is ' + m.score + ' % — the average of released, picked, shipped, printed and interfaced to MRA.' : ''));
            p('Picking', o ? plural(k.pickers, 'picker') + ' worked the day' + (m.pickers.length ? ' — ' + list(m.pickers.slice(0, 4).map(function (x) { return x.name + ' ' + plural(x.orders, 'order'); }), 4) : '') + '. ' + k.released + ' of ' + o + ' orders (' + pct(k.released, o) + ' %) were released and ' + k.picked + ' (' + pct(k.picked, o) + ' %) pick-confirmed' + (k.noPicker ? '; ' + plural(k.noPicker, 'order') + ' had no picker' : '') + '.' : 'No orders to pick.');
            p('Shipping & printing', o ? k.shipped + ' orders (' + pct(k.shipped, o) + ' %) were ship-confirmed and ' + k.printed + ' (' + pct(k.printed, o) + ' %) printed' + (m.prints.total ? '; the print queue holds ' + plural(m.prints.total, 'job') + ' for the date (' + m.prints.printed + ' printed' + (m.prints.failed ? ', ' + m.prints.failed + ' failed' : '') + (m.prints.pending ? ', ' + m.prints.pending + ' pending' : '') + ')' : '') + '.' : 'Nothing to ship.');
            p('MRA', o ? k.mraDone + ' of ' + o + ' orders (' + m.mra.pct + ' %) are interfaced to MRA' + (k.mraFailed ? ', ' + k.mraFailed + ' failed' + (m.mra.reasons.length ? ' — mostly "' + m.mra.reasons[0].reason + '"' : '') : '') + (k.mraSkipped ? ', ' + k.mraSkipped + ' skipped' : '') + (k.mraNone ? ', ' + k.mraNone + ' not sent yet' : '') + '.' + (m.mra.tries ? ' ' + plural(m.mra.tries, 'MRA try', 'MRA tries') + ' were made on the day (' + m.mra.ok + ' ok, ' + m.mra.fail + ' failed' + (m.mra.gw ? ', ' + plural(m.mra.gw, 'gateway problem') : '') + ')' + (m.mra.byUser.length ? ' by ' + list(m.mra.byUser.map(function (u) { return u.name + ' ×' + u.tries; }), 4) : '') + '.' : '') : 'No MRA work.');
            p('Cancellations', (k.cancelledLines ? plural(k.cancelledLines, 'line') + ' on ' + plural(k.ordersWithCancelled, 'order') + ' are cancelled on the trips.' : 'No cancelled lines on the trips.') + (m.cancels.lines ? ' The cancellation runs of the day sent ' + plural(m.cancels.lines, 'line') + ' (' + m.cancels.done + ' done, ' + m.cancels.failed + ' failed)' + (m.cancels.byUser.length ? ' — ' + list(m.cancels.byUser.map(function (u) { return u.name + ' ' + (u.done + u.failed); }), 3) : '') + '.' : '') + (k.pendingCancel ? ' ' + plural(k.pendingCancel, 'line') + ' still wait for cancellation.' : ''));
        }
        if (m.issues.length) p('Needs attention', m.issues.map(function (i) { return i.text; }).join('. ') + '.'); else p('Needs attention', 'Nothing is open: no order errors, no failed MRA, no pending cancellations.');
        p('People', m.users.length ? plural(m.users.length, 'person', 'people') + ' were active: ' + m.users.slice(0, 6).map(function (u) { return u.name + ' — ' + u.did; }).join('; ') + (m.users.length > 6 ? '; and ' + (m.users.length - 6) + ' more' : '') + '.' : 'No user activity was recorded for the day.');
        if (m.timeline.first) p('Timeline', 'The day ran from ' + m.timeline.first + ' to ' + m.timeline.last + (m.timeline.peak ? ', busiest around ' + m.timeline.peak + ' (' + plural(m.timeline.peakTotal, 'event') + ')' : '') + '.');
        // highlights / lowlights
        if (o && pct(k.shipped, o) >= 90) hi.push(pct(k.shipped, o) + ' % of the orders ship-confirmed');
        if (o && m.mra.pct >= 90) hi.push(m.mra.pct + ' % interfaced to MRA');
        if (o && !k.noPicker) hi.push('every order had a picker');
        if (!k.orderErrors && o) hi.push('no order errors');
        if (m.cancels.done) hi.push(plural(m.cancels.done, 'line') + ' cancelled automatically');
        if (o && pct(k.shipped, o) < 50) lo.push('only ' + pct(k.shipped, o) + ' % ship-confirmed');
        if (o && m.mra.pct < 50) lo.push('only ' + m.mra.pct + ' % interfaced to MRA');
        if (k.mraFailed) lo.push(plural(k.mraFailed, 'MRA failure'));
        if (k.noPicker) lo.push(plural(k.noPicker, 'order') + ' without a picker');
        if (k.orderErrors) lo.push(plural(k.orderErrors, 'order error'));
        if (k.pendingCancel) lo.push(plural(k.pendingCancel, 'line') + ' pending cancellation');
        if (m.cancels.failed) lo.push(plural(m.cancels.failed, 'cancellation') + ' failed');
        return { paragraphs: P, highlights: hi, lowlights: lo, headline: !k.trips && !o ? 'Nothing planned' : m.score != null ? (m.score >= 90 ? 'A clean day' : m.score >= 70 ? 'A good day with a few loose ends' : m.score >= 40 ? 'Half way — work still open' : 'Most of the day is still open') : 'Day summary' };
    };

    /** The debrief as plain text (Copy / e-mail / Teams). */
    E.text = function (m) {
        var L = [], k = m.kpis;
        L.push('DAY DEBRIEF — ' + m.dayWord + ' · ' + m.pod + (m.builtAt ? ' · built ' + m.builtAt : ''));
        L.push(m.narrative.headline + (m.score != null ? ' · readiness ' + m.score + ' %' : ''));
        L.push('');
        L.push('Trips ' + k.trips + ' · Sales orders ' + k.orders + ' · Lines ' + k.lines + ' · Pickers ' + k.pickers + ' · Released ' + k.released + ' · Picked ' + k.picked + ' · Shipped ' + k.shipped + ' · Printed ' + k.printed + ' · MRA done ' + k.mraDone + ' · MRA failed ' + k.mraFailed + ' · Cancelled lines ' + k.cancelledLines + ' · Pending cancellations ' + k.pendingCancel + ' · Order errors ' + k.orderErrors + ' · No picker ' + k.noPicker);
        L.push('');
        m.narrative.paragraphs.forEach(function (p) { L.push(p.title.toUpperCase()); L.push(p.text); L.push(''); });
        if (m.narrative.highlights.length) L.push('Highlights: ' + m.narrative.highlights.join('; '));
        if (m.narrative.lowlights.length) L.push('Watch: ' + m.narrative.lowlights.join('; '));
        if (m.trips.length) { L.push(''); L.push('TRIPS'); m.trips.forEach(function (t) { L.push('  ' + t.trip_id + (t.lorry ? ' ' + t.lorry : '') + ': ' + t.orders + ' orders, released ' + t.released + ', picked ' + t.picked + ', shipped ' + t.shipped + ', printed ' + t.printed + ', MRA ' + t.mraDone + '/' + t.orders + (t.mraFailed ? ' (' + t.mraFailed + ' failed)' : '') + (t.pickers ? ', pickers ' + t.pickers : '') + (t.noPicker ? ', no picker ' + t.noPicker : '') + (t.cancelledLines ? ', cancelled lines ' + t.cancelledLines : '') + ' · readiness ' + t.readiness + ' %'); }); }
        if (m.pickers.length) { L.push(''); L.push('PICKERS'); m.pickers.forEach(function (p) { L.push('  ' + p.name + ': ' + p.orders + ' orders on ' + plural(p.trips, 'trip') + ', picked ' + p.picked + ' (' + p.pickedPct + ' %), shipped ' + p.shipped + (p.lines ? ', ' + p.lines + ' lines' : '')); }); }
        if (m.users.length) { L.push(''); L.push('PEOPLE'); m.users.forEach(function (u) { L.push('  ' + u.name + ': ' + u.did); }); }
        return L.join('\n');
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = E;
    else root.WMSDBF = E;
})(typeof window !== 'undefined' ? window : this);
