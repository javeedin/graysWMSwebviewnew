/* Fusion Shipping — page entry (fscm/shipping.html). The shipping views of Fusion Order Management as their own module:
   the same FOM engine (fom-*.js), so Shipment Lines, Confirm Picks, pick release, pick slips and ship confirm behave exactly
   as in om.html. New here: the Shipping cockpit (open shipment lines of one organisation by status, late lines, the next 7
   days, an order worklist with the next step) and the Batch desk (paste or scan orders → status of each → pick release /
   ship confirm the ticked ones, 2 at a time, after a confirm). Nothing is sent to Fusion without a click and a confirm. */
var SHIP = window.SHIP = {};

SHIP.OPEN = ['Ready to release', 'Released to warehouse', 'Staged', 'Backordered'];
SHIP.STEP = {
    0: { t: 'Pick release', i: 'fa-people-carry-box', c: 'info' },
    1: { t: 'Confirm picks', i: 'fa-clipboard-check', c: 'done' },
    2: { t: 'Ship confirm', i: 'fa-truck', c: 'warn' },
    3: { t: 'Shipped', i: 'fa-check', c: 'ok' },
    4: { t: 'Shipped', i: 'fa-check', c: 'ok' }
};
SHIP.daysLate = function (d) {
    if (!d) return 0;
    var t = new Date(String(d).slice(0, 10) + 'T00:00:00'), n = new Date(FX.today() + 'T00:00:00');
    return isNaN(t) ? 0 : Math.round((n - t) / 864e5);
};
/** Compact stage for table rows: 4 dots (open · released · picked · shipped) + the stage name. */
SHIP.mini = function (stage) {
    stage = Math.min(stage, 4);
    return '<span class="sh-mini" title="' + esc(FOM.SHIP_STAGES[Math.min(stage, 3)]) + '">' + FOM.SHIP_STAGES.map(function (n, j) { return '<i class="' + (j < stage ? 'done' : j === stage ? 'cur' : '') + '"></i>'; }).join('') + '<span>' + esc(stage >= 3 ? 'Shipped' : FOM.SHIP_STAGES[stage]) + '</span></span>';
};
SHIP.org = function () { return lsGet('fom_sl_org', ''); };
SHIP.orgPicker = function (id) {
    return '<label>Organization<select id="' + id + '"></select></label>';
};
SHIP.fillOrg = function (id) { return FX.fillSelect(id, FOM.orgCodes(), SHIP.org(), 'Select…'); };

