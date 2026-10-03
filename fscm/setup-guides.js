/* Setup & Diagnostics — reference pages: Fusion architecture, parallel run / UAT strategy, and Login History
   (identity-domain sign-in audit — not reachable through the app's Fusion relay yet, so the view explains what is needed). */

var SetGuide = {};

SetGuide.layer = function (c, icon, title, sub, chips) {
    return '<div class="su-layer" style="--c:' + c + '"><div class="su-layer-h"><span class="su-lic"><i class="fa-solid ' + icon + '"></i></span><div><b>' + title + '</b><span>' + sub + '</span></div></div>' +
        (chips && chips.length ? '<div class="su-gchips">' + chips.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>' : '') + '</div>';
};
SetGuide.arrow = '<div class="su-down"><i class="fa-solid fa-arrow-down"></i></div>';

SetGuide.architecture = function (el) {
    var mods = [
        ['#c2410c', 'fa-cart-flatbed', 'Order Management', ['Sales orders (Order Hub)', 'POS sales order', 'Customers', 'Shipment lines · picks']],
        ['#1d4ed8', 'fa-file-invoice', 'Purchasing', ['Purchase orders', 'Receipts · ASN · returns', 'Suppliers', 'PO life cycle']],
        ['#047857', 'fa-boxes-stacked', 'Inventory', ['Items · on-hand', 'Transfer orders', 'Subinventories', 'Completed transactions']],
        ['#b45309', 'fa-coins', 'Costing', ['Item cost', 'Receipt cost', 'Cost processes']],
        ['#6d28d9', 'fa-screwdriver-wrench', 'Setup & Diagnostics', ['Business units · legal entities', 'Setup data · coverage', 'UAT diagnostics · COA']],
        ['#0f766e', 'fa-file-import', 'Data Loading', ['FBDI templates (Journals, AP, PO …)', 'Fusion REST loads', 'Setup projects (FSM)']]
    ];
    var txn = [['POST', 'supplyRequests', 'Create transfer orders (SCO)'], ['POST', 'pickWaves', 'Pick release shipment lines'], ['POST', 'pickTransactions', 'Confirm picks (lot / serial)'],
        ['POST', 'shippingTransactions', 'Ship confirm'], ['GET', 'salesOrdersForOrderHub', 'Query orders, lines & totals'], ['GET', 'itemCosts · receiptCosts', 'Costing analytics']];
    el.innerHTML = '<div class="su-doc">' +
        '<div class="card pad su-hero"><p><b>Gray\'s WMS</b> works on <b>Oracle Fusion Cloud</b> directly through its published <b>REST APIs</b>. The pages are thin: every Fusion screen reads and writes live Fusion data, so what you see is the system of record. ' +
        'The Windows app (WebView2 host) holds the Fusion login and makes the calls — the pages never see a password. APEX keeps only the app\'s own data (saved queries, load history, audit).</p>' +
        '<div class="su-gchips"><span><i class="fa-solid fa-display"></i> WebView2 host · plain JavaScript</span><span><i class="fa-solid fa-shield-halved"></i> Credentials stay in the app</span><span><i class="fa-solid fa-plug"></i> Oracle Fusion REST (fscmRestApi)</span><span><i class="fa-solid fa-bolt"></i> Query &amp; transact</span><span><i class="fa-solid fa-database"></i> APEX side store</span></div></div>' +
        '<h3>End-to-end flow</h3><div class="su-stack">' +
        SetGuide.layer('#7c3aed', 'fa-lock', '1 · Sign-in', 'App login; the Fusion user and password are kept by the Windows app, not in the pages', ['App login per user', 'Fusion credentials held by the host', 'PROD / TEST pod switch']) + SetGuide.arrow +
        SetGuide.layer('#2563eb', 'fa-display', '2 · Pages (WebView2)', 'Module home → views → drawers and dialogs, plain JavaScript', ['Search &amp; filter grids', 'Drill-down drawers', 'Excel load &amp; validate', 'Print / PDF']) + SetGuide.arrow +
        SetGuide.layer('#0f766e', 'fa-route', '3 · Host relay (C#)', 'The only way out of the page: allow-listed actions with the Fusion login added by the app', ['dataLoadFusionRest — GET / POST / PATCH on …/fscmRestApi/resources/', 'omBip — BI Publisher reports under /Custom/', 'fusionSqlExecute — read-only SQL', 'Paging (limit / offset) · fan-out with a concurrency limit · child links']) + SetGuide.arrow +
        SetGuide.layer('#c2410c', 'fa-cloud', '4 · Oracle Fusion Cloud REST API', 'fscmRestApi/resources — the same services Oracle\'s own pages use', ['Resources &amp; child collections', 'Filters (q=…), finders, fields', 'GET reads · POST / PATCH transactions']) + SetGuide.arrow +
        SetGuide.layer('#15803d', 'fa-database', '5 · Fusion Cloud system of record', 'Purchasing · Inventory · Costing · Order Management · Receivables · Payables') + '</div>' +
        '<h3>Modules covered</h3><div class="su-gcards">' + mods.map(function (m) {
            return '<div class="card su-gcard" style="--c:' + m[0] + '"><div class="su-gcard-h"><span><i class="fa-solid ' + m[1] + '"></i></span><b>' + m[2] + '</b></div>' + m[3].map(function (i) { return '<div class="su-gi"><i class="fa-solid fa-circle-check"></i>' + i + '</div>'; }).join('') + '</div>';
        }).join('') + '</div>' +
        '<h3>Fully transactional — not just reporting</h3><div class="card pad"><p class="muted">The same REST layer that reads data also <b>creates and progresses transactions</b>: raise a transfer, release it for picking, confirm the pick with lot and serial detail and ship-confirm — all from these pages.</p>' +
        '<div class="su-txn">' + txn.map(function (t) { return '<div><span class="su-verb ' + t[0] + '">' + t[0] + '</span><b class="mono">' + t[1] + '</b><span>' + t[2] + '</span></div>'; }).join('') + '</div></div></div>';
};

SetGuide.parallel = function (el) {
    var flow = [['#64748b', 'fa-database', 'Legacy system', 'Live transactions'], ['extract'], ['#0f766e', 'fa-robot', 'AI-assisted load', 'Detect anomalies'], ['post'], ['#c2410c', 'fa-bolt', 'Oracle Fusion', 'Real services'], ['compare'],
        ['#2563eb', 'fa-arrows-rotate', 'Reconcile', 'Auto vs legacy'], ['report'], ['#b45309', 'fa-triangle-exclamation', 'Variances', 'Investigate &amp; fix'], ['sign-off'], ['#15803d', 'fa-rocket', 'Go-live', 'Phased waves']];
    var svc = [['Purchasing', 'purchaseOrders · purchaseOrderLifeCycleDetails · suppliers', 'POs, receipts, invoices, payments, supplier master'],
        ['Order Management', 'salesOrdersForOrderHub (+lines, +totals)', 'Sales orders, fulfillment lines, order totals'],
        ['Inventory', 'transferOrders · shipmentLines · pickSlipDetails · inventoryOnhandBalances · inventoryCompletedTransactions', 'Transfers, picks, shipments, on-hand, movements'],
        ['Costing', 'itemCosts · receiptCosts', 'Item cost, receipt cost, valuation'], ['Items', 'itemsV2', 'Item master validation &amp; attributes'],
        ['Receivables', 'receivablesInvoices · standardReceipts', 'AR invoices &amp; receipts (loadable)'], ['Payables', 'invoices · payablesPayments', 'AP invoices &amp; payments (loadable)'],
        ['Setups', 'finBusinessUnitsLOV · inventoryOrganizations · subinventories', 'BUs, organizations, subinventories, LOVs']];
    var adv = [['#2563eb', 'fa-flask', 'Tests almost every scenario', 'Real legacy volumes flow through real Fusion services — edge cases surface that scripted UAT never reaches.'],
        ['#b45309', 'fa-bug', 'Finds defects early', 'Configuration gaps, mapping errors and data issues are caught during the run, not after go-live.'],
        ['#15803d', 'fa-certificate', 'Evidence-based sign-off', 'Reconciliation results give stakeholders hard numbers for the go / no-go call.'],
        ['#7c3aed', 'fa-robot', 'AI-assisted loading', 'Anomaly detection during the load flags outliers and inconsistencies before they reach Fusion.'],
        ['#0f766e', 'fa-code-branch', 'Reduced go-live stress', 'Parallel-run mode avoids a big-bang cutover — the new system is proven while the old one still runs.'],
        ['#c2410c', 'fa-layer-group', 'Staggered go-live', 'Hundreds of entities can be phased live in controlled waves rather than all at once.']];
    el.innerHTML = '<div class="su-doc">' +
        '<div class="card pad su-hero"><p>A <b>full parallel run</b> processes the same live business through both the <b>legacy system</b> and <b>Oracle Fusion</b> at the same time, with automation across every module. ' +
        'After each load, a <b>Reconcile with legacy</b> step compares both result sets and surfaces the variances automatically — the programme runs on facts, not hope.</p>' +
        '<div class="su-gchips"><span>Automated across all modules</span><span>Auto-reconciliation vs legacy</span><span>Variance analysis</span><span>AI-assisted anomaly detection</span><span>Phased go-live</span></div></div>' +
        '<h3>The loop</h3><div class="card pad"><div class="su-flow">' + flow.map(function (f) {
            return f.length === 1 ? '<div class="su-conn"><span>' + f[0] + '</span><i class="fa-solid fa-arrow-right"></i></div>' : '<div class="su-fbox" style="--c:' + f[0] + '"><span><i class="fa-solid ' + f[1] + '"></i></span><b>' + f[2] + '</b><small>' + f[3] + '</small></div>';
        }).join('') + '</div><p class="muted" style="margin-top:10px">Every module runs this loop continuously. Because the loaders are <b>AI-enabled</b>, anomalies and data inconsistencies are detected during loading — less noise reaches reconciliation.</p></div>' +
        '<h3>Web services behind each module</h3><div class="card">' + '<table class="tbl"><thead><tr><th>Module</th><th>Fusion REST services</th><th>Parallel-run scope</th></tr></thead><tbody>' +
        svc.map(function (s) { return '<tr><td><b>' + s[0] + '</b></td><td class="mono">' + s[1] + '</td><td>' + s[2] + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<h3>Reconcile with legacy</h3><div class="su-recon"><div class="card pad"><p>After each load the <b>Reconcile</b> step pulls the equivalent result from the legacy system and matches it against Fusion automatically — quantities, values, balances and document counts. Differences are classified into a <b>variance report</b>:</p>' +
        '<div class="su-rk"><span class="chip ok"><i class="fa-solid fa-equals"></i> Matched</span> both systems agree</div><div class="su-rk"><span class="chip warn"><i class="fa-solid fa-not-equal"></i> Variance</span> value, quantity or status differs</div><div class="su-rk"><span class="chip err"><i class="fa-solid fa-circle-question"></i> Missing</span> present in one system only</div></div>' +
        '<div class="card pad su-big"><b>≈ 100%</b><span>reconciliation coverage</span><small>every loaded record is checked, not sampled</small></div></div>' +
        '<h3>Why an automated parallel run</h3><div class="su-gcards">' + adv.map(function (a) { return '<div class="card su-gcard" style="--c:' + a[0] + '"><div class="su-gcard-h"><span><i class="fa-solid ' + a[1] + '"></i></span><b>' + a[2] + '</b></div><p class="muted">' + a[3] + '</p></div>'; }).join('') + '</div>' +
        '<div class="card pad su-golive"><i class="fa-solid fa-rocket"></i><div><b>Go-live with confidence — even in parallel-run mode</b><p>Stakeholders decide to proceed to <b>production setup</b> and then <b>LIVE</b> on the reconciliation evidence, not gut feel. Because the run is automated and AI-assisted, organisations can go live in <b>parallel-run mode</b> and phase out hundreds of entities in a <b>staggered</b> way, greatly reducing the risk and stress of a big-bang cutover.</p></div></div>' +
        '</div>';
};

SetGuide.login = function (el) {
    var since = FX.daysAgo(7);
    el.innerHTML = '<div class="card pad su-na"><div class="su-ic warn"><i class="fa-solid fa-user-clock"></i></div><div><b>Not available in this app yet</b>' +
        '<p>Sign-in history lives in the <b>Oracle identity domain</b> (IDCS audit events, <span class="mono">https://idcs-….identity.oraclecloud.com/admin/v1/AuditEvents</span>), not in Fusion\'s REST API. The app only relays calls to <span class="mono">…oraclecloud.com/fscmRestApi|hcmRestApi|crmRestApi/resources/</span>, and the identity domain does not accept the Fusion user\'s Basic login — it needs an OAuth client (client id + secret with the audit / Identity Domain Administrator scope).</p>' +
        '<p><b>Until then:</b> an identity-domain administrator can see the same data in the OCI Console › Identity &amp; Security › Domains › <i>your domain</i> › Reports (successful / unsuccessful sign-ins). Newer identity domains publish these events to OCI Audit instead of the IDCS AuditEvents API.</p>' +
        '<p class="muted">What the app needs: a host action allow-listed to <span class="mono">https://idcs-*.identity.oraclecloud.com/admin/v1/AuditEvents</span> with an OAuth client-credentials token from a secret kept encrypted (DPAPI) in the app.</p></div></div>' +
        '<div class="card"><div class="card-h"><b><i class="fa-solid fa-sliders"></i> Planned filters</b><span class="chip">preview</span></div><div class="filters su-disabled">' +
        '<label>User<input disabled value="' + esc(FX.user) + '"></label><label>Event<select disabled><option>Successful sign-ins</option><option>Failed sign-ins</option><option>App access</option><option>Sign-outs</option><option>All events</option></select></label>' +
        '<label>Since<input type="date" disabled value="' + since + '"></label><div class="go"><button class="btn primary" disabled><i class="fa-solid fa-play"></i> Run</button></div></div>' +
        '<div class="su-empty"><i class="fa-solid fa-table-list"></i><b>Time · User · Event · IP · Browser / OS · Message</b><span>Columns the list will show once the identity-domain connection exists.</span></div></div>';
};
