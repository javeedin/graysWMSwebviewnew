/* Finance Lens — Working capital: debtors, creditors and stock from the Oracle Fusion subledgers (host
   classes/FinanceWc.cs: finWcSync → DuckDB snapshots fin_wc_parties / fin_wc_stock / fin_wc_snapshots, finWcDetail =
   live open items of one party / item, finWcCostTables = candidate unit-cost tables). Ageing is as of the sync time; the
   GL control accounts (balance sheet lines AR, AP, INV) are shown beside the subledger totals with the difference. */
(function () {
    var W = FL.wc = { sub: FL.ls('wc.sub', 'AR'), q: '', bu: FL.ls('wc.bu', ''), data: null };
    var KIND = { AR: ['Debtors', 'customers', 'fa-hand-holding-dollar', 'AR'], AP: ['Creditors', 'suppliers', 'fa-file-invoice', 'AP'], INV: ['Inventory', 'items', 'fa-boxes-stacked', 'INV'] };
    var AGE = [[90, '0-90 days'], [180, '91-180 days'], [365, '181-365 days'], [1e9, 'over a year']];

    W.cfg = function () { return Object.assign({ pod: '', buckets: [30, 60, 90, 180], orgs: [], cost: null, arQuery: '', apQuery: '', invQuery: '' }, (FL.config && FL.config.wc) || {}); };
    var pod = function () { return FL.q(W.cfg().pod || ''); };

    /** Latest snapshot of every kind + the trend of totals; null when nothing was synced */
    W.load = function () {
        var p = pod();
        return FL.rows("SELECT kind, CAST(snapshot_at AS VARCHAR) AS at, rows, total, note, capped FROM fin_wc_snapshots WHERE pod = " + p + " ORDER BY snapshot_at", 2000).then(function (snaps) {
            if (!snaps.length) return null;
            var last = {}; snaps.forEach(function (s) { last[s.kind] = s; });
            var q = [];
            ['AR', 'AP'].forEach(function (k) { q.push(last[k] ? FL.rows("SELECT * FROM fin_wc_parties WHERE pod = " + p + " AND kind = '" + k + "' AND CAST(snapshot_at AS VARCHAR) = " + FL.q(last[k].at), 200000) : Promise.resolve([])); });
            q.push(last.INV ? FL.rows("SELECT * FROM fin_wc_stock WHERE pod = " + p + " AND CAST(snapshot_at AS VARCHAR) = " + FL.q(last.INV.at), 300000) : Promise.resolve([]));
            return Promise.all(q).then(function (r) { return { snaps: snaps, last: last, AR: r[0], AP: r[1], INV: r[2] }; });
        }).catch(function () { return null; });
    };
    /** Buckets in order (from the saved boundaries) */
    W.buckets = function () {
        var b = (W.cfg().buckets || [30, 60, 90, 180]).map(Number).filter(function (x) { return x > 0; }).sort(function (a, c) { return a - c; });
        var out = ['Current'], lo = 1; b.forEach(function (x) { out.push(lo + '-' + x); lo = x + 1; }); out.push('>' + (b[b.length - 1] || 0));
        return out;
    };
    /** Parties of a kind (filtered by BU / search) → [{number, name, total, by bucket, items, oldest, hold}] */
    W.parties = function (rows) {
        var by = {}, q = W.q.toLowerCase();
        rows.forEach(function (r) {
            if (W.bu && r.bu_id !== W.bu) return;
            var k = r.party_number + '|' + r.party_name, p = by[k] = by[k] || { number: r.party_number, name: r.party_name, bu: {}, total: 0, b: {}, items: 0, oldest: null, hold: 0, ccy: {} };
            p.total += r.amount; p.b[r.bucket] = (p.b[r.bucket] || 0) + r.amount; p.items += r.items; p.hold += r.on_hold || 0; p.bu[r.bu_id] = 1; p.ccy[r.currency] = 1;
            if (r.oldest_due && (!p.oldest || r.oldest_due < p.oldest)) p.oldest = r.oldest_due;
        });
        return Object.keys(by).map(function (k) { return by[k]; }).filter(function (p) { return !q || (p.number + ' ' + p.name).toLowerCase().indexOf(q) >= 0; })
            .sort(function (a, b) { return Math.abs(b.total) - Math.abs(a.total); });
    };
    W.totals = function (rows) {
        var t = { total: 0, b: {}, items: 0, hold: 0 };
        rows.forEach(function (r) { if (W.bu && r.bu_id !== W.bu) return; t.total += r.amount; t.b[r.bucket] = (t.b[r.bucket] || 0) + r.amount; t.items += r.items; t.hold += r.on_hold || 0; });
        t.overdue = t.total - (t.b.Current || 0);
        var bk = W.buckets(); t.old90 = 0; bk.forEach(function (n) { var lo = +String(n).replace(/^>/, '').split('-')[0]; if (n !== 'Current' && (n.charAt(0) === '>' ? lo >= 90 : lo > 90)) t.old90 += t.b[n] || 0; });
        return t;
    };
    W.stock = function (rows) {
        var t = { qty: 0, value: 0, costed: 0, lines: 0, age: {}, ageQty: {}, orgs: {}, items: {} }, q = W.q.toLowerCase();
        rows.forEach(function (r) {
            if (W.bu && r.org_id !== W.bu) return;
            t.lines++; t.qty += r.quantity; if (r.value != null) { t.value += r.value; t.costed++; }
            var a = AGE.filter(function (x) { return (r.age_days == null ? 0 : r.age_days) <= x[0]; })[0][1];
            t.age[a] = (t.age[a] || 0) + (r.value || 0); t.ageQty[a] = (t.ageQty[a] || 0) + r.quantity;
            var o = t.orgs[r.org_id] = t.orgs[r.org_id] || { code: r.org_code || r.org_id, qty: 0, value: 0, lines: 0 }; o.qty += r.quantity; o.value += r.value || 0; o.lines++;
            if (q && (r.item_number + ' ' + (r.description || '')).toLowerCase().indexOf(q) < 0) return;
            var it = t.items[r.item_number] = t.items[r.item_number] || { item: r.item_number, desc: r.description, uom: r.uom, qty: 0, value: 0, maxAge: 0, orgs: {} };
            it.qty += r.quantity; it.value += r.value || 0; it.maxAge = Math.max(it.maxAge, r.age_days || 0); it.orgs[r.org_code || r.org_id] = 1;
        });
        t.itemList = Object.keys(t.items).map(function (k) { return t.items[k]; });
        return t;
    };
    /** GL balances of the control lines at the filter period (balance sheet template lines AR, AP, INV) */
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
            return Promise.all([W.load(), W.gl(), FL.data().then(function (data) { try { return FINE.kpis(FL.config.kpis || [], FL.tplMap(), data, FL.filter.period); } catch (e) { return {}; } })]).then(function (r) {
                W.data = r[0]; W.glv = r[1]; W.kv = r[2]; W.paint(el);
            });
        }
    };

    var money = function (v) { return v == null ? '—' : FINE.fmt(v / (FL.filter.scale || 1), 'num', { decimals: FL.filter.scale >= 1000000 ? 1 : 0 }); };
    var pct = function (a, b) { return b ? Math.round(a / b * 1000) / 10 + ' %' : '—'; };
    var kv = function (id) { var k = (W.kv || {})[id]; return k && k.value != null ? Math.round(k.value) + ' d' : '—'; };

    W.paint = function (el) {
        el = el || $('main');
        var d = W.data, admin = FL.who && FL.who.admin, cfg = W.cfg();
        var head = '<div class="row" style="margin-bottom:10px"><h2 style="margin:0"><i class="fa-solid fa-scale-unbalanced"></i> Working capital</h2>' +
            '<span class="sm muted">debtors, creditors and stock from the Fusion subledgers · amounts in ' + FL.scaleLabel() + '</span><span class="grow"></span>' +
            (admin ? '<button class="btn sm" id="wc-set"><i class="fa-solid fa-sliders"></i> Settings</button><button class="btn sm primary" id="wc-sync"><i class="fa-solid fa-cloud-arrow-down"></i> Sync from Fusion</button>' : '') + '</div><div id="wc-prog"></div>';
        if (!d) {
            el.innerHTML = head + '<div class="card" style="max-width:760px"><h3>No subledger snapshot yet</h3><p>Sync reads, read-only from Oracle Fusion: <b>debtors</b> (open receivables by customer and age), <b>creditors</b> (open payables by supplier and age, items on hold) and <b>stock on hand</b> (by organisation, item and subinventory, aged from the oldest receipt). Each sync is kept, so the trend builds up over time.</p>' +
                (admin ? '' : '<div class="callout warn">An AI admin syncs the subledgers.</div>') + '</div>';
            W.wire(el); return;
        }
        var ar = W.totals(d.AR), ap = W.totals(d.AP), inv = W.stock(d.INV), gl = W.glv || {};
        var bus = {}; d.AR.concat(d.AP).forEach(function (r) { bus[r.bu_id] = 1; });
        var orgs = {}; d.INV.forEach(function (r) { orgs[r.org_id] = r.org_code || r.org_id; });
        var trend = function (k) { return d.snaps.filter(function (s) { return s.kind === k; }); };
        var recon = function (sub, glVal, sign) {
            if (glVal == null) return '<div class="sm muted">GL: no balance sheet line</div>';
            var g = glVal * (sign || 1), diff = sub - g;
            return '<div class="sm">GL control (' + esc(FL.periodName(FL.filter.period)) + '): <b>' + money(g) + '</b> · difference <b class="' + (Math.abs(diff) < Math.max(1, Math.abs(g) * 0.005) ? 'pos' : 'neg') + '">' + money(diff) + '</b></div>';
        };
        var card = function (k, total, lines, extra, rc) {
            var s = d.last[k];
            return '<div class="card wc-card' + (W.sub === k ? ' on' : '') + '" data-sub="' + k + '"><div class="row"><i class="fa-solid ' + KIND[k][2] + '"></i><b>' + KIND[k][0] + '</b><span class="grow"></span>' +
                '<span class="sm muted" title="Snapshot time — ages are as of then">' + (s ? esc(String(s.at).slice(0, 16)) : 'not synced') + '</span></div>' +
                '<div class="wc-big">' + (total == null ? '—' : money(total)) + '</div>' + lines.map(function (l) { return '<div class="row sm"><span>' + l[0] + '</span><span class="grow"></span><b>' + l[1] + '</b></div>'; }).join('') +
                (extra || '') + (rc || '') + '<div class="wc-spark"><canvas id="wcs-' + k + '"></canvas></div></div>';
        };
        var cards = '<div class="grid g3 wc-cards">' +
            card('AR', d.last.AR ? ar.total : null, [['Overdue', money(ar.overdue) + ' · ' + pct(ar.overdue, ar.total)], ['Over 90 days', money(ar.old90)], ['Days sales outstanding (GL)', kv('dso')], ['Open items', ar.items.toLocaleString()]], '', d.last.AR ? recon(ar.total, gl.AR, 1) : '') +
            card('AP', d.last.AP ? ap.total : null, [['Overdue', money(ap.overdue) + ' · ' + pct(ap.overdue, ap.total)], ['Over 90 days', money(ap.old90)], ['Days payables outstanding (GL)', kv('dpo')], ['On hold', ap.hold.toLocaleString() + ' item(s)']], '', d.last.AP ? recon(ap.total, gl.AP, 1) : '') +
            card('INV', d.last.INV ? (inv.costed ? inv.value : gl.INV) : null, [['Basis', inv.costed ? 'item cost × quantity (' + inv.costed + ' of ' + inv.lines + ' lines costed)' : 'GL balance (no cost source)'], ['Older than 180 days', inv.costed ? money((inv.age['181-365 days'] || 0) + (inv.age['over a year'] || 0)) : Math.round((inv.ageQty['181-365 days'] || 0) + (inv.ageQty['over a year'] || 0)).toLocaleString() + ' units'],
                ['Days inventory outstanding (GL)', kv('dio')], ['Items on hand', inv.itemList.length.toLocaleString() + ' in ' + Object.keys(inv.orgs).length + ' org(s)']], '', d.last.INV && inv.costed ? recon(inv.value, gl.INV, 1) : '') +
            '</div><div class="callout sm" style="margin:8px 0">Cash conversion cycle (GL): <b>' + kv('ccc') + '</b> = days customers take + days stock sits − days we take to pay suppliers. Subledger ages are as of each snapshot; the GL control balances are at the end of ' + esc(FL.periodName(FL.filter.period)) + ' — differences can be timing.</div>';
        var filt = '<div class="row" style="margin:6px 0"><div class="seg" id="wc-sub">' + ['AR', 'AP', 'INV'].map(function (k) { return '<button data-k="' + k + '" class="' + (W.sub === k ? 'on' : '') + '">' + KIND[k][0] + '</button>'; }).join('') + '</div>' +
            '<label class="sm">' + (W.sub === 'INV' ? 'Organisation' : 'Business unit') + ' <select id="wc-bu"><option value="">All</option>' +
            (W.sub === 'INV' ? Object.keys(orgs).map(function (o) { return '<option value="' + esc(o) + '"' + (W.bu === o ? ' selected' : '') + '>' + esc(orgs[o]) + '</option>'; }) : Object.keys(bus).map(function (b) { return '<option' + (W.bu === b ? ' selected' : '') + '>' + esc(b) + '</option>'; })).join('') + '</select></label>' +
            '<input id="wc-q" placeholder="Search ' + KIND[W.sub][1] + '" value="' + esc(W.q) + '" style="min-width:220px"><span class="grow"></span><button class="btn sm" id="wc-xl"><i class="fa-solid fa-file-excel"></i> Excel</button></div>';
        el.innerHTML = head + cards + filt + '<div id="wc-body"></div>';
        W.wire(el);
        W.body();
        ['AR', 'AP', 'INV'].forEach(function (k) {
            var t = trend(k); if (t.length < 2) return;
            FL.spark('wcs-' + k, t.map(function (s) { return s.total; }), k === 'AP' ? '#0d9488' : FL.PAL.act);
        });
    };

    W.body = function () {
        var box = $('wc-body'), d = W.data; if (!box || !d) return;
        var bk = W.buckets();
        if (W.sub === 'INV') {
            var t = W.stock(d.INV), byValue = t.costed > 0, items = t.itemList.sort(function (a, b) { return byValue ? b.value - a.value : b.qty - a.qty; }).slice(0, 300);
            box.innerHTML = '<div class="grid g2"><div class="card"><h3>Stock age <small>' + (byValue ? 'value' : 'quantity') + ' by days since the oldest receipt</small></h3><div class="chartbox short"><canvas id="wc-age"></canvas></div></div>' +
                '<div class="card"><h3>By organisation</h3>' + FL.table([{ label: 'Org', key: 'code' }, { label: 'Lines', n: 1, get: function (r) { return r.lines.toLocaleString(); } }, { label: 'Quantity', n: 1, get: function (r) { return Math.round(r.qty).toLocaleString(); } }, { label: 'Value', n: 1, get: function (r) { return byValue ? money(r.value) : '—'; } }],
                    Object.keys(t.orgs).map(function (k) { return t.orgs[k]; }).sort(function (a, b) { return b.value - a.value || b.qty - a.qty; })) + '</div></div>' +
                '<div class="card"><h3>Items <small>' + (byValue ? 'by value' : 'by quantity — pick a cost source in Settings for values') + ' · click for the on-hand lines</small></h3><div class="scroll" style="max-height:55vh">' +
                FL.table([{ label: 'Item', key: 'item' }, { label: 'Description', key: 'desc' }, { label: 'Orgs', get: function (r) { return Object.keys(r.orgs).join(', '); } }, { label: 'Quantity', n: 1, get: function (r) { return (Math.round(r.qty * 100) / 100).toLocaleString() + ' ' + (r.uom || ''); } },
                    { label: 'Value', n: 1, get: function (r) { return byValue ? money(r.value) : '—'; } }, { label: 'Oldest (days)', n: 1, html: true, get: function (r) { return '<span class="' + (r.maxAge > 180 ? 'neg' : '') + '">' + r.maxAge + '</span>'; } }], items, { click: true }) + '</div></div>';
            FL.wireRows(box, items, function (r) { W.detail('INV', r.item, r.item + ' ' + (r.desc || '')); });
            FL.chart('wc-age', { type: 'bar', data: { labels: AGE.map(function (a) { return a[1]; }), datasets: [{ label: byValue ? 'Value' : 'Quantity', data: AGE.map(function (a) { return byValue ? t.age[a[1]] || 0 : t.ageQty[a[1]] || 0; }), backgroundColor: ['#16a34a', '#84cc16', '#f59e0b', '#dc2626'], borderRadius: 3 }] },
                options: { plugins: { legend: { display: false } }, scales: { y: byValue ? FL.moneyAxis() : {} } } });
            return;
        }
        var rows = d[W.sub], t = W.totals(rows), ps = W.parties(rows).slice(0, 300), cols = ['#16a34a', '#84cc16', '#facc15', '#f59e0b', '#ea580c', '#dc2626', '#991b1b'];
        box.innerHTML = '<div class="card"><h3>Ageing <small>by days past due, as of ' + esc(String((d.last[W.sub] || {}).at || '').slice(0, 16)) + '</small></h3>' +
            '<div class="wc-agebar">' + bk.map(function (n, i) { var v = t.b[n] || 0, w = t.total ? Math.max(0, v / t.total * 100) : 0; return w > 0.3 ? '<span style="width:' + w + '%;background:' + cols[Math.min(i, cols.length - 1)] + '" title="' + esc(n + ': ' + money(v)) + '"></span>' : ''; }).join('') + '</div>' +
            '<div class="row sm" style="flex-wrap:wrap;gap:12px;margin-top:6px">' + bk.map(function (n, i) { return '<span><i class="dot" style="background:' + cols[Math.min(i, cols.length - 1)] + '"></i> ' + esc(n) + ' <b>' + money(t.b[n] || 0) + '</b> <span class="muted">' + pct(t.b[n] || 0, t.total) + '</span></span>'; }).join('') + '</div></div>' +
            '<div class="card"><h3>' + (W.sub === 'AR' ? 'Customers' : 'Suppliers') + ' <small>' + ps.length + ' shown · biggest first · click for the open items (live from Fusion)</small></h3><div class="scroll" style="max-height:60vh">' +
            FL.table([{ label: W.sub === 'AR' ? 'Customer' : 'Supplier', get: function (r) { return r.name + (r.number && r.number !== '-' ? ' (' + r.number + ')' : ''); } }, { label: 'Total', n: 1, get: function (r) { return money(r.total); } }]
                .concat(bk.map(function (n) { return { label: n, n: 1, get: function (r) { return r.b[n] ? money(r.b[n]) : ''; } }; }))
                .concat([{ label: 'Overdue', n: 1, get: function (r) { return pct(r.total - (r.b.Current || 0), r.total); } }, { label: 'Oldest due', key: 'oldest' }, { label: 'Items', n: 1, key: 'items' }])
                .concat(W.sub === 'AP' ? [{ label: 'On hold', n: 1, get: function (r) { return r.hold || ''; } }] : []), ps, { click: true }) + '</div></div>';
        FL.wireRows(box, ps, function (r) { W.detail(W.sub, r.number, r.name); });
    };

    W.detail = function (kind, party, title) {
        FL.modal('<i class="fa-solid ' + KIND[kind][2] + '"></i> ' + esc(title), '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading Fusion…</div>');
        FL.call('finWcDetail', { kind: kind, party: party, bu: W.bu, pod: W.cfg().pod }, 6 * 60000).then(function (r) {
            if (!r.ok) throw r.error;
            var cols = r.columns, rows = r.rows;
            W.lastDetail = { cols: cols, rows: rows, title: title };
            $('m-body').innerHTML = '<p class="sm muted">' + rows.length + ' line(s)' + (r.capped ? ' (first 500)' : '') + ' · live from Fusion in ' + r.ms + ' ms</p><div class="scroll" style="max-height:62vh"><table class="t"><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                rows.map(function (x) { return '<tr>' + x.map(function (v, i) { var n = typeof v === 'number' || (/AMOUNT|REMAINING|ORIGINAL|QUANTITY|DAYS|AGE/.test(cols[i]) && v != null && v !== '' && !isNaN(+v)); return '<td class="' + (n ? 'n' : '') + '">' + esc(n ? FINE.fmt(+v, 'num', { decimals: /DAYS|AGE/.test(cols[i]) ? 0 : 2 }) : v == null ? '' : v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
            $('m-acts').innerHTML = '<button class="btn sm" id="wd-csv"><i class="fa-solid fa-file-csv"></i> CSV</button>';
            $('wd-csv').onclick = function () { FL.csv(kind + '-' + party + '.csv', cols, rows); };
        }).catch(function (e) { $('m-body').innerHTML = '<div class="callout bad">' + esc(String(e && e.message || e)) + '</div>'; });
    };

    W.wire = function (el) {
        var q = function (s) { return el.querySelector(s); };
        el.querySelectorAll('.wc-card[data-sub]').forEach(function (c) { c.onclick = function () { W.sub = c.dataset.sub; W.bu = ''; FL.lsSet('wc.sub', W.sub); W.paint(el); }; });
        el.querySelectorAll('#wc-sub button').forEach(function (b) { b.onclick = function () { W.sub = b.dataset.k; W.bu = ''; FL.lsSet('wc.sub', W.sub); W.paint(el); }; });
        if (q('#wc-bu')) q('#wc-bu').onchange = function () { W.bu = this.value; FL.lsSet('wc.bu', W.bu); W.paint(el); };
        if (q('#wc-q')) q('#wc-q').oninput = function () { W.q = this.value; clearTimeout(W.t); W.t = setTimeout(function () { W.body(); }, 250); };
        if (q('#wc-xl')) q('#wc-xl').onclick = W.excel;
        if (q('#wc-sync')) q('#wc-sync').onclick = function () { W.sync(['AR', 'AP', 'INV']); };
        if (q('#wc-set')) q('#wc-set').onclick = W.settings;
    };

    W.sync = function (kinds) {
        var c = W.cfg(), btn = $('wc-sync'); if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Syncing…'; }
        var log = $('wc-prog'); if (log) log.innerHTML = '<div class="callout sm" id="wc-log"></div>';
        var lines = [];
        FL.call('finWcSync', { options: { pod: c.pod || '', kinds: kinds, buckets: c.buckets, orgs: c.orgs, cost: c.cost, arQuery: c.arQuery || null, apQuery: c.apQuery || null, invQuery: c.invQuery || null } }, 31 * 60000, function (m) {
            if (!m || m.charAt(0) === '\u0001') return; lines.push(m); if ($('wc-log')) $('wc-log').innerHTML = lines.map(esc).join('<br>');
        }).then(function (r) {
            var bad = (r.results || []).filter(function (x) { return !x.ok; });
            FL.toast(bad.length ? bad.map(function (x) { return x.kind + ': ' + x.error; }).join(' · ') : 'Subledgers synced', bad.length ? 'err' : 'ok');
            FL.render();
        }).catch(function (e) { FL.toast(String(e), 'err'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Sync from Fusion'; } });
    };

    W.settings = function () {
        var c = W.cfg();
        FL.call('finWcDefaults').then(function (def) {
            FL.modal('<i class="fa-solid fa-sliders"></i> Working capital — settings', '<div class="grid g2">' +
                '<label class="field">Pod<select id="ws-pod"><option value="">the logged-in pod</option><option' + (c.pod === 'PROD' ? ' selected' : '') + '>PROD</option><option' + (c.pod === 'TEST' ? ' selected' : '') + '>TEST</option></select></label>' +
                '<label class="field">Ageing buckets (days)<input id="ws-b" value="' + esc((c.buckets || []).join(', ')) + '" placeholder="30, 60, 90, 180"></label>' +
                '<label class="field">Only these business units / inventory orgs (ids, comma separated; empty = all)<input id="ws-o" value="' + esc((c.orgs || []).join(', ')) + '"></label>' +
                '<div class="field"><b>Inventory unit cost</b><div class="sm" id="ws-cost">' + (c.cost ? esc(c.cost.table + '.' + c.cost.costCol + ' by ' + c.cost.itemCol + (c.cost.orgCol ? ' + ' + c.cost.orgCol : '')) : 'none — quantities only; the value comes from the GL') + '</div>' +
                '<button class="btn sm" id="ws-find"><i class="fa-solid fa-magnifying-glass"></i> Find cost tables in Fusion</button> <button class="btn sm" id="ws-nocost">No cost source</button><div id="ws-costs"></div></div></div>' +
                '<details style="margin-top:8px"><summary><b>Queries</b> (advanced — placeholders {BUCKET:due date}, {AS_OF}, {ORG_FILTER:column}, {UNIT_COST}; the column names must stay)</summary>' +
                [['ar', 'Debtors', c.arQuery || def.ar], ['ap', 'Creditors', c.apQuery || def.ap], ['inv', 'Stock on hand', c.invQuery || def.inv]].map(function (x) {
                    return '<label class="field">' + x[1] + ' <a class="sm" data-def="' + x[0] + '">default</a><textarea id="ws-q-' + x[0] + '" class="mono" rows="7" style="width:100%">' + esc(x[2]) + '</textarea></label>';
                }).join('') + '</details>',
                '<button class="btn primary" id="ws-save"><i class="fa-solid fa-floppy-disk"></i> Save</button>');
            var cost = c.cost;
            document.querySelectorAll('[data-def]').forEach(function (a) { a.onclick = function () { $('ws-q-' + a.dataset.def).value = def[a.dataset.def]; }; });
            $('ws-nocost').onclick = function () { cost = null; $('ws-cost').textContent = 'none — quantities only; the value comes from the GL'; };
            $('ws-find').onclick = function () {
                $('ws-costs').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> reading ALL_TAB_COLUMNS…';
                FL.call('finWcCostTables', { pod: $('ws-pod').value }, 6 * 60000).then(function (r) {
                    if (!r.ok) throw r.error;
                    $('ws-costs').innerHTML = r.tables.length ? '<table class="t sm"><tbody>' + r.tables.map(function (t, i) { return '<tr><td><b>' + esc(t.table) + '</b><div class="muted">' + esc(t.costCol + ' by ' + t.itemCol + (t.orgCol ? ' + ' + t.orgCol : '')) + (t.invOrg ? '' : ' — org column is not the inventory org, check the coverage after a sync') + '</div></td><td><button class="btn sm" data-ct="' + i + '">Use</button></td></tr>'; }).join('') + '</tbody></table>' : 'No CST table with an item id and a cost column.';
                    $('ws-costs').querySelectorAll('[data-ct]').forEach(function (b) { b.onclick = function () { var t = r.tables[+b.dataset.ct]; cost = { table: t.table, itemCol: t.itemCol, orgCol: t.invOrg ? t.orgCol : null, costCol: t.costCol }; $('ws-cost').textContent = t.table + '.' + t.costCol + ' by ' + t.itemCol + (cost.orgCol ? ' + ' + cost.orgCol : ''); }; });
                }).catch(function (e) { $('ws-costs').innerHTML = '<span class="neg">' + esc(String(e)) + '</span>'; });
            };
            $('ws-save').onclick = function () {
                var qv = function (k) { var v = $('ws-q-' + k).value.trim(); return v === def[k].trim() ? '' : v; };
                FL.config.wc = { pod: $('ws-pod').value, buckets: $('ws-b').value.split(/[,; ]+/).map(Number).filter(function (x) { return x > 0; }), orgs: $('ws-o').value.split(/[,; ]+/).map(function (x) { return x.trim(); }).filter(Boolean),
                    cost: cost, arQuery: qv('ar'), apQuery: qv('ap'), invQuery: qv('inv') };
                FL.saveConfig().then(function () { FL.closeModal(); FL.toast('Saved — Sync to apply', 'ok'); FL.render(); });
            };
        });
    };

    W.excel = function () {
        if (!window.ExcelJS || !W.data) return;
        var wb = new ExcelJS.Workbook(), bk = W.buckets(), d = W.data;
        ['AR', 'AP'].forEach(function (k) {
            if (!d.last[k]) return;
            var ws = wb.addWorksheet(KIND[k][0]), hdr = ws.addRow([k === 'AR' ? 'Customer' : 'Supplier', 'Number', 'Total'].concat(bk).concat(['Oldest due', 'Items']).concat(k === 'AP' ? ['On hold'] : []));
            hdr.font = { bold: true };
            W.parties(d[k]).forEach(function (p) { ws.addRow([p.name, p.number, p.total].concat(bk.map(function (n) { return p.b[n] || 0; })).concat([p.oldest, p.items]).concat(k === 'AP' ? [p.hold] : [])); });
            ws.getColumn(1).width = 40; for (var i = 3; i <= 3 + bk.length; i++) ws.getColumn(i).numFmt = '#,##0;(#,##0);"–"';
            ws.views = [{ state: 'frozen', ySplit: 1 }];
        });
        if (d.last.INV) {
            var ws = wb.addWorksheet('Inventory'); ws.addRow(['Org', 'Item', 'Description', 'Subinventory', 'UOM', 'Quantity', 'Unit cost', 'Value', 'Oldest receipt', 'Age (days)']).font = { bold: true };
            d.INV.forEach(function (r) { ws.addRow([r.org_code || r.org_id, r.item_number, r.description, r.subinventory, r.uom, r.quantity, r.unit_cost, r.value, r.oldest_receipt, r.age_days]); });
            ws.getColumn(3).width = 40; ws.views = [{ state: 'frozen', ySplit: 1 }];
        }
        wb.xlsx.writeBuffer().then(function (buf) { FL.download('Working capital ' + String((d.snaps[d.snaps.length - 1] || {}).at || '').slice(0, 10) + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); });
    };

    /** For the CFO Copilot's context: totals, buckets and the five biggest parties of the latest snapshots */
    W.summary = function () {
        return W.load().then(function (d) {
            if (!d) return null;
            var out = { asOf: {}, note: 'Subledger snapshots (ledger currency). Ages are as of the snapshot time.' };
            ['AR', 'AP'].forEach(function (k) {
                if (!d.last[k]) return; var keep = W.bu; W.bu = ''; var t = W.totals(d[k]), ps = W.parties(d[k]).slice(0, 5); W.bu = keep;
                out[k === 'AR' ? 'debtors' : 'creditors'] = { total: Math.round(t.total), overdue: Math.round(t.overdue), buckets: t.b, top: ps.map(function (p) { return [p.name, Math.round(p.total), Math.round(p.total - (p.b.Current || 0))]; }) };
                out.asOf[k] = d.last[k].at;
            });
            if (d.last.INV) { var s = W.stock(d.INV); out.inventory = { lines: s.lines, quantity: Math.round(s.qty), value: s.costed ? Math.round(s.value) : null, valueBasis: s.costed ? 'item cost' : 'GL', ageValue: s.age, ageQty: s.ageQty }; out.asOf.INV = d.last.INV.at; }
            return out;
        }).catch(function () { return null; });
    };
})();
