/* Finance Lens — customer / supplier history: the drill from Debtors, Creditors and Working capital. A header (profile,
   address, credit limit, KPIs) over tabs Overview · Open items · Invoices · Payments · Credit notes · Paid invoices ·
   Adjustments (AR) / Holds (AP). Host finWcHistory reads it from this PC (DuckDB fin_wc_history) when it was read before,
   else from Fusion (and keeps it); Refresh reads Fusion again. Open items can also be read live (W.detail's finWcDetail). */
(function () {
    var W = FL.wc, X = FL.wcp;
    var H = X.hist = { months: FL.ls('wcp.hmonths', 24), cur: null };
    var liveDetail = W.detail;
    W.detailLive = liveDetail;
    // every AR / AP drill opens the history; stock lines keep the live on-hand lines
    W.detail = function (kind, party, title) { if (kind === 'AR' || kind === 'AP') return H.open(kind, party, title); return liveDetail.apply(this, arguments); };

    var num = function (v) { var n = typeof v === 'number' ? v : parseFloat(v); return isNaN(n) ? 0 : n; };
    var amt = function (v, dp) { return v == null || v === '' ? '' : FINE.fmt(num(v), 'num', { decimals: dp == null ? 2 : dp }); };
    var k0 = function (v) { return FINE.fmt(num(v), 'num', { decimals: 0 }); };
    var day = function (s) { var t = Date.parse(String(s || '').slice(0, 10)); return isNaN(t) ? null : t; };
    var ago = X.ago = function (at) {
        var t = Date.parse(String(at || '').replace(' ', 'T')); if (isNaN(t)) return '';
        var m = Math.round((Date.now() - t) / 60000);
        return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' day' + (Math.round(m / 1440) === 1 ? '' : 's') + ' ago';
    };
    var NUMCOL = /AMOUNT|ORIGINAL|REMAINING|PAID$|UNAPPLIED|APPLIED|LIMIT|^DAYS|_DAYS|DAYS_/;
    var TABS = {
        AR: [['overview', 'Overview'], ['open', 'Open items'], ['invoices', 'Invoices'], ['payments', 'Payments'], ['creditnotes', 'Credit notes'], ['applications', 'Paid invoices'], ['adjustments', 'Adjustments'], ['sql', 'Sources']],
        AP: [['overview', 'Overview'], ['open', 'Open items'], ['invoices', 'Invoices'], ['payments', 'Payments'], ['creditnotes', 'Credit / debit memos'], ['applications', 'Paid invoices'], ['holds', 'Holds'], ['sql', 'Sources']]
    };

    /** rows of a section as objects (column names as Fusion returned them) */
    H.rows = function (name) {
        var s = ((H.cur || {}).data || {}).sections || {}, x = s[name];
        if (!x || !x.ok) return [];
        return x.rows.map(function (r) { var o = {}; x.columns.forEach(function (c, i) { o[c] = r[i]; }); return o; });
    };

    H.open = function (kind, party, title, opts) {
        H.close();
        H.cur = { kind: kind, party: party, title: title || party, tab: FL.ls('wcp.htab', 'overview'), data: null };
        var ov = document.createElement('div'); ov.className = 'ph-ov'; ov.id = 'ph-ov';
        ov.innerHTML = '<div class="ph-box"><div class="ph-head" id="ph-head"><div class="row"><h2 style="margin:0"><i class="fa-solid ' + (kind === 'AR' ? 'fa-user-tie' : 'fa-truck-field') + '"></i> ' + esc(title || party) + '</h2>' +
            '<span class="grow"></span><button class="icon ph-x" id="ph-x" title="Close (Esc)">✕</button></div><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading the history…</div></div><div class="ph-body" id="ph-body"></div></div>';
        document.body.appendChild(ov);
        ov.onclick = function (e) { if (e.target === ov) H.close(); };
        $('ph-x').onclick = H.close;
        H.key = function (e) { if (e.key === 'Escape' && $('ph-ov')) { e.stopPropagation(); H.close(); } };
        document.addEventListener('keydown', H.key, true);
        return H.load(!!(opts && opts.refresh));
    };
    H.close = function () {
        (H.charts || []).forEach(function (c) { try { c.destroy(); } catch (e) { /* gone */ } }); H.charts = [];
        if ($('ph-ov')) $('ph-ov').remove();
        if (H.key) document.removeEventListener('keydown', H.key, true);
        H.cur = null;
    };
    H.load = function (refresh) {
        var c = H.cur, lines = [];
        if (refresh && $('ph-src')) $('ph-src').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Reading Fusion…';
        var bz = refresh || !c.data ? null : null;
        return FL.call('finWcHistory', { kind: c.kind, party: c.party, pod: W.cfg().pod || '', months: H.months, refresh: !!refresh }, 11 * 60000, function (m) {
            if (!m || m.charAt(0) === '\u0001') return; lines.push(m);
            var e = $('ph-prog'); if (e) e.textContent = m.trim(); else { var hb = $('ph-head'); if (hb && hb.querySelector('.empty')) hb.querySelector('.empty').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> ' + esc(m.trim()); }
        }).then(function (r) {
            if (H.cur !== c) return;
            if (!r.ok) throw r.error;
            c.data = r; void bz;
            H.paint();
        }).catch(function (e) {
            if (H.cur !== c) return;
            var hb = $('ph-head'); if (hb) hb.insertAdjacentHTML('beforeend', '<div class="callout bad">' + esc(String(e && e.message || e)) + '</div>');
            var em = hb && hb.querySelector('.empty'); if (em) em.remove();
        });
    };

    /** Everything the header and the overview need, from the sections */
    H.model = function () {
        var c = H.cur, ar = c.kind === 'AR', today = Date.now(), y1 = today - 365 * 864e5;
        var inv = H.rows('invoices'), cn = H.rows('creditnotes'), pay = H.rows('payments'), app = H.rows('applications');
        var rem = function (r) { return r.REMAINING_LEDGER != null && r.REMAINING_LEDGER !== '' ? num(r.REMAINING_LEDGER) : num(r.REMAINING); };
        var open = inv.concat(cn).filter(function (r) { return Math.abs(rem(r)) > 0.005; });
        var m = { inv: inv, cn: cn, pay: pay, app: app, open: open, total: 0, overdue: 0, o90: 0, n90: 0, invoiced12: 0, nInv12: 0, paid12: 0, credits: 0, unapplied: 0 };
        open.forEach(function (r) {
            var v = rem(r), d = day(r.DUE_DATE), late = d == null ? 0 : Math.floor((today - d) / 864e5);
            m.total += v; if (late > 0) m.overdue += v; if (late > 90) { m.o90 += v; m.n90++; }
            if (v < 0) m.credits += v;
        });
        inv.forEach(function (r) { var t = day(r.TRX_DATE); if (t != null && t >= y1) { m.invoiced12 += num(r.ORIGINAL); m.nInv12++; } });
        // collected = cash applied to this party's items (receipts can come from another account, e.g. a head office paying for its
        // branches); credit-note applications are not cash. Without applications: the receipts' amount applied here, else their amount.
        var cash = app.filter(function (r) { return r.APPLICATION_TYPE !== 'CM' && r.CLASS !== 'CM'; });
        if (cash.length) cash.forEach(function (r) { var t = day(r.APPLY_DATE); if (t != null && t >= y1) m.paid12 += num(r.AMOUNT_APPLIED); });
        else pay.forEach(function (r) { var t = day(r.RECEIPT_DATE || r.PAYMENT_DATE); if (t != null && t >= y1) m.paid12 += num(r.APPLIED_HERE != null && r.APPLIED_HERE !== '' ? r.APPLIED_HERE : r.AMOUNT); });
        pay.forEach(function (r) { m.unapplied += num(r.UNAPPLIED); });
        var lastPay = pay.slice().sort(function (a, b) { return (day(b.RECEIPT_DATE || b.PAYMENT_DATE) || 0) - (day(a.RECEIPT_DATE || a.PAYMENT_DATE) || 0); })[0];
        if (lastPay) m.lastPay = { date: lastPay.RECEIPT_DATE || lastPay.PAYMENT_DATE, amount: num(lastPay.APPLIED_HERE != null && lastPay.APPLIED_HERE !== '' ? lastPay.APPLIED_HERE : lastPay.AMOUNT), by: lastPay.PAID_BY };
        else if (cash.length) { var ld = cash.reduce(function (x, r) { return r.APPLY_DATE > x ? r.APPLY_DATE : x; }, ''); m.lastPay = { date: ld, amount: cash.filter(function (r) { return r.APPLY_DATE === ld; }).reduce(function (x, r) { return x + num(r.AMOUNT_APPLIED); }, 0) }; }
        else m.lastPay = null;
        m.cn12 = 0; m.nCn12 = 0; cn.forEach(function (r) { var t = day(r.TRX_DATE); if (t != null && t >= y1) { m.cn12 += Math.abs(num(r.ORIGINAL)); m.nCn12++; } });
        m.adj12 = 0; H.rows('adjustments').forEach(function (r) { var t = day(r.APPLY_DATE); if (t != null && t >= y1) m.adj12 += Math.abs(num(r.AMOUNT)); });
        // days to pay / late, weighted by the amount applied (last 12 months, and the 12 before for the trend)
        var w = function (from, to, key) { var s = 0, n = 0; app.forEach(function (r) { var t = day(r.APPLY_DATE), a = Math.abs(num(r.AMOUNT_APPLIED)); if (t == null || t < from || t >= to || r[key] == null || r[key] === '') return; s += num(r[key]) * a; n += a; }); return n ? s / n : null; };
        m.dtp = w(y1, today + 864e5, 'DAYS_TO_PAY'); m.dtpPrev = w(y1 - 365 * 864e5, y1, 'DAYS_TO_PAY');
        m.late = w(y1, today + 864e5, 'DAYS_LATE'); m.latePrev = w(y1 - 365 * 864e5, y1, 'DAYS_LATE');
        var cr = H.rows('credit'); m.limit = cr.length ? cr.reduce(function (s, r) { return Math.max(s, num(r.CREDIT_LIMIT)); }, 0) : null; m.limitCcy = cr.length ? cr[0].CURRENCY : '';
        m.holds = ar ? 0 : H.rows('holds').filter(function (r) { return !r.RELEASE; }).length;
        m.posOpen = open.reduce(function (x, r) { var v = rem(r); return x + (v > 0 ? v : 0); }, 0);
        // by month: invoiced vs paid (applications when there are any, else payments)
        var months = {}, key = function (s) { return String(s || '').slice(0, 7); };
        inv.forEach(function (r) { var k = key(r.TRX_DATE); if (k) (months[k] = months[k] || { inv: 0, paid: 0, dtp: [0, 0] }).inv += num(r.ORIGINAL); });
        (app.length ? app : pay).forEach(function (r) { var k = key(r.APPLY_DATE || r.RECEIPT_DATE || r.PAYMENT_DATE); if (!k) return; var x = months[k] = months[k] || { inv: 0, paid: 0, dtp: [0, 0] }; var a = Math.abs(num(r.AMOUNT_APPLIED != null ? r.AMOUNT_APPLIED : r.AMOUNT)); x.paid += a; if (r.DAYS_TO_PAY != null && r.DAYS_TO_PAY !== '') { x.dtp[0] += num(r.DAYS_TO_PAY) * a; x.dtp[1] += a; } });
        m.months = Object.keys(months).sort().slice(-24).map(function (k) { return { k: k, inv: months[k].inv, paid: months[k].paid, dtp: months[k].dtp[1] ? months[k].dtp[0] / months[k].dtp[1] : null }; });
        // ageing of the open items
        m.age = [['Not due', 0], ['1-30', 0], ['31-60', 0], ['61-90', 0], ['91-180', 0], ['>180', 0]];
        open.forEach(function (r) { var d = day(r.DUE_DATE), l = d == null ? 0 : Math.floor((today - d) / 864e5), i = l <= 0 ? 0 : l <= 30 ? 1 : l <= 60 ? 2 : l <= 90 ? 3 : l <= 180 ? 4 : 5; m.age[i][1] += rem(r); });
        return m;
    };
    // ═════ customer rating: six factors from invoices, credit notes, payments and the open items → 0-100 and a grade ═════
    H.GRADES = [[85, 'A', 'Excellent', '#16a34a', 'Reliable payer — a higher credit limit or better terms can be considered.'],
        [70, 'B', 'Good', '#65a30d', 'Standard terms; keep the usual reminders.'],
        [55, 'C', 'Watch', '#ca8a04', 'Monitor: remind before the due date and review the credit limit.'],
        [40, 'D', 'Risky', '#ea580c', 'Tighten: lower the limit, shorten the terms or ask for a deposit; escalate the items over 90 days.'],
        [-1, 'E', 'High risk', '#dc2626', 'Stop further credit (cash before delivery) until the overdue is cleared; consider a provision.']];
    H.rate = function (m) {
        var cl = function (x) { return Math.max(0, Math.min(100, x)); }, pc = function (x) { return Math.round(x * 100) + ' %'; }, f = [];
        f.push({ k: 'Paying on time', w: 30, s: m.late == null ? 60 : cl(100 - Math.max(0, m.late) * 2.5), nodata: m.late == null,
            v: m.late == null ? 'no payments in the window' : m.late > 0 ? Math.round(m.late) + ' days late on average' : Math.round(-m.late) + ' days early on average',
            why: 'Days between the due date and the payment, weighted by the amount paid (last 12 months). 0 days late scores 100, 40 days late scores 0.' });
        var od = m.posOpen ? Math.max(0, m.overdue) / m.posOpen : 0, o90 = m.posOpen ? Math.max(0, m.o90) / m.posOpen : 0;
        f.push({ k: 'Overdue now', w: 20, s: m.posOpen ? cl(100 - od * 60 - o90 * 100) : 100, v: m.posOpen ? pc(od) + ' overdue · ' + pc(o90) + ' over 90 days' : 'nothing open',
            why: 'Share of the open balance that is past due, and the share over 90 days (counted twice as heavy).' });
        var cr = m.invoiced12 ? m.paid12 / m.invoiced12 : null;
        f.push({ k: 'Collected vs invoiced', w: 15, s: cr == null ? 60 : cl((cr - 0.5) / 0.45 * 100), nodata: cr == null, v: cr == null ? 'nothing invoiced in 12 months' : pc(cr) + ' of the last 12 months collected',
            why: 'Cash received against what was invoiced in the last 12 months; 95 % or more scores 100, 50 % or less scores 0.' });
        var dr = m.invoiced12 ? (m.cn12 + m.adj12) / m.invoiced12 : null;
        f.push({ k: 'Credit notes & write-offs', w: 15, s: dr == null ? 60 : cl(100 - (dr - 0.02) / 0.18 * 100), nodata: dr == null,
            v: dr == null ? 'nothing invoiced in 12 months' : pc(dr) + ' of invoiced (' + m.nCn12 + ' credit note' + (m.nCn12 === 1 ? '' : 's') + (m.adj12 ? ', ' + k0(m.adj12) + ' adjusted' : '') + ')',
            why: 'Credit notes and adjustments as a share of invoices — returns, disputes and write-offs. Up to 2 % scores 100, 20 % or more scores 0.' });
        var tr = m.dtp != null && m.dtpPrev != null ? m.dtp - m.dtpPrev : null;
        f.push({ k: 'Trend', w: 10, s: tr == null ? 60 : cl(100 - (tr + 5) / 25 * 100), nodata: tr == null,
            v: tr == null ? 'no year before to compare' : (tr > 0 ? Math.round(tr) + ' days slower' : Math.round(-tr) + ' days faster') + ' than the year before',
            why: 'Days to pay this year against the year before: 5 days faster or better scores 100, 20 days slower scores 0.' });
        var u = m.limit ? m.total / m.limit : null;
        f.push({ k: 'Credit limit', w: 10, s: u == null ? 50 : u <= 0.8 ? 100 : u <= 1 ? 100 - (u - 0.8) / 0.2 * 50 : cl(50 - (u - 1) / 0.3 * 50), nodata: u == null,
            v: u == null ? 'no credit limit set in Fusion' : pc(u) + ' of ' + k0(m.limit) + ' used', why: 'Open balance against the credit limit: up to 80 % scores 100, at the limit 50, 130 % or more 0. No limit set counts as 50.' });
        var tot = f.reduce(function (x, y) { return x + y.w; }, 0), score = Math.round(f.reduce(function (x, y) { return x + y.s * y.w; }, 0) / tot);
        var g = H.GRADES.filter(function (x) { return score >= x[0]; })[0];
        var thin = f.filter(function (x) { return x.nodata; }).length >= 3;
        return { score: score, grade: g[1], label: g[2], color: g[3], action: g[4], factors: f, thin: thin };
    };
    H.ratingCard = function (r) {
        return '<div class="card ph-rate"><div class="row" style="gap:14px;align-items:center"><div class="ph-grade" style="background:' + r.color + '">' + r.grade + '</div><div style="flex:1">' +
            '<h3 style="margin:0">Customer rating · ' + esc(r.label) + ' <small class="muted">' + r.score + ' / 100' + (r.thin ? ' · little history — read more months for a firmer rating' : '') + '</small></h3>' +
            '<div class="sm" style="margin-top:3px"><b>Suggested:</b> ' + esc(r.action) + '</div></div></div>' +
            '<table class="t ph-ftab"><tbody>' + r.factors.map(function (x) {
                var col = x.s >= 80 ? '#16a34a' : x.s >= 60 ? '#84cc16' : x.s >= 40 ? '#f59e0b' : '#dc2626';
                return '<tr title="' + esc(x.why) + '"><td><b>' + esc(x.k) + '</b> <span class="muted sm">' + x.w + ' %</span><div class="sm muted">' + esc(x.v) + '</div></td>' +
                    '<td style="width:42%"><div class="ph-fbar"><span style="width:' + Math.round(x.s) + '%;background:' + col + '"></span></div></td><td class="n" style="width:40px"><b>' + Math.round(x.s) + '</b></td></tr>';
            }).join('') + '</tbody></table><div class="sm muted">Hover a line for how it is scored. Grades: A ≥ 85 · B ≥ 70 · C ≥ 55 · D ≥ 40 · E below.</div></div>';
    };
    H.insights = function (m) {
        var c = H.cur, ar = c.kind === 'AR', o = [];
        if (m.overdue > 0.5) o.push({ sev: m.o90 > 0.5 ? 'bad' : '', html: '<b>' + k0(m.overdue) + '</b> overdue' + (m.o90 > 0.5 ? ', of which <b>' + k0(m.o90) + '</b> (' + m.n90 + ' item' + (m.n90 === 1 ? '' : 's') + ') over 90 days' : '') + '.' });
        else if (m.total > 0.5) o.push({ sev: 'good', html: 'Nothing overdue — every open item is within terms.' });
        if (m.dtp != null) o.push({ sev: m.dtpPrev != null && m.dtp > m.dtpPrev + 5 ? 'bad' : m.dtpPrev != null && m.dtp < m.dtpPrev - 5 ? 'good' : '', html: (ar ? 'Pays' : 'We pay') + ' on average <b>' + Math.round(m.dtp) + ' days</b> after the invoice' + (m.late != null ? ' (' + (m.late > 0 ? Math.round(m.late) + ' days late' : Math.round(-m.late) + ' days early') + ' against the due date)' : '') + (m.dtpPrev != null ? ' — ' + (m.dtp > m.dtpPrev ? 'slower' : 'faster') + ' than the year before (' + Math.round(m.dtpPrev) + ' days).' : '.') });
        if (ar && m.limit) { var u = m.total / m.limit * 100; o.push({ sev: u > 100 ? 'bad' : u > 85 ? '' : 'good', html: 'Credit limit ' + k0(m.limit) + ' ' + esc(m.limitCcy || '') + ' — <b>' + Math.round(u) + ' % used</b>' + (u > 100 ? ' (over the limit by ' + k0(m.total - m.limit) + ')' : '') + '.' }); }
        if (ar && !m.limit && H.rows('credit').length === 0 && m.total > 0) o.push({ html: 'No credit limit is set for this customer in Fusion.' });
        if (Math.abs(m.unapplied) > 0.5) o.push({ sev: 'bad', html: '<b>' + k0(Math.abs(m.unapplied)) + '</b> of ' + (ar ? 'receipts are' : 'payments are') + ' unapplied — apply ' + (ar ? 'them to the open invoices' : 'it') + ' so the balance is right.' });
        if (m.credits < -0.5) o.push({ html: '<b>' + k0(-m.credits) + '</b> of open ' + (ar ? 'credit notes' : 'credits') + ' — ' + (ar ? 'allocate them or refund the customer.' : 'take them in the next payment run.') });
        if (!ar && m.holds) o.push({ sev: 'bad', html: '<b>' + m.holds + ' hold(s)</b> not released — those invoices will not be paid.' });
        if (m.lastPay) { var dd = Math.floor((Date.now() - day(m.lastPay.date)) / 864e5); o.push({ sev: ar && dd > 60 && m.total > 0.5 ? 'bad' : '', html: 'Last ' + (ar ? 'receipt' : 'payment') + ' ' + esc(m.lastPay.date) + ' (' + dd + ' days ago) — ' + k0(m.lastPay.amount) + '.' }); }
        else if (m.total > 0.5) o.push({ sev: 'bad', html: 'No ' + (ar ? 'receipt' : 'payment') + ' in the last ' + H.cur.data.months + ' months.' });
        return o;
    };

    H.paint = function () {
        var c = H.cur, d = c.data, ar = c.kind === 'AR', m = H.model();
        var prof = H.rows('profile')[0] || {}, addrs = H.rows('address'), addr = addrs.filter(function (a) { return a.MAIN === 'Y'; })[0] || addrs[0] || {};
        var name = prof.PARTY_NAME || c.title, number = prof.ACCOUNT_NUMBER || prof.SUPPLIER_NUMBER || c.party;
        var line = [addr.ADDRESS1, addr.ADDRESS2, addr.ADDRESS3, addr.CITY, addr.STATE, addr.POSTAL_CODE, addr.COUNTRY].filter(Boolean).join(', ');
        var chips = [prof.CUSTOMER_CLASS || prof.SUPPLIER_TYPE, prof.STATUS === 'A' ? 'Active' : prof.STATUS === 'I' ? 'Inactive' : prof.STATUS, prof.ENABLED_FLAG === 'N' ? 'Disabled' : null].filter(Boolean);
        var tile = function (l, v, s, cls) { return '<div class="sk-card"><div class="sk-l">' + esc(l) + '</div><div class="sk-v">' + v + '</div><div class="sk-s ' + (cls || '') + '">' + (s || '&nbsp;') + '</div></div>'; };
        var used = ar && m.limit ? m.total / m.limit * 100 : null;
        var tiles = '<div class="sk-cards ph-tiles">' +
            tile(ar ? 'Total due' : 'Total owed', k0(m.total), m.open.length + ' open item(s)') +
            tile('Overdue', k0(m.overdue), m.total ? Math.round(m.overdue / m.total * 100) + ' % of the balance' : '', m.overdue > 0.5 ? 'neg' : 'pos') +
            tile('Over 90 days', k0(m.o90), m.n90 + ' item(s)', m.o90 > 0.5 ? 'neg' : '') +
            (ar ? tile('Credit limit', m.limit ? k0(m.limit) : '—', used == null ? 'not set in Fusion' : Math.round(used) + ' % used', used > 100 ? 'neg' : used > 85 ? '' : 'pos') : tile('Open holds', String(m.holds), m.holds ? 'blocking payment' : 'none', m.holds ? 'neg' : 'pos')) +
            tile(ar ? 'Invoiced (12 m)' : 'Invoiced to us (12 m)', k0(m.invoiced12), m.nInv12 + ' invoice(s)') +
            tile(ar ? 'Collected (12 m)' : 'Paid (12 m)', k0(m.paid12), m.invoiced12 ? Math.round(m.paid12 / m.invoiced12 * 100) + ' % of invoiced' : '') +
            tile('Days to pay', m.dtp == null ? '—' : Math.round(m.dtp) + ' d', m.late == null ? 'from the invoice date' : (m.late > 0 ? Math.round(m.late) + ' d late' : Math.round(-m.late) + ' d early') + ' vs due', m.late > 15 ? 'neg' : m.late != null && m.late <= 0 ? 'pos' : '') +
            tile('Last ' + (ar ? 'receipt' : 'payment'), m.lastPay ? esc(m.lastPay.date) : '—', m.lastPay ? k0(m.lastPay.amount) : 'none in the window') + '</div>';
        var rt = ar ? H.rate(m) : null; m.rating = rt;
        if (rt) { var rs = FL.ls('wcp.ratings', {}); rs[(W.cfg().pod || '') + '|' + c.party] = { g: rt.grade, s: rt.score, at: d.fetchedAt }; FL.lsSet('wcp.ratings', rs); }
        var cnt = function (k) { var s = (d.sections || {})[k]; return s ? (s.ok ? s.rows.length + (s.capped ? '+' : '') : '!') : ''; };
        $('ph-head').innerHTML = '<div class="row" style="gap:10px;align-items:flex-start"><div class="ph-av">' + esc(String(name).trim().charAt(0).toUpperCase()) + '</div><div style="flex:1;min-width:0">' +
            '<h2 style="margin:0">' + esc(name) + ' <span class="muted" style="font-weight:400;font-size:.8em">' + esc(number) + '</span> ' + chips.map(function (x) { return '<span class="wc-chip">' + esc(x) + '</span>'; }).join(' ') + '</h2>' +
            '<div class="sm muted ph-meta">' + [line ? '<i class="fa-solid fa-location-dot"></i> ' + esc(line) : '', prof.EMAIL_ADDRESS ? '<i class="fa-regular fa-envelope"></i> ' + esc(prof.EMAIL_ADDRESS) : '', prof.PHONE ? '<i class="fa-solid fa-phone"></i> ' + esc(prof.PHONE) : '',
                prof.ESTABLISHED ? (ar ? 'customer since ' : 'supplier since ') + esc(prof.ESTABLISHED) : '', prof.TAX_REFERENCE ? 'tax ' + esc(prof.TAX_REFERENCE) : '', addrs.length > 1 ? addrs.length + ' sites' : ''].filter(Boolean).join(' · ') + '</div></div>' +
            (rt ? '<a class="ph-badge" id="ph-rt" title="Customer rating ' + rt.score + ' / 100 — ' + esc(rt.action) + '" style="border-color:' + rt.color + '"><span style="background:' + rt.color + '">' + rt.grade + '</span><b>' + esc(rt.label) + '</b><small>' + rt.score + ' / 100</small></a>' : '') +
            '<button class="icon ph-x" id="ph-x" title="Close (Esc)">✕</button></div>' +
            '<div class="row sm ph-bar"><span id="ph-src" class="wc-chip ' + (d.fromCache ? '' : 'live') + '" title="' + (d.fromCache ? 'Read from DuckDB on this PC — no call to Fusion' : 'Just read from Fusion and kept on this PC') + '">' +
            (d.fromCache ? '<i class="fa-solid fa-hard-drive"></i> From this PC · read from Fusion ' + esc(d.fetchedAt.slice(0, 16)) + ' (' + ago(d.fetchedAt) + ')' : '<i class="fa-solid fa-cloud"></i> Just read from Fusion' + (d.ms ? ' in ' + (d.ms / 1000).toFixed(1) + ' s' : '') + ' · kept on this PC') + '</span>' +
            '<label>History <select id="ph-m">' + [12, 24, 36, 60].map(function (n) { return '<option value="' + n + '"' + (+d.months === n ? ' selected' : '') + '>' + n + ' months</option>'; }).join('') + '</select></label>' +
            '<span class="muted" id="ph-prog"></span><span class="grow"></span>' +
            '<button class="btn sm" id="ph-ref"><i class="fa-solid fa-rotate"></i> Refresh from Fusion</button><button class="btn sm" id="ph-xl"><i class="fa-solid fa-file-excel"></i> Excel</button>' +
            '<button class="btn sm" id="ph-ask"><i class="fa-solid fa-wand-magic-sparkles"></i> Ask the Copilot</button></div>' + tiles +
            '<div class="seg ph-tabs" id="ph-tabs">' + TABS[c.kind].map(function (t) { var n = t[0] === 'overview' || t[0] === 'sql' ? '' : t[0] === 'open' ? String(m.open.length) : cnt(t[0]); return '<button data-t="' + t[0] + '" class="' + (c.tab === t[0] ? 'on' : '') + '">' + esc(t[1]) + (n !== '' ? ' <span class="tag">' + n + '</span>' : '') + '</button>'; }).join('') + '</div>';
        $('ph-x').onclick = H.close;
        if ($('ph-rt')) $('ph-rt').onclick = function () { c.tab = 'overview'; $('ph-tabs').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x.dataset.t === 'overview'); }); H.body(m); };
        $('ph-ref').onclick = function () { H.load(true); };
        $('ph-m').onchange = function () { H.months = +this.value; FL.lsSet('wcp.hmonths', H.months); H.load(true); };
        $('ph-xl').onclick = H.excel;
        $('ph-ask').onclick = function () { H.close(); FL.askCopilot(H.prompt(m, name, number)); };
        $('ph-tabs').querySelectorAll('button').forEach(function (b) { b.onclick = function () { c.tab = b.dataset.t; FL.lsSet('wcp.htab', c.tab); $('ph-tabs').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); H.body(m); }; });
        H.body(m);
    };

    H.body = function (m) {
        var c = H.cur, box = $('ph-body'), ar = c.kind === 'AR';
        (H.charts || []).forEach(function (x) { try { x.destroy(); } catch (e) { /* gone */ } }); H.charts = [];
        if (c.tab === 'overview') {
            box.innerHTML = '<div class="sk-grid"><div class="card"><h3>' + (ar ? 'Invoiced and collected' : 'Invoiced to us and paid') + ' <small class="muted">by month</small></h3><div class="sk-ch"><canvas id="ph-c1"></canvas></div></div>' +
                '<div class="card"><h3>Open items by age</h3><div class="sk-ch"><canvas id="ph-c2"></canvas></div></div></div>' +
                (m.rating ? '<div class="sk-grid">' + H.ratingCard(m.rating) : '<div class="sk-grid">') + '<div class="card"><h3>What stands out</h3><ul class="sk-ins">' + H.insights(m).map(function (i) { return '<li class="' + (i.sev || '') + '"><span class="sk-ic">' + (i.sev === 'bad' ? '!' : i.sev === 'good' ? '✓' : '•') + '</span><span>' + i.html + '</span></li>'; }).join('') + '</ul></div>' + (m.rating ? '</div><div class="sk-grid">' : '') +
                '<div class="card"><h3>Days to pay <small class="muted">by month, weighted by amount</small></h3><div class="sk-ch"><canvas id="ph-c3"></canvas></div></div></div>';
            var mk = function (id, cfg) { var cv = $(id); if (!cv || !window.Chart) return; cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } } }, cfg.options || {}); H.charts.push(new Chart(cv, cfg)); };
            mk('ph-c1', { type: 'bar', data: { labels: m.months.map(function (x) { return x.k; }), datasets: [{ label: ar ? 'Invoiced' : 'Invoiced to us', data: m.months.map(function (x) { return x.inv; }), backgroundColor: FL.PAL.act, borderRadius: 3 }, { label: ar ? 'Collected' : 'Paid', data: m.months.map(function (x) { return x.paid; }), backgroundColor: FL.PAL.good, borderRadius: 3 }] }, options: { scales: { y: FL.moneyAxis() } } });
            mk('ph-c2', { type: 'bar', data: { labels: m.age.map(function (a) { return a[0]; }), datasets: [{ label: 'Open', data: m.age.map(function (a) { return a[1]; }), backgroundColor: ['#16a34a', '#84cc16', '#facc15', '#f59e0b', '#ea580c', '#dc2626'], borderRadius: 3 }] }, options: { plugins: { legend: { display: false } }, scales: { y: FL.moneyAxis() } } });
            mk('ph-c3', { type: 'line', data: { labels: m.months.map(function (x) { return x.k; }), datasets: [{ label: 'Days to pay', data: m.months.map(function (x) { return x.dtp == null ? null : Math.round(x.dtp); }), borderColor: FL.PAL.bud || '#7c3aed', spanGaps: true, cubicInterpolationMode: 'monotone', pointRadius: 2 }] }, options: { plugins: { legend: { display: false } } } });
            return;
        }
        if (c.tab === 'sql') {
            var s = c.data.sections || {};
            box.innerHTML = '<div class="card"><h3>Where each tab comes from</h3><p class="sm muted">Read-only queries through the Fusion SQL runner; when a pod does not have a column the next, simpler query is used. Kept on this PC (DuckDB fin_wc_history) — open the same ' + (ar ? 'customer' : 'supplier') + ' again and nothing is asked of Fusion until Refresh.</p>' +
                Object.keys(s).map(function (k) { var x = s[k]; return '<div class="ph-src"><b>' + esc(k) + '</b> <span class="sm ' + (x.ok ? 'pos' : 'neg') + '">' + (x.ok ? x.rows.length + ' row(s)' + (x.alt ? ' · simpler query ' + (x.alt + 1) : '') : 'not available: ' + esc(x.error || '')) + ' · ' + x.ms + ' ms</span><pre class="ph-sql">' + esc(x.sql || '') + '</pre></div>'; }).join('') + '</div>';
            return;
        }
        if (c.tab === 'open') {
            box.innerHTML = '<div class="card"><div class="row"><h3 style="margin:0">Open items <small class="muted">invoices and credits with an amount still open, as read ' + (c.data.fromCache ? 'on ' + esc(c.data.fetchedAt.slice(0, 16)) : 'just now') + '</small></h3><span class="grow"></span>' +
                '<button class="btn sm" id="ph-live" title="Read the open items from Fusion now (not kept)"><i class="fa-solid fa-bolt"></i> Live from Fusion</button></div><div id="ph-grid"></div></div>';
            H.grid(m.open.map(function (r) { var d0 = day(r.DUE_DATE); return Object.assign({ DAYS_LATE: d0 == null ? null : Math.floor((Date.now() - d0) / 864e5) }, r); }), 'open');
            $('ph-live').onclick = function () { liveDetail(c.kind, c.party, c.title + ' · open items, live'); };
            return;
        }
        var sec = (c.data.sections || {})[c.tab];
        if (!sec) { box.innerHTML = '<div class="card muted">Nothing here.</div>'; return; }
        if (!sec.ok) { box.innerHTML = '<div class="callout warn"><b>Not available on this pod.</b> ' + esc(sec.error || '') + '<div class="sm muted" style="margin-top:4px">The query is under Sources.</div></div>'; return; }
        box.innerHTML = '<div class="card"><div id="ph-grid"></div>' + (sec.capped ? '<p class="sm warn">First 5,000 rows — shorten the history window.</p>' : '') + '</div>';
        H.grid(H.rows(c.tab), c.tab);
    };
    H.grid = function (rows, name) {
        var cols = rows.length ? Object.keys(rows[0]) : [];
        var LABEL = function (c) { return c.replace(/_/g, ' ').toLowerCase().replace(/^./, function (x) { return x.toUpperCase(); }); };
        FL.grid($('ph-grid'), cols.map(function (c) {
            var n = NUMCOL.test(c);
            return { label: LABEL(c), n: n, html: c === 'DAYS_LATE' || c === 'STATUS' || c === 'CLASS', get: function (r) {
                var v = r[c];
                if (typeof v === 'string' && v.indexOf('4712-12-31') === 0) return '';   // Fusion's "not closed" date
                if (c === 'DAYS_LATE' && v != null && v !== '') return '<span class="' + (num(v) > 0 ? 'neg' : 'pos') + '">' + num(v) + '</span>';
                if (c === 'STATUS' || c === 'CLASS') return v == null ? '' : '<span class="ph-st s-' + esc(String(v)) + '">' + esc(String(v)) + '</span>';
                return n && v != null && v !== '' ? amt(v, /DAYS/.test(c) ? 0 : 2) : v == null ? '' : v;
            }, val: function (r) { var v = r[c]; return n && v != null && v !== '' ? num(v) : v; } };
        }), rows, { id: 'ph-' + name, height: '52vh', csv: H.cur.party + '-' + name + '.csv', empty: 'Nothing in the window (' + H.cur.data.months + ' months).' });
    };
    H.prompt = function (m, name, number) {
        var ar = H.cur.kind === 'AR';
        return (ar ? 'Customer ' : 'Supplier ') + name + ' (' + number + '): total ' + (ar ? 'due ' : 'owed ') + Math.round(m.total) + ', overdue ' + Math.round(m.overdue) + ', over 90 days ' + Math.round(m.o90) +
            (m.limit ? ', credit limit ' + Math.round(m.limit) : '') + ', invoiced last 12 months ' + Math.round(m.invoiced12) + ', ' + (ar ? 'collected ' : 'paid ') + Math.round(m.paid12) +
            (m.dtp != null ? ', days to pay ' + Math.round(m.dtp) + (m.dtpPrev != null ? ' (year before ' + Math.round(m.dtpPrev) + ')' : '') : '') + (m.lastPay ? ', last ' + (ar ? 'receipt ' : 'payment ') + m.lastPay.date : '') +
            (m.rating ? '. Our rating: ' + m.rating.grade + ' (' + m.rating.score + '/100, ' + m.rating.factors.map(function (x) { return x.k + ' ' + Math.round(x.s); }).join(', ') + ')' : '') +
            '. ' + (ar ? 'How risky is this customer, and what should we do about collection and the credit limit?' : 'What should we pay this supplier first, and is anything blocking payment?');
    };
    H.excel = function () {
        var c = H.cur; if (!window.ExcelJS || !c || !c.data) return;
        var wb = new ExcelJS.Workbook(), m = H.model(), ws = wb.addWorksheet('Summary');
        ws.addRow([(c.kind === 'AR' ? 'Customer ' : 'Supplier ') + c.title + ' (' + c.party + ')']).font = { bold: true, size: 13 };
        ws.addRow(['Read from Fusion', c.data.fetchedAt, 'History', c.data.months + ' months']);
        [['Total', m.total], ['Overdue', m.overdue], ['Over 90 days', m.o90], ['Credit limit', m.limit], ['Invoiced 12 m', m.invoiced12], ['Paid 12 m', m.paid12], ['Days to pay', m.dtp == null ? null : Math.round(m.dtp)], ['Days late', m.late == null ? null : Math.round(m.late)]].concat(m.rating ? [['Rating', m.rating.grade + ' · ' + m.rating.score + ' / 100 · ' + m.rating.label]].concat(m.rating.factors.map(function (x) { return ['  ' + x.k + ' (' + x.w + ' %)', Math.round(x.s) + ' — ' + x.v]; })) : [])
            .forEach(function (r) { ws.addRow(r); });
        H.insights(m).forEach(function (i) { ws.addRow([String(i.html).replace(/<[^>]+>/g, '')]); });
        ws.getColumn(1).width = 40; ws.getColumn(2).numFmt = '#,##0.00';
        Object.keys(c.data.sections || {}).forEach(function (k) {
            var s = c.data.sections[k]; if (!s.ok || !s.rows.length) return;
            var sh = wb.addWorksheet(k.slice(0, 30)); sh.addRow(s.columns).font = { bold: true };
            s.rows.forEach(function (r) { sh.addRow(r.map(function (v, i) { return NUMCOL.test(s.columns[i]) && v != null && v !== '' ? num(v) : v; })); });
            sh.views = [{ state: 'frozen', ySplit: 1 }];
        });
        wb.xlsx.writeBuffer().then(function (buf) { FL.download(c.party + ' history.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); });
    };
})();
