/* Fusion Inventory — Item Master, Subinventories, Inventory Transactions, Settings.
   Other views: inv-onhand.js, inv-transfers.js, inv-itemload.js, inv-stock.js. Helpers: inv-util.js (IU). */

var INV = {};
var ATTR_LABELS = ['Brand', 'Type', 'RMA', 'Rep Status', 'Category', 'Attr 6', 'Attr 7', 'Attr 8', 'Attr 9', 'Attr 10'];

// ═══ Item Master ═══════════════════════════════════════════════
INV.itemMaster = {
    id: 'items', label: 'Item Master', icon: 'fa-barcode', group: 'Items', desc: 'Search items of one organization and export them',
    render: function (el) {
        var st = { src: IU.cfg('itemSource'), rows: [], tok: null, org: '' }, grid;
        el.innerHTML =
            '<div class="card"><div class="filters">' +
            '<label>Source<div class="seg" id="im-src"><button data-s="rest">Fusion REST</button><button data-s="sql">Fusion SQL</button></div></label>' +
            '<label><span>Organization <b style="color:var(--err)">*</b></span><select id="im-org"></select></label>' +
            '<label>Item Number' + IU.inp('im-item', 'starts with…') + '</label>' +
            '<label>Description' + IU.inp('im-desc', 'starts with…') + '</label>' +
            '<label>Status<select id="im-status"><option value="">All</option><option>Active</option><option>Inactive</option><option>Obsolete</option></select></label>' +
            '<label data-sqlonly>Universal search' + IU.inp('im-any', 'item, description, brand…') + '</label>' +
            '<label data-sqlonly>Brand (attr1)' + IU.inp('im-a1', '') + '</label>' +
            '<label data-sqlonly>Category (attr5)' + IU.inp('im-a5', '') + '</label>' +
            '<div class="go"><button class="btn" id="im-reset"><i class="fa-solid fa-eraser"></i> Reset</button><button class="btn danger" id="im-cancel" hidden><i class="fa-solid fa-stop"></i> Cancel</button>' +
            '<button class="btn" id="im-xlsx"><i class="fa-solid fa-file-excel"></i> Excel</button><button class="btn primary" id="im-go"><i class="fa-solid fa-magnifying-glass"></i> Search</button></div></div>' +
            '<div class="note" id="im-srcnote" style="margin:0 12px 10px"></div></div>' +
            '<div id="im-prog" hidden class="row-btns"><div class="prog" style="flex:1"><div id="im-bar"></div></div><span class="muted" id="im-pt" style="font-size:.78rem"></span></div>' +
            '<div id="im-kpis"></div><div id="im-grid" style="display:flex;flex-direction:column;flex:1;min-height:0"></div>';
        IU.orgOptions('im-org', lsGet('fxinv_im_org', ''), '— select —');
        function setSrc(s) {
            st.src = s;
            Array.prototype.forEach.call($('im-src').children, function (b) { b.classList.toggle('on', b.getAttribute('data-s') === s); });
            Array.prototype.forEach.call(el.querySelectorAll('[data-sqlonly]'), function (l) { l.hidden = s !== 'sql'; });
            $('im-srcnote').innerHTML = s === 'rest' ? '<i class="fa-solid fa-circle-info"></i> Fusion REST <b>itemsV2</b> — item number / description are "starts with" matches. Universal search, brand and category need the SQL source.'
                : '<i class="fa-solid fa-database"></i> Read-only Fusion SQL on <b>EGP_SYSTEM_ITEMS_B</b> (+ TL, INV_ORG_PARAMETERS) — contains matches, brand / category from ATTRIBUTE1 / ATTRIBUTE5, up to ' + IU.cfg('sqlLimit') + ' rows. Barcodes are not stored in the item master, so there is no barcode filter.';
        }
        $('im-src').onclick = function (e) { var b = e.target.closest('[data-s]'); if (b) setSrc(b.getAttribute('data-s')); };
        setSrc(st.src);
        IU.enter(['im-item', 'im-desc', 'im-any', 'im-a1', 'im-a5'], search);
        $('im-go').onclick = search;
        $('im-cancel').onclick = function () { if (st.tok) st.tok.cancel = true; };
        $('im-reset').onclick = function () { ['im-item', 'im-desc', 'im-any', 'im-a1', 'im-a5'].forEach(function (i) { $(i).value = ''; }); $('im-status').innerHTML = '<option value="">All</option><option>Active</option><option>Inactive</option><option>Obsolete</option>'; st.rows = []; grid.refresh(); drawKpis(); };
        $('im-xlsx').onclick = exportXlsx;

        grid = IU.localGrid($('im-grid'), {
            id: 'im', rows: function () { return st.rows; }, csvName: 'ItemMaster', key: 'inventory_item_id', emptyText: 'Pick an organization and search.',
            columns: [
                { f: 'item_number', label: 'Item Number', html: function (r) { return '<span class="tag code">' + esc(r.item_number) + '</span>'; } },
                { f: 'description', label: 'Description' }, { f: 'organization_code', label: 'Org' }, { f: 'primary_uom_code', label: 'UOM' },
                { f: 'inventory_item_status_code', label: 'Status', html: function (r) { return r.inventory_item_status_code ? '<span class="chip ' + (/^active$/i.test(r.inventory_item_status_code) ? 'ok' : 'err') + '">' + esc(r.inventory_item_status_code) + '</span>' : ''; } },
                { f: 'item_price', label: 'Price', n: 1, html: function (r) { return IU.n4(r.item_price); } },
                { f: 'sales_account', label: 'Sales Account', html: function (r) { var s = r.sales_account == null ? '' : String(r.sales_account); return '<span title="' + esc(s) + '">' + esc(s.length > 10 ? s.slice(0, 10) + '…' : s) + '</span>'; } },
                { f: 'inventory_item_flag', label: 'Inv', html: function (r) { return IU.ynTag(r.inventory_item_flag); } },
                { f: 'stock_enabled_flag', label: 'Stock', html: function (r) { return IU.ynTag(r.stock_enabled_flag); } },
                { f: 'attribute1', label: 'Brand' }, { f: 'attribute2', label: 'Type' }, { f: 'attribute3', label: 'RMA' }, { f: 'attribute4', label: 'Rep Status' }, { f: 'attribute5', label: 'Category' }
            ],
            rowActions: [{ label: 'View all details', icon: 'fa-list', when: function (r) { return !!r.fusion_data; }, run: function (r) { IU.allFields(r.item_number + ' · ' + r.organization_code, r.fusion_data); } },
                { label: 'Details', icon: 'fa-eye', run: function (r) { detail(r); } }],
            onRow: function (r) { detail(r); }
        });
        drawKpis();

        function mapFusion(r) {
            var o = {
                inventory_item_id: IU.first(r, ['ItemId', 'InventoryItemId']), item_number: r.ItemNumber, description: IU.first(r, ['ItemDescription', 'Description']),
                primary_uom_code: IU.first(r, ['PrimaryUOMValue', 'PrimaryUnitOfMeasureValue', 'PrimaryUOMCode', 'PrimaryUnitOfMeasure']),
                inventory_item_status_code: IU.first(r, ['ItemStatusValue', 'ItemStatus', 'ApprovalStatusValue']),
                organization_code: r.OrganizationCode, inventory_org_code: r.OrganizationCode, sales_account: r.SalesAccountValue, item_price: IU.first(r, ['ListPrice', 'UnitPrice']),
                inventory_item_flag: r.InventoryItemFlag, stock_enabled_flag: r.StockEnabledFlag, inventory_asset_flag: r.InventoryAssetFlag,
                barcode: null, old_item_code: '', instance_name: FX.instance, fusion_data: r
            };
            for (var i = 1; i <= 10; i++) o['attribute' + i] = r['Attribute' + i];
            return o;
        }
        function search() {
            var org = $('im-org').value; if (!org) { FX.toast('Organization is required.', 'err'); return; }
            lsSet('fxinv_im_org', org); st.org = org;
            var item = $('im-item').value.trim(), desc = $('im-desc').value.trim(), status = $('im-status').value;
            st.tok = { cancel: false }; var tok = st.tok;
            $('im-cancel').hidden = false; $('im-prog').hidden = false; $('im-bar').style.width = '5%'; $('im-pt').textContent = 'Searching…';
            grid.loading('Reading items…');
            var job;
            if (st.src === 'rest') {
                var q = ['OrganizationCode=' + FX.qv(org)];
                if (item) q.push('ItemNumber LIKE ' + FX.qv(item.replace(/\*/g, '%') + '%'));
                if (desc) q.push('ItemDescription LIKE ' + FX.qv(desc.replace(/\*/g, '%') + '%'));
                if (status) q.push('ItemStatusValue=' + FX.qv(status));
                job = IU.pages('itemsV2', { q: q.join(';') }, 200, 20000, function (n, t) {
                    $('im-bar').style.width = (t ? Math.min(100, n / t * 100) : 50) + '%'; $('im-pt').textContent = 'Loaded ' + n + (t ? ' of ' + t : '') + ' items…';
                }, tok).then(function (r) { return { rows: r.rows.map(mapFusion), cancelled: r.cancelled, total: r.total }; });
            } else {
                var w = ['p.organization_code = ' + IU.sqlLit(org)];
                var like = function (col, v) { return 'UPPER(' + col + ') LIKE ' + IU.sqlLit('%' + v.toUpperCase().replace(/\*/g, '%') + '%'); };
                if (item) w.push(like('b.item_number', item));
                if (desc) w.push(like('t.description', desc));
                if (status) w.push('UPPER(b.inventory_item_status_code) = ' + IU.sqlLit(status.toUpperCase()));
                var any = $('im-any').value.trim(), a1 = $('im-a1').value.trim(), a5 = $('im-a5').value.trim();
                if (any) w.push('(' + ['b.item_number', 't.description', 'b.attribute1', 'b.attribute2', 'b.attribute5'].map(function (c) { return like(c, any); }).join(' OR ') + ')');
                if (a1) w.push(like('b.attribute1', a1));
                if (a5) w.push(like('b.attribute5', a5));
                var sql = 'SELECT b.inventory_item_id, b.item_number, t.description, b.primary_uom_code, b.inventory_item_status_code, p.organization_code, ' +
                    'b.sales_account, b.list_price_per_unit item_price, b.inventory_item_flag, b.stock_enabled_flag, b.inventory_asset_flag, ' +
                    'b.attribute1, b.attribute2, b.attribute3, b.attribute4, b.attribute5, b.attribute6, b.attribute7, b.attribute8, b.attribute9, b.attribute10 ' +
                    'FROM egp_system_items_b b JOIN inv_org_parameters p ON p.organization_id = b.organization_id ' +
                    "LEFT JOIN egp_system_items_tl t ON t.inventory_item_id = b.inventory_item_id AND t.organization_id = b.organization_id AND t.language = USERENV('LANG') " +
                    'WHERE ' + w.join(' AND ') + ' ORDER BY b.item_number';
                job = FX.sql(sql, +IU.cfg('sqlLimit') || 5000).then(function (rows) {
                    return { rows: rows.map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toLowerCase()] = r[k]; }); o.inventory_org_code = o.organization_code; o.instance_name = FX.instance; o.barcode = null; o.old_item_code = ''; return o; }) };
                });
            }
            job.then(function (r) {
                if (tok !== st.tok) return;
                st.rows = r.rows; grid.refresh(); drawKpis();
                var sts = IU.distinct(st.rows.map(function (x) { return x.inventory_item_status_code; })).sort();
                if (sts.length) $('im-status').innerHTML = '<option value="">All</option>' + sts.map(function (s) { return '<option' + (s === status ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
                $('im-pt').textContent = st.rows.length + ' items' + (r.cancelled ? ' (cancelled — partial)' : '') + (r.total != null && r.total > st.rows.length ? ' · ' + r.total + ' in Fusion' : '');
                $('im-bar').style.width = '100%';
            }).catch(function (e) { grid.error(e); $('im-pt').textContent = 'Failed'; })
                .then(function () { $('im-cancel').hidden = true; setTimeout(function () { var pe = $('im-prog'); if (pe && tok === st.tok) pe.hidden = true; }, 2500); });
        }
        function drawKpis() {
            var list = [{ label: 'Items Found', value: st.rows.length.toLocaleString() }];
            for (var i = 1; i <= 5; i++) list.push({ label: ATTR_LABELS[i - 1], value: IU.distinct(st.rows.map(function (r) { return r['attribute' + i]; })).length, k: 'a' + i, tip: 'Show values and counts' });
            $('im-kpis').innerHTML = IU.stats(list);
            $('im-kpis').onclick = function (e) { var k = e.target.closest('[data-k]'); if (k) attrDrawer(+k.getAttribute('data-k').slice(1)); };
        }
        function attrDrawer(i) {
            var cnt = {}; st.rows.forEach(function (r) { var v = r['attribute' + i]; v = v == null || v === '' ? '(blank)' : String(v); cnt[v] = (cnt[v] || 0) + 1; });
            var list = Object.keys(cnt).map(function (k) { return { v: k, n: cnt[k] }; }).sort(function (a, b) { return b.n - a.n; });
            FX.drawer({
                title: ATTR_LABELS[i - 1] + ' values', sub: list.length + ' distinct · ' + st.rows.length + ' items · click a value to filter the list',
                extra: FX.table(list, [{ label: ATTR_LABELS[i - 1], html: function (r) { return '<button class="lnk" data-av="' + esc(r.v) + '">' + esc(r.v) + '</button>'; } }, { f: 'n', label: 'Items', n: 1 }]),
                onDetails: function (b) { b.onclick = function (e) { var a = e.target.closest('[data-av]'); if (!a) return; var qi = $('im-grid').querySelector('[data-g="quick"]'); qi.value = a.getAttribute('data-av') === '(blank)' ? '' : a.getAttribute('data-av'); qi.dispatchEvent(new Event('input')); FX.closeDrawer(); }; }
            });
        }
        function detail(r) {
            var f = function (l, v) { return [l, esc(v)]; };
            var sec = function (t, list) { return '<div class="facts-sec"><h4>' + t + '</h4><div class="facts">' + list.map(function (x) { return '<div><span>' + x[0] + '</span>' + (x[1] === '' ? '<span class="muted" style="display:inline;text-transform:none">—</span>' : x[1]) + '</div>'; }).join('') + '</div></div>'; };
            var yn = function (v) { return v === 'Y' || v === true || v === 'true' ? 'Yes' : 'No'; };
            FX.drawer({
                title: esc(r.item_number), sub: esc(r.description || ''), raw: r.fusion_data || r,
                chips: [r.inventory_item_status_code ? '<span class="chip ' + (/^active$/i.test(r.inventory_item_status_code) ? 'ok' : 'err') + '">' + esc(r.inventory_item_status_code) + '</span>' : '', '<span class="chip">' + esc(r.organization_code) + '</span>'],
                extra: sec('Basic Information', [f('Item Number', r.item_number), f('Old Item Code', r.old_item_code), f('Barcode', r.barcode), f('Description', r.description), f('UOM', r.primary_uom_code), f('Organization', r.organization_code), f('Inv Org Code', r.inventory_org_code), f('Instance', r.instance_name)]) +
                    sec('Pricing & Accounting', [['Item Price', '<b style="color:var(--ok)">' + esc(IU.n4(r.item_price)) + '</b>'], f('Sales Account', r.sales_account), f('Status', r.inventory_item_status_code)]) +
                    sec('Inventory Flags', [f('Inventory Item', yn(r.inventory_item_flag)), f('Stock Enabled', yn(r.stock_enabled_flag)), f('Inventory Asset', yn(r.inventory_asset_flag))]) +
                    sec('Attributes', ATTR_LABELS.map(function (l, i) { return f(l, r['attribute' + (i + 1)]); })),
                tabs: r.fusion_data ? [{ label: 'All fields', render: function (b) { b.innerHTML = '<div class="facts">' + Object.keys(r.fusion_data).filter(function (k) { var v = r.fusion_data[k]; return k !== 'links' && v != null && v !== '' && typeof v !== 'object'; }).sort().map(function (k) { return '<div><span>' + esc(IU.label(k)) + '</span>' + IU.cell(k, r.fusion_data[k]) + '</div>'; }).join('') + '</div>'; } }] : []
            });
        }
        function exportXlsx() {
            var rows = grid.visible(); if (!rows.length) { FX.toast('Nothing to export — search first.', 'err'); return; }
            var filt = [['Item', $('im-item').value], ['Desc', $('im-desc').value], ['Status', $('im-status').value], ['Search', $('im-any').value]].filter(function (x) { return x[1]; }).map(function (x) { return x[0] + ': ' + x[1]; }).join(' | ') || 'All items';
            var c = function (label, f, o) { return Object.assign({ label: label, get: typeof f === 'function' ? f : function (r) { return r[f]; } }, o || {}); };
            var cols = [c('Item Number', 'item_number', { width: 22 }), c('Description', 'description', { width: 40 }), c('Old Item Code', 'old_item_code'), c('Barcode', 'barcode'), c('Org Code', 'organization_code'), c('Inv Org Code', 'inventory_org_code'),
                c('UOM', 'primary_uom_code'), c('Status', 'inventory_item_status_code'), c('Price', 'item_price', { num: true, fmt: '#,##0.00' }), c('Sales Account', 'sales_account'), c('Inv Flag', 'inventory_item_flag'), c('Stock Flag', 'stock_enabled_flag'), c('Asset Flag', 'inventory_asset_flag')]
                .concat(ATTR_LABELS.map(function (l, i) { return c(l, 'attribute' + (i + 1)); })).concat([c('Instance', 'instance_name')]);
            IU.xlsx('ItemMaster_' + st.org + '_' + FX.today() + '.xlsx', { name: 'Item Master', title: 'Item Master — ' + st.org, sub: [filt, 'Exported: ' + new Date().toLocaleString() + ' | Records: ' + rows.length], cols: cols, rows: rows });
        }
    }
};

