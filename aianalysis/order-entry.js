// ============================================================
// ORDER ENTRY FORM - dedicated order creation dialog
// ============================================================
// Opened when the chatbot answers with api_form apiId "order.create"
// (index.html intercepts it and calls openOrderEntryForm).
//
// The chatbot supplies (in values):
//   header prefill  - order_date, currency_code, customer fields, pricelist,
//                     salesrep_number, order_type, warehouse, subinventory,
//                     po_number, login_id, comments
//   lines prefill   - [{item_code,item_description,quantity,uom,list_price,
//                       discount_per,selling_price,tax_rate,tax_code,
//                       inventory_item_id}]
//   _lookups        - tenant-specific SQL + small lists:
//       itemsSql       SELECT with :SEARCH placeholder returning columns
//                      ITEM_CODE, ITEM_DESC, LIST_PRICE, TAX_CODE, TAX_RATE,
//                      UOM, INVENTORY_ITEM_ID (aliases required)
//       customersSql   SELECT with :SEARCH returning ACCOUNT_NAME,
//                      BILL_TO_CUSTOMER_NUMBER, CUST_ACCOUNT_ID, PARTY_ID,
//                      SITE_USE_ID, PARTY_SITE_ID, PRICELIST, LOCATION
//       salesreps      [ {number,name} ]      orderTypes [ "..." ]
//       warehouses     [ "..." ]              subinventories [ "..." ]
//
// All lookup SQL runs read-only through the guarded ai/executequery
// gateway. Totals: selling = list * (1 - disc%/100); line tax =
// qty*selling*taxRate/100; line net = qty*selling + tax (tax-inclusive,
// like the POS). Submit builds the NEWORDER OrderHeader payload via the
// order.create catalog buildBody and POSTs it (option 1), or hands the
// composed order back to the chat for direct Fusion creation (option 2).
// ============================================================

