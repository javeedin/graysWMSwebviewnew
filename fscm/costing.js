/* Fusion Costing — Item Costs (search + dashboard), Receipt Costs (search + analytics), Cost Management (ESS cost flow
   through erpintegrations; history / monitor from ESS_REQUEST_HISTORY through the read-only Fusion SQL runner). */

var CST = {};

/** Shared analytics board. cfg: {recs, dims:[{k,label}], measures:[{k,label,get(g),money}], kpis(scope, ccy) → stats list, donutBy, key} */
CST.board = function (el, cfg) {
    var st = { dim: cfg.dims[0].k, meas: cfg.measures[0].k, top: 12, drill: null };
    var ccys = IU.distinct(cfg.recs.map(function (r) { return r.ccy; })), ccy = ccys.length === 1 ? ccys[0] : '';
    el.innerHTML = '<div class="card"><div class="filters">' +
        '<label>Group by<select data-b="dim">' + cfg.dims.map(function (d) { return '<option value="' + d.k + '">' + esc(d.label) + '</option>'; }).join('') + '</select></label>' +
        '<label>Measure<select data-b="meas">' + cfg.measures.map(function (m) { return '<option value="' + m.k + '">' + esc(m.label) + '</option>'; }).join('') + '</select></label>' +
        '<label>Top N<select data-b="top">' + [8, 12, 15, 20, 30].map(function (n) { return '<option' + (n === 12 ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
        '<span data-b="drill" style="align-self:center"></span><div class="go">' + (cfg.refresh ? '<button class="btn" data-b="refresh"><i class="fa-solid fa-rotate"></i> Refresh</button>' : '') + '</div></div></div>' +
        '<div data-b="kpis"></div><div class="three"><div data-b="bars"></div><div data-b="donut"></div></div><div class="card" style="padding:4px 10px" data-b="tbl"></div>';
    var q = function (k) { return el.querySelector('[data-b="' + k + '"]'); };
    var M = function () { return cfg.measures.filter(function (m) { return m.k === st.meas; })[0]; };
    var D = function () { return cfg.dims.filter(function (d) { return d.k === st.dim; })[0]; };
    var fmtM = function (v) { var m = M(); if (v == null) return '—'; return m.money ? IU.price(v, ccy) : m.count ? String(v) : IU.compact(v); };
    function draw() {
        var groups = IU.agg(cfg.recs, function (r) { return r[st.dim]; }, function (r) { return r.cost; }, ['receiptQty', 'onhandQty']);
        var m = M(); groups.forEach(function (g) { g.v = m.get(g); });
        groups.sort(function (a, b) { return (b.v || 0) - (a.v || 0); });
        var scope = st.drill == null ? cfg.recs : cfg.recs.filter(function (r) { return String(r[st.dim] == null ? '' : r[st.dim]) === st.drill; });
        q('drill').innerHTML = st.drill != null ? '<span class="chip info">' + esc(D().label) + ' = ' + esc(st.drill || '(blank)') + ' <button class="link" data-b="undrill" style="padding:0 0 0 4px">&times;</button></span>' : '<span class="muted" style="font-size:.76rem">Click a bar or a row to drill in</span>';
        q('kpis').innerHTML = IU.stats(cfg.kpis(scope, ccy));
        IU.hbars(q('bars'), m.label + ' by ' + D().label + ' — Top ' + st.top, groups.slice(0, st.top).map(function (g) { return { k: g.k, v: g.v, tip: '<b>' + esc(g.k || '(blank)') + '</b><br>' + esc(m.label) + ': ' + esc(fmtM(g.v)) + '<br>Records: ' + g.count }; }), fmtM, st.drill, toggle);
        IU.donut(q('donut'), 'Total cost share by Inventory Org' + (st.drill != null ? ' (drill scope)' : ''), IU.agg(scope, function (r) { return r.invOrg; }, function (r) { return r.cost; }).map(function (g) { return { k: g.k, v: g.sum }; }), function (v) { return IU.price(v, ccy); });
        IU.pagedTable(q('tbl'), groups, [{ label: D().label, html: function (g) { return '<b>' + esc(g.k || '(blank)') + '</b>'; } }, { label: 'Records', n: 1, f: 'count' }].concat(cfg.cols.map(function (c) { return { label: c.label, n: 1, html: function (g) { return esc(c.get(g, ccy)); } }; })), 10,
            { onRow: function (g) { toggle(g.k); }, rowCls: function (g) { return st.drill === g.k ? 'sel' : ''; } });
    }
    function toggle(k) { st.drill = st.drill === k ? null : k; draw(); }
    el.addEventListener('change', function (e) { var b = e.target.getAttribute('data-b'); if (b === 'dim') { st.dim = e.target.value; st.drill = null; } else if (b === 'meas') st.meas = e.target.value; else if (b === 'top') st.top = +e.target.value; else return; draw(); });
    el.addEventListener('click', function (e) { var b = e.target.closest('[data-b]'); if (!b) return; if (b.getAttribute('data-b') === 'undrill') { st.drill = null; draw(); } else if (b.getAttribute('data-b') === 'refresh') cfg.refresh(); });
    draw();
};

// ═══ Item Costs ════════════════════════════════════════════════
CST.itemCosts = {
    id: 'itemcosts', label: 'Item Costs', icon: 'fa-coins', group: 'Costs', desc: 'Perpetual average costs per valuation unit (itemCosts, latest)',
    render: function (el) {
        IU.tabs(el, [{ id: 'search', label: 'Search', icon: 'fa-magnifying-glass', render: search }, { id: 'dash', label: 'Dashboard', icon: 'fa-chart-column', render: dash }]);
        function search(p) {
            var cfg = {
                id: 'ic', resource: 'itemCosts', csvName: 'item_costs', pageSize: 500, columns: [], emptyText: 'Enter an item, organization or valuation unit (all optional) and search.',
                filters: [{ id: 'item', label: 'Item Number', ph: 'starts with…', q: function (v) { return 'ItemNumber LIKE ' + FX.qv(v.replace(/\*/g, '%') + '%'); } },
                    { id: 'org', label: 'Organization Code', ph: 'starts with…', q: function (v) { return 'OrganizationCode LIKE ' + FX.qv(v.replace(/\*/g, '%') + '%'); } },
                    { id: 'vu', label: 'Valuation Unit', ph: 'starts with…', q: function (v) { return 'ValuationUnit LIKE ' + FX.qv(v.replace(/\*/g, '%') + '%'); } }],
                actions: [{ label: 'Reset', icon: 'fa-eraser', run: function (g) { ['item', 'org', 'vu'].forEach(function (k) { g.setVal(k, ''); }); g.rows = []; g.render(); } }],
                load: function (g, more) {
                    return FX.get('itemCosts', { version: 'latest', q: g.buildQ(), limit: 500, offset: more ? g.offset : 0, total: !more, onlyData: false }).then(function (j) { g.hasMore = !!j.hasMore; if (j.totalResults != null) g.total = j.totalResults; return j.items || []; });
                },
                transform: function (items, g) {
                    items.forEach(function (r) { var pv = IU.parseVU(r.ValuationUnit); r._costOrg = pv.costOrg; r._invOrg = pv.invOrg; r._subinv = pv.subinv; r._lot = pv.lot; });
                    var all = (g.offset ? g.rows : []).concat(items), hasVU = all.some(function (r) { return r.ValuationUnit; });
                    var dyn = IU.dynCols(all, true).filter(function (c) { return c.f !== 'ValuationUnit'; }).map(function (c) { if (/Name$|Description$/.test(c.f)) c.html = (function (h) { return function (r) { return '<div style="min-width:200px">' + h(r) + '</div>'; }; })(c.html); return c; });
                    cfg.columns = (hasVU ? [{ f: '_costOrg', label: 'Cost Org' }, { f: '_invOrg', label: 'Inventory Org' }, { f: '_subinv', label: 'Subinventory' }, { f: '_lot', label: 'Lot' }] : []).concat(dyn);
                    return items;
                },
                onRow: function (r) {
                    var href = IU.link(r, 'costDetails') || (IU.self(r) ? IU.self(r) + '/child/costDetails' : null);
                    FX.drawer({
                        title: esc(r.ItemNumber || r.Item || 'Item cost'), sub: esc(r.ValuationUnit || ''), raw: r,
                        chips: [r.CurrencyCode ? '<span class="chip">' + esc(r.CurrencyCode) + '</span>' : ''],
                        facts: [['Cost Org', esc(r._costOrg)], ['Inventory Org', esc(r._invOrg || r.OrganizationCode)], ['Subinventory', esc(r._subinv)], ['Lot', esc(r._lot)], ['Unit cost', '<b>' + IU.n4(IU.unitCost(r)) + '</b>']]
                            .concat(Object.keys(r).filter(function (k) { return k !== 'links' && k.charAt(0) !== '_' && r[k] != null && r[k] !== '' && typeof r[k] !== 'object'; }).map(function (k) { return [IU.label(k), IU.cell(k, r[k])]; })),
                        tabs: href ? [{ label: 'Cost elements', render: function (b) { b.innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading…</div>'; IU.allHref(href).then(function (els) { b.innerHTML = els.length ? FX.table(els, [{ f: 'CostElement', label: 'Cost Element' }, { f: 'CostElementType', label: 'Type' }, { label: 'Unit Cost', n: 1, html: function (x) { return IU.n4(x.UnitCostAverage) + ' ' + esc(x.CurrencyCode || ''); } }, { label: '%', n: 1, html: function (x) { var n = IU.num(x.CostPercent); return n == null ? '' : n.toFixed(1) + '%'; } }]) : '<div class="empty">No cost elements.</div>'; }).catch(function (e) { b.innerHTML = '<div class="note err">' + esc(e) + '</div>'; }); } }] : []
                    });
                }
            };
            FX.grid(p, cfg);
        }
        function dash(p) {
            function load() {
                p.innerHTML = '<div class="card pad row-btns"><i class="fa-solid fa-circle-notch fa-spin" style="color:var(--accent)"></i><span id="icd-p">Reading item costs (up to 5,000)…</span></div>';
                FX.restAll('itemCosts', { version: 'latest', limit: 500 }, 5000, function (n) { var x = $('icd-p'); if (x) x.textContent = 'Loaded ' + n + ' item cost records…'; }).then(function (rows) {
                    var recs = rows.map(function (r) {
                        var pv = IU.parseVU(r.ValuationUnit);
                        return { item: IU.first(r, ['ItemNumber', 'Item']) || '', invOrg: pv.invOrg || IU.first(r, ['OrganizationCode', 'OrganizationName']) || '', subinv: pv.subinv || r.Subinventory || '', category: IU.first(r, ['ItemCategory', 'CategoryName', 'Category', 'ItemCategoryCode', 'CategoryCode']) || 'Uncategorized', cost: IU.unitCost(r), ccy: IU.first(r, ['CurrencyCode', 'Currency']) };
                    });
                    if (!recs.length) { p.innerHTML = '<div class="empty"><i class="fa-solid fa-coins"></i>No item costs returned.</div>'; return; }
                    p.innerHTML = '';
                    var box = document.createElement('div'); box.style.cssText = 'display:flex;flex-direction:column;gap:10px'; p.appendChild(box);
                    if (rows.length >= 5000) box.insertAdjacentHTML('beforebegin', '<div class="note warn">Capped at the first 5,000 cost records.</div>');
                    CST.board(box, {
                        recs: recs, refresh: load,
                        dims: [{ k: 'invOrg', label: 'Inventory Org' }, { k: 'subinv', label: 'Subinventory' }, { k: 'item', label: 'Item' }, { k: 'category', label: 'Item Category' }],
                        measures: [{ k: 'avg', label: 'Avg Unit Cost', money: 1, get: function (g) { return g.avg; } }, { k: 'sum', label: 'Total Unit Cost (Σ)', money: 1, get: function (g) { return g.sum; } }, { k: 'max', label: 'Max Unit Cost', money: 1, get: function (g) { return g.max; } }, { k: 'cnt', label: 'Record Count', count: 1, get: function (g) { return g.count; } }],
                        kpis: function (s, ccy) {
                            var costs = s.map(function (r) { return r.cost; }).filter(function (v) { return v != null; });
                            return [{ label: 'Cost Records', value: s.length.toLocaleString() }, { label: 'Items', value: IU.distinct(s.map(function (r) { return r.item; })).length.toLocaleString() }, { label: 'Inventory Orgs', value: IU.distinct(s.map(function (r) { return r.invOrg; })).length },
                                { label: 'Subinventories', value: IU.distinct(s.map(function (r) { return r.subinv; })).length }, { label: 'Avg Unit Cost', value: costs.length ? IU.price(costs.reduce(function (a, b) { return a + b; }, 0) / costs.length, ccy) : '—', cls: 'ok' }, { label: 'Max Unit Cost', value: costs.length ? IU.price(Math.max.apply(null, costs), ccy) : '—', cls: 'warn' }];
                        },
                        cols: [{ label: 'Avg', get: function (g, c) { return IU.price(g.avg, c); } }, { label: 'Max', get: function (g, c) { return IU.price(g.max, c); } }, { label: 'Total', get: function (g, c) { return IU.price(g.sum, c); } }]
                    });
                }).catch(function (e) { p.innerHTML = '<div class="note err">' + esc(e) + '</div><div><button class="btn" id="icd-r">Retry</button></div>'; $('icd-r').onclick = load; });
            }
            load();
        }
    }
};

// ═══ Receipt Costs ═════════════════════════════════════════════
CST.receiptCosts = {
    id: 'receiptcosts', label: 'Receipt Costs', icon: 'fa-receipt', group: 'Costs', desc: 'Receipt cost records grouped by valuation unit, with analytics',
    render: function (el) {
        var S = { rows: [] }, tabs;
        el.innerHTML = IU.filterCard([
            { label: 'Inventory Organization', html: '<select id="rc-org"><option value="">Loading…</option></select>' },
            { label: 'Reference # (PO)', html: IU.inp('rc-ref', 'e.g. 2026020095') }, { label: 'Item', html: IU.inp('rc-item', 'exact item number') },
            { label: 'Cost Date', html: '<div style="display:flex;gap:4px">' + IU.opSel('rc-op', '=') + IU.inp('rc-date', '', '', 'date') + '</div>' }
        ], '<button class="btn" id="rc-clear"><i class="fa-solid fa-eraser"></i> Clear</button><button class="btn primary" id="rc-go"><i class="fa-solid fa-magnifying-glass"></i> Search</button>') +
            '<div id="rc-prog" hidden class="row-btns"><div class="prog" style="flex:1"><div id="rc-bar"></div></div><span class="muted" id="rc-pt" style="font-size:.78rem"></span></div><div id="rc-tabs" style="display:flex;flex-direction:column;flex:1;min-height:0"></div>';
        FX.restAll('inventoryOrganizations', { fields: 'OrganizationCode,OrganizationName' }, 2000).then(function (r) {
            var seen = {}, list = r.filter(function (o) { if (!o.OrganizationName || seen[o.OrganizationName]) return false; seen[o.OrganizationName] = 1; return true; }).sort(function (a, b) { return String(a.OrganizationName).localeCompare(b.OrganizationName); });
            $('rc-org').innerHTML = '<option value="">All</option>' + list.map(function (o) { return '<option value="' + esc(o.OrganizationName) + '">' + esc(o.OrganizationName + ' (' + o.OrganizationCode + ')') + '</option>'; }).join('');
            $('rc-org').value = lsGet('fxcst_rc_org', '');
        }).catch(function (e) { $('rc-org').innerHTML = '<option value="">All</option>'; FX.toast(String(e), 'err'); });
        $('rc-go').onclick = search; IU.enter(['rc-ref', 'rc-item'], search);
        $('rc-clear').onclick = function () { $('rc-org').value = ''; $('rc-ref').value = ''; $('rc-item').value = ''; $('rc-op').value = '='; $('rc-date').value = ''; S.rows = []; draw(); };
        tabs = IU.tabs($('rc-tabs'), [{ id: 'search', label: 'Search', icon: 'fa-table', render: function (p) { p._draw = function () { drawSearch(p); }; p._draw(); }, onShow: function (p) { p._draw(); } },
            { id: 'ana', label: 'Analytics', icon: 'fa-chart-column', render: function (p) { p._draw = function () { drawAna(p); }; p._draw(); }, onShow: function (p) { p._draw(); } }]);
        function draw() { var p = tabs.pane(tabs.cur); if (p && p._draw) p._draw(); }
        function search() {
            var q = [], v;
            if ((v = $('rc-org').value)) q.push('InventoryOrganizationName=' + FX.qv(v));
            if ((v = $('rc-ref').value.trim())) q.push('ReferenceNumber=' + FX.qv(v));
            if ((v = $('rc-item').value.trim())) q.push('Item=' + FX.qv(v));
            if ((v = $('rc-date').value)) q.push('CostDate' + $('rc-op').value + v);
            lsSet('fxcst_rc_org', $('rc-org').value);
            $('rc-prog').hidden = false; $('rc-bar').style.width = '3%'; $('rc-pt').textContent = 'Counting records…';
            var base = { q: q.join(';'), onlyData: false };
            FX.get('receiptCosts', Object.assign({}, base, { limit: 50, offset: 0, total: true })).then(function (first) {
                var items = first.items || [], total = Math.min(first.totalResults != null ? first.totalResults : (first.hasMore ? 5000 : items.length), 5000);
                var offs = []; for (var o = 50; o < total; o += 50) offs.push(o);
                var pages = [items], done = items.length;
                $('rc-pt').textContent = 'Loaded ' + done + ' of ' + total + ' receipt cost records…'; $('rc-bar').style.width = (done / Math.max(total, 1) * 100) + '%';
                return IU.mapLimit(offs, 8, function (off) { return FX.get('receiptCosts', Object.assign({}, base, { limit: 50, offset: off })).then(function (j) { done += (j.items || []).length; $('rc-pt').textContent = 'Loaded ' + done + ' of ' + total + ' receipt cost records…'; $('rc-bar').style.width = (done / Math.max(total, 1) * 100) + '%'; return j.items || []; }); })
                    .then(function (res) { var bad = 0; res.forEach(function (x) { if (x.ok) pages.push(x.v); else bad++; }); if (bad) FX.toast(bad + ' page(s) failed to load.', 'err'); return [].concat.apply([], pages).slice(0, 5000); });
            }).then(function (rows) {
                S.rows = rows; $('rc-pt').textContent = rows.length + ' receipt cost records'; $('rc-bar').style.width = '100%';
                setTimeout(function () { $('rc-prog').hidden = true; }, 2500); draw();
            }).catch(function (e) { $('rc-prog').hidden = true; S.rows = []; var p = tabs.pane(tabs.cur); p.innerHTML = '<div class="note err">' + esc(e) + '</div>'; });
        }
        function drawSearch(p) {
            if (!S.rows.length) { p.innerHTML = '<div class="empty"><i class="fa-solid fa-receipt"></i>Search receipt costs by organization, PO, item or cost date.</div>'; return; }
            IU.costTable(p, S.rows, { itemCol: true, typeCol: true, csvName: 'receipt_costs', refresh: search });
        }
        function drawAna(p) {
            if (!S.rows.length) { p.innerHTML = '<div class="empty"><i class="fa-solid fa-chart-column"></i>Search first — the analytics use the same records.</div>'; return; }
            var recs = S.rows.map(function (r) { var pv = IU.parseVU(r.ValuationUnit); return { item: r.Item || '', invOrg: r.InventoryOrganizationName || pv.invOrg || '', subinv: pv.subinv || r.Subinventory || '', reference: r.ReferenceNumber || '', cost: IU.num(r.TotalUnitCost), receiptQty: IU.num(r.ReceiptQuantity) || 0, onhandQty: IU.num(r.QuantityOnhand) || 0, ccy: r.CurrencyCode || r.Currency || '' }; });
            p.innerHTML = ''; var box = document.createElement('div'); box.style.cssText = 'display:flex;flex-direction:column;gap:10px'; p.appendChild(box);
            CST.board(box, {
                recs: recs,
                dims: [{ k: 'invOrg', label: 'Inventory Org' }, { k: 'subinv', label: 'Subinventory' }, { k: 'item', label: 'Item' }, { k: 'reference', label: 'Reference (PO)' }],
                measures: [{ k: 'avg', label: 'Avg Unit Cost', money: 1, get: function (g) { return g.avg; } }, { k: 'sum', label: 'Total Unit Cost', money: 1, get: function (g) { return g.sum; } }, { k: 'rq', label: 'Receipt Qty', get: function (g) { return g.receiptQty; } }, { k: 'oq', label: 'On-hand Qty', get: function (g) { return g.onhandQty; } }, { k: 'cnt', label: 'Record Count', count: 1, get: function (g) { return g.count; } }],
                kpis: function (s, ccy) {
                    var costs = s.map(function (r) { return r.cost; }).filter(function (v) { return v != null; });
                    return [{ label: 'Cost Records', value: s.length.toLocaleString() }, { label: 'Items', value: IU.distinct(s.map(function (r) { return r.item; })).length }, { label: 'Inventory Orgs', value: IU.distinct(s.map(function (r) { return r.invOrg; })).length },
                        { label: 'Avg Unit Cost', value: costs.length ? IU.price(costs.reduce(function (a, b) { return a + b; }, 0) / costs.length, ccy) : '—', cls: 'ok' }, { label: 'Receipt Qty', value: IU.compact(IU.sum(s, 'receiptQty')) }, { label: 'On-hand Qty', value: IU.compact(IU.sum(s, 'onhandQty')), cls: 'warn' }];
                },
                cols: [{ label: 'Avg Unit Cost', get: function (g, c) { return IU.price(g.avg, c); } }, { label: 'Receipt Qty', get: function (g) { return IU.qty(g.receiptQty); } }, { label: 'On-hand Qty', get: function (g) { return IU.qty(g.onhandQty); } }, { label: 'Total Unit Cost', get: function (g, c) { return IU.price(g.sum, c); } }]
            });
        }
    }
};

// ═══ Cost Management ═══════════════════════════════════════════
CST.DEFAULT_STEPS = [
    { seq: 1, name: 'Transfer Transactions from Receiving to Costing', subledger: 'Receipt Accounting', description: 'Pulls receiving transactions into costing.', params: '' },
    { seq: 2, name: 'Transfer Transactions from Inventory to Costing', subledger: 'Cost Accounting', description: 'Pulls inventory delivery transactions into costing. Params: Cost Organization, Commit Limit.', params: ',500000' },
    { seq: 3, name: 'Create Receipt Accounting Distributions', subledger: 'Receipt Accounting', description: 'Costs and creates distributions for the receipt / accrual side. Commit 100000, 10 workers.', params: ',,100000,10,0,,,,,' },
    { seq: 4, name: 'Create Cost Accounting Distributions', subledger: 'Cost Accounting', description: 'The cost processor — values transactions and creates cost distributions. Param: run control (pod specific).', params: '{RUN_CONTROL}' },
    { seq: 5, name: 'Create Accounting (Cost & Receipt Accounting)', subledger: 'Subledger Accounting', description: 'Creates subledger journal entries and (optionally) posts to GL.', params: '' }
];
CST.ESS_STATES = { 1: 'WAIT', 2: 'READY', 3: 'RUNNING', 4: 'COMPLETED', 5: 'BLOCKED', 6: 'HOLD', 7: 'CANCELLING', 8: 'EXPIRED', 9: 'CANCELLED', 10: 'ERROR', 11: 'WARNING', 12: 'SUCCEEDED', 13: 'PAUSED', 14: 'PENDING_VALIDATION', 15: 'VALIDATION_FAILED', 16: 'SCHEDULE_ENDED', 17: 'FINISHED', 18: 'ERROR_AUTO_RETRY', 19: 'ERROR_MANUAL_RECOVERY' };
CST.stKey = function () { return 'fxcst_steps_' + FX.user; };
CST.loadSteps = function () {
    var saved = lsGet(CST.stKey(), null) || lsGet('cost_mgmt_steps', []) || [], rc = lsGet('fxcst_runctl_' + FX.user, 'AMS_RUN_CTRL');
    return CST.DEFAULT_STEPS.map(function (d) {
        var prev = (Array.isArray(saved) ? saved : []).filter(function (s) { return s.name === d.name; })[0] || {};
        var def = d.params.replace('{RUN_CONTROL}', rc);
        return Object.assign({}, d, { jobPackage: prev.jobPackage || '', jobDef: prev.jobDef || '', params: prev.params && String(prev.params).trim() ? prev.params : def, pid: prev.pid || '', reqId: prev.reqId || '', status: prev.status || '', at: prev.at || '' });
    });
};
CST.saveSteps = function (steps) { lsSet(CST.stKey(), steps.map(function (s) { return { name: s.name, jobPackage: s.jobPackage, jobDef: s.jobDef, params: s.params, pid: s.pid, reqId: s.reqId, status: s.status, at: s.at }; })); };
CST.essCls = function (s) { var u = String(s || '').toUpperCase(); return /SUCCEED|^COMPLETED$|FINISHED/.test(u) ? 'ok' : /ERROR|FAIL/.test(u) ? 'err' : /WARN/.test(u) ? 'warn' : /RUN|READY|WAIT|SCHEDUL|PENDING/.test(u) ? 'done' : ''; };
CST.essChip = function (s) { return s ? '<span class="chip ' + CST.essCls(s) + '">' + esc(s) + '</span>' : ''; };
CST.submit = function (pkg, def, params) {
    return FX.rest('POST', 'erpintegrations', {}, { OperationName: 'submitESSJobRequest', JobPackageName: pkg, JobDefName: def, ESSParameters: params || '' }).then(function (j) {
        var id = IU.first(j, ['ReqstId', 'reqstId', 'RequestId', 'DocumentId']);
        if (!id || String(id) === '-1') throw 'Fusion did not return a request id:\n' + JSON.stringify(j, null, 2).slice(0, 1500);
        return { id: String(id), raw: j };
    });
};
CST.status = function (id) {
    function read(j) { return { status: IU.first(j, ['RequestStatus', 'requestStatus', 'Status']) || 'UNKNOWN', raw: j }; }
    return FX.rest('POST', 'erpintegrations', {}, { OperationName: 'getESSJobStatus', ReqstId: String(id) }).then(read, function (e) {
        // older pods used the lower-case attribute name of the original screen
        return FX.rest('POST', 'erpintegrations', {}, { OperationName: 'getESSJobStatus', requestId: String(id) }).then(read, function () { return { status: 'HTTP ' + ((FX.lastCall || {}).status || '?'), raw: String(e) }; });
    });
};
/** Package + definition from an ESS_REQUEST_HISTORY row (DEFINITION = JobDefinition://oracle/apps/…/JobName) or any deep-scanned keys. */
CST.parseDef = function (row) {
    var pkg = '', def = '', path = '';
    (function scan(o) {
        if (!o || typeof o !== 'object') return;
        Object.keys(o).forEach(function (k) {
            var v = o[k];
            if (v && typeof v === 'object') { scan(v); return; }
            if (typeof v !== 'string' || !v) return;
            if (!path && /JobDefinition:\/\//i.test(v)) path = v.replace(/^.*JobDefinition:\/\//i, '').split(/[;\s]/)[0];
            if (!pkg && /package/i.test(k)) pkg = v;
            if (!def && /(jobdef(inition)?name|definitionname|^definition$|^jobdefinition$|^jobname$|^jobdef$)/i.test(k)) def = v;
        });
    })(row);
    if (path) def = path;
    if (def && def.indexOf('/') >= 0) { var parts = def.replace(/^JobDefinition:\/\//i, '').split('/'); def = parts.pop(); pkg = (parts.join('/').charAt(0) === '/' ? '' : '/') + parts.join('/'); }
    else if (pkg && pkg.indexOf('/') >= 0 && !def) { var pp = pkg.split('/'); def = pp.pop(); pkg = pp.join('/'); }
    return { pkg: pkg, def: def };
};
CST.essRow = function (id) {
    return FX.sql('SELECT * FROM ess_request_history WHERE requestid = ' + (+id), 5).then(function (r) { return r[0] || null; });
};
CST.essParams = function (id) {
    return FX.sql("SELECT name, value FROM ess_request_property WHERE requestid = " + (+id) + " AND name LIKE 'submit.argument%'", 200).then(function (r) {
        var a = []; r.forEach(function (x) { var n = +(String(x.NAME).match(/(\d+)$/) || [])[1]; if (n) a[n - 1] = x.VALUE == null ? '' : x.VALUE; });
        for (var i = 0; i < a.length; i++) if (a[i] == null) a[i] = '';
        return a.join(',');
    });
};

CST.costMgmt = {
    id: 'costmgmt', label: 'Cost Management', icon: 'fa-gears', group: 'Processes', desc: 'Run the post-receipt costing processes in order and monitor them',
    render: function (el) {
        var steps = CST.loadSteps(), jobs = lsGet('fxcst_jobs_' + FX.user, []) || [];
        function saveJobs() { lsSet('fxcst_jobs_' + FX.user, jobs.slice(0, 60)); }
        var tabs = IU.tabs(el, [
            { id: 'flow', label: 'Cost Flow', icon: 'fa-diagram-next', render: flowTab, onShow: function (p) { p._draw(); } },
            { id: 'jobs', label: 'ESS Jobs', icon: 'fa-list-check', render: jobsTab, onShow: function (p) { p._draw(); } },
            { id: 'mon', label: 'ESS Monitor', icon: 'fa-binoculars', render: monTab }
        ]);
        function run(s) {
            if (!s.jobPackage || !s.jobDef) { FX.toast('Set the Job Package and Job Definition for "' + s.name + '" first (Detect them from a past run).', 'err'); return; }
            FX.confirm('Run ' + esc(s.name), '<div class="facts"><div><span>Package</span><span class="mono">' + esc(s.jobPackage) + '</span></div><div><span>Definition</span><span class="mono">' + esc(s.jobDef) + '</span></div><div><span>Parameters</span><span class="mono">' + esc(s.params || '(none)') + '</span></div></div><div class="note warn" style="margin-top:10px">This submits the job in <b>' + FX.instance + '</b>.</div>', 'Run', 'primary').then(function (ok) {
                if (!ok) return;
                FX.busy('Submitting ' + s.name + '…');
                CST.submit(s.jobPackage, s.jobDef, s.params).then(function (r) {
                    FX.busy(); s.reqId = r.id; s.status = 'RUNNING'; s.at = new Date().toISOString(); CST.saveSteps(steps);
                    var j = { requestId: r.id, step: s.name, status: 'RUNNING', submittedAt: s.at, response: JSON.stringify(r.raw, null, 2) }; jobs.unshift(j); saveJobs();
                    FX.toast('Submitted — request ' + r.id, 'ok'); redraw(); refreshJob(j, s);
                }).catch(function (e) { FX.busy(); FX.modal({ title: 'Submit failed — ' + esc(s.name), wide: true, body: '<pre class="json">' + esc(String(e)) + '</pre>' }); });
            });
        }
        function refreshJob(j, s) {
            if (!j.requestId) return Promise.resolve();
            j._busy = true; redraw();
            return CST.status(j.requestId).then(function (r) {
                j._busy = false; j.status = r.status; j.response = typeof r.raw === 'string' ? r.raw : JSON.stringify(r.raw, null, 2);
                steps.forEach(function (st) { if (st.reqId === j.requestId) st.status = r.status; }); if (s) s.status = r.status;
                CST.saveSteps(steps); saveJobs(); redraw();
            });
        }
        function refreshStep(s) { if (!s.reqId) return Promise.resolve(); var j = jobs.filter(function (x) { return x.requestId === s.reqId; })[0] || { requestId: s.reqId, step: s.name }; if (jobs.indexOf(j) < 0) { jobs.unshift(j); } return refreshJob(j, s); }
        function redraw() { ['flow', 'jobs'].forEach(function (t) { var p = tabs.pane(t); if (p && p._draw && !p.hidden) p._draw(); }); }
        function detect(s, quiet) {
            if (!s.pid) { if (!quiet) FX.toast('Enter the Process ID of a past run of "' + s.name + '".', 'err'); return Promise.resolve(); }
            return Promise.all([CST.essRow(s.pid), CST.essParams(s.pid).catch(function () { return null; })]).then(function (r) {
                var row = r[0]; if (!row) throw 'Process ' + s.pid + ' not found in ESS_REQUEST_HISTORY.';
                var d = CST.parseDef(row);
                if (d.pkg) s.jobPackage = d.pkg; if (d.def) s.jobDef = d.def; CST.saveSteps(steps); redraw();
                if (quiet) return d;
                FX.modal({
                    title: 'Detected from process ' + esc(s.pid), wide: true,
                    body: '<div class="facts"><div><span>Job package</span><span class="mono">' + esc(d.pkg || '(not found)') + '</span></div><div><span>Job definition</span><span class="mono">' + esc(d.def || '(not found)') + '</span></div><div><span>Parameters of that run</span><span class="mono">' + esc(r[1] == null ? '(could not read ESS_REQUEST_PROPERTY)' : r[1] || '(none)') + '</span></div></div>' +
                        '<details><summary class="muted" style="cursor:pointer">Raw ESS_REQUEST_HISTORY row</summary><pre class="json">' + esc(JSON.stringify(row, null, 2)) + '</pre></details>',
                    buttons: [{ label: 'Close', act: 'close' }].concat(r[1] ? [{ label: 'Use these parameters too', cls: 'primary', act: 'params' }] : []),
                    onAction: function (a) { if (a === 'params') { s.params = r[1]; CST.saveSteps(steps); redraw(); FX.toast('Parameters copied.', 'ok'); } }
                });
                return d;
            }).catch(function (e) { if (!quiet) FX.toast(String(e), 'err'); throw e; });
        }

        function flowTab(p) {
            p._draw = function () {
                var rc = lsGet('fxcst_runctl_' + FX.user, 'AMS_RUN_CTRL');
                p.innerHTML = '<div class="toolbar"><button class="btn" data-f="detectAll"><i class="fa-solid fa-wand-magic-sparkles"></i> Detect all</button><button class="btn" data-f="refreshAll"><i class="fa-solid fa-rotate"></i> Refresh all statuses</button>' +
                    '<label class="muted" style="font-size:.76rem;display:flex;gap:6px;align-items:center">Run control <input id="cm-rc" value="' + esc(rc) + '" style="width:150px"></label><span class="grow" style="flex:1"></span><button class="btn sm" data-f="reset"><i class="fa-solid fa-rotate-left"></i> Reset to defaults</button></div>' +
                    '<div class="note"><i class="fa-solid fa-circle-info"></i> Job package / definition differ per pod. Enter the <b>Process ID</b> of a past run (Scheduled Processes) and click <b>Detect</b> — it is read from <span class="mono">ESS_REQUEST_HISTORY</span> through the read-only Fusion SQL runner. Parameters are positional and comma-separated. Saved per user on this PC.</div>' +
                    '<div class="card" style="overflow:auto"><table class="tbl"><thead><tr><th>#</th><th style="min-width:200px">Process</th><th>Job Package</th><th>Job Definition</th><th>Params</th><th>Detect from run</th><th></th><th>Status</th></tr></thead><tbody>' +
                    steps.map(function (s, i) {
                        return '<tr data-i="' + i + '"><td><span class="chip info">' + s.seq + '</span></td><td><b>' + esc(s.name) + '</b><span class="sub2">' + esc(s.subledger) + ' — ' + esc(s.description) + '</span></td>' +
                            '<td class="ed"><input data-k="jobPackage" value="' + esc(s.jobPackage) + '" placeholder="/oracle/apps/ess/…" style="min-width:200px;font-family:var(--mono);font-size:.74rem"></td>' +
                            '<td class="ed"><input data-k="jobDef" value="' + esc(s.jobDef) + '" style="min-width:140px;font-family:var(--mono);font-size:.74rem"></td>' +
                            '<td class="ed"><input data-k="params" value="' + esc(s.params) + '" style="min-width:120px;font-family:var(--mono);font-size:.74rem"></td>' +
                            '<td class="ed" style="white-space:nowrap"><div style="display:flex;gap:4px"><input data-k="pid" value="' + esc(s.pid) + '" placeholder="process id" style="width:100px"><button class="btn sm" data-f="detect">Detect</button></div></td>' +
                            '<td><button class="btn sm primary" data-f="run"><i class="fa-solid fa-play"></i> Run</button></td>' +
                            '<td style="white-space:nowrap">' + (s.reqId ? '<span class="mono">' + esc(s.reqId) + '</span> ' + CST.essChip(s.status) + ' <button class="btn sm icon" data-f="status" title="Refresh status"><i class="fa-solid fa-rotate"></i></button>' : '<span class="muted">—</span>') + '</td></tr>';
                    }).join('') + '</tbody></table></div>';
                $('cm-rc').onchange = function () { lsSet('fxcst_runctl_' + FX.user, this.value.trim()); var s4 = steps[3]; if (!s4.params || /^AMS_RUN_CTRL$|^\{/.test(s4.params) || s4.params === rc) { s4.params = this.value.trim(); CST.saveSteps(steps); } p._draw(); };
            };
            p.addEventListener('input', function (e) { var tr = e.target.closest('tr[data-i]'), k = e.target.getAttribute('data-k'); if (tr && k) { steps[+tr.getAttribute('data-i')][k] = e.target.value.trim(); CST.saveSteps(steps); } });
            p.addEventListener('click', function (e) {
                var b = e.target.closest('[data-f]'); if (!b) return; var f = b.getAttribute('data-f'), tr = b.closest('tr[data-i]'), s = tr && steps[+tr.getAttribute('data-i')];
                if (f === 'run') run(s); else if (f === 'detect') detect(s); else if (f === 'status') refreshStep(s);
                else if (f === 'refreshAll') IU.mapLimit(steps.filter(function (x) { return x.reqId; }), 3, refreshStep).then(function () { FX.toast('Statuses refreshed.'); });
                else if (f === 'detectAll') { var w = steps.filter(function (x) { return x.pid; }); if (!w.length) { FX.toast('Enter a Process ID on at least one step.', 'err'); return; } FX.busy('Detecting ' + w.length + ' job(s)…'); IU.mapLimit(w, 3, function (x) { return detect(x, true); }).then(function (r) { FX.busy(); var bad = r.filter(function (x) { return !x.ok; }).length; FX.toast(bad ? bad + ' step(s) could not be detected.' : 'Detected ' + w.length + ' job(s).', bad ? 'err' : 'ok'); }); }
                else if (f === 'reset') FX.confirm('Reset steps', 'Forget the saved packages, definitions, parameters and process ids?', 'Reset', 'warn').then(function (ok) { if (ok) { lsSet(CST.stKey(), []); lsSet('cost_mgmt_steps', []); steps = CST.loadSteps(); p._draw(); } });
            });
            p._draw();
        }
        function jobsTab(p) {
            p._draw = function () {
                p.innerHTML = '<div class="toolbar">' + steps.map(function (s, i) { return '<button class="btn sm" data-j="run" data-i="' + i + '" title="' + esc(s.name) + '"><i class="fa-solid fa-play" style="color:var(--ok)"></i> ' + s.seq + '. ' + esc(s.name.length > 34 ? s.name.slice(0, 32) + '…' : s.name) + '</button>'; }).join('') + '</div>' +
                    '<div class="toolbar"><input id="cm-chk" placeholder="Request ID" style="width:160px"><button class="btn" data-j="check"><i class="fa-solid fa-magnifying-glass"></i> Check</button><span class="grow" style="flex:1"></span><button class="btn" data-j="refreshAll"><i class="fa-solid fa-rotate"></i> Refresh all</button><button class="btn sm" data-j="clear"><i class="fa-solid fa-trash"></i> Clear list</button></div>' +
                    '<div class="card" style="overflow:auto">' + (jobs.length ? '<table class="tbl"><thead><tr><th>Request</th><th>Step</th><th>Status</th><th>Submitted</th><th></th></tr></thead><tbody>' + jobs.map(function (j, i) {
                        return '<tr data-i="' + i + '"><td class="mono">' + esc(j.requestId) + '</td><td>' + esc(j.step) + '</td><td>' + (j._busy ? '<i class="fa-solid fa-circle-notch fa-spin muted"></i>' : CST.essChip(j.status)) + '</td><td>' + esc(IU.dt(j.submittedAt)) + '</td><td style="white-space:nowrap"><button class="btn sm" data-j="status"><i class="fa-solid fa-rotate"></i> Status</button> <button class="btn sm" data-j="raw"><i class="fa-solid fa-code"></i></button></td></tr>';
                    }).join('') + '</tbody></table>' : '<div class="empty"><i class="fa-solid fa-list-check"></i>No jobs submitted from this PC yet.</div>') + '</div>';
            };
            p.addEventListener('click', function (e) {
                var b = e.target.closest('[data-j]'); if (!b) return; var a = b.getAttribute('data-j'), tr = b.closest('tr[data-i]'), j = tr && jobs[+tr.getAttribute('data-i')];
                if (a === 'run') run(steps[+b.getAttribute('data-i')]);
                else if (a === 'status') refreshJob(j);
                else if (a === 'raw') FX.modal({ title: 'Request ' + esc(j.requestId), wide: true, body: '<pre class="json">' + esc(j.response || '(no response yet)') + '</pre>' });
                else if (a === 'refreshAll') IU.mapLimit(jobs.slice(0, 20), 3, function (x) { return refreshJob(x); });
                else if (a === 'clear') { jobs = []; saveJobs(); p._draw(); }
                else if (a === 'check') { var id = $('cm-chk').value.trim(); if (!/^\d+$/.test(id)) { FX.toast('Enter a numeric request id.', 'err'); return; } var ex = jobs.filter(function (x) { return x.requestId === id; })[0]; if (!ex) { ex = { requestId: id, step: '(manual lookup)', status: '', submittedAt: '' }; jobs.unshift(ex); } refreshJob(ex); }
            });
            p._draw();
        }
        function monTab(p) {
            var rows = [], cols1 = 'requestid, name, definition, state, submitter, processstart, processend, parentrequestid, executable_status';
            p.innerHTML = '<div class="card"><div class="filters"><label>State<select id="mn-st"><option value="">ALL</option>' + Object.keys(CST.ESS_STATES).map(function (k) { return '<option value="' + k + '">' + CST.ESS_STATES[k] + '</option>'; }).join('') + '</select></label>' +
                '<label>Job contains' + IU.inp('mn-job', 'e.g. Cost, Receipt') + '</label><label>Submitted by' + IU.inp('mn-user', 'user name') + '</label>' +
                '<label>Rows<select id="mn-n"><option>100</option><option selected>200</option><option>500</option></select></label>' +
                '<div class="go"><button class="btn primary" id="mn-go"><i class="fa-solid fa-download"></i> Load requests</button></div></div>' +
                '<div class="note" style="margin:0 12px 10px"><i class="fa-solid fa-database"></i> Read-only Fusion SQL on <span class="mono">ESS_REQUEST_HISTORY</span> (the ESS scheduler REST API is outside the app\'s Fusion relay). Newest requests first.</div></div>' +
                '<div id="mn-grid" style="display:flex;flex-direction:column;flex:1;min-height:0;gap:10px"></div>';
            var g = IU.localGrid($('mn-grid'), {
                id: 'mn', rows: function () { return rows; }, csvName: 'ess_requests', emptyText: 'Load requests to see the latest ESS jobs.',
                kpis: function (r) { if (!r.length) return []; var c = function (re) { return r.filter(function (x) { return re.test(x._state); }).length; }; return [{ k: 'a', label: 'Requests', value: r.length }, { k: 'r', label: 'Running / waiting', value: c(/RUN|WAIT|READY|BLOCK/), filter: function (x) { return /RUN|WAIT|READY|BLOCK/.test(x._state); } }, { k: 'e', label: 'Error', value: c(/ERROR/), filter: function (x) { return /ERROR/.test(x._state); } }, { k: 'w', label: 'Warning', value: c(/WARN/), filter: function (x) { return /WARN/.test(x._state); } }, { k: 's', label: 'Succeeded', value: c(/SUCCEED|FINISH/), filter: function (x) { return /SUCCEED|FINISH/.test(x._state); } }]; },
                columns: [{ f: 'REQUESTID', label: 'Request', fmt: 'mono' }, { label: 'State', get: function (r) { return r._state; }, html: function (r) { return CST.essChip(r._state); } },
                    { label: 'Job', get: function (r) { return r._job; }, html: function (r) { return '<b>' + esc(r._job) + '</b><span class="sub2 mono">' + esc(r._pkg) + '</span>'; } },
                    { f: 'SUBMITTER', label: 'Submitter' }, { label: 'Started', get: function (r) { return r.PROCESSSTART; }, html: function (r) { return esc(IU.dt(r.PROCESSSTART)); } }, { label: 'Ended', get: function (r) { return r.PROCESSEND; }, html: function (r) { return esc(IU.dt(r.PROCESSEND)); } },
                    { f: 'PARENTREQUESTID', label: 'Parent', fmt: 'mono' }, { f: 'EXECUTABLE_STATUS', label: 'Executable status' }],
                rowActions: [{ label: 'Detail', icon: 'fa-circle-info', run: function (r) { detail(r); } }],
                onRow: function (r) { detail(r); }
            });
            $('mn-go').onclick = load; IU.enter(['mn-job', 'mn-user'], load);
            function load() {
                var w = [], v;
                if ((v = $('mn-st').value)) w.push('state = ' + (+v));
                if ((v = $('mn-job').value.trim())) w.push('UPPER(definition) LIKE ' + IU.sqlLit('%' + v.toUpperCase() + '%'));
                if ((v = $('mn-user').value.trim())) w.push('UPPER(submitter) LIKE ' + IU.sqlLit('%' + v.toUpperCase() + '%'));
                var n = +$('mn-n').value, where = w.length ? ' WHERE ' + w.join(' AND ') : '';
                var sql = function (cols) { return 'SELECT * FROM (SELECT ' + cols + ' FROM ess_request_history' + where + ' ORDER BY requestid DESC) WHERE ROWNUM <= ' + n; };
                g.loading('Reading ESS requests…');
                FX.sql(sql(cols1), n).catch(function () { return FX.sql(sql('*'), n); }).then(function (r) {
                    r.forEach(function (x) { var d = CST.parseDef(x); x._job = d.def || x.NAME || ''; x._pkg = d.pkg; x._state = CST.ESS_STATES[x.STATE] || String(x.STATE == null ? '' : x.STATE); });
                    rows = r; g.refresh();
                }).catch(g.error);
            }
            function detail(r) {
                var d = CST.parseDef(r);
                FX.drawer({
                    title: 'Request ' + esc(r.REQUESTID), sub: esc(d.pkg + '/' + d.def), chips: [CST.essChip(r._state)], raw: r,
                    facts: Object.keys(r).filter(function (k) { return k.charAt(0) !== '_' && r[k] != null && r[k] !== ''; }).map(function (k) { return [k, esc(r[k])]; }),
                    actions: [{ label: 'Use for a cost step…', icon: 'fa-diagram-next', run: function () {
                        FX.modal({
                            title: 'Use ' + esc(d.def) + ' for a step', body: '<div class="checklist" style="grid-template-columns:1fr">' + steps.map(function (s, i) { return '<label><input type="radio" name="usestep" value="' + i + '"> ' + s.seq + '. ' + esc(s.name) + '</label>'; }).join('') + '</div><label style="display:flex;gap:8px;align-items:center;font-size:.82rem"><input type="checkbox" id="use-par" checked> Copy the parameters of this run too</label>',
                            buttons: [{ label: 'Cancel', act: 'close' }, { label: 'Use', cls: 'primary', act: 'use' }],
                            onAction: function (a, box) {
                                if (a !== 'use') return; var c = box.querySelector('[name="usestep"]:checked'); if (!c) { FX.toast('Pick a step.', 'err'); return false; }
                                var s = steps[+c.value], withP = $('use-par').checked; s.jobPackage = d.pkg; s.jobDef = d.def; s.pid = String(r.REQUESTID);
                                return (withP ? CST.essParams(r.REQUESTID).then(function (pp) { s.params = pp; }).catch(function () { FX.toast('Could not read the parameters (ESS_REQUEST_PROPERTY).', 'err'); }) : Promise.resolve()).then(function () { CST.saveSteps(steps); FX.toast('Step ' + s.seq + ' updated.', 'ok'); });
                            }
                        });
                    } }],
                    tabs: [{ label: 'Parameters', render: function (b) { b.innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading ESS_REQUEST_PROPERTY…</div>'; FX.sql("SELECT name, value FROM ess_request_property WHERE requestid = " + (+r.REQUESTID) + " ORDER BY name", 500).then(function (pp) { b.innerHTML = pp.length ? FX.table(pp, [{ f: 'NAME', label: 'Name', fmt: 'mono' }, { f: 'VALUE', label: 'Value' }]) : '<div class="empty">No properties.</div>'; }).catch(function (e) { b.innerHTML = '<div class="note err">' + esc(e) + '</div>'; }); } },
                        { label: 'Status (erpintegrations)', render: function (b) { b.innerHTML = '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Asking Fusion…</div>'; CST.status(r.REQUESTID).then(function (s) { b.innerHTML = '<div>' + CST.essChip(s.status) + '</div><pre class="json">' + esc(typeof s.raw === 'string' ? s.raw : JSON.stringify(s.raw, null, 2)) + '</pre>'; }); } }]
                });
            }
        }
    }
};
