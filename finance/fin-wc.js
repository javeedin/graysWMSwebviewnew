/* Finance Lens — Working capital: debtors, creditors and stock from the Oracle Fusion subledgers (host
   classes/FinanceWc.cs: finWcSync → DuckDB snapshots fin_wc_parties / fin_wc_stock / fin_wc_snapshots + business unit /
   organisation names fin_wc_names, finWcItems = item master with its descriptive flexfield → fin_items, finWcItemDff = DFF
   labels → fin_item_dff, finWcNames, finWcDetail = live open items of one party / item, finWcCostTables = candidate
   unit-cost tables). Ageing is as of the sync time; the GL control accounts (balance sheet lines AR, AP, INV) are shown
   beside the subledger totals. Stock is joined to the item master on this PC (item type, DFF columns → group by any of
   them); value = item cost from the chosen cost table, else the item list price, else the GL. Every grid has a filter box
   per column (FL.grid). */
(function () {
    var W = FL.wc = { sub: FL.ls('wc.sub', 'AR'), bu: FL.ls('wc.bu', ''), org: FL.ls('wc.org', ''), grp: FL.ls('wc.grp', ''), data: null };
    var KIND = { AR: ['Debtors', 'customers', 'fa-hand-holding-dollar'], AP: ['Creditors', 'suppliers', 'fa-file-invoice'], INV: ['Inventory', 'items', 'fa-boxes-stacked'] };
    var AGE = [[90, '0-90 days'], [180, '91-180 days'], [365, '181-365 days'], [1e9, 'over a year']];
    var DFF_COLS = ['attribute_category'].concat(Array.apply(null, Array(30)).map(function (x, i) { return 'attribute' + (i + 1); }))
        .concat(Array.apply(null, Array(10)).map(function (x, i) { return 'attribute_number' + (i + 1); })).concat(Array.apply(null, Array(5)).map(function (x, i) { return 'attribute_date' + (i + 1); }));

    W.cfg = function () { return Object.assign({ pod: '', buckets: [30, 60, 90, 180], orgs: [], cost: null, listPrice: true, dffLabels: {}, arQuery: '', apQuery: '', invQuery: '' }, (FL.config && FL.config.wc) || {}); };
    var pod = function () { return FL.q(W.cfg().pod || ''); };
    var safe = function (p, d) { return p.catch(function () { return d; }); };

    /** Label of an item flexfield column: yours (Item DFF profile), else Fusion's (fin_item_dff), else the column */
    W.dffLabel = function (col) {
        var c = String(col).toLowerCase(), mine = (W.cfg().dffLabels || {})[c.toUpperCase()];
        if (mine) return mine;
        var f = ((W.data || {}).dff || {})[c.toUpperCase()];
        return f || (c === 'attribute_category' ? 'DFF context' : c.toUpperCase());
    };
    /** Flexfield columns worth showing: labelled (yours or Fusion's) — at most 12 */
    W.dffCols = function () {
        var mine = Object.keys(W.cfg().dffLabels || {}).map(function (k) { return k.toLowerCase(); }), fus = Object.keys(((W.data || {}).dff) || {}).map(function (k) { return k.toLowerCase(); });
        return DFF_COLS.filter(function (c) { return mine.indexOf(c) >= 0 || fus.indexOf(c) >= 0; }).slice(0, 12);
    };

    /** Latest snapshot of every kind, the trend of totals, names, the item master joined to the stock */
    W.load = function () {
        var p = pod();
        var meta = Promise.all([
            safe(FL.rows("SELECT kind, id, name FROM fin_wc_names WHERE pod = " + p, 100000), []),
            safe(FL.rows("SELECT COUNT(*) AS n, COUNT(DISTINCT org_id) AS orgs, COUNT(list_price) AS priced, CAST(MAX(read_at) AS VARCHAR) AS at FROM fin_items WHERE pod = " + p, 1), [{ n: 0 }]),
            safe(FL.rows("SELECT column_name, string_agg(DISTINCT label, ' / ') AS label FROM fin_item_dff WHERE pod = " + p + " GROUP BY 1", 500), []),
            safe(FL.rows("SELECT DISTINCT org_id FROM fin_items WHERE pod = " + p, 10000), [])
        ]);
        return Promise.all([safe(FL.rows("SELECT kind, CAST(snapshot_at AS VARCHAR) AS at, rows, total, note, capped FROM fin_wc_snapshots WHERE pod = " + p + " ORDER BY snapshot_at", 2000), []), meta]).then(function (r0) {
            var snaps = r0[0], m = r0[1], names = { BU: {}, ORG: {} }, dff = {};
            m[0].forEach(function (x) { (names[x.kind] = names[x.kind] || {})[x.id] = x.name; });
            m[2].forEach(function (x) { dff[String(x.column_name).toUpperCase()] = x.label; });
            W.data = W.data || {}; W.data.dff = dff;
            var base = { names: names, dff: dff, items: m[1][0] || { n: 0 }, itemOrgs: m[3].map(function (x) { return x.org_id; }) };
            if (!snaps.length) return Object.assign({ empty: true }, base);
            var last = {}; snaps.forEach(function (s) { last[s.kind] = s; });
            var q = [];
            ['AR', 'AP'].forEach(function (k) { q.push(last[k] ? FL.rows("SELECT * FROM fin_wc_parties WHERE pod = " + p + " AND kind = '" + k + "' AND CAST(snapshot_at AS VARCHAR) = " + FL.q(last[k].at), 200000) : Promise.resolve([])); });
            if (last.INV) {
                var w = " WHERE s.pod = " + p + " AND CAST(s.snapshot_at AS VARCHAR) = " + FL.q(last.INV.at);
                var extra = W.dffCols().concat(W.grp && DFF_COLS.indexOf(W.grp) >= 0 && W.dffCols().indexOf(W.grp) < 0 ? [W.grp] : []);
                var joined = "SELECT s.*, i.item_type, i.status AS item_status, i.list_price, i.item_id IS NOT NULL AS in_master" + extra.map(function (c) { return ", CAST(i." + c + " AS VARCHAR) AS " + c; }).join('') +
                    " FROM fin_wc_stock s LEFT JOIN (SELECT * FROM fin_items WHERE pod = " + p + " QUALIFY ROW_NUMBER() OVER (PARTITION BY org_id, item_number ORDER BY read_at DESC) = 1) i ON i.org_id = s.org_id AND i.item_number = s.item_number" + w;
                q.push(FL.rows(joined, 300000).catch(function () { return FL.rows("SELECT s.* FROM fin_wc_stock s" + w, 300000); }));
            } else q.push(Promise.resolve([]));
            return Promise.all(q).then(function (r) { return Object.assign({ snaps: snaps, last: last, AR: r[0], AP: r[1], INV: r[2] }, base); });
        }).catch(function () { return null; });
    };
    W.buckets = function () {
        var b = (W.cfg().buckets || [30, 60, 90, 180]).map(Number).filter(function (x) { return x > 0; }).sort(function (a, c) { return a - c; });
        var out = ['Current'], lo = 1; b.forEach(function (x) { out.push(lo + '-' + x); lo = x + 1; }); out.push('>' + (b[b.length - 1] || 0));
        return out;
    };
    W.buName = function (id) { var n = ((W.data || {}).names || {}).BU || {}; return n[id] || id; };
    W.orgName = function (id, code) { var n = (((W.data || {}).names || {}).ORG || {})[id]; return code && code !== id ? code + (n ? ' · ' + n : '') : n || id; };

    /** Parties of a kind (filtered by business unit) → [{number, name, bu, total, by bucket, items, oldest, hold}] */
    W.parties = function (rows) {
        var by = {};
        rows.forEach(function (r) {
            if (W.bu && r.bu_id !== W.bu) return;
            var k = r.party_number + '|' + r.party_name, p = by[k] = by[k] || { number: r.party_number, name: r.party_name, bu: {}, total: 0, b: {}, items: 0, oldest: null, hold: 0, ccy: {} };
            p.total += r.amount; p.b[r.bucket] = (p.b[r.bucket] || 0) + r.amount; p.items += r.items; p.hold += r.on_hold || 0; p.bu[r.bu_id] = 1; p.ccy[r.currency] = 1;
            if (r.oldest_due && (!p.oldest || r.oldest_due < p.oldest)) p.oldest = r.oldest_due;
        });
        return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return Math.abs(b.total) - Math.abs(a.total); });
    };
    W.totals = function (rows) {
        var t = { total: 0, b: {}, items: 0, hold: 0 };
        rows.forEach(function (r) { if (W.bu && r.bu_id !== W.bu) return; t.total += r.amount; t.b[r.bucket] = (t.b[r.bucket] || 0) + r.amount; t.items += r.items; t.hold += r.on_hold || 0; });
        t.overdue = t.total - (t.b.Current || 0);
        t.old90 = 0; W.buckets().forEach(function (n) { var lo = +String(n).replace(/^>/, '').split('-')[0]; if (n !== 'Current' && (n.charAt(0) === '>' ? lo >= 90 : lo > 90)) t.old90 += t.b[n] || 0; });
        return t;
    };
    /** Value of one on-hand line: item cost × quantity, else list price × quantity (when allowed), else null */
    W.val = function (r) {
        if (r.value != null) return { v: r.value, b: 'cost' };
        if (W.cfg().listPrice !== false && r.list_price != null) return { v: r.quantity * r.list_price, b: 'list' };
        return { v: null, b: null };
    };
    W.stock = function (rows) {
        var t = { qty: 0, value: 0, valued: 0, cost: 0, list: 0, lines: 0, inMaster: 0, age: {}, ageQty: {}, orgs: {}, items: {}, rows: [] };
        rows.forEach(function (r) {
            if (W.org && r.org_id !== W.org) return;
            var vv = W.val(r); r._v = vv.v; r._b = vv.b;
            t.lines++; t.qty += r.quantity; if (r.in_master) t.inMaster++;
            if (vv.v != null) { t.value += vv.v; t.valued++; t[vv.b]++; }
            var a = AGE.filter(function (x) { return (r.age_days == null ? 0 : r.age_days) <= x[0]; })[0][1];
            t.age[a] = (t.age[a] || 0) + (vv.v || 0); t.ageQty[a] = (t.ageQty[a] || 0) + r.quantity;
            var o = t.orgs[r.org_id] = t.orgs[r.org_id] || { id: r.org_id, code: r.org_code || r.org_id, qty: 0, value: 0, lines: 0 }; o.qty += r.quantity; o.value += vv.v || 0; o.lines++;
            var key = r.org_id + '|' + r.item_number;
            var it = t.items[key] = t.items[key] || { item: r.item_number, desc: r.description, uom: r.uom, org: W.orgName(r.org_id, r.org_code), org_id: r.org_id, qty: 0, value: 0, valued: false, basis: '', maxAge: 0, subs: {}, r: r };
            it.qty += r.quantity; it.value += vv.v || 0; if (vv.v != null) { it.valued = true; it.basis = vv.b; } it.maxAge = Math.max(it.maxAge, r.age_days || 0); it.subs[r.subinventory] = 1;
            t.rows.push(r);
        });
        t.itemList = Object.keys(t.items).map(function (k) { return t.items[k]; });
        t.basis = t.cost ? 'item cost' + (t.list ? ' + list price' : '') : t.list ? 'item list price' : 'GL balance (no cost source)';
        return t;
    };
    W.gl = function () {
        return FL.data().then(function (data) {
            var bs = FL.tpl('BS'); if (!bs) return {};
            var st = FINE.compute(bs, data, { period: FL.filter.period, scale: 1, columns: [{ id: 'b', scenario: 'ACTUAL', range: 'BAL' }] }), out = {};
            st.rows.forEach(function (r) { if (r.id === 'AR' || r.id === 'AP' || r.id === 'INV') out[r.id] = r.values[0]; });
            return out;
        }).catch(function () { return {}; });
    };

    FL.TABS.wc = {
        render: function (el) {
            return Promise.all([W.load(), W.gl(), FL.data().then(function (data) { try { return FINE.kpis(FL.config.kpis || [], FL.tplMap(), data, FL.filter.period); } catch (e) { return {}; } }).catch(function () { return {}; })]).then(function (r) {
                W.data = r[0]; W.glv = r[1]; W.kv = r[2]; W.paint(el);
            });
        }
    };

    var money = function (v) { return v == null ? '—' : FINE.fmt(v / (FL.filter.scale || 1), 'num', { decimals: FL.filter.scale >= 1000000 ? 1 : 0 }); };
    var sc = function (v) { return v == null ? null : Math.round(v / (FL.filter.scale || 1) * 10) / 10; };
    var pct = function (a, b) { return b ? Math.round(a / b * 1000) / 10 + ' %' : '—'; };
    var kv = function (id) { var k = (W.kv || {})[id]; return k && k.value != null ? Math.round(k.value) + ' d' : '—'; };

    W.paint = function (el) {
        el = el || $('main');
        var d = W.data, admin = FL.who && FL.who.admin;
        var head = '<div class="row" style="margin-bottom:10px"><h2 style="margin:0"><i class="fa-solid fa-scale-unbalanced"></i> Working capital</h2>' +
            '<span class="sm muted">debtors, creditors and stock from the Fusion subledgers · amounts in ' + FL.scaleLabel() + '</span><span class="grow"></span>' +
            '<a class="wc-chip" id="wc-mdlink" title="What is synced and what is missing"></a>' +
            (admin ? '<button class="btn sm" id="wc-set"><i class="fa-solid fa-sliders"></i> Settings</button><button class="btn sm primary" id="wc-sync"><i class="fa-solid fa-cloud-arrow-down"></i> Sync from Fusion</button>' : '') + '</div><div id="wc-prog"></div>';
        if (!d || d.empty) {
            el.innerHTML = head + '<div class="card" style="max-width:760px"><h3>No subledger snapshot yet</h3><p>Sync reads, read-only from Oracle Fusion: <b>debtors</b> (open receivables by customer and age), <b>creditors</b> (open payables by supplier and age, items on hold) and <b>stock on hand</b> (by organisation, item and subinventory, aged from the oldest receipt). Each sync is kept, so the trend builds up over time.</p>' +
                (admin ? '' : '<div class="callout warn">An AI admin syncs the subledgers.</div>') + '</div><div class="card" id="wc-md" style="margin-top:12px"></div>';
            W.wire(el); W.md(); return;
        }
        var ar = W.totals(d.AR), ap = W.totals(d.AP), inv = W.stock(d.INV), gl = W.glv || {};
        var bus = {}; d.AR.concat(d.AP).forEach(function (r) { bus[r.bu_id] = 1; });
        var orgs = {}; d.INV.forEach(function (r) { orgs[r.org_id] = r.org_code || r.org_id; });
        var trend = function (k) { return d.snaps.filter(function (s) { return s.kind === k; }); };
        var recon = function (sub, glVal, filtered) {
            if (glVal == null) return '<div class="sm muted">GL: no balance sheet line</div>';
            if (filtered) return '<div class="sm muted">GL control is for every business unit — clear the filter to compare</div>';
            var diff = sub - glVal;
            return '<div class="sm">GL control (' + esc(FL.periodName(FL.filter.period)) + '): <b>' + money(glVal) + '</b> · difference <b class="' + (Math.abs(diff) < Math.max(1, Math.abs(glVal) * 0.005) ? 'pos' : 'neg') + '">' + money(diff) + '</b></div>';
        };
        var card = function (k, total, lines, rc) {
            var s = d.last[k];
            return '<div class="card wc-card' + (W.sub === k ? ' on' : '') + '" data-sub="' + k + '"><div class="row"><i class="fa-solid ' + KIND[k][2] + '"></i><b>' + KIND[k][0] + '</b>' +
                (k === 'INV' ? (W.org ? '<span class="wc-chip">' + esc(W.orgName(W.org, orgs[W.org])) + '</span>' : '') : W.bu ? '<span class="wc-chip">' + esc(W.buName(W.bu)) + '</span>' : '') + '<span class="grow"></span>' +
                '<span class="sm muted" title="Snapshot time — ages are as of then">' + (s ? esc(String(s.at).slice(0, 16)) : 'not synced') + '</span></div>' +
                '<div class="wc-big">' + (total == null ? '—' : money(total)) + '</div>' + lines.map(function (l) { return '<div class="row sm"><span>' + l[0] + '</span><span class="grow"></span><b>' + l[1] + '</b></div>'; }).join('') +
                (rc || '') + '<div class="wc-spark"><canvas id="wcs-' + k + '"></canvas></div></div>';
        };
        var unnamed = Object.keys(bus).some(function (b) { return W.buName(b) === b; }) || Object.keys(orgs).some(function (o) { return !((d.names || {}).ORG || {})[o]; });
        var filt = '<div class="wc-filt"><label class="sm"><b>Business unit</b> <span class="muted">debtors &amp; creditors</span> <select id="wc-bu"><option value="">All business units</option>' +
            Object.keys(bus).sort(function (a, b) { var na = W.buName(a) !== a, nb = W.buName(b) !== b; return na !== nb ? (na ? -1 : 1) : String(W.buName(a)).localeCompare(String(W.buName(b))); }).map(function (b) { return '<option value="' + esc(b) + '"' + (W.bu === b ? ' selected' : '') + '>' + esc(W.buName(b) !== b ? W.buName(b) + '  (' + b + ')' : b) + '</option>'; }).join('') + '</select></label>' +
            '<label class="sm"><b>Inventory organisation</b> <select id="wc-org"><option value="">All organisations</option>' +
            Object.keys(orgs).sort(function (a, b) { return String(orgs[a]).localeCompare(String(orgs[b])); }).map(function (o) { return '<option value="' + esc(o) + '"' + (W.org === o ? ' selected' : '') + '>' + esc(W.orgName(o, orgs[o])) + '</option>'; }).join('') + '</select></label>' +
            (W.bu || W.org ? '<a class="sm" id="wc-fclear"><i class="fa-solid fa-xmark"></i> show all</a>' : '') + '<span class="grow"></span>' +
            (admin ? (unnamed ? '<button class="btn sm" id="wc-names" title="Read business unit and organisation names from Fusion (no re-sync needed)"><i class="fa-solid fa-tag"></i> Read names</button>' : '') +
                '<button class="btn sm ghost" id="wc-nameed" title="See or type the names yourself"><i class="fa-solid fa-pen"></i> Names</button>' : '') + '</div>';
        var cards = '<div class="grid g3 wc-cards">' +
            card('AR', d.last.AR ? ar.total : null, [['Overdue', money(ar.overdue) + ' · ' + pct(ar.overdue, ar.total)], ['Over 90 days', money(ar.old90)], ['Days sales outstanding (GL)', kv('dso')], ['Open items', ar.items.toLocaleString()]], d.last.AR ? recon(ar.total, gl.AR, !!W.bu) : '') +
            card('AP', d.last.AP ? ap.total : null, [['Overdue', money(ap.overdue) + ' · ' + pct(ap.overdue, ap.total)], ['Over 90 days', money(ap.old90)], ['Days payables outstanding (GL)', kv('dpo')], ['On hold', ap.hold.toLocaleString() + ' item(s)']], d.last.AP ? recon(ap.total, gl.AP, !!W.bu) : '') +
            card('INV', d.last.INV ? (inv.valued ? inv.value : W.org ? null : gl.INV) : null, [['Basis', inv.valued ? inv.basis + ' (' + inv.valued.toLocaleString() + ' of ' + inv.lines.toLocaleString() + ' lines)' : '<span class="warn">' + inv.basis + '</span>'],
                ['Older than 180 days', inv.valued ? money((inv.age['181-365 days'] || 0) + (inv.age['over a year'] || 0)) : Math.round((inv.ageQty['181-365 days'] || 0) + (inv.ageQty['over a year'] || 0)).toLocaleString() + ' units'],
                ['Days inventory outstanding (GL)', kv('dio')], ['Items on hand', inv.itemList.length.toLocaleString() + ' in ' + Object.keys(inv.orgs).length + ' org(s)']], d.last.INV && inv.valued ? recon(inv.value, gl.INV, !!W.org) : '') +
            '</div><div class="callout sm" style="margin:8px 0">Cash conversion cycle (GL): <b>' + kv('ccc') + '</b> = days customers take + days stock sits − days we take to pay suppliers. Subledger ages are as of each snapshot; the GL control balances are at the end of ' + esc(FL.periodName(FL.filter.period)) + ' — differences can be timing.</div>';
        var tabs = '<div class="row" style="margin:6px 0"><div class="seg" id="wc-sub">' + ['AR', 'AP', 'INV'].map(function (k) { return '<button data-k="' + k + '" class="' + (W.sub === k ? 'on' : '') + '">' + KIND[k][0] + '</button>'; }).join('') + '</div>' +
            '<span class="grow"></span><button class="btn sm" id="wc-xl"><i class="fa-solid fa-file-excel"></i> Excel</button></div>';
        el.innerHTML = head + filt + cards + tabs + '<div id="wc-body"></div><div class="card" id="wc-md" style="margin-top:12px"></div>';
        W.wire(el);
        W.body();
        W.md();
        ['AR', 'AP', 'INV'].forEach(function (k) {
            var t = trend(k); if (t.length < 2) return;
            FL.spark('wcs-' + k, t.map(function (s) { return s.total; }), k === 'AP' ? '#0d9488' : FL.PAL.act);
        });
    };

    W.body = function () {
        var box = $('wc-body'), d = W.data; if (!box || !d || d.empty) return;
        if (W.sub === 'INV') return W.invBody(box);
        var bk = W.buckets(), rows = d[W.sub], t = W.totals(rows), ps = W.parties(rows), cols = ['#16a34a', '#84cc16', '#facc15', '#f59e0b', '#ea580c', '#dc2626', '#991b1b'];
        box.innerHTML = '<div class="card"><h3>Ageing <small>by days past due, as of ' + esc(String((d.last[W.sub] || {}).at || '').slice(0, 16)) + (W.bu ? ' · ' + esc(W.buName(W.bu)) : '') + '</small></h3>' +
            '<div class="wc-agebar">' + bk.map(function (n, i) { var v = t.b[n] || 0, w = t.total ? Math.max(0, v / t.total * 100) : 0; return w > 0.3 ? '<span style="width:' + w + '%;background:' + cols[Math.min(i, cols.length - 1)] + '" title="' + esc(n + ': ' + money(v)) + '"></span>' : ''; }).join('') + '</div>' +
            '<div class="row sm" style="flex-wrap:wrap;gap:12px;margin-top:6px">' + bk.map(function (n, i) { return '<span><i class="dot" style="background:' + cols[Math.min(i, cols.length - 1)] + '"></i> ' + esc(n) + ' <b>' + money(t.b[n] || 0) + '</b> <span class="muted">' + pct(t.b[n] || 0, t.total) + '</span></span>'; }).join('') + '</div></div>' +
            '<div class="card"><h3>' + (W.sub === 'AR' ? 'Customers' : 'Suppliers') + ' <small>biggest first · filter any column in the boxes under the headers (text, &gt;10, =0, 1..5, !x) · click a row for the open items, live from Fusion</small></h3><div id="wc-grid"></div></div>';
        var g = [{ label: W.sub === 'AR' ? 'Customer' : 'Supplier', key: 'name' }, { label: 'Number', key: 'number' },
            { label: 'Business unit', get: function (r) { return Object.keys(r.bu).map(W.buName).join(', '); } },
            { label: 'Total', n: 1, get: function (r) { return money(r.total); }, val: function (r) { return sc(r.total); } }]
            .concat(bk.map(function (n) { return { label: n, n: 1, get: function (r) { return r.b[n] ? money(r.b[n]) : ''; }, val: function (r) { return sc(r.b[n] || 0); } }; }))
            .concat([{ label: 'Overdue %', n: 1, get: function (r) { return pct(r.total - (r.b.Current || 0), r.total); }, val: function (r) { return r.total ? Math.round((r.total - (r.b.Current || 0)) / r.total * 1000) / 10 : 0; } },
                { label: 'Oldest due', key: 'oldest' }, { label: 'Items', n: 1, key: 'items' }])
            .concat(W.sub === 'AP' ? [{ label: 'On hold', n: 1, get: function (r) { return r.hold || ''; }, val: function (r) { return r.hold; } }] : []);
        FL.grid($('wc-grid'), g, ps, { id: 'wc-' + W.sub, height: '60vh', csv: (W.sub === 'AR' ? 'debtors' : 'creditors') + '.csv', click: function (r) { W.detail(W.sub, r.number, r.name); } });
    };

    /** Inventory: stock age, group by organisation / subinventory / item type / any item flexfield column, items grid */
    W.invBody = function (box) {
        var d = W.data, t = W.stock(d.INV), byValue = t.valued > 0;
        var gopts = [['org', 'Organisation'], ['sub', 'Subinventory'], ['item_type', 'Item type'], ['item_status', 'Item status']]
            .concat(['attribute_category'].concat(W.dffCols().filter(function (c) { return c !== 'attribute_category'; })).map(function (c) { return [c, W.dffLabel(c)]; }));
        if (!W.grp || !gopts.some(function (g) { return g[0] === W.grp; })) W.grp = W.cfg().group && gopts.some(function (g) { return g[0] === W.cfg().group; }) ? W.cfg().group : 'org';
        var gLabel = (gopts.filter(function (g) { return g[0] === W.grp; })[0] || [0, 'Group'])[1];
        var gval = function (r) { return W.grp === 'org' ? W.orgName(r.org_id, r.org_code) : W.grp === 'sub' ? r.subinventory : r[W.grp]; };
        var groups = {};
        t.rows.forEach(function (r) {
            var k = gval(r); k = k == null || k === '' ? '(blank)' : String(k);
            var g = groups[k] = groups[k] || { g: k, lines: 0, items: {}, qty: 0, value: 0, old: 0 };
            g.lines++; g.items[r.item_number] = 1; g.qty += r.quantity; g.value += r._v || 0; if ((r.age_days || 0) > 180) g.old += byValue ? (r._v || 0) : r.quantity;
        });
        var glist = Object.keys(groups).map(function (k) { var g = groups[k]; g.nItems = Object.keys(g.items).length; return g; }).sort(function (a, b) { return byValue ? b.value - a.value : b.qty - a.qty; });
        var noMaster = !d.items || !d.items.n;
        box.innerHTML = (noMaster ? '<div class="callout warn sm">The item master is not synced — item type, list price and the item flexfield (e.g. the inventory category kept in a DFF) come from it. <b>Checklist below › Item master › Sync items</b>.</div>' : '') +
            (!byValue ? '<div class="callout warn sm">No inventory value: pick a cost table in Settings (<b>Find cost tables in Fusion</b>) and sync the stock, or sync the item master — its list price is used when there is no cost.</div>' : '') +
            '<div class="grid g2"><div class="card"><h3>Stock age <small>' + (byValue ? 'value' : 'quantity') + ' by days since the oldest receipt</small></h3><div class="chartbox short"><canvas id="wc-age"></canvas></div></div>' +
            '<div class="card"><div class="row"><h3 style="margin:0">Stock by</h3><select id="wc-grp">' + gopts.map(function (g) { return '<option value="' + g[0] + '"' + (W.grp === g[0] ? ' selected' : '') + '>' + esc(g[1]) + '</option>'; }).join('') + '</select>' +
            '<span class="grow"></span>' + (FL.who && FL.who.admin ? '<button class="btn sm ghost" id="wc-dff" title="What each item flexfield column holds — name the ones you use"><i class="fa-solid fa-tags"></i> Item DFF</button>' : '') + '</div><div class="chartbox short"><canvas id="wc-gch"></canvas></div></div></div>' +
            '<div class="card"><h3>' + esc(gLabel) + ' <small>click a row to filter the items below</small></h3><div id="wc-ggrid"></div></div>' +
            '<div class="card"><h3>Items <small>' + (byValue ? 'by value — basis: ' + t.basis : 'by quantity') + ' · filter any column · click for the on-hand lines</small></h3><div id="wc-igrid"></div></div>';
        var items = t.itemList.map(function (it) { var x = it.r, o = { grp: gval(x), item_type: x.item_type, item_status: x.item_status, subList: Object.keys(it.subs).join(', ') }; W.dffCols().forEach(function (c) { o[c] = x[c]; }); return Object.assign(it, o); })
            .sort(function (a, b) { return byValue ? b.value - a.value : b.qty - a.qty; });
        var icols = [{ label: 'Item', key: 'item' }, { label: 'Description', key: 'desc' }, { label: 'Organisation', key: 'org' }, { label: 'Subinventories', key: 'subList' }]
            .concat(W.grp !== 'org' && W.grp !== 'sub' ? [{ label: gLabel, get: function (r) { return r.grp == null ? '' : r.grp; } }] : [])
            .concat(W.grp !== 'item_type' ? [{ label: 'Item type', get: function (r) { return r.item_type || ''; } }] : [])
            .concat(W.dffCols().filter(function (c) { return c !== W.grp; }).slice(0, 6).map(function (c) { return { label: W.dffLabel(c), get: function (r) { return r[c] == null ? '' : r[c]; } }; }))
            .concat([{ label: 'Quantity', n: 1, get: function (r) { return (Math.round(r.qty * 100) / 100).toLocaleString() + ' ' + (r.uom || ''); }, val: function (r) { return r.qty; } },
                { label: 'Value', n: 1, get: function (r) { return r.valued ? money(r.value) : '—'; }, val: function (r) { return r.valued ? sc(r.value) : null; } },
                { label: 'Basis', get: function (r) { return r.basis === 'list' ? 'list price' : r.basis || ''; } },
                { label: 'Oldest (days)', n: 1, html: true, get: function (r) { return '<span class="' + (r.maxAge > 180 ? 'neg' : '') + '">' + r.maxAge + '</span>'; }, val: function (r) { return r.maxAge; } }]);
        var iopts = { id: 'wc-items', height: '60vh', csv: 'stock-items.csv', click: function (r) { W.detail('INV', r.item, r.item + ' ' + (r.desc || '')); } };
        var gfilter = {}; gfilter[gLabel] = '';
        FL.grid($('wc-ggrid'), [{ label: gLabel, key: 'g' }, { label: 'Items', n: 1, key: 'nItems' }, { label: 'Lines', n: 1, key: 'lines' },
            { label: 'Quantity', n: 1, get: function (r) { return Math.round(r.qty).toLocaleString(); }, val: function (r) { return Math.round(r.qty); } },
            { label: 'Value', n: 1, get: function (r) { return byValue ? money(r.value) : '—'; }, val: function (r) { return sc(r.value); } },
            { label: '% of value', n: 1, get: function (r) { return byValue ? pct(r.value, t.value) : '—'; }, val: function (r) { return t.value ? Math.round(r.value / t.value * 1000) / 10 : 0; } },
            { label: byValue ? 'Value > 180 days' : 'Qty > 180 days', n: 1, get: function (r) { return byValue ? money(r.old) : Math.round(r.old).toLocaleString(); }, val: function (r) { return byValue ? sc(r.old) : Math.round(r.old); } }],
            glist, { id: 'wc-g-' + W.grp, height: '40vh', csv: 'stock-by-' + W.grp + '.csv', click: function (r) {
                var f = {}, col = W.grp === 'org' ? 'Organisation' : W.grp === 'sub' ? 'Subinventories' : gLabel;
                f[col] = r.g === '(blank)' ? '' : (W.grp === 'sub' ? r.g : '=' + r.g);
                FL.grid($('wc-igrid'), icols, items, Object.assign({}, iopts, { filters: f }));
                $('wc-igrid').scrollIntoView({ behavior: 'smooth', block: 'start' });
            } });
        FL.grid($('wc-igrid'), icols, items, iopts);
        $('wc-grp').onchange = function () { W.grp = this.value; FL.lsSet('wc.grp', W.grp); if (DFF_COLS.indexOf(W.grp) >= 0 && W.dffCols().indexOf(W.grp) < 0) FL.render(); else W.invBody(box); };
        if ($('wc-dff')) $('wc-dff').onclick = W.dffProfile;
        FL.chart('wc-age', { type: 'bar', data: { labels: AGE.map(function (a) { return a[1]; }), datasets: [{ label: byValue ? 'Value' : 'Quantity', data: AGE.map(function (a) { return byValue ? t.age[a[1]] || 0 : t.ageQty[a[1]] || 0; }), backgroundColor: ['#16a34a', '#84cc16', '#f59e0b', '#dc2626'], borderRadius: 3 }] },
            options: { plugins: { legend: { display: false } }, scales: { y: byValue ? FL.moneyAxis() : {} } } });
        var top = glist.slice(0, 12);
        FL.chart('wc-gch', { type: 'bar', data: { labels: top.map(function (g) { return String(g.g).slice(0, 24); }), datasets: [{ label: byValue ? 'Value' : 'Quantity', data: top.map(function (g) { return byValue ? g.value : g.qty; }), backgroundColor: FL.PAL.act, borderRadius: 3 }] },
            options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: byValue ? FL.moneyAxis() : {} } } });
    };

    W.detail = function (kind, party, title) {
        FL.modal('<i class="fa-solid ' + KIND[kind][2] + '"></i> ' + esc(title), '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading Fusion…</div>');
        FL.call('finWcDetail', { kind: kind, party: party, bu: kind === 'INV' ? W.org : W.bu, pod: W.cfg().pod }, 6 * 60000).then(function (r) {
            if (!r.ok) throw r.error;
            var cols = r.columns, rows = r.rows;
            $('m-body').innerHTML = '<p class="sm muted">' + rows.length + ' line(s)' + (r.capped ? ' (first 500)' : '') + ' · live from Fusion in ' + r.ms + ' ms · filter any column</p><div id="wd-grid"></div>';
            FL.grid($('wd-grid'), cols.map(function (c, i) {
                var n = /AMOUNT|REMAINING|ORIGINAL|QUANTITY|DAYS|AGE/.test(c);
                return { label: c, n: n, get: function (x) { var v = x[i]; return n && v != null && v !== '' && !isNaN(+v) ? FINE.fmt(+v, 'num', { decimals: /DAYS|AGE/.test(c) ? 0 : 2 }) : v == null ? '' : v; }, val: function (x) { return n && x[i] != null && x[i] !== '' ? +x[i] : x[i]; } };
            }), rows, { id: 'wd-' + kind, height: '58vh', csv: kind + '-' + party + '.csv' });
        }).catch(function (e) { $('m-body').innerHTML = '<div class="callout bad">' + esc(String(e && e.message || e)) + '</div>'; });
    };

    W.wire = function (el) {
        var q = function (s) { return el.querySelector(s); };
        el.querySelectorAll('.wc-card[data-sub]').forEach(function (c) { c.onclick = function () { W.sub = c.dataset.sub; FL.lsSet('wc.sub', W.sub); W.paint(el); }; });
        el.querySelectorAll('#wc-sub button').forEach(function (b) { b.onclick = function () { W.sub = b.dataset.k; FL.lsSet('wc.sub', W.sub); W.paint(el); }; });
        if (q('#wc-bu')) q('#wc-bu').onchange = function () { W.bu = this.value; FL.lsSet('wc.bu', W.bu); if (W.sub === 'INV') { W.sub = 'AR'; FL.lsSet('wc.sub', 'AR'); } W.paint(el); };
        if (q('#wc-org')) q('#wc-org').onchange = function () { W.org = this.value; FL.lsSet('wc.org', W.org); W.sub = 'INV'; FL.lsSet('wc.sub', 'INV'); W.paint(el); };
        if (q('#wc-fclear')) q('#wc-fclear').onclick = function () { W.bu = W.org = ''; FL.lsSet('wc.bu', ''); FL.lsSet('wc.org', ''); W.paint(el); };
        if (q('#wc-names')) q('#wc-names').onclick = function () { W.readNames(); };
        if (q('#wc-nameed')) q('#wc-nameed').onclick = function () { W.nameEditor(); };
        if (q('#wc-xl')) q('#wc-xl').onclick = W.excel;
        if (q('#wc-sync')) q('#wc-sync').onclick = function () { W.sync(['AR', 'AP', 'INV']); };
        if (q('#wc-set')) q('#wc-set').onclick = W.settings;
        if (q('#wc-mdlink')) q('#wc-mdlink').onclick = function () { if ($('wc-md')) $('wc-md').scrollIntoView({ behavior: 'smooth' }); };
    };

    /** One host action with the live progress lines, then the page again */
    W.run = function (action, payload, label, ms) {
        var log = $('wc-prog'), lines = [];
        if (log) log.innerHTML = '<div class="callout sm" id="wc-log"><i class="fa-solid fa-circle-notch fa-spin"></i> ' + esc(label) + '…</div>';
        var bz = FL.busy.start(label);
        return FL.call(action, Object.assign({ pod: W.cfg().pod || '' }, payload), ms || 60 * 60000, function (m) {
            if (!m || m.charAt(0) === '\u0001') return; lines.push(m); FL.busy.line(bz, m); if ($('wc-log')) $('wc-log').innerHTML = lines.slice(-12).map(esc).join('<br>');
        }).then(function (r) {
            FL.busy.end(bz, r.failed && r.failed.length ? r.failed.length + ' organisation(s) failed — see the page' : null);
            var bad = r.failed || [];
            FL.toast(label + (r.items != null ? ': ' + r.items.toLocaleString() + ' items' + (bad.length ? ' · ' + bad.length + ' organisation(s) failed' : '') : r.labels ? ': ' + r.labels.length + ' labels' : r.named != null ? ': ' + r.named + ' names' : ' done'), bad.length ? 'err' : 'ok');
            return FL.render().then(function () {
                if (bad.length && $('wc-prog')) $('wc-prog').innerHTML = '<div class="callout warn sm"><b>' + bad.length + ' organisation(s) could not be read</b> — the others are saved; press the sync button again for the rest.' +
                    bad.map(function (b) { return '<div class="muted">' + esc(W.orgName(b.org) + ': ' + b.error) + '</div>'; }).join('') + '</div>';
                if (r.labels && !r.labels.length && $('wc-prog')) $('wc-prog').innerHTML = '<div class="callout warn sm">Fusion has no labels for the item flexfield (or the report user cannot see them) — open <b>Profile &amp; name</b> and name the columns that hold your categories.</div>';
            });
        }).catch(function (e) { var m = String(e && e.message || e); FL.busy.end(bz, m); if ($('wc-log')) $('wc-log').innerHTML = '<span class="neg">' + esc(m) + '</span>'; FL.toast(m, 'err'); });
    };

    /** Reads the missing names from Fusion; says which source answered, and opens the editor for what is still unnamed */
    W.readNames = function () {
        var log = $('wc-prog'); if (log) log.innerHTML = '<div class="callout sm" id="wc-log"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading business unit / organisation names from Fusion…</div>';
        return FL.call('finWcNames', { pod: W.cfg().pod || '' }, 5 * 60000).then(function (r) {
            var miss = r.missing || {}, nMiss = (miss.BU || []).length + (miss.ORG || []).length;
            return FL.render().then(function () {
                if (!r.named && !nMiss) { FL.toast('Every business unit and organisation already has a name', 'ok'); return; }
                if ($('wc-prog')) $('wc-prog').innerHTML = '<div class="callout ' + (nMiss ? 'warn' : '') + ' sm"><b>' + r.named + ' name(s) read from Fusion' + (nMiss ? ', ' + nMiss + ' still without a name' : '') + '.</b>' +
                    (r.log || []).map(function (l) { return '<div class="muted">' + esc(l) + '</div>'; }).join('') +
                    (nMiss ? '<div style="margin-top:4px">The report user cannot see them in Fusion — <a id="wc-typenames">type the names</a> once; they are kept on this PC.</div>' : '') + '</div>';
                if ($('wc-typenames')) $('wc-typenames').onclick = function () { W.nameEditor(); };
            });
        }).catch(function (e) { if ($('wc-log')) $('wc-log').innerHTML = '<span class="neg">' + esc(String(e && e.message || e)) + '</span>'; });
    };
    /** Names of the business units / organisations in the snapshots — see them, type or fix them */
    W.nameEditor = function () {
        var d = W.data || {}, names = d.names || { BU: {}, ORG: {} }, bus = {}, orgs = {};
        (d.AR || []).concat(d.AP || []).forEach(function (r) { bus[r.bu_id] = (bus[r.bu_id] || 0) + Math.abs(r.amount || 0); });
        (d.INV || []).forEach(function (r) { orgs[r.org_id] = r.org_code || ''; });
        var rows = function (kind, ids, extra) {
            return ids.map(function (id) { return '<tr><td class="mono">' + esc(id) + '</td><td class="muted sm">' + esc(extra(id)) + '</td><td><input class="ne-i" data-k="' + kind + '" data-id="' + esc(id) + '" value="' + esc((names[kind] || {})[id] || '') + '" placeholder="name" style="width:260px"></td></tr>'; }).join('');
        };
        var buIds = Object.keys(bus).sort(function (a, b) { return bus[b] - bus[a]; }), orgIds = Object.keys(orgs).sort();
        FL.modal('<i class="fa-solid fa-tag"></i> Business unit & organisation names', '<p class="sm">Names come from Fusion (<b>Read names</b>); when the report user cannot see a business unit there, type its name here — it is kept on this PC with the others. No re-sync needed.</p>' +
            '<div class="scroll" style="max-height:62vh"><table class="t"><thead><tr><th>Business unit id</th><th>open amount</th><th>Name</th></tr></thead><tbody>' + rows('BU', buIds, function (id) { return money(bus[id]); }) + '</tbody></table>' +
            (orgIds.length ? '<table class="t" style="margin-top:10px"><thead><tr><th>Inventory org id</th><th>code</th><th>Name</th></tr></thead><tbody>' + rows('ORG', orgIds, function (id) { return orgs[id]; }) + '</tbody></table>' : '') + '</div>',
            '<button class="btn" id="ne-read"><i class="fa-solid fa-cloud-arrow-down"></i> Read from Fusion</button><button class="btn primary" id="ne-save"><i class="fa-solid fa-floppy-disk"></i> Save</button>');
        $('ne-read').onclick = function () { FL.closeModal(); W.readNames(); };
        $('ne-save').onclick = function () {
            var by = { BU: {}, ORG: {} };
            document.querySelectorAll('.ne-i').forEach(function (i) { var v = i.value.trim(); if (v && v !== (names[i.dataset.k] || {})[i.dataset.id]) by[i.dataset.k][i.dataset.id] = v; });
            var jobs = ['BU', 'ORG'].filter(function (k) { return Object.keys(by[k]).length; }).map(function (k) { return FL.call('finWcNamesSave', { pod: W.cfg().pod || '', kind: k, names: by[k] }); });
            if (!jobs.length) { FL.closeModal(); return; }
            Promise.all(jobs).then(function () { FL.closeModal(); FL.toast('Names saved', 'ok'); FL.render(); }).catch(function (e) { FL.toast(String(e && e.message || e), 'err'); });
        };
    };

    /** Finds the cost tables on the pod, takes the most likely one (perpetual average first, mapped to the inventory orgs), saves it and syncs the stock */
    W.autoCost = function () {
        var log = $('wc-prog'); if (log) log.innerHTML = '<div class="callout sm" id="wc-log"><i class="fa-solid fa-circle-notch fa-spin"></i> Looking for the item cost tables on the pod…</div>';
        return FL.call('finWcCostTables', { pod: W.cfg().pod || '' }, 6 * 60000).then(function (r) {
            var maps = r.maps || [], t = (r.tables || []).filter(function (x) { return x.invOrg || (x.orgCol === 'COST_ORG_ID' && maps.length) || !x.orgCol; })[0] || (r.tables || [])[0];
            if (!t) { if ($('wc-log')) $('wc-log').innerHTML = '<span class="neg">No cost table with an item id and a cost column was found — the value stays the list price / GL. Settings › Cost source shows what the pod has.</span>'; return; }
            var m = !t.invOrg && t.orgCol === 'COST_ORG_ID' && maps[0];
            var cost = { table: t.table, itemCol: t.itemCol, orgCol: t.invOrg ? t.orgCol : null, costCol: t.costCol, costOrgCol: m ? 'COST_ORG_ID' : null, mapTable: m ? m.table : null, mapInvCol: m ? m.invCol : null, mapCostCol: m ? m.costCol : null };
            FL.config.wc = Object.assign({}, FL.config.wc || {}, { cost: cost });
            FL.toast('Using ' + t.table + '.' + t.costCol + (m ? ' through ' + m.table : '') + ' — syncing the stock', 'info');
            return FL.saveConfig().then(function () { return W.sync(['INV']); });
        }).catch(function (e) { if ($('wc-log')) $('wc-log').innerHTML = '<span class="neg">' + esc(String(e && e.message || e)) + '</span>'; });
    };

    W.sync = function (kinds) {
        var c = W.cfg(), btn = $('wc-sync'); if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Syncing…'; }
        var log = $('wc-prog'); if (log) log.innerHTML = '<div class="callout sm" id="wc-log"></div>';
        var lines = [], bz = FL.busy.start('Working capital · ' + kinds.map(function (k) { return KIND[k][0]; }).join(', '));
        return FL.call('finWcSync', { options: { pod: c.pod || '', kinds: kinds, buckets: c.buckets, orgs: c.orgs, cost: c.cost, arQuery: c.arQuery || null, apQuery: c.apQuery || null, invQuery: c.invQuery || null } }, 31 * 60000, function (m) {
            if (!m || m.charAt(0) === '\u0001') return; lines.push(m); FL.busy.line(bz, m); if ($('wc-log')) $('wc-log').innerHTML = lines.map(esc).join('<br>');
        }).then(function (r) {
            var bad = (r.results || []).filter(function (x) { return !x.ok; });
            FL.busy.end(bz, bad.length ? bad.map(function (x) { return x.kind + ': ' + x.error; }).join(' · ') : null);
            FL.toast(bad.length ? bad.map(function (x) { return x.kind + ': ' + x.error; }).join(' · ') : 'Subledgers synced', bad.length ? 'err' : 'ok');
            return FL.render();
        }).catch(function (e) { FL.busy.end(bz, String(e && e.message || e)); FL.toast(String(e), 'err'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Sync from Fusion'; } });
    };

    // ── checklist: what working capital needs, with its status and a button ──
    W.md = function () {
        var box = $('wc-md'); if (!box) return;
        var d = W.data || {}, last = d.last || {}, admin = FL.who && FL.who.admin, c = W.cfg();
        var bus = {}, orgs = {}; (d.AR || []).concat(d.AP || []).forEach(function (r) { bus[r.bu_id] = 1; }); (d.INV || []).forEach(function (r) { orgs[r.org_id] = 1; });
        var nb = Object.keys(bus), no = Object.keys(orgs), names = d.names || { BU: {}, ORG: {} };
        var bNamed = nb.filter(function (b) { return (names.BU || {})[b]; }).length, oNamed = no.filter(function (o) { return (names.ORG || {})[o]; }).length;
        var inv = null; if (d.INV && d.INV.length) { var ko = W.org; W.org = ''; inv = W.stock(d.INV); W.org = ko; }
        var it = d.items || { n: 0 }, itemOrgs = d.itemOrgs || [], orgsIn = no.filter(function (o) { return itemOrgs.indexOf(o) >= 0; }).length;
        var orgsMiss = no.filter(function (o) { return itemOrgs.indexOf(o) < 0; });
        var cloud = '<i class="fa-solid fa-cloud-arrow-down"></i> ';
        var fusN = Object.keys(d.dff || {}).length, mineN = Object.keys(c.dffLabels || {}).length;
        var snap = function (k) { var s = last[k]; return s ? (s.rows || 0).toLocaleString() + ' rows · total ' + money(s.total) + ' · ' + String(s.at).slice(0, 16) + (s.capped ? ' · capped' : '') : 'not synced'; };
        var items = [
            { k: 'AR', label: 'Debtors — open receivables (AR_PAYMENT_SCHEDULES_ALL)', ok: !!last.AR, info: snap('AR'), act: '<button class="btn sm" data-w="sync" data-k="AR">Sync</button>' },
            { k: 'AP', label: 'Creditors — open payables (AP_PAYMENT_SCHEDULES_ALL)', ok: !!last.AP, info: snap('AP'), act: '<button class="btn sm" data-w="sync" data-k="AP">Sync</button>' },
            { k: 'INV', label: 'Stock on hand (INV_ONHAND_QUANTITIES_DETAIL)', ok: !!last.INV, info: snap('INV'), act: '<button class="btn sm" data-w="sync" data-k="INV">Sync</button>' },
            { k: 'names', label: 'Business unit & organisation names', ok: (nb.length + no.length) > 0 && bNamed === nb.length && oNamed === no.length, part: bNamed + oNamed > 0,
                info: nb.length + no.length ? bNamed + ' of ' + nb.length + ' business units · ' + oNamed + ' of ' + no.length + ' inventory organisations named' : 'sync the subledgers first', act: '<button class="btn sm" data-w="names">Read names</button>' },
            { k: 'items', label: 'Item master (EGP_SYSTEM_ITEMS_B) — item type, list price, item flexfield', ok: it.n > 0 && no.length > 0 && orgsIn === no.length, part: it.n > 0,
                info: it.n ? it.n.toLocaleString() + ' items · ' + orgsIn + ' of ' + no.length + ' stock organisations · ' + (it.priced || 0).toLocaleString() + ' with a list price · read ' + String(it.at || '').slice(0, 16) : 'not synced — needed to group the stock by item type or a DFF (e.g. the inventory category)',
                act: (orgsMiss.length ? '<button class="btn sm primary" data-w="itemsmiss" title="' + esc(orgsMiss.map(function (o) { return W.orgName(o); }).join(', ')) + '">' + cloud + (it.n ? 'Sync ' + orgsMiss.length + ' missing organisation(s)' : 'Sync items') + '</button>' : '') +
                    (it.n ? '<button class="btn sm" data-w="items" title="Read every stock organisation again">Sync all again</button>' : '') },
            { k: 'dff', label: 'Item DFF — flexfield labels and your names', ok: fusN + mineN > 0, part: false,
                info: fusN + mineN ? fusN + ' label(s) from Fusion · ' + mineN + ' named by you — the stock can be grouped and filtered by them' : 'no labels yet — read them from Fusion (FND_DF_SEGMENTS_VL), or open the profile and name the columns that hold your categories',
                act: '<button class="btn sm' + (fusN ? '' : ' primary') + '" data-w="dff">' + cloud + (fusN ? 'Sync labels again' : 'Sync labels from Fusion') + '</button><button class="btn sm" data-w="profile"' + (it.n ? '' : ' disabled title="Sync the item master first"') + '>Profile &amp; name</button>' },
            { k: 'val', label: 'Inventory valuation', ok: !!inv && inv.valued >= inv.lines * 0.9, part: !!inv && inv.valued > 0,
                info: !inv ? 'sync the stock first' : inv.valued ? inv.valued.toLocaleString() + ' of ' + inv.lines.toLocaleString() + ' lines valued — ' + inv.basis + (c.cost ? ' (' + c.cost.table + '.' + c.cost.costCol + ')' : '') : 'no value — pick a cost table (Settings › Find cost tables) and sync the stock, or sync the item master for list prices',
                act: (inv && inv.valued < inv.lines * 0.9 ? (c.cost ? '<button class="btn sm primary" data-w="sync" data-k="INV" title="Read the stock again with the cost table ' + esc(c.cost.table) + '">' + cloud + 'Sync stock with costs</button>'
                        : '<button class="btn sm primary" data-w="autocost" title="Finds the cost tables on the pod, uses the most likely one and syncs the stock with its costs">' + cloud + 'Find cost table & sync</button>') : '') +
                    '<button class="btn sm" data-w="settings">Cost source</button>' }
        ];
        var nOk = items.filter(function (x) { return x.ok; }).length, miss = items.filter(function (x) { return !x.ok && /^(AR|AP|INV|names|items|dff|val)$/.test(x.k); });
        if ($('wc-mdlink')) $('wc-mdlink').innerHTML = '<i class="fa-solid fa-list-check"></i> checklist ' + nOk + ' of ' + items.length;
        box.innerHTML = '<div class="row"><h3 style="margin:0"><i class="fa-solid fa-list-check"></i> Working capital checklist</h3><span class="sm ' + (nOk === items.length ? 'pos' : 'warn') + '">' + nOk + ' of ' + items.length + ' ready</span><span class="grow"></span>' +
            (admin && miss.length ? '<button class="btn sm primary" data-w="all"><i class="fa-solid fa-cloud-arrow-down"></i> Sync all missing (' + miss.length + ')</button>' : '') + '</div>' +
            '<table class="t md-list"><tbody>' + items.map(function (x) {
                return '<tr class="' + (x.ok ? 'ok' : x.part ? 'part' : 'miss') + '"><td class="md-st">' + (x.ok ? '✓' : x.part ? '◐' : '✗') + '</td><td><b>' + esc(x.label) + '</b><div class="sm muted">' + esc(x.info) + '</div></td><td class="md-act">' + (admin ? x.act : '') + '</td></tr>';
            }).join('') + '</tbody></table>';
        box.querySelectorAll('[data-w]').forEach(function (b) {
            b.onclick = function () {
                var a = b.dataset.w;
                if (a === 'sync') return W.sync([b.dataset.k]);
                if (a === 'names') return W.readNames();
                if (a === 'items') return W.run('finWcItems', { options: { orgs: [] } }, 'Item master');
                if (a === 'itemsmiss') return W.run('finWcItems', { options: { orgs: orgsMiss } }, 'Item master · ' + orgsMiss.length + ' organisation(s)');
                if (a === 'autocost') return W.autoCost();
                if (a === 'dff') return W.run('finWcItemDff', {}, 'Item DFF labels', 5 * 60000);
                if (a === 'profile') return W.dffProfile();
                if (a === 'settings') return W.settings();
                if (a === 'all') {
                    var kinds = miss.filter(function (x) { return /^(AR|AP|INV)$/.test(x.k); }).map(function (x) { return x.k; });
                    var has = function (k) { return miss.some(function (x) { return x.k === k; }); };
                    (kinds.length ? W.sync(kinds) : Promise.resolve())
                        .then(function () { if (has('names')) return W.run('finWcNames', {}, 'Business unit / organisation names', 5 * 60000); })
                        .then(function () { if (has('items')) return W.run('finWcItems', { options: { orgs: it.n ? orgsMiss : [] } }, 'Item master'); })
                        .then(function () { if (has('dff')) return W.run('finWcItemDff', {}, 'Item DFF labels', 5 * 60000); })
                        .then(function () { if (has('val') && !c.cost) return W.autoCost(); });
                }
            };
        });
    };

    /** Item DFF profile: every flexfield column of the synced items — filled, distinct values, the most used values, Fusion's label, your name */
    W.dffProfile = function () {
        var p = pod();
        var sql = DFF_COLS.map(function (c) {
            return "SELECT '" + c.toUpperCase() + "' AS col, COUNT(" + c + ") AS filled, COUNT(DISTINCT " + c + ") AS vals, (SELECT string_agg(v, ' · ') FROM (SELECT CAST(" + c + " AS VARCHAR) || ' (' || COUNT(*) || ')' AS v FROM fin_items WHERE pod = " + p + " AND " + c + " IS NOT NULL GROUP BY " + c + " ORDER BY COUNT(*) DESC LIMIT 6)) AS top, (SELECT COUNT(*) FROM fin_items WHERE pod = " + p + ") AS total FROM fin_items WHERE pod = " + p;
        }).join(' UNION ALL ');
        FL.modal('<i class="fa-solid fa-tags"></i> Item flexfield (DFF) — what each column holds', '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div>');
        FL.rows(sql, 100).then(function (rows) {
            var c = W.cfg(), mine = c.dffLabels || {}, fus = (W.data || {}).dff || {};
            var used = rows.filter(function (r) { return r.filled > 0; });
            $('m-body').innerHTML = '<p class="sm">' + used.length + ' of ' + rows.length + ' flexfield columns hold values on ' + ((rows[0] || {}).total || 0).toLocaleString() + ' synced items. Name the ones you use (e.g. <i>Inventory category</i>) — the stock can then be grouped and filtered by them. Fusion\'s own labels come from <b>Read labels</b>.</p>' +
                '<label class="sm"><input type="checkbox" id="dp-all"> show empty columns too</label>' +
                '<div class="scroll" style="max-height:60vh"><table class="t"><thead><tr><th>Column</th><th>Fusion label</th><th>Your name</th><th class="n">Filled</th><th class="n">Values</th><th>Most used</th><th>Group stock by</th></tr></thead><tbody>' +
                rows.map(function (r) {
                    return '<tr class="dp-r' + (r.filled ? '' : ' dp-empty') + '"' + (r.filled ? '' : ' style="display:none"') + '><td class="mono">' + esc(r.col) + '</td><td>' + esc(fus[r.col] || '') + '</td>' +
                        '<td><input class="dp-l" data-c="' + esc(r.col) + '" value="' + esc(mine[r.col] || '') + '" placeholder="' + esc(fus[r.col] || 'name it') + '" style="width:170px"></td>' +
                        '<td class="n">' + pct(r.filled, r.total) + '</td><td class="n">' + (r.vals || 0).toLocaleString() + '</td><td class="sm">' + esc(r.top || '') + '</td>' +
                        '<td><input type="radio" name="dp-g" value="' + esc(r.col.toLowerCase()) + '"' + (c.group === r.col.toLowerCase() ? ' checked' : '') + '></td></tr>';
                }).join('') + '</tbody></table></div>';
            $('m-acts').innerHTML = '<button class="btn primary" id="dp-save"><i class="fa-solid fa-floppy-disk"></i> Save</button>';
            $('dp-all').onchange = function () { var on = this.checked; document.querySelectorAll('.dp-empty').forEach(function (tr) { tr.style.display = on ? '' : 'none'; }); };
            $('dp-save').onclick = function () {
                var labels = {}; document.querySelectorAll('.dp-l').forEach(function (i) { if (i.value.trim()) labels[i.dataset.c] = i.value.trim(); });
                var g = document.querySelector('input[name=dp-g]:checked');
                FL.config.wc = Object.assign({}, FL.config.wc || {}, { dffLabels: labels });
                if (g) { FL.config.wc.group = g.value; W.grp = g.value; FL.lsSet('wc.grp', g.value); }
                FL.saveConfig().then(function () { FL.closeModal(); FL.toast('Item flexfield names saved', 'ok'); W.sub = 'INV'; FL.lsSet('wc.sub', 'INV'); FL.render(); });
            };
        }).catch(function (e) { $('m-body').innerHTML = '<div class="callout bad">' + esc(String(e && e.message || e)) + ' — sync the item master first.</div>'; });
    };

    W.settings = function () {
        var c = W.cfg();
        var costText = function (k) { return k ? k.table + '.' + k.costCol + ' by ' + k.itemCol + (k.orgCol ? ' + ' + k.orgCol : k.mapTable ? ' + ' + k.costOrgCol + ' through ' + k.mapTable + ' (' + k.mapInvCol + ' → ' + k.mapCostCol + ')' : '') : 'none — list price from the item master, else the value comes from the GL'; };
        FL.call('finWcDefaults').then(function (def) {
            FL.modal('<i class="fa-solid fa-sliders"></i> Working capital — settings', '<div class="grid g2">' +
                '<label class="field">Pod<select id="ws-pod"><option value="">the logged-in pod</option><option' + (c.pod === 'PROD' ? ' selected' : '') + '>PROD</option><option' + (c.pod === 'TEST' ? ' selected' : '') + '>TEST</option></select></label>' +
                '<label class="field">Ageing buckets (days)<input id="ws-b" value="' + esc((c.buckets || []).join(', ')) + '" placeholder="30, 60, 90, 180"></label>' +
                '<label class="field">Only these business units / inventory orgs (ids, comma separated; empty = all)<input id="ws-o" value="' + esc((c.orgs || []).join(', ')) + '"></label>' +
                '<div class="field"><b>Inventory unit cost</b><div class="sm" id="ws-cost">' + esc(costText(c.cost)) + '</div>' +
                '<button class="btn sm" id="ws-find"><i class="fa-solid fa-magnifying-glass"></i> Find cost tables in Fusion</button> <button class="btn sm" id="ws-nocost">No cost table</button>' +
                '<label class="sm" style="display:block;margin-top:4px"><input type="checkbox" id="ws-lp"' + (c.listPrice !== false ? ' checked' : '') + '> value at the item list price when there is no cost (item master)</label><div id="ws-costs"></div></div></div>' +
                '<details style="margin-top:8px"><summary><b>Queries</b> (advanced — placeholders {BUCKET:due date}, {AS_OF}, {ORG_FILTER:column}, {UNIT_COST}; the column names must stay)</summary>' +
                [['ar', 'Debtors', c.arQuery || def.ar], ['ap', 'Creditors', c.apQuery || def.ap], ['inv', 'Stock on hand', c.invQuery || def.inv]].map(function (x) {
                    return '<label class="field">' + x[1] + ' <a class="sm" data-def="' + x[0] + '">default</a><textarea id="ws-q-' + x[0] + '" class="mono" rows="7" style="width:100%">' + esc(x[2]) + '</textarea></label>';
                }).join('') + '</details>',
                '<button class="btn primary" id="ws-save"><i class="fa-solid fa-floppy-disk"></i> Save</button>');
            var cost = c.cost;
            document.querySelectorAll('[data-def]').forEach(function (a) { a.onclick = function () { $('ws-q-' + a.dataset.def).value = def[a.dataset.def]; }; });
            $('ws-nocost').onclick = function () { cost = null; $('ws-cost').textContent = costText(null); };
            $('ws-find').onclick = function () {
                $('ws-costs').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> reading ALL_TAB_COLUMNS…';
                FL.call('finWcCostTables', { pod: $('ws-pod').value }, 6 * 60000).then(function (r) {
                    if (!r.ok) throw r.error;
                    var maps = r.maps || [];
                    $('ws-costs').innerHTML = (r.tables.length ? '<table class="t sm"><tbody>' + r.tables.map(function (t, i) {
                        var how = t.invOrg ? 'by inventory organisation' : t.orgCol === 'COST_ORG_ID' && maps.length ? 'by cost organisation, mapped through ' + maps[0].table : t.orgCol ? 'org column ' + t.orgCol + ' is not the inventory org — every org gets the highest cost' : 'no org column — one cost per item';
                        return '<tr><td><b>' + esc(t.table) + '</b><div class="muted">' + esc(t.costCol + ' by ' + t.itemCol + ' · ' + how) + '</div></td><td><button class="btn sm" data-ct="' + i + '">Use</button></td></tr>'; }).join('') + '</tbody></table>' : 'No CST table with an item id and a cost column.') +
                        (maps.length ? '<p class="sm muted">Inventory org → cost org: ' + maps.map(function (m) { return esc(m.table + ' (' + m.invCol + ' → ' + m.costCol + ')'); }).join(', ') + '</p>' : '');
                    $('ws-costs').querySelectorAll('[data-ct]').forEach(function (b) {
                        b.onclick = function () {
                            var t = r.tables[+b.dataset.ct], m = !t.invOrg && t.orgCol === 'COST_ORG_ID' && maps[0];
                            cost = { table: t.table, itemCol: t.itemCol, orgCol: t.invOrg ? t.orgCol : null, costCol: t.costCol, costOrgCol: m ? 'COST_ORG_ID' : null, mapTable: m ? m.table : null, mapInvCol: m ? m.invCol : null, mapCostCol: m ? m.costCol : null };
                            $('ws-cost').textContent = costText(cost);
                        };
                    });
                }).catch(function (e) { $('ws-costs').innerHTML = '<span class="neg">' + esc(String(e)) + '</span>'; });
            };
            $('ws-save').onclick = function () {
                var qv = function (k) { var v = $('ws-q-' + k).value.trim(); return v === def[k].trim() ? '' : v; };
                FL.config.wc = Object.assign({}, FL.config.wc || {}, { pod: $('ws-pod').value, buckets: $('ws-b').value.split(/[,; ]+/).map(Number).filter(function (x) { return x > 0; }), orgs: $('ws-o').value.split(/[,; ]+/).map(function (x) { return x.trim(); }).filter(Boolean),
                    cost: cost, listPrice: $('ws-lp').checked, arQuery: qv('ar'), apQuery: qv('ap'), invQuery: qv('inv') });
                FL.saveConfig().then(function () { FL.closeModal(); FL.toast('Saved — sync the stock to apply a new cost table', 'ok'); FL.render(); });
            };
        });
    };

    W.excel = function () {
        if (!window.ExcelJS || !W.data || W.data.empty) return;
        var wb = new ExcelJS.Workbook(), bk = W.buckets(), d = W.data;
        ['AR', 'AP'].forEach(function (k) {
            if (!d.last[k]) return;
            var ws = wb.addWorksheet(KIND[k][0]);
            ws.addRow([k === 'AR' ? 'Customer' : 'Supplier', 'Number', 'Business unit', 'Total'].concat(bk).concat(['Oldest due', 'Items']).concat(k === 'AP' ? ['On hold'] : [])).font = { bold: true };
            W.parties(d[k]).forEach(function (p) { ws.addRow([p.name, p.number, Object.keys(p.bu).map(W.buName).join(', '), p.total].concat(bk.map(function (n) { return p.b[n] || 0; })).concat([p.oldest, p.items]).concat(k === 'AP' ? [p.hold] : [])); });
            ws.getColumn(1).width = 40; ws.getColumn(3).width = 28; for (var i = 4; i <= 4 + bk.length; i++) ws.getColumn(i).numFmt = '#,##0;(#,##0);"–"';
            ws.views = [{ state: 'frozen', ySplit: 1 }];
        });
        if (d.last.INV) {
            var dc = W.dffCols(), ws = wb.addWorksheet('Inventory');
            ws.addRow(['Org', 'Organisation', 'Item', 'Description', 'Subinventory', 'UOM', 'Item type'].concat(dc.map(W.dffLabel)).concat(['Quantity', 'Unit cost', 'List price', 'Value', 'Basis', 'Oldest receipt', 'Age (days)'])).font = { bold: true };
            d.INV.forEach(function (r) { if (W.org && r.org_id !== W.org) return; var v = W.val(r); ws.addRow([r.org_code || r.org_id, W.orgName(r.org_id), r.item_number, r.description, r.subinventory, r.uom, r.item_type].concat(dc.map(function (c) { return r[c]; })).concat([r.quantity, r.unit_cost, r.list_price, v.v, v.b, r.oldest_receipt, r.age_days])); });
            ws.getColumn(4).width = 40; ws.views = [{ state: 'frozen', ySplit: 1 }];
        }
        wb.xlsx.writeBuffer().then(function (buf) { FL.download('Working capital ' + String((d.snaps[d.snaps.length - 1] || {}).at || '').slice(0, 10) + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); });
    };

    /** For the CFO Copilot's context: totals, buckets, biggest parties, stock value and its basis, the item flexfield names */
    W.summary = function () {
        var keep = W.data;
        return W.load().then(function (d) {
            if (!d || d.empty) return null;
            W.data = d;
            var out = { asOf: {}, note: 'Subledger snapshots (ledger currency). Ages are as of the snapshot time. Tables: fin_wc_parties, fin_wc_stock, fin_items (item master + DFF), fin_item_dff, fin_wc_names.' };
            var kb = W.bu, ko = W.org; W.bu = ''; W.org = '';
            ['AR', 'AP'].forEach(function (k) {
                if (!d.last[k]) return; var t = W.totals(d[k]), ps = W.parties(d[k]).slice(0, 5);
                out[k === 'AR' ? 'debtors' : 'creditors'] = { total: Math.round(t.total), overdue: Math.round(t.overdue), buckets: t.b, top: ps.map(function (p) { return [p.name, Math.round(p.total), Math.round(p.total - (p.b.Current || 0))]; }) };
                out.asOf[k] = d.last[k].at;
            });
            if (d.last.INV) { var s = W.stock(d.INV); out.inventory = { lines: s.lines, quantity: Math.round(s.qty), value: s.valued ? Math.round(s.value) : null, valueBasis: s.basis, ageValue: s.age, ageQty: s.ageQty, itemFlexfield: W.dffCols().map(function (c) { return c + ' = ' + W.dffLabel(c); }) }; out.asOf.INV = d.last.INV.at; }
            W.bu = kb; W.org = ko;
            return out;
        }).catch(function () { return null; }).then(function (o) { W.data = keep; return o; });
    };
})();
