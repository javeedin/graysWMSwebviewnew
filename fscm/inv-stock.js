/* Fusion Inventory — Stock On-hand loading: search on-hand across orgs and post misc issue / misc receipt / subinventory
   transfer, or bulk-load / issue pasted lines. Posts through REST inventoryStagedTransactions (one row per line) and polls
   the interface. The synchronous SOAP Transaction Manager is outside the app's Fusion relay, so it is shown disabled. */

INV.stock = {
    id: 'stock', label: 'Stock On-hand Loading', icon: 'fa-dolly', group: 'Stock', desc: 'Misc issue / receipt and subinventory transfer through the inventory interface',
    render: function (el) {
        IU.tabs(el, [{ id: 'search', label: 'Search On-Hand', icon: 'fa-magnifying-glass', render: stkSearchTab }, { id: 'load', label: 'Load / Issue', icon: 'fa-file-import', render: stkLoadTab }]);
    }
};

var STK = {
    TYPES: { issue: { name: 'Miscellaneous issue', btn: 'Issue Out', icon: 'fa-arrow-up-from-bracket' }, receipt: { name: 'Miscellaneous receipt', btn: 'Receive', icon: 'fa-arrow-right-to-bracket' }, transfer: { name: 'Subinventory transfer', btn: 'Subinventory Transfer', icon: 'fa-right-left' } },
    signed: function (type, q) { q = Math.abs(+q || 0); return /issue|negative|foc/i.test(type) ? -q : q; },
    onh: function (r) { var keys = ['PrimaryQuantity', 'PrimaryTransactionQuantity', 'PrimaryOnhandQuantity', 'OnhandQuantity', 'TransactionPrimaryQuantity', 'Quantity']; for (var i = 0; i < keys.length; i++) { var n = IU.num(r[keys[i]]); if (n != null) return n; } return 0; },
    methodHtml: function (pre) {
        return '<label>Method<div class="seg"><button class="on" type="button">REST (interface)</button><button type="button" disabled title="SOAP is not available through the app relay" class="disabled-opt">SOAP (sync)</button></div></label>' +
            '<div class="note" style="font-size:.74rem;max-width:520px"><i class="fa-solid fa-circle-info"></i> Lines are staged with <b>inventoryStagedTransactions</b> (source code <b>' + esc(IU.cfg('sourceCode')) + '</b>) and processed by the inventory transaction manager. The synchronous SOAP <i>TransactionManagerServiceV2</i> option is disabled: the app\'s Fusion relay only allows REST resources.</div>';
    },
    /** Post one line through REST + poll. line: {org, item, fromSub, toSub, lot, qty, uom, locator}; ctx: {type, date, account, hdr, idx}. Updates line.status / line.msg, calls paint(). */
    post: function (line, ctx, paint) {
        var src = IU.cfg('sourceCode'), q = STK.signed(ctx.type, line.qty);
        var body = { TransactionTypeName: ctx.type, SourceCode: src, SourceHeaderId: ctx.hdr, SourceLineId: ctx.idx, OrganizationCode: line.org, ItemNumber: line.item, SubinventoryCode: line.fromSub, TransactionQuantity: q };
        if (line.uom) body.TransactionUnitOfMeasure = line.uom;
        body.TransactionDate = ctx.date + 'T' + new Date().toTimeString().slice(0, 8);
        if (/transfer/i.test(ctx.type)) body.TransferSubinventoryCode = ctx.destAll || line.toSub;
        else if (ctx.account) body.DistributionAccountCombination = ctx.account;
        if (line.locator) body.LocatorName = line.locator;
        if (line.lot) body.lotItemLots = [{ LotNumber: line.lot, TransactionQuantity: q }];
        line.status = 'pending'; line.msg = 'Posting…'; paint();
        return FX.rest('POST', 'inventoryStagedTransactions', {}, body).then(function () {
            line.status = 'ok'; line.msg = 'Submitted to interface…'; paint();
            var seen = false, n = 0;
            function poll() {
                n++;
                return FX.get('inventoryStagedTransactions', { q: 'SourceCode=' + FX.qv(src) + ';SourceHeaderId=' + ctx.hdr + ';SourceLineId=' + ctx.idx, limit: 1 }).then(function (j) {
                    var r = (j.items || [])[0];
                    if (r) {
                        seen = true;
                        var err = IU.first(r, ['ErrorExplanation', 'ErrorCode']), pf = String(IU.first(r, ['ProcessFlag', 'TransactionStatus']) || '');
                        if (err || /error|fail/i.test(pf)) { line.status = 'error'; line.msg = err || pf; return; }
                        if (/processed|complete|success/i.test(pf)) { line.status = 'processed'; line.msg = 'Processed into inventory'; return; }
                    } else if (seen) { line.status = 'processed'; line.msg = 'Processed into inventory (interface row cleared)'; return; }
                    line.msg = 'Submitted — pending in interface (check ' + n + '/10)'; paint();
                    if (n < 10) return new Promise(function (res) { setTimeout(res, 3000); }).then(poll);
                    line.msg = 'Submitted — still pending in interface (transaction manager not run yet)';
                }).catch(function (e) { line.msg = 'Submitted — status check failed: ' + IU.errText(e); });
            }
            return poll().then(paint);
        }, function (e) { line.status = 'error'; line.msg = IU.errText(e); paint(); });
    },
    stCell: function (l) {
        if (!l.status) return '<span class="muted">—</span>';
        var c = { pending: 'st-pend', ok: 'st-pend', processed: 'st-ok', error: 'st-err' }[l.status], ic = { pending: 'fa-circle-notch fa-spin', ok: 'fa-hourglass-half', processed: 'fa-circle-check', error: 'fa-circle-xmark' }[l.status];
        return '<span class="' + c + '"><i class="fa-solid ' + ic + '"></i> ' + esc(l.msg || l.status) + '</span>';
    }
};