// ── Cockpit ────────────────────────────────────────────────────
SHIP.viewCockpit = function (el) {
    el.innerHTML = '<div class="card"><div class="filters">' + SHIP.orgPicker('sh-org') +
        '<label>Order type<select id="sh-ot">' + FOM.ORDER_TYPES_SHIP.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select></label>' +
        '<div class="go"><button class="btn primary" id="sh-go"><i class="fa-solid fa-rotate"></i> Read from Fusion</button></div></div></div><div id="sh-out" style="display:flex;flex-direction:column;gap:10px"></div>';
    SHIP.fillOrg('sh-org').then(function () { if ($('sh-org').value) SHIP.cockpitLoad(); else $('sh-out').innerHTML = '<div class="card pad note">Pick the organization you ship from, then <b>Read from Fusion</b>. The open shipment lines (ready, released, staged, backordered) are read live.</div>'; });
    $('sh-go').onclick = SHIP.cockpitLoad;
};
SHIP.cockpitLoad = function () {
    var org = $('sh-org').value, ot = $('sh-ot').value, out = $('sh-out');
    if (!org) { FX.toast('Pick an organization first.', 'err'); return; }
    lsSet('fom_sl_org', org);
    out.innerHTML = '<div class="card pad"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading open shipment lines of ' + esc(org) + '…</div>';
    var fields = 'ShipmentLine,Order,OrderLine,OrderType,OrderTypeCode,OrganizationCode,OrganizationName,Item,ItemDescription,LineStatus,RequestedDate,ScheduledShipDate,RequestedQuantity,RequestedQuantityUOM,Shipment,ShipToCustomer,ShipToPartyName';
    Promise.all(SHIP.OPEN.map(function (st) {
        return FOM.all('shipmentLines', { q: "OrganizationCode='" + org + "';OrderType='" + ot + "';LineStatus='" + st + "'", fields: fields, limit: 500 }, 3000)
            .catch(function (e) { return { _error: FOM.emsg(e), st: st }; });
    })).then(function (res) {
        var lines = [], errs = [];
        res.forEach(function (r) { if (r && r._error) errs.push(r.st + ': ' + r._error); else lines = lines.concat(r); });
        SHIP.lines = lines;
        SHIP.cockpitDraw(org, errs);
    });
};
SHIP.cockpitDraw = function (org, errs) {
    var lines = SHIP.lines, out = $('sh-out');
    var by = function (re) { return lines.filter(function (l) { return re.test(l.LineStatus || ''); }); };
    var late = lines.filter(function (l) { return SHIP.daysLate(l.RequestedDate) > 0; });
    // orders: worst (lowest) stage of their open lines = the next step
    var ords = {};
    lines.forEach(function (l) {
        var o = ords[l.Order] || (ords[l.Order] = { order: l.Order, type: l.OrderType, code: l.OrderTypeCode, org: l.OrganizationCode, cust: l.ShipToPartyName || l.ShipToCustomer || '', lines: 0, bo: 0, stage: 9, req: null, ship: '' });
        o.lines++; if (/backorder/i.test(l.LineStatus)) o.bo++;
        o.stage = Math.min(o.stage, FOM.shipLineStage(l));
        if (l.RequestedDate && (!o.req || l.RequestedDate < o.req)) o.req = l.RequestedDate;
        if (l.Shipment && !o.ship) o.ship = l.Shipment;
    });
    var orders = Object.keys(ords).map(function (k) { var o = ords[k]; o.late = SHIP.daysLate(o.req); return o; })
        .sort(function (a, b) { return b.late - a.late || a.stage - b.stage; });
    // next 7 days by requested date (late lines go in "late")
    var days = [];
    for (var i = 0; i < 7; i++) { var d = FOM.days(i); days.push({ d: d, n: lines.filter(function (l) { return String(l.RequestedDate || '').slice(0, 10) === d; }).length }); }
    var max = Math.max.apply(null, days.map(function (x) { return x.n; }).concat([late.length, 1]));
    var bar = function (label, n, cls) { return '<div class="sh-bar"><span>' + label + '</span><i class="' + (cls || '') + '" style="width:' + Math.round(n / max * 100) + '%"></i><b>' + n + '</b></div>'; };
    // backordered items
    var bo = {}; by(/backorder/i).forEach(function (l) { var k = l.Item; bo[k] = bo[k] || { item: k, desc: l.ItemDescription, qty: 0, lines: 0, uom: l.RequestedQuantityUOM }; bo[k].qty += FOM.n(l.RequestedQuantity); bo[k].lines++; });
    var boList = Object.keys(bo).map(function (k) { return bo[k]; }).sort(function (a, b) { return b.lines - a.lines; }).slice(0, 10);
    var tile = function (k, label, v, sub, cls) { return '<div class="kpi sh-k ' + (cls || '') + '" data-k="' + k + '"><b>' + v + '</b><span>' + esc(label) + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; };
    var nOrd = function (a) { return FOM.distinct(a.map(function (l) { return l.Order; })).length; };
    var tips = [];
    if (late.length) tips.push('<b>' + late.length + '</b> line(s) of <b>' + nOrd(late) + '</b> order(s) are past their requested date — oldest ' + Math.max.apply(null, late.map(function (l) { return SHIP.daysLate(l.RequestedDate); })) + ' day(s).');
    if (by(/staged/i).length) tips.push('<b>' + nOrd(by(/staged/i)) + '</b> order(s) are staged and only wait for <b>ship confirm</b>.');
    if (by(/backorder/i).length) tips.push('<b>' + by(/backorder/i).length + '</b> backordered line(s) — check on-hand for ' + boList.slice(0, 3).map(function (b) { return '<span class="mono">' + esc(b.item) + '</span>'; }).join(', ') + (boList.length > 3 ? ' …' : ''));
    if (!lines.length) tips.push('No open shipment lines for ' + esc(org) + ' — everything is shipped.');
    out.innerHTML = (errs.length ? '<div class="note err" style="white-space:pre-wrap">' + esc(errs.join('\n')) + '</div>' : '') +
        '<div class="kpis">' + tile('all', 'Open lines', lines.length, nOrd(lines) + ' orders') + tile('rr', 'Ready to release', by(/ready/i).length, nOrd(by(/ready/i)) + ' orders') +
        tile('rel', 'Released', by(/released/i).length, 'to pick') + tile('stg', 'Staged', by(/staged/i).length, 'to ship confirm', 'warn') +
        tile('bo', 'Backordered', by(/backorder/i).length, boList.length + ' items', 'err') + tile('late', 'Late', late.length, 'past requested date', late.length ? 'err' : '') + '</div>' +
        '<div class="card pad sh-tips">' + tips.map(function (t) { return '<div><i class="fa-solid fa-lightbulb"></i> ' + t + '</div>'; }).join('') + '</div>' +
        '<div class="sh-row"><div class="card pad"><h4>Requested ship dates</h4>' + bar('Late', late.length, 'late') + days.map(function (x, j) { return bar(j === 0 ? 'Today' : j === 1 ? 'Tomorrow' : FOM.d(x.d), x.n); }).join('') + '</div>' +
        '<div class="card pad"><h4>Backordered items</h4>' + FOM.table(boList, [{ f: 'item', label: 'Item', mono: 1 }, { f: 'desc', label: 'Description' }, { f: 'lines', label: 'Lines', n: 1 }, { label: 'Qty', n: 1, html: function (b) { return FOM.qty(b.qty) + ' ' + esc(b.uom || ''); } }], { empty: 'Nothing backordered.', icon: 'fa-box' }) + '</div></div>' +
        '<div class="card"><div class="card-h"><b><i class="fa-solid fa-list-check"></i> Order worklist</b><span class="muted">' + orders.length + ' orders · late first · click a row to open it</span><span class="grow"></span>' +
        '<button class="btn sm" id="sh-tobatch"><i class="fa-solid fa-layer-group"></i> Send these to the Batch desk</button><button class="btn sm" id="sh-csv"><i class="fa-solid fa-file-csv"></i> CSV</button></div><div id="sh-wl"></div></div>';
    var cols = [
        { f: 'order', label: 'Order', html: function (o) { return '<a class="fom-a">' + esc(o.order) + '</a>'; } },
        { f: 'cust', label: 'Customer' }, { f: 'type', label: 'Type' }, { f: 'lines', label: 'Open lines', n: 1 },
        { label: 'Backordered', n: 1, get: function (o) { return o.bo; }, html: function (o) { return o.bo ? '<span class="chip err">' + o.bo + '</span>' : ''; } },
        { label: 'Requested', get: function (o) { return o.req; }, html: function (o) { return esc(FOM.d(o.req)) + (o.late > 0 ? ' <span class="chip err">' + o.late + ' d late</span>' : ''); } },
        { label: 'Stage', get: function (o) { return FOM.SHIP_STAGES[Math.min(o.stage, 3)]; }, html: function (o) { return SHIP.mini(o.stage); } },
        { label: 'Next step', get: function (o) { return SHIP.STEP[o.stage].t; }, html: function (o) { var s = SHIP.STEP[o.stage]; return '<span class="chip ' + s.c + '"><i class="fa-solid ' + s.i + '"></i> ' + s.t + '</span>'; } },
        { f: 'ship', label: 'Shipment' }
    ];
    var shown = orders;
    var draw = function () {
        $('sh-wl').innerHTML = FOM.table(shown, cols, { empty: 'No orders.', icon: 'fa-truck', maxH: 520, rowCls: function () { return 'click'; } });
    };
    draw();
    out.querySelectorAll('.sh-k').forEach(function (k) {
        k.onclick = function () {
            var on = k.classList.contains('on'); out.querySelectorAll('.sh-k').forEach(function (x) { x.classList.remove('on'); });
            var key = k.getAttribute('data-k'), f = { rr: function (o) { return o.stage === 0; }, rel: function (o) { return o.stage === 1; }, stg: function (o) { return o.stage === 2; }, bo: function (o) { return o.bo > 0; }, late: function (o) { return o.late > 0; } }[key];
            shown = on || !f ? orders : orders.filter(f); if (!on && f) k.classList.add('on'); draw();
        };
    });
    $('sh-wl').onclick = function (e) {
        var tr = e.target.closest('tr[data-i]'); if (!tr) return;
        var o = shown[+tr.getAttribute('data-i')];
        FOM.shipOrderDlg(o.order, { Order: o.order, OrderType: o.type, OrderTypeCode: o.code, OrganizationCode: o.org });
    };
    $('sh-csv').onclick = function () { FX.csv(shown, cols, 'shipping_worklist_' + org); };
    $('sh-tobatch').onclick = function () { SHIP.batchSeed = shown.map(function (o) { return o.order; }); FX.show('batch'); };
};

