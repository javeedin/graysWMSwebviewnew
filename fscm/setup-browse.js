/* Setup & Diagnostics — Browse Data: a catalogue of read-only GET services run against the pod, record counts
   (totalResults), business units found in the rows, per-BU / per-module coverage, and an ad-hoc "Run any GET"
   explorer limited to the logged-in pod's REST API. */

var SetBrowse = { res: {}, mods: ['Financials', 'Supply Chain'], kind: 'All', tab: 'services', running: false, apiLast: null };

SetBrowse.SERVICES = [
    ['ap-invoices', 'AP Invoices', 'Financials', 'Transaction', 'Payables', 'invoices', 'Payables invoices (supplier invoices)', ['BusinessUnit']],
    ['ap-payments', 'AP Payments', 'Financials', 'Transaction', 'Payables', 'payablesPayments', 'Payables payments to suppliers', ['BusinessUnit']],
    ['ap-holds', 'AP Invoice Holds', 'Financials', 'Transaction', 'Payables', 'payablesInvoiceHolds', 'Holds placed on payables invoices'],
    ['ar-invoices', 'AR Invoices', 'Financials', 'Transaction', 'Receivables', 'receivablesInvoices', 'Receivables transactions / customer invoices', ['BusinessUnit']],
    ['ar-credit-memos', 'AR Credit Memos', 'Financials', 'Transaction', 'Receivables', 'receivablesCreditMemos', 'Receivables credit memos', ['BusinessUnit']],
    ['ar-receipts', 'AR Receipts', 'Financials', 'Transaction', 'Receivables', 'standardReceipts', 'Receivables standard receipts', ['BusinessUnit']],
    ['ar-adjustments', 'AR Adjustments', 'Financials', 'Transaction', 'Receivables', 'receivablesAdjustments', 'Receivables adjustments', ['BusinessUnit']],
    ['cash-transfers', 'Bank Account Transfers', 'Financials', 'Transaction', 'Cash Mgmt', 'cashBankAccountTransfers', 'Cash management bank account transfers', ['BusinessUnit']],
    ['cash-external', 'External Cash Transactions', 'Financials', 'Transaction', 'Cash Mgmt', 'cashExternalTransactions', 'External bank / cash transactions', ['BusinessUnit']],
    ['suppliers', 'Suppliers', 'Financials', 'Master', 'Payables', 'suppliers', 'Supplier master'],
    ['customers', 'Customers', 'Financials', 'Master', 'Receivables', 'receivablesCustomerAccountSites', 'Customer account sites'],
    ['payables-options', 'Payables Options', 'Financials', 'Master', 'Payables', 'payablesOptions', 'Per-BU payables options', ['businessUnitName', 'BusinessUnitName']],
    ['business-units', 'Business Units', 'Financials', 'Master', 'Setup', 'finBusinessUnitsLOV', 'Financials business units', ['BusinessUnitName']],
    ['legal-entities', 'Legal Entities', 'Financials', 'Master', 'Setup', 'legalEntitiesLOV', 'Legal entities'],
    ['banks', 'Banks', 'Financials', 'Master', 'Cash Mgmt', 'cashBanks', 'Bank definitions'],
    ['bank-branches', 'Bank Branches', 'Financials', 'Master', 'Cash Mgmt', 'cashBankBranches', 'Bank branch definitions'],
    ['bank-accounts', 'Bank Accounts', 'Financials', 'Master', 'Cash Mgmt', 'cashBankAccounts', 'Internal bank accounts', ['BusinessUnitName']],
    ['sales-orders', 'Sales Orders', 'Supply Chain', 'Transaction', 'Order Mgmt', 'salesOrdersForOrderHub', 'Order Management sales orders', ['BusinessUnitName', 'BusinessUnit']],
    ['shipment-lines', 'Shipment Lines', 'Supply Chain', 'Transaction', 'Shipping', 'shipmentLines', 'Shipping shipment lines', ['SellingBusinessUnitName', 'RequestingBusinessUnitName', 'BusinessUnitName']],
    ['pick-slips', 'Pick Slips', 'Supply Chain', 'Transaction', 'Picking', 'pickSlipDetails', 'Warehouse picking / pick slip details', ['BusinessUnitName']],
    ['inv-reservations', 'Inventory Reservations', 'Supply Chain', 'Transaction', 'Inventory', 'inventoryReservations', 'Inventory demand/supply reservations'],
    ['inv-onhand', 'On-hand Balances', 'Supply Chain', 'Transaction', 'Inventory', 'inventoryOnhandBalances', 'Inventory on-hand quantities'],
    ['inv-transactions', 'Inventory Transactions', 'Supply Chain', 'Transaction', 'Inventory', 'inventoryCompletedTransactions', 'Completed inventory material transactions'],
    // SoldToLegalEntity is a legal entity, not a business unit — left out of the BU fields (source bug).
    ['purchase-orders', 'Purchase Orders', 'Supply Chain', 'Transaction', 'Procurement', 'purchaseOrders', 'Procurement purchase orders', ['ProcurementBUName', 'RequisitioningBUName']],
    ['purchase-requisitions', 'Purchase Requisitions', 'Supply Chain', 'Transaction', 'Procurement', 'purchaseRequisitions', 'Self-service / purchase requisitions', ['RequisitioningBUName']],
    ['receiving-receipts', 'Receiving Receipts', 'Supply Chain', 'Transaction', 'Receiving', 'receivingReceiptRequests', 'Receiving receipt requests', ['BusinessUnitName']],
    ['items', 'Items', 'Supply Chain', 'Master', 'Product', 'itemsV2', 'Item master (product information management)'],
    ['inv-organizations', 'Inventory Organizations', 'Supply Chain', 'Master', 'Inventory', 'inventoryOrganizations', 'Inventory / plant organizations', ['ManagementBusinessUnitName', 'BusinessUnitName']],
    ['subinventories', 'Subinventories', 'Supply Chain', 'Master', 'Inventory', 'subinventories', 'Subinventory definitions'],
    ['price-lists', 'Price Lists', 'Supply Chain', 'Master', 'Pricing', 'priceLists', 'Pricing price lists']
].map(function (a) { return { key: a[0], label: a[1], module: a[2], kind: a[3], area: a[4], resource: a[5], description: a[6], buFields: a[7] || [] }; });