(function () {
    var QUERY_URL = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai/executequery';
    var st = null;   // current form state

    function esc2(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
    function fmt(v) { return num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

    // ── SQL gateway (read-only) ─────────────────────────────
    function runSql(sql, cb) {
        if (typeof sendMessageToCSharp !== 'function') { cb('bridge unavailable', null); return; }
        sendMessageToCSharp({
            action: 'executePost', fullUrl: QUERY_URL,
            body: JSON.stringify({ sql: sql, maxRows: 200, appUser: (st && st.header.login_id) || 'ORDERFORM' })
        }, function (err, data) {
            if (err) { cb(err, null); return; }
            try {
                var r = typeof data === 'string' ? JSON.parse(data) : data;
                if (!r.success) { cb(r.error || 'query failed', null); return; }
                var cols = r.columns || [];
                var objs = (r.rows || []).map(function (row) {
                    var o = {};
                    cols.forEach(function (c, i) { o[String(c).toUpperCase()] = row[i]; });
                    return o;
                });
                cb(null, objs);
            } catch (e) { cb(e.message, null); }
        });
    }

    function bindSearch(sqlTemplate, text) {
        // :SEARCH placeholder -> escaped uppercase literal
        var lit = String(text || '').replace(/'/g, "''").toUpperCase();
        return String(sqlTemplate).replace(/:SEARCH/g, "'%" + lit + "%'");
    }

    // ── line math ───────────────────────────────────────────
    function lineCalc(l) {
        var qty = num(l.quantity) || 0;
        var list = num(l.list_price);
        var disc = num(l.discount_per);
        var selling = l.selling_price !== undefined && l.selling_price !== '' && !l._auto
            ? num(l.selling_price) : list * (1 - disc / 100);
        var taxRate = num(l.tax_rate);
        var tax = qty * selling * taxRate / 100;
        return {
            qty: qty, list: list, disc: disc, selling: selling,
            tax: tax, gross: qty * list,
            discountAmt: qty * (list - selling),
            net: qty * selling + tax
        };
    }

    function totals() {
        var t = { gross: 0, tax: 0, discount: 0, net: 0 };
        (st.lines || []).forEach(function (l) {
            var c = lineCalc(l);
            t.gross += c.gross; t.tax += c.tax; t.discount += c.discountAmt; t.net += c.net;
        });
        return t;
    }

    // ── rendering ───────────────────────────────────────────
    function headerField(label, id, inner) {
        return '<div><label style="display:block;font-size:10px;font-weight:700;color:#475569;margin-bottom:2px;">' + label + '</label>' + inner + '</div>';
    }
    function inputCss() { return 'width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;outline:none;'; }

    function render() {
        var h = st.header;
        var lk = st.lookups;
        var existing = document.getElementById('oe-modal');
        if (existing) existing.remove();

        var selOpt = function (list, cur) {
            return '<option value=""></option>' + (list || []).map(function (o) {
                var v = typeof o === 'object' ? o.number : o;
                var lab = typeof o === 'object' ? (o.number + ' — ' + o.name) : o;
                return '<option value="' + esc2(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc2(lab) + '</option>';
            }).join('');
        };

        var linesHtml = (st.lines || []).map(function (l, i) {
            var c = lineCalc(l);
            return '<tr>' +
                '<td style="padding:4px 6px;text-align:center;color:#94a3b8;">' + (i + 1) + '</td>' +
                '<td style="padding:4px 6px;font-weight:600;color:#0f172a;white-space:nowrap;">' + esc2(l.item_code) + '</td>' +
                '<td style="padding:4px 6px;color:#475569;min-width:160px;">' + esc2(l.item_description) + '</td>' +
                '<td style="padding:2px;"><input type="number" min="0" step="1" value="' + esc2(l.quantity) + '" data-i="' + i + '" data-f="quantity" class="oe-cell" style="width:60px;padding:4px;border:1px solid #e2e8f0;border-radius:5px;font-size:11px;text-align:right;"></td>' +
                '<td style="padding:4px 6px;text-align:right;">' + fmt(c.list) + '</td>' +
                '<td style="padding:2px;"><input type="number" min="0" max="100" step="0.01" value="' + esc2(l.discount_per || 0) + '" data-i="' + i + '" data-f="discount_per" class="oe-cell" style="width:58px;padding:4px;border:1px solid #e2e8f0;border-radius:5px;font-size:11px;text-align:right;" title="Discount %"></td>' +
                '<td style="padding:4px 6px;text-align:right;font-weight:600;">' + fmt(c.selling) + '</td>' +
                '<td style="padding:4px 6px;text-align:right;color:#b45309;">' + fmt(c.tax) + '</td>' +
                '<td style="padding:4px 6px;text-align:right;font-weight:700;color:#0f172a;">' + fmt(c.net) + '</td>' +
                '<td style="padding:4px;text-align:center;"><i class="fas fa-trash" data-i="' + i + '" class="oe-del" onclick="window._oeDelLine(' + i + ')" style="cursor:pointer;color:#f87171;font-size:11px;"></i></td>' +
                '</tr>';
        }).join('');

        var t = totals();

        var html =
        '<div id="oe-modal" style="position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:29000;display:flex;align-items:center;justify-content:center;">' +
          '<div style="background:white;width:96%;max-width:1050px;max-height:94vh;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.35);">' +
            '<div style="padding:0.8rem 1.2rem;background:linear-gradient(135deg,#7c3aed,#5b21b6);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">' +
              '<div style="font-weight:800;font-size:14px;color:white;"><i class="fas fa-file-invoice"></i> Order Entry</div>' +
              '<button onclick="window._oeClose()" style="background:none;border:none;color:white;font-size:1.3rem;cursor:pointer;">&times;</button>' +
            '</div>' +
            '<div style="padding:0.9rem 1.2rem;overflow-y:auto;">' +

              // ── Header section ──
              '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px 12px;margin-bottom:10px;">' +
                headerField('Order date', 'oe-date', '<input type="date" id="oe-h-order_date" value="' + esc2(h.order_date) + '" style="' + inputCss() + '">') +
                headerField('Currency', 'oe-cur', '<input type="text" id="oe-h-currency_code" value="' + esc2(h.currency_code || 'MUR') + '" style="' + inputCss() + '">') +
                headerField('Customer', 'oe-cust',
                    '<div style="display:flex;gap:4px;"><input type="text" id="oe-h-customer_name" value="' + esc2(h.customer_name) + '" readonly style="' + inputCss() + 'background:#f8fafc;" title="' + esc2(h.bill_to_customer_number) + '">' +
                    '<button onclick="window._oePickCustomer()" style="border:1px solid #e2e8f0;background:#f5f3ff;color:#6d28d9;border-radius:6px;cursor:pointer;padding:0 9px;" title="Search customer"><i class="fas fa-search"></i></button></div>') +
                headerField('Price list', 'oe-pl', '<input type="text" id="oe-h-pricelist" value="' + esc2(h.pricelist) + '" readonly style="' + inputCss() + 'background:#f8fafc;">') +
                headerField('Salesperson', 'oe-sr', '<select id="oe-h-salesrep_number" style="' + inputCss() + '">' + selOpt(lk.salesreps, h.salesrep_number) + '</select>') +
                headerField('Order type', 'oe-ot', '<select id="oe-h-order_type" style="' + inputCss() + '">' + selOpt(lk.orderTypes, h.order_type) + '</select>') +
                headerField('Warehouse', 'oe-wh', '<select id="oe-h-warehouse" style="' + inputCss() + '">' + selOpt(lk.warehouses, h.warehouse) + '</select>') +
                headerField('Subinventory', 'oe-si', '<select id="oe-h-subinventory" style="' + inputCss() + '">' + selOpt(lk.subinventories, h.subinventory) + '</select>') +
                headerField('PO number', 'oe-po', '<input type="text" id="oe-h-po_number" value="' + esc2(h.po_number) + '" style="' + inputCss() + '">') +
                headerField('Comments', 'oe-cm', '<input type="text" id="oe-h-comments" value="' + esc2(h.comments) + '" style="' + inputCss() + '">') +

                // ── Totals panel ──
                '<div style="grid-column:span 2;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:6px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
                  '<div style="text-align:center;"><div style="font-size:9px;color:#64748b;font-weight:700;">GROSS</div><div id="oe-t-gross" style="font-size:13px;font-weight:700;">' + fmt(t.gross) + '</div></div>' +
                  '<div style="text-align:center;"><div style="font-size:9px;color:#64748b;font-weight:700;">DISCOUNT</div><div id="oe-t-discount" style="font-size:13px;font-weight:700;color:#dc2626;">' + fmt(t.discount) + '</div></div>' +
                  '<div style="text-align:center;"><div style="font-size:9px;color:#64748b;font-weight:700;">TAX</div><div id="oe-t-tax" style="font-size:13px;font-weight:700;color:#b45309;">' + fmt(t.tax) + '</div></div>' +
                  '<div style="text-align:center;"><div style="font-size:9px;color:#64748b;font-weight:700;">NET</div><div id="oe-t-net" style="font-size:15px;font-weight:800;color:#16a34a;">' + fmt(t.net) + '</div></div>' +
                '</div>' +
              '</div>' +

              // ── Lines section ──
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                '<div style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.4px;">Order Lines (' + (st.lines || []).length + ')</div>' +
                '<button onclick="window._oePickItems()" style="border:none;background:linear-gradient(135deg,#0ea5e9,#0369a1);color:white;border-radius:7px;cursor:pointer;padding:5px 12px;font-size:11px;font-weight:700;"><i class="fas fa-plus"></i> Add Items…</button>' +
              '</div>' +
              '<div style="border:1px solid #e2e8f0;border-radius:8px;overflow:auto;max-height:320px;">' +
                '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
                  '<thead><tr style="background:#f8fafc;position:sticky;top:0;">' +
                    '<th style="padding:6px;text-align:center;">S.No</th><th style="padding:6px;text-align:left;">Item Code</th>' +
                    '<th style="padding:6px;text-align:left;">Description</th><th style="padding:6px;text-align:right;">Qty</th>' +
                    '<th style="padding:6px;text-align:right;">List Price</th><th style="padding:6px;text-align:right;">Disc %</th>' +
                    '<th style="padding:6px;text-align:right;">Selling</th><th style="padding:6px;text-align:right;">Tax</th>' +
                    '<th style="padding:6px;text-align:right;">Net</th><th></th>' +
                  '</tr></thead>' +
                  '<tbody id="oe-lines">' + (linesHtml || '<tr><td colspan="10" style="padding:1.4rem;text-align:center;color:#94a3b8;">No lines — click Add Items…</td></tr>') + '</tbody>' +
                '</table>' +
              '</div>' +
            '</div>' +

            // ── Footer ──
            '<div style="padding:0.7rem 1.2rem;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;gap:10px;flex-wrap:wrap;">' +
              '<div style="font-size:11px;color:#475569;display:flex;gap:14px;align-items:center;">' +
                '<label style="cursor:pointer;"><input type="radio" name="oe-route" value="db" checked> Save to WMS DB (interface later)</label>' +
                '<label style="cursor:pointer;"><input type="radio" name="oe-route" value="fusion"> Direct Fusion</label>' +
              '</div>' +
              '<div style="display:flex;gap:8px;">' +
                '<button onclick="window._oeClose()" style="padding:7px 16px;border:1px solid #e2e8f0;border-radius:8px;background:white;cursor:pointer;font-size:12px;font-weight:600;color:#64748b;">Cancel</button>' +
                '<button id="oe-submit" onclick="window._oeSubmit()" style="padding:7px 20px;border:none;border-radius:8px;background:#16a34a;cursor:pointer;font-size:12px;font-weight:800;color:white;"><i class="fas fa-check"></i> Create Order</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';

        document.body.insertAdjacentHTML('beforeend', html);

        // editable cells
        Array.prototype.forEach.call(document.querySelectorAll('#oe-modal .oe-cell'), function (inp) {
            inp.addEventListener('input', function () {
                var i = Number(inp.getAttribute('data-i'));
                var f = inp.getAttribute('data-f');
                if (st.lines[i]) { st.lines[i][f] = inp.value; st.lines[i]._auto = true; refreshLinesOnly(); }
            });
        });
    }

    // refresh computed cells + totals without rebuilding inputs (keeps focus)
    function refreshLinesOnly() {
        var rows = document.querySelectorAll('#oe-lines tr');
        (st.lines || []).forEach(function (l, i) {
            var c = lineCalc(l);
            var tds = rows[i] ? rows[i].children : null;
            if (!tds || tds.length < 9) return;
            tds[6].textContent = fmt(c.selling);
            tds[7].textContent = fmt(c.tax);
            tds[8].textContent = fmt(c.net);
        });
        var t = totals();
        var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = fmt(v); };
        set('oe-t-gross', t.gross); set('oe-t-discount', t.discount); set('oe-t-tax', t.tax); set('oe-t-net', t.net);
    }

    // ── pickers (customer / items) ──────────────────────────
    function pickerDialog(title, placeholder, onSearch, onPick, multi) {
        var old = document.getElementById('oe-picker');
        if (old) old.remove();
        var html =
        '<div id="oe-picker" style="position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:29500;display:flex;align-items:center;justify-content:center;">' +
          '<div style="background:white;width:92%;max-width:720px;max-height:80vh;border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.35);">' +
            '<div style="padding:0.7rem 1rem;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">' +
              '<div style="font-weight:800;font-size:12.5px;color:#334155;"><i class="fas fa-search"></i> ' + esc2(title) + '</div>' +
              '<button onclick="document.getElementById(\'oe-picker\').remove()" style="background:none;border:none;font-size:1.2rem;color:#64748b;cursor:pointer;">&times;</button>' +
            '</div>' +
            '<div style="padding:0.6rem 1rem;display:flex;gap:6px;">' +
              '<input type="text" id="oe-picker-q" placeholder="' + esc2(placeholder) + '" style="' + inputCss() + '">' +
              '<button id="oe-picker-go" style="border:none;background:#7c3aed;color:white;border-radius:7px;cursor:pointer;padding:0 14px;font-size:12px;font-weight:700;">Search</button>' +
            '</div>' +
            '<div id="oe-picker-res" style="flex:1;overflow-y:auto;padding:0 1rem 0.6rem;"><div style="font-size:11px;color:#94a3b8;padding:1rem;text-align:center;">Type at least 2 characters and search.</div></div>' +
            (multi ? '<div style="padding:0.6rem 1rem;border-top:1px solid #f1f5f9;text-align:right;"><button id="oe-picker-add" style="border:none;background:#16a34a;color:white;border-radius:7px;cursor:pointer;padding:7px 16px;font-size:12px;font-weight:700;"><i class="fas fa-plus"></i> Add selected</button></div>' : '') +
          '</div>' +
        '</div>';
        document.body.insertAdjacentHTML('beforeend', html);

        var doSearch = function () {
            var q = document.getElementById('oe-picker-q').value.trim();
            if (q.length < 2) return;
            document.getElementById('oe-picker-res').innerHTML = '<div style="padding:1rem;text-align:center;color:#64748b;"><i class="fas fa-spinner fa-spin"></i> Searching…</div>';
            onSearch(q);
        };
        document.getElementById('oe-picker-go').addEventListener('click', doSearch);
        document.getElementById('oe-picker-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
        if (multi) document.getElementById('oe-picker-add').addEventListener('click', function () { onPick(); });
        setTimeout(function () { document.getElementById('oe-picker-q').focus(); }, 50);
    }

    window._oePickCustomer = function () {
        if (!st.lookups.customersSql) {
            alert('Customer search SQL was not provided when this form was opened.\n\nClose the form and ask the assistant again — it must include _lookups.customersSql when opening the order form.');
            return;
        }
        pickerDialog('Search Customer', 'name / account number…', function (q) {
            runSql(bindSearch(st.lookups.customersSql, q), function (err, rows) {
                var box = document.getElementById('oe-picker-res');
                if (!box) return;
                if (err) { box.innerHTML = '<div style="padding:1rem;color:#dc2626;font-size:11px;">' + esc2(err) + '</div>'; return; }
                if (!rows.length) { box.innerHTML = '<div style="padding:1rem;color:#94a3b8;font-size:11px;text-align:center;">No customers match.</div>'; return; }
                box.innerHTML = rows.map(function (r, i) {
                    return '<div class="oe-cust-row" data-i="' + i + '" style="padding:7px 9px;border-bottom:1px solid #f1f5f9;cursor:pointer;font-size:11.5px;" onmouseover="this.style.background=\'#f5f3ff\'" onmouseout="this.style.background=\'\'">' +
                        '<b>' + esc2(r.ACCOUNT_NAME) + '</b> <span style="color:#64748b;">' + esc2(r.BILL_TO_CUSTOMER_NUMBER) + '</span>' +
                        '<span style="float:right;color:#0e7490;">' + esc2(r.PRICELIST || '') + '</span>' +
                        (r.LOCATION ? '<div style="color:#94a3b8;font-size:10px;">' + esc2(r.LOCATION) + '</div>' : '') + '</div>';
                }).join('');
                Array.prototype.forEach.call(box.querySelectorAll('.oe-cust-row'), function (el) {
                    el.addEventListener('click', function () {
                        var r = rows[Number(el.getAttribute('data-i'))];
                        st.header.customer_name = r.ACCOUNT_NAME;
                        st.header.bill_to_customer_number = r.BILL_TO_CUSTOMER_NUMBER;
                        st.header.cust_account_id = r.CUST_ACCOUNT_ID;
                        st.header.party_id = r.PARTY_ID;
                        st.header.site_use_id = r.SITE_USE_ID;
                        st.header.party_site_id = r.PARTY_SITE_ID;
                        if (r.PRICELIST) st.header.pricelist = r.PRICELIST;
                        if (r.LOCATION) st.header.location = r.LOCATION;
                        document.getElementById('oe-picker').remove();
                        captureHeader(); render();
                    });
                });
            });
        }, null, false);
    };

    window._oePickItems = function () {
        if (!st.lookups.itemsSql) { alert('Item search is not configured for this form.'); return; }
        var found = [];
        pickerDialog('Search Items — price list ' + (st.header.pricelist || ''), 'item code / description…', function (q) {
            var sql = bindSearch(st.lookups.itemsSql, q)
                .replace(/:PRICELIST/g, "'" + String(st.header.pricelist || '').replace(/'/g, "''") + "'");
            runSql(sql, function (err, rows) {
                var box = document.getElementById('oe-picker-res');
                if (!box) return;
                if (err) { box.innerHTML = '<div style="padding:1rem;color:#dc2626;font-size:11px;">' + esc2(err) + '</div>'; return; }
                if (!rows.length) { box.innerHTML = '<div style="padding:1rem;color:#94a3b8;font-size:11px;text-align:center;">No items match on this price list.</div>'; return; }
                found = rows;
                box.innerHTML =
                    '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
                    '<thead><tr style="background:#f8fafc;"><th></th><th style="padding:5px;text-align:left;">Item</th><th style="padding:5px;text-align:left;">Description</th><th style="padding:5px;text-align:right;">List Price</th><th style="padding:5px;text-align:right;">Qty</th></tr></thead><tbody>' +
                    rows.map(function (r, i) {
                        return '<tr style="border-bottom:1px solid #f1f5f9;">' +
                            '<td style="padding:5px;text-align:center;"><input type="checkbox" class="oe-item-cb" data-i="' + i + '"></td>' +
                            '<td style="padding:5px;font-weight:600;white-space:nowrap;">' + esc2(r.ITEM_CODE) + '</td>' +
                            '<td style="padding:5px;color:#475569;">' + esc2(r.ITEM_DESC) + '</td>' +
                            '<td style="padding:5px;text-align:right;">' + fmt(r.LIST_PRICE) + '</td>' +
                            '<td style="padding:2px;text-align:right;"><input type="number" min="1" step="1" value="1" class="oe-item-qty" data-i="' + i + '" style="width:56px;padding:4px;border:1px solid #e2e8f0;border-radius:5px;font-size:11px;text-align:right;"></td></tr>';
                    }).join('') + '</tbody></table>';
            });
        }, function () {
            var cbs = document.querySelectorAll('#oe-picker .oe-item-cb:checked');
            if (!cbs.length) return;
            Array.prototype.forEach.call(cbs, function (cb) {
                var i = Number(cb.getAttribute('data-i'));
                var r = found[i];
                var qtyEl = document.querySelector('#oe-picker .oe-item-qty[data-i="' + i + '"]');
                st.lines.push({
                    item_code: r.ITEM_CODE, item_description: r.ITEM_DESC,
                    quantity: qtyEl ? (Number(qtyEl.value) || 1) : 1,
                    uom: r.UOM || 'UN',
                    list_price: num(r.LIST_PRICE), discount_per: 0,
                    tax_rate: num(r.TAX_RATE), tax_code: r.TAX_CODE || '',
                    inventory_item_id: r.INVENTORY_ITEM_ID || ''
                });
            });
            document.getElementById('oe-picker').remove();
            captureHeader(); render();
        }, true);
    };

    window._oeDelLine = function (i) {
        st.lines.splice(i, 1);
        captureHeader(); render();
    };

    function captureHeader() {
        ['order_date', 'currency_code', 'pricelist', 'salesrep_number', 'order_type',
         'warehouse', 'subinventory', 'po_number', 'comments'].forEach(function (k) {
            var el = document.getElementById('oe-h-' + k);
            if (el) st.header[k] = el.value;
        });
    }

    window._oeClose = function () {
        var m = document.getElementById('oe-modal'); if (m) m.remove();
        var p = document.getElementById('oe-picker'); if (p) p.remove();
        if (st && typeof st.onCancel === 'function') st.onCancel();
        st = null;
    };

    // ── submit ──────────────────────────────────────────────
    window._oeSubmit = function () {
        captureHeader();
        var h = st.header;
        if (!h.customer_name) { alert('Pick a customer first.'); return; }
        if (!(st.lines || []).length) { alert('Add at least one line.'); return; }
        if (!h.order_type) { alert('Select an order type.'); return; }

        var route = (document.querySelector('input[name="oe-route"]:checked') || {}).value || 'db';
        var t = totals();

        // form values in order.create shape (buildBody wraps them for NEWORDER)
        var values = {
            customer_name: h.customer_name, bill_to_customer_number: h.bill_to_customer_number,
            cust_account_id: h.cust_account_id, party_id: h.party_id,
            site_use_id: h.site_use_id, party_site_id: h.party_site_id,
            order_type: h.order_type, order_date: h.order_date,
            po_number: h.po_number, salesrep_number: h.salesrep_number,
            agent_name: h.agent_name || '', location: h.location || '',
            warehouse: h.warehouse, subinventory: h.subinventory,
            pricelist: h.pricelist, currency_code: h.currency_code,
            login_id: h.login_id || 'ORDERFORM', comments: h.comments,
            lines: st.lines.map(function (l) {
                var c = lineCalc(l);
                return {
                    item_code: l.item_code, item_description: l.item_description,
                    quantity: c.qty, uom: l.uom || 'UN',
                    selling_price: c.selling, list_price: c.list,
                    discount_per: c.disc, tax_amount: c.tax,
                    tax_code: l.tax_code || '', inventory_item_id: l.inventory_item_id || ''
                };
            }),
            totals: t
        };

        var done = st.onSubmit;
        var btn = document.getElementById('oe-submit');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating…'; }
        done(route, values, function () {
            var m = document.getElementById('oe-modal'); if (m) m.remove();
            st = null;
        }, function (errMsg) {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Create Order'; }
            alert('Order creation failed: ' + errMsg);
        });
    };

    // ── entry point ─────────────────────────────────────────
    // cfg: { values: {header fields + lines + _lookups}, onSubmit(route, values, ok, fail), onCancel() }
    window.openOrderEntryForm = function (cfg) {
        var v = cfg.values || {};
        var lk = v._lookups || {};
        st = {
            header: {
                order_date: v.order_date || new Date().toISOString().slice(0, 10),
                currency_code: v.currency_code || 'MUR',
                customer_name: v.customer_name || '', bill_to_customer_number: v.bill_to_customer_number || '',
                cust_account_id: v.cust_account_id || '', party_id: v.party_id || '',
                site_use_id: v.site_use_id || '', party_site_id: v.party_site_id || '',
                pricelist: v.pricelist || '', salesrep_number: v.salesrep_number || '',
                order_type: v.order_type || '', warehouse: v.warehouse || 'SHOPS',
                subinventory: v.subinventory || '', po_number: v.po_number || '',
                agent_name: v.agent_name || '', location: v.location || '',
                login_id: v.login_id || '', comments: v.comments || ''
            },
            lines: (v.lines || []).map(function (l) {
                return {
                    item_code: l.item_code, item_description: l.item_description,
                    quantity: l.quantity || 1, uom: l.uom || 'UN',
                    list_price: num(l.list_price), discount_per: num(l.discount_per),
                    tax_rate: num(l.tax_rate), tax_code: l.tax_code || '',
                    inventory_item_id: l.inventory_item_id || ''
                };
            }),
            lookups: {
                customersSql: lk.customersSql || '', itemsSql: lk.itemsSql || '',
                salesreps: lk.salesreps || [], orderTypes: lk.orderTypes || [],
                warehouses: lk.warehouses || [], subinventories: lk.subinventories || []
            },
            onSubmit: cfg.onSubmit, onCancel: cfg.onCancel
        };
        console.log('[OrderEntry] lookups received:', {
            customersSql: !!lk.customersSql, itemsSql: !!lk.itemsSql,
            salesreps: (lk.salesreps || []).length || (lk.salesrepsSql ? 'sql' : 0),
            orderTypes: (lk.orderTypes || []).length || (lk.orderTypesSql ? 'sql' : 0),
            warehouses: (lk.warehouses || []).length || (lk.warehousesSql ? 'sql' : 0),
            subinventories: (lk.subinventories || []).length || (lk.subinventoriesSql ? 'sql' : 0)
        });
        render();

        // Dropdown lists may arrive as SQL instead of arrays - the form
        // loads them itself on open (saves the model's round budget)
        var pendingLoads = 0;
        function loadList(sql, map, assign) {
            if (!sql) return;
            pendingLoads++;
            runSql(sql, function (err, rows) {
                pendingLoads--;
                if (err) { console.warn('[OrderEntry] list load failed:', err); return; }
                assign(rows.map(map));
                if (pendingLoads === 0 && st) { captureHeader(); render(); }
            });
        }
        if (!st.lookups.salesreps.length && lk.salesrepsSql)
            loadList(lk.salesrepsSql,
                function (r) { return { number: r.SALESREP_NUMBER || r.NUMBER || Object.values(r)[0], name: r.SALESREP_NAME || r.NAME || Object.values(r)[1] || '' }; },
                function (v) { st.lookups.salesreps = v; });
        if (!st.lookups.orderTypes.length && lk.orderTypesSql)
            loadList(lk.orderTypesSql,
                function (r) { return r.ORDER_TYPE || Object.values(r)[0]; },
                function (v) { st.lookups.orderTypes = v; });
        if (!st.lookups.warehouses.length && lk.warehousesSql)
            loadList(lk.warehousesSql,
                function (r) { return r.WAREHOUSE || Object.values(r)[0]; },
                function (v) { st.lookups.warehouses = v; });
        if (!st.lookups.subinventories.length && lk.subinventoriesSql)
            loadList(lk.subinventoriesSql,
                function (r) { return r.SUBINVENTORY || Object.values(r)[0]; },
                function (v) { st.lookups.subinventories = v; });
    };
})();
