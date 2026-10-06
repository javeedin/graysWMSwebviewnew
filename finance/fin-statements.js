/* Finance Lens — Statements: any template (income statement, balance sheet, cash flow, your own) for the period and filter,
   formatted like a published statement; click any amount to drill; account detail; Excel (formatted) / CSV / print. */
(function () {
    var S = FL.stmt = { tpl: FL.ls('stmt.tpl', 'TB'), hideZero: FL.ls('stmt.hideZero', true), detail: false, labels: FL.ls('stmt.labels', 'sentence') };
    /** Line labels in the chosen case (display only: sentence = the IFRS / IAS 1 habit, title, upper, as written) */
    FL.stdLabels = function (st, mode) { mode = mode || S.labels; if (mode && mode !== 'asis') st.rows = st.rows.map(function (r) { return Object.assign({}, r, { label: FINE.labelCase(r.label, mode) }); }); return st; };

    FL.stmtOpts = function () { return { period: FL.filter.period, scale: FL.filter.scale }; };

    // ═════ the statement bar: one place for ledger · year · period · company · amounts, the statement kinds and the template ═════
    var KINDS = [['TB', 'Trial balance', 'fa-scale-balanced'], ['PL', 'Income statement', 'fa-chart-line'], ['BS', 'Balance sheet', 'fa-building-columns'], ['CF', 'Cash flow', 'fa-money-bill-transfer'], ['X', 'Other', 'fa-file-lines']];
    S.pick = FL.ls('stmt.pick', {});
    S.kindOf = function (t) { return !t ? 'TB' : /^(PL|BS|CF)$/.test(t.type) ? t.type : 'X'; };
    S.ofKind = function (k) { return (FL.templates || []).filter(function (t) { return S.kindOf(t) === k; }); };
    S.kind = function () { return S.tpl === 'TB' ? 'TB' : S.kindOf(FL.tpl(S.tpl)); };
    /** Shows a kind: the template last used for it, else its first */
    S.go = function (kind, id) {
        if (kind === 'TB') S.tpl = 'TB';
        else { var list = S.ofKind(kind), t = FL.tpl(id || S.pick[kind]); if (!t || S.kindOf(t) !== kind) t = list[0]; if (!t) return; S.tpl = t.id; S.pick[kind] = t.id; FL.lsSet('stmt.pick', S.pick); }
        FL.lsSet('stmt.tpl', S.tpl); FL.show('statements');
    };
    S.bar = function () {
        var f = FL.filter, pers = FL.dims.periods || [], cur = pers.filter(function (p) { return p.period_seq === f.period; })[0] || pers[pers.length - 1] || {}, years = {};
        pers.forEach(function (p) { years[p.fiscal_year] = 1; });
        var leds = FL.dims.ledgers || [], kind = S.kind(), list = kind === 'TB' ? [] : S.ofKind(kind);
        var ctx = !pers.length ? '<span class="sm muted">No periods synced yet</span>' :
            (leds.length > 1 ? '<label class="sb-f">Ledger<select id="sb-led"><option value="">All ledgers</option>' + leds.map(function (l) { return '<option value="' + esc(l.code) + '"' + (f.ledger === l.code ? ' selected' : '') + '>' + esc(l.name + ' · ' + l.currency) + '</option>'; }).join('') + '</select></label>'
                : leds.length ? '<span class="sb-f"><small>Ledger</small><b>' + esc(leds[0].name) + '</b> <span class="muted sm">' + esc(leds[0].currency || '') + '</span></span>' : '') +
            '<span class="sb-f"><small>Year</small><span class="seg sb-years">' + Object.keys(years).sort().map(function (y) { return '<button data-y="' + esc(y) + '" class="' + (+y === cur.fiscal_year ? 'on' : '') + '">' + esc(y) + '</button>'; }).join('') + '</span></span>' +
            '<span class="sb-f grow"><small>Period</small><span class="seg sb-pers">' + pers.filter(function (p) { return p.fiscal_year === cur.fiscal_year; }).map(function (p) {
                return '<button data-p="' + p.period_seq + '" class="' + (p.period_seq === f.period ? 'on' : '') + '" title="' + esc(p.period_name) + '">' + esc(String(p.period_name).replace(/[-\s]?\d{2,4}$/, '') || p.period_name) + '</button>'; }).join('') + '</span></span>' +
            '<label class="sb-f">Company<select id="sb-co"><option value="">' + (f.ledger ? 'All companies of the ledger' : 'All companies') + '</option>' + (FL.dims.companies || []).filter(function (c) {
                return !f.ledger || (FL.dims.ledgerCompanies || []).some(function (x) { return x.ledger === f.ledger && x.company === c.code; }) || !(FL.dims.ledgerCompanies || []).length; }).map(function (c) { return '<option value="' + esc(c.code) + '"' + (f.company === c.code ? ' selected' : '') + '>' + esc(c.code + (c.name && c.name !== c.code ? ' ' + c.name : '')) + '</option>'; }).join('') + '</select></label>' +
            '<label class="sb-f">Amounts<select id="sb-sc">' + [[1, 'Units'], [100, 'Hundreds'], [1000, 'Thousands'], [1000000, 'Millions']].map(function (x) { return '<option value="' + x[0] + '"' + (+f.scale === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>';
        var kinds = KINDS.filter(function (k) { return k[0] === 'TB' || S.ofKind(k[0]).length || k[0] === 'PL' || k[0] === 'BS'; });
        return '<div class="sbar"><div class="sb-ctx">' + ctx + '</div><div class="sb-kinds"><div class="sb-tabs">' +
            kinds.map(function (k) { return '<button data-k="' + k[0] + '" class="' + (kind === k[0] ? 'on' : '') + '"><i class="fa-solid ' + k[2] + '"></i> ' + k[1] + (k[0] !== 'TB' && S.ofKind(k[0]).length > 1 ? ' <span class="cnt">' + S.ofKind(k[0]).length + '</span>' : '') + '</button>'; }).join('') + '</div>' +
            (kind !== 'TB' ? '<span class="grow"></span><label class="sb-f sb-tpl">Template<select id="sb-tpl">' + list.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === S.tpl ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select></label>' +
                '<button class="btn sm" id="sb-build" title="Main groups, sections and accounts of this template"><i class="fa-solid fa-sitemap"></i> ' + ((FL.tpl(S.tpl) || {}).simple ? 'Edit mapping' : 'Edit template') + '</button>' +
                (kind === 'PL' || kind === 'BS' ? '<button class="btn sm" id="sb-new" title="Another ' + (kind === 'PL' ? 'income statement' : 'balance sheet') + ' layout — choose it here when you run the statement"><i class="fa-solid fa-plus"></i> New template</button>' : '') : '') +
            '</div></div>';
    };
    S.wireBar = function (el) {
        var q = function (sel) { return el.querySelector(sel); };
        el.querySelectorAll('.sb-tabs button').forEach(function (b) { b.onclick = function () { if (b.dataset.k !== 'TB' && !S.ofKind(b.dataset.k).length) { FL.builder.create(b.dataset.k); return; } S.go(b.dataset.k); }; });
        el.querySelectorAll('.sb-years button').forEach(function (b) { b.onclick = function () { var ps = FL.dims.periods.filter(function (p) { return p.fiscal_year === +b.dataset.y; }); if (ps.length) FL.setFilter({ period: ps[ps.length - 1].period_seq }); }; });
        el.querySelectorAll('.sb-pers button').forEach(function (b) { b.onclick = function () { FL.setFilter({ period: +b.dataset.p }); }; });
        if (q('#sb-led')) q('#sb-led').onchange = function () { FL.setFilter({ ledger: this.value, company: '' }); };
        if (q('#sb-co')) q('#sb-co').onchange = function () { FL.setFilter({ company: this.value }); };
        if (q('#sb-sc')) q('#sb-sc').onchange = function () { FL.setFilter({ scale: +this.value }); };
        if (q('#sb-tpl')) q('#sb-tpl').onchange = function () { S.go(S.kind(), this.value); };
        if (q('#sb-build')) q('#sb-build').onclick = function () { FL.builder.open(S.tpl); };
        if (q('#sb-new')) q('#sb-new').onclick = function () { FL.builder.create(S.kind()); };
        S.coverHint(el);
    };
    /** "Synced for 1 of 12 companies" under the bar: the ledger has companies the synced trial balances do not hold */
    S.coverHint = function (el) {
        var ctx = el.querySelector('.sb-ctx'), leds = FL.dims.ledgers || [], have = FL.dims.companies || []; if (!ctx || !leds.length || !FL.fusion || !FL.fusion.getDisc) return;
        var ck = function (v) { v = String(v == null ? '' : v); return /^[0-9]+$/.test(v) ? (v.replace(/^0+/, '') || '0') : v; };
        var pod = FL.tbsync && FL.tbsync.st ? FL.tbsync.st.pod || '' : '';
        FL.fusion.getDisc(pod).then(function (r) {
            if (!r || !r.disc || !el.isConnected) return;
            var lc = FL.dims.ledgerCompanies || [], out = [];
            leds.filter(function (l) { return !FL.filter.ledger || l.code === FL.filter.ledger; }).forEach(function (l) {
                var dl = (r.disc.ledgers || []).filter(function (x) { return String(x.id) === String(l.code); })[0]; if (!dl) return;
                var all = (dl.companies || []).map(function (c) { return c.value; }); if (all.length < 2) return;
                var mine = lc.length ? lc.filter(function (x) { return x.ledger === l.code; }).map(function (x) { return x.company; }) : have.map(function (c) { return c.code; });
                var got = all.filter(function (v) { return mine.some(function (m) { return ck(m) === ck(v); }); });
                if (got.length < all.length) out.push({ led: l, dl: dl, got: got, all: all });
            });
            if (!out.length) return;
            var d = document.createElement('div'); d.className = 'callout warn sb-cover';
            d.innerHTML = out.map(function (o) {
                return '<b><i class="fa-solid fa-building"></i> ' + esc(o.led.name) + ': synced for ' + o.got.length + ' of ' + o.all.length + ' companies</b>' + (o.got.length ? ' (' + esc(o.got.slice(0, 6).join(', ') + (o.got.length > 6 ? ' …' : '')) + ')' : '') +
                    ' — these figures cover only those companies. <button class="btn sm" data-cov="' + esc(o.dl.id) + '"><i class="fa-solid fa-cloud-arrow-down"></i> Sync the other ' + (o.all.length - o.got.length) + '</button>';
            }).join('<br>');
            ctx.parentNode.insertBefore(d, ctx.nextSibling);
            d.querySelectorAll('[data-cov]').forEach(function (b) { b.onclick = function () {
                if (FL.tbsync && FL.tbsync.st) { FL.lsSet('tbl.pod', pod); FL.lsSet('tbl.ledger', String(b.dataset.cov)); FL.tbsync.st.pod = pod; FL.tbsync.st.ledger = String(b.dataset.cov); }
                FL.show('data'); setTimeout(function () { if (FL.dataTab) FL.dataTab.go('tbsync'); }, 50);
            }; });
        }).catch(function () {});
    };

    /** Formats a cell of a computed statement */
    FL.cellText = function (r, c, v) {
        if (v == null) return '';
        if (c.kind === 'var') return c.mode === 'pct' ? FINE.fmt(v, 'pct') : (r.format === 'pct' ? (v >= 0 ? '+' : '') + v.toFixed(1) + ' pts' : FINE.fmt(v, r.format));
        if (c.kind === 'pctof') return FINE.fmt(v, 'pct');
        return FINE.fmt(v, r.format, { decimals: FL.filter.scale >= 1000000 ? 1 : 0 });
    };
    FL.rowClass = function (r) {
        var s = r.style || {}, c = [r.type];
        if (s.bold) c.push('b'); if (s.italic) c.push('i'); if (s.muted) c.push('m'); if (s.topBorder) c.push('tb'); if (s.doubleBottom) c.push('db'); if (s.highlight) c.push('hl');
        if (r.type === 'check') c.push(r.ok ? 'ok' : 'notok');
        return c.join(' ');
    };

    /** Table HTML of a computed statement (also used by the board pack with links off) */
    FL.stmtTable = function (st, opts) {
        opts = opts || {};
        var rows = st.rows.filter(function (r) {
            if (r.hidden) return false;
            if (opts.hideZero && (r.type === 'accounts') && r.values.every(function (v, i) { return st.columns[i].kind !== 'value' || !v || Math.abs(v) < 0.5; })) return false;
            return true;
        });
        var h = '<table class="st"><thead><tr><th>' + esc(opts.firstHeader || ('in ' + FL.scaleLabel())) + '</th>' +
            st.columns.map(function (c) { return '<th class="' + (c.kind !== 'value' ? 'var' : '') + '">' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
        rows.forEach(function (r) {
            var lv = (r.level || 0) * 18;
            h += '<tr class="' + FL.rowClass(r) + '" data-row="' + esc(r.id || '') + '">';
            var expand = opts.detail && r.type === 'accounts' && r.accounts && r.accounts.length > 0;
            var mapLink = opts.links && /^(accounts|group|formula|check)$/.test(r.type);
            h += '<td' + (mapLink ? ' class="lbl" title="Accounts mapped to this line"' : '') + '><span class="lv" style="padding-left:' + lv + 'px">' + esc(r.label || '') + (r.note && !opts.print ? ' <i class="fa-regular fa-note-sticky muted" title="' + esc(r.note) + '"></i>' : '') + '</span></td>';
            st.columns.forEach(function (c, i) {
                var v = r.values[i], cls = [];
                if (c.kind === 'var' && v != null && Math.abs(v) > 1e-9) cls.push(v > 0 ? 'fav' : 'unf');
                var drill = opts.links && c.kind === 'value' && /^(accounts|group|formula|check)$/.test(r.type) && v != null;
                if (drill) cls.push('v');
                h += '<td class="' + cls.join(' ') + '"' + (drill ? ' data-col="' + esc(c.id) + '"' : '') + '>' + FL.cellText(r, c, v) + '</td>';
            });
            h += '</tr>';
            if (expand && opts.sub && opts.sub[r.id]) {
                opts.sub[r.id].forEach(function (a) {
                    h += '<tr class="sub" data-acc="' + esc(a.code) + '" data-of="' + esc(r.id || '') + '"><td><span class="lv" style="padding-left:' + (lv + 22) + 'px">' +
                        (opts.segBy ? '<i class="fa-solid fa-caret-right st-segc" title="Open this account by ' + esc(opts.segName || 'segment') + '"></i> ' : '') + esc(a.code + ' ' + a.name) + '</span></td>' +
                        st.columns.map(function (c, i) { return '<td>' + FL.cellText(r, c, a.values[i]) + '</td>'; }).join('') + '</tr>';
                });
            }
        });
        return h + '</tbody></table>';
    };

    /** Writes standard labels (+ fonts / styles) into the template after showing what changes */
    S.standardize = function (tpl) {
        var mode = S.labels === 'asis' ? 'sentence' : S.labels;
        var paint = function (styles) {
            var copy = JSON.parse(JSON.stringify(tpl)), ch = FINE.standardize(copy, { labels: mode, styles: styles });
            FL.modal('<i class="fa-solid fa-spell-check"></i> Standardize "' + esc(tpl.name) + '"',
                '<p class="sm" style="margin-top:0">Line names in <b>' + esc({ sentence: 'sentence case', title: 'Title Case', upper: 'UPPER CASE' }[mode]) + '</b> (acronyms such as VAT, PPE, IFRS stay in capitals)' +
                (tpl.simple ? '' : ' and, if ticked, one font style per kind of line: main group headings <b>bold</b>, the lines under them plain and indented, group totals and subtotals <b>bold with a rule above</b>, the final total (net profit / total equity and liabilities) <b>double-underlined</b>, % lines and checks <i>italic</i>') + '.</p>' +
                (tpl.simple ? '' : '<label class="sm"><input type="checkbox" id="sd-sty"' + (styles ? ' checked' : '') + '> also fonts &amp; styles</label>') +
                '<div class="scroll" style="max-height:55vh;margin-top:8px">' + (ch.length ? '<table class="pm-tab"><thead><tr><th>Now</th><th>Becomes</th></tr></thead><tbody>' +
                    ch.map(function (c) { return '<tr><td>' + esc(c.from) + '</td><td><b>' + esc(c.to) + '</b></td></tr>'; }).join('') + '</tbody></table>' : '<p class="sm muted">Every label is already in this case.</p>') + '</div>',
                '<button class="btn primary" id="sd-ok"><i class="fa-solid fa-check"></i> Apply &amp; save</button>');
            if ($('sd-sty')) $('sd-sty').onchange = function () { paint(this.checked); };
            $('sd-ok').onclick = function () {
                var i = FL.templates.map(function (x) { return x.id; }).indexOf(tpl.id); if (i < 0) return;
                FINE.standardize(FL.templates[i], { labels: mode, styles: styles });
                FL.saveTemplates().then(function () { FL.closeModal(); FL.toast(ch.length + ' label(s) standardized' + (styles && !tpl.simple ? ', fonts and styles set' : ''), 'ok'); FL.render(); }, function (e) { FL.toast(String(e), 'err'); });
            };
        };
        paint(true);
    };
    // ── account → segment drill: the synced segments under an account line (Analysis, Salesperson …) ──
    S.segBy = FL.ls('stmt.segBy', '');
    S.segCache = null;
    /** Segments this PC holds per account: extended segments (fin_gl_ext_v) and trial balances read "also by" a segment */
    S.segList = function () {
        var safe = function (sql) { return FL.rows(sql, 5000).catch(function () { return []; }); };
        return Promise.all([
            safe("SELECT DISTINCT segments FROM fin_gl_balances_ext_sync WHERE segments IS NOT NULL"),
            safe("SELECT DISTINCT grain FROM fin_gl_balances_acct WHERE grain LIKE '%,S%'"),
            safe("SELECT column_name AS col, ANY_VALUE(segment_name) AS name FROM fin_coa_segments GROUP BY 1"),
            safe("SELECT ANY_VALUE(company_segment) AS co, ANY_VALUE(account_segment) AS ac, ANY_VALUE(cost_centre_segment) AS cc FROM fin_tb_ledgers")
        ]).then(function (r) {
            var names = {}; r[2].forEach(function (x) { names[String(x.col).toUpperCase()] = x.name; });
            var led = r[3][0] || {}, skip = [String(led.co || '').toUpperCase(), String(led.ac || '').toUpperCase()], got = {};
            r[0].forEach(function (x) { String(x.segments).split(',').forEach(function (c) { c = c.trim().toUpperCase(); if (/^SEGMENT\d+$/.test(c)) got[c] = got[c] || {}, got[c].ext = 1; }); });
            r[1].forEach(function (x) { (String(x.grain).match(/S\d+/g) || []).forEach(function (t) { var c = 'SEGMENT' + t.slice(1); (got[c] = got[c] || {}).tb = 1; }); });
            S.segCache = Object.keys(got).filter(function (c) { return skip.indexOf(c) < 0; }).sort(function (a, b) { return +a.slice(7) - +b.slice(7); })
                .map(function (c) { return { col: c.toLowerCase(), name: (names[c] || c) + (String(led.cc || '').toUpperCase() === c ? ' (cost centre)' : ''), ext: !!got[c].ext, tb: !!got[c].tb }; });
            return S.segCache;
        });
    };
    /** One account by one segment: facts per segment value [net, closing] per period → the same template maths (PTD / YTD / balance) */
    S.segFacts = function (code, g) {
        var col = g.col, lit = FL.q, co = FL.filter.company, w = ["x.account = " + lit(code)];
        if (FL.filter.ledger) w.push("x.ledger_id IN (SELECT ledger_id FROM fin_tb_ledgers WHERE code = " + lit(FL.filter.ledger) + ")");
        if (co) w.push("ltrim(x.company, '0') = ltrim(" + lit(co) + ", '0')");
        var ext = "SELECT x.period_seq AS seq, COALESCE(NULLIF(CAST(x." + col + " AS VARCHAR), ''), '(blank)') AS v, SUM(x.dr - x.cr) AS net, SUM(CASE WHEN x.adj THEN 0 ELSE x.opening END) AS op " +
            "FROM fin_gl_ext_v x WHERE " + w.concat(["x." + col + " IS NOT NULL", "x.period_seq IS NOT NULL"]).join(' AND ') + " GROUP BY 1, 2";
        var tb = "SELECT t.period_seq AS seq, COALESCE(NULLIF(CAST(x." + col + " AS VARCHAR), ''), '(blank)') AS v, SUM(COALESCE(x.period_net_dr, 0) - COALESCE(x.period_net_cr, 0)) AS net, " +
            "SUM(CASE WHEN t.adj THEN 0 ELSE COALESCE(x.begin_balance_dr, 0) - COALESCE(x.begin_balance_cr, 0) END) AS op FROM fin_gl_balances_acct x " +
            "JOIN (SELECT DISTINCT pod, ledger_id, period_name, period_seq, adj FROM fin_tb_periods) t ON t.pod = x.pod AND t.ledger_id = x.ledger_id AND t.period_name = x.period_name " +
            "WHERE " + w.concat(["regexp_matches(x.grain, ',S" + col.slice(7) + "(,|$)')", "COALESCE(x.translated_flag, '-') <> 'R'"]).join(' AND ') + " GROUP BY 1, 2";
        var first = g.ext ? ext : tb, second = g.ext && g.tb ? tb : null;
        return FL.rows(first, 100000).then(function (rows) { return rows.length || !second ? { rows: rows, src: g.ext ? 'extended segments' : 'trial balance' } : FL.rows(second, 100000).then(function (r2) { return { rows: r2, src: 'trial balance' }; }); });
    };
    S.toggleSeg = function (tr, data, opts, st, rowId, code, g) {
        if (!g) return;
        var open = tr.classList.toggle('seg-open'), caret = tr.querySelector('.st-segc');
        caret.className = 'fa-solid ' + (open ? 'fa-caret-down' : 'fa-caret-right') + ' st-segc';
        var next = tr.nextElementSibling; while (next && next.classList.contains('segsub')) { var n2 = next.nextElementSibling; next.remove(); next = n2; }
        if (!open) return;
        var row = st.rows.filter(function (r) { return r.id === rowId; })[0] || {}, acc = (data.accounts || []).filter(function (a) { return a.code === code; })[0] || { account_type: 'E' };
        var pad = (parseInt((tr.querySelector('.lv') || {}).style ? tr.querySelector('.lv').style.paddingLeft : 0, 10) || 0) + 22;
        var wait = document.createElement('tr'); wait.className = 'sub segsub'; wait.innerHTML = '<td colspan="' + (st.columns.length + 1) + '"><span class="lv muted" style="padding-left:' + pad + 'px"><i class="fa-solid fa-circle-notch fa-spin"></i> ' + esc(g.name) + '…</span></td>';
        tr.after(wait);
        S.segFacts(code, g).then(function (res) {
            wait.remove();
            var vals = {}; res.rows.forEach(function (x) { (vals[x.v] = vals[x.v] || {})[x.seq] = [+x.net || 0, (+x.op || 0) + (+x.net || 0)]; });
            var keys = Object.keys(vals).sort();
            if (!keys.length) { tr.after(Object.assign(document.createElement('tr'), { className: 'sub segsub', innerHTML: '<td colspan="' + (st.columns.length + 1) + '"><span class="lv muted" style="padding-left:' + pad + 'px">No ' + esc(g.name) + ' rows on this PC for ' + esc(code) + ' — sync the trial balance with it (Trial balance segments) or the extended segments.</span></td>' })); return; }
            var accs = keys.map(function (k, i) { return { code: 'S' + i, name: k, account_type: acc.account_type, class: acc.class }; }), facts = { ACTUAL: {} };
            keys.forEach(function (k, i) { facts.ACTUAL['S' + i] = vals[k]; });
            var sign = row.sign === -1 || row.sign === 'credit' ? 'credit' : row.sign === 1 || row.sign === 'debit' ? 'debit' : 'auto';
            var mini = { id: 'SEG', rows: keys.map(function (k, i) { return { id: 'r' + i, type: 'accounts', label: k, accounts: ['S' + i], basis: row.basis || 'auto', sign: sign, favourable: row.favourable }; }) };
            var res2 = FINE.compute(mini, { accounts: accs, periods: data.periods, facts: facts }, Object.assign({}, opts, { columns: opts.columns || (S.last && S.last.tpl.columns) || undefined }));
            var at = tr, frag = res2.rows.filter(function (r) { return r.values.some(function (v) { return v && Math.abs(v) >= 0.005; }); });
            frag.forEach(function (r, i) {
                var x = document.createElement('tr'); x.className = 'sub segsub';
                x.innerHTML = '<td><span class="lv" style="padding-left:' + pad + 'px" title="' + esc(g.name + ' — from the ' + res.src) + '"><span class="muted">' + esc(g.name) + '</span> ' + esc(r.label) + '</span></td>' +
                    st.columns.map(function (c, j) { var v = r.values[j]; return '<td class="' + (c.kind === 'var' && v ? (v > 0 ? 'fav' : 'unf') : '') + '">' + FL.cellText(row, c, v) + '</td>'; }).join('');
                at.after(x); at = x;
            });
            if (!frag.length) { var e = document.createElement('tr'); e.className = 'sub segsub'; e.innerHTML = '<td colspan="' + (st.columns.length + 1) + '"><span class="lv muted" style="padding-left:' + pad + 'px">Nothing in these columns by ' + esc(g.name) + '.</span></td>'; tr.after(e); }
        }, function (e) { wait.remove(); FL.toast(String(e), 'err'); });
    };
    /** Per-account values of every accounts row (for account detail) */
    function subRows(tpl, data, opts, st) {
        var out = {};
        st.rows.forEach(function (r) {
            if (r.type !== 'accounts' || !r.accounts || r.accounts.length < 1) return;
            var perAcc = {};
            st.columns.forEach(function (c, i) {
                if (c.kind !== 'value') return;
                FINE.explain(tpl, data, opts, r.id, c.id).forEach(function (a) { (perAcc[a.code] = perAcc[a.code] || { code: a.code, name: a.name, raw: {} }).raw[c.id] = a.amount; });
            });
            out[r.id] = Object.keys(perAcc).sort().map(function (k) {
                var a = perAcc[k];
                a.values = st.columns.map(function (c) {
                    if (c.kind === 'value') return a.raw[c.id] == null ? 0 : a.raw[c.id] / st.scale;
                    if (c.kind === 'var') { var va = (a.raw[c.a] || 0), vb = (a.raw[c.b] || 0), d = (va - vb) * (r.favourable === 'down' ? -1 : 1); return c.mode === 'pct' ? (vb ? d / Math.abs(vb) * 100 : null) : d / st.scale; }
                    return null;
                });
                return a;
            });
        });
        return out;
    }

    /** Puts accounts on lines: [{code, to}] (to = a line id, '__new' = a new group for builder templates). Saves the templates. */
    FL.tbGapApply = function (tpl, moves, skipped) {
        if (!moves.length) { FL.toast('No line suggested for these accounts — pick one in Review & add', 'warn'); return Promise.resolve(); }
        var by = {}; moves.forEach(function (m) { (by[m.to] = by[m.to] || []).push(m.code); });
        var n = 0; Object.keys(by).forEach(function (to) { n += FINE.moveAccounts(tpl, by[to], to, FL.dims.accounts); });
        return FL.saveTemplates().then(function () {
            FL.cache = {}; FL.closeModal();
            FL.toast(n + ' account(s) added to ' + tpl.name + (skipped ? ' · ' + skipped + ' without a suggestion left for you' : ''), 'ok'); FL.render();
        }).catch(function (e) { FL.toast(String(e && e.message || e), 'err'); });
    };
    /** Select of a template's lines (+ a new group for builder templates); sel = the line chosen */
    FL.lineSelect = function (tpl, sel, cls, extra) {
        var opts = FINE.tplTargets(tpl).map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === sel ? ' selected' : '') + '>' + esc(t.label) + '</option>'; });
        if (tpl.simple) opts.push('<option value="__new"' + (sel === '__new' ? ' selected' : '') + '>＋ a new group (by its type)</option>');
        return '<select class="' + (cls || '') + '"' + (extra || '') + '>' + (sel ? '' : '<option value="">— choose a line —</option>') + opts.join('') + '</select>';
    };
    /** Every trial balance account the statement leaves out, the suggested line for each (changeable), add ticked / all */
    FL.tbGapDialog = function (tpl, gaps) {
        var kind = FINE.tplKind(tpl), tot = 0; gaps.forEach(function (g) { tot += g.amount; });
        var html = '<p class="sm">These accounts have amounts in the trial balance but are on no line of <b>' + esc(tpl.name) + '</b>, so its totals leave them out' +
            (Math.abs(tot) >= 0.5 ? ' (' + FL.num(tot) + ' ' + FL.scaleLabel() + ' ' + (kind === 'BS' ? 'closing' : 'year to date') + ')' : '') +
            '. Each has a suggested line — from accounts with the same type whose codes start the same way, or its class. Change any before adding.</p>' +
            '<div class="scroll" style="max-height:56vh"><table class="t" id="tg-t"><thead><tr><th><input type="checkbox" id="tg-all" checked></th><th>Account</th><th>Name</th><th>Type</th><th>Class</th><th class="n">' + (kind === 'BS' ? 'Closing' : 'Year to date') + '</th><th>Add to line</th><th>Why</th></tr></thead><tbody>' +
            gaps.map(function (g, i) {
                return '<tr data-i="' + i + '"><td><input type="checkbox" class="tg-c"' + (g.suggest ? ' checked' : '') + '></td><td>' + esc(g.code) + '</td><td>' + esc(g.name || '') + '</td><td>' + esc(g.type || '') + '</td><td>' + esc(g.cls || '') + '</td>' +
                    '<td class="n">' + (Math.abs(g.amount) >= 0.5 ? FL.num(g.amount) : '<span class="muted" title="Amounts only in other periods">other periods</span>') + '</td>' +
                    '<td>' + FL.lineSelect(tpl, g.suggest ? g.suggest.id : '', 'tg-s') + '</td><td class="sm muted">' + esc(g.suggest ? g.suggest.why || '' : 'nothing similar — choose') + '</td></tr>';
            }).join('') + '</tbody></table></div>' +
            '<p class="sm muted">Set every ticked row at once: ' + FL.lineSelect(tpl, '', '', ' id="tg-bulk"') + '</p>';
        FL.modal('<i class="fa-solid fa-list-check"></i> Accounts missing from ' + esc(tpl.name), html,
            '<button class="btn sm" id="tg-csv"><i class="fa-solid fa-file-csv"></i> CSV</button><button class="btn sm primary" id="tg-add"><i class="fa-solid fa-plus"></i> Add ticked</button>');
        var body = $('m-body');
        $('tg-all').onchange = function () { var c = this.checked; body.querySelectorAll('.tg-c').forEach(function (x) { x.checked = c; }); };
        $('tg-bulk').onchange = function () { var v = this.value; if (!v) return; body.querySelectorAll('#tg-t tbody tr').forEach(function (tr) { if (tr.querySelector('.tg-c').checked) tr.querySelector('.tg-s').value = v; }); };
        body.querySelectorAll('.tg-s').forEach(function (sel) { sel.onchange = function () { if (this.value) this.closest('tr').querySelector('.tg-c').checked = true; }; });
        $('tg-csv').onclick = function () { FL.csv(tpl.id + '-missing-accounts.csv', ['account', 'name', 'type', 'class', 'amount', 'suggested line'], gaps.map(function (g) { return [g.code, g.name, g.type, g.cls, g.amount.toFixed(2), g.suggest ? g.suggest.label : '']; })); };
        $('tg-add').onclick = function () {
            var moves = [], none = 0;
            body.querySelectorAll('#tg-t tbody tr').forEach(function (tr) {
                if (!tr.querySelector('.tg-c').checked) return;
                var to = tr.querySelector('.tg-s').value; if (!to) { none++; return; }
                moves.push({ code: gaps[+tr.dataset.i].code, to: to });
            });
            if (none) FL.toast(none + ' ticked account(s) have no line chosen — left out', 'warn');
            FL.tbGapApply(tpl, moves, 0);
        };
    };

    FL.TABS.statements = {
        render: function (el) {
            if (S.tpl === 'TB' || !(FL.status && FL.status.loaded)) return FL.tb.render(el);
            var tpl = FL.tpl(S.tpl) || FL.templates[0];
            if (!tpl) { el.innerHTML = '<div class="empty">No templates — open the Statement builder.</div>'; return; }
            S.tpl = tpl.id;
            return FL.data().then(function (data) {
                var opts = FL.stmtOpts(), kind = FINE.tplKind(tpl) || (tpl.type === 'BS' ? 'BS' : tpl.type === 'PL' ? 'PL' : null);
                // Columns: the template's own, or a column set chosen here (per statement kind, kept per PC); with a budget in the
                // data and nothing chosen yet, the income statement opens on Month & YTD vs budget
                var cur = FL.dims.periods.filter(function (p) { return p.period_seq === opts.period; })[0] || {};
                var hasBud = Object.keys((data.facts || {}).BUDGET || {}).some(function (a) { return Object.keys(data.facts.BUDGET[a]).some(function (q) { var p = FL.dims.periods.filter(function (x) { return x.period_seq === +q; })[0]; return p && p.fiscal_year === cur.fiscal_year; }); });
                var colPick = FL.ls('stmt.cols', {}), colId = kind ? colPick[kind] : null;
                if (kind === 'PL' && colId == null && hasBud) colId = 'budget';
                if (kind && colId && colId !== '_tpl') opts.columns = FINE.colset(kind, colId);
                var st = FL.stdLabels(FINE.compute(tpl, data, opts));
                var budNote = !hasBud ? (colId === 'budget' ? ' · <b class="neg">no budget for ' + esc(cur.fiscal_year || '') + '</b> — baseline a plan in Planning' : '') :
                    ' · budget: ' + (data.budgetPlans && data.budgetPlans.length ? esc(data.budgetPlans.map(function (b) { return b.name || b.id; }).join(', ')) + ' (Planning)' : 'Fusion GL');
                S.last = { tpl: tpl, st: st, opts: opts };
                var sub = S.detail ? subRows(tpl, data, opts, st) : null;
                var segs = S.segCache || [], segOn = S.segBy ? segs.filter(function (g) { return g.col === S.segBy; })[0] : null;
                if (S.detail && !S.segCache) S.segList().then(function (l) { if (l.length) FL.render(); });
                var gaps = FINE.tbGaps(tpl, data, opts.period), looseAmt = 0;
                gaps.forEach(function (g) { looseAmt += g.amount; });
                S.gaps = gaps;
                el.innerHTML = FL.tb.head() +
                    (kind ? '<label class="sm">Columns <select id="st-cols"><option value="_tpl">as in the template</option>' + FINE.COLSETS[kind === 'BS' ? 'BS' : 'PL'].map(function (c) {
                        return '<option value="' + c.id + '"' + (colId === c.id ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select></label>' : '') +
                    '<label class="sm"><input type="checkbox" id="st-zero"' + (S.hideZero ? ' checked' : '') + '> hide empty lines</label>' +
                    '<label class="sm"><input type="checkbox" id="st-det"' + (S.detail ? ' checked' : '') + '> account detail</label>' +
                    (S.detail && segs.length ? '<label class="sm" title="Each account line gets a ▸ that opens it by this segment (from the synced trial balance segments or the extended segments)">open accounts by <select id="st-segby"><option value="">—</option>' +
                        segs.map(function (g) { return '<option value="' + g.col + '"' + (S.segBy === g.col ? ' selected' : '') + '>' + esc(g.name) + '</option>'; }).join('') + '</select></label>' : '') +
                    '<label class="sm" title="How line names are written. Sentence case is the usual style of published statements (IFRS / IAS 1): Trade and other receivables. Acronyms such as VAT or PPE stay in capitals.">Labels <select id="st-case">' +
                    [['sentence', 'Sentence case (standard)'], ['title', 'Title Case'], ['upper', 'UPPER CASE'], ['asis', 'as written']].map(function (o) { return '<option value="' + o[0] + '"' + (S.labels === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
                    '<button class="btn sm" id="st-std" title="Write standard labels and fonts into the template itself (headings bold, lines plain, totals bold with a rule, the final total double-underlined, % lines italic)"><i class="fa-solid fa-spell-check"></i> Standardize template</button>' +
                    '<button class="btn sm" id="st-xl"><i class="fa-solid fa-file-excel"></i> Excel</button>' +
                    '<button class="btn sm" id="st-xla" title="Every template in one workbook"><i class="fa-solid fa-file-excel"></i> All statements</button>' +
                    '<button class="btn sm" id="st-csv"><i class="fa-solid fa-file-csv"></i> CSV</button>' +
                    '<button class="btn sm" onclick="window.print()"><i class="fa-solid fa-print"></i> Print</button>' +
                    (tpl.simple ? '' : '<button class="btn sm" id="st-edit"><i class="fa-solid fa-pen-ruler"></i> Edit template</button>') + '</div>' +
                    '<div class="stmt-wrap"><div class="stmt-head"><h2>' + esc(tpl.name) + '</h2><div class="sub">' + esc(FL.filterText()) + ' · period ' + esc(st.periodName) + ' · amounts in ' + FL.scaleLabel() + (st.columns.some(function (c) { return c.scenario === 'BUDGET'; }) || colId === 'budget' ? budNote : '') +
                    (FL.filter.cc && tpl.type === 'BS' ? ' · <b>balance sheet accounts carry no cost centre: pick All cost centres</b>' : '') + '</div></div>' +
                    (gaps.length ? '<div class="callout warn st-gap"><i class="fa-solid fa-triangle-exclamation"></i> <b>' + gaps.length + ' trial balance account(s) are not in this statement</b> — ' +
                        (Math.abs(looseAmt) >= 0.5 ? FL.num(Math.abs(looseAmt)) + ' ' + FL.scaleLabel() + ' ' + (FINE.tplKind(tpl) === 'BS' ? 'of closing balances' : 'this year') + ' the totals leave out' : 'they carry amounts in other periods') +
                        '. e.g. ' + gaps.slice(0, 3).map(function (g) { return '<b>' + esc(g.code) + '</b> ' + esc(g.name || '') + (g.suggest ? ' → <i>' + esc(g.suggest.label) + '</i>' : ''); }).join(' · ') +
                        '<div style="margin-top:6px"><button class="btn sm primary" id="st-gaps"><i class="fa-solid fa-list-check"></i> Review &amp; add (' + gaps.length + ')</button> ' +
                        '<button class="btn sm" id="st-gapall"><i class="fa-solid fa-wand-magic-sparkles"></i> Add all as suggested</button>' + (tpl.simple ? ' <a id="st-map">open the mapping</a>' : '') + '</div></div>' : '') +
                    (st.errors.length ? '<div class="stmt-err"><i class="fa-solid fa-triangle-exclamation"></i> ' + st.errors.map(esc).join(' · ') + '</div>' : '') +
                    FL.stmtTable(st, { links: true, hideZero: S.hideZero, detail: S.detail, sub: sub, segBy: segOn ? S.segBy : '', segName: segOn ? segOn.name : '' }) + '</div>' +
                    '<p class="sm muted">Click a line name for the accounts mapped to it; click an amount to see the accounts behind it, then companies, cost centres, months and journal lines. Variances are shown favourable (+) / unfavourable (−).</p>';
                FL.tb.wireHead(el);
                if ($('st-cols')) $('st-cols').onchange = function () { var m = FL.ls('stmt.cols', {}); m[kind] = this.value; FL.lsSet('stmt.cols', m); FL.render(); };
                $('st-zero').onchange = function () { S.hideZero = this.checked; FL.lsSet('stmt.hideZero', S.hideZero); FL.render(); };
                $('st-det').onchange = function () { S.detail = this.checked; FL.render(); };
                if ($('st-segby')) $('st-segby').onchange = function () { S.segBy = this.value; FL.lsSet('stmt.segBy', S.segBy); FL.render(); };
                el.querySelectorAll('tr.sub[data-acc]').forEach(function (tr) {
                    var c = tr.querySelector('.st-segc'); if (!c) return;
                    tr.style.cursor = 'pointer';
                    tr.onclick = function () { S.toggleSeg(tr, data, opts, st, tr.dataset.of, tr.dataset.acc, segOn); };
                });
                $('st-case').onchange = function () { S.labels = this.value; FL.lsSet('stmt.labels', S.labels); FL.render(); };
                $('st-std').onclick = function () { S.standardize(tpl); };
                $('st-xl').onclick = function () { FL.excel([S.last.st], tpl.name); };
                $('st-xla').onclick = function () { FL.excel(FL.templates.map(function (t) { return FL.stdLabels(FINE.compute(t, data, opts)); }), 'Financial statements'); };
                $('st-csv').onclick = function () { FL.csv(tpl.id + '-' + st.periodName + '.csv', ['line'].concat(st.columns.map(function (c) { return c.label; })), st.rows.filter(function (r) { return r.type !== 'blank'; }).map(function (r) { return [r.label].concat(r.values.map(function (v) { return v == null ? '' : Math.round(v * 100) / 100; })); })); };
                if ($('st-edit')) $('st-edit').onclick = function () { FL.designer.open(tpl.id); };
                if ($('st-map')) $('st-map').onclick = function () { FL.builder.open(tpl.id, 'unmapped'); };
                if ($('st-gaps')) $('st-gaps').onclick = function () { FL.tbGapDialog(tpl, gaps); };
                if ($('st-gapall')) $('st-gapall').onclick = function () { FL.tbGapApply(tpl, gaps.filter(function (g) { return g.suggest; }).map(function (g) { return { code: g.code, to: g.suggest.id }; }), gaps.filter(function (g) { return !g.suggest; }).length); };
                el.querySelectorAll('td.lbl').forEach(function (td) { td.onclick = function () { FL.rowMap(tpl, td.parentNode.dataset.row); }; });
                el.querySelectorAll('td.v').forEach(function (td) {
                    td.onclick = function () { FL.drillCell(tpl, opts, td.parentNode.dataset.row, td.dataset.col); };
                });
            });
        }
    };

    // ── Excel: one formatted sheet per statement ──
    FL.excel = function (stmts, title) {
        if (!window.ExcelJS) { FL.toast('Excel library did not load (internet?)', 'err'); return; }
        var wb = new ExcelJS.Workbook(); wb.creator = 'Finance Lens';
        stmts.forEach(function (st) {
            var ws = wb.addWorksheet(String(st.name || st.template).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
            ws.addRow([st.name]).font = { bold: true, size: 14, color: { argb: 'FF0B2545' } };
            ws.addRow([FL.filterText() + ' · ' + st.periodName + ' · amounts in ' + FL.scaleLabel()]).font = { italic: true, color: { argb: 'FF64748B' } };
            ws.addRow([]);
            var hr = ws.addRow([''].concat(st.columns.map(function (c) { return c.label; })));
            hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            hr.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13315C' } }; c.alignment = { horizontal: 'center', wrapText: true }; });
            st.rows.forEach(function (r) {
                if (r.hidden) return;
                var vals = r.values.map(function (v) { return v == null ? null : Math.round(v * 100) / 100; });
                var row = ws.addRow([r.label || ''].concat(r.type === 'header' || r.type === 'blank' || r.type === 'text' ? [] : vals));
                var s = r.style || {};
                row.getCell(1).alignment = { indent: (r.level || 0) * 2 };
                row.font = { bold: !!s.bold, italic: !!s.italic, color: { argb: s.muted ? 'FF64748B' : r.type === 'check' && !r.ok ? 'FFB91C1C' : 'FF0F172A' } };
                st.columns.forEach(function (c, i) {
                    var cell = row.getCell(i + 2);
                    cell.numFmt = (c.kind === 'var' && c.mode === 'pct') || c.kind === 'pctof' || r.format === 'pct' ? '0.0"%";-0.0"%";"–"' : r.format === 'ratio' ? '0.00"×"' : r.format === 'days' ? '0" d"' : '#,##0;(#,##0);"–"';
                    if (c.kind === 'var' && cell.value != null) cell.font = { bold: !!s.bold, color: { argb: cell.value >= 0 ? 'FF15803D' : 'FFB91C1C' } };
                    if (s.topBorder) cell.border = Object.assign({}, cell.border, { top: { style: 'thin' } });
                    if (s.doubleBottom) cell.border = Object.assign({}, cell.border, { bottom: { style: 'double' } });
                });
            });
            ws.getColumn(1).width = 46;
            st.columns.forEach(function (_, i) { ws.getColumn(i + 2).width = 15; });
            ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 4 }];
            ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
        });
        wb.xlsx.writeBuffer().then(function (buf) {
            FL.download((title || 'statements').replace(/[^\w -]+/g, '') + ' ' + FL.periodName(FL.filter.period) + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        });
    };
})();