// ── Batch desk ─────────────────────────────────────────────────
SHIP.viewBatch = function (el) {
    var seed = SHIP.batchSeed || lsGet('sh_batch_orders', []); SHIP.batchSeed = null;
    el.innerHTML = '<div class="card"><div class="filters" style="align-items:stretch">' +
        '<label style="flex:1;min-width:260px">Orders — paste a column from Excel, type, or scan (Enter after each)<textarea id="sh-ords" rows="4" style="border:1px solid var(--line);border-radius:8px;padding:7px 9px;font:500 .82rem var(--mono);text-transform:none;letter-spacing:0;color:var(--ink)">' + esc(seed.join('\n')) + '</textarea></label>' +
        '<div class="go" style="flex-direction:column;justify-content:flex-end"><button class="btn primary" id="sh-chk"><i class="fa-solid fa-magnifying-glass"></i> Check status</button><button class="btn" id="sh-clr"><i class="fa-solid fa-eraser"></i> Clear</button></div></div></div>' +
        '<div class="card"><div class="card-h"><b><i class="fa-solid fa-layer-group"></i> Orders</b><span class="muted" id="sh-cnt"></span><span class="grow"></span>' +
        '<button class="btn sm" id="sh-tickr">Tick ready to release</button><button class="btn sm" id="sh-ticks">Tick staged</button>' +
        '<button class="btn sm primary" id="sh-rel" disabled><i class="fa-solid fa-people-carry-box"></i> Pick release ticked</button>' +
        '<button class="btn sm primary" id="sh-ship" disabled><i class="fa-solid fa-truck"></i> Ship confirm ticked</button>' +
        '<button class="btn sm" id="sh-bcsv"><i class="fa-solid fa-file-csv"></i> CSV</button></div><div id="sh-blist"></div></div>';
    SHIP.batch = SHIP.batch || [];
    var parse = function () {
        return FOM.distinct($('sh-ords').value.split(/[\s,;]+/).map(function (x) { return x.trim(); }).filter(function (x) { return /^[\w-]+$/.test(x); }));
    };
    $('sh-ords').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.ctrlKey) SHIP.batchCheck(parse()); });
    $('sh-chk').onclick = function () { SHIP.batchCheck(parse()); };
    $('sh-clr').onclick = function () { $('sh-ords').value = ''; SHIP.batch = []; lsSet('sh_batch_orders', []); SHIP.batchDraw(); };
    $('sh-tickr').onclick = function () { SHIP.batch.forEach(function (r) { r.tick = r.stage === 0 && r.lines > 0; }); SHIP.batchDraw(); };
    $('sh-ticks').onclick = function () { SHIP.batch.forEach(function (r) { r.tick = r.stage === 2 && !!r.ship; }); SHIP.batchDraw(); };
    $('sh-rel').onclick = function () { SHIP.batchRun('release'); };
    $('sh-ship').onclick = function () { SHIP.batchRun('ship'); };
    $('sh-bcsv').onclick = function () { FX.csv(SHIP.batch, SHIP.batchCols(), 'shipping_batch'); };
    $('sh-blist').addEventListener('change', function (e) { var c = e.target.closest('[data-tk]'); if (c) { SHIP.batch[+c.getAttribute('data-tk')].tick = c.checked; SHIP.batchDraw(); } });
    $('sh-blist').addEventListener('click', function (e) {
        if (e.target.closest('[data-tk]')) return;
        var a = e.target.closest('[data-open]'); if (a) { var r = SHIP.batch[+a.getAttribute('data-open')]; FOM.shipOrderDlg(r.order, r.hdr); return; }
        var au = e.target.closest('[data-auto]'); if (au) { var r2 = SHIP.batch[+au.getAttribute('data-auto')]; FOM.autoShipDlg(r2.order, r2.org, function () { SHIP.batchCheck([r2.order], true); }); }
    });
    if (seed.length && !SHIP.batch.length) SHIP.batchCheck(seed); else SHIP.batchDraw();
};
SHIP.batchCols = function () {
    return [
        { f: 'order', label: 'Order' }, { f: 'org', label: 'Org' }, { f: 'type', label: 'Type' }, { f: 'lines', label: 'Lines' },
        { label: 'Stage', get: function (r) { return r.err ? 'error' : r.lines ? FOM.SHIP_STAGES[Math.min(r.stage, 3)] : 'no lines'; } },
        { f: 'ship', label: 'Shipment' }, { f: 'result', label: 'Result' }
    ];
};
SHIP.batchCheck = function (orders, merge) {
    if (!orders.length) { FX.toast('Paste or scan at least one order number.', 'err'); return; }
    if (!merge) { lsSet('sh_batch_orders', orders); SHIP.batch = orders.map(function (o) { return { order: o, busy: true }; }); }
    else orders.forEach(function (o) { var r = SHIP.batch.filter(function (x) { return x.order === o; })[0]; if (r) r.busy = true; });
    SHIP.batchDraw();
    FOM.mapLimit(orders, 3, function (o) {
        var r = SHIP.batch.filter(function (x) { return x.order === o; })[0];
        return FOM.shipLines(o).then(function (ls) {
            var h = ls[0] || {};
            Object.assign(r, { busy: false, err: '', lines: ls.length, stage: ls.length ? FOM.shipStage(ls) : 0, org: h.OrganizationCode || '', type: h.OrderType || '', code: h.OrderTypeCode || '', ship: FOM.firstShipment(ls), hdr: h,
                bo: ls.filter(function (l) { return /backorder/i.test(l.LineStatus || ''); }).length });
        }, function (e) { Object.assign(r, { busy: false, err: FOM.emsg(e) }); }).then(SHIP.batchDraw);
    });
};
SHIP.batchDraw = function () {
    var el = $('sh-blist'); if (!el) return;
    var rows = SHIP.batch, t = rows.filter(function (r) { return r.tick; });
    $('sh-cnt').textContent = rows.length ? rows.length + ' orders · ' + t.length + ' ticked' : '';
    $('sh-rel').disabled = !t.some(function (r) { return r.stage === 0 && r.lines; }) || SHIP.batchBusy;
    $('sh-ship').disabled = !t.some(function (r) { return r.stage === 2 && r.ship; }) || SHIP.batchBusy;
    el.innerHTML = FOM.table(rows, [
        { th: '', label: '', html: function (r, i) { return r.lines ? '<input type="checkbox" data-tk="' + i + '"' + (r.tick ? ' checked' : '') + '>' : ''; } },
        { label: 'Order', html: function (r, i) { return '<a class="fom-a" data-open="' + i + '">' + esc(r.order) + '</a>'; } },
        { f: 'org', label: 'Org' }, { f: 'type', label: 'Type' }, { f: 'lines', label: 'Lines', n: 1 },
        { label: 'Stage', html: function (r) { return r.busy ? '<i class="fa-solid fa-circle-notch fa-spin"></i>' : r.err ? '<span class="chip err" title="' + esc(r.err) + '">error</span>' : r.lines ? SHIP.mini(r.stage) + (r.bo ? ' <span class="chip err">' + r.bo + ' backordered</span>' : '') : '<span class="chip warn">no shipment lines</span>'; } },
        { f: 'ship', label: 'Shipment' },
        { label: 'Result', html: function (r) { return r.result ? '<span class="chip ' + (r.ok ? 'ok' : 'err') + '" title="' + esc(r.result) + '">' + esc(String(r.result).slice(0, 60)) + '</span>' : ''; } },
        { label: '', html: function (r, i) { return r.lines && r.stage < 3 ? '<button class="btn sm" data-auto="' + i + '" title="Pick release → pick confirm → ship confirm for this order"><i class="fa-solid fa-wand-magic-sparkles"></i> Auto ship</button>' : ''; } }
    ], { empty: 'Paste or scan order numbers above, then Check status.', icon: 'fa-layer-group', maxH: 560 });
};
SHIP.batchRun = function (kind) {
    var todo = SHIP.batch.filter(function (r) { return r.tick && (kind === 'release' ? r.stage === 0 && r.lines : r.stage === 2 && r.ship); });
    if (!todo.length) return;
    var what = kind === 'release' ? 'Pick release' : 'Ship confirm';
    FOM.confirm(what, what + ' <b>' + todo.length + '</b> order(s) in <b>' + FX.instance + '</b>, two at a time?<div class="note" style="margin-top:6px">' + todo.map(function (r) { return esc(r.order) + (kind === 'ship' ? ' · ' + esc(r.ship) : '') + ' · ' + esc(r.org); }).join('<br>') + '</div>', what).then(function (ok) {
        if (!ok) return;
        SHIP.batchBusy = true; todo.forEach(function (r) { r.busy = true; r.result = ''; }); SHIP.batchDraw();
        FOM.mapLimit(todo, 2, function (r) {
            var p = kind === 'release' ? FOM.pickRelease(r.order, r.org, r.code || FOM.orderTypeCode(r.hdr || {}))
                : FOM.raw('POST', 'shippingTransactions', { contentType: 'json' }, { ShipmentName: r.ship, Action: 'CONFIRM', Organization: r.org }).then(function (x) {
                    var bad = !x.ok || (x.json && x.json.ReturnStatus === 'E');
                    return { ok: !bad, msg: bad ? FOM.errs(x.json, x.text, x.status).join('\n') : 'Ship confirmed' };
                });
            return p.then(function (x) { r.ok = x.ok; r.result = x.msg; }, function (e) { r.ok = false; r.result = FOM.emsg(e); }).then(function () { r.busy = false; r.tick = !r.ok; SHIP.batchDraw(); });
        }).then(function () {
            SHIP.batchBusy = false;
            var good = todo.filter(function (r) { return r.ok; }).length;
            FX.toast(what + ': ' + good + ' of ' + todo.length + ' done' + (good < todo.length ? ' — the failed ones stay ticked' : ''), good === todo.length ? 'ok' : 'err');
            setTimeout(function () { SHIP.batchCheck(todo.map(function (r) { return r.order; }), true); }, 2500);
        });
    });
};