SetBrowse.PAGE = 500; SetBrowse.SCAN_MAX = 1500;
SetBrowse.BU_KEY_RE = /(^|_)business_?unit(_?name)?$|bu_?name$|bunit$/i;
SetBrowse.svcUrl = function (s) { return SU.root() + s.resource + '?onlyData=true&totalResults=true&limit=500'; };
SetBrowse.buValuesOf = function (rec, extra) {
    var out = {};
    Object.keys(rec || {}).forEach(function (k) {
        var v = rec[k]; if (v == null || v === '' || typeof v === 'object') return;
        if (!SetBrowse.BU_KEY_RE.test(k) && extra.indexOf(k) < 0) return;
        v = String(v).trim(); if (v && !/^\d+$/.test(v) && v.length < 120) out[v] = 1;
    });
    return Object.keys(out);
};
/** Count + BU scan of one service (first 1,500 rows). */
SetBrowse.runService = function (s) {
    var total = null, scanned = 0, bus = {}, sample = [], more = false;
    function page(off) {
        return FX.get(s.resource, { limit: SetBrowse.PAGE, offset: off, total: true }).then(function (j) {
            var items = j.items || [];
            if (off === 0) { total = typeof j.totalResults === 'number' ? j.totalResults : null; sample = items.slice(0, 5); }
            items.forEach(function (r) { SetBrowse.buValuesOf(r, s.buFields).forEach(function (b) { bus[b] = 1; }); });
            scanned += items.length; more = !!j.hasMore;
            if (j.hasMore && items.length >= SetBrowse.PAGE && scanned < SetBrowse.SCAN_MAX) return page(off + items.length);
        });
    }
    return page(0).then(function () {
        var count = total != null ? total : scanned;
        return { status: count > 0 ? 'success' : 'empty', count: count, countPlus: total == null && more, scanned: scanned, bus: Object.keys(bus).sort(), sample: sample, url: SetBrowse.svcUrl(s) };
    }, function (e) { return { status: 'error', error: String(e), url: SetBrowse.svcUrl(s) }; });
};

SetBrowse.selected = function () {
    return SetBrowse.SERVICES.filter(function (s) { return SetBrowse.mods.indexOf(s.module) >= 0 && (SetBrowse.kind === 'All' || (SetBrowse.kind === 'Transactions' ? s.kind === 'Transaction' : s.kind === 'Master')); });
};
SetBrowse.finished = function () { return SetBrowse.SERVICES.filter(function (s) { var r = SetBrowse.res[s.key]; return r && r.status !== 'running'; }); };

