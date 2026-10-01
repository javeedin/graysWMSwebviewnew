/* Fusion Purchasing — suppliers: Manage Suppliers (suppliers + child collections) and Supplier Balance.
   The balance is computed live from Fusion (no APEX copy, no sync jobs): Fusion SQL over AP_INVOICES_ALL / AP_PAYMENT_SCHEDULES_ALL /
   AP_CHECKS_ALL / POZ_SUPPLIERS_V (exact open amounts), or — when the SQL runner is not available — the payables REST resources
   invoices and payablesPayments. */

// ── View: Manage Suppliers ─────────────────────────────────────
function purSuppliers(el) {
    var p = PUR.take('suppliers');
    var g = FX.grid(el, {
        id: 'sup', resource: 'suppliers', pageSize: 25, qJoin: ';', key: 'SupplierId', csvName: 'Suppliers', orderBy: 'Supplier',
        emptyText: 'Search suppliers by name (prefix), number or status.',
        filters: [
            { id: 'name', label: 'Supplier name', ph: 'e.g. TEST_SUPP (starts with)', value: p.supplier || '', q: function (v) { return 'Supplier like ' + PUR.dq(v + '*'); } },
            { id: 'num', label: 'Supplier number', ph: 'exact', q: function (v) { return 'SupplierNumber=' + PUR.dq(v); } },
            { id: 'st', label: 'Status', type: 'select', options: [{ v: '', t: 'All' }, { v: 'ACTIVE', t: 'Active' }, { v: 'INACTIVE', t: 'Inactive' }], q: function (v) { return 'Status=' + PUR.dq(v); } }
        ],
        columns: [
            { label: 'Supplier', f: 'Supplier', html: function (r) { return '<b>' + esc(r.Supplier) + '</b>'; } }, { label: 'Number', f: 'SupplierNumber', fmt: 'mono' },
            { label: 'Status', f: 'Status', html: function (r) { var s = String(r.Status || ''); return '<span class="chip ' + (/^active$/i.test(s) ? 'ok' : /inactive/i.test(s) ? '' : 'info') + '">' + esc(s || '—') + '</span>'; } },
            { label: 'Business relationship', f: 'BusinessRelationship' }, { label: 'Tax org type', f: 'TaxOrganizationType' }, { label: 'Tax reg #', f: 'TaxRegistrationNumber' }, { label: 'DUNS', f: 'DUNSNumber' },
            { label: 'Created', f: 'CreationDate', fmt: 'date' }, { label: 'Last updated', f: 'LastUpdateDate', fmt: 'date' }
        ],
        kpis: function (rows) {
            var act = function (r) { return /^active$/i.test(r.Status || ''); };
            return [{ k: 'all', label: 'Suppliers loaded', value: rows.length }, { k: 'a', label: 'Active', value: rows.filter(act).length, filter: act }, { k: 'i', label: 'Inactive', value: rows.filter(function (r) { return !act(r); }).length, filter: function (r) { return !act(r); } },
            { k: 'p', label: 'Prospective', value: rows.filter(function (r) { return /prospect/i.test(r.BusinessRelationship || ''); }).length, filter: function (r) { return /prospect/i.test(r.BusinessRelationship || ''); } }];
        },
        rowActions: [{ label: 'Supplier balance', icon: 'fa-scale-balanced', run: function (r) { PUR.go('balance', { supplier: r.SupplierNumber, name: r.Supplier }); } }],
        onRow: function (r) { supOpen(r); }
    });
    if (p.supplier) setTimeout(function () { g.search(); }, 0);
}
function supTab(id, child, cols) {
    return {
        label: child === 'globalDFF' ? 'Global DFF' : child === 'DFF' ? 'DFF' : child.charAt(0).toUpperCase() + child.slice(1), render: function (el) {
            el.innerHTML = '<div class="muted">' + PUR.spin + ' Loading ' + esc(child) + '…</div>';
            FX.restAll('suppliers/' + id + '/child/' + child, { limit: 500 }, 2000).then(function (rows) {
                if (!rows.length) { el.innerHTML = '<div class="empty"><i class="fa-solid fa-inbox"></i>No ' + esc(child) + ' found.</div>'; return; }
                var c = cols;
                if (!c) {
                    var keys = Object.keys(rows[0]).filter(function (k) { return k !== 'links' && k !== 'SupplierId' && k !== 'SupplierPartyId' && rows.some(function (r) { return r[k] != null && r[k] !== '' && typeof r[k] !== 'object'; }); }).slice(0, 8);
                    c = keys.map(function (k) { return { label: PUR.label(k), f: k }; });
                }
                c = c.map(function (x) { return Object.assign({ html: function (r) { var v = r[x.f]; return typeof v === 'boolean' ? (v ? '<span class="chip ok">Yes</span>' : '<span class="chip">No</span>') : /^\d{4}-\d{2}-\d{2}(T|$)/.test(String(v || '')) ? esc(FX.fmt.date(v)) : esc(v); } }, x); });
                el.innerHTML = FX.table(rows, c.concat([{ label: '', html: function (r) { return '<button class="btn sm icon" data-inf="' + rows.indexOf(r) + '" title="All fields"><i class="fa-solid fa-circle-info"></i></button>'; } }]));
                el.onclick = function (e) { var b = e.target.closest('[data-inf]'); if (b) PUR.allFields(child + ' — all fields', rows[+b.getAttribute('data-inf')]); };
            }).catch(function (e) { el.innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
        }
    };
}
function supOpen(s) {
    var id = s.SupplierId, yn = function (v) { return v == null || v === '' ? null : (v === true || v === 'Y' ? 'Yes' : 'No'); };
    var sec = function (t, icon, rows) { var f = rows.filter(function (x) { return x[1] != null && x[1] !== ''; }); return f.length ? '<div class="pu-sec"><h4><i class="fa-solid ' + icon + '"></i> ' + t + '</h4><div class="facts">' + f.map(function (x) { return '<div><span>' + esc(x[0]) + '</span>' + esc(x[1]) + '</div>'; }).join('') + '</div></div>' : ''; };
    FX.drawer({
        width: 980, raw: s, title: esc(s.Supplier), sub: 'Supplier ' + esc(s.SupplierNumber || '') + (s.SupplierType ? ' · ' + esc(s.SupplierType) : ''),
        chips: [FX.chip(s.Status), s.BusinessRelationship ? '<span class="chip info">' + esc(s.BusinessRelationship) + '</span>' : '', s.TaxOrganizationType ? '<span class="chip">' + esc(s.TaxOrganizationType) + '</span>' : ''],
        facts: [['Tax registration', esc(s.TaxRegistrationNumber || '')], ['Taxpayer ID', esc(s.TaxpayerId || '')], ['DUNS', esc(s.DUNSNumber || '')]],
        extra: '<div class="pu-cols" style="margin-top:6px">' +
            sec('General', 'fa-circle-info', [['Supplier ID', s.SupplierId], ['Supplier number', s.SupplierNumber], ['Status', s.Status], ['Relationship', s.RelationshipDisplay || s.BusinessRelationship], ['Alternate name', s.AlternateName], ['Supplier type', s.SupplierType], ['Tax org type', s.TaxOrganizationType], ['Registry ID', s.RegistryId], ['DUNS number', s.DUNSNumber], ['Customer number', s.CustomerNumber], ['Website', s.CorporateWebsite], ['Year established', s.YearEstablished], ['Industry', s.IndustryCategory], ['Std industry class', s.StandardIndustryClass], ['Preferred currency', s.PreferredFunctionalCurrency || s.PreferredFunctionalCurrencyCode], ['One-time supplier', yn(s.OneTimeSupplierFlag)], ['Parent supplier', s.ParentSupplier], ['Creation source', s.CreationSource]]) +
            sec('Tax information', 'fa-receipt', [['Tax registration #', s.TaxRegistrationNumber], ['Tax reg country', s.TaxRegistrationCountry], ['Taxpayer ID', s.TaxpayerId], ['Taxpayer country', s.TaxpayerCountry], ['Federal reportable', yn(s.FederalReportableFlag)]]) +
            sec('Audit', 'fa-clock-rotate-left', [['Created by', s.CreatedBy], ['Created', FX.fmt.dt(s.CreationDate)], ['Last updated by', s.LastUpdatedBy], ['Last updated', FX.fmt.dt(s.LastUpdateDate)], ['Inactive date', FX.fmt.date(s.InactiveDate)]]) + '</div>',
        tabs: [
            supTab(id, 'addresses', [{ label: 'Address name', f: 'AddressName' }, { label: 'Address', f: 'AddressLine1' }, { label: 'City', f: 'City' }, { label: 'State', f: 'State' }, { label: 'Postal code', f: 'PostalCode' }, { label: 'Country', f: 'Country' }, { label: 'Status', f: 'Status' }]),
            supTab(id, 'sites', [{ label: 'Site', f: 'SupplierSite' }, { label: 'Procurement BU', f: 'ProcurementBU' }, { label: 'Address', f: 'SupplierAddressName' }, { label: 'Purchasing', f: 'SitePurposePurchasingFlag' }, { label: 'Pay', f: 'SitePurposePayFlag' }, { label: 'Inactive date', f: 'InactiveDate' }]),
            supTab(id, 'contacts', [{ label: 'First name', f: 'FirstName' }, { label: 'Last name', f: 'LastName' }, { label: 'E-mail', f: 'Email' }, { label: 'Phone', f: 'PhoneNumber' }, { label: 'Status', f: 'Status' }]),
            supTab(id, 'globalDFF'), supTab(id, 'attachments'), supTab(id, 'DFF')
        ],
        actions: [
            { label: 'Supplier balance', icon: 'fa-scale-balanced', cls: 'primary', run: function () { PUR.go('balance', { supplier: s.SupplierNumber, name: s.Supplier }); } },
            { label: 'Purchase orders', icon: 'fa-file-invoice', run: function () { PUR.go('pos', { supplier: s.Supplier }); } },
            {
                label: 'Refresh', icon: 'fa-rotate', run: function () {
                    var self = (s.links || []).filter(function (l) { return l.name === 'self' || l.rel === 'self'; })[0];
                    FX.busy('Refreshing…');
                    (self ? FX.get(self.href) : FX.get('suppliers/' + id)).then(function (r) { FX.busy(false); supOpen(r); }).catch(function (e) { FX.busy(false); FX.toast(String(e), 'err'); });
                }
            }
        ]
    });
}

// ── View: Supplier Balance ─────────────────────────────────────
var SB = null;
function purBalance(el) {
    var p = PUR.take('balance');
    SB = { sup: null, inv: [], pay: [], src: '', tab: 'sum' };
    el.innerHTML = '<div class="card"><div class="filters"><label>Supplier (name or number)<input id="sb-sup" type="search" placeholder="Type 2+ characters…" value="' + esc(p.supplier || PUR.recall('bal_sup', '')) + '" style="min-width:280px"></label>' +
        '<label>Business unit<select id="sb-bu"></select></label><label>Source<select id="sb-src"><option value="auto">Auto (SQL, else REST)</option><option value="sql">Fusion SQL — exact open amounts</option><option value="rest">Fusion REST — payables resources</option></select></label>' +
        '<div class="go"><button class="btn primary" id="sb-go"><i class="fa-solid fa-scale-balanced"></i> Load balance</button></div></div></div><div id="sb-out" style="display:flex;flex-direction:column;gap:10px"><div class="empty"><i class="fa-solid fa-scale-balanced"></i>Pick a supplier to see invoices, payments and the open balance — read live from Fusion.</div></div>';
    FX.fillSelect('sb-bu', FX.lov('payBUs'), '', 'All business units');
    $('sb-src').value = PUR.recall('bal_src', 'auto'); PUR.bindRemember('sb-src', 'bal_src');
    FX.typeahead('sb-sup', function (q) {
        return FX.get('suppliers', { q: (/^\d/.test(q) ? 'SupplierNumber' : 'Supplier') + ' like ' + PUR.dq(q + '*'), limit: 20, fields: 'SupplierId,Supplier,SupplierNumber,Status' }).then(function (j) { return (j.items || []).map(function (s) { return { v: s.SupplierNumber, t: s.Supplier, r: s.Status, o: s }; }); });
    }, function () { sbLoad(); });
    $('sb-go').onclick = sbLoad; $('sb-sup').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !document.querySelector('.ta-list:not([hidden]) .ta-item.on')) sbLoad(); });
    if (p.supplier) sbLoad();
}
PUR.sqlLit = function (v) { return "'" + String(v).replace(/'/g, "''") + "'"; };
function sbSql(num, buId) {
    var w = 's.segment1 = ' + PUR.sqlLit(num) + (buId ? ' AND x.org_id = ' + (+buId) : '');
    var inv = "SELECT x.invoice_id, x.invoice_num, TO_CHAR(x.invoice_date,'YYYY-MM-DD') invoice_date, x.invoice_amount, NVL(x.amount_paid,0) amount_paid, " +
        "NVL((SELECT SUM(ps.amount_remaining) FROM ap_payment_schedules_all ps WHERE ps.invoice_id = x.invoice_id),0) amount_remaining, x.invoice_currency_code, x.invoice_type_lookup_code, x.payment_status_flag, x.description, bu.bu_name " +
        "FROM ap_invoices_all x JOIN poz_suppliers_v s ON s.vendor_id = x.vendor_id LEFT JOIN fun_all_business_units_v bu ON bu.bu_id = x.org_id WHERE " + w + " AND x.cancelled_date IS NULL ORDER BY x.invoice_date DESC";
    var pay = "SELECT x.check_id, x.check_number, TO_CHAR(x.check_date,'YYYY-MM-DD') payment_date, x.amount, x.status_lookup_code, x.payment_method_code, x.currency_code, TO_CHAR(x.future_pay_due_date,'YYYY-MM-DD') maturity_date, x.bank_account_name " +
        "FROM ap_checks_all x JOIN poz_suppliers_v s ON s.vendor_id = x.vendor_id WHERE " + w + " ORDER BY x.check_date DESC";
    var pf = { Y: 'Paid', N: 'Unpaid', P: 'Partially Paid' };
    return Promise.all([FX.sql(inv, 5000), FX.sql(pay, 5000)]).then(function (a) {
        return {
            inv: a[0].map(function (r) { return { id: r.INVOICE_ID, num: r.INVOICE_NUM, date: r.INVOICE_DATE, amount: +r.INVOICE_AMOUNT || 0, paid: +r.AMOUNT_PAID || 0, remaining: +r.AMOUNT_REMAINING || 0, ccy: r.INVOICE_CURRENCY_CODE, type: PUR.label(String(r.INVOICE_TYPE_LOOKUP_CODE || 'STANDARD').toLowerCase().replace(/(^|_)(\w)/g, function (m, a2, b) { return (a2 ? ' ' : '') + b.toUpperCase(); })), status: pf[r.PAYMENT_STATUS_FLAG] || r.PAYMENT_STATUS_FLAG, desc: r.DESCRIPTION, bu: r.BU_NAME }; }),
            pay: a[1].map(function (r) { return { id: r.CHECK_ID, num: r.CHECK_NUMBER, date: r.PAYMENT_DATE, amount: +r.AMOUNT || 0, status: r.STATUS_LOOKUP_CODE, method: r.PAYMENT_METHOD_CODE, ccy: r.CURRENCY_CODE, maturity: r.MATURITY_DATE, bank: r.BANK_ACCOUNT_NAME }; }),
            src: 'Fusion SQL'
        };
    });
}
function sbRest(num, buName) {
    var q = 'SupplierNumber=' + PUR.dq(num) + (buName ? ';BusinessUnit=' + PUR.dq(buName) : '');
    return Promise.all([
        FX.restAll('invoices', { q: q, limit: 500 }, 5000),
        FX.restAll('payablesPayments', { q: 'SupplierNumber=' + PUR.dq(num) + (buName ? ';BusinessUnit=' + PUR.dq(buName) : ''), limit: 500 }, 5000).catch(function (e) { SB.payErr = String(e); return []; })
    ]).then(function (a) {
        return {
            inv: a[0].filter(function (r) { return !(r.CanceledFlag === true || r.CanceledFlag === 'Y'); }).map(function (r) {
                var amt = +r.InvoiceAmount || 0, paid = +r.AmountPaid || 0;
                return { id: r.InvoiceId, num: r.InvoiceNumber, date: FX.fmt.date(r.InvoiceDate), amount: amt, paid: paid, remaining: amt - paid, ccy: r.InvoiceCurrency || r.InvoiceCurrencyCode, type: r.InvoiceType || 'Standard', status: r.PaidStatus, validation: r.ValidationStatus, desc: r.Description, bu: r.BusinessUnit, links: r.links };
            }),
            pay: a[1].map(function (r) { return { id: PUR.first(r, 'CheckId', 'PaymentId'), num: r.PaymentNumber, date: FX.fmt.date(r.PaymentDate), amount: +r.PaymentAmount || 0, status: r.PaymentStatus, method: r.PaymentMethod || r.PaymentMethodCode, ccy: r.PaymentCurrency || r.PaymentCurrencyCode, maturity: FX.fmt.date(r.MaturityDate), bank: r.BankAccountName || r.DisbursementBankAccountName, links: r.links }; }),
            src: 'Fusion REST (remaining = amount − paid)'
        };
    });
}
function sbLoad() {
    var num = $('sb-sup').value.trim(); if (!num) { FX.toast('Pick a supplier.', 'err'); return; }
    PUR.remember('bal_sup', num);
    var buSel = $('sb-bu'), buId = buSel.value, buName = buId ? buSel.options[buSel.selectedIndex].text : '', src = $('sb-src').value;
    $('sb-out').innerHTML = '<div class="empty">' + PUR.spin + ' Reading supplier ' + esc(num) + ', invoices and payments…</div>';
    SB.payErr = null;
    FX.get('suppliers', { q: 'SupplierNumber=' + PUR.dq(num), limit: 1 }).then(function (j) {
        var s = (j.items || [])[0];
        if (!s) throw 'Supplier ' + num + ' was not found in Fusion.';
        SB.sup = s;
        var job = src === 'rest' ? sbRest(num, buName) : sbSql(num, buId).catch(function (e) { if (src === 'sql') throw e; SB.sqlErr = String(e); return sbRest(num, buName); });
        return job;
    }).then(function (d) { SB.inv = d.inv; SB.pay = d.pay; SB.src = d.src; SB.buName = buName; sbDraw(); })
        .catch(function (e) { $('sb-out').innerHTML = '<div class="note err" style="white-space:pre-wrap">' + esc(e) + '</div>'; });
}
function sbByCcy() {
    var m = {};
    SB.inv.forEach(function (i) { var c = i.ccy || '—'; m[c] = m[c] || { ccy: c, n: 0, amount: 0, paid: 0, remaining: 0, pays: 0, payN: 0 }; m[c].n++; m[c].amount += i.amount; m[c].paid += i.paid; m[c].remaining += i.remaining; });
    SB.pay.forEach(function (p) { var c = p.ccy || '—'; m[c] = m[c] || { ccy: c, n: 0, amount: 0, paid: 0, remaining: 0, pays: 0, payN: 0 }; if (!/VOID/i.test(p.status || '')) { m[c].pays += p.amount; m[c].payN++; } });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.amount - a.amount; });
}
function sbBal(v, ccy) { if (v < 0) return '<span style="color:var(--warn)">(' + FX.fmt.money(-v) + ') credit</span>'; return '<span style="color:' + (v > 0 ? 'var(--err)' : 'var(--ok)') + '">' + FX.fmt.money(v) + '</span>' + (ccy ? ' <span class="muted" style="font-size:.7em">' + esc(ccy) + '</span>' : ''); }
function sbDraw() {
    var s = SB.sup, cc = sbByCcy();
    $('sb-out').innerHTML = '<div class="card pu-head"><i class="fa-solid fa-building" style="font-size:1.4rem;color:var(--accent)"></i><div><div style="font-weight:700;font-size:1.05rem">' + esc(s.Supplier || s.SupplierNumber) + '</div><div class="row-btns" style="margin-top:3px"><span class="chip">' + esc(s.SupplierNumber) + '</span>' + FX.chip(s.Status || 'Active') + (s.SupplierType ? '<span class="chip info">' + esc(s.SupplierType) + '</span>' : '') +
        (s.TaxRegistrationNumber ? '<span class="muted" style="font-size:.74rem">Tax reg ' + esc(s.TaxRegistrationNumber) + '</span>' : '') + '<span class="muted" style="font-size:.74rem">Created ' + esc(FX.fmt.date(s.CreationDate)) + '</span></div></div>' +
        '<div class="tot">' + (cc.length ? cc.map(function (c) { return '<div><span>Outstanding · ' + esc(c.ccy) + '</span><b>' + sbBal(c.remaining) + '</b></div>'; }).join('') : '<div><span>Outstanding</span><b>0.00</b></div>') + '</div></div>' +
        '<div class="row-btns"><span class="chip info"><i class="fa-solid fa-database"></i> ' + esc(SB.src) + '</span>' + (SB.buName ? '<span class="chip">' + esc(SB.buName) + '</span>' : '<span class="muted" style="font-size:.74rem">all business units</span>') +
        (SB.sqlErr && /REST/.test(SB.src) ? '<span class="muted" style="font-size:.72rem" title="' + esc(SB.sqlErr) + '">SQL runner not available — used REST</span>' : '') + (SB.payErr ? '<span class="chip warn" title="' + esc(SB.payErr) + '">payments could not be read</span>' : '') +
        '<span class="grow"></span><button class="btn sm" id="sb-csv"><i class="fa-solid fa-file-csv"></i> Export invoices</button><button class="btn sm" id="sb-ref"><i class="fa-solid fa-rotate"></i> Refresh all</button><button class="btn sm" id="sb-back"><i class="fa-solid fa-arrow-left"></i> Suppliers</button></div>' +
        '<div class="card"><div class="pu-tabs" id="sb-tabs">' + [['sum', 'Balance summary', ''], ['inv', 'Invoices', SB.inv.length], ['pay', 'Payments', SB.pay.length]].map(function (t) { return '<button data-t="' + t[0] + '" class="' + (SB.tab === t[0] ? 'on' : '') + '">' + t[1] + (t[2] !== '' ? ' <span class="cnt">' + t[2] + '</span>' : '') + '</button>'; }).join('') + '</div><div class="pu-body" id="sb-body"></div></div>';
    $('sb-tabs').onclick = function (e) { var b = e.target.closest('[data-t]'); if (!b) return; SB.tab = b.getAttribute('data-t'); this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); sbTab(); };
    $('sb-ref').onclick = sbLoad; $('sb-back').onclick = function () { PUR.go('suppliers', { supplier: s.Supplier }); };
    $('sb-csv').onclick = function () { FX.csv(SB.inv, [{ label: 'Invoice', f: 'num' }, { label: 'Type', f: 'type' }, { label: 'Date', f: 'date' }, { label: 'Currency', f: 'ccy' }, { label: 'Amount', f: 'amount' }, { label: 'Paid', f: 'paid' }, { label: 'Remaining', f: 'remaining' }, { label: 'Status', f: 'status' }, { label: 'Business unit', f: 'bu' }, { label: 'Description', f: 'desc' }], 'SupplierInvoices_' + s.SupplierNumber); };
    sbTab();
}
function sbTab() {
    var el = $('sb-body'), cc = sbByCcy();
    if (SB.tab === 'sum') {
        el.innerHTML = PUR.kpis([{ label: 'Invoices', value: SB.inv.length }, { label: 'Payments', value: SB.pay.length }, { label: 'Unpaid invoices', value: SB.inv.filter(function (i) { return i.remaining > 0; }).length, cls: SB.inv.some(function (i) { return i.remaining > 0; }) ? 'amber' : 'good' }, { label: 'Open credits', value: SB.inv.filter(function (i) { return i.remaining < 0; }).length }]) +
            (cc.length ? '<div class="pu-cols">' + cc.map(function (c) {
                return '<div class="pu-sec"><h4><i class="fa-solid fa-coins"></i> ' + esc(c.ccy) + '</h4><table class="tbl"><tbody>' +
                    '<tr><td>Total invoice amount (' + c.n + ')</td><td class="n">' + FX.fmt.money(c.amount) + '</td></tr><tr><td>− Paid on invoices</td><td class="n">' + FX.fmt.money(c.paid) + '</td></tr>' +
                    '<tr><td><b>= Outstanding balance</b></td><td class="n"><b>' + sbBal(c.remaining) + '</b></td></tr><tr><td class="muted">Payments made (' + c.payN + ', excl. void)</td><td class="n muted">' + FX.fmt.money(c.pays) + '</td></tr></tbody></table></div>';
            }).join('') + '</div>' : '<div class="empty"><i class="fa-solid fa-inbox"></i>No invoices or payments for this supplier.</div>') +
            '<div class="muted" style="font-size:.72rem">Cancelled invoices are left out. Amounts are per invoice currency — never added across currencies.</div>';
        return;
    }
    if (SB.tab === 'inv') {
        var tagT = function (t) { return /prepay/i.test(t) ? '<span class="chip info">' + esc(t) + '</span>' : /credit/i.test(t) ? '<span class="chip warn">' + esc(t) + '</span>' : esc(t); };
        el.innerHTML = '<div class="pu-inline"><input id="sb-q" type="search" placeholder="Filter invoices…" style="min-width:260px"><label>Show <select id="sb-open"><option value="">All</option><option value="open">Open only</option></select></label></div><div id="sb-it" class="pu-scroll"></div>';
        var draw = function () {
            var q = $('sb-q').value.toLowerCase(), op = $('sb-open').value;
            var rows = SB.inv.filter(function (i) { return (!op || i.remaining !== 0) && (!q || [i.num, i.type, i.desc, i.status, i.bu].join(' ').toLowerCase().indexOf(q) >= 0); });
            var tot = {}; rows.forEach(function (i) { var c = i.ccy || '—'; tot[c] = tot[c] || { a: 0, p: 0, r: 0 }; tot[c].a += i.amount; tot[c].p += i.paid; tot[c].r += i.remaining; });
            $('sb-it').innerHTML = rows.length ? '<table class="tbl"><thead><tr><th>Invoice</th><th>Type</th><th>Date</th><th>CCY</th><th class="n">Amount</th><th class="n">Paid</th><th class="n">Balance / open credit</th><th>Status</th><th>Business unit</th><th>Description</th></tr></thead><tbody>' +
                rows.map(function (i) { return '<tr><td class="mono">' + esc(i.num) + '</td><td>' + tagT(i.type) + '</td><td>' + esc(i.date) + '</td><td>' + esc(i.ccy) + '</td><td class="n">' + FX.fmt.money(i.amount) + '</td><td class="n" style="color:var(--ok)">' + FX.fmt.money(i.paid) + '</td><td class="n">' + sbBal(i.remaining) + '</td><td>' + (i.status ? '<span class="chip ' + (/^paid/i.test(i.status) ? 'ok' : /partial/i.test(i.status) ? 'warn' : 'info') + '">' + esc(i.status) + '</span>' : '') + (i.validation ? ' <span class="muted" style="font-size:.7rem">' + esc(i.validation) + '</span>' : '') + '</td><td>' + esc(i.bu) + '</td><td>' + esc(i.desc) + '</td></tr>'; }).join('') +
                '</tbody><tfoot>' + Object.keys(tot).map(function (c) { return '<tr><td colspan="3">Total</td><td>' + esc(c) + '</td><td class="n">' + FX.fmt.money(tot[c].a) + '</td><td class="n">' + FX.fmt.money(tot[c].p) + '</td><td class="n">' + sbBal(tot[c].r) + '</td><td colspan="3"></td></tr>'; }).join('') + '</tfoot></table>' : '<div class="empty"><i class="fa-solid fa-inbox"></i>No invoices.</div>';
        };
        draw(); $('sb-q').oninput = draw; $('sb-open').onchange = draw;
        return;
    }
    var tot = {}; SB.pay.forEach(function (p) { if (!/VOID/i.test(p.status || '')) tot[p.ccy || '—'] = (tot[p.ccy || '—'] || 0) + p.amount; });
    el.innerHTML = SB.pay.length ? '<div class="pu-scroll"><table class="tbl"><thead><tr><th>Payment</th><th>Date</th><th>Maturity</th><th>CCY</th><th class="n">Amount</th><th>Status</th><th>Method</th><th>Bank account</th></tr></thead><tbody>' +
        SB.pay.map(function (p, i) { return '<tr><td><button class="link mono" data-pay="' + i + '">' + esc(p.num) + '</button></td><td>' + esc(p.date) + '</td><td>' + esc(p.maturity || '') + '</td><td>' + esc(p.ccy) + '</td><td class="n" style="color:var(--ok);font-weight:600">' + FX.fmt.money(p.amount) + '</td><td><span class="chip ' + (/CLEAR|RECONC/i.test(p.status || '') ? 'ok' : /VOID/i.test(p.status || '') ? 'err' : 'info') + '">' + esc(p.status || '') + '</span></td><td>' + esc(p.method) + '</td><td>' + esc(p.bank) + '</td></tr>'; }).join('') +
        '</tbody><tfoot>' + Object.keys(tot).map(function (c) { return '<tr><td colspan="3">Total (excl. void)</td><td>' + esc(c) + '</td><td class="n">' + FX.fmt.money(tot[c]) + '</td><td colspan="3"></td></tr>'; }).join('') + '</tfoot></table></div>' : '<div class="empty"><i class="fa-solid fa-inbox"></i>No payments' + (SB.payErr ? ' — ' + esc(SB.payErr) : '') + '.</div>';
    el.onclick = function (e) { var b = e.target.closest('[data-pay]'); if (b && SB.tab === 'pay') sbPayment(SB.pay[+b.getAttribute('data-pay')]); };
}
function sbPayment(p) {
    FX.modal({
        title: '<i class="fa-solid fa-money-check-dollar" style="color:var(--accent)"></i> Payment ' + esc(p.num), wide: true,
        body: '<div class="facts">' + [['Payment #', p.num], ['Date', p.date], ['Amount', FX.fmt.money(p.amount) + ' ' + (p.ccy || '')], ['Status', p.status], ['Method', p.method], ['Bank', p.bank]].map(function (f) { return '<div><span>' + f[0] + '</span>' + esc(f[1] || '') + '</div>'; }).join('') + '</div><h4 style="margin-top:8px">Related invoices</h4><div id="sp-rel" class="muted">' + PUR.spin + ' Loading…</div>'
    });
    var job;
    if (/SQL/.test(SB.src)) {
        job = FX.sql("SELECT ai.invoice_num, TO_CHAR(ai.invoice_date,'YYYY-MM-DD') invoice_date, ai.invoice_amount, aip.amount amount_applied, NVL((SELECT SUM(ps.amount_remaining) FROM ap_payment_schedules_all ps WHERE ps.invoice_id = ai.invoice_id),0) amount_remaining, ai.invoice_type_lookup_code " +
            "FROM ap_invoice_payments_all aip JOIN ap_invoices_all ai ON ai.invoice_id = aip.invoice_id WHERE aip.check_id = " + (+p.id) + " ORDER BY ai.invoice_date", 1000)
            .then(function (r) { return r.map(function (x) { return { num: x.INVOICE_NUM, date: x.INVOICE_DATE, amount: +x.INVOICE_AMOUNT, applied: +x.AMOUNT_APPLIED, remaining: +x.AMOUNT_REMAINING, type: x.INVOICE_TYPE_LOOKUP_CODE }; }); });
    } else {
        var lk = (p.links || []).filter(function (l) { return /invoice/i.test(l.name || ''); })[0];
        job = (lk ? FX.restAll(lk.href.split('?')[0], {}, 1000) : FX.restAll('payablesPayments/' + p.id + '/child/relatedInvoices', {}, 1000))
            .then(function (r) { return r.map(function (x) { return { num: x.InvoiceNumber, date: FX.fmt.date(x.InvoiceDate), amount: +PUR.first(x, 'InvoiceAmount') || null, applied: +PUR.first(x, 'AmountPaid', 'PaymentAmount', 'AmountApplied') || 0, remaining: x.AmountRemaining != null ? +x.AmountRemaining : null, type: x.InvoiceType }; }); });
    }
    job.then(function (rows) {
        if (!$('sp-rel')) return; $('sp-rel').className = '';
        $('sp-rel').innerHTML = rows.length ? FX.table(rows, [{ label: 'Invoice', f: 'num', fmt: 'mono' }, { label: 'Type', f: 'type' }, { label: 'Date', f: 'date' }, { label: 'Invoice amount', f: 'amount', n: 1, fmt: 'money' }, { label: 'Amount applied', f: 'applied', n: 1, fmt: 'money' }, { label: 'Remaining', n: 1, html: function (r) { return r.remaining == null ? '' : sbBal(r.remaining); } }]) : '<div class="empty">No related invoices.</div>';
    }).catch(function (e) { if ($('sp-rel')) $('sp-rel').innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
}