// ── Ship confirm (one shipment) ────────────────────────────────
SHIP.viewShipConfirm = function (el) {
    el.innerHTML = '<div class="card pad"><p class="muted" style="margin:0 0 8px">Confirm one shipment by its number — with today\'s date (shippingTransactions) or an actual ship date (shipmentTransactionRequests). To follow one order through every step use <b>Auto ship</b>.</p>' +
        '<div class="row-btns"><button class="btn primary" id="sh-sc"><i class="fa-solid fa-truck"></i> Ship confirm a shipment…</button>' +
        '<input id="sh-ao" placeholder="Order number" style="border:1px solid var(--line);border-radius:8px;padding:7px 9px"><button class="btn" id="sh-au"><i class="fa-solid fa-wand-magic-sparkles"></i> Auto ship this order…</button></div></div>';
    $('sh-sc').onclick = function () { FOM.shipConfirmDlg('', SHIP.org()); };
    var au = function () { var o = $('sh-ao').value.trim(); if (!o) { FX.toast('Type an order number.', 'err'); return; } FOM.autoShipDlg(o, ''); };
    $('sh-au').onclick = au;
    $('sh-ao').addEventListener('keydown', function (e) { if (e.key === 'Enter') au(); });
};

(function () {
    var css = document.createElement('style');
    css.textContent = '.sh-k small{display:block;font-size:.68rem;color:var(--muted);margin-top:2px}.sh-k{cursor:pointer}.sh-k.err b{color:var(--err)}.sh-k.warn b{color:var(--warn)}' +
        '.sh-tips div{font-size:.82rem;padding:3px 0}.sh-tips i{color:#f59e0b;margin-right:6px}' +
        '.sh-row{display:grid;grid-template-columns:1fr 1.4fr;gap:10px}@media(max-width:900px){.sh-row{grid-template-columns:1fr}}.sh-row h4{margin:0 0 8px}' +
        '.sh-bar{display:grid;grid-template-columns:90px 1fr 40px;align-items:center;gap:8px;font-size:.78rem;margin:4px 0}.sh-bar i{display:block;height:12px;border-radius:6px;background:var(--mod,#14b8a6);min-width:2px}.sh-bar i.late{background:var(--err)}.sh-bar b{text-align:right}' +
        '.sh-mini{display:inline-flex;align-items:center;gap:3px;white-space:nowrap}.sh-mini i{width:9px;height:9px;border-radius:50%;background:var(--line)}.sh-mini i.done{background:var(--ok)}.sh-mini i.cur{background:var(--accent);box-shadow:0 0 0 3px var(--accent-bg)}.sh-mini span{margin-left:5px;font-size:.74rem;color:var(--ink2)}';
    document.head.appendChild(css);
    FX.start({
        module: 'ship',
        sub: 'Pick release, picks and ship confirm — live from Oracle Fusion',
        views: [
            { id: 'cockpit', group: 'Shipping', label: 'Shipping cockpit', icon: 'fa-gauge-high', desc: 'Open shipment lines of one organization: status, late lines, the next 7 days and the next step per order.', render: SHIP.viewCockpit },
            { id: 'shiplines', group: 'Shipping', label: 'Shipment Lines', icon: 'fa-truck-ramp-box', desc: 'Pending shipment lines — pick release, pick slips, ship confirm.', render: FOM.viewShipLines },
            { id: 'picks', group: 'Shipping', label: 'Confirm Picks', icon: 'fa-clipboard-check', desc: 'Pick slips — allocate lots / serials, confirm, ship.', render: FOM.viewConfirmPicks },
            { id: 'batch', group: 'Shipping', label: 'Batch release & ship', icon: 'fa-layer-group', desc: 'Paste or scan orders, see where each one stands, pick release or ship confirm the ticked ones.', render: SHIP.viewBatch },
            { id: 'shipconfirm', group: 'Shipping', label: 'Ship confirm', icon: 'fa-truck', desc: 'Confirm a shipment or run one order through every step.', render: SHIP.viewShipConfirm },
            { id: 'settings', group: 'Settings', label: 'Settings', icon: 'fa-sliders', desc: 'Shared with Fusion Order Management on this PC (ship confirm rule …).', render: FOM.viewSettings }
        ]
    });
})();