// ── coverage model ─────────────────────────────────────────────
SetBrowse.coverage = function () {
    var withData = SetBrowse.SERVICES.filter(function (s) { var r = SetBrowse.res[s.key]; return r && r.status === 'success'; });
    var map = {};
    withData.forEach(function (s) { SetBrowse.res[s.key].bus.forEach(function (b) { (map[b] = map[b] || { bu: b, cells: {}, mods: {} }).cells[s.key] = true; map[b].mods[s.module] = 1; }); });
    var rows = Object.keys(map).map(function (b) { var r = map[b]; r.serviceCount = Object.keys(r.cells).length; r.modules = Object.keys(r.mods).sort(); return r; })
        .sort(function (a, b) { return b.serviceCount - a.serviceCount || a.bu.localeCompare(b.bu); });
    var mods = ['Financials', 'Supply Chain'].map(function (m) {
        var all = SetBrowse.SERVICES.filter(function (s) { return s.module === m; });
        var ran = all.filter(function (s) { var r = SetBrowse.res[s.key]; return r && r.status !== 'running'; });
        var wd = withData.filter(function (s) { return s.module === m; }), bus = {};
        wd.forEach(function (s) { SetBrowse.res[s.key].bus.forEach(function (b) { bus[b] = 1; }); });
        return { module: m, total: all.length, ran: ran.length, withData: wd.length, records: wd.reduce(function (a, s) { return a + (SetBrowse.res[s.key].count || 0); }, 0), bus: Object.keys(bus).length };
    });
    return { withData: withData, rows: rows, mods: mods, ranCount: SetBrowse.finished().length };
};

// ── render ─────────────────────────────────────────────────────
SetBrowse.render = function (el) {
    SetBrowse.el = el;
    SU.headRight('<span class="muted" style="font-size:.76rem">GET only · ' + esc(FX.instance) + ' pod</span>');
    el.innerHTML = '<div class="card su-bar-card"><div class="su-row">' +
        '<div class="su-checks" id="sb-mods">' + ['Financials', 'Supply Chain'].map(function (m) { return '<label><input type="checkbox" value="' + m + '"' + (SetBrowse.mods.indexOf(m) >= 0 ? ' checked' : '') + '> ' + SU.modTag(m) + '</label>'; }).join('') + '</div>' +
        '<span id="sb-kind">' + SU.seg(['All', 'Transactions', 'Masters'], SetBrowse.kind, 'sbk') + '</span>' +
        '<button class="btn primary" id="sb-run"><i class="fa-solid fa-play"></i> Run services <span class="su-badge light" id="sb-n"></span></button>' +
        '<span class="muted" id="sb-prog"></span><span class="grow"></span>' +
        '<span id="sb-after"></span></div></div>' +
        '<div id="sb-tabs"></div><div id="sb-body" class="su-fill"></div>';
    $('sb-mods').onchange = function () { SetBrowse.mods = Array.prototype.map.call($('sb-mods').querySelectorAll('input:checked'), function (i) { return i.value; }); SetBrowse.drawTop(); SetBrowse.drawTab(); };
    $('sb-kind').onclick = function (e) { var b = e.target.closest('[data-sbk]'); if (!b) return; SetBrowse.kind = b.getAttribute('data-sbk'); $('sb-kind').innerHTML = SU.seg(['All', 'Transactions', 'Masters'], SetBrowse.kind, 'sbk'); SetBrowse.drawTop(); SetBrowse.drawTab(); };
    $('sb-run').onclick = SetBrowse.runSelected;
    $('sb-tabs').onclick = function (e) { var b = e.target.closest('[data-sutab]'); if (b) { SetBrowse.tab = b.getAttribute('data-sutab'); SetBrowse.drawTab(); } };
    SetBrowse.drawTop(); SetBrowse.drawTab();
};
SetBrowse.drawTop = function () {
    if (!$('sb-n')) return;
    $('sb-n').textContent = SetBrowse.selected().length;
    $('sb-run').disabled = SetBrowse.running;
    var any = SetBrowse.finished().length;
    $('sb-after').innerHTML = any ? '<button class="btn sm" id="sb-xlsx"><i class="fa-solid fa-file-excel"></i> Excel</button> <button class="btn sm" id="sb-pdf"><i class="fa-solid fa-file-pdf"></i> PDF report</button> <button class="btn sm danger" id="sb-reset"><i class="fa-solid fa-eraser"></i> Reset</button>' : '';
    if (any) { $('sb-xlsx').onclick = SetBrowse.excel; $('sb-pdf').onclick = SetBrowse.pdf; $('sb-reset').onclick = function () { if (SetBrowse.running) return; SetBrowse.res = {}; $('sb-prog').textContent = ''; SetBrowse.drawTop(); SetBrowse.drawTab(); }; }
};
SetBrowse.drawTab = function () {
    if (!$('sb-tabs')) return;
    var cov = SetBrowse.finished().length;
    var tabs = [{ id: 'services', label: 'Services', icon: 'fa-list-check', badge: SetBrowse.selected().length }];
    if (cov) tabs.push({ id: 'coverage', label: 'BU & Module Coverage', icon: 'fa-table-cells' });
    tabs.push({ id: 'api', label: 'API Explorer', icon: 'fa-code' });
    if (SetBrowse.tab === 'coverage' && !cov) SetBrowse.tab = 'services';
    $('sb-tabs').innerHTML = SU.tabBar(tabs, SetBrowse.tab);
    var body = $('sb-body');
    if (SetBrowse.tab === 'services') SetBrowse.drawServices(body);
    else if (SetBrowse.tab === 'coverage') SetBrowse.drawCoverage(body);
    else SetBrowse.drawApi(body);
};

