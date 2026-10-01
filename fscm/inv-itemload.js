/* Fusion Inventory — Item Loading: search items across orgs (one call per item, so several orgs work), edit attributes,
   DFF and EFF (PATCHed on the child row itself), and bulk-create items in the master org by cloning a reference item. */

INV.itemLoading = {
    id: 'itemload', label: 'Item Loading', icon: 'fa-file-import', group: 'Items', desc: 'Create items from a reference item, assign orgs, edit attributes, DFF and EFF',
    render: function (el) {
        var S = { rows: [], orgs: [] }, master = IU.cfg('masterOrg');
        var tabs = IU.tabs(el, [
            { id: 'search', label: 'Search', icon: 'fa-magnifying-glass', render: searchTab },
            { id: 'info', label: 'Additional Info', icon: 'fa-sliders', render: infoTab, onShow: function (p) { p._draw && p._draw(); } },
            { id: 'dff', label: 'Additional Info - DFF', icon: 'fa-table-columns', render: function (p) { flexTab(p, 'dff'); }, onShow: function (p) { p._draw && p._draw(); } },
            { id: 'eff', label: 'Additional Info - EFF', icon: 'fa-layer-group', render: function (p) { flexTab(p, 'eff'); }, onShow: function (p) { p._draw && p._draw(); } },
            { id: 'load', label: 'Load', icon: 'fa-file-import', render: loadTab }
        ], { start: 'load', right: '<span class="chip info" style="margin:6px" id="il-orgcnt">orgs…</span><span class="chip" style="margin:6px">master ' + esc(master) + '</span>' });
        FX.lov('orgs').then(function (l) { S.orgs = l; var c = $('il-orgcnt'); if (c) c.textContent = l.length + ' orgs'; }).catch(function () { });

        var isLot = function (r) { if (r.LotControlCode != null && r.LotControlCode !== '') return +r.LotControlCode !== 1; return !!r.LotControlValue && !/no lot/i.test(r.LotControlValue); };
        var isSer = function (r) { var c = IU.first(r, ['SerialGenerationCode', 'SerialNumberControlCode']); if (c != null) return +c !== 1; var v = IU.first(r, ['SerialGenerationValue', 'SerialNumberControlValue', 'SerialGeneration', 'SerialNumberControl']); return !!v && !/no serial/i.test(v); };
        var tick = function (b) { return b ? '<i class="fa-solid fa-check" style="color:var(--ok)"></i>' : '<i class="fa-solid fa-xmark" style="color:#cbd5e1"></i>'; };
        var yn = function (v) { return v === true || v === 'true' || v === 'Y' ? '<span class="chip ok">Yes</span>' : v === false || v === 'false' || v === 'N' ? '<span class="chip">No</span>' : ''; };

        // ── Search ──
        function searchTab(p) {
            var grid, ms;
            p.innerHTML = '<div class="card"><div class="filters">' +
                '<label><span>Organizations <b style="color:var(--err)">*</b></span><div id="il-orgs"></div></label>' +
                '<label>Description' + IU.inp('il-desc', 'starts with… (when no items pasted)') + '</label>' +
                '<label style="flex:1;min-width:260px">Item numbers<textarea id="il-items" rows="2" placeholder="one per line, or comma / tab separated (max 500)" style="border:1px solid var(--line);border-radius:8px;padding:6px 9px;font-family:var(--mono);font-size:.78rem;text-transform:none;font-weight:500;color:var(--ink)"></textarea></label>' +
                '<div class="go"><span class="muted" id="il-cnt" style="font-size:.78rem;align-self:center"></span><button class="btn primary" id="il-go"><i class="fa-solid fa-magnifying-glass"></i> Search</button></div></div></div>' +
                '<div id="il-grid" style="display:flex;flex-direction:column;flex:1;min-height:0;gap:10px"></div>';
            FX.lov('orgs').then(function (l) { ms = IU.multi($('il-orgs'), l.map(function (o) { return { v: o.v, t: o.t }; }), lsGet('fxinv_il_orgs', [master])); });
            grid = IU.localGrid($('il-grid'), {
                id: 'il', rows: function () { return S.rows; }, csvName: 'items', emptyText: 'Pick organizations, paste item numbers (or a description) and search.',
                columns: [{ f: 'ItemNumber', label: 'Item', fmt: 'mono' }, { f: 'ItemDescription', label: 'Description' }, { f: 'OrganizationCode', label: 'Org' }, { label: 'UOM', get: function (r) { return r.PrimaryUOMValue || r.PrimaryUnitOfMeasure; } }, { f: 'ItemClass', label: 'Item Class' },
                    { label: 'Lot', get: function (r) { return isLot(r) ? 'Y' : 'N'; }, html: function (r) { return tick(isLot(r)); } }, { label: 'Serial', get: function (r) { return isSer(r) ? 'Y' : 'N'; }, html: function (r) { return tick(isSer(r)); } },
                    { f: 'ItemStatusValue', label: 'Status', fmt: 'chip' }],
                rowActions: [{ label: 'Edit', icon: 'fa-pen', run: function (r) { editItem(r, function () { search(); }); } }],
                onRow: function (r) { editItem(r, function () { search(); }); }
            });
            $('il-go').onclick = search;
            function search() {
                var orgs = ms ? ms.get() : []; if (!orgs.length) { FX.toast('Select at least one organization.', 'err'); return; }
                lsSet('fxinv_il_orgs', orgs);
                var items = IU.splitItems($('il-items').value, 500), desc = $('il-desc').value.trim();
                if (!items.length && !desc) { FX.toast('Paste item numbers or enter a description.', 'err'); return; }
                grid.loading('Searching…');
                var job;
                if (items.length) job = IU.mapLimit(items, 6, function (it) { return FX.get('itemsV2', { q: 'ItemNumber=' + FX.qv(it), limit: 500, onlyData: false }).then(function (j) { return (j.items || []).filter(function (r) { return orgs.indexOf(r.OrganizationCode) >= 0; }); }); }, function (d, n) { grid.loading('Searching… ' + d + '/' + n + ' items'); });
                else job = IU.mapLimit(orgs, 6, function (o) { return FX.get('itemsV2', { q: 'OrganizationCode=' + FX.qv(o) + ';ItemDescription LIKE ' + FX.qv(desc + '%'), limit: 500, onlyData: false }).then(function (j) { return j.items || []; }); });
                job.then(function (res) {
                    var all = [], bad = []; res.forEach(function (x, i) { if (x.ok) all = all.concat(x.v); else bad.push(IU.errText(x.e)); });
                    all.sort(function (a, b) { return String(a.ItemNumber).localeCompare(b.ItemNumber) || String(a.OrganizationCode).localeCompare(b.OrganizationCode); });
                    S.rows = all; grid.refresh();
                    $('il-cnt').textContent = all.length + ' row(s) · ' + IU.distinct(all.map(function (r) { return r.ItemNumber; })).length + ' item(s)';
                    if (bad.length) FX.toast(bad.length + ' call(s) failed: ' + bad[0], 'err');
                });
            }
        }

        // ── Edit item (attribute groups) ──
        var GROUPS = [['Lot & Serial Control', /(lot|serial|shelf.?life|expiration|bulk.?picked)/i], ['Accounts', /(sales.?account|cost.?of.?sales|expense.?account|encumbrance|account)/i],
            ['Item Status & Type', /(item.?status|lifecycle|user.?item.?type|sales.?product.?type|primary.?u(om|nit)|item.?class)/i],
            ['Inventory & Ordering Flags', /(inventory.?item|stock.?enabled|inventory.?asset|purchas|customer.?order|shippable|internal.?order|transaction.?enabled|returnable|reservable|restrict|locator.?control)/i]];
        var SKIP = /^(ItemId|OrganizationId|MasterOrganizationId|links|CategoryCode|CreatedBy|CreationDate|LastUpdateDate|LastUpdatedBy|LastUpdateLogin)$|ObjectVersionNumber$/;
        var ENUMS = { lotcontrolvalue: ['No lot control', 'Full lot control'], lotcontrolcode: [1, 2], serialgenerationvalue: ['No serial number control', 'Predefined serial numbers', 'Dynamic entry at inventory receipt', 'Dynamic entry at sales order issue'], serialgenerationcode: [1, 2, 5, 6] };
        function isBool(k, v) { return /flag$/i.test(k) || typeof v === 'boolean' || v === 'true' || v === 'false'; }
        function editor(k, v, idp) {
            var id = idp + k, en = ENUMS[k.toLowerCase()];
            if (en) return '<select id="' + id + '" data-k="' + esc(k) + '"><option value=""></option>' + en.map(function (o) { return '<option' + (String(o) === String(v) ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + (v != null && v !== '' && en.map(String).indexOf(String(v)) < 0 ? '<option selected>' + esc(v) + '</option>' : '') + '</select>';
            if (isBool(k, v)) return '<select id="' + id + '" data-k="' + esc(k) + '"><option value="">Not set</option><option value="true"' + (v === true || v === 'true' ? ' selected' : '') + '>Yes</option><option value="false"' + (v === false || v === 'false' ? ' selected' : '') + '>No</option></select>';
            return '<input id="' + id + '" data-k="' + esc(k) + '" type="' + (typeof v === 'number' ? 'number' : 'text') + '" step="any" value="' + esc(v == null ? '' : v) + '">';
        }
        function readVal(k, orig, raw) {
            if (isBool(k, orig) && ENUMS[k.toLowerCase()] == null) return raw === '' ? null : raw === 'true';
            if (typeof orig === 'number' || (ENUMS[k.toLowerCase()] && typeof ENUMS[k.toLowerCase()][0] === 'number')) return raw === '' ? null : Number(raw);
            return raw;
        }
        function changed(box, item, keys) {
            var body = {};
            keys.forEach(function (k) {
                var e = box.querySelector('[data-k="' + k + '"]'); if (!e) return;
                var nv = readVal(k, item[k], e.value), ov = item[k];
                if (String(nv == null ? '' : nv) !== String(ov == null ? '' : ov)) body[k] = nv;
            });
            return body;
        }
        function editItem(r, done) {
            FX.modal({ title: '<i class="fa-solid fa-pen"></i> ' + esc(r.ItemNumber) + ' · ' + esc(r.OrganizationCode), wide: true, body: '<div id="ie-b" class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading item…</div>' });
            FX.get('itemsV2', { q: 'OrganizationCode=' + FX.qv(r.OrganizationCode) + ';ItemNumber=' + FX.qv(r.ItemNumber), onlyData: false, limit: 1 }).then(function (j) {
                var item = (j.items || [])[0]; if (!item) throw 'Item not found.';
                var keys = Object.keys(item).filter(function (k) { var v = item[k]; return !SKIP.test(k) && (v == null || typeof v !== 'object'); }).sort();
                var grp = GROUPS.map(function (g) { return { name: g[0], keys: [] }; }), other = { name: 'Other attributes', keys: [] };
                keys.forEach(function (k) { for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i][1].test(k)) { grp[i].keys.push(k); return; } other.keys.push(k); });
                var sec = function (g, open) { return g.keys.length ? '<details' + (open ? ' open' : '') + ' class="card pad" style="margin-bottom:8px"><summary style="cursor:pointer;font-weight:700;font-size:.82rem">' + esc(g.name) + ' <span class="muted">(' + g.keys.length + ')</span></summary><div class="form" style="margin-top:8px">' + g.keys.map(function (k) { return '<label title="' + esc(k) + '">' + esc(IU.label(k)) + editor(k, item[k], 'ie-') + '</label>'; }).join('') + '</div></details>' : ''; };
                FX.modal({
                    title: '<i class="fa-solid fa-pen"></i> ' + esc(item.ItemNumber) + ' · ' + esc(item.OrganizationCode), wide: true,
                    body: grp.map(function (g, i) { return sec(g, i < 4); }).join('') + sec(other, false) +
                        '<label style="display:flex;gap:8px;align-items:center;font-size:.82rem"><input type="checkbox" id="ie-all"> Apply to all organizations of this item</label><div id="ie-res"></div>',
                    buttons: [{ label: 'Close', act: 'close' }, { label: 'Raw', act: 'raw' }, { label: '<i class="fa-solid fa-floppy-disk"></i> Save', cls: 'primary', act: 'save' }],
                    onAction: function (a, box) {
                        if (a === 'raw') { FX.json(item.ItemNumber, item); return false; }
                        if (a !== 'save') return;
                        var body = changed(box, item, keys);
                        if (!Object.keys(body).length) { FX.toast('No changes to save'); return false; }
                        var res = $('ie-res');
                        if (!$('ie-all').checked) {
                            res.innerHTML = '<div class="note"><i class="fa-solid fa-circle-notch fa-spin"></i> Saving…</div>';
                            return FX.rest('PATCH', IU.self(item), {}, body).then(function (nu) { Object.assign(item, nu || {}); FX.toast('Saved ' + Object.keys(body).length + ' field(s).', 'ok'); if (done) done(); return true; }).catch(function (e) { res.innerHTML = '<div class="note err" style="white-space:pre-wrap">' + esc(e) + '</div>'; return false; });
                        }
                        res.innerHTML = '<div class="note"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading all organizations…</div>';
                        return FX.get('itemsV2', { q: 'ItemNumber=' + FX.qv(item.ItemNumber), onlyData: false, limit: 500 }).then(function (jj) {
                            var all = jj.items || [], out = [];
                            return all.reduce(function (pr, o) { return pr.then(function () { return FX.rest('PATCH', IU.self(o), {}, body).then(function () { out.push({ org: o.OrganizationCode, ok: true }); }, function (e) { out.push({ org: o.OrganizationCode, ok: false, e: String(e) }); }); }); }, Promise.resolve()).then(function () {
                                var n = out.filter(function (x) { return x.ok; }).length;
                                res.innerHTML = '<div class="note ' + (n === out.length ? 'ok' : 'warn') + '">Updated ' + n + '/' + out.length + ' org(s)<div style="margin-top:6px">' + out.map(function (x) { return '<span class="chip ' + (x.ok ? 'ok' : 'err') + '" title="' + esc(x.e || 'OK') + '" style="margin:2px">' + esc(x.org) + '</span>'; }).join('') + '</div></div>';
                                if (n && done) done();
                                return false;
                            });
                        }).catch(function (e) { res.innerHTML = '<div class="note err">' + esc(e) + '</div>'; return false; });
                    }
                });
            }).catch(function (e) { var b = $('ie-b'); if (b) b.innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
        }

        // ── Additional Info ──
        function infoTab(p) {
            p._draw = function () {
                if (!S.rows.length) { p.innerHTML = '<div class="empty"><i class="fa-solid fa-magnifying-glass"></i>Search items on the Search tab first — the same rows are shown here.</div>'; return; }
                var g = IU.localGrid(p, {
                    id: 'ilai', rows: function () { return S.rows; }, csvName: 'items_additional', autoLoad: true,
                    columns: [{ f: 'ItemNumber', label: 'Item', fmt: 'mono' }, { f: 'ItemDescription', label: 'Description' }, { f: 'OrganizationCode', label: 'Org' }, { label: 'UOM', get: function (r) { return r.PrimaryUOMValue || r.PrimaryUnitOfMeasure; } }, { f: 'ItemClass', label: 'Item Class' },
                        { f: 'LotControlValue', label: 'Lot Control' }, { f: 'SerialGenerationValue', label: 'Serial Generation' }, { f: 'ItemStatusValue', label: 'Status', fmt: 'chip' },
                        { label: 'Inventory', html: function (r) { return yn(r.InventoryItemFlag); } }, { label: 'Purchasable', html: function (r) { return yn(r.PurchasableFlag); } }, { label: 'Shippable', html: function (r) { return yn(r.ShippableItemFlag); } }],
                    rowActions: [{ label: 'Update', icon: 'fa-pen-to-square', run: function (r) { infoUpdate(r); } }]
                });
            };
            p._draw();
        }
        function infoUpdate(r) {
            var F = ['ItemClass', 'PrimaryUOMValue', 'LotControlValue', 'SerialGenerationValue', 'ItemStatusValue', 'LifecyclePhaseValue', 'InventoryItemFlag', 'StockEnabledFlag', 'PurchasableFlag', 'ShippableItemFlag'];
            FX.modal({
                title: 'Update ' + esc(r.ItemNumber) + ' · ' + esc(r.OrganizationCode),
                body: '<div class="form">' + F.map(function (k) { return '<label>' + esc(IU.label(k)) + (k === 'PrimaryUOMValue' ? '<input value="' + esc(r[k] || '') + '" disabled>' : editor(k, r[k], 'iu-')) + '</label>'; }).join('') + '</div><div id="iu-prev"></div>',
                buttons: [{ label: 'Cancel', act: 'close' }, { label: 'Review & Confirm', cls: 'primary', act: 'rev' }],
                onAction: function (a, box) {
                    if (a === 'rev') {
                        var body = changed(box, r, F.filter(function (k) { return k !== 'PrimaryUOMValue'; }));
                        if (!Object.keys(body).length) { FX.toast('No changes to save'); return false; }
                        var url = IU.self(r);
                        $('iu-prev').innerHTML = '<div class="note"><b>PATCH</b> <span class="mono">' + esc(url) + '</span></div><pre class="json">' + esc(JSON.stringify(body, null, 2)) + '</pre>';
                        var f = box.querySelector('.modal-f'); f.innerHTML = '<button class="btn" data-mact="close">Cancel</button><button class="btn primary" data-mact="ok"><i class="fa-solid fa-check"></i> Confirm Update</button>';
                        box._body = body; return false;
                    }
                    if (a === 'ok') return FX.rest('PATCH', IU.self(r), {}, box._body).then(function (nu) { Object.assign(r, nu || box._body); FX.toast('Updated.', 'ok'); var pn = tabs.pane('info'); if (pn && pn._draw) pn._draw(); return true; });
                }
            });
        }

        // ── DFF / EFF ──
        var FLEX_SKIP = /^(links|InventoryItemId|OrganizationId|ItemId)$/;
        function flexTab(p, kind) {
            var linkName = kind === 'dff' ? 'ItemDFF' : 'ItemEffCategory', label = kind === 'dff' ? 'DFF' : 'EFF';
            p._draw = function () {
                if (!S.rows.length) { p.innerHTML = '<div class="empty"><i class="fa-solid fa-magnifying-glass"></i>Search items on the Search tab first.</div>'; return; }
                var loaded = S.rows.filter(function (r) { return r['_' + kind] !== undefined; }).length;
                p.innerHTML = '<div class="toolbar"><button class="btn primary" data-fl><i class="fa-solid fa-download"></i> Load ' + label + ' for ' + S.rows.length + ' row(s)</button><span class="muted" data-fp style="font-size:.78rem">' + (loaded ? loaded + ' loaded' : '') + '</span></div><div data-fg style="display:flex;flex-direction:column;flex:1;min-height:0"></div>';
                p.querySelector('[data-fl]').onclick = load;
                drawGrid();
            };
            function load() {
                var i = 0, prog = p.querySelector('[data-fp]');
                S.rows.reduce(function (pr, r) {
                    return pr.then(function () {
                        prog.textContent = 'Loading ' + (++i) + '/' + S.rows.length + '…';
                        var href = IU.link(r, linkName); if (!href) { r['_' + kind] = null; return; }
                        return FX.rest('GET', href).then(function (j) { r['_' + kind] = (j.items || [])[0] || null; }, function (e) { r['_' + kind] = { _error: String(e) }; });
                    });
                }, Promise.resolve()).then(function () { prog.textContent = S.rows.length + ' loaded'; drawGrid(); });
            }
            function drawGrid() {
                var box = p.querySelector('[data-fg]'); if (!box) return;
                var withF = S.rows.filter(function (r) { return r['_' + kind]; });
                if (!withF.length) { box.innerHTML = '<div class="empty">Click "Load ' + label + '" to read the ' + label + ' values of these rows.</div>'; return; }
                var names = []; withF.forEach(function (r) { Object.keys(r['_' + kind]).forEach(function (k) { var v = r['_' + kind][k]; if (!FLEX_SKIP.test(k) && (v == null || typeof v !== 'object') && names.indexOf(k) < 0) names.push(k); }); });
                names.sort();
                var cols = [{ f: 'ItemNumber', label: 'Item', fmt: 'mono' }, { f: 'ItemDescription', label: 'Description' }, { f: 'OrganizationCode', label: 'Org' }]
                    .concat(kind === 'eff' ? [{ label: 'Contexts', html: function (r) { return (flexChildren(r._eff) || []).map(function (c) { return '<span class="tag">' + esc(c.name) + '</span>'; }).join(''); } }] : [])
                    .concat(names.map(function (k) { return { label: IU.label(k).replace(/^  ?FLEX /, ''), get: function (r) { var d = r['_' + kind]; return d ? (d._error ? 'error' : d[k]) : ''; } }; }));
                IU.localGrid(box, { id: 'il' + kind, rows: function () { return S.rows; }, columns: cols, csvName: 'items_' + kind, autoLoad: true, rowActions: [{ label: 'Edit', icon: 'fa-pen', run: function (r) { kind === 'dff' ? editDff(r) : editEff(r); } }] });
            }
            p._draw();
        }
        function flexChildren(row) { return ((row && row.links) || []).filter(function (l) { return l.rel === 'child'; }); }
        /** Edit one flex row: fields with Select / Current / New, preview, PATCH the row's own self link. */
        function flexEditor(title, row, after) {
            var url = IU.self(row);
            var keys = Object.keys(row).filter(function (k) { var v = row[k]; return !FLEX_SKIP.test(k) && (v == null || typeof v !== 'object'); }).sort();
            FX.modal({
                title: esc(title), wide: true,
                body: (url ? '' : '<div class="note err">This row has no self link — it cannot be updated through REST.</div>') + '<div class="scroll"><table class="tbl"><thead><tr><th style="width:30px"></th><th>Column Name</th><th>Current Value</th><th>New Value</th></tr></thead><tbody>' +
                    keys.map(function (k) { return '<tr><td><input type="checkbox" data-fs="' + esc(k) + '"></td><td class="mono">' + esc(k) + (/^__FLEX_Context/.test(k) ? ' <span class="chip warn">context</span>' : '') + '</td><td>' + esc(row[k] == null ? '' : row[k]) + '</td><td class="ed"><input data-fv="' + esc(k) + '" value="' + esc(row[k] == null ? '' : row[k]) + '" hidden></td></tr>'; }).join('') + '</tbody></table></div><div id="fe-prev"></div>',
                buttons: [{ label: 'Cancel', act: 'close' }, { label: 'Update selected', cls: 'primary', act: 'rev' }],
                onOpen: function (box) { box.addEventListener('change', function (e) { var k = e.target.getAttribute('data-fs'); if (k != null) box.querySelector('[data-fv="' + k + '"]').hidden = !e.target.checked; }); },
                onAction: function (a, box) {
                    if (a === 'rev') {
                        var body = {};
                        Array.prototype.forEach.call(box.querySelectorAll('[data-fs]:checked'), function (c) { var k = c.getAttribute('data-fs'), v = box.querySelector('[data-fv="' + k + '"]').value; body[k] = typeof row[k] === 'number' && v !== '' ? Number(v) : v === '' ? null : v; });
                        if (!Object.keys(body).length) { FX.toast('Select at least one field.', 'err'); return false; }
                        if (!url) return false;
                        $('fe-prev').innerHTML = '<div class="note"><b>PATCH</b> <span class="mono">' + esc(url) + '</span></div><pre class="json">' + esc(JSON.stringify(body, null, 2)) + '</pre>';
                        box._body = body; box.querySelector('.modal-f').innerHTML = '<button class="btn" data-mact="close">Cancel</button><button class="btn primary" data-mact="ok"><i class="fa-solid fa-check"></i> Confirm — update ' + Object.keys(body).length + ' field(s)</button>';
                        return false;
                    }
                    if (a === 'ok') return FX.rest('PATCH', url, {}, box._body).then(function (nu) { FX.toast('Updated.', 'ok'); if (after) after(nu); return true; });
                }
            });
        }
        function editDff(r) {
            var href = IU.link(r, 'ItemDFF'); if (!href) { FX.toast('No ItemDFF link on this row.', 'err'); return; }
            FX.busy('Reading DFF…');
            FX.rest('GET', href).then(function (j) {
                FX.busy(); var row = (j.items || [])[0]; if (!row) { FX.toast('No DFF row for this item.', 'err'); return; }
                flexEditor('DFF · ' + r.ItemNumber + ' · ' + r.OrganizationCode, row, function () { r._dff = undefined; var pn = tabs.pane('dff'); FX.rest('GET', href).then(function (jj) { r._dff = (jj.items || [])[0] || null; if (pn && pn._draw) pn._draw(); }); });
            }).catch(function (e) { FX.busy(); FX.toast(String(e), 'err'); });
        }
        function editEff(r) {
            var href = IU.link(r, 'ItemEffCategory'); if (!href) { FX.toast('No ItemEffCategory link on this row.', 'err'); return; }
            FX.busy('Reading EFF…');
            FX.rest('GET', href).then(function (j) {
                FX.busy(); var cat = (j.items || [])[0]; if (!cat) { FX.toast('No EFF category row for this item.', 'err'); return; }
                var kids = flexChildren(cat);
                FX.modal({
                    title: 'EFF · ' + esc(r.ItemNumber) + ' · ' + esc(r.OrganizationCode),
                    body: '<div class="note">Extensible flexfields are stored per context under the item\'s EFF category row. Pick the context to edit — the change is PATCHed on that context row itself.</div>' +
                        '<div class="checklist" style="grid-template-columns:1fr">' + '<label><input type="radio" name="effc" value="-1"' + (kids.length ? '' : ' checked') + '> Category row (' + esc(cat.CategoryCode || cat.ContextCode || 'ItemEffCategory') + ')</label>' + kids.map(function (k, i) { return '<label><input type="radio" name="effc" value="' + i + '"' + (i === 0 ? ' checked' : '') + '> ' + esc(k.name) + '</label>'; }).join('') + '</div>',
                    buttons: [{ label: 'Cancel', act: 'close' }, { label: 'Open', cls: 'primary', act: 'open' }],
                    onAction: function (a, box) {
                        if (a !== 'open') return;
                        var v = +((box.querySelector('[name="effc"]:checked') || {}).value || -1);
                        if (v < 0) { setTimeout(function () { flexEditor('EFF category · ' + r.ItemNumber, cat); }, 0); return true; }
                        var k = kids[v];
                        return IU.allHref(k.href).then(function (rows) {
                            if (!rows.length) { FX.toast('No rows in context ' + k.name + ' — creating context rows is not supported here.', 'err'); return false; }
                            setTimeout(function () { flexEditor('EFF ' + k.name + ' · ' + r.ItemNumber + (rows.length > 1 ? ' (row 1 of ' + rows.length + ')' : ''), rows[0], function () { r._eff = undefined; }); }, 0);
                            return true;
                        });
                    }
                });
            }).catch(function (e) { FX.busy(); FX.toast(String(e), 'err'); });
        }

        // ── Load (create) ──
        function loadTab(p) {
            var L = { rows: [], seq: 0, results: null };
            p.innerHTML = '<div class="two"><div class="card pad" style="display:flex;flex-direction:column;gap:8px"><b><i class="fa-solid fa-paste" style="color:var(--accent)"></i> Paste items</b>' +
                '<textarea class="big" id="ld-paste" style="min-height:110px" placeholder="Item Number[TAB or ,]Description — one per line"></textarea><div class="row-btns"><button class="btn" id="ld-add"><i class="fa-solid fa-plus"></i> Add to list</button></div></div>' +
                '<div class="card pad" style="display:flex;flex-direction:column;gap:8px"><b><i class="fa-solid fa-file-excel" style="color:var(--ok)"></i> Excel / CSV</b><span class="muted" style="font-size:.78rem">First sheet: column A = item number, column B = description. A header row is skipped.</span><input type="file" id="ld-file" accept=".xlsx,.xls,.csv">' +
                '<div class="note" style="margin-top:auto">New items are created in master org <b>' + esc(master) + '</b> (Settings) by copying a reference item, then assigned to the organizations you pick.</div></div></div>' +
                '<div class="card"><div class="card-h"><b><i class="fa-solid fa-list"></i> Items to load</b><span id="ld-tags"></span><span class="grow" style="flex:1"></span>' +
                '<button class="btn sm" id="ld-val"><i class="fa-solid fa-check-double"></i> Validate in ' + esc(master) + '</button><button class="btn sm" id="ld-clr"><i class="fa-solid fa-eraser"></i> Clear</button><button class="btn sm primary" id="ld-create" disabled><i class="fa-solid fa-wand-magic-sparkles"></i> Create (0)</button></div>' +
                '<div style="overflow:auto;max-height:46vh"><table class="tbl" id="ld-tbl"></table></div></div><div id="ld-res"></div>';
            function parse(text) {
                return String(text || '').split(/\r?\n/).map(function (ln) { var parts = ln.split(/\t|,|\s{2,}/); return { item: (parts[0] || '').trim(), desc: parts.slice(1).join(' ').trim() }; })
                    .filter(function (x) { return x.item && !/^(item\s*(number|no|code)?|code|number)$/i.test(x.item); });
            }
            function add(list) { var have = {}; L.rows.forEach(function (r) { have[r.item] = 1; }); list.forEach(function (x) { if (!have[x.item]) { have[x.item] = 1; L.rows.push({ key: ++L.seq, item: x.item, desc: x.desc, exists: null }); } }); draw(); }
            $('ld-add').onclick = function () { add(parse($('ld-paste').value)); $('ld-paste').value = ''; };
            $('ld-file').onchange = function () {
                var f = this.files[0]; if (!f) return;
                if (!window.XLSX) { if (/\.csv$/i.test(f.name)) { f.text().then(function (t) { add(parse(t)); }); } else FX.toast('Excel reader not loaded — save as CSV or paste.', 'err'); return; }
                f.arrayBuffer().then(function (buf) {
                    var wb = XLSX.read(buf, { type: 'array' }), ws = wb.Sheets[wb.SheetNames[0]], rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                    if (rows.length && /item|code|number/i.test(String(rows[0][0]))) rows = rows.slice(1);
                    add(rows.map(function (r) { return { item: String(r[0] || '').trim(), desc: String(r[1] || '').trim() }; }).filter(function (x) { return x.item; }));
                }).catch(function (e) { FX.toast('Could not read the file: ' + e, 'err'); });
                this.value = '';
            };
            $('ld-clr').onclick = function () { L.rows = []; draw(); };
            $('ld-val').onclick = validate;
            $('ld-create').onclick = wizard;
            $('ld-tbl').addEventListener('input', function (e) { var tr = e.target.closest('tr[data-k]'); if (tr) L.rows.filter(function (r) { return r.key === +tr.getAttribute('data-k'); })[0].desc = e.target.value; });
            $('ld-tbl').addEventListener('click', function (e) { var b = e.target.closest('[data-del]'); if (b) { L.rows = L.rows.filter(function (r) { return r.key !== +b.getAttribute('data-del'); }); draw(); } });
            function draw() {
                var nNew = L.rows.filter(function (r) { return r.exists === false; }).length, nEx = L.rows.filter(function (r) { return r.exists === true; }).length;
                $('ld-tags').innerHTML = (nNew ? '<span class="chip ok">' + nNew + ' new</span> ' : '') + (nEx ? '<span class="chip warn">' + nEx + ' existing</span>' : '') + (!nNew && !nEx && L.rows.length ? '<span class="muted">' + L.rows.length + ' item(s) — validate them</span>' : '');
                $('ld-create').disabled = !nNew; $('ld-create').innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Create (' + nNew + ')';
                $('ld-tbl').innerHTML = L.rows.length ? '<thead><tr><th>#</th><th>Item Number</th><th>Description</th><th>In ' + esc(master) + '?</th><th></th></tr></thead><tbody>' + L.rows.map(function (r, i) {
                    return '<tr data-k="' + r.key + '"><td>' + (i + 1) + '</td><td class="mono">' + esc(r.item) + '</td><td class="ed"><input value="' + esc(r.desc) + '"></td><td>' + (r.exists === 'checking' ? '<i class="fa-solid fa-circle-notch fa-spin muted"></i>' : r.exists === true ? '<span class="chip warn">Exists</span>' : r.exists === false ? '<span class="chip ok">New</span>' : r.exists === 'err' ? '<span class="chip err" title="' + esc(r.err) + '">error</span>' : '<span class="muted">—</span>') + '</td><td><button class="btn sm icon danger" data-del="' + r.key + '"><i class="fa-solid fa-trash"></i></button></td></tr>';
                }).join('') + '</tbody>' : '<tbody><tr><td class="empty">Paste items or drop a file above.</td></tr></tbody>';
            }
            function validate() {
                if (!L.rows.length) { FX.toast('Add items first.', 'err'); return Promise.resolve(); }
                L.rows.forEach(function (r) { r.exists = 'checking'; }); draw();
                return IU.mapLimit(L.rows, 6, function (r) {
                    return FX.get('itemsV2', { q: 'OrganizationCode=' + FX.qv(master) + ';ItemNumber=' + FX.qv(r.item), limit: 1 }).then(function (j) { var f = (j.items || [])[0]; r.exists = !!f; if (f && !r.desc) r.desc = f.ItemDescription || ''; }, function (e) { r.exists = 'err'; r.err = String(e); });
                }, function () { draw(); }).then(draw);
            }
            function wizard() {
                var W = { step: 1, ref: null, orgs: [] }, news = L.rows.filter(function (r) { return r.exists === false; });
                var COPY = ['ItemClass', 'PrimaryUOMValue', 'PrimaryUnitOfMeasure', 'ItemStatusValue', 'LifecyclePhaseValue', 'UserItemType', 'SalesProductType', 'InventoryItemFlag', 'StockEnabledFlag', 'InventoryAssetFlag', 'PurchasingItemFlag', 'PurchasableFlag', 'CustomerOrderEnabledFlag', 'CustomerOrderFlag', 'ShippableItemFlag', 'InternalOrderEnabledFlag', 'InternalOrderFlag', 'TransactionEnabledFlag', 'BuildInWipFlag', 'ReturnableFlag', 'ServiceableProductFlag'];
                function steps() { return '<div class="steps">' + ['Reference Item', 'Organizations', 'Review & Run'].map(function (s, i) { return '<span class="st ' + (i + 1 === W.step ? 'cur' : i + 1 < W.step ? 'done' : '') + '">' + (i + 1) + '. ' + s + '</span>'; }).join('<i class="fa-solid fa-chevron-right sep"></i>') + '</div>'; }
                function show() {
                    if (W.step === 1) FX.modal({
                        title: 'Create ' + news.length + ' item(s) in ' + esc(master), wide: true,
                        body: steps() + '<label style="display:flex;flex-direction:column;gap:4px;font-size:.72rem;font-weight:700;color:var(--muted)">REFERENCE ITEM (in ' + esc(master) + ')<input id="wz-ref" placeholder="type an item number…" style="border:1px solid var(--line);border-radius:8px;padding:7px 9px" value="' + esc(W.ref ? W.ref.ItemNumber : '') + '"></label><div id="wz-refinfo"></div>',
                        buttons: [{ label: 'Cancel', act: 'close' }, { label: 'Next <i class="fa-solid fa-arrow-right"></i>', cls: 'primary', act: 'next' }],
                        onOpen: function () {
                            refInfo();
                            FX.typeahead('wz-ref', function (t) { return FX.get('itemsV2', { q: 'OrganizationCode=' + FX.qv(master) + ';ItemNumber LIKE ' + FX.qv(t + '%'), limit: 25 }).then(function (j) { return (j.items || []).map(function (x) { return { v: x.ItemNumber, t: x.ItemDescription, r: x.ItemClass, o: x }; }); }); }, function (h) { W.ref = h.o; refInfo(); }, 1);
                        },
                        onAction: function (a) { if (a === 'next') { if (!W.ref) { FX.toast('Pick a reference item.', 'err'); return false; } W.step = 2; setTimeout(show, 0); return false; } }
                    });
                    else if (W.step === 2) FX.modal({
                        title: 'Create ' + news.length + ' item(s) in ' + esc(master), wide: true,
                        body: steps() + '<div class="row-btns"><b>Assign to organizations</b><span class="muted" style="font-size:.78rem">(optional — none means master only)</span><span class="grow" style="flex:1"></span><button class="link" data-all="1">Select all</button><button class="link" data-all="0">Clear</button></div><div class="checklist" id="wz-orgs">' +
                            S.orgs.filter(function (o) { return o.v !== master; }).map(function (o) { return '<label><input type="checkbox" value="' + esc(o.v) + '"' + (W.orgs.indexOf(o.v) >= 0 ? ' checked' : '') + '> ' + esc(o.t) + '</label>'; }).join('') + '</div>',
                        buttons: [{ label: '<i class="fa-solid fa-arrow-left"></i> Back', act: 'back' }, { label: 'Next <i class="fa-solid fa-arrow-right"></i>', cls: 'primary', act: 'next' }],
                        onOpen: function (box) { box.addEventListener('click', function (e) { var b = e.target.closest('[data-all]'); if (b) Array.prototype.forEach.call($('wz-orgs').querySelectorAll('input'), function (c) { c.checked = b.getAttribute('data-all') === '1'; }); }); },
                        onAction: function (a) { W.orgs = Array.prototype.map.call($('wz-orgs').querySelectorAll('input:checked'), function (c) { return c.value; }); W.step = a === 'back' ? 1 : 3; setTimeout(show, 0); return false; }
                    });
                    else FX.modal({
                        title: 'Create ' + news.length + ' item(s) in ' + esc(master), wide: true,
                        body: steps() + '<div class="facts"><div><span>Reference</span>' + esc(W.ref.ItemNumber) + '</div><div><span>Item class</span>' + esc(W.ref.ItemClass || '') + '</div><div><span>UOM</span>' + esc(W.ref.PrimaryUOMValue || '') + '</div><div><span>Organizations</span>' + (W.orgs.length ? esc(W.orgs.join(', ')) : 'master only') + '</div><div><span>Calls</span>' + news.length * (1 + W.orgs.length) + ' POST itemsV2</div></div>' +
                            '<div class="scroll">' + FX.table(news, [{ f: 'item', label: 'Item', fmt: 'mono' }, { f: 'desc', label: 'Description' }]) + '</div>',
                        buttons: [{ label: '<i class="fa-solid fa-arrow-left"></i> Back', act: 'back' }, { label: '<i class="fa-solid fa-play"></i> Run', cls: 'primary', act: 'run' }],
                        onAction: function (a) { if (a === 'back') { W.step = 2; setTimeout(show, 0); return false; } run(); }
                    });
                }
                function refInfo() { var b = $('wz-refinfo'); if (!b) return; b.innerHTML = W.ref ? '<div class="note ok">Reference <b>' + esc(W.ref.ItemNumber) + '</b> — ' + esc(W.ref.ItemDescription || '') + '<br>Class <b>' + esc(W.ref.ItemClass || '—') + '</b> · UOM <b>' + esc(W.ref.PrimaryUOMValue || '—') + '</b> · Status <b>' + esc(W.ref.ItemStatusValue || '—') + '</b></div>' : '<div class="note">New items copy item class, UOM, status, lifecycle, item types and the inventory / purchasing / order / shipping flags from the reference.</div>'; }
                function run() {
                    var copied = {}; COPY.forEach(function (k) { var v = W.ref[k]; if (v != null && v !== '') copied[k] = v; });
                    var res = news.map(function (r) { return { item: r.item, master: 'pending', done: 0, total: W.orgs.length, errors: [] }; });
                    function drawRes() {
                        $('ld-res').innerHTML = '<div class="card"><div class="card-h"><b><i class="fa-solid fa-gears"></i> Create results</b></div>' + FX.table(res, [{ f: 'item', label: 'Item', fmt: 'mono' },
                            { label: 'Master (' + master + ')', html: function (x) { return x.master === 'pending' ? '<i class="fa-solid fa-circle-notch fa-spin muted"></i>' : x.master === 'Created' ? '<span class="chip ok">Created</span>' : '<span class="chip err">' + esc(x.master) + '</span>'; } },
                            { label: 'Orgs assigned', html: function (x) { return x.total ? '<div class="row-btns"><div class="prog" style="min-width:90px"><div style="width:' + (x.done / x.total * 100) + '%;background:' + (x.errors.length ? 'var(--warn)' : 'var(--ok)') + '"></div></div>' + x.done + '/' + x.total + '</div>' : '<span class="muted">—</span>'; } },
                            { label: 'Errors', html: function (x) { return x.errors.length ? '<span class="st-err" title="' + esc(x.errors.join('\n')) + '">' + esc(String(x.errors[0]).slice(0, 120)) + (x.errors.length > 1 ? ' +' + (x.errors.length - 1) + ' more' : '') + '</span>' : ''; } }]) + '</div>';
                    }
                    drawRes();
                    news.reduce(function (pr, r, i) {
                        return pr.then(function () {
                            var body = Object.assign({ OrganizationCode: master, ItemNumber: r.item, ItemDescription: r.desc || r.item }, copied);
                            return FX.rest('POST', 'itemsV2', {}, body).then(function () {
                                res[i].master = 'Created'; drawRes();
                                return W.orgs.reduce(function (p2, o) {
                                    return p2.then(function () { return FX.rest('POST', 'itemsV2', {}, Object.assign({}, body, { OrganizationCode: o })).then(function () { res[i].done++; }, function (e) { res[i].done++; res[i].errors.push(o + ': ' + e); }).then(drawRes); });
                                }, Promise.resolve());
                            }, function (e) { res[i].master = 'Failed (' + ((FX.lastCall || {}).status || '?') + ')'; res[i].errors.push(String(e)); drawRes(); });
                        });
                    }, Promise.resolve()).then(function () { FX.toast('Create finished — re-validating.', 'ok'); validate(); });
                }
                show();
            }
            draw();
        }
    }
};