function stkSearchTab(p) {
    var S = { rows: [] }, grid;
    p.innerHTML = '<div class="card"><div class="filters"><label>Organization<select id="sk-org"></select></label>' +
        '<label style="flex:1;min-width:260px">Item numbers<textarea id="sk-items" rows="2" placeholder="one per line, comma or tab separated" style="border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-family:var(--mono);font-size:.78rem;text-transform:none;font-weight:500;color:var(--ink)"></textarea></label>' +
        '<div class="go"><button class="btn primary" id="sk-go"><i class="fa-solid fa-magnifying-glass"></i> Search</button></div></div></div>' +
        '<div class="row-btns" id="sk-acts">' + Object.keys(STK.TYPES).map(function (k) { return '<button class="btn" data-tx="' + k + '"><i class="fa-solid ' + STK.TYPES[k].icon + '"></i> ' + STK.TYPES[k].btn + '</button>'; }).join('') + '<span class="muted" id="sk-sel" style="font-size:.78rem"></span><span class="grow" style="flex:1"></span><span class="muted" id="sk-note" style="font-size:.78rem"></span></div>' +
        '<div id="sk-grid" style="display:flex;flex-direction:column;flex:1;min-height:0;gap:10px"></div>';
    IU.orgOptions('sk-org', lsGet('fxinv_sk_org', ''), '— All organizations —');
    var key = function (r) { return [r.OrganizationCode, r.ItemNumber, r.SubinventoryCode, r.LocatorId || r.Locator || '', r.LotNumber || '', r.Revision || ''].join('|'); };
    grid = IU.localGrid($('sk-grid'), {
        id: 'sk', rows: function () { return S.rows; }, select: true, key: key, csvName: 'onhand', emptyText: 'Pick an organization and/or paste item numbers.',
        onSelect: function (g) { $('sk-sel').textContent = g.selectedRows().length + ' selected'; },
        kpis: function (r) { return r.length ? [{ k: 'r', label: 'Rows', value: r.length }, { k: 't', label: 'Total on-hand', value: IU.compact(r.reduce(function (s, x) { return s + STK.onh(x); }, 0)) }, { k: 'i', label: 'Items', value: IU.distinct(r.map(function (x) { return x.ItemNumber; })).length }] : []; },
        columns: [{ f: 'ItemNumber', label: 'Item', fmt: 'mono' }, { f: 'ItemDescription', label: 'Description' }, { f: 'OrganizationCode', label: 'Org' }, { f: 'SubinventoryCode', label: 'Subinventory' },
            { label: 'Locator', get: function (r) { return r.LocatorName || r.Locator; } }, { f: 'LotNumber', label: 'Lot' },
            { label: 'On-Hand', n: 1, get: STK.onh, html: function (r) { return '<span class="qty-ok">' + IU.qty(STK.onh(r)) + '</span>'; } }, { label: 'UOM', get: function (r) { return r.PrimaryUOMCode || r.ItemPrimaryUOMCode || r.UOMCode; } },
            { f: 'ConsignedQuantity', label: 'Consigned', n: 1, html: function (r) { return IU.qty(r.ConsignedQuantity); } }, { f: 'MaterialStatus', label: 'Material Status', html: function (r) { return r.MaterialStatus ? '<span class="chip ' + (/active/i.test(r.MaterialStatus) ? 'ok' : 'warn') + '">' + esc(r.MaterialStatus) + '</span>' : ''; } }]
    });
    $('sk-go').onclick = search;
    $('sk-acts').onclick = function (e) { var b = e.target.closest('[data-tx]'); if (!b) return; var sel = grid.selectedRows(); if (!sel.length) { FX.toast('Select one or more on-hand rows first.', 'err'); return; } stkTxnModal(b.getAttribute('data-tx'), sel, search); };
    function search() {
        var org = $('sk-org').value, items = IU.splitItems($('sk-items').value, 500);
        if (!org && !items.length) { FX.toast('Pick an organization or paste at least one item number.', 'err'); return; }
        lsSet('fxinv_sk_org', org); $('sk-note').textContent = ''; $('sk-sel').textContent = '';
        grid.loading('Reading on-hand…');
        var job = !items.length ? FX.get('inventoryOnhandBalances', { q: 'OrganizationCode=' + FX.qv(org), limit: 500 }).then(function (j) { if (j.hasMore) $('sk-note').innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:var(--warn)"></i> Showing the first 500 rows — narrow by item number.'; return j.items || []; })
            : IU.mapLimit(items, 6, function (it) { return FX.get('inventoryOnhandBalances', { q: (org ? 'OrganizationCode=' + FX.qv(org) + ';' : '') + 'ItemNumber=' + FX.qv(it), limit: 500 }).then(function (j) { return j.items || []; }); }, function (d, n) { grid.loading('Reading on-hand… ' + d + '/' + n + ' items'); })
                .then(function (res) { var all = []; res.forEach(function (x) { if (x.ok) all = all.concat(x.v); }); return all; });
        job.then(function (rows) { rows.sort(function (a, b) { return String(a.ItemNumber).localeCompare(b.ItemNumber); }); S.rows = rows; grid.selected = {}; grid.refresh(); }).catch(grid.error);
    }
}

function stkTxnModal(kind, sel, onDone) {
    var T = STK.TYPES[kind], isT = kind === 'transfer', posted = false;
    var lines = sel.map(function (r) { var q = STK.onh(r); return { item: r.ItemNumber, org: r.OrganizationCode, orgId: r.OrganizationId, itemId: r.InventoryItemId, fromSub: r.SubinventoryCode, toSub: '', lot: r.LotNumber || '', uom: r.PrimaryUOMCode || r.PrimaryUnitOfMeasure || r.UOMCode || '', avail: q, qty: kind === 'receipt' ? '' : q, locator: '' }; });
    var orgs = IU.distinct(lines.map(function (l) { return l.org; }));
    FX.modal({
        title: '<i class="fa-solid ' + T.icon + '"></i> ' + esc(T.btn) + ' — ' + lines.length + ' line(s)', wide: true,
        body: '<div class="filters" style="padding:0">' + STK.methodHtml() + '<label>Transaction date<input type="date" id="tm-date" value="' + FX.today() + '"></label>' +
            (isT ? '<label>Destination subinventory (all)<select id="tm-dest"><option value="">— per line —</option></select></label>' : '<label>Account (optional)<input id="tm-acct" placeholder="e.g. 01-000-1234-0000" style="min-width:220px"></label>') + '</div>' +
            (orgs.length > 1 ? '<div class="note warn"><i class="fa-solid fa-triangle-exclamation"></i> The selection spans ' + orgs.length + ' organizations (' + esc(orgs.join(', ')) + ') — each line posts against its own organization.</div>' : '') +
            '<div class="scroll"><table class="tbl" id="tm-tbl"></table></div>',
        buttons: [{ label: 'Close', act: 'close' }, { label: '<i class="fa-solid fa-paper-plane"></i> Post', cls: 'primary', act: 'post' }],
        onOpen: function () {
            if (isT) FX.fillSelect('tm-dest', FX.subinvs(lines[0].org), '', '— per line —').then(function (subs) { draw(subs); });
            draw([]);
            $('tm-tbl').addEventListener('input', function (e) { var i = e.target.closest('tr[data-i]'); if (!i) return; var l = lines[+i.getAttribute('data-i')]; l[e.target.getAttribute('data-f')] = e.target.value; });
            $('tm-tbl').addEventListener('change', function (e) { var i = e.target.closest('tr[data-i]'); if (!i) return; var l = lines[+i.getAttribute('data-i')]; l[e.target.getAttribute('data-f')] = e.target.value; });
        },
        onClose: function () { if (posted && onDone) onDone(); },
        onAction: function (a) {
            if (a !== 'post') return;
            var dest = isT ? $('tm-dest').value : '', ctx = { type: T.name, date: $('tm-date').value || FX.today(), account: isT ? '' : $('tm-acct').value.trim(), destAll: dest, hdr: Date.now() };
            var todo = lines.filter(function (l) { return !l.status && +l.qty > 0; });
            if (!todo.length) { FX.toast('Nothing to post — every line needs a quantity above 0 (lines already posted are skipped).', 'err'); return false; }
            if (isT && !dest && todo.some(function (l) { return !l.toSub; })) { FX.toast('Pick a destination subinventory (for all lines, or on every line).', 'err'); return false; }
            if (kind !== 'receipt') { var over = todo.filter(function (l) { return +l.qty > l.avail; }); if (over.length) { FX.toast(over.length + ' line(s) exceed the available quantity.', 'err'); return false; } }
            posted = true;
            todo.reduce(function (pr, l) { return pr.then(function () { return STK.post(l, Object.assign({}, ctx, { idx: lines.indexOf(l) }), function () { draw(); }); }); }, Promise.resolve()).then(function () {
                var bad = lines.filter(function (l) { return l.status === 'error'; }).length; FX.toast(bad ? bad + ' line(s) failed.' : 'Posted ' + todo.length + ' line(s).', bad ? 'err' : 'ok');
            });
            return false;
        }
    });
    var subsList = [];
    function draw(subs) {
        if (subs && subs.length) subsList = subs;
        var tb = $('tm-tbl'); if (!tb) return;
        tb.innerHTML = '<thead><tr><th>Item</th><th>Org</th><th>' + (isT ? 'From Subinv' : 'Subinventory') + '</th>' + (isT ? '<th>To Subinv</th>' : '') + '<th>Lot</th><th class="n">Avail</th><th style="width:110px">Qty</th><th>UOM</th><th>Status</th></tr></thead><tbody>' +
            lines.map(function (l, i) {
                return '<tr data-i="' + i + '"><td class="mono">' + esc(l.item) + '</td><td>' + esc(l.org) + '</td><td>' + esc(l.fromSub) + '</td>' +
                    (isT ? '<td class="ed">' + (l.org === lines[0].org && subsList.length ? '<select data-f="toSub"><option value=""></option>' + subsList.map(function (s) { return '<option' + (s.v === l.toSub ? ' selected' : '') + '>' + esc(s.v) + '</option>'; }).join('') + '</select>' : '<input data-f="toSub" value="' + esc(l.toSub) + '">') + '</td>' : '') +
                    '<td>' + esc(l.lot) + '</td><td class="n">' + IU.qty(l.avail) + '</td><td class="ed"><input type="number" min="0" step="any" data-f="qty" value="' + esc(l.qty) + '"' + (l.status ? ' disabled' : '') + (kind !== 'receipt' ? ' max="' + l.avail + '"' : '') + '></td><td>' + esc(l.uom) + '</td><td>' + STK.stCell(l) + '</td></tr>';
            }).join('') + '</tbody>';
    }
}

function stkLoadTab(p) {
    var L = { lines: [], subs: [] };
    p.innerHTML = '<div class="card"><div class="filters"><label>Organization <b style="color:var(--err)">*</b><select id="sl-org"></select></label>' +
        '<label>Transaction<select id="sl-type"><option value="receipt">Load On-Hand (misc receipt)</option><option value="issue">Issue Out (misc issue)</option></select></label>' +
        '<label>Transaction date<input type="date" id="sl-date" value="' + FX.today() + '"></label><label>Account (optional)<input id="sl-acct" placeholder="distribution account" style="min-width:200px"></label>' + STK.methodHtml() + '</div></div>' +
        '<div class="two"><div class="card pad" style="display:flex;flex-direction:column;gap:8px"><b><i class="fa-solid fa-paste" style="color:var(--accent)"></i> Paste lines</b><span class="muted" style="font-size:.76rem">Item Number, Qty, Subinventory, Lot — tab, comma or 2+ spaces.</span><textarea class="big" id="sl-paste" style="min-height:90px"></textarea><div class="row-btns"><button class="btn" id="sl-add"><i class="fa-solid fa-plus"></i> Add lines</button><button class="btn" id="sl-clear"><i class="fa-solid fa-eraser"></i> Clear</button></div></div>' +
        '<div class="card pad" id="sl-sum" style="display:flex;flex-direction:column;gap:8px"></div></div>' +
        '<div class="card"><div class="card-h"><b><i class="fa-solid fa-list"></i> Lines</b><span class="muted" id="sl-cnt"></span><span class="grow" style="flex:1"></span><button class="btn primary" id="sl-post"><i class="fa-solid fa-paper-plane"></i> Post</button></div><div style="overflow:auto;max-height:50vh"><table class="tbl" id="sl-tbl"></table></div></div>';
    IU.orgOptions('sl-org', lsGet('fxinv_sl_org', ''), '— select —').then(orgChanged);
    $('sl-org').onchange = orgChanged;
    function orgChanged() { var o = $('sl-org').value; lsSet('fxinv_sl_org', o); L.subs = []; draw(); if (o) FX.subinvs(o).then(function (s) { L.subs = s; draw(); }).catch(function () { }); }
    $('sl-add').onclick = function () {
        String($('sl-paste').value).split(/\r?\n/).forEach(function (ln) {
            if (!ln.trim() || /^\s*item/i.test(ln)) return;
            var c = ln.split(/\t|,|\s{2,}/).map(function (s) { return s.trim(); });
            L.lines.push({ item: c[0] || '', qty: c[1] || '', fromSub: c[2] || '', lot: c[3] || '' });
        });
        $('sl-paste').value = ''; draw();
    };
    $('sl-clear').onclick = function () { L.lines = []; draw(); };
    $('sl-tbl').addEventListener('input', function (e) { var tr = e.target.closest('tr[data-i]'); if (tr) L.lines[+tr.getAttribute('data-i')][e.target.getAttribute('data-f')] = e.target.value; });
    $('sl-tbl').addEventListener('change', function (e) { var tr = e.target.closest('tr[data-i]'); if (tr) L.lines[+tr.getAttribute('data-i')][e.target.getAttribute('data-f')] = e.target.value; });
    $('sl-tbl').addEventListener('click', function (e) { var b = e.target.closest('[data-del]'); if (b) { L.lines.splice(+b.getAttribute('data-del'), 1); draw(); } });
    $('sl-post').onclick = post;
    function draw() {
        $('sl-cnt').textContent = L.lines.length + ' line(s)';
        $('sl-tbl').innerHTML = L.lines.length ? '<thead><tr><th>#</th><th>Item</th><th style="width:110px">Qty</th><th>Subinventory</th><th>Lot</th><th>Status</th><th></th></tr></thead><tbody>' + L.lines.map(function (l, i) {
            var dis = l.status ? ' disabled' : '';
            return '<tr data-i="' + i + '"><td>' + (i + 1) + '</td><td class="mono">' + esc(l.item) + '</td><td class="ed"><input type="number" min="0" step="any" data-f="qty" value="' + esc(l.qty) + '"' + dis + '></td>' +
                '<td class="ed"><select data-f="fromSub"' + dis + '><option value=""></option>' + L.subs.map(function (s) { return '<option' + (s.v === l.fromSub ? ' selected' : '') + '>' + esc(s.v) + '</option>'; }).join('') + (l.fromSub && !L.subs.some(function (s) { return s.v === l.fromSub; }) ? '<option selected>' + esc(l.fromSub) + '</option>' : '') + '</select></td>' +
                '<td class="ed"><input data-f="lot" value="' + esc(l.lot) + '"' + dis + '></td><td>' + STK.stCell(l) + '</td><td><button class="btn sm icon danger" data-del="' + i + '"><i class="fa-solid fa-trash"></i></button></td></tr>';
        }).join('') + '</tbody>' : '<tbody><tr><td class="empty">Paste lines above.</td></tr></tbody>';
        var bad = L.lines.filter(function (l) { return l.status === 'error'; }), ok = L.lines.filter(function (l) { return l.status === 'processed'; }), pend = L.lines.filter(function (l) { return l.status === 'ok' || l.status === 'pending'; });
        $('sl-sum').innerHTML = '<b><i class="fa-solid fa-clipboard-check" style="color:var(--accent)"></i> Result</b>' + IU.stats([{ label: 'Lines', value: L.lines.length }, { label: 'Processed', value: ok.length, cls: 'ok' }, { label: 'Pending', value: pend.length, cls: 'warn' }, { label: 'Failed', value: bad.length, cls: bad.length ? 'err' : '' }]) +
            (bad.length ? '<div class="note err">' + bad.length + ' line(s) failed:<br>' + bad.slice(0, 8).map(function (l) { return esc(l.item + ': ' + l.msg); }).join('<br>') + '</div>' : '') + (ok.length ? '<div class="note ok">' + ok.length + ' line(s) processed</div>' : '');
    }
    function post() {
        var org = $('sl-org').value; if (!org) { FX.toast('Organization is required.', 'err'); return; }
        var kind = $('sl-type').value, T = STK.TYPES[kind];
        var todo = L.lines.filter(function (l) { return !l.status && l.item && +l.qty > 0 && l.fromSub; });
        if (!todo.length) { FX.toast('Nothing to post — lines need an item, a quantity above 0 and a subinventory (posted lines are skipped).', 'err'); return; }
        FX.confirm(T.btn, 'Post <b>' + todo.length + '</b> line(s) as <b>' + esc(T.name) + '</b> in <b>' + esc(org) + '</b>?', 'Post').then(function (ok) {
            if (!ok) return;
            todo.forEach(function (l) { l.org = org; l.status = 'pending'; l.msg = 'Reading item…'; }); draw();
            IU.mapLimit(todo.filter(function (l) { return !l.uom; }), 6, function (l) {
                return FX.get('itemsV2', { q: 'OrganizationCode=' + FX.qv(org) + ';ItemNumber=' + FX.qv(l.item), limit: 1 }).then(function (j) { var it = (j.items || [])[0]; if (it) { l.uom = IU.first(it, ['PrimaryUOMValue', 'PrimaryUnitOfMeasure', 'PrimaryUOMCode']); l.itemId = it.InventoryItemId || it.ItemId; } });
            }).then(function () {
                var ctx = { type: T.name, date: $('sl-date').value || FX.today(), account: $('sl-acct').value.trim(), hdr: Date.now() };
                return todo.reduce(function (pr, l) { return pr.then(function () { return STK.post(l, Object.assign({}, ctx, { idx: L.lines.indexOf(l) }), draw); }); }, Promise.resolve());
            }).then(function () { draw(); var bad = todo.filter(function (l) { return l.status === 'error'; }).length; FX.toast(bad ? bad + ' line(s) failed' : todo.length + ' line(s) posted', bad ? 'err' : 'ok'); });
        });
    }
    draw();
}