SetBrowse.statusHtml = function (r) {
    if (!r) return '<span class="su-st none"><i class="fa-regular fa-circle"></i> Not run</span>';
    if (r.status === 'running') return '<span class="su-st run"><i class="fa-solid fa-circle-notch fa-spin"></i> Running…</span>';
    if (r.status === 'success') return '<span class="su-st ok"><i class="fa-solid fa-circle-check"></i> Has data</span>';
    if (r.status === 'empty') return '<span class="su-st none"><i class="fa-solid fa-circle-minus"></i> No data</span>';
    return '<span class="su-st err" title="' + esc(r.error) + '"><i class="fa-solid fa-circle-xmark"></i> Error</span>';
};
SetBrowse.kindTag = function (k) { return '<span class="chip ' + (k === 'Transaction' ? 'done' : 'warn') + '">' + esc(k) + '</span>'; };
SetBrowse.drawServices = function (body) {
    var R = function (s) { return SetBrowse.res[s.key]; };
    SetBrowse.svcTable = SU.table(body, {
        rows: SetBrowse.selected(), pageSize: 25, quickPh: 'Search service, resource or area…',
        columns: [
            { k: 'label', label: 'Service', html: function (s) { return '<b>' + esc(s.label) + '</b> <span class="chip">' + esc(s.area) + '</span><div class="muted mono" style="font-size:.7rem">' + esc(s.resource) + '</div>'; }, get: function (s) { return s.label + ' ' + s.resource + ' ' + s.area; } },
            { k: 'module', label: 'Module', html: function (s) { return SU.modTag(s.module); } },
            { k: 'kind', label: 'Type', html: function (s) { return SetBrowse.kindTag(s.kind); } },
            { k: 'status', label: 'Status', get: function (s) { var r = R(s); return r ? r.status : ''; }, html: function (s) { return '<a class="su-a" data-sbopen="' + s.key + '">' + SetBrowse.statusHtml(R(s)) + '</a>'; } },
            { k: 'count', label: 'Records', n: true, get: function (s) { var r = R(s); return r && r.status !== 'error' ? r.count : null; }, html: function (s) { var r = R(s); if (!r) return '<span class="muted">—</span>'; if (r.status === 'running') return '<i class="fa-solid fa-circle-notch fa-spin muted"></i>'; if (r.status === 'error') return '<span class="chip err">error</span>'; return '<b>' + SU.num(r.count) + (r.countPlus ? '+' : '') + '</b>'; } },
            { k: 'bus', label: 'Business Units', get: function (s) { var r = R(s); return r && r.bus ? r.bus.length : null; }, html: function (s) { var r = R(s); if (!r || !r.bus) return '<span class="muted">—</span>'; if (!r.bus.length) return r.status === 'success' ? '<span class="muted">n/a</span>' : '<span class="muted">—</span>'; return '<span class="chip info" title="' + esc(r.bus.join('\n')) + '">' + r.bus.length + ' BU' + (r.bus.length > 1 ? 's' : '') + '</span>'; } },
            { k: 'x', label: '', html: function (s) { return '<button class="btn sm" data-sbopen="' + s.key + '"><i class="fa-solid fa-up-right-from-square"></i> Open</button>'; } }
        ]
    });
    body.onclick = function (e) { var b = e.target.closest('[data-sbopen]'); if (b) SetBrowse.dialog(SetBrowse.SERVICES.filter(function (s) { return s.key === b.getAttribute('data-sbopen'); })[0]); };
};

