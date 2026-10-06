/* Fusion Shipping — page entry (fscm/shipping.html). The shipping views of Fusion Order Management as their own module:
   the same FOM engine (fom-*.js), so Shipment Lines, Confirm Picks, pick release, pick slips and ship confirm behave exactly
   as in om.html. New here: the Batch desk (paste or scan orders → status of each → pick release /
   ship confirm the ticked ones, 2 at a time, after a confirm). Nothing is sent to Fusion without a click and a confirm. */
var SHIP = window.SHIP = {};

/** Compact stage for table rows: 4 dots (open · released · picked · shipped) + the stage name. */
SHIP.mini = function (stage) {
    stage = Math.min(stage, 4);
    return '<span class="sh-mini" title="' + esc(FOM.SHIP_STAGES[Math.min(stage, 3)]) + '">' + FOM.SHIP_STAGES.map(function (n, j) { return '<i class="' + (j < stage ? 'done' : j === stage ? 'cur' : '') + '"></i>'; }).join('') + '<span>' + esc(stage >= 3 ? 'Shipped' : FOM.SHIP_STAGES[stage]) + '</span></span>';
};
SHIP.org = function () { return lsGet('fom_sl_org', ''); };

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
    css.textContent = '.sh-mini{display:inline-flex;align-items:center;gap:3px;white-space:nowrap}.sh-mini i{width:9px;height:9px;border-radius:50%;background:var(--line)}.sh-mini i.done{background:var(--ok)}.sh-mini i.cur{background:var(--accent);box-shadow:0 0 0 3px var(--accent-bg)}.sh-mini span{margin-left:5px;font-size:.74rem;color:var(--ink2)}';
    document.head.appendChild(css);
    FX.start({
        module: 'ship',
        sub: 'Pick release, picks and ship confirm — live from Oracle Fusion',
        views: [
            { id: 'shiplines', group: 'Shipping', label: 'Shipment Lines', icon: 'fa-truck-ramp-box', desc: 'Pending shipment lines — pick release, pick slips, ship confirm.', render: FOM.viewShipLines },
            { id: 'picks', group: 'Shipping', label: 'Confirm Picks', icon: 'fa-clipboard-check', desc: 'Pick slips — allocate lots / serials, confirm, ship.', render: FOM.viewConfirmPicks },
            { id: 'batch', group: 'Shipping', label: 'Batch release & ship', icon: 'fa-layer-group', desc: 'Paste or scan orders, see where each one stands, pick release or ship confirm the ticked ones.', render: SHIP.viewBatch },
            { id: 'shipconfirm', group: 'Shipping', label: 'Ship confirm', icon: 'fa-truck', desc: 'Confirm a shipment or run one order through every step.', render: SHIP.viewShipConfirm },
            { id: 'settings', group: 'Settings', label: 'Settings', icon: 'fa-sliders', desc: 'Shared with Fusion Order Management on this PC (ship confirm rule …).', render: FOM.viewSettings }
        ]
    });
})();