// ═══ Subinventories ════════════════════════════════════════════
INV.subinventories = {
    id: 'subinv', label: 'Subinventories', icon: 'fa-warehouse', group: 'Stock', desc: 'Subinventories and locator control by business unit and organization',
    render: function (el) {
        var st = { rows: [], orgs: [], all: false }, grid;
        el.innerHTML = IU.filterCard([{ label: 'Business Unit', html: '<select id="sb-bu"><option value="">Loading…</option></select>' }, { label: 'Organization', html: '<select id="sb-org"><option value="">— pick a business unit —</option></select>' }],
            '<button class="btn" id="sb-all" hidden><i class="fa-solid fa-layer-group"></i> Search all subinventories</button>') +
            '<div id="sb-grid" style="display:flex;flex-direction:column;flex:1;min-height:0;gap:10px"></div>';
        FX.restAll('payablesOptions', { fields: 'businessUnitId,businessUnitName,paymentCurrency,ledgerCurrency' }, 2000).then(function (r) {
            var seen = {}, list = [];
            r.forEach(function (b) { if (b.businessUnitName && !seen[b.businessUnitName]) { seen[b.businessUnitName] = 1; list.push(b); } });
            list.sort(function (a, b) { return String(a.businessUnitName).localeCompare(b.businessUnitName); });
            $('sb-bu').innerHTML = '<option value="">— select —</option>' + list.map(function (b) { return '<option value="' + esc(b.businessUnitId) + '">' + esc(b.businessUnitName) + '</option>'; }).join('');
            var last = lsGet('fxinv_sb_bu', ''); if (last && list.some(function (b) { return String(b.businessUnitId) === String(last); })) { $('sb-bu').value = last; buChanged(); }
        }).catch(function (e) { $('sb-bu').innerHTML = '<option value="">(could not load)</option>'; FX.toast(String(e), 'err'); });
        $('sb-bu').onchange = buChanged;
        $('sb-org').onchange = orgChanged;
        $('sb-all').onclick = searchAll;
        grid = IU.localGrid($('sb-grid'), {
            id: 'sb', rows: function () { return st.rows; }, csvName: 'subinventories', emptyText: 'Pick a business unit and an organization.',
            kpis: function (rows) { return rows.length ? [{ k: 'w', label: 'Warehouses', value: IU.distinct(rows.map(function (r) { return r.WarehouseCode; })).length }, { k: 's', label: 'Subinventories', value: rows.length }].concat(st.all ? [{ k: 'o', label: 'Organizations', value: IU.distinct(rows.map(function (r) { return r._org; })).length }] : []) : []; },
            columns: [
                { label: 'Organization', get: function (r) { return r._org + ' ' + (r._orgName || ''); }, html: function (r) { return '<b>' + esc(r._org) + '</b><span class="sub2">' + esc(r._orgName || '') + '</span>'; } },
                { label: 'Warehouse', get: function (r) { return (r.WarehouseCode || '') + ' ' + (r.WarehouseName || ''); }, html: function (r) { return esc(r.WarehouseCode || '') + '<span class="sub2">' + esc(r.WarehouseName || '') + '</span>'; } },
                { label: 'Subinventory', get: function (r) { return (r.SubinventoryCode || '') + ' ' + (r.SecondaryInventoryName || r.SubinventoryName || ''); }, html: function (r) { return '<b>' + esc(r.SubinventoryCode || r.SecondaryInventoryName || '') + '</b><span class="sub2">' + esc(r.SecondaryInventoryName || r.SubinventoryName || '') + '</span>'; } },
                { label: 'Description', f: 'Description' },
                { label: 'Locator Control', get: function (r) { return r.LocatorControlMeaning || ''; }, html: function (r) { return (r.LocatorControlMeaning ? '<span class="chip info">' + esc(r.LocatorControlMeaning) + '</span>' : '') + (r.LocatorControl != null ? '<span class="sub2">(' + esc(r.LocatorControl) + ')</span>' : ''); } },
                { label: 'Locator Structure', get: function (r) { return r.LocatorStructure || '—'; } }
            ],
            onRow: function (r) { FX.drawer({ title: esc(r.SecondaryInventoryName || r.SubinventoryCode), sub: esc(r._org + ' · ' + (r._orgName || '')), raw: r, facts: Object.keys(r).filter(function (k) { return k !== 'links' && r[k] != null && r[k] !== '' && typeof r[k] !== 'object' && k.charAt(0) !== '_'; }).map(function (k) { return [IU.label(k), IU.cell(k, r[k])]; }) }); }
        });
        function buChanged() {
            var bu = $('sb-bu').value; lsSet('fxinv_sb_bu', bu);
            st.rows = []; st.orgs = []; st.all = false; grid.refresh(); $('sb-all').hidden = true;
            if (!bu) { $('sb-org').innerHTML = '<option value="">— pick a business unit —</option>'; return; }
            $('sb-org').innerHTML = '<option value="">Loading…</option>';
            FX.restAll('inventoryOrganizations', { q: 'ManagementBusinessUnitId=' + bu, fields: 'OrganizationCode,OrganizationName,OrganizationId' }, 2000).then(function (r) {
                var seen = {}; st.orgs = r.filter(function (o) { if (seen[o.OrganizationCode]) return false; seen[o.OrganizationCode] = 1; return true; }).sort(function (a, b) { return String(a.OrganizationCode).localeCompare(b.OrganizationCode); });
                $('sb-org').innerHTML = '<option value="">— all / pick one (' + st.orgs.length + ') —</option>' + st.orgs.map(function (o) { return '<option value="' + esc(o.OrganizationCode) + '">' + esc(o.OrganizationCode + ' — ' + (o.OrganizationName || o.OrganizationCode)) + '</option>'; }).join('');
                $('sb-all').hidden = !st.orgs.length;
            }).catch(function (e) { $('sb-org').innerHTML = '<option value="">(could not load)</option>'; FX.toast(String(e), 'err'); });
        }
        function subsOf(code) { return FX.restAll('subinventories', { q: 'OrganizationCode=' + FX.qv(code) }, 5000); }
        function tag(rows, o) { return rows.map(function (r) { r._org = o.OrganizationCode; r._orgName = o.OrganizationName || o.OrganizationCode; return r; }); }
        function orgChanged() {
            var code = $('sb-org').value; st.all = false;
            $('sb-all').hidden = !!code || !st.orgs.length;
            if (!code) { st.rows = []; grid.refresh(); return; }
            var o = st.orgs.filter(function (x) { return x.OrganizationCode === code; })[0] || { OrganizationCode: code };
            grid.loading('Reading subinventories of ' + code + '…');
            subsOf(code).then(function (r) { st.rows = tag(r, o); grid.refresh(); }).catch(grid.error);
        }
        function searchAll() {
            st.all = true; grid.loading('Reading subinventories of ' + st.orgs.length + ' organizations…');
            IU.mapLimit(st.orgs, 6, function (o) { return subsOf(o.OrganizationCode).then(function (r) { return tag(r, o); }); }).then(function (res) {
                st.rows = []; var n = 0; res.forEach(function (x) { if (x.ok) { st.rows = st.rows.concat(x.v); if (x.v.length) n++; } });
                grid.refresh(); FX.toast('Found ' + st.rows.length + ' subinventories across ' + n + ' organizations');
            });
        }
    }
};