SetBrowse.runSelected = function () {
    if (!SetBrowse.mods.length) { FX.toast('Choose at least one module.', 'err'); return; }
    var list = SetBrowse.selected(); if (!list.length) return;
    SetBrowse.running = true;
    list.forEach(function (s) { SetBrowse.res[s.key] = { status: 'running' }; });
    var done = 0;
    function prog() { if ($('sb-prog')) $('sb-prog').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Ran ' + done + '/' + list.length + ' services…'; }
    prog(); SetBrowse.drawTop(); SetBrowse.redraw();
    SU.mapLimit(list, 4, function (s) {
        return SetBrowse.runService(s).then(function (r) { SetBrowse.res[s.key] = r; done++; prog(); SetBrowse.redraw(); });
    }).then(function () {
        SetBrowse.running = false;
        if ($('sb-prog')) $('sb-prog').textContent = 'Ran ' + list.length + ' services · ' + list.filter(function (s) { return SetBrowse.res[s.key].status === 'success'; }).length + ' with data';
        FX.toast('Data scan complete.', 'ok');
        if (FX.cur && FX.cur.id === 'browse') { SetBrowse.tab = 'coverage'; SetBrowse.drawTop(); SetBrowse.drawTab(); }
    });
};
/** Redraw whatever is on screen after a result arrives (the view may have been left meanwhile). */
SetBrowse.redraw = function () {
    if (!FX.cur || FX.cur.id !== 'browse' || !$('sb-body')) return;
    SetBrowse.drawTop();
    if (SetBrowse.tab === 'services' && SetBrowse.svcTable) SetBrowse.svcTable.render();
    else if (SetBrowse.tab === 'coverage') SetBrowse.drawTab();
};

// ── service dialog ─────────────────────────────────────────────
SetBrowse.dialog = function (s) {
    if (!s) return;
    function body() {
        var r = SetBrowse.res[s.key], url = SetBrowse.svcUrl(s);
        var h = '<div class="su-row">' + SU.modTag(s.module) + SetBrowse.kindTag(s.kind) + '<span class="chip">' + esc(s.area) + '</span><span class="muted">' + esc(s.description) + '</span></div>' +
            '<div class="su-url"><span>Web service (GET)</span><code>' + esc(url) + '</code><button class="btn sm" data-mact="copy"><i class="fa-regular fa-copy"></i></button></div>';
        if (!r) h += '<div class="note">Not run yet. <b>Run service</b> counts its records and finds the business units in the first 1,500 rows.</div>';
        else if (r.status === 'running') h += SU.loading('Running…');
        else if (r.status === 'error') h += SU.err(r.error);
        else {
            h += '<div class="kpis">' + SU.kpi(SU.num(r.count) + (r.countPlus ? '+' : ''), 'Records', r.count ? 'ok' : '') + SU.kpi(r.bus.length, 'Business units') + SU.kpi(SetBrowse.statusHtml(r), 'Status') + '</div>';
            if (r.count > r.scanned && r.scanned >= SetBrowse.SCAN_MAX) h += '<div class="note">Business units sampled from the first ' + SU.num(r.scanned) + ' of ' + SU.num(r.count) + ' records.</div>';
            if (r.bus.length) h += '<div class="su-chips">' + r.bus.map(function (b) { return '<span class="chip info">' + esc(b) + '</span>'; }).join('') + '</div>';
            var js = JSON.stringify(r.sample, null, 2);
            h += '<details class="su-det"><summary>Sample response (' + r.sample.length + ' records)</summary><pre class="json">' + esc(js.length > 12000 ? js.slice(0, 12000) + '\n…' : js) + '</pre></details>';
        }
        return h;
    }
    FX.modal({
        title: '<i class="fa-solid fa-database" style="color:var(--accent)"></i> ' + esc(s.label), wide: true, body: body(),
        buttons: [{ label: '<i class="fa-solid fa-play"></i> Run service', cls: 'primary', act: 'run' }, { label: 'Close', act: 'close' }],
        onAction: function (a, box) {
            if (a === 'copy') { SU.copy(SetBrowse.svcUrl(s)); return false; }
            if (a === 'run') {
                SetBrowse.res[s.key] = { status: 'running' }; box.querySelector('.modal-b').innerHTML = body(); SetBrowse.redraw();
                SetBrowse.runService(s).then(function (r) { SetBrowse.res[s.key] = r; if (document.body.contains(box) && box.querySelector('.modal-b')) box.querySelector('.modal-b').innerHTML = body(); SetBrowse.redraw(); });
                return false;
            }
        }
    });
};

// ── coverage tab ───────────────────────────────────────────────
SetBrowse.drawCoverage = function (body) {
    var c = SetBrowse.coverage();
    var h = '<div class="su-cards">' +
        '<div class="card su-mcard acc"><div class="su-mc-h"><i class="fa-solid fa-building"></i> Business units with data</div><b class="big">' + c.rows.length + '</b><span class="muted">Across ' + c.withData.length + ' services that returned data</span></div>' +
        c.mods.map(function (m) {
            var p = SU.pct(m.withData, m.ran);
            return '<div class="card su-mcard ' + SU.MOD_CLS[m.module] + '"><div class="su-mc-h">' + SU.modTag(m.module) + '<span class="grow"></span><b>' + p + '%</b></div>' +
                '<b class="big">' + m.withData + ' <small>/ ' + m.total + '</small></b><span class="muted">services with data · ' + m.ran + ' ran</span>' + SU.bar(p, SU.MOD_CLS[m.module]) +
                '<div class="su-mc-f"><span><b>' + SU.num(m.records) + '</b> records</span><span><b>' + m.bus + '</b> BUs</span></div></div>';
        }).join('') + '</div><div class="card su-fill" id="sb-matrix"></div>';
    body.innerHTML = h;
    if (!c.withData.length) { $('sb-matrix').innerHTML = SU.empty('fa-table-cells', 'No service returned data yet', 'Run the services to see which business units have data where.'); return; }
    var nW = c.withData.length;
    var cols = [
        { k: 'bu', label: 'Business Unit', w: 200, cls: 'su-sticky', thCls: 'su-sticky', html: function (r) { return '<b>' + esc(r.bu) + '</b>'; } },
        { k: 'modules', label: 'Modules', get: function (r) { return r.modules.join(' '); }, html: function (r) { return r.modules.map(function (m) { return '<span class="su-mod sm ' + SU.MOD_CLS[m] + '">' + (m === 'Financials' ? 'FIN' : 'SCM') + '</span>'; }).join(' '); } },
        { k: 'serviceCount', label: 'Services', w: 120, html: function (r) { return '<div class="su-nb"><b>' + r.serviceCount + '/' + nW + '</b>' + SU.bar(SU.pct(r.serviceCount, nW)) + '</div>'; } }
    ].concat(c.withData.map(function (s) {
        var n = SetBrowse.res[s.key].bus.length;
        return { k: 'svc_' + s.key, label: s.label, title: s.label + ' (' + s.resource + ') — ' + n + ' BUs', th: '<span class="su-vh">' + esc(SU.trunc(s.label, 14)) + '</span><span class="su-cnt">✓ ' + n + '</span>', thCls: 'su-mx-h', cls: 'su-mx',
            get: function (r) { return r.cells[s.key] ? 1 : 0; }, html: function (r) { return r.cells[s.key] ? '<i class="fa-solid fa-check su-yes"></i>' : '<span class="su-no">·</span>'; } };
    }));
    SU.table($('sb-matrix'), { rows: c.rows, columns: cols, pageSize: 50, quickPh: 'Search business unit…', sort: { k: 'serviceCount', d: -1 }, empty: 'No business units were found in the returned rows.',
        toolbar: '<span class="chip info">' + c.rows.length + ' BUs</span><span class="chip">' + nW + ' services with data</span>' });
};

// ── API explorer ───────────────────────────────────────────────
SetBrowse.drawApi = function (body) {
    body.innerHTML = '<div class="card pad"><div class="card-t"><i class="fa-solid fa-terminal"></i> Run any GET</div>' +
        '<div class="su-row"><input id="sb-get" class="su-in grow mono" placeholder="resource path or full URL — e.g. salesOrdersForOrderHub?q=OrderNumber=\'123\'" value="' + esc(SetBrowse.apiPath || '') + '">' +
        '<button class="btn primary" id="sb-go"><i class="fa-solid fa-play"></i> GET</button></div>' +
        '<div class="muted" style="font-size:.74rem;margin-top:6px">Base: <span class="mono">' + esc(SU.root()) + '</span> · Auth: the app\'s Fusion login (kept in the app) · read-only GET on this pod only</div>' +
        '<div id="sb-out"></div></div>' +
        '<div class="card su-fill" id="sb-all"></div>';
    var go = function () {
        var v = $('sb-get').value.trim(); if (!v) return;
        SetBrowse.apiPath = v;
        var url = /^https?:\/\//i.test(v) ? v : SU.root() + v.replace(/^\//, '');
        if (!/[?&]limit=/.test(url)) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'onlyData=true&limit=100';
        url = url.replace(/ /g, '%20');
        $('sb-out').innerHTML = SU.loading('GET…');
        SU.raw(url).then(function (r) {
            SetBrowse.apiLast = { url: url, r: r };
            SetBrowse.drawApiOut();
        }).catch(function (e) { $('sb-out').innerHTML = '<div style="margin-top:10px">' + SU.err(e) + '</div>'; });
    };
    $('sb-go').onclick = go;
    $('sb-get').onkeydown = function (e) { if (e.key === 'Enter') go(); };
    if (SetBrowse.apiLast) SetBrowse.drawApiOut();
    SU.table($('sb-all'), {
        rows: SetBrowse.SERVICES, pageSize: 50, quickPh: 'Search services…',
        toolbar: '<b style="font-size:.82rem"><i class="fa-solid fa-list" style="color:var(--accent)"></i> All REST GET services</b>',
        columns: [
            { k: 'label', label: 'Service', html: function (s) { return '<b>' + esc(s.label) + '</b><div class="muted" style="font-size:.72rem">' + esc(s.description) + '</div>'; }, get: function (s) { return s.label + ' ' + s.description; } },
            { k: 'module', label: 'Module', html: function (s) { return SU.modTag(s.module); } },
            { k: 'kind', label: 'Type', html: function (s) { return SetBrowse.kindTag(s.kind); } },
            { k: 'resource', label: 'GET endpoint', html: function (s) { return '<span class="mono">/' + esc(s.resource) + '</span> <button class="btn sm icon" data-sbcopy="' + s.key + '" title="Copy full URL"><i class="fa-regular fa-copy"></i></button>'; } },
            { k: 'x', label: '', html: function (s) { return '<button class="btn sm" data-sbopen="' + s.key + '"><i class="fa-solid fa-play"></i> Run</button> <button class="btn sm" data-sbtry="' + s.key + '" title="Put in Run any GET"><i class="fa-solid fa-terminal"></i></button>'; } }
        ]
    });
    body.onclick = function (e) {
        var b = e.target.closest('[data-sbopen],[data-sbcopy],[data-sbtry]'); if (!b) return;
        var k = b.getAttribute('data-sbopen') || b.getAttribute('data-sbcopy') || b.getAttribute('data-sbtry');
        var s = SetBrowse.SERVICES.filter(function (x) { return x.key === k; })[0];
        if (b.hasAttribute('data-sbopen')) SetBrowse.dialog(s);
        else if (b.hasAttribute('data-sbcopy')) SU.copy(SetBrowse.svcUrl(s));
        else { $('sb-get').value = s.resource + '?limit=25'; $('sb-get').focus(); }
    };
};
SetBrowse.drawApiOut = function () {
    var a = SetBrowse.apiLast, r = a.r; if (!$('sb-out')) return;
    var j = r.json, txt = j ? JSON.stringify(j, null, 2) : r.body;
    var rowsInfo = j && Array.isArray(j.items) ? '<span class="chip info">' + j.items.length + ' rows' + (j.totalResults != null ? ' of ' + SU.num(j.totalResults) : j.hasMore ? ' (more available)' : '') + '</span>' : '';
    $('sb-out').innerHTML = '<div class="su-row" style="margin-top:10px"><span class="chip ' + (r.ok ? 'ok' : 'err') + '">' + (r.ok ? 'OK' : 'FAILED') + ' · HTTP ' + r.status + '</span>' + rowsInfo + '<span class="muted">' + r.ms + ' ms</span>' +
        '<code class="su-code grow">' + esc(a.url) + '</code><button class="btn sm" id="sb-cu"><i class="fa-regular fa-copy"></i> URL</button>' + (j && Array.isArray(j.items) && j.items.length ? '<button class="btn sm" id="sb-csv"><i class="fa-solid fa-file-csv"></i> CSV</button>' : '') + '</div>' +
        '<pre class="json" style="margin-top:8px;max-height:46vh">' + esc(txt.length > 20000 ? txt.slice(0, 20000) + '\n… (truncated at 20,000 characters)' : txt) + '</pre>';
    $('sb-cu').onclick = function () { SU.copy(a.url); };
    if ($('sb-csv')) $('sb-csv').onclick = function () {
        var keys = []; j.items.forEach(function (it) { Object.keys(it).forEach(function (k) { if (k !== 'links' && keys.indexOf(k) < 0 && (it[k] == null || typeof it[k] !== 'object')) keys.push(k); }); });
        FX.csv(j.items, keys.map(function (k) { return { f: k, label: k }; }), 'fusion_get');
    };
};

// ── exports ────────────────────────────────────────────────────
SetBrowse.statusText = function (r) { return r.status === 'success' ? 'Has data' : r.status === 'empty' ? 'No data' : 'Error'; };
SetBrowse.excel = function () {
    var fin = SetBrowse.finished(); if (!fin.length) { FX.toast('Run the services first.', 'err'); return; }
    var c = SetBrowse.coverage();
    var mx = [['Business Unit', 'Modules', 'Services Done'].concat(c.withData.map(function (s) { return s.label; }))];
    mx.push(['BUs →', '', ''].concat(c.withData.map(function (s) { return SetBrowse.res[s.key].bus.length; })));
    c.rows.forEach(function (r) { mx.push([r.bu, r.modules.map(function (m) { return m === 'Financials' ? 'FIN' : 'SCM'; }).join(' '), r.serviceCount + '/' + c.withData.length].concat(c.withData.map(function (s) { return r.cells[s.key] ? '✓' : ''; }))); });
    SU.xlsx('data-coverage-' + FX.today(), [
        { name: 'Module Summary', aoa: SU.aoa(c.mods, [{ label: 'Module', k: 'module' }, { label: 'Services with data', k: 'withData' }, { label: 'Ran', k: 'ran' }, { label: 'Total', k: 'total' }, { label: 'Records', k: 'records' }, { label: 'BUs', k: 'bus' }]) },
        { name: 'Service Results', aoa: SU.aoa(fin, [{ label: 'Service', k: 'label' }, { label: 'Resource', k: 'resource' }, { label: 'Module', k: 'module' }, { label: 'Type', k: 'kind' },
            { label: 'Status', get: function (s) { return SetBrowse.statusText(SetBrowse.res[s.key]); } }, { label: 'Records', get: function (s) { var r = SetBrowse.res[s.key]; return r.status === 'error' ? '' : r.count; } },
            { label: 'Business Units', get: function (s) { var r = SetBrowse.res[s.key]; return r.bus ? r.bus.length : ''; } }, { label: 'Error', get: function (s) { return SetBrowse.res[s.key].error || ''; } }]) },
        { name: 'BU x Service', aoa: mx, freeze: { xSplit: 3, ySplit: 2 } }
    ]);
};
SetBrowse.pdf = function () {
    var fin = SetBrowse.finished(); if (!fin.length) { FX.toast('Run the services first.', 'err'); return; }
    var c = SetBrowse.coverage(), nW = c.withData.length;
    var h = '<h1>Fusion Data Coverage — Summary Report</h1><div class="meta">Generated ' + esc(new Date().toLocaleString()) + ' · pod ' + esc(FX.instance) + ' · ' + esc(FX.user) + '<br>' +
        '<b>' + c.rows.length + '</b> business units with data · <b>' + nW + '</b> services with data · <b>' + c.ranCount + '</b> services run</div>' +
        '<h2>Module summary</h2>' + SU.ptable(c.mods, [{ label: 'Module', k: 'module' }, { label: 'Services with data', k: 'withData', n: 1 }, { label: 'Ran', k: 'ran', n: 1 }, { label: 'Total', k: 'total', n: 1 }, { label: 'Records', n: 1, get: function (m) { return m.records.toLocaleString(); } }, { label: 'BUs', k: 'bus', n: 1 }]) +
        '<h2>Service results</h2>' + SU.ptable(fin, [{ label: 'Service', k: 'label' }, { label: 'Module', k: 'module' }, { label: 'Type', k: 'kind' },
            { label: 'Status', get: function (s) { return SetBrowse.statusText(SetBrowse.res[s.key]); }, cls: function (s) { var st = SetBrowse.res[s.key].status; return st === 'success' ? 'ok' : st === 'error' ? 'err' : 'muted'; } },
            { label: 'Records', n: 1, get: function (s) { var r = SetBrowse.res[s.key]; return r.status === 'error' ? '' : (r.count || 0).toLocaleString(); } }, { label: 'BUs', n: 1, get: function (s) { var r = SetBrowse.res[s.key]; return r.bus ? r.bus.length : ''; } }]) +
        '<h2>Business Unit data coverage (' + c.rows.length + ' BUs)</h2>' + SU.ptable(c.rows, [{ label: 'Business Unit', k: 'bu' }, { label: 'Modules', get: function (r) { return r.modules.join(', '); } }, { label: 'Services', n: 1, get: function (r) { return r.serviceCount + '/' + nW; } }]);
    if (c.rows.length && nW) {
        var mrows = [{ bu: 'BUs with data →', _cls: 'cnt', cells: null }].concat(c.rows);
        h += '<section class="land"><h2>Business Unit × Service coverage</h2>' + SU.ptable(mrows, [{ label: 'Business Unit', h: 1, cls: 'l', get: function (r) { return r.bu; } }]
            .concat(c.withData.map(function (s) { return { label: s.label, get: function (r) { return r.cells ? (r.cells[s.key] ? '✓' : '') : SetBrowse.res[s.key].bus.length; } }; })), 'mx') + '</section>';
    }
    SU.print('data-coverage-summary-' + FX.today(), h, 'Gray\'s WMS · Browse Data');
};
