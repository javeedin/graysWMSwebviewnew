/* Finance Lens — Debtors, Creditors and Inventory: one page each, built on the working-capital snapshots (FL.wc — fin_wc_parties,
   fin_wc_stock, fin_wc_snapshots, fin_items, synced by finWcSync). Every page compares the latest snapshot with an earlier one
   (previous by default), shows a movement bridge, the ageing trend over the snapshots and rule-based findings.
   Debtors: collection worklist (overdue weighted by age, next step per customer), expected credit loss (IFRS 9 provision
   matrix, rates editable and kept in config.json wc.ecl), concentration (Pareto), business units.
   Creditors: payment run planner (cash available × strategy → who gets paid and what stays overdue), suppliers to act on
   (holds, > 90 days, debit balances), concentration, business units.
   Inventory: ABC by value × stock age, items that did not move since the comparison snapshot, slow-moving provision
   (rates by age band in config.json wc.slob), organisations, and the stock explorer of the Working capital tab. */
(function () {
    var W = FL.wc, X = FL.wcp = { cmp: FL.ls('wcp.cmp', {}), last: {}, plan: FL.ls('wcp.plan', { cash: '', how: 'oldest', hold: true, current: false }) };
    X.KIND = { debtors: 'AR', creditors: 'AP', inventory: 'INV' };
    var NAME = { AR: 'Debtors', AP: 'Creditors', INV: 'Inventory' }, ICON = { AR: 'fa-hand-holding-dollar', AP: 'fa-file-invoice', INV: 'fa-boxes-stacked' };
    var AGE = [[90, '0-90 days'], [180, '91-180 days'], [365, '181-365 days'], [1e9, 'over a year']];
    var BCOL = ['#16a34a', '#84cc16', '#facc15', '#f59e0b', '#ea580c', '#dc2626', '#991b1b'];

    var money = function (v) { return v == null || isNaN(v) ? '—' : FINE.fmt(v / (FL.filter.scale || 1), 'num', { decimals: FL.filter.scale >= 1000000 ? 1 : 0 }); };
    var sc = function (v) { return v == null ? null : Math.round(v / (FL.filter.scale || 1) * 10) / 10; };
    var pctN = function (a, b) { return b ? a / b * 100 : 0; };
    var pct = function (a, b) { return b ? (Math.round(a / b * 1000) / 10) + ' %' : '—'; };
    var signed = function (v) { return v == null ? '' : (v > 0 ? '+' : '') + money(v); };
    var pod = function () { return FL.q(W.cfg().pod || ''); };
    var short = function (at) { return String(at || '').slice(0, 16); };
    var day = function (s) { var t = Date.parse(String(s || '').slice(0, 10)); return isNaN(t) ? null : t; };
    X.days = function (from, at) { var a = day(from), b = day(at); return a == null || b == null ? null : Math.round((b - a) / 864e5); };
    /** Lowest days past due of a bucket name (Current 0, "31-60" 31, ">180" 181) */
    X.lb = function (n) { return n === 'Current' ? 0 : n.charAt(0) === '>' ? +n.slice(1) + 1 : +String(n).split('-')[0]; };
    var is90 = function (n) { return n !== 'Current' && X.lb(n) > 90; };
    var weight = function (n) { var l = X.lb(n); return l === 0 ? 0 : l <= 30 ? 1 : l <= 60 ? 2 : l <= 90 ? 3 : l <= 180 ? 5 : 8; };
    var defEcl = function (n) { var l = X.lb(n); return l === 0 ? 0.5 : l <= 30 ? 2 : l <= 60 ? 5 : l <= 90 ? 10 : l <= 180 ? 25 : 50; };
    X.eclRates = function () { var s = W.cfg().ecl || {}, o = {}; W.buckets().forEach(function (n) { o[n] = s[n] != null ? +s[n] : defEcl(n); }); return o; };
    X.slobRates = function () { var s = W.cfg().slob || {}, d = { '0-90 days': 0, '91-180 days': 10, '181-365 days': 25, 'over a year': 50 }, o = {}; AGE.forEach(function (a) { o[a[1]] = s[a[1]] != null ? +s[a[1]] : d[a[1]]; }); return o; };
    var band = function (days) { return AGE.filter(function (x) { return (days == null ? 0 : days) <= x[0]; })[0][1]; };
    var tile = function (l, v, s, cls, tip) { return '<div class="sk-card"' + (tip ? ' title="' + esc(tip) + '"' : '') + '><div class="sk-l">' + esc(l) + '</div><div class="sk-v">' + v + '</div><div class="sk-s ' + (cls || '') + '">' + (s || '&nbsp;') + '</div></div>'; };
    var delta = function (now, then, goodDown) {
        if (then == null) return { s: 'no comparison', c: '' };
        var d = now - then, p = then ? d / Math.abs(then) * 100 : null;
        if (Math.abs(d) < 0.5) return { s: 'no change vs comparison', c: '' };
        return { s: signed(d) + (p != null && isFinite(p) ? ' (' + (p > 0 ? '+' : '') + Math.round(p * 10) / 10 + ' %)' : '') + ' vs comparison', c: Math.abs(d) < 0.5 ? '' : (d < 0) === !!goodDown ? 'pos' : 'neg' };
    };

    /** Snapshots of a kind, oldest first; the comparison snapshot chosen on the page ('prev' = the one before the latest) */
    X.snaps = function (k) { return ((W.data || {}).snaps || []).filter(function (s) { return s.kind === k; }); };
    X.cmpAt = function (k) {
        var s = X.snaps(k), c = X.cmp[k] || 'prev';
        if (c === 'none' || s.length < 2) return null;
        if (c === 'prev') return s[s.length - 2].at;
        if (c === 'first') return s[0].at;
        return s.some(function (x) { return x.at === c; }) && c !== s[s.length - 1].at ? c : s[s.length - 2].at;
    };
    /** Days between the comparison and the latest snapshot (null without a comparison) */
    X.gap = function (k) { var c = X.cmpAt(k), s = X.snaps(k), l = s[s.length - 1]; if (!c || !l) return null; var a = Date.parse(String(c).replace(' ', 'T')), b = Date.parse(String(l.at).replace(' ', 'T')); return isNaN(a) || isNaN(b) ? null : (b - a) / 864e5; };
    var gapTxt = function (k) { var g = X.gap(k); return g == null ? '' : g < 1 ? ' — the snapshots are only ' + Math.max(1, Math.round(g * 24 * 60)) + ' minutes apart; pick an older comparison for a real picture' : ' (' + Math.round(g) + ' days apart)'; };
    X.rowsAt = function (k, at) {
        var p = pod(), w = " WHERE s.pod = " + p + " AND CAST(s.snapshot_at AS VARCHAR) = " + FL.q(at);
        if (k !== 'INV') return FL.rows("SELECT * FROM fin_wc_parties s" + w + " AND s.kind = '" + k + "'", 200000).catch(function () { return []; });
        return FL.rows("SELECT s.*, i.list_price FROM fin_wc_stock s LEFT JOIN (SELECT org_id, item_number, list_price FROM fin_items WHERE pod = " + p +
            " QUALIFY ROW_NUMBER() OVER (PARTITION BY org_id, item_number ORDER BY read_at DESC) = 1) i ON i.org_id = s.org_id AND i.item_number = s.item_number" + w, 300000)
            .catch(function () { return FL.rows("SELECT s.* FROM fin_wc_stock s" + w, 300000); }).catch(function () { return []; });
    };
    /** Ageing of every snapshot: AR / AP by bucket × business unit, stock by age band × organisation */
    X.trend = function (k) {
        var p = pod();
        var sql = k === 'INV'
            ? "SELECT CAST(snapshot_at AS VARCHAR) AS at, org_id, CASE WHEN COALESCE(age_days, 0) <= 90 THEN '0-90 days' WHEN age_days <= 180 THEN '91-180 days' WHEN age_days <= 365 THEN '181-365 days' ELSE 'over a year' END AS band, SUM(value) AS v, SUM(quantity) AS q, COUNT(value) AS nv FROM fin_wc_stock WHERE pod = " + p + " GROUP BY ALL ORDER BY 1"
            : "SELECT CAST(snapshot_at AS VARCHAR) AS at, bu_id, bucket, SUM(amount) AS v FROM fin_wc_parties WHERE pod = " + p + " AND kind = '" + k + "' GROUP BY ALL ORDER BY 1";
        return FL.rows(sql, 50000).catch(function () { return []; });
    };
    X.prep = function () {
        var kp = FL.data().then(function (data) { try { return FINE.kpis(FL.config.kpis || [], FL.tplMap(), data, FL.filter.period); } catch (e) { return {}; } }).catch(function () { return {}; });
        return Promise.all([W.load(), W.gl(), kp]).then(function (r) { W.data = r[0]; W.glv = r[1]; W.kv = r[2]; return r[0]; });
    };
    var kvd = function (id) { var k = (W.kv || {})[id]; return k && k.value != null ? k.value : null; };

    // ═════ page frame: title, filters, comparison, sync, checklist ═════
    X.frame = function (k, extra) {
        var d = W.data || {}, admin = FL.who && FL.who.admin, s = X.snaps(k), last = s[s.length - 1], cmp = X.cmpAt(k), c = X.cmp[k] || 'prev';
        var flt = '';
        if (k === 'INV') {
            var orgs = {}; (d.INV || []).forEach(function (r) { orgs[r.org_id] = r.org_code || r.org_id; });
            flt = '<label class="sm"><b>Organisation</b> <select id="wp-org"><option value="">All organisations</option>' + Object.keys(orgs).sort(function (a, b) { return String(orgs[a]).localeCompare(String(orgs[b])); })
                .map(function (o) { return '<option value="' + esc(o) + '"' + (W.org === o ? ' selected' : '') + '>' + esc(W.orgName(o, orgs[o])) + '</option>'; }).join('') + '</select></label>';
        } else {
            var bus = {}; (d[k] || []).forEach(function (r) { bus[r.bu_id] = 1; });
            flt = '<label class="sm"><b>Business unit</b> <select id="wp-bu"><option value="">All business units</option>' + Object.keys(bus).sort(function (a, b) { return String(W.buName(a)).localeCompare(String(W.buName(b))); })
                .map(function (b) { return '<option value="' + esc(b) + '"' + (W.bu === b ? ' selected' : '') + '>' + esc(W.buName(b) !== b ? W.buName(b) + '  (' + b + ')' : b) + '</option>'; }).join('') + '</select></label>';
        }
        var cmpSel = '<label class="sm"><b>Compare with</b> <select id="wp-cmp"' + (s.length < 2 ? ' disabled title="Sync again later — every sync is kept, so the comparison builds up"' : '') + '>' +
            '<option value="prev"' + (c === 'prev' ? ' selected' : '') + '>Previous snapshot' + (s.length > 1 ? ' (' + short(s[s.length - 2].at) + ')' : '') + '</option>' +
            (s.length > 2 ? '<option value="first"' + (c === 'first' ? ' selected' : '') + '>First snapshot (' + short(s[0].at) + ')</option>' : '') +
            s.slice(0, -1).reverse().slice(1, 24).map(function (x) { return '<option value="' + esc(x.at) + '"' + (c === x.at ? ' selected' : '') + '>' + esc(short(x.at)) + '</option>'; }).join('') +
            '<option value="none"' + (c === 'none' ? ' selected' : '') + '>No comparison</option></select></label>';
        return '<div class="row" style="margin-bottom:10px;gap:8px;align-items:center"><h2 style="margin:0"><i class="fa-solid ' + ICON[k] + '"></i> ' + NAME[k] + '</h2>' +
            '<span class="sm muted">' + (last ? 'as of ' + esc(short(last.at)) + (cmp ? ' · compared with ' + esc(short(cmp)) : '') : 'not synced') + ' · amounts in ' + FL.scaleLabel() + '</span><span class="grow"></span>' +
            (extra || '') + '<button class="btn sm" id="wp-ask"><i class="fa-solid fa-wand-magic-sparkles"></i> Ask the Copilot</button>' +
            (last ? '<button class="btn sm" id="wp-xl"><i class="fa-solid fa-file-excel"></i> Excel</button>' : '') +
            (admin ? '<button class="btn sm primary" id="wc-sync"><i class="fa-solid fa-cloud-arrow-down"></i> Sync ' + NAME[k].toLowerCase() + '</button>' : '') + '</div><div id="wc-prog"></div>' +
            (last ? '<div class="wc-filt">' + flt + cmpSel + (W.bu && k !== 'INV' || W.org && k === 'INV' ? '<a class="sm" id="wp-fclear"><i class="fa-solid fa-xmark"></i> show all</a>' : '') + '<span class="grow"></span>' +
                '<a class="sm" data-tab-go="wc"><i class="fa-solid fa-scale-unbalanced"></i> Working capital overview</a></div>' : '');
    };
    X.wireFrame = function (el, k) {
        var q = function (s) { return el.querySelector(s); };
        if (q('#wp-bu')) q('#wp-bu').onchange = function () { W.bu = this.value; FL.lsSet('wc.bu', W.bu); FL.render(); };
        if (q('#wp-org')) q('#wp-org').onchange = function () { W.org = this.value; FL.lsSet('wc.org', W.org); FL.render(); };
        if (q('#wp-fclear')) q('#wp-fclear').onclick = function () { if (k === 'INV') { W.org = ''; FL.lsSet('wc.org', ''); } else { W.bu = ''; FL.lsSet('wc.bu', ''); } FL.render(); };
        if (q('#wp-cmp')) q('#wp-cmp').onchange = function () { X.cmp[k] = this.value; FL.lsSet('wcp.cmp', X.cmp); FL.render(); };
        if (q('#wc-sync')) q('#wc-sync').onclick = function () { W.sync([k]); };
        if (q('#wp-xl')) q('#wp-xl').onclick = function () { X.excel(k); };
        if (q('#wp-ask')) q('#wp-ask').onclick = function () { FL.askCopilot(''); };
        el.querySelectorAll('[data-tab-go]').forEach(function (a) { a.onclick = function () { FL.show(a.dataset.tabGo); }; });
        el.querySelectorAll('[data-wp-party]').forEach(function (a) { a.onclick = function () { W.detail(k, a.dataset.wpParty, a.textContent); }; });
    };
    X.empty = function (el, k) {
        var admin = FL.who && FL.who.admin, what = { AR: 'open receivables by customer and age (AR_PAYMENT_SCHEDULES_ALL)', AP: 'open payables by supplier and age, with items on hold (AP_PAYMENT_SCHEDULES_ALL)', INV: 'stock on hand by organisation, item and subinventory, aged from the oldest receipt (INV_ONHAND_QUANTITIES_DETAIL)' }[k];
        el.innerHTML = X.frame(k) + '<div class="card" style="max-width:760px"><h3>No ' + NAME[k].toLowerCase() + ' snapshot yet</h3><p>Sync reads, read-only from Oracle Fusion, the ' + what + '. Every sync is kept, so this page compares snapshots and shows the trend as they build up.</p>' +
            (admin ? '' : '<div class="callout warn">An AI admin syncs the subledgers.</div>') + '</div><details class="card" open style="margin-top:12px"><summary><b>Working capital checklist</b></summary><div id="wc-md"></div></details>';
        X.wireFrame(el, k); W.md();
    };
    var insightsHtml = function (list) {
        if (!list.length) return '<p class="sm muted">Nothing stands out.</p>';
        return '<ul class="sk-ins">' + list.map(function (i) { return '<li class="' + (i.sev || '') + '"><span class="sk-ic">' + (i.sev === 'bad' ? '!' : i.sev === 'good' ? '✓' : '•') + '</span><span>' + i.html + '</span></li>'; }).join('') + '</ul>';
    };

    // ═════ Debtors / Creditors ═════
    /** Parties with overdue, > 90 days, age of the oldest item, the comparison and a priority score (overdue weighted 1× up to 30 days … 8× over 180) */
    X.partyModel = function (k, cur, prev) {
        var bk = W.buckets(), at = (W.data.last[k] || {}).at, ecl = X.eclRates();
        var t = W.totals(cur), ps = W.parties(cur), t0 = prev ? W.totals(prev) : null, ps0 = prev ? W.parties(prev) : [];
        var m0 = {}; ps0.forEach(function (p) { m0[p.number + '|' + p.name] = p; });
        var seen = {};
        ps.forEach(function (p) {
            var key = p.number + '|' + p.name, o = m0[key]; seen[key] = 1;
            p.overdue = p.total - (p.b.Current || 0);
            p.o90 = 0; p.score = 0; p.ecl = 0;
            bk.forEach(function (n) { var v = p.b[n] || 0; if (is90(n)) p.o90 += v; if (v > 0) p.score += v * weight(n); p.ecl += Math.max(0, v) * (ecl[n] || 0) / 100; });
            p.days = p.oldest ? X.days(p.oldest, at) : null;
            p.prev = o || null; p.isNew = !!prev && !o;
            p.dTotal = o ? p.total - o.total : prev ? p.total : null;
            p.dOver = o ? p.overdue - (o.total - (o.b.Current || 0)) : prev ? p.overdue : null;
            var o90 = 0; if (o) bk.forEach(function (n) { if (is90(n)) o90 += o.b[n] || 0; });
            p.d90 = o ? p.o90 - o90 : prev ? p.o90 : null;
        });
        var gone = ps0.filter(function (p) { return !seen[p.number + '|' + p.name]; });
        var mv = null;
        if (prev) {
            mv = { start: t0.total, end: t.total, added: 0, up: 0, down: 0, gone: 0, nNew: 0, nGone: gone.length, worse: 0 };
            ps.forEach(function (p) { if (p.isNew) { mv.added += p.total; mv.nNew++; } else if (p.dTotal > 0) mv.up += p.dTotal; else mv.down += p.dTotal; if (p.d90 > 0.5) mv.worse++; });
            gone.forEach(function (p) { mv.gone -= p.total; });
        }
        var pos = ps.filter(function (p) { return p.total > 0; }).sort(function (a, b) { return b.total - a.total; }), posT = pos.reduce(function (s, p) { return s + p.total; }, 0), run = 0, n80 = 0;
        pos.forEach(function (p) { if (run < posT * 0.8) n80++; run += p.total; });
        var top = function (n) { return pctN(pos.slice(0, n).reduce(function (s, p) { return s + p.total; }, 0), posT); };
        var eclT = 0; bk.forEach(function (n) { eclT += Math.max(0, t.b[n] || 0) * (ecl[n] || 0) / 100; });
        var credit = ps.filter(function (p) { return p.total < -0.5; });
        return { k: k, at: at, bk: bk, t: t, t0: t0, ps: ps, gone: gone, mv: mv, pos: pos, posT: posT, n80: n80, top1: top(1), top5: top(5), top10: top(10), ecl: eclT, eclRates: ecl,
            credit: credit, creditT: credit.reduce(function (s, p) { return s + p.total; }, 0), hold: ps.filter(function (p) { return p.hold > 0; }) };
    };
    /** The next step for one party — plain words */
    X.step = function (k, p) {
        if (p.total < -0.5) return k === 'AR' ? 'Credit balance — refund or allocate it' : 'Debit balance — recover it or offset the next invoice';
        if (k === 'AP') {
            if (p.hold > 0) return 'Resolve ' + p.hold + ' hold(s) before the next run';
            if (p.o90 > 0.5) return 'Pay or agree a plan — supply at risk';
            if (p.overdue > 0.5) return 'Pay in the next run';
            return 'Not due — pay on terms';
        }
        if (p.o90 > 0.5 && p.days > 180) return 'Escalate — stop credit, consider legal / provision';
        if (p.o90 > 0.5) return 'Call today — ' + money(p.o90) + ' over 90 days';
        if (p.dOver > 0.5 && p.prev) return 'Getting worse — call this week';
        if (p.overdue > 0.5) return 'Send a reminder';
        return 'Current — nothing to do';
    };
    X.partyInsights = function (m) {
        var k = m.k, t = m.t, t0 = m.t0, out = [], noun = k === 'AR' ? 'customer' : 'supplier', glv = (W.glv || {})[k], days = kvd(k === 'AR' ? 'dso' : 'dpo');
        var od = pctN(t.overdue, t.total);
        if (t0) {
            var od0 = pctN(t0.overdue, t0.total), dd = od - od0;
            if (Math.abs(dd) >= 1) out.push({ sev: (dd > 0) === (k === 'AR') ? 'bad' : 'good', html: 'Overdue is <b>' + Math.round(od) + ' %</b> of the balance, ' + (dd > 0 ? 'up' : 'down') + ' <b>' + Math.abs(Math.round(dd * 10) / 10) + ' pts</b> since ' + esc(short(X.cmpAt(k))) + '.' });
        } else if (t.total) out.push({ sev: od > 30 ? 'bad' : '', html: 'Overdue is <b>' + Math.round(od) + ' %</b> of the balance (' + money(t.overdue) + ').' });
        if (t.old90 > 0.5) out.push({ sev: pctN(t.old90, t.total) > 10 ? 'bad' : '', html: '<b>' + money(t.old90) + '</b> (' + pct(t.old90, t.total) + ') is more than 90 days past due' + (k === 'AR' ? ' — the expected credit loss on the whole book is <b>' + money(m.ecl) + '</b>.' : ' — suppliers with these may stop supplying.') });
        if (m.mv && m.mv.worse) out.push({ sev: 'bad', html: '<b>' + m.mv.worse + ' ' + noun + '(s)</b> have more over 90 days than at the comparison.' });
        if (m.mv && X.gap(k) < 1) out.push({ html: 'The comparison snapshot is ' + esc(short(X.cmpAt(k))) + esc(gapTxt(k)) + '.' });
        if (m.mv && (m.mv.nNew || m.mv.nGone)) out.push({ html: m.mv.nNew + ' new ' + noun + '(s) (' + money(m.mv.added) + ') and ' + m.mv.nGone + ' cleared (' + money(-m.mv.gone) + ') since the comparison.' });
        if (m.top1 >= 20 && m.pos.length > 3) out.push({ sev: m.top1 >= 35 ? 'bad' : '', html: 'Concentration: <b>' + esc(m.pos[0].name) + '</b> is ' + Math.round(m.top1) + ' % of the balance; the top 10 are ' + Math.round(m.top10) + ' %.' });
        else if (m.pos.length) out.push({ html: m.n80 + ' of ' + m.pos.length + ' ' + noun + 's make up 80 % of the balance; the top 10 are ' + Math.round(m.top10) + ' %.' });
        if (m.credit.length) out.push({ sev: Math.abs(m.creditT) > Math.abs(t.total) * 0.02 ? 'bad' : '', html: '<b>' + m.credit.length + ' ' + noun + '(s)</b> have a ' + (k === 'AR' ? 'credit' : 'debit') + ' balance of ' + money(m.creditT) + ' — ' + (k === 'AR' ? 'refund, or allocate it to open invoices.' : 'recover it, or offset it in the next payment run.') });
        if (k === 'AP' && m.hold.length) out.push({ sev: 'bad', html: '<b>' + m.hold.reduce(function (s, p) { return s + p.hold; }, 0) + ' item(s) on hold</b> with ' + m.hold.length + ' supplier(s) — they will not be paid until the holds are released.' });
        if (glv != null && !W.bu) {
            var diff = t.total - glv;
            out.push(Math.abs(diff) < Math.max(1, Math.abs(glv) * 0.005) ? { sev: 'good', html: 'The subledger agrees with the GL control account (' + money(glv) + ').' }
                : { sev: 'bad', html: 'The subledger differs from the GL control account by <b>' + money(diff) + '</b> (GL ' + money(glv) + ' at the end of ' + esc(FL.periodName(FL.filter.period)) + ') — timing, unposted items or manual journals on the control account.' });
        }
        if (k === 'AR' && days != null && days > 730) out.push({ html: 'DSO from the GL reads <b>' + Math.round(days) + ' days</b> — the revenue it divides by is very small for ' + esc(FL.periodName(FL.filter.period)) + (FL.filter.company ? ' and this company' : '') + ' (only part of the year synced, or a company with little revenue); use the ageing here instead.' });
        else if (k === 'AR' && days != null && t.total > 0) {
            var top10 = m.ps.filter(function (p) { return p.overdue > 0; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 10), get = top10.reduce(function (s, p) { return s + p.overdue; }, 0);
            if (get > 0) out.push({ sev: 'good', html: 'Collecting the overdue of the top 10 on the worklist (<b>' + money(get) + '</b>) would cut DSO by about <b>' + Math.round(days * get / t.total) + ' days</b> (from ' + Math.round(days) + ').' });
        }
        if (k === 'AP' && days != null) out.push({ html: 'Days payables outstanding (GL): <b>' + Math.round(days) + ' days</b>' + (od < 5 && days < 45 ? ' — we pay early; there may be room to hold cash longer within terms.' : '.') });
        return out;
    };

    X.partyPage = function (el, k) {
        var d = W.data;
        if (!d || d.empty || !d.last[k]) return X.empty(el, k);
        var cmp = X.cmpAt(k);
        return Promise.all([cmp ? X.rowsAt(k, cmp) : Promise.resolve(null), X.trend(k)]).then(function (r) {
            var m = X.partyModel(k, d[k], r[0]), t = m.t, isAR = k === 'AR', noun = isAR ? 'Customer' : 'Supplier', days = kvd(isAR ? 'dso' : 'dpo'), glv = (W.glv || {})[k];
            m.insights = X.partyInsights(m); X.last[k] = m;
            var od = delta(t.overdue, m.t0 ? m.t0.overdue : null, true);
            var tiles = '<div class="sk-cards">' +
                tile('Open ' + (isAR ? 'receivables' : 'payables'), money(t.total), delta(t.total, m.t0 ? m.t0.total : null, isAR).s, delta(t.total, m.t0 ? m.t0.total : null, isAR).c) +
                tile('Overdue', money(t.overdue), pct(t.overdue, t.total) + ' of the balance · ' + od.s, od.c) +
                tile('Over 90 days', money(t.old90), pct(t.old90, t.total) + (m.t0 ? ' · ' + delta(t.old90, m.t0.old90, true).s : ''), m.t0 ? delta(t.old90, m.t0.old90, true).c : '') +
                (isAR ? tile('Expected credit loss', money(m.ecl), pct(m.ecl, t.total) + ' of the balance — provision matrix below', '', 'IFRS 9 simplified approach: balance per age bucket × loss rate')
                    : tile('On hold', m.hold.reduce(function (s, p) { return s + p.hold; }, 0).toLocaleString() + ' item(s)', m.hold.length + ' supplier(s)', m.hold.length ? 'neg' : '')) +
                tile(isAR ? 'DSO (GL)' : 'DPO (GL)', days == null ? '—' : Math.round(days) + ' d', 'days ' + (isAR ? 'customers take to pay' : 'we take to pay')) +
                tile('GL control', glv == null ? '—' : money(glv), glv == null ? 'no balance sheet line' : W.bu ? 'clear the business unit to compare' : 'difference ' + money(t.total - glv), glv == null || W.bu ? '' : Math.abs(t.total - glv) < Math.max(1, Math.abs(glv) * 0.005) ? 'pos' : 'neg') +
                tile(noun + 's', m.ps.length.toLocaleString(), m.mv ? m.mv.nNew + ' new · ' + m.mv.nGone + ' cleared' : m.n80 + ' make up 80 %') +
                tile('Top 10 share', Math.round(m.top10) + ' %', 'largest ' + Math.round(m.top1) + ' % · ' + m.n80 + ' make 80 %', m.top1 >= 35 ? 'neg' : '') + '</div>';
            var ageBar = '<div class="wc-agebar">' + m.bk.map(function (n, i) { var v = t.b[n] || 0, w = t.total ? Math.max(0, v / t.total * 100) : 0; return w > 0.3 ? '<span style="width:' + w + '%;background:' + BCOL[Math.min(i, BCOL.length - 1)] + '" title="' + esc(n + ': ' + money(v)) + '"></span>' : ''; }).join('') + '</div>' +
                '<div class="row sm" style="flex-wrap:wrap;gap:12px;margin-top:6px">' + m.bk.map(function (n, i) { return '<span><i class="dot" style="background:' + BCOL[Math.min(i, BCOL.length - 1)] + '"></i> ' + esc(n) + ' <b>' + money(t.b[n] || 0) + '</b> <span class="muted">' + pct(t.b[n] || 0, t.total) + '</span></span>'; }).join('') + '</div>';
            var act = '<div class="card"><h3>' + (isAR ? 'Collection worklist' : 'Suppliers to act on') + ' <small class="muted">' + (isAR ? 'overdue weighted by age (1× up to 30 days … 8× over 180) — call from the top · click a name for the open items, live from Fusion' : 'holds, over 90 days and debit balances first · click a name for the open items, live from Fusion') + '</small></h3><div id="wp-work"></div></div>';
            el.innerHTML = X.frame(k) + tiles +
                '<div class="sk-grid"><div class="card"><h3>What stands out</h3>' + insightsHtml(m.insights) + '</div>' +
                '<div class="card"><h3>Ageing <small class="muted">by days past due</small></h3>' + ageBar + '<div class="sk-ch" style="height:210px;margin-top:10px"><canvas id="wp-trend"></canvas></div></div></div>' +
                (isAR ? '' : X.plannerHtml()) + act +
                '<div class="sk-grid">' + (m.mv ? '<div class="card"><h3>Movement <small class="muted">from ' + esc(short(cmp)) + ' to ' + esc(short(m.at)) + '</small></h3><div class="sk-ch" style="height:250px"><canvas id="wp-bridge"></canvas></div></div>' : '') +
                '<div class="card"><h3>Concentration <small class="muted">largest ' + noun.toLowerCase() + 's and the cumulative share</small></h3><div class="sk-ch" style="height:250px"><canvas id="wp-pareto"></canvas></div></div>' +
                (isAR ? '<div class="card" id="wp-ecl"></div>' : '') + '<div class="card"><h3>By business unit</h3><div id="wp-bu-grid"></div></div></div>' +
                '<div class="card"><h3>All ' + noun.toLowerCase() + 's <small class="muted">filter any column (text, &gt;10, =0, 1..5, !x) · click a row for the open items</small></h3><div id="wp-all"></div></div>' +
                '<details class="card" style="margin-top:12px"><summary><b>Working capital checklist</b></summary><div id="wc-md"></div></details>';
            X.wireFrame(el, k); W.md();
            X.partyGrids(k, m);
            if (isAR) X.eclCard(m); else X.planner(m);
            X.partyCharts(k, m, r[1]);
        });
    };
    X.partyGrids = function (k, m) {
        var isAR = k === 'AR', open = function (p) { W.detail(k, p.number, p.name); };
        var dcol = function (label, f, goodDown) { return { label: label, n: 1, html: true, get: function (p) { var v = f(p); return v == null ? '' : '<span class="' + (Math.abs(v) < 0.5 ? '' : (v < 0) === goodDown ? 'pos' : 'neg') + '">' + signed(v) + '</span>'; }, val: function (p) { var v = f(p); return v == null ? null : sc(v); } }; };
        var work = m.ps.filter(function (p) { return isAR ? p.overdue > 0.5 || p.total < -0.5 : p.hold > 0 || p.o90 > 0.5 || p.total < -0.5 || p.overdue > 0.5; })
            .sort(function (a, b) {
                if (!isAR) { var ra = a.hold > 0 ? 3 : a.o90 > 0.5 ? 2 : a.total < -0.5 ? 1 : 0, rb = b.hold > 0 ? 3 : b.o90 > 0.5 ? 2 : b.total < -0.5 ? 1 : 0; if (ra !== rb) return rb - ra; }
                return b.score - a.score || Math.abs(b.total) - Math.abs(a.total);
            });
        work.forEach(function (p, i) { p.rank = i + 1; p.next = X.step(k, p); });
        FL.grid($('wp-work'), [{ label: '#', n: 1, key: 'rank' }, { label: isAR ? 'Customer' : 'Supplier', key: 'name' }, { label: 'Number', key: 'number' },
            { label: 'Overdue', n: 1, get: function (p) { return money(p.overdue); }, val: function (p) { return sc(p.overdue); } },
            { label: '> 90 days', n: 1, get: function (p) { return p.o90 ? money(p.o90) : ''; }, val: function (p) { return sc(p.o90); } },
            { label: 'Oldest (days)', n: 1, html: true, get: function (p) { return p.days == null ? '' : '<span class="' + (p.days > 90 ? 'neg' : '') + '">' + p.days + '</span>'; }, val: function (p) { return p.days; } },
            dcol('Δ overdue', function (p) { return p.dOver; }, true)]
            .concat(isAR ? [{ label: 'Expected loss', n: 1, get: function (p) { return p.ecl ? money(p.ecl) : ''; }, val: function (p) { return sc(p.ecl); } }] : [{ label: 'On hold', n: 1, get: function (p) { return p.hold || ''; }, val: function (p) { return p.hold; } }])
            .concat([{ label: 'Next step', html: true, get: function (p) { return '<b class="' + (/Escalate|Call today|supply at risk|Resolve/.test(p.next) ? 'neg' : '') + '">' + esc(p.next) + '</b>'; }, val: function (p) { return p.next; } }]),
            work, { id: 'wp-work-' + k, height: '46vh', csv: (isAR ? 'collection-worklist' : 'suppliers-to-act-on') + '.csv', click: open, empty: 'Nothing overdue.' });
        FL.grid($('wp-all'), [{ label: isAR ? 'Customer' : 'Supplier', key: 'name' }, { label: 'Number', key: 'number' },
            { label: 'Business unit', get: function (p) { return Object.keys(p.bu).map(W.buName).join(', '); } },
            { label: 'Total', n: 1, get: function (p) { return money(p.total); }, val: function (p) { return sc(p.total); } }, dcol('Δ total', function (p) { return p.dTotal; }, isAR)]
            .concat(m.bk.map(function (n) { return { label: n, n: 1, get: function (p) { return p.b[n] ? money(p.b[n]) : ''; }, val: function (p) { return sc(p.b[n] || 0); } }; }))
            .concat([{ label: 'Overdue %', n: 1, get: function (p) { return pct(p.overdue, p.total); }, val: function (p) { return p.total ? Math.round(p.overdue / p.total * 1000) / 10 : 0; } },
                { label: 'Share', n: 1, get: function (p) { return pct(p.total, m.t.total); }, val: function (p) { return m.t.total ? Math.round(p.total / m.t.total * 1000) / 10 : 0; } },
                { label: 'Oldest due', key: 'oldest' }, { label: 'Items', n: 1, key: 'items' }, { label: 'Status', get: function (p) { return p.isNew ? 'new' : ''; } }]),
            m.ps, { id: 'wp-all-' + k, height: '55vh', csv: (isAR ? 'debtors' : 'creditors') + '.csv', click: open });
        var bus = {};
        (W.data[k] || []).forEach(function (r) {
            if (W.bu && r.bu_id !== W.bu) return;
            var b = bus[r.bu_id] = bus[r.bu_id] || { bu: W.buName(r.bu_id), total: 0, overdue: 0, o90: 0, parties: {} };
            b.total += r.amount; if (r.bucket !== 'Current') b.overdue += r.amount; if (is90(r.bucket)) b.o90 += r.amount; b.parties[r.party_number] = 1;
        });
        FL.grid($('wp-bu-grid'), [{ label: 'Business unit', key: 'bu' }, { label: 'Total', n: 1, get: function (b) { return money(b.total); }, val: function (b) { return sc(b.total); } },
            { label: 'Overdue', n: 1, get: function (b) { return money(b.overdue) + ' · ' + pct(b.overdue, b.total); }, val: function (b) { return sc(b.overdue); } },
            { label: '> 90 days', n: 1, get: function (b) { return money(b.o90); }, val: function (b) { return sc(b.o90); } },
            { label: isAR ? 'Customers' : 'Suppliers', n: 1, get: function (b) { return Object.keys(b.parties).length; }, val: function (b) { return Object.keys(b.parties).length; } }],
            Object.keys(bus).map(function (x) { return bus[x]; }).sort(function (a, b) { return b.total - a.total; }), { id: 'wp-bu-' + k, height: '30vh', csv: 'by-business-unit.csv' });
    };
    X.partyCharts = function (k, m, trend) {
        var snaps = {}, order = [];
        trend.forEach(function (r) { if (W.bu && r.bu_id !== W.bu) return; if (!snaps[r.at]) { snaps[r.at] = {}; order.push(r.at); } snaps[r.at][r.bucket] = (snaps[r.at][r.bucket] || 0) + r.v; });
        order = order.slice(-12);
        FL.chart('wp-trend', { type: 'bar', data: { labels: order.map(function (a) { return String(a).slice(5, 16); }),
            datasets: m.bk.map(function (n, i) { return { label: n, data: order.map(function (a) { return snaps[a][n] || 0; }), backgroundColor: BCOL[Math.min(i, BCOL.length - 1)], stack: 's' }; }) },
            options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }, title: { display: order.length < 2, text: 'The trend appears from the second sync' } }, scales: { x: { stacked: true }, y: Object.assign(FL.moneyAxis(), { stacked: true }) } } });
        if (m.mv) FL.waterfall('wp-bridge', [{ label: 'Comparison', value: m.mv.start, kind: 'start' }, { label: 'New', value: m.mv.added, kind: 'step' }, { label: 'Increased', value: m.mv.up, kind: 'step' },
            { label: 'Decreased', value: m.mv.down, kind: 'step' }, { label: 'Cleared', value: m.mv.gone, kind: 'step' }, { label: 'Now', value: m.mv.end, kind: 'end' }]);
        var top = m.pos.slice(0, 15), run = 0;
        FL.chart('wp-pareto', { type: 'bar', data: { labels: top.map(function (p) { return String(p.name || p.number).slice(0, 18); }),
            datasets: [{ type: 'line', label: 'Cumulative %', data: top.map(function (p) { run += p.total; return Math.round(run / (m.posT || 1) * 1000) / 10; }), yAxisID: 'y1', borderColor: FL.PAL.bad, pointRadius: 2, tension: 0.2 },
                { type: 'bar', label: 'Balance', data: top.map(function (p) { return p.total; }), backgroundColor: FL.PAL.act, borderRadius: 3 }] },
            options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: FL.moneyAxis(), y1: { position: 'right', min: 0, max: 100, ticks: { callback: function (v) { return v + '%'; }, font: { size: 10 } }, grid: { display: false } }, x: { ticks: { font: { size: 9 } } } } } });
    };

    /** IFRS 9 provision matrix: balance per age bucket × loss rate; the rates are editable (kept in config.json wc.ecl) */
    X.eclCard = function (m) {
        var box = $('wp-ecl'); if (!box) return;
        var rates = X.eclRates(), admin = FL.who && FL.who.admin;
        var paint = function () {
            var tot = 0, rows = m.bk.map(function (n) { var b = Math.max(0, m.t.b[n] || 0), e = b * (rates[n] || 0) / 100; tot += e; return { n: n, b: b, e: e }; });
            box.innerHTML = '<h3>Expected credit loss <small class="muted">provision matrix — IFRS 9 simplified approach; set the loss rates from your own write-off history</small></h3>' +
                '<table class="t"><thead><tr><th>Age bucket</th><th class="n">Balance</th><th class="n">Loss rate %</th><th class="n">Provision</th></tr></thead><tbody>' +
                rows.map(function (r) { return '<tr><td>' + esc(r.n) + '</td><td class="n">' + money(r.b) + '</td><td class="n"><input type="number" step="0.1" min="0" max="100" data-ecl="' + esc(r.n) + '" value="' + (rates[r.n] || 0) + '" style="width:70px;text-align:right"></td><td class="n">' + money(r.e) + '</td></tr>'; }).join('') +
                '</tbody><tfoot><tr><th>Total</th><th class="n">' + money(rows.reduce(function (s, r) { return s + r.b; }, 0)) + '</th><th class="n">' + pct(tot, m.t.total) + '</th><th class="n">' + money(tot) + '</th></tr></tfoot></table>' +
                '<div class="row sm" style="margin-top:6px;gap:8px"><span class="muted">Compare the total with the allowance for doubtful debts in the GL; the difference is the top-up (or release) to book.</span><span class="grow"></span>' +
                (admin ? '<button class="btn sm" id="wp-ecl-save"><i class="fa-solid fa-floppy-disk"></i> Save rates</button>' : '') + '<button class="btn sm ghost" id="wp-ecl-def">Default rates</button></div>';
            box.querySelectorAll('[data-ecl]').forEach(function (i) { i.onchange = function () { rates[i.dataset.ecl] = Math.max(0, Math.min(100, +i.value || 0)); m.ecl = Object.keys(rates).reduce(function (s, n) { return s + Math.max(0, m.t.b[n] || 0) * rates[n] / 100; }, 0); paint(); }; });
            if ($('wp-ecl-save')) $('wp-ecl-save').onclick = function () { FL.config.wc = Object.assign({}, FL.config.wc || {}, { ecl: rates }); FL.saveConfig().then(function () { FL.toast('Loss rates saved', 'ok'); FL.render(); }).catch(function (e) { FL.toast(String(e), 'err'); }); };
            $('wp-ecl-def').onclick = function () { m.bk.forEach(function (n) { rates[n] = defEcl(n); }); paint(); };
        };
        paint();
    };

    // ═════ Creditors: payment run planner ═════
    X.plannerHtml = function () {
        var p = X.plan;
        return '<div class="card" id="wp-plan"><h3>Payment run planner <small class="muted">how far the cash you have goes — nothing is sent to Fusion</small></h3>' +
            '<div class="row sm" style="gap:12px;flex-wrap:wrap;align-items:end">' +
            '<label><b>Cash available</b><br><input id="wpp-cash" type="number" min="0" step="1000" style="width:150px" value="' + esc(p.cash) + '" placeholder="amount"></label>' +
            '<label><b>Pay first</b><br><select id="wpp-how"><option value="oldest">the oldest debt (by age bucket)</option><option value="largest">the largest overdue suppliers</option><option value="clear">the smallest — clear the most suppliers</option><option value="prorata">every supplier the same share</option></select></label>' +
            '<label><input type="checkbox" id="wpp-hold"' + (p.hold ? ' checked' : '') + '> skip suppliers with items on hold</label>' +
            '<label><input type="checkbox" id="wpp-cur"' + (p.current ? ' checked' : '') + '> include amounts not yet due</label>' +
            '<span class="grow"></span><span class="sm muted" id="wpp-hint"></span></div><div id="wpp-out" style="margin-top:10px"></div></div>';
    };
    X.planRun = function (m, o) {
        var bk = m.bk.slice().reverse().filter(function (n) { return o.current || n !== 'Current'; });
        var sup = m.ps.filter(function (p) { return p.total > 0.5 && !(o.hold && p.hold > 0); }).map(function (p) {
            var due = {}, owed = 0; bk.forEach(function (n) { var v = Math.max(0, p.b[n] || 0); due[n] = v; owed += v; });
            return { p: p, due: due, owed: owed, pay: 0 };
        }).filter(function (s) { return s.owed > 0.5; });
        var cash = Math.max(0, +o.cash || 0), left = cash, total = sup.reduce(function (s, x) { return s + x.owed; }, 0);
        var payAll = function (s, n, amt) { var a = Math.min(amt, s.due[n]); s.due[n] -= a; s.pay += a; left -= a; };
        if (o.how === 'prorata') { var f = total ? Math.min(1, cash / total) : 0; sup.forEach(function (s) { bk.forEach(function (n) { payAll(s, n, s.due[n] * f); }); }); }
        else if (o.how === 'oldest') { bk.forEach(function (n) { sup.slice().sort(function (a, b) { return b.due[n] - a.due[n]; }).forEach(function (s) { if (left > 0.005) payAll(s, n, left); }); }); }
        else { sup.slice().sort(function (a, b) { return o.how === 'clear' ? a.owed - b.owed : b.owed - a.owed; }).forEach(function (s) { bk.forEach(function (n) { if (left > 0.005) payAll(s, n, left); }); }); }
        sup.forEach(function (s) { s.rest = s.owed - s.pay; s.rest90 = 0; m.bk.forEach(function (n) { if (is90(n)) s.rest90 += s.due[n] != null ? s.due[n] : Math.max(0, s.p.b[n] || 0); }); });
        return { sup: sup, cash: cash, used: cash - left, total: total, cleared: sup.filter(function (s) { return s.pay > 0.5 && s.rest < 0.5; }).length, paid: sup.filter(function (s) { return s.pay > 0.5; }).length,
            rest: sup.reduce(function (s, x) { return s + x.rest; }, 0), rest90: sup.reduce(function (s, x) { return s + x.rest90; }, 0), skipped: o.hold ? m.ps.filter(function (p) { return p.hold > 0 && p.total > 0.5; }).length : 0 };
    };
    X.planner = function (m) {
        var box = $('wp-plan'); if (!box) return;
        $('wpp-how').value = X.plan.how || 'oldest';
        $('wpp-hint').textContent = 'overdue ' + money(m.t.overdue) + ' · not due ' + money(m.t.b.Current || 0) + ' (' + FL.scaleLabel() + ')';
        var go = function () {
            X.plan = { cash: $('wpp-cash').value, how: $('wpp-how').value, hold: $('wpp-hold').checked, current: $('wpp-cur').checked }; FL.lsSet('wcp.plan', X.plan);
            var out = $('wpp-out');
            if (!(+X.plan.cash > 0)) { out.innerHTML = '<p class="sm muted">Type the cash available for the run (in full currency units, e.g. 250000) — the planner shows who gets paid, who is cleared and what stays overdue.</p>'; return; }
            var r = X.planRun(m, X.plan); X.lastPlan = r;
            out.innerHTML = '<div class="sk-cards">' + tile('Paid', money(r.used), 'of ' + money(r.cash) + (r.cash - r.used > 0.5 ? ' · ' + money(r.cash - r.used) + ' left over' : '')) +
                tile('Suppliers paid', r.paid.toLocaleString(), r.cleared + ' cleared in full') + tile('Still owed', money(r.rest), 'of ' + money(r.total) + ' in scope', r.rest > 0.5 ? 'neg' : 'pos') +
                tile('Still over 90 days', money(r.rest90), r.rest90 > 0.5 ? 'supply risk stays' : 'nothing over 90 days left', r.rest90 > 0.5 ? 'neg' : 'pos') +
                (r.skipped ? tile('Skipped (on hold)', r.skipped.toLocaleString(), 'release the holds to pay them', 'neg') : '') + '</div><div id="wpp-grid"></div>';
            FL.grid($('wpp-grid'), [{ label: 'Supplier', get: function (s) { return s.p.name; } }, { label: 'Number', get: function (s) { return s.p.number; } },
                { label: 'In scope', n: 1, get: function (s) { return money(s.owed); }, val: function (s) { return sc(s.owed); } },
                { label: 'Pay', n: 1, html: true, get: function (s) { return s.pay > 0.5 ? '<b>' + money(s.pay) + '</b>' : ''; }, val: function (s) { return sc(s.pay); } },
                { label: 'Still owed', n: 1, get: function (s) { return s.rest > 0.5 ? money(s.rest) : '✓'; }, val: function (s) { return sc(s.rest); } },
                { label: 'Oldest (days)', n: 1, get: function (s) { return s.p.days == null ? '' : s.p.days; }, val: function (s) { return s.p.days; } }],
                r.sup.slice().sort(function (a, b) { return b.pay - a.pay || b.owed - a.owed; }), { id: 'wpp', height: '40vh', csv: 'payment-run-plan.csv', click: function (s) { W.detail('AP', s.p.number, s.p.name); } });
        };
        ['wpp-cash', 'wpp-how', 'wpp-hold', 'wpp-cur'].forEach(function (id) { $(id).onchange = go; });
        $('wpp-cash').onkeyup = function (e) { if (e.key === 'Enter') go(); };
        go();
    };

    // ═════ Inventory ═════
    X.stockModel = function (cur, prev) {
        var s = W.stock(cur), s0 = prev ? W.stock(prev) : null, byValue = s.valued > 0, slob = X.slobRates(), at = (W.data.last.INV || {}).at;
        var m0 = {}; if (s0) s0.itemList.forEach(function (it) { m0[it.org_id + '|' + it.item] = it; });
        var seen = {}, mv = s0 ? { start: byValue ? s0.value : s0.qty, end: byValue ? s.value : s.qty, added: 0, up: 0, down: 0, gone: 0, nNew: 0, nGone: 0 } : null;
        var amt = function (it) { return byValue ? it.value : it.qty; };
        s.itemList.forEach(function (it) {
            var key = it.org_id + '|' + it.item, o = m0[key]; seen[key] = 1;
            it.band = band(it.maxAge); it.prev = o || null;
            it.dQty = o ? it.qty - o.qty : null; it.dVal = o ? it.value - o.value : null;
            it.still = !!o && it.qty > 0 && Math.abs(it.qty - o.qty) < 1e-6;
            it.prov = (it.valued ? it.value : 0) * (slob[it.band] || 0) / 100;
            if (mv) { if (!o) { mv.added += amt(it); mv.nNew++; } else { var dd = amt(it) - amt(o); if (dd > 0) mv.up += dd; else mv.down += dd; } }
        });
        if (s0 && mv) s0.itemList.forEach(function (it) { if (!seen[it.org_id + '|' + it.item]) { mv.gone -= amt(it); mv.nGone++; } });
        // ABC by value (else by quantity): A = the items making the first 80 %, B the next 15 %, C the rest
        var list = s.itemList.slice().sort(function (a, b) { return amt(b) - amt(a); }), tot = list.reduce(function (x, it) { return x + Math.max(0, amt(it)); }, 0), run = 0;
        list.forEach(function (it) { var before = run; run += Math.max(0, amt(it)); it.abc = before < tot * 0.8 ? 'A' : before < tot * 0.95 ? 'B' : 'C'; });
        var abc = {}; ['A', 'B', 'C'].forEach(function (c) { abc[c] = { n: 0, v: 0, age: {} }; });
        list.forEach(function (it) { var a = abc[it.abc]; a.n++; a.v += amt(it); a.age[it.band] = (a.age[it.band] || 0) + amt(it); });
        var still = list.filter(function (it) { return it.still; }), neg = s.rows.filter(function (r) { return r.quantity < 0; });
        var prov = list.reduce(function (x, it) { return x + it.prov; }, 0);
        var old = byValue ? (s.age['181-365 days'] || 0) + (s.age['over a year'] || 0) : (s.ageQty['181-365 days'] || 0) + (s.ageQty['over a year'] || 0), dead = byValue ? s.age['over a year'] || 0 : s.ageQty['over a year'] || 0;
        return { at: at, s: s, s0: s0, byValue: byValue, amt: amt, list: list, tot: tot, abc: abc, mv: mv, still: still, stillV: still.reduce(function (x, it) { return x + amt(it); }, 0), neg: neg, prov: prov, slob: slob, old: old, dead: dead,
            notMaster: s.rows.filter(function (r) { return r.in_master === false; }).length, unvalued: s.lines - s.valued };
    };
    X.stockInsights = function (m) {
        var s = m.s, out = [], u = function (v) { return m.byValue ? money(v) : Math.round(v).toLocaleString() + ' units'; }, glv = (W.glv || {}).INV, dio = kvd('dio');
        if (m.old > 0) out.push({ sev: pctN(m.old, m.tot) > 20 ? 'bad' : '', html: '<b>' + u(m.old) + '</b> (' + pct(m.old, m.tot) + ') of the stock is older than 180 days; <b>' + u(m.dead) + '</b> is over a year old.' });
        if (m.still.length) out.push({ sev: X.gap('INV') < 7 ? '' : 'bad', html: '<b>' + m.still.length + ' item(s)</b> (' + u(m.stillV) + ') have exactly the same quantity as at ' + esc(short(X.cmpAt('INV'))) + ' — no movement at all' + esc(gapTxt('INV')) + '.' });
        if (m.byValue && m.prov > 0) out.push({ html: 'Slow-moving provision at your rates: <b>' + money(m.prov) + '</b> (' + pct(m.prov, s.value) + ' of the stock value).' });
        if (m.abc.A.n) out.push({ html: '<b>' + m.abc.A.n + ' item(s)</b> (' + pct(m.abc.A.n, m.list.length) + ' of items) hold 80 % of the ' + (m.byValue ? 'value' : 'quantity') + ' — count and review these first; ' + m.abc.C.n + ' C items hold 5 %.' });
        var aOld = (m.abc.A.age['181-365 days'] || 0) + (m.abc.A.age['over a year'] || 0);
        if (aOld > 0) out.push({ sev: 'bad', html: '<b>' + u(aOld) + '</b> of the A items is older than 180 days — high value that is not moving.' });
        if (m.neg.length) out.push({ sev: 'bad', html: '<b>' + m.neg.length + ' on-hand line(s)</b> have a negative quantity — a transaction posted before its receipt; fix them in Fusion before the count.' });
        if (m.unvalued > 0 && m.byValue) out.push({ sev: pctN(m.unvalued, s.lines) > 10 ? 'bad' : '', html: m.unvalued.toLocaleString() + ' of ' + s.lines.toLocaleString() + ' lines have no cost and no list price — the value is understated.' });
        if (!m.byValue) out.push({ sev: 'bad', html: 'No value on any line — pick a cost table (checklist › Find cost table & sync) or sync the item master for list prices.' });
        if (m.notMaster) out.push({ html: m.notMaster.toLocaleString() + ' line(s) are not in the synced item master — sync the item master for those organisations.' });
        if (m.mv) out.push({ html: m.mv.nNew + ' item(s) new and ' + m.mv.nGone + ' gone since the comparison; ' + (m.byValue ? 'value' : 'quantity') + ' ' + (m.mv.end >= m.mv.start ? 'up ' : 'down ') + u(Math.abs(m.mv.end - m.mv.start)) + '.' });
        if (glv != null && m.byValue && !W.org) {
            var diff = s.value - glv;
            out.push(Math.abs(diff) < Math.max(1, Math.abs(glv) * 0.005) ? { sev: 'good', html: 'The stock value agrees with the GL inventory accounts (' + money(glv) + ').' }
                : { sev: Math.abs(diff) > Math.abs(glv) * 0.05 ? 'bad' : '', html: 'The stock value (' + s.basis + ') differs from the GL by <b>' + money(diff) + '</b> (GL ' + money(glv) + ') — basis, timing or receipts not yet costed.' });
        }
        if (dio != null && m.byValue && s.value > 0 && m.dead > 0) out.push({ sev: 'good', html: 'Clearing the stock over a year old (' + money(m.dead) + ') would cut DIO by about <b>' + Math.round(dio * m.dead / s.value) + ' days</b> (from ' + Math.round(dio) + ').' });
        return out;
    };
    X.stockPage = function (el) {
        var d = W.data;
        if (!d || d.empty || !d.last.INV) return X.empty(el, 'INV');
        var cmp = X.cmpAt('INV');
        return Promise.all([cmp ? X.rowsAt('INV', cmp) : Promise.resolve(null), X.trend('INV')]).then(function (r) {
            var m = X.stockModel(d.INV, r[0]), s = m.s, u = function (v) { return m.byValue ? money(v) : Math.round(v).toLocaleString(); }, glv = (W.glv || {}).INV, dio = kvd('dio');
            m.insights = X.stockInsights(m); X.last.INV = m;
            var dv = m.s0 ? delta(m.byValue ? s.value : s.qty, m.byValue ? m.s0.value : m.s0.qty, true) : { s: 'no comparison', c: '' };
            if (m.s0 && m.byValue && (m.s0.basis !== s.basis || Math.abs(m.s0.valued - s.valued) > s.lines * 0.1)) dv = { s: dv.s + ' · valuation basis changed (was ' + m.s0.basis + ', ' + m.s0.valued + ' lines valued)', c: '' };
            var tiles = '<div class="sk-cards">' +
                tile(m.byValue ? 'Stock value' : 'Stock quantity', m.byValue ? money(s.value) : Math.round(s.qty).toLocaleString(), dv.s, dv.c, m.byValue ? 'Basis: ' + s.basis : '') +
                tile('Older than 180 days', u(m.old), pct(m.old, m.tot) + ' of the stock', pctN(m.old, m.tot) > 20 ? 'neg' : '') +
                tile('Over a year', u(m.dead), pct(m.dead, m.tot), m.dead > 0 ? 'neg' : '') +
                tile('Not moved', m.still.length.toLocaleString() + ' item(s)', m.s0 ? u(m.stillV) + ' — same quantity as at the comparison' : 'needs a comparison snapshot', m.still.length ? 'neg' : '') +
                (m.byValue ? tile('Slow-moving provision', money(m.prov), pct(m.prov, s.value) + ' at your rates — table below') : '') +
                tile('DIO (GL)', dio == null ? '—' : Math.round(dio) + ' d', 'days stock sits') +
                tile('GL inventory', glv == null ? '—' : money(glv), glv == null ? 'no balance sheet line' : W.org ? 'clear the organisation to compare' : m.byValue ? 'difference ' + money(s.value - glv) : 'no stock value to compare', glv == null || W.org || !m.byValue ? '' : Math.abs(s.value - glv) < Math.max(1, Math.abs(glv) * 0.005) ? 'pos' : 'neg') +
                tile('Items', m.list.length.toLocaleString(), s.lines.toLocaleString() + ' lines · ' + Object.keys(s.orgs).length + ' organisation(s)') +
                tile('Valued lines', pct(s.valued, s.lines), s.basis, s.valued < s.lines * 0.9 ? 'neg' : '') + '</div>';
            var heat = function () {
                var max = 0; ['A', 'B', 'C'].forEach(function (c) { AGE.forEach(function (a) { max = Math.max(max, m.abc[c].age[a[1]] || 0); }); });
                return '<table class="t"><thead><tr><th>Class</th><th class="n">Items</th>' + AGE.map(function (a) { return '<th class="n">' + a[1] + '</th>'; }).join('') + '<th class="n">Total</th></tr></thead><tbody>' +
                    ['A', 'B', 'C'].map(function (c) {
                        var x = m.abc[c];
                        return '<tr><td><b>' + c + '</b> <span class="sm muted">' + (c === 'A' ? 'first 80 %' : c === 'B' ? 'next 15 %' : 'last 5 %') + '</span></td><td class="n">' + x.n.toLocaleString() + '</td>' +
                            AGE.map(function (a, i) { var v = x.age[a[1]] || 0, al = max ? v / max : 0, col = i < 2 ? '22,163,74' : '220,38,38'; return '<td class="n" style="background:rgba(' + col + ',' + (0.08 + al * 0.45).toFixed(2) + ')">' + (v ? u(v) : '') + '</td>'; }).join('') +
                            '<td class="n"><b>' + u(x.v) + '</b></td></tr>';
                    }).join('') + '</tbody></table>';
            };
            el.innerHTML = X.frame('INV') + tiles +
                '<div class="sk-grid"><div class="card"><h3>What stands out</h3>' + insightsHtml(m.insights) + '</div>' +
                '<div class="card"><h3>Stock age over the snapshots <small class="muted">' + (m.byValue ? 'value at item cost' : 'quantity') + ' by days since the oldest receipt</small></h3><div class="sk-ch" style="height:250px"><canvas id="wp-trend"></canvas></div></div></div>' +
                '<div class="sk-grid"><div class="card"><h3>ABC × age <small class="muted">where the money sits and how old it is</small></h3>' + heat() + '<div class="sk-ch" style="height:190px;margin-top:8px"><canvas id="wp-abc"></canvas></div></div>' +
                (m.mv ? '<div class="card"><h3>Movement <small class="muted">from ' + esc(short(cmp)) + ' to ' + esc(short(m.at)) + '</small></h3><div class="sk-ch" style="height:250px"><canvas id="wp-bridge"></canvas></div></div>' : '') +
                (m.byValue ? '<div class="card" id="wp-slob"></div>' : '') + '<div class="card"><h3>By organisation</h3><div id="wp-org-grid"></div></div></div>' +
                '<div class="card"><h3>Stock to review <small class="muted">not moved since the comparison, older than 180 days or negative — biggest first · click for the on-hand lines</small></h3><div id="wp-review"></div></div>' +
                '<div class="card"><h3>Stock explorer <small class="muted">group by organisation, subinventory, item type or any item flexfield</small></h3><div id="wc-body"></div></div>' +
                '<details class="card" style="margin-top:12px"><summary><b>Working capital checklist</b></summary><div id="wc-md"></div></details>';
            X.wireFrame(el, 'INV'); W.md();
            X.stockGrids(m);
            W.invBody($('wc-body'));
            if (m.byValue) X.slobCard(m);
            X.stockCharts(m, r[1]);
        });
    };
    X.stockGrids = function (m) {
        var u = function (v) { return m.byValue ? money(v) : Math.round(v).toLocaleString(); }, open = function (it) { W.detail('INV', it.item, it.item + ' ' + (it.desc || '')); };
        var review = m.list.filter(function (it) { return it.still || it.maxAge > 180 || it.qty < 0; });
        review.forEach(function (it) { it.why = [it.qty < 0 ? 'negative' : '', it.still ? 'not moved' : '', it.maxAge > 365 ? 'over a year' : it.maxAge > 180 ? 'over 180 days' : ''].filter(Boolean).join(' · '); });
        FL.grid($('wp-review'), [{ label: 'Item', key: 'item' }, { label: 'Description', key: 'desc' }, { label: 'Organisation', key: 'org' }, { label: 'ABC', key: 'abc' },
            { label: 'Quantity', n: 1, get: function (it) { return (Math.round(it.qty * 100) / 100).toLocaleString() + ' ' + (it.uom || ''); }, val: function (it) { return it.qty; } },
            { label: m.byValue ? 'Value' : 'Value', n: 1, get: function (it) { return it.valued ? money(it.value) : '—'; }, val: function (it) { return it.valued ? sc(it.value) : null; } },
            { label: 'Oldest (days)', n: 1, key: 'maxAge' },
            { label: 'Δ quantity', n: 1, get: function (it) { return it.dQty == null ? (m.s0 ? 'new' : '') : (Math.round(it.dQty * 100) / 100).toLocaleString(); }, val: function (it) { return it.dQty; } },
            { label: 'Provision', n: 1, get: function (it) { return it.prov ? money(it.prov) : ''; }, val: function (it) { return sc(it.prov); } },
            { label: 'Why', html: true, get: function (it) { return '<b class="neg">' + esc(it.why) + '</b>'; }, val: function (it) { return it.why; } }],
            review, { id: 'wp-review', height: '50vh', csv: 'stock-to-review.csv', click: open, empty: 'Nothing old, still or negative.' });
        var orgs = {};
        m.list.forEach(function (it) {
            var o = orgs[it.org_id] = orgs[it.org_id] || { org: it.org, v: 0, old: 0, items: 0, still: 0, prov: 0, prev: 0 };
            o.v += m.amt(it); o.items++; if (it.maxAge > 180) o.old += m.amt(it); if (it.still) o.still++; o.prov += it.prov;
        });
        if (m.s0) m.s0.itemList.forEach(function (it) { if (orgs[it.org_id]) orgs[it.org_id].prev += m.amt(it); });
        FL.grid($('wp-org-grid'), [{ label: 'Organisation', key: 'org' }, { label: m.byValue ? 'Value' : 'Quantity', n: 1, get: function (o) { return u(o.v); }, val: function (o) { return sc(o.v); } }]
            .concat(m.s0 ? [{ label: 'Δ', n: 1, html: true, get: function (o) { var x = o.v - o.prev; return '<span class="' + (x > 0 ? 'neg' : x < 0 ? 'pos' : '') + '">' + (x > 0 ? '+' : '') + u(x) + '</span>'; }, val: function (o) { return sc(o.v - o.prev); } }] : [])
            .concat([{ label: '> 180 days', n: 1, get: function (o) { return u(o.old) + ' · ' + pct(o.old, o.v); }, val: function (o) { return o.v ? Math.round(o.old / o.v * 1000) / 10 : 0; } },
                { label: 'Items', n: 1, key: 'items' }, { label: 'Not moved', n: 1, key: 'still' }].concat(m.byValue ? [{ label: 'Provision', n: 1, get: function (o) { return money(o.prov); }, val: function (o) { return sc(o.prov); } }] : [])),
            Object.keys(orgs).map(function (k) { return orgs[k]; }).sort(function (a, b) { return b.v - a.v; }), { id: 'wp-orgs', height: '30vh', csv: 'stock-by-organisation.csv',
                click: function (o) { var id = Object.keys(orgs).filter(function (k) { return orgs[k] === o; })[0]; W.org = id; FL.lsSet('wc.org', id); FL.render(); } });
    };
    X.slobCard = function (m) {
        var box = $('wp-slob'); if (!box) return;
        var rates = X.slobRates(), admin = FL.who && FL.who.admin;
        var paint = function () {
            var tot = 0, rows = AGE.map(function (a) { var v = Math.max(0, m.s.age[a[1]] || 0), p = v * (rates[a[1]] || 0) / 100; tot += p; return { n: a[1], v: v, p: p }; });
            box.innerHTML = '<h3>Slow-moving provision <small class="muted">stock value by age × rate — set the rates from your write-off and clearance history</small></h3>' +
                '<table class="t"><thead><tr><th>Age</th><th class="n">Value</th><th class="n">Rate %</th><th class="n">Provision</th></tr></thead><tbody>' +
                rows.map(function (r) { return '<tr><td>' + esc(r.n) + '</td><td class="n">' + money(r.v) + '</td><td class="n"><input type="number" step="1" min="0" max="100" data-slob="' + esc(r.n) + '" value="' + (rates[r.n] || 0) + '" style="width:70px;text-align:right"></td><td class="n">' + money(r.p) + '</td></tr>'; }).join('') +
                '</tbody><tfoot><tr><th>Total</th><th class="n">' + money(m.s.value) + '</th><th class="n">' + pct(tot, m.s.value) + '</th><th class="n">' + money(tot) + '</th></tr></tfoot></table>' +
                '<div class="row sm" style="margin-top:6px;gap:8px"><span class="muted">Age = days since the oldest receipt of the line. Compare with the inventory provision in the GL.</span><span class="grow"></span>' +
                (admin ? '<button class="btn sm" id="wp-slob-save"><i class="fa-solid fa-floppy-disk"></i> Save rates</button>' : '') + '</div>';
            box.querySelectorAll('[data-slob]').forEach(function (i) { i.onchange = function () { rates[i.dataset.slob] = Math.max(0, Math.min(100, +i.value || 0)); paint(); }; });
            if ($('wp-slob-save')) $('wp-slob-save').onclick = function () { FL.config.wc = Object.assign({}, FL.config.wc || {}, { slob: rates }); FL.saveConfig().then(function () { FL.toast('Provision rates saved', 'ok'); FL.render(); }).catch(function (e) { FL.toast(String(e), 'err'); }); };
        };
        paint();
    };
    X.stockCharts = function (m, trend) {
        var snaps = {}, order = [], anyV = trend.some(function (r) { return r.nv > 0; });
        trend.forEach(function (r) { if (W.org && r.org_id !== W.org) return; if (!snaps[r.at]) { snaps[r.at] = {}; order.push(r.at); } snaps[r.at][r.band] = (snaps[r.at][r.band] || 0) + (anyV ? r.v || 0 : r.q || 0); });
        order = order.slice(-12);
        FL.chart('wp-trend', { type: 'bar', data: { labels: order.map(function (a) { return String(a).slice(5, 16); }),
            datasets: AGE.map(function (a, i) { return { label: a[1], data: order.map(function (x) { return snaps[x][a[1]] || 0; }), backgroundColor: ['#16a34a', '#84cc16', '#f59e0b', '#dc2626'][i], stack: 's' }; }) },
            options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }, title: { display: order.length < 2, text: 'The trend appears from the second sync' } }, scales: { x: { stacked: true }, y: Object.assign(anyV ? FL.moneyAxis() : {}, { stacked: true }) } } });
        // Pareto curve: share of items (x) vs share of value (y)
        var n = m.list.length, pts = [], run = 0, step = Math.max(1, Math.floor(n / 60));
        m.list.forEach(function (it, i) { run += Math.max(0, m.amt(it)); if (i % step === 0 || i === n - 1) pts.push({ x: Math.round((i + 1) / n * 1000) / 10, y: Math.round(run / (m.tot || 1) * 1000) / 10 }); });
        FL.chart('wp-abc', { type: 'line', data: { datasets: [{ label: 'Cumulative share', data: [{ x: 0, y: 0 }].concat(pts), borderColor: FL.PAL.act, pointRadius: 0, fill: { target: 'origin', above: 'rgba(29,78,216,.07)' }, tension: 0.2 }] },
            options: { maintainAspectRatio: false, parsing: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return c.parsed.x + ' % of items → ' + c.parsed.y + ' % of ' + (m.byValue ? 'value' : 'quantity'); } } } },
                scales: { x: { type: 'linear', min: 0, max: 100, title: { display: true, text: '% of items', font: { size: 10 } } }, y: { min: 0, max: 100, ticks: { callback: function (v) { return v + '%'; } } } } } });
        if (m.mv) FL.waterfall('wp-bridge', [{ label: 'Comparison', value: m.mv.start, kind: 'start' }, { label: 'New items', value: m.mv.added, kind: 'step' }, { label: 'Increased', value: m.mv.up, kind: 'step' },
            { label: 'Decreased', value: m.mv.down, kind: 'step' }, { label: 'Gone', value: m.mv.gone, kind: 'step' }, { label: 'Now', value: m.mv.end, kind: 'end' }]);
    };

    // ═════ Excel and the Copilot's view of the page ═════
    X.excel = function (k) {
        var m = X.last[k]; if (!window.ExcelJS || !m) return;
        var wb = new ExcelJS.Workbook(), fmt = '#,##0;(#,##0);"–"', ws = wb.addWorksheet('Findings');
        ws.addRow([NAME[k] + ' as of ' + short(m.at) + (X.cmpAt(k) ? ' — compared with ' + short(X.cmpAt(k)) : '')]).font = { bold: true, size: 13 };
        m.insights.forEach(function (i) { ws.addRow([String(i.html).replace(/<[^>]+>/g, '')]); }); ws.getColumn(1).width = 140;
        if (k === 'INV') {
            var it = wb.addWorksheet('Items');
            it.addRow(['Organisation', 'Item', 'Description', 'ABC', 'Quantity', 'UOM', 'Value', 'Basis', 'Oldest (days)', 'Age band', 'Not moved', 'Δ quantity', 'Provision']).font = { bold: true };
            m.list.forEach(function (x) { it.addRow([x.org, x.item, x.desc, x.abc, x.qty, x.uom, x.valued ? x.value : null, x.basis, x.maxAge, x.band, x.still ? 'yes' : '', x.dQty, x.prov]); });
            [7, 13].forEach(function (c) { it.getColumn(c).numFmt = fmt; }); it.getColumn(3).width = 40; it.views = [{ state: 'frozen', ySplit: 1 }];
        } else {
            var ps = wb.addWorksheet(k === 'AR' ? 'Customers' : 'Suppliers');
            ps.addRow(['Name', 'Number', 'Total', 'Δ total', 'Overdue', 'Δ overdue', '> 90 days'].concat(m.bk).concat(['Oldest due', 'Oldest (days)', 'Items', 'On hold', 'Expected loss', 'Next step'])).font = { bold: true };
            m.ps.forEach(function (p) { ps.addRow([p.name, p.number, p.total, p.dTotal, p.overdue, p.dOver, p.o90].concat(m.bk.map(function (n) { return p.b[n] || 0; })).concat([p.oldest, p.days, p.items, p.hold, k === 'AR' ? p.ecl : null, X.step(k, p)])); });
            for (var c = 3; c <= 7 + m.bk.length; c++) ps.getColumn(c).numFmt = fmt;
            ps.getColumn(1).width = 40; ps.views = [{ state: 'frozen', ySplit: 1 }];
            if (k === 'AP' && X.lastPlan) {
                var pl = wb.addWorksheet('Payment run plan');
                pl.addRow(['Supplier', 'Number', 'In scope', 'Pay', 'Still owed']).font = { bold: true };
                X.lastPlan.sup.filter(function (s) { return s.pay > 0.5; }).forEach(function (s) { pl.addRow([s.p.name, s.p.number, s.owed, s.pay, s.rest]); });
                [3, 4, 5].forEach(function (c) { pl.getColumn(c).numFmt = fmt; }); pl.getColumn(1).width = 40;
            }
        }
        wb.xlsx.writeBuffer().then(function (buf) { FL.download(NAME[k] + ' ' + String(m.at || '').slice(0, 10) + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); });
    };
    /** What the Copilot sees of the page on screen */
    X.context = function () {
        var k = X.KIND[FL.tab], m = X.last[k]; if (!m) return null;
        var o = { page: NAME[k], asOf: m.at, comparedWith: X.cmpAt(k), filter: k === 'INV' ? (W.org ? W.orgName(W.org) : 'all organisations') : (W.bu ? W.buName(W.bu) : 'all business units'),
            findings: m.insights.map(function (i) { return String(i.html).replace(/<[^>]+>/g, ''); }) };
        if (k === 'INV') {
            o.value = m.byValue ? Math.round(m.s.value) : null; o.basis = m.s.basis; o.older180 = Math.round(m.old); o.overAYear = Math.round(m.dead); o.provision = Math.round(m.prov);
            o.abc = { A: m.abc.A.n, B: m.abc.B.n, C: m.abc.C.n }; o.notMoved = m.still.slice(0, 20).map(function (it) { return [it.org, it.item, it.desc, Math.round(it.qty), Math.round(it.value)]; });
            o.biggest = m.list.slice(0, 20).map(function (it) { return [it.org, it.item, it.desc, Math.round(it.qty), Math.round(it.value), it.maxAge]; });
        } else {
            o.total = Math.round(m.t.total); o.overdue = Math.round(m.t.overdue); o.over90 = Math.round(m.t.old90); o.buckets = m.t.b;
            if (k === 'AR') o.expectedCreditLoss = Math.round(m.ecl);
            o.worklist = m.ps.filter(function (p) { return p.overdue > 0.5; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 25).map(function (p) { return [p.name, p.number, Math.round(p.overdue), Math.round(p.o90), p.days, p.dOver == null ? null : Math.round(p.dOver), X.step(k, p)]; });
            o.worklistColumns = ['name', 'number', 'overdue', 'over 90', 'oldest days', 'change in overdue', 'next step'];
            if (k === 'AP' && X.lastPlan) o.paymentPlan = { cash: X.lastPlan.cash, paid: Math.round(X.lastPlan.used), suppliersPaid: X.lastPlan.paid, stillOwed: Math.round(X.lastPlan.rest) };
        }
        o.howToQuery = 'Snapshots in DuckDB: fin_wc_parties (kind AR/AP, snapshot_at, bu_id, party_number, party_name, bucket, items, amount, oldest_due, on_hold), fin_wc_stock (snapshot_at, org_id, item_number, subinventory, quantity, unit_cost, value, age_days), fin_items, fin_wc_snapshots.';
        return o;
    };
    X.prompts = function (k) {
        return {
            AR: ['Which 10 customers should we call this week, and what should we say to each?', 'Why did overdue change since the comparison — which customers drove it?', 'Is our expected credit loss provision reasonable for this ageing? Suggest loss rates.', 'Draft a firm but polite reminder for the customers over 90 days', 'How concentrated is our credit risk, and what limits would you set?', 'Write a short paragraph on receivables for the board pack'],
            AP: ['Which suppliers should we pay first with the cash we have, and why?', 'Which suppliers are at risk of stopping supply?', 'What holds are blocking payments, and how much money do they hold up?', 'Are we paying too early anywhere? Where can we hold cash longer within terms?', 'Why did creditors change since the comparison?', 'Write a short paragraph on payables for the board pack'],
            INV: ['Which stock should we clear first, and what is it worth?', 'Which A items are older than 180 days, and why might they be stuck?', 'Is the slow-moving provision reasonable? Suggest rates from the age profile.', 'Which organisation has the worst stock age, and what should it do?', 'Which items have not moved since the comparison?', 'Write a short paragraph on inventory for the board pack']
        }[k];
    };

    FL.TABS.debtors = { render: function (el) { return X.prep().then(function () { return X.partyPage(el, 'AR'); }); } };
    FL.TABS.creditors = { render: function (el) { return X.prep().then(function () { return X.partyPage(el, 'AP'); }); } };
    FL.TABS.inventory = { render: function (el) { return X.prep().then(function () { return X.stockPage(el); }); } };
})();