// ═══ Review Inventory Transactions ═════════════════════════════
INV.txns = {
    id: 'txns', label: 'Inventory Transactions', icon: 'fa-right-left', group: 'Movements', desc: 'Completed inventory transactions for one organization',
    render: function (el) {
        var F = function (r, k) { return IU.first(r, k); };
        var g = FX.grid(el, {
            id: 'tx', resource: 'inventoryCompletedTransactions', csvName: 'inventory_transactions',
            filters: [
                { id: 'org', label: 'Organization *', type: 'lov', lov: function () { return FX.lov('orgs').then(function (l) { return l.map(function (o) { return { v: o.v, t: o.v }; }); }); }, blank: '— select —', value: lsGet('fxinv_tx_org', '') },
                { id: 'item', label: 'Item (starts with)', ph: 'item number…' },
                { id: 'op', label: 'Date', type: 'select', options: IU.ops.map(function (o) { return { v: o, t: o }; }), value: '>' },
                { id: 'date', label: 'Transaction date', type: 'date', value: FX.daysAgo(7) }
            ],
            actions: [{ label: 'Reset', icon: 'fa-eraser', run: function (gg) { gg.setVal('item', ''); gg.setVal('op', '>'); gg.setVal('date', FX.daysAgo(7)); } }],
            validate: function (gg) { if (!gg.val('org')) return 'Select an organization first'; },
            load: function (gg) {
                lsSet('fxinv_tx_org', gg.val('org'));
                var q = ['Organization=' + FX.qv(gg.val('org'))];
                if (gg.val('item')) q.push('Item LIKE ' + FX.qv(gg.val('item') + '%'));
                if (gg.val('date')) q.push('TransactionDate' + (gg.val('op') || '>') + gg.val('date'));
                gg.hasMore = false;
                return FX.restAll('inventoryCompletedTransactions', { q: q.join(';'), orderBy: 'TransactionDate:desc', limit: 500 }, 20000, function (n) { var b = el.querySelector('[data-g="body"]'); if (b) b.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Loaded ' + n + ' transactions…</div>'; });
            },
            kpis: function (rows) {
                if (!rows.length) return [];
                var neg = rows.filter(function (r) { return (IU.num(F(r, ['TransactionQuantity', 'PrimaryQuantity', 'Quantity'])) || 0) < 0; }).length;
                return [{ k: 'all', label: 'Transactions', value: rows.length }, { k: 'in', label: 'Receipts (+)', value: rows.length - neg, filter: function (r) { return (IU.num(F(r, ['TransactionQuantity', 'PrimaryQuantity', 'Quantity'])) || 0) >= 0; } },
                    { k: 'out', label: 'Issues (−)', value: neg, filter: function (r) { return (IU.num(F(r, ['TransactionQuantity', 'PrimaryQuantity', 'Quantity'])) || 0) < 0; } },
                    { k: 'items', label: 'Items', value: IU.distinct(rows.map(function (r) { return F(r, ['Item', 'ItemNumber']); })).length }];
            },
            columns: [
                { label: 'Transaction Date', get: function (r) { return F(r, ['TransactionDate', 'CreationDate']); }, html: function (r) { return esc(IU.dt(F(r, ['TransactionDate', 'CreationDate']))); } },
                { label: 'Transaction Type', get: function (r) { return F(r, ['TransactionType', 'TransactionTypeName', 'TransactionAction']); } },
                { label: 'Item', get: function (r) { return F(r, ['Item', 'ItemNumber']); }, html: function (r) { return '<span class="tag code">' + esc(F(r, ['Item', 'ItemNumber'])) + '</span>'; } },
                { label: 'Description', get: function (r) { return F(r, ['ItemDescription', 'Description']); } },
                { label: 'Org', get: function (r) { return F(r, ['Organization', 'OrganizationCode']); } },
                { label: 'Subinventory', get: function (r) { return F(r, ['Subinventory', 'SubinventoryCode']); } },
                { label: 'Locator', get: function (r) { return F(r, ['Locator', 'LocatorName']); } },
                { label: 'Quantity', n: 1, get: function (r) { return IU.num(F(r, ['TransactionQuantity', 'PrimaryQuantity', 'Quantity'])); }, html: function (r) { var q = IU.num(F(r, ['TransactionQuantity', 'PrimaryQuantity', 'Quantity'])); return '<span class="' + (q < 0 ? 'qty-neg' : '') + '">' + IU.qty(q) + '</span> <span class="muted">' + esc(F(r, ['TransactionUOM', 'TransactionUnitOfMeasure', 'UOMCode', 'UOM']) || '') + '</span>'; } },
                { label: 'Lot', get: function (r) { return F(r, ['LotNumber', 'Lot']); } },
                { label: 'Serial', get: function (r) { return F(r, ['SerialNumber', 'Serial']); } },
                { label: 'Source / Reference', get: function (r) { return F(r, ['TransactionSource', 'TransactionSourceName', 'SourceReference', 'TransactionReference', 'SourceDocumentNumber']); } }
            ],
            rowActions: [{ label: 'All fields', icon: 'fa-list', run: function (r) { IU.allFields('Transaction ' + (r.TransactionId || ''), r, true); } }],
            onRow: function (r) { IU.allFields('Transaction ' + (r.TransactionId || ''), r, true); }
        });
        if (lsGet('fxinv_tx_org', '')) setTimeout(function () { if (g.val('org')) g.search(); }, 600);
    }
};

// ═══ Settings ══════════════════════════════════════════════════
INV.settings = {
    id: 'settings', label: 'Settings', icon: 'fa-sliders', group: 'Setup', desc: 'Defaults used by these screens — saved on this PC',
    render: function (el) {
        var F = [
            { id: 'masterOrg', label: 'Item master organization (Item Loading)', value: IU.cfg('masterOrg'), req: 1 },
            { id: 'sourceCode', label: 'Source code for staged inventory transactions', value: IU.cfg('sourceCode'), req: 1 },
            { id: 'toIface', label: 'Transfer order — interface source', value: IU.cfg('toIface') },
            { id: 'toOrderSource', label: 'Transfer order — supply order source', value: IU.cfg('toOrderSource') },
            { id: 'toReqStatus', label: 'Transfer order — supply request status', value: IU.cfg('toReqStatus') },
            { id: 'toEmail', label: 'Preparer / requester e-mail', value: IU.cfg('toEmail'), ph: /@/.test(FX.user) ? FX.user.toLowerCase() : 'your Fusion e-mail' },
            { id: 'toNeedByDays', label: 'Need-by date = today + days', type: 'number', value: IU.cfg('toNeedByDays') },
            { id: 'toUom', label: 'Default UOM', value: IU.cfg('toUom') },
            { id: 'itemSource', label: 'Item Master default source', type: 'select', options: [{ v: 'rest', t: 'Fusion REST (itemsV2)' }, { v: 'sql', t: 'Fusion SQL (EGP_SYSTEM_ITEMS_B)' }], value: IU.cfg('itemSource') },
            { id: 'sqlLimit', label: 'Fusion SQL row limit', type: 'number', value: IU.cfg('sqlLimit') }
        ];
        el.innerHTML = '<div class="card pad" style="max-width:900px;display:flex;flex-direction:column;gap:12px">' + FX.form('st-', F) +
            '<div class="note"><i class="fa-solid fa-circle-info"></i> Saved in this PC\'s browser storage for the Fusion modules. The Fusion login itself stays in the app. Signed in as <b>' + esc(FX.user) + '</b> on <b>' + esc(FX.instance) + '</b>.</div>' +
            '<div class="row-btns"><button class="btn" id="st-def"><i class="fa-solid fa-rotate-left"></i> Defaults</button><span class="grow"></span><button class="btn primary" id="st-save"><i class="fa-solid fa-floppy-disk"></i> Save</button></div></div>';
        $('st-save').onclick = function () {
            var v = FX.formVals('st-', F); if (v._missing.length) { FX.toast('Required: ' + v._missing.join(', '), 'err'); return; }
            delete v._missing; IU.setCfg(v); FX.toast('Saved.', 'ok');
        };
        $('st-def').onclick = function () { lsSet('fxinv_settings', {}); FX.show('settings'); FX.toast('Defaults restored.'); };
    }
};
